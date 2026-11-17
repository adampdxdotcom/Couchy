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

/**
 * Applies Civitai enrichment metadata onto an existing `models` row.
 * Follows the non-destructive conflict policy: only fills `trigger_word` when empty
 * and `default_model_strength` when still at the `1.0` default.
 */
export function applyCivitaiEnrichmentToModel(
  modelId: number,
  meta: CivitaiNormalizedMeta,
  cachedPreviews: StoredPreviewImageEntry[],
  extraMeta?: { hfRepoId?: string | null; downloadUrl?: string | null }
): { filledTriggerWord: boolean; filledDefaultStrength: boolean } {
  const existing = db
    .prepare(
      `SELECT id, trigger_word, default_model_strength, civitai_id, civitai_version_id,
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

  db.prepare(
    `UPDATE models
     SET civitai_id = COALESCE(?, civitai_id),
         civitai_version_id = COALESCE(?, civitai_version_id),
         civitai_url = COALESCE(?, civitai_url),
         hf_repo_id = COALESCE(?, hf_repo_id),
         download_url = COALESCE(download_url, ?),
         base_model = COALESCE(?, base_model),
         recommended_weight = COALESCE(?, recommended_weight),
         civitai_description = COALESCE(?, civitai_description),
         preview_images_json = ?,
         trigger_word = ?,
         default_model_strength = ?,
         civitai_fetched_at = datetime('now')
     WHERE id = ?`
  ).run(
    meta.civitaiId,
    meta.civitaiVersionId,
    meta.civitaiUrl,
    extraMeta?.hfRepoId || null,
    extraMeta?.downloadUrl || null,
    meta.baseModel,
    meta.recommendedWeight,
    meta.civitaiDescription,
    nextPreviewsJson,
    nextTriggerWord,
    nextModelStrength,
    modelId
  );

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
  options?: { allowHuggingFaceFallback?: boolean }
): Promise<{
  provider: 'civitai' | 'huggingface';
  hfRepoId: string | null;
  meta: CivitaiNormalizedMeta;
  cachedPreviews: StoredPreviewImageEntry[];
  filledTriggerWord: boolean;
  filledDefaultStrength: boolean;
}> {
  const allowHfFallback = options?.allowHuggingFaceFallback !== false;
  const row = db.prepare('SELECT * FROM models WHERE id = ?').get(modelId) as any;
  if (!row) {
    const err: any = new Error('Model not found');
    err.statusCode = 404;
    throw err;
  }

  let sha256: string | null = row.sha256_hash || null;
  let autov2: string | null = row.autov2_hash || null;

  if (!sha256 && row.file_path && fs.existsSync(row.file_path)) {
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

  const parsedFromUrl = parseIdsFromCivitaiUrl(row.civitai_url || row.download_url);
  const storedCivitaiId = row.civitai_id || parsedFromUrl.modelId;
  const storedVersionId = row.civitai_version_id || parsedFromUrl.versionId;
  let detectedDomain: CivitaiDomain = parsedFromUrl.domain || 'civitai.com';

  const headers = getCivitaiHeaders();
  let versionObj: any = null;
  let modelObj: any = null;

  // 1. Prefer exact hash lookup when SHA-256 or AutoV2 hash is known (tries .com then .red)
  const hashesToTry = [sha256, autov2].filter((h): h is string => Boolean(h && h.trim()));
  for (const h of hashesToTry) {
    const found = await fetchCivitaiJsonWithFallback(
      `/api/v1/model-versions/by-hash/${encodeURIComponent(h.trim())}`,
      headers,
      detectedDomain,
      9000
    );
    if (found?.data) {
      versionObj = found.data;
      if (found.domain === 'civitai.red') detectedDomain = 'civitai.red';
      break;
    }
  }

  // 2. Fallback to stored Civitai version or model IDs if hash lookup missed
  if (!versionObj && storedVersionId) {
    const foundVer = await fetchCivitaiJsonWithFallback(
      `/api/v1/model-versions/${encodeURIComponent(String(storedVersionId))}`,
      headers,
      detectedDomain
    );
    if (foundVer?.data) {
      versionObj = foundVer.data;
      if (foundVer.domain === 'civitai.red') detectedDomain = 'civitai.red';
    }
  }

  if (!versionObj && storedCivitaiId) {
    const parentRes = await fetchCivitaiParentModelWithDomain(
      storedCivitaiId,
      headers,
      detectedDomain
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
        };
      }
    }

    const err: any = new Error(
      hashesToTry.length > 0 || allowHfFallback
        ? 'No matching model found on Civitai or Hugging Face for this file.'
        : 'Cannot look up model on Civitai: no local file hash or Civitai ID available.'
    );
    err.statusCode = 404;
    throw err;
  }

  const resolvedParentId = versionObj.modelId || storedCivitaiId;
  if (!modelObj && resolvedParentId) {
    const parentRes = await fetchCivitaiParentModelWithDomain(
      resolvedParentId,
      headers,
      detectedDomain
    );
    modelObj = parentRes.model;
    if (parentRes.domain === 'civitai.red') detectedDomain = 'civitai.red';
  }
  if (!modelObj && versionObj.model) {
    modelObj = { id: resolvedParentId, ...versionObj.model };
  }

  let finalDomain = resolveCivitaiDomain(modelObj, versionObj, detectedDomain);
  if (finalDomain === 'civitai.com' && resolvedParentId) {
    finalDomain = await probeCivitaiWebDomain(resolvedParentId, finalDomain);
  }

  const meta = normalizeCivitaiData(modelObj, versionObj, row.filename, finalDomain);
  const cacheKey = `m${row.id}_${meta.civitaiVersionId || row.autov2_hash || 'v'}`;
  const cachedPreviews = await cacheModelPreviewImages(cacheKey, meta.previewImages);
  const { filledTriggerWord, filledDefaultStrength } = applyCivitaiEnrichmentToModel(
    row.id,
    meta,
    cachedPreviews
  );

  return {
    provider: 'civitai',
    hfRepoId: row.hf_repo_id || null,
    meta,
    cachedPreviews,
    filledTriggerWord,
    filledDefaultStrength,
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

/**
 * Annotates search results (and each nested version option) with local installation matches
 * checked against SHA-256 hash, Civitai version ID, and filename using the cached model index.
 */
export function annotateInstalledSearchResults(
  items: ExternalModelSearchResult[]
): ExternalModelSearchResult[] {
  if (!items || items.length === 0) return items;

  const { allRows, bySha256, byAutoV2, byVersionId, byFilename } = getInstalledModelsIndex();
  if (allRows.length === 0) return items;

  const resolveMatch = (entry: {
    sha256Hash?: string | null;
    versionId?: string | null;
    filename?: string | null;
    availableFiles?: ExternalModelFileOption[];
  }): ExternalModelInstalledInfo => {
    const hashes = new Set<string>();
    if (entry.sha256Hash) hashes.add(entry.sha256Hash.trim().toUpperCase());
    for (const f of entry.availableFiles || []) {
      if (f.sha256Hash) hashes.add(f.sha256Hash.trim().toUpperCase());
    }

    for (const h of hashes) {
      const m = bySha256.get(h) || byAutoV2.get(h.slice(0, 10));
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

    if (entry.versionId) {
      const m = byVersionId.get(String(entry.versionId).trim());
      if (m) {
        return {
          isInstalled: true,
          installedModelId: m.id,
          installedFilename: m.filename,
          installedModelType: m.model_type as ModelType,
          installedLoraCategory: (m.lora_category as LoraCategory) || 'unclassified',
          installedMatchReason: 'version_id',
        };
      }
    }

    if (entry.filename) {
      const m = byFilename.get(path.basename(entry.filename).trim().toLowerCase());
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
  };

  return items.map((item) => {
    const annotatedVersions = item.availableVersions?.map((v) => ({
      ...v,
      ...resolveMatch({
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
