import {
  checkLmStudioStatus,
  getLmStudioSettings,
  postChatCompletion,
} from './llm/llmClientService.ts';
import {
  buildLlmCharacterAndLoraContext,
  extractLoraCheckBlock,
  normalizeLoraMatchKey,
  sanitizeAgentPrompt,
  verifyPromptReflectsLoraCheck,
} from './llm/llmPromptUtils.ts';

export interface BaseModelCandidate {
  filename: string;
  name: string;
  nickname: string | null;
  base_model: string | null;
  llm_description: string;
  usage_count: number;
  fav_count: number;
}

export function getBaseModelHandle(candidate: BaseModelCandidate): string {
  return (
    (candidate.nickname || '').trim().replace(/^@+/, '') ||
    candidate.name.trim() ||
    candidate.filename.replace(/\.(?:safetensors|ckpt|pt|bin|gguf|sft)$/i, '').trim()
  );
}

/**
 * Generates an offline fallback prompt with deterministic framing/lighting variation
 * across shot indices so multi-image rolls still produce distinct shots when LLM is offline.
 */
export function buildOfflineRandomPrompt(
  characterName: string,
  tags: string[],
  shotIndex = 0
): string {
  const framings = [
    'medium three-quarter portrait, candid natural posture, 85mm lens, shallow depth of field',
    'intimate close-up portrait, sharp catchlights in eyes, soft rim light, film grain',
    'editorial full-body shot, atmospheric depth, architectural perspective, 35mm lens',
    'over-the-shoulder candid composition, golden natural illumination, rich ambient detail',
    'low-angle heroic framing, confident posture, expressive environmental depth, 50mm lens',
    'seated relaxed composition, natural gesture, layered foreground bokeh',
    'candid motion capture, dynamic stride, subtle environmental movement',
    'profile silhouette against atmospheric backdrop, fine edge lighting, cinematic framing',
  ];
  const lightings = [
    'soft golden hour sunlight, warm shadows',
    'moody overcast daylight, crisp editorial contrast',
    'warm indoor practical lighting, subtle ambient glow',
    'dramatic side window light, natural skin texture',
    'cool twilight ambient fill with warm highlights',
  ];
  const idx = Math.max(0, Math.floor(shotIndex));
  const framing = framings[idx % framings.length];
  const lighting = lightings[idx % lightings.length];
  const sceneCue = tags.length > 0 ? tags.join(', ') : 'relaxed outdoor lifestyle scene';
  return sanitizeAgentPrompt(
    `the subject in a spontaneous scene featuring ${sceneCue}, ${framing}, ${lighting}`,
    characterName
  );
}

export function resolveSelectedBaseCandidate(
  llmContent: string,
  candidates: BaseModelCandidate[]
): BaseModelCandidate | null {
  const match = llmContent.match(
    /<selected_base>([\s\S]*?)(?:<\/selected_base>|(?=<proposed_prompt>)|\r?\n|$)/i
  );
  if (!match || !match[1]) return null;
  const rawToken = match[1].replace(/^["'\s]+|["'\s]+$/g, '');
  const targetKey = normalizeLoraMatchKey(rawToken);
  if (!targetKey) return null;

  return (
    candidates.find((c) => {
      const handleKey = normalizeLoraMatchKey(getBaseModelHandle(c));
      const nameKey = normalizeLoraMatchKey(c.name);
      const fileKey = normalizeLoraMatchKey(c.filename);
      const nickKey = c.nickname ? normalizeLoraMatchKey(c.nickname) : '';
      return (
        handleKey === targetKey ||
        nameKey === targetKey ||
        fileKey === targetKey ||
        (Boolean(nickKey) && nickKey === targetKey)
      );
    }) || null
  );
}

export const extractLoraCheckFromRandomRollResponse = extractLoraCheckBlock;
export { verifyPromptReflectsLoraCheck };

export function extractPromptFromRandomRollResponse(
  llmContent: string,
  characterName: string
): string {
  // Prefer explicit <proposed_prompt> content so <lora_check>/<selected_base> never leak through
  const match = llmContent.match(/<proposed_prompt>([\s\S]*?)(?:<\/proposed_prompt>|$)/i);
  if (match && match[1]) {
    const insideTag = match[1]
      .replace(/<\/?(?:lora_check|selected_base|proposed_concept|proposed_prompt)>/gi, '')
      .replace(/^["']|["']$/g, '')
      .trim();
    return sanitizeAgentPrompt(insideTag, characterName);
  }

  // If scratchpad/concept tags were emitted without <proposed_prompt>, never return raw scratchpad text
  if (/<(?:lora_check|selected_base|proposed_concept|shot_\d+)\b/i.test(llmContent)) {
    return '';
  }

  const raw = llmContent.replace(/^["']|["']$/g, '').trim();
  return sanitizeAgentPrompt(raw, characterName);
}

function getCheckpointCooldownTier(filename: string, recentCheckpointKeys: string[]): 0 | 1 | 2 {
  const key = normalizeLoraMatchKey(filename);
  if (!key) return 0;
  if (recentCheckpointKeys[0] === key) return 1;
  if (recentCheckpointKeys[1] === key) return 2;
  return 0;
}

function buildBaseContext(
  candidates: BaseModelCandidate[],
  recentCheckpointKeys: string[],
  lockedCheckpoint?: string | null
): {
  block: string | null;
  shouldSelectBase: boolean;
  lockedCandidate: BaseModelCandidate | null;
} {
  if (lockedCheckpoint) {
    const lockedKey = normalizeLoraMatchKey(lockedCheckpoint);
    const matched = candidates.find((c) => normalizeLoraMatchKey(c.filename) === lockedKey) || null;
    if (matched) {
      const desc = matched.llm_description.replace(/\s+/g, ' ').trim().slice(0, 320);
      return {
        block: `Active Base Model (${getBaseModelHandle(matched)}): ${desc}\n- Write the visual medium, lighting, and detail level to play to this base model's strengths.`,
        shouldSelectBase: false,
        lockedCandidate: matched,
      };
    }
    return { block: null, shouldSelectBase: false, lockedCandidate: null };
  }

  if (candidates.length === 0) {
    return { block: null, shouldSelectBase: false, lockedCandidate: null };
  }

  if (candidates.length === 1) {
    const only = candidates[0];
    const desc = only.llm_description.replace(/\s+/g, ' ').trim().slice(0, 320);
    return {
      block: `Active Base Model (${getBaseModelHandle(only)}): ${desc}\n- Write the visual medium, lighting, and detail level to play to this base model's strengths.`,
      shouldSelectBase: false,
      lockedCandidate: only,
    };
  }

  // Shuffle order on each roll so position #1 doesn't bias the LLM
  const shuffled = [...candidates];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }

  const lines = shuffled.map((c) => {
    const handle = getBaseModelHandle(c);
    const desc = c.llm_description.replace(/\s+/g, ' ').trim().slice(0, 300);
    const tier = getCheckpointCooldownTier(c.filename, recentCheckpointKeys);
    const cooldownNote =
      tier === 1
        ? ' [used last roll — pick only if clearly the best fit, otherwise prefer another fitting option for variety]'
        : '';
    return `- @${handle}: ${desc}${cooldownNote}`;
  });

  return {
    block: [
      'Available Base Models (choose ONE via <selected_base>"@handle"</selected_base> whose Model Details & Strengths best suit this Character, Attached LoRAs, and scene):',
      ...lines,
    ].join('\n'),
    shouldSelectBase: true,
    lockedCandidate: null,
  };
}

/**
 * Composes one Random Roll shot prompt via the Local LLM (selecting base model on Shot 1 when needed,
 * or locking onto Shot 1's checkpoint and avoiding prior shot repetition for Shots 2..N).
 */
export async function composeRandomRollPrompt(params: {
  characterName: string;
  characterDescription: string;
  characterPhysicalDescription: string;
  loraNames: string[];
  hasStyleLoras: boolean;
  tags: string[];
  baseCandidates: BaseModelCandidate[];
  fallbackCheckpoint: string | null;
  recentCheckpointKeys?: string[];
  shotNumber?: number;
  totalShots?: number;
  previousPrompts?: string[];
  lockedCheckpoint?: string | null;
  lockedLoraCheck?: string | null;
}): Promise<{
  prompt: string;
  checkpointName: string | null;
  usedLmStudio: boolean;
  loraCheck?: string | null;
}> {
  const shotNumber = Math.max(1, params.shotNumber || 1);
  const totalShots = Math.max(1, params.totalShots || 1);
  const resolvedFallbackCkpt = params.lockedCheckpoint || params.fallbackCheckpoint;
  const requireLoraCheck = params.hasStyleLoras && shotNumber === 1;

  try {
    const status = await checkLmStudioStatus();
    if (!status.online) {
      return {
        prompt: buildOfflineRandomPrompt(params.characterName, params.tags, shotNumber - 1),
        checkpointName: resolvedFallbackCkpt,
        usedLmStudio: false,
        loraCheck: params.lockedLoraCheck || null,
      };
    }

    const settings = getLmStudioSettings();
    const baseUrl = settings.baseUrl.replace(/\/+$/, '');
    const modelToUse = status.selectedModel || settings.selectedModel || 'local-model';

    const { characterBlock, attachedLoraBlock } = buildLlmCharacterAndLoraContext({
      characterName: params.characterName,
      characterDescription: params.characterDescription,
      characterPhysicalDescription: params.characterPhysicalDescription,
      loraNames: params.loraNames,
    });

    const {
      block: baseModelBlock,
      shouldSelectBase,
      lockedCandidate,
    } = buildBaseContext(
      params.baseCandidates,
      params.recentCheckpointKeys || [],
      params.lockedCheckpoint
    );

    const tagHint =
      params.tags.length > 0
        ? `Secondary optional motifs (keep ONLY motifs that harmonize with the Attached LoRAs, and explicitly drop any setting/outfit motif that conflicts): ${params.tags.join(', ')}.`
        : 'Invent a vivid, grounded setting, natural wardrobe, and expressive lighting.';

    const loraDirective = requireLoraCheck
      ? [
          '- Mandatory Step 1 (<lora_check>): Before choosing a base model or writing the prompt, output <lora_check>...</lora_check> with:',
          '  1. For each non-character Attached LoRA, state the concrete visual elements (specific setting, architecture, uniform/wardrobe, props, pose, or lighting) that MUST appear in <proposed_prompt> to showcase that LoRA.',
          '  2. Tag Filter: List which optional random motifs to KEEP and which to DROP because they clash with the Attached LoRA concept/wardrobe.',
          '- Play to Attached LoRAs: Attached non-character LoRA(s) are the primary driver of the scene. Every concrete visual element you listed in <lora_check> MUST be explicitly described inside <proposed_prompt>.',
        ].join('\n')
      : params.hasStyleLoras
        ? [
            '- Play to Attached LoRAs: Attached non-character LoRA(s) are the primary driver of this shot and MUST be explicitly depicted inside <proposed_prompt>.',
            params.lockedLoraCheck
              ? `- Required LoRA Visual Cues (already verified): ${params.lockedLoraCheck.replace(/\s+/g, ' ').trim()}`
              : null,
          ]
            .filter(Boolean)
            .join('\n')
        : '- Focus on a fresh, coherent scene that complements the subject naturally.';

    const baseDirective = shouldSelectBase
      ? '- Base Model Choice: Output <selected_base>"@handle"</selected_base> using one exact @handle from Available Base Models that best matches the character, attached LoRAs, and intended scene mood, then tailor <proposed_prompt> to that chosen base model’s strengths. Never write base model names or @handles inside <proposed_prompt>.'
      : baseModelBlock
        ? '- Play to Active Base Model: Tailor lighting, photographic texture, and detail cues to complement the Active Base Model description without naming it in <proposed_prompt>.'
        : null;

    const multiShotDirective =
      totalShots > 1
        ? [
            `- Multi-Shot Single-Frame Rule (Shot ${shotNumber} of ${totalShots}): Even though this is part of a ${totalShots}-shot set, ignore any Batch Concept or <proposed_concept> mode—write ONLY ONE standalone prompt for Shot ${shotNumber} inside <proposed_prompt>...</proposed_prompt>.`,
            '- Set Variety: Keep the same overall world/concept and LoRA style, but choose a distinctly different camera framing, pose, gesture, lighting angle, or action from prior shots.',
          ].join('\n')
        : null;

    const randomRollRules = [
      'RANDOM ROLL RULES:',
      '- Output ONE original, ready-to-generate prompt wrapped inside <proposed_prompt>...</proposed_prompt>. Never include character names, base model names, or model/LoRA filenames inside <proposed_prompt>.',
      '- Strict Identity Fidelity: Follow the Character Profile strictly for sex/gender pronouns and permanent physical traits. NEVER invent, guess, or insert a race, ethnicity, nationality, skin tone, hair color, eye color, or biological sex not explicitly supported by the Character Profile; leave unspecified identity traits unstated so the active character LoRA supplies them.',
      loraDirective,
      baseDirective,
      multiShotDirective,
    ]
      .filter(Boolean)
      .join('\n');

    const systemPrompt = [
      settings.conversationSystemPrompt,
      characterBlock,
      attachedLoraBlock,
      baseModelBlock,
      randomRollRules,
    ]
      .filter(Boolean)
      .join('\n\n');

    const responseFormatHint = requireLoraCheck
      ? shouldSelectBase
        ? 'Return ONLY <lora_check>...</lora_check>, <selected_base>"@handle"</selected_base>, and <proposed_prompt>...</proposed_prompt>.'
        : 'Return ONLY <lora_check>...</lora_check> and <proposed_prompt>...</proposed_prompt>.'
      : shouldSelectBase
        ? 'Return ONLY <selected_base>"@handle"</selected_base> and <proposed_prompt>...</proposed_prompt>.'
        : 'Return ONLY <proposed_prompt>...</proposed_prompt>. Do NOT output <lora_check>, <proposed_concept>, or a multi-shot summary.';

    const priorBlock =
      params.previousPrompts && params.previousPrompts.length > 0
        ? [
            `Already written shots in this ${totalShots}-shot set (DO NOT repeat these framings, poses, or actions):`,
            ...params.previousPrompts.map((p, i) => `Shot ${i + 1}: ${p}`),
          ].join('\n')
        : null;

    const leadLine =
      totalShots > 1
        ? params.hasStyleLoras
          ? `Write ONLY Shot ${shotNumber} of ${totalShots} as one standalone image prompt built directly around the attached non-character LoRA(s).`
          : `Write ONLY Shot ${shotNumber} of ${totalShots} as one standalone image prompt with fresh framing and action.`
        : params.hasStyleLoras
          ? 'Create a single fresh, spontaneous scene prompt for the subject built directly around the attached non-character LoRA(s).'
          : 'Create a single fresh, spontaneous scene prompt for the subject.';

    const userInstruction = [leadLine, attachedLoraBlock || '', priorBlock || '', tagHint, responseFormatHint]
      .filter(Boolean)
      .join('\n\n');

    const res = await postChatCompletion({
      baseUrl,
      model: modelToUse,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userInstruction },
      ],
      temperature: 0.74,
      maxTokens: 1350,
      timeoutMs: 35_000,
    });

    let latestContent = res.content;
    let chosenBase = shouldSelectBase
      ? resolveSelectedBaseCandidate(latestContent, params.baseCandidates)
      : lockedCandidate;

    let loraCheck =
      extractLoraCheckFromRandomRollResponse(latestContent) || params.lockedLoraCheck || null;
    let sanitized = extractPromptFromRandomRollResponse(latestContent, params.characterName);

    // Retry once if the model returned scratchpad/meta tags without a valid <proposed_prompt>
    if (sanitized.length < 15) {
      const formatRetryRes = await postChatCompletion({
        baseUrl,
        model: modelToUse,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userInstruction },
          { role: 'assistant', content: latestContent },
          {
            role: 'user',
            content: `Format Error: Your response did not include a valid <proposed_prompt>...</proposed_prompt> for Shot ${shotNumber}. Write ONLY ONE standalone image prompt wrapped inside <proposed_prompt>...</proposed_prompt> (no <lora_check>, no <proposed_concept>, and no multi-shot summary).`,
          },
        ],
        temperature: 0.68,
        maxTokens: 900,
        timeoutMs: 25_000,
      });

      const formatRetrySanitized = extractPromptFromRandomRollResponse(
        formatRetryRes.content,
        params.characterName
      );
      if (formatRetrySanitized.length >= 15) {
        latestContent = formatRetryRes.content;
        sanitized = formatRetrySanitized;
        chosenBase =
          (shouldSelectBase
            ? resolveSelectedBaseCandidate(formatRetryRes.content, params.baseCandidates)
            : null) || chosenBase;
        loraCheck =
          extractLoraCheckFromRandomRollResponse(formatRetryRes.content) || loraCheck;
      }
    }

    if (params.hasStyleLoras && sanitized.length >= 15) {
      const checkResult = verifyPromptReflectsLoraCheck(sanitized, loraCheck, attachedLoraBlock);

      if (!checkResult.passed) {
        const missingPreview = checkResult.expectedKeywords.slice(0, 10).join(', ');
        const retryHint =
          shotNumber > 1
            ? 'Return ONLY <proposed_prompt>...</proposed_prompt>.'
            : responseFormatHint;
        const retryRes = await postChatCompletion({
          baseUrl,
          model: modelToUse,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userInstruction },
            { role: 'assistant', content: latestContent },
            {
              role: 'user',
              content: `Self-Check Verification Failed: Your <proposed_prompt> did not explicitly include the visual concepts from your <lora_check> / Attached LoRAs (expected visual cues such as: ${missingPreview}). Rewrite <proposed_prompt> so the setting, wardrobe, or visual style explicitly depicts those attached LoRA elements while keeping strict character identity fidelity. ${retryHint}`,
            },
          ],
          temperature: 0.65,
          maxTokens: 1200,
          timeoutMs: 30_000,
        });

        const retrySanitized = extractPromptFromRandomRollResponse(
          retryRes.content,
          params.characterName
        );
        if (retrySanitized.length >= 15) {
          sanitized = retrySanitized;
          chosenBase =
            (shouldSelectBase
              ? resolveSelectedBaseCandidate(retryRes.content, params.baseCandidates)
              : null) || chosenBase;
        }
      }
    }

    const resolvedCheckpoint =
      params.lockedCheckpoint || chosenBase?.filename || params.fallbackCheckpoint;

    if (sanitized.length >= 15) {
      return {
        prompt: sanitized,
        checkpointName: resolvedCheckpoint,
        usedLmStudio: true,
        loraCheck,
      };
    }
  } catch {
    // Fall through cleanly to offline prompt synthesis
  }

  return {
    prompt: buildOfflineRandomPrompt(params.characterName, params.tags, shotNumber - 1),
    checkpointName: resolvedFallbackCkpt,
    usedLmStudio: false,
    loraCheck: params.lockedLoraCheck || null,
  };
}
