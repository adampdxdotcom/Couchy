import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { initTempDb, type TempDbContext } from './helpers/tempDb.ts';

let ctx: TempDbContext;
let verification: typeof import('../src/server/services/llm/batchPromptVerification.ts');
let batchExpansion: typeof import('../src/server/services/llm/batchExpansionService.ts');

before(async () => {
  ctx = await initTempDb('couchy-batch-test');
  verification = await import('../src/server/services/llm/batchPromptVerification.ts');
  batchExpansion = await import('../src/server/services/llm/batchExpansionService.ts');
});

after(() => {
  ctx?.cleanup();
});

describe('batchPromptVerification & batchExpansionService', () => {
  it('parses closed, unclosed, and fallback <shot_N> outputs without leaking XML tags', () => {
    const unclosedWithLoraCheck = [
      '<lora_check>',
      '- realistic: natural skin texture',
      '</lora_check>',
      '<shot_1>Medium 35mm horror film still of a terrified young woman wearing only white cotton panties in a dimly lit decaying hospital corridor.',
      '<shot_2>Tight three-quarter 50mm shot of the frightened topless woman in white panties backing away toward peeling wallpaper in cold flickering light.',
    ].join('\n');

    const unclosedParsed = verification.parseShotPromptsFromLlm(unclosedWithLoraCheck);
    assert.equal(unclosedParsed.length, 2);
    assert.equal(unclosedParsed[0].includes('<shot_1>'), false);
    assert.equal(unclosedParsed[1].includes('<shot_2>'), false);
    assert.ok(unclosedParsed[0].startsWith('Medium 35mm horror film still'));
    assert.ok(unclosedParsed[1].startsWith('Tight three-quarter 50mm shot'));

    const closed =
      '<shot_1>First detailed horror corridor prompt.</shot_1>\n<shot_2>Second detailed horror stairwell prompt.</shot_2>';
    assert.deepEqual(verification.parseShotPromptsFromLlm(closed), [
      'First detailed horror corridor prompt.',
      'Second detailed horror stairwell prompt.',
    ]);

    const extracted = verification.extractPromptFromBatchShotResponse(
      '<lora_check>- realistic: natural skin texture</lora_check>\n<proposed_prompt>Cinematic 50mm horror shot of Alice.</proposed_prompt>',
      'Alice'
    );
    assert.equal(extracted, 'Cinematic 50mm horror shot of the subject.');

    const leakedConceptOnly = verification.extractPromptFromBatchShotResponse(
      '<lora_check>- realistic: natural skin texture</lora_check>\n<proposed_concept>Four-shot horror set.</proposed_concept>',
      'Alice'
    );
    assert.equal(leakedConceptOnly, '');
  });

  it('rejects brief, rear-view-hiding prompts that drop undress/wardrobe/horror anchors and passes rich faithful prompts', () => {
    const userPrompt =
      'the subject wears nothing except white panties and is scared in a horror movie setting';

    const weakHallwayPrompt =
      'A long hallway shot with deep shadows from doorways. A young woman stands at the far end of a corridor, her back to the camera: natural skin texture, messy hair. The wood floor reflects light from tall windows on one side.';

    const failResult = verification.verifyBatchShotQuality({
      shotPrompt: weakHallwayPrompt,
      theme: 'A tense corridor sequence.',
      recentUserMessages: [userPrompt],
      nonCharacterLoraBlock: 'Active Non-Character LoRAs:\n- realistic: natural skin texture',
    });

    assert.equal(failResult.passed, false);
    assert.ok(failResult.reasons.some((r) => /too brief/i.test(r)));
    assert.ok(failResult.reasons.some((r) => /back to the camera/i.test(r)));
    assert.ok(failResult.reasons.some((r) => /bare upper body/i.test(r)));
    assert.ok(failResult.reasons.some((r) => /white panties/i.test(r)));
    assert.ok(failResult.reasons.some((r) => /scared/i.test(r)));
    assert.ok(failResult.reasons.some((r) => /horror/i.test(r)));

    const richHorrorPrompt =
      '35mm horror film medium three-quarter shot at slightly low eye-level. A visibly terrified woman clutches her bare arms tightly over her bare chest, shoulders hunched, wide-eyed with fear and parted trembling lips as she glances toward a dark doorway. She is topless, wearing nothing except plain white cotton panties, with disheveled messy hair and natural skin texture glistening faintly with cold sweat. Behind her stretches a claustrophobic decaying horror hallway with peeling stained wallpaper, cracked floorboards, a tilted rusty gurney, and a flickering overhead cage bulb casting harsh cold cyan-green shadows.';

    const passResult = verification.verifyBatchShotQuality({
      shotPrompt: richHorrorPrompt,
      theme: 'A tense horror corridor sequence.',
      recentUserMessages: [userPrompt],
      nonCharacterLoraBlock: 'Active Non-Character LoRAs:\n- realistic: natural skin texture',
    });

    assert.equal(passResult.passed, true, `Unexpected failures: ${passResult.reasons.join('; ')}`);
  });

  it('progressively dispatches agent batch Shot 1 immediately and populates remaining shots in background', async () => {
    const wfRow = ctx.db.prepare(`SELECT id FROM workflows LIMIT 1`).get() as { id: number };
    assert.ok(wfRow?.id);

    const result = await batchExpansion.executeProgressiveAgentBatch({
      workflowId: wfRow.id,
      characterName: 'Subject',
      loras: [],
      aspectRatio: '2:3 (Portrait Photo)',
      theme: 'the subject wears nothing except white panties and is scared in a horror movie setting',
      count: 3,
      chatMessages: [
        {
          role: 'user',
          content: 'the subject wears nothing except white panties and is scared in a horror movie setting',
        },
      ],
    });

    assert.equal(result.totalCount, 3);
    assert.equal(result.batch.mode, 'theme_set');
    assert.equal(result.batch.totalCount, 3);
    assert.equal(result.batch.items.length, 3);
    assert.ok(result.batch.items[0].prompt.length > 20);
    assert.equal(result.batch.items[1].status, 'pending');
    assert.equal(result.batch.items[2].status, 'pending');
    assert.ok(result.progressiveTask);

    await result.progressiveTask;

    const finalItems = ctx.db
      .prepare(`SELECT item_index, prompt FROM generation_items WHERE batch_id = ? ORDER BY item_index ASC`)
      .all(result.batch.id) as Array<{ item_index: number; prompt: string }>;
    assert.equal(finalItems.length, 3);
    assert.equal(new Set(finalItems.map((i) => i.prompt)).size, 3);

    // Verify batch cancellation halts remaining pending slots
    const { markPromptsCancelled } = await import('../src/server/services/comfyuiLiveMonitor.ts');
    const cancelledBatch = await batchExpansion.executeProgressiveAgentBatch({
      workflowId: wfRow.id,
      characterName: 'Subject',
      loras: [],
      aspectRatio: '2:3 (Portrait Photo)',
      theme: 'terrified horror sequence',
      count: 4,
    });
    markPromptsCancelled([], cancelledBatch.batch.id);
    ctx.db
      .prepare(`UPDATE generation_items SET status = 'cancelled' WHERE batch_id = ? AND status = 'pending'`)
      .run(cancelledBatch.batch.id);
    await cancelledBatch.progressiveTask;

    const cancelledItems = ctx.db
      .prepare(`SELECT item_index, prompt, status FROM generation_items WHERE batch_id = ? ORDER BY item_index ASC`)
      .all(cancelledBatch.batch.id) as Array<{ item_index: number; prompt: string; status: string }>;
    assert.equal(cancelledItems[1].status, 'cancelled');
    assert.equal(cancelledItems[1].prompt, '');
  });
});
