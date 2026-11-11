import React, { useState } from 'react';
import {
  ArrowLeft,
  Download,
  Trash2,
  User,
} from 'lucide-react';
import { api } from '../../api/client.ts';
import type { CharacterProfile, ImageRecord } from '../../shared/types.ts';

interface CharacterProfileHeaderProps {
  character: CharacterProfile;
  confirmedImages: ImageRecord[];
  currentPortraitThumb: string | null;
  onBack: () => void;
  onFilterGallery: () => void;
  onDeleteProfile: () => Promise<void>;
  onRefresh: () => Promise<void>;
}

export const CharacterProfileHeader: React.FC<CharacterProfileHeaderProps> = ({
  character,
  confirmedImages,
  currentPortraitThumb,
  onBack,
  onFilterGallery,
  onDeleteProfile,
  onRefresh,
}) => {
  const [editAliasesInput, setEditAliasesInput] = useState('');

  return (
    <>
      {/* Top Back Navigation */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center gap-2 text-xs font-medium text-zinc-300 hover:text-white cursor-pointer"
        >
          <ArrowLeft className="w-4 h-4 shrink-0" />
          <span>Back to Character Explorer</span>
        </button>

        <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto">
          <button
            type="button"
            onClick={onFilterGallery}
            className="px-3 py-1.5 text-xs font-medium bg-zinc-900 border border-zinc-800 hover:border-zinc-700 text-zinc-200 rounded-lg cursor-pointer whitespace-nowrap"
          >
            Open in Main Gallery Filter
          </button>
          <button
            type="button"
            disabled={confirmedImages.length === 0}
            onClick={() =>
              api.exportImagesZip({
                imageIds: confirmedImages.map((i) => i.id),
                archiveName: `character-${character.name}`,
              })
            }
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white rounded-lg cursor-pointer whitespace-nowrap"
          >
            <Download className="w-3.5 h-3.5 shrink-0" />
            <span className="font-mono tabular-nums">
              Download All Images ({confirmedImages.length})
            </span>
          </button>
          <button
            type="button"
            onClick={onDeleteProfile}
            className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs bg-zinc-900 border border-zinc-800 hover:border-rose-500/50 text-rose-400 rounded-lg cursor-pointer whitespace-nowrap"
          >
            <Trash2 className="w-3.5 h-3.5 shrink-0" />
            <span>Delete Profile</span>
          </button>
        </div>
      </div>

      {/* Profile Overview Banner */}
      <div className="bg-zinc-900 border border-zinc-800/80 rounded-xl p-4 sm:p-6 grid grid-cols-1 lg:grid-cols-12 gap-6 overflow-hidden">
        <div className="lg:col-span-3 min-w-0 flex flex-col items-center lg:items-start gap-3">
          <div className="w-36 h-36 sm:w-40 sm:h-40 rounded-xl bg-zinc-950 border border-zinc-800 overflow-hidden flex items-center justify-center shrink-0">
            {currentPortraitThumb ? (
              <img
                src={currentPortraitThumb}
                alt={character.name}
                className="w-full h-full object-cover"
              />
            ) : (
              <User className="w-12 h-12 text-zinc-600" />
            )}
          </div>
          <div className="text-xs text-zinc-400 space-y-1 font-mono tabular-nums">
            <div>Confirmed Images: {character.confirmedImageCount}</div>
            <div>Pending Suggestions: {character.suggestedImageCount}</div>
            <div>Avg Rating: ★ {character.averageRating}</div>
            {character.firstGenerationDate && (
              <div>First Gen: {character.firstGenerationDate.slice(0, 10)}</div>
            )}
            {character.latestGenerationDate && (
              <div>Latest Gen: {character.latestGenerationDate.slice(0, 10)}</div>
            )}
          </div>
        </div>

        <div className="lg:col-span-9 min-w-0 space-y-4">
          <div className="min-w-0">
            <h1 className="text-xl sm:text-2xl font-display font-bold text-zinc-100 break-words">
              {character.name}
            </h1>
            <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-400 mt-1 break-words">
              <span>
                Aliases:{' '}
                {character.aliases.length > 0
                  ? character.aliases.map((a) => a.alias).join(' · ')
                  : 'None'}
              </span>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
            <div className="min-w-0">
              <label className="block text-zinc-400 mb-1 font-medium">
                Character Description
              </label>
              <textarea
                rows={3}
                defaultValue={character.description}
                onBlur={async (e) => {
                  await api.updateCharacter(character.id, {
                    description: e.target.value,
                  });
                  await onRefresh();
                }}
                placeholder="Visual traits, lore, canonical outfits, or prompt triggers..."
                className="w-full p-2.5 bg-zinc-950 border border-zinc-800 rounded-lg text-zinc-200"
              />
            </div>
            <div className="min-w-0">
              <label className="block text-zinc-400 mb-1 font-medium">User Notes</label>
              <textarea
                rows={3}
                defaultValue={character.notes}
                onBlur={async (e) => {
                  await api.updateCharacter(character.id, { notes: e.target.value });
                  await onRefresh();
                }}
                placeholder="Recommended LoRA weights, preferred checkpoints, or workflow notes..."
                className="w-full p-2.5 bg-zinc-950 border border-zinc-800 rounded-lg text-zinc-200"
              />
            </div>
          </div>

          {/* Edit Aliases Inline */}
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 text-xs">
            <input
              type="text"
              value={editAliasesInput}
              onChange={(e) => setEditAliasesInput(e.target.value)}
              placeholder="Update comma-separated aliases (used by Assisted Identification)..."
              className="flex-1 min-w-0 w-full px-3 py-2 sm:py-1.5 bg-zinc-950 border border-zinc-800 rounded-lg text-zinc-200"
            />
            <button
              type="button"
              onClick={async () => {
                const list = editAliasesInput
                  .split(',')
                  .map((s) => s.trim())
                  .filter(Boolean);
                await api.updateCharacter(character.id, { aliases: list });
                setEditAliasesInput('');
                await onRefresh();
              }}
              className="px-3 py-2 sm:py-1.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 rounded-lg cursor-pointer shrink-0 whitespace-nowrap"
            >
              Save Aliases
            </button>
          </div>
        </div>
      </div>
    </>
  );
};
