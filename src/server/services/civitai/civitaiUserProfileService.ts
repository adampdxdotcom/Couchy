import { db } from '../../db.ts';
import { appConfig } from '../../config.ts';
import { getCivitaiHeaders } from './civitaiHttpClient.ts';
import { CivitaiMcpClient } from './civitaiMcpClient.ts';
import type {
  CivitaiUserProfileBadge,
  CivitaiUserProfileLink,
  CivitaiUserProfileResponse,
  CivitaiUserProfileStats,
} from '../../../shared/apiTypes.ts';

function getAppSetting(key: string): string | null {
  const row = db.prepare(`SELECT value FROM app_settings WHERE key = ?`).get(key) as
    | { value: string }
    | undefined;
  return row?.value ?? null;
}

function setAppSetting(key: string, value: string): void {
  db.prepare(
    `INSERT INTO app_settings (key, value, updated_at)
     VALUES (?, ?, datetime('now'))
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`
  ).run(key, value);
}

const PROFILE_CACHE_TTL_MS = 5 * 60 * 1000;
const CIVITAI_IMAGE_CDN_BASE = 'https://image.civitai.com/xG1nkqKTMzGDvpLrqFT7WA';

let cachedProfile: { fetchedAt: number; keyPrefix: string; data: CivitaiUserProfileResponse } | null =
  null;

export interface CivitaiUserProfileDeps {
  apiKey?: string;
  fetchFn?: typeof fetch;
  whoamiFn?: () => Promise<{
    userId?: number | null;
    username: string | null;
    tier?: string | null;
    muted?: boolean;
    isOnboarded?: boolean;
    isModerator?: boolean;
    raw?: Record<string, any> | null;
  }>;
}

/** Clears cached Civitai user profile (primarily for tests or after key changes). */
export function clearCivitaiUserProfileCache(): void {
  cachedProfile = null;
}

/** Validates external HTTP(S) URLs so untrusted/javascript: links are never rendered. */
function toSafeHttpUrl(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

/** Resolves either a full Civitai URL or a bare Civitai CDN image UUID into a renderable image URL. */
function resolveCivitaiImageUrl(raw: unknown, opts?: { original?: boolean }): string | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const direct = toSafeHttpUrl(trimmed);
  if (direct) return direct;
  // Civitai tRPC often returns bare image UUIDs for avatars, banners, and cosmetic badges
  if (/^[a-zA-Z0-9_-]{12,}$/.test(trimmed)) {
    return opts?.original
      ? `${CIVITAI_IMAGE_CDN_BASE}/${encodeURIComponent(trimmed)}/original=true/${encodeURIComponent(trimmed)}`
      : `${CIVITAI_IMAGE_CDN_BASE}/${encodeURIComponent(trimmed)}/width=450/${encodeURIComponent(trimmed)}.jpeg`;
  }
  return null;
}

/** Strips HTML tags cleanly into readable plain text for bios/descriptions. */
function stripHtmlToText(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const cleaned = raw
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return cleaned || null;
}

function toFiniteNumberOrNull(val: unknown): number | null {
  if (val === null || val === undefined || val === '') return null;
  const n = Number(val);
  return Number.isFinite(n) ? n : null;
}

function readCouchyCivitaiSummary(): CivitaiUserProfileResponse['couchySummary'] {
  const charRow = db
    .prepare(
      `SELECT
         COUNT(*) AS totalCount,
         SUM(CASE WHEN COALESCE(allow_civitai_share, 0) = 1 THEN 1 ELSE 0 END) AS eligibleCount
       FROM characters`
    )
    .get() as { totalCount?: number; eligibleCount?: number } | undefined;

  const draftRow = db
    .prepare(
      `SELECT
         SUM(CASE WHEN status = 'draft' THEN 1 ELSE 0 END) AS draftCount,
         SUM(CASE WHEN status = 'published' THEN 1 ELSE 0 END) AS publishedCount
       FROM image_civitai_drafts`
    )
    .get() as { draftCount?: number; publishedCount?: number } | undefined;

  const modelRow = db
    .prepare(
      `SELECT COUNT(*) AS ownCount FROM models WHERE COALESCE(is_own_civitai_upload, 0) = 1`
    )
    .get() as { ownCount?: number } | undefined;

  return {
    eligibleCharacterCount: Number(charRow?.eligibleCount || 0),
    totalCharacterCount: Number(charRow?.totalCount || 0),
    sharedDraftCount: Number(draftRow?.draftCount || 0),
    publishedPostCount: Number(draftRow?.publishedCount || 0),
    ownUploadedModelsCount: Number(modelRow?.ownCount || 0),
  };
}

async function fetchJsonWithTimeout(
  url: string,
  headers: Record<string, string>,
  fetchFn: typeof fetch,
  timeoutMs = 6000
): Promise<any | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchFn(url, { headers, signal: controller.signal });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function unwrapTrpcPayload(raw: any): any | null {
  if (!raw || typeof raw !== 'object') return null;
  const data = raw?.result?.data;
  if (!data || typeof data !== 'object') return null;
  return data.json ?? data;
}

function extractBadgesAndNameplate(profileObj: any): {
  badges: CivitaiUserProfileBadge[];
  nameplate: { name: string | null; color: string | null } | null;
} {
  const badges: CivitaiUserProfileBadge[] = [];
  const seenBadgeKeys = new Set<string>();
  let nameplate: { name: string | null; color: string | null } | null = null;

  const cosmetics: any[] = Array.isArray(profileObj?.cosmetics) ? profileObj.cosmetics : [];
  for (const entry of cosmetics) {
    const cosmetic = entry?.cosmetic ?? entry;
    if (!cosmetic || typeof cosmetic !== 'object') continue;
    const type = String(cosmetic.type || '').toLowerCase();
    const data = cosmetic.data && typeof cosmetic.data === 'object' ? cosmetic.data : {};

    if (type === 'badge') {
      const id = cosmetic.id ?? cosmetic.name ?? `badge-${badges.length}`;
      const name = String(cosmetic.name || data.name || 'Badge').trim();
      const dedupeKey = `${id}:${name.toLowerCase()}`;
      if (seenBadgeKeys.has(dedupeKey)) continue;
      seenBadgeKeys.add(dedupeKey);
      badges.push({
        id,
        name,
        description: stripHtmlToText(cosmetic.description ?? data.description),
        imageUrl: resolveCivitaiImageUrl(data.url ?? cosmetic.url, { original: true }),
        animated: Boolean(data.animated),
      });
    } else if (type === 'nameplate' && !nameplate) {
      const color =
        typeof data.color === 'string' && /^#[0-9a-fA-F]{3,8}$/.test(data.color.trim())
          ? data.color.trim()
          : null;
      nameplate = {
        name: typeof cosmetic.name === 'string' ? cosmetic.name.trim() : null,
        color,
      };
    }
  }

  return { badges, nameplate };
}

function extractLinks(profileObj: any): CivitaiUserProfileLink[] {
  const rawLinks = Array.isArray(profileObj?.links) ? profileObj.links : [];
  const result: CivitaiUserProfileLink[] = [];
  const seen = new Set<string>();
  for (const item of rawLinks) {
    const safeUrl = toSafeHttpUrl(item?.url);
    if (!safeUrl || seen.has(safeUrl)) continue;
    seen.add(safeUrl);
    result.push({
      url: safeUrl,
      type: typeof item?.type === 'string' && item.type.trim() ? item.type.trim() : 'Website',
    });
  }
  return result;
}

/**
 * Fetches and aggregates the authenticated Civitai user's profile across MCP `whoami`,
 * REST `/api/v1/me`, and public/authenticated Civitai profile enrichment (avatar, cover,
 * bio, social links, equipped badges, and creator stats), plus local Couchy counts.
 */
export async function getCivitaiUserProfile(options?: {
  forceRefresh?: boolean;
  deps?: CivitaiUserProfileDeps;
}): Promise<CivitaiUserProfileResponse> {
  const apiKey = (options?.deps?.apiKey ?? appConfig.civitaiApiKey ?? '').trim();
  const hasCivitaiKey = Boolean(apiKey);
  const couchySummary = readCouchyCivitaiSummary();

  if (!hasCivitaiKey) {
    return {
      hasCivitaiKey: false,
      connected: false,
      error: 'CIVITAI_API_KEY is not configured.',
      syncedAt: new Date().toISOString(),
      userId: null,
      username: null,
      tier: null,
      status: null,
      isMember: false,
      subscriptions: [],
      isOnboarded: null,
      muted: false,
      isModerator: false,
      createdAt: null,
      avatarUrl: null,
      coverImageUrl: null,
      bio: null,
      location: null,
      nameplate: null,
      badges: [],
      links: [],
      stats: {
        uploadCount: null,
        followerCount: null,
        followingCount: null,
        downloadCount: null,
        thumbsUpCount: null,
        generationCount: null,
        tippedAmountCount: null,
        leaderboardPosition: null,
        leaderboardId: null,
      },
      profileUrl: null,
      accountSettingsUrl: 'https://civitai.com/user/account',
      couchySummary,
    };
  }

  const keyPrefix = apiKey.slice(0, 8);
  if (
    !options?.forceRefresh &&
    !options?.deps &&
    cachedProfile &&
    cachedProfile.keyPrefix === keyPrefix &&
    Date.now() - cachedProfile.fetchedAt < PROFILE_CACHE_TTL_MS
  ) {
    return { ...cachedProfile.data, couchySummary };
  }

  const fetchFn = options?.deps?.fetchFn ?? fetch;
  const headers: Record<string, string> = {
    ...getCivitaiHeaders(),
    Authorization: `Bearer ${apiKey}`,
    Accept: 'application/json',
  };

  // Run MCP whoami and REST /api/v1/me in parallel for core identity & membership
  const whoamiPromise = (async () => {
    try {
      if (options?.deps?.whoamiFn) {
        return await options.deps.whoamiFn();
      }
      const mcp = new CivitaiMcpClient(apiKey, { fetchFn });
      return await mcp.getWhoAmI();
    } catch {
      return null;
    }
  })();

  const restMePromise = fetchJsonWithTimeout('https://civitai.com/api/v1/me', headers, fetchFn);
  const [whoami, restMe] = await Promise.all([whoamiPromise, restMePromise]);

  const storedUsername = getAppSetting('civitai_account_username')?.trim() || null;
  const username =
    (typeof whoami?.username === 'string' && whoami.username.trim()) ||
    (typeof restMe?.username === 'string' && restMe.username.trim()) ||
    storedUsername ||
    null;

  if (username && username !== storedUsername && !options?.deps) {
    setAppSetting('civitai_account_username', username);
    setAppSetting('civitai_account_username_ts', String(Date.now()));
  }

  const userId =
    toFiniteNumberOrNull(whoami?.userId) ?? toFiniteNumberOrNull(restMe?.id) ?? null;

  // Enrich with Civitai profile data (avatar, cover, bio, links, badges, stats) if username resolved
  let richProfile: any = null;
  let creatorObj: any = null;
  if (username) {
    const trpcInput = encodeURIComponent(JSON.stringify({ json: { username } }));
    const [profileRaw, creatorRaw] = await Promise.all([
      fetchJsonWithTimeout(
        `https://civitai.com/api/trpc/userProfile.get?input=${trpcInput}`,
        headers,
        fetchFn
      ),
      fetchJsonWithTimeout(
        `https://civitai.com/api/trpc/user.getCreator?input=${trpcInput}`,
        headers,
        fetchFn
      ),
    ]);
    richProfile = unwrapTrpcPayload(profileRaw);
    creatorObj = unwrapTrpcPayload(creatorRaw);
  }

  const mergedProfile = richProfile || creatorObj || {};
  const profileSub = mergedProfile?.profile || {};
  const statsObj = mergedProfile?.stats || creatorObj?.stats || {};
  const rankObj = mergedProfile?.rank || creatorObj?.rank || {};

  const { badges, nameplate } = extractBadgesAndNameplate(
    richProfile?.cosmetics ? richProfile : creatorObj || {}
  );
  const links = extractLinks(richProfile?.links ? richProfile : creatorObj || {});

  const subscriptions: string[] = Array.isArray(restMe?.subscriptions)
    ? restMe.subscriptions.map((s: unknown) => String(s)).filter(Boolean)
    : [];

  const tier =
    (typeof restMe?.tier === 'string' && restMe.tier.trim()) ||
    (typeof whoami?.tier === 'string' && whoami.tier.trim()) ||
    (typeof mergedProfile?.tier === 'string' && mergedProfile.tier.trim()) ||
    null;

  const connected = Boolean(whoami || restMe || richProfile || creatorObj);
  const stats: CivitaiUserProfileStats = {
    uploadCount: toFiniteNumberOrNull(
      statsObj.uploadCountAllTime ?? statsObj.uploadCount ?? mergedProfile?._count?.models
    ),
    followerCount: toFiniteNumberOrNull(
      statsObj.followerCountAllTime ?? statsObj.followerCount
    ),
    followingCount: toFiniteNumberOrNull(
      statsObj.followingCountAllTime ?? statsObj.followingCount
    ),
    downloadCount: toFiniteNumberOrNull(
      statsObj.downloadCountAllTime ?? statsObj.downloadCount
    ),
    thumbsUpCount: toFiniteNumberOrNull(
      statsObj.thumbsUpCountAllTime ?? statsObj.thumbsUpCount ?? statsObj.favoriteCountAllTime
    ),
    generationCount: toFiniteNumberOrNull(
      statsObj.generationCountAllTime ?? statsObj.generationCount
    ),
    tippedAmountCount: toFiniteNumberOrNull(
      statsObj.tippedAmountCountAllTime ?? statsObj.tippedAmountCount
    ),
    leaderboardPosition: toFiniteNumberOrNull(rankObj.leaderboardRank ?? rankObj.leaderboardPosition),
    leaderboardId:
      typeof rankObj.leaderboardId === 'string' && rankObj.leaderboardId.trim()
        ? rankObj.leaderboardId.trim()
        : null,
  };

  const response: CivitaiUserProfileResponse = {
    hasCivitaiKey: true,
    connected,
    error: connected
      ? null
      : 'Could not reach Civitai right now. Verify your CIVITAI_API_KEY and internet access.',
    syncedAt: new Date().toISOString(),
    userId: userId ?? toFiniteNumberOrNull(mergedProfile?.id),
    username,
    tier,
    status: typeof restMe?.status === 'string' && restMe.status.trim() ? restMe.status.trim() : null,
    isMember: Boolean(restMe?.isMember || (tier && tier.toLowerCase() !== 'free')),
    subscriptions,
    isOnboarded: whoami ? Boolean(whoami.isOnboarded) : null,
    muted: Boolean(whoami?.muted),
    isModerator: Boolean(whoami?.isModerator || mergedProfile?.isModerator),
    createdAt:
      typeof mergedProfile?.createdAt === 'string'
        ? mergedProfile.createdAt
        : typeof creatorObj?.createdAt === 'string'
        ? creatorObj.createdAt
        : null,
    avatarUrl:
      resolveCivitaiImageUrl(mergedProfile?.profilePicture?.url) ??
      resolveCivitaiImageUrl(mergedProfile?.image) ??
      resolveCivitaiImageUrl(creatorObj?.image) ??
      null,
    coverImageUrl:
      resolveCivitaiImageUrl(profileSub?.coverImage?.url) ??
      resolveCivitaiImageUrl(mergedProfile?.coverImage?.url) ??
      null,
    bio: stripHtmlToText(profileSub?.bio ?? profileSub?.message ?? mergedProfile?.bio),
    location:
      typeof profileSub?.location === 'string' && profileSub.location.trim()
        ? profileSub.location.trim()
        : null,
    nameplate,
    badges,
    links,
    stats,
    profileUrl: username ? `https://civitai.com/user/${encodeURIComponent(username)}` : null,
    accountSettingsUrl: 'https://civitai.com/user/account',
    couchySummary,
  };

  if (!options?.deps && connected) {
    cachedProfile = { fetchedAt: Date.now(), keyPrefix, data: response };
  }

  return response;
}
