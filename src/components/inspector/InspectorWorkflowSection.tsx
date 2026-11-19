import React from 'react';
import { ArrowUpRight, Loader2 } from 'lucide-react';

interface InspectorWorkflowSectionProps {
  currentMegapixels: number;
  upscaleTargetMp: number;
  onChangeUpscaleTargetMp: (mp: number) => void;
  estimatedUpscaleDims: { estW: number; estH: number };
  isRunningWorkflow: boolean;
  isUpscalingImage: boolean;
  reproStatusMsg: string | null;
  reproStatusIsError: boolean;
  onUpscaleImage: () => void;
}

/**
 * Standalone 4x-ESRGAN target-megapixel upscale controls.
 */
export const InspectorWorkflowSection: React.FC<InspectorWorkflowSectionProps> = ({
  currentMegapixels,
  upscaleTargetMp,
  onChangeUpscaleTargetMp,
  estimatedUpscaleDims,
  isRunningWorkflow,
  isUpscalingImage,
  reproStatusMsg,
  reproStatusIsError,
  onUpscaleImage,
}) => (
  <div className="bg-zinc-950 border border-zinc-800 rounded-xl p-4 space-y-2.5 min-w-0">
    <div className="flex items-center justify-between gap-2 text-[11px]">
      <span className="font-display font-semibold text-zinc-200 uppercase tracking-wider">
        Upscale Image
      </span>
      <span className="font-mono text-zinc-300 tabular-nums">
        {currentMegapixels.toFixed(1)} MP &rarr;{' '}
        <span className="text-indigo-300 font-semibold">{upscaleTargetMp.toFixed(1)} MP</span>{' '}
        <span className="text-zinc-500">
          (~{estimatedUpscaleDims.estW}×{estimatedUpscaleDims.estH})
        </span>
      </span>
    </div>

    <div className="flex items-center gap-3">
      <div className="flex-1 min-w-0">
        <input
          type="range"
          min={1.0}
          max={10.0}
          step={0.5}
          value={upscaleTargetMp}
          onChange={(e) => {
            const val = parseFloat(e.target.value);
            if (Number.isFinite(val)) {
              onChangeUpscaleTargetMp(Math.max(1.0, Math.min(10.0, Math.round(val * 2) / 2)));
            }
          }}
          className="w-full accent-indigo-500 cursor-pointer"
        />
        <div className="flex items-center justify-between text-[10px] font-mono text-zinc-500 mt-0.5">
          <span>1.0 MP</span>
          {currentMegapixels > 3.0 && (
            <span className="text-amber-300/90">
              Source &gt;3MP auto-clamped to 3MP before 4&times; ESRGAN
            </span>
          )}
          <span>10.0 MP</span>
        </div>
      </div>

      <button
        type="button"
        onClick={onUpscaleImage}
        disabled={isUpscalingImage || isRunningWorkflow}
        className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 disabled:opacity-50 text-zinc-100 font-medium rounded-lg cursor-pointer shrink-0 transition-colors"
        title="Send this image through the internal 4x-ESRGAN upscale workflow"
      >
        {isUpscalingImage ? (
          <Loader2 className="w-3.5 h-3.5 animate-spin" />
        ) : (
          <ArrowUpRight className="w-3.5 h-3.5 text-indigo-400" />
        )}
        <span>{isUpscalingImage ? 'Upscaling...' : 'Upscale'}</span>
      </button>
    </div>

    {reproStatusMsg && (
      <p
        className={`font-mono break-words text-[11px] ${
          reproStatusIsError ? 'text-rose-400' : 'text-emerald-400'
        }`}
      >
        {reproStatusMsg}
      </p>
    )}
  </div>
);
