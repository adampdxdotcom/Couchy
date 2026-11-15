import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { db } from '../db.ts';
import { appConfig } from '../config.ts';
import { logger } from '../logger.ts';
import type { ModelCleanupCandidate, ModelCleanupStatus } from '../../shared/types.ts';

const MODEL_EXTS = new Set(['.safetensors', '.ckpt', '.pt', '.pth', '.bin', '.gguf', '.sft']);
const COPY_STABILITY_MS = 60_000;
const CLEANUP_TICK_MS = 15 * 60_000;
const DEFAULT_RETENTION_HOURS = 24;

let isCleanupRunning = false;
let cleanupTimer: ReturnType<typeof setInterval> | null = null;
let lastScanAt: string | null = null;
let lastDeletedCount = 0;
let lastDeletedBytes = 0;
let lastCleanupAt: string | null = null;

interface DiskModelEntry {
  fullPath: string;
  filename: string;
  size: number;
  mtimeMs: number;
}

function isPathInsideDir(targetPath: string, rootDir: string): boolean {
  const resolvedTarget = path.resolve(targetPath);
  const resolvedRoot = path.resolve(rootDir);
  if (resolvedTarget === resolvedRoot) return false;
  return resolvedTarget.startsWith(resolvedRoot + path.sep);
}

function hasDirectoryOverlap(dirA: string, dirB: string): boolean {
  const a = path.resolve(dirA);
  const b = path.resolve(dirB);
  return a === b || a.startsWith(b + path.sep) || b.startsWith(a + path.sep);
}

function walkModelFiles(rootDir: string): DiskModelEntry[] {
  const results: DiskModelEntry[] = [];
  if (!rootDir || !fs.existsSync(rootDir)) return results;

  const walk = (dir: string) => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
      } else if (entry.isFile() && MODEL_EXTS.has(path.extname(entry.name).toLowerCase())) {
        try {
          const stat = fs.statSync(fullPath);
          if (stat.size > 0) {
            results.push({
              fullPath,
              filename: entry.name,
              size: stat.size,
              mtimeMs: Math.round(stat.mtimeMs),
            });
          }
        } catch {
          // Ignore unreadable/vanished transient file
        }
      }
    }
  };

  walk(rootDir);
  return results;
}

/**
 * Computes SHA-256 via streaming I/O so multi-gigabyte models can be verified without high RAM usage.
 */
function computeFileSha256Stream(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath, { highWaterMark: 4 * 1024 * 1024 });
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('error', reject);
    stream.on('end', () => resolve(hash.digest('hex').toLowerCase()));
  });
}

export function getModelCleanupSettings(): { enabled: boolean; retentionHours: number } {
  const enabledRow = db
    .prepare("SELECT value FROM app_settings WHERE key = 'auto_clean_copied_models'")
    .get() as { value: string } | undefined;
  const hoursRow = db
    .prepare("SELECT value FROM app_settings WHERE key = 'auto_clean_copied_models_hours'")
    .get() as { value: string } | undefined;

  const enabled = enabledRow ? enabledRow.value === '1' : false;
  const parsedHours = hoursRow ? Number(hoursRow.value) : DEFAULT_RETENTION_HOURS;
  const retentionHours =
    Number.isFinite(parsedHours) && parsedHours >= 0
      ? Math.min(8760, Math.round(parsedHours))
      : DEFAULT_RETENTION_HOURS;

  return { enabled, retentionHours };
}

export function updateModelCleanupSettings(params: {
  enabled?: boolean;
  retentionHours?: number;
}): { enabled: boolean; retentionHours: number } {
  if (params.enabled !== undefined) {
    db.prepare(
      `INSERT INTO app_settings (key, value, updated_at)
       VALUES ('auto_clean_copied_models', ?, datetime('now'))
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`
    ).run(params.enabled ? '1' : '0');
  }
  if (params.retentionHours !== undefined) {
    const clamped = Number.isFinite(Number(params.retentionHours))
      ? Math.max(0, Math.min(8760, Math.round(Number(params.retentionHours))))
      : DEFAULT_RETENTION_HOURS;
    db.prepare(
      `INSERT INTO app_settings (key, value, updated_at)
       VALUES ('auto_clean_copied_models_hours', ?, datetime('now'))
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`
    ).run(String(clamped));
  }
  return getModelCleanupSettings();
}

/**
 * Returns the cached cleanup status and candidate list from SQLite without touching disk.
 */
export function getModelCleanupStatus(): ModelCleanupStatus {
  const { enabled, retentionHours } = getModelCleanupSettings();
  const sameDirectoryConflict = hasDirectoryOverlap(
    appConfig.downloadsDir,
    appConfig.comfyuiModelsDir
  );

  const rows = db
    .prepare(
      `SELECT download_path, filename, file_size, comfy_path, verified_sha256, verified_at
       FROM downloaded_model_copies
       WHERE verified_at IS NOT NULL AND comfy_path IS NOT NULL AND verified_sha256 IS NOT NULL
       ORDER BY verified_at ASC`
    )
    .all() as {
    download_path: string;
    filename: string;
    file_size: number;
    comfy_path: string;
    verified_sha256: string;
    verified_at: string;
  }[];

  const nowMs = Date.now();
  const retentionMs = retentionHours * 3_600_000;
  const candidates: ModelCleanupCandidate[] = [];
  let totalReclaimableBytes = 0;
  let eligibleCount = 0;

  for (const row of rows) {
    if (!fs.existsSync(row.download_path)) continue;
    const verifiedMs = Date.parse(row.verified_at);
    if (!Number.isFinite(verifiedMs)) continue;
    const eligibleMs = verifiedMs + retentionMs;
    const msRemaining = Math.max(0, eligibleMs - nowMs);
    const isEligible = nowMs >= eligibleMs;
    if (isEligible) eligibleCount += 1;
    totalReclaimableBytes += row.file_size;

    candidates.push({
      downloadPath: row.download_path,
      comfyPath: row.comfy_path,
      filename: row.filename,
      fileSize: row.file_size,
      verifiedSha256: row.verified_sha256,
      verifiedAt: row.verified_at,
      eligibleAt: new Date(eligibleMs).toISOString(),
      hoursRemaining: Number((msRemaining / 3_600_000).toFixed(1)),
      isEligible,
    });
  }

  return {
    enabled,
    retentionHours,
    downloadsDir: appConfig.downloadsDir,
    comfyuiModelsDir: appConfig.comfyuiModelsDir,
    sameDirectoryConflict,
    isScanning: isCleanupRunning,
    lastScanAt,
    lastDeletedCount,
    lastDeletedBytes,
    lastCleanupAt,
    totalReclaimableBytes,
    eligibleCount,
    candidates,
  };
}

/**
 * Scans `DOWNLOADS_DIR` vs `COMFYUI_MODELS_DIR` to verify copied models via exact byte size + SHA-256,
 * and deletes Couchy's duplicate copy from `DOWNLOADS_DIR` when eligible and enabled (or forced).
 * Never modifies or deletes anything inside `COMFYUI_MODELS_DIR`.
 */
export async function scanAndCleanCopiedDownloads(options?: {
  deleteEligible?: boolean;
  forceImmediate?: boolean;
}): Promise<{ status: ModelCleanupStatus; deletedFiles: string[]; freedBytes: number }> {
  if (isCleanupRunning) {
    return { status: getModelCleanupStatus(), deletedFiles: [], freedBytes: 0 };
  }

  const { enabled, retentionHours } = getModelCleanupSettings();
  const shouldDelete = options?.deleteEligible ?? enabled;
  const forceImmediate = Boolean(options?.forceImmediate);

  if (hasDirectoryOverlap(appConfig.downloadsDir, appConfig.comfyuiModelsDir)) {
    lastScanAt = new Date().toISOString();
    return { status: getModelCleanupStatus(), deletedFiles: [], freedBytes: 0 };
  }

  isCleanupRunning = true;
  const deletedFiles: string[] = [];
  let freedBytes = 0;

  try {
    const nowIso = new Date().toISOString();
    const nowMs = Date.now();
    const downloadFiles = walkModelFiles(appConfig.downloadsDir);
    const comfyFiles = walkModelFiles(appConfig.comfyuiModelsDir);

    const activeJobPaths = new Set(
      (
        db
          .prepare(
            `SELECT destination_path FROM download_jobs
             WHERE status IN ('downloading', 'pending', 'scheduled')`
          )
          .all() as { destination_path: string }[]
      ).map((r) => path.resolve(r.destination_path))
    );

    const comfyByLowerName = new Map<string, DiskModelEntry[]>();
    for (const cf of comfyFiles) {
      const key = cf.filename.toLowerCase();
      const list = comfyByLowerName.get(key);
      if (list) list.push(cf);
      else comfyByLowerName.set(key, [cf]);
    }

    const existingRows = new Map<string, any>();
    for (const r of db.prepare('SELECT * FROM downloaded_model_copies').all() as any[]) {
      existingRows.set(r.download_path, r);
    }

    const seenDownloadPaths = new Set<string>();
    const upsertStmt = db.prepare(`
      INSERT INTO downloaded_model_copies
        (download_path, filename, file_size, dl_mtime_ms, comfy_path, comfy_mtime_ms, verified_sha256, verified_at, last_checked_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(download_path) DO UPDATE SET
        filename = excluded.filename,
        file_size = excluded.file_size,
        dl_mtime_ms = excluded.dl_mtime_ms,
        comfy_path = excluded.comfy_path,
        comfy_mtime_ms = excluded.comfy_mtime_ms,
        verified_sha256 = excluded.verified_sha256,
        verified_at = excluded.verified_at,
        last_checked_at = excluded.last_checked_at
    `);

    for (const dl of downloadFiles) {
      const resolvedDl = path.resolve(dl.fullPath);
      if (!isPathInsideDir(resolvedDl, appConfig.downloadsDir)) continue;
      if (activeJobPaths.has(resolvedDl)) continue;

      seenDownloadPaths.add(dl.fullPath);
      const cached = existingRows.get(dl.fullPath);
      const sizeMatches = (comfyFiles.length > 0 && comfyByLowerName.get(dl.filename.toLowerCase())) || [];
      const candidates = sizeMatches.filter(
        (cf) => cf.size === dl.size && nowMs - cf.mtimeMs >= COPY_STABILITY_MS
      );

      let matchedComfy: DiskModelEntry | null = null;
      let verifiedSha256: string | null = null;
      let verifiedAt: string | null = null;

      if (candidates.length > 0) {
        // Reuse previously verified SHA-256 if neither file's size/mtime changed
        if (
          cached &&
          cached.verified_at &&
          cached.verified_sha256 &&
          cached.file_size === dl.size &&
          cached.dl_mtime_ms === dl.mtimeMs
        ) {
          const sameComfy = candidates.find(
            (cf) => cf.fullPath === cached.comfy_path && cf.mtimeMs === cached.comfy_mtime_ms
          );
          if (sameComfy) {
            matchedComfy = sameComfy;
            verifiedSha256 = cached.verified_sha256;
            verifiedAt = cached.verified_at;
          }
        }

        if (!matchedComfy) {
          const dlSha = await computeFileSha256Stream(dl.fullPath);
          for (const cf of candidates) {
            const comfySha = await computeFileSha256Stream(cf.fullPath);
            if (comfySha === dlSha) {
              matchedComfy = cf;
              verifiedSha256 = dlSha;
              // Preserve earliest verification timestamp if already verified for this exact hash
              verifiedAt =
                cached?.verified_sha256 === dlSha && cached?.verified_at
                  ? cached.verified_at
                  : nowIso;
              break;
            }
          }
        }
      }

      upsertStmt.run(
        dl.fullPath,
        dl.filename,
        dl.size,
        dl.mtimeMs,
        matchedComfy?.fullPath ?? null,
        matchedComfy?.mtimeMs ?? null,
        verifiedSha256,
        verifiedAt,
        nowIso
      );

      // Delete Couchy's duplicate in DOWNLOADS_DIR if verified copy is eligible
      if (shouldDelete && matchedComfy && verifiedAt && verifiedSha256) {
        const verifiedMs = Date.parse(verifiedAt);
        const retentionMs = retentionHours * 3_600_000;
        const isDue = forceImmediate || (Number.isFinite(verifiedMs) && nowMs - verifiedMs >= retentionMs);

        if (isDue) {
          try {
            // Final pre-delete double check: paths stay within their own roots and sizes still match
            if (
              isPathInsideDir(dl.fullPath, appConfig.downloadsDir) &&
              isPathInsideDir(matchedComfy.fullPath, appConfig.comfyuiModelsDir) &&
              fs.existsSync(dl.fullPath) &&
              fs.existsSync(matchedComfy.fullPath) &&
              fs.statSync(matchedComfy.fullPath).size === dl.size &&
              !activeJobPaths.has(resolvedDl)
            ) {
              fs.unlinkSync(dl.fullPath);
              db.prepare('DELETE FROM downloaded_model_copies WHERE download_path = ?').run(dl.fullPath);
              // Point inventory record to ComfyUI's read-only copy so metadata & installed state stay intact
              db.prepare(
                `UPDATE models
                 SET file_path = ?,
                     download_file_path = NULL,
                     comfyui_path = COALESCE(comfyui_path, ?),
                     is_installed = 1,
                     last_seen_at = datetime('now')
                 WHERE LOWER(filename) = LOWER(?)`
              ).run(matchedComfy.fullPath, dl.filename, dl.filename);

              deletedFiles.push(dl.filename);
              freedBytes += dl.size;
              logger.info(
                'ModelCleanup',
                `Deleted duplicate ${dl.filename} from ${appConfig.downloadsDir} (${(
                  dl.size /
                  (1024 * 1024)
                ).toFixed(1)} MB freed; verified copy at ${matchedComfy.fullPath})`
              );
            }
          } catch (err: any) {
            logger.warn('ModelCleanup', `Failed to remove duplicate ${dl.fullPath}: ${err?.message}`);
          }
        }
      }
    }

    // Remove tracking entries for files no longer present in DOWNLOADS_DIR
    for (const oldPath of existingRows.keys()) {
      if (!seenDownloadPaths.has(oldPath)) {
        db.prepare('DELETE FROM downloaded_model_copies WHERE download_path = ?').run(oldPath);
      }
    }

    lastScanAt = nowIso;
    if (deletedFiles.length > 0) {
      lastDeletedCount = deletedFiles.length;
      lastDeletedBytes = freedBytes;
      lastCleanupAt = nowIso;
    }
  } catch (err: any) {
    logger.error('ModelCleanup', 'Model cleanup scan failed', err);
  } finally {
    isCleanupRunning = false;
  }

  return { status: getModelCleanupStatus(), deletedFiles, freedBytes };
}

/**
 * Starts the 15-minute background scan for copied downloads cleanup.
 */
export function startModelCleanupScheduler(): ReturnType<typeof setInterval> {
  if (cleanupTimer) return cleanupTimer;
  cleanupTimer = setInterval(() => {
    scanAndCleanCopiedDownloads().catch(() => {});
  }, CLEANUP_TICK_MS);
  return cleanupTimer;
}
