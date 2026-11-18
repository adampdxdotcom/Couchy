import React, { useMemo, useState } from 'react';
import { CheckCircle2, FolderGit2, Loader2, Search } from 'lucide-react';
import { formatBytes } from '../../shared/utils.ts';
import { COMFY_SUBFOLDER_OPTIONS } from './downloaderUtils.ts';
import type { ComfyModelSubfolder, ExternalModelFileOption } from '../../shared/types.ts';

interface RepoFilePickerListProps {
  availableFiles: ExternalModelFileOption[];
  selectedFiles: ExternalModelFileOption[];
  fileSubfolders: Record<string, ComfyModelSubfolder>;
  isLoadingRepoFiles: boolean;
  onToggleFile: (file: ExternalModelFileOption) => void;
  onSelectMissingFiles: () => void;
  onClearSelection: () => void;
  onChangeFileSubfolder: (rfilename: string, subfolder: ComfyModelSubfolder) => void;
}

/**
 * Multi-select file picker for multi-file Hugging Face repositories and Civitai versions,
 * showing per-file local install status and destination folder overrides.
 */
export const RepoFilePickerList: React.FC<RepoFilePickerListProps> = ({
  availableFiles,
  selectedFiles,
  fileSubfolders,
  isLoadingRepoFiles,
  onToggleFile,
  onSelectMissingFiles,
  onClearSelection,
  onChangeFileSubfolder,
}) => {
  const [fileFilter, setFileFilter] = useState('');

  const filteredFiles = useMemo(() => {
    if (!fileFilter.trim()) return availableFiles;
    const q = fileFilter.toLowerCase();
    return availableFiles.filter(
      (f) =>
        f.rfilename.toLowerCase().includes(q) ||
        (fileSubfolders[f.rfilename] || f.suggestedSubfolder).toLowerCase().includes(q)
    );
  }, [availableFiles, fileFilter, fileSubfolders]);

  const selectedKeys = useMemo(
    () => new Set(selectedFiles.map((f) => f.rfilename)),
    [selectedFiles]
  );

  const selectedBytes = useMemo(
    () => selectedFiles.reduce((sum, f) => sum + (f.fileSize || 0), 0),
    [selectedFiles]
  );

  const missingCount = useMemo(
    () => availableFiles.filter((f) => !f.isInstalled).length,
    [availableFiles]
  );
  const installedCount = availableFiles.length - missingCount;
  const isMultiSelected = selectedFiles.length > 1;

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <label className="font-medium text-zinc-200 flex items-center gap-1.5">
          <FolderGit2 className="w-3.5 h-3.5 text-indigo-400" />
          <span>
            Select Weight File{availableFiles.length > 1 ? 's' : ''} ({availableFiles.length}{' '}
            {availableFiles.length === 1 ? 'file' : 'files'}
            {installedCount > 0 ? ` · ${installedCount} installed` : ''})
          </span>
        </label>

        <div className="flex items-center gap-2">
          {isLoadingRepoFiles && (
            <span className="inline-flex items-center gap-1 text-[11px] text-indigo-300">
              <Loader2 className="w-3 h-3 animate-spin" />
              <span>Loading repo tree &amp; LFS hashes...</span>
            </span>
          )}
          {availableFiles.length > 1 && missingCount > 0 && selectedFiles.length < missingCount && (
            <button
              type="button"
              onClick={onSelectMissingFiles}
              className="px-2 py-0.5 rounded bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-[11px] text-zinc-200 cursor-pointer"
            >
              Select Missing ({missingCount})
            </button>
          )}
          {selectedFiles.length > 0 && availableFiles.length > 1 && (
            <button
              type="button"
              onClick={onClearSelection}
              className="px-2 py-0.5 rounded bg-zinc-900 hover:bg-zinc-800 border border-zinc-700 text-[11px] text-zinc-400 hover:text-zinc-200 cursor-pointer"
            >
              Clear ({selectedFiles.length}
              {selectedBytes > 0 ? ` · ${formatBytes(selectedBytes)}` : ''})
            </button>
          )}
        </div>
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

      <div className="max-h-56 overflow-y-auto border border-zinc-800 rounded-lg divide-y divide-zinc-800/70 bg-zinc-950">
        {filteredFiles.map((file) => {
          const isSelected = selectedKeys.has(file.rfilename);
          const effectiveFolder = fileSubfolders[file.rfilename] || file.suggestedSubfolder;
          return (
            <div
              key={file.rfilename}
              className={`px-3 py-2 flex items-center justify-between gap-3 transition-colors ${
                isSelected ? 'bg-indigo-600/20 text-zinc-100' : 'hover:bg-zinc-900 text-zinc-300'
              }`}
            >
              <label className="min-w-0 flex-1 flex items-center gap-2.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={isSelected}
                  onChange={() => onToggleFile(file)}
                  className="rounded border-zinc-600 bg-zinc-900 text-indigo-500 focus:ring-indigo-500 cursor-pointer shrink-0"
                />
                <span className="truncate font-mono text-[11px]" title={file.rfilename}>
                  {file.rfilename}
                </span>
                {file.isInstalled && (
                  <span
                    title={`Installed locally as ${file.installedFilename || file.filename}${
                      file.installedMatchReason === 'hash'
                        ? ' (matched by SHA-256)'
                        : ' (matched by filename)'
                    }`}
                    className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-emerald-500/15 border border-emerald-500/35 text-emerald-300 font-mono text-[10px] shrink-0"
                  >
                    <CheckCircle2 className="w-3 h-3" />
                    <span>Installed</span>
                  </span>
                )}
              </label>

              <div className="flex items-center gap-2 shrink-0 font-mono text-[10px]">
                {isSelected && isMultiSelected ? (
                  <select
                    value={effectiveFolder}
                    onChange={(e) =>
                      onChangeFileSubfolder(file.rfilename, e.target.value as ComfyModelSubfolder)
                    }
                    aria-label={`Destination folder for ${file.filename}`}
                    className="px-1.5 py-0.5 rounded bg-zinc-900 border border-indigo-500/50 text-indigo-200 cursor-pointer focus:outline-none"
                  >
                    {COMFY_SUBFOLDER_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        /{opt.value}
                      </option>
                    ))}
                  </select>
                ) : (
                  <span className="px-1.5 py-0.5 rounded bg-zinc-900 border border-zinc-800 text-indigo-300">
                    /{effectiveFolder}
                  </span>
                )}
                <span className="text-zinc-400 tabular-nums w-16 text-right">
                  {formatBytes(file.fileSize)}
                </span>
              </div>
            </div>
          );
        })}
        {filteredFiles.length === 0 && !isLoadingRepoFiles && (
          <div className="p-3 text-center text-zinc-500">
            No files match &ldquo;{fileFilter}&rdquo;.
          </div>
        )}
      </div>
    </div>
  );
};
