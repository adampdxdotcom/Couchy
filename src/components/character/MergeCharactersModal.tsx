import React, { useState } from 'react';
import type { CharacterProfile } from '../../shared/types.ts';

interface MergeCharactersModalProps {
  isOpen: boolean;
  characters: CharacterProfile[];
  onClose: () => void;
  onMerge: (targetId: number, sourceId: number) => Promise<void>;
}

export const MergeCharactersModal: React.FC<MergeCharactersModalProps> = ({
  isOpen,
  characters,
  onClose,
  onMerge,
}) => {
  const [mergeTargetId, setMergeTargetId] = useState('');
  const [mergeSourceId, setMergeSourceId] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!mergeTargetId || !mergeSourceId || mergeTargetId === mergeSourceId || isSubmitting) return;
    setIsSubmitting(true);
    try {
      await onMerge(Number(mergeTargetId), Number(mergeSourceId));
      setMergeTargetId('');
      setMergeSourceId('');
      onClose();
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4">
      <form
        onSubmit={handleSubmit}
        className="bg-zinc-900 border border-zinc-800 rounded-xl max-w-md w-full p-6 space-y-4 text-xs"
      >
        <h3 className="text-base font-display font-semibold text-zinc-100">
          Merge Character Profiles
        </h3>
        <p className="text-zinc-400">
          Merging moves all aliases, confirmed/suggested images, associated LoRAs, workflows,
          collections, and notes from the source profile into the destination profile.
        </p>
        <div>
          <label className="block text-zinc-300 mb-1">Keep Primary Character (Target)</label>
          <select
            required
            value={mergeTargetId}
            onChange={(e) => setMergeTargetId(e.target.value)}
            className="w-full px-3 py-2 bg-zinc-950 border border-zinc-800 rounded-lg text-zinc-100"
          >
            <option value="">Select target character...</option>
            {characters.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-zinc-300 mb-1">Merge &amp; Absorb Character (Source)</label>
          <select
            required
            value={mergeSourceId}
            onChange={(e) => setMergeSourceId(e.target.value)}
            className="w-full px-3 py-2 bg-zinc-950 border border-zinc-800 rounded-lg text-zinc-100"
          >
            <option value="">Select source character to merge...</option>
            {characters
              .filter((c) => String(c.id) !== mergeTargetId)
              .map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
          </select>
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <button
            type="button"
            onClick={onClose}
            className="px-3.5 py-2 bg-zinc-800 text-zinc-300 rounded-lg cursor-pointer"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={!mergeTargetId || !mergeSourceId || mergeTargetId === mergeSourceId || isSubmitting}
            className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white font-medium rounded-lg cursor-pointer"
          >
            {isSubmitting ? 'Merging...' : 'Confirm Merge'}
          </button>
        </div>
      </form>
    </div>
  );
};
