import { db } from '../../db.ts';
import { logger } from '../../logger.ts';
import type {
  GenerationBatchRecord,
  GenerationLoraSelection,
  QuickGenChatMessage,
} from '../../../shared/types.ts';
import { isBatchCancelled } from '../comfyuiLiveMonitor.ts';
import {
  dispatchGenerationBatch,
  dispatchPendingGenerationItem,
  touchBatchPendingItems,
  type PendingBatchSlot,
} from '../generationDispatchService.ts';
import {
  DEFAULT_BATCH_EXPANSION_PROMPT,
  checkLmStudioStatus,
  getLmStudioSettings,
  postChatCompletion,
} from './llmClientService.ts';
import {
  buildLlmCharacterAndLoraContext,
  extractLoraCheckBlock,
  interpolatePromptTemplate,
  sanitizeAgentPrompt,
} from './llmPromptUtils.ts';
import {
  extractBatchConceptAnchors,
  extractPromptFromBatchShotResponse,
  verifyBatchShotQuality,
} from './batchPromptVerification.ts';

export interface GenerateSetPromptsParams {
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
  chatMessages?: Array<{ role: string; content: string }>;
}

export interface ExecuteProgressiveAgentBatchParams {
  workflowId: number;
  characterId?: number | null;
  characterName: string;
  characterDescription?: string;
  characterPhysicalDescription?: string;
  loras: GenerationLoraSelection[];
  checkpointName?: string | null;
  triggerWord?: string;
  negativePrompt?: string;
  aspectRatio: string;
  megapixels?: number;
  steps?: number;
  theme: string;
  count: number;
  seriesId?: number | null;
  branchFromImageId?: number | null;
  inspirationFilename?: string | null;
  chatMessages?: Array<{ role: string; content: string }>;
  chatSnapshot?: QuickGenChatMessage[];
}

export function buildOfflineFallbackShots(params: {
  theme: string;
  basePromptTemplate: string;
  characterName: string;
  count: number;
}): string[] {
  const shotVariations = [
    'medium-wide environmental shot showing full styling and surroundings, dramatic lighting, 35mm lens',
    'medium three-quarter shot, expressive emotion and dynamic pose, rich atmospheric depth, 50mm lens',
    'intimate close-up portrait, sharp catchlights in eyes, shallow depth of field, 85mm lens',
    'low-angle three-quarter composition, dramatic rim lighting, vivid environmental texture',
    'tight medium-close framing, tense posture, moody directional highlights, 85mm lens',
    'candid motion shot, natural movement, layered foreground shadow, editorial color grading',
    'dramatic side-lit composition with crisp contrast, expressive mood, fine detail',
    'medium seated or crouched composition, environmental storytelling props, atmospheric light',
  ];

  const fallbackPrompts: string[] = [];
  for (let i = 0; i < params.count; i++) {
    const variation = shotVariations[i % shotVariations.length];
    const rawPrompt = interpolatePromptTemplate(params.basePromptTemplate, {
      characterName: 'the subject',
      loraSummary: '',
      theme: `${params.theme}, ${variation}`,
    });
    fallbackPrompts.push(sanitizeAgentPrompt(rawPrompt, params.characterName));
  }
  return fallbackPrompts;
}

/**
 * Extracts up to the 3 most recent non-empty user messages from chat history so specific
 * wardrobe, expression, or setting requests are never lost if a concept box summarized them.
 */
function extractRecentUserDirection(
  chatMessages?: Array<{ role: string; content: string }>
): string[] {
  if (!Array.isArray(chatMessages) || chatMessages.length === 0) return [];
  return chatMessages
    .filter((m) => m && m.role === 'user' && typeof m.content === 'string' && m.content.trim())
    .slice(-3)
    .map((m) => m.content.trim());
}

/**
 * Adapts a Batch Expansion preset (which may mention <shot_1>...</shot_{count}> from legacy
 * settings) into clean pacing/framing direction for authoring one shot at a time.
 */
function cleanBatchDirectiveForSingleShot(rawDirective: string): string {
  return rawDirective
    .replace(/^\s*\d+\.\s*Output Format:.*$/gim, '')
    .replace(/<shot(?:_\d+|_\{count\})?>[\s\S]*?<\/shot(?:_\d+|_\{count\})?>/gi, '')
    .trim();
}

function buildShotDirectorSystemPrompt(params: {
  shotNumber: number;
  totalShots: number;
  characterBlock: string | null;
  attachedLoraBlock: string | null;
  hasNonCharacterLoras: boolean;
  requireLoraCheck: boolean;
  lockedLoraCheck: string | null;
  cleanedDirective: string;
  wantsRearView: boolean;
}): string {
  const {
    shotNumber,
    totalShots,
    characterBlock,
    attachedLoraBlock,
    hasNonCharacterLoras,
    requireLoraCheck,
    lockedLoraCheck,
    cleanedDirective,
    wantsRearView,
  } = params;

  const corePrompt = [
    `You are an expert photography director and text-to-image prompt writer authoring Shot ${shotNumber} of ${totalShots} in a cohesive photo set.`,
    '',
    '## Shot Prompt Rules',
    '1. Length & Structure (~80–140 words; zero poetic filler): Write ONE dense, self-contained paragraph inside <proposed_prompt>...</proposed_prompt> following this exact 5-part order:',
    '   1) Medium & Camera Framing/Angle: photographic or artistic medium, lens look, shot distance, and viewing angle.',
    '   2) Subject Action, Posture & Contact Points: observable body orientation, limb placement, facial expression, and physical contact with surfaces.',
    '   3) Wardrobe, Styling, Hairstyle & Makeup: exact garments, fabrics, colors, state of undress/partial nudity, footwear, accessories, hairstyle, and makeup.',
    '   4) Environment & Fixed Spatial Props: specific room or outdoor surfaces plus 3–5 fixed props with their spatial positions.',
    '   5) Lighting, Color Palette & Atmosphere: primary light sources, direction, color temperature, and palette.',
    '2. Mandatory Anchor Fidelity & Anti-Sanitization:',
    '   - Every shot MUST explicitly depict ALL user-requested wardrobe or state of undress (e.g. topless, bare chest, specific underwear/lingerie, or exact outfits), facial expression/emotion, and genre/setting atmosphere—never soften, sanitize, generalize, or omit them.',
    wantsRearView
      ? '   - Honor the requested rear/behind framing while still keeping requested styling and setting explicit.'
      : '   - Never turn the subject away with her back to the camera or push her into a tiny far-off silhouette if doing so hides requested facial expression or wardrobe/undress. Even in wide establishing shots, keep the subject close enough and angled so her emotion, state of undress/wardrobe, and surroundings are clearly visible.',
    '3. Identity & Naming Safety:',
    '   - Never include character names or model/LoRA filenames (such as .safetensors) inside <proposed_prompt>.',
    '   - When a Character Profile is attached, match gender/pronouns and key traits (hair color, skin tone, build, signature marks) naturally without copying facial geometry verbatim.',
    '4. Krea 2 Visual Translation: Express every action, pose, and emotion through concrete spatial relationships, posture, contact points, and readable camera placement.',
    '5. No Cross-References: Never write meta text such as "same outfit as shot 1" or "Shot 2:"; describe every visual element fresh inside the prompt.',
  ].join('\n');

  const loraRule = requireLoraCheck
    ? [
        'ATTACHED LORA SELF-CHECK:',
        '- Before <proposed_prompt>, emit <lora_check>...</lora_check> listing the concrete visual elements (setting, architecture, wardrobe, props, lighting, or photographic texture) from the Attached non-character LoRA(s) that MUST appear in every shot.',
        '- Explicitly weave those visual elements into <proposed_prompt> without displacing the user’s requested wardrobe, emotion, or setting.',
      ].join('\n')
    : hasNonCharacterLoras
      ? [
          'ATTACHED LORA CONTINUITY:',
          '- Explicitly reflect the Attached non-character LoRA visual elements inside <proposed_prompt>.',
          lockedLoraCheck
            ? `- Required LoRA Cues: ${lockedLoraCheck.replace(/\s+/g, ' ').trim()}`
            : null,
        ]
          .filter(Boolean)
          .join('\n')
      : null;

  const directiveBlock = cleanedDirective
    ? `SET PACING & FRAMING DIRECTION (apply specifically to Shot ${shotNumber} of ${totalShots}):\n${cleanedDirective}`
    : null;

  return [corePrompt, characterBlock, attachedLoraBlock, loraRule, directiveBlock]
    .filter(Boolean)
    .join('\n\n');
}

/**
 * Authors ONE standalone high-detail shot prompt (`shotNumber` of `totalShots`) via Local LLM,
 * verifying word density, user wardrobe/mood anchors, and attached LoRA cues with 1 targeted retry.
 */
export async function composeBatchShotPrompt(params: {
  shotNumber: number;
  totalShots: number;
  theme: string;
  recentUserMessages: string[];
  resolvedBaseStyle: string;
  characterName: string;
  characterBlock: string | null;
  attachedLoraBlock: string | null;
  nonCharacterLoraBlock: string | null;
  hasNonCharacterLoras: boolean;
  cleanedDirective: string;
  previousPrompts: string[];
  lockedLoraCheck: string | null;
  baseUrl: string;
  modelToUse: string;
  fallbackPrompt: string;
}): Promise<{ prompt: string; loraCheck: string | null }> {
  const {
    shotNumber,
    totalShots,
    theme,
    recentUserMessages,
    resolvedBaseStyle,
    characterName,
    characterBlock,
    attachedLoraBlock,
    nonCharacterLoraBlock,
    hasNonCharacterLoras,
    cleanedDirective,
    previousPrompts,
    lockedLoraCheck,
    baseUrl,
    modelToUse,
    fallbackPrompt,
  } = params;

  const requireLoraCheck = hasNonCharacterLoras && shotNumber === 1 && !lockedLoraCheck;
  const anchors = extractBatchConceptAnchors(theme, recentUserMessages);

  const systemPrompt = buildShotDirectorSystemPrompt({
    shotNumber,
    totalShots,
    characterBlock,
    attachedLoraBlock,
    hasNonCharacterLoras,
    requireLoraCheck,
    lockedLoraCheck,
    cleanedDirective,
    wantsRearView: anchors.wantsRearView,
  });

  const userLines: string[] = [
    `Write ONLY Shot ${shotNumber} of ${totalShots} as one dense, standalone ~80–140 word image prompt.`,
    '',
    'Set Concept / Theme:',
    theme.trim(),
  ];

  const distinctUserTurns = recentUserMessages.filter(
    (msg) => msg.trim().toLowerCase() !== theme.trim().toLowerCase()
  );
  if (distinctUserTurns.length > 0) {
    userLines.push(
      '',
      'Original User Direction (preserve every specific wardrobe item, state of undress, facial emotion, and setting mood verbatim unless superseded):',
      ...distinctUserTurns.map((m) => `- ${m}`)
    );
  }

  if (anchors.matchedRules.length > 0) {
    userLines.push(
      '',
      `Mandatory Visible Elements Required in Shot ${shotNumber}: ${anchors.matchedRules.map((r) => r.label).join('; ')}.`
    );
  }

  if (resolvedBaseStyle && resolvedBaseStyle.trim() !== theme.trim()) {
    userLines.push('', 'Visual Style Foundation:', resolvedBaseStyle.trim());
  }

  if (hasNonCharacterLoras && nonCharacterLoraBlock) {
    userLines.push('', nonCharacterLoraBlock);
  }

  if (previousPrompts.length > 0) {
    userLines.push(
      '',
      `Already Written Shots in This Set (choose a distinctly different camera framing, viewing angle, pose, and action for Shot ${shotNumber} while keeping mandatory wardrobe/mood anchors intact):`,
      ...previousPrompts.map((p, idx) => `Shot ${idx + 1}: ${p}`)
    );
  }

  const formatHint = requireLoraCheck
    ? 'Return ONLY <lora_check>...</lora_check> followed by <proposed_prompt>...</proposed_prompt> with no extra commentary.'
    : 'Return ONLY <proposed_prompt>...</proposed_prompt> with no extra commentary or <shot_N> tags.';
  userLines.push('', formatHint);

  const userPrompt = userLines.join('\n');

  try {
    const res = await postChatCompletion({
      baseUrl,
      model: modelToUse,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      temperature: 0.74,
      maxTokens: 1150,
      timeoutMs: 45_000,
    });

    let latestRaw = res.content;
    let loraCheck = extractLoraCheckBlock(latestRaw) || lockedLoraCheck;
    let shotPrompt = extractPromptFromBatchShotResponse(latestRaw, characterName);

    // Format recovery retry if no prompt was extracted
    if (shotPrompt.length < 15) {
      const formatRetry = await postChatCompletion({
        baseUrl,
        model: modelToUse,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
          { role: 'assistant', content: latestRaw },
          {
            role: 'user',
            content: `Format Error: Write ONE ~80–140 word standalone image prompt for Shot ${shotNumber} wrapped inside <proposed_prompt>...</proposed_prompt>.`,
          },
        ],
        temperature: 0.68,
        maxTokens: 1000,
        timeoutMs: 30_000,
      });
      const retryPrompt = extractPromptFromBatchShotResponse(formatRetry.content, characterName);
      if (retryPrompt.length >= 15) {
        latestRaw = formatRetry.content;
        shotPrompt = retryPrompt;
        loraCheck = extractLoraCheckBlock(formatRetry.content) || loraCheck;
      }
    }

    if (shotPrompt.length >= 15) {
      const quality = verifyBatchShotQuality({
        shotPrompt,
        theme,
        recentUserMessages,
        loraCheck,
        nonCharacterLoraBlock,
      });

      if (!quality.passed) {
        logger.info(
          'LocalLLM',
          `Batch Shot ${shotNumber}/${totalShots} quality check failed (${quality.reasons.join(' | ')}) — retrying once`
        );
        const retryRes = await postChatCompletion({
          baseUrl,
          model: modelToUse,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt },
            { role: 'assistant', content: latestRaw },
            {
              role: 'user',
              content: [
                `Self-Check Failed for Shot ${shotNumber}:`,
                ...quality.reasons.map((r) => `- ${r}`),
                `Rewrite Shot ${shotNumber} inside <proposed_prompt>...</proposed_prompt> as a dense ~80–140 word 5-part paragraph that fixes every item above.`,
              ].join('\n'),
            },
          ],
          temperature: 0.66,
          maxTokens: 1150,
          timeoutMs: 35_000,
        });

        const improved = extractPromptFromBatchShotResponse(retryRes.content, characterName);
        if (improved.length >= 15) {
          const improvedQuality = verifyBatchShotQuality({
            shotPrompt: improved,
            theme,
            recentUserMessages,
            loraCheck,
            nonCharacterLoraBlock,
          });
          if (improvedQuality.passed || improvedQuality.wordCount > quality.wordCount) {
            shotPrompt = improved;
            loraCheck = extractLoraCheckBlock(retryRes.content) || loraCheck;
          }
        }
      }

      return { prompt: shotPrompt, loraCheck };
    }
  } catch (err: any) {
    logger.warn(
      'LocalLLM',
      `Batch Shot ${shotNumber}/${totalShots} LLM call failed, using fallback`,
      err?.message || err
    );
  }

  return { prompt: fallbackPrompt, loraCheck: lockedLoraCheck };
}

function prepareBatchContext(params: {
  characterName: string;
  characterDescription?: string;
  characterPhysicalDescription?: string;
  loraNames: string[];
  theme: string;
  count: number;
  basePromptTemplate: string;
  expansionDirective?: string;
  chatMessages?: Array<{ role: string; content: string }>;
}) {
  const settings = getLmStudioSettings();
  const count = Math.max(1, Math.min(20, Number(params.count) || 4));
  const resolvedBaseStyle =
    params.basePromptTemplate && params.basePromptTemplate.trim() !== '{theme}'
      ? interpolatePromptTemplate(params.basePromptTemplate, {
          characterName: 'the subject',
          loraSummary: '',
          theme: params.theme,
          count,
        })
      : '';

  const { characterBlock, attachedLoraBlock, nonCharacterLoraBlock, hasNonCharacterLoras } =
    buildLlmCharacterAndLoraContext({
      characterName: params.characterName,
      characterDescription: params.characterDescription,
      characterPhysicalDescription: params.characterPhysicalDescription,
      loraNames: params.loraNames,
    });

  const expansionDirectiveRaw =
    params.expansionDirective?.trim() ||
    settings.batchExpansionPrompt ||
    DEFAULT_BATCH_EXPANSION_PROMPT;

  const interpolatedDirective = interpolatePromptTemplate(expansionDirectiveRaw, {
    characterName: 'the subject',
    loraSummary: '',
    theme: params.theme,
    count,
    basePrompt: resolvedBaseStyle || params.theme,
  });

  const cleanedDirective = cleanBatchDirectiveForSingleShot(interpolatedDirective);
  const recentUserMessages = extractRecentUserDirection(params.chatMessages);
  const fallbackShots = buildOfflineFallbackShots({
    theme: params.theme,
    basePromptTemplate: params.basePromptTemplate,
    characterName: params.characterName,
    count,
  });

  return {
    settings,
    count,
    resolvedBaseStyle,
    characterBlock,
    attachedLoraBlock,
    nonCharacterLoraBlock,
    hasNonCharacterLoras,
    cleanedDirective,
    recentUserMessages,
    fallbackShots,
  };
}

/**
 * Expands a Set Concept / Photo Set Theme into N cohesive, full-detail standalone prompts
 * by authoring each shot sequentially with per-shot anchor & density verification.
 */
export async function generatePhotoSetPromptsWithAgent(params: GenerateSetPromptsParams): Promise<{
  prompts: string[];
  usedLmStudio: boolean;
  modelUsed: string;
  guidingTemplateName: string;
  sentSystemPrompt: string;
  sentUserPrompt: string;
  warning?: string;
}> {
  const ctx = prepareBatchContext(params);
  const baseUrl = (params.baseUrlOverride || ctx.settings.baseUrl).replace(/\/+$/, '');
  const status = await checkLmStudioStatus(params.baseUrlOverride ? baseUrl : undefined);

  const previewSystemPrompt = buildShotDirectorSystemPrompt({
    shotNumber: 1,
    totalShots: ctx.count,
    characterBlock: ctx.characterBlock,
    attachedLoraBlock: ctx.attachedLoraBlock,
    hasNonCharacterLoras: ctx.hasNonCharacterLoras,
    requireLoraCheck: ctx.hasNonCharacterLoras,
    lockedLoraCheck: null,
    cleanedDirective: ctx.cleanedDirective,
    wantsRearView: extractBatchConceptAnchors(params.theme, ctx.recentUserMessages).wantsRearView,
  });

  if (!status.online) {
    return {
      prompts: ctx.fallbackShots,
      usedLmStudio: false,
      modelUsed: 'Built-in Photo Set Director (Local LLM Offline)',
      guidingTemplateName: 'Per-Shot Batch Director',
      sentSystemPrompt: previewSystemPrompt,
      sentUserPrompt: params.theme.trim(),
      warning: `Local LLM unreachable (${status.error || 'offline'}). Generated set variations using Couchy's built-in shot director so you can still preview or edit your set.`,
    };
  }

  const modelToUse =
    params.modelOverride || status.selectedModel || ctx.settings.selectedModel || 'local-model';
  const prompts: string[] = [];
  let lockedLoraCheck: string | null = null;
  let anyLlmSucceeded = false;

  for (let i = 0; i < ctx.count; i++) {
    const shotResult = await composeBatchShotPrompt({
      shotNumber: i + 1,
      totalShots: ctx.count,
      theme: params.theme,
      recentUserMessages: ctx.recentUserMessages,
      resolvedBaseStyle: ctx.resolvedBaseStyle,
      characterName: params.characterName,
      characterBlock: ctx.characterBlock,
      attachedLoraBlock: ctx.attachedLoraBlock,
      nonCharacterLoraBlock: ctx.nonCharacterLoraBlock,
      hasNonCharacterLoras: ctx.hasNonCharacterLoras,
      cleanedDirective: ctx.cleanedDirective,
      previousPrompts: prompts,
      lockedLoraCheck,
      baseUrl,
      modelToUse,
      fallbackPrompt: ctx.fallbackShots[i],
    });
    if (shotResult.prompt !== ctx.fallbackShots[i]) {
      anyLlmSucceeded = true;
    }
    if (shotResult.loraCheck && !lockedLoraCheck) {
      lockedLoraCheck = shotResult.loraCheck;
    }
    prompts.push(shotResult.prompt);
  }

  return {
    prompts,
    usedLmStudio: anyLlmSucceeded,
    modelUsed: anyLlmSucceeded ? modelToUse : 'Built-in Photo Set Director (Local LLM Offline)',
    guidingTemplateName: 'Per-Shot Batch Director',
    sentSystemPrompt: previewSystemPrompt,
    sentUserPrompt: params.theme.trim(),
    ...(anyLlmSucceeded
      ? {}
      : {
          warning:
            'Local LLM did not return valid shot prompts; populated fallback shot variations.',
        }),
  };
}

async function runProgressiveAgentBatchShots(params: {
  batchId: number;
  pendingSlots: PendingBatchSlot[];
  totalCount: number;
  initialPrompt: string;
  initialLoraCheck: string | null;
  useLlm: boolean;
  baseUrl: string;
  modelToUse: string;
  batchParams: ExecuteProgressiveAgentBatchParams;
  ctx: ReturnType<typeof prepareBatchContext>;
}): Promise<void> {
  const {
    batchId,
    pendingSlots,
    totalCount,
    initialPrompt,
    initialLoraCheck,
    useLlm,
    baseUrl,
    modelToUse,
    batchParams,
    ctx,
  } = params;

  // Yield so the Shot 1 HTTP response returns before background Shots 2..N begin
  await new Promise<void>((resolve) => setTimeout(resolve, 0));

  const previousPrompts = [initialPrompt];
  let lockedLoraCheck = initialLoraCheck;

  for (const slot of pendingSlots) {
    if (!db.open || isBatchCancelled(batchId)) {
      break;
    }

    try {
      touchBatchPendingItems(batchId);

      let nextPrompt = ctx.fallbackShots[slot.itemIndex - 1] || ctx.fallbackShots[0];
      if (useLlm) {
        const composed = await composeBatchShotPrompt({
          shotNumber: slot.itemIndex,
          totalShots: totalCount,
          theme: batchParams.theme,
          recentUserMessages: ctx.recentUserMessages,
          resolvedBaseStyle: ctx.resolvedBaseStyle,
          characterName: batchParams.characterName,
          characterBlock: ctx.characterBlock,
          attachedLoraBlock: ctx.attachedLoraBlock,
          nonCharacterLoraBlock: ctx.nonCharacterLoraBlock,
          hasNonCharacterLoras: ctx.hasNonCharacterLoras,
          cleanedDirective: ctx.cleanedDirective,
          previousPrompts,
          lockedLoraCheck,
          baseUrl,
          modelToUse,
          fallbackPrompt: nextPrompt,
        });
        nextPrompt = composed.prompt;
        if (composed.loraCheck && !lockedLoraCheck) {
          lockedLoraCheck = composed.loraCheck;
        }
      }

      if (!db.open || isBatchCancelled(batchId)) {
        break;
      }

      previousPrompts.push(nextPrompt);
      const { cancelled } = await dispatchPendingGenerationItem({
        batchId,
        itemId: slot.itemId,
        prompt: nextPrompt,
        seed: slot.seed,
        workflowId: batchParams.workflowId,
        aspectRatio: batchParams.aspectRatio,
        megapixels: batchParams.megapixels,
        steps: batchParams.steps,
        loras: batchParams.loras,
        checkpointName: batchParams.checkpointName,
        triggerWord: batchParams.triggerWord,
        negativePrompt: batchParams.negativePrompt ?? '',
        characterId: batchParams.characterId ?? null,
      });

      if (cancelled) break;
    } catch (err: any) {
      logger.error(
        'ComfyUI',
        `Progressive Agent Batch #${batchId} shot #${slot.itemIndex} failed`,
        err?.message || err
      );
      if (db.open) {
        db.prepare(
          `UPDATE generation_items
           SET status = 'failed', error_message = ?, completed_at = datetime('now')
           WHERE id = ? AND status = 'pending'`
        ).run(err?.message || 'Failed during progressive batch shot generation', slot.itemId);
      }
    }
  }
}

/**
 * Authors Shot 1 via Local LLM and dispatches immediately to ComfyUI (creating the Ghost card
 * and `multi_shot` series at once), then progressively authors and queues Shots 2..N in the background.
 */
export async function executeProgressiveAgentBatch(
  params: ExecuteProgressiveAgentBatchParams
): Promise<{
  batch: GenerationBatchRecord;
  batches: GenerationBatchRecord[];
  totalCount: number;
  usedLmStudio: boolean;
  progressiveTask?: Promise<void>;
}> {
  const totalCount = Math.max(1, Math.min(20, Number(params.count) || 1));
  const loraNames = (params.loras || []).map((l) => l.loraName);
  const ctx = prepareBatchContext({
    characterName: params.characterName,
    characterDescription: params.characterDescription,
    characterPhysicalDescription: params.characterPhysicalDescription,
    loraNames,
    theme: params.theme,
    count: totalCount,
    basePromptTemplate: '{theme}',
    chatMessages: params.chatMessages,
  });

  const baseUrl = ctx.settings.baseUrl.replace(/\/+$/, '');
  const status = await checkLmStudioStatus();
  const useLlm = Boolean(status.online);
  const modelToUse = status.selectedModel || ctx.settings.selectedModel || 'local-model';

  let shot1Prompt = ctx.fallbackShots[0];
  let lockedLoraCheck: string | null = null;
  let usedLmStudio = false;

  if (useLlm) {
    const shot1 = await composeBatchShotPrompt({
      shotNumber: 1,
      totalShots: totalCount,
      theme: params.theme,
      recentUserMessages: ctx.recentUserMessages,
      resolvedBaseStyle: ctx.resolvedBaseStyle,
      characterName: params.characterName,
      characterBlock: ctx.characterBlock,
      attachedLoraBlock: ctx.attachedLoraBlock,
      nonCharacterLoraBlock: ctx.nonCharacterLoraBlock,
      hasNonCharacterLoras: ctx.hasNonCharacterLoras,
      cleanedDirective: ctx.cleanedDirective,
      previousPrompts: [],
      lockedLoraCheck: null,
      baseUrl,
      modelToUse,
      fallbackPrompt: ctx.fallbackShots[0],
    });
    shot1Prompt = shot1.prompt;
    lockedLoraCheck = shot1.loraCheck;
    usedLmStudio = shot1.prompt !== ctx.fallbackShots[0];
  }

  const { batch, batches, pendingSlots } = await dispatchGenerationBatch({
    characterId: params.characterId ?? null,
    workflowId: params.workflowId,
    mode: totalCount > 1 ? 'theme_set' : 'single',
    themeTitle: params.theme.trim().slice(0, 80),
    aspectRatio: params.aspectRatio,
    megapixels: params.megapixels,
    steps: params.steps,
    prompts: [shot1Prompt],
    totalPlannedCount: totalCount,
    triggerWord: params.triggerWord,
    negativePrompt: params.negativePrompt ?? '',
    loras: params.loras,
    checkpointName: params.checkpointName ?? undefined,
    seriesId: totalCount > 1 ? null : params.seriesId ?? null,
    branchFromImageId: totalCount > 1 ? null : params.branchFromImageId ?? null,
    inspirationFilename: params.inspirationFilename ?? null,
    chatSnapshot: params.chatSnapshot,
  });

  const progressiveTask =
    totalCount > 1 && pendingSlots && pendingSlots.length > 0
      ? runProgressiveAgentBatchShots({
          batchId: batch.id,
          pendingSlots,
          totalCount,
          initialPrompt: shot1Prompt,
          initialLoraCheck: lockedLoraCheck,
          useLlm,
          baseUrl,
          modelToUse,
          batchParams: params,
          ctx,
        })
      : undefined;

  return progressiveTask
    ? { batch, batches, totalCount, usedLmStudio, progressiveTask }
    : { batch, batches, totalCount, usedLmStudio };
}
