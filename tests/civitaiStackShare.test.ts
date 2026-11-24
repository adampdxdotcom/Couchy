import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { initTempDb, type TempDbContext } from './helpers/tempDb.ts';

let ctx: TempDbContext;
let tempImagesDir = '';

let appConfig: typeof import('../src/server/config.ts').appConfig;
let evaluateCivitaiShareEligibility: typeof import('../src/server/services/civitai/civitaiShareEligibility.ts').evaluateCivitaiShareEligibility;
let shareImageAsCivitaiDraft: typeof import('../src/server/services/civitai/civitaiDraftShareService.ts').shareImageAsCivitaiDraft;
let CivitaiShareValidationError: typeof import('../src/server/services/civitai/civitaiDraftShareService.ts').CivitaiShareValidationError;
let syncCivitaiActivityForImage: typeof import('../src/server/services/civitai/civitaiActivitySyncService.ts').syncCivitaiActivityForImage;
let stopCivitaiActivityScheduler: typeof import('../src/server/services/civitai/civitaiActivitySyncService.ts').stopCivitaiActivityScheduler;
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
  const iendOffset = basePng.lastIndexOf(Buffer.from('IEND'));
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
    create: { width: 64, height: 64, channels: 3, background: { r: 20, g: 30, b: 50 } },
  })
    .png()
    .toBuffer();
  const outBuf = textChunks ? buildPngWithTextChunks(basePng, textChunks) : basePng;
  const fullPath = path.join(tempImagesDir, filename);
  fs.writeFileSync(fullPath, outBuf);
  return fullPath;
}

function insertGenImage(params: {
  filename: string;
  contentHash: string;
  prompt: string;
  isUploadedReference?: number;
}): number {
  const info = ctx.db
    .prepare(
      `INSERT INTO images
        (relative_path, filename, content_hash, file_size, file_mtime, width, height, format, is_missing, is_uploaded_reference)
       VALUES (?, ?, ?, 4096, datetime('now'), 64, 64, 'png', 0, ?)`
    )
    .run(params.filename, params.filename, params.contentHash, params.isUploadedReference ?? 0);
  const imageId = Number(info.lastInsertRowid);

  ctx.db
    .prepare(
      `INSERT INTO image_metadata
        (image_id, positive_prompt, negative_prompt, seed, steps, cfg, sampler, scheduler, checkpoint_name)
       VALUES (?, ?, 'blurry', '100', 8, 1.0, 'euler', 'simple', 'krea2.safetensors')`
    )
    .run(imageId, params.prompt);

  return imageId;
}

function attachTag(imageId: number, contentHash: string, tagName: string): void {
  ctx.db.prepare(`INSERT OR IGNORE INTO tags (name) VALUES (?)`).run(tagName);
  const tagRow = ctx.db.prepare(`SELECT id FROM tags WHERE name = ?`).get(tagName) as { id: number };
  ctx.db
    .prepare(`INSERT OR IGNORE INTO image_tags (image_id, image_content_hash, tag_id) VALUES (?, ?, ?)`)
    .run(imageId, contentHash, tagRow.id);
}

before(async () => {
  ctx = await initTempDb('couchy-civitai-stack-test');
  tempImagesDir = fs.mkdtempSync(path.join(os.tmpdir(), 'couchy-civitai-stack-imgs-'));

  ({ appConfig } = await import('../src/server/config.ts'));
  ({ evaluateCivitaiShareEligibility } = await import(
    '../src/server/services/civitai/civitaiShareEligibility.ts'
  ));
  ({ shareImageAsCivitaiDraft, CivitaiShareValidationError } = await import(
    '../src/server/services/civitai/civitaiDraftShareService.ts'
  ));
  ({ syncCivitaiActivityForImage, stopCivitaiActivityScheduler } = await import(
    '../src/server/services/civitai/civitaiActivitySyncService.ts'
  ));
  ({ configureScheduledBackups } = await import('../src/server/services/backupService.ts'));

  const { setBoolSetting } = await import('../src/server/services/settingsService.ts');

  origConfig.comfyuiOutputDir = appConfig.comfyuiOutputDir;
  origConfig.civitaiApiKey = appConfig.civitaiApiKey;

  appConfig.comfyuiOutputDir = tempImagesDir;
  appConfig.civitaiApiKey = 'test-civitai-api-key';

  // Enable uncharacterized sharing to isolate stack logic cleanly
  setBoolSetting('allow_civitai_share_uncharacterized', true, 'true_false');
});

after(() => {
  configureScheduledBackups(0);
  stopCivitaiActivityScheduler?.();
  if (appConfig) {
    appConfig.comfyuiOutputDir = origConfig.comfyuiOutputDir;
    appConfig.civitaiApiKey = origConfig.civitaiApiKey;
  }
  if (tempImagesDir) {
    fs.rmSync(tempImagesDir, { recursive: true, force: true });
  }
  ctx?.cleanup();
});

describe('Civitai Stack Draft Sharing', () => {
  it('excludes upscales, inspirations, rejected & restricted characters, orders Poster first without duplicates, and merges tags', async () => {
    const genGraph = JSON.stringify({
      '10': { class_type: 'UNETLoader', inputs: { unet_name: 'krea2.safetensors' } },
      '20': { class_type: 'KSampler', inputs: { seed: 42, steps: 8, cfg: 1.0 } },
    });
    const upscaleGraph = JSON.stringify({
      '1': { class_type: 'LoadImage', inputs: { image: 'step1.png' } },
      '2': { class_type: 'UpscaleModelLoader', inputs: { model_name: '4x-ESRGAN.pth' } },
      '3': { class_type: 'ImageUpscaleWithModel', inputs: {} },
    });

    await writeTestPng('inspo.png', { prompt: genGraph });
    await writeTestPng('step1.png', { prompt: genGraph });
    await writeTestPng('step2_poster.png', { prompt: genGraph });
    await writeTestPng('step3_blocked_char.png', { prompt: genGraph });
    await writeTestPng('step4_rejected.png', { prompt: genGraph });
    await writeTestPng('step5_upscale.png', { prompt: upscaleGraph });

    const inspoId = insertGenImage({
      filename: 'inspo.png',
      contentHash: 'stk_inspo',
      prompt: 'reference pose',
      isUploadedReference: 1,
    });
    const step1Id = insertGenImage({
      filename: 'step1.png',
      contentHash: 'stk_step1',
      prompt: 'prompt step one',
    });
    const step2Id = insertGenImage({
      filename: 'step2_poster.png',
      contentHash: 'stk_step2',
      prompt: 'prompt poster favorite',
    });
    const step3Id = insertGenImage({
      filename: 'step3_blocked_char.png',
      contentHash: 'stk_step3',
      prompt: 'prompt blocked char',
    });
    const step4Id = insertGenImage({
      filename: 'step4_rejected.png',
      contentHash: 'stk_step4',
      prompt: 'prompt rejected',
    });
    const step5Id = insertGenImage({
      filename: 'step5_upscale.png',
      contentHash: 'stk_step5',
      prompt: 'upscaled final',
    });

    attachTag(step1Id, 'stk_step1', 'portrait');
    attachTag(step1Id, 'stk_step1', 'studio');
    attachTag(step2Id, 'stk_step2', 'Studio'); // case-insensitive dup
    attachTag(step2Id, 'stk_step2', 'warm-light');
    attachTag(step3Id, 'stk_step3', 'blocked-tag-should-not-leak');

    // Heart step2 as Poster and reject step4
    ctx.db
      .prepare(`INSERT INTO ratings (content_hash, is_favorite, is_rejected) VALUES ('stk_step2', 1, 0), ('stk_step4', 0, 1)`)
      .run();

    // Link blocked character to step3
    const charId = Number(
      ctx.db
        .prepare(`INSERT INTO characters (name, allow_civitai_share) VALUES ('PrivateOC', 0)`)
        .run().lastInsertRowid
    );
    ctx.db
      .prepare(
        `INSERT INTO image_characters (image_id, image_content_hash, character_id, status, source, confidence)
         VALUES (?, 'stk_step3', ?, 'confirmed', 'manual', 1.0)`
      )
      .run(step3Id, charId);

    const seriesId = Number(
      ctx.db
        .prepare(`INSERT INTO image_series (poster_image_id, series_kind) VALUES (?, 'iterative')`)
        .run(step2Id).lastInsertRowid
    );
    ctx.db
      .prepare(
        `INSERT INTO image_series_items (series_id, image_id, step_order)
         VALUES (?, ?, 0), (?, ?, 1), (?, ?, 2), (?, ?, 3), (?, ?, 4), (?, ?, 5)`
      )
      .run(seriesId, inspoId, seriesId, step1Id, seriesId, step2Id, seriesId, step3Id, seriesId, step4Id, seriesId, step5Id);

    // Querying from step5 (the standalone upscale!) still offers stack eligibility
    const status = await evaluateCivitaiShareEligibility(step5Id);
    assert.equal(status.eligible, false);
    assert.ok(status.stack);
    assert.equal(status.stack.eligible, true);
    assert.equal(status.stack.totalMembers, 6);
    assert.equal(status.stack.eligibleCount, 2);
    assert.deepEqual(
      status.stack.eligibleItems.map((i) => i.imageId),
      [step2Id, step1Id],
      'Poster step2 must be first (not duplicated), followed by step1'
    );
    assert.equal(status.stack.prefilledDescription, 'prompt poster favorite');
    assert.deepEqual(status.stack.prefilledTags, ['studio', 'warm-light', 'portrait']);
    assert.equal(status.stack.excludedItems.length, 4);
    assert.deepEqual(
      status.stack.excludedItems.map((e) => e.reasonCode),
      ['uploaded_reference', 'character_restricted', 'missing_or_rejected', 'standalone_upscale']
    );
  });

  it('falls back to most recent eligible image metadata and step order when no step is hearted', async () => {
    const genGraph = JSON.stringify({
      '10': { class_type: 'UNETLoader', inputs: { unet_name: 'krea2.safetensors' } },
      '20': { class_type: 'KSampler', inputs: { seed: 42, steps: 8, cfg: 1.0 } },
    });
    await writeTestPng('noheart_0.png', { prompt: genGraph });
    await writeTestPng('noheart_1.png', { prompt: genGraph });
    await writeTestPng('noheart_2.png', { prompt: genGraph });

    const id0 = insertGenImage({ filename: 'noheart_0.png', contentHash: 'nh_0', prompt: 'first prompt' });
    const id1 = insertGenImage({ filename: 'noheart_1.png', contentHash: 'nh_1', prompt: 'second prompt' });
    const id2 = insertGenImage({ filename: 'noheart_2.png', contentHash: 'nh_2', prompt: 'most recent prompt' });

    const seriesId = Number(
      ctx.db.prepare(`INSERT INTO image_series (poster_image_id, series_kind) VALUES (NULL, 'multi_shot')`).run().lastInsertRowid
    );
    ctx.db
      .prepare(`INSERT INTO image_series_items (series_id, image_id, step_order) VALUES (?, ?, 0), (?, ?, 1), (?, ?, 2)`)
      .run(seriesId, id0, seriesId, id1, seriesId, id2);

    const status = await evaluateCivitaiShareEligibility(id0);
    assert.ok(status.stack);
    assert.equal(status.stack.eligible, true);
    assert.equal(status.stack.posterImageId, null);
    assert.deepEqual(
      status.stack.eligibleItems.map((i) => i.imageId),
      [id0, id1, id2],
      'Unhearted stack preserves step order ascending'
    );
    assert.equal(status.stack.representativeImageId, id2);
    assert.equal(status.stack.prefilledDescription, 'most recent prompt');
  });

  it('disables stack sharing when eligible stack size exceeds 20 images', async () => {
    const genGraph = JSON.stringify({
      '10': { class_type: 'UNETLoader', inputs: { unet_name: 'krea2.safetensors' } },
      '20': { class_type: 'KSampler', inputs: { seed: 42, steps: 8, cfg: 1.0 } },
    });
    const seriesId = Number(
      ctx.db.prepare(`INSERT INTO image_series (poster_image_id, series_kind) VALUES (NULL, 'multi_shot')`).run().lastInsertRowid
    );
    const ids: number[] = [];
    for (let i = 0; i < 21; i++) {
      const fname = `cap_${i}.png`;
      await writeTestPng(fname, { prompt: genGraph });
      const id = insertGenImage({ filename: fname, contentHash: `cap_hash_${i}`, prompt: `shot ${i}` });
      ids.push(id);
      ctx.db
        .prepare(`INSERT INTO image_series_items (series_id, image_id, step_order) VALUES (?, ?, ?)`)
        .run(seriesId, id, i);
    }

    const status = await evaluateCivitaiShareEligibility(ids[0]);
    assert.ok(status.stack);
    assert.equal(status.stack.eligibleCount, 21);
    assert.equal(status.stack.exceedsLimit, true);
    assert.equal(status.stack.eligible, false);
    assert.ok(status.stack.disabledReason?.includes('20'));

    await assert.rejects(
      () => shareImageAsCivitaiDraft(ids[0], { shareScope: 'stack' }),
      (err: unknown) => err instanceof CivitaiShareValidationError
    );
  });

  it('uploads selected stack in Poster-first order, auto-falls back per oversized PNG to JPEG+EXIF, logs rows per image, and syncs limit=20', async () => {
    const genGraph = JSON.stringify({
      '10': { class_type: 'UNETLoader', inputs: { unet_name: 'krea2.safetensors' } },
      '20': { class_type: 'KSampler', inputs: { seed: 42, steps: 8, cfg: 1.0 } },
    });
    await writeTestPng('upload_a.png', { prompt: genGraph });
    await writeTestPng('upload_b_big.png', { prompt: genGraph });
    await writeTestPng('upload_c_skipped.png', { prompt: genGraph });

    const idA = insertGenImage({ filename: 'upload_a.png', contentHash: 'up_a', prompt: 'prompt A' });
    const idB = insertGenImage({ filename: 'upload_b_big.png', contentHash: 'up_b', prompt: 'prompt B oversized' });
    const idC = insertGenImage({ filename: 'upload_c_skipped.png', contentHash: 'up_c', prompt: 'prompt C unchecked' });

    ctx.db.prepare(`INSERT INTO ratings (content_hash, is_favorite) VALUES ('up_b', 1)`).run();
    const seriesId = Number(
      ctx.db.prepare(`INSERT INTO image_series (poster_image_id, series_kind) VALUES (?, 'iterative')`).run(idB).lastInsertRowid
    );
    ctx.db
      .prepare(`INSERT INTO image_series_items (series_id, image_id, step_order) VALUES (?, ?, 0), (?, ?, 1), (?, ?, 2)`)
      .run(seriesId, idA, seriesId, idB, seriesId, idC);

    const uploadLog: Array<{ contentType: string; uuid: string }> = [];
    let createPostArgs: any = null;
    let uploadCallIndex = 0;

    const mockFetch: typeof fetch = async (_url, init) => {
      const body = JSON.parse(String(init?.body || '{}'));
      const toolName = body?.params?.name;
      const toolArgs = body?.params?.arguments;

      if (body.method === 'initialize') {
        return new Response(JSON.stringify({ jsonrpc: '2.0', id: body.id, result: {} }), {
          status: 200,
          headers: { 'mcp-session-id': 'stack-sid' },
        });
      }
      if (body.method === 'notifications/initialized') {
        return new Response('', { status: 202 });
      }
      if (toolName === 'whoami') {
        return new Response(
          JSON.stringify({ jsonrpc: '2.0', id: body.id, result: { structuredContent: { id: 1, isOnboarded: true } } }),
          { status: 200 }
        );
      }
      if (toolName === 'upload_image') {
        uploadCallIndex += 1;
        // First image uploaded is Poster (idB): reject its PNG with 413 so ONLY idB auto-falls back to JPEG
        if (uploadCallIndex === 1 && toolArgs.contentType === 'image/png') {
          return new Response('Payload Too Large', { status: 413 });
        }
        const uuid = `uuid-${uploadLog.length + 1}`;
        uploadLog.push({ contentType: toolArgs.contentType, uuid });
        return new Response(
          JSON.stringify({
            jsonrpc: '2.0',
            id: body.id,
            result: { structuredContent: { uuid, width: 64, height: 64 } },
          }),
          { status: 200 }
        );
      }
      if (toolName === 'create_post') {
        createPostArgs = toolArgs;
        return new Response(
          JSON.stringify({
            jsonrpc: '2.0',
            id: body.id,
            result: { content: [{ type: 'text', text: JSON.stringify({ id: 909090, processingImageIds: [1, 2] }) }] },
          }),
          { status: 200 }
        );
      }
      throw new Error(`Unexpected call: ${toolName}`);
    };

    // Pass idA & idB in reversed order to verify server enforces Poster-first ordering (`idB`, `idA`)
    const res = await shareImageAsCivitaiDraft(
      idA,
      {
        shareScope: 'stack',
        selectedImageIds: [idA, idB],
        title: 'Stack Draft Test',
        detail: 'prompt B oversized',
        tags: ['stack', 'portrait'],
      },
      { fetchFn: mockFetch }
    );

    assert.equal(res.shareScope, 'stack');
    assert.equal(res.postId, 909090);
    assert.equal(res.uploadedCount, 2);
    assert.equal(res.jpegFallbackCount, 1);

    // Poster idB converted to JPEG, second image idA kept as PNG
    assert.deepEqual(uploadLog, [
      { contentType: 'image/jpeg', uuid: 'uuid-1' },
      { contentType: 'image/png', uuid: 'uuid-2' },
    ]);
    assert.equal(createPostArgs.publish, false);
    assert.equal(createPostArgs.images.length, 2);
    assert.deepEqual(
      createPostArgs.images.map((i: any) => i.uuid),
      ['uuid-1', 'uuid-2']
    );

    // Draft rows logged for idB (jpeg_exif) and idA (original_png), NOT idC
    const rows = ctx.db
      .prepare(`SELECT image_id, upload_mode, civitai_post_id FROM image_civitai_drafts WHERE civitai_post_id = 909090 ORDER BY id ASC`)
      .all() as Array<{ image_id: number; upload_mode: string; civitai_post_id: number }>;
    assert.deepEqual(rows, [
      { image_id: idB, upload_mode: 'jpeg_exif', civitai_post_id: 909090 },
      { image_id: idA, upload_mode: 'original_png', civitai_post_id: 909090 },
    ]);

    // Verify activity sync uses limit=20
    let requestedUrl = '';
    await syncCivitaiActivityForImage(idA, {
      minIntervalMs: 0,
      deps: {
        fetchFn: async (url) => {
          requestedUrl = String(url);
          return new Response(JSON.stringify({ items: [] }), { status: 200 });
        },
      },
    });
    assert.ok(requestedUrl.includes('limit=20'), `Expected limit=20 in sync URL, got: ${requestedUrl}`);
  });
});
