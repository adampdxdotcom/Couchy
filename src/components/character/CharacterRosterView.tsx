import React, { useState } from 'react';
import {
  GitMerge,
  Plus,
  Search,
  Sparkles,
  User,
  UserPlus,
} from 'lucide-react';
import type { CharacterProfile } from '../../shared/types.ts';
import { CharacterCard } from './CharacterCard.tsx';

interface CharacterRosterViewProps {
  characters: CharacterProfile[];
  onSelectCharacter: (charId: number) => void;
  onOpenCreateModal: () => void;
  onOpenMergeModal: () => void;
  onRunSuggestions: () => Promise<void>;
  statusMessage?: string | null;
}

export const CharacterRosterView: React.FC<CharacterRosterViewProps> = ({
  characters,
  onSelectCharacter,
  onOpenCreateModal,
  onOpenMergeModal,
  onRunSuggestions,
  statusMessage,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState<'name' | 'images' | 'rating' | 'recent'>('images');

  const filteredCharacters = characters
    .filter((c) => {
      if (!searchQuery.trim()) return true;
      const q = searchQuery.toLowerCase();
      return (
        c.name.toLowerCase().includes(q) ||
        c.description.toLowerCase().includes(q) ||
        c.aliases.some((a) => a.alias.toLowerCase().includes(q)) ||
        c.loras.some((l) => l.loraName.toLowerCase().includes(q))
      );
    })
    .sort((a, b) => {
      if (sortBy === 'name') return a.name.localeCompare(b.name);
      if (sortBy === 'rating') return b.averageRating - a.averageRating;
      if (sortBy === 'recent')
        return (b.latestGenerationDate || '').localeCompare(a.latestGenerationDate || '');
      return b.confirmedImageCount - a.confirmedImageCount;
    });

  return (
    <div className="px-3.5 sm:px-6 py-4 sm:py-6 w-full max-w-7xl mx-auto space-y-6 overflow-x-hidden">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-xl font-display font-semibold text-zinc-100">
            Character Explorer
          </h1>
          <p className="text-xs text-zinc-400 mt-0.5">
            First-class character entities independent of individual LoRAs, checkpoints, or image files.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <button
            type="button"
            onClick={onRunSuggestions}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium bg-zinc-900 border border-zinc-800 hover:border-zinc-700 text-amber-300 rounded-lg cursor-pointer"
          >
            <Sparkles className="w-3.5 h-3.5 shrink-0" />
            <span>Run Assisted Character Identification</span>
          </button>

          {characters.length >= 2 && (
            <button
              type="button"
              onClick={onOpenMergeModal}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium bg-zinc-900 border border-zinc-800 hover:border-zinc-700 text-zinc-200 rounded-lg cursor-pointer"
            >
              <GitMerge className="w-3.5 h-3.5 shrink-0" />
              <span>Merge Characters</span>
            </button>
          )}

          <button
            type="button"
            onClick={onOpenCreateModal}
            className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg cursor-pointer"
          >
            <UserPlus className="w-3.5 h-3.5 shrink-0" />
            <span>New Character Profile</span>
          </button>
        </div>
      </div>

      {statusMessage && (
        <div className="px-4 py-2.5 bg-indigo-500/15 border border-indigo-500/40 rounded-lg text-xs text-indigo-200">
          {statusMessage}
        </div>
      )}

      {/* Search & Sort Bar */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 bg-zinc-900/80 border border-zinc-800/80 rounded-xl p-3">
        <div className="relative flex-1 min-w-0">
          <Search className="w-4 h-4 text-zinc-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search characters by name, alias, description, or associated LoRA..."
            className="w-full pl-9 pr-4 py-1.5 text-xs bg-zinc-950 border border-zinc-800 rounded-lg text-zinc-100"
          />
        </div>
        <select
          value={sortBy}
          onChange={(e) => setSortBy(e.target.value as any)}
          className="px-3 py-1.5 text-xs bg-zinc-950 border border-zinc-800 rounded-lg text-zinc-200 shrink-0"
        >
          <option value="images">Sort: Most Images</option>
          <option value="rating">Sort: Highest Avg Rating</option>
          <option value="recent">Sort: Most Recent Generation</option>
          <option value="name">Sort: Character Name</option>
        </select>
      </div>

      {/* Character Cards Grid */}
      {filteredCharacters.length === 0 ? (
        <div className="bg-zinc-900/60 border border-zinc-800/80 rounded-xl p-12 text-center space-y-3">
          <User className="w-10 h-10 text-zinc-600 mx-auto" />
          <h3 className="text-sm font-display font-semibold text-zinc-200">
            No Character Profiles Created Yet
          </h3>
          <p className="text-xs text-zinc-400 max-w-md mx-auto">
            Create character profiles to group generations across multiple LoRAs, outfits, checkpoints,
            and prompt aliases.
          </p>
          <button
            type="button"
            onClick={onOpenCreateModal}
            className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Create First Character</span>
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {filteredCharacters.map((char) => (
            <CharacterCard
              key={char.id}
              character={char}
              onClick={() => onSelectCharacter(char.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
};
