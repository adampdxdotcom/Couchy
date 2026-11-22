import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import http from 'http';
import { initTempDb, type TempDbContext } from './helpers/tempDb.ts';

let ctx: TempDbContext;
let server: http.Server;
let baseUrl = '';
let appConfig: typeof import('../src/server/config.ts').appConfig;
let configureScheduledBackups: typeof import('../src/server/services/backupService.ts').configureScheduledBackups;

const originalKeys = {
  civitaiApiKey: '',
  hfApiToken: '',
  localLlmApiKey: '',
  comfyuiUrl: '',
};

before(async () => {
  ctx = await initTempDb('couchy-config-route-test');
  ({ appConfig } = await import('../src/server/config.ts'));
  ({ configureScheduledBackups } = await import('../src/server/services/backupService.ts'));
  const { systemRouter } = await import('../src/server/routes/systemRoutes.ts');

  originalKeys.civitaiApiKey = appConfig.civitaiApiKey;
  originalKeys.hfApiToken = appConfig.hfApiToken;
  originalKeys.localLlmApiKey = appConfig.localLlmApiKey;
  originalKeys.comfyuiUrl = appConfig.comfyuiUrl;

  appConfig.civitaiApiKey = 'secret-civitai-token-123';
  appConfig.hfApiToken = 'hf_secret_token_456';
  appConfig.localLlmApiKey = 'sk-local-llm-secret-789';

  const app = express();
  app.use(express.json());
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
    appConfig.civitaiApiKey = originalKeys.civitaiApiKey;
    appConfig.hfApiToken = originalKeys.hfApiToken;
    appConfig.localLlmApiKey = originalKeys.localLlmApiKey;
    appConfig.comfyuiUrl = originalKeys.comfyuiUrl;
  }
  await new Promise<void>((resolve) => server?.close(() => resolve()));
  ctx?.cleanup();
});

describe('systemRoutes /api/config & /api/health security and validation', () => {
  it('never leaks server-side API keys in PATCH /api/config or GET /api/health', async () => {
    const patchRes = await fetch(`${baseUrl}/api/config`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        comfyuiUrl: 'http://127.0.0.1:8188/',
        quickGenBoxEnabled: false,
      }),
    });

    assert.equal(patchRes.status, 200);
    const patchText = await patchRes.text();
    assert.ok(!patchText.includes('secret-civitai-token-123'));
    assert.ok(!patchText.includes('hf_secret_token_456'));
    assert.ok(!patchText.includes('sk-local-llm-secret-789'));

    const patchBody = JSON.parse(patchText);
    assert.equal(patchBody.ok, true);
    assert.equal(patchBody.config.comfyuiUrl, 'http://127.0.0.1:8188');
    assert.equal(patchBody.config.hasCivitaiKey, true);
    assert.equal(patchBody.config.hasHfToken, true);
    assert.equal(patchBody.config.quickGenBoxEnabled, false);
    assert.equal('civitaiApiKey' in patchBody.config, false);
    assert.equal('hfApiToken' in patchBody.config, false);
    assert.equal('localLlmApiKey' in patchBody.config, false);

    const healthRes = await fetch(`${baseUrl}/api/health`);
    assert.equal(healthRes.status, 200);
    const healthText = await healthRes.text();
    assert.ok(!healthText.includes('secret-civitai-token-123'));
    assert.ok(!healthText.includes('hf_secret_token_456'));
    assert.ok(!healthText.includes('sk-local-llm-secret-789'));
  });

  it('rejects invalid URLs, relative directory paths, and out-of-range backup intervals without mutating config', async () => {
    const prevUrl = appConfig.comfyuiUrl;
    const prevOutDir = appConfig.comfyuiOutputDir;

    const badUrlRes = await fetch(`${baseUrl}/api/config`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ comfyuiUrl: 'file:///etc/passwd' }),
    });
    assert.equal(badUrlRes.status, 400);
    assert.equal(appConfig.comfyuiUrl, prevUrl);

    const badPathRes = await fetch(`${baseUrl}/api/config`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        comfyuiUrl: 'http://127.0.0.1:9999',
        comfyuiOutputDir: 'relative/output/dir',
      }),
    });
    assert.equal(badPathRes.status, 400);
    // Validation runs atomically before mutations, so comfyuiUrl must remain untouched
    assert.equal(appConfig.comfyuiUrl, prevUrl);
    assert.equal(appConfig.comfyuiOutputDir, prevOutDir);

    const badHoursRes = await fetch(`${baseUrl}/api/config`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ scheduledBackupHours: 999 }),
    });
    assert.equal(badHoursRes.status, 400);
  });
});
