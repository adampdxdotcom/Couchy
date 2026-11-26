import { db } from '../../db.ts';
import { appConfig } from '../../config.ts';
import type { LmStudioGuidingTemplate, LmStudioStatus } from '../../../shared/types.ts';
import {
  DEFAULT_CONVERSATION_SYSTEM_PROMPT,
  DEFAULT_BATCH_EXPANSION_PROMPT,
} from '../../../shared/agentPromptDefaults.ts';

export { DEFAULT_CONVERSATION_SYSTEM_PROMPT, DEFAULT_BATCH_EXPANSION_PROMPT };

const LM_STATUS_CACHE_TTL_MS = 5000;
const lmStatusCache = new Map<string, { expiresAt: number; status: LmStudioStatus }>();
const lmStatusInFlight = new Map<string, Promise<LmStudioStatus>>();

/** Clears cached Local LLM health probes (called after settings or template edits). */
export function invalidateLmStudioStatusCache(): void {
  lmStatusCache.clear();
}

function mapGuidingRow(row: any): LmStudioGuidingTemplate {
  return {
    id: row.id,
    name: row.name,
    systemPrompt: row.system_prompt,
    userPromptTemplate: row.user_prompt_template,
    isDefault: Boolean(row.is_default),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * Lists all saved LM Studio Guiding Prompt Templates from SQLite.
 */
export function listLmStudioGuidingTemplates(): LmStudioGuidingTemplate[] {
  const rows = db
    .prepare('SELECT * FROM lm_studio_prompt_templates ORDER BY is_default DESC, id ASC')
    .all() as any[];
  return rows.map(mapGuidingRow);
}

/**
 * Creates or updates a saved LM Studio Guiding Prompt Template.
 */
export function saveLmStudioGuidingTemplate(payload: {
  id?: number;
  name: string;
  systemPrompt: string;
  userPromptTemplate: string;
  isDefault?: boolean;
}): { template: LmStudioGuidingTemplate; items: LmStudioGuidingTemplate[] } {
  if (!payload.name?.trim() || !payload.systemPrompt?.trim()) {
    throw new Error('Template name and system prompt are required.');
  }

  const tx = db.transaction(() => {
    if (payload.isDefault) {
      db.prepare('UPDATE lm_studio_prompt_templates SET is_default = 0').run();
    }
    if (payload.id) {
      db.prepare(
        `UPDATE lm_studio_prompt_templates
         SET name = ?, system_prompt = ?, user_prompt_template = ?,
             is_default = CASE WHEN ? = 1 THEN 1 ELSE is_default END,
             updated_at = datetime('now')
         WHERE id = ?`
      ).run(
        payload.name.trim(),
        payload.systemPrompt.trim(),
        (payload.userPromptTemplate || '').trim(),
        payload.isDefault ? 1 : 0,
        Number(payload.id)
      );
      return Number(payload.id);
    }

    const info = db
      .prepare(
        `INSERT INTO lm_studio_prompt_templates (name, system_prompt, user_prompt_template, is_default)
         VALUES (?, ?, ?, ?)`
      )
      .run(
        payload.name.trim(),
        payload.systemPrompt.trim(),
        (payload.userPromptTemplate || '').trim(),
        payload.isDefault ? 1 : 0
      );
    return Number(info.lastInsertRowid);
  });

  const savedId = tx();
  invalidateLmStudioStatusCache();
  const savedRow = db.prepare('SELECT * FROM lm_studio_prompt_templates WHERE id = ?').get(savedId);
  return {
    template: mapGuidingRow(savedRow),
    items: listLmStudioGuidingTemplates(),
  };
}

/**
 * Deletes a saved LM Studio Guiding Prompt Template, promoting the oldest remaining one to default if needed.
 */
export function deleteLmStudioGuidingTemplate(id: number): LmStudioGuidingTemplate[] {
  db.prepare('DELETE FROM lm_studio_prompt_templates WHERE id = ?').run(id);
  const def = db.prepare('SELECT id FROM lm_studio_prompt_templates WHERE is_default = 1').get();
  if (!def) {
    const first = db
      .prepare('SELECT id FROM lm_studio_prompt_templates ORDER BY id ASC LIMIT 1')
      .get() as { id: number } | undefined;
    if (first) {
      db.prepare('UPDATE lm_studio_prompt_templates SET is_default = 1 WHERE id = ?').run(first.id);
    }
  }
  invalidateLmStudioStatusCache();
  return listLmStudioGuidingTemplates();
}

/**
 * Retrieves current Local LLM settings from SQLite.
 */
export function getLmStudioSettings(): {
  baseUrl: string;
  selectedModel: string;
  followLoadedModel: boolean;
  systemPrompt: string;
  conversationSystemPrompt: string;
  batchExpansionPrompt: string;
} {
  const row = db.prepare('SELECT * FROM lm_studio_settings WHERE id = 1').get() as any;
  if (!row) {
    return {
      baseUrl: appConfig.lmStudioUrl,
      selectedModel: '',
      followLoadedModel: true,
      systemPrompt:
        'You are a creative photography director and Stable Diffusion / Flux prompt engineer.',
      conversationSystemPrompt: DEFAULT_CONVERSATION_SYSTEM_PROMPT,
      batchExpansionPrompt: DEFAULT_BATCH_EXPANSION_PROMPT,
    };
  }
  return {
    baseUrl: row.base_url || appConfig.lmStudioUrl,
    selectedModel: row.selected_model || '',
    followLoadedModel:
      row.follow_loaded_model !== undefined ? Boolean(row.follow_loaded_model) : true,
    systemPrompt: row.system_prompt || '',
    conversationSystemPrompt:
      row.conversation_system_prompt?.trim() || DEFAULT_CONVERSATION_SYSTEM_PROMPT,
    batchExpansionPrompt:
      row.batch_expansion_prompt?.trim() || DEFAULT_BATCH_EXPANSION_PROMPT,
  };
}

/**
 * Updates Local LLM settings in SQLite and mirrors the active endpoint onto `appConfig`.
 */
export function updateLmStudioSettings(payload: {
  baseUrl?: string;
  selectedModel?: string;
  followLoadedModel?: boolean;
  systemPrompt?: string;
  conversationSystemPrompt?: string;
  batchExpansionPrompt?: string;
}): {
  baseUrl: string;
  selectedModel: string;
  followLoadedModel: boolean;
  systemPrompt: string;
  conversationSystemPrompt: string;
  batchExpansionPrompt: string;
} {
  const current = getLmStudioSettings();
  const nextUrl = (payload.baseUrl ?? current.baseUrl).replace(/\/+$/, '');
  const nextModel = payload.selectedModel ?? current.selectedModel;
  const nextFollowLoaded =
    payload.followLoadedModel !== undefined
      ? Boolean(payload.followLoadedModel)
      : current.followLoadedModel;
  const nextPrompt = payload.systemPrompt ?? current.systemPrompt;
  const nextConversationPrompt =
    payload.conversationSystemPrompt !== undefined
      ? payload.conversationSystemPrompt.trim() || DEFAULT_CONVERSATION_SYSTEM_PROMPT
      : current.conversationSystemPrompt;
  const nextBatchExpansionPrompt =
    payload.batchExpansionPrompt !== undefined
      ? payload.batchExpansionPrompt.trim() || DEFAULT_BATCH_EXPANSION_PROMPT
      : current.batchExpansionPrompt;

  db.prepare(
    `UPDATE lm_studio_settings
     SET base_url = ?, selected_model = ?, follow_loaded_model = ?, system_prompt = ?, conversation_system_prompt = ?, batch_expansion_prompt = ?, updated_at = datetime('now')
     WHERE id = 1`
  ).run(
    nextUrl,
    nextModel,
    nextFollowLoaded ? 1 : 0,
    nextPrompt,
    nextConversationPrompt,
    nextBatchExpansionPrompt
  );

  appConfig.lmStudioUrl = nextUrl;
  invalidateLmStudioStatusCache();
  return {
    baseUrl: nextUrl,
    selectedModel: nextModel,
    followLoadedModel: nextFollowLoaded,
    systemPrompt: nextPrompt,
    conversationSystemPrompt: nextConversationPrompt,
    batchExpansionPrompt: nextBatchExpansionPrompt,
  };
}

/**
 * Builds request headers for the OpenAI-compatible Local LLM endpoint,
 * attaching `Authorization: Bearer <token>` when `LOCAL_LLM_API_KEY` is configured on the server.
 */
export function getLocalLlmHeaders(includeJsonContentType = false): Record<string, string> {
  const headers: Record<string, string> = {};
  if (includeJsonContentType) {
    headers['Content-Type'] = 'application/json';
  }
  if (appConfig.localLlmApiKey) {
    headers.Authorization = `Bearer ${appConfig.localLlmApiKey}`;
  }
  return headers;
}

export function resolveChatCompletionsUrl(rawBaseUrl: string): string {
  const baseUrl = rawBaseUrl.replace(/\/+$/, '');
  return baseUrl.endsWith('/v1') ? `${baseUrl}/chat/completions` : `${baseUrl}/v1/chat/completions`;
}

/**
 * Shared OpenAI-compatible `/v1/chat/completions` request helper with timeout management
 * and `<think>...</think>` tag stripping.
 */
export async function postChatCompletion(params: {
  baseUrl: string;
  model: string;
  messages: Array<{ role: string; content: unknown }>;
  temperature: number;
  maxTokens: number;
  timeoutMs: number;
}): Promise<{ content: string; modelUsed: string }> {
  const chatEndpoint = resolveChatCompletionsUrl(params.baseUrl);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), params.timeoutMs);

  try {
    const res = await fetch(chatEndpoint, {
      method: 'POST',
      headers: getLocalLlmHeaders(true),
      signal: controller.signal,
      body: JSON.stringify({
        model: params.model,
        messages: params.messages,
        temperature: params.temperature,
        max_tokens: params.maxTokens,
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      const err: any = new Error(`Local LLM returned HTTP ${res.status}: ${errText}`);
      err.httpStatus = res.status;
      err.errBody = errText;
      throw err;
    }

    const data = (await res.json()) as any;
    const rawContent: string = data?.choices?.[0]?.message?.content?.trim() || '';
    const content = rawContent.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();

    return {
      content,
      modelUsed: data?.model || params.model,
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Queries server-specific runtime endpoints to detect which chat/vision model(s)
 * are actively loaded in memory right now (LM Studio, Ollama, or OpenAI-compatible servers).
 */
async function detectLoadedServerModels(
  baseUrl: string,
  availableModels: string[]
): Promise<{
  loadedModels: string[];
  detectedProvider: LmStudioStatus['detectedProvider'];
}> {
  const rootUrl = baseUrl.replace(/\/v1\/?$/, '');

  // 1. Try LM Studio native /api/v0/models
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 1500);
    const res = await fetch(`${rootUrl}/api/v0/models`, {
      headers: getLocalLlmHeaders(false),
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (res.ok) {
      const payload = (await res.json()) as {
        data?: Array<{ id?: string; state?: string; type?: string }>;
      };
      if (Array.isArray(payload?.data)) {
        const loadedModels = payload.data
          .filter(
            (m) =>
              Boolean(m?.id) &&
              m?.state === 'loaded' &&
              String(m?.type || '').toLowerCase() !== 'embeddings'
          )
          .map((m) => String(m.id));
        return {
          loadedModels: Array.from(new Set(loadedModels)),
          detectedProvider: 'lmstudio',
        };
      }
    }
  } catch {
    // Not LM Studio or endpoint unavailable; try Ollama next
  }

  // 2. Try Ollama native /api/ps
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 1500);
    const res = await fetch(`${rootUrl}/api/ps`, {
      headers: getLocalLlmHeaders(false),
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (res.ok) {
      const payload = (await res.json()) as {
        models?: Array<{ name?: string; model?: string }>;
      };
      if (Array.isArray(payload?.models)) {
        const loadedModels = payload.models
          .map((m) => (m?.model || m?.name || '').trim())
          .filter(Boolean);
        return {
          loadedModels: Array.from(new Set(loadedModels)),
          detectedProvider: 'ollama',
        };
      }
    }
  } catch {
    // Generic OpenAI-compatible server
  }

  if (availableModels.length === 1) {
    return {
      loadedModels: [availableModels[0]],
      detectedProvider: 'openai_single',
    };
  }

  return {
    loadedModels: [],
    detectedProvider: 'openai_multi',
  };
}

/**
 * Checks connectivity to Local LLM (/v1/models), detects currently loaded models,
 * resolves the active model (auto-following loaded models unless manually pinned),
 * and returns guiding templates. Coalesces concurrent requests and caches results for 5s
 * so simultaneous startup probes (/readiness + /lmstudio/status) share one network check.
 */
export async function checkLmStudioStatus(
  customBaseUrl?: string,
  options?: { forceRefresh?: boolean }
): Promise<LmStudioStatus> {
  const settings = getLmStudioSettings();
  const baseUrl = (customBaseUrl || settings.baseUrl).replace(/\/+$/, '');
  const forceRefresh = Boolean(options?.forceRefresh);
  const cacheKey = `${baseUrl}|${settings.selectedModel}|${settings.followLoadedModel ? '1' : '0'}`;

  if (!forceRefresh) {
    const cached = lmStatusCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.status;
    }
    const existing = lmStatusInFlight.get(cacheKey);
    if (existing) {
      return existing;
    }
  }

  const probePromise = runLmStudioStatusProbe(baseUrl, customBaseUrl, settings)
    .then((status) => {
      lmStatusCache.set(cacheKey, {
        expiresAt: Date.now() + LM_STATUS_CACHE_TTL_MS,
        status,
      });
      return status;
    })
    .finally(() => {
      if (lmStatusInFlight.get(cacheKey) === probePromise) {
        lmStatusInFlight.delete(cacheKey);
      }
    });

  if (!forceRefresh) {
    lmStatusInFlight.set(cacheKey, probePromise);
  }
  return probePromise;
}

async function runLmStudioStatusProbe(
  baseUrl: string,
  customBaseUrl: string | undefined,
  settings: ReturnType<typeof getLmStudioSettings>
): Promise<LmStudioStatus> {
  const guidingTemplates = listLmStudioGuidingTemplates();
  const modelsEndpoint = baseUrl.endsWith('/v1') ? `${baseUrl}/models` : `${baseUrl}/v1/models`;

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3500);
    const res = await fetch(modelsEndpoint, {
      headers: getLocalLlmHeaders(false),
      signal: controller.signal,
    });
    clearTimeout(timer);

    if (!res.ok) {
      throw new Error(`HTTP ${res.status} from ${modelsEndpoint}`);
    }

    const data = (await res.json()) as { data?: { id: string }[] };
    const availableModels = Array.isArray(data?.data)
      ? data.data.map((m) => m.id).filter(Boolean)
      : [];

    const { loadedModels, detectedProvider } = await detectLoadedServerModels(
      baseUrl,
      availableModels
    );

    const savedIsAvailable =
      Boolean(settings.selectedModel) && availableModels.includes(settings.selectedModel);
    const savedIsLoaded =
      Boolean(settings.selectedModel) && loadedModels.includes(settings.selectedModel);

    let selectedModel: string;
    if (settings.followLoadedModel && loadedModels.length > 0) {
      selectedModel = savedIsLoaded ? settings.selectedModel : loadedModels[0];
    } else if (savedIsAvailable) {
      selectedModel = settings.selectedModel;
    } else if (loadedModels.length > 0) {
      selectedModel = loadedModels[0];
    } else {
      selectedModel = availableModels[0] || settings.selectedModel || 'local-model';
    }

    const isDefaultUrl = !customBaseUrl || baseUrl === settings.baseUrl.replace(/\/+$/, '');
    if (
      isDefaultUrl &&
      selectedModel !== settings.selectedModel &&
      (loadedModels.length > 0 || availableModels.length > 0)
    ) {
      updateLmStudioSettings({ baseUrl, selectedModel });
    }

    return {
      online: true,
      baseUrl,
      selectedModel,
      followLoadedModel: settings.followLoadedModel,
      loadedModels,
      detectedProvider,
      systemPrompt: settings.systemPrompt,
      conversationSystemPrompt: settings.conversationSystemPrompt,
      defaultConversationSystemPrompt: DEFAULT_CONVERSATION_SYSTEM_PROMPT,
      batchExpansionPrompt: settings.batchExpansionPrompt,
      defaultBatchExpansionPrompt: DEFAULT_BATCH_EXPANSION_PROMPT,
      availableModels,
      guidingTemplates,
      apiKeyConfigured: Boolean(appConfig.localLlmApiKey),
      error: null,
    };
  } catch (err: any) {
    return {
      online: false,
      baseUrl,
      selectedModel: settings.selectedModel,
      followLoadedModel: settings.followLoadedModel,
      loadedModels: [],
      systemPrompt: settings.systemPrompt,
      conversationSystemPrompt: settings.conversationSystemPrompt,
      defaultConversationSystemPrompt: DEFAULT_CONVERSATION_SYSTEM_PROMPT,
      batchExpansionPrompt: settings.batchExpansionPrompt,
      defaultBatchExpansionPrompt: DEFAULT_BATCH_EXPANSION_PROMPT,
      availableModels: [],
      guidingTemplates,
      apiKeyConfigured: Boolean(appConfig.localLlmApiKey),
      error: err?.message || 'Local LLM server unreachable at ' + baseUrl,
    };
  }
}

/**
 * Heuristic check for whether a model identifier is likely a Vision-Language Model (VLM).
 */
export function isLikelyVisionModelId(modelId: string): boolean {
  return /(?:\b|_|-)(?:vl|vlm|vision|llava|joycaption|pixtral|minicpm|moondream|florence|internvl|molmo|bakllava|cogvlm|idefics|paligemma|gemma-?[34]|gemma4|supergemma|qwen[\w.-]*vl|smolvlm|ovis|glm-?4v|llama-?4|omni)(?:\b|_|-)/i.test(
    modelId
  );
}

/**
 * Checks LM Studio's `/api/v0/models` metadata alongside model ID heuristics
 * to detect Vision-capable models even when their name doesn't contain "-vl".
 */
export async function checkLmStudioVisionSupport(
  baseUrl: string,
  modelId: string
): Promise<boolean> {
  if (isLikelyVisionModelId(modelId)) return true;
  try {
    const rootUrl = baseUrl.replace(/\/v1\/?$/, '');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 1500);
    const res = await fetch(`${rootUrl}/api/v0/models`, {
      headers: getLocalLlmHeaders(false),
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!res.ok) return false;
    const payload = (await res.json()) as { data?: Array<Record<string, any>> };
    const matched = payload?.data?.find((m) => m?.id === modelId);
    if (!matched) return false;
    return (
      matched.type === 'vlm' ||
      Boolean(matched.vision) ||
      Boolean(matched.capabilities?.vision)
    );
  } catch {
    return false;
  }
}
