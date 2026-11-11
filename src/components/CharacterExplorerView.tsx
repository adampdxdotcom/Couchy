import React, { useEffect, useState } from 'react';
import {
  UserPlus,
  Sparkles,
  GitMerge,
  Search,
  ArrowLeft,
  CheckCircle2,
  XCircle,
  Download,
  Trash2,
  Plus,
  User,
  CheckSquare,
  Square,
  Star,
  RotateCcw,
} from 'lucide-react';
import { api } from '../api/client.ts';
import type {
  CharacterProfile,
  ImageRecord,
  LoraCategory,
  LoraExplorerItem,
  WorkflowLibraryItem,
} from '../shared/types.ts';

interface CharacterExplorerViewProps {
  characters: CharacterProfile[];
  allImages: ImageRecord[];
  loras: LoraExplorerItem[];
  workflows: WorkflowLibraryItem[];
  collections: { id: number; name: string }[];
  onRefresh: () => Promise<void>;
  onOpenImage: (img: ImageRecord) => void;
  onFilterGalleryByCharacter: (charId: number) => void;
  onQuickRate: (id: number, rating: number) => void;
  onReusePrompt?: (img: ImageRecord) => void;
}

/**
 * Dedicated First-Class Character Explorer & Profile Manager.
 */
export const CharacterExplorerView: React.FC<CharacterExplorerViewProps> = ({
  characters,
  allImages,
  loras,
  workflows,
  collections,
  onRefresh,
  onOpenImage,
  onFilterGalleryByCharacter,
  onQuickRate,
  onReusePrompt,
}) => {
  const [selectedCharId, setSelectedCharId] = useState<number | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState<'name' | 'images' | 'rating' | 'recent'>('images');

  // Create Character Modal State
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newName, setNewName] = useState('');
  const [newAliases, setNewAliases] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [newNotes, setNewNotes] = useState('');

  // Merge Modal State
  const [showMergeModal, setShowMergeModal] = useState(false);
  const [mergeTargetId, setMergeTargetId] = useState('');
  const [mergeSourceId, setMergeSourceId] = useState('');
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  // Detail Edit & Link State
  const [linkLoraName, setLinkLoraName] = useState('');
  const [linkLoraAppearance, setLinkLoraAppearance] = useState('Default');
  const [linkLoraTriggerWord, setLinkLoraTriggerWord] = useState('');
  const [linkLoraCategory, setLinkLoraCategory] = useState<LoraCategory>('character');
  const [linkWorkflowId, setLinkWorkflowId] = useState('');
  const [linkWorkflowRole, setLinkWorkflowRole] = useState('Canonical Portrait');
  const [editAliasesInput, setEditAliasesInput] = useState('');
  const [selectedSuggestedIds, setSelectedSuggestedIds] = useState<Set<number>>(new Set());

  useEffect(() => {
    setSelectedSuggestedIds(new Set());
  }, [selectedCharId]);

  const selectedCharacter = characters.find((c) => c.id === selectedCharId) || null;

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

  const handleCreateCharacter = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName.trim()) return;
    await api.createCharacter({
      name: newName.trim(),
      description: newDesc.trim(),
      notes: newNotes.trim(),
      aliases: newAliases
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
    });
    setNewName('');
    setNewAliases('');
    setNewDesc('');
    setNewNotes('');
    setShowCreateModal(false);
    await onRefresh();
  };

  const handleMergeCharacters = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!mergeTargetId || !mergeSourceId || mergeTargetId === mergeSourceId) return;
    await api.mergeCharacters(Number(mergeTargetId), Number(mergeSourceId));
    setShowMergeModal(false);
    setMergeTargetId('');
    setMergeSourceId('');
    await onRefresh();
    setStatusMessage('Characters merged non-destructively.');
    setTimeout(() => setStatusMessage(null), 3000);
  };

  const handleRunSuggestions = async () => {
    const res = await api.runCharacterSuggestions();
    await onRefresh();
    setStatusMessage(`Assisted identification complete: ${res.newSuggestions} new suggestion(s) found.`);
    setTimeout(() => setStatusMessage(null), 3500);
  };

  // Detailed Character Profile Page
  if (selectedCharacter) {
    const confirmedImages = allImages.filter((img) =>
      img.characters.some(
        (c) => c.characterId === selectedCharacter.id && c.status === 'confirmed'
      )
    );
    const suggestedImages = allImages.filter((img) =>
      img.characters.some(
        (c) => c.characterId === selectedCharacter.id && c.status === 'suggested'
      )
    );
    const highestRatedImages = [...confirmedImages]
      .filter((i) => i.rating >= 4)
      .sort((a, b) => b.rating - a.rating)
      .slice(0, 6);

    return (
      <div className="px-3.5 sm:px-6 py-4 sm:py-6 w-full max-w-7xl mx-auto space-y-6 overflow-x-hidden">
        {/* Top Back Navigation */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <button
            type="button"
            onClick={() => setSelectedCharId(null)}
            className="inline-flex items-center gap-2 text-xs font-medium text-zinc-300 hover:text-white cursor-pointer"
          >
            <ArrowLeft className="w-4 h-4 shrink-0" />
            <span>Back to Character Explorer</span>
          </button>

          <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto">
            <button
              type="button"
              onClick={() => onFilterGalleryByCharacter(selectedCharacter.id)}
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
                  archiveName: `character-${selectedCharacter.name}`,
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
              onClick={async () => {
                await api.deleteCharacter(selectedCharacter.id);
                setSelectedCharId(null);
                await onRefresh();
              }}
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
              {selectedCharacter.portraitThumbnailUrl ? (
                <img
                  src={selectedCharacter.portraitThumbnailUrl}
                  alt={selectedCharacter.name}
                  className="w-full h-full object-cover"
                />
              ) : (
                <User className="w-12 h-12 text-zinc-600" />
              )}
            </div>
            <div className="text-xs text-zinc-400 space-y-1 font-mono tabular-nums">
              <div>Confirmed Images: {selectedCharacter.confirmedImageCount}</div>
              <div>Pending Suggestions: {selectedCharacter.suggestedImageCount}</div>
              <div>Avg Rating: ★ {selectedCharacter.averageRating}</div>
              {selectedCharacter.firstGenerationDate && (
                <div>First Gen: {selectedCharacter.firstGenerationDate.slice(0, 10)}</div>
              )}
              {selectedCharacter.latestGenerationDate && (
                <div>Latest Gen: {selectedCharacter.latestGenerationDate.slice(0, 10)}</div>
              )}
            </div>
          </div>

          <div className="lg:col-span-9 min-w-0 space-y-4">
            <div className="min-w-0">
              <h1 className="text-xl sm:text-2xl font-display font-bold text-zinc-100 break-words">
                {selectedCharacter.name}
              </h1>
              <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-400 mt-1 break-words">
                <span>
                  Aliases:{' '}
                  {selectedCharacter.aliases.length > 0
                    ? selectedCharacter.aliases.map((a) => a.alias).join(' · ')
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
                  defaultValue={selectedCharacter.description}
                  onBlur={async (e) => {
                    await api.updateCharacter(selectedCharacter.id, {
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
                  defaultValue={selectedCharacter.notes}
                  onBlur={async (e) => {
                    await api.updateCharacter(selectedCharacter.id, { notes: e.target.value });
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
                  await api.updateCharacter(selectedCharacter.id, { aliases: list });
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

        {/* Linked LoRAs & Workflows Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Associated LoRAs (Character, Outfit, Clothing, Style, Pose) */}
          <div className="min-w-0 bg-zinc-900 border border-zinc-800/80 rounded-xl p-4 sm:p-5 space-y-3 text-xs overflow-hidden">
            <h3 className="text-sm font-display font-semibold text-zinc-100">
              Associated LoRAs & Outfits ({selectedCharacter.loras.length})
            </h3>
            <p className="text-zinc-400">
              A character can use multiple LoRAs (e.g., base character LoRA + separate outfit or armor LoRAs)
              or appear without any LoRA.
            </p>

            {selectedCharacter.loras.length > 0 && (
              <div className="space-y-2">
                {selectedCharacter.loras.map((l) => (
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
                          await api.unlinkLoraFromCharacter(selectedCharacter.id, l.id);
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
                          await api.linkLoraToCharacter(selectedCharacter.id, {
                            loraName: l.loraName,
                            appearanceLabel: l.appearanceLabel,
                            triggerWord: nextTrig,
                            loraCategory: l.loraCategory,
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
                <select
                  value={linkLoraCategory}
                  onChange={(e) => setLinkLoraCategory(e.target.value as LoraCategory)}
                  className="flex-1 min-w-0 px-2 py-2 sm:py-1.5 bg-zinc-950 border border-zinc-800 rounded text-zinc-200"
                >
                  <option value="character">Character</option>
                  <option value="clothing">Clothing / Outfit</option>
                  <option value="style">Style</option>
                  <option value="pose">Pose</option>
                  <option value="other">Other</option>
                </select>
                <button
                  type="button"
                  onClick={async () => {
                    if (!linkLoraName.trim()) return;
                    await api.linkLoraToCharacter(selectedCharacter.id, {
                      loraName: linkLoraName.trim(),
                      appearanceLabel: linkLoraAppearance.trim() || 'Default',
                      triggerWord: linkLoraTriggerWord.trim(),
                      loraCategory: linkLoraCategory,
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

          {/* Associated Workflows & Collections */}
          <div className="min-w-0 bg-zinc-900 border border-zinc-800/80 rounded-xl p-4 sm:p-5 space-y-3 text-xs overflow-hidden">
            <h3 className="text-sm font-display font-semibold text-zinc-100">
              Associated Workflows ({selectedCharacter.workflows.length})
            </h3>
            {selectedCharacter.workflows.length > 0 && (
              <div className="space-y-2">
                {selectedCharacter.workflows.map((w) => (
                  <div
                    key={w.workflowId}
                    className="flex items-center justify-between gap-2 bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 min-w-0"
                  >
                    <span className="font-medium text-zinc-200 truncate">{w.workflowName}</span>
                    <span className="text-zinc-400 shrink-0">{w.roleLabel}</span>
                  </div>
                ))}
              </div>
            )}

            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 pt-2">
              <select
                value={linkWorkflowId}
                onChange={(e) => setLinkWorkflowId(e.target.value)}
                className="w-full sm:flex-1 min-w-0 px-2.5 py-2 sm:py-1.5 bg-zinc-950 border border-zinc-800 rounded text-zinc-200"
              >
                <option value="">Select workflow to associate...</option>
                {workflows.map((wf) => (
                  <option key={wf.id} value={wf.id}>
                    {wf.name}
                  </option>
                ))}
              </select>
              <div className="flex items-center gap-2 w-full sm:w-auto min-w-0">
                <input
                  type="text"
                  value={linkWorkflowRole}
                  onChange={(e) => setLinkWorkflowRole(e.target.value)}
                  placeholder="Role label..."
                  className="flex-1 sm:w-36 min-w-0 px-2.5 py-2 sm:py-1.5 bg-zinc-950 border border-zinc-800 rounded text-zinc-200"
                />
                <button
                  type="button"
                  onClick={async () => {
                    if (!linkWorkflowId) return;
                    await api.linkWorkflowToCharacter(
                      selectedCharacter.id,
                      Number(linkWorkflowId),
                      linkWorkflowRole
                    );
                    setLinkWorkflowId('');
                    await onRefresh();
                  }}
                  className="px-3.5 py-2 sm:py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded cursor-pointer shrink-0"
                >
                  Link
                </button>
              </div>
            </div>

            {collections.length > 0 && (
              <div className="pt-3 border-t border-zinc-800">
                <span className="text-zinc-400 block mb-1.5">Character Collections:</span>
                <div className="flex flex-wrap gap-1.5">
                  {collections.map((col) => {
                    const isLinked = selectedCharacter.collections.some((c) => c.id === col.id);
                    return (
                      <button
                        key={col.id}
                        type="button"
                        onClick={async () => {
                          const currentIds = selectedCharacter.collections.map((c) => c.id);
                          const nextIds = isLinked
                            ? currentIds.filter((id) => id !== col.id)
                            : [...currentIds, col.id];
                          await api.updateCharacter(selectedCharacter.id, {
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
        </div>

        {/* Assisted Character Identification — Suggested Matches Queue */}
        {suggestedImages.length > 0 && (
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
                      setSelectedSuggestedIds(new Set());
                    } else {
                      setSelectedSuggestedIds(new Set(suggestedImages.map((i) => i.id)));
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
                          characterId: selectedCharacter.id,
                          status: 'confirmed',
                        });
                        setSelectedSuggestedIds(new Set());
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
                          characterId: selectedCharacter.id,
                          status: 'rejected',
                        });
                        setSelectedSuggestedIds(new Set());
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
                      characterId: selectedCharacter.id,
                      status: 'confirmed',
                    });
                    setSelectedSuggestedIds(new Set());
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
                const link = img.characters.find((c) => c.characterId === selectedCharacter.id);
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
                          setSelectedSuggestedIds((prev) => {
                            const next = new Set(prev);
                            if (next.has(img.id)) next.delete(img.id);
                            else next.add(img.id);
                            return next;
                          });
                        }}
                        aria-label={`Select suggested image ${img.filename}`}
                        className={`absolute top-2 left-2 p-1.5 rounded-md bg-black/70 backdrop-blur-xs transition-opacity cursor-pointer ${
                          isSelected
                            ? 'opacity-100 text-indigo-400'
                            : 'opacity-80 group-hover:opacity-100 text-zinc-200'
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
                              characterId: selectedCharacter.id,
                              status: 'confirmed',
                            });
                            setSelectedSuggestedIds((prev) => {
                              const next = new Set(prev);
                              next.delete(img.id);
                              return next;
                            });
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
                              characterId: selectedCharacter.id,
                              status: 'rejected',
                            });
                            setSelectedSuggestedIds((prev) => {
                              const next = new Set(prev);
                              next.delete(img.id);
                              return next;
                            });
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
        )}

        {/* Highest-Rated Character Works */}
        {highestRatedImages.length > 0 && (
          <div className="space-y-3">
            <h3 className="text-sm font-display font-semibold text-zinc-100">
              Highest-Rated Generations
            </h3>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
              {highestRatedImages.map((img) => (
                <div
                  key={img.id}
                  className="bg-zinc-900 border border-zinc-800 rounded-lg overflow-hidden group flex flex-col justify-between"
                >
                  <div
                    onClick={() => onOpenImage(img)}
                    className="relative aspect-square bg-black cursor-pointer overflow-hidden"
                  >
                    <img
                      src={img.thumbnailUrl}
                      alt={img.filename}
                      className="w-full h-full object-cover group-hover:scale-[1.02] transition-transform duration-200"
                    />

                    {/* Bottom Floating Bar on Card: Rating Stars (Left) + Actions (Right) */}
                    <div
                      className="absolute bottom-0 inset-x-0 p-2 sm:p-2.5 bg-gradient-to-t from-black/90 via-black/60 to-transparent flex items-center justify-between opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity z-10"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <div
                        className="flex items-center gap-0.5"
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
                      <div className="flex items-center gap-1">
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
                      </div>
                    </div>
                  </div>
                  <div
                    onClick={() => onOpenImage(img)}
                    className="p-2 text-xs flex items-center justify-between cursor-pointer"
                  >
                    <span className="truncate text-zinc-300">{img.filename}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* All Confirmed Character Images */}
        <div className="space-y-3">
          <h3 className="text-sm font-display font-semibold text-zinc-100">
            All Confirmed Images ({confirmedImages.length})
          </h3>
          {confirmedImages.length === 0 ? (
            <p className="text-xs text-zinc-500">
              No confirmed images yet. Assign images from the gallery or confirm suggestions above.
            </p>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-3">
              {confirmedImages.map((img) => (
                <div
                  key={img.id}
                  className="bg-zinc-900 border border-zinc-800 rounded-lg overflow-hidden group flex flex-col justify-between"
                >
                  <div
                    onClick={() => onOpenImage(img)}
                    className="relative aspect-square bg-black cursor-pointer overflow-hidden"
                  >
                    <img
                      src={img.thumbnailUrl}
                      alt={img.filename}
                      className="w-full h-full object-cover group-hover:scale-[1.02] transition-transform duration-200"
                    />

                    {/* Bottom Floating Bar on Card: Rating Stars (Left) + Actions (Right) */}
                    <div
                      className="absolute bottom-0 inset-x-0 p-2 sm:p-2.5 bg-gradient-to-t from-black/90 via-black/60 to-transparent flex items-center justify-between opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity z-10"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <div
                        className="flex items-center gap-0.5"
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
                      <div className="flex items-center gap-1">
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
                      </div>
                    </div>
                  </div>
                  <div className="p-2 text-xs flex items-center justify-between gap-1">
                    <span
                      onClick={() => onOpenImage(img)}
                      className="truncate text-zinc-200 cursor-pointer"
                    >
                      {img.filename}
                    </span>
                    <button
                      type="button"
                      onClick={async () => {
                        await api.updateCharacter(selectedCharacter.id, {
                          portraitImageId: img.id,
                        });
                        await onRefresh();
                      }}
                      className="text-[11px] text-indigo-400 hover:text-indigo-300 shrink-0 cursor-pointer"
                      title="Set as Character Portrait"
                    >
                      Set Portrait
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    );
  }

  // Main Character Explorer Roster View
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
            onClick={handleRunSuggestions}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium bg-zinc-900 border border-zinc-800 hover:border-zinc-700 text-amber-300 rounded-lg cursor-pointer"
          >
            <Sparkles className="w-3.5 h-3.5 shrink-0" />
            <span>Run Assisted Character Identification</span>
          </button>

          {characters.length >= 2 && (
            <button
              type="button"
              onClick={() => setShowMergeModal(true)}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium bg-zinc-900 border border-zinc-800 hover:border-zinc-700 text-zinc-200 rounded-lg cursor-pointer"
            >
              <GitMerge className="w-3.5 h-3.5 shrink-0" />
              <span>Merge Characters</span>
            </button>
          )}

          <button
            type="button"
            onClick={() => setShowCreateModal(true)}
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
            onClick={() => setShowCreateModal(true)}
            className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Create First Character</span>
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {filteredCharacters.map((char) => (
            <div
              key={char.id}
              onClick={() => setSelectedCharId(char.id)}
              className="bg-zinc-900 border border-zinc-800/80 hover:border-zinc-700 rounded-xl overflow-hidden cursor-pointer transition-colors flex flex-col justify-between"
            >
              <div className="aspect-[4/3] bg-zinc-950 relative overflow-hidden flex items-center justify-center">
                {char.portraitThumbnailUrl ? (
                  <img
                    src={char.portraitThumbnailUrl}
                    alt={char.name}
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <User className="w-12 h-12 text-zinc-700" />
                )}
              </div>

              <div className="p-4 space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="text-sm font-display font-semibold text-zinc-100 truncate">
                    {char.name}
                  </h3>
                  {char.averageRating > 0 && (
                    <span className="text-xs font-mono tabular-nums text-amber-400">
                      ★ {char.averageRating}
                    </span>
                  )}
                </div>

                {/* Unboxed Metadata with · Separators */}
                <div className="text-xs text-zinc-400 font-mono tabular-nums flex flex-wrap items-center gap-1.5">
                  <span>{char.confirmedImageCount} images</span>
                  <span aria-hidden="true">·</span>
                  <span>{char.loras.length} LoRAs</span>
                  {char.suggestedImageCount > 0 && (
                    <>
                      <span aria-hidden="true">·</span>
                      <span className="text-amber-400 font-sans">
                        {char.suggestedImageCount} suggested
                      </span>
                    </>
                  )}
                </div>

                {char.aliases.length > 0 && (
                  <p className="text-[11px] text-zinc-500 truncate">
                    Aliases: {char.aliases.map((a) => a.alias).join(' · ')}
                  </p>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Create Character Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4">
          <form
            onSubmit={handleCreateCharacter}
            className="bg-zinc-900 border border-zinc-800 rounded-xl max-w-md w-full p-6 space-y-4 text-xs"
          >
            <h3 className="text-base font-display font-semibold text-zinc-100">
              Create Character Profile
            </h3>
            <div>
              <label className="block text-zinc-300 mb-1">Character Name *</label>
              <input
                type="text"
                required
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="e.g. Elena Vance"
                className="w-full px-3 py-2 bg-zinc-950 border border-zinc-800 rounded-lg text-zinc-100"
              />
            </div>
            <div>
              <label className="block text-zinc-300 mb-1">
                Aliases / Prompt Triggers (comma-separated)
              </label>
              <input
                type="text"
                value={newAliases}
                onChange={(e) => setNewAliases(e.target.value)}
                placeholder="e.g. elena_v, Lady Elena, Agent Vance"
                className="w-full px-3 py-2 bg-zinc-950 border border-zinc-800 rounded-lg text-zinc-100"
              />
            </div>
            <div>
              <label className="block text-zinc-300 mb-1">Description</label>
              <textarea
                rows={2}
                value={newDesc}
                onChange={(e) => setNewDesc(e.target.value)}
                className="w-full p-2.5 bg-zinc-950 border border-zinc-800 rounded-lg text-zinc-100"
              />
            </div>
            <div>
              <label className="block text-zinc-300 mb-1">Notes</label>
              <textarea
                rows={2}
                value={newNotes}
                onChange={(e) => setNewNotes(e.target.value)}
                className="w-full p-2.5 bg-zinc-950 border border-zinc-800 rounded-lg text-zinc-100"
              />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setShowCreateModal(false)}
                className="px-3.5 py-2 bg-zinc-800 text-zinc-300 rounded-lg cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white font-medium rounded-lg cursor-pointer"
              >
                Create Profile
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Merge Characters Modal */}
      {showMergeModal && (
        <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4">
          <form
            onSubmit={handleMergeCharacters}
            className="bg-zinc-900 border border-zinc-800 rounded-xl max-w-md w-full p-6 space-y-4 text-xs"
          >
            <h3 className="text-base font-display font-semibold text-zinc-100">
              Merge Character Profiles
            </h3>
            <p className="text-zinc-400">
              Merging moves all aliases, confirmed/suggested images, associated LoRAs, workflows,
              collections, and notes from the source profile into the destination profile.
            </p>
            <div>
              <label className="block text-zinc-300 mb-1">Keep Primary Character (Target)</label>
              <select
                required
                value={mergeTargetId}
                onChange={(e) => setMergeTargetId(e.target.value)}
                className="w-full px-3 py-2 bg-zinc-950 border border-zinc-800 rounded-lg text-zinc-100"
              >
                <option value="">Select target character...</option>
                {characters.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-zinc-300 mb-1">Merge & Absorb Character (Source)</label>
              <select
                required
                value={mergeSourceId}
                onChange={(e) => setMergeSourceId(e.target.value)}
                className="w-full px-3 py-2 bg-zinc-950 border border-zinc-800 rounded-lg text-zinc-100"
              >
                <option value="">Select source character to merge...</option>
                {characters
                  .filter((c) => String(c.id) !== mergeTargetId)
                  .map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
              </select>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setShowMergeModal(false)}
                className="px-3.5 py-2 bg-zinc-800 text-zinc-300 rounded-lg cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white font-medium rounded-lg cursor-pointer"
              >
                Confirm Merge
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};
