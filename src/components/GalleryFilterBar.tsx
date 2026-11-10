import React, { useMemo, useState } from 'react';
import {
  Search,
  SlidersHorizontal,
  ChevronDown,
  Download,
  BookmarkPlus,
  RotateCcw,
  Star,
  Heart,
  Grid,
  LayoutGrid,
  Columns,
  X,
} from 'lucide-react';
import type {
  CharacterProfile,
  GalleryFilterState,
  LoraExplorerItem,
  SavedSearchPreset,
} from '../shared/types.ts';

export type GalleryViewLayout = 'masonry' | 'standard' | 'compact';

interface GalleryFilterBarProps {
  filters: GalleryFilterState;
  onChange: (next: GalleryFilterState) => void;
  onReset: () => void;
  layout: GalleryViewLayout;
  onLayoutChange: (layout: GalleryViewLayout) => void;
  thumbScale: 'sm' | 'md' | 'lg';
  onThumbScaleChange: (scale: 'sm' | 'md' | 'lg') => void;
  totalMatching: number;
  characters: CharacterProfile[];
  loras: LoraExplorerItem[];
  checkpoints: string[];
  collections: { id: number; name: string; imageCount: number }[];
  tags: { id: number; name: string; color: string; imageCount: number }[];
  savedSearches: SavedSearchPreset[];
  onSaveSearch: (name: string) => void;
  onDeleteSavedSearch: (id: number) => void;
  onExportFilteredZip: () => void;
  isHiddenOnMobile?: boolean;
}

/**
 * Universal Search & Advanced Multi-LoRA / Multi-Character Filter Bar.
 */
export const GalleryFilterBar: React.FC<GalleryFilterBarProps> = ({
  filters,
  onChange,
  onReset,
  layout,
  onLayoutChange,
  thumbScale,
  onThumbScaleChange,
  totalMatching,
  characters,
  loras,
  checkpoints,
  collections,
  tags,
  savedSearches,
  onSaveSearch,
  onDeleteSavedSearch,
  onExportFilteredZip,
  isHiddenOnMobile = false,
}) => {
  const [showFilters, setShowFilters] = useState(false);
  const [newPresetName, setNewPresetName] = useState('');
  const [showPresetInput, setShowPresetInput] = useState(false);

  // Count active non-default filters
  const activeFiltersCount = useMemo(() => {
    let count = 0;
    if (filters.favoritesOnly) count++;
    if (filters.minRating > 0) count++;
    if (filters.rejectedMode !== 'exclude') count++;
    if (filters.archivedMode !== 'exclude') count++;
    if (filters.sortBy !== 'newest') count++;
    if (filters.loras.length > 0) count += filters.loras.length;
    if (filters.characterIds.length > 0) count += filters.characterIds.length;
    if (filters.tagIds.length > 0) count += filters.tagIds.length;
    if (filters.collectionId) count++;
    if (filters.checkpoint) count++;
    if (filters.dependencyStatus) count++;
    return count;
  }, [filters]);

  const toggleLora = (loraFilename: string) => {
    const exists = filters.loras.includes(loraFilename);
    const next = exists
      ? filters.loras.filter((l) => l !== loraFilename)
      : [...filters.loras, loraFilename];
    onChange({ ...filters, loras: next });
  };

  const toggleCharacter = (charId: number) => {
    const exists = filters.characterIds.includes(charId);
    const next = exists
      ? filters.characterIds.filter((id) => id !== charId)
      : [...filters.characterIds, charId];
    onChange({ ...filters, characterIds: next });
  };

  const toggleTag = (tagId: number) => {
    const exists = filters.tagIds.includes(tagId);
    const next = exists
      ? filters.tagIds.filter((id) => id !== tagId)
      : [...filters.tagIds, tagId];
    onChange({ ...filters, tagIds: next });
  };

  return (
    <section
      className={`sticky top-[53px] sm:top-[57px] z-20 bg-zinc-950/95 backdrop-blur-md border-b border-zinc-800 px-4 sm:px-6 py-2.5 transition-all shadow-md space-y-3 ${
        isHiddenOnMobile ? 'hidden md:block' : 'block'
      }`}
    >
      {/* Row 1: Locked Sticky Universal Search Header + Filter Toggle + Export */}
      <div className="flex items-center justify-between gap-2.5 sm:gap-3">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="w-4 h-4 text-zinc-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            type="text"
            value={filters.query}
            onChange={(e) => onChange({ ...filters, query: e.target.value })}
            placeholder='Search prompts, tags, loras, characters...'
            className="w-full pl-10 pr-9 py-2 text-sm bg-zinc-900 border border-zinc-800 rounded-lg text-zinc-100 placeholder-zinc-500 focus:outline-none focus:border-indigo-500"
          />
          {filters.query && (
            <button
              type="button"
              onClick={() => onChange({ ...filters, query: '' })}
              aria-label="Clear search"
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-zinc-200 p-0.5 rounded cursor-pointer transition-colors"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        {/* Results Counter (Desktop / Tablet) */}
        <span className="text-xs text-zinc-400 font-mono hidden md:inline whitespace-nowrap shrink-0 tabular-nums">
          {totalMatching} {totalMatching === 1 ? 'image' : 'images'}
        </span>

        {/* Action Controls: Filter Accordion Toggle, Reset & Export */}
        <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
          <button
            type="button"
            onClick={() => setShowFilters((prev) => !prev)}
            className={`inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-lg border transition-colors whitespace-nowrap cursor-pointer ${
              showFilters || activeFiltersCount > 0
                ? 'bg-indigo-600/20 border-indigo-500 text-indigo-200 font-semibold shadow-xs'
                : 'bg-zinc-900 border-zinc-800 text-zinc-300 hover:border-zinc-700'
            }`}
            title={showFilters ? 'Hide filter options' : 'Show filter options'}
          >
            <SlidersHorizontal className="w-3.5 h-3.5" />
            <span>Filters</span>
            {activeFiltersCount > 0 && (
              <span className="px-1.5 py-0.2 rounded-full bg-indigo-600 text-white font-mono text-[10px]">
                {activeFiltersCount}
              </span>
            )}
            <ChevronDown
              className={`w-3.5 h-3.5 transition-transform duration-200 ${
                showFilters ? 'rotate-180' : ''
              }`}
            />
          </button>

          {activeFiltersCount > 0 && (
            <button
              type="button"
              onClick={onReset}
              className="inline-flex items-center gap-1 px-2.5 py-2 text-xs font-medium bg-zinc-900 border border-zinc-800 hover:border-zinc-700 text-zinc-400 hover:text-zinc-200 rounded-lg transition-colors whitespace-nowrap cursor-pointer"
              title="Reset all active filters"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Reset</span>
            </button>
          )}

          <button
            type="button"
            onClick={onExportFilteredZip}
            disabled={totalMatching === 0}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium bg-zinc-900 border border-zinc-800 hover:border-zinc-700 disabled:opacity-40 text-zinc-300 rounded-lg transition-colors whitespace-nowrap cursor-pointer"
            title="Export matching images as ZIP archive"
          >
            <Download className="w-3.5 h-3.5" />
            <span className="font-mono tabular-nums hidden xs:inline sm:inline">
              ZIP ({totalMatching})
            </span>
          </button>
        </div>
      </div>

      {/* Expandable Sliding Filter Window (Hidden by default) */}
      {showFilters && (
        <div className="pt-3 border-t border-zinc-800/80 space-y-3 text-xs animate-in fade-in duration-200">
          {/* Quick Filters, Sorting, and View Modes Row */}
          <div className="flex flex-wrap items-center justify-between gap-2.5 pb-2 border-b border-zinc-800/60">
            <div className="flex flex-wrap items-center gap-2">
              {/* Favorites Button */}
              <button
                type="button"
                onClick={() => onChange({ ...filters, favoritesOnly: !filters.favoritesOnly })}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors whitespace-nowrap cursor-pointer ${
                  filters.favoritesOnly
                    ? 'bg-rose-500/15 border-rose-500/50 text-rose-300'
                    : 'bg-zinc-900 border-zinc-800 text-zinc-300 hover:border-zinc-700'
                }`}
              >
                <Heart className={`w-3.5 h-3.5 ${filters.favoritesOnly ? 'fill-rose-400 text-rose-400' : ''}`} />
                <span>Favorites Only</span>
              </button>

              {/* Min Rating */}
              <select
                value={filters.minRating}
                onChange={(e) => onChange({ ...filters, minRating: Number(e.target.value) })}
                aria-label="Minimum Rating"
                className="px-3 py-1.5 text-xs font-medium bg-zinc-900 border border-zinc-800 rounded-lg text-zinc-200 focus:outline-none focus:border-indigo-500"
              >
                <option value={0}>Any Rating</option>
                <option value={5}>5 Stars Only</option>
                <option value={4}>4+ Stars</option>
                <option value={3}>3+ Stars</option>
                <option value={2}>2+ Stars</option>
                <option value={1}>1+ Stars</option>
              </select>

              {/* Sorting Mode */}
              <select
                value={filters.sortBy}
                onChange={(e) => onChange({ ...filters, sortBy: e.target.value as any })}
                aria-label="Sort Images By"
                className="px-3 py-1.5 text-xs font-medium bg-zinc-900 border border-zinc-800 rounded-lg text-zinc-200 focus:outline-none focus:border-indigo-500"
              >
                <option value="newest">Sort: Newest First</option>
                <option value="oldest">Sort: Oldest First</option>
                <option value="rating_desc">Sort: Highest Rated</option>
                <option value="rating_asc">Sort: Lowest Rated</option>
                <option value="filename">Sort: Filename</option>
                <option value="filesize">Sort: File Size</option>
                <option value="checkpoint">Sort: Checkpoint</option>
                <option value="most_used_lora">Sort: Most-Used LoRA</option>
                <option value="recently_favorited">Sort: Recently Favorited</option>
              </select>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {/* View Mode Selector */}
              <div className="flex items-center p-0.5 bg-zinc-900 border border-zinc-800 rounded-lg">
                <button
                  type="button"
                  onClick={() => onLayoutChange('standard')}
                  title="Standard Grid"
                  className={`px-2.5 py-1 text-xs font-medium rounded-md inline-flex items-center gap-1 transition-colors whitespace-nowrap cursor-pointer ${
                    layout === 'standard' ? 'bg-zinc-800 text-zinc-100' : 'text-zinc-400 hover:text-zinc-200'
                  }`}
                >
                  <LayoutGrid className="w-3.5 h-3.5" />
                  <span>Grid</span>
                </button>
                <button
                  type="button"
                  onClick={() => onLayoutChange('masonry')}
                  title="Masonry Gallery"
                  className={`px-2.5 py-1 text-xs font-medium rounded-md inline-flex items-center gap-1 transition-colors whitespace-nowrap cursor-pointer ${
                    layout === 'masonry' ? 'bg-zinc-800 text-zinc-100' : 'text-zinc-400 hover:text-zinc-200'
                  }`}
                >
                  <Columns className="w-3.5 h-3.5" />
                  <span>Masonry</span>
                </button>
                <button
                  type="button"
                  onClick={() => onLayoutChange('compact')}
                  title="Compact Grid"
                  className={`px-2.5 py-1 text-xs font-medium rounded-md inline-flex items-center gap-1 transition-colors whitespace-nowrap cursor-pointer ${
                    layout === 'compact' ? 'bg-zinc-800 text-zinc-100' : 'text-zinc-400 hover:text-zinc-200'
                  }`}
                >
                  <Grid className="w-3.5 h-3.5" />
                  <span>Compact</span>
                </button>
              </div>

              {/* Thumb Size Scale */}
              <div className="flex items-center p-0.5 bg-zinc-900 border border-zinc-800 rounded-lg">
                {(['sm', 'md', 'lg'] as const).map((sz) => (
                  <button
                    key={sz}
                    type="button"
                    onClick={() => onThumbScaleChange(sz)}
                    className={`px-2 py-1 text-xs font-mono uppercase rounded-md transition-colors whitespace-nowrap cursor-pointer ${
                      thumbScale === sz ? 'bg-zinc-800 text-zinc-100' : 'text-zinc-400 hover:text-zinc-200'
                    }`}
                  >
                    {sz}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Detailed Entity Filters (LoRA, Character, Checkpoint, Collection, Status) */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
          {/* Multi-Character Selector */}
          <div className="lg:col-span-4 bg-zinc-950/80 border border-zinc-800/80 rounded-lg p-3 space-y-2">
            <div className="flex items-center justify-between">
              <span className="font-medium text-zinc-200">Character Filter</span>
              <div className="flex items-center gap-1 bg-zinc-900 p-0.5 rounded">
                {(['ALL', 'ANY'] as const).map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => onChange({ ...filters, characterMatchMode: m })}
                    className={`px-2 py-0.5 text-[11px] rounded cursor-pointer ${
                      filters.characterMatchMode === m
                        ? 'bg-indigo-600 text-white'
                        : 'text-zinc-400 hover:text-zinc-200'
                    }`}
                  >
                    Match {m}
                  </button>
                ))}
              </div>
            </div>
            <div className="flex flex-wrap gap-1.5 max-h-28 overflow-y-auto">
              {characters.length === 0 ? (
                <span className="text-zinc-500">No characters created yet.</span>
              ) : (
                characters.map((ch) => {
                  const active = filters.characterIds.includes(ch.id);
                  return (
                    <button
                      key={ch.id}
                      type="button"
                      onClick={() => toggleCharacter(ch.id)}
                      className={`px-2.5 py-1 rounded border text-left transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                        active
                          ? 'bg-indigo-600/25 border-indigo-500 text-indigo-200'
                          : 'bg-zinc-900 border-zinc-800 text-zinc-300 hover:border-zinc-700'
                      }`}
                    >
                      {ch.name} · <span className="font-mono tabular-nums">{ch.confirmedImageCount}</span>
                    </button>
                  );
                })
              )}
            </div>
            <label className="inline-flex items-center gap-2 text-zinc-400 cursor-pointer pt-1">
              <input
                type="checkbox"
                checked={filters.includeSuggestedCharacters}
                onChange={(e) =>
                  onChange({ ...filters, includeSuggestedCharacters: e.target.checked })
                }
                className="rounded border-zinc-700 bg-zinc-900 text-indigo-600"
              />
              <span>Include unconfirmed character suggestions</span>
            </label>
          </div>

          {/* Multi-LoRA Selector + Strength Bounds */}
          <div className="lg:col-span-4 bg-zinc-950/80 border border-zinc-800/80 rounded-lg p-3 space-y-2">
            <div className="flex items-center justify-between">
              <span className="font-medium text-zinc-200">Multi-LoRA Filter</span>
              <div className="flex items-center gap-1 bg-zinc-900 p-0.5 rounded">
                {(['ALL', 'ANY'] as const).map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => onChange({ ...filters, loraMatchMode: m })}
                    className={`px-2 py-0.5 text-[11px] rounded cursor-pointer ${
                      filters.loraMatchMode === m
                        ? 'bg-indigo-600 text-white'
                        : 'text-zinc-400 hover:text-zinc-200'
                    }`}
                  >
                    Match {m}
                  </button>
                ))}
              </div>
            </div>
            <div className="flex flex-wrap gap-1.5 max-h-24 overflow-y-auto">
              {loras.length === 0 ? (
                <span className="text-zinc-500">No LoRAs indexed yet.</span>
              ) : (
                loras.map((l) => {
                  const active = filters.loras.includes(l.filename);
                  return (
                    <button
                      key={l.filename}
                      type="button"
                      onClick={() => toggleLora(l.filename)}
                      className={`px-2.5 py-1 rounded border transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                        active
                          ? 'bg-indigo-600/25 border-indigo-500 text-indigo-200'
                          : 'bg-zinc-900 border-zinc-800 text-zinc-300 hover:border-zinc-700'
                      }`}
                    >
                      {l.name} · <span className="font-mono tabular-nums">{l.imageCount}</span>
                    </button>
                  );
                })
              )}
            </div>
            <div className="grid grid-cols-2 gap-2 pt-1">
              <div>
                <label className="block text-[11px] text-zinc-400 mb-0.5">Min Strength</label>
                <input
                  type="number"
                  step="0.1"
                  placeholder="e.g. 0.4"
                  value={filters.minLoraStrength ?? ''}
                  onChange={(e) =>
                    onChange({
                      ...filters,
                      minLoraStrength: e.target.value === '' ? null : Number(e.target.value),
                    })
                  }
                  className="w-full px-2 py-1 bg-zinc-900 border border-zinc-800 rounded text-zinc-200 font-mono tabular-nums"
                />
              </div>
              <div>
                <label className="block text-[11px] text-zinc-400 mb-0.5">Max Strength</label>
                <input
                  type="number"
                  step="0.1"
                  placeholder="e.g. 1.2"
                  value={filters.maxLoraStrength ?? ''}
                  onChange={(e) =>
                    onChange({
                      ...filters,
                      maxLoraStrength: e.target.value === '' ? null : Number(e.target.value),
                    })
                  }
                  className="w-full px-2 py-1 bg-zinc-900 border border-zinc-800 rounded text-zinc-200 font-mono tabular-nums"
                />
              </div>
            </div>
          </div>

          {/* Checkpoint, Collection, Dependency, Status & Date Filters */}
          <div className="lg:col-span-4 bg-zinc-950/80 border border-zinc-800/80 rounded-lg p-3 space-y-2">
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-[11px] text-zinc-400 mb-0.5">Checkpoint</label>
                <select
                  value={filters.checkpoint}
                  onChange={(e) => onChange({ ...filters, checkpoint: e.target.value })}
                  className="w-full px-2 py-1.5 bg-zinc-900 border border-zinc-800 rounded text-zinc-200"
                >
                  <option value="">All Checkpoints</option>
                  {checkpoints.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-[11px] text-zinc-400 mb-0.5">Collection</label>
                <select
                  value={filters.collectionId ?? ''}
                  onChange={(e) =>
                    onChange({
                      ...filters,
                      collectionId: e.target.value ? Number(e.target.value) : null,
                    })
                  }
                  className="w-full px-2 py-1.5 bg-zinc-900 border border-zinc-800 rounded text-zinc-200"
                >
                  <option value="">All Collections</option>
                  {collections.map((col) => (
                    <option key={col.id} value={col.id}>
                      {col.name} ({col.imageCount})
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-[11px] text-zinc-400 mb-0.5">Dependency Status</label>
                <select
                  value={filters.dependencyStatus}
                  onChange={(e) => onChange({ ...filters, dependencyStatus: e.target.value as any })}
                  className="w-full px-2 py-1.5 bg-zinc-900 border border-zinc-800 rounded text-zinc-200"
                >
                  <option value="">Any Dependency State</option>
                  <option value="exact_match">Exact Match (Hash Verified)</option>
                  <option value="available">Available (Present)</option>
                  <option value="incomplete">Incomplete (Missing Models)</option>
                  <option value="unknown">Unknown</option>
                </select>
              </div>
              <div>
                <label className="block text-[11px] text-zinc-400 mb-0.5">Rejected / Archived</label>
                <select
                  value={`${filters.rejectedMode}:${filters.archivedMode}`}
                  onChange={(e) => {
                    const [rej, arch] = e.target.value.split(':') as any[];
                    onChange({ ...filters, rejectedMode: rej, archivedMode: arch });
                  }}
                  className="w-full px-2 py-1.5 bg-zinc-900 border border-zinc-800 rounded text-zinc-200"
                >
                  <option value="exclude:exclude">Standard Library (Hide Rejected/Archived)</option>
                  <option value="only:exclude">Rejected Only</option>
                  <option value="exclude:only">Archived Only</option>
                  <option value="include:include">Show Everything</option>
                </select>
              </div>
            </div>

            {/* Tags */}
            {tags.length > 0 && (
              <div className="pt-1">
                <span className="block text-[11px] text-zinc-400 mb-1">Tags</span>
                <div className="flex flex-wrap gap-1.5">
                  {tags.map((t) => {
                    const active = filters.tagIds.includes(t.id);
                    return (
                      <button
                        key={t.id}
                        type="button"
                        onClick={() => toggleTag(t.id)}
                        className={`px-2 py-0.5 rounded border text-[11px] transition-colors cursor-pointer ${
                          active
                            ? 'bg-indigo-600/25 border-indigo-500 text-indigo-200'
                            : 'bg-zinc-900 border-zinc-800 text-zinc-300'
                        }`}
                      >
                        #{t.name}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          {/* Saved Searches Row */}
          <div className="lg:col-span-12 flex flex-wrap items-center justify-between gap-2 pt-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-zinc-400 font-medium">Saved Searches:</span>
              {savedSearches.length === 0 ? (
                <span className="text-zinc-500">None saved</span>
              ) : (
                savedSearches.map((preset) => (
                  <div
                    key={preset.id}
                    className="inline-flex items-center bg-zinc-950 border border-zinc-800 rounded-md overflow-hidden"
                  >
                    <button
                      type="button"
                      onClick={() => onChange({ ...filters, ...preset.filterJson, query: preset.queryString })}
                      className="px-2.5 py-1 text-zinc-200 hover:bg-zinc-800 transition-colors cursor-pointer"
                    >
                      {preset.name}
                    </button>
                    <button
                      type="button"
                      onClick={() => onDeleteSavedSearch(preset.id)}
                      className="px-1.5 py-1 text-zinc-500 hover:text-rose-400 hover:bg-zinc-800 transition-colors cursor-pointer"
                      title="Delete Saved Search"
                    >
                      ×
                    </button>
                  </div>
                ))
              )}
            </div>

            <div className="flex items-center gap-2">
              {showPresetInput ? (
                <>
                  <input
                    type="text"
                    value={newPresetName}
                    onChange={(e) => setNewPresetName(e.target.value)}
                    placeholder="Preset name..."
                    className="px-2.5 py-1 bg-zinc-950 border border-zinc-800 rounded text-zinc-100"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      if (newPresetName.trim()) {
                        onSaveSearch(newPresetName.trim());
                        setNewPresetName('');
                        setShowPresetInput(false);
                      }
                    }}
                    className="px-2.5 py-1 bg-indigo-600 text-white rounded hover:bg-indigo-500 cursor-pointer"
                  >
                    Save
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  onClick={() => setShowPresetInput(true)}
                  className="inline-flex items-center gap-1 px-2.5 py-1 bg-zinc-950 border border-zinc-800 hover:border-zinc-700 text-zinc-300 rounded cursor-pointer"
                >
                  <BookmarkPlus className="w-3.5 h-3.5" />
                  <span>Save Current Filter</span>
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    )}
  </section>
);
};
