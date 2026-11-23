import React, { useEffect, useRef, useState } from 'react';
import { Pencil } from 'lucide-react';

interface InlineEditableTitleProps {
  value: string;
  /** Changing this key resets any in-progress edit when switching records. */
  resetKey: string | number;
  editTooltip: string;
  ariaLabel: string;
  onCommit: (nextValue: string) => Promise<void>;
}

/**
 * Click-to-edit H1 title with inline pencil trigger, matching CharacterProfileHeader behavior:
 * Enter or blur saves non-empty changes; Escape or blank input reverts cleanly.
 */
export const InlineEditableTitle: React.FC<InlineEditableTitleProps> = ({
  value,
  resetKey,
  editTooltip,
  ariaLabel,
  onCommit,
}) => {
  const [draft, setDraft] = useState(value);
  const [isEditing, setIsEditing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setDraft(value);
    setIsEditing(false);
  }, [resetKey, value]);

  const startEditing = () => {
    setDraft(value);
    setIsEditing(true);
    requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    });
  };

  const cancelEdit = () => {
    setDraft(value);
    setIsEditing(false);
  };

  const commitEdit = async () => {
    if (isSaving) return;
    const trimmed = draft.trim();
    if (!trimmed || trimmed === value) {
      cancelEdit();
      return;
    }
    setIsSaving(true);
    try {
      await onCommit(trimmed);
      setIsEditing(false);
    } catch {
      cancelEdit();
    } finally {
      setIsSaving(false);
    }
  };

  if (isEditing) {
    return (
      <input
        ref={inputRef}
        type="text"
        value={draft}
        disabled={isSaving}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          void commitEdit();
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            void commitEdit();
          } else if (e.key === 'Escape') {
            e.preventDefault();
            cancelEdit();
          }
        }}
        aria-label={ariaLabel}
        className="w-full max-w-xl px-2 py-0.5 -ml-2 text-xl sm:text-2xl font-display font-bold text-zinc-100 bg-zinc-950/90 border border-indigo-500/70 rounded-lg focus:outline-none focus:ring-1 focus:ring-indigo-500"
      />
    );
  }

  return (
    <div className="inline-flex items-center gap-2 max-w-full group">
      <h1
        onClick={startEditing}
        title={editTooltip}
        className="text-xl sm:text-2xl font-display font-bold text-zinc-100 hover:text-white break-words cursor-text transition-colors"
      >
        {value}
      </h1>
      <button
        type="button"
        onClick={startEditing}
        title={editTooltip}
        aria-label={ariaLabel}
        className="p-1 rounded-md text-zinc-500 hover:text-indigo-300 group-hover:text-zinc-300 hover:bg-zinc-800/70 transition-colors cursor-pointer shrink-0"
      >
        <Pencil className="w-4 h-4" />
      </button>
    </div>
  );
};
