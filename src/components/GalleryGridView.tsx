import React, { useState } from 'react';
import {
  CheckSquare,
  Square,
  Heart,
  Star,
  Download,
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
  ImageRecord,
} from '../shared/types.ts';
import type { GalleryViewLayout } from './GalleryFilterBar.tsx';

interface GalleryGridViewProps {
  images: ImageRecord[];
  layout: GalleryViewLayout;
  thumbScale: 'sm' | 'md' | 'lg';
  selectedIds: Set<number>;
  onToggleSelect: (id: number) => void;
  onSelectAll: () => void;
  onClearSelection: () => void;
  onOpenInspector: (image: ImageRecord) => void;
  onQuickRate: (id: number, rating: number) => void;
  onQuickFavorite: (id: number, nextFav: boolean) => void;
  onBulkAction: (payload: any) => Promise<void>;
  onExportSelectedZip: () => void;
  characters: CharacterProfile[];
  collections: { id: number; name: string }[];
  mountedOutputDir: string;
  onTriggerScan: () => void;
  onOpenSystemSettings: () => void;
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
  layout,
  thumbScale,
  selectedIds,
  onToggleSelect,
  onSelectAll,
  onClearSelection,
  onOpenInspector,
  onQuickRate,
  onQuickFavorite,
  onBulkAction,
  onExportSelectedZip,
  characters,
  collections,
  mountedOutputDir,
  onTriggerScan,
  onOpenSystemSettings,
}) => {
  const [page, setPage] = useState(1);
  const pageSize = 48;
  const [bulkTagInput, setBulkTagInput] = useState('');
  const [bulkCharId, setBulkCharId] = useState('');
  const [bulkColId, setBulkColId] = useState('');

  const totalPages = Math.max(1, Math.ceil(images.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const pagedImages = images.slice((currentPage - 1) * pageSize, currentPage * pageSize);

  // Empty State when mounted ComfyUI output directory has no indexed images
  if (images.length === 0) {
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
            ComfyUI Gallery is actively monitoring your mounted ComfyUI output directory in read-only mode.
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

  return (
    <div className="px-6 py-5 space-y-6">
      {/* Selection & Result Summary Bar */}
      <div className="flex flex-wrap items-center justify-between gap-4 text-xs text-zinc-400">
        <div className="flex items-center gap-3">
          <span>
            Showing <strong className="font-mono tabular-nums text-zinc-200">{pagedImages.length}</strong> of{' '}
            <strong className="font-mono tabular-nums text-zinc-200">{images.length}</strong> indexed images
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

        {totalPages > 1 && (
          <div className="flex items-center gap-2 font-mono tabular-nums">
            <button
              type="button"
              disabled={currentPage <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              className="px-2.5 py-1 bg-zinc-900 border border-zinc-800 rounded disabled:opacity-40 text-zinc-200 cursor-pointer"
            >
              Prev
            </button>
            <span>
              Page {currentPage} / {totalPages}
            </span>
            <button
              type="button"
              disabled={currentPage >= totalPages}
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              className="px-2.5 py-1 bg-zinc-900 border border-zinc-800 rounded disabled:opacity-40 text-zinc-200 cursor-pointer"
            >
              Next
            </button>
          </div>
        )}
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
        {pagedImages.map((img) => {
          const isSelected = selectedIds.has(img.id);
          const confirmedChars = img.characters.filter((c) => c.status === 'confirmed');
          const suggestedChars = img.characters.filter((c) => c.status === 'suggested');

          return (
            <article
              key={img.id}
              className={`group relative bg-zinc-900 border rounded-xl overflow-hidden transition-colors break-inside-avoid ${
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
                  loading="lazy"
                  referrerPolicy="no-referrer"
                  className={`w-full ${
                    layout === 'masonry' ? 'h-auto object-contain' : 'h-full object-cover'
                  } transition-transform duration-200 group-hover:scale-[1.02]`}
                />

                {/* Top Overlay Controls (Select & Favorite) */}
                <div
                  className="absolute top-2 left-2 right-2 flex items-center justify-between pointer-events-none"
                  onClick={(e) => e.stopPropagation()}
                >
                  <button
                    type="button"
                    onClick={() => onToggleSelect(img.id)}
                    aria-label={`Select ${img.filename}`}
                    className={`pointer-events-auto p-1.5 rounded-md bg-black/65 backdrop-blur-xs text-zinc-100 hover:bg-black/85 transition-opacity cursor-pointer ${
                      isSelected ? 'opacity-100 text-indigo-400' : 'opacity-0 group-hover:opacity-100'
                    }`}
                  >
                    {isSelected ? <CheckSquare className="w-4 h-4" /> : <Square className="w-4 h-4" />}
                  </button>

                  <button
                    type="button"
                    onClick={() => onQuickFavorite(img.id, !img.isFavorite)}
                    aria-label="Toggle Favorite"
                    className={`pointer-events-auto p-1.5 rounded-md bg-black/65 backdrop-blur-xs transition-opacity cursor-pointer ${
                      img.isFavorite
                        ? 'opacity-100 text-rose-400'
                        : 'opacity-0 group-hover:opacity-100 text-zinc-300 hover:text-rose-400'
                    }`}
                  >
                    <Heart className={`w-4 h-4 ${img.isFavorite ? 'fill-rose-400' : ''}`} />
                  </button>
                </div>

                {/* Bottom Gradient Scrim on Hover */}
                <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 via-black/45 to-transparent p-2.5 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-between text-xs">
                  <div
                    className="flex items-center gap-0.5"
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
                  <a
                    href={`/api/images/${img.id}/file?download=1`}
                    onClick={(e) => e.stopPropagation()}
                    className="p-1 text-zinc-200 hover:text-white"
                    title="Download Unchanged Original File"
                  >
                    <Download className="w-3.5 h-3.5" />
                  </a>
                </div>
              </div>

              {/* Card Footer (Clean Zero-Pill Unboxed Metadata with · Separators) */}
              {layout !== 'compact' && (
                <div
                  onClick={() => onOpenInspector(img)}
                  className="p-3 space-y-1.5 cursor-pointer"
                >
                  <div className="flex items-center justify-between gap-2">
                    <h3 className="text-xs font-medium text-zinc-100 truncate">{img.filename}</h3>
                    {img.rating > 0 && (
                      <span className="text-xs font-mono tabular-nums text-amber-400 shrink-0">
                        ★ {img.rating}
                      </span>
                    )}
                  </div>

                  {/* Unboxed Metadata Line */}
                  <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-zinc-400 font-mono tabular-nums">
                    <span>
                      {img.width}×{img.height}
                    </span>
                    <span aria-hidden="true">·</span>
                    <span className="truncate max-w-[140px] font-sans">
                      {img.checkpointName || 'No Checkpoint'}
                    </span>
                    {img.loras.length > 0 && (
                      <>
                        <span aria-hidden="true">·</span>
                        <span>{img.loras.length} LoRA{img.loras.length > 1 ? 's' : ''}</span>
                      </>
                    )}
                  </div>

                  {/* Character & Dependency Line */}
                  <div className="flex flex-wrap items-center justify-between gap-2 pt-0.5 text-[11px]">
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
                    {renderDependencyLabel(img.dependencyStatus)}
                  </div>
                </div>
              )}
            </article>
          );
        })}
      </div>
    </div>
  );
};
