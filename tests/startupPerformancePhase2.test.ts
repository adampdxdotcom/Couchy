import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { initTempDb, type TempDbContext } from './helpers/tempDb.ts';

let ctx: TempDbContext;
let queryGalleryImages: typeof import('../src/server/services/galleryQueryService.ts').queryGalleryImages;
let hydrateImageRecords: typeof import('../src/server/services/galleryQueryService.ts').hydrateImageRecords;
let enrichSingleImageWithSeries: typeof import('../src/server/services/seriesService.ts').enrichSingleImageWithSeries;

let img1Id = 0;
let img2Id = 0;

before(async () => {
  ctx = await initTempDb('couchy-perf-phase2-test');
  ({ queryGalleryImages, hydrateImageRecords } = await import(
    '../src/server/services/galleryQueryService.ts'
  ));
  ({ enrichSingleImageWithSeries } = await import('../src/server/services/seriesService.ts'));

  // Enable visual tagger setting so visual tags are active for search and single-image detail
  ctx.db
    .prepare(
      `INSERT INTO app_settings (key, value) VALUES ('visual_tagger_enabled', '1')
       ON CONFLICT(key) DO UPDATE SET value = '1'`
    )
    .run();

  img1Id = Number(
    ctx.db
      .prepare(
        `INSERT INTO images (filename, relative_path, content_hash, file_size, width, height, file_mtime)
         VALUES ('shot1.png', 'shot1.png', 'hash_phase2_1', 1000, 896, 1152, '2026-11-26T10:00:00.000Z')`
      )
      .run().lastInsertRowid
  );
  img2Id = Number(
    ctx.db
      .prepare(
        `INSERT INTO images (filename, relative_path, content_hash, file_size, width, height, file_mtime)
         VALUES ('shot2.png', 'shot2.png', 'hash_phase2_2', 1000, 896, 1152, '2026-11-26T10:05:00.000Z')`
      )
      .run().lastInsertRowid
  );

  ctx.db
    .prepare(
      `INSERT INTO image_visual_tags (image_content_hash, tag, confidence)
       VALUES ('hash_phase2_1', 'neon_rain', 0.92), ('hash_phase2_2', 'sunlit_beach', 0.88)`
    )
    .run();

  // Put img1 in a conversation series with a stored chat transcript
  const seriesId = Number(
    ctx.db
      .prepare(`INSERT INTO image_series (poster_image_id, series_kind) VALUES (NULL, 'iterative')`)
      .run().lastInsertRowid
  );
  const chatJson = JSON.stringify([
    { id: 'm1', role: 'user', content: 'make it rain at night' },
    { id: 'm2', role: 'assistant', content: 'updated', proposedPrompt: 'neon rain portrait', submitted: true },
  ]);
  ctx.db
    .prepare(
      `INSERT INTO image_series_items (series_id, image_id, step_order, chat_snapshot_json)
       VALUES (?, ?, 0, ?)`
    )
    .run(seriesId, img1Id, chatJson);
});

after(() => {
  ctx?.cleanup();
});

describe('Phase 2 slim gallery list payload vs single-image detail parity', () => {
  it('omits visualTags and chatSnapshot arrays from bulk queryGalleryImages while preserving visual-tag search and hasChat', () => {
    const all = queryGalleryImages({});
    assert.equal(all.length, 2);

    const card1 = all.find((i) => i.id === img1Id);
    assert.ok(card1);
    assert.deepEqual(card1.visualTags, []);
    assert.equal(card1.hasChat, true);
    assert.deepEqual(card1.chatSnapshot, []);
    assert.equal(card1.seriesItems?.length, 1);
    assert.equal(card1.seriesItems?.[0].hasChat, true);
    assert.deepEqual(card1.seriesItems?.[0].chatSnapshot, []);

    // Visual-tag text search still finds the matching image, yet omits visualTags from the response
    const matched = queryGalleryImages({ query: 'neon rain' });
    assert.equal(matched.length, 1);
    assert.equal(matched[0].id, img1Id);
    assert.deepEqual(matched[0].visualTags, []);
  });

  it('returns full visualTags and full chatSnapshot on single-image detail hydration', () => {
    const row = ctx.db.prepare('SELECT * FROM images WHERE id = ?').get(img1Id);
    const hydrated = enrichSingleImageWithSeries(hydrateImageRecords([row])[0]);

    assert.equal(hydrated.visualTags?.length, 1);
    assert.equal(hydrated.visualTags?.[0].tag, 'neon_rain');
    assert.equal(hydrated.hasChat, true);
    assert.equal(hydrated.chatSnapshot?.length, 2);
    assert.equal(hydrated.seriesItems?.[0].chatSnapshot.length, 2);
  });
});
