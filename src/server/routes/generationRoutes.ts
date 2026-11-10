import fs from 'fs';
import path from 'path';
import { Router } from 'express';
import { db } from '../db.ts';
import { appConfig } from '../config.ts';
import {
  compileWorkflowForGeneration,
  computeDimensionsFromMegapixels,
  getWorkflowMapping,
  saveWorkflowMapping,
} from '../services/workflowMapperService.ts';
import {
  checkLmStudioStatus,
  deleteLmStudioGuidingTemplate,
  generatePhotoSetPromptsWithAgent,
  listLmStudioGuidingTemplates,
  saveLmStudioGuidingTemplate,
  updateLmStudioSettings,
} from '../services/lmStudioService.ts';
import { indexSingleImageFile, runDirectoryScan } from '../services/scannerService.ts';
import { COUCHY_COMFY_CLIENT_ID, notifyImageIndexed } from '../services/comfyuiLiveMonitor.ts';
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
 * GET /api/generation/workflows/:id/mapping
 */
generationRouter.get('/workflows/:id/mapping', (req, res) => {
  try {
    const workflowId = Number(req.params.id);
    const result = getWorkflowMapping(workflowId);
    res.json(result);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

/**
 * POST /api/generation/workflows/:id/mapping
 */
generationRouter.post('/workflows/:id/mapping', (req, res) => {
  try {
    const workflowId = Number(req.params.id);
    const mapping = saveWorkflowMapping(workflowId, req.body || {});
    res.json({ mapping });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
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
 * Polls ComfyUI /history/<promptId> for a submitted generation item and links output images.
 */
function pollGenerationItem(
  itemId: number,
  promptId: string,
  characterId: number | null,
  attempt = 0
): void {
  if (attempt > 90) return;
  setTimeout(async () => {
    try {
      const res = await fetch(`${appConfig.comfyuiUrl}/history/${promptId}`);
      if (res.ok) {
        const hist = (await res.json()) as Record<string, any>;
        const entry = hist[promptId];
        if (entry) {
          const statusStr = entry.status?.status_str;
          if (statusStr === 'error') {
            db.prepare(
              `UPDATE generation_items
               SET status = 'failed', error_message = ?, completed_at = datetime('now')
               WHERE id = ?`
            ).run(JSON.stringify(entry.status?.messages || 'ComfyUI execution error'), itemId);
            return;
          }

          let matchedImageId: number | null = null;
          const outputs = entry.outputs || {};
          let anyIndexed = false;

          for (const nodeOut of Object.values(outputs) as any[]) {
            if (Array.isArray(nodeOut?.images) && nodeOut.images.length > 0) {
              for (const imgSpec of nodeOut.images) {
                const filename = imgSpec?.filename;
                const subfolder = imgSpec?.subfolder || '';
                if (!filename) continue;

                const fullPath = path.join(appConfig.comfyuiOutputDir, subfolder, filename);
                if (fs.existsSync(fullPath)) {
                  const resIndex = await indexSingleImageFile(
                    fullPath,
                    appConfig.comfyuiOutputDir,
                    false,
                    characterId
                  );
                  if (resIndex.imageId) {
                    matchedImageId = resIndex.imageId;
                    anyIndexed = true;
                  }
                } else {
                  // Fallback: check if already in images table
                  const imgRow = db
                    .prepare(
                      'SELECT id, content_hash FROM images WHERE filename = ? ORDER BY id DESC LIMIT 1'
                    )
                    .get(filename) as { id: number; content_hash: string } | undefined;
                  if (imgRow) {
                    matchedImageId = imgRow.id;
                  }
                }
              }
            }
          }

          if (anyIndexed) {
            notifyImageIndexed();
          } else {
            // Trigger background scan as safety net
            runDirectoryScan('incremental');
          }

          db.prepare(
            `UPDATE generation_items
             SET status = 'completed', output_image_id = COALESCE(?, output_image_id), completed_at = datetime('now')
             WHERE id = ?`
          ).run(matchedImageId, itemId);
          return;
        }
      }
      pollGenerationItem(itemId, promptId, characterId, attempt + 1);
    } catch {
      pollGenerationItem(itemId, promptId, characterId, attempt + 1);
    }
  }, 2500);
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

    const resolvedAr = normalizeResolutionSelectorRatio(aspectRatio);
    const resolvedMp = Math.max(0.1, Math.min(10.0, Number(megapixels) || 3.0));
    const { width: computedWidth, height: computedHeight } = computeDimensionsFromMegapixels(
      resolvedAr,
      resolvedMp
    );
    const loraSelections: GenerationLoraSelection[] = Array.isArray(loras) ? loras : [];

    // 1. Create batch and items in SQLite
    const batchInfo = db
      .prepare(
        `INSERT INTO generation_batches
          (character_id, workflow_id, theme_title, mode, total_count, aspect_ratio, megapixels, width, height)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
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
        computedHeight
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

          pollGenerationItem(
            item.itemId,
            promptId,
            characterId ? Number(characterId) : null
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
