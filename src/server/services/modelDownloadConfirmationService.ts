import fs from 'fs';
import path from 'path';
import { db } from '../db.ts';
import { appConfig } from '../config.ts';
import {
  MODEL_TYPE_TO_DEFAULT_SUBFOLDER,
  SUBFOLDER_TO_MODEL_TYPE,
} from './modelDownloadPaths.ts';
import { type CivitaiNormalizedMeta } from './civitai/civitaiHttpAndParse.ts';
import {
  clearDownloadJobPending,
  executeDownloadJob,
  markDownloadJobPending,
  type ScheduledDownloadPayload,
} from './modelDownloadExecutor.ts';
import { VALID_LORA_CATEGORIES } from '../../shared/pillSettings.ts';
import type {
  CharacterDownloadAutomation,
  ComfyModelSubfolder,
  LoraCategory,
  LoraMentionAutomation,
  ModelType,
} from '../../shared/types.ts';

/**
 * Initiates or schedules a server-side model download after explicit user confirmation.
 * Validates destination path, checks duplicate overwrite protection, and either schedules for later
 * or streams immediately to a per-job .part file with SHA-256 verification.
 */
export async function startConfirmedModelDownload(params: {
  provider: 'civitai' | 'huggingface' | 'direct';
  modelName: string;
  filename: string;
  modelType: ModelType;
  sourceUrl: string;
  expectedHash?: string | null;
  subfolder?: string;
  allowOverwrite?: boolean;
  hfRepoId?: string | null;
  civitaiMeta?: Partial<CivitaiNormalizedMeta> | null;
  loraCategory?: LoraCategory | null;
  characterAutomation?: CharacterDownloadAutomation | null;
  mentionAutomation?: LoraMentionAutomation | null;
  scheduledFor?: string | null;
}): Promise<any> {
  // Sanitize filename and subfolder against path traversal
  const safeFilename = path.basename(params.filename.trim());
  if (!safeFilename || safeFilename.startsWith('.')) {
    throw new Error('Invalid destination filename.');
  }

  const defaultFolder = MODEL_TYPE_TO_DEFAULT_SUBFOLDER[params.modelType] || 'checkpoints';
  const safeSubfolder = (params.subfolder || defaultFolder)
    .replace(/[^a-zA-Z0-9_-]/g, '')
    .toLowerCase() as ComfyModelSubfolder;
  const effectiveModelType: ModelType =
    SUBFOLDER_TO_MODEL_TYPE[safeSubfolder] || params.modelType;

  const targetDir = path.join(appConfig.downloadsDir, safeSubfolder);
  const resolvedRoot = path.resolve(appConfig.downloadsDir);
  const resolvedTargetDir = path.resolve(targetDir);

  if (!resolvedTargetDir.startsWith(resolvedRoot)) {
    throw new Error('Destination directory validation failed.');
  }

  fs.mkdirSync(resolvedTargetDir, { recursive: true });
  const destinationPath = path.join(resolvedTargetDir, safeFilename);

  if (fs.existsSync(destinationPath) && !params.allowOverwrite) {
    throw new Error(
      `File "${safeFilename}" already exists in ${resolvedTargetDir}. Confirm overwrite explicitly to replace it.`
    );
  }

  let scheduledIso: string | null = null;
  if (params.scheduledFor && String(params.scheduledFor).trim()) {
    const parsedMs = Date.parse(String(params.scheduledFor).trim());
    if (!Number.isFinite(parsedMs)) {
      throw new Error('Invalid scheduledFor timestamp.');
    }
    if (parsedMs > Date.now() + 5000) {
      scheduledIso = new Date(parsedMs).toISOString();
    }
  }

  const normalizedLoraCategory: LoraCategory | null =
    effectiveModelType === 'lora' &&
    params.loraCategory &&
    VALID_LORA_CATEGORIES.has(params.loraCategory)
      ? params.loraCategory
      : null;

  const normalizedCharacterAutomation: CharacterDownloadAutomation | null =
    effectiveModelType === 'lora' &&
    normalizedLoraCategory === 'character' &&
    params.characterAutomation?.addCharacter
      ? {
          addCharacter: true,
          generateHeadshot: Boolean(params.characterAutomation.generateHeadshot),
          characterName: String(params.characterAutomation.characterName || '').trim(),
          triggerWord: String(params.characterAutomation.triggerWord || '').trim(),
        }
      : null;

  const cleanMentionNick =
    effectiveModelType === 'lora' && params.mentionAutomation?.nickname
      ? String(params.mentionAutomation.nickname).trim().replace(/^@+/, '').toLowerCase()
      : '';
  const wantMentionEnabled = Boolean(
    effectiveModelType === 'lora' && params.mentionAutomation?.mentionEnabled
  );

  if (cleanMentionNick) {
    const existingNick = db
      .prepare(`SELECT filename FROM models WHERE LOWER(nickname) = ? AND LOWER(filename) != LOWER(?)`)
      .get(cleanMentionNick, safeFilename) as { filename: string } | undefined;
    if (existingNick) {
      throw new Error(
        `Mention tag "@${cleanMentionNick}" is already assigned to ${existingNick.filename}.`
      );
    }
  }

  const normalizedMentionAutomation: LoraMentionAutomation | null =
    wantMentionEnabled || cleanMentionNick
      ? {
          mentionEnabled: wantMentionEnabled,
          nickname: cleanMentionNick,
        }
      : null;

  const payloadJson = JSON.stringify({
    subfolder: safeSubfolder,
    allowOverwrite: Boolean(params.allowOverwrite),
    hfRepoId: params.hfRepoId || null,
    civitaiMeta: params.civitaiMeta || null,
    loraCategory: normalizedLoraCategory,
    characterAutomation: normalizedCharacterAutomation,
    mentionAutomation: normalizedMentionAutomation,
    retryCount: 0,
  } satisfies ScheduledDownloadPayload);

  const initialStatus = scheduledIso ? 'scheduled' : 'downloading';

  const info = db
    .prepare(
      `INSERT INTO download_jobs
        (provider, model_name, model_type, source_url, destination_path, expected_hash, status, scheduled_for, payload_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      params.provider,
      params.modelName,
      effectiveModelType,
      params.sourceUrl,
      destinationPath,
      params.expectedHash || null,
      initialStatus,
      scheduledIso,
      payloadJson
    );
  const jobId = Number(info.lastInsertRowid);

  if (!scheduledIso) {
    markDownloadJobPending(jobId);
    setImmediate(() => {
      executeDownloadJob(jobId, {
        provider: params.provider,
        modelName: params.modelName,
        safeFilename,
        effectiveModelType,
        destinationPath,
        sourceUrl: params.sourceUrl,
        expectedHash: params.expectedHash || null,
        hfRepoId: params.hfRepoId || null,
        civitaiMeta: params.civitaiMeta || null,
        loraCategory: normalizedLoraCategory,
        characterAutomation: normalizedCharacterAutomation,
        mentionAutomation: normalizedMentionAutomation,
      }).catch(() => {
        clearDownloadJobPending(jobId);
      });
    });
  }

  return db.prepare('SELECT * FROM download_jobs WHERE id = ?').get(jobId);
}
