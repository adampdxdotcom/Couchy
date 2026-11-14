import path from 'path';
import { db } from '../db.ts';
import { appConfig } from '../config.ts';
import {
  extractCivitaiEarlyAccessInfo,
  fetchCivitaiJsonWithFallback,
  fetchCivitaiParentModelWithDomain,
  getCivitaiHeaders,
  normalizeCivitaiData,
  probeCivitaiWebDomain,
  resolveCivitaiDomain,
  rewriteCivitaiDownloadUrl,
  type CivitaiDomain,
} from './civitaiMetadataService.ts';
import type {
  ComfyModelSubfolder,
  ExternalModelFileOption,
  ExternalModelInstalledInfo,
  ExternalModelSearchResult,
  ExternalModelVersionOption,
  ModelType,
} from '../../shared/types.ts';

export const DOWNLOAD_WEIGHT_EXTS = new Set([
  '.safetensors',
  '.gguf',
  '.ckpt',
  '.pt',
  '.pth',
  '.bin',
  '.sft',
]);

export const SUBFOLDER_TO_MODEL_TYPE: Record<ComfyModelSubfolder, ModelType> = {
  loras: 'lora',
  checkpoints: 'checkpoint',
  diffusion_models: 'diffusion',
  unet: 'diffusion',
  text_encoders: 'clip',
  clip: 'clip',
  vae: 'vae',
  controlnet: 'controlnet',
  upscale_models: 'upscaler',
  embeddings: 'embedding',
};

export const MODEL_TYPE_TO_DEFAULT_SUBFOLDER: Record<ModelType, ComfyModelSubfolder> = {
  lora: 'loras',
  checkpoint: 'checkpoints',
  diffusion: 'diffusion_models',
  clip: 'text_encoders',
  vae: 'vae',
  controlnet: 'controlnet',
  upscaler: 'upscale_models',
  embedding: 'embeddings',
  other: 'checkpoints',
};

/**
 * Infers the ComfyUI subfolder and ModelType from a relative repository path, filename, or tags.
 */
export function inferSubfolderAndTypeFromPath(
  rfilename: string,
  repoTags: string[] = [],
  explicitCivitaiType?: string,
  baseModel?: string | null
): { suggestedSubfolder: ComfyModelSubfolder; modelType: ModelType; subfolderHint?: string | null } {
  const lowerPath = rfilename.toLowerCase().replace(/\\/g, '/');
  const filename = path.basename(lowerPath);
  const ext = path.extname(filename);
  const tagsLower = repoTags.map((t) => t.toLowerCase());

  // 1. Check explicit Civitai type if provided
  if (explicitCivitaiType) {
    const cType = explicitCivitaiType.toLowerCase();
    if (cType === 'lora' || cType === 'locon' || cType === 'dora') {
      return { suggestedSubfolder: 'loras', modelType: 'lora' };
    }
    if (cType === 'vae') {
      return { suggestedSubfolder: 'vae', modelType: 'vae' };
    }
    if (cType === 'controlnet') {
      return { suggestedSubfolder: 'controlnet', modelType: 'controlnet' };
    }
    if (cType === 'upscaler') {
      return { suggestedSubfolder: 'upscale_models', modelType: 'upscaler' };
    }
    if (cType === 'textualinversion' || cType === 'embedding') {
      return { suggestedSubfolder: 'embeddings', modelType: 'embedding' };
    }
    if (cType === 'checkpoint') {
      const bm = (baseModel || '').toLowerCase();
      const isModernDiT =
        bm.includes('flux') ||
        bm.includes('wan') ||
        bm.includes('qwen') ||
        bm.includes('chroma') ||
        bm.includes('hidream') ||
        bm.includes('hunyuan') ||
        ext === '.gguf';
      const looksLikeAio = /aio|all[-_ ]?in[-_ ]?one|checkpoint|ckpt/i.test(filename);
      if (ext === '.gguf' || (isModernDiT && !looksLikeAio)) {
        return {
          suggestedSubfolder: 'diffusion_models',
          modelType: 'diffusion',
          subfolderHint:
            'Modern DiT / GGUF base models usually load via UNETLoader (diffusion_models) unless bundled as an All-in-One checkpoint.',
        };
      }
      return { suggestedSubfolder: 'checkpoints', modelType: 'checkpoint' };
    }
  }

  // 2. Check folder segments or filename patterns
  if (
    lowerPath.includes('text_encoders/') ||
    lowerPath.includes('/clip/') ||
    /(^|[_/-])(clip_l|clip_g|t5xxl|umt5|llava|qwen_2\.5|text_encoder)/i.test(filename)
  ) {
    return { suggestedSubfolder: 'text_encoders', modelType: 'clip' };
  }

  if (
    lowerPath.includes('vae/') ||
    /(^|[_/-])(vae|ae\.safetensors|sdxl_vae|flux_vae)/i.test(lowerPath)
  ) {
    return { suggestedSubfolder: 'vae', modelType: 'vae' };
  }

  if (
    lowerPath.includes('controlnet/') ||
    lowerPath.includes('control_net') ||
    tagsLower.includes('controlnet') ||
    /controlnet|ip-adapter|ipadapter|t2i-adapter/i.test(lowerPath)
  ) {
    return { suggestedSubfolder: 'controlnet', modelType: 'controlnet' };
  }

  if (
    lowerPath.includes('upscale') ||
    /esrgan|ultrasharp|remacri|4x[-_]|2x[-_]|swinir/i.test(lowerPath)
  ) {
    return { suggestedSubfolder: 'upscale_models', modelType: 'upscaler' };
  }

  if (lowerPath.includes('embeddings/') || lowerPath.includes('textual_inversion')) {
    return { suggestedSubfolder: 'embeddings', modelType: 'embedding' };
  }

  if (
    lowerPath.includes('loras/') ||
    lowerPath.includes('/lora/') ||
    tagsLower.includes('lora') ||
    /(^|[_/-])lora([_.-]|$)/i.test(filename)
  ) {
    return { suggestedSubfolder: 'loras', modelType: 'lora' };
  }

  if (
    lowerPath.includes('diffusion_models/') ||
    lowerPath.includes('unet/') ||
    ext === '.gguf' ||
    /(^|[_/-])(flux1|wan2|qwen_image|chroma|hidream|z_image|unet)/i.test(filename)
  ) {
    return { suggestedSubfolder: 'diffusion_models', modelType: 'diffusion' };
  }

  return { suggestedSubfolder: 'checkpoints', modelType: 'checkpoint' };
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
 * Annotates search results (and each nested version option) with local installation matches
 * checked against SHA-256 hash, Civitai version ID, and filename.
 */
export function annotateInstalledSearchResults(
  items: ExternalModelSearchResult[]
): ExternalModelSearchResult[] {
  if (!items || items.length === 0) return items;

  const installedRows = db
    .prepare(
      `SELECT id, filename, model_type, sha256_hash, autov2_hash, civitai_version_id
       FROM models
       WHERE is_installed = 1`
    )
    .all() as Array<{
    id: number;
    filename: string;
    model_type: string;
    sha256_hash: string | null;
    autov2_hash: string | null;
    civitai_version_id: string | null;
  }>;

  if (installedRows.length === 0) return items;

  const bySha256 = new Map<string, (typeof installedRows)[number]>();
  const byAutoV2 = new Map<string, (typeof installedRows)[number]>();
  const byVersionId = new Map<string, (typeof installedRows)[number]>();
  const byFilename = new Map<string, (typeof installedRows)[number]>();

  for (const row of installedRows) {
    if (row.sha256_hash) bySha256.set(row.sha256_hash.trim().toUpperCase(), row);
    if (row.autov2_hash) byAutoV2.set(row.autov2_hash.trim().toUpperCase(), row);
    if (row.civitai_version_id) byVersionId.set(String(row.civitai_version_id).trim(), row);
    if (row.filename) byFilename.set(path.basename(row.filename).trim().toLowerCase(), row);
  }

  const resolveMatch = (entry: {
    sha256Hash?: string | null;
    versionId?: string | null;
    filename?: string | null;
    availableFiles?: ExternalModelFileOption[];
  }): ExternalModelInstalledInfo => {
    const hashes = new Set<string>();
    if (entry.sha256Hash) hashes.add(entry.sha256Hash.trim().toUpperCase());
    for (const f of entry.availableFiles || []) {
      if (f.sha256Hash) hashes.add(f.sha256Hash.trim().toUpperCase());
    }

    for (const h of hashes) {
      const m = bySha256.get(h) || byAutoV2.get(h.slice(0, 10));
      if (m) {
        return {
          isInstalled: true,
          installedModelId: m.id,
          installedFilename: m.filename,
          installedModelType: m.model_type as ModelType,
          installedMatchReason: 'hash',
        };
      }
    }

    if (entry.versionId) {
      const m = byVersionId.get(String(entry.versionId).trim());
      if (m) {
        return {
          isInstalled: true,
          installedModelId: m.id,
          installedFilename: m.filename,
          installedModelType: m.model_type as ModelType,
          installedMatchReason: 'version_id',
        };
      }
    }

    if (entry.filename) {
      const m = byFilename.get(path.basename(entry.filename).trim().toLowerCase());
      if (m) {
        return {
          isInstalled: true,
          installedModelId: m.id,
          installedFilename: m.filename,
          installedModelType: m.model_type as ModelType,
          installedMatchReason: 'filename',
        };
      }
    }

    return {
      isInstalled: false,
      installedModelId: null,
      installedFilename: null,
      installedModelType: null,
      installedMatchReason: null,
    };
  };

  return items.map((item) => {
    const annotatedVersions = item.availableVersions?.map((v) => ({
      ...v,
      ...resolveMatch({
        sha256Hash: v.sha256Hash,
        versionId: v.versionId,
        filename: v.filename,
        availableFiles: v.availableFiles,
      }),
    }));

    return {
      ...item,
      ...resolveMatch(item),
      ...(annotatedVersions ? { availableVersions: annotatedVersions } : {}),
    };
  });
}

/**
 * Normalizes a Hugging Face repo ID from a plain `owner/repo` string or full URL.
 */
export function parseHuggingFaceRepoAndFile(input: string): {
  repoId: string;
  branch: string;
  filePath: string | null;
} | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  try {
    if (/^https?:\/\/(www\.)?huggingface\.co\//i.test(trimmed)) {
      const url = new URL(trimmed);
      const parts = url.pathname.split('/').filter(Boolean);
      if (parts.length < 2) return null;
      const repoId = `${parts[0]}/${parts[1]}`;
      if (parts.length >= 4 && (parts[2] === 'blob' || parts[2] === 'resolve' || parts[2] === 'tree')) {
        const branch = parts[3] || 'main';
        const filePath = parts.length > 4 ? decodeURIComponent(parts.slice(4).join('/')) : null;
        return { repoId, branch, filePath };
      }
      return { repoId, branch: 'main', filePath: null };
    }
  } catch {
    return null;
  }

  // Plain owner/repo format
  if (/^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/.test(trimmed)) {
    return { repoId: trimmed, branch: 'main', filePath: null };
  }

  return null;
}

/**
 * Queries Hugging Face Hub for all weight files in a repository (with recursive tree sizes & LFS SHA-256).
 */
export async function listHuggingFaceRepoFiles(
  repoIdInput: string,
  branch = 'main'
): Promise<{
  repoId: string;
  tags: string[];
  downloads: number;
  files: ExternalModelFileOption[];
}> {
  const parsed = parseHuggingFaceRepoAndFile(repoIdInput);
  const repoId = parsed ? parsed.repoId : repoIdInput.trim();
  const targetBranch = parsed?.branch || branch || 'main';

  const headers: Record<string, string> = {};
  if (appConfig.hfApiToken) {
    headers.Authorization = `Bearer ${appConfig.hfApiToken}`;
  }

  const metaRes = await fetch(`https://huggingface.co/api/models/${repoId}`, { headers });
  if (!metaRes.ok) {
    throw new Error(`Hugging Face repository "${repoId}" not found (HTTP ${metaRes.status})`);
  }
  const repoMeta = (await metaRes.json()) as any;
  const tags: string[] = Array.isArray(repoMeta.tags) ? repoMeta.tags : [];

  // Fetch recursive tree for exact file sizes and LFS SHA-256 hashes
  let treeEntries: any[] = [];
  try {
    const treeRes = await fetch(
      `https://huggingface.co/api/models/${repoId}/tree/${encodeURIComponent(targetBranch)}?recursive=true`,
      { headers }
    );
    if (treeRes.ok) {
      treeEntries = (await treeRes.json()) as any[];
    }
  } catch {
    // Fallback to repoMeta.siblings below
  }

  const files: ExternalModelFileOption[] = [];

  if (treeEntries.length > 0) {
    for (const entry of treeEntries) {
      if (entry.type !== 'file' || !entry.path) continue;
      const rfilename = String(entry.path);
      const ext = path.extname(rfilename).toLowerCase();
      if (!DOWNLOAD_WEIGHT_EXTS.has(ext)) continue;

      const inferred = inferSubfolderAndTypeFromPath(rfilename, tags);
      const encodedPath = rfilename
        .split('/')
        .map((seg) => encodeURIComponent(seg))
        .join('/');

      files.push({
        rfilename,
        filename: path.basename(rfilename),
        fileSize: typeof entry.size === 'number' ? entry.size : entry.lfs?.size ?? null,
        sha256Hash: entry.lfs?.oid ? String(entry.lfs.oid).toUpperCase() : null,
        downloadUrl: `https://huggingface.co/${repoId}/resolve/${encodeURIComponent(targetBranch)}/${encodedPath}`,
        modelType: inferred.modelType,
        suggestedSubfolder: inferred.suggestedSubfolder,
      });
    }
  } else {
    const siblings = Array.isArray(repoMeta.siblings) ? repoMeta.siblings : [];
    for (const s of siblings) {
      const rfilename = String(s.rfilename || '');
      const ext = path.extname(rfilename).toLowerCase();
      if (!DOWNLOAD_WEIGHT_EXTS.has(ext)) continue;

      const inferred = inferSubfolderAndTypeFromPath(rfilename, tags);
      const encodedPath = rfilename
        .split('/')
        .map((seg) => encodeURIComponent(seg))
        .join('/');

      files.push({
        rfilename,
        filename: path.basename(rfilename),
        fileSize: typeof s.size === 'number' ? s.size : s.lfs?.size ?? null,
        sha256Hash: s.lfs?.oid ? String(s.lfs.oid).toUpperCase() : null,
        downloadUrl: `https://huggingface.co/${repoId}/resolve/${encodeURIComponent(targetBranch)}/${encodedPath}`,
        modelType: inferred.modelType,
        suggestedSubfolder: inferred.suggestedSubfolder,
      });
    }
  }

  return {
    repoId,
    tags,
    downloads: Number(repoMeta.downloads || 0),
    files,
  };
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

    return annotateInstalledSearchResults([
      {
        provider: 'huggingface',
        id: repoData.repoId,
        hfRepoId: repoData.repoId,
        name: repoData.repoId,
        modelType: matchedFile.modelType,
        suggestedSubfolder: matchedFile.suggestedSubfolder,
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

    const result: ExternalModelSearchResult = {
      provider: 'civitai',
      id: String(resolvedModelId || targetVer.id),
      versionId: activeVersion.versionId,
      civitaiUrl: activeVersion.civitaiUrl,
      name: parentModel?.name || targetVer.model?.name || activeVersion.filename,
      modelType: activeVersion.modelType,
      suggestedSubfolder: activeVersion.suggestedSubfolder,
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
      description: activeVersion.civitaiDescription?.slice(0, 220) || 'Resolved from Civitai URL',
      availableFiles: activeVersion.availableFiles,
      totalRepoFilesCount: activeVersion.availableFiles.length,
      availableVersions,
      earlyAccessEndsAt: activeVersion.earlyAccessEndsAt,
      isEarlyAccessActive: activeVersion.isEarlyAccessActive,
      availability: activeVersion.availability,
      earlyAccessConfig: activeVersion.earlyAccessConfig,
    };

    return annotateInstalledSearchResults([result])[0];
  }

  // 3. Generic Direct File URL
  if (/^https?:\/\//i.test(input)) {
    const parsedUrl = new URL(input);
    const rawBasename = decodeURIComponent(path.basename(parsedUrl.pathname)) || 'downloaded_model.safetensors';
    const cleanFilename = DOWNLOAD_WEIGHT_EXTS.has(path.extname(rawBasename).toLowerCase())
      ? rawBasename
      : `${rawBasename}.safetensors`;
    const inferred = inferSubfolderAndTypeFromPath(parsedUrl.pathname);

    return annotateInstalledSearchResults([
      {
        provider: 'direct',
        id: cleanFilename,
        name: cleanFilename.replace(/\.(safetensors|gguf|ckpt|pt|pth|bin|sft)$/i, ''),
        modelType: inferred.modelType,
        suggestedSubfolder: inferred.suggestedSubfolder,
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
