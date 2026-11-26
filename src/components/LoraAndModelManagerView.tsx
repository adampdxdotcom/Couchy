import React, { useState } from 'react';
import { ExternalLink, RefreshCw } from 'lucide-react';
import { api } from '../api/client.ts';
import { BaseModelDetailView } from './models/BaseModelDetailView.tsx';
import { isBaseModelType } from './models/BaseModelExplorerGrid.tsx';
import { LoraDetailView } from './LoraDetailView.tsx';
import { ModelDownloaderTab } from './ModelDownloaderTab.tsx';
import { LoraExplorerTab } from './models/LoraExplorerTab.tsx';
import { ModelInventoryTab } from './models/ModelInventoryTab.tsx';
import { PresetsManagerTab } from './models/PresetsManagerTab.tsx';
import { useModelDownloaderState } from './models/useModelDownloaderState.ts';
import type {
  ImageRecord,
  LoraExplorerItem,
  LoraPreset,
  ModelInventoryItem,
  PillTypeSettings,
} from '../shared/types.ts';

interface LoraAndModelManagerViewProps {
  loras: LoraExplorerItem[];
  models: ModelInventoryItem[];
  presets?: LoraPreset[];
  refreshVersion?: number;
  pillTypeSettings?: PillTypeSettings;
  civitaiActivityNotificationsEnabled?: boolean;
  onRefresh: () => Promise<void>;
  onOpenImage: (img: ImageRecord) => void;
  onFilterGalleryByLora: (loraFilename: string) => void;
  onFilterGalleryByModel: (modelFilename: string) => void;
  onPushToast?: (text: string, type?: 'info' | 'success' | 'warning' | 'error') => void;
}

/**
 * Top-level coordinator for LoRA Explorer, LoRA Detail Inspector,
 * Base Models Explorer (non-LoRA checkpoints, diffusion models, CLIP, VAE, etc.),
 * and the Civitai / Hugging Face Downloader.
 */
export const LoraAndModelManagerView: React.FC<LoraAndModelManagerViewProps> = ({
  loras,
  models,
  presets = [],
  refreshVersion = 0,
  pillTypeSettings,
  civitaiActivityNotificationsEnabled = true,
  onRefresh,
  onOpenImage,
  onFilterGalleryByLora,
  onFilterGalleryByModel,
  onPushToast,
}) => {
  const [subTab, setSubTab] = useState<'loras' | 'dependencies' | 'presets' | 'downloader'>('loras');
  const [selectedLoraName, setSelectedLoraName] = useState<string | null>(null);
  const [selectedModelId, setSelectedModelId] = useState<number | null>(null);
  const [highlightedModelFilename, setHighlightedModelFilename] = useState<string | null>(null);
  const [impactReport, setImpactReport] = useState<any | null>(null);
  const [fetchingModelId, setFetchingModelId] = useState<number | null>(null);
  const [refreshingStatsModelId, setRefreshingStatsModelId] = useState<number | null>(null);
  const [linkingModelId, setLinkingModelId] = useState<number | null>(null);
  const [isHealingLinks, setIsHealingLinks] = useState(false);
  const [isSyncingModels, setIsSyncingModels] = useState(false);

  const downloader = useModelDownloaderState(subTab, onRefresh);
  const selectedLora =
    loras.find((l) => l.filename.toLowerCase() === (selectedLoraName || '').toLowerCase()) || null;
  const selectedModel =
    selectedModelId !== null ? models.find((m) => m.id === selectedModelId) || null : null;

  const handleInspectDownload = async (job: any) => {
    const dest = typeof job.destination_path === 'string' ? job.destination_path : '';
    const fallbackFilename = dest.split(/[\\/]/).pop() || '';
    const targetFilename = job.installed_filename || fallbackFilename;
    const effectiveType = String(job.installed_model_type || job.model_type || '').toLowerCase();

    if (effectiveType === 'lora' && targetFilename) {
      const existsInLoras = loras.some(
        (l) => l.filename.toLowerCase() === targetFilename.toLowerCase()
      );
      if (!existsInLoras) {
        await onRefresh();
      }
      setSelectedModelId(null);
      setSelectedLoraName(targetFilename);
      return;
    }

    setSelectedLoraName(null);
    setHighlightedModelFilename(targetFilename || null);
    setSubTab('dependencies');
  };

  const handleLoadImpact = async (modelFilename: string) => {
    const res = await api.getModelImpact(modelFilename);
    setImpactReport(res);
  };

  const handleFetchFromCivitai = async (modelId: number) => {
    setFetchingModelId(modelId);
    try {
      const res = await api.fetchModelFromCivitai(modelId);
      await onRefresh();
      const notes: string[] = [];
      if (res.baseModel) notes.push(res.baseModel);
      if (res.hfRepoId && res.provider === 'huggingface') notes.push(res.hfRepoId);
      if (res.civitaiUrl?.includes('civitai.red')) notes.push('civitai.red link');
      if (res.filledTriggerWord) notes.push('trigger word auto-filled');
      if (res.filledDefaultStrength) notes.push('default strength updated');
      if (res.previewCount > 0) notes.push(`${res.previewCount} preview(s) cached`);
      const sourceLabel = res.provider === 'huggingface' ? 'Hugging Face' : 'Civitai';
      onPushToast?.(
        `Fetched details from ${sourceLabel}${notes.length > 0 ? ` (${notes.join(', ')})` : ''}`,
        'success'
      );
    } catch (err: any) {
      onPushToast?.(
        err?.message || 'Could not fetch details from Civitai or Hugging Face',
        'error'
      );
    } finally {
      setFetchingModelId(null);
    }
  };

  const handleRefreshModelStats = async (modelId: number) => {
    setRefreshingStatsModelId(modelId);
    try {
      const res = await api.refreshModelCivitaiStats(modelId);
      await onRefresh();
      if (res.checkedModels > 0) {
        onPushToast?.('Refreshed Civitai upload stats and comments', 'success');
      } else {
        onPushToast?.('Could not reach Civitai stats for this model right now', 'warning');
      }
    } catch (err: any) {
      onPushToast?.(err?.message || 'Failed to refresh Civitai stats', 'error');
    } finally {
      setRefreshingStatsModelId(null);
    }
  };

  const handleLinkCivitaiModel = async (
    modelId: number,
    payload: {
      input?: string;
      versionId?: string;
      modelId?: string;
      domain?: 'civitai.com' | 'civitai.red';
    }
  ) => {
    setLinkingModelId(modelId);
    try {
      const res = await api.linkModelToCivitai(modelId, payload);
      await onRefresh();
      const notes: string[] = [];
      if (res.isOwnUpload) notes.push('uploaded by you');
      if (res.baseModel) notes.push(res.baseModel);
      if (res.filledTriggerWord) notes.push('trigger word auto-filled');
      onPushToast?.(
        `Linked to Civitai${notes.length > 0 ? ` (${notes.join(', ')})` : ''}`,
        'success'
      );
    } finally {
      setLinkingModelId(null);
    }
  };

  const handleHealCivitaiLinks = async () => {
    setIsHealingLinks(true);
    try {
      const res = await api.healCivitaiLinks();
      await onRefresh();
      onPushToast?.(
        `Checked ${res.checked} model(s) · Healed ${res.healed} link(s) (${res.redCount} on civitai.red)`,
        'success'
      );
    } catch (err: any) {
      onPushToast?.(err?.message || 'Failed to heal Civitai links', 'error');
    } finally {
      setIsHealingLinks(false);
    }
  };

  const handleSyncInventory = async () => {
    setIsSyncingModels(true);
    try {
      await api.syncModelInventory();
      await onRefresh();
      onPushToast?.('Synced ComfyUI & local model availability', 'success');
    } catch (err: any) {
      onPushToast?.(err?.message || 'Failed to sync ComfyUI model inventory', 'error');
    } finally {
      setIsSyncingModels(false);
    }
  };

  const handleUpdateMentionConfig = async (
    loraName: string,
    payload: {
      name?: string;
      mentionEnabled?: boolean;
      nickname?: string | null;
      defaultModelStrength?: number;
      defaultClipStrength?: number;
      triggerWord?: string | null;
      llmDescription?: string | null;
    }
  ) => {
    try {
      await api.updateLoraMentionConfig({ loraName, ...payload });
      await onRefresh();
      if (onPushToast) {
        if (payload.name !== undefined) {
          onPushToast(`Renamed LoRA to "${payload.name}"`, 'success');
        } else if (payload.mentionEnabled !== undefined) {
          onPushToast(
            payload.mentionEnabled
              ? `Enabled @mention for ${loraName}`
              : `Disabled @mention for ${loraName}`,
            'info'
          );
        } else if (payload.nickname !== undefined) {
          onPushToast(
            payload.nickname
              ? `Saved nickname @${payload.nickname}`
              : `Cleared nickname for ${loraName}`,
            'success'
          );
        } else if (payload.triggerWord !== undefined) {
          onPushToast(
            payload.triggerWord
              ? `Saved trigger word(s) for ${loraName}`
              : `Cleared trigger word(s) for ${loraName}`,
            'success'
          );
        } else if (payload.llmDescription !== undefined) {
          onPushToast(
            payload.llmDescription
              ? `Saved Agent description for ${loraName}`
              : `Cleared Agent description for ${loraName}`,
            'success'
          );
        } else {
          onPushToast('Updated LoRA @mention settings', 'success');
        }
      }
    } catch (err: any) {
      onPushToast?.(err.message || 'Failed to update @mention settings', 'error');
    }
  };

  const handleToggleLoraVisibility = async (loraName: string, nextHidden: boolean) => {
    try {
      await api.updateLoraVisibility(loraName, nextHidden);
      await onRefresh();
      onPushToast?.(
        nextHidden ? `Hidden ${loraName} from Couchy` : `Restored ${loraName} to Couchy`,
        nextHidden ? 'info' : 'success'
      );
    } catch (err: any) {
      onPushToast?.(err?.message || 'Failed to update LoRA visibility', 'error');
    }
  };

  const handleUpdateModelConfig = async (
    modelId: number,
    payload: {
      name?: string;
      mentionEnabled?: boolean;
      nickname?: string | null;
      llmDescription?: string | null;
      userNotes?: string | null;
    }
  ) => {
    const target = models.find((m) => m.id === modelId);
    const label = target?.name || `Model #${modelId}`;
    try {
      await api.updateModelConfig(modelId, payload);
      await onRefresh();
      if (onPushToast) {
        if (payload.name !== undefined) {
          onPushToast(`Renamed model to "${payload.name}"`, 'success');
        } else if (payload.mentionEnabled !== undefined) {
          onPushToast(
            payload.mentionEnabled
              ? `Enabled @mention for ${label}`
              : `Disabled @mention for ${label}`,
            'info'
          );
        } else if (payload.nickname !== undefined) {
          onPushToast(
            payload.nickname
              ? `Saved nickname @${payload.nickname}`
              : `Cleared nickname for ${label}`,
            'success'
          );
        } else if (payload.llmDescription !== undefined) {
          onPushToast(
            payload.llmDescription
              ? `Saved details & strengths for ${label}`
              : `Cleared details for ${label}`,
            'success'
          );
        } else if (payload.userNotes !== undefined) {
          onPushToast(`Saved personal notes for ${label}`, 'success');
        }
      }
    } catch (err: any) {
      onPushToast?.(err.message || 'Failed to update model settings', 'error');
    }
  };

  const handleToggleModelVisibility = async (modelId: number, nextHidden: boolean) => {
    const target = models.find((m) => m.id === modelId);
    const label = target?.name || `Model #${modelId}`;
    try {
      await api.updateModelVisibility(modelId, nextHidden);
      await onRefresh();
      onPushToast?.(
        nextHidden ? `Hidden ${label}` : `Restored ${label}`,
        nextHidden ? 'info' : 'success'
      );
    } catch (err: any) {
      onPushToast?.(err?.message || 'Failed to update model visibility', 'error');
    }
  };

  if (selectedLora) {
    return (
      <LoraDetailView
        lora={selectedLora}
        refreshVersion={refreshVersion}
        impactReport={impactReport}
        isFetchingCivitai={Boolean(
          selectedLora.modelId && fetchingModelId === selectedLora.modelId
        )}
        isRefreshingStats={Boolean(
          selectedLora.modelId && refreshingStatsModelId === selectedLora.modelId
        )}
        isLinkingCivitai={Boolean(
          selectedLora.modelId && linkingModelId === selectedLora.modelId
        )}
        civitaiActivityNotificationsEnabled={civitaiActivityNotificationsEnabled}
        onBack={() => {
          setSelectedLoraName(null);
          setImpactReport(null);
        }}
        onLoadImpact={handleLoadImpact}
        onFilterGalleryByLora={onFilterGalleryByLora}
        onFetchFromCivitai={handleFetchFromCivitai}
        onRefreshStats={handleRefreshModelStats}
        onLinkCivitaiModel={handleLinkCivitaiModel}
        onToggleVisibility={handleToggleLoraVisibility}
        onUpdateMentionConfig={handleUpdateMentionConfig}
        onRefresh={onRefresh}
        onSyncModels={handleSyncInventory}
        isSyncingModels={isSyncingModels}
        onOpenImage={onOpenImage}
        onPushToast={onPushToast}
      />
    );
  }

  if (selectedModel) {
    return (
      <BaseModelDetailView
        model={selectedModel}
        refreshVersion={refreshVersion}
        impactReport={impactReport}
        isFetchingCivitai={fetchingModelId === selectedModel.id}
        onBack={() => {
          setSelectedModelId(null);
          setImpactReport(null);
        }}
        onLoadImpact={handleLoadImpact}
        onFilterGalleryByModel={onFilterGalleryByModel}
        onFetchFromCivitai={handleFetchFromCivitai}
        onToggleVisibility={handleToggleModelVisibility}
        onUpdateModelConfig={handleUpdateModelConfig}
        onSyncModels={handleSyncInventory}
        isSyncingModels={isSyncingModels}
        onOpenImage={onOpenImage}
      />
    );
  }

  const activeLoraCount = loras.filter((l) => !l.isHidden).length;
  const activeBaseModelCount = models.filter(
    (m) => isBaseModelType(m.modelType) && !m.isHidden
  ).length;
  const missingModels = models.filter((m) => !m.isInstalled && m.dependentImageCount > 0);

  return (
    <div className="px-6 py-6 max-w-7xl mx-auto space-y-6">
      {/* Sub-Navigation Bar */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-zinc-800 pb-3">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setSubTab('loras')}
            className={`px-3.5 py-2 text-xs font-medium rounded-lg transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
              subTab === 'loras'
                ? 'bg-indigo-600 text-white'
                : 'bg-zinc-900 text-zinc-300 hover:bg-zinc-800'
            }`}
          >
            LoRA Explorer ({activeLoraCount})
          </button>
          <button
            type="button"
            onClick={() => setSubTab('dependencies')}
            className={`px-3.5 py-2 text-xs font-medium rounded-lg transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
              subTab === 'dependencies'
                ? 'bg-emerald-600 text-white'
                : 'bg-zinc-900 text-zinc-300 hover:bg-zinc-800'
            }`}
          >
            Base Models ({activeBaseModelCount})
          </button>
          <button
            type="button"
            onClick={() => setSubTab('presets')}
            className={`px-3.5 py-2 text-xs font-medium rounded-lg transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
              subTab === 'presets'
                ? 'bg-fuchsia-600 text-white'
                : 'bg-zinc-900 text-zinc-300 hover:bg-zinc-800'
            }`}
          >
            Presets ({presets.length})
          </button>
          <button
            type="button"
            onClick={() => setSubTab('downloader')}
            className={`px-3.5 py-2 text-xs font-medium rounded-lg transition-colors cursor-pointer ${
              subTab === 'downloader'
                ? 'bg-indigo-600 text-white'
                : 'bg-zinc-900 text-zinc-300 hover:bg-zinc-800'
            }`}
          >
            Civitai &amp; Hugging Face Downloader
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={isHealingLinks}
            onClick={handleHealCivitaiLinks}
            title="Check all models against Civitai (.com & .red) and repair broken links"
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-zinc-900 border border-zinc-800 hover:border-zinc-700 disabled:opacity-50 text-zinc-200 rounded-lg cursor-pointer"
          >
            <ExternalLink className="w-3.5 h-3.5 text-indigo-400" />
            <span>{isHealingLinks ? 'Healing Links...' : 'Heal Civitai Links'}</span>
          </button>

          <button
            type="button"
            disabled={isSyncingModels}
            onClick={handleSyncInventory}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-zinc-900 border border-zinc-800 hover:border-zinc-700 disabled:opacity-50 text-zinc-200 rounded-lg cursor-pointer"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isSyncingModels ? 'animate-spin' : ''}`} />
            <span>{isSyncingModels ? 'Syncing...' : 'Sync ComfyUI & Disk Models'}</span>
          </button>
        </div>
      </div>

      {subTab === 'loras' && (
        <LoraExplorerTab
          loras={loras}
          onSelectLora={setSelectedLoraName}
          onUpdateMentionConfig={handleUpdateMentionConfig}
          onToggleVisibility={handleToggleLoraVisibility}
        />
      )}

      {subTab === 'dependencies' && (
        <ModelInventoryTab
          models={models}
          missingModels={missingModels}
          highlightedFilename={highlightedModelFilename}
          onLocateMissing={(q) => {
            downloader.setExtQuery(q);
            setSubTab('downloader');
            downloader.handleExternalSearch(undefined, q);
          }}
          onSelectModel={setSelectedModelId}
          onUpdateModelConfig={handleUpdateModelConfig}
          onToggleVisibility={handleToggleModelVisibility}
        />
      )}

      {subTab === 'presets' && (
        <PresetsManagerTab
          presets={presets}
          loras={loras}
          models={models}
          onRefresh={onRefresh}
          onPushToast={onPushToast}
        />
      )}

      {subTab === 'downloader' && (
        <ModelDownloaderTab
          extQuery={downloader.extQuery}
          setExtQuery={downloader.setExtQuery}
          extTypeFilter={downloader.extTypeFilter}
          setExtTypeFilter={downloader.setExtTypeFilter}
          searchResults={downloader.searchResults}
          setSearchResults={downloader.setSearchResults}
          searchBatchTimestamp={downloader.searchBatchTimestamp}
          activePreviewDownloads={downloader.activePreviewDownloads}
          setActivePreviewDownloads={downloader.setActivePreviewDownloads}
          isSearchingExt={downloader.isSearchingExt}
          searchError={downloader.searchError}
          searchNotice={downloader.searchNotice}
          onDismissSearchNotice={() => downloader.setSearchNotice(null)}
          downloads={downloader.downloads}
          missingDownloadsCount={downloader.missingDownloadsCount}
          pillTypeSettings={pillTypeSettings}
          onSearch={downloader.handleExternalSearch}
          onRefreshDownloads={downloader.refreshDownloads}
          onInspectDownload={handleInspectDownload}
          onPushToast={onPushToast}
        />
      )}
    </div>
  );
};
