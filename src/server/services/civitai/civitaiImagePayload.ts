import fs from 'fs';
import path from 'path';
import sharp from 'sharp';
import { db } from '../../db.ts';
import { parseIdsFromCivitaiUrl } from './civitaiHttpAndParse.ts';
import type { CivitaiShareUploadMode } from '../../../shared/apiTypes.ts';

const MAX_FALLBACK_JPEG_BYTES = 9.5 * 1024 * 1024;
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

export interface PreparedCivitaiImagePayload {
  base64Data: string;
  contentType: string;
  width: number;
  height: number;
  byteLength: number;
  uploadMode: CivitaiShareUploadMode;
}

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let j = 0; j < 8; j++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
  }
  return (c ^ 0xffffffff) >>> 0;
}

function isLatin1(text: string): boolean {
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code > 0xff || code === 0) return false;
  }
  return true;
}

function quoteInfotextValue(value: string): string {
  return /[,\n:"]/.test(value) ? JSON.stringify(value) : value;
}

/**
 * Inserts or replaces a PNG `parameters` text chunk in memory (`tEXt` or UTF-8 `iTXt`),
 * preserving all existing `prompt` / `workflow` chunks without touching the file on disk.
 */
export function upsertPngTextChunk(
  pngBuffer: Buffer,
  keyword: string,
  text: string,
  forceITXt = false
): Buffer {
  if (pngBuffer.length < 8 || !pngBuffer.subarray(0, 8).equals(PNG_SIGNATURE)) {
    return pngBuffer;
  }

  const chunks: Array<{ type: string; data: Buffer }> = [];
  let offset = 8;
  while (offset + 12 <= pngBuffer.length) {
    const length = pngBuffer.readUInt32BE(offset);
    const type = pngBuffer.toString('ascii', offset + 4, offset + 8);
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    if (dataEnd + 4 > pngBuffer.length) break;
    const data = pngBuffer.subarray(dataStart, dataEnd);

    // Drop any prior chunk with the same keyword
    let matchesKeyword = false;
    if (type === 'tEXt' || type === 'iTXt' || type === 'zTXt') {
      const nul = data.indexOf(0);
      if (nul !== -1 && data.toString('latin1', 0, nul) === keyword) {
        matchesKeyword = true;
      }
    }
    if (!matchesKeyword) {
      chunks.push({ type, data });
    }
    offset = dataEnd + 4;
    if (type === 'IEND') break;
  }

  const keyBytes = Buffer.from(keyword, 'latin1');
  const newChunk =
    !forceITXt && isLatin1(text)
      ? {
          type: 'tEXt',
          data: Buffer.concat([keyBytes, Buffer.from([0]), Buffer.from(text, 'latin1')]),
        }
      : {
          type: 'iTXt',
          data: Buffer.concat([keyBytes, Buffer.from([0, 0, 0, 0, 0]), Buffer.from(text, 'utf8')]),
        };

  const insertIdx = chunks.findIndex((c) => c.type !== 'IHDR');
  chunks.splice(insertIdx === -1 ? chunks.length : insertIdx, 0, newChunk);

  const outParts: Buffer[] = [PNG_SIGNATURE];
  for (const chunk of chunks) {
    const lenBuf = Buffer.alloc(4);
    lenBuf.writeUInt32BE(chunk.data.length, 0);
    const body = Buffer.concat([Buffer.from(chunk.type, 'ascii'), chunk.data]);
    const crcBuf = Buffer.alloc(4);
    crcBuf.writeUInt32BE(crc32(body), 0);
    outParts.push(lenBuf, body, crcBuf);
  }
  return Buffer.concat(outParts);
}

function resolveVersionId(rawVersionId: string | null, civitaiUrl: string | null, downloadUrl: string | null): number | null {
  const parsed = parseIdsFromCivitaiUrl(civitaiUrl || downloadUrl);
  const ver = Number(rawVersionId || parsed.versionId || 0);
  return Number.isInteger(ver) && ver > 0 ? ver : null;
}

/**
 * Formats an A1111 + Civitai-compatible parameter string (`Civitai resources`, `Hashes`,
 * `Lora hashes`, prompt, sampler, seed) so Civitai attaches all LoRAs and the Base Model.
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
      `SELECT il.id AS row_id, il.lora_name, il.lora_hash, il.model_strength,
              m.autov2_hash, m.sha256_hash, m.civitai_version_id, m.civitai_url, m.download_url
       FROM image_loras il
       LEFT JOIN models m ON m.id = il.model_id OR LOWER(m.filename) = LOWER(il.lora_name)
       WHERE il.image_id = ?
       ORDER BY il.id ASC`
    )
    .all(imageId) as Array<{
    row_id: number;
    lora_name: string;
    lora_hash: string | null;
    model_strength: number | null;
    autov2_hash: string | null;
    sha256_hash: string | null;
    civitai_version_id: string | null;
    civitai_url: string | null;
    download_url: string | null;
  }>;

  const checkpoints = db
    .prepare(
      `SELECT im.model_name, im.model_hash,
              m.autov2_hash, m.sha256_hash, m.civitai_version_id, m.civitai_url, m.download_url
       FROM image_models im
       LEFT JOIN models m ON m.id = im.model_id OR LOWER(m.filename) = LOWER(im.model_name)
       WHERE im.image_id = ? AND im.model_type IN ('checkpoint', 'diffusion')`
    )
    .all(imageId) as Array<{
    model_name: string;
    model_hash: string | null;
    autov2_hash: string | null;
    sha256_hash: string | null;
    civitai_version_id: string | null;
    civitai_url: string | null;
    download_url: string | null;
  }>;

  const lines: string[] = [];
  if (meta?.positive_prompt) lines.push(String(meta.positive_prompt).trim());
  if (meta?.negative_prompt) lines.push(`Negative prompt: ${String(meta.negative_prompt).trim()}`);

  const settings: string[] = [];
  // Civitai's A1111 parser requires `Steps: <int>` to detect the parameters block
  const stepVal = meta?.steps !== null && meta?.steps !== undefined ? Number(meta.steps) : 8;
  settings.push(`Steps: ${Number.isFinite(stepVal) ? stepVal : 8}`);

  if (meta?.sampler) {
    const samplerText = meta.scheduler ? `${meta.sampler} ${meta.scheduler}` : String(meta.sampler);
    settings.push(`Sampler: ${quoteInfotextValue(samplerText)}`);
  }
  if (meta?.cfg !== null && meta?.cfg !== undefined) settings.push(`CFG scale: ${meta.cfg}`);
  if (meta?.seed) settings.push(`Seed: ${meta.seed}`);
  if (width > 0 && height > 0) settings.push(`Size: ${width}x${height}`);

  const primaryCkpt = checkpoints[0];
  const ckptName = meta?.checkpoint_name || primaryCkpt?.model_name;
  if (ckptName) {
    settings.push(`Model: ${quoteInfotextValue(path.parse(String(ckptName)).name)}`);
  }

  const ckptHash =
    primaryCkpt?.autov2_hash ||
    (meta?.checkpoint_hash || primaryCkpt?.model_hash || primaryCkpt?.sha256_hash || '').slice(0, 10);
  if (ckptHash) {
    settings.push(`Model hash: ${ckptHash}`);
  }

  const hashesRecord: Record<string, string> = {};
  if (ckptHash) {
    hashesRecord.model = ckptHash;
  }

  const civitaiResources: Array<{ type: 'checkpoint' | 'lora'; modelVersionId: number; weight?: number }> = [];
  const seenVersionIds = new Set<number>();

  if (primaryCkpt) {
    const ckptVerId = resolveVersionId(
      primaryCkpt.civitai_version_id,
      primaryCkpt.civitai_url,
      primaryCkpt.download_url
    );
    if (ckptVerId && !seenVersionIds.has(ckptVerId)) {
      seenVersionIds.add(ckptVerId);
      civitaiResources.push({ type: 'checkpoint', modelVersionId: ckptVerId });
    }
  }

  const seenRowIds = new Set<number>();
  const loraHashEntries: string[] = [];
  for (const l of loras) {
    if (seenRowIds.has(l.row_id)) continue;
    seenRowIds.add(l.row_id);

    const shortName = path.parse(l.lora_name).name;
    const hash = l.autov2_hash || (l.lora_hash || l.sha256_hash || '').slice(0, 10);
    if (hash) {
      loraHashEntries.push(`${shortName}: ${hash}`);
      hashesRecord[`lora:${shortName}`] = hash;
    }

    const verId = resolveVersionId(l.civitai_version_id, l.civitai_url, l.download_url);
    if (verId && !seenVersionIds.has(verId)) {
      seenVersionIds.add(verId);
      const weight =
        l.model_strength !== null && l.model_strength !== undefined
          ? Number(Number(l.model_strength).toFixed(3))
          : 1;
      civitaiResources.push({ type: 'lora', modelVersionId: verId, weight });
    }
  }

  if (loraHashEntries.length > 0) {
    settings.push(`Lora hashes: "${loraHashEntries.join(', ')}"`);
  }
  if (Object.keys(hashesRecord).length > 0) {
    settings.push(`Hashes: ${JSON.stringify(hashesRecord)}`);
  }
  if (civitaiResources.length > 0) {
    settings.push(`Civitai resources: ${JSON.stringify(civitaiResources)}`);
  }

  if (settings.length > 0) {
    lines.push(settings.join(', '));
  }

  return lines.join('\n');
}

/**
 * Prepares image bytes in memory without modifying the disk file:
 * - `original_png`: keeps original PNG pixels & ComfyUI chunks and injects an in-memory `parameters`
 *   chunk with `Civitai resources` + `Hashes` so Civitai links all LoRAs and the Base Model.
 * - `jpeg_exif`: transcodes to high-quality JPEG with A1111 + Civitai EXIF `UserComment` metadata.
 */
export async function prepareCivitaiImagePayload(
  imageId: number,
  diskPath: string,
  width: number,
  height: number,
  uploadMode: CivitaiShareUploadMode
): Promise<PreparedCivitaiImagePayload> {
  const paramText = buildA1111ParameterText(imageId, width, height);

  if (uploadMode === 'original_png') {
    const rawBuffer = fs.readFileSync(diskPath);
    const ext = path.extname(diskPath).toLowerCase();
    const contentType =
      ext === '.jpg' || ext === '.jpeg'
        ? 'image/jpeg'
        : ext === '.webp'
        ? 'image/webp'
        : 'image/png';

    const uploadBuffer: Buffer =
      contentType === 'image/png' && paramText.trim()
        ? upsertPngTextChunk(rawBuffer, 'parameters', paramText)
        : rawBuffer;

    return {
      base64Data: uploadBuffer.toString('base64'),
      contentType,
      width,
      height,
      byteLength: uploadBuffer.length,
      uploadMode: 'original_png',
    };
  }

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
