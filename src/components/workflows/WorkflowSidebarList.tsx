import React from 'react';
import { Star } from 'lucide-react';
import type { WorkflowLibraryItem } from '../../shared/types.ts';

export interface WorkflowSidebarListProps {
  workflows: WorkflowLibraryItem[];
  selectedWfId: number | null;
  onSelectWorkflow: (id: number) => void;
  onSetDefault: (id: number, e?: React.MouseEvent) => void;
}

/**
 * Sidebar list displaying available workflows, default indicators,
 * character links, and primary selection states.
 */
export const WorkflowSidebarList: React.FC<WorkflowSidebarListProps> = ({
  workflows,
  selectedWfId,
  onSelectWorkflow,
  onSetDefault,
}) => {
  return (
    <div className="space-y-3">
      <h2 className="text-sm font-display font-semibold text-zinc-200">
        Stored Workflows ({workflows.length})
      </h2>
      {workflows.length === 0 ? (
        <div className="bg-zinc-900/60 border border-zinc-800 rounded-xl p-8 text-center text-xs text-zinc-400">
          No workflows stored yet. Import a ComfyUI workflow JSON or index PNGs with embedded
          workflows.
        </div>
      ) : (
        <div className="space-y-2.5">
          {workflows.map((wf) => {
            const active = selectedWfId === wf.id;
            return (
              <div
                key={wf.id}
                onClick={() => onSelectWorkflow(wf.id)}
                className={`p-4 rounded-xl border transition-colors cursor-pointer space-y-2 text-xs ${
                  active
                    ? 'bg-zinc-900 border-indigo-500'
                    : 'bg-zinc-900/70 border-zinc-800 hover:border-zinc-700'
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="space-y-0.5">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-display font-semibold text-zinc-100">
                        {wf.name}
                      </span>
                      {wf.isDefault && (
                        <span className="inline-flex items-center gap-1 text-[11px] font-medium text-amber-300">
                          <Star className="w-3 h-3 fill-amber-400 text-amber-400" />
                          <span>Default</span>
                        </span>
                      )}
                    </div>
                    <div className="font-mono text-[11px] text-zinc-400">
                      {wf.isSavedLibrary ? 'Saved Library' : 'Auto-Extracted'} · {wf.imageCount}{' '}
                      imgs
                    </div>
                  </div>

                  {!wf.isDefault && (
                    <button
                      type="button"
                      onClick={(e) => onSetDefault(wf.id, e)}
                      className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-medium bg-zinc-800 hover:bg-zinc-700 text-zinc-200 rounded-md cursor-pointer whitespace-nowrap shrink-0"
                      title="Set as Default workflow for Quick Gen and Studio"
                    >
                      <Star className="w-3 h-3 text-zinc-400" />
                      <span>Set Default</span>
                    </button>
                  )}
                </div>

                {wf.description && (
                  <p className="text-zinc-400 line-clamp-2">{wf.description}</p>
                )}

                <div className="flex flex-wrap items-center gap-2 text-[11px] text-zinc-400 font-mono">
                  <span>API Graph: {wf.hasApiWorkflow ? 'Yes' : 'No'}</span>
                  <span aria-hidden="true">·</span>
                  <span>Visual JSON: {wf.hasVisualWorkflow ? 'Yes' : 'No'}</span>
                  <span aria-hidden="true">·</span>
                  <span>Hash: {wf.workflowHash.slice(0, 10)}</span>
                </div>

                {wf.characters.length > 0 && (
                  <div className="text-[11px] text-indigo-300">
                    Characters: {wf.characters.map((c) => `${c.name} (${c.roleLabel})`).join(' · ')}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
