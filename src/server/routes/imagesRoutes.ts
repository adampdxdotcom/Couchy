import { Router } from 'express';
import fs from 'fs';
import path from 'path';
import * as archiverPkg from 'archiver';
import { db } from '../db.ts';

const createZipArchive = ((archiverPkg as any).default || archiverPkg) as (
  format: 'zip',
  options?: archiverPkg.ArchiverOptions
) => archiverPkg.Archiver;
import { appConfig } from '../config.ts';
import { hydrateImageRecords, queryGalleryImages } from '../services/galleryQueryService.ts';
import { ensureWebpThumbnail } from '../services/scannerService.ts';
import type { GalleryFilterState } from '../../shared/types.ts';

export const imagesRouter = Router();

/**
 * POST /api/images/query
 * Returns filtered, sorted ImageRecords.
 */
imagesRouter.post('/query', (req, res) => {
  try {
    const filters = (req.body || {}) as Partial<GalleryFilterState>;
    const items = queryGalleryImages(filters);
    res.json({ items, total: items.length });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || 'Failed to query images' });
  }
});

/**
 * GET /api/images/:id
 * Returns full details, embedded raw metadata, and workflow JSONs for a single image.
 */
imagesRouter.get('/:id', (req, res) => {
  try {
    const id = Number(req.params.id);
    const row = db
      .prepare(
        `
        SELECT
          i.*,
          r.rating, r.is_favorite, r.is_rejected, r.is_archived, r.notes, r.favorited_at,
          m.positive_prompt, m.negative_prompt, m.seed, m.steps, m.cfg, m.sampler,
          m.scheduler, m.denoise, m.batch_size, m.batch_index, m.generation_date,
          m.checkpoint_name, m.checkpoint_hash, m.vae_name, m.missing_fields_json,
          m.provenance_json, m.raw_metadata_json
        FROM images i
        LEFT JOIN ratings r ON r.content_hash = i.content_hash
        LEFT JOIN image_metadata m ON m.image_id = i.id
        WHERE i.id = ?
      `
      )
      .get(id) as any;

    if (!row) {
      res.status(404).json({ error: 'Image not found' });
      return;
    }

    const hydrated = hydrateImageRecords([row])[0];
    const wf = db
      .prepare(
        `SELECT w.* FROM image_workflows iw
         JOIN workflows w ON w.id = iw.workflow_id
         WHERE iw.image_id = ? LIMIT 1`
      )
      .get(id) as any;

    let rawMetadata = {};
    try {
      rawMetadata = JSON.parse(row.raw_metadata_json || '{}');
    } catch {
      rawMetadata = {};
    }

    res.json({
      image: hydrated,
      rawMetadata,
      visualWorkflowJson: wf?.visual_workflow_json || null,
      apiWorkflowJson: wf?.api_workflow_json || null,
    });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || 'Failed to load image details' });
  }
});

/**
 * GET /api/images/:id/thumbnail
 * Serves the 384px long-side WebP thumbnail from data/thumbnails (generating it on-demand if missing)
 * with immutable browser cache headers.
 */
imagesRouter.get('/:id/thumbnail', async (req, res) => {
  const id = Number(req.params.id);
  const row = db
    .prepare('SELECT id, content_hash, relative_path, thumbnail_path FROM images WHERE id = ?')
    .get(id) as
    | { id: number; content_hash: string; relative_path: string; thumbnail_path: string | null }
    | undefined;

  if (!row) {
    res.status(404).end();
    return;
  }

  const expectedThumbPath = path.join(appConfig.thumbnailPath, `${row.content_hash}.webp`);

  if (fs.existsSync(expectedThumbPath)) {
    if (row.thumbnail_path !== expectedThumbPath) {
      db.prepare('UPDATE images SET thumbnail_path = ? WHERE id = ?').run(expectedThumbPath, row.id);
    }
    res.setHeader('Content-Type', 'image/webp');
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    res.sendFile(path.resolve(expectedThumbPath));
    return;
  }

  const origPath = path.resolve(appConfig.comfyuiOutputDir, row.relative_path);
  if (fs.existsSync(origPath)) {
    const { thumbPath } = await ensureWebpThumbnail(origPath, row.content_hash);
    if (thumbPath && fs.existsSync(thumbPath)) {
      db.prepare('UPDATE images SET thumbnail_path = ? WHERE id = ?').run(thumbPath, row.id);
      res.setHeader('Content-Type', 'image/webp');
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      res.sendFile(path.resolve(thumbPath));
      return;
    }
    res.sendFile(origPath);
    return;
  }
  res.status(404).end();
});

/**
 * GET /api/images/:id/file
 * Serves the unaltered original image file (supports ?download=1 for attachment).
 */
imagesRouter.get('/:id/file', (req, res) => {
  const id = Number(req.params.id);
  const row = db
    .prepare('SELECT relative_path, filename FROM images WHERE id = ?')
    .get(id) as { relative_path: string; filename: string } | undefined;

  if (!row) {
    res.status(404).json({ error: 'Image not found' });
    return;
  }

  const origPath = path.resolve(appConfig.comfyuiOutputDir, row.relative_path);
  if (!fs.existsSync(origPath)) {
    res.status(404).json({ error: 'Original file missing on disk' });
    return;
  }

  if (req.query.download === '1') {
    res.download(origPath, row.filename);
    return;
  }
  res.sendFile(origPath);
});

/**
 * PATCH /api/images/:id/annotations
 * Updates rating, favorite, rejected, archived, or notes for an image (keyed by content_hash).
 */
imagesRouter.patch('/:id/annotations', (req, res) => {
  try {
    const id = Number(req.params.id);
    const img = db.prepare('SELECT id, content_hash FROM images WHERE id = ?').get(id) as
      | { id: number; content_hash: string }
      | undefined;
    if (!img) {
      res.status(404).json({ error: 'Image not found' });
      return;
    }

    const { rating, isFavorite, isRejected, isArchived, notes } = req.body || {};
    db.prepare('INSERT OR IGNORE INTO ratings (content_hash, image_id) VALUES (?, ?)').run(
      img.content_hash,
      img.id
    );

    const current = db
      .prepare('SELECT * FROM ratings WHERE content_hash = ?')
      .get(img.content_hash) as any;

    const nextRating = rating !== undefined ? Number(rating) : current.rating;
    const nextFav = isFavorite !== undefined ? (isFavorite ? 1 : 0) : current.is_favorite;
    const nextRej = isRejected !== undefined ? (isRejected ? 1 : 0) : current.is_rejected;
    const nextArch = isArchived !== undefined ? (isArchived ? 1 : 0) : current.is_archived;
    const nextNotes = notes !== undefined ? String(notes) : current.notes;
    const favAt =
      isFavorite === true
        ? new Date().toISOString()
        : isFavorite === false
        ? null
        : current.favorited_at;

    db.prepare(
      `UPDATE ratings
       SET rating = ?, is_favorite = ?, is_rejected = ?, is_archived = ?,
           notes = ?, favorited_at = ?, updated_at = datetime('now')
       WHERE content_hash = ?`
    ).run(nextRating, nextFav, nextRej, nextArch, nextNotes, favAt, img.content_hash);

    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || 'Failed to update annotations' });
  }
});

/**
 * POST /api/images/bulk
 * Bulk operations: rating, favorite, reject, archive, tag, collection, character assignment.
 */
imagesRouter.post('/bulk', (req, res) => {
  try {
    const {
      imageIds,
      rating,
      isFavorite,
      isRejected,
      isArchived,
      addTagName,
      removeTagId,
      addCollectionId,
      removeCollectionId,
      addCharacterId,
      appearanceLabel,
    } = req.body || {};

    if (!Array.isArray(imageIds) || imageIds.length === 0) {
      res.status(400).json({ error: 'No imageIds provided' });
      return;
    }

    const tx = db.transaction(() => {
      let tagIdToUse: number | null = null;
      if (addTagName && String(addTagName).trim()) {
        const cleanTag = String(addTagName).trim();
        db.prepare('INSERT OR IGNORE INTO tags (name) VALUES (?)').run(cleanTag);
        const tRow = db
          .prepare('SELECT id FROM tags WHERE LOWER(name) = LOWER(?)')
          .get(cleanTag) as { id: number };
        tagIdToUse = tRow.id;
      }

      for (const rawId of imageIds) {
        const id = Number(rawId);
        const img = db.prepare('SELECT id, content_hash FROM images WHERE id = ?').get(id) as
          | { id: number; content_hash: string }
          | undefined;
        if (!img) continue;

        db.prepare('INSERT OR IGNORE INTO ratings (content_hash, image_id) VALUES (?, ?)').run(
          img.content_hash,
          img.id
        );

        if (rating !== undefined) {
          db.prepare('UPDATE ratings SET rating = ?, updated_at = datetime(\'now\') WHERE content_hash = ?').run(
            Number(rating),
            img.content_hash
          );
        }
        if (isFavorite !== undefined) {
          db.prepare(
            'UPDATE ratings SET is_favorite = ?, favorited_at = CASE WHEN ? = 1 THEN datetime(\'now\') ELSE NULL END WHERE content_hash = ?'
          ).run(isFavorite ? 1 : 0, isFavorite ? 1 : 0, img.content_hash);
        }
        if (isRejected !== undefined) {
          db.prepare('UPDATE ratings SET is_rejected = ? WHERE content_hash = ?').run(
            isRejected ? 1 : 0,
            img.content_hash
          );
        }
        if (isArchived !== undefined) {
          db.prepare('UPDATE ratings SET is_archived = ? WHERE content_hash = ?').run(
            isArchived ? 1 : 0,
            img.content_hash
          );
        }
        if (tagIdToUse !== null) {
          db.prepare(
            'INSERT OR IGNORE INTO image_tags (image_content_hash, image_id, tag_id) VALUES (?, ?, ?)'
          ).run(img.content_hash, img.id, tagIdToUse);
        }
        if (removeTagId !== undefined) {
          db.prepare('DELETE FROM image_tags WHERE image_content_hash = ? AND tag_id = ?').run(
            img.content_hash,
            Number(removeTagId)
          );
        }
        if (addCollectionId !== undefined) {
          db.prepare(
            'INSERT OR IGNORE INTO collection_images (collection_id, image_content_hash, image_id) VALUES (?, ?, ?)'
          ).run(Number(addCollectionId), img.content_hash, img.id);
        }
        if (removeCollectionId !== undefined) {
          db.prepare(
            'DELETE FROM collection_images WHERE collection_id = ? AND image_content_hash = ?'
          ).run(Number(removeCollectionId), img.content_hash);
        }
        if (addCharacterId !== undefined) {
          db.prepare(
            `INSERT INTO image_characters
              (image_id, image_content_hash, character_id, status, source, confidence, match_reason, appearance_label)
             VALUES (?, ?, ?, 'confirmed', 'bulk', 1.0, 'Manually assigned', ?)
             ON CONFLICT(image_content_hash, character_id) DO UPDATE SET
               status = 'confirmed',
               source = 'bulk',
               confidence = 1.0,
               appearance_label = COALESCE(excluded.appearance_label, image_characters.appearance_label),
               updated_at = datetime('now')`
          ).run(img.id, img.content_hash, Number(addCharacterId), appearanceLabel || null);
        }
      }
    });

    tx();
    res.json({ ok: true, count: imageIds.length });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || 'Bulk operation failed' });
  }
});

/**
 * POST /api/images/export-zip
 * Streams a ZIP archive of unaltered original image files by imageIds or filter criteria.
 */
imagesRouter.post('/export-zip', (req, res) => {
  try {
    const { imageIds, filters, archiveName } = req.body || {};
    let targetIds: number[] = [];

    if (Array.isArray(imageIds) && imageIds.length > 0) {
      targetIds = imageIds.map((n: any) => Number(n));
    } else if (filters) {
      targetIds = queryGalleryImages(filters).map((i) => i.id);
    }

    if (targetIds.length === 0) {
      res.status(400).json({ error: 'No matching images to export' });
      return;
    }

    const zipFilename = `${(archiveName || 'couchy-export').replace(/[^a-zA-Z0-9_-]/g, '_')}.zip`;
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${zipFilename}"`);

    const archive = createZipArchive('zip', { zlib: { level: 5 } });
    archive.on('error', (err: Error) => {
      if (!res.headersSent) {
        res.status(500).json({ error: err.message });
      }
    });
    archive.pipe(res);

    const usedNames = new Set<string>();
    for (const id of targetIds) {
      const row = db
        .prepare('SELECT relative_path, filename FROM images WHERE id = ? AND is_missing = 0')
        .get(id) as { relative_path: string; filename: string } | undefined;
      if (!row) continue;

      const absPath = path.resolve(appConfig.comfyuiOutputDir, row.relative_path);
      if (!fs.existsSync(absPath)) continue;

      let entryName = row.filename;
      if (usedNames.has(entryName)) {
        entryName = `${id}_${row.filename}`;
      }
      usedNames.add(entryName);
      archive.file(absPath, { name: entryName });
    }

    archive.finalize();
  } catch (err: any) {
    if (!res.headersSent) {
      res.status(500).json({ error: err?.message || 'Failed to export ZIP' });
    }
  }
});
