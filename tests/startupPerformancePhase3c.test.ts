import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { initTempDb, type TempDbContext } from './helpers/tempDb.ts';

let ctx: TempDbContext;
let listWorkflowLibraryItems: typeof import('../src/server/services/workflowLibraryService.ts').listWorkflowLibraryItems;
let listLoraExplorerItems: typeof import('../src/server/services/galleryQueryService.ts').listLoraExplorerItems;
let listModelInventory: typeof import('../src/server/services/modelInventoryService.ts').listModelInventory;
let getDbChangeStamp: typeof import('../src/server/services/stampedCatalogCache.ts').getDbChangeStamp;
let invalidateStampedCatalogCache: typeof import('../src/server/services/stampedCatalogCache.ts').invalidateStampedCatalogCache;

let savedWfId = 0;
let extractedWfId = 0;
let loraModelId = 0;
let ckptModelId = 0;

before(async () => {
  ctx = await initTempDb('couchy-perf-phase3c-test');
  ({ listWorkflowLibraryItems } = await import('../src/server/services/workflowLibraryService.ts'));
  ({ listLoraExplorerItems } = await import('../src/server/services/galleryQueryService.ts'));
  ({ listModelInventory } = await import('../src/server/services/modelInventoryService.ts'));
  ({ getDbChangeStamp, invalidateStampedCatalogCache } = await import(
    '../src/server/services/stampedCatalogCache.ts'
  ));

  savedWfId = Number(
    ctx.db
      .prepare(
        `INSERT INTO workflows (name, workflow_hash, is_saved_library, is_default, api_workflow_json)
         VALUES ('System Default WF', 'wf-saved-1', 1, 1, '{}')`
      )
      .run().lastInsertRowid
  );
  extractedWfId = Number(
    ctx.db
      .prepare(
        `INSERT INTO workflows (name, workflow_hash, is_saved_library, is_default, api_workflow_json)
         VALUES ('Extracted Historical WF', 'wf-extracted-1', 0, 0, '{}')`
      )
      .run().lastInsertRowid
  );

  const previewsJson = JSON.stringify([
    { filename: 'p1.webp', width: 512, height: 512 },
    { filename: 'p2.webp', width: 512, height: 512 },
  ]);
  const statsJson = JSON.stringify({ downloadCount: 420, thumbsUpCount: 88, commentCount: 2 });
  const commentsJson = JSON.stringify([
    { id: 1, author: 'tester', content: 'Great LoRA!', createdAt: '2026-11-01T00:00:00Z' },
  ]);

  loraModelId = Number(
    ctx.db
      .prepare(
        `INSERT INTO models
          (name, filename, model_type, lora_category, is_installed, nickname, mention_enabled,
           civitai_description, preview_images_json, civitai_stats_json, civitai_comments_json)
         VALUES ('Velvet Style', 'velvet_style.safetensors', 'lora', 'style', 1, 'velvet', 1,
                 '<p>Long Civitai HTML description</p>', ?, ?, ?)`
      )
      .run(previewsJson, statsJson, commentsJson).lastInsertRowid
  );

  ckptModelId = Number(
    ctx.db
      .prepare(
        `INSERT INTO models
          (name, filename, model_type, is_installed, nickname, mention_enabled,
           civitai_description, preview_images_json, civitai_stats_json, civitai_comments_json)
         VALUES ('Krea Base', 'krea_base.safetensors', 'checkpoint', 1, 'krea', 1,
                 '<p>Base checkpoint HTML description</p>', ?, ?, ?)`
      )
      .run(previewsJson, statsJson, commentsJson).lastInsertRowid
  );

  const imgId = Number(
    ctx.db
      .prepare(
        `INSERT INTO images
          (content_hash, relative_path, filename, file_size, width, height, format, file_mtime, is_missing, is_uploaded_reference)
         VALUES ('h-p3c-1', 'p3c_1.png', 'p3c_1.png', 1024, 1024, 1024, 'png', '2026-11-26T10:00:00.000Z', 0, 0)`
      )
      .run().lastInsertRowid
  );
  ctx.db
    .prepare(
      `INSERT INTO image_loras (image_id, lora_name, model_strength, clip_strength)
       VALUES (?, 'velvet_style.safetensors', 0.8, 0.8)`
    )
    .run(imgId);
  ctx.db
    .prepare(
      `INSERT INTO image_models (image_id, model_name, model_type)
       VALUES (?, 'krea_base.safetensors', 'checkpoint')`
    )
    .run(imgId);
  ctx.db
    .prepare(
      `INSERT INTO image_workflows (image_id, image_content_hash, workflow_id)
       VALUES (?, 'h-p3c-1', ?)`
    )
    .run(imgId, extractedWfId);
});

after(() => {
  invalidateStampedCatalogCache();
  ctx?.cleanup();
});

describe('Phase 3C slim tab-specific catalogs and SQLite-stamp caching', () => {
  it('filters workflows to saved/default rows when savedOnly is true while preserving full list default', () => {
    const saved = listWorkflowLibraryItems({ savedOnly: true });
    assert.ok(saved.every((w) => w.isSavedLibrary || w.isDefault));
    assert.ok(saved.some((w) => w.id === savedWfId));
    assert.ok(!saved.some((w) => w.id === extractedWfId));

    const all = listWorkflowLibraryItems();
    assert.equal(all.length, saved.length + 1);
    assert.ok(all.some((w) => w.id === extractedWfId));
  });

  it('omits heavy Civitai blobs in compact LoRA/Model modes while keeping startup fields intact', () => {
    const compactLoras = listLoraExplorerItems({ compact: true });
    const cLora = compactLoras.find((l) => l.modelId === loraModelId);
    assert.ok(cLora);
    assert.equal(cLora.imageCount, 1);
    assert.equal(cLora.nickname, 'velvet');
    assert.equal(cLora.mentionEnabled, true);
    assert.equal(cLora.civitaiDescription, null);
    assert.deepEqual(cLora.previewImages, []);
    assert.equal(cLora.civitaiStats, null);
    assert.deepEqual(cLora.civitaiComments, []);

    const fullLoras = listLoraExplorerItems();
    const fLora = fullLoras.find((l) => l.modelId === loraModelId);
    assert.ok(fLora);
    assert.equal(fLora.civitaiDescription, '<p>Long Civitai HTML description</p>');
    assert.equal(fLora.previewImages?.length, 2);
    assert.equal(fLora.civitaiComments?.length, 1);
    assert.equal(fLora.minModelStrength, 0.8);

    const compactModels = listModelInventory({ compact: true });
    const cModel = compactModels.find((m) => m.id === ckptModelId);
    assert.ok(cModel);
    assert.equal(cModel.nickname, 'krea');
    assert.equal(cModel.civitaiDescription, null);
    assert.equal(cModel.civitaiStats, null);
    assert.deepEqual(cModel.civitaiComments, []);
    // Compact mode keeps at most 1 cover preview URL for Quick Gen @mention avatars
    assert.equal(cModel.previewImages?.length, 1);

    const fullModels = listModelInventory();
    const fModel = fullModels.find((m) => m.id === ckptModelId);
    assert.ok(fModel);
    assert.equal(fModel.dependentImageCount, 1);
    assert.equal(fModel.dependentWorkflowCount, 1);
    assert.equal(fModel.previewImages?.length, 2);
    assert.equal(fModel.civitaiDescription, '<p>Base checkpoint HTML description</p>');
  });

  it('caches catalog projections by SQLite change stamp and invalidates immediately on DB write', () => {
    invalidateStampedCatalogCache();
    const stampBefore = getDbChangeStamp();
    const first = listModelInventory({ compact: true });
    const second = listModelInventory({ compact: true });
    assert.strictEqual(first, second);
    assert.equal(getDbChangeStamp(), stampBefore);

    ctx.db.prepare(`UPDATE models SET nickname = 'krea2' WHERE id = ?`).run(ckptModelId);
    assert.notEqual(getDbChangeStamp(), stampBefore);

    const refreshed = listModelInventory({ compact: true });
    assert.notStrictEqual(refreshed, first);
    assert.equal(refreshed.find((m) => m.id === ckptModelId)?.nickname, 'krea2');
  });
});
