import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { initTempDb, type TempDbContext } from './helpers/tempDb.ts';

let ctx: TempDbContext;
let rr: typeof import('../src/server/services/randomRollService.ts');

before(async () => {
  ctx = await initTempDb('couchy-rr-test');
  rr = await import('../src/server/services/randomRollService.ts');
});

after(() => {
  ctx?.cleanup();
});

describe('randomRollService', () => {
  it('filters out identity, demographic, hair, eye, and body tags while keeping scene motifs', () => {
    const tags = [
      '1girl',
      'woman',
      'asian',
      'dark skin',
      'blonde hair',
      'blue eyes',
      'curvy',
      'looking at viewer',
      'rainy neon alley',
      'leather jacket',
      'golden hour',
      'cafe window',
    ];
    const kept = tags.filter((t) => !rr.isIdentityOrDemographicTag(t));
    assert.deepEqual(kept, ['rainy neon alley', 'leather jacket', 'golden hour', 'cafe window']);
  });

  it('normalizes Krea2 variants and Flux under one compatible base model group', () => {
    assert.equal(rr.normalizeBaseModelGroup('Krea2'), 'flux');
    assert.equal(rr.normalizeBaseModelGroup('krea2 turbo'), 'flux');
    assert.equal(rr.normalizeBaseModelGroup('Flux.1 Dev'), 'flux');
    assert.equal(rr.normalizeBaseModelGroup('Pony Diffusion V6'), 'pony');
  });

  it('parses <selected_base> and strips tags/character names from <proposed_prompt>', () => {
    const candidates = [
      {
        filename: 'krea2_turbo.safetensors',
        name: 'Krea2 Turbo',
        nickname: 'krea2-turbo',
        base_model: 'Krea2',
        llm_description: 'Fast sharp realism.',
        usage_count: 10,
        fav_count: 3,
      },
      {
        filename: 'krea2_base.safetensors',
        name: 'Krea2 Base',
        nickname: 'krea2-base',
        base_model: 'Krea2',
        llm_description: 'Rich atmospheric lighting.',
        usage_count: 4,
        fav_count: 1,
      },
    ];

    const outputClosed =
      '<selected_base>"@krea2-base"</selected_base>\n<proposed_prompt>Under warm amber streetlamps, Alice stands in a wool coat.</proposed_prompt>';
    assert.equal(
      rr.resolveSelectedBaseCandidate(outputClosed, candidates)?.filename,
      'krea2_base.safetensors'
    );
    assert.equal(
      rr.extractPromptFromRandomRollResponse(outputClosed, 'Alice'),
      'Under warm amber streetlamps, the subject stands in a wool coat.'
    );

    const outputUnclosed =
      '<selected_base>@krea2-turbo\n<proposed_prompt>Close-up portrait by a sunlit cafe window.</proposed_prompt>';
    assert.equal(
      rr.resolveSelectedBaseCandidate(outputUnclosed, candidates)?.filename,
      'krea2_turbo.safetensors'
    );
    assert.equal(
      rr.extractPromptFromRandomRollResponse(outputUnclosed, 'Alice'),
      'Close-up portrait by a sunlit cafe window.'
    );

    const outputWithLoraCheck = [
      '<lora_check>',
      '- Star Trek Settings [concept]: Must depict a Starfleet starship bridge, glowing LCARS consoles, or futuristic Starfleet duty uniform.',
      '- Drop: cozy bedroom, wool sweater (conflicts with sci-fi starship setting); Keep: dramatic rim lighting.',
      '</lora_check>',
      '<selected_base>"@krea2-turbo"</selected_base>',
      '<proposed_prompt>Medium shot of Alice standing on a sleek starship bridge beside glowing LCARS consoles in a fitted duty uniform.</proposed_prompt>',
    ].join('\n');

    const extractedCheck = rr.extractLoraCheckFromRandomRollResponse(outputWithLoraCheck);
    assert.ok(extractedCheck?.includes('Starfleet starship bridge'));
    const extractedPrompt = rr.extractPromptFromRandomRollResponse(outputWithLoraCheck, 'Alice');
    assert.equal(
      extractedPrompt,
      'Medium shot of the subject standing on a sleek starship bridge beside glowing LCARS consoles in a fitted duty uniform.'
    );

    const passVerification = rr.verifyPromptReflectsLoraCheck(extractedPrompt, extractedCheck);
    assert.equal(passVerification.passed, true);
    assert.ok(passVerification.matchedKeywords.includes('starship'));

    const missedPrompt =
      'Medium shot of the subject sitting in a sunlit meadow wearing a floral sundress.';
    const failVerification = rr.verifyPromptReflectsLoraCheck(missedPrompt, extractedCheck);
    assert.equal(failVerification.passed, false);

    const pivotedLoraCheck = [
      '- Star Trek Settings [concept]: Skip: user pivot to sunny beach.',
      '- Dramatic Rim Light [lighting]: Must include high-contrast golden rim lighting and deep shadows.',
    ].join('\n');
    const beachPromptWithRimLight =
      'Medium shot of the subject walking along a sunny beach with high-contrast golden rim lighting and deep shadows.';
    const pivotVerification = rr.verifyPromptReflectsLoraCheck(
      beachPromptWithRimLight,
      pivotedLoraCheck
    );
    assert.equal(pivotVerification.passed, true);
  });

  it('enforces eligibility rules: characters with installed LoRAs, described mention checkpoints, and style LoRA exclusions', () => {
    // Seed characters: one without LoRA, one with uninstalled LoRA, one with installed LoRA (trigger on model)
    const noLoraChar = ctx.db
      .prepare(`INSERT INTO characters (name, description, physical_description) VALUES (?, ?, ?)`)
      .run('NoLoraChar', 'bio', 'tall');
    const uninstalledChar = ctx.db
      .prepare(`INSERT INTO characters (name, description, physical_description) VALUES (?, ?, ?)`)
      .run('UninstalledChar', 'bio', 'short');
    const validChar = ctx.db
      .prepare(`INSERT INTO characters (name, description, physical_description) VALUES (?, ?, ?)`)
      .run('ValidChar', 'bio', 'woman');

    ctx.db
      .prepare(
        `INSERT INTO models (name, filename, model_type, lora_category, base_model, trigger_word, is_installed, mention_enabled)
         VALUES ('CharUninstalled', 'char_uninstalled.safetensors', 'lora', 'character', 'Krea2', 'u_trig', 0, 1)`
      )
      .run();
    const validCharLora = ctx.db
      .prepare(
        `INSERT INTO models (name, filename, model_type, lora_category, base_model, trigger_word, is_installed, mention_enabled)
         VALUES ('CharValid', 'char_valid.safetensors', 'lora', 'character', 'Krea2', 'valid_trig', 1, 1)`
      )
      .run();

    ctx.db
      .prepare(`INSERT INTO character_loras (character_id, lora_name) VALUES (?, ?)`)
      .run(uninstalledChar.lastInsertRowid, 'char_uninstalled.safetensors');
    ctx.db
      .prepare(
        `INSERT INTO character_loras (character_id, model_id, lora_name, trigger_word) VALUES (?, ?, ?, '')`
      )
      .run(validChar.lastInsertRowid, validCharLora.lastInsertRowid, 'char_valid.safetensors');

    assert.ok(noLoraChar.lastInsertRowid);
    const rolledChar = rr.selectRolledCharacter();
    assert.equal(rolledChar.character.name, 'ValidChar');
    assert.equal(rolledChar.charLora?.trigger_word, 'valid_trig');

    // Seed checkpoints: undescribed, non-mention, and described+mention Krea2
    ctx.db
      .prepare(
        `INSERT INTO models (name, filename, model_type, base_model, llm_description, is_installed, is_hidden, mention_enabled)
         VALUES ('UndescribedCkpt', 'undescribed.safetensors', 'checkpoint', 'Krea2', '', 1, 0, 1),
                ('NoMentionCkpt', 'nomention.safetensors', 'checkpoint', 'Krea2', 'Has desc', 1, 0, 0),
                ('DescribedKrea', 'described_krea.safetensors', 'diffusion', 'Krea2 Turbo', 'Crisp editorial realism', 1, 0, 1)`
      )
      .run();

    const eligibleCkpts = rr.getEligibleDescribedCheckpoints('flux');
    assert.deepEqual(
      eligibleCkpts.map((c) => c.filename),
      ['described_krea.safetensors']
    );
  });

  it('honors a pinned characterId in executeRandomRoll while still rolling compatible style LoRAs', async () => {
    ctx.db
      .prepare(
        `INSERT INTO models (name, filename, model_type, lora_category, base_model, trigger_word, is_installed, is_hidden, mention_enabled)
         VALUES ('FilmStyle', 'film_style.safetensors', 'lora', 'style', 'Krea2', 'film_trig', 1, 0, 1)`
      )
      .run();

    const noLoraRow = ctx.db
      .prepare(`SELECT id FROM characters WHERE name = 'NoLoraChar'`)
      .get() as { id: number };
    const validRow = ctx.db
      .prepare(`SELECT id FROM characters WHERE name = 'ValidChar'`)
      .get() as { id: number };

    // When ValidChar is pinned, Random Roll uses ValidChar and still permits style LoRAs alongside its character LoRA
    const pinnedValid = await rr.executeRandomRoll({ characterId: validRow.id });
    assert.equal(pinnedValid.rollSummary.characterId, validRow.id);
    assert.equal(pinnedValid.rollSummary.characterName, 'ValidChar');
    assert.ok(pinnedValid.rollSummary.loraNames.includes('char_valid.safetensors'));

    // Explicit characterId bypasses random-roll installed-LoRA eligibility filtering
    const pinnedNoLora = await rr.executeRandomRoll({ characterId: noLoraRow.id });
    assert.equal(pinnedNoLora.rollSummary.characterId, noLoraRow.id);
    assert.equal(pinnedNoLora.rollSummary.characterName, 'NoLoraChar');

    // Nonexistent characterId throws cleanly
    assert.throws(() => rr.selectRolledCharacter(999999), /not found/i);
  });

  it('progressively dispatches multi-image Random Roll shots and respects batch cancellation', async () => {
    const validRow = ctx.db
      .prepare(`SELECT id FROM characters WHERE name = 'ValidChar'`)
      .get() as { id: number };

    // 1. Multi-shot progressive roll (x3) creates 1 multi_shot series & 3 items, returning after Shot 1
    const multi = await rr.executeRandomRoll({ characterId: validRow.id, count: 3 });
    assert.equal(multi.rollSummary.totalCount, 3);
    assert.equal(multi.batch.mode, 'theme_set');
    assert.equal(multi.batch.totalCount, 3);
    assert.equal(multi.batch.items.length, 3);
    assert.ok(multi.batch.items[0].prompt.length >= 15);
    assert.equal(multi.batch.items[1].status, 'pending');
    assert.equal(multi.batch.items[2].status, 'pending');
    assert.ok(multi.progressiveTask);

    const seriesRow = ctx.db
      .prepare(
        `SELECT s.series_kind FROM generation_batches gb JOIN image_series s ON s.id = gb.series_id WHERE gb.id = ?`
      )
      .get(multi.batch.id) as { series_kind: string } | undefined;
    assert.equal(seriesRow?.series_kind, 'multi_shot');

    // Waiting on progressiveTask populates distinct prompts across all 3 shots
    await multi.progressiveTask;
    const finalItems = ctx.db
      .prepare(`SELECT item_index, prompt FROM generation_items WHERE batch_id = ? ORDER BY item_index ASC`)
      .all(multi.batch.id) as Array<{ item_index: number; prompt: string }>;
    assert.equal(finalItems.length, 3);
    assert.equal(new Set(finalItems.map((i) => i.prompt)).size, 3);

    // 2. Cancelling a progressive batch stops remaining pending items from being written/dispatched
    const { markPromptsCancelled } = await import('../src/server/services/comfyuiLiveMonitor.ts');
    const cancelledRoll = await rr.executeRandomRoll({ characterId: validRow.id, count: 4 });
    markPromptsCancelled([], cancelledRoll.batch.id);
    ctx.db
      .prepare(`UPDATE generation_items SET status = 'cancelled' WHERE batch_id = ? AND status = 'pending'`)
      .run(cancelledRoll.batch.id);
    await cancelledRoll.progressiveTask;

    const cancelledItems = ctx.db
      .prepare(`SELECT item_index, prompt, status FROM generation_items WHERE batch_id = ? ORDER BY item_index ASC`)
      .all(cancelledRoll.batch.id) as Array<{ item_index: number; prompt: string; status: string }>;
    assert.equal(cancelledItems[1].status, 'cancelled');
    assert.equal(cancelledItems[1].prompt, '');
  });
});
