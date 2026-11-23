import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import http from 'http';
import { initTempDb, type TempDbContext } from './helpers/tempDb.ts';

let ctx: TempDbContext;
let server: http.Server;
let baseUrl = '';
let db: typeof import('../src/server/db.ts').db;
let applyCivitaiEnrichmentToModel: typeof import('../src/server/services/civitai/civitaiModelEnrichmentService.ts').applyCivitaiEnrichmentToModel;

before(async () => {
  ctx = await initTempDb('couchy-model-local-rename-test');
  ({ db } = await import('../src/server/db.ts'));
  ({ applyCivitaiEnrichmentToModel } = await import(
    '../src/server/services/civitai/civitaiModelEnrichmentService.ts'
  ));
  const { lorasRouter } = await import('../src/server/routes/lorasRoutes.ts');
  const { modelsRouter } = await import('../src/server/routes/modelsRoutes.ts');

  const app = express();
  app.use(express.json());
  app.use('/api', lorasRouter);
  app.use('/api', modelsRouter);

  await new Promise<void>((resolve) => {
    server = app.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      if (addr && typeof addr === 'object') {
        baseUrl = `http://127.0.0.1:${addr.port}`;
      }
      resolve();
    });
  });
});

after(async () => {
  await new Promise<void>((resolve) => server?.close(() => resolve()));
  ctx?.cleanup();
});

describe('Local display-name renaming for LoRAs, Base Models, and Support Models', () => {
  it('renames an existing LoRA locally while preserving its filename and Civitai resilience', async () => {
    const info = db
      .prepare(
        `INSERT INTO models (name, filename, model_type, is_installed)
         VALUES ('orig_lora_v1', 'orig_lora_v1.safetensors', 'lora', 1)`
      )
      .run();
    const modelId = Number(info.lastInsertRowid);

    const res = await fetch(`${baseUrl}/api/loras/mention-config`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        loraName: 'orig_lora_v1.safetensors',
        name: '  Custom LoRA Display Name  ',
      }),
    });
    assert.equal(res.status, 200);
    const body = (await res.json()) as { ok: boolean; items: any[] };
    assert.equal(body.ok, true);

    const item = body.items.find((i) => i.filename === 'orig_lora_v1.safetensors');
    assert.equal(item?.name, 'Custom LoRA Display Name');
    assert.equal(item?.filename, 'orig_lora_v1.safetensors');

    // Civitai enrichment updates must preserve the locally customized display name
    applyCivitaiEnrichmentToModel(
      modelId,
      {
        civitaiId: '12345',
        civitaiVersionId: '67890',
        civitaiUrl: 'https://civitai.com/models/12345?modelVersionId=67890',
        baseModel: 'Flux.1 D',
        trainedWords: ['trigger_tok'],
        recommendedWeight: 0.8,
        civitaiDescription: 'Upstream description',
        previewImages: [],
      },
      []
    );

    const rowAfter = db
      .prepare('SELECT name, filename FROM models WHERE id = ?')
      .get(modelId) as { name: string; filename: string };
    assert.equal(rowAfter.name, 'Custom LoRA Display Name');
    assert.equal(rowAfter.filename, 'orig_lora_v1.safetensors');
  });

  it('upserts and renames a LoRA that only existed via filename reference', async () => {
    const res = await fetch(`${baseUrl}/api/loras/mention-config`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        loraName: 'historical_only_lora.safetensors',
        name: 'Friendly Historical LoRA',
      }),
    });
    assert.equal(res.status, 200);

    const row = db
      .prepare('SELECT name, filename, model_type FROM models WHERE LOWER(filename) = LOWER(?)')
      .get('historical_only_lora.safetensors') as
      | { name: string; filename: string; model_type: string }
      | undefined;
    assert.equal(row?.name, 'Friendly Historical LoRA');
    assert.equal(row?.filename, 'historical_only_lora.safetensors');
    assert.equal(row?.model_type, 'lora');
  });

  it('renames Base Models and Support Models locally without touching filename', async () => {
    const baseInfo = db
      .prepare(
        `INSERT INTO models (name, filename, model_type, is_installed)
         VALUES ('flux1-dev-fp8', 'flux1-dev-fp8.safetensors', 'diffusion', 1)`
      )
      .run();
    const clipInfo = db
      .prepare(
        `INSERT INTO models (name, filename, model_type, is_installed)
         VALUES ('t5xxl_fp8_e4m3fn', 't5xxl_fp8_e4m3fn.safetensors', 'clip', 1)`
      )
      .run();

    const baseId = Number(baseInfo.lastInsertRowid);
    const clipId = Number(clipInfo.lastInsertRowid);

    const baseRes = await fetch(`${baseUrl}/api/models/${baseId}/config`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Flux Dev FP8 (Main)' }),
    });
    assert.equal(baseRes.status, 200);

    const clipRes = await fetch(`${baseUrl}/api/models/${clipId}/config`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'T5-XXL FP8 Encoder' }),
    });
    assert.equal(clipRes.status, 200);

    const clipBody = (await clipRes.json()) as { ok: boolean; items: any[] };
    const updatedBase = clipBody.items.find((m) => m.id === baseId);
    const updatedClip = clipBody.items.find((m) => m.id === clipId);

    assert.equal(updatedBase?.name, 'Flux Dev FP8 (Main)');
    assert.equal(updatedBase?.filename, 'flux1-dev-fp8.safetensors');
    assert.equal(updatedClip?.name, 'T5-XXL FP8 Encoder');
    assert.equal(updatedClip?.filename, 't5xxl_fp8_e4m3fn.safetensors');
  });

  it('rejects empty display names with HTTP 400 and preserves existing names', async () => {
    const info = db
      .prepare(
        `INSERT INTO models (name, filename, model_type, is_installed)
         VALUES ('Keep Me', 'keep_me.safetensors', 'vae', 1)`
      )
      .run();
    const vaeId = Number(info.lastInsertRowid);

    const badModelRes = await fetch(`${baseUrl}/api/models/${vaeId}/config`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: '   ' }),
    });
    assert.equal(badModelRes.status, 400);

    const badLoraRes = await fetch(`${baseUrl}/api/loras/mention-config`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        loraName: 'orig_lora_v1.safetensors',
        name: '',
      }),
    });
    assert.equal(badLoraRes.status, 400);

    const vaeRow = db.prepare('SELECT name FROM models WHERE id = ?').get(vaeId) as { name: string };
    assert.equal(vaeRow.name, 'Keep Me');
  });
});
