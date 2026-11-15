import React from 'react';
import { Cpu, ExternalLink, Eye, EyeOff } from 'lucide-react';
import { formatBytes, getModelAvailabilityInfo } from '../../shared/utils.ts';
import {
  formatModelTypeLabel,
  isBaseModelType,
  type BaseModelExplorerListProps,
} from './BaseModelExplorerGrid.tsx';

/**
 * Tabular Base Models view with inline @mention toggles, @nickname editing,
 * Details & Strengths preview, and Hide/Unhide controls.
 */
export const BaseModelExplorerTable: React.FC<BaseModelExplorerListProps> = ({
  models,
  brokenThumbs,
  highlightedFilename,
  onMarkBrokenThumb,
  onSelectModel,
  onUpdateModelConfig,
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
            <th className="py-3 px-4 font-medium">Model Name &amp; File</th>
            <th className="py-3 px-3 font-medium">Group / Arch</th>
            <th className="py-3 px-3 font-medium">Nickname</th>
            <th className="py-3 px-3 font-medium">Details &amp; Strengths</th>
            <th className="py-3 px-3 font-medium text-right">Size</th>
            <th className="py-3 px-3 font-medium text-right">Used In</th>
            <th className="py-3 px-3 font-medium text-right">Status</th>
            <th className="py-3 px-4 font-medium text-right">Visibility</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-zinc-800/70">
          {models.map((m) => {
            const coverUrl = m.previewImages?.[0]?.url || null;
            const hasThumb = Boolean(coverUrl && !brokenThumbs[coverUrl]);
            const isBase = isBaseModelType(m.modelType);
            const isHighlighted =
              Boolean(highlightedFilename) &&
              m.filename.toLowerCase() === highlightedFilename!.toLowerCase();

            return (
              <tr
                key={m.id}
                className={`hover:bg-zinc-800/40 transition-colors group ${
                  isHighlighted ? 'bg-emerald-500/10' : ''
                } ${m.isHidden ? 'opacity-75' : ''}`}
              >
                <td className="py-3 px-3 text-center" onClick={(e) => e.stopPropagation()}>
                  {isBase ? (
                    <input
                      type="checkbox"
                      disabled={!m.isInstalled}
                      checked={Boolean(m.mentionEnabled)}
                      onClick={(e) => e.stopPropagation()}
                      onChange={(e) =>
                        onUpdateModelConfig(m.id, {
                          mentionEnabled: e.target.checked,
                        })
                      }
                      aria-label={`Include ${m.name} in @mention menu`}
                      className={`w-4 h-4 rounded border-zinc-700 bg-zinc-950 text-emerald-500 focus:ring-emerald-500 disabled:opacity-40 ${
                        m.isInstalled ? 'cursor-pointer' : 'cursor-not-allowed'
                      }`}
                      title={
                        !m.isInstalled
                          ? 'Unavailable for @mention until present in ComfyUI models folder'
                          : m.mentionEnabled
                          ? 'Enabled in Quick Gen @mention'
                          : 'Click to enable in Quick Gen @mention'
                      }
                    />
                  ) : (
                    <span className="text-zinc-600">—</span>
                  )}
                </td>

                <td className="py-3 px-4 cursor-pointer" onClick={() => onSelectModel(m.id)}>
                  <div className="flex items-center gap-3">
                    {hasThumb ? (
                      <div className="w-9 h-9 rounded overflow-hidden border border-zinc-800 shrink-0">
                        <img
                          src={coverUrl!}
                          alt={m.name}
                          className="w-full h-full object-cover"
                          onError={() => {
                            if (coverUrl) onMarkBrokenThumb(coverUrl);
                          }}
                        />
                      </div>
                    ) : (
                      <div className="w-9 h-9 rounded bg-zinc-950 border border-zinc-800 flex items-center justify-center text-zinc-600 shrink-0">
                        <Cpu className={`w-4 h-4 ${isBase ? 'text-emerald-500/60' : ''}`} />
                      </div>
                    )}
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="font-medium text-zinc-100 hover:text-emerald-300 transition-colors truncate">
                          {m.name}
                        </span>
                        {m.civitaiUrl && (
                          <a
                            href={m.civitaiUrl}
                            target="_blank"
                            rel="noreferrer"
                            onClick={(e) => e.stopPropagation()}
                            className="text-zinc-500 hover:text-indigo-300"
                            title={
                              m.civitaiUrl.includes('civitai.red')
                                ? 'Open on Civitai.red'
                                : 'Open on Civitai.com'
                            }
                          >
                            <ExternalLink className="w-3 h-3" />
                          </a>
                        )}
                      </div>
                      <div className="text-[11px] font-mono text-zinc-500 truncate">{m.filename}</div>
                    </div>
                  </div>
                </td>

                <td
                  className="py-3 px-3 cursor-pointer"
                  onClick={() => onSelectModel(m.id)}
                >
                  <div className="text-zinc-200">{formatModelTypeLabel(m.modelType)}</div>
                  {m.baseModel && (
                    <div className="text-[11px] font-mono text-emerald-300">{m.baseModel}</div>
                  )}
                </td>

                <td className="py-3 px-3" onClick={(e) => e.stopPropagation()}>
                  {isBase ? (
                    <div className="relative max-w-[140px]">
                      <span className="absolute left-2 top-1/2 -translate-y-1/2 text-zinc-500 font-mono text-[11px]">
                        @
                      </span>
                      <input
                        key={`${m.id}-row-nick-${m.nickname || ''}`}
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
                    <span className="text-zinc-600">—</span>
                  )}
                </td>

                <td
                  className="py-3 px-3 max-w-[260px] cursor-pointer"
                  onClick={() => onSelectModel(m.id)}
                >
                  <div className="text-zinc-400 line-clamp-2">
                    {m.llmDescription || <span className="text-zinc-600 italic">—</span>}
                  </div>
                </td>

                <td
                  className="py-3 px-3 text-right font-mono tabular-nums text-zinc-400 cursor-pointer"
                  onClick={() => onSelectModel(m.id)}
                >
                  {formatBytes(m.fileSize)}
                </td>

                <td
                  className="py-3 px-3 text-right font-mono tabular-nums text-zinc-200 cursor-pointer"
                  onClick={() => onSelectModel(m.id)}
                >
                  {m.dependentImageCount} imgs · {m.dependentWorkflowCount} wfs
                </td>

                <td
                  className="py-3 px-3 text-right cursor-pointer"
                  onClick={() => onSelectModel(m.id)}
                >
                  {m.isHidden ? (
                    <span className="text-amber-400">Hidden</span>
                  ) : (
                    (() => {
                      const avail = getModelAvailabilityInfo(m);
                      return (
                        <span className={avail.colorClass} title={avail.tooltip}>
                          {avail.label}
                        </span>
                      );
                    })()
                  )}
                </td>

                <td className="py-3 px-4 text-right" onClick={(e) => e.stopPropagation()}>
                  <button
                    type="button"
                    onClick={() => onToggleVisibility(m.id, !Boolean(m.isHidden))}
                    className={`inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-medium rounded border cursor-pointer transition-colors whitespace-nowrap shrink-0 ${
                      m.isHidden
                        ? 'bg-amber-500/15 border-amber-500/50 text-amber-200 hover:bg-amber-500/25'
                        : 'bg-zinc-950 border-zinc-800 text-zinc-400 hover:text-zinc-100 hover:border-zinc-700'
                    }`}
                  >
                    {m.isHidden ? <Eye className="w-3 h-3" /> : <EyeOff className="w-3 h-3" />}
                    <span>{m.isHidden ? 'Unhide' : 'Hide'}</span>
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
