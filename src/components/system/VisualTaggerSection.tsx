import React from 'react';
import {
  AlertTriangle,
  Cpu,
  Pause,
  Play,
  RefreshCw,
  Tags,
} from 'lucide-react';
import { formatMb } from '../../shared/utils.ts';
import type { VisualTaggerStatus } from '../../shared/types.ts';

interface VisualTaggerSectionProps {
  taggerStatus: VisualTaggerStatus | null;
  isUpdatingTagger: boolean;
  onToggleVisualTagger: (enabled: boolean) => Promise<void>;
  onTaggerConfigChange: (payload: { threshold?: number; device?: 'cpu' | 'gpu' }) => Promise<void>;
  onTaggerControl: (action: 'pause' | 'resume' | 'scan_unindexed' | 'rescan_all') => Promise<void>;
}

export const VisualTaggerSection: React.FC<VisualTaggerSectionProps> = ({
  taggerStatus,
  isUpdatingTagger,
  onToggleVisualTagger,
  onTaggerConfigChange,
  onTaggerControl,
}) => {
  const scanPct =
    taggerStatus && taggerStatus.totalImagesCount > 0
      ? Math.min(
          100,
          Math.round((taggerStatus.scannedCount / taggerStatus.totalImagesCount) * 100)
        )
      : 0;

  return (
    <section className="bg-zinc-900 border border-zinc-800 rounded-xl p-5 space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-4 border-b border-zinc-800 pb-4">
        <div className="flex items-start gap-2.5 max-w-3xl">
          <Tags className="w-4 h-4 text-indigo-400 mt-0.5 shrink-0" />
          <div className="space-y-1">
            <h2 className="text-sm font-display font-semibold text-zinc-100">
              Visual Keyword Tagging &amp; Search Indexer (WD14 v3 ONNX)
            </h2>
            <p className="text-zinc-400">
              Scans images with a lightweight vision tagger to extract searchable visual keywords (clothing, hair, lighting, setting, composition) even when hidden inside LoRA trigger words.
            </p>
          </div>
        </div>

        <label className="inline-flex items-center gap-3 cursor-pointer select-none shrink-0">
          <span className="text-zinc-300 font-medium">
            {taggerStatus?.enabled ? 'Enabled' : 'Disabled'}
          </span>
          <input
            type="checkbox"
            disabled={isUpdatingTagger}
            checked={Boolean(taggerStatus?.enabled)}
            onChange={(e) => onToggleVisualTagger(e.target.checked)}
            className="sr-only peer"
          />
          <div className="w-10 h-5 bg-zinc-800 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all relative peer-checked:bg-indigo-600" />
        </label>
      </div>

      {/* First-time download & large library duration note */}
      <div className="p-3.5 bg-amber-500/10 border border-amber-500/30 rounded-lg flex items-start gap-2.5 text-amber-200/90">
        <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
        <div className="space-y-1 text-xs leading-relaxed">
          <p className="font-medium text-amber-200">
            On-Demand Model Download &amp; Large Library Indexing Notice
          </p>
          <p className="text-amber-200/80">
            No model is downloaded until you turn this toggle on. When enabled for the first time, the app downloads the ~360 MB ONNX vision tagger into{' '}
            <code className="font-mono text-amber-100">
              {taggerStatus?.localModelsDir || 'data/local_models/wd-vit-tagger-v3'}
            </code>{' '}
            and begins indexing your gallery thumbnails in the background. For large libraries (2,000 to 20,000+ images), the initial scan can take a while—you can continue using the app normally or pause/resume anytime.
          </p>
        </div>
      </div>

      {/* Model Download Progress Bar (when downloading) */}
      {taggerStatus?.isDownloading && (
        <div className="p-3.5 bg-zinc-950 border border-indigo-500/40 rounded-lg space-y-2">
          <div className="flex items-center justify-between text-xs">
            <span className="text-indigo-300 font-medium flex items-center gap-2">
              <RefreshCw className="w-3.5 h-3.5 animate-spin" />
              <span>Downloading WD14 v3 ONNX model to data/local_models...</span>
            </span>
            <span className="font-mono tabular-nums text-zinc-300">
              {formatMb(taggerStatus.downloadedBytes)} / {formatMb(taggerStatus.totalDownloadBytes)} ({taggerStatus.downloadProgressPercent}%)
            </span>
          </div>
          <div className="w-full h-2 bg-zinc-800 rounded-full overflow-hidden">
            <div
              className="h-full bg-indigo-500 transition-all duration-300"
              style={{ width: `${taggerStatus.downloadProgressPercent}%` }}
            />
          </div>
        </div>
      )}

      {taggerStatus?.downloadError && (
        <div className="p-3 bg-rose-950/50 border border-rose-800 rounded-lg text-rose-200">
          Download Error: {taggerStatus.downloadError}
        </div>
      )}

      {/* Controls & Live Indexing Status */}
      {taggerStatus && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-center pt-1">
          {/* Progress & Counts */}
          <div className="lg:col-span-6 bg-zinc-950 border border-zinc-800 rounded-lg p-3.5 space-y-2">
            <div className="flex items-center justify-between text-xs">
              <span className="text-zinc-300 font-medium">
                Gallery Indexing Progress{' '}
                {taggerStatus.isScanning ? (
                  <span className="text-indigo-400 font-mono ml-1">(Scanning...)</span>
                ) : taggerStatus.isPaused && taggerStatus.pendingCount > 0 ? (
                  <span className="text-amber-400 font-mono ml-1">(Paused)</span>
                ) : null}
              </span>
              <span className="font-mono tabular-nums text-zinc-200">
                {taggerStatus.scannedCount.toLocaleString()} /{' '}
                {taggerStatus.totalImagesCount.toLocaleString()} images ({scanPct}%)
              </span>
            </div>

            <div className="w-full h-2 bg-zinc-800 rounded-full overflow-hidden">
              <div
                className="h-full bg-indigo-500 transition-all duration-300"
                style={{ width: `${scanPct}%` }}
              />
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-zinc-400 font-mono tabular-nums pt-0.5">
              <span>
                Model: {taggerStatus.modelDownloaded ? 'Ready on disk' : 'Not downloaded yet'}
              </span>
              <span>·</span>
              <span>
                Extracted Keywords: {taggerStatus.totalVisualTagsCount.toLocaleString()}
              </span>
              <span>·</span>
              <span>Pending: {taggerStatus.pendingCount.toLocaleString()}</span>
            </div>
          </div>

          {/* Threshold, Device & Queue Action Buttons */}
          <div className="lg:col-span-6 grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="bg-zinc-950 border border-zinc-800 rounded-lg p-3 space-y-1.5">
              <div className="flex items-center justify-between">
                <label className="text-zinc-300 font-medium">Confidence Threshold</label>
                <span className="font-mono tabular-nums text-indigo-400 font-semibold">
                  {taggerStatus.threshold.toFixed(2)}
                </span>
              </div>
              <input
                type="range"
                min="0.15"
                max="0.80"
                step="0.05"
                value={taggerStatus.threshold}
                onChange={(e) =>
                  onTaggerConfigChange({ threshold: parseFloat(e.target.value) })
                }
                className="w-full accent-indigo-500 cursor-pointer"
              />
              <p className="text-[11px] text-zinc-500">
                Lower values add more tags; higher values keep only high-certainty tags.
              </p>
            </div>

            <div className="bg-zinc-950 border border-zinc-800 rounded-lg p-3 space-y-2 flex flex-col justify-between">
              <div className="flex items-center justify-between gap-2">
                <span className="text-zinc-300 font-medium flex items-center gap-1.5">
                  <Cpu className="w-3.5 h-3.5 text-zinc-400" />
                  <span>Execution Device</span>
                </span>
                <select
                  value={taggerStatus.device}
                  onChange={(e) =>
                    onTaggerConfigChange({
                      device: e.target.value === 'gpu' ? 'gpu' : 'cpu',
                    })
                  }
                  className="px-2 py-1 bg-zinc-900 border border-zinc-700 rounded text-xs font-mono text-zinc-100"
                >
                  <option value="cpu">CPU (Default)</option>
                  <option value="gpu">GPU (CUDA if passed)</option>
                </select>
              </div>

              <div className="flex flex-wrap items-center gap-1.5 pt-1">
                {taggerStatus.isScanning ? (
                  <button
                    type="button"
                    onClick={() => onTaggerControl('pause')}
                    className="inline-flex items-center gap-1 px-2.5 py-1 bg-amber-600/20 hover:bg-amber-600/30 text-amber-300 border border-amber-500/30 rounded-md font-medium cursor-pointer"
                  >
                    <Pause className="w-3 h-3" />
                    <span>Pause</span>
                  </button>
                ) : (
                  <button
                    type="button"
                    disabled={!taggerStatus.enabled}
                    onClick={() => onTaggerControl('scan_unindexed')}
                    className="inline-flex items-center gap-1 px-2.5 py-1 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white rounded-md font-medium cursor-pointer"
                  >
                    <Play className="w-3 h-3" />
                    <span>Scan Pending</span>
                  </button>
                )}

                <button
                  type="button"
                  disabled={!taggerStatus.enabled || taggerStatus.isDownloading}
                  onClick={() => onTaggerControl('rescan_all')}
                  className="inline-flex items-center gap-1 px-2.5 py-1 bg-zinc-800 hover:bg-zinc-700 disabled:opacity-40 text-zinc-200 rounded-md font-medium cursor-pointer"
                  title="Re-run visual keyword extraction across all images"
                >
                  <RefreshCw className="w-3 h-3" />
                  <span>Rescan All</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </section>
  );
};
