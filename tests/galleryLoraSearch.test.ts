import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { initTempDb, type TempDbContext } from './helpers/tempDb.ts';

let ctx: TempDbContext;
let db: typeof import('../src/server/db.ts').db;
let queryGalleryImages: typeof import('../src/server/services/galleryQueryService.ts').queryGalleryImages;

function insertImageWithLora(params: {
  filename: string;
  contentHash: string;
  prompt: string;
  loraName?: string;
  modelId?: number | null;
}): number {
  const imgInfo = db
    .prepare(
      `INSERT INTO images
        (filename, relative_path, file_size, file_mtime, content_hash, width, height, is_missing)
       VALUES (?, ?, 1024, '2026-05-01T12:00:00.000Z', ?, 1024, 1024, 0)`
    )
    .run(params.filename, params.filename, params.contentHash);
  const imageId = Number(imgInfo.lastInsertRowid);

  db.prepare(
    `INSERT INTO image_metadata (image_id, positive_prompt) VALUES (?, ?)`
  ).run(imageId, params.prompt);

  if (params.loraName) {
    db.prepare(
      `INSERT INTO image_loras
        (image_id, model_id, lora_name, model_strength, clip_strength, provenance)
       VALUES (?, ?, ?, 0.8, 0.8, 'parsed')`
    ).run(imageId, params.modelId ?? null, params.loraName);
  }

  return imageId;
}

before(async () => {
  ctx = await initTempDb('couchy-gallery-lora-search-test');
  ({ db } = await import('../src/server/db.ts'));
  ({ queryGalleryImages } = await import('../src/server/services/galleryQueryService.ts'));

  // Seed a renamed LoRA with a @nickname
  const modelInfo = db
    .prepare(
      `INSERT INTO models (name, filename, model_type, lora_category, nickname, is_installed)
       VALUES ('Warm Vintage Film', 'krea_vntg_9981_fp8.safetensors', 'lora', 'style', 'filmgrain', 1)`
    )
    .run();
  const modelId = Number(modelInfo.lastInsertRowid);

  // Image 1: uses the LoRA via model_id + raw filename
  insertImageWithLora({
    filename: 'img_with_lora.png',
    contentHash: 'hash_lora_1',
    prompt: 'portrait of a hiker in the mountains',
    loraName: 'krea_vntg_9981_fp8.safetensors',
    modelId,
  });

  // Image 2: uses the same LoRA via subfoldered path without model_id populated
  insertImageWithLora({
    filename: 'img_with_subfolder_lora.png',
    contentHash: 'hash_lora_2',
    prompt: 'city street at midnight',
    loraName: 'styles\\krea_vntg_9981_fp8.safetensors',
    modelId: null,
  });

  // Image 3: does NOT use the LoRA, but mentions the nickname word in its prompt
  insertImageWithLora({
    filename: 'img_prompt_only.png',
    contentHash: 'hash_prompt_3',
    prompt: 'analog photo with subtle filmgrain texture',
  });
});

after(() => {
  ctx?.cleanup();
});

describe('Main gallery search by Couchy LoRA display name and @nickname', () => {
  it('matches images by Couchy LoRA display name (quoted and unquoted) including subfoldered LoRAs', () => {
    const quoted = queryGalleryImages({ query: '"Warm Vintage Film"' });
    assert.deepEqual(
      quoted.map((i) => i.filename).sort(),
      ['img_with_lora.png', 'img_with_subfolder_lora.png']
    );

    const unquoted = queryGalleryImages({ query: 'Warm Vintage' });
    assert.deepEqual(
      unquoted.map((i) => i.filename).sort(),
      ['img_with_lora.png', 'img_with_subfolder_lora.png']
    );
  });

  it('matches only LoRA-attached images when searching by @nickname, without false prompt matches', () => {
    const byAtNick = queryGalleryImages({ query: '@filmgrain' });
    assert.deepEqual(
      byAtNick.map((i) => i.filename).sort(),
      ['img_with_lora.png', 'img_with_subfolder_lora.png']
    );

    const byNegatedAtNick = queryGalleryImages({ query: '-@filmgrain' });
    assert.deepEqual(
      byNegatedAtNick.map((i) => i.filename),
      ['img_prompt_only.png']
    );
  });

  it('supports explicit lora: predicates for display names, @nicknames, and raw filenames', () => {
    assert.equal(queryGalleryImages({ query: 'lora:"Warm Vintage"' }).length, 2);
    assert.equal(queryGalleryImages({ query: 'lora:@filmgrain' }).length, 2);
    assert.equal(queryGalleryImages({ query: 'lora:filmgrain' }).length, 2);
    assert.equal(queryGalleryImages({ query: 'lora:krea_vntg_9981' }).length, 2);
  });
});
