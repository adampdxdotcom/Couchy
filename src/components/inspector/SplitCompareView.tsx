import React, { useRef, useState } from 'react';
import {
  ArrowLeftRight,
  Columns2,
  ImagePlus,
  RotateCcw,
  SlidersHorizontal,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import type { ImageRecord } from '../../shared/types.ts';
import { SplitCompareDiffDrawer } from './SplitCompareDiffDrawer.tsx';

export type SplitCompareMode = 'side_by_side' | 'overlay_wipe';
export type SplitFramingMode = 'fit' | 'native';

interface SplitCompareViewProps {
  imageA: ImageRecord;
  imageB: ImageRecord | null;
  onSwap: () => void;
  onOpenPickerForB: () => void;
  onExitSplit: () => void;
  onRateImage: (imageId: number, nextRating: number) => Promise<void>;
  onToggleFavorite: (imageId: number, nextFavorite: boolean) => Promise<void>;
  onToggleReject: (imageId: number, nextRejected: boolean) => Promise<void>;
  onReusePrompt?: (img: ImageRecord) => void;
  onSelectStepA: (imageId: number) => void;
  onSelectStepB: (imageId: number) => void;
}

/**
 * Full-width A/B Split-Screen Comparison stage supporting Side-by-Side and Overlay Wipe modes,
 * Normalized Fit vs 100% Native pixel framing, roughed-in Zoom/Pan controls, and a collapsed-by-default diff drawer.
 */
export const SplitCompareView: React.FC<SplitCompareViewProps> = ({
  imageA,
  imageB,
  onSwap,
  onOpenPickerForB,
  onExitSplit,
  onRateImage,
  onToggleFavorite,
  onToggleReject,
  onReusePrompt,
  onSelectStepA,
  onSelectStepB,
}) => {
  const [compareMode, setCompareMode] = useState<SplitCompareMode>('side_by_side');
  const [framingMode, setFramingMode] = useState<SplitFramingMode>('fit');
  const [wipePercent, setWipePercent] = useState<number>(50);
  const [isDraggingWipe, setIsDraggingWipe] = useState(false);
  const [isDiffDrawerOpen, setIsDiffDrawerOpen] = useState(false);

  const wipeContainerRef = useRef<HTMLDivElement | null>(null);

  const updateWipeFromClientX = (clientX: number) => {
    const el = wipeContainerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    if (rect.width <= 0) return;
    const pct = ((clientX - rect.left) / rect.width) * 100;
    setWipePercent(Math.max(2, Math.min(98, pct)));
  };

  const handleWipePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    setIsDraggingWipe(true);
    updateWipeFromClientX(e.clientX);
  };

  const handleWipePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isDraggingWipe) return;
    updateWipeFromClientX(e.clientX);
  };

  const handleWipePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isDraggingWipe) return;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
    setIsDraggingWipe(false);
  };

  const nativeW = Math.max(imageA.width || 0, imageB?.width || 0, 1024);
  const nativeH = Math.max(imageA.height || 0, imageB?.height || 0, 1024);

  return (
    <div className="flex-1 flex flex-col min-h-0 w-full h-full bg-zinc-950 select-none overflow-hidden">
      {/* Top Split Toolbar */}
      <div className="px-3 sm:px-5 py-2.5 bg-zinc-900/95 border-b border-zinc-800 flex flex-wrap items-center justify-between gap-2.5 shrink-0 z-20">
        {/* Left: Comparison Mode & Framing Mode */}
        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex items-center p-0.5 bg-zinc-950 border border-zinc-800 rounded-lg text-xs">
            <button
              type="button"
              onClick={() => setCompareMode('side_by_side')}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md font-medium transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                compareMode === 'side_by_side'
                  ? 'bg-indigo-600 text-white shadow-sm'
                  : 'text-zinc-400 hover:text-zinc-100'
              }`}
            >
              <Columns2 className="w-3.5 h-3.5" />
              <span>Side-by-Side</span>
            </button>
            <button
              type="button"
              onClick={() => setCompareMode('overlay_wipe')}
              disabled={!imageB}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md font-medium transition-colors cursor-pointer disabled:opacity-40 whitespace-nowrap shrink-0 ${
                compareMode === 'overlay_wipe'
                  ? 'bg-indigo-600 text-white shadow-sm'
                  : 'text-zinc-400 hover:text-zinc-100'
              }`}
              title={
                imageB
                  ? 'Layer Image B over Image A with a draggable vertical divider'
                  : 'Select Image B first to use Overlay Wipe'
              }
            >
              <SlidersHorizontal className="w-3.5 h-3.5" />
              <span>Overlay Wipe</span>
            </button>
          </div>

          <div className="inline-flex items-center p-0.5 bg-zinc-950 border border-zinc-800 rounded-lg text-xs">
            <button
              type="button"
              onClick={() => setFramingMode('fit')}
              className={`px-2.5 py-1.5 rounded-md font-medium transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                framingMode === 'fit'
                  ? 'bg-zinc-800 text-zinc-100'
                  : 'text-zinc-400 hover:text-zinc-200'
              }`}
              title="Normalize both images to match visually within the same bounding frame"
            >
              Fit (Normalized)
            </button>
            <button
              type="button"
              onClick={() => setFramingMode('native')}
              className={`px-2.5 py-1.5 rounded-md font-medium transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                framingMode === 'native'
                  ? 'bg-zinc-800 text-zinc-100'
                  : 'text-zinc-400 hover:text-zinc-200'
              }`}
              title="Display images at 100% native pixel dimensions to inspect fine upscale detail"
            >
              100% Native
            </button>
          </div>

          {/* Roughed-in Pan/Zoom Toolbar (Phase 2 placeholder, non-interactive until synced pan/zoom is added) */}
          <div
            className="hidden xl:inline-flex items-center gap-0.5 px-1.5 py-0.5 bg-zinc-950/70 border border-zinc-800/80 rounded-lg text-[11px] text-zinc-500 opacity-60"
            title="Synced Pan & Zoom controls (coming in next iteration)"
          >
            <button
              type="button"
              disabled
              className="p-1 cursor-not-allowed"
              aria-label="Zoom out (coming soon)"
            >
              <ZoomOut className="w-3.5 h-3.5" />
            </button>
            <span className="px-1.5 font-mono tabular-nums">100%</span>
            <button
              type="button"
              disabled
              className="p-1 cursor-not-allowed"
              aria-label="Zoom in (coming soon)"
            >
              <ZoomIn className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              disabled
              className="p-1 cursor-not-allowed"
              aria-label="Reset zoom (coming soon)"
            >
              <RotateCcw className="w-3 h-3" />
            </button>
          </div>
        </div>

        {/* Right: Compare With, Swap, Exit Split */}
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onOpenPickerForB}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-zinc-950 hover:bg-zinc-800 border border-zinc-700/80 text-zinc-200 text-xs font-medium transition-colors cursor-pointer whitespace-nowrap shrink-0"
          >
            <ImagePlus className="w-3.5 h-3.5 text-indigo-400" />
            <span>Compare with...</span>
          </button>

          <button
            type="button"
            onClick={onSwap}
            disabled={!imageB}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-zinc-950 hover:bg-zinc-800 border border-zinc-800 disabled:opacity-40 text-zinc-200 text-xs font-medium transition-colors cursor-pointer whitespace-nowrap shrink-0"
            title="Swap left (A) and right (B) images"
          >
            <ArrowLeftRight className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Swap</span>
          </button>

          <button
            type="button"
            onClick={onExitSplit}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-zinc-950 hover:bg-zinc-800 border border-zinc-700/80 text-zinc-200 text-xs font-medium transition-colors cursor-pointer whitespace-nowrap shrink-0"
            title="Exit Split Mode (Esc)"
          >
            <X className="w-3.5 h-3.5" />
            <span>Exit Split</span>
          </button>
        </div>
      </div>

      {/* Main Comparison Canvas (100% width, zero overlays on the images themselves) */}
      <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
        {compareMode === 'side_by_side' ? (
          <div className="flex-1 min-h-0 grid grid-cols-1 md:grid-cols-2 divide-y md:divide-y-0 md:divide-x divide-zinc-800/80 overflow-hidden">
            {/* Slot A Pane */}
            <div className="min-w-0 min-h-0 flex flex-col overflow-hidden bg-zinc-950">
              <div className="px-3 py-1.5 border-b border-zinc-900 bg-zinc-950 flex items-center justify-between gap-2 text-[11px] shrink-0">
                <div className="flex items-center gap-1.5 min-w-0">
                  <span className="font-mono font-semibold text-indigo-300 shrink-0">A</span>
                  <span aria-hidden="true" className="text-zinc-700">·</span>
                  <span className="text-zinc-200 truncate">{imageA.filename}</span>
                </div>
                <span className="font-mono tabular-nums text-zinc-400 shrink-0">
                  {imageA.width}×{imageA.height}
                </span>
              </div>

              <div
                className={`flex-1 min-h-0 p-2 sm:p-3 flex ${
                  framingMode === 'native'
                    ? 'overflow-auto items-start justify-start'
                    : 'overflow-hidden items-center justify-center'
                }`}
              >
                <img
                  src={imageA.originalUrl}
                  alt={imageA.filename}
                  referrerPolicy="no-referrer"
                  draggable={false}
                  className={
                    framingMode === 'native'
                      ? 'max-w-none block m-auto'
                      : 'w-full h-full object-contain'
                  }
                />
              </div>
            </div>

            {/* Slot B Pane */}
            <div className="min-w-0 min-h-0 flex flex-col overflow-hidden bg-zinc-950">
              <div className="px-3 py-1.5 border-b border-zinc-900 bg-zinc-950 flex items-center justify-between gap-2 text-[11px] shrink-0">
                <div className="flex items-center gap-1.5 min-w-0">
                  <span className="font-mono font-semibold text-amber-300 shrink-0">B</span>
                  <span aria-hidden="true" className="text-zinc-700">·</span>
                  <span className="text-zinc-200 truncate">
                    {imageB ? imageB.filename : 'No image selected'}
                  </span>
                </div>
                {imageB && (
                  <span className="font-mono tabular-nums text-zinc-400 shrink-0">
                    {imageB.width}×{imageB.height}
                  </span>
                )}
              </div>

              {imageB ? (
                <div
                  className={`flex-1 min-h-0 p-2 sm:p-3 flex ${
                    framingMode === 'native'
                      ? 'overflow-auto items-start justify-start'
                      : 'overflow-hidden items-center justify-center'
                  }`}
                >
                  <img
                    src={imageB.originalUrl}
                    alt={imageB.filename}
                    referrerPolicy="no-referrer"
                    draggable={false}
                    className={
                      framingMode === 'native'
                        ? 'max-w-none block m-auto'
                        : 'w-full h-full object-contain'
                    }
                  />
                </div>
              ) : (
                <div className="flex-1 min-h-0 p-6 flex flex-col items-center justify-center text-center gap-3">
                  <p className="text-xs text-zinc-400 max-w-xs">
                    Pick any image or series iteration from your library to compare side-by-side or with an overlay wipe.
                  </p>
                  <button
                    type="button"
                    onClick={onOpenPickerForB}
                    className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-medium cursor-pointer transition-colors"
                  >
                    <ImagePlus className="w-4 h-4" />
                    <span>Choose Image B...</span>
                  </button>
                </div>
              )}
            </div>
          </div>
        ) : (
          /* Overlay Wipe Mode */
          <div className="flex-1 min-h-0 flex flex-col overflow-hidden bg-zinc-950">
            {/* Wipe Caption Strip (kept above image canvas so zero overlays cover image pixels) */}
            <div className="px-4 py-1.5 border-b border-zinc-900 bg-zinc-950 flex items-center justify-between gap-3 text-[11px] shrink-0">
              <div className="flex items-center gap-1.5 min-w-0">
                <span className="font-mono font-semibold text-indigo-300 shrink-0">Left (A)</span>
                <span aria-hidden="true" className="text-zinc-700">·</span>
                <span className="text-zinc-200 truncate max-w-[200px] sm:max-w-xs">
                  {imageA.filename}
                </span>
                <span className="font-mono tabular-nums text-zinc-500 hidden sm:inline shrink-0">
                  {imageA.width}×{imageA.height}
                </span>
              </div>

              <span className="font-mono tabular-nums text-zinc-400 shrink-0">
                Wipe {Math.round(wipePercent)}%
              </span>

              <div className="flex items-center gap-1.5 min-w-0 justify-end">
                <span className="font-mono tabular-nums text-zinc-500 hidden sm:inline shrink-0">
                  {imageB ? `${imageB.width}×${imageB.height}` : ''}
                </span>
                <span className="text-zinc-200 truncate max-w-[200px] sm:max-w-xs">
                  {imageB ? imageB.filename : '—'}
                </span>
                <span aria-hidden="true" className="text-zinc-700">·</span>
                <span className="font-mono font-semibold text-amber-300 shrink-0">Right (B)</span>
              </div>
            </div>

            {imageB ? (
              <div
                className={`flex-1 min-h-0 p-2 sm:p-4 flex ${
                  framingMode === 'native'
                    ? 'overflow-auto items-start justify-start'
                    : 'overflow-hidden items-center justify-center'
                }`}
              >
                <div
                  ref={wipeContainerRef}
                  onPointerDown={handleWipePointerDown}
                  onPointerMove={handleWipePointerMove}
                  onPointerUp={handleWipePointerUp}
                  onPointerCancel={handleWipePointerUp}
                  style={
                    framingMode === 'native'
                      ? { width: `${nativeW}px`, height: `${nativeH}px` }
                      : undefined
                  }
                  className={`relative touch-none cursor-ew-resize overflow-hidden bg-zinc-950 ${
                    framingMode === 'native' ? 'shrink-0 m-auto' : 'w-full h-full'
                  }`}
                >
                  {/* Image A clipped to left of divider */}
                  <img
                    src={imageA.originalUrl}
                    alt={imageA.filename}
                    referrerPolicy="no-referrer"
                    draggable={false}
                    style={{ clipPath: `inset(0 ${100 - wipePercent}% 0 0)` }}
                    className="absolute inset-0 w-full h-full object-contain pointer-events-none"
                  />

                  {/* Image B clipped to right of divider */}
                  <img
                    src={imageB.originalUrl}
                    alt={imageB.filename}
                    referrerPolicy="no-referrer"
                    draggable={false}
                    style={{ clipPath: `inset(0 0 0 ${wipePercent}%)` }}
                    className="absolute inset-0 w-full h-full object-contain pointer-events-none"
                  />

                  {/* Vertical Wipe Divider Line & Handle */}
                  <div
                    style={{ left: `${wipePercent}%` }}
                    className="absolute top-0 bottom-0 -translate-x-1/2 w-0.5 bg-white/90 shadow-[0_0_8px_rgba(0,0,0,0.85)] pointer-events-none"
                  >
                    <div className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-7 h-7 rounded-full bg-zinc-900/95 border border-white/80 shadow-xl flex items-center justify-center text-zinc-100">
                      <ArrowLeftRight className="w-3.5 h-3.5" />
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              <div className="flex-1 flex items-center justify-center">
                <button
                  type="button"
                  onClick={onOpenPickerForB}
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-medium cursor-pointer"
                >
                  <ImagePlus className="w-4 h-4" />
                  <span>Choose Image B...</span>
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Collapsible Bottom Metadata Diff & Quick-Cull Drawer (Starts Collapsed) */}
      <SplitCompareDiffDrawer
        imageA={imageA}
        imageB={imageB}
        isOpen={isDiffDrawerOpen}
        onToggleOpen={() => setIsDiffDrawerOpen((prev) => !prev)}
        onRateImage={onRateImage}
        onToggleFavorite={onToggleFavorite}
        onToggleReject={onToggleReject}
        onReusePrompt={onReusePrompt}
        onSelectStepA={onSelectStepA}
        onSelectStepB={onSelectStepB}
        onOpenPickerForB={onOpenPickerForB}
      />
    </div>
  );
};
