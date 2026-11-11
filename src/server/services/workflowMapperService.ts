import { db } from '../db.ts';
import {
  normalizeResolutionSelectorRatio,
  type GenerationLoraSelection,
  type WorkflowNodeMapping,
  type WorkflowNodeSlotInfo,
} from '../../shared/types.ts';

/**
 * Computes pixel width & height (multiples of 64) from an aspect ratio string (e.g. "2:3 (Portrait Photo)") and megapixels (0.1 - 10.0).
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
 * Resolves the executable API workflow JSON object for a given workflow row.
 */
export function getExecutableApiGraph(workflowRow: any): Record<string, any> | null {
  if (!workflowRow) return null;
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
 * Extracts all nodes and their editable scalar inputs for the visual Node Mapper modal.
 */
export function extractWorkflowNodeSlots(apiGraph: Record<string, any>): WorkflowNodeSlotInfo[] {
  const slots: WorkflowNodeSlotInfo[] = [];
  for (const [nodeId, nodeObj] of Object.entries(apiGraph)) {
    if (!nodeObj || typeof nodeObj !== 'object') continue;
    const classType = String(nodeObj.class_type || 'UnknownNode');
    const title = String(nodeObj._meta?.title || classType);
    const inputs = nodeObj.inputs && typeof nodeObj.inputs === 'object' ? nodeObj.inputs : {};
    const inputFields: string[] = [];
    const currentValues: Record<string, any> = {};

    for (const [key, val] of Object.entries(inputs)) {
      inputFields.push(key);
      if (!Array.isArray(val)) {
        currentValues[key] = val;
      } else {
        currentValues[key] = `[Link -> Node ${val[0]}:${val[1]}]`;
      }
    }

    slots.push({
      nodeId,
      classType,
      title,
      inputFields,
      currentValues,
    });
  }
  return slots;
}

/**
 * Traces an upstream link [nodeId, slotIdx] to find a text-encoding or primitive string node.
 */
function tracePromptNode(
  apiGraph: Record<string, any>,
  linkVal: any,
  visited = new Set<string>()
): { nodeId: string; field: string } | null {
  if (!Array.isArray(linkVal) || linkVal.length < 1) return null;
  const targetId = String(linkVal[0]);
  if (visited.has(targetId)) return null;
  visited.add(targetId);

  const node = apiGraph[targetId];
  if (!node || typeof node !== 'object') return null;
  const classType = String(node.class_type || '');
  const title = String(node._meta?.title || '').toLowerCase();
  const inputs = node.inputs || {};

  // Check if this is an explicit user prompt primitive string
  if (
    (classType.includes('PrimitiveString') || typeof inputs.value === 'string') &&
    (title.includes('user prompt') || (!title.includes('system') && typeof inputs.value === 'string'))
  ) {
    return { nodeId: targetId, field: 'value' };
  }

  for (const candidateField of ['text', 'text_g', 'text_l', 'prompt', 'positive', 'string']) {
    if (typeof inputs[candidateField] === 'string') {
      return { nodeId: targetId, field: candidateField };
    }
  }

  // Traverse upstream through switches, previews, concatenations, and conditioning nodes
  for (const upstreamKey of [
    'text',
    'on_false',
    'on_true',
    'source',
    'string_a',
    'conditioning',
    'conditioning_1',
    'conditioning_to',
    'clip_text',
  ]) {
    if (Array.isArray(inputs[upstreamKey])) {
      const found = tracePromptNode(apiGraph, inputs[upstreamKey], visited);
      if (found) return found;
    }
  }

  return null;
}

/**
 * Automatically detects node mappings for Krea2_turbo and any standard or custom ComfyUI API workflow.
 */
export function autoDetectWorkflowMapping(
  workflowId: number,
  apiGraph: Record<string, any>
): WorkflowNodeMapping {
  let positivePromptNodeId: string | null = null;
  let positivePromptField = 'value';
  let triggerWordNodeId: string | null = null;
  let triggerWordField = 'string_b';
  let negativePromptNodeId: string | null = null;
  let negativePromptField = 'text';
  let seedNodeId: string | null = null;
  let seedField = 'seed';
  let stepsNodeId: string | null = null;
  let cfgNodeId: string | null = null;
  let samplerNodeId: string | null = null;
  let latentNodeId: string | null = null;
  let aspectRatioField = 'aspect_ratio';
  let megapixelsField = 'megapixels';
  let widthField = 'width';
  let heightField = 'height';
  let batchSizeField = 'batch_size';
  let checkpointNodeId: string | null = null;
  let checkpointField = 'unet_name';
  const loraNodeIds: string[] = [];
  let enableLoraNodeId: string | null = null;
  let enableLoraField = 'value';

  // 1. Scan for dedicated ResolutionSelector / Megapixel + Aspect Ratio nodes first (e.g. Node #49)
  for (const [nodeId, node] of Object.entries(apiGraph)) {
    if (!node || typeof node !== 'object') continue;
    const classType = String(node.class_type || '');
    const inputs = node.inputs || {};
    const inputKeys = Object.keys(inputs);

    const detectedArField = inputKeys.find((k) =>
      ['aspect_ratio', 'ratio', 'aspect', 'dimensions'].includes(k.toLowerCase())
    );
    const detectedMpField = inputKeys.find((k) =>
      ['megapixels', 'megapixel', 'mp', 'total_megapixels', 'target_megapixels'].includes(
        k.toLowerCase()
      )
    );

    if (classType === 'ResolutionSelector' || detectedArField || detectedMpField) {
      latentNodeId = nodeId;
      if (detectedArField) aspectRatioField = detectedArField;
      if (detectedMpField) megapixelsField = detectedMpField;
      break;
    }
  }

  // 2. Scan for explicit Krea2_turbo / PrimitiveString / Trigger Word / Enable LoRA nodes
  for (const [nodeId, node] of Object.entries(apiGraph)) {
    if (!node || typeof node !== 'object') continue;
    const classType = String(node.class_type || '');
    const title = String(node._meta?.title || classType).toLowerCase();
    const inputs = node.inputs || {};

    // User Prompt node (e.g. Node "30_19" PrimitiveStringMultiline)
    if (
      !positivePromptNodeId &&
      (classType.includes('PrimitiveString') || typeof inputs.value === 'string') &&
      title.includes('user prompt')
    ) {
      positivePromptNodeId = nodeId;
      positivePromptField = 'value';
    }

    // Trigger Word node (e.g. Node "30_27" StringConcatenate with title "Concatenate Text (LoRA Trigger Word)")
    if (
      !triggerWordNodeId &&
      (classType === 'StringConcatenate' || 'string_b' in inputs) &&
      (title.includes('trigger') || title.includes('lora'))
    ) {
      triggerWordNodeId = nodeId;
      triggerWordField = 'string_b' in inputs ? 'string_b' : 'value';
    }

    // Enable LoRA boolean switch (e.g. Node "30_23" PrimitiveBoolean with title "Boolean (Enable LoRA?)")
    if (
      !enableLoraNodeId &&
      (classType === 'PrimitiveBoolean' || typeof inputs.value === 'boolean') &&
      title.includes('lora')
    ) {
      enableLoraNodeId = nodeId;
      enableLoraField = 'value';
    }
  }

  // 3. Scan for KSampler / Sampler / RandomNoise nodes (e.g. Node "30_3")
  for (const [nodeId, node] of Object.entries(apiGraph)) {
    if (!node || typeof node !== 'object') continue;
    const classType = String(node.class_type || '');
    const inputs = node.inputs || {};

    if (
      classType.includes('KSampler') ||
      classType.includes('SamplerCustom') ||
      typeof inputs.seed === 'number' ||
      typeof inputs.noise_seed === 'number'
    ) {
      if (!seedNodeId && (classType.includes('KSampler') || typeof inputs.seed === 'number')) {
        seedNodeId = nodeId;
        seedField = typeof inputs.noise_seed === 'number' ? 'noise_seed' : 'seed';
      }
      if (!stepsNodeId && typeof inputs.steps === 'number') stepsNodeId = nodeId;
      if (!cfgNodeId && typeof inputs.cfg === 'number') cfgNodeId = nodeId;
      if (!samplerNodeId && typeof inputs.sampler_name === 'string') samplerNodeId = nodeId;

      if (!positivePromptNodeId && Array.isArray(inputs.positive)) {
        const tracedPos = tracePromptNode(apiGraph, inputs.positive);
        if (tracedPos) {
          positivePromptNodeId = tracedPos.nodeId;
          positivePromptField = tracedPos.field;
        }
      }
      if (!negativePromptNodeId && Array.isArray(inputs.negative)) {
        const tracedNeg = tracePromptNode(apiGraph, inputs.negative);
        if (tracedNeg) {
          negativePromptNodeId = tracedNeg.nodeId;
          negativePromptField = tracedNeg.field;
        }
      }
      if (!latentNodeId && Array.isArray(inputs.latent_image)) {
        const latentTargetId = String(inputs.latent_image[0]);
        const latentTarget = apiGraph[latentTargetId];
        if (latentTarget?.inputs) {
          latentNodeId = latentTargetId;
        }
      }
    }
  }

  // 4. Scan all nodes for Checkpoints/UNETs, Power Lora Loader / LoraLoaders, and fallbacks
  const clipEncodeCandidates: { nodeId: string; title: string; field: string; text: string }[] = [];

  for (const [nodeId, node] of Object.entries(apiGraph)) {
    if (!node || typeof node !== 'object') continue;
    const classType = String(node.class_type || '');
    const title = String(node._meta?.title || classType).toLowerCase();
    const inputs = node.inputs || {};

    if (
      !checkpointNodeId &&
      (classType.includes('UNETLoader') ||
        classType.includes('CheckpointLoader') ||
        typeof inputs.unet_name === 'string' ||
        typeof inputs.ckpt_name === 'string')
    ) {
      checkpointNodeId = nodeId;
      checkpointField = 'unet_name' in inputs ? 'unet_name' : 'ckpt_name';
    }

    if (
      classType.toLowerCase().includes('power lora loader') ||
      'PowerLoraLoaderHeaderWidget' in inputs ||
      (classType.toLowerCase().includes('lora') && typeof inputs.lora_name === 'string')
    ) {
      loraNodeIds.push(nodeId);
    }

    if (
      !latentNodeId &&
      (classType.includes('EmptyLatent') ||
        classType.includes('EmptySD3Latent') ||
        classType.toLowerCase().includes('resolution') ||
        (typeof inputs.width === 'number' && typeof inputs.height === 'number'))
    ) {
      latentNodeId = nodeId;
    }

    if (classType.includes('CLIPTextEncode') || typeof inputs.text === 'string') {
      const field =
        typeof inputs.text === 'string'
          ? 'text'
          : typeof inputs.text_g === 'string'
          ? 'text_g'
          : 'text';
      if (typeof inputs[field] === 'string') {
        clipEncodeCandidates.push({
          nodeId,
          title,
          field,
          text: inputs[field],
        });
      }
    }
  }

  if (!positivePromptNodeId && clipEncodeCandidates.length > 0) {
    const explicitPos = clipEncodeCandidates.find(
      (c) =>
        c.title.includes('positive') ||
        (!c.title.includes('negative') && !c.text.toLowerCase().includes('worst quality'))
    );
    const chosen = explicitPos || clipEncodeCandidates[0];
    positivePromptNodeId = chosen.nodeId;
    positivePromptField = chosen.field;
  }

  if (!negativePromptNodeId && clipEncodeCandidates.length > 1) {
    const explicitNeg = clipEncodeCandidates.find(
      (c) =>
        c.nodeId !== positivePromptNodeId &&
        (c.title.includes('negative') ||
          c.text.toLowerCase().includes('worst quality') ||
          c.text.toLowerCase().includes('blurry'))
    );
    const fallbackNeg = clipEncodeCandidates.find((c) => c.nodeId !== positivePromptNodeId);
    const chosen = explicitNeg || fallbackNeg;
    if (chosen) {
      negativePromptNodeId = chosen.nodeId;
      negativePromptField = chosen.field;
    }
  }

  return {
    workflowId,
    isCustomMapped: false,
    positivePromptNodeId,
    positivePromptField,
    triggerWordNodeId,
    triggerWordField,
    negativePromptNodeId,
    negativePromptField,
    seedNodeId,
    seedField,
    stepsNodeId,
    cfgNodeId,
    samplerNodeId,
    latentNodeId,
    aspectRatioField,
    megapixelsField,
    widthField,
    heightField,
    batchSizeField,
    checkpointNodeId,
    checkpointField,
    loraNodeIds,
    enableLoraNodeId,
    enableLoraField,
  };
}

/**
 * Returns the active node mapping for a workflow (merges user-saved mapping with auto-detection).
 */
export function getWorkflowMapping(workflowId: number): {
  mapping: WorkflowNodeMapping;
  nodes: WorkflowNodeSlotInfo[];
  hasValidApiGraph: boolean;
  defaultCheckpoint?: string | null;
} {
  const wfRow = db.prepare('SELECT * FROM workflows WHERE id = ?').get(workflowId) as any;
  const apiGraph = getExecutableApiGraph(wfRow);
  if (!apiGraph) {
    return {
      mapping: {
        workflowId,
        isCustomMapped: false,
        positivePromptNodeId: null,
        positivePromptField: 'value',
        triggerWordNodeId: null,
        triggerWordField: 'string_b',
        negativePromptNodeId: null,
        negativePromptField: 'text',
        seedNodeId: null,
        seedField: 'seed',
        stepsNodeId: null,
        cfgNodeId: null,
        samplerNodeId: null,
        latentNodeId: null,
        aspectRatioField: 'aspect_ratio',
        megapixelsField: 'megapixels',
        widthField: 'width',
        heightField: 'height',
        batchSizeField: 'batch_size',
        checkpointNodeId: null,
        checkpointField: 'unet_name',
        loraNodeIds: [],
        enableLoraNodeId: null,
        enableLoraField: 'value',
      },
      nodes: [],
      hasValidApiGraph: false,
      defaultCheckpoint: null,
    };
  }

  const nodes = extractWorkflowNodeSlots(apiGraph);
  const autoMapping = autoDetectWorkflowMapping(workflowId, apiGraph);

  const savedRow = db
    .prepare('SELECT * FROM workflow_mappings WHERE workflow_id = ?')
    .get(workflowId) as any;

  const resolvedCkptNodeId = savedRow?.checkpoint_node_id ?? autoMapping.checkpointNodeId;
  const resolvedCkptField =
    savedRow?.checkpoint_field || autoMapping.checkpointField || 'unet_name';
  let defaultCheckpoint: string | null = null;
  if (resolvedCkptNodeId && apiGraph[resolvedCkptNodeId]?.inputs) {
    const rawVal = apiGraph[resolvedCkptNodeId].inputs[resolvedCkptField];
    if (typeof rawVal === 'string' && rawVal.trim()) {
      defaultCheckpoint = rawVal.trim();
    }
  }

  if (!savedRow) {
    return { mapping: autoMapping, nodes, hasValidApiGraph: true, defaultCheckpoint };
  }

  let parsedLoraIds: string[] = autoMapping.loraNodeIds;
  try {
    const arr = JSON.parse(savedRow.lora_node_ids_json || '[]');
    if (Array.isArray(arr) && arr.length > 0) parsedLoraIds = arr.map(String);
  } catch {
    // ignore
  }

  return {
    mapping: {
      workflowId,
      isCustomMapped: true,
      positivePromptNodeId: savedRow.positive_prompt_node_id ?? autoMapping.positivePromptNodeId,
      positivePromptField: savedRow.positive_prompt_field || autoMapping.positivePromptField,
      triggerWordNodeId: savedRow.trigger_word_node_id ?? autoMapping.triggerWordNodeId,
      triggerWordField: savedRow.trigger_word_field || autoMapping.triggerWordField,
      negativePromptNodeId: savedRow.negative_prompt_node_id ?? autoMapping.negativePromptNodeId,
      negativePromptField: savedRow.negative_prompt_field || autoMapping.negativePromptField,
      seedNodeId: savedRow.seed_node_id ?? autoMapping.seedNodeId,
      seedField: savedRow.seed_field || autoMapping.seedField,
      stepsNodeId: savedRow.steps_node_id ?? autoMapping.stepsNodeId,
      cfgNodeId: savedRow.cfg_node_id ?? autoMapping.cfgNodeId,
      samplerNodeId: savedRow.sampler_node_id ?? autoMapping.samplerNodeId,
      latentNodeId: savedRow.latent_node_id ?? autoMapping.latentNodeId,
      aspectRatioField: savedRow.aspect_ratio_field || autoMapping.aspectRatioField,
      megapixelsField: savedRow.megapixels_field || autoMapping.megapixelsField,
      widthField: savedRow.width_field || autoMapping.widthField,
      heightField: savedRow.height_field || autoMapping.heightField,
      batchSizeField: savedRow.batch_size_field || autoMapping.batchSizeField,
      checkpointNodeId: savedRow.checkpoint_node_id ?? autoMapping.checkpointNodeId,
      checkpointField: savedRow.checkpoint_field || autoMapping.checkpointField,
      loraNodeIds: parsedLoraIds,
      enableLoraNodeId: savedRow.enable_lora_node_id ?? autoMapping.enableLoraNodeId,
      enableLoraField: savedRow.enable_lora_field || autoMapping.enableLoraField,
      updatedAt: savedRow.updated_at,
    },
    nodes,
    hasValidApiGraph: true,
    defaultCheckpoint,
  };
}

/**
 * Saves or updates custom node mappings for a workflow.
 */
export function saveWorkflowMapping(
  workflowId: number,
  payload: Partial<WorkflowNodeMapping>
): WorkflowNodeMapping {
  const current = getWorkflowMapping(workflowId).mapping;
  const merged: WorkflowNodeMapping = {
    ...current,
    ...payload,
    workflowId,
    isCustomMapped: true,
  };

  db.prepare(
    `INSERT INTO workflow_mappings (
      workflow_id,
      positive_prompt_node_id, positive_prompt_field,
      trigger_word_node_id, trigger_word_field,
      negative_prompt_node_id, negative_prompt_field,
      seed_node_id, seed_field,
      steps_node_id, cfg_node_id, sampler_node_id,
      latent_node_id, aspect_ratio_field, megapixels_field, width_field, height_field, batch_size_field,
      checkpoint_node_id, checkpoint_field, lora_node_ids_json,
      enable_lora_node_id, enable_lora_field, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(workflow_id) DO UPDATE SET
      positive_prompt_node_id = excluded.positive_prompt_node_id,
      positive_prompt_field = excluded.positive_prompt_field,
      trigger_word_node_id = excluded.trigger_word_node_id,
      trigger_word_field = excluded.trigger_word_field,
      negative_prompt_node_id = excluded.negative_prompt_node_id,
      negative_prompt_field = excluded.negative_prompt_field,
      seed_node_id = excluded.seed_node_id,
      seed_field = excluded.seed_field,
      steps_node_id = excluded.steps_node_id,
      cfg_node_id = excluded.cfg_node_id,
      sampler_node_id = excluded.sampler_node_id,
      latent_node_id = excluded.latent_node_id,
      aspect_ratio_field = excluded.aspect_ratio_field,
      megapixels_field = excluded.megapixels_field,
      width_field = excluded.width_field,
      height_field = excluded.height_field,
      batch_size_field = excluded.batch_size_field,
      checkpoint_node_id = excluded.checkpoint_node_id,
      checkpoint_field = excluded.checkpoint_field,
      lora_node_ids_json = excluded.lora_node_ids_json,
      enable_lora_node_id = excluded.enable_lora_node_id,
      enable_lora_field = excluded.enable_lora_field,
      updated_at = datetime('now')`
  ).run(
    workflowId,
    merged.positivePromptNodeId,
    merged.positivePromptField || 'value',
    merged.triggerWordNodeId,
    merged.triggerWordField || 'string_b',
    merged.negativePromptNodeId,
    merged.negativePromptField || 'text',
    merged.seedNodeId,
    merged.seedField || 'seed',
    merged.stepsNodeId,
    merged.cfgNodeId,
    merged.samplerNodeId,
    merged.latentNodeId,
    merged.aspectRatioField || 'aspect_ratio',
    merged.megapixelsField || 'megapixels',
    merged.widthField || 'width',
    merged.heightField || 'height',
    merged.batchSizeField || 'batch_size',
    merged.checkpointNodeId,
    merged.checkpointField || 'unet_name',
    JSON.stringify(merged.loraNodeIds || []),
    merged.enableLoraNodeId,
    merged.enableLoraField || 'value'
  );

  return getWorkflowMapping(workflowId).mapping;
}

/**
 * Compiles an executable ComfyUI API prompt payload by injecting:
 * - Node #30_19 (User Prompt value)
 * - Node #30_27 (LoRA Trigger Word string_b)
 * - Node #50 (Power Lora Loader (rgthree) lora_1, lora_2, ...) & Node #30_23 (Enable LoRA boolean)
 * - Node #49 (ResolutionSelector aspect_ratio & megapixels)
 * - Node #30_3 (KSampler random 64-bit integer seed 1..10^15)
 * - Node #30_10 (UNETLoader unet_name / CheckpointLoader ckpt_name)
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
  const { mapping } = getWorkflowMapping(params.workflowId);

  // 1. Positive Prompt (e.g. Node #30_19 inputs["value"])
  if (mapping.positivePromptNodeId && graph[mapping.positivePromptNodeId]?.inputs) {
    const posNodeInputs = graph[mapping.positivePromptNodeId].inputs;
    const posField =
      mapping.positivePromptField && mapping.positivePromptField in posNodeInputs
        ? mapping.positivePromptField
        : 'value' in posNodeInputs
        ? 'value'
        : 'text';
    const cleanPositivePrompt = (params.positivePrompt || '')
      .replace(/\b[\w\.\-]+\.(?:safetensors|ckpt|pt|bin)\b/gi, '')
      .replace(/\s*,\s*,+/g, ',')
      .replace(/^[\s,;:\-–—]+/, '')
      .replace(/[\s,;:\-–—]+$/, '')
      .trim();
    posNodeInputs[posField] = cleanPositivePrompt || params.positivePrompt;
  }

  // 2. Character / LoRA Trigger Word (e.g. Node #30_27 inputs["string_b"])
  const activeLoras = (params.loras || []).filter((l) => Boolean(l.loraName?.trim()));
  const resolvedTriggerWord =
    params.triggerWord !== undefined
      ? String(params.triggerWord).trim()
      : activeLoras
          .map((l) => (l.triggerWord || '').trim())
          .filter(Boolean)
          .join(', ');

  if (mapping.triggerWordNodeId && graph[mapping.triggerWordNodeId]?.inputs) {
    const trigInputs = graph[mapping.triggerWordNodeId].inputs;
    const trigField = mapping.triggerWordField || 'string_b';
    trigInputs[trigField] = resolvedTriggerWord;
  }

  // 3. Negative Prompt (if mapped)
  if (mapping.negativePromptNodeId && graph[mapping.negativePromptNodeId]?.inputs) {
    const negInputs = graph[mapping.negativePromptNodeId].inputs;
    const negField = mapping.negativePromptField || 'text';
    if (typeof negInputs[negField] === 'string') {
      negInputs[negField] = params.negativePrompt;
    }
  }

  // 4. Seed (Node #30_3 KSampler inputs["seed"] -> 64-bit safe integer 1..10^15)
  const numericSeed =
    Number(params.seed) > 0
      ? Math.floor(Number(params.seed))
      : Math.floor(Math.random() * 1e15) + 1;
  if (mapping.seedNodeId && graph[mapping.seedNodeId]?.inputs) {
    graph[mapping.seedNodeId].inputs[mapping.seedField || 'seed'] = numericSeed;
  }

  // 5. Resolution Selector Node (e.g. Node #49 inputs["aspect_ratio"] and inputs["megapixels"])
  if (mapping.latentNodeId && graph[mapping.latentNodeId]?.inputs) {
    const latentInputs = graph[mapping.latentNodeId].inputs;
    const arField = mapping.aspectRatioField || 'aspect_ratio';
    const mpField = mapping.megapixelsField || 'megapixels';
    const normalizedAr = normalizeResolutionSelectorRatio(params.aspectRatio);

    if (
      arField in latentInputs ||
      mpField in latentInputs ||
      !('width' in latentInputs && 'height' in latentInputs)
    ) {
      latentInputs[arField] = normalizedAr;
      latentInputs[mpField] = Number(params.megapixels.toFixed(2));
    }

    const wField = mapping.widthField || 'width';
    const hField = mapping.heightField || 'height';
    if (wField in latentInputs && typeof latentInputs[wField] === 'number') {
      latentInputs[wField] = params.width;
    }
    if (hField in latentInputs && typeof latentInputs[hField] === 'number') {
      latentInputs[hField] = params.height;
    }
    if (mapping.batchSizeField && typeof latentInputs[mapping.batchSizeField] === 'number') {
      latentInputs[mapping.batchSizeField] = 1;
    }
  }

  // 6. Diffusion Model / Checkpoint Override (e.g. Node #30_10 UNETLoader inputs["unet_name"])
  if (
    params.checkpointName &&
    mapping.checkpointNodeId &&
    graph[mapping.checkpointNodeId]?.inputs
  ) {
    const ckptInputs = graph[mapping.checkpointNodeId].inputs;
    const ckptField = mapping.checkpointField || ('unet_name' in ckptInputs ? 'unet_name' : 'ckpt_name');
    ckptInputs[ckptField] = params.checkpointName;
  }

  // 7 & 8. LoRA Injection (Supports Power Lora Loader (rgthree) Node #50 AND standard LoraLoader chaining)
  const mappedLoraNodes = (mapping.loraNodeIds || []).filter((id) => Boolean(graph[id]?.inputs));

  // Check if any mapped LoRA node is a Power Lora Loader (rgthree)
  const powerLoraNodeId = mappedLoraNodes.find((id) => {
    const n = graph[id];
    const ct = String(n?.class_type || '').toLowerCase();
    return ct.includes('power lora loader') || Boolean(n?.inputs?.PowerLoraLoaderHeaderWidget);
  });

  if (powerLoraNodeId) {
    const powerInputs = graph[powerLoraNodeId].inputs;
    // Collect any pre-configured LoRAs saved inside the workflow's Power Lora Loader node
    const savedEntries: { on: boolean; lora: string; strength: number }[] = [];
    const existingKeys = Object.keys(powerInputs)
      .filter((k) => /^lora_\d+$/i.test(k))
      .sort((a, b) => {
        const na = parseInt(a.replace(/\D+/g, ''), 10) || 0;
        const nb = parseInt(b.replace(/\D+/g, ''), 10) || 0;
        return na - nb;
      });

    for (const key of existingKeys) {
      const val = powerInputs[key];
      if (val && typeof val === 'object' && val.lora && val.on !== false) {
        savedEntries.push({
          on: true,
          lora: String(val.lora),
          strength: Number(val.strength ?? 1.0),
        });
      }
      delete powerInputs[key];
    }

    // Merge saved workflow LoRAs with runtime activeLoras (avoiding duplicate filenames)
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

    for (const saved of savedEntries) {
      const key = saved.lora.toLowerCase();
      if (!seenLoraNames.has(key)) {
        seenLoraNames.add(key);
        combinedLoras.push(saved);
      }
    }

    combinedLoras.forEach((entry, idx) => {
      powerInputs[`lora_${idx + 1}`] = {
        on: entry.on,
        lora: entry.lora,
        strength: entry.strength,
      };
    });

    if (mapping.enableLoraNodeId && graph[mapping.enableLoraNodeId]?.inputs) {
      const enableField = mapping.enableLoraField || 'value';
      graph[mapping.enableLoraNodeId].inputs[enableField] = combinedLoras.length > 0;
    }
  } else {
    if (mapping.enableLoraNodeId && graph[mapping.enableLoraNodeId]?.inputs) {
      const enableField = mapping.enableLoraField || 'value';
      graph[mapping.enableLoraNodeId].inputs[enableField] = activeLoras.length > 0;
    }
    if (activeLoras.length === 0) {
      for (const nodeId of mappedLoraNodes) {
        const inputs = graph[nodeId].inputs;
        if ('strength_model' in inputs) inputs.strength_model = 0;
        if ('strength_clip' in inputs) inputs.strength_clip = 0;
      }
    } else if (mappedLoraNodes.length > 0) {
    for (let i = 0; i < mappedLoraNodes.length; i++) {
      const nodeId = mappedLoraNodes[i];
      const inputs = graph[nodeId].inputs;
      const lora = activeLoras[i];
      if (lora) {
        inputs.lora_name = lora.loraName;
        if ('strength_model' in inputs) inputs.strength_model = lora.modelStrength;
        if ('strength_clip' in inputs) inputs.strength_clip = lora.clipStrength;
      } else {
        if ('strength_model' in inputs) inputs.strength_model = 0;
        if ('strength_clip' in inputs) inputs.strength_clip = 0;
      }
    }

    if (activeLoras.length > mappedLoraNodes.length) {
      let prevLoraNodeId = mappedLoraNodes[mappedLoraNodes.length - 1];
      for (let i = mappedLoraNodes.length; i < activeLoras.length; i++) {
        const extraLora = activeLoras[i];
        const newNodeId = `couchy_lora_${i + 1}`;
        graph[newNodeId] = {
          class_type: 'LoraLoader',
          _meta: { title: `Chained LoRA (${extraLora.appearanceLabel || extraLora.loraName})` },
          inputs: {
            lora_name: extraLora.loraName,
            strength_model: extraLora.modelStrength,
            strength_clip: extraLora.clipStrength,
            model: [prevLoraNodeId, 0],
            clip: [prevLoraNodeId, 1],
          },
        };
        for (const [id, nodeObj] of Object.entries(graph)) {
          if (id === newNodeId || !nodeObj?.inputs) continue;
          for (const [k, v] of Object.entries(nodeObj.inputs)) {
            if (Array.isArray(v) && String(v[0]) === String(prevLoraNodeId)) {
              nodeObj.inputs[k] = [newNodeId, v[1]];
            }
          }
        }
        prevLoraNodeId = newNodeId;
      }
    }
    }
  }

  return graph;
}
