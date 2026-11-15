import React from 'react';
import { ExternalLink, Eye, EyeOff, Layers } from 'lucide-react';
import { getLoraCoverInfo, type LoraExplorerListProps } from './LoraExplorerGrid.tsx';
import { CharacterPortraitImage } from '../character/CharacterPortraitImage.tsx';

/**
 * Tabular LoRA Explorer view with inline @mention toggles, @nickname editing, and visibility controls.
 */
export const LoraExplorerTable: React.FC<LoraExplorerListProps> = ({
  loras,
  brokenThumbs,
  onMarkBrokenThumb,
  onSelectLora,
  onUpdateMentionConfig,
  onToggleVisibility,
}) => {
  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-x-auto">
      <table className="w-full text-left text-xs">
        <thead className="bg-zinc-950/90 border-b border-zinc-800 text-zinc-400">
          <tr>
            <th
              className="py-3 px-3 w-10 text-center font-medium"
              title="Include in Quick Gen @mention"
            >
              @
            </th>
            <th className="py-3 px-4 font-medium">LoRA Name &amp; File</th>
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
          {loras.map((l) => {
            const { url: coverUrl, crop: coverCrop } = getLoraCoverInfo(l);
            return (
              <tr
                key={l.filename}
                className={`hover:bg-zinc-800/40 transition-colors group ${
                  l.isHidden ? 'opacity-75' : ''
                }`}
              >
                <td className="py-3 px-3 text-center" onClick={(e) => e.stopPropagation()}>
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
                    className="w-4 h-4 rounded border-zinc-700 bg-zinc-950 text-indigo-600 focus:ring-indigo-500 cursor-pointer"
                    title={l.mentionEnabled ? 'Enabled in @mention' : 'Click to enable in @mention'}
                  />
                </td>

                <td className="py-3 px-4 cursor-pointer" onClick={() => onSelectLora(l.filename)}>
                  <div className="flex items-center gap-3">
                    {coverUrl && !brokenThumbs[coverUrl] ? (
                      <div className="w-9 h-9 rounded overflow-hidden border border-zinc-800 shrink-0">
                        <CharacterPortraitImage
                          src={coverUrl}
                          alt={l.name}
                          crop={coverCrop}
                          onError={() => {
                            if (coverUrl) onMarkBrokenThumb(coverUrl);
                          }}
                        />
                      </div>
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
                            title={
                              l.civitaiUrl.includes('civitai.red')
                                ? 'Open on Civitai.red'
                                : 'Open on Civitai.com'
                            }
                          >
                            <ExternalLink className="w-3 h-3" />
                          </a>
                        )}
                      </div>
                      <div className="text-[11px] font-mono text-zinc-500 truncate">{l.filename}</div>
                    </div>
                  </div>
                </td>

                <td
                  className="py-3 px-3 font-mono text-[11px] text-indigo-300 cursor-pointer"
                  onClick={() => onSelectLora(l.filename)}
                >
                  {l.baseModel || '—'}
                </td>

                <td className="py-3 px-3" onClick={(e) => e.stopPropagation()}>
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
                          onUpdateMentionConfig(l.filename, {
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
                  onClick={() => onSelectLora(l.filename)}
                >
                  {l.loraCategory}
                </td>

                <td
                  className="py-3 px-3 text-zinc-300 cursor-pointer"
                  onClick={() => onSelectLora(l.filename)}
                >
                  {l.characters.length > 0 ? l.characters.map((c) => c.name).join(' · ') : '—'}
                </td>

                <td
                  className="py-3 px-3 text-right font-mono tabular-nums text-zinc-200 cursor-pointer"
                  onClick={() => onSelectLora(l.filename)}
                >
                  {l.imageCount}
                </td>

                <td
                  className="py-3 px-3 text-right font-mono tabular-nums text-amber-400 cursor-pointer"
                  onClick={() => onSelectLora(l.filename)}
                >
                  {l.averageRating > 0 ? `★ ${l.averageRating}` : '—'}
                </td>

                <td
                  className="py-3 px-3 text-right font-mono tabular-nums text-zinc-300 cursor-pointer"
                  onClick={() => onSelectLora(l.filename)}
                >
                  {(l.defaultModelStrength ?? 1.0).toFixed(2)}x
                </td>

                <td
                  className="py-3 px-3 text-right cursor-pointer"
                  onClick={() => onSelectLora(l.filename)}
                >
                  {l.isHidden ? (
                    <span className="text-amber-400">Hidden</span>
                  ) : l.isInstalled ? (
                    <span className="text-emerald-400">Installed</span>
                  ) : (
                    <span className="text-amber-400">Missing</span>
                  )}
                </td>

                <td className="py-3 px-4 text-right" onClick={(e) => e.stopPropagation()}>
                  <button
                    type="button"
                    onClick={() => onToggleVisibility(l.filename, !Boolean(l.isHidden))}
                    className={`inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-medium rounded border cursor-pointer transition-colors whitespace-nowrap shrink-0 ${
                      l.isHidden
                        ? 'bg-amber-500/15 border-amber-500/50 text-amber-200 hover:bg-amber-500/25'
                        : 'bg-zinc-950 border-zinc-800 text-zinc-400 hover:text-zinc-100 hover:border-zinc-700'
                    }`}
                  >
                    {l.isHidden ? <Eye className="w-3 h-3" /> : <EyeOff className="w-3 h-3" />}
                    <span>{l.isHidden ? 'Unhide' : 'Hide'}</span>
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
};
