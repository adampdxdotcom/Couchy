import React, { useEffect, useRef, useState } from 'react';
import { Cpu, Layers, X } from 'lucide-react';
import {
  DEFAULT_PILL_TYPE_SETTINGS,
  PILL_COLOR_STYLES,
  resolveLoraCategoryStyle,
  type PillColorStyleSet,
} from '../../shared/pillSettings.ts';
import type {
  CharacterProfile,
  GenerationLoraSelection,
  LoraCategory,
  LoraExplorerItem,
  ModelInventoryItem,
  PillTypeSettings,
} from '../../shared/types.ts';
import { CharacterPortraitImage } from '../character/CharacterPortraitImage.tsx';
import {
  getCleanLoraLabel,
  normalizeLoraKey,
  resolveBaseModelDisplayLabel,
} from './quickGenUtils.ts';

interface QuickGenAttachmentsBarProps {
  attachedCharacter: CharacterProfile | null;
  characterStrength?: number;
  attachedCheckpoint?: string | null;
  attachedLoras: GenerationLoraSelection[];
  removedLoraKeys?: Set<string>;
  loras?: LoraExplorerItem[];
  models?: ModelInventoryItem[];
  pillTypeSettings?: PillTypeSettings;
  onRemoveCharacter: () => void;
  onRemoveCheckpoint?: () => void;
  onRemoveLora: (loraName: string) => void;
  onUpdateLoraStrength?: (loraName: string, nextStrength: number) => void;
  onUpdateCharacterStrength?: (nextStrength: number) => void;
}

const MIN_STRENGTH = 0.0;
const MAX_STRENGTH = 3.0;
const STEP_STRENGTH = 0.05;
const CHARACTER_EDIT_KEY = '__character__';

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
  characterStrength = 1.0,
  attachedCheckpoint,
  attachedLoras,
  removedLoraKeys,
  loras = [],
  models = [],
  pillTypeSettings = DEFAULT_PILL_TYPE_SETTINGS,
  onRemoveCharacter,
  onRemoveCheckpoint,
  onRemoveLora,
  onUpdateLoraStrength,
  onUpdateCharacterStrength,
}) => {
  const charStyle = PILL_COLOR_STYLES[pillTypeSettings.character.color];
  const baseModelStyle = PILL_COLOR_STYLES[pillTypeSettings.baseModel.color];
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [draftValue, setDraftValue] = useState('');
  const editInputRef = useRef<HTMLInputElement | null>(null);

  const visibleLoras = attachedLoras.filter((l) => l.showPill !== false);

  const resolveLoraCategory = (lora: GenerationLoraSelection): LoraCategory => {
    if (lora.isCharacterPill) return 'character';
    const key = normalizeLoraKey(lora.loraName);
    const match = loras.find(
      (l) => normalizeLoraKey(l.filename) === key || normalizeLoraKey(l.name) === key
    );
    if (match?.loraCategory) return match.loraCategory;
    if (match && match.characters.length > 0) return 'character';
    return 'unclassified';
  };

  const characterLoraItems: Array<{ lora: GenerationLoraSelection; category: LoraCategory }> = [];
  const otherLoraItems: Array<{ lora: GenerationLoraSelection; category: LoraCategory }> = [];
  for (const lora of visibleLoras) {
    const category = resolveLoraCategory(lora);
    if (lora.isCharacterPill || category === 'character') {
      characterLoraItems.push({ lora, category: 'character' });
    } else {
      otherLoraItems.push({ lora, category });
    }
  }
  const activeCharLoras = attachedCharacter
    ? attachedCharacter.loras.filter(
        (l) => !removedLoraKeys?.has(normalizeLoraKey(l.loraName))
      )
    : [];
  const hasActiveCharLora = activeCharLoras.length > 0;
  const primaryCharLoraKey = activeCharLoras[0]
    ? normalizeLoraKey(activeCharLoras[0].loraName)
    : null;
  const matchedCharAttached = primaryCharLoraKey
    ? attachedLoras.find((al) => normalizeLoraKey(al.loraName) === primaryCharLoraKey)
    : undefined;
  const resolvedCharacterStrength = matchedCharAttached
    ? matchedCharAttached.modelStrength
    : characterStrength;

  // Auto-focus and select digits when entering inline edit mode
  useEffect(() => {
    if (!editingKey) return;
    editInputRef.current?.focus();
    editInputRef.current?.select();
  }, [editingKey]);

  // Clear edit state if the active character or LoRA pill is removed externally
  useEffect(() => {
    if (!editingKey) return;
    if (editingKey === CHARACTER_EDIT_KEY) {
      if (!attachedCharacter || !hasActiveCharLora) {
        setEditingKey(null);
      }
      return;
    }
    if (!visibleLoras.some((l) => l.loraName === editingKey)) {
      setEditingKey(null);
    }
  }, [editingKey, attachedCharacter, hasActiveCharLora, visibleLoras]);

  if (!attachedCharacter && !attachedCheckpoint && visibleLoras.length === 0) return null;

  const startEditing = (
    editKey: string,
    currentStrength: number,
    onCommit?: (nextStrength: number) => void
  ) => {
    if (!onCommit) return;
    setEditingKey(editKey);
    setDraftValue(formatStrengthDigits(currentStrength));
  };

  const commitEdit = (onCommit?: (nextStrength: number) => void) => {
    const cleaned = draftValue.trim().replace(/x$/i, '');
    const parsed = Number(cleaned);
    if (cleaned !== '' && Number.isFinite(parsed) && onCommit) {
      onCommit(clampStrength(parsed));
    }
    setEditingKey(null);
  };

  const handleEditKeyDown = (
    e: React.KeyboardEvent<HTMLInputElement>,
    currentStrength: number,
    onCommit?: (nextStrength: number) => void
  ) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      commitEdit(onCommit);
      return;
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      setEditingKey(null);
      return;
    }
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault();
      const cleaned = draftValue.trim().replace(/x$/i, '');
      const base =
        cleaned !== '' && Number.isFinite(Number(cleaned)) ? Number(cleaned) : currentStrength;
      const delta = e.key === 'ArrowUp' ? STEP_STRENGTH : -STEP_STRENGTH;
      setDraftValue(formatStrengthDigits(clampStrength(base + delta)));
    }
  };

  const renderStrengthControl = (
    editKey: string,
    currentStrength: number,
    label: string,
    styleSet: PillColorStyleSet,
    onCommit?: (nextStrength: number) => void
  ) => {
    const isEditing = editingKey === editKey;

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
            onBlur={() => commitEdit(onCommit)}
            onKeyDown={(e) => handleEditKeyDown(e, currentStrength, onCommit)}
            className={`w-9 rounded px-1 text-[11px] font-mono tabular-nums text-center focus:outline-none ring-1 ${styleSet.strengthInput}`}
          />
          <span>x</span>
        </span>
      );
    }

    return (
      <button
        type="button"
        onClick={() => startEditing(editKey, currentStrength, onCommit)}
        title={`Click to adjust ${label} strength for this generation (0.0–3.0)`}
        className={`text-[11px] font-mono tabular-nums ${styleSet.strengthText} ${
          onCommit ? 'cursor-text transition-colors' : ''
        }`}
      >
        {formatStrengthDigits(currentStrength)}x
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
          {hasActiveCharLora &&
            renderStrengthControl(
              CHARACTER_EDIT_KEY,
              resolvedCharacterStrength,
              attachedCharacter.name,
              charStyle,
              onUpdateCharacterStrength
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

      {/* Additional Character LoRAs (Friends + character-categorized LoRAs grouped next to main character) */}
      {characterLoraItems.map(({ lora, category }) => {
        const label = getCleanLoraLabel(lora);
        const pillStyle = resolveLoraCategoryStyle(category, pillTypeSettings);

        if (lora.isCharacterPill) {
          return (
            <div
              key={lora.loraName}
              className={`inline-flex items-center gap-1.5 pl-1.5 pr-2.5 py-1 rounded-full border text-xs shadow-sm ${pillStyle.pill}`}
            >
              <div className="w-5 h-5 rounded-full bg-zinc-800 overflow-hidden flex items-center justify-center shrink-0">
                <CharacterPortraitImage
                  src={lora.portraitThumbnailUrl || null}
                  alt={label}
                  crop={lora.portraitCrop}
                  iconClassName={`w-3 h-3 ${pillStyle.icon}`}
                />
              </div>
              <span className="font-medium">{label}</span>
              {lora.triggerWord && (
                <span className={`text-[11px] font-mono ${pillStyle.textAccent}`}>
                  ({lora.triggerWord})
                </span>
              )}
              {renderStrengthControl(
                lora.loraName,
                lora.modelStrength,
                label,
                pillStyle,
                onUpdateLoraStrength
                  ? (nextStrength) => onUpdateLoraStrength(lora.loraName, nextStrength)
                  : undefined
              )}
              <button
                type="button"
                onClick={() => onRemoveLora(lora.loraName)}
                className={`${pillStyle.removeButton} cursor-pointer ml-0.5`}
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
            className={`inline-flex items-center gap-1.5 pl-2 pr-2.5 py-1 rounded-full border text-xs shadow-sm ${pillStyle.pill}`}
          >
            <Layers className={`w-3.5 h-3.5 shrink-0 ${pillStyle.icon}`} />
            <span className={`font-medium ${pillStyle.textLight}`}>{label}</span>
            {renderStrengthControl(
              lora.loraName,
              lora.modelStrength,
              label,
              pillStyle,
              onUpdateLoraStrength
                ? (nextStrength) => onUpdateLoraStrength(lora.loraName, nextStrength)
                : undefined
            )}
            <button
              type="button"
              onClick={() => onRemoveLora(lora.loraName)}
              className={`${pillStyle.removeButton} cursor-pointer ml-0.5`}
              title={`Remove ${label}`}
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        );
      })}

      {/* Base Model Pill */}
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

      {/* Non-Character LoRA Pills (styled per category) */}
      {otherLoraItems.map(({ lora, category }) => {
        const label = getCleanLoraLabel(lora);
        const pillStyle = resolveLoraCategoryStyle(category, pillTypeSettings);

        return (
          <div
            key={lora.loraName}
            className={`inline-flex items-center gap-1.5 pl-2 pr-2.5 py-1 rounded-full border text-xs shadow-sm ${pillStyle.pill}`}
          >
            <Layers className={`w-3.5 h-3.5 shrink-0 ${pillStyle.icon}`} />
            <span className={`font-medium ${pillStyle.textLight}`}>{label}</span>
            {renderStrengthControl(
              lora.loraName,
              lora.modelStrength,
              label,
              pillStyle,
              onUpdateLoraStrength
                ? (nextStrength) => onUpdateLoraStrength(lora.loraName, nextStrength)
                : undefined
            )}
            <button
              type="button"
              onClick={() => onRemoveLora(lora.loraName)}
              className={`${pillStyle.removeButton} cursor-pointer ml-0.5`}
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
