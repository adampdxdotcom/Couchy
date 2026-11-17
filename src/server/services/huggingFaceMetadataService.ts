import path from 'path';
import { appConfig } from '../config.ts';
import { DOWNLOAD_WEIGHT_EXTS, inferSubfolderAndTypeFromPath } from './modelDownloadPaths.ts';
import type { ExternalModelFileOption } from '../../shared/types.ts';

export interface HuggingFaceNormalizedMeta {
  hfRepoId: string;
  hfUrl: string;
  downloadUrl: string | null;
  baseModel: string | null;
  description: string | null;
  previewImages: { url: string; width?: number | null; height?: number | null }[];
  matchedBy: 'repo_id' | 'sha256' | 'filename';
}

const IMAGE_EXTS = new Set(['.png', '.jpg', '.jpeg', '.webp']);

function getHfHeaders(): Record<string, string> {
  const headers: Record<string, string> = {};
  if (appConfig.hfApiToken) {
    headers.Authorization = `Bearer ${appConfig.hfApiToken}`;
  }
  return headers;
}

async function fetchWithTimeout(
  url: string,
  headers: Record<string, string>,
  timeoutMs = 7000
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { headers, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/** Extracts `owner/repo` from an existing HF repo ID or Hugging Face URL. */
export function parseHfRepoId(input?: string | null): string | null {
  const raw = String(input || '').trim();
  if (!raw) return null;
  if (/^https?:\/\//i.test(raw)) {
    const match = raw.match(/huggingface\.co\/([^/\s?#]+\/[^/\s?#]+)/i);
    return match ? match[1].replace(/\.git$/i, '') : null;
  }
  const direct = raw.match(/^([^/\s]+\/[^/\s]+)$/);
  return direct ? direct[1].replace(/\.git$/i, '') : null;
}

function stripYamlFrontmatter(markdown: string): string {
  const trimmed = markdown.replace(/^\uFEFF/, '');
  const match = trimmed.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n?([\s\S]*)$/);
  const body = match ? match[1] : trimmed;
  // Normalize excessive blank lines and keep size manageable
  return body.replace(/\n{3,}/g, '\n\n').trim().slice(0, 16000);
}

function parseBaseModelFromRepoMeta(repoMeta: any): string | null {
  const cardBase = repoMeta?.cardData?.base_model;
  if (typeof cardBase === 'string' && cardBase.trim()) {
    return cardBase.trim().split('/').pop() || cardBase.trim();
  }
  if (Array.isArray(cardBase) && typeof cardBase[0] === 'string' && cardBase[0].trim()) {
    return cardBase[0].trim().split('/').pop() || cardBase[0].trim();
  }
  const tags: string[] = Array.isArray(repoMeta?.tags) ? repoMeta.tags : [];
  for (const tag of tags) {
    if (typeof tag === 'string' && tag.startsWith('base_model:')) {
      const val = tag.slice('base_model:'.length).replace(/^(finetune|quantized|lora):/i, '').trim();
      if (val) return val.split('/').pop() || val;
    }
  }
  return null;
}

function isIgnorableBadgeUrl(url: string): boolean {
  const lower = url.toLowerCase();
  return (
    lower.includes('shields.io') ||
    lower.includes('badge') ||
    lower.includes('huggingface.co/datasets/huggingface/badges') ||
    lower.endsWith('.svg')
  );
}

function extractPreviewUrlsFromReadmeAndTree(
  readmeRaw: string,
  repoId: string,
  treeEntries: any[]
): { url: string; width?: number | null; height?: number | null }[] {
  const candidates: string[] = [];
  const seen = new Set<string>();

  const pushCandidate = (url: string) => {
    const clean = url.trim();
    if (!clean || seen.has(clean) || isIgnorableBadgeUrl(clean)) return;
    seen.add(clean);
    candidates.push(clean);
  };

  // Look for markdown/HTML image references inside README
  const mdRegex = /!\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
  const htmlRegex = /<img[^>]+src=["']([^"']+)["']/gi;

  for (const regex of [mdRegex, htmlRegex]) {
    let m: RegExpExecArray | null;
    while ((m = regex.exec(readmeRaw)) !== null) {
      const ref = m[1].trim();
      if (!ref) continue;
      if (/^https?:\/\//i.test(ref)) {
        const ext = path.extname(ref.split('?')[0]).toLowerCase();
        if (IMAGE_EXTS.has(ext) || ref.includes('huggingface.co')) {
          pushCandidate(ref);
        }
      } else if (!ref.startsWith('data:')) {
        const relPath = ref.replace(/^\.\//, '').replace(/^\/+/, '');
        const ext = path.extname(relPath.split('?')[0]).toLowerCase();
        if (IMAGE_EXTS.has(ext)) {
          const encoded = relPath
            .split('/')
            .map((seg) => encodeURIComponent(seg))
            .join('/');
          pushCandidate(`https://huggingface.co/${repoId}/resolve/main/${encoded}`);
        }
      }
      if (candidates.length >= 4) break;
    }
    if (candidates.length >= 4) break;
  }

  // Fallback to image files hosted in the repository tree
  if (candidates.length < 4 && Array.isArray(treeEntries)) {
    for (const entry of treeEntries) {
      if (entry?.type !== 'file' || typeof entry?.path !== 'string') continue;
      const ext = path.extname(entry.path).toLowerCase();
      if (!IMAGE_EXTS.has(ext)) continue;
      const encoded = entry.path
        .split('/')
        .map((seg: string) => encodeURIComponent(seg))
        .join('/');
      pushCandidate(`https://huggingface.co/${repoId}/resolve/main/${encoded}`);
      if (candidates.length >= 4) break;
    }
  }

  return candidates.slice(0, 4).map((url) => ({ url }));
}

function buildSearchQueries(filename: string, name: string): string[] {
  const stem = (filename || name || '')
    .replace(/\.(safetensors|ckpt|pt|pth|bin|gguf|sft)$/i, '')
    .trim();
  if (!stem) return [];

  const spaced = stem.replace(/[._-]+/g, ' ').replace(/\s+/g, ' ').trim();
  const stripped = spaced
    .replace(/\b(fp8|fp16|bf16|int8|int4|q4|q5|q6|q8|k|s|m|convrot|scaled|pruned|ema|only|rank\d+|v\d+)\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const queries: string[] = [];
  if (spaced) queries.push(spaced);
  if (stripped && stripped.toLowerCase() !== spaced.toLowerCase()) {
    queries.push(stripped);
  }
  const tokens = (stripped || spaced).split(' ').filter((t) => t.length >= 2);
  if (tokens.length >= 2) {
    const shortQuery = tokens.slice(0, 2).join(' ');
    if (!queries.some((q) => q.toLowerCase() === shortQuery.toLowerCase())) {
      queries.push(shortQuery);
    }
  }
  return queries.slice(0, 2);
}

/**
 * Resolves metadata from Hugging Face for a model (Base Model or LoRA):
 * 1) Direct repo lookup when `hfRepoId` or an HF `downloadUrl` is already stored.
 * 2) Search Hugging Face API by filename/stem, verifying exact LFS SHA-256 or filename match.
 */
export async function resolveHuggingFaceModelDetails(params: {
  filename: string;
  name: string;
  sha256?: string | null;
  hfRepoId?: string | null;
  downloadUrl?: string | null;
}): Promise<HuggingFaceNormalizedMeta | null> {
  const headers = getHfHeaders();
  const targetFilenameLower = params.filename.trim().toLowerCase();
  const targetShaLower = params.sha256 ? params.sha256.trim().toLowerCase() : null;

  let resolvedRepoId =
    parseHfRepoId(params.hfRepoId) || parseHfRepoId(params.downloadUrl);
  let resolvedRepoMeta: any = null;
  let resolvedTree: any[] = [];
  let matchedBy: 'repo_id' | 'sha256' | 'filename' = 'repo_id';
  let matchedDownloadUrl: string | null = null;

  const fetchTree = async (repoId: string): Promise<any[]> => {
    try {
      const res = await fetchWithTimeout(
        `https://huggingface.co/api/models/${repoId}/tree/main?recursive=true`,
        headers,
        7000
      );
      if (res.ok) {
        const parsed = await res.json();
        return Array.isArray(parsed) ? parsed : [];
      }
    } catch {
      // ignore tree fetch failure
    }
    return [];
  };

  if (resolvedRepoId) {
    try {
      const res = await fetchWithTimeout(
        `https://huggingface.co/api/models/${resolvedRepoId}?blobs=true`,
        headers,
        7000
      );
      if (res.ok) {
        resolvedRepoMeta = await res.json();
        resolvedTree = await fetchTree(resolvedRepoId);
        const fileMatch = resolvedTree.find(
          (e) =>
            e?.type === 'file' &&
            typeof e.path === 'string' &&
            path.basename(e.path).toLowerCase() === targetFilenameLower
        );
        if (fileMatch?.path) {
          const encoded = fileMatch.path
            .split('/')
            .map((seg: string) => encodeURIComponent(seg))
            .join('/');
          matchedDownloadUrl = `https://huggingface.co/${resolvedRepoId}/resolve/main/${encoded}`;
        }
      } else {
        resolvedRepoId = null;
      }
    } catch {
      resolvedRepoId = null;
    }
  }

  // Fallback: search Hugging Face repositories and match by LFS SHA-256 or exact filename
  if (!resolvedRepoId) {
    const queries = buildSearchQueries(params.filename, params.name);
    const inspectedRepos = new Set<string>();

    for (const query of queries) {
      let repos: any[] = [];
      try {
        const url = new URL('https://huggingface.co/api/models');
        url.searchParams.set('search', query);
        url.searchParams.set('limit', '8');
        url.searchParams.set('full', 'true');
        const res = await fetchWithTimeout(url.toString(), headers, 7000);
        if (!res.ok) continue;
        repos = (await res.json()) as any[];
      } catch {
        continue;
      }

      if (!Array.isArray(repos)) continue;

      // Pass A: quick filename match on repo siblings (or full tree if LFS SHA verification needed)
      for (const repo of repos) {
        const repoId = String(repo?.id || '').trim();
        if (!repoId || inspectedRepos.has(repoId.toLowerCase())) continue;
        inspectedRepos.add(repoId.toLowerCase());

        const siblings = Array.isArray(repo.siblings) ? repo.siblings : [];
        const hasFilenameSibling = siblings.some(
          (s: any) =>
            typeof s?.rfilename === 'string' &&
            path.basename(s.rfilename).toLowerCase() === targetFilenameLower
        );

        // Fetch tree if filename matched (to confirm LFS SHA + gather preview paths),
        // or for top 3 repos when a SHA-256 hash is available
        if (!hasFilenameSibling && (!targetShaLower || inspectedRepos.size > 3)) {
          continue;
        }

        const tree = await fetchTree(repoId);
        if (targetShaLower) {
          const shaHit = tree.find(
            (e) =>
              e?.type === 'file' &&
              typeof e?.lfs?.oid === 'string' &&
              e.lfs.oid.toLowerCase() === targetShaLower
          );
          if (shaHit) {
            resolvedRepoId = repoId;
            resolvedRepoMeta = repo;
            resolvedTree = tree;
            matchedBy = 'sha256';
            const encoded = shaHit.path
              .split('/')
              .map((seg: string) => encodeURIComponent(seg))
              .join('/');
            matchedDownloadUrl = `https://huggingface.co/${repoId}/resolve/main/${encoded}`;
            break;
          }
        }

        if (hasFilenameSibling && !resolvedRepoId) {
          const fileEntry = tree.find(
            (e) =>
              e?.type === 'file' &&
              typeof e.path === 'string' &&
              path.basename(e.path).toLowerCase() === targetFilenameLower
          );
          const siblingEntry = siblings.find(
            (s: any) =>
              typeof s?.rfilename === 'string' &&
              path.basename(s.rfilename).toLowerCase() === targetFilenameLower
          );
          const relPath = String(fileEntry?.path || siblingEntry?.rfilename || '');
          const encoded = relPath
            .split('/')
            .map((seg: string) => encodeURIComponent(seg))
            .join('/');
          resolvedRepoId = repoId;
          resolvedRepoMeta = repo;
          resolvedTree = tree;
          matchedBy = 'filename';
          matchedDownloadUrl = relPath
            ? `https://huggingface.co/${repoId}/resolve/main/${encoded}`
            : null;
          break;
        }
      }

      if (resolvedRepoId) break;
    }
  }

  if (!resolvedRepoId) return null;

  // Fetch README.md Model Card
  let readmeRaw = '';
  try {
    const readmeRes = await fetchWithTimeout(
      `https://huggingface.co/${resolvedRepoId}/raw/main/README.md`,
      headers,
      6500
    );
    if (readmeRes.ok) {
      readmeRaw = await readmeRes.text();
    }
  } catch {
    // Model Card may not exist in minimal weight mirrors
  }

  const description = readmeRaw ? stripYamlFrontmatter(readmeRaw) || null : null;
  const previewImages = extractPreviewUrlsFromReadmeAndTree(
    readmeRaw,
    resolvedRepoId,
    resolvedTree
  );
  const baseModel = parseBaseModelFromRepoMeta(resolvedRepoMeta);

  return {
    hfRepoId: resolvedRepoId,
    hfUrl: `https://huggingface.co/${resolvedRepoId}`,
    downloadUrl: matchedDownloadUrl,
    baseModel,
    description,
    previewImages,
    matchedBy,
  };
}

/**
 * Normalizes a Hugging Face repo ID from a plain `owner/repo` string or full URL.
 */
export function parseHuggingFaceRepoAndFile(input: string): {
  repoId: string;
  branch: string;
  filePath: string | null;
} | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  try {
    if (/^https?:\/\/(www\.)?huggingface\.co\//i.test(trimmed)) {
      const url = new URL(trimmed);
      const parts = url.pathname.split('/').filter(Boolean);
      if (parts.length < 2) return null;
      const repoId = `${parts[0]}/${parts[1]}`;
      if (parts.length >= 4 && (parts[2] === 'blob' || parts[2] === 'resolve' || parts[2] === 'tree')) {
        const branch = parts[3] || 'main';
        const filePath = parts.length > 4 ? decodeURIComponent(parts.slice(4).join('/')) : null;
        return { repoId, branch, filePath };
      }
      return { repoId, branch: 'main', filePath: null };
    }
  } catch {
    return null;
  }

  // Plain owner/repo format
  if (/^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/.test(trimmed)) {
    return { repoId: trimmed, branch: 'main', filePath: null };
  }

  return null;
}

/**
 * Queries Hugging Face Hub for all weight files in a repository (with recursive tree sizes & LFS SHA-256).
 */
export async function listHuggingFaceRepoFiles(
  repoIdInput: string,
  branch = 'main'
): Promise<{
  repoId: string;
  tags: string[];
  downloads: number;
  files: ExternalModelFileOption[];
}> {
  const parsed = parseHuggingFaceRepoAndFile(repoIdInput);
  const repoId = parsed ? parsed.repoId : repoIdInput.trim();
  const targetBranch = parsed?.branch || branch || 'main';
  const headers = getHfHeaders();

  const metaRes = await fetch(`https://huggingface.co/api/models/${repoId}`, { headers });
  if (!metaRes.ok) {
    throw new Error(`Hugging Face repository "${repoId}" not found (HTTP ${metaRes.status})`);
  }
  const repoMeta = (await metaRes.json()) as any;
  const tags: string[] = Array.isArray(repoMeta.tags) ? repoMeta.tags : [];

  // Fetch recursive tree for exact file sizes and LFS SHA-256 hashes
  let treeEntries: any[] = [];
  try {
    const treeRes = await fetch(
      `https://huggingface.co/api/models/${repoId}/tree/${encodeURIComponent(targetBranch)}?recursive=true`,
      { headers }
    );
    if (treeRes.ok) {
      treeEntries = (await treeRes.json()) as any[];
    }
  } catch {
    // Fallback to repoMeta.siblings below
  }

  const files: ExternalModelFileOption[] = [];

  if (treeEntries.length > 0) {
    for (const entry of treeEntries) {
      if (entry.type !== 'file' || !entry.path) continue;
      const rfilename = String(entry.path);
      const ext = path.extname(rfilename).toLowerCase();
      if (!DOWNLOAD_WEIGHT_EXTS.has(ext)) continue;

      const inferred = inferSubfolderAndTypeFromPath(rfilename, tags);
      const encodedPath = rfilename
        .split('/')
        .map((seg) => encodeURIComponent(seg))
        .join('/');

      files.push({
        rfilename,
        filename: path.basename(rfilename),
        fileSize: typeof entry.size === 'number' ? entry.size : entry.lfs?.size ?? null,
        sha256Hash: entry.lfs?.oid ? String(entry.lfs.oid).toUpperCase() : null,
        downloadUrl: `https://huggingface.co/${repoId}/resolve/${encodeURIComponent(targetBranch)}/${encodedPath}`,
        modelType: inferred.modelType,
        suggestedSubfolder: inferred.suggestedSubfolder,
      });
    }
  } else {
    const siblings = Array.isArray(repoMeta.siblings) ? repoMeta.siblings : [];
    for (const s of siblings) {
      const rfilename = String(s.rfilename || '');
      const ext = path.extname(rfilename).toLowerCase();
      if (!DOWNLOAD_WEIGHT_EXTS.has(ext)) continue;

      const inferred = inferSubfolderAndTypeFromPath(rfilename, tags);
      const encodedPath = rfilename
        .split('/')
        .map((seg) => encodeURIComponent(seg))
        .join('/');

      files.push({
        rfilename,
        filename: path.basename(rfilename),
        fileSize: typeof s.size === 'number' ? s.size : s.lfs?.size ?? null,
        sha256Hash: s.lfs?.oid ? String(s.lfs.oid).toUpperCase() : null,
        downloadUrl: `https://huggingface.co/${repoId}/resolve/${encodeURIComponent(targetBranch)}/${encodedPath}`,
        modelType: inferred.modelType,
        suggestedSubfolder: inferred.suggestedSubfolder,
      });
    }
  }

  return {
    repoId,
    tags,
    downloads: Number(repoMeta.downloads || 0),
    files,
  };
}
