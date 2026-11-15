import React from 'react';
import { Cpu, ExternalLink, Eye, EyeOff } from 'lucide-react';
import { formatBytes } from '../../shared/utils.ts';
import type { ModelInventoryItem, ModelType } from '../../shared/types.ts';

export const BASE_MODEL_TYPES = new Set<ModelType>(['diffusion', 'checkpoint']);

export function isBaseModelType(modelType: ModelType): boolean {
  return BASE_MODEL_TYPES.has(modelType);
}

export function formatModelTypeLabel(modelType: ModelType): string {
  switch (modelType) {
    case 'diffusion':
      return 'Diffusion Base';
    case 'checkpoint':
      return 'Checkpoint';
    case 'clip':
      return 'CLIP / Encoder';
    case 'vae':
      return 'VAE';
    case 'upscaler':
      return 'Upscaler';
    case 'controlnet':
      return 'ControlNet';
    case 'embedding':
      return 'Embedding';
    default:
      return modelType;
  }
}

export interface BaseModelExplorerListProps {
  models: ModelInventoryItem[];
  brokenThumbs: Record<string, boolean>;
  highlightedFilename?: string | null;
  onMarkBrokenThumb: (url: string) => void;
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
 * Responsive card grid for Base Models and support components (CLIP, VAE, Upscalers),
 * duplicating LoRA Explorer's card density with inline @mention, @nickname, and Hide/Unhide controls.
 */
export const BaseModelExplorerGrid: React.FC<BaseModelExplorerListProps> = ({
  models,
  brokenThumbs,
  highlightedFilename,
  onMarkBrokenThumb,
  onSelectModel,
  onUpdateModelConfig,
  onToggleVisibility,
}) => {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
      {models.map((m) => {
        const coverUrl = m.previewImages?.[0]?.url || null;
        const hasThumb = Boolean(coverUrl && !brokenThumbs[coverUrl]);
        const isBase = isBaseModelType(m.modelType);
        const isHighlighted =
          Boolean(highlightedFilename) &&
          m.filename.toLowerCase() === highlightedFilename!.toLowerCase();

        return (
          <div
            key={m.id}
            onClick={() => onSelectModel(m.id)}
            className={`group bg-zinc-900 border rounded-xl overflow-hidden flex flex-col justify-between cursor-pointer transition-colors ${
              isHighlighted
                ? 'border-emerald-500 ring-1 ring-emerald-500/40'
                : 'border-zinc-800 hover:border-zinc-700'
            } ${m.isHidden ? 'opacity-75' : ''}`}
          >
            <div>
              {/* Preview Thumbnail Header */}
              <div className="relative aspect-[4/3] bg-zinc-950 border-b border-zinc-800 overflow-hidden">
                {hasThumb ? (
                  <img
                    src={coverUrl!}
                    alt={m.name}
                    loading="lazy"
                    onError={() => {
                      if (coverUrl) onMarkBrokenThumb(coverUrl);
                    }}
                    className="w-full h-full object-cover group-hover:scale-[1.02] transition-transform duration-200"
                  />
                ) : (
                  <div className="w-full h-full flex flex-col items-center justify-center gap-1.5 text-zinc-600 bg-gradient-to-br from-zinc-950 via-zinc-900/90 to-zinc-950">
                    <Cpu className={`w-6 h-6 ${isBase ? 'text-emerald-500/50' : 'text-zinc-700'}`} />
                    <span className="text-[11px] font-mono text-zinc-500 px-3 text-center truncate max-w-full">
                      {m.name}
                    </span>
                  </div>
                )}

                {/* Isolated @Mention Toggle for Base Models */}
                {isBase && (
                  <div
                    className="absolute top-2.5 left-2.5 flex items-center gap-1.5 px-2 py-1 rounded-md bg-zinc-950/85 border border-zinc-700/80"
                    onClick={(e) => e.stopPropagation()}
                    title={
                      m.mentionEnabled
                        ? 'Enabled in Quick Gen @mention'
                        : 'Click to enable in Quick Gen @mention'
                    }
                  >
                    <input
                      type="checkbox"
                      checked={Boolean(m.mentionEnabled)}
                      onClick={(e) => e.stopPropagation()}
                      onChange={(e) =>
                        onUpdateModelConfig(m.id, {
                          mentionEnabled: e.target.checked,
                        })
                      }
                      aria-label={`Include ${m.name} in @mention menu`}
                      className="w-3.5 h-3.5 rounded border-zinc-700 bg-zinc-950 text-emerald-500 focus:ring-emerald-500 cursor-pointer"
                    />
                    <span className="text-[10px] font-mono text-emerald-300">@</span>
                  </div>
                )}

                {/* Top-right Architecture & Civitai Link */}
                <div className="absolute top-2.5 right-2.5 flex items-center gap-1.5">
                  <span
                    className={`px-1.5 py-0.5 text-[10px] font-mono bg-zinc-950/85 border rounded ${
                      isBase
                        ? 'border-emerald-500/40 text-emerald-300'
                        : 'border-zinc-700/80 text-zinc-300'
                    }`}
                  >
                    {m.baseModel || formatModelTypeLabel(m.modelType)}
                  </span>
                  {m.civitaiUrl && (
                    <a
                      href={m.civitaiUrl}
                      target="_blank"
                      rel="noreferrer"
                      onClick={(e) => e.stopPropagation()}
                      title={
                        m.civitaiUrl.includes('civitai.red')
                          ? 'Open on Civitai.red'
                          : 'Open on Civitai.com'
                      }
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
                  <div className="font-medium text-sm text-zinc-100 group-hover:text-emerald-300 transition-colors truncate">
                    {m.name}
                  </div>
                  <div className="text-[11px] font-mono text-zinc-500 truncate">{m.filename}</div>
                </div>

                <div className="text-[11px] text-zinc-400 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 font-mono tabular-nums">
                  {m.isHidden && (
                    <>
                      <span className="font-sans font-medium text-amber-400">Hidden</span>
                      <span>·</span>
                    </>
                  )}
                  <span className="font-sans text-zinc-300">{formatModelTypeLabel(m.modelType)}</span>
                  <span>·</span>
                  <span>{m.dependentImageCount} imgs</span>
                  {Boolean(m.averageRating && m.averageRating > 0) && (
                    <>
                      <span>·</span>
                      <span className="text-amber-400">★ {m.averageRating}</span>
                    </>
                  )}
                  {m.fileSize ? (
                    <>
                      <span>·</span>
                      <span>{formatBytes(m.fileSize)}</span>
                    </>
                  ) : null}
                  <span>·</span>
                  <span className={m.isInstalled ? 'text-emerald-400' : 'text-amber-400'}>
                    {m.isInstalled ? 'Installed' : 'Missing'}
                  </span>
                </div>

                {m.llmDescription ? (
                  <p className="text-[11px] text-zinc-400 line-clamp-2 leading-relaxed">
                    {m.llmDescription}
                  </p>
                ) : (
                  <p className="text-[11px] text-zinc-600 italic">
                    Click card to add details &amp; strengths
                  </p>
                )}
              </div>
            </div>

            {/* Inline @Nickname & Hide/Unhide Footer */}
            <div
              className="px-3.5 pb-3 pt-1 flex items-center justify-between gap-2"
              onClick={(e) => e.stopPropagation()}
            >
              {isBase ? (
                <div className="relative flex-1 min-w-0">
                  <span className="absolute left-2 top-1/2 -translate-y-1/2 text-zinc-500 font-mono text-[11px]">
                    @
                  </span>
                  <input
                    key={`${m.id}-grid-nick-${m.nickname || ''}`}
                    type="text"
                    defaultValue={m.nickname || ''}
                    placeholder="nickname"
                    onBlur={(e) => {
                      const clean = e.target.value.trim().replace(/^@+/, '').toLowerCase();
                      if (clean !== (m.nickname || '').toLowerCase()) {
                        onUpdateModelConfig(m.id, { nickname: clean });
                      }
                    }}
                    className="w-full pl-5 pr-2 py-1 bg-zinc-950/80 border border-zinc-800 focus:border-emerald-500 rounded text-xs font-mono text-zinc-200 placeholder-zinc-700 focus:outline-none"
                  />
                </div>
              ) : (
                <span className="text-[11px] text-zinc-500 truncate">
                  {m.userNotes ? m.userNotes : formatModelTypeLabel(m.modelType)}
                </span>
              )}

              <button
                type="button"
                onClick={() => onToggleVisibility(m.id, !Boolean(m.isHidden))}
                title={m.isHidden ? `Unhide ${m.name}` : `Hide ${m.name}`}
                className={`inline-flex items-center gap-1 px-2 py-1 text-[11px] font-medium rounded border cursor-pointer transition-colors whitespace-nowrap shrink-0 ${
                  m.isHidden
                    ? 'bg-amber-500/15 border-amber-500/50 text-amber-200 hover:bg-amber-500/25'
                    : 'bg-zinc-950/80 border-zinc-800 text-zinc-400 hover:text-zinc-100 hover:border-zinc-700'
                }`}
              >
                {m.isHidden ? <Eye className="w-3 h-3" /> : <EyeOff className="w-3 h-3" />}
                <span>{m.isHidden ? 'Unhide' : 'Hide'}</span>
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
};
