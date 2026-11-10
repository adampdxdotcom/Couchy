import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import sharp from 'sharp';
import chokidar, { type FSWatcher } from 'chokidar';
import { db } from '../db.ts';
import { appConfig } from '../config.ts';
import { parseImageMetadata, parseImageMetadataFromChunks } from './pngMetadataParser.ts';
import { runAssistedCharacterIdentificationForImage } from './characterService.ts';
import type { DependencyStatus } from '../../shared/types.ts';

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
 * Indexes a single image file from the mounted read-only output directory.
 * Never modifies or moves the source file.
 */
export async function indexSingleImageFile(
  fullPath: string,
  rootDir: string,
  forceMetadataRebuild = false
): Promise<'added' | 'modified' | 'unchanged' | 'error'> {
  try {
    const stat = fs.statSync(fullPath);
    if (!stat.isFile()) return 'unchanged';

    const ext = path.extname(fullPath).toLowerCase();
    if (!SUPPORTED_EXTENSIONS.has(ext)) return 'unchanged';

    const relativePath = path.relative(rootDir, fullPath).replace(/\\/g, '/');
    const filename = path.basename(fullPath);
    const mtimeIso = stat.mtime.toISOString();

    // Fast skip if relative_path + file_size + mtime already match and no rebuild requested,
    // while self-healing if the WebP thumbnail in data/thumbnails is missing on disk.
    const existingByPath = db
      .prepare(
        'SELECT id, content_hash, file_size, file_mtime, is_missing, thumbnail_path FROM images WHERE relative_path = ?'
      )
      .get(relativePath) as any;

    if (
      existingByPath &&
      !forceMetadataRebuild &&
      existingByPath.file_size === stat.size &&
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
      return 'unchanged';
    }

    const contentHash = computeFileSha256(fullPath);
    const { thumbPath, width, height, format } = await ensureWebpThumbnail(fullPath, contentHash);
    const parsed = parseImageMetadata(fullPath);

    let imageId: number;
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

      // Store workflow JSONs independently in `workflows`
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
        // Ensure historical record in `models`
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
    });

    tx();
    recomputeImageDependencyStatus(imageId!);
    runAssistedCharacterIdentificationForImage(imageId!);

    return outcome;
  } catch (err) {
    console.error('Error indexing image file:', fullPath, err);
    return 'error';
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
        if (res === 'added') added++;
        else if (res === 'modified') modified++;
        else if (res === 'error') errors.push(`Failed to index ${rel}`);

        if ((i + 1) % 25 === 0 || i === files.length - 1) {
          db.prepare(
            `UPDATE scan_jobs
             SET processed_files = ?, added_count = ?, modified_count = ?
             WHERE id = ?`
          ).run(i + 1, added, modified, jobId);
        }

        // Yield to the Node.js event loop so gallery/character API queries execute immediately
        if (res !== 'unchanged' || i % 20 === 0) {
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
    } catch (err: any) {
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
    await indexSingleImageFile(filePath, watchDir, false);
  });

  fsWatcher.on('change', async (filePath) => {
    await indexSingleImageFile(filePath, watchDir, true);
  });

  fsWatcher.on('unlink', (filePath) => {
    const rel = path.relative(watchDir, filePath).replace(/\\/g, '/');
    db.prepare('UPDATE images SET is_missing = 1 WHERE relative_path = ?').run(rel);
  });
}
