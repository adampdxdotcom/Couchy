import React, { useEffect, useRef, useState } from 'react';
import { Check, Copy, Sparkles } from 'lucide-react';
import type { ImageRecord } from '../../shared/types.ts';
import { copyTextToClipboard, getModelAvailabilityInfo } from '../../shared/utils.ts';

interface InspectorPromptAndParamsSectionProps {
  activeImage: ImageRecord;
  editablePositivePrompt: string;
  onChangeEditablePositivePrompt: (value: string) => void;
  onFilterByLora: (loraFilename: string) => void;
  onReusePrompt?: (image: ImageRecord) => void;
  onClose: () => void;
}

/**
 * Editable positive prompt, negative prompt, extracted generation parameters,
 * and detected LoRA chain with gallery quick-filter links.
 */
export const InspectorPromptAndParamsSection: React.FC<
  InspectorPromptAndParamsSectionProps
> = ({
  activeImage,
  editablePositivePrompt,
  onChangeEditablePositivePrompt,
  onFilterByLora,
  onReusePrompt,
  onClose,
}) => {
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const copyTimerRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (copyTimerRef.current !== null) window.clearTimeout(copyTimerRef.current);
    };
  }, []);

  const copyText = async (text: string, label: string) => {
    const ok = await copyTextToClipboard(text);
    if (!ok) return;
    if (copyTimerRef.current !== null) window.clearTimeout(copyTimerRef.current);
    setCopiedField(label);
    copyTimerRef.current = window.setTimeout(() => setCopiedField(null), 1500);
  };

  return (
    <>
      {/* Positive & Negative Prompts with Provenance */}
      <div className="space-y-3 pt-1 border-t border-zinc-800/80">
        <div className="space-y-1.5 pt-2">
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
                  onClick={() => copyText(editablePositivePrompt, 'pos')}
                  className="inline-flex items-center gap-1 text-indigo-400 hover:text-indigo-300 cursor-pointer"
                >
                  {copiedField === 'pos' ? (
                    <Check className="w-3.5 h-3.5" />
                  ) : (
                    <Copy className="w-3.5 h-3.5" />
                  )}
                  <span>{copiedField === 'pos' ? 'Copied' : 'Copy'}</span>
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
                  title="Load this prompt, character, base model, and LoRAs into the Quick Gen Box"
                >
                  <Sparkles className="w-3 h-3" />
                  <span>Quick Gen</span>
                </button>
              )}
            </div>
          </div>
          <textarea
            id="inspector-positive-prompt"
            rows={4}
            value={editablePositivePrompt}
            onChange={(e) => onChangeEditablePositivePrompt(e.target.value)}
            placeholder="Edit positive prompt to send with Run Workflow..."
            className="w-full bg-zinc-950 border border-zinc-800 focus:border-indigo-500 focus:outline-none rounded-lg p-3 text-zinc-200 leading-relaxed resize-y"
          />
        </div>

        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <span className="font-display font-semibold text-zinc-200 uppercase tracking-wider">
              Negative Prompt
            </span>
            {activeImage.negativePrompt && (
              <button
                type="button"
                onClick={() => copyText(activeImage.negativePrompt!, 'neg')}
                className="inline-flex items-center gap-1 text-indigo-400 hover:text-indigo-300 cursor-pointer"
              >
                {copiedField === 'neg' ? (
                  <Check className="w-3.5 h-3.5" />
                ) : (
                  <Copy className="w-3.5 h-3.5" />
                )}
                <span>{copiedField === 'neg' ? 'Copied' : 'Copy'}</span>
              </button>
            )}
          </div>
          <div className="bg-zinc-950 border border-zinc-800 rounded-lg p-3 text-zinc-300 leading-relaxed whitespace-pre-wrap max-h-28 overflow-y-auto">
            {activeImage.negativePrompt || <span className="text-zinc-500 italic">None</span>}
          </div>
        </div>
      </div>

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

      {/* Extracted LoRA Chain (Model & CLIP Strengths) */}
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
              return (
              <div
                key={l.id}
                className="bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 flex items-center justify-between gap-2"
              >
                <div className="min-w-0">
                  <button
                    type="button"
                    onClick={() => {
                      onFilterByLora(l.loraName);
                      onClose();
                    }}
                    className="font-medium text-indigo-300 hover:text-indigo-200 truncate block cursor-pointer"
                  >
                    {l.loraName}
                  </button>
                  <span className="text-[11px] text-zinc-500">
                    {l.nodeType || 'LoraLoader'} · Source: {l.provenance} ·{' '}
                    <span className={availability.colorClass} title={availability.tooltip}>
                      {availability.label}
                    </span>
                  </span>
                </div>
                <div className="text-right font-mono tabular-nums shrink-0">
                  <div className="text-zinc-200">Model: {l.modelStrength}</div>
                  <div className="text-zinc-400 text-[11px]">CLIP: {l.clipStrength}</div>
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
