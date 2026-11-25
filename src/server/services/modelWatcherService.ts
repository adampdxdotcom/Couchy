import fs from 'fs';
import path from 'path';
import chokidar, { type FSWatcher } from 'chokidar';
import { appConfig } from '../config.ts';
import { logger } from '../logger.ts';
import { MODEL_EXTS } from './fsWalkService.ts';
import { syncModelInventory } from './modelInventoryService.ts';

let modelWatcher: FSWatcher | null = null;
let debounceTimer: ReturnType<typeof setTimeout> | null = null;
let pendingReason: string | null = null;

/**
 * Cancels any pending debounced model sync timer (used during shutdown or tests).
 */
export function cancelPendingModelSync(): void {
  if (debounceTimer) {
    clearTimeout(debounceTimer);
    debounceTimer = null;
  }
  pendingReason = null;
}

/**
 * Coalesces rapid filesystem or reconnect triggers into a single `syncModelInventory()` run.
 */
export function scheduleDebouncedModelSync(
  reason: string,
  delayMs = 2500,
  syncRunner: () => Promise<unknown> = syncModelInventory
): void {
  pendingReason = reason;
  if (debounceTimer) {
    clearTimeout(debounceTimer);
  }
  debounceTimer = setTimeout(() => {
    const activeReason = pendingReason || reason;
    debounceTimer = null;
    pendingReason = null;
    logger.info('ModelWatcher', `Running automatic model inventory sync (${activeReason})`);
    syncRunner().catch((err) => {
      logger.error('ModelWatcher', `Automatic model sync failed (${activeReason})`, err);
    });
  }, Math.max(0, delayMs));
  debounceTimer.unref?.();
}

/**
 * Stops the active `COMFYUI_MODELS_DIR` chokidar watcher and cancels any pending debounce timer.
 */
export async function stopModelFilesystemWatcher(): Promise<void> {
  cancelPendingModelSync();
  if (!modelWatcher) return;
  const watcher = modelWatcher;
  modelWatcher = null;
  await watcher.close().catch(() => {});
}

/**
 * Starts a persistent chokidar watcher on `COMFYUI_MODELS_DIR` so added, updated,
 * or deleted weight files automatically trigger a debounced inventory sync.
 */
export function startModelFilesystemWatcher(): void {
  if (modelWatcher) {
    const prev = modelWatcher;
    modelWatcher = null;
    prev.close().catch(() => {});
  }

  const watchDir = appConfig.comfyuiModelsDir;
  if (!watchDir) return;

  if (!fs.existsSync(watchDir)) {
    logger.warn(
      'ModelWatcher',
      `COMFYUI_MODELS_DIR does not exist yet (${watchDir}); waiting for reconnect or periodic reconcile`
    );
    return;
  }

  const isModelFile = (filePath: string) =>
    MODEL_EXTS.has(path.extname(filePath).toLowerCase());

  modelWatcher = chokidar.watch(watchDir, {
    ignoreInitial: true,
    persistent: true,
    ignorePermissionErrors: true,
    awaitWriteFinish: {
      stabilityThreshold: 2000,
      pollInterval: 300,
    },
  });

  const handleModelEvent = (eventName: string, filePath: string) => {
    if (!isModelFile(filePath)) return;
    scheduleDebouncedModelSync(`fs:${eventName}`, 2500);
  };

  modelWatcher
    .on('add', (filePath) => handleModelEvent('add', filePath))
    .on('change', (filePath) => handleModelEvent('change', filePath))
    .on('unlink', (filePath) => handleModelEvent('unlink', filePath))
    .on('error', (err) => {
      logger.warn('ModelWatcher', `Filesystem watcher error on ${watchDir}`, err);
    });

  logger.info('ModelWatcher', `Live-monitoring ComfyUI Models Directory: ${watchDir}`);
}
