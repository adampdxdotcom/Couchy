import React from 'react';
import { ASPECT_RATIO_PRESETS, MEGAPIXEL_PRESETS } from '../../shared/utils.ts';

export interface ResolutionSelectorPanelProps {
  aspectRatio: string;
  onChangeAspectRatio: (val: string) => void;
  megapixels: number;
  onChangeMegapixels: (val: number) => void;
  generationCount: number;
  onChangeGenerationCount: (val: number) => void;
}

/**
 * Resolution & batch dimension panel targeting ComfyUI ResolutionSelector (Node #49).
 */
export const ResolutionSelectorPanel: React.FC<ResolutionSelectorPanelProps> = ({
  aspectRatio,
  onChangeAspectRatio,
  megapixels,
  onChangeMegapixels,
  generationCount,
  onChangeGenerationCount,
}) => {
  return (
    <section className="p-5 bg-zinc-900/60 border border-zinc-800/90 rounded-xl space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-display font-semibold text-zinc-100">
          02. Resolution Selector (Node #49) & Batch Size
        </h2>
        <span className="text-xs font-mono text-zinc-400 tabular-nums">
          {megapixels.toFixed(1)} MP · {generationCount} shot
          {generationCount === 1 ? '' : 's'}
        </span>
      </div>

      {/* Aspect Ratio Grid */}
      <div className="grid grid-cols-4 sm:grid-cols-8 gap-1.5">
        {ASPECT_RATIO_PRESETS.map((preset) => {
          const isSelected =
            aspectRatio === preset.value || aspectRatio === preset.shortRatio;
          return (
            <button
              key={preset.value}
              type="button"
              onClick={() => onChangeAspectRatio(preset.value)}
              className={`flex flex-col items-center justify-center py-2.5 px-1.5 rounded-lg border transition-colors cursor-pointer ${
                isSelected
                  ? 'bg-indigo-600/15 border-indigo-500 text-zinc-100'
                  : 'bg-zinc-950 border-zinc-800 text-zinc-400 hover:border-zinc-700 hover:text-zinc-200'
              }`}
            >
              <div className="h-6 flex items-center justify-center mb-1">
                <div
                  style={{ width: `${preset.boxW}px`, height: `${preset.boxH}px` }}
                  className={`border rounded-[2px] ${
                    isSelected ? 'border-indigo-400 bg-indigo-500/20' : 'border-zinc-600'
                  }`}
                />
              </div>
              <span className="text-xs font-mono font-semibold">{preset.shortRatio}</span>
              <span className="text-[10px] text-zinc-400 truncate max-w-full">
                {preset.label}
              </span>
            </button>
          );
        })}
      </div>

      {/* Megapixels (0.1 to 10.0) Controls */}
      <div className="p-3.5 bg-zinc-950 border border-zinc-800 rounded-lg space-y-3">
        <div className="flex items-center justify-between gap-4">
          <div className="flex-1">
            <div className="flex items-center justify-between text-xs mb-1">
              <span className="font-medium text-zinc-300">
                Megapixels (Node #49 <code className="text-indigo-300">megapixels</code>: 0.1 – 10.0)
              </span>
              <span className="font-mono font-semibold text-indigo-400 tabular-nums">
                {megapixels.toFixed(1)} MP
              </span>
            </div>
            <input
              type="range"
              min="0.1"
              max="10.0"
              step="0.1"
              value={megapixels}
              onChange={(e) =>
                onChangeMegapixels(
                  Math.max(0.1, Math.min(10.0, parseFloat(e.target.value) || 3.0))
                )
              }
              className="w-full accent-indigo-500 cursor-pointer"
            />
          </div>

          <div className="w-24 shrink-0">
            <label className="block text-[11px] text-zinc-400 mb-1">Exact MP</label>
            <input
              type="number"
              min={0.1}
              max={10.0}
              step={0.1}
              value={megapixels}
              onChange={(e) =>
                onChangeMegapixels(
                  Math.max(0.1, Math.min(10.0, parseFloat(e.target.value) || 3.0))
                )
              }
              className="w-full px-2.5 py-1.5 text-xs font-mono tabular-nums bg-zinc-900 border border-zinc-800 rounded-lg text-zinc-100"
            />
          </div>
        </div>

        {/* Quick Megapixel Presets */}
        <div className="flex items-center justify-between gap-2 pt-1">
          <span className="text-[11px] text-zinc-400">Quick MP:</span>
          <div className="flex flex-wrap items-center gap-1.5">
            {MEGAPIXEL_PRESETS.map((mpVal) => (
              <button
                key={mpVal}
                type="button"
                onClick={() => onChangeMegapixels(mpVal)}
                className={`px-2 py-1 text-xs font-mono tabular-nums rounded border transition-colors cursor-pointer ${
                  Math.abs(megapixels - mpVal) < 0.01
                    ? 'bg-indigo-600 text-white border-indigo-500'
                    : 'bg-zinc-900 text-zinc-400 border-zinc-800 hover:text-zinc-200'
                }`}
              >
                {mpVal.toFixed(1)} MP
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Aspect Ratio Node String & Generation Count */}
      <div className="grid grid-cols-2 gap-3 pt-1">
        <div>
          <label className="block text-[11px] text-zinc-400 mb-1">
            Exact <code className="text-indigo-300">aspect_ratio</code> Sent to Node #49
          </label>
          <input
            type="text"
            value={aspectRatio}
            onChange={(e) => onChangeAspectRatio(e.target.value)}
            placeholder="e.g. 2:3 (Portrait Photo)"
            className="w-full px-2.5 py-1.5 text-xs font-mono bg-zinc-950 border border-zinc-800 rounded-lg text-zinc-100"
          />
        </div>
        <div>
          <label className="block text-[11px] text-zinc-400 mb-1">
            Number of Generations (1–20)
          </label>
          <input
            type="number"
            min={1}
            max={20}
            value={generationCount}
            onChange={(e) =>
              onChangeGenerationCount(Math.max(1, Math.min(20, Number(e.target.value) || 1)))
            }
            className="w-full px-2.5 py-1.5 text-xs font-mono tabular-nums bg-zinc-950 border border-zinc-800 rounded-lg text-zinc-100"
          />
        </div>
      </div>

      {/* Quick Count Buttons */}
      <div className="flex items-center justify-between gap-2 pt-1">
        <span className="text-xs text-zinc-400">Quick Batch Size:</span>
        <div className="flex items-center gap-1.5">
          {[1, 2, 4, 6, 8, 12].map((num) => (
            <button
              key={num}
              type="button"
              onClick={() => onChangeGenerationCount(num)}
              className={`px-2.5 py-1 text-xs font-mono tabular-nums rounded border transition-colors cursor-pointer ${
                generationCount === num
                  ? 'bg-indigo-600 text-white border-indigo-500'
                  : 'bg-zinc-950 text-zinc-400 border-zinc-800 hover:text-zinc-200'
              }`}
            >
              {num}×
            </button>
          ))}
        </div>
      </div>
    </section>
  );
};
