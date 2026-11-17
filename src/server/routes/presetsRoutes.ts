import { Router } from 'express';
import {
  deleteLoraPreset,
  listLoraPresets,
  saveLoraPreset,
} from '../services/presetsService.ts';

export const presetsRouter = Router();

/** GET /api/presets */
presetsRouter.get('/', (_req, res) => {
  try {
    res.json({ items: listLoraPresets() });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || 'Failed to load presets.' });
  }
});

/** POST /api/presets */
presetsRouter.post('/', (req, res) => {
  try {
    const result = saveLoraPreset(req.body || {});
    res.status(201).json(result);
  } catch (err: any) {
    res.status(400).json({ error: err?.message || 'Failed to create preset.' });
  }
});

/** PUT /api/presets/:id */
presetsRouter.put('/:id', (req, res) => {
  try {
    const id = Number(req.params.id);
    const result = saveLoraPreset({ ...(req.body || {}), id });
    res.json(result);
  } catch (err: any) {
    res.status(400).json({ error: err?.message || 'Failed to update preset.' });
  }
});

/** DELETE /api/presets/:id */
presetsRouter.delete('/:id', (req, res) => {
  try {
    const items = deleteLoraPreset(Number(req.params.id));
    res.json({ ok: true, items });
  } catch (err: any) {
    res.status(404).json({ error: err?.message || 'Failed to delete preset.' });
  }
});
