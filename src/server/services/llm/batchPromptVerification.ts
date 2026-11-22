import {
  sanitizeAgentPrompt,
  verifyPromptReflectsLoraCheck,
} from './llmPromptUtils.ts';

const SHOT_TAG_REGEX = /<\/?(?:shot(?:_\d+)?|proposed_prompt|proposed_concept)>/gi;

/**
 * Removes XML wrapper tags (`<shot_1>`, `<proposed_prompt>`, `<lora_check>`, etc.)
 * so control markup never leaks into generated image prompts.
 */
export function stripLlmPromptWrapperTags(raw: string): string {
  return raw
    .replace(
      /<lora_check>[\s\S]*?(?:<\/lora_check>|(?=<selected_base>)|(?=<selected_preset>)|(?=<selected_loras>)|(?=<proposed_prompt>)|(?=<proposed_concept>)|(?=<shot(?:_\d+)?>)|$)/gi,
      ''
    )
    .replace(/<selected_(?:base|preset|loras)>[\s\S]*?(?:<\/selected_(?:base|preset|loras)>|$)/gi, '')
    .replace(SHOT_TAG_REGEX, '')
    .trim();
}

/**
 * Parses multi-shot LLM output (`<shot_1>...</shot_1>`, unclosed `<shot_1>...<shot_2>...`,
 * JSON array, or numbered/bulleted lines) without leaking wrapper tags.
 */
export function parseShotPromptsFromLlm(rawContent: string): string[] {
  const withoutCheck = rawContent
    .replace(
      /<lora_check>[\s\S]*?(?:<\/lora_check>|(?=<shot(?:_\d+)?>)|(?=<proposed_prompt>)|$)/gi,
      ''
    )
    .trim();

  // 1. Primary parser: <shot_1>...</shot_1> (supports both closed and unclosed <shot_N> tags)
  const shotTagMatches = Array.from(
    withoutCheck.matchAll(
      /<shot(?:_\d+)?>([\s\S]*?)(?:<\/shot(?:_\d+)?>|(?=<shot(?:_\d+)?>)|$)/gi
    )
  );
  if (shotTagMatches.length > 0) {
    const tagged = shotTagMatches
      .map((m) =>
        stripLlmPromptWrapperTags(m[1])
          .replace(/^["']|["']$/g, '')
          .trim()
      )
      .filter(Boolean);
    if (tagged.length > 0) return tagged;
  }

  const cleaned = stripLlmPromptWrapperTags(withoutCheck);

  // 2. Secondary fallback: JSON array [...]
  const jsonMatch = cleaned.match(/\[[\s\S]*\]/);
  if (jsonMatch) {
    try {
      const arr = JSON.parse(jsonMatch[0]);
      if (Array.isArray(arr)) {
        const parsed = arr
          .map((item) => stripLlmPromptWrapperTags(String(item)).trim())
          .filter(Boolean);
        if (parsed.length > 0) return parsed;
      }
    } catch {
      // Fall through to line splitting below
    }
  }

  // 3. Tertiary fallback: numbered / bulleted lines
  return cleaned
    .split('\n')
    .map((line) =>
      stripLlmPromptWrapperTags(line)
        .replace(/^\s*(?:\d+[\.\)]\s*|[-*]\s*|Prompt\s*\d+:\s*|Shot\s*\d+:\s*)/i, '')
        .replace(/^["']|["'],?$/g, '')
        .trim()
    )
    .filter((line) => line.length > 15 && !line.startsWith('[') && !line.startsWith(']'));
}

/**
 * Extracts a single standalone prompt from a per-shot batch LLM response,
 * supporting `<proposed_prompt>` and `<shot_1>` while blocking `<lora_check>` / `<proposed_concept>` leaks.
 */
export function extractPromptFromBatchShotResponse(
  llmContent: string,
  characterName?: string
): string {
  const proposedMatch = llmContent.match(/<proposed_prompt>([\s\S]*?)(?:<\/proposed_prompt>|$)/i);
  if (proposedMatch && proposedMatch[1]) {
    const inside = stripLlmPromptWrapperTags(proposedMatch[1])
      .replace(/^["']|["']$/g, '')
      .trim();
    return sanitizeAgentPrompt(inside, characterName);
  }

  if (/<shot(?:_\d+)?>/i.test(llmContent)) {
    const shots = parseShotPromptsFromLlm(llmContent);
    if (shots[0]) {
      return sanitizeAgentPrompt(shots[0], characterName);
    }
  }

  if (/<(?:lora_check|selected_base|selected_preset|selected_loras|proposed_concept)\b/i.test(llmContent)) {
    return '';
  }

  const fallback = stripLlmPromptWrapperTags(llmContent)
    .replace(/^["']|["']$/g, '')
    .trim();
  return sanitizeAgentPrompt(fallback, characterName);
}

interface SemanticAnchorRule {
  label: string;
  triggerRegex: RegExp;
  verifyRegex: RegExp;
}

const SEMANTIC_ANCHOR_RULES: SemanticAnchorRule[] = [
  {
    label: 'bare upper body / state of undress (wearing nothing else)',
    triggerRegex:
      /\b(?:nothing\s+(?:else|except|but|other\s+than)|only\s+wear(?:ing)?|wear(?:ing|s)?\s+only|topless|bare[- ]?chested|naked|nude|unclothed)\b/i,
    verifyRegex:
      /\b(?:topless|bare[- ]?(?:chest|torso|upper\s+body|skin|shoulders|back|breasts?)|nude|naked|unclothed|exposed\s+(?:breasts?|chest|torso)|no\s+(?:shirt|top|bra)|wearing\s+only|wearing\s+nothing\s+(?:else|above|on\s+top)|nothing\s+but)\b/i,
  },
  {
    label: 'white panties / requested underwear',
    triggerRegex: /\bwhite\s+(?:panties|underwear|briefs|lingerie|knickers)\b/i,
    verifyRegex: /\bwhite\b[^.]{0,35}\b(?:panties|underwear|briefs|lingerie|knickers)\b|\b(?:panties|underwear|briefs|lingerie|knickers)\b[^.]{0,25}\bwhite\b/i,
  },
  {
    label: 'panties / underwear',
    triggerRegex: /\b(?:panties|underwear|knickers)\b/i,
    verifyRegex: /\b(?:panties|underwear|briefs|knickers|lingerie)\b/i,
  },
  {
    label: 'lingerie / bra',
    triggerRegex: /\b(?:lingerie|bra|bralette|corset)\b/i,
    verifyRegex: /\b(?:lingerie|bra|bralette|corset|lace)\b/i,
  },
  {
    label: 'bikini / swimwear',
    triggerRegex: /\b(?:bikini|swimsuit|swimwear)\b/i,
    verifyRegex: /\b(?:bikini|swimsuit|swimwear|two-piece|one-piece)\b/i,
  },
  {
    label: 'scared / terrified facial expression',
    triggerRegex: /\b(?:scared|terrified|afraid|frightened|fearful|panicked|panicking|terror|horrified)\b/i,
    verifyRegex:
      /\b(?:scared|terrified|afraid|frightened|fear|fearful|terror|panicked|panic|horrified|wide[- ]?eyed|trembling|shivering|startled|dread|alarmed)\b/i,
  },
  {
    label: 'horror setting & atmosphere',
    triggerRegex: /\b(?:horror|haunted|nightmare|slasher|macabre|creepy|asylum|dungeon)\b/i,
    verifyRegex:
      /\b(?:horror|haunted|nightmare|macabre|creepy|eerie|sinister|menacing|ominous|dread|flickering|decay(?:ed|ing)?|peeling|grimy|rusted|rusty|claustrophobic|abandoned|asylum|dungeon|unsettling|oppressive|blood|chilling|pitch[- ]?black)\b/i,
  },
];

const ANCHOR_STOPWORDS = new Set([
  'about', 'across', 'after', 'alone', 'along', 'always', 'angle', 'another', 'around', 'atmosphere',
  'background', 'between', 'camera', 'character', 'close', 'color', 'concept', 'continuous', 'corridor',
  'detail', 'different', 'distinct', 'distance', 'during', 'editorial', 'environment', 'establishing',
  'every', 'except', 'expression', 'female', 'figure', 'first', 'focus', 'frame', 'framing', 'front',
  'genre', 'having', 'herself', 'himself', 'image', 'include', 'into', 'keep', 'keeping', 'light',
  'lighting', 'look', 'looking', 'looks', 'make', 'making', 'medium', 'mood', 'more', 'movie', 'natural',
  'nothing', 'only', 'other', 'outfit', 'overall', 'palette', 'person', 'photo', 'photograph', 'plan',
  'portrait', 'pose', 'progression', 'prompt', 'roughly', 'scene', 'setting', 'setup', 'several', 'shoot',
  'shot', 'shots', 'should', 'show', 'showing', 'single', 'something', 'stands', 'standing', 'story',
  'style', 'styling', 'subject', 'take', 'takes', 'theme', 'their', 'there', 'these', 'they', 'thing',
  'this', 'those', 'through', 'tight', 'toward', 'using', 'varied', 'variety', 'visual', 'wardrobe',
  'wear', 'wearing', 'wears', 'where', 'which', 'while', 'wide', 'with', 'without', 'woman', 'would',
]);

/**
 * Extracts mandatory user-requested semantic anchors and concrete keywords
 * from the Set Concept and recent user chat turns.
 */
export function extractBatchConceptAnchors(
  theme: string,
  recentUserMessages: string[] = []
): {
  combinedSource: string;
  wantsRearView: boolean;
  matchedRules: SemanticAnchorRule[];
  concreteKeywords: string[];
} {
  const combinedSource = [theme, ...recentUserMessages].filter(Boolean).join('\n').trim();
  const wantsRearView = /\b(?:from\s+behind|back\s+to\s+(?:the\s+)?camera|back\s+turned|rear\s+view|view\s+from\s+behind)\b/i.test(
    combinedSource
  );

  // Deduplicate overlapping underwear rules when specific "white panties" already matched
  const matchedRules: SemanticAnchorRule[] = [];
  for (const rule of SEMANTIC_ANCHOR_RULES) {
    if (rule.triggerRegex.test(combinedSource)) {
      if (
        rule.label === 'panties / underwear' &&
        matchedRules.some((r) => r.label === 'white panties / requested underwear')
      ) {
        continue;
      }
      matchedRules.push(rule);
    }
  }

  const rawWords = combinedSource
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/\s+/)
    .map((w) => w.replace(/^-+|-+$/g, ''))
    .filter((w) => w.length >= 4 && !ANCHOR_STOPWORDS.has(w) && !/^\d+$/.test(w));

  return {
    combinedSource,
    wantsRearView,
    matchedRules,
    concreteKeywords: Array.from(new Set(rawWords)).slice(0, 20),
  };
}

/**
 * Validates that a single batch-expanded shot meets minimum detail density,
 * preserves mandatory user wardrobe/expression/setting anchors, avoids hiding
 * requested details behind an unrequested rear view, and reflects attached LoRAs.
 */
export function verifyBatchShotQuality(params: {
  shotPrompt: string;
  theme: string;
  recentUserMessages?: string[];
  loraCheck?: string | null;
  nonCharacterLoraBlock?: string | null;
}): {
  passed: boolean;
  reasons: string[];
  wordCount: number;
  expectedLoraKeywords: string[];
} {
  const { shotPrompt, theme, recentUserMessages = [], loraCheck = null, nonCharacterLoraBlock = null } =
    params;
  const trimmed = shotPrompt.trim();
  const words = trimmed ? trimmed.split(/\s+/).filter(Boolean) : [];
  const wordCount = words.length;
  const reasons: string[] = [];

  if (wordCount < 50 || trimmed.length < 250) {
    reasons.push(
      `Prompt is too brief (${wordCount} words); expand to a dense ~80–140 word paragraph covering all 5 visual sections (Medium & Framing, Subject Action & Expression, Wardrobe/Undress, Environment & Props, Lighting & Atmosphere).`
    );
  }

  const anchors = extractBatchConceptAnchors(theme, recentUserMessages);

  if (
    !anchors.wantsRearView &&
    anchors.matchedRules.length > 0 &&
    /\b(?:back\s+to\s+(?:the\s+)?camera|seen\s+from\s+behind|facing\s+away\s+from\s+(?:the\s+)?camera)\b/i.test(
      trimmed
    )
  ) {
    reasons.push(
      'Do not turn the subject with her back to the camera or push her far away—keep her facial expression and requested wardrobe/state of undress clearly visible to the viewer.'
    );
  }

  const missedAnchors: string[] = [];
  for (const rule of anchors.matchedRules) {
    if (!rule.verifyRegex.test(trimmed)) {
      missedAnchors.push(rule.label);
    }
  }
  if (missedAnchors.length > 0) {
    reasons.push(
      `Explicitly depict every missed mandatory concept anchor: ${missedAnchors.join('; ')}.`
    );
  }

  // General keyword coverage check when no specialized semantic rule matched
  if (anchors.matchedRules.length === 0 && anchors.concreteKeywords.length >= 4) {
    const promptLower = trimmed.toLowerCase();
    const matchedCount = anchors.concreteKeywords.filter((kw) => {
      const stem = kw.length >= 6 ? kw.replace(/(?:ing|ed|es|s)$/, '') : kw;
      return promptLower.includes(kw) || (stem.length >= 4 && promptLower.includes(stem));
    }).length;
    if (matchedCount === 0) {
      reasons.push(
        `Incorporate concrete concepts from the user's request (${anchors.concreteKeywords.slice(0, 8).join(', ')}).`
      );
    }
  }

  let expectedLoraKeywords: string[] = [];
  if (nonCharacterLoraBlock) {
    const loraVerify = verifyPromptReflectsLoraCheck(trimmed, loraCheck, nonCharacterLoraBlock);
    expectedLoraKeywords = loraVerify.expectedKeywords;
    if (!loraVerify.passed) {
      reasons.push(
        `Reflect the active non-character LoRA visual elements (${loraVerify.expectedKeywords.slice(0, 8).join(', ')}).`
      );
    }
  }

  return {
    passed: reasons.length === 0,
    reasons,
    wordCount,
    expectedLoraKeywords,
  };
}
