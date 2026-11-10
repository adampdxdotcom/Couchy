import React, { useMemo } from 'react';
import { Link2 } from 'lucide-react';
import { RESOLUTION_SELECTOR_OPTIONS } from '../../shared/utils.ts';
import {
  PowerLoraLoaderEditor,
  isPowerLoraLoaderNode,
  extractPowerLoraEntries,
  type PowerLoraEntry,
} from './PowerLoraLoaderEditor.tsx';

export const COMMON_SAMPLERS = [
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
  'dpmpp_sde_gpu',
  'dpmpp_2m',
  'dpmpp_2m_sde',
  'dpmpp_2m_sde_gpu',
  'dpmpp_3m_sde',
  'ddim',
  'uni_pc',
  'uni_pc_bh2',
];

export const COMMON_SCHEDULERS = [
  'normal',
  'karras',
  'exponential',
  'sgm_uniform',
  'simple',
  'ddim_uniform',
  'beta',
];

export interface WorkflowGraphInspectorProps {
  draftGraph: Record<string, any>;
  nodeSearchFilter: string;
  onChangeSearchFilter: (q: string) => void;
  diffusionModelOptions: string[];
  loraOptions: string[];
  vaeOptions: string[];
  clipOptions: string[];
  onNodeFieldChange: (nodeId: string, fieldKey: string, value: any) => void;
  onPowerLoraChange: (nodeId: string, entries: PowerLoraEntry[]) => void;
  onAddPowerLoraSlot: (nodeId: string, currentEntries: PowerLoraEntry[]) => void;
}

/**
 * Structured inspector and node-level parameter editor for a ComfyUI prompt graph.
 */
export const WorkflowGraphInspector: React.FC<WorkflowGraphInspectorProps> = ({
  draftGraph,
  nodeSearchFilter,
  onChangeSearchFilter,
  diffusionModelOptions,
  loraOptions,
  vaeOptions,
  clipOptions,
  onNodeFieldChange,
  onPowerLoraChange,
  onAddPowerLoraSlot,
}) => {
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

    // 2. Non-primitive widget metadata object
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

    // 3. Diffusion Model / Checkpoint selector
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
          onChange={(e) => onNodeFieldChange(nodeId, fieldKey, e.target.value)}
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

    // 4. Single LoRA selector
    if (keyLower === 'lora_name' || keyLower.startsWith('lora_name')) {
      const currentStr = String(fieldVal ?? '');
      const opts = Array.from(new Set([...(currentStr ? [currentStr] : []), ...loraOptions]));
      return (
        <select
          value={currentStr}
          onChange={(e) => onNodeFieldChange(nodeId, fieldKey, e.target.value)}
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

    // 5. VAE Model selector
    if (keyLower === 'vae_name') {
      const currentStr = String(fieldVal ?? '');
      const opts = Array.from(new Set([...(currentStr ? [currentStr] : []), ...vaeOptions]));
      return (
        <select
          value={currentStr}
          onChange={(e) => onNodeFieldChange(nodeId, fieldKey, e.target.value)}
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

    // 6. CLIP / Text Encoder selector
    if (keyLower === 'clip_name' || keyLower === 'clip_name1' || keyLower === 'clip_name2') {
      const currentStr = String(fieldVal ?? '');
      const opts = Array.from(new Set([...(currentStr ? [currentStr] : []), ...clipOptions]));
      return (
        <select
          value={currentStr}
          onChange={(e) => onNodeFieldChange(nodeId, fieldKey, e.target.value)}
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
          onChange={(e) => onNodeFieldChange(nodeId, fieldKey, e.target.value)}
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
          onChange={(e) => onNodeFieldChange(nodeId, fieldKey, e.target.value)}
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
          onChange={(e) => onNodeFieldChange(nodeId, fieldKey, e.target.value)}
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
            onChange={(e) => onNodeFieldChange(nodeId, fieldKey, e.target.checked)}
            className="rounded border-zinc-700 bg-zinc-950 text-indigo-600 focus:ring-indigo-500"
          />
          <span className="font-mono text-xs text-zinc-200">{fieldVal ? 'true' : 'false'}</span>
        </label>
      );
    }

    // 10. Numeric input
    if (typeof fieldVal === 'number') {
      const isFloat =
        !Number.isInteger(fieldVal) ||
        keyLower.includes('strength') ||
        keyLower.includes('cfg') ||
        keyLower.includes('denoise') ||
        keyLower.includes('megapixels') ||
        keyLower.includes('temperature') ||
        keyLower.includes('p') ||
        keyLower.includes('penalty');
      return (
        <input
          type="number"
          step={isFloat ? '0.05' : '1'}
          value={fieldVal}
          onChange={(e) => {
            const parsed = e.target.value === '' ? 0 : Number(e.target.value);
            onNodeFieldChange(nodeId, fieldKey, Number.isNaN(parsed) ? 0 : parsed);
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
          onChange={(e) => onNodeFieldChange(nodeId, fieldKey, e.target.value)}
          className="w-full p-2.5 bg-zinc-950 border border-zinc-800 rounded-lg font-mono text-xs text-zinc-100"
        />
      );
    }

    return (
      <input
        type="text"
        value={strVal}
        onChange={(e) => onNodeFieldChange(nodeId, fieldKey, e.target.value)}
        className="w-full px-2.5 py-1.5 bg-zinc-950 border border-zinc-800 rounded-lg font-mono text-xs text-zinc-100"
      />
    );
  };

  return (
    <div className="space-y-4">
      {/* Node Search / Filter Bar */}
      <div className="flex items-center justify-between gap-3">
        <input
          type="text"
          value={nodeSearchFilter}
          onChange={(e) => onChangeSearchFilter(e.target.value)}
          placeholder="Filter nodes by title, ID, class_type, or parameter name (e.g. lora, unet, sampler)..."
          className="w-full px-3 py-2 bg-zinc-950 border border-zinc-800 rounded-lg text-xs text-zinc-100"
        />
        <span className="text-[11px] font-mono text-zinc-400 whitespace-nowrap shrink-0">
          {filteredNodeEntries.length} / {Object.keys(draftGraph || {}).length} nodes
        </span>
      </div>

      <div className="space-y-3 max-h-[620px] overflow-y-auto pr-1">
        {filteredNodeEntries.map(([nodeId, nodeObj]) => {
          const title = String(nodeObj._meta?.title || nodeObj.class_type || `Node ${nodeId}`);
          const classType = String(nodeObj.class_type || 'UnknownNode');
          const inputs = nodeObj.inputs && typeof nodeObj.inputs === 'object' ? nodeObj.inputs : {};
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
                <PowerLoraLoaderEditor
                  nodeId={nodeId}
                  entries={powerLoraEntries}
                  loraOptions={loraOptions}
                  onChange={onPowerLoraChange}
                  onAddSlot={onAddPowerLoraSlot}
                />
              )}

              {/* Regular Node Inputs */}
              {regularInputEntries.length === 0 && !isPowerLora ? (
                <p className="text-zinc-500 font-mono text-[11px] italic">No editable inputs</p>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {regularInputEntries.map(([key, val]) => (
                    <div key={key} className="space-y-1 min-w-0">
                      <label className="block text-[11px] font-mono text-zinc-400 truncate" title={key}>
                        {key}
                      </label>
                      {renderNodeInputControl(nodeId, nodeObj, key, val)}
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};
