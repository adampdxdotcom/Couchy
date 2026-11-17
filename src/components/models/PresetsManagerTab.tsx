import React, { useMemo, useState } from 'react';
import { Bookmark, Plus, Search } from 'lucide-react';
import { api } from '../../api/client.ts';
import { resolvePresetPillStyle } from '../../shared/pillSettings.ts';
import type {
  LoraExplorerItem,
  LoraPreset,
  ModelInventoryItem,
} from '../../shared/types.ts';
import { MAX_SYSTEM_LORAS, normalizeLoraKey } from '../quickgen/quickGenUtils.ts';
import { isBaseModelType } from './BaseModelExplorerGrid.tsx';
import { PresetEditorPanel, type PresetEditorDraft } from './PresetEditorPanel.tsx';
import { PresetSelectableGrid } from './PresetSelectableGrid.tsx';

interface PresetsManagerTabProps {
  presets: LoraPreset[];
  loras: LoraExplorerItem[];
  models: ModelInventoryItem[];
  onRefresh: () => Promise<void>;
  onPushToast?: (text: string, type?: 'info' | 'success' | 'warning' | 'error') => void;
}

function buildEmptyDraft(): PresetEditorDraft {
  return {
    id: null,
    name: '',
    nickname: '',
    userDescription: '',
    agentDescription: '',
    pillColor: 'fuchsia',
    checkpointName: null,
    items: [],
  };
}

function draftFromPreset(preset: LoraPreset): PresetEditorDraft {
  return {
    id: preset.id,
    name: preset.name,
    nickname: preset.nickname || '',
    userDescription: preset.userDescription || '',
    agentDescription: preset.agentDescription || '',
    pillColor: preset.pillColor,
    checkpointName: preset.checkpointName || null,
    items: preset.items.slice(0, MAX_SYSTEM_LORAS).map((item) => ({
      loraName: item.loraName,
      modelStrength: item.modelStrength,
      clipStrength: item.clipStrength,
    })),
  };
}

/**
 * Presets tab inside LoRAs & Models: manages saved LoRA + Base Model Presets,
 * displays saved presets as clickable pills, and provides click-to-select editing.
 */
export const PresetsManagerTab: React.FC<PresetsManagerTabProps> = ({
  presets,
  loras,
  models,
  onRefresh,
  onPushToast,
}) => {
  const [draft, setDraft] = useState<PresetEditorDraft | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState<'all' | 'models' | 'loras'>('all');

  const isSelecting = draft !== null;

  const filteredBaseModels = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return models
      .filter((m) => isBaseModelType(m.modelType) && !m.isHidden)
      .filter(
        (m) =>
          !q ||
          m.name.toLowerCase().includes(q) ||
          m.filename.toLowerCase().includes(q) ||
          (m.baseModel || '').toLowerCase().includes(q)
      );
  }, [models, searchQuery]);

  const filteredLoras = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return loras
      .filter((l) => !l.isHidden)
      .filter(
        (l) =>
          !q ||
          l.name.toLowerCase().includes(q) ||
          l.filename.toLowerCase().includes(q) ||
          l.loraCategory.toLowerCase().includes(q) ||
          (l.baseModel || '').toLowerCase().includes(q)
      );
  }, [loras, searchQuery]);

  const selectedLoraStrengthMap = useMemo(() => {
    const map = new Map<string, number>();
    if (!draft) return map;
    for (const item of draft.items) {
      map.set(normalizeLoraKey(item.loraName), item.modelStrength);
    }
    return map;
  }, [draft]);

  const handleStartCreate = () => {
    setDraft(buildEmptyDraft());
  };

  const handleSelectPresetPill = (preset: LoraPreset) => {
    if (draft?.id === preset.id) {
      setDraft(null);
      return;
    }
    setDraft(draftFromPreset(preset));
  };

  const handleToggleCheckpoint = (filename: string) => {
    if (!draft) return;
    setDraft((prev) => {
      if (!prev) return prev;
      const isSame =
        Boolean(prev.checkpointName) &&
        normalizeLoraKey(prev.checkpointName!) === normalizeLoraKey(filename);
      return {
        ...prev,
        checkpointName: isSame ? null : filename,
      };
    });
  };

  const handleToggleLora = (lora: LoraExplorerItem) => {
    if (!draft) return;
    const key = normalizeLoraKey(lora.filename);
    const alreadyExists = draft.items.some((item) => normalizeLoraKey(item.loraName) === key);
    if (!alreadyExists && draft.items.length >= MAX_SYSTEM_LORAS) {
      onPushToast?.(`A preset can hold at most ${MAX_SYSTEM_LORAS} LoRAs.`, 'warning');
      return;
    }

    setDraft((prev) => {
      if (!prev) return prev;
      const idx = prev.items.findIndex((item) => normalizeLoraKey(item.loraName) === key);
      if (idx >= 0) {
        return {
          ...prev,
          items: prev.items.filter((_, i) => i !== idx),
        };
      }
      if (prev.items.length >= MAX_SYSTEM_LORAS) return prev;
      const defaultStrength = lora.defaultModelStrength ?? 1.0;
      const defaultClip = lora.defaultClipStrength ?? defaultStrength;
      return {
        ...prev,
        items: [
          ...prev.items,
          {
            loraName: lora.filename,
            modelStrength: defaultStrength,
            clipStrength: defaultClip,
          },
        ],
      };
    });
  };

  const handleRemoveLora = (loraName: string) => {
    const key = normalizeLoraKey(loraName);
    setDraft((prev) =>
      prev
        ? {
            ...prev,
            items: prev.items.filter((item) => normalizeLoraKey(item.loraName) !== key),
          }
        : prev
    );
  };

  const handleChangeLoraStrength = (loraName: string, nextStrength: number) => {
    const key = normalizeLoraKey(loraName);
    setDraft((prev) =>
      prev
        ? {
            ...prev,
            items: prev.items.map((item) =>
              normalizeLoraKey(item.loraName) === key
                ? { ...item, modelStrength: nextStrength, clipStrength: nextStrength }
                : item
            ),
          }
        : prev
    );
  };

  const handleSave = async () => {
    if (!draft) return;
    if (!draft.name.trim()) {
      onPushToast?.('Please enter a Preset Name before saving.', 'warning');
      return;
    }
    if (!draft.checkpointName && draft.items.length === 0) {
      onPushToast?.('Select at least one Base Model or LoRA for this preset.', 'warning');
      return;
    }

    setIsSaving(true);
    try {
      const payload = {
        name: draft.name.trim(),
        nickname: draft.nickname.trim(),
        userDescription: draft.userDescription.trim(),
        agentDescription: draft.agentDescription.trim(),
        pillColor: draft.pillColor,
        checkpointName: draft.checkpointName,
        items: draft.items,
      };
      if (draft.id) {
        await api.updatePreset(draft.id, payload);
        onPushToast?.(`Updated preset "${payload.name}"`, 'success');
      } else {
        await api.createPreset(payload);
        onPushToast?.(`Created preset "${payload.name}"`, 'success');
      }
      setDraft(null);
      await onRefresh();
    } catch (err: any) {
      onPushToast?.(err?.message || 'Failed to save preset.', 'error');
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!draft?.id) return;
    setIsSaving(true);
    try {
      await api.deletePreset(draft.id);
      onPushToast?.(`Deleted preset "${draft.name}"`, 'info');
      setDraft(null);
      await onRefresh();
    } catch (err: any) {
      onPushToast?.(err?.message || 'Failed to delete preset.', 'error');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="space-y-5">
      {/* Top Presets Pill Bar + Create Button */}
      <div className="bg-zinc-900/70 border border-zinc-800 rounded-2xl p-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2 min-w-0">
          {presets.length === 0 ? (
            <span className="text-xs text-zinc-400">
              No presets saved yet. Click <span className="text-fuchsia-300 font-medium">Create Preset</span> to bundle a Base Model + up to {MAX_SYSTEM_LORAS} LoRAs.
            </span>
          ) : (
            presets.map((preset) => {
              const style = resolvePresetPillStyle(preset.pillColor);
              const isEditingThis = draft?.id === preset.id;
              const pillText = preset.nickname
                ? `@${preset.nickname}`
                : preset.name;
              return (
                <button
                  key={preset.id}
                  type="button"
                  onClick={() => handleSelectPresetPill(preset)}
                  title={
                    preset.userDescription ||
                    `${preset.name} (${preset.items.length} LoRA${preset.items.length === 1 ? '' : 's'}${
                      preset.checkpointDisplayName ? ` · ${preset.checkpointDisplayName}` : ''
                    }) — Click to edit`
                  }
                  className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-xs font-medium transition-all ${
                    isEditingThis ? style.pillSelected : style.pillHover
                  }`}
                >
                  <Bookmark className={`w-3.5 h-3.5 shrink-0 ${style.icon}`} />
                  <span className={style.textLight}>{pillText}</span>
                  {preset.nickname && preset.nickname.toLowerCase() !== preset.name.toLowerCase() && (
                    <span className={`text-[11px] opacity-80 ${style.textAccent}`}>
                      · {preset.name}
                    </span>
                  )}
                  <span className="text-[10px] font-mono opacity-80">
                    ({preset.items.length}/{MAX_SYSTEM_LORAS})
                  </span>
                </button>
              );
            })
          )}
        </div>

        <button
          type="button"
          onClick={handleStartCreate}
          className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-fuchsia-600 hover:bg-fuchsia-500 text-white text-xs font-semibold transition-colors cursor-pointer shrink-0 shadow-sm"
        >
          <Plus className="w-3.5 h-3.5" />
          <span>Create Preset</span>
        </button>
      </div>

      {/* Create / Edit Preview Slots & Metadata Panel */}
      {draft && (
        <PresetEditorPanel
          draft={draft}
          loras={loras}
          models={models}
          isSaving={isSaving}
          onChangeDraft={(updater) => setDraft((prev) => (prev ? updater(prev) : prev))}
          onClearCheckpoint={() =>
            setDraft((prev) => (prev ? { ...prev, checkpointName: null } : prev))
          }
          onRemoveLora={handleRemoveLora}
          onChangeLoraStrength={handleChangeLoraStrength}
          onSave={handleSave}
          onCancel={() => setDraft(null)}
          onDelete={draft.id ? handleDelete : undefined}
        />
      )}

      {/* Search & Type Filter Bar for Cards */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="relative flex-1 min-w-[220px] max-w-md">
          <Search className="w-3.5 h-3.5 text-zinc-500 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Filter Base Models & LoRAs..."
            className="w-full pl-8 pr-3 py-1.5 bg-zinc-900 border border-zinc-800 focus:border-fuchsia-500 rounded-lg text-xs text-zinc-100 placeholder-zinc-500 focus:outline-none"
          />
        </div>

        <div className="flex items-center gap-1.5">
          {(
            [
              { id: 'all', label: 'All' },
              { id: 'models', label: 'Base Models' },
              { id: 'loras', label: 'LoRAs' },
            ] as const
          ).map((f) => (
            <button
              key={f.id}
              type="button"
              onClick={() => setTypeFilter(f.id)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors cursor-pointer ${
                typeFilter === f.id
                  ? 'bg-zinc-800 text-zinc-100 border border-zinc-700'
                  : 'bg-zinc-900 text-zinc-400 border border-zinc-800/80 hover:text-zinc-200'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {/* Unified Simplified Cards Grid */}
      <PresetSelectableGrid
        baseModels={filteredBaseModels}
        loras={filteredLoras}
        showModels={typeFilter === 'all' || typeFilter === 'models'}
        showLoras={typeFilter === 'all' || typeFilter === 'loras'}
        isSelecting={isSelecting}
        selectedCheckpointName={draft?.checkpointName || null}
        selectedLoraStrengthMap={selectedLoraStrengthMap}
        onToggleCheckpoint={handleToggleCheckpoint}
        onToggleLora={handleToggleLora}
      />
    </div>
  );
};
