import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { initTempDb, type TempDbContext } from './helpers/tempDb.ts';

let ctx: TempDbContext;
let tempOutputDir: string;
let tempUploadedDir: string;
let tempThumbDir: string;
let createUploadedInspirationFromImageId: typeof import('../src/server/services/scanner/scannerMediaUtils.ts').createUploadedInspirationFromImageId;

before(async () => {
  tempOutputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'couchy-inspo-out-'));
  tempUploadedDir = fs.mkdtempSync(path.join(os.tmpdir(), 'couchy-inspo-up-'));
  tempThumbDir = fs.mkdtempSync(path.join(os.tmpdir(), 'couchy-inspo-thumb-'));

  process.env.COMFYUI_OUTPUT_DIR = tempOutputDir;
  process.env.UPLOADED_IMAGES_DIR = tempUploadedDir;
  process.env.THUMBNAIL_DIR = tempThumbDir;

  ctx = await initTempDb('couchy-local-inspo-test');
  const { appConfig } = await import('../src/server/config.ts');
  appConfig.comfyuiOutputDir = tempOutputDir;
  appConfig.uploadedImagesDir = tempUploadedDir;
  appConfig.thumbnailPath = tempThumbDir;

  ({ createUploadedInspirationFromImageId } = await import(
    '../src/server/services/scanner/scannerMediaUtils.ts'
  ));
});

after(() => {
  ctx.cleanup();
  for (const dir of [tempOutputDir, tempUploadedDir, tempThumbDir]) {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      // ignore cleanup failures
    }
  }
});

describe('createUploadedInspirationFromImageId', () => {
  it('creates a <=1MP JPEG copy in uploadedImagesDir, indexes as is_uploaded_reference=1, and deduplicates repeat calls', async () => {
    // Write a 2000x1500 (3MP) source image into the output directory
    const srcRel = 'stack_mid_photo.png';
    const srcPath = path.join(tempOutputDir, srcRel);
    await sharp({
      create: { width: 2000, height: 1500, channels: 3, background: { r: 80, g: 120, b: 190 } },
    })
      .png()
      .toFile(srcPath);

    const sourceHash = 'abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789';
    const sourceId = Number(
      ctx.db
        .prepare(
          `INSERT INTO images
            (content_hash, relative_path, filename, file_size, width, height, format, file_mtime, is_missing, is_uploaded_reference)
           VALUES (?, ?, ?, 4096, 2000, 1500, 'PNG', '2026-11-27T00:00:00Z', 0, 0)`
        )
        .run(sourceHash, srcRel, srcRel).lastInsertRowid
    );

    const inspoId1 = await createUploadedInspirationFromImageId(sourceId, 'editorial lighting portrait');
    assert.ok(inspoId1 && inspoId1 !== sourceId, 'should create a distinct uploaded reference image row');

    const inspoRow = ctx.db
      .prepare(
        `SELECT id, relative_path, width, height, is_uploaded_reference
         FROM images WHERE id = ?`
      )
      .get(inspoId1) as {
      id: number;
      relative_path: string;
      width: number;
      height: number;
      is_uploaded_reference: number;
    };

    assert.equal(inspoRow.is_uploaded_reference, 1);
    assert.ok(inspoRow.relative_path.startsWith('__uploaded__/reuse-1mp-abcdef0123456789.jpg'));
    assert.ok(inspoRow.width * inspoRow.height <= 1_050_000, 'copy should be downscaled to ~1MP');

    // Reusing the same source photo again must deduplicate to the same uploaded reference ID
    const inspoId2 = await createUploadedInspirationFromImageId(sourceId, 'another prompt');
    assert.equal(inspoId2, inspoId1);

    // Passing an image that is already an uploaded reference should return itself without copying
    const inspoId3 = await createUploadedInspirationFromImageId(inspoId1, 'reused inspo');
    assert.equal(inspoId3, inspoId1);

    const uploadedFiles = fs.readdirSync(tempUploadedDir);
    assert.equal(uploadedFiles.length, 1);
  });

  it('returns null gracefully for invalid or missing image IDs', async () => {
    assert.equal(await createUploadedInspirationFromImageId(0), null);
    assert.equal(await createUploadedInspirationFromImageId(-5), null);
    assert.equal(await createUploadedInspirationFromImageId(999999), null);
  });
});
