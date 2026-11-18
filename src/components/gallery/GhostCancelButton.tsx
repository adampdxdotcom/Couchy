import React, { useState } from 'react';
import { Loader2, X } from 'lucide-react';
import type { QueuedGhostCardItem } from '../../shared/types.ts';

interface GhostCancelButtonProps {
  ghost: QueuedGhostCardItem;
  onCancelGhost?: (ghost: QueuedGhostCardItem) => Promise<void> | void;
  variant?: 'corner' | 'pill' | 'mini';
}

/**
 * Reusable immediate-cancel button rendered on Ghost Cards and pending series overlays.
 * Hides once ComfyUI finishes and indexing begins (`state === 'indexing'`).
 */
export const GhostCancelButton: React.FC<GhostCancelButtonProps> = ({
  ghost,
  onCancelGhost,
  variant = 'corner',
}) => {
  const [isCancelling, setIsCancelling] = useState(false);

  if (!onCancelGhost || ghost.state === 'indexing') {
    return null;
  }

  const isBatch = Number(ghost.batchTotalCount || 1) > 1;
  const label = isBatch ? 'Cancel active series batch' : 'Cancel generation';

  const handleClick = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (isCancelling) return;
    setIsCancelling(true);
    try {
      await onCancelGhost(ghost);
    } finally {
      setIsCancelling(false);
    }
  };

  if (variant === 'mini') {
    return (
      <button
        type="button"
        disabled={isCancelling}
        onClick={handleClick}
        aria-label={label}
        title={label}
        className="absolute top-0.5 right-0.5 z-20 pointer-events-auto inline-flex items-center justify-center w-4 h-4 rounded-full bg-black/80 hover:bg-rose-600/90 border border-zinc-700/70 hover:border-rose-400/70 text-zinc-200 hover:text-white transition-colors cursor-pointer disabled:opacity-60 disabled:cursor-wait"
      >
        {isCancelling ? (
          <Loader2 className="w-2.5 h-2.5 animate-spin" />
        ) : (
          <X className="w-2.5 h-2.5" />
        )}
      </button>
    );
  }

  if (variant === 'pill') {
    return (
      <button
        type="button"
        disabled={isCancelling}
        onClick={handleClick}
        aria-label={label}
        title={label}
        className="mt-2 relative z-30 pointer-events-auto inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-zinc-900/90 hover:bg-rose-600/90 border border-zinc-700/80 hover:border-rose-400/70 text-[10px] font-medium text-zinc-200 hover:text-white shadow-sm transition-colors cursor-pointer disabled:opacity-60 disabled:cursor-wait"
      >
        {isCancelling ? (
          <Loader2 className="w-3 h-3 animate-spin" />
        ) : (
          <X className="w-3 h-3" />
        )}
        <span>{isCancelling ? 'Cancelling...' : 'Cancel'}</span>
      </button>
    );
  }

  return (
    <button
      type="button"
      disabled={isCancelling}
      onClick={handleClick}
      aria-label={label}
      title={label}
      className="absolute top-2 right-2 z-30 pointer-events-auto inline-flex items-center justify-center w-6 h-6 rounded-full bg-black/75 hover:bg-rose-600/90 border border-zinc-700/80 hover:border-rose-400/70 text-zinc-200 hover:text-white shadow-sm transition-colors cursor-pointer disabled:opacity-60 disabled:cursor-wait"
    >
      {isCancelling ? (
        <Loader2 className="w-3.5 h-3.5 animate-spin" />
      ) : (
        <X className="w-3.5 h-3.5" />
      )}
    </button>
  );
};
