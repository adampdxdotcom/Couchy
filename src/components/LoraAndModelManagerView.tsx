import React, { useEffect, useState } from 'react';
import {
  Search,
  RefreshCw,
  CheckCircle2,
  ShieldCheck,
  ExternalLink,
  Eye,
  EyeOff,
  Layers,
  LayoutGrid,
  List,
} from 'lucide-react';
import { api } from '../api/client.ts';
import { formatBytes } from '../shared/utils.ts';
import { LoraDetailView } from './LoraDetailView.tsx';
import { ModelDownloaderTab } from './ModelDownloaderTab.tsx';
import type {
  ExternalModelSearchResult,
  ImageRecord,
  LoraExplorerItem,
  ModelInventoryItem,
} from '../shared/types.ts';

interface LoraAndModelManagerViewProps {
  loras: LoraExplorerItem[];
  models: ModelInventoryItem[];
  allImages: ImageRecord[];
  onRefresh: () => Promise<void>;
  onOpenImage: (img: ImageRecord) => void;
  onFilterGalleryByLora: (loraFilename: string) => void;
  onPushToast?: (text: string, type?: 'info' | 'success' | 'warning' | 'error') => void;
}

/**
 * Combined LoRA Explorer (Grid & List), LoRA Detail Inspector,
 * Model Inventory & Missing Dependencies, and Civitai / Hugging Face Downloader.
 */
export const LoraAndModelManagerView: React.FC<LoraAndModelManagerViewProps> = ({
  loras,
  models,
  allImages,
  onRefresh,
  onOpenImage,
  onFilterGalleryByLora,
  onPushToast,
}) => {
  const [subTab, setSubTab] = useState<'loras' | 'dependencies' | 'downloader'>('loras');
  const [explorerLayout, setExplorerLayout] = useState<'grid' | 'list'>('grid');
  const [showHiddenLoras, setShowHiddenLoras] = useState(false);
  const [selectedLoraName, setSelectedLoraName] = useState<string | null>(null);
  const [loraSearch, setLoraSearch] = useState('');
  const [loraCategoryFilter, setLoraCategoryFilter] = useState<string>('');
  const [impactReport, setImpactReport] = useState<any | null>(null);
  const [fetchingModelId, setFetchingModelId] = useState<number | null>(null);
  const [brokenThumbs, setBrokenThumbs] = useState<Record<string, boolean>>({});

  // Model Downloader State
  const [provider, setProvider] = useState<'civitai' | 'huggingface'>('civitai');
  const [extQuery, setExtQuery] = useState('');
  const [extTypeFilter, setExtTypeFilter] = useState('');
  const [searchResults, setSearchResults] = useState<ExternalModelSearchResult[]>([]);
  const [isSearchingExt, setIsSearchingExt] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [downloads, setDownloads] = useState<any[]>([]);

  const refreshDownloads = async () => {
    try {
      const res = await api.listDownloads();
      setDownloads(res.items || []);
    } catch {
      // ignore
    }
  };

  useEffect(() => {
    refreshDownloads();
  }, [subTab]);

  // Poll while any model download is active and refresh inventory once finished
  const hasActiveDownload = downloads.some((d) => d.status === 'downloading');
  useEffect(() => {
    if (!hasActiveDownload) return;
    const timer = setInterval(async () => {
      try {
        const res = await api.listDownloads();
        const next = res.items || [];
        setDownloads(next);
        if (!next.some((d: any) => d.status === 'downloading')) {
          await onRefresh();
        }
      } catch {
        // ignore transient polling failure
      }
    }, 2000);
    return () => clearInterval(timer);
  }, [hasActiveDownload, onRefresh]);

  const selectedLora = loras.find((l) => l.filename === selectedLoraName) || null;

  const handleLoadImpact = async (modelFilename: string) => {
    const res = await api.getModelImpact(modelFilename);
    setImpactReport(res);
  };

  const handleFetchFromCivitai = async (modelId: number) => {
    setFetchingModelId(modelId);
    try {
      const res = await api.fetchModelFromCivitai(modelId);
      await onRefresh();
      const notes: string[] = [];
      if (res.baseModel) notes.push(res.baseModel);
      if (res.filledTriggerWord) notes.push('trigger word auto-filled');
      if (res.filledDefaultStrength) notes.push('default strength updated');
      if (res.previewCount > 0) notes.push(`${res.previewCount} preview(s) cached`);
      onPushToast?.(
        `Fetched Civitai metadata${notes.length > 0 ? ` (${notes.join(', ')})` : ''}`,
        'success'
      );
    } catch (err: any) {
      onPushToast?.(err?.message || 'Could not fetch metadata from Civitai', 'error');
    } finally {
      setFetchingModelId(null);
    }
  };

  const handleExternalSearch = async (e?: React.FormEvent, customQ?: string) => {
    if (e) e.preventDefault();
    const qToUse = customQ !== undefined ? customQ : extQuery;
    setIsSearchingExt(true);
    setSearchError(null);
    try {
      const res =
        provider === 'civitai'
          ? await api.searchCivitai(qToUse, extTypeFilter)
          : await api.searchHuggingFace(qToUse);
      setSearchResults(res.items || []);
    } catch (err: any) {
      setSearchError(err.message || 'External model search failed');
    } finally {
      setIsSearchingExt(false);
    }
  };

  const handleUpdateMentionConfig = async (
    loraName: string,
    payload: {
      mentionEnabled?: boolean;
      nickname?: string | null;
      defaultModelStrength?: number;
      defaultClipStrength?: number;
      triggerWord?: string | null;
      llmDescription?: string | null;
    }
  ) => {
    try {
      await api.updateLoraMentionConfig({ loraName, ...payload });
      await onRefresh();
      if (onPushToast) {
        if (payload.mentionEnabled !== undefined) {
          onPushToast(
            payload.mentionEnabled
              ? `Enabled @mention for ${loraName}`
              : `Disabled @mention for ${loraName}`,
            'info'
          );
        } else if (payload.nickname !== undefined) {
          onPushToast(
            payload.nickname
              ? `Saved nickname @${payload.nickname}`
              : `Cleared nickname for ${loraName}`,
            'success'
          );
        } else if (payload.triggerWord !== undefined) {
          onPushToast(
            payload.triggerWord
              ? `Saved trigger word(s) for ${loraName}`
              : `Cleared trigger word(s) for ${loraName}`,
            'success'
          );
        } else if (payload.llmDescription !== undefined) {
          onPushToast(
            payload.llmDescription
              ? `Saved Agent description for ${loraName}`
              : `Cleared Agent description for ${loraName}`,
            'success'
          );
        } else {
          onPushToast('Updated LoRA @mention settings', 'success');
        }
      }
    } catch (err: any) {
      onPushToast?.(err.message || 'Failed to update @mention settings', 'error');
    }
  };

  const handleToggleLoraVisibility = async (loraName: string, nextHidden: boolean) => {
    try {
      await api.updateLoraVisibility(loraName, nextHidden);
      await onRefresh();
      onPushToast?.(
        nextHidden
          ? `Hidden ${loraName} from Couchy`
          : `Restored ${loraName} to Couchy`,
        nextHidden ? 'info' : 'success'
      );
    } catch (err: any) {
      onPushToast?.(err?.message || 'Failed to update LoRA visibility', 'error');
    }
  };

  if (selectedLora) {
    return (
      <LoraDetailView
        lora={selectedLora}
        allImages={allImages}
        impactReport={impactReport}
        isFetchingCivitai={Boolean(
          selectedLora.modelId && fetchingModelId === selectedLora.modelId
        )}
        onBack={() => {
          setSelectedLoraName(null);
          setImpactReport(null);
        }}
        onLoadImpact={handleLoadImpact}
        onFilterGalleryByLora={onFilterGalleryByLora}
        onFetchFromCivitai={handleFetchFromCivitai}
        onToggleVisibility={handleToggleLoraVisibility}
        onUpdateMentionConfig={handleUpdateMentionConfig}
        onRefresh={onRefresh}
        onOpenImage={onOpenImage}
        onPushToast={onPushToast}
      />
    );
  }

  const hiddenCount = loras.filter((l) => l.isHidden).length;
  const activeLoraCount = loras.length - hiddenCount;

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

  const missingModels = models.filter((m) => !m.isInstalled && m.dependentImageCount > 0);

  return (
    <div className="px-6 py-6 max-w-7xl mx-auto space-y-6">
      {/* Sub-Navigation Bar */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-zinc-800 pb-3">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setSubTab('loras')}
            className={`px-3.5 py-2 text-xs font-medium rounded-lg transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
              subTab === 'loras'
                ? 'bg-indigo-600 text-white'
                : 'bg-zinc-900 text-zinc-300 hover:bg-zinc-800'
            }`}
          >
            LoRA Explorer ({activeLoraCount})
          </button>
          <button
            type="button"
            onClick={() => setSubTab('dependencies')}
            className={`px-3.5 py-2 text-xs font-medium rounded-lg transition-colors cursor-pointer ${
              subTab === 'dependencies'
                ? 'bg-indigo-600 text-white'
                : 'bg-zinc-900 text-zinc-300 hover:bg-zinc-800'
            }`}
          >
            Model Inventory & Missing Dependencies ({missingModels.length} missing)
          </button>
          <button
            type="button"
            onClick={() => setSubTab('downloader')}
            className={`px-3.5 py-2 text-xs font-medium rounded-lg transition-colors cursor-pointer ${
              subTab === 'downloader'
                ? 'bg-indigo-600 text-white'
                : 'bg-zinc-900 text-zinc-300 hover:bg-zinc-800'
            }`}
          >
            Civitai & Hugging Face Downloader
          </button>
        </div>

        <button
          type="button"
          onClick={async () => {
            await api.syncModelInventory();
            await onRefresh();
          }}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-zinc-900 border border-zinc-800 hover:border-zinc-700 text-zinc-200 rounded-lg cursor-pointer"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          <span>Sync ComfyUI & Disk Models</span>
        </button>
      </div>

      {/* Sub-Tab 1: LoRA Explorer (Grid & List) */}
      {subTab === 'loras' && (
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
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
              {filteredLoras.map((l) => {
                const coverUrl = l.previewImages?.[0]?.url || null;
                const hasThumb = Boolean(coverUrl && !brokenThumbs[l.filename]);

                return (
                  <div
                    key={l.filename}
                    onClick={() => setSelectedLoraName(l.filename)}
                    className={`group bg-zinc-900 border border-zinc-800 hover:border-zinc-700 rounded-xl overflow-hidden flex flex-col justify-between cursor-pointer transition-colors ${
                      l.isHidden ? 'opacity-75' : ''
                    }`}
                  >
                    <div>
                      {/* Preview Thumbnail Header */}
                      <div className="relative aspect-[4/3] bg-zinc-950 border-b border-zinc-800 overflow-hidden">
                        {hasThumb ? (
                          <img
                            src={coverUrl!}
                            alt={l.name}
                            className="w-full h-full object-cover group-hover:scale-[1.02] transition-transform duration-200"
                            loading="lazy"
                            onError={() =>
                              setBrokenThumbs((prev) => ({ ...prev, [l.filename]: true }))
                            }
                          />
                        ) : (
                          <div className="w-full h-full flex flex-col items-center justify-center gap-1.5 text-zinc-600 bg-gradient-to-br from-zinc-950 via-zinc-900/90 to-zinc-950">
                            <Layers className="w-6 h-6 text-zinc-700" />
                            <span className="text-[11px] font-mono text-zinc-600 px-3 text-center truncate max-w-full">
                              {l.name}
                            </span>
                          </div>
                        )}

                        {/* Isolated @Mention Checkbox */}
                        <div
                          className="absolute top-2.5 left-2.5 flex items-center gap-1.5 px-2 py-1 rounded-md bg-zinc-950/85 border border-zinc-700/80"
                          onClick={(e) => e.stopPropagation()}
                          title={l.mentionEnabled ? 'Enabled in @mention' : 'Click to enable in @mention'}
                        >
                          <input
                            type="checkbox"
                            checked={Boolean(l.mentionEnabled)}
                            onClick={(e) => e.stopPropagation()}
                            onChange={(e) =>
                              handleUpdateMentionConfig(l.filename, {
                                mentionEnabled: e.target.checked,
                              })
                            }
                            aria-label={`Include ${l.name} in @mention menu`}
                            className="w-3.5 h-3.5 rounded border-zinc-700 bg-zinc-950 text-indigo-600 focus:ring-indigo-500 cursor-pointer"
                          />
                          <span className="text-[10px] font-mono text-zinc-300">@</span>
                        </div>

                        {/* Top-right Civitai Link & Base Model */}
                        <div className="absolute top-2.5 right-2.5 flex items-center gap-1.5">
                          {l.baseModel && (
                            <span className="px-1.5 py-0.5 text-[10px] font-mono bg-zinc-950/85 border border-zinc-700/80 text-indigo-300 rounded">
                              {l.baseModel}
                            </span>
                          )}
                          {l.civitaiUrl && (
                            <a
                              href={l.civitaiUrl}
                              target="_blank"
                              rel="noreferrer"
                              onClick={(e) => e.stopPropagation()}
                              title="Open on Civitai"
                              className="p-1.5 rounded bg-zinc-950/85 hover:bg-zinc-900 border border-zinc-700/80 text-zinc-200 hover:text-indigo-300 transition-colors"
                            >
                              <ExternalLink className="w-3 h-3" />
                            </a>
                          )}
                        </div>
                      </div>

                      {/* Card Body */}
                      <div className="p-3.5 space-y-2">
                        <div>
                          <div className="font-medium text-sm text-zinc-100 group-hover:text-indigo-300 transition-colors truncate">
                            {l.name}
                          </div>
                          <div className="text-[11px] font-mono text-zinc-500 truncate">
                            {l.filename}
                          </div>
                        </div>

                        <div className="text-[11px] text-zinc-400 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 font-mono tabular-nums">
                          {l.isHidden && (
                            <>
                              <span className="font-sans font-medium text-amber-400">Hidden</span>
                              <span>·</span>
                            </>
                          )}
                          <span className="capitalize font-sans text-zinc-300">{l.loraCategory}</span>
                          <span>·</span>
                          <span>{l.imageCount} imgs</span>
                          {l.averageRating > 0 && (
                            <>
                              <span>·</span>
                              <span className="text-amber-400">★ {l.averageRating}</span>
                            </>
                          )}
                          <span>·</span>
                          <span>{(l.defaultModelStrength ?? 1.0).toFixed(2)}x</span>
                          <span>·</span>
                          <span className={l.isInstalled ? 'text-emerald-400' : 'text-amber-400'}>
                            {l.isInstalled ? 'Installed' : 'Missing'}
                          </span>
                        </div>

                        {l.triggerWord && (
                          <div className="text-[11px] font-mono text-amber-300/90 truncate">
                            Trigger: {l.triggerWord}
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Inline Nickname & Hide/Unhide Footer */}
                    <div
                      className="px-3.5 pb-3 pt-1 flex items-center justify-between gap-2"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <div className="relative flex-1 min-w-0">
                        <span className="absolute left-2 top-1/2 -translate-y-1/2 text-zinc-500 font-mono text-[11px]">
                          @
                        </span>
                        <input
                          key={`${l.filename}-grid-nick-${l.nickname || ''}`}
                          type="text"
                          defaultValue={l.nickname || ''}
                          placeholder="nickname"
                          onBlur={(e) => {
                            const clean = e.target.value.trim().replace(/^@+/, '').toLowerCase();
                            if (clean !== (l.nickname || '').toLowerCase()) {
                              handleUpdateMentionConfig(l.filename, { nickname: clean });
                            }
                          }}
                          className="w-full pl-5 pr-2 py-1 bg-zinc-950/80 border border-zinc-800 focus:border-indigo-500 rounded text-xs font-mono text-zinc-200 placeholder-zinc-700 focus:outline-none"
                        />
                      </div>
                      <button
                        type="button"
                        onClick={() =>
                          handleToggleLoraVisibility(l.filename, !Boolean(l.isHidden))
                        }
                        title={
                          l.isHidden
                            ? `Unhide ${l.name} in Couchy`
                            : `Hide ${l.name} from Couchy`
                        }
                        className={`inline-flex items-center gap-1 px-2 py-1 text-[11px] font-medium rounded border cursor-pointer transition-colors whitespace-nowrap shrink-0 ${
                          l.isHidden
                            ? 'bg-amber-500/15 border-amber-500/50 text-amber-200 hover:bg-amber-500/25'
                            : 'bg-zinc-950/80 border-zinc-800 text-zinc-400 hover:text-zinc-100 hover:border-zinc-700'
                        }`}
                      >
                        {l.isHidden ? (
                          <Eye className="w-3 h-3" />
                        ) : (
                          <EyeOff className="w-3 h-3" />
                        )}
                        <span>{l.isHidden ? 'Unhide' : 'Hide'}</span>
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-zinc-950/90 border-b border-zinc-800 text-zinc-400">
                  <tr>
                    <th className="py-3 px-3 w-10 text-center font-medium" title="Include in Quick Gen @mention">
                      @
                    </th>
                    <th className="py-3 px-4 font-medium">LoRA Name & File</th>
                    <th className="py-3 px-3 font-medium">Base Model</th>
                    <th className="py-3 px-3 font-medium">Nickname</th>
                    <th className="py-3 px-3 font-medium">Classification</th>
                    <th className="py-3 px-3 font-medium">Linked Characters</th>
                    <th className="py-3 px-3 font-medium text-right">Images</th>
                    <th className="py-3 px-3 font-medium text-right">Avg Rating</th>
                    <th className="py-3 px-3 font-medium text-right">Default Str</th>
                    <th className="py-3 px-3 font-medium text-right">Status</th>
                    <th className="py-3 px-4 font-medium text-right">Visibility</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-800/70">
                  {filteredLoras.map((l) => {
                    const coverUrl = l.previewImages?.[0]?.url || null;
                    return (
                      <tr
                        key={l.filename}
                        className={`hover:bg-zinc-800/40 transition-colors group ${
                          l.isHidden ? 'opacity-75' : ''
                        }`}
                      >
                        <td
                          className="py-3 px-3 text-center"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <input
                            type="checkbox"
                            checked={Boolean(l.mentionEnabled)}
                            onClick={(e) => e.stopPropagation()}
                            onChange={(e) =>
                              handleUpdateMentionConfig(l.filename, {
                                mentionEnabled: e.target.checked,
                              })
                            }
                            aria-label={`Include ${l.name} in @mention menu`}
                            className="w-4 h-4 rounded border-zinc-700 bg-zinc-950 text-indigo-600 focus:ring-indigo-500 cursor-pointer"
                            title={l.mentionEnabled ? 'Enabled in @mention' : 'Click to enable in @mention'}
                          />
                        </td>

                        <td
                          className="py-3 px-4 cursor-pointer"
                          onClick={() => setSelectedLoraName(l.filename)}
                        >
                          <div className="flex items-center gap-3">
                            {coverUrl && !brokenThumbs[l.filename] ? (
                              <img
                                src={coverUrl}
                                alt={l.name}
                                className="w-9 h-9 rounded object-cover border border-zinc-800 shrink-0"
                                onError={() =>
                                  setBrokenThumbs((prev) => ({ ...prev, [l.filename]: true }))
                                }
                              />
                            ) : (
                              <div className="w-9 h-9 rounded bg-zinc-950 border border-zinc-800 flex items-center justify-center text-zinc-700 shrink-0">
                                <Layers className="w-4 h-4" />
                              </div>
                            )}
                            <div className="min-w-0">
                              <div className="flex items-center gap-1.5">
                                <span className="font-medium text-zinc-100 hover:text-indigo-300 transition-colors truncate">
                                  {l.name}
                                </span>
                                {l.civitaiUrl && (
                                  <a
                                    href={l.civitaiUrl}
                                    target="_blank"
                                    rel="noreferrer"
                                    onClick={(e) => e.stopPropagation()}
                                    className="text-zinc-500 hover:text-indigo-300"
                                    title="Open on Civitai"
                                  >
                                    <ExternalLink className="w-3 h-3" />
                                  </a>
                                )}
                              </div>
                              <div className="text-[11px] font-mono text-zinc-500 truncate">
                                {l.filename}
                              </div>
                            </div>
                          </div>
                        </td>

                        <td
                          className="py-3 px-3 font-mono text-[11px] text-indigo-300 cursor-pointer"
                          onClick={() => setSelectedLoraName(l.filename)}
                        >
                          {l.baseModel || '—'}
                        </td>

                        <td
                          className="py-3 px-3"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <div className="relative max-w-[140px]">
                            <span className="absolute left-2 top-1/2 -translate-y-1/2 text-zinc-500 font-mono text-[11px]">
                              @
                            </span>
                            <input
                              key={`${l.filename}-row-nick-${l.nickname || ''}`}
                              type="text"
                              defaultValue={l.nickname || ''}
                              placeholder="nickname"
                              onBlur={(e) => {
                                const clean = e.target.value.trim().replace(/^@+/, '').toLowerCase();
                                if (clean !== (l.nickname || '').toLowerCase()) {
                                  handleUpdateMentionConfig(l.filename, {
                                    nickname: clean,
                                  });
                                }
                              }}
                              className="w-full pl-5 pr-2 py-1 bg-zinc-950/80 border border-zinc-800 focus:border-indigo-500 rounded text-xs font-mono text-zinc-200 placeholder-zinc-700 focus:outline-none"
                            />
                          </div>
                        </td>

                        <td
                          className="py-3 px-3 capitalize text-zinc-300 cursor-pointer"
                          onClick={() => setSelectedLoraName(l.filename)}
                        >
                          {l.loraCategory}
                        </td>

                        <td
                          className="py-3 px-3 text-zinc-300 cursor-pointer"
                          onClick={() => setSelectedLoraName(l.filename)}
                        >
                          {l.characters.length > 0
                            ? l.characters.map((c) => c.name).join(' · ')
                            : '—'}
                        </td>

                        <td
                          className="py-3 px-3 text-right font-mono tabular-nums text-zinc-200 cursor-pointer"
                          onClick={() => setSelectedLoraName(l.filename)}
                        >
                          {l.imageCount}
                        </td>

                        <td
                          className="py-3 px-3 text-right font-mono tabular-nums text-amber-400 cursor-pointer"
                          onClick={() => setSelectedLoraName(l.filename)}
                        >
                          {l.averageRating > 0 ? `★ ${l.averageRating}` : '—'}
                        </td>

                        <td
                          className="py-3 px-3 text-right font-mono tabular-nums text-zinc-300 cursor-pointer"
                          onClick={() => setSelectedLoraName(l.filename)}
                        >
                          {(l.defaultModelStrength ?? 1.0).toFixed(2)}x
                        </td>

                        <td
                          className="py-3 px-3 text-right cursor-pointer"
                          onClick={() => setSelectedLoraName(l.filename)}
                        >
                          {l.isHidden ? (
                            <span className="text-amber-400">Hidden</span>
                          ) : l.isInstalled ? (
                            <span className="text-emerald-400">Installed</span>
                          ) : (
                            <span className="text-amber-400">Missing</span>
                          )}
                        </td>

                        <td
                          className="py-3 px-4 text-right"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <button
                            type="button"
                            onClick={() =>
                              handleToggleLoraVisibility(l.filename, !Boolean(l.isHidden))
                            }
                            className={`inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-medium rounded border cursor-pointer transition-colors whitespace-nowrap shrink-0 ${
                              l.isHidden
                                ? 'bg-amber-500/15 border-amber-500/50 text-amber-200 hover:bg-amber-500/25'
                                : 'bg-zinc-950 border-zinc-800 text-zinc-400 hover:text-zinc-100 hover:border-zinc-700'
                            }`}
                          >
                            {l.isHidden ? (
                              <Eye className="w-3 h-3" />
                            ) : (
                              <EyeOff className="w-3 h-3" />
                            )}
                            <span>{l.isHidden ? 'Unhide' : 'Hide'}</span>
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Sub-Tab 2: Missing Dependencies & Model Inventory */}
      {subTab === 'dependencies' && (
        <div className="space-y-6">
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
                            onClick={() => {
                              const q = m.sha256Hash || m.autov2Hash || m.name;
                              setExtQuery(q);
                              setSubTab('downloader');
                              handleExternalSearch(undefined, q);
                            }}
                            className="px-2.5 py-1 bg-indigo-600 hover:bg-indigo-500 text-white rounded cursor-pointer"
                          >
                            Locate & Download
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5 space-y-4">
            <h3 className="text-sm font-display font-semibold text-zinc-100">
              Complete Model Inventory ({models.length})
            </h3>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="border-b border-zinc-800 text-zinc-400">
                  <tr>
                    <th className="py-2.5 px-3">Filename</th>
                    <th className="py-2.5 px-3">Type</th>
                    <th className="py-2.5 px-3">Base Model</th>
                    <th className="py-2.5 px-3">Verification / Hash</th>
                    <th className="py-2.5 px-3 text-right">Size</th>
                    <th className="py-2.5 px-3 text-right">Used In</th>
                    <th className="py-2.5 px-3 text-right">Civitai & Impact</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-800/60">
                  {models.map((m) => (
                    <tr key={m.id}>
                      <td className="py-2.5 px-3 font-mono text-zinc-200">{m.filename}</td>
                      <td className="py-2.5 px-3 capitalize text-zinc-300">{m.modelType}</td>
                      <td className="py-2.5 px-3 font-mono text-[11px] text-indigo-300">
                        {m.baseModel || '—'}
                      </td>
                      <td className="py-2.5 px-3 font-mono">
                        {m.sha256Hash ? (
                          <span className="inline-flex items-center gap-1 text-emerald-400">
                            <ShieldCheck className="w-3.5 h-3.5" />
                            <span>{m.autov2Hash || m.sha256Hash.slice(0, 10)}</span>
                          </span>
                        ) : m.isInstalled ? (
                          <span className="text-sky-400">Installed (Unverified Hash)</span>
                        ) : (
                          <span className="text-amber-400">Missing</span>
                        )}
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono tabular-nums text-zinc-400">
                        {formatBytes(m.fileSize)}
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono tabular-nums text-zinc-200">
                        {m.dependentImageCount} imgs · {m.dependentWorkflowCount} wfs
                      </td>
                      <td className="py-2.5 px-3 text-right">
                        <div className="inline-flex items-center gap-2.5">
                          {m.civitaiUrl && (
                            <a
                              href={m.civitaiUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex items-center gap-1 text-indigo-300 hover:text-indigo-200"
                              title="Open on Civitai"
                            >
                              <ExternalLink className="w-3 h-3" />
                              <span>Page</span>
                            </a>
                          )}
                          {(m.isInstalled || m.sha256Hash || m.civitaiId) && (
                            <button
                              type="button"
                              disabled={fetchingModelId === m.id}
                              onClick={() => handleFetchFromCivitai(m.id)}
                              className="text-zinc-300 hover:text-white disabled:opacity-50 cursor-pointer"
                            >
                              {fetchingModelId === m.id ? 'Fetching...' : 'Fetch Civitai'}
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => handleLoadImpact(m.filename)}
                            className="text-indigo-400 hover:text-indigo-300 cursor-pointer"
                          >
                            Impact
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {impactReport && (
              <div className="p-4 bg-zinc-950 border border-indigo-500/40 rounded-lg text-xs space-y-1">
                <div className="font-semibold text-zinc-100">
                  Impact Report for {impactReport.modelName}
                </div>
                <div className="text-zinc-400">
                  Dependent Images: {impactReport.dependentImageCount} · Dependent Workflows:{' '}
                  {impactReport.dependentWorkflowCount} · Linked Characters:{' '}
                  {impactReport.characters.length}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Sub-Tab 3: Civitai & Hugging Face Downloader */}
      {subTab === 'downloader' && (
        <ModelDownloaderTab
          provider={provider}
          setProvider={setProvider}
          extQuery={extQuery}
          setExtQuery={setExtQuery}
          extTypeFilter={extTypeFilter}
          setExtTypeFilter={setExtTypeFilter}
          searchResults={searchResults}
          isSearchingExt={isSearchingExt}
          searchError={searchError}
          downloads={downloads}
          onSearch={handleExternalSearch}
          onRefreshDownloads={refreshDownloads}
        />
      )}
    </div>
  );
};
