import { appConfig } from '../../config.ts';
import { resolveCivitaiDomain, type CivitaiDomain } from './civitaiUrlAndDomain.ts';

export interface CivitaiFetchOptions {
  bypassCache?: boolean;
  ttlMs?: number;
}

const CIVITAI_CACHE_MAX_ENTRIES = 250;
const CIVITAI_SEARCH_TTL_MS = 2 * 60_000;
const CIVITAI_DETAIL_TTL_MS = 10 * 60_000;
const CIVITAI_PROBE_MAX_ENTRIES = 500;
const CIVITAI_PROBE_TTL_MS = 10 * 60_000;

interface CivitaiJsonCacheEntry {
  value: { data: any; domain: CivitaiDomain };
  expiresAt: number;
}

const civitaiJsonCache = new Map<string, CivitaiJsonCacheEntry>();
const civitaiJsonInFlight = new Map<string, Promise<{ data: any; domain: CivitaiDomain } | null>>();
const civitaiDomainProbeCache = new Map<string, { domain: CivitaiDomain; expiresAt: number }>();
const civitaiDomainProbeInFlight = new Map<string, Promise<CivitaiDomain>>();

export function getCivitaiHeaders(): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (appConfig.civitaiApiKey) {
    headers.Authorization = `Bearer ${appConfig.civitaiApiKey}`;
  }
  return headers;
}

function resolveDefaultCivitaiTtlMs(cleanPath: string): number {
  if (cleanPath.startsWith('/api/v1/models?') || cleanPath.startsWith('/api/v1/images?tag=')) {
    return CIVITAI_SEARCH_TTL_MS;
  }
  return CIVITAI_DETAIL_TTL_MS;
}

function getCachedCivitaiJson(key: string): { data: any; domain: CivitaiDomain } | null {
  const entry = civitaiJsonCache.get(key);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    civitaiJsonCache.delete(key);
    return null;
  }
  // Bump to MRU position
  civitaiJsonCache.delete(key);
  civitaiJsonCache.set(key, entry);
  return entry.value;
}

function setCachedCivitaiJson(
  key: string,
  value: { data: any; domain: CivitaiDomain },
  ttlMs: number
): void {
  if (ttlMs <= 0) return;
  if (civitaiJsonCache.has(key)) {
    civitaiJsonCache.delete(key);
  } else if (civitaiJsonCache.size >= CIVITAI_CACHE_MAX_ENTRIES) {
    const oldestKey = civitaiJsonCache.keys().next().value;
    if (oldestKey !== undefined) {
      civitaiJsonCache.delete(oldestKey);
    }
  }
  civitaiJsonCache.set(key, { value, expiresAt: Date.now() + ttlMs });
}

/**
 * Clears in-memory Civitai HTTP and domain probe caches.
 */
export function clearCivitaiHttpCache(): void {
  civitaiJsonCache.clear();
  civitaiDomainProbeCache.clear();
}

/**
 * Queries a Civitai API path against `civitai.com` (or `preferredDomain`) first,
 * falling back to `civitai.red` when `.com` returns 404/non-OK.
 * Responses are cached in a bounded LRU TTL cache with in-flight deduplication unless `bypassCache` is true.
 */
export async function fetchCivitaiJsonWithFallback(
  apiPath: string,
  headers = getCivitaiHeaders(),
  preferredDomain: CivitaiDomain = 'civitai.com',
  timeoutMs = 8000,
  options?: CivitaiFetchOptions
): Promise<{ data: any; domain: CivitaiDomain } | null> {
  const cleanPath = apiPath.startsWith('/') ? apiPath : `/${apiPath}`;
  const authTag = headers?.Authorization ? 'auth' : 'anon';
  const cacheKey = `${authTag}:${preferredDomain}:${cleanPath}`;
  const bypassCache = Boolean(options?.bypassCache);
  const ttlMs = options?.ttlMs ?? resolveDefaultCivitaiTtlMs(cleanPath);

  if (!bypassCache) {
    const cached = getCachedCivitaiJson(cacheKey);
    if (cached) return cached;

    const pending = civitaiJsonInFlight.get(cacheKey);
    if (pending) return pending;
  }

  const runFetch = async (): Promise<{ data: any; domain: CivitaiDomain } | null> => {
    const domains: CivitaiDomain[] =
      preferredDomain === 'civitai.red'
        ? ['civitai.red', 'civitai.com']
        : ['civitai.com', 'civitai.red'];

    for (const domain of domains) {
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        const res = await fetch(`https://${domain}${cleanPath}`, {
          headers,
          signal: controller.signal,
        });
        clearTimeout(timer);
        if (res.ok) {
          const data = await res.json();
          const result = { data, domain };
          if (!bypassCache) {
            setCachedCivitaiJson(cacheKey, result, ttlMs);
          }
          return result;
        }
      } catch {
        // try fallback domain
      }
    }
    return null;
  };

  if (bypassCache) {
    return runFetch();
  }

  const promise = runFetch().finally(() => {
    civitaiJsonInFlight.delete(cacheKey);
  });
  civitaiJsonInFlight.set(cacheKey, promise);
  return promise;
}

/**
 * Fetches parent model details across `civitai.com` and `civitai.red` and reports which domain resolved it.
 * If `civitai.com` fails (e.g. 404 for a restricted model), `domain` is set to `'civitai.red'`.
 */
export async function fetchCivitaiParentModelWithDomain(
  modelId: string | number,
  headers = getCivitaiHeaders(),
  preferredDomain: CivitaiDomain = 'civitai.com',
  options?: CivitaiFetchOptions
): Promise<{ model: any | null; domain: CivitaiDomain }> {
  const cleanId = encodeURIComponent(String(modelId));
  const result = await fetchCivitaiJsonWithFallback(
    `/api/v1/models/${cleanId}`,
    headers,
    preferredDomain,
    8000,
    options
  );
  if (result) {
    const resolvedDomain = resolveCivitaiDomain(result.data, null, result.domain);
    return { model: result.data, domain: resolvedDomain };
  }
  return { model: null, domain: 'civitai.red' };
}

/**
 * Fetches full parent model details (`description`, `creator`, `name`) for a Civitai model ID.
 */
export async function fetchCivitaiParentModel(
  modelId: string | number,
  headers = getCivitaiHeaders()
): Promise<any | null> {
  const res = await fetchCivitaiParentModelWithDomain(modelId, headers);
  return res.model;
}

/**
 * Probes `https://civitai.com/models/{id}` when metadata flags alone did not indicate `civitai.red`.
 * If `civitai.com` returns 404/403/451 for the model web page, returns `'civitai.red'`.
 */
export async function probeCivitaiWebDomain(
  modelId: string | number | null | undefined,
  currentDomain: CivitaiDomain,
  options?: { bypassCache?: boolean }
): Promise<CivitaiDomain> {
  if (currentDomain === 'civitai.red' || !modelId) return currentDomain;
  const cacheKey = String(modelId).trim();
  if (!cacheKey) return currentDomain;

  if (!options?.bypassCache) {
    const cached = civitaiDomainProbeCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.domain;
    }
    const pending = civitaiDomainProbeInFlight.get(cacheKey);
    if (pending) return pending;
  }

  const runProbe = async (): Promise<CivitaiDomain> => {
    let resolved: CivitaiDomain = currentDomain;
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 3500);
      const res = await fetch(`https://civitai.com/models/${encodeURIComponent(cacheKey)}`, {
        method: 'HEAD',
        redirect: 'manual',
        signal: controller.signal,
      });
      clearTimeout(timer);
      if (res.status === 404 || res.status === 451 || res.status === 403) {
        resolved = 'civitai.red';
      }
      if (civitaiDomainProbeCache.size >= CIVITAI_PROBE_MAX_ENTRIES) {
        const oldestKey = civitaiDomainProbeCache.keys().next().value;
        if (oldestKey !== undefined) civitaiDomainProbeCache.delete(oldestKey);
      }
      civitaiDomainProbeCache.set(cacheKey, {
        domain: resolved,
        expiresAt: Date.now() + CIVITAI_PROBE_TTL_MS,
      });
    } catch {
      // keep currentDomain without caching transient network timeouts
    }
    return resolved;
  };

  if (options?.bypassCache) {
    return runProbe();
  }

  const promise = runProbe().finally(() => {
    civitaiDomainProbeInFlight.delete(cacheKey);
  });
  civitaiDomainProbeInFlight.set(cacheKey, promise);
  return promise;
}
