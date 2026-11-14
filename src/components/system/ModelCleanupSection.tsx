import React, { useEffect, useState } from 'react';
import { CheckCircle2, Clock, HardDrive, Loader2, RefreshCw, ShieldCheck, Trash2, AlertTriangle } from 'lucide-react';
import { api } from '../../api/client.ts';
import type { ModelCleanupStatus } from '../../shared/types.ts';

interface ModelCleanupSectionProps {
  initialStatus?: ModelCleanupStatus | null;
  onRefreshAll: () => Promise<void>;
  onFeedback: (msg: string) => void;
}

const RETENTION_PRESETS = [1, 6, 24, 48, 72] as const;

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  if (bytes >= 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${Math.round(bytes / 1024)} KB`;
}

/**
 * Settings card for safely auto-cleaning duplicate model files from DOWNLOADS_DIR
 * after an exact byte-size + SHA-256 copy is verified inside read-only COMFYUI_MODELS_DIR.
 */
export const ModelCleanupSection: React.FC<ModelCleanupSectionProps> = ({
  initialStatus,
  onRefreshAll,
  onFeedback,
}) => {
  const [status, setStatus] = useState<ModelCleanupStatus | null>(initialStatus || null);
  const [hoursInput, setHoursInput] = useState<string>(
    String(initialStatus?.retentionHours ?? 24)
  );
  const [isBusy, setIsBusy] = useState(false);

  const loadStatus = async () => {
    try {
      const next = await api.getModelCleanupStatus();
      setStatus(next);
      setHoursInput(String(next.retentionHours));
    } catch (err: any) {
      onFeedback(`Failed to load model cleanup status: ${err?.message || 'Unknown error'}`);
    }
  };

  useEffect(() => {
    loadStatus();
  }, []);

  const handleToggleEnabled = async (nextEnabled: boolean) => {
    setIsBusy(true);
    try {
      const next = await api.updateModelCleanupConfig({ enabled: nextEnabled });
      setStatus(next);
      onFeedback(
        nextEnabled
          ? `Automatic copied-model cleanup enabled (${next.retentionHours}h retention after verification).`
          : 'Automatic copied-model cleanup disabled.'
      );
    } catch (err: any) {
      onFeedback(`Failed to update cleanup toggle: ${err?.message}`);
    } finally {
      setIsBusy(false);
    }
  };

  const handleSaveHours = async (targetHours: number) => {
    const clamped = Math.max(0, Math.min(8760, Math.round(targetHours)));
    setHoursInput(String(clamped));
    setIsBusy(true);
    try {
      const next = await api.updateModelCleanupConfig({ retentionHours: clamped });
      setStatus(next);
      onFeedback(`Saved cleanup retention window: ${next.retentionHours} hour(s) after copy verification.`);
    } catch (err: any) {
      onFeedback(`Failed to save retention hours: ${err?.message}`);
    } finally {
      setIsBusy(false);
    }
  };

  const handleRunAction = async (action: 'scan' | 'clean_all') => {
    setIsBusy(true);
    try {
      const res = await api.runModelCleanup(action);
      setStatus(res.status);
      if (action === 'scan') {
        onFeedback(
          res.status.candidates.length > 0
            ? `Scan complete: ${res.status.candidates.length} verified duplicate(s) in Downloads (${formatBytes(
                res.status.totalReclaimableBytes
              )}).`
            : 'Scan complete: no duplicate copied models found in Downloads.'
        );
      } else {
        onFeedback(
          res.deletedFiles.length > 0
            ? `Removed ${res.deletedFiles.length} duplicate(s) from Downloads (${formatBytes(
                res.freedBytes
              )} freed). ComfyUI models untouched.`
            : 'No verified duplicate files were eligible to remove.'
        );
        if (res.deletedFiles.length > 0) {
          await onRefreshAll();
        }
      }
    } catch (err: any) {
      onFeedback(`Model cleanup error: ${err?.message || 'Request failed'}`);
    } finally {
      setIsBusy(false);
    }
  };

  const enabled = Boolean(status?.enabled);
  const candidates = status?.candidates || [];

  return (
    <section className="bg-zinc-900 border border-zinc-800 rounded-xl p-5 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <HardDrive className="w-4 h-4 text-indigo-400 shrink-0" />
          <div>
            <h2 className="text-sm font-display font-semibold text-zinc-100">
              Automatic Copied-Model Cleanup
            </h2>
            <p className="text-[11px] text-zinc-400">
              Remove Couchy&apos;s copy from <code className="font-mono text-zinc-200">{status?.downloadsDir || '/downloads'}</code> after an identical copy is verified inside ComfyUI&apos;s models folder.
            </p>
          </div>
        </div>

        <label className="inline-flex items-center gap-2.5 cursor-pointer select-none shrink-0">
          <span className="text-[11px] text-zinc-300 font-medium">
            {enabled ? 'Auto-Clean On' : 'Auto-Clean Off'}
          </span>
          <input
            type="checkbox"
            checked={enabled}
            disabled={isBusy}
            onChange={(e) => handleToggleEnabled(e.target.checked)}
            className="sr-only peer"
          />
          <div className="w-10 h-5 bg-zinc-800 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all relative peer-checked:bg-indigo-600" />
        </label>
      </div>

      {/* Safety Guarantee Notice */}
      <div className="p-3 rounded-lg bg-zinc-950/90 border border-zinc-800 flex items-start gap-2.5 text-[11px] text-zinc-300">
        <ShieldCheck className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
        <div className="space-y-1">
          <p>
            <strong className="text-zinc-100">ComfyUI models are never deleted:</strong>{' '}
            <code className="font-mono text-zinc-200">{status?.comfyuiModelsDir || '/data/models'}</code>{' '}
            is read-only. Cleanup only unlinks Couchy&apos;s duplicate in Downloads after matching{' '}
            <span className="text-zinc-100 font-medium">filename, byte size, and SHA-256 hash</span>{' '}
            (once the ComfyUI copy has been idle for 60s), while preserving all LoRA/Civitai metadata in Couchy.
          </p>
          <p className="text-zinc-400">
            Leave this <strong className="text-zinc-200">Off</strong> if ComfyUI reads directly from{' '}
            <code className="font-mono">model-downloads</code> via{' '}
            <code className="font-mono">extra_model_paths.yaml</code> without copying files over.
          </p>
        </div>
      </div>

      {status?.sameDirectoryConflict && (
        <div className="p-3 rounded-lg bg-amber-500/10 border border-amber-500/40 text-amber-300 flex items-center gap-2 text-[11px]">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          <span>
            Downloads directory and ComfyUI models directory overlap on disk. Automatic cleanup is paused for safety.
          </span>
        </div>
      )}

      {/* Retention Hours Input & Presets */}
      <div className="flex flex-wrap items-end justify-between gap-4 pt-1">
        <div className="space-y-1.5">
          <label className="block text-[11px] font-medium text-zinc-400">
            Keep Verified Copies in Downloads For (Hours)
          </label>
          <div className="flex flex-wrap items-center gap-2">
            <input
              type="number"
              min={0}
              max={8760}
              value={hoursInput}
              onChange={(e) => setHoursInput(e.target.value)}
              className="w-24 px-2.5 py-1.5 bg-zinc-950 border border-zinc-800 rounded-lg font-mono text-zinc-100 text-xs"
            />
            <button
              type="button"
              disabled={isBusy}
              onClick={() => handleSaveHours(Number(hoursInput))}
              className="px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 disabled:opacity-40 text-zinc-100 font-medium rounded-lg cursor-pointer"
            >
              Apply Hours
            </button>
            <div className="flex items-center gap-1">
              {RETENTION_PRESETS.map((h) => (
                <button
                  key={h}
                  type="button"
                  disabled={isBusy}
                  onClick={() => handleSaveHours(h)}
                  className={`px-2 py-1 rounded-md font-mono text-[11px] border cursor-pointer transition-colors ${
                    status?.retentionHours === h
                      ? 'bg-indigo-600/25 border-indigo-500/60 text-indigo-200'
                      : 'bg-zinc-950 border-zinc-800 text-zinc-400 hover:text-zinc-200'
                  }`}
                >
                  {h}h
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={isBusy}
            onClick={() => handleRunAction('scan')}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 disabled:opacity-40 text-zinc-100 font-medium rounded-lg cursor-pointer"
          >
            {isBusy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
            <span>Scan Copied Models</span>
          </button>

          <button
            type="button"
            disabled={isBusy || candidates.length === 0 || Boolean(status?.sameDirectoryConflict)}
            onClick={() => handleRunAction('clean_all')}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-rose-600/20 hover:bg-rose-600/30 border border-rose-500/40 disabled:opacity-40 text-rose-200 font-medium rounded-lg cursor-pointer disabled:cursor-not-allowed"
            title="Immediately remove all verified duplicate downloads now"
          >
            <Trash2 className="w-3.5 h-3.5" />
            <span>
              Clean Verified Now ({formatBytes(status?.totalReclaimableBytes || 0)})
            </span>
          </button>
        </div>
      </div>

      {/* Live Candidates & Status Summary */}
      <div className="border-t border-zinc-800 pt-3 space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-zinc-400">
          <span>
            Verified copies awaiting cleanup:{' '}
            <strong className="text-zinc-200">{candidates.length}</strong>{' '}
            ({formatBytes(status?.totalReclaimableBytes || 0)})
          </span>
          {status?.lastScanAt && (
            <span className="font-mono text-[10px] text-zinc-500">
              Last checked: {new Date(status.lastScanAt).toLocaleString()}
            </span>
          )}
        </div>

        {candidates.length > 0 && (
          <div className="max-h-48 overflow-y-auto space-y-1.5 pr-1">
            {candidates.map((item) => (
              <div
                key={item.downloadPath}
                className="px-3 py-2 rounded-lg bg-zinc-950 border border-zinc-800/80 flex items-center justify-between gap-3 text-[11px]"
              >
                <div className="min-w-0">
                  <div className="font-mono text-zinc-100 truncate">{item.filename}</div>
                  <div className="text-[10px] text-zinc-500 truncate">
                    {formatBytes(item.fileSize)} · Verified in ComfyUI: {item.comfyPath}
                  </div>
                </div>
                <span
                  className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full font-mono text-[10px] shrink-0 ${
                    item.isEligible
                      ? 'bg-emerald-500/15 border border-emerald-500/40 text-emerald-300'
                      : 'bg-zinc-900 border border-zinc-700 text-zinc-300'
                  }`}
                >
                  {item.isEligible ? (
                    <>
                      <CheckCircle2 className="w-3 h-3" />
                      <span>Due</span>
                    </>
                  ) : (
                    <>
                      <Clock className="w-3 h-3 text-indigo-400" />
                      <span>{item.hoursRemaining}h left</span>
                    </>
                  )}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
};
