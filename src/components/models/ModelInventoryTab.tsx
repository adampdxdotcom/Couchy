import React, { useEffect, useState } from 'react';
import { CheckCircle2, Eye, EyeOff, LayoutGrid, List, Search } from 'lucide-react';
import { BaseModelExplorerGrid, isBaseModelType } from './BaseModelExplorerGrid.tsx';
import { BaseModelExplorerTable } from './BaseModelExplorerTable.tsx';
import type { ModelInventoryItem } from '../../shared/types.ts';

// Preserved by user request: Missing Dependencies UI is hidden for now without deleting the implementation.
const SHOW_MISSING_DEPENDENCIES = false;

export type BaseModelGroupFilter = 'base_models' | 'components';

interface ModelInventoryTabProps {
  models: ModelInventoryItem[];
  missingModels: ModelInventoryItem[];
  highlightedFilename?: string | null;
  onLocateMissing: (query: string) => void;
  onSelectModel: (modelId: number) => void;
  onUpdateModelConfig: (
    modelId: number,
    payload: {
      mentionEnabled?: boolean;
      nickname?: string | null;
      llmDescription?: string | null;
      userNotes?: string | null;
    }
  ) => Promise<void>;
  onToggleVisibility: (modelId: number, nextHidden: boolean) => Promise<void>;
}

/**
 * Filterable Base Models workspace (excluding LoRAs) with group switcher
 * (Base Models vs CLIP/VAE/Upscalers/ControlNet), Grid/List views, @mention, and Hide/Unhide.
 */
export const ModelInventoryTab: React.FC<ModelInventoryTabProps> = ({
  models,
  missingModels,
  highlightedFilename,
  onLocateMissing,
  onSelectModel,
  onUpdateModelConfig,
  onToggleVisibility,
}) => {
  const [explorerLayout, setExplorerLayout] = useState<'grid' | 'list'>('grid');
  const [groupFilter, setGroupFilter] = useState<BaseModelGroupFilter>('base_models');
  const [showHiddenModels, setShowHiddenModels] = useState(false);
  const [modelSearch, setModelSearch] = useState('');
  const [brokenThumbs, setBrokenThumbs] = useState<Record<string, boolean>>({});

  // Exclude LoRAs — those belong exclusively in LoRA Explorer
  const nonLoraModels = models.filter((m) => m.modelType !== 'lora');

  // If a just-downloaded non-LoRA model is highlighted, auto-switch group if needed
  useEffect(() => {
    if (!highlightedFilename) return;
    const match = models.find(
      (m) =>
        m.modelType !== 'lora' &&
        m.filename.toLowerCase() === highlightedFilename.toLowerCase()
    );
    if (match) {
      setGroupFilter(isBaseModelType(match.modelType) ? 'base_models' : 'components');
      if (match.isHidden) setShowHiddenModels(true);
    }
  }, [highlightedFilename, models]);

  const groupModels = nonLoraModels.filter((m) =>
    groupFilter === 'base_models' ? isBaseModelType(m.modelType) : !isBaseModelType(m.modelType)
  );
  const hiddenCount = groupModels.filter((m) => m.isHidden).length;

  const filteredModels = groupModels.filter((m) => {
    if (!showHiddenModels && m.isHidden) return false;
    if (!modelSearch.trim()) return true;
    const q = modelSearch.toLowerCase();
    return (
      m.name.toLowerCase().includes(q) ||
      m.filename.toLowerCase().includes(q) ||
      (m.baseModel || '').toLowerCase().includes(q) ||
      (m.nickname || '').toLowerCase().includes(q) ||
      (m.llmDescription || '').toLowerCase().includes(q) ||
      (m.sha256Hash || '').toLowerCase().includes(q)
    );
  });

  const handleMarkBrokenThumb = (url: string) => {
    setBrokenThumbs((prev) => ({ ...prev, [url]: true }));
  };

  return (
    <div className="space-y-4">
      {/* Hidden by request without removing code */}
      {SHOW_MISSING_DEPENDENCIES && (
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-sm font-display font-semibold text-zinc-100">
                Missing Model Dependencies ({missingModels.length})
              </h3>
              <p className="text-xs text-zinc-400">
                Models referenced by indexed workflows that are not currently installed in your ComfyUI
                model inventory.
              </p>
            </div>
          </div>

          {missingModels.length === 0 ? (
            <div className="flex items-center gap-2 text-xs text-emerald-400 bg-emerald-500/10 border border-emerald-500/30 rounded-lg px-4 py-3">
              <CheckCircle2 className="w-4 h-4" />
              <span>All model dependencies referenced by your indexed library are available.</span>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="border-b border-zinc-800 text-zinc-400">
                  <tr>
                    <th className="py-2.5 px-3">Model Filename</th>
                    <th className="py-2.5 px-3">Type</th>
                    <th className="py-2.5 px-3">Historical Hash</th>
                    <th className="py-2.5 px-3 text-right">Dependent Images</th>
                    <th className="py-2.5 px-3 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-800/60">
                  {missingModels.map((m) => (
                    <tr key={m.id}>
                      <td className="py-2.5 px-3 font-mono text-zinc-200">{m.filename}</td>
                      <td className="py-2.5 px-3 capitalize text-zinc-400">{m.modelType}</td>
                      <td className="py-2.5 px-3 font-mono text-zinc-400">
                        {m.sha256Hash || m.autov2Hash || 'Unrecorded'}
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono tabular-nums text-amber-400">
                        {m.dependentImageCount}
                      </td>
                      <td className="py-2.5 px-3 text-right">
                        <button
                          type="button"
                          onClick={() => onLocateMissing(m.sha256Hash || m.autov2Hash || m.name)}
                          className="px-2.5 py-1 bg-indigo-600 hover:bg-indigo-500 text-white rounded cursor-pointer"
                        >
                          Locate &amp; Download
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Search, Group Dropdown, Hidden Toggle & Layout Controls */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[240px]">
          <Search className="w-4 h-4 text-zinc-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={modelSearch}
            onChange={(e) => setModelSearch(e.target.value)}
            placeholder="Search base models by name, filename, architecture, nickname, or strengths..."
            className="w-full pl-9 pr-4 py-2 text-xs bg-zinc-900 border border-zinc-800 rounded-lg text-zinc-100"
          />
        </div>

        <select
          value={groupFilter}
          onChange={(e) => setGroupFilter(e.target.value as BaseModelGroupFilter)}
          className="px-3 py-2 text-xs bg-zinc-900 border border-zinc-800 rounded-lg text-zinc-200"
        >
          <option value="base_models">Base Models (Krea2 / Diffusion / Checkpoints)</option>
          <option value="components">Support Models (CLIP / VAE / Upscalers / Other)</option>
        </select>

        <button
          type="button"
          onClick={() => setShowHiddenModels((prev) => !prev)}
          className={`inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-lg border transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
            showHiddenModels
              ? 'bg-amber-500/15 border-amber-500/50 text-amber-200'
              : 'bg-zinc-900 border-zinc-800 text-zinc-300 hover:border-zinc-700'
          }`}
          title={showHiddenModels ? 'Hide hidden models' : 'Show hidden models'}
        >
          {showHiddenModels ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
          <span className="tabular-nums">Show Hidden ({hiddenCount})</span>
        </button>

        <div className="flex items-center p-0.5 bg-zinc-900 border border-zinc-800 rounded-lg">
          <button
            type="button"
            onClick={() => setExplorerLayout('grid')}
            className={`inline-flex items-center gap-1 px-2.5 py-1.5 text-xs rounded-md cursor-pointer whitespace-nowrap shrink-0 ${
              explorerLayout === 'grid'
                ? 'bg-emerald-600 text-white'
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
                ? 'bg-emerald-600 text-white'
                : 'text-zinc-400 hover:text-zinc-200'
            }`}
            title="Table View"
          >
            <List className="w-3.5 h-3.5" />
            <span>List</span>
          </button>
        </div>
      </div>

      {filteredModels.length === 0 ? (
        <div className="bg-zinc-900/60 border border-zinc-800 rounded-xl p-10 text-center text-xs text-zinc-400 space-y-3">
          <div>
            {!showHiddenModels && hiddenCount > 0 && groupModels.length === hiddenCount
              ? `All ${hiddenCount} model(s) in this group are currently hidden.`
              : 'No models match your current filter or mounted ComfyUI models directory.'}
          </div>
          {!showHiddenModels && hiddenCount > 0 && (
            <button
              type="button"
              onClick={() => setShowHiddenModels(true)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-zinc-800 hover:bg-zinc-700 text-zinc-200 rounded-lg cursor-pointer"
            >
              <Eye className="w-3.5 h-3.5" />
              <span>Show Hidden ({hiddenCount})</span>
            </button>
          )}
        </div>
      ) : explorerLayout === 'grid' ? (
        <BaseModelExplorerGrid
          models={filteredModels}
          brokenThumbs={brokenThumbs}
          highlightedFilename={highlightedFilename}
          onMarkBrokenThumb={handleMarkBrokenThumb}
          onSelectModel={onSelectModel}
          onUpdateModelConfig={onUpdateModelConfig}
          onToggleVisibility={onToggleVisibility}
        />
      ) : (
        <BaseModelExplorerTable
          models={filteredModels}
          brokenThumbs={brokenThumbs}
          highlightedFilename={highlightedFilename}
          onMarkBrokenThumb={handleMarkBrokenThumb}
          onSelectModel={onSelectModel}
          onUpdateModelConfig={onUpdateModelConfig}
          onToggleVisibility={onToggleVisibility}
        />
      )}
    </div>
  );
};
