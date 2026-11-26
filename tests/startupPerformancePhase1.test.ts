import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import http from 'http';
import { initTempDb, type TempDbContext } from './helpers/tempDb.ts';

let ctx: TempDbContext;
let listWorkflowLibraryItems: typeof import('../src/server/services/workflowLibraryService.ts').listWorkflowLibraryItems;
let saveOrUpdateWorkflow: typeof import('../src/server/services/workflowLibraryService.ts').saveOrUpdateWorkflow;
let listCharacterProfiles: typeof import('../src/server/services/characterService.ts').listCharacterProfiles;
let getCharacterProfileById: typeof import('../src/server/services/characterService.ts').getCharacterProfileById;
let listLoraExplorerItems: typeof import('../src/server/services/galleryQueryService.ts').listLoraExplorerItems;
let checkLmStudioStatus: typeof import('../src/server/services/llm/llmClientService.ts').checkLmStudioStatus;
let updateLmStudioSettings: typeof import('../src/server/services/llm/llmClientService.ts').updateLmStudioSettings;

before(async () => {
  ctx = await initTempDb('couchy-perf-phase1-test');
  ({ listWorkflowLibraryItems, saveOrUpdateWorkflow } = await import(
    '../src/server/services/workflowLibraryService.ts'
  ));
  ({ listCharacterProfiles, getCharacterProfileById } = await import(
    '../src/server/services/characterService.ts'
  ));
  ({ listLoraExplorerItems } = await import('../src/server/services/galleryQueryService.ts'));
  ({ checkLmStudioStatus, updateLmStudioSettings } = await import(
    '../src/server/services/llm/llmClientService.ts'
  ));
});

after(() => {
  ctx?.cleanup();
});

describe('Phase 1 startup performance optimizations', () => {
  it('applies migration v33 startup performance indexes', () => {
    const indexes = (
      ctx.db.prepare("SELECT name FROM sqlite_master WHERE type = 'index'").all() as {
        name: string;
      }[]
    ).map((r) => r.name);

    assert.ok(indexes.includes('idx_image_models_name_lower'));
    assert.ok(indexes.includes('idx_char_loras_name_lower'));
    assert.ok(indexes.includes('idx_char_loras_char_id'));
    assert.ok(indexes.includes('idx_image_workflows_image_id'));
  });

  it('parses defaults only for saved/default workflows and invalidates cache on update', () => {
    const sampleGraph = JSON.stringify({
      '30_10': { class_type: 'UNETLoader', inputs: { unet_name: 'flux_krea_v2.safetensors' } },
      '3': { class_type: 'KSampler', inputs: { steps: 24 } },
    });

    // Insert an auto-extracted (non-saved) image workflow
    ctx.db
      .prepare(
        `INSERT INTO workflows (name, description, is_saved_library, is_default, api_workflow_json, workflow_hash)
         VALUES ('Extracted #1', '', 0, 0, ?, 'hash-extracted-1')`
      )
      .run(sampleGraph);

    // Save a library workflow
    const saved = saveOrUpdateWorkflow({
      name: 'Saved Krea Workflow',
      apiWorkflowJson: sampleGraph,
      isDefault: false,
    });

    const items = listWorkflowLibraryItems();
    const extractedItem = items.find((w) => w.workflowHash === 'hash-extracted-1');
    const savedItem = items.find((w) => w.id === saved.id);

    assert.ok(extractedItem);
    assert.equal(extractedItem.defaultCheckpoint, null);
    assert.equal(extractedItem.defaultSteps, null);

    assert.ok(savedItem);
    assert.equal(savedItem.defaultCheckpoint, 'flux_krea_v2.safetensors');
    assert.equal(savedItem.defaultSteps, 24);

    // Update the saved workflow and confirm cache invalidation reflects new checkpoint immediately
    const updatedGraph = JSON.stringify({
      '30_10': { class_type: 'UNETLoader', inputs: { unet_name: 'flux_krea_v3.safetensors' } },
      '3': { class_type: 'KSampler', inputs: { steps: 16 } },
    });
    saveOrUpdateWorkflow({ id: saved.id, apiWorkflowJson: updatedGraph });

    const refreshed = listWorkflowLibraryItems().find((w) => w.id === saved.id);
    assert.equal(refreshed?.defaultCheckpoint, 'flux_krea_v3.safetensors');
    assert.equal(refreshed?.defaultSteps, 16);
  });

  it('matches single-character detail parity with batched listCharacterProfiles and listLoraExplorerItems', () => {
    const hash = 'perf-char-hash-1';
    ctx.db
      .prepare(
        `INSERT INTO images (filename, relative_path, content_hash, file_size, width, height, file_mtime)
         VALUES ('maya.png', 'maya.png', ?, 1024, 512, 512, '2026-11-26T10:00:00.000Z')`
      )
      .run(hash);
    ctx.db.prepare(`INSERT INTO ratings (content_hash, rating) VALUES (?, 5)`).run(hash);

    const charId = Number(
      ctx.db
        .prepare(`INSERT INTO characters (name, description) VALUES ('Maya Perf', 'Test bio')`)
        .run().lastInsertRowid
    );
    ctx.db
      .prepare(`INSERT INTO character_aliases (character_id, alias) VALUES (?, 'MayaP')`)
      .run(charId);
    ctx.db
      .prepare(
        `INSERT INTO models (name, filename, model_type, is_installed)
         VALUES ('Maya LoRA', 'maya_lora.safetensors', 'lora', 1)`
      )
      .run();
    ctx.db
      .prepare(
        `INSERT INTO character_loras (character_id, lora_name, appearance_label)
         VALUES (?, 'maya_lora.safetensors', 'Default')`
      )
      .run(charId);
    ctx.db
      .prepare(
        `INSERT INTO image_characters (image_content_hash, character_id, status)
         VALUES (?, ?, 'confirmed')`
      )
      .run(hash, charId);

    const batched = listCharacterProfiles().find((c) => c.id === charId);
    const single = getCharacterProfileById(charId);
    assert.deepEqual(batched, single);

    const loraItem = listLoraExplorerItems().find((l) => l.filename === 'maya_lora.safetensors');
    assert.ok(loraItem);
    assert.equal(loraItem.characters.length, 1);
    assert.equal(loraItem.characters[0].name, 'Maya Perf');
  });

  it('coalesces concurrent checkLmStudioStatus probes and reuses the 5s cache', async () => {
    let modelsHits = 0;
    const mockServer = http.createServer((req, res) => {
      if (req.url === '/v1/models') {
        modelsHits += 1;
        setTimeout(() => {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ data: [{ id: 'qwen-test-model' }] }));
        }, 40);
        return;
      }
      if (req.url === '/api/v0/models') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ data: [{ id: 'qwen-test-model', state: 'loaded', type: 'llm' }] }));
        return;
      }
      res.writeHead(404).end();
    });

    await new Promise<void>((resolve) => mockServer.listen(0, '127.0.0.1', () => resolve()));
    const addr = mockServer.address();
    const mockBaseUrl = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}/v1`;

    try {
      updateLmStudioSettings({ baseUrl: mockBaseUrl, selectedModel: 'qwen-test-model' });

      // Two concurrent calls (like /readiness + /lmstudio/status on page load) share 1 probe
      const [r1, r2] = await Promise.all([checkLmStudioStatus(), checkLmStudioStatus()]);
      assert.equal(r1.online, true);
      assert.equal(r2.online, true);
      assert.equal(modelsHits, 1);

      // Subsequent immediate call hits the 5s cache
      const r3 = await checkLmStudioStatus();
      assert.equal(r3.online, true);
      assert.equal(modelsHits, 1);

      // forceRefresh bypasses cache
      const r4 = await checkLmStudioStatus(undefined, { forceRefresh: true });
      assert.equal(r4.online, true);
      assert.equal(modelsHits, 2);
    } finally {
      await new Promise<void>((resolve) => mockServer.close(() => resolve()));
    }
  });
});
