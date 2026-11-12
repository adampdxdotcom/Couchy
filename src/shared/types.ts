/**
 * Shared TypeScript contracts between Frontend and Backend.
 */

export type DependencyStatus = 'exact_match' | 'available' | 'incomplete' | 'unknown';

export type ProvenanceSource =
  | 'embedded_api'
  | 'visual_workflow'
  | 'a1111_parameters'
  | 'inferred_inventory'
  | 'unverified';

export type LoraCategory =
  | 'character'
  | 'style'
  | 'clothing'
  | 'concept'
  | 'pose'
  | 'object'
  | 'other'
  | 'unclassified';

export type ModelType =
  | 'checkpoint'
  | 'lora'
  | 'vae'
  | 'controlnet'
  | 'upscaler'
  | 'embedding'
  | 'clip'
  | 'diffusion'
  | 'other';

export type CharacterAssociationStatus = 'confirmed' | 'suggested' | 'rejected';

export type CharacterSuggestionSource =
  | 'manual'
  | 'bulk'
  | 'lora_match'
  | 'prompt_alias'
  | 'workflow_match';

export interface ImageLoraRecord {
  id: number;
  imageId: number;
  modelId: number | null;
  loraName: string;
  loraPath: string | null;
  loraHash: string | null;
  modelStrength: number;
  clipStrength: number;
  nodeId: string | null;
  nodeType: string | null;
  provenance: ProvenanceSource;
  loraCategory?: LoraCategory;
  isInstalled?: boolean;
}

export interface ImageModelDependency {
  id: number;
  imageId: number;
  modelId: number | null;
  modelName: string;
  modelType: ModelType;
  modelHash: string | null;
  nodeId: string | null;
  nodeType: string | null;
  provenance: ProvenanceSource;
  status: 'exact_match' | 'available' | 'missing' | 'unknown';
}

export interface ImageCharacterLink {
  id: number;
  characterId: number;
  characterName: string;
  status: CharacterAssociationStatus;
  source: CharacterSuggestionSource;
  confidence: number;
  matchReason: string | null;
  appearanceLabel: string | null;
}

export interface ImageTagItem {
  id: number;
  name: string;
  color: string;
}

export interface VisualTagItem {
  tag: string;
  confidence: number;
}

export interface ImageCollectionItem {
  id: number;
  name: string;
}

export interface ImageRecord {
  id: number;
  contentHash: string;
  relativePath: string;
  filename: string;
  fileSize: number;
  width: number;
  height: number;
  format: string;
  createdAt: string;
  fileMtime: string;
  isMissing: boolean;
  thumbnailUrl: string;
  originalUrl: string;
  dependencyStatus: DependencyStatus;
  // User annotations
  rating: number;
  isFavorite: boolean;
  isRejected: boolean;
  isArchived: boolean;
  notes: string;
  favoritedAt: string | null;
  // Metadata summary
  positivePrompt: string | null;
  negativePrompt: string | null;
  seed: string | null;
  steps: number | null;
  cfg: number | null;
  sampler: string | null;
  scheduler: string | null;
  denoise: number | null;
  batchSize: number | null;
  batchIndex: number | null;
  generationDate: string | null;
  checkpointName: string | null;
  checkpointHash: string | null;
  vaeName: string | null;
  missingFields: string[];
  provenance: Record<string, ProvenanceSource>;
  hasVisualWorkflow: boolean;
  hasApiWorkflow: boolean;
  workflowId: number | null;
  // Relations
  loras: ImageLoraRecord[];
  models: ImageModelDependency[];
  characters: ImageCharacterLink[];
  tags: ImageTagItem[];
  visualTags?: VisualTagItem[];
  collections: ImageCollectionItem[];
}

export interface CharacterProfile {
  id: number;
  name: string;
  description: string;
  notes: string;
  portraitImageId: number | null;
  portraitContentHash: string | null;
  portraitThumbnailUrl: string | null;
  aliases: { id: number; alias: string }[];
  loras: {
    id: number;
    modelId: number | null;
    loraName: string;
    loraHash: string | null;
    loraCategory: LoraCategory;
    appearanceLabel: string;
    triggerWord: string;
    notes: string;
    isInstalled: boolean;
  }[];
  workflows: {
    workflowId: number;
    workflowName: string;
    roleLabel: string;
  }[];
  tags: ImageTagItem[];
  collections: ImageCollectionItem[];
  confirmedImageCount: number;
  suggestedImageCount: number;
  averageRating: number;
  firstGenerationDate: string | null;
  latestGenerationDate: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface LoraExplorerItem {
  name: string;
  modelId: number | null;
  filename: string;
  filePath: string | null;
  fileSize: number | null;
  sha256Hash: string | null;
  autov2Hash: string | null;
  loraCategory: LoraCategory;
  isInstalled: boolean;
  downloadUrl: string | null;
  civitaiId: string | null;
  hfRepoId: string | null;
  userNotes: string | null;
  imageCount: number;
  workflowCount: number;
  averageRating: number;
  minModelStrength: number | null;
  maxModelStrength: number | null;
  avgModelStrength: number | null;
  minClipStrength: number | null;
  maxClipStrength: number | null;
  characters: { id: number; name: string; appearanceLabel: string }[];
  nickname?: string | null;
  mentionEnabled?: boolean;
  defaultModelStrength?: number;
  defaultClipStrength?: number;
}

export interface ModelInventoryItem {
  id: number;
  name: string;
  filename: string;
  modelType: ModelType;
  loraCategory: LoraCategory;
  filePath: string | null;
  fileSize: number | null;
  sha256Hash: string | null;
  autov2Hash: string | null;
  isInstalled: boolean;
  sourceType: 'filesystem' | 'comfyui_api' | 'historical';
  downloadUrl: string | null;
  civitaiId: string | null;
  hfRepoId: string | null;
  userNotes: string | null;
  lastSeenAt: string;
  dependentImageCount: number;
  dependentWorkflowCount: number;
}

export interface WorkflowLibraryItem {
  id: number;
  name: string;
  description: string;
  isSavedLibrary: boolean;
  isDefault?: boolean;
  hasVisualWorkflow: boolean;
  hasApiWorkflow: boolean;
  workflowHash: string;
  imageCount: number;
  characters: { id: number; name: string; roleLabel: string }[];
  createdAt: string;
  updatedAt: string;
}

export interface ReproductionValidationResult {
  imageId: number | null;
  workflowId: number;
  workflowFormat: 'api' | 'visual_converted' | 'visual_only' | 'missing';
  canSubmit: boolean;
  readinessStatus: DependencyStatus;
  comfyuiOnline: boolean;
  requiredModels: {
    name: string;
    modelType: ModelType;
    hash: string | null;
    status: 'exact_match' | 'available' | 'missing' | 'unknown';
    reason: string;
  }[];
  requiredNodes: {
    classType: string;
    isAvailable: boolean | null;
  }[];
  warnings: string[];
  apiPromptPayload: Record<string, unknown> | null;
}

export interface SavedSearchPreset {
  id: number;
  name: string;
  queryString: string;
  filterJson: GalleryFilterState;
  createdAt: string;
}

export interface GalleryFilterState {
  query: string;
  sortBy:
    | 'newest'
    | 'oldest'
    | 'rating_desc'
    | 'rating_asc'
    | 'filename'
    | 'filesize'
    | 'checkpoint'
    | 'most_used_lora'
    | 'recently_favorited';
  minRating: number;
  favoritesOnly: boolean;
  rejectedMode: 'exclude' | 'only' | 'include';
  archivedMode: 'exclude' | 'only' | 'include';
  checkpoint: string;
  collectionId: number | null;
  tagIds: number[];
  loras: string[];
  loraMatchMode: 'ANY' | 'ALL';
  minLoraStrength: number | null;
  maxLoraStrength: number | null;
  characterIds: number[];
  characterMatchMode: 'ANY' | 'ALL';
  includeSuggestedCharacters: boolean;
  dependencyStatus: DependencyStatus | '';
  dateFrom: string;
  dateTo: string;
}

export type AspectRatioPreset = '1:1' | '3:4' | '4:3' | '16:9' | '9:16' | '2:3' | '3:2';

export interface PromptTemplate {
  id: number;
  name: string;
  positiveTemplate: string;
  negativeTemplate: string;
  isDefault: boolean;
  category: string;
  createdAt: string;
  updatedAt: string;
}

export interface WorkflowNodeSlotInfo {
  nodeId: string;
  classType: string;
  title: string;
  inputFields: string[];
  currentValues: Record<string, any>;
}

export interface WorkflowNodeMapping {
  workflowId: number;
  isCustomMapped: boolean;
  positivePromptNodeId: string | null;
  positivePromptField: string;
  negativePromptNodeId: string | null;
  negativePromptField: string;
  triggerWordNodeId: string | null;
  triggerWordField: string;
  seedNodeId: string | null;
  seedField: string;
  stepsNodeId: string | null;
  cfgNodeId: string | null;
  samplerNodeId: string | null;
  latentNodeId: string | null;
  aspectRatioField: string;
  megapixelsField: string;
  widthField: string;
  heightField: string;
  batchSizeField: string;
  checkpointNodeId: string | null;
  checkpointField: string;
  enableLoraNodeId: string | null;
  enableLoraField: string;
  loraNodeIds: string[];
  updatedAt?: string;
}

export interface GenerationLoraSelection {
  loraName: string;
  modelStrength: number;
  clipStrength: number;
  triggerWord?: string;
  appearanceLabel?: string;
  nickname?: string;
  showPill?: boolean;
}

export interface GenerationItemRecord {
  id: number;
  batchId: number;
  itemIndex: number;
  prompt: string;
  negativePrompt: string;
  seed: string;
  comfyuiPromptId: string | null;
  status: 'pending' | 'submitted' | 'completed' | 'failed';
  errorMessage: string | null;
  outputImageId: number | null;
  outputThumbnailUrl?: string | null;
  createdAt: string;
  completedAt: string | null;
}

export interface GenerationBatchRecord {
  id: number;
  characterId: number | null;
  characterName: string | null;
  workflowId: number | null;
  workflowName: string | null;
  themeTitle: string | null;
  mode: 'single' | 'theme_set';
  totalCount: number;
  aspectRatio: string;
  megapixels: number;
  width: number;
  height: number;
  checkpointName?: string | null;
  loraCount?: number;
  createdAt: string;
  items: GenerationItemRecord[];
}

export interface QueuedGhostCardItem {
  itemId: number;
  batchId: number;
  itemIndex: number;
  comfyuiPromptId: string | null;
  prompt: string;
  state: 'queued' | 'generating' | 'indexing';
  progressPercent: number | null;
  width: number;
  height: number;
  checkpointName: string | null;
  workflowName: string | null;
  loraCount: number;
  characterId: number | null;
  characterName: string | null;
  outputImageId: number | null;
  createdAt: string;
}

export interface LmStudioGuidingTemplate {
  id: number;
  name: string;
  systemPrompt: string;
  userPromptTemplate: string;
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface LmStudioStatus {
  online: boolean;
  baseUrl: string;
  selectedModel: string;
  systemPrompt: string;
  availableModels: string[];
  guidingTemplates: LmStudioGuidingTemplate[];
  error: string | null;
}

export interface ComfyUiLiveStatus {
  online: boolean;
  runningCount: number;
  queuedCount: number;
  progressPercent: number | null;
  step: number | null;
  maxSteps: number | null;
  currentNode: string | null;
  currentJobIndex?: number | null;
  totalRunJobs?: number | null;
  lastIndexedAt?: number;
  ghostItems?: QueuedGhostCardItem[];
}

export interface AppToastMessage {
  id: string;
  text: string;
  type: 'info' | 'success' | 'warning' | 'error';
  createdAt: string;
}

export interface VisualTaggerStatus {
  enabled: boolean;
  threshold: number;
  device: 'cpu' | 'gpu';
  activeProvider: string;
  localModelsDir: string;
  modelDownloaded: boolean;
  isDownloading: boolean;
  downloadProgressPercent: number;
  downloadedBytes: number;
  totalDownloadBytes: number;
  downloadError: string | null;
  isScanning: boolean;
  isPaused: boolean;
  scannedCount: number;
  totalImagesCount: number;
  pendingCount: number;
  totalVisualTagsCount: number;
  lastError: string | null;
}

export {
  ASPECT_RATIO_PRESETS,
  RESOLUTION_SELECTOR_OPTIONS,
  type ResolutionSelectorRatio,
  type AspectRatioOption,
  normalizeResolutionSelectorRatio,
} from './utils';


