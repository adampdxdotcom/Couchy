import { db } from '../../db.ts';
import { appConfig } from '../../config.ts';
import { resolveImageDiskPath } from '../scannerService.ts';
import { getBoolSetting } from '../settingsService.ts';
import { mapDraftRowToRecord } from './civitaiActivitySyncService.ts';
import {
  classifyPromptGraphMetadata,
  inspectCoreImageShare,
  inspectDiskImageNativeMetadata,
  type CoreShareImageRow,
} from './civitaiShareCore.ts';
import { evaluateCivitaiStackShareEligibility } from './civitaiShareStackEligibility.ts';
import type {
  CivitaiDraftRecord,
  CivitaiShareEligibilityResponse,
} from '../../../shared/apiTypes.ts';

export { classifyPromptGraphMetadata, inspectDiskImageNativeMetadata };

async function findEligibleSourceInSeries(imageId: number): Promise<number | null> {
  const seriesRows = db
    .prepare(
      `SELECT sib.image_id, i.relative_path, COALESCE(i.is_uploaded_reference, 0) AS is_uploaded_reference
       FROM image_series_items cur
       JOIN image_series_items sib ON sib.series_id = cur.series_id
       JOIN images i ON i.id = sib.image_id
       WHERE cur.image_id = ?
         AND sib.image_id != ?
         AND i.is_missing = 0
         AND COALESCE(i.is_uploaded_reference, 0) = 0
       ORDER BY sib.step_order ASC, sib.image_id ASC`
    )
    .all(imageId, imageId) as Array<{
    image_id: number;
    relative_path: string;
    is_uploaded_reference: number;
  }>;

  for (const row of seriesRows) {
    const diskPath = resolveImageDiskPath(row);
    const inspected = await inspectDiskImageNativeMetadata(diskPath);
    if (inspected.fileExists && inspected.hasNativeMetadata) {
      return row.image_id;
    }
  }
  return null;
}

/**
 * Evaluates full Civitai draft-sharing eligibility, candidate model versions,
 * prefilled form fields, stack eligibility, and prior drafts for a gallery image.
 */
export async function evaluateCivitaiShareEligibility(
  imageId: number,
  options?: { seriesId?: number | null; includeStack?: boolean }
): Promise<CivitaiShareEligibilityResponse> {
  const imageRow = db
    .prepare(
      `SELECT i.id, i.content_hash, i.relative_path, i.filename, i.file_size,
              i.width, i.height, i.format, i.is_missing,
              COALESCE(i.is_uploaded_reference, 0) AS is_uploaded_reference,
              COALESCE(r.is_rejected, 0) AS is_rejected
       FROM images i
       LEFT JOIN ratings r ON r.content_hash = i.content_hash
       WHERE i.id = ?`
    )
    .get(imageId) as CoreShareImageRow | undefined;

  if (!imageRow) {
    throw new Error('Image not found');
  }

  const allowUncharacterizedSetting = getBoolSetting('allow_civitai_share_uncharacterized', false);
  const hasCivitaiKey = Boolean(appConfig.civitaiApiKey && appConfig.civitaiApiKey.trim());

  const core = await inspectCoreImageShare(
    imageRow,
    hasCivitaiKey,
    allowUncharacterizedSetting
  );

  const sourceOriginalImageId =
    core.isStandaloneUpscale || !core.hasNativeMetadata
      ? await findEligibleSourceInSeries(imageId)
      : null;

  const draftRows = db
    .prepare(
      `SELECT *
       FROM image_civitai_drafts
       WHERE image_id = ? OR image_content_hash = ?
       ORDER BY id DESC`
    )
    .all(imageId, imageRow.content_hash) as any[];

  const existingDrafts: CivitaiDraftRecord[] = draftRows.map(mapDraftRowToRecord);

  const stack =
    options?.includeStack === false
      ? null
      : await evaluateCivitaiStackShareEligibility(imageId, {
          preferredSeriesId: options?.seriesId,
          hasCivitaiKey,
          allowUncharacterizedSetting,
        });

  return {
    eligible: core.eligible,
    hasCivitaiKey,
    reasons: core.reasons,
    hasNativeMetadata: core.hasNativeMetadata,
    isStandaloneUpscale: core.isStandaloneUpscale,
    sourceOriginalImageId,
    fileSizeBytes: core.fileSizeBytes,
    width: core.width,
    height: core.height,
    format: core.format,
    linkedCharacters: core.linkedCharacters,
    allowUncharacterizedSetting,
    prefilledTitle: core.prefilledTitle,
    prefilledDescription: core.prefilledDescription,
    prefilledTags: core.prefilledTags,
    recommendedModelVersionId: core.recommendedModelVersionId,
    recommendedDomain: core.recommendedDomain,
    candidateModelVersions: core.candidateModelVersions,
    embeddedResourceNames: core.embeddedResourceNames,
    existingDrafts,
    stack,
  };
}
