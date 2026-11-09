import React, { useEffect, useState } from 'react';
import {
  Play,
  Plus,
  Code,
  RefreshCw,
  CheckCircle2,
  AlertTriangle,
} from 'lucide-react';
import { api } from '../api/client.ts';
import { renderDependencyLabel } from './GalleryGridView.tsx';
import type {
  ImageRecord,
  ReproductionValidationResult,
  WorkflowLibraryItem,
} from '../shared/types.ts';

interface WorkflowLibraryViewProps {
  workflows: WorkflowLibraryItem[];
  allImages: ImageRecord[];
  onRefresh: () => Promise<void>;
  onOpenImage: (img: ImageRecord) => void;
}

/**
 * Independent Workflow Library & ComfyUI Reproduction History View.
 */
export const WorkflowLibraryView: React.FC<WorkflowLibraryViewProps> = ({
  workflows,
  allImages,
  onRefresh,
  onOpenImage,
}) => {
  const [selectedWfId, setSelectedWfId] = useState<number | null>(null);
  const [selectedWfDetail, setSelectedWfDetail] = useState<any | null>(null);
  const [reproJobs, setReproJobs] = useState<any[]>([]);
  const [validation, setValidation] = useState<ReproductionValidationResult | null>(null);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);

  // Import/Create Workflow Modal State
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newName, setNewName] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [newVisualJson, setNewVisualJson] = useState('');
  const [newApiJson, setNewApiJson] = useState('');

  const loadJobs = async () => {
    try {
      const res = await api.listReproductionJobs();
      setReproJobs(res.items || []);
    } catch {
      // ignore
    }
  };

  useEffect(() => {
    loadJobs();
  }, []);

  useEffect(() => {
    if (selectedWfId) {
      api
        .getWorkflow(selectedWfId)
        .then((res) => setSelectedWfDetail(res.workflow))
        .catch(() => {});
      setValidation(null);
      setStatusMsg(null);
    } else {
      setSelectedWfDetail(null);
    }
  }, [selectedWfId]);

  const handleSaveNewWorkflow = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName.trim()) return;
    await api.saveWorkflow({
      name: newName.trim(),
      description: newDesc.trim(),
      visualWorkflowJson: newVisualJson.trim() || null,
      apiWorkflowJson: newApiJson.trim() || null,
    });
    setNewName('');
    setNewDesc('');
    setNewVisualJson('');
    setNewApiJson('');
    setShowCreateModal(false);
    await onRefresh();
  };

  const handleValidateWorkflow = async (wfId: number) => {
    const res = await api.validateReproduction({ workflowId: wfId });
    setValidation(res);
  };

  const handleSubmitWorkflow = async (wfId: number) => {
    try {
      const res = await api.submitReproduction({ workflowId: wfId });
      setStatusMsg(`Submitted to ComfyUI (Prompt ID: ${res.job.comfyui_prompt_id})`);
      await loadJobs();
    } catch (err: any) {
      setStatusMsg(`Submission error: ${err.message}`);
    }
  };

  return (
    <div className="px-6 py-6 max-w-7xl mx-auto space-y-8">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-display font-semibold text-zinc-100">
            Independent Workflow Library & Generation History
          </h1>
          <p className="text-xs text-zinc-400 mt-0.5">
            Workflows persist independently of generated image files. Deleting or moving an image
            never deletes its saved workflow.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setShowCreateModal(true)}
          className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg cursor-pointer"
        >
          <Plus className="w-3.5 h-3.5" />
          <span>Import / Save Workflow JSON</span>
        </button>
      </div>

      {/* Workflows Grid & Inspector */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <div className="lg:col-span-6 space-y-3">
          <h2 className="text-sm font-display font-semibold text-zinc-200">
            Stored Workflows ({workflows.length})
          </h2>
          {workflows.length === 0 ? (
            <div className="bg-zinc-900/60 border border-zinc-800 rounded-xl p-8 text-center text-xs text-zinc-400">
              No workflows stored yet. Import a ComfyUI workflow JSON or index PNGs with embedded workflows.
            </div>
          ) : (
            <div className="space-y-2.5">
              {workflows.map((wf) => {
                const active = selectedWfId === wf.id;
                return (
                  <div
                    key={wf.id}
                    onClick={() => setSelectedWfId(wf.id)}
                    className={`p-4 rounded-xl border transition-colors cursor-pointer space-y-1.5 text-xs ${
                      active
                        ? 'bg-zinc-900 border-indigo-500'
                        : 'bg-zinc-900/70 border-zinc-800 hover:border-zinc-700'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-display font-semibold text-zinc-100">
                        {wf.name}
                      </span>
                      <span className="font-mono text-[11px] text-zinc-400">
                        {wf.isSavedLibrary ? 'Saved Library' : 'Auto-Extracted'} · {wf.imageCount} imgs
                      </span>
                    </div>
                    {wf.description && <p className="text-zinc-400">{wf.description}</p>}
                    <div className="flex flex-wrap items-center gap-2 text-[11px] text-zinc-400 font-mono">
                      <span>Visual JSON: {wf.hasVisualWorkflow ? 'Yes' : 'No'}</span>
                      <span aria-hidden="true">·</span>
                      <span>API JSON: {wf.hasApiWorkflow ? 'Yes' : 'No'}</span>
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

        {/* Selected Workflow Detail & Reproduction Panel */}
        <div className="lg:col-span-6">
          {selectedWfDetail ? (
            <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5 space-y-4 text-xs">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <h3 className="text-base font-display font-semibold text-zinc-100">
                    {selectedWfDetail.name}
                  </h3>
                  <p className="text-zinc-400 font-mono text-[11px]">
                    SHA256: {selectedWfDetail.workflow_hash}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {!selectedWfDetail.is_saved_library && (
                    <button
                      type="button"
                      onClick={async () => {
                        await api.saveWorkflow({
                          id: selectedWfDetail.id,
                          name: selectedWfDetail.name,
                          description: 'Promoted to Saved Workflow Library',
                        });
                        await onRefresh();
                      }}
                      className="px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 rounded-lg cursor-pointer"
                    >
                      Keep in Library
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => handleValidateWorkflow(selectedWfDetail.id)}
                    className="inline-flex items-center gap-1.5 px-3.5 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white font-medium rounded-lg cursor-pointer"
                  >
                    <Play className="w-3.5 h-3.5" />
                    <span>Validate & Reproduce</span>
                  </button>
                </div>
              </div>

              {validation && (
                <div className="p-3.5 bg-zinc-950 border border-zinc-800 rounded-lg space-y-2.5">
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-zinc-200">
                      Format: {validation.workflowFormat}
                    </span>
                    {renderDependencyLabel(validation.readinessStatus)}
                  </div>
                  {validation.warnings.map((w, idx) => (
                    <div key={idx} className="text-amber-300 flex items-center gap-1.5">
                      <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                      <span>{w}</span>
                    </div>
                  ))}
                  <div className="flex justify-end">
                    <button
                      type="button"
                      disabled={!validation.canSubmit}
                      onClick={() => handleSubmitWorkflow(selectedWfDetail.id)}
                      className="px-3.5 py-1.5 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-white font-medium rounded cursor-pointer"
                    >
                      Submit to ComfyUI
                    </button>
                  </div>
                  {statusMsg && <p className="text-indigo-300 font-mono">{statusMsg}</p>}
                </div>
              )}

              {/* Associated Images for this Workflow */}
              <div className="space-y-2">
                <span className="font-medium text-zinc-300 block">
                  Associated Images Using This Workflow
                </span>
                <div className="grid grid-cols-4 gap-2">
                  {allImages
                    .filter((i) => i.workflowId === selectedWfDetail.id)
                    .slice(0, 8)
                    .map((img) => (
                      <div
                        key={img.id}
                        onClick={() => onOpenImage(img)}
                        className="aspect-square bg-zinc-950 border border-zinc-800 rounded overflow-hidden cursor-pointer"
                      >
                        <img
                          src={img.thumbnailUrl}
                          alt={img.filename}
                          className="w-full h-full object-cover"
                        />
                      </div>
                    ))}
                </div>
              </div>

              <div className="space-y-1.5">
                <span className="font-medium text-zinc-300 flex items-center gap-1.5">
                  <Code className="w-3.5 h-3.5" />
                  <span>Immutable Stored Workflow JSON</span>
                </span>
                <pre className="p-3 bg-zinc-950 border border-zinc-800 rounded-lg font-mono text-[11px] text-zinc-300 max-h-64 overflow-auto">
                  {selectedWfDetail.api_workflow_json ||
                    selectedWfDetail.visual_workflow_json ||
                    '{}'}
                </pre>
              </div>
            </div>
          ) : (
            <div className="bg-zinc-900/50 border border-zinc-800 rounded-xl p-10 text-center text-xs text-zinc-500">
              Select a workflow on the left to inspect its immutable JSON graph, associated images,
              and ComfyUI reproduction readiness.
            </div>
          )}
        </div>
      </div>

      {/* Historical Reproduction Jobs Table */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-sm font-display font-semibold text-zinc-100">
              ComfyUI Reproduction & Execution History
            </h2>
            <p className="text-xs text-zinc-400">
              Tracks every workflow reproduction launched from the gallery with ComfyUI prompt IDs and
              execution states.
            </p>
          </div>
          <button
            type="button"
            onClick={loadJobs}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs bg-zinc-950 border border-zinc-800 rounded-lg text-zinc-300 hover:text-white cursor-pointer"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            <span>Refresh History</span>
          </button>
        </div>

        {reproJobs.length === 0 ? (
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
                {reproJobs.map((j) => (
                  <tr key={j.id}>
                    <td className="py-2.5 px-3 text-zinc-300">#{j.id}</td>
                    <td className="py-2.5 px-3 font-sans text-zinc-200">
                      {j.workflow_name || `Workflow #${j.workflow_id}`}
                      {j.source_filename ? ` (${j.source_filename})` : ''}
                    </td>
                    <td className="py-2.5 px-3 text-zinc-400">{j.comfyui_prompt_id || '—'}</td>
                    <td className="py-2.5 px-3">{j.readiness_status}</td>
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

      {/* Import / Save Workflow Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4">
          <form
            onSubmit={handleSaveNewWorkflow}
            className="bg-zinc-900 border border-zinc-800 rounded-xl max-w-lg w-full p-6 space-y-4 text-xs"
          >
            <h3 className="text-base font-display font-semibold text-zinc-100">
              Save Independent Workflow to Library
            </h3>
            <div>
              <label className="block text-zinc-300 mb-1">Workflow Name *</label>
              <input
                type="text"
                required
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="e.g. Portrait Studio Lighting v3"
                className="w-full px-3 py-2 bg-zinc-950 border border-zinc-800 rounded-lg text-zinc-100"
              />
            </div>
            <div>
              <label className="block text-zinc-300 mb-1">Description</label>
              <input
                type="text"
                value={newDesc}
                onChange={(e) => setNewDesc(e.target.value)}
                className="w-full px-3 py-2 bg-zinc-950 border border-zinc-800 rounded-lg text-zinc-100"
              />
            </div>
            <div>
              <label className="block text-zinc-300 mb-1">
                API-Format Workflow JSON (Prompt Graph)
              </label>
              <textarea
                rows={4}
                value={newApiJson}
                onChange={(e) => setNewApiJson(e.target.value)}
                placeholder='{"3": {"class_type": "KSampler", "inputs": {...}}}'
                className="w-full p-2.5 bg-zinc-950 border border-zinc-800 rounded-lg font-mono text-zinc-200"
              />
            </div>
            <div>
              <label className="block text-zinc-300 mb-1">
                Visual ComfyUI Workflow JSON (Optional)
              </label>
              <textarea
                rows={4}
                value={newVisualJson}
                onChange={(e) => setNewVisualJson(e.target.value)}
                placeholder='{"nodes": [...], "links": [...]}'
                className="w-full p-2.5 bg-zinc-950 border border-zinc-800 rounded-lg font-mono text-zinc-200"
              />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setShowCreateModal(false)}
                className="px-3.5 py-2 bg-zinc-800 text-zinc-300 rounded-lg cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white font-medium rounded-lg cursor-pointer"
              >
                Save Workflow
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};
