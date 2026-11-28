import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Check, Copy, Dices, Layers, Plus, RotateCcw, Search, X } from 'lucide-react';
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
  ModelInventoryItem,
  PillTypeSettings,
} from '../../shared/types.ts';
import { copyTextToClipboard, getModelAvailabilityInfo } from '../../shared/utils.ts';
import {
  getCleanLoraLabel,
  getCleanModelLabel,
  MAX_SYSTEM_LORAS,
  normalizeLoraKey,
} from '../quickgen/quickGenUtils.ts';
import {
  buildEditableGenParamsFromImage,
  type InspectorEditableGenParams,
} from './useInspectorState.ts';

const MIN_STRENGTH = -10.0;
const MAX_STRENGTH = 10.0;
const STEP_STRENGTH = 0.05;

const SAMPLER_OPTIONS = [
  'euler',
  'euler_ancestral',
  'heun',
  'dpm_2',
  'dpm_2_ancestral',
  'lms',
  'dpm_fast',
  'dpm_adaptive',
  'dpmpp_2s_ancestral',
  'dpmpp_sde',
  'dpmpp_sde_gpu',
  'dpmpp_2m',
  'dpmpp_2m_sde',
  'dpmpp_2m_sde_gpu',
  'dpmpp_3m_sde',
  'dpmpp_3m_sde_gpu',
  'ddim',
  'uni_pc',
  'uni_pc_bh2',
  'lcm',
];

const SCHEDULER_OPTIONS = [
  'simple',
  'normal',
  'karras',
  'exponential',
  'sgm_uniform',
  'ddim_uniform',
  'beta',
  'linear_quadratic',
  'kl_optimal',
];

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

function areGenParamsModified(
  current: InspectorEditableGenParams,
  original: InspectorEditableGenParams
): boolean {
  return (
    current.checkpointName.trim() !== original.checkpointName.trim() ||
    current.vaeName.trim() !== original.vaeName.trim() ||
    current.seed.trim() !== original.seed.trim() ||
    current.steps.trim() !== original.steps.trim() ||
    current.cfg.trim() !== original.cfg.trim() ||
    current.sampler.trim() !== original.sampler.trim() ||
    current.scheduler.trim() !== original.scheduler.trim() ||
    current.denoise.trim() !== original.denoise.trim() ||
    current.batchSize.trim() !== original.batchSize.trim()
  );
}

interface InspectorPositivePromptSectionProps {
  activeImage: ImageRecord;
  editablePositivePrompt: string;
  onChangeEditablePositivePrompt: (value: string) => void;
}

/**
 * Editable positive prompt box positioned directly below the Assigned Character section.
 */
export const InspectorPositivePromptSection: React.FC<
  InspectorPositivePromptSectionProps
> = ({
  activeImage,
  editablePositivePrompt,
  onChangeEditablePositivePrompt,
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
  editableGenParams: InspectorEditableGenParams;
  onChangeEditableGenParams: React.Dispatch<React.SetStateAction<InspectorEditableGenParams>>;
  loras?: LoraExplorerItem[];
  models?: ModelInventoryItem[];
  pillTypeSettings?: PillTypeSettings;
  onFilterByLora: (loraFilename: string) => void;
  onClose: () => void;
}

/**
 * Editable generation parameters (2x3 grid) and editable LoRA chain applied when Run Workflow is submitted.
 */
export const InspectorPromptAndParamsSection: React.FC<
  InspectorPromptAndParamsSectionProps
> = ({
  activeImage,
  editableLoras,
  onChangeEditableLoras,
  editableGenParams,
  onChangeEditableGenParams,
  loras = [],
  models = [],
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

  const checkpointOptions = useMemo(() => {
    const installed = models.filter(
      (m) => (m.modelType === 'checkpoint' || m.modelType === 'diffusion') && m.isInstalled
    );
    const list: Array<{ value: string; label: string }> = installed.map((m) => ({
      value: m.filename,
      label: getCleanModelLabel(m.name || m.filename),
    }));
    const current = editableGenParams.checkpointName.trim();
    if (
      current &&
      !list.some((opt) => normalizeLoraKey(opt.value) === normalizeLoraKey(current))
    ) {
      list.unshift({
        value: current,
        label: getCleanModelLabel(current),
      });
    }
    return list;
  }, [models, editableGenParams.checkpointName]);

  const samplerOptions = useMemo(() => {
    const current = editableGenParams.sampler.trim();
    if (current && !SAMPLER_OPTIONS.includes(current)) {
      return [current, ...SAMPLER_OPTIONS];
    }
    return SAMPLER_OPTIONS;
  }, [editableGenParams.sampler]);

  const schedulerOptions = useMemo(() => {
    const current = editableGenParams.scheduler.trim();
    if (current && !SCHEDULER_OPTIONS.includes(current)) {
      return [current, ...SCHEDULER_OPTIONS];
    }
    return SCHEDULER_OPTIONS;
  }, [editableGenParams.scheduler]);

  const originalGenParams = useMemo(
    () => buildEditableGenParamsFromImage(activeImage),
    [activeImage]
  );

  const isGenParamsModified = useMemo(
    () => areGenParamsModified(editableGenParams, originalGenParams),
    [editableGenParams, originalGenParams]
  );

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

  const isLorasModified = useMemo(
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

  const handleResetGenParams = () => {
    onChangeEditableGenParams(buildEditableGenParamsFromImage(activeImage));
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

  // Match active checkpoint option value even if stored without path or with different casing
  const selectedCheckpointValue = useMemo(() => {
    const current = editableGenParams.checkpointName.trim();
    if (!current) return '';
    const match = checkpointOptions.find(
      (opt) => normalizeLoraKey(opt.value) === normalizeLoraKey(current)
    );
    return match ? match.value : current;
  }, [editableGenParams.checkpointName, checkpointOptions]);

  return (
    <>
      {/* Editable Generation Parameters (2x3 Grid) */}
      <div className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <h4 className="font-display font-semibold text-zinc-200 uppercase tracking-wider">
              Generation Parameters
            </h4>
            {isGenParamsModified && (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-indigo-500/15 border border-indigo-500/30 text-indigo-300 font-medium">
                Edited
              </span>
            )}
          </div>
          {isGenParamsModified && (
            <button
              type="button"
              onClick={handleResetGenParams}
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-zinc-950 hover:bg-zinc-800 border border-zinc-800 text-zinc-400 hover:text-zinc-200 text-[11px] cursor-pointer transition-colors"
              title="Reset Generation Parameters to original image metadata"
            >
              <RotateCcw className="w-3 h-3" />
              <span>Reset</span>
            </button>
          )}
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 font-mono tabular-nums">
          {/* 1. Checkpoint (Pull-down) */}
          <div className="bg-zinc-950 border border-zinc-800 focus-within:border-indigo-500 rounded-lg p-2.5 transition-colors">
            <label
              htmlFor="inspector-param-checkpoint"
              className="block text-[10px] font-sans text-zinc-400"
            >
              Checkpoint
            </label>
            <select
              id="inspector-param-checkpoint"
              value={selectedCheckpointValue}
              onChange={(e) =>
                onChangeEditableGenParams((prev) => ({
                  ...prev,
                  checkpointName: e.target.value,
                }))
              }
              title={editableGenParams.checkpointName || 'Select Checkpoint'}
              className="w-full bg-transparent text-zinc-100 truncate focus:outline-none cursor-pointer"
            >
              {checkpointOptions.length === 0 && <option value="">—</option>}
              {checkpointOptions.map((opt) => (
                <option key={opt.value} value={opt.value} className="bg-zinc-900 text-zinc-100">
                  {opt.label}
                </option>
              ))}
            </select>
          </div>

          {/* 2. VAE */}
          <div className="bg-zinc-950 border border-zinc-800 focus-within:border-indigo-500 rounded-lg p-2.5 transition-colors">
            <label
              htmlFor="inspector-param-vae"
              className="block text-[10px] font-sans text-zinc-400"
            >
              VAE
            </label>
            <input
              id="inspector-param-vae"
              type="text"
              value={editableGenParams.vaeName}
              onChange={(e) =>
                onChangeEditableGenParams((prev) => ({
                  ...prev,
                  vaeName: e.target.value,
                }))
              }
              placeholder="Baked / Default"
              title={editableGenParams.vaeName || 'Baked / Default'}
              className="w-full bg-transparent text-zinc-100 placeholder:text-zinc-500 truncate focus:outline-none"
            />
          </div>

          {/* 3. Seed */}
          <div className="bg-zinc-950 border border-zinc-800 focus-within:border-indigo-500 rounded-lg p-2.5 transition-colors">
            <div className="flex items-center justify-between gap-1">
              <label
                htmlFor="inspector-param-seed"
                className="block text-[10px] font-sans text-zinc-400"
              >
                Seed
              </label>
              <button
                type="button"
                onClick={() =>
                  onChangeEditableGenParams((prev) => ({
                    ...prev,
                    seed: String(Math.floor(Math.random() * 1e15) + 1),
                  }))
                }
                className="text-zinc-400 hover:text-indigo-300 transition-colors cursor-pointer"
                title="Randomize seed for Run Workflow"
                aria-label="Randomize seed"
              >
                <Dices className="w-3.5 h-3.5" />
              </button>
            </div>
            <input
              id="inspector-param-seed"
              type="text"
              inputMode="numeric"
              value={editableGenParams.seed}
              onChange={(e) =>
                onChangeEditableGenParams((prev) => ({
                  ...prev,
                  seed: e.target.value.replace(/[^\d]/g, ''),
                }))
              }
              placeholder="Random"
              title={editableGenParams.seed || 'Random seed'}
              className="w-full bg-transparent text-zinc-100 placeholder:text-zinc-500 truncate focus:outline-none"
            />
          </div>

          {/* 4. Steps / CFG */}
          <div className="bg-zinc-950 border border-zinc-800 focus-within:border-indigo-500 rounded-lg p-2.5 transition-colors">
            <span className="block text-[10px] font-sans text-zinc-400">Steps / CFG</span>
            <div className="flex items-center gap-1 text-zinc-100">
              <input
                type="text"
                inputMode="numeric"
                aria-label="Steps"
                value={editableGenParams.steps}
                onChange={(e) =>
                  onChangeEditableGenParams((prev) => ({
                    ...prev,
                    steps: e.target.value.replace(/[^\d]/g, ''),
                  }))
                }
                placeholder="—"
                className="w-9 bg-transparent text-zinc-100 focus:outline-none"
              />
              <span className="text-zinc-500">/</span>
              <input
                type="text"
                inputMode="decimal"
                aria-label="CFG"
                value={editableGenParams.cfg}
                onChange={(e) =>
                  onChangeEditableGenParams((prev) => ({
                    ...prev,
                    cfg: e.target.value.replace(/[^\d.]/g, ''),
                  }))
                }
                placeholder="—"
                className="w-12 bg-transparent text-zinc-100 focus:outline-none"
              />
            </div>
          </div>

          {/* 5. Sampler / Scheduler (Pull-downs) */}
          <div className="bg-zinc-950 border border-zinc-800 focus-within:border-indigo-500 rounded-lg p-2.5 transition-colors">
            <span className="block text-[10px] font-sans text-zinc-400">Sampler / Scheduler</span>
            <div className="flex items-center gap-1 text-zinc-100 min-w-0">
              <select
                aria-label="Sampler"
                value={editableGenParams.sampler}
                onChange={(e) =>
                  onChangeEditableGenParams((prev) => ({
                    ...prev,
                    sampler: e.target.value,
                  }))
                }
                title={`Sampler: ${editableGenParams.sampler || '—'}`}
                className="min-w-0 flex-1 bg-transparent text-zinc-100 truncate focus:outline-none cursor-pointer"
              >
                {!editableGenParams.sampler && <option value="">—</option>}
                {samplerOptions.map((s) => (
                  <option key={s} value={s} className="bg-zinc-900 text-zinc-100">
                    {s}
                  </option>
                ))}
              </select>
              <span className="text-zinc-500 shrink-0">·</span>
              <select
                aria-label="Scheduler"
                value={editableGenParams.scheduler}
                onChange={(e) =>
                  onChangeEditableGenParams((prev) => ({
                    ...prev,
                    scheduler: e.target.value,
                  }))
                }
                title={`Scheduler: ${editableGenParams.scheduler || '—'}`}
                className="min-w-0 flex-1 bg-transparent text-zinc-100 truncate focus:outline-none cursor-pointer"
              >
                {!editableGenParams.scheduler && <option value="">—</option>}
                {schedulerOptions.map((sch) => (
                  <option key={sch} value={sch} className="bg-zinc-900 text-zinc-100">
                    {sch}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* 6. Denoise / Batch */}
          <div className="bg-zinc-950 border border-zinc-800 focus-within:border-indigo-500 rounded-lg p-2.5 transition-colors">
            <span className="block text-[10px] font-sans text-zinc-400">Denoise / Batch</span>
            <div className="flex items-center gap-1 text-zinc-100">
              <input
                type="text"
                inputMode="decimal"
                aria-label="Denoise"
                value={editableGenParams.denoise}
                onChange={(e) =>
                  onChangeEditableGenParams((prev) => ({
                    ...prev,
                    denoise: e.target.value.replace(/[^\d.]/g, ''),
                  }))
                }
                placeholder="1"
                className="w-10 bg-transparent text-zinc-100 focus:outline-none"
              />
              <span className="text-zinc-500">·</span>
              <span className="text-zinc-400 text-[11px]">Batch</span>
              <input
                type="text"
                inputMode="numeric"
                aria-label="Batch Size"
                value={editableGenParams.batchSize}
                onChange={(e) =>
                  onChangeEditableGenParams((prev) => ({
                    ...prev,
                    batchSize: e.target.value.replace(/[^\d]/g, ''),
                  }))
                }
                placeholder="1"
                className="w-7 bg-transparent text-zinc-100 focus:outline-none"
              />
            </div>
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
            {isLorasModified && (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-indigo-500/15 border border-indigo-500/30 text-indigo-300 font-medium">
                Edited
              </span>
            )}
          </div>

          <div className="flex items-center gap-1.5">
            {isLorasModified && (
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
