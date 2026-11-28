import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import sharp from 'sharp';
import { db } from '../../db.ts';
import { appConfig } from '../../config.ts';
import { pathExistsAsync } from '../fsWalkService.ts';
import { getBoolSetting, setBoolSetting } from '../settingsService.ts';
import { invalidateStorageUsageStatsCache } from '../storageStatsService.ts';

export const SUPPORTED_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp']);

let isThumbnailMigrationRunning = false;

/**
 * Computes SHA-256 hash of a file without modifying it.
 */
export function computeFileSha256(filePath: string): string {
  const hash = crypto.createHash('sha256');
  const data = fs.readFileSync(filePath);
  hash.update(data);
  return hash.digest('hex');
}

/**
 * Generates a WebP thumbnail (384px max on the long side) in data/thumbnails.
 */
export async function ensureWebpThumbnail(
  sourceFile: string,
  contentHash: string,
  forceOverwrite = false
): Promise<{
  thumbPath: string | null;
  width: number;
  height: number;
  format: string;
}> {
  fs.mkdirSync(appConfig.thumbnailPath, { recursive: true });
  const thumbFile = path.join(appConfig.thumbnailPath, `${contentHash}.webp`);
  try {
    const metadata = await sharp(sourceFile).metadata();
    const width = metadata.width || 0;
    const height = metadata.height || 0;
    if (width <= 0 || height <= 0) {
      return { thumbPath: null, width: 0, height: 0, format: 'PNG' };
    }
    const format = (metadata.format || path.extname(sourceFile).slice(1)).toUpperCase();

    const thumbExisted = await pathExistsAsync(thumbFile);
    if (forceOverwrite || !thumbExisted) {
      await sharp(sourceFile)
        .resize({ width: 384, height: 384, fit: 'inside', withoutEnlargement: true })
        .webp({ quality: 80 })
        .toFile(thumbFile);
      invalidateStorageUsageStatsCache();
    }
    return { thumbPath: thumbFile, width, height, format };
  } catch {
    return { thumbPath: null, width: 0, height: 0, format: 'PNG' };
  }
}

/**
 * Resolves the absolute disk path for an indexed image row, routing uploaded prompt
 * inspiration references to `appConfig.uploadedImagesDir` and generated outputs to `comfyuiOutputDir`.
 */
export function resolveImageDiskPath(row: {
  relative_path: string;
  is_uploaded_reference?: number | boolean | null;
}): string {
  const rel = String(row.relative_path || '');
  if (row.is_uploaded_reference || rel.startsWith('__uploaded__/')) {
    return path.resolve(appConfig.uploadedImagesDir, path.basename(rel));
  }
  return path.resolve(appConfig.comfyuiOutputDir, rel);
}

/**
 * Indexes a saved 1MP uploaded prompt image from `appConfig.uploadedImagesDir` into `images`
 * (`is_uploaded_reference = 1`) so it can be injected as the inspiration step (#0) of a new stack.
 */
export async function indexUploadedInspirationImage(
  filename: string,
  positivePrompt?: string | null
): Promise<number | null> {
  const safeName = path.basename(String(filename || '').trim());
  if (!safeName) return null;

  const fullPath = path.resolve(appConfig.uploadedImagesDir, safeName);
  const uploadedRoot = path.resolve(appConfig.uploadedImagesDir);
  if (!fullPath.startsWith(uploadedRoot + path.sep)) {
    return null;
  }

  const stat = await fs.promises.stat(fullPath).catch(() => null);
  if (!stat || !stat.isFile() || stat.size <= 0) return null;

  const relativePath = `__uploaded__/${safeName}`;
  const existing = db
    .prepare('SELECT id FROM images WHERE relative_path = ? LIMIT 1')
    .get(relativePath) as { id: number } | undefined;
  if (existing) {
    return existing.id;
  }

  const contentHash = computeFileSha256(fullPath);
  const { thumbPath, width, height, format } = await ensureWebpThumbnail(fullPath, contentHash);
  if (width <= 0 || height <= 0 || !thumbPath) {
    return null;
  }

  const mtimeIso = stat.mtime.toISOString();
  const cleanPrompt = (positivePrompt || '').trim() || null;

  const imageId = db.transaction(() => {
    const info = db
      .prepare(
        `INSERT INTO images
          (content_hash, relative_path, filename, file_size, width, height, format, file_mtime, is_missing, thumbnail_path, dependency_status, is_uploaded_reference)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, 'ready', 1)`
      )
      .run(
        contentHash,
        relativePath,
        safeName,
        stat.size,
        width,
        height,
        format,
        mtimeIso,
        thumbPath
      );
    const id = Number(info.lastInsertRowid);

    db.prepare('INSERT OR IGNORE INTO ratings (content_hash, image_id) VALUES (?, ?)').run(
      contentHash,
      id
    );

    db.prepare(
      `INSERT INTO image_metadata (
        image_id, positive_prompt, missing_fields_json, provenance_json, raw_metadata_json
      ) VALUES (?, ?, '[]', '{"source":"uploaded_inspiration"}', '{}')`
    ).run(id, cleanPrompt);

    return id;
  })();

  invalidateStorageUsageStatsCache();
  return imageId;
}

const LOCAL_INSPIRATION_MAX_PIXELS = 1_000_000;

/**
 * Creates (or reuses by content hash) a 1MP JPEG inspiration reference in `appConfig.uploadedImagesDir`
 * from an existing local gallery image, then indexes it with `is_uploaded_reference = 1` so it can be
 * attached as step #0 (`Inspo`) of a new generation stack without modifying the source image's stack.
 */
export async function createUploadedInspirationFromImageId(
  sourceImageId: number,
  positivePrompt?: string | null
): Promise<number | null> {
  const numericId = Number(sourceImageId);
  if (!Number.isInteger(numericId) || numericId <= 0) return null;

  const row = db
    .prepare(
      `SELECT id, content_hash, relative_path, COALESCE(is_uploaded_reference, 0) AS is_uploaded_reference
       FROM images
       WHERE id = ? AND is_missing = 0
       LIMIT 1`
    )
    .get(numericId) as
    | {
        id: number;
        content_hash: string;
        relative_path: string;
        is_uploaded_reference: number;
      }
    | undefined;

  if (!row) return null;

  // Source image is already an uploaded 1MP inspiration reference — reuse directly
  if (row.is_uploaded_reference) {
    return row.id;
  }

  const diskPath = resolveImageDiskPath(row);
  const outputRoot = path.resolve(appConfig.comfyuiOutputDir);
  if (!diskPath.startsWith(outputRoot + path.sep)) {
    return null;
  }

  const hashPrefix = String(row.content_hash || '')
    .replace(/[^a-fA-F0-9]/g, '')
    .slice(0, 16);
  if (!hashPrefix) return null;

  const inspoFilename = `reuse-1mp-${hashPrefix}.jpg`;
  const targetPath = path.resolve(appConfig.uploadedImagesDir, inspoFilename);
  const uploadedRoot = path.resolve(appConfig.uploadedImagesDir);
  if (!targetPath.startsWith(uploadedRoot + path.sep)) {
    return null;
  }

  if (!(await pathExistsAsync(targetPath))) {
    if (!(await pathExistsAsync(diskPath))) return null;
    try {
      const { data: rotatedBuf, info: rotatedInfo } = await sharp(diskPath)
        .rotate()
        .toBuffer({ resolveWithObject: true });
      const srcW = Number(rotatedInfo.width || 0);
      const srcH = Number(rotatedInfo.height || 0);
      if (srcW <= 0 || srcH <= 0) return null;

      let pipeline = sharp(rotatedBuf);
      const totalPixels = srcW * srcH;
      if (totalPixels > LOCAL_INSPIRATION_MAX_PIXELS) {
        const scale = Math.sqrt(LOCAL_INSPIRATION_MAX_PIXELS / totalPixels);
        const outW = Math.max(1, Math.round(srcW * scale));
        const outH = Math.max(1, Math.round(srcH * scale));
        pipeline = pipeline.resize(outW, outH, { fit: 'inside', withoutEnlargement: true });
      }

      const outBuf = await pipeline.jpeg({ quality: 88, mozjpeg: true }).toBuffer();
      if (outBuf.length === 0) return null;

      fs.mkdirSync(appConfig.uploadedImagesDir, { recursive: true });
      fs.writeFileSync(targetPath, outBuf);
      invalidateStorageUsageStatsCache();
    } catch {
      return null;
    }
  }

  return indexUploadedInspirationImage(inspoFilename, positivePrompt);
}

/**
 * Background migration that ensures all indexed images have a 384px long-side WebP
 * thumbnail inside `data/thumbnails`, yielding between files so requests are never blocked.
 */
export async function runBackgroundThumbnailMigration(): Promise<void> {
  if (isThumbnailMigrationRunning) return;
  isThumbnailMigrationRunning = true;

  try {
    const forceRebuildAll = !getBoolSetting('thumb_migration_384_v1', false);

    const rows = db
      .prepare(
        `SELECT id, content_hash, relative_path, thumbnail_path, COALESCE(is_uploaded_reference, 0) AS is_uploaded_reference
         FROM images
         WHERE is_missing = 0
         ORDER BY id DESC`
      )
      .all() as {
      id: number;
      content_hash: string;
      relative_path: string;
      thumbnail_path: string | null;
      is_uploaded_reference: number;
    }[];

    const updateStmt = db.prepare('UPDATE images SET thumbnail_path = ? WHERE id = ?');

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const expectedThumb = path.join(appConfig.thumbnailPath, `${row.content_hash}.webp`);
      const thumbExists = fs.existsSync(expectedThumb);

      if (forceRebuildAll || !thumbExists || row.thumbnail_path !== expectedThumb) {
        const origPath = resolveImageDiskPath(row);
        if (fs.existsSync(origPath)) {
          const { thumbPath } = await ensureWebpThumbnail(origPath, row.content_hash, forceRebuildAll);
          if (thumbPath && row.thumbnail_path !== thumbPath) {
            updateStmt.run(thumbPath, row.id);
          }
        }
        // Yield to event loop after each generated thumbnail
        await new Promise((resolve) => setImmediate(resolve));
      } else if (i % 50 === 0) {
        await new Promise((resolve) => setImmediate(resolve));
      }
    }

    if (forceRebuildAll) {
      setBoolSetting('thumb_migration_384_v1', true);
    }
  } catch (err) {
    console.error('Background thumbnail migration error:', err);
  } finally {
    isThumbnailMigrationRunning = false;
  }
}
