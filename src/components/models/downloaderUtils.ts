import { api } from '../../api/client.ts';
import type {
  CharacterDownloadAutomation,
  ComfyModelSubfolder,
  ExternalModelFileOption,
  ExternalModelSearchResult,
  LoraCategory,
  LoraMentionAutomation,
  ModelType,
} from '../../shared/types.ts';

export interface ActivePreviewDownloadEntry {
  jobId: number;
  cardKey: string;
  item: ExternalModelSearchResult;
  targetFilename: string;
  targetSubfolder: string;
  startedAt: number;
}

export interface ResolvedPreviewEntry {
  cardKey: string;
  item: ExternalModelSearchResult;
  activeEntry: ActivePreviewDownloadEntry | null;
  matchingJob: any;
  isDownloadingNow: boolean;
  isEligible: boolean;
}

export function getDownloaderCardKey(item: ExternalModelSearchResult): string {
  return item.provider === 'direct'
    ? `${item.provider}-${item.id}-${item.filename}`
    : `${item.provider}-${item.id}`;
}

export function getDefaultSubfolderForItem(item: ExternalModelSearchResult): ComfyModelSubfolder {
  if (item.suggestedSubfolder) return item.suggestedSubfolder;
  switch (item.modelType) {
    case 'lora':
      return 'loras';
    case 'checkpoint':
      return 'checkpoints';
    case 'diffusion':
      return 'diffusion_models';
    case 'clip':
      return 'text_encoders';
    case 'vae':
      return 'vae';
    case 'controlnet':
      return 'controlnet';
    case 'upscaler':
      return 'upscale_models';
    case 'embedding':
      return 'embeddings';
    default:
      return 'checkpoints';
  }
}

export function applySelectedVersion(
  item: ExternalModelSearchResult,
  selectedVersionId?: string
): ExternalModelSearchResult {
  const versions = item.availableVersions;
  if (!versions || versions.length === 0) return item;
  const match =
    (selectedVersionId && versions.find((v) => v.versionId === selectedVersionId)) ||
    versions.find((v) => v.versionId === item.versionId) ||
    versions[0];
  if (!match || match.versionId === item.versionId) return item;
  return {
    ...item,
    versionId: match.versionId,
    versionName: match.versionName,
    civitaiUrl: match.civitaiUrl ?? item.civitaiUrl,
    baseModel: match.baseModel ?? null,
    trainedWords: match.trainedWords ?? [],
    recommendedWeight: match.recommendedWeight ?? null,
    previewImageUrl: match.previewImageUrl ?? null,
    previewImages: match.previewImages ?? [],
    civitaiDescription: match.civitaiDescription ?? null,
    filename: match.filename,
    fileSize: match.fileSize,
    sha256Hash: match.sha256Hash,
    downloadUrl: match.downloadUrl,
    modelType: match.modelType,
    suggestedSubfolder: match.suggestedSubfolder,
    suggestedLoraCategory: match.suggestedLoraCategory ?? item.suggestedLoraCategory ?? null,
    subfolderHint: match.subfolderHint ?? null,
    availableFiles: match.availableFiles,
    totalRepoFilesCount: match.availableFiles.length,
    earlyAccessEndsAt: match.earlyAccessEndsAt ?? null,
    isEarlyAccessActive: Boolean(match.isEarlyAccessActive),
    availability: match.availability ?? null,
    earlyAccessConfig: match.earlyAccessConfig ?? null,
    isInstalled: Boolean(match.isInstalled),
    installedModelId: match.installedModelId ?? null,
    installedFilename: match.installedFilename ?? null,
    installedModelType: match.installedModelType ?? null,
    installedLoraCategory: match.installedLoraCategory ?? null,
    installedMatchReason: match.installedMatchReason ?? null,
  };
}

export function isItemBatchEligible(item: ExternalModelSearchResult): boolean {
  const primary = item.availableFiles?.[0];
  const hasDownloadUrl = Boolean(primary?.downloadUrl || item.downloadUrl);
  const isMultiFileHfRepo =
    item.provider === 'huggingface' && (item.totalRepoFilesCount || 0) > 1;
  return (
    hasDownloadUrl &&
    !isMultiFileHfRepo &&
    !item.isInstalled &&
    !item.isEarlyAccessActive
  );
}

export function normalizeMentionAutomation(
  mention: LoraMentionAutomation | null | undefined
): LoraMentionAutomation | null {
  if (!mention) return null;
  if (!mention.mentionEnabled && !mention.nickname.trim()) return null;
  return {
    mentionEnabled: mention.mentionEnabled,
    nickname: mention.nickname.trim().replace(/^@+/, '').toLowerCase(),
  };
}

export function buildStartDownloadPayload(params: {
  item: ExternalModelSearchResult;
  selectedFile?: ExternalModelFileOption | null;
  targetFilename: string;
  effectiveType: ModelType;
  subfolder: string;
  allowOverwrite: boolean;
  loraCategory: LoraCategory | null;
  characterAutomation: CharacterDownloadAutomation | null;
  mentionAutomation: LoraMentionAutomation | null;
  scheduledFor?: string | null;
}): Parameters<typeof api.startModelDownload>[0] {
  const { item, selectedFile } = params;
  return {
    provider: item.provider,
    modelName: item.name,
    filename: params.targetFilename,
    modelType: params.effectiveType,
    sourceUrl: selectedFile?.downloadUrl || item.downloadUrl,
    expectedHash: selectedFile ? selectedFile.sha256Hash : item.sha256Hash || null,
    subfolder: params.subfolder,
    allowOverwrite: params.allowOverwrite,
    userConfirmed: true,
    hfRepoId: item.hfRepoId || null,
    civitaiMeta:
      item.provider === 'civitai'
        ? {
            civitaiId: item.id,
            civitaiVersionId: item.versionId || null,
            civitaiUrl: item.civitaiUrl || null,
            baseModel: item.baseModel || null,
            trainedWords: item.trainedWords || [],
            recommendedWeight: item.recommendedWeight ?? null,
            civitaiDescription: item.civitaiDescription || null,
            previewImages: item.previewImages || [],
          }
        : null,
    loraCategory: params.loraCategory,
    characterAutomation: params.characterAutomation,
    mentionAutomation: normalizeMentionAutomation(params.mentionAutomation),
    scheduledFor: params.scheduledFor || null,
  };
}
