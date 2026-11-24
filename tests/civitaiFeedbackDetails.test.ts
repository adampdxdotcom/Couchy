import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { initTempDb, type TempDbContext } from './helpers/tempDb.ts';

let ctx: TempDbContext;
let normalizeCivitaiMcpComments: typeof import('../src/server/services/civitai/civitaiMcpClient.ts').normalizeCivitaiMcpComments;
let extractCivitaiPostStats: typeof import('../src/server/services/civitai/civitaiActivitySyncService.ts').extractCivitaiPostStats;
let syncCivitaiActivityForImage: typeof import('../src/server/services/civitai/civitaiActivitySyncService.ts').syncCivitaiActivityForImage;
let summarizeCivitaiDraftRows: typeof import('../src/server/services/civitai/civitaiActivitySyncService.ts').summarizeCivitaiDraftRows;
let evaluateCivitaiShareEligibility: typeof import('../src/server/services/civitai/civitaiShareEligibility.ts').evaluateCivitaiShareEligibility;
let stopCivitaiActivityScheduler: typeof import('../src/server/services/civitai/civitaiActivitySyncService.ts').stopCivitaiActivityScheduler;

describe('Civitai Feedback Details (Heart vs Emoji Breakdown & Image-Tied Comments)', () => {
  before(async () => {
    ctx = await initTempDb('civitai-feedback-details');
    ({ normalizeCivitaiMcpComments } = await import(
      '../src/server/services/civitai/civitaiMcpClient.ts'
    ));
    ({
      extractCivitaiPostStats,
      syncCivitaiActivityForImage,
      summarizeCivitaiDraftRows,
      stopCivitaiActivityScheduler,
    } = await import('../src/server/services/civitai/civitaiActivitySyncService.ts'));
    ({ evaluateCivitaiShareEligibility } = await import(
      '../src/server/services/civitai/civitaiShareEligibility.ts'
    ));
  });

  after(() => {
    stopCivitaiActivityScheduler();
    ctx.cleanup();
  });

  it('normalizes nested MCP comments and strips restricted HTML safely', () => {
    const normalized = normalizeCivitaiMcpComments({
      comments: [
        {
          id: 501,
          content: '<p>Love the lighting!<br>Great skin texture &amp; composition.</p>',
          createdAt: '2026-11-24T10:00:00Z',
          pinned: true,
          user: { username: 'pixel_fan', image: 'https://example.com/u1.jpg' },
          stats: { heartCount: 2, likeCount: 1 },
          replies: [
            {
              id: 502,
              content: '<p>Thanks so much!</p>',
              createdAt: '2026-11-24T10:05:00Z',
              user: { username: 'creator' },
              reactions: [{ reaction: 'Heart', count: 1 }],
            },
          ],
        },
      ],
    });

    assert.equal(normalized.length, 2);
    assert.equal(normalized[0].id, 501);
    assert.equal(normalized[0].isPinned, true);
    assert.equal(normalized[0].heartCount, 2);
    assert.equal(normalized[0].reactionCount, 3);
    assert.equal(normalized[0].content, 'Love the lighting!\nGreat skin texture & composition.');
    assert.equal(normalized[1].id, 502);
    assert.equal(normalized[1].depth, 1);
    assert.equal(normalized[1].parentCommentId, 501);
    assert.equal(normalized[1].heartCount, 1);
  });

  it('separates heart reactions from emoji reactions and ties MCP comments to local stack images', async () => {
    const insertImg = ctx.db.prepare(
      `INSERT INTO images (relative_path, filename, content_hash, width, height, file_size, file_mtime, format)
       VALUES (?, ?, ?, 1024, 1536, 123456, datetime('now'), 'png')`
    );
    const imgA = Number(insertImg.run('out/frame_a.png', 'frame_a.png', 'hash_a').lastInsertRowid);
    const imgB = Number(insertImg.run('out/frame_b.png', 'frame_b.png', 'hash_b').lastInsertRowid);

    const insertDraft = ctx.db.prepare(
      `INSERT INTO image_civitai_drafts
         (image_id, image_content_hash, civitai_post_id, draft_url, title, upload_mode, status, reaction_count, stats_synced_at)
       VALUES (?, ?, 777001, 'https://civitai.com/posts/777001/edit', 'Test Stack', 'original_png', 'published', 6, datetime('now'))`
    );
    insertDraft.run(imgA, 'hash_a');
    insertDraft.run(imgB, 'hash_b');

    const extracted = extractCivitaiPostStats(
      [
        {
          id: 9001,
          stats: { heartCount: 2, likeCount: 3, laughCount: 1, cryCount: 0, commentCount: 0 },
        },
        {
          id: 9002,
          stats: { heartCount: 1, likeCount: 0, laughCount: 0, cryCount: 1, commentCount: 1 },
        },
      ],
      'civitai.com',
      777001
    );
    assert.equal(extracted.reactionBreakdown.heartCount, 3);
    assert.equal(extracted.reactionBreakdown.likeCount, 3);
    assert.equal(extracted.reactionBreakdown.laughCount, 1);
    assert.equal(extracted.reactionBreakdown.cryCount, 1);
    assert.equal(extracted.reactionCount, 8);
    assert.equal(extracted.commentCount, 1);

    // Sync even though stats_synced_at is recent: backfill must trigger because breakdown/comments are missing
    const syncRes = await syncCivitaiActivityForImage(imgA, {
      minIntervalMs: 120_000,
      syncComments: true,
      deps: {
        fetchFn: (async () =>
          new Response(
            JSON.stringify({
              items: [
                {
                  id: 9001,
                  stats: { heartCount: 2, likeCount: 3, laughCount: 1, cryCount: 0, commentCount: 0 },
                },
                {
                  id: 9002,
                  stats: { heartCount: 1, likeCount: 0, laughCount: 0, cryCount: 1, commentCount: 1 },
                },
              ],
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
          )) as typeof fetch,
        listCommentsFn: async ({ entityType, entityId }) => {
          if (entityType === 'image' && entityId === 9002) {
            return [
              {
                id: 801,
                authorUsername: 'alice',
                authorAvatarUrl: null,
                content: 'Frame B looks super sharp!',
                createdAt: '2026-11-24T12:00:00Z',
                reactionCount: 1,
                heartCount: 1,
                parentCommentId: null,
                depth: 0,
                isPinned: false,
              },
            ];
          }
          if (entityType === 'post' && entityId === 777001) {
            return [
              {
                id: 802,
                authorUsername: 'bob',
                authorAvatarUrl: null,
                content: 'Awesome series overall.',
                createdAt: '2026-11-24T12:10:00Z',
                reactionCount: 0,
                heartCount: 0,
                parentCommentId: null,
                depth: 0,
                isPinned: false,
              },
            ];
          }
          return [];
        },
      },
    });

    assert.equal(syncRes.syncedPosts, 1);
    assert.equal(syncRes.changed, true);

    const statusA = await evaluateCivitaiShareEligibility(imgA, { includeStack: false });
    assert.equal(statusA.existingDrafts.length, 1);
    const draftA = statusA.existingDrafts[0];
    assert.equal(draftA.civitaiImageId, 9001);
    assert.deepEqual(draftA.reactionBreakdown, {
      heartCount: 3,
      likeCount: 3,
      laughCount: 1,
      cryCount: 1,
    });
    // Both image-level (from frame B) and post-level comments are included, with frame B tied to imgB
    assert.equal(draftA.commentCount, 2);
    assert.equal(draftA.comments.length, 2);

    const frameComment = draftA.comments.find((c) => c.id === 801);
    assert.ok(frameComment);
    assert.equal(frameComment.targetType, 'image');
    assert.equal(frameComment.civitaiImageId, 9002);
    assert.equal(frameComment.localImageId, imgB);
    assert.equal(frameComment.localFilename, 'frame_b.png');
    assert.equal(frameComment.localThumbnailUrl, `/api/images/${imgB}/thumbnail`);

    const postComment = draftA.comments.find((c) => c.id === 802);
    assert.ok(postComment);
    assert.equal(postComment.targetType, 'post');
    assert.equal(postComment.localImageId, null);

    const rowsA = ctx.db
      .prepare('SELECT * FROM image_civitai_drafts WHERE image_id = ?')
      .all(imgA) as any[];
    const summaryA = summarizeCivitaiDraftRows(rowsA);
    assert.deepEqual(summaryA?.reactionBreakdown, {
      heartCount: 3,
      likeCount: 3,
      laughCount: 1,
      cryCount: 1,
    });
  });
});
