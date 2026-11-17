import React, { useState } from 'react';
import { Bookmark, Check, Cpu, Layers, Minus, Plus, Trash2, X } from 'lucide-react';
import {
  PRESET_PILL_COLOR_OPTIONS,
  PRESET_PILL_COLOR_STYLES,
  resolvePresetPillStyle,
} from '../../shared/pillSettings.ts';
import type {
  LoraExplorerItem,
  ModelInventoryItem,
  PresetPillColorKey,
} from '../../shared/types.ts';
import {
  MAX_SYSTEM_LORAS,
  getCleanLoraLabel,
  getCleanModelMentionLabel,
  normalizeLoraKey,
} from '../quickgen/quickGenUtils.ts';

export interface PresetDraftItem {
  loraName: string;
  modelStrength: number;
  clipStrength: number;
}

export interface PresetEditorDraft {
  id: number | null;
  name: string;
  nickname: string;
  userDescription: string;
  agentDescription: string;
  pillColor: PresetPillColorKey;
  checkpointName: string | null;
  items: PresetDraftItem[];
}

interface PresetEditorPanelProps {
  draft: PresetEditorDraft;
  loras: LoraExplorerItem[];
  models: ModelInventoryItem[];
  systemDefaultCheckpointLabel?: string | null;
  isSaving: boolean;
  onChangeDraft: (updater: (prev: PresetEditorDraft) => PresetEditorDraft) => void;
  onClearCheckpoint: () => void;
  onRemoveLora: (loraName: string) => void;
  onChangeLoraStrength: (loraName: string, nextStrength: number) => void;
  onSave: () => void;
  onCancel: () => void;
  onDelete?: () => void;
}

function clampStrength(value: number): number {
  return Math.max(-10.0, Math.min(10.0, Math.round(value * 100) / 100));
}

/**
 * Top editor + 1 Base Model / 5 LoRA preview slot strip for creating or editing a LoRA Preset.
 */
export const PresetEditorPanel: React.FC<PresetEditorPanelProps> = ({
  draft,
  loras,
  models,
  systemDefaultCheckpointLabel,
  isSaving,
  onChangeDraft,
  onClearCheckpoint,
  onRemoveLora,
  onChangeLoraStrength,
  onSave,
  onCancel,
  onDelete,
}) => {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const activeStyle = resolvePresetPillStyle(draft.pillColor);

  const selectedModel = draft.checkpointName
    ? models.find(
        (m) =>
          m.modelType !== 'lora' &&
          normalizeLoraKey(m.filename) === normalizeLoraKey(draft.checkpointName!)
      )
    : null;
  const checkpointLabel = draft.checkpointName
    ? selectedModel
      ? getCleanModelMentionLabel(selectedModel)
      : draft.checkpointName.replace(/\.(safetensors|pt|ckpt|gguf|sft)$/i, '')
    : null;

  const pillPreviewLabel =
    draft.nickname.trim().replace(/^@+/, '') || draft.name.trim() || 'Preset';

  const loraSlots = Array.from({ length: MAX_SYSTEM_LORAS }, (_, idx) => draft.items[idx] || null);

  return (
    <div className="bg-zinc-900/95 border border-zinc-800 rounded-2xl p-4 sm:p-5 space-y-4 shadow-xl">
      {/* Header + Live Pill Preview */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-zinc-100">
            {draft.id ? `Edit Preset · ${draft.name || 'Untitled'}` : 'Create New LoRA Preset'}
          </h3>
          <p className="text-xs text-zinc-400 mt-0.5">
            Click any Base Model or LoRA card below to add or remove it (1 Base Model + up to{' '}
            {MAX_SYSTEM_LORAS} LoRAs). Adjust preset default strengths inside the preview slots.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <span className="text-[11px] text-zinc-500">Pill preview:</span>
          <span
            className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-xs font-medium ${activeStyle.pill}`}
          >
            <Bookmark className={`w-3.5 h-3.5 ${activeStyle.icon}`} />
            <span className={activeStyle.textLight}>{pillPreviewLabel}</span>
          </span>
        </div>
      </div>

      {/* Preview Slots Row: 1 Base Model + 5 LoRAs */}
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-2.5">
        {/* Base Model Slot */}
        <div
          className={`relative rounded-xl border p-2.5 min-h-[82px] flex flex-col justify-between transition-colors ${
            checkpointLabel
              ? 'bg-emerald-950/35 border-emerald-500/50 text-emerald-100'
              : 'bg-zinc-950/60 border-dashed border-zinc-800 text-zinc-400'
          }`}
        >
          <div className="flex items-center justify-between gap-1">
            <span className="inline-flex items-center gap-1 text-[10px] font-mono uppercase tracking-wider text-emerald-400">
              <Cpu className="w-3 h-3" />
              Base Model
            </span>
            {checkpointLabel && (
              <button
                type="button"
                onClick={onClearCheckpoint}
                className="p-0.5 rounded text-emerald-300/80 hover:text-white hover:bg-emerald-900/60 cursor-pointer"
                title="Use System Workflow Default"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          {checkpointLabel ? (
            <div className="mt-1">
              <div className="text-xs font-medium text-emerald-100 truncate" title={draft.checkpointName || ''}>
                {checkpointLabel}
              </div>
              <div className="text-[10px] font-mono text-emerald-300/70 truncate">
                {draft.checkpointName}
              </div>
            </div>
          ) : (
            <div className="mt-1">
              <div className="text-xs font-medium text-zinc-300">System Workflow Default</div>
              <div className="text-[10px] text-zinc-500 truncate">
                {systemDefaultCheckpointLabel || 'Uses active workflow model'}
              </div>
            </div>
          )}
        </div>

        {/* 5 LoRA Slots */}
        {loraSlots.map((slot, idx) => {
          if (!slot) {
            return (
              <div
                key={`empty-slot-${idx}`}
                className="rounded-xl border border-dashed border-zinc-800 bg-zinc-950/40 p-2.5 min-h-[82px] flex flex-col justify-between text-zinc-600"
              >
                <span className="inline-flex items-center gap-1 text-[10px] font-mono uppercase tracking-wider">
                  <Layers className="w-3 h-3" />
                  LoRA {idx + 1}
                </span>
                <span className="text-[11px] text-zinc-600">Empty slot</span>
              </div>
            );
          }

          const matchedLora = loras.find(
            (l) => normalizeLoraKey(l.filename) === normalizeLoraKey(slot.loraName)
          );
          const displayLabel = getCleanLoraLabel(matchedLora || { loraName: slot.loraName });

          return (
            <div
              key={slot.loraName}
              className="relative rounded-xl border border-fuchsia-500/45 bg-zinc-950/90 p-2.5 min-h-[82px] flex flex-col justify-between gap-1.5"
            >
              <div className="flex items-start justify-between gap-1">
                <div className="min-w-0">
                  <div className="text-[10px] font-mono uppercase tracking-wider text-zinc-400 flex items-center gap-1">
                    <Layers className="w-3 h-3 text-fuchsia-400 shrink-0" />
                    <span>LoRA {idx + 1}</span>
                  </div>
                  <div className="text-xs font-medium text-zinc-100 truncate mt-0.5" title={slot.loraName}>
                    {displayLabel}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => onRemoveLora(slot.loraName)}
                  className="p-0.5 rounded text-zinc-400 hover:text-white hover:bg-zinc-800 cursor-pointer shrink-0"
                  title={`Remove ${displayLabel}`}
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>

              {/* Preset Default Strength Control */}
              <div className="flex items-center justify-between gap-1 pt-0.5">
                <span className="text-[10px] text-zinc-500">Default</span>
                <div className="inline-flex items-center rounded-md border border-zinc-800 bg-zinc-900">
                  <button
                    type="button"
                    onClick={() =>
                      onChangeLoraStrength(slot.loraName, clampStrength(slot.modelStrength - 0.05))
                    }
                    className="px-1 py-0.5 text-zinc-400 hover:text-zinc-100 cursor-pointer"
                    title="Decrease strength by 0.05"
                  >
                    <Minus className="w-3 h-3" />
                  </button>
                  <input
                    type="number"
                    step="0.05"
                    min="-10"
                    max="10"
                    value={slot.modelStrength}
                    onChange={(e) => {
                      const v = Number(e.target.value);
                      if (Number.isFinite(v)) {
                        onChangeLoraStrength(slot.loraName, clampStrength(v));
                      }
                    }}
                    aria-label={`Default strength for ${displayLabel}`}
                    className="w-12 bg-transparent text-center text-[11px] font-mono tabular-nums text-zinc-100 focus:outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                  />
                  <button
                    type="button"
                    onClick={() =>
                      onChangeLoraStrength(slot.loraName, clampStrength(slot.modelStrength + 0.05))
                    }
                    className="px-1 py-0.5 text-zinc-400 hover:text-zinc-100 cursor-pointer"
                    title="Increase strength by 0.05"
                  >
                    <Plus className="w-3 h-3" />
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Metadata Fields */}
      <div className="grid grid-cols-1 md:grid-cols-12 gap-3">
        <div className="md:col-span-4 space-y-1">
          <label className="block text-[11px] font-medium text-zinc-300">
            Preset Name <span className="text-rose-400">*</span>
          </label>
          <input
            type="text"
            value={draft.name}
            onChange={(e) =>
              onChangeDraft((prev) => ({ ...prev, name: e.target.value }))
            }
            placeholder="e.g. Moody Cinematic Film"
            className="w-full px-3 py-1.5 bg-zinc-950 border border-zinc-800 focus:border-fuchsia-500 rounded-lg text-xs text-zinc-100 placeholder-zinc-600 focus:outline-none"
          />
        </div>

        <div className="md:col-span-3 space-y-1">
          <label className="block text-[11px] font-medium text-zinc-300">Pill Nickname</label>
          <div className="relative">
            <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-500 font-mono text-xs">
              @
            </span>
            <input
              type="text"
              value={draft.nickname}
              onChange={(e) =>
                onChangeDraft((prev) => ({
                  ...prev,
                  nickname: e.target.value.replace(/^@+/, '').replace(/\s+/g, '-').toLowerCase(),
                }))
              }
              placeholder="cinematic"
              className="w-full pl-6 pr-2.5 py-1.5 bg-zinc-950 border border-zinc-800 focus:border-fuchsia-500 rounded-lg text-xs font-mono text-zinc-100 placeholder-zinc-600 focus:outline-none"
            />
          </div>
        </div>

        <div className="md:col-span-5 space-y-1">
          <label className="block text-[11px] font-medium text-zinc-300">
            Custom Pill Color <span className="text-zinc-500">(distinct from LoRA/Model colors)</span>
          </label>
          <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
            {PRESET_PILL_COLOR_OPTIONS.map((colorKey) => {
              const style = PRESET_PILL_COLOR_STYLES[colorKey];
              const isSelected = draft.pillColor === colorKey;
              return (
                <button
                  key={colorKey}
                  type="button"
                  onClick={() => onChangeDraft((prev) => ({ ...prev, pillColor: colorKey }))}
                  className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-[11px] font-medium transition-colors cursor-pointer ${
                    isSelected
                      ? style.pillSelected
                      : 'bg-zinc-950 border-zinc-800 text-zinc-400 hover:border-zinc-700 hover:text-zinc-200'
                  }`}
                >
                  <span className={`w-2.5 h-2.5 rounded-full ${style.swatchBg}`} />
                  <span>{style.label}</span>
                  {isSelected && <Check className={`w-3 h-3 ${style.checkIcon}`} />}
                </button>
              );
            })}
          </div>
        </div>

        <div className="md:col-span-6 space-y-1">
          <label className="block text-[11px] font-medium text-zinc-300">User Description</label>
          <textarea
            rows={2}
            value={draft.userDescription}
            onChange={(e) =>
              onChangeDraft((prev) => ({ ...prev, userDescription: e.target.value }))
            }
            placeholder="Short personal note about what this preset is for..."
            className="w-full px-3 py-1.5 bg-zinc-950 border border-zinc-800 focus:border-fuchsia-500 rounded-lg text-xs text-zinc-100 placeholder-zinc-600 focus:outline-none resize-none"
          />
        </div>

        <div className="md:col-span-6 space-y-1">
          <label className="block text-[11px] font-medium text-zinc-300">
            Agent Description <span className="text-zinc-500">(visible to Quick Gen Agent)</span>
          </label>
          <textarea
            rows={2}
            value={draft.agentDescription}
            onChange={(e) =>
              onChangeDraft((prev) => ({ ...prev, agentDescription: e.target.value }))
            }
            placeholder="Describe when the Local LLM Agent should recommend this preset..."
            className="w-full px-3 py-1.5 bg-zinc-950 border border-zinc-800 focus:border-fuchsia-500 rounded-lg text-xs text-zinc-100 placeholder-zinc-600 focus:outline-none resize-none"
          />
        </div>
      </div>

      {/* Footer Actions */}
      <div className="flex flex-wrap items-center justify-between gap-2 pt-1 border-t border-zinc-800/80">
        <div>
          {draft.id && onDelete && (
            confirmDelete ? (
              <div className="inline-flex items-center gap-2">
                <button
                  type="button"
                  disabled={isSaving}
                  onClick={onDelete}
                  className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-500 text-white text-xs font-medium cursor-pointer disabled:opacity-50"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  Confirm Delete
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmDelete(false)}
                  className="px-2.5 py-1.5 rounded-lg bg-zinc-800 text-zinc-300 hover:text-white text-xs cursor-pointer"
                >
                  Keep
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setConfirmDelete(true)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-zinc-950 border border-zinc-800 hover:border-rose-500/50 text-zinc-400 hover:text-rose-300 text-xs font-medium cursor-pointer"
              >
                <Trash2 className="w-3.5 h-3.5" />
                Delete Preset
              </button>
            )
          )}
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            disabled={isSaving}
            onClick={onCancel}
            className="px-3.5 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-xs font-medium cursor-pointer disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={isSaving}
            onClick={onSave}
            className="px-4 py-1.5 rounded-lg bg-fuchsia-600 hover:bg-fuchsia-500 disabled:opacity-50 text-white text-xs font-semibold cursor-pointer shadow-sm"
          >
            {isSaving ? 'Saving...' : draft.id ? 'Save Changes' : 'Save Preset'}
          </button>
        </div>
      </div>
    </div>
  );
};
