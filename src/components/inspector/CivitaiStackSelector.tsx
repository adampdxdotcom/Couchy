import React from 'react';
import { Check } from 'lucide-react';
import type {
  CivitaiShareExcludedItem,
  CivitaiShareStackEligibility,
  CivitaiStackExclusionReason,
} from '../../shared/apiTypes.ts';

interface CivitaiStackSelectorProps {
  stack: CivitaiShareStackEligibility;
  selectedIds: number[];
  disabled?: boolean;
  onToggleImageId: (imageId: number) => void;
  onSelectAll: () => void;
}

const EXCLUSION_CATEGORY_LABEL: Record<CivitaiStackExclusionReason, string> = {
  standalone_upscale: 'upscale',
  uploaded_reference: 'inspiration',
  missing_or_rejected: 'missing/rejected',
  missing_native_metadata: 'no metadata',
  character_restricted: 'character restricted',
  uncharacterized_disabled: '0-char restricted',
};

function summarizeExclusions(excludedItems: CivitaiShareExcludedItem[]): string {
  const counts = new Map<CivitaiStackExclusionReason, number>();
  for (const item of excludedItems) {
    counts.set(item.reasonCode, (counts.get(item.reasonCode) || 0) + 1);
  }
  const parts: string[] = [];
  for (const [code, count] of counts.entries()) {
    const label = EXCLUSION_CATEGORY_LABEL[code] || 'excluded';
    parts.push(`${count} ${label}`);
  }
  return parts.join(' · ');
}

/**
 * Interactive thumbnail grid showing eligible stack steps in exact Civitai upload order
 * with per-step checkboxes and an inline summary of auto-excluded steps.
 */
export const CivitaiStackSelector: React.FC<CivitaiStackSelectorProps> = ({
  stack,
  selectedIds,
  disabled = false,
  onToggleImageId,
  onSelectAll,
}) => {
  const selectedSet = new Set(selectedIds);
  const allSelected = selectedIds.length === stack.eligibleItems.length;

  return (
    <div className="space-y-2.5 pb-4 border-b border-zinc-800/80">
      <div className="flex items-center justify-between gap-2 text-[11px]">
        <div className="text-zinc-300 font-medium font-mono tabular-nums">
          <span>
            Stack order ({selectedIds.length} of {stack.eligibleItems.length} selected)
          </span>
          {stack.posterImageId ? (
            <span className="text-zinc-400 font-sans"> · Cover image first</span>
          ) : null}
        </div>
        {!allSelected && (
          <button
            type="button"
            disabled={disabled}
            onClick={onSelectAll}
            className="text-indigo-400 hover:text-indigo-300 font-medium cursor-pointer disabled:opacity-40 whitespace-nowrap"
          >
            Select all
          </button>
        )}
      </div>

      <div className="grid grid-cols-4 sm:grid-cols-5 gap-2">
        {stack.eligibleItems.map((item, idx) => {
          const isChecked = selectedSet.has(item.imageId);
          return (
            <label
              key={item.imageId}
              className={`group relative rounded-lg overflow-hidden border transition-all select-none block min-h-[44px] ${
                disabled ? 'cursor-not-allowed opacity-70' : 'cursor-pointer'
              } ${
                isChecked
                  ? 'border-indigo-500 bg-zinc-950 ring-1 ring-indigo-500/40'
                  : 'border-zinc-800 bg-zinc-950 opacity-50 hover:opacity-80'
              }`}
              title={`${item.filename} (${item.width}×${item.height})`}
            >
              <input
                type="checkbox"
                checked={isChecked}
                disabled={disabled}
                onChange={() => onToggleImageId(item.imageId)}
                className="sr-only"
                aria-label={`Include ${item.filename} in stack upload`}
              />
              <div className="aspect-square w-full bg-zinc-950 overflow-hidden">
                <img
                  src={item.thumbnailUrl}
                  alt={item.filename}
                  loading="lazy"
                  className="w-full h-full object-cover"
                />
              </div>

              {/* Checkbox indicator */}
              <span
                aria-hidden="true"
                className={`absolute top-1.5 right-1.5 w-4 h-4 rounded flex items-center justify-center border transition-colors ${
                  isChecked
                    ? 'bg-indigo-600 border-indigo-400 text-white'
                    : 'bg-zinc-950/85 border-zinc-600 text-transparent'
                }`}
              >
                <Check className="w-3 h-3 stroke-[2.5]" />
              </span>

              {/* Flat footer index + dimensions */}
              <div className="px-1.5 py-1 bg-zinc-950/95 border-t border-zinc-800/80 flex items-center justify-between gap-1 text-[10px] font-mono tabular-nums">
                <span className={item.isPoster ? 'text-rose-300 font-semibold' : 'text-zinc-300'}>
                  {item.isPoster ? '#1 Cover' : `#${idx + 1}`}
                </span>
                <span className="text-zinc-500 truncate">
                  {item.width}×{item.height}
                </span>
              </div>
            </label>
          );
        })}
      </div>

      {stack.excludedItems.length > 0 && (
        <p
          className="text-[11px] text-zinc-400 font-mono tabular-nums"
          title={stack.excludedItems.map((e) => `${e.filename}: ${e.reason}`).join('\n')}
        >
          Excluded {stack.excludedItems.length} step{stack.excludedItems.length === 1 ? '' : 's'}:{' '}
          {summarizeExclusions(stack.excludedItems)}
        </p>
      )}
    </div>
  );
};
