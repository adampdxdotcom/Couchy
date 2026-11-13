import { Router } from 'express';
import { db } from '../db.ts';
import { appConfig } from '../config.ts';
import {
  compileUpscaleWorkflow,
  compileWorkflowForGeneration,
  computeDimensionsFromMegapixels,
  findInlineUpscaleNodes,
  getWorkflowDefaults,
} from '../services/workflowCompilerService.ts';
import {
  checkLmStudioStatus,
  converseQuickGenPrompt,
  deleteLmStudioGuidingTemplate,
  generatePhotoSetPromptsWithAgent,
  interrogateImageToPrompt,
  listLmStudioGuidingTemplates,
  saveLmStudioGuidingTemplate,
  updateLmStudioSettings,
} from '../services/lmStudioService.ts';
import { copyImageMetadataToDerivedImage } from '../services/scannerService.ts';
import {
  COUCHY_COMFY_CLIENT_ID,
  invalidateComfyQueueCache,
} from '../services/comfyuiLiveMonitor.ts';
import { pollComfyPromptCompletion } from '../services/comfyuiPoller.ts';
import { attachGenerationItemOutputToSeries } from '../services/seriesService.ts';
import {
  normalizeResolutionSelectorRatio,
  type GenerationBatchRecord,
  type GenerationLoraSelection,
  type PromptTemplate,
} from '../../shared/types.ts';

export const generationRouter = Router();

function mapTemplateRow(row: any): PromptTemplate {
  return {
    id: row.id,
    name: row.name,
    positiveTemplate: row.positive_template,
    negativeTemplate: row.negative_template || '',
    isDefault: Boolean(row.is_default),
    category: row.category || 'character',
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * GET /api/generation/templates
 */
generationRouter.get('/templates', (_req, res) => {
  const rows = db
    .prepare('SELECT * FROM prompt_templates ORDER BY is_default DESC, updated_at DESC')
    .all() as any[];
  res.json({ items: rows.map(mapTemplateRow) });
});

/**
 * POST /api/generation/templates
 */
generationRouter.post('/templates', (req, res) => {
  try {
    const { id, name, positiveTemplate, negativeTemplate, isDefault, category } = req.body || {};
    if (!name?.trim() || !positiveTemplate?.trim()) {
      return res.status(400).json({ error: 'Template name and positive prompt are required.' });
    }

    const tx = db.transaction(() => {
      if (isDefault) {
        db.prepare('UPDATE prompt_templates SET is_default = 0').run();
      }
      if (id) {
        db.prepare(
          `UPDATE prompt_templates
           SET name = ?, positive_template = ?, negative_template = ?,
               is_default = CASE WHEN ? = 1 THEN 1 ELSE is_default END,
               category = ?, updated_at = datetime('now')
           WHERE id = ?`
        ).run(
          name.trim(),
          positiveTemplate.trim(),
          (negativeTemplate || '').trim(),
          isDefault ? 1 : 0,
          category || 'character',
          Number(id)
        );
        return Number(id);
      } else {
        const info = db
          .prepare(
            `INSERT INTO prompt_templates (name, positive_template, negative_template, is_default, category)
             VALUES (?, ?, ?, ?, ?)`
          )
          .run(
            name.trim(),
            positiveTemplate.trim(),
            (negativeTemplate || '').trim(),
            isDefault ? 1 : 0,
            category || 'character'
          );
        return Number(info.lastInsertRowid);
      }
    });

    const savedId = tx();
    const saved = db.prepare('SELECT * FROM prompt_templates WHERE id = ?').get(savedId);
    const allRows = db
      .prepare('SELECT * FROM prompt_templates ORDER BY is_default DESC, updated_at DESC')
      .all() as any[];

    res.json({
      template: mapTemplateRow(saved),
      items: allRows.map(mapTemplateRow),
    });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

/**
 * DELETE /api/generation/templates/:id
 */
generationRouter.delete('/templates/:id', (req, res) => {
  const id = Number(req.params.id);
  db.prepare('DELETE FROM prompt_templates WHERE id = ?').run(id);
  const def = db.prepare('SELECT id FROM prompt_templates WHERE is_default = 1').get();
  if (!def) {
    const first = db.prepare('SELECT id FROM prompt_templates ORDER BY id ASC LIMIT 1').get() as
      | { id: number }
      | undefined;
    if (first) {
      db.prepare('UPDATE prompt_templates SET is_default = 1 WHERE id = ?').run(first.id);
    }
  }
  const allRows = db
    .prepare('SELECT * FROM prompt_templates ORDER BY is_default DESC, updated_at DESC')
    .all() as any[];
  res.json({ ok: true, items: allRows.map(mapTemplateRow) });
});

/**
 * GET /api/generation/lmstudio/status
 */
generationRouter.get('/lmstudio/status', async (req, res) => {
  const customUrl = typeof req.query.baseUrl === 'string' ? req.query.baseUrl : undefined;
  const status = await checkLmStudioStatus(customUrl);
  res.json(status);
});

/**
 * POST /api/generation/lmstudio/config
 */
generationRouter.post('/lmstudio/config', async (req, res) => {
  try {
    const updated = updateLmStudioSettings(req.body || {});
    const status = await checkLmStudioStatus(updated.baseUrl);
    res.json(status);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

/**
 * GET /api/generation/lmstudio/templates
 */
generationRouter.get('/lmstudio/templates', (_req, res) => {
  res.json({ items: listLmStudioGuidingTemplates() });
});

/**
 * POST /api/generation/lmstudio/templates
 */
generationRouter.post('/lmstudio/templates', (req, res) => {
  try {
    const result = saveLmStudioGuidingTemplate(req.body || {});
    res.json(result);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

/**
 * DELETE /api/generation/lmstudio/templates/:id
 */
generationRouter.delete('/lmstudio/templates/:id', (req, res) => {
  try {
    const id = Number(req.params.id);
    const items = deleteLmStudioGuidingTemplate(id);
    res.json({ ok: true, items });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

/**
 * POST /api/generation/lmstudio/generate-prompts
 */
generationRouter.post('/lmstudio/generate-prompts', async (req, res) => {
  try {
    const {
      characterName,
      characterDescription,
      loraNames,
      theme,
      count,
      basePromptTemplate,
      guidingTemplateId,
      modelOverride,
      baseUrlOverride,
    } = req.body || {};

    if (!theme?.trim()) {
      return res.status(400).json({ error: 'Please enter a photo set theme.' });
    }

    const result = await generatePhotoSetPromptsWithAgent({
      characterName: characterName || 'Character',
      characterDescription: characterDescription || '',
      loraNames: Array.isArray(loraNames) ? loraNames : [],
      theme: theme.trim(),
      count: Number(count) || 4,
      basePromptTemplate:
        basePromptTemplate ||
        'masterpiece, best quality, portrait of {character}, {lora}, {theme}',
      guidingTemplateId: guidingTemplateId ? Number(guidingTemplateId) : undefined,
      modelOverride,
      baseUrlOverride,
    });

    res.json(result);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

/**
 * POST /api/generation/lmstudio/chat
 * Interactive multi-turn Quick Gen Conversation mode via LM Studio.
 */
generationRouter.post('/lmstudio/chat', async (req, res) => {
  try {
    const { messages, characterName, characterDescription, loraNames } = req.body || {};
    if (!Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ error: 'Please enter a message to start the conversation.' });
    }
    const result = await converseQuickGenPrompt({
      messages,
      characterName: characterName ? String(characterName) : undefined,
      characterDescription: characterDescription ? String(characterDescription) : undefined,
      loraNames: Array.isArray(loraNames) ? loraNames.map(String) : [],
    });
    res.json(result);
  } catch (err: any) {
    res.status(400).json({ error: err?.message || 'Failed to converse with LM Studio.' });
  }
});

/**
 * POST /api/generation/interrogate-image
 * Runs hybrid Vision VLM or WD14 + Text LLM interrogation on a downscaled ~1MP image.
 */
generationRouter.post('/interrogate-image', async (req, res) => {
  try {
    const { imageBase64DataUrl, characterName } = req.body || {};
    if (!imageBase64DataUrl || typeof imageBase64DataUrl !== 'string') {
      return res.status(400).json({ error: 'Please provide an image to interrogate.' });
    }
    const result = await interrogateImageToPrompt({
      imageBase64DataUrl,
      characterName: characterName ? String(characterName) : undefined,
    });
    res.json(result);
  } catch (err: any) {
    res.status(400).json({ error: err?.message || 'Failed to interrogate image.' });
  }
});

/**
 * Helper to fetch recent generation batches with items.
 */
function listGenerationBatches(limit = 20): GenerationBatchRecord[] {
  const batchRows = db
    .prepare(
      `SELECT gb.*, c.name as character_name, w.name as workflow_name
       FROM generation_batches gb
       LEFT JOIN characters c ON c.id = gb.character_id
       LEFT JOIN workflows w ON w.id = gb.workflow_id
       ORDER BY gb.id DESC
       LIMIT ?`
    )
    .all(limit) as any[];

  const itemStmt = db.prepare(
    `SELECT gi.*, i.id as resolved_image_id
     FROM generation_items gi
     LEFT JOIN images i ON i.id = gi.output_image_id
     WHERE gi.batch_id = ?
     ORDER BY gi.item_index ASC`
  );

  return batchRows.map((b) => {
    const items = (itemStmt.all(b.id) as any[]).map((it) => ({
      id: it.id,
      batchId: it.batch_id,
      itemIndex: it.item_index,
      prompt: it.prompt,
      negativePrompt: it.negative_prompt || '',
      seed: it.seed,
      comfyuiPromptId: it.comfyui_prompt_id,
      status: it.status,
      errorMessage: it.error_message,
      outputImageId: it.resolved_image_id || null,
      outputThumbnailUrl: it.resolved_image_id
        ? `/api/images/${it.resolved_image_id}/thumbnail`
        : null,
      createdAt: it.created_at,
      completedAt: it.completed_at,
    }));

    return {
      id: b.id,
      characterId: b.character_id,
      characterName: b.character_name || null,
      workflowId: b.workflow_id,
      workflowName: b.workflow_name || null,
      themeTitle: b.theme_title || null,
      mode: b.mode,
      totalCount: b.total_count,
      aspectRatio: b.aspect_ratio || '2:3 (Portrait Photo)',
      megapixels: Number(b.megapixels ?? 1.0),
      width: b.width,
      height: b.height,
      createdAt: b.created_at,
      items,
    };
  });
}

/**
 * GET /api/generation/batches
 */
generationRouter.get('/batches', (_req, res) => {
  res.json({ items: listGenerationBatches(25) });
});

/**
 * Tracks a submitted generation item via the unified ComfyUI poller, chaining
 * `upscale_workflow.json` only if a legacy workflow without inline upscale ran >3MP.
 */
function trackGenerationItem(
  itemId: number,
  promptId: string,
  characterId: number | null,
  fallbackUpscaleMp?: number,
  baseImageId?: number | null
): void {
  pollComfyPromptCompletion({
    promptId,
    characterId,
    onSuccess: async ({ firstImageId, firstOutputSpec }) => {
      if (fallbackUpscaleMp && fallbackUpscaleMp > 3.0 && firstOutputSpec) {
        try {
          const upscalePayload = compileUpscaleWorkflow({
            imageFilename: firstOutputSpec.filename,
            subfolder: firstOutputSpec.subfolder,
            targetMegapixels: fallbackUpscaleMp,
          });
          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), 8000);
          const upRes = await fetch(`${appConfig.comfyuiUrl}/prompt`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            signal: controller.signal,
            body: JSON.stringify({
              prompt: upscalePayload,
              client_id: COUCHY_COMFY_CLIENT_ID,
            }),
          });
          clearTimeout(timer);

          if (upRes.ok) {
            const upData = (await upRes.json()) as { prompt_id?: string };
            if (upData.prompt_id) {
              db.prepare(
                `UPDATE generation_items
                 SET comfyui_prompt_id = ?, output_image_id = COALESCE(?, output_image_id)
                 WHERE id = ?`
              ).run(upData.prompt_id, firstImageId, itemId);
              invalidateComfyQueueCache();
              trackGenerationItem(itemId, upData.prompt_id, characterId, undefined, firstImageId);
              return;
            }
          }
        } catch (upErr) {
          console.warn('Automatic upscale pass failed, falling back to 3MP base image:', upErr);
        }
      }

      if (baseImageId && firstImageId && baseImageId !== firstImageId) {
        copyImageMetadataToDerivedImage(baseImageId, firstImageId);
      }

      const resolvedOutputImageId = firstImageId ?? baseImageId ?? null;
      db.prepare(
        `UPDATE generation_items
         SET status = 'completed', output_image_id = COALESCE(?, output_image_id), completed_at = datetime('now')
         WHERE id = ?`
      ).run(resolvedOutputImageId, itemId);

      if (resolvedOutputImageId) {
        try {
          attachGenerationItemOutputToSeries(itemId, resolvedOutputImageId);
        } catch (seriesErr) {
          console.warn('Failed to attach generated image to series:', seriesErr);
        }
      }
    },
    onError: (errMsg) => {
      db.prepare(
        `UPDATE generation_items
         SET status = 'failed', error_message = ?, completed_at = datetime('now')
         WHERE id = ?`
      ).run(errMsg, itemId);
    },
  });
}

/**
 * POST /api/generation/submit-batch
 * Compiles and dispatches all requested image generations at once to ComfyUI.
 */
generationRouter.post('/submit-batch', async (req, res) => {
  try {
    const {
      characterId,
      workflowId,
      mode,
      themeTitle,
      aspectRatio,
      megapixels,
      prompts,
      triggerWord,
      negativePrompt,
      loras,
      checkpointName,
      baseSeed,
      seriesId,
      branchFromImageId,
      chatSnapshot,
    } = req.body || {};

    if (!workflowId) {
      return res.status(400).json({ error: 'Please select a ComfyUI workflow.' });
    }
    const promptList: string[] = Array.isArray(prompts)
      ? prompts.map((p) => String(p).trim()).filter(Boolean)
      : [];
    if (promptList.length === 0) {
      return res.status(400).json({ error: 'At least one positive prompt is required.' });
    }

    // Read System Workflow defaults (megapixels, aspect ratio, diffusion model)
    let wfDefaultMp: number | null = null;
    let wfDefaultAr: string | null = null;
    let wfDefaultCkpt: string | null = null;
    try {
      const wfDefaults = getWorkflowDefaults(Number(workflowId));
      wfDefaultMp = wfDefaults.defaultMegapixels ?? null;
      wfDefaultAr = wfDefaults.defaultAspectRatio ?? null;
      wfDefaultCkpt = wfDefaults.defaultCheckpoint ?? null;
    } catch {
      // Fallback if defaults lookup fails
    }

    const resolvedAr = normalizeResolutionSelectorRatio(aspectRatio || wfDefaultAr || undefined);
    const explicitMp =
      megapixels !== undefined && megapixels !== null && Number(megapixels) > 0
        ? Number(megapixels)
        : null;
    const resolvedMp = Math.max(
      0.5,
      Math.min(10.0, explicitMp ?? wfDefaultMp ?? 3.0)
    );
    const { width: computedWidth, height: computedHeight } = computeDimensionsFromMegapixels(
      resolvedAr,
      resolvedMp
    );
    const loraSelections: GenerationLoraSelection[] = Array.isArray(loras) ? loras : [];
    const activeLorasCount = loraSelections.filter((l) => Boolean(l.loraName?.trim())).length;

    // Resolve checkpoint name from request or mapped workflow checkpoint node
    const resolvedCheckpointName: string | null = checkpointName
      ? String(checkpointName).trim()
      : wfDefaultCkpt;

    const serializedChatSnapshot =
      Array.isArray(chatSnapshot) && chatSnapshot.length > 0
        ? JSON.stringify(chatSnapshot)
        : null;

    // 1. Create batch and items in SQLite
    const batchInfo = db
      .prepare(
        `INSERT INTO generation_batches
          (character_id, workflow_id, theme_title, mode, total_count, aspect_ratio, megapixels, width, height, checkpoint_name, lora_count, series_id, branch_from_image_id, chat_snapshot_json)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        characterId ? Number(characterId) : null,
        Number(workflowId),
        themeTitle ? String(themeTitle).trim() : null,
        mode === 'theme_set' ? 'theme_set' : 'single',
        promptList.length,
        resolvedAr,
        resolvedMp,
        computedWidth,
        computedHeight,
        resolvedCheckpointName,
        activeLorasCount,
        seriesId ? Number(seriesId) : null,
        branchFromImageId ? Number(branchFromImageId) : null,
        serializedChatSnapshot
      );
    const batchId = Number(batchInfo.lastInsertRowid);

    const insertItem = db.prepare(
      `INSERT INTO generation_items
        (batch_id, item_index, prompt, negative_prompt, seed, status)
       VALUES (?, ?, ?, ?, ?, 'pending')`
    );

    const createdItems: { itemId: number; index: number; prompt: string; seed: string }[] = [];
    const hasFixedBaseSeed = Boolean(baseSeed && Number(baseSeed) > 0);
    const startingSeed = hasFixedBaseSeed
      ? Math.floor(Number(baseSeed))
      : Math.floor(Math.random() * 1e15) + 1;

    for (let i = 0; i < promptList.length; i++) {
      // Generate an independent random 64-bit integer (1..10^15) per shot unless a fixed baseSeed was given
      const itemSeed = hasFixedBaseSeed
        ? String(startingSeed + i)
        : String(Math.floor(Math.random() * 1e15) + 1);
      const info = insertItem.run(
        batchId,
        i + 1,
        promptList[i],
        (negativePrompt || '').trim(),
        itemSeed
      );
      createdItems.push({
        itemId: Number(info.lastInsertRowid),
        index: i + 1,
        prompt: promptList[i],
        seed: itemSeed,
      });
    }

    // 2. Dispatch all items at once to ComfyUI /prompt concurrently
    await Promise.all(
      createdItems.map(async (item) => {
        try {
          const apiPayload = compileWorkflowForGeneration({
            workflowId: Number(workflowId),
            positivePrompt: item.prompt,
            triggerWord: triggerWord !== undefined ? String(triggerWord) : undefined,
            negativePrompt: (negativePrompt || '').trim(),
            seed: item.seed,
            aspectRatio: resolvedAr,
            megapixels: resolvedMp,
            width: computedWidth,
            height: computedHeight,
            loras: loraSelections,
            checkpointName: checkpointName || undefined,
          });
          const hasInlineUpscale = Boolean(findInlineUpscaleNodes(apiPayload));

          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), 8000);
          const comfyRes = await fetch(`${appConfig.comfyuiUrl}/prompt`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            signal: controller.signal,
            body: JSON.stringify({
              prompt: apiPayload,
              client_id: COUCHY_COMFY_CLIENT_ID,
            }),
          });
          clearTimeout(timer);

          if (!comfyRes.ok) {
            const errText = await comfyRes.text();
            throw new Error(`ComfyUI HTTP ${comfyRes.status}: ${errText}`);
          }

          const data = (await comfyRes.json()) as { prompt_id?: string };
          const promptId = data.prompt_id || `prompt-${Date.now()}-${item.itemId}`;

          db.prepare(
            `UPDATE generation_items
             SET comfyui_prompt_id = ?, status = 'submitted'
             WHERE id = ?`
          ).run(promptId, item.itemId);

          // Primary workflow handles >3MP inline via Switch #51; only fall back to two-pass upscale if absent
          trackGenerationItem(
            item.itemId,
            promptId,
            characterId ? Number(characterId) : null,
            resolvedMp > 3.0 && !hasInlineUpscale ? resolvedMp : undefined
          );
        } catch (err: any) {
          db.prepare(
            `UPDATE generation_items
             SET status = 'failed', error_message = ?, completed_at = datetime('now')
             WHERE id = ?`
          ).run(err?.message || 'Failed to submit to ComfyUI', item.itemId);
        }
      })
    );

    invalidateComfyQueueCache();

    const batches = listGenerationBatches(25);
    const createdBatch = batches.find((b) => b.id === batchId) || batches[0];

    res.json({
      batch: createdBatch,
      batches,
    });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});
