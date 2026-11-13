import React, { useEffect, useRef, useState } from 'react';
import {
  CheckSquare,
  Square,
  Heart,
  Star,
  Download,
  RotateCcw,
  FolderOpen,
  RefreshCw,
  Settings,
  CheckCircle2,
  AlertTriangle,
  HelpCircle,
  Sparkles,
  Trash2,
  Archive,
  Tag,
  UserPlus,
  FolderPlus,
} from 'lucide-react';
import type {
  CharacterProfile,
  DependencyStatus,
  ImageLoraRecord,
  ImageRecord,
  LoraExplorerItem,
  QueuedGhostCardItem,
} from '../shared/types.ts';
import { formatImageAspectRatio } from '../shared/utils.ts';
import type { GalleryViewLayout } from './GalleryFilterBar.tsx';

function formatLoraPillLabel(lora: ImageLoraRecord, explorerLoras: LoraExplorerItem[]): string {
  const rawName = (lora.loraName || '').trim().replace(/^.*[\\/]/, '');
  const cleanStem = rawName.replace(/\.(safetensors|pt|ckpt|bin)$/i, '');
  const lowerRaw = rawName.toLowerCase();
  const lowerStem = cleanStem.toLowerCase();

  const match = explorerLoras.find(
    (l) => l.filename.toLowerCase() === lowerRaw || l.name.toLowerCase() === lowerStem
  );
  const nick = (match?.nickname || '').trim().replace(/^@+/, '');
  if (nick) return nick;
  if (match?.name?.trim()) return match.name.trim();
  return cleanStem || 'LoRA';
}

interface GalleryGridViewProps {
  images: ImageRecord[];
  loras?: LoraExplorerItem[];
  ghostItems?: QueuedGhostCardItem[];
  page: number;
  pageSize?: number;
  infiniteScroll: boolean;
  layout: GalleryViewLayout;
  thumbScale: 'sm' | 'md' | 'lg';
  selectedIds: Set<number>;
  onToggleSelect: (id: number) => void;
  onSelectAll: () => void;
  onClearSelection: () => void;
  onOpenInspector: (image: ImageRecord) => void;
  onReusePrompt?: (image: ImageRecord) => void;
  onQuickRate: (id: number, rating: number) => void;
  onQuickFavorite: (id: number, nextFav: boolean) => void;
  onQuickReject?: (id: number, nextRejected: boolean) => void;
  onBulkAction: (payload: any) => Promise<void>;
  onExportSelectedZip: () => void;
  characters: CharacterProfile[];
  collections: { id: number; name: string }[];
  mountedOutputDir: string;
  onTriggerScan: () => void;
  onOpenSystemSettings: () => void;
  isLoading?: boolean;
}

export function renderDependencyLabel(status: DependencyStatus) {
  switch (status) {
    case 'exact_match':
      return (
        <span className="inline-flex items-center gap-1 text-emerald-400">
          <CheckCircle2 className="w-3 h-3" />
          <span>Exact Match</span>
        </span>
      );
    case 'available':
      return (
        <span className="inline-flex items-center gap-1 text-sky-400">
          <CheckCircle2 className="w-3 h-3" />
          <span>Available</span>
        </span>
      );
    case 'incomplete':
      return (
        <span className="inline-flex items-center gap-1 text-amber-400">
          <AlertTriangle className="w-3 h-3" />
          <span>Incomplete</span>
        </span>
      );
    default:
      return (
        <span className="inline-flex items-center gap-1 text-zinc-400">
          <HelpCircle className="w-3 h-3" />
          <span>Unknown</span>
        </span>
      );
  }
}

/**
 * Gallery Grid & Masonry Viewport with Pagination, Multi-Select Dock, and Zero-Pill Metadata.
 */
export const GalleryGridView: React.FC<GalleryGridViewProps> = ({
  images,
  loras = [],
  ghostItems = [],
  page,
  pageSize = 48,
  infiniteScroll,
  layout,
  thumbScale,
  selectedIds,
  onToggleSelect,
  onSelectAll,
  onClearSelection,
  onOpenInspector,
  onReusePrompt,
  onQuickRate,
  onQuickFavorite,
  onQuickReject,
  onBulkAction,
  onExportSelectedZip,
  characters,
  collections,
  mountedOutputDir,
  onTriggerScan,
  onOpenSystemSettings,
  isLoading = false,
}) => {
  const [bulkTagInput, setBulkTagInput] = useState('');
  const [bulkCharId, setBulkCharId] = useState('');
  const [bulkColId, setBulkColId] = useState('');
  const [infiniteVisibleCount, setInfiniteVisibleCount] = useState<number>(pageSize);
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  const totalPages = Math.max(1, Math.ceil(images.length / pageSize));
  const currentPage = Math.min(Math.max(1, page), totalPages);

  // When switching into infinite scroll, keep at least the current page's depth visible
  useEffect(() => {
    if (infiniteScroll) {
      setInfiniteVisibleCount((prev) => Math.max(prev, currentPage * pageSize));
    } else {
      setInfiniteVisibleCount(pageSize);
    }
  }, [infiniteScroll, currentPage, pageSize]);

  // Reset infinite scroll slice to 1 batch (48) when the filtered image set is replaced/narrowed
  useEffect(() => {
    setInfiniteVisibleCount((prev) => {
      if (images.length <= pageSize) return pageSize;
      return Math.min(Math.max(pageSize, prev), images.length);
    });
  }, [images.length, pageSize]);

  // IntersectionObserver to load +48 images per scroll batch when Infinite Scroll is active
  useEffect(() => {
    if (!infiniteScroll) return;
    const node = sentinelRef.current;
    if (!node) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          setInfiniteVisibleCount((prev) => Math.min(images.length, prev + pageSize));
        }
      },
      { rootMargin: '400px' }
    );

    observer.observe(node);
    return () => observer.disconnect();
  }, [infiniteScroll, images.length, pageSize, infiniteVisibleCount]);

  const pagedImages = infiniteScroll
    ? images.slice(0, Math.min(images.length, infiniteVisibleCount))
    : images.slice((currentPage - 1) * pageSize, currentPage * pageSize);

  const getGridClasses = () => {
    if (layout === 'masonry') {
      if (thumbScale === 'sm') return 'columns-2 sm:columns-4 lg:columns-6 xl:columns-7 gap-3 space-y-3';
      if (thumbScale === 'lg') return 'columns-1 sm:columns-2 lg:columns-3 xl:columns-4 gap-4 space-y-4';
      return 'columns-2 sm:columns-3 lg:columns-4 xl:columns-5 gap-4 space-y-4';
    }
    if (layout === 'compact') {
      if (thumbScale === 'sm') return 'grid grid-cols-3 sm:grid-cols-6 lg:grid-cols-8 xl:grid-cols-10 gap-2';
      if (thumbScale === 'lg') return 'grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3';
      return 'grid grid-cols-3 sm:grid-cols-5 lg:grid-cols-6 xl:grid-cols-8 gap-2.5';
    }
    // Standard Grid
    if (thumbScale === 'sm') return 'grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 xl:grid-cols-7 gap-3.5';
    if (thumbScale === 'lg') return 'grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5';
    return 'grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4';
  };

  // Loading Skeleton State: renders layout-matching skeleton cards while images are in-flight
  if (isLoading) {
    const skeletonCount = 12;
    return (
      <div className="px-6 py-5 space-y-4">
        {/* Skeleton Top Counter */}
        <div className="flex items-center gap-2">
          <div className="w-4 h-4 rounded-full border-2 border-indigo-500 border-t-transparent animate-spin shrink-0" />
          <span className="text-xs text-zinc-400 font-medium">Loading indexed image gallery...</span>
        </div>

        {/* Skeleton Responsive Card Grid */}
        <div className={getGridClasses()}>
          {Array.from({ length: skeletonCount }).map((_, idx) => (
            <div
              key={idx}
              className={`bg-zinc-900 border border-zinc-800/80 rounded-xl overflow-hidden animate-pulse ${
                layout === 'masonry' ? 'break-inside-avoid mb-4' : ''
              }`}
            >
              <div
                className={`w-full bg-zinc-800/50 ${
                  layout === 'compact'
                    ? 'aspect-square'
                    : idx % 3 === 0
                    ? 'aspect-[2/3]'
                    : idx % 2 === 0
                    ? 'aspect-[3/4]'
                    : 'aspect-square'
                }`}
              />
              {layout !== 'compact' && (
                <div className="p-3 space-y-2">
                  <div className="h-3.5 bg-zinc-800/80 rounded w-3/4" />
                  <div className="h-2.5 bg-zinc-800/50 rounded w-1/2" />
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    );
  }

  const visibleGhostItems = ghostItems.filter(
    (g) => !g.outputImageId || !images.some((img) => img.id === g.outputImageId)
  );

  // Empty State when mounted ComfyUI output directory has no indexed images and no active queued jobs
  if (images.length === 0 && visibleGhostItems.length === 0) {
    return (
      <div className="max-w-2xl mx-auto my-16 px-6 py-12 bg-zinc-900/70 border border-zinc-800/80 rounded-xl text-center space-y-5">
        <div className="w-12 h-12 rounded-xl bg-zinc-800/80 border border-zinc-700/60 flex items-center justify-center mx-auto text-indigo-400">
          <FolderOpen className="w-6 h-6" />
        </div>
        <div className="space-y-2">
          <h2 className="text-xl font-display font-semibold text-zinc-100">
            No Indexed Images in Mounted Output Directory
          </h2>
          <p className="text-sm text-zinc-400 max-w-lg mx-auto leading-relaxed">
            Couchy is actively monitoring your mounted ComfyUI output directory in read-only mode.
            Any PNG, JPEG, or WebP generations placed into the folder below are automatically indexed with full
            workflow and multi-LoRA extraction.
          </p>
        </div>

        <div className="bg-zinc-950 border border-zinc-800 rounded-lg px-4 py-3 text-xs font-mono text-zinc-300 inline-block">
          Watched Mount Path: <span className="text-indigo-300">{mountedOutputDir}</span>
        </div>

        <div className="flex flex-wrap items-center justify-center gap-3 pt-2">
          <button
            type="button"
            onClick={onTriggerScan}
            className="inline-flex items-center gap-2 px-4 py-2 text-xs font-medium text-white bg-indigo-600 hover:bg-indigo-500 rounded-lg transition-colors cursor-pointer"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            <span>Scan Mounted Directory Now</span>
          </button>
          <button
            type="button"
            onClick={onOpenSystemSettings}
            className="inline-flex items-center gap-2 px-4 py-2 text-xs font-medium text-zinc-200 bg-zinc-800 hover:bg-zinc-700 rounded-lg transition-colors cursor-pointer"
          >
            <Settings className="w-3.5 h-3.5" />
            <span>Configure Paths & ComfyUI</span>
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="px-6 py-5 space-y-6">
      {/* Selection & Result Summary Bar */}
      <div className="flex flex-wrap items-center justify-between gap-4 text-xs text-zinc-400">
        <div className="flex items-center gap-3">
          <span>
            Showing <strong className="font-mono tabular-nums text-zinc-200">{pagedImages.length}</strong> of{' '}
            <strong className="font-mono tabular-nums text-zinc-200">{images.length}</strong> indexed images
            {visibleGhostItems.length > 0 && (
              <span className="text-indigo-300 font-mono tabular-nums">
                {' '}· {visibleGhostItems.length} in queue
              </span>
            )}
          </span>
          <span aria-hidden="true">·</span>
          <button
            type="button"
            onClick={selectedIds.size === images.length ? onClearSelection : onSelectAll}
            className="text-indigo-400 hover:text-indigo-300 font-medium cursor-pointer"
          >
            {selectedIds.size === images.length ? 'Deselect All' : 'Select All Matching'}
          </button>
          {selectedIds.size > 0 && (
            <>
              <span aria-hidden="true">·</span>
              <span className="text-zinc-200 font-mono tabular-nums">{selectedIds.size} selected</span>
            </>
          )}
        </div>
      </div>

      {/* Multi-Select Floating Bulk Operations Bar */}
      {selectedIds.size > 0 && (
        <div className="bg-zinc-900 border border-indigo-500/50 rounded-xl p-3.5 flex flex-wrap items-center justify-between gap-3 shadow-lg">
          <div className="flex flex-wrap items-center gap-3 text-xs">
            <span className="font-medium text-indigo-300 font-mono tabular-nums">
              {selectedIds.size} Selected
            </span>

            {/* Bulk Star Rating */}
            <div className="flex items-center gap-1 border-l border-zinc-800 pl-3">
              {[1, 2, 3, 4, 5].map((star) => (
                <button
                  key={star}
                  type="button"
                  onClick={() => onBulkAction({ rating: star })}
                  className="p-1 text-zinc-400 hover:text-amber-400 cursor-pointer"
                  title={`Rate ${star} Stars`}
                >
                  <Star className="w-3.5 h-3.5" />
                </button>
              ))}
            </div>

            {/* Bulk Favorite / Reject / Archive */}
            <button
              type="button"
              onClick={() => onBulkAction({ isFavorite: true })}
              className="inline-flex items-center gap-1 px-2.5 py-1 bg-zinc-950 border border-zinc-800 hover:border-zinc-700 text-zinc-200 rounded cursor-pointer"
            >
              <Heart className="w-3.5 h-3.5 text-rose-400" />
              <span>Favorite</span>
            </button>
            <button
              type="button"
              onClick={() => onBulkAction({ isArchived: true })}
              className="inline-flex items-center gap-1 px-2.5 py-1 bg-zinc-950 border border-zinc-800 hover:border-zinc-700 text-zinc-200 rounded cursor-pointer"
            >
              <Archive className="w-3.5 h-3.5" />
              <span>Archive</span>
            </button>
            <button
              type="button"
              onClick={() => onBulkAction({ isRejected: true })}
              className="inline-flex items-center gap-1 px-2.5 py-1 bg-zinc-950 border border-zinc-800 hover:border-zinc-700 text-rose-300 rounded cursor-pointer"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>Reject</span>
            </button>

            {/* Bulk Add Tag */}
            <div className="flex items-center gap-1 border-l border-zinc-800 pl-3">
              <Tag className="w-3.5 h-3.5 text-zinc-400" />
              <input
                type="text"
                value={bulkTagInput}
                onChange={(e) => setBulkTagInput(e.target.value)}
                placeholder="Add tag..."
                className="w-24 px-2 py-1 bg-zinc-950 border border-zinc-800 rounded text-zinc-200"
              />
              <button
                type="button"
                onClick={() => {
                  if (bulkTagInput.trim()) {
                    onBulkAction({ addTagName: bulkTagInput.trim() });
                    setBulkTagInput('');
                  }
                }}
                className="px-2 py-1 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 rounded cursor-pointer"
              >
                Apply
              </button>
            </div>

            {/* Bulk Assign Character */}
            {characters.length > 0 && (
              <div className="flex items-center gap-1 border-l border-zinc-800 pl-3">
                <UserPlus className="w-3.5 h-3.5 text-zinc-400" />
                <select
                  value={bulkCharId}
                  onChange={(e) => setBulkCharId(e.target.value)}
                  className="px-2 py-1 bg-zinc-950 border border-zinc-800 rounded text-zinc-200"
                >
                  <option value="">Assign Character...</option>
                  {characters.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={() => {
                    if (bulkCharId) {
                      onBulkAction({ addCharacterId: Number(bulkCharId) });
                      setBulkCharId('');
                    }
                  }}
                  className="px-2 py-1 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 rounded cursor-pointer"
                >
                  Assign
                </button>
              </div>
            )}

            {/* Bulk Assign Collection */}
            {collections.length > 0 && (
              <div className="flex items-center gap-1 border-l border-zinc-800 pl-3">
                <FolderPlus className="w-3.5 h-3.5 text-zinc-400" />
                <select
                  value={bulkColId}
                  onChange={(e) => setBulkColId(e.target.value)}
                  className="px-2 py-1 bg-zinc-950 border border-zinc-800 rounded text-zinc-200"
                >
                  <option value="">Add to Collection...</option>
                  {collections.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={() => {
                    if (bulkColId) {
                      onBulkAction({ addCollectionId: Number(bulkColId) });
                      setBulkColId('');
                    }
                  }}
                  className="px-2 py-1 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 rounded cursor-pointer"
                >
                  Add
                </button>
              </div>
            )}
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onExportSelectedZip}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg cursor-pointer"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Download Selected (.ZIP)</span>
            </button>
            <button
              type="button"
              onClick={onClearSelection}
              className="px-2.5 py-1.5 text-xs text-zinc-400 hover:text-zinc-200 cursor-pointer"
            >
              Clear
            </button>
          </div>
        </div>
      )}

      {/* Main Gallery Viewport */}
      <div className={getGridClasses()}>
        {/* Queued & Actively Generating Ghost Preview Cards (Pinned to top on Page 1 or Infinite Scroll) */}
        {(currentPage === 1 || infiniteScroll) &&
          visibleGhostItems.map((ghost) => {
            const isQueuedOnly = ghost.state === 'queued' || ghost.progressPercent === null;
            const displayPct = Math.min(100, Math.max(0, ghost.progressPercent ?? 0));
            const titleText = ghost.prompt.trim() || `Generation #${ghost.itemIndex}`;

            return (
              <article
                key={`ghost-${ghost.itemId}`}
                aria-busy="true"
                className="relative bg-zinc-900 border border-zinc-800/80 rounded-xl overflow-hidden break-inside-avoid select-none pointer-events-none"
              >
                {/* Ghost Image Placeholder Area */}
                <div
                  style={
                    layout === 'masonry'
                      ? { aspectRatio: `${ghost.width} / ${ghost.height}` }
                      : undefined
                  }
                  className={`relative bg-zinc-950/90 overflow-hidden flex flex-col items-center justify-center p-4 text-center ${
                    layout === 'masonry' ? 'w-full' : 'aspect-square w-full'
                  }`}
                >
                  {isQueuedOnly ? (
                    <div className="flex flex-col items-center gap-2">
                      <span className="w-2 h-2 rounded-full bg-zinc-500 animate-pulse" />
                      <span className="text-xs font-medium tracking-wider uppercase text-zinc-400">
                        Pending
                      </span>
                    </div>
                  ) : (
                    <div className="flex flex-col items-center gap-2.5 w-full max-w-[140px]">
                      <span className="text-2xl sm:text-3xl font-mono font-semibold tabular-nums text-indigo-300 tracking-tight">
                        {displayPct}%
                      </span>
                      <div className="w-full h-1.5 bg-zinc-800/90 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-indigo-500 transition-all duration-300 ease-out rounded-full"
                          style={{ width: `${displayPct}%` }}
                        />
                      </div>
                    </div>
                  )}
                </div>

                {/* Card Footer matching standard gallery card layout */}
                {layout !== 'compact' && (
                  <div className="p-3 space-y-2">
                    {/* Resolution, Ratio & Checkpoint Line */}
                    <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-zinc-400 font-mono tabular-nums">
                      <span>
                        {ghost.width}×{ghost.height}
                      </span>
                      {ghost.width > 0 && ghost.height > 0 && (
                        <>
                          <span aria-hidden="true">·</span>
                          <span>{formatImageAspectRatio(ghost.width, ghost.height)}</span>
                        </>
                      )}
                      <span aria-hidden="true">·</span>
                      <span className="truncate max-w-[150px] font-sans">
                        {ghost.checkpointName || 'No Checkpoint'}
                      </span>
                    </div>

                    {/* Character Line */}
                    <div className="flex items-center justify-between gap-2 text-[11px]">
                      <div className="truncate text-zinc-300">
                        {ghost.characterName ? (
                          <span>{ghost.characterName}</span>
                        ) : (
                          <span className="text-zinc-500">Unassigned</span>
                        )}
                      </div>
                    </div>
                  </div>
                )}
              </article>
            );
          })}

        {pagedImages.map((img) => {
          const isSelected = selectedIds.has(img.id);
          const confirmedChars = img.characters.filter((c) => c.status === 'confirmed');
          const suggestedChars = img.characters.filter((c) => c.status === 'suggested');

          return (
            <article
              key={img.id}
              className={`group relative bg-zinc-900 border rounded-xl overflow-hidden transition-all duration-300 break-inside-avoid ${
                isSelected ? 'border-indigo-500 ring-1 ring-indigo-500' : 'border-zinc-800/80 hover:border-zinc-700'
              }`}
            >
              {/* Image Container */}
              <div
                onClick={() => onOpenInspector(img)}
                className={`relative bg-zinc-950 overflow-hidden cursor-pointer ${
                  layout === 'masonry' ? 'w-full' : 'aspect-square w-full'
                }`}
              >
                <img
                  src={img.thumbnailUrl}
                  alt={img.filename}
                  width={img.width || undefined}
                  height={img.height || undefined}
                  loading="lazy"
                  decoding="async"
                  referrerPolicy="no-referrer"
                  className={`w-full ${
                    layout === 'masonry' ? 'h-auto object-contain' : 'h-full object-cover'
                  } transition-transform duration-200 group-hover:scale-[1.02]`}
                />

                {/* Top Overlay Controls (Select & Favorite) */}
                <div
                  className="absolute top-2 left-2 right-2 flex items-center justify-between pointer-events-none z-10"
                  onClick={(e) => e.stopPropagation()}
                >
                  <button
                    type="button"
                    onClick={() => onToggleSelect(img.id)}
                    aria-label={`Select ${img.filename}`}
                    className={`pointer-events-auto p-1.5 rounded-md bg-black/65 backdrop-blur-xs text-zinc-100 hover:bg-black/85 transition-opacity cursor-pointer mobile-show-actions ${
                      isSelected
                        ? 'opacity-100 text-indigo-400'
                        : 'opacity-100 sm:opacity-0 sm:group-hover:opacity-100'
                    }`}
                  >
                    {isSelected ? <CheckSquare className="w-4 h-4" /> : <Square className="w-4 h-4" />}
                  </button>

                  <button
                    type="button"
                    onClick={() => onQuickFavorite(img.id, !img.isFavorite)}
                    aria-label="Toggle Favorite"
                    className={`pointer-events-auto p-1.5 rounded-md bg-black/65 backdrop-blur-xs transition-opacity cursor-pointer mobile-show-actions ${
                      img.isFavorite
                        ? 'opacity-100 text-rose-400'
                        : 'opacity-100 sm:opacity-0 sm:group-hover:opacity-100 text-zinc-300 hover:text-rose-400'
                    }`}
                  >
                    <Heart className={`w-4 h-4 ${img.isFavorite ? 'fill-rose-400' : ''}`} />
                  </button>
                </div>

                {/* Bottom Gradient Scrim: Always visible on mobile, hover on desktop */}
                <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 via-black/45 to-transparent p-1.5 sm:p-2.5 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity flex items-center justify-between text-xs mobile-show-actions z-10">
                  <div
                    className="flex items-center gap-0.5 shrink-0"
                    onClick={(e) => e.stopPropagation()}
                  >
                    {[1, 2, 3, 4, 5].map((star) => (
                      <button
                        key={star}
                        type="button"
                        onClick={() => onQuickRate(img.id, img.rating === star ? 0 : star)}
                        className="p-0.5 cursor-pointer"
                      >
                        <Star
                          className={`w-3.5 h-3.5 ${
                            star <= img.rating
                              ? 'fill-amber-400 text-amber-400'
                              : 'text-zinc-400 hover:text-amber-300'
                          }`}
                        />
                      </button>
                    ))}
                  </div>
                  <div className="flex items-center gap-1">
                    {onReusePrompt && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onReusePrompt(img);
                        }}
                        className="p-1 text-zinc-300 hover:text-white hover:bg-zinc-800/80 rounded transition-colors cursor-pointer"
                        title="Reuse prompt & settings in Quick Gen"
                      >
                        <RotateCcw className="w-3.5 h-3.5" />
                      </button>
                    )}
                    <a
                      href={`/api/images/${img.id}/file?download=1`}
                      onClick={(e) => e.stopPropagation()}
                      className="p-1 text-zinc-200 hover:text-white hover:bg-zinc-800/80 rounded transition-colors"
                      title="Download Unchanged Original File"
                    >
                      <Download className="w-3.5 h-3.5" />
                    </a>
                    {onQuickReject && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onQuickReject(img.id, !img.isRejected);
                        }}
                        className={`p-1 rounded transition-colors cursor-pointer ${
                          img.isRejected
                            ? 'text-rose-400 hover:text-rose-300 hover:bg-rose-950/60'
                            : 'text-zinc-300 hover:text-rose-400 hover:bg-zinc-800/80'
                        }`}
                        title={img.isRejected ? 'Restore from rejected' : 'Reject image (hide from library)'}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                </div>
              </div>

              {/* Card Footer */}
              {layout !== 'compact' && (
                <div
                  onClick={() => onOpenInspector(img)}
                  className="p-3 space-y-2 cursor-pointer"
                >
                  {/* Resolution, Ratio & Checkpoint Line */}
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-zinc-400 font-mono tabular-nums min-w-0">
                      <span>
                        {img.width}×{img.height}
                      </span>
                      {img.width > 0 && img.height > 0 && (
                        <>
                          <span aria-hidden="true">·</span>
                          <span>{formatImageAspectRatio(img.width, img.height)}</span>
                        </>
                      )}
                      <span aria-hidden="true">·</span>
                      <span className="truncate max-w-[150px] font-sans">
                        {img.checkpointName || 'No Checkpoint'}
                      </span>
                    </div>
                    {img.rating > 0 && (
                      <span className="text-xs font-mono tabular-nums text-amber-400 shrink-0">
                        ★ {img.rating}
                      </span>
                    )}
                  </div>

                  {/* LoRA Pills */}
                  {img.loras.length > 0 && (
                    <div className="flex flex-wrap items-center gap-1">
                      {img.loras.map((lora, idx) => {
                        const label = formatLoraPillLabel(lora, loras);
                        return (
                          <span
                            key={`${lora.loraName}-${idx}`}
                            title={`${lora.loraName} (${lora.modelStrength.toFixed(1)}x)`}
                            className="inline-flex items-center px-2 py-0.5 rounded-full bg-zinc-800/90 border border-zinc-700/80 text-[10px] font-medium text-zinc-200 truncate max-w-[150px]"
                          >
                            {label}
                          </span>
                        );
                      })}
                    </div>
                  )}

                  {/* Character Line */}
                  <div className="flex items-center justify-between gap-2 text-[11px]">
                    <div className="truncate text-zinc-300">
                      {confirmedChars.length > 0 ? (
                        <span>{confirmedChars.map((c) => c.characterName).join(' · ')}</span>
                      ) : suggestedChars.length > 0 ? (
                        <span className="inline-flex items-center gap-1 text-amber-300">
                          <Sparkles className="w-3 h-3" />
                          <span>Suggested: {suggestedChars[0].characterName}</span>
                        </span>
                      ) : (
                        <span className="text-zinc-500">Unassigned</span>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </article>
          );
        })}
      </div>

      {/* Infinite Scroll Bottom Sentinel (+48 images per batch) */}
      {infiniteScroll && pagedImages.length < images.length && (
        <div
          ref={sentinelRef}
          className="py-6 flex flex-col items-center justify-center gap-2 text-xs text-zinc-400 font-mono tabular-nums"
        >
          <button
            type="button"
            onClick={() =>
              setInfiniteVisibleCount((prev) => Math.min(images.length, prev + pageSize))
            }
            className="px-3.5 py-1.5 bg-zinc-900 border border-zinc-800 hover:border-zinc-700 text-zinc-300 rounded-lg transition-colors cursor-pointer"
          >
            Showing {pagedImages.length} of {images.length} · Load next {Math.min(pageSize, images.length - pagedImages.length)}
          </button>
        </div>
      )}
    </div>
  );
};
