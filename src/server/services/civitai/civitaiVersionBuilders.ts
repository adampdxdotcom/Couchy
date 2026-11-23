import path from 'path';
import { DOWNLOAD_WEIGHT_EXTS, inferSubfolderAndTypeFromPath } from '../modelDownloadPaths.ts';
import { classifyLoraFromMetadata } from '../loraClassifierService.ts';
import {
  buildCivitaiUrl,
  resolveCivitaiDomain,
  rewriteCivitaiDownloadUrl,
  type CivitaiDomain,
} from './civitaiUrlAndDomain.ts';
import {
  extractCivitaiEarlyAccessInfo,
  extractRecommendedWeight,
  extractStaticPreviewImages,
  formatCivitaiHtmlDescription,
} from './civitaiMetadataExtractors.ts';
import type {
  ExternalModelFileOption,
  ExternalModelSearchResult,
  ExternalModelVersionOption,
  LoraCategory,
} from '../../../shared/types.ts';

export interface CivitaiNormalizedMeta {
  civitaiId: string | null;
  civitaiVersionId: string | null;
  civitaiUrl: string | null;
  baseModel: string | null;
  trainedWords: string[];
  recommendedWeight: number | null;
  civitaiDescription: string | null;
  previewImages: { url: string; width?: number | null; height?: number | null }[];
}

/**
 * Normalizes a Civitai parent model object and version object into shared metadata fields.
 */
export function normalizeCivitaiData(
  modelObj: any,
  versionObj: any,
  fallbackFilename?: string | null,
  preferredDomain?: CivitaiDomain
): CivitaiNormalizedMeta {
  const civitaiId = modelObj?.id
    ? String(modelObj.id)
    : versionObj?.modelId
    ? String(versionObj.modelId)
    : null;
  const civitaiVersionId = versionObj?.id ? String(versionObj.id) : null;
  const domain = resolveCivitaiDomain(modelObj, versionObj, preferredDomain);
  const civitaiUrl = buildCivitaiUrl(civitaiId, civitaiVersionId, domain);
  const baseModel =
    typeof versionObj?.baseModel === 'string' && versionObj.baseModel.trim()
      ? versionObj.baseModel.trim()
      : null;

  const rawWords = Array.isArray(versionObj?.trainedWords) ? versionObj.trainedWords : [];
  const trainedWords = Array.from(
    new Set<string>(
      rawWords
        .map((w: any) => String(w || '').trim())
        .filter((w: string) => w.length > 0)
    )
  );

  const parentDesc = formatCivitaiHtmlDescription(modelObj?.description);
  const versionDesc = formatCivitaiHtmlDescription(versionObj?.description);
  let civitaiDescription: string | null = null;
  if (parentDesc && versionDesc && !parentDesc.includes(versionDesc)) {
    civitaiDescription = `${parentDesc}\n\nVersion Notes:\n${versionDesc}`;
  } else {
    civitaiDescription = parentDesc || versionDesc || null;
  }

  const primaryFile = (versionObj?.files || [])[0];
  const recommendedWeight = extractRecommendedWeight(
    versionObj,
    civitaiDescription,
    primaryFile?.name || fallbackFilename || modelObj?.name
  );

  const previewImages = extractStaticPreviewImages(versionObj, 4);

  return {
    civitaiId,
    civitaiVersionId,
    civitaiUrl,
    baseModel,
    trainedWords,
    recommendedWeight,
    civitaiDescription,
    previewImages,
  };
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

  const parentTags = Array.isArray(parentModel?.tags)
    ? parentModel.tags
    : Array.isArray(versionObj?.model?.tags)
    ? versionObj.model.tags
    : [];
  const suggestedLoraCategory: LoraCategory | null =
    inferred.modelType === 'lora'
      ? classifyLoraFromMetadata({
          name: parentModel?.name || versionObj?.model?.name || versionObj?.name,
          filename: primaryFile.filename,
          tags: parentTags,
          trainedWords: meta.trainedWords,
          description: meta.civitaiDescription,
          baseModel: meta.baseModel,
        })
      : null;

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
    suggestedLoraCategory,
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
 * Builds an ExternalModelSearchResult card from resolved Civitai parent + version payloads.
 */
export function buildCivitaiSearchResultCard(params: {
  parentModel: any;
  targetVer: any;
  availableVersions: ExternalModelVersionOption[];
  activeVersion: ExternalModelVersionOption;
  fallbackDescription: string;
}): ExternalModelSearchResult {
  const { parentModel, targetVer, availableVersions, activeVersion, fallbackDescription } = params;
  const resolvedModelId = parentModel?.id || targetVer?.modelId;
  return {
    provider: 'civitai',
    id: String(resolvedModelId || targetVer.id),
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
    description: activeVersion.civitaiDescription?.slice(0, 220) || fallbackDescription,
    availableFiles: activeVersion.availableFiles,
    totalRepoFilesCount: activeVersion.availableFiles.length,
    availableVersions,
    earlyAccessEndsAt: activeVersion.earlyAccessEndsAt,
    isEarlyAccessActive: activeVersion.isEarlyAccessActive,
    availability: activeVersion.availability,
    earlyAccessConfig: activeVersion.earlyAccessConfig,
  };
}
