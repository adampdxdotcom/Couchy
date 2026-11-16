import fs from 'fs';
import type { LoraCategory } from '../../shared/types.ts';

export interface LoraClassifyInput {
  name?: string | null;
  filename?: string | null;
  tags?: string[] | null;
  trainedWords?: string[] | null;
  description?: string | null;
  baseModel?: string | null;
}

type SpecificLoraCategory = Exclude<LoraCategory, 'other' | 'unclassified'>;

const CATEGORIES: SpecificLoraCategory[] = [
  'clothing',
  'pose',
  'style',
  'character',
  'object',
  'concept',
];

// Exact normalized tag mappings (Civitai `tags` / Hugging Face repo tags).
// Precedence nuances (e.g., outfit LoRAs for a character tagged ["character", "clothing"])
// are handled via higher scores for clothing/pose/style tags vs generic "character".
const TAG_CATEGORY_SCORES: Record<string, { category: SpecificLoraCategory; weight: number }> = {
  // Clothing / Outfit (+12 so character-specific outfits resolve to clothing)
  clothing: { category: 'clothing', weight: 12 },
  clothes: { category: 'clothing', weight: 12 },
  outfit: { category: 'clothing', weight: 12 },
  outfits: { category: 'clothing', weight: 12 },
  costume: { category: 'clothing', weight: 12 },
  costumes: { category: 'clothing', weight: 12 },
  fashion: { category: 'clothing', weight: 11 },
  apparel: { category: 'clothing', weight: 11 },
  attire: { category: 'clothing', weight: 11 },
  dress: { category: 'clothing', weight: 10 },
  lingerie: { category: 'clothing', weight: 11 },
  swimsuit: { category: 'clothing', weight: 11 },
  bikini: { category: 'clothing', weight: 11 },
  armor: { category: 'clothing', weight: 10 },
  armour: { category: 'clothing', weight: 10 },
  uniform: { category: 'clothing', weight: 10 },
  bodysuit: { category: 'clothing', weight: 10 },
  footwear: { category: 'clothing', weight: 10 },
  shoes: { category: 'clothing', weight: 9 },
  accessories: { category: 'clothing', weight: 9 },

  // Pose / Expression (+12)
  pose: { category: 'pose', weight: 12 },
  poses: { category: 'pose', weight: 12 },
  action: { category: 'pose', weight: 11 },
  actions: { category: 'pose', weight: 11 },
  expression: { category: 'pose', weight: 11 },
  expressions: { category: 'pose', weight: 11 },
  'facial expression': { category: 'pose', weight: 11 },
  'facial expressions': { category: 'pose', weight: 11 },
  gesture: { category: 'pose', weight: 10 },
  gestures: { category: 'pose', weight: 10 },
  posture: { category: 'pose', weight: 10 },
  perspective: { category: 'pose', weight: 9 },
  'camera angle': { category: 'pose', weight: 9 },

  // Style / Aesthetic (+11)
  style: { category: 'style', weight: 11 },
  styles: { category: 'style', weight: 11 },
  artstyle: { category: 'style', weight: 11 },
  'art style': { category: 'style', weight: 11 },
  'illustration style': { category: 'style', weight: 11 },
  'anime style': { category: 'style', weight: 11 },
  aesthetic: { category: 'style', weight: 10 },
  watercolor: { category: 'style', weight: 10 },
  'oil painting': { category: 'style', weight: 10 },
  'pixel art': { category: 'style', weight: 10 },
  lineart: { category: 'style', weight: 10 },
  'cel shading': { category: 'style', weight: 10 },
  photorealistic: { category: 'style', weight: 8 },
  sketch: { category: 'style', weight: 8 },
  comic: { category: 'style', weight: 7 },
  manga: { category: 'style', weight: 7 },

  // Character / Person (+9)
  character: { category: 'character', weight: 9 },
  characters: { category: 'character', weight: 9 },
  celebrity: { category: 'character', weight: 10 },
  celebrities: { category: 'character', weight: 10 },
  person: { category: 'character', weight: 9 },
  people: { category: 'character', weight: 8 },
  'real person': { category: 'character', weight: 10 },
  'anime character': { category: 'character', weight: 10 },
  'game character': { category: 'character', weight: 10 },
  vtuber: { category: 'character', weight: 10 },
  'original character': { category: 'character', weight: 10 },
  oc: { category: 'character', weight: 8 },

  // Object / Prop (+10)
  object: { category: 'object', weight: 10 },
  objects: { category: 'object', weight: 10 },
  prop: { category: 'object', weight: 10 },
  props: { category: 'object', weight: 10 },
  weapon: { category: 'object', weight: 10 },
  weapons: { category: 'object', weight: 10 },
  vehicle: { category: 'object', weight: 10 },
  vehicles: { category: 'object', weight: 10 },
  car: { category: 'object', weight: 9 },
  cars: { category: 'object', weight: 9 },
  motorcycle: { category: 'object', weight: 9 },
  furniture: { category: 'object', weight: 9 },
  food: { category: 'object', weight: 9 },
  item: { category: 'object', weight: 8 },
  sword: { category: 'object', weight: 9 },
  gun: { category: 'object', weight: 9 },

  // Concept / Environment / Effect / Helper (+10)
  concept: { category: 'concept', weight: 10 },
  concepts: { category: 'concept', weight: 10 },
  background: { category: 'concept', weight: 10 },
  backgrounds: { category: 'concept', weight: 10 },
  environment: { category: 'concept', weight: 10 },
  environments: { category: 'concept', weight: 10 },
  scenery: { category: 'concept', weight: 10 },
  landscape: { category: 'concept', weight: 9 },
  lighting: { category: 'concept', weight: 10 },
  effect: { category: 'concept', weight: 10 },
  effects: { category: 'concept', weight: 10 },
  vfx: { category: 'concept', weight: 10 },
  anatomy: { category: 'concept', weight: 9 },
  helper: { category: 'concept', weight: 9 },
  detailer: { category: 'concept', weight: 10 },
  slider: { category: 'concept', weight: 10 },
};

// Title / filename regex patterns (deliberately split camelCase/underscores prior to matching)
const TITLE_PATTERNS: Array<{ category: SpecificLoraCategory; regex: RegExp; weight: number }> = [
  {
    category: 'clothing',
    regex:
      /\b(outfit|clothing|clothes|costume|dress|gown|lingerie|bikini|swimsuit|uniform|armor|armour|jacket|hoodie|kimono|bodysuit|stockings|heels|boots|sneakers|apparel|attire|fashion|maid\s*outfit|school\s*uniform)\b/i,
    weight: 6,
  },
  {
    category: 'pose',
    regex:
      /\b(pose|poses|expression|expressions|sitting|kneeling|lying|action|pov|hand\s*pose|camera\s*angle|standing\s*pose|fighting\s*pose)\b/i,
    weight: 6,
  },
  {
    category: 'style',
    regex:
      /\b(style|artstyle|aesthetic|watercolor|oil\s*painting|pixel\s*art|lineart|cel\s*shad(?:ed|ing)|gouache|impasto|sketch\s*style|anime\s*style|retro\s*style|vintage\s*style|comic\s*style)\b/i,
    weight: 6,
  },
  {
    category: 'object',
    regex:
      /\b(weapon|weapons|sword|katana|gun|rifle|pistol|vehicle|car|motorcycle|spaceship|furniture|chair|table|food|cake|potion|bottle|prop|props)\b/i,
    weight: 6,
  },
  {
    category: 'concept',
    regex:
      /\b(concept|slider|detailer|helper|anatomy|background|scenery|landscape|environment|lighting|bokeh|vfx|effect|effects|magic\s*effect)\b/i,
    weight: 6,
  },
  {
    category: 'character',
    regex: /\b(character|celebrity|likeness|vtuber|waifu|persona)\b/i,
    weight: 5,
  },
];

// Explicit phrases inside creator description lead text
const DESCRIPTION_PATTERNS: Array<{ category: SpecificLoraCategory; regex: RegExp; weight: number }> = [
  {
    category: 'clothing',
    regex: /\b(outfit\s+lora|clothing\s+lora|costume\s+lora|dress\s+lora|trained\s+on\s+(?:the\s+)?(?:outfit|dress|costume|uniform))\b/i,
    weight: 6,
  },
  {
    category: 'pose',
    regex: /\b(pose\s+lora|expression\s+lora|action\s+lora|triggers\s+(?:the|this)\s+pose)\b/i,
    weight: 6,
  },
  {
    category: 'style',
    regex: /\b(style\s+lora|art\s*style\s+lora|in\s+the\s+style\s+of|mimics\s+the\s+style|illustration\s+style)\b/i,
    weight: 6,
  },
  {
    category: 'character',
    regex: /\b(character\s+lora|lora\s+(?:of|for)\s+(?:the\s+)?character|celebrity\s+lora|likeness\s+of|original\s+character|vtuber)\b/i,
    weight: 6,
  },
  {
    category: 'object',
    regex: /\b(object\s+lora|weapon\s+lora|prop\s+lora|vehicle\s+lora)\b/i,
    weight: 6,
  },
  {
    category: 'concept',
    regex: /\b(concept\s+lora|background\s+lora|lighting\s+lora|detail\s+slider|lora\s+slider|detail\s+enhancer)\b/i,
    weight: 6,
  },
];

function normalizeIdentifierText(raw: string | null | undefined): string {
  if (!raw) return '';
  return raw
    .replace(/\.(safetensors|ckpt|pt|pth|bin|sft|gguf)$/i, '')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[_/\\.-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function stripHtmlTags(raw: string | null | undefined): string {
  if (!raw) return '';
  return raw.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * Deterministically classifies a LoRA into a semantic LoraCategory using
 * Civitai/Hugging Face tags, normalized title/filename cues, trigger words, and description text.
 * Never invokes any local LLM or external model.
 */
export function classifyLoraFromMetadata(input: LoraClassifyInput): LoraCategory {
  const scores: Record<SpecificLoraCategory, number> = {
    clothing: 0,
    pose: 0,
    style: 0,
    character: 0,
    object: 0,
    concept: 0,
  };

  // 1. Tags (highest signal precision)
  const rawTags = Array.isArray(input.tags) ? input.tags : [];
  for (const rawTag of rawTags) {
    const tag = String(rawTag || '').trim().toLowerCase();
    if (!tag) continue;
    const direct = TAG_CATEGORY_SCORES[tag];
    if (direct) {
      scores[direct.category] += direct.weight;
      continue;
    }
    // Check compound tags like "anime style" or "character outfit"
    if (/\b(outfit|clothing|clothes|costume|dress|uniform|lingerie|swimsuit)\b/i.test(tag)) {
      scores.clothing += 9;
    } else if (/\b(pose|poses|expression|expressions|action)\b/i.test(tag)) {
      scores.pose += 9;
    } else if (/\b(style|artstyle|aesthetic)\b/i.test(tag)) {
      scores.style += 9;
    } else if (/\b(character|celebrity|vtuber|person)\b/i.test(tag)) {
      scores.character += 8;
    } else if (/\b(weapon|vehicle|prop|object|furniture)\b/i.test(tag)) {
      scores.object += 8;
    } else if (/\b(concept|background|scenery|lighting|detailer|slider|effect)\b/i.test(tag)) {
      scores.concept += 8;
    }
  }

  // 2. Title & filename cues
  const titleText = `${normalizeIdentifierText(input.name)} ${normalizeIdentifierText(input.filename)}`.trim();
  if (titleText) {
    for (const rule of TITLE_PATTERNS) {
      if (rule.regex.test(titleText)) {
        scores[rule.category] += rule.weight;
      }
    }
  }

  // 3. Explicit creator phrasing in description lead (first 1200 chars)
  const cleanDesc = stripHtmlTags(input.description).slice(0, 1200);
  if (cleanDesc) {
    for (const rule of DESCRIPTION_PATTERNS) {
      if (rule.regex.test(cleanDesc)) {
        scores[rule.category] += rule.weight;
      }
    }
  }

  // 4. Conservative trigger-word hints
  const triggerText = Array.isArray(input.trainedWords)
    ? input.trainedWords.map((w) => String(w || '').trim()).filter(Boolean).join(', ')
    : '';
  if (triggerText) {
    if (/\b(outfit|dress|costume|uniform|bikini|swimsuit|armor)\b/i.test(triggerText)) {
      scores.clothing += 4;
    }
    if (/\b(pose|sitting|kneeling|standing|lying|expression)\b/i.test(triggerText)) {
      scores.pose += 4;
    }
    if (/\b(style|artstyle|watercolor|lineart|pixel\s*art)\b/i.test(triggerText)) {
      scores.style += 4;
    }
  }

  // Pick highest scoring category above minimum confidence threshold (4)
  let bestCategory: SpecificLoraCategory | null = null;
  let bestScore = 3;
  for (const cat of CATEGORIES) {
    if (scores[cat] > bestScore) {
      bestScore = scores[cat];
      bestCategory = cat;
    }
  }

  return bestCategory ?? 'unclassified';
}

/**
 * Fallback deterministic classifier reading ONLY the lightweight `.safetensors` JSON header
 * (`__metadata__` keys like `ss_output_name`, `modelspec.title`, `ss_training_comment`,
 * and top `ss_tag_frequency` tags) for downloads where the user kept `'unclassified'`.
 */
export function classifySafetensorsHeaderOnDisk(
  filePath: string,
  fallbackMeta: LoraClassifyInput = {}
): LoraCategory {
  try {
    if (!filePath || !filePath.toLowerCase().endsWith('.safetensors')) {
      return classifyLoraFromMetadata(fallbackMeta);
    }
    if (!fs.existsSync(filePath)) {
      return classifyLoraFromMetadata(fallbackMeta);
    }

    const fd = fs.openSync(filePath, 'r');
    try {
      const lenBuf = Buffer.alloc(8);
      const readLen = fs.readSync(fd, lenBuf, 0, 8, 0);
      if (readLen < 8) return classifyLoraFromMetadata(fallbackMeta);

      const headerLenBig = lenBuf.readBigUInt64LE(0);
      // Guard against corrupt or unexpectedly huge headers (> 4 MB)
      if (headerLenBig <= 2n || headerLenBig > 4n * 1024n * 1024n) {
        return classifyLoraFromMetadata(fallbackMeta);
      }
      const headerLen = Number(headerLenBig);
      const headerBuf = Buffer.alloc(headerLen);
      const bytesRead = fs.readSync(fd, headerBuf, 0, headerLen, 8);
      if (bytesRead < headerLen) return classifyLoraFromMetadata(fallbackMeta);

      const parsed = JSON.parse(headerBuf.toString('utf8')) as Record<string, any>;
      const meta = parsed?.__metadata__;
      if (!meta || typeof meta !== 'object') {
        return classifyLoraFromMetadata(fallbackMeta);
      }

      const headerTags: string[] = Array.isArray(fallbackMeta.tags) ? [...fallbackMeta.tags] : [];
      if (typeof meta.ss_tag_frequency === 'string') {
        try {
          const freqObj = JSON.parse(meta.ss_tag_frequency) as Record<string, Record<string, number>>;
          const tagCounts: Array<[string, number]> = [];
          for (const bucket of Object.values(freqObj || {})) {
            if (!bucket || typeof bucket !== 'object') continue;
            for (const [k, v] of Object.entries(bucket)) {
              if (typeof v === 'number') tagCounts.push([k.trim().toLowerCase(), v]);
            }
          }
          tagCounts.sort((a, b) => b[1] - a[1]);
          for (const [t] of tagCounts.slice(0, 12)) {
            if (t) headerTags.push(t);
          }
        } catch {
          // Ignore malformed ss_tag_frequency JSON
        }
      }

      const combinedName = [
        fallbackMeta.name,
        meta['modelspec.title'],
        meta.ss_output_name,
      ]
        .filter(Boolean)
        .join(' ');

      const combinedDesc = [
        fallbackMeta.description,
        meta['modelspec.description'],
        meta.ss_training_comment,
      ]
        .filter(Boolean)
        .join(' ');

      return classifyLoraFromMetadata({
        name: combinedName || fallbackMeta.name,
        filename: fallbackMeta.filename,
        tags: headerTags,
        trainedWords: fallbackMeta.trainedWords,
        description: combinedDesc,
        baseModel: fallbackMeta.baseModel || meta['modelspec.architecture'] || null,
      });
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    return classifyLoraFromMetadata(fallbackMeta);
  }
}
