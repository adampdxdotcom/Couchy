import React, { useEffect, useRef, useState } from 'react';
import { Cpu, Layers, X } from 'lucide-react';
import {
  DEFAULT_PILL_TYPE_SETTINGS,
  PILL_COLOR_STYLES,
  type PillColorStyleSet,
} from '../../shared/pillSettings.ts';
import type {
  CharacterProfile,
  GenerationLoraSelection,
  ModelInventoryItem,
  PillTypeSettings,
} from '../../shared/types.ts';
import { CharacterPortraitImage } from '../character/CharacterPortraitImage.tsx';
import { getCleanLoraLabel, resolveBaseModelDisplayLabel } from './quickGenUtils.ts';

interface QuickGenAttachmentsBarProps {
  attachedCharacter: CharacterProfile | null;
  attachedCheckpoint?: string | null;
  attachedLoras: GenerationLoraSelection[];
  models?: ModelInventoryItem[];
  pillTypeSettings?: PillTypeSettings;
  onRemoveCharacter: () => void;
  onRemoveCheckpoint?: () => void;
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
 * Displays active attached character, base model, friend character, and LoRA pills
 * with inline strength editing and individual removal buttons.
 */
export const QuickGenAttachmentsBar: React.FC<QuickGenAttachmentsBarProps> = ({
  attachedCharacter,
  attachedCheckpoint,
  attachedLoras,
  models = [],
  pillTypeSettings = DEFAULT_PILL_TYPE_SETTINGS,
  onRemoveCharacter,
  onRemoveCheckpoint,
  onRemoveLora,
  onUpdateLoraStrength,
}) => {
  const charStyle = PILL_COLOR_STYLES[pillTypeSettings.character.color];
  const baseModelStyle = PILL_COLOR_STYLES[pillTypeSettings.baseModel.color];
  const loraStyle = PILL_COLOR_STYLES[pillTypeSettings.lora.color];
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

  if (!attachedCharacter && !attachedCheckpoint && visibleLoras.length === 0) return null;

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

  const renderStrengthControl = (
    lora: GenerationLoraSelection,
    label: string,
    styleSet: PillColorStyleSet
  ) => {
    const isEditing = editingLoraName === lora.loraName;

    if (isEditing) {
      return (
        <span
          className={`inline-flex items-center text-[11px] font-mono tabular-nums ${styleSet.textAccent}`}
        >
          <input
            ref={editInputRef}
            type="text"
            inputMode="decimal"
            aria-label={`Strength for ${label}`}
            value={draftValue}
            onChange={(e) => setDraftValue(e.target.value)}
            onBlur={() => commitEdit(lora)}
            onKeyDown={(e) => handleEditKeyDown(e, lora)}
            className={`w-9 rounded px-1 text-[11px] font-mono tabular-nums text-center focus:outline-none ring-1 ${styleSet.strengthInput}`}
          />
          <span>x</span>
        </span>
      );
    }

    return (
      <button
        type="button"
        onClick={() => startEditing(lora)}
        title={`Click to adjust ${label} strength for this generation (0.0–3.0)`}
        className={`text-[11px] font-mono tabular-nums ${styleSet.strengthText} ${
          onUpdateLoraStrength ? 'cursor-text transition-colors' : ''
        }`}
      >
        {formatStrengthDigits(lora.modelStrength)}x
      </button>
    );
  };

  return (
    <div className="mb-2 flex flex-wrap items-center gap-2">
      {attachedCharacter && (
        <div
          className={`inline-flex items-center gap-2 pl-1.5 pr-2.5 py-1 rounded-full border text-xs shadow-sm ${charStyle.pill}`}
        >
          <div className="w-5 h-5 rounded-full bg-zinc-800 overflow-hidden flex items-center justify-center shrink-0">
            <CharacterPortraitImage
              src={attachedCharacter.portraitThumbnailUrl}
              alt={attachedCharacter.name}
              crop={attachedCharacter.portraitCrop}
              iconClassName={`w-3 h-3 ${charStyle.icon}`}
            />
          </div>
          <span className="font-medium">{attachedCharacter.name}</span>
          {attachedCharacter.loras[0]?.triggerWord && (
            <span className={`text-[11px] font-mono ${charStyle.textAccent}`}>
              ({attachedCharacter.loras[0].triggerWord})
            </span>
          )}
          <button
            type="button"
            onClick={onRemoveCharacter}
            className={`${charStyle.removeButton} cursor-pointer ml-0.5`}
            title="Remove character"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {attachedCheckpoint && (
        <div
          className={`inline-flex items-center gap-1.5 pl-2 pr-2.5 py-1 rounded-full border text-xs shadow-sm max-w-full ${baseModelStyle.pill}`}
          title={`Base Model: ${attachedCheckpoint}`}
        >
          <Cpu className={`w-3.5 h-3.5 shrink-0 ${baseModelStyle.icon}`} />
          <span className={`font-medium truncate max-w-[180px] sm:max-w-[240px] ${baseModelStyle.textLight}`}>
            {resolveBaseModelDisplayLabel(attachedCheckpoint, models)}
          </span>
          {onRemoveCheckpoint && (
            <button
              type="button"
              onClick={onRemoveCheckpoint}
              className={`${baseModelStyle.removeButton} cursor-pointer ml-0.5 shrink-0`}
              title="Revert to default base model"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      )}

      {visibleLoras.map((lora) => {
        const label = getCleanLoraLabel(lora);
        if (lora.isCharacterPill) {
          return (
            <div
              key={lora.loraName}
              className={`inline-flex items-center gap-1.5 pl-1.5 pr-2.5 py-1 rounded-full border text-xs shadow-sm ${charStyle.pill}`}
            >
              <div className="w-5 h-5 rounded-full bg-zinc-800 overflow-hidden flex items-center justify-center shrink-0">
                <CharacterPortraitImage
                  src={lora.portraitThumbnailUrl || null}
                  alt={label}
                  crop={lora.portraitCrop}
                  iconClassName={`w-3 h-3 ${charStyle.icon}`}
                />
              </div>
              <span className="font-medium">{label}</span>
              {lora.triggerWord && (
                <span className={`text-[11px] font-mono ${charStyle.textAccent}`}>
                  ({lora.triggerWord})
                </span>
              )}
              {renderStrengthControl(lora, label, charStyle)}
              <button
                type="button"
                onClick={() => onRemoveLora(lora.loraName)}
                className={`${charStyle.removeButton} cursor-pointer ml-0.5`}
                title={`Remove ${label}`}
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          );
        }

        return (
          <div
            key={lora.loraName}
            className={`inline-flex items-center gap-1.5 pl-2 pr-2.5 py-1 rounded-full border text-xs shadow-sm ${loraStyle.pill}`}
          >
            <Layers className={`w-3.5 h-3.5 shrink-0 ${loraStyle.icon}`} />
            <span className={`font-medium ${loraStyle.textLight}`}>{label}</span>
            {renderStrengthControl(lora, label, loraStyle)}
            <button
              type="button"
              onClick={() => onRemoveLora(lora.loraName)}
              className={`${loraStyle.removeButton} cursor-pointer ml-0.5`}
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
