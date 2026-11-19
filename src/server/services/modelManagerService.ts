import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { Readable } from 'stream';
import { db } from '../db.ts';
import { appConfig } from '../config.ts';
import { syncModelInventory, updateLoraMentionConfig } from './modelInventoryService.ts';
import {
  DOWNLOAD_WEIGHT_EXTS,
  MODEL_TYPE_TO_DEFAULT_SUBFOLDER,
  SUBFOLDER_TO_MODEL_TYPE,
  inferSubfolderAndTypeFromPath,
} from './modelDownloadPaths.ts';
import {
  listHuggingFaceRepoFiles,
  parseHuggingFaceRepoAndFile,
} from './huggingFaceMetadataService.ts';
import {
  extractCivitaiEarlyAccessInfo,
  extractCivitaiVersions,
  fetchCivitaiJsonWithFallback,
  fetchCivitaiParentModelWithDomain,
  getCivitaiHeaders,
  normalizeCivitaiData,
  parseCivitaiShareUrl,
  probeCivitaiWebDomain,
  resolveCivitaiDomain,
  resolveCivitaiModelUrl,
  rewriteCivitaiDownloadUrl,
  type CivitaiDomain,
  type CivitaiNormalizedMeta,
} from './civitai/civitaiHttpAndParse.ts';
import {
  annotateInstalledSearchResults,
  applyCivitaiEnrichmentToModel,
  cacheModelPreviewImages,
  fetchAndEnrichModelFromCivitai,
  invalidateInstalledModelsCache,
} from './civitai/civitaiModelEnrichmentService.ts';
import { resolveCivitaiImageModelsForDownloader } from './civitai/civitaiImageShareService.ts';
import { invalidateStorageUsageStatsCache } from './storageStatsService.ts';
import {
  classifyLoraFromMetadata,
  classifySafetensorsHeaderOnDisk,
} from './loraClassifierService.ts';
import { handleDownloadedCharacterLoraAutomation } from './characterDownloadAutomationService.ts';
import { VALID_LORA_CATEGORIES } from '../../shared/pillSettings.ts';
import type {
  CharacterDownloadAutomation,
  ComfyModelSubfolder,
  ExternalModelFileOption,
  ExternalModelSearchResult,
  LoraCategory,
  LoraMentionAutomation,
  ModelType,
} from '../../shared/types.ts';

export type { ExternalModelSearchResult };

/**
 * Searches Civitai REST API (.com and .red) for models by query or SHA-256/AutoV2 hash.
 */
export async function searchCivitaiModels(query: string, typeFilter?: string): Promise<ExternalModelSearchResult[]> {
  const trimmed = query.trim();

  // If user pasted a Civitai URL (.com or .red) directly into search, resolve it
  if (/^https?:\/\/(www\.)?civitai\.(com|red)\//i.test(trimmed)) {
    const resolved = await resolveDirectModelUrl(trimmed);
    return [resolved];
  }

  const headers = getCivitaiHeaders();

  // If query looks like a hash (10 to 64 hex chars), try hash lookup endpoint across .com and .red
  if (/^[a-fA-F0-9]{10,64}$/.test(trimmed)) {
    try {
      const hashLookup = await fetchCivitaiJsonWithFallback(
        `/api/v1/model-versions/by-hash/${encodeURIComponent(trimmed)}`,
        headers,
        'civitai.com',
        9000
      );
      if (hashLookup?.data) {
        const ver = hashLookup.data;
        let detectedDomain: CivitaiDomain = hashLookup.domain;
        let parentModel: any = null;

        if (ver.modelId) {
          const parentRes = await fetchCivitaiParentModelWithDomain(
            ver.modelId,
            headers,
            detectedDomain
          );
          parentModel = parentRes.model;
          if (parentRes.domain === 'civitai.red') {
            detectedDomain = 'civitai.red';
          }
        }

        const resolvedModelId = parentModel?.id || ver.modelId;
        let finalDomain = resolveCivitaiDomain(parentModel, ver, detectedDomain);
        if (finalDomain === 'civitai.com' && resolvedModelId) {
          finalDomain = await probeCivitaiWebDomain(resolvedModelId, finalDomain);
        }

        const rawType = String(parentModel?.type || ver.model?.type || 'LORA');
        const availableVersions = extractCivitaiVersions(
          parentModel,
          ver,
          rawType,
          finalDomain
        );
        const activeVersion =
          availableVersions.find((v) => v.versionId === String(ver.id)) ||
          availableVersions[0];

        if (activeVersion) {
          const excerpt =
            activeVersion.civitaiDescription?.slice(0, 220) ||
            `Matched exact model hash ${trimmed}`;

          return annotateInstalledSearchResults([
            {
              provider: 'civitai',
              id: String(resolvedModelId || ver.id),
              versionId: activeVersion.versionId,
              civitaiUrl: activeVersion.civitaiUrl,
              name: parentModel?.name || ver.model?.name || activeVersion.filename,
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
                parentModel?.creator?.username ||
                ver.model?.creator?.username ||
                'Civitai Creator',
              description: excerpt,
              availableFiles: activeVersion.availableFiles,
              totalRepoFilesCount: activeVersion.availableFiles.length,
              availableVersions,
              earlyAccessEndsAt: activeVersion.earlyAccessEndsAt,
              isEarlyAccessActive: activeVersion.isEarlyAccessActive,
              availability: activeVersion.availability,
              earlyAccessConfig: activeVersion.earlyAccessConfig,
            },
          ]);
        }
      }
    } catch {
      // fall through to keyword search
    }
  }

  const params = new URLSearchParams();
  params.set('limit', '12');
  if (trimmed) params.set('query', trimmed);
  if (typeFilter === 'checkpoint') params.set('types', 'Checkpoint');
  else if (typeFilter === 'lora') {
    params.append('types', 'LORA');
    params.append('types', 'LoCon');
    params.append('types', 'DoRA');
  } else if (typeFilter === 'controlnet') params.set('types', 'Controlnet');
  else if (typeFilter === 'vae') params.set('types', 'VAE');
  else if (typeFilter === 'upscaler') params.set('types', 'Upscaler');
  else if (typeFilter === 'embedding') params.set('types', 'TextualInversion');

  const searchPath = `/api/v1/models?${params.toString()}`;
  const searchRes = await fetchCivitaiJsonWithFallback(searchPath, headers, 'civitai.com', 9000);
  if (!searchRes) {
    throw new Error('Civitai API search failed on both civitai.com and civitai.red');
  }

  let items: any[] = Array.isArray(searchRes.data?.items) ? searchRes.data.items : [];
  let searchDomain: CivitaiDomain = searchRes.domain;

  // If .com returned 0 items for a specific query, also check .red in case the model is only indexed on .red
  if (items.length === 0 && trimmed && searchDomain === 'civitai.com') {
    const redFallback = await fetchCivitaiJsonWithFallback(searchPath, headers, 'civitai.red', 7000);
    if (redFallback?.data?.items?.length) {
      items = redFallback.data.items;
      searchDomain = 'civitai.red';
    }
  }

  const results: ExternalModelSearchResult[] = [];

  for (const item of items) {
    const latestVer = (item.modelVersions || [])[0];
    if (!latestVer) continue;
    const itemDomain = resolveCivitaiDomain(item, latestVer, searchDomain);
    const rawType = String(item.type || 'LORA');
    const availableVersions = extractCivitaiVersions(item, latestVer, rawType, itemDomain);
    const activeVersion = availableVersions[0];
    if (!activeVersion) continue;

    results.push({
      provider: 'civitai',
      id: String(item.id),
      versionId: activeVersion.versionId,
      civitaiUrl: activeVersion.civitaiUrl,
      name: item.name,
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
      creator: item.creator?.username || 'Unknown',
      description:
        activeVersion.civitaiDescription?.slice(0, 220) ||
        String(item.description || '').replace(/<[^>]+>/g, '').slice(0, 220),
      availableFiles: activeVersion.availableFiles,
      totalRepoFilesCount: activeVersion.availableFiles.length,
      availableVersions,
      earlyAccessEndsAt: activeVersion.earlyAccessEndsAt,
      isEarlyAccessActive: activeVersion.isEarlyAccessActive,
      availability: activeVersion.availability,
      earlyAccessConfig: activeVersion.earlyAccessConfig,
    });
  }

  return annotateInstalledSearchResults(results);
}

/**
 * Searches Hugging Face Hub API for model weight repositories (.safetensors, .gguf, .ckpt, .pth, etc.).
 */
export async function searchHuggingFaceModels(
  query: string,
  typeFilter?: string
): Promise<ExternalModelSearchResult[]> {
  const trimmed = query.trim();

  // If query is an exact owner/repo or Hugging Face URL, resolve it directly first
  const directRepo = parseHuggingFaceRepoAndFile(trimmed);
  if (directRepo && /^https?:\/\//i.test(trimmed)) {
    const resolved = await resolveDirectModelUrl(trimmed);
    return [resolved];
  }

  const headers: Record<string, string> = {};
  if (appConfig.hfApiToken) {
    headers.Authorization = `Bearer ${appConfig.hfApiToken}`;
  }

  const results: ExternalModelSearchResult[] = [];
  const seenRepos = new Set<string>();

  if (directRepo) {
    try {
      const resolved = await resolveDirectModelUrl(directRepo.repoId);
      results.push(resolved);
      seenRepos.add(resolved.id.toLowerCase());
    } catch {
      // continue to search query
    }
  }

  const typeHint =
    typeFilter === 'clip'
      ? 'text_encoders clip safetensors'
      : typeFilter === 'diffusion'
      ? 'gguf diffusion safetensors'
      : typeFilter
      ? `${typeFilter} safetensors`
      : 'safetensors comfyui';

  const searchTerm = trimmed
    ? typeFilter === 'clip' && !/clip|t5|encoder/i.test(trimmed)
      ? `${trimmed} clip`
      : trimmed
    : typeHint;

  const url = new URL('https://huggingface.co/api/models');
  url.searchParams.set('search', searchTerm);
  url.searchParams.set('limit', '10');
  url.searchParams.set('full', 'true');

  const res = await fetch(url.toString(), { headers });
  if (!res.ok) {
    throw new Error(`Hugging Face API returned HTTP ${res.status}`);
  }
  const items = (await res.json()) as any[];

  for (const repo of items || []) {
    const repoId = String(repo.id || '');
    if (!repoId || seenRepos.has(repoId.toLowerCase())) continue;

    const tags: string[] = Array.isArray(repo.tags) ? repo.tags : [];
    const siblings = Array.isArray(repo.siblings) ? repo.siblings : [];
    const availableFiles: ExternalModelFileOption[] = [];

    for (const s of siblings) {
      const rfilename = String(s.rfilename || '');
      const ext = path.extname(rfilename).toLowerCase();
      if (!DOWNLOAD_WEIGHT_EXTS.has(ext)) continue;

      const inferred = inferSubfolderAndTypeFromPath(rfilename, tags);
      const encodedPath = rfilename
        .split('/')
        .map((seg) => encodeURIComponent(seg))
        .join('/');

      availableFiles.push({
        rfilename,
        filename: path.basename(rfilename),
        fileSize: typeof s.size === 'number' ? s.size : s.lfs?.size ?? null,
        sha256Hash: s.lfs?.oid ? String(s.lfs.oid).toUpperCase() : null,
        downloadUrl: `https://huggingface.co/${repoId}/resolve/main/${encodedPath}`,
        modelType: inferred.modelType,
        suggestedSubfolder: inferred.suggestedSubfolder,
      });
    }

    if (availableFiles.length === 0) continue;

    const matchingFile = typeFilter
      ? availableFiles.find(
          (f) =>
            f.modelType === typeFilter ||
            (typeFilter === 'checkpoint' && f.modelType === 'diffusion') ||
            (typeFilter === 'diffusion' && f.modelType === 'checkpoint')
        )
      : availableFiles.find(
          (f) =>
            f.modelType === 'diffusion' ||
            f.modelType === 'checkpoint' ||
            f.modelType === 'lora'
        ) || availableFiles[0];

    if (typeFilter && !matchingFile) continue;
    const primary = matchingFile || availableFiles[0];

    const suggestedLoraCategory: LoraCategory | null =
      primary.modelType === 'lora'
        ? classifyLoraFromMetadata({
            name: repoId,
            filename: primary.filename,
            tags,
          })
        : null;

    results.push({
      provider: 'huggingface',
      id: repoId,
      hfRepoId: repoId,
      name: repoId,
      modelType: primary.modelType,
      suggestedSubfolder: primary.suggestedSubfolder,
      suggestedLoraCategory,
      versionName: 'main',
      filename: primary.filename,
      fileSize: primary.fileSize,
      sha256Hash: primary.sha256Hash,
      downloadUrl: primary.downloadUrl,
      creator: repoId.split('/')[0] || 'HuggingFace',
      description: `Hugging Face repository ${repoId} (${repo.downloads || 0} downloads · ${
        availableFiles.length
      } weight file${availableFiles.length === 1 ? '' : 's'})`,
      availableFiles,
      totalRepoFilesCount: availableFiles.length,
    });
  }

  return annotateInstalledSearchResults(results);
}

/**
 * Resolves a pasted Civitai URL (.com or .red), Hugging Face URL/repo, or direct weight link into an ExternalModelSearchResult.
 */
export async function resolveDirectModelUrl(rawInput: string): Promise<ExternalModelSearchResult> {
  const input = rawInput.trim();
  if (!input) {
    throw new Error('Please paste a URL or Hugging Face repository ID.');
  }

  // 1. Hugging Face URL or owner/repo
  const hfParsed = parseHuggingFaceRepoAndFile(input);
  if (hfParsed) {
    const repoData = await listHuggingFaceRepoFiles(hfParsed.repoId, hfParsed.branch);
    if (repoData.files.length === 0) {
      throw new Error(`No supported model weight files found in Hugging Face repo ${hfParsed.repoId}.`);
    }

    const matchedFile =
      (hfParsed.filePath
        ? repoData.files.find(
            (f) =>
              f.rfilename.toLowerCase() === hfParsed.filePath!.toLowerCase() ||
              f.filename.toLowerCase() === path.basename(hfParsed.filePath!).toLowerCase()
          )
        : null) || repoData.files[0];

    const suggestedLoraCategory: LoraCategory | null =
      matchedFile.modelType === 'lora'
        ? classifyLoraFromMetadata({
            name: repoData.repoId,
            filename: matchedFile.filename,
            tags: repoData.tags,
          })
        : null;

    return annotateInstalledSearchResults([
      {
        provider: 'huggingface',
        id: repoData.repoId,
        hfRepoId: repoData.repoId,
        name: repoData.repoId,
        modelType: matchedFile.modelType,
        suggestedSubfolder: matchedFile.suggestedSubfolder,
        suggestedLoraCategory,
        versionName: hfParsed.branch,
        filename: matchedFile.filename,
        fileSize: matchedFile.fileSize,
        sha256Hash: matchedFile.sha256Hash,
        downloadUrl: matchedFile.downloadUrl,
        creator: repoData.repoId.split('/')[0] || 'HuggingFace',
        description: `Hugging Face repository ${repoData.repoId} (${repoData.files.length} weight file${
          repoData.files.length === 1 ? '' : 's'
        })`,
        availableFiles: repoData.files,
        totalRepoFilesCount: repoData.files.length,
      },
    ])[0];
  }

  // 2. Civitai Model Page or API Download URL (.com or .red)
  if (/^https?:\/\/(www\.)?civitai\.(com|red)\//i.test(input)) {
    const result = await resolveCivitaiModelUrl(input);
    return annotateInstalledSearchResults([result])[0];
  }

  // 3. Generic Direct File URL
  if (/^https?:\/\//i.test(input)) {
    const parsedUrl = new URL(input);
    const rawBasename =
      decodeURIComponent(path.basename(parsedUrl.pathname)) || 'downloaded_model.safetensors';
    const cleanFilename = DOWNLOAD_WEIGHT_EXTS.has(path.extname(rawBasename).toLowerCase())
      ? rawBasename
      : `${rawBasename}.safetensors`;
    const inferred = inferSubfolderAndTypeFromPath(parsedUrl.pathname);

    const suggestedLoraCategory: LoraCategory | null =
      inferred.modelType === 'lora'
        ? classifyLoraFromMetadata({
            name: cleanFilename,
            filename: cleanFilename,
          })
        : null;

    return annotateInstalledSearchResults([
      {
        provider: 'direct',
        id: cleanFilename,
        name: cleanFilename.replace(/\.(safetensors|gguf|ckpt|pt|pth|bin|sft)$/i, ''),
        modelType: inferred.modelType,
        suggestedSubfolder: inferred.suggestedSubfolder,
        suggestedLoraCategory,
        versionName: 'Direct URL',
        filename: cleanFilename,
        fileSize: null,
        sha256Hash: null,
        downloadUrl: input,
        creator: parsedUrl.hostname,
        description: `Direct download from ${parsedUrl.hostname}`,
        availableFiles: [
          {
            rfilename: cleanFilename,
            filename: cleanFilename,
            fileSize: null,
            sha256Hash: null,
            downloadUrl: input,
            modelType: inferred.modelType,
            suggestedSubfolder: inferred.suggestedSubfolder,
          },
        ],
        totalRepoFilesCount: 1,
      },
    ])[0];
  }

  throw new Error(
    'Unrecognized URL or repository format. Paste a Civitai URL, Hugging Face URL/repo (owner/repo), or direct model file link.'
  );
}

/**
 * Unified smart model search that automatically routes URLs, Hugging Face owner/repo IDs,
 * SHA-256/AutoV2 hashes, and general keyword queries across Civitai and Hugging Face.
 */
export async function smartSearchModels(
  query: string,
  typeFilter?: string
): Promise<ExternalModelSearchResult[]> {
  const trimmed = query.trim();

  // 1. Direct URL (Civitai, Hugging Face, or direct weight file URL)
  if (/^https?:\/\//i.test(trimmed)) {
    const resolved = await resolveDirectModelUrl(trimmed);
    return [resolved];
  }

  // 2. Hugging Face owner/repo identifier
  const hfRepo = parseHuggingFaceRepoAndFile(trimmed);
  if (hfRepo) {
    const resolved = await resolveDirectModelUrl(trimmed);
    return [resolved];
  }

  // 3. SHA-256 or AutoV2 hash (10 to 64 hex chars) -> Check Civitai hash endpoint first
  if (/^[a-fA-F0-9]{10,64}$/.test(trimmed)) {
    const civitaiHashMatches = await searchCivitaiModels(trimmed, typeFilter);
    if (civitaiHashMatches.length > 0) {
      return civitaiHashMatches;
    }
  }

  // 4. Keyword search across Civitai and Hugging Face in parallel
  const shouldQueryCivitai = typeFilter !== 'clip';
  const [civitaiRes, hfRes] = await Promise.allSettled([
    shouldQueryCivitai ? searchCivitaiModels(trimmed, typeFilter) : Promise.resolve([]),
    searchHuggingFaceModels(trimmed, typeFilter),
  ]);

  const combined: ExternalModelSearchResult[] = [];
  if (civitaiRes.status === 'fulfilled') {
    combined.push(...civitaiRes.value);
  }
  if (hfRes.status === 'fulfilled') {
    combined.push(...hfRes.value);
  }

  if (
    combined.length === 0 &&
    civitaiRes.status === 'rejected' &&
    hfRes.status === 'rejected'
  ) {
    throw new Error(
      civitaiRes.reason?.message || hfRes.reason?.message || 'External model search failed'
    );
  }

  return combined;
}

/**
 * Wrapper around `smartSearchModels` that handles Civitai image/post share URLs (Krea 2 only)
 * and returns optional status notices alongside resolved cards.
 */
export async function smartSearchModelsWithNotice(
  query: string,
  typeFilter?: string
): Promise<{ items: ExternalModelSearchResult[]; notice: string | null }> {
  const trimmed = query.trim();
  if (parseCivitaiShareUrl(trimmed)) {
    return resolveCivitaiImageModelsForDownloader(trimmed, typeFilter);
  }
  const items = await smartSearchModels(query, typeFilter);
  return { items, notice: null };
}

export interface ScheduledDownloadPayload {
  subfolder: ComfyModelSubfolder;
  allowOverwrite: boolean;
  hfRepoId?: string | null;
  civitaiMeta?: Partial<CivitaiNormalizedMeta> | null;
  loraCategory?: LoraCategory | null;
  characterAutomation?: CharacterDownloadAutomation | null;
  mentionAutomation?: LoraMentionAutomation | null;
  retryCount?: number;
}

export interface ExecuteDownloadJobParams {
  provider: 'civitai' | 'huggingface' | 'direct';
  modelName: string;
  safeFilename: string;
  effectiveModelType: ModelType;
  destinationPath: string;
  sourceUrl: string;
  expectedHash?: string | null;
  hfRepoId?: string | null;
  civitaiMeta?: Partial<CivitaiNormalizedMeta> | null;
  loraCategory?: LoraCategory | null;
  characterAutomation?: CharacterDownloadAutomation | null;
  mentionAutomation?: LoraMentionAutomation | null;
  /** When true, caller handles HTTP 401/403 re-scheduling instead of marking failed immediately. */
  deferAuthErrorToCaller?: boolean;
}

const activeDownloadControllers = new Map<number, AbortController>();
const cancelledDownloadJobIds = new Set<number>();

/**
 * Aborts an actively streaming download job if one is running for `jobId`.
 */
export function abortActiveDownloadStream(jobId: number): boolean {
  cancelledDownloadJobIds.add(jobId);
  const controller = activeDownloadControllers.get(jobId);
  if (controller) {
    controller.abort();
    activeDownloadControllers.delete(jobId);
    return true;
  }
  return false;
}

/**
 * Aborts all actively streaming download jobs.
 */
export function abortAllActiveDownloadStreams(): number {
  let count = 0;
  for (const [jobId, controller] of activeDownloadControllers.entries()) {
    cancelledDownloadJobIds.add(jobId);
    controller.abort();
    activeDownloadControllers.delete(jobId);
    count += 1;
  }
  return count;
}

/**
 * Streams a remote model file to disk (.part -> atomic rename), verifies SHA-256,
 * registers the model in SQLite, enriches Civitai previews, and syncs ComfyUI inventory.
 */
export async function executeDownloadJob(
  jobId: number,
  params: ExecuteDownloadJobParams
): Promise<void> {
  const partPath = `${params.destinationPath}.part`;
  cancelledDownloadJobIds.delete(jobId);
  const abortController = new AbortController();
  activeDownloadControllers.set(jobId, abortController);
  let fileStream: fs.WriteStream | null = null;

  try {
    fs.mkdirSync(path.dirname(params.destinationPath), { recursive: true });

    const headers: Record<string, string> = {};
    if (params.provider === 'civitai' && appConfig.civitaiApiKey) {
      headers.Authorization = `Bearer ${appConfig.civitaiApiKey}`;
    } else if (params.provider === 'huggingface' && appConfig.hfApiToken) {
      headers.Authorization = `Bearer ${appConfig.hfApiToken}`;
    }

    let res = await fetch(params.sourceUrl, { headers, signal: abortController.signal });
    if ((!res.ok || !res.body) && /^https?:\/\/(www\.)?civitai\.(com|red)\//i.test(params.sourceUrl)) {
      const altDomain: CivitaiDomain = /civitai\.red/i.test(params.sourceUrl)
        ? 'civitai.com'
        : 'civitai.red';
      const altUrl = rewriteCivitaiDownloadUrl(params.sourceUrl, altDomain);
      const retryRes = await fetch(altUrl, { headers, signal: abortController.signal });
      if (retryRes.ok && retryRes.body) {
        res = retryRes;
      }
    }

    if (!res.ok || !res.body) {
      if ((res.status === 401 || res.status === 403) && params.provider === 'civitai') {
        let discoveredEndsAt: string | null = null;
        try {
          const urlVerMatch = params.sourceUrl.match(/\/api\/download\/models\/(\d+)/i);
          const versionId = params.civitaiMeta?.civitaiVersionId || (urlVerMatch ? urlVerMatch[1] : null);
          if (versionId) {
            const preferredDomain: CivitaiDomain = /civitai\.red/i.test(params.sourceUrl)
              ? 'civitai.red'
              : 'civitai.com';
            const verRes = await fetchCivitaiJsonWithFallback(
              `/api/v1/model-versions/${encodeURIComponent(String(versionId))}`,
              getCivitaiHeaders(),
              preferredDomain,
              6000,
              { bypassCache: true }
            );
            if (verRes?.data) {
              const ea = extractCivitaiEarlyAccessInfo(verRes.data);
              if (ea.earlyAccessEndsAt && Date.parse(ea.earlyAccessEndsAt) > Date.now()) {
                discoveredEndsAt = ea.earlyAccessEndsAt;
                const row = db
                  .prepare('SELECT payload_json FROM download_jobs WHERE id = ?')
                  .get(jobId) as { payload_json: string | null } | undefined;
                if (row) {
                  let existingPayload: Record<string, any> = {};
                  try {
                    existingPayload = row.payload_json ? JSON.parse(row.payload_json) : {};
                  } catch {
                    existingPayload = {};
                  }
                  existingPayload.earlyAccessEndsAt = discoveredEndsAt;
                  db.prepare('UPDATE download_jobs SET payload_json = ? WHERE id = ?').run(
                    JSON.stringify(existingPayload),
                    jobId
                  );
                }
              }
            }
          }
        } catch {
          // ignore lookup failure
        }

        const unlockHint = discoveredEndsAt
          ? `Early Access active until ${new Date(discoveredEndsAt).toLocaleString()} — click Schedule After Unlock below to queue it automatically.`
          : 'Early Access or Creator permission required — check CIVITAI_API_KEY or wait until early access ends';
        const authErr: any = new Error(`Civitai returned HTTP ${res.status} (${unlockHint})`);
        authErr.httpStatus = res.status;
        if (params.deferAuthErrorToCaller) {
          throw authErr;
        }
        throw authErr;
      }
      throw new Error(`Download failed with HTTP ${res.status}`);
    }

    const totalBytes = Number(res.headers.get('content-length') || 0);
    db.prepare('UPDATE download_jobs SET total_bytes = ? WHERE id = ?').run(totalBytes, jobId);

    const hash = crypto.createHash('sha256');
    fileStream = fs.createWriteStream(partPath);
    let bytesDownloaded = 0;
    let lastUpdate = Date.now();

    const nodeReadable = Readable.fromWeb(res.body as any);
    for await (const chunk of nodeReadable) {
      if (abortController.signal.aborted || cancelledDownloadJobIds.has(jobId)) {
        nodeReadable.destroy();
        throw new Error('Download cancelled by user.');
      }
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      hash.update(buf);
      fileStream.write(buf);
      bytesDownloaded += buf.length;

      if (Date.now() - lastUpdate > 400) {
        db.prepare('UPDATE download_jobs SET bytes_downloaded = ? WHERE id = ?').run(
          bytesDownloaded,
          jobId
        );
        lastUpdate = Date.now();
      }
    }

    await new Promise<void>((resolve, reject) => {
      fileStream!.end((err?: Error | null) => (err ? reject(err) : resolve()));
    });
    fileStream = null;

    if (abortController.signal.aborted || cancelledDownloadJobIds.has(jobId)) {
      throw new Error('Download cancelled by user.');
    }

    const actualHash = hash.digest('hex').toUpperCase();
    const expected = params.expectedHash ? params.expectedHash.trim().toUpperCase() : null;
    const hashVerified = expected ? actualHash === expected || actualHash.startsWith(expected) : true;

    if (expected && !hashVerified) {
      fs.unlinkSync(partPath);
      throw new Error(`Hash mismatch: expected ${expected}, got ${actualHash}`);
    }

    fs.renameSync(partPath, params.destinationPath);

    db.prepare(
      `UPDATE download_jobs
       SET status = 'completed', bytes_downloaded = ?, actual_hash = ?,
           hash_verified = ?, error_message = NULL, completed_at = datetime('now')
       WHERE id = ?`
    ).run(bytesDownloaded, actualHash, hashVerified ? 1 : 0, jobId);

    // Register in `models` table (availability in ComfyUI is verified immediately via syncModelInventory)
    const resolvedDest = path.resolve(params.destinationPath);
    const resolvedComfyModels = path.resolve(appConfig.comfyuiModelsDir || '');
    const downloadedDirectlyIntoComfy = Boolean(
      resolvedComfyModels &&
        (resolvedDest === resolvedComfyModels ||
          resolvedDest.startsWith(resolvedComfyModels + path.sep))
    );

    // Determine final LoRA category: explicit user/search selection first,
    // falling back to safetensors header inspection only if still unclassified.
    let resolvedLoraCategory: LoraCategory = 'unclassified';
    if (params.effectiveModelType === 'lora') {
      const requestedCat =
        params.loraCategory && VALID_LORA_CATEGORIES.has(params.loraCategory)
          ? params.loraCategory
          : 'unclassified';
      resolvedLoraCategory =
        requestedCat !== 'unclassified'
          ? requestedCat
          : classifySafetensorsHeaderOnDisk(params.destinationPath, {
              name: params.modelName,
              filename: params.safeFilename,
              trainedWords: params.civitaiMeta?.trainedWords || [],
              description: params.civitaiMeta?.civitaiDescription || null,
              baseModel: params.civitaiMeta?.baseModel || null,
            });
    }

    db.prepare(
      `INSERT INTO models
        (name, filename, model_type, lora_category, file_path, file_size, sha256_hash, autov2_hash, is_installed, source_type, download_url, hf_repo_id, download_file_path, last_seen_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'filesystem', ?, ?, ?, datetime('now'))
       ON CONFLICT(filename) DO UPDATE SET
         model_type = excluded.model_type,
         lora_category = CASE
           WHEN excluded.lora_category <> 'unclassified' THEN excluded.lora_category
           ELSE models.lora_category
         END,
         file_path = excluded.file_path,
         file_size = excluded.file_size,
         sha256_hash = excluded.sha256_hash,
         autov2_hash = excluded.autov2_hash,
         is_installed = excluded.is_installed,
         download_url = excluded.download_url,
         hf_repo_id = COALESCE(excluded.hf_repo_id, models.hf_repo_id),
         download_file_path = excluded.download_file_path,
         last_seen_at = datetime('now')`
    ).run(
      params.modelName,
      params.safeFilename,
      params.effectiveModelType,
      resolvedLoraCategory,
      params.destinationPath,
      bytesDownloaded,
      actualHash.toLowerCase(),
      actualHash.slice(0, 10).toLowerCase(),
      downloadedDirectlyIntoComfy ? 1 : 0,
      params.sourceUrl,
      params.hfRepoId || null,
      downloadedDirectlyIntoComfy ? null : params.destinationPath
    );
    invalidateInstalledModelsCache();
    invalidateStorageUsageStatsCache();

    const savedRow = db
      .prepare('SELECT id FROM models WHERE LOWER(filename) = LOWER(?)')
      .get(params.safeFilename) as { id: number } | undefined;

    if (savedRow && params.provider === 'civitai') {
      try {
        if (params.civitaiMeta) {
          const meta: CivitaiNormalizedMeta = {
            civitaiId: params.civitaiMeta.civitaiId ?? null,
            civitaiVersionId: params.civitaiMeta.civitaiVersionId ?? null,
            civitaiUrl: params.civitaiMeta.civitaiUrl ?? null,
            baseModel: params.civitaiMeta.baseModel ?? null,
            trainedWords: Array.isArray(params.civitaiMeta.trainedWords)
              ? params.civitaiMeta.trainedWords
              : [],
            recommendedWeight: params.civitaiMeta.recommendedWeight ?? null,
            civitaiDescription: params.civitaiMeta.civitaiDescription ?? null,
            previewImages: Array.isArray(params.civitaiMeta.previewImages)
              ? params.civitaiMeta.previewImages
              : [],
          };
          const cacheKey = `m${savedRow.id}_${meta.civitaiVersionId || actualHash.slice(0, 10).toLowerCase()}`;
          const cachedPreviews = await cacheModelPreviewImages(cacheKey, meta.previewImages);
          applyCivitaiEnrichmentToModel(savedRow.id, meta, cachedPreviews);
        } else {
          await fetchAndEnrichModelFromCivitai(savedRow.id);
        }
      } catch {
        // Do not fail completed model download if optional Civitai enrichment fails
      }
    }

    await syncModelInventory();

    if (
      params.effectiveModelType === 'lora' &&
      params.mentionAutomation &&
      (params.mentionAutomation.mentionEnabled || params.mentionAutomation.nickname.trim())
    ) {
      const cleanNick = params.mentionAutomation.nickname.trim().replace(/^@+/, '').toLowerCase();
      try {
        updateLoraMentionConfig({
          loraName: params.safeFilename,
          mentionEnabled: params.mentionAutomation.mentionEnabled,
          ...(cleanNick ? { nickname: cleanNick } : {}),
        });
      } catch (err) {
        console.warn(
          `[Download] Failed to apply @mention config for ${params.safeFilename}:`,
          err
        );
      }
    }

    if (
      params.effectiveModelType === 'lora' &&
      resolvedLoraCategory === 'character' &&
      params.characterAutomation?.addCharacter
    ) {
      await handleDownloadedCharacterLoraAutomation({
        downloadJobId: jobId,
        loraFilename: params.safeFilename,
        recommendedWeight: params.civitaiMeta?.recommendedWeight ?? null,
        automation: params.characterAutomation,
      }).catch(() => {});
    }
  } catch (err: any) {
    if (fileStream) {
      try {
        fileStream.destroy();
      } catch {
        // ignore
      }
    }
    if (fs.existsSync(partPath)) {
      try {
        fs.unlinkSync(partPath);
      } catch {
        // ignore cleanup error
      }
    }
    const wasCancelled =
      cancelledDownloadJobIds.has(jobId) ||
      abortController.signal.aborted ||
      err?.name === 'AbortError';
    if (wasCancelled) {
      db.prepare(`DELETE FROM download_jobs WHERE id = ? AND status IN ('downloading', 'queued')`).run(
        jobId
      );
      return;
    }
    if (params.deferAuthErrorToCaller && (err?.httpStatus === 401 || err?.httpStatus === 403)) {
      throw err;
    }
    db.prepare(
      `UPDATE download_jobs
       SET status = 'failed', error_message = ?, completed_at = datetime('now')
       WHERE id = ?`
    ).run(err?.message || 'Download error', jobId);
  } finally {
    activeDownloadControllers.delete(jobId);
    cancelledDownloadJobIds.delete(jobId);
  }
}

/**
 * Initiates or schedules a server-side model download after explicit user confirmation.
 * Validates destination path, checks duplicate overwrite protection, and either schedules for later
 * or streams immediately to a .part file with SHA-256 verification.
 */
export async function startConfirmedModelDownload(params: {
  provider: 'civitai' | 'huggingface' | 'direct';
  modelName: string;
  filename: string;
  modelType: ModelType;
  sourceUrl: string;
  expectedHash?: string | null;
  subfolder?: string;
  allowOverwrite?: boolean;
  hfRepoId?: string | null;
  civitaiMeta?: Partial<CivitaiNormalizedMeta> | null;
  loraCategory?: LoraCategory | null;
  characterAutomation?: CharacterDownloadAutomation | null;
  mentionAutomation?: LoraMentionAutomation | null;
  scheduledFor?: string | null;
}): Promise<any> {
  // Sanitize filename and subfolder against path traversal
  const safeFilename = path.basename(params.filename.trim());
  if (!safeFilename || safeFilename.startsWith('.')) {
    throw new Error('Invalid destination filename.');
  }

  const defaultFolder = MODEL_TYPE_TO_DEFAULT_SUBFOLDER[params.modelType] || 'checkpoints';
  const safeSubfolder = (params.subfolder || defaultFolder)
    .replace(/[^a-zA-Z0-9_-]/g, '')
    .toLowerCase() as ComfyModelSubfolder;
  const effectiveModelType: ModelType =
    SUBFOLDER_TO_MODEL_TYPE[safeSubfolder] || params.modelType;

  const targetDir = path.join(appConfig.downloadsDir, safeSubfolder);
  const resolvedRoot = path.resolve(appConfig.downloadsDir);
  const resolvedTargetDir = path.resolve(targetDir);

  if (!resolvedTargetDir.startsWith(resolvedRoot)) {
    throw new Error('Destination directory validation failed.');
  }

  fs.mkdirSync(resolvedTargetDir, { recursive: true });
  const destinationPath = path.join(resolvedTargetDir, safeFilename);

  if (fs.existsSync(destinationPath) && !params.allowOverwrite) {
    throw new Error(
      `File "${safeFilename}" already exists in ${resolvedTargetDir}. Confirm overwrite explicitly to replace it.`
    );
  }

  let scheduledIso: string | null = null;
  if (params.scheduledFor && String(params.scheduledFor).trim()) {
    const parsedMs = Date.parse(String(params.scheduledFor).trim());
    if (!Number.isFinite(parsedMs)) {
      throw new Error('Invalid scheduledFor timestamp.');
    }
    if (parsedMs > Date.now() + 5000) {
      scheduledIso = new Date(parsedMs).toISOString();
    }
  }

  const normalizedLoraCategory: LoraCategory | null =
    effectiveModelType === 'lora' &&
    params.loraCategory &&
    VALID_LORA_CATEGORIES.has(params.loraCategory)
      ? params.loraCategory
      : null;

  const normalizedCharacterAutomation: CharacterDownloadAutomation | null =
    effectiveModelType === 'lora' &&
    normalizedLoraCategory === 'character' &&
    params.characterAutomation?.addCharacter
      ? {
          addCharacter: true,
          generateHeadshot: Boolean(params.characterAutomation.generateHeadshot),
          characterName: String(params.characterAutomation.characterName || '').trim(),
          triggerWord: String(params.characterAutomation.triggerWord || '').trim(),
        }
      : null;

  const cleanMentionNick =
    effectiveModelType === 'lora' && params.mentionAutomation?.nickname
      ? String(params.mentionAutomation.nickname).trim().replace(/^@+/, '').toLowerCase()
      : '';
  const wantMentionEnabled = Boolean(
    effectiveModelType === 'lora' && params.mentionAutomation?.mentionEnabled
  );

  if (cleanMentionNick) {
    const existingNick = db
      .prepare(`SELECT filename FROM models WHERE LOWER(nickname) = ? AND LOWER(filename) != LOWER(?)`)
      .get(cleanMentionNick, safeFilename) as { filename: string } | undefined;
    if (existingNick) {
      throw new Error(
        `Mention tag "@${cleanMentionNick}" is already assigned to ${existingNick.filename}.`
      );
    }
  }

  const normalizedMentionAutomation: LoraMentionAutomation | null =
    wantMentionEnabled || cleanMentionNick
      ? {
          mentionEnabled: wantMentionEnabled,
          nickname: cleanMentionNick,
        }
      : null;

  const payloadJson = JSON.stringify({
    subfolder: safeSubfolder,
    allowOverwrite: Boolean(params.allowOverwrite),
    hfRepoId: params.hfRepoId || null,
    civitaiMeta: params.civitaiMeta || null,
    loraCategory: normalizedLoraCategory,
    characterAutomation: normalizedCharacterAutomation,
    mentionAutomation: normalizedMentionAutomation,
    retryCount: 0,
  } satisfies ScheduledDownloadPayload);

  const initialStatus = scheduledIso ? 'scheduled' : 'downloading';

  const info = db
    .prepare(
      `INSERT INTO download_jobs
        (provider, model_name, model_type, source_url, destination_path, expected_hash, status, scheduled_for, payload_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      params.provider,
      params.modelName,
      effectiveModelType,
      params.sourceUrl,
      destinationPath,
      params.expectedHash || null,
      initialStatus,
      scheduledIso,
      payloadJson
    );
  const jobId = Number(info.lastInsertRowid);

  if (!scheduledIso) {
    setImmediate(() => {
      executeDownloadJob(jobId, {
        provider: params.provider,
        modelName: params.modelName,
        safeFilename,
        effectiveModelType,
        destinationPath,
        sourceUrl: params.sourceUrl,
        expectedHash: params.expectedHash || null,
        hfRepoId: params.hfRepoId || null,
        civitaiMeta: params.civitaiMeta || null,
        loraCategory: normalizedLoraCategory,
        characterAutomation: normalizedCharacterAutomation,
        mentionAutomation: normalizedMentionAutomation,
      }).catch(() => {});
    });
  }

  return db.prepare('SELECT * FROM download_jobs WHERE id = ?').get(jobId);
}
