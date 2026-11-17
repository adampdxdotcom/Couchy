import React from 'react';
import { Star } from 'lucide-react';
import type { CharacterProfile, ImageRecord } from '../../shared/types.ts';
import { CharacterImageTile } from './CharacterImageTile.tsx';

interface CharacterHighestRatedCardProps {
  character: CharacterProfile;
  images: ImageRecord[];
  usesFiveStarOnly: boolean;
  activePortraitId: number | null;
  onOpenImage: (img: ImageRecord) => void;
  onQuickRate: (id: number, rating: number) => void;
  onQuickFavorite?: (id: number, nextFav: boolean) => void;
  onSetPortrait: (img: ImageRecord) => Promise<void>;
  onReusePrompt?: (img: ImageRecord) => void;
  onOpenConversation?: (img: ImageRecord) => void;
  onQuickReject?: (id: number, nextRejected: boolean) => void;
}

/**
 * Compact 2x2 scrollable spotlight card for a character's highest-rated renders,
 * placed side-by-side with Favorite Addons.
 */
export const CharacterHighestRatedCard: React.FC<CharacterHighestRatedCardProps> = ({
  character,
  images,
  usesFiveStarOnly,
  activePortraitId,
  onOpenImage,
  onQuickRate,
  onQuickFavorite,
  onSetPortrait,
  onReusePrompt,
  onOpenConversation,
  onQuickReject,
}) => {
  return (
    <div className="min-w-0 h-[480px] sm:h-[580px] lg:h-[660px] bg-zinc-900 border border-zinc-800/80 rounded-xl p-4 sm:p-5 flex flex-col gap-3 text-xs overflow-hidden">
      <div className="flex items-center justify-between gap-2 shrink-0">
        <div>
          <h3 className="text-sm font-display font-semibold text-zinc-100 flex items-center gap-1.5">
            <Star className="w-3.5 h-3.5 text-amber-400 fill-amber-400 shrink-0" />
            <span>Highest-Rated Images ({images.length})</span>
          </h3>
          <p className="text-zinc-400">
            {images.length > 0
              ? usesFiveStarOnly
                ? '5★ spotlight renders · scroll to view more.'
                : '4★+ top-rated renders · scroll to view more.'
              : 'Rate confirmed renders 4★ or 5★ below to spotlight them here.'}
          </p>
        </div>
      </div>

      {images.length === 0 ? (
        <div className="flex-1 min-h-0 flex items-center justify-center bg-zinc-950/60 border border-zinc-800/70 rounded-lg px-3.5 py-6 text-center text-zinc-500">
          No 4★ or 5★ images yet for {character.name}.
        </div>
      ) : (
        <div className="flex-1 min-h-0 overflow-y-auto pr-1 [scrollbar-gutter:stable]">
          <div className="grid grid-cols-2 gap-3 content-start items-start">
            {images.map((img) => (
              <CharacterImageTile
                key={img.id}
                img={img}
                character={character}
                activePortraitId={activePortraitId}
                onOpenImage={onOpenImage}
                onQuickRate={onQuickRate}
                onQuickFavorite={onQuickFavorite}
                onSetPortrait={onSetPortrait}
                onReusePrompt={onReusePrompt}
                onOpenConversation={onOpenConversation}
                onQuickReject={onQuickReject}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
