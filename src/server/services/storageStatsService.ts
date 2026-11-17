import { db } from '../db.ts';
import { appConfig } from '../config.ts';
import { walkDirectoryFilesAsync } from './fsWalkService.ts';
import { getModelCleanupStatus } from './modelCleanupService.ts';
import type { StorageCategoryStat, StorageUsageStatsResponse } from '../../shared/types.ts';

const STORAGE_STATS_TTL_MS = 45_000;

let cachedStorageStats: { value: StorageUsageStatsResponse; expiresAt: number } | null = null;
let inFlightStorageStats: Promise<StorageUsageStatsResponse> | null = null;
let storageStatsGeneration = 0;

/**
 * Clears the cached `/api/stats/storage` snapshot so the next request recomputes fresh usage.
 */
export function invalidateStorageUsageStatsCache(): void {
  storageStatsGeneration += 1;
  cachedStorageStats = null;
  inFlightStorageStats = null;
}

/**
 * Recursively sums non-hidden file counts and byte sizes via shared async directory walker.
 */
async function measureDirectoryBytes(rootDir: string): Promise<StorageCategoryStat> {
  if (!rootDir) return { count: 0, sizeBytes: 0 };
  const files = await walkDirectoryFilesAsync(rootDir, {
    skipHidden: true,
    includeStat: true,
  });
  let sizeBytes = 0;
  for (const file of files) {
    sizeBytes += file.size;
  }
  return { count: files.length, sizeBytes };
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

async function computeStorageUsageStats(): Promise<StorageUsageStatsResponse> {
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

/**
 * Computes ComfyUI storage stats alongside local storage stats, using a 45s TTL cache
 * and in-flight coalescing to keep repeated dashboard/API reads instantaneous.
 */
export async function getStorageUsageStats(options?: {
  bypassCache?: boolean;
}): Promise<StorageUsageStatsResponse> {
  const now = Date.now();
  if (!options?.bypassCache && cachedStorageStats && cachedStorageStats.expiresAt > now) {
    return cachedStorageStats.value;
  }

  if (!options?.bypassCache && inFlightStorageStats) {
    return inFlightStorageStats;
  }

  const startGeneration = storageStatsGeneration;
  const promise = computeStorageUsageStats()
    .then((result) => {
      if (startGeneration === storageStatsGeneration) {
        cachedStorageStats = {
          value: result,
          expiresAt: Date.now() + STORAGE_STATS_TTL_MS,
        };
      }
      return result;
    })
    .finally(() => {
      if (inFlightStorageStats === promise) {
        inFlightStorageStats = null;
      }
    });

  if (!options?.bypassCache) {
    inFlightStorageStats = promise;
  }
  return promise;
}
