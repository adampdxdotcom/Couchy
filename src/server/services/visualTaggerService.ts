import fs from 'fs';
import path from 'path';
import { Readable } from 'stream';
import sharp from 'sharp';
import * as ort from 'onnxruntime-node';
import { db } from '../db.ts';
import { appConfig } from '../config.ts';
import type { VisualTagItem, VisualTaggerStatus } from '../../shared/types.ts';

const HF_MODEL_URL =
  'https://huggingface.co/SmilingWolf/wd-vit-tagger-v3/resolve/main/model.onnx';
const HF_TAGS_URL =
  'https://huggingface.co/SmilingWolf/wd-vit-tagger-v3/resolve/main/selected_tags.csv';

const INPUT_SIZE = 448;

interface TagDefinition {
  name: string;
  category: number;
}

// Runtime state for lazy model download and background indexing queue
let isDownloading = false;
let downloadedBytes = 0;
let totalDownloadBytes = 0;
let downloadError: string | null = null;

let isScanning = false;
let isPaused = false;
let lastError: string | null = null;
let activeProvider = 'cpu';

let ortSession: ort.InferenceSession | null = null;
let loadedSessionDevice: 'cpu' | 'gpu' | null = null;
let tagDefinitions: TagDefinition[] | null = null;

/**
 * Resolves the directory inside data/local_models where the WD14 ONNX files live.
 */
function getTaggerModelDir(): string {
  const dir = path.join(appConfig.localModelsDir, 'wd-vit-tagger-v3');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function getModelOnnxPath(): string {
  return path.join(getTaggerModelDir(), 'model.onnx');
}

function getTagsCsvPath(): string {
  return path.join(getTaggerModelDir(), 'selected_tags.csv');
}

/**
 * Checks whether both model.onnx and selected_tags.csv are present on disk.
 */
export function isTaggerModelDownloaded(): boolean {
  try {
    const onnxStat = fs.statSync(getModelOnnxPath());
    const csvStat = fs.statSync(getTagsCsvPath());
    return onnxStat.size > 10_000_000 && csvStat.size > 10_000;
  } catch {
    return false;
  }
}

/**
 * Reads or initializes visual tagger settings from app_settings.
 */
export function getTaggerSettings(): {
  enabled: boolean;
  threshold: number;
  device: 'cpu' | 'gpu';
} {
  const rows = db
    .prepare(
      "SELECT key, value FROM app_settings WHERE key IN ('visual_tagger_enabled', 'visual_tagger_threshold', 'visual_tagger_device')"
    )
    .all() as { key: string; value: string }[];

  const map = new Map(rows.map((r) => [r.key, r.value]));
  const enabled = map.get('visual_tagger_enabled') === 'true';
  const rawThreshold = parseFloat(map.get('visual_tagger_threshold') || '0.35');
  const threshold = Number.isNaN(rawThreshold)
    ? 0.35
    : Math.max(0.1, Math.min(0.95, rawThreshold));
  const device = map.get('visual_tagger_device') === 'gpu' ? 'gpu' : 'cpu';

  return { enabled, threshold, device };
}

/**
 * Persists a single setting in app_settings.
 */
function setAppSetting(key: string, value: string): void {
  db.prepare(
    `
    INSERT INTO app_settings (key, value, updated_at)
    VALUES (?, ?, datetime('now'))
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')
  `
  ).run(key, value);
}

/**
 * Streams a remote file to disk atomically using a .part temporary file.
 */
async function downloadFileWithProgress(
  url: string,
  destPath: string,
  onBytes: (chunkBytes: number, contentLength: number) => void
): Promise<void> {
  const partPath = `${destPath}.part`;
  const headers: Record<string, string> = {};
  if (appConfig.hfApiToken) {
    headers.Authorization = `Bearer ${appConfig.hfApiToken}`;
  }

  const res = await fetch(url, { headers, redirect: 'follow' });
  if (!res.ok || !res.body) {
    throw new Error(`Failed to download ${path.basename(destPath)} (HTTP ${res.status})`);
  }

  const contentLength = Number(res.headers.get('content-length') || 0);
  const fileStream = fs.createWriteStream(partPath);
  const nodeStream = Readable.fromWeb(res.body as any);

  await new Promise<void>((resolve, reject) => {
    nodeStream.on('data', (chunk: Buffer) => {
      onBytes(chunk.length, contentLength);
    });
    nodeStream.on('error', (err) => {
      fileStream.destroy();
      reject(err);
    });
    fileStream.on('error', reject);
    fileStream.on('finish', resolve);
    nodeStream.pipe(fileStream);
  });

  fs.renameSync(partPath, destPath);
}

/**
 * Downloads selected_tags.csv and model.onnx into data/local_models/wd-vit-tagger-v3/ if not present.
 */
export async function ensureTaggerModelDownloaded(): Promise<boolean> {
  if (isTaggerModelDownloaded()) return true;
  if (isDownloading) return false;

  isDownloading = true;
  downloadedBytes = 0;
  totalDownloadBytes = 365_000_000; // Approx 365 MB until headers arrive
  downloadError = null;

  try {
    const csvPath = getTagsCsvPath();
    const onnxPath = getModelOnnxPath();

    // 1. Download selected_tags.csv first (~300 KB)
    if (!fs.existsSync(csvPath) || fs.statSync(csvPath).size < 10_000) {
      await downloadFileWithProgress(HF_TAGS_URL, csvPath, (chunk) => {
        downloadedBytes += chunk;
      });
    }

    // 2. Download model.onnx (~360 MB)
    if (!fs.existsSync(onnxPath) || fs.statSync(onnxPath).size < 10_000_000) {
      let onnxExpectedSet = false;
      await downloadFileWithProgress(HF_MODEL_URL, onnxPath, (chunk, total) => {
        if (!onnxExpectedSet && total > 0) {
          totalDownloadBytes = downloadedBytes + total;
          onnxExpectedSet = true;
        }
        downloadedBytes += chunk;
      });
    }

    tagDefinitions = null;
    ortSession = null;
    return true;
  } catch (err: any) {
    downloadError = err?.message || 'Failed to download WD14 tagger model';
    return false;
  } finally {
    isDownloading = false;
  }
}

/**
 * Parses selected_tags.csv and caches the ordered tag list matching model output logits.
 */
function loadTagDefinitions(): TagDefinition[] {
  if (tagDefinitions) return tagDefinitions;

  const raw = fs.readFileSync(getTagsCsvPath(), 'utf-8');
  const lines = raw.split(/\r?\n/).filter((l) => l.trim().length > 0);
  // Skip CSV header: tag_id,name,category,count
  const parsed: TagDefinition[] = [];
  for (let i = 1; i < lines.length; i++) {
    const parts = lines[i].split(',');
    if (parts.length >= 3) {
      const rawName = parts[1].trim().replace(/_/g, ' ');
      const category = parseInt(parts[2].trim(), 10) || 0;
      parsed.push({ name: rawName, category });
    }
  }
  tagDefinitions = parsed;
  return parsed;
}

/**
 * Initializes or returns the cached ONNX Runtime session.
 * Attempts CUDA execution provider first when device === 'gpu', falling back cleanly to CPU.
 */
async function getOrCreateSession(device: 'cpu' | 'gpu'): Promise<ort.InferenceSession> {
  if (ortSession && loadedSessionDevice === device) {
    return ortSession;
  }

  const modelPath = getModelOnnxPath();
  if (device === 'gpu') {
    try {
      ortSession = await ort.InferenceSession.create(modelPath, {
        executionProviders: ['cuda', 'cpu'],
      });
      loadedSessionDevice = 'gpu';
      activeProvider = 'cuda (with cpu fallback)';
      return ortSession;
    } catch {
      // Fallback to CPU if CUDA provider is unavailable in container
    }
  }

  ortSession = await ort.InferenceSession.create(modelPath, {
    executionProviders: ['cpu'],
  });
  loadedSessionDevice = device;
  activeProvider = 'cpu';
  return ortSession;
}

/**
 * Preprocesses an image file path or Buffer into a [1, 448, 448, 3] Float32 BGR tensor expected by WD14 v3.
 */
async function preprocessImageToTensor(imageInput: string | Buffer): Promise<ort.Tensor> {
  const { data } = await sharp(imageInput)
    .flatten({ background: { r: 255, g: 255, b: 255 } })
    .resize(INPUT_SIZE, INPUT_SIZE, {
      fit: 'contain',
      background: { r: 255, g: 255, b: 255 },
    })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const floatData = new Float32Array(INPUT_SIZE * INPUT_SIZE * 3);
  const pixelCount = INPUT_SIZE * INPUT_SIZE;

  // Convert RGB uint8 to BGR float32 [0..255]
  for (let i = 0; i < pixelCount; i++) {
    const offset = i * 3;
    const r = data[offset];
    const g = data[offset + 1];
    const b = data[offset + 2];
    floatData[offset] = b;
    floatData[offset + 1] = g;
    floatData[offset + 2] = r;
  }

  return new ort.Tensor('float32', floatData, [1, INPUT_SIZE, INPUT_SIZE, 3]);
}

/**
 * Runs WD14 v3 ONNX inference directly on an in-memory image Buffer (for on-demand image interrogation)
 * without requiring the image to be indexed in the gallery database.
 */
export async function interrogateImageBufferWithWd14(
  imageBuffer: Buffer,
  customThreshold?: number
): Promise<VisualTagItem[]> {
  if (!isTaggerModelDownloaded()) {
    const ok = await ensureTaggerModelDownloaded();
    if (!ok) {
      throw new Error(downloadError || 'Failed to download local WD14 ONNX tagger model.');
    }
  }

  const settings = getTaggerSettings();
  const threshold = customThreshold ?? Math.min(settings.threshold, 0.3);

  const session = await getOrCreateSession(settings.device);
  const tagsList = loadTagDefinitions();
  const inputTensor = await preprocessImageToTensor(imageBuffer);

  const inputName = session.inputNames[0];
  const outputName = session.outputNames[0];
  const results = await session.run({ [inputName]: inputTensor });
  const probs = results[outputName].data as Float32Array;

  const matched: VisualTagItem[] = [];
  const limit = Math.min(probs.length, tagsList.length);

  for (let i = 0; i < limit; i++) {
    const def = tagsList[i];
    if (def.category === 9) continue; // skip general/sensitive/explicit meta-rating category
    const score = probs[i];
    if (score >= threshold) {
      matched.push({
        tag: def.name.replace(/_/g, ' '),
        confidence: Math.round(score * 1000) / 1000,
      });
    }
  }

  matched.sort((a, b) => b.confidence - a.confidence);
  return matched.slice(0, 45);
}

/**
 * Resolves the fastest readable image path for tagging (prefers WebP thumbnail, falls back to original file).
 */
function resolveReadableImagePath(imgRow: {
  relative_path: string;
  thumbnail_path: string | null;
}): string | null {
  if (imgRow.thumbnail_path) {
    const thumbAbs = path.isAbsolute(imgRow.thumbnail_path)
      ? imgRow.thumbnail_path
      : path.join(appConfig.thumbnailPath, path.basename(imgRow.thumbnail_path));
    if (fs.existsSync(thumbAbs)) return thumbAbs;
  }

  const origAbs = path.join(appConfig.comfyuiOutputDir, imgRow.relative_path);
  if (fs.existsSync(origAbs)) return origAbs;

  return null;
}

/**
 * Runs WD14 ONNX inference on a single image row and persists extracted visual tags to SQLite.
 */
export async function tagSingleImageById(
  imageId: number,
  forceEvenIfDisabled = false
): Promise<VisualTagItem[]> {
  const settings = getTaggerSettings();
  if (!settings.enabled && !forceEvenIfDisabled) return [];

  if (!isTaggerModelDownloaded()) {
    const ok = await ensureTaggerModelDownloaded();
    if (!ok) return [];
  }

  const imgRow = db
    .prepare(
      'SELECT id, content_hash, relative_path, thumbnail_path FROM images WHERE id = ? AND is_missing = 0'
    )
    .get(imageId) as
    | { id: number; content_hash: string; relative_path: string; thumbnail_path: string | null }
    | undefined;

  if (!imgRow) return [];

  const readablePath = resolveReadableImagePath(imgRow);
  if (!readablePath) {
    db.prepare("UPDATE images SET visual_tags_scanned_at = datetime('now') WHERE id = ?").run(
      imgRow.id
    );
    return [];
  }

  const session = await getOrCreateSession(settings.device);
  const tagsList = loadTagDefinitions();
  const inputTensor = await preprocessImageToTensor(readablePath);

  const inputName = session.inputNames[0];
  const outputName = session.outputNames[0];
  const results = await session.run({ [inputName]: inputTensor });
  const probs = results[outputName].data as Float32Array;

  const matched: VisualTagItem[] = [];
  const limit = Math.min(probs.length, tagsList.length);

  for (let i = 0; i < limit; i++) {
    const def = tagsList[i];
    // Skip category 9 (rating tags like general/sensitive/questionable/explicit)
    if (def.category === 9) continue;
    const score = probs[i];
    if (score >= settings.threshold) {
      matched.push({
        tag: def.name,
        confidence: Math.round(score * 1000) / 1000,
      });
    }
  }

  // Sort by highest confidence first and cap at top 45 visual tags per image
  matched.sort((a, b) => b.confidence - a.confidence);
  const topTags = matched.slice(0, 45);

  const saveTx = db.transaction(() => {
    db.prepare('DELETE FROM image_visual_tags WHERE image_content_hash = ?').run(
      imgRow.content_hash
    );
    const ins = db.prepare(`
      INSERT INTO image_visual_tags (image_content_hash, image_id, tag, confidence)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(image_content_hash, tag) DO UPDATE SET
        confidence = excluded.confidence,
        image_id = excluded.image_id
    `);
    for (const item of topTags) {
      ins.run(imgRow.content_hash, imgRow.id, item.tag, item.confidence);
    }
    db.prepare("UPDATE images SET visual_tags_scanned_at = datetime('now') WHERE id = ?").run(
      imgRow.id
    );
  });
  saveTx();

  return topTags;
}

/**
 * Background worker loop that processes unindexed images non-blockingly.
 */
export async function startVisualTaggerQueue(): Promise<void> {
  if (isScanning) return;

  const settings = getTaggerSettings();
  if (!settings.enabled) return;

  isScanning = true;
  isPaused = false;
  lastError = null;

  try {
    if (!isTaggerModelDownloaded()) {
      const ok = await ensureTaggerModelDownloaded();
      if (!ok) {
        isScanning = false;
        return;
      }
    }

    while (true) {
      const currentSettings = getTaggerSettings();
      if (!currentSettings.enabled || isPaused) {
        break;
      }

      const nextRow = db
        .prepare(
          'SELECT id FROM images WHERE visual_tags_scanned_at IS NULL AND is_missing = 0 ORDER BY id DESC LIMIT 1'
        )
        .get() as { id: number } | undefined;

      if (!nextRow) {
        break;
      }

      try {
        await tagSingleImageById(nextRow.id);
      } catch (err: any) {
        lastError = err?.message || `Error tagging image #${nextRow.id}`;
        // Mark scanned so one corrupt image never blocks the entire queue
        db.prepare("UPDATE images SET visual_tags_scanned_at = datetime('now') WHERE id = ?").run(
          nextRow.id
        );
      }

      // Yield briefly to keep Express API and SQLite responsive
      await new Promise((r) => setTimeout(r, 25));
    }
  } finally {
    isScanning = false;
  }
}

/**
 * Updates tagger configuration and starts or stops the background queue accordingly.
 */
export function updateVisualTaggerConfig(params: {
  enabled?: boolean;
  threshold?: number;
  device?: 'cpu' | 'gpu';
}): VisualTaggerStatus {
  if (params.enabled !== undefined) {
    setAppSetting('visual_tagger_enabled', params.enabled ? 'true' : 'false');
    if (params.enabled) {
      isPaused = false;
      setTimeout(() => {
        startVisualTaggerQueue().catch(() => {});
      }, 10);
    } else {
      isPaused = true;
    }
  }

  if (params.threshold !== undefined && !Number.isNaN(Number(params.threshold))) {
    const clamped = Math.max(0.1, Math.min(0.95, Number(params.threshold)));
    setAppSetting('visual_tagger_threshold', String(clamped));
  }

  if (params.device === 'cpu' || params.device === 'gpu') {
    setAppSetting('visual_tagger_device', params.device);
    ortSession = null; // Reset session so next inference picks up new device preference
  }

  return getVisualTaggerStatus();
}

/**
 * Pauses or resumes the background visual tagger queue, or resets scanned timestamps for a full rescan.
 */
export function controlVisualTaggerQueue(
  action: 'pause' | 'resume' | 'scan_unindexed' | 'rescan_all'
): VisualTaggerStatus {
  if (action === 'pause') {
    isPaused = true;
  } else if (action === 'resume' || action === 'scan_unindexed') {
    isPaused = false;
    setTimeout(() => {
      startVisualTaggerQueue().catch(() => {});
    }, 10);
  } else if (action === 'rescan_all') {
    db.prepare('UPDATE images SET visual_tags_scanned_at = NULL').run();
    isPaused = false;
    setTimeout(() => {
      startVisualTaggerQueue().catch(() => {});
    }, 10);
  }
  return getVisualTaggerStatus();
}

/**
 * Returns live status and counts for the System settings UI.
 */
export function getVisualTaggerStatus(): VisualTaggerStatus {
  const settings = getTaggerSettings();
  const totalImagesCount = (
    db.prepare('SELECT COUNT(*) as c FROM images WHERE is_missing = 0').get() as { c: number }
  ).c;
  const scannedCount = (
    db
      .prepare(
        'SELECT COUNT(*) as c FROM images WHERE is_missing = 0 AND visual_tags_scanned_at IS NOT NULL'
      )
      .get() as { c: number }
  ).c;
  const totalVisualTagsCount = (
    db.prepare('SELECT COUNT(*) as c FROM image_visual_tags').get() as { c: number }
  ).c;

  const progressPct =
    totalDownloadBytes > 0
      ? Math.min(100, Math.round((downloadedBytes / totalDownloadBytes) * 100))
      : 0;

  return {
    enabled: settings.enabled,
    threshold: settings.threshold,
    device: settings.device,
    activeProvider,
    localModelsDir: getTaggerModelDir(),
    modelDownloaded: isTaggerModelDownloaded(),
    isDownloading,
    downloadProgressPercent: progressPct,
    downloadedBytes,
    totalDownloadBytes,
    downloadError,
    isScanning,
    isPaused,
    scannedCount,
    totalImagesCount,
    pendingCount: Math.max(0, totalImagesCount - scannedCount),
    totalVisualTagsCount,
    lastError,
  };
}

/**
 * Removes a single visual keyword from an image by content hash or image ID.
 */
export function removeVisualTagFromImage(imageId: number, tag: string): VisualTagItem[] {
  const row = db
    .prepare('SELECT content_hash FROM images WHERE id = ?')
    .get(imageId) as { content_hash: string } | undefined;
  if (!row) return [];

  db.prepare(
    'DELETE FROM image_visual_tags WHERE image_content_hash = ? AND LOWER(tag) = LOWER(?)'
  ).run(row.content_hash, tag.trim());

  return getVisualTagsForContentHash(row.content_hash);
}

/**
 * Queries stored visual keywords for a given image content hash.
 */
export function getVisualTagsForContentHash(contentHash: string): VisualTagItem[] {
  return db
    .prepare(
      'SELECT tag, confidence FROM image_visual_tags WHERE image_content_hash = ? ORDER BY confidence DESC'
    )
    .all(contentHash) as VisualTagItem[];
}
