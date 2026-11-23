import path from 'path';
import { db } from '../db.ts';
import { appConfig } from '../config.ts';
import { syncModelInventory, updateLoraMentionConfig } from './modelInventoryService.ts';
import { type CivitaiNormalizedMeta } from './civitai/civitaiHttpAndParse.ts';
import {
  applyCivitaiEnrichmentToModel,
  cacheModelPreviewImages,
  fetchAndEnrichModelFromCivitai,
  invalidateInstalledModelsCache,
} from './civitai/civitaiModelEnrichmentService.ts';
import { invalidateStorageUsageStatsCache } from './storageStatsService.ts';
import { classifySafetensorsHeaderOnDisk } from './loraClassifierService.ts';
import { handleDownloadedCharacterLoraAutomation } from './characterDownloadAutomationService.ts';
import { VALID_LORA_CATEGORIES } from '../../shared/pillSettings.ts';
import type { LoraCategory } from '../../shared/types.ts';
import type { ExecuteDownloadJobParams } from './modelDownloadExecutor.ts';

/**
 * Finalizes a completed model download after atomic `.part` rename:
 * marks the job complete, classifies/upserts the `models` row, caches Civitai metadata,
 * syncs ComfyUI inventory, and applies @mention / character automation hooks.
 */
export async function finalizeCompletedModelDownload(
  jobId: number,
  params: ExecuteDownloadJobParams,
  bytesDownloaded: number,
  actualHash: string,
  hashVerified: boolean
): Promise<void> {
  db.prepare(
    `UPDATE download_jobs
     SET status = 'completed', bytes_downloaded = ?, actual_hash = ?,
         hash_verified = ?, error_message = NULL, completed_at = datetime('now')
     WHERE id = ?`
  ).run(bytesDownloaded, actualHash, hashVerified ? 1 : 0, jobId);

  // Register in `models` table (availability in ComfyUI is verified immediately via syncModelInventory)
  const resolvedDest = path.resolve(params.destinationPath);
  const resolvedComfyModels = path.resolve(appConfig.comfyuiModelsDir || '');
  const downloadedDirectlyIntoComfy = Boolean(
    resolvedComfyModels &&
      (resolvedDest === resolvedComfyModels ||
        resolvedDest.startsWith(resolvedComfyModels + path.sep))
  );

  // Explicit user/search selection wins; fall back to safetensors header inspection if unclassified
  let resolvedLoraCategory: LoraCategory = 'unclassified';
  if (params.effectiveModelType === 'lora') {
    const requestedCat =
      params.loraCategory && VALID_LORA_CATEGORIES.has(params.loraCategory)
        ? params.loraCategory
        : 'unclassified';
    resolvedLoraCategory =
      requestedCat !== 'unclassified'
        ? requestedCat
        : classifySafetensorsHeaderOnDisk(params.destinationPath, {
            name: params.modelName,
            filename: params.safeFilename,
            trainedWords: params.civitaiMeta?.trainedWords || [],
            description: params.civitaiMeta?.civitaiDescription || null,
            baseModel: params.civitaiMeta?.baseModel || null,
          });
  }

  db.prepare(
    `INSERT INTO models
      (name, filename, model_type, lora_category, file_path, file_size, sha256_hash, autov2_hash, is_installed, source_type, download_url, hf_repo_id, download_file_path, last_seen_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'filesystem', ?, ?, ?, datetime('now'))
     ON CONFLICT(filename) DO UPDATE SET
       model_type = excluded.model_type,
       lora_category = CASE
         WHEN excluded.lora_category <> 'unclassified' THEN excluded.lora_category
         ELSE models.lora_category
       END,
       file_path = excluded.file_path,
       file_size = excluded.file_size,
       sha256_hash = excluded.sha256_hash,
       autov2_hash = excluded.autov2_hash,
       is_installed = excluded.is_installed,
       download_url = excluded.download_url,
       hf_repo_id = COALESCE(excluded.hf_repo_id, models.hf_repo_id),
       download_file_path = excluded.download_file_path,
       last_seen_at = datetime('now')`
  ).run(
    params.modelName,
    params.safeFilename,
    params.effectiveModelType,
    resolvedLoraCategory,
    params.destinationPath,
    bytesDownloaded,
    actualHash.toLowerCase(),
    actualHash.slice(0, 10).toLowerCase(),
    downloadedDirectlyIntoComfy ? 1 : 0,
    params.sourceUrl,
    params.hfRepoId || null,
    downloadedDirectlyIntoComfy ? null : params.destinationPath
  );
  invalidateInstalledModelsCache();
  invalidateStorageUsageStatsCache();

  const savedRow = db
    .prepare('SELECT id FROM models WHERE LOWER(filename) = LOWER(?)')
    .get(params.safeFilename) as { id: number } | undefined;

  if (savedRow && params.provider === 'civitai') {
    try {
      if (params.civitaiMeta) {
        const meta: CivitaiNormalizedMeta = {
          civitaiId: params.civitaiMeta.civitaiId ?? null,
          civitaiVersionId: params.civitaiMeta.civitaiVersionId ?? null,
          civitaiUrl: params.civitaiMeta.civitaiUrl ?? null,
          baseModel: params.civitaiMeta.baseModel ?? null,
          trainedWords: Array.isArray(params.civitaiMeta.trainedWords)
            ? params.civitaiMeta.trainedWords
            : [],
          recommendedWeight: params.civitaiMeta.recommendedWeight ?? null,
          civitaiDescription: params.civitaiMeta.civitaiDescription ?? null,
          previewImages: Array.isArray(params.civitaiMeta.previewImages)
            ? params.civitaiMeta.previewImages
            : [],
        };
        const cacheKey = `m${savedRow.id}_${meta.civitaiVersionId || actualHash.slice(0, 10).toLowerCase()}`;
        const cachedPreviews = await cacheModelPreviewImages(cacheKey, meta.previewImages);
        applyCivitaiEnrichmentToModel(savedRow.id, meta, cachedPreviews);
      } else {
        await fetchAndEnrichModelFromCivitai(savedRow.id);
      }
    } catch {
      // Do not fail completed model download if optional Civitai enrichment fails
    }
  }

  await syncModelInventory();

  if (
    params.effectiveModelType === 'lora' &&
    params.mentionAutomation &&
    (params.mentionAutomation.mentionEnabled || params.mentionAutomation.nickname.trim())
  ) {
    const cleanNick = params.mentionAutomation.nickname.trim().replace(/^@+/, '').toLowerCase();
    try {
      updateLoraMentionConfig({
        loraName: params.safeFilename,
        mentionEnabled: params.mentionAutomation.mentionEnabled,
        ...(cleanNick ? { nickname: cleanNick } : {}),
      });
    } catch (err) {
      console.warn(
        `[Download] Failed to apply @mention config for ${params.safeFilename}:`,
        err
      );
    }
  }

  if (
    params.effectiveModelType === 'lora' &&
    resolvedLoraCategory === 'character' &&
    params.characterAutomation?.addCharacter
  ) {
    await handleDownloadedCharacterLoraAutomation({
      downloadJobId: jobId,
      loraFilename: params.safeFilename,
      recommendedWeight: params.civitaiMeta?.recommendedWeight ?? null,
      automation: params.characterAutomation,
    }).catch(() => {});
  }
}
