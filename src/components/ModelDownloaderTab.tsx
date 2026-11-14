import React, { useState } from 'react';
import {
  CheckCircle2,
  ExternalLink,
  FileWarning,
  FolderGit2,
  HardDriveDownload,
  Layers,
  Link2,
  Loader2,
} from 'lucide-react';
import { api } from '../api/client.ts';
import { formatBytes } from '../shared/utils.ts';
import {
  COMFY_SUBFOLDER_OPTIONS,
  ModelDownloadConfirmModal,
} from './ModelDownloadConfirmModal.tsx';
import type {
  ComfyModelSubfolder,
  ExternalModelFileOption,
  ExternalModelSearchResult,
  ModelType,
} from '../shared/types.ts';

interface ModelDownloaderTabProps {
  provider: 'civitai' | 'huggingface';
  setProvider: (p: 'civitai' | 'huggingface') => void;
  extQuery: string;
  setExtQuery: (q: string) => void;
  extTypeFilter: string;
  setExtTypeFilter: (t: string) => void;
  searchResults: ExternalModelSearchResult[];
  isSearchingExt: boolean;
  searchError: string | null;
  downloads: any[];
  onSearch: (e?: React.FormEvent, customQ?: string) => Promise<void>;
  onRefreshDownloads: () => Promise<void>;
  onPushToast?: (text: string, type?: 'info' | 'success' | 'warning' | 'error') => void;
}

function getDefaultSubfolderForItem(item: ExternalModelSearchResult): ComfyModelSubfolder {
  if (item.suggestedSubfolder) return item.suggestedSubfolder;
  switch (item.modelType) {
    case 'lora':
      return 'loras';
    case 'checkpoint':
      return 'checkpoints';
    case 'diffusion':
      return 'diffusion_models';
    case 'clip':
      return 'text_encoders';
    case 'vae':
      return 'vae';
    case 'controlnet':
      return 'controlnet';
    case 'upscaler':
      return 'upscale_models';
    case 'embedding':
      return 'embeddings';
    default:
      return 'checkpoints';
  }
}

/**
 * Civitai, Hugging Face Hub, and Direct URL Model Downloader with multi-file repo picker
 * and full ComfyUI destination folder support.
 */
export const ModelDownloaderTab: React.FC<ModelDownloaderTabProps> = ({
  provider,
  setProvider,
  extQuery,
  setExtQuery,
  extTypeFilter,
  setExtTypeFilter,
  searchResults,
  isSearchingExt,
  searchError,
  downloads,
  onSearch,
  onRefreshDownloads,
  onPushToast,
}) => {
  const [directUrl, setDirectUrl] = useState('');
  const [isResolvingUrl, setIsResolvingUrl] = useState(false);
  const [urlError, setUrlError] = useState<string | null>(null);

  const [pendingDownload, setPendingDownload] = useState<ExternalModelSearchResult | null>(null);
  const [selectedFile, setSelectedFile] = useState<ExternalModelFileOption | null>(null);
  const [isLoadingRepoFiles, setIsLoadingRepoFiles] = useState(false);
  const [dlSubfolder, setDlSubfolder] = useState<ComfyModelSubfolder>('loras');
  const [customFilename, setCustomFilename] = useState('');
  const [allowOverwrite, setAllowOverwrite] = useState(false);
  const [dlError, setDlError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [directStartingKey, setDirectStartingKey] = useState<string | null>(null);
  const [brokenImages, setBrokenImages] = useState<Record<string, boolean>>({});

  const openDownloadModal = async (item: ExternalModelSearchResult) => {
    const initialFile = item.availableFiles?.[0] || null;
    const initialFolder = initialFile?.suggestedSubfolder || getDefaultSubfolderForItem(item);
    setPendingDownload(item);
    setSelectedFile(initialFile);
    setDlSubfolder(initialFolder);
    setCustomFilename(initialFile?.filename || item.filename);
    setDlError(null);

    // Fetch full recursive tree + LFS SHA-256 hashes for Hugging Face repos
    if (item.provider === 'huggingface' && item.id) {
      setIsLoadingRepoFiles(true);
      try {
        const repoTree = await api.listHuggingFaceRepoFiles(item.id);
        if (repoTree.files.length > 0) {
          const matched =
            repoTree.files.find((f) => f.filename === item.filename) || repoTree.files[0];
          setPendingDownload((prev) =>
            prev && prev.id === item.id
              ? {
                  ...prev,
                  availableFiles: repoTree.files,
                  totalRepoFilesCount: repoTree.files.length,
                }
              : prev
          );
          setSelectedFile(matched);
          setDlSubfolder(matched.suggestedSubfolder);
          setCustomFilename(matched.filename);
        }
      } catch {
        // Keep existing sibling list if tree endpoint fails
      } finally {
        setIsLoadingRepoFiles(false);
      }
    }
  };

  const handleSelectFile = (file: ExternalModelFileOption) => {
    setSelectedFile(file);
    setDlSubfolder(file.suggestedSubfolder);
    setCustomFilename(file.filename);
    setDlError(null);
  };

  const handleResolveDirectUrl = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!directUrl.trim()) return;
    setIsResolvingUrl(true);
    setUrlError(null);
    try {
      const res = await api.resolveModelUrl(directUrl.trim());
      setDirectUrl('');
      await openDownloadModal(res.item);
    } catch (err: any) {
      setUrlError(err?.message || 'Could not resolve model URL');
    } finally {
      setIsResolvingUrl(false);
    }
  };

  const handleDirectLoraDownload = async (item: ExternalModelSearchResult, cardKey: string) => {
    setDirectStartingKey(cardKey);
    try {
      const primary = item.availableFiles?.[0];
      const targetFilename = primary?.filename || item.filename;
      await api.startModelDownload({
        provider: item.provider,
        modelName: item.name,
        filename: targetFilename,
        modelType: 'lora',
        sourceUrl: primary?.downloadUrl || item.downloadUrl,
        expectedHash: primary?.sha256Hash || item.sha256Hash || null,
        subfolder: 'loras',
        allowOverwrite: false,
        userConfirmed: true,
        hfRepoId: item.hfRepoId || null,
        civitaiMeta:
          item.provider === 'civitai'
            ? {
                civitaiId: item.id,
                civitaiVersionId: item.versionId || null,
                civitaiUrl: item.civitaiUrl || null,
                baseModel: item.baseModel || null,
                trainedWords: item.trainedWords || [],
                recommendedWeight: item.recommendedWeight ?? null,
                civitaiDescription: item.civitaiDescription || null,
                previewImages: item.previewImages || [],
              }
            : null,
      });
      await onRefreshDownloads();
      onPushToast?.(`Started downloading ${targetFilename} to /downloads/loras`, 'info');
    } catch (err: any) {
      const msg = err?.message || 'Download could not start';
      // If file already exists on disk, open modal with overwrite option & error visible
      await openDownloadModal(item);
      setDlError(msg);
    } finally {
      setDirectStartingKey(null);
    }
  };

  const handleConfirmDownload = async () => {
    if (!pendingDownload) return;
    setDlError(null);
    setIsSubmitting(true);
    try {
      const folderMeta = COMFY_SUBFOLDER_OPTIONS.find((o) => o.value === dlSubfolder);
      const effectiveType: ModelType =
        folderMeta?.modelType || selectedFile?.modelType || pendingDownload.modelType;

      await api.startModelDownload({
        provider: pendingDownload.provider,
        modelName: pendingDownload.name,
        filename: customFilename.trim() || selectedFile?.filename || pendingDownload.filename,
        modelType: effectiveType,
        sourceUrl: selectedFile?.downloadUrl || pendingDownload.downloadUrl,
        expectedHash: selectedFile ? selectedFile.sha256Hash : pendingDownload.sha256Hash || null,
        subfolder: dlSubfolder,
        allowOverwrite,
        userConfirmed: true,
        hfRepoId: pendingDownload.hfRepoId || null,
        civitaiMeta:
          pendingDownload.provider === 'civitai'
            ? {
                civitaiId: pendingDownload.id,
                civitaiVersionId: pendingDownload.versionId || null,
                civitaiUrl: pendingDownload.civitaiUrl || null,
                baseModel: pendingDownload.baseModel || null,
                trainedWords: pendingDownload.trainedWords || [],
                recommendedWeight: pendingDownload.recommendedWeight ?? null,
                civitaiDescription: pendingDownload.civitaiDescription || null,
                previewImages: pendingDownload.previewImages || [],
              }
            : null,
      });
      setPendingDownload(null);
      setSelectedFile(null);
      await onRefreshDownloads();
    } catch (err: any) {
      setDlError(err.message || 'Download could not start');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Direct URL / Repo Paste Bar */}
      <form
        onSubmit={handleResolveDirectUrl}
        className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 space-y-2 text-xs"
      >
        <div className="flex items-center gap-2 text-zinc-300 font-medium">
          <Link2 className="w-3.5 h-3.5 text-indigo-400" />
          <span>Direct URL or Hugging Face Repository</span>
          <span className="text-zinc-500 font-normal">
            — Paste a Civitai page/download URL, Hugging Face file/repo link, or{' '}
            <code className="font-mono text-zinc-400">owner/repo</code>
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-2.5">
          <input
            type="text"
            value={directUrl}
            onChange={(e) => setDirectUrl(e.target.value)}
            placeholder="https://huggingface.co/comfyanonymous/flux_text_encoders/blob/main/t5xxl_fp8_e4m3fn.safetensors or https://civitai.com/models/..."
            className="flex-1 min-w-[260px] px-3 py-2 bg-zinc-950 border border-zinc-800 rounded-lg text-zinc-100 font-mono"
          />
          <button
            type="submit"
            disabled={isResolvingUrl || !directUrl.trim()}
            className="px-4 py-2 bg-zinc-800 hover:bg-indigo-600 disabled:opacity-50 text-zinc-100 font-medium rounded-lg transition-colors cursor-pointer whitespace-nowrap shrink-0"
          >
            {isResolvingUrl ? 'Resolving...' : 'Fetch & Review URL'}
          </button>
        </div>
        {urlError && <p className="text-rose-400">{urlError}</p>}
      </form>

      {/* Search Form */}
      <form
        onSubmit={(e) => onSearch(e)}
        className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 flex flex-wrap items-center gap-3 text-xs"
      >
        <div className="flex items-center p-0.5 bg-zinc-950 border border-zinc-800 rounded-lg">
          <button
            type="button"
            onClick={() => setProvider('civitai')}
            className={`px-3 py-1.5 rounded-md font-medium cursor-pointer ${
              provider === 'civitai' ? 'bg-indigo-600 text-white' : 'text-zinc-400'
            }`}
          >
            Civitai API
          </button>
          <button
            type="button"
            onClick={() => setProvider('huggingface')}
            className={`px-3 py-1.5 rounded-md font-medium cursor-pointer ${
              provider === 'huggingface' ? 'bg-indigo-600 text-white' : 'text-zinc-400'
            }`}
          >
            Hugging Face Hub
          </button>
        </div>

        <input
          type="text"
          value={extQuery}
          onChange={(e) => setExtQuery(e.target.value)}
          placeholder={
            provider === 'civitai'
              ? 'Search Civitai models or paste SHA-256 / AutoV2 hash...'
              : 'Search Hugging Face repos (e.g. flux_text_encoders, controlnet, gguf) or owner/repo...'
          }
          className="flex-1 min-w-[240px] px-3 py-2 bg-zinc-950 border border-zinc-800 rounded-lg text-zinc-100"
        />

        {provider === 'civitai' && (
          <select
            value={extTypeFilter}
            onChange={(e) => setExtTypeFilter(e.target.value)}
            className="px-3 py-2 bg-zinc-950 border border-zinc-800 rounded-lg text-zinc-200"
          >
            <option value="">All Model Types</option>
            <option value="lora">LoRA / LoCon / DoRA</option>
            <option value="checkpoint">Checkpoint / UNET Base</option>
            <option value="controlnet">ControlNet</option>
            <option value="vae">VAE</option>
            <option value="upscaler">Upscaler</option>
            <option value="embedding">Embedding / Textual Inversion</option>
          </select>
        )}

        <button
          type="submit"
          disabled={isSearchingExt}
          className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white font-medium rounded-lg cursor-pointer"
        >
          {isSearchingExt ? 'Searching...' : 'Search Models'}
        </button>
      </form>

      {searchError && (
        <div className="p-3 bg-rose-500/15 border border-rose-500/40 rounded-lg text-xs text-rose-300">
          {searchError}
        </div>
      )}

      {/* Search Results Grid */}
      {searchResults.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {searchResults.map((item) => {
            const cardKey = `${item.provider}-${item.id}-${item.filename}`;
            const hasThumb = Boolean(item.previewImageUrl && !brokenImages[cardKey]);
            const fileCount = item.totalRepoFilesCount || item.availableFiles?.length || 1;
            const targetFolder = getDefaultSubfolderForItem(item);

            return (
              <div
                key={cardKey}
                className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden flex flex-col justify-between text-xs"
              >
                <div>
                  {/* Cover Preview Thumbnail or Fallback */}
                  <div className="relative h-44 bg-zinc-950 border-b border-zinc-800 overflow-hidden">
                    {hasThumb ? (
                      <img
                        src={item.previewImageUrl!}
                        alt={item.name}
                        className="w-full h-full object-cover"
                        loading="lazy"
                        onError={() =>
                          setBrokenImages((prev) => ({ ...prev, [cardKey]: true }))
                        }
                      />
                    ) : (
                      <div className="w-full h-full flex flex-col items-center justify-center gap-1.5 text-zinc-600 bg-gradient-to-br from-zinc-950 to-zinc-900">
                        <Layers className="w-6 h-6" />
                        <span className="text-[11px] font-mono">
                          {item.provider === 'huggingface'
                            ? `${fileCount} weight file${fileCount === 1 ? '' : 's'} in repo`
                            : 'No preview image'}
                        </span>
                      </div>
                    )}

                    <div className="absolute top-2.5 left-2.5 flex items-center gap-1.5">
                      <span className="px-2 py-0.5 rounded bg-zinc-950/85 border border-zinc-700/80 font-mono text-[10px] text-emerald-300">
                        /{targetFolder}
                      </span>
                      {fileCount > 1 && (
                        <span className="px-2 py-0.5 rounded bg-zinc-950/85 border border-zinc-700/80 font-mono text-[10px] text-zinc-200">
                          {fileCount} files
                        </span>
                      )}
                    </div>

                    {item.civitaiUrl && (
                      <a
                        href={item.civitaiUrl}
                        target="_blank"
                        rel="noreferrer"
                        title="Open original Civitai page"
                        className="absolute top-2.5 right-2.5 inline-flex items-center gap-1 px-2 py-1 rounded-md bg-zinc-950/85 hover:bg-zinc-900 border border-zinc-700/80 text-[11px] text-zinc-200 hover:text-white transition-colors"
                      >
                        <ExternalLink className="w-3 h-3" />
                        <span>Civitai</span>
                      </a>
                    )}
                  </div>

                  {/* Card Details */}
                  <div className="p-4 space-y-2">
                    <div className="flex items-start justify-between gap-2">
                      <h4 className="text-sm font-display font-semibold text-zinc-100 leading-snug break-all">
                        {item.name}
                      </h4>
                      {item.baseModel && (
                        <span className="px-1.5 py-0.5 text-[10px] font-mono bg-zinc-950 border border-zinc-700 text-indigo-300 rounded shrink-0">
                          {item.baseModel}
                        </span>
                      )}
                    </div>

                    <div className="text-[11px] font-mono text-zinc-400 flex flex-wrap items-center gap-x-2 gap-y-0.5">
                      <span className="uppercase text-indigo-300">{item.modelType}</span>
                      <span>·</span>
                      <span className="truncate max-w-[180px]" title={item.filename}>
                        {item.filename}
                      </span>
                      <span>·</span>
                      <span>{formatBytes(item.fileSize)}</span>
                    </div>

                    {item.trainedWords && item.trainedWords.length > 0 && (
                      <div className="text-[11px] text-zinc-300 truncate">
                        <span className="text-zinc-500">Triggers: </span>
                        <span className="font-mono text-amber-300">
                          {item.trainedWords.join(', ')}
                        </span>
                      </div>
                    )}

                    {(item.recommendedWeight !== null && item.recommendedWeight !== undefined) ||
                    item.sha256Hash ? (
                      <div className="text-[11px] font-mono flex flex-wrap items-center gap-x-3 text-zinc-400">
                        {item.recommendedWeight !== null && item.recommendedWeight !== undefined && (
                          <span className="text-indigo-300">
                            Rec. Weight: {item.recommendedWeight.toFixed(2)}x
                          </span>
                        )}
                        {item.sha256Hash && (
                          <span className="text-emerald-400 truncate">
                            SHA256: {item.sha256Hash.slice(0, 12)}…
                          </span>
                        )}
                      </div>
                    ) : null}

                    {item.description && (
                      <p className="text-zinc-400 line-clamp-2 pt-0.5">{item.description}</p>
                    )}
                  </div>
                </div>

                <div className="px-4 pb-4 pt-1">
                  {(() => {
                    const isDirectLora =
                      item.modelType === 'lora' &&
                      (item.provider === 'civitai' || fileCount <= 1);
                    const matchingJob = downloads.find(
                      (d) =>
                        typeof d.destination_path === 'string' &&
                        d.destination_path.toLowerCase().endsWith(`/${item.filename.toLowerCase()}`)
                    );
                    const isDownloadingNow =
                      directStartingKey === cardKey || matchingJob?.status === 'downloading';
                    const isCompletedNow = matchingJob?.status === 'completed';
                    const dlPct =
                      matchingJob && matchingJob.total_bytes > 0
                        ? Math.min(
                            100,
                            Math.round((matchingJob.bytes_downloaded / matchingJob.total_bytes) * 100)
                          )
                        : null;

                    if (isDirectLora) {
                      return (
                        <button
                          type="button"
                          disabled={isDownloadingNow}
                          onClick={() => handleDirectLoraDownload(item, cardKey)}
                          className={`w-full inline-flex items-center justify-center gap-1.5 py-2 font-medium rounded-lg transition-colors cursor-pointer disabled:opacity-60 ${
                            isCompletedNow
                              ? 'bg-emerald-600/20 border border-emerald-500/40 text-emerald-300 hover:bg-emerald-600/30'
                              : 'bg-indigo-600 hover:bg-indigo-500 text-white'
                          }`}
                        >
                          {isDownloadingNow ? (
                            <>
                              <Loader2 className="w-3.5 h-3.5 animate-spin" />
                              <span className="font-mono tabular-nums">
                                Downloading{dlPct !== null ? ` (${dlPct}%)` : '...'}
                              </span>
                            </>
                          ) : isCompletedNow ? (
                            <>
                              <CheckCircle2 className="w-3.5 h-3.5" />
                              <span>Downloaded to /loras</span>
                            </>
                          ) : (
                            <>
                              <HardDriveDownload className="w-3.5 h-3.5" />
                              <span>Download LoRA</span>
                            </>
                          )}
                        </button>
                      );
                    }

                    return (
                      <button
                        type="button"
                        onClick={() => openDownloadModal(item)}
                        className="w-full inline-flex items-center justify-center gap-1.5 py-2 bg-zinc-800 hover:bg-indigo-600 text-zinc-100 font-medium rounded-lg transition-colors cursor-pointer"
                      >
                        {fileCount > 1 || item.provider === 'huggingface' ? (
                          <>
                            <FolderGit2 className="w-3.5 h-3.5" />
                            <span>Browse Files &amp; Download ({fileCount})</span>
                          </>
                        ) : (
                          <>
                            <HardDriveDownload className="w-3.5 h-3.5" />
                            <span>Review &amp; Download</span>
                          </>
                        )}
                      </button>
                    );
                  })()}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Download History & Progress */}
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
              return (
                <div
                  key={d.id}
                  className="bg-zinc-950 border border-zinc-800 rounded-lg p-3 space-y-1.5"
                >
                  <div className="flex items-center justify-between">
                    <span className="font-medium text-zinc-200">
                      {d.model_name} ({d.provider})
                    </span>
                    <span className="font-mono tabular-nums text-zinc-300">
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
                      <FileWarning className="w-3.5 h-3.5" />
                      <span>{d.error_message}</span>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Explicit User Confirmation & Multi-File Picker Modal */}
      {pendingDownload && (
        <ModelDownloadConfirmModal
          pendingDownload={pendingDownload}
          selectedFile={selectedFile}
          onSelectFile={handleSelectFile}
          isLoadingRepoFiles={isLoadingRepoFiles}
          dlSubfolder={dlSubfolder}
          setDlSubfolder={setDlSubfolder}
          customFilename={customFilename}
          setCustomFilename={setCustomFilename}
          allowOverwrite={allowOverwrite}
          setAllowOverwrite={setAllowOverwrite}
          dlError={dlError}
          isSubmitting={isSubmitting}
          onClose={() => {
            setPendingDownload(null);
            setSelectedFile(null);
          }}
          onConfirm={handleConfirmDownload}
        />
      )}
    </div>
  );
};
