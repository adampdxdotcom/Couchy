import fs from 'fs';
import path from 'path';
import sharp from 'sharp';
import { db } from '../db.ts';
import { getBoolSetting, getSettingsMap } from './settingsService.ts';
import {
  buildA1111ParameterText,
  upsertPngTextChunk,
} from './civitai/civitaiImagePayload.ts';

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

export interface ExportMetadataSettings {
  insertCouchy: boolean;
  insertCivitai: boolean;
}

export interface BuiltCouchyExportMetadata {
  xmpPacket: string;
  couchyJson: string;
  description: string;
}

/**
 * Reads the two global export-metadata switches from app_settings (both default to Off).
 */
export function getExportMetadataSettings(): ExportMetadataSettings {
  const map = getSettingsMap([
    'insert_couchy_metadata_on_export',
    'insert_civitai_metadata_on_export',
  ]);
  return {
    insertCouchy: getBoolSetting('insert_couchy_metadata_on_export', false, map),
    insertCivitai: getBoolSetting('insert_civitai_metadata_on_export', false, map),
  };
}

function escapeXml(raw: string): string {
  return raw
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function dedupeStrings(values: Array<string | null | undefined>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of values) {
    const clean = String(raw ?? '').trim();
    if (!clean) continue;
    const key = clean.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(clean);
  }
  return out;
}

/**
 * Builds standard photo-app XMP metadata (rating, keywords, description, date, creator tool)
 * plus a compact structured `couchy` JSON payload for an image.
 */
export function buildCouchyExportMetadata(imageId: number): BuiltCouchyExportMetadata | null {
  const img = db
    .prepare(
      `SELECT
         i.id, i.filename, i.content_hash, i.width, i.height, i.file_mtime,
         r.rating, r.is_favorite, r.notes,
         m.positive_prompt, m.negative_prompt, m.seed, m.steps, m.cfg, m.sampler, m.scheduler,
         m.checkpoint_name, m.generation_date
       FROM images i
       LEFT JOIN ratings r ON r.content_hash = i.content_hash
       LEFT JOIN image_metadata m ON m.image_id = i.id
       WHERE i.id = ?`
    )
    .get(imageId) as any;

  if (!img) return null;

  const characters = (
    db
      .prepare(
        `SELECT c.name
         FROM image_characters ic
         JOIN characters c ON c.id = ic.character_id
         WHERE ic.image_content_hash = ? AND ic.status = 'confirmed'
         ORDER BY c.name COLLATE NOCASE ASC`
      )
      .all(img.content_hash) as Array<{ name: string }>
  ).map((r) => r.name);

  const tags = (
    db
      .prepare(
        `SELECT t.name
         FROM image_tags it
         JOIN tags t ON t.id = it.tag_id
         WHERE it.image_content_hash = ?
         ORDER BY t.name COLLATE NOCASE ASC`
      )
      .all(img.content_hash) as Array<{ name: string }>
  ).map((r) => r.name);

  const collections = (
    db
      .prepare(
        `SELECT col.name
         FROM collection_images ci
         JOIN collections col ON col.id = ci.collection_id
         WHERE ci.image_content_hash = ?
         ORDER BY col.name COLLATE NOCASE ASC`
      )
      .all(img.content_hash) as Array<{ name: string }>
  ).map((r) => r.name);

  const rawLoras = db
    .prepare(
      `SELECT il.lora_name, il.model_strength,
              m.name AS display_name, m.nickname
       FROM image_loras il
       LEFT JOIN models m ON m.id = il.model_id OR LOWER(m.filename) = LOWER(il.lora_name)
       WHERE il.image_id = ?
       ORDER BY il.id ASC`
    )
    .all(imageId) as Array<{
    lora_name: string;
    model_strength: number | null;
    display_name: string | null;
    nickname: string | null;
  }>;

  const loras = rawLoras.map((l) => ({
    name: (l.display_name || path.parse(l.lora_name).name).trim(),
    filename: l.lora_name,
    ...(l.nickname ? { nickname: `@${l.nickname}` } : {}),
    ...(l.model_strength !== null && l.model_strength !== undefined
      ? { strength: Number(l.model_strength) }
      : {}),
  }));

  const draftRow = db
    .prepare(
      `SELECT published_url
       FROM image_civitai_drafts
       WHERE (image_id = ? OR image_content_hash = ?)
         AND published_url IS NOT NULL AND published_url != ''
       ORDER BY id DESC LIMIT 1`
    )
    .get(imageId, img.content_hash) as { published_url?: string } | undefined;

  const rating = Number(img.rating || 0);
  const isFavorite = Boolean(img.is_favorite);
  const notes = typeof img.notes === 'string' ? img.notes.trim() : '';
  const positivePrompt = typeof img.positive_prompt === 'string' ? img.positive_prompt.trim() : '';
  const createdDate = String(img.generation_date || img.file_mtime || '').trim();

  const descriptionParts = [notes, positivePrompt].filter(Boolean);
  const description = descriptionParts.join('\n\n');

  const keywords = dedupeStrings([
    ...characters,
    ...tags,
    ...collections,
    ...loras.map((l) => l.name),
  ]);

  // Build standard Adobe XMP RDF packet recognized by Apple Photos, Lightroom, Immich, Windows/macOS
  const xmpLines: string[] = [
    '<?xpacket begin="\uFEFF" id="W5M0MpCehiHzreSzNTczkc9d"?>',
    '<x:xmpmeta xmlns:x="adobe:ns:meta/">',
    '  <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">',
    '    <rdf:Description rdf:about="" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:xmp="http://ns.adobe.com/xap/1.0/">',
    '      <xmp:CreatorTool>Couchy</xmp:CreatorTool>',
  ];
  if (createdDate) {
    xmpLines.push(`      <xmp:CreateDate>${escapeXml(createdDate)}</xmp:CreateDate>`);
  }
  if (rating > 0 && rating <= 5) {
    xmpLines.push(`      <xmp:Rating>${Math.round(rating)}</xmp:Rating>`);
  }
  if (isFavorite) {
    xmpLines.push('      <xmp:Label>Favorite</xmp:Label>');
  }
  if (description) {
    xmpLines.push(
      '      <dc:description><rdf:Alt><rdf:li xml:lang="x-default">' +
        escapeXml(description) +
        '</rdf:li></rdf:Alt></dc:description>'
    );
  }
  if (keywords.length > 0) {
    xmpLines.push('      <dc:subject><rdf:Bag>');
    for (const kw of keywords) {
      xmpLines.push(`        <rdf:li>${escapeXml(kw)}</rdf:li>`);
    }
    xmpLines.push('      </rdf:Bag></dc:subject>');
  }
  xmpLines.push(
    '    </rdf:Description>',
    '  </rdf:RDF>',
    '</x:xmpmeta>',
    '<?xpacket end="w"?>'
  );

  const couchyPayload = {
    version: 1,
    source: 'couchy',
    ...(rating > 0 ? { rating } : {}),
    ...(isFavorite ? { isFavorite: true } : {}),
    ...(notes ? { notes } : {}),
    ...(characters.length > 0 ? { characters } : {}),
    ...(tags.length > 0 ? { tags } : {}),
    ...(collections.length > 0 ? { collections } : {}),
    ...(img.checkpoint_name ? { checkpoint: img.checkpoint_name } : {}),
    ...(loras.length > 0 ? { loras } : {}),
    ...(draftRow?.published_url ? { civitaiUrl: draftRow.published_url } : {}),
  };

  return {
    xmpPacket: xmpLines.join('\n'),
    couchyJson: JSON.stringify(couchyPayload),
    description,
  };
}

/**
 * Returns an in-memory image Buffer with requested export metadata injected (leaving the
 * read-only file on disk untouched), or `null` when both export switches are disabled so
 * callers can stream the original file directly.
 */
export async function prepareExportImageBuffer(
  imageId: number,
  diskPath: string,
  overrideSettings?: ExportMetadataSettings
): Promise<Buffer | null> {
  const settings = overrideSettings ?? getExportMetadataSettings();
  if (!settings.insertCouchy && !settings.insertCivitai) {
    return null;
  }

  const rawBuf = await fs.promises.readFile(diskPath);
  const imgDims = db
    .prepare('SELECT width, height FROM images WHERE id = ?')
    .get(imageId) as { width?: number; height?: number } | undefined;
  const width = Number(imgDims?.width || 0);
  const height = Number(imgDims?.height || 0);

  const couchyMeta = settings.insertCouchy ? buildCouchyExportMetadata(imageId) : null;
  const civitaiParams = settings.insertCivitai
    ? buildA1111ParameterText(imageId, width, height).trim()
    : '';

  if (!couchyMeta && !civitaiParams) {
    return null;
  }

  // PNG path: lossless chunk injection (zero pixel re-encoding, keeps ComfyUI prompt/workflow intact)
  if (rawBuf.length >= 8 && rawBuf.subarray(0, 8).equals(PNG_SIGNATURE)) {
    let outBuf: Buffer = rawBuf;
    if (civitaiParams) {
      outBuf = upsertPngTextChunk(outBuf, 'parameters', civitaiParams);
    }
    if (couchyMeta) {
      outBuf = upsertPngTextChunk(outBuf, 'couchy', couchyMeta.couchyJson);
      outBuf = upsertPngTextChunk(outBuf, 'XML:com.adobe.xmp', couchyMeta.xmpPacket, true);
    }
    return outBuf;
  }

  // JPEG / WebP fallback via sharp (preserves existing metadata and merges XMP / EXIF)
  try {
    let pipeline = sharp(rawBuf).keepMetadata();
    if (couchyMeta) {
      pipeline = pipeline.withXmp(couchyMeta.xmpPacket);
    }
    const exifPatch: Record<string, Record<string, string>> = {};
    if (couchyMeta) {
      exifPatch.IFD0 = {
        Software: 'Couchy',
        ...(couchyMeta.description ? { ImageDescription: couchyMeta.description } : {}),
      };
    }
    if (civitaiParams) {
      exifPatch.IFD2 = { UserComment: civitaiParams };
    }
    if (Object.keys(exifPatch).length > 0) {
      pipeline = pipeline.withExifMerge(exifPatch);
    }
    return await pipeline.toBuffer();
  } catch {
    return rawBuf;
  }
}
