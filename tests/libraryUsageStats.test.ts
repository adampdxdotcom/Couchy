import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { initTempDb, type TempDbContext } from './helpers/tempDb.ts';

let ctx: TempDbContext;
let statsSvc: typeof import('../src/server/services/libraryUsageStatsService.ts');
let db: typeof import('../src/server/db.ts').db;

before(async () => {
  ctx = await initTempDb('couchy-lib-usage-test');
  ({ db } = await import('../src/server/db.ts'));
  statsSvc = await import('../src/server/services/libraryUsageStatsService.ts');
});

after(() => {
  ctx?.cleanup();
});

describe('libraryUsageStatsService', () => {
  it('computes totals, rankings, roll scores, odds, and eligibility across characters, base models, and LoRAs by type', () => {
    // Seed models: 3 base models (1 uninstalled ignored, 1 eligible, 1 excluded), 5 LoRAs (1 uninstalled ignored)
    const insertModel = db.prepare(
      `INSERT INTO models (
         name, filename, nickname, model_type, lora_category, base_model,
         is_installed, is_hidden, mention_enabled, llm_description
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );

    // Base models
    insertModel.run(
      'Krea2 Turbo',
      'krea2_turbo.safetensors',
      'krea2-turbo',
      'diffusion',
      'unclassified',
      'Krea2',
      1,
      0,
      1,
      'Fast photoreal base model.'
    );
    insertModel.run(
      'Krea2 Base',
      'krea2_base.safetensors',
      'krea2-base',
      'checkpoint',
      'unclassified',
      'Krea2',
      1,
      0,
      1,
      'Detailed cinematic base model.'
    );
    insertModel.run(
      'Undescribed Hidden Base',
      'hidden_base.safetensors',
      null,
      'checkpoint',
      'unclassified',
      'SDXL',
      1,
      1,
      0,
      ''
    );
    insertModel.run(
      'Uninstalled Base',
      'missing_base.safetensors',
      null,
      'checkpoint',
      'unclassified',
      'SDXL',
      0,
      0,
      1,
      'Should not appear.'
    );

    // LoRAs across categories
    const charLoraId = Number(
      insertModel.run(
        'Alice Lora',
        'alice_char.safetensors',
        'Alice',
        'lora',
        'character',
        'Krea2',
        1,
        0,
        1,
        'Character LoRA for Alice.'
      ).lastInsertRowid
    );
    insertModel.run(
      'Neon Noir',
      'neon_noir.safetensors',
      'neon-noir',
      'lora',
      'style',
      'Krea2',
      1,
      0,
      1,
      'Moody neon lighting.'
    );
    insertModel.run(
      'Film Grain',
      'film_grain.safetensors',
      'film-grain',
      'lora',
      'style',
      'Krea2',
      1,
      0,
      1,
      'Subtle 35mm film grain.'
    );
    insertModel.run(
      'Evening Gown',
      'evening_gown.safetensors',
      'evening-gown',
      'lora',
      'clothing',
      'Krea2',
      1,
      0,
      0, // mention_enabled = 0 -> excluded from random roll
      'Silk gown.'
    );
    insertModel.run(
      'Ghost Uninstalled Lora',
      'ghost_missing.safetensors',
      null,
      'lora',
      'concept',
      'Krea2',
      0,
      0,
      1,
      'Should be ignored.'
    );

    // Characters: Alice (has installed LoRA), Bob (no LoRA, only rejected image -> must still appear with 0 uses),
    // Clara (no LoRA, 4 confirmed uses -> usageRank #1, but excluded from roll so rollRank #2)
    const aliceId = Number(
      db.prepare(`INSERT INTO characters (name) VALUES ('Alice')`).run().lastInsertRowid
    );
    const bobId = Number(
      db.prepare(`INSERT INTO characters (name) VALUES ('Bob')`).run().lastInsertRowid
    );
    const claraId = Number(
      db.prepare(`INSERT INTO characters (name) VALUES ('Clara')`).run().lastInsertRowid
    );

    db.prepare(
      `INSERT INTO character_loras (character_id, model_id, lora_name) VALUES (?, ?, ?)`
    ).run(aliceId, charLoraId, 'alice_char.safetensors');

    // Seed images + metadata + loras + character associations + ratings
    const insertImage = db.prepare(
      `INSERT INTO images (content_hash, relative_path, filename, file_size, file_mtime, is_missing, is_uploaded_reference)
       VALUES (?, ?, ?, 1024, '2026-11-01T12:00:00Z', 0, ?)`
    );
    const insertMeta = db.prepare(
      `INSERT INTO image_metadata (image_id, checkpoint_name) VALUES (?, ?)`
    );
    const insertImgLora = db.prepare(
      `INSERT INTO image_loras (image_id, lora_name) VALUES (?, ?)`
    );
    const insertImgChar = db.prepare(
      `INSERT INTO image_characters (image_id, image_content_hash, character_id, status) VALUES (?, ?, ?, 'confirmed')`
    );
    const insertRating = db.prepare(
      `INSERT INTO ratings (content_hash, is_favorite, is_rejected) VALUES (?, ?, ?)`
    );

    // 2 valid images for Alice + krea2_turbo + neon_noir (both favorited)
    for (let i = 1; i <= 2; i++) {
      const hash = `hash_alice_${i}`;
      const imgId = Number(insertImage.run(hash, `out/a_${i}.png`, `a_${i}.png`, 0).lastInsertRowid);
      insertMeta.run(imgId, 'krea2_turbo.safetensors');
      insertImgLora.run(imgId, 'neon_noir.safetensors');
      insertImgLora.run(imgId, 'alice_char.safetensors');
      insertImgChar.run(imgId, hash, aliceId);
      insertRating.run(hash, 1, 0);
    }

    // 4 valid images for Clara + krea2_base + film_grain (0 favorites) + 1 uploaded reference (ignored)
    for (let i = 1; i <= 4; i++) {
      const hash = `hash_clara_${i}`;
      const imgId = Number(insertImage.run(hash, `out/c_${i}.png`, `c_${i}.png`, 0).lastInsertRowid);
      insertMeta.run(imgId, 'krea2_base.safetensors');
      insertImgLora.run(imgId, 'film_grain.safetensors');
      insertImgChar.run(imgId, hash, claraId);
    }
    const uploadedHash = 'hash_clara_ref';
    const refImgId = Number(
      insertImage.run(uploadedHash, 'refs/clara.png', 'clara.png', 1).lastInsertRowid
    );
    insertImgChar.run(refImgId, uploadedHash, claraId);

    // 1 rejected image for Bob + hidden_base + evening_gown (Bob must still appear with 0 uses)
    const bobHash = 'hash_bob_rejected';
    const bobImgId = Number(
      insertImage.run(bobHash, 'out/b_1.png', 'b_1.png', 0).lastInsertRowid
    );
    insertMeta.run(bobImgId, 'hidden_base.safetensors');
    insertImgLora.run(bobImgId, 'evening_gown.safetensors');
    insertImgChar.run(bobImgId, bobHash, bobId);
    insertRating.run(bobHash, 0, 1);

    // 3 valid images for evening_gown (excluded from roll via mention_enabled = 0)
    for (let i = 1; i <= 3; i++) {
      const hash = `hash_gown_${i}`;
      const imgId = Number(insertImage.run(hash, `out/g_${i}.png`, `g_${i}.png`, 0).lastInsertRowid);
      insertImgLora.run(imgId, 'evening_gown.safetensors');
    }

    const stats = statsSvc.getLibraryUsageStats();

    // Characters assertions
    assert.equal(stats.characters.totalCount, 3);
    assert.equal(stats.characters.eligibleCount, 1);
    assert.equal(stats.characters.topByUsage?.name, 'Clara');
    assert.equal(stats.characters.topByUsage?.usageCount, 4);
    assert.equal(stats.characters.topByRollScore?.name, 'Alice');
    assert.equal(stats.characters.topByRollScore?.rollOddsPercent, 100);

    const bobItem = stats.characters.items.find((c) => c.name === 'Bob');
    assert.ok(bobItem, 'Bob with only rejected image must still be present');
    assert.equal(bobItem.usageCount, 0);
    assert.equal(bobItem.rollEligible, false);
    assert.deepEqual(bobItem.excludedReasons, ['No installed LoRA']);

    // Base models assertions (uninstalled ignored -> 3 total, 2 eligible)
    assert.equal(stats.baseModels.totalCount, 3);
    assert.equal(stats.baseModels.eligibleCount, 2);
    const hiddenBase = stats.baseModels.items.find((m) => m.name === 'Undescribed Hidden Base');
    assert.ok(hiddenBase);
    assert.equal(hiddenBase.rollEligible, false);
    assert.deepEqual(hiddenBase.excludedReasons, ['Hidden', 'Mention off', 'No description']);
    assert.equal(hiddenBase.rollOddsPercent, 0);

    const baseOddsSum = stats.baseModels.items
      .filter((m) => m.rollEligible)
      .reduce((acc, m) => acc + m.rollOddsPercent, 0);
    assert.ok(Math.abs(baseOddsSum - 100) <= 0.2, `Expected base odds ~100, got ${baseOddsSum}`);

    // LoRAs assertions (4 installed: 1 character, 2 style, 1 clothing)
    assert.equal(stats.loras.totalCount, 4);
    assert.equal(stats.loras.eligibleCount, 2);
    // film_grain has 4 uses, 0 favs -> score = 1 + sqrt(4) = 3.00
    // neon_noir has 2 uses, 2 favs -> score = (1 + sqrt(2)) * (1 + min(0.6, sqrt(2)*0.15)) ≈ 2.4142 * 1.2121 ≈ 2.93
    const neonNoir = stats.loras.items.find((l) => l.name === 'neon-noir');
    const filmGrain = stats.loras.items.find((l) => l.name === 'film-grain');
    const eveningGown = stats.loras.items.find((l) => l.name === 'evening-gown');
    const aliceLora = stats.loras.items.find((l) => l.name === 'Alice');

    assert.ok(neonNoir && filmGrain && eveningGown && aliceLora);
    assert.equal(neonNoir.usageCount, 2);
    assert.equal(neonNoir.favoriteCount, 2);
    assert.equal(filmGrain.usageCount, 4);
    assert.equal(eveningGown.rollEligible, false);
    assert.deepEqual(eveningGown.excludedReasons, ['Mention off']);
    assert.equal(aliceLora.rollEligible, false);
    assert.deepEqual(aliceLora.excludedReasons, ['Character LoRA (via character)']);

    // Category breakdown assertions
    const styleSummary = stats.loraByCategory.find((c) => c.category === 'style');
    const clothingSummary = stats.loraByCategory.find((c) => c.category === 'clothing');
    const charSummary = stats.loraByCategory.find((c) => c.category === 'character');
    assert.equal(styleSummary?.totalCount, 2);
    assert.equal(styleSummary?.eligibleCount, 2);
    assert.equal(styleSummary?.topByUsage?.name, 'film-grain');
    assert.equal(clothingSummary?.totalCount, 1);
    assert.equal(clothingSummary?.eligibleCount, 0);
    assert.equal(clothingSummary?.topByUsage?.name, 'evening-gown');
    assert.equal(charSummary?.totalCount, 1);
    assert.equal(charSummary?.eligibleCount, 0);
  });
});
