import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import sharp from 'sharp';
import chokidar, { type FSWatcher } from 'chokidar';
import { db } from '../db.ts';
import { appConfig } from '../config.ts';
import { logger } from '../logger.ts';
import { parseImageMetadata, parseImageMetadataFromChunks } from './pngMetadataParser.ts';
import { runAssistedCharacterIdentificationForImage } from './characterService.ts';
import { notifyImageIndexed } from './comfyuiLiveMonitor.ts';
import { attachGenerationItemOutputToSeries } from './seriesService.ts';
import { startVisualTaggerQueue } from './visualTaggerService.ts';
import type { DependencyStatus } from '../../shared/types.ts';

export interface IndexSingleResult {
  outcome: 'added' | 'modified' | 'unchanged' | 'error';
  imageId: number | null;
  contentHash: string | null;
}

const SUPPORTED_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp']);

let activeScanJobId: number | null = null;
let fsWatcher: FSWatcher | null = null;

/**
 * Backfills positive/negative prompts for any already-indexed images in SQLite whose
 * prompt was previously unextracted (e.g. Krea2_turbo PrimitiveStringMultiline #30_19).
 */
export function backfillMissingImagePrompts(force = false): number {
  if (!force) {
    const alreadyDone = db
      .prepare("SELECT value FROM app_settings WHERE key = 'prompt_backfill_v1_done'")
      .get() as { value: string } | undefined;
    if (alreadyDone?.value === '1') {
      return 0;
    }
  }
  const rows = db
    .prepare(
      `SELECT
         m.image_id,
         m.raw_metadata_json,
         w.api_workflow_json,
         w.visual_workflow_json
       FROM image_metadata m
       LEFT JOIN image_workflows iw ON iw.image_id = m.image_id
       LEFT JOIN workflows w ON w.id = iw.workflow_id
       WHERE m.positive_prompt IS NULL OR TRIM(m.positive_prompt) = ''`
    )
    .all() as {
    image_id: number;
    raw_metadata_json: string | null;
    api_workflow_json: string | null;
    visual_workflow_json: string | null;
  }[];

  if (rows.length === 0) {
    db.prepare(
      `INSERT INTO app_settings (key, value, updated_at)
       VALUES ('prompt_backfill_v1_done', '1', datetime('now'))
       ON CONFLICT(key) DO UPDATE SET value = '1', updated_at = datetime('now')`
    ).run();
    return 0;
  }

  let updatedCount = 0;
  const updateStmt = db.prepare(
    `UPDATE image_metadata
     SET positive_prompt = COALESCE(?, positive_prompt),
         negative_prompt = COALESCE(?, negative_prompt),
         missing_fields_json = ?,
         provenance_json = ?
     WHERE image_id = ?`
  );

  for (const row of rows) {
    let chunks: Record<string, string> = {};
    if (row.raw_metadata_json) {
      try {
        const parsedRaw = JSON.parse(row.raw_metadata_json);
        if (parsedRaw && typeof parsedRaw === 'object') {
          chunks = { ...parsedRaw };
        }
      } catch {
        // ignore
      }
    }
    if (!chunks.prompt && row.api_workflow_json) {
      chunks.prompt = row.api_workflow_json;
    }
    if (!chunks.workflow && row.visual_workflow_json) {
      chunks.workflow = row.visual_workflow_json;
    }
    if (Object.keys(chunks).length === 0) continue;

    const reparsed = parseImageMetadataFromChunks(chunks);
    if (reparsed.positivePrompt) {
      updateStmt.run(
        reparsed.positivePrompt,
        reparsed.negativePrompt,
        JSON.stringify(reparsed.missingFields),
        JSON.stringify(reparsed.provenance),
        row.image_id
      );
      runAssistedCharacterIdentificationForImage(row.image_id);
      updatedCount++;
    }
  }

  db.prepare(
    `INSERT INTO app_settings (key, value, updated_at)
     VALUES ('prompt_backfill_v1_done', '1', datetime('now'))
     ON CONFLICT(key) DO UPDATE SET value = '1', updated_at = datetime('now')`
  ).run();

  return updatedCount;
}

export function getActiveScanStatus() {
  if (activeScanJobId) {
    return db.prepare('SELECT * FROM scan_jobs WHERE id = ?').get(activeScanJobId);
  }
  return db.prepare('SELECT * FROM scan_jobs ORDER BY id DESC LIMIT 1').get() || null;
}

/**
 * Computes SHA-256 hash of a file without modifying it.
 */
export function computeFileSha256(filePath: string): string {
  const hash = crypto.createHash('sha256');
  const data = fs.readFileSync(filePath);
  hash.update(data);
  return hash.digest('hex');
}

/**
 * Generates an asynchronous WebP thumbnail (384px max on the long side) in data/thumbnails.
 */
export async function ensureWebpThumbnail(
  sourceFile: string,
  contentHash: string,
  forceOverwrite = false
): Promise<{
  thumbPath: string | null;
  width: number;
  height: number;
  format: string;
}> {
  fs.mkdirSync(appConfig.thumbnailPath, { recursive: true });
  const thumbFile = path.join(appConfig.thumbnailPath, `${contentHash}.webp`);
  try {
    const metadata = await sharp(sourceFile).metadata();
    const width = metadata.width || 0;
    const height = metadata.height || 0;
    if (width <= 0 || height <= 0) {
      return { thumbPath: null, width: 0, height: 0, format: 'PNG' };
    }
    const format = (metadata.format || path.extname(sourceFile).slice(1)).toUpperCase();

    if (forceOverwrite || !fs.existsSync(thumbFile)) {
      await sharp(sourceFile)
        .resize({ width: 384, height: 384, fit: 'inside', withoutEnlargement: true })
        .webp({ quality: 80 })
        .toFile(thumbFile);
    }
    return { thumbPath: thumbFile, width, height, format };
  } catch {
    return { thumbPath: null, width: 0, height: 0, format: 'PNG' };
  }
}

/**
 * Deletes a single corrupt/0x0 image record and any orphaned series rows from SQLite.
 */
function deleteCorruptImageRecord(imageId: number): void {
  try {
    const row = db
      .prepare('SELECT id, content_hash FROM images WHERE id = ?')
      .get(imageId) as { id: number; content_hash: string } | undefined;
    if (!row) return;

    const tx = db.transaction(() => {
      db.prepare('UPDATE generation_items SET output_image_id = NULL WHERE output_image_id = ?').run(
        row.id
      );
      db.prepare('DELETE FROM image_series_items WHERE image_id = ?').run(row.id);
      db.prepare(
        'DELETE FROM image_series WHERE id NOT IN (SELECT DISTINCT series_id FROM image_series_items)'
      ).run();
      db.prepare('DELETE FROM images WHERE id = ?').run(row.id);
      const otherWithHash = db
        .prepare('SELECT 1 FROM images WHERE content_hash = ? LIMIT 1')
        .get(row.content_hash);
      if (!otherWithHash) {
        db.prepare('DELETE FROM ratings WHERE content_hash = ? AND rating = 0 AND is_favorite = 0').run(
          row.content_hash
        );
      }
    });
    tx();
  } catch (err) {
    console.warn(`Failed to clean up corrupt image record #${imageId}:`, err);
  }
}

/**
 * Self-healing cleanup that purges any 0-byte or 0x0 corrupt image rows (e.g. from disk-full writes).
 */
export function purgeCorruptZeroDimensionImages(): number {
  try {
    const corruptRows = db
      .prepare('SELECT id FROM images WHERE width <= 0 OR height <= 0 OR file_size <= 0')
      .all() as { id: number }[];
    if (corruptRows.length === 0) return 0;

    for (const row of corruptRows) {
      deleteCorruptImageRecord(row.id);
    }
    logger.warn('Scanner', `Purged ${corruptRows.length} corrupt 0x0/0-byte image record(s) from SQLite`);
    notifyImageIndexed();
    return corruptRows.length;
  } catch (err) {
    logger.warn('Scanner', 'Failed to purge corrupt 0x0 image records', err);
    return 0;
  }
}

let isThumbnailMigrationRunning = false;

/**
 * Background migration that ensures all indexed images have a 384px long-side WebP
 * thumbnail inside `data/thumbnails`, yielding between files so requests are never blocked.
 */
export async function runBackgroundThumbnailMigration(): Promise<void> {
  if (isThumbnailMigrationRunning) return;
  isThumbnailMigrationRunning = true;

  try {
    const migrationSetting = db
      .prepare("SELECT value FROM app_settings WHERE key = 'thumb_migration_384_v1'")
      .get() as { value: string } | undefined;
    const forceRebuildAll = migrationSetting?.value !== '1';

    const rows = db
      .prepare(
        `SELECT id, content_hash, relative_path, thumbnail_path
         FROM images
         WHERE is_missing = 0
         ORDER BY id DESC`
      )
      .all() as {
      id: number;
      content_hash: string;
      relative_path: string;
      thumbnail_path: string | null;
    }[];

    const updateStmt = db.prepare('UPDATE images SET thumbnail_path = ? WHERE id = ?');

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const expectedThumb = path.join(appConfig.thumbnailPath, `${row.content_hash}.webp`);
      const thumbExists = fs.existsSync(expectedThumb);

      if (forceRebuildAll || !thumbExists || row.thumbnail_path !== expectedThumb) {
        const origPath = path.resolve(appConfig.comfyuiOutputDir, row.relative_path);
        if (fs.existsSync(origPath)) {
          const { thumbPath } = await ensureWebpThumbnail(origPath, row.content_hash, forceRebuildAll);
          if (thumbPath && row.thumbnail_path !== thumbPath) {
            updateStmt.run(thumbPath, row.id);
          }
        }
        // Yield to event loop after each generated thumbnail
        await new Promise((resolve) => setImmediate(resolve));
      } else if (i % 50 === 0) {
        await new Promise((resolve) => setImmediate(resolve));
      }
    }

    if (forceRebuildAll) {
      db.prepare(
        `INSERT INTO app_settings (key, value, updated_at)
         VALUES ('thumb_migration_384_v1', '1', datetime('now'))
         ON CONFLICT(key) DO UPDATE SET value = '1', updated_at = datetime('now')`
      ).run();
    }
  } catch (err) {
    console.error('Background thumbnail migration error:', err);
  } finally {
    isThumbnailMigrationRunning = false;
  }
}

/**
 * Evaluates dependency status for an image against known installed models in `models`.
 */
export function recomputeImageDependencyStatus(imageId: number): DependencyStatus {
  const deps = db
    .prepare('SELECT * FROM image_models WHERE image_id = ?')
    .all(imageId) as any[];

  const meta = db
    .prepare('SELECT positive_prompt, checkpoint_name FROM image_metadata WHERE image_id = ?')
    .get(imageId) as { positive_prompt: string | null; checkpoint_name: string | null } | undefined;

  if (deps.length === 0 && !meta?.checkpoint_name) {
    db.prepare('UPDATE images SET dependency_status = ? WHERE id = ?').run('unknown', imageId);
    return 'unknown';
  }

  let allPresent = true;
  let allHashesVerified = deps.length > 0;

  for (const dep of deps) {
    const modelRecord = db
      .prepare(
        `SELECT * FROM models
         WHERE LOWER(filename) = LOWER(?)
            OR LOWER(name) = LOWER(?)
            OR (sha256_hash IS NOT NULL AND sha256_hash = ?)
            OR (autov2_hash IS NOT NULL AND autov2_hash = ?)
         LIMIT 1`
      )
      .get(dep.model_name, dep.model_name.replace(/\.(safetensors|ckpt|pt)$/i, ''), dep.model_hash, dep.model_hash) as any;

    if (!modelRecord || !modelRecord.is_installed) {
      allPresent = false;
      allHashesVerified = false;
      db.prepare('UPDATE image_models SET status = ?, model_id = ? WHERE id = ?').run(
        'missing',
        modelRecord?.id ?? null,
        dep.id
      );
    } else {
      const hashVerified = Boolean(
        dep.model_hash &&
          (modelRecord.sha256_hash === dep.model_hash || modelRecord.autov2_hash === dep.model_hash)
      );
      if (!hashVerified) {
        allHashesVerified = false;
      }
      db.prepare('UPDATE image_models SET status = ?, model_id = ? WHERE id = ?').run(
        hashVerified ? 'exact_match' : 'available',
        modelRecord.id,
        dep.id
      );
      db.prepare('UPDATE image_loras SET model_id = ? WHERE image_id = ? AND LOWER(lora_name) = LOWER(?)').run(
        modelRecord.id,
        imageId,
        dep.model_name
      );
    }
  }

  const finalStatus: DependencyStatus = !allPresent
    ? 'incomplete'
    : allHashesVerified
    ? 'exact_match'
    : 'available';

  db.prepare('UPDATE images SET dependency_status = ? WHERE id = ?').run(finalStatus, imageId);
  return finalStatus;
}

/**
 * Resolves the best-matching appearance label for a character from prompt text and LoRAs.
 */
export function resolveAppearanceForCharacter(
  characterId: number,
  positivePrompt: string | null,
  loras: { loraName: string }[] = []
): string {
  try {
    const charLoras = db
      .prepare(
        'SELECT lora_name, appearance_label FROM character_loras WHERE character_id = ?'
      )
      .all(characterId) as { lora_name: string; appearance_label: string }[];

    const promptLower = (positivePrompt || '').toLowerCase();

    // 1. Check if any LoRA matches a character LoRA with an explicit appearance label
    for (const cl of charLoras) {
      if (!cl.appearance_label || cl.appearance_label === 'Default') continue;
      const clName = cl.lora_name.toLowerCase().replace(/\.(safetensors|pt|ckpt)$/i, '');
      const hitLora = loras.some((l) =>
        l.loraName.toLowerCase().replace(/\.(safetensors|pt|ckpt)$/i, '') === clName
      );
      if (hitLora) {
        return cl.appearance_label;
      }
    }

    // 2. Check if positive prompt mentions any known appearance label for this character
    for (const cl of charLoras) {
      if (!cl.appearance_label || cl.appearance_label === 'Default') continue;
      const appLower = cl.appearance_label.toLowerCase();
      if (promptLower.includes(appLower)) {
        return cl.appearance_label;
      }
    }

    // 3. Check character tags for appearance hints
    const tags = db
      .prepare(
        'SELECT t.name FROM character_tags ct JOIN tags t ON t.id = ct.tag_id WHERE ct.character_id = ?'
      )
      .all(characterId) as { name: string }[];
    for (const tag of tags) {
      if (tag.name && promptLower.includes(tag.name.toLowerCase())) {
        return tag.name;
      }
    }

    return 'Default';
  } catch {
    return 'Default';
  }
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
    const stat = fs.statSync(fullPath);
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
      if (!fs.existsSync(expectedThumb) || existingByPath.thumbnail_path !== expectedThumb) {
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
        const appearanceLabel = resolveAppearanceForCharacter(
          characterId,
          meta?.positive_prompt ?? null,
          loras
        );
        db.prepare(
          `INSERT INTO image_characters
            (image_id, image_content_hash, character_id, status, source, confidence, match_reason, appearance_label)
           VALUES (?, ?, ?, 'confirmed', 'manual', 1.0, 'Generated with character mention', ?)
           ON CONFLICT(image_content_hash, character_id) DO UPDATE SET
            status = 'confirmed',
            image_id = excluded.image_id,
            appearance_label = COALESCE(excluded.appearance_label, image_characters.appearance_label),
            updated_at = datetime('now')`
        ).run(existingByPath.id, existingByPath.content_hash, characterId, appearanceLabel);
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
      db.prepare(
        `INSERT INTO image_metadata (
          image_id, positive_prompt, negative_prompt, seed, steps, cfg, sampler, scheduler,
          denoise, batch_size, batch_index, generation_date, checkpoint_name, checkpoint_hash,
          vae_name, missing_fields_json, provenance_json, raw_metadata_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(image_id) DO UPDATE SET
          positive_prompt = excluded.positive_prompt,
          negative_prompt = excluded.negative_prompt,
          seed = excluded.seed,
          steps = excluded.steps,
          cfg = excluded.cfg,
          sampler = excluded.sampler,
          scheduler = excluded.scheduler,
          denoise = excluded.denoise,
          batch_size = excluded.batch_size,
          batch_index = excluded.batch_index,
          generation_date = excluded.generation_date,
          checkpoint_name = excluded.checkpoint_name,
          checkpoint_hash = excluded.checkpoint_hash,
          vae_name = excluded.vae_name,
          missing_fields_json = excluded.missing_fields_json,
          provenance_json = excluded.provenance_json,
          raw_metadata_json = excluded.raw_metadata_json`
      ).run(
        imageId,
        parsed.positivePrompt,
        parsed.negativePrompt,
        parsed.seed,
        parsed.steps,
        parsed.cfg,
        parsed.sampler,
        parsed.scheduler,
        parsed.denoise,
        parsed.batchSize,
        parsed.batchIndex,
        parsed.generationDate,
        parsed.checkpointName,
        parsed.checkpointHash,
        parsed.vaeName,
        JSON.stringify(parsed.missingFields),
        JSON.stringify(parsed.provenance),
        JSON.stringify(parsed.rawChunks)
      );

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
        // Ensure historical record in models
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
        const appearanceLabel = resolveAppearanceForCharacter(
          effectiveCharacterId,
          parsed.positivePrompt,
          parsed.loras
        );
        db.prepare(
          `INSERT INTO image_characters
            (image_id, image_content_hash, character_id, status, source, confidence, match_reason, appearance_label)
           VALUES (?, ?, ?, 'confirmed', 'manual', 1.0, 'Generated with character mention', ?)
           ON CONFLICT(image_content_hash, character_id) DO UPDATE SET
            status = 'confirmed',
            image_id = excluded.image_id,
            appearance_label = COALESCE(excluded.appearance_label, image_characters.appearance_label),
            updated_at = datetime('now')`
        ).run(imageId, contentHash, effectiveCharacterId, appearanceLabel);
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

    return { outcome, imageId: imageId!, contentHash };
  } catch (err) {
    logger.error('Scanner', `Error indexing image file: ${fullPath}`, err);
    return { outcome: 'error', imageId: null, contentHash: null };
  }
}

/**
 * Recursively collects all supported image files in a directory.
 */
function walkDirectoryRecursive(dir: string): string[] {
  const results: string[] = [];
  if (!fs.existsSync(dir)) return results;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...walkDirectoryRecursive(full));
    } else if (entry.isFile() && SUPPORTED_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
      results.push(full);
    }
  }
  return results;
}

/**
 * Triggers a full or incremental scan of the mounted ComfyUI output directory.
 */
export async function runDirectoryScan(
  scanType: 'full' | 'incremental' | 'reconcile' | 'rebuild_metadata' = 'incremental'
): Promise<number> {
  purgeCorruptZeroDimensionImages();
  if (scanType === 'rebuild_metadata') {
    backfillMissingImagePrompts(true);
  }
  if (activeScanJobId !== null) {
    return activeScanJobId;
  }

  const rootDir = appConfig.comfyuiOutputDir;
  const files = walkDirectoryRecursive(rootDir);

  const info = db
    .prepare(
      `INSERT INTO scan_jobs (status, scan_type, total_files, processed_files)
       VALUES ('running', ?, ?, 0)`
    )
    .run(scanType, files.length);
  const jobId = Number(info.lastInsertRowid);
  activeScanJobId = jobId;

  // Run scan asynchronously, yielding between files so HTTP requests are never starved
  setImmediate(async () => {
    let added = 0;
    let modified = 0;
    let deleted = 0;
    const errors: string[] = [];
    const seenRelativePaths = new Set<string>();

    try {
      for (let i = 0; i < files.length; i++) {
        const filePath = files[i];
        const rel = path.relative(rootDir, filePath).replace(/\\/g, '/');
        seenRelativePaths.add(rel);

        const res = await indexSingleImageFile(
          filePath,
          rootDir,
          scanType === 'rebuild_metadata' || scanType === 'full'
        );
        if (res.outcome === 'added') added++;
        else if (res.outcome === 'modified') modified++;
        else if (res.outcome === 'error') errors.push(`Failed to index ${rel}`);

        if ((i + 1) % 25 === 0 || i === files.length - 1) {
          db.prepare(
            `UPDATE scan_jobs
             SET processed_files = ?, added_count = ?, modified_count = ?
             WHERE id = ?`
          ).run(i + 1, added, modified, jobId);
        }

        // Yield to the Node.js event loop so gallery/character API queries execute immediately
        if (res.outcome !== 'unchanged' || i % 20 === 0) {
          await new Promise((resolve) => setImmediate(resolve));
        }
      }

      // Reconcile deleted files (mark is_missing = 1 while preserving user annotations)
      const existingRows = db
        .prepare('SELECT id, relative_path FROM images WHERE is_missing = 0')
        .all() as { id: number; relative_path: string }[];
      for (const row of existingRows) {
        if (!seenRelativePaths.has(row.relative_path)) {
          db.prepare('UPDATE images SET is_missing = 1 WHERE id = ?').run(row.id);
          deleted++;
        }
      }

      db.prepare(
        `UPDATE scan_jobs
         SET status = 'completed', processed_files = ?, added_count = ?,
             modified_count = ?, deleted_count = ?, error_log = ?, completed_at = datetime('now')
         WHERE id = ?`
      ).run(files.length, added, modified, deleted, JSON.stringify(errors), jobId);

      if (added > 0 || modified > 0 || deleted > 0) {
        logger.info(
          'Scanner',
          `Directory scan (${scanType}) completed: +${added} added, ~${modified} modified, -${deleted} missing`
        );
        notifyImageIndexed();
      }
    } catch (err: any) {
      logger.error('Scanner', `Directory scan (${scanType}) failed`, err);
      errors.push(err?.message || 'Unexpected scanner error');
      db.prepare(
        `UPDATE scan_jobs
         SET status = 'failed', error_log = ?, completed_at = datetime('now')
         WHERE id = ?`
      ).run(JSON.stringify(errors), jobId);
    } finally {
      activeScanJobId = null;
    }
  });

  return jobId;
}

/**
 * Starts continuous filesystem monitoring on the mounted ComfyUI output directory.
 */
export function startFilesystemWatcher(): void {
  purgeCorruptZeroDimensionImages();
  if (fsWatcher) {
    fsWatcher.close();
  }

  const watchDir = appConfig.comfyuiOutputDir;
  fs.mkdirSync(watchDir, { recursive: true });

  fsWatcher = chokidar.watch(watchDir, {
    ignoreInitial: true,
    persistent: true,
    awaitWriteFinish: {
      stabilityThreshold: 800,
      pollInterval: 200,
    },
  });

  fsWatcher.on('add', async (filePath) => {
    const res = await indexSingleImageFile(filePath, watchDir, false);
    if (res.outcome === 'added' || res.outcome === 'modified') {
      notifyImageIndexed();
    }
  });

  fsWatcher.on('change', async (filePath) => {
    const res = await indexSingleImageFile(filePath, watchDir, true);
    if (res.outcome === 'added' || res.outcome === 'modified') {
      notifyImageIndexed();
    }
  });

  fsWatcher.on('unlink', (filePath) => {
    const rel = path.relative(watchDir, filePath).replace(/\\/g, '/');
    db.prepare('UPDATE images SET is_missing = 1 WHERE relative_path = ?').run(rel);
  });
}

/**
 * Copies generation metadata, LoRA stack, model dependencies, workflow link,
 * and confirmed character associations from a source image onto a derived (e.g. upscaled) image.
 */
export function copyImageMetadataToDerivedImage(
  sourceImageId: number,
  derivedImageId: number
): void {
  if (!sourceImageId || !derivedImageId || sourceImageId === derivedImageId) return;
  try {
    const baseImg = db
      .prepare('SELECT dependency_status FROM images WHERE id = ?')
      .get(sourceImageId) as { dependency_status: string } | undefined;
    const derivedImg = db
      .prepare('SELECT content_hash FROM images WHERE id = ?')
      .get(derivedImageId) as { content_hash: string } | undefined;
    const baseMeta = db
      .prepare('SELECT * FROM image_metadata WHERE image_id = ?')
      .get(sourceImageId) as any;

    const tx = db.transaction(() => {
      if (baseImg?.dependency_status) {
        db.prepare('UPDATE images SET dependency_status = ? WHERE id = ?').run(
          baseImg.dependency_status,
          derivedImageId
        );
      }

      if (baseMeta) {
        db.prepare(
          `INSERT INTO image_metadata (
            image_id, positive_prompt, negative_prompt, seed, steps, cfg, sampler, scheduler,
            denoise, batch_size, batch_index, generation_date, checkpoint_name, checkpoint_hash,
            vae_name, missing_fields_json, provenance_json, raw_metadata_json
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(image_id) DO UPDATE SET
            positive_prompt = excluded.positive_prompt,
            negative_prompt = excluded.negative_prompt,
            seed = excluded.seed,
            steps = excluded.steps,
            cfg = excluded.cfg,
            sampler = excluded.sampler,
            scheduler = excluded.scheduler,
            denoise = excluded.denoise,
            batch_size = excluded.batch_size,
            batch_index = excluded.batch_index,
            generation_date = excluded.generation_date,
            checkpoint_name = excluded.checkpoint_name,
            checkpoint_hash = excluded.checkpoint_hash,
            vae_name = excluded.vae_name,
            missing_fields_json = excluded.missing_fields_json,
            provenance_json = excluded.provenance_json,
            raw_metadata_json = excluded.raw_metadata_json`
        ).run(
          derivedImageId,
          baseMeta.positive_prompt,
          baseMeta.negative_prompt,
          baseMeta.seed,
          baseMeta.steps,
          baseMeta.cfg,
          baseMeta.sampler,
          baseMeta.scheduler,
          baseMeta.denoise,
          baseMeta.batch_size,
          baseMeta.batch_index,
          baseMeta.generation_date,
          baseMeta.checkpoint_name,
          baseMeta.checkpoint_hash,
          baseMeta.vae_name,
          baseMeta.missing_fields_json,
          baseMeta.provenance_json,
          baseMeta.raw_metadata_json
        );
      }

      const baseLoras = db
        .prepare('SELECT * FROM image_loras WHERE image_id = ?')
        .all(sourceImageId) as any[];
      if (baseLoras.length > 0) {
        db.prepare('DELETE FROM image_loras WHERE image_id = ?').run(derivedImageId);
        const insLora = db.prepare(
          `INSERT INTO image_loras
            (image_id, model_id, lora_name, lora_path, lora_hash, model_strength, clip_strength, node_id, node_type, provenance)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        );
        for (const l of baseLoras) {
          insLora.run(
            derivedImageId,
            l.model_id,
            l.lora_name,
            l.lora_path,
            l.lora_hash,
            l.model_strength,
            l.clip_strength,
            l.node_id,
            l.node_type,
            l.provenance
          );
        }
      }

      const baseModels = db
        .prepare('SELECT * FROM image_models WHERE image_id = ?')
        .all(sourceImageId) as any[];
      if (baseModels.length > 0) {
        db.prepare('DELETE FROM image_models WHERE image_id = ?').run(derivedImageId);
        const insModel = db.prepare(
          `INSERT INTO image_models
            (image_id, model_id, model_name, model_type, model_hash, status, node_id, node_type, provenance)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
        );
        for (const m of baseModels) {
          insModel.run(
            derivedImageId,
            m.model_id,
            m.model_name,
            m.model_type,
            m.model_hash,
            m.status,
            m.node_id,
            m.node_type,
            m.provenance
          );
        }
      }

      const baseWf = db
        .prepare('SELECT * FROM image_workflows WHERE image_id = ?')
        .get(sourceImageId) as any;
      if (baseWf) {
        db.prepare(
          `INSERT INTO image_workflows (image_id, workflow_id, format_type)
           VALUES (?, ?, ?)
           ON CONFLICT(image_id) DO UPDATE SET
             workflow_id = excluded.workflow_id,
             format_type = excluded.format_type`
        ).run(derivedImageId, baseWf.workflow_id, baseWf.format_type);
      }

      if (derivedImg?.content_hash) {
        const baseChars = db
          .prepare("SELECT * FROM image_characters WHERE image_id = ? AND status = 'confirmed'")
          .all(sourceImageId) as any[];
        for (const ch of baseChars) {
          db.prepare(
            `INSERT INTO image_characters
              (image_id, image_content_hash, character_id, status, source, confidence, match_reason, appearance_label)
             VALUES (?, ?, ?, 'confirmed', ?, ?, ?, ?)
             ON CONFLICT(image_content_hash, character_id) DO UPDATE SET
               status = 'confirmed',
               image_id = excluded.image_id,
               appearance_label = COALESCE(excluded.appearance_label, image_characters.appearance_label),
               updated_at = datetime('now')`
          ).run(
            derivedImageId,
            derivedImg.content_hash,
            ch.character_id,
            ch.source || 'upscale',
            ch.confidence ?? 1.0,
            ch.match_reason || 'Inherited from upscaled source image',
            ch.appearance_label || 'Default'
          );
        }
      }
    });

    tx();
  } catch (err) {
    console.warn('Failed to copy source metadata to derived image:', err);
  }
}

