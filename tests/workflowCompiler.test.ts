import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { initTempDb, type TempDbContext } from './helpers/tempDb.ts';

let ctx: TempDbContext;
let compiler: typeof import('../src/server/services/workflowCompilerService.ts');

before(async () => {
  ctx = await initTempDb('couchy-wf-test');
  compiler = await import('../src/server/services/workflowCompilerService.ts');
});

after(() => {
  ctx?.cleanup();
});

describe('workflowCompilerService', () => {
  it('computes 64px-aligned dimensions from aspect ratio and megapixels', () => {
    const dims = compiler.computeDimensionsFromMegapixels('2:3 (Portrait Photo)', 2.0);
    assert.equal(dims.width % 64, 0);
    assert.equal(dims.height % 64, 0);
    assert.ok(dims.height > dims.width);
  });

  it('compiles default workflow with prompt, trigger, checkpoint path, deduped LoRAs, and upscale gating', () => {
    const wf = ctx.db
      .prepare('SELECT id FROM workflows ORDER BY is_default DESC, id ASC LIMIT 1')
      .get() as { id: number };
    assert.ok(wf?.id, 'default seeded workflow should exist');

    ctx.db
      .prepare(
        `INSERT INTO models (name, filename, model_type, comfyui_path, is_installed)
         VALUES (?, ?, ?, ?, 1)`
      )
      .run('Krea2 Custom', 'krea2_custom.safetensors', 'checkpoint', 'krea/krea2_custom.safetensors');
    ctx.db
      .prepare(
        `INSERT INTO models (name, filename, model_type, comfyui_path, is_installed)
         VALUES (?, ?, ?, ?, 1)`
      )
      .run('Heroine', 'heroine.safetensors', 'lora', 'chars/heroine.safetensors');

    const defaults = compiler.getWorkflowDefaults(wf.id);

    // Base generation <= 3.0 MP should keep inline upscale switch OFF and preserve default steps when omitted
    const baseGraph = compiler.compileWorkflowForGeneration({
      workflowId: wf.id,
      positivePrompt: 'warm sunset rooftop portrait',
      triggerWord: 'heroine_trigger, film_style',
      negativePrompt: '',
      seed: 123456,
      aspectRatio: '2:3 (Portrait Photo)',
      megapixels: 2.0,
      width: 1152,
      height: 1728,
      checkpointName: 'krea2_custom.safetensors',
      loras: [
        { loraName: 'heroine.safetensors', modelStrength: 0.9, clipStrength: 1.0 },
        { loraName: 'chars/heroine.safetensors', modelStrength: 0.5, clipStrength: 1.0 }, // duplicate basename
      ],
    });

    assert.equal(baseGraph['30_19'].inputs.value, 'warm sunset rooftop portrait');
    assert.equal(baseGraph['30_27'].inputs.string_b, 'heroine_trigger, film_style');
    assert.equal(baseGraph['30_10'].inputs.unet_name, 'krea/krea2_custom.safetensors');
    assert.equal(baseGraph['50'].inputs.lora_1.lora, 'chars/heroine.safetensors');
    assert.equal(baseGraph['50'].inputs.lora_1.strength, 0.9);
    assert.equal(baseGraph['50'].inputs.lora_2, undefined);
    assert.equal(baseGraph['30_23'].inputs.value, true);
    assert.equal(baseGraph['49'].inputs.megapixels, 2);
    assert.equal(baseGraph['51'].inputs.switch, false);
    if (defaults.defaultSteps) {
      assert.equal(baseGraph['30_3'].inputs.steps, defaults.defaultSteps);
    }

    // High-MP request (> 3.0 MP) should clamp Node #49 <= 3.0 and flip inline upscale switch ON
    const upscaledGraph = compiler.compileWorkflowForGeneration({
      workflowId: wf.id,
      positivePrompt: 'night neon alley',
      negativePrompt: '',
      seed: 777,
      aspectRatio: '16:9 (Landscape Wide)',
      megapixels: 5.5,
      steps: 14,
      width: 1920,
      height: 1088,
      loras: [],
    });

    assert.equal(upscaledGraph['49'].inputs.megapixels, 3);
    assert.equal(upscaledGraph['51'].inputs.switch, true);
    assert.equal(upscaledGraph['52'].inputs.megapixels, 5.5);
    assert.equal(upscaledGraph['30_3'].inputs.steps, 14);
    assert.equal(upscaledGraph['30_23'].inputs.value, false);
  });
});
