import fs from 'fs';
import zlib from 'zlib';
import type { ModelType, ProvenanceSource } from '../../shared/types.ts';

export interface ExtractedLora {
  loraName: string;
  loraPath: string | null;
  loraHash: string | null;
  modelStrength: number;
  clipStrength: number;
  nodeId: string | null;
  nodeType: string | null;
  provenance: ProvenanceSource;
}

export interface ExtractedModelDep {
  modelName: string;
  modelType: ModelType;
  modelHash: string | null;
  nodeId: string | null;
  nodeType: string | null;
  provenance: ProvenanceSource;
}

export interface ParsedImageMetadata {
  rawChunks: Record<string, string>;
  visualWorkflowJson: string | null;
  apiWorkflowJson: string | null;
  positivePrompt: string | null;
  negativePrompt: string | null;
  seed: string | null;
  steps: number | null;
  cfg: number | null;
  sampler: string | null;
  scheduler: string | null;
  denoise: number | null;
  batchSize: number | null;
  batchIndex: number | null;
  generationDate: string | null;
  checkpointName: string | null;
  checkpointHash: string | null;
  vaeName: string | null;
  loras: ExtractedLora[];
  models: ExtractedModelDep[];
  missingFields: string[];
  provenance: Record<string, ProvenanceSource>;
}

/**
 * Reads PNG binary chunks (tEXt, iTXt, zTXt) without modifying the file.
 */
export function readPngTextChunks(filePath: string): Record<string, string> {
  const chunks: Record<string, string> = {};
  try {
    const buffer = fs.readFileSync(filePath);
    if (buffer.length < 8 || buffer.readUInt32BE(0) !== 0x89504e47) {
      return chunks;
    }

    let offset = 8;
    while (offset + 8 <= buffer.length) {
      const length = buffer.readUInt32BE(offset);
      const type = buffer.toString('ascii', offset + 4, offset + 8);
      const dataStart = offset + 8;
      const dataEnd = dataStart + length;
      if (dataEnd > buffer.length) break;

      const data = buffer.subarray(dataStart, dataEnd);
      if (type === 'tEXt') {
        const nul = data.indexOf(0);
        if (nul !== -1) {
          const key = data.toString('latin1', 0, nul);
          const val = data.toString('utf8', nul + 1);
          chunks[key] = val;
        }
      } else if (type === 'zTXt') {
        const nul = data.indexOf(0);
        if (nul !== -1 && nul + 2 <= data.length) {
          const key = data.toString('latin1', 0, nul);
          const compressed = data.subarray(nul + 2);
          try {
            chunks[key] = zlib.inflateSync(compressed).toString('utf8');
          } catch {
            // ignore malformed compressed chunk
          }
        }
      } else if (type === 'iTXt') {
        const nul = data.indexOf(0);
        if (nul !== -1 && nul + 3 <= data.length) {
          const key = data.toString('latin1', 0, nul);
          const compressionFlag = data[nul + 1];
          let pos = nul + 3;
          // Skip language tag and translated keyword (null-terminated)
          const langEnd = data.indexOf(0, pos);
          if (langEnd !== -1) {
            const transEnd = data.indexOf(0, langEnd + 1);
            if (transEnd !== -1) {
              pos = transEnd + 1;
              const payload = data.subarray(pos);
              try {
                chunks[key] =
                  compressionFlag === 1
                    ? zlib.inflateSync(payload).toString('utf8')
                    : payload.toString('utf8');
              } catch {
                // ignore malformed payload
              }
            }
          }
        }
      } else if (type === 'IEND') {
        break;
      }
      offset = dataEnd + 4; // skip 4-byte CRC
    }
  } catch {
    // non-PNG or unreadable
  }
  return chunks;
}

function cleanModelBasename(rawName: string): string {
  return rawName.trim().replace(/\\/g, '/').split('/').pop() || rawName.trim();
}

/**
 * Extracts generation parameters, LoRAs, and model dependencies from PNG/image files.
 */
export function parseImageMetadata(filePath: string): ParsedImageMetadata {
  const rawChunks = readPngTextChunks(filePath);
  const result: ParsedImageMetadata = {
    rawChunks,
    visualWorkflowJson: null,
    apiWorkflowJson: null,
    positivePrompt: null,
    negativePrompt: null,
    seed: null,
    steps: null,
    cfg: null,
    sampler: null,
    scheduler: null,
    denoise: null,
    batchSize: null,
    batchIndex: null,
    generationDate: rawChunks['Creation Time'] || rawChunks['date:create'] || null,
    checkpointName: null,
    checkpointHash: null,
    vaeName: null,
    loras: [],
    models: [],
    missingFields: [],
    provenance: {},
  };

  // 1. Inspect ComfyUI API format ('prompt' chunk)
  if (rawChunks.prompt) {
    try {
      const parsedPrompt = JSON.parse(rawChunks.prompt);
      if (parsedPrompt && typeof parsedPrompt === 'object') {
        result.apiWorkflowJson = rawChunks.prompt;
        extractFromApiGraph(parsedPrompt, result);
      }
    } catch {
      // keep raw chunk even if JSON is non-standard
    }
  }

  // 2. Inspect ComfyUI Visual format ('workflow' chunk)
  if (rawChunks.workflow) {
    try {
      const parsedWorkflow = JSON.parse(rawChunks.workflow);
      if (parsedWorkflow && typeof parsedWorkflow === 'object') {
        result.visualWorkflowJson = rawChunks.workflow;
        extractFromVisualWorkflow(parsedWorkflow, result);
      }
    } catch {
      // preserve raw chunk
    }
  }

  // 3. Fallback: Automatic1111 / ComfyUI 'parameters' text chunk
  if (rawChunks.parameters) {
    extractFromParametersText(rawChunks.parameters, result);
  }

  // Record missing core fields honestly without inventing values
  const coreCheck: [keyof ParsedImageMetadata, string][] = [
    ['positivePrompt', 'positive_prompt'],
    ['seed', 'seed'],
    ['steps', 'steps'],
    ['cfg', 'cfg'],
    ['sampler', 'sampler'],
    ['checkpointName', 'checkpoint'],
  ];
  for (const [prop, label] of coreCheck) {
    if (result[prop] === null || result[prop] === undefined || result[prop] === '') {
      result.missingFields.push(label);
    }
  }

  return result;
}

function addLoraIfUnique(result: ParsedImageMetadata, lora: ExtractedLora): void {
  if (!lora.loraName || lora.loraName === 'None') return;
  const basename = cleanModelBasename(lora.loraName);
  const exists = result.loras.some(
    (l) => cleanModelBasename(l.loraName).toLowerCase() === basename.toLowerCase() && l.nodeId === lora.nodeId
  );
  if (!exists) {
    result.loras.push({
      ...lora,
      loraName: basename,
      loraPath: lora.loraPath || lora.loraName,
    });
    result.models.push({
      modelName: basename,
      modelType: 'lora',
      modelHash: lora.loraHash,
      nodeId: lora.nodeId,
      nodeType: lora.nodeType,
      provenance: lora.provenance,
    });
  }
}

function addModelIfUnique(result: ParsedImageMetadata, model: ExtractedModelDep): void {
  if (!model.modelName || model.modelName === 'None') return;
  const basename = cleanModelBasename(model.modelName);
  const exists = result.models.some(
    (m) => cleanModelBasename(m.modelName).toLowerCase() === basename.toLowerCase() && m.modelType === model.modelType
  );
  if (!exists) {
    result.models.push({
      ...model,
      modelName: basename,
    });
  }
}

/**
 * Walks ComfyUI API graph nodes (keyed by node ID -> { class_type, inputs }).
 */
function extractFromApiGraph(graph: Record<string, any>, result: ParsedImageMetadata): void {
  const positiveNodeIds = new Set<string>();
  const negativeNodeIds = new Set<string>();

  for (const [nodeId, node] of Object.entries(graph)) {
    if (!node || typeof node !== 'object') continue;
    const classType = String(node.class_type || '');
    const inputs = node.inputs || {};

    // Sampler nodes
    if (/KSampler|SamplerCustom|Efficient Loader/i.test(classType)) {
      if (inputs.seed !== undefined && result.seed === null) {
        result.seed = String(inputs.seed);
        result.provenance.seed = 'embedded_api';
      } else if (inputs.noise_seed !== undefined && result.seed === null) {
        result.seed = String(inputs.noise_seed);
        result.provenance.seed = 'embedded_api';
      }
      if (typeof inputs.steps === 'number' && result.steps === null) {
        result.steps = inputs.steps;
        result.provenance.steps = 'embedded_api';
      }
      if (typeof inputs.cfg === 'number' && result.cfg === null) {
        result.cfg = inputs.cfg;
        result.provenance.cfg = 'embedded_api';
      }
      if (typeof inputs.sampler_name === 'string' && result.sampler === null) {
        result.sampler = inputs.sampler_name;
        result.provenance.sampler = 'embedded_api';
      }
      if (typeof inputs.scheduler === 'string' && result.scheduler === null) {
        result.scheduler = inputs.scheduler;
        result.provenance.scheduler = 'embedded_api';
      }
      if (typeof inputs.denoise === 'number' && result.denoise === null) {
        result.denoise = inputs.denoise;
        result.provenance.denoise = 'embedded_api';
      }
      if (Array.isArray(inputs.positive) && typeof inputs.positive[0] === 'string') {
        positiveNodeIds.add(inputs.positive[0]);
      }
      if (Array.isArray(inputs.negative) && typeof inputs.negative[0] === 'string') {
        negativeNodeIds.add(inputs.negative[0]);
      }
    }

    // Latent size / Batch
    if (/EmptyLatentImage|EmptySD3LatentImage|Efficient Loader/i.test(classType)) {
      if (typeof inputs.batch_size === 'number' && result.batchSize === null) {
        result.batchSize = inputs.batch_size;
        result.provenance.batchSize = 'embedded_api';
      }
    }

    // Checkpoint / Diffusion / UNET Loaders
    if (/CheckpointLoader|UNETLoader|Eff\. Loader/i.test(classType)) {
      const ckpt = inputs.ckpt_name || inputs.unet_name || inputs.model_name;
      if (typeof ckpt === 'string' && ckpt !== 'None') {
        if (!result.checkpointName) {
          result.checkpointName = cleanModelBasename(ckpt);
          result.provenance.checkpoint = 'embedded_api';
        }
        addModelIfUnique(result, {
          modelName: ckpt,
          modelType: /UNET/i.test(classType) ? 'diffusion' : 'checkpoint',
          modelHash: null,
          nodeId,
          nodeType: classType,
          provenance: 'embedded_api',
        });
      }
    }

    // VAE Loader
    if (/VAELoader/i.test(classType) || typeof inputs.vae_name === 'string') {
      const vae = inputs.vae_name;
      if (typeof vae === 'string' && vae !== 'None' && vae !== 'Baked VAE') {
        if (!result.vaeName) {
          result.vaeName = cleanModelBasename(vae);
          result.provenance.vae = 'embedded_api';
        }
        addModelIfUnique(result, {
          modelName: vae,
          modelType: 'vae',
          modelHash: null,
          nodeId,
          nodeType: classType,
          provenance: 'embedded_api',
        });
      }
    }

    // ControlNet & Upscalers & CLIP
    if (/ControlNetLoader/i.test(classType) && typeof inputs.control_net_name === 'string') {
      addModelIfUnique(result, {
        modelName: inputs.control_net_name,
        modelType: 'controlnet',
        modelHash: null,
        nodeId,
        nodeType: classType,
        provenance: 'embedded_api',
      });
    }
    if (/UpscaleModelLoader/i.test(classType) && typeof inputs.model_name === 'string') {
      addModelIfUnique(result, {
        modelName: inputs.model_name,
        modelType: 'upscaler',
        modelHash: null,
        nodeId,
        nodeType: classType,
        provenance: 'embedded_api',
      });
    }
    if (/CLIPLoader|DualCLIPLoader/i.test(classType)) {
      for (const k of ['clip_name', 'clip_name1', 'clip_name2']) {
        if (typeof inputs[k] === 'string') {
          addModelIfUnique(result, {
            modelName: inputs[k],
            modelType: 'clip',
            modelHash: null,
            nodeId,
            nodeType: classType,
            provenance: 'embedded_api',
          });
        }
      }
    }

    // Standard & Multi-LoRA Loaders (LoraLoader, LoraLoaderModelOnly, Power Lora Loader, CR LoRA Stack)
    if (typeof inputs.lora_name === 'string' && inputs.lora_name !== 'None') {
      const modelStr = typeof inputs.strength_model === 'number' ? inputs.strength_model : 1.0;
      const clipStr =
        typeof inputs.strength_clip === 'number' ? inputs.strength_clip : modelStr;
      addLoraIfUnique(result, {
        loraName: inputs.lora_name,
        loraPath: inputs.lora_name,
        loraHash: null,
        modelStrength: modelStr,
        clipStrength: clipStr,
        nodeId,
        nodeType: classType,
        provenance: 'embedded_api',
      });
    }

    // Multi-slot LoRA loaders (e.g. lora_1, lora_2, lora_name_1...)
    for (const [inputKey, inputVal] of Object.entries(inputs)) {
      if (/^lora_\d+$/i.test(inputKey) && inputVal && typeof inputVal === 'object') {
        const slot = inputVal as Record<string, any>;
        if (slot.on !== false && typeof slot.lora === 'string' && slot.lora !== 'None') {
          const mStr = typeof slot.strength === 'number' ? slot.strength : 1.0;
          const cStr = typeof slot.strengthTwo === 'number' ? slot.strengthTwo : mStr;
          addLoraIfUnique(result, {
            loraName: slot.lora,
            loraPath: slot.lora,
            loraHash: null,
            modelStrength: mStr,
            clipStrength: cStr,
            nodeId,
            nodeType: classType,
            provenance: 'embedded_api',
          });
        }
      }
      const matchIdx = inputKey.match(/^lora_name_(\d+)$/i);
      if (matchIdx && typeof inputVal === 'string' && inputVal !== 'None') {
        const idx = matchIdx[1];
        const sw = inputs[`switch_${idx}`];
        if (sw !== 'Off' && sw !== false) {
          const mStr = Number(inputs[`model_weight_${idx}`] ?? inputs[`lora_wt_${idx}`] ?? 1.0);
          const cStr = Number(inputs[`clip_weight_${idx}`] ?? mStr);
          addLoraIfUnique(result, {
            loraName: inputVal,
            loraPath: inputVal,
            loraHash: null,
            modelStrength: isNaN(mStr) ? 1.0 : mStr,
            clipStrength: isNaN(cStr) ? 1.0 : cStr,
            nodeId,
            nodeType: classType,
            provenance: 'embedded_api',
          });
        }
      }
    }
  }

  // Extract positive and negative prompts from linked CLIPTextEncode nodes
  const resolveTextFromNode = (id: string): string | null => {
    const n = graph[id];
    if (!n || !n.inputs) return null;
    if (typeof n.inputs.text === 'string') return n.inputs.text;
    if (typeof n.inputs.positive === 'string') return n.inputs.positive;
    return null;
  };

  for (const id of positiveNodeIds) {
    const txt = resolveTextFromNode(id);
    if (txt && !result.positivePrompt) {
      result.positivePrompt = txt;
      result.provenance.positivePrompt = 'embedded_api';
    }
  }
  for (const id of negativeNodeIds) {
    const txt = resolveTextFromNode(id);
    if (txt && !result.negativePrompt) {
      result.negativePrompt = txt;
      result.provenance.negativePrompt = 'embedded_api';
    }
  }

  // Fallback scan over CLIPTextEncode nodes if links were indirect
  if (!result.positivePrompt) {
    for (const [, node] of Object.entries(graph)) {
      if (
        node &&
        /CLIPTextEncode/i.test(String(node.class_type)) &&
        typeof node.inputs?.text === 'string' &&
        node.inputs.text.trim().length > 0
      ) {
        if (!result.positivePrompt) {
          result.positivePrompt = node.inputs.text;
          result.provenance.positivePrompt = 'embedded_api';
        } else if (!result.negativePrompt && node.inputs.text !== result.positivePrompt) {
          result.negativePrompt = node.inputs.text;
          result.provenance.negativePrompt = 'embedded_api';
        }
      }
    }
  }
}

/**
 * Walks ComfyUI visual workflow JSON (nodes[] and widgets_values[]).
 */
function extractFromVisualWorkflow(workflow: Record<string, any>, result: ParsedImageMetadata): void {
  const nodes = Array.isArray(workflow.nodes) ? workflow.nodes : [];
  for (const node of nodes) {
    if (!node || typeof node !== 'object') continue;
    const nodeId = String(node.id ?? '');
    const nodeType = String(node.type || '');
    const widgets = Array.isArray(node.widgets_values) ? node.widgets_values : [];

    if (/CheckpointLoaderSimple|CheckpointLoader/i.test(nodeType) && typeof widgets[0] === 'string') {
      if (!result.checkpointName) {
        result.checkpointName = cleanModelBasename(widgets[0]);
        result.provenance.checkpoint = 'visual_workflow';
      }
      addModelIfUnique(result, {
        modelName: widgets[0],
        modelType: 'checkpoint',
        modelHash: null,
        nodeId,
        nodeType,
        provenance: 'visual_workflow',
      });
    }

    if (/VAELoader/i.test(nodeType) && typeof widgets[0] === 'string') {
      if (!result.vaeName) {
        result.vaeName = cleanModelBasename(widgets[0]);
        result.provenance.vae = 'visual_workflow';
      }
      addModelIfUnique(result, {
        modelName: widgets[0],
        modelType: 'vae',
        modelHash: null,
        nodeId,
        nodeType,
        provenance: 'visual_workflow',
      });
    }

    if (/LoraLoader/i.test(nodeType) && typeof widgets[0] === 'string') {
      const mStr = typeof widgets[1] === 'number' ? widgets[1] : 1.0;
      const cStr = typeof widgets[2] === 'number' ? widgets[2] : mStr;
      addLoraIfUnique(result, {
        loraName: widgets[0],
        loraPath: widgets[0],
        loraHash: null,
        modelStrength: mStr,
        clipStrength: cStr,
        nodeId,
        nodeType,
        provenance: 'visual_workflow',
      });
    }

    if (/Power Lora Loader/i.test(nodeType)) {
      for (const w of widgets) {
        if (w && typeof w === 'object' && w.on !== false && typeof w.lora === 'string') {
          const mStr = typeof w.strength === 'number' ? w.strength : 1.0;
          const cStr = typeof w.strengthTwo === 'number' ? w.strengthTwo : mStr;
          addLoraIfUnique(result, {
            loraName: w.lora,
            loraPath: w.lora,
            loraHash: null,
            modelStrength: mStr,
            clipStrength: cStr,
            nodeId,
            nodeType,
            provenance: 'visual_workflow',
          });
        }
      }
    }

    if (/KSampler/i.test(nodeType) && widgets.length >= 6) {
      // Standard KSampler widgets: [seed, control_after_generate, steps, cfg, sampler_name, scheduler, denoise]
      if (result.seed === null && (typeof widgets[0] === 'number' || typeof widgets[0] === 'string')) {
        result.seed = String(widgets[0]);
        result.provenance.seed = 'visual_workflow';
      }
      if (result.steps === null && typeof widgets[2] === 'number') {
        result.steps = widgets[2];
        result.provenance.steps = 'visual_workflow';
      }
      if (result.cfg === null && typeof widgets[3] === 'number') {
        result.cfg = widgets[3];
        result.provenance.cfg = 'visual_workflow';
      }
      if (result.sampler === null && typeof widgets[4] === 'string') {
        result.sampler = widgets[4];
        result.provenance.sampler = 'visual_workflow';
      }
      if (result.scheduler === null && typeof widgets[5] === 'string') {
        result.scheduler = widgets[5];
        result.provenance.scheduler = 'visual_workflow';
      }
      if (result.denoise === null && typeof widgets[6] === 'number') {
        result.denoise = widgets[6];
        result.provenance.denoise = 'visual_workflow';
      }
    }

    if (/CLIPTextEncode/i.test(nodeType) && typeof widgets[0] === 'string' && widgets[0].trim()) {
      const title = String(node.title || '').toLowerCase();
      if (title.includes('neg') && !result.negativePrompt) {
        result.negativePrompt = widgets[0];
        result.provenance.negativePrompt = 'visual_workflow';
      } else if (!result.positivePrompt) {
        result.positivePrompt = widgets[0];
        result.provenance.positivePrompt = 'visual_workflow';
      } else if (!result.negativePrompt && widgets[0] !== result.positivePrompt) {
        result.negativePrompt = widgets[0];
        result.provenance.negativePrompt = 'visual_workflow';
      }
    }
  }
}

/**
 * Fallback parser for 'parameters' chunk text.
 */
function extractFromParametersText(rawText: string, result: ParsedImageMetadata): void {
  const lines = rawText.split('\n');
  const negIdx = lines.findIndex((l) => l.startsWith('Negative prompt:'));
  const stepsIdx = lines.findIndex((l) => /^Steps:\s*\d+/i.test(l));

  if (!result.positivePrompt && (negIdx > 0 || stepsIdx > 0)) {
    const endPos = negIdx !== -1 ? negIdx : stepsIdx;
    result.positivePrompt = lines.slice(0, endPos).join('\n').trim();
    result.provenance.positivePrompt = 'a1111_parameters';
  }
  if (!result.negativePrompt && negIdx !== -1) {
    const endNeg = stepsIdx !== -1 ? stepsIdx : lines.length;
    result.negativePrompt = lines
      .slice(negIdx, endNeg)
      .join('\n')
      .replace(/^Negative prompt:\s*/i, '')
      .trim();
    result.provenance.negativePrompt = 'a1111_parameters';
  }
  if (stepsIdx !== -1) {
    const kvLine = lines.slice(stepsIdx).join(' ');
    const stepsMatch = kvLine.match(/Steps:\s*(\d+)/i);
    if (stepsMatch && result.steps === null) {
      result.steps = Number(stepsMatch[1]);
      result.provenance.steps = 'a1111_parameters';
    }
    const samplerMatch = kvLine.match(/Sampler:\s*([^,]+)/i);
    if (samplerMatch && result.sampler === null) {
      result.sampler = samplerMatch[1].trim();
      result.provenance.sampler = 'a1111_parameters';
    }
    const cfgMatch = kvLine.match(/CFG scale:\s*([\d.]+)/i);
    if (cfgMatch && result.cfg === null) {
      result.cfg = Number(cfgMatch[1]);
      result.provenance.cfg = 'a1111_parameters';
    }
    const seedMatch = kvLine.match(/Seed:\s*(\d+)/i);
    if (seedMatch && result.seed === null) {
      result.seed = seedMatch[1];
      result.provenance.seed = 'a1111_parameters';
    }
    const modelMatch = kvLine.match(/Model:\s*([^,]+)/i);
    if (modelMatch && result.checkpointName === null) {
      result.checkpointName = cleanModelBasename(modelMatch[1]);
      result.provenance.checkpoint = 'a1111_parameters';
    }
    const hashMatch = kvLine.match(/Model hash:\s*([a-fA-F0-9]+)/i);
    if (hashMatch && result.checkpointHash === null) {
      result.checkpointHash = hashMatch[1];
    }
  }
}
