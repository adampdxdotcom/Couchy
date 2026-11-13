import React from 'react';
import { Layers, User, X } from 'lucide-react';
import type { CharacterProfile, GenerationLoraSelection } from '../../shared/types.ts';
import { getCleanLoraLabel } from './quickGenUtils.ts';

interface QuickGenAttachmentsBarProps {
  attachedCharacter: CharacterProfile | null;
  attachedLoras: GenerationLoraSelection[];
  onRemoveCharacter: () => void;
  onRemoveLora: (loraName: string) => void;
}

/**
 * Displays active attached character and @mentioned LoRA pills with individual removal buttons.
 */
export const QuickGenAttachmentsBar: React.FC<QuickGenAttachmentsBarProps> = ({
  attachedCharacter,
  attachedLoras,
  onRemoveCharacter,
  onRemoveLora,
}) => {
  const visibleLoras = attachedLoras.filter((l) => l.showPill !== false);
  if (!attachedCharacter && visibleLoras.length === 0) return null;

  return (
    <div className="mb-2 flex flex-wrap items-center gap-2">
      {attachedCharacter && (
        <div className="inline-flex items-center gap-2 pl-1.5 pr-2.5 py-1 rounded-full bg-indigo-950/70 border border-indigo-500/40 text-xs text-indigo-200 shadow-sm">
          <div className="w-5 h-5 rounded-full bg-zinc-800 overflow-hidden flex items-center justify-center shrink-0">
            {attachedCharacter.portraitThumbnailUrl ? (
              <img
                src={attachedCharacter.portraitThumbnailUrl}
                alt={attachedCharacter.name}
                className="w-full h-full object-cover"
              />
            ) : (
              <User className="w-3 h-3 text-indigo-300" />
            )}
          </div>
          <span className="font-medium">{attachedCharacter.name}</span>
          {attachedCharacter.loras[0]?.triggerWord && (
            <span className="text-[11px] font-mono text-indigo-300/90">
              ({attachedCharacter.loras[0].triggerWord})
            </span>
          )}
          <button
            type="button"
            onClick={onRemoveCharacter}
            className="text-indigo-300/70 hover:text-white cursor-pointer ml-0.5"
            title="Remove character"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {visibleLoras.map((lora) => {
        const label = getCleanLoraLabel(lora);
        return (
          <div
            key={lora.loraName}
            className="inline-flex items-center gap-1.5 pl-2 pr-2.5 py-1 rounded-full bg-amber-950/60 border border-amber-500/40 text-xs text-amber-200 shadow-sm"
          >
            <Layers className="w-3.5 h-3.5 text-amber-400 shrink-0" />
            <span className="font-medium text-amber-100">{label}</span>
            <span className="text-[11px] font-mono text-amber-300/90 tabular-nums">
              {lora.modelStrength.toFixed(1)}x
            </span>
            <button
              type="button"
              onClick={() => onRemoveLora(lora.loraName)}
              className="text-amber-300/70 hover:text-white cursor-pointer ml-0.5"
              title={`Remove ${label}`}
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        );
      })}
    </div>
  );
};
