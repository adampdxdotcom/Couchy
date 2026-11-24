import { db } from '../../db.ts';
import { appConfig } from '../../config.ts';
import { logger } from '../../logger.ts';
import { notifyWorkspaceDataChanged } from '../comfyuiLiveMonitor.ts';
import { getCivitaiHeaders, type CivitaiDomain } from './civitaiHttpAndParse.ts';
import type { CivitaiDraftRecord, CivitaiShareSummary } from '../../../shared/apiTypes.ts';

const DEFAULT_BACKGROUND_INTERVAL_MS = 15 * 60 * 1000;
const DEFAULT_INSPECTOR_MIN_INTERVAL_MS = 2 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 8000;

let activitySyncTimer: ReturnType<typeof setInterval> | null = null;
let activityStartupTimer: ReturnType<typeof setTimeout> | null = null;
let isSyncRunning = false;

export interface CivitaiActivitySyncDeps {
  fetchFn?: typeof fetch;
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

/**
 * Maps a raw `image_civitai_drafts` SQLite row into a typed `CivitaiDraftRecord`.
 */
export function mapDraftRowToRecord(row: any): CivitaiDraftRecord {
  const status = row.status === 'published' ? 'published' : 'draft';
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
    commentCount,
    seenReactionCount,
    seenCommentCount,
    hasUnseenActivity,
    statsSyncedAt: row.stats_synced_at ? String(row.stats_synced_at) : null,
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
    }
  }

  const primaryRow = publishedRows[0] || sorted[0];
  const primaryUrl = String(primaryRow.published_url || primaryRow.draft_url || '');

  return {
    status,
    totalDrafts: sorted.length,
    publishedCount: publishedRows.length,
    reactionCount,
    commentCount,
    hasActivity: status === 'published' && (reactionCount > 0 || commentCount > 0),
    hasUnseenActivity,
    primaryUrl,
  };
}

/**
 * Extracts total reactions, comment count, and primary image ID from Civitai `/api/v1/images?postId=...` items.
 */
export function extractCivitaiPostStats(
  items: any[],
  domain: CivitaiDomain,
  postId: number
): {
  civitaiImageId: number | null;
  publishedUrl: string;
  reactionCount: number;
  commentCount: number;
} {
  let reactionCount = 0;
  let commentCount = 0;
  const firstId = Number(items[0]?.id || 0);
  const civitaiImageId = Number.isInteger(firstId) && firstId > 0 ? firstId : null;

  for (const item of items) {
    const stats = item?.stats || {};
    reactionCount +=
      Math.max(0, Number(stats.likeCount || 0)) +
      Math.max(0, Number(stats.heartCount || 0)) +
      Math.max(0, Number(stats.laughCount || 0)) +
      Math.max(0, Number(stats.cryCount || 0));
    commentCount += Math.max(0, Number(stats.commentCount || 0));
  }

  const publishedUrl = civitaiImageId
    ? `https://${domain}/images/${civitaiImageId}`
    : `https://${domain}/posts/${postId}`;

  return { civitaiImageId, publishedUrl, reactionCount, commentCount };
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
  commentCount: number;
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
 * Syncs live publish status and reaction/comment counts for a single `civitai_post_id` across
 * any matching draft rows in SQLite. Returns true if status or counts changed.
 */
async function syncPostIdStats(
  postId: number,
  sampleDraftRow: any,
  deps?: CivitaiActivitySyncDeps
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

  const prevStatus = sampleDraftRow.status === 'published' ? 'published' : 'draft';
  const prevImgId = sampleDraftRow.civitai_image_id ? Number(sampleDraftRow.civitai_image_id) : null;
  const prevReactions = Number(sampleDraftRow.reaction_count || 0);
  const prevComments = Number(sampleDraftRow.comment_count || 0);

  const changed =
    prevStatus !== 'published' ||
    prevImgId !== live.civitaiImageId ||
    prevReactions !== live.reactionCount ||
    prevComments !== live.commentCount;

  db.prepare(
    `UPDATE image_civitai_drafts
     SET status = 'published',
         civitai_image_id = COALESCE(?, civitai_image_id),
         published_url = ?,
         reaction_count = ?,
         comment_count = ?,
         stats_synced_at = datetime('now')
     WHERE civitai_post_id = ?`
  ).run(live.civitaiImageId, live.publishedUrl, live.reactionCount, live.commentCount, postId);

  return changed;
}

/**
 * Refreshes Civitai publish status and reaction/comment stats for a specific image's drafts
 * when opening the Image Inspector (throttled per-draft by `minIntervalMs`).
 */
export async function syncCivitaiActivityForImage(
  imageId: number,
  options?: { minIntervalMs?: number; deps?: CivitaiActivitySyncDeps }
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
  const nowMs = Date.now();
  const seenPosts = new Set<number>();
  let syncedPosts = 0;
  let anyChanged = false;

  for (const row of draftRows) {
    const postId = Number(row.civitai_post_id);
    if (!postId || seenPosts.has(postId)) continue;
    seenPosts.add(postId);

    const lastSyncMs = parseSqliteUtcMs(row.stats_synced_at);
    if (minIntervalMs > 0 && lastSyncMs > 0 && nowMs - lastSyncMs < minIntervalMs) {
      continue;
    }

    const changed = await syncPostIdStats(postId, row, options?.deps);
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

/**
 * Sweeps all Civitai draft/published rows in `image_civitai_drafts` gently in the background.
 */
export async function syncAllCivitaiShareActivity(options?: {
  minIntervalMs?: number;
  deps?: CivitaiActivitySyncDeps;
}): Promise<{ checkedPosts: number; changedPosts: number }> {
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

      const lastSyncMs = parseSqliteUtcMs(row.stats_synced_at);
      if (minIntervalMs > 0 && lastSyncMs > 0 && nowMs - lastSyncMs < minIntervalMs) {
        continue;
      }

      const changed = await syncPostIdStats(postId, row, options?.deps);
      checkedPosts += 1;
      if (changed) changedPosts += 1;

      if (!options?.deps?.fetchFn) {
        await new Promise((r) => setTimeout(r, 150));
      }
    }

    if (changedPosts > 0) {
      notifyWorkspaceDataChanged();
    }
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
