import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { db } from '../db.ts';
import { appConfig } from '../config.ts';
import {
  copyImageMetadataToDerivedImage,
  recomputeImageDependencyStatus,
} from './scannerService.ts';
import {
  COUCHY_COMFY_CLIENT_ID,
  invalidateComfyQueueCache,
  registerQueuedPromptSeriesTarget,
} from './comfyuiLiveMonitor.ts';
import {
  compileUpscaleWorkflow,
  injectPositivePromptIntoGraph,
} from './workflowCompilerService.ts';
import { pollComfyPromptCompletion } from './comfyuiPoller.ts';
import { attachUpscaledImageToSeries } from './seriesService.ts';
import type {
  DependencyStatus,
  ModelInventoryItem,
  ModelType,
  ReproductionValidationResult,
} from '../../shared/types.ts';

const MODEL_DIR_TYPE_MAP: Record<string, ModelType> = {
  checkpoints: 'checkpoint',
  loras: 'lora',
  vae: 'vae',
  controlnet: 'controlnet',
  upscale_models: 'upscaler',
  embeddings: 'embedding',
  clip: 'clip',
  unet: 'diffusion',
  diffusion_models: 'diffusion',
};

const MODEL_EXTS = new Set(['.safetensors', '.ckpt', '.pt', '.pth', '.bin']);

/**
 * Tests connection to the configured ComfyUI instance and updates comfyui_instances.
 */
export async function testComfyUiConnection(customUrl?: string): Promise<{
  online: boolean;
  baseUrl: string;
  systemStats: any | null;
  error: string | null;
}> {
  const baseUrl = (customUrl || appConfig.comfyuiUrl).replace(/\/+$/, '');
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3500);
    const res = await fetch(`${baseUrl}/system_stats`, { signal: controller.signal });
    clearTimeout(timer);

    if (!res.ok) {
      throw new Error(`HTTP ${res.status} from ${baseUrl}/system_stats`);
    }
    const stats = await res.json();
    db.prepare(
      `UPDATE comfyui_instances
       SET base_url = ?, last_status = 'online', last_checked_at = datetime('now'), system_stats_json = ?
       WHERE is_default = 1`
    ).run(baseUrl, JSON.stringify(stats));
    appConfig.comfyuiUrl = baseUrl;
    return { online: true, baseUrl, systemStats: stats, error: null };
  } catch (err: any) {
    db.prepare(
      `UPDATE comfyui_instances
       SET base_url = ?, last_status = 'offline', last_checked_at = datetime('now')
       WHERE is_default = 1`
    ).run(baseUrl);
    return {
      online: false,
      baseUrl,
      systemStats: null,
      error: err?.message || 'ComfyUI unreachable',
    };
  }
}

/**
 * Computes SHA-256 and AutoV2 (first 10 chars) for smaller model files (<= 350MB) synchronously,
 * or skips full read if already cached by file_size.
 */
function computeModelHashesIfFeasible(filePath: string, size: number): {
  sha256: string | null;
  autov2: string | null;
} {
  if (size > 350 * 1024 * 1024) {
    return { sha256: null, autov2: null };
  }
  try {
    const hash = crypto.createHash('sha256');
    hash.update(fs.readFileSync(filePath));
    const hex = hash.digest('hex');
    return { sha256: hex, autov2: hex.slice(0, 10) };
  } catch {
    return { sha256: null, autov2: null };
  }
}

/**
 * Inventories installed models from both the mounted COMFYUI_MODELS_DIR (plus DOWNLOADS_DIR)
 * and the live ComfyUI /object_info API when reachable.
 */
export async function syncModelInventory(): Promise<ModelInventoryItem[]> {
  const seenInstalledFilenames = new Set<string>();

  const scanRoot = (rootDir: string, defaultType: ModelType = 'other') => {
    if (!fs.existsSync(rootDir)) return;
    const walk = (dir: string, currentType: ModelType) => {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          const mappedType = MODEL_DIR_TYPE_MAP[entry.name.toLowerCase()] || currentType;
          walk(full, mappedType);
        } else if (entry.isFile() && MODEL_EXTS.has(path.extname(entry.name).toLowerCase())) {
          const stat = fs.statSync(full);
          const existing = db
            .prepare('SELECT id, file_size, sha256_hash, autov2_hash FROM models WHERE LOWER(filename) = LOWER(?)')
            .get(entry.name) as any;

          let sha256 = existing?.sha256_hash || null;
          let autov2 = existing?.autov2_hash || null;
          if (!sha256 || existing?.file_size !== stat.size) {
            const computed = computeModelHashesIfFeasible(full, stat.size);
            sha256 = computed.sha256;
            autov2 = computed.autov2;
          }

          db.prepare(
            `INSERT INTO models
              (name, filename, model_type, file_path, file_size, sha256_hash, autov2_hash, is_installed, source_type, last_seen_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, 1, 'filesystem', datetime('now'))
             ON CONFLICT(filename) DO UPDATE SET
               model_type = CASE WHEN models.model_type = 'other' THEN excluded.model_type ELSE models.model_type END,
               file_path = excluded.file_path,
               file_size = excluded.file_size,
               sha256_hash = COALESCE(excluded.sha256_hash, models.sha256_hash),
               autov2_hash = COALESCE(excluded.autov2_hash, models.autov2_hash),
               is_installed = 1,
               source_type = 'filesystem',
               last_seen_at = datetime('now')`
          ).run(
            entry.name.replace(/\.(safetensors|ckpt|pt|pth|bin)$/i, ''),
            entry.name,
            currentType,
            full,
            stat.size,
            sha256,
            autov2
          );
          seenInstalledFilenames.add(entry.name.toLowerCase());
        }
      }
    };
    walk(rootDir, defaultType);
  };

  scanRoot(appConfig.comfyuiModelsDir, 'other');
  scanRoot(appConfig.downloadsDir, 'lora');

  // Query ComfyUI /object_info if online
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3000);
    const res = await fetch(`${appConfig.comfyuiUrl}/object_info`, { signal: controller.signal });
    clearTimeout(timer);

    if (res.ok) {
      const objInfo = (await res.json()) as Record<string, any>;
      const extractList = (nodeName: string, inputKey: string, mType: ModelType) => {
        const list = objInfo?.[nodeName]?.input?.required?.[inputKey]?.[0];
        if (Array.isArray(list)) {
          for (const rawName of list) {
            if (typeof rawName !== 'string' || rawName === 'None') continue;
            const filename = rawName.replace(/\\/g, '/').split('/').pop() || rawName;
            db.prepare(
              `INSERT INTO models (name, filename, model_type, is_installed, source_type, last_seen_at)
               VALUES (?, ?, ?, 1, 'comfyui_api', datetime('now'))
               ON CONFLICT(filename) DO UPDATE SET
                 is_installed = 1,
                 last_seen_at = datetime('now')`
            ).run(filename.replace(/\.(safetensors|ckpt|pt)$/i, ''), filename, mType);
            seenInstalledFilenames.add(filename.toLowerCase());
          }
        }
      };

      extractList('CheckpointLoaderSimple', 'ckpt_name', 'checkpoint');
      extractList('LoraLoader', 'lora_name', 'lora');
      extractList('VAELoader', 'vae_name', 'vae');
      extractList('ControlNetLoader', 'control_net_name', 'controlnet');
      extractList('UpscaleModelLoader', 'model_name', 'upscaler');
      extractList('CLIPLoader', 'clip_name', 'clip');
      extractList('UNETLoader', 'unet_name', 'diffusion');
    }
  } catch {
    // Offline operation is expected and supported
  }

  // Recompute dependency statuses across all indexed images
  const allImgIds = db.prepare('SELECT id FROM images WHERE is_missing = 0').all() as { id: number }[];
  for (const row of allImgIds) {
    recomputeImageDependencyStatus(row.id);
  }

  return listModelInventory();
}

export function listModelInventory(): ModelInventoryItem[] {
  const rows = db
    .prepare(
      `
      SELECT
        m.*,
        COUNT(DISTINCT im.image_id) AS dependentImageCount,
        COUNT(DISTINCT iw.workflow_id) AS dependentWorkflowCount
      FROM models m
      LEFT JOIN image_models im ON LOWER(im.model_name) = LOWER(m.filename)
      LEFT JOIN image_workflows iw ON iw.image_id = im.image_id
      GROUP BY m.id
      ORDER BY m.is_installed DESC, dependentImageCount DESC, m.filename COLLATE NOCASE ASC
    `
    )
    .all() as any[];

  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    filename: r.filename,
    modelType: r.model_type,
    loraCategory: r.lora_category || 'unclassified',
    filePath: r.file_path || null,
    fileSize: r.file_size ?? null,
    sha256Hash: r.sha256_hash || null,
    autov2Hash: r.autov2_hash || null,
    isInstalled: Boolean(r.is_installed),
    sourceType: r.source_type,
    downloadUrl: r.download_url || null,
    civitaiId: r.civitai_id || null,
    hfRepoId: r.hf_repo_id || null,
    userNotes: r.user_notes || null,
    lastSeenAt: r.last_seen_at,
    dependentImageCount: Number(r.dependentImageCount || 0),
    dependentWorkflowCount: Number(r.dependentWorkflowCount || 0),
  }));
}

/**
 * Converts a standard ComfyUI visual workflow graph to API prompt format when possible.
 */
export function convertVisualWorkflowToApi(visualJsonStr: string): {
  apiGraph: Record<string, any> | null;
  unconvertedNodes: string[];
} {
  try {
    const visual = JSON.parse(visualJsonStr);
    const nodes = Array.isArray(visual.nodes) ? visual.nodes : [];
    const links = Array.isArray(visual.links) ? visual.links : [];
    const linkMap = new Map<number, [string, number]>();

    for (const l of links) {
      // ComfyUI link array: [link_id, origin_node_id, origin_slot, target_node_id, target_slot, type]
      if (Array.isArray(l) && l.length >= 5) {
        linkMap.set(Number(l[0]), [String(l[1]), Number(l[2])]);
      }
    }

    const widgetMap: Record<string, string[]> = {
      CheckpointLoaderSimple: ['ckpt_name'],
      VAELoader: ['vae_name'],
      CLIPTextEncode: ['text'],
      EmptyLatentImage: ['width', 'height', 'batch_size'],
      LoraLoader: ['lora_name', 'strength_model', 'strength_clip'],
      LoraLoaderModelOnly: ['lora_name', 'strength_model'],
      KSampler: ['seed', '_control_after_generate', 'steps', 'cfg', 'sampler_name', 'scheduler', 'denoise'],
      SaveImage: ['filename_prefix'],
    };

    const apiGraph: Record<string, any> = {};
    const unconvertedNodes: string[] = [];

    for (const node of nodes) {
      const id = String(node.id);
      const type = String(node.type || '');
      if (type === 'Note' || type === 'Reroute') continue;

      const inputs: Record<string, any> = {};
      if (Array.isArray(node.inputs)) {
        for (const inp of node.inputs) {
          if (inp.link !== null && inp.link !== undefined && linkMap.has(Number(inp.link))) {
            inputs[inp.name] = linkMap.get(Number(inp.link));
          }
        }
      }

      const knownWidgets = widgetMap[type];
      const values = Array.isArray(node.widgets_values) ? node.widgets_values : [];
      if (knownWidgets) {
        knownWidgets.forEach((wName, idx) => {
          if (!wName.startsWith('_') && values[idx] !== undefined) {
            inputs[wName] = values[idx];
          }
        });
      } else if (values.length > 0) {
        unconvertedNodes.push(type);
      }

      apiGraph[id] = {
        class_type: type,
        inputs,
      };
    }

    return {
      apiGraph: Object.keys(apiGraph).length > 0 ? apiGraph : null,
      unconvertedNodes,
    };
  } catch {
    return { apiGraph: null, unconvertedNodes: [] };
  }
}

/**
 * Validates whether an image or saved workflow can be reproduced on ComfyUI,
 * checking model availability, hashes, and custom nodes without silent substitution.
 */
export async function validateWorkflowReproduction(params: {
  imageId?: number;
  workflowId?: number;
}): Promise<ReproductionValidationResult> {
  let wfRow: any = null;
  let imageId: number | null = params.imageId ?? null;

  if (params.workflowId) {
    wfRow = db.prepare('SELECT * FROM workflows WHERE id = ?').get(params.workflowId);
  } else if (params.imageId) {
    wfRow = db
      .prepare(
        `SELECT w.* FROM image_workflows iw
         JOIN workflows w ON w.id = iw.workflow_id
         WHERE iw.image_id = ? LIMIT 1`
      )
      .get(params.imageId);
  }

  const conn = await testComfyUiConnection();

  if (!wfRow) {
    return {
      imageId,
      workflowId: 0,
      workflowFormat: 'missing',
      canSubmit: false,
      readinessStatus: 'unknown',
      comfyuiOnline: conn.online,
      requiredModels: [],
      requiredNodes: [],
      warnings: ['No embedded visual or API workflow metadata was found for this record.'],
      apiPromptPayload: null,
    };
  }

  let workflowFormat: 'api' | 'visual_converted' | 'visual_only' = 'visual_only';
  let apiPromptPayload: Record<string, any> | null = null;
  const warnings: string[] = [];

  if (wfRow.api_workflow_json) {
    try {
      apiPromptPayload = JSON.parse(wfRow.api_workflow_json);
      workflowFormat = 'api';
    } catch {
      warnings.push('Stored API workflow JSON is malformed.');
    }
  }

  if (!apiPromptPayload && wfRow.visual_workflow_json) {
    const conv = convertVisualWorkflowToApi(wfRow.visual_workflow_json);
    if (conv.apiGraph) {
      apiPromptPayload = conv.apiGraph;
      workflowFormat = 'visual_converted';
      if (conv.unconvertedNodes.length > 0) {
        warnings.push(
          `Visual workflow converted to API format, but custom nodes (${conv.unconvertedNodes.join(
            ', '
          )}) have unverified widget mappings.`
        );
      }
    }
  }

  // Gather required models from image_models or API payload
  const requiredModels: ReproductionValidationResult['requiredModels'] = [];
  if (imageId) {
    const deps = db.prepare('SELECT * FROM image_models WHERE image_id = ?').all(imageId) as any[];
    for (const d of deps) {
      const m = db
        .prepare('SELECT * FROM models WHERE LOWER(filename) = LOWER(?) LIMIT 1')
        .get(d.model_name) as any;
      const isInstalled = Boolean(m?.is_installed);
      const hashVerified = Boolean(
        isInstalled &&
          d.model_hash &&
          (m.sha256_hash === d.model_hash || m.autov2_hash === d.model_hash)
      );
      const status = !isInstalled ? 'missing' : hashVerified ? 'exact_match' : 'available';
      requiredModels.push({
        name: d.model_name,
        modelType: d.model_type,
        hash: d.model_hash || m?.autov2_hash || null,
        status,
        reason:
          status === 'exact_match'
            ? 'Installed and SHA-256/AutoV2 hash verified'
            : status === 'available'
            ? 'Model filename present; hash not historically embedded in image'
            : 'Model file is missing from ComfyUI model inventory',
      });
    }
  }

  // Check custom node class_types against ComfyUI /object_info if online
  let availableNodeClasses: Set<string> | null = null;
  if (conn.online) {
    try {
      const res = await fetch(`${appConfig.comfyuiUrl}/object_info`);
      if (res.ok) {
        const data = await res.json();
        availableNodeClasses = new Set(Object.keys(data));
      }
    } catch {
      availableNodeClasses = null;
    }
  }

  const requiredNodes: ReproductionValidationResult['requiredNodes'] = [];
  if (apiPromptPayload) {
    const seenClasses = new Set<string>();
    for (const node of Object.values(apiPromptPayload)) {
      const ct = String((node as any)?.class_type || '');
      if (ct && !seenClasses.has(ct)) {
        seenClasses.add(ct);
        const isAvail = availableNodeClasses ? availableNodeClasses.has(ct) : null;
        requiredNodes.push({ classType: ct, isAvailable: isAvail });
        if (isAvail === false) {
          warnings.push(`Required custom node "${ct}" is not installed in ComfyUI.`);
        }
      }
    }
  }

  const hasMissingModels = requiredModels.some((m) => m.status === 'missing');
  const hasMissingNodes = requiredNodes.some((n) => n.isAvailable === false);
  const allExact =
    requiredModels.length > 0 && requiredModels.every((m) => m.status === 'exact_match');

  const readinessStatus: DependencyStatus =
    hasMissingModels || hasMissingNodes
      ? 'incomplete'
      : allExact
      ? 'exact_match'
      : requiredModels.length > 0
      ? 'available'
      : 'unknown';

  if (hasMissingModels) {
    warnings.push(
      'One or more required models are missing. Couchy will never silently substitute missing models.'
    );
  }
  if (!conn.online) {
    warnings.push(`ComfyUI instance at ${conn.baseUrl} is currently offline.`);
  }

  return {
    imageId,
    workflowId: wfRow.id,
    workflowFormat,
    canSubmit: Boolean(apiPromptPayload && conn.online && !hasMissingModels && !hasMissingNodes),
    readinessStatus,
    comfyuiOnline: conn.online,
    requiredModels,
    requiredNodes,
    warnings,
    apiPromptPayload,
  };
}

/**
 * Submits a validated workflow to ComfyUI and records a reproduction_jobs entry.
 * If positivePrompt is provided, injects it into the workflow's positive prompt node
 * while preserving the original seed and parameters from the embedded metadata.
 */
export async function submitWorkflowReproduction(params: {
  imageId?: number;
  workflowId?: number;
  positivePrompt?: string;
}): Promise<any> {
  const validation = await validateWorkflowReproduction({
    imageId: params.imageId,
    workflowId: params.workflowId,
  });
  if (!validation.apiPromptPayload) {
    throw new Error('Workflow does not have a valid API prompt graph for execution.');
  }
  if (!validation.comfyuiOnline) {
    throw new Error('ComfyUI is offline. Verify connection settings before submitting.');
  }

  const missingDeps = validation.requiredModels.filter((m) => m.status === 'missing').map((m) => m.name);
  if (missingDeps.length > 0) {
    throw new Error(`Cannot run workflow with missing models: ${missingDeps.join(', ')}`);
  }

  // Clone the API prompt payload and inject edited positivePrompt if provided
  const promptPayload: Record<string, any> = JSON.parse(
    JSON.stringify(validation.apiPromptPayload)
  );

  if (typeof params.positivePrompt === 'string') {
    let origPrompt: string | null = null;
    if (params.imageId) {
      const metaRow = db
        .prepare('SELECT positive_prompt FROM image_metadata WHERE image_id = ?')
        .get(params.imageId) as { positive_prompt?: string | null } | undefined;
      origPrompt = metaRow?.positive_prompt ?? null;
    }
    injectPositivePromptIntoGraph(promptPayload, params.positivePrompt, origPrompt);
  }

  const resolvedWorkflowId = validation.workflowId || params.workflowId || 0;

  const info = db
    .prepare(
      `INSERT INTO reproduction_jobs
        (source_image_id, workflow_id, status, readiness_status, missing_dependencies_json)
       VALUES (?, ?, 'queued', ?, ?)`
    )
    .run(
      params.imageId ?? null,
      resolvedWorkflowId,
      validation.readinessStatus,
      JSON.stringify(missingDeps)
    );
  const jobId = Number(info.lastInsertRowid);

  try {
    const res = await fetch(`${appConfig.comfyuiUrl}/prompt`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prompt: promptPayload,
        client_id: COUCHY_COMFY_CLIENT_ID,
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`ComfyUI rejected prompt (${res.status}): ${errText}`);
    }

    const data = (await res.json()) as { prompt_id?: string };
    const promptId = data.prompt_id || `prompt-${Date.now()}`;

    db.prepare(
      `UPDATE reproduction_jobs
       SET comfyui_prompt_id = ?, status = 'running'
       WHERE id = ?`
    ).run(promptId, jobId);

    invalidateComfyQueueCache();

    // Lookup confirmed character on source image if present
    let sourceCharacterId: number | null = null;
    if (params.imageId) {
      const charRow = db
        .prepare(
          `SELECT character_id FROM image_characters
           WHERE image_id = ? AND status = 'confirmed' LIMIT 1`
        )
        .get(params.imageId) as { character_id?: number } | undefined;
      if (charRow?.character_id) {
        sourceCharacterId = Number(charRow.character_id);
      }
    }

    // Poll ComfyUI /history/<prompt_id> in the background via unified poller
    pollComfyPromptCompletion({
      promptId,
      characterId: sourceCharacterId,
      maxAttempts: 90,
      onSuccess: ({ outputImageIds }) => {
        db.prepare(
          `UPDATE reproduction_jobs
           SET status = 'completed',
               output_image_ids_json = ?,
               completed_at = datetime('now')
           WHERE id = ?`
        ).run(JSON.stringify(outputImageIds), jobId);
      },
      onError: (errMsg) => {
        db.prepare(
          `UPDATE reproduction_jobs
           SET status = 'failed', execution_error = ?, completed_at = datetime('now')
           WHERE id = ?`
        ).run(errMsg, jobId);
      },
    });

    return db.prepare('SELECT * FROM reproduction_jobs WHERE id = ?').get(jobId);
  } catch (err: any) {
    db.prepare(
      `UPDATE reproduction_jobs
       SET status = 'failed', execution_error = ?, completed_at = datetime('now')
       WHERE id = ?`
    ).run(err?.message || 'Submission failed', jobId);
    throw err;
  }
}

/**
 * Uploads an existing indexed gallery image to ComfyUI and executes the internal
 * upscale workflow (`src/server/workflows/upscale_workflow.json`) at targetMegapixels.
 */
export async function submitImageUpscale(params: {
  imageId: number;
  targetMegapixels: number;
}): Promise<{ promptId: string; targetMegapixels: number; sourceFilename: string }> {
  const imgRow = db
    .prepare('SELECT id, relative_path, filename, is_missing FROM images WHERE id = ?')
    .get(params.imageId) as
    | { id: number; relative_path: string; filename: string; is_missing: number }
    | undefined;

  if (!imgRow) {
    throw new Error('Image not found.');
  }

  const origPath = path.resolve(appConfig.comfyuiOutputDir, imgRow.relative_path);
  if (imgRow.is_missing || !fs.existsSync(origPath)) {
    throw new Error('Original image file is missing on disk.');
  }

  const conn = await testComfyUiConnection();
  if (!conn.online) {
    throw new Error('ComfyUI is offline. Verify connection settings before upscaling.');
  }

  const targetMp = Math.max(0.5, Math.min(10.0, Number(params.targetMegapixels) || 6.0));

  // Upload the source image to ComfyUI's input/ directory so LoadImage resolves reliably
  let loadFilename = imgRow.filename;
  let loadSubfolder = path.dirname(imgRow.relative_path) === '.' ? '' : path.dirname(imgRow.relative_path);
  let loadSourceType: 'input' | 'output' = 'output';

  try {
    const fileBuf = fs.readFileSync(origPath);
    const form = new FormData();
    form.append('image', new Blob([fileBuf]), path.basename(origPath));
    form.append('overwrite', 'true');
    form.append('type', 'input');

    const uploadRes = await fetch(`${appConfig.comfyuiUrl}/upload/image`, {
      method: 'POST',
      body: form,
    });
    if (uploadRes.ok) {
      const upJson = (await uploadRes.json()) as { name?: string; subfolder?: string };
      if (upJson?.name) {
        loadFilename = upJson.name;
        loadSubfolder = upJson.subfolder || '';
        loadSourceType = 'input';
      }
    }
  } catch {
    // Fall back to direct [output] reference if /upload/image fails
  }

  const baseStem = path.basename(imgRow.filename, path.extname(imgRow.filename));
  const upscalePayload = compileUpscaleWorkflow({
    imageFilename: loadFilename,
    subfolder: loadSubfolder,
    sourceType: loadSourceType,
    targetMegapixels: targetMp,
    filenamePrefix: `${baseStem}_upscaled`,
  });

  const promptRes = await fetch(`${appConfig.comfyuiUrl}/prompt`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      prompt: upscalePayload,
      client_id: COUCHY_COMFY_CLIENT_ID,
    }),
  });

  if (!promptRes.ok) {
    const errText = await promptRes.text();
    throw new Error(`ComfyUI rejected upscale workflow (${promptRes.status}): ${errText}`);
  }

  const data = (await promptRes.json()) as { prompt_id?: string };
  const promptId = data.prompt_id || `upscale-${Date.now()}`;

  const charRow = db
    .prepare(
      `SELECT ic.character_id, c.name AS character_name
       FROM image_characters ic
       JOIN characters c ON c.id = ic.character_id
       WHERE ic.image_id = ? AND ic.status = 'confirmed' LIMIT 1`
    )
    .get(params.imageId) as { character_id?: number; character_name?: string } | undefined;
  const sourceCharacterId = charRow?.character_id ? Number(charRow.character_id) : null;

  registerQueuedPromptSeriesTarget(promptId, {
    sourceImageId: params.imageId,
    characterId: sourceCharacterId,
    characterName: charRow?.character_name || null,
    prompt: `Upscale ${imgRow.filename} to ${targetMp.toFixed(1)} MP`,
  });

  invalidateComfyQueueCache();
  pollComfyPromptCompletion({
    promptId,
    characterId: sourceCharacterId,
    onSuccess: ({ outputImageIds }) => {
      for (const derivedId of outputImageIds) {
        if (derivedId !== params.imageId) {
          copyImageMetadataToDerivedImage(params.imageId, derivedId);
          attachUpscaledImageToSeries(params.imageId, derivedId);
        }
      }
    },
    onError: (errMsg) => {
      console.warn(`Image upscale failed for image #${params.imageId}:`, errMsg);
    },
  });

  return {
    promptId,
    targetMegapixels: targetMp,
    sourceFilename: imgRow.filename,
  };
}

