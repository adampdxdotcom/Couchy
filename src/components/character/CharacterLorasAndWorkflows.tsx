import React, { useState } from 'react';
import { api } from '../../api/client.ts';
import type {
  CharacterProfile,
  ImageRecord,
  LoraExplorerItem,
} from '../../shared/types.ts';
import { CharacterFavoriteAddonsCard } from './CharacterFavoriteAddonsCard.tsx';

interface CharacterLorasAndWorkflowsProps {
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

export const CharacterLorasAndWorkflows: React.FC<CharacterLorasAndWorkflowsProps> = ({
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
  const [linkLoraName, setLinkLoraName] = useState('');
  const [linkLoraAppearance, setLinkLoraAppearance] = useState('Default');
  const [linkLoraTriggerWord, setLinkLoraTriggerWord] = useState('');

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      {/* Associated LoRAs (Character, Outfit, Clothing, Style, Pose) */}
      <div className="min-w-0 bg-zinc-900 border border-zinc-800/80 rounded-xl p-4 sm:p-5 space-y-3 text-xs overflow-hidden">
        <h3 className="text-sm font-display font-semibold text-zinc-100">
          Associated LoRAs &amp; Outfits ({character.loras.length})
        </h3>
        <p className="text-zinc-400">
          A character can use multiple LoRAs (e.g., base character LoRA + separate outfit or armor LoRAs)
          or appear without any LoRA.
        </p>

        {character.loras.length > 0 && (
          <div className="space-y-2">
            {character.loras.map((l) => (
              <div
                key={l.id}
                className="bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2.5 space-y-2 min-w-0 overflow-hidden"
              >
                <div className="flex items-start justify-between gap-2 min-w-0">
                  <div className="min-w-0 flex-1">
                    <div className="font-medium text-zinc-200 truncate break-all" title={l.loraName}>
                      {l.loraName}
                    </div>
                    <div className="text-[11px] text-zinc-400 break-words">
                      Role: {l.appearanceLabel} · Type: {l.loraCategory} ·{' '}
                      {l.isInstalled ? 'Installed' : 'Missing'}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={async () => {
                      await api.unlinkLoraFromCharacter(character.id, l.id);
                      await onRefresh();
                    }}
                    className="text-zinc-500 hover:text-rose-400 cursor-pointer shrink-0"
                  >
                    Unlink
                  </button>
                </div>

                {/* Editable Trigger Word for Node #30_27 */}
                <div className="flex items-center gap-2 pt-1 border-t border-zinc-900 min-w-0">
                  <span className="text-[11px] text-zinc-400 whitespace-nowrap shrink-0">
                    Trigger Word:
                  </span>
                  <input
                    type="text"
                    defaultValue={l.triggerWord || ''}
                    placeholder="e.g. xmelx (injected into Node #30_27)"
                    onBlur={async (e) => {
                      const nextTrig = e.target.value.trim();
                      if (nextTrig === (l.triggerWord || '')) return;
                      await api.linkLoraToCharacter(character.id, {
                        loraName: l.loraName,
                        appearanceLabel: l.appearanceLabel,
                        triggerWord: nextTrig,
                        loraCategory: 'character',
                        notes: l.notes,
                      });
                      await onRefresh();
                    }}
                    className="flex-1 min-w-0 px-2 py-1 text-xs font-mono bg-zinc-900 border border-zinc-800 rounded text-indigo-200 focus:outline-none focus:border-indigo-500"
                  />
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-2">
          <input
            type="text"
            list="known-loras-datalist"
            value={linkLoraName}
            onChange={(e) => setLinkLoraName(e.target.value)}
            placeholder="LoRA filename (e.g. char_v1.safetensors)..."
            className="w-full min-w-0 px-2.5 py-2 sm:py-1.5 bg-zinc-950 border border-zinc-800 rounded text-zinc-200"
          />
          <datalist id="known-loras-datalist">
            {loras.map((l) => (
              <option key={l.filename} value={l.filename} />
            ))}
          </datalist>
          <input
            type="text"
            value={linkLoraTriggerWord}
            onChange={(e) => setLinkLoraTriggerWord(e.target.value)}
            placeholder="Trigger Word (e.g. xmelx for Node #30_27)"
            className="w-full min-w-0 px-2.5 py-2 sm:py-1.5 font-mono bg-zinc-950 border border-zinc-800 rounded text-zinc-200"
          />
          <input
            type="text"
            value={linkLoraAppearance}
            onChange={(e) => setLinkLoraAppearance(e.target.value)}
            placeholder="Appearance / Outfit label"
            className="w-full min-w-0 px-2.5 py-2 sm:py-1.5 bg-zinc-950 border border-zinc-800 rounded text-zinc-200"
          />
          <div className="flex items-center gap-2 min-w-0">
            <div
              className="flex-1 min-w-0 px-2.5 py-2 sm:py-1.5 bg-zinc-950/60 border border-zinc-800 rounded text-zinc-400 truncate"
              title="Linked character LoRAs are locked to the Character classification"
            >
              Type: <span className="text-zinc-200 font-medium">Character</span>
            </div>
            <button
              type="button"
              onClick={async () => {
                if (!linkLoraName.trim()) return;
                await api.linkLoraToCharacter(character.id, {
                  loraName: linkLoraName.trim(),
                  appearanceLabel: linkLoraAppearance.trim() || 'Default',
                  triggerWord: linkLoraTriggerWord.trim(),
                  loraCategory: 'character',
                });
                setLinkLoraName('');
                setLinkLoraTriggerWord('');
                await onRefresh();
              }}
              className="px-3.5 py-2 sm:py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded cursor-pointer shrink-0"
            >
              Link
            </button>
          </div>
        </div>
      </div>

      {/* Favorite Addons, Friends (hidden when empty), & Collections */}
      <CharacterFavoriteAddonsCard
        character={character}
        allCharacters={allCharacters}
        confirmedImages={confirmedImages}
        loras={loras}
        collections={collections}
        onRefresh={onRefresh}
        onSelectCharacter={onSelectCharacter}
        onFilterGalleryByAddon={onFilterGalleryByAddon}
        onSeedQuickGenAddon={onSeedQuickGenAddon}
      />
    </div>
  );
};
