import React, { useEffect, useState } from 'react';
import {
  CheckCircle2,
  Clock,
  ExternalLink,
  FolderGit2,
  HardDriveDownload,
  Info,
  Layers,
  Loader2,
  Play,
  RotateCw,
  Search,
  X,
} from 'lucide-react';
import { api } from '../api/client.ts';
import { formatBytes } from '../shared/utils.ts';
import {
  DEFAULT_PILL_TYPE_SETTINGS,
  LORA_CATEGORY_OPTIONS,
  resolveLoraCategoryStyle,
} from '../shared/pillSettings.ts';
import { DownloadHistoryList } from './models/DownloadHistoryList.tsx';
import { DownloaderBatchBar } from './models/DownloaderBatchBar.tsx';
import {
  formatUnlockCountdown,
  formatUnlockLocalTime,
  getSuggestedScheduledIso,
  toLocalDateTimeInputValue,
} from './models/earlyAccessUtils.ts';
import {
  COMFY_SUBFOLDER_OPTIONS,
  ModelDownloadConfirmModal,
} from './ModelDownloadConfirmModal.tsx';
import {
  CharacterLoraDownloadOptions,
  deriveDefaultCharacterAutomation,
} from './models/CharacterLoraDownloadOptions.tsx';
import {
  DEFAULT_LORA_MENTION_AUTOMATION,
  LoraMentionDownloadOptions,
} from './models/LoraMentionDownloadOptions.tsx';
import type {
  CharacterDownloadAutomation,
  ComfyModelSubfolder,
  ExternalModelFileOption,
  ExternalModelSearchResult,
  LoraCategory,
  LoraMentionAutomation,
  ModelType,
  PillTypeSettings,
} from '../shared/types.ts';

export interface ActivePreviewDownloadEntry {
  jobId: number;
  cardKey: string;
  item: ExternalModelSearchResult;
  targetFilename: string;
  targetSubfolder: string;
  startedAt: number;
}

interface ModelDownloaderTabProps {
  extQuery: string;
  setExtQuery: (q: string) => void;
  extTypeFilter: string;
  setExtTypeFilter: (t: string) => void;
  searchResults: ExternalModelSearchResult[];
  setSearchResults: React.Dispatch<React.SetStateAction<ExternalModelSearchResult[]>>;
  searchBatchTimestamp: number;
  activePreviewDownloads: ActivePreviewDownloadEntry[];
  setActivePreviewDownloads: React.Dispatch<React.SetStateAction<ActivePreviewDownloadEntry[]>>;
  isSearchingExt: boolean;
  searchError: string | null;
  searchNotice?: string | null;
  onDismissSearchNotice?: () => void;
  downloads: any[];
  pillTypeSettings?: PillTypeSettings;
  onSearch: (e?: React.FormEvent, customQ?: string) => Promise<void>;
  onRefreshDownloads: () => Promise<void>;
  onInspectDownload?: (job: any) => void;
  onPushToast?: (text: string, type?: 'info' | 'success' | 'warning' | 'error') => void;
}

function getDefaultSubfolderForItem(item: ExternalModelSearchResult): ComfyModelSubfolder {
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

export function getDownloaderCardKey(item: ExternalModelSearchResult): string {
  return item.provider === 'direct'
    ? `${item.provider}-${item.id}-${item.filename}`
    : `${item.provider}-${item.id}`;
}

function applySelectedVersion(
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

/**
 * Unified smart Model Downloader searching Civitai and Hugging Face Hub,
 * rendering full-width preview cards stacked newest-first and clearing automatically on completion.
 */
export const ModelDownloaderTab: React.FC<ModelDownloaderTabProps> = ({
  extQuery,
  setExtQuery,
  extTypeFilter,
  setExtTypeFilter,
  searchResults,
  setSearchResults,
  searchBatchTimestamp,
  activePreviewDownloads,
  setActivePreviewDownloads,
  isSearchingExt,
  searchError,
  searchNotice,
  onDismissSearchNotice,
  downloads,
  pillTypeSettings = DEFAULT_PILL_TYPE_SETTINGS,
  onSearch,
  onRefreshDownloads,
  onInspectDownload,
  onPushToast,
}) => {
  const [pendingDownload, setPendingDownload] = useState<ExternalModelSearchResult | null>(null);
  const [selectedFile, setSelectedFile] = useState<ExternalModelFileOption | null>(null);
  const [isLoadingRepoFiles, setIsLoadingRepoFiles] = useState(false);
  const [dlSubfolder, setDlSubfolder] = useState<ComfyModelSubfolder>('loras');
  const [pendingLoraCategory, setPendingLoraCategory] = useState<LoraCategory>('unclassified');
  const [customFilename, setCustomFilename] = useState('');
  const [allowOverwrite, setAllowOverwrite] = useState(false);
  const [scheduleDownload, setScheduleDownload] = useState(false);
  const [scheduledForInput, setScheduledForInput] = useState('');
  const [dlError, setDlError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [directStartingKey, setDirectStartingKey] = useState<string | null>(null);
  const [savingCategoryKey, setSavingCategoryKey] = useState<string | null>(null);
  const [isBatchDownloading, setIsBatchDownloading] = useState(false);
  const [selectedBatchKeys, setSelectedBatchKeys] = useState<Set<string>>(() => new Set());
  const [brokenImages, setBrokenImages] = useState<Record<string, boolean>>({});
  const [selectedPreviewIdx, setSelectedPreviewIdx] = useState<Record<string, number>>({});
  const [selectedVersionByCard, setSelectedVersionByCard] = useState<Record<string, string>>({});
  const [selectedCategoryByCard, setSelectedCategoryByCard] = useState<
    Record<string, LoraCategory>
  >({});
  const [characterAutoByCard, setCharacterAutoByCard] = useState<
    Record<string, CharacterDownloadAutomation>
  >({});
  const [mentionAutoByCard, setMentionAutoByCard] = useState<
    Record<string, LoraMentionAutomation>
  >({});
  const [pendingCharacterAutomation, setPendingCharacterAutomation] =
    useState<CharacterDownloadAutomation>({
      addCharacter: true,
      generateHeadshot: true,
      characterName: '',
      triggerWord: '',
    });
  const [pendingMentionAutomation, setPendingMentionAutomation] =
    useState<LoraMentionAutomation>({ ...DEFAULT_LORA_MENTION_AUTOMATION });

  const isItemBatchEligible = (item: ExternalModelSearchResult): boolean => {
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
  };

  useEffect(() => {
    setSelectedVersionByCard({});
    setSelectedCategoryByCard({});
    setCharacterAutoByCard({});
    setMentionAutoByCard({});
    // Auto-select all downloadable, missing, non-Early-Access models for quick Download All
    const nextSelected = new Set<string>();
    for (const r of searchResults) {
      if (isItemBatchEligible(r)) {
        nextSelected.add(getDownloaderCardKey(r));
      }
    }
    setSelectedBatchKeys(nextSelected);
  }, [searchBatchTimestamp]);

  const getCategoryMapKey = (cardKey: string, versionId?: string | null) =>
    `${cardKey}-${versionId || 'default'}`;

  const getEffectiveCardCategory = (
    item: ExternalModelSearchResult,
    cardKey: string
  ): LoraCategory => {
    const mapKey = getCategoryMapKey(cardKey, item.versionId);
    if (selectedCategoryByCard[mapKey]) {
      return selectedCategoryByCard[mapKey];
    }
    if (item.isInstalled && item.installedLoraCategory && item.installedLoraCategory !== 'unclassified') {
      return item.installedLoraCategory;
    }
    return item.suggestedLoraCategory || 'unclassified';
  };

  const getEffectiveCharacterAutomation = (
    item: ExternalModelSearchResult,
    cardKey: string
  ): CharacterDownloadAutomation => {
    const mapKey = getCategoryMapKey(cardKey, item.versionId);
    return characterAutoByCard[mapKey] || deriveDefaultCharacterAutomation(item);
  };

  const getEffectiveMentionAutomation = (
    item: ExternalModelSearchResult,
    cardKey: string
  ): LoraMentionAutomation => {
    const mapKey = getCategoryMapKey(cardKey, item.versionId);
    return mentionAutoByCard[mapKey] || { ...DEFAULT_LORA_MENTION_AUTOMATION };
  };

  const handleInspectInstalledItem = (target: ExternalModelSearchResult) => {
    if (!onInspectDownload) return;
    const installedName = target.installedFilename || target.filename;
    onInspectDownload({
      installed_filename: installedName,
      installed_model_type: target.installedModelType || target.modelType,
      destination_path: installedName,
    });
  };

  const registerStartedDownload = (
    jobId: number,
    item: ExternalModelSearchResult,
    targetFilename: string,
    targetSubfolder: string,
    isScheduled = false
  ) => {
    const cardKey = getDownloaderCardKey(item);
    if (!isScheduled) {
      setActivePreviewDownloads((prev) => [
        {
          jobId,
          cardKey,
          item,
          targetFilename,
          targetSubfolder,
          startedAt: Date.now(),
        },
        ...prev.filter((p) => p.cardKey !== cardKey && p.jobId !== jobId),
      ]);
    }
    setSearchResults((prev) => {
      const remaining = prev.filter((r) => getDownloaderCardKey(r) !== cardKey);
      if (remaining.length === 0) {
        setExtQuery('');
      }
      return remaining;
    });
  };

  const openDownloadModal = async (
    item: ExternalModelSearchResult,
    preferSchedule?: boolean,
    initialError: string | null = null,
    preferOverwrite = false
  ) => {
    const initialFile = item.availableFiles?.[0] || null;
    const initialFolder = initialFile?.suggestedSubfolder || getDefaultSubfolderForItem(item);
    const shouldSchedule =
      preferSchedule !== undefined ? preferSchedule : Boolean(item.isEarlyAccessActive);
    const defaultIso = getSuggestedScheduledIso(item.earlyAccessEndsAt);
    const cardKey = getDownloaderCardKey(item);
    setPendingDownload(item);
    setSelectedFile(initialFile);
    setDlSubfolder(initialFolder);
    setPendingLoraCategory(getEffectiveCardCategory(item, cardKey));
    setPendingCharacterAutomation(getEffectiveCharacterAutomation(item, cardKey));
    setPendingMentionAutomation(getEffectiveMentionAutomation(item, cardKey));
    setCustomFilename(initialFile?.filename || item.filename);
    setAllowOverwrite(preferOverwrite);
    setScheduleDownload(shouldSchedule);
    setScheduledForInput(toLocalDateTimeInputValue(defaultIso));
    setDlError(initialError);

    // Fetch full recursive tree + LFS SHA-256 hashes for Hugging Face repos
    if (item.provider === 'huggingface' && item.id) {
      setIsLoadingRepoFiles(true);
      try {
        const repoTree = await api.listHuggingFaceRepoFiles(item.id);
        if (repoTree.files.length > 0) {
          const matched =
            repoTree.files.find((f) => f.filename === item.filename) || repoTree.files[0];
          setPendingDownload((prev) =>
            prev && prev.id === item.id
              ? {
                  ...prev,
                  availableFiles: repoTree.files,
                  totalRepoFilesCount: repoTree.files.length,
                }
              : prev
          );
          setSelectedFile(matched);
          setDlSubfolder(matched.suggestedSubfolder);
          setCustomFilename(matched.filename);
        }
      } catch {
        // Keep existing sibling list if tree endpoint fails
      } finally {
        setIsLoadingRepoFiles(false);
      }
    }
  };

  const handleSelectFile = (file: ExternalModelFileOption) => {
    setSelectedFile(file);
    setDlSubfolder(file.suggestedSubfolder);
    setCustomFilename(file.filename);
    setDlError(null);
  };

  const handleDirectLoraDownload = async (
    item: ExternalModelSearchResult,
    cardKey: string,
    scheduledForIso?: string | null
  ) => {
    setDirectStartingKey(cardKey);
    try {
      const primary = item.availableFiles?.[0];
      const targetFilename = primary?.filename || item.filename;
      const chosenCategory = getEffectiveCardCategory(item, cardKey);
      const mentionConfig = getEffectiveMentionAutomation(item, cardKey);
      const normalizedMention =
        mentionConfig.mentionEnabled || mentionConfig.nickname.trim()
          ? {
              mentionEnabled: mentionConfig.mentionEnabled,
              nickname: mentionConfig.nickname.trim().replace(/^@+/, '').toLowerCase(),
            }
          : null;
      const res = await api.startModelDownload({
        provider: item.provider,
        modelName: item.name,
        filename: targetFilename,
        modelType: 'lora',
        sourceUrl: primary?.downloadUrl || item.downloadUrl,
        expectedHash: primary?.sha256Hash || item.sha256Hash || null,
        subfolder: 'loras',
        allowOverwrite: false,
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
        loraCategory: chosenCategory,
        characterAutomation:
          chosenCategory === 'character' && !item.isInstalled
            ? getEffectiveCharacterAutomation(item, cardKey)
            : null,
        mentionAutomation: normalizedMention,
        scheduledFor: scheduledForIso || null,
      });
      if (res?.job?.id) {
        registerStartedDownload(
          Number(res.job.id),
          item,
          targetFilename,
          'loras',
          res.job.status === 'scheduled'
        );
      }
      await onRefreshDownloads();
      if (res?.job?.status === 'scheduled') {
        onPushToast?.(
          `Scheduled ${targetFilename} for ${formatUnlockLocalTime(res.job.scheduled_for)}`,
          'success'
        );
      } else {
        onPushToast?.(`Started downloading ${targetFilename} to /downloads/loras`, 'info');
      }
    } catch (err: any) {
      const msg = err?.message || 'Download could not start';
      // Only open the confirmation modal when overwrite permission is needed
      if (/already exists/i.test(msg)) {
        await openDownloadModal(item, Boolean(scheduledForIso), msg, true);
      } else {
        onPushToast?.(msg, 'error');
      }
    } finally {
      setDirectStartingKey(null);
    }
  };

  const handleConfirmDownload = async () => {
    if (!pendingDownload) return;
    setDlError(null);
    setIsSubmitting(true);
    try {
      const folderMeta = COMFY_SUBFOLDER_OPTIONS.find((o) => o.value === dlSubfolder);
      const effectiveType: ModelType =
        folderMeta?.modelType || selectedFile?.modelType || pendingDownload.modelType;
      const targetFilename =
        customFilename.trim() || selectedFile?.filename || pendingDownload.filename;

      let scheduledForIso: string | null = null;
      if (scheduleDownload && scheduledForInput) {
        const parsedMs = new Date(scheduledForInput).getTime();
        if (!Number.isFinite(parsedMs) || parsedMs <= Date.now() + 5000) {
          throw new Error('Please choose a future date/time for scheduled downloads.');
        }
        scheduledForIso = new Date(parsedMs).toISOString();
      }

      const res = await api.startModelDownload({
        provider: pendingDownload.provider,
        modelName: pendingDownload.name,
        filename: targetFilename,
        modelType: effectiveType,
        sourceUrl: selectedFile?.downloadUrl || pendingDownload.downloadUrl,
        expectedHash: selectedFile ? selectedFile.sha256Hash : pendingDownload.sha256Hash || null,
        subfolder: dlSubfolder,
        allowOverwrite,
        userConfirmed: true,
        hfRepoId: pendingDownload.hfRepoId || null,
        civitaiMeta:
          pendingDownload.provider === 'civitai'
            ? {
                civitaiId: pendingDownload.id,
                civitaiVersionId: pendingDownload.versionId || null,
                civitaiUrl: pendingDownload.civitaiUrl || null,
                baseModel: pendingDownload.baseModel || null,
                trainedWords: pendingDownload.trainedWords || [],
                recommendedWeight: pendingDownload.recommendedWeight ?? null,
                civitaiDescription: pendingDownload.civitaiDescription || null,
                previewImages: pendingDownload.previewImages || [],
              }
            : null,
        loraCategory: effectiveType === 'lora' ? pendingLoraCategory : null,
        characterAutomation:
          effectiveType === 'lora' &&
          pendingLoraCategory === 'character' &&
          !pendingDownload.isInstalled
            ? pendingCharacterAutomation
            : null,
        mentionAutomation:
          effectiveType === 'lora' &&
          (pendingMentionAutomation.mentionEnabled || pendingMentionAutomation.nickname.trim())
            ? {
                mentionEnabled: pendingMentionAutomation.mentionEnabled,
                nickname: pendingMentionAutomation.nickname.trim().replace(/^@+/, '').toLowerCase(),
              }
            : null,
        scheduledFor: scheduledForIso,
      });
      if (res?.job?.id) {
        registerStartedDownload(
          Number(res.job.id),
          pendingDownload,
          targetFilename,
          dlSubfolder,
          res.job.status === 'scheduled'
        );
      }
      if (res?.job?.status === 'scheduled') {
        onPushToast?.(
          `Scheduled ${targetFilename} for ${formatUnlockLocalTime(res.job.scheduled_for)}`,
          'success'
        );
      }
      setPendingDownload(null);
      setSelectedFile(null);
      await onRefreshDownloads();
    } catch (err: any) {
      setDlError(err.message || 'Download could not start');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDismissSearchCard = (cardKey: string) => {
    setSearchResults((prev) => prev.filter((r) => getDownloaderCardKey(r) !== cardKey));
    setSelectedBatchKeys((prev) => {
      if (!prev.has(cardKey)) return prev;
      const next = new Set(prev);
      next.delete(cardKey);
      return next;
    });
  };

  const toggleBatchKey = (cardKey: string) => {
    setSelectedBatchKeys((prev) => {
      const next = new Set(prev);
      if (next.has(cardKey)) next.delete(cardKey);
      else next.add(cardKey);
      return next;
    });
  };

  const handleBatchDownloadAll = async (
    entries: Array<{ cardKey: string; item: ExternalModelSearchResult }>
  ) => {
    if (entries.length === 0 || isBatchDownloading) return;
    setIsBatchDownloading(true);
    let startedCount = 0;
    const errors: string[] = [];

    try {
      for (const { cardKey, item } of entries) {
        const primary = item.availableFiles?.[0];
        const targetFilename = primary?.filename || item.filename;
        const targetFolder = primary?.suggestedSubfolder || getDefaultSubfolderForItem(item);
        const effectiveType = (primary?.modelType || item.modelType) as ModelType;
        const isLora = effectiveType === 'lora' || targetFolder === 'loras';
        const chosenCategory = isLora ? getEffectiveCardCategory(item, cardKey) : null;
        const mentionConfig = isLora ? getEffectiveMentionAutomation(item, cardKey) : null;
        const normalizedMention =
          mentionConfig && (mentionConfig.mentionEnabled || mentionConfig.nickname.trim())
            ? {
                mentionEnabled: mentionConfig.mentionEnabled,
                nickname: mentionConfig.nickname.trim().replace(/^@+/, '').toLowerCase(),
              }
            : null;

        try {
          const res = await api.startModelDownload({
            provider: item.provider,
            modelName: item.name,
            filename: targetFilename,
            modelType: effectiveType,
            sourceUrl: primary?.downloadUrl || item.downloadUrl,
            expectedHash: primary?.sha256Hash || item.sha256Hash || null,
            subfolder: targetFolder,
            allowOverwrite: false,
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
            loraCategory: chosenCategory,
            characterAutomation:
              isLora && chosenCategory === 'character' && !item.isInstalled
                ? getEffectiveCharacterAutomation(item, cardKey)
                : null,
            mentionAutomation: normalizedMention,
            scheduledFor: null,
          });
          if (res?.job?.id) {
            registerStartedDownload(
              Number(res.job.id),
              item,
              targetFilename,
              targetFolder,
              res.job.status === 'scheduled'
            );
            startedCount += 1;
          }
        } catch (err: any) {
          errors.push(`${item.name}: ${err?.message || 'Download could not start'}`);
        }
      }

      await onRefreshDownloads();
      if (startedCount > 0 && errors.length === 0) {
        onPushToast?.(
          `Queued ${startedCount} download${startedCount === 1 ? '' : 's'}`,
          'success'
        );
      } else if (startedCount > 0 && errors.length > 0) {
        onPushToast?.(
          `Queued ${startedCount} download(s); ${errors.length} failed (${errors[0]})`,
          'warning'
        );
      } else if (errors.length > 0) {
        onPushToast?.(errors[0], 'error');
      }
    } finally {
      setIsBatchDownloading(false);
    }
  };

  const handleSaveInstalledCategory = async (
    item: ExternalModelSearchResult,
    cardKey: string,
    nextCategory: LoraCategory
  ) => {
    const installedName = item.installedFilename || item.filename;
    if (!installedName) return;
    setSavingCategoryKey(cardKey);
    try {
      await api.classifyLora(installedName, nextCategory);
      setSearchResults((prev) =>
        prev.map((r) => {
          if (getDownloaderCardKey(r) !== cardKey) return r;
          const updatedVersions = r.availableVersions?.map((v) =>
            v.versionId === item.versionId
              ? { ...v, installedLoraCategory: nextCategory }
              : v
          );
          return {
            ...r,
            ...(r.versionId === item.versionId ? { installedLoraCategory: nextCategory } : {}),
            ...(updatedVersions ? { availableVersions: updatedVersions } : {}),
          };
        })
      );
      onPushToast?.(`Saved category "${nextCategory}" for ${installedName}`, 'success');
    } catch (err: any) {
      onPushToast?.(err?.message || 'Failed to update LoRA category', 'error');
    } finally {
      setSavingCategoryKey(null);
    }
  };

  // Build unified full-width preview stack ordered newest first:
  // - Active downloads use their `startedAt` timestamp
  // - Staged search results use `searchBatchTimestamp` (preserving relative rank)
  const activeKeySet = new Set(activePreviewDownloads.map((a) => a.cardKey));
  const combinedPreviews: Array<{
    cardKey: string;
    item: ExternalModelSearchResult;
    activeEntry: ActivePreviewDownloadEntry | null;
    sortTime: number;
  }> = [
    ...activePreviewDownloads.map((entry) => ({
      cardKey: entry.cardKey,
      item: entry.item,
      activeEntry: entry,
      sortTime: entry.startedAt,
    })),
    ...searchResults
      .map((item, idx) => ({
        cardKey: getDownloaderCardKey(item),
        item,
        activeEntry: null,
        // Subtract idx so multi-result searches preserve their rank while comparing against startedAt
        sortTime: (searchBatchTimestamp || 1) - idx * 0.001,
      }))
      .filter((entry) => !activeKeySet.has(entry.cardKey)),
  ].sort((a, b) => b.sortTime - a.sortTime);

  // Evaluate active-versioned items once so batch bar stats stay accurate if user switches versions
  const resolvedPreviews = combinedPreviews.map(({ cardKey, item: rawItem, activeEntry }) => {
    const item = activeEntry
      ? rawItem
      : applySelectedVersion(rawItem, selectedVersionByCard[cardKey]);
    const displayFilename = activeEntry?.targetFilename || item.filename;
    const matchingJob = activeEntry
      ? downloads.find((d) => Number(d.id) === activeEntry.jobId)
      : downloads.find(
          (d) =>
            d.status === 'downloading' &&
            typeof d.destination_path === 'string' &&
            d.destination_path.toLowerCase().endsWith(`/${displayFilename.toLowerCase()}`)
        );
    const isDownloadingNow =
      Boolean(activeEntry) ||
      directStartingKey === cardKey ||
      matchingJob?.status === 'downloading';
    const isEligible = !isDownloadingNow && isItemBatchEligible(item);
    return { cardKey, item, activeEntry, matchingJob, isDownloadingNow, isEligible };
  });

  const eligibleEntries = resolvedPreviews
    .filter((entry) => entry.isEligible)
    .map((entry) => ({ cardKey: entry.cardKey, item: entry.item }));
  const selectedBatchEntries = eligibleEntries.filter((e) => selectedBatchKeys.has(e.cardKey));
  const selectedTotalBytes = selectedBatchEntries.reduce(
    (sum, e) => sum + (e.item.availableFiles?.[0]?.fileSize || e.item.fileSize || 0),
    0
  );
  const installedBatchCount = resolvedPreviews.filter((e) => e.item.isInstalled).length;
  const earlyAccessBatchCount = resolvedPreviews.filter(
    (e) => e.item.isEarlyAccessActive && !e.item.isInstalled
  ).length;
  const showBatchBar = combinedPreviews.length > 1 || Boolean(searchNotice);

  return (
    <div className="space-y-6">
      {/* Single Unified Smart Search Bar */}
      <form
        onSubmit={(e) => onSearch(e)}
        className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 flex flex-wrap items-center gap-3 text-xs"
      >
        <div className="relative flex-1 min-w-[260px]">
          <Search className="w-4 h-4 text-zinc-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={extQuery}
            onChange={(e) => setExtQuery(e.target.value)}
            placeholder="Search Civitai & Hugging Face, or paste a Civitai image/model URL, hash, or owner/repo..."
            className="w-full pl-9 pr-3 py-2 bg-zinc-950 border border-zinc-800 rounded-lg text-zinc-100"
          />
        </div>

        <select
          value={extTypeFilter}
          onChange={(e) => setExtTypeFilter(e.target.value)}
          className="px-3 py-2 bg-zinc-950 border border-zinc-800 rounded-lg text-zinc-200"
        >
          <option value="">All Model Types</option>
          <option value="lora">LoRA / LoCon / DoRA</option>
          <option value="checkpoint">Checkpoint / UNET Base</option>
          <option value="clip">Text Encoder / CLIP / T5</option>
          <option value="controlnet">ControlNet</option>
          <option value="vae">VAE</option>
          <option value="upscaler">Upscaler</option>
          <option value="embedding">Embedding / Textual Inversion</option>
        </select>

        <button
          type="submit"
          disabled={isSearchingExt}
          className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white font-medium rounded-lg cursor-pointer whitespace-nowrap shrink-0"
        >
          {isSearchingExt ? 'Searching...' : 'Search Models'}
        </button>
      </form>

      {searchError && (
        <div className="p-3 bg-rose-500/15 border border-rose-500/40 rounded-lg text-xs text-rose-300">
          {searchError}
        </div>
      )}

      {searchNotice && (
        <div className="p-3 bg-amber-500/10 border border-amber-500/35 rounded-lg text-xs text-amber-200 flex items-start justify-between gap-3">
          <div className="flex items-start gap-2">
            <Info className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
            <span>{searchNotice}</span>
          </div>
          {onDismissSearchNotice && (
            <button
              type="button"
              onClick={onDismissSearchNotice}
              aria-label="Dismiss notice"
              className="p-0.5 text-amber-300/80 hover:text-amber-100 cursor-pointer shrink-0"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      )}

      {showBatchBar && (
        <DownloaderBatchBar
          totalEligibleCount={eligibleEntries.length}
          selectedCount={selectedBatchEntries.length}
          selectedTotalBytes={selectedTotalBytes}
          installedCount={installedBatchCount}
          earlyAccessCount={earlyAccessBatchCount}
          isBatchDownloading={isBatchDownloading}
          onSelectAll={() =>
            setSelectedBatchKeys(new Set(eligibleEntries.map((e) => e.cardKey)))
          }
          onClearSelection={() => setSelectedBatchKeys(new Set())}
          onDownloadAll={() => handleBatchDownloadAll(selectedBatchEntries)}
        />
      )}

      {/* Full-Width Preview Stack (Newest First; Active Downloads Clear Automatically on Completion) */}
      {resolvedPreviews.length > 0 && (
        <div className="space-y-4">
          {resolvedPreviews.map(
            ({ cardKey, item, activeEntry, matchingJob, isDownloadingNow, isEligible }) => {
            const previews =
              item.previewImages && item.previewImages.length > 0
                ? item.previewImages
                : item.previewImageUrl
                ? [{ url: item.previewImageUrl }]
                : [];
            const activeThumbIdx = selectedPreviewIdx[cardKey] || 0;
            const currentThumbUrl =
              previews[activeThumbIdx]?.url || previews[0]?.url || item.previewImageUrl || null;
            const thumbKey = `${cardKey}-${item.versionId || 'default'}-${activeThumbIdx}`;
            const hasThumb = Boolean(currentThumbUrl && !brokenImages[thumbKey]);

            const fileCount = item.totalRepoFilesCount || item.availableFiles?.length || 1;
            const targetFolder = activeEntry?.targetSubfolder || getDefaultSubfolderForItem(item);
            const displayFilename = activeEntry?.targetFilename || item.filename;
            const isCivitaiRed = Boolean(item.civitaiUrl?.includes('civitai.red'));
            const providerLabel =
              item.provider === 'civitai'
                ? isCivitaiRed
                  ? 'Civitai.red'
                  : 'Civitai'
                : item.provider === 'huggingface'
                ? 'Hugging Face'
                : 'Direct URL';

            const dlPct =
              matchingJob && matchingJob.total_bytes > 0
                ? Math.min(
                    100,
                    Math.round((matchingJob.bytes_downloaded / matchingJob.total_bytes) * 100)
                  )
                : null;

            return (
              <div
                key={activeEntry ? `dl-${activeEntry.jobId}` : cardKey}
                className={`w-full bg-zinc-900 border rounded-xl overflow-hidden flex flex-col md:flex-row text-xs transition-colors ${
                  isDownloadingNow ? 'border-indigo-500/60' : 'border-zinc-800'
                }`}
              >
                {/* Left Column: Preview Image & Optional Multi-Thumbnail Strip */}
                <div className="relative w-full md:w-80 lg:w-96 shrink-0 bg-zinc-950 border-b md:border-b-0 md:border-r border-zinc-800 flex flex-col justify-between">
                  <div className="relative h-56 md:h-64 w-full overflow-hidden flex items-center justify-center bg-zinc-950">
                    {hasThumb ? (
                      <img
                        src={currentThumbUrl!}
                        alt={item.name}
                        className="w-full h-full object-contain bg-zinc-950"
                        loading="lazy"
                        onError={() =>
                          setBrokenImages((prev) => ({
                            ...prev,
                            [thumbKey]: true,
                          }))
                        }
                      />
                    ) : (
                      <div className="w-full h-full flex flex-col items-center justify-center gap-1.5 text-zinc-600 bg-gradient-to-br from-zinc-950 to-zinc-900">
                        <Layers className="w-6 h-6" />
                        <span className="text-[11px] font-mono">
                          {item.provider === 'huggingface'
                            ? `${fileCount} weight file${fileCount === 1 ? '' : 's'} in repo`
                            : 'No preview image'}
                        </span>
                      </div>
                    )}

                    <div className="absolute top-2.5 left-2.5 flex flex-wrap items-center gap-1.5">
                      <span className="px-2 py-0.5 rounded bg-zinc-950/90 border border-zinc-700/80 font-mono text-[10px] text-zinc-200">
                        {providerLabel}
                      </span>
                      <span className="px-2 py-0.5 rounded bg-zinc-950/90 border border-zinc-700/80 font-mono text-[10px] text-emerald-300">
                        /{targetFolder}
                      </span>
                      {fileCount > 1 && (
                        <span className="px-2 py-0.5 rounded bg-zinc-950/90 border border-zinc-700/80 font-mono text-[10px] text-zinc-300">
                          {fileCount} files
                        </span>
                      )}
                    </div>
                  </div>

                  {previews.length > 1 && (
                    <div className="px-2.5 py-2 bg-zinc-950/95 border-t border-zinc-800/80 flex items-center gap-1.5 overflow-x-auto">
                      {previews.slice(0, 4).map((p, idx) => (
                        <button
                          key={`${cardKey}-thumb-${idx}`}
                          type="button"
                          onClick={() =>
                            setSelectedPreviewIdx((prev) => ({ ...prev, [cardKey]: idx }))
                          }
                          className={`w-12 h-9 rounded overflow-hidden border shrink-0 cursor-pointer transition-colors ${
                            activeThumbIdx === idx
                              ? 'border-indigo-500 ring-1 ring-indigo-500/50'
                              : 'border-zinc-800 opacity-70 hover:opacity-100'
                          }`}
                        >
                          <img
                            src={p.url}
                            alt=""
                            className="w-full h-full object-cover"
                            loading="lazy"
                          />
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                {/* Right Column: Full-Width Model Details & Download Action / Progress */}
                <div className="flex-1 p-5 flex flex-col justify-between gap-4 min-w-0">
                  <div className="space-y-3">
                    {/* Header Row: Title, Base Model, Civitai Link & Dismiss */}
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="space-y-1 min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <h4 className="text-base font-display font-semibold text-zinc-100 leading-snug break-words">
                            {item.name}
                          </h4>
                          {item.baseModel && (
                            <span className="px-2 py-0.5 text-[11px] font-mono bg-zinc-950 border border-zinc-700 text-indigo-300 rounded shrink-0">
                              {item.baseModel}
                            </span>
                          )}
                          {!activeEntry &&
                          item.availableVersions &&
                          item.availableVersions.length > 1 ? (
                            <select
                              value={item.versionId || ''}
                              onChange={(e) => {
                                const nextVerId = e.target.value;
                                setSelectedVersionByCard((prev) => ({
                                  ...prev,
                                  [cardKey]: nextVerId,
                                }));
                                setSelectedPreviewIdx((prev) => ({ ...prev, [cardKey]: 0 }));
                              }}
                              aria-label={`Select version for ${item.name}`}
                              className="px-2 py-0.5 text-[11px] font-mono bg-zinc-950 border border-zinc-700 hover:border-indigo-500/60 text-zinc-200 rounded shrink-0 cursor-pointer focus:outline-none focus:border-indigo-500 max-w-[260px]"
                            >
                              {item.availableVersions.map((ver) => (
                                <option key={ver.versionId} value={ver.versionId}>
                                  {ver.versionName}
                                  {ver.baseModel ? ` · ${ver.baseModel}` : ''}
                                  {ver.isInstalled
                                    ? ' ✓ Installed'
                                    : ver.isEarlyAccessActive
                                    ? ' ⏳ Early Access'
                                    : ''}
                                </option>
                              ))}
                            </select>
                          ) : (
                            item.versionName && (
                              <span className="px-2 py-0.5 text-[11px] font-mono bg-zinc-950 border border-zinc-800 text-zinc-400 rounded shrink-0">
                                {item.versionName}
                              </span>
                            )
                          )}
                          {item.isInstalled && (
                            <button
                              type="button"
                              onClick={() => handleInspectInstalledItem(item)}
                              title={`Already installed locally (${
                                item.installedMatchReason === 'hash'
                                  ? 'matched by SHA-256'
                                  : item.installedMatchReason === 'version_id'
                                  ? 'matched by Civitai version ID'
                                  : 'matched by filename'
                              }): ${item.installedFilename || item.filename}. Click to inspect.`}
                              className="inline-flex items-center gap-1 px-2 py-0.5 text-[11px] font-mono bg-emerald-500/15 hover:bg-emerald-500/25 border border-emerald-500/40 text-emerald-300 rounded shrink-0 cursor-pointer transition-colors"
                            >
                              <CheckCircle2 className="w-3 h-3" />
                              <span>Installed</span>
                            </button>
                          )}
                          {item.isEarlyAccessActive && (
                            <span
                              title={
                                item.earlyAccessEndsAt
                                  ? `Unlocks at ${formatUnlockLocalTime(item.earlyAccessEndsAt)}`
                                  : 'Civitai Early Access active'
                              }
                              className="inline-flex items-center gap-1 px-2 py-0.5 text-[11px] font-mono bg-amber-500/15 border border-amber-500/40 text-amber-300 rounded shrink-0"
                            >
                              <Clock className="w-3 h-3" />
                              <span>
                                Early Access
                                {item.earlyAccessEndsAt
                                  ? ` · Unlocks ${formatUnlockLocalTime(item.earlyAccessEndsAt)} (${formatUnlockCountdown(item.earlyAccessEndsAt)})`
                                  : ''}
                              </span>
                            </span>
                          )}
                        </div>
                        {item.creator && (
                          <div className="text-[11px] text-zinc-500">by {item.creator}</div>
                        )}
                      </div>

                      <div className="flex items-center gap-2 shrink-0">
                        {isEligible && (
                          <label
                            title="Include in Download All batch"
                            className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md bg-zinc-950 hover:bg-zinc-800 border border-zinc-700/80 text-xs text-zinc-200 cursor-pointer select-none"
                          >
                            <input
                              type="checkbox"
                              checked={selectedBatchKeys.has(cardKey)}
                              disabled={isBatchDownloading}
                              onChange={() => toggleBatchKey(cardKey)}
                              className="rounded border-zinc-600 bg-zinc-900 text-indigo-500 focus:ring-indigo-500 cursor-pointer"
                            />
                            <span>Batch</span>
                          </label>
                        )}
                        {item.civitaiUrl && (
                          <a
                            href={item.civitaiUrl}
                            target="_blank"
                            rel="noreferrer"
                            title={
                              isCivitaiRed
                                ? 'Open original Civitai.red page'
                                : 'Open original Civitai.com page'
                            }
                            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-zinc-950 hover:bg-zinc-800 border border-zinc-700/80 text-xs text-zinc-200 hover:text-white transition-colors"
                          >
                            <ExternalLink className="w-3.5 h-3.5 text-indigo-400" />
                            <span>{isCivitaiRed ? 'Civitai.red' : 'Civitai'}</span>
                          </a>
                        )}
                        {!isDownloadingNow && (
                          <button
                            type="button"
                            onClick={() => handleDismissSearchCard(cardKey)}
                            title="Dismiss preview"
                            className="p-1 rounded-md bg-zinc-950 hover:bg-zinc-800 border border-zinc-800 text-zinc-400 hover:text-zinc-200 cursor-pointer"
                          >
                            <X className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    </div>

                    {/* Technical Specs Row */}
                    <div className="text-xs font-mono text-zinc-300 flex flex-wrap items-center gap-x-3 gap-y-1 bg-zinc-950/70 border border-zinc-800/80 rounded-lg px-3 py-2">
                      <span className="uppercase font-semibold text-indigo-300">
                        {item.modelType}
                      </span>
                      <span className="text-zinc-600">·</span>
                      <span className="text-zinc-200 break-all" title={displayFilename}>
                        {displayFilename}
                      </span>
                      <span className="text-zinc-600">·</span>
                      <span className="text-zinc-300 tabular-nums">
                        {formatBytes(item.fileSize)}
                      </span>
                      {item.recommendedWeight !== null &&
                        item.recommendedWeight !== undefined && (
                          <>
                            <span className="text-zinc-600">·</span>
                            <span className="text-indigo-300">
                              Rec. Weight: {item.recommendedWeight.toFixed(2)}x
                            </span>
                          </>
                        )}
                      {item.sha256Hash && (
                        <>
                          <span className="text-zinc-600">·</span>
                          <span className="text-emerald-400">
                            SHA256: {item.sha256Hash.slice(0, 12)}…
                          </span>
                        </>
                      )}
                    </div>

                    {/* LoRA Category Selector (Auto-detected before download, adjustable via pulldown) */}
                    {(item.modelType === 'lora' || targetFolder === 'loras') &&
                      (() => {
                        const catMapKey = getCategoryMapKey(cardKey, item.versionId);
                        const activeCategory = getEffectiveCardCategory(item, cardKey);
                        const hasManualPick = Boolean(selectedCategoryByCard[catMapKey]);
                        const catStyle = resolveLoraCategoryStyle(activeCategory, pillTypeSettings);
                        const isAutoAssigned =
                          !hasManualPick &&
                          !item.isInstalled &&
                          Boolean(item.suggestedLoraCategory) &&
                          item.suggestedLoraCategory !== 'unclassified';
                        const hasUnsavedInstalledChange =
                          Boolean(item.isInstalled && item.installedFilename) &&
                          activeCategory !== (item.installedLoraCategory || 'unclassified');

                        const charAuto = getEffectiveCharacterAutomation(item, cardKey);
                        const mentionAuto = getEffectiveMentionAutomation(item, cardKey);
                        const showCharAutomation =
                          !item.isInstalled && activeCategory === 'character';

                        return (
                          <div className="space-y-2">
                            <div className="flex flex-wrap items-center justify-between gap-2 bg-zinc-950/60 border border-zinc-800/80 rounded-lg px-3 py-2">
                              <div className="flex flex-wrap items-center gap-2">
                                <span
                                  className={`w-2 h-2 rounded-full shrink-0 ${catStyle.swatchBg}`}
                                />
                                <span className="text-zinc-400">LoRA Category:</span>
                                <select
                                  value={activeCategory}
                                  disabled={isDownloadingNow}
                                  onChange={(e) => {
                                    const nextCat = e.target.value as LoraCategory;
                                    setSelectedCategoryByCard((prev) => ({
                                      ...prev,
                                      [catMapKey]: nextCat,
                                    }));
                                  }}
                                  aria-label={`LoRA Category for ${item.name}`}
                                  className="px-2.5 py-1 bg-zinc-900 border border-zinc-700 hover:border-indigo-500/60 disabled:opacity-60 rounded-md text-zinc-100 cursor-pointer focus:outline-none focus:border-indigo-500"
                                >
                                  {LORA_CATEGORY_OPTIONS.map((opt) => (
                                    <option key={opt.value} value={opt.value}>
                                      {opt.label}
                                    </option>
                                  ))}
                                </select>
                                {isAutoAssigned && (
                                  <span
                                    className={`px-1.5 py-0.5 rounded border text-[10px] font-mono ${catStyle.badge}`}
                                  >
                                    Auto-detected
                                  </span>
                                )}
                              </div>

                              {hasUnsavedInstalledChange && (
                                <button
                                  type="button"
                                  disabled={savingCategoryKey === cardKey}
                                  onClick={() =>
                                    handleSaveInstalledCategory(item, cardKey, activeCategory)
                                  }
                                  className="px-2.5 py-1 rounded-md bg-emerald-600/20 hover:bg-emerald-600/35 border border-emerald-500/40 text-emerald-200 text-[11px] font-medium cursor-pointer disabled:opacity-50"
                                >
                                  {savingCategoryKey === cardKey ? 'Saving...' : 'Save to Installed'}
                                </button>
                              )}
                            </div>

                            {!item.isInstalled && (
                              <LoraMentionDownloadOptions
                                value={mentionAuto}
                                disabled={isDownloadingNow}
                                onChange={(nextMention) =>
                                  setMentionAutoByCard((prev) => ({
                                    ...prev,
                                    [catMapKey]: nextMention,
                                  }))
                                }
                              />
                            )}

                            {showCharAutomation && (
                              <CharacterLoraDownloadOptions
                                value={charAuto}
                                disabled={isDownloadingNow}
                                onChange={(nextAuto) =>
                                  setCharacterAutoByCard((prev) => ({
                                    ...prev,
                                    [catMapKey]: nextAuto,
                                  }))
                                }
                              />
                            )}
                          </div>
                        );
                      })()}

                    {/* Trigger Words */}
                    {item.trainedWords && item.trainedWords.length > 0 && (
                      <div className="text-xs bg-zinc-950/50 border border-zinc-800/60 rounded-lg px-3 py-2">
                        <span className="text-zinc-500">Triggers: </span>
                        <span className="font-mono text-amber-300 break-words">
                          {item.trainedWords.join(', ')}
                        </span>
                      </div>
                    )}

                    {/* Description */}
                    {item.description && (
                      <p className="text-xs text-zinc-400 line-clamp-3 leading-relaxed">
                        {item.description}
                      </p>
                    )}
                  </div>

                  {/* Action Button or Active Download Progress Bar */}
                  <div className="pt-1">
                    {isDownloadingNow ? (
                      <div className="space-y-2 bg-zinc-950 border border-indigo-500/40 rounded-lg p-3">
                        <div className="flex items-center justify-between text-xs">
                          <span className="inline-flex items-center gap-2 font-medium text-indigo-300">
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            <span>
                              Downloading to /downloads/{targetFolder}/{displayFilename}
                            </span>
                          </span>
                          <span className="font-mono tabular-nums text-zinc-200">
                            {matchingJob ? (
                              <>
                                {formatBytes(matchingJob.bytes_downloaded || 0)}
                                {matchingJob.total_bytes > 0
                                  ? ` / ${formatBytes(matchingJob.total_bytes)} (${dlPct ?? 0}%)`
                                  : ''}
                              </>
                            ) : (
                              'Starting...'
                            )}
                          </span>
                        </div>
                        <div className="w-full h-2 bg-zinc-900 rounded-full overflow-hidden border border-zinc-800">
                          <div
                            className="h-full bg-indigo-500 transition-all duration-300"
                            style={{ width: `${dlPct !== null ? Math.max(4, dlPct) : 15}%` }}
                          />
                        </div>
                      </div>
                    ) : (
                      (() => {
                        const isDirectLora =
                          item.modelType === 'lora' &&
                          (item.provider === 'civitai' || fileCount <= 1);

                        if (item.isEarlyAccessActive) {
                          const suggestedIso = getSuggestedScheduledIso(item.earlyAccessEndsAt);
                          const unlockSummary = item.earlyAccessEndsAt
                            ? `Unlocks ${formatUnlockLocalTime(item.earlyAccessEndsAt)} (${formatUnlockCountdown(item.earlyAccessEndsAt)})`
                            : 'Check in 1h';

                          return (
                            <div className="flex flex-wrap items-center gap-2">
                              <button
                                type="button"
                                disabled={directStartingKey === cardKey}
                                onClick={() =>
                                  isDirectLora
                                    ? handleDirectLoraDownload(item, cardKey, suggestedIso)
                                    : openDownloadModal(item, true)
                                }
                                className="flex-1 min-w-[200px] inline-flex items-center justify-center gap-2 py-2.5 px-4 bg-amber-600 hover:bg-amber-500 disabled:opacity-50 text-white font-medium rounded-lg transition-colors cursor-pointer"
                              >
                                <Clock className="w-4 h-4" />
                                <span>
                                  {isDirectLora
                                    ? `Schedule LoRA (${unlockSummary})`
                                    : `Schedule After Early Access (${unlockSummary})`}
                                </span>
                              </button>
                              <button
                                type="button"
                                disabled={directStartingKey === cardKey}
                                onClick={() =>
                                  isDirectLora
                                    ? handleDirectLoraDownload(item, cardKey, null)
                                    : openDownloadModal(item, false)
                                }
                                title="Try downloading now (if already unlocked with Buzz)"
                                className="inline-flex items-center justify-center gap-1.5 py-2.5 px-4 bg-zinc-800 hover:bg-zinc-700 disabled:opacity-50 border border-zinc-700 text-zinc-200 font-medium rounded-lg transition-colors cursor-pointer shrink-0"
                              >
                                <Play className="w-3.5 h-3.5 text-indigo-400" />
                                <span>Try Now</span>
                              </button>
                            </div>
                          );
                        }

                        if (item.isInstalled) {
                          return (
                            <div className="flex flex-wrap items-center gap-2">
                              {onInspectDownload && (
                                <button
                                  type="button"
                                  onClick={() => handleInspectInstalledItem(item)}
                                  className="flex-1 min-w-[180px] inline-flex items-center justify-center gap-2 py-2.5 px-4 bg-emerald-600/20 hover:bg-emerald-600/30 border border-emerald-500/40 text-emerald-200 font-medium rounded-lg transition-colors cursor-pointer"
                                >
                                  <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                                  <span>
                                    Inspect Installed
                                    {item.installedFilename &&
                                    item.installedFilename.toLowerCase() !==
                                      item.filename.toLowerCase()
                                      ? ` (${item.installedFilename})`
                                      : ''}
                                  </span>
                                </button>
                              )}
                              <button
                                type="button"
                                onClick={() => openDownloadModal(item, false, null, true)}
                                className="inline-flex items-center justify-center gap-1.5 py-2.5 px-4 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-zinc-200 font-medium rounded-lg transition-colors cursor-pointer shrink-0"
                              >
                                <RotateCw className="w-3.5 h-3.5 text-indigo-400" />
                                <span>Re-download / Overwrite</span>
                              </button>
                            </div>
                          );
                        }

                        if (isDirectLora) {
                          return (
                            <button
                              type="button"
                              disabled={directStartingKey === cardKey}
                              onClick={() => handleDirectLoraDownload(item, cardKey)}
                              className="w-full inline-flex items-center justify-center gap-2 py-2.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white font-medium rounded-lg transition-colors cursor-pointer"
                            >
                              <HardDriveDownload className="w-4 h-4" />
                              <span>
                                {directStartingKey === cardKey ? 'Starting Download...' : 'Download LoRA'}
                              </span>
                            </button>
                          );
                        }

                        return (
                          <button
                            type="button"
                            onClick={() => openDownloadModal(item)}
                            className="w-full inline-flex items-center justify-center gap-2 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white font-medium rounded-lg transition-colors cursor-pointer"
                          >
                            {fileCount > 1 || item.provider === 'huggingface' ? (
                              <>
                                <FolderGit2 className="w-4 h-4" />
                                <span>Browse Files &amp; Download ({fileCount})</span>
                              </>
                            ) : (
                              <>
                                <HardDriveDownload className="w-4 h-4" />
                                <span>Review &amp; Download</span>
                              </>
                            )}
                          </button>
                        );
                      })()
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Download History & Progress */}
      <DownloadHistoryList
        downloads={downloads}
        onRefreshDownloads={onRefreshDownloads}
        onInspectDownload={onInspectDownload}
        onPushToast={onPushToast}
      />

      {/* Explicit User Confirmation & Multi-File Picker Modal */}
      {pendingDownload && (
        <ModelDownloadConfirmModal
          pendingDownload={pendingDownload}
          selectedFile={selectedFile}
          onSelectFile={handleSelectFile}
          isLoadingRepoFiles={isLoadingRepoFiles}
          dlSubfolder={dlSubfolder}
          setDlSubfolder={setDlSubfolder}
          loraCategory={pendingLoraCategory}
          setLoraCategory={setPendingLoraCategory}
          characterAutomation={pendingCharacterAutomation}
          setCharacterAutomation={setPendingCharacterAutomation}
          mentionAutomation={pendingMentionAutomation}
          setMentionAutomation={setPendingMentionAutomation}
          pillTypeSettings={pillTypeSettings}
          customFilename={customFilename}
          setCustomFilename={setCustomFilename}
          allowOverwrite={allowOverwrite}
          setAllowOverwrite={setAllowOverwrite}
          scheduleDownload={scheduleDownload}
          setScheduleDownload={setScheduleDownload}
          scheduledForInput={scheduledForInput}
          setScheduledForInput={setScheduledForInput}
          dlError={dlError}
          isSubmitting={isSubmitting}
          onClose={() => {
            setPendingDownload(null);
            setSelectedFile(null);
          }}
          onConfirm={handleConfirmDownload}
        />
      )}
    </div>
  );
};
