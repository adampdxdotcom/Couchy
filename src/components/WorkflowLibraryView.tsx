import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  Code,
  Download,
  Play,
  RotateCcw,
  Save,
  Sliders,
} from 'lucide-react';
import { api } from '../api/client.ts';
import { renderDependencyLabel } from './GalleryGridView.tsx';
import type {
  AppToastMessage,
  ImageRecord,
  LoraExplorerItem,
  ModelInventoryItem,
  ReproductionValidationResult,
  WorkflowLibraryItem,
} from '../shared/types.ts';
import {
  filterDiffusionModels,
  filterLoraModels,
  filterVaeModels,
  filterClipModels,
  resolveDefaultWorkflow,
} from '../shared/utils.ts';
import {
  WorkflowReproductionHistory,
  type WorkflowReproJob,
} from './workflows/WorkflowReproductionHistory.tsx';
import { ExportPromptModal } from './workflows/WorkflowModals.tsx';
import { WorkflowGraphInspector } from './workflows/WorkflowGraphInspector.tsx';
import {
  applyPowerLoraEntriesToInputs,
  type PowerLoraEntry,
} from './workflows/PowerLoraLoaderEditor.tsx';

interface WorkflowLibraryViewProps {
  workflows: WorkflowLibraryItem[];
  allImages: ImageRecord[];
  models: ModelInventoryItem[];
  loras: LoraExplorerItem[];
  checkpoints: string[];
  onRefresh: () => Promise<void>;
  onOpenImage: (img: ImageRecord) => void;
  onPushToast?: (text: string, type?: AppToastMessage['type']) => void;
}

/**
 * Orchestrator view for managing, inspecting, and editing ComfyUI workflows.
 */
export const WorkflowLibraryView: React.FC<WorkflowLibraryViewProps> = ({
  workflows,
  allImages,
  models,
  loras,
  checkpoints,
  onRefresh,
  onOpenImage,
  onPushToast,
}) => {
  const [selectedWfId, setSelectedWfId] = useState<number | null>(null);
  const [selectedWfDetail, setSelectedWfDetail] = useState<any>(null);

  // Editor mode: structured graphical settings vs raw JSON
  const [editorMode, setEditorMode] = useState<'structured' | 'json'>('structured');
  const [nodeSearchFilter, setNodeSearchFilter] = useState('');

  // Editable Draft State
  const [draftName, setDraftName] = useState('');
  const [draftDesc, setDraftDesc] = useState('');
  const [draftGraph, setDraftGraph] = useState<Record<string, any> | null>(null);
  const [rawJsonText, setRawJsonText] = useState('');
  const [rawJsonError, setRawJsonError] = useState<string | null>(null);

  // Baseline snapshot for tracking unsaved dirty state
  const [baselineSnapshot, setBaselineSnapshot] = useState<{
    name: string;
    desc: string;
    jsonStr: string;
  } | null>(null);

  const [isSaving, setIsSaving] = useState(false);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [showExportPromptModal, setShowExportPromptModal] = useState(false);

  // Validation & Test Run state
  const [validation, setValidation] = useState<ReproductionValidationResult | null>(null);
  const [reproJobs, setReproJobs] = useState<WorkflowReproJob[]>([]);

  // Auto-select default or first workflow on initial load
  useEffect(() => {
    if (selectedWfId === null && workflows.length > 0) {
      const def = resolveDefaultWorkflow(workflows);
      if (def) setSelectedWfId(def.id);
    }
  }, [workflows, selectedWfId]);

  // Categorized model & LoRA options from shared helpers
  const diffusionModelOptions = useMemo(
    () => filterDiffusionModels(models, checkpoints),
    [checkpoints, models]
  );
  const loraOptions = useMemo(() => filterLoraModels(loras, models), [loras, models]);
  const vaeOptions = useMemo(() => filterVaeModels(models), [models]);
  const clipOptions = useMemo(() => filterClipModels(models), [models]);

  const loadJobs = useCallback(async () => {
    try {
      const res = await api.listReproductionJobs();
      setReproJobs((res.items || []) as WorkflowReproJob[]);
    } catch (err: any) {
      console.warn('Failed to load reproduction jobs:', err);
    }
  }, []);

  useEffect(() => {
    loadJobs();
  }, [loadJobs]);

  // Load detailed workflow record when selection changes
  const loadWorkflowDetail = useCallback(async (id: number) => {
    try {
      const res = await api.getWorkflow(id);
      const wfRow = res.workflow;
      setSelectedWfDetail(wfRow);
      setDraftName(wfRow.name || '');
      setDraftDesc(wfRow.description || '');

      const rawStr = wfRow.api_workflow_json || wfRow.visual_workflow_json || '{}';
      let parsedGraph: Record<string, any> = {};
      let formattedJson = rawStr;
      try {
        const parsed = JSON.parse(rawStr);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          parsedGraph = parsed;
        }
        formattedJson = JSON.stringify(parsed, null, 2);
      } catch {
        // Fallback for non-JSON strings
      }

      setDraftGraph(parsedGraph);
      setRawJsonText(formattedJson);
      setRawJsonError(null);
      setValidation(null);
      setStatusMsg(null);

      setBaselineSnapshot({
        name: wfRow.name || '',
        desc: wfRow.description || '',
        jsonStr: formattedJson,
      });
    } catch (err: any) {
      setStatusMsg(`Failed to load workflow: ${err.message}`);
    }
  }, []);

  useEffect(() => {
    if (selectedWfId !== null) {
      loadWorkflowDetail(selectedWfId);
    }
  }, [selectedWfId, loadWorkflowDetail]);

  const isDirty = useMemo(() => {
    if (!baselineSnapshot) return false;
    return (
      draftName.trim() !== baselineSnapshot.name.trim() ||
      draftDesc.trim() !== baselineSnapshot.desc.trim() ||
      rawJsonText.trim() !== baselineSnapshot.jsonStr.trim()
    );
  }, [draftName, draftDesc, rawJsonText, baselineSnapshot]);

  // Update a single node input inside draftGraph and sync rawJsonText
  const handleNodeFieldChange = (nodeId: string, fieldKey: string, value: any) => {
    setDraftGraph((prev) => {
      if (!prev || !prev[nodeId]) return prev;
      const next = {
        ...prev,
        [nodeId]: {
          ...prev[nodeId],
          inputs: {
            ...(prev[nodeId].inputs || {}),
            [fieldKey]: value,
          },
        },
      };
      setRawJsonText(JSON.stringify(next, null, 2));
      setRawJsonError(null);
      return next;
    });
  };

  // Update Power Lora Loader entries for a node
  const handlePowerLoraChange = (nodeId: string, entries: PowerLoraEntry[]) => {
    setDraftGraph((prev) => {
      if (!prev || !prev[nodeId]) return prev;
      const updatedInputs = applyPowerLoraEntriesToInputs(prev[nodeId].inputs || {}, entries);
      const next = {
        ...prev,
        [nodeId]: {
          ...prev[nodeId],
          inputs: updatedInputs,
        },
      };
      setRawJsonText(JSON.stringify(next, null, 2));
      setRawJsonError(null);
      return next;
    });
  };

  // Directly append a new editable LoRA slot to a Power Lora Loader node
  const handleAddPowerLoraSlot = (nodeId: string, currentEntries: PowerLoraEntry[]) => {
    const usedLoras = new Set(currentEntries.map((e) => e.lora));
    const defaultLora = loraOptions.find((opt) => !usedLoras.has(opt)) || loraOptions[0] || '';
    const next: PowerLoraEntry[] = [
      ...currentEntries,
      {
        key: `lora_${currentEntries.length + 1}`,
        on: true,
        lora: defaultLora,
        strength: 1.0,
      },
    ];
    handlePowerLoraChange(nodeId, next);
  };

  // Revert all draft inputs to the snapshot
  const handleCancelEdits = () => {
    if (!baselineSnapshot) return;
    setDraftName(baselineSnapshot.name);
    setDraftDesc(baselineSnapshot.desc);
    setRawJsonText(baselineSnapshot.jsonStr);
    setRawJsonError(null);
    try {
      const parsed = JSON.parse(baselineSnapshot.jsonStr);
      setDraftGraph(parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {});
    } catch {
      setDraftGraph({});
    }
  };

  // Keep structured draftGraph in sync when raw JSON text is edited
  const handleRawJsonChange = (val: string) => {
    setRawJsonText(val);
    try {
      const parsed = JSON.parse(val);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        setDraftGraph(parsed);
      }
      setRawJsonError(null);
    } catch (err: any) {
      setRawJsonError(err?.message || 'Invalid JSON syntax');
    }
  };

  // Persist updated workflow settings and JSON graph to server
  const handleSaveWorkflow = async (): Promise<boolean> => {
    if (!selectedWfDetail) return false;
    setIsSaving(true);
    setStatusMsg(null);

    let finalJsonString = rawJsonText;
    try {
      const parsed = JSON.parse(rawJsonText);
      finalJsonString = JSON.stringify(parsed, null, 2);
    } catch {
      setStatusMsg('Cannot save: Workflow JSON has syntax errors.');
      onPushToast?.('Workflow JSON has syntax errors', 'error');
      setIsSaving(false);
      return false;
    }

    try {
      const isVisualOnly =
        !selectedWfDetail.api_workflow_json && Boolean(selectedWfDetail.visual_workflow_json);

      await api.saveWorkflow({
        id: selectedWfDetail.id,
        name: draftName.trim() || selectedWfDetail.name,
        description: draftDesc.trim(),
        isDefault: Boolean(selectedWfDetail.is_default),
        apiWorkflowJson: isVisualOnly ? selectedWfDetail.api_workflow_json : finalJsonString,
        visualWorkflowJson: isVisualOnly ? finalJsonString : selectedWfDetail.visual_workflow_json,
      });

      setStatusMsg('Workflow saved successfully!');
      onPushToast?.(`Saved workflow "${draftName || selectedWfDetail.name}"`, 'success');
      await onRefresh();
      await loadWorkflowDetail(selectedWfDetail.id);
      return true;
    } catch (err: any) {
      setStatusMsg(`Failed to save workflow: ${err.message}`);
      onPushToast?.(`Save failed: ${err.message}`, 'error');
      return false;
    } finally {
      setIsSaving(false);
    }
  };

  const triggerWorkflowJsonDownload = (jsonContent: string, wfName: string) => {
    const safeSlug = (wfName || 'workflow')
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, '_')
      .replace(/^_+|_+$/g, '');
    const blob = new Blob([jsonContent], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${safeSlug}.json`;
    a.click();
    URL.revokeObjectURL(url);
    onPushToast?.(`Exported ${safeSlug}.json`, 'info');
  };

  const handleExportClick = () => {
    if (isDirty) {
      setShowExportPromptModal(true);
    } else {
      triggerWorkflowJsonDownload(rawJsonText, draftName);
    }
  };

  const handleValidateWorkflow = async (wfId: number) => {
    try {
      const res = await api.validateReproduction({ workflowId: wfId });
      setValidation(res);
      onPushToast?.(`Validation format: ${res.workflowFormat}`, 'info');
    } catch (err: any) {
      onPushToast?.(`Validation error: ${err.message}`, 'error');
    }
  };

  const handleSubmitWorkflow = async (wfId: number) => {
    try {
      const res = await api.submitReproduction({ workflowId: wfId });
      onPushToast?.(
        `Submitted to ComfyUI (Prompt ID: ${res.job?.comfyui_prompt_id || res.job?.promptId || 'queued'})`,
        'success'
      );
      await loadJobs();
      await onRefresh();
    } catch (err: any) {
      onPushToast?.(`Submission failed: ${err.message}`, 'error');
    }
  };

  const displayWorkflowTitle = (draftName || selectedWfDetail?.name || 'System Workflow')
    .replace(/\s*\(Default\)\s*/gi, '')
    .trim();

  return (
    <div className="px-6 py-6 max-w-4xl mx-auto space-y-6">
      {/* Top Header */}
      <div className="text-center space-y-1">
        <h1 className="text-xl font-display font-semibold text-zinc-100">System Workflow</h1>
        <p className="text-xs text-zinc-400">
          Configure the primary Krea2_turbo workflow nodes, assign diffusion models and LoRAs from
          discovered local files, or export JSON.
        </p>
      </div>

      {/* Centered Active Workflow Controls */}
      <div>
        {selectedWfDetail ? (
          <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5 space-y-5 text-xs">
            {/* Action Bar */}
            <div className="flex flex-wrap items-center justify-between gap-3 pb-4 border-b border-zinc-800">
              <div className="space-y-0.5 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <h3 className="text-base font-display font-semibold text-zinc-100 truncate">
                    {displayWorkflowTitle}
                  </h3>
                  {isDirty && (
                    <span className="text-[11px] font-medium text-amber-400">
                      · Unsaved Changes
                    </span>
                  )}
                </div>
                <p className="text-zinc-400 font-mono text-[11px]">
                  ID #{selectedWfDetail.id} · SHA256: {selectedWfDetail.workflow_hash.slice(0, 16)}…
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-2 shrink-0">
                <button
                  type="button"
                  disabled={!isDirty || isSaving}
                  onClick={handleCancelEdits}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 disabled:opacity-40 text-zinc-200 font-medium rounded-lg cursor-pointer whitespace-nowrap shrink-0"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  <span>Cancel</span>
                </button>

                <button
                  type="button"
                  disabled={isSaving || Boolean(rawJsonError)}
                  onClick={handleSaveWorkflow}
                  className="inline-flex items-center gap-1.5 px-3.5 py-1.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white font-medium rounded-lg cursor-pointer whitespace-nowrap shrink-0"
                >
                  <Save className="w-3.5 h-3.5" />
                  <span>{isSaving ? 'Saving…' : 'Save'}</span>
                </button>

                <button
                  type="button"
                  onClick={handleExportClick}
                  className="inline-flex items-center gap-1.5 px-3.5 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white font-medium rounded-lg cursor-pointer whitespace-nowrap shrink-0"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>Export</span>
                </button>
              </div>
            </div>

            {statusMsg && (
              <div className="px-3 py-2 bg-zinc-950 border border-zinc-800 rounded-lg text-indigo-300 font-mono text-[11px] flex items-center justify-between">
                <span>{statusMsg}</span>
                <button
                  type="button"
                  onClick={() => setStatusMsg(null)}
                  className="text-zinc-500 hover:text-zinc-300 cursor-pointer"
                >
                  Dismiss
                </button>
              </div>
            )}

              {/* Mode Switcher & Test Run */}
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-1 p-1 bg-zinc-950 border border-zinc-800 rounded-lg">
                  <button
                    type="button"
                    onClick={() => setEditorMode('structured')}
                    className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                      editorMode === 'structured'
                        ? 'bg-indigo-600 text-white'
                        : 'text-zinc-400 hover:text-zinc-200'
                    }`}
                  >
                    <Sliders className="w-3.5 h-3.5" />
                    <span>Structured Node Settings</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setEditorMode('json')}
                    className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                      editorMode === 'json'
                        ? 'bg-indigo-600 text-white'
                        : 'text-zinc-400 hover:text-zinc-200'
                    }`}
                  >
                    <Code className="w-3.5 h-3.5" />
                    <span>Raw JSON Editor</span>
                  </button>
                </div>

                <button
                  type="button"
                  onClick={() => handleValidateWorkflow(selectedWfDetail.id)}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 font-medium rounded-lg cursor-pointer whitespace-nowrap shrink-0"
                >
                  <Play className="w-3.5 h-3.5 text-indigo-400" />
                  <span>Validate & Test Run</span>
                </button>
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
                </div>
              )}

              {/* Sub-Panel: Structured Node Inspector OR Raw JSON */}
              {editorMode === 'structured' ? (
                draftGraph ? (
                  <WorkflowGraphInspector
                    draftGraph={draftGraph}
                    nodeSearchFilter={nodeSearchFilter}
                    onChangeSearchFilter={setNodeSearchFilter}
                    diffusionModelOptions={diffusionModelOptions}
                    loraOptions={loraOptions}
                    vaeOptions={vaeOptions}
                    clipOptions={clipOptions}
                    onNodeFieldChange={handleNodeFieldChange}
                    onPowerLoraChange={handlePowerLoraChange}
                    onAddPowerLoraSlot={handleAddPowerLoraSlot}
                  />
                ) : (
                  <p className="text-xs text-zinc-500 italic p-4 text-center">
                    No structured graph data available for this workflow.
                  </p>
                )
              ) : (
                /* RAW JSON EDITOR TAB */
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="font-medium text-zinc-300 flex items-center gap-1.5">
                      <Code className="w-3.5 h-3.5 text-indigo-400" />
                      <span>Editable Workflow JSON</span>
                    </span>
                    {rawJsonError ? (
                      <span className="text-rose-400 font-mono text-[11px]">{rawJsonError}</span>
                    ) : (
                      <span className="text-emerald-400 font-mono text-[11px]">Valid JSON</span>
                    )}
                  </div>
                  <textarea
                    rows={22}
                    value={rawJsonText}
                    onChange={(e) => handleRawJsonChange(e.target.value)}
                    className="w-full p-3 bg-zinc-950 border border-zinc-800 rounded-lg font-mono text-[11px] text-zinc-200 focus:border-indigo-500 focus:outline-none"
                  />
                </div>
              )}

              {/* Associated Images */}
              <div className="space-y-2 pt-2 border-t border-zinc-800">
                <span className="font-medium text-zinc-300 block">
                  Associated Images Using This Workflow
                </span>
                <div className="grid grid-cols-4 sm:grid-cols-6 gap-2">
                  {allImages
                    .filter((i) => i.workflowId === selectedWfDetail.id)
                    .slice(0, 6)
                    .map((img) => (
                      <div
                        key={img.id}
                        onClick={() => onOpenImage(img)}
                        className="aspect-square bg-zinc-950 border border-zinc-800 rounded overflow-hidden cursor-pointer"
                      >
                        <img
                          src={img.thumbnailUrl}
                          alt={img.filename}
                          referrerPolicy="no-referrer"
                          className="w-full h-full object-cover"
                        />
                      </div>
                    ))}
                </div>
              </div>
            </div>
          ) : (
            <div className="bg-zinc-900/50 border border-zinc-800 rounded-xl p-10 text-center text-xs text-zinc-500">
              Loading system workflow configuration…
            </div>
          )}
      </div>

      {/* Historical Execution History Table */}
      <WorkflowReproductionHistory jobs={reproJobs} onRefresh={loadJobs} />

      {/* Export Unsaved Changes Confirmation Modal */}
      <ExportPromptModal
        isOpen={showExportPromptModal}
        draftName={displayWorkflowTitle}
        onClose={() => setShowExportPromptModal(false)}
        onExportWithoutSaving={() => {
          setShowExportPromptModal(false);
          triggerWorkflowJsonDownload(rawJsonText, displayWorkflowTitle);
        }}
        onSaveAndExport={async () => {
          const saved = await handleSaveWorkflow();
          if (saved) {
            setShowExportPromptModal(false);
            triggerWorkflowJsonDownload(rawJsonText, displayWorkflowTitle);
          }
        }}
      />
    </div>
  );
};
