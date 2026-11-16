import fs from 'fs';
import path from 'path';
import { Readable } from 'stream';
import sharp from 'sharp';
import * as ort from 'onnxruntime-node';
import { db } from '../db.ts';
import { appConfig } from '../config.ts';
import { resolveCharacterPortraitId } from './characterService.ts';
import { resolveImageDiskPath } from './scannerService.ts';
import {
  applyFaceNms,
  cosineSimilarity,
  decodeEmbeddingBase64,
  encodeEmbeddingBase64,
  l2Normalize,
  warpAlignedFace112,
  type DetectedFaceBox,
} from './faceAlignmentUtils.ts';

const DET_INPUT_SIZE = 640;
const REC_INPUT_SIZE = 112;
const DEFAULT_MIN_SIMILARITY = 0.38;

const MODEL_DOWNLOAD_MIRRORS: Record<'det_10g.onnx' | 'w600k_r50.onnx', string[]> = {
  'det_10g.onnx': [
    'https://huggingface.co/PcZerokey/insightface/resolve/main/buffalo_l/det_10g.onnx',
    'https://huggingface.co/LPDoctor/insightface/resolve/main/models/buffalo_l/det_10g.onnx',
  ],
  'w600k_r50.onnx': [
    'https://huggingface.co/PcZerokey/insightface/resolve/main/buffalo_l/w600k_r50.onnx',
    'https://huggingface.co/LPDoctor/insightface/resolve/main/models/buffalo_l/w600k_r50.onnx',
  ],
};

let detSession: ort.InferenceSession | null = null;
let recSession: ort.InferenceSession | null = null;
let ensureModelsPromise: Promise<void> | null = null;

function getFaceModelDir(): string {
  const dir = path.join(appConfig.localModelsDir, 'insightface-buffalo-l');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function getDetModelPath(): string {
  return path.join(getFaceModelDir(), 'det_10g.onnx');
}

function getRecModelPath(): string {
  return path.join(getFaceModelDir(), 'w600k_r50.onnx');
}

export function areFaceModelsDownloaded(): boolean {
  try {
    const detStat = fs.statSync(getDetModelPath());
    const recStat = fs.statSync(getRecModelPath());
    return detStat.size > 5_000_000 && recStat.size > 50_000_000;
  } catch {
    return false;
  }
}

async function downloadFileAtomic(urls: string[], destPath: string): Promise<void> {
  const partPath = `${destPath}.part`;
  let lastErr: unknown = null;

  for (const url of urls) {
    try {
      const headers: Record<string, string> = {};
      if (appConfig.hfApiToken) {
        headers.Authorization = `Bearer ${appConfig.hfApiToken}`;
      }
      const res = await fetch(url, { headers, redirect: 'follow' });
      if (!res.ok || !res.body) {
        throw new Error(`HTTP ${res.status} downloading ${path.basename(destPath)}`);
      }
      const fileStream = fs.createWriteStream(partPath);
      const nodeStream = Readable.fromWeb(res.body as any);
      await new Promise<void>((resolve, reject) => {
        nodeStream.on('error', (err) => {
          fileStream.destroy();
          reject(err);
        });
        fileStream.on('error', reject);
        fileStream.on('finish', resolve);
        nodeStream.pipe(fileStream);
      });
      fs.renameSync(partPath, destPath);
      return;
    } catch (err) {
      lastErr = err;
      try {
        if (fs.existsSync(partPath)) fs.unlinkSync(partPath);
      } catch {
        // ignore cleanup error
      }
    }
  }

  throw lastErr instanceof Error
    ? lastErr
    : new Error(`Failed to download ${path.basename(destPath)}`);
}

/** Ensures both InsightFace ONNX models (`det_10g.onnx` and `w600k_r50.onnx`) are cached locally. */
export async function ensureFaceModelsReady(): Promise<void> {
  if (areFaceModelsDownloaded() && detSession && recSession) return;
  if (ensureModelsPromise) return ensureModelsPromise;

  ensureModelsPromise = (async () => {
    try {
      if (!fs.existsSync(getDetModelPath()) || fs.statSync(getDetModelPath()).size < 5_000_000) {
        await downloadFileAtomic(MODEL_DOWNLOAD_MIRRORS['det_10g.onnx'], getDetModelPath());
      }
      if (!fs.existsSync(getRecModelPath()) || fs.statSync(getRecModelPath()).size < 50_000_000) {
        await downloadFileAtomic(MODEL_DOWNLOAD_MIRRORS['w600k_r50.onnx'], getRecModelPath());
      }

      if (!detSession) {
        detSession = await ort.InferenceSession.create(getDetModelPath(), {
          executionProviders: ['cpu'],
        });
      }
      if (!recSession) {
        recSession = await ort.InferenceSession.create(getRecModelPath(), {
          executionProviders: ['cpu'],
        });
      }
    } finally {
      ensureModelsPromise = null;
    }
  })();

  return ensureModelsPromise;
}

/**
 * Decodes SCRFD (`det_10g.onnx`) multi-stride outputs dynamically by tensor dimensions
 * (matching row count per stride and column count 1=score, 4=bbox, 10=kps).
 */
function decodeScrfdOutputs(
  outputs: ort.InferenceSession.OnnxValueMapType,
  scale: number,
  imgW: number,
  imgH: number,
  scoreThreshold = 0.45
): DetectedFaceBox[] {
  const strides = [8, 16, 32] as const;
  const numAnchors = 2;
  const tensorList = Object.values(outputs);
  const candidates: DetectedFaceBox[] = [];

  for (const stride of strides) {
    const gridSize = DET_INPUT_SIZE / stride;
    const expectedRows = gridSize * gridSize * numAnchors;

    const findByCols = (cols: number) =>
      tensorList.find((t) => {
        const dims = t.dims;
        if (dims.length === 2) return dims[0] === expectedRows && dims[1] === cols;
        if (dims.length === 3) return dims[1] === expectedRows && dims[2] === cols;
        return false;
      });

    const scoresTensor = findByCols(1);
    const bboxesTensor = findByCols(4);
    const kpsTensor = findByCols(10);
    if (!scoresTensor || !bboxesTensor || !kpsTensor) continue;

    const scores = scoresTensor.data as Float32Array;
    const bboxes = bboxesTensor.data as Float32Array;
    const kps = kpsTensor.data as Float32Array;

    let idx = 0;
    for (let row = 0; row < gridSize; row++) {
      for (let col = 0; col < gridSize; col++) {
        const cx = col * stride;
        const cy = row * stride;
        for (let a = 0; a < numAnchors; a++) {
          const score = scores[idx];
          if (score >= scoreThreshold) {
            const bOff = idx * 4;
            const x1 = Math.max(0, (cx - bboxes[bOff] * stride) / scale);
            const y1 = Math.max(0, (cy - bboxes[bOff + 1] * stride) / scale);
            const x2 = Math.min(imgW, (cx + bboxes[bOff + 2] * stride) / scale);
            const y2 = Math.min(imgH, (cy + bboxes[bOff + 3] * stride) / scale);

            const kOff = idx * 10;
            const landmarks: [number, number][] = [];
            for (let k = 0; k < 5; k++) {
              landmarks.push([
                (cx + kps[kOff + k * 2] * stride) / scale,
                (cy + kps[kOff + k * 2 + 1] * stride) / scale,
              ]);
            }

            if (x2 - x1 >= 12 && y2 - y1 >= 12) {
              candidates.push({ x1, y1, x2, y2, score, landmarks });
            }
          }
          idx++;
        }
      }
    }
  }

  return applyFaceNms(candidates, 0.4);
}

/**
 * Runs SCRFD face detection + 5-point ArcFace alignment + ResNet-50 embedding extraction
 * on an image file path or Buffer. Returns embeddings ordered by prominence (score * area).
 */
export async function extractFaceEmbeddings(
  imageInput: string | Buffer,
  maxFaces = 5
): Promise<Array<{ box: DetectedFaceBox; embedding: Float32Array }>> {
  await ensureFaceModelsReady();
  if (!detSession || !recSession) {
    throw new Error('Face recognition models could not be initialized.');
  }

  // Decode orientation-corrected source image to RGB buffer (cap large originals cleanly to ~1600px)
  const { data: rgbBuffer, info } = await sharp(imageInput)
    .rotate()
    .flatten({ background: { r: 0, g: 0, b: 0 } })
    .resize(1600, 1600, { fit: 'inside', withoutEnlargement: true })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const srcW = info.width;
  const srcH = info.height;
  const scale = Math.min(DET_INPUT_SIZE / srcW, DET_INPUT_SIZE / srcH);
  const resizedW = Math.max(1, Math.round(srcW * scale));
  const resizedH = Math.max(1, Math.round(srcH * scale));

  // Build 640x640 top-left letterboxed RGB tensor for SCRFD
  const { data: detRgb } = await sharp(rgbBuffer, {
    raw: { width: srcW, height: srcH, channels: 3 },
  })
    .resize(resizedW, resizedH)
    .extend({
      top: 0,
      left: 0,
      bottom: Math.max(0, DET_INPUT_SIZE - resizedH),
      right: Math.max(0, DET_INPUT_SIZE - resizedW),
      background: { r: 0, g: 0, b: 0 },
    })
    .raw()
    .toBuffer({ resolveWithObject: true });

  const detPixels = DET_INPUT_SIZE * DET_INPUT_SIZE;
  const detTensorData = new Float32Array(3 * detPixels);
  for (let i = 0; i < detPixels; i++) {
    const p = i * 3;
    detTensorData[i] = (detRgb[p] - 127.5) / 128.0;
    detTensorData[detPixels + i] = (detRgb[p + 1] - 127.5) / 128.0;
    detTensorData[detPixels * 2 + i] = (detRgb[p + 2] - 127.5) / 128.0;
  }

  const detOutputs = await detSession.run({
    [detSession.inputNames[0]]: new ort.Tensor('float32', detTensorData, [
      1,
      3,
      DET_INPUT_SIZE,
      DET_INPUT_SIZE,
    ]),
  });

  const boxes = decodeScrfdOutputs(detOutputs, scale, srcW, srcH, 0.45);
  if (boxes.length === 0) return [];

  // Prioritize large, confident faces first
  boxes.sort((a, b) => {
    const scoreA = a.score * Math.sqrt((a.x2 - a.x1) * (a.y2 - a.y1));
    const scoreB = b.score * Math.sqrt((b.x2 - b.x1) * (b.y2 - b.y1));
    return scoreB - scoreA;
  });

  const results: Array<{ box: DetectedFaceBox; embedding: Float32Array }> = [];
  const recPixels = REC_INPUT_SIZE * REC_INPUT_SIZE;
  const recInputName = recSession.inputNames[0];
  const recOutputName = recSession.outputNames[0];

  for (const box of boxes.slice(0, maxFaces)) {
    const alignedRgb = warpAlignedFace112(rgbBuffer, srcW, srcH, box.landmarks);
    const recTensorData = new Float32Array(3 * recPixels);
    for (let i = 0; i < recPixels; i++) {
      const p = i * 3;
      recTensorData[i] = (alignedRgb[p] - 127.5) / 127.5;
      recTensorData[recPixels + i] = (alignedRgb[p + 1] - 127.5) / 127.5;
      recTensorData[recPixels * 2 + i] = (alignedRgb[p + 2] - 127.5) / 127.5;
    }

    const recOut = await recSession.run({
      [recInputName]: new ort.Tensor('float32', recTensorData, [
        1,
        3,
        REC_INPUT_SIZE,
        REC_INPUT_SIZE,
      ]),
    });

    const rawVec = recOut[recOutputName].data as Float32Array;
    results.push({ box, embedding: l2Normalize(rawVec) });
  }

  return results;
}

/**
 * Synchronizes SQLite face embeddings for all characters using their portrait image
 * plus up to 2 highest-rated confirmed single-face gallery images for angle robustness.
 */
export async function syncCharacterFaceEmbeddings(): Promise<number> {
  const charRows = db
    .prepare('SELECT id, name, portrait_image_id, portrait_content_hash FROM characters')
    .all() as Array<{
    id: number;
    name: string;
    portrait_image_id: number | null;
    portrait_content_hash: string | null;
  }>;

  if (charRows.length === 0) return 0;

  const upsertStmt = db.prepare(`
    INSERT INTO character_face_embeddings
      (character_id, image_id, image_content_hash, source_kind, face_index, embedding_b64, det_score)
    VALUES (?, ?, ?, ?, 0, ?, ?)
    ON CONFLICT(character_id, image_content_hash, face_index) DO UPDATE SET
      image_id = excluded.image_id,
      source_kind = excluded.source_kind,
      embedding_b64 = excluded.embedding_b64,
      det_score = excluded.det_score
  `);

  const hasExistingHashStmt = db.prepare(
    'SELECT 1 FROM character_face_embeddings WHERE character_id = ? AND image_content_hash = ? LIMIT 1'
  );

  for (const charRow of charRows) {
    const candidateSources: Array<{
      imageId: number;
      contentHash: string;
      relativePath: string;
      isUploadedRef: number;
      sourceKind: 'portrait' | 'confirmed';
    }> = [];

    const portraitId = resolveCharacterPortraitId(charRow);
    if (portraitId) {
      const pImg = db
        .prepare(
          'SELECT id, content_hash, relative_path, COALESCE(is_uploaded_reference, 0) AS is_uploaded_reference FROM images WHERE id = ? AND is_missing = 0'
        )
        .get(portraitId) as
        | {
            id: number;
            content_hash: string;
            relative_path: string;
            is_uploaded_reference: number;
          }
        | undefined;

      if (pImg) {
        // Purge stale 'portrait' embeddings if this character switched to a different portrait
        db.prepare(
          `DELETE FROM character_face_embeddings
           WHERE character_id = ? AND source_kind = 'portrait' AND image_content_hash != ?`
        ).run(charRow.id, pImg.content_hash);

        candidateSources.push({
          imageId: pImg.id,
          contentHash: pImg.content_hash,
          relativePath: pImg.relative_path,
          isUploadedRef: pImg.is_uploaded_reference,
          sourceKind: 'portrait',
        });
      }
    }

    // Add up to 2 top-rated confirmed gallery images as extra angle/lighting references
    const confirmedRows = db
      .prepare(
        `SELECT i.id, i.content_hash, i.relative_path, COALESCE(i.is_uploaded_reference, 0) AS is_uploaded_reference
         FROM image_characters ic
         JOIN images i ON i.content_hash = ic.image_content_hash AND i.is_missing = 0
         LEFT JOIN ratings r ON r.content_hash = i.content_hash
         WHERE ic.character_id = ? AND ic.status = 'confirmed'
         ORDER BY i.id = ? DESC, COALESCE(r.rating, 0) DESC, i.file_mtime DESC
         LIMIT 4`
      )
      .all(charRow.id, portraitId || -1) as Array<{
      id: number;
      content_hash: string;
      relative_path: string;
      is_uploaded_reference: number;
    }>;

    let extraCount = 0;
    for (const cImg of confirmedRows) {
      if (candidateSources.some((cs) => cs.contentHash === cImg.content_hash)) continue;
      if (extraCount >= 2) break;
      candidateSources.push({
        imageId: cImg.id,
        contentHash: cImg.content_hash,
        relativePath: cImg.relative_path,
        isUploadedRef: cImg.is_uploaded_reference,
        sourceKind: 'confirmed',
      });
      extraCount++;
    }

    for (const src of candidateSources) {
      const alreadyCached = hasExistingHashStmt.get(charRow.id, src.contentHash);
      if (alreadyCached) continue;

      const diskPath = resolveImageDiskPath({
        relative_path: src.relativePath,
        is_uploaded_reference: src.isUploadedRef,
      });
      if (!fs.existsSync(diskPath)) continue;

      try {
        const faces = await extractFaceEmbeddings(diskPath, src.sourceKind === 'portrait' ? 2 : 3);
        if (faces.length === 0) continue;
        // Skip multi-person confirmed gallery shots so group photos never pollute solo character embeddings
        if (src.sourceKind === 'confirmed' && faces.length > 1) continue;

        const bestFace = faces[0];
        upsertStmt.run(
          charRow.id,
          src.imageId,
          src.contentHash,
          src.sourceKind,
          encodeEmbeddingBase64(bestFace.embedding),
          bestFace.box.score
        );
      } catch (err) {
        console.warn(`Failed to extract face embedding for character #${charRow.id}:`, err);
      }
    }
  }

  const indexedCount = (
    db.prepare('SELECT COUNT(DISTINCT character_id) AS c FROM character_face_embeddings').get() as {
      c: number;
    }
  ).c;
  return indexedCount;
}

/**
 * Matches faces detected in an uploaded image Buffer against all cached character face embeddings.
 */
export async function matchFaceToCharacter(
  imageBuffer: Buffer,
  minSimilarity = DEFAULT_MIN_SIMILARITY
): Promise<{
  matched: boolean;
  characterId: number | null;
  characterName: string | null;
  similarity: number | null;
  facesDetected: number;
  indexedCharactersCount: number;
  bestCandidate: {
    characterId: number;
    characterName: string;
    similarity: number;
  } | null;
}> {
  const indexedCharactersCount = await syncCharacterFaceEmbeddings();
  if (indexedCharactersCount === 0) {
    return {
      matched: false,
      characterId: null,
      characterName: null,
      similarity: null,
      facesDetected: 0,
      indexedCharactersCount: 0,
      bestCandidate: null,
    };
  }

  const probeFaces = await extractFaceEmbeddings(imageBuffer, 5);
  if (probeFaces.length === 0) {
    return {
      matched: false,
      characterId: null,
      characterName: null,
      similarity: null,
      facesDetected: 0,
      indexedCharactersCount,
      bestCandidate: null,
    };
  }

  const refRows = db
    .prepare(
      `SELECT e.character_id, c.name AS character_name, e.embedding_b64
       FROM character_face_embeddings e
       JOIN characters c ON c.id = e.character_id`
    )
    .all() as Array<{
    character_id: number;
    character_name: string;
    embedding_b64: string;
  }>;

  // Group decoded reference embeddings by character ID
  const refsByChar = new Map<number, { name: string; vectors: Float32Array[] }>();
  for (const row of refRows) {
    let entry = refsByChar.get(row.character_id);
    if (!entry) {
      entry = { name: row.character_name, vectors: [] };
      refsByChar.set(row.character_id, entry);
    }
    entry.vectors.push(decodeEmbeddingBase64(row.embedding_b64));
  }

  let bestCandidate: {
    characterId: number;
    characterName: string;
    similarity: number;
  } | null = null;

  for (const probe of probeFaces) {
    for (const [charId, refEntry] of refsByChar.entries()) {
      let charBestSim = -1;
      for (const refVec of refEntry.vectors) {
        const sim = cosineSimilarity(probe.embedding, refVec);
        if (sim > charBestSim) charBestSim = sim;
      }

      if (!bestCandidate || charBestSim > bestCandidate.similarity) {
        bestCandidate = {
          characterId: charId,
          characterName: refEntry.name,
          similarity: Math.round(charBestSim * 1000) / 1000,
        };
      }
    }
  }

  const matched = Boolean(bestCandidate && bestCandidate.similarity >= minSimilarity);
  return {
    matched,
    characterId: matched && bestCandidate ? bestCandidate.characterId : null,
    characterName: matched && bestCandidate ? bestCandidate.characterName : null,
    similarity: bestCandidate ? bestCandidate.similarity : null,
    facesDetected: probeFaces.length,
    indexedCharactersCount,
    bestCandidate,
  };
}
