import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { db } from '../db.ts';
import { appConfig } from '../config.ts';
import {
  MODEL_DIR_TYPE_MAP,
  MODEL_EXTS,
  pathExistsAsync,
  walkDirectoryFilesAsync,
} from './fsWalkService.ts';
import { recomputeImageDependencyStatus } from './scannerService.ts';
import { parsePreviewImagesJson } from './civitai/civitaiHttpAndParse.ts';
import {
  parseCivitaiCommentsJson,
  parseCivitaiStatsJson,
} from './civitai/civitaiModelStatsHelper.ts';
import { invalidateInstalledModelsCache } from './civitai/civitaiModelEnrichmentService.ts';
import { invalidateStorageUsageStatsCache } from './storageStatsService.ts';
import type { ModelInventoryItem, ModelType } from '../../shared/types.ts';

export interface LoraMentionConfigInput {
  loraName: string;
  name?: unknown;
  mentionEnabled?: unknown;
  nickname?: unknown;
  defaultModelStrength?: unknown;
  defaultClipStrength?: unknown;
  triggerWord?: unknown;
  llmDescription?: unknown;
}

/**
 * Extracts selectable options from ComfyUI /object_info for both V1 array inputs
 * (`[["a.pth"], {}]`) and V3 COMBO inputs (`["COMBO", { options: ["a.pth"] }]`).
 */
export function extractComfyObjectInfoChoices(
  objectInfo: Record<string, any> | null,
  nodeClass: string,
  inputField: string
): string[] {
  const nodeDef = objectInfo?.[nodeClass];
  const fieldDef = nodeDef?.input?.required?.[inputField] ?? nodeDef?.input?.optional?.[inputField];
  if (!Array.isArray(fieldDef)) return [];

  let rawOptions: unknown[] | null = null;
  if (Array.isArray(fieldDef[0])) {
    rawOptions = fieldDef[0];
  } else if (fieldDef[0] === 'COMBO' && Array.isArray(fieldDef[1]?.options)) {
    rawOptions = fieldDef[1].options;
  }

  if (!rawOptions) return [];
  return rawOptions
    .map((v) => String(v ?? '').trim())
    .filter((v) => Boolean(v) && v !== 'None');
}

/**
 * Computes SHA-256 and AutoV2 (first 10 chars) for smaller model files (<= 350MB) asynchronously.
 */
async function computeModelHashesIfFeasible(
  filePath: string,
  size: number
): Promise<{
  sha256: string | null;
  autov2: string | null;
}> {
  if (size > 350 * 1024 * 1024) {
    return { sha256: null, autov2: null };
  }
  try {
    const data = await fs.promises.readFile(filePath);
    const hex = crypto.createHash('sha256').update(data).digest('hex');
    return { sha256: hex, autov2: hex.slice(0, 10) };
  } catch {
    return { sha256: null, autov2: null };
  }
}

/**
 * Inventories models across COMFYUI_MODELS_DIR, ComfyUI /object_info, and DOWNLOADS_DIR.
 * Only models verified inside COMFYUI_MODELS_DIR (complete copy) or ComfyUI /object_info
 * are marked `is_installed = 1`. Files sitting only in DOWNLOADS_DIR remain `is_installed = 0`
 * with `download_file_path` populated so Couchy displays them as unavailable / pending import.
 */
export async function syncModelInventory(): Promise<ModelInventoryItem[]> {
  interface ScannedDiskFile {
    fullPath: string;
    filename: string;
    relativeToCategory: string;
    modelType: ModelType;
    size: number;
  }

  const walkModelRoot = async (
    rootDir: string,
    defaultType: ModelType,
    includeSubfolderRelPath: boolean
  ): Promise<Map<string, ScannedDiskFile>> => {
    const found = new Map<string, ScannedDiskFile>();
    if (!rootDir) return found;

    const entries = await walkDirectoryFilesAsync(rootDir, {
      extensions: MODEL_EXTS,
      includeStat: true,
      minSizeBytes: 1,
      initialModelType: defaultType,
      modelTypeByDirName: MODEL_DIR_TYPE_MAP,
    });

    for (const entry of entries) {
      const key = entry.filename.toLowerCase();
      if (!found.has(key)) {
        found.set(key, {
          fullPath: entry.fullPath,
          filename: entry.filename,
          relativeToCategory: includeSubfolderRelPath
            ? entry.relativeToCategory || entry.filename
            : entry.filename,
          modelType: entry.modelType,
          size: entry.size,
        });
      }
    }
    return found;
  };

  const downloadsDirResolved = path.resolve(appConfig.downloadsDir || '');
  const comfyDirResolved = path.resolve(appConfig.comfyuiModelsDir || '');
  const dirsOverlap =
    Boolean(downloadsDirResolved && comfyDirResolved) &&
    (downloadsDirResolved === comfyDirResolved ||
      downloadsDirResolved.startsWith(comfyDirResolved + path.sep));

  const [comfyModelsDirExists, downloadsDirExists, comfyDiskMap, downloadsDiskMap] =
    await Promise.all([
      pathExistsAsync(appConfig.comfyuiModelsDir),
      pathExistsAsync(appConfig.downloadsDir),
      walkModelRoot(appConfig.comfyuiModelsDir, 'other', true),
      dirsOverlap
        ? Promise.resolve(new Map<string, ScannedDiskFile>())
        : walkModelRoot(appConfig.downloadsDir, 'lora', false),
    ]);

  // Query live ComfyUI /object_info when reachable — authoritative runtime list
  let comfyApiOnline = false;
  const comfyApiMap = new Map<
    string,
    { filename: string; rawName: string; modelType: ModelType }
  >();

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3000);
    const res = await fetch(`${appConfig.comfyuiUrl}/object_info`, { signal: controller.signal });
    clearTimeout(timer);

    if (res.ok) {
      comfyApiOnline = true;
      const objInfo = (await res.json()) as Record<string, any>;
      const extractList = (nodeName: string, inputKey: string, mType: ModelType) => {
        const list = extractComfyObjectInfoChoices(objInfo, nodeName, inputKey);
        for (const rawEntry of list) {
          const normalizedRaw = rawEntry.replace(/\\/g, '/').trim();
          const filename = normalizedRaw.split('/').pop() || normalizedRaw;
          const key = filename.toLowerCase();
          if (!comfyApiMap.has(key)) {
            comfyApiMap.set(key, { filename, rawName: normalizedRaw, modelType: mType });
          }
        }
      };

      extractList('CheckpointLoaderSimple', 'ckpt_name', 'checkpoint');
      extractList('LoraLoader', 'lora_name', 'lora');
      extractList('VAELoader', 'vae_name', 'vae');
      extractList('ControlNetLoader', 'control_net_name', 'controlnet');
      extractList('UpscaleModelLoader', 'model_name', 'upscaler');
      extractList('CLIPLoader', 'clip_name', 'clip');
      extractList('DualCLIPLoader', 'clip_name1', 'clip');
      extractList('DualCLIPLoader', 'clip_name2', 'clip');
      extractList('CLIPLoaderGGUF', 'clip_name', 'clip');
      extractList('UNETLoader', 'unet_name', 'diffusion');
      extractList('UnetLoaderGGUF', 'unet_name', 'diffusion');
    }
  } catch {
    // Offline operation is expected and supported
  }

  const allSeenKeys = new Set<string>([
    ...comfyDiskMap.keys(),
    ...downloadsDiskMap.keys(),
    ...comfyApiMap.keys(),
  ]);
  const verifiedInstalledKeys = new Set<string>();

  const existingByFilename = new Map<string, any>();
  for (const row of db
    .prepare('SELECT id, filename, file_size, sha256_hash, autov2_hash FROM models')
    .all() as any[]) {
    existingByFilename.set(String(row.filename).toLowerCase(), row);
  }

  for (const key of allSeenKeys) {
    const comfyDisk = comfyDiskMap.get(key) || null;
    const dlDisk = downloadsDiskMap.get(key) || null;
    const apiEntry = comfyApiMap.get(key) || null;

    // If present in both DOWNLOADS_DIR and COMFYUI_MODELS_DIR (not yet in /object_info), verify complete copy by size
    const hasCompleteComfyDiskCopy = Boolean(
      comfyDisk && (!dlDisk || comfyDisk.size === dlDisk.size)
    );
    const isComfyAvailable = Boolean(apiEntry || hasCompleteComfyDiskCopy);

    const primaryDisk = comfyDisk || dlDisk;
    const canonicalFilename =
      apiEntry?.filename || primaryDisk?.filename || key;
    const resolvedType: ModelType =
      apiEntry?.modelType ||
      (comfyDisk && comfyDisk.modelType !== 'other' ? comfyDisk.modelType : null) ||
      dlDisk?.modelType ||
      'other';
    const resolvedPath = comfyDisk?.fullPath || dlDisk?.fullPath || null;
    const resolvedSize = comfyDisk?.size ?? dlDisk?.size ?? null;
    const comfyuiPath = isComfyAvailable
      ? apiEntry?.rawName || comfyDisk?.relativeToCategory || canonicalFilename
      : null;
    const downloadFilePath = dlDisk?.fullPath || null;

    const existing = existingByFilename.get(key);
    let sha256: string | null = existing?.sha256_hash || null;
    let autov2: string | null = existing?.autov2_hash || null;
    if (primaryDisk && (!sha256 || existing?.file_size !== primaryDisk.size)) {
      const computed = await computeModelHashesIfFeasible(primaryDisk.fullPath, primaryDisk.size);
      sha256 = computed.sha256;
      autov2 = computed.autov2;
    }

    const sourceType = apiEntry && !comfyDisk && !dlDisk ? 'comfyui_api' : 'filesystem';
    const installedFlag = isComfyAvailable ? 1 : 0;

    if (isComfyAvailable) {
      verifiedInstalledKeys.add(key);
    }

    db.prepare(
      `INSERT INTO models
        (name, filename, model_type, file_path, file_size, sha256_hash, autov2_hash, is_installed, source_type, comfyui_path, download_file_path, last_seen_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
       ON CONFLICT(filename) DO UPDATE SET
         model_type = CASE WHEN excluded.model_type != 'other' THEN excluded.model_type ELSE models.model_type END,
         file_path = COALESCE(excluded.file_path, models.file_path),
         file_size = COALESCE(excluded.file_size, models.file_size),
         sha256_hash = COALESCE(excluded.sha256_hash, models.sha256_hash),
         autov2_hash = COALESCE(excluded.autov2_hash, models.autov2_hash),
         is_installed = excluded.is_installed,
         source_type = CASE WHEN excluded.source_type = 'filesystem' THEN 'filesystem' ELSE models.source_type END,
         comfyui_path = excluded.comfyui_path,
         download_file_path = excluded.download_file_path,
         last_seen_at = datetime('now')`
    ).run(
      canonicalFilename.replace(/\.(safetensors|ckpt|pt|pth|bin|gguf|sft)$/i, ''),
      canonicalFilename,
      resolvedType,
      resolvedPath,
      resolvedSize,
      sha256,
      autov2,
      installedFlag,
      sourceType,
      comfyuiPath,
      downloadFilePath
    );
  }

  // Clear stale installed flags whenever at least one authoritative ComfyUI source was reachable
  if (comfyModelsDirExists || comfyApiOnline) {
    for (const key of existingByFilename.keys()) {
      if (!verifiedInstalledKeys.has(key)) {
        const dlEntry = downloadsDiskMap.get(key) || null;
        db.prepare(
          `UPDATE models
           SET is_installed = 0,
               comfyui_path = NULL,
               download_file_path = ?
           WHERE LOWER(filename) = ?`
        ).run(dlEntry?.fullPath || null, key);
      }
    }
  } else if (downloadsDirExists) {
    // Still keep download_file_path accurate when ComfyUI folders are unreachable
    for (const key of existingByFilename.keys()) {
      const dlEntry = downloadsDiskMap.get(key) || null;
      db.prepare(`UPDATE models SET download_file_path = ? WHERE LOWER(filename) = ?`).run(
        dlEntry?.fullPath || null,
        key
      );
    }
  }

  // Recompute dependency statuses across all indexed images
  const allImgIds = db.prepare('SELECT id FROM images WHERE is_missing = 0').all() as { id: number }[];
  for (const row of allImgIds) {
    recomputeImageDependencyStatus(row.id);
  }

  invalidateInstalledModelsCache();
  invalidateStorageUsageStatsCache();
  return listModelInventory();
}

export function listModelInventory(): ModelInventoryItem[] {
  const rows = db
    .prepare(
      `
      SELECT
        m.*,
        COUNT(DISTINCT i.id) AS dependentImageCount,
        COUNT(DISTINCT iw.workflow_id) AS dependentWorkflowCount,
        AVG(CASE WHEN rt.rating > 0 THEN rt.rating ELSE NULL END) AS avgRating
      FROM models m
      LEFT JOIN image_models im ON LOWER(im.model_name) = LOWER(m.filename)
      LEFT JOIN images i ON i.id = im.image_id AND i.is_missing = 0
      LEFT JOIN ratings rt ON rt.content_hash = i.content_hash
      LEFT JOIN image_workflows iw ON iw.image_id = i.id
      GROUP BY m.id
      ORDER BY m.is_installed DESC, dependentImageCount DESC, m.filename COLLATE NOCASE ASC
    `
    )
    .all() as any[];

  return rows.map((r) => {
    const isInstalled = Boolean(r.is_installed);
    const downloadFilePath = r.download_file_path || null;
    return {
      id: r.id,
      name: r.name,
      filename: r.filename,
      modelType: r.model_type,
      loraCategory: r.lora_category || 'unclassified',
      filePath: r.file_path || null,
      fileSize: r.file_size ?? null,
      sha256Hash: r.sha256_hash || null,
      autov2Hash: r.autov2_hash || null,
      isInstalled,
      isDownloadedPendingImport: Boolean(!isInstalled && downloadFilePath),
      comfyuiPath: r.comfyui_path || null,
      downloadFilePath,
      isHidden: Boolean(r.is_hidden),
      sourceType: r.source_type,
      downloadUrl: r.download_url || null,
      civitaiId: r.civitai_id || null,
      civitaiVersionId: r.civitai_version_id || null,
      civitaiUrl: r.civitai_url || null,
      baseModel: r.base_model || null,
      recommendedWeight:
        r.recommended_weight !== null && r.recommended_weight !== undefined
          ? Number(r.recommended_weight)
          : null,
      civitaiDescription: r.civitai_description || null,
      previewImages: parsePreviewImagesJson(r.preview_images_json, r.id),
      civitaiFetchedAt: r.civitai_fetched_at || null,
      hfRepoId: r.hf_repo_id || null,
      userNotes: r.user_notes || null,
      nickname: r.nickname || null,
      mentionEnabled: Boolean(r.mention_enabled),
      llmDescription: r.llm_description || null,
      averageRating: Number(r.avgRating ? Number(r.avgRating).toFixed(2) : 0),
      lastSeenAt: r.last_seen_at,
      dependentImageCount: Number(r.dependentImageCount || 0),
      dependentWorkflowCount: Number(r.dependentWorkflowCount || 0),
      civitaiCreatorUsername: r.civitai_creator_username || null,
      isOwnCivitaiUpload: Boolean(r.is_own_civitai_upload),
      civitaiStats: parseCivitaiStatsJson(r.civitai_stats_json),
      civitaiComments: parseCivitaiCommentsJson(r.civitai_comments_json),
      civitaiStatsSyncedAt: r.civitai_stats_synced_at || null,
    };
  });
}

/**
 * Persists visibility (hidden vs shown across Explorer, @mention, Agent, and pickers) for a LoRA.
 */
export function updateLoraVisibility(loraName: string, isHidden: boolean): void {
  const cleanName = loraName.trim();
  const hiddenFlag = isHidden ? 1 : 0;

  db.prepare(
    `INSERT INTO models (name, filename, model_type, lora_category, is_hidden)
     VALUES (?, ?, 'lora', 'unclassified', ?)
     ON CONFLICT(filename) DO UPDATE SET
       is_hidden = excluded.is_hidden`
  ).run(cleanName.replace(/\.(safetensors|pt|ckpt)$/i, ''), cleanName, hiddenFlag);
  invalidateInstalledModelsCache();
}

/**
 * Updates Quick Gen @mention settings (nickname, strengths, trigger word, description)
 * with nickname uniqueness checks and strength clamping.
 */
export function updateLoraMentionConfig(input: LoraMentionConfigInput): void {
  const {
    loraName,
    name,
    mentionEnabled,
    nickname,
    defaultModelStrength,
    defaultClipStrength,
    triggerWord,
    llmDescription,
  } = input;

  const existingRow = db
    .prepare(
      `SELECT id, name, filename, nickname, mention_enabled, default_model_strength, default_clip_strength, trigger_word, llm_description
       FROM models WHERE LOWER(filename) = LOWER(?)`
    )
    .get(loraName) as
    | {
        id: number;
        name: string;
        filename: string;
        nickname: string | null;
        mention_enabled: number;
        default_model_strength: number | null;
        default_clip_strength: number | null;
        trigger_word: string | null;
        llm_description: string | null;
      }
    | undefined;

  let nextName = existingRow?.name ?? loraName.replace(/\.(safetensors|pt|ckpt)$/i, '');
  if (name !== undefined) {
    const cleanName = typeof name === 'string' ? name.trim() : '';
    if (!cleanName) {
      throw new Error('Model name cannot be empty');
    }
    nextName = cleanName;
  }

  const cleanNick =
    nickname !== undefined
      ? typeof nickname === 'string'
        ? nickname.trim().replace(/^@+/, '').toLowerCase() || null
        : null
      : (existingRow?.nickname ?? null);

  if (cleanNick) {
    const existing = db
      .prepare(
        `SELECT filename FROM models WHERE LOWER(nickname) = ? AND LOWER(filename) != LOWER(?)`
      )
      .get(cleanNick, loraName) as { filename: string } | undefined;
    if (existing) {
      throw new Error(`Nickname "@${cleanNick}" is already assigned to ${existing.filename}`);
    }
  }

  const cleanTriggerWord =
    triggerWord !== undefined
      ? typeof triggerWord === 'string'
        ? triggerWord.trim() || null
        : null
      : (existingRow?.trigger_word ?? null);

  const cleanLlmDescription =
    llmDescription !== undefined
      ? typeof llmDescription === 'string'
        ? llmDescription.trim() || null
        : null
      : (existingRow?.llm_description ?? null);

  const cleanModelStr =
    defaultModelStrength !== undefined && !Number.isNaN(Number(defaultModelStrength))
      ? Math.max(-10.0, Math.min(10.0, Number(defaultModelStrength)))
      : (existingRow?.default_model_strength ?? 1.0);
  const cleanClipStr =
    defaultClipStrength !== undefined && !Number.isNaN(Number(defaultClipStrength))
      ? Math.max(-10.0, Math.min(10.0, Number(defaultClipStrength)))
      : (existingRow?.default_clip_strength ?? 1.0);
  const isMention =
    mentionEnabled !== undefined ? (mentionEnabled ? 1 : 0) : (existingRow?.mention_enabled ?? 0);

  if (existingRow) {
    db.prepare(
      `UPDATE models
       SET name = ?,
           nickname = ?,
           mention_enabled = ?,
           default_model_strength = ?,
           default_clip_strength = ?,
           trigger_word = ?,
           llm_description = ?
       WHERE id = ?`
    ).run(
      nextName,
      cleanNick,
      isMention,
      cleanModelStr,
      cleanClipStr,
      cleanTriggerWord,
      cleanLlmDescription,
      existingRow.id
    );
  } else {
    db.prepare(
      `INSERT INTO models (name, filename, model_type, lora_category, nickname, mention_enabled, default_model_strength, default_clip_strength, trigger_word, llm_description)
       VALUES (?, ?, 'lora', 'unclassified', ?, ?, ?, ?, ?, ?)`
    ).run(
      nextName,
      loraName,
      cleanNick,
      isMention,
      cleanModelStr,
      cleanClipStr,
      cleanTriggerWord,
      cleanLlmDescription
    );
  }
  invalidateInstalledModelsCache();
}

/**
 * Toggles visibility (hidden vs shown) for any model row by numeric ID.
 */
export function updateModelVisibility(modelId: number, isHidden: boolean): void {
  const result = db
    .prepare(`UPDATE models SET is_hidden = ? WHERE id = ?`)
    .run(isHidden ? 1 : 0, modelId);
  if (result.changes === 0) {
    throw new Error(`Model #${modelId} not found`);
  }
  invalidateInstalledModelsCache();
}

/**
 * Updates user-facing @mention settings, Details & Strengths (llm_description),
 * and personal user notes for a base/utility model by numeric ID.
 */
export function updateModelConfig(
  modelId: number,
  input: {
    name?: unknown;
    mentionEnabled?: unknown;
    nickname?: unknown;
    llmDescription?: unknown;
    userNotes?: unknown;
  }
): void {
  const existingRow = db
    .prepare(
      `SELECT id, name, filename, nickname, mention_enabled, llm_description, user_notes
       FROM models WHERE id = ?`
    )
    .get(modelId) as
    | {
        id: number;
        name: string;
        filename: string;
        nickname: string | null;
        mention_enabled: number;
        llm_description: string | null;
        user_notes: string | null;
      }
    | undefined;

  if (!existingRow) {
    throw new Error(`Model #${modelId} not found`);
  }

  let nextName = existingRow.name;
  if (input.name !== undefined) {
    const cleanName = typeof input.name === 'string' ? input.name.trim() : '';
    if (!cleanName) {
      throw new Error('Model name cannot be empty');
    }
    nextName = cleanName;
  }

  const cleanNick =
    input.nickname !== undefined
      ? typeof input.nickname === 'string'
        ? input.nickname.trim().replace(/^@+/, '').toLowerCase() || null
        : null
      : (existingRow.nickname ?? null);

  if (cleanNick) {
    const conflict = db
      .prepare(`SELECT filename FROM models WHERE LOWER(nickname) = ? AND id != ?`)
      .get(cleanNick, modelId) as { filename: string } | undefined;
    if (conflict) {
      throw new Error(`Nickname "@${cleanNick}" is already assigned to ${conflict.filename}`);
    }
  }

  const isMention =
    input.mentionEnabled !== undefined
      ? input.mentionEnabled
        ? 1
        : 0
      : (existingRow.mention_enabled ?? 0);

  const cleanDetails =
    input.llmDescription !== undefined
      ? typeof input.llmDescription === 'string'
        ? input.llmDescription.trim() || null
        : null
      : (existingRow.llm_description ?? null);

  const cleanUserNotes =
    input.userNotes !== undefined
      ? typeof input.userNotes === 'string'
        ? input.userNotes.trim() || null
        : null
      : (existingRow.user_notes ?? null);

  db.prepare(
    `UPDATE models
     SET name = ?,
         nickname = ?,
         mention_enabled = ?,
         llm_description = ?,
         user_notes = ?
     WHERE id = ?`
  ).run(nextName, cleanNick, isMention, cleanDetails, cleanUserNotes, modelId);
  invalidateInstalledModelsCache();
}
