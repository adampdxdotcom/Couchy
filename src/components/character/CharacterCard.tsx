import React from 'react';
import { User } from 'lucide-react';
import type { CharacterProfile } from '../../shared/types.ts';

interface CharacterCardProps {
  character: CharacterProfile;
  onClick: () => void;
}

export const CharacterCard: React.FC<CharacterCardProps> = ({ character, onClick }) => {
  return (
    <div
      onClick={onClick}
      className="bg-zinc-900 border border-zinc-800/80 hover:border-zinc-700 rounded-xl overflow-hidden cursor-pointer transition-colors flex flex-col justify-between"
    >
      <div className="aspect-[4/3] bg-zinc-950 relative overflow-hidden flex items-center justify-center">
        {character.portraitThumbnailUrl ? (
          <img
            src={character.portraitThumbnailUrl}
            alt={character.name}
            className="w-full h-full object-cover"
          />
        ) : (
          <User className="w-12 h-12 text-zinc-700" />
        )}
      </div>

      <div className="p-4 space-y-2">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-sm font-display font-semibold text-zinc-100 truncate">
            {character.name}
          </h3>
          {character.averageRating > 0 && (
            <span className="text-xs font-mono tabular-nums text-amber-400">
              ★ {character.averageRating}
            </span>
          )}
        </div>

        {/* Unboxed Metadata with · Separators */}
        <div className="text-xs text-zinc-400 font-mono tabular-nums flex flex-wrap items-center gap-1.5">
          <span>{character.confirmedImageCount} images</span>
          <span aria-hidden="true">·</span>
          <span>{character.loras.length} LoRAs</span>
          {character.suggestedImageCount > 0 && (
            <>
              <span aria-hidden="true">·</span>
              <span className="text-amber-400 font-sans">
                {character.suggestedImageCount} suggested
              </span>
            </>
          )}
        </div>

        {character.aliases.length > 0 && (
          <p className="text-[11px] text-zinc-500 truncate">
            Aliases: {character.aliases.map((a) => a.alias).join(' · ')}
          </p>
        )}
      </div>
    </div>
  );
};
