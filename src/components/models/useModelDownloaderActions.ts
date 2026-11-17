import React, { useEffect, useState } from 'react';
import { api } from '../../api/client.ts';
import { formatUnlockLocalTime, getSuggestedScheduledIso, toLocalDateTimeInputValue } from './earlyAccessUtils.ts';
import { COMFY_SUBFOLDER_OPTIONS } from '../ModelDownloadConfirmModal.tsx';
import { deriveDefaultCharacterAutomation } from './CharacterLoraDownloadOptions.tsx';
import { DEFAULT_LORA_MENTION_AUTOMATION } from './LoraMentionDownloadOptions.tsx';
import {
  applySelectedVersion,
  buildStartDownloadPayload,
  getDefaultSubfolderForItem,
  getDownloaderCardKey,
  isItemBatchEligible,
  type ActivePreviewDownloadEntry,
  type ResolvedPreviewEntry,
} from './downloaderUtils.ts';
import type {
  CharacterDownloadAutomation,
  ComfyModelSubfolder,
  ExternalModelFileOption,
  ExternalModelSearchResult,
  LoraCategory,
  LoraMentionAutomation,
  ModelType,
} from '../../shared/types.ts';

interface UseModelDownloaderActionsParams {
  setExtQuery: (q: string) => void;
  searchResults: ExternalModelSearchResult[];
  setSearchResults: React.Dispatch<React.SetStateAction<ExternalModelSearchResult[]>>;
  searchBatchTimestamp: number;
  activePreviewDownloads: ActivePreviewDownloadEntry[];
  setActivePreviewDownloads: React.Dispatch<React.SetStateAction<ActivePreviewDownloadEntry[]>>;
  searchNotice?: string | null;
  downloads: any[];
  onRefreshDownloads: () => Promise<void>;
  onInspectDownload?: (job: any) => void;
  onPushToast?: (text: string, type?: 'info' | 'success' | 'warning' | 'error') => void;
}

/**
 * Manages downloader card selections, batch queuing, download confirmation modal state,
 * and direct/scheduled download submissions.
 */
export function useModelDownloaderActions({
  setExtQuery,
  searchResults,
  setSearchResults,
  searchBatchTimestamp,
  activePreviewDownloads,
  setActivePreviewDownloads,
  searchNotice,
  downloads,
  onRefreshDownloads,
  onInspectDownload,
  onPushToast,
}: UseModelDownloaderActionsParams) {
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
    if (
      item.isInstalled &&
      item.installedLoraCategory &&
      item.installedLoraCategory !== 'unclassified'
    ) {
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
      const primary = item.availableFiles?.[0] || null;
      const targetFilename = primary?.filename || item.filename;
      const chosenCategory = getEffectiveCardCategory(item, cardKey);
      const res = await api.startModelDownload(
        buildStartDownloadPayload({
          item,
          selectedFile: primary,
          targetFilename,
          effectiveType: 'lora',
          subfolder: 'loras',
          allowOverwrite: false,
          loraCategory: chosenCategory,
          characterAutomation:
            chosenCategory === 'character' && !item.isInstalled
              ? getEffectiveCharacterAutomation(item, cardKey)
              : null,
          mentionAutomation: getEffectiveMentionAutomation(item, cardKey),
          scheduledFor: scheduledForIso,
        })
      );
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

      const res = await api.startModelDownload(
        buildStartDownloadPayload({
          item: pendingDownload,
          selectedFile,
          targetFilename,
          effectiveType,
          subfolder: dlSubfolder,
          allowOverwrite,
          loraCategory: effectiveType === 'lora' ? pendingLoraCategory : null,
          characterAutomation:
            effectiveType === 'lora' &&
            pendingLoraCategory === 'character' &&
            !pendingDownload.isInstalled
              ? pendingCharacterAutomation
              : null,
          mentionAutomation: effectiveType === 'lora' ? pendingMentionAutomation : null,
          scheduledFor: scheduledForIso,
        })
      );
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
        const primary = item.availableFiles?.[0] || null;
        const targetFilename = primary?.filename || item.filename;
        const targetFolder = primary?.suggestedSubfolder || getDefaultSubfolderForItem(item);
        const effectiveType = (primary?.modelType || item.modelType) as ModelType;
        const isLora = effectiveType === 'lora' || targetFolder === 'loras';
        const chosenCategory = isLora ? getEffectiveCardCategory(item, cardKey) : null;

        try {
          const res = await api.startModelDownload(
            buildStartDownloadPayload({
              item,
              selectedFile: primary,
              targetFilename,
              effectiveType,
              subfolder: targetFolder,
              allowOverwrite: false,
              loraCategory: chosenCategory,
              characterAutomation:
                isLora && chosenCategory === 'character' && !item.isInstalled
                  ? getEffectiveCharacterAutomation(item, cardKey)
                  : null,
              mentionAutomation: isLora ? getEffectiveMentionAutomation(item, cardKey) : null,
            })
          );
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

  // Merge active downloads (newest first) with staged search results (rank-preserving)
  const activeKeySet = new Set(activePreviewDownloads.map((a) => a.cardKey));
  const combinedPreviews = [
    ...activePreviewDownloads.map((entry) => ({
      cardKey: entry.cardKey,
      item: entry.item,
      activeEntry: entry as ActivePreviewDownloadEntry | null,
      sortTime: entry.startedAt,
    })),
    ...searchResults
      .map((item, idx) => ({
        cardKey: getDownloaderCardKey(item),
        item,
        activeEntry: null as ActivePreviewDownloadEntry | null,
        sortTime: (searchBatchTimestamp || 1) - idx * 0.001,
      }))
      .filter((entry) => !activeKeySet.has(entry.cardKey)),
  ].sort((a, b) => b.sortTime - a.sortTime);

  const resolvedPreviews: ResolvedPreviewEntry[] = combinedPreviews.map(
    ({ cardKey, item: rawItem, activeEntry }) => {
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
    }
  );

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

  return {
    resolvedPreviews,
    eligibleEntries,
    selectedBatchEntries,
    selectedTotalBytes,
    installedBatchCount,
    earlyAccessBatchCount,
    showBatchBar,
    selectedBatchKeys,
    setSelectedBatchKeys,
    toggleBatchKey,
    selectedCategoryByCard,
    setSelectedCategoryByCard,
    setCharacterAutoByCard,
    setMentionAutoByCard,
    setSelectedVersionByCard,
    getCategoryMapKey,
    getEffectiveCardCategory,
    getEffectiveCharacterAutomation,
    getEffectiveMentionAutomation,
    directStartingKey,
    savingCategoryKey,
    isBatchDownloading,
    handleInspectInstalledItem,
    openDownloadModal,
    handleDirectLoraDownload,
    handleBatchDownloadAll,
    handleSaveInstalledCategory,
    handleDismissSearchCard,
    pendingDownload,
    setPendingDownload,
    selectedFile,
    setSelectedFile,
    isLoadingRepoFiles,
    dlSubfolder,
    setDlSubfolder,
    pendingLoraCategory,
    setPendingLoraCategory,
    pendingCharacterAutomation,
    setPendingCharacterAutomation,
    pendingMentionAutomation,
    setPendingMentionAutomation,
    customFilename,
    setCustomFilename,
    allowOverwrite,
    setAllowOverwrite,
    scheduleDownload,
    setScheduleDownload,
    scheduledForInput,
    setScheduledForInput,
    dlError,
    isSubmitting,
    handleSelectFile,
    handleConfirmDownload,
  };
}
