import { db } from '../../db.ts';

/**
 * Determines whether a queued job appends to an existing series/image or branches off into a new card.
 * Excludes `outputImageId` when evaluating existing steps so an appended completion never flashes as a branch split.
 */
export function resolveSeriesTargetForJob(
  explicitSeriesId: number | null,
  branchFromImageId: number | null,
  outputImageId: number | null = null,
  isUpscale = false
): { targetSeriesId: number | null; targetImageId: number | null; isBranchSplit: boolean } {
  let targetSeriesId = explicitSeriesId && explicitSeriesId > 0 ? Number(explicitSeriesId) : null;
  const sourceId = branchFromImageId && branchFromImageId > 0 ? Number(branchFromImageId) : null;

  if (!targetSeriesId && !sourceId) {
    return { targetSeriesId: null, targetImageId: null, isBranchSplit: false };
  }

  if (!targetSeriesId && sourceId) {
    const candidate = db
      .prepare(
        `SELECT isi.series_id,
                (SELECT MAX(step_order) FROM image_series_items WHERE series_id = isi.series_id) AS max_step
         FROM image_series_items isi
         WHERE isi.image_id = ?
         ORDER BY (isi.step_order = max_step) DESC, isi.series_id DESC
         LIMIT 1`
      )
      .get(sourceId) as { series_id: number } | undefined;
    if (candidate) {
      targetSeriesId = candidate.series_id;
    }
  }

  if (targetSeriesId) {
    if (isUpscale) {
      return {
        targetSeriesId,
        targetImageId: sourceId,
        isBranchSplit: false,
      };
    }

    const existingItems = (
      db
        .prepare(`SELECT image_id FROM image_series_items WHERE series_id = ? ORDER BY step_order ASC`)
        .all(targetSeriesId) as { image_id: number }[]
    ).filter((it) => !outputImageId || it.image_id !== Number(outputImageId));

    if (existingItems.length > 0) {
      const branchIdx = sourceId
        ? existingItems.findIndex((it) => it.image_id === sourceId)
        : existingItems.length - 1;
      const isMiddleBranch = branchIdx >= 0 && branchIdx < existingItems.length - 1;
      if (isMiddleBranch) {
        return {
          targetSeriesId: null,
          targetImageId: sourceId,
          isBranchSplit: true,
        };
      }
      return {
        targetSeriesId,
        targetImageId: sourceId,
        isBranchSplit: false,
      };
    }
  }

  return {
    targetSeriesId: null,
    targetImageId: sourceId,
    isBranchSplit: false,
  };
}
