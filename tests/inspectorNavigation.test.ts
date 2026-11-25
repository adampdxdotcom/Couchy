import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  getOrderedVisibleSeriesItems,
  isSeriesItemVisible,
  resolveInspectorNavigationTargets,
  type InspectorVisibilityFilter,
} from '../src/components/inspector/inspectorNavigation.ts';
import type { ImageRecord, ImageSeriesItem } from '../src/shared/types.ts';
import { initTempDb, type TempDbContext } from './helpers/tempDb.ts';

function makeSeriesItem(
  seriesId: number,
  imageId: number,
  stepOrder: number,
  opts: Partial<ImageSeriesItem> = {}
): ImageSeriesItem {
  return {
    seriesId,
    imageId,
    stepOrder,
    filename: `img_${imageId}.png`,
    thumbnailUrl: `/api/images/${imageId}/thumbnail`,
    originalUrl: `/api/images/${imageId}/file`,
    width: 1024,
    height: 1024,
    isFavorite: false,
    rating: 0,
    createdAt: `2026-01-01T00:00:0${stepOrder}.000Z`,
    chatSnapshot: [],
    isUploadedReference: false,
    isRejected: false,
    isArchived: false,
    ...opts,
  };
}

function makeCard(
  id: number,
  opts: Partial<ImageRecord> = {}
): ImageRecord {
  return {
    id,
    contentHash: `hash-${id}`,
    relativePath: `img_${id}.png`,
    filename: `img_${id}.png`,
    fileSize: 1024,
    width: 1024,
    height: 1024,
    format: 'png',
    createdAt: '2026-01-01T00:00:00.000Z',
    fileMtime: '2026-01-01T00:00:00.000Z',
    isMissing: false,
    thumbnailUrl: `/api/images/${id}/thumbnail`,
    originalUrl: `/api/images/${id}/file`,
    dependencyStatus: 'exact_match',
    rating: 0,
    isFavorite: false,
    isRejected: false,
    isArchived: false,
    notes: '',
    favoritedAt: null,
    positivePrompt: null,
    negativePrompt: null,
    seed: null,
    steps: null,
    cfg: null,
    sampler: null,
    scheduler: null,
    denoise: null,
    batchSize: null,
    batchIndex: null,
    generationDate: null,
    checkpointName: null,
    checkpointHash: null,
    vaeName: null,
    missingFields: [],
    provenance: {},
    hasVisualWorkflow: false,
    hasApiWorkflow: false,
    workflowId: null,
    loras: [],
    models: [],
    characters: [],
    tags: [],
    collections: [],
    ...opts,
  };
}

/** Walks forward or backward across all reachable photos starting from (cardId, activeImageId). */
function walkAllPhotos(
  galleryCards: ImageRecord[],
  startCardId: number,
  startImageId: number,
  direction: 'next' | 'prev',
  filter: InspectorVisibilityFilter
): number[] {
  const visited: number[] = [startImageId];
  let cardId = startCardId;
  let activeImageId = startImageId;

  for (let guard = 0; guard < 50; guard++) {
    const card = galleryCards.find((c) => c.id === cardId);
    const targets = resolveInspectorNavigationTargets({
      activeImageId,
      activeSeriesItems: card?.seriesItems,
      cardImageId: cardId,
      galleryCards,
      filter,
    });
    const next = direction === 'next' ? targets.nextPhoto : targets.prevPhoto;
    if (!next) break;
    if (next.type === 'step') {
      activeImageId = next.imageId;
    } else {
      cardId = next.cardId;
      activeImageId = next.iterationId;
    }
    visited.push(activeImageId);
  }
  return visited;
}

describe('inspectorNavigation', () => {
  const stackAItems: ImageSeriesItem[] = [
    makeSeriesItem(1, 101, 1, { isUploadedReference: true }), // Inspo Step 1
    makeSeriesItem(1, 102, 2, { isFavorite: true }), // Hearted poster
    makeSeriesItem(1, 103, 3, { isRejected: true }), // Hidden rejected step
    makeSeriesItem(1, 104, 4), // Newest step
  ];
  const cardA = makeCard(102, {
    seriesId: 1,
    seriesCount: stackAItems.length,
    seriesItems: stackAItems,
    isFavorite: true,
  });

  const cardB = makeCard(201); // Standalone image

  const stackCItems: ImageSeriesItem[] = [
    makeSeriesItem(2, 301, 1, { isArchived: true }), // Hidden archived step
    makeSeriesItem(2, 302, 2),
    makeSeriesItem(2, 303, 3),
  ];
  const cardC = makeCard(303, {
    seriesId: 2,
    seriesCount: stackCItems.length,
    seriesItems: stackCItems,
  });

  const newestCards = [cardA, cardB, cardC];
  const oldestCards = [cardC, cardB, cardA];

  it('walks newest-first across stacks, standalone cards, and Inspo photos while skipping hidden steps', () => {
    const filter: InspectorVisibilityFilter = {
      sortBy: 'newest',
      rejectedMode: 'exclude',
      archivedMode: 'exclude',
    };

    const forward = walkAllPhotos(newestCards, cardA.id, 104, 'next', filter);
    assert.deepEqual(forward, [104, 102, 101, 201, 303, 302]);

    const backward = walkAllPhotos(newestCards, cardC.id, 302, 'prev', filter);
    assert.deepEqual(backward, [302, 303, 201, 101, 102, 104]);
  });

  it('walks oldest-first when gallery sortBy is oldest', () => {
    const filter: InspectorVisibilityFilter = {
      sortBy: 'oldest',
      rejectedMode: 'exclude',
      archivedMode: 'exclude',
    };

    const forward = walkAllPhotos(oldestCards, cardC.id, 302, 'next', filter);
    assert.deepEqual(forward, [302, 303, 201, 101, 102, 104]);

    const backward = walkAllPhotos(oldestCards, cardA.id, 104, 'prev', filter);
    assert.deepEqual(backward, [104, 102, 101, 201, 303, 302]);
  });

  it('starts from a middle hearted poster and steps left/right within the stack before crossing cards', () => {
    const filter: InspectorVisibilityFilter = {
      sortBy: 'newest',
      rejectedMode: 'exclude',
      archivedMode: 'exclude',
    };

    // Card A poster is 102 (between 104 and 101 chronologically)
    const fromPoster = resolveInspectorNavigationTargets({
      activeImageId: 102,
      activeSeriesItems: stackAItems,
      cardImageId: cardA.id,
      galleryCards: newestCards,
      filter,
    });

    assert.deepEqual(fromPoster.prevPhoto, {
      type: 'step',
      imageId: 104,
      originalUrl: '/api/images/104/file',
    });
    assert.deepEqual(fromPoster.nextPhoto, {
      type: 'step',
      imageId: 101,
      originalUrl: '/api/images/101/file',
    });
    // Stack jump targets jump directly between collapsed cards
    assert.equal(fromPoster.prevStackCardId, null);
    assert.equal(fromPoster.nextStackCardId, cardB.id);
  });

  it('includes rejected or archived steps when the active gallery filter allows them', () => {
    const includeAll: InspectorVisibilityFilter = {
      sortBy: 'newest',
      rejectedMode: 'include',
      archivedMode: 'include',
    };
    const forwardAll = walkAllPhotos(newestCards, cardA.id, 104, 'next', includeAll);
    assert.deepEqual(forwardAll, [104, 103, 102, 101, 201, 303, 302, 301]);

    const rejectedOnly: InspectorVisibilityFilter = {
      sortBy: 'newest',
      rejectedMode: 'only',
      archivedMode: 'exclude',
    };
    assert.equal(isSeriesItemVisible(stackAItems[2], rejectedOnly), true);
    assert.equal(isSeriesItemVisible(stackAItems[1], rejectedOnly), false);
    assert.deepEqual(
      getOrderedVisibleSeriesItems(stackAItems, rejectedOnly).map((i) => i.imageId),
      [103]
    );
  });

  it('provides stack-jump targets for [ and ] independently of in-stack step position', () => {
    const targets = resolveInspectorNavigationTargets({
      activeImageId: 201,
      activeSeriesItems: [],
      cardImageId: cardB.id,
      galleryCards: newestCards,
    });
    assert.equal(targets.prevStackCardId, cardA.id);
    assert.equal(targets.nextStackCardId, cardC.id);
  });
});

describe('seriesService hidden flags on ImageSeriesItem', () => {
  let ctx: TempDbContext;
  let enrichSingleImageWithSeries: typeof import('../src/server/services/seriesService.ts').enrichSingleImageWithSeries;
  let collapseSeriesInGalleryPool: typeof import('../src/server/services/seriesService.ts').collapseSeriesInGalleryPool;

  before(async () => {
    ctx = await initTempDb('couchy-series-nav-');
    const mod = await import('../src/server/services/seriesService.ts');
    enrichSingleImageWithSeries = mod.enrichSingleImageWithSeries;
    collapseSeriesInGalleryPool = mod.collapseSeriesInGalleryPool;
  });

  after(() => {
    ctx.cleanup();
  });

  it('returns isRejected and isArchived on seriesItems from both enrich and collapse queries', () => {
    const insertImg = ctx.db.prepare(
      `INSERT INTO images (content_hash, relative_path, filename, file_size, width, height, format, file_mtime, is_missing, is_uploaded_reference)
       VALUES (?, ?, ?, 1024, 512, 512, 'png', '2026-01-01T00:00:00.000Z', 0, ?)`
    );
    const id1 = Number(insertImg.run('h1', 's1.png', 's1.png', 1).lastInsertRowid);
    const id2 = Number(insertImg.run('h2', 's2.png', 's2.png', 0).lastInsertRowid);
    const id3 = Number(insertImg.run('h3', 's3.png', 's3.png', 0).lastInsertRowid);

    ctx.db
      .prepare(
        `INSERT INTO ratings (content_hash, rating, is_favorite, is_rejected, is_archived)
         VALUES ('h2', 0, 0, 1, 0), ('h3', 4, 0, 0, 1)`
      )
      .run();

    const seriesId = Number(
      ctx.db
        .prepare(`INSERT INTO image_series (poster_image_id, series_kind) VALUES (?, 'iterative')`)
        .run(id1).lastInsertRowid
    );
    const insertMember = ctx.db.prepare(
      `INSERT INTO image_series_items (series_id, image_id, step_order) VALUES (?, ?, ?)`
    );
    insertMember.run(seriesId, id1, 1);
    insertMember.run(seriesId, id2, 2);
    insertMember.run(seriesId, id3, 3);

    const enriched = enrichSingleImageWithSeries(makeCard(id1, { contentHash: 'h1' }));
    assert.equal(enriched.seriesItems?.length, 3);
    assert.deepEqual(
      enriched.seriesItems?.map((it) => ({
        id: it.imageId,
        inspo: it.isUploadedReference,
        rejected: it.isRejected,
        archived: it.isArchived,
      })),
      [
        { id: id1, inspo: true, rejected: false, archived: false },
        { id: id2, inspo: false, rejected: true, archived: false },
        { id: id3, inspo: false, rejected: false, archived: true },
      ]
    );

    const collapsed = collapseSeriesInGalleryPool([makeCard(id1, { contentHash: 'h1' })]);
    assert.equal(collapsed.length, 1);
    assert.deepEqual(
      collapsed[0].seriesItems?.map((it) => ({
        id: it.imageId,
        rejected: it.isRejected,
        archived: it.isArchived,
      })),
      [
        { id: id1, rejected: false, archived: false },
        { id: id2, rejected: true, archived: false },
        { id: id3, rejected: false, archived: true },
      ]
    );
  });
});
