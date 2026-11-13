import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { db } from '../db.ts';
import {
  normalizeResolutionSelectorRatio,
  type GenerationLoraSelection,
} from '../../shared/types.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const UPSCALE_WORKFLOW_PATH = path.resolve(__dirname, '../workflows/upscale_workflow.json');
const PRIMARY_WORKFLOW_PATH = path.resolve(__dirname, '../workflows/primary_workflow.json');

/**
 * Computes pixel width & height (multiples of 64) from an aspect ratio string and megapixels (0.1 - 10.0).
 */
export function computeDimensionsFromMegapixels(
  aspectRatio: string,
  megapixels: number
): { width: number; height: number } {
  const mp = Math.max(0.1, Math.min(10.0, Number(megapixels) || 1.0));
  const totalPixels = mp * 1_000_000;

  let ratioW = 1;
  let ratioH = 1;
  const match = String(aspectRatio).match(/(\d+(?:\.\d+)?)\s*[:\/x]\s*(\d+(?:\.\d+)?)/i);
  if (match) {
    ratioW = Math.max(0.1, parseFloat(match[1]));
    ratioH = Math.max(0.1, parseFloat(match[2]));
  }

  const rawWidth = Math.sqrt(totalPixels * (ratioW / ratioH));
  const rawHeight = Math.sqrt(totalPixels * (ratioH / ratioW));

  const width = Math.max(64, Math.round(rawWidth / 64) * 64);
  const height = Math.max(64, Math.round(rawHeight / 64) * 64);
  return { width, height };
}

/**
 * Resolves the executable API workflow JSON object for a workflow row.
 * For the built-in primary workflow, reads src/server/workflows/primary_workflow.json live.
 */
export function getExecutableApiGraph(workflowRow: any): Record<string, any> | null {
  if (!workflowRow) return null;
  if (
    workflowRow.workflow_hash === 'default-krea2-turbo-workflow' &&
    fs.existsSync(PRIMARY_WORKFLOW_PATH)
  ) {
    try {
      const parsed = JSON.parse(fs.readFileSync(PRIMARY_WORKFLOW_PATH, 'utf-8'));
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed.nodes)) {
        return parsed;
      }
    } catch {
      // fall through to DB column
    }
  }
  if (workflowRow.api_workflow_json) {
    try {
      const parsed = JSON.parse(workflowRow.api_workflow_json);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed.nodes)) {
        return parsed;
      }
    } catch {
      // ignore
    }
  }
  if (workflowRow.visual_workflow_json) {
    try {
      const parsed = JSON.parse(workflowRow.visual_workflow_json);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed.nodes)) {
        return parsed;
      }
    } catch {
      // ignore
    }
  }
  return null;
}

/**
 * Extracts default checkpoint, megapixel count, and aspect ratio directly from
 * known System Workflow nodes (#49 ResolutionSelector and #30_10 UNETLoader).
 */
export function getWorkflowDefaults(workflowId: number): {
  defaultCheckpoint: string | null;
  defaultMegapixels: number | null;
  defaultAspectRatio: string | null;
} {
  const wfRow = db.prepare('SELECT * FROM workflows WHERE id = ?').get(workflowId) as any;
  const apiGraph = getExecutableApiGraph(wfRow);
  if (!apiGraph) {
    return { defaultCheckpoint: null, defaultMegapixels: null, defaultAspectRatio: null };
  }

  let defaultCheckpoint: string | null = null;
  const ckptNode =
    apiGraph['30_10'] ||
    Object.values(apiGraph).find(
      (n: any) =>
        n &&
        typeof n === 'object' &&
        (String(n.class_type || '').includes('UNETLoader') ||
          String(n.class_type || '').includes('CheckpointLoader'))
    );
  if (ckptNode?.inputs) {
    const rawCkpt = ckptNode.inputs.unet_name ?? ckptNode.inputs.ckpt_name;
    if (typeof rawCkpt === 'string' && rawCkpt.trim()) {
      defaultCheckpoint = rawCkpt.trim();
    }
  }

  let defaultMegapixels: number | null = null;
  let defaultAspectRatio: string | null = null;
  const resNode =
    apiGraph['49']?.class_type === 'ResolutionSelector'
      ? apiGraph['49']
      : Object.values(apiGraph).find(
          (n: any) => n && typeof n === 'object' && n.class_type === 'ResolutionSelector'
        );
  if (resNode?.inputs) {
    const rawMp = Number(resNode.inputs.megapixels);
    if (Number.isFinite(rawMp) && rawMp > 0) {
      defaultMegapixels = rawMp;
    }
    if (typeof resNode.inputs.aspect_ratio === 'string' && resNode.inputs.aspect_ratio.trim()) {
      defaultAspectRatio = normalizeResolutionSelectorRatio(resNode.inputs.aspect_ratio.trim());
    }
  }

  return { defaultCheckpoint, defaultMegapixels, defaultAspectRatio };
}

/**
 * Detects an inline conditional upscale branch inside a generation workflow
 * (primary_workflow.json Switch #51 -> ImageScaleToTotalPixels #52 <- ImageUpscaleWithModel #53).
 */
export function findInlineUpscaleNodes(
  apiGraph: Record<string, any>
): { switchNodeId: string; scaleNodeId: string } | null {
  if (
    apiGraph['51']?.class_type === 'ComfySwitchNode' &&
    apiGraph['52']?.class_type === 'ImageScaleToTotalPixels' &&
    Array.isArray(apiGraph['51']?.inputs?.on_true) &&
    String(apiGraph['51'].inputs.on_true[0]) === '52'
  ) {
    return { switchNodeId: '51', scaleNodeId: '52' };
  }

  for (const [nodeId, node] of Object.entries(apiGraph)) {
    if (!node || typeof node !== 'object' || node.class_type !== 'ComfySwitchNode') continue;
    const onTrue = node.inputs?.on_true;
    if (!Array.isArray(onTrue) || onTrue.length < 1) continue;
    const scaleId = String(onTrue[0]);
    const scaleNode = apiGraph[scaleId];
    if (scaleNode?.class_type !== 'ImageScaleToTotalPixels') continue;
    const upstreamImg = scaleNode.inputs?.image;
    if (
      Array.isArray(upstreamImg) &&
      apiGraph[String(upstreamImg[0])]?.class_type === 'ImageUpscaleWithModel'
    ) {
      return { switchNodeId: nodeId, scaleNodeId: scaleId };
    }
  }
  return null;
}

/**
 * Injects an edited positive prompt into a reproduced workflow graph
 * (checking primary System Workflow Node #30_19 first, then originalPrompt / CLIPTextEncode).
 */
export function injectPositivePromptIntoGraph(
  graph: Record<string, any>,
  nextPrompt: string,
  originalPrompt?: string | null
): boolean {
  const cleanNext = nextPrompt.trim();

  // 1. Primary System Workflow User Prompt node (#30_19)
  if (graph['30_19']?.inputs && typeof graph['30_19'].inputs.value === 'string') {
    graph['30_19'].inputs.value = cleanNext;
    return true;
  }

  // 2. Match any node currently holding the extracted original positive prompt
  const origTrimmed = (originalPrompt || '').trim();
  if (origTrimmed) {
    for (const node of Object.values(graph)) {
      if (!node || typeof node !== 'object' || !node.inputs) continue;
      for (const field of ['value', 'text', 'text_g', 'text_l', 'prompt', 'positive', 'string']) {
        if (typeof node.inputs[field] === 'string' && node.inputs[field].trim() === origTrimmed) {
          node.inputs[field] = cleanNext;
          return true;
        }
      }
    }
  }

  // 3. Fallback to first positive CLIPTextEncode node
  for (const node of Object.values(graph)) {
    if (!node || typeof node !== 'object' || !node.inputs) continue;
    const classType = String(node.class_type || '');
    const title = String(node._meta?.title || '').toLowerCase();
    if (classType.includes('CLIPTextEncode') && !title.includes('negative')) {
      const field = typeof node.inputs.text === 'string' ? 'text' : 'text_g';
      if (typeof node.inputs[field] === 'string') {
        node.inputs[field] = cleanNext;
        return true;
      }
    }
  }

  return false;
}

/**
 * Deterministic compiler for the primary Krea2_turbo System Workflow (`primary_workflow.json`):
 * - Node #30_19: User Prompt value
 * - Node #30_27: LoRA Trigger Word string_b
 * - Node #50 & #30_23: Power Lora Loader (rgthree) + Enable LoRA boolean
 * - Node #49: ResolutionSelector (base MP clamped <= 3.0)
 * - Node #51 & #52: Inline 4x-ESRGAN upscale switch + ImageScaleToTotalPixels (when target > 3.0 MP)
 * - Node #30_3: KSampler seed (64-bit safe integer)
 * - Node #30_10: UNETLoader unet_name
 */
export function compileWorkflowForGeneration(params: {
  workflowId: number;
  positivePrompt: string;
  triggerWord?: string;
  negativePrompt: string;
  seed: string | number;
  aspectRatio: string;
  megapixels: number;
  width: number;
  height: number;
  loras: GenerationLoraSelection[];
  checkpointName?: string;
}): Record<string, any> {
  const wfRow = db.prepare('SELECT * FROM workflows WHERE id = ?').get(params.workflowId) as any;
  const baseGraph = getExecutableApiGraph(wfRow);
  if (!baseGraph) {
    throw new Error('Selected workflow does not contain a valid ComfyUI API node graph.');
  }

  const graph: Record<string, any> = JSON.parse(JSON.stringify(baseGraph));

  // 1. Positive Prompt (Node #30_19 or fallback CLIPTextEncode)
  const cleanPositivePrompt = (params.positivePrompt || '')
    .replace(/\b[\w\.\-]+\.(?:safetensors|ckpt|pt|bin)\b/gi, '')
    .replace(/\s*,\s*,+/g, ',')
    .replace(/^[\s,;:\-–—]+/, '')
    .replace(/[\s,;:\-–—]+$/, '')
    .trim();
  injectPositivePromptIntoGraph(graph, cleanPositivePrompt || params.positivePrompt);

  // 2. Character / LoRA Trigger Word (Node #30_27)
  const activeLoras = (params.loras || []).filter((l) => Boolean(l.loraName?.trim()));
  const resolvedTriggerWord =
    params.triggerWord !== undefined
      ? String(params.triggerWord).trim()
      : activeLoras
          .map((l) => (l.triggerWord || '').trim())
          .filter(Boolean)
          .join(', ');

  if (graph['30_27']?.inputs) {
    graph['30_27'].inputs.string_b = resolvedTriggerWord;
  }

  // 3. Seed (Node #30_3 KSampler or first KSampler)
  const numericSeed =
    Number(params.seed) > 0
      ? Math.floor(Number(params.seed))
      : Math.floor(Math.random() * 1e15) + 1;
  const samplerNode =
    graph['30_3']?.inputs
      ? graph['30_3']
      : Object.values(graph).find(
          (n: any) => n && typeof n === 'object' && String(n.class_type || '').includes('KSampler')
        );
  if (samplerNode?.inputs) {
    const seedField = typeof samplerNode.inputs.noise_seed === 'number' ? 'noise_seed' : 'seed';
    samplerNode.inputs[seedField] = numericSeed;
  }

  // 4. Resolution Selector (#49 capped at 3.0 MP) & Inline Upscale Switch (#51/#52 for > 3.0 MP)
  const requestedMp = Math.max(0.5, Math.min(10.0, Number(params.megapixels) || 3.0));
  const shouldUpscale = requestedMp > 3.0;
  const baseMp = Math.min(3.0, requestedMp);
  const baseDims = shouldUpscale
    ? computeDimensionsFromMegapixels(params.aspectRatio, baseMp)
    : { width: params.width, height: params.height };

  const resNode =
    graph['49']?.class_type === 'ResolutionSelector'
      ? graph['49']
      : Object.values(graph).find(
          (n: any) =>
            n &&
            typeof n === 'object' &&
            (n.class_type === 'ResolutionSelector' ||
              String(n.class_type || '').includes('EmptyLatent'))
        );
  if (resNode?.inputs) {
    const resInputs = resNode.inputs;
    if ('aspect_ratio' in resInputs || 'megapixels' in resInputs) {
      resInputs.aspect_ratio = normalizeResolutionSelectorRatio(params.aspectRatio);
      resInputs.megapixels = Number(baseMp.toFixed(2));
    }
    if (typeof resInputs.width === 'number') resInputs.width = baseDims.width;
    if (typeof resInputs.height === 'number') resInputs.height = baseDims.height;
    if (typeof resInputs.batch_size === 'number') resInputs.batch_size = 1;
  }

  const inlineUpscale = findInlineUpscaleNodes(graph);
  if (inlineUpscale) {
    graph[inlineUpscale.switchNodeId].inputs.switch = shouldUpscale;
    if (shouldUpscale) {
      graph[inlineUpscale.scaleNodeId].inputs.megapixels = Number(requestedMp.toFixed(2));
    }
  }

  // 5. Diffusion Model Override (Node #30_10 UNETLoader)
  if (params.checkpointName) {
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
    if (ckptNode?.inputs) {
      const ckptField = 'unet_name' in ckptNode.inputs ? 'unet_name' : 'ckpt_name';
      ckptNode.inputs[ckptField] = params.checkpointName;
    }
  }

  // 6. Power Lora Loader (Node #50) & Enable LoRA Boolean (Node #30_23)
  const powerLoraNode =
    graph['50']?.inputs
      ? graph['50']
      : Object.values(graph).find(
          (n: any) =>
            n &&
            typeof n === 'object' &&
            (String(n.class_type || '').toLowerCase().includes('power lora loader') ||
              Boolean(n.inputs?.PowerLoraLoaderHeaderWidget))
        );

  if (powerLoraNode?.inputs) {
    const powerInputs = powerLoraNode.inputs;
    for (const key of Object.keys(powerInputs)) {
      if (/^lora_\d+$/i.test(key)) {
        delete powerInputs[key];
      }
    }

    const combinedLoras: { on: boolean; lora: string; strength: number }[] = [];
    const seenLoraNames = new Set<string>();
    for (const lora of activeLoras) {
      const key = lora.loraName.toLowerCase();
      if (!seenLoraNames.has(key)) {
        seenLoraNames.add(key);
        combinedLoras.push({
          on: true,
          lora: lora.loraName,
          strength: Number(lora.modelStrength ?? 1.0),
        });
      }
    }

    combinedLoras.forEach((entry, idx) => {
      powerInputs[`lora_${idx + 1}`] = {
        on: entry.on,
        lora: entry.lora,
        strength: entry.strength,
      };
    });

    if (graph['30_23']?.inputs && 'value' in graph['30_23'].inputs) {
      graph['30_23'].inputs.value = combinedLoras.length > 0;
    }
  }

  return graph;
}

/**
 * Loads the internal upscale workflow template (`src/server/workflows/upscale_workflow.json`),
 * injects the source image and target megapixel count into Node #9 (leaving Node #13's 3MP clamp intact),
 * and upgrades any terminal `PreviewImage` node to `SaveImage` for gallery indexing.
 */
export function compileUpscaleWorkflow(params: {
  imageFilename: string;
  subfolder?: string;
  sourceType?: 'input' | 'output';
  targetMegapixels: number;
  filenamePrefix?: string;
}): Record<string, any> {
  const rawJson = fs.readFileSync(UPSCALE_WORKFLOW_PATH, 'utf-8');
  const graph = JSON.parse(rawJson) as Record<string, any>;

  const cleanSubfolder = (params.subfolder || '').trim().replace(/^\/+|\/+$/g, '');
  const sourceSuffix = params.sourceType === 'input' ? '[input]' : '[output]';
  const annotatedImage = cleanSubfolder
    ? `${cleanSubfolder}/${params.imageFilename} ${sourceSuffix}`
    : `${params.imageFilename} ${sourceSuffix}`;
  const targetMp = Math.max(0.5, Math.min(10.0, Number(params.targetMegapixels) || 5.0));

  const upscaleModelNodeIds = new Set<string>();
  const scaleNodeIds: string[] = [];
  for (const [nodeId, node] of Object.entries(graph)) {
    if (!node || typeof node !== 'object') continue;
    const classType = String(node.class_type || '');
    if (classType === 'ImageUpscaleWithModel') {
      upscaleModelNodeIds.add(nodeId);
    } else if (classType === 'ImageScaleToTotalPixels') {
      scaleNodeIds.push(nodeId);
    }
  }

  const targetScaleNodeId =
    scaleNodeIds.find((id) => {
      const imgInput = graph[id]?.inputs?.image;
      return Array.isArray(imgInput) && upscaleModelNodeIds.has(String(imgInput[0]));
    }) ||
    scaleNodeIds.find((id) => Number(graph[id]?.inputs?.megapixels) !== 3) ||
    scaleNodeIds[scaleNodeIds.length - 1] ||
    null;

  for (const [nodeId, node] of Object.entries(graph)) {
    if (!node || typeof node !== 'object') continue;
    const classType = String(node.class_type || '');
    const inputs = node.inputs && typeof node.inputs === 'object' ? node.inputs : {};

    if (classType === 'LoadImage') {
      inputs.image = annotatedImage;
    } else if (
      nodeId === targetScaleNodeId ||
      (!targetScaleNodeId && classType !== 'ImageScaleToTotalPixels' && 'megapixels' in inputs)
    ) {
      inputs.megapixels = Number(targetMp.toFixed(2));
    } else if (classType === 'PreviewImage' || classType === 'SaveImage') {
      node.class_type = 'SaveImage';
      inputs.filename_prefix =
        params.filenamePrefix || inputs.filename_prefix || 'Krea2_turbo_upscaled';
      if (node._meta && typeof node._meta === 'object') {
        node._meta.title = 'Save Image';
      }
    }
  }

  return graph;
}
