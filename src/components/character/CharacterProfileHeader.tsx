import React, { useEffect, useRef, useState } from 'react';
import {
  ArrowLeft,
  Download,
  Layers,
  Loader2,
  Pencil,
  Plus,
  ScanFace,
  Trash2,
} from 'lucide-react';
import { api } from '../../api/client.ts';
import type {
  CharacterProfile,
  ImageRecord,
  LoraExplorerItem,
  PortraitCrop,
} from '../../shared/types.ts';
import { getModelAvailabilityInfo } from '../../shared/utils.ts';
import { CharacterPortraitImage } from './CharacterPortraitImage.tsx';
import { PortraitCropModal } from './PortraitCropModal.tsx';

interface CharacterProfileHeaderProps {
  character: CharacterProfile;
  confirmedImages: ImageRecord[];
  loras?: LoraExplorerItem[];
  currentPortraitThumb: string | null;
  currentPortraitCrop?: PortraitCrop | null;
  onBack: () => void;
  onFilterGallery: () => void;
  onDeleteProfile: () => Promise<void>;
  onRefresh: () => Promise<void>;
  onPushToast?: (text: string, type?: 'info' | 'success' | 'warning' | 'error') => void;
}

export const CharacterProfileHeader: React.FC<CharacterProfileHeaderProps> = ({
  character,
  confirmedImages,
  loras = [],
  currentPortraitThumb,
  currentPortraitCrop,
  onBack,
  onFilterGallery,
  onDeleteProfile,
  onRefresh,
  onPushToast,
}) => {
  const [nameInput, setNameInput] = useState(character.name);
  const [isEditingName, setIsEditingName] = useState(false);
  const [isSavingName, setIsSavingName] = useState(false);
  const nameInputRef = useRef<HTMLInputElement>(null);
  const [editAliasesInput, setEditAliasesInput] = useState('');
  const [personalityInput, setPersonalityInput] = useState(character.description);
  const [physicalInput, setPhysicalInput] = useState(character.physicalDescription || '');
  const [notesInput, setNotesInput] = useState(character.notes);
  const [isAnalyzingPortrait, setIsAnalyzingPortrait] = useState(false);
  const [analyzeStatus, setAnalyzeStatus] = useState<string | null>(null);
  const [showCropModal, setShowCropModal] = useState(false);
  const [showLinkLoraForm, setShowLinkLoraForm] = useState(false);
  const [linkLoraName, setLinkLoraName] = useState('');
  const [linkLoraTriggerWord, setLinkLoraTriggerWord] = useState('');

  useEffect(() => {
    setNameInput(character.name);
    setIsEditingName(false);
  }, [character.id, character.name]);

  useEffect(() => {
    setPersonalityInput(character.description);
  }, [character.id, character.description]);

  useEffect(() => {
    setPhysicalInput(character.physicalDescription || '');
  }, [character.id, character.physicalDescription]);

  useEffect(() => {
    setNotesInput(character.notes);
  }, [character.id, character.notes]);

  useEffect(() => {
    setShowLinkLoraForm(false);
    setLinkLoraName('');
    setLinkLoraTriggerWord('');
  }, [character.id]);

  const startEditingName = () => {
    setNameInput(character.name);
    setIsEditingName(true);
    requestAnimationFrame(() => {
      nameInputRef.current?.focus();
      nameInputRef.current?.select();
    });
  };

  const commitNameEdit = async () => {
    if (isSavingName) return;
    const trimmed = nameInput.trim();
    if (!trimmed || trimmed === character.name) {
      setNameInput(character.name);
      setIsEditingName(false);
      return;
    }
    setIsSavingName(true);
    try {
      await api.updateCharacter(character.id, { name: trimmed });
      setIsEditingName(false);
      await onRefresh();
    } catch (err: any) {
      onPushToast?.(err?.message || 'Failed to rename character', 'error');
      setNameInput(character.name);
      setIsEditingName(false);
    } finally {
      setIsSavingName(false);
    }
  };

  const handleAnalyzePortrait = async () => {
    if (isAnalyzingPortrait) return;
    setIsAnalyzingPortrait(true);
    setAnalyzeStatus(null);
    try {
      const res = await api.analyzeCharacterPortrait(character.id);
      setPhysicalInput(res.physicalDescription);
      const modeLabel =
        res.pipelineUsed === 'vision'
          ? `Vision (${res.modelUsed})`
          : res.pipelineUsed === 'wd14_text'
          ? `WD14 + LLM (${res.modelUsed})`
          : 'WD14 Tags';
      const msg = `Analyzed portrait via ${modeLabel}`;
      setAnalyzeStatus(msg);
      onPushToast?.(msg, 'success');
      await onRefresh();
    } catch (err: any) {
      const errMsg = err?.message || 'Failed to analyze character portrait.';
      setAnalyzeStatus(errMsg);
      onPushToast?.(errMsg, 'error');
    } finally {
      setIsAnalyzingPortrait(false);
    }
  };

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
          <div className="relative w-36 h-36 sm:w-40 sm:h-40 rounded-xl bg-zinc-950 border border-zinc-800 overflow-hidden flex items-center justify-center shrink-0">
            <CharacterPortraitImage
              src={currentPortraitThumb}
              alt={character.name}
              crop={currentPortraitCrop}
              iconClassName="w-12 h-12 text-zinc-600"
            />
            {currentPortraitThumb && (
              <button
                type="button"
                onClick={() => setShowCropModal(true)}
                title="Adjust display framing & zoom (never alters original photo or LLM analysis)"
                aria-label="Edit portrait framing"
                className="absolute bottom-2 right-2 p-1.5 rounded-lg bg-zinc-950/85 hover:bg-indigo-600 border border-zinc-700/80 hover:border-indigo-400 text-zinc-200 hover:text-white shadow-md backdrop-blur-sm cursor-pointer transition-colors"
              >
                <Pencil className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
          <div className="text-xs text-zinc-400 space-y-1 font-mono tabular-nums w-full text-center lg:text-left">
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

          {/* Linked Character LoRA(s) */}
          <div className="w-full pt-2 border-t border-zinc-800/80 space-y-2 text-xs">
            <div className="flex items-center justify-between gap-2">
              <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-zinc-300">
                <Layers className="w-3.5 h-3.5 text-indigo-400 shrink-0" />
                <span>Character LoRA ({character.loras.length})</span>
              </span>
              <button
                type="button"
                onClick={() => setShowLinkLoraForm((prev) => !prev)}
                className="inline-flex items-center gap-1 text-[11px] text-indigo-400 hover:text-indigo-300 cursor-pointer"
                title={showLinkLoraForm ? 'Close LoRA linker' : 'Link a character LoRA'}
              >
                <Plus className="w-3 h-3" />
                <span>{showLinkLoraForm ? 'Close' : 'Link'}</span>
              </button>
            </div>

            {character.loras.length === 0 && !showLinkLoraForm && (
              <div className="text-[11px] text-zinc-500">No linked LoRA yet.</div>
            )}

            {character.loras.map((l) => {
              const availability = getModelAvailabilityInfo(l);
              return (
              <div
                key={l.id}
                className="bg-zinc-950/90 border border-zinc-800 rounded-lg p-2.5 space-y-1.5 min-w-0"
              >
                <div className="flex items-start justify-between gap-2 min-w-0">
                  <div className="min-w-0 flex-1">
                    <div
                      className="font-mono text-[11px] text-zinc-200 truncate"
                      title={l.loraName}
                    >
                      {l.loraName}
                    </div>
                    <div className="text-[10px] text-zinc-400">
                      <span className={availability.colorClass} title={availability.tooltip}>
                        {availability.label}
                      </span>
                      {l.appearanceLabel && l.appearanceLabel !== 'Default'
                        ? ` · ${l.appearanceLabel}`
                        : ''}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={async () => {
                      await api.unlinkLoraFromCharacter(character.id, l.id);
                      await onRefresh();
                    }}
                    className="text-[11px] text-zinc-500 hover:text-rose-400 cursor-pointer shrink-0"
                  >
                    Unlink
                  </button>
                </div>

                <div className="flex items-center gap-1.5 pt-1 border-t border-zinc-900 min-w-0">
                  <span className="text-[10px] text-zinc-500 whitespace-nowrap shrink-0">
                    Trigger:
                  </span>
                  <input
                    key={`${character.id}-${l.id}-${l.triggerWord || ''}`}
                    type="text"
                    defaultValue={l.triggerWord || ''}
                    placeholder="e.g. xmelx"
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
                    className="flex-1 min-w-0 px-2 py-0.5 text-[11px] font-mono bg-zinc-900 border border-zinc-800 rounded text-indigo-200 focus:outline-none focus:border-indigo-500"
                  />
                </div>
              </div>
              );
            })}

            {showLinkLoraForm && (
              <div className="bg-zinc-950/90 border border-zinc-800 rounded-lg p-2.5 space-y-2">
                <input
                  type="text"
                  list="profile-known-loras-datalist"
                  value={linkLoraName}
                  onChange={(e) => setLinkLoraName(e.target.value)}
                  placeholder="LoRA filename..."
                  className="w-full min-w-0 px-2 py-1 text-[11px] bg-zinc-900 border border-zinc-800 rounded text-zinc-200"
                />
                <datalist id="profile-known-loras-datalist">
                  {loras.map((l) => (
                    <option key={l.filename} value={l.filename} />
                  ))}
                </datalist>
                <div className="flex items-center gap-1.5">
                  <input
                    type="text"
                    value={linkLoraTriggerWord}
                    onChange={(e) => setLinkLoraTriggerWord(e.target.value)}
                    placeholder="Trigger word..."
                    className="flex-1 min-w-0 px-2 py-1 text-[11px] font-mono bg-zinc-900 border border-zinc-800 rounded text-zinc-200"
                  />
                  <button
                    type="button"
                    onClick={async () => {
                      if (!linkLoraName.trim()) return;
                      await api.linkLoraToCharacter(character.id, {
                        loraName: linkLoraName.trim(),
                        appearanceLabel: 'Default',
                        triggerWord: linkLoraTriggerWord.trim(),
                        loraCategory: 'character',
                      });
                      setLinkLoraName('');
                      setLinkLoraTriggerWord('');
                      setShowLinkLoraForm(false);
                      await onRefresh();
                    }}
                    className="px-2.5 py-1 text-[11px] bg-indigo-600 hover:bg-indigo-500 text-white rounded cursor-pointer shrink-0"
                  >
                    Link
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="lg:col-span-9 min-w-0 space-y-4">
          <div className="min-w-0">
            {isEditingName ? (
              <input
                ref={nameInputRef}
                type="text"
                value={nameInput}
                disabled={isSavingName}
                onChange={(e) => setNameInput(e.target.value)}
                onBlur={() => {
                  commitNameEdit();
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    commitNameEdit();
                  } else if (e.key === 'Escape') {
                    e.preventDefault();
                    setNameInput(character.name);
                    setIsEditingName(false);
                  }
                }}
                aria-label="Character name"
                className="w-full max-w-xl px-2 py-0.5 -ml-2 text-xl sm:text-2xl font-display font-bold text-zinc-100 bg-zinc-950/90 border border-indigo-500/70 rounded-lg focus:outline-none focus:ring-1 focus:ring-indigo-500"
              />
            ) : (
              <div className="inline-flex items-center gap-2 max-w-full group">
                <h1
                  onClick={startEditingName}
                  title="Click to rename character"
                  className="text-xl sm:text-2xl font-display font-bold text-zinc-100 hover:text-white break-words cursor-text transition-colors"
                >
                  {character.name}
                </h1>
                <button
                  type="button"
                  onClick={startEditingName}
                  title="Rename character"
                  aria-label="Rename character"
                  className="p-1 rounded-md text-zinc-500 hover:text-indigo-300 group-hover:text-zinc-300 hover:bg-zinc-800/70 transition-colors cursor-pointer shrink-0"
                >
                  <Pencil className="w-4 h-4" />
                </button>
              </div>
            )}
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
                Personality &amp; Bio
              </label>
              <textarea
                rows={3}
                value={personalityInput}
                onChange={(e) => setPersonalityInput(e.target.value)}
                onBlur={async () => {
                  if (personalityInput !== character.description) {
                    await api.updateCharacter(character.id, {
                      description: personalityInput,
                    });
                    await onRefresh();
                  }
                }}
                placeholder="Demeanor, personality, lore, vibe, or role..."
                className="w-full p-2.5 bg-zinc-950 border border-zinc-800 rounded-lg text-zinc-200 focus:outline-none focus:border-indigo-500"
              />
            </div>
            <div className="min-w-0">
              <label className="block text-zinc-400 mb-1 font-medium">User Notes</label>
              <textarea
                rows={3}
                value={notesInput}
                onChange={(e) => setNotesInput(e.target.value)}
                onBlur={async () => {
                  if (notesInput !== character.notes) {
                    await api.updateCharacter(character.id, { notes: notesInput });
                    await onRefresh();
                  }
                }}
                placeholder="Recommended LoRA weights, preferred checkpoints, or workflow notes..."
                className="w-full p-2.5 bg-zinc-950 border border-zinc-800 rounded-lg text-zinc-200 focus:outline-none focus:border-indigo-500"
              />
            </div>
          </div>

          {/* Physical Description Reference Guide + Adaptive Portrait Scan */}
          <div className="text-xs space-y-1.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-2">
                <label className="text-zinc-400 font-medium">
                  Physical Description (Agent Reference Guide)
                </label>
                {analyzeStatus && (
                  <span className="text-[11px] text-indigo-300 font-mono">{analyzeStatus}</span>
                )}
              </div>
              <button
                type="button"
                disabled={isAnalyzingPortrait || !currentPortraitThumb}
                onClick={handleAnalyzePortrait}
                title={
                  currentPortraitThumb
                    ? 'Scan character portrait (uses Vision LLM if available, or falls back to WD14 + LLM) to extract baseline physical traits'
                    : 'Set a portrait image (or confirm a character image) first'
                }
                className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-indigo-600/20 hover:bg-indigo-600/35 border border-indigo-500/40 disabled:opacity-40 text-indigo-200 rounded-lg cursor-pointer transition-colors"
              >
                {isAnalyzingPortrait ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <ScanFace className="w-3.5 h-3.5" />
                )}
                <span>{isAnalyzingPortrait ? 'Analyzing Portrait...' : 'Analyze Portrait'}</span>
              </button>
            </div>
            <textarea
              rows={2}
              value={physicalInput}
              onChange={(e) => setPhysicalInput(e.target.value)}
              onBlur={async () => {
                if (physicalInput !== (character.physicalDescription || '')) {
                  await api.updateCharacter(character.id, {
                    physicalDescription: physicalInput,
                  });
                  await onRefresh();
                }
              }}
              placeholder="Gender presentation, skin tone, hair color/texture, eye color, build, and permanent marks (used by the Agent as a guide, not copied verbatim)..."
              className="w-full p-2.5 bg-zinc-950 border border-zinc-800 rounded-lg text-zinc-200 focus:outline-none focus:border-indigo-500"
            />
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

      {currentPortraitThumb && (
        <PortraitCropModal
          isOpen={showCropModal}
          characterName={character.name}
          portraitUrl={currentPortraitThumb}
          initialCrop={currentPortraitCrop}
          onClose={() => setShowCropModal(false)}
          onSave={async (nextCrop) => {
            await api.updateCharacter(character.id, { portraitCrop: nextCrop });
            await onRefresh();
            onPushToast?.(
              nextCrop ? 'Saved portrait display framing' : 'Reset portrait framing to default',
              'success'
            );
          }}
        />
      )}
    </>
  );
};
