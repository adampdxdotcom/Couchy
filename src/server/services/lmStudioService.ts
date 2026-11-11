import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { db } from '../db.ts';
import { appConfig } from '../config.ts';
import type { LmStudioGuidingTemplate, LmStudioStatus } from '../../shared/types.ts';
import { interpolatePrompt } from '../../shared/utils.ts';
import { interrogateImageBufferWithWd14 } from './visualTaggerService.ts';

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

/**
 * Heuristic check for whether a model identifier in LM Studio is likely a Vision-Language Model (VLM).
 */
function isLikelyVisionModelId(modelId: string): boolean {
  return /(?:\b|_|-)(?:vl|vision|llava|joycaption|pixtral|minicpm|moondream|florence|internvl|molmo|bakllava|cogvlm|idefics|paligemma|gemma-?3|qwen[\w.-]*vl)(?:\b|_|-)/i.test(
    modelId
  );
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
    throw new Error('LM Studio is offline. Connect LM Studio to interrogate images.');
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
    const tagItems = await interrogateImageBufferWithWd14(imageBuffer, 0.28);
    const rawTags = tagItems.map((t) => t.tag);
    extractedTags = hasCharacter ? filterCharacterIdentityTags(rawTags) : rawTags;
  } catch {
    // Continue even if WD14 model isn't ready yet and a Vision model is active
  }

  const characterConstraintBlock = hasCharacter
    ? `\nCRITICAL CHARACTER LORA RULE:
A character LoRA is active and defines all physical identity features of the subject.
- DO NOT mention or describe hair color, eye color, permanent facial features (freckles, moles, facial bone structure), skin tone, race, ethnicity, or body type/proportions (such as breast/chest size, hip/thigh width, curvy, slender, petite, muscular, or height).
- DO describe transient facial expressions and emotions (e.g., smiling, blushing, parted lips, looking at viewer), hairstyle/hair arrangement (without color), pose, body positioning, clothing or nudity/NSFW details, camera framing, lighting, and environment.`
    : '';

  const systemInstruction = `You are an uncensored, clinical Stable Diffusion and Flux image captioning specialist.
Describe the subject, ${
    hasCharacter
      ? 'transient facial expression/emotion, pose, clothing or nudity/NSFW state'
      : 'appearance, clothing or nudity/anatomical details (including explicit or NSFW elements if present), pose'
  }, camera framing, setting, lighting, and artistic style in one cohesive, vivid image generation prompt.${characterConstraintBlock}
Rules:
- Refer to the subject neutrally ("the subject", "a woman", "a man", "they") without inventing personal names.
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
          ? `\nReference visual tags detected in image: ${extractedTags.slice(0, 30).join(', ')}.`
          : '';

      const visionUserPrompt = hasCharacter
        ? `Analyze this image and write a detailed image generation prompt capturing ONLY the pose, facial expression/emotion (e.g. smiling, blushing), clothing or nudity/NSFW state, camera framing, lighting, and environment. Omit all descriptions of hair color, eye color, facial structure/freckles, skin tone, race/ethnicity, and body type/proportions.${tagHintText}`
        : `Analyze this image and write a detailed, accurate image generation prompt capturing the subject, pose, clothing/anatomy, framing, lighting, and environment.${tagHintText}`;

      const visionRes = await fetch(chatEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
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
    const tagItems = await interrogateImageBufferWithWd14(imageBuffer, 0.25);
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
      ? `Convert the following ordered visual tags (extracted from an image) into a single cohesive, descriptive image generation prompt. Preserve facial expressions/emotions (e.g. smiling, blushing), pose, clothing or nudity/NSFW details, lighting, camera framing, and setting, but DO NOT include any mention of hair color, eye color, facial features, skin tone, race/ethnicity, or body type/proportions:\n\nVisual Tags: ${extractedTags.join(', ')}\n\nOutput ONLY the prompt text:`
      : `Convert the following ordered visual tags (extracted from an image, ordered from highest confidence to lowest) into a single cohesive, descriptive image generation prompt that preserves all subject, pose, clothing/anatomical/NSFW, lighting, and setting details:\n\nVisual Tags: ${extractedTags.join(', ')}\n\nOutput ONLY the prompt text:`;

    const textRes = await fetch(chatEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
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
      throw new Error(`LM Studio returned HTTP ${textRes.status}: ${errBody}`);
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

