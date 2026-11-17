import React from 'react';
import {
  CheckCircle2,
  Download,
  Heart,
  Layers,
  MessageSquare,
  RotateCcw,
  Star,
  Trash2,
} from 'lucide-react';
import type {
  CharacterProfile,
  ImageRecord,
  QueuedGhostCardItem,
} from '../../shared/types.ts';
import { PendingGhostOverlay } from '../gallery/PendingGhostOverlay.tsx';

export interface CharacterImageTileProps {
  img: ImageRecord;
  character: CharacterProfile;
  activePortraitId: number | null;
  attachedGhost?: QueuedGhostCardItem | null;
  onOpenImage: (img: ImageRecord) => void;
  onQuickRate: (id: number, rating: number) => void;
  onQuickFavorite?: (id: number, nextFav: boolean) => void;
  onSetPortrait: (img: ImageRecord) => Promise<void>;
  onReusePrompt?: (img: ImageRecord) => void;
  onOpenConversation?: (img: ImageRecord) => void;
  onQuickReject?: (id: number, nextRejected: boolean) => void;
}

/**
 * Reusable square image card for character profile galleries with rating,
 * favorite, conversation/reuse, download, reject, and portrait assignment controls.
 */
export const CharacterImageTile: React.FC<CharacterImageTileProps> = ({
  img,
  character,
  activePortraitId,
  attachedGhost = null,
  onOpenImage,
  onQuickRate,
  onQuickFavorite,
  onSetPortrait,
  onReusePrompt,
  onOpenConversation,
  onQuickReject,
}) => {
  const isPortrait =
    (activePortraitId !== null && activePortraitId === img.id) ||
    (character.portraitContentHash !== null &&
      character.portraitContentHash === img.contentHash);

  return (
    <div
      className={`bg-zinc-900 rounded-lg overflow-hidden group flex flex-col transition-all duration-300 ${
        isPortrait
          ? 'border border-amber-400 shadow-[0_0_15px_rgba(251,191,36,0.35)] ring-1 ring-amber-400/80'
          : 'border border-zinc-800 hover:border-zinc-700'
      }`}
    >
      <div
        onClick={() => onOpenImage(img)}
        className="relative w-full aspect-square bg-black cursor-pointer overflow-hidden shrink-0"
      >
        <img
          src={img.thumbnailUrl}
          alt={img.filename}
          className="absolute inset-0 w-full h-full object-cover group-hover:scale-[1.02] transition-transform duration-200"
        />

        {attachedGhost && <PendingGhostOverlay ghost={attachedGhost} />}

        {/* Top Overlay Controls (Portrait Badge, Series Badge & Favorite) */}
        <div
          className="absolute top-2 left-2 right-2 flex items-center justify-between pointer-events-none z-30"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-center gap-1.5">
            {isPortrait && (
              <div className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-400 text-zinc-950 text-[10px] font-bold tracking-wider uppercase shadow-md pointer-events-none">
                <Star className="w-2.5 h-2.5 fill-zinc-950 text-zinc-950" />
                <span>Portrait</span>
              </div>
            )}
            {((img.seriesCount || 1) > 1 || attachedGhost) && (
              <span
                className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-black/75 backdrop-blur-xs border text-[10px] font-mono font-semibold text-indigo-200 shadow-sm pointer-events-none ${
                  attachedGhost ? 'border-indigo-400/70' : 'border-indigo-500/40'
                }`}
                title={
                  attachedGhost
                    ? 'Generating new iteration onto this series stack'
                    : `${img.seriesCount} images stacked in this series`
                }
              >
                <Layers
                  className={`w-2.5 h-2.5 text-indigo-400 ${attachedGhost ? 'animate-pulse' : ''}`}
                />
                <span>{attachedGhost ? `${img.seriesCount || 1} +1` : img.seriesCount}</span>
              </span>
            )}
          </div>

          {onQuickFavorite && (
            <button
              type="button"
              onClick={() => onQuickFavorite(img.id, !img.isFavorite)}
              aria-label="Toggle Favorite"
              className={`pointer-events-auto p-1.5 rounded-md bg-black/65 backdrop-blur-xs transition-opacity cursor-pointer mobile-show-actions ${
                img.isFavorite
                  ? 'opacity-100 text-rose-400'
                  : 'opacity-100 sm:opacity-0 sm:group-hover:opacity-100 text-zinc-300 hover:text-rose-400'
              }`}
              title={img.isFavorite ? 'Remove from Favorites' : 'Add to Favorites'}
            >
              <Heart className={`w-4 h-4 ${img.isFavorite ? 'fill-rose-400' : ''}`} />
            </button>
          )}
        </div>

        {/* Bottom Floating Bar on Card: Rating Stars (Left) + Actions (Right) */}
        <div
          className="absolute bottom-0 inset-x-0 p-1.5 sm:p-2.5 bg-gradient-to-t from-black/90 via-black/60 to-transparent flex items-center justify-between opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity z-10 mobile-show-actions"
          onClick={(e) => e.stopPropagation()}
        >
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
          <div className="flex items-center gap-1 shrink-0">
            {onOpenConversation &&
              (() => {
                const isMultiShotSet = img.seriesKind === 'multi_shot' && (img.seriesCount || 1) > 1;
                return (
                  <button
                    type="button"
                    disabled={isMultiShotSet}
                    onClick={(e) => {
                      e.stopPropagation();
                      if (isMultiShotSet) return;
                      onOpenConversation(img);
                    }}
                    className={`p-1 rounded transition-colors ${
                      isMultiShotSet
                        ? 'text-amber-300/35 cursor-not-allowed'
                        : 'text-amber-300 hover:text-amber-200 hover:bg-zinc-800/80 cursor-pointer'
                    }`}
                    title={
                      isMultiShotSet
                        ? 'Multi-shot set — open the Inspector & Series Mini Gallery to iterate on a specific shot'
                        : 'Continue or start Conversation in Quick Gen'
                    }
                  >
                    <MessageSquare className="w-3.5 h-3.5" />
                  </button>
                );
              })()}
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

      <div className="p-2 text-xs flex items-center justify-between gap-1.5">
        <span
          onClick={() => onOpenImage(img)}
          className="truncate text-zinc-200 cursor-pointer hover:text-white"
          title={img.filename}
        >
          {img.filename}
        </span>
        {isPortrait ? (
          <span
            className="inline-flex items-center gap-1 text-[11px] font-semibold text-amber-400 shrink-0"
            title="Current Character Portrait"
          >
            <CheckCircle2 className="w-3 h-3 text-amber-400" />
            <span>Portrait</span>
          </span>
        ) : (
          <button
            type="button"
            onClick={async (e) => {
              e.stopPropagation();
              await onSetPortrait(img);
            }}
            className="text-[11px] text-zinc-400 hover:text-amber-400 shrink-0 cursor-pointer transition-colors"
            title="Set as Character Portrait"
          >
            Set Portrait
          </button>
        )}
      </div>
    </div>
  );
};
