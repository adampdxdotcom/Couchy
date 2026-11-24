import { db } from '../../db.ts';
import { appConfig } from '../../config.ts';
import { logger } from '../../logger.ts';
import { notifyWorkspaceDataChanged } from '../comfyuiLiveMonitor.ts';
import { getCivitaiHeaders, type CivitaiDomain } from './civitaiHttpAndParse.ts';
import {
  fetchPostCommentsViaMcp,
  type ListCommentsFn,
} from './civitaiCommentsService.ts';
import {
  autoMatchOwnCivitaiUploads,
  syncLinkedModelsCivitaiStats,
} from './civitaiCreatorModelsService.ts';
import type {
  CivitaiCommentRecord,
  CivitaiDraftRecord,
  CivitaiPostImageStats,
  CivitaiReactionBreakdown,
  CivitaiShareSummary,
} from '../../../shared/apiTypes.ts';

const DEFAULT_BACKGROUND_INTERVAL_MS = 15 * 60 * 1000;
const DEFAULT_INSPECTOR_MIN_INTERVAL_MS = 2 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 8000;

let activitySyncTimer: ReturnType<typeof setInterval> | null = null;
let activityStartupTimer: ReturnType<typeof setTimeout> | null = null;
let isSyncRunning = false;

export interface CivitaiActivitySyncDeps {
  fetchFn?: typeof fetch;
  listCommentsFn?: ListCommentsFn;
}

function parseSqliteUtcMs(raw: string | null | undefined): number {
  if (!raw || !String(raw).trim()) return 0;
  const s = String(raw).trim();
  const normalized = s.includes('T') ? (s.endsWith('Z') ? s : `${s}Z`) : `${s.replace(' ', 'T')}Z`;
  const ms = Date.parse(normalized);
  return Number.isFinite(ms) ? ms : 0;
}

function inferDomainFromDraftUrl(url: string | null | undefined): CivitaiDomain {
  return String(url || '').toLowerCase().includes('civitai.red') ? 'civitai.red' : 'civitai.com';
}

function safeParseJsonArray<T>(raw: unknown): T[] {
  if (typeof raw !== 'string' || !raw.trim()) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch {
    return [];
  }
}

/**
 * Maps a raw `image_civitai_drafts` SQLite row into a typed `CivitaiDraftRecord`.
 */
export function mapDraftRowToRecord(row: any): CivitaiDraftRecord {
  const status = row.status === 'published' ? 'published' : 'draft';
  const heartCount = Math.max(0, Number(row.heart_count || 0));
  const likeCount = Math.max(0, Number(row.like_count || 0));
  const laughCount = Math.max(0, Number(row.laugh_count || 0));
  const cryCount = Math.max(0, Number(row.cry_count || 0));
  const reactionBreakdown: CivitaiReactionBreakdown = {
    heartCount,
    likeCount,
    laughCount,
    cryCount,
  };
  const reactionCount = Math.max(0, Number(row.reaction_count || 0));
  const commentCount = Math.max(0, Number(row.comment_count || 0));
  const seenReactionCount = Math.max(0, Number(row.seen_reaction_count || 0));
  const seenCommentCount = Math.max(0, Number(row.seen_comment_count || 0));
  const hasUnseenActivity =
    status === 'published' &&
    (reactionCount > seenReactionCount || commentCount > seenCommentCount);

  return {
    id: Number(row.id),
    civitaiPostId: Number(row.civitai_post_id),
    draftUrl: String(row.draft_url || ''),
    title: String(row.title || ''),
    uploadMode: row.upload_mode === 'jpeg_exif' ? 'jpeg_exif' : 'original_png',
    modelVersionId: row.model_version_id ?? null,
    status,
    civitaiImageId: row.civitai_image_id ? Number(row.civitai_image_id) : null,
    publishedUrl: row.published_url ? String(row.published_url) : null,
    reactionCount,
    reactionBreakdown,
    commentCount,
    seenReactionCount,
    seenCommentCount,
    hasUnseenActivity,
    statsSyncedAt: row.stats_synced_at ? String(row.stats_synced_at) : null,
    commentsSyncedAt: row.comments_synced_at ? String(row.comments_synced_at) : null,
    postImages: safeParseJsonArray<CivitaiPostImageStats>(row.post_images_json),
    comments: safeParseJsonArray<CivitaiCommentRecord>(row.comments_json),
    createdAt: String(row.created_at || ''),
  };
}

/**
 * Aggregates one or more `image_civitai_drafts` rows for an image into a compact gallery/inspector summary.
 */
export function summarizeCivitaiDraftRows(rows: any[]): CivitaiShareSummary | null {
  if (!rows || rows.length === 0) return null;

  const sorted = [...rows].sort((a, b) => Number(b.id) - Number(a.id));
  const publishedRows = sorted.filter((r) => r.status === 'published');
  const status = publishedRows.length > 0 ? 'published' : 'draft';

  // Deduplicate by civitai_post_id so re-logged rows for the same post do not double-count stats
  const seenPostIds = new Set<number>();
  let reactionCount = 0;
  let commentCount = 0;
  let heartCount = 0;
  let likeCount = 0;
  let laughCount = 0;
  let cryCount = 0;
  let hasUnseenActivity = false;

  for (const r of publishedRows) {
    const pid = Number(r.civitai_post_id);
    const rCnt = Math.max(0, Number(r.reaction_count || 0));
    const cCnt = Math.max(0, Number(r.comment_count || 0));
    const seenR = Math.max(0, Number(r.seen_reaction_count || 0));
    const seenC = Math.max(0, Number(r.seen_comment_count || 0));
    if (rCnt > seenR || cCnt > seenC) {
      hasUnseenActivity = true;
    }
    if (!seenPostIds.has(pid)) {
      seenPostIds.add(pid);
      reactionCount += rCnt;
      commentCount += cCnt;
      heartCount += Math.max(0, Number(r.heart_count || 0));
      likeCount += Math.max(0, Number(r.like_count || 0));
      laughCount += Math.max(0, Number(r.laugh_count || 0));
      cryCount += Math.max(0, Number(r.cry_count || 0));
    }
  }

  const primaryRow = publishedRows[0] || sorted[0];
  const primaryUrl = String(primaryRow.published_url || primaryRow.draft_url || '');

  return {
    status,
    totalDrafts: sorted.length,
    publishedCount: publishedRows.length,
    reactionCount,
    reactionBreakdown: { heartCount, likeCount, laughCount, cryCount },
    commentCount,
    hasActivity: status === 'published' && (reactionCount > 0 || commentCount > 0),
    hasUnseenActivity,
    primaryUrl,
  };
}

/**
 * Extracts total reactions, detailed reaction breakdown, per-image stats, and comment count
 * from Civitai `/api/v1/images?postId=...` items.
 */
export function extractCivitaiPostStats(
  items: any[],
  domain: CivitaiDomain,
  postId: number
): {
  civitaiImageId: number | null;
  publishedUrl: string;
  reactionCount: number;
  reactionBreakdown: CivitaiReactionBreakdown;
  commentCount: number;
  postImages: CivitaiPostImageStats[];
} {
  const sortedItems = [...items].sort((a, b) => {
    const idxA = typeof a?.index === 'number' ? a.index : null;
    const idxB = typeof b?.index === 'number' ? b.index : null;
    if (idxA !== null && idxB !== null && idxA !== idxB) return idxA - idxB;
    return Number(a?.id || 0) - Number(b?.id || 0);
  });

  let heartCount = 0;
  let likeCount = 0;
  let laughCount = 0;
  let cryCount = 0;
  let commentCount = 0;
  const postImages: CivitaiPostImageStats[] = [];

  sortedItems.forEach((item, idx) => {
    const stats = item?.stats || {};
    const itemHeart = Math.max(0, Number(stats.heartCount || 0));
    const itemLike = Math.max(0, Number(stats.likeCount || 0));
    const itemLaugh = Math.max(0, Number(stats.laughCount || 0));
    const itemCry = Math.max(0, Number(stats.cryCount || 0));
    const itemComment = Math.max(0, Number(stats.commentCount || 0));

    heartCount += itemHeart;
    likeCount += itemLike;
    laughCount += itemLaugh;
    cryCount += itemCry;
    commentCount += itemComment;

    const itemId = Number(item?.id || 0);
    if (Number.isInteger(itemId) && itemId > 0) {
      postImages.push({
        civitaiImageId: itemId,
        index: typeof item?.index === 'number' ? item.index : idx,
        localImageId: null,
        url: `https://${domain}/images/${itemId}`,
        heartCount: itemHeart,
        likeCount: itemLike,
        laughCount: itemLaugh,
        cryCount: itemCry,
        commentCount: itemComment,
      });
    }
  });

  const firstId = postImages[0]?.civitaiImageId ?? null;
  const reactionCount = heartCount + likeCount + laughCount + cryCount;
  const publishedUrl = firstId
    ? `https://${domain}/images/${firstId}`
    : `https://${domain}/posts/${postId}`;

  return {
    civitaiImageId: firstId,
    publishedUrl,
    reactionCount,
    reactionBreakdown: { heartCount, likeCount, laughCount, cryCount },
    commentCount,
    postImages,
  };
}

async function queryPostStatsAcrossDomains(
  postId: number,
  preferredDomain: CivitaiDomain,
  fetchFn: typeof fetch
): Promise<{
  domain: CivitaiDomain;
  civitaiImageId: number | null;
  publishedUrl: string;
  reactionCount: number;
  reactionBreakdown: CivitaiReactionBreakdown;
  commentCount: number;
  postImages: CivitaiPostImageStats[];
} | null> {
  const domains: CivitaiDomain[] =
    preferredDomain === 'civitai.red'
      ? ['civitai.red', 'civitai.com']
      : ['civitai.com', 'civitai.red'];
  const headers = getCivitaiHeaders();

  for (const domain of domains) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
      const res = await fetchFn(
        `https://${domain}/api/v1/images?postId=${encodeURIComponent(String(postId))}&nsfw=X&limit=20`,
        { headers, signal: controller.signal }
      );
      clearTimeout(timer);
      if (!res.ok) continue;

      const data = (await res.json()) as { items?: any[] };
      const items = Array.isArray(data?.items) ? data.items : [];
      if (items.length > 0) {
        return {
          domain,
          ...extractCivitaiPostStats(items, domain, postId),
        };
      }
    } catch {
      // try alternate domain or leave unchanged on transient failure
    }
  }
  return null;
}

/**
 * Syncs live publish status, reaction breakdowns, per-image post mappings, and optionally MCP comments
 * for a single `civitai_post_id` across matching draft rows in SQLite.
 */
async function syncPostIdStats(
  postId: number,
  sampleDraftRow: any,
  deps?: CivitaiActivitySyncDeps,
  options?: { syncComments?: boolean }
): Promise<boolean> {
  const fetchFn = deps?.fetchFn || fetch;
  const preferredDomain = inferDomainFromDraftUrl(
    sampleDraftRow.published_url || sampleDraftRow.draft_url
  );

  const live = await queryPostStatsAcrossDomains(postId, preferredDomain, fetchFn);
  if (!live) {
    db.prepare(
      `UPDATE image_civitai_drafts
       SET stats_synced_at = datetime('now')
       WHERE civitai_post_id = ?`
    ).run(postId);
    return false;
  }

  // Match Civitai post images to local Couchy draft rows in upload order (id ASC)
  const draftRowsForPost = db
    .prepare(
      `SELECT id, image_id
       FROM image_civitai_drafts
       WHERE civitai_post_id = ?
       ORDER BY id ASC`
    )
    .all(postId) as Array<{ id: number; image_id: number }>;

  const mappedPostImages = live.postImages.map((pi, idx) => {
    let localImageId: number | null = null;
    if (draftRowsForPost.length === 1 && idx === 0) {
      localImageId = Number(draftRowsForPost[0].image_id);
    } else if (live.postImages.length === draftRowsForPost.length) {
      localImageId = Number(draftRowsForPost[idx].image_id);
    }
    return { ...pi, localImageId };
  });

  const prevStatus = sampleDraftRow.status === 'published' ? 'published' : 'draft';
  const prevImgId = sampleDraftRow.civitai_image_id ? Number(sampleDraftRow.civitai_image_id) : null;
  const prevReactions = Number(sampleDraftRow.reaction_count || 0);
  const prevComments = Number(sampleDraftRow.comment_count || 0);
  const prevHeart = Number(sampleDraftRow.heart_count || 0);
  const prevLike = Number(sampleDraftRow.like_count || 0);
  const prevLaugh = Number(sampleDraftRow.laugh_count || 0);
  const prevCry = Number(sampleDraftRow.cry_count || 0);

  let nextCommentCount = live.commentCount;
  let commentsJsonToSave: string | null = null;
  let shouldUpdateComments = false;

  const canQueryComments = Boolean(deps?.listCommentsFn || appConfig.civitaiApiKey?.trim());
  const needsCommentsSync =
    Boolean(options?.syncComments) &&
    canQueryComments &&
    (live.commentCount > 0 ||
      live.commentCount !== prevComments ||
      !sampleDraftRow.comments_synced_at);

  if (needsCommentsSync) {
    try {
      const commentResult = await fetchPostCommentsViaMcp({
        postId,
        domain: live.domain,
        postImages: mappedPostImages,
        apiKey: appConfig.civitaiApiKey,
        fetchFn,
        listCommentsFn: deps?.listCommentsFn,
      });
      if (commentResult.ok) {
        shouldUpdateComments = true;
        commentsJsonToSave = JSON.stringify(commentResult.comments);
        nextCommentCount = Math.max(live.commentCount, commentResult.comments.length);
      }
    } catch {
      // Preserve existing cached comments if MCP query fails
    }
  }

  const changed =
    prevStatus !== 'published' ||
    prevImgId !== live.civitaiImageId ||
    prevReactions !== live.reactionCount ||
    prevComments !== nextCommentCount ||
    prevHeart !== live.reactionBreakdown.heartCount ||
    prevLike !== live.reactionBreakdown.likeCount ||
    prevLaugh !== live.reactionBreakdown.laughCount ||
    prevCry !== live.reactionBreakdown.cryCount ||
    (shouldUpdateComments && commentsJsonToSave !== (sampleDraftRow.comments_json || null));

  const postImagesJson = JSON.stringify(mappedPostImages);

  const updateRowStmt = db.prepare(
    `UPDATE image_civitai_drafts
     SET status = 'published',
         civitai_image_id = COALESCE(?, civitai_image_id),
         published_url = ?,
         reaction_count = ?,
         heart_count = ?,
         like_count = ?,
         laugh_count = ?,
         cry_count = ?,
         comment_count = ?,
         post_images_json = ?,
         comments_json = CASE WHEN ? = 1 THEN ? ELSE comments_json END,
         comments_synced_at = CASE WHEN ? = 1 THEN datetime('now') ELSE comments_synced_at END,
         stats_synced_at = datetime('now')
     WHERE id = ?`
  );

  const tx = db.transaction(() => {
    for (let i = 0; i < draftRowsForPost.length; i++) {
      const row = draftRowsForPost[i];
      const matched = mappedPostImages.find((pi) => pi.localImageId === Number(row.image_id));
      const rowCivitaiImageId = matched?.civitaiImageId ?? live.civitaiImageId;
      const rowPublishedUrl = matched?.url ?? live.publishedUrl;

      updateRowStmt.run(
        rowCivitaiImageId,
        rowPublishedUrl,
        live.reactionCount,
        live.reactionBreakdown.heartCount,
        live.reactionBreakdown.likeCount,
        live.reactionBreakdown.laughCount,
        live.reactionBreakdown.cryCount,
        nextCommentCount,
        postImagesJson,
        shouldUpdateComments ? 1 : 0,
        commentsJsonToSave,
        shouldUpdateComments ? 1 : 0,
        row.id
      );
    }
  });
  tx();

  return changed;
}

/**
 * Refreshes Civitai publish status, reaction breakdown, and MCP comment threads for a specific image's
 * drafts when opening the Image Inspector (throttled per-draft by `minIntervalMs`).
 */
export async function syncCivitaiActivityForImage(
  imageId: number,
  options?: { minIntervalMs?: number; syncComments?: boolean; deps?: CivitaiActivitySyncDeps }
): Promise<{ syncedPosts: number; changed: boolean }> {
  const imageRow = db
    .prepare('SELECT id, content_hash FROM images WHERE id = ?')
    .get(imageId) as { id: number; content_hash: string } | undefined;
  if (!imageRow) return { syncedPosts: 0, changed: false };

  const draftRows = db
    .prepare(
      `SELECT * FROM image_civitai_drafts
       WHERE image_id = ? OR image_content_hash = ?
       ORDER BY id DESC`
    )
    .all(imageId, imageRow.content_hash) as any[];

  if (draftRows.length === 0) return { syncedPosts: 0, changed: false };

  const minIntervalMs = options?.minIntervalMs ?? DEFAULT_INSPECTOR_MIN_INTERVAL_MS;
  const syncComments = options?.syncComments ?? true;
  const nowMs = Date.now();
  const seenPosts = new Set<number>();
  let syncedPosts = 0;
  let anyChanged = false;

  for (const row of draftRows) {
    const postId = Number(row.civitai_post_id);
    if (!postId || seenPosts.has(postId)) continue;
    seenPosts.add(postId);

    const needsBreakdownBackfill =
      row.status === 'published' &&
      Number(row.reaction_count || 0) > 0 &&
      Number(row.heart_count || 0) +
        Number(row.like_count || 0) +
        Number(row.laugh_count || 0) +
        Number(row.cry_count || 0) ===
        0;
    const needsCommentBackfill =
      syncComments &&
      row.status === 'published' &&
      (!row.comments_synced_at || (Number(row.comment_count || 0) > 0 && !row.comments_json));

    const lastSyncMs = parseSqliteUtcMs(row.stats_synced_at);
    if (
      !needsBreakdownBackfill &&
      !needsCommentBackfill &&
      minIntervalMs > 0 &&
      lastSyncMs > 0 &&
      nowMs - lastSyncMs < minIntervalMs
    ) {
      continue;
    }

    const changed = await syncPostIdStats(postId, row, options?.deps, { syncComments });
    syncedPosts += 1;
    if (changed) anyChanged = true;
  }

  if (anyChanged) {
    notifyWorkspaceDataChanged();
  }

  return { syncedPosts, changed: anyChanged };
}

/**
 * Marks all current Civitai reaction and comment counts on an image's shared posts as seen.
 */
export function markCivitaiActivitySeenForImage(imageId: number): boolean {
  const imageRow = db
    .prepare('SELECT id, content_hash FROM images WHERE id = ?')
    .get(imageId) as { id: number; content_hash: string } | undefined;
  if (!imageRow) return false;

  const info = db
    .prepare(
      `UPDATE image_civitai_drafts
       SET seen_reaction_count = MAX(seen_reaction_count, reaction_count),
           seen_comment_count = MAX(seen_comment_count, comment_count)
       WHERE (image_id = ? OR image_content_hash = ?)
         AND status = 'published'
         AND (reaction_count > seen_reaction_count OR comment_count > seen_comment_count)`
    )
    .run(imageId, imageRow.content_hash);

  return info.changes > 0;
}

/**
 * Marks all current Civitai reaction and comment counts across all shared posts as seen.
 */
export function markAllCivitaiActivitySeen(): number {
  const info = db
    .prepare(
      `UPDATE image_civitai_drafts
       SET seen_reaction_count = MAX(seen_reaction_count, reaction_count),
           seen_comment_count = MAX(seen_comment_count, comment_count)
       WHERE status = 'published'
         AND (reaction_count > seen_reaction_count OR comment_count > seen_comment_count)`
    )
    .run();

  if (info.changes > 0) {
    notifyWorkspaceDataChanged();
  }
  return info.changes;
}

function isCivitaiNotificationsEnabledInDb(): boolean {
  try {
    const row = db
      .prepare(`SELECT value FROM app_settings WHERE key = 'civitai_activity_notifications_enabled'`)
      .get() as { value: string } | undefined;
    return row ? row.value !== '0' : true;
  } catch {
    return true;
  }
}

/**
 * Sweeps all Civitai draft/published rows and linked LoRAs/models gently in the background.
 */
export async function syncAllCivitaiShareActivity(options?: {
  minIntervalMs?: number;
  includeModels?: boolean;
  deps?: CivitaiActivitySyncDeps;
}): Promise<{
  checkedPosts: number;
  changedPosts: number;
  checkedModels?: number;
  changedModels?: number;
  newlyLinkedModels?: number;
}> {
  if (isSyncRunning) return { checkedPosts: 0, changedPosts: 0 };
  if (!options?.deps?.fetchFn && !appConfig.civitaiApiKey?.trim()) {
    return { checkedPosts: 0, changedPosts: 0 };
  }

  isSyncRunning = true;
  let checkedPosts = 0;
  let changedPosts = 0;

  try {
    const rows = db
      .prepare('SELECT * FROM image_civitai_drafts ORDER BY id DESC')
      .all() as any[];

    const minIntervalMs = options?.minIntervalMs ?? 10 * 60 * 1000;
    const nowMs = Date.now();
    const seenPosts = new Set<number>();

    for (const row of rows) {
      const postId = Number(row.civitai_post_id);
      if (!postId || seenPosts.has(postId)) continue;
      seenPosts.add(postId);

      const needsBreakdownBackfill =
        row.status === 'published' &&
        Number(row.reaction_count || 0) > 0 &&
        Number(row.heart_count || 0) +
          Number(row.like_count || 0) +
          Number(row.laugh_count || 0) +
          Number(row.cry_count || 0) ===
          0;
      const lastSyncMs = parseSqliteUtcMs(row.stats_synced_at);
      if (
        !needsBreakdownBackfill &&
        minIntervalMs > 0 &&
        lastSyncMs > 0 &&
        nowMs - lastSyncMs < minIntervalMs
      ) {
        continue;
      }

      const changed = await syncPostIdStats(postId, row, options?.deps, { syncComments: true });
      checkedPosts += 1;
      if (changed) changedPosts += 1;

      if (!options?.deps?.fetchFn) {
        await new Promise((r) => setTimeout(r, 150));
      }
    }

    let checkedModels = 0;
    let changedModels = 0;
    let newlyLinkedModels = 0;
    const shouldSyncModels =
      (options?.includeModels ?? !options?.deps?.fetchFn) && isCivitaiNotificationsEnabledInDb();

    if (shouldSyncModels) {
      const matchRes = await autoMatchOwnCivitaiUploads({
        deps: {
          fetchFn: options?.deps?.fetchFn,
          listCommentsFn: options?.deps?.listCommentsFn,
        },
      });
      newlyLinkedModels = matchRes.newlyLinkedCount;

      const modelStatsRes = await syncLinkedModelsCivitaiStats({
        minIntervalMs,
        deps: {
          fetchFn: options?.deps?.fetchFn,
          listCommentsFn: options?.deps?.listCommentsFn,
        },
      });
      checkedModels = modelStatsRes.checkedModels;
      changedModels = modelStatsRes.changedModels;
    }

    if (
      changedPosts > 0 ||
      changedModels > 0 ||
      newlyLinkedModels > 0
    ) {
      notifyWorkspaceDataChanged();
    }
    return {
      checkedPosts,
      changedPosts,
      checkedModels,
      changedModels,
      newlyLinkedModels,
    };
  } catch (err) {
    logger.warn('CivitaiSync', 'Background Civitai activity check failed', err);
  } finally {
    isSyncRunning = false;
  }

  return { checkedPosts, changedPosts };
}

/**
 * Starts the 15-minute background scheduler checking shared Civitai posts for publish state,
 * likes/reactions, and comments.
 */
export function startCivitaiActivityScheduler(): void {
  if (activitySyncTimer) return;

  activityStartupTimer = setTimeout(() => {
    syncAllCivitaiShareActivity().catch(() => {});
  }, 20_000);

  activitySyncTimer = setInterval(() => {
    syncAllCivitaiShareActivity().catch(() => {});
  }, DEFAULT_BACKGROUND_INTERVAL_MS);
}

/**
 * Stops any active Civitai activity background timers on server shutdown.
 */
export function stopCivitaiActivityScheduler(): void {
  if (activityStartupTimer) {
    clearTimeout(activityStartupTimer);
    activityStartupTimer = null;
  }
  if (activitySyncTimer) {
    clearInterval(activitySyncTimer);
    activitySyncTimer = null;
  }
}
