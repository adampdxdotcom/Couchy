import React, { useEffect, useState } from 'react';
import {
  Search,
  Download,
  RefreshCw,
  CheckCircle2,
  AlertTriangle,
  ArrowLeft,
  ShieldCheck,
  HardDriveDownload,
  FileWarning,
  AtSign,
  Layers,
  Check,
} from 'lucide-react';
import { api } from '../api/client.ts';
import { formatBytes } from '../shared/utils.ts';
import type {
  ImageRecord,
  LoraCategory,
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
 * Combined LoRA Explorer, Missing Dependencies Dashboard, Model Usage Impact Report,
 * and Civitai / Hugging Face Model Downloader.
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
  const [selectedLoraName, setSelectedLoraName] = useState<string | null>(null);
  const [loraSearch, setLoraSearch] = useState('');
  const [loraCategoryFilter, setLoraCategoryFilter] = useState<string>('');
  const [impactReport, setImpactReport] = useState<any | null>(null);

  // Model Downloader State
  const [provider, setProvider] = useState<'civitai' | 'huggingface'>('civitai');
  const [extQuery, setExtQuery] = useState('');
  const [extTypeFilter, setExtTypeFilter] = useState('');
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [isSearchingExt, setIsSearchingExt] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [downloads, setDownloads] = useState<any[]>([]);

  // Explicit Confirmation Modal for Model Download
  const [pendingDownload, setPendingDownload] = useState<any | null>(null);
  const [dlSubfolder, setDlSubfolder] = useState('loras');
  const [allowOverwrite, setAllowOverwrite] = useState(false);
  const [dlError, setDlError] = useState<string | null>(null);

  useEffect(() => {
    api.listDownloads().then((res) => setDownloads(res.items || [])).catch(() => {});
  }, [subTab]);

  const selectedLora = loras.find((l) => l.filename === selectedLoraName) || null;

  const handleLoadImpact = async (modelFilename: string) => {
    const res = await api.getModelImpact(modelFilename);
    setImpactReport(res);
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

  const handleConfirmDownload = async () => {
    if (!pendingDownload) return;
    setDlError(null);
    try {
      await api.startModelDownload({
        provider: pendingDownload.provider,
        modelName: pendingDownload.name,
        filename: pendingDownload.filename,
        modelType: pendingDownload.modelType,
        sourceUrl: pendingDownload.downloadUrl,
        expectedHash: pendingDownload.sha256Hash || null,
        subfolder: dlSubfolder,
        allowOverwrite,
        userConfirmed: true,
      });
      setPendingDownload(null);
      const dls = await api.listDownloads();
      setDownloads(dls.items || []);
    } catch (err: any) {
      setDlError(err.message || 'Download could not start');
    }
  };

  const handleUpdateMentionConfig = async (
    loraName: string,
    payload: {
      mentionEnabled?: boolean;
      nickname?: string | null;
      defaultModelStrength?: number;
      defaultClipStrength?: number;
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
        } else {
          onPushToast('Updated LoRA @mention settings', 'success');
        }
      }
    } catch (err: any) {
      if (onPushToast) {
        onPushToast(err.message || 'Failed to update @mention settings', 'error');
      }
    }
  };

  // Dedicated LoRA Detail Page
  if (selectedLora) {
    const associatedImages = allImages.filter((img) =>
      img.loras.some((l) => l.loraName.toLowerCase() === selectedLora.filename.toLowerCase())
    );
    const highestRated = [...associatedImages]
      .filter((i) => i.rating >= 4)
      .sort((a, b) => b.rating - a.rating)
      .slice(0, 6);

    return (
      <div className="px-6 py-6 max-w-7xl mx-auto space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <button
            type="button"
            onClick={() => {
              setSelectedLoraName(null);
              setImpactReport(null);
            }}
            className="inline-flex items-center gap-2 text-xs font-medium text-zinc-300 hover:text-white cursor-pointer"
          >
            <ArrowLeft className="w-4 h-4" />
            <span>Back to LoRA Explorer</span>
          </button>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => handleLoadImpact(selectedLora.filename)}
              className="px-3 py-1.5 text-xs font-medium bg-zinc-900 border border-zinc-800 hover:border-zinc-700 text-zinc-200 rounded-lg cursor-pointer"
            >
              View Usage Impact Report
            </button>
            <button
              type="button"
              onClick={() => onFilterGalleryByLora(selectedLora.filename)}
              className="px-3 py-1.5 text-xs font-medium bg-zinc-900 border border-zinc-800 hover:border-zinc-700 text-zinc-200 rounded-lg cursor-pointer"
            >
              Filter in Main Gallery
            </button>
            <button
              type="button"
              disabled={associatedImages.length === 0}
              onClick={() =>
                api.exportImagesZip({
                  imageIds: associatedImages.map((i) => i.id),
                  archiveName: `lora-${selectedLora.name}`,
                })
              }
              className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-medium bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white rounded-lg cursor-pointer"
            >
              <Download className="w-3.5 h-3.5" />
              <span className="font-mono tabular-nums">
                Download All Images ({associatedImages.length})
              </span>
            </button>
          </div>
        </div>

        {/* LoRA Detail Card */}
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-6 space-y-4">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h1 className="text-2xl font-display font-bold text-zinc-100">
                {selectedLora.name}
              </h1>
              <p className="text-xs font-mono text-zinc-400 mt-1">
                File: {selectedLora.filename} · Path: {selectedLora.filePath || 'Not locally installed'} ·{' '}
                {formatBytes(selectedLora.fileSize)}
              </p>
            </div>

            <div className="flex items-center gap-3 text-xs">
              <label className="text-zinc-400">Semantic Classification:</label>
              <select
                value={selectedLora.loraCategory}
                onChange={async (e) => {
                  await api.classifyLora(selectedLora.filename, e.target.value as LoraCategory);
                  await onRefresh();
                }}
                className="px-3 py-1.5 bg-zinc-950 border border-zinc-800 rounded-lg text-zinc-100"
              >
                <option value="unclassified">Unclassified</option>
                <option value="character">Character</option>
                <option value="style">Style</option>
                <option value="clothing">Clothing / Outfit</option>
                <option value="concept">Concept</option>
                <option value="pose">Pose</option>
                <option value="object">Object</option>
                <option value="other">Other</option>
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-3 text-xs font-mono tabular-nums">
            <div className="bg-zinc-950 border border-zinc-800 rounded-lg p-3">
              <span className="block text-[10px] font-sans text-zinc-400">Status</span>
              <span className={selectedLora.isInstalled ? 'text-emerald-400' : 'text-amber-400'}>
                {selectedLora.isInstalled ? 'Installed' : 'Missing'}
              </span>
            </div>
            <div className="bg-zinc-950 border border-zinc-800 rounded-lg p-3">
              <span className="block text-[10px] font-sans text-zinc-400">Images Using It</span>
              <span className="text-zinc-100">{selectedLora.imageCount}</span>
            </div>
            <div className="bg-zinc-950 border border-zinc-800 rounded-lg p-3">
              <span className="block text-[10px] font-sans text-zinc-400">Average Rating</span>
              <span className="text-amber-400">★ {selectedLora.averageRating}</span>
            </div>
            <div className="bg-zinc-950 border border-zinc-800 rounded-lg p-3">
              <span className="block text-[10px] font-sans text-zinc-400">Model Strength Range</span>
              <span className="text-zinc-100">
                {selectedLora.minModelStrength ?? '—'} to {selectedLora.maxModelStrength ?? '—'}
              </span>
            </div>
            <div className="bg-zinc-950 border border-zinc-800 rounded-lg p-3">
              <span className="block text-[10px] font-sans text-zinc-400">CLIP Strength Range</span>
              <span className="text-zinc-100">
                {selectedLora.minClipStrength ?? '—'} to {selectedLora.maxClipStrength ?? '—'}
              </span>
            </div>
            <div className="bg-zinc-950 border border-zinc-800 rounded-lg p-3">
              <span className="block text-[10px] font-sans text-zinc-400">SHA256 / AutoV2</span>
              <span className="text-zinc-100 truncate block">
                {selectedLora.autov2Hash || selectedLora.sha256Hash?.slice(0, 10) || 'Unverified'}
              </span>
            </div>
          </div>

          {selectedLora.characters.length > 0 && (
            <div className="text-xs text-zinc-300">
              Linked Characters:{' '}
              {selectedLora.characters
                .map((c) => `${c.name} (${c.appearanceLabel})`)
                .join(' · ')}
            </div>
          )}
        </div>

        {/* Quick Gen @Mention Configuration Card */}
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-6 space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-lg bg-amber-500/10 border border-amber-500/30 flex items-center justify-center text-amber-400">
                <AtSign className="w-4 h-4" />
              </div>
              <div>
                <h2 className="text-sm font-display font-semibold text-zinc-100">
                  Quick Gen @Mention Settings
                </h2>
                <p className="text-xs text-zinc-400">
                  Enable this LoRA in the Quick Gen `@` autocomplete popup and define its mention nickname.
                </p>
              </div>
            </div>

            <label className="flex items-center gap-2.5 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={Boolean(selectedLora.mentionEnabled)}
                onChange={(e) =>
                  handleUpdateMentionConfig(selectedLora.filename, {
                    mentionEnabled: e.target.checked,
                    nickname: selectedLora.nickname,
                    defaultModelStrength: selectedLora.defaultModelStrength ?? 1.0,
                    defaultClipStrength: selectedLora.defaultClipStrength ?? 1.0,
                  })
                }
                className="w-4 h-4 rounded border-zinc-700 bg-zinc-950 text-indigo-600 focus:ring-indigo-500 focus:ring-offset-zinc-900"
              />
              <span className="text-xs font-medium text-zinc-200">
                Include in @Mention Menu
              </span>
            </label>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-2 border-t border-zinc-800/80">
            {/* Nickname input */}
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-zinc-300">
                LoRA Nickname
              </label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500 font-mono text-xs">
                  @
                </span>
                <input
                  type="text"
                  defaultValue={selectedLora.nickname || ''}
                  placeholder="e.g. cyberpunk, retro, watercolor"
                  onBlur={(e) => {
                    const clean = e.target.value.trim().replace(/^@+/, '');
                    if (clean !== (selectedLora.nickname || '')) {
                      handleUpdateMentionConfig(selectedLora.filename, {
                        mentionEnabled: selectedLora.mentionEnabled,
                        nickname: clean,
                        defaultModelStrength: selectedLora.defaultModelStrength ?? 1.0,
                        defaultClipStrength: selectedLora.defaultClipStrength ?? 1.0,
                      });
                    }
                  }}
                  className="w-full pl-7 pr-3 py-1.5 bg-zinc-950 border border-zinc-800 focus:border-indigo-500 rounded-lg text-xs font-mono text-zinc-100 placeholder-zinc-600 focus:outline-none"
                />
              </div>
              <p className="text-[11px] text-zinc-500">
                Type this token after <span className="font-mono text-zinc-400">@</span> in Quick Gen to attach this LoRA.
              </p>
            </div>

            {/* Default Model Strength */}
            <div className="space-y-1.5">
              <div className="flex justify-between items-center text-xs">
                <label className="font-medium text-zinc-300">Default Model Strength</label>
                <span className="font-mono text-amber-300 tabular-nums">
                  {(selectedLora.defaultModelStrength ?? 1.0).toFixed(2)}x
                </span>
              </div>
              <input
                type="number"
                min="0.0"
                max="2.0"
                step="0.05"
                defaultValue={selectedLora.defaultModelStrength ?? 1.0}
                onBlur={(e) => {
                  const val = parseFloat(e.target.value);
                  if (!Number.isNaN(val) && val !== selectedLora.defaultModelStrength) {
                    handleUpdateMentionConfig(selectedLora.filename, {
                      mentionEnabled: selectedLora.mentionEnabled,
                      nickname: selectedLora.nickname,
                      defaultModelStrength: val,
                      defaultClipStrength: selectedLora.defaultClipStrength ?? 1.0,
                    });
                  }
                }}
                className="w-full px-3 py-1.5 bg-zinc-950 border border-zinc-800 focus:border-indigo-500 rounded-lg text-xs font-mono text-zinc-100 focus:outline-none"
              />
              <p className="text-[11px] text-zinc-500">
                Applied to ComfyUI workflow when mentioned (0.0 to 2.0).
              </p>
            </div>

            {/* Default CLIP Strength */}
            <div className="space-y-1.5">
              <div className="flex justify-between items-center text-xs">
                <label className="font-medium text-zinc-300">Default CLIP Strength</label>
                <span className="font-mono text-amber-300 tabular-nums">
                  {(selectedLora.defaultClipStrength ?? 1.0).toFixed(2)}x
                </span>
              </div>
              <input
                type="number"
                min="0.0"
                max="2.0"
                step="0.05"
                defaultValue={selectedLora.defaultClipStrength ?? 1.0}
                onBlur={(e) => {
                  const val = parseFloat(e.target.value);
                  if (!Number.isNaN(val) && val !== selectedLora.defaultClipStrength) {
                    handleUpdateMentionConfig(selectedLora.filename, {
                      mentionEnabled: selectedLora.mentionEnabled,
                      nickname: selectedLora.nickname,
                      defaultModelStrength: selectedLora.defaultModelStrength ?? 1.0,
                      defaultClipStrength: val,
                    });
                  }
                }}
                className="w-full px-3 py-1.5 bg-zinc-950 border border-zinc-800 focus:border-indigo-500 rounded-lg text-xs font-mono text-zinc-100 focus:outline-none"
              />
              <p className="text-[11px] text-zinc-500">
                Applied to CLIP conditioning when mentioned (0.0 to 2.0).
              </p>
            </div>
          </div>
        </div>

        {/* Model Usage Impact Report Modal/Box */}
        {impactReport && (
          <div className="bg-zinc-950 border border-indigo-500/50 rounded-xl p-5 space-y-2 text-xs">
            <h3 className="text-sm font-display font-semibold text-zinc-100">
              Model Usage Impact Report — {impactReport.modelName}
            </h3>
            <p className="text-zinc-400">
              Removing this model will impact{' '}
              <strong className="font-mono text-zinc-100">{impactReport.dependentImageCount}</strong>{' '}
              historical image(s),{' '}
              <strong className="font-mono text-zinc-100">{impactReport.dependentWorkflowCount}</strong>{' '}
              workflow(s), and{' '}
              <strong className="font-mono text-zinc-100">{impactReport.characters.length}</strong>{' '}
              linked character profile(s).
            </p>
          </div>
        )}

        {/* Highest-Rated Images */}
        {highestRated.length > 0 && (
          <div className="space-y-3">
            <h3 className="text-sm font-display font-semibold text-zinc-100">
              Highest-Rated Images Using {selectedLora.name}
            </h3>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
              {highestRated.map((img) => (
                <div
                  key={img.id}
                  onClick={() => onOpenImage(img)}
                  className="bg-zinc-900 border border-zinc-800 rounded-lg overflow-hidden cursor-pointer"
                >
                  <img
                    src={img.thumbnailUrl}
                    alt={img.filename}
                    className="w-full aspect-square object-cover"
                  />
                  <div className="p-2 text-xs flex justify-between">
                    <span className="truncate text-zinc-200">{img.filename}</span>
                    <span className="text-amber-400 font-mono">★ {img.rating}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* All Associated Images */}
        <div className="space-y-3">
          <h3 className="text-sm font-display font-semibold text-zinc-100">
            All Associated Images ({associatedImages.length})
          </h3>
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-3">
            {associatedImages.map((img) => {
              const loraEntry = img.loras.find(
                (l) => l.loraName.toLowerCase() === selectedLora.filename.toLowerCase()
              );
              return (
                <div
                  key={img.id}
                  onClick={() => onOpenImage(img)}
                  className="bg-zinc-900 border border-zinc-800 rounded-lg overflow-hidden cursor-pointer"
                >
                  <img
                    src={img.thumbnailUrl}
                    alt={img.filename}
                    className="w-full aspect-square object-cover"
                  />
                  <div className="p-2 text-xs space-y-0.5">
                    <div className="truncate text-zinc-200">{img.filename}</div>
                    {loraEntry && (
                      <div className="text-[11px] font-mono text-zinc-400">
                        M:{loraEntry.modelStrength} · C:{loraEntry.clipStrength}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    );
  }

  const filteredLoras = loras.filter((l) => {
    if (loraCategoryFilter && l.loraCategory !== loraCategoryFilter) return false;
    if (!loraSearch.trim()) return true;
    const q = loraSearch.toLowerCase();
    return (
      l.name.toLowerCase().includes(q) ||
      l.filename.toLowerCase().includes(q) ||
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
            className={`px-3.5 py-2 text-xs font-medium rounded-lg transition-colors cursor-pointer ${
              subTab === 'loras'
                ? 'bg-indigo-600 text-white'
                : 'bg-zinc-900 text-zinc-300 hover:bg-zinc-800'
            }`}
          >
            LoRA Explorer ({loras.length})
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

      {/* Sub-Tab 1: LoRA Explorer */}
      {subTab === 'loras' && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-3">
            <div className="relative flex-1 min-w-[240px]">
              <Search className="w-4 h-4 text-zinc-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={loraSearch}
                onChange={(e) => setLoraSearch(e.target.value)}
                placeholder="Search LoRAs by name, filename, hash, or character..."
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
          </div>

          {filteredLoras.length === 0 ? (
            <div className="bg-zinc-900/60 border border-zinc-800 rounded-xl p-10 text-center text-xs text-zinc-400">
              No LoRAs discovered in your mounted models directory or indexed image workflows yet.
            </div>
          ) : (
            <div className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden">
              <table className="w-full text-left text-xs">
                <thead className="bg-zinc-950/90 border-b border-zinc-800 text-zinc-400">
                  <tr>
                    <th className="py-3 px-3 w-10 text-center font-medium" title="Include in Quick Gen @mention">
                      @
                    </th>
                    <th className="py-3 px-4 font-medium">LoRA Name & File</th>
                    <th className="py-3 px-3 font-medium">Nickname</th>
                    <th className="py-3 px-3 font-medium">Classification</th>
                    <th className="py-3 px-3 font-medium">Linked Characters</th>
                    <th className="py-3 px-3 font-medium text-right">Images</th>
                    <th className="py-3 px-3 font-medium text-right">Avg Rating</th>
                    <th className="py-3 px-3 font-medium text-right">Default Str</th>
                    <th className="py-3 px-4 font-medium text-right">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-800/70">
                  {filteredLoras.map((l) => (
                    <tr
                      key={l.filename}
                      className="hover:bg-zinc-800/40 transition-colors group"
                    >
                      {/* Mention Checkbox */}
                      <td
                        className="py-3 px-3 text-center"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <input
                          type="checkbox"
                          checked={Boolean(l.mentionEnabled)}
                          onChange={(e) =>
                            handleUpdateMentionConfig(l.filename, {
                              mentionEnabled: e.target.checked,
                              nickname: l.nickname,
                              defaultModelStrength: l.defaultModelStrength ?? 1.0,
                              defaultClipStrength: l.defaultClipStrength ?? 1.0,
                            })
                          }
                          className="w-4 h-4 rounded border-zinc-700 bg-zinc-950 text-indigo-600 focus:ring-indigo-500 cursor-pointer"
                          title={l.mentionEnabled ? 'Enabled in @mention' : 'Click to enable in @mention'}
                        />
                      </td>

                      {/* LoRA Name & File */}
                      <td
                        className="py-3 px-4 cursor-pointer"
                        onClick={() => setSelectedLoraName(l.filename)}
                      >
                        <div className="font-medium text-zinc-100 hover:text-indigo-300 transition-colors">
                          {l.name}
                        </div>
                        <div className="text-[11px] font-mono text-zinc-500">{l.filename}</div>
                      </td>

                      {/* Inline Nickname Input */}
                      <td
                        className="py-3 px-3"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <div className="relative max-w-[140px]">
                          <span className="absolute left-2 top-1/2 -translate-y-1/2 text-zinc-500 font-mono text-[11px]">
                            @
                          </span>
                          <input
                            type="text"
                            defaultValue={l.nickname || ''}
                            placeholder="nickname"
                            onBlur={(e) => {
                              const clean = e.target.value.trim().replace(/^@+/, '');
                              if (clean !== (l.nickname || '')) {
                                handleUpdateMentionConfig(l.filename, {
                                  mentionEnabled: l.mentionEnabled,
                                  nickname: clean,
                                  defaultModelStrength: l.defaultModelStrength ?? 1.0,
                                  defaultClipStrength: l.defaultClipStrength ?? 1.0,
                                });
                              }
                            }}
                            className="w-full pl-5 pr-2 py-1 bg-zinc-950/80 border border-zinc-800 focus:border-indigo-500 rounded text-xs font-mono text-zinc-200 placeholder-zinc-700 focus:outline-none"
                          />
                        </div>
                      </td>

                      {/* Classification */}
                      <td
                        className="py-3 px-3 capitalize text-zinc-300 cursor-pointer"
                        onClick={() => setSelectedLoraName(l.filename)}
                      >
                        {l.loraCategory}
                      </td>

                      {/* Linked Characters */}
                      <td
                        className="py-3 px-3 text-zinc-300 cursor-pointer"
                        onClick={() => setSelectedLoraName(l.filename)}
                      >
                        {l.characters.length > 0
                          ? l.characters.map((c) => c.name).join(' · ')
                          : '—'}
                      </td>

                      {/* Images */}
                      <td
                        className="py-3 px-3 text-right font-mono tabular-nums text-zinc-200 cursor-pointer"
                        onClick={() => setSelectedLoraName(l.filename)}
                      >
                        {l.imageCount}
                      </td>

                      {/* Avg Rating */}
                      <td
                        className="py-3 px-3 text-right font-mono tabular-nums text-amber-400 cursor-pointer"
                        onClick={() => setSelectedLoraName(l.filename)}
                      >
                        {l.averageRating > 0 ? `★ ${l.averageRating}` : '—'}
                      </td>

                      {/* Default Model Strength */}
                      <td
                        className="py-3 px-3 text-right font-mono tabular-nums text-zinc-300 cursor-pointer"
                        onClick={() => setSelectedLoraName(l.filename)}
                      >
                        {(l.defaultModelStrength ?? 1.0).toFixed(2)}x
                      </td>

                      {/* Status */}
                      <td
                        className="py-3 px-4 text-right cursor-pointer"
                        onClick={() => setSelectedLoraName(l.filename)}
                      >
                        {l.isInstalled ? (
                          <span className="text-emerald-400">Installed</span>
                        ) : (
                          <span className="text-amber-400">Missing</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Sub-Tab 2: Missing Dependencies & Model Inventory */}
      {subTab === 'dependencies' && (
        <div className="space-y-6">
          {/* Missing Dependencies Alert Table */}
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

          {/* Complete Installed & Historical Inventory */}
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
                    <th className="py-2.5 px-3">Source</th>
                    <th className="py-2.5 px-3">Verification / Hash</th>
                    <th className="py-2.5 px-3 text-right">Size</th>
                    <th className="py-2.5 px-3 text-right">Used In</th>
                    <th className="py-2.5 px-3 text-right">Impact</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-800/60">
                  {models.map((m) => (
                    <tr key={m.id}>
                      <td className="py-2.5 px-3 font-mono text-zinc-200">{m.filename}</td>
                      <td className="py-2.5 px-3 capitalize text-zinc-300">{m.modelType}</td>
                      <td className="py-2.5 px-3 text-zinc-400">{m.sourceType}</td>
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
                        <button
                          type="button"
                          onClick={() => handleLoadImpact(m.filename)}
                          className="text-indigo-400 hover:text-indigo-300 cursor-pointer"
                        >
                          Impact Report
                        </button>
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

      {/* Sub-Tab 3: Civitai & Hugging Face Model Search & Confirmed Downloader */}
      {subTab === 'downloader' && (
        <div className="space-y-6">
          <form
            onSubmit={(e) => handleExternalSearch(e)}
            className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 flex flex-wrap items-center gap-3 text-xs"
          >
            <div className="flex items-center p-0.5 bg-zinc-950 border border-zinc-800 rounded-lg">
              <button
                type="button"
                onClick={() => setProvider('civitai')}
                className={`px-3 py-1.5 rounded-md font-medium cursor-pointer ${
                  provider === 'civitai' ? 'bg-indigo-600 text-white' : 'text-zinc-400'
                }`}
              >
                Civitai API
              </button>
              <button
                type="button"
                onClick={() => setProvider('huggingface')}
                className={`px-3 py-1.5 rounded-md font-medium cursor-pointer ${
                  provider === 'huggingface' ? 'bg-indigo-600 text-white' : 'text-zinc-400'
                }`}
              >
                Hugging Face Hub
              </button>
            </div>

            <input
              type="text"
              value={extQuery}
              onChange={(e) => setExtQuery(e.target.value)}
              placeholder="Search model name or paste SHA-256 / AutoV2 hash..."
              className="flex-1 min-w-[240px] px-3 py-2 bg-zinc-950 border border-zinc-800 rounded-lg text-zinc-100"
            />

            {provider === 'civitai' && (
              <select
                value={extTypeFilter}
                onChange={(e) => setExtTypeFilter(e.target.value)}
                className="px-3 py-2 bg-zinc-950 border border-zinc-800 rounded-lg text-zinc-200"
              >
                <option value="">All Types</option>
                <option value="lora">LoRA</option>
                <option value="checkpoint">Checkpoint</option>
              </select>
            )}

            <button
              type="submit"
              disabled={isSearchingExt}
              className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white font-medium rounded-lg cursor-pointer"
            >
              {isSearchingExt ? 'Searching...' : 'Search Models'}
            </button>
          </form>

          {searchError && (
            <div className="p-3 bg-rose-500/15 border border-rose-500/40 rounded-lg text-xs text-rose-300">
              {searchError}
            </div>
          )}

          {/* Search Results */}
          {searchResults.length > 0 && (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {searchResults.map((item) => (
                <div
                  key={`${item.provider}-${item.id}-${item.filename}`}
                  className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 flex flex-col justify-between space-y-3 text-xs"
                >
                  <div className="space-y-1.5">
                    <div className="flex items-start justify-between gap-2">
                      <h4 className="text-sm font-display font-semibold text-zinc-100">
                        {item.name}
                      </h4>
                      <span className="uppercase font-mono text-[10px] text-indigo-300 shrink-0">
                        {item.modelType}
                      </span>
                    </div>
                    <div className="text-zinc-400 font-mono text-[11px] truncate">
                      {item.filename} · {formatBytes(item.fileSize)}
                    </div>
                    {item.sha256Hash && (
                      <div className="text-[11px] font-mono text-emerald-400 truncate">
                        SHA256: {item.sha256Hash.slice(0, 16)}…
                      </div>
                    )}
                    <p className="text-zinc-400 line-clamp-2">{item.description}</p>
                  </div>

                  <button
                    type="button"
                    onClick={() => {
                      setPendingDownload(item);
                      setDlSubfolder(item.modelType === 'checkpoint' ? 'checkpoints' : 'loras');
                      setDlError(null);
                    }}
                    className="w-full inline-flex items-center justify-center gap-1.5 py-2 bg-zinc-800 hover:bg-indigo-600 text-zinc-100 font-medium rounded-lg transition-colors cursor-pointer"
                  >
                    <HardDriveDownload className="w-3.5 h-3.5" />
                    <span>Review & Download</span>
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Download History & Progress */}
          <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-display font-semibold text-zinc-100">
                Server-Side Download Queue & Hash Verification History
              </h3>
              <button
                type="button"
                onClick={() => api.listDownloads().then((r) => setDownloads(r.items || []))}
                className="text-xs text-indigo-400 hover:text-indigo-300 cursor-pointer"
              >
                Refresh Status
              </button>
            </div>

            {downloads.length === 0 ? (
              <p className="text-xs text-zinc-500">No model downloads initiated yet.</p>
            ) : (
              <div className="space-y-2 text-xs">
                {downloads.map((d) => {
                  const pct =
                    d.total_bytes > 0
                      ? Math.min(100, Math.round((d.bytes_downloaded / d.total_bytes) * 100))
                      : d.status === 'completed'
                      ? 100
                      : 0;
                  return (
                    <div
                      key={d.id}
                      className="bg-zinc-950 border border-zinc-800 rounded-lg p-3 space-y-1.5"
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-medium text-zinc-200">
                          {d.model_name} ({d.provider})
                        </span>
                        <span className="font-mono tabular-nums text-zinc-300">
                          {d.status} · {pct}%
                        </span>
                      </div>
                      <div className="text-[11px] font-mono text-zinc-400 truncate">
                        Destination: {d.destination_path}
                      </div>
                      {d.actual_hash && (
                        <div className="text-[11px] font-mono text-emerald-400">
                          Verified SHA256: {d.actual_hash.slice(0, 24)}…
                        </div>
                      )}
                      {d.error_message && (
                        <div className="text-[11px] text-rose-400 flex items-center gap-1">
                          <FileWarning className="w-3.5 h-3.5" />
                          <span>{d.error_message}</span>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Explicit User Confirmation Modal Before Downloading */}
      {pendingDownload && (
        <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4">
          <div className="bg-zinc-900 border border-zinc-800 rounded-xl max-w-md w-full p-6 space-y-4 text-xs">
            <h3 className="text-base font-display font-semibold text-zinc-100">
              Confirm Server-Side Model Download
            </h3>
            <p className="text-zinc-400">
              Models are downloaded strictly server-side into your writable downloads volume and verified via
              SHA-256 hash. Downloaded files are never executed automatically.
            </p>
            <div className="bg-zinc-950 border border-zinc-800 rounded-lg p-3 space-y-1 font-mono">
              <div className="text-zinc-200">Model: {pendingDownload.name}</div>
              <div className="text-zinc-400">File: {pendingDownload.filename}</div>
              <div className="text-zinc-400">Size: {formatBytes(pendingDownload.fileSize)}</div>
              {pendingDownload.sha256Hash && (
                <div className="text-emerald-400 truncate">
                  Expected SHA256: {pendingDownload.sha256Hash}
                </div>
              )}
            </div>

            <div>
              <label className="block text-zinc-300 mb-1">Destination Subfolder</label>
              <select
                value={dlSubfolder}
                onChange={(e) => setDlSubfolder(e.target.value)}
                className="w-full px-3 py-2 bg-zinc-950 border border-zinc-800 rounded-lg text-zinc-100"
              >
                <option value="loras">/downloads/loras</option>
                <option value="checkpoints">/downloads/checkpoints</option>
                <option value="vae">/downloads/vae</option>
                <option value="controlnet">/downloads/controlnet</option>
              </select>
            </div>

            <label className="inline-flex items-center gap-2 text-zinc-300 cursor-pointer">
              <input
                type="checkbox"
                checked={allowOverwrite}
                onChange={(e) => setAllowOverwrite(e.target.checked)}
              />
              <span>Explicitly allow overwriting if file already exists</span>
            </label>

            {dlError && <p className="text-rose-400">{dlError}</p>}

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setPendingDownload(null)}
                className="px-3.5 py-2 bg-zinc-800 text-zinc-300 rounded-lg cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmDownload}
                className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white font-medium rounded-lg cursor-pointer"
              >
                Confirm & Start Download
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
