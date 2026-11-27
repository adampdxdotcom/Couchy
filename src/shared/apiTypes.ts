import type {
  ModelCleanupStatus,
  PillTypeSettings,
  VisualTaggerStatus,
} from './types.ts';

export interface ComfyUiInstanceRecord {
  id: number;
  name: string;
  base_url: string;
  is_default: number;
  last_status: string;
  last_checked_at: string | null;
  system_stats_json: string | null;
}

export interface ScanJobRecord {
  id: number;
  status: string;
  scan_type: string;
  total_files: number;
  processed_files: number;
  added_count: number;
  modified_count: number;
  deleted_count: number;
  error_log: string;
  started_at: string;
  completed_at: string | null;
}

export interface HealthConfigSnapshot {
  comfyuiUrl: string;
  comfyuiOutputDir: string;
  comfyuiModelsDir: string;
  databasePath: string;
  thumbnailPath: string;
  localModelsDir: string;
  downloadsDir: string;
  uploadedImagesDir: string;
  hasCivitaiKey: boolean;
  hasHfToken: boolean;
  scheduledBackupHours: number;
  quickGenBoxEnabled: boolean;
  saveUploadedPromptImages: boolean;
  saveCivitaiImportImages: boolean;
  allowCivitaiShareUncharacterized: boolean;
  civitaiActivityNotificationsEnabled: boolean;
  insertCouchyMetadataOnExport: boolean;
  insertCivitaiMetadataOnExport: boolean;
  galleryPillColorsEnabled: boolean;
  pillTypeSettings: PillTypeSettings;
  autoCleanCopiedModels: boolean;
  autoCleanCopiedModelsHours: number;
}

export interface HealthResponse {
  status: 'ok';
  counts: {
    images: number;
    characters: number;
    loras: number;
    workflows: number;
  };
  config: HealthConfigSnapshot;
  comfyuiInstance: ComfyUiInstanceRecord | null;
  activeScan: ScanJobRecord | null;
  visualTagger: VisualTaggerStatus;
  modelCleanup: ModelCleanupStatus;
}

export interface UpdateConfigPayload {
  comfyuiUrl?: string;
  comfyuiOutputDir?: string;
  comfyuiModelsDir?: string;
  downloadsDir?: string;
  scheduledBackupHours?: number;
  quickGenBoxEnabled?: boolean;
  saveUploadedPromptImages?: boolean;
  saveCivitaiImportImages?: boolean;
  allowCivitaiShareUncharacterized?: boolean;
  civitaiActivityNotificationsEnabled?: boolean;
  insertCouchyMetadataOnExport?: boolean;
  insertCivitaiMetadataOnExport?: boolean;
  galleryPillColorsEnabled?: boolean;
  pillTypeSettings?: PillTypeSettings;
}

export interface CivitaiActivityAlertSummary {
  imageCount: number;
  singleImageId: number | null;
  reactionCount: number;
  commentCount: number;
}

export interface CivitaiUnseenActivityItem {
  imageId: number;
  reactionCount: number;
  commentCount: number;
  hasUnseenActivity: boolean;
}

export interface DatabaseBackupEntry {
  filename: string;
  sizeBytes: number;
  createdAt: string;
  type: 'sqlite_binary' | 'annotations_json';
}

export interface DownloadJobRecord {
  id: number;
  provider: string;
  model_name: string;
  model_type: string;
  source_url: string;
  destination_path: string;
  expected_hash: string | null;
  actual_hash: string | null;
  hash_verified: number;
  status: string;
  bytes_downloaded: number;
  total_bytes: number;
  error_message: string | null;
  created_at: string;
  completed_at: string | null;
  scheduled_for?: string | null;
  payload_json?: string | null;
  early_access_ends_at?: string | null;
  model_id?: number | null;
  preview_url?: string | null;
  civitai_url?: string | null;
  lora_category?: string | null;
  character_id?: number | null;
  character_name?: string | null;
}

export interface WorkflowDetailRecord {
  id: number;
  name: string;
  description: string;
  is_saved_library: number;
  is_default?: number;
  visual_workflow_json: string | null;
  api_workflow_json: string | null;
  workflow_hash: string;
  created_at: string;
  updated_at: string;
}

export interface ReproductionJobRecord {
  id: number;
  source_image_id: number | null;
  workflow_id: number | null;
  comfyui_prompt_id: string | null;
  status: string;
  readiness_status: string;
  missing_dependencies_json: string;
  execution_error: string | null;
  output_image_ids_json: string;
  submitted_at: string;
  completed_at: string | null;
  workflow_name?: string | null;
  source_filename?: string | null;
}

export interface ModelImpactReport {
  modelName: string;
  dependentImageCount: number;
  dependentWorkflowCount: number;
  images: Array<{
    id: number;
    filename: string;
    file_mtime: string;
    rating: number | null;
  }>;
  workflows: Array<{
    id: number;
    name: string;
    is_saved_library: number;
  }>;
  characters: Array<{
    id: number;
    name: string;
    appearanceLabel: string | null;
  }>;
}

export interface ComfyUiTestResponse {
  online: boolean;
  baseUrl: string;
  systemStats: Record<string, unknown> | null;
  error: string | null;
}

export interface ReadinessCheckItem {
  id: 'comfyui' | 'nodes' | 'default_unet' | 'support_models' | 'library_scan' | 'local_llm';
  label: string;
  ok: boolean;
  optional?: boolean;
  detail: string;
}

export interface GenerationReadinessResponse {
  ready: boolean;
  needsAttention: boolean;
  comfyuiOnline: boolean;
  comfyuiUrl: string;
  llmOnline: boolean;
  defaultWorkflowId: number | null;
  defaultWorkflowName: string | null;
  defaultUnetName: string;
  availableUnets: string[];
  checks: ReadinessCheckItem[];
  checkedAt: string;
}

export type CivitaiDomain = 'civitai.com' | 'civitai.red';

export type CivitaiShareUploadMode = 'original_png' | 'jpeg_exif';

export type CivitaiPostStatus = 'draft' | 'published';

export type CivitaiShareFilterMode =
  | ''
  | 'shared'
  | 'draft'
  | 'published'
  | 'has_activity'
  | 'unseen_activity';

export interface CivitaiReactionBreakdown {
  heartCount: number;
  likeCount: number;
  laughCount: number;
  cryCount: number;
}

export interface CivitaiPostImageStats {
  civitaiImageId: number;
  index: number;
  localImageId: number | null;
  url: string;
  heartCount: number;
  likeCount: number;
  laughCount: number;
  cryCount: number;
  commentCount: number;
}

export interface CivitaiCommentRecord {
  id: number;
  targetType: 'image' | 'post' | 'model';
  civitaiPostId: number;
  civitaiImageId: number | null;
  localImageId: number | null;
  localFilename?: string | null;
  localThumbnailUrl?: string | null;
  civitaiUrl: string;
  authorUsername: string;
  authorAvatarUrl: string | null;
  content: string;
  createdAt: string | null;
  reactionCount: number;
  heartCount: number;
  parentCommentId: number | null;
  depth: number;
  isPinned?: boolean;
}

export interface CivitaiModelVersionStats {
  versionId: string;
  versionName: string;
  downloadCount: number;
  thumbsUpCount: number;
  thumbsDownCount: number;
}

export interface CivitaiModelStatsSummary {
  downloadCount: number;
  thumbsUpCount: number;
  thumbsDownCount: number;
  commentCount: number;
  tippedAmountCount: number;
  totalVersionsCount: number;
  matchedVersion?: CivitaiModelVersionStats | null;
}

export interface CivitaiMyUploadVersionItem {
  versionId: string;
  versionName: string;
  baseModel: string | null;
  civitaiUrl: string | null;
  downloadCount: number;
  thumbsUpCount: number;
  thumbsDownCount: number;
  hashes: string[];
  alreadyLinkedModelId?: number | null;
  alreadyLinkedFilename?: string | null;
}

export interface CivitaiMyUploadModelItem {
  civitaiId: string;
  name: string;
  type: string;
  creatorUsername: string;
  domain: CivitaiDomain;
  civitaiUrl: string;
  previewUrl: string | null;
  stats: {
    downloadCount: number;
    thumbsUpCount: number;
    thumbsDownCount: number;
    commentCount: number;
    tippedAmountCount: number;
  };
  versions: CivitaiMyUploadVersionItem[];
}

export interface CivitaiShareSummary {
  status: CivitaiPostStatus;
  totalDrafts: number;
  publishedCount: number;
  reactionCount: number;
  reactionBreakdown?: CivitaiReactionBreakdown;
  commentCount: number;
  hasActivity: boolean;
  hasUnseenActivity: boolean;
  primaryUrl: string;
}

export interface CivitaiDraftRecord {
  id: number;
  civitaiPostId: number;
  draftUrl: string;
  title: string;
  uploadMode: CivitaiShareUploadMode;
  modelVersionId: number | null;
  status: CivitaiPostStatus;
  civitaiImageId: number | null;
  publishedUrl: string | null;
  reactionCount: number;
  reactionBreakdown: CivitaiReactionBreakdown;
  commentCount: number;
  seenReactionCount: number;
  seenCommentCount: number;
  hasUnseenActivity: boolean;
  statsSyncedAt: string | null;
  commentsSyncedAt: string | null;
  postImages: CivitaiPostImageStats[];
  comments: CivitaiCommentRecord[];
  createdAt: string;
}

export interface CivitaiModelVersionCandidate {
  modelVersionId: number;
  label: string;
  modelName: string;
  modelType: string;
  civitaiId: string | null;
  domain: CivitaiDomain;
  source: 'lora' | 'checkpoint';
}

export interface CivitaiShareLinkedCharacter {
  id: number;
  name: string;
  status: 'confirmed' | 'suggested';
  allowCivitaiShare: boolean;
}

export type CivitaiStackExclusionReason =
  | 'standalone_upscale'
  | 'uploaded_reference'
  | 'missing_or_rejected'
  | 'missing_native_metadata'
  | 'character_restricted'
  | 'uncharacterized_disabled';

export interface CivitaiShareStackItem {
  imageId: number;
  stepOrder: number;
  filename: string;
  thumbnailUrl: string;
  width: number;
  height: number;
  fileSizeBytes: number;
  format: string;
  isFavorite: boolean;
  isPoster: boolean;
  prefilledTitle: string;
  prefilledDescription: string;
  tags: string[];
  recommendedDomain: CivitaiDomain;
  recommendedModelVersionId: number | null;
  candidateModelVersions: CivitaiModelVersionCandidate[];
  embeddedResourceNames: string[];
}

export interface CivitaiShareExcludedItem {
  imageId: number;
  stepOrder: number;
  filename: string;
  reasonCode: CivitaiStackExclusionReason;
  reason: string;
}

export interface CivitaiShareStackEligibility {
  seriesId: number;
  eligible: boolean;
  exceedsLimit: boolean;
  disabledReason: string | null;
  totalMembers: number;
  eligibleCount: number;
  posterImageId: number | null;
  representativeImageId: number | null;
  prefilledTitle: string;
  prefilledDescription: string;
  prefilledTags: string[];
  recommendedModelVersionId: number | null;
  recommendedDomain: CivitaiDomain;
  candidateModelVersions: CivitaiModelVersionCandidate[];
  embeddedResourceNames: string[];
  eligibleItems: CivitaiShareStackItem[];
  excludedItems: CivitaiShareExcludedItem[];
}

export interface CivitaiShareEligibilityResponse {
  eligible: boolean;
  hasCivitaiKey: boolean;
  reasons: string[];
  hasNativeMetadata: boolean;
  isStandaloneUpscale: boolean;
  sourceOriginalImageId: number | null;
  fileSizeBytes: number;
  width: number;
  height: number;
  format: string;
  linkedCharacters: CivitaiShareLinkedCharacter[];
  allowUncharacterizedSetting: boolean;
  prefilledTitle: string;
  prefilledDescription: string;
  prefilledTags: string[];
  recommendedModelVersionId: number | null;
  recommendedDomain: CivitaiDomain;
  candidateModelVersions: CivitaiModelVersionCandidate[];
  embeddedResourceNames: string[];
  existingDrafts: CivitaiDraftRecord[];
  stack?: CivitaiShareStackEligibility | null;
}

export interface CivitaiShareDraftRequest {
  title?: string;
  detail?: string;
  tags?: string[];
  modelVersionId?: number | null;
  targetDomain?: CivitaiDomain;
  uploadMode?: CivitaiShareUploadMode;
  shareScope?: 'single' | 'stack';
  selectedImageIds?: number[];
}

export interface CivitaiShareDraftResponse {
  ok: boolean;
  shareScope?: 'single' | 'stack';
  postId: number;
  domain: CivitaiDomain;
  draftUrl: string;
  uploadMode: CivitaiShareUploadMode;
  uploadedCount?: number;
  jpegFallbackCount?: number;
  processingImageIds: number[];
  draft: CivitaiDraftRecord;
}

export interface CivitaiUserProfileBadge {
  id: number | string;
  name: string;
  description: string | null;
  imageUrl: string | null;
  animated: boolean;
}

export interface CivitaiUserProfileLink {
  url: string;
  type: string;
}

export interface CivitaiUserProfileStats {
  uploadCount: number | null;
  followerCount: number | null;
  followingCount: number | null;
  downloadCount: number | null;
  thumbsUpCount: number | null;
  generationCount: number | null;
  tippedAmountCount: number | null;
  leaderboardPosition: number | null;
  leaderboardId: string | null;
}

export interface CivitaiEligibleCharacterCardStats {
  characterId: number;
  hasOwnCivitaiUpload: boolean;
  modelDownloadCount: number;
  modelThumbsUpCount: number;
  modelThumbsDownCount: number;
  photoReactionCount: number;
  photoCommentCount: number;
  publishedPostCount: number;
  draftPostCount: number;
}

export interface CivitaiUserProfileResponse {
  hasCivitaiKey: boolean;
  connected: boolean;
  error: string | null;
  syncedAt: string;
  userId: number | null;
  username: string | null;
  tier: string | null;
  status: string | null;
  isMember: boolean;
  subscriptions: string[];
  isOnboarded: boolean | null;
  muted: boolean;
  isModerator: boolean;
  createdAt: string | null;
  avatarUrl: string | null;
  coverImageUrl: string | null;
  bio: string | null;
  location: string | null;
  nameplate: { name: string | null; color: string | null } | null;
  badges: CivitaiUserProfileBadge[];
  links: CivitaiUserProfileLink[];
  stats: CivitaiUserProfileStats;
  profileUrl: string | null;
  accountSettingsUrl: string;
  couchySummary: {
    eligibleCharacterCount: number;
    totalCharacterCount: number;
    sharedDraftCount: number;
    publishedPostCount: number;
    ownUploadedModelsCount: number;
  };
  eligibleCharacterStats: CivitaiEligibleCharacterCardStats[];
}
