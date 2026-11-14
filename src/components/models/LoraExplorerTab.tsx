import React, { useState } from 'react';
import { Eye, EyeOff, LayoutGrid, List, Search } from 'lucide-react';
import { LoraExplorerGrid } from './LoraExplorerGrid.tsx';
import { LoraExplorerTable } from './LoraExplorerTable.tsx';
import type { LoraExplorerItem } from '../../shared/types.ts';

interface LoraExplorerTabProps {
  loras: LoraExplorerItem[];
  onSelectLora: (filename: string) => void;
  onUpdateMentionConfig: (
    loraName: string,
    payload: { mentionEnabled?: boolean; nickname?: string | null }
  ) => Promise<void>;
  onToggleVisibility: (loraName: string, nextHidden: boolean) => Promise<void>;
}

/**
 * Filterable LoRA Explorer workspace supporting Grid and Table views,
 * category filtering, hidden item toggling, and quick @mention/nickname configuration.
 */
export const LoraExplorerTab: React.FC<LoraExplorerTabProps> = ({
  loras,
  onSelectLora,
  onUpdateMentionConfig,
  onToggleVisibility,
}) => {
  const [explorerLayout, setExplorerLayout] = useState<'grid' | 'list'>('grid');
  const [showHiddenLoras, setShowHiddenLoras] = useState(false);
  const [loraSearch, setLoraSearch] = useState('');
  const [loraCategoryFilter, setLoraCategoryFilter] = useState<string>('');
  const [brokenThumbs, setBrokenThumbs] = useState<Record<string, boolean>>({});

  const hiddenCount = loras.filter((l) => l.isHidden).length;

  const filteredLoras = loras.filter((l) => {
    if (!showHiddenLoras && l.isHidden) return false;
    if (loraCategoryFilter && l.loraCategory !== loraCategoryFilter) return false;
    if (!loraSearch.trim()) return true;
    const q = loraSearch.toLowerCase();
    return (
      l.name.toLowerCase().includes(q) ||
      l.filename.toLowerCase().includes(q) ||
      (l.baseModel || '').toLowerCase().includes(q) ||
      (l.triggerWord || '').toLowerCase().includes(q) ||
      (l.sha256Hash || '').toLowerCase().includes(q) ||
      l.characters.some((c) => c.name.toLowerCase().includes(q))
    );
  });

  const handleMarkBrokenThumb = (url: string) => {
    setBrokenThumbs((prev) => ({ ...prev, [url]: true }));
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[240px]">
          <Search className="w-4 h-4 text-zinc-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={loraSearch}
            onChange={(e) => setLoraSearch(e.target.value)}
            placeholder="Search LoRAs by name, filename, base model, trigger, hash, or character..."
            className="w-full pl-9 pr-4 py-2 text-xs bg-zinc-900 border border-zinc-800 rounded-lg text-zinc-100"
          />
        </div>

        <select
          value={loraCategoryFilter}
          onChange={(e) => setLoraCategoryFilter(e.target.value)}
          className="px-3 py-2 text-xs bg-zinc-900 border border-zinc-800 rounded-lg text-zinc-200"
        >
          <option value="">All LoRA Categories</option>
          <option value="character">Character LoRAs</option>
          <option value="style">Style LoRAs</option>
          <option value="clothing">Clothing / Outfit LoRAs</option>
          <option value="concept">Concept LoRAs</option>
          <option value="pose">Pose LoRAs</option>
          <option value="object">Object LoRAs</option>
          <option value="unclassified">Unclassified</option>
        </select>

        <button
          type="button"
          onClick={() => setShowHiddenLoras((prev) => !prev)}
          className={`inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-lg border transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
            showHiddenLoras
              ? 'bg-amber-500/15 border-amber-500/50 text-amber-200'
              : 'bg-zinc-900 border-zinc-800 text-zinc-300 hover:border-zinc-700'
          }`}
          title={showHiddenLoras ? 'Hide hidden LoRAs' : 'Show hidden LoRAs'}
        >
          {showHiddenLoras ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
          <span className="tabular-nums">Show Hidden ({hiddenCount})</span>
        </button>

        <div className="flex items-center p-0.5 bg-zinc-900 border border-zinc-800 rounded-lg">
          <button
            type="button"
            onClick={() => setExplorerLayout('grid')}
            className={`inline-flex items-center gap-1 px-2.5 py-1.5 text-xs rounded-md cursor-pointer whitespace-nowrap shrink-0 ${
              explorerLayout === 'grid'
                ? 'bg-indigo-600 text-white'
                : 'text-zinc-400 hover:text-zinc-200'
            }`}
            title="Grid View"
          >
            <LayoutGrid className="w-3.5 h-3.5" />
            <span>Grid</span>
          </button>
          <button
            type="button"
            onClick={() => setExplorerLayout('list')}
            className={`inline-flex items-center gap-1 px-2.5 py-1.5 text-xs rounded-md cursor-pointer whitespace-nowrap shrink-0 ${
              explorerLayout === 'list'
                ? 'bg-indigo-600 text-white'
                : 'text-zinc-400 hover:text-zinc-200'
            }`}
            title="Table View"
          >
            <List className="w-3.5 h-3.5" />
            <span>List</span>
          </button>
        </div>
      </div>

      {filteredLoras.length === 0 ? (
        <div className="bg-zinc-900/60 border border-zinc-800 rounded-xl p-10 text-center text-xs text-zinc-400 space-y-3">
          <div>
            {!showHiddenLoras && hiddenCount > 0 && loras.length === hiddenCount
              ? `All ${hiddenCount} discovered LoRA(s) are currently hidden.`
              : 'No LoRAs match your current filter or mounted models directory.'}
          </div>
          {!showHiddenLoras && hiddenCount > 0 && (
            <button
              type="button"
              onClick={() => setShowHiddenLoras(true)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-zinc-800 hover:bg-zinc-700 text-zinc-200 rounded-lg cursor-pointer"
            >
              <Eye className="w-3.5 h-3.5" />
              <span>Show Hidden ({hiddenCount})</span>
            </button>
          )}
        </div>
      ) : explorerLayout === 'grid' ? (
        <LoraExplorerGrid
          loras={filteredLoras}
          brokenThumbs={brokenThumbs}
          onMarkBrokenThumb={handleMarkBrokenThumb}
          onSelectLora={onSelectLora}
          onUpdateMentionConfig={onUpdateMentionConfig}
          onToggleVisibility={onToggleVisibility}
        />
      ) : (
        <LoraExplorerTable
          loras={filteredLoras}
          brokenThumbs={brokenThumbs}
          onMarkBrokenThumb={handleMarkBrokenThumb}
          onSelectLora={onSelectLora}
          onUpdateMentionConfig={onUpdateMentionConfig}
          onToggleVisibility={onToggleVisibility}
        />
      )}
    </div>
  );
};
