import React from 'react';
import { Heart, Layers, LayoutGrid, MessageSquare } from 'lucide-react';
import type { ImageRecord, ImageSeriesItem, QueuedGhostCardItem } from '../../shared/types.ts';

interface SeriesIterationsStripProps {
  items: ImageSeriesItem[];
  activeImageId: number;
  activeImage?: Pick<
    ImageRecord,
    'id' | 'seriesId' | 'filename' | 'thumbnailUrl' | 'originalUrl' | 'width' | 'height' | 'isFavorite' | 'rating' | 'createdAt' | 'chatSnapshot'
  >;
  pendingGhosts?: QueuedGhostCardItem[];
  onSelectIteration: (imageId: number) => void;
  onContinueConversation?: () => void;
  onOpenMiniGallery?: () => void;
}

/**
 * Horizontal thumbnail strip displayed in the Inspector metadata column
 * under Workflow & Reproducibility for navigating stacked iterations in an image series
 * and showing live simplified Preview tiles for pending/generating iterations.
 */
export const SeriesIterationsStrip: React.FC<SeriesIterationsStripProps> = ({
  items,
  activeImageId,
  activeImage,
  pendingGhosts = [],
  onSelectIteration,
  onContinueConversation,
  onOpenMiniGallery,
}) => {
  const hasPending = pendingGhosts.length > 0;
  if ((!items || items.length <= 1) && !hasPending) return null;

  // When a standalone image has an active upscale/iteration queued, include it as #1 before the pending Preview tile
  const displayItems: ImageSeriesItem[] =
    items && items.length > 0
      ? items
      : activeImage
      ? [
          {
            seriesId: activeImage.seriesId || 0,
            imageId: activeImage.id,
            stepOrder: 0,
            filename: activeImage.filename,
            thumbnailUrl: activeImage.thumbnailUrl,
            originalUrl: activeImage.originalUrl,
            width: activeImage.width,
            height: activeImage.height,
            isFavorite: activeImage.isFavorite,
            rating: activeImage.rating,
            createdAt: activeImage.createdAt,
            chatSnapshot: activeImage.chatSnapshot || [],
          },
        ]
      : [];

  const totalWithPending = displayItems.length + pendingGhosts.length;
  const activeIdx = displayItems.findIndex((it) => it.imageId === activeImageId);
  const isMiddleStep = activeIdx >= 0 && activeIdx < displayItems.length - 1;

  return (
    <div className="bg-zinc-950 border border-zinc-800 rounded-xl p-3.5 space-y-2.5 min-w-0">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 min-w-0">
          <Layers className="w-3.5 h-3.5 text-indigo-400 shrink-0" />
          <span className="text-[11px] font-display font-semibold text-zinc-200 uppercase tracking-wider truncate">
            Series Stack ({activeIdx >= 0 ? `${activeIdx + 1} of ${totalWithPending}` : totalWithPending})
          </span>
          {isMiddleStep && (
            <span className="text-[10px] font-mono text-amber-300/90 hidden sm:inline">
              · Branching splits new stack
            </span>
          )}
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          {onOpenMiniGallery && (
            <button
              type="button"
              onClick={onOpenMiniGallery}
              className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-zinc-900 hover:bg-zinc-800 border border-zinc-700/80 text-zinc-200 text-[11px] font-medium transition-colors cursor-pointer shrink-0"
              title="Open Series Mini Gallery popup"
            >
              <LayoutGrid className="w-3 h-3 text-indigo-400" />
              <span>Gallery</span>
            </button>
          )}

          {onContinueConversation && (
            <button
              type="button"
              onClick={onContinueConversation}
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-amber-500/15 hover:bg-amber-500/25 border border-amber-400/40 text-amber-200 text-[11px] font-medium transition-colors cursor-pointer shrink-0"
              title={
                isMiddleStep
                  ? 'Branch a new conversation stack from this iteration (carries history up to this step)'
                  : 'Continue conversation from this latest iteration'
              }
            >
              <MessageSquare className="w-3 h-3" />
              <span>{isMiddleStep ? `Branch #${activeIdx + 1}` : 'Continue Chat'}</span>
            </button>
          )}
        </div>
      </div>

      <div className="flex items-center gap-2 overflow-x-auto pb-1 pt-0.5">
        {displayItems.map((item, idx) => {
          const isSelected = item.imageId === activeImageId;
          const hasChat = item.chatSnapshot && item.chatSnapshot.length > 0;
          return (
            <button
              key={`${item.seriesId}-${item.imageId}`}
              type="button"
              onClick={() => onSelectIteration(item.imageId)}
              className={`relative group w-14 h-14 rounded-lg overflow-hidden shrink-0 border transition-all cursor-pointer ${
                isSelected
                  ? 'border-indigo-400 ring-2 ring-indigo-500/60 scale-[1.03]'
                  : 'border-zinc-800 hover:border-zinc-600 opacity-75 hover:opacity-100'
              }`}
              title={`Step #${idx + 1} · ${item.width}×${item.height}${
                item.isFavorite ? ' · Poster (Favorited)' : ''
              }`}
            >
              <img
                src={item.thumbnailUrl}
                alt={item.filename}
                referrerPolicy="no-referrer"
                className="w-full h-full object-cover"
              />
              <span className="absolute bottom-0.5 left-0.5 px-1 py-0.2 rounded bg-black/75 text-[9px] font-mono font-semibold text-zinc-200 tabular-nums">
                #{idx + 1}
              </span>
              {item.isFavorite && (
                <span
                  className="absolute top-0.5 right-0.5 p-0.5 rounded-full bg-black/75 text-rose-400"
                  title="Series Poster (Favorited)"
                >
                  <Heart className="w-2.5 h-2.5 fill-rose-400" />
                </span>
              )}
              {hasChat && !item.isFavorite && (
                <span
                  className="absolute top-0.5 right-0.5 p-0.5 rounded-full bg-black/70 text-amber-300"
                  title="Has saved conversation snapshot"
                >
                  <MessageSquare className="w-2.5 h-2.5" />
                </span>
              )}
            </button>
          );
        })}

        {/* Simplified Pending / Generating Preview Card(s) */}
        {pendingGhosts.map((ghost, pIdx) => {
          const isQueuedOnly = ghost.state === 'queued' || ghost.progressPercent === null;
          const pct = Math.min(100, Math.max(0, ghost.progressPercent ?? 0));
          const nextStepNum = displayItems.length + pIdx + 1;
          return (
            <div
              key={`pending-preview-${ghost.itemId}`}
              aria-busy="true"
              title={
                isQueuedOnly
                  ? `Pending iteration #${nextStepNum}`
                  : `Generating iteration #${nextStepNum} (${pct}%)`
              }
              className="relative w-14 h-14 rounded-lg overflow-hidden shrink-0 border border-dashed border-indigo-400/70 bg-zinc-900/95 flex flex-col items-center justify-center p-1 select-none"
            >
              {isQueuedOnly ? (
                <>
                  <span className="w-2 h-2 rounded-full bg-indigo-400 animate-pulse mb-1" />
                  <span className="text-[9px] font-medium uppercase tracking-wider text-zinc-300 leading-none">
                    Pending
                  </span>
                </>
              ) : (
                <>
                  <span className="text-[11px] font-mono font-semibold tabular-nums text-indigo-300 leading-none">
                    {pct}%
                  </span>
                  <div className="w-10 h-1 bg-zinc-800 rounded-full overflow-hidden mt-1.5">
                    <div
                      className="h-full bg-indigo-500 transition-all duration-300 ease-out rounded-full"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </>
              )}
              <span className="absolute bottom-0.5 left-0.5 px-1 py-0.2 rounded bg-black/75 text-[9px] font-mono font-semibold text-indigo-200 tabular-nums">
                #{nextStepNum}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
};
