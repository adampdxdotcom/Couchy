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
  galleryPillColorsEnabled?: boolean;
  pillTypeSettings?: PillTypeSettings;
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
