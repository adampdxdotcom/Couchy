import type {
  CustomizableLoraCategory,
  LoraCategory,
  PillColorKey,
  PillEntityType,
  PillTypeSettings,
  PresetPillColorKey,
} from './types.ts';

export const DEFAULT_PILL_TYPE_SETTINGS: PillTypeSettings = {
  character: { color: 'indigo', insertMentionName: false },
  baseModel: { color: 'emerald', insertMentionName: false },
  lora: { color: 'amber', insertMentionName: false },
  loraCategoryColors: {},
};

export const CUSTOMIZABLE_LORA_CATEGORIES: Array<{
  key: CustomizableLoraCategory;
  label: string;
}> = [
  { key: 'style', label: 'Style' },
  { key: 'clothing', label: 'Clothing' },
  { key: 'pose', label: 'Pose' },
  { key: 'concept', label: 'Concept' },
  { key: 'object', label: 'Object' },
  { key: 'other', label: 'Other' },
  { key: 'unclassified', label: 'Unclassified' },
];

export const LORA_CATEGORY_OPTIONS: Array<{
  value: LoraCategory;
  label: string;
}> = [
  { value: 'unclassified', label: 'Unclassified' },
  { value: 'character', label: 'Character' },
  { value: 'style', label: 'Style' },
  { value: 'clothing', label: 'Clothing / Outfit' },
  { value: 'pose', label: 'Pose' },
  { value: 'concept', label: 'Concept' },
  { value: 'object', label: 'Object' },
  { value: 'other', label: 'Other' },
];

export const VALID_LORA_CATEGORIES = new Set<LoraCategory>(
  LORA_CATEGORY_OPTIONS.map((opt) => opt.value)
);

export interface PillColorStyleSet {
  label: string;
  swatchBg: string;
  pill: string;
  pillHover: string;
  pillSelected: string;
  pillDisabledCap: string;
  rowSelected: string;
  icon: string;
  iconBg: string;
  textAccent: string;
  textLight: string;
  removeButton: string;
  strengthText: string;
  strengthInput: string;
  checkIcon: string;
  badge: string;
}

/**
 * Static Tailwind class sets per PillColorKey so Tailwind JIT preserves every utility class.
 */
export const PILL_COLOR_STYLES: Record<PillColorKey, PillColorStyleSet> = {
  indigo: {
    label: 'Indigo',
    swatchBg: 'bg-indigo-500',
    pill: 'bg-indigo-950/70 border-indigo-500/40 text-indigo-200',
    pillHover:
      'bg-indigo-950/70 border-indigo-500/40 text-indigo-200 hover:border-indigo-400/70 hover:bg-indigo-950/90 cursor-pointer',
    pillSelected:
      'bg-indigo-600/35 border-indigo-400 text-indigo-100 ring-1 ring-indigo-400/50 cursor-pointer',
    pillDisabledCap:
      'bg-indigo-950/35 border-indigo-500/20 text-indigo-200/50 opacity-55 cursor-not-allowed',
    rowSelected: 'border-indigo-500/50 bg-indigo-950/20',
    icon: 'text-indigo-400',
    iconBg: 'bg-indigo-500/10 text-indigo-400 border-indigo-500/30',
    textAccent: 'text-indigo-300/90',
    textLight: 'text-indigo-100',
    removeButton: 'text-indigo-300/70 hover:text-white',
    strengthText: 'text-indigo-300/90 hover:text-white',
    strengthInput: 'bg-indigo-900/60 text-indigo-100 ring-indigo-400/60',
    checkIcon: 'text-indigo-200',
    badge: 'bg-indigo-400/10 text-indigo-300 border-indigo-400/20',
  },
  emerald: {
    label: 'Emerald',
    swatchBg: 'bg-emerald-500',
    pill: 'bg-emerald-950/60 border-emerald-500/40 text-emerald-200',
    pillHover:
      'bg-emerald-950/60 border-emerald-500/40 text-emerald-200 hover:border-emerald-400/70 hover:bg-emerald-950/80 cursor-pointer',
    pillSelected:
      'bg-emerald-600/30 border-emerald-400 text-emerald-100 ring-1 ring-emerald-400/50 cursor-pointer',
    pillDisabledCap:
      'bg-emerald-950/30 border-emerald-500/20 text-emerald-200/50 opacity-55 cursor-not-allowed',
    rowSelected: 'border-emerald-500/50 bg-emerald-950/15',
    icon: 'text-emerald-400',
    iconBg: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30',
    textAccent: 'text-emerald-300/90',
    textLight: 'text-emerald-100',
    removeButton: 'text-emerald-300/70 hover:text-white',
    strengthText: 'text-emerald-300/90 hover:text-white',
    strengthInput: 'bg-emerald-900/55 text-emerald-100 ring-emerald-400/60',
    checkIcon: 'text-emerald-300',
    badge: 'bg-emerald-400/10 text-emerald-300 border-emerald-400/20',
  },
  amber: {
    label: 'Amber',
    swatchBg: 'bg-amber-500',
    pill: 'bg-amber-950/60 border-amber-500/40 text-amber-200',
    pillHover:
      'bg-amber-950/60 border-amber-500/40 text-amber-200 hover:border-amber-400/70 hover:bg-amber-950/80 cursor-pointer',
    pillSelected:
      'bg-amber-600/30 border-amber-400 text-amber-100 ring-1 ring-amber-400/50 cursor-pointer',
    pillDisabledCap:
      'bg-amber-950/30 border-amber-500/20 text-amber-200/50 opacity-55 cursor-not-allowed',
    rowSelected: 'border-amber-500/50 bg-amber-950/15',
    icon: 'text-amber-400',
    iconBg: 'bg-amber-500/10 text-amber-400 border-amber-500/30',
    textAccent: 'text-amber-300/90',
    textLight: 'text-amber-100',
    removeButton: 'text-amber-300/70 hover:text-white',
    strengthText: 'text-amber-300/90 hover:text-amber-100',
    strengthInput: 'bg-amber-900/50 text-amber-100 ring-amber-400/60',
    checkIcon: 'text-amber-200',
    badge: 'bg-amber-400/10 text-amber-300 border-amber-400/20',
  },
  sky: {
    label: 'Sky',
    swatchBg: 'bg-sky-500',
    pill: 'bg-sky-950/65 border-sky-500/40 text-sky-200',
    pillHover:
      'bg-sky-950/65 border-sky-500/40 text-sky-200 hover:border-sky-400/70 hover:bg-sky-950/85 cursor-pointer',
    pillSelected:
      'bg-sky-600/30 border-sky-400 text-sky-100 ring-1 ring-sky-400/50 cursor-pointer',
    pillDisabledCap:
      'bg-sky-950/30 border-sky-500/20 text-sky-200/50 opacity-55 cursor-not-allowed',
    rowSelected: 'border-sky-500/50 bg-sky-950/15',
    icon: 'text-sky-400',
    iconBg: 'bg-sky-500/10 text-sky-400 border-sky-500/30',
    textAccent: 'text-sky-300/90',
    textLight: 'text-sky-100',
    removeButton: 'text-sky-300/70 hover:text-white',
    strengthText: 'text-sky-300/90 hover:text-white',
    strengthInput: 'bg-sky-900/55 text-sky-100 ring-sky-400/60',
    checkIcon: 'text-sky-200',
    badge: 'bg-sky-400/10 text-sky-300 border-sky-400/20',
  },
  rose: {
    label: 'Rose',
    swatchBg: 'bg-rose-500',
    pill: 'bg-rose-950/65 border-rose-500/40 text-rose-200',
    pillHover:
      'bg-rose-950/65 border-rose-500/40 text-rose-200 hover:border-rose-400/70 hover:bg-rose-950/85 cursor-pointer',
    pillSelected:
      'bg-rose-600/30 border-rose-400 text-rose-100 ring-1 ring-rose-400/50 cursor-pointer',
    pillDisabledCap:
      'bg-rose-950/30 border-rose-500/20 text-rose-200/50 opacity-55 cursor-not-allowed',
    rowSelected: 'border-rose-500/50 bg-rose-950/15',
    icon: 'text-rose-400',
    iconBg: 'bg-rose-500/10 text-rose-400 border-rose-500/30',
    textAccent: 'text-rose-300/90',
    textLight: 'text-rose-100',
    removeButton: 'text-rose-300/70 hover:text-white',
    strengthText: 'text-rose-300/90 hover:text-white',
    strengthInput: 'bg-rose-900/55 text-rose-100 ring-rose-400/60',
    checkIcon: 'text-rose-200',
    badge: 'bg-rose-400/10 text-rose-300 border-rose-400/20',
  },
  violet: {
    label: 'Violet',
    swatchBg: 'bg-violet-500',
    pill: 'bg-violet-950/65 border-violet-500/40 text-violet-200',
    pillHover:
      'bg-violet-950/65 border-violet-500/40 text-violet-200 hover:border-violet-400/70 hover:bg-violet-950/85 cursor-pointer',
    pillSelected:
      'bg-violet-600/30 border-violet-400 text-violet-100 ring-1 ring-violet-400/50 cursor-pointer',
    pillDisabledCap:
      'bg-violet-950/30 border-violet-500/20 text-violet-200/50 opacity-55 cursor-not-allowed',
    rowSelected: 'border-violet-500/50 bg-violet-950/15',
    icon: 'text-violet-400',
    iconBg: 'bg-violet-500/10 text-violet-400 border-violet-500/30',
    textAccent: 'text-violet-300/90',
    textLight: 'text-violet-100',
    removeButton: 'text-violet-300/70 hover:text-white',
    strengthText: 'text-violet-300/90 hover:text-white',
    strengthInput: 'bg-violet-900/55 text-violet-100 ring-violet-400/60',
    checkIcon: 'text-violet-200',
    badge: 'bg-violet-400/10 text-violet-300 border-violet-400/20',
  },
  teal: {
    label: 'Teal',
    swatchBg: 'bg-teal-500',
    pill: 'bg-teal-950/65 border-teal-500/40 text-teal-200',
    pillHover:
      'bg-teal-950/65 border-teal-500/40 text-teal-200 hover:border-teal-400/70 hover:bg-teal-950/85 cursor-pointer',
    pillSelected:
      'bg-teal-600/30 border-teal-400 text-teal-100 ring-1 ring-teal-400/50 cursor-pointer',
    pillDisabledCap:
      'bg-teal-950/30 border-teal-500/20 text-teal-200/50 opacity-55 cursor-not-allowed',
    rowSelected: 'border-teal-500/50 bg-teal-950/15',
    icon: 'text-teal-400',
    iconBg: 'bg-teal-500/10 text-teal-400 border-teal-500/30',
    textAccent: 'text-teal-300/90',
    textLight: 'text-teal-100',
    removeButton: 'text-teal-300/70 hover:text-white',
    strengthText: 'text-teal-300/90 hover:text-white',
    strengthInput: 'bg-teal-900/55 text-teal-100 ring-teal-400/60',
    checkIcon: 'text-teal-200',
    badge: 'bg-teal-400/10 text-teal-300 border-teal-400/20',
  },
  zinc: {
    label: 'Neutral',
    swatchBg: 'bg-zinc-500',
    pill: 'bg-zinc-800/90 border-zinc-700/80 text-zinc-200',
    pillHover:
      'bg-zinc-800/90 border-zinc-700/80 text-zinc-200 hover:border-zinc-500 hover:bg-zinc-800 cursor-pointer',
    pillSelected:
      'bg-zinc-700 border-zinc-400 text-zinc-100 ring-1 ring-zinc-400/50 cursor-pointer',
    pillDisabledCap:
      'bg-zinc-900 border-zinc-800 text-zinc-400/50 opacity-55 cursor-not-allowed',
    rowSelected: 'border-zinc-600 bg-zinc-900/80',
    icon: 'text-zinc-400',
    iconBg: 'bg-zinc-800 text-zinc-300 border-zinc-700',
    textAccent: 'text-zinc-300',
    textLight: 'text-zinc-100',
    removeButton: 'text-zinc-400 hover:text-white',
    strengthText: 'text-zinc-300 hover:text-white',
    strengthInput: 'bg-zinc-800 text-zinc-100 ring-zinc-400/60',
    checkIcon: 'text-zinc-200',
    badge: 'bg-zinc-800 text-zinc-300 border-zinc-700',
  },
};

export const PILL_COLOR_OPTIONS: PillColorKey[] = [
  'indigo',
  'emerald',
  'amber',
  'sky',
  'rose',
  'violet',
  'teal',
  'zinc',
];

const VALID_COLOR_SET = new Set<string>(PILL_COLOR_OPTIONS);
const ENTITY_KEYS: PillEntityType[] = ['character', 'baseModel', 'lora'];
const VALID_CUSTOM_CATEGORY_SET = new Set<string>(
  CUSTOMIZABLE_LORA_CATEGORIES.map((c) => c.key)
);

export function normalizePillTypeSettings(raw: unknown): PillTypeSettings {
  const input = raw && typeof raw === 'object' ? (raw as Record<string, any>) : {};
  const result: PillTypeSettings = {
    character: { ...DEFAULT_PILL_TYPE_SETTINGS.character },
    baseModel: { ...DEFAULT_PILL_TYPE_SETTINGS.baseModel },
    lora: { ...DEFAULT_PILL_TYPE_SETTINGS.lora },
    loraCategoryColors: {},
  };

  for (const entity of ENTITY_KEYS) {
    const entry = input[entity];
    if (entry && typeof entry === 'object') {
      if (typeof entry.color === 'string' && VALID_COLOR_SET.has(entry.color)) {
        result[entity].color = entry.color as PillColorKey;
      }
      if (typeof entry.insertMentionName === 'boolean') {
        result[entity].insertMentionName = entry.insertMentionName;
      }
    }
  }

  if (input.loraCategoryColors && typeof input.loraCategoryColors === 'object') {
    const normalizedCategories: Partial<Record<CustomizableLoraCategory, PillColorKey>> = {};
    for (const [catKey, colorVal] of Object.entries(input.loraCategoryColors)) {
      if (
        VALID_CUSTOM_CATEGORY_SET.has(catKey) &&
        typeof colorVal === 'string' &&
        VALID_COLOR_SET.has(colorVal)
      ) {
        normalizedCategories[catKey as CustomizableLoraCategory] = colorVal as PillColorKey;
      }
    }
    result.loraCategoryColors = normalizedCategories;
  }

  return result;
}

/**
 * Resolves the active PillColorKey for a LoRA category:
 * - 'character' always mirrors the Characters pill color.
 * - Other categories use their configured override if set, falling back to the base LoRA color.
 */
export function resolveLoraCategoryColorKey(
  category: LoraCategory | null | undefined,
  settings: PillTypeSettings = DEFAULT_PILL_TYPE_SETTINGS
): PillColorKey {
  if (category === 'character') {
    return settings.character.color;
  }
  if (category && settings.loraCategoryColors) {
    const override = settings.loraCategoryColors[category as CustomizableLoraCategory];
    if (override && VALID_COLOR_SET.has(override)) {
      return override;
    }
  }
  return settings.lora.color;
}

/** Resolves the static Tailwind class set for a LoRA based on its category and pill settings. */
export function resolveLoraCategoryStyle(
  category: LoraCategory | null | undefined,
  settings: PillTypeSettings = DEFAULT_PILL_TYPE_SETTINGS
): PillColorStyleSet {
  return PILL_COLOR_STYLES[resolveLoraCategoryColorKey(category, settings)];
}

/**
 * Distinct Tailwind class sets reserved exclusively for LoRA Presets so they never blend
 * visually with Character, Base Model, or individual LoRA pills.
 */
export const PRESET_PILL_COLOR_STYLES: Record<PresetPillColorKey, PillColorStyleSet> = {
  fuchsia: {
    label: 'Fuchsia',
    swatchBg: 'bg-fuchsia-500',
    pill: 'bg-fuchsia-950/70 border-fuchsia-500/50 text-fuchsia-200',
    pillHover:
      'bg-fuchsia-950/70 border-fuchsia-500/50 text-fuchsia-200 hover:border-fuchsia-400/80 hover:bg-fuchsia-950/90 cursor-pointer',
    pillSelected:
      'bg-fuchsia-600/35 border-fuchsia-400 text-fuchsia-100 ring-1 ring-fuchsia-400/60 cursor-pointer',
    pillDisabledCap:
      'bg-fuchsia-950/30 border-fuchsia-500/20 text-fuchsia-200/50 opacity-55 cursor-not-allowed',
    rowSelected: 'border-fuchsia-500/50 bg-fuchsia-950/20',
    icon: 'text-fuchsia-400',
    iconBg: 'bg-fuchsia-500/15 text-fuchsia-300 border-fuchsia-500/35',
    textAccent: 'text-fuchsia-300',
    textLight: 'text-fuchsia-100',
    removeButton: 'text-fuchsia-300/75 hover:text-white',
    strengthText: 'text-fuchsia-300 hover:text-white',
    strengthInput: 'bg-fuchsia-900/60 text-fuchsia-100 ring-fuchsia-400/60',
    checkIcon: 'text-fuchsia-200',
    badge: 'bg-fuchsia-400/15 text-fuchsia-300 border-fuchsia-400/30',
  },
  cyan: {
    label: 'Cyan',
    swatchBg: 'bg-cyan-500',
    pill: 'bg-cyan-950/70 border-cyan-500/50 text-cyan-200',
    pillHover:
      'bg-cyan-950/70 border-cyan-500/50 text-cyan-200 hover:border-cyan-400/80 hover:bg-cyan-950/90 cursor-pointer',
    pillSelected:
      'bg-cyan-600/35 border-cyan-400 text-cyan-100 ring-1 ring-cyan-400/60 cursor-pointer',
    pillDisabledCap:
      'bg-cyan-950/30 border-cyan-500/20 text-cyan-200/50 opacity-55 cursor-not-allowed',
    rowSelected: 'border-cyan-500/50 bg-cyan-950/20',
    icon: 'text-cyan-400',
    iconBg: 'bg-cyan-500/15 text-cyan-300 border-cyan-500/35',
    textAccent: 'text-cyan-300',
    textLight: 'text-cyan-100',
    removeButton: 'text-cyan-300/75 hover:text-white',
    strengthText: 'text-cyan-300 hover:text-white',
    strengthInput: 'bg-cyan-900/60 text-cyan-100 ring-cyan-400/60',
    checkIcon: 'text-cyan-200',
    badge: 'bg-cyan-400/15 text-cyan-300 border-cyan-400/30',
  },
  orange: {
    label: 'Orange',
    swatchBg: 'bg-orange-500',
    pill: 'bg-orange-950/70 border-orange-500/50 text-orange-200',
    pillHover:
      'bg-orange-950/70 border-orange-500/50 text-orange-200 hover:border-orange-400/80 hover:bg-orange-950/90 cursor-pointer',
    pillSelected:
      'bg-orange-600/35 border-orange-400 text-orange-100 ring-1 ring-orange-400/60 cursor-pointer',
    pillDisabledCap:
      'bg-orange-950/30 border-orange-500/20 text-orange-200/50 opacity-55 cursor-not-allowed',
    rowSelected: 'border-orange-500/50 bg-orange-950/20',
    icon: 'text-orange-400',
    iconBg: 'bg-orange-500/15 text-orange-300 border-orange-500/35',
    textAccent: 'text-orange-300',
    textLight: 'text-orange-100',
    removeButton: 'text-orange-300/75 hover:text-white',
    strengthText: 'text-orange-300 hover:text-white',
    strengthInput: 'bg-orange-900/60 text-orange-100 ring-orange-400/60',
    checkIcon: 'text-orange-200',
    badge: 'bg-orange-400/15 text-orange-300 border-orange-400/30',
  },
  lime: {
    label: 'Lime',
    swatchBg: 'bg-lime-500',
    pill: 'bg-lime-950/70 border-lime-500/50 text-lime-200',
    pillHover:
      'bg-lime-950/70 border-lime-500/50 text-lime-200 hover:border-lime-400/80 hover:bg-lime-950/90 cursor-pointer',
    pillSelected:
      'bg-lime-600/35 border-lime-400 text-lime-100 ring-1 ring-lime-400/60 cursor-pointer',
    pillDisabledCap:
      'bg-lime-950/30 border-lime-500/20 text-lime-200/50 opacity-55 cursor-not-allowed',
    rowSelected: 'border-lime-500/50 bg-lime-950/20',
    icon: 'text-lime-400',
    iconBg: 'bg-lime-500/15 text-lime-300 border-lime-500/35',
    textAccent: 'text-lime-300',
    textLight: 'text-lime-100',
    removeButton: 'text-lime-300/75 hover:text-white',
    strengthText: 'text-lime-300 hover:text-white',
    strengthInput: 'bg-lime-900/60 text-lime-100 ring-lime-400/60',
    checkIcon: 'text-lime-200',
    badge: 'bg-lime-400/15 text-lime-300 border-lime-400/30',
  },
  pink: {
    label: 'Pink',
    swatchBg: 'bg-pink-500',
    pill: 'bg-pink-950/70 border-pink-500/50 text-pink-200',
    pillHover:
      'bg-pink-950/70 border-pink-500/50 text-pink-200 hover:border-pink-400/80 hover:bg-pink-950/90 cursor-pointer',
    pillSelected:
      'bg-pink-600/35 border-pink-400 text-pink-100 ring-1 ring-pink-400/60 cursor-pointer',
    pillDisabledCap:
      'bg-pink-950/30 border-pink-500/20 text-pink-200/50 opacity-55 cursor-not-allowed',
    rowSelected: 'border-pink-500/50 bg-pink-950/20',
    icon: 'text-pink-400',
    iconBg: 'bg-pink-500/15 text-pink-300 border-pink-500/35',
    textAccent: 'text-pink-300',
    textLight: 'text-pink-100',
    removeButton: 'text-pink-300/75 hover:text-white',
    strengthText: 'text-pink-300 hover:text-white',
    strengthInput: 'bg-pink-900/60 text-pink-100 ring-pink-400/60',
    checkIcon: 'text-pink-200',
    badge: 'bg-pink-400/15 text-pink-300 border-pink-400/30',
  },
  purple: {
    label: 'Purple',
    swatchBg: 'bg-purple-500',
    pill: 'bg-purple-950/70 border-purple-500/50 text-purple-200',
    pillHover:
      'bg-purple-950/70 border-purple-500/50 text-purple-200 hover:border-purple-400/80 hover:bg-purple-950/90 cursor-pointer',
    pillSelected:
      'bg-purple-600/35 border-purple-400 text-purple-100 ring-1 ring-purple-400/60 cursor-pointer',
    pillDisabledCap:
      'bg-purple-950/30 border-purple-500/20 text-purple-200/50 opacity-55 cursor-not-allowed',
    rowSelected: 'border-purple-500/50 bg-purple-950/20',
    icon: 'text-purple-400',
    iconBg: 'bg-purple-500/15 text-purple-300 border-purple-500/35',
    textAccent: 'text-purple-300',
    textLight: 'text-purple-100',
    removeButton: 'text-purple-300/75 hover:text-white',
    strengthText: 'text-purple-300 hover:text-white',
    strengthInput: 'bg-purple-900/60 text-purple-100 ring-purple-400/60',
    checkIcon: 'text-purple-200',
    badge: 'bg-purple-400/15 text-purple-300 border-purple-400/30',
  },
};

export const PRESET_PILL_COLOR_OPTIONS: PresetPillColorKey[] = [
  'fuchsia',
  'cyan',
  'orange',
  'lime',
  'pink',
  'purple',
];

const VALID_PRESET_COLOR_SET = new Set<string>(PRESET_PILL_COLOR_OPTIONS);

export function normalizePresetPillColor(color?: string | null): PresetPillColorKey {
  if (color && VALID_PRESET_COLOR_SET.has(color)) {
    return color as PresetPillColorKey;
  }
  return 'fuchsia';
}

export function resolvePresetPillStyle(color?: string | null): PillColorStyleSet {
  return PRESET_PILL_COLOR_STYLES[normalizePresetPillColor(color)];
}
