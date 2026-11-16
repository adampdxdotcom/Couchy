export interface DetectedFaceBox {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  score: number;
  /** Five 2D facial landmarks: [leftEye, rightEye, nose, leftMouth, rightMouth]. */
  landmarks: [number, number][];
}

// Standard InsightFace ArcFace reference landmarks for 112x112 aligned crops
const ARCFACE_DST_112: [number, number][] = [
  [38.2946, 51.6963],
  [73.5318, 51.5014],
  [56.0252, 71.7366],
  [41.5493, 92.3655],
  [70.7299, 92.2041],
];

/** Applies Non-Maximum Suppression to face boxes sorted by confidence descending. */
export function applyFaceNms(boxes: DetectedFaceBox[], iouThreshold = 0.4): DetectedFaceBox[] {
  const sorted = [...boxes].sort((a, b) => b.score - a.score);
  const selected: DetectedFaceBox[] = [];
  const suppressed = new Uint8Array(sorted.length);

  for (let i = 0; i < sorted.length; i++) {
    if (suppressed[i]) continue;
    const a = sorted[i];
    selected.push(a);
    const areaA = Math.max(0, a.x2 - a.x1) * Math.max(0, a.y2 - a.y1);

    for (let j = i + 1; j < sorted.length; j++) {
      if (suppressed[j]) continue;
      const b = sorted[j];
      const ix1 = Math.max(a.x1, b.x1);
      const iy1 = Math.max(a.y1, b.y1);
      const ix2 = Math.min(a.x2, b.x2);
      const iy2 = Math.min(a.y2, b.y2);
      const inter = Math.max(0, ix2 - ix1) * Math.max(0, iy2 - iy1);
      if (inter <= 0) continue;

      const areaB = Math.max(0, b.x2 - b.x1) * Math.max(0, b.y2 - b.y1);
      const union = areaA + areaB - inter;
      if (union > 0 && inter / union > iouThreshold) {
        suppressed[j] = 1;
      }
    }
  }

  return selected;
}

/**
 * Fits a 2D similarity transform mapping destination 112x112 coordinates (u, v)
 * back to source image coordinates (x, y) via linear least squares:
 *   x = a * u - b * v + tx
 *   y = b * u + a * v + ty
 */
function solveInverseSimilarity(
  srcPts: [number, number][],
  dstPts: [number, number][]
): { a: number; b: number; tx: number; ty: number } | null {
  const n = Math.min(srcPts.length, dstPts.length);
  if (n < 2) return null;

  let meanU = 0;
  let meanV = 0;
  let meanX = 0;
  let meanY = 0;
  for (let i = 0; i < n; i++) {
    meanU += dstPts[i][0];
    meanV += dstPts[i][1];
    meanX += srcPts[i][0];
    meanY += srcPts[i][1];
  }
  meanU /= n;
  meanV /= n;
  meanX /= n;
  meanY /= n;

  let denom = 0;
  let numA = 0;
  let numB = 0;
  for (let i = 0; i < n; i++) {
    const du = dstPts[i][0] - meanU;
    const dv = dstPts[i][1] - meanV;
    const dx = srcPts[i][0] - meanX;
    const dy = srcPts[i][1] - meanY;
    denom += du * du + dv * dv;
    numA += du * dx + dv * dy;
    numB += du * dy - dv * dx;
  }

  if (denom < 1e-8) return null;
  const a = numA / denom;
  const b = numB / denom;
  const tx = meanX - a * meanU + b * meanV;
  const ty = meanY - b * meanU - a * meanV;
  return { a, b, tx, ty };
}

/**
 * Warps a face region from an RGB pixel buffer into an aligned 112x112x3 RGB Uint8Array
 * matching ArcFace's canonical 5-point facial template.
 */
export function warpAlignedFace112(
  rgbData: Uint8Array,
  srcWidth: number,
  srcHeight: number,
  landmarks: [number, number][]
): Uint8Array {
  const outSize = 112;
  const out = new Uint8Array(outSize * outSize * 3);
  const xform = solveInverseSimilarity(landmarks, ARCFACE_DST_112);
  if (!xform) return out;

  const { a, b, tx, ty } = xform;
  for (let v = 0; v < outSize; v++) {
    for (let u = 0; u < outSize; u++) {
      const sx = a * u - b * v + tx;
      const sy = b * u + a * v + ty;
      const outIdx = (v * outSize + u) * 3;

      if (sx < 0 || sy < 0 || sx >= srcWidth - 1 || sy >= srcHeight - 1) {
        // Clamp edge pixels softly rather than leaving harsh black borders when near frame edge
        const cx = Math.max(0, Math.min(srcWidth - 1, Math.round(sx)));
        const cy = Math.max(0, Math.min(srcHeight - 1, Math.round(sy)));
        const srcIdx = (cy * srcWidth + cx) * 3;
        out[outIdx] = rgbData[srcIdx];
        out[outIdx + 1] = rgbData[srcIdx + 1];
        out[outIdx + 2] = rgbData[srcIdx + 2];
        continue;
      }

      const x0 = Math.floor(sx);
      const y0 = Math.floor(sy);
      const fx = sx - x0;
      const fy = sy - y0;
      const w00 = (1 - fx) * (1 - fy);
      const w10 = fx * (1 - fy);
      const w01 = (1 - fx) * fy;
      const w11 = fx * fy;

      const i00 = (y0 * srcWidth + x0) * 3;
      const i10 = i00 + 3;
      const i01 = ((y0 + 1) * srcWidth + x0) * 3;
      const i11 = i01 + 3;

      out[outIdx] = Math.round(
        rgbData[i00] * w00 + rgbData[i10] * w10 + rgbData[i01] * w01 + rgbData[i11] * w11
      );
      out[outIdx + 1] = Math.round(
        rgbData[i00 + 1] * w00 +
          rgbData[i10 + 1] * w10 +
          rgbData[i01 + 1] * w01 +
          rgbData[i11 + 1] * w11
      );
      out[outIdx + 2] = Math.round(
        rgbData[i00 + 2] * w00 +
          rgbData[i10 + 2] * w10 +
          rgbData[i01 + 2] * w01 +
          rgbData[i11 + 2] * w11
      );
    }
  }

  return out;
}

/** Normalizes an embedding vector to unit L2 length. */
export function l2Normalize(vec: Float32Array): Float32Array {
  let sumSq = 0;
  for (let i = 0; i < vec.length; i++) {
    sumSq += vec[i] * vec[i];
  }
  const norm = Math.sqrt(sumSq);
  const out = new Float32Array(vec.length);
  if (norm <= 1e-12) return out;
  for (let i = 0; i < vec.length; i++) {
    out[i] = vec[i] / norm;
  }
  return out;
}

/** Computes cosine similarity between two unit-normalized Float32Array embeddings. */
export function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  const len = Math.min(a.length, b.length);
  let dot = 0;
  for (let i = 0; i < len; i++) {
    dot += a[i] * b[i];
  }
  return dot;
}

export function encodeEmbeddingBase64(vec: Float32Array): string {
  return Buffer.from(vec.buffer, vec.byteOffset, vec.byteLength).toString('base64');
}

export function decodeEmbeddingBase64(b64: string): Float32Array {
  const buf = Buffer.from(b64, 'base64');
  return new Float32Array(
    buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
  );
}
