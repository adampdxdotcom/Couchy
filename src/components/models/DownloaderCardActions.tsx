import React from 'react';
import {
  CheckCircle2,
  Clock,
  FolderGit2,
  HardDriveDownload,
  Loader2,
  Play,
  RotateCw,
} from 'lucide-react';
import { formatBytes } from '../../shared/utils.ts';
import {
  formatUnlockCountdown,
  formatUnlockLocalTime,
  getSuggestedScheduledIso,
} from './earlyAccessUtils.ts';
import type { ExternalModelSearchResult } from '../../shared/types.ts';

interface DownloaderCardActionsProps {
  cardKey: string;
  item: ExternalModelSearchResult;
  fileCount: number;
  targetFolder: string;
  displayFilename: string;
  matchingJob: any;
  isDownloadingNow: boolean;
  isDirectStarting: boolean;
  hasInspectHandler: boolean;
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
 * Bottom action/progress footer for a downloader preview card (active progress bar,
 * Early Access schedule/try-now buttons, installed inspect/overwrite, or download trigger).
 */
export const DownloaderCardActions: React.FC<DownloaderCardActionsProps> = ({
  cardKey,
  item,
  fileCount,
  targetFolder,
  displayFilename,
  matchingJob,
  isDownloadingNow,
  isDirectStarting,
  hasInspectHandler,
  onInspectInstalled,
  onDirectLoraDownload,
  onOpenDownloadModal,
}) => {
  const dlPct =
    matchingJob && matchingJob.total_bytes > 0
      ? Math.min(100, Math.round((matchingJob.bytes_downloaded / matchingJob.total_bytes) * 100))
      : null;

  if (isDownloadingNow) {
    return (
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
    );
  }

  const isDirectLora =
    item.modelType === 'lora' && (item.provider === 'civitai' || fileCount <= 1);

  if (item.isEarlyAccessActive) {
    const suggestedIso = getSuggestedScheduledIso(item.earlyAccessEndsAt);
    const unlockSummary = item.earlyAccessEndsAt
      ? `Unlocks ${formatUnlockLocalTime(item.earlyAccessEndsAt)} (${formatUnlockCountdown(item.earlyAccessEndsAt)})`
      : 'Check in 1h';

    return (
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={isDirectStarting}
          onClick={() =>
            isDirectLora
              ? onDirectLoraDownload(item, cardKey, suggestedIso)
              : onOpenDownloadModal(item, true)
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
          disabled={isDirectStarting}
          onClick={() =>
            isDirectLora
              ? onDirectLoraDownload(item, cardKey, null)
              : onOpenDownloadModal(item, false)
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

  if (item.isPartiallyInstalled) {
    const installedCount = item.installedFilesCount ?? 1;
    const totalCount = item.totalFilesCount ?? fileCount;
    const remainingCount = Math.max(0, totalCount - installedCount);
    return (
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => onOpenDownloadModal(item, false, null, false)}
          className="flex-1 min-w-[200px] inline-flex items-center justify-center gap-2 py-2.5 px-4 bg-indigo-600 hover:bg-indigo-500 text-white font-medium rounded-lg transition-colors cursor-pointer"
        >
          <FolderGit2 className="w-4 h-4" />
          <span>
            Download More from Repo
            {remainingCount > 0 ? ` (${remainingCount} remaining)` : ''}
          </span>
        </button>
        {hasInspectHandler && item.installedFilename && (
          <button
            type="button"
            onClick={() => onInspectInstalled(item)}
            className="inline-flex items-center justify-center gap-1.5 py-2.5 px-4 bg-emerald-600/15 hover:bg-emerald-600/25 border border-emerald-500/40 text-emerald-200 font-medium rounded-lg transition-colors cursor-pointer shrink-0"
          >
            <CheckCircle2 className="w-4 h-4 text-emerald-400" />
            <span>Inspect Installed ({item.installedFilename})</span>
          </button>
        )}
      </div>
    );
  }

  if (item.isInstalled) {
    return (
      <div className="flex flex-wrap items-center gap-2">
        {hasInspectHandler && (
          <button
            type="button"
            onClick={() => onInspectInstalled(item)}
            className="flex-1 min-w-[180px] inline-flex items-center justify-center gap-2 py-2.5 px-4 bg-emerald-600/20 hover:bg-emerald-600/30 border border-emerald-500/40 text-emerald-200 font-medium rounded-lg transition-colors cursor-pointer"
          >
            <CheckCircle2 className="w-4 h-4 text-emerald-400" />
            <span>
              Inspect Installed
              {item.installedFilename &&
              item.installedFilename.toLowerCase() !== item.filename.toLowerCase()
                ? ` (${item.installedFilename})`
                : ''}
            </span>
          </button>
        )}
        <button
          type="button"
          onClick={() => onOpenDownloadModal(item, false, null, true)}
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
        disabled={isDirectStarting}
        onClick={() => onDirectLoraDownload(item, cardKey)}
        className="w-full inline-flex items-center justify-center gap-2 py-2.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white font-medium rounded-lg transition-colors cursor-pointer"
      >
        <HardDriveDownload className="w-4 h-4" />
        <span>{isDirectStarting ? 'Starting Download...' : 'Download LoRA'}</span>
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={() => onOpenDownloadModal(item)}
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
};
