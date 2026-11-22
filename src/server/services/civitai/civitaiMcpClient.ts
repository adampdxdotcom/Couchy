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

  async verifyAccountReady(): Promise<void> {
    const info = await this.callTool<any>('whoami', {});
    if (info?.muted === true || info?.isMuted === true) {
      throw new Error('Your Civitai account is currently muted and cannot create posts.');
    }
    if (info?.isOnboarded === false) {
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
    image: { uuid: string; width: number; height: number };
  }): Promise<{ postId: number; processingImageIds: number[] }> {
    const args: Record<string, unknown> = {
      images: [
        {
          uuid: params.image.uuid,
          width: params.image.width,
          height: params.image.height,
          type: 'image',
        },
      ],
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
}
