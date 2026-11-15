import React from 'react';
import { Cpu, Layers, Search, User, X } from 'lucide-react';
import { DEFAULT_PILL_TYPE_SETTINGS, PILL_COLOR_STYLES } from '../../shared/pillSettings.ts';
import type { PillTypeSettings } from '../../shared/types.ts';
import { CharacterPortraitImage } from '../character/CharacterPortraitImage.tsx';
import {
  getCleanLoraLabel,
  getCleanModelMentionLabel,
  type MentionEntry,
  type MentionTab,
} from './quickGenUtils.ts';

interface QuickGenMentionPopoverProps {
  entries: MentionEntry[];
  counts: { all: number; characters: number; loras: number; models: number };
  activeTab: MentionTab;
  activeIndex: number;
  query: string;
  highlightedEntry: MentionEntry | null;
  pillTypeSettings?: PillTypeSettings;
  onQueryChange: (query: string) => void;
  onTabChange: (tab: MentionTab) => void;
  onHoverIndex: (index: number) => void;
  onSelect: (entry: MentionEntry) => void;
  onClose: () => void;
}

/**
 * Two-column @Character & @LoRA mention picker popover with live search, filter tabs, and preview.
 */
export const QuickGenMentionPopover: React.FC<QuickGenMentionPopoverProps> = ({
  entries,
  counts,
  activeTab,
  activeIndex,
  query,
  highlightedEntry,
  pillTypeSettings = DEFAULT_PILL_TYPE_SETTINGS,
  onQueryChange,
  onTabChange,
  onHoverIndex,
  onSelect,
  onClose,
}) => {
  const charStyle = PILL_COLOR_STYLES[pillTypeSettings.character.color];
  const baseModelStyle = PILL_COLOR_STYLES[pillTypeSettings.baseModel.color];
  const loraStyle = PILL_COLOR_STYLES[pillTypeSettings.lora.color];
  return (
    <div className="mb-2 mx-2 md:mx-0 bg-zinc-950/98 backdrop-blur-2xl border border-zinc-800 rounded-3xl shadow-2xl overflow-hidden text-xs max-w-[calc(100vw-1rem)]">
      {/* Top Search Header */}
      <div className="px-4 py-3 border-b border-zinc-800/80 flex items-center gap-3">
        <div className="relative flex-1 min-w-0">
          <Search className="w-3.5 h-3.5 text-zinc-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={query}
            onChange={(e) => onQueryChange(e.target.value)}
            placeholder="Search characters, nicknames, or trigger words..."
            className="w-full pl-8 pr-3 py-1.5 bg-zinc-900 border border-indigo-500/60 rounded-full text-zinc-100 placeholder-zinc-500 focus:outline-none"
          />
        </div>
        <button
          type="button"
          onClick={onClose}
          className="p-1.5 text-zinc-400 hover:text-zinc-200 rounded-full hover:bg-zinc-900 cursor-pointer shrink-0"
          title="Close mention picker"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Filter Tabs: All | Characters | LoRAs | Models */}
      <div className="px-4 py-2 border-b border-zinc-800/80 bg-zinc-900/40 flex items-center gap-1.5 overflow-x-auto">
        {(
          [
            { id: 'all', label: 'All', count: counts.all },
            { id: 'characters', label: 'Characters', count: counts.characters },
            { id: 'loras', label: 'LoRAs', count: counts.loras },
            { id: 'models', label: 'Models', count: counts.models },
          ] as const
        ).map((tab) => {
          const isTabActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => onTabChange(tab.id)}
              className={`px-3 py-1 rounded-full text-[11px] font-medium transition-colors cursor-pointer whitespace-nowrap shrink-0 flex items-center gap-1.5 ${
                isTabActive
                  ? tab.id === 'models'
                    ? 'bg-emerald-600 text-white shadow-sm'
                    : 'bg-indigo-600 text-white shadow-sm'
                  : 'bg-zinc-900 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800'
              }`}
            >
              <span>{tab.label}</span>
              <span
                className={`font-mono text-[10px] tabular-nums ${
                  isTabActive ? 'text-white/80' : 'text-zinc-500'
                }`}
              >
                {tab.count}
              </span>
            </button>
          );
        })}
      </div>

      {entries.length === 0 ? (
        <div className="p-6 text-center text-zinc-400">
          {activeTab === 'models'
            ? 'No matching @mention Base Models found. Enable @mention on Base Models in the Models workspace!'
            : activeTab === 'loras'
            ? 'No matching @mention LoRAs found. Enable LoRAs and set nicknames in the LoRA Explorer!'
            : activeTab === 'characters'
            ? 'No matching characters found. Create a character in the Characters tab to @mention them.'
            : 'No matching characters, @mentioned LoRAs, or Base Models found.'}
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-12 max-h-[380px]">
          {/* Left Column: Character, LoRA & Image Matches */}
          <div className="sm:col-span-6 p-2.5 overflow-y-auto max-h-[360px] space-y-1 border-r border-zinc-800/70">
            {entries.map((entry, idx) => {
              const isSelected = idx === activeIndex;
              return (
                <button
                  key={entry.key}
                  type="button"
                  onMouseEnter={() => onHoverIndex(idx)}
                  onClick={() => onSelect(entry)}
                  className={`w-full flex items-center gap-3 px-2.5 py-2 rounded-2xl text-left transition-colors cursor-pointer ${
                    isSelected
                      ? 'bg-zinc-800/95 text-zinc-100'
                      : 'hover:bg-zinc-900/80 text-zinc-300'
                  }`}
                >
                  <div className="w-9 h-9 rounded-xl bg-zinc-900 border border-zinc-700/60 overflow-hidden shrink-0 flex items-center justify-center">
                    {entry.type === 'lora' ? (
                      <div className={`w-full h-full flex items-center justify-center ${loraStyle.iconBg}`}>
                        <Layers className="w-4 h-4" />
                      </div>
                    ) : entry.type === 'model' ? (
                      entry.thumbnailUrl ? (
                        <img
                          src={entry.thumbnailUrl}
                          alt={entry.title}
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        <div className={`w-full h-full flex items-center justify-center ${baseModelStyle.iconBg}`}>
                          <Cpu className="w-4 h-4" />
                        </div>
                      )
                    ) : (
                      <CharacterPortraitImage
                        src={entry.thumbnailUrl}
                        alt={entry.title}
                        crop={entry.type === 'character' ? entry.character?.portraitCrop : null}
                        iconClassName="w-4 h-4 text-zinc-500"
                      />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <span className="font-medium text-zinc-100 truncate">{entry.title}</span>
                      {entry.type === 'lora' && (
                        <span className={`text-[10px] uppercase font-mono px-1.5 py-0.2 rounded border shrink-0 ${loraStyle.badge}`}>
                          LoRA
                        </span>
                      )}
                      {entry.type === 'model' && (
                        <span className={`text-[10px] uppercase font-mono px-1.5 py-0.2 rounded border shrink-0 ${baseModelStyle.badge}`}>
                          Model
                        </span>
                      )}
                    </div>
                    <div className="text-[11px] text-zinc-400 flex items-center gap-1.5">
                      <span>{entry.subtitle}</span>
                      {entry.type === 'character' && entry.character && entry.character.loras.length > 0 && (
                        <span className={`font-mono truncate ${charStyle.icon}`}>
                          · {entry.character.loras[0].triggerWord || entry.character.loras[0].loraName}
                        </span>
                      )}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>

          {/* Right Column: Large Preview & "Add to prompt" Action */}
          {highlightedEntry && (
            <div className="sm:col-span-6 p-3.5 flex flex-col justify-between bg-zinc-950/60">
              <div className="relative rounded-2xl bg-zinc-900 border border-zinc-800/80 overflow-hidden h-56 flex items-center justify-center">
                {highlightedEntry.type === 'lora' ? (
                  <div className="flex flex-col items-center gap-2.5 p-4 text-center">
                    <div className={`w-12 h-12 rounded-2xl border flex items-center justify-center shadow-inner ${loraStyle.iconBg}`}>
                      <Layers className="w-6 h-6" />
                    </div>
                    <div className="text-sm font-semibold text-zinc-100">
                      {getCleanLoraLabel(highlightedEntry.loraItem || { name: highlightedEntry.title })}
                    </div>
                    <div className="text-[11px] text-zinc-400 flex items-center gap-2">
                      <span className="capitalize">{highlightedEntry.loraItem?.loraCategory}</span>
                      <span>·</span>
                      <span className={`font-mono ${loraStyle.textAccent}`}>
                        Strength: {(highlightedEntry.loraItem?.defaultModelStrength ?? 1.0).toFixed(1)}x
                      </span>
                    </div>
                  </div>
                ) : highlightedEntry.type === 'model' ? (
                  highlightedEntry.thumbnailUrl ? (
                    <img
                      src={highlightedEntry.thumbnailUrl}
                      alt={highlightedEntry.title}
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <div className="flex flex-col items-center gap-2.5 p-4 text-center">
                      <div className={`w-12 h-12 rounded-2xl border flex items-center justify-center shadow-inner ${baseModelStyle.iconBg}`}>
                        <Cpu className="w-6 h-6" />
                      </div>
                      <div className="text-sm font-semibold text-zinc-100">
                        {getCleanModelMentionLabel(
                          highlightedEntry.modelItem || { name: highlightedEntry.title }
                        )}
                      </div>
                      {highlightedEntry.modelItem?.llmDescription && (
                        <p className="text-[11px] text-zinc-400 line-clamp-3 max-w-xs">
                          {highlightedEntry.modelItem.llmDescription}
                        </p>
                      )}
                    </div>
                  )
                ) : highlightedEntry.thumbnailUrl ? (
                  highlightedEntry.type === 'character' &&
                  highlightedEntry.character?.portraitCrop &&
                  highlightedEntry.thumbnailUrl === highlightedEntry.character.portraitThumbnailUrl ? (
                    <CharacterPortraitImage
                      src={highlightedEntry.thumbnailUrl}
                      alt={highlightedEntry.title}
                      crop={highlightedEntry.character.portraitCrop}
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <img
                      src={highlightedEntry.thumbnailUrl}
                      alt={highlightedEntry.title}
                      className="w-full h-full object-contain"
                    />
                  )
                ) : (
                  <div className="flex flex-col items-center gap-2 text-zinc-500">
                    <User className="w-10 h-10 stroke-1" />
                    <span>{highlightedEntry.character?.name}</span>
                  </div>
                )}
                <div className="absolute bottom-2 left-2 right-2 px-2.5 py-1.5 rounded-xl bg-zinc-950/85 backdrop-blur-md border border-zinc-800/80 flex items-center justify-between text-[11px]">
                  <span className="font-medium text-zinc-200 truncate">
                    {highlightedEntry.type === 'lora'
                      ? getCleanLoraLabel(highlightedEntry.loraItem || { name: highlightedEntry.title })
                      : highlightedEntry.type === 'model'
                      ? getCleanModelMentionLabel(
                          highlightedEntry.modelItem || { name: highlightedEntry.title }
                        )
                      : highlightedEntry.character?.name}
                  </span>
                  <span
                    className={`font-mono shrink-0 ml-2 ${
                      highlightedEntry.type === 'model'
                        ? baseModelStyle.textAccent
                        : highlightedEntry.type === 'lora'
                        ? loraStyle.textAccent
                        : charStyle.textAccent
                    }`}
                  >
                    {highlightedEntry.type === 'lora'
                      ? highlightedEntry.loraItem?.isInstalled
                        ? 'Installed'
                        : 'Missing'
                      : highlightedEntry.type === 'model'
                      ? highlightedEntry.modelItem?.isInstalled
                        ? 'Installed'
                        : 'Missing'
                      : `${highlightedEntry.character?.loras.length || 0} LoRA(s)`}
                  </span>
                </div>
              </div>

              <button
                type="button"
                onClick={() => onSelect(highlightedEntry)}
                className="mt-3 w-full py-2 px-4 rounded-full bg-zinc-100 hover:bg-white text-zinc-950 font-semibold text-xs transition-colors cursor-pointer"
              >
                Add to prompt
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
