import type { ModelPreviewImage } from '../../../shared/types.ts';

export type CivitaiDomain = 'civitai.com' | 'civitai.red';

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
    const dlMatch = u.pathname.match(/\/api\/download\/models\/(\d+)/i);
    const mMatch = dlMatch ? null : u.pathname.match(/^\/models\/(\d+)/i);
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
