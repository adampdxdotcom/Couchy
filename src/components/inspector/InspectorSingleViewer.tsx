import React, { useEffect, useRef, useState } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  Download,
  Lock,
  Minimize2,
  Search,
  Unlock,
} from 'lucide-react';
import { formatBytes } from '../../shared/utils.ts';
import {
  clientPointToImageUV,
  SingleLoupeLens,
  type LoupeMagnification,
  type LoupeUV,
} from './LoupeOverlay.tsx';
import type { ImageRecord } from '../../shared/types.ts';

interface InspectorSingleViewerProps {
  activeImage: ImageRecord;
  outerImageId: number;
  isFullScreen: boolean;
  onSetFullScreen: (next: boolean | ((prev: boolean) => boolean)) => void;
  onPrev?: () => void;
  onNext?: () => void;
}

/**
 * Full-resolution single-image lightbox viewport with interactive Loupe magnifier
 * and docked bottom metadata/download bar.
 */
export const InspectorSingleViewer: React.FC<InspectorSingleViewerProps> = ({
  activeImage,
  outerImageId,
  isFullScreen,
  onSetFullScreen,
  onPrev,
  onNext,
}) => {
  const [singleLoupeEnabled, setSingleLoupeEnabled] = useState(false);
  const [singleLoupeMag, setSingleLoupeMag] = useState<LoupeMagnification>('2x');
  const [singleLoupeUV, setSingleLoupeUV] = useState<LoupeUV | null>(null);
  const [singleLoupePinned, setSingleLoupePinned] = useState(false);
  const singleViewerPaneRef = useRef<HTMLDivElement | null>(null);
  const singleViewerImgRef = useRef<HTMLImageElement | null>(null);

  useEffect(() => {
    setSingleLoupePinned(false);
  }, [outerImageId]);

  return (
    <div
      ref={singleViewerPaneRef}
      onPointerMove={(e) => {
        if (!singleLoupeEnabled || singleLoupePinned) return;
        const nextUV = clientPointToImageUV(
          e.clientX,
          e.clientY,
          singleViewerPaneRef.current,
          singleViewerImgRef.current,
          activeImage.width,
          activeImage.height
        );
        if (nextUV) setSingleLoupeUV(nextUV);
      }}
      onPointerLeave={() => {
        if (singleLoupeEnabled && !singleLoupePinned) {
          setSingleLoupeUV(null);
        }
      }}
      onClick={(e) => {
        if (singleLoupeEnabled) {
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
          return;
        }
        if (isFullScreen) onSetFullScreen(false);
      }}
      className={`relative bg-zinc-950 flex items-center justify-center select-none overflow-hidden transition-all duration-200 ${
        singleLoupeEnabled ? 'cursor-crosshair' : ''
      } ${
        isFullScreen
          ? 'fixed inset-0 z-50 p-2 sm:p-6 pb-14 sm:pb-14 bg-black/95 cursor-zoom-out'
          : 'flex-1 p-4 pb-14 lg:pb-4'
      }`}
    >
      {/* Top-Right Exit Full-Screen Pill (shown only when expanded via image click) */}
      {isFullScreen && (
        <div className="absolute top-4 right-4 z-20 flex items-center gap-2">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onSetFullScreen(false);
            }}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-zinc-900/90 hover:bg-zinc-800 text-zinc-100 border border-zinc-700/80 shadow-2xl backdrop-blur-md text-xs font-medium cursor-pointer"
            title="Exit Full Screen (Esc)"
          >
            <Minimize2 className="w-4 h-4 text-indigo-400" />
            <span>Exit Full Screen</span>
            <span className="text-zinc-500 text-[10px] hidden sm:inline ml-0.5 font-mono">ESC</span>
          </button>
        </div>
      )}

      {/* Previous Image Arrow */}
      {onPrev && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onPrev();
          }}
          className={`absolute left-3 sm:left-4 top-1/2 -translate-y-1/2 rounded-full bg-zinc-900/85 hover:bg-zinc-800 text-zinc-200 border border-zinc-700/60 cursor-pointer z-10 transition-colors shadow-lg ${
            isFullScreen ? 'p-3 sm:p-3.5' : 'p-2.5'
          }`}
          title="Previous Image (Left Arrow)"
        >
          <ChevronLeft className={isFullScreen ? 'w-6 h-6' : 'w-5 h-5'} />
        </button>
      )}

      {/* Centered Image */}
      <img
        ref={singleViewerImgRef}
        src={activeImage.originalUrl}
        alt={activeImage.filename}
        referrerPolicy="no-referrer"
        draggable={false}
        onClick={(e) => {
          if (singleLoupeEnabled) return;
          e.stopPropagation();
          onSetFullScreen((prev) => !prev);
        }}
        className={`max-w-full max-h-full object-contain rounded transition-all duration-200 ${
          singleLoupeEnabled
            ? 'cursor-crosshair'
            : isFullScreen
            ? 'cursor-zoom-out'
            : 'cursor-zoom-in active:scale-[0.99]'
        }`}
        title={
          singleLoupeEnabled
            ? singleLoupePinned
              ? 'Click to unpin Loupe'
              : 'Click to pin Loupe at this spot'
            : isFullScreen
            ? 'Tap or click to exit full screen'
            : 'Tap or click to expand full screen'
        }
      />

      {/* Single-Image Loupe Lens */}
      {singleLoupeEnabled && singleLoupeUV && (
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
          className={`absolute right-3 sm:right-4 top-1/2 -translate-y-1/2 rounded-full bg-zinc-900/85 hover:bg-zinc-800 text-zinc-200 border border-zinc-700/60 cursor-pointer z-10 transition-colors shadow-lg ${
            isFullScreen ? 'p-3 sm:p-3.5' : 'p-2.5'
          }`}
          title="Next Image (Right Arrow)"
        >
          <ChevronRight className={isFullScreen ? 'w-6 h-6' : 'w-5 h-5'} />
        </button>
      )}

      {/* Bottom Metadata, Loupe Controls & Download Bar (Docked to bottom edge to never overlap image) */}
      <div
        onClick={(e) => e.stopPropagation()}
        className="fixed bottom-0 inset-x-0 h-11 bg-zinc-950/95 border-t border-zinc-800/80 px-3 sm:px-4 flex items-center justify-between gap-2 text-xs text-zinc-400 backdrop-blur-md z-30 shadow-lg select-none"
      >
        <div className="flex items-center gap-1.5 sm:gap-2 font-mono tabular-nums truncate text-xs">
          <span className="text-zinc-200 font-sans font-medium truncate max-w-[130px] xs:max-w-[180px] sm:max-w-xs">
            {activeImage.filename}
          </span>
          <span aria-hidden="true" className="text-zinc-600">·</span>
          <span className="shrink-0">
            {activeImage.width}×{activeImage.height}
          </span>
          <span aria-hidden="true" className="text-zinc-600 hidden sm:inline">·</span>
          <span className="hidden sm:inline shrink-0">{formatBytes(activeImage.fileSize)}</span>
          <span aria-hidden="true" className="text-zinc-600 hidden md:inline">·</span>
          <span className="hidden md:inline text-zinc-500 font-mono shrink-0">
            SHA256: {activeImage.contentHash.slice(0, 10)}…
          </span>
        </div>

        <div className="flex items-center gap-2 sm:gap-3 shrink-0">
          {/* Inline Loupe Controls in Bottom Bar */}
          <div className="inline-flex items-center p-0.5 bg-zinc-900 border border-zinc-800 rounded-lg text-xs">
            <button
              type="button"
              onClick={() => {
                setSingleLoupeEnabled((prev) => {
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
                singleLoupeEnabled
                  ? 'bg-indigo-600 text-white'
                  : 'text-zinc-400 hover:text-zinc-200'
              }`}
              title="Toggle Loupe Magnifier (hover to inspect, click image to pin)"
            >
              <Search className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Loupe</span>
            </button>

            {singleLoupeEnabled && (
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

          {isFullScreen && !singleLoupeEnabled && (
            <span className="text-[11px] text-zinc-500 hidden lg:inline">
              Tap image or press ESC to exit full screen
            </span>
          )}
          <a
            href={`/api/images/${activeImage.id}/file?download=1`}
            className="inline-flex items-center gap-1.5 text-indigo-400 hover:text-indigo-300 font-medium px-2 py-1 rounded hover:bg-zinc-800/80 transition-colors shrink-0"
            title="Download original unchanged file"
          >
            <Download className="w-3.5 h-3.5" />
            <span className="hidden xs:inline sm:inline">Download</span>
          </a>
        </div>
      </div>
    </div>
  );
};
