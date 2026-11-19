import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Check, Copy, Layers, Plus, RotateCcw, Search, Sparkles, X } from 'lucide-react';
import {
  DEFAULT_PILL_TYPE_SETTINGS,
  resolveLoraCategoryStyle,
  type PillColorStyleSet,
} from '../../shared/pillSettings.ts';
import type {
  ImageLoraRecord,
  ImageRecord,
  LoraCategory,
  LoraExplorerItem,
  PillTypeSettings,
} from '../../shared/types.ts';
import { copyTextToClipboard, getModelAvailabilityInfo } from '../../shared/utils.ts';
import { getCleanLoraLabel, MAX_SYSTEM_LORAS, normalizeLoraKey } from '../quickgen/quickGenUtils.ts';

const MIN_STRENGTH = -10.0;
const MAX_STRENGTH = 10.0;
const STEP_STRENGTH = 0.05;

function clampStrength(value: number): number {
  return Math.max(MIN_STRENGTH, Math.min(MAX_STRENGTH, Math.round(value * 100) / 100));
}

function formatLoraStrength(value: number): string {
  const rounded = Math.round(Number(value ?? 1) * 100) / 100;
  return Math.round(rounded * 100) % 10 !== 0 ? rounded.toFixed(2) : rounded.toFixed(1);
}

function resolveInspectorLoraMeta(
  lora: ImageLoraRecord,
  explorerLoras: LoraExplorerItem[]
): { displayName: string; pillLabel: string; category: LoraCategory } {
  const key = normalizeLoraKey(lora.loraName || '');
  const match = key
    ? explorerLoras.find(
        (l) => normalizeLoraKey(l.filename) === key || normalizeLoraKey(l.name) === key
      )
    : undefined;

  const cleanStem = (lora.loraName || '')
    .trim()
    .replace(/^.*[\\/]/, '')
    .replace(/\.(safetensors|pt|ckpt|bin)$/i, '');
  const displayName = match?.name?.trim() || cleanStem || 'LoRA';
  const nick = (match?.nickname || '').trim().replace(/^@+/, '');
  const pillLabel = nick || displayName;
  const category: LoraCategory =
    match?.loraCategory ||
    lora.loraCategory ||
    (match && match.characters.length > 0 ? 'character' : 'unclassified');

  return { displayName, pillLabel, category };
}

function areLorasModified(current: ImageLoraRecord[], original: ImageLoraRecord[]): boolean {
  if (current.length !== original.length) return true;
  for (let i = 0; i < current.length; i += 1) {
    const a = current[i];
    const b = original[i];
    if (normalizeLoraKey(a.loraName) !== normalizeLoraKey(b.loraName)) return true;
    if (Math.round(Number(a.modelStrength ?? 1) * 100) !== Math.round(Number(b.modelStrength ?? 1) * 100)) {
      return true;
    }
  }
  return false;
}

interface InspectorPositivePromptSectionProps {
  activeImage: ImageRecord;
  editablePositivePrompt: string;
  editableLoras?: ImageLoraRecord[];
  onChangeEditablePositivePrompt: (value: string) => void;
  onReusePrompt?: (image: ImageRecord) => void;
}

/**
 * Editable positive prompt box positioned directly below the Assigned Character section.
 */
export const InspectorPositivePromptSection: React.FC<
  InspectorPositivePromptSectionProps
> = ({
  activeImage,
  editablePositivePrompt,
  editableLoras,
  onChangeEditablePositivePrompt,
  onReusePrompt,
}) => {
  const [copied, setCopied] = useState(false);
  const copyTimerRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (copyTimerRef.current !== null) window.clearTimeout(copyTimerRef.current);
    };
  }, []);

  const copyPrompt = async () => {
    const ok = await copyTextToClipboard(editablePositivePrompt);
    if (!ok) return;
    if (copyTimerRef.current !== null) window.clearTimeout(copyTimerRef.current);
    setCopied(true);
    copyTimerRef.current = window.setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <label
          htmlFor="inspector-positive-prompt"
          className="font-display font-semibold text-zinc-200 uppercase tracking-wider"
        >
          Positive Prompt
        </label>
        <div className="flex items-center gap-2">
          {activeImage.provenance.positivePrompt && (
            <span className="text-[11px] text-zinc-400">
              Source: {activeImage.provenance.positivePrompt}
            </span>
          )}
          {editablePositivePrompt.trim().length > 0 && (
            <button
              type="button"
              onClick={() => void copyPrompt()}
              className="inline-flex items-center gap-1 text-indigo-400 hover:text-indigo-300 cursor-pointer"
            >
              {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
              <span>{copied ? 'Copied' : 'Copy'}</span>
            </button>
          )}
          {onReusePrompt && (
            <button
              type="button"
              onClick={() =>
                onReusePrompt({
                  ...activeImage,
                  positivePrompt: editablePositivePrompt,
                  loras: editableLoras ?? activeImage.loras,
                })
              }
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-indigo-500/15 hover:bg-indigo-500/25 border border-indigo-500/40 text-indigo-300 hover:text-indigo-200 font-medium cursor-pointer transition-colors"
              title="Load into Quick Gen Box to add to this image's stack (or start a new stack)"
            >
              <Sparkles className="w-3 h-3" />
              <span>Quick Gen</span>
            </button>
          )}
        </div>
      </div>
      <textarea
        id="inspector-positive-prompt"
        rows={7}
        value={editablePositivePrompt}
        onChange={(e) => onChangeEditablePositivePrompt(e.target.value)}
        placeholder="Edit positive prompt to send with Run Workflow..."
        className="w-full bg-zinc-950 border border-zinc-800 focus:border-indigo-500 focus:outline-none rounded-lg p-3 text-zinc-200 leading-relaxed resize-y"
      />
    </div>
  );
};

interface InspectorPromptAndParamsSectionProps {
  activeImage: ImageRecord;
  editableLoras: ImageLoraRecord[];
  onChangeEditableLoras: React.Dispatch<React.SetStateAction<ImageLoraRecord[]>>;
  loras?: LoraExplorerItem[];
  pillTypeSettings?: PillTypeSettings;
  onFilterByLora: (loraFilename: string) => void;
  onClose: () => void;
}

/**
 * Extracted generation parameters and editable LoRA chain applied when Run Workflow is submitted.
 */
export const InspectorPromptAndParamsSection: React.FC<
  InspectorPromptAndParamsSectionProps
> = ({
  activeImage,
  editableLoras,
  onChangeEditableLoras,
  loras = [],
  pillTypeSettings = DEFAULT_PILL_TYPE_SETTINGS,
  onFilterByLora,
  onClose,
}) => {
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [draftValue, setDraftValue] = useState('');
  const editInputRef = useRef<HTMLInputElement | null>(null);

  const [showAddPicker, setShowAddPicker] = useState(false);
  const [addSearchQuery, setAddSearchQuery] = useState('');
  const addSearchInputRef = useRef<HTMLInputElement | null>(null);
  const addPickerContainerRef = useRef<HTMLDivElement | null>(null);

  // Auto-focus inline weight input when clicked
  useEffect(() => {
    if (!editingKey) return;
    editInputRef.current?.focus();
    editInputRef.current?.select();
  }, [editingKey]);

  // Clear editing state if that LoRA is removed or active image switches
  useEffect(() => {
    if (!editingKey) return;
    if (!editableLoras.some((l) => normalizeLoraKey(l.loraName) === editingKey)) {
      setEditingKey(null);
    }
  }, [editingKey, editableLoras]);

  useEffect(() => {
    setEditingKey(null);
    setShowAddPicker(false);
    setAddSearchQuery('');
  }, [activeImage.id]);

  // Focus search input when opening the "+ Add LoRA" dropdown
  useEffect(() => {
    if (!showAddPicker) return;
    addSearchInputRef.current?.focus();
  }, [showAddPicker]);

  // Close "+ Add LoRA" dropdown on outside click
  useEffect(() => {
    if (!showAddPicker) return;
    const handleOutsideClick = (e: MouseEvent) => {
      if (
        addPickerContainerRef.current &&
        !addPickerContainerRef.current.contains(e.target as Node)
      ) {
        setShowAddPicker(false);
      }
    };
    document.addEventListener('mousedown', handleOutsideClick);
    return () => document.removeEventListener('mousedown', handleOutsideClick);
  }, [showAddPicker]);

  const activeLoraKeySet = useMemo(
    () => new Set(editableLoras.map((l) => normalizeLoraKey(l.loraName))),
    [editableLoras]
  );

  const availableAddLoras = useMemo(() => {
    const q = addSearchQuery.trim().toLowerCase();
    return loras
      .filter((l) => l.isInstalled && !l.isHidden && !activeLoraKeySet.has(normalizeLoraKey(l.filename)))
      .filter((l) => {
        if (!q) return true;
        const nick = (l.nickname || '').toLowerCase();
        const name = (l.name || '').toLowerCase();
        const file = (l.filename || '').toLowerCase();
        const trig = (l.triggerWord || '').toLowerCase();
        return nick.includes(q) || name.includes(q) || file.includes(q) || trig.includes(q);
      })
      .slice(0, 40);
  }, [loras, activeLoraKeySet, addSearchQuery]);

  const isModified = useMemo(
    () => areLorasModified(editableLoras, activeImage.loras || []),
    [editableLoras, activeImage.loras]
  );

  const startEditingStrength = (loraKey: string, currentStrength: number) => {
    setEditingKey(loraKey);
    setDraftValue(formatLoraStrength(currentStrength));
  };

  const commitStrengthEdit = (loraKey: string) => {
    const cleaned = draftValue.trim().replace(/x$/i, '');
    const parsed = Number(cleaned);
    if (cleaned !== '' && Number.isFinite(parsed)) {
      const nextStrength = clampStrength(parsed);
      onChangeEditableLoras((prev) =>
        prev.map((item) =>
          normalizeLoraKey(item.loraName) === loraKey
            ? { ...item, modelStrength: nextStrength, clipStrength: nextStrength }
            : item
        )
      );
    }
    setEditingKey(null);
  };

  const handleStrengthKeyDown = (
    e: React.KeyboardEvent<HTMLInputElement>,
    loraKey: string,
    currentStrength: number
  ) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      commitStrengthEdit(loraKey);
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
      setDraftValue(formatLoraStrength(clampStrength(base + delta)));
    }
  };

  const handleRemoveLora = (loraKey: string) => {
    onChangeEditableLoras((prev) =>
      prev.filter((item) => normalizeLoraKey(item.loraName) !== loraKey)
    );
  };

  const handleAddLora = (item: LoraExplorerItem) => {
    const key = normalizeLoraKey(item.filename);
    if (!key || activeLoraKeySet.has(key)) return;
    const defaultStrength = clampStrength(Number(item.defaultModelStrength ?? 1.0));
    const nextRecord: ImageLoraRecord = {
      id: -Date.now(),
      imageId: activeImage.id,
      modelId: item.modelId ?? null,
      loraName: item.filename,
      loraPath: item.comfyuiPath ?? null,
      loraHash: item.autov2Hash || item.sha256Hash || null,
      modelStrength: defaultStrength,
      clipStrength: defaultStrength,
      nodeId: '50',
      nodeType: 'Power Lora Loader (rgthree)',
      provenance: 'embedded_api',
      loraCategory: item.loraCategory,
      isInstalled: true,
    };
    onChangeEditableLoras((prev) => [...prev, nextRecord]);
    setShowAddPicker(false);
    setAddSearchQuery('');
  };

  const handleResetLoras = () => {
    onChangeEditableLoras(activeImage.loras || []);
    setEditingKey(null);
  };

  const renderStrengthControl = (
    loraKey: string,
    currentStrength: number,
    label: string,
    styleSet: PillColorStyleSet
  ) => {
    if (editingKey === loraKey) {
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
            onBlur={() => commitStrengthEdit(loraKey)}
            onKeyDown={(e) => handleStrengthKeyDown(e, loraKey, currentStrength)}
            className={`w-14 md:w-12 rounded px-1 text-base md:text-[11px] font-mono tabular-nums text-center focus:outline-none ring-1 ${styleSet.strengthInput}`}
          />
          <span>x</span>
        </span>
      );
    }

    return (
      <button
        type="button"
        onClick={() => startEditingStrength(loraKey, currentStrength)}
        title={`Click to edit ${label} weight for Run Workflow (-10.0 to +10.0)`}
        className={`text-[11px] font-mono tabular-nums cursor-text transition-colors ${styleSet.strengthText}`}
      >
        {formatLoraStrength(currentStrength)}x
      </button>
    );
  };

  const atMaxLoras = editableLoras.length >= MAX_SYSTEM_LORAS;

  return (
    <>
      {/* Generation Parameters & Checkpoint */}
      <div className="space-y-2">
        <h4 className="font-display font-semibold text-zinc-200 uppercase tracking-wider">
          Generation Parameters
        </h4>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 font-mono tabular-nums">
          <div className="bg-zinc-950 border border-zinc-800 rounded-lg p-2.5">
            <span className="block text-[10px] font-sans text-zinc-400">Checkpoint</span>
            <span className="text-zinc-100 truncate block" title={activeImage.checkpointName || ''}>
              {activeImage.checkpointName || '—'}
            </span>
          </div>
          <div className="bg-zinc-950 border border-zinc-800 rounded-lg p-2.5">
            <span className="block text-[10px] font-sans text-zinc-400">VAE</span>
            <span className="text-zinc-100 truncate block">
              {activeImage.vaeName || 'Baked / Default'}
            </span>
          </div>
          <div className="bg-zinc-950 border border-zinc-800 rounded-lg p-2.5">
            <span className="block text-[10px] font-sans text-zinc-400">Seed</span>
            <span className="text-zinc-100 truncate block">{activeImage.seed ?? '—'}</span>
          </div>
          <div className="bg-zinc-950 border border-zinc-800 rounded-lg p-2.5">
            <span className="block text-[10px] font-sans text-zinc-400">Steps / CFG</span>
            <span className="text-zinc-100">
              {activeImage.steps ?? '—'} / {activeImage.cfg ?? '—'}
            </span>
          </div>
          <div className="bg-zinc-950 border border-zinc-800 rounded-lg p-2.5">
            <span className="block text-[10px] font-sans text-zinc-400">Sampler / Scheduler</span>
            <span className="text-zinc-100 truncate block">
              {activeImage.sampler || '—'} · {activeImage.scheduler || '—'}
            </span>
          </div>
          <div className="bg-zinc-950 border border-zinc-800 rounded-lg p-2.5">
            <span className="block text-[10px] font-sans text-zinc-400">Denoise / Batch</span>
            <span className="text-zinc-100">
              {activeImage.denoise ?? '1.0'} · Batch {activeImage.batchSize ?? 1}
            </span>
          </div>
        </div>

        {activeImage.missingFields.length > 0 && (
          <p className="text-[11px] text-zinc-500">
            Unextracted fields: {activeImage.missingFields.join(' · ')}
          </p>
        )}
      </div>

      {/* Editable LoRA Chain */}
      <div className="space-y-2" ref={addPickerContainerRef}>
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <h4 className="font-display font-semibold text-zinc-200 uppercase tracking-wider">
              Extracted LoRAs ({editableLoras.length})
            </h4>
            {isModified && (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-indigo-500/15 border border-indigo-500/30 text-indigo-300 font-medium">
                Edited
              </span>
            )}
          </div>

          <div className="flex items-center gap-1.5">
            {isModified && (
              <button
                type="button"
                onClick={handleResetLoras}
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-zinc-950 hover:bg-zinc-800 border border-zinc-800 text-zinc-400 hover:text-zinc-200 text-[11px] cursor-pointer transition-colors"
                title="Reset LoRAs to original image metadata"
              >
                <RotateCcw className="w-3 h-3" />
                <span>Reset</span>
              </button>
            )}

            <button
              type="button"
              disabled={atMaxLoras}
              onClick={() => setShowAddPicker((prev) => !prev)}
              className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md border text-[11px] font-medium transition-colors ${
                atMaxLoras
                  ? 'bg-zinc-950 border-zinc-800/70 text-zinc-600 cursor-not-allowed'
                  : showAddPicker
                  ? 'bg-indigo-600/25 border-indigo-500/60 text-indigo-200 cursor-pointer'
                  : 'bg-zinc-950 hover:bg-zinc-800 border-zinc-800 text-zinc-300 hover:text-white cursor-pointer'
              }`}
              title={
                atMaxLoras
                  ? `Maximum of ${MAX_SYSTEM_LORAS} LoRAs reached`
                  : 'Add a LoRA for Run Workflow'
              }
            >
              <Plus className="w-3 h-3" />
              <span>Add LoRA</span>
            </button>
          </div>
        </div>

        {/* Add LoRA Dropdown Picker */}
        {showAddPicker && (
          <div className="bg-zinc-950 border border-zinc-700/80 rounded-lg p-2 space-y-2 shadow-xl">
            <div className="relative">
              <Search className="w-3.5 h-3.5 text-zinc-500 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                ref={addSearchInputRef}
                type="text"
                value={addSearchQuery}
                onChange={(e) => setAddSearchQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') {
                    e.preventDefault();
                    setShowAddPicker(false);
                  } else if (e.key === 'Enter' && availableAddLoras.length > 0) {
                    e.preventDefault();
                    handleAddLora(availableAddLoras[0]);
                  }
                }}
                placeholder="Search installed LoRAs by name, @nickname, or trigger..."
                className="w-full bg-zinc-900 border border-zinc-800 focus:border-indigo-500 focus:outline-none rounded-md pl-8 pr-7 py-1.5 text-xs text-zinc-200"
              />
              {addSearchQuery && (
                <button
                  type="button"
                  onClick={() => setAddSearchQuery('')}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-300 cursor-pointer"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>

            <div className="max-h-48 overflow-y-auto space-y-1 pr-0.5">
              {availableAddLoras.length === 0 ? (
                <p className="text-[11px] text-zinc-500 py-2 text-center">
                  No matching installed LoRAs available to add.
                </p>
              ) : (
                availableAddLoras.map((item) => {
                  const category: LoraCategory =
                    item.loraCategory ||
                    (item.characters.length > 0 ? 'character' : 'unclassified');
                  const pillStyle = resolveLoraCategoryStyle(category, pillTypeSettings);
                  const pillLabel = getCleanLoraLabel(item);
                  const defStrength = formatLoraStrength(item.defaultModelStrength ?? 1.0);

                  return (
                    <button
                      key={item.filename}
                      type="button"
                      onClick={() => handleAddLora(item)}
                      className="w-full flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-md hover:bg-zinc-900 text-left cursor-pointer transition-colors"
                    >
                      <span className="text-zinc-200 font-medium truncate">
                        {item.name || item.filename}
                      </span>
                      <span
                        className={`inline-flex items-center gap-1 pl-2 pr-2 py-0.5 rounded-full border text-[11px] shrink-0 ${pillStyle.pill}`}
                      >
                        <Layers className={`w-3 h-3 shrink-0 ${pillStyle.icon}`} />
                        <span className={`font-medium truncate max-w-[110px] ${pillStyle.textLight}`}>
                          {pillLabel}
                        </span>
                        <span className={`font-mono tabular-nums ${pillStyle.strengthText}`}>
                          {defStrength}x
                        </span>
                      </span>
                    </button>
                  );
                })
              )}
            </div>
          </div>
        )}

        {editableLoras.length === 0 ? (
          <p className="text-zinc-500">
            No LoRAs active for this run.{' '}
            {(activeImage.loras?.length || 0) > 0 && (
              <button
                type="button"
                onClick={handleResetLoras}
                className="text-indigo-400 hover:text-indigo-300 underline cursor-pointer"
              >
                Restore original LoRAs ({activeImage.loras.length})
              </button>
            )}
          </p>
        ) : (
          <div className="space-y-1.5">
            {editableLoras.map((l) => {
              const availability = getModelAvailabilityInfo(l);
              const loraKey = normalizeLoraKey(l.loraName);
              const { displayName, pillLabel, category } = resolveInspectorLoraMeta(l, loras);
              const pillStyle = resolveLoraCategoryStyle(category, pillTypeSettings);

              return (
                <div
                  key={`${loraKey}-${l.id}`}
                  className="bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2.5 flex items-center justify-between gap-3"
                >
                  <div className="min-w-0 flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        onFilterByLora(l.loraName);
                        onClose();
                      }}
                      title={`Filter gallery by ${displayName} (${l.loraName})`}
                      className="font-medium text-zinc-100 hover:text-indigo-300 truncate block cursor-pointer text-left transition-colors"
                    >
                      {displayName}
                    </button>
                    {availability.state !== 'installed' && (
                      <span
                        className={`text-[10px] shrink-0 ${availability.colorClass}`}
                        title={availability.tooltip}
                      >
                        {availability.label}
                      </span>
                    )}
                  </div>

                  {/* Interactive LoRA Pill: click weight to edit, click × to remove */}
                  <div
                    className={`inline-flex items-center gap-1.5 pl-2 pr-2 py-0.5 rounded-full border text-xs shadow-sm shrink-0 ${pillStyle.pill}`}
                  >
                    <Layers className={`w-3 h-3 shrink-0 ${pillStyle.icon}`} />
                    <span
                      onClick={() => startEditingStrength(loraKey, l.modelStrength)}
                      title={`Click to edit ${displayName} weight for Run Workflow`}
                      className={`font-medium truncate max-w-[130px] cursor-pointer ${pillStyle.textLight}`}
                    >
                      {pillLabel}
                    </span>
                    {renderStrengthControl(loraKey, l.modelStrength, displayName, pillStyle)}
                    <button
                      type="button"
                      onClick={() => handleRemoveLora(loraKey)}
                      className={`${pillStyle.removeButton} cursor-pointer ml-0.5 shrink-0`}
                      title={`Remove ${displayName} from Run Workflow`}
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </>
  );
};
