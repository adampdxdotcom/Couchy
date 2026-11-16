import React from 'react';
import { Check, Cpu, Layers, RotateCcw, Sparkles, User } from 'lucide-react';
import {
  CUSTOMIZABLE_LORA_CATEGORIES,
  DEFAULT_PILL_TYPE_SETTINGS,
  PILL_COLOR_OPTIONS,
  PILL_COLOR_STYLES,
  resolveLoraCategoryStyle,
} from '../../shared/pillSettings.ts';
import type {
  CustomizableLoraCategory,
  PillColorKey,
  PillEntityType,
  PillTypeBehavior,
  PillTypeSettings,
} from '../../shared/types.ts';

interface QuickGenAndPillsSectionProps {
  quickGenBoxEnabled: boolean;
  galleryPillColorsEnabled: boolean;
  pillTypeSettings: PillTypeSettings;
  onToggleQuickGenBox: (enabled: boolean) => Promise<void>;
  onToggleGalleryPillColors: (enabled: boolean) => Promise<void>;
  onUpdatePillTypeSettings: (next: PillTypeSettings) => Promise<void>;
}

const ENTITY_META: {
  key: PillEntityType;
  label: string;
  description: string;
  sampleLabel: string;
  icon: React.FC<{ className?: string }>;
}[] = [
  {
    key: 'character',
    label: 'Characters',
    description:
      'Character attachments, Friends pills, and Character-categorized LoRA pills in Quick Gen & Gallery.',
    sampleLabel: 'Elena',
    icon: User,
  },
  {
    key: 'baseModel',
    label: 'Base Models',
    description: 'Checkpoint / base model pills across Quick Gen, Gallery cards, and Character Addons.',
    sampleLabel: 'Illustrious XL',
    icon: Cpu,
  },
  {
    key: 'lora',
    label: 'LoRAs (Default)',
    description: 'Default color for style, pose, clothing, and addon LoRA pills unless overridden below.',
    sampleLabel: 'Detail Tweaker',
    icon: Layers,
  },
];

function isDefaultPillSettings(settings: PillTypeSettings): boolean {
  const hasCategoryOverrides =
    Object.keys(settings.loraCategoryColors || {}).length > 0;
  return (
    !hasCategoryOverrides &&
    settings.character.color === DEFAULT_PILL_TYPE_SETTINGS.character.color &&
    settings.character.insertMentionName === DEFAULT_PILL_TYPE_SETTINGS.character.insertMentionName &&
    settings.baseModel.color === DEFAULT_PILL_TYPE_SETTINGS.baseModel.color &&
    settings.baseModel.insertMentionName === DEFAULT_PILL_TYPE_SETTINGS.baseModel.insertMentionName &&
    settings.lora.color === DEFAULT_PILL_TYPE_SETTINGS.lora.color &&
    settings.lora.insertMentionName === DEFAULT_PILL_TYPE_SETTINGS.lora.insertMentionName
  );
}

/**
 * System settings tab controlling Floating Quick Gen, Gallery Pill Colors,
 * and per-model-type pill color & @mention text insertion behavior.
 */
export const QuickGenAndPillsSection: React.FC<QuickGenAndPillsSectionProps> = ({
  quickGenBoxEnabled,
  galleryPillColorsEnabled,
  pillTypeSettings,
  onToggleQuickGenBox,
  onToggleGalleryPillColors,
  onUpdatePillTypeSettings,
}) => {
  const handleChangeEntity = (
    entity: PillEntityType,
    patch: Partial<PillTypeBehavior>
  ) => {
    onUpdatePillTypeSettings({
      ...pillTypeSettings,
      [entity]: {
        ...pillTypeSettings[entity],
        ...patch,
      },
    });
  };

  const handleChangeCategoryColor = (
    category: CustomizableLoraCategory,
    color: PillColorKey | null
  ) => {
    const nextOverrides = { ...(pillTypeSettings.loraCategoryColors || {}) };
    if (color === null) {
      delete nextOverrides[category];
    } else {
      nextOverrides[category] = color;
    }
    onUpdatePillTypeSettings({
      ...pillTypeSettings,
      loraCategoryColors: nextOverrides,
    });
  };

  const atDefaults = isDefaultPillSettings(pillTypeSettings);
  const categoryOverrideCount = Object.keys(pillTypeSettings.loraCategoryColors || {}).length;

  return (
    <div className="space-y-5">
      {/* Quick Gen Dock & Gallery Pill Colors Toggles */}
      <section className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl px-4 py-3.5 flex items-center justify-between gap-4">
          <div className="space-y-0.5 min-w-0">
            <h2 className="text-xs font-display font-semibold text-zinc-100">
              Floating Quick Generation Box
            </h2>
            <p className="text-[11px] text-zinc-400 leading-snug">
              Cross-tab prompt dock with <code className="text-zinc-200">@character</code> mentions &amp; Agent support.
            </p>
          </div>

          <label className="inline-flex items-center gap-2.5 cursor-pointer select-none shrink-0">
            <span className="text-[11px] text-zinc-300 font-medium">
              {quickGenBoxEnabled ? 'On' : 'Off'}
            </span>
            <input
              type="checkbox"
              checked={quickGenBoxEnabled}
              onChange={(e) => onToggleQuickGenBox(e.target.checked)}
              className="sr-only peer"
            />
            <div className="w-10 h-5 bg-zinc-800 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all relative peer-checked:bg-indigo-600" />
          </label>
        </div>

        <div className="bg-zinc-900 border border-zinc-800 rounded-xl px-4 py-3.5 flex items-center justify-between gap-4">
          <div className="space-y-0.5 min-w-0">
            <h2 className="text-xs font-display font-semibold text-zinc-100">
              Gallery Pill Colors
            </h2>
            <p className="text-[11px] text-zinc-400 leading-snug">
              Apply each model type&apos;s pill color on Main Gallery &amp; generating ghost cards (Off = neutral pills).
            </p>
          </div>

          <label className="inline-flex items-center gap-2.5 cursor-pointer select-none shrink-0">
            <span className="text-[11px] text-zinc-300 font-medium">
              {galleryPillColorsEnabled ? 'On' : 'Off'}
            </span>
            <input
              type="checkbox"
              checked={galleryPillColorsEnabled}
              onChange={(e) => onToggleGalleryPillColors(e.target.checked)}
              className="sr-only peer"
            />
            <div className="w-10 h-5 bg-zinc-800 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all relative peer-checked:bg-indigo-600" />
          </label>
        </div>
      </section>

      {/* Per-Model-Type Pill Colors & @Mention Prompt Insertion */}
      <section className="bg-zinc-900 border border-zinc-800 rounded-xl p-5 space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-indigo-400" />
              <h2 className="text-sm font-display font-semibold text-zinc-100">
                Model Type Pills &amp; @Mention Behavior
              </h2>
            </div>
            <p className="text-xs text-zinc-400">
              Choose pill colors by model type and whether selecting an <code className="text-zinc-200">@mention</code> also writes its name into your Quick Gen prompt.
            </p>
          </div>

          <button
            type="button"
            disabled={atDefaults}
            onClick={() => onUpdatePillTypeSettings(DEFAULT_PILL_TYPE_SETTINGS)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-zinc-800 bg-zinc-950 hover:bg-zinc-800 text-zinc-300 disabled:opacity-40 disabled:cursor-not-allowed text-[11px] font-medium transition-colors cursor-pointer"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span>Reset Defaults</span>
          </button>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {ENTITY_META.map((meta) => {
            const Icon = meta.icon;
            const current = pillTypeSettings[meta.key];
            const styleSet = PILL_COLOR_STYLES[current.color];

            return (
              <div
                key={meta.key}
                className="bg-zinc-950/80 border border-zinc-800 rounded-xl p-4 flex flex-col justify-between gap-4"
              >
                <div className="space-y-3">
                  {/* Card Header + Live Pill Preview */}
                  <div className="flex items-start justify-between gap-2">
                    <div className="space-y-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        <Icon className={`w-3.5 h-3.5 shrink-0 ${styleSet.icon}`} />
                        <h3 className="text-xs font-display font-semibold text-zinc-100">
                          {meta.label}
                        </h3>
                      </div>
                      <p className="text-[11px] text-zinc-400 leading-snug">
                        {meta.description}
                      </p>
                    </div>
                  </div>

                  {/* Live Pill Preview */}
                  <div className="bg-zinc-900/70 border border-zinc-800/80 rounded-lg px-3 py-2 flex items-center justify-between gap-2">
                    <span className="text-[10px] uppercase tracking-wider text-zinc-500 font-medium">
                      Preview
                    </span>
                    <span
                      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-xs font-medium shadow-sm ${styleSet.pill}`}
                    >
                      <Icon className={`w-3 h-3 shrink-0 ${styleSet.icon}`} />
                      <span>{meta.sampleLabel}</span>
                    </span>
                  </div>

                  {/* Color Palette Picker */}
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between text-[11px]">
                      <span className="text-zinc-400 font-medium">Pill Color</span>
                      <span className={`font-medium ${styleSet.textAccent}`}>
                        {styleSet.label}
                      </span>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      {PILL_COLOR_OPTIONS.map((colorKey: PillColorKey) => {
                        const swatch = PILL_COLOR_STYLES[colorKey];
                        const isSelected = current.color === colorKey;
                        return (
                          <button
                            key={colorKey}
                            type="button"
                            onClick={() => handleChangeEntity(meta.key, { color: colorKey })}
                            aria-label={`Set ${meta.label} pill color to ${swatch.label}`}
                            title={swatch.label}
                            className={`w-6 h-6 rounded-full flex items-center justify-center transition-transform cursor-pointer ${swatch.swatchBg} ${
                              isSelected
                                ? 'ring-2 ring-white ring-offset-2 ring-offset-zinc-950 scale-105'
                                : 'opacity-75 hover:opacity-100 hover:scale-105'
                            }`}
                          >
                            {isSelected && <Check className="w-3.5 h-3.5 text-white drop-shadow" />}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </div>

                {/* Insert @mention Name Toggle */}
                <div className="pt-3 border-t border-zinc-800/80 flex items-center justify-between gap-3">
                  <div className="space-y-0.5 min-w-0">
                    <div className="text-[11px] font-medium text-zinc-200">
                      Insert @mention name in prompt
                    </div>
                    <div className="text-[10px] text-zinc-500 leading-snug">
                      {current.insertMentionName
                        ? 'Attaches pill and inserts the name text into Quick Gen.'
                        : 'Attaches pill only without printing the name in chat.'}
                    </div>
                  </div>

                  <label className="inline-flex items-center gap-2 cursor-pointer select-none shrink-0">
                    <span className="text-[11px] text-zinc-300 font-medium">
                      {current.insertMentionName ? 'On' : 'Off'}
                    </span>
                    <input
                      type="checkbox"
                      checked={current.insertMentionName}
                      onChange={(e) =>
                        handleChangeEntity(meta.key, {
                          insertMentionName: e.target.checked,
                        })
                      }
                      className="sr-only peer"
                    />
                    <div className="w-9 h-5 bg-zinc-800 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all relative peer-checked:bg-indigo-600" />
                  </label>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* Per-Category LoRA Pill Colors */}
      <section className="bg-zinc-900 border border-zinc-800 rounded-xl p-5 space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <Layers className="w-4 h-4 text-amber-400" />
              <h2 className="text-sm font-display font-semibold text-zinc-100">
                LoRA Category Pill Colors
              </h2>
            </div>
            <p className="text-xs text-zinc-400">
              Override pill colors for specific LoRA categories across Quick Gen, Gallery cards, and Character Addons.{' '}
              <span className="text-zinc-300">Character</span> LoRAs always use your Characters pill color above.
            </p>
          </div>

          {categoryOverrideCount > 0 && (
            <button
              type="button"
              onClick={() =>
                onUpdatePillTypeSettings({
                  ...pillTypeSettings,
                  loraCategoryColors: {},
                })
              }
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-zinc-800 bg-zinc-950 hover:bg-zinc-800 text-zinc-300 text-[11px] font-medium transition-colors cursor-pointer"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>Use Default LoRA Color for All</span>
            </button>
          )}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
          {CUSTOMIZABLE_LORA_CATEGORIES.map((cat) => {
            const override = pillTypeSettings.loraCategoryColors?.[cat.key] || null;
            const resolvedStyle = resolveLoraCategoryStyle(cat.key, pillTypeSettings);

            return (
              <div
                key={cat.key}
                className="bg-zinc-950/80 border border-zinc-800 rounded-xl px-3.5 py-3 space-y-2.5"
              >
                <div className="flex items-center justify-between gap-2">
                  <span
                    className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full border text-xs font-medium shadow-sm ${resolvedStyle.pill}`}
                  >
                    <Layers className={`w-3 h-3 shrink-0 ${resolvedStyle.icon}`} />
                    <span>{cat.label}</span>
                  </span>

                  <button
                    type="button"
                    onClick={() => handleChangeCategoryColor(cat.key, null)}
                    disabled={!override}
                    className={`text-[10px] px-2 py-0.5 rounded border transition-colors ${
                      !override
                        ? 'border-zinc-700/80 bg-zinc-900 text-zinc-300 font-medium'
                        : 'border-zinc-800 bg-zinc-950 text-zinc-400 hover:text-zinc-200 hover:border-zinc-700 cursor-pointer'
                    }`}
                    title="Inherit the base LoRAs color"
                  >
                    {!override ? `Default (${PILL_COLOR_STYLES[pillTypeSettings.lora.color].label})` : 'Reset to Default'}
                  </button>
                </div>

                <div className="flex flex-wrap items-center gap-1.5">
                  {PILL_COLOR_OPTIONS.map((colorKey: PillColorKey) => {
                    const swatch = PILL_COLOR_STYLES[colorKey];
                    const isSelected = override === colorKey;
                    return (
                      <button
                        key={colorKey}
                        type="button"
                        onClick={() => handleChangeCategoryColor(cat.key, colorKey)}
                        aria-label={`Set ${cat.label} LoRA pill color to ${swatch.label}`}
                        title={swatch.label}
                        className={`w-5 h-5 rounded-full flex items-center justify-center transition-transform cursor-pointer ${swatch.swatchBg} ${
                          isSelected
                            ? 'ring-2 ring-white ring-offset-2 ring-offset-zinc-950 scale-105'
                            : 'opacity-70 hover:opacity-100 hover:scale-105'
                        }`}
                      >
                        {isSelected && <Check className="w-3 h-3 text-white drop-shadow" />}
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
};
