import React from 'react';
import { ExternalLink, Eye, EyeOff, Layers } from 'lucide-react';
import type { LoraExplorerItem } from '../../shared/types.ts';

export interface LoraExplorerListProps {
  loras: LoraExplorerItem[];
  brokenThumbs: Record<string, boolean>;
  onMarkBrokenThumb: (url: string) => void;
  onSelectLora: (filename: string) => void;
  onUpdateMentionConfig: (
    loraName: string,
    payload: { mentionEnabled?: boolean; nickname?: string | null }
  ) => Promise<void>;
  onToggleVisibility: (loraName: string, nextHidden: boolean) => Promise<void>;
}

/**
 * Resolves the cover thumbnail URL for a LoRA, prioritizing linked character portraits
 * when classified as a character LoRA.
 */
export function getLoraCoverUrl(lora: LoraExplorerItem): string | null {
  if (lora.loraCategory === 'character') {
    const charPortrait = lora.characters.find((c) => c.portraitThumbnailUrl)?.portraitThumbnailUrl;
    if (charPortrait) return charPortrait;
  }
  return lora.previewImages?.[0]?.url || null;
}

/**
 * Responsive card grid layout for browsing LoRAs with quick @mention, nickname, and visibility controls.
 */
export const LoraExplorerGrid: React.FC<LoraExplorerListProps> = ({
  loras,
  brokenThumbs,
  onMarkBrokenThumb,
  onSelectLora,
  onUpdateMentionConfig,
  onToggleVisibility,
}) => {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
      {loras.map((l) => {
        const coverUrl = getLoraCoverUrl(l);
        const hasThumb = Boolean(coverUrl && !brokenThumbs[coverUrl]);

        return (
          <div
            key={l.filename}
            onClick={() => onSelectLora(l.filename)}
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
                    onError={() => {
                      if (coverUrl) onMarkBrokenThumb(coverUrl);
                    }}
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
                      onUpdateMentionConfig(l.filename, {
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
                      title={
                        l.civitaiUrl.includes('civitai.red')
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
                  <div className="font-medium text-sm text-zinc-100 group-hover:text-indigo-300 transition-colors truncate">
                    {l.name}
                  </div>
                  <div className="text-[11px] font-mono text-zinc-500 truncate">{l.filename}</div>
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
                      onUpdateMentionConfig(l.filename, { nickname: clean });
                    }
                  }}
                  className="w-full pl-5 pr-2 py-1 bg-zinc-950/80 border border-zinc-800 focus:border-indigo-500 rounded text-xs font-mono text-zinc-200 placeholder-zinc-700 focus:outline-none"
                />
              </div>
              <button
                type="button"
                onClick={() => onToggleVisibility(l.filename, !Boolean(l.isHidden))}
                title={l.isHidden ? `Unhide ${l.name} in Couchy` : `Hide ${l.name} from Couchy`}
                className={`inline-flex items-center gap-1 px-2 py-1 text-[11px] font-medium rounded border cursor-pointer transition-colors whitespace-nowrap shrink-0 ${
                  l.isHidden
                    ? 'bg-amber-500/15 border-amber-500/50 text-amber-200 hover:bg-amber-500/25'
                    : 'bg-zinc-950/80 border-zinc-800 text-zinc-400 hover:text-zinc-100 hover:border-zinc-700'
                }`}
              >
                {l.isHidden ? <Eye className="w-3 h-3" /> : <EyeOff className="w-3 h-3" />}
                <span>{l.isHidden ? 'Unhide' : 'Hide'}</span>
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
};
