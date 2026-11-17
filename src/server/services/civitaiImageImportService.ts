import { db } from '../db.ts';
import {
  fetchCivitaiJsonWithFallback,
  getCivitaiHeaders,
  type CivitaiDomain,
} from './civitaiMetadataService.ts';
import { resolveClosestAspectRatio } from '../../shared/utils.ts';
import type { CivitaiImageImportResult } from '../../shared/types.ts';

const MAX_SYSTEM_LORAS = 5;

interface ParsedShareUrl {
  kind: 'image' | 'post';
  id: number;
  domain: CivitaiDomain;
  cleanUrl: string;
}

interface InstalledModelRow {
  id: number;
  name: string;
  filename: string;
  model_type: string;
  sha256_hash: string | null;
  autov2_hash: string | null;
  civitai_version_id: string | null;
  default_model_strength: number | null;
  default_clip_strength: number | null;
  trigger_word: string | null;
  nickname: string | null;
}

interface LoraCandidate {
  versionId: string | null;
  name: string;
  hash: string | null;
  weight: number;
}

interface BaseModelCandidate {
  versionId: string | null;
  name: string;
  hash: string | null;
}

/**
 * Parses a Civitai share URL (`/images/:id` or `/posts/:id`) on `civitai.com` or `civitai.red`.
 */
export function parseCivitaiShareUrl(rawUrl: string): ParsedShareUrl | null {
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

function normalizeModelStem(raw: string): string {
  return String(raw || '')
    .trim()
    .replace(/\\/g, '/')
    .split('/')
    .pop()!
    .replace(/\.(safetensors|pt|ckpt|pth|bin|gguf|sft)$/i, '')
    .toLowerCase();
}

function normalizeAlnum(raw: string): string {
  return normalizeModelStem(raw).replace(/[^a-z0-9]/g, '');
}

function clampWeight(val: unknown, fallback = 1.0): number {
  const n = Number(val);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(-10.0, Math.min(10.0, Number(n.toFixed(2))));
}

function stripLoraTagsFromPrompt(rawPrompt: string): string {
  return rawPrompt
    .replace(/<lora:[^>]+>/gi, '')
    .replace(/\s*,\s*,+/g, ', ')
    .replace(/^[,\s]+|[,\s]+$/g, '')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
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

function matchInstalledModel<T extends InstalledModelRow>(
  candidates: { versionId: string | null; name: string; hash: string | null },
  installedRows: T[]
): T | null {
  if (candidates.versionId) {
    const byVer = installedRows.find(
      (r) => r.civitai_version_id && String(r.civitai_version_id).trim() === candidates.versionId
    );
    if (byVer) return byVer;
  }

  if (candidates.hash) {
    const h = candidates.hash.trim().toLowerCase();
    const byHash = installedRows.find(
      (r) =>
        (r.autov2_hash && r.autov2_hash.toLowerCase() === h) ||
        (r.sha256_hash && r.sha256_hash.toLowerCase().startsWith(h))
    );
    if (byHash) return byHash;
  }

  const candStem = normalizeModelStem(candidates.name);
  const candAlnum = normalizeAlnum(candidates.name);
  if (!candStem && !candAlnum) return null;

  const exactStem = installedRows.find(
    (r) =>
      normalizeModelStem(r.filename) === candStem ||
      normalizeModelStem(r.name) === candStem ||
      (r.nickname && normalizeModelStem(r.nickname) === candStem)
  );
  if (exactStem) return exactStem;

  if (candAlnum.length >= 4) {
    return (
      installedRows.find((r) => {
        const fAlnum = normalizeAlnum(r.filename);
        const nAlnum = normalizeAlnum(r.name);
        return fAlnum === candAlnum || nAlnum === candAlnum;
      }) || null
    );
  }

  return null;
}

export interface CivitaiImageFetchedMetadata {
  parsed: ParsedShareUrl;
  activeDomain: CivitaiDomain;
  targetImageId: number;
  restItem: any;
  trpcGenData: any;
  meta: Record<string, any>;
  sourceBaseModel: string | null;
  rawPrompt: string;
  negativePrompt: string;
  aspectRatio: string | null;
  loraCandidates: LoraCandidate[];
  baseCandidates: BaseModelCandidate[];
}

/**
 * Queries Civitai REST + tRPC endpoints for an `/images/:id` or `/posts/:id` URL and
 * returns extracted prompt, dimensions, and normalized LoRA/Base Model candidates.
 */
export async function fetchCivitaiImageMetadata(
  rawUrl: string
): Promise<CivitaiImageFetchedMetadata> {
  const parsed = parseCivitaiShareUrl(rawUrl);
  if (!parsed) {
    throw new Error('Please paste a valid Civitai image or post URL.');
  }

  const headers = getCivitaiHeaders();
  let activeDomain: CivitaiDomain = parsed.domain;
  let restItem: any = null;

  // 1. Query Civitai REST /api/v1/images (with .com <-> .red fallback)
  const restEndpoint =
    parsed.kind === 'post'
      ? `/api/v1/images?postId=${parsed.id}&nsfw=X&limit=1`
      : `/api/v1/images?imageId=${parsed.id}&nsfw=X&limit=1`;

  const restRes = await fetchCivitaiJsonWithFallback(restEndpoint, headers, activeDomain, 10_000);
  if (restRes?.data) {
    activeDomain = restRes.domain;
    const items = Array.isArray(restRes.data?.items) ? restRes.data.items : [];
    if (parsed.kind === 'image') {
      restItem = items.find((it: any) => Number(it?.id) === parsed.id) || null;
    } else {
      restItem = items[0] || null;
    }
  }

  const targetImageId = Number(restItem?.id || (parsed.kind === 'image' ? parsed.id : 0));

  // 2. Supplement with tRPC image.getGenerationData (Civitai's internal generator data endpoint)
  let trpcGenData: any = null;
  if (targetImageId > 0) {
    const trpcInput = encodeURIComponent(JSON.stringify({ json: { id: targetImageId } }));
    const trpcRes = await fetchCivitaiJsonWithFallback(
      `/api/trpc/image.getGenerationData?input=${trpcInput}`,
      headers,
      activeDomain,
      10_000
    );
    if (trpcRes?.data?.result?.data?.json) {
      activeDomain = trpcRes.domain;
      trpcGenData = trpcRes.data.result.data.json;
    }
  }

  if (!restItem && !trpcGenData) {
    throw new Error('Could not retrieve that image from Civitai.');
  }

  const meta =
    (trpcGenData?.meta && typeof trpcGenData.meta === 'object'
      ? { ...(restItem?.meta || {}), ...trpcGenData.meta }
      : restItem?.meta) || {};

  const width = Number(restItem?.width || 0);
  const height = Number(restItem?.height || 0);
  const aspectRatio = width > 0 && height > 0 ? resolveClosestAspectRatio(width, height) : null;

  const rawPrompt = typeof meta?.prompt === 'string' ? meta.prompt : '';
  const negativePrompt =
    typeof meta?.negativePrompt === 'string' ? meta.negativePrompt.trim() : '';

  const loraCandidates: LoraCandidate[] = [];
  const seenLoraKeys = new Set<string>();
  const pushLoraCandidate = (cand: LoraCandidate) => {
    const key = cand.versionId
      ? `v:${cand.versionId}`
      : cand.hash
      ? `h:${cand.hash.toLowerCase()}`
      : `n:${normalizeModelStem(cand.name)}`;
    if (!key || key === 'n:' || seenLoraKeys.has(key)) return;
    seenLoraKeys.add(key);
    loraCandidates.push(cand);
  };

  const baseCandidates: BaseModelCandidate[] = [];
  const seenBaseKeys = new Set<string>();
  const pushBaseCandidate = (cand: BaseModelCandidate) => {
    if (!cand.versionId && !cand.name && !cand.hash) return;
    const key = cand.versionId
      ? `v:${cand.versionId}`
      : cand.hash
      ? `h:${cand.hash.toLowerCase()}`
      : `n:${normalizeModelStem(cand.name)}`;
    if (!key || key === 'n:' || seenBaseKeys.has(key)) return;
    seenBaseKeys.add(key);
    baseCandidates.push(cand);
  };

  const resourceLists = [
    Array.isArray(trpcGenData?.resources) ? trpcGenData.resources : [],
    Array.isArray(meta?.civitaiResources) ? meta.civitaiResources : [],
    Array.isArray(meta?.resources) ? meta.resources : [],
  ];

  for (const list of resourceLists) {
    for (const r of list) {
      if (!r || typeof r !== 'object') continue;
      const rType = r.modelType ?? r.type;
      const vId =
        r.versionId || r.modelVersionId ? String(r.versionId || r.modelVersionId).trim() : null;
      const rName = String(r.modelName || r.name || r.versionName || '').trim();
      const rHash = typeof r.hash === 'string' ? r.hash.trim() : null;

      if (isLoraResourceType(rType)) {
        pushLoraCandidate({
          versionId: vId,
          name: rName || (vId ? `LoRA #${vId}` : 'Unknown LoRA'),
          hash: rHash,
          weight: clampWeight(r.strength ?? r.weight, 1.0),
        });
      } else if (isBaseModelResourceType(rType)) {
        pushBaseCandidate({
          versionId: vId,
          name: rName,
          hash: rHash,
        });
      }
    }
  }

  // Parse inline <lora:name:weight> tags from prompt
  if (rawPrompt) {
    const tagRegex = /<lora:([^:>]+)(?::([^:>]+))?(?::[^>]+)?>/gi;
    let match: RegExpExecArray | null;
    while ((match = tagRegex.exec(rawPrompt)) !== null) {
      const tokenName = match[1].trim();
      const weightVal = match[2] !== undefined ? clampWeight(match[2], 1.0) : 1.0;
      const loraHash =
        meta?.hashes && typeof meta.hashes === 'object'
          ? meta.hashes[`lora:${tokenName}`] || null
          : null;
      pushLoraCandidate({
        versionId: null,
        name: tokenName,
        hash: typeof loraHash === 'string' ? loraHash : null,
        weight: weightVal,
      });
    }
  }

  // Parse meta.hashes (e.g. "lora:foo": "abc123", "Model": "def456")
  if (meta?.hashes && typeof meta.hashes === 'object') {
    for (const [key, val] of Object.entries(meta.hashes)) {
      if (typeof val !== 'string' || !val.trim()) continue;
      if (key.toLowerCase().startsWith('lora:')) {
        pushLoraCandidate({
          versionId: null,
          name: key.slice(5).trim(),
          hash: val.trim(),
          weight: 1.0,
        });
      } else if (key.toLowerCase() === 'model') {
        pushBaseCandidate({
          versionId: null,
          name: typeof meta?.Model === 'string' ? meta.Model.trim() : '',
          hash: val.trim(),
        });
      }
    }
  }

  if (baseCandidates.length === 0 && typeof meta?.Model === 'string' && meta.Model.trim()) {
    pushBaseCandidate({ versionId: null, name: meta.Model.trim(), hash: null });
  }

  const sourceBaseModel =
    (typeof restItem?.baseModel === 'string' && restItem.baseModel.trim()) ||
    (typeof trpcGenData?.baseModel === 'string' && trpcGenData.baseModel.trim()) ||
    null;

  return {
    parsed,
    activeDomain,
    targetImageId,
    restItem,
    trpcGenData,
    meta,
    sourceBaseModel,
    rawPrompt,
    negativePrompt,
    aspectRatio,
    loraCandidates,
    baseCandidates,
  };
}

/**
 * Fetches metadata for a shared Civitai image/post URL and resolves any matching locally
 * installed Base Model and up to 5 LoRAs. Anything unavailable in Couchy is omitted gracefully.
 */
export async function importCivitaiImageForQuickGen(
  rawUrl: string
): Promise<CivitaiImageImportResult> {
  const {
    parsed,
    activeDomain,
    targetImageId,
    sourceBaseModel,
    rawPrompt,
    negativePrompt,
    aspectRatio,
    loraCandidates,
    baseCandidates,
  } = await fetchCivitaiImageMetadata(rawUrl);

  const baseCandidate = baseCandidates[0] || null;

  // Match candidates strictly against installed local Couchy models
  const installedRows = db
    .prepare(
      `SELECT id, name, filename, model_type, sha256_hash, autov2_hash, civitai_version_id,
              default_model_strength, default_clip_strength, trigger_word, nickname
       FROM models
       WHERE is_installed = 1 AND is_hidden = 0`
    )
    .all() as InstalledModelRow[];

  const installedLoras = installedRows.filter((r) => r.model_type === 'lora');
  const installedBases = installedRows.filter(
    (r) => r.model_type === 'diffusion' || r.model_type === 'checkpoint'
  );

  let checkpointName: string | null = null;
  let skippedCheckpoint: string | null = null;
  if (baseCandidate) {
    const matchedBase = matchInstalledModel(baseCandidate, installedBases);
    if (matchedBase) {
      checkpointName = matchedBase.filename;
    } else if (baseCandidate.name) {
      skippedCheckpoint = baseCandidate.name;
    }
  }

  const matchedLoras: CivitaiImageImportResult['loras'] = [];
  const skippedLoras: string[] = [];
  const addedFilenames = new Set<string>();

  for (const cand of loraCandidates) {
    const matched = matchInstalledModel(cand, installedLoras);
    if (!matched) {
      skippedLoras.push(cand.name);
      continue;
    }
    const lowerFile = matched.filename.toLowerCase();
    if (addedFilenames.has(lowerFile)) continue;

    if (matchedLoras.length >= MAX_SYSTEM_LORAS) {
      skippedLoras.push(matched.nickname || matched.name || matched.filename);
      continue;
    }

    addedFilenames.add(lowerFile);
    const strength = clampWeight(cand.weight, matched.default_model_strength ?? 1.0);
    matchedLoras.push({
      loraName: matched.filename,
      modelStrength: strength,
      clipStrength: strength,
      triggerWord: matched.trigger_word || '',
      nickname: matched.nickname || matched.name,
    });
  }

  const cleanedPrompt = stripLoraTagsFromPrompt(rawPrompt);

  return {
    sourceUrl: parsed.cleanUrl,
    civitaiDomain: activeDomain,
    imageId: targetImageId || parsed.id,
    prompt: cleanedPrompt,
    negativePrompt,
    aspectRatio,
    checkpointName,
    loras: matchedLoras,
    skippedLoras,
    skippedCheckpoint,
    sourceBaseModel,
    hasPromptMetadata: cleanedPrompt.length > 0,
  };
}
