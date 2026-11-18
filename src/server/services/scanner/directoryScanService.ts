import fs from 'fs';
import path from 'path';
import chokidar, { type FSWatcher } from 'chokidar';
import { db } from '../../db.ts';
import { appConfig } from '../../config.ts';
import { logger } from '../../logger.ts';
import { notifyImageIndexed } from '../comfyuiLiveMonitor.ts';
import { walkDirectoryFilesAsync } from '../fsWalkService.ts';
import { invalidateStorageUsageStatsCache } from '../storageStatsService.ts';
import { purgeCorruptZeroDimensionImages } from './corruptRecordCleanup.ts';
import { backfillMissingImagePrompts } from './derivedMetadataService.ts';
import { indexSingleImageFile } from './imageIndexer.ts';
import { SUPPORTED_EXTENSIONS, resolveImageDiskPath } from './scannerMediaUtils.ts';

let activeScanJobId: number | null = null;
let fsWatcher: FSWatcher | null = null;

/**
 * Returns the currently running scan job row or the most recent completed/failed scan job.
 */
export function getActiveScanStatus() {
  if (activeScanJobId) {
    return db.prepare('SELECT * FROM scan_jobs WHERE id = ?').get(activeScanJobId);
  }
  return db.prepare('SELECT * FROM scan_jobs ORDER BY id DESC LIMIT 1').get() || null;
}

/**
 * Triggers a full, incremental, reconcile, or metadata-rebuild scan of the ComfyUI output directory.
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
  const walked = await walkDirectoryFilesAsync(rootDir, {
    extensions: SUPPORTED_EXTENSIONS,
    includeStat: false,
  });
  const files = walked.map((entry) => entry.fullPath);

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
        .prepare(
          'SELECT id, relative_path, COALESCE(is_uploaded_reference, 0) AS is_uploaded_reference FROM images WHERE is_missing = 0'
        )
        .all() as { id: number; relative_path: string; is_uploaded_reference: number }[];
      for (const row of existingRows) {
        if (row.is_uploaded_reference) {
          const uploadedPath = resolveImageDiskPath(row);
          if (!fs.existsSync(uploadedPath)) {
            db.prepare('UPDATE images SET is_missing = 1 WHERE id = ?').run(row.id);
            deleted++;
          }
          continue;
        }
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
        invalidateStorageUsageStatsCache();
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
    invalidateStorageUsageStatsCache();
  });
}
