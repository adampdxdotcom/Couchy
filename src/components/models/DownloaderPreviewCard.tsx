import React, { useEffect, useState } from 'react';
import { CheckCircle2, Clock, ExternalLink, Layers, X } from 'lucide-react';
import { formatBytes } from '../../shared/utils.ts';
import {
  DEFAULT_PILL_TYPE_SETTINGS,
  LORA_CATEGORY_OPTIONS,
  resolveLoraCategoryStyle,
} from '../../shared/pillSettings.ts';
import { formatUnlockCountdown, formatUnlockLocalTime } from './earlyAccessUtils.ts';
import { CharacterLoraDownloadOptions } from './CharacterLoraDownloadOptions.tsx';
import { LoraMentionDownloadOptions } from './LoraMentionDownloadOptions.tsx';
import { DownloaderCardActions } from './DownloaderCardActions.tsx';
import { getDefaultSubfolderForItem, type ActivePreviewDownloadEntry } from './downloaderUtils.ts';
import type {
  CharacterDownloadAutomation,
  ExternalModelSearchResult,
  LoraCategory,
  LoraMentionAutomation,
  PillTypeSettings,
} from '../../shared/types.ts';

interface DownloaderPreviewCardProps {
  cardKey: string;
  item: ExternalModelSearchResult;
  activeEntry: ActivePreviewDownloadEntry | null;
  matchingJob: any;
  isDownloadingNow: boolean;
  isEligible: boolean;
  isSelectedForBatch: boolean;
  isBatchDownloading: boolean;
  isDirectStarting: boolean;
  isSavingCategory: boolean;
  hasInspectHandler: boolean;
  pillTypeSettings?: PillTypeSettings;
  activeCategory: LoraCategory;
  hasManualCategoryPick: boolean;
  characterAutomation: CharacterDownloadAutomation;
  mentionAutomation: LoraMentionAutomation;
  onToggleBatch: (cardKey: string) => void;
  onDismiss: (cardKey: string) => void;
  onSelectVersion: (cardKey: string, versionId: string) => void;
  onSelectCategory: (category: LoraCategory) => void;
  onChangeMentionAutomation: (next: LoraMentionAutomation) => void;
  onChangeCharacterAutomation: (next: CharacterDownloadAutomation) => void;
  onSaveInstalledCategory: (
    item: ExternalModelSearchResult,
    cardKey: string,
    category: LoraCategory
  ) => void;
  onInspectInstalled: (item: ExternalModelSearchResult) => void;
  onDirectLoraDownload: (
    item: ExternalModelSearchResult,
    cardKey: string,
    scheduledForIso?: string | null
  ) => void;
  onOpenDownloadModal: (
    item: ExternalModelSearchResult,
    preferSchedule?: boolean,
    initialError?: string | null,
    preferOverwrite?: boolean
  ) => void;
}

/**
 * Full-width preview card displaying model media, version/installed/early-access badges,
 * LoRA category & @mention/character automation controls, specs, and download actions.
 */
export const DownloaderPreviewCard: React.FC<DownloaderPreviewCardProps> = ({
  cardKey,
  item,
  activeEntry,
  matchingJob,
  isDownloadingNow,
  isEligible,
  isSelectedForBatch,
  isBatchDownloading,
  isDirectStarting,
  isSavingCategory,
  hasInspectHandler,
  pillTypeSettings = DEFAULT_PILL_TYPE_SETTINGS,
  activeCategory,
  hasManualCategoryPick,
  characterAutomation,
  mentionAutomation,
  onToggleBatch,
  onDismiss,
  onSelectVersion,
  onSelectCategory,
  onChangeMentionAutomation,
  onChangeCharacterAutomation,
  onSaveInstalledCategory,
  onInspectInstalled,
  onDirectLoraDownload,
  onOpenDownloadModal,
}) => {
  const [activeThumbIdx, setActiveThumbIdx] = useState(0);
  const [brokenImages, setBrokenImages] = useState<Record<string, boolean>>({});

  useEffect(() => {
    setActiveThumbIdx(0);
  }, [item.versionId]);

  const previews =
    item.previewImages && item.previewImages.length > 0
      ? item.previewImages
      : item.previewImageUrl
      ? [{ url: item.previewImageUrl }]
      : [];
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

  const isLoraCard = item.modelType === 'lora' || targetFolder === 'loras';
  const catStyle = resolveLoraCategoryStyle(activeCategory, pillTypeSettings);
  const isAutoAssigned =
    !hasManualCategoryPick &&
    !item.isInstalled &&
    Boolean(item.suggestedLoraCategory) &&
    item.suggestedLoraCategory !== 'unclassified';
  const hasUnsavedInstalledChange =
    Boolean(item.isInstalled && item.installedFilename) &&
    activeCategory !== (item.installedLoraCategory || 'unclassified');
  const showCharAutomation = !item.isInstalled && activeCategory === 'character';

  return (
    <div
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
                onClick={() => setActiveThumbIdx(idx)}
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
          {/* Header Row: Title, Base Model, Version Picker, Badges & Dismiss */}
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
                {!activeEntry && item.availableVersions && item.availableVersions.length > 1 ? (
                  <select
                    value={item.versionId || ''}
                    onChange={(e) => {
                      setActiveThumbIdx(0);
                      onSelectVersion(cardKey, e.target.value);
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
                    onClick={() => onInspectInstalled(item)}
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
                    checked={isSelectedForBatch}
                    disabled={isBatchDownloading}
                    onChange={() => onToggleBatch(cardKey)}
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
                  onClick={() => onDismiss(cardKey)}
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
            <span className="uppercase font-semibold text-indigo-300">{item.modelType}</span>
            <span className="text-zinc-600">·</span>
            <span className="text-zinc-200 break-all" title={displayFilename}>
              {displayFilename}
            </span>
            <span className="text-zinc-600">·</span>
            <span className="text-zinc-300 tabular-nums">{formatBytes(item.fileSize)}</span>
            {item.recommendedWeight !== null && item.recommendedWeight !== undefined && (
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

          {/* LoRA Category Selector & Automation Controls */}
          {isLoraCard && (
            <div className="space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2 bg-zinc-950/60 border border-zinc-800/80 rounded-lg px-3 py-2">
                <div className="flex flex-wrap items-center gap-2">
                  <span className={`w-2 h-2 rounded-full shrink-0 ${catStyle.swatchBg}`} />
                  <span className="text-zinc-400">LoRA Category:</span>
                  <select
                    value={activeCategory}
                    disabled={isDownloadingNow}
                    onChange={(e) => onSelectCategory(e.target.value as LoraCategory)}
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
                    disabled={isSavingCategory}
                    onClick={() => onSaveInstalledCategory(item, cardKey, activeCategory)}
                    className="px-2.5 py-1 rounded-md bg-emerald-600/20 hover:bg-emerald-600/35 border border-emerald-500/40 text-emerald-200 text-[11px] font-medium cursor-pointer disabled:opacity-50"
                  >
                    {isSavingCategory ? 'Saving...' : 'Save to Installed'}
                  </button>
                )}
              </div>

              {!item.isInstalled && (
                <LoraMentionDownloadOptions
                  value={mentionAutomation}
                  disabled={isDownloadingNow}
                  onChange={onChangeMentionAutomation}
                />
              )}

              {showCharAutomation && (
                <CharacterLoraDownloadOptions
                  value={characterAutomation}
                  disabled={isDownloadingNow}
                  onChange={onChangeCharacterAutomation}
                />
              )}
            </div>
          )}

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
          <DownloaderCardActions
            cardKey={cardKey}
            item={item}
            fileCount={fileCount}
            targetFolder={targetFolder}
            displayFilename={displayFilename}
            matchingJob={matchingJob}
            isDownloadingNow={isDownloadingNow}
            isDirectStarting={isDirectStarting}
            hasInspectHandler={hasInspectHandler}
            onInspectInstalled={onInspectInstalled}
            onDirectLoraDownload={onDirectLoraDownload}
            onOpenDownloadModal={onOpenDownloadModal}
          />
        </div>
      </div>
    </div>
  );
};
