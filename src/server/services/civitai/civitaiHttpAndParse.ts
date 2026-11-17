import path from 'path';
import { appConfig } from '../../config.ts';
import { DOWNLOAD_WEIGHT_EXTS, inferSubfolderAndTypeFromPath } from '../modelDownloadPaths.ts';
import { classifyLoraFromMetadata } from '../loraClassifierService.ts';
import type {
  ExternalModelFileOption,
  ExternalModelSearchResult,
  ExternalModelVersionOption,
  LoraCategory,
  ModelPreviewImage,
} from '../../../shared/types.ts';

export type CivitaiDomain = 'civitai.com' | 'civitai.red';

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

export interface CivitaiEarlyAccessInfo {
  earlyAccessEndsAt: string | null;
  isEarlyAccessActive: boolean;
  availability: string | null;
  earlyAccessConfig: {
    downloadPrice?: number | null;
    timeframe?: number | null;
  } | null;
}

export interface ParsedCivitaiShareUrl {
  kind: 'image' | 'post';
  id: number;
  domain: CivitaiDomain;
  cleanUrl: string;
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

export function getCivitaiHeaders(): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (appConfig.civitaiApiKey) {
    headers.Authorization = `Bearer ${appConfig.civitaiApiKey}`;
  }
  return headers;
}

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
 * Parses modelId and versionId from an existing Civitai URL if present.
 */
export function parseIdsFromCivitaiUrl(urlStr?: string | null): {
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
 * Parses a Civitai share URL (`/images/:id` or `/posts/:id`) on `civitai.com` or `civitai.red`.
 */
export function parseCivitaiShareUrl(rawUrl: string): ParsedCivitaiShareUrl | null {
  const trimmed = String(rawUrl || '').trim();
  if (!trimmed) return null;
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return null;
  }

  const host = parsed.hostname.toLowerCase();
  if (!/^(www\.)?civitai\.(com|red)$/.test(host)) return null;

  const match = parsed.pathname.match(/^\/(images|posts)\/(\d+)(?:\/|$)/i);
  if (!match) return null;

  const id = Number(match[2]);
  if (!Number.isFinite(id) || id <= 0) return null;

  return {
    kind: match[1].toLowerCase() === 'posts' ? 'post' : 'image',
    id,
    domain: host.endsWith('civitai.red') ? 'civitai.red' : 'civitai.com',
    cleanUrl: parsed.toString(),
  };
}

export function isLoraResourceType(rawType: unknown): boolean {
  const t = String(rawType || '').trim().toLowerCase();
  return t === 'lora' || t === 'locon' || t === 'dora' || t === 'lycoris';
}

export function isBaseModelResourceType(rawType: unknown): boolean {
  const t = String(rawType || '').trim().toLowerCase();
  return t === 'checkpoint' || t === 'model' || t === 'diffusion';
}

/**
 * Returns true strictly for Krea 2 ecosystem baseModel labels (excluding Flux.1 Krea, SDXL, Pony, etc.).
 */
export function isKrea2BaseModel(rawBaseModel?: string | null): boolean {
  const clean = String(rawBaseModel || '').trim().toLowerCase();
  if (!clean || clean === 'other') return false;
  if (clean.includes('flux')) return false;
  return clean === 'krea' || /\bkrea\s*2\b/i.test(clean) || /^krea\b/i.test(clean);
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
 * Extracts Early Access unlock timestamp, availability, and pricing config from a Civitai model version payload.
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
  limit = 4
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

function clampRecommendedWeight(n: number): number | null {
  if (!Number.isFinite(n) || n < -10.0 || n > 10.0) return null;
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
          const w = clampRecommendedWeight(r.weight);
          if (w !== null) return w;
        }
      }
      for (const r of resources) {
        if (String(r?.type || '').toLowerCase() === 'lora' && typeof r?.weight === 'number') {
          const w = clampRecommendedWeight(r.weight);
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
      const w = clampRecommendedWeight(Number(match[2]));
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
      const mid = clampRecommendedWeight((low + high) / 2);
      if (mid !== null) return mid;
    }

    const singleMatch = desc.match(
      /(?:recommended\s+)?(?:lora\s+)?(?:weight|strength)\s*(?:is|:|=|-|\bat\b)?\s*([01](?:\.[0-9]{1,2})?)/i
    );
    if (singleMatch) {
      const w = clampRecommendedWeight(Number(singleMatch[1]));
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

  const previewImages = extractStaticPreviewImages(versionObj, 4);

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

/**
 * Extracts all weight files from a Civitai modelVersion response.
 */
export function extractCivitaiVersionFiles(
  ver: any,
  explicitCivitaiType?: string,
  baseModel?: string | null,
  domain: CivitaiDomain = 'civitai.com'
): ExternalModelFileOption[] {
  const rawFiles = Array.isArray(ver?.files) ? ver.files : [];
  const options: ExternalModelFileOption[] = [];

  for (const f of rawFiles) {
    const name = String(f?.name || '').trim();
    if (!name) continue;
    const ext = path.extname(name).toLowerCase();
    if (!DOWNLOAD_WEIGHT_EXTS.has(ext) && rawFiles.length > 1) continue;

    const inferred = inferSubfolderAndTypeFromPath(name, [], explicitCivitaiType, baseModel);
    const rawDlUrl = f.downloadUrl || ver.downloadUrl;
    options.push({
      rfilename: name,
      filename: path.basename(name),
      fileSize: f.sizeKB ? Math.round(Number(f.sizeKB) * 1024) : null,
      sha256Hash: f.hashes?.SHA256 ? String(f.hashes.SHA256).toUpperCase() : null,
      downloadUrl: rewriteCivitaiDownloadUrl(rawDlUrl, domain),
      modelType: inferred.modelType,
      suggestedSubfolder: inferred.suggestedSubfolder,
    });
  }

  return options;
}

/**
 * Builds a normalized version option from a Civitai modelVersion object and parent model.
 */
export function buildCivitaiVersionOption(
  parentModel: any,
  versionObj: any,
  rawType: string,
  domain: CivitaiDomain
): ExternalModelVersionOption | null {
  if (!versionObj) return null;
  const verDomain = resolveCivitaiDomain(parentModel, versionObj, domain);
  const availableFiles = extractCivitaiVersionFiles(
    versionObj,
    rawType,
    versionObj.baseModel,
    verDomain
  );
  const primaryFile = availableFiles[0];
  if (!primaryFile) return null;

  const meta = normalizeCivitaiData(
    parentModel || { id: versionObj.modelId, ...versionObj.model },
    versionObj,
    primaryFile.filename,
    verDomain
  );
  const earlyAccess = extractCivitaiEarlyAccessInfo(versionObj);
  const inferred = inferSubfolderAndTypeFromPath(
    primaryFile.filename,
    [],
    rawType,
    meta.baseModel
  );

  const parentTags = Array.isArray(parentModel?.tags)
    ? parentModel.tags
    : Array.isArray(versionObj?.model?.tags)
    ? versionObj.model.tags
    : [];
  const suggestedLoraCategory: LoraCategory | null =
    inferred.modelType === 'lora'
      ? classifyLoraFromMetadata({
          name: parentModel?.name || versionObj?.model?.name || versionObj?.name,
          filename: primaryFile.filename,
          tags: parentTags,
          trainedWords: meta.trainedWords,
          description: meta.civitaiDescription,
          baseModel: meta.baseModel,
        })
      : null;

  return {
    versionId: meta.civitaiVersionId || String(versionObj.id),
    versionName: versionObj.name || 'Latest',
    civitaiUrl: meta.civitaiUrl,
    baseModel: meta.baseModel,
    trainedWords: meta.trainedWords,
    recommendedWeight: meta.recommendedWeight,
    previewImageUrl: meta.previewImages[0]?.url || null,
    previewImages: meta.previewImages,
    civitaiDescription: meta.civitaiDescription,
    filename: primaryFile.filename,
    fileSize: primaryFile.fileSize,
    sha256Hash: primaryFile.sha256Hash,
    downloadUrl: primaryFile.downloadUrl,
    modelType: inferred.modelType,
    suggestedSubfolder: inferred.suggestedSubfolder,
    suggestedLoraCategory,
    subfolderHint: inferred.subfolderHint || null,
    availableFiles,
    ...earlyAccess,
  };
}

/**
 * Extracts all downloadable versions from a Civitai parent model, ensuring `primaryVersion` is included.
 */
export function extractCivitaiVersions(
  parentModel: any,
  primaryVersion: any,
  rawType: string,
  domain: CivitaiDomain
): ExternalModelVersionOption[] {
  const candidates: any[] = [];
  if (primaryVersion) candidates.push(primaryVersion);
  if (Array.isArray(parentModel?.modelVersions)) {
    for (const v of parentModel.modelVersions) {
      candidates.push(v);
    }
  }

  const seenIds = new Set<string>();
  const versions: ExternalModelVersionOption[] = [];
  for (const cand of candidates) {
    const built = buildCivitaiVersionOption(parentModel, cand, rawType, domain);
    if (!built || seenIds.has(built.versionId)) continue;
    seenIds.add(built.versionId);
    versions.push(built);
  }
  return versions;
}

/**
 * Builds an ExternalModelSearchResult card from resolved Civitai parent + version payloads.
 */
export function buildCivitaiSearchResultCard(params: {
  parentModel: any;
  targetVer: any;
  availableVersions: ExternalModelVersionOption[];
  activeVersion: ExternalModelVersionOption;
  fallbackDescription: string;
}): ExternalModelSearchResult {
  const { parentModel, targetVer, availableVersions, activeVersion, fallbackDescription } = params;
  const resolvedModelId = parentModel?.id || targetVer?.modelId;
  return {
    provider: 'civitai',
    id: String(resolvedModelId || targetVer.id),
    versionId: activeVersion.versionId,
    civitaiUrl: activeVersion.civitaiUrl,
    name: parentModel?.name || targetVer.model?.name || activeVersion.filename,
    modelType: activeVersion.modelType,
    suggestedSubfolder: activeVersion.suggestedSubfolder,
    suggestedLoraCategory: activeVersion.suggestedLoraCategory ?? null,
    subfolderHint: activeVersion.subfolderHint || null,
    versionName: activeVersion.versionName,
    baseModel: activeVersion.baseModel,
    trainedWords: activeVersion.trainedWords,
    recommendedWeight: activeVersion.recommendedWeight,
    previewImageUrl: activeVersion.previewImageUrl,
    previewImages: activeVersion.previewImages,
    civitaiDescription: activeVersion.civitaiDescription,
    filename: activeVersion.filename,
    fileSize: activeVersion.fileSize,
    sha256Hash: activeVersion.sha256Hash,
    downloadUrl: activeVersion.downloadUrl,
    creator:
      parentModel?.creator?.username || targetVer.model?.creator?.username || 'Civitai Creator',
    description: activeVersion.civitaiDescription?.slice(0, 220) || fallbackDescription,
    availableFiles: activeVersion.availableFiles,
    totalRepoFilesCount: activeVersion.availableFiles.length,
    availableVersions,
    earlyAccessEndsAt: activeVersion.earlyAccessEndsAt,
    isEarlyAccessActive: activeVersion.isEarlyAccessActive,
    availability: activeVersion.availability,
    earlyAccessConfig: activeVersion.earlyAccessConfig,
  };
}

/**
 * Resolves a pasted Civitai model page or API download URL (.com or .red) into an ExternalModelSearchResult card.
 */
export async function resolveCivitaiModelUrl(input: string): Promise<ExternalModelSearchResult> {
  const url = new URL(input);
  const initialDomain: CivitaiDomain = url.hostname.toLowerCase().endsWith('civitai.red')
    ? 'civitai.red'
    : 'civitai.com';
  let detectedDomain: CivitaiDomain = initialDomain;
  const headers = getCivitaiHeaders();

  const verParam = url.searchParams.get('modelVersionId');
  const apiDownloadMatch = url.pathname.match(/\/api\/download\/models\/(\d+)/i);
  const modelPageMatch = url.pathname.match(/\/models\/(\d+)/i);

  let parentModel: any = null;
  let targetVer: any = null;

  if (apiDownloadMatch || (verParam && !modelPageMatch)) {
    const verId = apiDownloadMatch ? apiDownloadMatch[1] : verParam!;
    const verRes = await fetchCivitaiJsonWithFallback(
      `/api/v1/model-versions/${verId}`,
      headers,
      initialDomain
    );
    if (!verRes?.data) {
      throw new Error(`Civitai version ${verId} lookup failed on both civitai.com and civitai.red`);
    }
    targetVer = verRes.data;
    if (verRes.domain === 'civitai.red') detectedDomain = 'civitai.red';
    if (targetVer?.modelId) {
      const parentRes = await fetchCivitaiParentModelWithDomain(
        targetVer.modelId,
        headers,
        detectedDomain
      );
      parentModel = parentRes.model;
      if (parentRes.domain === 'civitai.red') detectedDomain = 'civitai.red';
    }
  } else if (modelPageMatch) {
    const modelId = modelPageMatch[1];
    const parentRes = await fetchCivitaiParentModelWithDomain(modelId, headers, initialDomain);
    parentModel = parentRes.model;
    if (parentRes.domain === 'civitai.red') detectedDomain = 'civitai.red';
    if (!parentModel) {
      throw new Error(`Civitai model ${modelId} not found.`);
    }
    const versions: any[] = Array.isArray(parentModel.modelVersions)
      ? parentModel.modelVersions
      : [];
    targetVer =
      (verParam ? versions.find((v) => String(v.id) === String(verParam)) : null) || versions[0];
  }

  if (!targetVer) {
    throw new Error('Could not resolve a downloadable model version from that Civitai URL.');
  }

  const resolvedModelId = parentModel?.id || targetVer.modelId;
  let finalDomain = resolveCivitaiDomain(parentModel, targetVer, detectedDomain);
  if (finalDomain === 'civitai.com' && resolvedModelId) {
    finalDomain = await probeCivitaiWebDomain(resolvedModelId, finalDomain);
  }

  const rawType = String(parentModel?.type || targetVer?.model?.type || 'Checkpoint');
  const availableVersions = extractCivitaiVersions(
    parentModel,
    targetVer,
    rawType,
    finalDomain
  );
  const activeVersion =
    availableVersions.find((v) => v.versionId === String(targetVer.id)) ||
    availableVersions[0];

  if (!activeVersion) {
    throw new Error('No downloadable weight files found on that Civitai model version.');
  }

  return buildCivitaiSearchResultCard({
    parentModel,
    targetVer,
    availableVersions,
    activeVersion,
    fallbackDescription: 'Resolved from Civitai URL',
  });
}
