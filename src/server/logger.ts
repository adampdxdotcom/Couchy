import fs from 'fs';
import path from 'path';
import { appConfig } from './config.ts';

const MAX_LOG_BYTES = 5 * 1024 * 1024; // 5 MB per file (max 2 files = 10 MB total)
const LOG_FILE_PATH = path.join(appConfig.logsDir, 'couchy.log');
const ROTATED_LOG_FILE_PATH = path.join(appConfig.logsDir, 'couchy.log.1');

type LogLevel = 'INFO' | 'WARN' | 'ERROR';

function formatDetailSuffix(details?: unknown): string {
  if (details === undefined || details === null) return '';
  if (details instanceof Error) {
    return ` | ${details.message}`;
  }
  if (typeof details === 'string') {
    return details.trim() ? ` | ${details.trim()}` : '';
  }
  try {
    return ` | ${JSON.stringify(details)}`;
  } catch {
    return ` | ${String(details)}`;
  }
}

/**
 * Rotates `couchy.log` -> `couchy.log.1` when size reaches 5 MB and appends the new line.
 * Wrapped in a silent try/catch so ENOSPC (disk full) never crashes the process.
 */
function appendToRotatingFile(line: string): void {
  try {
    fs.mkdirSync(appConfig.logsDir, { recursive: true });
    if (fs.existsSync(LOG_FILE_PATH)) {
      const stat = fs.statSync(LOG_FILE_PATH);
      if (stat.size >= MAX_LOG_BYTES) {
        try {
          if (fs.existsSync(ROTATED_LOG_FILE_PATH)) {
            fs.unlinkSync(ROTATED_LOG_FILE_PATH);
          }
          fs.renameSync(LOG_FILE_PATH, ROTATED_LOG_FILE_PATH);
        } catch {
          // Ignore rotation errors and continue
        }
      }
    }
    fs.appendFileSync(LOG_FILE_PATH, `${line}\n`, 'utf8');
  } catch {
    // Fail-safe: never throw if disk is full (ENOSPC) or read-only
  }
}

function writeLog(level: LogLevel, scope: string, message: string, details?: unknown): void {
  const now = new Date();
  const timeShort = now.toTimeString().slice(0, 8);
  const isoTimestamp = now.toISOString();
  const detailSuffix = formatDetailSuffix(details);

  const consoleLine = `[${timeShort}] [${level}] [${scope}] ${message}${detailSuffix}`;
  if (level === 'ERROR') {
    console.error(consoleLine);
  } else if (level === 'WARN') {
    console.warn(consoleLine);
  } else {
    console.log(consoleLine);
  }

  const fileLine = `[${isoTimestamp}] [${level}] [${scope}] ${message}${detailSuffix}`;
  appendToRotatingFile(fileLine);
}

/**
 * Dual terminal + size-capped rotating file logger (`couchy.log`, 5 MB max x 2 files).
 */
export const logger = {
  logFilePath: LOG_FILE_PATH,
  info: (scope: string, message: string, details?: unknown) =>
    writeLog('INFO', scope, message, details),
  warn: (scope: string, message: string, details?: unknown) =>
    writeLog('WARN', scope, message, details),
  error: (scope: string, message: string, details?: unknown) =>
    writeLog('ERROR', scope, message, details),
};
