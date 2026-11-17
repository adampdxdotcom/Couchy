import React from 'react';
import { DEFAULT_PILL_TYPE_SETTINGS } from '../shared/pillSettings.ts';
import { DownloadHistoryList } from './models/DownloadHistoryList.tsx';
import { DownloaderBatchBar } from './models/DownloaderBatchBar.tsx';
import { DownloaderPreviewCard } from './models/DownloaderPreviewCard.tsx';
import { DownloaderSearchBar } from './models/DownloaderSearchBar.tsx';
import {
  getDownloaderCardKey,
  type ActivePreviewDownloadEntry,
} from './models/downloaderUtils.ts';
import { useModelDownloaderActions } from './models/useModelDownloaderActions.ts';
import { ModelDownloadConfirmModal } from './ModelDownloadConfirmModal.tsx';
import type { ExternalModelSearchResult, PillTypeSettings } from '../shared/types.ts';

export { getDownloaderCardKey, type ActivePreviewDownloadEntry };

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
  const actions = useModelDownloaderActions({
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
  });

  return (
    <div className="space-y-6">
      <DownloaderSearchBar
        extQuery={extQuery}
        setExtQuery={setExtQuery}
        extTypeFilter={extTypeFilter}
        setExtTypeFilter={setExtTypeFilter}
        isSearchingExt={isSearchingExt}
        searchError={searchError}
        searchNotice={searchNotice}
        onDismissSearchNotice={onDismissSearchNotice}
        onSearch={onSearch}
      />

      {actions.showBatchBar && (
        <DownloaderBatchBar
          totalEligibleCount={actions.eligibleEntries.length}
          selectedCount={actions.selectedBatchEntries.length}
          selectedTotalBytes={actions.selectedTotalBytes}
          installedCount={actions.installedBatchCount}
          earlyAccessCount={actions.earlyAccessBatchCount}
          isBatchDownloading={actions.isBatchDownloading}
          onSelectAll={() =>
            actions.setSelectedBatchKeys(
              new Set(actions.eligibleEntries.map((e) => e.cardKey))
            )
          }
          onClearSelection={() => actions.setSelectedBatchKeys(new Set())}
          onDownloadAll={() => actions.handleBatchDownloadAll(actions.selectedBatchEntries)}
        />
      )}

      {/* Full-Width Preview Stack (Newest First; Active Downloads Clear Automatically on Completion) */}
      {actions.resolvedPreviews.length > 0 && (
        <div className="space-y-4">
          {actions.resolvedPreviews.map(
            ({ cardKey, item, activeEntry, matchingJob, isDownloadingNow, isEligible }) => {
              const catMapKey = actions.getCategoryMapKey(cardKey, item.versionId);
              return (
                <DownloaderPreviewCard
                  key={activeEntry ? `dl-${activeEntry.jobId}` : cardKey}
                  cardKey={cardKey}
                  item={item}
                  activeEntry={activeEntry}
                  matchingJob={matchingJob}
                  isDownloadingNow={isDownloadingNow}
                  isEligible={isEligible}
                  isSelectedForBatch={actions.selectedBatchKeys.has(cardKey)}
                  isBatchDownloading={actions.isBatchDownloading}
                  isDirectStarting={actions.directStartingKey === cardKey}
                  isSavingCategory={actions.savingCategoryKey === cardKey}
                  hasInspectHandler={Boolean(onInspectDownload)}
                  pillTypeSettings={pillTypeSettings}
                  activeCategory={actions.getEffectiveCardCategory(item, cardKey)}
                  hasManualCategoryPick={Boolean(actions.selectedCategoryByCard[catMapKey])}
                  characterAutomation={actions.getEffectiveCharacterAutomation(item, cardKey)}
                  mentionAutomation={actions.getEffectiveMentionAutomation(item, cardKey)}
                  onToggleBatch={actions.toggleBatchKey}
                  onDismiss={actions.handleDismissSearchCard}
                  onSelectVersion={(key, nextVerId) =>
                    actions.setSelectedVersionByCard((prev) => ({ ...prev, [key]: nextVerId }))
                  }
                  onSelectCategory={(nextCat) =>
                    actions.setSelectedCategoryByCard((prev) => ({
                      ...prev,
                      [catMapKey]: nextCat,
                    }))
                  }
                  onChangeMentionAutomation={(nextMention) =>
                    actions.setMentionAutoByCard((prev) => ({
                      ...prev,
                      [catMapKey]: nextMention,
                    }))
                  }
                  onChangeCharacterAutomation={(nextAuto) =>
                    actions.setCharacterAutoByCard((prev) => ({
                      ...prev,
                      [catMapKey]: nextAuto,
                    }))
                  }
                  onSaveInstalledCategory={actions.handleSaveInstalledCategory}
                  onInspectInstalled={actions.handleInspectInstalledItem}
                  onDirectLoraDownload={actions.handleDirectLoraDownload}
                  onOpenDownloadModal={actions.openDownloadModal}
                />
              );
            }
          )}
        </div>
      )}

      <DownloadHistoryList
        downloads={downloads}
        onRefreshDownloads={onRefreshDownloads}
        onInspectDownload={onInspectDownload}
        onPushToast={onPushToast}
      />

      {actions.pendingDownload && (
        <ModelDownloadConfirmModal
          pendingDownload={actions.pendingDownload}
          selectedFile={actions.selectedFile}
          onSelectFile={actions.handleSelectFile}
          isLoadingRepoFiles={actions.isLoadingRepoFiles}
          dlSubfolder={actions.dlSubfolder}
          setDlSubfolder={actions.setDlSubfolder}
          loraCategory={actions.pendingLoraCategory}
          setLoraCategory={actions.setPendingLoraCategory}
          characterAutomation={actions.pendingCharacterAutomation}
          setCharacterAutomation={actions.setPendingCharacterAutomation}
          mentionAutomation={actions.pendingMentionAutomation}
          setMentionAutomation={actions.setPendingMentionAutomation}
          pillTypeSettings={pillTypeSettings}
          customFilename={actions.customFilename}
          setCustomFilename={actions.setCustomFilename}
          allowOverwrite={actions.allowOverwrite}
          setAllowOverwrite={actions.setAllowOverwrite}
          scheduleDownload={actions.scheduleDownload}
          setScheduleDownload={actions.setScheduleDownload}
          scheduledForInput={actions.scheduledForInput}
          setScheduledForInput={actions.setScheduledForInput}
          dlError={actions.dlError}
          isSubmitting={actions.isSubmitting}
          onClose={() => {
            actions.setPendingDownload(null);
            actions.setSelectedFile(null);
          }}
          onConfirm={actions.handleConfirmDownload}
        />
      )}
    </div>
  );
};
