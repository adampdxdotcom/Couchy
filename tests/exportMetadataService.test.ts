import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import sharp from 'sharp';
import { initTempDb, type TempDbContext } from './helpers/tempDb.ts';

let ctx: TempDbContext;
let getExportMetadataSettings: typeof import('../src/server/services/exportMetadataService.ts').getExportMetadataSettings;
let prepareExportImageBuffer: typeof import('../src/server/services/exportMetadataService.ts').prepareExportImageBuffer;
let upsertPngTextChunk: typeof import('../src/server/services/civitai/civitaiImagePayload.ts').upsertPngTextChunk;

interface ParsedPngTextChunk {
  type: string;
  keyword: string;
  text: string;
}

/**
 * Minimal PNG tEXt / iTXt chunk inspector for verifying exported buffers without extra deps.
 */
function readPngTextChunks(buf: Buffer): ParsedPngTextChunk[] {
  const chunks: ParsedPngTextChunk[] = [];
  let offset = 8; // skip 8-byte PNG signature
  while (offset + 12 <= buf.length) {
    const length = buf.readUInt32BE(offset);
    const type = buf.subarray(offset + 4, offset + 8).toString('ascii');
    const data = buf.subarray(offset + 8, offset + 8 + length);
    if (type === 'tEXt') {
      const nul = data.indexOf(0);
      if (nul > 0) {
        chunks.push({
          type,
          keyword: data.subarray(0, nul).toString('latin1'),
          text: data.subarray(nul + 1).toString('latin1'),
        });
      }
    } else if (type === 'iTXt') {
      const nul1 = data.indexOf(0);
      if (nul1 > 0 && nul1 + 3 < data.length) {
        const keyword = data.subarray(0, nul1).toString('latin1');
        // After keyword\0: compressionFlag(1), compressionMethod(1), languageTag\0, translatedKeyword\0, utf8 text
        const nul2 = data.indexOf(0, nul1 + 3);
        const nul3 = nul2 >= 0 ? data.indexOf(0, nul2 + 1) : -1;
        if (nul3 >= 0) {
          chunks.push({
            type,
            keyword,
            text: data.subarray(nul3 + 1).toString('utf8'),
          });
        }
      }
    }
    offset += 12 + length;
  }
  return chunks;
}

let seededImageId = 0;
let seededPngPath = '';
let originalPngBytes: Buffer;

before(async () => {
  ctx = await initTempDb('couchy-export-metadata-test');
  ({ getExportMetadataSettings, prepareExportImageBuffer } = await import(
    '../src/server/services/exportMetadataService.ts'
  ));
  ({ upsertPngTextChunk } = await import('../src/server/services/civitai/civitaiImagePayload.ts'));

  // Build a tiny 1x1 PNG containing original ComfyUI prompt + workflow chunks
  const basePng = await sharp({
    create: { width: 1, height: 1, channels: 4, background: { r: 10, g: 20, b: 30, alpha: 1 } },
  })
    .png()
    .toBuffer();
  let pngWithComfy = upsertPngTextChunk(basePng, 'prompt', '{"1":{"class_type":"KSampler"}}');
  pngWithComfy = upsertPngTextChunk(pngWithComfy, 'workflow', '{"nodes":[{"id":1}]}');
  originalPngBytes = pngWithComfy;

  seededPngPath = path.join(path.dirname(ctx.dbPath), 'sample_export.png');
  fs.writeFileSync(seededPngPath, originalPngBytes);

  const hash = 'abc123exporttest';
  const imgRes = ctx.db
    .prepare(
      `INSERT INTO images (filename, relative_path, content_hash, file_size, width, height, file_mtime)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .run('sample_export.png', 'sample_export.png', hash, originalPngBytes.length, 896, 1152, '2026-11-26T10:00:00.000Z');
  seededImageId = Number(imgRes.lastInsertRowid);

  ctx.db
    .prepare(
      `INSERT INTO ratings (content_hash, rating, is_favorite, notes)
       VALUES (?, 5, 1, 'Golden hour rooftop test')`
    )
    .run(hash);

  ctx.db
    .prepare(
      `INSERT INTO image_metadata
         (image_id, positive_prompt, negative_prompt, seed, steps, cfg, sampler, scheduler, checkpoint_name, generation_date)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      seededImageId,
      'editorial portrait of Maya in golden hour light',
      'blurry, watermark',
      424242,
      28,
      3.5,
      'euler',
      'simple',
      'flux_krea_v2.safetensors',
      '2026-11-26T09:30:00.000Z'
    );

  const charId = Number(
    ctx.db.prepare(`INSERT INTO characters (name) VALUES ('Maya Lin')`).run().lastInsertRowid
  );
  ctx.db
    .prepare(
      `INSERT INTO image_characters (image_content_hash, character_id, status)
       VALUES (?, ?, 'confirmed')`
    )
    .run(hash, charId);

  const tagId = Number(
    ctx.db.prepare(`INSERT INTO tags (name) VALUES ('rooftop')`).run().lastInsertRowid
  );
  ctx.db
    .prepare(`INSERT INTO image_tags (image_content_hash, tag_id) VALUES (?, ?)`)
    .run(hash, tagId);

  const colId = Number(
    ctx.db.prepare(`INSERT INTO collections (name) VALUES ('Editorial Picks')`).run().lastInsertRowid
  );
  ctx.db
    .prepare(`INSERT INTO collection_images (collection_id, image_content_hash) VALUES (?, ?)`)
    .run(colId, hash);

  const loraModelId = Number(
    ctx.db
      .prepare(
        `INSERT INTO models (name, filename, model_type, nickname, civitai_version_id, autov2_hash)
         VALUES ('Velvet Film Grain', 'velvet_film_v1.safetensors', 'lora', 'velvet', '987654', 'ABCDEF1234')`
      )
      .run().lastInsertRowid
  );
  ctx.db
    .prepare(
      `INSERT INTO image_loras (image_id, lora_name, model_strength, model_id)
       VALUES (?, 'velvet_film_v1.safetensors', 0.8, ?)`
    )
    .run(seededImageId, loraModelId);
});

after(() => {
  ctx?.cleanup();
});

describe('exportMetadataService', () => {
  it('defaults both switches to Off and returns null so disk bytes stream unchanged', async () => {
    const defaults = getExportMetadataSettings();
    assert.deepEqual(defaults, { insertCouchy: false, insertCivitai: false });

    const out = await prepareExportImageBuffer(seededImageId, seededPngPath);
    assert.equal(out, null);
  });

  it('embeds spec-compliant XMP iTXt + couchy JSON when only Insert Couchy Metadata is On', async () => {
    const out = await prepareExportImageBuffer(seededImageId, seededPngPath, {
      insertCouchy: true,
      insertCivitai: false,
    });
    assert.ok(out, 'expected modified PNG buffer');

    const chunks = readPngTextChunks(out);
    const byKey = new Map(chunks.map((c) => [c.keyword, c]));

    // Original ComfyUI chunks stay intact
    assert.equal(byKey.get('prompt')?.text, '{"1":{"class_type":"KSampler"}}');
    assert.equal(byKey.get('workflow')?.text, '{"nodes":[{"id":1}]}');
    assert.equal(byKey.has('parameters'), false);

    // XMP must be an iTXt chunk named XML:com.adobe.xmp
    const xmp = byKey.get('XML:com.adobe.xmp');
    assert.ok(xmp, 'expected XML:com.adobe.xmp chunk');
    assert.equal(xmp.type, 'iTXt');
    assert.ok(xmp.text.includes('<xmp:CreatorTool>Couchy</xmp:CreatorTool>'));
    assert.ok(xmp.text.includes('<xmp:Rating>5</xmp:Rating>'));
    assert.ok(xmp.text.includes('<xmp:Label>Favorite</xmp:Label>'));
    assert.ok(xmp.text.includes('<rdf:li>Maya Lin</rdf:li>'));
    assert.ok(xmp.text.includes('<rdf:li>rooftop</rdf:li>'));
    assert.ok(xmp.text.includes('<rdf:li>Editorial Picks</rdf:li>'));
    assert.ok(xmp.text.includes('<rdf:li>Velvet Film Grain</rdf:li>'));
    assert.ok(xmp.text.includes('Golden hour rooftop test'));

    // Structured couchy JSON chunk
    const couchyChunk = byKey.get('couchy');
    assert.ok(couchyChunk, 'expected couchy chunk');
    const parsed = JSON.parse(couchyChunk.text);
    assert.equal(parsed.rating, 5);
    assert.equal(parsed.isFavorite, true);
    assert.deepEqual(parsed.characters, ['Maya Lin']);
    assert.deepEqual(parsed.tags, ['rooftop']);
    assert.deepEqual(parsed.collections, ['Editorial Picks']);
    assert.equal(parsed.loras[0].name, 'Velvet Film Grain');
    assert.equal(parsed.loras[0].nickname, '@velvet');

    // File on disk must remain byte-for-byte untouched
    assert.deepEqual(fs.readFileSync(seededPngPath), originalPngBytes);
  });

  it('embeds Civitai/A1111 parameters when only Insert Civitai Metadata is On', async () => {
    const out = await prepareExportImageBuffer(seededImageId, seededPngPath, {
      insertCouchy: false,
      insertCivitai: true,
    });
    assert.ok(out, 'expected modified PNG buffer');

    const chunks = readPngTextChunks(out);
    const byKey = new Map(chunks.map((c) => [c.keyword, c]));

    assert.equal(byKey.get('prompt')?.text, '{"1":{"class_type":"KSampler"}}');
    assert.equal(byKey.get('workflow')?.text, '{"nodes":[{"id":1}]}');
    assert.equal(byKey.has('XML:com.adobe.xmp'), false);
    assert.equal(byKey.has('couchy'), false);

    const params = byKey.get('parameters')?.text || '';
    assert.ok(params.includes('editorial portrait of Maya in golden hour light'));
    assert.ok(params.includes('Seed: 424242'));
    assert.ok(params.includes('Civitai resources:'));
    assert.ok(params.includes('987654'));
    assert.ok(params.includes('Lora hashes:'));
    assert.ok(params.includes('ABCDEF1234'));
  });

  it('embeds both Couchy and Civitai chunks together while preserving ComfyUI chunks', async () => {
    const out = await prepareExportImageBuffer(seededImageId, seededPngPath, {
      insertCouchy: true,
      insertCivitai: true,
    });
    assert.ok(out, 'expected modified PNG buffer');

    const keys = new Set(readPngTextChunks(out).map((c) => c.keyword));
    assert.ok(keys.has('prompt'));
    assert.ok(keys.has('workflow'));
    assert.ok(keys.has('parameters'));
    assert.ok(keys.has('couchy'));
    assert.ok(keys.has('XML:com.adobe.xmp'));
  });
});
