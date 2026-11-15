import React, { useState } from 'react';
import {
  ArrowLeft,
  AtSign,
  Download,
  ExternalLink,
  Eye,
  EyeOff,
  FileText,
  Layers,
  RefreshCw,
  Sparkles,
  X,
} from 'lucide-react';
import { api } from '../api/client.ts';
import { formatBytes, getModelAvailabilityInfo } from '../shared/utils.ts';
import type { ImageRecord, LoraCategory, LoraExplorerItem } from '../shared/types.ts';
import { CharacterPortraitImage } from './character/CharacterPortraitImage.tsx';

interface LoraDetailViewProps {
  lora: LoraExplorerItem;
  allImages: ImageRecord[];
  impactReport: any | null;
  isFetchingCivitai: boolean;
  onBack: () => void;
  onLoadImpact: (filename: string) => void;
  onFilterGalleryByLora: (filename: string) => void;
  onFetchFromCivitai: (modelId: number) => void;
  onToggleVisibility: (loraName: string, isHidden: boolean) => Promise<void>;
  onUpdateMentionConfig: (
    loraName: string,
    payload: {
      mentionEnabled?: boolean;
      nickname?: string | null;
      defaultModelStrength?: number;
      defaultClipStrength?: number;
      triggerWord?: string | null;
      llmDescription?: string | null;
    }
  ) => Promise<void>;
  onRefresh: () => Promise<void>;
  onSyncModels?: () => Promise<void>;
  isSyncingModels?: boolean;
  onOpenImage: (img: ImageRecord) => void;
  onPushToast?: (text: string, type?: 'info' | 'success' | 'warning' | 'error') => void;
}

/**
 * Detailed inspection and configuration view for a single LoRA,
 * including Civitai reference metadata, cached preview strip, @mention defaults,
 * trigger words, user notes, Agent description, and CivitAI Description.
 */
export const LoraDetailView: React.FC<LoraDetailViewProps> = ({
  lora,
  allImages,
  impactReport,
  isFetchingCivitai,
  onBack,
  onLoadImpact,
  onFilterGalleryByLora,
  onFetchFromCivitai,
  onToggleVisibility,
  onUpdateMentionConfig,
  onRefresh,
  onSyncModels,
  isSyncingModels = false,
  onOpenImage,
  onPushToast,
}) => {
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);
  const avail = getModelAvailabilityInfo(lora);

  const associatedImages = allImages.filter((img) =>
    img.loras.some((l) => l.loraName.toLowerCase() === lora.filename.toLowerCase())
  );
  const highestRated = [...associatedImages]
    .filter((i) => i.rating >= 4)
    .sort((a, b) => b.rating - a.rating)
    .slice(0, 6);

  const previews = lora.previewImages || [];
  const characterPortrait =
    lora.loraCategory === 'character'
      ? lora.characters.find((c) => c.portraitThumbnailUrl) || null
      : null;
  const characterPortraitUrl = characterPortrait?.portraitThumbnailUrl || null;
  const hasRecommendedDiff =
    lora.recommendedWeight !== null &&
    lora.recommendedWeight !== undefined &&
    Math.abs((lora.defaultModelStrength ?? 1.0) - lora.recommendedWeight) > 0.01;

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
          <span>Back to LoRA Explorer</span>
        </button>

        <div className="flex flex-wrap items-center gap-2">
          {lora.modelId && (
            <button
              type="button"
              disabled={isFetchingCivitai}
              onClick={() => onFetchFromCivitai(lora.modelId!)}
              title="Check Civitai first, then Hugging Face"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-zinc-900 border border-zinc-700 hover:border-indigo-500/70 disabled:opacity-50 text-zinc-100 rounded-lg cursor-pointer transition-colors"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isFetchingCivitai ? 'animate-spin text-indigo-400' : ''}`} />
              <span>{isFetchingCivitai ? 'Fetching Details...' : 'Fetch Details'}</span>
            </button>
          )}
          {lora.civitaiUrl && (
            <a
              href={lora.civitaiUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-zinc-900 border border-zinc-800 hover:border-zinc-700 text-indigo-300 hover:text-indigo-200 rounded-lg transition-colors"
            >
              <ExternalLink className="w-3.5 h-3.5" />
              <span>
                {lora.civitaiUrl.includes('civitai.red') ? 'View on Civitai.red' : 'View on Civitai'}
              </span>
            </a>
          )}
          {lora.hfRepoId && (
            <a
              href={`https://huggingface.co/${lora.hfRepoId}`}
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
            onClick={() => onLoadImpact(lora.filename)}
            className="px-3 py-1.5 text-xs font-medium bg-zinc-900 border border-zinc-800 hover:border-zinc-700 text-zinc-200 rounded-lg cursor-pointer"
          >
            Usage Impact
          </button>
          <button
            type="button"
            onClick={() => onFilterGalleryByLora(lora.filename)}
            className="px-3 py-1.5 text-xs font-medium bg-zinc-900 border border-zinc-800 hover:border-zinc-700 text-zinc-200 rounded-lg cursor-pointer whitespace-nowrap shrink-0"
          >
            Filter Gallery
          </button>
          <button
            type="button"
            onClick={() => onToggleVisibility(lora.filename, !Boolean(lora.isHidden))}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border cursor-pointer transition-colors whitespace-nowrap shrink-0 ${
              lora.isHidden
                ? 'bg-amber-500/15 border-amber-500/50 text-amber-200 hover:bg-amber-500/25'
                : 'bg-zinc-900 border-zinc-800 hover:border-zinc-700 text-zinc-300 hover:text-zinc-100'
            }`}
          >
            {lora.isHidden ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
            <span>{lora.isHidden ? 'Unhide' : 'Hide'}</span>
          </button>
          <button
            type="button"
            disabled={associatedImages.length === 0}
            onClick={() =>
              api.exportImagesZip({
                imageIds: associatedImages.map((i) => i.id),
                archiveName: `lora-${lora.name}`,
              })
            }
            className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-medium bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white rounded-lg cursor-pointer whitespace-nowrap shrink-0"
          >
            <Download className="w-3.5 h-3.5" />
            <span className="font-mono tabular-nums">Export ({associatedImages.length})</span>
          </button>
        </div>
      </div>

      {/* LoRA Overview Card */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-6 space-y-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-start gap-4 min-w-0">
            {characterPortraitUrl && (
              <button
                type="button"
                onClick={() => setLightboxUrl(characterPortraitUrl)}
                className="w-16 h-16 rounded-xl overflow-hidden border border-zinc-700 hover:border-indigo-500/70 bg-zinc-950 shrink-0 cursor-pointer transition-colors"
                title="View linked character portrait"
              >
                <CharacterPortraitImage
                  src={characterPortraitUrl}
                  alt={lora.name}
                  crop={characterPortrait?.portraitCrop}
                />
              </button>
            )}
            <div className="space-y-1 min-w-0">
              <div className="flex flex-wrap items-center gap-2.5">
                <h1 className="text-2xl font-display font-bold text-zinc-100">{lora.name}</h1>
                {lora.baseModel && (
                  <span className="px-2 py-0.5 text-[11px] font-mono bg-zinc-950 border border-zinc-700 text-indigo-300 rounded">
                    {lora.baseModel}
                  </span>
                )}
                {lora.isHidden && (
                  <span className="text-xs font-medium text-amber-400">
                    · Hidden from Couchy
                  </span>
                )}
              </div>
              <p className="text-xs font-mono text-zinc-400 break-all">
                {lora.filename} · {lora.comfyuiPath || lora.filePath || 'Not locally installed'} ·{' '}
                {formatBytes(lora.fileSize)}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3 text-xs">
            <label className="text-zinc-400">Classification:</label>
            <select
              value={lora.loraCategory}
              onChange={async (e) => {
                await api.classifyLora(lora.filename, e.target.value as LoraCategory);
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

        {avail.state === 'pending_import' && (
          <div className="flex flex-wrap items-center justify-between gap-3 bg-amber-500/10 border border-amber-500/35 rounded-lg px-4 py-3 text-xs">
            <div className="space-y-0.5 text-amber-200 min-w-0">
              <div className="font-medium">
                Downloaded locally, but not yet detected in ComfyUI
              </div>
              <div className="text-[11px] text-amber-200/80 font-mono break-all">
                Stored in {lora.downloadFilePath || 'downloads folder'} — copy to ComfyUI loras
                folder (or refresh ComfyUI) to enable this LoRA for generation and @mention.
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
                  className="group relative aspect-[4/3] bg-zinc-950 border border-zinc-800 hover:border-indigo-500/60 rounded-lg overflow-hidden cursor-pointer transition-colors"
                >
                  <img
                    src={p.url}
                    alt={`${lora.name} preview ${idx + 1}`}
                    className="w-full h-full object-cover group-hover:scale-[1.02] transition-transform duration-200"
                    loading="lazy"
                  />
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-3 text-xs font-mono tabular-nums">
          <div className="bg-zinc-950 border border-zinc-800 rounded-lg p-3" title={avail.tooltip}>
            <span className="block text-[10px] font-sans text-zinc-400">Status</span>
            <span className={avail.colorClass}>{avail.label}</span>
          </div>
          <div className="bg-zinc-950 border border-zinc-800 rounded-lg p-3">
            <span className="block text-[10px] font-sans text-zinc-400">Images Using It</span>
            <span className="text-zinc-100">{lora.imageCount}</span>
          </div>
          <div className="bg-zinc-950 border border-zinc-800 rounded-lg p-3">
            <span className="block text-[10px] font-sans text-zinc-400">Average Rating</span>
            <span className="text-amber-400">★ {lora.averageRating}</span>
          </div>
          <div className="bg-zinc-950 border border-zinc-800 rounded-lg p-3">
            <span className="block text-[10px] font-sans text-zinc-400">Model Strength Range</span>
            <span className="text-zinc-100">
              {lora.minModelStrength ?? '—'} to {lora.maxModelStrength ?? '—'}
            </span>
          </div>
          <div className="bg-zinc-950 border border-zinc-800 rounded-lg p-3">
            <span className="block text-[10px] font-sans text-zinc-400">Recommended Weight</span>
            <span className="text-indigo-300">
              {lora.recommendedWeight !== null && lora.recommendedWeight !== undefined
                ? `${lora.recommendedWeight.toFixed(2)}x`
                : '—'}
            </span>
          </div>
          <div className="bg-zinc-950 border border-zinc-800 rounded-lg p-3">
            <span className="block text-[10px] font-sans text-zinc-400">SHA256 / AutoV2</span>
            <span className="text-zinc-100 truncate block">
              {lora.autov2Hash || lora.sha256Hash?.slice(0, 10) || 'Unverified'}
            </span>
          </div>
        </div>

        {lora.characters.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-300">
            <span className="text-zinc-400">Linked Characters:</span>
            {lora.characters.map((c) => (
              <span
                key={`${c.id}-${c.appearanceLabel}`}
                className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md bg-zinc-950 border border-zinc-800 text-zinc-200"
              >
                {c.portraitThumbnailUrl && (
                  <span className="w-4 h-4 rounded overflow-hidden shrink-0 inline-flex">
                    <CharacterPortraitImage
                      src={c.portraitThumbnailUrl}
                      alt={c.name}
                      crop={c.portraitCrop}
                    />
                  </span>
                )}
                <span>
                  {c.name} ({c.appearanceLabel})
                </span>
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Quick Gen @Mention & Activation Settings */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-6 space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-amber-500/10 border border-amber-500/30 flex items-center justify-center text-amber-400">
              <AtSign className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-sm font-display font-semibold text-zinc-100">
                Quick Gen @Mention & Activation Settings
              </h2>
              <p className="text-xs text-zinc-400">
                Configure nickname, activation trigger words, default strengths, and Agent notes.
              </p>
            </div>
          </div>

          <div
            className={`flex items-center gap-2.5 select-none ${
              !lora.isInstalled ? 'opacity-50' : ''
            }`}
            title={
              !lora.isInstalled
                ? 'Unavailable for @mention until present in ComfyUI models folder'
                : undefined
            }
          >
            <input
              type="checkbox"
              disabled={!lora.isInstalled}
              checked={Boolean(lora.mentionEnabled)}
              onChange={(e) =>
                onUpdateMentionConfig(lora.filename, {
                  mentionEnabled: e.target.checked,
                })
              }
              aria-label={`Include ${lora.name} in @Mention Menu`}
              className={`w-4 h-4 rounded border-zinc-700 bg-zinc-950 text-indigo-600 focus:ring-indigo-500 focus:ring-offset-zinc-900 ${
                lora.isInstalled ? 'cursor-pointer' : 'cursor-not-allowed'
              }`}
            />
            <span className="text-xs font-medium text-zinc-200">Include in @Mention Menu</span>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-2 border-t border-zinc-800/80">
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-zinc-300">LoRA Nickname</label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500 font-mono text-xs">
                @
              </span>
              <input
                key={`${lora.filename}-nickname-${lora.nickname || ''}`}
                type="text"
                defaultValue={lora.nickname || ''}
                placeholder="e.g. cyberpunk, retro, watercolor"
                onBlur={(e) => {
                  const clean = e.target.value.trim().replace(/^@+/, '');
                  if (clean !== (lora.nickname || '')) {
                    onUpdateMentionConfig(lora.filename, { nickname: clean });
                  }
                }}
                className="w-full pl-7 pr-3 py-1.5 bg-zinc-950 border border-zinc-800 focus:border-indigo-500 rounded-lg text-xs font-mono text-zinc-100 placeholder-zinc-600 focus:outline-none"
              />
            </div>
            <p className="text-[11px] text-zinc-500">
              Type this token after <span className="font-mono text-zinc-400">@</span> in Quick Gen.
            </p>
          </div>

          <div className="space-y-1.5">
            <div className="flex justify-between items-center text-xs">
              <label className="font-medium text-zinc-300">Default Model Strength</label>
              <span className="font-mono text-amber-300 tabular-nums">
                {(lora.defaultModelStrength ?? 1.0).toFixed(2)}x
              </span>
            </div>
            <input
              key={`${lora.filename}-model-str-${lora.defaultModelStrength ?? 1.0}`}
              type="number"
              min="0.0"
              max="2.0"
              step="0.05"
              defaultValue={lora.defaultModelStrength ?? 1.0}
              onBlur={(e) => {
                const val = parseFloat(e.target.value);
                if (!Number.isNaN(val) && val !== lora.defaultModelStrength) {
                  onUpdateMentionConfig(lora.filename, { defaultModelStrength: val });
                }
              }}
              className="w-full px-3 py-1.5 bg-zinc-950 border border-zinc-800 focus:border-indigo-500 rounded-lg text-xs font-mono text-zinc-100 focus:outline-none"
            />
            <div className="flex items-center justify-between text-[11px] text-zinc-500">
              <span>Range 0.0 to 2.0</span>
              {lora.recommendedWeight !== null && lora.recommendedWeight !== undefined && (
                <span className="font-mono text-indigo-300">
                  Rec: {lora.recommendedWeight.toFixed(2)}x
                  {hasRecommendedDiff && (
                    <button
                      type="button"
                      onClick={() =>
                        onUpdateMentionConfig(lora.filename, {
                          defaultModelStrength: lora.recommendedWeight!,
                        })
                      }
                      className="ml-1.5 text-indigo-400 hover:text-indigo-200 underline cursor-pointer"
                    >
                      Apply
                    </button>
                  )}
                </span>
              )}
            </div>
          </div>

          <div className="space-y-1.5">
            <div className="flex justify-between items-center text-xs">
              <label className="font-medium text-zinc-300">Default CLIP Strength</label>
              <span className="font-mono text-amber-300 tabular-nums">
                {(lora.defaultClipStrength ?? 1.0).toFixed(2)}x
              </span>
            </div>
            <input
              key={`${lora.filename}-clip-str-${lora.defaultClipStrength ?? 1.0}`}
              type="number"
              min="0.0"
              max="2.0"
              step="0.05"
              defaultValue={lora.defaultClipStrength ?? 1.0}
              onBlur={(e) => {
                const val = parseFloat(e.target.value);
                if (!Number.isNaN(val) && val !== lora.defaultClipStrength) {
                  onUpdateMentionConfig(lora.filename, { defaultClipStrength: val });
                }
              }}
              className="w-full px-3 py-1.5 bg-zinc-950 border border-zinc-800 focus:border-indigo-500 rounded-lg text-xs font-mono text-zinc-100 focus:outline-none"
            />
            <p className="text-[11px] text-zinc-500">CLIP conditioning weight (0.0 to 2.0).</p>
          </div>
        </div>

        {/* Trigger Words, Agent Description, and Personal User Notes */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-3 border-t border-zinc-800/60">
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-zinc-300">Trigger Word(s)</label>
            <input
              key={`${lora.filename}-trigger-${lora.triggerWord || ''}`}
              type="text"
              defaultValue={lora.triggerWord || ''}
              placeholder="e.g. cyber_glow, rim light"
              onBlur={(e) => {
                const clean = e.target.value.trim();
                if (clean !== (lora.triggerWord || '')) {
                  onUpdateMentionConfig(lora.filename, { triggerWord: clean });
                }
              }}
              className="w-full px-3 py-1.5 bg-zinc-950 border border-zinc-800 focus:border-indigo-500 rounded-lg text-xs font-mono text-zinc-100 placeholder-zinc-600 focus:outline-none"
            />
            <p className="text-[11px] text-zinc-500">
              Auto-filled from Civitai only when empty; always preserved once edited.
            </p>
          </div>

          <div className="space-y-1.5">
            <div className="flex items-center justify-between gap-2">
              <label className="text-xs font-medium text-zinc-300">
                Agent Description (Conversation Mode)
              </label>
              {(lora.loraCategory === 'character' || lora.characters.length > 0) && (
                <span className="text-[10px] font-medium text-amber-400">Locked character</span>
              )}
            </div>
            <textarea
              key={`${lora.filename}-llm-desc-${lora.llmDescription || ''}`}
              rows={2}
              defaultValue={lora.llmDescription || ''}
              placeholder="Describe when the Conversation Agent should pick this LoRA..."
              onBlur={(e) => {
                const clean = e.target.value.trim();
                if (clean !== (lora.llmDescription || '')) {
                  onUpdateMentionConfig(lora.filename, { llmDescription: clean });
                }
              }}
              className="w-full px-3 py-1.5 bg-zinc-950 border border-zinc-800 focus:border-indigo-500 rounded-lg text-xs text-zinc-100 placeholder-zinc-600 focus:outline-none resize-y"
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-medium text-zinc-300">Personal User Notes</label>
            <textarea
              key={`${lora.filename}-user-notes-${lora.userNotes || ''}`}
              rows={2}
              defaultValue={lora.userNotes || ''}
              placeholder="Personal usage reminders, preferred CFG, or sampler pairing..."
              onBlur={async (e) => {
                const clean = e.target.value.trim();
                if (clean !== (lora.userNotes || '')) {
                  await api.classifyLora(lora.filename, lora.loraCategory, clean);
                  await onRefresh();
                  onPushToast?.(`Saved personal notes for ${lora.name}`, 'success');
                }
              }}
              className="w-full px-3 py-1.5 bg-zinc-950 border border-zinc-800 focus:border-indigo-500 rounded-lg text-xs text-zinc-100 placeholder-zinc-600 focus:outline-none resize-y"
            />
          </div>
        </div>
      </div>

      {/* Dedicated Source Description Area (Civitai or Hugging Face Model Card) */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-6 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <FileText className="w-4 h-4 text-indigo-400" />
            <h2 className="text-sm font-display font-semibold text-zinc-100">
              {!lora.civitaiUrl && lora.hfRepoId
                ? 'Hugging Face Model Card'
                : 'CivitAI Description'}
            </h2>
          </div>
          <div className="flex items-center gap-3 text-[11px] font-mono text-zinc-500">
            {lora.civitaiFetchedAt && (
              <span>Synced {new Date(lora.civitaiFetchedAt + 'Z').toLocaleDateString()}</span>
            )}
            {lora.civitaiUrl && (
              <a
                href={lora.civitaiUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-indigo-400 hover:text-indigo-300 font-sans"
              >
                <span>Open original page</span>
                <ExternalLink className="w-3 h-3" />
              </a>
            )}
            {lora.hfRepoId && (
              <a
                href={`https://huggingface.co/${lora.hfRepoId}`}
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

        {lora.civitaiDescription ? (
          <div className="bg-zinc-950 border border-zinc-800/80 rounded-lg p-4 max-h-80 overflow-y-auto text-xs leading-relaxed text-zinc-300 whitespace-pre-wrap break-words">
            {lora.civitaiDescription}
          </div>
        ) : (
          <div className="bg-zinc-950/60 border border-zinc-800/70 rounded-lg px-4 py-4 flex flex-wrap items-center justify-between gap-3 text-xs text-zinc-400">
            <span className="flex items-center gap-2">
              <Sparkles className="w-3.5 h-3.5 text-zinc-500" />
              <span>No Civitai or Hugging Face description stored yet for this LoRA.</span>
            </span>
            {lora.modelId && (
              <button
                type="button"
                disabled={isFetchingCivitai}
                onClick={() => onFetchFromCivitai(lora.modelId!)}
                className="text-indigo-400 hover:text-indigo-300 font-medium cursor-pointer disabled:opacity-50"
              >
                {isFetchingCivitai ? 'Fetching...' : 'Fetch Details now'}
              </button>
            )}
          </div>
        )}
      </div>

      {/* Model Usage Impact Report */}
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
            Highest-Rated Images Using {lora.name}
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
            <Layers className="w-4 h-4" />
            <span>No indexed gallery images reference this LoRA yet.</span>
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-3">
            {associatedImages.map((img) => {
              const loraEntry = img.loras.find(
                (l) => l.loraName.toLowerCase() === lora.filename.toLowerCase()
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
