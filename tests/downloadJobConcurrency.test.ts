import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { initTempDb, type TempDbContext } from './helpers/tempDb.ts';

let ctx: TempDbContext;
let tempDownloadsDir = '';
let tempComfyModelsDir = '';
const origFetch = globalThis.fetch;

let appConfig: typeof import('../src/server/config.ts').appConfig;
let startConfirmedModelDownload: typeof import('../src/server/services/modelManagerService.ts').startConfirmedModelDownload;
let executeDownloadJob: typeof import('../src/server/services/modelManagerService.ts').executeDownloadJob;
let isDownloadJobActive: typeof import('../src/server/services/modelManagerService.ts').isDownloadJobActive;
let ensureRedownloadQueueRunning: typeof import('../src/server/services/modelRedownloadService.ts').ensureRedownloadQueueRunning;

const origDirs = {
  downloadsDir: '',
  comfyuiModelsDir: '',
};

before(async () => {
  ctx = await initTempDb('couchy-download-concurrency-test');
  tempDownloadsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'couchy-dl-test-'));
  tempComfyModelsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'couchy-cm-test-'));

  ({ appConfig } = await import('../src/server/config.ts'));
  origDirs.downloadsDir = appConfig.downloadsDir;
  origDirs.comfyuiModelsDir = appConfig.comfyuiModelsDir;
  appConfig.downloadsDir = tempDownloadsDir;
  appConfig.comfyuiModelsDir = tempComfyModelsDir;

  ({ startConfirmedModelDownload, executeDownloadJob, isDownloadJobActive } = await import(
    '../src/server/services/modelManagerService.ts'
  ));
  ({ ensureRedownloadQueueRunning } = await import(
    '../src/server/services/modelRedownloadService.ts'
  ));
});

after(() => {
  globalThis.fetch = origFetch;
  if (appConfig) {
    appConfig.downloadsDir = origDirs.downloadsDir;
    appConfig.comfyuiModelsDir = origDirs.comfyuiModelsDir;
  }
  if (tempDownloadsDir) fs.rmSync(tempDownloadsDir, { recursive: true, force: true });
  if (tempComfyModelsDir) fs.rmSync(tempComfyModelsDir, { recursive: true, force: true });
  ctx?.cleanup();
});

describe('Download job concurrency & .part handling', () => {
  it('never double-executes an active download when GET /api/downloads polling triggers ensureRedownloadQueueRunning', async () => {
    const chunk1 = Buffer.from('SAFETENSORS_HEADER_PART_1_');
    const chunk2 = Buffer.from('WEIGHTS_PAYLOAD_PART_2');
    const fullBytes = Buffer.concat([chunk1, chunk2]);
    const expectedSha256 = crypto.createHash('sha256').update(fullBytes).digest('hex').toUpperCase();

    let downloadFetchCount = 0;
    let releaseSecondChunk!: () => void;
    const secondChunkGate = new Promise<void>((resolve) => {
      releaseSecondChunk = resolve;
    });

    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const urlStr = String(input);
      if (!urlStr.includes('/api/download/models/999001')) {
        return new Response('Not Found', { status: 404 });
      }
      downloadFetchCount += 1;
      const stream = new ReadableStream<Uint8Array>({
        async start(controller) {
          controller.enqueue(chunk1);
          await secondChunkGate;
          controller.enqueue(chunk2);
          controller.close();
        },
      });
      return new Response(stream, {
        status: 200,
        headers: { 'content-length': String(fullBytes.length) },
      });
    }) as typeof fetch;

    const job = await startConfirmedModelDownload({
      provider: 'civitai',
      modelName: 'Test Race LoRA',
      filename: 'test_race_lora.safetensors',
      modelType: 'lora',
      subfolder: 'loras',
      sourceUrl: 'https://civitai.com/api/download/models/999001',
      expectedHash: expectedSha256,
      civitaiMeta: { previewImages: [] },
    });

    const jobId = Number(job.id);
    assert.equal(isDownloadJobActive(jobId), true, 'Job should be marked active immediately before setImmediate');

    // Simulate GET /api/downloads polling right after job insertion (0 bytes downloaded)
    ensureRedownloadQueueRunning();

    // Yield one tick so setImmediate begins streaming chunk1, then poll again mid-stream
    await new Promise((r) => setTimeout(r, 40));
    ensureRedownloadQueueRunning();

    // Direct duplicate executeDownloadJob call must also be ignored cleanly
    await executeDownloadJob(jobId, {
      provider: 'civitai',
      modelName: 'Test Race LoRA',
      safeFilename: 'test_race_lora.safetensors',
      effectiveModelType: 'lora',
      destinationPath: job.destination_path,
      sourceUrl: job.source_url,
      expectedHash: expectedSha256,
      civitaiMeta: { previewImages: [] },
    });

    releaseSecondChunk();

    // Wait for active download to finish completely
    const deadline = Date.now() + 5000;
    while (isDownloadJobActive(jobId) && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 20));
    }
    await new Promise((r) => setTimeout(r, 40));

    assert.equal(downloadFetchCount, 1, 'Model file must only be fetched once');
    assert.equal(isDownloadJobActive(jobId), false);

    const finalJob = ctx.db.prepare('SELECT * FROM download_jobs WHERE id = ?').get(jobId) as any;
    assert.equal(finalJob.status, 'completed');
    assert.equal(finalJob.hash_verified, 1);
    assert.equal(finalJob.actual_hash, expectedSha256);
    assert.equal(finalJob.error_message, null);

    const destPath = path.join(tempDownloadsDir, 'loras', 'test_race_lora.safetensors');
    assert.deepEqual(fs.readFileSync(destPath), fullBytes);

    const filesInLoras = fs.readdirSync(path.join(tempDownloadsDir, 'loras'));
    assert.deepEqual(filesInLoras, ['test_race_lora.safetensors']);
  });
});
