import React, { useEffect, useState } from 'react';
import {
  ArrowLeft,
  Download,
  Loader2,
  Pencil,
  ScanFace,
  Trash2,
} from 'lucide-react';
import { api } from '../../api/client.ts';
import type { CharacterProfile, ImageRecord, PortraitCrop } from '../../shared/types.ts';
import { CharacterPortraitImage } from './CharacterPortraitImage.tsx';
import { PortraitCropModal } from './PortraitCropModal.tsx';

interface CharacterProfileHeaderProps {
  character: CharacterProfile;
  confirmedImages: ImageRecord[];
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
  currentPortraitThumb,
  currentPortraitCrop,
  onBack,
  onFilterGallery,
  onDeleteProfile,
  onRefresh,
  onPushToast,
}) => {
  const [editAliasesInput, setEditAliasesInput] = useState('');
  const [personalityInput, setPersonalityInput] = useState(character.description);
  const [physicalInput, setPhysicalInput] = useState(character.physicalDescription || '');
  const [notesInput, setNotesInput] = useState(character.notes);
  const [isAnalyzingPortrait, setIsAnalyzingPortrait] = useState(false);
  const [analyzeStatus, setAnalyzeStatus] = useState<string | null>(null);
  const [showCropModal, setShowCropModal] = useState(false);

  useEffect(() => {
    setPersonalityInput(character.description);
  }, [character.id, character.description]);

  useEffect(() => {
    setPhysicalInput(character.physicalDescription || '');
  }, [character.id, character.physicalDescription]);

  useEffect(() => {
    setNotesInput(character.notes);
  }, [character.id, character.notes]);

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
