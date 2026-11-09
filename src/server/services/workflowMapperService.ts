import { db } from '../db.ts';
import type {
  GenerationLoraSelection,
  WorkflowNodeMapping,
  WorkflowNodeSlotInfo,
} from '../../shared/types.ts';

/**
 * Computes pixel width & height (multiples of 64) from an aspect ratio string (e.g. "3:4") and megapixels (0.1 - 10.0).
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
 * Traces an upstream link [nodeId, slotIdx] to find a text-encoding node if connected via conditioning utilities.
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
  const inputs = node.inputs || {};

  for (const candidateField of ['text', 'text_g', 'text_l', 'prompt', 'positive', 'string']) {
    if (typeof inputs[candidateField] === 'string') {
      return { nodeId: targetId, field: candidateField };
    }
  }

  for (const upstreamKey of ['conditioning', 'conditioning_1', 'conditioning_to', 'clip_text']) {
    if (Array.isArray(inputs[upstreamKey])) {
      const found = tracePromptNode(apiGraph, inputs[upstreamKey], visited);
      if (found) return found;
    }
  }

  return null;
}

/**
 * Automatically detects node mappings for any standard or custom ComfyUI API workflow,
 * prioritizing dedicated aspect_ratio + megapixels resolution nodes.
 */
export function autoDetectWorkflowMapping(
  workflowId: number,
  apiGraph: Record<string, any>
): WorkflowNodeMapping {
  let positivePromptNodeId: string | null = null;
  let positivePromptField = 'text';
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
  const loraNodeIds: string[] = [];

  // 1. Scan for dedicated Resolution / Megapixel + Aspect Ratio nodes first
  for (const [nodeId, node] of Object.entries(apiGraph)) {
    if (!node || typeof node !== 'object') continue;
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

    if (detectedArField || detectedMpField) {
      latentNodeId = nodeId;
      if (detectedArField) aspectRatioField = detectedArField;
      if (detectedMpField) megapixelsField = detectedMpField;
      break;
    }
  }

  // 2. Scan for KSampler / Sampler / RandomNoise nodes
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
      if (!seedNodeId) {
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

  // 3. Scan all nodes for fallbacks, checkpoints, LoRAs, and latent dimensions
  const clipEncodeCandidates: { nodeId: string; title: string; field: string; text: string }[] = [];

  for (const [nodeId, node] of Object.entries(apiGraph)) {
    if (!node || typeof node !== 'object') continue;
    const classType = String(node.class_type || '');
    const title = String(node._meta?.title || classType).toLowerCase();
    const inputs = node.inputs || {};

    if (
      !checkpointNodeId &&
      (classType.includes('CheckpointLoader') ||
        classType.includes('UNETLoader') ||
        typeof inputs.ckpt_name === 'string')
    ) {
      checkpointNodeId = nodeId;
    }

    if (classType.toLowerCase().includes('lora') && typeof inputs.lora_name === 'string') {
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
    loraNodeIds,
  };
}

/**
 * Returns the active node mapping for a workflow (merges user-saved mapping with auto-detection).
 */
export function getWorkflowMapping(workflowId: number): {
  mapping: WorkflowNodeMapping;
  nodes: WorkflowNodeSlotInfo[];
  hasValidApiGraph: boolean;
} {
  const wfRow = db.prepare('SELECT * FROM workflows WHERE id = ?').get(workflowId) as any;
  const apiGraph = getExecutableApiGraph(wfRow);
  if (!apiGraph) {
    return {
      mapping: {
        workflowId,
        isCustomMapped: false,
        positivePromptNodeId: null,
        positivePromptField: 'text',
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
        loraNodeIds: [],
      },
      nodes: [],
      hasValidApiGraph: false,
    };
  }

  const nodes = extractWorkflowNodeSlots(apiGraph);
  const autoMapping = autoDetectWorkflowMapping(workflowId, apiGraph);

  const savedRow = db
    .prepare('SELECT * FROM workflow_mappings WHERE workflow_id = ?')
    .get(workflowId) as any;

  if (!savedRow) {
    return { mapping: autoMapping, nodes, hasValidApiGraph: true };
  }

  let parsedLoraIds: string[] = autoMapping.loraNodeIds;
  try {
    const arr = JSON.parse(savedRow.lora_node_ids_json || '[]');
    if (Array.isArray(arr)) parsedLoraIds = arr.map(String);
  } catch {
    // ignore
  }

  return {
    mapping: {
      workflowId,
      isCustomMapped: true,
      positivePromptNodeId: savedRow.positive_prompt_node_id ?? autoMapping.positivePromptNodeId,
      positivePromptField: savedRow.positive_prompt_field || autoMapping.positivePromptField,
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
      loraNodeIds: parsedLoraIds,
      updatedAt: savedRow.updated_at,
    },
    nodes,
    hasValidApiGraph: true,
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
      negative_prompt_node_id, negative_prompt_field,
      seed_node_id, seed_field,
      steps_node_id, cfg_node_id, sampler_node_id,
      latent_node_id, aspect_ratio_field, megapixels_field, width_field, height_field, batch_size_field,
      checkpoint_node_id, lora_node_ids_json, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(workflow_id) DO UPDATE SET
      positive_prompt_node_id = excluded.positive_prompt_node_id,
      positive_prompt_field = excluded.positive_prompt_field,
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
      lora_node_ids_json = excluded.lora_node_ids_json,
      updated_at = datetime('now')`
  ).run(
    workflowId,
    merged.positivePromptNodeId,
    merged.positivePromptField,
    merged.negativePromptNodeId,
    merged.negativePromptField,
    merged.seedNodeId,
    merged.seedField,
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
    JSON.stringify(merged.loraNodeIds || [])
  );

  return getWorkflowMapping(workflowId).mapping;
}

/**
 * Compiles an executable ComfyUI API prompt payload by injecting prompt, negative prompt,
 * seed, aspect_ratio + megapixels, checkpoint, and 0..N character LoRAs into the mapped workflow graph.
 */
export function compileWorkflowForGeneration(params: {
  workflowId: number;
  positivePrompt: string;
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

  // 1. Positive Prompt
  if (mapping.positivePromptNodeId && graph[mapping.positivePromptNodeId]?.inputs) {
    graph[mapping.positivePromptNodeId].inputs[mapping.positivePromptField || 'text'] =
      params.positivePrompt;
  }

  // 2. Negative Prompt
  if (mapping.negativePromptNodeId && graph[mapping.negativePromptNodeId]?.inputs) {
    graph[mapping.negativePromptNodeId].inputs[mapping.negativePromptField || 'text'] =
      params.negativePrompt;
  }

  // 3. Seed
  const numericSeed = Number(params.seed) || Math.floor(Math.random() * 900000000000) + 100000;
  if (mapping.seedNodeId && graph[mapping.seedNodeId]?.inputs) {
    graph[mapping.seedNodeId].inputs[mapping.seedField || 'seed'] = numericSeed;
  }

  // 4. Resolution Node: Aspect Ratio & Megapixels (0.1 - 10.0)
  if (mapping.latentNodeId && graph[mapping.latentNodeId]?.inputs) {
    const latentInputs = graph[mapping.latentNodeId].inputs;
    const arField = mapping.aspectRatioField || 'aspect_ratio';
    const mpField = mapping.megapixelsField || 'megapixels';

    // Always set the mapped aspect_ratio and megapixels fields if present or if no width/height exist
    if (
      arField in latentInputs ||
      mpField in latentInputs ||
      !('width' in latentInputs && 'height' in latentInputs)
    ) {
      latentInputs[arField] = params.aspectRatio;
      latentInputs[mpField] = Number(params.megapixels.toFixed(2));
    }

    // Also update width/height if the node also exposes them (e.g. hybrid or standard EmptyLatentImage)
    const wField = mapping.widthField || 'width';
    const hField = mapping.heightField || 'height';
    if (wField in latentInputs && typeof latentInputs[wField] === 'number') {
      latentInputs[wField] = params.width;
    }
    if (hField in latentInputs && typeof latentInputs[hField] === 'number') {
      latentInputs[hField] = params.height;
    }
    if (mapping.batchSizeField && latentInputs[mapping.batchSizeField] !== undefined) {
      latentInputs[mapping.batchSizeField] = 1;
    }
  }

  // 5. Optional Checkpoint Override
  if (
    params.checkpointName &&
    mapping.checkpointNodeId &&
    graph[mapping.checkpointNodeId]?.inputs
  ) {
    const ckptInputs = graph[mapping.checkpointNodeId].inputs;
    if ('ckpt_name' in ckptInputs) ckptInputs.ckpt_name = params.checkpointName;
    else if ('unet_name' in ckptInputs) ckptInputs.unet_name = params.checkpointName;
  }

  // 6. LoRA Injection & Dynamic Multi-LoRA Chaining
  const mappedLoraNodes = (mapping.loraNodeIds || []).filter((id) => Boolean(graph[id]?.inputs));
  const activeLoras = (params.loras || []).filter((l) => Boolean(l.loraName?.trim()));

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
  } else if (mapping.checkpointNodeId && graph[mapping.checkpointNodeId]) {
    let prevSourceId = mapping.checkpointNodeId;
    for (let i = 0; i < activeLoras.length; i++) {
      const lora = activeLoras[i];
      const newNodeId = `couchy_lora_${i + 1}`;
      graph[newNodeId] = {
        class_type: 'LoraLoader',
        _meta: { title: `Injected LoRA (${lora.appearanceLabel || lora.loraName})` },
        inputs: {
          lora_name: lora.loraName,
          strength_model: lora.modelStrength,
          strength_clip: lora.clipStrength,
          model: [prevSourceId, 0],
          clip: [prevSourceId, 1],
        },
      };
      for (const [id, nodeObj] of Object.entries(graph)) {
        if (id === newNodeId || !nodeObj?.inputs) continue;
        for (const [k, v] of Object.entries(nodeObj.inputs)) {
          if (
            Array.isArray(v) &&
            String(v[0]) === String(prevSourceId) &&
            (v[1] === 0 || v[1] === 1)
          ) {
            nodeObj.inputs[k] = [newNodeId, v[1]];
          }
        }
      }
      prevSourceId = newNodeId;
    }
  }

  return graph;
}
