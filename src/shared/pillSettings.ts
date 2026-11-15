import type { PillColorKey, PillEntityType, PillTypeSettings } from './types.ts';

export const DEFAULT_PILL_TYPE_SETTINGS: PillTypeSettings = {
  character: { color: 'indigo', insertMentionName: false },
  baseModel: { color: 'emerald', insertMentionName: false },
  lora: { color: 'amber', insertMentionName: false },
};

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

export function normalizePillTypeSettings(raw: unknown): PillTypeSettings {
  const input = raw && typeof raw === 'object' ? (raw as Record<string, any>) : {};
  const result: PillTypeSettings = {
    character: { ...DEFAULT_PILL_TYPE_SETTINGS.character },
    baseModel: { ...DEFAULT_PILL_TYPE_SETTINGS.baseModel },
    lora: { ...DEFAULT_PILL_TYPE_SETTINGS.lora },
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
  return result;
}
