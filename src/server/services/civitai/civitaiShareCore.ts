import fs from 'fs';
import path from 'path';
import sharp from 'sharp';
import { db } from '../../db.ts';
import { readPngTextChunks } from '../pngMetadataParser.ts';
import { resolveImageDiskPath } from '../scannerService.ts';
import { parseIdsFromCivitaiUrl, type CivitaiDomain } from './civitaiHttpAndParse.ts';
import type {
  CivitaiModelVersionCandidate,
  CivitaiShareLinkedCharacter,
  CivitaiStackExclusionReason,
} from '../../../shared/apiTypes.ts';

const GENERATION_NODE_RE =
  /KSampler|SamplerCustom|UNETLoader|CheckpointLoader|CLIPTextEncode|TextGenerate|RandomNoise|BasicGuider|CFGGuider/i;
const UPSCALE_NODE_RE = /UpscaleModelLoader|ImageUpscaleWithModel/i;
const RED_VISUAL_TAG_RE =
  /^(nude|completely_nude|topless|bottomless|nipples|areolae|pussy|penis|testicles|vaginal|anal|fellatio|cunnilingus|paizuri|sex|explicit|genitals|pubic_hair|cum|erection|nsfw)$/i;

export interface DiskMetadataInspection {
  fileExists: boolean;
  fileSizeBytes: number;
  hasNativeMetadata: boolean;
  isStandaloneUpscale: boolean;
}

export interface CoreShareImageRow {
  id: number;
  content_hash: string;
  relative_path: string;
  filename: string;
  file_size: number | null;
  width: number | null;
  height: number | null;
  format: string | null;
  is_missing: number;
  is_uploaded_reference: number;
  is_rejected?: number;
}

export interface CoreImageShareEvaluation {
  eligibleForContent: boolean;
  eligible: boolean;
  reasons: string[];
  exclusionCode: CivitaiStackExclusionReason | null;
  exclusionReason: string | null;
  hasNativeMetadata: boolean;
  isStandaloneUpscale: boolean;
  fileSizeBytes: number;
  width: number;
  height: number;
  format: string;
  linkedCharacters: CivitaiShareLinkedCharacter[];
  prefilledTitle: string;
  prefilledDescription: string;
  prefilledTags: string[];
  recommendedModelVersionId: number | null;
  recommendedDomain: CivitaiDomain;
  candidateModelVersions: CivitaiModelVersionCandidate[];
  embeddedResourceNames: string[];
}

/**
 * Inspects a workflow graph object (`prompt` or `workflow`) to distinguish real
 * generation graphs (including inline Krea 2 + 4x-ESRGAN) from standalone upscales.
 */
export function classifyPromptGraphMetadata(
  promptChunk?: string | null,
  workflowChunk?: string | null
): { hasNativeMetadata: boolean; isStandaloneUpscale: boolean } {
  const classTypes: string[] = [];

  if (promptChunk && promptChunk.trim()) {
    try {
      const parsed = JSON.parse(promptChunk) as Record<string, { class_type?: string }>;
      if (parsed && typeof parsed === 'object') {
        for (const node of Object.values(parsed)) {
          if (node && typeof node.class_type === 'string') {
            classTypes.push(node.class_type);
          }
        }
      }
    } catch {
      // ignore malformed JSON
    }
  }

  if (classTypes.length === 0 && workflowChunk && workflowChunk.trim()) {
    try {
      const parsedWf = JSON.parse(workflowChunk) as { nodes?: Array<{ type?: string }> };
      if (Array.isArray(parsedWf?.nodes)) {
        for (const node of parsedWf.nodes) {
          if (node && typeof node.type === 'string') {
            classTypes.push(node.type);
          }
        }
      }
    } catch {
      // ignore malformed JSON
    }
  }

  if (classTypes.length === 0) {
    return { hasNativeMetadata: false, isStandaloneUpscale: false };
  }

  const hasGenerationNode = classTypes.some((ct) => GENERATION_NODE_RE.test(ct));
  if (hasGenerationNode) {
    return { hasNativeMetadata: true, isStandaloneUpscale: false };
  }

  const hasUpscaleNode = classTypes.some((ct) => UPSCALE_NODE_RE.test(ct));
  return { hasNativeMetadata: false, isStandaloneUpscale: hasUpscaleNode };
}

/**
 * Inspects the actual file on disk (never derived SQLite copies) for native generation metadata.
 */
export async function inspectDiskImageNativeMetadata(
  diskPath: string
): Promise<DiskMetadataInspection> {
  if (!diskPath || !fs.existsSync(diskPath)) {
    return {
      fileExists: false,
      fileSizeBytes: 0,
      hasNativeMetadata: false,
      isStandaloneUpscale: false,
    };
  }

  const stat = fs.statSync(diskPath);
  const ext = path.extname(diskPath).toLowerCase();

  if (ext === '.png') {
    const chunks = readPngTextChunks(diskPath);
    if (chunks.parameters && chunks.parameters.trim().length > 0) {
      return {
        fileExists: true,
        fileSizeBytes: stat.size,
        hasNativeMetadata: true,
        isStandaloneUpscale: false,
      };
    }
    const graphCheck = classifyPromptGraphMetadata(chunks.prompt, chunks.workflow);
    return {
      fileExists: true,
      fileSizeBytes: stat.size,
      hasNativeMetadata: graphCheck.hasNativeMetadata,
      isStandaloneUpscale: graphCheck.isStandaloneUpscale,
    };
  }

  // Non-PNG images (e.g. JPEG/WebP) must carry an EXIF UserComment/parameters block on disk
  try {
    const meta = await sharp(diskPath).metadata();
    const exifText = meta.exif ? meta.exif.toString('latin1') : '';
    const hasExifGen =
      /Steps:\s*\d+/i.test(exifText) ||
      /Sampler:/i.test(exifText) ||
      /Negative prompt:/i.test(exifText);
    return {
      fileExists: true,
      fileSizeBytes: stat.size,
      hasNativeMetadata: hasExifGen,
      isStandaloneUpscale: false,
    };
  } catch {
    return {
      fileExists: true,
      fileSizeBytes: stat.size,
      hasNativeMetadata: false,
      isStandaloneUpscale: false,
    };
  }
}

function detectResourceDomain(
  civitaiUrl: string | null,
  downloadUrl: string | null
): { modelId: string | null; versionId: string | null; domain: CivitaiDomain } {
  const parsedCivitai = parseIdsFromCivitaiUrl(civitaiUrl);
  const parsedDownload = parseIdsFromCivitaiUrl(downloadUrl);
  const domain: CivitaiDomain =
    parsedCivitai.domain === 'civitai.red' || parsedDownload.domain === 'civitai.red'
      ? 'civitai.red'
      : 'civitai.com';
  return {
    modelId: parsedCivitai.modelId || parsedDownload.modelId,
    versionId: parsedCivitai.versionId || parsedDownload.versionId,
    domain,
  };
}

/**
 * Evaluates a single image row's Civitai share eligibility, resources, tags, and prefill text.
 */
export async function inspectCoreImageShare(
  imageRow: CoreShareImageRow,
  hasCivitaiKey: boolean,
  allowUncharacterizedSetting: boolean
): Promise<CoreImageShareEvaluation> {
  const diskPath = resolveImageDiskPath(imageRow);
  const diskMeta = await inspectDiskImageNativeMetadata(diskPath);
  const fileSizeBytes = diskMeta.fileExists
    ? diskMeta.fileSizeBytes
    : Number(imageRow.file_size || 0);

  const metaRow = db
    .prepare(
      `SELECT positive_prompt, negative_prompt, seed, steps, cfg, sampler, scheduler, checkpoint_name
       FROM image_metadata
       WHERE image_id = ?`
    )
    .get(imageRow.id) as { positive_prompt?: string | null; checkpoint_name?: string | null } | undefined;

  // Query all non-rejected characters (both confirmed AND suggested)
  const linkedCharsRaw = db
    .prepare(
      `SELECT c.id, c.name, ic.status, COALESCE(c.allow_civitai_share, 0) AS allow_civitai_share
       FROM image_characters ic
       JOIN characters c ON c.id = ic.character_id
       WHERE ic.image_content_hash = ?
         AND ic.status IN ('confirmed', 'suggested')
       ORDER BY CASE WHEN ic.status = 'confirmed' THEN 0 ELSE 1 END, c.name ASC`
    )
    .all(imageRow.content_hash) as Array<{
    id: number;
    name: string;
    status: 'confirmed' | 'suggested';
    allow_civitai_share: number;
  }>;

  const linkedCharacters: CivitaiShareLinkedCharacter[] = linkedCharsRaw.map((c) => ({
    id: c.id,
    name: c.name,
    status: c.status,
    allowCivitaiShare: Boolean(c.allow_civitai_share),
  }));

  const reasons: string[] = [];
  let exclusionCode: CivitaiStackExclusionReason | null = null;
  let exclusionReason: string | null = null;

  if (!hasCivitaiKey) {
    reasons.push('CIVITAI_API_KEY is not configured in the server environment.');
  }

  if (imageRow.is_missing || imageRow.is_rejected) {
    const msg = imageRow.is_rejected ? 'Image is marked rejected.' : 'Image file is missing on disk.';
    reasons.push(msg);
    exclusionCode = 'missing_or_rejected';
    exclusionReason = imageRow.is_rejected ? 'Rejected image' : 'Missing on disk';
  } else if (imageRow.is_uploaded_reference) {
    reasons.push('Uploaded inspiration/reference images cannot be shared on Civitai.');
    exclusionCode = 'uploaded_reference';
    exclusionReason = 'Uploaded inspiration reference';
  } else if (!diskMeta.fileExists) {
    reasons.push('Image file is missing on disk.');
    exclusionCode = 'missing_or_rejected';
    exclusionReason = 'Missing on disk';
  } else if (!diskMeta.hasNativeMetadata) {
    if (diskMeta.isStandaloneUpscale) {
      reasons.push(
        'Standalone upscaled PNG lacks original generation metadata. Select the original source image instead.'
      );
      exclusionCode = 'standalone_upscale';
      exclusionReason = 'Standalone upscale';
    } else {
      reasons.push('Image file on disk does not contain native generation metadata.');
      exclusionCode = 'missing_native_metadata';
      exclusionReason = 'Missing native metadata';
    }
  }

  if (linkedCharacters.length > 0) {
    const blockedChars = linkedCharacters.filter((c) => !c.allowCivitaiShare);
    if (blockedChars.length > 0) {
      const names = blockedChars
        .map((c) => (c.status === 'suggested' ? `${c.name} (suggested)` : c.name))
        .join(', ');
      reasons.push(`Share on CivitAI is disabled for character(s): ${names}.`);
      if (!exclusionCode) {
        exclusionCode = 'character_restricted';
        exclusionReason = `Character sharing disabled (${names})`;
      }
    }
  } else if (!allowUncharacterizedSetting) {
    reasons.push('Sharing 0-character images is disabled in System Preferences.');
    if (!exclusionCode) {
      exclusionCode = 'uncharacterized_disabled';
      exclusionReason = '0-character sharing disabled';
    }
  }

  // Gather linked Civitai modelVersionId candidates (LoRAs prioritized ahead of checkpoints)
  const loraRows = db
    .prepare(
      `SELECT il.lora_name AS filename, m.name AS model_name, m.lora_category,
              m.civitai_id, m.civitai_version_id, m.civitai_url, m.download_url
       FROM image_loras il
       LEFT JOIN models m ON m.id = il.model_id OR LOWER(m.filename) = LOWER(il.lora_name)
       WHERE il.image_id = ?
       ORDER BY CASE WHEN m.lora_category = 'character' THEN 0 ELSE 1 END, il.id ASC`
    )
    .all(imageRow.id) as Array<{
    filename: string;
    model_name: string | null;
    lora_category: string | null;
    civitai_id: string | null;
    civitai_version_id: string | null;
    civitai_url: string | null;
    download_url: string | null;
  }>;

  const modelRows = db
    .prepare(
      `SELECT im.model_name AS filename, im.model_type, m.name AS display_name,
              m.civitai_id, m.civitai_version_id, m.civitai_url, m.download_url
       FROM image_models im
       LEFT JOIN models m ON m.id = im.model_id OR LOWER(m.filename) = LOWER(im.model_name)
       WHERE im.image_id = ? AND im.model_type IN ('checkpoint', 'diffusion')`
    )
    .all(imageRow.id) as Array<{
    filename: string;
    model_type: string;
    display_name: string | null;
    civitai_id: string | null;
    civitai_version_id: string | null;
    civitai_url: string | null;
    download_url: string | null;
  }>;

  const candidateModelVersions: CivitaiModelVersionCandidate[] = [];
  const seenVersionIds = new Set<number>();
  const embeddedResourceNamesSet = new Set<string>();
  let hasRedResource = false;

  const pushCandidate = (
    rawVerId: string | null,
    civitaiUrl: string | null,
    downloadUrl: string | null,
    civitaiId: string | null,
    label: string,
    modelName: string,
    modelType: string,
    source: 'lora' | 'checkpoint'
  ) => {
    const parsed = detectResourceDomain(civitaiUrl, downloadUrl);
    if (parsed.domain === 'civitai.red') {
      hasRedResource = true;
    }
    const verIdNum = Number(rawVerId || parsed.versionId || 0);
    if (!Number.isInteger(verIdNum) || verIdNum <= 0 || seenVersionIds.has(verIdNum)) return;
    seenVersionIds.add(verIdNum);
    candidateModelVersions.push({
      modelVersionId: verIdNum,
      label,
      modelName,
      modelType,
      civitaiId: civitaiId || parsed.modelId || null,
      domain: parsed.domain,
      source,
    });
  };

  for (const l of loraRows) {
    if (l.filename) embeddedResourceNamesSet.add(l.filename);
    const display = l.model_name || l.filename;
    pushCandidate(
      l.civitai_version_id,
      l.civitai_url,
      l.download_url,
      l.civitai_id,
      `LoRA: ${display}`,
      l.filename,
      l.lora_category || 'lora',
      'lora'
    );
  }

  for (const m of modelRows) {
    if (m.filename) embeddedResourceNamesSet.add(m.filename);
    const display = m.display_name || m.filename;
    pushCandidate(
      m.civitai_version_id,
      m.civitai_url,
      m.download_url,
      m.civitai_id,
      `Base Model: ${display}`,
      m.filename,
      m.model_type || 'checkpoint',
      'checkpoint'
    );
  }
  if (metaRow?.checkpoint_name) {
    embeddedResourceNamesSet.add(String(metaRow.checkpoint_name));
  }

  const visualTagRows = db
    .prepare(
      `SELECT tag
       FROM image_visual_tags
       WHERE image_content_hash = ? AND confidence >= 0.35`
    )
    .all(imageRow.content_hash) as Array<{ tag: string }>;
  const hasExplicitVisualTag = visualTagRows.some((r) => RED_VISUAL_TAG_RE.test(r.tag.trim()));
  const recommendedDomain: CivitaiDomain =
    hasRedResource || hasExplicitVisualTag ? 'civitai.red' : 'civitai.com';

  const tagRows = db
    .prepare(
      `SELECT t.name
       FROM image_tags it
       JOIN tags t ON t.id = it.tag_id
       WHERE it.image_content_hash = ?
       ORDER BY t.name ASC`
    )
    .all(imageRow.content_hash) as Array<{ name: string }>;

  const stem = path.parse(imageRow.filename).name;
  const defaultTitle =
    linkedCharacters.length > 0
      ? `${linkedCharacters.map((c) => c.name).join(' & ')} — ${stem}`
      : stem;

  return {
    eligibleForContent: exclusionCode === null,
    eligible: reasons.length === 0,
    reasons,
    exclusionCode,
    exclusionReason,
    hasNativeMetadata: diskMeta.hasNativeMetadata,
    isStandaloneUpscale: diskMeta.isStandaloneUpscale,
    fileSizeBytes,
    width: Number(imageRow.width || 0),
    height: Number(imageRow.height || 0),
    format: String(imageRow.format || path.extname(imageRow.filename).replace(/^\./, '')),
    linkedCharacters,
    prefilledTitle: defaultTitle,
    prefilledDescription: metaRow?.positive_prompt ? String(metaRow.positive_prompt).trim() : '',
    prefilledTags: tagRows.map((t) => t.name),
    recommendedModelVersionId: candidateModelVersions[0]?.modelVersionId ?? null,
    recommendedDomain,
    candidateModelVersions,
    embeddedResourceNames: Array.from(embeddedResourceNamesSet),
  };
}
