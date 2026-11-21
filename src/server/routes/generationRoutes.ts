import { Router } from 'express';
import { db } from '../db.ts';
import {
  checkLmStudioStatus,
  deleteLmStudioGuidingTemplate,
  listLmStudioGuidingTemplates,
  saveLmStudioGuidingTemplate,
  updateLmStudioSettings,
} from '../services/llm/llmClientService.ts';
import { interrogateImageToPrompt } from '../services/llm/llmImageAnalysisService.ts';
import {
  converseQuickGenPrompt,
  generatePhotoSetPromptsWithAgent,
} from '../services/llm/llmAgentService.ts';
import { importCivitaiImageForQuickGen } from '../services/civitai/civitaiImageShareService.ts';
import {
  dispatchGenerationBatch,
  listGenerationBatches,
} from '../services/generationDispatchService.ts';
import { executeRandomRoll } from '../services/randomRollService.ts';
import {
  type GenerationLoraSelection,
  type PromptTemplate,
  type QuickGenChatMessage,
} from '../../shared/types.ts';
import { getErrorMessage } from '../utils/httpError.ts';

interface PromptTemplateDbRow {
  id: number;
  name: string;
  positive_template: string;
  negative_template: string | null;
  is_default: number;
  category: string | null;
  created_at: string;
  updated_at: string;
}

export const generationRouter = Router();

function mapTemplateRow(row: PromptTemplateDbRow): PromptTemplate {
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
    .all() as PromptTemplateDbRow[];
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
    const saved = db
      .prepare('SELECT * FROM prompt_templates WHERE id = ?')
      .get(savedId) as PromptTemplateDbRow | undefined;
    const allRows = db
      .prepare('SELECT * FROM prompt_templates ORDER BY is_default DESC, updated_at DESC')
      .all() as PromptTemplateDbRow[];

    res.json({
      template: saved ? mapTemplateRow(saved) : null,
      items: allRows.map(mapTemplateRow),
    });
  } catch (err: unknown) {
    res.status(400).json({ error: getErrorMessage(err, 'Failed to save prompt template.') });
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
    .all() as PromptTemplateDbRow[];
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
  } catch (err: unknown) {
    res.status(400).json({ error: getErrorMessage(err, 'Failed to update Local LLM settings.') });
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
  } catch (err: unknown) {
    res.status(400).json({ error: getErrorMessage(err, 'Failed to save guiding template.') });
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
  } catch (err: unknown) {
    res.status(400).json({ error: getErrorMessage(err, 'Failed to delete guiding template.') });
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
      characterPhysicalDescription,
      loraNames,
      theme,
      count,
      basePromptTemplate,
      guidingTemplateId,
      expansionDirective,
      modelOverride,
      baseUrlOverride,
    } = req.body || {};

    if (!theme?.trim()) {
      return res.status(400).json({ error: 'Please enter a photo set concept or theme.' });
    }

    const result = await generatePhotoSetPromptsWithAgent({
      characterName: characterName || 'Character',
      characterDescription: characterDescription || '',
      characterPhysicalDescription: characterPhysicalDescription || '',
      loraNames: Array.isArray(loraNames) ? loraNames : [],
      theme: theme.trim(),
      count: Number(count) || 4,
      basePromptTemplate:
        basePromptTemplate ||
        'masterpiece, best quality, portrait of {character}, {lora}, {theme}',
      guidingTemplateId: guidingTemplateId ? Number(guidingTemplateId) : undefined,
      expansionDirective: typeof expansionDirective === 'string' ? expansionDirective : undefined,
      modelOverride,
      baseUrlOverride,
    });

    res.json(result);
  } catch (err: unknown) {
    res.status(400).json({ error: getErrorMessage(err, 'Failed to generate photo set prompts.') });
  }
});

/**
 * POST /api/generation/lmstudio/chat
 * Interactive multi-turn Quick Gen Agent Conversation mode via Local LLM.
 */
generationRouter.post('/lmstudio/chat', async (req, res) => {
  try {
    const {
      messages,
      characterName,
      characterDescription,
      characterPhysicalDescription,
      loraNames,
      excludedLoras,
      activePresetName,
      batchCount,
    } = req.body || {};
    if (!Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ error: 'Please enter a message to start the conversation.' });
    }
    const result = await converseQuickGenPrompt({
      messages,
      characterName: characterName ? String(characterName) : undefined,
      characterDescription: characterDescription ? String(characterDescription) : undefined,
      characterPhysicalDescription: characterPhysicalDescription
        ? String(characterPhysicalDescription)
        : undefined,
      loraNames: Array.isArray(loraNames) ? loraNames.map(String) : [],
      excludedLoras: Array.isArray(excludedLoras) ? excludedLoras.map(String) : [],
      activePresetName: activePresetName ? String(activePresetName) : undefined,
      batchCount: batchCount ? Number(batchCount) : 1,
    });
    res.json(result);
  } catch (err: unknown) {
    res.status(400).json({ error: getErrorMessage(err, 'Failed to converse with Local LLM.') });
  }
});

/**
 * POST /api/generation/interrogate-image
 * Runs hybrid Vision VLM or WD14 + Text LLM interrogation on a downscaled ~1MP image.
 */
generationRouter.post('/interrogate-image', async (req, res) => {
  try {
    const { imageBase64DataUrl, characterName, userHint } = req.body || {};
    if (!imageBase64DataUrl || typeof imageBase64DataUrl !== 'string') {
      return res.status(400).json({ error: 'Please provide an image to interrogate.' });
    }
    const result = await interrogateImageToPrompt({
      imageBase64DataUrl,
      characterName: characterName ? String(characterName) : undefined,
      userHint: userHint ? String(userHint).trim() : undefined,
    });
    res.json(result);
  } catch (err: unknown) {
    res.status(400).json({ error: getErrorMessage(err, 'Failed to interrogate image.') });
  }
});

/**
 * POST /api/generation/civitai-image
 * Extracts prompt, aspect ratio, and matching installed LoRAs/Base Model from a Civitai share URL.
 */
generationRouter.post('/civitai-image', async (req, res) => {
  try {
    const rawUrl = typeof req.body?.url === 'string' ? req.body.url.trim() : '';
    if (!rawUrl) {
      return res.status(400).json({ error: 'Please provide a Civitai image URL.' });
    }
    const result = await importCivitaiImageForQuickGen(rawUrl);
    res.json(result);
  } catch (err: unknown) {
    res
      .status(400)
      .json({ error: getErrorMessage(err, 'Failed to read Civitai image metadata.') });
  }
});

/**
 * GET /api/generation/batches
 */
generationRouter.get('/batches', (_req, res) => {
  res.json({ items: listGenerationBatches(25) });
});

/**
 * POST /api/generation/submit-batch
 * Compiles and dispatches all requested image generations at once to ComfyUI.
 */
generationRouter.post('/submit-batch', async (req, res) => {
  try {
    const body = (req.body || {}) as {
      characterId?: number | null;
      workflowId?: number;
      mode?: 'single' | 'theme_set';
      themeTitle?: string;
      aspectRatio?: string;
      megapixels?: number;
      steps?: number;
      prompts?: unknown[];
      triggerWord?: string;
      negativePrompt?: string;
      loras?: GenerationLoraSelection[];
      checkpointName?: string | null;
      baseSeed?: number;
      seriesId?: number | null;
      branchFromImageId?: number | null;
      inspirationFilename?: string | null;
      chatSnapshot?: QuickGenChatMessage[];
    };
    if (!body.workflowId) {
      return res.status(400).json({ error: 'Please select a ComfyUI workflow.' });
    }
    const promptList: string[] = Array.isArray(body.prompts)
      ? body.prompts.map((p) => String(p).trim()).filter(Boolean)
      : [];
    if (promptList.length === 0) {
      return res.status(400).json({ error: 'At least one positive prompt is required.' });
    }

    const result = await dispatchGenerationBatch({
      characterId: body.characterId,
      workflowId: Number(body.workflowId),
      mode: body.mode || 'single',
      themeTitle: body.themeTitle,
      aspectRatio: body.aspectRatio || '2:3 (Portrait Photo)',
      megapixels: body.megapixels,
      steps: body.steps,
      prompts: promptList,
      triggerWord: body.triggerWord,
      negativePrompt: body.negativePrompt ?? '',
      loras: Array.isArray(body.loras) ? body.loras : [],
      checkpointName: body.checkpointName,
      baseSeed: body.baseSeed,
      seriesId: body.seriesId,
      branchFromImageId: body.branchFromImageId,
      inspirationFilename: body.inspirationFilename,
      chatSnapshot: body.chatSnapshot,
    });

    res.json(result);
  } catch (err: unknown) {
    res.status(400).json({ error: getErrorMessage(err, 'Failed to submit generation batch.') });
  }
});

/**
 * POST /api/generation/random-roll
 * Rolls weighted-random character (or uses pinned characterId), compatible base model,
 * optional style LoRAs, popular tags, and aspect ratio, then dispatches immediately
 * (with progressive multi-shot generation when count > 1).
 */
generationRouter.post('/random-roll', async (req, res) => {
  try {
    const rawCharId = req.body?.characterId;
    const characterId =
      rawCharId !== undefined &&
      rawCharId !== null &&
      Number.isFinite(Number(rawCharId)) &&
      Number(rawCharId) > 0
        ? Number(rawCharId)
        : null;
    const rawCount = req.body?.count;
    const count =
      rawCount !== undefined && rawCount !== null && Number.isFinite(Number(rawCount))
        ? Math.max(1, Math.min(8, Math.round(Number(rawCount))))
        : 1;
    const { batch, batches, rollSummary, progressiveTask } = await executeRandomRoll({
      characterId,
      count,
    });
    if (progressiveTask) {
      void progressiveTask.catch(() => {
        // Errors are already logged and recorded per-item inside runProgressiveRandomRollShots
      });
    }
    res.json({ batch, batches, rollSummary });
  } catch (err: unknown) {
    res.status(400).json({ error: getErrorMessage(err, 'Failed to roll random generation.') });
  }
});
