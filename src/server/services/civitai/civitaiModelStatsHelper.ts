import { parseIdsFromCivitaiUrl, type CivitaiDomain } from './civitaiUrlAndDomain.ts';
import type { CivitaiCommentRecord, CivitaiModelStatsSummary } from '../../../shared/apiTypes.ts';

/**
 * Extracts creator username from a Civitai model or modelVersion response object.
 */
export function extractCivitaiCreatorUsername(modelObj: any, versionObj?: any): string | null {
  const raw =
    modelObj?.creator?.username ??
    versionObj?.model?.creator?.username ??
    modelObj?.user?.username ??
    null;
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  return trimmed ? trimmed : null;
}

/**
 * Extracts model-level and matched version-level engagement metrics from Civitai REST responses.
 */
export function extractCivitaiModelStats(
  modelObj: any,
  versionObj?: any
): CivitaiModelStatsSummary {
  const mStats = modelObj?.stats || {};
  const vStats = versionObj?.stats || {};

  const downloadCount = Math.max(0, Number(mStats.downloadCount ?? vStats.downloadCount ?? 0));
  const thumbsUpCount = Math.max(0, Number(mStats.thumbsUpCount ?? vStats.thumbsUpCount ?? 0));
  const thumbsDownCount = Math.max(0, Number(mStats.thumbsDownCount ?? vStats.thumbsDownCount ?? 0));
  const commentCount = Math.max(0, Number(mStats.commentCount ?? 0));
  const tippedAmountCount = Math.max(0, Number(mStats.tippedAmountCount ?? 0));
  const totalVersionsCount = Array.isArray(modelObj?.modelVersions)
    ? modelObj.modelVersions.length
    : versionObj
    ? 1
    : 0;

  const matchedVersion =
    versionObj?.id
      ? {
          versionId: String(versionObj.id),
          versionName: String(versionObj.name || 'Version'),
          downloadCount: Math.max(0, Number(vStats.downloadCount || 0)),
          thumbsUpCount: Math.max(0, Number(vStats.thumbsUpCount || 0)),
          thumbsDownCount: Math.max(0, Number(vStats.thumbsDownCount || 0)),
        }
      : null;

  return {
    downloadCount,
    thumbsUpCount,
    thumbsDownCount,
    commentCount,
    tippedAmountCount,
    totalVersionsCount,
    matchedVersion,
  };
}

/**
 * Safely parses `models.civitai_stats_json` into a typed summary object.
 */
export function parseCivitaiStatsJson(raw: unknown): CivitaiModelStatsSummary | null {
  if (typeof raw !== 'string' || !raw.trim()) return null;
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    return {
      downloadCount: Math.max(0, Number(parsed.downloadCount || 0)),
      thumbsUpCount: Math.max(0, Number(parsed.thumbsUpCount || 0)),
      thumbsDownCount: Math.max(0, Number(parsed.thumbsDownCount || 0)),
      commentCount: Math.max(0, Number(parsed.commentCount || 0)),
      tippedAmountCount: Math.max(0, Number(parsed.tippedAmountCount || 0)),
      totalVersionsCount: Math.max(0, Number(parsed.totalVersionsCount || 0)),
      matchedVersion: parsed.matchedVersion
        ? {
            versionId: String(parsed.matchedVersion.versionId || ''),
            versionName: String(parsed.matchedVersion.versionName || 'Version'),
            downloadCount: Math.max(0, Number(parsed.matchedVersion.downloadCount || 0)),
            thumbsUpCount: Math.max(0, Number(parsed.matchedVersion.thumbsUpCount || 0)),
            thumbsDownCount: Math.max(0, Number(parsed.matchedVersion.thumbsDownCount || 0)),
          }
        : null,
    };
  } catch {
    return null;
  }
}

/**
 * Safely parses `models.civitai_comments_json` into a typed comment array.
 */
export function parseCivitaiCommentsJson(raw: unknown): CivitaiCommentRecord[] {
  if (typeof raw !== 'string' || !raw.trim()) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as CivitaiCommentRecord[]) : [];
  } catch {
    return [];
  }
}

/**
 * Parses a pasted Civitai URL, bare numeric Version ID (e.g. `123456` or `v2:123456`),
 * or model URL into `{ modelId, versionId, domain, isBareNumeric }`.
 */
export function parseCivitaiLinkInput(rawInput: string): {
  modelId: string | null;
  versionId: string | null;
  domain: CivitaiDomain;
  isBareNumeric: boolean;
} {
  const trimmed = String(rawInput || '').trim();
  if (!trimmed) {
    return { modelId: null, versionId: null, domain: 'civitai.com', isBareNumeric: false };
  }

  // Bare numeric Version ID (with optional leading `v`/`#`)
  const bareMatch = trimmed.match(/^(?:v|ver|version|id|#)?\s*[:#-]?\s*(\d{3,12})$/i);
  if (bareMatch) {
    return {
      modelId: null,
      versionId: bareMatch[1],
      domain: 'civitai.com',
      isBareNumeric: true,
    };
  }

  const normalizedUrl = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  const parsed = parseIdsFromCivitaiUrl(normalizedUrl);
  return {
    modelId: parsed.modelId,
    versionId: parsed.versionId,
    domain: parsed.domain || 'civitai.com',
    isBareNumeric: false,
  };
}
