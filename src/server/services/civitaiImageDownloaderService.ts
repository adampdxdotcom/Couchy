import {
  fetchCivitaiJsonWithFallback,
  fetchCivitaiParentModelWithDomain,
  getCivitaiHeaders,
  probeCivitaiWebDomain,
  resolveCivitaiDomain,
  type CivitaiDomain,
} from './civitaiMetadataService.ts';
import {
  fetchCivitaiImageMetadata,
  isKrea2BaseModel,
} from './civitaiImageImportService.ts';
import {
  annotateInstalledSearchResults,
  extractCivitaiVersions,
} from './modelDownloadResolverService.ts';
import type { ExternalModelSearchResult } from '../../shared/types.ts';

/**
 * Resolves a single Civitai model version (by versionId or SHA256/AutoV2 hash) into a full
 * Downloader preview card using existing Civitai version extraction helpers.
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

  return {
    provider: 'civitai',
    id: String(parentId || targetVer.id),
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
    description:
      activeVersion.civitaiDescription?.slice(0, 220) || 'Resolved from Civitai Image URL',
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

  // Respect optional type dropdown filter in the Downloader UI
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
