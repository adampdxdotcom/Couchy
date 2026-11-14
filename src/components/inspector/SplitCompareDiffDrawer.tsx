import React from 'react';
import {
  ChevronDown,
  ChevronUp,
  Heart,
  RotateCcw,
  Star,
  Trash2,
} from 'lucide-react';
import type { ImageRecord } from '../../shared/types.ts';
import { SeriesIterationsStrip } from './SeriesIterationsStrip.tsx';
import { computeImageMetadataDiff } from './splitCompareUtils.ts';

interface SplitCompareDiffDrawerProps {
  imageA: ImageRecord;
  imageB: ImageRecord | null;
  isOpen: boolean;
  onToggleOpen: () => void;
  onRateImage: (imageId: number, nextRating: number) => Promise<void>;
  onToggleFavorite: (imageId: number, nextFavorite: boolean) => Promise<void>;
  onToggleReject: (imageId: number, nextRejected: boolean) => Promise<void>;
  onReusePrompt?: (img: ImageRecord) => void;
  onSelectStepA: (imageId: number) => void;
  onSelectStepB: (imageId: number) => void;
  onOpenPickerForB: () => void;
}

interface SlotActionHeaderProps {
  slotLabel: 'A' | 'B';
  image: ImageRecord;
  onRate: (nextRating: number) => void;
  onToggleFavorite: () => void;
  onToggleReject: () => void;
  onReusePrompt?: () => void;
}

const SlotActionHeader: React.FC<SlotActionHeaderProps> = ({
  slotLabel,
  image,
  onRate,
  onToggleFavorite,
  onToggleReject,
  onReusePrompt,
}) => {
  const mp =
    image.width > 0 && image.height > 0
      ? ((image.width * image.height) / 1_000_000).toFixed(1)
      : null;

  return (
    <div className="flex flex-wrap items-center justify-between gap-2 pb-2 border-b border-zinc-800/80">
      <div className="min-w-0">
        <div className="flex items-center gap-2 text-xs">
          <span
            className={`font-mono font-semibold ${
              slotLabel === 'A' ? 'text-indigo-300' : 'text-amber-300'
            }`}
          >
            Image {slotLabel}
          </span>
          <span className="font-medium text-zinc-100 truncate max-w-[180px] sm:max-w-[240px]">
            {image.filename}
          </span>
        </div>
        <div className="text-[11px] font-mono tabular-nums text-zinc-400">
          {image.width}×{image.height}
          {mp ? ` · ${mp} MP` : ''}
          {image.checkpointName ? ` · ${image.checkpointName}` : ''}
        </div>
      </div>

      {/* Quick Cull & Reuse Actions */}
      <div className="flex items-center gap-1.5 shrink-0">
        <div className="flex items-center gap-0.5 mr-1">
          {[1, 2, 3, 4, 5].map((star) => (
            <button
              key={star}
              type="button"
              onClick={() => onRate(image.rating === star ? 0 : star)}
              className="p-0.5 cursor-pointer"
              title={`Rate Image ${slotLabel} ${star} star${star === 1 ? '' : 's'}`}
            >
              <Star
                className={`w-3.5 h-3.5 ${
                  star <= image.rating
                    ? 'fill-amber-400 text-amber-400'
                    : 'text-zinc-600 hover:text-amber-300'
                }`}
              />
            </button>
          ))}
        </div>

        <button
          type="button"
          onClick={onToggleFavorite}
          className={`p-1.5 rounded-lg border transition-colors cursor-pointer ${
            image.isFavorite
              ? 'bg-rose-500/15 border-rose-500/40 text-rose-400'
              : 'bg-zinc-950 border-zinc-800 text-zinc-400 hover:text-rose-300'
          }`}
          title={image.isFavorite ? 'Remove Favorite' : 'Heart / Set Poster'}
        >
          <Heart className={`w-3.5 h-3.5 ${image.isFavorite ? 'fill-rose-400' : ''}`} />
        </button>

        {onReusePrompt && (
          <button
            type="button"
            onClick={onReusePrompt}
            className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-zinc-950 border border-zinc-800 text-zinc-300 hover:text-white hover:border-zinc-700 text-[11px] font-medium cursor-pointer transition-colors"
            title={`Reuse Image ${slotLabel} prompt & settings in Quick Gen`}
          >
            <RotateCcw className="w-3 h-3" />
            <span>Reuse</span>
          </button>
        )}

        <button
          type="button"
          onClick={onToggleReject}
          className={`p-1.5 rounded-lg border transition-colors cursor-pointer ${
            image.isRejected
              ? 'bg-rose-500/20 border-rose-500/50 text-rose-400'
              : 'bg-zinc-950 border-zinc-800 text-zinc-400 hover:text-rose-300'
          }`}
          title={image.isRejected ? 'Restore from Rejected' : 'Reject (Hide from Library)'}
        >
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
};

/**
 * Collapsible bottom drawer inside Split Mode showing side-by-side metadata differences
 * (prompts, LoRAs, seeds, resolution), individual series step strips, and immediate culling controls.
 * Defaults to collapsed so the comparison images retain maximum viewport space.
 */
export const SplitCompareDiffDrawer: React.FC<SplitCompareDiffDrawerProps> = ({
  imageA,
  imageB,
  isOpen,
  onToggleOpen,
  onRateImage,
  onToggleFavorite,
  onToggleReject,
  onReusePrompt,
  onSelectStepA,
  onSelectStepB,
  onOpenPickerForB,
}) => {
  const diff = imageB ? computeImageMetadataDiff(imageA, imageB) : null;

  return (
    <div className="bg-zinc-950/95 border-t border-zinc-800 backdrop-blur-md shrink-0 z-20">
      {/* Collapsed / Toggle Header Bar */}
      <div className="px-4 py-2 flex items-center justify-between gap-3 text-xs">
        <button
          type="button"
          onClick={onToggleOpen}
          className="inline-flex items-center gap-2 text-zinc-200 hover:text-white font-medium cursor-pointer min-w-0"
        >
          {isOpen ? (
            <ChevronDown className="w-4 h-4 text-zinc-400 shrink-0" />
          ) : (
            <ChevronUp className="w-4 h-4 text-indigo-400 shrink-0" />
          )}
          <span className="whitespace-nowrap">Metadata Diff &amp; Actions</span>
          <span aria-hidden="true" className="text-zinc-600">·</span>
          {!imageB ? (
            <span className="text-zinc-400 truncate">Select Image B to compare differences</span>
          ) : diff?.hasAnyDiff ? (
            <span className="text-amber-300/90 font-mono text-[11px] truncate">
              Differs: {diff.diffCategories.join(' · ')}
            </span>
          ) : (
            <span className="text-emerald-400/90 text-[11px] truncate">
              Identical prompts, LoRAs &amp; generation parameters
            </span>
          )}
        </button>

        <div className="hidden md:flex items-center gap-3 text-[11px] font-mono tabular-nums text-zinc-400 shrink-0">
          <span>
            A: {imageA.width}×{imageA.height}
            {imageA.rating > 0 ? ` · ★${imageA.rating}` : ''}
          </span>
          {imageB && (
            <>
              <span aria-hidden="true" className="text-zinc-700">|</span>
              <span>
                B: {imageB.width}×{imageB.height}
                {imageB.rating > 0 ? ` · ★${imageB.rating}` : ''}
              </span>
            </>
          )}
        </div>
      </div>

      {/* Expandable Diff & Series Curation Body */}
      {isOpen && (
        <div className="border-t border-zinc-800/80 max-h-[34vh] overflow-y-auto px-4 py-3 space-y-4 text-xs">
          {/* Side-by-Side Quick Actions + Per-Stack Series Strips */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="space-y-2.5 bg-zinc-900/60 border border-zinc-800/80 rounded-xl p-3">
              <SlotActionHeader
                slotLabel="A"
                image={imageA}
                onRate={(r) => onRateImage(imageA.id, r)}
                onToggleFavorite={() => onToggleFavorite(imageA.id, !imageA.isFavorite)}
                onToggleReject={() => onToggleReject(imageA.id, !imageA.isRejected)}
                onReusePrompt={onReusePrompt ? () => onReusePrompt(imageA) : undefined}
              />
              {(imageA.seriesItems?.length || 0) > 1 && (
                <SeriesIterationsStrip
                  items={imageA.seriesItems || []}
                  activeImageId={imageA.id}
                  activeImage={imageA}
                  onSelectIteration={onSelectStepA}
                  disableGalleryModal
                />
              )}
            </div>

            {imageB ? (
              <div className="space-y-2.5 bg-zinc-900/60 border border-zinc-800/80 rounded-xl p-3">
                <SlotActionHeader
                  slotLabel="B"
                  image={imageB}
                  onRate={(r) => onRateImage(imageB.id, r)}
                  onToggleFavorite={() => onToggleFavorite(imageB.id, !imageB.isFavorite)}
                  onToggleReject={() => onToggleReject(imageB.id, !imageB.isRejected)}
                  onReusePrompt={onReusePrompt ? () => onReusePrompt(imageB) : undefined}
                />
                {(imageB.seriesItems?.length || 0) > 1 && (
                  <SeriesIterationsStrip
                    items={imageB.seriesItems || []}
                    activeImageId={imageB.id}
                    activeImage={imageB}
                    onSelectIteration={onSelectStepB}
                    disableGalleryModal
                  />
                )}
              </div>
            ) : (
              <div className="bg-zinc-900/40 border border-dashed border-zinc-800 rounded-xl p-4 flex items-center justify-between gap-3">
                <span className="text-zinc-400">No Image B loaded yet.</span>
                <button
                  type="button"
                  onClick={onOpenPickerForB}
                  className="px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white font-medium cursor-pointer"
                >
                  Choose Image B...
                </button>
              </div>
            )}
          </div>

          {/* Diff-Only Metadata Sections */}
          {imageB && diff && (
            <div className="space-y-3">
              {!diff.hasAnyDiff ? (
                <div className="px-3 py-2.5 rounded-lg bg-zinc-900/50 border border-zinc-800/80 text-zinc-400">
                  No prompt, LoRA, resolution, or parameter differences detected between Image A and Image B.
                </div>
              ) : (
                <>
                  {/* Parameter Differences */}
                  {diff.paramDiffs.length > 0 && (
                    <div className="space-y-1.5">
                      <h5 className="text-[11px] font-display font-semibold text-zinc-300 uppercase tracking-wider">
                        Parameter Differences
                      </h5>
                      <div className="overflow-x-auto rounded-lg border border-zinc-800/80">
                        <table className="w-full text-left font-mono tabular-nums text-[11px]">
                          <thead className="bg-zinc-900 text-zinc-400 border-b border-zinc-800">
                            <tr>
                              <th className="py-1.5 px-3 font-sans font-medium">Field</th>
                              <th className="py-1.5 px-3 text-indigo-300">Image A</th>
                              <th className="py-1.5 px-3 text-amber-300">Image B</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-zinc-800/60 bg-zinc-950">
                            {diff.paramDiffs.map((row) => (
                              <tr key={row.label}>
                                <td className="py-1.5 px-3 font-sans text-zinc-400">{row.label}</td>
                                <td className="py-1.5 px-3 text-zinc-200">{row.valueA}</td>
                                <td className="py-1.5 px-3 text-zinc-200">{row.valueB}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}

                  {/* LoRA Differences */}
                  {diff.loraDiffs.length > 0 && (
                    <div className="space-y-1.5">
                      <h5 className="text-[11px] font-display font-semibold text-zinc-300 uppercase tracking-wider">
                        LoRA Differences
                      </h5>
                      <div className="space-y-1.5">
                        {diff.loraDiffs.map((ld) => (
                          <div
                            key={ld.key}
                            className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 rounded-lg bg-zinc-900/60 border border-zinc-800/80 font-mono text-[11px]"
                          >
                            <span className="text-zinc-100 truncate">{ld.displayName}</span>
                            <div className="flex items-center gap-3 tabular-nums shrink-0">
                              {ld.status === 'removed' && ld.loraA && (
                                <span className="text-rose-300">
                                  Only in A (M:{ld.loraA.modelStrength} · C:{ld.loraA.clipStrength})
                                </span>
                              )}
                              {ld.status === 'added' && ld.loraB && (
                                <span className="text-emerald-300">
                                  Only in B (M:{ld.loraB.modelStrength} · C:{ld.loraB.clipStrength})
                                </span>
                              )}
                              {ld.status === 'changed' && ld.loraA && ld.loraB && (
                                <span className="text-amber-300">
                                  A: {ld.loraA.modelStrength}/{ld.loraA.clipStrength} → B:{' '}
                                  {ld.loraB.modelStrength}/{ld.loraB.clipStrength}
                                </span>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Positive Prompt Diff */}
                  {diff.promptDiffsDiffer && (
                    <div className="space-y-1.5">
                      <h5 className="text-[11px] font-display font-semibold text-zinc-300 uppercase tracking-wider">
                        Positive Prompt Diff
                      </h5>
                      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                        <div className="p-2.5 rounded-lg bg-zinc-900/60 border border-zinc-800/80 leading-relaxed whitespace-pre-wrap break-words text-zinc-300">
                          {diff.promptTokensA.length === 0 ? (
                            <span className="text-zinc-500 italic">Empty prompt</span>
                          ) : (
                            diff.promptTokensA.map((tok, i) => (
                              <span
                                key={i}
                                className={
                                  tok.type === 'removed'
                                    ? 'bg-rose-500/20 text-rose-200 rounded px-0.5'
                                    : undefined
                                }
                              >
                                {i > 0 ? ' ' : ''}
                                {tok.text}
                              </span>
                            ))
                          )}
                        </div>
                        <div className="p-2.5 rounded-lg bg-zinc-900/60 border border-zinc-800/80 leading-relaxed whitespace-pre-wrap break-words text-zinc-300">
                          {diff.promptTokensB.length === 0 ? (
                            <span className="text-zinc-500 italic">Empty prompt</span>
                          ) : (
                            diff.promptTokensB.map((tok, i) => (
                              <span
                                key={i}
                                className={
                                  tok.type === 'added'
                                    ? 'bg-emerald-500/20 text-emerald-200 rounded px-0.5'
                                    : undefined
                                }
                              >
                                {i > 0 ? ' ' : ''}
                                {tok.text}
                              </span>
                            ))
                          )}
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Negative Prompt Diff */}
                  {diff.negativeDiffers && (
                    <div className="space-y-1.5">
                      <h5 className="text-[11px] font-display font-semibold text-zinc-300 uppercase tracking-wider">
                        Negative Prompt Diff
                      </h5>
                      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                        <div className="p-2.5 rounded-lg bg-zinc-900/60 border border-zinc-800/80 text-rose-200/90 whitespace-pre-wrap break-words">
                          {diff.negativeA || <span className="text-zinc-500 italic">None</span>}
                        </div>
                        <div className="p-2.5 rounded-lg bg-zinc-900/60 border border-zinc-800/80 text-emerald-200/90 whitespace-pre-wrap break-words">
                          {diff.negativeB || <span className="text-zinc-500 italic">None</span>}
                        </div>
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
