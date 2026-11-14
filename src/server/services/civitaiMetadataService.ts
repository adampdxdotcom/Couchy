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

export function buildCivitaiUrl(
  modelId?: string | number | null,
  versionId?: string | number | null
): string | null {
  const mId = modelId ? String(modelId).trim() : '';
  const vId = versionId ? String(versionId).trim() : '';
  if (!mId) return null;
  return vId
    ? `https://civitai.com/models/${encodeURIComponent(mId)}?modelVersionId=${encodeURIComponent(vId)}`
    : `https://civitai.com/models/${encodeURIComponent(mId)}`;
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
  fallbackFilename?: string | null
): CivitaiNormalizedMeta {
  const civitaiId = modelObj?.id
    ? String(modelObj.id)
    : versionObj?.modelId
    ? String(versionObj.modelId)
    : null;
  const civitaiVersionId = versionObj?.id ? String(versionObj.id) : null;
  const civitaiUrl = buildCivitaiUrl(civitaiId, civitaiVersionId);
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

function getCivitaiHeaders(): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (appConfig.civitaiApiKey) {
    headers.Authorization = `Bearer ${appConfig.civitaiApiKey}`;
  }
  return headers;
}

/**
 * Fetches full parent model details (`description`, `creator`, `name`) for a Civitai model ID.
 */
export async function fetchCivitaiParentModel(
  modelId: string | number,
  headers = getCivitaiHeaders()
): Promise<any | null> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    const res = await fetch(`https://civitai.com/api/v1/models/${encodeURIComponent(String(modelId))}`, {
      headers,
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

/**
 * Resolves Civitai metadata for an existing model row via SHA-256 / AutoV2 hash lookup
 * (with fallback to stored `civitai_version_id` / `civitai_id`), caches thumbnails locally,
 * and applies non-destructive metadata enrichment.
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

  const headers = getCivitaiHeaders();
  let versionObj: any = null;
  let modelObj: any = null;

  // 1. Prefer exact hash lookup when SHA-256 or AutoV2 hash is known
  const hashesToTry = [sha256, autov2].filter((h): h is string => Boolean(h && h.trim()));
  for (const h of hashesToTry) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 9000);
      const res = await fetch(
        `https://civitai.com/api/v1/model-versions/by-hash/${encodeURIComponent(h.trim())}`,
        { headers, signal: controller.signal }
      );
      clearTimeout(timer);
      if (res.ok) {
        versionObj = await res.json();
        break;
      }
    } catch {
      // try next hash or fallback
    }
  }

  // 2. Fallback to stored Civitai version or model IDs if hash lookup missed
  if (!versionObj && row.civitai_version_id) {
    try {
      const res = await fetch(
        `https://civitai.com/api/v1/model-versions/${encodeURIComponent(String(row.civitai_version_id))}`,
        { headers }
      );
      if (res.ok) versionObj = await res.json();
    } catch {
      // ignore
    }
  }

  if (!versionObj && row.civitai_id) {
    modelObj = await fetchCivitaiParentModel(row.civitai_id, headers);
    if (modelObj?.modelVersions?.length) {
      versionObj = modelObj.modelVersions[0];
    }
  }

  if (!versionObj) {
    const err: any = new Error(
      hashesToTry.length > 0
        ? 'No matching model found on Civitai for this file hash.'
        : 'Cannot look up model on Civitai: no local file hash or Civitai ID available.'
    );
    err.statusCode = 404;
    throw err;
  }

  const resolvedParentId = versionObj.modelId || row.civitai_id;
  if (!modelObj && resolvedParentId) {
    modelObj = await fetchCivitaiParentModel(resolvedParentId, headers);
  }
  if (!modelObj && versionObj.model) {
    modelObj = { id: resolvedParentId, ...versionObj.model };
  }

  const meta = normalizeCivitaiData(modelObj, versionObj, row.filename);
  const cacheKey = `m${row.id}_${meta.civitaiVersionId || row.autov2_hash || 'v'}`;
  const cachedPreviews = await cacheModelPreviewImages(cacheKey, meta.previewImages);
  const { filledTriggerWord, filledDefaultStrength } = applyCivitaiEnrichmentToModel(
    row.id,
    meta,
    cachedPreviews
  );

  return { meta, cachedPreviews, filledTriggerWord, filledDefaultStrength };
}
