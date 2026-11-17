import path from 'path';
import type { ComfyModelSubfolder, ModelType } from '../../shared/types.ts';

export const DOWNLOAD_WEIGHT_EXTS = new Set([
  '.safetensors',
  '.gguf',
  '.ckpt',
  '.pt',
  '.pth',
  '.bin',
  '.sft',
]);

export const SUBFOLDER_TO_MODEL_TYPE: Record<ComfyModelSubfolder, ModelType> = {
  loras: 'lora',
  checkpoints: 'checkpoint',
  diffusion_models: 'diffusion',
  unet: 'diffusion',
  text_encoders: 'clip',
  clip: 'clip',
  vae: 'vae',
  controlnet: 'controlnet',
  upscale_models: 'upscaler',
  embeddings: 'embedding',
};

export const MODEL_TYPE_TO_DEFAULT_SUBFOLDER: Record<ModelType, ComfyModelSubfolder> = {
  lora: 'loras',
  checkpoint: 'checkpoints',
  diffusion: 'diffusion_models',
  clip: 'text_encoders',
  vae: 'vae',
  controlnet: 'controlnet',
  upscaler: 'upscale_models',
  embedding: 'embeddings',
  other: 'checkpoints',
};

/**
 * Infers the ComfyUI subfolder and ModelType from a relative repository path, filename, or tags.
 */
export function inferSubfolderAndTypeFromPath(
  rfilename: string,
  repoTags: string[] = [],
  explicitCivitaiType?: string,
  baseModel?: string | null
): { suggestedSubfolder: ComfyModelSubfolder; modelType: ModelType; subfolderHint?: string | null } {
  const lowerPath = rfilename.toLowerCase().replace(/\\/g, '/');
  const filename = path.basename(lowerPath);
  const ext = path.extname(filename);
  const tagsLower = repoTags.map((t) => t.toLowerCase());

  // 1. Check explicit Civitai type if provided
  if (explicitCivitaiType) {
    const cType = explicitCivitaiType.toLowerCase();
    if (cType === 'lora' || cType === 'locon' || cType === 'dora') {
      return { suggestedSubfolder: 'loras', modelType: 'lora' };
    }
    if (cType === 'vae') {
      return { suggestedSubfolder: 'vae', modelType: 'vae' };
    }
    if (cType === 'controlnet') {
      return { suggestedSubfolder: 'controlnet', modelType: 'controlnet' };
    }
    if (cType === 'upscaler') {
      return { suggestedSubfolder: 'upscale_models', modelType: 'upscaler' };
    }
    if (cType === 'textualinversion' || cType === 'embedding') {
      return { suggestedSubfolder: 'embeddings', modelType: 'embedding' };
    }
    if (cType === 'checkpoint') {
      const bm = (baseModel || '').toLowerCase();
      const isModernDiT =
        bm.includes('flux') ||
        bm.includes('wan') ||
        bm.includes('qwen') ||
        bm.includes('chroma') ||
        bm.includes('hidream') ||
        bm.includes('hunyuan') ||
        ext === '.gguf';
      const looksLikeAio = /aio|all[-_ ]?in[-_ ]?one|checkpoint|ckpt/i.test(filename);
      if (ext === '.gguf' || (isModernDiT && !looksLikeAio)) {
        return {
          suggestedSubfolder: 'diffusion_models',
          modelType: 'diffusion',
          subfolderHint:
            'Modern DiT / GGUF base models usually load via UNETLoader (diffusion_models) unless bundled as an All-in-One checkpoint.',
        };
      }
      return { suggestedSubfolder: 'checkpoints', modelType: 'checkpoint' };
    }
  }

  // 2. Check folder segments or filename patterns
  if (
    lowerPath.includes('text_encoders/') ||
    lowerPath.includes('/clip/') ||
    /(^|[_/-])(clip_l|clip_g|t5xxl|umt5|llava|qwen_2\.5|text_encoder)/i.test(filename)
  ) {
    return { suggestedSubfolder: 'text_encoders', modelType: 'clip' };
  }

  if (
    lowerPath.includes('vae/') ||
    /(^|[_/-])(vae|ae\.safetensors|sdxl_vae|flux_vae)/i.test(lowerPath)
  ) {
    return { suggestedSubfolder: 'vae', modelType: 'vae' };
  }

  if (
    lowerPath.includes('controlnet/') ||
    lowerPath.includes('control_net') ||
    tagsLower.includes('controlnet') ||
    /controlnet|ip-adapter|ipadapter|t2i-adapter/i.test(lowerPath)
  ) {
    return { suggestedSubfolder: 'controlnet', modelType: 'controlnet' };
  }

  if (
    lowerPath.includes('upscale') ||
    /esrgan|ultrasharp|remacri|4x[-_]|2x[-_]|swinir/i.test(lowerPath)
  ) {
    return { suggestedSubfolder: 'upscale_models', modelType: 'upscaler' };
  }

  if (lowerPath.includes('embeddings/') || lowerPath.includes('textual_inversion')) {
    return { suggestedSubfolder: 'embeddings', modelType: 'embedding' };
  }

  if (
    lowerPath.includes('loras/') ||
    lowerPath.includes('/lora/') ||
    tagsLower.includes('lora') ||
    /(^|[_/-])lora([_.-]|$)/i.test(filename)
  ) {
    return { suggestedSubfolder: 'loras', modelType: 'lora' };
  }

  if (
    lowerPath.includes('diffusion_models/') ||
    lowerPath.includes('unet/') ||
    ext === '.gguf' ||
    /(^|[_/-])(flux1|wan2|qwen_image|chroma|hidream|z_image|unet)/i.test(filename)
  ) {
    return { suggestedSubfolder: 'diffusion_models', modelType: 'diffusion' };
  }

  return { suggestedSubfolder: 'checkpoints', modelType: 'checkpoint' };
}
