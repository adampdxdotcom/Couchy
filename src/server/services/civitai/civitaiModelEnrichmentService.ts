import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import sharp from 'sharp';
import { db } from '../../db.ts';
import { appConfig } from '../../config.ts';
import { resolveHuggingFaceModelDetails } from '../huggingFaceMetadataService.ts';
import {
  buildCivitaiUrl,
  fetchCivitaiJsonWithFallback,
  fetchCivitaiParentModelWithDomain,
  getCivitaiHeaders,
  normalizeCivitaiData,
  parseIdsFromCivitaiUrl,
  probeCivitaiWebDomain,
  resolveCivitaiDomain,
  type CivitaiDomain,
  type CivitaiNormalizedMeta,
} from './civitaiHttpAndParse.ts';
import { fetchModelCommentsViaMcp, type ListCommentsFn } from './civitaiCommentsService.ts';
import {
  extractCivitaiCreatorUsername,
  extractCivitaiModelStats,
  parseCivitaiLinkInput,
} from './civitaiModelStatsHelper.ts';
import type { CivitaiModelStatsSummary } from '../../../shared/apiTypes.ts';
import type {
  ExternalModelFileOption,
  ExternalModelInstalledInfo,
  ExternalModelSearchResult,
  LoraCategory,
  ModelType,
} from '../../../shared/types.ts';

export interface StoredPreviewImageEntry {
  filename: string;
  width?: number | null;
  height?: number | null;
  sourceUrl?: string | null;
}

export interface InstalledModelRecord {
  id: number;
  name: string;
  filename: string;
  model_type: string;
  lora_category: string | null;
  sha256_hash: string | null;
  autov2_hash: string | null;
  civitai_version_id: string | null;
  default_model_strength: number | null;
  default_clip_strength: number | null;
  trigger_word: string | null;
  nickname: string | null;
}

const MAX_PREVIEW_IMAGES = 4;

/**
 * Returns and ensures the disk cache directory for model preview thumbnails.
 */
export function getModelsPreviewDir(): string {
  const dir = path.join(appConfig.thumbnailPath, 'models');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/**
 * Safely resolves a cached preview filename inside the models preview directory.
 */
export function resolveSafeModelPreviewPath(filename: string): string | null {
  const safeName = path.basename(String(filename || '').trim());
  if (!safeName || safeName.startsWith('.')) return null;
  const dir = path.resolve(getModelsPreviewDir());
  const target = path.resolve(dir, safeName);
  if (!target.startsWith(dir + path.sep) && target !== dir) {
    return null;
  }
  return target;
}

function toSizedCivitaiUrl(url: string): string {
  if (!url.includes('image.civitai.com')) return url;
  if (/\/width=\d+/i.test(url)) {
    return url.replace(/\/width=\d+/i, '/width=512');
  }
  return url;
}

/**
 * Downloads and caches up to 4 static preview thumbnails locally as compressed WebP files.
 */
export async function cacheModelPreviewImages(
  cacheKey: string,
  sources: { url: string; width?: number | null; height?: number | null }[]
): Promise<StoredPreviewImageEntry[]> {
  if (!sources || sources.length === 0) return [];
  const dir = getModelsPreviewDir();
  const safeKey = cacheKey.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64) || 'model';
  const stored: StoredPreviewImageEntry[] = [];

  for (let i = 0; i < Math.min(MAX_PREVIEW_IMAGES, sources.length); i++) {
    const src = sources[i];
    if (!src?.url) continue;
    const filename = `${safeKey}_${i}.webp`;
    const destPath = path.join(dir, filename);

    if (fs.existsSync(destPath)) {
      try {
        const stat = fs.statSync(destPath);
        if (stat.size > 0) {
          stored.push({
            filename,
            width: src.width ?? null,
            height: src.height ?? null,
            sourceUrl: src.url,
          });
          continue;
        }
      } catch {
        // re-download if stat fails
      }
    }

    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 9000);
      const res = await fetch(toSizedCivitaiUrl(src.url), { signal: controller.signal });
      clearTimeout(timer);
      if (!res.ok) continue;

      const contentType = res.headers.get('content-type') || '';
      if (contentType.startsWith('video/')) continue;

      const arrayBuf = await res.arrayBuffer();
      const inputBuf = Buffer.from(arrayBuf);
      if (inputBuf.length === 0) continue;

      const outInfo = await sharp(inputBuf)
        .rotate()
        .resize({ width: 512, height: 512, fit: 'inside', withoutEnlargement: true })
        .webp({ quality: 82 })
        .toFile(destPath);

      stored.push({
        filename,
        width: outInfo.width || src.width || null,
        height: outInfo.height || src.height || null,
        sourceUrl: src.url,
      });
    } catch {
      // Skip failing/timeout preview image without failing the rest
    }
  }

  return stored;
}

function getCachedCivitaiAccountUsername(): string | null {
  try {
    const row = db
      .prepare(`SELECT value FROM app_settings WHERE key = 'civitai_account_username'`)
      .get() as { value: string } | undefined;
    return row?.value?.trim() || null;
  } catch {
    return null;
  }
}

/**
 * Propagates newly resolved model ID and trigger word onto linked `character_loras` rows without
 * overwriting user-customized character trigger words.
 */
export function propagateModelLinkToCharacters(
  modelId: number,
  filename: string,
  triggerWord: string | null
): void {
  const cleanTrigger = triggerWord?.trim() || '';
  db.prepare(
    `UPDATE character_loras
     SET model_id = COALESCE(model_id, ?),
         trigger_word = CASE
           WHEN TRIM(COALESCE(trigger_word, '')) = '' AND ? != '' THEN ?
           ELSE trigger_word
         END
     WHERE LOWER(lora_name) = LOWER(?)`
  ).run(modelId, cleanTrigger, cleanTrigger, filename);
}

/**
 * Applies Civitai enrichment metadata onto an existing `models` row.
 * Follows the non-destructive conflict policy: only fills `trigger_word` when empty
 * and `default_model_strength` when still at the `1.0` default.
 */
export function applyCivitaiEnrichmentToModel(
  modelId: number,
  meta: CivitaiNormalizedMeta,
  cachedPreviews: StoredPreviewImageEntry[],
  extraMeta?: {
    hfRepoId?: string | null;
    downloadUrl?: string | null;
    creatorUsername?: string | null;
    isOwnUpload?: boolean;
    stats?: CivitaiModelStatsSummary | null;
    overwriteCivitaiLink?: boolean;
  }
): { filledTriggerWord: boolean; filledDefaultStrength: boolean } {
  const existing = db
    .prepare(
      `SELECT id, filename, trigger_word, default_model_strength, civitai_id, civitai_version_id,
              civitai_url, base_model, recommended_weight, civitai_description, preview_images_json
       FROM models WHERE id = ?`
    )
    .get(modelId) as any;

  if (!existing) {
    throw new Error('Model record not found');
  }

  let nextTriggerWord = existing.trigger_word || null;
  let filledTriggerWord = false;
  const joinedWords = meta.trainedWords.join(', ');
  if ((!nextTriggerWord || !String(nextTriggerWord).trim()) && joinedWords) {
    nextTriggerWord = joinedWords;
    filledTriggerWord = true;
  }

  let nextModelStrength =
    existing.default_model_strength !== null && existing.default_model_strength !== undefined
      ? Number(existing.default_model_strength)
      : 1.0;
  let filledDefaultStrength = false;
  if (
    Math.abs(nextModelStrength - 1.0) < 0.001 &&
    meta.recommendedWeight !== null &&
    meta.recommendedWeight !== undefined
  ) {
    nextModelStrength = Math.max(-10.0, Math.min(10.0, Number(meta.recommendedWeight)));
    filledDefaultStrength = true;
  }

  const nextPreviewsJson =
    cachedPreviews.length > 0
      ? JSON.stringify(cachedPreviews)
      : existing.preview_images_json || '[]';

  const statsJson = extraMeta?.stats ? JSON.stringify(extraMeta.stats) : null;
  const overwrite = extraMeta?.overwriteCivitaiLink ? 1 : 0;

  db.prepare(
    `UPDATE models
     SET civitai_id = CASE WHEN ? = 1 AND ? IS NOT NULL THEN ? ELSE COALESCE(?, civitai_id) END,
         civitai_version_id = CASE WHEN ? = 1 AND ? IS NOT NULL THEN ? ELSE COALESCE(?, civitai_version_id) END,
         civitai_url = CASE WHEN ? = 1 AND ? IS NOT NULL THEN ? ELSE COALESCE(?, civitai_url) END,
         hf_repo_id = COALESCE(?, hf_repo_id),
         download_url = COALESCE(download_url, ?),
         base_model = CASE WHEN ? = 1 AND ? IS NOT NULL THEN ? ELSE COALESCE(?, base_model) END,
         recommended_weight = COALESCE(?, recommended_weight),
         civitai_description = CASE WHEN ? = 1 AND ? IS NOT NULL THEN ? ELSE COALESCE(?, civitai_description) END,
         preview_images_json = ?,
         trigger_word = ?,
         default_model_strength = ?,
         civitai_creator_username = COALESCE(?, civitai_creator_username),
         is_own_civitai_upload = CASE WHEN ? = 1 THEN 1 ELSE is_own_civitai_upload END,
         civitai_stats_json = COALESCE(?, civitai_stats_json),
         civitai_stats_synced_at = CASE WHEN ? IS NOT NULL THEN datetime('now') ELSE civitai_stats_synced_at END,
         civitai_fetched_at = datetime('now')
     WHERE id = ?`
  ).run(
    overwrite,
    meta.civitaiId,
    meta.civitaiId,
    meta.civitaiId,
    overwrite,
    meta.civitaiVersionId,
    meta.civitaiVersionId,
    meta.civitaiVersionId,
    overwrite,
    meta.civitaiUrl,
    meta.civitaiUrl,
    meta.civitaiUrl,
    extraMeta?.hfRepoId || null,
    extraMeta?.downloadUrl || null,
    overwrite,
    meta.baseModel,
    meta.baseModel,
    meta.baseModel,
    meta.recommendedWeight,
    overwrite,
    meta.civitaiDescription,
    meta.civitaiDescription,
    meta.civitaiDescription,
    nextPreviewsJson,
    nextTriggerWord,
    nextModelStrength,
    extraMeta?.creatorUsername || null,
    extraMeta?.isOwnUpload ? 1 : 0,
    statsJson,
    statsJson,
    modelId
  );

  propagateModelLinkToCharacters(modelId, existing.filename, nextTriggerWord);
  invalidateInstalledModelsCache();
  return { filledTriggerWord, filledDefaultStrength };
}

/**
 * Streams a local model file on disk to compute SHA-256 and AutoV2 hashes without loading into RAM.
 */
export function computeFileSha256Stream(filePath: string): Promise<{ sha256: string; autov2: string }> {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('error', (err) => reject(err));
    stream.on('end', () => {
      const hex = hash.digest('hex').toLowerCase();
      resolve({ sha256: hex, autov2: hex.slice(0, 10) });
    });
  });
}

/**
 * Resolves metadata for an existing model row (Base Model or LoRA):
 * 1) Civitai via SHA-256 / AutoV2 hash lookup (with fallback to stored IDs, detecting .red vs .com).
 * 2) Hugging Face fallback via stored repo ID or API search + LFS SHA-256 / filename verification.
 */
export async function fetchAndEnrichModelFromCivitai(
  modelId: number,
  options?: {
    allowHuggingFaceFallback?: boolean;
    explicitLinkInput?: string;
    explicitVersionId?: string;
    explicitModelId?: string;
    explicitDomain?: CivitaiDomain;
    ownUsername?: string | null;
    syncComments?: boolean;
    fetchFn?: typeof fetch;
    listCommentsFn?: ListCommentsFn;
  }
): Promise<{
  provider: 'civitai' | 'huggingface';
  hfRepoId: string | null;
  meta: CivitaiNormalizedMeta;
  cachedPreviews: StoredPreviewImageEntry[];
  filledTriggerWord: boolean;
  filledDefaultStrength: boolean;
  stats: CivitaiModelStatsSummary | null;
  creatorUsername: string | null;
  isOwnUpload: boolean;
}> {
  const isExplicitLink = Boolean(
    options?.explicitLinkInput?.trim() || options?.explicitVersionId?.trim() || options?.explicitModelId?.trim()
  );
  const allowHfFallback = !isExplicitLink && options?.allowHuggingFaceFallback !== false;
  const row = db.prepare('SELECT * FROM models WHERE id = ?').get(modelId) as any;
  if (!row) {
    const err: any = new Error('Model not found');
    err.statusCode = 404;
    throw err;
  }

  let sha256: string | null = row.sha256_hash || null;
  let autov2: string | null = row.autov2_hash || null;

  if (!isExplicitLink && !sha256 && row.file_path && fs.existsSync(row.file_path)) {
    try {
      const computed = await computeFileSha256Stream(row.file_path);
      sha256 = computed.sha256;
      autov2 = computed.autov2;
      db.prepare('UPDATE models SET sha256_hash = ?, autov2_hash = ? WHERE id = ?').run(
        sha256,
        autov2,
        row.id
      );
      invalidateInstalledModelsCache();
    } catch {
      // continue to fallback IDs if local file hash fails
    }
  }

  const parsedExplicit = options?.explicitLinkInput
    ? parseCivitaiLinkInput(options.explicitLinkInput)
    : null;
  const parsedFromUrl = parseIdsFromCivitaiUrl(row.civitai_url || row.download_url);

  const explicitVerId = options?.explicitVersionId?.trim() || parsedExplicit?.versionId || null;
  const explicitModId = options?.explicitModelId?.trim() || parsedExplicit?.modelId || null;
  const storedCivitaiId = explicitModId || row.civitai_id || parsedFromUrl.modelId;
  const storedVersionId = explicitVerId || row.civitai_version_id || parsedFromUrl.versionId;
  let detectedDomain: CivitaiDomain =
    options?.explicitDomain || parsedExplicit?.domain || parsedFromUrl.domain || 'civitai.com';

  const headers = getCivitaiHeaders();
  const fetchOpts = options?.fetchFn ? { fetchFn: options.fetchFn, bypassCache: true } : undefined;
  let versionObj: any = null;
  let modelObj: any = null;

  // 1. When NOT explicitly linking by URL/Version ID, prefer exact SHA-256 / AutoV2 hash lookup
  const hashesToTry = isExplicitLink
    ? []
    : [sha256, autov2].filter((h): h is string => Boolean(h && h.trim()));
  for (const h of hashesToTry) {
    const found = await fetchCivitaiJsonWithFallback(
      `/api/v1/model-versions/by-hash/${encodeURIComponent(h.trim())}`,
      headers,
      detectedDomain,
      9000,
      fetchOpts
    );
    if (found?.data) {
      versionObj = found.data;
      if (found.domain === 'civitai.red') detectedDomain = 'civitai.red';
      break;
    }
  }

  // 2. Explicit or stored Civitai Version ID / Model ID lookup
  if (!versionObj && storedVersionId) {
    const foundVer = await fetchCivitaiJsonWithFallback(
      `/api/v1/model-versions/${encodeURIComponent(String(storedVersionId))}`,
      headers,
      detectedDomain,
      8000,
      fetchOpts
    );
    if (foundVer?.data) {
      versionObj = foundVer.data;
      if (foundVer.domain === 'civitai.red') detectedDomain = 'civitai.red';
    }
  }

  // If user pasted a bare numeric Model ID instead of a Version ID, try resolving it as a Model ID
  const fallbackModelLookupId =
    storedCivitaiId || (parsedExplicit?.isBareNumeric ? parsedExplicit.versionId : null);
  if (!versionObj && fallbackModelLookupId) {
    const parentRes = await fetchCivitaiParentModelWithDomain(
      fallbackModelLookupId,
      headers,
      detectedDomain,
      fetchOpts
    );
    modelObj = parentRes.model;
    if (parentRes.domain === 'civitai.red') detectedDomain = 'civitai.red';
    if (modelObj?.modelVersions?.length) {
      versionObj = modelObj.modelVersions[0];
    }
  }

  if (!versionObj) {
    if (allowHfFallback) {
      const hfMeta = await resolveHuggingFaceModelDetails({
        filename: row.filename,
        name: row.name,
        sha256,
        hfRepoId: row.hf_repo_id,
        downloadUrl: row.download_url,
      });
      if (hfMeta) {
        const normalizedHf: CivitaiNormalizedMeta = {
          civitaiId: null,
          civitaiVersionId: null,
          civitaiUrl: null,
          baseModel: hfMeta.baseModel,
          trainedWords: [],
          recommendedWeight: null,
          civitaiDescription: hfMeta.description,
          previewImages: hfMeta.previewImages,
        };
        const cacheKey = `m${row.id}_hf_${row.autov2_hash || 'v'}`;
        const cachedPreviews = await cacheModelPreviewImages(cacheKey, normalizedHf.previewImages);
        const { filledTriggerWord, filledDefaultStrength } = applyCivitaiEnrichmentToModel(
          row.id,
          normalizedHf,
          cachedPreviews,
          { hfRepoId: hfMeta.hfRepoId, downloadUrl: hfMeta.downloadUrl }
        );
        return {
          provider: 'huggingface',
          hfRepoId: hfMeta.hfRepoId,
          meta: normalizedHf,
          cachedPreviews,
          filledTriggerWord,
          filledDefaultStrength,
          stats: null,
          creatorUsername: null,
          isOwnUpload: false,
        };
      }
    }

    const err: any = new Error(
      isExplicitLink
        ? 'Could not find a Civitai model or version matching that URL / Version ID.'
        : hashesToTry.length > 0 || allowHfFallback
        ? 'No matching model found on Civitai or Hugging Face for this file.'
        : 'Cannot look up model on Civitai: no local file hash or Civitai ID available.'
    );
    err.statusCode = 404;
    throw err;
  }

  const resolvedParentId = versionObj.modelId || fallbackModelLookupId;
  if (!modelObj && resolvedParentId) {
    const parentRes = await fetchCivitaiParentModelWithDomain(
      resolvedParentId,
      headers,
      detectedDomain,
      fetchOpts
    );
    modelObj = parentRes.model;
    if (parentRes.domain === 'civitai.red') detectedDomain = 'civitai.red';
  }
  if (!modelObj && versionObj.model) {
    modelObj = { id: resolvedParentId, ...versionObj.model };
  }

  let finalDomain = resolveCivitaiDomain(modelObj, versionObj, detectedDomain);
  if (finalDomain === 'civitai.com' && resolvedParentId && !options?.fetchFn) {
    finalDomain = await probeCivitaiWebDomain(resolvedParentId, finalDomain);
  }

  const meta = normalizeCivitaiData(modelObj, versionObj, row.filename, finalDomain);
  const stats = extractCivitaiModelStats(modelObj, versionObj);
  const creatorUsername = extractCivitaiCreatorUsername(modelObj, versionObj);
  const accountUser = options?.ownUsername ?? getCachedCivitaiAccountUsername();
  const isOwnUpload = Boolean(
    creatorUsername &&
      accountUser &&
      creatorUsername.toLowerCase() === accountUser.toLowerCase()
  );

  const cacheKey = `m${row.id}_${meta.civitaiVersionId || row.autov2_hash || 'v'}`;
  const cachedPreviews = options?.fetchFn
    ? []
    : await cacheModelPreviewImages(cacheKey, meta.previewImages);
  const { filledTriggerWord, filledDefaultStrength } = applyCivitaiEnrichmentToModel(
    row.id,
    meta,
    cachedPreviews,
    {
      creatorUsername,
      isOwnUpload,
      stats,
      overwriteCivitaiLink: isExplicitLink,
    }
  );

  // Fetch model comments via MCP if configured and either comments exist or user explicitly linked
  const canQueryComments = Boolean(options?.listCommentsFn || appConfig.civitaiApiKey?.trim());
  const shouldFetchComments =
    options?.syncComments !== false &&
    canQueryComments &&
    meta.civitaiId &&
    (stats.commentCount > 0 || isExplicitLink);
  if (shouldFetchComments && meta.civitaiId) {
    const numericModelId = Number(meta.civitaiId);
    if (Number.isInteger(numericModelId) && numericModelId > 0) {
      const commentRes = await fetchModelCommentsViaMcp({
        modelId: numericModelId,
        domain: finalDomain,
        apiKey: appConfig.civitaiApiKey,
        fetchFn: options?.fetchFn,
        listCommentsFn: options?.listCommentsFn,
      });
      if (commentRes.ok) {
        db.prepare(`UPDATE models SET civitai_comments_json = ? WHERE id = ?`).run(
          JSON.stringify(commentRes.comments),
          row.id
        );
      }
    }
  }

  return {
    provider: 'civitai',
    hfRepoId: row.hf_repo_id || null,
    meta,
    cachedPreviews,
    filledTriggerWord,
    filledDefaultStrength,
    stats,
    creatorUsername,
    isOwnUpload,
  };
}

/**
 * Scans all local `models` records that have Civitai URLs, IDs, or hashes,
 * detects whether each model belongs on `civitai.red` vs `civitai.com`,
 * and heals broken or outdated `civitai_url` links in place.
 */
export async function healExistingCivitaiLinks(): Promise<{
  checked: number;
  healed: number;
  redCount: number;
}> {
  const rows = db
    .prepare(
      `SELECT id, filename, file_path, sha256_hash, autov2_hash, civitai_id, civitai_version_id, civitai_url, download_url
       FROM models
       WHERE civitai_url IS NOT NULL
          OR civitai_id IS NOT NULL
          OR civitai_version_id IS NOT NULL
          OR sha256_hash IS NOT NULL
          OR autov2_hash IS NOT NULL
          OR download_url LIKE '%civitai.%'`
    )
    .all() as any[];

  let checked = 0;
  let healed = 0;
  let redCount = 0;

  for (const row of rows) {
    checked++;
    const previousUrl = row.civitai_url || null;
    try {
      const { meta } = await fetchAndEnrichModelFromCivitai(row.id, {
        allowHuggingFaceFallback: false,
      });
      if (meta.civitaiUrl?.includes('civitai.red')) {
        redCount++;
      }
      if (meta.civitaiUrl && meta.civitaiUrl !== previousUrl) {
        healed++;
      }
    } catch {
      const parsed = parseIdsFromCivitaiUrl(row.civitai_url || row.download_url);
      const mId = row.civitai_id || parsed.modelId;
      const vId = row.civitai_version_id || parsed.versionId;
      if (mId) {
        const probedDomain = await probeCivitaiWebDomain(mId, parsed.domain || 'civitai.com');
        const nextUrl = buildCivitaiUrl(mId, vId, probedDomain);
        if (probedDomain === 'civitai.red') redCount++;
        if (nextUrl && nextUrl !== previousUrl) {
          db.prepare(
            `UPDATE models
             SET civitai_id = COALESCE(?, civitai_id),
                 civitai_version_id = COALESCE(?, civitai_version_id),
                 civitai_url = ?
             WHERE id = ?`
          ).run(String(mId), vId ? String(vId) : null, nextUrl, row.id);
          invalidateInstalledModelsCache();
          healed++;
        }
      }
    }
  }

  return { checked, healed, redCount };
}

let initialHealTriggered = false;
export function triggerBackgroundCivitaiLinkHealOnce(): void {
  if (initialHealTriggered) return;
  initialHealTriggered = true;
  setImmediate(() => {
    healExistingCivitaiLinks().catch(() => {
      // background heal is best-effort
    });
  });
}

export function normalizeModelStem(raw: string): string {
  return String(raw || '')
    .trim()
    .replace(/\\/g, '/')
    .split('/')
    .pop()!
    .replace(/\.(safetensors|pt|ckpt|pth|bin|gguf|sft)$/i, '')
    .toLowerCase();
}

function normalizeModelAlnum(raw: string): string {
  return normalizeModelStem(raw).replace(/[^a-z0-9]/g, '');
}

export interface IndexedInstalledModel extends InstalledModelRecord {
  stemFilename: string;
  stemName: string;
  stemNickname: string | null;
  alnumFilename: string;
  alnumName: string;
}

interface InstalledModelsIndex {
  allRows: IndexedInstalledModel[];
  visibleRows: IndexedInstalledModel[];
  visibleLoras: IndexedInstalledModel[];
  visibleBases: IndexedInstalledModel[];
  bySha256: Map<string, IndexedInstalledModel>;
  byAutoV2: Map<string, IndexedInstalledModel>;
  byVersionId: Map<string, IndexedInstalledModel>;
  byFilename: Map<string, IndexedInstalledModel>;
}

let cachedInstalledModelsIndex: InstalledModelsIndex | null = null;

/**
 * Invalidates the cached in-memory index of installed `models` rows.
 * Must be called after any sync, download, visibility toggle, hash update, or cleanup on `models`.
 */
export function invalidateInstalledModelsCache(): void {
  cachedInstalledModelsIndex = null;
}

function getInstalledModelsIndex(): InstalledModelsIndex {
  if (cachedInstalledModelsIndex) {
    return cachedInstalledModelsIndex;
  }

  const rawRows = db
    .prepare(
      `SELECT id, name, filename, model_type, lora_category, sha256_hash, autov2_hash, civitai_version_id,
              default_model_strength, default_clip_strength, trigger_word, nickname, is_hidden
       FROM models
       WHERE is_installed = 1`
    )
    .all() as Array<InstalledModelRecord & { is_hidden: number }>;

  const allRows: IndexedInstalledModel[] = [];
  const visibleRows: IndexedInstalledModel[] = [];
  const visibleLoras: IndexedInstalledModel[] = [];
  const visibleBases: IndexedInstalledModel[] = [];
  const bySha256 = new Map<string, IndexedInstalledModel>();
  const byAutoV2 = new Map<string, IndexedInstalledModel>();
  const byVersionId = new Map<string, IndexedInstalledModel>();
  const byFilename = new Map<string, IndexedInstalledModel>();

  for (const r of rawRows) {
    const indexed: IndexedInstalledModel = {
      id: r.id,
      name: r.name,
      filename: r.filename,
      model_type: r.model_type,
      lora_category: r.lora_category,
      sha256_hash: r.sha256_hash,
      autov2_hash: r.autov2_hash,
      civitai_version_id: r.civitai_version_id,
      default_model_strength: r.default_model_strength,
      default_clip_strength: r.default_clip_strength,
      trigger_word: r.trigger_word,
      nickname: r.nickname,
      stemFilename: normalizeModelStem(r.filename),
      stemName: normalizeModelStem(r.name),
      stemNickname: r.nickname ? normalizeModelStem(r.nickname) : null,
      alnumFilename: normalizeModelAlnum(r.filename),
      alnumName: normalizeModelAlnum(r.name),
    };

    allRows.push(indexed);
    if (indexed.sha256_hash) bySha256.set(indexed.sha256_hash.trim().toUpperCase(), indexed);
    if (indexed.autov2_hash) byAutoV2.set(indexed.autov2_hash.trim().toUpperCase(), indexed);
    if (indexed.civitai_version_id) byVersionId.set(String(indexed.civitai_version_id).trim(), indexed);
    if (indexed.filename) byFilename.set(path.basename(indexed.filename).trim().toLowerCase(), indexed);

    if (!r.is_hidden) {
      visibleRows.push(indexed);
      if (indexed.model_type === 'lora') {
        visibleLoras.push(indexed);
      } else if (indexed.model_type === 'diffusion' || indexed.model_type === 'checkpoint') {
        visibleBases.push(indexed);
      }
    }
  }

  cachedInstalledModelsIndex = {
    allRows,
    visibleRows,
    visibleLoras,
    visibleBases,
    bySha256,
    byAutoV2,
    byVersionId,
    byFilename,
  };
  return cachedInstalledModelsIndex;
}

/**
 * Returns cached installed `models` rows for Downloader annotations or Quick Gen URL imports.
 */
export function loadInstalledModelsForMatching(options?: {
  excludeHidden?: boolean;
}): IndexedInstalledModel[] {
  const index = getInstalledModelsIndex();
  return options?.excludeHidden ? index.visibleRows : index.allRows;
}

/**
 * Returns pre-partitioned visible LoRA and Base Model buckets from the cached index.
 */
export function getVisibleInstalledModelBuckets(): {
  loras: IndexedInstalledModel[];
  bases: IndexedInstalledModel[];
} {
  const index = getInstalledModelsIndex();
  return { loras: index.visibleLoras, bases: index.visibleBases };
}

/**
 * Matches a single Civitai resource candidate against a list of installed local models
 * by Civitai version ID, SHA-256/AutoV2 hash, stem, or alphanumeric fallback.
 */
export function findInstalledModelMatch<T extends InstalledModelRecord>(
  candidate: { versionId: string | null; name: string; hash: string | null },
  installedRows: T[]
): T | null {
  if (candidate.versionId) {
    const byVer = installedRows.find(
      (r) => r.civitai_version_id && String(r.civitai_version_id).trim() === candidate.versionId
    );
    if (byVer) return byVer;
  }

  if (candidate.hash) {
    const h = candidate.hash.trim().toLowerCase();
    const byHash = installedRows.find(
      (r) =>
        (r.autov2_hash && r.autov2_hash.toLowerCase() === h) ||
        (r.sha256_hash && r.sha256_hash.toLowerCase().startsWith(h))
    );
    if (byHash) return byHash;
  }

  const candStem = normalizeModelStem(candidate.name);
  const candAlnum = normalizeModelAlnum(candidate.name);
  if (!candStem && !candAlnum) return null;

  const exactStem = installedRows.find((r) => {
    const idx = r as unknown as Partial<IndexedInstalledModel>;
    const fStem = idx.stemFilename ?? normalizeModelStem(r.filename);
    const nStem = idx.stemName ?? normalizeModelStem(r.name);
    const nickStem =
      idx.stemNickname !== undefined
        ? idx.stemNickname
        : r.nickname
        ? normalizeModelStem(r.nickname)
        : null;
    return fStem === candStem || nStem === candStem || nickStem === candStem;
  });
  if (exactStem) return exactStem;

  if (candAlnum.length >= 4) {
    return (
      installedRows.find((r) => {
        const idx = r as unknown as Partial<IndexedInstalledModel>;
        const fAlnum = idx.alnumFilename ?? normalizeModelAlnum(r.filename);
        const nAlnum = idx.alnumName ?? normalizeModelAlnum(r.name);
        return fAlnum === candAlnum || nAlnum === candAlnum;
      }) || null
    );
  }

  return null;
}

function matchSingleFileToIndex(
  file: Pick<ExternalModelFileOption, 'sha256Hash' | 'filename'>,
  index: ReturnType<typeof getInstalledModelsIndex>
): ExternalModelInstalledInfo {
  if (file.sha256Hash) {
    const h = file.sha256Hash.trim().toUpperCase();
    const m = index.bySha256.get(h) || index.byAutoV2.get(h.slice(0, 10));
    if (m) {
      return {
        isInstalled: true,
        installedModelId: m.id,
        installedFilename: m.filename,
        installedModelType: m.model_type as ModelType,
        installedLoraCategory: (m.lora_category as LoraCategory) || 'unclassified',
        installedMatchReason: 'hash',
      };
    }
  }

  if (file.filename) {
    const m = index.byFilename.get(path.basename(file.filename).trim().toLowerCase());
    if (m) {
      return {
        isInstalled: true,
        installedModelId: m.id,
        installedFilename: m.filename,
        installedModelType: m.model_type as ModelType,
        installedLoraCategory: (m.lora_category as LoraCategory) || 'unclassified',
        installedMatchReason: 'filename',
      };
    }
  }

  return {
    isInstalled: false,
    installedModelId: null,
    installedFilename: null,
    installedModelType: null,
    installedLoraCategory: null,
    installedMatchReason: null,
  };
}

/**
 * Annotates individual repository/version weight files with local installation match metadata.
 */
export function annotateInstalledFileOptions(
  files: ExternalModelFileOption[]
): ExternalModelFileOption[] {
  if (!files || files.length === 0) return files;
  const index = getInstalledModelsIndex();
  if (index.allRows.length === 0) return files;
  return files.map((file) => ({
    ...file,
    ...matchSingleFileToIndex(file, index),
  }));
}

/**
 * Annotates search results (and each nested version/file option) with local installation matches
 * checked against SHA-256 hash, Civitai version ID, and filename using the cached model index.
 */
export function annotateInstalledSearchResults(
  items: ExternalModelSearchResult[]
): ExternalModelSearchResult[] {
  if (!items || items.length === 0) return items;

  const index = getInstalledModelsIndex();
  const { allRows, bySha256, byAutoV2, byVersionId, byFilename } = index;
  if (allRows.length === 0) return items;

  const resolveMatch = (entry: {
    provider?: ExternalModelSearchResult['provider'];
    sha256Hash?: string | null;
    versionId?: string | null;
    filename?: string | null;
    availableFiles?: ExternalModelFileOption[];
  }): ExternalModelInstalledInfo & { availableFiles?: ExternalModelFileOption[] } => {
    const annotatedFiles = entry.availableFiles
      ? entry.availableFiles.map((f) => ({ ...f, ...matchSingleFileToIndex(f, index) }))
      : undefined;

    // Multi-file Hugging Face repos are component bundles: track partial vs full installation per file
    if (entry.provider === 'huggingface' && annotatedFiles && annotatedFiles.length > 1) {
      const installedMatches = annotatedFiles.filter((f) => f.isInstalled);
      const installedFilesCount = installedMatches.length;
      const totalFilesCount = annotatedFiles.length;
      const firstMatch = installedMatches[0] || null;
      const isFullyInstalled = installedFilesCount === totalFilesCount;
      const isPartiallyInstalled = installedFilesCount > 0 && !isFullyInstalled;

      return {
        isInstalled: isFullyInstalled,
        isPartiallyInstalled,
        installedFilesCount,
        totalFilesCount,
        installedModelId: firstMatch?.installedModelId ?? null,
        installedFilename: firstMatch?.installedFilename ?? null,
        installedModelType: firstMatch?.installedModelType ?? null,
        installedLoraCategory: firstMatch?.installedLoraCategory ?? null,
        installedMatchReason: firstMatch?.installedMatchReason ?? null,
        availableFiles: annotatedFiles,
      };
    }

    const hashes = new Set<string>();
    if (entry.sha256Hash) hashes.add(entry.sha256Hash.trim().toUpperCase());
    for (const f of annotatedFiles || []) {
      if (f.sha256Hash) hashes.add(f.sha256Hash.trim().toUpperCase());
    }

    for (const h of hashes) {
      const m = bySha256.get(h) || byAutoV2.get(h.slice(0, 10));
      if (m) {
        return {
          isInstalled: true,
          isPartiallyInstalled: false,
          installedModelId: m.id,
          installedFilename: m.filename,
          installedModelType: m.model_type as ModelType,
          installedLoraCategory: (m.lora_category as LoraCategory) || 'unclassified',
          installedMatchReason: 'hash',
          ...(annotatedFiles ? { availableFiles: annotatedFiles } : {}),
        };
      }
    }

    if (entry.versionId) {
      const m = byVersionId.get(String(entry.versionId).trim());
      if (m) {
        return {
          isInstalled: true,
          isPartiallyInstalled: false,
          installedModelId: m.id,
          installedFilename: m.filename,
          installedModelType: m.model_type as ModelType,
          installedLoraCategory: (m.lora_category as LoraCategory) || 'unclassified',
          installedMatchReason: 'version_id',
          ...(annotatedFiles ? { availableFiles: annotatedFiles } : {}),
        };
      }
    }

    if (entry.filename) {
      const m = byFilename.get(path.basename(entry.filename).trim().toLowerCase());
      if (m) {
        return {
          isInstalled: true,
          isPartiallyInstalled: false,
          installedModelId: m.id,
          installedFilename: m.filename,
          installedModelType: m.model_type as ModelType,
          installedLoraCategory: (m.lora_category as LoraCategory) || 'unclassified',
          installedMatchReason: 'filename',
          ...(annotatedFiles ? { availableFiles: annotatedFiles } : {}),
        };
      }
    }

    return {
      isInstalled: false,
      isPartiallyInstalled: false,
      installedModelId: null,
      installedFilename: null,
      installedModelType: null,
      installedLoraCategory: null,
      installedMatchReason: null,
      ...(annotatedFiles ? { availableFiles: annotatedFiles } : {}),
    };
  };

  return items.map((item) => {
    const annotatedVersions = item.availableVersions?.map((v) => ({
      ...v,
      ...resolveMatch({
        provider: item.provider,
        sha256Hash: v.sha256Hash,
        versionId: v.versionId,
        filename: v.filename,
        availableFiles: v.availableFiles,
      }),
    }));

    return {
      ...item,
      ...resolveMatch(item),
      ...(annotatedVersions ? { availableVersions: annotatedVersions } : {}),
    };
  });
}
