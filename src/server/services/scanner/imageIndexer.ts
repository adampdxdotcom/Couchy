import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { db } from '../../db.ts';
import { appConfig } from '../../config.ts';
import { logger } from '../../logger.ts';
import { parseImageMetadata } from '../pngMetadataParser.ts';
import { runAssistedCharacterIdentificationForImage } from '../characterService.ts';
import { pathExistsAsync } from '../fsWalkService.ts';
import { attachGenerationItemOutputToSeries } from '../seriesService.ts';
import { invalidateStorageUsageStatsCache } from '../storageStatsService.ts';
import { startVisualTaggerQueue } from '../visualTaggerService.ts';
import { deleteCorruptImageRecord } from './corruptRecordCleanup.ts';
import {
  SUPPORTED_EXTENSIONS,
  computeFileSha256,
  ensureWebpThumbnail,
} from './scannerMediaUtils.ts';
import {
  confirmImageCharacterLink,
  recomputeImageDependencyStatus,
  upsertImageMetadata,
} from './scannerPersistenceHelpers.ts';

export interface IndexSingleResult {
  outcome: 'added' | 'modified' | 'unchanged' | 'error';
  imageId: number | null;
  contentHash: string | null;
}

/**
 * Indexes a single image file from the mounted read-only output directory.
 * Never modifies or moves the source file.
 */
export async function indexSingleImageFile(
  fullPath: string,
  rootDir: string,
  forceMetadataRebuild = false,
  characterId?: number | null
): Promise<IndexSingleResult> {
  try {
    const stat = await fs.promises.stat(fullPath);
    if (!stat.isFile()) return { outcome: 'unchanged', imageId: null, contentHash: null };

    const ext = path.extname(fullPath).toLowerCase();
    if (!SUPPORTED_EXTENSIONS.has(ext)) return { outcome: 'unchanged', imageId: null, contentHash: null };

    const relativePath = path.relative(rootDir, fullPath).replace(/\\/g, '/');
    const filename = path.basename(fullPath);
    const mtimeIso = stat.mtime.toISOString();

    // Fast skip if relative_path + file_size + mtime already match and no rebuild requested,
    // while self-healing if the WebP thumbnail in data/thumbnails is missing on disk.
    const existingByPath = db
      .prepare(
        'SELECT id, content_hash, file_size, width, height, file_mtime, is_missing, thumbnail_path FROM images WHERE relative_path = ?'
      )
      .get(relativePath) as any;

    // Reject 0-byte files immediately (e.g. failed ComfyUI SaveImage when disk is full)
    if (stat.size <= 0) {
      if (existingByPath?.id) {
        deleteCorruptImageRecord(existingByPath.id);
      }
      logger.warn('Scanner', `Rejected 0-byte image file: ${relativePath}`);
      return { outcome: 'error', imageId: null, contentHash: null };
    }

    if (
      existingByPath &&
      !forceMetadataRebuild &&
      existingByPath.file_size === stat.size &&
      existingByPath.width > 0 &&
      existingByPath.height > 0 &&
      existingByPath.file_mtime === mtimeIso &&
      existingByPath.is_missing === 0
    ) {
      const expectedThumb = path.join(appConfig.thumbnailPath, `${existingByPath.content_hash}.webp`);
      if (!(await pathExistsAsync(expectedThumb)) || existingByPath.thumbnail_path !== expectedThumb) {
        const { thumbPath } = await ensureWebpThumbnail(fullPath, existingByPath.content_hash);
        if (thumbPath) {
          db.prepare('UPDATE images SET thumbnail_path = ? WHERE id = ?').run(
            thumbPath,
            existingByPath.id
          );
        }
      }

      if (characterId) {
        const meta = db
          .prepare('SELECT positive_prompt FROM image_metadata WHERE image_id = ?')
          .get(existingByPath.id) as { positive_prompt: string | null } | undefined;
        const loras = db
          .prepare('SELECT lora_name AS loraName FROM image_loras WHERE image_id = ?')
          .all(existingByPath.id) as { loraName: string }[];
        confirmImageCharacterLink({
          imageId: existingByPath.id,
          contentHash: existingByPath.content_hash,
          characterId,
          positivePrompt: meta?.positive_prompt ?? null,
          loras,
        });
      }

      return { outcome: 'unchanged', imageId: existingByPath.id, contentHash: existingByPath.content_hash };
    }

    const contentHash = computeFileSha256(fullPath);
    const { thumbPath, width, height, format } = await ensureWebpThumbnail(fullPath, contentHash);

    // Reject truncated or corrupt image files that Sharp cannot decode into valid dimensions
    if (width <= 0 || height <= 0 || !thumbPath) {
      if (existingByPath?.id) {
        deleteCorruptImageRecord(existingByPath.id);
      }
      logger.warn('Scanner', `Rejected corrupt or unreadable image file (${width}x${height}): ${relativePath}`);
      return { outcome: 'error', imageId: null, contentHash: null };
    }

    const parsed = parseImageMetadata(fullPath);

    let imageId = 0;
    let outcome: 'added' | 'modified' = 'added';

    // Check if an image with the same content_hash was moved/renamed from another relative_path
    const existingByHash = db
      .prepare('SELECT id, relative_path FROM images WHERE content_hash = ? LIMIT 1')
      .get(contentHash) as { id: number; relative_path: string } | undefined;

    const tx = db.transaction(() => {
      if (existingByPath) {
        imageId = existingByPath.id;
        outcome = 'modified';
        db.prepare(
          `UPDATE images
           SET content_hash = ?, filename = ?, file_size = ?, width = ?, height = ?,
               format = ?, file_mtime = ?, is_missing = 0, thumbnail_path = ?
           WHERE id = ?`
        ).run(contentHash, filename, stat.size, width, height, format, mtimeIso, thumbPath, imageId);
      } else if (existingByHash) {
        imageId = existingByHash.id;
        outcome = 'modified';
        db.prepare(
          `UPDATE images
           SET relative_path = ?, filename = ?, file_size = ?, width = ?, height = ?,
               format = ?, file_mtime = ?, is_missing = 0, thumbnail_path = ?
           WHERE id = ?`
        ).run(relativePath, filename, stat.size, width, height, format, mtimeIso, thumbPath, imageId);
      } else {
        const info = db
          .prepare(
            `INSERT INTO images
              (content_hash, relative_path, filename, file_size, width, height, format, file_mtime, is_missing, thumbnail_path)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?)`
          )
          .run(contentHash, relativePath, filename, stat.size, width, height, format, mtimeIso, thumbPath);
        imageId = Number(info.lastInsertRowid);
      }

      // Ensure user annotation records are re-linked if content_hash already had annotations
      db.prepare('INSERT OR IGNORE INTO ratings (content_hash, image_id) VALUES (?, ?)').run(
        contentHash,
        imageId
      );
      db.prepare('UPDATE ratings SET image_id = ? WHERE content_hash = ?').run(imageId, contentHash);
      db.prepare('UPDATE image_tags SET image_id = ? WHERE image_content_hash = ?').run(imageId, contentHash);
      db.prepare('UPDATE collection_images SET image_id = ? WHERE image_content_hash = ?').run(
        imageId,
        contentHash
      );
      db.prepare('UPDATE image_characters SET image_id = ? WHERE image_content_hash = ?').run(
        imageId,
        contentHash
      );
      db.prepare('UPDATE characters SET portrait_image_id = ? WHERE portrait_content_hash = ?').run(
        imageId,
        contentHash
      );

      // Upsert machine-derived metadata
      upsertImageMetadata(imageId, {
        positivePrompt: parsed.positivePrompt,
        negativePrompt: parsed.negativePrompt,
        seed: parsed.seed,
        steps: parsed.steps,
        cfg: parsed.cfg,
        sampler: parsed.sampler,
        scheduler: parsed.scheduler,
        denoise: parsed.denoise,
        batchSize: parsed.batchSize,
        batchIndex: parsed.batchIndex,
        generationDate: parsed.generationDate,
        checkpointName: parsed.checkpointName,
        checkpointHash: parsed.checkpointHash,
        vaeName: parsed.vaeName,
        missingFieldsJson: JSON.stringify(parsed.missingFields),
        provenanceJson: JSON.stringify(parsed.provenance),
        rawMetadataJson: JSON.stringify(parsed.rawChunks),
      });

      // Store workflow JSONs independently in workflows
      if (parsed.visualWorkflowJson || parsed.apiWorkflowJson) {
        const wfDigest = crypto
          .createHash('sha256')
          .update((parsed.visualWorkflowJson || '') + '||' + (parsed.apiWorkflowJson || ''))
          .digest('hex');

        db.prepare(
          `INSERT INTO workflows (name, visual_workflow_json, api_workflow_json, workflow_hash)
           VALUES (?, ?, ?, ?)
           ON CONFLICT(workflow_hash) DO UPDATE SET
             visual_workflow_json = COALESCE(workflows.visual_workflow_json, excluded.visual_workflow_json),
             api_workflow_json = COALESCE(workflows.api_workflow_json, excluded.api_workflow_json)`
        ).run(`Workflow ${wfDigest.slice(0, 8)}`, parsed.visualWorkflowJson, parsed.apiWorkflowJson, wfDigest);

        const wfRow = db
          .prepare('SELECT id FROM workflows WHERE workflow_hash = ?')
          .get(wfDigest) as { id: number };
        if (wfRow) {
          db.prepare(
            'INSERT OR IGNORE INTO image_workflows (image_id, image_content_hash, workflow_id) VALUES (?, ?, ?)'
          ).run(imageId, contentHash, wfRow.id);
        }
      }

      // Rebuild machine-derived image_loras and image_models for this image
      db.prepare('DELETE FROM image_loras WHERE image_id = ?').run(imageId);
      db.prepare('DELETE FROM image_models WHERE image_id = ?').run(imageId);

      for (const lora of parsed.loras) {
        db.prepare(
          `INSERT INTO models (name, filename, model_type, is_installed, source_type)
           VALUES (?, ?, 'lora', 0, 'historical')
           ON CONFLICT(filename) DO NOTHING`
        ).run(lora.loraName.replace(/\.(safetensors|pt|ckpt)$/i, ''), lora.loraName);

        db.prepare(
          `INSERT INTO image_loras
            (image_id, lora_name, lora_path, lora_hash, model_strength, clip_strength, node_id, node_type, provenance)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).run(
          imageId,
          lora.loraName,
          lora.loraPath,
          lora.loraHash,
          lora.modelStrength,
          lora.clipStrength,
          lora.nodeId,
          lora.nodeType,
          lora.provenance
        );
      }

      for (const dep of parsed.models) {
        db.prepare(
          `INSERT INTO models (name, filename, model_type, is_installed, source_type)
           VALUES (?, ?, ?, 0, 'historical')
           ON CONFLICT(filename) DO NOTHING`
        ).run(dep.modelName.replace(/\.(safetensors|pt|ckpt)$/i, ''), dep.modelName, dep.modelType);

        db.prepare(
          `INSERT INTO image_models
            (image_id, model_name, model_type, model_hash, node_id, node_type, provenance, status)
           VALUES (?, ?, ?, ?, ?, ?, ?, 'unknown')`
        ).run(
          imageId,
          dep.modelName,
          dep.modelType,
          dep.modelHash,
          dep.nodeId,
          dep.nodeType,
          dep.provenance
        );
      }

      // Auto-link any matching generation_item by seed so ghost cards hand off immediately when fsWatcher indexes the file
      let effectiveCharacterId = characterId || null;
      let matchedGenItemId: number | null = null;
      if (parsed.seed) {
        const matchedGenItem = db
          .prepare(
            `SELECT gi.id, gb.character_id
             FROM generation_items gi
             JOIN generation_batches gb ON gb.id = gi.batch_id
             WHERE gi.output_image_id IS NULL
               AND gi.status IN ('pending', 'submitted', 'completed')
               AND gi.seed = ?
             ORDER BY gi.id DESC
             LIMIT 1`
          )
          .get(String(parsed.seed)) as { id: number; character_id: number | null } | undefined;

        if (matchedGenItem) {
          matchedGenItemId = matchedGenItem.id;
          db.prepare(
            `UPDATE generation_items
             SET status = 'completed', output_image_id = ?, completed_at = COALESCE(completed_at, datetime('now'))
             WHERE id = ?`
          ).run(imageId, matchedGenItem.id);
          if (!effectiveCharacterId && matchedGenItem.character_id) {
            effectiveCharacterId = matchedGenItem.character_id;
          }
        }
      }

      // Directly link character with appearance if requested or matched via generation batch
      if (effectiveCharacterId) {
        confirmImageCharacterLink({
          imageId,
          contentHash,
          characterId: effectiveCharacterId,
          positivePrompt: parsed.positivePrompt,
          loras: parsed.loras,
        });
      }

      return matchedGenItemId;
    });

    const matchedGenItemId = tx();
    if (matchedGenItemId && imageId) {
      try {
        attachGenerationItemOutputToSeries(matchedGenItemId, imageId);
      } catch (seriesErr) {
        console.warn('Failed to attach scanned generation image to series:', seriesErr);
      }
    }
    recomputeImageDependencyStatus(imageId!);
    runAssistedCharacterIdentificationForImage(imageId!);

    // If opt-in visual keyword tagging is enabled, queue background tagging for the newly ingested image
    setImmediate(() => {
      startVisualTaggerQueue().catch(() => {});
    });

    invalidateStorageUsageStatsCache();
    return { outcome, imageId: imageId!, contentHash };
  } catch (err) {
    logger.error('Scanner', `Error indexing image file: ${fullPath}`, err);
    return { outcome: 'error', imageId: null, contentHash: null };
  }
}
