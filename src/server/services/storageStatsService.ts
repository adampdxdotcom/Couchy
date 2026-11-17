import fs from 'fs';
import path from 'path';
import { db } from '../db.ts';
import { appConfig } from '../config.ts';
import { getModelCleanupStatus } from './modelCleanupService.ts';
import type { StorageCategoryStat, StorageUsageStatsResponse } from '../../shared/types.ts';

const STAT_CONCURRENCY = 24;

/**
 * Recursively sums file counts and byte sizes in a local directory via async fs.promises.
 * Missing or unreadable paths safely return 0.
 */
async function measureDirectoryBytes(rootDir: string): Promise<StorageCategoryStat> {
  if (!rootDir) return { count: 0, sizeBytes: 0 };

  const filePaths: string[] = [];
  const walk = async (dir: string): Promise<void> => {
    let entries: fs.Dirent[];
    try {
      entries = await fs.promises.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }

    const subdirs: Promise<void>[] = [];
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue;
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        subdirs.push(walk(fullPath));
      } else if (entry.isFile()) {
        filePaths.push(fullPath);
      }
    }
    if (subdirs.length > 0) {
      await Promise.all(subdirs);
    }
  };

  await walk(rootDir);

  let count = 0;
  let sizeBytes = 0;
  for (let i = 0; i < filePaths.length; i += STAT_CONCURRENCY) {
    const batch = filePaths.slice(i, i + STAT_CONCURRENCY);
    const results = await Promise.all(
      batch.map(async (fp) => {
        try {
          const stat = await fs.promises.stat(fp);
          return stat.isFile() ? stat.size : null;
        } catch {
          return null;
        }
      })
    );
    for (const sz of results) {
      if (sz !== null) {
        count += 1;
        sizeBytes += sz;
      }
    }
  }

  return { count, sizeBytes };
}

function queryModelCategoryStat(modelTypes: string[]): StorageCategoryStat {
  const placeholders = modelTypes.map(() => '?').join(', ');
  const row = db
    .prepare(
      `SELECT COUNT(*) AS count,
              COALESCE(SUM(COALESCE(file_size, 0)), 0) AS sizeBytes,
              COALESCE(SUM(CASE WHEN file_size IS NULL OR file_size <= 0 THEN 1 ELSE 0 END), 0) AS unsizedCount
       FROM models
       WHERE is_installed = 1
         AND model_type IN (${placeholders})`
    )
    .get(...modelTypes) as
    | { count: number; sizeBytes: number; unsizedCount: number }
    | undefined;

  return {
    count: Number(row?.count || 0),
    sizeBytes: Number(row?.sizeBytes || 0),
    unsizedCount: Number(row?.unsizedCount || 0),
  };
}

/**
 * Computes ComfyUI storage stats (using cached fs.stat sizes in SQLite for photos, LoRAs,
 * and UNET/Checkpoint base models) alongside local storage stats (live disk walks for
 * imported reference images & thumbnails, plus pending duplicate-cleanup model queue).
 */
export async function getStorageUsageStats(): Promise<StorageUsageStatsResponse> {
  const loras = queryModelCategoryStat(['lora']);
  // Restrict base models strictly to UNET ('diffusion') and Checkpoint ('checkpoint')
  const baseModels = queryModelCategoryStat(['diffusion', 'checkpoint']);

  const photosRow = db
    .prepare(
      `SELECT COUNT(*) AS count,
              COALESCE(SUM(COALESCE(file_size, 0)), 0) AS sizeBytes
       FROM images
       WHERE is_missing = 0
         AND COALESCE(is_uploaded_reference, 0) = 0`
    )
    .get() as { count: number; sizeBytes: number } | undefined;

  const photos: StorageCategoryStat = {
    count: Number(photosRow?.count || 0),
    sizeBytes: Number(photosRow?.sizeBytes || 0),
  };

  const [importedImages, thumbnails] = await Promise.all([
    measureDirectoryBytes(appConfig.uploadedImagesDir),
    measureDirectoryBytes(appConfig.thumbnailPath),
  ]);

  const cleanupStatus = getModelCleanupStatus();
  const pendingDeleteModels = {
    count: cleanupStatus.candidates.length,
    sizeBytes: cleanupStatus.totalReclaimableBytes,
    eligibleCount: cleanupStatus.eligibleCount,
    retentionHours: cleanupStatus.retentionHours,
    lastScanAt: cleanupStatus.lastScanAt,
  };

  const comfyTotalBytes = loras.sizeBytes + baseModels.sizeBytes + photos.sizeBytes;
  const localTotalBytes =
    importedImages.sizeBytes + thumbnails.sizeBytes + pendingDeleteModels.sizeBytes;

  return {
    comfy: {
      loras,
      baseModels,
      photos,
      totalBytes: comfyTotalBytes,
    },
    local: {
      importedImages,
      thumbnails,
      pendingDeleteModels,
      totalBytes: localTotalBytes,
    },
    totalTrackedBytes: comfyTotalBytes + localTotalBytes,
    generatedAt: new Date().toISOString(),
  };
}
