export const CIVITAI_MCP_URL = 'https://mcp.civitai.com/mcp';

/**
 * Thrown when Civitai rejects an uploaded image because of payload or file size limits.
 */
export class CivitaiPayloadTooLargeError extends Error {
  readonly code = 'PAYLOAD_TOO_LARGE' as const;
  constructor(message: string) {
    super(message);
    this.name = 'CivitaiPayloadTooLargeError';
  }
}

export interface CivitaiMcpClientDeps {
  endpointUrl?: string;
  fetchFn?: typeof fetch;
}

interface JsonRpcEnvelope {
  id?: number;
  result?: any;
  error?: { code?: number; message?: string; data?: any };
}

function isSizeLimitErrorMessage(status: number, message: string): boolean {
  if (status === 413) return true;
  return /too large|payload.*large|size limit|exceeds.*(mb|mib|bytes|size)|max.*size|413/i.test(
    message
  );
}

/**
 * Parses either raw JSON or SSE (`data: {...}`) MCP HTTP responses.
 */
export function parseMcpResponseBody(rawText: string): JsonRpcEnvelope {
  const trimmed = rawText.trim();
  if (!trimmed) {
    throw new Error('Empty response from Civitai MCP server.');
  }
  if (trimmed.startsWith('{')) {
    return JSON.parse(trimmed) as JsonRpcEnvelope;
  }
  const dataLines = trimmed
    .split(/\r?\n/)
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice(5).trim())
    .filter(Boolean);

  for (let i = dataLines.length - 1; i >= 0; i--) {
    try {
      return JSON.parse(dataLines[i]) as JsonRpcEnvelope;
    } catch {
      // continue searching SSE data frames
    }
  }
  throw new Error(`Unexpected Civitai MCP response format: ${trimmed.slice(0, 200)}`);
}

function extractToolResultPayload(toolResult: any): any {
  if (!toolResult || typeof toolResult !== 'object') return toolResult;
  if (toolResult.structuredContent && typeof toolResult.structuredContent === 'object') {
    return toolResult.structuredContent;
  }
  const firstText = Array.isArray(toolResult.content)
    ? toolResult.content.find((c: any) => c?.type === 'text' && typeof c.text === 'string')?.text
    : undefined;
  if (typeof firstText === 'string') {
    const trimmed = firstText.trim();
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
      try {
        return JSON.parse(trimmed);
      } catch {
        return { message: firstText };
      }
    }
    return { message: firstText };
  }
  return toolResult;
}

/**
 * Opens a short-lived Streamable HTTP MCP session against Civitai using a personal API key
 * and executes deterministic tool calls (`whoami`, `upload_image`, `create_post` with publish=false).
 */
export class CivitaiMcpClient {
  private readonly endpointUrl: string;
  private readonly fetchFn: typeof fetch;
  private readonly apiKey: string;
  private sessionId: string | null = null;
  private nextId = 1;

  constructor(apiKey: string, deps?: CivitaiMcpClientDeps) {
    this.apiKey = apiKey.trim();
    this.endpointUrl = deps?.endpointUrl || CIVITAI_MCP_URL;
    this.fetchFn = deps?.fetchFn || fetch;
  }

  private async postJsonRpc(body: Record<string, unknown>): Promise<{ status: number; envelope: JsonRpcEnvelope | null }> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      Authorization: `Bearer ${this.apiKey}`,
    };
    if (this.sessionId) {
      headers['mcp-session-id'] = this.sessionId;
    }

    const res = await this.fetchFn(this.endpointUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });

    const sid = res.headers.get('mcp-session-id');
    if (sid) this.sessionId = sid;

    const text = await res.text();
    if (!res.ok) {
      if (isSizeLimitErrorMessage(res.status, text)) {
        throw new CivitaiPayloadTooLargeError(
          `Civitai rejected image upload due to file size limits (HTTP ${res.status}).`
        );
      }
      throw new Error(`Civitai MCP HTTP ${res.status}: ${text.slice(0, 300)}`);
    }

    if (!text.trim()) {
      return { status: res.status, envelope: null };
    }
    const envelope = parseMcpResponseBody(text);
    if (envelope.error) {
      const msg = envelope.error.message || 'Civitai MCP JSON-RPC error';
      if (isSizeLimitErrorMessage(res.status, msg)) {
        throw new CivitaiPayloadTooLargeError(msg);
      }
      throw new Error(msg);
    }
    return { status: res.status, envelope };
  }

  async initialize(): Promise<void> {
    await this.postJsonRpc({
      jsonrpc: '2.0',
      id: this.nextId++,
      method: 'initialize',
      params: {
        protocolVersion: '2025-03-26',
        capabilities: {},
        clientInfo: { name: 'couchy', version: '0.1.0' },
      },
    });
    await this.postJsonRpc({
      jsonrpc: '2.0',
      method: 'notifications/initialized',
    });
  }

  async callTool<T = any>(name: string, args: Record<string, unknown>): Promise<T> {
    const { envelope } = await this.postJsonRpc({
      jsonrpc: '2.0',
      id: this.nextId++,
      method: 'tools/call',
      params: { name, arguments: args },
    });

    const result = envelope?.result;
    const payload = extractToolResultPayload(result);
    if (result?.isError) {
      const errMsg =
        typeof payload?.message === 'string'
          ? payload.message
          : typeof payload?.error === 'string'
          ? payload.error
          : JSON.stringify(payload || 'Civitai tool call failed');
      if (isSizeLimitErrorMessage(400, errMsg)) {
        throw new CivitaiPayloadTooLargeError(errMsg);
      }
      throw new Error(errMsg);
    }
    return payload as T;
  }

  async getWhoAmI(): Promise<{
    username: string | null;
    muted?: boolean;
    isOnboarded?: boolean;
  }> {
    const info = await this.callTool<any>('whoami', {});
    const username =
      typeof info?.username === 'string' && info.username.trim()
        ? info.username.trim()
        : typeof info?.user?.username === 'string' && info.user.username.trim()
        ? info.user.username.trim()
        : null;
    return {
      username,
      muted: Boolean(info?.muted ?? info?.isMuted),
      isOnboarded: info?.isOnboarded !== false,
    };
  }

  async verifyAccountReady(): Promise<void> {
    const info = await this.getWhoAmI();
    if (info.muted) {
      throw new Error('Your Civitai account is currently muted and cannot create posts.');
    }
    if (info.isOnboarded === false) {
      throw new Error(
        'Your Civitai account has not completed onboarding. Sign in on civitai.com once to accept terms before creating drafts.'
      );
    }
  }

  async uploadImage(params: {
    base64Data: string;
    contentType: string;
  }): Promise<{ uuid: string; width?: number; height?: number }> {
    const res = await this.callTool<any>('upload_image', {
      data: params.base64Data,
      contentType: params.contentType,
    });
    const uuid = res?.uuid || res?.id || res?.imageUuid;
    if (!uuid || typeof uuid !== 'string') {
      throw new Error('Civitai upload_image did not return an image UUID.');
    }
    return {
      uuid,
      width: typeof res.width === 'number' ? res.width : undefined,
      height: typeof res.height === 'number' ? res.height : undefined,
    };
  }

  async createDraftPost(params: {
    title?: string;
    detail?: string;
    tags?: string[];
    modelVersionId?: number | null;
    image?: { uuid: string; width: number; height: number };
    images?: Array<{ uuid: string; width: number; height: number }>;
  }): Promise<{ postId: number; processingImageIds: number[] }> {
    const imageList =
      Array.isArray(params.images) && params.images.length > 0
        ? params.images
        : params.image
        ? [params.image]
        : [];
    if (imageList.length === 0 || imageList.length > 20) {
      throw new Error(`Civitai create_post requires between 1 and 20 images (got ${imageList.length}).`);
    }

    const args: Record<string, unknown> = {
      images: imageList.map((img) => ({
        uuid: img.uuid,
        width: img.width,
        height: img.height,
        type: 'image',
      })),
      publish: false, // Always draft-only; never auto-publish
    };
    if (params.title && params.title.trim()) args.title = params.title.trim();
    if (params.detail && params.detail.trim()) args.detail = params.detail.trim();
    if (Array.isArray(params.tags) && params.tags.length > 0) args.tags = params.tags;
    if (params.modelVersionId && Number(params.modelVersionId) > 0) {
      args.modelVersionId = Number(params.modelVersionId);
    }

    const res = await this.callTool<any>('create_post', args);
    const rawPostId = res?.id ?? res?.postId ?? res?.post?.id;
    const postId = Number(rawPostId);
    if (!Number.isInteger(postId) || postId <= 0) {
      throw new Error('Civitai create_post did not return a valid post ID.');
    }
    const processingImageIds = Array.isArray(res?.processingImageIds)
      ? res.processingImageIds.map(Number).filter(Number.isFinite)
      : [];
    return { postId, processingImageIds };
  }

  /**
   * Calls Civitai MCP `list_comments` for an image, post, or model entity and normalizes the thread.
   */
  async listComments(params: {
    entityType: 'image' | 'post' | 'model';
    entityId: number;
    depth?: number;
    sort?: 'Oldest' | 'Newest';
    includeFull?: boolean;
  }): Promise<NormalizedMcpComment[]> {
    const res = await this.callTool<any>('list_comments', {
      entityType: params.entityType,
      entityId: params.entityId,
      depth: params.depth ?? 2,
      sort: params.sort ?? 'Newest',
      includeFull: params.includeFull ?? true,
    });
    return normalizeCivitaiMcpComments(res);
  }
}

export interface NormalizedMcpComment {
  id: number;
  authorUsername: string;
  authorAvatarUrl: string | null;
  content: string;
  createdAt: string | null;
  reactionCount: number;
  heartCount: number;
  parentCommentId: number | null;
  depth: number;
  isPinned: boolean;
}

/**
 * Strips restricted HTML tags returned by Civitai comments into clean plain text.
 */
export function stripCivitaiCommentHtml(raw: string): string {
  return String(raw || '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>\s*<p[^>]*>/gi, '\n\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function sumCommentReactions(raw: any): { reactionCount: number; heartCount: number } {
  if (!raw || typeof raw !== 'object') return { reactionCount: 0, heartCount: 0 };
  if (Array.isArray(raw.reactions)) {
    let total = 0;
    let hearts = 0;
    for (const r of raw.reactions) {
      const cnt = Math.max(0, Number(r?.count ?? r?.total ?? 1));
      total += cnt;
      if (String(r?.reaction || '').toLowerCase() === 'heart') {
        hearts += cnt;
      }
    }
    return { reactionCount: total, heartCount: hearts };
  }
  const stats = raw.stats && typeof raw.stats === 'object' ? raw.stats : raw;
  const heartCount = Math.max(0, Number(stats.heartCount || 0));
  const likeCount = Math.max(0, Number(stats.likeCount || 0));
  const laughCount = Math.max(0, Number(stats.laughCount || 0));
  const cryCount = Math.max(0, Number(stats.cryCount || 0));
  const explicitTotal = Number(raw.reactionCount ?? stats.reactionCount ?? 0);
  const sum = heartCount + likeCount + laughCount + cryCount;
  return {
    reactionCount: Math.max(sum, Number.isFinite(explicitTotal) ? explicitTotal : 0),
    heartCount,
  };
}

/**
 * Flattens structured Civitai `list_comments` payloads (with nested replies) into normalized entries.
 */
export function normalizeCivitaiMcpComments(payload: any): NormalizedMcpComment[] {
  const candidates: any[] = Array.isArray(payload)
    ? payload
    : Array.isArray(payload?.comments)
    ? payload.comments
    : Array.isArray(payload?.items)
    ? payload.items
    : Array.isArray(payload?.threads)
    ? payload.threads
    : Array.isArray(payload?.results)
    ? payload.results
    : Array.isArray(payload?.data)
    ? payload.data
    : [];

  const out: NormalizedMcpComment[] = [];
  const seenIds = new Set<number>();

  const visit = (item: any, depth: number, parentId: number | null) => {
    if (!item || typeof item !== 'object') return;
    const id = Number(item.id ?? item.commentId ?? 0);
    const text = stripCivitaiCommentHtml(
      item.content ?? item.body ?? item.text ?? item.message ?? ''
    );
    const authorUsername = String(
      item.user?.username ??
        item.author?.username ??
        (typeof item.author === 'string' ? item.author : '') ??
        item.username ??
        'Civitai User'
    ).trim();
    const authorAvatarUrl =
      typeof item.user?.image === 'string'
        ? item.user.image
        : typeof item.author?.image === 'string'
        ? item.author.image
        : null;
    const createdAt =
      typeof item.createdAt === 'string'
        ? item.createdAt
        : typeof item.created_at === 'string'
        ? item.created_at
        : null;
    const resolvedParent =
      item.parentId != null
        ? Number(item.parentId)
        : item.parentCommentId != null
        ? Number(item.parentCommentId)
        : parentId;

    const { reactionCount, heartCount } = sumCommentReactions(item);

    if (Number.isInteger(id) && id > 0 && text && !seenIds.has(id) && !item.hidden) {
      seenIds.add(id);
      out.push({
        id,
        authorUsername: authorUsername || 'Civitai User',
        authorAvatarUrl,
        content: text,
        createdAt,
        reactionCount,
        heartCount,
        parentCommentId: resolvedParent && Number.isInteger(resolvedParent) ? resolvedParent : null,
        depth,
        isPinned: Boolean(item.pinned ?? item.isPinned),
      });
    }

    const nested = Array.isArray(item.replies)
      ? item.replies
      : Array.isArray(item.children)
      ? item.children
      : Array.isArray(item.comments)
      ? item.comments
      : [];
    for (const child of nested) {
      visit(child, Math.min(depth + 1, 3), Number.isInteger(id) && id > 0 ? id : parentId);
    }
  };

  for (const item of candidates) {
    visit(item, 0, null);
  }
  return out;
}

