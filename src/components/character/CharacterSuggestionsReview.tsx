import React from 'react';
import {
  CheckCircle2,
  CheckSquare,
  Sparkles,
  Square,
  XCircle,
} from 'lucide-react';
import { api } from '../../api/client.ts';
import type { CharacterProfile, ImageRecord } from '../../shared/types.ts';

interface CharacterSuggestionsReviewProps {
  character: CharacterProfile;
  suggestedImages: ImageRecord[];
  selectedSuggestedIds: Set<number>;
  onSelectSuggestedId: (id: number) => void;
  onSetSelectedSuggestedIds: (ids: Set<number>) => void;
  onOpenImage: (img: ImageRecord) => void;
  onRefresh: () => Promise<void>;
}

export const CharacterSuggestionsReview: React.FC<CharacterSuggestionsReviewProps> = ({
  character,
  suggestedImages,
  selectedSuggestedIds,
  onSelectSuggestedId,
  onSetSelectedSuggestedIds,
  onOpenImage,
  onRefresh,
}) => {
  if (suggestedImages.length === 0) return null;

  return (
    <div className="bg-zinc-900 border border-amber-500/40 rounded-xl p-5 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-amber-400" />
          <h3 className="text-sm font-display font-semibold text-zinc-100">
            Suggested Character Matches ({suggestedImages.length})
          </h3>
          {selectedSuggestedIds.size > 0 && (
            <span className="text-xs font-mono tabular-nums text-indigo-300">
              · {selectedSuggestedIds.size} selected
            </span>
          )}
        </div>

        {/* Multi-Select & Bulk Action Toolbar */}
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <button
            type="button"
            onClick={() => {
              if (selectedSuggestedIds.size === suggestedImages.length) {
                onSetSelectedSuggestedIds(new Set());
              } else {
                onSetSelectedSuggestedIds(new Set(suggestedImages.map((i) => i.id)));
              }
            }}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-zinc-950 border border-zinc-800 hover:border-zinc-700 text-zinc-200 rounded-lg cursor-pointer"
          >
            {selectedSuggestedIds.size === suggestedImages.length ? (
              <CheckSquare className="w-3.5 h-3.5 text-indigo-400" />
            ) : (
              <Square className="w-3.5 h-3.5 text-zinc-400" />
            )}
            <span>
              {selectedSuggestedIds.size === suggestedImages.length
                ? 'Deselect All'
                : `Select All (${suggestedImages.length})`}
            </span>
          </button>

          {selectedSuggestedIds.size > 0 && (
            <>
              <button
                type="button"
                onClick={async () => {
                  await api.bulkUpdateCharacterAssociationStatus({
                    imageIds: Array.from(selectedSuggestedIds),
                    characterId: character.id,
                    status: 'confirmed',
                  });
                  onSetSelectedSuggestedIds(new Set());
                  await onRefresh();
                }}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white font-medium rounded-lg cursor-pointer"
              >
                <CheckCircle2 className="w-3.5 h-3.5" />
                <span className="font-mono tabular-nums">
                  Confirm Selected ({selectedSuggestedIds.size})
                </span>
              </button>

              <button
                type="button"
                onClick={async () => {
                  await api.bulkUpdateCharacterAssociationStatus({
                    imageIds: Array.from(selectedSuggestedIds),
                    characterId: character.id,
                    status: 'rejected',
                  });
                  onSetSelectedSuggestedIds(new Set());
                  await onRefresh();
                }}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-rose-600/20 border border-rose-500/40 hover:bg-rose-600/30 text-rose-300 font-medium rounded-lg cursor-pointer"
              >
                <XCircle className="w-3.5 h-3.5" />
                <span className="font-mono tabular-nums">
                  Reject Selected ({selectedSuggestedIds.size})
                </span>
              </button>
            </>
          )}

          <button
            type="button"
            onClick={async () => {
              await api.bulkUpdateCharacterAssociationStatus({
                imageIds: suggestedImages.map((i) => i.id),
                characterId: character.id,
                status: 'confirmed',
              });
              onSetSelectedSuggestedIds(new Set());
              await onRefresh();
            }}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600/20 border border-emerald-500/40 hover:bg-emerald-600/30 text-emerald-300 font-medium rounded-lg cursor-pointer"
          >
            <CheckCircle2 className="w-3.5 h-3.5" />
            <span className="font-mono tabular-nums">
              Confirm All ({suggestedImages.length})
            </span>
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
        {suggestedImages.map((img) => {
          const link = img.characters.find((c) => c.characterId === character.id);
          const isSelected = selectedSuggestedIds.has(img.id);
          return (
            <div
              key={img.id}
              className={`bg-zinc-950 border rounded-lg overflow-hidden flex flex-col justify-between transition-colors ${
                isSelected
                  ? 'border-indigo-500 ring-1 ring-indigo-500'
                  : 'border-zinc-800 hover:border-zinc-700'
              }`}
            >
              <div
                onClick={() => onOpenImage(img)}
                className="relative aspect-square bg-black cursor-pointer overflow-hidden group"
              >
                <img
                  src={img.thumbnailUrl}
                  alt={img.filename}
                  className="w-full h-full object-cover"
                />
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onSelectSuggestedId(img.id);
                  }}
                  aria-label={`Select suggested image ${img.filename}`}
                  className={`absolute top-2 left-2 p-1.5 rounded-md bg-black/70 backdrop-blur-xs transition-opacity cursor-pointer mobile-show-actions ${
                    isSelected
                      ? 'opacity-100 text-indigo-400'
                      : 'opacity-100 sm:opacity-80 sm:group-hover:opacity-100 text-zinc-200'
                  }`}
                >
                  {isSelected ? (
                    <CheckSquare className="w-4 h-4" />
                  ) : (
                    <Square className="w-4 h-4" />
                  )}
                </button>
              </div>
              <div className="p-2.5 space-y-2 text-xs">
                <div className="text-zinc-200 truncate font-medium">{img.filename}</div>
                <p className="text-[11px] text-amber-300/90 line-clamp-2">
                  {link?.matchReason || 'Matched character rule'}
                </p>
                <div className="flex items-center gap-1.5 pt-1">
                  <button
                    type="button"
                    onClick={async () => {
                      await api.updateCharacterAssociationStatus({
                        imageId: img.id,
                        characterId: character.id,
                        status: 'confirmed',
                      });
                      onSelectSuggestedId(img.id);
                      await onRefresh();
                    }}
                    className="flex-1 inline-flex items-center justify-center gap-1 py-1 bg-emerald-600 hover:bg-emerald-500 text-white rounded cursor-pointer"
                  >
                    <CheckCircle2 className="w-3 h-3" />
                    <span>Confirm</span>
                  </button>
                  <button
                    type="button"
                    onClick={async () => {
                      await api.updateCharacterAssociationStatus({
                        imageId: img.id,
                        characterId: character.id,
                        status: 'rejected',
                      });
                      onSelectSuggestedId(img.id);
                      await onRefresh();
                    }}
                    className="flex-1 inline-flex items-center justify-center gap-1 py-1 bg-zinc-800 hover:bg-rose-600 text-zinc-200 rounded cursor-pointer"
                  >
                    <XCircle className="w-3 h-3" />
                    <span>Reject</span>
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
