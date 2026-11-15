import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { db } from '../db.ts';
import { appConfig } from '../config.ts';
import { logger } from '../logger.ts';
import type {
  LmStudioGuidingTemplate,
  LmStudioStatus,
  QuickGenChatMessage,
} from '../../shared/types.ts';
import { interpolatePrompt } from '../../shared/utils.ts';
import {
  DEFAULT_CONVERSATION_SYSTEM_PROMPT,
  DEFAULT_BATCH_EXPANSION_PROMPT,
} from '../../shared/agentPromptDefaults.ts';
import { interrogateImageBufferWithWd14 } from './visualTaggerService.ts';

export { DEFAULT_CONVERSATION_SYSTEM_PROMPT, DEFAULT_BATCH_EXPANSION_PROMPT };

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
    } else {
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
    }
  });

  const savedId = tx();
  const savedRow = db.prepare('SELECT * FROM lm_studio_prompt_templates WHERE id = ?').get(savedId);
  return {
    template: mapGuidingRow(savedRow),
    items: listLmStudioGuidingTemplates(),
  };
}

/**
 * Deletes a saved LM Studio Guiding Prompt Template.
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
  return listLmStudioGuidingTemplates();
}

/**
 * Retrieves current LM Studio settings from SQLite.
 */
export function getLmStudioSettings(): {
  baseUrl: string;
  selectedModel: string;
  systemPrompt: string;
  conversationSystemPrompt: string;
  batchExpansionPrompt: string;
} {
  const row = db.prepare('SELECT * FROM lm_studio_settings WHERE id = 1').get() as any;
  if (!row) {
    return {
      baseUrl: appConfig.lmStudioUrl,
      selectedModel: '',
      systemPrompt:
        'You are a creative photography director and Stable Diffusion / Flux prompt engineer.',
      conversationSystemPrompt: DEFAULT_CONVERSATION_SYSTEM_PROMPT,
      batchExpansionPrompt: DEFAULT_BATCH_EXPANSION_PROMPT,
    };
  }
  return {
    baseUrl: row.base_url || appConfig.lmStudioUrl,
    selectedModel: row.selected_model || '',
    systemPrompt: row.system_prompt || '',
    conversationSystemPrompt:
      row.conversation_system_prompt?.trim() || DEFAULT_CONVERSATION_SYSTEM_PROMPT,
    batchExpansionPrompt:
      row.batch_expansion_prompt?.trim() || DEFAULT_BATCH_EXPANSION_PROMPT,
  };
}

/**
 * Updates LM Studio settings in SQLite.
 */
export function updateLmStudioSettings(payload: {
  baseUrl?: string;
  selectedModel?: string;
  systemPrompt?: string;
  conversationSystemPrompt?: string;
  batchExpansionPrompt?: string;
}): {
  baseUrl: string;
  selectedModel: string;
  systemPrompt: string;
  conversationSystemPrompt: string;
  batchExpansionPrompt: string;
} {
  const current = getLmStudioSettings();
  const nextUrl = (payload.baseUrl ?? current.baseUrl).replace(/\/+$/, '');
  const nextModel = payload.selectedModel ?? current.selectedModel;
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
     SET base_url = ?, selected_model = ?, system_prompt = ?, conversation_system_prompt = ?, batch_expansion_prompt = ?, updated_at = datetime('now')
     WHERE id = 1`
  ).run(nextUrl, nextModel, nextPrompt, nextConversationPrompt, nextBatchExpansionPrompt);

  appConfig.lmStudioUrl = nextUrl;
  return {
    baseUrl: nextUrl,
    selectedModel: nextModel,
    systemPrompt: nextPrompt,
    conversationSystemPrompt: nextConversationPrompt,
    batchExpansionPrompt: nextBatchExpansionPrompt,
  };
}

/**
 * Builds request headers for the OpenAI-compatible Local LLM endpoint,
 * attaching `Authorization: Bearer <token>` when `LOCAL_LLM_API_KEY` is configured on the server.
 */
function getLocalLlmHeaders(includeJsonContentType = false): Record<string, string> {
  const headers: Record<string, string> = {};
  if (includeJsonContentType) {
    headers['Content-Type'] = 'application/json';
  }
  if (appConfig.localLlmApiKey) {
    headers.Authorization = `Bearer ${appConfig.localLlmApiKey}`;
  }
  return headers;
}

/**
 * Checks connectivity to Local LLM (/v1/models) and lists loaded models + guiding templates.
 */
export async function checkLmStudioStatus(customBaseUrl?: string): Promise<LmStudioStatus> {
  const settings = getLmStudioSettings();
  const guidingTemplates = listLmStudioGuidingTemplates();
  const baseUrl = (customBaseUrl || settings.baseUrl).replace(/\/+$/, '');
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

    const selectedModel =
      settings.selectedModel && availableModels.includes(settings.selectedModel)
        ? settings.selectedModel
        : availableModels[0] || settings.selectedModel || 'local-model';

    if (selectedModel !== settings.selectedModel && availableModels.length > 0) {
      updateLmStudioSettings({ baseUrl, selectedModel });
    }

    return {
      online: true,
      baseUrl,
      selectedModel,
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
 * Interpolates {character}, {lora}, {theme}, {count}, {base_prompt} placeholders.
 */
export const interpolatePromptTemplate = interpolatePrompt;

/**
 * Sanitizes prompts generated by LM Studio or built-in director:
 * - Strips any accidental model/LoRA filenames (.safetensors, .ckpt, .pt, .bin)
 * - Strips leading character name tags (e.g. "Tina, ", "Tina - ", "Tina:")
 * - Replaces any leftover explicit character mentions with neutral "the subject"
 * - Normalizes punctuation and capitalization
 */
export function sanitizeAgentPrompt(prompt: string, characterName?: string): string {
  let cleaned = prompt;

  // 1. Strip accidental model filenames (e.g. "xtinax.safetensors", "model.ckpt")
  cleaned = cleaned.replace(/\b[\w\.\-]+\.(?:safetensors|ckpt|pt|bin)\b/gi, '');

  // 2. If characterName provided, strip leading name mentions and replace inline mentions
  if (characterName?.trim()) {
    const rawName = characterName.trim();
    const escaped = rawName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    // Leading "Name, ", "Name: ", "Name - ", "Name "
    const leadingNameRegex = new RegExp(`^\\s*${escaped}\\s*(?:[,:;\\-–—]|\\s+)\\s*`, 'i');
    cleaned = cleaned.replace(leadingNameRegex, '');
    // Also replace standalone word occurrences like "a photo of Tina" -> "a photo of the subject"
    const inlineNameRegex = new RegExp(`\\b${escaped}\\b`, 'gi');
    cleaned = cleaned.replace(inlineNameRegex, 'the subject');
  }

  // 3. Normalize punctuation and whitespace
  cleaned = cleaned
    .replace(/\s*,\s*,+/g, ',')
    .replace(/^[\s,;:\-–—]+/, '')
    .replace(/[\s,;:\-–—]+$/, '')
    .replace(/\s{2,}/g, ' ')
    .trim();

  // 4. Ensure initial capital letter
  if (cleaned.length > 0) {
    cleaned = cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
  }

  return cleaned;
}

function normalizeLoraMatchKey(value: string): string {
  return value
    .trim()
    .replace(/^@+/, '')
    .replace(/\\/g, '/')
    .split('/')
    .pop()!
    .replace(/\.(?:safetensors|ckpt|pt|bin)$/i, '')
    .toLowerCase();
}

function clampContextText(text: string | undefined | null, maxLen: number): string {
  if (!text) return '';
  const collapsed = text.replace(/\s+/g, ' ').trim();
  if (!collapsed) return '';
  if (collapsed.length <= maxLen) return collapsed;
  return `${collapsed.slice(0, maxLen - 1).trimEnd()}…`;
}

/**
 * Builds a concise, token-efficient grounding block for the active Character
 * (description + character LoRA appearance label) and attached LoRAs (category + llm_description)
 * without leaking raw filenames, trigger words, or bloated CivitAI HTML blobs.
 */
function buildLlmCharacterAndLoraContext(params: {
  characterName?: string;
  characterDescription?: string;
  characterPhysicalDescription?: string;
  loraNames?: string[];
}): {
  characterBlock: string | null;
  attachedLoraBlock: string | null;
} {
  const attachedKeys = (params.loraNames || [])
    .map((l) => ({ raw: l, key: normalizeLoraMatchKey(l) }))
    .filter((entry) => Boolean(entry.key));

  // Query lightweight model + character_lora metadata once for lookup
  const modelRows =
    attachedKeys.length > 0
      ? (db
          .prepare(
            `SELECT name, filename, lora_category, nickname, llm_description
             FROM models
             WHERE model_type = 'lora'`
          )
          .all() as Array<{
          name: string;
          filename: string;
          lora_category: string | null;
          nickname: string | null;
          llm_description: string | null;
        }>)
      : [];

  const charLoraRows =
    attachedKeys.length > 0
      ? (db
          .prepare(
            `SELECT cl.lora_name, cl.appearance_label, cl.lora_category, c.name AS character_name, c.description AS character_description, c.physical_description AS character_physical_description
             FROM character_loras cl
             JOIN characters c ON c.id = cl.character_id`
          )
          .all() as Array<{
          lora_name: string;
          appearance_label: string | null;
          lora_category: string | null;
          character_name: string;
          character_description: string | null;
          character_physical_description: string | null;
        }>)
      : [];

  const appearanceLabels: string[] = [];
  let fallbackDbCharDescription = '';
  let fallbackDbCharPhysical = '';

  const attachedLines: string[] = [];
  const seenKeys = new Set<string>();

  for (const { raw, key } of attachedKeys) {
    if (seenKeys.has(key)) continue;
    seenKeys.add(key);

    const matchedModel = modelRows.find(
      (m) =>
        normalizeLoraMatchKey(m.filename) === key ||
        normalizeLoraMatchKey(m.name) === key ||
        (m.nickname && normalizeLoraMatchKey(m.nickname) === key)
    );
    const matchedCharLora = charLoraRows.find(
      (cl) => normalizeLoraMatchKey(cl.lora_name) === key
    );

    if (matchedCharLora) {
      if (matchedCharLora.appearance_label?.trim()) {
        appearanceLabels.push(matchedCharLora.appearance_label.trim());
      }
      if (!fallbackDbCharDescription && matchedCharLora.character_description?.trim()) {
        fallbackDbCharDescription = matchedCharLora.character_description.trim();
      }
      if (!fallbackDbCharPhysical && matchedCharLora.character_physical_description?.trim()) {
        fallbackDbCharPhysical = matchedCharLora.character_physical_description.trim();
      }
    }

    const label =
      (matchedModel?.nickname || '').trim().replace(/^@+/, '') ||
      matchedModel?.name?.trim() ||
      raw.replace(/^.*[\\/]/, '').replace(/\.(?:safetensors|ckpt|pt|bin)$/i, '').trim();

    const rawCategory =
      matchedModel?.lora_category || matchedCharLora?.lora_category || 'unclassified';
    const catTag =
      rawCategory && rawCategory !== 'unclassified' ? ` [${rawCategory}]` : '';
    const desc = clampContextText(matchedModel?.llm_description, 240);
    const variantNote =
      matchedCharLora?.appearance_label?.trim()
        ? `Variant: ${matchedCharLora.appearance_label.trim()}`
        : '';

    const detailParts = [variantNote, desc].filter(Boolean);
    if (detailParts.length > 0) {
      attachedLines.push(`- ${label}${catTag}: ${detailParts.join(' — ')}`);
    } else {
      attachedLines.push(`- ${label}${catTag}`);
    }
  }

  let charDesc = clampContextText(params.characterDescription, 450);
  let charPhysical = clampContextText(params.characterPhysicalDescription, 500);
  if ((!charDesc || !charPhysical) && (fallbackDbCharDescription || fallbackDbCharPhysical)) {
    if (!charDesc && fallbackDbCharDescription) {
      charDesc = clampContextText(fallbackDbCharDescription, 450);
    }
    if (!charPhysical && fallbackDbCharPhysical) {
      charPhysical = clampContextText(fallbackDbCharPhysical, 500);
    }
  }
  if ((!charDesc || !charPhysical) && params.characterName?.trim()) {
    const dbChar = db
      .prepare('SELECT description, physical_description FROM characters WHERE LOWER(name) = LOWER(?) LIMIT 1')
      .get(params.characterName.trim()) as
      | { description?: string; physical_description?: string }
      | undefined;
    if (!charDesc) charDesc = clampContextText(dbChar?.description, 450);
    if (!charPhysical) charPhysical = clampContextText(dbChar?.physical_description, 500);
  }

  let characterBlock: string | null = null;
  if (params.characterName?.trim() || charDesc || charPhysical) {
    const parts: string[] = [
      `Active character LoRA handles their facial identity automatically; treat the Character Profile below as a guiding reference (not text to copy verbatim), always honoring user-requested outfits, hairstyles, makeup, or accessories.`,
    ];
    if (appearanceLabels.length > 0) {
      parts.push(`Active Character Variant: ${Array.from(new Set(appearanceLabels)).join(', ')}`);
    }
    if (charDesc) {
      parts.push(`Character Personality & Bio: ${charDesc}`);
    }
    if (charPhysical) {
      parts.push(
        `Physical Reference Guide (use for accurate pronouns, skin tone, natural hair color, build, and signature marks—weave only helpful cues naturally instead of repeating every anatomical detail verbatim): ${charPhysical}`
      );
    }
    characterBlock = parts.join('\n');
  }

  const attachedLoraBlock =
    attachedLines.length > 0
      ? [
          `Attached LoRAs (active in workflow—complement them in the scene without writing @handles or trigger words inside the prompt):`,
          ...attachedLines,
        ].join('\n')
      : null;

  return { characterBlock, attachedLoraBlock };
}

/**
 * Connects to LM Studio's /v1/chat/completions endpoint using the chosen Guiding Prompt Template
 * to generate a sequence of N prompts for a photo set theme.
 */
export async function generatePhotoSetPromptsWithAgent(params: {
  characterName: string;
  characterDescription?: string;
  characterPhysicalDescription?: string;
  loraNames: string[];
  theme: string;
  count: number;
  basePromptTemplate: string;
  guidingTemplateId?: number;
  expansionDirective?: string;
  modelOverride?: string;
  baseUrlOverride?: string;
}): Promise<{
  prompts: string[];
  usedLmStudio: boolean;
  modelUsed: string;
  guidingTemplateName: string;
  sentSystemPrompt: string;
  sentUserPrompt: string;
  warning?: string;
}> {
  const settings = getLmStudioSettings();
  const baseUrl = (params.baseUrlOverride || settings.baseUrl).replace(/\/+$/, '');
  const chatEndpoint = baseUrl.endsWith('/v1')
    ? `${baseUrl}/chat/completions`
    : `${baseUrl}/v1/chat/completions`;

  const count = Math.max(1, Math.min(20, Number(params.count) || 4));
  const neutralSubject = 'the subject';

  const resolvedBaseStyle =
    params.basePromptTemplate && params.basePromptTemplate.trim() !== '{theme}'
      ? interpolatePromptTemplate(params.basePromptTemplate, {
          characterName: neutralSubject,
          loraSummary: '',
          theme: params.theme,
          count,
        })
      : '';

  const { characterBlock, attachedLoraBlock } = buildLlmCharacterAndLoraContext({
    characterName: params.characterName,
    characterDescription: params.characterDescription,
    characterPhysicalDescription: params.characterPhysicalDescription,
    loraNames: params.loraNames,
  });

  const expansionDirectiveRaw =
    params.expansionDirective?.trim() ||
    settings.batchExpansionPrompt ||
    DEFAULT_BATCH_EXPANSION_PROMPT;

  const expansionDirective = interpolatePromptTemplate(expansionDirectiveRaw, {
    characterName: neutralSubject,
    loraSummary: '',
    theme: params.theme,
    count,
    basePrompt: resolvedBaseStyle || params.theme,
  });

  // Unified architecture: primary Agent System Prompt + Batch Expansion rules + Character/LoRA context
  const sentSystemPrompt = [
    settings.conversationSystemPrompt,
    expansionDirective,
    characterBlock,
    attachedLoraBlock,
  ]
    .filter(Boolean)
    .join('\n\n');

  const userLines = [
    `Expand the following Set Concept / Theme into ${count} distinct, cohesive, standalone image generation prompts:`,
    ``,
    `Set Concept / Theme:`,
    params.theme.trim(),
  ];
  if (resolvedBaseStyle && resolvedBaseStyle.trim() !== params.theme.trim()) {
    userLines.push('', `Visual Style Foundation:`, resolvedBaseStyle.trim());
  }
  userLines.push(
    '',
    `Return ONLY ${count} prompts wrapped in <shot_1>...</shot_1> through <shot_${count}>...</shot_${count}> tags with no extra commentary.`
  );
  const sentUserPrompt = userLines.join('\n');

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 90000);

    const modelToUse = params.modelOverride || settings.selectedModel || 'local-model';
    const res = await fetch(chatEndpoint, {
      method: 'POST',
      headers: getLocalLlmHeaders(true),
      signal: controller.signal,
      body: JSON.stringify({
        model: modelToUse,
        messages: [
          { role: 'system', content: sentSystemPrompt },
          { role: 'user', content: sentUserPrompt },
        ],
        temperature: 0.75,
        max_tokens: 4096,
      }),
    });
    clearTimeout(timer);

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Local LLM returned HTTP ${res.status}: ${errText}`);
    }

    const data = (await res.json()) as any;
    const rawContent: string = data?.choices?.[0]?.message?.content?.trim() || '';
    const cleaned = rawContent.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();

    let parsedPrompts: string[] = [];

    // 1. Primary parser: <shot_1>...</shot_1> (or <shot>...</shot>) XML tags
    const shotTagMatches = Array.from(
      cleaned.matchAll(/<shot(?:_\d+)?>([\s\S]*?)<\/shot(?:_\d+)?>/gi)
    );
    if (shotTagMatches.length > 0) {
      parsedPrompts = shotTagMatches
        .map((m) => m[1].replace(/^["']|["']$/g, '').trim())
        .filter(Boolean);
    }

    // 2. Secondary fallback: JSON array [...]
    if (parsedPrompts.length === 0) {
      const jsonMatch = cleaned.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        try {
          const arr = JSON.parse(jsonMatch[0]);
          if (Array.isArray(arr)) {
            parsedPrompts = arr.map((item) => String(item).trim()).filter(Boolean);
          }
        } catch {
          // fallback to line splitting below
        }
      }
    }

    // 3. Tertiary fallback: numbered / bulleted lines
    if (parsedPrompts.length === 0) {
      parsedPrompts = cleaned
        .split('\n')
        .map((line) =>
          line
            .replace(/^\s*(?:\d+[\.\)]\s*|[-*]\s*|Prompt\s*\d+:\s*|Shot\s*\d+:\s*)/i, '')
            .replace(/^["']|["'],?$/g, '')
            .trim()
        )
        .filter((line) => line.length > 15 && !line.startsWith('[') && !line.startsWith(']'));
    }

    if (parsedPrompts.length === 0) {
      throw new Error('Local LLM response could not be parsed into individual prompts.');
    }

    while (parsedPrompts.length < count) {
      parsedPrompts.push(parsedPrompts[parsedPrompts.length % parsedPrompts.length]);
    }

    const sanitizedPrompts = parsedPrompts
      .slice(0, count)
      .map((p) => sanitizeAgentPrompt(p, params.characterName));

    return {
      prompts: sanitizedPrompts,
      usedLmStudio: true,
      modelUsed: data?.model || modelToUse,
      guidingTemplateName: 'Unified Agent + Batch Expansion',
      sentSystemPrompt,
      sentUserPrompt,
    };
  } catch (err: any) {
    const shotVariations = [
      'intimate close-up portrait, soft catchlights in eyes, shallow depth of field, 85mm lens',
      'medium three-quarter shot, candid natural expression, dynamic pose, atmospheric lighting',
      'cinematic wide environmental shot, showcasing full outfit and surroundings, 35mm lens',
      'over-the-shoulder perspective, dramatic rim lighting, rich environmental texture',
      'low-angle heroic framing, confident posture, golden ambient highlights',
      'candid motion shot, natural movement, soft background bokeh, editorial color grading',
      'profile silhouette with warm backlight, expressive mood, fine detail',
      'seated relaxed composition, environmental storytelling props, soft diffused window light',
    ];

    const fallbackPrompts: string[] = [];
    for (let i = 0; i < count; i++) {
      const variation = shotVariations[i % shotVariations.length];
      const combinedTheme = `${params.theme}, ${variation}`;
      const rawPrompt = interpolatePromptTemplate(params.basePromptTemplate, {
        characterName: 'the subject',
        loraSummary: '',
        theme: combinedTheme,
      });
      fallbackPrompts.push(sanitizeAgentPrompt(rawPrompt, params.characterName));
    }

    return {
      prompts: fallbackPrompts,
      usedLmStudio: false,
      modelUsed: 'Built-in Photo Set Director (Local LLM Offline)',
      guidingTemplateName: 'Unified Agent + Batch Expansion',
      sentSystemPrompt,
      sentUserPrompt,
      warning: `Local LLM unreachable (${err?.message || 'connection refused'}). Generated set variations using Couchy's built-in shot director so you can still preview or edit your set.`,
    };
  }
}

/**
 * Heuristic check for whether a model identifier in LM Studio is likely a Vision-Language Model (VLM).
 */
function isLikelyVisionModelId(modelId: string): boolean {
  return /(?:\b|_|-)(?:vl|vlm|vision|llava|joycaption|pixtral|minicpm|moondream|florence|internvl|molmo|bakllava|cogvlm|idefics|paligemma|gemma-?[34]|gemma4|supergemma|qwen[\w.-]*vl|smolvlm|ovis|glm-?4v|llama-?4)(?:\b|_|-)/i.test(
    modelId
  );
}

/**
 * Extracts only permanent physical/identity tags from raw WD14 tags for Character Portrait analysis.
 * Keeps gender/age cues, hair color/length/texture, eye color, skin tone, facial features/marks, and build.
 */
export function extractCharacterIdentityTags(tags: string[]): string[] {
  const identityRegex =
    /^(?:1girl|1boy|solo|woman|man|mature female|mature male|girl|boy)$|\b(?:hair|eyes|skin|freckles|mole|scar|tattoo|fangs|pointy ears|elf ears|heterochromia|glasses|eyebrows|lips|eyelashes|cheek|jawline|bust|breasts|chest|hips|waist|thighs|build|slender|curvy|voluptuous|petite|athletic|muscular|plump|toned|abs|tall|short|tan|tanlines|caucasian|asian|latina|ebony)\b/i;
  const excludeTemporaryRegex =
    /\b(?:looking at|smile|smiling|blush|open mouth|closed eyes|winking|parted lips|sitting|standing|lying|kneeling|shirt|dress|skirt|jacket|bikini|lingerie|bra|panties|stockings|shoes|boots|hat|background|indoors|outdoors|lighting|shadow)\b/i;

  return tags.filter((tag) => identityRegex.test(tag) && !excludeTemporaryRegex.test(tag));
}

/**
 * Pre-filters WD14 tags when a character is attached in Quick Gen:
 * Strips hair color, eye color, permanent facial features, skin tone/ethnicity, and body proportions
 * while preserving transient expressions/emotions, pose, clothing/NSFW state, lighting, and framing.
 */
export function filterCharacterIdentityTags(tags: string[]): string[] {
  const hairColorRegex =
    /\b(?:blonde|brown|black|red|pink|blue|green|purple|orange|silver|grey|gray|white|aqua|platinum|auburn|chestnut|multicolored|two-tone|streaked|colored|gradient|bleached|light brown|dark brown|dark blue|light blue|light purple)\s+hair\b/i;

  const eyeAndFaceRegex =
    /\b(?:blue|brown|green|red|yellow|purple|aqua|amber|grey|gray|pink|orange|black|golden|hazel|multicolored)\s+eyes\b|\b(?:heterochromia|freckles|mole|mole under eye|mole on cheek|mole under mouth|facial mark|scar|pointy ears|elf ears|thick eyebrows)\b/i;

  const skinAndEthnicityRegex =
    /\b(?:dark skin|dark-skinned(?:\s+female|\s+male)?|pale skin|fair skin|tan|tanlines|suntan|olive skin|brown skin|white skin|caucasian|asian|latina|hispanic|ebony|african|indian|arab)\b/i;

  const bodyProportionsRegex =
    /\b(?:large|medium|small|huge|gigantic|enormous|flat|perky|sagging)\s+(?:breasts|chest|bust)\b|\b(?:wide hips|narrow waist|thick thighs|plump|curvy|voluptuous|chubby|slender|petite|skinny|thin|muscular(?:\s+female|\s+male)?|toned|abs|tall|short|mature female|loli)\b/i;

  return tags.filter(
    (tag) =>
      !hairColorRegex.test(tag) &&
      !eyeAndFaceRegex.test(tag) &&
      !skinAndEthnicityRegex.test(tag) &&
      !bodyProportionsRegex.test(tag)
  );
}

/**
 * Post-processes an interrogated natural-language prompt when a character is selected
 * to strip any residual descriptions of hair color, eye color, facial features, skin tone/ethnicity,
 * or body type/proportions while keeping facial expressions, pose, outfit/NSFW state, and environment.
 */
export function stripCharacterPhysicalTraits(prompt: string): string {
  let cleaned = prompt;

  // 1. Strip hair color adjectives while keeping hair style/length nouns when paired (e.g. "long wavy blonde hair" -> "long wavy hair")
  cleaned = cleaned.replace(
    /\b(?:platinum\s+blonde|strawberry\s+blonde|dirty\s+blonde|ash\s+blonde|golden\s+blonde|light\s+brown|dark\s+brown|jet[\s-]black|raven[\s-]black|fiery\s+red|ginger|auburn|chestnut|brunette|blonde|blond|black|red|pink|blue|green|purple|silver|grey|gray|white|pastel|dyed|bleached)\s+(?=(?:hair|locks|tresses|curls|waves|strands|ponytail|twintails|braid|braids|bun|bangs)\b)/gi,
    ''
  );
  // Strip standalone hair-color compounds ("a blonde woman" -> "a woman", "blonde-haired", "redhead")
  cleaned = cleaned.replace(
    /\b(?:blonde-haired|blond-haired|brown-haired|dark-haired|black-haired|red-haired|silver-haired|white-haired|pink-haired|blue-haired|raven-haired|blonde|blond|brunette|redhead)\b/gi,
    ''
  );
  // Strip bare "with hair" if removing the color left a vacuous phrase
  cleaned = cleaned.replace(/\bwith\s+hair\b/gi, '');

  // 2. Strip eye color & permanent facial feature phrases (while preserving expressions like "smiling", "half-closed eyes", "looking at viewer")
  cleaned = cleaned.replace(
    /\b(?:with\s+)?(?:piercing\s+|bright\s+|deep\s+|warm\s+|dark\s+|light\s+|striking\s+|vivid\s+|pale\s+|glowing\s+)?(?:blue|brown|green|hazel|amber|grey|gray|violet|purple|crimson|red|golden|yellow|aqua|emerald|sapphire)\s+eyes\b/gi,
    ''
  );
  cleaned = cleaned.replace(
    /\b(?:blue-eyed|brown-eyed|green-eyed|hazel-eyed|dark-eyed|heterochromia|freckled|freckles|beauty mark|mole under (?:her|his|their) eye|chiseled jawline|high cheekbones|button nose|aquiline nose)\b/gi,
    ''
  );

  // 3. Strip skin tone, race, and ethnicity descriptors
  cleaned = cleaned.replace(
    /\b(?:with\s+)?(?:pale|fair|porcelain|ivory|creamy|milky|sun-kissed|tanned|tan|bronzed|bronze|olive|ebony|dark|brown|light|caramel|flawless|alabaster)\s+(?:skin|complexion|skin tone)\b/gi,
    ''
  );
  cleaned = cleaned.replace(
    /\b(?:fair-skinned|dark-skinned|pale-skinned|light-skinned|tan-skinned|olive-skinned|brown-skinned|caucasian|asian|east asian|south asian|latina|latino|hispanic|african|african-american|ebony|black|white|middle eastern|european)\s+(?=(?:woman|man|girl|boy|person|subject|female|male|model|figure)\b)/gi,
    ''
  );
  cleaned = cleaned.replace(
    /\b(?:fair-skinned|dark-skinned|pale-skinned|light-skinned|tan-skinned|olive-skinned|caucasian|east asian|latina|hispanic|ebony)\b/gi,
    ''
  );

  // 4. Strip body type and proportion phrases
  cleaned = cleaned.replace(
    /\b(?:with\s+)?(?:a\s+|an\s+)?(?:curvy|voluptuous|busty|slender|petite|slim|lithe|plump|chubby|statuesque|heavyset|full-figured|well-endowed|athletic|muscular|toned|hourglass|lean|skinny|thin|thick)\s+(?:figure|body|build|frame|physique|silhouette|proportions)\b/gi,
    ''
  );
  cleaned = cleaned.replace(
    /\b(?:with\s+)?(?:large|huge|massive|gigantic|enormous|ample|generous|full|heavy|perky|medium|small|petite|flat)\s+(?:breasts|bust|chest|bosom)\b/gi,
    ''
  );
  cleaned = cleaned.replace(
    /\b(?:with\s+)?(?:wide|curvy|broad|childbearing)\s+hips\b|\b(?:with\s+)?(?:thick|plump|slender|toned)\s+thighs\b|\b(?:with\s+)?(?:a\s+)?(?:narrow|slim|tiny|wasp)\s+waist\b/gi,
    ''
  );
  cleaned = cleaned.replace(
    /\b(?:curvy|voluptuous|busty|slender|petite|full-figured|well-endowed|plump|chubby|skinny|muscular|statuesque)\b/gi,
    ''
  );

  // 5. Clean up orphaned prepositions/conjunctions and extra punctuation
  cleaned = cleaned
    .replace(/\bwith\s+(?:and|in|on|at|wearing|dressed)\b/gi, (m) =>
      m.replace(/^with\s+/i, '')
    )
    .replace(/\bwith\s*[,.;:]/gi, ',')
    .replace(/,\s*and\s*,/gi, ',')
    .replace(/\band\s*[,.;:]/gi, ',')
    .replace(/\(\s*\)/g, '')
    .replace(/\s*,\s*,+/g, ',')
    .replace(/\s{2,}/g, ' ')
    .trim();

  return cleaned;
}

/**
 * Hybrid Image-to-Prompt Interrogation Pipeline:
 * 1. Verifies LM Studio is online.
 * 2. If a Vision-capable model is loaded in LM Studio, sends the downscaled 1MP image directly to `/v1/chat/completions`.
 * 3. If a Text-only model is loaded (or if the Vision call is unsupported/refused), runs the image through
 *    local uncensored WD14 v3 ONNX (`interrogateImageBufferWithWd14`) and passes the extracted tags to the LM Studio
 *    text model to synthesize a detailed generation prompt.
 * 4. When `characterName` is provided, strips physical identity traits (hair color, eye color, facial features,
 *    skin tone/ethnicity, body proportions) across tag extraction, LLM instructions, and post-sanitization.
 */
export async function interrogateImageToPrompt(params: {
  imageBase64DataUrl: string;
  characterName?: string;
}): Promise<{
  prompt: string;
  pipelineUsed: 'vision' | 'wd14_text';
  tags: string[];
  modelUsed: string;
}> {
  const status = await checkLmStudioStatus();
  if (!status.online) {
    throw new Error('Local LLM is offline. Connect a Local LLM to interrogate images.');
  }

  const rawDataUrl = (params.imageBase64DataUrl || '').trim();
  const base64Match = rawDataUrl.match(/^data:image\/[a-zA-Z0-9.+-]+;base64,(.+)$/);
  const base64Payload = base64Match ? base64Match[1] : rawDataUrl;
  if (!base64Payload) {
    throw new Error('Invalid or empty image payload.');
  }

  const imageBuffer = Buffer.from(base64Payload, 'base64');
  const fullDataUrl = base64Match ? rawDataUrl : `data:image/jpeg;base64,${base64Payload}`;

  // Optionally persist the 1MP downscaled prompt image to data/uploaded if enabled in System & Backup settings
  const saveUploadedRow = db
    .prepare("SELECT value FROM app_settings WHERE key = 'save_uploaded_prompt_images'")
    .get() as { value: string } | undefined;
  if (saveUploadedRow?.value === '1') {
    try {
      fs.mkdirSync(appConfig.uploadedImagesDir, { recursive: true });
      const hashPrefix = crypto.createHash('sha256').update(imageBuffer).digest('hex').slice(0, 10);
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const mimePart = base64Match ? base64Match[0].toLowerCase() : '';
      const ext = mimePart.includes('png') ? 'png' : mimePart.includes('webp') ? 'webp' : 'jpg';
      const savedPath = path.join(
        appConfig.uploadedImagesDir,
        `prompt-1mp-${timestamp}-${hashPrefix}.${ext}`
      );
      fs.writeFileSync(savedPath, imageBuffer);
    } catch (err) {
      console.error('Failed to save 1MP uploaded prompt image:', err);
    }
  }

  const settings = getLmStudioSettings();
  const baseUrl = settings.baseUrl.replace(/\/+$/, '');
  const chatEndpoint = baseUrl.endsWith('/v1')
    ? `${baseUrl}/chat/completions`
    : `${baseUrl}/v1/chat/completions`;
  const modelToUse = status.selectedModel || settings.selectedModel || 'local-model';
  const hasCharacter = Boolean(params.characterName?.trim());

  // Extract local WD14 v3 visual/NSFW tags so they are available both as supplemental context and for text-model synthesis
  let extractedTags: string[] = [];
  try {
    const tagItems = await interrogateImageBufferWithWd14(imageBuffer, 0.24);
    const rawTags = tagItems.map((t) => t.tag);
    extractedTags = hasCharacter ? filterCharacterIdentityTags(rawTags) : rawTags;
  } catch {
    // Continue even if WD14 model isn't ready yet and a Vision model is active
  }

  const characterConstraintBlock = hasCharacter
    ? `\nCRITICAL CHARACTER LORA RULE:
A character LoRA is active and defines only the biological/physical identity of the subject.
- DO NOT mention the subject's biological hair color, eye color, permanent facial features (freckles, moles, facial bone structure), skin tone, race, ethnicity, or body type/proportions (such as breast/chest size, hip/thigh width, curvy, slender, petite, muscular, or height).
- ALWAYS KEEP and explicitly describe all clothing colors, garment types, fabric textures/patterns, lingerie/swimwear colors, footwear colors, and accessory colors (e.g., "wearing a bright red lace dress", "in a black bikini", "white thigh-high stockings", "blue denim jacket").
- DO describe transient facial expressions and emotions (e.g., smiling, blushing, parted lips, looking at viewer), hairstyle structure/arrangement (without hair color), pose, body positioning, clothing with exact colors or nudity/NSFW details, camera framing, lighting, and environment.`
    : '';

  const systemInstruction = `You are an uncensored, clinical Stable Diffusion and Flux image captioning specialist.
Describe the subject, ${
    hasCharacter
      ? 'transient facial expression/emotion, pose, clothing (including exact garment and accessory colors, patterns, and materials) or nudity/NSFW state'
      : 'appearance, clothing (with exact colors and materials) or nudity/anatomical details (including explicit or NSFW elements if present), pose'
  }, camera framing, setting, lighting, and artistic style in one cohesive, vivid image generation prompt.${characterConstraintBlock}
Rules:
- Refer to the subject descriptively ("the subject", "a woman", "a man", etc.) without inventing personal names.
- Never mention LoRA or checkpoint filenames.
- Output ONLY the final image generation prompt text with no preamble, no quotes, and no markdown.`;

  const finalizePrompt = (rawText: string): string => {
    const stripped = hasCharacter ? stripCharacterPhysicalTraits(rawText) : rawText;
    return sanitizeAgentPrompt(stripped, params.characterName);
  };

  // Try Vision path if model ID looks like a VLM or if we want to attempt multimodal completion first
  const tryVisionFirst = isLikelyVisionModelId(modelToUse) || extractedTags.length === 0;

  if (tryVisionFirst) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 35000);

      const tagHintText =
        extractedTags.length > 0
          ? `\nReference visual tags detected in image: ${extractedTags.slice(0, 45).join(', ')}.`
          : '';

      const visionUserPrompt = hasCharacter
        ? `Analyze this image and write a detailed image generation prompt capturing the pose, facial expression/emotion (e.g. smiling, blushing), full outfit/clothing details WITH ALL EXACT CLOTHING AND ACCESSORY COLORS (or nudity/NSFW state), hairstyle shape, camera framing, lighting, and environment. Only omit the subject's biological hair color, eye color, facial structure/freckles, skin tone, race/ethnicity, and body type/proportions.${tagHintText}`
        : `Analyze this image and write a detailed, accurate image generation prompt capturing the subject, pose, clothing (with exact colors and fabrics) or anatomy, framing, lighting, and environment.${tagHintText}`;

      const visionRes = await fetch(chatEndpoint, {
        method: 'POST',
        headers: getLocalLlmHeaders(true),
        signal: controller.signal,
        body: JSON.stringify({
          model: modelToUse,
          messages: [
            { role: 'system', content: systemInstruction },
            {
              role: 'user',
              content: [
                {
                  type: 'text',
                  text: visionUserPrompt,
                },
                {
                  type: 'image_url',
                  image_url: { url: fullDataUrl },
                },
              ],
            },
          ],
          temperature: 0.4,
          max_tokens: 500,
        }),
      });
      clearTimeout(timer);

      if (visionRes.ok) {
        const data = (await visionRes.json()) as any;
        const rawText: string = data?.choices?.[0]?.message?.content?.trim() || '';
        const cleaned = rawText
          .replace(/<think>[\s\S]*?<\/think>/gi, '')
          .replace(/^["']|["']$/g, '')
          .trim();

        const looksLikeRefusal =
          /cannot see|can't see|unable to view|as a text-based|i cannot fulfill|i'm sorry, but i can't/i.test(
            cleaned
          );

        if (cleaned.length > 10 && !looksLikeRefusal) {
          return {
            prompt: finalizePrompt(cleaned),
            pipelineUsed: 'vision',
            tags: extractedTags,
            modelUsed: data?.model || modelToUse,
          };
        }
      }
    } catch {
      // Fall through to WD14 + Text LLM path below
    }
  }

  // Path 2: WD14 Visual/NSFW Tags -> LM Studio Text Model
  if (extractedTags.length === 0) {
    const tagItems = await interrogateImageBufferWithWd14(imageBuffer, 0.22);
    const rawTags = tagItems.map((t) => t.tag);
    extractedTags = hasCharacter ? filterCharacterIdentityTags(rawTags) : rawTags;
  }

  if (extractedTags.length === 0) {
    throw new Error('Could not extract visual features from the uploaded image.');
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30000);
  try {
    const textUserPrompt = hasCharacter
      ? `Convert the following ordered visual tags (extracted from an image) into a single cohesive, descriptive image generation prompt. Preserve all clothing/outfit/accessory colors and fabrics (e.g. red dress, black bikini, white stockings), facial expressions/emotions (e.g. smiling, blushing), hairstyle shape, pose, nudity/NSFW details, lighting, camera framing, and setting. Only omit the subject's biological hair color, eye color, permanent facial features, skin tone, race/ethnicity, and body type/proportions:\n\nVisual Tags: ${extractedTags.join(', ')}\n\nOutput ONLY the prompt text:`
      : `Convert the following ordered visual tags (extracted from an image, ordered from highest confidence to lowest) into a single cohesive, descriptive image generation prompt that preserves all subject, pose, clothing (with exact colors), anatomical/NSFW, lighting, and setting details:\n\nVisual Tags: ${extractedTags.join(', ')}\n\nOutput ONLY the prompt text:`;

    const textRes = await fetch(chatEndpoint, {
      method: 'POST',
      headers: getLocalLlmHeaders(true),
      signal: controller.signal,
      body: JSON.stringify({
        model: modelToUse,
        messages: [
          { role: 'system', content: systemInstruction },
          {
            role: 'user',
            content: textUserPrompt,
          },
        ],
        temperature: 0.5,
        max_tokens: 500,
      }),
    });
    clearTimeout(timer);

    if (!textRes.ok) {
      const errBody = await textRes.text();
      throw new Error(`Local LLM returned HTTP ${textRes.status}: ${errBody}`);
    }

    const data = (await textRes.json()) as any;
    const rawContent: string = data?.choices?.[0]?.message?.content?.trim() || '';
    const cleaned = rawContent
      .replace(/<think>[\s\S]*?<\/think>/gi, '')
      .replace(/^["']|["']$/g, '')
      .trim();

    // If the text LLM refused or returned empty, fall back to the clean comma-separated WD14 tags
    const finalPrompt =
      cleaned.length > 10 && !/i cannot fulfill|i'm sorry, but i can't/i.test(cleaned)
        ? finalizePrompt(cleaned)
        : extractedTags.join(', ');

    return {
      prompt: finalPrompt,
      pipelineUsed: 'wd14_text',
      tags: extractedTags,
      modelUsed: data?.model || modelToUse,
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Adaptive Character Portrait Physical Description Analyzer:
 * 1. If a Vision-capable LLM is online, analyzes the portrait directly to summarize baseline physical traits.
 * 2. Otherwise (or if Vision fails/refuses), runs local WD14 v3 to extract physical identity tags and
 *    synthesizes them via Text LLM (or falls back to clean formatted physical tags if LLM is offline).
 */
export async function analyzeCharacterPortraitPhysicalTraits(params: {
  imageBuffer: Buffer;
  imageBase64DataUrl: string;
  characterName?: string;
}): Promise<{
  physicalDescription: string;
  pipelineUsed: 'vision' | 'wd14_text' | 'wd14_only';
  tags: string[];
  modelUsed: string;
}> {
  const status = await checkLmStudioStatus();
  const settings = getLmStudioSettings();
  const baseUrl = settings.baseUrl.replace(/\/+$/, '');
  const chatEndpoint = baseUrl.endsWith('/v1')
    ? `${baseUrl}/chat/completions`
    : `${baseUrl}/v1/chat/completions`;
  const modelToUse = status.selectedModel || settings.selectedModel || 'local-model';

  const systemInstruction = `You are a character casting and visual reference specialist.
Analyze the subject's permanent physical traits in this portrait to write a concise ~35–70 word physical reference summary for future image generation consistency.
Include:
- Gender presentation and approximate adult age range
- Build, frame, and natural proportions
- Skin tone and complexion
- Face shape, eye color/shape, eyebrow/lip shape
- Natural hair color, texture, and typical length
- Distinctive permanent marks (freckles, moles, scars, tattoos, signature glasses, or non-human ears)
Explicitly IGNORE: clothing, outfits, accessories, poses, temporary facial expressions, lighting, camera angle, and background setting.
Rules:
- Never mention personal names or filenames.
- Output ONLY the concise plain-text physical description with no preamble, quotes, or markdown.`;

  // Try Vision LLM first when online and model is Vision-capable
  if (status.online && isLikelyVisionModelId(modelToUse)) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 60000);
      const visionRes = await fetch(chatEndpoint, {
        method: 'POST',
        headers: getLocalLlmHeaders(true),
        signal: controller.signal,
        body: JSON.stringify({
          model: modelToUse,
          messages: [
            { role: 'system', content: systemInstruction },
            {
              role: 'user',
              content: [
                {
                  type: 'text',
                  text: 'Summarize only this character’s permanent physical traits (gender presentation, approximate age, build, skin tone, eye color, facial structure, natural hair color/texture, and any permanent marks). Ignore their outfit, pose, expression, lighting, and background.',
                },
                {
                  type: 'image_url',
                  image_url: { url: params.imageBase64DataUrl },
                },
              ],
            },
          ],
          temperature: 0.3,
          max_tokens: 260,
        }),
      });
      clearTimeout(timer);

      if (visionRes.ok) {
        const data = (await visionRes.json()) as any;
        const rawText: string = data?.choices?.[0]?.message?.content?.trim() || '';
        const cleaned = rawText
          .replace(/<think>[\s\S]*?<\/think>/gi, '')
          .replace(/^["']|["']$/g, '')
          .trim();

        const looksLikeRefusal =
          /cannot see|can't see|unable to view|as a text-based|i cannot fulfill|i'm sorry, but i can't/i.test(
            cleaned
          );

        if (cleaned.length > 10 && !looksLikeRefusal) {
          return {
            physicalDescription: sanitizeAgentPrompt(cleaned, params.characterName),
            pipelineUsed: 'vision',
            tags: [],
            modelUsed: data?.model || modelToUse,
          };
        }
      }
    } catch {
      // Fall through cleanly to WD14 fallback below
    }
  }

  // Fallback path: local WD14 v3 physical identity tag extraction
  const tagItems = await interrogateImageBufferWithWd14(params.imageBuffer, 0.22);
  const rawTags = tagItems.map((t) => t.tag);
  const identityTags = extractCharacterIdentityTags(rawTags);
  const effectiveTags = identityTags.length > 0 ? identityTags : rawTags.slice(0, 20);

  if (effectiveTags.length === 0) {
    throw new Error(
      'Could not extract physical traits from portrait. Ensure a Vision LLM is connected or WD14 model is downloaded.'
    );
  }

  // Synthesize WD14 physical tags via Text LLM if online
  if (status.online) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 45000);
    try {
      const textRes = await fetch(chatEndpoint, {
        method: 'POST',
        headers: getLocalLlmHeaders(true),
        signal: controller.signal,
        body: JSON.stringify({
          model: modelToUse,
          messages: [
            { role: 'system', content: systemInstruction },
            {
              role: 'user',
              content: `Turn these portrait physical tags into one concise ~35–70 word physical reference summary covering only permanent traits (gender presentation, build, skin tone, hair color/texture, eye color, facial structure, and signature marks). Ignore any clothing, pose, or background tags:\n\nPhysical Tags: ${effectiveTags.join(', ')}\n\nOutput ONLY the physical reference summary:`,
            },
          ],
          temperature: 0.35,
          max_tokens: 260,
        }),
      });
      clearTimeout(timer);

      if (textRes.ok) {
        const data = (await textRes.json()) as any;
        const rawText: string = data?.choices?.[0]?.message?.content?.trim() || '';
        const cleaned = rawText
          .replace(/<think>[\s\S]*?<\/think>/gi, '')
          .replace(/^["']|["']$/g, '')
          .trim();

        const looksLikeRefusal =
          /i cannot fulfill|i'm sorry, but i can't/i.test(cleaned);
        if (cleaned.length > 10 && !looksLikeRefusal) {
          return {
            physicalDescription: sanitizeAgentPrompt(cleaned, params.characterName),
            pipelineUsed: 'wd14_text',
            tags: effectiveTags,
            modelUsed: data?.model || modelToUse,
          };
        }
      }
    } catch {
      // Fall back to formatted WD14 tags below
    } finally {
      clearTimeout(timer);
    }
  }

  // Pure WD14 offline fallback
  return {
    physicalDescription: effectiveTags.join(', '),
    pipelineUsed: 'wd14_only',
    tags: effectiveTags,
    modelUsed: 'WD14 v3 Local Tagger',
  };
}

// normalizeLoraMatchKey defined above for shared LLM context & LoRA matching

/**
 * Interactive multi-turn Quick Gen Conversation handler via LM Studio /v1/chat/completions.
 * Extracts any <proposed_prompt>...</proposed_prompt> block and optional <selected_loras>...</selected_loras> picks.
 */
export async function converseQuickGenPrompt(params: {
  messages: Array<{
    role: 'user' | 'assistant';
    content: string;
    proposedPrompt?: string | null;
    proposalKind?: 'prompt' | 'concept';
  }>;
  characterName?: string;
  characterDescription?: string;
  characterPhysicalDescription?: string;
  loraNames?: string[];
  excludedLoras?: string[];
  batchCount?: number;
}): Promise<{
  reply: string;
  proposedPrompt: string | null;
  proposalKind: 'prompt' | 'concept';
  selectedLoras: string[];
  modelUsed: string;
}> {
  const status = await checkLmStudioStatus();
  if (!status.online) {
    throw new Error('Local LLM is offline. Start your Local LLM server to use Conversation mode.');
  }
  const targetBatchCount = Math.max(1, Math.min(20, Number(params.batchCount) || 1));

  const settings = getLmStudioSettings();
  const baseUrl = settings.baseUrl.replace(/\/+$/, '');
  const chatEndpoint = baseUrl.endsWith('/v1')
    ? `${baseUrl}/chat/completions`
    : `${baseUrl}/v1/chat/completions`;
  const modelToUse = status.selectedModel || settings.selectedModel || 'local-model';

  const excludedKeys = new Set(
    (params.excludedLoras || []).map((l) => normalizeLoraMatchKey(l)).filter(Boolean)
  );

  // Query curated non-character @mention LoRAs that have an Agent Description configured
  const candidateRows = db
    .prepare(
      `SELECT m.name, m.filename, m.lora_category, m.nickname, m.llm_description
       FROM models m
       WHERE m.model_type = 'lora'
         AND m.mention_enabled = 1
         AND COALESCE(m.is_hidden, 0) = 0
         AND TRIM(COALESCE(m.llm_description, '')) != ''
         AND LOWER(COALESCE(m.lora_category, 'unclassified')) != 'character'
         AND NOT EXISTS (
           SELECT 1 FROM character_loras cl WHERE LOWER(cl.lora_name) = LOWER(m.filename)
         )
       ORDER BY LOWER(COALESCE(NULLIF(TRIM(m.nickname), ''), m.name)) ASC`
    )
    .all() as Array<{
    name: string;
    filename: string;
    lora_category: string;
    nickname: string | null;
    llm_description: string;
  }>;

  const getCandidateHandle = (c: { nickname: string | null; name: string }) =>
    (c.nickname || '').trim().replace(/^@+/, '') || c.name.trim();

  const availableCandidates = candidateRows.filter((c) => {
    const fileKey = normalizeLoraMatchKey(c.filename);
    const nameKey = normalizeLoraMatchKey(c.name);
    const nickKey = c.nickname ? normalizeLoraMatchKey(c.nickname) : '';
    return !excludedKeys.has(fileKey) && !excludedKeys.has(nameKey) && (!nickKey || !excludedKeys.has(nickKey));
  });

  const { characterBlock, attachedLoraBlock } = buildLlmCharacterAndLoraContext({
    characterName: params.characterName,
    characterDescription: params.characterDescription,
    characterPhysicalDescription: params.characterPhysicalDescription,
    loraNames: params.loraNames,
  });

  const contextNotes: string[] = [];
  if (characterBlock) {
    contextNotes.push(characterBlock);
  }
  if (attachedLoraBlock) {
    contextNotes.push(attachedLoraBlock);
  }
  if (availableCandidates.length > 0) {
    const catalogLines = availableCandidates.map((c) => {
      const handle = getCandidateHandle(c);
      const cat = c.lora_category && c.lora_category !== 'unclassified' ? ` [${c.lora_category}]` : '';
      return `- @${handle}${cat}: ${c.llm_description.trim()}`;
    });
    contextNotes.push(
      [
        `Optional non-character LoRAs available for selection:`,
        ...catalogLines,
        `LoRA Selection Rules:`,
        `- If optional non-character LoRA(s) clearly match the scene, style, lighting, or outfit (keeping active ones that still fit), list up to 3 handles inside <selected_loras>["@handle1", "@handle2"]</selected_loras>.`,
        `- Do NOT select character LoRAs or write trigger words inside the prompt.`,
      ].join('\n')
    );
  }
  if (excludedKeys.size > 0) {
    const excludedLabels = candidateRows
      .filter((c) => {
        const fileKey = normalizeLoraMatchKey(c.filename);
        const nickKey = c.nickname ? normalizeLoraMatchKey(c.nickname) : '';
        return excludedKeys.has(fileKey) || (nickKey && excludedKeys.has(nickKey));
      })
      .map((c) => `@${getCandidateHandle(c)}`);
    const fallbackExcluded = Array.from(excludedKeys).map((k) => `@${k}`);
    const displayExcluded = excludedLabels.length > 0 ? excludedLabels : fallbackExcluded;
    contextNotes.push(
      `User-deselected LoRAs (respect the user's choice and do NOT select these again unless the user explicitly asks to re-enable them): ${displayExcluded.join(', ')}.`
    );
  }
  if (targetBatchCount > 1) {
    contextNotes.push(
      `ACTIVE MODE: BATCH SET CONCEPT (x${targetBatchCount} shots). Wrap the approved Set Concept in <proposed_concept>...</proposed_concept> tags (do not emit <proposed_prompt>). Specify the Visual Medium & Color Palette, Subject Styling/Wardrobe, Environment & Lighting plan (fixed for one continuous scene, or progression/multi-location if requested), and the ${targetBatchCount}-shot arc.`
    );
  } else {
    contextNotes.push(
      `ACTIVE MODE: SINGLE SHOT. Wrap each ready-to-generate prompt in <proposed_prompt>...</proposed_prompt> tags.`
    );
  }

  const validMessages = params.messages.filter(
    (m) =>
      m &&
      (m.role === 'user' || m.role === 'assistant') &&
      Boolean(m.content?.trim() || m.proposedPrompt?.trim())
  );

  // Re-attach <proposed_prompt> or <proposed_concept> to assistant turns because UI storage keeps it outside `content`
  const recentRaw = validMessages.slice(-10);
  const recentMessages = recentRaw.map((m) => {
    const baseContent = (m.content || '').trim();
    const promptBlock = m.proposedPrompt?.trim();
    const tag = m.proposalKind === 'concept' ? 'proposed_concept' : 'proposed_prompt';
    if (
      m.role === 'assistant' &&
      promptBlock &&
      !/<(?:proposed_prompt|proposed_concept)>/i.test(baseContent)
    ) {
      const combined = baseContent
        ? `${baseContent}\n\n<${tag}>\n${promptBlock}\n</${tag}>`
        : `<${tag}>\n${promptBlock}\n</${tag}>`;
      return { role: m.role, content: combined };
    }
    return { role: m.role, content: baseContent };
  });

  // If the latest proposed block scrolled outside the 10-message window, pin it in context
  const latestPromptInAll = [...validMessages]
    .reverse()
    .find((m) => m.role === 'assistant' && m.proposedPrompt?.trim())
    ?.proposedPrompt?.trim();
  const latestPromptInRecent = recentRaw.some(
    (m) =>
      m.role === 'assistant' &&
      (Boolean(m.proposedPrompt?.trim()) ||
        /<(?:proposed_prompt|proposed_concept)>/i.test(m.content || ''))
  );
  if (latestPromptInAll && !latestPromptInRecent) {
    contextNotes.push(
      `Latest active <proposed_prompt> from earlier in this series (preserve its unchanged wardrobe and environment anchors verbatim unless asked to change them):\n<proposed_prompt>\n${latestPromptInAll}\n</proposed_prompt>`
    );
  }

  const systemPrompt = `${settings.conversationSystemPrompt}\n\n${contextNotes.join('\n\n')}`.trim();

  const apiMessages = [
    { role: 'system', content: systemPrompt },
    ...recentMessages,
  ];

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 90000);
  try {
    const res = await fetch(chatEndpoint, {
      method: 'POST',
      headers: getLocalLlmHeaders(true),
      signal: controller.signal,
      body: JSON.stringify({
        model: modelToUse,
        messages: apiMessages,
        temperature: 0.7,
        max_tokens: 1500,
      }),
    });
    clearTimeout(timer);

    if (!res.ok) {
      const errText = await res.text();
      logger.error('LocalLLM', `Conversation HTTP ${res.status}`, errText);
      throw new Error(`Local LLM returned HTTP ${res.status}: ${errText}`);
    }

    const data = (await res.json()) as any;
    const rawContent: string = data?.choices?.[0]?.message?.content?.trim() || '';
    const withoutThink = rawContent.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();

    // Extract optional <selected_loras>...</selected_loras> and strip tag before prompt/reply parsing
    const selectedLoras: string[] = [];
    const loraTagMatch = withoutThink.match(/<selected_loras>([\s\S]*?)(?:<\/selected_loras>|$)/i);
    if (loraTagMatch && loraTagMatch[1]?.trim() && availableCandidates.length > 0) {
      const rawBlock = loraTagMatch[1].trim();
      let tokens: string[] = [];
      try {
        const parsed = JSON.parse(rawBlock);
        if (Array.isArray(parsed)) {
          tokens = parsed.map((v) => String(v));
        }
      } catch {
        tokens = rawBlock
          .replace(/^\[|\]$/g, '')
          .split(/[,\n]+/)
          .map((t) => t.replace(/^["'\s-]+|["'\s]+$/g, ''))
          .filter(Boolean);
      }

      const seenFiles = new Set<string>();
      for (const token of tokens) {
        if (selectedLoras.length >= 3) break;
        const cleanKey = normalizeLoraMatchKey(token);
        if (!cleanKey) continue;
        const matched = availableCandidates.find((c) => {
          const fileKey = normalizeLoraMatchKey(c.filename);
          const nameKey = normalizeLoraMatchKey(c.name);
          const nickKey = c.nickname ? normalizeLoraMatchKey(c.nickname) : '';
          return cleanKey === fileKey || cleanKey === nameKey || (nickKey && cleanKey === nickKey);
        });
        if (matched && !seenFiles.has(matched.filename)) {
          seenFiles.add(matched.filename);
          selectedLoras.push(matched.filename);
        }
      }
    }

    const cleanedContent = withoutThink
      .replace(/<selected_loras>[\s\S]*?(?:<\/selected_loras>|$)/gi, '')
      .trim();

    let proposedPrompt: string | null = null;
    let proposalKind: 'prompt' | 'concept' = targetBatchCount > 1 ? 'concept' : 'prompt';
    let replyText = cleanedContent;

    // 1. Primary extraction: <proposed_concept>...</proposed_concept> or <proposed_prompt>...</proposed_prompt>
    const conceptMatch = cleanedContent.match(
      /<proposed_concept>([\s\S]*?)(?:<\/proposed_concept>|$)/i
    );
    const promptMatch = cleanedContent.match(
      /<proposed_prompt>([\s\S]*?)(?:<\/proposed_prompt>|$)/i
    );

    if (conceptMatch && conceptMatch[1]?.trim()) {
      proposalKind = 'concept';
      proposedPrompt = sanitizeAgentPrompt(
        conceptMatch[1].replace(/^["']|["']$/g, '').trim(),
        params.characterName
      );
      replyText = cleanedContent
        .replace(/<proposed_concept>[\s\S]*?(?:<\/proposed_concept>|$)/gi, '')
        .replace(/<proposed_prompt>[\s\S]*?(?:<\/proposed_prompt>|$)/gi, '')
        .trim();
    } else if (promptMatch && promptMatch[1]?.trim()) {
      proposalKind = targetBatchCount > 1 ? 'concept' : 'prompt';
      proposedPrompt = sanitizeAgentPrompt(
        promptMatch[1].replace(/^["']|["']$/g, '').trim(),
        params.characterName
      );
      replyText = cleanedContent
        .replace(/<proposed_prompt>[\s\S]*?(?:<\/proposed_prompt>|$)/gi, '')
        .trim();
    } else {
      // 2. Fallback: ```prompt ... ``` fenced block if model omitted XML tags
      const fenceMatch = cleanedContent.match(/```(?:prompt|concept|text)?\s*([\s\S]{25,}?)```/i);
      if (fenceMatch && fenceMatch[1]?.trim()) {
        proposedPrompt = sanitizeAgentPrompt(
          fenceMatch[1].replace(/^["']|["']$/g, '').trim(),
          params.characterName
        );
        replyText = cleanedContent.replace(fenceMatch[0], '').trim();
      }
    }

    if (!replyText && proposedPrompt) {
      replyText =
        proposalKind === 'concept'
          ? 'Here is the set concept based on our conversation. You can preview/edit individual shots or expand & submit directly:'
          : 'Here is a prompt based on our conversation. You can submit it or keep chatting to refine it:';
    } else if (!replyText) {
      replyText = 'Could you share a bit more about the scene, lighting, or mood you have in mind?';
    }

    logger.info(
      'LocalLLM',
      `Conversation turn completed (${data?.model || modelToUse}) | proposalKind=${proposalKind} | hasProposal=${Boolean(
        proposedPrompt
      )} | selectedLoras=${selectedLoras.length > 0 ? selectedLoras.join(', ') : 'none'}`
    );

    return {
      reply: replyText,
      proposedPrompt,
      proposalKind,
      selectedLoras,
      modelUsed: data?.model || modelToUse,
    };
  } finally {
    clearTimeout(timer);
  }
}


