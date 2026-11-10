import React from 'react';
import { Sliders, Upload } from 'lucide-react';
import type {
  WorkflowLibraryItem,
  WorkflowNodeMapping,
} from '../../shared/types.ts';

export interface WorkflowSelectionPanelProps {
  workflows: WorkflowLibraryItem[];
  selectedWorkflowId: number | null;
  onSelectWorkflowId: (id: number | null) => void;
  selectedCheckpoint: string;
  onChangeCheckpoint: (val: string) => void;
  workflowDefaultCheckpoint: string;
  availableDiffusionModels: string[];
  workflowMapping: WorkflowNodeMapping | null;
  onOpenMapperModal: (tab: 'map' | 'import') => void;
}

/**
 * Step 3 workflow and diffusion model selector with node mapping shortcuts.
 */
export const WorkflowSelectionPanel: React.FC<WorkflowSelectionPanelProps> = ({
  workflows,
  selectedWorkflowId,
  onSelectWorkflowId,
  selectedCheckpoint,
  onChangeCheckpoint,
  workflowDefaultCheckpoint,
  availableDiffusionModels,
  workflowMapping,
  onOpenMapperModal,
}) => {
  return (
    <section className="p-5 bg-zinc-900/60 border border-zinc-800/90 rounded-xl space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-display font-semibold text-zinc-100">
          03. Workflow & Diffusion Model (Node #30_10)
        </h2>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => onOpenMapperModal('import')}
            className="inline-flex items-center gap-1 text-xs text-indigo-400 hover:text-indigo-300 cursor-pointer"
          >
            <Upload className="w-3.5 h-3.5" />
            <span>Import JSON</span>
          </button>
          <span className="text-zinc-700">·</span>
          <button
            type="button"
            onClick={() => onOpenMapperModal('map')}
            className="inline-flex items-center gap-1 text-xs text-zinc-300 hover:text-zinc-100 cursor-pointer"
          >
            <Sliders className="w-3.5 h-3.5" />
            <span>Map Nodes</span>
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-medium text-zinc-400 mb-1">
            Active ComfyUI Workflow
          </label>
          <select
            value={selectedWorkflowId ?? ''}
            onChange={(e) => onSelectWorkflowId(Number(e.target.value) || null)}
            className="w-full px-3 py-2 text-xs bg-zinc-950 border border-zinc-800 rounded-lg text-zinc-100"
          >
            {workflows.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name}
                {w.isDefault && !w.name.toLowerCase().includes('(default)')
                  ? ' (Default)'
                  : ''}
              </option>
            ))}
          </select>
        </div>

        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="text-xs font-medium text-zinc-400">
              Diffusion Model (Node #30_10 <code className="text-indigo-300">unet_name</code>)
            </label>
            {workflowDefaultCheckpoint && (
              <button
                type="button"
                onClick={() => onChangeCheckpoint(workflowDefaultCheckpoint)}
                className="text-[10px] text-indigo-400 hover:text-indigo-300 font-mono cursor-pointer"
                title="Reset to workflow default model"
              >
                Reset Default
              </button>
            )}
          </div>
          <input
            type="text"
            list="diffusion-models-datalist"
            value={selectedCheckpoint}
            onChange={(e) => onChangeCheckpoint(e.target.value)}
            placeholder={
              workflowDefaultCheckpoint
                ? `Default: ${workflowDefaultCheckpoint}`
                : 'Keep workflow default or select model...'
            }
            className="w-full px-3 py-2 text-xs font-mono bg-zinc-950 border border-zinc-800 rounded-lg text-zinc-100"
          />
          <datalist id="diffusion-models-datalist">
            {availableDiffusionModels.map((m) => (
              <option key={m} value={m} />
            ))}
          </datalist>
        </div>
      </div>

      {workflowMapping && (
        <div className="p-2.5 bg-zinc-950 border border-zinc-800/80 rounded-lg text-[11px] text-zinc-400 font-mono flex flex-wrap items-center gap-x-2 gap-y-1">
          <span>
            Prompt: {workflowMapping.positivePromptNodeId ? `#${workflowMapping.positivePromptNodeId} (${workflowMapping.positivePromptField})` : 'None'}
          </span>
          <span>·</span>
          <span>
            Trigger: {workflowMapping.triggerWordNodeId ? `#${workflowMapping.triggerWordNodeId} (${workflowMapping.triggerWordField || 'string_b'})` : 'None'}
          </span>
          <span>·</span>
          <span>
            LoRA: {workflowMapping.loraNodeIds.length > 0 ? workflowMapping.loraNodeIds.map((id) => `#${id}`).join(', ') : 'Auto'}
          </span>
          <span>·</span>
          <span>
            Resolution: {workflowMapping.latentNodeId ? `#${workflowMapping.latentNodeId}` : 'None'}
          </span>
          <span>·</span>
          <span>
            Seed: {workflowMapping.seedNodeId ? `#${workflowMapping.seedNodeId}` : 'None'}
          </span>
          <span>·</span>
          <span>
            Model: {workflowMapping.checkpointNodeId ? `#${workflowMapping.checkpointNodeId}` : 'Default'}
          </span>
        </div>
      )}
    </section>
  );
};
