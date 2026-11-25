import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { initTempDb, type TempDbContext } from './helpers/tempDb.ts';

let ctx: TempDbContext;
let db: typeof import('../src/server/db.ts').db;
let getActiveGhostItems: typeof import('../src/server/services/liveMonitor/ghostCardAggregator.ts').getActiveGhostItems;
let liveMonitorState: typeof import('../src/server/services/liveMonitor/liveMonitorState.ts').liveMonitorState;
let markPromptSubmitted: typeof import('../src/server/services/liveMonitor/liveMonitorState.ts').markPromptSubmitted;

function resetLiveMonitorState() {
  liveMonitorState.online = true;
  liveMonitorState.runningCount = 0;
  liveMonitorState.queuedCount = 0;
  liveMonitorState.lastQueueFetchMs = Date.now();
  liveMonitorState.runningPromptIds.clear();
  liveMonitorState.pendingPromptIds.clear();
  liveMonitorState.finishedPromptIds.clear();
  liveMonitorState.promptProgressMap.clear();
  liveMonitorState.recentlySubmittedPromptIds.clear();
  liveMonitorState.cancelledPromptIds.clear();
  liveMonitorState.cancelledBatchIds.clear();
}

before(async () => {
  ctx = await initTempDb('couchy-ghost-orphan-filter-test');
  ({ db } = await import('../src/server/db.ts'));
  ({ getActiveGhostItems } = await import(
    '../src/server/services/liveMonitor/ghostCardAggregator.ts'
  ));
  ({ liveMonitorState, markPromptSubmitted } = await import(
    '../src/server/services/liveMonitor/liveMonitorState.ts'
  ));
});

after(() => {
  resetLiveMonitorState();
  ctx?.cleanup();
});

describe('Ghost card per-prompt staleness & zombie resurrection prevention', () => {
  it('never resurrects orphaned generation_items or reproduction_jobs on other stacks when a new job runs', () => {
    resetLiveMonitorState();

    // Seed two stacks (images + series)
    const imgA = Number(
      db
        .prepare(
          `INSERT INTO images (filename, relative_path, file_size, file_mtime, content_hash, width, height, is_missing)
           VALUES ('stack_a.png', 'stack_a.png', 1000, '2026-05-01T10:00:00.000Z', 'hash_a', 1024, 1024, 0)`
        )
        .run().lastInsertRowid
    );
    const imgB = Number(
      db
        .prepare(
          `INSERT INTO images (filename, relative_path, file_size, file_mtime, content_hash, width, height, is_missing)
           VALUES ('stack_b.png', 'stack_b.png', 1000, '2026-05-01T10:01:00.000Z', 'hash_b', 1024, 1024, 0)`
        )
        .run().lastInsertRowid
    );
    const seriesA = Number(
      db.prepare(`INSERT INTO image_series (poster_image_id) VALUES (?)`).run(imgA).lastInsertRowid
    );
    const seriesB = Number(
      db.prepare(`INSERT INTO image_series (poster_image_id) VALUES (?)`).run(imgB).lastInsertRowid
    );
    db.prepare(`INSERT INTO image_series_items (series_id, image_id, step_order) VALUES (?, ?, 0)`).run(
      seriesA,
      imgA
    );
    db.prepare(`INSERT INTO image_series_items (series_id, image_id, step_order) VALUES (?, ?, 0)`).run(
      seriesB,
      imgB
    );

    const wfId = Number(
      db
        .prepare(
          `INSERT INTO workflows (name, api_workflow_json, workflow_hash) VALUES ('Test WF', '{}', 'wf-hash-1')`
        )
        .run().lastInsertRowid
    );

    // 1) Orphaned generation batch from 5 minutes ago on Stack A (no longer in ComfyUI /queue)
    const orphanBatchId = Number(
      db
        .prepare(
          `INSERT INTO generation_batches (workflow_id, total_count, series_id, width, height)
           VALUES (?, 1, ?, 1024, 1024)`
        )
        .run(wfId, seriesA).lastInsertRowid
    );
    db.prepare(
      `INSERT INTO generation_items (batch_id, item_index, prompt, seed, comfyui_prompt_id, status, created_at)
       VALUES (?, 1, 'old orphaned prompt', '1001', 'pid-orphan-a', 'submitted', datetime('now', '-5 minutes'))`
    ).run(orphanBatchId);

    // 2) Orphaned reproduction_jobs row from 6 minutes ago on Stack A (no longer in ComfyUI /queue)
    db.prepare(
      `INSERT INTO reproduction_jobs (source_image_id, workflow_id, comfyui_prompt_id, status, submitted_at)
       VALUES (?, ?, 'pid-orphan-repro', 'running', datetime('now', '-6 minutes'))`
    ).run(imgA, wfId);

    // 3) One genuinely active generation running right now on Stack B
    const activeBatchId = Number(
      db
        .prepare(
          `INSERT INTO generation_batches (workflow_id, total_count, series_id, width, height)
           VALUES (?, 1, ?, 1024, 1024)`
        )
        .run(wfId, seriesB).lastInsertRowid
    );
    db.prepare(
      `INSERT INTO generation_items (batch_id, item_index, prompt, seed, comfyui_prompt_id, status, created_at)
       VALUES (?, 1, 'real active prompt', '1002', 'pid-active-b', 'submitted', datetime('now', '-2 seconds'))`
    ).run(activeBatchId);

    liveMonitorState.runningCount = 1;
    liveMonitorState.runningPromptIds.add('pid-active-b');
    liveMonitorState.promptProgressMap.set('pid-active-b', 35);

    const ghosts = getActiveGhostItems();
    assert.equal(ghosts.length, 1);
    assert.equal(ghosts[0].comfyuiPromptId, 'pid-active-b');
    assert.equal(ghosts[0].targetSeriesId, seriesB);
    assert.equal(ghosts[0].state, 'generating');
    assert.equal(ghosts[0].progressPercent, 35);
  });

  it('keeps a freshly submitted Pass-2 upscale visible during the submit grace window even if created_at is older', () => {
    resetLiveMonitorState();

    const wfId = Number(
      db
        .prepare(
          `INSERT INTO workflows (name, api_workflow_json, workflow_hash) VALUES ('Upscale WF', '{}', 'wf-hash-2')`
        )
        .run().lastInsertRowid
    );
    const batchId = Number(
      db
        .prepare(`INSERT INTO generation_batches (workflow_id, total_count, width, height) VALUES (?, 1, 1024, 1024)`)
        .run(wfId).lastInsertRowid
    );
    db.prepare(
      `INSERT INTO generation_items (batch_id, item_index, prompt, seed, comfyui_prompt_id, status, created_at)
       VALUES (?, 1, 'pass 2 upscale', '1003', 'pid-pass2-fresh', 'submitted', datetime('now', '-2 minutes'))`
    ).run(batchId);

    // Mark freshly submitted; lastQueueFetchMs is populated so we test the grace window explicitly
    markPromptSubmitted('pid-pass2-fresh');
    liveMonitorState.lastQueueFetchMs = Date.now();
    liveMonitorState.runningCount = 1;

    const ghosts = getActiveGhostItems();
    assert.equal(ghosts.some((g) => g.comfyuiPromptId === 'pid-pass2-fresh'), true);
  });
});
