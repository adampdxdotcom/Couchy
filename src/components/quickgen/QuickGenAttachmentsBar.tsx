import React, { useEffect, useRef, useState } from 'react';
import { Layers, X } from 'lucide-react';
import type { CharacterProfile, GenerationLoraSelection } from '../../shared/types.ts';
import { CharacterPortraitImage } from '../character/CharacterPortraitImage.tsx';
import { getCleanLoraLabel } from './quickGenUtils.ts';

interface QuickGenAttachmentsBarProps {
  attachedCharacter: CharacterProfile | null;
  attachedLoras: GenerationLoraSelection[];
  onRemoveCharacter: () => void;
  onRemoveLora: (loraName: string) => void;
  onUpdateLoraStrength?: (loraName: string, nextStrength: number) => void;
}

const MIN_STRENGTH = 0.0;
const MAX_STRENGTH = 3.0;
const STEP_STRENGTH = 0.05;

function clampStrength(value: number): number {
  return Math.max(MIN_STRENGTH, Math.min(MAX_STRENGTH, Math.round(value * 100) / 100));
}

function formatStrengthDigits(value: number): string {
  const rounded = Math.round(value * 100) / 100;
  return Math.round(rounded * 100) % 10 !== 0 ? rounded.toFixed(2) : rounded.toFixed(1);
}

/**
 * Displays active attached character and @mentioned LoRA pills with inline strength editing and removal buttons.
 */
export const QuickGenAttachmentsBar: React.FC<QuickGenAttachmentsBarProps> = ({
  attachedCharacter,
  attachedLoras,
  onRemoveCharacter,
  onRemoveLora,
  onUpdateLoraStrength,
}) => {
  const [editingLoraName, setEditingLoraName] = useState<string | null>(null);
  const [draftValue, setDraftValue] = useState('');
  const editInputRef = useRef<HTMLInputElement | null>(null);

  const visibleLoras = attachedLoras.filter((l) => l.showPill !== false);

  // Auto-focus and select digits when entering inline edit mode
  useEffect(() => {
    if (!editingLoraName) return;
    editInputRef.current?.focus();
    editInputRef.current?.select();
  }, [editingLoraName]);

  // Clear edit state if the active LoRA pill is removed externally
  useEffect(() => {
    if (editingLoraName && !visibleLoras.some((l) => l.loraName === editingLoraName)) {
      setEditingLoraName(null);
    }
  }, [editingLoraName, visibleLoras]);

  if (!attachedCharacter && visibleLoras.length === 0) return null;

  const startEditing = (lora: GenerationLoraSelection) => {
    if (!onUpdateLoraStrength) return;
    setEditingLoraName(lora.loraName);
    setDraftValue(formatStrengthDigits(lora.modelStrength));
  };

  const commitEdit = (lora: GenerationLoraSelection) => {
    const cleaned = draftValue.trim().replace(/x$/i, '');
    const parsed = Number(cleaned);
    if (cleaned !== '' && Number.isFinite(parsed) && onUpdateLoraStrength) {
      onUpdateLoraStrength(lora.loraName, clampStrength(parsed));
    }
    setEditingLoraName(null);
  };

  const handleEditKeyDown = (
    e: React.KeyboardEvent<HTMLInputElement>,
    lora: GenerationLoraSelection
  ) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      commitEdit(lora);
      return;
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      setEditingLoraName(null);
      return;
    }
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault();
      const cleaned = draftValue.trim().replace(/x$/i, '');
      const base =
        cleaned !== '' && Number.isFinite(Number(cleaned)) ? Number(cleaned) : lora.modelStrength;
      const delta = e.key === 'ArrowUp' ? STEP_STRENGTH : -STEP_STRENGTH;
      setDraftValue(formatStrengthDigits(clampStrength(base + delta)));
    }
  };

  return (
    <div className="mb-2 flex flex-wrap items-center gap-2">
      {attachedCharacter && (
        <div className="inline-flex items-center gap-2 pl-1.5 pr-2.5 py-1 rounded-full bg-indigo-950/70 border border-indigo-500/40 text-xs text-indigo-200 shadow-sm">
          <div className="w-5 h-5 rounded-full bg-zinc-800 overflow-hidden flex items-center justify-center shrink-0">
            <CharacterPortraitImage
              src={attachedCharacter.portraitThumbnailUrl}
              alt={attachedCharacter.name}
              crop={attachedCharacter.portraitCrop}
              iconClassName="w-3 h-3 text-indigo-300"
            />
          </div>
          <span className="font-medium">{attachedCharacter.name}</span>
          {attachedCharacter.loras[0]?.triggerWord && (
            <span className="text-[11px] font-mono text-indigo-300/90">
              ({attachedCharacter.loras[0].triggerWord})
            </span>
          )}
          <button
            type="button"
            onClick={onRemoveCharacter}
            className="text-indigo-300/70 hover:text-white cursor-pointer ml-0.5"
            title="Remove character"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {visibleLoras.map((lora) => {
        const label = getCleanLoraLabel(lora);
        const isEditing = editingLoraName === lora.loraName;
        return (
          <div
            key={lora.loraName}
            className="inline-flex items-center gap-1.5 pl-2 pr-2.5 py-1 rounded-full bg-amber-950/60 border border-amber-500/40 text-xs text-amber-200 shadow-sm"
          >
            <Layers className="w-3.5 h-3.5 text-amber-400 shrink-0" />
            <span className="font-medium text-amber-100">{label}</span>
            {isEditing ? (
              <span className="inline-flex items-center text-[11px] font-mono text-amber-300/90 tabular-nums">
                <input
                  ref={editInputRef}
                  type="text"
                  inputMode="decimal"
                  aria-label={`Strength for ${label}`}
                  value={draftValue}
                  onChange={(e) => setDraftValue(e.target.value)}
                  onBlur={() => commitEdit(lora)}
                  onKeyDown={(e) => handleEditKeyDown(e, lora)}
                  className="w-9 bg-amber-900/50 rounded px-1 text-[11px] font-mono text-amber-100 tabular-nums text-center focus:outline-none ring-1 ring-amber-400/60"
                />
                <span>x</span>
              </span>
            ) : (
              <button
                type="button"
                onClick={() => startEditing(lora)}
                title={`Click to adjust ${label} strength for this generation (0.0–3.0)`}
                className={`text-[11px] font-mono text-amber-300/90 tabular-nums ${
                  onUpdateLoraStrength
                    ? 'hover:text-amber-100 cursor-text transition-colors'
                    : ''
                }`}
              >
                {formatStrengthDigits(lora.modelStrength)}x
              </button>
            )}
            <button
              type="button"
              onClick={() => onRemoveLora(lora.loraName)}
              className="text-amber-300/70 hover:text-white cursor-pointer ml-0.5"
              title={`Remove ${label}`}
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        );
      })}
    </div>
  );
};
