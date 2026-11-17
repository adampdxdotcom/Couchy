import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import sharp from 'sharp';
import { appConfig } from '../../config.ts';
import {
  buildCivitaiSearchResultCard,
  extractCivitaiVersions,
  fetchCivitaiJsonWithFallback,
  fetchCivitaiParentModelWithDomain,
  getCivitaiHeaders,
  isBaseModelResourceType,
  isKrea2BaseModel,
  isLoraResourceType,
  parseCivitaiShareUrl,
  probeCivitaiWebDomain,
  resolveCivitaiDomain,
  type CivitaiDomain,
  type ParsedCivitaiShareUrl,
} from './civitaiHttpAndParse.ts';
import {
  annotateInstalledSearchResults,
  findInstalledModelMatch,
  getVisibleInstalledModelBuckets,
  normalizeModelStem,
} from './civitaiModelEnrichmentService.ts';
import { getBoolSetting } from '../settingsService.ts';
import { invalidateStorageUsageStatsCache } from '../storageStatsService.ts';
import { resolveClosestAspectRatio } from '../../../shared/utils.ts';
import type { CivitaiImageImportResult, ExternalModelSearchResult } from '../../../shared/types.ts';

const MAX_SYSTEM_LORAS = 5;
const CIVITAI_INSPIRATION_MAX_PIXELS = 1_000_000;
const CIVITAI_INSPIRATION_MAX_BYTES = 25 * 1024 * 1024;

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

export interface CivitaiImageFetchedMetadata {
  parsed: ParsedCivitaiShareUrl;
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

function isSaveCivitaiImportImagesEnabled(): boolean {
  return getBoolSetting('save_civitai_import_images', true);
}

/**
 * Downloads a Civitai image URL server-side, downscales it to <= 1MP JPEG,
 * and stores it in `appConfig.uploadedImagesDir` so Quick Gen can seed step #0 of a stack.
 * Returns null gracefully if disabled, non-image (e.g. video), or CDN fetch fails.
 */
async function fetchAndSaveCivitaiInspirationImage(
  imageUrl: string | null | undefined
): Promise<{ filename: string; width: number; height: number } | null> {
  if (!isSaveCivitaiImportImagesEnabled()) return null;
  const trimmedUrl = String(imageUrl || '').trim();
  if (!/^https?:\/\//i.test(trimmedUrl)) return null;
  if (/\.(mp4|webm|mov|avi)(\?|$)/i.test(trimmedUrl)) return null;

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10_000);
    const res = await fetch(trimmedUrl, {
      signal: controller.signal,
      headers: {
        Accept: 'image/*,*/*;q=0.8',
        'User-Agent': 'Couchy-ComfyUI-Gallery/1.0',
      },
    });
    clearTimeout(timer);
    if (!res.ok) return null;

    const contentType = (res.headers.get('content-type') || '').toLowerCase();
    if (contentType && !contentType.startsWith('image/')) {
      return null;
    }

    const arrayBuf = await res.arrayBuffer();
    if (arrayBuf.byteLength === 0 || arrayBuf.byteLength > CIVITAI_INSPIRATION_MAX_BYTES) {
      return null;
    }

    const inputBuf = Buffer.from(arrayBuf);
    // Normalize EXIF orientation before computing 1MP target dimensions
    const { data: rotatedBuf, info: rotatedInfo } = await sharp(inputBuf)
      .rotate()
      .toBuffer({ resolveWithObject: true });
    const srcW = Number(rotatedInfo.width || 0);
    const srcH = Number(rotatedInfo.height || 0);
    if (srcW <= 0 || srcH <= 0) return null;

    const totalPixels = srcW * srcH;
    let pipeline = sharp(rotatedBuf);
    let outW = srcW;
    let outH = srcH;

    if (totalPixels > CIVITAI_INSPIRATION_MAX_PIXELS) {
      const scale = Math.sqrt(CIVITAI_INSPIRATION_MAX_PIXELS / totalPixels);
      outW = Math.max(1, Math.round(srcW * scale));
      outH = Math.max(1, Math.round(srcH * scale));
      pipeline = pipeline.resize(outW, outH, { fit: 'inside', withoutEnlargement: true });
    }

    const { data: outBuf, info: outInfo } = await pipeline
      .jpeg({ quality: 88, mozjpeg: true })
      .toBuffer({ resolveWithObject: true });
    if (outBuf.length === 0) return null;

    fs.mkdirSync(appConfig.uploadedImagesDir, { recursive: true });
    const hashPrefix = crypto.createHash('sha256').update(outBuf).digest('hex').slice(0, 10);
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `civitai-1mp-${timestamp}-${hashPrefix}.jpg`;
    fs.writeFileSync(path.join(appConfig.uploadedImagesDir, filename), outBuf);
    invalidateStorageUsageStatsCache();

    return {
      filename,
      width: Number(outInfo.width || outW),
      height: Number(outInfo.height || outH),
    };
  } catch {
    return null;
  }
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
    restItem,
    trpcGenData,
    sourceBaseModel,
    rawPrompt,
    negativePrompt,
    aspectRatio,
    loraCandidates,
    baseCandidates,
  } = await fetchCivitaiImageMetadata(rawUrl);

  const rawMediaType = String(restItem?.type || trpcGenData?.type || '').toLowerCase();
  const sourceImageUrl =
    rawMediaType === 'video'
      ? null
      : (typeof restItem?.url === 'string' && restItem.url.trim()) ||
        (typeof trpcGenData?.url === 'string' && trpcGenData.url.trim()) ||
        null;

  const savedInspiration = await fetchAndSaveCivitaiInspirationImage(sourceImageUrl);
  const resolvedAspectRatio =
    aspectRatio ||
    (savedInspiration && savedInspiration.width > 0 && savedInspiration.height > 0
      ? resolveClosestAspectRatio(savedInspiration.width, savedInspiration.height)
      : null);

  const baseCandidate = baseCandidates[0] || null;
  const { loras: installedLoras, bases: installedBases } = getVisibleInstalledModelBuckets();

  let checkpointName: string | null = null;
  let skippedCheckpoint: string | null = null;
  if (baseCandidate) {
    const matchedBase = findInstalledModelMatch(baseCandidate, installedBases);
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
    const matched = findInstalledModelMatch(cand, installedLoras);
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
    aspectRatio: resolvedAspectRatio,
    checkpointName,
    loras: matchedLoras,
    skippedLoras,
    skippedCheckpoint,
    sourceBaseModel,
    hasPromptMetadata: cleanedPrompt.length > 0,
    inspirationFilename: savedInspiration?.filename ?? null,
  };
}

/**
 * Resolves a single Civitai model version (by versionId or SHA256/AutoV2 hash) into a full
 * Downloader preview card using shared Civitai version extraction helpers.
 */
async function resolveCivitaiResourceCard(params: {
  versionId: string | null;
  hash: string | null;
  domain: CivitaiDomain;
  preferredType: 'lora' | 'checkpoint';
}): Promise<ExternalModelSearchResult | null> {
  const headers = getCivitaiHeaders();
  let detectedDomain = params.domain;
  let targetVer: any = null;

  if (params.versionId) {
    const res = await fetchCivitaiJsonWithFallback(
      `/api/v1/model-versions/${encodeURIComponent(params.versionId)}`,
      headers,
      detectedDomain,
      9000
    );
    if (res?.data) {
      targetVer = res.data;
      detectedDomain = res.domain;
    }
  } else if (params.hash) {
    const res = await fetchCivitaiJsonWithFallback(
      `/api/v1/model-versions/by-hash/${encodeURIComponent(params.hash)}`,
      headers,
      detectedDomain,
      9000
    );
    if (res?.data) {
      targetVer = res.data;
      detectedDomain = res.domain;
    }
  }

  if (!targetVer) return null;

  let parentModel: any = null;
  const parentId = targetVer.modelId;
  if (parentId) {
    const parentRes = await fetchCivitaiParentModelWithDomain(
      parentId,
      headers,
      detectedDomain
    );
    parentModel = parentRes.model;
    if (parentRes.domain === 'civitai.red') detectedDomain = 'civitai.red';
  }

  let finalDomain = resolveCivitaiDomain(parentModel, targetVer, detectedDomain);
  if (finalDomain === 'civitai.com' && parentId) {
    finalDomain = await probeCivitaiWebDomain(parentId, finalDomain);
  }

  const rawType = String(
    parentModel?.type ||
      targetVer?.model?.type ||
      (params.preferredType === 'lora' ? 'LORA' : 'Checkpoint')
  );
  const availableVersions = extractCivitaiVersions(
    parentModel,
    targetVer,
    rawType,
    finalDomain
  );
  const activeVersion =
    availableVersions.find((v) => v.versionId === String(targetVer.id)) ||
    availableVersions[0];

  if (!activeVersion) return null;

  return buildCivitaiSearchResultCard({
    parentModel,
    targetVer,
    availableVersions,
    activeVersion,
    fallbackDescription: 'Resolved from Civitai Image URL',
  });
}

/**
 * Resolves all Krea 2 Base Models and LoRAs referenced by a Civitai image/post share URL
 * for the Model Downloader, rejecting non-Krea-2 images with an explicit user message.
 */
export async function resolveCivitaiImageModelsForDownloader(
  rawUrl: string,
  typeFilter?: string
): Promise<{ items: ExternalModelSearchResult[]; notice: string | null }> {
  const {
    activeDomain,
    sourceBaseModel,
    baseCandidates,
    loraCandidates,
  } = await fetchCivitaiImageMetadata(rawUrl);

  const imageIsExplicitNonKrea =
    Boolean(sourceBaseModel) &&
    sourceBaseModel!.toLowerCase() !== 'other' &&
    !isKrea2BaseModel(sourceBaseModel);

  if (imageIsExplicitNonKrea) {
    const err: any = new Error(
      `Only Krea 2 images are supported (this image uses ${sourceBaseModel}).`
    );
    err.statusCode = 400;
    throw err;
  }

  const resolvableTasks: Array<{
    kind: 'checkpoint' | 'lora';
    versionId: string | null;
    hash: string | null;
    label: string;
  }> = [];
  let unlinkedCount = 0;

  for (const b of baseCandidates) {
    if (b.versionId || b.hash) {
      resolvableTasks.push({
        kind: 'checkpoint',
        versionId: b.versionId,
        hash: b.hash,
        label: b.name || 'Base Model',
      });
    } else if (b.name) {
      unlinkedCount += 1;
    }
  }

  for (const l of loraCandidates) {
    if (l.versionId || l.hash) {
      resolvableTasks.push({
        kind: 'lora',
        versionId: l.versionId,
        hash: l.hash,
        label: l.name || 'LoRA',
      });
    } else if (l.name) {
      unlinkedCount += 1;
    }
  }

  if (resolvableTasks.length === 0) {
    const err: any = new Error(
      isKrea2BaseModel(sourceBaseModel)
        ? 'No linked downloadable Civitai models were found on this Krea 2 image.'
        : 'Only Krea 2 images are supported (no linked Krea 2 models found on this image).'
    );
    err.statusCode = 400;
    throw err;
  }

  const settled = await Promise.allSettled(
    resolvableTasks.map((t) =>
      resolveCivitaiResourceCard({
        versionId: t.versionId,
        hash: t.hash,
        domain: activeDomain,
        preferredType: t.kind,
      })
    )
  );

  const seenCardIds = new Set<string>();
  const kreaCards: ExternalModelSearchResult[] = [];
  const nonKreaLabels = new Set<string>();
  let failedLookups = 0;

  for (const res of settled) {
    if (res.status !== 'fulfilled' || !res.value) {
      failedLookups += 1;
      continue;
    }
    const card = res.value;
    const dedupeKey = `${card.provider}-${card.id}-${card.versionId || card.filename}`;
    if (seenCardIds.has(dedupeKey)) continue;
    seenCardIds.add(dedupeKey);

    const cardBase = card.baseModel ? card.baseModel.trim() : '';
    const isCardKrea =
      isKrea2BaseModel(cardBase) ||
      ((!cardBase || cardBase.toLowerCase() === 'other') && isKrea2BaseModel(sourceBaseModel));

    if (!isCardKrea) {
      nonKreaLabels.add(cardBase || card.name);
      continue;
    }

    kreaCards.push(card);
  }

  if (kreaCards.length === 0) {
    const detectedList = Array.from(nonKreaLabels);
    const err: any = new Error(
      detectedList.length > 0
        ? `Only Krea 2 images are supported (detected ${detectedList.join(', ')}).`
        : 'Only Krea 2 images are supported — no Krea 2 models were found on this image.'
    );
    err.statusCode = 400;
    throw err;
  }

  const filteredCards = kreaCards.filter((c) => {
    if (!typeFilter) return true;
    if (typeFilter === 'lora') return c.modelType === 'lora';
    if (typeFilter === 'checkpoint') {
      return c.modelType === 'checkpoint' || c.modelType === 'diffusion';
    }
    return c.modelType === typeFilter;
  });

  const annotated = annotateInstalledSearchResults(filteredCards);

  const noticeParts: string[] = [];
  if (nonKreaLabels.size > 0) {
    noticeParts.push(
      `Only Krea 2 models shown · skipped non-Krea (${Array.from(nonKreaLabels).join(', ')})`
    );
  }
  if (unlinkedCount > 0 || failedLookups > 0) {
    const skippedTotal = unlinkedCount + failedLookups;
    noticeParts.push(
      `${skippedTotal} unlinked/unavailable resource${skippedTotal === 1 ? '' : 's'} omitted`
    );
  }

  return {
    items: annotated,
    notice: noticeParts.length > 0 ? noticeParts.join(' · ') : null,
  };
}
