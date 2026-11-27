import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { initTempDb, type TempDbContext } from './helpers/tempDb.ts';

let ctx: TempDbContext;
let getCivitaiUserProfile: typeof import('../src/server/services/civitai/civitaiUserProfileService.ts').getCivitaiUserProfile;
let clearCivitaiUserProfileCache: typeof import('../src/server/services/civitai/civitaiUserProfileService.ts').clearCivitaiUserProfileCache;

function makeJsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

before(async () => {
  ctx = await initTempDb('couchy-civitai-profile-test');
  ({ getCivitaiUserProfile, clearCivitaiUserProfileCache } = await import(
    '../src/server/services/civitai/civitaiUserProfileService.ts'
  ));

  // Seed local Couchy entities to verify couchySummary counts
  ctx.db
    .prepare(`INSERT INTO characters (name, allow_civitai_share) VALUES ('Elena', 1), ('Marcus', 0), ('Vesper', 1)`)
    .run();

  const img1 = Number(
    ctx.db
      .prepare(
        `INSERT INTO images
          (content_hash, relative_path, filename, file_size, width, height, format, file_mtime, is_missing, is_uploaded_reference)
         VALUES ('hash-1', 'a.png', 'a.png', 1024, 512, 512, 'png', '2026-11-01T00:00:00Z', 0, 0)`
      )
      .run().lastInsertRowid
  );
  const img2 = Number(
    ctx.db
      .prepare(
        `INSERT INTO images
          (content_hash, relative_path, filename, file_size, width, height, format, file_mtime, is_missing, is_uploaded_reference)
         VALUES ('hash-2', 'b.png', 'b.png', 1024, 512, 512, 'png', '2026-11-02T00:00:00Z', 0, 0)`
      )
      .run().lastInsertRowid
  );

  ctx.db
    .prepare(
      `INSERT INTO image_civitai_drafts
        (image_id, image_content_hash, civitai_post_id, draft_url, title, status)
       VALUES
        (?, 'hash-1', 101, 'https://civitai.com/posts/101/edit', 'Draft One', 'draft'),
        (?, 'hash-2', 102, 'https://civitai.com/posts/102', 'Published One', 'published')`
    )
    .run(img1, img2);

  ctx.db
    .prepare(
      `INSERT INTO models (name, filename, model_type, is_own_civitai_upload)
       VALUES ('My Custom LoRA', 'my_lora.safetensors', 'lora', 1),
              ('Third Party LoRA', 'other.safetensors', 'lora', 0)`
    )
    .run();
});

after(() => {
  clearCivitaiUserProfileCache();
  ctx.cleanup();
});

describe('getCivitaiUserProfile', () => {
  it('returns disconnected state with local Couchy summary when API key is missing', async () => {
    const profile = await getCivitaiUserProfile({
      forceRefresh: true,
      deps: { apiKey: '' },
    });

    assert.equal(profile.hasCivitaiKey, false);
    assert.equal(profile.connected, false);
    assert.equal(profile.username, null);
    assert.deepEqual(profile.badges, []);
    assert.deepEqual(profile.couchySummary, {
      eligibleCharacterCount: 2,
      totalCharacterCount: 3,
      sharedDraftCount: 1,
      publishedPostCount: 1,
      ownUploadedModelsCount: 1,
    });
  });

  it('aggregates MCP whoami, REST /api/v1/me, and tRPC profile with badges, safe links, and stats', async () => {
    const mockFetch: typeof fetch = async (input) => {
      const url = String(input);
      if (url === 'https://civitai.com/api/v1/me') {
        return makeJsonResponse({
          id: 4242,
          username: 'StudioArtist',
          tier: 'gold',
          status: 'Active',
          isMember: true,
          subscriptions: ['supporter', 'gold'],
        });
      }
      if (url.includes('/api/trpc/userProfile.get')) {
        return makeJsonResponse({
          result: {
            data: {
              json: {
                id: 4242,
                username: 'StudioArtist',
                createdAt: '2024-03-15T12:00:00.000Z',
                profilePicture: { url: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890' },
                profile: {
                  bio: '<p>Editorial <b>portrait</b> &amp; LoRA creator.<br/>ComfyUI daily.</p>',
                  location: 'Portland, OR',
                  coverImage: { url: 'https://image.civitai.com/cover-banner.jpeg' },
                },
                cosmetics: [
                  {
                    cosmetic: {
                      id: 77,
                      type: 'Badge',
                      name: 'Gold Supporter',
                      description: '<p>Awarded to <em>Gold</em> members</p>',
                      data: { url: 'badgeuuid12345678', animated: true },
                    },
                  },
                  {
                    cosmetic: {
                      id: 88,
                      type: 'NamePlate',
                      name: 'Amber Glow',
                      data: { color: '#f59e0b' },
                    },
                  },
                ],
                links: [
                  { type: 'Social', url: 'https://x.com/studioartist' },
                  { type: 'Website', url: 'javascript:alert(1)' },
                  { type: 'Website', url: 'data:text/html,bad' },
                ],
                stats: {
                  uploadCountAllTime: 14,
                  followerCountAllTime: 1250,
                  followingCountAllTime: 40,
                  downloadCountAllTime: 98500,
                  thumbsUpCountAllTime: 4320,
                  generationCountAllTime: 890,
                  tippedAmountCountAllTime: 15000,
                },
                rank: {
                  leaderboardRank: 19,
                  leaderboardId: 'overall',
                },
              },
            },
          },
        });
      }
      if (url.includes('/api/trpc/user.getCreator')) {
        return makeJsonResponse({ result: { data: { json: null } } });
      }
      return makeJsonResponse({}, 404);
    };

    const profile = await getCivitaiUserProfile({
      forceRefresh: true,
      deps: {
        apiKey: 'test-civitai-api-key',
        fetchFn: mockFetch,
        whoamiFn: async () => ({
          userId: 4242,
          username: 'StudioArtist',
          tier: 'gold',
          muted: false,
          isOnboarded: true,
          isModerator: false,
        }),
      },
    });

    assert.equal(profile.hasCivitaiKey, true);
    assert.equal(profile.connected, true);
    assert.equal(profile.error, null);
    assert.equal(profile.userId, 4242);
    assert.equal(profile.username, 'StudioArtist');
    assert.equal(profile.tier, 'gold');
    assert.equal(profile.status, 'Active');
    assert.equal(profile.isMember, true);
    assert.deepEqual(profile.subscriptions, ['supporter', 'gold']);
    assert.equal(profile.isOnboarded, true);
    assert.equal(profile.location, 'Portland, OR');
    assert.equal(profile.bio, 'Editorial portrait & LoRA creator.\nComfyUI daily.');
    assert.equal(
      profile.avatarUrl,
      'https://image.civitai.com/xG1nkqKTMzGDvpLrqFT7WA/a1b2c3d4-e5f6-7890-abcd-ef1234567890/width=450/a1b2c3d4-e5f6-7890-abcd-ef1234567890.jpeg'
    );
    assert.equal(profile.coverImageUrl, 'https://image.civitai.com/cover-banner.jpeg');
    assert.deepEqual(profile.nameplate, { name: 'Amber Glow', color: '#f59e0b' });

    assert.equal(profile.badges.length, 1);
    assert.equal(profile.badges[0].name, 'Gold Supporter');
    assert.equal(profile.badges[0].description, 'Awarded to Gold members');
    assert.equal(profile.badges[0].animated, true);
    assert.equal(
      profile.badges[0].imageUrl,
      'https://image.civitai.com/xG1nkqKTMzGDvpLrqFT7WA/badgeuuid12345678/original=true/badgeuuid12345678'
    );

    // Unsafe javascript:/data: links must be filtered out
    assert.deepEqual(profile.links, [{ type: 'Social', url: 'https://x.com/studioartist' }]);

    assert.deepEqual(profile.stats, {
      uploadCount: 14,
      followerCount: 1250,
      followingCount: 40,
      downloadCount: 98500,
      thumbsUpCount: 4320,
      generationCount: 890,
      tippedAmountCount: 15000,
      leaderboardPosition: 19,
      leaderboardId: 'overall',
    });
    assert.equal(profile.profileUrl, 'https://civitai.com/user/StudioArtist');
  });

  it('degrades gracefully when tRPC enrichment fails while MCP + REST succeed', async () => {
    const mockFetch: typeof fetch = async (input) => {
      const url = String(input);
      if (url === 'https://civitai.com/api/v1/me') {
        return makeJsonResponse({
          id: 99,
          username: 'FallbackUser',
          tier: 'bronze',
          status: 'Active',
          isMember: true,
        });
      }
      return makeJsonResponse({ error: 'Upstream unavailable' }, 503);
    };

    const profile = await getCivitaiUserProfile({
      forceRefresh: true,
      deps: {
        apiKey: 'test-civitai-api-key',
        fetchFn: mockFetch,
        whoamiFn: async () => ({
          userId: 99,
          username: 'FallbackUser',
          tier: 'bronze',
          muted: false,
          isOnboarded: true,
          isModerator: true,
        }),
      },
    });

    assert.equal(profile.connected, true);
    assert.equal(profile.username, 'FallbackUser');
    assert.equal(profile.tier, 'bronze');
    assert.equal(profile.isModerator, true);
    assert.deepEqual(profile.badges, []);
    assert.equal(profile.avatarUrl, null);
    assert.equal(profile.couchySummary.eligibleCharacterCount, 2);
  });

  it('reports unreachable error cleanly when all Civitai endpoints fail', async () => {
    const mockFetch: typeof fetch = async () => {
      throw new Error('ECONNREFUSED');
    };

    const profile = await getCivitaiUserProfile({
      forceRefresh: true,
      deps: {
        apiKey: 'test-civitai-api-key',
        fetchFn: mockFetch,
        whoamiFn: async () => {
          throw new Error('MCP unreachable');
        },
      },
    });

    assert.equal(profile.hasCivitaiKey, true);
    assert.equal(profile.connected, false);
    assert.ok(profile.error && profile.error.includes('Could not reach Civitai'));
  });

  it('computes eligibleCharacterStats with Option A LoRA scoping, deduplication, and Downloads -> Reactions sorting', async () => {
    // Seed 3 eligible characters with distinct download / reaction profiles:
    // - Lyra: own Civitai LoRA (2 versions sharing civitai_id=500 -> 1500 downloads deduplicated, 90 thumbsUp)
    //         + a popular 3rd-party style LoRA (99,000 downloads) that MUST be ignored under Option A
    // - Nova: no own upload, falls back to character-category LoRA (400 downloads, 25 thumbsUp) + 30 photo reactions
    // - Kira: no LoRA downloads, 220 cumulative photo reactions across 2 published posts (with duplicate post_id row)
    const lyraId = Number(
      ctx.db
        .prepare(`INSERT INTO characters (name, allow_civitai_share) VALUES ('Lyra', 1)`)
        .run().lastInsertRowid
    );
    const novaId = Number(
      ctx.db
        .prepare(`INSERT INTO characters (name, allow_civitai_share) VALUES ('Nova', 1)`)
        .run().lastInsertRowid
    );
    const kiraId = Number(
      ctx.db
        .prepare(`INSERT INTO characters (name, allow_civitai_share) VALUES ('Kira', 1)`)
        .run().lastInsertRowid
    );

    const ownV1Id = Number(
      ctx.db
        .prepare(
          `INSERT INTO models (name, filename, model_type, lora_category, civitai_id, is_own_civitai_upload, civitai_stats_json)
           VALUES ('Lyra v1', 'lyra_v1.safetensors', 'lora', 'character', '500', 1, ?)`
        )
        .run(JSON.stringify({ downloadCount: 1500, thumbsUpCount: 90, thumbsDownCount: 2 }))
        .lastInsertRowid
    );
    const ownV2Id = Number(
      ctx.db
        .prepare(
          `INSERT INTO models (name, filename, model_type, lora_category, civitai_id, is_own_civitai_upload, civitai_stats_json)
           VALUES ('Lyra v2', 'lyra_v2.safetensors', 'lora', 'character', '500', 1, ?)`
        )
        .run(JSON.stringify({ downloadCount: 1500, thumbsUpCount: 90, thumbsDownCount: 2 }))
        .lastInsertRowid
    );
    const styleLoraId = Number(
      ctx.db
        .prepare(
          `INSERT INTO models (name, filename, model_type, lora_category, civitai_id, is_own_civitai_upload, civitai_stats_json)
           VALUES ('Popular Style', 'pop_style.safetensors', 'lora', 'style', '999', 0, ?)`
        )
        .run(JSON.stringify({ downloadCount: 99000, thumbsUpCount: 5000, thumbsDownCount: 10 }))
        .lastInsertRowid
    );
    const novaCharLoraId = Number(
      ctx.db
        .prepare(
          `INSERT INTO models (name, filename, model_type, lora_category, civitai_id, is_own_civitai_upload, civitai_stats_json)
           VALUES ('Nova Char', 'nova_char.safetensors', 'lora', 'character', '601', 0, ?)`
        )
        .run(JSON.stringify({ downloadCount: 400, thumbsUpCount: 25, thumbsDownCount: 0 }))
        .lastInsertRowid
    );

    ctx.db
      .prepare(
        `INSERT INTO character_loras (character_id, model_id, lora_name, lora_category) VALUES
          (?, ?, 'lyra_v1.safetensors', 'character'),
          (?, ?, 'lyra_v2.safetensors', 'character'),
          (?, ?, 'pop_style.safetensors', 'style'),
          (?, ?, 'nova_char.safetensors', 'character'),
          (?, ?, 'pop_style.safetensors', 'style')`
      )
      .run(lyraId, ownV1Id, lyraId, ownV2Id, lyraId, styleLoraId, novaId, novaCharLoraId, kiraId, styleLoraId);

    const kImg1 = Number(
      ctx.db
        .prepare(
          `INSERT INTO images (content_hash, relative_path, filename, file_size, width, height, format, file_mtime, is_missing, is_uploaded_reference)
           VALUES ('kira-h1', 'k1.png', 'k1.png', 1024, 512, 512, 'png', '2026-11-05T00:00:00Z', 0, 0)`
        )
        .run().lastInsertRowid
    );
    const kImg2 = Number(
      ctx.db
        .prepare(
          `INSERT INTO images (content_hash, relative_path, filename, file_size, width, height, format, file_mtime, is_missing, is_uploaded_reference)
           VALUES ('kira-h2', 'k2.png', 'k2.png', 1024, 512, 512, 'png', '2026-11-06T00:00:00Z', 0, 0)`
        )
        .run().lastInsertRowid
    );
    const nImg1 = Number(
      ctx.db
        .prepare(
          `INSERT INTO images (content_hash, relative_path, filename, file_size, width, height, format, file_mtime, is_missing, is_uploaded_reference)
           VALUES ('nova-h1', 'n1.png', 'n1.png', 1024, 512, 512, 'png', '2026-11-07T00:00:00Z', 0, 0)`
        )
        .run().lastInsertRowid
    );

    ctx.db
      .prepare(
        `INSERT INTO image_characters (image_id, image_content_hash, character_id, status) VALUES
          (?, 'kira-h1', ?, 'confirmed'),
          (?, 'kira-h2', ?, 'confirmed'),
          (?, 'nova-h1', ?, 'confirmed')`
      )
      .run(kImg1, kiraId, kImg2, kiraId, nImg1, novaId);

    // Two rows sharing post 9001 for Kira -> must deduplicate so reactions = 140 + 80 = 220
    ctx.db
      .prepare(
        `INSERT INTO image_civitai_drafts
          (image_id, image_content_hash, civitai_post_id, draft_url, title, status, reaction_count, comment_count)
         VALUES
          (?, 'kira-h1', 9001, 'https://civitai.com/posts/9001', 'Kira Post 1', 'published', 140, 5),
          (?, 'kira-h1', 9001, 'https://civitai.com/posts/9001', 'Kira Post 1 dup', 'published', 140, 5),
          (?, 'kira-h2', 9002, 'https://civitai.com/posts/9002', 'Kira Post 2', 'published', 80, 2),
          (?, 'nova-h1', 9003, 'https://civitai.com/posts/9003', 'Nova Post 1', 'published', 30, 1)`
      )
      .run(kImg1, kImg1, kImg2, nImg1);

    const profile = await getCivitaiUserProfile({
      forceRefresh: true,
      deps: { apiKey: '' },
    });

    const byId = new Map(profile.eligibleCharacterStats.map((s) => [s.characterId, s]));
    const lyra = byId.get(lyraId);
    const nova = byId.get(novaId);
    const kira = byId.get(kiraId);

    assert.ok(lyra && nova && kira);
    // Lyra: own upload deduplicated across v1 & v2, 3rd-party style ignored
    assert.equal(lyra.modelDownloadCount, 1500);
    assert.equal(lyra.modelThumbsUpCount, 90);
    // Nova: falls back to character-category LoRA + photo reactions
    assert.equal(nova.modelDownloadCount, 400);
    assert.equal(nova.modelThumbsUpCount, 25);
    assert.equal(nova.photoReactionCount, 30);
    // Kira: style LoRA ignored (0 downloads), photo reactions deduplicated (140 + 80 = 220)
    assert.equal(kira.modelDownloadCount, 0);
    assert.equal(kira.photoReactionCount, 220);
    assert.equal(kira.photoCommentCount, 7);
    assert.equal(kira.publishedPostCount, 2);

    // Ordering check: Lyra (1500 dl) -> Nova (400 dl) -> Kira (0 dl, 220 reactions)
    const rankedIds = profile.eligibleCharacterStats.map((s) => s.characterId);
    assert.ok(rankedIds.indexOf(lyraId) < rankedIds.indexOf(novaId));
    assert.ok(rankedIds.indexOf(novaId) < rankedIds.indexOf(kiraId));
  });
});
