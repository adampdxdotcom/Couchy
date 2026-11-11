import React from 'react';

interface CreateCharacterModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (data: {
    name: string;
    aliases: string[];
    description: string;
    notes: string;
  }) => Promise<void>;
}

export const CreateCharacterModal: React.FC<CreateCharacterModalProps> = ({
  isOpen,
  onClose,
  onSubmit,
}) => {
  const [name, setName] = React.useState('');
  const [aliases, setAliases] = React.useState('');
  const [desc, setDesc] = React.useState('');
  const [notes, setNotes] = React.useState('');
  const [isSubmitting, setIsSubmitting] = React.useState(false);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || isSubmitting) return;
    setIsSubmitting(true);
    try {
      await onSubmit({
        name: name.trim(),
        aliases: aliases
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean),
        description: desc.trim(),
        notes: notes.trim(),
      });
      setName('');
      setAliases('');
      setDesc('');
      setNotes('');
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
          Create Character Profile
        </h3>
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
        <div>
          <label className="block text-zinc-300 mb-1">Description</label>
          <textarea
            rows={2}
            value={desc}
            onChange={(e) => setDesc(e.target.value)}
            className="w-full p-2.5 bg-zinc-950 border border-zinc-800 rounded-lg text-zinc-100"
          />
        </div>
        <div>
          <label className="block text-zinc-300 mb-1">Notes</label>
          <textarea
            rows={2}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            className="w-full p-2.5 bg-zinc-950 border border-zinc-800 rounded-lg text-zinc-100"
          />
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
