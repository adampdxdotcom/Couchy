import React, { useMemo, useState } from 'react';
import type { LoraExplorerItem } from '../../shared/types.ts';

interface CreateCharacterModalProps {
  isOpen: boolean;
  loras?: LoraExplorerItem[];
  onClose: () => void;
  onSubmit: (data: {
    name: string;
    aliases: string[];
    description: string;
    physicalDescription: string;
    notes: string;
    loraName?: string;
    triggerWord?: string;
  }) => Promise<void>;
}

const formatLoraLabel = (lora: LoraExplorerItem): string => {
  const baseLabel =
    lora.name && lora.name !== lora.filename ? `${lora.name} (${lora.filename})` : lora.filename;
  const suffix = !lora.isInstalled ? ' [Not installed]' : '';
  return `${baseLabel}${suffix}`;
};

export const CreateCharacterModal: React.FC<CreateCharacterModalProps> = ({
  isOpen,
  loras = [],
  onClose,
  onSubmit,
}) => {
  const [name, setName] = useState('');
  const [aliases, setAliases] = useState('');
  const [loraName, setLoraName] = useState('');
  const [triggerWord, setTriggerWord] = useState('');
  const [desc, setDesc] = useState('');
  const [physicalDesc, setPhysicalDesc] = useState('');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Prioritize character-classified and installed LoRAs for quicker selection
  const { characterLoras, otherLoras, availableLoras } = useMemo(() => {
    const visible = loras.filter((l) => !l.isHidden);
    const rank = (l: LoraExplorerItem) => {
      const catRank =
        l.loraCategory === 'character' ? 0 : l.loraCategory === 'unclassified' ? 1 : 2;
      const installRank = l.isInstalled ? 0 : 1;
      return catRank * 10 + installRank;
    };
    const sorted = [...visible].sort((a, b) => {
      const diff = rank(a) - rank(b);
      if (diff !== 0) return diff;
      return (a.name || a.filename).localeCompare(b.name || b.filename);
    });
    return {
      characterLoras: sorted.filter((l) => l.loraCategory === 'character'),
      otherLoras: sorted.filter((l) => l.loraCategory !== 'character'),
      availableLoras: sorted,
    };
  }, [loras]);

  if (!isOpen) return null;

  const selectedLora = loraName
    ? availableLoras.find((l) => l.filename === loraName) || null
    : null;

  const resetForm = () => {
    setName('');
    setAliases('');
    setLoraName('');
    setTriggerWord('');
    setDesc('');
    setPhysicalDesc('');
    setNotes('');
    setError(null);
  };

  const handleClose = () => {
    if (isSubmitting) return;
    resetForm();
    onClose();
  };

  const handleLoraChange = (nextFilename: string) => {
    setLoraName(nextFilename);
    if (!nextFilename) {
      setTriggerWord('');
      return;
    }
    const matched = availableLoras.find((l) => l.filename === nextFilename);
    // Prefill trigger word from LoRA metadata when selected
    setTriggerWord(matched?.triggerWord?.trim() || '');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || isSubmitting) return;
    setIsSubmitting(true);
    setError(null);
    try {
      await onSubmit({
        name: name.trim(),
        aliases: aliases
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean),
        description: desc.trim(),
        physicalDescription: physicalDesc.trim(),
        notes: notes.trim(),
        ...(loraName
          ? {
              loraName,
              triggerWord: triggerWord.trim(),
            }
          : {}),
      });
      resetForm();
      onClose();
    } catch (err: any) {
      setError(err?.message || 'Failed to create character profile.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4">
      <form
        onSubmit={handleSubmit}
        className="bg-zinc-900 border border-zinc-800 rounded-xl max-w-md w-full max-h-[90vh] overflow-y-auto p-6 space-y-4 text-xs"
      >
        <h3 className="text-base font-display font-semibold text-zinc-100">
          Create Character Profile
        </h3>
        {error && (
          <div className="px-3 py-2 rounded-lg bg-rose-500/10 border border-rose-500/30 text-rose-300">
            {error}
          </div>
        )}
        <div>
          <label className="block text-zinc-300 mb-1">Character Name *</label>
          <input
            type="text"
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Elena Vance"
            className="w-full px-3 py-2 bg-zinc-950 border border-zinc-800 rounded-lg text-zinc-100"
          />
        </div>
        <div>
          <label className="block text-zinc-300 mb-1">
            Aliases / Prompt Triggers (comma-separated)
          </label>
          <input
            type="text"
            value={aliases}
            onChange={(e) => setAliases(e.target.value)}
            placeholder="e.g. elena_v, Lady Elena, Agent Vance"
            className="w-full px-3 py-2 bg-zinc-950 border border-zinc-800 rounded-lg text-zinc-100"
          />
        </div>
        <div className="space-y-2.5 p-3 rounded-lg bg-zinc-950/60 border border-zinc-800/80">
          <div>
            <label className="block text-zinc-300 mb-1">
              Character LoRA (Optional)
            </label>
            <select
              value={loraName}
              onChange={(e) => handleLoraChange(e.target.value)}
              className="w-full px-3 py-2 bg-zinc-950 border border-zinc-800 rounded-lg text-zinc-100"
            >
              <option value="">None — link a LoRA later</option>
              {characterLoras.length > 0 && (
                <optgroup label="Character LoRAs">
                  {characterLoras.map((l) => (
                    <option key={l.filename} value={l.filename}>
                      {formatLoraLabel(l)}
                    </option>
                  ))}
                </optgroup>
              )}
              {otherLoras.length > 0 && (
                <optgroup label={characterLoras.length > 0 ? 'Other LoRAs' : 'Available LoRAs'}>
                  {otherLoras.map((l) => (
                    <option key={l.filename} value={l.filename}>
                      {formatLoraLabel(l)}
                    </option>
                  ))}
                </optgroup>
              )}
            </select>
          </div>
          {loraName && (
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-zinc-300">LoRA Trigger Word</label>
                {selectedLora?.triggerWord?.trim() ? (
                  <span className="text-[10px] text-indigo-300">Prefilled from LoRA</span>
                ) : (
                  <span className="text-[10px] text-zinc-500">None stored on LoRA</span>
                )}
              </div>
              <input
                type="text"
                value={triggerWord}
                onChange={(e) => setTriggerWord(e.target.value)}
                placeholder="e.g. elena_v (optional)"
                className="w-full px-3 py-2 font-mono bg-zinc-950 border border-zinc-800 rounded-lg text-indigo-200 focus:outline-none focus:border-indigo-500"
              />
            </div>
          )}
        </div>
        <div>
          <label className="block text-zinc-300 mb-1">Personality / Bio</label>
          <textarea
            rows={2}
            value={desc}
            onChange={(e) => setDesc(e.target.value)}
            placeholder="Demeanor, role, vibe, or backstory..."
            className="w-full p-2.5 bg-zinc-950 border border-zinc-800 rounded-lg text-zinc-100"
          />
        </div>
        <div>
          <label className="block text-zinc-300 mb-1">Physical Description (Optional Guide)</label>
          <textarea
            rows={2}
            value={physicalDesc}
            onChange={(e) => setPhysicalDesc(e.target.value)}
            placeholder="Hair color, eyes, skin tone, build (or auto-analyze from portrait later)..."
            className="w-full p-2.5 bg-zinc-950 border border-zinc-800 rounded-lg text-zinc-100"
          />
        </div>
        <div>
          <label className="block text-zinc-300 mb-1">Notes</label>
          <textarea
            rows={2}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Recommended LoRA weights, checkpoints, or workflow notes..."
            className="w-full p-2.5 bg-zinc-950 border border-zinc-800 rounded-lg text-zinc-100"
          />
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <button
            type="button"
            onClick={handleClose}
            disabled={isSubmitting}
            className="px-3.5 py-2 bg-zinc-800 text-zinc-300 rounded-lg cursor-pointer disabled:opacity-40"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={isSubmitting}
            className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white font-medium rounded-lg cursor-pointer"
          >
            {isSubmitting ? 'Creating...' : 'Create Profile'}
          </button>
        </div>
      </form>
    </div>
  );
};
