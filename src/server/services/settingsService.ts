import { db } from '../db.ts';

const UPSERT_SETTING_SQL = `
  INSERT INTO app_settings (key, value, updated_at)
  VALUES (?, ?, datetime('now'))
  ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')
`;

/**
 * Fetches multiple keys (or all rows when `keys` is omitted) from `app_settings`
 * in a single SELECT query.
 */
export function getSettingsMap(keys?: readonly string[]): Map<string, string> {
  if (keys && keys.length === 0) {
    return new Map();
  }

  const rows = keys
    ? (db
        .prepare(
          `SELECT key, value FROM app_settings WHERE key IN (${keys.map(() => '?').join(', ')})`
        )
        .all(...keys) as { key: string; value: string }[])
    : (db.prepare('SELECT key, value FROM app_settings').all() as {
        key: string;
        value: string;
      }[]);

  return new Map(rows.map((r) => [r.key, r.value]));
}

/**
 * Reads a string setting from `app_settings` (or an optional pre-fetched map).
 */
export function getSetting(
  key: string,
  defaultValue?: string,
  prefetched?: ReadonlyMap<string, string>
): string | undefined {
  if (prefetched) {
    return prefetched.has(key) ? prefetched.get(key) : defaultValue;
  }
  const row = db
    .prepare('SELECT value FROM app_settings WHERE key = ?')
    .get(key) as { value: string } | undefined;
  return row !== undefined ? row.value : defaultValue;
}

/**
 * Parses a boolean setting supporting both `'1'/'0'` and `'true'/'false'` values.
 */
export function getBoolSetting(
  key: string,
  defaultValue = false,
  prefetched?: ReadonlyMap<string, string>
): boolean {
  const raw = getSetting(key, undefined, prefetched);
  if (raw === undefined) return defaultValue;
  const normalized = raw.trim().toLowerCase();
  if (normalized === '1' || normalized === 'true') return true;
  if (normalized === '0' || normalized === 'false') return false;
  return defaultValue;
}

/**
 * Parses a finite numeric setting with fallback to `defaultValue`.
 */
export function getNumberSetting(
  key: string,
  defaultValue: number,
  prefetched?: ReadonlyMap<string, string>
): number {
  const raw = getSetting(key, undefined, prefetched);
  if (raw === undefined || raw.trim() === '') return defaultValue;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : defaultValue;
}

/**
 * Parses a JSON-encoded setting with safe fallback on missing or invalid JSON.
 */
export function getJsonSetting<T>(
  key: string,
  defaultValue: T,
  prefetched?: ReadonlyMap<string, string>
): T {
  const raw = getSetting(key, undefined, prefetched);
  if (!raw) return defaultValue;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return defaultValue;
  }
}

/**
 * Upserts a single string value into `app_settings`.
 */
export function setSetting(key: string, value: string): void {
  db.prepare(UPSERT_SETTING_SQL).run(key, value);
}

/**
 * Upserts a boolean value into `app_settings`, preserving `'1'/'0'` or `'true'/'false'` storage format.
 */
export function setBoolSetting(
  key: string,
  enabled: boolean,
  format: '1_0' | 'true_false' = '1_0'
): void {
  const serialized = format === 'true_false' ? (enabled ? 'true' : 'false') : enabled ? '1' : '0';
  setSetting(key, serialized);
}

/**
 * Serializes and upserts a JSON value into `app_settings`.
 */
export function setJsonSetting(key: string, value: unknown): void {
  setSetting(key, JSON.stringify(value));
}

/**
 * Batch-upserts multiple `[key, value]` pairs in a single SQLite transaction.
 */
export function setSettings(entries: ReadonlyArray<readonly [string, string]>): void {
  if (entries.length === 0) return;
  const stmt = db.prepare(UPSERT_SETTING_SQL);
  const tx = db.transaction((items: ReadonlyArray<readonly [string, string]>) => {
    for (const [key, value] of items) {
      stmt.run(key, value);
    }
  });
  tx(entries);
}
