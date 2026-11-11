import { db } from '../db.ts';
import { appConfig } from '../config.ts';
import type { LmStudioGuidingTemplate, LmStudioStatus } from '../../shared/types.ts';
import { interpolatePrompt } from '../../shared/utils.ts';

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
} {
  const row = db.prepare('SELECT * FROM lm_studio_settings WHERE id = 1').get() as any;
  if (!row) {
    return {
      baseUrl: appConfig.lmStudioUrl,
      selectedModel: '',
      systemPrompt:
        'You are a creative photography director and Stable Diffusion / Flux prompt engineer.',
    };
  }
  return {
    baseUrl: row.base_url || appConfig.lmStudioUrl,
    selectedModel: row.selected_model || '',
    systemPrompt: row.system_prompt || '',
  };
}

/**
 * Updates LM Studio settings in SQLite.
 */
export function updateLmStudioSettings(payload: {
  baseUrl?: string;
  selectedModel?: string;
  systemPrompt?: string;
}): {
  baseUrl: string;
  selectedModel: string;
  systemPrompt: string;
} {
  const current = getLmStudioSettings();
  const nextUrl = (payload.baseUrl ?? current.baseUrl).replace(/\/+$/, '');
  const nextModel = payload.selectedModel ?? current.selectedModel;
  const nextPrompt = payload.systemPrompt ?? current.systemPrompt;

  db.prepare(
    `UPDATE lm_studio_settings
     SET base_url = ?, selected_model = ?, system_prompt = ?, updated_at = datetime('now')
     WHERE id = 1`
  ).run(nextUrl, nextModel, nextPrompt);

  appConfig.lmStudioUrl = nextUrl;
  return {
    baseUrl: nextUrl,
    selectedModel: nextModel,
    systemPrompt: nextPrompt,
  };
}

/**
 * Checks connectivity to LM Studio (/v1/models) and lists loaded models + guiding templates.
 */
export async function checkLmStudioStatus(customBaseUrl?: string): Promise<LmStudioStatus> {
  const settings = getLmStudioSettings();
  const guidingTemplates = listLmStudioGuidingTemplates();
  const baseUrl = (customBaseUrl || settings.baseUrl).replace(/\/+$/, '');
  const modelsEndpoint = baseUrl.endsWith('/v1') ? `${baseUrl}/models` : `${baseUrl}/v1/models`;

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3500);
    const res = await fetch(modelsEndpoint, { signal: controller.signal });
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
      availableModels,
      guidingTemplates,
      error: null,
    };
  } catch (err: any) {
    return {
      online: false,
      baseUrl,
      selectedModel: settings.selectedModel,
      systemPrompt: settings.systemPrompt,
      availableModels: [],
      guidingTemplates,
      error: err?.message || 'LM Studio server unreachable at ' + baseUrl,
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

/**
 * Connects to LM Studio's /v1/chat/completions endpoint using the chosen Guiding Prompt Template
 * to generate a sequence of N prompts for a photo set theme.
 */
export async function generatePhotoSetPromptsWithAgent(params: {
  characterName: string;
  characterDescription?: string;
  loraNames: string[];
  theme: string;
  count: number;
  basePromptTemplate: string;
  guidingTemplateId?: number;
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
  const allGuiding = listLmStudioGuidingTemplates();
  const chosenGuiding =
    (params.guidingTemplateId
      ? allGuiding.find((g) => g.id === Number(params.guidingTemplateId))
      : null) ||
    allGuiding.find((g) => g.isDefault) ||
    allGuiding[0];

  const baseUrl = (params.baseUrlOverride || settings.baseUrl).replace(/\/+$/, '');
  const chatEndpoint = baseUrl.endsWith('/v1')
    ? `${baseUrl}/chat/completions`
    : `${baseUrl}/v1/chat/completions`;

  const count = Math.max(1, Math.min(20, Number(params.count) || 4));

  // Clean lora names: remove raw .safetensors, .ckpt, .pt extensions so filenames are never sent
  const cleanLoras = (params.loraNames || [])
    .map((l) => l.replace(/\.(?:safetensors|ckpt|pt|bin)$/i, '').trim())
    .filter(Boolean);
  const loraSummary = cleanLoras.join(', ');

  const neutralSubject = 'the subject';

  const resolvedBaseStyle = interpolatePromptTemplate(params.basePromptTemplate, {
    characterName: neutralSubject,
    loraSummary: '',
    theme: params.theme,
    count,
  });

  const sentSystemPrompt = interpolatePromptTemplate(
    chosenGuiding?.systemPrompt ||
      `You are a creative photography director and ComfyUI prompt engineer.
Your job is to take a Photo Set Theme and Base Scene Style, and write {count} distinct, cohesive image generation prompts for a multi-photo set.
Vary the camera framing across the set (e.g. intimate close-up portrait, medium three-quarter shot, wide environmental shot, dramatic angle), vary poses and micro-actions, and enrich the lighting and environmental details.
Refer to the subject neutrally (e.g., "they", "them", "the subject", "a person") without including specific character names or LoRA/model filenames.
Return ONLY a valid JSON array of {count} prompt strings with no markdown formatting or extra commentary.`,
    {
      characterName: neutralSubject,
      loraSummary: '',
      theme: params.theme,
      count,
      basePrompt: resolvedBaseStyle,
    }
  );

  const sentUserPrompt = interpolatePromptTemplate(
    chosenGuiding?.userPromptTemplate ||
      `Generate {count} distinct image prompts for a cohesive photo set:
Subject: The subject (refer to them using neutral terms such as "they", "them", or "the subject")
Photo Set Theme: {theme}
Base Scene Style: {base_prompt}

Rules:
- Refer to the subject neutrally (e.g. "they", "them", "the subject", "a person").
- Do NOT include character names, model filenames, or file extensions (e.g. no .safetensors).
- Focus on setting, lighting, framing, poses, and clothing/mood.
- Return ONLY a JSON array of {count} complete prompt strings.`,
    {
      characterName: neutralSubject,
      loraSummary: '',
      theme: params.theme,
      count,
      basePrompt: resolvedBaseStyle,
    }
  );

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 35000);

    const modelToUse = params.modelOverride || settings.selectedModel || 'local-model';
    const res = await fetch(chatEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        model: modelToUse,
        messages: [
          { role: 'system', content: sentSystemPrompt },
          { role: 'user', content: sentUserPrompt },
        ],
        temperature: 0.75,
        max_tokens: 2048,
      }),
    });
    clearTimeout(timer);

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`LM Studio returned HTTP ${res.status}: ${errText}`);
    }

    const data = (await res.json()) as any;
    const rawContent: string = data?.choices?.[0]?.message?.content?.trim() || '';
    const cleaned = rawContent.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();

    let parsedPrompts: string[] = [];
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

    if (parsedPrompts.length === 0) {
      parsedPrompts = cleaned
        .split('\n')
        .map((line) =>
          line
            .replace(/^\s*(?:\d+[\.\)]\s*|[-*]\s*|Prompt\s*\d+:\s*)/i, '')
            .replace(/^["']|["'],?$/g, '')
            .trim()
        )
        .filter((line) => line.length > 15 && !line.startsWith('[') && !line.startsWith(']'));
    }

    if (parsedPrompts.length === 0) {
      throw new Error('LM Studio response could not be parsed into individual prompts.');
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
      guidingTemplateName: chosenGuiding?.name || 'Default Guiding Prompt',
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
      modelUsed: 'Built-in Photo Set Director (LM Studio Offline)',
      guidingTemplateName: chosenGuiding?.name || 'Default Guiding Prompt',
      sentSystemPrompt,
      sentUserPrompt,
      warning: `LM Studio unreachable (${err?.message || 'connection refused'}). Generated set variations using Couchy's built-in shot director so you can still preview or edit your set.`,
    };
  }
}
