import React, { useState } from 'react';
import { Check, Cpu, Layers } from 'lucide-react';
import { formatBytes, getModelAvailabilityInfo } from '../../shared/utils.ts';
import type { LoraExplorerItem, ModelInventoryItem } from '../../shared/types.ts';
import { CharacterPortraitImage } from '../character/CharacterPortraitImage.tsx';
import { normalizeLoraKey } from '../quickgen/quickGenUtils.ts';
import { formatModelTypeLabel } from './BaseModelExplorerGrid.tsx';
import { getLoraCoverInfo } from './LoraExplorerGrid.tsx';

interface PresetSelectableGridProps {
  baseModels: ModelInventoryItem[];
  loras: LoraExplorerItem[];
  showModels: boolean;
  showLoras: boolean;
  isSelecting: boolean;
  selectedCheckpointName: string | null;
  selectedLoraStrengthMap: Map<string, number>;
  onToggleCheckpoint: (filename: string) => void;
  onToggleLora: (lora: LoraExplorerItem) => void;
}

/**
 * Simplified read-only card grid showing Base Models and LoRAs inside the Presets tab.
 * In Create/Edit mode, clicking anywhere on a card selects or deselects it for the active preset.
 */
export const PresetSelectableGrid: React.FC<PresetSelectableGridProps> = ({
  baseModels,
  loras,
  showModels,
  showLoras,
  isSelecting,
  selectedCheckpointName,
  selectedLoraStrengthMap,
  onToggleCheckpoint,
  onToggleLora,
}) => {
  const [brokenThumbs, setBrokenThumbs] = useState<Record<string, boolean>>({});
  const markBrokenThumb = (url: string) =>
    setBrokenThumbs((prev) => (prev[url] ? prev : { ...prev, [url]: true }));

  const selectedCkptKey = selectedCheckpointName ? normalizeLoraKey(selectedCheckpointName) : '';
  const modelsToRender = showModels ? baseModels : [];
  const lorasToRender = showLoras ? loras : [];

  if (modelsToRender.length === 0 && lorasToRender.length === 0) {
    return (
      <div className="py-12 text-center border border-dashed border-zinc-800 rounded-2xl text-sm text-zinc-500">
        No Base Models or LoRAs match the current filter.
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {modelsToRender.length > 0 && (
        <section className="space-y-2.5">
          <div className="flex items-center justify-between">
            <h4 className="text-xs font-semibold uppercase tracking-wider text-emerald-400 flex items-center gap-1.5">
              <Cpu className="w-3.5 h-3.5" />
              Base Models ({modelsToRender.length})
            </h4>
            {isSelecting && (
              <span className="text-[11px] text-zinc-500">
                Click any card to set Base Model (optional · replaces active selection)
              </span>
            )}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3.5">
            {modelsToRender.map((m) => {
              const coverUrl = m.previewImages?.[0]?.url || null;
              const hasThumb = Boolean(coverUrl && !brokenThumbs[coverUrl]);
              const isSelected = Boolean(
                selectedCkptKey && normalizeLoraKey(m.filename) === selectedCkptKey
              );
              const avail = getModelAvailabilityInfo(m);

              return (
                <div
                  key={`preset-model-${m.id}`}
                  role={isSelecting ? 'button' : undefined}
                  tabIndex={isSelecting ? 0 : undefined}
                  onClick={() => {
                    if (isSelecting) onToggleCheckpoint(m.filename);
                  }}
                  onKeyDown={(e) => {
                    if (isSelecting && (e.key === 'Enter' || e.key === ' ')) {
                      e.preventDefault();
                      onToggleCheckpoint(m.filename);
                    }
                  }}
                  className={`rounded-xl border overflow-hidden flex flex-col transition-all ${
                    isSelected
                      ? 'bg-emerald-950/35 border-emerald-400 ring-1 ring-emerald-400/50'
                      : isSelecting
                      ? 'bg-zinc-900 border-zinc-800 hover:border-emerald-500/60 cursor-pointer'
                      : 'bg-zinc-900 border-zinc-800'
                  }`}
                >
                  <div className="relative aspect-[4/3] bg-zinc-950 border-b border-zinc-800 overflow-hidden">
                    {hasThumb ? (
                      <img
                        src={coverUrl!}
                        alt={m.name}
                        loading="lazy"
                        onError={() => coverUrl && markBrokenThumb(coverUrl)}
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <div className="w-full h-full flex flex-col items-center justify-center gap-1.5 text-zinc-600 bg-gradient-to-br from-zinc-950 via-zinc-900/90 to-zinc-950">
                        <Cpu className="w-6 h-6 text-emerald-500/50" />
                        <span className="text-[11px] font-mono text-zinc-500 px-3 text-center truncate max-w-full">
                          {m.name}
                        </span>
                      </div>
                    )}

                    <div className="absolute top-2 left-2">
                      <span className="px-1.5 py-0.5 text-[10px] font-mono rounded bg-zinc-950/85 border border-emerald-500/40 text-emerald-300">
                        Base Model
                      </span>
                    </div>

                    <div className="absolute top-2 right-2 flex items-center gap-1.5">
                      {m.baseModel && (
                        <span className="px-1.5 py-0.5 text-[10px] font-mono bg-zinc-950/85 border border-zinc-700/80 text-zinc-300 rounded">
                          {m.baseModel}
                        </span>
                      )}
                      {isSelected && (
                        <span className="w-5 h-5 rounded-full bg-emerald-500 text-zinc-950 flex items-center justify-center shadow">
                          <Check className="w-3.5 h-3.5 stroke-[2.5]" />
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="p-3 space-y-1.5">
                    <div className="font-medium text-sm text-zinc-100 truncate">{m.name}</div>
                    <div className="text-[11px] font-mono text-zinc-500 truncate">{m.filename}</div>
                    <div className="text-[11px] text-zinc-400 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 font-mono tabular-nums">
                      <span className="font-sans text-zinc-300">
                        {formatModelTypeLabel(m.modelType)}
                      </span>
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
                      <span className={avail.colorClass}>{avail.label}</span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {lorasToRender.length > 0 && (
        <section className="space-y-2.5">
          <div className="flex items-center justify-between">
            <h4 className="text-xs font-semibold uppercase tracking-wider text-indigo-400 flex items-center gap-1.5">
              <Layers className="w-3.5 h-3.5" />
              LoRAs ({lorasToRender.length})
            </h4>
            {isSelecting && (
              <span className="text-[11px] text-zinc-500">
                Click anywhere on a LoRA card to add or remove it from the preset
              </span>
            )}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3.5">
            {lorasToRender.map((l) => {
              const { url: coverUrl, crop: coverCrop } = getLoraCoverInfo(l);
              const hasThumb = Boolean(coverUrl && !brokenThumbs[coverUrl]);
              const loraKey = normalizeLoraKey(l.filename);
              const selectedStrength = selectedLoraStrengthMap.get(loraKey);
              const isSelected = selectedStrength !== undefined;
              const avail = getModelAvailabilityInfo(l);

              return (
                <div
                  key={`preset-lora-${l.filename}`}
                  role={isSelecting ? 'button' : undefined}
                  tabIndex={isSelecting ? 0 : undefined}
                  onClick={() => {
                    if (isSelecting) onToggleLora(l);
                  }}
                  onKeyDown={(e) => {
                    if (isSelecting && (e.key === 'Enter' || e.key === ' ')) {
                      e.preventDefault();
                      onToggleLora(l);
                    }
                  }}
                  className={`rounded-xl border overflow-hidden flex flex-col transition-all ${
                    isSelected
                      ? 'bg-fuchsia-950/30 border-fuchsia-400 ring-1 ring-fuchsia-400/50'
                      : isSelecting
                      ? 'bg-zinc-900 border-zinc-800 hover:border-fuchsia-500/60 cursor-pointer'
                      : 'bg-zinc-900 border-zinc-800'
                  }`}
                >
                  <div className="relative aspect-[4/3] bg-zinc-950 border-b border-zinc-800 overflow-hidden">
                    {hasThumb ? (
                      <CharacterPortraitImage
                        src={coverUrl!}
                        alt={l.name}
                        crop={coverCrop}
                        loading="lazy"
                        onError={() => coverUrl && markBrokenThumb(coverUrl)}
                      />
                    ) : (
                      <div className="w-full h-full flex flex-col items-center justify-center gap-1.5 text-zinc-600 bg-gradient-to-br from-zinc-950 via-zinc-900/90 to-zinc-950">
                        <Layers className="w-6 h-6 text-zinc-700" />
                        <span className="text-[11px] font-mono text-zinc-600 px-3 text-center truncate max-w-full">
                          {l.name}
                        </span>
                      </div>
                    )}

                    <div className="absolute top-2 left-2">
                      <span className="px-1.5 py-0.5 text-[10px] font-mono rounded bg-zinc-950/85 border border-zinc-700/80 text-zinc-200 capitalize">
                        LoRA · {l.loraCategory}
                      </span>
                    </div>

                    <div className="absolute top-2 right-2 flex items-center gap-1.5">
                      {l.baseModel && (
                        <span className="px-1.5 py-0.5 text-[10px] font-mono bg-zinc-950/85 border border-zinc-700/80 text-indigo-300 rounded">
                          {l.baseModel}
                        </span>
                      )}
                      {selectedStrength !== undefined && (
                        <span className="px-1.5 py-0.5 text-[10px] font-mono rounded-full bg-fuchsia-500 text-white inline-flex items-center gap-1 shadow">
                          <Check className="w-3 h-3 stroke-[2.5]" />
                          {selectedStrength.toFixed(2)}x
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="p-3 space-y-1.5">
                    <div className="font-medium text-sm text-zinc-100 truncate">{l.name}</div>
                    <div className="text-[11px] font-mono text-zinc-500 truncate">{l.filename}</div>
                    <div className="text-[11px] text-zinc-400 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 font-mono tabular-nums">
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
                      <span className={avail.colorClass}>{avail.label}</span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
};
