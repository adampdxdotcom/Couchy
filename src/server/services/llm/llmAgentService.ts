import { db } from '../../db.ts';
import { logger } from '../../logger.ts';
import {
  DEFAULT_BATCH_EXPANSION_PROMPT,
  checkLmStudioStatus,
  getLmStudioSettings,
  postChatCompletion,
} from './llmClientService.ts';
import {
  buildLlmCharacterAndLoraContext,
  interpolatePromptTemplate,
  normalizeLoraMatchKey,
  sanitizeAgentPrompt,
} from './llmPromptUtils.ts';

function parseShotPromptsFromLlm(cleaned: string): string[] {
  // 1. Primary parser: <shot_1>...</shot_1> XML tags
  const shotTagMatches = Array.from(
    cleaned.matchAll(/<shot(?:_\d+)?>([\s\S]*?)<\/shot(?:_\d+)?>/gi)
  );
  if (shotTagMatches.length > 0) {
    const tagged = shotTagMatches
      .map((m) => m[1].replace(/^["']|["']$/g, '').trim())
      .filter(Boolean);
    if (tagged.length > 0) return tagged;
  }

  // 2. Secondary fallback: JSON array [...]
  const jsonMatch = cleaned.match(/\[[\s\S]*\]/);
  if (jsonMatch) {
    try {
      const arr = JSON.parse(jsonMatch[0]);
      if (Array.isArray(arr)) {
        const parsed = arr.map((item) => String(item).trim()).filter(Boolean);
        if (parsed.length > 0) return parsed;
      }
    } catch {
      // fallback to line splitting below
    }
  }

  // 3. Tertiary fallback: numbered / bulleted lines
  return cleaned
    .split('\n')
    .map((line) =>
      line
        .replace(/^\s*(?:\d+[\.\)]\s*|[-*]\s*|Prompt\s*\d+:\s*|Shot\s*\d+:\s*)/i, '')
        .replace(/^["']|["'],?$/g, '')
        .trim()
    )
    .filter((line) => line.length > 15 && !line.startsWith('[') && !line.startsWith(']'));
}

function buildOfflineFallbackShots(params: {
  theme: string;
  basePromptTemplate: string;
  characterName: string;
  count: number;
}): string[] {
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
 * Expands a Set Concept / Photo Set Theme into N cohesive standalone prompts via Local LLM,
 * falling back gracefully to built-in shot variations when the LLM is offline.
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
    const modelToUse = params.modelOverride || settings.selectedModel || 'local-model';
    const res = await postChatCompletion({
      baseUrl,
      model: modelToUse,
      messages: [
        { role: 'system', content: sentSystemPrompt },
        { role: 'user', content: sentUserPrompt },
      ],
      temperature: 0.75,
      maxTokens: 4096,
      timeoutMs: 90_000,
    });

    const parsedPrompts = parseShotPromptsFromLlm(res.content);
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
      modelUsed: res.modelUsed,
      guidingTemplateName: 'Unified Agent + Batch Expansion',
      sentSystemPrompt,
      sentUserPrompt,
    };
  } catch (err: any) {
    return {
      prompts: buildOfflineFallbackShots({
        theme: params.theme,
        basePromptTemplate: params.basePromptTemplate,
        characterName: params.characterName,
        count,
      }),
      usedLmStudio: false,
      modelUsed: 'Built-in Photo Set Director (Local LLM Offline)',
      guidingTemplateName: 'Unified Agent + Batch Expansion',
      sentSystemPrompt,
      sentUserPrompt,
      warning: `Local LLM unreachable (${err?.message || 'connection refused'}). Generated set variations using Couchy's built-in shot director so you can still preview or edit your set.`,
    };
  }
}

interface CandidateLoraRow {
  name: string;
  filename: string;
  lora_category: string;
  nickname: string | null;
  llm_description: string;
}

interface CandidatePresetRow {
  id: number;
  name: string;
  nickname: string;
  agent_description: string;
  checkpoint_name: string | null;
}

function getCandidateHandle(c: { nickname: string | null; name: string }): string {
  return (c.nickname || '').trim().replace(/^@+/, '') || c.name.trim();
}

function loadAgentCatalog() {
  const candidateRows = db
    .prepare(
      `SELECT m.name, m.filename, m.lora_category, m.nickname, m.llm_description
       FROM models m
       WHERE m.model_type = 'lora'
         AND m.mention_enabled = 1
         AND COALESCE(m.is_installed, 0) = 1
         AND COALESCE(m.is_hidden, 0) = 0
         AND TRIM(COALESCE(m.llm_description, '')) != ''
         AND LOWER(COALESCE(m.lora_category, 'unclassified')) != 'character'
         AND NOT EXISTS (
           SELECT 1 FROM character_loras cl WHERE LOWER(cl.lora_name) = LOWER(m.filename)
         )
       ORDER BY LOWER(COALESCE(NULLIF(TRIM(m.nickname), ''), m.name)) ASC`
    )
    .all() as CandidateLoraRow[];

  const presetRows = db
    .prepare(
      `SELECT id, name, nickname, agent_description, checkpoint_name
       FROM lora_presets
       WHERE TRIM(COALESCE(agent_description, '')) != ''
       ORDER BY LOWER(name) ASC`
    )
    .all() as CandidatePresetRow[];

  const presetItemRows =
    presetRows.length > 0
      ? (db
          .prepare(
            `SELECT preset_id, lora_name, model_strength
             FROM lora_preset_items
             ORDER BY preset_id ASC, sort_order ASC, id ASC`
          )
          .all() as Array<{ preset_id: number; lora_name: string; model_strength: number }>)
      : [];

  const presetItemsMap = new Map<number, string[]>();
  for (const pi of presetItemRows) {
    const label = `${pi.lora_name.replace(/\.(safetensors|pt|ckpt)$/i, '')}@${Number(pi.model_strength).toFixed(2)}x`;
    const list = presetItemsMap.get(pi.preset_id) || [];
    list.push(label);
    presetItemsMap.set(pi.preset_id, list);
  }

  return { candidateRows, presetRows, presetItemsMap };
}

function parseAgentConversationResponse(params: {
  withoutThink: string;
  availableCandidates: CandidateLoraRow[];
  presetRows: CandidatePresetRow[];
  targetBatchCount: number;
  characterName?: string;
}): {
  reply: string;
  proposedPrompt: string | null;
  proposalKind: 'prompt' | 'concept';
  selectedLoras: string[];
  selectedPreset: { id: number; name: string; nickname: string } | null;
} {
  const { withoutThink, availableCandidates, presetRows, targetBatchCount, characterName } = params;

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

  let selectedPreset: { id: number; name: string; nickname: string } | null = null;
  const presetTagMatch = withoutThink.match(/<selected_preset>([\s\S]*?)(?:<\/selected_preset>|$)/i);
  if (presetTagMatch && presetTagMatch[1]?.trim() && presetRows.length > 0) {
    let rawPreset = presetTagMatch[1].trim();
    try {
      const parsed = JSON.parse(rawPreset);
      if (typeof parsed === 'string') rawPreset = parsed;
      else if (Array.isArray(parsed) && parsed[0]) rawPreset = String(parsed[0]);
    } catch {
      // Treat as raw handle string
    }
    const cleanPresetKey = rawPreset.replace(/^["'\s@]+|["'\s]+$/g, '').toLowerCase();
    if (cleanPresetKey) {
      const matchedPreset = presetRows.find(
        (p) =>
          (p.nickname && p.nickname.trim().replace(/^@+/, '').toLowerCase() === cleanPresetKey) ||
          p.name.trim().toLowerCase() === cleanPresetKey
      );
      if (matchedPreset) {
        selectedPreset = {
          id: matchedPreset.id,
          name: matchedPreset.name,
          nickname: matchedPreset.nickname || '',
        };
      }
    }
  }

  const cleanedContent = withoutThink
    .replace(/<selected_loras>[\s\S]*?(?:<\/selected_loras>|$)/gi, '')
    .replace(/<selected_preset>[\s\S]*?(?:<\/selected_preset>|$)/gi, '')
    .trim();

  let proposedPrompt: string | null = null;
  let proposalKind: 'prompt' | 'concept' = targetBatchCount > 1 ? 'concept' : 'prompt';
  let replyText = cleanedContent;

  const conceptMatch = cleanedContent.match(/<proposed_concept>([\s\S]*?)(?:<\/proposed_concept>|$)/i);
  const promptMatch = cleanedContent.match(/<proposed_prompt>([\s\S]*?)(?:<\/proposed_prompt>|$)/i);

  if (conceptMatch && conceptMatch[1]?.trim()) {
    proposalKind = 'concept';
    proposedPrompt = sanitizeAgentPrompt(
      conceptMatch[1].replace(/^["']|["']$/g, '').trim(),
      characterName
    );
    replyText = cleanedContent
      .replace(/<proposed_concept>[\s\S]*?(?:<\/proposed_concept>|$)/gi, '')
      .replace(/<proposed_prompt>[\s\S]*?(?:<\/proposed_prompt>|$)/gi, '')
      .trim();
  } else if (promptMatch && promptMatch[1]?.trim()) {
    proposalKind = targetBatchCount > 1 ? 'concept' : 'prompt';
    proposedPrompt = sanitizeAgentPrompt(
      promptMatch[1].replace(/^["']|["']$/g, '').trim(),
      characterName
    );
    replyText = cleanedContent
      .replace(/<proposed_prompt>[\s\S]*?(?:<\/proposed_prompt>|$)/gi, '')
      .trim();
  } else {
    const fenceMatch = cleanedContent.match(/```(?:prompt|concept|text)?\s*([\s\S]{25,}?)```/i);
    if (fenceMatch && fenceMatch[1]?.trim()) {
      proposedPrompt = sanitizeAgentPrompt(
        fenceMatch[1].replace(/^["']|["']$/g, '').trim(),
        characterName
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

  return { reply: replyText, proposedPrompt, proposalKind, selectedLoras, selectedPreset };
}

/**
 * Interactive multi-turn Quick Gen Conversation handler via Local LLM `/v1/chat/completions`.
 * Extracts `<proposed_prompt>` / `<proposed_concept>`, `<selected_loras>`, and `<selected_preset>`.
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
  activePresetName?: string;
  batchCount?: number;
}): Promise<{
  reply: string;
  proposedPrompt: string | null;
  proposalKind: 'prompt' | 'concept';
  selectedLoras: string[];
  selectedPreset: { id: number; name: string; nickname: string } | null;
  modelUsed: string;
}> {
  const status = await checkLmStudioStatus();
  if (!status.online) {
    throw new Error('Local LLM is offline. Start your Local LLM server to use Conversation mode.');
  }
  const targetBatchCount = Math.max(1, Math.min(20, Number(params.batchCount) || 1));

  const settings = getLmStudioSettings();
  const baseUrl = settings.baseUrl.replace(/\/+$/, '');
  const modelToUse = status.selectedModel || settings.selectedModel || 'local-model';

  const excludedKeys = new Set(
    (params.excludedLoras || []).map((l) => normalizeLoraMatchKey(l)).filter(Boolean)
  );

  const { candidateRows, presetRows, presetItemsMap } = loadAgentCatalog();
  const availableCandidates = candidateRows.filter((c) => {
    const fileKey = normalizeLoraMatchKey(c.filename);
    const nameKey = normalizeLoraMatchKey(c.name);
    const nickKey = c.nickname ? normalizeLoraMatchKey(c.nickname) : '';
    return (
      !excludedKeys.has(fileKey) &&
      !excludedKeys.has(nameKey) &&
      (!nickKey || !excludedKeys.has(nickKey))
    );
  });

  const { characterBlock, attachedLoraBlock } = buildLlmCharacterAndLoraContext({
    characterName: params.characterName,
    characterDescription: params.characterDescription,
    characterPhysicalDescription: params.characterPhysicalDescription,
    loraNames: params.loraNames,
  });

  const contextNotes: string[] = [];
  if (characterBlock) contextNotes.push(characterBlock);
  if (params.activePresetName?.trim()) {
    contextNotes.push(`Active LoRA Preset: ${params.activePresetName.trim()}`);
  }
  if (attachedLoraBlock) contextNotes.push(attachedLoraBlock);

  if (presetRows.length > 0) {
    const presetLines = presetRows.map((p) => {
      const handle = getCandidateHandle(p);
      const baseLabel = p.checkpoint_name
        ? `Base: ${p.checkpoint_name.replace(/\.(safetensors|pt|ckpt|gguf|sft)$/i, '')}`
        : 'Base: System Workflow Default';
      const lorasSummary = (presetItemsMap.get(p.id) || []).join(', ');
      const composition = lorasSummary ? `${baseLabel}; LoRAs: ${lorasSummary}` : baseLabel;
      return `- @${handle} [${composition}]: ${p.agent_description.trim()}`;
    });
    contextNotes.push(
      [
        `Saved LoRA Presets available for selection (each applies a curated Base Model + LoRA stack with tuned strengths):`,
        ...presetLines,
        `Preset Selection Rules:`,
        `- If one of these saved Presets best fits the user's request, emit <selected_preset>"@handle"</selected_preset> (choose at most 1 preset).`,
        `- Do NOT write preset handles or LoRA filenames inside the generated prompt itself.`,
      ].join('\n')
    );
  }

  if (availableCandidates.length > 0) {
    const catalogLines = availableCandidates.map((c) => {
      const handle = getCandidateHandle(c);
      const cat =
        c.lora_category && c.lora_category !== 'unclassified' ? ` [${c.lora_category}]` : '';
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

  // Re-attach proposed blocks inside recent turns since UI storage separates them from `content`
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

  // Pin latest proposed block if it scrolled outside the 10-message sliding window
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

  try {
    const res = await postChatCompletion({
      baseUrl,
      model: modelToUse,
      messages: [{ role: 'system', content: systemPrompt }, ...recentMessages],
      temperature: 0.7,
      maxTokens: 1500,
      timeoutMs: 90_000,
    });

    const parsed = parseAgentConversationResponse({
      withoutThink: res.content,
      availableCandidates,
      presetRows,
      targetBatchCount,
      characterName: params.characterName,
    });

    logger.info(
      'LocalLLM',
      `Conversation turn completed (${res.modelUsed}) | proposalKind=${parsed.proposalKind} | hasProposal=${Boolean(
        parsed.proposedPrompt
      )} | selectedLoras=${parsed.selectedLoras.length > 0 ? parsed.selectedLoras.join(', ') : 'none'} | selectedPreset=${parsed.selectedPreset ? parsed.selectedPreset.name : 'none'}`
    );

    return {
      ...parsed,
      modelUsed: res.modelUsed,
    };
  } catch (err: any) {
    if (err?.httpStatus) {
      logger.error('LocalLLM', `Conversation HTTP ${err.httpStatus}`, err.errBody || err.message);
    }
    throw err;
  }
}
