import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { initTempDb, type TempDbContext } from './helpers/tempDb.ts';

let ctx: TempDbContext;
let queryGalleryImages: typeof import('../src/server/services/galleryQueryService.ts').queryGalleryImages;
let listUnseenCivitaiActivity: typeof import('../src/server/services/civitai/civitaiActivitySyncService.ts').listUnseenCivitaiActivity;
let listCharacterProfiles: typeof import('../src/server/services/characterService.ts').listCharacterProfiles;
let getCharacterProfileById: typeof import('../src/server/services/characterService.ts').getCharacterProfileById;
let buildMentionEntries: typeof import('../src/components/quickgen/quickGenUtils.ts').buildMentionEntries;

let wf1 = 0;
let wf2 = 0;
let img1 = 0;
let img2 = 0;
let img3 = 0;

function seedImage(opts: {
  hash: string;
  filename: string;
  mtime: string;
  checkpoint?: string;
  prompt?: string;
  rejected?: boolean;
  archived?: boolean;
}): number {
  const res = ctx.db
    .prepare(
      `INSERT INTO images
        (content_hash, relative_path, filename, file_size, width, height, format, file_mtime, is_missing, is_uploaded_reference)
       VALUES (?, ?, ?, 1024, 1024, 1024, 'png', ?, 0, 0)`
    )
    .run(opts.hash, opts.filename, opts.filename, opts.mtime);
  const id = Number(res.lastInsertRowid);

  ctx.db
    .prepare(
      `INSERT INTO image_metadata (image_id, positive_prompt, checkpoint_name)
       VALUES (?, ?, ?)`
    )
    .run(id, opts.prompt ?? 'editorial portrait', opts.checkpoint ?? 'krea2_turbo.safetensors');

  if (opts.rejected || opts.archived) {
    ctx.db
      .prepare(
        `INSERT INTO ratings (content_hash, rating, is_favorite, is_rejected, is_archived)
         VALUES (?, 0, 0, ?, ?)`
      )
      .run(opts.hash, opts.rejected ? 1 : 0, opts.archived ? 1 : 0);
  }
  return id;
}

before(async () => {
  ctx = await initTempDb('couchy-perf-phase3a-test');
  ({ queryGalleryImages } = await import('../src/server/services/galleryQueryService.ts'));
  ({ listUnseenCivitaiActivity } = await import(
    '../src/server/services/civitai/civitaiActivitySyncService.ts'
  ));
  ({ listCharacterProfiles, getCharacterProfileById } = await import(
    '../src/server/services/characterService.ts'
  ));
  ({ buildMentionEntries } = await import('../src/components/quickgen/quickGenUtils.ts'));

  wf1 = Number(
    ctx.db
      .prepare(
        `INSERT INTO workflows (name, workflow_hash, is_saved_library, api_workflow_json)
         VALUES ('WF One', 'wf-hash-1', 1, '{}')`
      )
      .run().lastInsertRowid
  );
  wf2 = Number(
    ctx.db
      .prepare(
        `INSERT INTO workflows (name, workflow_hash, is_saved_library, api_workflow_json)
         VALUES ('WF Two', 'wf-hash-2', 1, '{}')`
      )
      .run().lastInsertRowid
  );

  img1 = seedImage({
    hash: 'h-p3a-1',
    filename: 'p3a_1.png',
    mtime: '2026-11-26T10:01:00.000Z',
    checkpoint: 'subfolder/Krea2_Alpha.safetensors',
    prompt: 'golden hour rooftop portrait',
  });
  img2 = seedImage({
    hash: 'h-p3a-2',
    filename: 'p3a_2.png',
    mtime: '2026-11-26T10:02:00.000Z',
    checkpoint: 'Krea2_Beta.safetensors',
    prompt: 'studio neon portrait',
  });
  img3 = seedImage({
    hash: 'h-p3a-3',
    filename: 'p3a_3.png',
    mtime: '2026-11-26T10:03:00.000Z',
    checkpoint: 'Krea2_Beta.safetensors',
    prompt: 'rejected rooftop test',
    rejected: true,
  });

  ctx.db
    .prepare(
      `INSERT INTO image_workflows (image_id, image_content_hash, workflow_id) VALUES (?, 'h-p3a-1', ?)`
    )
    .run(img1, wf1);
  ctx.db
    .prepare(
      `INSERT INTO image_workflows (image_id, image_content_hash, workflow_id) VALUES (?, 'h-p3a-2', ?)`
    )
    .run(img2, wf2);
  ctx.db
    .prepare(`INSERT INTO image_models (image_id, model_name, model_type) VALUES (?, ?, 'vae')`)
    .run(img2, 'qwen_image_vae.safetensors');
});

after(() => {
  ctx?.cleanup();
});

describe('Phase 3A decoupled scoped queries, unseen Civitai alerts, and character recentSamples', () => {
  it('filters queryGalleryImages by workflowId, normalized modelName, and limit', () => {
    const wf1Items = queryGalleryImages({
      workflowId: wf1,
      rejectedMode: 'include',
      archivedMode: 'include',
    });
    assert.deepEqual(
      wf1Items.map((i) => i.id),
      [img1]
    );

    const alphaItems = queryGalleryImages({
      modelName: 'krea2_alpha.safetensors',
      rejectedMode: 'include',
      archivedMode: 'include',
    });
    assert.deepEqual(
      alphaItems.map((i) => i.id),
      [img1]
    );

    const vaeItems = queryGalleryImages({
      modelName: 'qwen_image_vae.safetensors',
      rejectedMode: 'include',
      archivedMode: 'include',
    });
    assert.deepEqual(
      vaeItems.map((i) => i.id),
      [img2]
    );

    const limited = queryGalleryImages({
      rejectedMode: 'include',
      archivedMode: 'include',
      sortBy: 'newest',
      limit: 1,
    });
    assert.equal(limited.length, 1);
    assert.equal(limited[0].id, img3);
  });

  it('excludes rejected/seen posts and deduplicates by postId in listUnseenCivitaiActivity', () => {
    ctx.db
      .prepare(
        `INSERT INTO image_civitai_drafts
          (image_id, image_content_hash, civitai_post_id, draft_url, title, status,
           reaction_count, comment_count, seen_reaction_count, seen_comment_count)
         VALUES (?, 'h-p3a-1', 9001, 'https://civitai.com/posts/9001', 'Post 1', 'published', 5, 2, 1, 2)`
      )
      .run(img1);
    ctx.db
      .prepare(
        `INSERT INTO image_civitai_drafts
          (image_id, image_content_hash, civitai_post_id, draft_url, title, status,
           reaction_count, comment_count, seen_reaction_count, seen_comment_count)
         VALUES (?, 'h-p3a-1', 9001, 'https://civitai.com/posts/9001', 'Post 1 dup', 'published', 5, 2, 1, 2)`
      )
      .run(img1);
    ctx.db
      .prepare(
        `INSERT INTO image_civitai_drafts
          (image_id, image_content_hash, civitai_post_id, draft_url, title, status,
           reaction_count, comment_count, seen_reaction_count, seen_comment_count)
         VALUES (?, 'h-p3a-2', 9002, 'https://civitai.com/posts/9002', 'Post 2', 'published', 3, 1, 3, 1)`
      )
      .run(img2);
    ctx.db
      .prepare(
        `INSERT INTO image_civitai_drafts
          (image_id, image_content_hash, civitai_post_id, draft_url, title, status,
           reaction_count, comment_count, seen_reaction_count, seen_comment_count)
         VALUES (?, 'h-p3a-3', 9003, 'https://civitai.com/posts/9003', 'Post 3', 'published', 4, 0, 0, 0)`
      )
      .run(img3);

    const unseen = listUnseenCivitaiActivity();
    assert.equal(unseen.length, 1);
    assert.equal(unseen[0].imageId, img1);
    assert.equal(unseen[0].reactionCount, 5);
    assert.equal(unseen[0].commentCount, 2);
    assert.equal(unseen[0].hasUnseenActivity, true);
  });

  it('includes up to 4 confirmed recentSamples on character profiles and powers buildMentionEntries', () => {
    const charId = Number(
      ctx.db.prepare(`INSERT INTO characters (name) VALUES ('Luna')`).run().lastInsertRowid
    );

    const extraIds = [img1, img2];
    for (let k = 4; k <= 6; k += 1) {
      extraIds.push(
        seedImage({
          hash: `h-p3a-${k}`,
          filename: `p3a_${k}.png`,
          mtime: `2026-11-26T10:0${k}:00.000Z`,
          prompt: `sample prompt ${k}`,
        })
      );
    }

    for (const [idx, id] of extraIds.entries()) {
      const hash = idx === 0 ? 'h-p3a-1' : idx === 1 ? 'h-p3a-2' : `h-p3a-${idx + 2}`;
      ctx.db
        .prepare(
          `INSERT INTO image_characters (image_id, image_content_hash, character_id, status, source)
           VALUES (?, ?, ?, 'confirmed', 'manual')`
        )
        .run(id, hash, charId);
    }
    ctx.db
      .prepare(
        `INSERT INTO image_characters (image_id, image_content_hash, character_id, status, source)
         VALUES (?, 'h-p3a-3', ?, 'confirmed', 'manual')`
      )
      .run(img3, charId);

    const listed = listCharacterProfiles().find((c) => c.id === charId);
    const single = getCharacterProfileById(charId);
    assert.ok(listed);
    assert.ok(single);
    assert.equal(listed.recentSamples?.length, 4);
    assert.deepEqual(listed.recentSamples, single.recentSamples);
    assert.ok(!listed.recentSamples?.some((s) => s.id === img3));

    const { mentionEntries, mentionCounts } = buildMentionEntries({
      characters: [listed],
      loras: [],
      models: [],
      presets: [],
      query: 'luna',
      tab: 'all',
    });
    assert.equal(mentionCounts.characters, 1);
    assert.equal(mentionCounts.photos, 4);
    assert.ok(mentionEntries.some((e) => e.type === 'character' && e.title === 'Luna'));
  });
});
