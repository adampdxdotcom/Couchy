import { db } from '../db.ts';

/**
 * Computes a cheap (~0.01ms) SQLite write stamp combining the connection-local
 * `total_changes()` counter with `PRAGMA data_version` (external connection writes).
 * Any INSERT/UPDATE/DELETE immediately invalidates cached read projections.
 */
export function getDbChangeStamp(): string {
  const tcRow = db.prepare('SELECT total_changes() AS tc').get() as { tc?: number } | undefined;
  const dvRow = db.prepare('PRAGMA data_version').get() as { data_version?: number } | undefined;
  return `${Number(tcRow?.tc ?? 0)}:${Number(dvRow?.data_version ?? 0)}`;
}

interface StampedCatalogEntry {
  stamp: string;
  value: unknown;
}

const MAX_CATALOG_ENTRIES = 16;
const catalogCache = new Map<string, StampedCatalogEntry>();

/** Clears all in-memory stamped catalog caches (primarily for diagnostics/tests). */
export function invalidateStampedCatalogCache(): void {
  catalogCache.clear();
}

/**
 * Returns a cached catalog projection for the current SQLite change stamp, or runs `builder` once
 * and caches its output until any SQLite write advances the stamp.
 */
export function getOrBuildStampedCatalog<T>(cacheKey: string, builder: () => T): T {
  const stamp = getDbChangeStamp();
  const existing = catalogCache.get(cacheKey);
  if (existing && existing.stamp === stamp) {
    return existing.value as T;
  }

  // Prune stale stamp entries before storing the freshly built catalog
  for (const [key, entry] of catalogCache.entries()) {
    if (entry.stamp !== stamp) {
      catalogCache.delete(key);
    }
  }
  if (catalogCache.size >= MAX_CATALOG_ENTRIES) {
    const oldestKey = catalogCache.keys().next().value;
    if (oldestKey !== undefined) {
      catalogCache.delete(oldestKey);
    }
  }

  const value = builder();
  catalogCache.set(cacheKey, { stamp, value });
  return value;
}
