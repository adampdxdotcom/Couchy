import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { Readable } from 'stream';
import { db } from '../db.ts';
import { appConfig } from '../config.ts';
import { syncModelInventory } from './comfyuiService.ts';
import {
  applyCivitaiEnrichmentToModel,
  cacheModelPreviewImages,
  fetchAndEnrichModelFromCivitai,
  fetchCivitaiJsonWithFallback,
  fetchCivitaiParentModelWithDomain,
  getCivitaiHeaders,
  normalizeCivitaiData,
  probeCivitaiWebDomain,
  resolveCivitaiDomain,
  rewriteCivitaiDownloadUrl,
  type CivitaiDomain,
  type CivitaiNormalizedMeta,
} from './civitaiMetadataService.ts';
import {
  DOWNLOAD_WEIGHT_EXTS,
  MODEL_TYPE_TO_DEFAULT_SUBFOLDER,
  SUBFOLDER_TO_MODEL_TYPE,
  extractCivitaiVersionFiles,
  inferSubfolderAndTypeFromPath,
  parseHuggingFaceRepoAndFile,
  resolveDirectModelUrl,
} from './modelDownloadResolverService.ts';
import type {
  ComfyModelSubfolder,
  ExternalModelFileOption,
  ExternalModelSearchResult,
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
        const availableFiles = extractCivitaiVersionFiles(
          ver,
          rawType,
          ver.baseModel,
          finalDomain
        );
        const primaryFile = availableFiles[0];
        if (primaryFile) {
          const meta = normalizeCivitaiData(
            parentModel || { id: ver.modelId, ...ver.model },
            ver,
            primaryFile.filename,
            finalDomain
          );
          const inferred = inferSubfolderAndTypeFromPath(
            primaryFile.filename,
            [],
            rawType,
            meta.baseModel
          );
          const excerpt =
            meta.civitaiDescription?.slice(0, 220) ||
            `Matched exact model hash ${trimmed}`;

          return [
            {
              provider: 'civitai',
              id: meta.civitaiId || String(ver.modelId || ver.id),
              versionId: meta.civitaiVersionId,
              civitaiUrl: meta.civitaiUrl,
              name: parentModel?.name || ver.model?.name || primaryFile.filename,
              modelType: inferred.modelType,
              suggestedSubfolder: inferred.suggestedSubfolder,
              subfolderHint: inferred.subfolderHint || null,
              versionName: ver.name || 'v1.0',
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
              creator:
                parentModel?.creator?.username ||
                ver.model?.creator?.username ||
                'Civitai Creator',
              description: excerpt,
              availableFiles,
              totalRepoFilesCount: availableFiles.length,
            },
          ];
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
    const availableFiles = extractCivitaiVersionFiles(
      latestVer,
      rawType,
      latestVer.baseModel,
      itemDomain
    );
    const primaryFile = availableFiles[0];
    if (!primaryFile) continue;

    const meta = normalizeCivitaiData(item, latestVer, primaryFile.filename, itemDomain);
    const inferred = inferSubfolderAndTypeFromPath(
      primaryFile.filename,
      [],
      rawType,
      meta.baseModel
    );

    results.push({
      provider: 'civitai',
      id: String(item.id),
      versionId: meta.civitaiVersionId,
      civitaiUrl: meta.civitaiUrl,
      name: item.name,
      modelType: inferred.modelType,
      suggestedSubfolder: inferred.suggestedSubfolder,
      subfolderHint: inferred.subfolderHint || null,
      versionName: latestVer.name || 'Latest',
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
      creator: item.creator?.username || 'Unknown',
      description:
        meta.civitaiDescription?.slice(0, 220) ||
        String(item.description || '').replace(/<[^>]+>/g, '').slice(0, 220),
      availableFiles,
      totalRepoFilesCount: availableFiles.length,
    });
  }

  return results;
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
      : availableFiles[0];

    if (typeFilter && !matchingFile) continue;
    const primary = matchingFile || availableFiles[0];

    results.push({
      provider: 'huggingface',
      id: repoId,
      hfRepoId: repoId,
      name: repoId,
      modelType: primary.modelType,
      suggestedSubfolder: primary.suggestedSubfolder,
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

  return results;
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
 * Initiates a server-side model download after explicit user confirmation.
 * Validates destination path, checks duplicate overwrite protection, streams to a .part file,
 * and verifies SHA-256 hash upon completion.
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
}): Promise<any> {
  // Sanitize filename and subfolder against path traversal
  const safeFilename = path.basename(params.filename.trim());
  if (!safeFilename || safeFilename.startsWith('.')) {
    throw new Error('Invalid destination filename.');
  }

  const defaultFolder = MODEL_TYPE_TO_DEFAULT_SUBFOLDER[params.modelType] || 'checkpoints';
  const safeSubfolder = (params.subfolder || defaultFolder)
    .replace(/[^a-zA-Z0-9_-]/g, '')
    .toLowerCase();
  const effectiveModelType: ModelType =
    SUBFOLDER_TO_MODEL_TYPE[safeSubfolder as ComfyModelSubfolder] || params.modelType;

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

  const info = db
    .prepare(
      `INSERT INTO download_jobs
        (provider, model_name, model_type, source_url, destination_path, expected_hash, status)
       VALUES (?, ?, ?, ?, ?, ?, 'downloading')`
    )
    .run(
      params.provider,
      params.modelName,
      effectiveModelType,
      params.sourceUrl,
      destinationPath,
      params.expectedHash || null
    );
  const jobId = Number(info.lastInsertRowid);

  // Stream download asynchronously on the server
  setImmediate(async () => {
    const partPath = `${destinationPath}.part`;
    try {
      const headers: Record<string, string> = {};
      if (params.provider === 'civitai' && appConfig.civitaiApiKey) {
        headers.Authorization = `Bearer ${appConfig.civitaiApiKey}`;
      } else if (params.provider === 'huggingface' && appConfig.hfApiToken) {
        headers.Authorization = `Bearer ${appConfig.hfApiToken}`;
      }

      let res = await fetch(params.sourceUrl, { headers });
      if ((!res.ok || !res.body) && /^https?:\/\/(www\.)?civitai\.(com|red)\//i.test(params.sourceUrl)) {
        const altDomain: CivitaiDomain = /civitai\.red/i.test(params.sourceUrl)
          ? 'civitai.com'
          : 'civitai.red';
        const altUrl = rewriteCivitaiDownloadUrl(params.sourceUrl, altDomain);
        const retryRes = await fetch(altUrl, { headers });
        if (retryRes.ok && retryRes.body) {
          res = retryRes;
        }
      }
      if (!res.ok || !res.body) {
        throw new Error(`Download failed with HTTP ${res.status}`);
      }

      const totalBytes = Number(res.headers.get('content-length') || 0);
      db.prepare('UPDATE download_jobs SET total_bytes = ? WHERE id = ?').run(totalBytes, jobId);

      const hash = crypto.createHash('sha256');
      const fileStream = fs.createWriteStream(partPath);
      let bytesDownloaded = 0;
      let lastUpdate = Date.now();

      const nodeReadable = Readable.fromWeb(res.body as any);
      for await (const chunk of nodeReadable) {
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
        fileStream.end((err?: Error | null) => (err ? reject(err) : resolve()));
      });

      const actualHash = hash.digest('hex').toUpperCase();
      const expected = params.expectedHash ? params.expectedHash.trim().toUpperCase() : null;
      const hashVerified = expected ? actualHash === expected || actualHash.startsWith(expected) : true;

      if (expected && !hashVerified) {
        fs.unlinkSync(partPath);
        throw new Error(`Hash mismatch: expected ${expected}, got ${actualHash}`);
      }

      fs.renameSync(partPath, destinationPath);

      db.prepare(
        `UPDATE download_jobs
         SET status = 'completed', bytes_downloaded = ?, actual_hash = ?,
             hash_verified = ?, completed_at = datetime('now')
         WHERE id = ?`
      ).run(bytesDownloaded, actualHash, hashVerified ? 1 : 0, jobId);

      // Register in `models` table and apply Civitai enrichment if applicable
      db.prepare(
        `INSERT INTO models
          (name, filename, model_type, file_path, file_size, sha256_hash, autov2_hash, is_installed, source_type, download_url, hf_repo_id, last_seen_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 1, 'filesystem', ?, ?, datetime('now'))
         ON CONFLICT(filename) DO UPDATE SET
           model_type = excluded.model_type,
           file_path = excluded.file_path,
           file_size = excluded.file_size,
           sha256_hash = excluded.sha256_hash,
           autov2_hash = excluded.autov2_hash,
           is_installed = 1,
           download_url = excluded.download_url,
           hf_repo_id = COALESCE(excluded.hf_repo_id, models.hf_repo_id),
           last_seen_at = datetime('now')`
      ).run(
        params.modelName,
        safeFilename,
        effectiveModelType,
        destinationPath,
        bytesDownloaded,
        actualHash.toLowerCase(),
        actualHash.slice(0, 10).toLowerCase(),
        params.sourceUrl,
        params.hfRepoId || null
      );

      const savedRow = db
        .prepare('SELECT id FROM models WHERE LOWER(filename) = LOWER(?)')
        .get(safeFilename) as { id: number } | undefined;

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
    } catch (err: any) {
      if (fs.existsSync(partPath)) {
        try {
          fs.unlinkSync(partPath);
        } catch {
          // ignore cleanup error
        }
      }
      db.prepare(
        `UPDATE download_jobs
         SET status = 'failed', error_message = ?, completed_at = datetime('now')
         WHERE id = ?`
      ).run(err?.message || 'Download error', jobId);
    }
  });

  return db.prepare('SELECT * FROM download_jobs WHERE id = ?').get(jobId);
}
