import React from 'react';
import { Heart, Layers, MessageSquare } from 'lucide-react';
import type { ImageSeriesItem } from '../../shared/types.ts';

interface SeriesIterationsStripProps {
  items: ImageSeriesItem[];
  activeImageId: number;
  onSelectIteration: (imageId: number) => void;
  onContinueConversation?: () => void;
}

/**
 * Horizontal thumbnail strip docked at the bottom of the Inspector metadata column
 * for navigating stacked iterations in an image series.
 */
export const SeriesIterationsStrip: React.FC<SeriesIterationsStripProps> = ({
  items,
  activeImageId,
  onSelectIteration,
  onContinueConversation,
}) => {
  if (!items || items.length <= 1) return null;

  const activeIdx = items.findIndex((it) => it.imageId === activeImageId);
  const isMiddleStep = activeIdx >= 0 && activeIdx < items.length - 1;

  return (
    <div className="sticky bottom-0 z-10 bg-zinc-950/95 backdrop-blur-md border-t border-zinc-800 px-4 sm:px-5 py-3 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 min-w-0">
          <Layers className="w-3.5 h-3.5 text-indigo-400 shrink-0" />
          <span className="text-[11px] font-display font-semibold text-zinc-200 uppercase tracking-wider truncate">
            Series Stack ({activeIdx >= 0 ? `${activeIdx + 1} of ${items.length}` : items.length})
          </span>
          {isMiddleStep && (
            <span className="text-[10px] font-mono text-amber-300/90 hidden sm:inline">
              · Branching splits new stack
            </span>
          )}
        </div>

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

      <div className="flex items-center gap-2 overflow-x-auto pb-1 pt-0.5">
        {items.map((item, idx) => {
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
      </div>
    </div>
  );
};
