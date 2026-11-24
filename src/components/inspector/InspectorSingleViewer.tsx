import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  Columns2,
  Download,
  Loader2,
  Lock,
  Maximize2,
  Minimize2,
  Search,
  Unlock,
  X,
} from 'lucide-react';
import { formatBytes } from '../../shared/utils.ts';
import {
  clientPointToImageUV,
  SingleLoupeLens,
  type LoupeMagnification,
  type LoupeUV,
} from './LoupeOverlay.tsx';
import type { ImageRecord } from '../../shared/types.ts';

type ViewerFramingMode = 'fit' | 'native';

interface InspectorSingleViewerProps {
  activeImage: ImageRecord;
  outerImageId: number;
  isFullScreen: boolean;
  onSetFullScreen: (next: boolean | ((prev: boolean) => boolean)) => void;
  loupeEnabled: boolean;
  onSetLoupeEnabled: (next: boolean | ((prev: boolean) => boolean)) => void;
  onClose: () => void;
  onPrev?: () => void;
  onNext?: () => void;
  onEnterSplitMode?: () => void;
}

/**
 * Full-resolution single-image lightbox viewport with Fit/Native zoom toggle,
 * click-to-zoom & drag-to-pan, interactive Loupe magnifier, touch swipe navigation,
 * and persistent bottom metadata/control bar.
 */
export const InspectorSingleViewer: React.FC<InspectorSingleViewerProps> = ({
  activeImage,
  outerImageId,
  isFullScreen,
  onSetFullScreen,
  loupeEnabled,
  onSetLoupeEnabled,
  onClose,
  onPrev,
  onNext,
  onEnterSplitMode,
}) => {
  const [framingMode, setFramingMode] = useState<ViewerFramingMode>('fit');
  const [singleLoupeMag, setSingleLoupeMag] = useState<LoupeMagnification>('2x');
  const [singleLoupeUV, setSingleLoupeUV] = useState<LoupeUV | null>(null);
  const [singleLoupePinned, setSingleLoupePinned] = useState(false);
  const [isDraggingPan, setIsDraggingPan] = useState(false);
  const [loadedOriginalUrl, setLoadedOriginalUrl] = useState<string | null>(null);

  const singleViewerPaneRef = useRef<HTMLDivElement | null>(null);
  const scrollCanvasRef = useRef<HTMLDivElement | null>(null);
  const singleViewerImgRef = useRef<HTMLImageElement | null>(null);

  // Pending scroll anchor when zooming into Native via image click
  const pendingZoomAnchorRef = useRef<{
    u: number;
    v: number;
    viewportOffsetX: number;
    viewportOffsetY: number;
  } | null>(null);

  // Drag-to-pan tracking in Native mode
  const panDragRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    startScrollLeft: number;
    startScrollTop: number;
    moved: boolean;
  } | null>(null);
  const suppressNextImgClickRef = useRef(false);

  const touchGestureRef = useRef<{
    startX: number;
    startY: number;
    startTime: number;
    multiTouch: boolean;
  } | null>(null);

  // Reset Loupe pin and Fit framing when navigating to another image
  useEffect(() => {
    setSingleLoupePinned(false);
    setFramingMode('fit');
    pendingZoomAnchorRef.current = null;
  }, [outerImageId, activeImage.id]);

  // Seed centered Loupe UV whenever toggled on via hotkey (L) without prior pointer move
  useEffect(() => {
    if (loupeEnabled && !singleLoupeUV) {
      setSingleLoupeUV({ u: 0.5, v: 0.38 });
    }
    if (!loupeEnabled) {
      setSingleLoupePinned(false);
    }
  }, [loupeEnabled, singleLoupeUV]);

  const applyNativeScrollAlignment = () => {
    const scrollEl = scrollCanvasRef.current;
    const imgEl = singleViewerImgRef.current;
    if (!scrollEl || !imgEl) return;

    const anchor = pendingZoomAnchorRef.current;
    if (anchor) {
      pendingZoomAnchorRef.current = null;
      const targetLeft =
        imgEl.offsetLeft + anchor.u * imgEl.offsetWidth - anchor.viewportOffsetX;
      const targetTop =
        imgEl.offsetTop + anchor.v * imgEl.offsetHeight - anchor.viewportOffsetY;
      scrollEl.scrollLeft = Math.max(
        0,
        Math.min(scrollEl.scrollWidth - scrollEl.clientWidth, targetLeft)
      );
      scrollEl.scrollTop = Math.max(
        0,
        Math.min(scrollEl.scrollHeight - scrollEl.clientHeight, targetTop)
      );
      return;
    }

    // Default to centered scroll when switching via Native button or entering Full Screen
    scrollEl.scrollLeft = Math.max(0, (scrollEl.scrollWidth - scrollEl.clientWidth) / 2);
    scrollEl.scrollTop = Math.max(0, (scrollEl.scrollHeight - scrollEl.clientHeight) / 2);
  };

  // Detect already-cached full-resolution bitmaps before paint to avoid any thumbnail flash
  useLayoutEffect(() => {
    const imgEl = singleViewerImgRef.current;
    if (imgEl && imgEl.complete && imgEl.naturalWidth > 0) {
      setLoadedOriginalUrl(activeImage.originalUrl);
    }
  }, [activeImage.originalUrl]);

  useLayoutEffect(() => {
    if (framingMode !== 'native') return;
    applyNativeScrollAlignment();
  }, [framingMode, isFullScreen, activeImage.id]);

  const handleToggleZoomFromImageClick = (e: React.MouseEvent<HTMLImageElement>) => {
    if (loupeEnabled) return;
    if (suppressNextImgClickRef.current) {
      suppressNextImgClickRef.current = false;
      e.stopPropagation();
      return;
    }
    e.stopPropagation();

    if (framingMode === 'fit') {
      const scrollEl = scrollCanvasRef.current;
      const uv = clientPointToImageUV(
        e.clientX,
        e.clientY,
        singleViewerPaneRef.current,
        singleViewerImgRef.current,
        activeImage.width,
        activeImage.height
      );
      if (scrollEl && uv) {
        const rect = scrollEl.getBoundingClientRect();
        pendingZoomAnchorRef.current = {
          u: uv.u,
          v: uv.v,
          viewportOffsetX: e.clientX - rect.left,
          viewportOffsetY: e.clientY - rect.top,
        };
      }
      setFramingMode('native');
    } else {
      pendingZoomAnchorRef.current = null;
      setFramingMode('fit');
    }
  };

  const handleCanvasPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (loupeEnabled || framingMode !== 'native' || e.button !== 0) return;
    const scrollEl = scrollCanvasRef.current;
    if (!scrollEl) return;

    panDragRef.current = {
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      startScrollLeft: scrollEl.scrollLeft,
      startScrollTop: scrollEl.scrollTop,
      moved: false,
    };
  };

  const handleCanvasPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const drag = panDragRef.current;
    if (drag && drag.pointerId === e.pointerId) {
      const dx = e.clientX - drag.startX;
      const dy = e.clientY - drag.startY;
      if (!drag.moved && Math.hypot(dx, dy) > 5) {
        drag.moved = true;
        setIsDraggingPan(true);
        e.currentTarget.setPointerCapture(e.pointerId);
      }
      if (drag.moved && scrollCanvasRef.current) {
        scrollCanvasRef.current.scrollLeft = drag.startScrollLeft - dx;
        scrollCanvasRef.current.scrollTop = drag.startScrollTop - dy;
      }
      return;
    }

    if (!loupeEnabled || singleLoupePinned) return;
    const nextUV = clientPointToImageUV(
      e.clientX,
      e.clientY,
      singleViewerPaneRef.current,
      singleViewerImgRef.current,
      activeImage.width,
      activeImage.height
    );
    if (nextUV) setSingleLoupeUV(nextUV);
  };

  const handleCanvasPointerUpOrCancel = (e: React.PointerEvent<HTMLDivElement>) => {
    const drag = panDragRef.current;
    if (!drag || drag.pointerId !== e.pointerId) return;
    if (drag.moved) {
      suppressNextImgClickRef.current = true;
      window.setTimeout(() => {
        suppressNextImgClickRef.current = false;
      }, 60);
    }
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
    panDragRef.current = null;
    setIsDraggingPan(false);
  };

  return (
    <div
      ref={singleViewerPaneRef}
      onTouchStart={(e) => {
        if (loupeEnabled || framingMode === 'native') {
          touchGestureRef.current = null;
          return;
        }
        if (e.touches.length !== 1) {
          if (touchGestureRef.current) {
            touchGestureRef.current.multiTouch = true;
          }
          return;
        }
        const t = e.touches[0];
        touchGestureRef.current = {
          startX: t.clientX,
          startY: t.clientY,
          startTime: Date.now(),
          multiTouch: false,
        };
      }}
      onTouchMove={(e) => {
        if (e.touches.length > 1 && touchGestureRef.current) {
          touchGestureRef.current.multiTouch = true;
        }
      }}
      onTouchEnd={(e) => {
        const gesture = touchGestureRef.current;
        touchGestureRef.current = null;
        if (
          !gesture ||
          gesture.multiTouch ||
          loupeEnabled ||
          framingMode === 'native' ||
          e.changedTouches.length === 0
        ) {
          return;
        }
        const elapsed = Date.now() - gesture.startTime;
        if (elapsed > 700) return;

        const t = e.changedTouches[0];
        const dx = t.clientX - gesture.startX;
        const dy = t.clientY - gesture.startY;
        const absX = Math.abs(dx);
        const absY = Math.abs(dy);

        if (absX >= 60 && absX > absY * 1.35) {
          if (dx < 0 && onNext) onNext();
          else if (dx > 0 && onPrev) onPrev();
        } else if (dy >= 85 && dy > absX * 1.4) {
          if (isFullScreen) onSetFullScreen(false);
          else onClose();
        }
      }}
      onPointerMove={handleCanvasPointerMove}
      onPointerUp={handleCanvasPointerUpOrCancel}
      onPointerCancel={handleCanvasPointerUpOrCancel}
      onPointerLeave={() => {
        if (loupeEnabled && !singleLoupePinned) {
          setSingleLoupeUV(null);
        }
      }}
      onClick={(e) => {
        if (loupeEnabled) {
          const clickedUV = clientPointToImageUV(
            e.clientX,
            e.clientY,
            singleViewerPaneRef.current,
            singleViewerImgRef.current,
            activeImage.width,
            activeImage.height
          );
          if (clickedUV) {
            setSingleLoupeUV(clickedUV);
            setSingleLoupePinned((prev) => !prev);
          }
        }
      }}
      className={`relative bg-zinc-950 flex flex-col select-none overflow-hidden ${
        loupeEnabled ? 'cursor-crosshair' : ''
      } ${
        isFullScreen
          ? 'fixed inset-0 z-50 bg-black/95'
          : 'flex-1 min-h-0'
      }`}
    >
      {/* Mobile Close Button in Upper-Right over Image Preview */}
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onClose();
        }}
        className="lg:hidden absolute top-3 right-3 z-30 p-2 rounded-full bg-zinc-900/85 hover:bg-zinc-800 text-zinc-200 border border-zinc-700/60 shadow-lg backdrop-blur-xs cursor-pointer transition-colors"
        title="Close Inspector (Esc)"
        aria-label="Close Inspector"
      >
        <X className="w-4 h-4" />
      </button>

      {/* Previous Image Arrow */}
      {onPrev && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onPrev();
          }}
          className={`absolute left-3 sm:left-4 top-1/2 -translate-y-1/2 rounded-full bg-zinc-900/85 hover:bg-zinc-800 text-zinc-200 border border-zinc-700/60 cursor-pointer z-20 transition-colors shadow-lg ${
            isFullScreen ? 'p-3 sm:p-3.5' : 'p-2.5'
          }`}
          title="Previous Image (Left Arrow)"
        >
          <ChevronLeft className={isFullScreen ? 'w-6 h-6' : 'w-5 h-5'} />
        </button>
      )}

      {/* Scrollable/Centered Image Stage (separate from outer relative container so Loupe stays anchored) */}
      <div
        ref={scrollCanvasRef}
        onPointerDown={handleCanvasPointerDown}
        className={`relative flex-1 min-h-0 w-full flex p-3 sm:p-5 ${
          framingMode === 'native'
            ? `overflow-auto items-start justify-start ${
                loupeEnabled
                  ? 'cursor-crosshair'
                  : isDraggingPan
                  ? 'cursor-grabbing'
                  : 'cursor-grab'
              }`
            : 'overflow-hidden items-center justify-center'
        }`}
      >
        {/* Instant cached thumbnail fallback while full-resolution original streams from server */}
        {loadedOriginalUrl !== activeImage.originalUrl &&
          activeImage.thumbnailUrl &&
          activeImage.thumbnailUrl !== activeImage.originalUrl && (
            <img
              key={`thumb-${activeImage.thumbnailUrl}`}
              src={activeImage.thumbnailUrl}
              alt={activeImage.filename}
              referrerPolicy="no-referrer"
              draggable={false}
              className="w-full h-full max-w-full max-h-full object-contain rounded select-none pointer-events-none"
            />
          )}

        {loadedOriginalUrl !== activeImage.originalUrl && (
          <div className="pointer-events-none absolute top-4 right-14 lg:right-4 z-10 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-zinc-950/80 border border-zinc-700/70 text-[11px] font-mono text-zinc-300 backdrop-blur-sm">
            <Loader2 className="w-3 h-3 animate-spin text-indigo-400" />
            <span>Loading full-res…</span>
          </div>
        )}

        <img
          key={activeImage.originalUrl}
          ref={singleViewerImgRef}
          src={activeImage.originalUrl}
          alt={activeImage.filename}
          referrerPolicy="no-referrer"
          draggable={false}
          onLoad={() => {
            setLoadedOriginalUrl(activeImage.originalUrl);
            if (framingMode === 'native') {
              applyNativeScrollAlignment();
            }
          }}
          onError={() => {
            setLoadedOriginalUrl(activeImage.originalUrl);
          }}
          onClick={handleToggleZoomFromImageClick}
          className={`rounded transition-transform duration-150 ${
            loadedOriginalUrl !== activeImage.originalUrl
              ? 'absolute opacity-0 pointer-events-none max-w-full max-h-full object-contain'
              : framingMode === 'native'
              ? 'max-w-none block m-auto'
              : 'max-w-full max-h-full object-contain'
          } ${
            loupeEnabled
              ? 'cursor-crosshair'
              : framingMode === 'native'
              ? isDraggingPan
                ? 'cursor-grabbing'
                : 'cursor-zoom-out'
              : 'cursor-zoom-in active:scale-[0.99]'
          }`}
          title={
            loupeEnabled
              ? singleLoupePinned
                ? 'Click to unpin Loupe'
                : 'Click to pin Loupe at this spot'
              : framingMode === 'native'
              ? 'Drag to pan · Click to return to Fit'
              : 'Click to zoom to 100% Native size'
          }
        />
      </div>

      {/* Single-Image Loupe Lens */}
      {loupeEnabled && singleLoupeUV && (
        <SingleLoupeLens
          image={activeImage}
          uv={singleLoupeUV}
          magnification={singleLoupeMag}
          isPinned={singleLoupePinned}
          containerRef={singleViewerPaneRef}
          imgRef={singleViewerImgRef}
        />
      )}

      {/* Next Image Arrow */}
      {onNext && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onNext();
          }}
          className={`absolute right-3 sm:right-4 top-1/2 -translate-y-1/2 rounded-full bg-zinc-900/85 hover:bg-zinc-800 text-zinc-200 border border-zinc-700/60 cursor-pointer z-20 transition-colors shadow-lg ${
            isFullScreen ? 'p-3 sm:p-3.5' : 'p-2.5'
          }`}
          title="Next Image (Right Arrow)"
        >
          <ChevronRight className={isFullScreen ? 'w-6 h-6' : 'w-5 h-5'} />
        </button>
      )}

      {/* Persistent Bottom Metadata, Fit/Native, Loupe, Full Screen & Download Bar */}
      <div
        onClick={(e) => e.stopPropagation()}
        className="shrink-0 w-full h-11 bg-zinc-950/95 border-t border-zinc-800/80 px-2.5 sm:px-4 flex items-center justify-between gap-2 text-xs text-zinc-400 backdrop-blur-md z-30 shadow-lg select-none"
      >
        <div className="flex items-center gap-1.5 sm:gap-2 font-mono tabular-nums truncate min-w-0 text-xs">
          <span className="text-zinc-200 font-sans font-medium truncate max-w-[72px] sm:max-w-[180px] lg:max-w-xs">
            {activeImage.filename}
          </span>
          <span aria-hidden="true" className="text-zinc-600 hidden sm:inline">·</span>
          <span className="shrink-0 hidden sm:inline">
            {activeImage.width}×{activeImage.height}
          </span>
          <span aria-hidden="true" className="text-zinc-600 hidden md:inline">·</span>
          <span className="hidden md:inline shrink-0">{formatBytes(activeImage.fileSize)}</span>
          <span aria-hidden="true" className="text-zinc-600 hidden xl:inline">·</span>
          <span className="hidden xl:inline text-zinc-500 font-mono shrink-0">
            SHA256: {activeImage.contentHash.slice(0, 10)}…
          </span>
        </div>

        <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
          {/* Fit / 100% Native Framing Toggle */}
          <div className="inline-flex items-center p-0.5 bg-zinc-900 border border-zinc-800 rounded-lg text-xs">
            <button
              type="button"
              onClick={() => {
                pendingZoomAnchorRef.current = null;
                setFramingMode('fit');
              }}
              className={`px-2 py-1 rounded-md font-medium transition-colors cursor-pointer whitespace-nowrap ${
                framingMode === 'fit'
                  ? 'bg-zinc-800 text-zinc-100'
                  : 'text-zinc-400 hover:text-zinc-200'
              }`}
              title="Fit entire image within the viewer"
            >
              Fit
            </button>
            <button
              type="button"
              onClick={() => {
                pendingZoomAnchorRef.current = null;
                setFramingMode('native');
              }}
              className={`px-2 py-1 rounded-md font-medium transition-colors cursor-pointer whitespace-nowrap ${
                framingMode === 'native'
                  ? 'bg-zinc-800 text-zinc-100'
                  : 'text-zinc-400 hover:text-zinc-200'
              }`}
              title="Display image at 100% native pixel dimensions (drag to pan)"
            >
              Native
            </button>
          </div>

          {/* Inline Loupe Controls */}
          <div className="inline-flex items-center p-0.5 bg-zinc-900 border border-zinc-800 rounded-lg text-xs">
            <button
              type="button"
              onClick={() => {
                onSetLoupeEnabled((prev) => {
                  const next = !prev;
                  if (next && !singleLoupeUV) {
                    setSingleLoupeUV({ u: 0.5, v: 0.38 });
                  }
                  if (!next) {
                    setSingleLoupePinned(false);
                  }
                  return next;
                });
              }}
              className={`inline-flex items-center gap-1 px-2 py-1 rounded-md font-medium transition-colors cursor-pointer ${
                loupeEnabled
                  ? 'bg-indigo-600 text-white'
                  : 'text-zinc-400 hover:text-zinc-200'
              }`}
              title="Toggle Loupe Magnifier (L) — hover to inspect, click image to pin"
            >
              <Search className="w-3.5 h-3.5" />
              <span className="hidden md:inline">Loupe</span>
            </button>

            {loupeEnabled && (
              <>
                <div className="h-3.5 w-px bg-zinc-800 mx-0.5" />
                {(['2x', '4x', 'native'] as LoupeMagnification[]).map((mag) => (
                  <button
                    key={mag}
                    type="button"
                    onClick={() => setSingleLoupeMag(mag)}
                    className={`px-1.5 py-0.5 rounded font-mono text-[11px] transition-colors cursor-pointer ${
                      singleLoupeMag === mag
                        ? 'bg-zinc-800 text-indigo-300 font-semibold'
                        : 'text-zinc-400 hover:text-zinc-200'
                    }`}
                  >
                    {mag === 'native' ? '1:1' : mag.toUpperCase()}
                  </button>
                ))}
                <button
                  type="button"
                  onClick={() => setSingleLoupePinned((prev) => !prev)}
                  className={`inline-flex items-center gap-1 px-1.5 py-0.5 ml-0.5 rounded text-[11px] cursor-pointer ${
                    singleLoupePinned
                      ? 'bg-amber-500/20 text-amber-300'
                      : 'text-zinc-500 hover:text-zinc-300'
                  }`}
                  title={singleLoupePinned ? 'Unpin Loupe' : 'Pin Loupe'}
                >
                  {singleLoupePinned ? (
                    <Lock className="w-3 h-3" />
                  ) : (
                    <Unlock className="w-3 h-3" />
                  )}
                </button>
              </>
            )}
          </div>

          {/* A/B Split-Screen Compare Toggle (icon-only on mobile) */}
          {onEnterSplitMode && (
            <button
              type="button"
              onClick={onEnterSplitMode}
              className="inline-flex items-center gap-1.5 px-2 sm:px-2.5 py-1 rounded-lg bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 hover:border-indigo-500/60 text-zinc-200 hover:text-white text-xs font-medium cursor-pointer shrink-0 whitespace-nowrap transition-colors"
              title="Enter A/B Split-Screen Comparison"
              aria-label="Compare"
            >
              <Columns2 className="w-3.5 h-3.5 text-indigo-400" />
              <span className="hidden sm:inline">Compare</span>
            </button>
          )}

          {/* Viewport Full Screen Toggle */}
          <button
            type="button"
            onClick={() => onSetFullScreen((prev) => !prev)}
            className={`inline-flex items-center gap-1.5 px-2 sm:px-2.5 py-1 rounded-lg border text-xs font-medium transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
              isFullScreen
                ? 'bg-indigo-600 hover:bg-indigo-500 border-indigo-500 text-white'
                : 'bg-zinc-900 hover:bg-zinc-800 border-zinc-800 text-zinc-200'
            }`}
            title={
              isFullScreen
                ? 'Exit Full Screen (Space / Esc)'
                : 'Expand image viewer to Full Screen (Space)'
            }
          >
            {isFullScreen ? (
              <>
                <Minimize2 className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Exit Full Screen</span>
              </>
            ) : (
              <>
                <Maximize2 className="w-3.5 h-3.5 text-indigo-400" />
                <span className="hidden sm:inline">Full Screen</span>
              </>
            )}
          </button>

          <a
            href={`/api/images/${activeImage.id}/file?download=1`}
            className="inline-flex items-center gap-1.5 text-indigo-400 hover:text-indigo-300 font-medium px-2 py-1 rounded hover:bg-zinc-800/80 transition-colors shrink-0"
            title="Download original unchanged file"
          >
            <Download className="w-3.5 h-3.5" />
            <span className="hidden lg:inline">Download</span>
          </a>
        </div>
      </div>
    </div>
  );
};

