import fs from 'fs';
import path from 'path';
import { db } from '../db.ts';
import { logger } from '../logger.ts';
import {
  extractCivitaiEarlyAccessInfo,
  fetchCivitaiJsonWithFallback,
  getCivitaiHeaders,
  resolveCivitaiDomain,
  type CivitaiDomain,
} from './civitaiMetadataService.ts';
import { extractCivitaiVersionFiles } from './modelDownloadResolverService.ts';
import {
  executeDownloadJob,
  type ScheduledDownloadPayload,
} from './modelManagerService.ts';
import { VALID_LORA_CATEGORIES } from '../../shared/pillSettings.ts';
import type { LoraCategory, ModelType } from '../../shared/types.ts';

const SCHEDULER_INTERVAL_MS = 30_000;
const MAX_UNLOCK_RETRIES = 3;
const RETRY_DELAY_MS = 5 * 60_000;

let isProcessingDueJobs = false;
let schedulerTimer: ReturnType<typeof setInterval> | null = null;

function parseJobPayload(raw: string | null | undefined): ScheduledDownloadPayload {
  if (!raw) {
    return { subfolder: 'checkpoints', allowOverwrite: false, retryCount: 0 };
  }
  try {
    const parsed = JSON.parse(raw);
    const rawCategory = parsed?.loraCategory;
    const loraCategory =
      typeof rawCategory === 'string' && VALID_LORA_CATEGORIES.has(rawCategory as LoraCategory)
        ? (rawCategory as LoraCategory)
        : null;
    return {
      subfolder: parsed?.subfolder || 'checkpoints',
      allowOverwrite: Boolean(parsed?.allowOverwrite),
      hfRepoId: parsed?.hfRepoId ?? null,
      civitaiMeta: parsed?.civitaiMeta ?? null,
      loraCategory,
      characterAutomation: parsed?.characterAutomation ?? null,
      retryCount: typeof parsed?.retryCount === 'number' ? parsed.retryCount : 0,
    };
  } catch {
    return { subfolder: 'checkpoints', allowOverwrite: false, retryCount: 0 };
  }
}

/**
 * Re-fetches Civitai version metadata prior to running a scheduled job so extended early access
 * dates or rotated file download URLs are respected automatically.
 */
async function refreshCivitaiScheduledMetadata(
  job: any,
  payload: ScheduledDownloadPayload
): Promise<{
  rescheduledUntil: string | null;
  sourceUrl: string;
  expectedHash: string | null;
}> {
  let sourceUrl = String(job.source_url || '');
  let expectedHash: string | null = job.expected_hash || null;

  const versionId = payload.civitaiMeta?.civitaiVersionId;
  if (job.provider !== 'civitai' || !versionId) {
    return { rescheduledUntil: null, sourceUrl, expectedHash };
  }

  const preferredDomain: CivitaiDomain = String(
    payload.civitaiMeta?.civitaiUrl || sourceUrl
  ).includes('civitai.red')
    ? 'civitai.red'
    : 'civitai.com';

  try {
    const verRes = await fetchCivitaiJsonWithFallback(
      `/api/v1/model-versions/${encodeURIComponent(String(versionId))}`,
      getCivitaiHeaders(),
      preferredDomain,
      9000
    );
    if (!verRes?.data) {
      return { rescheduledUntil: null, sourceUrl, expectedHash };
    }

    const freshVer = verRes.data;
    const earlyAccess = extractCivitaiEarlyAccessInfo(freshVer);

    // If creator extended early access timestamp into the future, postpone job safely
    if (
      earlyAccess.earlyAccessEndsAt &&
      Date.parse(earlyAccess.earlyAccessEndsAt) > Date.now()
    ) {
      const nextIso = new Date(Date.parse(earlyAccess.earlyAccessEndsAt) + 60_000).toISOString();
      return { rescheduledUntil: nextIso, sourceUrl, expectedHash };
    }

    const domain = resolveCivitaiDomain(null, freshVer, verRes.domain);
    const files = extractCivitaiVersionFiles(
      freshVer,
      String(freshVer?.model?.type || job.model_type || 'LORA'),
      freshVer.baseModel,
      domain
    );
    const targetBasename = path.basename(String(job.destination_path || '')).toLowerCase();
    const matched =
      files.find((f) => f.filename.toLowerCase() === targetBasename) || files[0];

    if (matched) {
      sourceUrl = matched.downloadUrl;
      expectedHash = matched.sha256Hash || expectedHash;
    }
  } catch {
    // Proceed with stored source_url if version refresh transiently fails
  }

  return { rescheduledUntil: null, sourceUrl, expectedHash };
}

/**
 * Executes a single claimed download job with early-access unlock retry tolerance.
 */
async function runClaimedScheduledJob(job: any, skipEarlyAccessRefresh = false): Promise<void> {
  const payload = parseJobPayload(job.payload_json);
  const destinationPath = String(job.destination_path || '');
  const safeFilename = path.basename(destinationPath);

  if (fs.existsSync(destinationPath) && !payload.allowOverwrite) {
    db.prepare(
      `UPDATE download_jobs
       SET status = 'failed', error_message = ?, completed_at = datetime('now')
       WHERE id = ?`
    ).run(`File "${safeFilename}" already exists and overwrite was not enabled.`, job.id);
    return;
  }

  let sourceUrl = String(job.source_url || '');
  let expectedHash: string | null = job.expected_hash || null;

  if (!skipEarlyAccessRefresh && job.provider === 'civitai') {
    const refreshed = await refreshCivitaiScheduledMetadata(job, payload);
    if (refreshed.rescheduledUntil) {
      db.prepare(
        `UPDATE download_jobs
         SET status = 'scheduled', scheduled_for = ?, error_message = ?
         WHERE id = ?`
      ).run(
        refreshed.rescheduledUntil,
        'Creator extended Civitai Early Access end time; rescheduled automatically.',
        job.id
      );
      logger.info('Scheduler', `Rescheduled job #${job.id} (${safeFilename}) until ${refreshed.rescheduledUntil}`);
      return;
    }
    sourceUrl = refreshed.sourceUrl;
    expectedHash = refreshed.expectedHash;
    if (sourceUrl !== job.source_url || expectedHash !== job.expected_hash) {
      db.prepare('UPDATE download_jobs SET source_url = ?, expected_hash = ? WHERE id = ?').run(
        sourceUrl,
        expectedHash,
        job.id
      );
    }
  }

  try {
    await executeDownloadJob(job.id, {
      provider: job.provider,
      modelName: job.model_name,
      safeFilename,
      effectiveModelType: job.model_type as ModelType,
      destinationPath,
      sourceUrl,
      expectedHash,
      hfRepoId: payload.hfRepoId || null,
      civitaiMeta: payload.civitaiMeta || null,
      loraCategory: payload.loraCategory ?? null,
      characterAutomation: payload.characterAutomation ?? null,
      deferAuthErrorToCaller: !skipEarlyAccessRefresh,
    });
  } catch (err: any) {
    const retryCount = payload.retryCount || 0;
    if ((err?.httpStatus === 401 || err?.httpStatus === 403) && retryCount < MAX_UNLOCK_RETRIES) {
      const nextRetry = retryCount + 1;
      const nextSchedule = new Date(Date.now() + RETRY_DELAY_MS).toISOString();
      const nextPayload = JSON.stringify({ ...payload, retryCount: nextRetry });
      db.prepare(
        `UPDATE download_jobs
         SET status = 'scheduled', scheduled_for = ?, payload_json = ?, error_message = ?
         WHERE id = ?`
      ).run(
        nextSchedule,
        nextPayload,
        `Waiting for Civitai unlock propagation; retrying in 5m (${nextRetry}/${MAX_UNLOCK_RETRIES}).`,
        job.id
      );
      return;
    }

    db.prepare(
      `UPDATE download_jobs
       SET status = 'failed', error_message = ?, completed_at = datetime('now')
       WHERE id = ?`
    ).run(err?.message || 'Scheduled download failed', job.id);
  }
}

/**
 * Checks `download_jobs` for due scheduled downloads and triggers them sequentially.
 */
export async function processDueScheduledDownloads(): Promise<void> {
  if (isProcessingDueJobs) return;
  isProcessingDueJobs = true;
  try {
    const scheduledRows = db
      .prepare(
        `SELECT * FROM download_jobs
         WHERE status = 'scheduled' AND scheduled_for IS NOT NULL
         ORDER BY scheduled_for ASC`
      )
      .all() as any[];

    const nowMs = Date.now();
    for (const job of scheduledRows) {
      const dueMs = Date.parse(String(job.scheduled_for || ''));
      if (!Number.isFinite(dueMs) || dueMs > nowMs) continue;

      const claim = db
        .prepare(
          `UPDATE download_jobs
           SET status = 'downloading', error_message = NULL
           WHERE id = ? AND status = 'scheduled'`
        )
        .run(job.id);
      if (claim.changes !== 1) continue;

      logger.info('Scheduler', `Triggering scheduled download job #${job.id} (${job.model_name})`);
      await runClaimedScheduledJob(job, false);
    }
  } catch (err) {
    logger.error('Scheduler', 'Scheduled download tick failed', err);
  } finally {
    isProcessingDueJobs = false;
  }
}

/**
 * Immediately launches a scheduled download job (e.g. when user unlocked Early Access manually).
 */
export function runScheduledDownloadNow(jobId: number): any {
  const job = db.prepare('SELECT * FROM download_jobs WHERE id = ?').get(jobId) as any;
  if (!job) {
    throw new Error('Download job not found.');
  }
  if (job.status !== 'scheduled') {
    throw new Error(`Only scheduled jobs can be started manually (current status: ${job.status}).`);
  }

  const claim = db
    .prepare(
      `UPDATE download_jobs
       SET status = 'downloading', scheduled_for = NULL, error_message = NULL
       WHERE id = ? AND status = 'scheduled'`
    )
    .run(jobId);

  if (claim.changes !== 1) {
    throw new Error('Scheduled download could not be claimed.');
  }

  const updated = db.prepare('SELECT * FROM download_jobs WHERE id = ?').get(jobId);
  setImmediate(() => {
    runClaimedScheduledJob(job, true).catch(() => {});
  });
  return updated;
}

/**
 * Cancels and removes a pending scheduled download job.
 */
export function cancelScheduledDownload(jobId: number): { ok: true; deletedId: number } {
  const job = db.prepare('SELECT id, status FROM download_jobs WHERE id = ?').get(jobId) as
    | { id: number; status: string }
    | undefined;
  if (!job) {
    throw new Error('Download job not found.');
  }
  if (job.status !== 'scheduled') {
    throw new Error(`Only scheduled downloads can be cancelled (current status: ${job.status}).`);
  }
  db.prepare(`DELETE FROM download_jobs WHERE id = ? AND status = 'scheduled'`).run(jobId);
  return { ok: true, deletedId: jobId };
}

/**
 * Converts a failed Civitai Early Access job into a scheduled job by looking up its live unlock timestamp.
 */
export async function rescheduleFailedDownload(
  jobId: number,
  explicitScheduledFor?: string | null
): Promise<any> {
  const job = db.prepare('SELECT * FROM download_jobs WHERE id = ?').get(jobId) as any;
  if (!job) {
    throw new Error('Download job not found.');
  }
  if (job.status !== 'failed') {
    throw new Error(`Only failed jobs can be rescheduled (current status: ${job.status}).`);
  }

  let targetIso: string | null = null;
  if (explicitScheduledFor && Date.parse(explicitScheduledFor) > Date.now() + 5000) {
    targetIso = new Date(Date.parse(explicitScheduledFor)).toISOString();
  }

  const payload = parseJobPayload(job.payload_json) as ScheduledDownloadPayload & {
    earlyAccessEndsAt?: string | null;
  };
  try {
    const rawParsed = job.payload_json ? JSON.parse(job.payload_json) : {};
    if (!targetIso && rawParsed?.earlyAccessEndsAt && Date.parse(rawParsed.earlyAccessEndsAt) > Date.now()) {
      targetIso = new Date(Date.parse(rawParsed.earlyAccessEndsAt) + 60_000).toISOString();
    }
  } catch {
    // ignore
  }

  // Probe Civitai version endpoint if we still don't have a future unlock time
  if (!targetIso && job.provider === 'civitai') {
    const urlVerMatch = String(job.source_url || '').match(/\/api\/download\/models\/(\d+)/i);
    const versionId = payload.civitaiMeta?.civitaiVersionId || (urlVerMatch ? urlVerMatch[1] : null);
    if (versionId) {
      const preferredDomain: CivitaiDomain = String(job.source_url || '').includes('civitai.red')
        ? 'civitai.red'
        : 'civitai.com';
      const verRes = await fetchCivitaiJsonWithFallback(
        `/api/v1/model-versions/${encodeURIComponent(String(versionId))}`,
        getCivitaiHeaders(),
        preferredDomain,
        8000
      );
      if (verRes?.data) {
        const ea = extractCivitaiEarlyAccessInfo(verRes.data);
        if (ea.earlyAccessEndsAt && Date.parse(ea.earlyAccessEndsAt) > Date.now()) {
          targetIso = new Date(Date.parse(ea.earlyAccessEndsAt) + 60_000).toISOString();
        }
      }
    }
  }

  if (!targetIso) {
    targetIso = new Date(Date.now() + 60 * 60_000).toISOString();
  }

  const nextPayload = JSON.stringify({ ...payload, retryCount: 0 });
  db.prepare(
    `UPDATE download_jobs
     SET status = 'scheduled', scheduled_for = ?, payload_json = ?, error_message = NULL, completed_at = NULL
     WHERE id = ?`
  ).run(targetIso, nextPayload, jobId);

  return db.prepare('SELECT * FROM download_jobs WHERE id = ?').get(jobId);
}

/**
 * Starts the background interval polling due scheduled Civitai Early Access downloads.
 */
export function startDownloadScheduler(): ReturnType<typeof setInterval> {
  if (schedulerTimer) return schedulerTimer;
  setTimeout(() => {
    processDueScheduledDownloads().catch(() => {});
  }, 3000);
  schedulerTimer = setInterval(() => {
    processDueScheduledDownloads().catch(() => {});
  }, SCHEDULER_INTERVAL_MS);
  return schedulerTimer;
}
