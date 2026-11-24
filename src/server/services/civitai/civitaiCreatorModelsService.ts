import crypto from 'crypto';
import { db } from '../../db.ts';
import { appConfig } from '../../config.ts';
import { CivitaiMcpClient } from './civitaiMcpClient.ts';
import { fetchModelCommentsViaMcp, type ListCommentsFn } from './civitaiCommentsService.ts';
import {
  buildCivitaiUrl,
  fetchCivitaiJsonWithFallback,
  fetchCivitaiParentModelWithDomain,
  getCivitaiHeaders,
  normalizeCivitaiData,
  parseIdsFromCivitaiUrl,
  resolveCivitaiDomain,
  type CivitaiDomain,
} from './civitaiHttpAndParse.ts';
import {
  applyCivitaiEnrichmentToModel,
  cacheModelPreviewImages,
  invalidateInstalledModelsCache,
} from './civitaiModelEnrichmentService.ts';
import {
  extractCivitaiCreatorUsername,
  extractCivitaiModelStats,
  parseCivitaiCommentsJson,
  parseCivitaiStatsJson,
} from './civitaiModelStatsHelper.ts';
import type {
  CivitaiCommentRecord,
  CivitaiModelStatsSummary,
  CivitaiMyUploadModelItem,
} from '../../../shared/apiTypes.ts';

const WHOAMI_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const MY_UPLOADS_MEMORY_TTL_MS = 2 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 9000;

export interface CivitaiCreatorModelsDeps {
  apiKey?: string;
  fetchFn?: typeof fetch;
  listCommentsFn?: ListCommentsFn;
  whoAmIFn?: () => Promise<{ username: string | null }>;
}

let cachedUploadsMem: {
  username: string;
  items: CivitaiMyUploadModelItem[];
  expiresAt: number;
} | null = null;

function hashApiKeyShort(apiKey: string): string {
  return crypto.createHash('sha256').update(apiKey).digest('hex').slice(0, 12);
}

function getAppSetting(key: string): string | null {
  const row = db.prepare(`SELECT value FROM app_settings WHERE key = ?`).get(key) as
    | { value: string }
    | undefined;
  return row?.value ?? null;
}

function setAppSetting(key: string, value: string): void {
  db.prepare(
    `INSERT INTO app_settings (key, value, updated_at)
     VALUES (?, ?, datetime('now'))
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`
  ).run(key, value);
}

/**
 * Resolves and caches the authenticated Civitai username via MCP `whoami`.
 */
export async function resolveAuthenticatedCivitaiUsername(options?: {
  forceRefresh?: boolean;
  deps?: CivitaiCreatorModelsDeps;
}): Promise<string | null> {
  const key = (options?.deps?.apiKey ?? appConfig.civitaiApiKey ?? '').trim();
  if (!key && !options?.deps?.whoAmIFn) {
    return null;
  }

  const keyTag = key ? hashApiKeyShort(key) : 'stub';
  const storedKeyTag = getAppSetting('civitai_account_key_tag');
  const storedUser = getAppSetting('civitai_account_username')?.trim() || null;
  const storedSyncedAt = Number(getAppSetting('civitai_account_username_ts') || 0);

  if (
    !options?.forceRefresh &&
    storedUser &&
    storedKeyTag === keyTag &&
    storedSyncedAt > 0 &&
    Date.now() - storedSyncedAt < WHOAMI_CACHE_TTL_MS
  ) {
    return storedUser;
  }

  try {
    let username: string | null = null;
    if (options?.deps?.whoAmIFn) {
      const res = await options.deps.whoAmIFn();
      username = res?.username?.trim() || null;
    } else {
      const client = new CivitaiMcpClient(key, { fetchFn: options?.deps?.fetchFn });
      await client.initialize();
      const res = await client.getWhoAmI();
      username = res.username;
    }

    if (username) {
      setAppSetting('civitai_account_username', username);
      setAppSetting('civitai_account_key_tag', keyTag);
      setAppSetting('civitai_account_username_ts', String(Date.now()));
    }
    return username;
  } catch {
    return storedKeyTag === keyTag ? storedUser : null;
  }
}

async function fetchRawCreatorModelsPage(
  domain: CivitaiDomain,
  username: string,
  headers: Record<string, string>,
  fetchFn: typeof fetch,
  cursor?: string | null
): Promise<{ items: any[]; nextCursor: string | null } | null> {
  const params = new URLSearchParams({
    username,
    limit: '100',
    nsfw: 'true',
  });
  if (cursor) params.set('cursor', cursor);

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    const res = await fetchFn(`https://${domain}/api/v1/models?${params.toString()}`, {
      headers,
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!res.ok) return null;
    const data = (await res.json()) as { items?: any[]; metadata?: { nextCursor?: string } };
    return {
      items: Array.isArray(data?.items) ? data.items : [],
      nextCursor:
        typeof data?.metadata?.nextCursor === 'string' && data.metadata.nextCursor.trim()
          ? data.metadata.nextCursor.trim()
          : null,
    };
  } catch {
    return null;
  }
}

async function fetchAllRawCreatorModels(
  username: string,
  deps?: CivitaiCreatorModelsDeps
): Promise<Array<{ model: any; domain: CivitaiDomain }>> {
  const fetchFn = deps?.fetchFn || fetch;
  const key = (deps?.apiKey ?? appConfig.civitaiApiKey ?? '').trim();
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (key) headers.Authorization = `Bearer ${key}`;

  const byModelId = new Map<string, { model: any; domain: CivitaiDomain }>();

  for (const domain of ['civitai.com', 'civitai.red'] as CivitaiDomain[]) {
    let cursor: string | null = null;
    for (let page = 0; page < 4; page++) {
      const pageRes = await fetchRawCreatorModelsPage(domain, username, headers, fetchFn, cursor);
      if (!pageRes) break;

      for (const item of pageRes.items) {
        const idStr = item?.id ? String(item.id) : '';
        if (!idStr) continue;
        const resolvedDomain = resolveCivitaiDomain(item, null, domain);
        const existing = byModelId.get(idStr);
        // Prefer civitai.red entry if flagged NSFW/restricted on .red
        if (!existing || resolvedDomain === 'civitai.red') {
          byModelId.set(idStr, { model: item, domain: resolvedDomain });
        }
      }

      if (!pageRes.nextCursor || pageRes.items.length === 0) break;
      cursor = pageRes.nextCursor;
    }
  }

  return Array.from(byModelId.values());
}

function mapRawUploadsWithLocalLinks(
  rawEntries: Array<{ model: any; domain: CivitaiDomain }>,
  fallbackUsername: string
): CivitaiMyUploadModelItem[] {
  const localModels = db
    .prepare(
      `SELECT id, filename, civitai_version_id, sha256_hash, autov2_hash
       FROM models`
    )
    .all() as Array<{
    id: number;
    filename: string;
    civitai_version_id: string | null;
    sha256_hash: string | null;
    autov2_hash: string | null;
  }>;

  const byVersionId = new Map<string, { id: number; filename: string }>();
  const byHash = new Map<string, { id: number; filename: string }>();
  for (const m of localModels) {
    if (m.civitai_version_id) {
      byVersionId.set(String(m.civitai_version_id).trim(), { id: m.id, filename: m.filename });
    }
    if (m.sha256_hash) {
      byHash.set(m.sha256_hash.trim().toUpperCase(), { id: m.id, filename: m.filename });
    }
    if (m.autov2_hash) {
      byHash.set(m.autov2_hash.trim().toUpperCase(), { id: m.id, filename: m.filename });
    }
  }

  return rawEntries.map(({ model, domain }) => {
    const modelId = String(model.id);
    const creatorUsername = extractCivitaiCreatorUsername(model) || fallbackUsername;
    const rawVersions = Array.isArray(model.modelVersions) ? model.modelVersions : [];
    const firstVer = rawVersions[0];
    const previewUrl =
      firstVer?.images?.find((img: any) => img?.type !== 'video' && img?.url)?.url || null;

    const versions = rawVersions.map((ver: any) => {
      const versionId = String(ver.id);
      const verDomain = resolveCivitaiDomain(model, ver, domain);
      const hashes: string[] = [];
      for (const f of Array.isArray(ver.files) ? ver.files : []) {
        if (f?.hashes?.SHA256) hashes.push(String(f.hashes.SHA256).trim().toUpperCase());
        if (f?.hashes?.AutoV2) hashes.push(String(f.hashes.AutoV2).trim().toUpperCase());
      }

      let linked = byVersionId.get(versionId) || null;
      if (!linked) {
        for (const h of hashes) {
          const hit = byHash.get(h);
          if (hit) {
            linked = hit;
            break;
          }
        }
      }

      const vStats = ver?.stats || {};
      return {
        versionId,
        versionName: String(ver.name || 'Version'),
        baseModel: typeof ver.baseModel === 'string' ? ver.baseModel : null,
        civitaiUrl: buildCivitaiUrl(modelId, versionId, verDomain),
        downloadCount: Math.max(0, Number(vStats.downloadCount || 0)),
        thumbsUpCount: Math.max(0, Number(vStats.thumbsUpCount || 0)),
        thumbsDownCount: Math.max(0, Number(vStats.thumbsDownCount || 0)),
        hashes,
        alreadyLinkedModelId: linked?.id ?? null,
        alreadyLinkedFilename: linked?.filename ?? null,
      };
    });

    const stats = extractCivitaiModelStats(model);
    return {
      civitaiId: modelId,
      name: String(model.name || `Model #${modelId}`),
      type: String(model.type || 'LORA'),
      creatorUsername,
      domain,
      civitaiUrl: buildCivitaiUrl(modelId, null, domain) || `https://${domain}/models/${modelId}`,
      previewUrl,
      stats: {
        downloadCount: stats.downloadCount,
        thumbsUpCount: stats.thumbsUpCount,
        thumbsDownCount: stats.thumbsDownCount,
        commentCount: stats.commentCount,
        tippedAmountCount: stats.tippedAmountCount,
      },
      versions,
    };
  });
}

/**
 * Lists the authenticated Civitai user's uploaded models and versions with local link status.
 */
export async function listMyCivitaiUploads(options?: {
  forceRefresh?: boolean;
  deps?: CivitaiCreatorModelsDeps;
}): Promise<{
  username: string | null;
  hasCivitaiKey: boolean;
  items: CivitaiMyUploadModelItem[];
}> {
  const key = (options?.deps?.apiKey ?? appConfig.civitaiApiKey ?? '').trim();
  const hasCivitaiKey = Boolean(key || options?.deps?.whoAmIFn);
  const username = await resolveAuthenticatedCivitaiUsername({
    forceRefresh: options?.forceRefresh,
    deps: options?.deps,
  });

  if (!username) {
    return { username: null, hasCivitaiKey, items: [] };
  }

  if (
    !options?.forceRefresh &&
    !options?.deps?.fetchFn &&
    cachedUploadsMem &&
    cachedUploadsMem.username.toLowerCase() === username.toLowerCase() &&
    cachedUploadsMem.expiresAt > Date.now()
  ) {
    // Recompute local link status cheaply over cached upload items
    const rawCached = cachedUploadsMem.items;
    const localRows = db
      .prepare(`SELECT id, filename, civitai_version_id, sha256_hash, autov2_hash FROM models`)
      .all() as any[];
    const byVer = new Map<string, { id: number; filename: string }>();
    const byHash = new Map<string, { id: number; filename: string }>();
    for (const m of localRows) {
      if (m.civitai_version_id) byVer.set(String(m.civitai_version_id).trim(), m);
      if (m.sha256_hash) byHash.set(m.sha256_hash.trim().toUpperCase(), m);
      if (m.autov2_hash) byHash.set(m.autov2_hash.trim().toUpperCase(), m);
    }

    return {
      username,
      hasCivitaiKey,
      items: rawCached.map((item) => ({
        ...item,
        versions: item.versions.map((v) => {
          const hit =
            byVer.get(v.versionId) ||
            v.hashes.map((h) => byHash.get(h)).find(Boolean) ||
            null;
          return {
            ...v,
            alreadyLinkedModelId: hit?.id ?? null,
            alreadyLinkedFilename: hit?.filename ?? null,
          };
        }),
      })),
    };
  }

  const rawEntries = await fetchAllRawCreatorModels(username, options?.deps);
  const mapped = mapRawUploadsWithLocalLinks(rawEntries, username);

  if (!options?.deps?.fetchFn) {
    cachedUploadsMem = {
      username,
      items: mapped,
      expiresAt: Date.now() + MY_UPLOADS_MEMORY_TTL_MS,
    };
  }

  return { username, hasCivitaiKey, items: mapped };
}

/**
 * Matches the authenticated user's Civitai uploads against local `models` rows by SHA-256 / AutoV2 hash
 * or existing Civitai version IDs, auto-linking unlinked LoRAs and flagging `is_own_civitai_upload`.
 */
export async function autoMatchOwnCivitaiUploads(options?: {
  deps?: CivitaiCreatorModelsDeps;
}): Promise<{
  username: string | null;
  checkedUploads: number;
  newlyLinkedCount: number;
  updatedOwnFlagsCount: number;
}> {
  const username = await resolveAuthenticatedCivitaiUsername({ deps: options?.deps });
  if (!username) {
    return { username: null, checkedUploads: 0, newlyLinkedCount: 0, updatedOwnFlagsCount: 0 };
  }

  const rawEntries = await fetchAllRawCreatorModels(username, options?.deps);
  if (rawEntries.length === 0) {
    return { username, checkedUploads: 0, newlyLinkedCount: 0, updatedOwnFlagsCount: 0 };
  }

  interface UploadCandidate {
    modelObj: any;
    versionObj: any;
    domain: CivitaiDomain;
    versionId: string;
    modelId: string;
  }

  const bySha256 = new Map<string, UploadCandidate>();
  const byAutoV2 = new Map<string, UploadCandidate>();
  const byVersionId = new Map<string, UploadCandidate>();

  for (const { model, domain } of rawEntries) {
    const modelId = String(model.id);
    for (const ver of Array.isArray(model.modelVersions) ? model.modelVersions : []) {
      const versionId = String(ver.id);
      const verDomain = resolveCivitaiDomain(model, ver, domain);
      const cand: UploadCandidate = {
        modelObj: model,
        versionObj: ver,
        domain: verDomain,
        versionId,
        modelId,
      };
      byVersionId.set(versionId, cand);

      for (const f of Array.isArray(ver.files) ? ver.files : []) {
        if (f?.hashes?.SHA256) {
          bySha256.set(String(f.hashes.SHA256).trim().toUpperCase(), cand);
        }
        if (f?.hashes?.AutoV2) {
          byAutoV2.set(String(f.hashes.AutoV2).trim().toUpperCase(), cand);
        }
      }
    }
  }

  const localModels = db
    .prepare(
      `SELECT id, filename, sha256_hash, autov2_hash, civitai_id, civitai_version_id,
              civitai_url, civitai_creator_username, is_own_civitai_upload
       FROM models`
    )
    .all() as any[];

  let newlyLinkedCount = 0;
  let updatedOwnFlagsCount = 0;

  for (const row of localModels) {
    const existingVerId = row.civitai_version_id ? String(row.civitai_version_id).trim() : null;
    const shaKey = row.sha256_hash ? String(row.sha256_hash).trim().toUpperCase() : null;
    const v2Key = row.autov2_hash ? String(row.autov2_hash).trim().toUpperCase() : null;

    const matched =
      (existingVerId ? byVersionId.get(existingVerId) : undefined) ||
      (shaKey ? bySha256.get(shaKey) : undefined) ||
      (v2Key ? byAutoV2.get(v2Key) : undefined);

    if (!matched) {
      // Also flag models already linked whose stored creator matches whoami
      if (
        row.civitai_creator_username &&
        String(row.civitai_creator_username).toLowerCase() === username.toLowerCase() &&
        !row.is_own_civitai_upload
      ) {
        db.prepare(`UPDATE models SET is_own_civitai_upload = 1 WHERE id = ?`).run(row.id);
        updatedOwnFlagsCount++;
      }
      continue;
    }

    const wasUnlinked = !row.civitai_url && !row.civitai_id && !row.civitai_version_id;
    const meta = normalizeCivitaiData(
      matched.modelObj,
      matched.versionObj,
      row.filename,
      matched.domain
    );
    const stats = extractCivitaiModelStats(matched.modelObj, matched.versionObj);
    const creator = extractCivitaiCreatorUsername(matched.modelObj, matched.versionObj) || username;

    const cacheKey = `m${row.id}_${meta.civitaiVersionId || row.autov2_hash || 'v'}`;
    const cachedPreviews = options?.deps?.fetchFn
      ? []
      : await cacheModelPreviewImages(cacheKey, meta.previewImages);

    applyCivitaiEnrichmentToModel(row.id, meta, cachedPreviews, {
      creatorUsername: creator,
      isOwnUpload: true,
      stats,
      overwriteCivitaiLink: wasUnlinked,
    });

    if (wasUnlinked) {
      newlyLinkedCount++;
    } else if (!row.is_own_civitai_upload || !row.civitai_creator_username) {
      updatedOwnFlagsCount++;
    }
  }

  if (newlyLinkedCount > 0 || updatedOwnFlagsCount > 0) {
    invalidateInstalledModelsCache();
  }

  return {
    username,
    checkedUploads: rawEntries.length,
    newlyLinkedCount,
    updatedOwnFlagsCount,
  };
}

function parseSqliteUtcMs(raw: string | null | undefined): number {
  if (!raw || !String(raw).trim()) return 0;
  const s = String(raw).trim();
  const normalized = s.includes('T') ? (s.endsWith('Z') ? s : `${s}Z`) : `${s.replace(' ', 'T')}Z`;
  const ms = Date.parse(normalized);
  return Number.isFinite(ms) ? ms : 0;
}

/**
 * Refreshes Civitai model/version stats, creator attribution, and MCP model comments for linked models.
 */
export async function syncLinkedModelsCivitaiStats(options?: {
  minIntervalMs?: number;
  onlyModelId?: number;
  deps?: CivitaiCreatorModelsDeps;
}): Promise<{
  checkedModels: number;
  changedModels: number;
  latestStats?: CivitaiModelStatsSummary | null;
  latestComments?: CivitaiCommentRecord[];
  creatorUsername?: string | null;
  isOwnUpload?: boolean;
  syncedAt?: string | null;
}> {
  const minIntervalMs = options?.minIntervalMs ?? 10 * 60 * 1000;
  const rows = options?.onlyModelId
    ? (db
        .prepare(`SELECT * FROM models WHERE id = ?`)
        .all(options.onlyModelId) as any[])
    : (db
        .prepare(
          `SELECT * FROM models
           WHERE civitai_id IS NOT NULL
              OR civitai_version_id IS NOT NULL
              OR civitai_url IS NOT NULL`
        )
        .all() as any[]);

  const accountUsername = await resolveAuthenticatedCivitaiUsername({ deps: options?.deps });
  const headers = getCivitaiHeaders();
  const fetchOpts = {
    fetchFn: options?.deps?.fetchFn,
    bypassCache: true,
  };

  let checkedModels = 0;
  let changedModels = 0;
  let latestStats: CivitaiModelStatsSummary | null = null;
  let latestComments: CivitaiCommentRecord[] = [];
  let latestCreator: string | null = null;
  let latestIsOwn = false;
  let latestSyncedAt: string | null = null;
  const nowMs = Date.now();

  for (const row of rows) {
    const lastSyncMs = parseSqliteUtcMs(row.civitai_stats_synced_at);
    if (minIntervalMs > 0 && lastSyncMs > 0 && nowMs - lastSyncMs < minIntervalMs) {
      continue;
    }

    const parsedUrl = parseIdsFromCivitaiUrl(row.civitai_url || row.download_url);
    const modelId = row.civitai_id || parsedUrl.modelId;
    const versionId = row.civitai_version_id || parsedUrl.versionId;
    const preferredDomain: CivitaiDomain = parsedUrl.domain || 'civitai.com';
    if (!modelId && !versionId) continue;

    let versionObj: any = null;
    let modelObj: any = null;
    let resolvedDomain: CivitaiDomain = preferredDomain;

    if (versionId) {
      const vRes = await fetchCivitaiJsonWithFallback(
        `/api/v1/model-versions/${encodeURIComponent(String(versionId))}`,
        headers,
        resolvedDomain,
        8000,
        fetchOpts
      );
      if (vRes?.data) {
        versionObj = vRes.data;
        resolvedDomain = vRes.domain;
      }
    }

    const effectiveModelId = versionObj?.modelId || modelId;
    if (effectiveModelId) {
      const mRes = await fetchCivitaiParentModelWithDomain(
        effectiveModelId,
        headers,
        resolvedDomain,
        fetchOpts
      );
      modelObj = mRes.model;
      resolvedDomain = mRes.domain;
    }

    if (!modelObj && !versionObj) continue;
    checkedModels++;

    if (!versionObj && Array.isArray(modelObj?.modelVersions) && modelObj.modelVersions.length > 0) {
      versionObj = modelObj.modelVersions[0];
    }

    const stats = extractCivitaiModelStats(modelObj, versionObj);
    const creator =
      extractCivitaiCreatorUsername(modelObj, versionObj) || row.civitai_creator_username || null;
    const isOwn = Boolean(
      row.is_own_civitai_upload ||
        (creator && accountUsername && creator.toLowerCase() === accountUsername.toLowerCase())
    );

    const prevStats = parseCivitaiStatsJson(row.civitai_stats_json);
    const prevComments = parseCivitaiCommentsJson(row.civitai_comments_json);
    let nextComments = prevComments;
    let commentsChanged = false;

    const key = (options?.deps?.apiKey ?? appConfig.civitaiApiKey ?? '').trim();
    const canQueryComments = Boolean(options?.deps?.listCommentsFn || key);
    const numericModelId = Number(effectiveModelId || modelObj?.id || 0);

    if (
      canQueryComments &&
      Number.isInteger(numericModelId) &&
      numericModelId > 0 &&
      (stats.commentCount > 0 ||
        !row.civitai_comments_json ||
        stats.commentCount !== (prevStats?.commentCount ?? 0))
    ) {
      const commentRes = await fetchModelCommentsViaMcp({
        modelId: numericModelId,
        domain: resolvedDomain,
        apiKey: key,
        fetchFn: options?.deps?.fetchFn,
        listCommentsFn: options?.deps?.listCommentsFn,
      });
      if (commentRes.ok) {
        nextComments = commentRes.comments;
        commentsChanged =
          JSON.stringify(nextComments) !== (row.civitai_comments_json || null);
      }
    }

    const nextStatsJson = JSON.stringify(stats);
    const nextCommentsJson = JSON.stringify(nextComments);
    const statsChanged = nextStatsJson !== (row.civitai_stats_json || null);
    const creatorChanged =
      creator !== (row.civitai_creator_username || null) ||
      (isOwn ? 1 : 0) !== Number(row.is_own_civitai_upload || 0);

    db.prepare(
      `UPDATE models
       SET civitai_id = COALESCE(?, civitai_id),
           civitai_version_id = COALESCE(?, civitai_version_id),
           civitai_creator_username = COALESCE(?, civitai_creator_username),
           is_own_civitai_upload = CASE WHEN ? = 1 THEN 1 ELSE is_own_civitai_upload END,
           civitai_stats_json = ?,
           civitai_comments_json = CASE WHEN ? = 1 THEN ? ELSE civitai_comments_json END,
           civitai_stats_synced_at = datetime('now')
       WHERE id = ?`
    ).run(
      effectiveModelId ? String(effectiveModelId) : null,
      versionObj?.id ? String(versionObj.id) : null,
      creator,
      isOwn ? 1 : 0,
      nextStatsJson,
      commentsChanged ? 1 : 0,
      nextCommentsJson,
      row.id
    );

    if (statsChanged || commentsChanged || creatorChanged) {
      changedModels++;
    }

    latestStats = stats;
    latestComments = nextComments;
    latestCreator = creator;
    latestIsOwn = isOwn;
    latestSyncedAt = new Date().toISOString();

    if (!options?.deps?.fetchFn && rows.length > 1) {
      await new Promise((r) => setTimeout(r, 120));
    }
  }

  return {
    checkedModels,
    changedModels,
    latestStats,
    latestComments,
    creatorUsername: latestCreator,
    isOwnUpload: latestIsOwn,
    syncedAt: latestSyncedAt,
  };
}
