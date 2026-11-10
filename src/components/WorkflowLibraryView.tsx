import React, { useEffect, useMemo, useState } from 'react';
import {
  Play,
  Plus,
  Code,
  Sliders,
  RefreshCw,
  CheckCircle2,
  AlertTriangle,
  Save,
  RotateCcw,
  Download,
  Star,
  Trash2,
  Link2,
  Layers,
  Upload,
} from 'lucide-react';
import { api } from '../api/client.ts';
import { renderDependencyLabel } from './GalleryGridView.tsx';
import {
  RESOLUTION_SELECTOR_OPTIONS,
  type AppToastMessage,
  type ImageRecord,
  type LoraExplorerItem,
  type ModelInventoryItem,
  type ReproductionValidationResult,
  type WorkflowLibraryItem,
} from '../shared/types.ts';

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

interface PowerLoraEntry {
  key: string;
  on: boolean;
  lora: string;
  strength: number;
}

const COMMON_SAMPLERS = [
  'euler',
  'euler_ancestral',
  'heun',
  'dpm_2',
  'dpm_2_ancestral',
  'lms',
  'dpm_fast',
  'dpm_adaptive',
  'dpmpp_2s_ancestral',
  'dpmpp_sde',
  'dpmpp_2m',
  'dpmpp_2m_sde',
  'dpmpp_3m_sde',
  'ddim',
  'uni_pc',
  'uni_pc_bh2',
];

const COMMON_SCHEDULERS = [
  'normal',
  'karras',
  'exponential',
  'sgm_uniform',
  'simple',
  'ddim_uniform',
  'beta',
];

/**
 * Checks whether a ComfyUI node is a Power Lora Loader (rgthree) node.
 */
function isPowerLoraLoaderNode(nodeObj: any): boolean {
  if (!nodeObj || typeof nodeObj !== 'object') return false;
  const ct = String(nodeObj.class_type || '').toLowerCase();
  const inputs = nodeObj.inputs || {};
  return ct.includes('power lora loader') || 'PowerLoraLoaderHeaderWidget' in inputs;
}

/**
 * Extracts ordered lora_1, lora_2, ... entries from a Power Lora Loader node's inputs.
 */
function extractPowerLoraEntries(inputs: Record<string, any>): PowerLoraEntry[] {
  const entries: PowerLoraEntry[] = [];
  const keys = Object.keys(inputs || {})
    .filter((k) => /^lora_\d+$/i.test(k))
    .sort((a, b) => {
      const numA = parseInt(a.replace(/\D+/g, ''), 10) || 0;
      const numB = parseInt(b.replace(/\D+/g, ''), 10) || 0;
      return numA - numB;
    });

  for (const k of keys) {
    const val = inputs[k];
    if (val && typeof val === 'object' && !Array.isArray(val)) {
      entries.push({
        key: k,
        on: val.on !== undefined ? Boolean(val.on) : true,
        lora: String(val.lora || ''),
        strength: Number(val.strength ?? val.strength_model ?? 1.0),
      });
    }
  }
  return entries;
}

/**
 * Writes an array of PowerLoraEntry objects back into a node's inputs as lora_1, lora_2, ...
 */
function applyPowerLoraEntriesToInputs(
  inputs: Record<string, any>,
  entries: PowerLoraEntry[]
): Record<string, any> {
  const nextInputs: Record<string, any> = {};

  // Preserve header widget at top if present, or provide default
  if (inputs.PowerLoraLoaderHeaderWidget) {
    nextInputs.PowerLoraLoaderHeaderWidget = inputs.PowerLoraLoaderHeaderWidget;
  } else {
    nextInputs.PowerLoraLoaderHeaderWidget = { type: 'PowerLoraLoaderHeaderWidget' };
  }

  // Preserve non-LoRA inputs (like model, clip link tuples) while omitting old lora_N, header, and Add Lora widget
  const remainingInputs: Record<string, any> = {};
  for (const [k, v] of Object.entries(inputs || {})) {
    if (k !== 'PowerLoraLoaderHeaderWidget' && k !== '➕ Add Lora' && !/^lora_\d+$/i.test(k)) {
      remainingInputs[k] = v;
    }
  }

  // Add sequential lora_1, lora_2, ...
  entries.forEach((entry, idx) => {
    nextInputs[`lora_${idx + 1}`] = {
      on: Boolean(entry.on),
      lora: entry.lora || '',
      strength: Number(entry.strength ?? 1.0),
    };
  });

  // Keep the exact "➕ Add Lora" placeholder key expected by rgthree Power Lora Loader
  nextInputs['➕ Add Lora'] = inputs['➕ Add Lora'] !== undefined ? inputs['➕ Add Lora'] : '';

  // Append remaining inputs (e.g. model, clip links)
  for (const [k, v] of Object.entries(remainingInputs)) {
    nextInputs[k] = v;
  }

  return nextInputs;
}

/**
 * Independent Workflow Library, Interactive Node Settings Editor & Reproduction History View.
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
  const [selectedWfDetail, setSelectedWfDetail] = useState<any | null>(null);
  const [reproJobs, setReproJobs] = useState<any[]>([]);
  const [validation, setValidation] = useState<ReproductionValidationResult | null>(null);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);

  // Editor state for the currently selected workflow
  const [editorMode, setEditorMode] = useState<'structured' | 'json'>('structured');
  const [draftName, setDraftName] = useState('');
  const [draftDesc, setDraftDesc] = useState('');
  const [draftIsDefault, setDraftIsDefault] = useState(false);
  const [draftGraph, setDraftGraph] = useState<Record<string, any> | null>(null);
  const [rawJsonText, setRawJsonText] = useState('');
  const [rawJsonError, setRawJsonError] = useState<string | null>(null);
  const [nodeSearchFilter, setNodeSearchFilter] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  // Baseline snapshot strings to detect unsaved edits
  const [baselineSnapshot, setBaselineSnapshot] = useState<{
    name: string;
    desc: string;
    isDefault: boolean;
    jsonStr: string;
  } | null>(null);

  // Export confirmation modal state (when unsaved edits exist)
  const [showExportPromptModal, setShowExportPromptModal] = useState(false);

  // Import/Create Workflow Modal State
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newName, setNewName] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [newIsDefault, setNewIsDefault] = useState(false);
  const [newVisualJson, setNewVisualJson] = useState('');
  const [newApiJson, setNewApiJson] = useState('');

  // Auto-select default or first workflow on initial load
  useEffect(() => {
    if (selectedWfId === null && workflows.length > 0) {
      const def = workflows.find((w) => w.isDefault) || workflows[0];
      setSelectedWfId(def.id);
    }
  }, [workflows, selectedWfId]);

  // Build categorized model and LoRA option lists from app inventory
  const diffusionModelOptions = useMemo(() => {
    const set = new Set<string>(checkpoints);
    for (const m of models) {
      if (
        m.modelType === 'checkpoint' ||
        m.modelType === 'diffusion' ||
        m.modelType === 'other'
      ) {
        set.add(m.filename);
      }
    }
    return Array.from(set).filter(Boolean).sort();
  }, [checkpoints, models]);

  const loraOptions = useMemo(() => {
    const set = new Set<string>();
    for (const l of loras) {
      if (l.filename) set.add(l.filename);
      else if (l.name) set.add(l.name);
    }
    for (const m of models) {
      if (m.modelType === 'lora' && m.filename) {
        set.add(m.filename);
      }
    }
    return Array.from(set).filter(Boolean).sort();
  }, [loras, models]);

  const vaeOptions = useMemo(() => {
    const set = new Set<string>();
    for (const m of models) {
      if (
        m.modelType === 'vae' ||
        m.filename.toLowerCase().includes('vae') ||
        m.modelType === 'other'
      ) {
        set.add(m.filename);
      }
    }
    return Array.from(set).filter(Boolean).sort();
  }, [models]);

  const clipOptions = useMemo(() => {
    const set = new Set<string>();
    for (const m of models) {
      if (
        m.filename.toLowerCase().includes('clip') ||
        m.filename.toLowerCase().includes('qwen') ||
        m.filename.toLowerCase().includes('t5') ||
        m.modelType === 'other' ||
        m.modelType === 'embedding'
      ) {
        set.add(m.filename);
      }
    }
    return Array.from(set).filter(Boolean).sort();
  }, [models]);

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

  // Hydrate draft editor state from a loaded workflow row
  const hydrateEditorFromWorkflow = (wfRow: any) => {
    setSelectedWfDetail(wfRow);
    const nameStr = String(wfRow.name || '');
    const descStr = String(wfRow.description || '');
    const isDef = Boolean(wfRow.is_default);
    const rawStr = wfRow.api_workflow_json || wfRow.visual_workflow_json || '{}';

    let formattedJson = rawStr;
    let parsedGraph: Record<string, any> | null = null;
    try {
      const parsed = JSON.parse(rawStr);
      formattedJson = JSON.stringify(parsed, null, 2);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed.nodes)) {
        parsedGraph = parsed;
      }
    } catch {
      parsedGraph = null;
    }

    setDraftName(nameStr);
    setDraftDesc(descStr);
    setDraftIsDefault(isDef);
    setDraftGraph(parsedGraph);
    setRawJsonText(formattedJson);
    setRawJsonError(null);
    setBaselineSnapshot({
      name: nameStr,
      desc: descStr,
      isDefault: isDef,
      jsonStr: formattedJson,
    });
  };

  useEffect(() => {
    if (selectedWfId) {
      api
        .getWorkflow(selectedWfId)
        .then((res) => {
          if (res.workflow) {
            hydrateEditorFromWorkflow(res.workflow);
          }
        })
        .catch(() => {});
      setValidation(null);
      setStatusMsg(null);
    } else {
      setSelectedWfDetail(null);
      setDraftGraph(null);
      setBaselineSnapshot(null);
    }
  }, [selectedWfId]);

  // Determine whether the user has unsaved modifications
  const isDirty = useMemo(() => {
    if (!baselineSnapshot) return false;
    return (
      draftName.trim() !== baselineSnapshot.name.trim() ||
      draftDesc.trim() !== baselineSnapshot.desc.trim() ||
      draftIsDefault !== baselineSnapshot.isDefault ||
      rawJsonText.trim() !== baselineSnapshot.jsonStr.trim()
    );
  }, [baselineSnapshot, draftName, draftDesc, draftIsDefault, rawJsonText]);

  // Update a single node input field inside draftGraph and sync rawJsonText
  const handleNodeFieldChange = (nodeId: string, fieldKey: string, nextValue: any) => {
    setDraftGraph((prev) => {
      if (!prev || !prev[nodeId]) return prev;
      const nextNode = {
        ...prev[nodeId],
        inputs: {
          ...(prev[nodeId].inputs || {}),
          [fieldKey]: nextValue,
        },
      };
      const next = { ...prev, [nodeId]: nextNode };
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

  // Handle raw JSON text edits and keep structured draftGraph in sync when valid
  const handleRawJsonChange = (val: string) => {
    setRawJsonText(val);
    try {
      const parsed = JSON.parse(val);
      setRawJsonError(null);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed.nodes)) {
        setDraftGraph(parsed);
      }
    } catch (err: any) {
      setRawJsonError(err?.message || 'Invalid JSON syntax');
    }
  };

  // Cancel: revert all unsaved changes back to server state
  const handleCancelEdits = () => {
    if (!selectedWfDetail) return;
    hydrateEditorFromWorkflow(selectedWfDetail);
    setStatusMsg('Reverted unsaved changes.');
    onPushToast?.('Reverted workflow changes', 'info');
  };

  // Save: persist updated workflow settings and JSON graph to server
  const handleSaveWorkflow = async (): Promise<boolean> => {
    if (!selectedWfDetail) return false;
    if (!draftName.trim()) {
      setStatusMsg('Workflow name cannot be empty.');
      return false;
    }

    let finalJsonString = rawJsonText;
    try {
      const parsed = JSON.parse(rawJsonText);
      finalJsonString = JSON.stringify(parsed, null, 2);
    } catch {
      setStatusMsg('Cannot save: Workflow JSON has syntax errors.');
      onPushToast?.('Workflow JSON has syntax errors', 'error');
      return false;
    }

    setIsSaving(true);
    try {
      const isVisualOnly =
        !selectedWfDetail.api_workflow_json && Boolean(selectedWfDetail.visual_workflow_json);
      const res = await api.saveWorkflow({
        id: selectedWfDetail.id,
        name: draftName.trim(),
        description: draftDesc.trim(),
        apiWorkflowJson: isVisualOnly ? selectedWfDetail.api_workflow_json : finalJsonString,
        visualWorkflowJson: isVisualOnly ? finalJsonString : selectedWfDetail.visual_workflow_json,
        isDefault: draftIsDefault,
      });

      if (res.workflow) {
        hydrateEditorFromWorkflow(res.workflow);
      }
      await onRefresh();
      setStatusMsg('Saved workflow changes to server.');
      onPushToast?.(`Saved workflow "${draftName.trim()}"`, 'success');
      return true;
    } catch (err: any) {
      setStatusMsg(`Save failed: ${err.message}`);
      onPushToast?.(`Failed to save workflow: ${err.message}`, 'error');
      return false;
    } finally {
      setIsSaving(false);
    }
  };

  // Trigger browser download of the workflow JSON file
  const triggerWorkflowJsonDownload = (jsonContent: string, wfName: string) => {
    const safeSlug =
      (wfName || 'workflow')
        .toLowerCase()
        .replace(/[^a-z0-9-_]+/g, '_')
        .replace(/^_+|_+$/g, '') || 'workflow';
    const blob = new Blob([jsonContent], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${safeSlug}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    onPushToast?.(`Exported ${safeSlug}.json`, 'info');
  };

  // Export button handler: prompts to save first if there are unsaved changes
  const handleExportClick = () => {
    if (!selectedWfDetail) return;
    if (isDirty) {
      setShowExportPromptModal(true);
    } else {
      triggerWorkflowJsonDownload(rawJsonText, draftName);
    }
  };

  // Set a workflow as the primary Default across the app
  const handleSetDefaultWorkflow = async (wfId: number, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    try {
      const res = await api.setDefaultWorkflow(wfId);
      if (selectedWfId === wfId && res.workflow) {
        setSelectedWfDetail(res.workflow);
        setDraftIsDefault(true);
        setBaselineSnapshot((prev) => (prev ? { ...prev, isDefault: true } : prev));
      } else if (selectedWfId !== null) {
        setDraftIsDefault(false);
        setBaselineSnapshot((prev) => (prev ? { ...prev, isDefault: false } : prev));
      }
      await onRefresh();
      onPushToast?.('Updated default workflow', 'success');
    } catch (err: any) {
      onPushToast?.(`Failed to set default workflow: ${err.message}`, 'error');
    }
  };

  // Handle uploading a JSON file inside the Import Modal
  const handleImportFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const text = String(reader.result || '');
      try {
        const parsed = JSON.parse(text);
        if (parsed && Array.isArray(parsed.nodes)) {
          setNewVisualJson(JSON.stringify(parsed, null, 2));
        } else {
          setNewApiJson(JSON.stringify(parsed, null, 2));
        }
        if (!newName.trim()) {
          setNewName(file.name.replace(/\.json$/i, ''));
        }
      } catch {
        setNewApiJson(text);
      }
    };
    reader.readAsText(file);
  };

  const handleSaveNewWorkflow = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName.trim()) return;
    const res = await api.saveWorkflow({
      name: newName.trim(),
      description: newDesc.trim(),
      visualWorkflowJson: newVisualJson.trim() || null,
      apiWorkflowJson: newApiJson.trim() || null,
      isDefault: newIsDefault,
    });
    setNewName('');
    setNewDesc('');
    setNewIsDefault(false);
    setNewVisualJson('');
    setNewApiJson('');
    setShowCreateModal(false);
    await onRefresh();
    if (res.workflow?.id) {
      setSelectedWfId(res.workflow.id);
    }
    onPushToast?.('Imported workflow to library', 'success');
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

  // Filter nodes in the structured editor
  const filteredNodeEntries = useMemo(() => {
    if (!draftGraph) return [];
    const entries = Object.entries(draftGraph).filter(
      ([, nodeObj]) => nodeObj && typeof nodeObj === 'object'
    );
    const q = nodeSearchFilter.trim().toLowerCase();
    if (!q) return entries;
    return entries.filter(([nodeId, nodeObj]) => {
      const title = String(nodeObj._meta?.title || '').toLowerCase();
      const classType = String(nodeObj.class_type || '').toLowerCase();
      const inputKeys = Object.keys(nodeObj.inputs || {})
        .join(' ')
        .toLowerCase();
      return (
        nodeId.toLowerCase().includes(q) ||
        title.includes(q) ||
        classType.includes(q) ||
        inputKeys.includes(q)
      );
    });
  }, [draftGraph, nodeSearchFilter]);

  /**
   * Renders the appropriate input control (Model Dropdown, LoRA Dropdown, Aspect Ratio Dropdown,
   * Number, Boolean, or Textarea) for a given node input field.
   */
  const renderNodeInputControl = (
    nodeId: string,
    nodeObj: any,
    fieldKey: string,
    fieldVal: any
  ) => {
    const classType = String(nodeObj.class_type || '');
    const keyLower = fieldKey.toLowerCase();

    // 1. Node-to-node link connection [sourceNodeId, outputSlot]
    if (Array.isArray(fieldVal)) {
      const sourceNodeId = String(fieldVal[0]);
      const sourceSlot = fieldVal[1];
      const sourceTitle =
        draftGraph?.[sourceNodeId]?._meta?.title ||
        draftGraph?.[sourceNodeId]?.class_type ||
        `Node #${sourceNodeId}`;
      return (
        <div className="flex items-center justify-between px-2.5 py-1.5 bg-zinc-900/80 border border-zinc-800/80 rounded-lg text-[11px] font-mono text-zinc-400">
          <span className="inline-flex items-center gap-1.5 text-indigo-300">
            <Link2 className="w-3 h-3 shrink-0" />
            <span>
              Linked from #{sourceNodeId} ({sourceTitle})
            </span>
          </span>
          <span className="text-zinc-500">Output [{sourceSlot}]</span>
        </div>
      );
    }

    // 2. Non-primitive widget metadata object (e.g. PowerLoraLoaderHeaderWidget)
    if (fieldVal !== null && typeof fieldVal === 'object') {
      return (
        <input
          type="text"
          readOnly
          value={JSON.stringify(fieldVal)}
          className="w-full px-2.5 py-1.5 bg-zinc-900/50 border border-zinc-800 rounded-lg font-mono text-[11px] text-zinc-500"
        />
      );
    }

    // 3. Diffusion Model / Checkpoint selector (unet_name, ckpt_name, model_name)
    if (
      keyLower === 'unet_name' ||
      keyLower === 'ckpt_name' ||
      (keyLower === 'model_name' &&
        (classType.toLowerCase().includes('loader') ||
          classType.toLowerCase().includes('checkpoint') ||
          classType.toLowerCase().includes('unet')))
    ) {
      const currentStr = String(fieldVal ?? '');
      const opts = Array.from(
        new Set([...(currentStr ? [currentStr] : []), ...diffusionModelOptions])
      );
      return (
        <select
          value={currentStr}
          onChange={(e) => handleNodeFieldChange(nodeId, fieldKey, e.target.value)}
          className="w-full px-2.5 py-1.5 bg-zinc-950 border border-indigo-500/40 rounded-lg font-mono text-xs text-zinc-100"
        >
          <option value="">— Select Model from models/ —</option>
          {opts.map((opt) => (
            <option key={opt} value={opt}>
              {opt}
            </option>
          ))}
        </select>
      );
    }

    // 4. Single LoRA selector (lora_name)
    if (keyLower === 'lora_name' || keyLower.startsWith('lora_name')) {
      const currentStr = String(fieldVal ?? '');
      const opts = Array.from(new Set([...(currentStr ? [currentStr] : []), ...loraOptions]));
      return (
        <select
          value={currentStr}
          onChange={(e) => handleNodeFieldChange(nodeId, fieldKey, e.target.value)}
          className="w-full px-2.5 py-1.5 bg-zinc-950 border border-indigo-500/40 rounded-lg font-mono text-xs text-zinc-100"
        >
          <option value="">— Select LoRA from loras/ —</option>
          {opts.map((opt) => (
            <option key={opt} value={opt}>
              {opt}
            </option>
          ))}
        </select>
      );
    }

    // 5. VAE Model selector (vae_name)
    if (keyLower === 'vae_name') {
      const currentStr = String(fieldVal ?? '');
      const opts = Array.from(new Set([...(currentStr ? [currentStr] : []), ...vaeOptions]));
      return (
        <select
          value={currentStr}
          onChange={(e) => handleNodeFieldChange(nodeId, fieldKey, e.target.value)}
          className="w-full px-2.5 py-1.5 bg-zinc-950 border border-indigo-500/40 rounded-lg font-mono text-xs text-zinc-100"
        >
          <option value="">— Select VAE from models/ —</option>
          {opts.map((opt) => (
            <option key={opt} value={opt}>
              {opt}
            </option>
          ))}
        </select>
      );
    }

    // 6. CLIP / Text Encoder selector (clip_name, clip_name1, clip_name2)
    if (keyLower === 'clip_name' || keyLower === 'clip_name1' || keyLower === 'clip_name2') {
      const currentStr = String(fieldVal ?? '');
      const opts = Array.from(new Set([...(currentStr ? [currentStr] : []), ...clipOptions]));
      return (
        <select
          value={currentStr}
          onChange={(e) => handleNodeFieldChange(nodeId, fieldKey, e.target.value)}
          className="w-full px-2.5 py-1.5 bg-zinc-950 border border-indigo-500/40 rounded-lg font-mono text-xs text-zinc-100"
        >
          <option value="">— Select CLIP / Encoder from models/ —</option>
          {opts.map((opt) => (
            <option key={opt} value={opt}>
              {opt}
            </option>
          ))}
        </select>
      );
    }

    // 7. ResolutionSelector aspect_ratio dropdown
    if (classType === 'ResolutionSelector' && keyLower === 'aspect_ratio') {
      const currentStr = String(fieldVal ?? '2:3 (Portrait Photo)');
      const ratioValues = RESOLUTION_SELECTOR_OPTIONS.map((o) => o.value as string);
      const opts = Array.from(new Set([...(currentStr ? [currentStr] : []), ...ratioValues]));
      return (
        <select
          value={currentStr}
          onChange={(e) => handleNodeFieldChange(nodeId, fieldKey, e.target.value)}
          className="w-full px-2.5 py-1.5 bg-zinc-950 border border-indigo-500/40 rounded-lg font-mono text-xs text-zinc-100"
        >
          {opts.map((opt) => (
            <option key={opt} value={opt}>
              {opt}
            </option>
          ))}
        </select>
      );
    }

    // 8. Sampler & Scheduler dropdowns
    if (keyLower === 'sampler_name') {
      const currentStr = String(fieldVal ?? 'euler');
      const opts = Array.from(new Set([currentStr, ...COMMON_SAMPLERS]));
      return (
        <select
          value={currentStr}
          onChange={(e) => handleNodeFieldChange(nodeId, fieldKey, e.target.value)}
          className="w-full px-2.5 py-1.5 bg-zinc-950 border border-zinc-800 rounded-lg font-mono text-xs text-zinc-100"
        >
          {opts.map((opt) => (
            <option key={opt} value={opt}>
              {opt}
            </option>
          ))}
        </select>
      );
    }

    if (keyLower === 'scheduler') {
      const currentStr = String(fieldVal ?? 'simple');
      const opts = Array.from(new Set([currentStr, ...COMMON_SCHEDULERS]));
      return (
        <select
          value={currentStr}
          onChange={(e) => handleNodeFieldChange(nodeId, fieldKey, e.target.value)}
          className="w-full px-2.5 py-1.5 bg-zinc-950 border border-zinc-800 rounded-lg font-mono text-xs text-zinc-100"
        >
          {opts.map((opt) => (
            <option key={opt} value={opt}>
              {opt}
            </option>
          ))}
        </select>
      );
    }

    // 9. Boolean toggle
    if (typeof fieldVal === 'boolean') {
      return (
        <label className="inline-flex items-center gap-2 cursor-pointer select-none py-1">
          <input
            type="checkbox"
            checked={fieldVal}
            onChange={(e) => handleNodeFieldChange(nodeId, fieldKey, e.target.checked)}
            className="rounded border-zinc-700 bg-zinc-950 text-indigo-600 focus:ring-indigo-500"
          />
          <span className="font-mono text-xs text-zinc-200">{fieldVal ? 'true' : 'false'}</span>
        </label>
      );
    }

    // 10. Numeric input
    if (typeof fieldVal === 'number') {
      const isFloat = !Number.isInteger(fieldVal) || keyLower.includes('strength') || keyLower.includes('cfg') || keyLower.includes('denoise') || keyLower.includes('megapixels') || keyLower.includes('temperature') || keyLower.includes('p') || keyLower.includes('penalty');
      return (
        <input
          type="number"
          step={isFloat ? '0.05' : '1'}
          value={fieldVal}
          onChange={(e) => {
            const parsed = e.target.value === '' ? 0 : Number(e.target.value);
            handleNodeFieldChange(nodeId, fieldKey, Number.isNaN(parsed) ? 0 : parsed);
          }}
          className="w-full px-2.5 py-1.5 bg-zinc-950 border border-zinc-800 rounded-lg font-mono tabular-nums text-xs text-zinc-100"
        />
      );
    }

    // 11. String / Multiline text input
    const strVal = String(fieldVal ?? '');
    const isMultiline =
      strVal.length > 70 ||
      strVal.includes('\n') ||
      classType.includes('Multiline') ||
      keyLower === 'text' ||
      keyLower === 'prompt' ||
      (keyLower === 'value' && classType.toLowerCase().includes('string'));

    if (isMultiline) {
      return (
        <textarea
          rows={Math.min(6, Math.max(2, strVal.split('\n').length))}
          value={strVal}
          onChange={(e) => handleNodeFieldChange(nodeId, fieldKey, e.target.value)}
          className="w-full p-2.5 bg-zinc-950 border border-zinc-800 rounded-lg font-mono text-xs text-zinc-100"
        />
      );
    }

    return (
      <input
        type="text"
        value={strVal}
        onChange={(e) => handleNodeFieldChange(nodeId, fieldKey, e.target.value)}
        className="w-full px-2.5 py-1.5 bg-zinc-950 border border-zinc-800 rounded-lg font-mono text-xs text-zinc-100"
      />
    );
  };

  return (
    <div className="px-6 py-6 max-w-7xl mx-auto space-y-8">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-display font-semibold text-zinc-100">
            Independent Workflow Library & Node Settings Editor
          </h1>
          <p className="text-xs text-zinc-400 mt-0.5">
            Select any workflow to configure its nodes, assign diffusion models and multiple LoRAs
            from discovered local files, mark your primary Default workflow, or export JSON.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setShowCreateModal(true)}
          className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg cursor-pointer whitespace-nowrap shrink-0"
        >
          <Plus className="w-3.5 h-3.5" />
          <span>Import / Save Workflow JSON</span>
        </button>
      </div>

      {/* Workflows Grid & Right-Hand Settings Editor */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left Column: Stored Workflows List */}
        <div className="lg:col-span-5 space-y-3">
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
                    onClick={() => setSelectedWfId(wf.id)}
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
                          onClick={(e) => handleSetDefaultWorkflow(wf.id, e)}
                          className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-medium bg-zinc-800 hover:bg-zinc-700 text-zinc-200 rounded-md cursor-pointer whitespace-nowrap shrink-0"
                          title="Set as Default workflow for Quick Gen and Studio"
                        >
                          <Star className="w-3 h-3 text-zinc-400" />
                          <span>Set Default</span>
                        </button>
                      )}
                    </div>

                    {wf.description && <p className="text-zinc-400 line-clamp-2">{wf.description}</p>}

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

        {/* Right Column: Selected Workflow Settings Editor & Reproduction Panel */}
        <div className="lg:col-span-7">
          {selectedWfDetail ? (
            <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5 space-y-5 text-xs">
              {/* Top Action Bar: Title, Default Toggle, Cancel, Save, Export */}
              <div className="flex flex-wrap items-center justify-between gap-3 pb-4 border-b border-zinc-800">
                <div className="space-y-0.5 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h3 className="text-base font-display font-semibold text-zinc-100 truncate">
                      {draftName || selectedWfDetail.name}
                    </h3>
                    {draftIsDefault && (
                      <span className="inline-flex items-center gap-1 text-xs font-medium text-amber-300">
                        <Star className="w-3.5 h-3.5 fill-amber-400 text-amber-400" />
                        <span>Default Workflow</span>
                      </span>
                    )}
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
                  {!draftIsDefault && (
                    <button
                      type="button"
                      onClick={() => handleSetDefaultWorkflow(selectedWfDetail.id)}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 text-amber-300 font-medium rounded-lg cursor-pointer whitespace-nowrap shrink-0"
                    >
                      <Star className="w-3.5 h-3.5" />
                      <span>Mark as Default</span>
                    </button>
                  )}

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

              {/* Workflow Name, Description & Default Checkbox */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 p-3.5 bg-zinc-950 border border-zinc-800 rounded-lg">
                <div>
                  <label className="block text-[11px] font-medium text-zinc-400 mb-1">
                    Workflow Name
                  </label>
                  <input
                    type="text"
                    value={draftName}
                    onChange={(e) => setDraftName(e.target.value)}
                    className="w-full px-2.5 py-1.5 bg-zinc-900 border border-zinc-800 rounded-lg text-zinc-100 text-xs"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-medium text-zinc-400 mb-1">
                    Description
                  </label>
                  <input
                    type="text"
                    value={draftDesc}
                    onChange={(e) => setDraftDesc(e.target.value)}
                    placeholder="Describe this workflow's purpose..."
                    className="w-full px-2.5 py-1.5 bg-zinc-900 border border-zinc-800 rounded-lg text-zinc-100 text-xs"
                  />
                </div>
              </div>

              {/* Editor Mode Switcher + Validate/Reproduce Button */}
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

              {/* STRUCTURED NODE SETTINGS EDITOR */}
              {editorMode === 'structured' ? (
                draftGraph ? (
                  <div className="space-y-4">
                    {/* Node Search / Filter Bar */}
                    <div className="flex items-center justify-between gap-3">
                      <input
                        type="text"
                        value={nodeSearchFilter}
                        onChange={(e) => setNodeSearchFilter(e.target.value)}
                        placeholder="Filter nodes by title, ID, class_type, or parameter name (e.g. lora, unet, sampler)..."
                        className="w-full px-3 py-2 bg-zinc-950 border border-zinc-800 rounded-lg text-xs text-zinc-100"
                      />
                      <span className="text-[11px] font-mono text-zinc-400 whitespace-nowrap shrink-0">
                        {filteredNodeEntries.length} / {Object.keys(draftGraph).length} nodes
                      </span>
                    </div>

                    <div className="space-y-3 max-h-[620px] overflow-y-auto pr-1">
                      {filteredNodeEntries.map(([nodeId, nodeObj]) => {
                        const title = String(nodeObj._meta?.title || nodeObj.class_type || `Node ${nodeId}`);
                        const classType = String(nodeObj.class_type || 'UnknownNode');
                        const inputs =
                          nodeObj.inputs && typeof nodeObj.inputs === 'object' ? nodeObj.inputs : {};
                        const isPowerLora = isPowerLoraLoaderNode(nodeObj);
                        const powerLoraEntries = isPowerLora ? extractPowerLoraEntries(inputs) : [];

                        // Filter out internal PowerLoraLoader widget keys when rendering normal inputs
                        const regularInputEntries = Object.entries(inputs).filter(([k]) => {
                          if (!isPowerLora) return true;
                          if (k === 'PowerLoraLoaderHeaderWidget' || k === '➕ Add Lora') return false;
                          if (/^lora_\d+$/i.test(k)) return false;
                          return true;
                        });

                        return (
                          <div
                            key={nodeId}
                            className="p-4 bg-zinc-950 border border-zinc-800/90 rounded-xl space-y-3"
                          >
                            {/* Node Header */}
                            <div className="flex items-center justify-between gap-2 pb-2 border-b border-zinc-800/70">
                              <div className="flex items-center gap-2 min-w-0">
                                <span className="font-mono text-[11px] font-semibold text-indigo-400">
                                  #{nodeId}
                                </span>
                                <span className="font-display font-semibold text-zinc-100 truncate">
                                  {title}
                                </span>
                              </div>
                              <span className="font-mono text-[11px] text-zinc-400 shrink-0">
                                {classType}
                              </span>
                            </div>

                            {/* Dedicated Multi-LoRA Selector for Power Lora Loader (rgthree) */}
                            {isPowerLora && (
                              <div className="p-3.5 bg-zinc-900/90 border border-indigo-500/30 rounded-lg space-y-3 min-w-0">
                                <div className="flex flex-wrap items-center justify-between gap-2">
                                  <div className="flex items-center gap-2 min-w-0">
                                    <span className="font-medium text-indigo-300 flex items-center gap-1.5 text-xs sm:text-sm">
                                      <Layers className="w-4 h-4 text-indigo-400 shrink-0" />
                                      <span>
                                        Power Lora Loader — Multiple LoRAs ({powerLoraEntries.length})
                                      </span>
                                    </span>
                                    <span className="text-[11px] text-zinc-400 hidden sm:inline">
                                      Discovered in <code className="text-zinc-300 font-mono">loras/</code>
                                    </span>
                                  </div>
                                  <button
                                    type="button"
                                    onClick={() => handleAddPowerLoraSlot(nodeId, powerLoraEntries)}
                                    className="inline-flex items-center gap-1 px-2.5 py-1 bg-indigo-600 hover:bg-indigo-500 text-white rounded-md text-xs font-medium cursor-pointer shrink-0 transition-colors shadow-sm"
                                    title="Add a new LoRA slot to this loader"
                                  >
                                    <Plus className="w-3.5 h-3.5" />
                                    <span>Add LoRA</span>
                                  </button>
                                </div>

                                {powerLoraEntries.length === 0 ? (
                                  <div className="py-4 px-3 text-center border border-dashed border-zinc-800 rounded-lg bg-zinc-950/60 space-y-2">
                                    <p className="text-xs text-zinc-400">
                                      No LoRAs attached to this node yet.
                                    </p>
                                    <button
                                      type="button"
                                      onClick={() => handleAddPowerLoraSlot(nodeId, powerLoraEntries)}
                                      className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-xs font-medium cursor-pointer transition-colors shadow-sm"
                                    >
                                      <Plus className="w-3.5 h-3.5" />
                                      <span>Add First LoRA</span>
                                    </button>
                                  </div>
                                ) : (
                                  <div className="space-y-2">
                                    {powerLoraEntries.map((entry, idx) => {
                                      const rowOpts = Array.from(
                                        new Set([
                                          ...(entry.lora ? [entry.lora] : []),
                                          ...loraOptions,
                                        ])
                                      );
                                      return (
                                        <div
                                          key={entry.key || `lora_${idx + 1}`}
                                          className="flex items-center gap-2 bg-zinc-950 p-2 rounded-lg border border-zinc-800 min-w-0"
                                        >
                                          <label
                                            className="flex items-center gap-1.5 shrink-0 cursor-pointer select-none"
                                            title="Enable or disable this LoRA slot"
                                          >
                                            <input
                                              type="checkbox"
                                              checked={entry.on}
                                              onChange={(e) => {
                                                const next = [...powerLoraEntries];
                                                next[idx] = { ...entry, on: e.target.checked };
                                                handlePowerLoraChange(nodeId, next);
                                              }}
                                              className="rounded border-zinc-700 bg-zinc-900 text-indigo-600 cursor-pointer focus:ring-0"
                                            />
                                            <span className="font-mono text-[11px] text-zinc-400 w-11 shrink-0">
                                              lora_{idx + 1}
                                            </span>
                                          </label>

                                          <div className="flex-1 min-w-0">
                                            <select
                                              value={entry.lora}
                                              onChange={(e) => {
                                                const next = [...powerLoraEntries];
                                                next[idx] = { ...entry, lora: e.target.value };
                                                handlePowerLoraChange(nodeId, next);
                                              }}
                                              className="w-full px-2 py-1 bg-zinc-900 border border-zinc-800 rounded font-mono text-xs text-zinc-100 truncate focus:outline-none focus:border-indigo-500"
                                            >
                                              <option value="">— Select LoRA —</option>
                                              {rowOpts.map((opt) => (
                                                <option key={opt} value={opt}>
                                                  {opt}
                                                </option>
                                              ))}
                                            </select>
                                          </div>

                                          <div className="flex items-center gap-1 shrink-0 bg-zinc-900/80 px-1.5 py-0.5 rounded border border-zinc-800">
                                            <span className="text-[10px] font-medium text-zinc-400 select-none">
                                              Str:
                                            </span>
                                            <input
                                              type="number"
                                              step="0.05"
                                              min="-4"
                                              max="4"
                                              value={entry.strength}
                                              onChange={(e) => {
                                                const val = parseFloat(e.target.value);
                                                const next = [...powerLoraEntries];
                                                next[idx] = {
                                                  ...entry,
                                                  strength: Number.isNaN(val) ? 1.0 : val,
                                                };
                                                handlePowerLoraChange(nodeId, next);
                                              }}
                                              className="w-16 px-1 py-0.5 bg-zinc-950 border border-zinc-700 rounded font-mono tabular-nums text-xs text-zinc-100 text-right focus:outline-none focus:border-indigo-500"
                                            />
                                          </div>

                                          <button
                                            type="button"
                                            onClick={() => {
                                              const next = powerLoraEntries.filter((_, i) => i !== idx);
                                              handlePowerLoraChange(nodeId, next);
                                            }}
                                            className="p-1 text-zinc-400 hover:text-rose-400 hover:bg-rose-500/10 rounded cursor-pointer shrink-0 transition-colors"
                                            title={`Remove lora_${idx + 1}`}
                                          >
                                            <Trash2 className="w-3.5 h-3.5" />
                                          </button>
                                        </div>
                                      );
                                    })}

                                    <button
                                      type="button"
                                      onClick={() => handleAddPowerLoraSlot(nodeId, powerLoraEntries)}
                                      className="w-full py-1.5 border border-dashed border-zinc-700/80 hover:border-indigo-500 hover:text-indigo-300 text-zinc-400 rounded-lg text-xs font-medium flex items-center justify-center gap-1.5 transition-colors cursor-pointer bg-zinc-950/40 hover:bg-indigo-950/20"
                                    >
                                      <Plus className="w-3.5 h-3.5" />
                                      <span>Add Another LoRA Slot</span>
                                    </button>
                                  </div>
                                )}
                              </div>
                            )}

                            {/* All Other Inputs on this Node */}
                            {regularInputEntries.length === 0 ? (
                              !isPowerLora && (
                                <p className="text-[11px] text-zinc-500">
                                  This node has no configurable input fields.
                                </p>
                              )
                            ) : (
                              <div className="grid grid-cols-1 gap-2.5">
                                {regularInputEntries.map(([fieldKey, fieldVal]) => (
                                  <div
                                    key={fieldKey}
                                    className="grid grid-cols-1 sm:grid-cols-12 gap-2 items-start"
                                  >
                                    <label className="sm:col-span-4 font-mono text-[11px] text-zinc-300 pt-1.5 break-all">
                                      {fieldKey}
                                    </label>
                                    <div className="sm:col-span-8">
                                      {renderNodeInputControl(nodeId, nodeObj, fieldKey, fieldVal)}
                                    </div>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ) : (
                  <div className="p-6 bg-zinc-950 border border-zinc-800 rounded-xl text-center space-y-2">
                    <p className="text-zinc-300 font-medium">
                      This workflow stores a visual-only graph without an API prompt dictionary.
                    </p>
                    <p className="text-zinc-400">
                      Switch to the <strong>Raw JSON Editor</strong> tab above to view and edit its
                      JSON structure directly.
                    </p>
                  </div>
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

              {/* Associated Images for this Workflow */}
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
              Select a workflow on the left to inspect and edit its node settings, assign models and
              LoRAs, or export its JSON.
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
              Tracks every workflow reproduction launched from the gallery with ComfyUI prompt IDs
              and execution states.
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

      {/* Export Unsaved Changes Prompt Modal */}
      {showExportPromptModal && (
        <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4">
          <div className="bg-zinc-900 border border-zinc-800 rounded-xl max-w-md w-full p-6 space-y-4 text-xs">
            <h3 className="text-base font-display font-semibold text-zinc-100">
              Save Changes Before Exporting?
            </h3>
            <p className="text-zinc-300 leading-relaxed">
              You have unsaved edits in <strong>{draftName || 'this workflow'}</strong>. Would you
              like to save your changes to the server first before downloading the JSON file?
            </p>
            <div className="flex flex-wrap justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setShowExportPromptModal(false)}
                className="px-3 py-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded-lg cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowExportPromptModal(false);
                  triggerWorkflowJsonDownload(rawJsonText, draftName);
                }}
                className="px-3.5 py-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-100 font-medium rounded-lg cursor-pointer"
              >
                No, Export Without Saving
              </button>
              <button
                type="button"
                onClick={async () => {
                  const saved = await handleSaveWorkflow();
                  if (saved) {
                    setShowExportPromptModal(false);
                    triggerWorkflowJsonDownload(rawJsonText, draftName);
                  }
                }}
                className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white font-medium rounded-lg cursor-pointer"
              >
                Yes, Save & Export
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Import / Save Workflow Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4">
          <form
            onSubmit={handleSaveNewWorkflow}
            className="bg-zinc-900 border border-zinc-800 rounded-xl max-w-lg w-full p-6 space-y-4 text-xs"
          >
            <div className="flex items-center justify-between">
              <h3 className="text-base font-display font-semibold text-zinc-100">
                Import / Save Workflow to Library
              </h3>
              <label className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 text-indigo-300 rounded-lg cursor-pointer">
                <Upload className="w-3.5 h-3.5" />
                <span>Load .json File</span>
                <input
                  type="file"
                  accept=".json,application/json"
                  onChange={handleImportFileUpload}
                  className="hidden"
                />
              </label>
            </div>

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
              <label className="inline-flex items-center gap-2 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={newIsDefault}
                  onChange={(e) => setNewIsDefault(e.target.checked)}
                  className="rounded border-zinc-700 bg-zinc-950 text-indigo-600"
                />
                <span className="text-zinc-200 font-medium">
                  Set as primary Default workflow across Quick Gen & Studio
                </span>
              </label>
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
