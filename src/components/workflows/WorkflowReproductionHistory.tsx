import React from 'react';
import { CheckCircle2, RefreshCw } from 'lucide-react';

export interface WorkflowReproJob {
  id: number;
  workflow_id: number;
  workflow_name?: string;
  source_filename?: string;
  comfyui_prompt_id?: string;
  readiness_status?: string;
  status: 'pending' | 'submitted' | 'completed' | 'failed';
  execution_error?: string | null;
  submitted_at: string;
}

export interface WorkflowReproductionHistoryProps {
  jobs: WorkflowReproJob[];
  onRefresh: () => void;
}

/**
 * Historical ComfyUI reproduction & execution queue history table.
 */
export const WorkflowReproductionHistory: React.FC<WorkflowReproductionHistoryProps> = ({
  jobs,
  onRefresh,
}) => {
  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-sm font-display font-semibold text-zinc-100">
            ComfyUI Reproduction & Execution History
          </h2>
          <p className="text-xs text-zinc-400">
            Tracks every workflow reproduction launched from the gallery with ComfyUI prompt IDs
            and execution states.
          </p>
        </div>
        <button
          type="button"
          onClick={onRefresh}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs bg-zinc-950 border border-zinc-800 rounded-lg text-zinc-300 hover:text-white cursor-pointer"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          <span>Refresh History</span>
        </button>
      </div>

      {jobs.length === 0 ? (
        <p className="text-xs text-zinc-500">No workflow reproductions submitted yet.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="border-b border-zinc-800 text-zinc-400">
              <tr>
                <th className="py-2.5 px-3">Job ID</th>
                <th className="py-2.5 px-3">Workflow / Source Image</th>
                <th className="py-2.5 px-3">ComfyUI Prompt ID</th>
                <th className="py-2.5 px-3">Readiness</th>
                <th className="py-2.5 px-3">Execution Status</th>
                <th className="py-2.5 px-3">Submitted At</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800/60 font-mono tabular-nums">
              {jobs.map((j) => (
                <tr key={j.id}>
                  <td className="py-2.5 px-3 text-zinc-300">#{j.id}</td>
                  <td className="py-2.5 px-3 font-sans text-zinc-200">
                    {j.workflow_name || `Workflow #${j.workflow_id}`}
                    {j.source_filename ? ` (${j.source_filename})` : ''}
                  </td>
                  <td className="py-2.5 px-3 text-zinc-400">{j.comfyui_prompt_id || '—'}</td>
                  <td className="py-2.5 px-3">{j.readiness_status || '—'}</td>
                  <td className="py-2.5 px-3">
                    {j.status === 'completed' ? (
                      <span className="inline-flex items-center gap-1 text-emerald-400">
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        <span>Completed</span>
                      </span>
                    ) : j.status === 'failed' ? (
                      <span className="text-rose-400" title={j.execution_error || ''}>
                        Failed: {j.execution_error || 'Error'}
                      </span>
                    ) : (
                      <span className="text-sky-400">{j.status}</span>
                    )}
                  </td>
                  <td className="py-2.5 px-3 text-zinc-400">{j.submitted_at}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};
