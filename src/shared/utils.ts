/**
 * Shared utility functions, formatting helpers, and UI constants.
 */

import type {
  GalleryFilterState,
  ImageRecord,
  ModelInventoryItem,
  QueuedGhostCardItem,
} from './types';

// ==========================================
// 1. Aspect Ratio Presets & Normalization
// ==========================================

export interface AspectRatioOption {
  value: string;
  shortRatio: string;
  short: string;
  label: string;
  boxW: number;
  boxH: number;
}

/**
 * Authoritative ComfyUI ResolutionSelector (Node #49) aspect_ratio options with display boxes.
 */
export const ASPECT_RATIO_PRESETS: AspectRatioOption[] = [
  { value: '1:1 (Square)', shortRatio: '1:1', short: '1:1', label: 'Square', boxW: 18, boxH: 18 },
  { value: '2:3 (Portrait Photo)', shortRatio: '2:3', short: '2:3', label: 'Portrait Photo', boxW: 14, boxH: 21 },
  { value: '3:2 (Photo)', shortRatio: '3:2', short: '3:2', label: 'Photo', boxW: 21, boxH: 14 },
  { value: '3:4 (Portrait Standard)', shortRatio: '3:4', short: '3:4', label: 'Portrait Std', boxW: 15, boxH: 20 },
  { value: '4:3 (Standard)', shortRatio: '4:3', short: '4:3', label: 'Standard', boxW: 20, boxH: 15 },
  { value: '9:16 (Portrait Widescreen)', shortRatio: '9:16', short: '9:16', label: 'Vertical Wide', boxW: 12, boxH: 22 },
  { value: '16:9 (Widescreen)', shortRatio: '16:9', short: '16:9', label: 'Widescreen', boxW: 22, boxH: 12 },
  { value: '21:9 (Ultrawide)', shortRatio: '21:9', short: '21:9', label: 'Ultrawide', boxW: 24, boxH: 10 },
];

export const RESOLUTION_SELECTOR_OPTIONS = ASPECT_RATIO_PRESETS;
export type ResolutionSelectorRatio = (typeof ASPECT_RATIO_PRESETS)[number]['value'];

export const MEGAPIXEL_PRESETS = [0.5, 1.0, 2.0, 3.0, 4.0, 8.0] as const;

/**
 * Normalizes any ratio string (shorthand, legacy label, or partial text) to the exact
 * string expected by ComfyUI's ResolutionSelector node.
 */
export function normalizeResolutionSelectorRatio(raw: string | undefined | null): string {
  const str = String(raw || '').trim();
  if (!str) return '2:3 (Portrait Photo)';

  // Exact match
  const exact = ASPECT_RATIO_PRESETS.find(
    (o) => o.value.toLowerCase() === str.toLowerCase()
  );
  if (exact) return exact.value;

  // Normalized digits e.g. "3:4", "3/4", "3x4"
  const match = str.match(/(\d+(?:\.\d+)?)\s*[:\/x]\s*(\d+(?:\.\d+)?)/i);
  if (match) {
    const num = `${match[1]}:${match[2]}`;
    const byShort = ASPECT_RATIO_PRESETS.find((o) => o.shortRatio === num);
    if (byShort) return byShort.value;
  }

  // Common descriptive aliases
  const lower = str.toLowerCase();
  if (lower.includes('square')) return '1:1 (Square)';
  if (lower.includes('ultrawide') || lower.includes('21:9')) return '21:9 (Ultrawide)';
  if (lower.includes('vertical') || lower.includes('9:16')) return '9:16 (Portrait Widescreen)';
  if (lower.includes('widescreen') || lower.includes('16:9')) return '16:9 (Widescreen)';
  if (lower.includes('golden') || (lower.includes('portrait') && lower.includes('3:4'))) return '3:4 (Portrait Standard)';
  if (lower.includes('portrait')) return '2:3 (Portrait Photo)';
  if (lower.includes('landscape') && lower.includes('3:2')) return '3:2 (Photo)';
  if (lower.includes('classic') || lower.includes('tv') || lower.includes('4:3')) return '4:3 (Standard)';

  return str;
}

/**
 * Calculates aspect ratio from pixel width and height and finds the closest
 * standard ComfyUI ResolutionSelector preset.
 */
export function resolveClosestAspectRatio(width: number, height: number): string {
  if (!width || !height || width <= 0 || height <= 0) {
    return '2:3 (Portrait Photo)';
  }

  const ratio = width / height;

  const presets: { value: string; ratio: number }[] = [
    { value: '1:1 (Square)', ratio: 1.0 },
    { value: '2:3 (Portrait Photo)', ratio: 2 / 3 },
    { value: '3:2 (Photo)', ratio: 3 / 2 },
    { value: '3:4 (Portrait Standard)', ratio: 3 / 4 },
    { value: '4:3 (Standard)', ratio: 4 / 3 },
    { value: '9:16 (Portrait Widescreen)', ratio: 9 / 16 },
    { value: '16:9 (Widescreen)', ratio: 16 / 9 },
    { value: '21:9 (Ultrawide)', ratio: 21 / 9 },
  ];

  let bestMatch = '2:3 (Portrait Photo)';
  let minDiff = Infinity;

  for (const item of presets) {
    const diff = Math.abs(Math.log(ratio / item.ratio));
    if (diff < minDiff) {
      minDiff = diff;
      bestMatch = item.value;
    }
  }

  return bestMatch;
}

/**
 * Returns a short aspect ratio string (e.g. "2:3", "16:9", "1:1") for given pixel dimensions.
 * Snaps to standard presets when within ~6% tolerance (accounting for 8/16px latent rounding),
 * otherwise reduces by greatest common divisor.
 */
export function formatImageAspectRatio(width: number, height: number): string {
  if (!width || !height || width <= 0 || height <= 0) return '';
  const ratio = width / height;
  const presets: { short: string; ratio: number }[] = [
    { short: '1:1', ratio: 1.0 },
    { short: '2:3', ratio: 2 / 3 },
    { short: '3:2', ratio: 3 / 2 },
    { short: '3:4', ratio: 3 / 4 },
    { short: '4:3', ratio: 4 / 3 },
    { short: '9:16', ratio: 9 / 16 },
    { short: '16:9', ratio: 16 / 9 },
    { short: '21:9', ratio: 21 / 9 },
  ];

  let bestShort = '';
  let minDiff = Infinity;
  for (const p of presets) {
    const diff = Math.abs(Math.log(ratio / p.ratio));
    if (diff < minDiff) {
      minDiff = diff;
      bestShort = p.short;
    }
  }
  if (minDiff < 0.06 && bestShort) {
    return bestShort;
  }

  const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));
  const divisor = gcd(Math.round(width), Math.round(height));
  return `${Math.round(width / divisor)}:${Math.round(height / divisor)}`;
}

// ==========================================
// 2. Byte & Data Size Formatting
// ==========================================

/**
 * Formats a byte count into human-readable B, KB, MB, or GB strings.
 */
export function formatBytes(bytes: number | null | undefined, fallback = 'Unknown size'): string {
  if (bytes === null || bytes === undefined || isNaN(bytes) || bytes < 0) {
    return fallback;
  }
  if (bytes === 0) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

/**
 * Formats bytes directly to Megabytes with 1 decimal place.
 */
export function formatMb(bytes: number | null | undefined): string {
  if (bytes === null || bytes === undefined || isNaN(bytes) || bytes < 0) return '0.0 MB';
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// ==========================================
// 3. Prompt Interpolation
// ==========================================

export interface PromptInterpolationVars {
  characterName?: string;
  loraSummary?: string;
  theme?: string;
  count?: number;
  basePrompt?: string;
}

/**
 * Interpolates prompt template placeholders: {character}, {lora}, {theme}, {count}, {base_prompt}
 * and cleans up dangling commas or duplicate whitespace.
 */
export function interpolatePrompt(template: string, vars: PromptInterpolationVars): string {
  let result = template;
  result = result.replace(/\{character\}/gi, vars.characterName || 'subject');
  result = result.replace(/\{lora\}/gi, vars.loraSummary || '');
  result = result.replace(/\{theme\}/gi, vars.theme || '');
  if (vars.count !== undefined) {
    result = result.replace(/\{count\}/gi, String(vars.count));
  }
  if (vars.basePrompt !== undefined) {
    result = result.replace(/\{base_prompt\}/gi, vars.basePrompt);
  }
  return result
    .replace(/,\s*,/g, ',')
    .replace(/\s{2,}/g, ' ')
    .replace(/^,\s*|\s*,\s*$/g, '')
    .trim();
}

// ==========================================
// 4. Model Inventory Filtering
// ==========================================

/**
 * Filters diffusion checkpoints from model inventory and optional checkpoint list.
 */
export function filterDiffusionModels(
  models: ModelInventoryItem[] = [],
  checkpoints: string[] = []
): string[] {
  const set = new Set<string>(checkpoints);
  for (const m of models) {
    if (
      m.modelType === 'checkpoint' ||
      m.modelType === 'diffusion' ||
      m.modelType === 'other'
    ) {
      if (m.filename) set.add(m.filename);
    }
  }
  return Array.from(set).filter(Boolean).sort();
}

/**
 * Filters LoRA model filenames from LoRA items and model inventory.
 */
export function filterLoraModels(
  loras: Array<{ filename?: string; name?: string }> = [],
  models: ModelInventoryItem[] = []
): string[] {
  const set = new Set<string>();
  for (const l of loras) {
    if (l.filename) set.add(l.filename);
    else if (l.name) set.add(l.name);
  }
  for (const m of models) {
    if (m.modelType === 'lora' && m.filename) {
      set.add(m.filename);
    }
  }
  return Array.from(set).filter(Boolean).sort();
}

/**
 * Filters VAE model filenames.
 */
export function filterVaeModels(models: ModelInventoryItem[] = []): string[] {
  const set = new Set<string>();
  for (const m of models) {
    if (
      m.modelType === 'vae' ||
      m.filename.toLowerCase().includes('vae') ||
      m.modelType === 'other'
    ) {
      if (m.filename) set.add(m.filename);
    }
  }
  return Array.from(set).filter(Boolean).sort();
}

/**
 * Filters CLIP / text-encoder model filenames.
 */
export function filterClipModels(models: ModelInventoryItem[] = []): string[] {
  const set = new Set<string>();
  for (const m of models) {
    if (
      m.filename.toLowerCase().includes('clip') ||
      m.filename.toLowerCase().includes('qwen') ||
      m.filename.toLowerCase().includes('t5') ||
      m.modelType === 'other' ||
      m.modelType === 'embedding'
    ) {
      if (m.filename) set.add(m.filename);
    }
  }
  return Array.from(set).filter(Boolean).sort();
}

// ==========================================
// 5. Default Workflow Resolution
// ==========================================

/**
 * Resolves the primary default workflow from a collection prioritizing:
 * 1. isDefault && hasApiWorkflow
 * 2. isDefault
 * 3. hasApiWorkflow
 * 4. First available workflow
 */
export function resolveDefaultWorkflow<
  T extends { id: number; isDefault?: boolean; hasApiWorkflow?: boolean }
>(workflows: T[] = []): T | null {
  if (!workflows || workflows.length === 0) return null;
  return (
    workflows.find((w) => w.isDefault && w.hasApiWorkflow) ||
    workflows.find((w) => w.isDefault) ||
    workflows.find((w) => w.hasApiWorkflow) ||
    workflows[0] ||
    null
  );
}

// ==========================================
// 6. Live Ghost Item & Series Matching
// ==========================================

/**
 * Returns true once a ghost's output image is already present as a card or series iteration in `images`.
 */
export function isGhostOutputInImages(
  ghost: Pick<QueuedGhostCardItem, 'outputImageId'>,
  images: Pick<ImageRecord, 'id' | 'seriesItems'>[]
): boolean {
  if (!ghost.outputImageId) return false;
  return images.some(
    (img) =>
      img.id === ghost.outputImageId ||
      Boolean(img.seriesItems?.some((si) => si.imageId === ghost.outputImageId))
  );
}

/**
 * Finds active queued/generating ghost items that will stack onto the given image or series card.
 * Middle-stack branches (`isBranchSplit`) start their own new stack/card and never attach to an existing card.
 */
export function findAttachedGhostsForImage(
  img: Pick<ImageRecord, 'id' | 'seriesId' | 'seriesItems'>,
  ghostItems: QueuedGhostCardItem[] = []
): QueuedGhostCardItem[] {
  if (!ghostItems || ghostItems.length === 0) return [];
  return ghostItems.filter((g) => {
    if (g.isBranchSplit) return false;
    if (g.targetSeriesId && img.seriesId && g.targetSeriesId === img.seriesId) {
      return true;
    }
    if (g.targetImageId) {
      if (g.targetImageId === img.id) return true;
      if (img.seriesItems?.some((si) => si.imageId === g.targetImageId)) return true;
    }
    return false;
  });
}

function normalizeStem(raw: string): string {
  return (raw || '')
    .trim()
    .replace(/^.*[\\/]/, '')
    .replace(/\.(safetensors|pt|ckpt|bin)$/i, '')
    .toLowerCase();
}

/**
 * Applies active Gallery filter and sort rules to standalone pending/queued ghost cards
 * (newest-first by default, matching the active gallery sort/filters).
 */
export function filterAndSortGhostItems(
  ghosts: QueuedGhostCardItem[],
  filters?: GalleryFilterState
): QueuedGhostCardItem[] {
  const filtered = filters
    ? ghosts.filter((g) => {
        // Pending jobs have no user annotations or archive/reject flags yet
        if (
          filters.favoritesOnly ||
          filters.minRating > 0 ||
          filters.tagIds.length > 0 ||
          filters.collectionId !== null ||
          filters.rejectedMode === 'only' ||
          filters.archivedMode === 'only' ||
          filters.dependencyStatus === 'incomplete' ||
          filters.dependencyStatus === 'unknown'
        ) {
          return false;
        }

        if (filters.characterIds.length > 0) {
          if (g.characterId == null || !filters.characterIds.includes(g.characterId)) {
            return false;
          }
        }

        if (filters.checkpoint) {
          const targetCkpt = normalizeStem(filters.checkpoint);
          const ghostCkpt = normalizeStem(g.checkpointName || '');
          if (!ghostCkpt || ghostCkpt !== targetCkpt) {
            return false;
          }
        }

        if (filters.loras.length > 0) {
          if (g.loraCount === 0) return false;
          if (g.loraNames && g.loraNames.length > 0) {
            const ghostLoraKeys = new Set(g.loraNames.map(normalizeStem));
            const matches =
              filters.loraMatchMode === 'ANY'
                ? filters.loras.some((l) => ghostLoraKeys.has(normalizeStem(l)))
                : filters.loras.every((l) => ghostLoraKeys.has(normalizeStem(l)));
            if (!matches) return false;
          }
        }

        if (filters.query && filters.query.trim()) {
          const q = filters.query.trim().replace(/^["']|["']$/g, '').toLowerCase();
          const haystack = [
            g.prompt,
            g.characterName || '',
            g.checkpointName || '',
            g.workflowName || '',
            ...(g.loraNames || []),
          ]
            .join(' ')
            .toLowerCase();
          if (!haystack.includes(q)) return false;
        }

        if (filters.dateFrom) {
          const createdMs = Date.parse(g.createdAt);
          const fromMs = Date.parse(filters.dateFrom);
          if (!Number.isNaN(createdMs) && !Number.isNaN(fromMs) && createdMs < fromMs) {
            return false;
          }
        }
        if (filters.dateTo) {
          const createdMs = Date.parse(g.createdAt);
          const toMs = Date.parse(`${filters.dateTo}T23:59:59.999Z`);
          if (!Number.isNaN(createdMs) && !Number.isNaN(toMs) && createdMs > toMs) {
            return false;
          }
        }

        return true;
      })
    : [...ghosts];

  const sortBy = filters?.sortBy || 'newest';
  const compareNewest = (a: QueuedGhostCardItem, b: QueuedGhostCardItem) => {
    const ta = Date.parse(a.createdAt) || 0;
    const tb = Date.parse(b.createdAt) || 0;
    if (tb !== ta) return tb - ta;
    if (b.batchId !== a.batchId) return b.batchId - a.batchId;
    return b.itemIndex - a.itemIndex;
  };

  return filtered.sort((a, b) => {
    switch (sortBy) {
      case 'oldest':
        return -compareNewest(a, b);
      case 'checkpoint':
        return (
          (a.checkpointName || 'zzz').localeCompare(b.checkpointName || 'zzz') ||
          compareNewest(a, b)
        );
      case 'filename':
        return (a.prompt || '').localeCompare(b.prompt || '') || compareNewest(a, b);
      case 'most_used_lora':
        return b.loraCount - a.loraCount || compareNewest(a, b);
      case 'newest':
      default:
        return compareNewest(a, b);
    }
  });
}
