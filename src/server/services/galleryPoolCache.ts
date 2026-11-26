import { getDbChangeStamp } from './stampedCatalogCache.ts';
import type { ImageRecord } from '../../shared/types.ts';

/** Re-exported SQLite write stamp used to auto-invalidate cached gallery pools. */
export const getGalleryDbChangeStamp = getDbChangeStamp;

interface HydratedPoolEntry {
  stamp: string;
  items: ImageRecord[];
}

interface CollapsedPoolEntry {
  stamp: string;
  items: ImageRecord[];
}

const MAX_COLLAPSED_ENTRIES = 6;

let hydratedNoVisualCache: HydratedPoolEntry | null = null;
let hydratedWithVisualCache: HydratedPoolEntry | null = null;
const collapsedPoolCache = new Map<string, CollapsedPoolEntry>();

/** Clears all in-memory gallery pool caches (primarily for diagnostics/tests). */
export function invalidateGalleryPoolCache(): void {
  hydratedNoVisualCache = null;
  hydratedWithVisualCache = null;
  collapsedPoolCache.clear();
}

/**
 * Returns the cached hydrated ImageRecord[] for the current DB stamp, or runs `builder` once
 * and caches the result until any SQLite write changes the stamp.
 */
export function getOrBuildHydratedGalleryPool(
  includeVisualTags: boolean,
  builder: () => ImageRecord[]
): ImageRecord[] {
  const stamp = getGalleryDbChangeStamp();
  const existing = includeVisualTags ? hydratedWithVisualCache : hydratedNoVisualCache;
  if (existing && existing.stamp === stamp) {
    return existing.items;
  }

  const items = builder();
  const entry: HydratedPoolEntry = { stamp, items };
  if (includeVisualTags) {
    hydratedWithVisualCache = entry;
  } else {
    hydratedNoVisualCache = entry;
  }
  return items;
}

/**
 * Returns the cached collapsed Series Stack pool for the given `(rejectedMode, archivedMode, includeVisualTags)`
 * combination under the current DB stamp, keeping page flips, sorts, and facet filters sub-5ms.
 */
export function getOrBuildCollapsedGalleryPool(
  cacheKey: string,
  builder: () => ImageRecord[]
): ImageRecord[] {
  const stamp = getGalleryDbChangeStamp();
  const existing = collapsedPoolCache.get(cacheKey);
  if (existing && existing.stamp === stamp) {
    return existing.items;
  }

  // Prune stale stamp entries before inserting the new pool
  for (const [k, v] of collapsedPoolCache.entries()) {
    if (v.stamp !== stamp) {
      collapsedPoolCache.delete(k);
    }
  }
  if (collapsedPoolCache.size >= MAX_COLLAPSED_ENTRIES) {
    const oldestKey = collapsedPoolCache.keys().next().value;
    if (oldestKey !== undefined) {
      collapsedPoolCache.delete(oldestKey);
    }
  }

  const items = builder();
  collapsedPoolCache.set(cacheKey, { stamp, items });
  return items;
}
