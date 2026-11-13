import React from 'react';
import type { QueuedGhostCardItem } from '../../shared/types.ts';

interface PendingGhostOverlayProps {
  ghost: QueuedGhostCardItem;
  compact?: boolean;
}

/**
 * Translucent live Pending / Progress overlay rendered on top of an existing
 * series stack's poster thumbnail while a new iteration or upscale is queued/sampling.
 */
export const PendingGhostOverlay: React.FC<PendingGhostOverlayProps> = ({
  ghost,
  compact = false,
}) => {
  const isQueuedOnly = ghost.state === 'queued' || ghost.progressPercent === null;
  const displayPct = Math.min(100, Math.max(0, ghost.progressPercent ?? 0));

  return (
    <div
      aria-busy="true"
      className={`absolute inset-0 z-20 bg-black/55 backdrop-blur-[2px] flex flex-col items-center justify-center text-center pointer-events-none select-none ${
        compact ? 'p-2' : 'p-4'
      }`}
    >
      {isQueuedOnly ? (
        <div className="flex flex-col items-center gap-1.5 sm:gap-2">
          <span className="w-2.5 h-2.5 rounded-full bg-indigo-400 animate-pulse shadow-[0_0_8px_rgba(129,140,248,0.85)]" />
          <span
            className={`font-medium tracking-wider uppercase text-zinc-100 drop-shadow ${
              compact ? 'text-[10px]' : 'text-xs'
            }`}
          >
            Pending
          </span>
        </div>
      ) : (
        <div
          className={`flex flex-col items-center w-full ${
            compact ? 'gap-1.5 max-w-[85px]' : 'gap-2.5 max-w-[140px]'
          }`}
        >
          <span
            className={`font-mono font-semibold tabular-nums text-indigo-300 tracking-tight drop-shadow ${
              compact ? 'text-base sm:text-lg' : 'text-2xl sm:text-3xl'
            }`}
          >
            {displayPct}%
          </span>
          <div className="w-full h-1.5 bg-zinc-900/90 border border-zinc-700/60 rounded-full overflow-hidden">
            <div
              className="h-full bg-indigo-500 transition-all duration-300 ease-out rounded-full"
              style={{ width: `${displayPct}%` }}
            />
          </div>
        </div>
      )}
    </div>
  );
};
