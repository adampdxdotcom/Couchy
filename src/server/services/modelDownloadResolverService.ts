import path from 'path';
import { appConfig } from '../config.ts';
import {
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
  ExternalModelSearchResult,
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

    return {
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
    };
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
    const availableFiles = extractCivitaiVersionFiles(
      targetVer,
      rawType,
      targetVer.baseModel,
      finalDomain
    );
    const primaryFile = availableFiles[0];
    if (!primaryFile) {
      throw new Error('No downloadable weight files found on that Civitai model version.');
    }

    const meta = normalizeCivitaiData(
      parentModel || { id: targetVer.modelId, ...targetVer.model },
      targetVer,
      primaryFile.filename,
      finalDomain
    );
    const inferred = inferSubfolderAndTypeFromPath(
      primaryFile.filename,
      [],
      rawType,
      meta.baseModel
    );

    return {
      provider: 'civitai',
      id: meta.civitaiId || String(parentModel?.id || targetVer.modelId || targetVer.id),
      versionId: meta.civitaiVersionId,
      civitaiUrl: meta.civitaiUrl,
      name: parentModel?.name || targetVer.model?.name || primaryFile.filename,
      modelType: inferred.modelType,
      suggestedSubfolder: inferred.suggestedSubfolder,
      subfolderHint: inferred.subfolderHint || null,
      versionName: targetVer.name || 'Latest',
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
        parentModel?.creator?.username || targetVer.model?.creator?.username || 'Civitai Creator',
      description: meta.civitaiDescription?.slice(0, 220) || 'Resolved from Civitai URL',
      availableFiles,
      totalRepoFilesCount: availableFiles.length,
    };
  }

  // 3. Generic Direct File URL
  if (/^https?:\/\//i.test(input)) {
    const parsedUrl = new URL(input);
    const rawBasename = decodeURIComponent(path.basename(parsedUrl.pathname)) || 'downloaded_model.safetensors';
    const cleanFilename = DOWNLOAD_WEIGHT_EXTS.has(path.extname(rawBasename).toLowerCase())
      ? rawBasename
      : `${rawBasename}.safetensors`;
    const inferred = inferSubfolderAndTypeFromPath(parsedUrl.pathname);

    return {
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
    };
  }

  throw new Error(
    'Unrecognized URL or repository format. Paste a Civitai URL, Hugging Face URL/repo (owner/repo), or direct model file link.'
  );
}
