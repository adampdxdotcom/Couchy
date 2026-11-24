import { db } from '../../db.ts';
import { CivitaiMcpClient, type NormalizedMcpComment } from './civitaiMcpClient.ts';
import type { CivitaiDomain } from './civitaiHttpAndParse.ts';
import type { CivitaiCommentRecord, CivitaiPostImageStats } from '../../../shared/apiTypes.ts';

export type ListCommentsFn = (params: {
  entityType: 'image' | 'post' | 'model';
  entityId: number;
}) => Promise<NormalizedMcpComment[]>;

/**
 * Fetches comment threads via Civitai MCP (`list_comments`) for a published post and any of its
 * image frames with comments, tying each comment to its Civitai image ID and local Couchy image ID.
 */
export async function fetchPostCommentsViaMcp(params: {
  postId: number;
  domain: CivitaiDomain;
  postImages: CivitaiPostImageStats[];
  apiKey?: string;
  fetchFn?: typeof fetch;
  listCommentsFn?: ListCommentsFn;
}): Promise<{ ok: boolean; comments: CivitaiCommentRecord[] }> {
  let listFn = params.listCommentsFn;
  if (!listFn) {
    const key = params.apiKey?.trim();
    if (!key) {
      return { ok: false, comments: [] };
    }
    const client = new CivitaiMcpClient(key, { fetchFn: params.fetchFn });
    await client.initialize();
    listFn = ({ entityType, entityId }) =>
      client.listComments({ entityType, entityId, depth: 2, sort: 'Newest', includeFull: true });
  }

  const collected: CivitaiCommentRecord[] = [];
  const seenKeys = new Set<string>();
  let anySucceeded = false;

  // Query comments for each Civitai image in the post that reports comments
  for (const img of params.postImages) {
    if (img.commentCount <= 0) continue;
    try {
      const items = await listFn({ entityType: 'image', entityId: img.civitaiImageId });
      anySucceeded = true;
      for (const c of items) {
        const dedupeKey = `image:${c.id}`;
        if (seenKeys.has(dedupeKey)) continue;
        seenKeys.add(dedupeKey);
        collected.push({
          id: c.id,
          targetType: 'image',
          civitaiPostId: params.postId,
          civitaiImageId: img.civitaiImageId,
          localImageId: img.localImageId ?? null,
          civitaiUrl: `https://${params.domain}/images/${img.civitaiImageId}`,
          authorUsername: c.authorUsername,
          authorAvatarUrl: c.authorAvatarUrl,
          content: c.content,
          createdAt: c.createdAt,
          reactionCount: c.reactionCount,
          heartCount: c.heartCount,
          parentCommentId: c.parentCommentId,
          depth: c.depth,
          isPinned: c.isPinned,
        });
      }
    } catch {
      // Continue trying remaining images/post even if a single entity comment lookup fails
    }
  }

  // Also check post-level comments (e.g. carousel-level discussion)
  try {
    const postComments = await listFn({ entityType: 'post', entityId: params.postId });
    anySucceeded = true;
    for (const c of postComments) {
      const dedupeKey = `post:${c.id}`;
      if (seenKeys.has(dedupeKey)) continue;
      seenKeys.add(dedupeKey);
      collected.push({
        id: c.id,
        targetType: 'post',
        civitaiPostId: params.postId,
        civitaiImageId: null,
        localImageId: null,
        civitaiUrl: `https://${params.domain}/posts/${params.postId}`,
        authorUsername: c.authorUsername,
        authorAvatarUrl: c.authorAvatarUrl,
        content: c.content,
        createdAt: c.createdAt,
        reactionCount: c.reactionCount,
        heartCount: c.heartCount,
        parentCommentId: c.parentCommentId,
        depth: c.depth,
        isPinned: c.isPinned,
      });
    }
  } catch {
    // Ignore transient post-level comment fetch failures
  }

  return { ok: anySucceeded, comments: collected };
}

/**
 * Fetches comment threads via Civitai MCP (`list_comments`) for a Civitai model page (`entityType: 'model'`).
 */
export async function fetchModelCommentsViaMcp(params: {
  modelId: number;
  domain: CivitaiDomain;
  apiKey?: string;
  fetchFn?: typeof fetch;
  listCommentsFn?: ListCommentsFn;
}): Promise<{ ok: boolean; comments: CivitaiCommentRecord[] }> {
  let listFn = params.listCommentsFn;
  if (!listFn) {
    const key = params.apiKey?.trim();
    if (!key) {
      return { ok: false, comments: [] };
    }
    const client = new CivitaiMcpClient(key, { fetchFn: params.fetchFn });
    await client.initialize();
    listFn = ({ entityType, entityId }) =>
      client.listComments({ entityType, entityId, depth: 2, sort: 'Newest', includeFull: true });
  }

  try {
    const items = await listFn({ entityType: 'model', entityId: params.modelId });
    const comments: CivitaiCommentRecord[] = items.map((c) => ({
      id: c.id,
      targetType: 'model',
      civitaiPostId: 0,
      civitaiImageId: null,
      localImageId: null,
      civitaiUrl: `https://${params.domain}/models/${params.modelId}`,
      authorUsername: c.authorUsername,
      authorAvatarUrl: c.authorAvatarUrl,
      content: c.content,
      createdAt: c.createdAt,
      reactionCount: c.reactionCount,
      heartCount: c.heartCount,
      parentCommentId: c.parentCommentId,
      depth: c.depth,
      isPinned: c.isPinned,
    }));
    return { ok: true, comments };
  } catch {
    return { ok: false, comments: [] };
  }
}

/**
 * Enriches stored comment records with current local Couchy filename and thumbnail URL.
 */
export function enrichCommentsWithLocalImages(
  comments: CivitaiCommentRecord[]
): CivitaiCommentRecord[] {
  if (!comments || comments.length === 0) return [];
  const localIds = Array.from(
    new Set(
      comments
        .map((c) => c.localImageId)
        .filter((id): id is number => typeof id === 'number' && Number.isInteger(id) && id > 0)
    )
  );

  const infoById = new Map<number, { filename: string }>();
  if (localIds.length > 0) {
    const placeholders = localIds.map(() => '?').join(',');
    const rows = db
      .prepare(`SELECT id, filename FROM images WHERE id IN (${placeholders})`)
      .all(...localIds) as Array<{ id: number; filename: string }>;
    for (const row of rows) {
      infoById.set(Number(row.id), { filename: String(row.filename || '') });
    }
  }

  return comments.map((c) => {
    const localInfo = c.localImageId ? infoById.get(c.localImageId) : undefined;
    return {
      ...c,
      localFilename: localInfo?.filename ?? c.localFilename ?? null,
      localThumbnailUrl:
        c.localImageId && localInfo
          ? `/api/images/${c.localImageId}/thumbnail`
          : c.localThumbnailUrl ?? null,
    };
  });
}
