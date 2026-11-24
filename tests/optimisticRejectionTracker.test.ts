import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { OptimisticRejectionTracker } from '../src/hooks/optimisticRejectionTracker.ts';
import type { ImageRecord } from '../src/shared/types.ts';

function makeImage(id: number, isRejected = false): ImageRecord {
  return {
    id,
    contentHash: `hash-${id}`,
    relativePath: `img_${id}.png`,
    filename: `img_${id}.png`,
    fileSize: 1024,
    width: 512,
    height: 512,
    format: 'png',
    createdAt: '2026-01-01T00:00:00.000Z',
    fileMtime: '2026-01-01T00:00:00.000Z',
    isMissing: false,
    thumbnailUrl: `/api/images/${id}/thumbnail`,
    originalUrl: `/api/images/${id}/file`,
    dependencyStatus: 'exact_match',
    rating: 0,
    isFavorite: false,
    isRejected,
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
  };
}

describe('OptimisticRejectionTracker', () => {
  it('prevents an older in-flight query from resurrecting a just-rejected image', () => {
    const tracker = new OptimisticRejectionTracker();

    // Background query starts BEFORE the user rejects image 2
    const staleQuery = tracker.beginQuery();

    // User clicks reject -> PATCH starts, then finishes before the stale query resolves
    const token = tracker.beginMutation(2, true);
    tracker.settleMutation(2, token, true);

    // Stale query resolves with pre-PATCH state (image 2 still isRejected: false)
    const stalePayload = [makeImage(1, false), makeImage(2, false), makeImage(3, false)];
    const reconciledAll = tracker.reconcileAllImages(stalePayload, staleQuery.startEpoch);
    const reconciledFiltered = tracker.reconcileFilteredImages(
      stalePayload,
      staleQuery.startEpoch,
      'exclude'
    );
    tracker.endQuery(staleQuery.queryId);

    assert.equal(reconciledAll.find((i) => i.id === 2)?.isRejected, true);
    assert.deepEqual(
      reconciledFiltered.map((i) => i.id),
      [1, 3]
    );

    // A subsequent query started AFTER settle sees server truth cleanly
    const freshQuery = tracker.beginQuery();
    const freshPayload = [makeImage(1, false), makeImage(2, false), makeImage(3, false)];
    const freshFiltered = tracker.reconcileFilteredImages(
      freshPayload,
      freshQuery.startEpoch,
      'exclude'
    );
    tracker.endQuery(freshQuery.queryId);
    assert.deepEqual(
      freshFiltered.map((i) => i.id),
      [1, 2, 3]
    );
  });

  it('keeps optimistic rejection applied to queries started while PATCH is still in flight', () => {
    const tracker = new OptimisticRejectionTracker();
    const token = tracker.beginMutation(5, true);

    const concurrentQuery = tracker.beginQuery();
    const payload = [makeImage(4, false), makeImage(5, false)];

    const reconciledAll = tracker.reconcileAllImages(payload, concurrentQuery.startEpoch);
    const reconciledOnly = tracker.reconcileFilteredImages(
      payload,
      concurrentQuery.startEpoch,
      'only'
    );
    const reconciledExcluded = tracker.reconcileFilteredImages(
      payload,
      concurrentQuery.startEpoch,
      'exclude'
    );

    assert.equal(reconciledAll.find((i) => i.id === 5)?.isRejected, true);
    assert.equal(reconciledOnly.find((i) => i.id === 5)?.isRejected, true);
    assert.deepEqual(
      reconciledExcluded.map((i) => i.id),
      [4]
    );

    tracker.endQuery(concurrentQuery.queryId);
    tracker.settleMutation(5, token, true);
  });

  it('ignores stale settlement tokens when reject is immediately followed by restore', () => {
    const tracker = new OptimisticRejectionTracker();
    const rejectToken = tracker.beginMutation(7, true);
    const restoreToken = tracker.beginMutation(7, false);

    // Older reject PATCH settles first -> must not overwrite newer restore state
    tracker.settleMutation(7, rejectToken, true);

    const query = tracker.beginQuery();
    const payload = [makeImage(7, true)];
    const reconciledExcluded = tracker.reconcileFilteredImages(
      payload,
      query.startEpoch,
      'exclude'
    );
    const reconciledOnly = tracker.reconcileFilteredImages(payload, query.startEpoch, 'only');

    assert.equal(reconciledExcluded.length, 1);
    assert.equal(reconciledExcluded[0].isRejected, false);
    assert.equal(reconciledOnly.length, 0);

    tracker.endQuery(query.queryId);
    tracker.settleMutation(7, restoreToken, true);
  });

  it('clears pending override when the PATCH request fails', () => {
    const tracker = new OptimisticRejectionTracker();
    const query = tracker.beginQuery();
    const token = tracker.beginMutation(9, true);
    tracker.settleMutation(9, token, false);

    const reconciled = tracker.reconcileFilteredImages(
      [makeImage(9, false)],
      query.startEpoch,
      'exclude'
    );
    tracker.endQuery(query.queryId);

    assert.deepEqual(
      reconciled.map((i) => i.id),
      [9]
    );
  });
});
