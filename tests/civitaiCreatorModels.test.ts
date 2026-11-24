import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { initTempDb, type TempDbContext } from './helpers/tempDb.ts';

let ctx: TempDbContext;
let parseCivitaiLinkInput: typeof import('../src/server/services/civitai/civitaiModelStatsHelper.ts').parseCivitaiLinkInput;
let extractCivitaiModelStats: typeof import('../src/server/services/civitai/civitaiModelStatsHelper.ts').extractCivitaiModelStats;
let extractCivitaiCreatorUsername: typeof import('../src/server/services/civitai/civitaiModelStatsHelper.ts').extractCivitaiCreatorUsername;
let autoMatchOwnCivitaiUploads: typeof import('../src/server/services/civitai/civitaiCreatorModelsService.ts').autoMatchOwnCivitaiUploads;
let listMyCivitaiUploads: typeof import('../src/server/services/civitai/civitaiCreatorModelsService.ts').listMyCivitaiUploads;
let syncLinkedModelsCivitaiStats: typeof import('../src/server/services/civitai/civitaiCreatorModelsService.ts').syncLinkedModelsCivitaiStats;
let fetchAndEnrichModelFromCivitai: typeof import('../src/server/services/civitai/civitaiModelEnrichmentService.ts').fetchAndEnrichModelFromCivitai;
let listLoraExplorerItems: typeof import('../src/server/services/galleryQueryService.ts').listLoraExplorerItems;
let syncAllCivitaiShareActivity: typeof import('../src/server/services/civitai/civitaiActivitySyncService.ts').syncAllCivitaiShareActivity;
let stopCivitaiActivityScheduler: typeof import('../src/server/services/civitai/civitaiActivitySyncService.ts').stopCivitaiActivityScheduler;

describe('Civitai Creator Auto-Match, Upload Stats, Manual Linking & Model Comments', () => {
  before(async () => {
    ctx = await initTempDb('civitai-creator-models');
    ({
      parseCivitaiLinkInput,
      extractCivitaiModelStats,
      extractCivitaiCreatorUsername,
    } = await import('../src/server/services/civitai/civitaiModelStatsHelper.ts'));
    ({
      autoMatchOwnCivitaiUploads,
      listMyCivitaiUploads,
      syncLinkedModelsCivitaiStats,
    } = await import('../src/server/services/civitai/civitaiCreatorModelsService.ts'));
    ({ fetchAndEnrichModelFromCivitai } = await import(
      '../src/server/services/civitai/civitaiModelEnrichmentService.ts'
    ));
    ({ listLoraExplorerItems } = await import('../src/server/services/galleryQueryService.ts'));
    ({ syncAllCivitaiShareActivity, stopCivitaiActivityScheduler } = await import(
      '../src/server/services/civitai/civitaiActivitySyncService.ts'
    ));
  });

  after(() => {
    stopCivitaiActivityScheduler();
    ctx.cleanup();
  });

  it('parses bare Version IDs, civitai.com URLs, and civitai.red URLs accurately', () => {
    const bare = parseCivitaiLinkInput('987654');
    assert.equal(bare.versionId, '987654');
    assert.equal(bare.isBareNumeric, true);

    const redUrl = parseCivitaiLinkInput(
      'https://civitai.red/models/12345/my-lora?modelVersionId=67890'
    );
    assert.equal(redUrl.modelId, '12345');
    assert.equal(redUrl.versionId, '67890');
    assert.equal(redUrl.domain, 'civitai.red');
    assert.equal(redUrl.isBareNumeric, false);

    const dlUrl = parseCivitaiLinkInput('https://civitai.com/api/download/models/444555');
    assert.equal(dlUrl.versionId, '444555');
    assert.equal(dlUrl.domain, 'civitai.com');
  });

  it('extracts model + version stats including Buzz tipped and creator username', () => {
    const mockModel = {
      id: 1001,
      creator: { username: 'AdamCreator' },
      stats: {
        downloadCount: 2540,
        thumbsUpCount: 312,
        thumbsDownCount: 4,
        commentCount: 19,
        tippedAmountCount: 4200,
      },
      modelVersions: [{ id: 2001 }, { id: 2002 }],
    };
    const mockVersion = {
      id: 2002,
      name: 'v2.0',
      stats: { downloadCount: 910, thumbsUpCount: 140, thumbsDownCount: 1 },
    };

    assert.equal(extractCivitaiCreatorUsername(mockModel, mockVersion), 'AdamCreator');
    const summary = extractCivitaiModelStats(mockModel, mockVersion);
    assert.equal(summary.downloadCount, 2540);
    assert.equal(summary.tippedAmountCount, 4200);
    assert.equal(summary.commentCount, 19);
    assert.equal(summary.totalVersionsCount, 2);
    assert.equal(summary.matchedVersion?.versionId, '2002');
    assert.equal(summary.matchedVersion?.downloadCount, 910);
  });

  it('auto-matches own Civitai uploads by hash, flags creator, and propagates to characters', async () => {
    const loraInsert = ctx.db
      .prepare(
        `INSERT INTO models (name, filename, model_type, sha256_hash, autov2_hash, is_installed)
         VALUES ('My Character Lora', 'my_char_v1.safetensors', 'lora', 'AABBCCDD11223344', 'AABBCCDD11', 1)`
      )
      .run();
    const modelId = Number(loraInsert.lastInsertRowid);

    const charInsert = ctx.db
      .prepare(`INSERT INTO characters (name) VALUES ('Alek')`)
      .run();
    ctx.db
      .prepare(
        `INSERT INTO character_loras (character_id, lora_name, appearance_label, trigger_word)
         VALUES (?, 'my_char_v1.safetensors', 'Default', '')`
      )
      .run(Number(charInsert.lastInsertRowid));

    const mockFetch: typeof fetch = async (input) => {
      const url = String(input);
      if (url.includes('civitai.com/api/v1/models?username=AdamCreator')) {
        return new Response(
          JSON.stringify({
            items: [
              {
                id: 777,
                name: 'Alek Realistic',
                type: 'LORA',
                description: '<p>Trained on studio portraits.</p>',
                creator: { username: 'AdamCreator' },
                stats: {
                  downloadCount: 850,
                  thumbsUpCount: 95,
                  thumbsDownCount: 0,
                  commentCount: 3,
                  tippedAmountCount: 1500,
                },
                modelVersions: [
                  {
                    id: 888,
                    modelId: 777,
                    name: 'v1.0',
                    baseModel: 'Flux.1 D',
                    trainedWords: ['ohwx_alek'],
                    stats: { downloadCount: 850, thumbsUpCount: 95, thumbsDownCount: 0 },
                    files: [
                      {
                        name: 'my_char_v1.safetensors',
                        hashes: { SHA256: 'aabbccdd11223344', AutoV2: 'AABBCCDD11' },
                      },
                    ],
                  },
                ],
              },
            ],
            metadata: {},
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      return new Response(JSON.stringify({ items: [], metadata: {} }), { status: 200 });
    };

    const res = await autoMatchOwnCivitaiUploads({
      deps: {
        apiKey: 'test-key',
        fetchFn: mockFetch,
        whoAmIFn: async () => ({ username: 'AdamCreator' }),
      },
    });

    assert.equal(res.username, 'AdamCreator');
    assert.equal(res.newlyLinkedCount, 1);

    const updatedRow = ctx.db.prepare(`SELECT * FROM models WHERE id = ?`).get(modelId) as any;
    assert.equal(updatedRow.civitai_id, '777');
    assert.equal(updatedRow.civitai_version_id, '888');
    assert.equal(updatedRow.is_own_civitai_upload, 1);
    assert.equal(updatedRow.civitai_creator_username, 'AdamCreator');
    assert.equal(updatedRow.trigger_word, 'ohwx_alek');

    const charLora = ctx.db
      .prepare(`SELECT model_id, trigger_word FROM character_loras WHERE lora_name = 'my_char_v1.safetensors'`)
      .get() as any;
    assert.equal(charLora.model_id, modelId);
    assert.equal(charLora.trigger_word, 'ohwx_alek');

    const uploadsList = await listMyCivitaiUploads({
      forceRefresh: true,
      deps: {
        apiKey: 'test-key',
        fetchFn: mockFetch,
        whoAmIFn: async () => ({ username: 'AdamCreator' }),
      },
    });
    assert.equal(uploadsList.items.length, 1);
    assert.equal(uploadsList.items[0].versions[0].alreadyLinkedModelId, modelId);
  });

  it('manually links by Version ID when local hash differs, syncs MCP comments, and surfaces in LoRA Explorer', async () => {
    const insertRes = ctx.db
      .prepare(
        `INSERT INTO models (name, filename, model_type, sha256_hash, autov2_hash, user_notes, is_installed)
         VALUES ('Resaved Variant', 'resaved_fp8.safetensors', 'lora', 'DIFFERENTHASH', 'DIFF123456', 'Keep my notes', 1)`
      )
      .run();
    const modelId = Number(insertRes.lastInsertRowid);

    const mockFetch: typeof fetch = async (input) => {
      const url = String(input);
      if (url.includes('/api/v1/model-versions/55502')) {
        return new Response(
          JSON.stringify({
            id: 55502,
            modelId: 55500,
            name: 'V2 fp8',
            baseModel: 'SDXL 1.0',
            trainedWords: ['cyber_suit'],
            stats: { downloadCount: 410, thumbsUpCount: 52, thumbsDownCount: 2 },
          }),
          { status: 200 }
        );
      }
      if (url.includes('/api/v1/models/55500')) {
        return new Response(
          JSON.stringify({
            id: 55500,
            name: 'Cyber Suit LoRA',
            description: '<p>Full armor detail LoRA.</p>',
            creator: { username: 'CommunityMaker' },
            stats: {
              downloadCount: 1200,
              thumbsUpCount: 160,
              thumbsDownCount: 3,
              commentCount: 1,
              tippedAmountCount: 500,
            },
            modelVersions: [{ id: 55501 }, { id: 55502 }],
          }),
          { status: 200 }
        );
      }
      return new Response('Not Found', { status: 404 });
    };

    const linkResult = await fetchAndEnrichModelFromCivitai(modelId, {
      explicitLinkInput: '55502',
      ownUsername: 'AdamCreator',
      fetchFn: mockFetch,
      listCommentsFn: async ({ entityType, entityId }) => {
        assert.equal(entityType, 'model');
        assert.equal(entityId, 55500);
        return [
          {
            id: 901,
            authorUsername: 'fan_one',
            authorAvatarUrl: null,
            content: 'Works great at 0.85 weight!',
            createdAt: '2026-11-24T12:00:00Z',
            reactionCount: 4,
            heartCount: 2,
            parentCommentId: null,
            depth: 0,
            isPinned: true,
          },
        ];
      },
    });

    assert.equal(linkResult.meta.civitaiVersionId, '55502');
    assert.equal(linkResult.isOwnUpload, false);
    assert.equal(linkResult.creatorUsername, 'CommunityMaker');

    const explorerItems = listLoraExplorerItems();
    const matched = explorerItems.find((item) => item.modelId === modelId);
    assert.ok(matched);
    assert.equal(matched.userNotes, 'Keep my notes');
    assert.equal(matched.civitaiStats?.downloadCount, 1200);
    assert.equal(matched.civitaiStats?.tippedAmountCount, 500);
    assert.equal(matched.civitaiStats?.matchedVersion?.versionName, 'V2 fp8');
    assert.equal(matched.civitaiComments?.length, 1);
    assert.equal(matched.civitaiComments?.[0].content, 'Works great at 0.85 weight!');

    // Verify 15-minute scheduler skips models when notifications switch is OFF, and runs when ON
    ctx.db
      .prepare(
        `INSERT INTO app_settings (key, value, updated_at)
         VALUES ('civitai_activity_notifications_enabled', '0', datetime('now'))
         ON CONFLICT(key) DO UPDATE SET value = '0'`
      )
      .run();

    const offRes = await syncAllCivitaiShareActivity({
      minIntervalMs: 0,
      includeModels: true,
      deps: { fetchFn: mockFetch },
    });
    assert.equal(offRes.checkedModels, 0);

    // Direct single-model refresh still refreshes stats cleanly
    const directRes = await syncLinkedModelsCivitaiStats({
      onlyModelId: modelId,
      minIntervalMs: 0,
      deps: { fetchFn: mockFetch, apiKey: 'test-key', listCommentsFn: async () => [] },
    });
    assert.equal(directRes.checkedModels, 1);
    assert.equal(directRes.latestStats?.downloadCount, 1200);
  });
});
