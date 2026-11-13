import React from 'react';
import { ASPECT_RATIO_PRESETS } from '../../shared/utils.ts';
import { BATCH_COUNT_OPTIONS, snapToHalfMp } from './quickGenUtils.ts';

interface QuickGenSettingsPopoverProps {
  aspectRatio: string;
  megapixels: number;
  workflowDefaultMp: number;
  batchCount: number;
  conversationEnabled?: boolean;
  onChangeAspectRatio: (ratio: string) => void;
  onChangeMegapixels: (mp: number) => void;
  onChangeBatchCount: (count: number) => void;
}

/**
 * Popover controls for Aspect Ratio, Megapixels (with inline >3MP upscale indicator), and Batch Count.
 */
export const QuickGenSettingsPopover: React.FC<QuickGenSettingsPopoverProps> = ({
  aspectRatio,
  megapixels,
  workflowDefaultMp,
  batchCount,
  conversationEnabled = false,
  onChangeAspectRatio,
  onChangeMegapixels,
  onChangeBatchCount,
}) => {
  return (
    <div className="mb-2 mr-2 md:mr-0 ml-auto w-72 max-w-[calc(100vw-1rem)] bg-zinc-950/98 backdrop-blur-2xl border border-zinc-800 rounded-2xl p-3.5 shadow-2xl space-y-3.5 text-xs">
      <div>
        <span className="block text-[11px] font-medium text-zinc-400 mb-1.5">
          Aspect Ratio (Node #49)
        </span>
        <div className="grid grid-cols-4 gap-1.5">
          {ASPECT_RATIO_PRESETS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => onChangeAspectRatio(opt.value)}
              title={opt.label}
              className={`px-2 py-1.5 rounded-lg font-mono text-[11px] border transition-colors cursor-pointer ${
                aspectRatio === opt.value
                  ? 'bg-indigo-600/30 border-indigo-500 text-indigo-200 font-semibold'
                  : 'bg-zinc-900 border-zinc-800 text-zinc-300 hover:bg-zinc-800'
              }`}
            >
              {opt.short}
            </button>
          ))}
        </div>
      </div>

      <div>
        <div className="flex items-center justify-between gap-2 mb-1.5">
          <span className="text-[11px] font-medium text-zinc-400">
            Resolution (Node #49)
          </span>
          <div className="flex items-center gap-1.5">
            {megapixels > 3.0 && (
              <span className="px-1.5 py-0.5 rounded bg-amber-500/15 border border-amber-500/30 text-[10px] font-mono text-amber-300">
                3MP + Upscale
              </span>
            )}
            <span className="font-mono font-semibold text-indigo-300 tabular-nums">
              {megapixels.toFixed(1)} MP
            </span>
          </div>
        </div>
        <input
          type="range"
          min={0.5}
          max={10.0}
          step={0.5}
          value={megapixels}
          onChange={(e) => onChangeMegapixels(snapToHalfMp(parseFloat(e.target.value), workflowDefaultMp))}
          className="w-full accent-indigo-500 cursor-pointer"
        />
        <div className="flex items-center justify-between text-[10px] font-mono text-zinc-500 mt-0.5">
          <span>0.5 MP</span>
          <span
            className={
              Math.abs(megapixels - workflowDefaultMp) < 0.01
                ? 'text-indigo-400'
                : 'text-zinc-500'
            }
          >
            Default: {workflowDefaultMp.toFixed(1)} MP
          </span>
          <span>10.0 MP</span>
        </div>
      </div>

      <div>
        <div className="flex items-center justify-between gap-2 mb-1.5">
          <span className="text-[11px] font-medium text-zinc-400">
            Number of Generations
          </span>
          {conversationEnabled && (
            <span className="text-[10px] font-mono text-amber-300/90">
              1x in Conversation
            </span>
          )}
        </div>
        <div className="grid grid-cols-5 gap-1.5">
          {BATCH_COUNT_OPTIONS.map((cnt) => {
            const isDisabled = conversationEnabled && cnt > 1;
            return (
              <button
                key={cnt}
                type="button"
                disabled={isDisabled}
                onClick={() => {
                  if (!isDisabled) onChangeBatchCount(cnt);
                }}
                className={`px-2 py-1.5 rounded-lg font-mono text-[11px] border transition-colors ${
                  isDisabled
                    ? 'bg-zinc-900/40 border-zinc-800/50 text-zinc-600 cursor-not-allowed opacity-50'
                    : batchCount === cnt
                    ? 'bg-indigo-600/30 border-indigo-500 text-indigo-200 font-semibold cursor-pointer'
                    : 'bg-zinc-900 border-zinc-800 text-zinc-300 hover:bg-zinc-800 cursor-pointer'
                }`}
              >
                x{cnt}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
};
