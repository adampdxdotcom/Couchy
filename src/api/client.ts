import type {
  AspectRatioPreset,
  CharacterProfile,
  ComfyUiLiveStatus,
  GalleryFilterState,
  GenerationBatchRecord,
  GenerationLoraSelection,
  ImageRecord,
  LmStudioGuidingTemplate,
  LmStudioStatus,
  LoraCategory,
  LoraExplorerItem,
  ModelInventoryItem,
  PromptTemplate,
  QuickGenChatMessage,
  ReproductionValidationResult,
  SavedSearchPreset,
  VisualTagItem,
  VisualTaggerStatus,
  WorkflowLibraryItem,
} from '../shared/types.ts';

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
  getHealth: () => requestJson<any>('/api/health'),

  updateConfig: (payload: Record<string, any>) =>
    requestJson<any>('/api/config', { method: 'PATCH', body: JSON.stringify(payload) }),

  triggerScan: (scanType: 'incremental' | 'full' | 'reconcile' | 'rebuild_metadata' = 'incremental') =>
    requestJson<{ jobId: number; scan: any }>('/api/scans/trigger', {
      method: 'POST',
      body: JSON.stringify({ scanType }),
    }),

  getScans: () => requestJson<{ active: any; history: any[] }>('/api/scans'),

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

  queryImages: (filters: Partial<GalleryFilterState>) =>
    requestJson<{ items: ImageRecord[]; total: number }>('/api/images/query', {
      method: 'POST',
      body: JSON.stringify(filters),
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
      notes?: string;
      portraitImageId?: number | null;
      aliases?: string[];
      tagIds?: number[];
      collectionIds?: number[];
    }
  ) =>
    requestJson<{ character: CharacterProfile }>(`/api/characters/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
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

  // LoRAs, Models & Workflows
  listLoras: () => requestJson<{ items: LoraExplorerItem[] }>('/api/loras'),

  classifyLora: (loraName: string, loraCategory: LoraCategory, userNotes?: string) =>
    requestJson<{ ok: boolean; items: LoraExplorerItem[] }>('/api/loras/classify', {
      method: 'PATCH',
      body: JSON.stringify({ loraName, loraCategory, userNotes }),
    }),

  updateLoraMentionConfig: (payload: {
    loraName: string;
    mentionEnabled?: boolean;
    nickname?: string | null;
    defaultModelStrength?: number;
    defaultClipStrength?: number;
  }) =>
    requestJson<{ ok: boolean; items: LoraExplorerItem[] }>('/api/loras/mention-config', {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }),

  listModelInventory: () => requestJson<{ items: ModelInventoryItem[] }>('/api/models/inventory'),

  syncModelInventory: () =>
    requestJson<{ items: ModelInventoryItem[] }>('/api/models/sync', { method: 'POST' }),

  getModelImpact: (name: string) =>
    requestJson<{
      modelName: string;
      dependentImageCount: number;
      dependentWorkflowCount: number;
      images: any[];
      workflows: any[];
      characters: any[];
    }>(`/api/models/${encodeURIComponent(name)}/impact`),

  searchCivitai: (q: string, type = '') =>
    requestJson<{ items: any[] }>(
      `/api/models/search/civitai?q=${encodeURIComponent(q)}&type=${encodeURIComponent(type)}`
    ),

  searchHuggingFace: (q: string) =>
    requestJson<{ items: any[] }>(`/api/models/search/huggingface?q=${encodeURIComponent(q)}`),

  startModelDownload: (payload: {
    provider: 'civitai' | 'huggingface';
    modelName: string;
    filename: string;
    modelType: string;
    sourceUrl: string;
    expectedHash?: string | null;
    subfolder?: string;
    allowOverwrite?: boolean;
    userConfirmed: boolean;
  }) =>
    requestJson<{ job: any }>('/api/downloads/start', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  listDownloads: () => requestJson<{ items: any[] }>('/api/downloads'),

  listWorkflows: () => requestJson<{ items: WorkflowLibraryItem[] }>('/api/workflows'),

  getWorkflow: (id: number) => requestJson<{ workflow: any }>(`/api/workflows/${id}`),

  saveWorkflow: (payload: {
    id?: number;
    name: string;
    description?: string;
    visualWorkflowJson?: string | null;
    apiWorkflowJson?: string | null;
    isDefault?: boolean;
  }) =>
    requestJson<{ workflow: any }>('/api/workflows', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  setDefaultWorkflow: (id: number) =>
    requestJson<{ ok: boolean; workflow: any }>(`/api/workflows/${id}/set-default`, {
      method: 'POST',
    }),

  testComfyUi: (baseUrl?: string) =>
    requestJson<{ online: boolean; baseUrl: string; systemStats: any; error: string | null }>(
      '/api/comfyui/test',
      { method: 'POST', body: JSON.stringify({ baseUrl }) }
    ),

  getComfyUiLiveStatus: () => requestJson<ComfyUiLiveStatus>('/api/comfyui/live-status'),

  validateReproduction: (payload: { imageId?: number; workflowId?: number }) =>
    requestJson<ReproductionValidationResult>('/api/reproduce/validate', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  submitReproduction: (payload: {
    imageId?: number;
    workflowId?: number;
    positivePrompt?: string;
  }) =>
    requestJson<{ job: any }>('/api/reproduce/submit', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  listReproductionJobs: () => requestJson<{ items: any[] }>('/api/reproduce/jobs'),

  // Backups
  getBackups: () => requestJson<{ integrityOk: boolean; backups: any[] }>('/api/backups'),

  createBackup: (label = 'manual') =>
    requestJson<{ backup: any }>('/api/backups/create', {
      method: 'POST',
      body: JSON.stringify({ label }),
    }),

  restoreAnnotationsJson: (payload: any) =>
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
    systemPrompt?: string;
    conversationSystemPrompt?: string;
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
    loraNames: string[];
    theme: string;
    count: number;
    basePromptTemplate: string;
    guidingTemplateId?: number;
    modelOverride?: string;
    baseUrlOverride?: string;
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

  chatQuickGenPrompt: (payload: {
    messages: Array<{ role: 'user' | 'assistant'; content: string }>;
    characterName?: string;
    characterDescription?: string;
    loraNames?: string[];
  }) =>
    requestJson<{
      reply: string;
      proposedPrompt: string | null;
      modelUsed: string;
    }>('/api/generation/lmstudio/chat', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  interrogateImage: (payload: { imageBase64DataUrl: string; characterName?: string }) =>
    requestJson<{
      prompt: string;
      pipelineUsed: 'vision' | 'wd14_text';
      tags: string[];
      modelUsed: string;
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
    prompts: string[];
    triggerWord?: string;
    negativePrompt: string;
    loras: GenerationLoraSelection[];
    checkpointName?: string;
    baseSeed?: number;
    seriesId?: number | null;
    branchFromImageId?: number | null;
    chatSnapshot?: QuickGenChatMessage[];
  }) =>
    requestJson<{ batch: GenerationBatchRecord; batches: GenerationBatchRecord[] }>(
      '/api/generation/submit-batch',
      { method: 'POST', body: JSON.stringify(payload) }
    ),

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
};
