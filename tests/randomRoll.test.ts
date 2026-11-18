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
});
