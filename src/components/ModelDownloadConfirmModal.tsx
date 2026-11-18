import React from 'react';
import { CheckCircle2, Clock, Info } from 'lucide-react';
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
import { COMFY_SUBFOLDER_OPTIONS } from './models/downloaderUtils.ts';
import { RepoFilePickerList } from './models/RepoFilePickerList.tsx';
import { CharacterLoraDownloadOptions } from './models/CharacterLoraDownloadOptions.tsx';
import { LoraMentionDownloadOptions } from './models/LoraMentionDownloadOptions.tsx';
import type {
  CharacterDownloadAutomation,
  ComfyModelSubfolder,
  ExternalModelFileOption,
  ExternalModelSearchResult,
  LoraCategory,
  LoraMentionAutomation,
  PillTypeSettings,
} from '../shared/types.ts';

export { COMFY_SUBFOLDER_OPTIONS };

interface ModelDownloadConfirmModalProps {
  pendingDownload: ExternalModelSearchResult;
  selectedFiles: ExternalModelFileOption[];
  fileSubfolders: Record<string, ComfyModelSubfolder>;
  onToggleFile: (file: ExternalModelFileOption) => void;
  onSelectMissingFiles: () => void;
  onClearSelection: () => void;
  onChangeFileSubfolder: (rfilename: string, subfolder: ComfyModelSubfolder) => void;
  isLoadingRepoFiles: boolean;
  dlSubfolder: ComfyModelSubfolder;
  setDlSubfolder: (folder: ComfyModelSubfolder) => void;
  loraCategory: LoraCategory;
  setLoraCategory: (cat: LoraCategory) => void;
  characterAutomation?: CharacterDownloadAutomation;
  setCharacterAutomation?: (next: CharacterDownloadAutomation) => void;
  mentionAutomation?: LoraMentionAutomation;
  setMentionAutomation?: (next: LoraMentionAutomation) => void;
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
 * Confirmation modal and multi-select repository file picker for Civitai, Hugging Face, and direct downloads.
 */
export const ModelDownloadConfirmModal: React.FC<ModelDownloadConfirmModalProps> = ({
  pendingDownload,
  selectedFiles,
  fileSubfolders,
  onToggleFile,
  onSelectMissingFiles,
  onClearSelection,
  onChangeFileSubfolder,
  isLoadingRepoFiles,
  dlSubfolder,
  setDlSubfolder,
  loraCategory,
  setLoraCategory,
  characterAutomation,
  setCharacterAutomation,
  mentionAutomation,
  setMentionAutomation,
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
  const categoryStyle = resolveLoraCategoryStyle(loraCategory, pillTypeSettings);
  const availableFiles = pendingDownload.availableFiles || [];
  const showRepoPicker =
    availableFiles.length > 1 ||
    pendingDownload.provider === 'huggingface' ||
    isLoadingRepoFiles;

  const isMultiFileSelected = selectedFiles.length > 1;
  const singleFile = selectedFiles.length === 1 ? selectedFiles[0] : null;
  const requiresFilePick = showRepoPicker && availableFiles.length > 1 && selectedFiles.length === 0;

  const activeFileSize = isMultiFileSelected
    ? selectedFiles.reduce((sum, f) => sum + (f.fileSize || 0), 0)
    : singleFile
    ? singleFile.fileSize
    : pendingDownload.fileSize;
  const activeHash = singleFile
    ? singleFile.sha256Hash
    : !showRepoPicker
    ? pendingDownload.sha256Hash
    : null;

  const selectedInstalledFiles = selectedFiles.filter((f) => f.isInstalled);
  const showSingleInstalledBanner =
    !isMultiFileSelected &&
    ((singleFile && singleFile.isInstalled) ||
      (!showRepoPicker && Boolean(pendingDownload.isInstalled)));
  const showMultiInstalledBanner = isMultiFileSelected && selectedInstalledFiles.length > 0;
  const hasLoraSelection = isMultiFileSelected
    ? selectedFiles.some((f) => (fileSubfolders[f.rfilename] || f.suggestedSubfolder) === 'loras')
    : dlSubfolder === 'loras';

  const confirmDisabled =
    isSubmitting ||
    requiresFilePick ||
    (!isMultiFileSelected && !customFilename.trim()) ||
    (scheduleDownload && !scheduledForInput);

  const confirmLabel = isSubmitting
    ? scheduleDownload
      ? 'Scheduling...'
      : 'Starting...'
    : requiresFilePick
    ? 'Select File(s) to Download'
    : isMultiFileSelected
    ? scheduleDownload
      ? `Confirm & Schedule (${selectedFiles.length} Files)`
      : `Confirm & Download (${selectedFiles.length} Files)`
    : scheduleDownload
    ? 'Confirm & Schedule Download'
    : 'Confirm & Start Download';

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
              Select weight file{availableFiles.length > 1 ? 's' : ''} and destination folders. Files
              stream to a temporary <span className="font-mono text-zinc-300">.part</span> file and
              verify SHA-256 on completion.
            </p>
          </div>
          <span className="px-2 py-1 rounded bg-zinc-950 border border-zinc-800 font-mono uppercase text-[10px] text-indigo-300 shrink-0">
            {pendingDownload.provider}
          </span>
        </div>

        {/* Scrollable Body */}
        <div className="p-6 overflow-y-auto space-y-4">
          {showRepoPicker && (
            <RepoFilePickerList
              availableFiles={availableFiles}
              selectedFiles={selectedFiles}
              fileSubfolders={fileSubfolders}
              isLoadingRepoFiles={isLoadingRepoFiles}
              onToggleFile={onToggleFile}
              onSelectMissingFiles={onSelectMissingFiles}
              onClearSelection={onClearSelection}
              onChangeFileSubfolder={onChangeFileSubfolder}
            />
          )}

          {/* Selection Summary */}
          <div className="bg-zinc-950 border border-zinc-800 rounded-lg p-3.5 space-y-1 font-mono">
            <div className="text-zinc-200 truncate">Model: {pendingDownload.name}</div>
            {isMultiFileSelected ? (
              <>
                <div className="text-indigo-300">
                  Selected: {selectedFiles.length} files queued to their respective folders
                </div>
                <div className="text-zinc-400">
                  Combined Size: {(activeFileSize ?? 0) > 0 ? formatBytes(activeFileSize) : 'Unknown'}
                </div>
              </>
            ) : requiresFilePick ? (
              <div className="text-amber-300">
                Choose one or more files from the repository list above to download.
              </div>
            ) : (
              <>
                <div className="text-zinc-400 truncate">
                  Source File: {singleFile?.rfilename || pendingDownload.filename}
                </div>
                <div className="text-zinc-400">Size: {formatBytes(activeFileSize)}</div>
              </>
            )}
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

          {/* Installed File Notices */}
          {(showSingleInstalledBanner || showMultiInstalledBanner) && (
            <div className="flex items-start gap-2.5 p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/35 text-emerald-200 text-[11px]">
              <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
              <div className="space-y-0.5">
                {showMultiInstalledBanner ? (
                  <>
                    <div className="font-medium text-emerald-100">
                      {selectedInstalledFiles.length} Selected File
                      {selectedInstalledFiles.length === 1 ? ' Is' : 's Are'} Already Installed
                    </div>
                    <p className="text-emerald-200/80">
                      {selectedInstalledFiles
                        .map((f) => f.installedFilename || f.filename)
                        .join(', ')}
                      . Uncheck them or enable overwrite below to replace existing files.
                    </p>
                  </>
                ) : (
                  <>
                    <div className="font-medium text-emerald-100">
                      Already Installed Locally (
                      {singleFile?.installedFilename ||
                        pendingDownload.installedFilename ||
                        singleFile?.filename ||
                        pendingDownload.filename}
                      )
                    </div>
                    <p className="text-emerald-200/80">
                      Matched in your local model inventory
                      {(singleFile?.installedMatchReason || pendingDownload.installedMatchReason) ===
                      'hash'
                        ? ' by SHA-256 hash'
                        : (singleFile?.installedMatchReason ||
                            pendingDownload.installedMatchReason) === 'version_id'
                        ? ' by Civitai version ID'
                        : ' by filename'}
                      . Enable overwrite below if you want to replace the existing file.
                    </p>
                  </>
                )}
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

          {/* Civitai Early Access Info */}
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

          {/* Single-File Destination Folder & Save As Filename */}
          {!isMultiFileSelected && !requiresFilePick && (
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
          )}

          {hasLoraSelection && (
            <div className="space-y-2.5">
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

              {mentionAutomation && setMentionAutomation && (
                <LoraMentionDownloadOptions
                  value={mentionAutomation}
                  onChange={setMentionAutomation}
                  disabled={isSubmitting}
                />
              )}

              {!isMultiFileSelected &&
                loraCategory === 'character' &&
                !pendingDownload.isInstalled &&
                characterAutomation &&
                setCharacterAutomation && (
                  <CharacterLoraDownloadOptions
                    value={characterAutomation}
                    onChange={setCharacterAutomation}
                    disabled={isSubmitting}
                  />
                )}
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
            disabled={confirmDisabled}
            onClick={onConfirm}
            className={`px-4 py-2 disabled:opacity-50 text-white font-medium rounded-lg cursor-pointer ${
              scheduleDownload
                ? 'bg-amber-600 hover:bg-amber-500'
                : 'bg-indigo-600 hover:bg-indigo-500'
            }`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
};
