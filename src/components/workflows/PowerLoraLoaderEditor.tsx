import React from 'react';
import { Layers, Plus, Trash2 } from 'lucide-react';

export interface PowerLoraEntry {
  key?: string;
  on: boolean;
  lora: string;
  strength: number;
}

/**
 * Checks whether a ComfyUI node is a Power Lora Loader (rgthree) node.
 */
export function isPowerLoraLoaderNode(nodeObj: any): boolean {
  if (!nodeObj || typeof nodeObj !== 'object') return false;
  const ct = String(nodeObj.class_type || '').toLowerCase();
  const inputs = nodeObj.inputs || {};
  return ct.includes('power lora loader') || 'PowerLoraLoaderHeaderWidget' in inputs;
}

/**
 * Extracts ordered lora_1, lora_2, ... entries from a Power Lora Loader node's inputs.
 */
export function extractPowerLoraEntries(inputs: Record<string, any>): PowerLoraEntry[] {
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
export function applyPowerLoraEntriesToInputs(
  inputs: Record<string, any>,
  entries: PowerLoraEntry[]
): Record<string, any> {
  const nextInputs: Record<string, any> = {};

  if (inputs.PowerLoraLoaderHeaderWidget) {
    nextInputs.PowerLoraLoaderHeaderWidget = inputs.PowerLoraLoaderHeaderWidget;
  } else {
    nextInputs.PowerLoraLoaderHeaderWidget = { type: 'PowerLoraLoaderHeaderWidget' };
  }

  const remainingInputs: Record<string, any> = {};
  for (const [k, v] of Object.entries(inputs || {})) {
    if (k !== 'PowerLoraLoaderHeaderWidget' && k !== '➕ Add Lora' && !/^lora_\d+$/i.test(k)) {
      remainingInputs[k] = v;
    }
  }

  entries.forEach((entry, idx) => {
    nextInputs[`lora_${idx + 1}`] = {
      on: Boolean(entry.on),
      lora: entry.lora || '',
      strength: Number(entry.strength ?? 1.0),
    };
  });

  nextInputs['➕ Add Lora'] = inputs['➕ Add Lora'] !== undefined ? inputs['➕ Add Lora'] : '';

  for (const [k, v] of Object.entries(remainingInputs)) {
    nextInputs[k] = v;
  }

  return nextInputs;
}

export interface PowerLoraLoaderEditorProps {
  nodeId: string;
  entries: PowerLoraEntry[];
  loraOptions: string[];
  onChange: (nodeId: string, updatedEntries: PowerLoraEntry[]) => void;
  onAddSlot: (nodeId: string, currentEntries: PowerLoraEntry[]) => void;
}

/**
 * Interactive editor for rgthree Power Lora Loader nodes with multi-slot management,
 * enable toggles, step-precision strength control, and deletion.
 */
export const PowerLoraLoaderEditor: React.FC<PowerLoraLoaderEditorProps> = ({
  nodeId,
  entries,
  loraOptions,
  onChange,
  onAddSlot,
}) => {
  return (
    <div className="p-3.5 bg-zinc-900/90 border border-indigo-500/30 rounded-lg space-y-3 min-w-0">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <span className="font-medium text-indigo-300 flex items-center gap-1.5 text-xs sm:text-sm">
            <Layers className="w-4 h-4 text-indigo-400 shrink-0" />
            <span>
              Power Lora Loader — Multiple LoRAs ({entries.length})
            </span>
          </span>
          <span className="text-[11px] text-zinc-400 hidden sm:inline">
            Discovered in <code className="text-zinc-300 font-mono">loras/</code>
          </span>
        </div>
        <button
          type="button"
          onClick={() => onAddSlot(nodeId, entries)}
          className="inline-flex items-center gap-1 px-2.5 py-1 bg-indigo-600 hover:bg-indigo-500 text-white rounded-md text-xs font-medium cursor-pointer shrink-0 transition-colors shadow-sm"
          title="Add a new LoRA slot to this loader"
        >
          <Plus className="w-3.5 h-3.5" />
          <span>Add LoRA</span>
        </button>
      </div>

      {entries.length === 0 ? (
        <div className="py-4 px-3 text-center border border-dashed border-zinc-800 rounded-lg bg-zinc-950/60 space-y-2">
          <p className="text-xs text-zinc-400">
            No LoRAs attached to this node yet.
          </p>
          <button
            type="button"
            onClick={() => onAddSlot(nodeId, entries)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-xs font-medium cursor-pointer transition-colors shadow-sm"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Add First LoRA</span>
          </button>
        </div>
      ) : (
        <div className="space-y-2">
          {entries.map((entry, idx) => {
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
                      const next = [...entries];
                      next[idx] = { ...entry, on: e.target.checked };
                      onChange(nodeId, next);
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
                      const next = [...entries];
                      next[idx] = { ...entry, lora: e.target.value };
                      onChange(nodeId, next);
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
                      const next = [...entries];
                      next[idx] = {
                        ...entry,
                        strength: Number.isNaN(val) ? 1.0 : val,
                      };
                      onChange(nodeId, next);
                    }}
                    className="w-16 px-1 py-0.5 bg-zinc-950 border border-zinc-700 rounded font-mono tabular-nums text-xs text-zinc-100 text-right focus:outline-none focus:border-indigo-500"
                  />
                </div>

                <button
                  type="button"
                  onClick={() => {
                    const next = entries.filter((_, i) => i !== idx);
                    onChange(nodeId, next);
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
            onClick={() => onAddSlot(nodeId, entries)}
            className="w-full py-1.5 border border-dashed border-zinc-700/80 hover:border-indigo-500 hover:text-indigo-300 text-zinc-400 rounded-lg text-xs font-medium flex items-center justify-center gap-1.5 transition-colors cursor-pointer bg-zinc-950/40 hover:bg-indigo-950/20"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Add Another LoRA Slot</span>
          </button>
        </div>
      )}
    </div>
  );
};
