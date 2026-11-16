import React, { useMemo, useState } from 'react';
import { Check, CheckCircle2, Clock, FileCode2, FolderGit2, Info, Loader2, Search } from 'lucide-react';
import { formatBytes } from '../shared/utils.ts';
import {
  DEFAULT_PILL_TYPE_SETTINGS,
  LORA_CATEGORY_OPTIONS,
  resolveLoraCategoryStyle,
} from '../shared/pillSettings.ts';
import {
  formatUnlockCountdown,
  formatUnlockLocalTime,
} from './models/earlyAccessUtils.ts';
import type {
  ComfyModelSubfolder,
  ExternalModelFileOption,
  ExternalModelSearchResult,
  LoraCategory,
  ModelType,
  PillTypeSettings,
} from '../shared/types.ts';

export const COMFY_SUBFOLDER_OPTIONS: {
  value: ComfyModelSubfolder;
  label: string;
  modelType: ModelType;
}[] = [
  { value: 'loras', label: '/downloads/loras — LoRA / LoCon / DoRA', modelType: 'lora' },
  {
    value: 'checkpoints',
    label: '/downloads/checkpoints — All-in-One Checkpoints (UNET + CLIP + VAE)',
    modelType: 'checkpoint',
  },
  {
    value: 'diffusion_models',
    label: '/downloads/diffusion_models — Standalone UNET / DiT / GGUF',
    modelType: 'diffusion',
  },
  {
    value: 'unet',
    label: '/downloads/unet — Standalone UNET (Legacy ComfyUI alias)',
    modelType: 'diffusion',
  },
  {
    value: 'text_encoders',
    label: '/downloads/text_encoders — CLIP / T5 / DualCLIP Text Encoders',
    modelType: 'clip',
  },
  {
    value: 'clip',
    label: '/downloads/clip — CLIP Text Encoders (Legacy ComfyUI alias)',
    modelType: 'clip',
  },
  { value: 'vae', label: '/downloads/vae — VAE Models', modelType: 'vae' },
  {
    value: 'controlnet',
    label: '/downloads/controlnet — ControlNet / IP-Adapter',
    modelType: 'controlnet',
  },
  {
    value: 'upscale_models',
    label: '/downloads/upscale_models — Upscalers (ESRGAN / SwinIR)',
    modelType: 'upscaler',
  },
  {
    value: 'embeddings',
    label: '/downloads/embeddings — Textual Inversion Embeddings',
    modelType: 'embedding',
  },
];

interface ModelDownloadConfirmModalProps {
  pendingDownload: ExternalModelSearchResult;
  selectedFile: ExternalModelFileOption | null;
  onSelectFile: (file: ExternalModelFileOption) => void;
  isLoadingRepoFiles: boolean;
  dlSubfolder: ComfyModelSubfolder;
  setDlSubfolder: (folder: ComfyModelSubfolder) => void;
  loraCategory: LoraCategory;
  setLoraCategory: (cat: LoraCategory) => void;
  pillTypeSettings?: PillTypeSettings;
  customFilename: string;
  setCustomFilename: (name: string) => void;
  allowOverwrite: boolean;
  setAllowOverwrite: (allow: boolean) => void;
  scheduleDownload: boolean;
  setScheduleDownload: (schedule: boolean) => void;
  scheduledForInput: string;
  setScheduledForInput: (val: string) => void;
  dlError: string | null;
  isSubmitting: boolean;
  onClose: () => void;
  onConfirm: () => Promise<void>;
}

/**
 * Confirmation modal and multi-file repository picker for Civitai, Hugging Face, and direct URL downloads.
 */
export const ModelDownloadConfirmModal: React.FC<ModelDownloadConfirmModalProps> = ({
  pendingDownload,
  selectedFile,
  onSelectFile,
  isLoadingRepoFiles,
  dlSubfolder,
  setDlSubfolder,
  loraCategory,
  setLoraCategory,
  pillTypeSettings = DEFAULT_PILL_TYPE_SETTINGS,
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
  onClose,
  onConfirm,
}) => {
  const [fileFilter, setFileFilter] = useState('');
  const categoryStyle = resolveLoraCategoryStyle(loraCategory, pillTypeSettings);

  const availableFiles = pendingDownload.availableFiles || [];
  const filteredFiles = useMemo(() => {
    if (!fileFilter.trim()) return availableFiles;
    const q = fileFilter.toLowerCase();
    return availableFiles.filter(
      (f) =>
        f.rfilename.toLowerCase().includes(q) ||
        f.suggestedSubfolder.toLowerCase().includes(q)
    );
  }, [availableFiles, fileFilter]);

  const activeFileSize = selectedFile ? selectedFile.fileSize : pendingDownload.fileSize;
  const activeHash = selectedFile ? selectedFile.sha256Hash : pendingDownload.sha256Hash;

  return (
    <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4">
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl max-w-2xl w-full max-h-[90vh] flex flex-col overflow-hidden text-xs">
        {/* Header */}
        <div className="px-6 py-4 border-b border-zinc-800 flex items-center justify-between gap-4">
          <div>
            <h3 className="text-base font-display font-semibold text-zinc-100">
              Confirm Server-Side Model Download
            </h3>
            <p className="text-zinc-400">
              Select the weight file and target ComfyUI folder. Files stream to a temporary{' '}
              <span className="font-mono text-zinc-300">.part</span> file and verify SHA-256 on completion.
            </p>
          </div>
          <span className="px-2 py-1 rounded bg-zinc-950 border border-zinc-800 font-mono uppercase text-[10px] text-indigo-300 shrink-0">
            {pendingDownload.provider}
          </span>
        </div>

        {/* Scrollable Body */}
        <div className="p-6 overflow-y-auto space-y-4">
          {/* Multi-file Repository / Version File Picker */}
          {(availableFiles.length > 1 ||
            pendingDownload.provider === 'huggingface' ||
            isLoadingRepoFiles) && (
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <label className="font-medium text-zinc-200 flex items-center gap-1.5">
                  <FolderGit2 className="w-3.5 h-3.5 text-indigo-400" />
                  <span>
                    Select Weight File ({availableFiles.length}{' '}
                    {availableFiles.length === 1 ? 'file' : 'files'})
                  </span>
                </label>
                {isLoadingRepoFiles && (
                  <span className="inline-flex items-center gap-1 text-[11px] text-indigo-300">
                    <Loader2 className="w-3 h-3 animate-spin" />
                    <span>Loading repo tree &amp; LFS hashes...</span>
                  </span>
                )}
              </div>

              {availableFiles.length > 4 && (
                <div className="relative">
                  <Search className="w-3.5 h-3.5 text-zinc-500 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    value={fileFilter}
                    onChange={(e) => setFileFilter(e.target.value)}
                    placeholder="Filter files in repository (e.g. fp8, q8_0, t5xxl, vae)..."
                    className="w-full pl-8 pr-3 py-1.5 bg-zinc-950 border border-zinc-800 rounded-lg text-zinc-100"
                  />
                </div>
              )}

              <div className="max-h-52 overflow-y-auto border border-zinc-800 rounded-lg divide-y divide-zinc-800/70 bg-zinc-950">
                {filteredFiles.map((file) => {
                  const isSelected =
                    selectedFile?.rfilename === file.rfilename ||
                    (!selectedFile && file.filename === pendingDownload.filename);
                  return (
                    <button
                      key={file.rfilename}
                      type="button"
                      onClick={() => onSelectFile(file)}
                      className={`w-full text-left px-3 py-2 flex items-center justify-between gap-3 transition-colors cursor-pointer ${
                        isSelected
                          ? 'bg-indigo-600/20 text-zinc-100'
                          : 'hover:bg-zinc-900 text-zinc-300'
                      }`}
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5 font-mono text-[11px] truncate">
                          {isSelected ? (
                            <Check className="w-3.5 h-3.5 text-indigo-400 shrink-0" />
                          ) : (
                            <FileCode2 className="w-3.5 h-3.5 text-zinc-600 shrink-0" />
                          )}
                          <span className="truncate" title={file.rfilename}>
                            {file.rfilename}
                          </span>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 shrink-0 font-mono text-[10px]">
                        <span className="px-1.5 py-0.5 rounded bg-zinc-900 border border-zinc-800 text-indigo-300">
                          {file.suggestedSubfolder}
                        </span>
                        <span className="text-zinc-400 tabular-nums">
                          {formatBytes(file.fileSize)}
                        </span>
                      </div>
                    </button>
                  );
                })}
                {filteredFiles.length === 0 && !isLoadingRepoFiles && (
                  <div className="p-3 text-center text-zinc-500">
                    No files match &ldquo;{fileFilter}&rdquo;.
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Selected File Summary */}
          <div className="bg-zinc-950 border border-zinc-800 rounded-lg p-3.5 space-y-1 font-mono">
            <div className="text-zinc-200 truncate">Model: {pendingDownload.name}</div>
            <div className="text-zinc-400 truncate">
              Source File: {selectedFile?.rfilename || pendingDownload.filename}
            </div>
            <div className="text-zinc-400">Size: {formatBytes(activeFileSize)}</div>
            {pendingDownload.baseModel && (
              <div className="text-indigo-300">Base Model: {pendingDownload.baseModel}</div>
            )}
            {pendingDownload.trainedWords && pendingDownload.trainedWords.length > 0 && (
              <div className="text-amber-300 truncate">
                Triggers: {pendingDownload.trainedWords.join(', ')}
              </div>
            )}
            {pendingDownload.recommendedWeight !== null &&
              pendingDownload.recommendedWeight !== undefined && (
                <div className="text-indigo-300">
                  Rec. Weight: {pendingDownload.recommendedWeight.toFixed(2)}x
                </div>
              )}
            {activeHash && (
              <div className="text-emerald-400 truncate">SHA256: {activeHash}</div>
            )}
          </div>

          {/* Already Installed Locally Notice */}
          {pendingDownload.isInstalled && (
            <div className="flex items-start gap-2.5 p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/35 text-emerald-200 text-[11px]">
              <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
              <div className="space-y-0.5">
                <div className="font-medium text-emerald-100">
                  Already Installed Locally
                  {pendingDownload.installedFilename
                    ? ` (${pendingDownload.installedFilename})`
                    : ''}
                </div>
                <p className="text-emerald-200/80">
                  Matched in your local model inventory
                  {pendingDownload.installedMatchReason === 'hash'
                    ? ' by SHA-256 hash'
                    : pendingDownload.installedMatchReason === 'version_id'
                    ? ' by Civitai version ID'
                    : ' by filename'}
                  . Enable overwrite below if you want to replace the existing file.
                </p>
              </div>
            </div>
          )}

          {/* UNET vs Checkpoint Hint if present */}
          {pendingDownload.subfolderHint && (
            <div className="flex items-start gap-2 p-3 rounded-lg bg-indigo-500/10 border border-indigo-500/30 text-indigo-200 text-[11px]">
              <Info className="w-4 h-4 text-indigo-400 shrink-0 mt-0.5" />
              <span>{pendingDownload.subfolderHint}</span>
            </div>
          )}

          {/* Civitai Early Access Info & Delayed Schedule Option */}
          {pendingDownload.isEarlyAccessActive && (
            <div className="flex items-start gap-2.5 p-3 rounded-lg bg-amber-500/10 border border-amber-500/35 text-amber-200 text-[11px]">
              <Clock className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
              <div className="space-y-1">
                <div className="font-medium text-amber-100">
                  Civitai Early Access Active
                  {pendingDownload.earlyAccessEndsAt
                    ? ` · Unlocks ${formatUnlockLocalTime(pendingDownload.earlyAccessEndsAt)} (${formatUnlockCountdown(pendingDownload.earlyAccessEndsAt)})`
                    : ''}
                </div>
                <p className="text-amber-200/80">
                  Immediate downloads may return HTTP 403 unless unlocked with Buzz on your Civitai account
                  {typeof pendingDownload.earlyAccessConfig?.downloadPrice === 'number'
                    ? ` (${pendingDownload.earlyAccessConfig.downloadPrice} Buzz)`
                    : ''}
                  . Scheduling automatically starts once early access ends.
                </p>
              </div>
            </div>
          )}

          {/* Destination Subfolder & Filename */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-zinc-300 font-medium mb-1">
                ComfyUI Destination Folder
              </label>
              <select
                value={dlSubfolder}
                onChange={(e) => setDlSubfolder(e.target.value as ComfyModelSubfolder)}
                className="w-full px-3 py-2 bg-zinc-950 border border-zinc-800 rounded-lg text-zinc-100"
              >
                {COMFY_SUBFOLDER_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-zinc-300 font-medium mb-1">Save As Filename</label>
              <input
                type="text"
                value={customFilename}
                onChange={(e) => setCustomFilename(e.target.value)}
                className="w-full px-3 py-2 bg-zinc-950 border border-zinc-800 rounded-lg font-mono text-zinc-100"
              />
            </div>
          </div>

          {dlSubfolder === 'loras' && (
            <div className="flex flex-wrap items-center justify-between gap-3 bg-zinc-950/70 border border-zinc-800 rounded-lg px-3.5 py-2.5">
              <div className="flex items-center gap-2">
                <span className={`w-2 h-2 rounded-full ${categoryStyle.swatchBg}`} />
                <label className="text-zinc-300 font-medium">LoRA Category</label>
                {pendingDownload.suggestedLoraCategory &&
                  pendingDownload.suggestedLoraCategory !== 'unclassified' &&
                  loraCategory === pendingDownload.suggestedLoraCategory && (
                    <span
                      className={`px-1.5 py-0.5 rounded border text-[10px] font-mono ${categoryStyle.badge}`}
                    >
                      Auto-detected
                    </span>
                  )}
              </div>
              <select
                value={loraCategory}
                onChange={(e) => setLoraCategory(e.target.value as LoraCategory)}
                aria-label="LoRA Category before download"
                className="px-3 py-1.5 bg-zinc-900 border border-zinc-700 rounded-lg text-zinc-100 cursor-pointer focus:outline-none focus:border-indigo-500"
              >
                {LORA_CATEGORY_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div className="space-y-2.5 pt-1">
            <label className="inline-flex items-center gap-2 text-zinc-300 cursor-pointer">
              <input
                type="checkbox"
                checked={scheduleDownload}
                onChange={(e) => setScheduleDownload(e.target.checked)}
              />
              <span>
                {pendingDownload.isEarlyAccessActive
                  ? 'Schedule download until Early Access unlocks'
                  : 'Schedule download for a later time'}
              </span>
            </label>

            {scheduleDownload && (
              <div className="pl-5 flex flex-wrap items-center gap-2">
                <label className="text-zinc-400">Run at (local time):</label>
                <input
                  type="datetime-local"
                  value={scheduledForInput}
                  onChange={(e) => setScheduledForInput(e.target.value)}
                  className="px-2.5 py-1.5 bg-zinc-950 border border-zinc-800 rounded-lg font-mono text-zinc-100"
                />
              </div>
            )}

            <div>
              <label className="inline-flex items-center gap-2 text-zinc-300 cursor-pointer">
                <input
                  type="checkbox"
                  checked={allowOverwrite}
                  onChange={(e) => setAllowOverwrite(e.target.checked)}
                />
                <span>Explicitly allow overwriting if file already exists in destination folder</span>
              </label>
            </div>
          </div>

          {dlError && <p className="text-rose-400 font-medium">{dlError}</p>}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-zinc-800 flex justify-end gap-2 bg-zinc-950/50">
          <button
            type="button"
            onClick={onClose}
            className="px-3.5 py-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded-lg cursor-pointer"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={isSubmitting || !customFilename.trim() || (scheduleDownload && !scheduledForInput)}
            onClick={onConfirm}
            className={`px-4 py-2 disabled:opacity-50 text-white font-medium rounded-lg cursor-pointer ${
              scheduleDownload
                ? 'bg-amber-600 hover:bg-amber-500'
                : 'bg-indigo-600 hover:bg-indigo-500'
            }`}
          >
            {isSubmitting
              ? scheduleDownload
                ? 'Scheduling...'
                : 'Starting...'
              : scheduleDownload
              ? 'Confirm & Schedule Download'
              : 'Confirm & Start Download'}
          </button>
        </div>
      </div>
    </div>
  );
};
