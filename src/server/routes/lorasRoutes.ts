import { Router } from 'express';
import { listLoraExplorerItems } from '../services/galleryQueryService.ts';
import { updateLoraCategory } from '../services/characterService.ts';
import { triggerBackgroundCivitaiLinkHealOnce } from '../services/civitai/civitaiModelEnrichmentService.ts';
import { updateLoraMentionConfig, updateLoraVisibility } from '../services/modelInventoryService.ts';

export const lorasRouter = Router();

/**
 * GET /api/loras
 * Returns LoRA Explorer items with image counts, strength ranges, ratings, and character associations.
 */
lorasRouter.get('/loras', (_req, res) => {
  try {
    triggerBackgroundCivitaiLinkHealOnce();
    res.json({ items: listLoraExplorerItems() });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || 'Failed to list LoRAs' });
  }
});

/**
 * PATCH /api/loras/classify
 * Updates semantic classification of a LoRA (character, style, clothing, concept, pose, object, other).
 */
lorasRouter.patch('/loras/classify', (req, res) => {
  try {
    const { loraName, loraCategory, userNotes } = req.body || {};
    if (!loraName) {
      res.status(400).json({ error: 'loraName is required' });
      return;
    }
    updateLoraCategory(String(loraName), loraCategory || 'other', userNotes);
    res.json({ ok: true, items: listLoraExplorerItems() });
  } catch (err: any) {
    res.status(400).json({ error: err?.message || 'Failed to classify LoRA' });
  }
});

/**
 * PATCH /api/loras/visibility
 * Toggles whether a LoRA is hidden across Couchy's Explorer, @mention, Agent, and pickers.
 */
lorasRouter.patch('/loras/visibility', (req, res) => {
  try {
    const { loraName, isHidden } = req.body || {};
    if (!loraName) {
      res.status(400).json({ error: 'loraName is required' });
      return;
    }
    updateLoraVisibility(String(loraName), Boolean(isHidden));
    res.json({ ok: true, items: listLoraExplorerItems() });
  } catch (err: any) {
    res.status(400).json({ error: err?.message || 'Failed to update LoRA visibility' });
  }
});

/**
 * PATCH /api/loras/mention-config
 * Updates Quick Gen @mention settings (mention_enabled, nickname, default strengths) for a LoRA.
 */
lorasRouter.patch('/loras/mention-config', (req, res) => {
  try {
    const {
      loraName,
      name,
      mentionEnabled,
      nickname,
      defaultModelStrength,
      defaultClipStrength,
      triggerWord,
      llmDescription,
    } = req.body || {};
    if (!loraName) {
      res.status(400).json({ error: 'loraName is required' });
      return;
    }

    updateLoraMentionConfig({
      loraName: String(loraName),
      name,
      mentionEnabled,
      nickname,
      defaultModelStrength,
      defaultClipStrength,
      triggerWord,
      llmDescription,
    });

    res.json({ ok: true, items: listLoraExplorerItems() });
  } catch (err: any) {
    res.status(400).json({ error: err?.message || 'Failed to update LoRA mention settings' });
  }
});
