import fs from 'fs';
import path from 'path';
import { db } from '../db.ts';
import { appConfig } from '../config.ts';
import {
  copyImageMetadataToDerivedImage,
  indexSingleImageFile,
  resolveImageDiskPath,
  runDirectoryScan,
} from './scannerService.ts';
import {
  COUCHY_COMFY_CLIENT_ID,
  invalidateComfyQueueCache,
  isPromptCancelled,
  notifyImageIndexed,
  registerQueuedPromptSeriesTarget,
} from './comfyuiLiveMonitor.ts';
import {
  compileUpscaleWorkflow,
  injectPositivePromptIntoGraph,
} from './workflowCompilerService.ts';
import { attachUpscaledImageToSeries } from './seriesService.ts';
import type {
  DependencyStatus,
  ReproductionValidationResult,
} from '../../shared/types.ts';

export interface PolledComfyOutputResult {
  outputImageIds: number[];
  firstImageId: number | null;
  firstOutputSpec: { filename: string; subfolder: string } | null;
}

export interface PollComfyPromptOptions {
  promptId: string;
  characterId?: number | null;
  maxAttempts?: number;
  intervalMs?: number;
  onSuccess: (result: PolledComfyOutputResult) => void | Promise<void>;
  onError?: (errorMessage: string) => void | Promise<void>;
  onTimeout?: () => void | Promise<void>;
}

function formatComfyHistoryError(messages: unknown): string {
  if (Array.isArray(messages)) {
    for (const msg of messages) {
      if (Array.isArray(msg) && msg[0] === 'execution_error' && msg[1] && typeof msg[1] === 'object') {
        const details = msg[1] as Record<string, any>;
        const excMsg = String(details.exception_message || '').trim();
        const nodeType = String(details.node_type || '').trim();
        if (excMsg && nodeType) return `${nodeType}: ${excMsg}`;
        if (excMsg) return excMsg;
      }
    }
  }
  if (typeof messages === 'string' && messages.trim()) {
    return messages.trim();
  }
  return 'ComfyUI execution error';
}

/**
 * Polls ComfyUI `/history/<promptId>` until completion or error, indexes any generated
 * output files into SQLite, runs caller hooks, and notifies live gallery listeners.
 */
export function pollComfyPromptCompletion(options: PollComfyPromptOptions): void {
  const {
    promptId,
    characterId = null,
    maxAttempts = 480,
    intervalMs = 2500,
    onSuccess,
    onError,
    onTimeout,
  } = options;

  const tick = (attempt: number) => {
    if (isPromptCancelled(promptId)) {
      return;
    }
    if (attempt > maxAttempts) {
      Promise.resolve(onTimeout?.()).catch((err) => {
        console.warn(`ComfyUI poller timeout handler failed for ${promptId}:`, err);
      });
      return;
    }

    setTimeout(async () => {
      if (isPromptCancelled(promptId)) {
        return;
      }
      try {
        const res = await fetch(`${appConfig.comfyuiUrl}/history/${promptId}`);
        if (isPromptCancelled(promptId)) {
          return;
        }
        if (res.ok) {
          const hist = (await res.json()) as Record<string, any>;
          const entry = hist[promptId];
          if (entry) {
            if (isPromptCancelled(promptId)) {
              return;
            }
            if (entry.status?.status_str === 'error') {
              const errMsg = formatComfyHistoryError(entry.status?.messages);
              await onError?.(errMsg);
              return;
            }

            const outputImageIds: number[] = [];
            let firstOutputSpec: { filename: string; subfolder: string } | null = null;
            let anyIndexed = false;
            const outputs = entry.outputs || {};

            for (const nodeOut of Object.values(outputs) as any[]) {
              if (!Array.isArray(nodeOut?.images) || nodeOut.images.length === 0) continue;
              for (const imgSpec of nodeOut.images) {
                if (imgSpec?.type === 'temp') continue;
                const filename = imgSpec?.filename;
                const subfolder = imgSpec?.subfolder || '';
                if (!filename) continue;
                if (!firstOutputSpec) {
                  firstOutputSpec = { filename, subfolder };
                }

                const fullPath = path.join(appConfig.comfyuiOutputDir, subfolder, filename);
                if (fs.existsSync(fullPath)) {
                  const resIndex = await indexSingleImageFile(
                    fullPath,
                    appConfig.comfyuiOutputDir,
                    false,
                    characterId
                  );
                  if (resIndex.imageId) {
                    outputImageIds.push(resIndex.imageId);
                    anyIndexed = true;
                  }
                } else {
                  const imgRow = db
                    .prepare('SELECT id FROM images WHERE filename = ? ORDER BY id DESC LIMIT 1')
                    .get(filename) as { id: number } | undefined;
                  if (imgRow) {
                    outputImageIds.push(imgRow.id);
                  }
                }
              }
            }

            await onSuccess({
              outputImageIds,
              firstImageId: outputImageIds[0] ?? null,
              firstOutputSpec,
            });

            if (anyIndexed || outputImageIds.length > 0) {
              notifyImageIndexed();
            } else {
              runDirectoryScan('incremental');
            }
            return;
          }
        }
        tick(attempt + 1);
      } catch {
        tick(attempt + 1);
      }
    }, intervalMs);
  };

  tick(0);
}

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
    .prepare(
      'SELECT id, relative_path, filename, is_missing, COALESCE(is_uploaded_reference, 0) AS is_uploaded_reference FROM images WHERE id = ?'
    )
    .get(params.imageId) as
    | {
        id: number;
        relative_path: string;
        filename: string;
        is_missing: number;
        is_uploaded_reference: number;
      }
    | undefined;

  if (!imgRow) {
    throw new Error('Image not found.');
  }

  const origPath = resolveImageDiskPath(imgRow);
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
    isUpscale: true,
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

