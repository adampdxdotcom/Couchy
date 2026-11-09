import type {
  CharacterProfile,
  GalleryFilterState,
  ImageRecord,
  LoraCategory,
  LoraExplorerItem,
  ModelInventoryItem,
  ReproductionValidationResult,
  SavedSearchPreset,
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

  getImageDetail: (id: number) =>
    requestJson<{
      image: ImageRecord;
      rawMetadata: Record<string, string>;
      visualWorkflowJson: string | null;
      apiWorkflowJson: string | null;
    }>(`/api/images/${id}`),

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
    a.download = `${params.archiveName || 'comfyui-gallery-export'}.zip`;
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
  }) =>
    requestJson<{ workflow: any }>('/api/workflows', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  testComfyUi: (baseUrl?: string) =>
    requestJson<{ online: boolean; baseUrl: string; systemStats: any; error: string | null }>(
      '/api/comfyui/test',
      { method: 'POST', body: JSON.stringify({ baseUrl }) }
    ),

  validateReproduction: (payload: { imageId?: number; workflowId?: number }) =>
    requestJson<ReproductionValidationResult>('/api/reproduce/validate', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  submitReproduction: (payload: { imageId?: number; workflowId: number }) =>
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
};
