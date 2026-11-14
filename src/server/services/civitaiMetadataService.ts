import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import sharp from 'sharp';
import { db } from '../db.ts';
import { appConfig } from '../config.ts';
import type { ModelPreviewImage } from '../../shared/types.ts';

export interface CivitaiNormalizedMeta {
  civitaiId: string | null;
  civitaiVersionId: string | null;
  civitaiUrl: string | null;
  baseModel: string | null;
  trainedWords: string[];
  recommendedWeight: number | null;
  civitaiDescription: string | null;
  previewImages: { url: string; width?: number | null; height?: number | null }[];
}

export interface StoredPreviewImageEntry {
  filename: string;
  width?: number | null;
  height?: number | null;
  sourceUrl?: string | null;
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

/**
 * Parses persisted `preview_images_json` into frontend-ready preview image descriptors.
 */
export function parsePreviewImagesJson(
  rawJson: string | null | undefined,
  modelId: number | null | undefined
): ModelPreviewImage[] {
  if (!rawJson || !modelId) return [];
  try {
    const parsed = JSON.parse(rawJson);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((p) => p && typeof p.filename === 'string' && p.filename.trim())
      .map((p) => ({
        filename: p.filename,
        url: `/api/models/${modelId}/preview/${encodeURIComponent(p.filename)}`,
        width: typeof p.width === 'number' ? p.width : null,
        height: typeof p.height === 'number' ? p.height : null,
        sourceUrl: typeof p.sourceUrl === 'string' ? p.sourceUrl : null,
      }));
  } catch {
    return [];
  }
}

export type CivitaiDomain = 'civitai.com' | 'civitai.red';

export function buildCivitaiUrl(
  modelId?: string | number | null,
  versionId?: string | number | null,
  domain: CivitaiDomain = 'civitai.com'
): string | null {
  const mId = modelId ? String(modelId).trim() : '';
  const vId = versionId ? String(versionId).trim() : '';
  if (!mId) return null;
  const host = domain === 'civitai.red' ? 'civitai.red' : 'civitai.com';
  return vId
    ? `https://${host}/models/${encodeURIComponent(mId)}?modelVersionId=${encodeURIComponent(vId)}`
    : `https://${host}/models/${encodeURIComponent(mId)}`;
}

/**
 * Determines whether a Civitai model/version belongs on `civitai.red` (NSFW / mature / delisted on .com)
 * or standard `civitai.com` based on API payload flags and fallback history.
 */
export function resolveCivitaiDomain(
  modelObj: any,
  versionObj: any,
  preferredDomain?: CivitaiDomain
): CivitaiDomain {
  if (preferredDomain === 'civitai.red') return 'civitai.red';

  if (
    Boolean(modelObj?.nsfw) ||
    Boolean(versionObj?.model?.nsfw) ||
    Boolean(versionObj?.nsfw) ||
    Boolean(modelObj?.poi) ||
    Boolean(versionObj?.model?.poi)
  ) {
    return 'civitai.red';
  }

  const maxNsfwLevel = Math.max(
    Number(modelObj?.nsfwLevel || 0),
    Number(versionObj?.model?.nsfwLevel || 0),
    Number(versionObj?.nsfwLevel || 0)
  );
  if (maxNsfwLevel >= 4) {
    return 'civitai.red';
  }

  const images = Array.isArray(versionObj?.images) ? versionObj.images : [];
  const hasRestrictedPreview = images.some((img: any) => {
    if (!img) return false;
    if (typeof img.nsfwLevel === 'number' && img.nsfwLevel >= 4) return true;
    if (img.nsfw === true) return true;
    if (typeof img.nsfw === 'string' && !['none', 'false', ''].includes(img.nsfw.toLowerCase())) {
      return true;
    }
    return false;
  });
  if (hasRestrictedPreview) {
    return 'civitai.red';
  }

  return 'civitai.com';
}

/**
 * Rewrites a Civitai download URL to match the resolved domain (`civitai.com` vs `civitai.red`).
 */
export function rewriteCivitaiDownloadUrl(
  downloadUrl: string | null | undefined,
  domain: CivitaiDomain
): string {
  const raw = String(downloadUrl || '').trim();
  if (!raw) return '';
  return raw.replace(/^https?:\/\/(www\.)?civitai\.(com|red)\//i, `https://${domain}/`);
}

export interface CivitaiEarlyAccessInfo {
  earlyAccessEndsAt: string | null;
  isEarlyAccessActive: boolean;
  availability: string | null;
  earlyAccessConfig: {
    downloadPrice?: number | null;
    timeframe?: number | null;
  } | null;
}

/**
 * Extracts Early Access unlock timestamp, availability, and pricing config from a Civitai model version payload.
 * Handles both documented (`earlyAccessEndsAt`, `earlyAccessConfig`) and live API (`earlyAccessDeadline`, `paidAccess.endsAt`) fields.
 */
export function extractCivitaiEarlyAccessInfo(versionObj: any): CivitaiEarlyAccessInfo {
  const candidateDates = [
    versionObj?.earlyAccessEndsAt,
    versionObj?.earlyAccessDeadline,
    versionObj?.paidAccess?.endsAt,
  ];

  let earlyAccessEndsAt: string | null = null;
  let endsAtMs = NaN;

  for (const rawEnds of candidateDates) {
    if (typeof rawEnds === 'string' && rawEnds.trim()) {
      const parsed = Date.parse(rawEnds.trim());
      if (Number.isFinite(parsed)) {
        endsAtMs = parsed;
        earlyAccessEndsAt = new Date(parsed).toISOString();
        break;
      }
    }
  }

  const availability =
    typeof versionObj?.availability === 'string' && versionObj.availability.trim()
      ? versionObj.availability.trim()
      : null;

  const rawConfig = versionObj?.earlyAccessConfig;
  const rawPaid = versionObj?.paidAccess;
  const downloadPrice =
    typeof rawConfig?.downloadPrice === 'number'
      ? rawConfig.downloadPrice
      : typeof rawPaid?.price === 'number'
      ? rawPaid.price
      : typeof rawPaid?.downloadPrice === 'number'
      ? rawPaid.downloadPrice
      : null;
  const timeframe =
    typeof rawConfig?.timeframe === 'number'
      ? rawConfig.timeframe
      : typeof versionObj?.earlyAccessTimeFrame === 'number'
      ? versionObj.earlyAccessTimeFrame
      : null;

  const earlyAccessConfig =
    downloadPrice !== null || timeframe !== null
      ? { downloadPrice, timeframe }
      : null;

  const isFutureEnd = Number.isFinite(endsAtMs) && endsAtMs > Date.now();
  const isEarlyAccessActive = isFutureEnd || availability === 'EarlyAccess';

  return {
    earlyAccessEndsAt,
    isEarlyAccessActive,
    availability,
    earlyAccessConfig,
  };
}

/**
 * Computes a UTC ISO timestamp slightly after `earlyAccessEndsAt` (default +60s clock-skew buffer).
 */
export function computeScheduledUnlockIso(
  earlyAccessEndsAt: string | null | undefined,
  bufferSeconds = 60
): string {
  const now = Date.now();
  const parsed = earlyAccessEndsAt ? Date.parse(earlyAccessEndsAt) : NaN;
  const targetMs = Number.isFinite(parsed)
    ? Math.max(parsed + bufferSeconds * 1000, now + bufferSeconds * 1000)
    : now + 60 * 60 * 1000;
  return new Date(targetMs).toISOString();
}

function decodeHtmlEntities(input: string): string {
  const named: Record<string, string> = {
    '&amp;': '&',
    '&lt;': '<',
    '&gt;': '>',
    '&quot;': '"',
    '&#39;': "'",
    '&apos;': "'",
    '&nbsp;': ' ',
    '&ndash;': '–',
    '&mdash;': '—',
  };
  return input
    .replace(/&(amp|lt|gt|quot|#39|apos|nbsp|ndash|mdash);/gi, (m) => named[m.toLowerCase()] ?? m)
    .replace(/&#(\d+);/g, (_m, dec) => {
      const code = Number(dec);
      return Number.isFinite(code) && code > 0 ? String.fromCharCode(code) : '';
    })
    .replace(/&#x([0-9a-f]+);/gi, (_m, hex) => {
      const code = parseInt(hex, 16);
      return Number.isFinite(code) && code > 0 ? String.fromCharCode(code) : '';
    });
}

/**
 * Converts Civitai HTML descriptions into clean, readable plain text with preserved paragraphs and links.
 */
export function formatCivitaiHtmlDescription(rawHtml: string | null | undefined): string | null {
  if (!rawHtml || !String(rawHtml).trim()) return null;
  let text = String(rawHtml);
  text = text.replace(/<script[\s\S]*?<\/script>/gi, '');
  text = text.replace(/<style[\s\S]*?<\/style>/gi, '');
  text = text.replace(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi, (_m, href, inner) => {
    const label = inner.replace(/<[^>]+>/g, '').trim();
    const cleanHref = String(href || '').trim();
    if (!cleanHref.startsWith('http')) return label;
    if (!label || label === cleanHref) return cleanHref;
    return `${label} (${cleanHref})`;
  });
  text = text.replace(/<li\b[^>]*>/gi, '\n• ');
  text = text.replace(/<br\s*\/?>/gi, '\n');
  text = text.replace(/<\/(p|div|h[1-6]|li|tr|blockquote|pre|ul|ol)>/gi, '\n\n');
  text = text.replace(/<[^>]+>/g, '');
  text = decodeHtmlEntities(text);
  text = text
    .split('\n')
    .map((line) => line.replace(/[ \t]+/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return text || null;
}

function isStaticImageUrl(url: string, type?: string): boolean {
  if (type && String(type).toLowerCase() === 'video') return false;
  const clean = url.split('?')[0].toLowerCase();
  return !/\.(mp4|webm|mov|avi|mkv)$/.test(clean);
}

/**
 * Extracts up to `limit` static preview image entries from a Civitai model version payload.
 */
export function extractStaticPreviewImages(
  versionObj: any,
  limit = MAX_PREVIEW_IMAGES
): { url: string; width?: number | null; height?: number | null }[] {
  const imgs = Array.isArray(versionObj?.images) ? versionObj.images : [];
  const out: { url: string; width?: number | null; height?: number | null }[] = [];
  for (const img of imgs) {
    if (!img || typeof img.url !== 'string' || !img.url.trim()) continue;
    if (!isStaticImageUrl(img.url, img.type)) continue;
    out.push({
      url: img.url.trim(),
      width: typeof img.width === 'number' ? img.width : null,
      height: typeof img.height === 'number' ? img.height : null,
    });
    if (out.length >= limit) break;
  }
  return out;
}

function clampWeight(n: number): number | null {
  if (!Number.isFinite(n) || n < 0.05 || n > 2.0) return null;
  return Number(n.toFixed(2));
}

/**
 * Heuristically extracts a recommended LoRA/model weight from Civitai sample resources,
 * embedded prompt `<lora:...:w>` tags, and creator description hints.
 */
export function extractRecommendedWeight(
  versionObj: any,
  descriptionText?: string | null,
  modelNameOrFile?: string | null
): number | null {
  const imgs = Array.isArray(versionObj?.images) ? versionObj.images : [];
  const versionIdNum = versionObj?.id ? Number(versionObj.id) : null;

  // 1. Check structured civitaiResources inside sample image metadata
  for (const img of imgs) {
    const resources = img?.meta?.civitaiResources;
    if (Array.isArray(resources)) {
      for (const r of resources) {
        if (
          versionIdNum &&
          Number(r?.modelVersionId) === versionIdNum &&
          typeof r?.weight === 'number'
        ) {
          const w = clampWeight(r.weight);
          if (w !== null) return w;
        }
      }
      for (const r of resources) {
        if (String(r?.type || '').toLowerCase() === 'lora' && typeof r?.weight === 'number') {
          const w = clampWeight(r.weight);
          if (w !== null) return w;
        }
      }
    }
  }

  // 2. Check <lora:name:weight> tags in sample image prompts
  const targetStem = (modelNameOrFile || '')
    .toLowerCase()
    .replace(/\.(safetensors|ckpt|pt|bin)$/i, '')
    .replace(/[^a-z0-9]/g, '');
  const fallbackPromptWeights: number[] = [];
  for (const img of imgs) {
    const prompt = typeof img?.meta?.prompt === 'string' ? img.meta.prompt : '';
    if (!prompt) continue;
    const regex = /<lora:([^:>]+):([0-9]+(?:\.[0-9]+)?)>/gi;
    let match: RegExpExecArray | null;
    while ((match = regex.exec(prompt)) !== null) {
      const loraToken = match[1].toLowerCase().replace(/[^a-z0-9]/g, '');
      const w = clampWeight(Number(match[2]));
      if (w === null) continue;
      if (targetStem && (loraToken.includes(targetStem) || targetStem.includes(loraToken))) {
        return w;
      }
      fallbackPromptWeights.push(w);
    }
  }
  if (fallbackPromptWeights.length === 1) {
    return fallbackPromptWeights[0];
  }

  // 3. Parse common creator description weight/strength notes
  const desc = descriptionText || '';
  if (desc) {
    const rangeMatch = desc.match(
      /(?:recommended\s+)?(?:lora\s+)?(?:weight|strength)\s*(?:is|:|=|-|\bat\b)?\s*([01](?:\.[0-9]{1,2})?)\s*(?:[-–~]|to)\s*([01](?:\.[0-9]{1,2})?)/i
    );
    if (rangeMatch) {
      const low = Number(rangeMatch[1]);
      const high = Number(rangeMatch[2]);
      const mid = clampWeight((low + high) / 2);
      if (mid !== null) return mid;
    }

    const singleMatch = desc.match(
      /(?:recommended\s+)?(?:lora\s+)?(?:weight|strength)\s*(?:is|:|=|-|\bat\b)?\s*([01](?:\.[0-9]{1,2})?)/i
    );
    if (singleMatch) {
      const w = clampWeight(Number(singleMatch[1]));
      if (w !== null) return w;
    }
  }

  return null;
}

/**
 * Normalizes a Civitai parent model object and version object into shared metadata fields.
 */
export function normalizeCivitaiData(
  modelObj: any,
  versionObj: any,
  fallbackFilename?: string | null,
  preferredDomain?: CivitaiDomain
): CivitaiNormalizedMeta {
  const civitaiId = modelObj?.id
    ? String(modelObj.id)
    : versionObj?.modelId
    ? String(versionObj.modelId)
    : null;
  const civitaiVersionId = versionObj?.id ? String(versionObj.id) : null;
  const domain = resolveCivitaiDomain(modelObj, versionObj, preferredDomain);
  const civitaiUrl = buildCivitaiUrl(civitaiId, civitaiVersionId, domain);
  const baseModel =
    typeof versionObj?.baseModel === 'string' && versionObj.baseModel.trim()
      ? versionObj.baseModel.trim()
      : null;

  const rawWords = Array.isArray(versionObj?.trainedWords) ? versionObj.trainedWords : [];
  const trainedWords = Array.from(
    new Set<string>(
      rawWords
        .map((w: any) => String(w || '').trim())
        .filter((w: string) => w.length > 0)
    )
  );

  const parentDesc = formatCivitaiHtmlDescription(modelObj?.description);
  const versionDesc = formatCivitaiHtmlDescription(versionObj?.description);
  let civitaiDescription: string | null = null;
  if (parentDesc && versionDesc && !parentDesc.includes(versionDesc)) {
    civitaiDescription = `${parentDesc}\n\nVersion Notes:\n${versionDesc}`;
  } else {
    civitaiDescription = parentDesc || versionDesc || null;
  }

  const primaryFile = (versionObj?.files || [])[0];
  const recommendedWeight = extractRecommendedWeight(
    versionObj,
    civitaiDescription,
    primaryFile?.name || fallbackFilename || modelObj?.name
  );

  const previewImages = extractStaticPreviewImages(versionObj, MAX_PREVIEW_IMAGES);

  return {
    civitaiId,
    civitaiVersionId,
    civitaiUrl,
    baseModel,
    trainedWords,
    recommendedWeight,
    civitaiDescription,
    previewImages,
  };
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
  cachedPreviews: StoredPreviewImageEntry[]
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
    nextModelStrength = Math.max(0.0, Math.min(2.0, Number(meta.recommendedWeight)));
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
    meta.baseModel,
    meta.recommendedWeight,
    meta.civitaiDescription,
    nextPreviewsJson,
    nextTriggerWord,
    nextModelStrength,
    modelId
  );

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

export function getCivitaiHeaders(): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (appConfig.civitaiApiKey) {
    headers.Authorization = `Bearer ${appConfig.civitaiApiKey}`;
  }
  return headers;
}

/**
 * Queries a Civitai API path against `civitai.com` (or `preferredDomain`) first,
 * falling back to `civitai.red` when `.com` returns 404/non-OK.
 */
export async function fetchCivitaiJsonWithFallback(
  apiPath: string,
  headers = getCivitaiHeaders(),
  preferredDomain: CivitaiDomain = 'civitai.com',
  timeoutMs = 8000
): Promise<{ data: any; domain: CivitaiDomain } | null> {
  const cleanPath = apiPath.startsWith('/') ? apiPath : `/${apiPath}`;
  const domains: CivitaiDomain[] =
    preferredDomain === 'civitai.red'
      ? ['civitai.red', 'civitai.com']
      : ['civitai.com', 'civitai.red'];

  for (const domain of domains) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      const res = await fetch(`https://${domain}${cleanPath}`, {
        headers,
        signal: controller.signal,
      });
      clearTimeout(timer);
      if (res.ok) {
        const data = await res.json();
        return { data, domain };
      }
    } catch {
      // try fallback domain
    }
  }
  return null;
}

/**
 * Fetches parent model details across `civitai.com` and `civitai.red` and reports which domain resolved it.
 * If `civitai.com` fails (e.g. 404 for a restricted model), `domain` is set to `'civitai.red'`.
 */
export async function fetchCivitaiParentModelWithDomain(
  modelId: string | number,
  headers = getCivitaiHeaders(),
  preferredDomain: CivitaiDomain = 'civitai.com'
): Promise<{ model: any | null; domain: CivitaiDomain }> {
  const cleanId = encodeURIComponent(String(modelId));
  const result = await fetchCivitaiJsonWithFallback(
    `/api/v1/models/${cleanId}`,
    headers,
    preferredDomain
  );
  if (result) {
    const resolvedDomain = resolveCivitaiDomain(result.data, null, result.domain);
    return { model: result.data, domain: resolvedDomain };
  }
  // If .com failed to return the parent model, it is delisted/restricted on .com -> prefer .red
  return { model: null, domain: 'civitai.red' };
}

/**
 * Fetches full parent model details (`description`, `creator`, `name`) for a Civitai model ID.
 */
export async function fetchCivitaiParentModel(
  modelId: string | number,
  headers = getCivitaiHeaders()
): Promise<any | null> {
  const res = await fetchCivitaiParentModelWithDomain(modelId, headers);
  return res.model;
}

/**
 * Probes `https://civitai.com/models/{id}` when metadata flags alone did not indicate `civitai.red`.
 * If `civitai.com` returns 404/403/451 for the model web page, returns `'civitai.red'`.
 */
export async function probeCivitaiWebDomain(
  modelId: string | number | null | undefined,
  currentDomain: CivitaiDomain
): Promise<CivitaiDomain> {
  if (currentDomain === 'civitai.red' || !modelId) return currentDomain;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3500);
    const res = await fetch(`https://civitai.com/models/${encodeURIComponent(String(modelId))}`, {
      method: 'HEAD',
      redirect: 'manual',
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (res.status === 404 || res.status === 451 || res.status === 403) {
      return 'civitai.red';
    }
  } catch {
    // keep currentDomain on transient timeout
  }
  return currentDomain;
}

/**
 * Parses modelId and versionId from an existing Civitai URL if present.
 */
function parseIdsFromCivitaiUrl(urlStr?: string | null): {
  modelId: string | null;
  versionId: string | null;
  domain: CivitaiDomain | null;
} {
  if (!urlStr || !String(urlStr).trim()) {
    return { modelId: null, versionId: null, domain: null };
  }
  try {
    const u = new URL(String(urlStr).trim());
    const host = u.hostname.toLowerCase();
    const domain: CivitaiDomain | null = host.endsWith('civitai.red')
      ? 'civitai.red'
      : host.endsWith('civitai.com')
      ? 'civitai.com'
      : null;
    const mMatch = u.pathname.match(/\/models\/(\d+)/i);
    const dlMatch = u.pathname.match(/\/api\/download\/models\/(\d+)/i);
    const verParam = u.searchParams.get('modelVersionId');
    return {
      modelId: mMatch ? mMatch[1] : null,
      versionId: verParam || (dlMatch ? dlMatch[1] : null),
      domain,
    };
  } catch {
    return { modelId: null, versionId: null, domain: null };
  }
}

/**
 * Resolves Civitai metadata for an existing model row via SHA-256 / AutoV2 hash lookup
 * (with fallback to stored `civitai_version_id` / `civitai_id`), detects `civitai.red` vs `civitai.com`,
 * caches thumbnails locally, and applies non-destructive metadata enrichment.
 */
export async function fetchAndEnrichModelFromCivitai(modelId: number): Promise<{
  meta: CivitaiNormalizedMeta;
  cachedPreviews: StoredPreviewImageEntry[];
  filledTriggerWord: boolean;
  filledDefaultStrength: boolean;
}> {
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
    const err: any = new Error(
      hashesToTry.length > 0
        ? 'No matching model found on Civitai (.com or .red) for this file hash.'
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

  return { meta, cachedPreviews, filledTriggerWord, filledDefaultStrength };
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
      const { meta } = await fetchAndEnrichModelFromCivitai(row.id);
      if (meta.civitaiUrl?.includes('civitai.red')) {
        redCount++;
      }
      if (meta.civitaiUrl && meta.civitaiUrl !== previousUrl) {
        healed++;
      }
    } catch {
      // If API lookup failed completely, still check if a known civitai_id 404s on civitai.com web
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
