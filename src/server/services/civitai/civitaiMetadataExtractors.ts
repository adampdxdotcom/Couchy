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
