import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { Readable } from 'stream';
import { db } from '../db.ts';
import { appConfig } from '../config.ts';
import {
  extractCivitaiEarlyAccessInfo,
  fetchCivitaiJsonWithFallback,
  getCivitaiHeaders,
  rewriteCivitaiDownloadUrl,
  type CivitaiDomain,
  type CivitaiNormalizedMeta,
} from './civitai/civitaiHttpAndParse.ts';
import { finalizeCompletedModelDownload } from './modelDownloadPostProcess.ts';
import type {
  CharacterDownloadAutomation,
  ComfyModelSubfolder,
  LoraCategory,
  LoraMentionAutomation,
  ModelType,
} from '../../shared/types.ts';

export interface ScheduledDownloadPayload {
  subfolder: ComfyModelSubfolder;
  allowOverwrite: boolean;
  hfRepoId?: string | null;
  civitaiMeta?: Partial<CivitaiNormalizedMeta> | null;
  loraCategory?: LoraCategory | null;
  characterAutomation?: CharacterDownloadAutomation | null;
  mentionAutomation?: LoraMentionAutomation | null;
  retryCount?: number;
}

export interface ExecuteDownloadJobParams {
  provider: 'civitai' | 'huggingface' | 'direct';
  modelName: string;
  safeFilename: string;
  effectiveModelType: ModelType;
  destinationPath: string;
  sourceUrl: string;
  expectedHash?: string | null;
  hfRepoId?: string | null;
  civitaiMeta?: Partial<CivitaiNormalizedMeta> | null;
  loraCategory?: LoraCategory | null;
  characterAutomation?: CharacterDownloadAutomation | null;
  mentionAutomation?: LoraMentionAutomation | null;
  /** When true, caller handles HTTP 401/403 re-scheduling instead of marking failed immediately. */
  deferAuthErrorToCaller?: boolean;
}

// Single authoritative in-memory registries shared across immediate dispatch and recovery polls
const activeDownloadControllers = new Map<number, AbortController>();
const executingDownloadJobIds = new Set<number>();
const cancelledDownloadJobIds = new Set<number>();

/**
 * Synchronously reserves `jobId` as pending/active before async scheduling (`setImmediate` / metadata refresh)
 * so orphan-recovery polls cannot adopt and double-execute the same job.
 */
export function markDownloadJobPending(jobId: number): void {
  if (Number.isFinite(jobId) && jobId > 0) {
    executingDownloadJobIds.add(jobId);
  }
}

export function clearDownloadJobPending(jobId: number): void {
  executingDownloadJobIds.delete(jobId);
}

export function isDownloadJobActive(jobId: number): boolean {
  return activeDownloadControllers.has(jobId) || executingDownloadJobIds.has(jobId);
}

/**
 * Aborts an actively streaming download job if one is running for `jobId`.
 */
export function abortActiveDownloadStream(jobId: number): boolean {
  cancelledDownloadJobIds.add(jobId);
  executingDownloadJobIds.delete(jobId);
  const controller = activeDownloadControllers.get(jobId);
  if (controller) {
    controller.abort();
    activeDownloadControllers.delete(jobId);
    return true;
  }
  return false;
}

/**
 * Aborts all actively streaming download jobs.
 */
export function abortAllActiveDownloadStreams(): number {
  let count = 0;
  for (const [jobId, controller] of activeDownloadControllers.entries()) {
    cancelledDownloadJobIds.add(jobId);
    controller.abort();
    activeDownloadControllers.delete(jobId);
    count += 1;
  }
  return count;
}

/**
 * Best-effort lookup for Civitai Early Access unlock dates when a download returns HTTP 401/403,
 * persisting `earlyAccessEndsAt` on the job payload so the scheduler UI can offer unlock scheduling.
 */
async function probeCivitaiEarlyAccessOnAuthError(
  jobId: number,
  params: ExecuteDownloadJobParams
): Promise<string | null> {
  try {
    const urlVerMatch = params.sourceUrl.match(/\/api\/download\/models\/(\d+)/i);
    const versionId = params.civitaiMeta?.civitaiVersionId || (urlVerMatch ? urlVerMatch[1] : null);
    if (!versionId) return null;

    const preferredDomain: CivitaiDomain = /civitai\.red/i.test(params.sourceUrl)
      ? 'civitai.red'
      : 'civitai.com';
    const verRes = await fetchCivitaiJsonWithFallback(
      `/api/v1/model-versions/${encodeURIComponent(String(versionId))}`,
      getCivitaiHeaders(),
      preferredDomain,
      6000,
      { bypassCache: true }
    );
    if (!verRes?.data) return null;

    const ea = extractCivitaiEarlyAccessInfo(verRes.data);
    if (!ea.earlyAccessEndsAt || Date.parse(ea.earlyAccessEndsAt) <= Date.now()) {
      return null;
    }

    const row = db
      .prepare('SELECT payload_json FROM download_jobs WHERE id = ?')
      .get(jobId) as { payload_json: string | null } | undefined;
    if (row) {
      let existingPayload: Record<string, any> = {};
      try {
        existingPayload = row.payload_json ? JSON.parse(row.payload_json) : {};
      } catch {
        existingPayload = {};
      }
      existingPayload.earlyAccessEndsAt = ea.earlyAccessEndsAt;
      db.prepare('UPDATE download_jobs SET payload_json = ? WHERE id = ?').run(
        JSON.stringify(existingPayload),
        jobId
      );
    }
    return ea.earlyAccessEndsAt;
  } catch {
    return null;
  }
}

/**
 * Streams a remote model file to disk (.part.<jobId> -> atomic rename), verifies SHA-256,
 * and delegates DB registration, Civitai previews, and ComfyUI inventory sync.
 */
export async function executeDownloadJob(
  jobId: number,
  params: ExecuteDownloadJobParams
): Promise<void> {
  // Single-flight guard: never allow two workers to stream/rename the same jobId concurrently
  if (activeDownloadControllers.has(jobId)) {
    return;
  }

  // Scope temp file per jobId so concurrent or overlapping jobs never clobber/unlink each other's .part file
  const partPath = `${params.destinationPath}.part.${jobId}`;
  cancelledDownloadJobIds.delete(jobId);
  executingDownloadJobIds.add(jobId);
  const abortController = new AbortController();
  activeDownloadControllers.set(jobId, abortController);
  let fileStream: fs.WriteStream | null = null;

  try {
    fs.mkdirSync(path.dirname(params.destinationPath), { recursive: true });

    const headers: Record<string, string> = {};
    if (params.provider === 'civitai' && appConfig.civitaiApiKey) {
      headers.Authorization = `Bearer ${appConfig.civitaiApiKey}`;
    } else if (params.provider === 'huggingface' && appConfig.hfApiToken) {
      headers.Authorization = `Bearer ${appConfig.hfApiToken}`;
    }

    let res = await fetch(params.sourceUrl, { headers, signal: abortController.signal });
    if ((!res.ok || !res.body) && /^https?:\/\/(www\.)?civitai\.(com|red)\//i.test(params.sourceUrl)) {
      const altDomain: CivitaiDomain = /civitai\.red/i.test(params.sourceUrl)
        ? 'civitai.com'
        : 'civitai.red';
      const altUrl = rewriteCivitaiDownloadUrl(params.sourceUrl, altDomain);
      const retryRes = await fetch(altUrl, { headers, signal: abortController.signal });
      if (retryRes.ok && retryRes.body) {
        res = retryRes;
      }
    }

    if (!res.ok || !res.body) {
      if ((res.status === 401 || res.status === 403) && params.provider === 'civitai') {
        const discoveredEndsAt = await probeCivitaiEarlyAccessOnAuthError(jobId, params);
        const unlockHint = discoveredEndsAt
          ? `Early Access active until ${new Date(discoveredEndsAt).toLocaleString()} — click Schedule After Unlock below to queue it automatically.`
          : 'Early Access or Creator permission required — check CIVITAI_API_KEY or wait until early access ends';
        const authErr: any = new Error(`Civitai returned HTTP ${res.status} (${unlockHint})`);
        authErr.httpStatus = res.status;
        throw authErr;
      }
      throw new Error(`Download failed with HTTP ${res.status}`);
    }

    const totalBytes = Number(res.headers.get('content-length') || 0);
    db.prepare('UPDATE download_jobs SET total_bytes = ? WHERE id = ?').run(totalBytes, jobId);

    const hash = crypto.createHash('sha256');
    fileStream = fs.createWriteStream(partPath);
    let bytesDownloaded = 0;
    let lastUpdate = Date.now();

    const nodeReadable = Readable.fromWeb(res.body as any);
    for await (const chunk of nodeReadable) {
      if (abortController.signal.aborted || cancelledDownloadJobIds.has(jobId)) {
        nodeReadable.destroy();
        throw new Error('Download cancelled by user.');
      }
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      hash.update(buf);
      fileStream.write(buf);
      bytesDownloaded += buf.length;

      if (Date.now() - lastUpdate > 400) {
        db.prepare('UPDATE download_jobs SET bytes_downloaded = ? WHERE id = ?').run(
          bytesDownloaded,
          jobId
        );
        lastUpdate = Date.now();
      }
    }

    await new Promise<void>((resolve, reject) => {
      fileStream!.end((err?: Error | null) => (err ? reject(err) : resolve()));
    });
    fileStream = null;

    if (abortController.signal.aborted || cancelledDownloadJobIds.has(jobId)) {
      throw new Error('Download cancelled by user.');
    }

    const actualHash = hash.digest('hex').toUpperCase();
    const expected = params.expectedHash ? params.expectedHash.trim().toUpperCase() : null;
    const hashVerified = expected ? actualHash === expected || actualHash.startsWith(expected) : true;

    if (expected && !hashVerified) {
      fs.unlinkSync(partPath);
      throw new Error(`Hash mismatch: expected ${expected}, got ${actualHash}`);
    }

    fs.renameSync(partPath, params.destinationPath);
    await finalizeCompletedModelDownload(jobId, params, bytesDownloaded, actualHash, hashVerified);
  } catch (err: any) {
    if (fileStream) {
      try {
        fileStream.destroy();
      } catch {
        // ignore
      }
    }
    if (fs.existsSync(partPath)) {
      try {
        fs.unlinkSync(partPath);
      } catch {
        // ignore cleanup error
      }
    }
    const wasCancelled =
      cancelledDownloadJobIds.has(jobId) ||
      abortController.signal.aborted ||
      err?.name === 'AbortError';
    if (wasCancelled) {
      db.prepare(`DELETE FROM download_jobs WHERE id = ? AND status IN ('downloading', 'queued')`).run(
        jobId
      );
      return;
    }
    if (params.deferAuthErrorToCaller && (err?.httpStatus === 401 || err?.httpStatus === 403)) {
      throw err;
    }
    db.prepare(
      `UPDATE download_jobs
       SET status = 'failed', error_message = ?, completed_at = datetime('now')
       WHERE id = ?`
    ).run(err?.message || 'Download error', jobId);
  } finally {
    activeDownloadControllers.delete(jobId);
    executingDownloadJobIds.delete(jobId);
    cancelledDownloadJobIds.delete(jobId);
  }
}
