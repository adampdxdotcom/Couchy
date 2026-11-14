import React, { useState } from 'react';
import { ArrowUpRight, FileWarning } from 'lucide-react';

interface DownloadHistoryListProps {
  downloads: any[];
  onRefreshDownloads: () => Promise<void>;
  onInspectDownload?: (job: any) => void;
}

/**
 * Renders active, completed, and failed server-side model downloads.
 * Completed Civitai downloads display their first cached preview image and link
 * LoRAs directly to the LoRA Detail Inspector (or other model types to Inventory).
 */
export const DownloadHistoryList: React.FC<DownloadHistoryListProps> = ({
  downloads,
  onRefreshDownloads,
  onInspectDownload,
}) => {
  const [brokenPreviewIds, setBrokenPreviewIds] = useState<Record<number, boolean>>({});

  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-display font-semibold text-zinc-100">
          Server-Side Download Queue &amp; Hash Verification History
        </h3>
        <button
          type="button"
          onClick={onRefreshDownloads}
          className="text-xs text-indigo-400 hover:text-indigo-300 cursor-pointer"
        >
          Refresh Status
        </button>
      </div>

      {downloads.length === 0 ? (
        <p className="text-xs text-zinc-500">No model downloads initiated yet.</p>
      ) : (
        <div className="space-y-2 text-xs">
          {downloads.map((d) => {
            const pct =
              d.total_bytes > 0
                ? Math.min(100, Math.round((d.bytes_downloaded / d.total_bytes) * 100))
                : d.status === 'completed'
                ? 100
                : 0;

            const showCivitaiThumb =
              d.status === 'completed' &&
              d.provider === 'civitai' &&
              Boolean(d.first_preview_url) &&
              !brokenPreviewIds[d.id];

            const effectiveType = String(
              d.installed_model_type || d.model_type || ''
            ).toLowerCase();
            const isCompleted = d.status === 'completed';
            const canNavigate =
              isCompleted && Boolean(onInspectDownload) && d.is_installed !== false;

            const linkTooltip =
              effectiveType === 'lora'
                ? 'Open in LoRA Inspector'
                : 'View in Model Inventory';

            return (
              <div
                key={d.id}
                className="bg-zinc-950 border border-zinc-800 rounded-lg p-3 flex items-center gap-3.5"
              >
                {showCivitaiThumb &&
                  (canNavigate ? (
                    <button
                      type="button"
                      onClick={() => onInspectDownload?.(d)}
                      title={linkTooltip}
                      className="w-16 h-16 rounded-lg overflow-hidden border border-zinc-800 hover:border-indigo-500/60 bg-zinc-900 shrink-0 cursor-pointer transition-colors"
                    >
                      <img
                        src={d.first_preview_url}
                        alt={d.model_name}
                        className="w-full h-full object-cover"
                        loading="lazy"
                        onError={() =>
                          setBrokenPreviewIds((prev) => ({ ...prev, [d.id]: true }))
                        }
                      />
                    </button>
                  ) : (
                    <div className="w-16 h-16 rounded-lg overflow-hidden border border-zinc-800 bg-zinc-900 shrink-0">
                      <img
                        src={d.first_preview_url}
                        alt={d.model_name}
                        className="w-full h-full object-cover"
                        loading="lazy"
                        onError={() =>
                          setBrokenPreviewIds((prev) => ({ ...prev, [d.id]: true }))
                        }
                      />
                    </div>
                  ))}

                <div className="flex-1 min-w-0 space-y-1">
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex flex-wrap items-center gap-2 min-w-0">
                      {canNavigate ? (
                        <button
                          type="button"
                          onClick={() => onInspectDownload?.(d)}
                          title={linkTooltip}
                          className="inline-flex items-center gap-1 font-medium text-sm text-zinc-100 hover:text-indigo-300 hover:underline underline-offset-2 cursor-pointer text-left truncate max-w-full group"
                        >
                          <span className="truncate">{d.model_name}</span>
                          <ArrowUpRight className="w-3.5 h-3.5 text-indigo-400 shrink-0 opacity-75 group-hover:opacity-100" />
                        </button>
                      ) : (
                        <span className="font-medium text-zinc-200 truncate">
                          {d.model_name}
                        </span>
                      )}

                      <span className="px-1.5 py-0.5 rounded bg-zinc-900 border border-zinc-800 font-mono text-[10px] text-zinc-400">
                        {d.provider}
                      </span>

                      {effectiveType && (
                        <span className="px-1.5 py-0.5 rounded bg-zinc-900 border border-zinc-800 font-mono text-[10px] text-indigo-300 uppercase">
                          {effectiveType}
                        </span>
                      )}

                      {isCompleted && d.is_installed === false && (
                        <span className="px-1.5 py-0.5 rounded bg-zinc-900 border border-zinc-800 font-mono text-[10px] text-zinc-500">
                          uninstalled
                        </span>
                      )}
                    </div>

                    <span
                      className={`font-mono tabular-nums shrink-0 ${
                        d.status === 'failed'
                          ? 'text-rose-400'
                          : d.status === 'downloading'
                          ? 'text-indigo-300'
                          : 'text-zinc-300'
                      }`}
                    >
                      {d.status} · {pct}%
                    </span>
                  </div>

                  <div className="text-[11px] font-mono text-zinc-400 truncate">
                    Destination: {d.destination_path}
                  </div>

                  {d.actual_hash && (
                    <div className="text-[11px] font-mono text-emerald-400">
                      Verified SHA256: {d.actual_hash.slice(0, 24)}…
                    </div>
                  )}

                  {d.error_message && (
                    <div className="text-[11px] text-rose-400 flex items-center gap-1">
                      <FileWarning className="w-3.5 h-3.5 shrink-0" />
                      <span className="truncate">{d.error_message}</span>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
