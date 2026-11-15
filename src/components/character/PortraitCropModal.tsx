import React, { useEffect, useRef, useState } from 'react';
import { Move, RotateCcw, X, ZoomIn } from 'lucide-react';
import type { PortraitCrop } from '../../shared/types.ts';
import { normalizePortraitCrop } from '../../shared/utils.ts';
import { CharacterPortraitImage } from './CharacterPortraitImage.tsx';

interface PortraitCropModalProps {
  isOpen: boolean;
  characterName: string;
  portraitUrl: string;
  initialCrop?: PortraitCrop | null;
  onClose: () => void;
  onSave: (nextCrop: PortraitCrop | null) => Promise<void>;
}

const DEFAULT_CROP: PortraitCrop = { x: 50, y: 50, zoom: 1 };

function clamp(val: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, val));
}

function isDefaultCrop(crop: PortraitCrop): boolean {
  return (
    Math.abs(crop.x - 50) < 0.1 &&
    Math.abs(crop.y - 50) < 0.1 &&
    Math.abs(crop.zoom - 1) < 0.01
  );
}

/**
 * Interactive display-only portrait framing modal allowing focal pan + zoom
 * without altering the source image file or LLM Vision input.
 */
export const PortraitCropModal: React.FC<PortraitCropModalProps> = ({
  isOpen,
  characterName,
  portraitUrl,
  initialCrop,
  onClose,
  onSave,
}) => {
  const [draft, setDraft] = useState<PortraitCrop>(
    () => normalizePortraitCrop(initialCrop) || DEFAULT_CROP
  );
  const [isSaving, setIsSaving] = useState(false);
  const [isDragging, setIsDragging] = useState(false);

  const canvasRef = useRef<HTMLDivElement | null>(null);
  const dragStateRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    originCrop: PortraitCrop;
  } | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    setDraft(normalizePortraitCrop(initialCrop) || DEFAULT_CROP);
    setIsSaving(false);
    setIsDragging(false);
    dragStateRef.current = null;
  }, [isOpen, initialCrop]);

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !isSaving) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, isSaving, onClose]);

  useEffect(() => {
    const el = canvasRef.current;
    if (!isOpen || !el) return;
    const handleNativeWheel = (e: WheelEvent) => {
      if (isSaving) return;
      e.preventDefault();
      const delta = e.deltaY < 0 ? 0.1 : -0.1;
      setDraft((prev) => ({
        ...prev,
        zoom: Math.round(clamp(prev.zoom + delta, 1, 3) * 100) / 100,
      }));
    };
    el.addEventListener('wheel', handleNativeWheel, { passive: false });
    return () => el.removeEventListener('wheel', handleNativeWheel);
  }, [isOpen, isSaving]);

  if (!isOpen) return null;

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (isSaving) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    dragStateRef.current = {
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      originCrop: draft,
    };
    setIsDragging(true);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const active = dragStateRef.current;
    if (!active || active.pointerId !== e.pointerId) return;

    const boxSize = canvasRef.current?.clientWidth || 256;
    const dx = e.clientX - active.startX;
    const dy = e.clientY - active.startY;
    // Scale pan sensitivity inversely with zoom so high-zoom framing stays smooth
    const scaleFactor = 100 / (boxSize * Math.max(1, active.originCrop.zoom) * 0.75);

    setDraft({
      x: Math.round(clamp(active.originCrop.x - dx * scaleFactor, 0, 100) * 10) / 10,
      y: Math.round(clamp(active.originCrop.y - dy * scaleFactor, 0, 100) * 10) / 10,
      zoom: active.originCrop.zoom,
    });
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    const active = dragStateRef.current;
    if (!active || active.pointerId !== e.pointerId) return;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
    dragStateRef.current = null;
    setIsDragging(false);
  };

  const handleConfirm = async () => {
    if (isSaving) return;
    setIsSaving(true);
    try {
      await onSave(isDefaultCrop(draft) ? null : draft);
      onClose();
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={() => !isSaving && onClose()}
    >
      <div
        className="w-full max-w-md bg-zinc-900 border border-zinc-800 rounded-2xl shadow-2xl overflow-hidden text-xs"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-5 py-3.5 border-b border-zinc-800 flex items-center justify-between gap-3">
          <div className="min-w-0">
            <h3 className="text-sm font-display font-semibold text-zinc-100 truncate">
              Frame Portrait · {characterName}
            </h3>
            <p className="text-[11px] text-zinc-400">
              Drag to position and adjust zoom for display thumbnails.
            </p>
          </div>
          <button
            type="button"
            disabled={isSaving}
            onClick={onClose}
            className="p-1.5 rounded-lg text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 cursor-pointer shrink-0"
            aria-label="Close portrait framing modal"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="p-5 space-y-4">
          {/* Interactive 1:1 Focal Canvas */}
          <div className="flex flex-col items-center gap-2">
            <div
              ref={canvasRef}
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUp}
              onPointerCancel={handlePointerUp}
              className={`relative w-64 h-64 rounded-xl bg-zinc-950 border border-zinc-700 overflow-hidden select-none touch-none ${
                isDragging ? 'cursor-grabbing border-indigo-500' : 'cursor-grab'
              }`}
            >
              <CharacterPortraitImage
                src={portraitUrl}
                alt={characterName}
                crop={draft}
                className="w-full h-full object-cover pointer-events-none select-none"
              />

              {/* Circular avatar & focal reticle guides */}
              <div className="pointer-events-none absolute inset-0 rounded-full border border-dashed border-white/25 m-2" />
              <div className="pointer-events-none absolute top-2 left-2 px-2 py-0.5 rounded bg-zinc-950/75 border border-zinc-800 text-[10px] font-mono text-zinc-300 flex items-center gap-1">
                <Move className="w-3 h-3 text-indigo-400" />
                <span>
                  {Math.round(draft.x)}% · {Math.round(draft.y)}%
                </span>
              </div>
            </div>

            {/* Zoom Control */}
            <div className="w-64 flex items-center gap-2.5 pt-1">
              <ZoomIn className="w-3.5 h-3.5 text-zinc-400 shrink-0" />
              <input
                type="range"
                min="1"
                max="3"
                step="0.05"
                value={draft.zoom}
                onChange={(e) =>
                  setDraft((prev) => ({
                    ...prev,
                    zoom: Math.round(clamp(Number(e.target.value), 1, 3) * 100) / 100,
                  }))
                }
                aria-label="Portrait zoom"
                className="flex-1 accent-indigo-500 cursor-pointer"
              />
              <span className="w-11 text-right font-mono tabular-nums text-zinc-300">
                {draft.zoom.toFixed(2)}×
              </span>
            </div>
          </div>

          {/* Live Aspect-Ratio Previews */}
          <div className="pt-2 border-t border-zinc-800/80 space-y-2">
            <div className="text-[11px] font-medium text-zinc-400">Live Surface Previews</div>
            <div className="flex items-end justify-center gap-5">
              <div className="flex flex-col items-center gap-1">
                <div className="w-12 h-12 rounded-lg bg-zinc-950 border border-zinc-800 overflow-hidden">
                  <CharacterPortraitImage src={portraitUrl} alt="Square preview" crop={draft} />
                </div>
                <span className="text-[10px] font-mono text-zinc-500">1:1 Profile</span>
              </div>

              <div className="flex flex-col items-center gap-1">
                <div className="w-16 h-12 rounded-lg bg-zinc-950 border border-zinc-800 overflow-hidden">
                  <CharacterPortraitImage src={portraitUrl} alt="Card preview" crop={draft} />
                </div>
                <span className="text-[10px] font-mono text-zinc-500">4:3 Card</span>
              </div>

              <div className="flex flex-col items-center gap-1">
                <div className="w-10 h-10 rounded-full bg-zinc-950 border border-zinc-800 overflow-hidden">
                  <CharacterPortraitImage src={portraitUrl} alt="Badge preview" crop={draft} />
                </div>
                <span className="text-[10px] font-mono text-zinc-500">Badge</span>
              </div>
            </div>
          </div>

          <p className="text-[11px] text-zinc-500 text-center leading-relaxed">
            Display framing only — never modifies the original image file or LLM Vision analysis.
          </p>
        </div>

        {/* Footer */}
        <div className="px-5 py-3.5 bg-zinc-950/60 border-t border-zinc-800 flex items-center justify-between gap-2">
          <button
            type="button"
            disabled={isSaving || isDefaultCrop(draft)}
            onClick={() => setDraft(DEFAULT_CROP)}
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-zinc-900 border border-zinc-800 hover:border-zinc-700 disabled:opacity-40 text-zinc-300 cursor-pointer"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span>Reset</span>
          </button>

          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={isSaving}
              onClick={onClose}
              className="px-3 py-1.5 rounded-lg bg-zinc-900 border border-zinc-800 hover:border-zinc-700 text-zinc-300 cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={isSaving}
              onClick={handleConfirm}
              className="px-3.5 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white font-medium cursor-pointer"
            >
              {isSaving ? 'Saving...' : 'Save Framing'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
