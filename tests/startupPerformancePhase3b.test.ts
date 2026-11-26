import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { initTempDb, type TempDbContext } from './helpers/tempDb.ts';

let ctx: TempDbContext;
let queryGalleryImagesPage: typeof import('../src/server/services/galleryQueryService.ts').queryGalleryImagesPage;
let queryGalleryImages: typeof import('../src/server/services/galleryQueryService.ts').queryGalleryImages;
let getGalleryDbChangeStamp: typeof import('../src/server/services/galleryPoolCache.ts').getGalleryDbChangeStamp;
let getOrBuildHydratedGalleryPool: typeof import('../src/server/services/galleryPoolCache.ts').getOrBuildHydratedGalleryPool;
let invalidateGalleryPoolCache: typeof import('../src/server/services/galleryPoolCache.ts').invalidateGalleryPoolCache;

const seededIds: number[] = [];

function seedImage(opts: {
  hash: string;
  filename: string;
  mtime: string;
  prompt?: string;
  rating?: number;
  isFavorite?: boolean;
  isRejected?: boolean;
}): number {
  const res = ctx.db
    .prepare(
      `INSERT INTO images
        (content_hash, relative_path, filename, file_size, width, height, format, file_mtime, is_missing, is_uploaded_reference)
       VALUES (?, ?, ?, 2048, 1024, 1024, 'png', ?, 0, 0)`
    )
    .run(opts.hash, opts.filename, opts.filename, opts.mtime);
  const id = Number(res.lastInsertRowid);

  ctx.db
    .prepare(
      `INSERT INTO image_metadata (image_id, positive_prompt, checkpoint_name)
       VALUES (?, ?, 'krea2_turbo.safetensors')`
    )
    .run(id, opts.prompt ?? 'editorial portrait');

  if (opts.rating || opts.isFavorite || opts.isRejected) {
    ctx.db
      .prepare(
        `INSERT INTO ratings (content_hash, rating, is_favorite, is_rejected, is_archived)
         VALUES (?, ?, ?, ?, 0)`
      )
      .run(
        opts.hash,
        opts.rating ?? 0,
        opts.isFavorite ? 1 : 0,
        opts.isRejected ? 1 : 0
      );
  }

  return id;
}

before(async () => {
  ctx = await initTempDb('couchy-perf-phase3b-test');
  ({ queryGalleryImagesPage, queryGalleryImages } = await import(
    '../src/server/services/galleryQueryService.ts'
  ));
  ({
    getGalleryDbChangeStamp,
    getOrBuildHydratedGalleryPool,
    invalidateGalleryPoolCache,
  } = await import('../src/server/services/galleryPoolCache.ts'));

  // Enable visual tagger setting so visual tag queries are exercised
  ctx.db
    .prepare(
      `INSERT INTO app_settings (key, value) VALUES ('visual_tagger_enabled', 'true')
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`
    )
    .run();

  // Seed 7 non-rejected images with strictly increasing timestamps
  for (let i = 1; i <= 7; i += 1) {
    const id = seedImage({
      hash: `h-p3b-${i}`,
      filename: `p3b_0${i}.png`,
      mtime: `2026-11-26T10:0${i}:00.000Z`,
      prompt: i % 2 === 0 ? 'neon rain street portrait' : 'sunlit studio portrait',
      rating: i === 7 ? 5 : i >= 5 ? 4 : 0,
      isFavorite: i === 6 || i === 7,
    });
    seededIds.push(id);
  }

  // Attach a visual tag to image #2 so we can test non-mutating visual tag sanitization
  ctx.db
    .prepare(
      `INSERT INTO image_visual_tags (image_content_hash, tag, confidence)
       VALUES ('h-p3b-2', 'red_umbrella', 0.96)`
    )
    .run();

  // Group images #3 and #4 into a collapsed Series Stack (total visible cards: 7 - 1 = 6)
  const seriesId = Number(
    ctx.db
      .prepare(`INSERT INTO image_series (poster_image_id, series_kind) VALUES (?, 'iterative')`)
      .run(seededIds[2]).lastInsertRowid
  );
  ctx.db
    .prepare(
      `INSERT INTO image_series_items (series_id, image_id, step_order) VALUES (?, ?, 1), (?, ?, 2)`
    )
    .run(seriesId, seededIds[2], seriesId, seededIds[3]);
});

after(() => {
  invalidateGalleryPoolCache();
  ctx?.cleanup();
});

describe('Phase 3B server-side pagination and stamp-invalidated gallery pool cache', () => {
  it('returns accurate paginated slices, totals, and page clamping across Series Stacks', () => {
    // 7 images with 2 collapsed into 1 Series Stack => 6 visible cards total
    const p1 = queryGalleryImagesPage({ page: 1, pageSize: 2, sortBy: 'newest' });
    assert.equal(p1.total, 6);
    assert.equal(p1.page, 1);
    assert.equal(p1.pageSize, 2);
    assert.equal(p1.totalPages, 3);
    assert.equal(p1.items.length, 2);
    assert.deepEqual(
      p1.items.map((i) => i.filename),
      ['p3b_07.png', 'p3b_06.png']
    );

    const p2 = queryGalleryImagesPage({ page: 2, pageSize: 2, sortBy: 'newest' });
    assert.equal(p2.page, 2);
    assert.equal(p2.items.length, 2);
    assert.equal(p2.items[0].filename, 'p3b_05.png');

    // Out-of-range page clamps cleanly to last valid page
    const pClamped = queryGalleryImagesPage({ page: 99, pageSize: 2, sortBy: 'newest' });
    assert.equal(pClamped.page, 3);
    assert.equal(pClamped.items.length, 2);

    // Unpaginated wrapper still returns all 6 collapsed cards (ZIP export compatibility)
    const all = queryGalleryImages({ sortBy: 'newest' });
    assert.equal(all.length, 6);
  });

  it('reuses cached pool when DB stamp is unchanged and invalidates immediately on any SQLite write', () => {
    invalidateGalleryPoolCache();
    let buildCount = 0;
    const stampBefore = getGalleryDbChangeStamp();

    const first = getOrBuildHydratedGalleryPool(false, () => {
      buildCount += 1;
      return [];
    });
    const second = getOrBuildHydratedGalleryPool(false, () => {
      buildCount += 1;
      return [];
    });
    assert.equal(buildCount, 1);
    assert.strictEqual(first, second);
    assert.equal(getGalleryDbChangeStamp(), stampBefore);

    // Clear the synthetic empty pool above so queryGalleryImagesPage builds from real DB rows
    invalidateGalleryPoolCache();

    // Verify real query updates immediately after a direct SQLite rating/rejection write
    const favBefore = queryGalleryImagesPage({ favoritesOnly: true, page: 1, pageSize: 10 });
    assert.equal(favBefore.total, 2);

    // Reject image #7 directly in SQLite — cache stamp must advance and exclude it immediately
    ctx.db
      .prepare(`UPDATE ratings SET is_rejected = 1 WHERE content_hash = 'h-p3b-7'`)
      .run();

    assert.notEqual(getGalleryDbChangeStamp(), stampBefore);

    const favAfter = queryGalleryImagesPage({ favoritesOnly: true, page: 1, pageSize: 10 });
    assert.equal(favAfter.total, 1);
    assert.equal(favAfter.items[0].filename, 'p3b_06.png');

    // Restore image #7 so subsequent tests see clean state
    ctx.db
      .prepare(`UPDATE ratings SET is_rejected = 0 WHERE content_hash = 'h-p3b-7'`)
      .run();
  });

  it('strips visualTags from text-search list responses without mutating the cached pool', () => {
    const firstSearch = queryGalleryImagesPage({
      query: 'red umbrella',
      page: 1,
      pageSize: 10,
    });
    assert.equal(firstSearch.total, 1);
    assert.equal(firstSearch.items[0].filename, 'p3b_02.png');
    assert.deepEqual(firstSearch.items[0].visualTags, []);

    // Second identical search hits the cached vt1 pool and must STILL match visual tags
    const secondSearch = queryGalleryImagesPage({
      query: 'red umbrella',
      page: 1,
      pageSize: 10,
    });
    assert.equal(secondSearch.total, 1);
    assert.equal(secondSearch.items[0].filename, 'p3b_02.png');
    assert.deepEqual(secondSearch.items[0].visualTags, []);
  });
});
