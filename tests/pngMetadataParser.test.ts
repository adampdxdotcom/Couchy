import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseImageMetadataFromChunks } from '../src/server/services/pngMetadataParser.ts';

describe('pngMetadataParser', () => {
  it('parses ComfyUI API prompt chunk with UNET, Power Lora Loader, KSampler, and prompts', () => {
    const apiGraph = {
      '30_10': {
        class_type: 'UNETLoader',
        inputs: { unet_name: 'krea2_turbo_bf16.safetensors' },
      },
      '30_19': {
        class_type: 'PrimitiveStringMultiline',
        inputs: { value: 'editorial street portrait in golden evening light' },
        _meta: { title: 'User Prompt' },
      },
      '30_3': {
        class_type: 'KSampler',
        inputs: {
          seed: 987654321,
          steps: 10,
          cfg: 1.5,
          sampler_name: 'euler',
          scheduler: 'simple',
          denoise: 1.0,
        },
      },
      '50': {
        class_type: 'Power Lora Loader (rgthree)',
        inputs: {
          lora_1: { on: true, lora: 'characters/heroine_v2.safetensors', strength: 0.85 },
          lora_2: { on: false, lora: 'styles/disabled_style.safetensors', strength: 0.7 },
          lora_3: { on: true, lora: 'styles/film_grain.safetensors', strength: 0.6 },
        },
      },
    };

    const parsed = parseImageMetadataFromChunks({
      prompt: JSON.stringify(apiGraph),
    });

    assert.equal(parsed.checkpointName, 'krea2_turbo_bf16.safetensors');
    assert.equal(parsed.positivePrompt, 'editorial street portrait in golden evening light');
    assert.equal(parsed.seed, '987654321');
    assert.equal(parsed.steps, 10);
    assert.equal(parsed.cfg, 1.5);
    assert.equal(parsed.sampler, 'euler');
    assert.equal(parsed.scheduler, 'simple');
    assert.equal(parsed.loras.length, 2);
    assert.deepEqual(
      parsed.loras.map((l) => ({ name: l.loraName, strength: l.modelStrength })),
      [
        { name: 'heroine_v2.safetensors', strength: 0.85 },
        { name: 'film_grain.safetensors', strength: 0.6 },
      ]
    );
    assert.deepEqual(parsed.missingFields, []);
  });

  it('parses A1111 parameters text chunks cleanly', () => {
    const paramsText = [
      'candid cafe portrait, warm window light <lora:soft_film:0.75>',
      'Negative prompt: blurry, deformed',
      'Steps: 28, Sampler: DPM++ 2M, Schedule type: Karras, CFG scale: 5.5, Seed: 424242, Model: realism_xl_v4',
    ].join('\n');

    const parsed = parseImageMetadataFromChunks({ parameters: paramsText });

    assert.equal(parsed.positivePrompt, 'candid cafe portrait, warm window light <lora:soft_film:0.75>');
    assert.equal(parsed.negativePrompt, 'blurry, deformed');
    assert.equal(parsed.steps, 28);
    assert.equal(parsed.cfg, 5.5);
    assert.equal(parsed.seed, '424242');
    assert.equal(parsed.sampler, 'DPM++ 2M');
    assert.equal(parsed.checkpointName, 'realism_xl_v4');
  });

  it('handles malformed or empty chunks gracefully without throwing', () => {
    const parsed = parseImageMetadataFromChunks({
      prompt: '{not-valid-json',
      workflow: '[]',
    });

    assert.equal(parsed.checkpointName, null);
    assert.equal(parsed.positivePrompt, null);
    assert.deepEqual(parsed.loras, []);
    assert.ok(parsed.missingFields.includes('positive_prompt'));
    assert.ok(parsed.missingFields.includes('checkpoint'));
  });
});
