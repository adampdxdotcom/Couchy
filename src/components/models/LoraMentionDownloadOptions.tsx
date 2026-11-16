import React from 'react';
import { AtSign } from 'lucide-react';
import type { LoraMentionAutomation } from '../../shared/types.ts';

export const DEFAULT_LORA_MENTION_AUTOMATION: LoraMentionAutomation = {
  mentionEnabled: false,
  nickname: '',
};

interface LoraMentionDownloadOptionsProps {
  value: LoraMentionAutomation;
  onChange: (next: LoraMentionAutomation) => void;
  disabled?: boolean;
}

/**
 * Compact Quick Gen @mention tag input and activation checkbox rendered for LoRA downloads.
 */
export const LoraMentionDownloadOptions: React.FC<LoraMentionDownloadOptionsProps> = ({
  value,
  onChange,
  disabled = false,
}) => {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2.5 bg-zinc-950/60 border border-zinc-800/80 rounded-lg px-3 py-2 text-xs">
      <label className="inline-flex items-center gap-2 text-zinc-200 cursor-pointer select-none">
        <input
          type="checkbox"
          disabled={disabled}
          checked={value.mentionEnabled}
          onChange={(e) =>
            onChange({
              ...value,
              mentionEnabled: e.target.checked,
            })
          }
          className="w-3.5 h-3.5 rounded border-zinc-700 bg-zinc-950 text-indigo-600 focus:ring-indigo-500 cursor-pointer disabled:opacity-50"
        />
        <span className="inline-flex items-center gap-1 font-medium">
          <AtSign className="w-3.5 h-3.5 text-amber-400" />
          <span>Enable for @mentions</span>
        </span>
      </label>

      <div className="relative flex-1 min-w-[170px] max-w-[260px]">
        <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-500 font-mono text-[11px]">
          @
        </span>
        <input
          type="text"
          disabled={disabled}
          value={value.nickname}
          onChange={(e) =>
            onChange({
              ...value,
              nickname: e.target.value.replace(/^@+/, ''),
            })
          }
          placeholder="mention tag (optional)"
          aria-label="Quick Gen mention tag"
          className="w-full pl-6 pr-2.5 py-1 bg-zinc-900 border border-zinc-800 focus:border-indigo-500 rounded-md font-mono text-xs text-zinc-100 placeholder-zinc-600 focus:outline-none disabled:opacity-60"
        />
      </div>
    </div>
  );
};
