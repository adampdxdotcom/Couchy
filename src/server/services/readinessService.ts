import fs from 'fs';
import { db } from '../db.ts';
import { appConfig } from '../config.ts';
import { getExecutableApiGraph } from './workflowCompilerService.ts';
import { checkLmStudioStatus } from './llm/llmClientService.ts';
import { extractComfyObjectInfoChoices } from './modelInventoryService.ts';
import type { GenerationReadinessResponse, ReadinessCheckItem } from '../../shared/apiTypes.ts';

const REQUIRED_KREA2_NODES = [
  'Power Lora Loader (rgthree)',
  'ResolutionSelector',
  'ComfySwitchNode',
  'TextGenerate',
];

function matchesFilename(installedList: string[], target: string): boolean {
  const cleanTarget = target.trim().replace(/\\/g, '/').toLowerCase();
  if (!cleanTarget) return false;
  const targetBase = cleanTarget.split('/').pop()!;
  return installedList.some((entry) => {
    const cleanEntry = entry.trim().replace(/\\/g, '/').toLowerCase();
    return cleanEntry === cleanTarget || cleanEntry.split('/').pop() === targetBase;
  });
}

function getDefaultWorkflowRecord(): {
  id: number;
  name: string;
  api_workflow_json: string | null;
  visual_workflow_json: string | null;
  workflow_hash: string;
} | null {
  const row = db
    .prepare(
      `SELECT id, name, api_workflow_json, visual_workflow_json, workflow_hash
       FROM workflows
       ORDER BY is_default DESC, id ASC
       LIMIT 1`
    )
    .get() as
    | {
        id: number;
        name: string;
        api_workflow_json: string | null;
        visual_workflow_json: string | null;
        workflow_hash: string;
      }
    | undefined;
  return row ?? null;
}

/**
 * Evaluates ComfyUI connectivity, required Krea 2 nodes, default workflow weights,
 * scanned output library status, and optional Local LLM availability.
 */
export async function getGenerationReadiness(): Promise<GenerationReadinessResponse> {
  const wfRow = getDefaultWorkflowRecord();
  const apiGraph = wfRow ? getExecutableApiGraph(wfRow) : null;

  const ckptNode =
    apiGraph?.['30_10'] ||
    (apiGraph
      ? Object.values(apiGraph).find(
          (n: any) =>
            n &&
            typeof n === 'object' &&
            (String(n.class_type || '').includes('UNETLoader') ||
              String(n.class_type || '').includes('CheckpointLoader'))
        )
      : null);

  const defaultUnetName = String(
    ckptNode?.inputs?.unet_name ?? ckptNode?.inputs?.ckpt_name ?? ''
  ).trim();
  const defaultClipName = String(apiGraph?.['30_11']?.inputs?.clip_name ?? '').trim();
  const defaultVaeName = String(apiGraph?.['30_12']?.inputs?.vae_name ?? '').trim();
  const defaultUpscalerName = String(apiGraph?.['54']?.inputs?.model_name ?? '').trim();

  // Fetch ComfyUI /object_info (2.5s timeout) and Local LLM status in parallel
  let objectInfo: Record<string, any> | null = null;
  let comfyError: string | null = null;
  const comfyPromise = (async () => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 2500);
    try {
      const res = await fetch(`${appConfig.comfyuiUrl}/object_info`, { signal: controller.signal });
      if (!res.ok) {
        comfyError = `HTTP ${res.status}`;
        return;
      }
      objectInfo = (await res.json()) as Record<string, any>;
    } catch (err: any) {
      comfyError = err?.name === 'AbortError' ? 'Timed out' : err?.message || 'Unreachable';
    } finally {
      clearTimeout(timer);
    }
  })();

  const llmPromise = checkLmStudioStatus().catch(() => ({
    online: false,
    baseUrl: appConfig.lmStudioUrl,
    models: [],
    selectedModel: '',
    isVisionCapable: false,
    visionDetectionSource: 'unknown' as const,
  }));

  await Promise.all([comfyPromise, llmPromise]);
  const llmStatus = await llmPromise;
  const comfyuiOnline = Boolean(objectInfo);

  // Merge available UNETs from ComfyUI /object_info + installed DB diffusion/checkpoint rows
  const dbModelRows = db
    .prepare(
      `SELECT filename, comfyui_path, model_type
       FROM models
       WHERE COALESCE(is_installed, 0) = 1`
    )
    .all() as Array<{ filename: string; comfyui_path: string | null; model_type: string }>;

  const liveUnets = [
    ...extractComfyObjectInfoChoices(objectInfo, 'UNETLoader', 'unet_name'),
    ...extractComfyObjectInfoChoices(objectInfo, 'CheckpointLoaderSimple', 'ckpt_name'),
  ];
  const dbUnets = dbModelRows
    .filter((m) => m.model_type === 'diffusion' || m.model_type === 'checkpoint')
    .map((m) => m.comfyui_path || m.filename);

  const unetSet = new Map<string, string>();
  for (const name of [...liveUnets, ...dbUnets]) {
    const clean = name.trim();
    if (clean && !unetSet.has(clean.toLowerCase())) {
      unetSet.set(clean.toLowerCase(), clean);
    }
  }
  const availableUnets = Array.from(unetSet.values()).sort((a, b) =>
    a.localeCompare(b, undefined, { sensitivity: 'base' })
  );

  // 1. ComfyUI check
  const comfyCheck: ReadinessCheckItem = {
    id: 'comfyui',
    label: 'ComfyUI Instance',
    ok: comfyuiOnline,
    detail: comfyuiOnline
      ? `Connected at ${appConfig.comfyuiUrl}`
      : `Offline (${comfyError || 'unreachable'}) at ${appConfig.comfyuiUrl}`,
  };

  // 2. Required custom & core nodes check
  const missingNodes = comfyuiOnline
    ? REQUIRED_KREA2_NODES.filter((nodeName) => !objectInfo?.[nodeName])
    : [];
  const nodesCheck: ReadinessCheckItem = {
    id: 'nodes',
    label: 'Krea 2 Nodes (rgthree-comfy & comfy-core)',
    ok: comfyuiOnline && missingNodes.length === 0,
    detail: !comfyuiOnline
      ? 'Connect ComfyUI to verify required nodes'
      : missingNodes.length === 0
        ? 'rgthree Power Lora Loader & comfy-core nodes verified'
        : `Missing in ComfyUI: ${missingNodes.join(', ')}`,
  };

  // 3. Default UNET check
  const unetInstalled =
    Boolean(defaultUnetName) &&
    (comfyuiOnline
      ? matchesFilename(availableUnets, defaultUnetName)
      : dbUnets.length === 0 || matchesFilename(dbUnets, defaultUnetName));
  const defaultUnetCheck: ReadinessCheckItem = {
    id: 'default_unet',
    label: 'Default Krea 2 Base Model (#30_10)',
    ok: Boolean(defaultUnetName) && unetInstalled,
    detail: !defaultUnetName
      ? 'No default UNET selected in the default workflow yet'
      : unetInstalled
        ? defaultUnetName
        : `"${defaultUnetName}" not found in installed ComfyUI models`,
  };

  // 4. Support weights check (CLIP, VAE, 4x-ESRGAN)
  const liveClips = extractComfyObjectInfoChoices(objectInfo, 'CLIPLoader', 'clip_name');
  const liveVaes = extractComfyObjectInfoChoices(objectInfo, 'VAELoader', 'vae_name');
  const liveUpscalers = extractComfyObjectInfoChoices(
    objectInfo,
    'UpscaleModelLoader',
    'model_name'
  );
  const dbAllNames = dbModelRows.map((m) => m.comfyui_path || m.filename);

  const isSupportWeightReady = (liveList: string[], target: string): boolean => {
    if (comfyuiOnline && liveList.length > 0) {
      return matchesFilename(liveList, target);
    }
    return dbAllNames.length === 0 || matchesFilename(dbAllNames, target);
  };

  const missingSupport: string[] = [];
  if (defaultClipName && !isSupportWeightReady(liveClips, defaultClipName)) {
    missingSupport.push(defaultClipName);
  }
  if (defaultVaeName && !isSupportWeightReady(liveVaes, defaultVaeName)) {
    missingSupport.push(defaultVaeName);
  }
  if (defaultUpscalerName && !isSupportWeightReady(liveUpscalers, defaultUpscalerName)) {
    missingSupport.push(defaultUpscalerName);
  }

  const supportCheck: ReadinessCheckItem = {
    id: 'support_models',
    label: 'Krea 2 Support Weights (CLIP, VAE, 4x-ESRGAN)',
    ok: comfyuiOnline ? missingSupport.length === 0 : missingSupport.length === 0,
    detail:
      missingSupport.length === 0
        ? [defaultClipName, defaultVaeName, defaultUpscalerName].filter(Boolean).join(' · ') ||
          'Configured'
        : `Missing in ComfyUI: ${missingSupport.join(', ')}`,
  };

  // 5. Output folder scan check (optional/informational if empty)
  const imageCount = (
    db
      .prepare(
        'SELECT COUNT(*) AS c FROM images WHERE is_missing = 0 AND COALESCE(is_uploaded_reference, 0) = 0'
      )
      .get() as { c: number }
  ).c;
  const outputReadable = fs.existsSync(appConfig.comfyuiOutputDir);
  const scanCheck: ReadinessCheckItem = {
    id: 'library_scan',
    label: 'Gallery Output Folder',
    ok: outputReadable,
    optional: true,
    detail: outputReadable
      ? `${imageCount.toLocaleString()} indexed image${imageCount === 1 ? '' : 's'} in ${appConfig.comfyuiOutputDir}`
      : `Directory not found: ${appConfig.comfyuiOutputDir}`,
  };

  // 6. Optional Local LLM check
  const llmCheck: ReadinessCheckItem = {
    id: 'local_llm',
    label: 'Local LLM Agent (Optional)',
    ok: llmStatus.online,
    optional: true,
    detail: llmStatus.online
      ? `Online (${llmStatus.selectedModel || llmStatus.baseUrl})`
      : 'Offline — Agent & interrogation disabled; core gallery and generation still work',
  };

  const checks: ReadinessCheckItem[] = [
    comfyCheck,
    nodesCheck,
    defaultUnetCheck,
    supportCheck,
    scanCheck,
    llmCheck,
  ];

  const requiredChecks = checks.filter((c) => !c.optional);
  const ready = requiredChecks.every((c) => c.ok);

  // Only surface the global first-run banner when configuration is genuinely incomplete
  // (blank default UNET, or ComfyUI is reachable and reports missing nodes/models).
  const needsAttention =
    !defaultUnetName ||
    (comfyuiOnline && (missingNodes.length > 0 || !unetInstalled || missingSupport.length > 0));

  return {
    ready,
    needsAttention,
    comfyuiOnline,
    comfyuiUrl: appConfig.comfyuiUrl,
    llmOnline: llmStatus.online,
    defaultWorkflowId: wfRow?.id ?? null,
    defaultWorkflowName: wfRow?.name ?? null,
    defaultUnetName,
    availableUnets,
    checks,
    checkedAt: new Date().toISOString(),
  };
}

/**
 * Updates Node #30_10 (or fallback loader node) on the active default workflow to the chosen UNET filename.
 */
export async function setDefaultWorkflowUnet(
  unetFilename: string
): Promise<GenerationReadinessResponse> {
  const cleanName = String(unetFilename || '').trim();
  if (!cleanName) {
    throw new Error('UNET filename cannot be empty.');
  }

  const wfRow = getDefaultWorkflowRecord();
  if (!wfRow) {
    throw new Error('No default workflow was found in the database.');
  }

  const graph = getExecutableApiGraph(wfRow);
  if (!graph) {
    throw new Error('Default workflow API graph is missing or invalid.');
  }

  const ckptNode =
    graph['30_10']?.inputs
      ? graph['30_10']
      : Object.values(graph).find(
          (n: any) =>
            n &&
            typeof n === 'object' &&
            (String(n.class_type || '').includes('UNETLoader') ||
              String(n.class_type || '').includes('CheckpointLoader'))
        );

  if (!ckptNode?.inputs) {
    throw new Error('Could not find UNET/Checkpoint loader node in the default workflow.');
  }

  const field = 'unet_name' in ckptNode.inputs ? 'unet_name' : 'ckpt_name';
  ckptNode.inputs[field] = cleanName;

  db.prepare(
    `UPDATE workflows
     SET api_workflow_json = ?, updated_at = datetime('now')
     WHERE id = ?`
  ).run(JSON.stringify(graph, null, 2), wfRow.id);

  return getGenerationReadiness();
}
