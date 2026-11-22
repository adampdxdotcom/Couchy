import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { initTempDb, type TempDbContext } from './helpers/tempDb.ts';

let ctx: TempDbContext;
let tempImagesDir = '';
let server: http.Server;
let baseUrl = '';

let appConfig: typeof import('../src/server/config.ts').appConfig;
let evaluateCivitaiShareEligibility: typeof import('../src/server/services/civitai/civitaiShareEligibility.ts').evaluateCivitaiShareEligibility;
let shareImageAsCivitaiDraft: typeof import('../src/server/services/civitai/civitaiDraftShareService.ts').shareImageAsCivitaiDraft;
let CivitaiShareValidationError: typeof import('../src/server/services/civitai/civitaiDraftShareService.ts').CivitaiShareValidationError;
let CivitaiPayloadTooLargeError: typeof import('../src/server/services/civitai/civitaiMcpClient.ts').CivitaiPayloadTooLargeError;
let configureScheduledBackups: typeof import('../src/server/services/backupService.ts').configureScheduledBackups;

const origConfig = {
  comfyuiOutputDir: '',
  civitaiApiKey: '',
};

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let j = 0; j < 8; j++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
  }
  return (c ^ 0xffffffff) >>> 0;
}

function buildPngWithTextChunks(basePng: Buffer, chunks: Record<string, string>): Buffer {
  // Insert tEXt chunks right before the final 12-byte IEND chunk
  const iendOffset = basePng.lastIndexOf(Buffer.from('IEND'));
  assert.ok(iendOffset > 4, 'Expected valid PNG with IEND');
  const head = basePng.subarray(0, iendOffset - 4);
  const tail = basePng.subarray(iendOffset - 4);

  const inserted: Buffer[] = [];
  for (const [key, value] of Object.entries(chunks)) {
    const data = Buffer.concat([Buffer.from(key, 'latin1'), Buffer.from([0]), Buffer.from(value, 'latin1')]);
    const typeAndData = Buffer.concat([Buffer.from('tEXt', 'ascii'), data]);
    const lenBuf = Buffer.alloc(4);
    lenBuf.writeUInt32BE(data.length, 0);
    const crcBuf = Buffer.alloc(4);
    crcBuf.writeUInt32BE(crc32(typeAndData), 0);
    inserted.push(lenBuf, typeAndData, crcBuf);
  }
  return Buffer.concat([head, ...inserted, tail]);
}

async function writeTestPng(filename: string, textChunks?: Record<string, string>): Promise<string> {
  const basePng = await sharp({
    create: { width: 64, height: 64, channels: 3, background: { r: 30, g: 40, b: 60 } },
  })
    .png()
    .toBuffer();

  const outBuf = textChunks ? buildPngWithTextChunks(basePng, textChunks) : basePng;
  const fullPath = path.join(tempImagesDir, filename);
  fs.writeFileSync(fullPath, outBuf);
  return fullPath;
}

function insertImageRow(params: {
  filename: string;
  contentHash: string;
  prompt?: string;
  checkpoint?: string;
}): number {
  const info = ctx.db
    .prepare(
      `INSERT INTO images
        (relative_path, filename, content_hash, file_size, file_mtime, width, height, format, is_missing, is_uploaded_reference)
       VALUES (?, ?, ?, 4096, datetime('now'), 64, 64, 'png', 0, 0)`
    )
    .run(params.filename, params.filename, params.contentHash);
  const imageId = Number(info.lastInsertRowid);

  ctx.db
    .prepare(
      `INSERT INTO image_metadata
        (image_id, positive_prompt, negative_prompt, seed, steps, cfg, sampler, scheduler, checkpoint_name)
       VALUES (?, ?, 'blurry', '12345', 10, 1.5, 'euler', 'simple', ?)`
    )
    .run(
      imageId,
      params.prompt ?? 'editorial portrait in warm light',
      params.checkpoint ?? 'krea2_turbo.safetensors'
    );

  return imageId;
}

before(async () => {
  ctx = await initTempDb('couchy-civitai-draft-test');
  tempImagesDir = fs.mkdtempSync(path.join(os.tmpdir(), 'couchy-civitai-imgs-'));

  ({ appConfig } = await import('../src/server/config.ts'));
  ({ evaluateCivitaiShareEligibility } = await import(
    '../src/server/services/civitai/civitaiShareEligibility.ts'
  ));
  ({ shareImageAsCivitaiDraft, CivitaiShareValidationError } = await import(
    '../src/server/services/civitai/civitaiDraftShareService.ts'
  ));
  ({ CivitaiPayloadTooLargeError } = await import(
    '../src/server/services/civitai/civitaiMcpClient.ts'
  ));
  ({ configureScheduledBackups } = await import('../src/server/services/backupService.ts'));

  const { charactersRouter } = await import('../src/server/routes/charactersRoutes.ts');
  const { systemRouter } = await import('../src/server/routes/systemRoutes.ts');

  origConfig.comfyuiOutputDir = appConfig.comfyuiOutputDir;
  origConfig.civitaiApiKey = appConfig.civitaiApiKey;

  appConfig.comfyuiOutputDir = tempImagesDir;
  appConfig.civitaiApiKey = 'test-civitai-api-key';

  const app = express();
  app.use(express.json());
  app.use('/api/characters', charactersRouter);
  app.use('/api', systemRouter);

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
  configureScheduledBackups(0);
  if (appConfig) {
    appConfig.comfyuiOutputDir = origConfig.comfyuiOutputDir;
    appConfig.civitaiApiKey = origConfig.civitaiApiKey;
  }
  await new Promise<void>((resolve) => server?.close(() => resolve()));
  if (tempImagesDir) {
    fs.rmSync(tempImagesDir, { recursive: true, force: true });
  }
  ctx?.cleanup();
});

describe('Civitai Draft Post System', () => {
  it('allows inline Krea 2 + 4x-ESRGAN PNGs and blocks standalone upscales even with inherited SQLite metadata', async () => {
    await writeTestPng('inline_upscaled.png', {
      prompt: JSON.stringify({
        '10': { class_type: 'UNETLoader', inputs: { unet_name: 'krea2.safetensors' } },
        '20': { class_type: 'KSampler', inputs: { seed: 42, steps: 8, cfg: 1.0 } },
        '30': { class_type: 'UpscaleModelLoader', inputs: { model_name: '4x-ESRGAN.pth' } },
        '31': { class_type: 'ImageUpscaleWithModel', inputs: {} },
      }),
    });

    await writeTestPng('standalone_upscale.png', {
      prompt: JSON.stringify({
        '1': { class_type: 'LoadImage', inputs: { image: 'inline_upscaled.png' } },
        '2': { class_type: 'UpscaleModelLoader', inputs: { model_name: '4x-ESRGAN.pth' } },
        '3': { class_type: 'ImageUpscaleWithModel', inputs: {} },
      }),
    });

    const origId = insertImageRow({
      filename: 'inline_upscaled.png',
      contentHash: 'hash_inline_1',
    });
    const upscaleId = insertImageRow({
      filename: 'standalone_upscale.png',
      contentHash: 'hash_standalone_1',
    });

    // Link both in an iteration series
    const seriesId = Number(
      ctx.db
        .prepare(`INSERT INTO image_series (poster_image_id) VALUES (?)`)
        .run(origId).lastInsertRowid
    );
    ctx.db
      .prepare(`INSERT INTO image_series_items (series_id, image_id, step_order) VALUES (?, ?, 0), (?, ?, 1)`)
      .run(seriesId, origId, seriesId, upscaleId);

    // Enable 0-character sharing via PATCH /api/config so metadata check is isolated
    const cfgRes = await fetch(`${baseUrl}/api/config`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ allowCivitaiShareUncharacterized: true }),
    });
    assert.equal(cfgRes.status, 200);
    const cfgBody = await cfgRes.json();
    assert.equal(cfgBody.config.allowCivitaiShareUncharacterized, true);

    const inlineCheck = await evaluateCivitaiShareEligibility(origId);
    assert.equal(inlineCheck.eligible, true);
    assert.equal(inlineCheck.hasNativeMetadata, true);
    assert.equal(inlineCheck.isStandaloneUpscale, false);

    const upscaleCheck = await evaluateCivitaiShareEligibility(upscaleId);
    assert.equal(upscaleCheck.eligible, false);
    assert.equal(upscaleCheck.hasNativeMetadata, false);
    assert.equal(upscaleCheck.isStandaloneUpscale, true);
    assert.equal(upscaleCheck.sourceOriginalImageId, origId);
  });

  it('enforces confirmed + suggested character permissions, multi-character unanimity, and 0-character setting', async () => {
    await writeTestPng('char_test.png', {
      parameters: 'portrait of aria\nSteps: 20, Sampler: Euler, CFG scale: 5, Seed: 77',
    });
    const imgId = insertImageRow({
      filename: 'char_test.png',
      contentHash: 'hash_char_gate_1',
    });

    // Create two characters (both default allow_civitai_share = 0)
    const charARes = await fetch(`${baseUrl}/api/characters`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Aria', description: 'Lead hero' }),
    });
    const charA = (await charARes.json()).character;
    assert.equal(charA.allowCivitaiShare, false);

    const charBRes = await fetch(`${baseUrl}/api/characters`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Bryn', notes: 'Keep notes intact' }),
    });
    const charB = (await charBRes.json()).character;

    // Link Aria (confirmed) and Bryn (suggested)
    ctx.db
      .prepare(
        `INSERT INTO image_characters (image_id, image_content_hash, character_id, status, source, confidence)
         VALUES (?, 'hash_char_gate_1', ?, 'confirmed', 'manual', 1.0),
                (?, 'hash_char_gate_1', ?, 'suggested', 'lora', 0.85)`
      )
      .run(imgId, charA.id, imgId, charB.id);

    // Enable Aria only -> still blocked because Bryn (suggested) is disabled
    const patchARes = await fetch(`${baseUrl}/api/characters/${charA.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ allowCivitaiShare: true }),
    });
    assert.equal(patchARes.status, 200);
    const updatedA = (await patchARes.json()).character;
    assert.equal(updatedA.allowCivitaiShare, true);
    assert.equal(updatedA.description, 'Lead hero');

    const partialCheck = await evaluateCivitaiShareEligibility(imgId);
    assert.equal(partialCheck.eligible, false);
    assert.ok(partialCheck.reasons.some((r) => r.includes('Bryn (suggested)')));

    // Enable Bryn too -> now eligible, and Bryn's notes stayed intact
    const patchBRes = await fetch(`${baseUrl}/api/characters/${charB.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ allowCivitaiShare: true }),
    });
    const updatedB = (await patchBRes.json()).character;
    assert.equal(updatedB.allowCivitaiShare, true);
    assert.equal(updatedB.notes, 'Keep notes intact');

    const fullCheck = await evaluateCivitaiShareEligibility(imgId);
    assert.equal(fullCheck.eligible, true);
    assert.equal(fullCheck.linkedCharacters.length, 2);

    // Verify 0-character setting defaults off / blocks when disabled
    await fetch(`${baseUrl}/api/config`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ allowCivitaiShareUncharacterized: false }),
    });
    await writeTestPng('unchar_test.png', {
      parameters: 'landscape\nSteps: 12, Sampler: Euler, CFG scale: 3, Seed: 11',
    });
    const uncharId = insertImageRow({
      filename: 'unchar_test.png',
      contentHash: 'hash_unchar_1',
    });
    const uncharBlocked = await evaluateCivitaiShareEligibility(uncharId);
    assert.equal(uncharBlocked.eligible, false);
    assert.ok(uncharBlocked.reasons.some((r) => r.includes('0-character')));
  });

  it('submits PNG-first draft with publish=false, handles 413 fallback to JPEG+EXIF, and logs SQLite draft rows', async () => {
    await writeTestPng('draft_flow.png', {
      parameters: 'moonlit forest shrine\nSteps: 16, Sampler: Euler, CFG scale: 4, Seed: 888',
    });
    const imgId = insertImageRow({
      filename: 'draft_flow.png',
      contentHash: 'hash_draft_flow_1',
      prompt: 'moonlit forest shrine',
      checkpoint: 'krea2_turbo.safetensors',
    });

    // Attach a LoRA + Civitai version ID and tag to verify prefill + primary model selection
    const modelId = Number(
      ctx.db
        .prepare(
          `INSERT INTO models (filename, name, model_type, lora_category, civitai_id, civitai_version_id)
           VALUES ('heroine_lora.safetensors', 'Heroine LoRA', 'lora', 'character', '9001', '775533')`
        )
        .run().lastInsertRowid
    );
    ctx.db
      .prepare(`INSERT INTO image_loras (image_id, lora_name, model_id, model_strength, clip_strength) VALUES (?, 'heroine_lora.safetensors', ?, 0.85, 0.85)`)
      .run(imgId, modelId);

    const tagId = Number(
      ctx.db.prepare(`INSERT INTO tags (name) VALUES ('scenic')`).run().lastInsertRowid
    );
    ctx.db
      .prepare(`INSERT INTO image_tags (image_id, image_content_hash, tag_id) VALUES (?, 'hash_draft_flow_1', ?)`)
      .run(imgId, tagId);

    // Ensure 0-char is OFF -> must throw CivitaiShareValidationError before any fetch
    await fetch(`${baseUrl}/api/config`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ allowCivitaiShareUncharacterized: false }),
    });
    let networkCalled = false;
    await assert.rejects(
      () =>
        shareImageAsCivitaiDraft(imgId, {}, {
          fetchFn: async () => {
            networkCalled = true;
            throw new Error('Should not have been called');
          },
        }),
      (err: unknown) => err instanceof CivitaiShareValidationError
    );
    assert.equal(networkCalled, false);

    // Enable 0-char sharing
    await fetch(`${baseUrl}/api/config`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ allowCivitaiShareUncharacterized: true }),
    });

    const pre = await evaluateCivitaiShareEligibility(imgId);
    assert.equal(pre.eligible, true);
    assert.equal(pre.recommendedModelVersionId, 775533);
    assert.deepEqual(pre.prefilledTags, ['scenic']);

    const capturedCalls: Array<{ method: string; tool?: string; args?: any }> = [];
    const buildMockFetch = (rejectPngUploadWith413: boolean): typeof fetch => {
      return async (_url, init) => {
        const body = JSON.parse(String(init?.body || '{}'));
        const toolName = body?.params?.name;
        const toolArgs = body?.params?.arguments;
        capturedCalls.push({ method: body.method, tool: toolName, args: toolArgs });

        if (body.method === 'initialize') {
          return new Response(JSON.stringify({ jsonrpc: '2.0', id: body.id, result: { protocolVersion: '2025-03-26' } }), {
            status: 200,
            headers: { 'mcp-session-id': 'mock-sid-1' },
          });
        }
        if (body.method === 'notifications/initialized') {
          return new Response('', { status: 202 });
        }
        if (toolName === 'whoami') {
          return new Response(
            JSON.stringify({
              jsonrpc: '2.0',
              id: body.id,
              result: { structuredContent: { id: 1, isOnboarded: true, muted: false } },
            }),
            { status: 200 }
          );
        }
        if (toolName === 'upload_image') {
          if (rejectPngUploadWith413 && toolArgs?.contentType === 'image/png') {
            return new Response('Payload Too Large', { status: 413 });
          }
          return new Response(
            JSON.stringify({
              jsonrpc: '2.0',
              id: body.id,
              result: { structuredContent: { uuid: 'img-uuid-999', width: 64, height: 64 } },
            }),
            { status: 200 }
          );
        }
        if (toolName === 'create_post') {
          assert.equal(toolArgs.publish, false, 'create_post MUST hardcode publish: false');
          return new Response(
            JSON.stringify({
              jsonrpc: '2.0',
              id: body.id,
              result: {
                content: [{ type: 'text', text: JSON.stringify({ id: 554433, processingImageIds: [11] }) }],
              },
            }),
            { status: 200 }
          );
        }
        throw new Error(`Unexpected mock MCP call: ${body.method} / ${toolName}`);
      };
    };

    // 1. Original PNG path succeeds & sends publish=false
    const pngRes = await shareImageAsCivitaiDraft(
      imgId,
      { title: 'Moonlit Shrine', tags: ['scenic', 'night'] },
      { fetchFn: buildMockFetch(false) }
    );
    assert.equal(pngRes.postId, 554433);
    assert.equal(pngRes.draftUrl, 'https://civitai.com/posts/554433');
    assert.equal(pngRes.uploadMode, 'original_png');

    const createCall = capturedCalls.find((c) => c.tool === 'create_post');
    assert.equal(createCall?.args?.publish, false);
    assert.equal(createCall?.args?.modelVersionId, 775533);

    // 2. Oversized PNG triggers CivitaiPayloadTooLargeError -> caller retries as jpeg_exif
    capturedCalls.length = 0;
    await assert.rejects(
      () => shareImageAsCivitaiDraft(imgId, { uploadMode: 'original_png' }, { fetchFn: buildMockFetch(true) }),
      (err: unknown) => err instanceof CivitaiPayloadTooLargeError && err.code === 'PAYLOAD_TOO_LARGE'
    );

    capturedCalls.length = 0;
    const jpegRes = await shareImageAsCivitaiDraft(
      imgId,
      { uploadMode: 'jpeg_exif', modelVersionId: null },
      { fetchFn: buildMockFetch(true) }
    );
    assert.equal(jpegRes.uploadMode, 'jpeg_exif');
    const jpegUpload = capturedCalls.find((c) => c.tool === 'upload_image');
    assert.equal(jpegUpload?.args?.contentType, 'image/jpeg');
    const jpegBuffer = Buffer.from(jpegUpload?.args?.data, 'base64');
    const jpegMeta = await sharp(jpegBuffer).metadata();
    assert.equal(jpegMeta.format, 'jpeg');
    assert.ok(jpegMeta.exif && jpegMeta.exif.toString('latin1').includes('moonlit forest shrine'));

    // Both drafts logged in SQLite
    const postCheck = await evaluateCivitaiShareEligibility(imgId);
    assert.equal(postCheck.existingDrafts.length, 2);
    assert.equal(postCheck.existingDrafts[0].uploadMode, 'jpeg_exif');
    assert.equal(postCheck.existingDrafts[1].uploadMode, 'original_png');
  });
});
