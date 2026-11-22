import path from 'path';
import sharp from 'sharp';
import { db } from '../../db.ts';
import type { CivitaiShareUploadMode } from '../../../shared/apiTypes.ts';
import fs from 'fs';

const MAX_FALLBACK_JPEG_BYTES = 9.5 * 1024 * 1024;

export interface PreparedCivitaiImagePayload {
  base64Data: string;
  contentType: string;
  width: number;
  height: number;
  byteLength: number;
  uploadMode: CivitaiShareUploadMode;
}

/**
 * Formats an A1111-compatible parameter string for JPEG EXIF fallback so Civitai
 * preserves prompt, sampler, seed, model, and LoRA hashes when PNGs are too large.
 */
export function buildA1111ParameterText(imageId: number, width: number, height: number): string {
  const meta = db
    .prepare(
      `SELECT positive_prompt, negative_prompt, seed, steps, cfg, sampler, scheduler, checkpoint_name, checkpoint_hash
       FROM image_metadata
       WHERE image_id = ?`
    )
    .get(imageId) as any;

  const loras = db
    .prepare(
      `SELECT il.lora_name, il.lora_hash, m.autov2_hash, m.sha256_hash
       FROM image_loras il
       LEFT JOIN models m ON m.id = il.model_id OR LOWER(m.filename) = LOWER(il.lora_name)
       WHERE il.image_id = ?`
    )
    .all(imageId) as Array<{
    lora_name: string;
    lora_hash: string | null;
    autov2_hash: string | null;
    sha256_hash: string | null;
  }>;

  const lines: string[] = [];
  if (meta?.positive_prompt) lines.push(String(meta.positive_prompt).trim());
  if (meta?.negative_prompt) lines.push(`Negative prompt: ${String(meta.negative_prompt).trim()}`);

  const settings: string[] = [];
  if (meta?.steps !== null && meta?.steps !== undefined) settings.push(`Steps: ${meta.steps}`);
  if (meta?.sampler) {
    const samplerText = meta.scheduler ? `${meta.sampler} ${meta.scheduler}` : String(meta.sampler);
    settings.push(`Sampler: ${samplerText}`);
  }
  if (meta?.cfg !== null && meta?.cfg !== undefined) settings.push(`CFG scale: ${meta.cfg}`);
  if (meta?.seed) settings.push(`Seed: ${meta.seed}`);
  if (width > 0 && height > 0) settings.push(`Size: ${width}x${height}`);
  if (meta?.checkpoint_name) {
    settings.push(`Model: ${path.parse(String(meta.checkpoint_name)).name}`);
  }
  if (meta?.checkpoint_hash) {
    settings.push(`Model hash: ${String(meta.checkpoint_hash).slice(0, 10)}`);
  }

  const loraHashEntries = loras
    .map((l) => {
      const hash = l.autov2_hash || (l.lora_hash || l.sha256_hash || '').slice(0, 10);
      if (!hash) return null;
      return `${path.parse(l.lora_name).name}: ${hash}`;
    })
    .filter((entry): entry is string => Boolean(entry));

  if (loraHashEntries.length > 0) {
    settings.push(`Lora hashes: "${loraHashEntries.join(', ')}"`);
  }

  if (settings.length > 0) {
    lines.push(settings.join(', '));
  }

  return lines.join('\n');
}

/**
 * Prepares image bytes either straight from disk (`original_png`) or transcoded to
 * high-quality JPEG with A1111 EXIF `UserComment` metadata (`jpeg_exif`).
 */
export async function prepareCivitaiImagePayload(
  imageId: number,
  diskPath: string,
  width: number,
  height: number,
  uploadMode: CivitaiShareUploadMode
): Promise<PreparedCivitaiImagePayload> {
  if (uploadMode === 'original_png') {
    const rawBuffer = fs.readFileSync(diskPath);
    const ext = path.extname(diskPath).toLowerCase();
    const contentType =
      ext === '.jpg' || ext === '.jpeg'
        ? 'image/jpeg'
        : ext === '.webp'
        ? 'image/webp'
        : 'image/png';
    return {
      base64Data: rawBuffer.toString('base64'),
      contentType,
      width,
      height,
      byteLength: rawBuffer.length,
      uploadMode: 'original_png',
    };
  }

  const paramText = buildA1111ParameterText(imageId, width, height);
  const encodeJpeg = async (quality: number): Promise<Buffer> => {
    let pipeline = sharp(diskPath).rotate().jpeg({ quality, mozjpeg: true });
    if (paramText.trim()) {
      pipeline = pipeline.withExif({ IFD2: { UserComment: paramText } });
    }
    return pipeline.toBuffer();
  };

  let jpegBuffer = await encodeJpeg(94);
  if (jpegBuffer.length > MAX_FALLBACK_JPEG_BYTES) {
    jpegBuffer = await encodeJpeg(86);
  }
  const outMeta = await sharp(jpegBuffer).metadata();

  return {
    base64Data: jpegBuffer.toString('base64'),
    contentType: 'image/jpeg',
    width: Number(outMeta.width || width),
    height: Number(outMeta.height || height),
    byteLength: jpegBuffer.length,
    uploadMode: 'jpeg_exif',
  };
}
