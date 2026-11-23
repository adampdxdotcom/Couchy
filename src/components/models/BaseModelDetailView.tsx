import React, { useState } from 'react';
import {
  ArrowLeft,
  AtSign,
  Cpu,
  ExternalLink,
  Eye,
  EyeOff,
  FileText,
  RefreshCw,
  Sparkles,
  X,
} from 'lucide-react';
import { formatBytes, getModelAvailabilityInfo } from '../../shared/utils.ts';
import type { ImageRecord, ModelInventoryItem } from '../../shared/types.ts';
import { normalizeLoraKey } from '../quickgen/quickGenUtils.ts';
import { formatModelTypeLabel, isBaseModelType } from './BaseModelExplorerGrid.tsx';
import { InlineEditableTitle } from '../shared/InlineEditableTitle.tsx';

interface BaseModelDetailViewProps {
  model: ModelInventoryItem;
  allImages: ImageRecord[];
  impactReport: any | null;
  isFetchingCivitai: boolean;
  onBack: () => void;
  onLoadImpact: (filename: string) => void;
  onFilterGalleryByModel: (filename: string) => void;
  onFetchFromCivitai: (modelId: number) => void;
  onToggleVisibility: (modelId: number, isHidden: boolean) => Promise<void>;
  onUpdateModelConfig: (
    modelId: number,
    payload: {
      name?: string;
      mentionEnabled?: boolean;
      nickname?: string | null;
      llmDescription?: string | null;
      userNotes?: string | null;
    }
  ) => Promise<void>;
  onSyncModels?: () => Promise<void>;
  isSyncingModels?: boolean;
  onOpenImage: (img: ImageRecord) => void;
}

/**
 * Detailed inspection and configuration view for a Base Model or support component,
 * including Civitai metadata/previews, user-only @mention settings, and Details & Strengths.
 */
export const BaseModelDetailView: React.FC<BaseModelDetailViewProps> = ({
  model,
  allImages,
  impactReport,
  isFetchingCivitai,
  onBack,
  onLoadImpact,
  onFilterGalleryByModel,
  onFetchFromCivitai,
  onToggleVisibility,
  onUpdateModelConfig,
  onSyncModels,
  isSyncingModels = false,
  onOpenImage,
}) => {
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);
  const isBase = isBaseModelType(model.modelType);
  const avail = getModelAvailabilityInfo(model);
  const targetKey = normalizeLoraKey(model.filename);

  const associatedImages = allImages.filter(
    (img) =>
      (img.checkpointName && normalizeLoraKey(img.checkpointName) === targetKey) ||
      img.models.some((m) => normalizeLoraKey(m.modelName) === targetKey)
  );
  const highestRated = [...associatedImages]
    .filter((i) => i.rating >= 4)
    .sort((a, b) => b.rating - a.rating)
    .slice(0, 6);

  const previews = model.previewImages || [];

  return (
    <div className="px-6 py-6 max-w-7xl mx-auto space-y-6">
      {/* Top Action Bar */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center gap-2 text-xs font-medium text-zinc-300 hover:text-white cursor-pointer"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>Back to Base Models</span>
        </button>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={isFetchingCivitai}
            onClick={() => onFetchFromCivitai(model.id)}
            title="Check Civitai first, then Hugging Face"
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-zinc-900 border border-zinc-700 hover:border-emerald-500/70 disabled:opacity-50 text-zinc-100 rounded-lg cursor-pointer transition-colors"
          >
            <RefreshCw
              className={`w-3.5 h-3.5 ${isFetchingCivitai ? 'animate-spin text-emerald-400' : ''}`}
            />
            <span>{isFetchingCivitai ? 'Fetching Details...' : 'Fetch Details'}</span>
          </button>
          {model.civitaiUrl && (
            <a
              href={model.civitaiUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-zinc-900 border border-zinc-800 hover:border-zinc-700 text-indigo-300 hover:text-indigo-200 rounded-lg transition-colors"
            >
              <ExternalLink className="w-3.5 h-3.5" />
              <span>
                {model.civitaiUrl.includes('civitai.red') ? 'View on Civitai.red' : 'View on Civitai'}
              </span>
            </a>
          )}
          {model.hfRepoId && (
            <a
              href={`https://huggingface.co/${model.hfRepoId}`}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-zinc-900 border border-zinc-800 hover:border-zinc-700 text-amber-300 hover:text-amber-200 rounded-lg transition-colors"
            >
              <ExternalLink className="w-3.5 h-3.5" />
              <span>View on Hugging Face</span>
            </a>
          )}
          <button
            type="button"
            onClick={() => onLoadImpact(model.filename)}
            className="px-3 py-1.5 text-xs font-medium bg-zinc-900 border border-zinc-800 hover:border-zinc-700 text-zinc-200 rounded-lg cursor-pointer"
          >
            Usage Impact
          </button>
          {isBase && (
            <button
              type="button"
              onClick={() => onFilterGalleryByModel(model.filename)}
              className="px-3 py-1.5 text-xs font-medium bg-zinc-900 border border-zinc-800 hover:border-zinc-700 text-zinc-200 rounded-lg cursor-pointer whitespace-nowrap shrink-0"
            >
              Filter Gallery
            </button>
          )}
          <button
            type="button"
            onClick={() => onToggleVisibility(model.id, !Boolean(model.isHidden))}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border cursor-pointer transition-colors whitespace-nowrap shrink-0 ${
              model.isHidden
                ? 'bg-amber-500/15 border-amber-500/50 text-amber-200 hover:bg-amber-500/25'
                : 'bg-zinc-900 border-zinc-800 hover:border-zinc-700 text-zinc-300 hover:text-zinc-100'
            }`}
          >
            {model.isHidden ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
            <span>{model.isHidden ? 'Unhide' : 'Hide'}</span>
          </button>
        </div>
      </div>

      {/* Model Overview Card */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-6 space-y-5">
        <div className="space-y-1 min-w-0">
          <div className="flex flex-wrap items-center gap-2.5">
            <InlineEditableTitle
              value={model.name}
              resetKey={model.id}
              editTooltip="Click to rename model (local display name only)"
              ariaLabel="Rename model"
              onCommit={(nextName) => onUpdateModelConfig(model.id, { name: nextName })}
            />
            <span
              className={`px-2 py-0.5 text-[11px] font-mono bg-zinc-950 border rounded ${
                isBase
                  ? 'border-emerald-500/40 text-emerald-300'
                  : 'border-zinc-700 text-zinc-300'
              }`}
            >
              {formatModelTypeLabel(model.modelType)}
            </span>
            {model.baseModel && (
              <span className="px-2 py-0.5 text-[11px] font-mono bg-zinc-950 border border-zinc-700 text-indigo-300 rounded">
                {model.baseModel}
              </span>
            )}
            {model.isHidden && (
              <span className="text-xs font-medium text-amber-400">· Hidden</span>
            )}
          </div>
          <p className="text-xs font-mono text-zinc-400 break-all">
            {model.filename} · {model.comfyuiPath || model.filePath || 'Not locally installed'} ·{' '}
            {formatBytes(model.fileSize)}
          </p>
        </div>

        {avail.state === 'pending_import' && (
          <div className="flex flex-wrap items-center justify-between gap-3 bg-amber-500/10 border border-amber-500/35 rounded-lg px-4 py-3 text-xs">
            <div className="space-y-0.5 text-amber-200 min-w-0">
              <div className="font-medium">
                Downloaded locally, but not yet detected in ComfyUI
              </div>
              <div className="text-[11px] text-amber-200/80 font-mono break-all">
                Stored in {model.downloadFilePath || 'downloads folder'} — copy to ComfyUI models
                folder (or refresh ComfyUI) to make this model available for generation and @mention.
              </div>
            </div>
            {onSyncModels && (
              <button
                type="button"
                disabled={isSyncingModels}
                onClick={onSyncModels}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-amber-500/20 hover:bg-amber-500/30 border border-amber-400/50 text-amber-100 rounded-lg cursor-pointer disabled:opacity-50 shrink-0"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${isSyncingModels ? 'animate-spin' : ''}`} />
                <span>{isSyncingModels ? 'Checking...' : 'Re-check ComfyUI'}</span>
              </button>
            )}
          </div>
        )}

        {/* Cached Civitai Preview Strip */}
        {previews.length > 0 && (
          <div className="space-y-2">
            <div className="flex items-center justify-between text-[11px] text-zinc-400">
              <span className="font-medium text-zinc-300">Civitai Preview Thumbnails</span>
              <span className="font-mono">{previews.length} cached locally</span>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {previews.map((p, idx) => (
                <button
                  key={`${p.filename}-${idx}`}
                  type="button"
                  onClick={() => setLightboxUrl(p.url)}
                  className="group relative aspect-[4/3] bg-zinc-950 border border-zinc-800 hover:border-emerald-500/60 rounded-lg overflow-hidden cursor-pointer transition-colors"
                >
                  <img
                    src={p.url}
                    alt={`${model.name} preview ${idx + 1}`}
                    className="w-full h-full object-cover group-hover:scale-[1.02] transition-transform duration-200"
                    loading="lazy"
                  />
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 text-xs font-mono tabular-nums">
          <div className="bg-zinc-950 border border-zinc-800 rounded-lg p-3" title={avail.tooltip}>
            <span className="block text-[10px] font-sans text-zinc-400">Status</span>
            <span className={avail.colorClass}>{avail.label}</span>
          </div>
          <div className="bg-zinc-950 border border-zinc-800 rounded-lg p-3">
            <span className="block text-[10px] font-sans text-zinc-400">Images Using It</span>
            <span className="text-zinc-100">{model.dependentImageCount}</span>
          </div>
          <div className="bg-zinc-950 border border-zinc-800 rounded-lg p-3">
            <span className="block text-[10px] font-sans text-zinc-400">Workflows</span>
            <span className="text-zinc-100">{model.dependentWorkflowCount}</span>
          </div>
          <div className="bg-zinc-950 border border-zinc-800 rounded-lg p-3">
            <span className="block text-[10px] font-sans text-zinc-400">Average Rating</span>
            <span className="text-amber-400">
              {model.averageRating && model.averageRating > 0 ? `★ ${model.averageRating}` : '—'}
            </span>
          </div>
          <div className="bg-zinc-950 border border-zinc-800 rounded-lg p-3">
            <span className="block text-[10px] font-sans text-zinc-400">File Size</span>
            <span className="text-zinc-100">{formatBytes(model.fileSize)}</span>
          </div>
          <div className="bg-zinc-950 border border-zinc-800 rounded-lg p-3">
            <span className="block text-[10px] font-sans text-zinc-400">SHA256 / AutoV2</span>
            <span className="text-zinc-100 truncate block">
              {model.autov2Hash || model.sha256Hash?.slice(0, 10) || 'Unverified'}
            </span>
          </div>
        </div>
      </div>

      {/* Quick Gen @Mention & Model Details / Strengths */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-6 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center text-emerald-400">
              <AtSign className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-sm font-display font-semibold text-zinc-100">
                {isBase
                  ? 'Quick Gen @Mention & Model Strengths'
                  : 'Model Details & Strengths'}
              </h2>
              <p className="text-xs text-zinc-400">
                {isBase
                  ? 'User-only @mention attaches this model as the active Base Model pill in Quick Gen (not auto-selected by Agent yet).'
                  : 'Document strengths and technical characteristics for future reference.'}
              </p>
            </div>
          </div>

          {isBase && (
            <div
              className={`flex items-center gap-2.5 select-none ${
                !model.isInstalled ? 'opacity-50' : ''
              }`}
              title={
                !model.isInstalled
                  ? 'Unavailable for @mention until present in ComfyUI models folder'
                  : undefined
              }
            >
              <input
                type="checkbox"
                disabled={!model.isInstalled}
                checked={Boolean(model.mentionEnabled)}
                onChange={(e) =>
                  onUpdateModelConfig(model.id, {
                    mentionEnabled: e.target.checked,
                  })
                }
                aria-label={`Include ${model.name} in @Mention Menu`}
                className={`w-4 h-4 rounded border-zinc-700 bg-zinc-950 text-emerald-500 focus:ring-emerald-500 focus:ring-offset-zinc-900 ${
                  model.isInstalled ? 'cursor-pointer' : 'cursor-not-allowed'
                }`}
              />
              <span className="text-xs font-medium text-zinc-200">Include in @Mention Menu</span>
            </div>
          )}
        </div>

        <div
          className={`grid grid-cols-1 ${isBase ? 'md:grid-cols-3' : 'md:grid-cols-2'} gap-4 pt-3 border-t border-zinc-800/80`}
        >
          {isBase && (
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-zinc-300">Model Nickname</label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500 font-mono text-xs">
                  @
                </span>
                <input
                  key={`${model.id}-nickname-${model.nickname || ''}`}
                  type="text"
                  defaultValue={model.nickname || ''}
                  placeholder="e.g. krea2, krea_photoreal"
                  onBlur={(e) => {
                    const clean = e.target.value.trim().replace(/^@+/, '').toLowerCase();
                    if (clean !== (model.nickname || '').toLowerCase()) {
                      onUpdateModelConfig(model.id, { nickname: clean });
                    }
                  }}
                  className="w-full pl-7 pr-3 py-1.5 bg-zinc-950 border border-zinc-800 focus:border-emerald-500 rounded-lg text-xs font-mono text-zinc-100 placeholder-zinc-600 focus:outline-none"
                />
              </div>
              <p className="text-[11px] text-zinc-500">
                Type this token after <span className="font-mono text-zinc-400">@</span> in Quick Gen to swap the green Base Model pill.
              </p>
            </div>
          )}

          <div className="space-y-1.5">
            <div className="flex items-center justify-between gap-2">
              <label className="text-xs font-medium text-zinc-300">
                Model Details &amp; Strengths
              </label>
              <span className="text-[10px] font-mono text-zinc-500">Future LLM context</span>
            </div>
            <textarea
              key={`${model.id}-details-${model.llmDescription || ''}`}
              rows={3}
              defaultValue={model.llmDescription || ''}
              placeholder="Document visual strengths, realism, lighting, skin texture, anatomy fidelity, ideal subjects, or recommended steps/CFG..."
              onBlur={(e) => {
                const clean = e.target.value.trim();
                if (clean !== (model.llmDescription || '')) {
                  onUpdateModelConfig(model.id, { llmDescription: clean });
                }
              }}
              className="w-full px-3 py-1.5 bg-zinc-950 border border-zinc-800 focus:border-emerald-500 rounded-lg text-xs text-zinc-100 placeholder-zinc-600 focus:outline-none resize-y"
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-medium text-zinc-300">Personal User Notes</label>
            <textarea
              key={`${model.id}-notes-${model.userNotes || ''}`}
              rows={3}
              defaultValue={model.userNotes || ''}
              placeholder="Personal workflow notes, quantization, VRAM usage, or sampler pairings..."
              onBlur={(e) => {
                const clean = e.target.value.trim();
                if (clean !== (model.userNotes || '')) {
                  onUpdateModelConfig(model.id, { userNotes: clean });
                }
              }}
              className="w-full px-3 py-1.5 bg-zinc-950 border border-zinc-800 focus:border-emerald-500 rounded-lg text-xs text-zinc-100 placeholder-zinc-600 focus:outline-none resize-y"
            />
          </div>
        </div>
      </div>

      {/* Source Description Card (Civitai or Hugging Face Model Card) */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-6 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <FileText className="w-4 h-4 text-emerald-400" />
            <h2 className="text-sm font-display font-semibold text-zinc-100">
              {!model.civitaiUrl && model.hfRepoId
                ? 'Hugging Face Model Card'
                : 'CivitAI Description'}
            </h2>
          </div>
          <div className="flex items-center gap-3 text-[11px] font-mono text-zinc-500">
            {model.civitaiFetchedAt && (
              <span>Synced {new Date(model.civitaiFetchedAt + 'Z').toLocaleDateString()}</span>
            )}
            {model.civitaiUrl && (
              <a
                href={model.civitaiUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-indigo-400 hover:text-indigo-300 font-sans"
              >
                <span>Open original page</span>
                <ExternalLink className="w-3 h-3" />
              </a>
            )}
            {model.hfRepoId && (
              <a
                href={`https://huggingface.co/${model.hfRepoId}`}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-amber-300 hover:text-amber-200 font-sans"
              >
                <span>Open on Hugging Face</span>
                <ExternalLink className="w-3 h-3" />
              </a>
            )}
          </div>
        </div>

        {model.civitaiDescription ? (
          <div className="bg-zinc-950 border border-zinc-800/80 rounded-lg p-4 max-h-80 overflow-y-auto text-xs leading-relaxed text-zinc-300 whitespace-pre-wrap break-words">
            {model.civitaiDescription}
          </div>
        ) : (
          <div className="bg-zinc-950/60 border border-zinc-800/70 rounded-lg px-4 py-4 flex flex-wrap items-center justify-between gap-3 text-xs text-zinc-400">
            <span className="flex items-center gap-2">
              <Sparkles className="w-3.5 h-3.5 text-zinc-500" />
              <span>No Civitai or Hugging Face description stored yet for this model.</span>
            </span>
            <button
              type="button"
              disabled={isFetchingCivitai}
              onClick={() => onFetchFromCivitai(model.id)}
              className="text-emerald-400 hover:text-emerald-300 font-medium cursor-pointer disabled:opacity-50"
            >
              {isFetchingCivitai ? 'Fetching...' : 'Fetch Details now'}
            </button>
          </div>
        )}
      </div>

      {/* Model Usage Impact Report */}
      {impactReport && (
        <div className="bg-zinc-950 border border-emerald-500/50 rounded-xl p-5 space-y-2 text-xs">
          <h3 className="text-sm font-display font-semibold text-zinc-100">
            Model Usage Impact Report — {impactReport.modelName}
          </h3>
          <p className="text-zinc-400">
            Removing this model will impact{' '}
            <strong className="font-mono text-zinc-100">{impactReport.dependentImageCount}</strong>{' '}
            historical image(s) and{' '}
            <strong className="font-mono text-zinc-100">{impactReport.dependentWorkflowCount}</strong>{' '}
            workflow(s).
          </p>
        </div>
      )}

      {/* Highest-Rated Images */}
      {highestRated.length > 0 && (
        <div className="space-y-3">
          <h3 className="text-sm font-display font-semibold text-zinc-100">
            Highest-Rated Images Using {model.name}
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
        {associatedImages.length === 0 ? (
          <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-6 text-center text-xs text-zinc-500 flex items-center justify-center gap-2">
            <Cpu className="w-4 h-4" />
            <span>No indexed gallery images reference this model yet.</span>
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-3">
            {associatedImages.map((img) => (
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
                <div className="p-2 text-xs truncate text-zinc-200">{img.filename}</div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Preview Thumbnail Lightbox */}
      {lightboxUrl && (
        <div
          className="fixed inset-0 z-50 bg-black/85 flex items-center justify-center p-6"
          onClick={() => setLightboxUrl(null)}
        >
          <button
            type="button"
            onClick={() => setLightboxUrl(null)}
            className="absolute top-4 right-4 p-2 rounded-full bg-zinc-900/80 border border-zinc-700 text-zinc-200 hover:text-white cursor-pointer"
            aria-label="Close preview"
          >
            <X className="w-5 h-5" />
          </button>
          <img
            src={lightboxUrl}
            alt="Civitai preview"
            className="max-w-full max-h-[85vh] rounded-xl border border-zinc-800 object-contain"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}
    </div>
  );
};
