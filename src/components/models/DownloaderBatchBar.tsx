import React from 'react';
import { CheckSquare, HardDriveDownload, Loader2, Square } from 'lucide-react';
import { formatBytes } from '../../shared/utils.ts';

interface DownloaderBatchBarProps {
  totalEligibleCount: number;
  selectedCount: number;
  selectedTotalBytes: number;
  installedCount: number;
  earlyAccessCount: number;
  isBatchDownloading: boolean;
  onSelectAll: () => void;
  onClearSelection: () => void;
  onDownloadAll: () => void;
}

/**
 * Batch selection and Download All action bar displayed above multi-card downloader results
 * (such as Civitai Krea 2 image resource imports or multi-result searches).
 */
export const DownloaderBatchBar: React.FC<DownloaderBatchBarProps> = ({
  totalEligibleCount,
  selectedCount,
  selectedTotalBytes,
  installedCount,
  earlyAccessCount,
  isBatchDownloading,
  onSelectAll,
  onClearSelection,
  onDownloadAll,
}) => {
  if (totalEligibleCount === 0 && installedCount === 0 && earlyAccessCount === 0) {
    return null;
  }

  const allSelected = totalEligibleCount > 0 && selectedCount === totalEligibleCount;

  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-xl px-4 py-3 flex flex-wrap items-center justify-between gap-3 text-xs">
      <div className="flex flex-wrap items-center gap-2.5">
        <span className="font-medium text-zinc-200">
          {totalEligibleCount > 0
            ? `${selectedCount} of ${totalEligibleCount} downloadable selected`
            : 'No downloadable missing models in this batch'}
        </span>

        {selectedCount > 0 && selectedTotalBytes > 0 && (
          <span className="px-2 py-0.5 rounded bg-zinc-950 border border-zinc-800 font-mono text-[11px] text-zinc-300 tabular-nums">
            {formatBytes(selectedTotalBytes)}
          </span>
        )}

        {installedCount > 0 && (
          <span className="px-2 py-0.5 rounded bg-emerald-500/10 border border-emerald-500/30 font-mono text-[11px] text-emerald-300">
            {installedCount} Installed
          </span>
        )}

        {earlyAccessCount > 0 && (
          <span className="px-2 py-0.5 rounded bg-amber-500/10 border border-amber-500/30 font-mono text-[11px] text-amber-300">
            {earlyAccessCount} Early Access
          </span>
        )}
      </div>

      {totalEligibleCount > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={isBatchDownloading}
            onClick={allSelected ? onClearSelection : onSelectAll}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-zinc-950 hover:bg-zinc-800 disabled:opacity-50 border border-zinc-700/80 text-zinc-200 cursor-pointer transition-colors"
          >
            {allSelected ? (
              <>
                <CheckSquare className="w-3.5 h-3.5 text-indigo-400" />
                <span>Deselect All</span>
              </>
            ) : (
              <>
                <Square className="w-3.5 h-3.5 text-zinc-400" />
                <span>Select All ({totalEligibleCount})</span>
              </>
            )}
          </button>

          <button
            type="button"
            disabled={selectedCount === 0 || isBatchDownloading}
            onClick={onDownloadAll}
            className="inline-flex items-center gap-2 px-4 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white font-medium cursor-pointer transition-colors"
          >
            {isBatchDownloading ? (
              <>
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                <span>Queuing Downloads...</span>
              </>
            ) : (
              <>
                <HardDriveDownload className="w-3.5 h-3.5" />
                <span>
                  Download All ({selectedCount}
                  {selectedTotalBytes > 0 ? ` · ${formatBytes(selectedTotalBytes)}` : ''})
                </span>
              </>
            )}
          </button>
        </div>
      )}
    </div>
  );
};
