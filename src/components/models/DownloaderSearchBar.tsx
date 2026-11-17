import React from 'react';
import { Info, Search, X } from 'lucide-react';

interface DownloaderSearchBarProps {
  extQuery: string;
  setExtQuery: (q: string) => void;
  extTypeFilter: string;
  setExtTypeFilter: (t: string) => void;
  isSearchingExt: boolean;
  searchError: string | null;
  searchNotice?: string | null;
  onDismissSearchNotice?: () => void;
  onSearch: (e?: React.FormEvent, customQ?: string) => Promise<void>;
}

/**
 * Top search input, model-type filter, and error/notice banners for the Model Downloader.
 */
export const DownloaderSearchBar: React.FC<DownloaderSearchBarProps> = ({
  extQuery,
  setExtQuery,
  extTypeFilter,
  setExtTypeFilter,
  isSearchingExt,
  searchError,
  searchNotice,
  onDismissSearchNotice,
  onSearch,
}) => {
  return (
    <>
      <form
        onSubmit={(e) => onSearch(e)}
        className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 flex flex-wrap items-center gap-3 text-xs"
      >
        <div className="relative flex-1 min-w-[260px]">
          <Search className="w-4 h-4 text-zinc-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={extQuery}
            onChange={(e) => setExtQuery(e.target.value)}
            placeholder="Search Civitai & Hugging Face, or paste a Civitai image/model URL, hash, or owner/repo..."
            className="w-full pl-9 pr-3 py-2 bg-zinc-950 border border-zinc-800 rounded-lg text-zinc-100"
          />
        </div>

        <select
          value={extTypeFilter}
          onChange={(e) => setExtTypeFilter(e.target.value)}
          className="px-3 py-2 bg-zinc-950 border border-zinc-800 rounded-lg text-zinc-200"
        >
          <option value="">All Model Types</option>
          <option value="lora">LoRA / LoCon / DoRA</option>
          <option value="checkpoint">Checkpoint / UNET Base</option>
          <option value="clip">Text Encoder / CLIP / T5</option>
          <option value="controlnet">ControlNet</option>
          <option value="vae">VAE</option>
          <option value="upscaler">Upscaler</option>
          <option value="embedding">Embedding / Textual Inversion</option>
        </select>

        <button
          type="submit"
          disabled={isSearchingExt}
          className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white font-medium rounded-lg cursor-pointer whitespace-nowrap shrink-0"
        >
          {isSearchingExt ? 'Searching...' : 'Search Models'}
        </button>
      </form>

      {searchError && (
        <div className="p-3 bg-rose-500/15 border border-rose-500/40 rounded-lg text-xs text-rose-300">
          {searchError}
        </div>
      )}

      {searchNotice && (
        <div className="p-3 bg-amber-500/10 border border-amber-500/35 rounded-lg text-xs text-amber-200 flex items-start justify-between gap-3">
          <div className="flex items-start gap-2">
            <Info className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
            <span>{searchNotice}</span>
          </div>
          {onDismissSearchNotice && (
            <button
              type="button"
              onClick={onDismissSearchNotice}
              aria-label="Dismiss notice"
              className="p-0.5 text-amber-300/80 hover:text-amber-100 cursor-pointer shrink-0"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      )}
    </>
  );
};
