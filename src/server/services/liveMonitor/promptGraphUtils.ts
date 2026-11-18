export interface QueuePromptMeta {
  prompt: string;
  width: number;
  height: number;
  checkpointName: string | null;
  loraCount: number;
  loraNames: string[];
  firstSeenMs: number;
}

/**
 * Extracts a ComfyUI prompt_id from a `/queue` array tuple or object entry.
 */
export function extractPromptId(entry: any): string | null {
  if (Array.isArray(entry) && typeof entry[1] === 'string') {
    return entry[1];
  }
  if (entry && typeof entry === 'object' && typeof entry.prompt_id === 'string') {
    return entry.prompt_id;
  }
  return null;
}

/**
 * Normalizes SQLite `YYYY-MM-DD HH:MM:SS` UTC timestamps into ISO-8601 strings.
 */
export function toIsoUtc(raw: string | null | undefined): string {
  const s = (raw || '').trim();
  if (!s) return new Date().toISOString();
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/.test(s)) {
    return `${s.replace(' ', 'T')}Z`;
  }
  return s;
}

/**
 * Safely parses a JSON string array of LoRA filenames, returning undefined when empty/invalid.
 */
export function parseLoraNamesJson(rawJson: string | null | undefined): string[] | undefined {
  if (!rawJson) return undefined;
  try {
    const parsed = JSON.parse(rawJson);
    if (Array.isArray(parsed) && parsed.length > 0) {
      const cleaned = parsed.map((n) => String(n || '').trim()).filter(Boolean);
      return cleaned.length > 0 ? cleaned : undefined;
    }
  } catch {
    // ignore malformed JSON
  }
  return undefined;
}

/**
 * Extracts prompt text, dimensions, checkpoint/model name, and LoRA stack from a ComfyUI API prompt graph.
 */
export function extractMetadataFromPromptGraph(graph: any): Omit<QueuePromptMeta, 'firstSeenMs'> {
  let prompt = '';
  let width = 1024;
  let height = 1536;
  let checkpointName: string | null = null;
  let loraCount = 0;
  const loraNames: string[] = [];

  if (graph && typeof graph === 'object' && !Array.isArray(graph)) {
    for (const node of Object.values(graph) as any[]) {
      if (!node || typeof node !== 'object') continue;
      const ct = String(node.class_type || '');
      const ctLower = ct.toLowerCase();
      const inputs = node.inputs || {};

      // Extract dimensions
      if (typeof inputs.width === 'number' && inputs.width >= 64) {
        width = Math.round(inputs.width);
      }
      if (typeof inputs.height === 'number' && inputs.height >= 64) {
        height = Math.round(inputs.height);
      }

      // Extract checkpoint / diffusion model
      for (const ckptKey of ['ckpt_name', 'unet_name', 'model_name', 'diffusion_model']) {
        if (!checkpointName && typeof inputs[ckptKey] === 'string' && inputs[ckptKey].trim()) {
          checkpointName =
            inputs[ckptKey].trim().replace(/\\/g, '/').split('/').pop() || inputs[ckptKey].trim();
        }
      }

      // Count active LoRAs and record filenames
      if (ctLower.includes('lora')) {
        if (typeof inputs.lora_name === 'string' && inputs.lora_name !== 'None' && inputs.lora_name.trim()) {
          loraCount++;
          loraNames.push(inputs.lora_name.trim());
        }
        for (const [k, v] of Object.entries(inputs)) {
          if (k.startsWith('lora_') && v && typeof v === 'object' && (v as any).on && (v as any).lora) {
            loraCount++;
            loraNames.push(String((v as any).lora).trim());
          }
        }
      }

      // Extract positive prompt candidate (prefer longest non-negative string)
      const titleLower = String(node._meta?.title || '').toLowerCase();
      if (!titleLower.includes('negative')) {
        for (const textKey of ['text', 'value', 'prompt', 'positive', 'string', 'text_g']) {
          const val = inputs[textKey];
          if (typeof val === 'string' && val.trim().length > prompt.length) {
            prompt = val.trim();
          }
        }
      }
    }
  }

  return { prompt, width, height, checkpointName, loraCount, loraNames };
}
