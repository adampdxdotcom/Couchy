import React from 'react';

export interface WorkflowSelectionPanelProps {
  selectedCheckpoint: string;
  onChangeCheckpoint: (val: string) => void;
  workflowDefaultCheckpoint: string;
  availableDiffusionModels: string[];
}

/**
 * Step 3 diffusion model selector for the primary System Workflow (Node #30_10).
 */
export const WorkflowSelectionPanel: React.FC<WorkflowSelectionPanelProps> = ({
  selectedCheckpoint,
  onChangeCheckpoint,
  workflowDefaultCheckpoint,
  availableDiffusionModels,
}) => {
  return (
    <section className="p-5 bg-zinc-900/60 border border-zinc-800/90 rounded-xl space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-display font-semibold text-zinc-100">
          03. Diffusion Model (Node #30_10)
        </h2>
        {workflowDefaultCheckpoint && (
          <button
            type="button"
            onClick={() => onChangeCheckpoint(workflowDefaultCheckpoint)}
            className="text-xs text-indigo-400 hover:text-indigo-300 font-mono cursor-pointer"
            title="Reset to System Workflow model"
          >
            Reset to System Model
          </button>
        )}
      </div>

      <div>
        <label className="block text-xs font-medium text-zinc-400 mb-1">
          Diffusion Model (<code className="text-indigo-300">unet_name</code>)
        </label>
        <input
          type="text"
          list="diffusion-models-datalist"
          value={selectedCheckpoint}
          onChange={(e) => onChangeCheckpoint(e.target.value)}
          placeholder={
            workflowDefaultCheckpoint
              ? `System: ${workflowDefaultCheckpoint}`
              : 'Use System Workflow model or select override...'
          }
          className="w-full px-3 py-2 text-xs font-mono bg-zinc-950 border border-zinc-800 rounded-lg text-zinc-100"
        />
        <datalist id="diffusion-models-datalist">
          {availableDiffusionModels.map((m) => (
            <option key={m} value={m} />
          ))}
        </datalist>
      </div>
    </section>
  );
};
