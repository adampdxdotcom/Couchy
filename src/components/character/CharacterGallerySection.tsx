import React from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import type {
  CharacterProfile,
  ImageRecord,
  QueuedGhostCardItem,
} from '../../shared/types.ts';
import {
  filterAndSortGhostItems,
  findAttachedGhostsForImage,
  isGhostOutputInImages,
} from '../../shared/utils.ts';
import { GhostCancelButton } from '../gallery/GhostCancelButton.tsx';
import { CharacterImageTile } from './CharacterImageTile.tsx';

interface CharacterGallerySectionProps {
  title: string;
  images: ImageRecord[];
  ghostItems?: QueuedGhostCardItem[];
  character: CharacterProfile;
  activePortraitId: number | null;
  onOpenImage: (img: ImageRecord) => void;
  onQuickRate: (id: number, rating: number) => void;
  onQuickFavorite?: (id: number, nextFav: boolean) => void;
  onSetPortrait: (img: ImageRecord) => Promise<void>;
  onReusePrompt?: (img: ImageRecord) => void;
  onOpenConversation?: (img: ImageRecord) => void;
  onQuickReject?: (id: number, nextRejected: boolean) => void;
  emptyText?: string;
  isExpandable?: boolean;
  isExpanded?: boolean;
  onToggleExpand?: () => void;
  totalPoolCount?: number;
  onCancelGhost?: (ghost: QueuedGhostCardItem) => Promise<void> | void;
}

export const CharacterGallerySection: React.FC<CharacterGallerySectionProps> = ({
  title,
  images,
  ghostItems = [],
  character,
  activePortraitId,
  onOpenImage,
  onQuickRate,
  onQuickFavorite,
  onSetPortrait,
  onReusePrompt,
  onOpenConversation,
  onQuickReject,
  emptyText,
  isExpandable = false,
  isExpanded = false,
  onToggleExpand,
  totalPoolCount,
  onCancelGhost,
}) => {
  const visibleGhostItems = ghostItems.filter((g) => !isGhostOutputInImages(g, images));

  const attachedGhostsByCardId = new Map<number, QueuedGhostCardItem>();
  const attachedGhostIds = new Set<number>();
  for (const img of images) {
    const matches = findAttachedGhostsForImage(img, visibleGhostItems);
    if (matches.length > 0) {
      attachedGhostsByCardId.set(img.id, matches[0]);
      for (const m of matches) {
        attachedGhostIds.add(m.itemId);
      }
    }
  }
  const standaloneGhostItems = filterAndSortGhostItems(
    visibleGhostItems.filter((g) => !attachedGhostIds.has(g.itemId))
  );

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2.5">
        <h3 className="text-sm font-display font-semibold text-zinc-100">
          {title}
        </h3>
        {visibleGhostItems.length > 0 && (
          <span className="text-xs font-mono tabular-nums text-indigo-300">
            · {visibleGhostItems.length} in queue
          </span>
        )}
        {isExpandable && onToggleExpand && (
          <button
            type="button"
            onClick={onToggleExpand}
            className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-lg bg-zinc-900 hover:bg-zinc-800 text-indigo-400 hover:text-indigo-300 border border-zinc-800 hover:border-zinc-700 transition-colors cursor-pointer select-none"
            title={
              isExpanded
                ? 'Show 1 row only'
                : `Show all ${totalPoolCount ?? images.length} 5-star photos`
            }
          >
            {isExpanded ? (
              <>
                <ChevronUp className="w-3.5 h-3.5" />
                <span>Collapse</span>
              </>
            ) : (
              <>
                <ChevronDown className="w-3.5 h-3.5" />
                <span>Expand ({totalPoolCount ?? images.length})</span>
              </>
            )}
          </button>
        )}
      </div>

      {images.length === 0 && visibleGhostItems.length === 0 ? (
        emptyText ? (
          <p className="text-xs text-zinc-500">{emptyText}</p>
        ) : null
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-3">
          {standaloneGhostItems.map((ghost) => {
            const isQueuedOnly = ghost.state === 'queued' || ghost.progressPercent === null;
            const displayPct = Math.min(100, Math.max(0, ghost.progressPercent ?? 0));
            const titleText = ghost.prompt.trim() || `Generation #${ghost.itemIndex}`;
            const totalCount = Number(ghost.batchTotalCount || 0);
            const currentNum = Number(ghost.batchCurrentNumber || ghost.itemIndex || 1);
            const showBatchCount = totalCount > 1;

            return (
              <div
                key={`ghost-${ghost.itemId}`}
                aria-busy="true"
                className="bg-zinc-900 rounded-lg overflow-hidden border border-zinc-800 flex flex-col justify-between select-none pointer-events-none"
              >
                <div className="relative aspect-square bg-zinc-950/90 overflow-hidden flex flex-col items-center justify-center p-3 text-center">
                  {isQueuedOnly ? (
                    <div className="flex flex-col items-center gap-1.5">
                      <span className="w-2 h-2 rounded-full bg-zinc-500 animate-pulse" />
                      <span className="text-[11px] font-medium tracking-wider uppercase text-zinc-400">
                        Pending
                      </span>
                      {showBatchCount && (
                        <span className="text-[11px] font-mono tabular-nums text-zinc-300">
                          {currentNum} of {totalCount}
                        </span>
                      )}
                    </div>
                  ) : (
                    <div className="flex flex-col items-center gap-1.5 w-full max-w-[110px]">
                      <span className="text-xl sm:text-2xl font-mono font-semibold tabular-nums text-indigo-300 tracking-tight">
                        {displayPct}%
                      </span>
                      <div className="w-full h-1 bg-zinc-800/90 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-indigo-500 transition-all duration-300 ease-out rounded-full"
                          style={{ width: `${displayPct}%` }}
                        />
                      </div>
                      {showBatchCount && (
                        <span className="text-[11px] font-mono tabular-nums text-zinc-300">
                          {currentNum} of {totalCount}
                        </span>
                      )}
                    </div>
                  )}
                  <GhostCancelButton
                    ghost={ghost}
                    onCancelGhost={onCancelGhost}
                    variant="corner"
                  />
                </div>
                <div className="p-2 text-xs flex items-center justify-between gap-1.5">
                  <span className="truncate text-zinc-300">{titleText}</span>
                </div>
              </div>
            );
          })}

          {images.map((img) => (
            <CharacterImageTile
              key={img.id}
              img={img}
              character={character}
              activePortraitId={activePortraitId}
              attachedGhost={attachedGhostsByCardId.get(img.id) || null}
              onOpenImage={onOpenImage}
              onQuickRate={onQuickRate}
              onQuickFavorite={onQuickFavorite}
              onSetPortrait={onSetPortrait}
              onReusePrompt={onReusePrompt}
              onOpenConversation={onOpenConversation}
              onQuickReject={onQuickReject}
              onCancelGhost={onCancelGhost}
            />
          ))}
        </div>
      )}
    </div>
  );
};
