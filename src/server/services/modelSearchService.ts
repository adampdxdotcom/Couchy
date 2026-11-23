import path from 'path';
import { appConfig } from '../config.ts';
import { DOWNLOAD_WEIGHT_EXTS, inferSubfolderAndTypeFromPath } from './modelDownloadPaths.ts';
import {
  listHuggingFaceRepoFiles,
  parseHuggingFaceRepoAndFile,
} from './huggingFaceMetadataService.ts';
import {
  extractCivitaiVersions,
  fetchCivitaiJsonWithFallback,
  fetchCivitaiParentModelWithDomain,
  getCivitaiHeaders,
  parseCivitaiShareUrl,
  probeCivitaiWebDomain,
  resolveCivitaiDomain,
  resolveCivitaiModelUrl,
  type CivitaiDomain,
} from './civitai/civitaiHttpAndParse.ts';
import { annotateInstalledSearchResults } from './civitai/civitaiModelEnrichmentService.ts';
import { resolveCivitaiImageModelsForDownloader } from './civitai/civitaiImageShareService.ts';
import { classifyLoraFromMetadata } from './loraClassifierService.ts';
import type {
  ExternalModelFileOption,
  ExternalModelSearchResult,
  LoraCategory,
} from '../../shared/types.ts';

export type { ExternalModelSearchResult };

/**
 * Searches Civitai REST API (.com and .red) for models by query or SHA-256/AutoV2 hash.
 */
export async function searchCivitaiModels(
  query: string,
  typeFilter?: string
): Promise<ExternalModelSearchResult[]> {
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
