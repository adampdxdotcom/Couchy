import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import http from 'http';
import { initTempDb, type TempDbContext } from './helpers/tempDb.ts';

let ctx: TempDbContext;
let readinessSvc: typeof import('../src/server/services/readinessService.ts');
let compilerSvc: typeof import('../src/server/services/workflowCompilerService.ts');
let appConfig: typeof import('../src/server/config.ts').appConfig;

let mockComfyServer: http.Server;
let mockComfyUrl = '';
let mockObjectInfoPayload: Record<string, any> = {};
let originalComfyUrl = '';

before(async () => {
  ctx = await initTempDb('couchy-readiness-test');
  ({ appConfig } = await import('../src/server/config.ts'));
  readinessSvc = await import('../src/server/services/readinessService.ts');
  compilerSvc = await import('../src/server/services/workflowCompilerService.ts');

  originalComfyUrl = appConfig.comfyuiUrl;

  mockComfyServer = http.createServer((req, res) => {
    if (req.url === '/object_info') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(mockObjectInfoPayload));
      return;
    }
    res.writeHead(404);
    res.end();
  });

  await new Promise<void>((resolve) => {
    mockComfyServer.listen(0, '127.0.0.1', () => {
      const addr = mockComfyServer.address();
      if (addr && typeof addr === 'object') {
        mockComfyUrl = `http://127.0.0.1:${addr.port}`;
      }
      resolve();
    });
  });

  appConfig.comfyuiUrl = mockComfyUrl;
});

after(async () => {
  if (appConfig) {
    appConfig.comfyuiUrl = originalComfyUrl;
  }
  await new Promise<void>((resolve) => mockComfyServer?.close(() => resolve()));
  ctx?.cleanup();
});

describe('readinessService & cleaned primary_workflow.json', () => {
  it('seeds primary_workflow.json without personal LoRA or baked-in UNET and detects first-run setup needed', async () => {
    const wfRow = ctx.db
      .prepare('SELECT id, api_workflow_json FROM workflows ORDER BY is_default DESC, id ASC LIMIT 1')
      .get() as { id: number; api_workflow_json: string };

    const graph = compilerSvc.getExecutableApiGraph(wfRow)!;
    assert.equal(graph['30_10'].inputs.unet_name, '');
    assert.equal(graph['50'].inputs.lora_1, undefined);
    assert.equal(graph['30_23'].inputs.value, false);
    assert.equal(graph['30_27'].inputs.string_b, '');

    mockObjectInfoPayload = {
      'Power Lora Loader (rgthree)': {},
      ResolutionSelector: {},
      ComfySwitchNode: {},
      TextGenerate: {},
      UNETLoader: { input: { required: { unet_name: [['krea2_fp8.safetensors']] } } },
      CLIPLoader: { input: { required: { clip_name: [['qwen3vl_4b_fp8_scaled.safetensors']] } } },
      VAELoader: { input: { required: { vae_name: [['qwen_image_vae.safetensors']] } } },
      UpscaleModelLoader: { input: { required: { model_name: [['4x-ESRGAN.pth']] } } },
    };

    const initial = await readinessSvc.getGenerationReadiness();
    assert.equal(initial.comfyuiOnline, true);
    assert.equal(initial.defaultUnetName, '');
    assert.equal(initial.needsAttention, true);
    assert.deepEqual(initial.availableUnets, ['krea2_fp8.safetensors']);

    // Selecting a default UNET clears needsAttention when all required nodes/weights are present
    const updated = await readinessSvc.setDefaultWorkflowUnet('krea2_fp8.safetensors');
    assert.equal(updated.defaultUnetName, 'krea2_fp8.safetensors');
    assert.equal(updated.ready, true);
    assert.equal(updated.needsAttention, false);
  });

  it('flags missing rgthree custom node even when default UNET is configured', async () => {
    mockObjectInfoPayload = {
      ResolutionSelector: {},
      ComfySwitchNode: {},
      TextGenerate: {},
      UNETLoader: { input: { required: { unet_name: [['krea2_fp8.safetensors']] } } },
      CLIPLoader: { input: { required: { clip_name: [['qwen3vl_4b_fp8_scaled.safetensors']] } } },
      VAELoader: { input: { required: { vae_name: [['qwen_image_vae.safetensors']] } } },
      UpscaleModelLoader: { input: { required: { model_name: [['4x-ESRGAN.pth']] } } },
    };

    const res = await readinessSvc.getGenerationReadiness();
    assert.equal(res.ready, false);
    assert.equal(res.needsAttention, true);
    const nodesCheck = res.checks.find((c) => c.id === 'nodes');
    assert.equal(nodesCheck?.ok, false);
    assert.ok(nodesCheck?.detail.includes('Power Lora Loader (rgthree)'));
  });
});
