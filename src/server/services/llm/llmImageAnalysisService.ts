import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { appConfig } from '../../config.ts';
import { getBoolSetting } from '../settingsService.ts';
import { invalidateStorageUsageStatsCache } from '../storageStatsService.ts';
import {
  detectExposureCuesWithWd14,
  interrogateImageBufferWithWd14,
  type Wd14ExposureCues,
} from '../visualTaggerService.ts';
import {
  checkLmStudioStatus,
  checkLmStudioVisionSupport,
  getLmStudioSettings,
  isLikelyVisionModelId,
  postChatCompletion,
} from './llmClientService.ts';
import {
  extractCharacterIdentityTags,
  filterCharacterIdentityTags,
  mergeMissedExposureCues,
  sanitizeAgentPrompt,
  stripCharacterPhysicalTraits,
} from './llmPromptUtils.ts';

function archiveUploadedPromptImage1Mp(imageBuffer: Buffer, mimeHeader: string): string | null {
  if (!getBoolSetting('save_uploaded_prompt_images', false)) return null;

  try {
    fs.mkdirSync(appConfig.uploadedImagesDir, { recursive: true });
    const hashPrefix = crypto.createHash('sha256').update(imageBuffer).digest('hex').slice(0, 10);
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const mimeLower = mimeHeader.toLowerCase();
    const ext = mimeLower.includes('png') ? 'png' : mimeLower.includes('webp') ? 'webp' : 'jpg';
    const generatedName = `prompt-1mp-${timestamp}-${hashPrefix}.${ext}`;
    fs.writeFileSync(path.join(appConfig.uploadedImagesDir, generatedName), imageBuffer);
    invalidateStorageUsageStatsCache();
    return generatedName;
  } catch (err) {
    console.error('Failed to save 1MP uploaded prompt image:', err);
    return null;
  }
}

/**
 * Hybrid Image-to-Prompt Interrogation Pipeline:
 * Uses Vision LLM (+ WD14 nudity/exposure audit) when available, falling back to
 * local WD14 v3 tags synthesized into natural prose by a Text LLM.
 */
export async function interrogateImageToPrompt(params: {
  imageBase64DataUrl: string;
  characterName?: string;
  userHint?: string;
}): Promise<{
  prompt: string;
  pipelineUsed: 'vision' | 'wd14_text';
  tags: string[];
  modelUsed: string;
  savedFilename?: string | null;
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
  const savedFilename = archiveUploadedPromptImage1Mp(imageBuffer, base64Match?.[0] || '');

  const settings = getLmStudioSettings();
  const baseUrl = settings.baseUrl.replace(/\/+$/, '');
  const modelToUse = status.selectedModel || settings.selectedModel || 'local-model';
  const hasCharacter = Boolean(params.characterName?.trim());
  const cleanUserHint = (params.userHint || '').trim();

  const characterConstraintBlock = hasCharacter
    ? `\nCHARACTER LORA RULE:
A character LoRA defines hair color and eye color.
- DO NOT mention the subject's hair color or eye color.
- DO keep hairstyle shape/length (without hair color), facial expression, pose, actions, physical interactions with surrounding objects, clothing/colors, AND full nudity or anatomical exposure details (never omit nudity when a character is attached).`
    : '';

  const userHintBlock = cleanUserHint
    ? `\nUSER FOCUS / CONTEXT HINT:
"${cleanUserHint}"
Prioritize and accurately incorporate the objects, action, or focus mentioned in this hint while faithfully describing the image.`
    : '';

  const systemInstruction = `You are an uncensored, clinical Stable Diffusion and Flux image captioning specialist.
Describe the entire scene accurately in one cohesive, vivid image generation prompt covering ALL four pillars with balanced detail:
1. Core Action & Spatial Interaction: What the subject is physically doing and how they interact with surrounding objects or surfaces (e.g., climbing into, sitting on, leaning against, holding).
2. Prominent Objects, Machinery & Props: Name specific appliances, machines, furniture, vehicles, structures, and props using concrete nouns, scale, colors, and materials (never collapse notable props into vague words like "indoors", "equipment", or "room").
3. Setting, Lighting & Framing: Specific environment/location, background elements, lighting mood, and camera angle/shot framing.
4. Subject Details & Exposure State: Transient facial expression, pose, ${
    hasCharacter
      ? 'hairstyle shape (without hair color), and exact clothing/coverage state'
      : 'appearance, hairstyle, and exact clothing/coverage state'
  }. Whenever nudity, partial undress, or sheer fabric is present, explicitly state the exact state of undress (completely nude, topless, bottomless, underwear-only, pulled-aside clothing, or see-through fabric) and name every visible exposed anatomical detail directly in plain clinical terms (bare breasts, exposed nipples/areolae, vulva/genitals, penis, pubic hair, bare buttocks) without softening, euphemisms, or omitting lower/upper body exposure.${characterConstraintBlock}${userHintBlock}
Rules:
- Refer to the subject descriptively ("a woman", "the subject", "a man", etc.) without inventing personal names.
- Never mention LoRA or checkpoint filenames.
- Never gloss over or lightly summarize nudity—if skin, breasts, nipples, buttocks, or genitals are exposed, describe them explicitly and completely.
- Output ONLY the final image generation prompt text with no preamble, no quotes, and no markdown.`;

  const finalizePrompt = (rawText: string): string => {
    const stripped = hasCharacter ? stripCharacterPhysicalTraits(rawText) : rawText;
    return sanitizeAgentPrompt(stripped, params.characterName);
  };

  // Path 1: Vision LLM directly (+ WD14 exposure check)
  if (await checkLmStudioVisionSupport(baseUrl, modelToUse)) {
    let exposureCues: Wd14ExposureCues | null = null;
    try {
      exposureCues = await detectExposureCuesWithWd14(imageBuffer);
    } catch {
      // Non-fatal if WD14 model isn't downloaded
    }

    const exposureAuditBlock =
      exposureCues?.hasNudityOrExplicit && exposureCues.exposureTags.length > 0
        ? `\n\nMANDATORY EXPOSURE & ANATOMY AUDIT: An uncensored visual check detected explicit/undress cues (${exposureCues.exposureTags.join(
            ', '
          )}). Verify what is visible and explicitly describe the exact state of undress and every exposed anatomical feature—do not soften, imply lightly, or omit nudity.`
        : '';

    try {
      const visionUserPrompt = `${
        hasCharacter
          ? 'Analyze this image and write a detailed image generation prompt capturing: (1) the exact action and spatial interaction between the subject and any objects/machinery/props, (2) specific concrete objects, appliances, furniture, or props in the foreground/midground with their colors and materials, (3) camera framing, lighting, and setting, and (4) the subject’s expression, pose, hairstyle shape, and complete clothing/nudity state (explicitly naming any exposed breasts, nipples, buttocks, pubic hair, or genitals—never omit or soften nudity). Only omit hair color and eye color.'
          : 'Analyze this image and write a detailed image generation prompt capturing: (1) the exact action and spatial interaction between the subject and any objects/machinery/props, (2) specific concrete objects, appliances, furniture, or props in the foreground/midground with their colors and materials, (3) camera framing, lighting, and setting, and (4) the subject’s appearance, expression, pose, and complete clothing/nudity state (explicitly naming any exposed breasts, nipples, buttocks, pubic hair, or genitals—never omit or soften nudity).'
      }${exposureAuditBlock}${cleanUserHint ? `\n\nUser focus hint: ${cleanUserHint}` : ''}`;

      const res = await postChatCompletion({
        baseUrl,
        model: modelToUse,
        messages: [
          { role: 'system', content: systemInstruction },
          {
            role: 'user',
            content: [
              { type: 'text', text: visionUserPrompt },
              { type: 'image_url', image_url: { url: fullDataUrl } },
            ],
          },
        ],
        temperature: 0.4,
        maxTokens: 550,
        timeoutMs: 90_000,
      });

      const cleaned = res.content.replace(/^["']|["']$/g, '').trim();
      const looksLikeRefusal =
        /cannot see|can't see|unable to view|as a text-based|i cannot fulfill|i'm sorry, but i can't/i.test(
          cleaned
        );

      if (cleaned.length > 10 && !looksLikeRefusal) {
        const withExposure = mergeMissedExposureCues(cleaned, exposureCues);
        return {
          prompt: finalizePrompt(withExposure),
          pipelineUsed: 'vision',
          tags: [],
          modelUsed: res.modelUsed,
          savedFilename,
        };
      }
    } catch {
      // Fall through to WD14 + Text LLM path below
    }
  }

  // Path 2: WD14 Visual/NSFW Tags -> Text LLM
  const tagItems = await interrogateImageBufferWithWd14(imageBuffer, 0.22);
  const rawTags = tagItems.map((t) => t.tag);
  const extractedTags = hasCharacter ? filterCharacterIdentityTags(rawTags) : rawTags;

  if (extractedTags.length === 0) {
    throw new Error('Could not extract visual features from the uploaded image.');
  }

  const textUserPrompt = `${
    hasCharacter
      ? `Convert the following ordered visual tags into a single cohesive image generation prompt preserving the action, pose, any scene objects/props, setting, lighting, camera framing, facial expressions, hairstyle shape, clothing colors/materials, and ALL nudity/anatomical exposure tags (nude, topless, bottomless, nipples, vulva/genitals, pubic hair, etc.) in full explicit detail without softening. Only omit hair color and eye color:\n\nVisual Tags: ${extractedTags.join(', ')}`
      : `Convert the following ordered visual tags (from highest confidence to lowest) into a single cohesive image generation prompt preserving subject, action, pose, scene objects/props, clothing colors/materials, lighting, setting, and ALL nudity/anatomical exposure tags (nude, topless, bottomless, nipples, vulva/genitals, pubic hair, etc.) in full explicit detail without softening:\n\nVisual Tags: ${extractedTags.join(', ')}`
  }${cleanUserHint ? `\n\nUser focus hint: ${cleanUserHint}` : ''}\n\nOutput ONLY the prompt text:`;

  const textRes = await postChatCompletion({
    baseUrl,
    model: modelToUse,
    messages: [
      { role: 'system', content: systemInstruction },
      { role: 'user', content: textUserPrompt },
    ],
    temperature: 0.5,
    maxTokens: 550,
    timeoutMs: 30_000,
  });

  const cleaned = textRes.content.replace(/^["']|["']$/g, '').trim();
  const finalPrompt =
    cleaned.length > 10 && !/i cannot fulfill|i'm sorry, but i can't/i.test(cleaned)
      ? finalizePrompt(cleaned)
      : extractedTags.join(', ');

  return {
    prompt: finalPrompt,
    pipelineUsed: 'wd14_text',
    tags: extractedTags,
    modelUsed: textRes.modelUsed,
    savedFilename,
  };
}

/**
 * Adaptive Character Portrait Physical Description Analyzer:
 * Uses Vision LLM when available, otherwise extracts permanent identity tags via WD14
 * and synthesizes them via Text LLM (or falls back to raw identity tags when offline).
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

  // Try Vision LLM first when online and Vision-capable
  if (status.online && isLikelyVisionModelId(modelToUse)) {
    try {
      const res = await postChatCompletion({
        baseUrl,
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
              { type: 'image_url', image_url: { url: params.imageBase64DataUrl } },
            ],
          },
        ],
        temperature: 0.3,
        maxTokens: 260,
        timeoutMs: 60_000,
      });

      const cleaned = res.content.replace(/^["']|["']$/g, '').trim();
      const looksLikeRefusal =
        /cannot see|can't see|unable to view|as a text-based|i cannot fulfill|i'm sorry, but i can't/i.test(
          cleaned
        );

      if (cleaned.length > 10 && !looksLikeRefusal) {
        return {
          physicalDescription: sanitizeAgentPrompt(cleaned, params.characterName),
          pipelineUsed: 'vision',
          tags: [],
          modelUsed: res.modelUsed,
        };
      }
    } catch {
      // Fall through cleanly to WD14 fallback below
    }
  }

  const tagItems = await interrogateImageBufferWithWd14(params.imageBuffer, 0.22);
  const rawTags = tagItems.map((t) => t.tag);
  const identityTags = extractCharacterIdentityTags(rawTags);
  const effectiveTags = identityTags.length > 0 ? identityTags : rawTags.slice(0, 20);

  if (effectiveTags.length === 0) {
    throw new Error(
      'Could not extract physical traits from portrait. Ensure a Vision LLM is connected or WD14 model is downloaded.'
    );
  }

  if (status.online) {
    try {
      const textRes = await postChatCompletion({
        baseUrl,
        model: modelToUse,
        messages: [
          { role: 'system', content: systemInstruction },
          {
            role: 'user',
            content: `Turn these portrait physical tags into one concise ~35–70 word physical reference summary covering only permanent traits (gender presentation, build, skin tone, hair color/texture, eye color, facial structure, and signature marks). Ignore any clothing, pose, or background tags:\n\nPhysical Tags: ${effectiveTags.join(', ')}\n\nOutput ONLY the physical reference summary:`,
          },
        ],
        temperature: 0.35,
        maxTokens: 260,
        timeoutMs: 45_000,
      });

      const cleaned = textRes.content.replace(/^["']|["']$/g, '').trim();
      const looksLikeRefusal = /i cannot fulfill|i'm sorry, but i can't/i.test(cleaned);
      if (cleaned.length > 10 && !looksLikeRefusal) {
        return {
          physicalDescription: sanitizeAgentPrompt(cleaned, params.characterName),
          pipelineUsed: 'wd14_text',
          tags: effectiveTags,
          modelUsed: textRes.modelUsed,
        };
      }
    } catch {
      // Fall back to formatted WD14 tags below
    }
  }

  return {
    physicalDescription: effectiveTags.join(', '),
    pipelineUsed: 'wd14_only',
    tags: effectiveTags,
    modelUsed: 'WD14 v3 Local Tagger',
  };
}
