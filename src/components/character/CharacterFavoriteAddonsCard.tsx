import React, { useMemo, useState } from 'react';
import { Cpu, Layers, Plus, Users } from 'lucide-react';
import { api } from '../../api/client.ts';
import type {
  CharacterProfile,
  ImageRecord,
  LoraExplorerItem,
} from '../../shared/types.ts';
import { CharacterPortraitImage } from './CharacterPortraitImage.tsx';
import {
  computeCharacterAddonStats,
  type AddonSortMode,
} from './characterAddonStats.ts';

interface CharacterFavoriteAddonsCardProps {
  character: CharacterProfile;
  allCharacters: CharacterProfile[];
  confirmedImages: ImageRecord[];
  loras: LoraExplorerItem[];
  collections: { id: number; name: string }[];
  onRefresh: () => Promise<void>;
  onSelectCharacter?: (characterId: number) => void;
  onFilterGalleryByAddon?: (
    characterId: number,
    filter: { checkpoint?: string; loraName?: string }
  ) => void;
  onSeedQuickGenAddon?: (
    character: CharacterProfile,
    addon: { loraName: string; modelStrength: number; clipStrength: number }
  ) => void;
}

const DEFAULT_VISIBLE_ADDONS = 6;

/**
 * Displays a character's most-paired base models and non-character addon LoRAs,
 * plus co-occurring Friend character LoRAs (hidden when empty) and collection toggles.
 */
export const CharacterFavoriteAddonsCard: React.FC<CharacterFavoriteAddonsCardProps> = ({
  character,
  allCharacters,
  confirmedImages,
  loras,
  collections,
  onRefresh,
  onSelectCharacter,
  onFilterGalleryByAddon,
  onSeedQuickGenAddon,
}) => {
  const [sortMode, setSortMode] = useState<AddonSortMode>('most_used');
  const [showAllAddons, setShowAllAddons] = useState(false);

  const { baseModels, addonLoras, friends } = useMemo(
    () =>
      computeCharacterAddonStats({
        character,
        confirmedImages,
        allCharacters,
        allLoras: loras,
        sortMode,
      }),
    [character, confirmedImages, allCharacters, loras, sortMode]
  );

  const visibleAddons = showAllAddons
    ? addonLoras
    : addonLoras.slice(0, DEFAULT_VISIBLE_ADDONS);
  const hasAnyStats = baseModels.length > 0 || addonLoras.length > 0 || friends.length > 0;

  return (
    <div className="min-w-0 bg-zinc-900 border border-zinc-800/80 rounded-xl p-4 sm:p-5 space-y-4 text-xs overflow-hidden">
      {/* Header + Sort Toggle */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-display font-semibold text-zinc-100">
            Favorite Addons
          </h3>
          <p className="text-zinc-400">
            Popular base models and paired addon LoRAs across {confirmedImages.length} confirmed{' '}
            {confirmedImages.length === 1 ? 'render' : 'renders'}.
          </p>
        </div>

        {hasAnyStats && (
          <div className="inline-flex items-center p-0.5 bg-zinc-950 border border-zinc-800 rounded-lg shrink-0">
            {(
              [
                { id: 'most_used', label: 'Most Used' },
                { id: 'highest_rated', label: 'Top Rated' },
              ] as const
            ).map((opt) => (
              <button
                key={opt.id}
                type="button"
                onClick={() => setSortMode(opt.id)}
                className={`px-2 py-1 rounded-md text-[11px] font-medium transition-colors cursor-pointer ${
                  sortMode === opt.id
                    ? 'bg-zinc-800 text-zinc-100'
                    : 'text-zinc-400 hover:text-zinc-200'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        )}
      </div>

      {!hasAnyStats ? (
        <div className="bg-zinc-950/60 border border-zinc-800/70 rounded-lg px-3.5 py-4 text-zinc-500">
          No base model or addon LoRA usage recorded yet for this character.
        </div>
      ) : (
        <div className="space-y-4">
          {/* Top Base Models / Checkpoints */}
          {baseModels.length > 0 && (
            <div className="space-y-1.5">
              <div className="flex items-center gap-1.5 text-[11px] font-medium text-zinc-400">
                <Cpu className="w-3.5 h-3.5 text-indigo-400 shrink-0" />
                <span>Base Models ({baseModels.length})</span>
              </div>
              <div className="space-y-1.5">
                {baseModels.slice(0, 4).map((bm) => (
                  <button
                    key={bm.key}
                    type="button"
                    onClick={() =>
                      onFilterGalleryByAddon?.(character.id, { checkpoint: bm.name })
                    }
                    title={`Filter gallery by ${character.name} + ${bm.name}`}
                    className="w-full flex items-center justify-between gap-2 bg-zinc-950 hover:bg-zinc-950/80 border border-zinc-800 hover:border-indigo-500/50 rounded-lg px-3 py-2 text-left transition-colors cursor-pointer min-w-0"
                  >
                    <span className="font-mono text-zinc-200 truncate">{bm.name}</span>
                    <span className="font-mono tabular-nums text-[11px] text-zinc-400 shrink-0 flex items-center gap-2">
                      <span>
                        {bm.count} {bm.count === 1 ? 'img' : 'imgs'} ({bm.sharePercent}%)
                      </span>
                      {bm.avgRating > 0 && (
                        <span className="text-amber-400">★ {bm.avgRating}</span>
                      )}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Top Paired Addon LoRAs (Excluding Character's Own LoRAs) */}
          {addonLoras.length > 0 && (
            <div className="space-y-1.5">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-1.5 text-[11px] font-medium text-zinc-400">
                  <Layers className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                  <span>Addon LoRAs ({addonLoras.length})</span>
                </div>
                {addonLoras.length > DEFAULT_VISIBLE_ADDONS && (
                  <button
                    type="button"
                    onClick={() => setShowAllAddons((prev) => !prev)}
                    className="text-[11px] text-indigo-400 hover:text-indigo-300 cursor-pointer"
                  >
                    {showAllAddons ? 'Show fewer' : `Show all (${addonLoras.length})`}
                  </button>
                )}
              </div>

              <div className="space-y-1.5">
                {visibleAddons.map((addon) => (
                  <div
                    key={addon.key}
                    className="flex items-center justify-between gap-2 bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 min-w-0"
                  >
                    <button
                      type="button"
                      onClick={() =>
                        onFilterGalleryByAddon?.(character.id, { loraName: addon.loraName })
                      }
                      title={`Filter gallery by ${character.name} + ${addon.loraName}`}
                      className="min-w-0 flex-1 text-left cursor-pointer group"
                    >
                      <div className="flex items-center gap-1.5 min-w-0">
                        <span className="font-medium text-zinc-200 group-hover:text-indigo-300 transition-colors truncate">
                          {addon.displayName}
                        </span>
                        {!addon.isInstalled && (
                          <span className="text-[10px] font-mono text-amber-400/90 shrink-0">
                            (missing)
                          </span>
                        )}
                      </div>
                      <div className="text-[11px] text-zinc-500 font-mono tabular-nums flex flex-wrap items-center gap-1.5">
                        <span className="capitalize font-sans text-zinc-400">{addon.category}</span>
                        <span>·</span>
                        <span>{addon.avgModelStrength.toFixed(2)}x avg</span>
                        <span>·</span>
                        <span>{addon.count} {addon.count === 1 ? 'img' : 'imgs'}</span>
                        {addon.avgRating > 0 && (
                          <>
                            <span>·</span>
                            <span className="text-amber-400">★ {addon.avgRating}</span>
                          </>
                        )}
                      </div>
                    </button>

                    {onSeedQuickGenAddon && (
                      <button
                        type="button"
                        onClick={() =>
                          onSeedQuickGenAddon(character, {
                            loraName: addon.loraName,
                            modelStrength: addon.avgModelStrength,
                            clipStrength: addon.avgClipStrength,
                          })
                        }
                        title={`Attach ${character.name} + ${addon.displayName} (${addon.avgModelStrength.toFixed(2)}x) in Quick Gen`}
                        aria-label={`Use ${addon.displayName} with ${character.name} in Quick Gen`}
                        className="p-1.5 rounded-md bg-zinc-900 hover:bg-indigo-600/25 border border-zinc-800 hover:border-indigo-500/50 text-zinc-300 hover:text-indigo-200 cursor-pointer shrink-0 transition-colors"
                      >
                        <Plus className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Friends (Other Character LoRAs — Hidden Completely When Empty) */}
          {friends.length > 0 && (
            <div className="space-y-1.5 pt-1 border-t border-zinc-800/80">
              <div className="flex items-center gap-1.5 text-[11px] font-medium text-zinc-400 pt-1">
                <Users className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                <span>Friends ({friends.length})</span>
              </div>
              <div className="space-y-1.5">
                {friends.map((friend) => (
                  <div
                    key={friend.key}
                    className="flex items-center justify-between gap-2 bg-zinc-950 border border-zinc-800 rounded-lg px-2.5 py-2 min-w-0"
                  >
                    <button
                      type="button"
                      onClick={() => {
                        if (friend.characterId && onSelectCharacter) {
                          onSelectCharacter(friend.characterId);
                        } else {
                          onFilterGalleryByAddon?.(character.id, { loraName: friend.loraName });
                        }
                      }}
                      title={
                        friend.characterId
                          ? `Open ${friend.characterName}'s profile`
                          : `Filter gallery by ${character.name} + ${friend.loraDisplayName}`
                      }
                      className="flex items-center gap-2.5 min-w-0 flex-1 text-left cursor-pointer group"
                    >
                      <div className="w-7 h-7 rounded-lg bg-zinc-900 border border-zinc-800 overflow-hidden flex items-center justify-center shrink-0">
                        <CharacterPortraitImage
                          src={friend.portraitThumbnailUrl}
                          alt={friend.characterName}
                          crop={friend.portraitCrop}
                          iconClassName="w-3.5 h-3.5 text-zinc-500"
                        />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="font-medium text-zinc-200 group-hover:text-indigo-300 transition-colors truncate">
                          {friend.characterName}
                        </div>
                        <div className="text-[11px] text-zinc-500 font-mono tabular-nums flex flex-wrap items-center gap-1.5 truncate">
                          <span>{friend.avgModelStrength.toFixed(2)}x</span>
                          <span>·</span>
                          <span>
                            {friend.count} {friend.count === 1 ? 'img' : 'imgs'}
                          </span>
                          {friend.avgRating > 0 && (
                            <>
                              <span>·</span>
                              <span className="text-amber-400">★ {friend.avgRating}</span>
                            </>
                          )}
                        </div>
                      </div>
                    </button>

                    {onSeedQuickGenAddon && (
                      <button
                        type="button"
                        onClick={() =>
                          onSeedQuickGenAddon(character, {
                            loraName: friend.loraName,
                            modelStrength: friend.avgModelStrength,
                            clipStrength: friend.avgClipStrength,
                          })
                        }
                        title={`Attach ${character.name} + ${friend.characterName} in Quick Gen`}
                        aria-label={`Pair ${friend.characterName} with ${character.name} in Quick Gen`}
                        className="p-1.5 rounded-md bg-zinc-900 hover:bg-indigo-600/25 border border-zinc-800 hover:border-indigo-500/50 text-zinc-300 hover:text-indigo-200 cursor-pointer shrink-0 transition-colors"
                      >
                        <Plus className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Character Collections */}
      {collections.length > 0 && (
        <div className="pt-3 border-t border-zinc-800">
          <span className="text-zinc-400 block mb-1.5">Character Collections:</span>
          <div className="flex flex-wrap gap-1.5">
            {collections.map((col) => {
              const isLinked = character.collections.some((c) => c.id === col.id);
              return (
                <button
                  key={col.id}
                  type="button"
                  onClick={async () => {
                    const currentIds = character.collections.map((c) => c.id);
                    const nextIds = isLinked
                      ? currentIds.filter((id) => id !== col.id)
                      : [...currentIds, col.id];
                    await api.updateCharacter(character.id, {
                      collectionIds: nextIds,
                    });
                    await onRefresh();
                  }}
                  className={`px-2.5 py-1 rounded border cursor-pointer ${
                    isLinked
                      ? 'bg-indigo-600/20 border-indigo-500 text-indigo-200'
                      : 'bg-zinc-950 border-zinc-800 text-zinc-400'
                  }`}
                >
                  {col.name}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};
