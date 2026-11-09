import React, { useEffect, useState } from 'react';
import { Check, Plus, RefreshCw, Settings2, Upload, X } from 'lucide-react';
import { api } from '../api/client.ts';
import type {
  WorkflowLibraryItem,
  WorkflowNodeMapping,
  WorkflowNodeSlotInfo,
} from '../shared/types.ts';

interface NodeMapperModalProps {
  workflowId: number | null;
  workflows: WorkflowLibraryItem[];
  initialTab?: 'map' | 'import';
  onClose: () => void;
  onSavedMapping: (workflowId: number, mapping: WorkflowNodeMapping) => void;
  onWorkflowCreated: (newWorkflowId: number) => void;
}

export const NodeMapperModal: React.FC<NodeMapperModalProps> = ({
  workflowId,
  workflows,
  initialTab = 'map',
  onClose,
  onSavedMapping,
  onWorkflowCreated,
}) => {
  const [activeTab, setActiveTab] = useState<'map' | 'import'>(
    workflowId ? initialTab : 'import'
  );
  const [selectedWfId, setSelectedWfId] = useState<number | null>(workflowId);
  const [nodes, setNodes] = useState<WorkflowNodeSlotInfo[]>([]);
  const [mapping, setMapping] = useState<WorkflowNodeMapping | null>(null);
  const [hasValidGraph, setHasValidGraph] = useState(true);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);

  // Import new workflow state
  const [newWfName, setNewWfName] = useState('');
  const [newWfDesc, setNewWfDesc] = useState('');
  const [newWfJson, setNewWfJson] = useState('');
  const [importError, setImportError] = useState<string | null>(null);

  useEffect(() => {
    if (!selectedWfId) return;
    setLoading(true);
    setFeedback(null);
    api
      .getWorkflowMapping(selectedWfId)
      .then((res) => {
        setMapping(res.mapping);
        setNodes(res.nodes || []);
        setHasValidGraph(res.hasValidApiGraph);
      })
      .catch((err) => {
        setFeedback(`Error loading workflow mapping: ${err.message}`);
      })
      .finally(() => setLoading(false));
  }, [selectedWfId]);

  const handleSaveMapping = async () => {
    if (!selectedWfId || !mapping) return;
    setSaving(true);
    setFeedback(null);
    try {
      const res = await api.saveWorkflowMapping(selectedWfId, mapping);
      setMapping(res.mapping);
      setFeedback('Node mapping saved. Couchy will use these slots when dispatching prompts.');
      onSavedMapping(selectedWfId, res.mapping);
    } catch (err: any) {
      setFeedback(`Failed to save mapping: ${err.message}`);
    } finally {
      setSaving(false);
    }
  };

  const handleImportWorkflow = async (e: React.FormEvent) => {
    e.preventDefault();
    setImportError(null);
    if (!newWfName.trim() || !newWfJson.trim()) {
      setImportError('Please provide a workflow name and paste your ComfyUI API JSON.');
      return;
    }

    try {
      const parsed = JSON.parse(newWfJson);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed.nodes)) {
        setImportError(
          'This JSON looks like a visual graph rather than ComfyUI API format. In ComfyUI, enable Dev Mode Options and click "Save (API Format)".'
        );
        return;
      }
    } catch {
      setImportError('Invalid JSON syntax. Please paste valid ComfyUI API JSON.');
      return;
    }

    setSaving(true);
    try {
      const res = await api.saveWorkflow({
        name: newWfName.trim(),
        description: newWfDesc.trim() || 'Imported in Generation Studio',
        apiWorkflowJson: newWfJson.trim(),
      });
      const createdId = res.workflow.id;
      onWorkflowCreated(createdId);
      setSelectedWfId(createdId);
      setActiveTab('map');
      setNewWfName('');
      setNewWfDesc('');
      setNewWfJson('');
    } catch (err: any) {
      setImportError(err.message || 'Failed to save workflow');
    } finally {
      setSaving(false);
    }
  };

  const getFieldsForNode = (nodeId: string | null): string[] => {
    if (!nodeId) return ['text', 'seed', 'noise_seed', 'aspect_ratio', 'megapixels', 'width', 'height'];
    const found = nodes.find((n) => n.nodeId === nodeId);
    return found && found.inputFields.length > 0
      ? found.inputFields
      : ['text', 'aspect_ratio', 'megapixels'];
  };

  const toggleLoraNode = (nodeId: string) => {
    if (!mapping) return;
    const current = new Set(mapping.loraNodeIds || []);
    if (current.has(nodeId)) current.delete(nodeId);
    else current.add(nodeId);
    setMapping({ ...mapping, loraNodeIds: Array.from(current) });
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-zinc-950 border border-zinc-800 rounded-xl w-full max-w-4xl max-h-[90vh] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-800">
          <div className="flex items-center gap-3">
            <Settings2 className="w-5 h-5 text-indigo-400" />
            <div>
              <h2 className="text-base font-display font-semibold text-zinc-100">
                ComfyUI Workflow Node Adaptation & Mapping
              </h2>
              <p className="text-xs text-zinc-400">
                Auto-detect or manually bind prompt, seed, aspect ratio, and LoRA slots for any workflow
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1 p-1 bg-zinc-900 border border-zinc-800 rounded-lg">
              <button
                type="button"
                onClick={() => setActiveTab('map')}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  activeTab === 'map'
                    ? 'bg-zinc-800 text-zinc-100'
                    : 'text-zinc-400 hover:text-zinc-200'
                }`}
              >
                Node Slot Mapper
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('import')}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  activeTab === 'import'
                    ? 'bg-zinc-800 text-zinc-100'
                    : 'text-zinc-400 hover:text-zinc-200'
                }`}
              >
                Import Preferred API Workflow
              </button>
            </div>

            <button
              type="button"
              onClick={onClose}
              className="p-1.5 text-zinc-400 hover:text-zinc-200 rounded-lg cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {activeTab === 'import' ? (
            <form onSubmit={handleImportWorkflow} className="space-y-4">
              <div className="p-4 bg-zinc-900/60 border border-zinc-800 rounded-lg text-xs text-zinc-300 space-y-1">
                <p className="font-medium text-zinc-100">
                  How to export your preferred workflow from ComfyUI:
                </p>
                <p className="text-zinc-400">
                  1. In ComfyUI Settings (gear icon), enable <strong>Enable Dev mode Options</strong>.
                </p>
                <p className="text-zinc-400">
                  2. Click <strong>Save (API Format)</strong> in the ComfyUI menu to download your workflow JSON, then paste or upload it below. Couchy will automatically detect and map its nodes.
                </p>
              </div>

              {importError && (
                <div className="p-3 bg-red-950/50 border border-red-800/80 rounded-lg text-xs text-red-200">
                  {importError}
                </div>
              )}

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-zinc-300 mb-1.5">
                    Workflow Name
                  </label>
                  <input
                    type="text"
                    value={newWfName}
                    onChange={(e) => setNewWfName(e.target.value)}
                    placeholder="e.g., My Preferred SDXL / Flux Character Workflow"
                    className="w-full px-3 py-2 text-sm bg-zinc-900 border border-zinc-800 rounded-lg text-zinc-100 focus:outline-none focus:border-indigo-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-zinc-300 mb-1.5">
                    Description (Optional)
                  </label>
                  <input
                    type="text"
                    value={newWfDesc}
                    onChange={(e) => setNewWfDesc(e.target.value)}
                    placeholder="Notes on checkpoint, sampler, or LoRA setup"
                    className="w-full px-3 py-2 text-sm bg-zinc-900 border border-zinc-800 rounded-lg text-zinc-100 focus:outline-none focus:border-indigo-500"
                  />
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-xs font-medium text-zinc-300">
                    ComfyUI API Format JSON
                  </label>
                  <label className="inline-flex items-center gap-1.5 text-xs text-indigo-400 hover:text-indigo-300 cursor-pointer">
                    <Upload className="w-3.5 h-3.5" />
                    <span>Load from .json file</span>
                    <input
                      type="file"
                      accept=".json,application/json"
                      className="hidden"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (!file) return;
                        if (!newWfName) {
                          setNewWfName(file.name.replace(/\.json$/i, ''));
                        }
                        const reader = new FileReader();
                        reader.onload = () => {
                          if (typeof reader.result === 'string') {
                            setNewWfJson(reader.result);
                          }
                        };
                        reader.readAsText(file);
                      }}
                    />
                  </label>
                </div>
                <textarea
                  rows={12}
                  value={newWfJson}
                  onChange={(e) => setNewWfJson(e.target.value)}
                  placeholder='{"1": {"class_type": "CheckpointLoaderSimple", "inputs": {"ckpt_name": "..."}}, ...}'
                  className="w-full px-3 py-2 text-xs font-mono bg-zinc-900 border border-zinc-800 rounded-lg text-zinc-100 focus:outline-none focus:border-indigo-500"
                />
              </div>

              <div className="flex justify-end">
                <button
                  type="submit"
                  disabled={saving}
                  className="inline-flex items-center gap-2 px-4 py-2 text-xs font-medium text-white bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 rounded-lg transition-colors cursor-pointer"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>{saving ? 'Importing...' : 'Save & Auto-Map Workflow'}</span>
                </button>
              </div>
            </form>
          ) : (
            <div className="space-y-6">
              {/* Workflow Selector */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-zinc-800">
                <div className="flex-1">
                  <label className="block text-xs font-medium text-zinc-400 mb-1">
                    Target Workflow to Map
                  </label>
                  <select
                    value={selectedWfId || ''}
                    onChange={(e) => setSelectedWfId(Number(e.target.value) || null)}
                    className="w-full px-3 py-2 text-sm bg-zinc-900 border border-zinc-800 rounded-lg text-zinc-100 focus:outline-none focus:border-indigo-500"
                  >
                    {workflows.map((w) => (
                      <option key={w.id} value={w.id}>
                        {w.name} ({w.hasApiWorkflow ? 'API Graph Ready' : 'Visual Only'})
                      </option>
                    ))}
                  </select>
                </div>

                {mapping && (
                  <div className="text-xs text-zinc-400 self-end pb-2">
                    Status:{' '}
                    <span className="text-zinc-200 font-medium">
                      {mapping.isCustomMapped ? 'Custom User Mapping Saved' : 'Auto-Detected Heuristics'}
                    </span>
                  </div>
                )}
              </div>

              {loading ? (
                <div className="py-12 text-center text-sm text-zinc-400">
                  <RefreshCw className="w-5 h-5 animate-spin mx-auto mb-2 text-indigo-400" />
                  Inspecting workflow nodes...
                </div>
              ) : !hasValidGraph || !mapping ? (
                <div className="p-6 bg-amber-950/30 border border-amber-800/60 rounded-lg text-sm text-amber-200 space-y-2">
                  <p className="font-medium">No Executable API Graph Found in This Workflow</p>
                  <p className="text-xs text-amber-300/80">
                    This workflow only contains visual node layout metadata. Switch to the{' '}
                    <strong>Import Preferred API Workflow</strong> tab above to paste or upload a ComfyUI API format JSON.
                  </p>
                </div>
              ) : (
                <>
                  {feedback && (
                    <div className="p-3 bg-indigo-950/50 border border-indigo-800/70 rounded-lg text-xs text-indigo-200">
                      {feedback}
                    </div>
                  )}

                  {/* Core Parameter Node Mapping Grid */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {/* Positive Prompt */}
                    <div className="p-4 bg-zinc-900/50 border border-zinc-800 rounded-lg space-y-3">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-semibold text-zinc-200">
                          Positive Prompt Node
                        </span>
                        <span className="text-xs text-zinc-400 font-mono">
                          {mapping.positivePromptNodeId
                            ? `Node #${mapping.positivePromptNodeId}`
                            : 'Unmapped'}
                        </span>
                      </div>
                      <div className="grid grid-cols-3 gap-2">
                        <div className="col-span-2">
                          <label className="block text-[11px] text-zinc-400 mb-1">Node</label>
                          <select
                            value={mapping.positivePromptNodeId || ''}
                            onChange={(e) =>
                              setMapping({
                                ...mapping,
                                positivePromptNodeId: e.target.value || null,
                              })
                            }
                            className="w-full px-2.5 py-1.5 text-xs bg-zinc-950 border border-zinc-800 rounded text-zinc-100"
                          >
                            <option value="">-- None --</option>
                            {nodes.map((n) => (
                              <option key={n.nodeId} value={n.nodeId}>
                                #{n.nodeId} · {n.title} ({n.classType})
                              </option>
                            ))}
                          </select>
                        </div>
                        <div>
                          <label className="block text-[11px] text-zinc-400 mb-1">Input Field</label>
                          <select
                            value={mapping.positivePromptField}
                            onChange={(e) =>
                              setMapping({ ...mapping, positivePromptField: e.target.value })
                            }
                            className="w-full px-2.5 py-1.5 text-xs bg-zinc-950 border border-zinc-800 rounded text-zinc-100 font-mono"
                          >
                            {getFieldsForNode(mapping.positivePromptNodeId).map((f) => (
                              <option key={f} value={f}>
                                {f}
                              </option>
                            ))}
                          </select>
                        </div>
                      </div>
                    </div>

                    {/* Negative Prompt */}
                    <div className="p-4 bg-zinc-900/50 border border-zinc-800 rounded-lg space-y-3">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-semibold text-zinc-200">
                          Negative Prompt Node
                        </span>
                        <span className="text-xs text-zinc-400 font-mono">
                          {mapping.negativePromptNodeId
                            ? `Node #${mapping.negativePromptNodeId}`
                            : 'Unmapped'}
                        </span>
                      </div>
                      <div className="grid grid-cols-3 gap-2">
                        <div className="col-span-2">
                          <label className="block text-[11px] text-zinc-400 mb-1">Node</label>
                          <select
                            value={mapping.negativePromptNodeId || ''}
                            onChange={(e) =>
                              setMapping({
                                ...mapping,
                                negativePromptNodeId: e.target.value || null,
                              })
                            }
                            className="w-full px-2.5 py-1.5 text-xs bg-zinc-950 border border-zinc-800 rounded text-zinc-100"
                          >
                            <option value="">-- None --</option>
                            {nodes.map((n) => (
                              <option key={n.nodeId} value={n.nodeId}>
                                #{n.nodeId} · {n.title} ({n.classType})
                              </option>
                            ))}
                          </select>
                        </div>
                        <div>
                          <label className="block text-[11px] text-zinc-400 mb-1">Input Field</label>
                          <select
                            value={mapping.negativePromptField}
                            onChange={(e) =>
                              setMapping({ ...mapping, negativePromptField: e.target.value })
                            }
                            className="w-full px-2.5 py-1.5 text-xs bg-zinc-950 border border-zinc-800 rounded text-zinc-100 font-mono"
                          >
                            {getFieldsForNode(mapping.negativePromptNodeId).map((f) => (
                              <option key={f} value={f}>
                                {f}
                              </option>
                            ))}
                          </select>
                        </div>
                      </div>
                    </div>

                    {/* Seed & KSampler Node */}
                    <div className="p-4 bg-zinc-900/50 border border-zinc-800 rounded-lg space-y-3">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-semibold text-zinc-200">
                          Seed / Sampler Node
                        </span>
                        <span className="text-xs text-zinc-400 font-mono">
                          {mapping.seedNodeId ? `Node #${mapping.seedNodeId}` : 'Unmapped'}
                        </span>
                      </div>
                      <div className="grid grid-cols-3 gap-2">
                        <div className="col-span-2">
                          <label className="block text-[11px] text-zinc-400 mb-1">Node</label>
                          <select
                            value={mapping.seedNodeId || ''}
                            onChange={(e) =>
                              setMapping({ ...mapping, seedNodeId: e.target.value || null })
                            }
                            className="w-full px-2.5 py-1.5 text-xs bg-zinc-950 border border-zinc-800 rounded text-zinc-100"
                          >
                            <option value="">-- None --</option>
                            {nodes.map((n) => (
                              <option key={n.nodeId} value={n.nodeId}>
                                #{n.nodeId} · {n.title} ({n.classType})
                              </option>
                            ))}
                          </select>
                        </div>
                        <div>
                          <label className="block text-[11px] text-zinc-400 mb-1">Seed Field</label>
                          <select
                            value={mapping.seedField}
                            onChange={(e) => setMapping({ ...mapping, seedField: e.target.value })}
                            className="w-full px-2.5 py-1.5 text-xs bg-zinc-950 border border-zinc-800 rounded text-zinc-100 font-mono"
                          >
                            {getFieldsForNode(mapping.seedNodeId).map((f) => (
                              <option key={f} value={f}>
                                {f}
                              </option>
                            ))}
                          </select>
                        </div>
                      </div>
                    </div>

                    {/* Resolution Node: Aspect Ratio & Megapixels */}
                    <div className="p-4 bg-zinc-900/50 border border-zinc-800 rounded-lg space-y-3">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-semibold text-zinc-200">
                          Resolution Node (Aspect Ratio & Megapixels)
                        </span>
                        <span className="text-xs text-zinc-400 font-mono">
                          {mapping.latentNodeId ? `Node #${mapping.latentNodeId}` : 'Unmapped'}
                        </span>
                      </div>
                      <div className="grid grid-cols-3 gap-2">
                        <div className="col-span-1">
                          <label className="block text-[11px] text-zinc-400 mb-1">Node</label>
                          <select
                            value={mapping.latentNodeId || ''}
                            onChange={(e) => {
                              const nextNodeId = e.target.value || null;
                              const fields = getFieldsForNode(nextNodeId);
                              const autoAr =
                                fields.find((f) =>
                                  ['aspect_ratio', 'ratio', 'aspect', 'dimensions'].includes(
                                    f.toLowerCase()
                                  )
                                ) || mapping.aspectRatioField;
                              const autoMp =
                                fields.find((f) =>
                                  [
                                    'megapixels',
                                    'megapixel',
                                    'mp',
                                    'total_megapixels',
                                    'target_megapixels',
                                  ].includes(f.toLowerCase())
                                ) || mapping.megapixelsField;
                              setMapping({
                                ...mapping,
                                latentNodeId: nextNodeId,
                                aspectRatioField: autoAr,
                                megapixelsField: autoMp,
                              });
                            }}
                            className="w-full px-2 py-1.5 text-xs bg-zinc-950 border border-zinc-800 rounded text-zinc-100"
                          >
                            <option value="">-- None --</option>
                            {nodes.map((n) => (
                              <option key={n.nodeId} value={n.nodeId}>
                                #{n.nodeId} · {n.title} ({n.classType})
                              </option>
                            ))}
                          </select>
                        </div>
                        <div>
                          <label className="block text-[11px] text-zinc-400 mb-1">
                            Aspect Ratio Field
                          </label>
                          <select
                            value={mapping.aspectRatioField || 'aspect_ratio'}
                            onChange={(e) =>
                              setMapping({ ...mapping, aspectRatioField: e.target.value })
                            }
                            className="w-full px-2 py-1.5 text-xs bg-zinc-950 border border-zinc-800 rounded text-zinc-100 font-mono"
                          >
                            {Array.from(
                              new Set([
                                ...getFieldsForNode(mapping.latentNodeId),
                                'aspect_ratio',
                                'ratio',
                              ])
                            ).map((f) => (
                              <option key={f} value={f}>
                                {f}
                              </option>
                            ))}
                          </select>
                        </div>
                        <div>
                          <label className="block text-[11px] text-zinc-400 mb-1">
                            Megapixels Field
                          </label>
                          <select
                            value={mapping.megapixelsField || 'megapixels'}
                            onChange={(e) =>
                              setMapping({ ...mapping, megapixelsField: e.target.value })
                            }
                            className="w-full px-2 py-1.5 text-xs bg-zinc-950 border border-zinc-800 rounded text-zinc-100 font-mono"
                          >
                            {Array.from(
                              new Set([
                                ...getFieldsForNode(mapping.latentNodeId),
                                'megapixels',
                                'megapixel',
                                'mp',
                              ])
                            ).map((f) => (
                              <option key={f} value={f}>
                                {f}
                              </option>
                            ))}
                          </select>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Checkpoint & LoRA Loader Mapping */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="p-4 bg-zinc-900/50 border border-zinc-800 rounded-lg space-y-2">
                      <label className="block text-xs font-semibold text-zinc-200">
                        Checkpoint / Base Model Node
                      </label>
                      <select
                        value={mapping.checkpointNodeId || ''}
                        onChange={(e) =>
                          setMapping({ ...mapping, checkpointNodeId: e.target.value || null })
                        }
                        className="w-full px-2.5 py-1.5 text-xs bg-zinc-950 border border-zinc-800 rounded text-zinc-100"
                      >
                        <option value="">-- Auto / Keep Workflow Default --</option>
                        {nodes.map((n) => (
                          <option key={n.nodeId} value={n.nodeId}>
                            #{n.nodeId} · {n.title} ({n.classType})
                          </option>
                        ))}
                      </select>
                      <p className="text-[11px] text-zinc-400">
                        Used when overriding checkpoint or chaining extra character LoRAs dynamically.
                      </p>
                    </div>

                    <div className="p-4 bg-zinc-900/50 border border-zinc-800 rounded-lg space-y-2">
                      <label className="block text-xs font-semibold text-zinc-200">
                        LoRA Loader Nodes ({mapping.loraNodeIds.length} mapped)
                      </label>
                      <div className="max-h-28 overflow-y-auto space-y-1 pr-1">
                        {nodes.map((n) => {
                          const isChecked = mapping.loraNodeIds.includes(n.nodeId);
                          const isLikelyLora =
                            n.classType.toLowerCase().includes('lora') ||
                            n.inputFields.includes('lora_name');
                          if (!isLikelyLora && !isChecked) return null;
                          return (
                            <label
                              key={n.nodeId}
                              className="flex items-center justify-between px-2.5 py-1.5 bg-zinc-950 border border-zinc-800 rounded text-xs cursor-pointer"
                            >
                              <span className="text-zinc-200 truncate">
                                #{n.nodeId} · {n.title} ({n.classType})
                              </span>
                              <input
                                type="checkbox"
                                checked={isChecked}
                                onChange={() => toggleLoraNode(n.nodeId)}
                                className="rounded border-zinc-700 text-indigo-600 focus:ring-indigo-500"
                              />
                            </label>
                          );
                        })}
                        {nodes.filter(
                          (n) =>
                            n.classType.toLowerCase().includes('lora') ||
                            n.inputFields.includes('lora_name')
                        ).length === 0 && (
                          <p className="text-xs text-zinc-400">
                            No explicit LoRA node in graph. Couchy will automatically inject a chained LoraLoader node after your Checkpoint node when a character LoRA is selected.
                          </p>
                        )}
                      </div>
                    </div>
                  </div>
                </>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        {activeTab === 'map' && (
          <div className="flex items-center justify-between px-6 py-4 border-t border-zinc-800 bg-zinc-900/40">
            <span className="text-xs text-zinc-400">
              {nodes.length} total nodes inspected in workflow graph
            </span>
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 text-xs font-medium text-zinc-300 hover:text-zinc-100 bg-zinc-900 border border-zinc-800 rounded-lg cursor-pointer"
              >
                Close
              </button>
              <button
                type="button"
                onClick={handleSaveMapping}
                disabled={saving || !hasValidGraph}
                className="inline-flex items-center gap-2 px-4 py-2 text-xs font-medium text-white bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 rounded-lg transition-colors cursor-pointer"
              >
                <Check className="w-3.5 h-3.5" />
                <span>{saving ? 'Saving Mapping...' : 'Save Node Mapping'}</span>
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
