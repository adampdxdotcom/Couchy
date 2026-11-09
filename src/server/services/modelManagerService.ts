import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { Readable } from 'stream';
import { db } from '../db.ts';
import { appConfig } from '../config.ts';
import { syncModelInventory } from './comfyuiService.ts';
import type { ModelType } from '../../shared/types.ts';

export interface ExternalModelSearchResult {
  provider: 'civitai' | 'huggingface';
  id: string;
  name: string;
  modelType: ModelType;
  versionName: string;
  filename: string;
  fileSize: number | null;
  sha256Hash: string | null;
  downloadUrl: string;
  creator: string;
  description: string;
}

/**
 * Searches Civitai REST API for LoRAs and Checkpoints by query or SHA-256/AutoV2 hash.
 */
export async function searchCivitaiModels(query: string, typeFilter?: string): Promise<ExternalModelSearchResult[]> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (appConfig.civitaiApiKey) {
    headers.Authorization = `Bearer ${appConfig.civitaiApiKey}`;
  }

  // If query looks like a hash (10 to 64 hex chars), try hash lookup endpoint first
  if (/^[a-fA-F0-9]{10,64}$/.test(query.trim())) {
    try {
      const hashRes = await fetch(
        `https://civitai.com/api/v1/model-versions/by-hash/${encodeURIComponent(query.trim())}`,
        { headers }
      );
      if (hashRes.ok) {
        const ver = (await hashRes.json()) as any;
        const primaryFile = (ver.files || [])[0];
        if (primaryFile) {
          return [
            {
              provider: 'civitai',
              id: String(ver.modelId || ver.id),
              name: ver.model?.name || primaryFile.name,
              modelType: ver.model?.type?.toLowerCase() === 'checkpoint' ? 'checkpoint' : 'lora',
              versionName: ver.name || 'v1.0',
              filename: primaryFile.name,
              fileSize: primaryFile.sizeKB ? Math.round(primaryFile.sizeKB * 1024) : null,
              sha256Hash: primaryFile.hashes?.SHA256 || null,
              downloadUrl: primaryFile.downloadUrl || ver.downloadUrl,
              creator: ver.model?.creator?.username || 'Civitai Creator',
              description: `Matched exact model hash ${query.trim()}`,
            },
          ];
        }
      }
    } catch {
      // fall through to keyword search
    }
  }

  const url = new URL('https://civitai.com/api/v1/models');
  url.searchParams.set('limit', '12');
  if (query.trim()) url.searchParams.set('query', query.trim());
  if (typeFilter === 'checkpoint') url.searchParams.set('types', 'Checkpoint');
  else if (typeFilter === 'lora') url.searchParams.set('types', 'LORA');

  const res = await fetch(url.toString(), { headers });
  if (!res.ok) {
    throw new Error(`Civitai API returned HTTP ${res.status}`);
  }
  const data = (await res.json()) as { items?: any[] };
  const results: ExternalModelSearchResult[] = [];

  for (const item of data.items || []) {
    const latestVer = (item.modelVersions || [])[0];
    if (!latestVer) continue;
    const file = (latestVer.files || [])[0];
    if (!file) continue;

    results.push({
      provider: 'civitai',
      id: String(item.id),
      name: item.name,
      modelType: String(item.type).toLowerCase() === 'checkpoint' ? 'checkpoint' : 'lora',
      versionName: latestVer.name || 'Latest',
      filename: file.name || `${item.name.replace(/\s+/g, '_')}.safetensors`,
      fileSize: file.sizeKB ? Math.round(file.sizeKB * 1024) : null,
      sha256Hash: file.hashes?.SHA256 || null,
      downloadUrl: file.downloadUrl || latestVer.downloadUrl,
      creator: item.creator?.username || 'Unknown',
      description: String(item.description || '').replace(/<[^>]+>/g, '').slice(0, 220),
    });
  }

  return results;
}

/**
 * Searches Hugging Face Hub API for Safetensors LoRAs and Checkpoints.
 */
export async function searchHuggingFaceModels(query: string): Promise<ExternalModelSearchResult[]> {
  const headers: Record<string, string> = {};
  if (appConfig.hfApiToken) {
    headers.Authorization = `Bearer ${appConfig.hfApiToken}`;
  }

  const url = new URL('https://huggingface.co/api/models');
  url.searchParams.set('search', query.trim() || 'safetensors lora');
  url.searchParams.set('limit', '12');
  url.searchParams.set('full', 'true');

  const res = await fetch(url.toString(), { headers });
  if (!res.ok) {
    throw new Error(`Hugging Face API returned HTTP ${res.status}`);
  }
  const items = (await res.json()) as any[];
  const results: ExternalModelSearchResult[] = [];

  for (const repo of items || []) {
    const siblings = Array.isArray(repo.siblings) ? repo.siblings : [];
    const safetensorFile = siblings.find((s: any) =>
      String(s.rfilename || '').endsWith('.safetensors')
    );
    const filename = safetensorFile
      ? path.basename(safetensorFile.rfilename)
      : `${String(repo.id).replace('/', '_')}.safetensors`;
    const rfile = safetensorFile ? safetensorFile.rfilename : 'model.safetensors';

    results.push({
      provider: 'huggingface',
      id: repo.id,
      name: repo.id,
      modelType: (repo.tags || []).includes('lora') ? 'lora' : 'checkpoint',
      versionName: 'main',
      filename,
      fileSize: null,
      sha256Hash: null,
      downloadUrl: `https://huggingface.co/${repo.id}/resolve/main/${rfile}`,
      creator: String(repo.id).split('/')[0] || 'HuggingFace',
      description: `Hugging Face repository ${repo.id} (${repo.downloads || 0} downloads)`,
    });
  }

  return results;
}

/**
 * Initiates a server-side model download after explicit user confirmation.
 * Validates destination path, checks duplicate overwrite protection, streams to a .part file,
 * and verifies SHA-256 hash upon completion.
 */
export async function startConfirmedModelDownload(params: {
  provider: 'civitai' | 'huggingface';
  modelName: string;
  filename: string;
  modelType: ModelType;
  sourceUrl: string;
  expectedHash?: string | null;
  subfolder?: string;
  allowOverwrite?: boolean;
}): Promise<any> {
  // Sanitize filename and subfolder against path traversal
  const safeFilename = path.basename(params.filename.trim());
  if (!safeFilename || safeFilename.startsWith('.')) {
    throw new Error('Invalid destination filename.');
  }

  const safeSubfolder = (params.subfolder || params.modelType)
    .replace(/[^a-zA-Z0-9_-]/g, '')
    .toLowerCase();
  const targetDir = path.join(appConfig.downloadsDir, safeSubfolder);
  const resolvedRoot = path.resolve(appConfig.downloadsDir);
  const resolvedTargetDir = path.resolve(targetDir);

  if (!resolvedTargetDir.startsWith(resolvedRoot)) {
    throw new Error('Destination directory validation failed.');
  }

  fs.mkdirSync(resolvedTargetDir, { recursive: true });
  const destinationPath = path.join(resolvedTargetDir, safeFilename);

  if (fs.existsSync(destinationPath) && !params.allowOverwrite) {
    throw new Error(
      `File "${safeFilename}" already exists in ${resolvedTargetDir}. Confirm overwrite explicitly to replace it.`
    );
  }

  const info = db
    .prepare(
      `INSERT INTO download_jobs
        (provider, model_name, model_type, source_url, destination_path, expected_hash, status)
       VALUES (?, ?, ?, ?, ?, ?, 'downloading')`
    )
    .run(
      params.provider,
      params.modelName,
      params.modelType,
      params.sourceUrl,
      destinationPath,
      params.expectedHash || null
    );
  const jobId = Number(info.lastInsertRowid);

  // Stream download asynchronously on the server
  setImmediate(async () => {
    const partPath = `${destinationPath}.part`;
    try {
      const headers: Record<string, string> = {};
      if (params.provider === 'civitai' && appConfig.civitaiApiKey) {
        headers.Authorization = `Bearer ${appConfig.civitaiApiKey}`;
      } else if (params.provider === 'huggingface' && appConfig.hfApiToken) {
        headers.Authorization = `Bearer ${appConfig.hfApiToken}`;
      }

      const res = await fetch(params.sourceUrl, { headers });
      if (!res.ok || !res.body) {
        throw new Error(`Download failed with HTTP ${res.status}`);
      }

      const totalBytes = Number(res.headers.get('content-length') || 0);
      db.prepare('UPDATE download_jobs SET total_bytes = ? WHERE id = ?').run(totalBytes, jobId);

      const hash = crypto.createHash('sha256');
      const fileStream = fs.createWriteStream(partPath);
      let bytesDownloaded = 0;
      let lastUpdate = Date.now();

      const nodeReadable = Readable.fromWeb(res.body as any);
      for await (const chunk of nodeReadable) {
        const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        hash.update(buf);
        fileStream.write(buf);
        bytesDownloaded += buf.length;

        if (Date.now() - lastUpdate > 400) {
          db.prepare('UPDATE download_jobs SET bytes_downloaded = ? WHERE id = ?').run(
            bytesDownloaded,
            jobId
          );
          lastUpdate = Date.now();
        }
      }

      await new Promise<void>((resolve, reject) => {
        fileStream.end((err?: Error | null) => (err ? reject(err) : resolve()));
      });

      const actualHash = hash.digest('hex').toUpperCase();
      const expected = params.expectedHash ? params.expectedHash.trim().toUpperCase() : null;
      const hashVerified = expected ? actualHash === expected || actualHash.startsWith(expected) : true;

      if (expected && !hashVerified) {
        fs.unlinkSync(partPath);
        throw new Error(`Hash mismatch: expected ${expected}, got ${actualHash}`);
      }

      fs.renameSync(partPath, destinationPath);

      db.prepare(
        `UPDATE download_jobs
         SET status = 'completed', bytes_downloaded = ?, actual_hash = ?,
             hash_verified = ?, completed_at = datetime('now')
         WHERE id = ?`
      ).run(bytesDownloaded, actualHash, hashVerified ? 1 : 0, jobId);

      // Register in `models` table and refresh dependency statuses
      db.prepare(
        `INSERT INTO models
          (name, filename, model_type, file_path, file_size, sha256_hash, autov2_hash, is_installed, source_type, download_url, last_seen_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 1, 'filesystem', ?, datetime('now'))
         ON CONFLICT(filename) DO UPDATE SET
           file_path = excluded.file_path,
           file_size = excluded.file_size,
           sha256_hash = excluded.sha256_hash,
           autov2_hash = excluded.autov2_hash,
           is_installed = 1,
           download_url = excluded.download_url,
           last_seen_at = datetime('now')`
      ).run(
        params.modelName,
        safeFilename,
        params.modelType,
        destinationPath,
        bytesDownloaded,
        actualHash.toLowerCase(),
        actualHash.slice(0, 10).toLowerCase(),
        params.sourceUrl
      );

      await syncModelInventory();
    } catch (err: any) {
      if (fs.existsSync(partPath)) {
        try {
          fs.unlinkSync(partPath);
        } catch {
          // ignore cleanup error
        }
      }
      db.prepare(
        `UPDATE download_jobs
         SET status = 'failed', error_message = ?, completed_at = datetime('now')
         WHERE id = ?`
      ).run(err?.message || 'Download error', jobId);
    }
  });

  return db.prepare('SELECT * FROM download_jobs WHERE id = ?').get(jobId);
}
