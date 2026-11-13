import React, { useState } from 'react';
import {
  Heart,
  Layers,
  Loader2,
  MessageSquare,
  Star,
  Trash2,
  X,
} from 'lucide-react';
import type { ImageSeriesItem, QueuedGhostCardItem } from '../../shared/types.ts';

interface SeriesMiniGalleryModalProps {
  items: ImageSeriesItem[];
  activeImageId: number;
  pendingGhosts?: QueuedGhostCardItem[];
  onClose: () => void;
  onSelectIteration: (imageId: number) => void;
  onToggleFavorite: (imageId: number, nextFavorite: boolean) => Promise<void>;
  onRejectIteration: (imageId: number) => Promise<void>;
  onOpenConversationForStep?: (imageId: number) => Promise<void>;
}

/**
 * Floating contact-sheet modal rendered above the Image Inspector backdrop
 * for side-by-side comparison, poster selection, branching, and curation of a series stack.
 */
export const SeriesMiniGalleryModal: React.FC<SeriesMiniGalleryModalProps> = ({
  items,
  activeImageId,
  pendingGhosts = [],
  onClose,
  onSelectIteration,
  onToggleFavorite,
  onRejectIteration,
  onOpenConversationForStep,
}) => {
  const [busyId, setBusyId] = useState<number | null>(null);
  const posterIndex = items.findIndex((it) => it.isFavorite);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Series Stack Mini Gallery"
      onClick={onClose}
      className="fixed inset-0 z-[60] bg-black/75 backdrop-blur-sm flex items-center justify-center p-3 sm:p-6"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-5xl max-h-[88vh] bg-zinc-900 border border-zinc-700/80 rounded-2xl shadow-2xl flex flex-col overflow-hidden"
      >
        {/* Modal Header */}
        <div className="px-4 sm:px-5 py-3.5 border-b border-zinc-800 bg-zinc-900/95 flex items-center justify-between gap-3 shrink-0">
          <div className="flex flex-wrap items-center gap-2.5 min-w-0">
            <div className="w-8 h-8 rounded-lg bg-indigo-500/15 border border-indigo-500/30 flex items-center justify-center text-indigo-400 shrink-0">
              <Layers className="w-4 h-4" />
            </div>
            <div className="min-w-0">
              <h3 className="text-sm sm:text-base font-display font-semibold text-zinc-100 truncate">
                Series Stack Gallery
              </h3>
              <p className="text-[11px] text-zinc-400 font-mono tabular-nums">
                {items.length} {items.length === 1 ? 'image' : 'images'}
                {pendingGhosts.length > 0 && (
                  <span className="text-indigo-300"> · +{pendingGhosts.length} in queue</span>
                )}
                {posterIndex >= 0 && (
                  <span className="text-rose-300"> · Poster: #{posterIndex + 1}</span>
                )}
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg bg-zinc-950 border border-zinc-800 text-zinc-400 hover:text-zinc-100 cursor-pointer shrink-0"
            title="Close Mini Gallery (Esc)"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Scrollable Grid Body */}
        <div className="p-4 sm:p-5 overflow-y-auto flex-1">
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3 sm:gap-4">
            {items.map((item, idx) => {
              const isSelected = item.imageId === activeImageId;
              const isLatest = idx === items.length - 1;
              const isBusy = busyId === item.imageId;

              return (
                <div
                  key={`${item.seriesId}-${item.imageId}`}
                  className={`group rounded-xl overflow-hidden bg-zinc-950 border flex flex-col transition-all ${
                    isSelected
                      ? 'border-indigo-400 ring-2 ring-indigo-500/50'
                      : 'border-zinc-800 hover:border-zinc-600'
                  }`}
                >
                  {/* Thumbnail Trigger -> Jumps Inspector to This Step */}
                  <button
                    type="button"
                    onClick={() => {
                      onSelectIteration(item.imageId);
                      onClose();
                    }}
                    className="relative aspect-[3/4] w-full bg-zinc-900 overflow-hidden cursor-pointer text-left"
                    title={`Inspect Step #${idx + 1} (${item.width}×${item.height})`}
                  >
                    <img
                      src={item.thumbnailUrl}
                      alt={item.filename}
                      referrerPolicy="no-referrer"
                      className="w-full h-full object-cover transition-transform duration-200 group-hover:scale-[1.03]"
                    />

                    {/* Step Badge & Current Indicator */}
                    <div className="absolute top-2 left-2 flex items-center gap-1.5">
                      <span className="px-1.5 py-0.5 rounded bg-black/80 border border-zinc-700/70 text-[10px] font-mono font-semibold text-zinc-100 tabular-nums">
                        #{idx + 1}
                      </span>
                      {isSelected && (
                        <span className="px-1.5 py-0.5 rounded bg-indigo-600/90 text-[10px] font-medium text-white">
                          Viewing
                        </span>
                      )}
                    </div>

                    {/* Poster / Star Indicators */}
                    <div className="absolute top-2 right-2 flex items-center gap-1">
                      {item.rating > 0 && (
                        <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-black/80 text-[10px] font-mono text-amber-300 tabular-nums">
                          <Star className="w-2.5 h-2.5 fill-amber-400 text-amber-400" />
                          {item.rating}
                        </span>
                      )}
                    </div>

                    {/* Resolution Chip */}
                    <div className="absolute bottom-2 left-2">
                      <span className="px-1.5 py-0.5 rounded bg-black/75 text-[10px] font-mono text-zinc-300 tabular-nums">
                        {item.width}×{item.height}
                      </span>
                    </div>
                  </button>

                  {/* Compact Curation & Action Footer */}
                  <div className="px-2.5 py-2 border-t border-zinc-800/80 bg-zinc-950 flex items-center justify-between gap-1.5">
                    <button
                      type="button"
                      disabled={isBusy}
                      onClick={async () => {
                        setBusyId(item.imageId);
                        try {
                          await onToggleFavorite(item.imageId, !item.isFavorite);
                        } finally {
                          setBusyId(null);
                        }
                      }}
                      className={`inline-flex items-center gap-1 px-2 py-1 rounded-md border text-[11px] font-medium transition-colors cursor-pointer disabled:opacity-50 ${
                        item.isFavorite
                          ? 'bg-rose-500/15 border-rose-500/40 text-rose-300'
                          : 'bg-zinc-900 border-zinc-800 text-zinc-400 hover:text-rose-300 hover:border-zinc-700'
                      }`}
                      title={
                        item.isFavorite
                          ? 'Remove Poster Favorite'
                          : 'Set as Series Poster (Favorited)'
                      }
                    >
                      <Heart
                        className={`w-3 h-3 ${item.isFavorite ? 'fill-rose-400 text-rose-400' : ''}`}
                      />
                      <span>{item.isFavorite ? 'Poster' : 'Heart'}</span>
                    </button>

                    <div className="flex items-center gap-1">
                      {onOpenConversationForStep && (
                        <button
                          type="button"
                          disabled={isBusy}
                          onClick={async () => {
                            setBusyId(item.imageId);
                            try {
                              await onOpenConversationForStep(item.imageId);
                            } finally {
                              setBusyId(null);
                            }
                          }}
                          className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-amber-500/10 hover:bg-amber-500/20 border border-amber-400/30 text-amber-200 text-[11px] font-medium transition-colors cursor-pointer disabled:opacity-50"
                          title={
                            isLatest
                              ? 'Continue conversation from this latest step'
                              : `Branch new series stack from Step #${idx + 1}`
                          }
                        >
                          {isBusy ? (
                            <Loader2 className="w-3 h-3 animate-spin" />
                          ) : (
                            <MessageSquare className="w-3 h-3" />
                          )}
                          <span>{isLatest ? 'Chat' : `Branch`}</span>
                        </button>
                      )}

                      {items.length > 1 && (
                        <button
                          type="button"
                          disabled={isBusy}
                          onClick={async () => {
                            setBusyId(item.imageId);
                            try {
                              await onRejectIteration(item.imageId);
                            } finally {
                              setBusyId(null);
                            }
                          }}
                          className="p-1 rounded-md bg-zinc-900 hover:bg-rose-500/15 border border-zinc-800 hover:border-rose-500/40 text-zinc-500 hover:text-rose-400 transition-colors cursor-pointer disabled:opacity-50"
                          title={`Reject & hide Step #${idx + 1} from stack`}
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}

            {/* Live Pending / Generating Preview Card(s) */}
            {pendingGhosts.map((ghost, pIdx) => {
              const isQueuedOnly = ghost.state === 'queued' || ghost.progressPercent === null;
              const pct = Math.min(100, Math.max(0, ghost.progressPercent ?? 0));
              const nextStepNum = items.length + pIdx + 1;

              return (
                <div
                  key={`modal-pending-${ghost.itemId}`}
                  aria-busy="true"
                  className="rounded-xl overflow-hidden bg-zinc-950 border border-dashed border-indigo-400/70 flex flex-col"
                >
                  <div className="relative aspect-[3/4] w-full bg-zinc-900/90 flex flex-col items-center justify-center p-4 text-center">
                    <span className="absolute top-2 left-2 px-1.5 py-0.5 rounded bg-black/80 border border-indigo-500/40 text-[10px] font-mono font-semibold text-indigo-200 tabular-nums">
                      #{nextStepNum}
                    </span>

                    {isQueuedOnly ? (
                      <div className="flex flex-col items-center gap-2">
                        <span className="w-2.5 h-2.5 rounded-full bg-indigo-400 animate-pulse shadow-[0_0_8px_rgba(129,140,248,0.85)]" />
                        <span className="text-xs font-medium uppercase tracking-wider text-zinc-200">
                          Pending
                        </span>
                      </div>
                    ) : (
                      <div className="flex flex-col items-center gap-2.5 w-full max-w-[120px]">
                        <span className="text-2xl font-mono font-semibold tabular-nums text-indigo-300">
                          {pct}%
                        </span>
                        <div className="w-full h-1.5 bg-zinc-800 rounded-full overflow-hidden">
                          <div
                            className="h-full bg-indigo-500 transition-all duration-300 ease-out rounded-full"
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                      </div>
                    )}

                    {ghost.width > 0 && ghost.height > 0 && (
                      <span className="absolute bottom-2 left-2 px-1.5 py-0.5 rounded bg-black/75 text-[10px] font-mono text-zinc-400 tabular-nums">
                        {ghost.width}×{ghost.height}
                      </span>
                    )}
                  </div>

                  <div className="px-2.5 py-2 border-t border-zinc-800/80 text-[11px] font-mono text-indigo-300/90 truncate">
                    {isQueuedOnly ? 'Queued in ComfyUI…' : `Generating (${pct}%)…`}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
};
