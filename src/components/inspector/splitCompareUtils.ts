import type { ImageLoraRecord, ImageRecord } from '../../shared/types.ts';

export interface PromptDiffToken {
  type: 'same' | 'added' | 'removed';
  text: string;
}

export interface ParameterDiffRow {
  label: string;
  valueA: string;
  valueB: string;
}

export interface LoraDiffEntry {
  key: string;
  displayName: string;
  status: 'added' | 'removed' | 'changed';
  loraA?: ImageLoraRecord;
  loraB?: ImageLoraRecord;
}

export interface ImageMetadataDiff {
  hasAnyDiff: boolean;
  diffCategories: string[];
  promptDiffsDiffer: boolean;
  promptTokensA: PromptDiffToken[];
  promptTokensB: PromptDiffToken[];
  negativeDiffers: boolean;
  negativeA: string;
  negativeB: string;
  paramDiffs: ParameterDiffRow[];
  loraDiffs: LoraDiffEntry[];
}

function normalizeLoraBase(name: string): string {
  return name
    .trim()
    .replace(/\\/g, '/')
    .split('/')
    .pop()!
    .replace(/\.(safetensors|pt|ckpt|bin)$/i, '')
    .toLowerCase();
}

function formatMegapixels(w: number, h: number): string {
  if (!w || !h) return '—';
  const mp = (w * h) / 1_000_000;
  return `${w}×${h} (${mp.toFixed(1)} MP)`;
}

/**
 * Smart Series Pre-Fill: selects the previous iteration (or favorited poster / next step)
 * from the active image's series stack for instant Split Mode comparison.
 */
export function pickDefaultCompareImageId(activeImage: ImageRecord): number | null {
  const items = activeImage.seriesItems || [];
  if (items.length <= 1) return null;

  const activeIdx = items.findIndex((it) => it.imageId === activeImage.id);
  const poster = items.find((it) => it.isFavorite && it.imageId !== activeImage.id);

  // Prefer previous step in the stack when inspecting step #2+
  if (activeIdx > 0) {
    return items[activeIdx - 1].imageId;
  }

  // If inspecting step #1 (or unknown index), prefer the hearted poster if distinct, otherwise step #2
  if (poster) {
    return poster.imageId;
  }

  const fallback = items.find((it) => it.imageId !== activeImage.id);
  return fallback ? fallback.imageId : null;
}

/**
 * Word-level LCS diff between two prompt strings so tweaked phrases stand out clearly.
 */
export function computePromptWordDiff(
  textA: string,
  textB: string
): { tokensA: PromptDiffToken[]; tokensB: PromptDiffToken[]; differs: boolean } {
  const cleanA = (textA || '').trim();
  const cleanB = (textB || '').trim();
  if (cleanA === cleanB) {
    return {
      tokensA: cleanA ? [{ type: 'same', text: cleanA }] : [],
      tokensB: cleanB ? [{ type: 'same', text: cleanB }] : [],
      differs: false,
    };
  }

  const wordsA = cleanA ? cleanA.split(/\s+/) : [];
  const wordsB = cleanB ? cleanB.split(/\s+/) : [];

  // Fallback to simple whole-block markers for unusually long prompts (> 350 tokens)
  if (wordsA.length > 350 || wordsB.length > 350) {
    return {
      tokensA: cleanA ? [{ type: 'removed', text: cleanA }] : [],
      tokensB: cleanB ? [{ type: 'added', text: cleanB }] : [],
      differs: true,
    };
  }

  const n = wordsA.length;
  const m = wordsB.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));

  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      if (wordsA[i] === wordsB[j]) {
        dp[i][j] = 1 + dp[i + 1][j + 1];
      } else {
        dp[i][j] = Math.max(dp[i + 1][j], dp[i][j + 1]);
      }
    }
  }

  const tokensA: PromptDiffToken[] = [];
  const tokensB: PromptDiffToken[] = [];

  const pushMerged = (arr: PromptDiffToken[], type: PromptDiffToken['type'], word: string) => {
    const prev = arr[arr.length - 1];
    if (prev && prev.type === type) {
      prev.text = `${prev.text} ${word}`;
    } else {
      arr.push({ type, text: word });
    }
  };

  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (wordsA[i] === wordsB[j]) {
      pushMerged(tokensA, 'same', wordsA[i]);
      pushMerged(tokensB, 'same', wordsB[j]);
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      pushMerged(tokensA, 'removed', wordsA[i]);
      i++;
    } else {
      pushMerged(tokensB, 'added', wordsB[j]);
      j++;
    }
  }
  while (i < n) {
    pushMerged(tokensA, 'removed', wordsA[i]);
    i++;
  }
  while (j < m) {
    pushMerged(tokensB, 'added', wordsB[j]);
    j++;
  }

  return { tokensA, tokensB, differs: true };
}

/**
 * Computes a diff-focused comparison between Image A and Image B across prompts,
 * generation parameters, resolution, and LoRA chains.
 */
export function computeImageMetadataDiff(
  imageA: ImageRecord,
  imageB: ImageRecord
): ImageMetadataDiff {
  const promptDiff = computePromptWordDiff(
    imageA.positivePrompt || '',
    imageB.positivePrompt || ''
  );

  const negativeA = (imageA.negativePrompt || '').trim();
  const negativeB = (imageB.negativePrompt || '').trim();
  const negativeDiffers = negativeA !== negativeB;

  const paramDiffs: ParameterDiffRow[] = [];
  const pushIfDiff = (label: string, rawA: unknown, rawB: unknown) => {
    const valA = rawA !== null && rawA !== undefined && String(rawA).trim() !== '' ? String(rawA) : '—';
    const valB = rawB !== null && rawB !== undefined && String(rawB).trim() !== '' ? String(rawB) : '—';
    if (valA !== valB) {
      paramDiffs.push({ label, valueA: valA, valueB: valB });
    }
  };

  const resA = formatMegapixels(imageA.width, imageA.height);
  const resB = formatMegapixels(imageB.width, imageB.height);
  if (resA !== resB) {
    paramDiffs.push({ label: 'Resolution', valueA: resA, valueB: resB });
  }

  pushIfDiff('Checkpoint', imageA.checkpointName, imageB.checkpointName);
  pushIfDiff('VAE', imageA.vaeName, imageB.vaeName);
  pushIfDiff('Seed', imageA.seed, imageB.seed);
  pushIfDiff('Steps', imageA.steps, imageB.steps);
  pushIfDiff('CFG', imageA.cfg, imageB.cfg);
  pushIfDiff('Sampler', imageA.sampler, imageB.sampler);
  pushIfDiff('Scheduler', imageA.scheduler, imageB.scheduler);
  pushIfDiff('Denoise', imageA.denoise, imageB.denoise);

  // LoRA comparison matched by normalized filename
  const mapA = new Map<string, ImageLoraRecord>();
  const mapB = new Map<string, ImageLoraRecord>();
  for (const l of imageA.loras || []) {
    mapA.set(normalizeLoraBase(l.loraName), l);
  }
  for (const l of imageB.loras || []) {
    mapB.set(normalizeLoraBase(l.loraName), l);
  }

  const allLoraKeys = new Set<string>([...mapA.keys(), ...mapB.keys()]);
  const loraDiffs: LoraDiffEntry[] = [];
  for (const key of allLoraKeys) {
    const lA = mapA.get(key);
    const lB = mapB.get(key);
    const displayName = (lA?.loraName || lB?.loraName || key)
      .replace(/\\/g, '/')
      .split('/')
      .pop()!;

    if (lA && !lB) {
      loraDiffs.push({ key, displayName, status: 'removed', loraA: lA });
    } else if (!lA && lB) {
      loraDiffs.push({ key, displayName, status: 'added', loraB: lB });
    } else if (lA && lB) {
      const mSame = Number(lA.modelStrength).toFixed(2) === Number(lB.modelStrength).toFixed(2);
      const cSame = Number(lA.clipStrength).toFixed(2) === Number(lB.clipStrength).toFixed(2);
      if (!mSame || !cSame) {
        loraDiffs.push({ key, displayName, status: 'changed', loraA: lA, loraB: lB });
      }
    }
  }

  const diffCategories: string[] = [];
  if (promptDiff.differs) diffCategories.push('Prompt');
  if (negativeDiffers) diffCategories.push('Negative');
  if (loraDiffs.length > 0) {
    diffCategories.push(`${loraDiffs.length} LoRA${loraDiffs.length === 1 ? '' : 's'}`);
  }
  for (const p of paramDiffs) {
    if (diffCategories.length < 5) {
      diffCategories.push(p.label);
    }
  }

  return {
    hasAnyDiff:
      promptDiff.differs ||
      negativeDiffers ||
      paramDiffs.length > 0 ||
      loraDiffs.length > 0,
    diffCategories,
    promptDiffsDiffer: promptDiff.differs,
    promptTokensA: promptDiff.tokensA,
    promptTokensB: promptDiff.tokensB,
    negativeDiffers,
    negativeA,
    negativeB,
    paramDiffs,
    loraDiffs,
  };
}
