import fs from 'fs';
import path from 'path';
import { db } from '../db.ts';
import { appConfig } from '../config.ts';
import { logger } from '../logger.ts';
import {
  MODEL_TYPE_TO_DEFAULT_SUBFOLDER,
  SUBFOLDER_TO_MODEL_TYPE,
} from './modelDownloadPaths.ts';
import {
  executeDownloadJob,
  type ExecuteDownloadJobParams,
  type ScheduledDownloadPayload,
} from './modelManagerService.ts';
import { VALID_LORA_CATEGORIES } from '../../shared/pillSettings.ts';
import type { ComfyModelSubfolder, LoraCategory, ModelType } from '../../shared/types.ts';

export interface MissingRedownloadCandidate {
  key: string;
  filename: string;
  modelName: string;
  modelType: ModelType;
  subfolder: ComfyModelSubfolder;
  provider: 'civitai' | 'huggingface';
  sourceUrl: string;
  expectedHash: string | null;
  hfRepoId: string | null;
  loraCategory: LoraCategory | null;
  civitaiMeta: Record<string, any> | null;
  modelId: number | null;
  lastJobId: number | null;
}

interface QueuedRedownloadTask {
  jobId: number;
  execParams: ExecuteDownloadJobParams;
}

const redownloadQueue: QueuedRedownloadTask[] = [];
let isProcessingRedownloadQueue = false;

async function drainRedownloadQueue(): Promise<void> {
  if (isProcessingRedownloadQueue) return;
  isProcessingRedownloadQueue = true;
  try {
    while (redownloadQueue.length > 0) {
      // Shift from the front (which holds the highest jobId / top-of-list row)
      const next = redownloadQueue.shift();
      if (!next) break;

      const claim = db
        .prepare(
          `UPDATE download_jobs
           SET status = 'downloading', error_message = NULL
           WHERE id = ? AND status IN ('queued', 'downloading')`
        )
        .run(next.jobId);
      if (claim.changes === 0) continue;

      try {
        await executeDownloadJob(next.jobId, next.execParams);
      } catch (err) {
        logger.warn(
          'Downloader',
          `Sequential redownload job #${next.jobId} (${next.execParams.safeFilename}) failed`,
          err
        );
      }
    }
  } finally {
    isProcessingRedownloadQueue = false;
  }
}

function fileExistsWithSize(filePath: string | null | undefined): boolean {
  if (!filePath || typeof filePath !== 'string') return false;
  try {
    const st = fs.statSync(filePath);
    return st.isFile() && st.size > 0;
  } catch {
    return false;
  }
}

function inferProvider(
  sourceUrl: string | null | undefined,
  civitaiId: string | null | undefined,
  civitaiVersionId: string | null | undefined,
  hfRepoId: string | null | undefined,
  jobProvider: string | null | undefined
): 'civitai' | 'huggingface' | null {
  if (jobProvider === 'civitai' || jobProvider === 'huggingface') {
    return jobProvider;
  }
  const url = String(sourceUrl || '').toLowerCase();
  if (url.includes('civitai.com') || url.includes('civitai.red') || civitaiId || civitaiVersionId) {
    return 'civitai';
  }
  if (url.includes('huggingface.co') || hfRepoId) {
    return 'huggingface';
  }
  return null;
}

function resolveFallbackDownloadUrl(params: {
  directUrl: string | null;
  jobUrl: string | null;
  civitaiVersionId: string | null;
  civitaiUrl: string | null;
  hfRepoId: string | null;
  filename: string;
}): string | null {
  if (params.directUrl && /^https?:\/\//i.test(params.directUrl.trim())) {
    return params.directUrl.trim();
  }
  if (params.jobUrl && /^https?:\/\//i.test(params.jobUrl.trim())) {
    return params.jobUrl.trim();
  }
  if (params.civitaiVersionId && String(params.civitaiVersionId).trim()) {
    const verId = String(params.civitaiVersionId).trim();
    const domain = String(params.civitaiUrl || '').includes('civitai.red')
      ? 'civitai.red'
      : 'civitai.com';
    return `https://${domain}/api/download/models/${encodeURIComponent(verId)}`;
  }
  if (params.hfRepoId && String(params.hfRepoId).trim()) {
    const repo = String(params.hfRepoId).trim().replace(/^\/+|\/+$/g, '');
    return `https://huggingface.co/${repo}/resolve/main/${encodeURIComponent(params.filename)}`;
  }
  return null;
}

/**
 * Discovers all Civitai and Hugging Face models known to Couchy (`models` table + `download_jobs`)
 * whose weight files are currently missing from both ComfyUI and Couchy's downloads directory.
 */
export function listMissingRedownloadCandidates(): MissingRedownloadCandidate[] {
  const activeDownloadingJobs = db
    .prepare(
      `SELECT destination_path FROM download_jobs WHERE status IN ('downloading', 'queued')`
    )
    .all() as Array<{ destination_path: string }>;
  const activeFilenames = new Set(
    activeDownloadingJobs
      .map((j) => path.basename(String(j.destination_path || '')).toLowerCase())
      .filter(Boolean)
  );

  const allJobs = db
    .prepare(
      `SELECT * FROM download_jobs
       WHERE provider IN ('civitai', 'huggingface')
       ORDER BY id DESC`
    )
    .all() as any[];

  const latestJobByFilename = new Map<string, any>();
  for (const job of allJobs) {
    const dest = String(job.destination_path || '');
    const fname = path.basename(dest).toLowerCase();
    if (fname && !latestJobByFilename.has(fname)) {
      latestJobByFilename.set(fname, job);
    }
  }

  const modelsRows = db
    .prepare(
      `SELECT id, name, filename, model_type, lora_category, file_path, download_file_path,
              sha256_hash, is_installed, download_url, civitai_id, civitai_version_id,
              civitai_url, hf_repo_id
       FROM models`
    )
    .all() as Array<{
    id: number;
    name: string;
    filename: string;
    model_type: string;
    lora_category: string;
    file_path: string | null;
    download_file_path: string | null;
    sha256_hash: string | null;
    is_installed: number;
    download_url: string | null;
    civitai_id: string | null;
    civitai_version_id: string | null;
    civitai_url: string | null;
    hf_repo_id: string | null;
  }>;

  const candidates = new Map<string, MissingRedownloadCandidate>();

  // 1. Inspect `models` rows
  for (const m of modelsRows) {
    const safeFilename = path.basename(String(m.filename || '').trim());
    if (!safeFilename) continue;
    const key = safeFilename.toLowerCase();
    if (activeFilenames.has(key)) continue;

    const matchingJob = latestJobByFilename.get(key) || null;
    const modelType = (m.model_type || 'lora') as ModelType;
    const defaultSubfolder = (MODEL_TYPE_TO_DEFAULT_SUBFOLDER[modelType] ||
      'loras') as ComfyModelSubfolder;
    const expectedDownloadPath = path.join(appConfig.downloadsDir, defaultSubfolder, safeFilename);

    // Check if the file actually exists on disk at any known location
    const existsOnDisk =
      fileExistsWithSize(m.file_path) ||
      fileExistsWithSize(m.download_file_path) ||
      fileExistsWithSize(matchingJob?.destination_path) ||
      fileExistsWithSize(expectedDownloadPath);

    if (existsOnDisk) continue;

    let jobPayload: Record<string, any> | null = null;
    if (matchingJob?.payload_json) {
      try {
        jobPayload = JSON.parse(matchingJob.payload_json);
      } catch {
        jobPayload = null;
      }
    }

    const provider = inferProvider(
      m.download_url || matchingJob?.source_url,
      m.civitai_id,
      m.civitai_version_id || jobPayload?.civitaiMeta?.civitaiVersionId,
      m.hf_repo_id || jobPayload?.hfRepoId,
      matchingJob?.provider
    );
    if (!provider) continue;

    const sourceUrl = resolveFallbackDownloadUrl({
      directUrl: m.download_url,
      jobUrl: matchingJob?.source_url || null,
      civitaiVersionId: m.civitai_version_id || jobPayload?.civitaiMeta?.civitaiVersionId || null,
      civitaiUrl: m.civitai_url || jobPayload?.civitaiMeta?.civitaiUrl || null,
      hfRepoId: m.hf_repo_id || jobPayload?.hfRepoId || null,
      filename: safeFilename,
    });
    if (!sourceUrl) continue;

    const subfolder: ComfyModelSubfolder =
      (jobPayload?.subfolder as ComfyModelSubfolder) || defaultSubfolder;
    const loraCategory: LoraCategory | null =
      m.lora_category && VALID_LORA_CATEGORIES.has(m.lora_category as LoraCategory)
        ? (m.lora_category as LoraCategory)
        : (jobPayload?.loraCategory as LoraCategory) || null;

    candidates.set(key, {
      key,
      filename: safeFilename,
      modelName: m.name || matchingJob?.model_name || safeFilename,
      modelType,
      subfolder,
      provider,
      sourceUrl,
      expectedHash: m.sha256_hash || matchingJob?.expected_hash || matchingJob?.actual_hash || null,
      hfRepoId: m.hf_repo_id || jobPayload?.hfRepoId || null,
      loraCategory,
      civitaiMeta: jobPayload?.civitaiMeta || null,
      modelId: m.id,
      lastJobId: matchingJob?.id ?? null,
    });
  }

  // 2. Inspect `download_jobs` that may not have a row in `models` yet
  for (const [key, job] of latestJobByFilename.entries()) {
    if (candidates.has(key) || activeFilenames.has(key)) continue;
    if (job.status === 'scheduled' || job.status === 'downloading' || job.status === 'queued') {
      continue;
    }

    const destPath = String(job.destination_path || '');
    const safeFilename = path.basename(destPath);
    if (!safeFilename) continue;

    if (fileExistsWithSize(destPath)) continue;

    const existingModel = modelsRows.find((m) => m.filename.toLowerCase() === key);
    if (
      existingModel &&
      (fileExistsWithSize(existingModel.file_path) ||
        fileExistsWithSize(existingModel.download_file_path))
    ) {
      continue;
    }

    let jobPayload: Record<string, any> | null = null;
    if (job.payload_json) {
      try {
        jobPayload = JSON.parse(job.payload_json);
      } catch {
        jobPayload = null;
      }
    }

    const provider = inferProvider(
      job.source_url,
      jobPayload?.civitaiMeta?.civitaiId,
      jobPayload?.civitaiMeta?.civitaiVersionId,
      jobPayload?.hfRepoId,
      job.provider
    );
    if (!provider) continue;

    const sourceUrl = resolveFallbackDownloadUrl({
      directUrl: null,
      jobUrl: job.source_url || null,
      civitaiVersionId: jobPayload?.civitaiMeta?.civitaiVersionId || null,
      civitaiUrl: jobPayload?.civitaiMeta?.civitaiUrl || null,
      hfRepoId: jobPayload?.hfRepoId || null,
      filename: safeFilename,
    });
    if (!sourceUrl) continue;

    const modelType = (job.model_type || 'lora') as ModelType;
    const defaultSubfolder = (MODEL_TYPE_TO_DEFAULT_SUBFOLDER[modelType] ||
      'loras') as ComfyModelSubfolder;
    const subfolder: ComfyModelSubfolder =
      (jobPayload?.subfolder as ComfyModelSubfolder) || defaultSubfolder;

    candidates.set(key, {
      key,
      filename: safeFilename,
      modelName: job.model_name || safeFilename,
      modelType,
      subfolder,
      provider,
      sourceUrl,
      expectedHash: job.expected_hash || job.actual_hash || null,
      hfRepoId: jobPayload?.hfRepoId || null,
      loraCategory: (jobPayload?.loraCategory as LoraCategory) || null,
      civitaiMeta: jobPayload?.civitaiMeta || null,
      modelId: existingModel?.id ?? null,
      lastJobId: job.id,
    });
  }

  return Array.from(candidates.values());
}

/**
 * Inserts a `queued` job into `download_jobs` and places it at the front of the sequential
 * worker queue so the highest-ID job (visible at the very top of the UI list) downloads first.
 */
function createQueuedRedownloadTask(candidate: MissingRedownloadCandidate): {
  job: any;
  task: QueuedRedownloadTask;
} {
  const safeSubfolder = (candidate.subfolder ||
    MODEL_TYPE_TO_DEFAULT_SUBFOLDER[candidate.modelType] ||
    'loras') as ComfyModelSubfolder;
  const effectiveModelType: ModelType =
    SUBFOLDER_TO_MODEL_TYPE[safeSubfolder] || candidate.modelType;

  const targetDir = path.resolve(path.join(appConfig.downloadsDir, safeSubfolder));
  fs.mkdirSync(targetDir, { recursive: true });
  const destinationPath = path.join(targetDir, candidate.filename);

  const payloadJson = JSON.stringify({
    subfolder: safeSubfolder,
    allowOverwrite: true,
    hfRepoId: candidate.hfRepoId || null,
    civitaiMeta: candidate.civitaiMeta || null,
    loraCategory: candidate.loraCategory || null,
    characterAutomation: null,
    mentionAutomation: null,
    retryCount: 0,
  } satisfies ScheduledDownloadPayload);

  // Remove any older duplicate queued/failed redownload rows for the exact same destination path
  // so the download history list doesn't get flooded with 142 duplicate entries on retry
  db.prepare(
    `DELETE FROM download_jobs
     WHERE LOWER(destination_path) = LOWER(?)
       AND status IN ('queued', 'downloading')
       AND bytes_downloaded = 0`
  ).run(destinationPath);

  const info = db
    .prepare(
      `INSERT INTO download_jobs
        (provider, model_name, model_type, source_url, destination_path, expected_hash, status, scheduled_for, payload_json)
       VALUES (?, ?, ?, ?, ?, ?, 'queued', NULL, ?)`
    )
    .run(
      candidate.provider,
      candidate.modelName,
      effectiveModelType,
      candidate.sourceUrl,
      destinationPath,
      candidate.expectedHash || null,
      payloadJson
    );
  const jobId = Number(info.lastInsertRowid);
  const job = db.prepare('SELECT * FROM download_jobs WHERE id = ?').get(jobId);

  return {
    job,
    task: {
      jobId,
      execParams: {
        provider: candidate.provider,
        modelName: candidate.modelName,
        safeFilename: candidate.filename,
        effectiveModelType,
        destinationPath,
        sourceUrl: candidate.sourceUrl,
        expectedHash: candidate.expectedHash || null,
        hfRepoId: candidate.hfRepoId || null,
        civitaiMeta: candidate.civitaiMeta || null,
        loraCategory: candidate.loraCategory || null,
        characterAutomation: null,
        mentionAutomation: null,
      },
    },
  };
}

/**
 * Recovers any stuck `downloading` (0 bytes) or `queued` jobs that are not currently in the
 * in-memory worker queue (e.g. if the user already clicked Redownload Missing before this update).
 */
function adoptStuckOrOrphanedJobs(): number {
  const inMemoryIds = new Set(redownloadQueue.map((t) => t.jobId));
  const stuckRows = db
    .prepare(
      `SELECT * FROM download_jobs
       WHERE status IN ('queued', 'downloading')
         AND provider IN ('civitai', 'huggingface')
       ORDER BY id DESC`
    )
    .all() as any[];

  let adoptedCount = 0;
  for (const row of stuckRows) {
    if (inMemoryIds.has(Number(row.id))) continue;
    // If a job is actively streaming right now (bytes_downloaded > 0 while queue is running), leave it alone
    if (isProcessingRedownloadQueue && row.status === 'downloading' && Number(row.bytes_downloaded) > 0) {
      continue;
    }

    const destPath = String(row.destination_path || '');
    const safeFilename = path.basename(destPath);
    if (!safeFilename) continue;

    if (fileExistsWithSize(destPath)) {
      db.prepare(
        `UPDATE download_jobs SET status = 'completed', completed_at = datetime('now') WHERE id = ?`
      ).run(row.id);
      continue;
    }

    let payload: Record<string, any> | null = null;
    if (row.payload_json) {
      try {
        payload = JSON.parse(row.payload_json);
      } catch {
        payload = null;
      }
    }

    db.prepare(`UPDATE download_jobs SET status = 'queued' WHERE id = ?`).run(row.id);

    redownloadQueue.push({
      jobId: Number(row.id),
      execParams: {
        provider: row.provider,
        modelName: row.model_name || safeFilename,
        safeFilename,
        effectiveModelType: (row.model_type || 'lora') as ModelType,
        destinationPath: destPath,
        sourceUrl: String(row.source_url || ''),
        expectedHash: row.expected_hash || null,
        hfRepoId: payload?.hfRepoId || null,
        civitaiMeta: payload?.civitaiMeta || null,
        loraCategory: (payload?.loraCategory as LoraCategory) || null,
        characterAutomation: null,
        mentionAutomation: null,
      },
    });
    adoptedCount += 1;
  }

  return adoptedCount;
}

/**
 * Queues redownloads for all missing Civitai and Hugging Face models (or a single job/model).
 * Tasks are ordered newest-ID first so the user immediately sees the top item in the UI
 * transition from `queued` -> `downloading` with live percentage progress.
 */
export function startRedownloadMissingModels(options?: {
  onlyJobId?: number | null;
  onlyFilename?: string | null;
}): {
  queuedCount: number;
  jobs: any[];
} {
  // First adopt any stuck 0% jobs already sitting in `download_jobs`
  const adoptedCount = !options?.onlyJobId && !options?.onlyFilename ? adoptStuckOrOrphanedJobs() : 0;

  let candidates = listMissingRedownloadCandidates();

  if (options?.onlyJobId) {
    const targetJob = db
      .prepare('SELECT * FROM download_jobs WHERE id = ?')
      .get(options.onlyJobId) as any;
    const targetFname = targetJob
      ? path.basename(String(targetJob.destination_path || '')).toLowerCase()
      : '';
    candidates = candidates.filter(
      (c) => c.lastJobId === options.onlyJobId || (targetFname && c.key === targetFname)
    );
  } else if (options?.onlyFilename) {
    const targetKey = path.basename(options.onlyFilename.trim()).toLowerCase();
    candidates = candidates.filter((c) => c.key === targetKey);
  }

  const createdJobs: any[] = [];
  const createdTasks: QueuedRedownloadTask[] = [];
  for (const candidate of candidates) {
    const { job, task } = createQueuedRedownloadTask(candidate);
    if (job) createdJobs.push(job);
    createdTasks.push(task);
  }

  // Reverse createdTasks so the highest jobId (top of `ORDER BY id DESC` in the UI) runs FIRST
  createdTasks.reverse();
  redownloadQueue.unshift(...createdTasks);

  setImmediate(() => {
    drainRedownloadQueue().catch(() => {});
  });

  return {
    queuedCount: createdJobs.length + adoptedCount,
    jobs: createdJobs,
  };
}

/**
 * Automatically resumes any orphaned `queued` or 0-byte `downloading` jobs on server boot or poll.
 */
export function ensureRedownloadQueueRunning(): void {
  if (isProcessingRedownloadQueue) return;
  const adopted = adoptStuckOrOrphanedJobs();
  if (adopted > 0 || redownloadQueue.length > 0) {
    setImmediate(() => {
      drainRedownloadQueue().catch(() => {});
    });
  }
}
