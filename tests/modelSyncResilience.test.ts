import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import http from 'http';
import path from 'path';
import { initTempDb, type TempDbContext } from './helpers/tempDb.ts';

let ctx: TempDbContext;
let db: typeof import('../src/server/db.ts').db;
let appConfig: typeof import('../src/server/config.ts').appConfig;
let syncModelInventory: typeof import('../src/server/services/modelInventoryService.ts').syncModelInventory;
let scheduleDebouncedModelSync: typeof import('../src/server/services/modelWatcherService.ts').scheduleDebouncedModelSync;
let cancelPendingModelSync: typeof import('../src/server/services/modelWatcherService.ts').cancelPendingModelSync;

let tempModelsDir = '';
let tempDownloadsDir = '';
const originalConfig = {
  comfyuiModelsDir: '',
  downloadsDir: '',
  comfyuiUrl: '',
};

before(async () => {
  ctx = await initTempDb('couchy-model-sync-resilience-test');
  ({ db } = await import('../src/server/db.ts'));
  ({ appConfig } = await import('../src/server/config.ts'));
  ({ syncModelInventory } = await import('../src/server/services/modelInventoryService.ts'));
  ({ scheduleDebouncedModelSync, cancelPendingModelSync } = await import(
    '../src/server/services/modelWatcherService.ts'
  ));

  originalConfig.comfyuiModelsDir = appConfig.comfyuiModelsDir;
  originalConfig.downloadsDir = appConfig.downloadsDir;
  originalConfig.comfyuiUrl = appConfig.comfyuiUrl;

  const tempRoot = path.dirname(ctx.dbPath);
  tempModelsDir = path.join(tempRoot, 'comfy_models');
  tempDownloadsDir = path.join(tempRoot, 'downloads');
  fs.mkdirSync(path.join(tempModelsDir, 'loras'), { recursive: true });
  fs.mkdirSync(tempDownloadsDir, { recursive: true });

  appConfig.comfyuiModelsDir = tempModelsDir;
  appConfig.downloadsDir = tempDownloadsDir;
  // Point to an unreachable local port to simulate ComfyUI being offline on reboot
  appConfig.comfyuiUrl = 'http://127.0.0.1:1';
});

after(() => {
  cancelPendingModelSync();
  if (appConfig) {
    appConfig.comfyuiModelsDir = originalConfig.comfyuiModelsDir;
    appConfig.downloadsDir = originalConfig.downloadsDir;
    appConfig.comfyuiUrl = originalConfig.comfyuiUrl;
  }
  ctx?.cleanup();
});

describe('Model inventory sync resilience & live watcher debounce', () => {
  it('preserves existing installed flags when COMFYUI_MODELS_DIR is empty and ComfyUI is offline', async () => {
    db.prepare(
      `INSERT INTO models (name, filename, model_type, is_installed, comfyui_path)
       VALUES ('reboot_lora', 'reboot_lora.safetensors', 'lora', 1, 'reboot_lora.safetensors')`
    ).run();

    const items = await syncModelInventory();
    const preserved = items.find((m) => m.filename === 'reboot_lora.safetensors');
    assert.equal(preserved?.isInstalled, true);
    assert.equal(preserved?.comfyuiPath, 'reboot_lora.safetensors');
  });

  it('discovers newly mounted models and marks deleted models uninstalled once mount is populated', async () => {
    const loraA = path.join(tempModelsDir, 'loras', 'alpha_lora.safetensors');
    const loraB = path.join(tempModelsDir, 'loras', 'beta_lora.safetensors');
    fs.writeFileSync(loraA, 'fake-safetensors-a');
    fs.writeFileSync(loraB, 'fake-safetensors-b');

    const afterMount = await syncModelInventory();
    assert.equal(afterMount.find((m) => m.filename === 'alpha_lora.safetensors')?.isInstalled, true);
    assert.equal(afterMount.find((m) => m.filename === 'beta_lora.safetensors')?.isInstalled, true);
    // Previously seeded model absent from the now-populated mount is reconciled to uninstalled
    assert.equal(afterMount.find((m) => m.filename === 'reboot_lora.safetensors')?.isInstalled, false);

    // Deleting one file from a populated mount marks only that file uninstalled
    fs.unlinkSync(loraB);
    const afterDelete = await syncModelInventory();
    assert.equal(afterDelete.find((m) => m.filename === 'alpha_lora.safetensors')?.isInstalled, true);
    assert.equal(afterDelete.find((m) => m.filename === 'beta_lora.safetensors')?.isInstalled, false);
  });

  it('reconciles authoritatively against ComfyUI /object_info when ComfyUI comes online', async () => {
    // Empty the local folder to simulate a remote ComfyUI instance with no local disk mount
    fs.unlinkSync(path.join(tempModelsDir, 'loras', 'alpha_lora.safetensors'));

    const mockComfy = http.createServer((req, res) => {
      if (req.url === '/object_info') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            LoraLoader: {
              input: {
                required: {
                  lora_name: [['remote_comfy_lora.safetensors'], {}],
                },
              },
            },
          })
        );
        return;
      }
      res.writeHead(404);
      res.end();
    });

    await new Promise<void>((resolve) => mockComfy.listen(0, '127.0.0.1', () => resolve()));
    const addr = mockComfy.address();
    assert.ok(addr && typeof addr === 'object');

    const prevUrl = appConfig.comfyuiUrl;
    appConfig.comfyuiUrl = `http://127.0.0.1:${addr.port}`;
    try {
      const items = await syncModelInventory();
      assert.equal(
        items.find((m) => m.filename === 'remote_comfy_lora.safetensors')?.isInstalled,
        true
      );
      assert.equal(items.find((m) => m.filename === 'alpha_lora.safetensors')?.isInstalled, false);
    } finally {
      appConfig.comfyuiUrl = prevUrl;
      await new Promise<void>((resolve) => mockComfy.close(() => resolve()));
    }
  });

  it('coalesces rapid debounced model sync triggers into a single run', async () => {
    let runCount = 0;
    const runner = async () => {
      runCount += 1;
    };

    scheduleDebouncedModelSync('fs:add-1', 40, runner);
    scheduleDebouncedModelSync('fs:add-2', 40, runner);
    scheduleDebouncedModelSync('comfyui-online:ws', 40, runner);

    await new Promise((resolve) => setTimeout(resolve, 110));
    assert.equal(runCount, 1);
  });
});
