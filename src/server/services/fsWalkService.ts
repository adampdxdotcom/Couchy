import fs from 'fs';
import path from 'path';
import type { ModelType } from '../../shared/types.ts';

export const MODEL_EXTS = new Set([
  '.safetensors',
  '.ckpt',
  '.pt',
  '.pth',
  '.bin',
  '.gguf',
  '.sft',
]);

export const MODEL_DIR_TYPE_MAP: Record<string, ModelType> = {
  checkpoints: 'checkpoint',
  loras: 'lora',
  vae: 'vae',
  controlnet: 'controlnet',
  upscale_models: 'upscaler',
  embeddings: 'embedding',
  clip: 'clip',
  text_encoders: 'clip',
  unet: 'diffusion',
  diffusion_models: 'diffusion',
};

const STAT_CONCURRENCY = 24;

export interface WalkDirectoryOptions {
  /** Optional lowercase extension allowlist (including leading dot, e.g. '.safetensors'). */
  extensions?: ReadonlySet<string>;
  /** Skip dotfiles and dot-directories when true. */
  skipHidden?: boolean;
  /** Stat matched files asynchronously (default true). Set false when only file paths are needed. */
  includeStat?: boolean;
  /** Minimum file size in bytes (only applied when includeStat is true). */
  minSizeBytes?: number;
  /** Initial fallback model type when walking model directories. */
  initialModelType?: ModelType;
  /** Optional directory-name map used to infer modelType & relative category paths. */
  modelTypeByDirName?: Readonly<Record<string, ModelType>>;
}

export interface WalkedFileEntry {
  fullPath: string;
  filename: string;
  relativeToCategory: string;
  modelType: ModelType;
  size: number;
  mtimeMs: number;
}

/**
 * Non-blocking existence check using fs.promises.access.
 */
export async function pathExistsAsync(targetPath: string): Promise<boolean> {
  if (!targetPath) return false;
  try {
    await fs.promises.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Recursively collects files under `rootDir` using async `fs.promises.readdir`
 * and bounded-concurrency `fs.promises.stat`, keeping Node's event loop responsive.
 */
export async function walkDirectoryFilesAsync(
  rootDir: string,
  options: WalkDirectoryOptions = {}
): Promise<WalkedFileEntry[]> {
  if (!rootDir) return [];

  const {
    extensions,
    skipHidden = false,
    includeStat = true,
    minSizeBytes,
    initialModelType = 'other',
    modelTypeByDirName,
  } = options;

  interface CandidateFile {
    fullPath: string;
    filename: string;
    relativeToCategory: string;
    modelType: ModelType;
  }

  const walk = async (
    dir: string,
    currentType: ModelType,
    categoryRoot: string | null
  ): Promise<CandidateFile[]> => {
    let entries: fs.Dirent[];
    try {
      entries = await fs.promises.readdir(dir, { withFileTypes: true });
    } catch {
      return [];
    }

    const filesHere: CandidateFile[] = [];
    const subdirTasks: Promise<CandidateFile[]>[] = [];

    for (const entry of entries) {
      if (skipHidden && entry.name.startsWith('.')) continue;

      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        const mappedType = modelTypeByDirName?.[entry.name.toLowerCase()];
        const nextType = mappedType || currentType;
        const nextCategoryRoot = mappedType ? fullPath : categoryRoot;
        subdirTasks.push(walk(fullPath, nextType, nextCategoryRoot));
      } else if (entry.isFile()) {
        if (extensions && !extensions.has(path.extname(entry.name).toLowerCase())) {
          continue;
        }
        const relativeToCategory = categoryRoot
          ? path.relative(categoryRoot, fullPath).replace(/\\/g, '/') || entry.name
          : entry.name;
        filesHere.push({
          fullPath,
          filename: entry.name,
          relativeToCategory,
          modelType: currentType,
        });
      }
    }

    if (subdirTasks.length === 0) {
      return filesHere;
    }
    const nested = await Promise.all(subdirTasks);
    return filesHere.concat(...nested);
  };

  const candidates = await walk(rootDir, initialModelType, null);
  if (candidates.length === 0) return [];

  if (!includeStat) {
    return candidates.map((c) => ({
      ...c,
      size: 0,
      mtimeMs: 0,
    }));
  }

  const results: WalkedFileEntry[] = [];
  for (let i = 0; i < candidates.length; i += STAT_CONCURRENCY) {
    const batch = candidates.slice(i, i + STAT_CONCURRENCY);
    const batchResults = await Promise.all(
      batch.map(async (c): Promise<WalkedFileEntry | null> => {
        try {
          const stat = await fs.promises.stat(c.fullPath);
          if (!stat.isFile()) return null;
          if (minSizeBytes !== undefined && stat.size < minSizeBytes) return null;
          return {
            ...c,
            size: stat.size,
            mtimeMs: Math.round(stat.mtimeMs),
          };
        } catch {
          return null;
        }
      })
    );
    for (const item of batchResults) {
      if (item) results.push(item);
    }
  }

  return results;
}
