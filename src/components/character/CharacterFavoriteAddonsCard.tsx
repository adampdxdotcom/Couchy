import React, { useEffect, useMemo, useState } from 'react';
import { Check, Cpu, Layers, Sparkles, Users } from 'lucide-react';
import { api } from '../../api/client.ts';
import type {
  CharacterProfile,
  ImageRecord,
  LoraExplorerItem,
  ModelInventoryItem,
} from '../../shared/types.ts';
import { getModelAvailabilityInfo } from '../../shared/utils.ts';
import {
  MAX_SYSTEM_LORAS,
  resolveBaseModelDisplayLabel,
  type QuickGenPrefillLora,
} from '../quickgen/quickGenUtils.ts';
import { CharacterPortraitImage } from './CharacterPortraitImage.tsx';
import {
  computeCharacterAddonStats,
  type AddonSortMode,
} from './characterAddonStats.ts';

export interface CharacterNewImagePayload {
  character: CharacterProfile;
  checkpointName?: string | null;
  loras: QuickGenPrefillLora[];
}

interface CharacterFavoriteAddonsCardProps {
  character: CharacterProfile;
  allCharacters: CharacterProfile[];
  confirmedImages: ImageRecord[];
  loras: LoraExplorerItem[];
  models?: ModelInventoryItem[];
  defaultCheckpoint?: string | null;
  collections: { id: number; name: string }[];
  onRefresh: () => Promise<void>;
  onSelectCharacter?: (characterId: number) => void;
  onFilterGalleryByAddon?: (
    characterId: number,
    filter: { checkpoint?: string; loraName?: string }
  ) => void;
  onLaunchNewImage?: (payload: CharacterNewImagePayload) => void;
}

function formatPillStrength(value: number): string {
  const rounded = Math.round(value * 100) / 100;
  return Math.round(rounded * 100) % 10 !== 0 ? rounded.toFixed(2) : rounded.toFixed(1);
}

/**
 * Displays a character's most-paired base models, addon LoRAs, and Friend character LoRAs
 * with selectable left-side pills for Quick Gen launching and row-body gallery filtering.
 */
export const CharacterFavoriteAddonsCard: React.FC<CharacterFavoriteAddonsCardProps> = ({
  character,
  allCharacters,
  confirmedImages,
  loras,
  models = [],
  defaultCheckpoint = null,
  collections,
  onRefresh,
  onSelectCharacter,
  onFilterGalleryByAddon,
  onLaunchNewImage,
}) => {
  const [sortMode, setSortMode] = useState<AddonSortMode>('most_used');
  const [selectedCheckpoint, setSelectedCheckpoint] = useState<string | null>(null);
  const [selectedAddonKeys, setSelectedAddonKeys] = useState<Set<string>>(new Set());
  const [selectedFriendKey, setSelectedFriendKey] = useState<string | null>(null);

  useEffect(() => {
    setSelectedCheckpoint(null);
    setSelectedAddonKeys(new Set());
    setSelectedFriendKey(null);
  }, [character.id]);

  const { baseModels, addonLoras, friends } = useMemo(
    () =>
      computeCharacterAddonStats({
        character,
        confirmedImages,
        allCharacters,
        allLoras: loras,
        allModels: models,
        defaultCheckpoint,
        sortMode,
      }),
    [character, confirmedImages, allCharacters, loras, models, defaultCheckpoint, sortMode]
  );

  const hasAnyStats = baseModels.length > 0 || addonLoras.length > 0 || friends.length > 0;

  const baseLoraCount = character.loras.length;
  const friendLoraCount = selectedFriendKey ? 1 : 0;
  const totalSelectedLoras = baseLoraCount + friendLoraCount + selectedAddonKeys.size;
  const atLoraLimit = totalSelectedLoras >= MAX_SYSTEM_LORAS;

  const handleToggleCheckpoint = (checkpointName: string) => {
    setSelectedCheckpoint((prev) => (prev === checkpointName ? null : checkpointName));
  };

  const handleToggleAddon = (key: string) => {
    setSelectedAddonKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
        return next;
      }
      if (baseLoraCount + (selectedFriendKey ? 1 : 0) + next.size >= MAX_SYSTEM_LORAS) {
        return prev;
      }
      next.add(key);
      return next;
    });
  };

  const handleToggleFriend = (key: string) => {
    setSelectedFriendKey((prev) => {
      if (prev === key) return null;
      // Switching to another friend keeps friend count at 1; adding from none must fit under cap
      if (prev === null && baseLoraCount + selectedAddonKeys.size + 1 > MAX_SYSTEM_LORAS) {
        return prev;
      }
      return key;
    });
  };

  const handleNewImageClick = () => {
    if (!onLaunchNewImage) return;

    const pickedLoras: QuickGenPrefillLora[] = [];

    if (selectedFriendKey) {
      const friend = friends.find((f) => f.key === selectedFriendKey);
      if (friend) {
        const friendProfile = friend.characterId
          ? allCharacters.find((c) => c.id === friend.characterId)
          : undefined;
        const explorerMatch = loras.find(
          (l) => l.filename.toLowerCase() === friend.loraName.toLowerCase()
        );
        const friendTrigger =
          friendProfile?.loras.find(
            (cl) => cl.loraName.toLowerCase() === friend.loraName.toLowerCase()
          )?.triggerWord ||
          friendProfile?.loras[0]?.triggerWord ||
          explorerMatch?.triggerWord ||
          '';

        pickedLoras.push({
          loraName: friend.loraName,
          modelStrength: friend.avgModelStrength,
          clipStrength: friend.avgClipStrength,
          triggerWord: friendTrigger,
          nickname: friend.characterName,
          isCharacterPill: true,
          portraitThumbnailUrl: friend.portraitThumbnailUrl,
          portraitCrop: friend.portraitCrop,
          showPill: true,
        });
      }
    }

    for (const addon of addonLoras) {
      if (!selectedAddonKeys.has(addon.key)) continue;
      pickedLoras.push({
        loraName: addon.loraName,
        modelStrength: addon.avgModelStrength,
        clipStrength: addon.avgClipStrength,
        showPill: true,
      });
    }

    onLaunchNewImage({
      character,
      checkpointName: selectedCheckpoint || defaultCheckpoint || null,
      loras: pickedLoras,
    });
  };

  const hasCustomSelection =
    Boolean(selectedCheckpoint) || Boolean(selectedFriendKey) || selectedAddonKeys.size > 0;

  return (
    <div className="min-w-0 bg-zinc-900 border border-zinc-800/80 rounded-xl p-4 sm:p-5 space-y-4 text-xs overflow-hidden">
      {/* Header + Sort Toggle + New Image Action */}
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-display font-semibold text-zinc-100">
              Favorite Addons
            </h3>
            {hasCustomSelection && (
              <span
                className={`text-[11px] font-mono tabular-nums ${
                  atLoraLimit ? 'text-amber-300' : 'text-zinc-400'
                }`}
              >
                {totalSelectedLoras}/{MAX_SYSTEM_LORAS} LoRAs
              </span>
            )}
          </div>
          <p className="text-zinc-400">
            Select pills to stack · click row stats to filter across {confirmedImages.length}{' '}
            {confirmedImages.length === 1 ? 'render' : 'renders'}.
          </p>
        </div>

        <div className="flex items-center gap-2 shrink-0">
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

          {onLaunchNewImage && (
            <button
              type="button"
              onClick={handleNewImageClick}
              title={`Open Quick Gen with ${character.name}, ${
                selectedCheckpoint
                  ? resolveBaseModelDisplayLabel(selectedCheckpoint, models)
                  : defaultCheckpoint
                  ? `${resolveBaseModelDisplayLabel(defaultCheckpoint, models)} (default)`
                  : 'default model'
              }${
                selectedAddonKeys.size + (selectedFriendKey ? 1 : 0) > 0
                  ? `, and ${selectedAddonKeys.size + (selectedFriendKey ? 1 : 0)} selected LoRA(s)`
                  : ''
              }`}
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-[11px] font-medium transition-colors cursor-pointer shadow-sm shrink-0"
            >
              <Sparkles className="w-3.5 h-3.5 shrink-0" />
              <span>New Image</span>
            </button>
          )}
        </div>
      </div>

      {!hasAnyStats ? (
        <div className="bg-zinc-950/60 border border-zinc-800/70 rounded-lg px-3.5 py-4 text-zinc-500">
          No base model or addon LoRA usage recorded yet for this character.
        </div>
      ) : (
        <div className="space-y-4">
          {/* Base Models / Checkpoints (Green Pill Single-Select Radio) */}
          {baseModels.length > 0 && (
            <div className="space-y-1.5">
              <div className="flex items-center gap-1.5 text-[11px] font-medium text-zinc-400">
                <Cpu className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                <span>Base Models ({baseModels.length})</span>
              </div>
              <div className="space-y-1.5 max-h-40 overflow-y-auto pr-1">
                {baseModels.map((bm) => {
                  const isSelected = selectedCheckpoint === bm.name;
                  const availability = getModelAvailabilityInfo(bm);
                  return (
                    <div
                      key={bm.key}
                      className={`flex items-center justify-between gap-2 bg-zinc-950 border rounded-lg px-2 py-1.5 min-w-0 transition-colors ${
                        isSelected
                          ? 'border-emerald-500/50 bg-emerald-950/15'
                          : 'border-zinc-800 hover:border-zinc-700'
                      }`}
                    >
                      <button
                        type="button"
                        disabled={!bm.isInstalled}
                        onClick={() => handleToggleCheckpoint(bm.name)}
                        title={
                          !bm.isInstalled
                            ? `${bm.name}: ${availability.tooltip}`
                            : isSelected
                            ? `Deselect ${bm.name} (revert to workflow default)`
                            : `Select ${bm.name} for New Image`
                        }
                        className={`inline-flex items-center gap-1.5 pl-2 pr-2.5 py-1 rounded-full border text-xs shadow-sm transition-all min-w-0 max-w-[65%] ${
                          !bm.isInstalled
                            ? 'bg-zinc-900 border-zinc-800 text-zinc-500 opacity-55 cursor-not-allowed'
                            : isSelected
                            ? 'bg-emerald-600/30 border-emerald-400 text-emerald-100 ring-1 ring-emerald-400/50 cursor-pointer'
                            : 'bg-emerald-950/60 border-emerald-500/40 text-emerald-200 hover:border-emerald-400/70 hover:bg-emerald-950/80 cursor-pointer'
                        }`}
                      >
                        <Cpu
                          className={`w-3.5 h-3.5 shrink-0 ${
                            bm.isInstalled ? 'text-emerald-400' : 'text-zinc-500'
                          }`}
                        />
                        <span className="font-medium truncate">
                          {bm.displayName}
                        </span>
                        {!bm.isInstalled ? (
                          <span className="text-[10px] font-mono text-amber-400/90 shrink-0">
                            ({availability.label.toLowerCase()})
                          </span>
                        ) : (
                          isSelected && <Check className="w-3 h-3 text-emerald-300 shrink-0" />
                        )}
                      </button>

                      <button
                        type="button"
                        onClick={() =>
                          onFilterGalleryByAddon?.(character.id, { checkpoint: bm.name })
                        }
                        title={`Filter gallery by ${character.name} + ${bm.name}`}
                        className="flex-1 min-w-0 flex items-center justify-end gap-2 text-right cursor-pointer py-0.5 pr-1 font-mono tabular-nums text-[11px] text-zinc-400 hover:text-indigo-300 transition-colors"
                      >
                        <span className="truncate">
                          {bm.count} {bm.count === 1 ? 'img' : 'imgs'} ({bm.sharePercent}%)
                        </span>
                        {bm.avgRating > 0 && (
                          <span className="text-amber-400 shrink-0">★ {bm.avgRating}</span>
                        )}
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Paired Addon LoRAs (Amber Pill Multi-Select up to 5 Total LoRAs) */}
          {addonLoras.length > 0 && (
            <div className="space-y-1.5">
              <div className="flex items-center gap-1.5 text-[11px] font-medium text-zinc-400">
                <Layers className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                <span>Addon LoRAs ({addonLoras.length})</span>
              </div>

              <div className="space-y-1.5 max-h-80 overflow-y-auto pr-1">
                {addonLoras.map((addon) => {
                  const isSelected = selectedAddonKeys.has(addon.key);
                  const isDisabled = !addon.isInstalled || (!isSelected && atLoraLimit);
                  const availability = getModelAvailabilityInfo(addon);
                  return (
                    <div
                      key={addon.key}
                      className={`flex items-center justify-between gap-2 bg-zinc-950 border rounded-lg px-2 py-1.5 min-w-0 transition-colors ${
                        isSelected
                          ? 'border-amber-500/50 bg-amber-950/15'
                          : 'border-zinc-800 hover:border-zinc-700'
                      }`}
                    >
                      <button
                        type="button"
                        disabled={isDisabled}
                        onClick={() => handleToggleAddon(addon.key)}
                        title={
                          !addon.isInstalled
                            ? `${addon.loraName}: ${availability.tooltip}`
                            : !isSelected && atLoraLimit
                            ? `Maximum ${MAX_SYSTEM_LORAS} total LoRAs reached`
                            : isSelected
                            ? `Deselect ${addon.displayName}`
                            : `Select ${addon.displayName} (${formatPillStrength(addon.avgModelStrength)}x) for New Image`
                        }
                        className={`inline-flex items-center gap-1.5 pl-2 pr-2.5 py-1 rounded-full border text-xs shadow-sm transition-all min-w-0 max-w-[65%] ${
                          !addon.isInstalled
                            ? 'bg-zinc-900 border-zinc-800 text-zinc-500 opacity-55 cursor-not-allowed'
                            : isSelected
                            ? 'bg-amber-600/30 border-amber-400 text-amber-100 ring-1 ring-amber-400/50 cursor-pointer'
                            : isDisabled
                            ? 'bg-amber-950/30 border-amber-500/20 text-amber-200/50 opacity-55 cursor-not-allowed'
                            : 'bg-amber-950/60 border-amber-500/40 text-amber-200 hover:border-amber-400/70 hover:bg-amber-950/80 cursor-pointer'
                        }`}
                      >
                        <Layers
                          className={`w-3.5 h-3.5 shrink-0 ${
                            addon.isInstalled ? 'text-amber-400' : 'text-zinc-500'
                          }`}
                        />
                        <span className="font-medium truncate">{addon.displayName}</span>
                        <span
                          className={`text-[11px] font-mono tabular-nums shrink-0 ${
                            addon.isInstalled ? 'text-amber-300/90' : 'text-zinc-500'
                          }`}
                        >
                          {formatPillStrength(addon.avgModelStrength)}x
                        </span>
                        {!addon.isInstalled ? (
                          <span className="text-[10px] font-mono text-amber-400/90 shrink-0">
                            ({availability.label.toLowerCase()})
                          </span>
                        ) : (
                          isSelected && <Check className="w-3 h-3 text-amber-200 shrink-0" />
                        )}
                      </button>

                      <button
                        type="button"
                        onClick={() =>
                          onFilterGalleryByAddon?.(character.id, { loraName: addon.loraName })
                        }
                        title={`Filter gallery by ${character.name} + ${addon.loraName}`}
                        className="flex-1 min-w-0 flex items-center justify-end gap-1.5 text-right cursor-pointer py-0.5 pr-1 text-[11px] text-zinc-500 hover:text-indigo-300 transition-colors font-mono tabular-nums"
                      >
                        <span className="capitalize font-sans text-zinc-400 truncate">
                          {addon.category}
                        </span>
                        <span>·</span>
                        <span className="shrink-0">
                          {addon.count} {addon.count === 1 ? 'img' : 'imgs'}
                        </span>
                        {addon.avgRating > 0 && (
                          <>
                            <span>·</span>
                            <span className="text-amber-400 shrink-0">★ {addon.avgRating}</span>
                          </>
                        )}
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Friends (Blue Character Pill Single-Select Radio — Hidden When Empty) */}
          {friends.length > 0 && (
            <div className="space-y-1.5 pt-1 border-t border-zinc-800/80">
              <div className="flex items-center gap-1.5 text-[11px] font-medium text-zinc-400 pt-1">
                <Users className="w-3.5 h-3.5 text-indigo-400 shrink-0" />
                <span>Friends ({friends.length})</span>
              </div>
              <div className="space-y-1.5 max-h-48 overflow-y-auto pr-1">
                {friends.map((friend) => {
                  const isSelected = selectedFriendKey === friend.key;
                  // Allow switching when another friend is already picked, block only when adding from 0 at cap
                  const wouldExceedCap = !isSelected && selectedFriendKey === null && atLoraLimit;
                  const isDisabled = !friend.isInstalled || wouldExceedCap;
                  const availability = getModelAvailabilityInfo(friend);
                  return (
                    <div
                      key={friend.key}
                      className={`flex items-center justify-between gap-2 bg-zinc-950 border rounded-lg px-2 py-1.5 min-w-0 transition-colors ${
                        isSelected
                          ? 'border-indigo-500/50 bg-indigo-950/20'
                          : 'border-zinc-800 hover:border-zinc-700'
                      }`}
                    >
                      <button
                        type="button"
                        disabled={isDisabled}
                        onClick={() => handleToggleFriend(friend.key)}
                        title={
                          !friend.isInstalled
                            ? `${friend.loraName}: ${availability.tooltip}`
                            : wouldExceedCap
                            ? `Maximum ${MAX_SYSTEM_LORAS} total LoRAs reached`
                            : isSelected
                            ? `Deselect ${friend.characterName}`
                            : `Select ${friend.characterName} (${formatPillStrength(friend.avgModelStrength)}x) for New Image`
                        }
                        className={`inline-flex items-center gap-1.5 pl-1.5 pr-2.5 py-1 rounded-full border text-xs shadow-sm transition-all min-w-0 max-w-[65%] ${
                          !friend.isInstalled
                            ? 'bg-zinc-900 border-zinc-800 text-zinc-500 opacity-55 cursor-not-allowed'
                            : isSelected
                            ? 'bg-indigo-600/35 border-indigo-400 text-indigo-100 ring-1 ring-indigo-400/50 cursor-pointer'
                            : isDisabled
                            ? 'bg-indigo-950/35 border-indigo-500/20 text-indigo-200/50 opacity-55 cursor-not-allowed'
                            : 'bg-indigo-950/70 border-indigo-500/40 text-indigo-200 hover:border-indigo-400/70 hover:bg-indigo-950/90 cursor-pointer'
                        }`}
                      >
                        <div className="w-5 h-5 rounded-full bg-zinc-800 overflow-hidden flex items-center justify-center shrink-0">
                          <CharacterPortraitImage
                            src={friend.portraitThumbnailUrl}
                            alt={friend.characterName}
                            crop={friend.portraitCrop}
                            iconClassName="w-3 h-3 text-indigo-300"
                          />
                        </div>
                        <span className="font-medium truncate">{friend.characterName}</span>
                        <span className="text-[11px] font-mono text-indigo-300/90 tabular-nums shrink-0">
                          {formatPillStrength(friend.avgModelStrength)}x
                        </span>
                        {!friend.isInstalled ? (
                          <span className="text-[10px] font-mono text-amber-400/90 shrink-0">
                            ({availability.label.toLowerCase()})
                          </span>
                        ) : (
                          isSelected && <Check className="w-3 h-3 text-indigo-200 shrink-0" />
                        )}
                      </button>

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
                        className="flex-1 min-w-0 flex items-center justify-end gap-1.5 text-right cursor-pointer py-0.5 pr-1 text-[11px] text-zinc-500 hover:text-indigo-300 transition-colors font-mono tabular-nums"
                      >
                        <span className="shrink-0">
                          {friend.count} {friend.count === 1 ? 'img' : 'imgs'}
                        </span>
                        {friend.avgRating > 0 && (
                          <>
                            <span>·</span>
                            <span className="text-amber-400 shrink-0">★ {friend.avgRating}</span>
                          </>
                        )}
                      </button>
                    </div>
                  );
                })}
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
