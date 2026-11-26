/**
 * Shared TypeScript contracts between Frontend and Backend.
 */
import type {
  CivitaiCommentRecord,
  CivitaiModelStatsSummary,
  CivitaiShareFilterMode,
  CivitaiShareSummary,
} from './apiTypes.ts';

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
  displayName?: string | null;
  nickname?: string | null;
  isInstalled?: boolean;
  isDownloadedPendingImport?: boolean;
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

export type ImageSeriesKind = 'iterative' | 'multi_shot';

export interface ImageSeriesItem {
  seriesId: number;
  imageId: number;
  stepOrder: number;
  filename: string;
  thumbnailUrl: string;
  originalUrl: string;
  width: number;
  height: number;
  isFavorite: boolean;
  rating: number;
  createdAt: string;
  hasChat?: boolean;
  chatSnapshot: QuickGenChatMessage[];
  isUploadedReference?: boolean;
  isRejected?: boolean;
  isArchived?: boolean;
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
  isUploadedReference?: boolean;
  isRandomRoll?: boolean;
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
  // Iteration Series / Conversation Stack
  seriesId?: number | null;
  seriesKind?: ImageSeriesKind;
  seriesCount?: number;
  seriesItems?: ImageSeriesItem[];
  hasChat?: boolean;
  chatSnapshot?: QuickGenChatMessage[];
  // Civitai share status & cached community activity
  civitaiShareSummary?: CivitaiShareSummary | null;
}

export interface PortraitCrop {
  x: number;
  y: number;
  zoom: number;
}

export interface CharacterProfile {
  id: number;
  name: string;
  description: string;
  physicalDescription: string;
  notes: string;
  portraitImageId: number | null;
  portraitContentHash: string | null;
  portraitThumbnailUrl: string | null;
  portraitCrop?: PortraitCrop | null;
  allowCivitaiShare: boolean;
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
    isDownloadedPendingImport?: boolean;
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

export interface FaceMatchResponse {
  matched: boolean;
  character: CharacterProfile | null;
  similarity: number | null;
  facesDetected: number;
  indexedCharactersCount: number;
  bestCandidate?: {
    characterId: number;
    characterName: string;
    similarity: number;
  } | null;
}

export interface ModelPreviewImage {
  filename: string;
  url: string;
  width?: number | null;
  height?: number | null;
  sourceUrl?: string | null;
}

export type ComfyModelSubfolder =
  | 'loras'
  | 'checkpoints'
  | 'diffusion_models'
  | 'unet'
  | 'text_encoders'
  | 'clip'
  | 'vae'
  | 'controlnet'
  | 'upscale_models'
  | 'embeddings';

export interface ExternalModelInstalledInfo {
  isInstalled?: boolean;
  isPartiallyInstalled?: boolean;
  installedFilesCount?: number;
  totalFilesCount?: number;
  installedModelId?: number | null;
  installedFilename?: string | null;
  installedModelType?: ModelType | null;
  installedLoraCategory?: LoraCategory | null;
  installedMatchReason?: 'hash' | 'version_id' | 'filename' | null;
}

export interface ExternalModelFileOption extends ExternalModelInstalledInfo {
  rfilename: string;
  filename: string;
  fileSize: number | null;
  sha256Hash: string | null;
  downloadUrl: string;
  modelType: ModelType;
  suggestedSubfolder: ComfyModelSubfolder;
}

export interface ExternalModelVersionOption extends ExternalModelInstalledInfo {
  versionId: string;
  versionName: string;
  civitaiUrl?: string | null;
  baseModel?: string | null;
  trainedWords?: string[];
  recommendedWeight?: number | null;
  previewImageUrl?: string | null;
  previewImages?: { url: string; width?: number | null; height?: number | null }[];
  civitaiDescription?: string | null;
  filename: string;
  fileSize: number | null;
  sha256Hash: string | null;
  downloadUrl: string;
  modelType: ModelType;
  suggestedSubfolder: ComfyModelSubfolder;
  suggestedLoraCategory?: LoraCategory | null;
  subfolderHint?: string | null;
  availableFiles: ExternalModelFileOption[];
  earlyAccessEndsAt?: string | null;
  isEarlyAccessActive?: boolean;
  availability?: string | null;
  earlyAccessConfig?: {
    downloadPrice?: number | null;
    timeframe?: number | null;
  } | null;
}

export interface ExternalModelSearchResult extends ExternalModelInstalledInfo {
  provider: 'civitai' | 'huggingface' | 'direct';
  id: string;
  versionId?: string | null;
  civitaiUrl?: string | null;
  hfRepoId?: string | null;
  name: string;
  modelType: ModelType;
  suggestedSubfolder?: ComfyModelSubfolder;
  suggestedLoraCategory?: LoraCategory | null;
  subfolderHint?: string | null;
  versionName: string;
  baseModel?: string | null;
  trainedWords?: string[];
  recommendedWeight?: number | null;
  previewImageUrl?: string | null;
  previewImages?: { url: string; width?: number | null; height?: number | null }[];
  civitaiDescription?: string | null;
  filename: string;
  fileSize: number | null;
  sha256Hash: string | null;
  downloadUrl: string;
  creator: string;
  description: string;
  availableFiles?: ExternalModelFileOption[];
  totalRepoFilesCount?: number;
  availableVersions?: ExternalModelVersionOption[];
  earlyAccessEndsAt?: string | null;
  isEarlyAccessActive?: boolean;
  availability?: string | null;
  earlyAccessConfig?: {
    downloadPrice?: number | null;
    timeframe?: number | null;
  } | null;
}

export interface CharacterDownloadAutomation {
  addCharacter: boolean;
  generateHeadshot: boolean;
  characterName: string;
  triggerWord?: string;
}

export interface LoraMentionAutomation {
  mentionEnabled: boolean;
  nickname: string;
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
  isDownloadedPendingImport?: boolean;
  comfyuiPath?: string | null;
  downloadFilePath?: string | null;
  isHidden?: boolean;
  downloadUrl: string | null;
  civitaiId: string | null;
  civitaiVersionId?: string | null;
  civitaiUrl?: string | null;
  baseModel?: string | null;
  recommendedWeight?: number | null;
  civitaiDescription?: string | null;
  previewImages?: ModelPreviewImage[];
  civitaiFetchedAt?: string | null;
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
  characters: {
    id: number;
    name: string;
    appearanceLabel: string;
    portraitThumbnailUrl?: string | null;
    portraitCrop?: PortraitCrop | null;
  }[];
  nickname?: string | null;
  mentionEnabled?: boolean;
  defaultModelStrength?: number;
  defaultClipStrength?: number;
  triggerWord?: string | null;
  llmDescription?: string | null;
  civitaiCreatorUsername?: string | null;
  isOwnCivitaiUpload?: boolean;
  civitaiStats?: CivitaiModelStatsSummary | null;
  civitaiComments?: CivitaiCommentRecord[];
  civitaiStatsSyncedAt?: string | null;
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
  isDownloadedPendingImport?: boolean;
  comfyuiPath?: string | null;
  downloadFilePath?: string | null;
  isHidden?: boolean;
  sourceType: 'filesystem' | 'comfyui_api' | 'historical';
  downloadUrl: string | null;
  civitaiId: string | null;
  civitaiVersionId?: string | null;
  civitaiUrl?: string | null;
  baseModel?: string | null;
  recommendedWeight?: number | null;
  civitaiDescription?: string | null;
  previewImages?: ModelPreviewImage[];
  civitaiFetchedAt?: string | null;
  hfRepoId: string | null;
  userNotes: string | null;
  nickname?: string | null;
  mentionEnabled?: boolean;
  llmDescription?: string | null;
  averageRating?: number;
  lastSeenAt: string;
  dependentImageCount: number;
  dependentWorkflowCount: number;
  civitaiCreatorUsername?: string | null;
  isOwnCivitaiUpload?: boolean;
  civitaiStats?: CivitaiModelStatsSummary | null;
  civitaiComments?: CivitaiCommentRecord[];
  civitaiStatsSyncedAt?: string | null;
}

export interface ModelCleanupCandidate {
  downloadPath: string;
  comfyPath: string;
  filename: string;
  fileSize: number;
  verifiedSha256: string;
  verifiedAt: string;
  eligibleAt: string;
  hoursRemaining: number;
  isEligible: boolean;
}

export interface ModelCleanupStatus {
  enabled: boolean;
  retentionHours: number;
  downloadsDir: string;
  comfyuiModelsDir: string;
  sameDirectoryConflict: boolean;
  isScanning: boolean;
  lastScanAt: string | null;
  lastDeletedCount: number;
  lastDeletedBytes: number;
  lastCleanupAt: string | null;
  totalReclaimableBytes: number;
  eligibleCount: number;
  candidates: ModelCleanupCandidate[];
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
  defaultMegapixels?: number | null;
  defaultAspectRatio?: string | null;
  defaultSteps?: number | null;
  defaultCheckpoint?: string | null;
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
  civitaiShareMode?: CivitaiShareFilterMode;
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

export interface GenerationLoraSelection {
  loraName: string;
  modelStrength: number;
  clipStrength: number;
  triggerWord?: string;
  appearanceLabel?: string;
  nickname?: string;
  showPill?: boolean;
  isCharacterPill?: boolean;
  portraitThumbnailUrl?: string | null;
  portraitCrop?: PortraitCrop | null;
}

export interface GenerationItemRecord {
  id: number;
  batchId: number;
  itemIndex: number;
  prompt: string;
  negativePrompt: string;
  seed: string;
  comfyuiPromptId: string | null;
  status: 'pending' | 'submitted' | 'completed' | 'failed' | 'cancelled';
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
  loraNames?: string[];
  characterId: number | null;
  characterName: string | null;
  outputImageId: number | null;
  targetSeriesId?: number | null;
  targetImageId?: number | null;
  isBranchSplit?: boolean;
  batchTotalCount?: number | null;
  batchCurrentNumber?: number | null;
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

export interface QuickGenChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  proposedPrompt?: string | null;
  proposalKind?: 'prompt' | 'concept';
  expandedPrompts?: string[];
  selectedLoras?: string[];
  excludedLoras?: string[];
  submitted?: boolean;
}

export interface LmStudioStatus {
  online: boolean;
  baseUrl: string;
  selectedModel: string;
  followLoadedModel: boolean;
  loadedModels: string[];
  detectedProvider?: 'lmstudio' | 'ollama' | 'openai_single' | 'openai_multi';
  systemPrompt: string;
  conversationSystemPrompt: string;
  defaultConversationSystemPrompt?: string;
  batchExpansionPrompt: string;
  defaultBatchExpansionPrompt?: string;
  availableModels: string[];
  guidingTemplates: LmStudioGuidingTemplate[];
  apiKeyConfigured?: boolean;
  error: string | null;
}

export interface ComfyUiExecutionErrorNotice {
  id: string;
  promptId: string | null;
  message: string;
  timestamp: number;
  recovery?: {
    prompt: string;
    characterId: number | null;
    aspectRatio: string;
    megapixels: number;
    seriesId: number | null;
    branchFromImageId: number | null;
    chatMessages: QuickGenChatMessage[];
  } | null;
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
  workspaceVersion?: number;
  ghostItems?: QueuedGhostCardItem[];
  lastError?: ComfyUiExecutionErrorNotice | null;
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

export interface HelpDocChapterSummary {
  slug: string;
  title: string;
  filename: string;
  anchorId: string;
}

export interface HelpDocSectionSummary {
  id: string;
  level: number;
  title: string;
  parentTitle: string | null;
  chapterSlug?: string;
  chapterTitle?: string;
}

export interface HelpReadmePayload {
  markdown: string;
  sections: HelpDocSectionSummary[];
  chapters?: HelpDocChapterSummary[];
  source?: 'docs' | 'readme';
  updatedAt: string;
}

export interface HelpChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  matchedSections?: Array<{ id: string; title: string; chapterTitle?: string }>;
  modelUsed?: string;
}

export type PillColorKey =
  | 'indigo'
  | 'emerald'
  | 'amber'
  | 'sky'
  | 'rose'
  | 'violet'
  | 'teal'
  | 'zinc';

/** Custom pill color palette reserved for LoRA Presets (distinct from PillColorKey). */
export type PresetPillColorKey =
  | 'fuchsia'
  | 'cyan'
  | 'orange'
  | 'lime'
  | 'pink'
  | 'purple';

export interface LoraPresetItem {
  id?: number;
  presetId?: number;
  loraName: string;
  modelStrength: number;
  clipStrength: number;
  sortOrder: number;
  displayName?: string;
  triggerWord?: string | null;
  isInstalled?: boolean;
  loraCategory?: LoraCategory;
}

export interface LoraPreset {
  id: number;
  name: string;
  nickname: string;
  userDescription: string;
  agentDescription: string;
  pillColor: PresetPillColorKey;
  checkpointName: string | null;
  checkpointDisplayName?: string | null;
  checkpointInstalled?: boolean;
  items: LoraPresetItem[];
  createdAt: string;
  updatedAt: string;
}

export interface LoraPresetPayload {
  name: string;
  nickname?: string;
  userDescription?: string;
  agentDescription?: string;
  pillColor?: PresetPillColorKey;
  checkpointName?: string | null;
  items: Array<{
    loraName: string;
    modelStrength: number;
    clipStrength: number;
  }>;
}

export type PillEntityType = 'character' | 'baseModel' | 'lora';

export type CustomizableLoraCategory = Exclude<LoraCategory, 'character'>;

export interface PillTypeBehavior {
  color: PillColorKey;
  insertMentionName: boolean;
}

export interface PillTypeSettings {
  character: PillTypeBehavior;
  baseModel: PillTypeBehavior;
  lora: PillTypeBehavior;
  loraCategoryColors?: Partial<Record<CustomizableLoraCategory, PillColorKey>>;
}

export type StatsPeriod = 'day' | 'week' | 'month' | 'year';

export type StatsGranularity =
  | 'hour'
  | 'half_hour'
  | 'quarter_hour'
  | 'day'
  | 'half_day'
  | '6_hour'
  | 'week'
  | 'month';

export interface GenerationStatsBucket {
  key: string;
  label: string;
  shortLabel: string;
  rangeLabel: string;
  count: number;
  /** Alternates 0 / 1 every calendar day (or bucket on week/month aggregates) for contrasting bar colors. */
  dayParity: 0 | 1;
  startIso: string;
  endIso: string;
}

export interface GenerationStatsResponse {
  period: StatsPeriod;
  granularity: StatsGranularity;
  anchorDate: string;
  rangeLabel: string;
  rangeStartIso: string;
  rangeEndIso: string;
  totalCount: number;
  totalAllTime: number;
  latestGenerationIso: string | null;
  peakBucket: {
    label: string;
    rangeLabel: string;
    count: number;
  } | null;
  averagePerBucket: number;
  buckets: GenerationStatsBucket[];
}

export interface StorageCategoryStat {
  count: number;
  sizeBytes: number;
  unsizedCount?: number;
}

export interface StorageUsageStatsResponse {
  comfy: {
    loras: StorageCategoryStat;
    baseModels: StorageCategoryStat;
    photos: StorageCategoryStat;
    totalBytes: number;
  };
  local: {
    importedImages: StorageCategoryStat;
    thumbnails: StorageCategoryStat;
    pendingDeleteModels: StorageCategoryStat & {
      eligibleCount: number;
      retentionHours: number;
      lastScanAt: string | null;
    };
    totalBytes: number;
  };
  totalTrackedBytes: number;
  generatedAt: string;
}

export type UsageRankSortMode = 'usage' | 'roll_score';

export interface UsageRankItem {
  id: number;
  name: string;
  subtitle?: string | null;
  usageCount: number;
  favoriteCount: number;
  rollScore: number;
  rollOddsPercent: number;
  usageRank: number;
  rollRank: number;
  rollEligible: boolean;
  excludedReasons: string[];
  category?: LoraCategory;
  baseModel?: string | null;
  baseGroup?: string | null;
  portraitImageId?: number | null;
}

export interface UsageRankGroup {
  totalCount: number;
  eligibleCount: number;
  totalUses: number;
  totalFavorites: number;
  topByUsage: UsageRankItem | null;
  topByRollScore: UsageRankItem | null;
  items: UsageRankItem[];
}

export interface LoraCategorySummary {
  category: LoraCategory;
  label: string;
  totalCount: number;
  eligibleCount: number;
  totalUses: number;
  topByUsage: UsageRankItem | null;
  topByRollScore: UsageRankItem | null;
}

export interface LibraryUsageStatsResponse {
  characters: UsageRankGroup;
  baseModels: UsageRankGroup;
  loras: UsageRankGroup;
  loraByCategory: LoraCategorySummary[];
  generatedAt: string;
}

export interface CivitaiImageImportResult {
  sourceUrl: string;
  civitaiDomain: 'civitai.com' | 'civitai.red';
  imageId: number;
  prompt: string;
  negativePrompt: string;
  aspectRatio: string | null;
  checkpointName: string | null;
  loras: Array<{
    loraName: string;
    modelStrength: number;
    clipStrength: number;
    triggerWord?: string;
    nickname?: string;
  }>;
  skippedLoras: string[];
  skippedCheckpoint: string | null;
  sourceBaseModel: string | null;
  hasPromptMetadata: boolean;
  inspirationFilename?: string | null;
}

export {
  ASPECT_RATIO_PRESETS,
  RESOLUTION_SELECTOR_OPTIONS,
  type ResolutionSelectorRatio,
  type AspectRatioOption,
  normalizeResolutionSelectorRatio,
} from './utils';


