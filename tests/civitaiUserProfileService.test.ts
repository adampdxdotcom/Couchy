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
});
