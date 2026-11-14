import React, { useLayoutEffect, useState } from 'react';
import { Lock } from 'lucide-react';
import type { ImageRecord } from '../../shared/types.ts';

export type LoupeMagnification = '2x' | '4x' | 'native';

export interface LoupeUV {
  u: number;
  v: number;
}

export interface PaintedImageRect {
  offsetLeft: number;
  offsetTop: number;
  width: number;
  height: number;
  naturalWidth: number;
  naturalHeight: number;
}

/**
 * Computes the exact painted rectangle of an `object-contain` (or native) <img>
 * relative to its positioning container element.
 */
export function computePaintedImageRect(
  containerEl: HTMLElement | null,
  imgEl: HTMLImageElement | null,
  fallbackW: number,
  fallbackH: number
): PaintedImageRect | null {
  if (!containerEl || !imgEl) return null;
  const containerRect = containerEl.getBoundingClientRect();
  const imgRect = imgEl.getBoundingClientRect();
  if (imgRect.width <= 0 || imgRect.height <= 0) return null;

  const naturalWidth = imgEl.naturalWidth || fallbackW || 1024;
  const naturalHeight = imgEl.naturalHeight || fallbackH || 1024;

  const boxW = imgRect.width;
  const boxH = imgRect.height;
  const imgAspect = naturalWidth / naturalHeight;
  const boxAspect = boxW / boxH;

  let paintedW = boxW;
  let paintedH = boxH;

  if (Math.abs(imgAspect - boxAspect) > 0.001) {
    if (imgAspect > boxAspect) {
      paintedW = boxW;
      paintedH = boxW / imgAspect;
    } else {
      paintedH = boxH;
      paintedW = boxH * imgAspect;
    }
  }

  const offsetLeft =
    imgRect.left - containerRect.left + (boxW - paintedW) / 2;
  const offsetTop =
    imgRect.top - containerRect.top + (boxH - paintedH) / 2;

  return {
    offsetLeft,
    offsetTop,
    width: paintedW,
    height: paintedH,
    naturalWidth,
    naturalHeight,
  };
}

/**
 * Maps a client pointer (clientX, clientY) to normalized UV [0..1] coordinates
 * inside the painted image rectangle. Returns null if outside when `clamp` is false.
 */
export function clientPointToImageUV(
  clientX: number,
  clientY: number,
  containerEl: HTMLElement | null,
  imgEl: HTMLImageElement | null,
  fallbackW: number,
  fallbackH: number,
  clamp = true
): LoupeUV | null {
  if (!containerEl) return null;
  const painted = computePaintedImageRect(containerEl, imgEl, fallbackW, fallbackH);
  if (!painted || painted.width <= 0 || painted.height <= 0) return null;

  const containerRect = containerEl.getBoundingClientRect();
  const localX = clientX - containerRect.left - painted.offsetLeft;
  const localY = clientY - containerRect.top - painted.offsetTop;

  const rawU = localX / painted.width;
  const rawV = localY / painted.height;

  if (!clamp && (rawU < 0 || rawU > 1 || rawV < 0 || rawV > 1)) {
    return null;
  }

  return {
    u: Math.max(0, Math.min(1, rawU)),
    v: Math.max(0, Math.min(1, rawV)),
  };
}

interface SingleLoupeLensProps {
  image: ImageRecord;
  uv: LoupeUV;
  magnification: LoupeMagnification;
  isPinned: boolean;
  slotLabel?: 'A' | 'B';
  containerRef: React.RefObject<HTMLElement | null>;
  imgRef: React.RefObject<HTMLImageElement | null>;
  lensSize?: number;
}

/**
 * Rounded-rectangle magnifier lens rendered over a single image pane (or mirrored pane in Side-by-Side mode).
 */
export const SingleLoupeLens: React.FC<SingleLoupeLensProps> = ({
  image,
  uv,
  magnification,
  isPinned,
  slotLabel,
  containerRef,
  imgRef,
  lensSize = 228,
}) => {
  const [painted, setPainted] = useState<PaintedImageRect | null>(null);

  useLayoutEffect(() => {
    const update = () => {
      setPainted(
        computePaintedImageRect(
          containerRef.current,
          imgRef.current,
          image.width,
          image.height
        )
      );
    };
    update();
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, [containerRef, imgRef, image.id, image.width, image.height, uv.u, uv.v]);

  if (!painted || !containerRef.current) return null;

  const containerW = containerRef.current.clientWidth || painted.width;
  const containerH = containerRef.current.clientHeight || painted.height;

  // Target point in container coordinates
  const targetX = painted.offsetLeft + uv.u * painted.width;
  const targetY = painted.offsetTop + uv.v * painted.height;

  // Clamp lens box inside container so it never clips off the edge of the pane
  const half = lensSize / 2;
  const pad = 8;
  const lensLeft = Math.max(
    pad,
    Math.min(containerW - lensSize - pad, targetX - half)
  );
  const lensTop = Math.max(
    pad,
    Math.min(containerH - lensSize - pad, targetY - half)
  );

  // Compute zoomed image dimensions inside the lens
  const zoomFactor =
    magnification === '2x' ? 2 : magnification === '4x' ? 4 : 1;
  const zoomedW =
    magnification === 'native'
      ? painted.naturalWidth
      : painted.width * zoomFactor;
  const zoomedH =
    magnification === 'native'
      ? painted.naturalHeight
      : painted.height * zoomFactor;

  const imgLeft = half - uv.u * zoomedW;
  const imgTop = half - uv.v * zoomedH;

  // Reticle position inside the lens (accounts for edge clamping)
  const reticleX = Math.max(12, Math.min(lensSize - 12, targetX - lensLeft));
  const reticleY = Math.max(12, Math.min(lensSize - 12, targetY - lensTop));

  const borderColor = isPinned
    ? 'border-amber-400/95 shadow-[0_12px_36px_rgba(0,0,0,0.85)]'
    : slotLabel === 'B'
    ? 'border-amber-300/85 shadow-[0_10px_30px_rgba(0,0,0,0.8)]'
    : 'border-indigo-400/90 shadow-[0_10px_30px_rgba(0,0,0,0.8)]';

  return (
    <div
      style={{
        width: `${lensSize}px`,
        height: `${lensSize}px`,
        left: `${lensLeft}px`,
        top: `${lensTop}px`,
      }}
      className={`absolute z-30 rounded-xl overflow-hidden bg-zinc-950 border-2 ${borderColor} pointer-events-none select-none`}
    >
      <img
        src={image.originalUrl}
        alt=""
        referrerPolicy="no-referrer"
        draggable={false}
        style={{
          width: `${zoomedW}px`,
          height: `${zoomedH}px`,
          left: `${imgLeft}px`,
          top: `${imgTop}px`,
        }}
        className="absolute max-w-none pointer-events-none select-none"
      />

      {/* Subtle center reticle */}
      <div
        style={{ left: `${reticleX}px`, top: `${reticleY}px` }}
        className="absolute -translate-x-1/2 -translate-y-1/2 w-3.5 h-3.5 rounded-full border border-white/75 shadow-[0_0_4px_rgba(0,0,0,0.9)]"
      />

      {/* Top-left HUD label */}
      <div className="absolute top-1.5 left-1.5 right-1.5 flex items-center justify-between gap-1 text-[10px] font-mono">
        <span className="px-1.5 py-0.5 rounded bg-zinc-950/85 border border-zinc-700/80 text-zinc-100 backdrop-blur-xs">
          {slotLabel ? `${slotLabel} · ` : ''}
          {magnification === 'native' ? '1:1 Native' : magnification.toUpperCase()}
        </span>
        {isPinned && (
          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-amber-500/90 text-zinc-950 font-semibold">
            <Lock className="w-2.5 h-2.5" />
            <span>Pinned</span>
          </span>
        )}
      </div>
    </div>
  );
};

interface SplitWipeLoupeLensProps {
  imageA: ImageRecord;
  imageB: ImageRecord;
  uv: LoupeUV;
  magnification: LoupeMagnification;
  isPinned: boolean;
  containerRef: React.RefObject<HTMLElement | null>;
  imgARef: React.RefObject<HTMLImageElement | null>;
  imgBRef: React.RefObject<HTMLImageElement | null>;
  lensSize?: number;
}

/**
 * Split [A | B] magnifier lens for Overlay Wipe mode: shows magnified Image A on the left half
 * and magnified Image B on the right half around the exact same UV coordinate without fighting the wipe slider.
 */
export const SplitWipeLoupeLens: React.FC<SplitWipeLoupeLensProps> = ({
  imageA,
  imageB,
  uv,
  magnification,
  isPinned,
  containerRef,
  imgARef,
  imgBRef,
  lensSize = 248,
}) => {
  const [paintedA, setPaintedA] = useState<PaintedImageRect | null>(null);
  const [paintedB, setPaintedB] = useState<PaintedImageRect | null>(null);

  useLayoutEffect(() => {
    const update = () => {
      setPaintedA(
        computePaintedImageRect(
          containerRef.current,
          imgARef.current,
          imageA.width,
          imageA.height
        )
      );
      setPaintedB(
        computePaintedImageRect(
          containerRef.current,
          imgBRef.current,
          imageB.width,
          imageB.height
        )
      );
    };
    update();
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, [
    containerRef,
    imgARef,
    imgBRef,
    imageA.id,
    imageA.width,
    imageA.height,
    imageB.id,
    imageB.width,
    imageB.height,
    uv.u,
    uv.v,
  ]);

  if (!paintedA || !paintedB || !containerRef.current) return null;

  const containerW = containerRef.current.clientWidth || paintedA.width;
  const containerH = containerRef.current.clientHeight || paintedA.height;

  const targetX = paintedA.offsetLeft + uv.u * paintedA.width;
  const targetY = paintedA.offsetTop + uv.v * paintedA.height;

  const half = lensSize / 2;
  const pad = 10;
  // Offset lens slightly above/beside cursor when unpinned so the wipe handle stays easy to grab
  const desiredLeft = isPinned ? targetX - half : targetX + 20;
  const desiredTop = isPinned ? targetY - half : targetY - lensSize - 16;

  const lensLeft = Math.max(
    pad,
    Math.min(
      containerW - lensSize - pad,
      desiredLeft + lensSize > containerW - pad ? targetX - lensSize - 20 : desiredLeft
    )
  );
  const lensTop = Math.max(
    pad,
    Math.min(
      containerH - lensSize - pad,
      desiredTop < pad ? targetY + 20 : desiredTop
    )
  );

  const zoomFactor =
    magnification === '2x' ? 2 : magnification === '4x' ? 4 : 1;

  const zoomedWA =
    magnification === 'native'
      ? paintedA.naturalWidth
      : paintedA.width * zoomFactor;
  const zoomedHA =
    magnification === 'native'
      ? paintedA.naturalHeight
      : paintedA.height * zoomFactor;

  const zoomedWB =
    magnification === 'native'
      ? paintedB.naturalWidth
      : paintedB.width * zoomFactor;
  const zoomedHB =
    magnification === 'native'
      ? paintedB.naturalHeight
      : paintedB.height * zoomFactor;

  const imgALeft = half - uv.u * zoomedWA;
  const imgATop = half - uv.v * zoomedHA;

  const imgBLeft = half - uv.u * zoomedWB;
  const imgBTop = half - uv.v * zoomedHB;

  return (
    <div
      style={{
        width: `${lensSize}px`,
        height: `${lensSize}px`,
        left: `${lensLeft}px`,
        top: `${lensTop}px`,
      }}
      className={`absolute z-30 rounded-xl overflow-hidden bg-zinc-950 border-2 ${
        isPinned
          ? 'border-amber-400/95 shadow-[0_12px_36px_rgba(0,0,0,0.9)]'
          : 'border-indigo-400/90 shadow-[0_10px_30px_rgba(0,0,0,0.85)]'
      } pointer-events-none select-none`}
    >
      {/* Left half: Image A */}
      <img
        src={imageA.originalUrl}
        alt=""
        referrerPolicy="no-referrer"
        draggable={false}
        style={{
          width: `${zoomedWA}px`,
          height: `${zoomedHA}px`,
          left: `${imgALeft}px`,
          top: `${imgATop}px`,
          clipPath: 'inset(0 50% 0 0)',
        }}
        className="absolute max-w-none pointer-events-none select-none"
      />

      {/* Right half: Image B */}
      <img
        src={imageB.originalUrl}
        alt=""
        referrerPolicy="no-referrer"
        draggable={false}
        style={{
          width: `${zoomedWB}px`,
          height: `${zoomedHB}px`,
          left: `${imgBLeft}px`,
          top: `${imgBTop}px`,
          clipPath: 'inset(0 0 0 50%)',
        }}
        className="absolute max-w-none pointer-events-none select-none"
      />

      {/* Center Split Line inside Lens */}
      <div className="absolute inset-y-0 left-1/2 -translate-x-1/2 w-px bg-white/85 shadow-[0_0_6px_rgba(0,0,0,0.9)]" />

      {/* Center Reticle */}
      <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-3.5 h-3.5 rounded-full border border-white/80 shadow-[0_0_4px_rgba(0,0,0,0.9)]" />

      {/* Top HUD */}
      <div className="absolute top-1.5 left-1.5 right-1.5 flex items-center justify-between gap-1 text-[10px] font-mono">
        <span className="px-1.5 py-0.5 rounded bg-zinc-950/85 border border-indigo-500/40 text-indigo-300">
          A · {magnification === 'native' ? '1:1' : magnification.toUpperCase()}
        </span>
        {isPinned && (
          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-amber-500/90 text-zinc-950 font-semibold">
            <Lock className="w-2.5 h-2.5" />
            <span>Pinned</span>
          </span>
        )}
        <span className="px-1.5 py-0.5 rounded bg-zinc-950/85 border border-amber-500/40 text-amber-300">
          {magnification === 'native' ? '1:1' : magnification.toUpperCase()} · B
        </span>
      </div>
    </div>
  );
};
