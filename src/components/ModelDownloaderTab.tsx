import React, { useState } from 'react';
import {
  ExternalLink,
  FileWarning,
  HardDriveDownload,
  Layers,
} from 'lucide-react';
import { api } from '../api/client.ts';
import { formatBytes } from '../shared/utils.ts';
import type { ExternalModelSearchResult } from '../shared/types.ts';

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
}

/**
 * Civitai & Hugging Face model search cards with preview thumbnails, Base Model badges,
 * trigger words, recommended weights, original Civitai page links, and download confirmation.
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
}) => {
  const [pendingDownload, setPendingDownload] = useState<ExternalModelSearchResult | null>(null);
  const [dlSubfolder, setDlSubfolder] = useState('loras');
  const [allowOverwrite, setAllowOverwrite] = useState(false);
  const [dlError, setDlError] = useState<string | null>(null);
  const [brokenImages, setBrokenImages] = useState<Record<string, boolean>>({});

  const handleConfirmDownload = async () => {
    if (!pendingDownload) return;
    setDlError(null);
    try {
      await api.startModelDownload({
        provider: pendingDownload.provider,
        modelName: pendingDownload.name,
        filename: pendingDownload.filename,
        modelType: pendingDownload.modelType,
        sourceUrl: pendingDownload.downloadUrl,
        expectedHash: pendingDownload.sha256Hash || null,
        subfolder: dlSubfolder,
        allowOverwrite,
        userConfirmed: true,
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
      await onRefreshDownloads();
    } catch (err: any) {
      setDlError(err.message || 'Download could not start');
    }
  };

  return (
    <div className="space-y-6">
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
          placeholder="Search model name or paste SHA-256 / AutoV2 hash..."
          className="flex-1 min-w-[240px] px-3 py-2 bg-zinc-950 border border-zinc-800 rounded-lg text-zinc-100"
        />

        {provider === 'civitai' && (
          <select
            value={extTypeFilter}
            onChange={(e) => setExtTypeFilter(e.target.value)}
            className="px-3 py-2 bg-zinc-950 border border-zinc-800 rounded-lg text-zinc-200"
          >
            <option value="">All Types</option>
            <option value="lora">LoRA</option>
            <option value="checkpoint">Checkpoint</option>
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
                        <span className="text-[11px] font-mono">No preview image</span>
                      </div>
                    )}

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
                      <h4 className="text-sm font-display font-semibold text-zinc-100 leading-snug">
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
                      <span className="truncate max-w-[180px]">{item.filename}</span>
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
                  <button
                    type="button"
                    onClick={() => {
                      setPendingDownload(item);
                      setDlSubfolder(item.modelType === 'checkpoint' ? 'checkpoints' : 'loras');
                      setDlError(null);
                    }}
                    className="w-full inline-flex items-center justify-center gap-1.5 py-2 bg-zinc-800 hover:bg-indigo-600 text-zinc-100 font-medium rounded-lg transition-colors cursor-pointer"
                  >
                    <HardDriveDownload className="w-3.5 h-3.5" />
                    <span>Review & Download</span>
                  </button>
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
            Server-Side Download Queue & Hash Verification History
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

      {/* Explicit User Confirmation Modal Before Downloading */}
      {pendingDownload && (
        <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4">
          <div className="bg-zinc-900 border border-zinc-800 rounded-xl max-w-md w-full p-6 space-y-4 text-xs">
            <h3 className="text-base font-display font-semibold text-zinc-100">
              Confirm Server-Side Model Download
            </h3>
            <p className="text-zinc-400">
              Models are downloaded server-side into your writable downloads volume, verified via SHA-256, and automatically enriched with Civitai metadata and cached preview thumbnails.
            </p>
            <div className="bg-zinc-950 border border-zinc-800 rounded-lg p-3 space-y-1 font-mono">
              <div className="text-zinc-200">Model: {pendingDownload.name}</div>
              <div className="text-zinc-400">File: {pendingDownload.filename}</div>
              <div className="text-zinc-400">Size: {formatBytes(pendingDownload.fileSize)}</div>
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
              {pendingDownload.sha256Hash && (
                <div className="text-emerald-400 truncate">
                  SHA256: {pendingDownload.sha256Hash}
                </div>
              )}
            </div>

            <div>
              <label className="block text-zinc-300 mb-1">Destination Subfolder</label>
              <select
                value={dlSubfolder}
                onChange={(e) => setDlSubfolder(e.target.value)}
                className="w-full px-3 py-2 bg-zinc-950 border border-zinc-800 rounded-lg text-zinc-100"
              >
                <option value="loras">/downloads/loras</option>
                <option value="checkpoints">/downloads/checkpoints</option>
                <option value="vae">/downloads/vae</option>
                <option value="controlnet">/downloads/controlnet</option>
              </select>
            </div>

            <label className="inline-flex items-center gap-2 text-zinc-300 cursor-pointer">
              <input
                type="checkbox"
                checked={allowOverwrite}
                onChange={(e) => setAllowOverwrite(e.target.checked)}
              />
              <span>Explicitly allow overwriting if file already exists</span>
            </label>

            {dlError && <p className="text-rose-400">{dlError}</p>}

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setPendingDownload(null)}
                className="px-3.5 py-2 bg-zinc-800 text-zinc-300 rounded-lg cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmDownload}
                className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white font-medium rounded-lg cursor-pointer"
              >
                Confirm & Start Download
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
