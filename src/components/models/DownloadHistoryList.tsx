import React, { useState } from 'react';
import { ArrowUpRight, Clock, FileWarning, Play, Trash2 } from 'lucide-react';
import { api } from '../../api/client.ts';
import { formatUnlockCountdown, formatUnlockLocalTime } from './earlyAccessUtils.ts';

interface DownloadHistoryListProps {
  downloads: any[];
  onRefreshDownloads: () => Promise<void>;
  onInspectDownload?: (job: any) => void;
  onPushToast?: (text: string, type?: 'info' | 'success' | 'warning' | 'error') => void;
}

/**
 * Renders scheduled, active, completed, and failed server-side model downloads.
 * Completed Civitai downloads display their first cached preview image and link
 * LoRAs directly to the LoRA Detail Inspector (or other model types to Inventory).
 */
export const DownloadHistoryList: React.FC<DownloadHistoryListProps> = ({
  downloads,
  onRefreshDownloads,
  onInspectDownload,
  onPushToast,
}) => {
  const [brokenPreviewIds, setBrokenPreviewIds] = useState<Record<number, boolean>>({});
  const [busyJobId, setBusyJobId] = useState<number | null>(null);

  const handleRunNow = async (job: any) => {
    setBusyJobId(job.id);
    try {
      await api.runScheduledDownloadNow(job.id);
      await onRefreshDownloads();
      onPushToast?.(`Started downloading ${job.model_name}`, 'info');
    } catch (err: any) {
      onPushToast?.(err?.message || 'Could not start scheduled download', 'error');
    } finally {
      setBusyJobId(null);
    }
  };

  const handleCancelScheduled = async (job: any) => {
    setBusyJobId(job.id);
    try {
      await api.cancelScheduledDownload(job.id);
      await onRefreshDownloads();
      onPushToast?.(`Cancelled scheduled download for ${job.model_name}`, 'info');
    } catch (err: any) {
      onPushToast?.(err?.message || 'Could not cancel scheduled download', 'error');
    } finally {
      setBusyJobId(null);
    }
  };

  const handleRescheduleFailed = async (job: any) => {
    setBusyJobId(job.id);
    try {
      const res = await api.rescheduleFailedDownload(job.id, job.early_access_ends_at || null);
      await onRefreshDownloads();
      onPushToast?.(
        `Scheduled ${job.model_name} for ${formatUnlockLocalTime(res.job?.scheduled_for)}`,
        'success'
      );
    } catch (err: any) {
      onPushToast?.(err?.message || 'Could not schedule download', 'error');
    } finally {
      setBusyJobId(null);
    }
  };

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

            const isScheduled = d.status === 'scheduled';
            const isCompleted = d.status === 'completed';

            const showCivitaiThumb =
              (isCompleted || isScheduled) &&
              d.provider === 'civitai' &&
              Boolean(d.first_preview_url) &&
              !brokenPreviewIds[d.id];

            const effectiveType = String(
              d.installed_model_type || d.model_type || ''
            ).toLowerCase();
            const canNavigate =
              isCompleted && Boolean(onInspectDownload) && d.is_installed !== false;

            const linkTooltip =
              effectiveType === 'lora'
                ? 'Open in LoRA Inspector'
                : 'View in Model Inventory';

            return (
              <div
                key={d.id}
                className={`bg-zinc-950 border rounded-lg p-3 flex items-center gap-3.5 ${
                  isScheduled ? 'border-amber-500/35' : 'border-zinc-800'
                }`}
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

                    <div className="flex items-center gap-2 shrink-0">
                      {isScheduled ? (
                        <>
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-amber-500/15 border border-amber-500/30 font-mono text-[11px] text-amber-300 tabular-nums">
                            <Clock className="w-3 h-3" />
                            <span>scheduled · {formatUnlockCountdown(d.scheduled_for)}</span>
                          </span>
                          <button
                            type="button"
                            disabled={busyJobId === d.id}
                            onClick={() => handleRunNow(d)}
                            title="Attempt immediate download now"
                            className="inline-flex items-center gap-1 px-2 py-1 rounded bg-zinc-900 hover:bg-zinc-800 border border-zinc-700 text-zinc-200 hover:text-white disabled:opacity-50 cursor-pointer text-[11px]"
                          >
                            <Play className="w-3 h-3 text-indigo-400" />
                            <span>Try Now</span>
                          </button>
                          <button
                            type="button"
                            disabled={busyJobId === d.id}
                            onClick={() => handleCancelScheduled(d)}
                            title="Cancel scheduled download"
                            className="p-1 rounded bg-zinc-900 hover:bg-rose-500/20 border border-zinc-800 hover:border-rose-500/40 text-zinc-400 hover:text-rose-300 disabled:opacity-50 cursor-pointer"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </>
                      ) : (
                        <>
                          {d.can_reschedule && (
                            <button
                              type="button"
                              disabled={busyJobId === d.id}
                              onClick={() => handleRescheduleFailed(d)}
                              title="Look up Civitai Early Access end date and schedule automatic download"
                              className="inline-flex items-center gap-1 px-2 py-1 rounded bg-amber-600/20 hover:bg-amber-600/35 border border-amber-500/40 text-amber-200 disabled:opacity-50 cursor-pointer text-[11px]"
                            >
                              <Clock className="w-3 h-3 text-amber-400" />
                              <span>Schedule After Unlock</span>
                            </button>
                          )}
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
                        </>
                      )}
                    </div>
                  </div>

                  <div className="text-[11px] font-mono text-zinc-400 truncate">
                    Destination: {d.destination_path}
                  </div>

                  {isScheduled && d.scheduled_for && (
                    <div className="text-[11px] font-mono text-amber-300/90 flex items-center gap-1.5">
                      <Clock className="w-3 h-3 shrink-0" />
                      <span>
                        Auto-downloads after Early Access at {formatUnlockLocalTime(d.scheduled_for)}{' '}
                        ({formatUnlockCountdown(d.scheduled_for)})
                      </span>
                    </div>
                  )}

                  {d.actual_hash && (
                    <div className="text-[11px] font-mono text-emerald-400">
                      Verified SHA256: {d.actual_hash.slice(0, 24)}…
                    </div>
                  )}

                  {d.error_message && (
                    <div
                      className={`text-[11px] flex items-center gap-1 ${
                        isScheduled ? 'text-amber-300' : 'text-rose-400'
                      }`}
                    >
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
