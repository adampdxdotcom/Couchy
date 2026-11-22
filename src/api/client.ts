import type {
  AspectRatioPreset,
  CharacterDownloadAutomation,
  CharacterProfile,
  CivitaiImageImportResult,
  ComfyUiLiveStatus,
  ExternalModelFileOption,
  ExternalModelSearchResult,
  FaceMatchResponse,
  GalleryFilterState,
  GenerationBatchRecord,
  GenerationLoraSelection,
  HelpReadmePayload,
  ImageRecord,
  LmStudioGuidingTemplate,
  LmStudioStatus,
  LoraCategory,
  LoraExplorerItem,
  LoraMentionAutomation,
  LoraPreset,
  LoraPresetPayload,
  ModelCleanupStatus,
  ModelInventoryItem,
  PortraitCrop,
  PromptTemplate,
  QuickGenChatMessage,
  ReproductionValidationResult,
  SavedSearchPreset,
  StatsGranularity,
  StatsPeriod,
  GenerationStatsResponse,
  LibraryUsageStatsResponse,
  StorageUsageStatsResponse,
  VisualTagItem,
  VisualTaggerStatus,
  WorkflowLibraryItem,
} from '../shared/types.ts';
import type {
  ComfyUiTestResponse,
  DatabaseBackupEntry,
  DownloadJobRecord,
  HealthConfigSnapshot,
  HealthResponse,
  ModelImpactReport,
  ReproductionJobRecord,
  ScanJobRecord,
  UpdateConfigPayload,
  WorkflowDetailRecord,
} from '../shared/apiTypes.ts';

/**
 * Typed API client for ComfyUI Gallery backend endpoints.
 */
async function requestJson<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  if (!res.ok) {
    let errMsg = `HTTP ${res.status}`;
    try {
      const body = await res.json();
      if (body.error) errMsg = body.error;
    } catch {
      // ignore parse error
    }
    throw new Error(errMsg);
  }
  return res.json() as Promise<T>;
}

export const api = {
  getHealth: () => requestJson<HealthResponse>('/api/health'),

  updateConfig: (payload: UpdateConfigPayload) =>
    requestJson<{ ok: boolean; config: HealthConfigSnapshot }>('/api/config', {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }),

  getModelCleanupStatus: () => requestJson<ModelCleanupStatus>('/api/models/cleanup'),

  updateModelCleanupConfig: (payload: { enabled?: boolean; retentionHours?: number }) =>
    requestJson<ModelCleanupStatus>('/api/models/cleanup', {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }),

  runModelCleanup: (action: 'scan' | 'clean_due' | 'clean_all') =>
    requestJson<{ status: ModelCleanupStatus; deletedFiles: string[]; freedBytes: number }>(
      '/api/models/cleanup/run',
      { method: 'POST', body: JSON.stringify({ action }) }
    ),

  triggerScan: (scanType: 'incremental' | 'full' | 'reconcile' | 'rebuild_metadata' = 'incremental') =>
    requestJson<{ jobId: number; scan: ScanJobRecord | null }>('/api/scans/trigger', {
      method: 'POST',
      body: JSON.stringify({ scanType }),
    }),

  getScans: () =>
    requestJson<{ active: ScanJobRecord | null; history: ScanJobRecord[] }>('/api/scans'),

  getOrganizationMeta: () =>
    requestJson<{
      tags: { id: number; name: string; color: string; imageCount: number }[];
      collections: { id: number; name: string; description: string; imageCount: number }[];
      checkpoints: string[];
      savedSearches: SavedSearchPreset[];
    }>('/api/organization/meta'),

  createCollection: (name: string, description = '') =>
    requestJson<{ id: number; name: string }>('/api/organization/collections', {
      method: 'POST',
      body: JSON.stringify({ name, description }),
    }),

  deleteCollection: (id: number) =>
    requestJson<{ ok: boolean }>(`/api/organization/collections/${id}`, { method: 'DELETE' }),

  createTag: (name: string, color = '#6366f1') =>
    requestJson<{ id: number; name: string }>('/api/organization/tags', {
      method: 'POST',
      body: JSON.stringify({ name, color }),
    }),

  saveSearchPreset: (name: string, queryString: string, filterJson: Partial<GalleryFilterState>) =>
    requestJson<{ ok: boolean }>('/api/organization/saved-searches', {
      method: 'POST',
      body: JSON.stringify({ name, queryString, filterJson }),
    }),

  deleteSearchPreset: (id: number) =>
    requestJson<{ ok: boolean }>(`/api/organization/saved-searches/${id}`, { method: 'DELETE' }),

  queryImages: (
    filters: Partial<GalleryFilterState>,
    options?: { signal?: AbortSignal }
  ) =>
    requestJson<{ items: ImageRecord[]; total: number }>('/api/images/query', {
      method: 'POST',
      body: JSON.stringify(filters),
      signal: options?.signal,
    }),

  getImageDetail: (id: number, seriesId?: number | null) =>
    requestJson<{
      image: ImageRecord;
      rawMetadata: Record<string, string>;
      visualWorkflowJson: string | null;
      apiWorkflowJson: string | null;
    }>(`/api/images/${id}${seriesId ? `?seriesId=${seriesId}` : ''}`),

  updateImageAnnotations: (
    id: number,
    payload: {
      rating?: number;
      isFavorite?: boolean;
      isRejected?: boolean;
      isArchived?: boolean;
      notes?: string;
    }
  ) =>
    requestJson<{ ok: boolean }>(`/api/images/${id}/annotations`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }),

  bulkUpdateImages: (payload: {
    imageIds: number[];
    rating?: number;
    isFavorite?: boolean;
    isRejected?: boolean;
    isArchived?: boolean;
    addTagName?: string;
    removeTagId?: number;
    addCollectionId?: number;
    removeCollectionId?: number;
    addCharacterId?: number;
    appearanceLabel?: string;
  }) =>
    requestJson<{ ok: boolean; count: number }>('/api/images/bulk', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  exportImagesZip: async (params: {
    imageIds?: number[];
    filters?: Partial<GalleryFilterState>;
    archiveName?: string;
  }) => {
    const res = await fetch('/api/images/export-zip', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'ZIP export failed' }));
      throw new Error(err.error || 'ZIP export failed');
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${params.archiveName || 'couchy-export'}.zip`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  },

  // Characters
  listCharacters: () => requestJson<{ items: CharacterProfile[] }>('/api/characters'),

  getCharacter: (id: number) => requestJson<{ character: CharacterProfile }>(`/api/characters/${id}`),

  createCharacter: (payload: {
    name: string;
    description?: string;
    physicalDescription?: string;
    notes?: string;
    aliases?: string[];
    portraitImageId?: number | null;
  }) =>
    requestJson<{ character: CharacterProfile }>('/api/characters', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  updateCharacter: (
    id: number,
    payload: {
      name?: string;
      description?: string;
      physicalDescription?: string;
      notes?: string;
      portraitImageId?: number | null;
      portraitCrop?: PortraitCrop | null;
      aliases?: string[];
      tagIds?: number[];
      collectionIds?: number[];
    }
  ) =>
    requestJson<{ character: CharacterProfile }>(`/api/characters/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }),

  analyzeCharacterPortrait: (id: number, payload?: { imageId?: number; save?: boolean }) =>
    requestJson<{
      physicalDescription: string;
      pipelineUsed: 'vision' | 'wd14_text' | 'wd14_only';
      tags: string[];
      modelUsed: string;
      character: CharacterProfile;
    }>(`/api/characters/${id}/analyze-portrait`, {
      method: 'POST',
      body: JSON.stringify(payload || {}),
    }),

  deleteCharacter: (id: number) =>
    requestJson<{ ok: boolean }>(`/api/characters/${id}`, { method: 'DELETE' }),

  mergeCharacters: (targetId: number, sourceCharacterId: number) =>
    requestJson<{ character: CharacterProfile }>(`/api/characters/${targetId}/merge`, {
      method: 'POST',
      body: JSON.stringify({ sourceCharacterId }),
    }),

  linkLoraToCharacter: (
    characterId: number,
    payload: {
      loraName: string;
      appearanceLabel?: string;
      triggerWord?: string;
      loraCategory?: LoraCategory;
      notes?: string;
    }
  ) =>
    requestJson<{ character: CharacterProfile }>(`/api/characters/${characterId}/loras`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  unlinkLoraFromCharacter: (characterId: number, linkId: number) =>
    requestJson<{ character: CharacterProfile }>(`/api/characters/${characterId}/loras/${linkId}`, {
      method: 'DELETE',
    }),

  linkWorkflowToCharacter: (characterId: number, workflowId: number, roleLabel: string) =>
    requestJson<{ character: CharacterProfile }>(`/api/characters/${characterId}/workflows`, {
      method: 'POST',
      body: JSON.stringify({ workflowId, roleLabel }),
    }),

  updateCharacterAssociationStatus: (payload: {
    imageId: number;
    characterId: number;
    status: 'confirmed' | 'suggested' | 'rejected' | 'remove';
    appearanceLabel?: string;
  }) =>
    requestJson<{ ok: boolean }>('/api/characters/associations/status', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  bulkUpdateCharacterAssociationStatus: (payload: {
    imageIds: number[];
    characterId: number;
    status: 'confirmed' | 'suggested' | 'rejected' | 'remove';
    appearanceLabel?: string;
  }) =>
    requestJson<{ ok: boolean; count: number }>('/api/characters/associations/bulk-status', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  runCharacterSuggestions: () =>
    requestJson<{ ok: boolean; newSuggestions: number }>('/api/characters/run-suggestions', {
      method: 'POST',
    }),

  matchCharacterFace: (payload: { imageBase64DataUrl: string; minSimilarity?: number }) =>
    requestJson<FaceMatchResponse>('/api/characters/match-face', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  // LoRAs, Models & Workflows
  listLoras: () => requestJson<{ items: LoraExplorerItem[] }>('/api/loras'),

  classifyLora: (loraName: string, loraCategory: LoraCategory, userNotes?: string) =>
    requestJson<{ ok: boolean; items: LoraExplorerItem[] }>('/api/loras/classify', {
      method: 'PATCH',
      body: JSON.stringify({ loraName, loraCategory, userNotes }),
    }),

  updateLoraVisibility: (loraName: string, isHidden: boolean) =>
    requestJson<{ ok: boolean; items: LoraExplorerItem[] }>('/api/loras/visibility', {
      method: 'PATCH',
      body: JSON.stringify({ loraName, isHidden }),
    }),

  updateLoraMentionConfig: (payload: {
    loraName: string;
    mentionEnabled?: boolean;
    nickname?: string | null;
    defaultModelStrength?: number;
    defaultClipStrength?: number;
    triggerWord?: string | null;
    llmDescription?: string | null;
  }) =>
    requestJson<{ ok: boolean; items: LoraExplorerItem[] }>('/api/loras/mention-config', {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }),

  listModelInventory: () => requestJson<{ items: ModelInventoryItem[] }>('/api/models/inventory'),

  listPresets: () => requestJson<{ items: LoraPreset[] }>('/api/presets'),

  createPreset: (payload: LoraPresetPayload) =>
    requestJson<{ preset: LoraPreset; items: LoraPreset[] }>('/api/presets', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  updatePreset: (id: number, payload: LoraPresetPayload) =>
    requestJson<{ preset: LoraPreset; items: LoraPreset[] }>(`/api/presets/${id}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    }),

  deletePreset: (id: number) =>
    requestJson<{ ok: boolean; items: LoraPreset[] }>(`/api/presets/${id}`, {
      method: 'DELETE',
    }),

  updateModelVisibility: (modelId: number, isHidden: boolean) =>
    requestJson<{ ok: boolean; items: ModelInventoryItem[] }>(`/api/models/${modelId}/visibility`, {
      method: 'PATCH',
      body: JSON.stringify({ isHidden }),
    }),

  updateModelConfig: (
    modelId: number,
    payload: {
      mentionEnabled?: boolean;
      nickname?: string | null;
      llmDescription?: string | null;
      userNotes?: string | null;
    }
  ) =>
    requestJson<{ ok: boolean; items: ModelInventoryItem[] }>(`/api/models/${modelId}/config`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }),

  syncModelInventory: () =>
    requestJson<{ items: ModelInventoryItem[] }>('/api/models/sync', { method: 'POST' }),

  fetchModelFromCivitai: (modelId: number) =>
    requestJson<{
      ok: boolean;
      provider?: 'civitai' | 'huggingface';
      hfRepoId?: string | null;
      filledTriggerWord: boolean;
      filledDefaultStrength: boolean;
      civitaiUrl: string | null;
      baseModel: string | null;
      recommendedWeight: number | null;
      previewCount: number;
    }>(`/api/models/${modelId}/civitai-fetch`, { method: 'POST' }),

  healCivitaiLinks: () =>
    requestJson<{
      ok: boolean;
      checked: number;
      healed: number;
      redCount: number;
    }>('/api/models/civitai-heal', { method: 'POST' }),

  getModelImpact: (name: string) =>
    requestJson<ModelImpactReport>(`/api/models/${encodeURIComponent(name)}/impact`),

  searchModels: (q: string, type = '') =>
    requestJson<{ items: ExternalModelSearchResult[]; notice?: string | null }>(
      `/api/models/search?q=${encodeURIComponent(q)}&type=${encodeURIComponent(type)}`
    ),

  searchCivitai: (q: string, type = '') =>
    requestJson<{ items: ExternalModelSearchResult[] }>(
      `/api/models/search/civitai?q=${encodeURIComponent(q)}&type=${encodeURIComponent(type)}`
    ),

  searchHuggingFace: (q: string) =>
    requestJson<{ items: ExternalModelSearchResult[] }>(
      `/api/models/search/huggingface?q=${encodeURIComponent(q)}`
    ),

  listHuggingFaceRepoFiles: (repo: string) =>
    requestJson<{
      repoId: string;
      tags: string[];
      downloads: number;
      files: ExternalModelFileOption[];
    }>(`/api/models/huggingface/files?repo=${encodeURIComponent(repo)}`),

  resolveModelUrl: (url: string) =>
    requestJson<{ item: ExternalModelSearchResult }>('/api/models/resolve-url', {
      method: 'POST',
      body: JSON.stringify({ url }),
    }),

  startModelDownload: (payload: {
    provider: 'civitai' | 'huggingface' | 'direct';
    modelName: string;
    filename: string;
    modelType: string;
    sourceUrl: string;
    expectedHash?: string | null;
    subfolder?: string;
    allowOverwrite?: boolean;
    userConfirmed: boolean;
    hfRepoId?: string | null;
    civitaiMeta?: Record<string, unknown> | null;
    loraCategory?: LoraCategory | null;
    characterAutomation?: CharacterDownloadAutomation | null;
    mentionAutomation?: LoraMentionAutomation | null;
    scheduledFor?: string | null;
  }) =>
    requestJson<{ job: DownloadJobRecord }>('/api/downloads/start', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  runScheduledDownloadNow: (id: number) =>
    requestJson<{ job: DownloadJobRecord }>(`/api/downloads/${id}/run-now`, { method: 'POST' }),

  rescheduleFailedDownload: (id: number, scheduledFor?: string | null) =>
    requestJson<{ job: DownloadJobRecord }>(`/api/downloads/${id}/reschedule`, {
      method: 'POST',
      body: JSON.stringify({ scheduledFor: scheduledFor || null }),
    }),

  cancelScheduledDownload: (id: number) =>
    requestJson<{ ok: boolean; deletedId: number }>(`/api/downloads/${id}`, {
      method: 'DELETE',
    }),

  cancelDownload: (id: number) =>
    requestJson<{ ok: boolean; deletedId: number }>(`/api/downloads/${id}`, {
      method: 'DELETE',
    }),

  cancelAllDownloads: () =>
    requestJson<{ ok: boolean; cancelledCount: number }>('/api/downloads/cancel-all', {
      method: 'POST',
    }),

  listDownloads: () =>
    requestJson<{ items: DownloadJobRecord[]; missingCount?: number }>('/api/downloads'),

  redownloadMissingModels: (payload?: { jobId?: number | null; filename?: string | null }) =>
    requestJson<{
      queuedCount: number;
      jobs: DownloadJobRecord[];
      missingCount: number;
    }>('/api/downloads/redownload-missing', {
      method: 'POST',
      body: JSON.stringify(payload || {}),
    }),

  listWorkflows: () => requestJson<{ items: WorkflowLibraryItem[] }>('/api/workflows'),

  getWorkflow: (id: number) =>
    requestJson<{ workflow: WorkflowDetailRecord }>(`/api/workflows/${id}`),

  saveWorkflow: (payload: {
    id?: number;
    name: string;
    description?: string;
    visualWorkflowJson?: string | null;
    apiWorkflowJson?: string | null;
    isDefault?: boolean;
  }) =>
    requestJson<{ workflow: WorkflowDetailRecord }>('/api/workflows', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  setDefaultWorkflow: (id: number) =>
    requestJson<{ ok: boolean; workflow: WorkflowDetailRecord }>(
      `/api/workflows/${id}/set-default`,
      {
        method: 'POST',
      }
    ),

  testComfyUi: (baseUrl?: string) =>
    requestJson<ComfyUiTestResponse>('/api/comfyui/test', {
      method: 'POST',
      body: JSON.stringify({ baseUrl }),
    }),

  getComfyUiLiveStatus: () => requestJson<ComfyUiLiveStatus>('/api/comfyui/live-status'),

  cancelComfyUiJob: (payload: {
    itemId?: number | null;
    batchId?: number | null;
    comfyuiPromptId?: string | null;
  }) =>
    requestJson<{
      ok: boolean;
      kind: 'batch' | 'reproduction' | 'queue_item';
      cancelledItems: number;
      cancelledPrompts: string[];
      interrupted: boolean;
    }>('/api/comfyui/cancel', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  validateReproduction: (payload: { imageId?: number; workflowId?: number }) =>
    requestJson<ReproductionValidationResult>('/api/reproduce/validate', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  submitReproduction: (payload: {
    imageId?: number;
    workflowId?: number;
    positivePrompt?: string;
    loras?: Array<{ loraName: string; modelStrength: number; clipStrength?: number }>;
    generationParams?: {
      checkpointName?: string | null;
      vaeName?: string | null;
      seed?: string | number | null;
      steps?: number | null;
      cfg?: number | null;
      sampler?: string | null;
      scheduler?: string | null;
      denoise?: number | null;
      batchSize?: number | null;
    };
  }) =>
    requestJson<{ job: ReproductionJobRecord }>('/api/reproduce/submit', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  listReproductionJobs: () => requestJson<{ items: ReproductionJobRecord[] }>('/api/reproduce/jobs'),

  // Backups
  getBackups: () =>
    requestJson<{ integrityOk: boolean; backups: DatabaseBackupEntry[] }>('/api/backups'),

  createBackup: (label = 'manual') =>
    requestJson<{ backup: DatabaseBackupEntry }>('/api/backups/create', {
      method: 'POST',
      body: JSON.stringify({ label }),
    }),

  restoreAnnotationsJson: (payload: Record<string, unknown>) =>
    requestJson<{ ok: boolean; restoredCounts: Record<string, number> }>(
      '/api/backups/annotations-restore',
      { method: 'POST', body: JSON.stringify(payload) }
    ),

  // Generation Studio
  listPromptTemplates: () =>
    requestJson<{ items: PromptTemplate[] }>('/api/generation/templates'),

  savePromptTemplate: (payload: {
    id?: number;
    name: string;
    positiveTemplate: string;
    negativeTemplate?: string;
    isDefault?: boolean;
    category?: string;
  }) =>
    requestJson<{ template: PromptTemplate; items: PromptTemplate[] }>(
      '/api/generation/templates',
      { method: 'POST', body: JSON.stringify(payload) }
    ),

  deletePromptTemplate: (id: number) =>
    requestJson<{ ok: boolean; items: PromptTemplate[] }>(
      `/api/generation/templates/${id}`,
      { method: 'DELETE' }
    ),

  getLmStudioStatus: (baseUrl?: string) =>
    requestJson<LmStudioStatus>(
      `/api/generation/lmstudio/status${baseUrl ? `?baseUrl=${encodeURIComponent(baseUrl)}` : ''}`
    ),

  updateLmStudioConfig: (payload: {
    baseUrl?: string;
    selectedModel?: string;
    followLoadedModel?: boolean;
    systemPrompt?: string;
    conversationSystemPrompt?: string;
    batchExpansionPrompt?: string;
  }) =>
    requestJson<LmStudioStatus>('/api/generation/lmstudio/config', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  listLmStudioGuidingTemplates: () =>
    requestJson<{ items: LmStudioGuidingTemplate[] }>('/api/generation/lmstudio/templates'),

  saveLmStudioGuidingTemplate: (payload: {
    id?: number;
    name: string;
    systemPrompt: string;
    userPromptTemplate: string;
    isDefault?: boolean;
  }) =>
    requestJson<{ template: LmStudioGuidingTemplate; items: LmStudioGuidingTemplate[] }>(
      '/api/generation/lmstudio/templates',
      { method: 'POST', body: JSON.stringify(payload) }
    ),

  deleteLmStudioGuidingTemplate: (id: number) =>
    requestJson<{ ok: boolean; items: LmStudioGuidingTemplate[] }>(
      `/api/generation/lmstudio/templates/${id}`,
      { method: 'DELETE' }
    ),

  generateSetPromptsWithAgent: (payload: {
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
    chatMessages?: Array<{ role: string; content: string }>;
  }) =>
    requestJson<{
      prompts: string[];
      usedLmStudio: boolean;
      modelUsed: string;
      guidingTemplateName: string;
      sentSystemPrompt: string;
      sentUserPrompt: string;
      warning?: string;
    }>('/api/generation/lmstudio/generate-prompts', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  submitAgentBatch: (payload: {
    characterId?: number | null;
    characterName?: string;
    characterDescription?: string;
    characterPhysicalDescription?: string;
    workflowId: number;
    theme: string;
    count: number;
    aspectRatio: string;
    megapixels?: number;
    steps?: number;
    triggerWord?: string;
    negativePrompt?: string;
    loras: GenerationLoraSelection[];
    checkpointName?: string;
    seriesId?: number | null;
    branchFromImageId?: number | null;
    inspirationFilename?: string | null;
    chatMessages?: Array<{ role: string; content: string }>;
    chatSnapshot?: QuickGenChatMessage[];
  }) =>
    requestJson<{
      batch: GenerationBatchRecord;
      batches: GenerationBatchRecord[];
      totalCount: number;
      usedLmStudio: boolean;
    }>('/api/generation/lmstudio/submit-agent-batch', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  chatQuickGenPrompt: (payload: {
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
  }) =>
    requestJson<{
      reply: string;
      proposedPrompt: string | null;
      proposalKind?: 'prompt' | 'concept';
      selectedLoras?: string[];
      selectedPreset?: { id: number; name: string; nickname: string } | null;
      modelUsed: string;
    }>('/api/generation/lmstudio/chat', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  interrogateImage: (payload: {
    imageBase64DataUrl: string;
    characterName?: string;
    userHint?: string;
  }) =>
    requestJson<{
      prompt: string;
      pipelineUsed: 'vision' | 'wd14_text';
      tags: string[];
      modelUsed: string;
      savedFilename?: string | null;
    }>('/api/generation/interrogate-image', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  listGenerationBatches: () =>
    requestJson<{ items: GenerationBatchRecord[] }>('/api/generation/batches'),

  submitGenerationBatch: (payload: {
    characterId?: number | null;
    workflowId: number;
    mode: 'single' | 'theme_set';
    themeTitle?: string;
    aspectRatio: string;
    megapixels?: number;
    steps?: number;
    prompts: string[];
    triggerWord?: string;
    negativePrompt: string;
    loras: GenerationLoraSelection[];
    checkpointName?: string;
    baseSeed?: number;
    seriesId?: number | null;
    branchFromImageId?: number | null;
    inspirationFilename?: string | null;
    chatSnapshot?: QuickGenChatMessage[];
  }) =>
    requestJson<{ batch: GenerationBatchRecord; batches: GenerationBatchRecord[] }>(
      '/api/generation/submit-batch',
      { method: 'POST', body: JSON.stringify(payload) }
    ),

  triggerRandomRoll: (payload?: { characterId?: number | null; count?: number }) => {
    const bodyPayload: { characterId?: number; count?: number } = {};
    if (payload?.characterId) bodyPayload.characterId = payload.characterId;
    if (payload?.count && payload.count > 1) bodyPayload.count = payload.count;
    return requestJson<{
      batch: GenerationBatchRecord;
      batches: GenerationBatchRecord[];
      rollSummary: {
        characterId: number;
        characterName: string;
        checkpointName: string | null;
        loraNames: string[];
        tags: string[];
        aspectRatio: string;
        usedLmStudio: boolean;
        prompt: string;
        totalCount?: number;
      };
    }>('/api/generation/random-roll', {
      method: 'POST',
      body: JSON.stringify(bodyPayload),
    });
  },

  // Visual Keyword Tagger (WD14 ONNX)
  getVisualTaggerStatus: () => requestJson<VisualTaggerStatus>('/api/tagger/status'),

  updateVisualTaggerConfig: (payload: {
    enabled?: boolean;
    threshold?: number;
    device?: 'cpu' | 'gpu';
  }) =>
    requestJson<VisualTaggerStatus>('/api/tagger/config', {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }),

  controlVisualTaggerQueue: (
    action: 'pause' | 'resume' | 'scan_unindexed' | 'rescan_all'
  ) =>
    requestJson<VisualTaggerStatus>('/api/tagger/control', {
      method: 'POST',
      body: JSON.stringify({ action }),
    }),

  rescanImageVisualTags: (imageId: number) =>
    requestJson<{ ok: boolean; visualTags: VisualTagItem[] }>(
      `/api/images/${imageId}/visual-tags/rescan`,
      { method: 'POST' }
    ),

  removeImageVisualTag: (imageId: number, tag: string) =>
    requestJson<{ ok: boolean; visualTags: VisualTagItem[] }>(
      `/api/images/${imageId}/visual-tags/${encodeURIComponent(tag)}`,
      { method: 'DELETE' }
    ),

  upscaleImage: (imageId: number, targetMegapixels: number) =>
    requestJson<{
      ok: boolean;
      promptId: string;
      targetMegapixels: number;
      sourceFilename: string;
    }>(`/api/images/${imageId}/upscale`, {
      method: 'POST',
      body: JSON.stringify({ targetMegapixels }),
    }),

  // Help & README Docs Assistant
  getHelpReadme: () => requestJson<HelpReadmePayload>('/api/help/readme'),

  askHelpAssistant: (messages: Array<{ role: 'user' | 'assistant'; content: string }>) =>
    requestJson<{
      reply: string;
      matchedSections: Array<{ id: string; title: string }>;
      modelUsed: string;
    }>('/api/help/ask', {
      method: 'POST',
      body: JSON.stringify({ messages }),
    }),

  // System Generation Stats
  getGenerationStats: (params: {
    period: StatsPeriod;
    granularity: StatsGranularity;
    anchorDate: string;
    tzOffsetMinutes: number;
  }) => {
    const qs = new URLSearchParams({
      period: params.period,
      granularity: params.granularity,
      anchorDate: params.anchorDate,
      tzOffsetMinutes: String(params.tzOffsetMinutes),
    });
    return requestJson<GenerationStatsResponse>(`/api/stats/generations?${qs.toString()}`);
  },

  getStorageStats: () => requestJson<StorageUsageStatsResponse>('/api/stats/storage'),

  getLibraryUsageStats: () => requestJson<LibraryUsageStatsResponse>('/api/stats/library-usage'),

  importCivitaiImageUrl: (url: string) =>
    requestJson<CivitaiImageImportResult>('/api/generation/civitai-image', {
      method: 'POST',
      body: JSON.stringify({ url }),
    }),
};
