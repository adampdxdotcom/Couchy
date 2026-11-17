import React, { useCallback, useEffect, useState } from 'react';
import {
  Cpu,
  FolderUp,
  HardDrive,
  Image as ImageIcon,
  Layers,
  RefreshCw,
  Sparkles,
  Trash2,
} from 'lucide-react';
import { api } from '../../api/client.ts';
import { formatBytes } from '../../shared/utils.ts';
import type { StorageCategoryStat, StorageUsageStatsResponse } from '../../shared/types.ts';

interface StorageRowProps {
  icon: React.ReactNode;
  label: string;
  sublabel?: string;
  stat: StorageCategoryStat | undefined;
  totalBytes: number;
  barColorClass: string;
  unitSingular: string;
  unitPlural: string;
}

const StorageMetricRow: React.FC<StorageRowProps> = ({
  icon,
  label,
  sublabel,
  stat,
  totalBytes,
  barColorClass,
  unitSingular,
  unitPlural,
}) => {
  const count = stat?.count ?? 0;
  const sizeBytes = stat?.sizeBytes ?? 0;
  const unsizedCount = stat?.unsizedCount ?? 0;
  const pct = totalBytes > 0 && sizeBytes > 0 ? Math.max(2, (sizeBytes / totalBytes) * 100) : 0;

  return (
    <div className="bg-zinc-950/80 border border-zinc-800/90 rounded-xl px-3.5 py-2.5 space-y-2">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-2.5 min-w-0">
          <div className="p-1.5 rounded-lg bg-zinc-900 border border-zinc-800 shrink-0 mt-0.5">
            {icon}
          </div>
          <div className="min-w-0">
            <div className="text-xs font-medium text-zinc-100 truncate">{label}</div>
            <div className="text-[11px] text-zinc-400 tabular-nums">
              {stat
                ? `${count.toLocaleString()} ${count === 1 ? unitSingular : unitPlural}`
                : '—'}
              {unsizedCount > 0 && (
                <span className="text-amber-400/90 ml-1.5">
                  ({unsizedCount} API-only)
                </span>
              )}
            </div>
            {sublabel && (
              <div className="text-[10px] text-zinc-500 mt-0.5 truncate">{sublabel}</div>
            )}
          </div>
        </div>

        <div className="text-right shrink-0">
          <div className="text-sm font-semibold text-zinc-100 tabular-nums">
            {stat ? formatBytes(sizeBytes, '0 B') : '—'}
          </div>
          <div className="text-[10px] text-zinc-500 tabular-nums">
            {totalBytes > 0 && stat ? `${((sizeBytes / totalBytes) * 100).toFixed(1)}%` : '0.0%'}
          </div>
        </div>
      </div>

      <div className="h-1.5 w-full rounded-full bg-zinc-900 overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-300 ${barColorClass}`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
};

/**
 * Storage Usage section displayed below Generations Over Time, comparing ComfyUI cached
 * asset footprints (LoRAs, UNET/Checkpoint base models, Photos) with local workspace storage.
 */
export const StorageUsageCard: React.FC = () => {
  const [data, setData] = useState<StorageUsageStatsResponse | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const fetchStorageStats = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await api.getStorageStats();
      setData(res);
    } catch (err: any) {
      setError(err?.message || 'Failed to load storage usage stats.');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchStorageStats();
  }, [fetchStorageStats]);

  const totalTracked = data?.totalTrackedBytes ?? 0;
  const pending = data?.local.pendingDeleteModels;

  const pendingSublabel = pending
    ? pending.count === 0
      ? 'No verified duplicates queued'
      : `${pending.eligibleCount.toLocaleString()} ready now · ${pending.retentionHours}h retention`
    : undefined;

  return (
    <div className="bg-zinc-900/90 border border-zinc-800 rounded-2xl p-4 sm:p-5 space-y-4">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="flex items-start gap-2.5">
          <div className="p-2 rounded-xl bg-cyan-500/15 border border-cyan-500/30 text-cyan-300 shrink-0">
            <HardDrive className="w-4 h-4" />
          </div>
          <div>
            <h2 className="text-sm font-semibold text-zinc-100">Storage Usage</h2>
            <p className="text-[11px] text-zinc-400">
              Comfy sizes use last-scanned disk totals; local folders and thumbnails are read live.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 self-start sm:self-auto">
          <div className="px-3 py-1.5 rounded-xl bg-zinc-950 border border-zinc-800 text-[11px] text-zinc-300 tabular-nums">
            Total Tracked:{' '}
            <span className="font-semibold text-zinc-100">
              {data ? formatBytes(totalTracked, '0 B') : '—'}
            </span>
          </div>

          <button
            type="button"
            onClick={fetchStorageStats}
            disabled={isLoading}
            title="Refresh storage stats"
            className="p-2 rounded-xl bg-zinc-950 border border-zinc-800 text-zinc-400 hover:text-zinc-200 hover:border-zinc-700 disabled:opacity-50 cursor-pointer"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {error && (
        <div className="p-3 rounded-xl bg-rose-500/15 border border-rose-500/40 text-rose-200 text-xs">
          {error}
        </div>
      )}

      {/* Two-column Comfy vs Local Breakdown */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Comfy Stats */}
        <div className="bg-black/45 border border-zinc-800/90 rounded-xl p-3.5 space-y-2.5">
          <div className="flex items-center justify-between px-0.5 pb-1 border-b border-zinc-800/80">
            <span className="text-xs font-semibold uppercase tracking-wider text-indigo-300">
              Comfy Stats
            </span>
            <span className="text-xs font-semibold text-zinc-200 tabular-nums">
              {data ? formatBytes(data.comfy.totalBytes, '0 B') : '—'}
            </span>
          </div>

          <StorageMetricRow
            icon={<Sparkles className="w-3.5 h-3.5 text-indigo-400" />}
            label="LoRAs"
            stat={data?.comfy.loras}
            totalBytes={totalTracked}
            barColorClass="bg-indigo-500"
            unitSingular="LoRA"
            unitPlural="LoRAs"
          />

          <StorageMetricRow
            icon={<Cpu className="w-3.5 h-3.5 text-violet-400" />}
            label="Base Models (UNET & Checkpoint)"
            stat={data?.comfy.baseModels}
            totalBytes={totalTracked}
            barColorClass="bg-violet-500"
            unitSingular="model"
            unitPlural="models"
          />

          <StorageMetricRow
            icon={<ImageIcon className="w-3.5 h-3.5 text-cyan-400" />}
            label="Photos"
            stat={data?.comfy.photos}
            totalBytes={totalTracked}
            barColorClass="bg-cyan-400"
            unitSingular="photo"
            unitPlural="photos"
          />
        </div>

        {/* Local Storage Stats */}
        <div className="bg-black/45 border border-zinc-800/90 rounded-xl p-3.5 space-y-2.5">
          <div className="flex items-center justify-between px-0.5 pb-1 border-b border-zinc-800/80">
            <span className="text-xs font-semibold uppercase tracking-wider text-emerald-300">
              Local Storage Stats
            </span>
            <span className="text-xs font-semibold text-zinc-200 tabular-nums">
              {data ? formatBytes(data.local.totalBytes, '0 B') : '—'}
            </span>
          </div>

          <StorageMetricRow
            icon={<FolderUp className="w-3.5 h-3.5 text-emerald-400" />}
            label="Imported Images"
            sublabel="Inspector & inspiration references"
            stat={data?.local.importedImages}
            totalBytes={totalTracked}
            barColorClass="bg-emerald-500"
            unitSingular="image"
            unitPlural="images"
          />

          <StorageMetricRow
            icon={<Layers className="w-3.5 h-3.5 text-teal-400" />}
            label="Thumbnails"
            stat={data?.local.thumbnails}
            totalBytes={totalTracked}
            barColorClass="bg-teal-400"
            unitSingular="thumbnail"
            unitPlural="thumbnails"
          />

          <StorageMetricRow
            icon={<Trash2 className="w-3.5 h-3.5 text-amber-400" />}
            label="Local Models (Waiting Cleanup)"
            sublabel={pendingSublabel}
            stat={data?.local.pendingDeleteModels}
            totalBytes={totalTracked}
            barColorClass="bg-amber-400"
            unitSingular="model"
            unitPlural="models"
          />
        </div>
      </div>
    </div>
  );
};
