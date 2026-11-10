import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';

dotenv.config();

/**
 * Resolves a configurable directory path, falling back to a workspace-local path
 * when the Docker absolute default (/data/..., /app/data/..., /downloads) is not writable in non-Docker preview.
 */
function resolveStoragePath(envValue: string | undefined, dockerDefault: string, localFallback: string): string {
  const candidate = envValue?.trim() || dockerDefault;
  try {
    fs.mkdirSync(candidate, { recursive: true });
    return candidate;
  } catch {
    const resolvedLocal = path.resolve(process.cwd(), localFallback);
    fs.mkdirSync(resolvedLocal, { recursive: true });
    return resolvedLocal;
  }
}

function resolveDbFilePath(envValue: string | undefined): string {
  const candidate = envValue?.trim() || '/app/data/gallery.db';
  try {
    fs.mkdirSync(path.dirname(candidate), { recursive: true });
    return candidate;
  } catch {
    const localDir = path.resolve(process.cwd(), 'gallery-data');
    fs.mkdirSync(localDir, { recursive: true });
    return path.join(localDir, 'gallery.db');
  }
}

export interface AppConfig {
  port: number;
  comfyuiUrl: string;
  lmStudioUrl: string;
  comfyuiOutputDir: string;
  comfyuiModelsDir: string;
  databasePath: string;
  thumbnailPath: string;
  backupPath: string;
  localModelsDir: string;
  downloadsDir: string;
  civitaiApiKey: string;
  hfApiToken: string;
  scheduledBackupHours: number;
}

export const appConfig: AppConfig = {
  port: Number(process.env.PORT || 3000),
  comfyuiUrl: (process.env.COMFYUI_URL || 'http://comfyui:8188').replace(/\/+$/, ''),
  lmStudioUrl: (process.env.LM_STUDIO_URL || 'http://localhost:1234/v1').replace(/\/+$/, ''),
  comfyuiOutputDir: resolveStoragePath(process.env.COMFYUI_OUTPUT_DIR, '/data/output', 'mounted-data/output'),
  comfyuiModelsDir: resolveStoragePath(process.env.COMFYUI_MODELS_DIR, '/data/models', 'mounted-data/models'),
  databasePath: resolveDbFilePath(process.env.DATABASE_PATH),
  thumbnailPath: resolveStoragePath(
    process.env.THUMBNAIL_PATH === '/app/data/thumbnails' ? '/data/thumbnails' : process.env.THUMBNAIL_PATH,
    '/data/thumbnails',
    'data/thumbnails'
  ),
  backupPath: resolveStoragePath(process.env.BACKUP_PATH, '/app/data/backups', 'gallery-data/backups'),
  localModelsDir: resolveStoragePath(process.env.LOCAL_MODELS_DIR, '/app/data/local_models', 'data/local_models'),
  downloadsDir: resolveStoragePath(process.env.DOWNLOADS_DIR, '/downloads', 'model-downloads'),
  civitaiApiKey: process.env.CIVITAI_API_KEY || '',
  hfApiToken: process.env.HF_API_TOKEN || '',
  scheduledBackupHours: 0,
};
