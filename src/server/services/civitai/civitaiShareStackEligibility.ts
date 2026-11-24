import { db } from '../../db.ts';
import {
  inspectCoreImageShare,
  type CoreShareImageRow,
} from './civitaiShareCore.ts';
import type {
  CivitaiDomain,
  CivitaiModelVersionCandidate,
  CivitaiShareExcludedItem,
  CivitaiShareStackEligibility,
  CivitaiShareStackItem,
} from '../../../shared/apiTypes.ts';

export const CIVITAI_MAX_POST_IMAGES = 20;

interface StackMemberQueryRow extends CoreShareImageRow {
  series_id: number;
  poster_image_id: number | null;
  step_order: number;
  is_favorite: number;
}

/**
 * Resolves the active series containing `imageId` (respecting an explicit `preferredSeriesId`
 * from the Inspector) and evaluates stack-level Civitai sharing eligibility across all steps.
 */
export async function evaluateCivitaiStackShareEligibility(
  imageId: number,
  options: {
    preferredSeriesId?: number | null;
    hasCivitaiKey: boolean;
    allowUncharacterizedSetting: boolean;
  }
): Promise<CivitaiShareStackEligibility | null> {
  const memberships = db
    .prepare(
      `SELECT isi.series_id, s.poster_image_id,
              (SELECT MAX(step_order) FROM image_series_items WHERE series_id = isi.series_id) AS max_step
       FROM image_series_items isi
       JOIN image_series s ON s.id = isi.series_id
       WHERE isi.image_id = ?
       ORDER BY (isi.series_id = COALESCE(?, -1)) DESC,
                (s.poster_image_id = ?) DESC,
                (isi.step_order = max_step) DESC,
                isi.series_id DESC
       LIMIT 1`
    )
    .all(imageId, options.preferredSeriesId ?? null, imageId) as Array<{
    series_id: number;
    poster_image_id: number | null;
  }>;

  if (memberships.length === 0) {
    return null;
  }

  const chosenSeriesId = memberships[0].series_id;
  const seriesPosterId = memberships[0].poster_image_id;

  const memberRows = db
    .prepare(
      `SELECT isi.series_id, s.poster_image_id, isi.step_order,
              i.id, i.content_hash, i.relative_path, i.filename, i.file_size,
              i.width, i.height, i.format, i.is_missing,
              COALESCE(i.is_uploaded_reference, 0) AS is_uploaded_reference,
              COALESCE(r.is_rejected, 0) AS is_rejected,
              COALESCE(r.is_favorite, 0) AS is_favorite
       FROM image_series_items isi
       JOIN image_series s ON s.id = isi.series_id
       JOIN images i ON i.id = isi.image_id
       LEFT JOIN ratings r ON r.content_hash = i.content_hash
       WHERE isi.series_id = ?
       ORDER BY isi.step_order ASC, isi.image_id ASC`
    )
    .all(chosenSeriesId) as StackMemberQueryRow[];

  if (memberRows.length < 2) {
    return null;
  }

  const seenImageIds = new Set<number>();
  const eligibleByStep: CivitaiShareStackItem[] = [];
  const excludedItems: CivitaiShareExcludedItem[] = [];

  for (const row of memberRows) {
    if (seenImageIds.has(row.id)) continue;
    seenImageIds.add(row.id);

    const inspected = await inspectCoreImageShare(
      row,
      options.hasCivitaiKey,
      options.allowUncharacterizedSetting
    );

    if (!inspected.eligibleForContent) {
      excludedItems.push({
        imageId: row.id,
        stepOrder: row.step_order,
        filename: row.filename,
        reasonCode: inspected.exclusionCode || 'missing_native_metadata',
        reason: inspected.exclusionReason || inspected.reasons[0] || 'Not eligible',
      });
      continue;
    }

    const hashParam = row.content_hash ? `?h=${String(row.content_hash).slice(0, 12)}` : '';
    eligibleByStep.push({
      imageId: row.id,
      stepOrder: row.step_order,
      filename: row.filename,
      thumbnailUrl: `/api/images/${row.id}/thumbnail${hashParam}`,
      width: inspected.width,
      height: inspected.height,
      fileSizeBytes: inspected.fileSizeBytes,
      format: inspected.format,
      isFavorite: Boolean(row.is_favorite),
      isPoster: false,
      prefilledTitle: inspected.prefilledTitle,
      prefilledDescription: inspected.prefilledDescription,
      tags: inspected.prefilledTags,
      recommendedDomain: inspected.recommendedDomain,
      recommendedModelVersionId: inspected.recommendedModelVersionId,
      candidateModelVersions: inspected.candidateModelVersions,
      embeddedResourceNames: inspected.embeddedResourceNames,
    });
  }

  // Hearted poster goes first without duplication; fallback if no eligible hearted image keeps step order
  const posterItem =
    (seriesPosterId
      ? eligibleByStep.find((item) => item.imageId === seriesPosterId && item.isFavorite)
      : undefined) ||
    [...eligibleByStep].reverse().find((item) => item.isFavorite) ||
    null;

  if (posterItem) {
    posterItem.isPoster = true;
  }

  const orderedEligible = posterItem
    ? [posterItem, ...eligibleByStep.filter((item) => item.imageId !== posterItem.imageId)]
    : eligibleByStep;

  // Post-level title/prompt/primary model come from the hearted Poster, or most recent eligible step
  const representativeItem = posterItem || eligibleByStep[eligibleByStep.length - 1] || null;

  // Merge and deduplicate tags across all eligible stack images
  const mergedTags: string[] = [];
  const seenTagKeys = new Set<string>();
  const orderedForMeta = representativeItem
    ? [representativeItem, ...orderedEligible.filter((i) => i.imageId !== representativeItem.imageId)]
    : orderedEligible;

  const mergedCandidates: CivitaiModelVersionCandidate[] = [];
  const seenVersionIds = new Set<number>();
  const embeddedResourcesSet = new Set<string>();
  let recommendedDomain: CivitaiDomain = 'civitai.com';

  for (const item of orderedForMeta) {
    if (item.recommendedDomain === 'civitai.red') {
      recommendedDomain = 'civitai.red';
    }
    for (const tag of item.tags) {
      const key = tag.toLowerCase();
      if (!seenTagKeys.has(key)) {
        seenTagKeys.add(key);
        mergedTags.push(tag);
      }
    }
    for (const cand of item.candidateModelVersions) {
      if (!seenVersionIds.has(cand.modelVersionId)) {
        seenVersionIds.add(cand.modelVersionId);
        mergedCandidates.push(cand);
      }
    }
    for (const resName of item.embeddedResourceNames) {
      embeddedResourcesSet.add(resName);
    }
  }

  const eligibleCount = orderedEligible.length;
  const exceedsLimit = eligibleCount > CIVITAI_MAX_POST_IMAGES;

  let disabledReason: string | null = null;
  if (!options.hasCivitaiKey) {
    disabledReason = 'CIVITAI_API_KEY is not configured in the server environment.';
  } else if (exceedsLimit) {
    disabledReason = `Civitai posts allow up to ${CIVITAI_MAX_POST_IMAGES} images (${eligibleCount} eligible in this stack).`;
  } else if (eligibleCount === 1) {
    disabledReason = 'Requires at least 2 eligible images in this stack (1 eligible after exclusions).';
  } else if (eligibleCount === 0) {
    disabledReason = 'No eligible images remain in this stack after exclusions.';
  }

  return {
    seriesId: chosenSeriesId,
    eligible: options.hasCivitaiKey && eligibleCount >= 2 && !exceedsLimit,
    exceedsLimit,
    disabledReason,
    totalMembers: seenImageIds.size,
    eligibleCount,
    posterImageId: posterItem?.imageId ?? null,
    representativeImageId: representativeItem?.imageId ?? null,
    prefilledTitle: representativeItem?.prefilledTitle ?? '',
    prefilledDescription: representativeItem?.prefilledDescription ?? '',
    prefilledTags: mergedTags,
    recommendedModelVersionId:
      representativeItem?.recommendedModelVersionId ?? mergedCandidates[0]?.modelVersionId ?? null,
    recommendedDomain,
    candidateModelVersions: mergedCandidates,
    embeddedResourceNames: Array.from(embeddedResourcesSet),
    eligibleItems: orderedEligible,
    excludedItems,
  };
}
