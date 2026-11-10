import React, { useState } from 'react';
import { Trash2 } from 'lucide-react';
import type {
  CharacterProfile,
  GenerationLoraSelection,
  LoraExplorerItem,
} from '../../shared/types.ts';

export interface CharacterLoraStackPanelProps {
  characters: CharacterProfile[];
  selectedCharacterId: number | null;
  onSelectCharacterId: (id: number | null) => void;
  triggerWord: string;
  onChangeTriggerWord: (val: string) => void;
  activeLoras: GenerationLoraSelection[];
  onChangeActiveLoras: (updater: (prev: GenerationLoraSelection[]) => GenerationLoraSelection[]) => void;
  loras: LoraExplorerItem[];
}

/**
 * Character selector, character trigger word injector (Node #30_27 string_b),
 * and multi-LoRA stack manager for Node #50 Power Lora Loader.
 */
export const CharacterLoraStackPanel: React.FC<CharacterLoraStackPanelProps> = ({
  characters,
  selectedCharacterId,
  onSelectCharacterId,
  triggerWord,
  onChangeTriggerWord,
  activeLoras,
  onChangeActiveLoras,
  loras,
}) => {
  const [extraLoraToAdd, setExtraLoraToAdd] = useState<string>('');

  const handleAddExtraLora = () => {
    if (!extraLoraToAdd) return;
    let knownTrigger = '';
    for (const c of characters) {
      const found = c.loras.find(
        (cl) => cl.loraName.toLowerCase() === extraLoraToAdd.toLowerCase()
      );
      if (found?.triggerWord) {
        knownTrigger = found.triggerWord;
        break;
      }
    }

    onChangeActiveLoras((prev) => [
      ...prev,
      {
        loraName: extraLoraToAdd,
        modelStrength: 1.0,
        clipStrength: 1.0,
        appearanceLabel: 'Additional LoRA',
        triggerWord: knownTrigger,
      },
    ]);

    if (knownTrigger && !triggerWord.includes(knownTrigger)) {
      onChangeTriggerWord(triggerWord.trim() ? `${triggerWord.trim()}, ${knownTrigger}` : knownTrigger);
    }
    setExtraLoraToAdd('');
  };

  return (
    <section className="p-5 bg-zinc-900/60 border border-zinc-800/90 rounded-xl space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-display font-semibold text-zinc-100">
          01. Character, LoRA Stack & Trigger Word
        </h2>
        <span className="text-xs text-zinc-400 font-mono tabular-nums">
          {activeLoras.length} LoRA{activeLoras.length === 1 ? '' : 's'} · Enable LoRA:{' '}
          {activeLoras.length > 0 ? 'ON' : 'OFF'}
        </span>
      </div>

      <div>
        <label className="block text-xs font-medium text-zinc-400 mb-1.5">
          Select Character (Auto-Prefills Character LoRAs & Trigger Word)
        </label>
        <select
          value={selectedCharacterId ?? ''}
          onChange={(e) => onSelectCharacterId(e.target.value ? Number(e.target.value) : null)}
          className="w-full px-3 py-2 text-sm bg-zinc-950 border border-zinc-800 rounded-lg text-zinc-100 focus:outline-none focus:border-indigo-500"
        >
          <option value="">-- Unassigned / Custom Subject --</option>
          {characters.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name} ({c.loras.length} LoRA{c.loras.length === 1 ? '' : 's'} ·{' '}
              {c.confirmedImageCount} images)
            </option>
          ))}
        </select>
      </div>

      {/* Editable Trigger Word for Node #30_27 string_b */}
      <div>
        <div className="flex items-center justify-between mb-1">
          <label className="text-xs font-medium text-zinc-300">
            Character / LoRA Trigger Word (Injected into Node #30_27{' '}
            <code className="text-indigo-300">string_b</code>)
          </label>
          <span className="text-[11px] font-mono text-zinc-500">
            {triggerWord.trim() ? `"${triggerWord.trim()}"` : 'Empty'}
          </span>
        </div>
        <input
          type="text"
          value={triggerWord}
          onChange={(e) => onChangeTriggerWord(e.target.value)}
          placeholder="e.g. xmelx (auto-filled from Character LoRA, editable per run)"
          className="w-full px-3 py-2 text-xs font-mono bg-zinc-950 border border-zinc-800 rounded-lg text-indigo-200 focus:outline-none focus:border-indigo-500"
        />
      </div>

      {/* Active LoRAs list */}
      <div className="space-y-2">
        {activeLoras.length === 0 ? (
          <div className="p-3 bg-zinc-950/60 border border-zinc-800/80 rounded-lg text-xs text-zinc-400">
            No LoRAs active. Node #30_23 (Enable LoRA) will be set to{' '}
            <code className="text-zinc-300">false</code>. Choose a character or add a LoRA below.
          </div>
        ) : (
          activeLoras.map((item, idx) => (
            <div
              key={`${item.loraName}-${idx}`}
              className="p-3 bg-zinc-950 border border-zinc-800 rounded-lg space-y-2"
            >
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-[11px] font-mono text-indigo-400">
                      lora_{idx + 1}
                    </span>
                    <p className="text-xs font-medium text-zinc-100 truncate">
                      {item.loraName}
                    </p>
                  </div>
                  <p className="text-[11px] text-zinc-400">
                    {item.appearanceLabel || 'LoRA'}
                    {item.triggerWord ? ` · Trigger: ${item.triggerWord}` : ''}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => onChangeActiveLoras((prev) => prev.filter((_, i) => i !== idx))}
                  className="p-1 text-zinc-500 hover:text-red-400 rounded cursor-pointer transition-colors"
                  title="Remove LoRA from this generation"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>

              <div className="grid grid-cols-2 gap-3 pt-1">
                <div>
                  <div className="flex justify-between text-[11px] text-zinc-400 mb-1">
                    <span>Strength (Power Lora)</span>
                    <span className="font-mono tabular-nums">
                      {item.modelStrength.toFixed(2)}
                    </span>
                  </div>
                  <input
                    type="range"
                    min="0"
                    max="2"
                    step="0.05"
                    value={item.modelStrength}
                    onChange={(e) => {
                      const val = parseFloat(e.target.value);
                      onChangeActiveLoras((prev) =>
                        prev.map((l, i) =>
                          i === idx ? { ...l, modelStrength: val, clipStrength: val } : l
                        )
                      );
                    }}
                    className="w-full accent-indigo-500 cursor-pointer"
                  />
                </div>
                <div>
                  <div className="flex justify-between text-[11px] text-zinc-400 mb-1">
                    <span>CLIP Strength</span>
                    <span className="font-mono tabular-nums">
                      {item.clipStrength.toFixed(2)}
                    </span>
                  </div>
                  <input
                    type="range"
                    min="0"
                    max="2"
                    step="0.05"
                    value={item.clipStrength}
                    onChange={(e) => {
                      const val = parseFloat(e.target.value);
                      onChangeActiveLoras((prev) =>
                        prev.map((l, i) => (i === idx ? { ...l, clipStrength: val } : l))
                      );
                    }}
                    className="w-full accent-indigo-500 cursor-pointer"
                  />
                </div>
              </div>
            </div>
          ))
        )}

        {/* Add additional LoRA dropdown */}
        <div className="flex items-center gap-2 pt-1">
          <select
            value={extraLoraToAdd}
            onChange={(e) => setExtraLoraToAdd(e.target.value)}
            className="flex-1 px-2.5 py-1.5 text-xs bg-zinc-950 border border-zinc-800 rounded-lg text-zinc-300"
          >
            <option value="">+ Add another LoRA to Power Lora Loader (#50)...</option>
            {loras.map((l) => (
              <option key={l.filename} value={l.filename}>
                {l.name} ({l.loraCategory})
              </option>
            ))}
          </select>
          <button
            type="button"
            disabled={!extraLoraToAdd}
            onClick={handleAddExtraLora}
            className="px-3 py-1.5 text-xs font-medium text-zinc-100 bg-zinc-800 hover:bg-zinc-700 disabled:opacity-40 rounded-lg whitespace-nowrap shrink-0 cursor-pointer transition-colors"
          >
            Add LoRA
          </button>
        </div>
      </div>
    </section>
  );
};
