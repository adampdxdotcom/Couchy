import React, { useEffect, useRef, useState } from 'react';
import { Check, Copy, Layers, Sparkles } from 'lucide-react';
import {
  DEFAULT_PILL_TYPE_SETTINGS,
  resolveLoraCategoryStyle,
} from '../../shared/pillSettings.ts';
import type {
  ImageLoraRecord,
  ImageRecord,
  LoraCategory,
  LoraExplorerItem,
  PillTypeSettings,
} from '../../shared/types.ts';
import { copyTextToClipboard, getModelAvailabilityInfo } from '../../shared/utils.ts';
import { normalizeLoraKey } from '../quickgen/quickGenUtils.ts';

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

interface InspectorPositivePromptSectionProps {
  activeImage: ImageRecord;
  editablePositivePrompt: string;
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
  loras?: LoraExplorerItem[];
  pillTypeSettings?: PillTypeSettings;
  onFilterByLora: (loraFilename: string) => void;
  onClose: () => void;
}

/**
 * Extracted generation parameters and detected LoRA chain with gallery quick-filter links.
 */
export const InspectorPromptAndParamsSection: React.FC<
  InspectorPromptAndParamsSectionProps
> = ({
  activeImage,
  loras = [],
  pillTypeSettings = DEFAULT_PILL_TYPE_SETTINGS,
  onFilterByLora,
  onClose,
}) => {
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

      {/* Extracted LoRA Chain */}
      <div className="space-y-2">
        <h4 className="font-display font-semibold text-zinc-200 uppercase tracking-wider">
          Extracted LoRAs ({activeImage.loras.length})
        </h4>
        {activeImage.loras.length === 0 ? (
          <p className="text-zinc-500">No LoRAs detected in workflow or metadata.</p>
        ) : (
          <div className="space-y-1.5">
            {activeImage.loras.map((l) => {
              const availability = getModelAvailabilityInfo(l);
              const { displayName, pillLabel, category } = resolveInspectorLoraMeta(l, loras);
              const pillStyle = resolveLoraCategoryStyle(category, pillTypeSettings);

              return (
                <div
                  key={l.id}
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

                  <button
                    type="button"
                    onClick={() => {
                      onFilterByLora(l.loraName);
                      onClose();
                    }}
                    title={`Filter gallery by ${displayName}`}
                    className={`inline-flex items-center gap-1.5 pl-2 pr-2.5 py-0.5 rounded-full border text-xs shadow-sm shrink-0 cursor-pointer transition-opacity hover:opacity-90 ${pillStyle.pill}`}
                  >
                    <Layers className={`w-3 h-3 shrink-0 ${pillStyle.icon}`} />
                    <span className={`font-medium truncate max-w-[140px] ${pillStyle.textLight}`}>
                      {pillLabel}
                    </span>
                    <span className={`text-[11px] font-mono tabular-nums ${pillStyle.strengthText}`}>
                      {formatLoraStrength(l.modelStrength)}x
                    </span>
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </>
  );
};
