import { db } from '../db.ts';
import type {
  ImageRecord,
  ImageSeriesItem,
  QuickGenChatMessage,
} from '../../shared/types.ts';

/**
 * Safely parses a JSON-serialized QuickGenChatMessage array stored on an iteration step.
 */
export function parseChatSnapshot(raw: string | null | undefined): QuickGenChatMessage[] {
  if (!raw || !raw.trim()) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (m) =>
          m &&
          (m.role === 'user' || m.role === 'assistant') &&
          typeof m.content === 'string'
      )
      .map((m, idx) => ({
        id: typeof m.id === 'string' && m.id ? m.id : `msg-${idx}`,
        role: m.role as 'user' | 'assistant',
        content: m.content,
        proposedPrompt: typeof m.proposedPrompt === 'string' ? m.proposedPrompt : null,
      }));
  } catch {
    return [];
  }
}

/**
 * Builds a seed conversation snapshot from a standalone image's positive prompt
 * when a non-conversation image becomes step 0 of a new series.
 */
function buildSeedSnapshotFromImage(imageId: number): string | null {
  const row = db
    .prepare('SELECT positive_prompt FROM image_metadata WHERE image_id = ?')
    .get(imageId) as { positive_prompt?: string | null } | undefined;
  const prompt = (row?.positive_prompt || '').trim();
  if (!prompt) return null;
  const seedMessages: QuickGenChatMessage[] = [
    {
      id: `seed-${imageId}`,
      role: 'assistant',
      content: 'Starting prompt from original image:',
      proposedPrompt: prompt,
    },
  ];
  return JSON.stringify(seedMessages);
}

/**
 * Attaches a newly generated image to an existing or new series.
 * - If continuing from the latest image of `seriesId`, appends to `seriesId`.
 * - If branching from an image in the middle of `seriesId`, creates a new series
 *   copying the lineage up to `branchFromImageId` (with its edit history) plus the new image.
 * - If starting from a standalone image (`branchFromImageId` without `seriesId`),
 *   creates a new series with `[branchFromImageId, imageId]`.
 * - If starting a fresh conversation (`chatSnapshotJson` present), creates a 1-item series.
 */
export function attachGeneratedImageToSeries(params: {
  imageId: number;
  seriesId?: number | null;
  branchFromImageId?: number | null;
  chatSnapshotJson?: string | null;
}): number | null {
  const { imageId, seriesId, branchFromImageId, chatSnapshotJson } = params;
  if (!imageId || imageId <= 0) return null;

  const tx = db.transaction((): number | null => {
    // 1. Resolve seriesId if branchFromImageId was provided without an explicit seriesId
    let targetSeriesId = seriesId && seriesId > 0 ? Number(seriesId) : null;
    const sourceId =
      branchFromImageId && branchFromImageId > 0 && branchFromImageId !== imageId
        ? Number(branchFromImageId)
        : null;

    if (!targetSeriesId && sourceId) {
      // Check if sourceId already belongs to a series (prefer one where it is the latest step)
      const candidates = db
        .prepare(
          `SELECT isi.series_id, isi.step_order,
                  (SELECT MAX(step_order) FROM image_series_items WHERE series_id = isi.series_id) AS max_step
           FROM image_series_items isi
           WHERE isi.image_id = ?
           ORDER BY (isi.step_order = max_step) DESC, isi.series_id DESC`
        )
        .all(sourceId) as { series_id: number; step_order: number; max_step: number }[];
      if (candidates.length > 0) {
        targetSeriesId = candidates[0].series_id;
      }
    }

    // Case 1: Target series exists
    if (targetSeriesId) {
      const existingItems = db
        .prepare(
          `SELECT series_id, image_id, step_order, chat_snapshot_json
           FROM image_series_items
           WHERE series_id = ?
           ORDER BY step_order ASC`
        )
        .all(targetSeriesId) as {
        series_id: number;
        image_id: number;
        step_order: number;
        chat_snapshot_json: string | null;
      }[];

      if (existingItems.length > 0) {
        const branchIdx = sourceId
          ? existingItems.findIndex((it) => it.image_id === sourceId)
          : existingItems.length - 1;

        // Branching from the middle of a stack: split off a new series with history up to branchIdx
        if (branchIdx >= 0 && branchIdx < existingItems.length - 1) {
          const newSeriesInfo = db
            .prepare(`INSERT INTO image_series (poster_image_id) VALUES (NULL)`)
            .run();
          const newSeriesId = Number(newSeriesInfo.lastInsertRowid);

          const insertItem = db.prepare(
            `INSERT INTO image_series_items (series_id, image_id, step_order, chat_snapshot_json)
             VALUES (?, ?, ?, ?)`
          );
          for (let i = 0; i <= branchIdx; i++) {
            const ancestor = existingItems[i];
            insertItem.run(
              newSeriesId,
              ancestor.image_id,
              i,
              ancestor.chat_snapshot_json ?? null
            );
          }
          insertItem.run(newSeriesId, imageId, branchIdx + 1, chatSnapshotJson ?? null);
          return newSeriesId;
        }

        // Continuing from the latest image in the series: append to the same series
        const maxStep = existingItems[existingItems.length - 1].step_order;
        db.prepare(
          `INSERT OR REPLACE INTO image_series_items (series_id, image_id, step_order, chat_snapshot_json)
           VALUES (?, ?, ?, ?)`
        ).run(targetSeriesId, imageId, maxStep + 1, chatSnapshotJson ?? null);

        db.prepare(`UPDATE image_series SET updated_at = datetime('now') WHERE id = ?`).run(
          targetSeriesId
        );
        return targetSeriesId;
      }
    }

    // Case 2: Starting a series from a standalone image (via Conversation or Upscale)
    if (sourceId) {
      const favRow = db
        .prepare(
          `SELECT r.is_favorite
           FROM images i
           LEFT JOIN ratings r ON r.content_hash = i.content_hash
           WHERE i.id = ?`
        )
        .get(sourceId) as { is_favorite?: number } | undefined;
      const initialPosterId = favRow?.is_favorite ? sourceId : null;

      const newSeriesInfo = db
        .prepare(`INSERT INTO image_series (poster_image_id) VALUES (?)`)
        .run(initialPosterId);
      const newSeriesId = Number(newSeriesInfo.lastInsertRowid);

      const seedSnapshot = buildSeedSnapshotFromImage(sourceId);
      const insertItem = db.prepare(
        `INSERT OR REPLACE INTO image_series_items (series_id, image_id, step_order, chat_snapshot_json)
         VALUES (?, ?, ?, ?)`
      );
      insertItem.run(newSeriesId, sourceId, 0, seedSnapshot);
      insertItem.run(newSeriesId, imageId, 1, chatSnapshotJson ?? seedSnapshot);
      return newSeriesId;
    }

    // Case 3: Brand new Conversation image with no prior source image
    if (chatSnapshotJson && chatSnapshotJson.trim()) {
      const newSeriesInfo = db
        .prepare(`INSERT INTO image_series (poster_image_id) VALUES (NULL)`)
        .run();
      const newSeriesId = Number(newSeriesInfo.lastInsertRowid);
      db.prepare(
        `INSERT OR REPLACE INTO image_series_items (series_id, image_id, step_order, chat_snapshot_json)
         VALUES (?, ?, 0, ?)`
      ).run(newSeriesId, imageId, chatSnapshotJson);
      return newSeriesId;
    }

    return null;
  });

  return tx();
}

/**
 * Automatically stacks an upscaled image onto its source image's series
 * (or creates a new 2-image series `[sourceImageId, derivedImageId]` if standalone).
 */
export function attachUpscaledImageToSeries(
  sourceImageId: number,
  derivedImageId: number
): number | null {
  if (!sourceImageId || !derivedImageId || sourceImageId === derivedImageId) return null;

  // Carry forward the source image's chat snapshot if it has one
  const existingRow = db
    .prepare(
      `SELECT series_id, step_order, chat_snapshot_json,
              (SELECT MAX(step_order) FROM image_series_items WHERE series_id = isi.series_id) AS max_step
       FROM image_series_items isi
       WHERE isi.image_id = ?
       ORDER BY (isi.step_order = max_step) DESC, isi.series_id DESC
       LIMIT 1`
    )
    .get(sourceImageId) as
    | { series_id: number; step_order: number; chat_snapshot_json: string | null }
    | undefined;

  return attachGeneratedImageToSeries({
    imageId: derivedImageId,
    seriesId: existingRow?.series_id ?? null,
    branchFromImageId: sourceImageId,
    chatSnapshotJson: existingRow?.chat_snapshot_json ?? null,
  });
}

/**
 * Enforces that within any series containing `imageId`, only ONE image can be hearted (`is_favorite = 1`).
 * That hearted image becomes the series `poster_image_id`.
 */
export function setExclusiveSeriesFavorite(imageId: number, isFavorite: boolean): void {
  const seriesRows = db
    .prepare(`SELECT DISTINCT series_id FROM image_series_items WHERE image_id = ?`)
    .all(imageId) as { series_id: number }[];

  if (seriesRows.length === 0) return;

  const tx = db.transaction(() => {
    if (isFavorite) {
      for (const { series_id } of seriesRows) {
        db.prepare(
          `UPDATE image_series SET poster_image_id = ?, updated_at = datetime('now') WHERE id = ?`
        ).run(imageId, series_id);

        const siblingRows = db
          .prepare(
            `SELECT i.id, i.content_hash
             FROM image_series_items isi
             JOIN images i ON i.id = isi.image_id
             WHERE isi.series_id = ? AND isi.image_id != ?`
          )
          .all(series_id, imageId) as { id: number; content_hash: string }[];

        for (const sib of siblingRows) {
          db.prepare(
            `UPDATE ratings SET is_favorite = 0, favorited_at = NULL WHERE content_hash = ?`
          ).run(sib.content_hash);
        }
      }
    } else {
      db.prepare(
        `UPDATE image_series SET poster_image_id = NULL, updated_at = datetime('now') WHERE poster_image_id = ?`
      ).run(imageId);
    }
  });

  tx();
}

interface RawSeriesMemberRow {
  series_id: number;
  poster_image_id: number | null;
  image_id: number;
  step_order: number;
  chat_snapshot_json: string | null;
  item_created_at: string;
  filename: string;
  content_hash: string;
  width: number;
  height: number;
  is_missing: number;
  is_favorite: number;
  rating: number;
}

function buildSeriesItemRecord(r: RawSeriesMemberRow): ImageSeriesItem {
  const hashParam = r.content_hash ? `?h=${String(r.content_hash).slice(0, 12)}` : '';
  return {
    seriesId: r.series_id,
    imageId: r.image_id,
    stepOrder: r.step_order,
    filename: r.filename,
    thumbnailUrl: `/api/images/${r.image_id}/thumbnail${hashParam}`,
    originalUrl: `/api/images/${r.image_id}/file`,
    width: r.width,
    height: r.height,
    isFavorite: Boolean(r.is_favorite),
    rating: Number(r.rating || 0),
    createdAt: r.item_created_at,
    chatSnapshot: parseChatSnapshot(r.chat_snapshot_json),
  };
}

/**
 * Enriches a single hydrated ImageRecord (for GET /api/images/:id) with its series items and chat snapshot.
 */
export function enrichSingleImageWithSeries(
  img: ImageRecord,
  preferredSeriesId?: number | null
): ImageRecord {
  const memberships = db
    .prepare(
      `SELECT isi.series_id, isi.step_order, s.poster_image_id,
              (SELECT MAX(step_order) FROM image_series_items WHERE series_id = isi.series_id) AS max_step
       FROM image_series_items isi
       JOIN image_series s ON s.id = isi.series_id
       WHERE isi.image_id = ?
       ORDER BY (isi.series_id = COALESCE(?, -1)) DESC,
                (s.poster_image_id = ?) DESC,
                (isi.step_order = max_step) DESC,
                isi.series_id DESC`
    )
    .all(img.id, preferredSeriesId ?? null, img.id) as {
    series_id: number;
    step_order: number;
    poster_image_id: number | null;
    max_step: number;
  }[];

  if (memberships.length === 0) {
    return {
      ...img,
      seriesId: null,
      seriesCount: 1,
      seriesItems: [],
      chatSnapshot: [],
    };
  }

  const chosenSeriesId = memberships[0].series_id;
  const memberRows = db
    .prepare(
      `SELECT
         isi.series_id, s.poster_image_id, isi.image_id, isi.step_order,
         isi.chat_snapshot_json, isi.created_at AS item_created_at,
         i.filename, i.content_hash, i.width, i.height, i.is_missing,
         COALESCE(r.is_favorite, 0) AS is_favorite,
         COALESCE(r.rating, 0) AS rating
       FROM image_series_items isi
       JOIN image_series s ON s.id = isi.series_id
       JOIN images i ON i.id = isi.image_id
       LEFT JOIN ratings r ON r.content_hash = i.content_hash
       WHERE isi.series_id = ? AND i.is_missing = 0
       ORDER BY isi.step_order ASC`
    )
    .all(chosenSeriesId) as RawSeriesMemberRow[];

  const seriesItems = memberRows.map(buildSeriesItemRecord);
  const matchingItem = seriesItems.find((si) => si.imageId === img.id);

  return {
    ...img,
    seriesId: chosenSeriesId,
    seriesCount: seriesItems.length,
    seriesItems,
    chatSnapshot: matchingItem?.chatSnapshot || [],
  };
}

/**
 * Collapses image series in a gallery pool so that each series is represented by a single card:
 * - The hearted (`isFavorite`) / `poster_image_id` member if one exists in the active pool
 * - Otherwise the most recent (`MAX(step_order)`) member in the active pool.
 * Standalone images not in any series are returned as-is.
 */
export function collapseSeriesInGalleryPool(pool: ImageRecord[]): ImageRecord[] {
  if (pool.length === 0) return [];

  const allSeriesMemberRows = db
    .prepare(
      `SELECT
         isi.series_id, s.poster_image_id, isi.image_id, isi.step_order,
         isi.chat_snapshot_json, isi.created_at AS item_created_at,
         i.filename, i.content_hash, i.width, i.height, i.is_missing,
         COALESCE(r.is_favorite, 0) AS is_favorite,
         COALESCE(r.rating, 0) AS rating
       FROM image_series_items isi
       JOIN image_series s ON s.id = isi.series_id
       JOIN images i ON i.id = isi.image_id
       LEFT JOIN ratings r ON r.content_hash = i.content_hash
       WHERE i.is_missing = 0
       ORDER BY isi.series_id ASC, isi.step_order ASC`
    )
    .all() as RawSeriesMemberRow[];

  if (allSeriesMemberRows.length === 0) {
    return pool;
  }

  const poolById = new Map<number, ImageRecord>();
  for (const img of pool) {
    poolById.set(img.id, img);
  }

  const membersBySeries = new Map<number, RawSeriesMemberRow[]>();
  const imageIdsInAnySeries = new Set<number>();

  for (const row of allSeriesMemberRows) {
    imageIdsInAnySeries.add(row.image_id);
    const list = membersBySeries.get(row.series_id);
    if (list) list.push(row);
    else membersBySeries.set(row.series_id, [row]);
  }

  const result: ImageRecord[] = [];

  // 1. Add all standalone images (not part of any series)
  for (const img of pool) {
    if (!imageIdsInAnySeries.has(img.id)) {
      result.push({
        ...img,
        seriesId: null,
        seriesCount: 1,
      });
    }
  }

  // 2. For each series, select its single representative card from the visible pool
  for (const [seriesId, members] of membersBySeries.entries()) {
    const visibleMembers = members.filter((m) => poolById.has(m.image_id));
    if (visibleMembers.length === 0) continue;

    const posterId = members[0]?.poster_image_id ?? null;
    const posterMember =
      (posterId
        ? visibleMembers.find((m) => m.image_id === posterId && Boolean(m.is_favorite))
        : undefined) ||
      [...visibleMembers].reverse().find((m) => Boolean(m.is_favorite)) ||
      visibleMembers[visibleMembers.length - 1];

    const baseRecord = poolById.get(posterMember.image_id);
    if (!baseRecord) continue;

    const seriesItems = members.map(buildSeriesItemRecord);
    const repItem = seriesItems.find((si) => si.imageId === posterMember.image_id);

    // Use the latest member's fileMtime when sorting by newest if the poster is an older hearted step,
    // or keep baseRecord fields while attaching full seriesItems
    result.push({
      ...baseRecord,
      seriesId,
      seriesCount: seriesItems.length,
      seriesItems,
      chatSnapshot: repItem?.chatSnapshot || [],
    });
  }

  return result;
}
