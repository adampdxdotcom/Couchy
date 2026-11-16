import React from 'react';
import { Camera, UserPlus } from 'lucide-react';
import type {
  CharacterDownloadAutomation,
  ExternalModelSearchResult,
} from '../../shared/types.ts';

/**
 * Computes default "Add Character" + "Generate Headshot" state (both ON) prefilled
 * from search result metadata for new character LoRA downloads.
 */
export function deriveDefaultCharacterAutomation(
  item: Pick<ExternalModelSearchResult, 'name' | 'trainedWords'>
): CharacterDownloadAutomation {
  const triggerWord =
    item.trainedWords?.find((w) => w.trim().length > 0)?.trim() || '';
  return {
    addCharacter: true,
    generateHeadshot: true,
    characterName: (item.name || '').trim(),
    triggerWord,
  };
}

interface CharacterLoraDownloadOptionsProps {
  value: CharacterDownloadAutomation;
  onChange: (next: CharacterDownloadAutomation) => void;
  disabled?: boolean;
}

const SwitchToggle: React.FC<{
  checked: boolean;
  disabled?: boolean;
  onToggle: () => void;
  label: string;
  icon: React.ReactNode;
}> = ({ checked, disabled, onToggle, label, icon }) => (
  <button
    type="button"
    role="switch"
    aria-checked={checked}
    disabled={disabled}
    onClick={onToggle}
    className="inline-flex items-center gap-2 text-xs text-zinc-200 cursor-pointer disabled:opacity-50 select-none"
  >
    <span
      className={`relative inline-flex h-4 w-7 shrink-0 items-center rounded-full border transition-colors ${
        checked
          ? 'bg-indigo-600 border-indigo-500'
          : 'bg-zinc-800 border-zinc-700'
      }`}
    >
      <span
        className={`inline-block h-3 w-3 rounded-full bg-white transition-transform ${
          checked ? 'translate-x-3.5' : 'translate-x-0.5'
        }`}
      />
    </span>
    <span className="inline-flex items-center gap-1.5 font-medium">
      {icon}
      <span>{label}</span>
    </span>
  </button>
);

/**
 * Compact switches and prefilled Character Name / Trigger Word inputs rendered on
 * new Character LoRA downloads.
 */
export const CharacterLoraDownloadOptions: React.FC<
  CharacterLoraDownloadOptionsProps
> = ({ value, onChange, disabled = false }) => {
  const promptPreviewLead =
    value.triggerWord?.trim() || value.characterName.trim() || 'character';

  return (
    <div className="bg-zinc-950/60 border border-indigo-500/30 rounded-lg p-3 space-y-2.5 text-xs">
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
        <SwitchToggle
          checked={value.addCharacter}
          disabled={disabled}
          label="Add character"
          icon={<UserPlus className="w-3.5 h-3.5 text-indigo-400" />}
          onToggle={() => {
            const nextAdd = !value.addCharacter;
            onChange({
              ...value,
              addCharacter: nextAdd,
              generateHeadshot: nextAdd ? value.generateHeadshot : false,
            });
          }}
        />

        <SwitchToggle
          checked={value.generateHeadshot}
          disabled={disabled}
          label="Generate headshot"
          icon={<Camera className="w-3.5 h-3.5 text-indigo-400" />}
          onToggle={() => {
            const nextHeadshot = !value.generateHeadshot;
            onChange({
              ...value,
              addCharacter: nextHeadshot ? true : value.addCharacter,
              generateHeadshot: nextHeadshot,
            });
          }}
        />
      </div>

      {value.addCharacter && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1">
          <div>
            <label className="block text-[11px] text-zinc-400 mb-1">
              Character Name
            </label>
            <input
              type="text"
              disabled={disabled}
              value={value.characterName}
              onChange={(e) =>
                onChange({ ...value, characterName: e.target.value })
              }
              placeholder="e.g. Elena Vance"
              className="w-full px-2.5 py-1.5 bg-zinc-900 border border-zinc-800 rounded-md text-zinc-100 focus:outline-none focus:border-indigo-500 disabled:opacity-60"
            />
          </div>
          <div>
            <label className="block text-[11px] text-zinc-400 mb-1">
              Trigger Word
            </label>
            <input
              type="text"
              disabled={disabled}
              value={value.triggerWord || ''}
              onChange={(e) =>
                onChange({ ...value, triggerWord: e.target.value })
              }
              placeholder="Prefilled trigger word..."
              className="w-full px-2.5 py-1.5 font-mono bg-zinc-900 border border-zinc-800 rounded-md text-indigo-200 focus:outline-none focus:border-indigo-500 disabled:opacity-60"
            />
          </div>
          {value.generateHeadshot && (
            <p className="sm:col-span-2 text-[11px] text-zinc-400 leading-snug">
              Once copied to ComfyUI, submits{' '}
              <span className="font-mono text-zinc-300">
                &ldquo;{promptPreviewLead} headshot smiling on neutral
                background.&rdquo;
              </span>{' '}
              via the default workflow and sets it as the character&apos;s
              portrait.
            </p>
          )}
        </div>
      )}
    </div>
  );
};
