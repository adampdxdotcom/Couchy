import { db } from '../db.ts';
import { normalizePresetPillColor } from '../../shared/pillSettings.ts';
import type {
  LoraCategory,
  LoraPreset,
  LoraPresetItem,
  LoraPresetPayload,
} from '../../shared/types.ts';

export const MAX_LORAS_PER_PRESET = 5;

function clampStrength(value: unknown, fallback = 1.0): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(-10.0, Math.min(10.0, Math.round(n * 100) / 100));
}

function normalizeModelKey(name: string): string {
  return name
    .trim()
    .replace(/\\/g, '/')
    .split('/')
    .pop()!
    .replace(/\.(safetensors|pt|ckpt|pth|bin|gguf|sft)$/i, '')
    .toLowerCase();
}

function cleanNickname(raw?: string | null): string {
  return (raw || '').trim().replace(/^@+/, '').replace(/\s+/g, '-').toLowerCase();
}

/**
 * Lists all saved LoRA Presets with resolved Base Model & LoRA metadata (display name, availability, trigger words).
 */
export function listLoraPresets(): LoraPreset[] {
  const presetRows = db
    .prepare(
      `SELECT *
       FROM lora_presets
       ORDER BY LOWER(name) ASC, id ASC`
    )
    .all() as any[];

  if (presetRows.length === 0) return [];

  const itemRows = db
    .prepare(
      `SELECT *
       FROM lora_preset_items
       ORDER BY preset_id ASC, sort_order ASC, id ASC`
    )
    .all() as any[];

  const modelRows = db
    .prepare(
      `SELECT name, filename, model_type, lora_category, is_installed, nickname
       FROM models`
    )
    .all() as Array<{
    name: string;
    filename: string;
    model_type: string;
    lora_category: string;
    is_installed: number;
    nickname: string | null;
  }>;

  const charLoraRows = db
    .prepare(
      `SELECT lora_name, trigger_word
       FROM character_loras`
    )
    .all() as Array<{ lora_name: string; trigger_word: string | null }>;

  const loraModelMap = new Map<string, typeof modelRows[number]>();
  const baseModelMap = new Map<string, typeof modelRows[number]>();
  for (const m of modelRows) {
    const kFile = normalizeModelKey(m.filename);
    const kName = normalizeModelKey(m.name);
    if (m.model_type === 'lora') {
      if (kFile) loraModelMap.set(kFile, m);
      if (kName && !loraModelMap.has(kName)) loraModelMap.set(kName, m);
    } else if (m.model_type === 'diffusion' || m.model_type === 'checkpoint') {
      if (kFile) baseModelMap.set(kFile, m);
      if (kName && !baseModelMap.has(kName)) baseModelMap.set(kName, m);
    }
  }

  const triggerMap = new Map<string, string>();
  for (const cl of charLoraRows) {
    const k = normalizeModelKey(cl.lora_name);
    if (k && cl.trigger_word?.trim() && !triggerMap.has(k)) {
      triggerMap.set(k, cl.trigger_word.trim());
    }
  }

  const itemsByPreset = new Map<number, LoraPresetItem[]>();
  for (const row of itemRows) {
    const key = normalizeModelKey(row.lora_name);
    const matched = loraModelMap.get(key);
    const item: LoraPresetItem = {
      id: row.id,
      presetId: row.preset_id,
      loraName: matched?.filename || row.lora_name,
      modelStrength: clampStrength(row.model_strength, 1.0),
      clipStrength: clampStrength(row.clip_strength, clampStrength(row.model_strength, 1.0)),
      sortOrder: Number(row.sort_order ?? 0),
      displayName:
        matched?.nickname?.trim().replace(/^@+/, '') ||
        matched?.name ||
        row.lora_name.replace(/\.(safetensors|pt|ckpt)$/i, ''),
      triggerWord: triggerMap.get(key) || null,
      isInstalled: matched ? Boolean(matched.is_installed) : true,
      loraCategory: (matched?.lora_category as LoraCategory) || 'unclassified',
    };
    const arr = itemsByPreset.get(row.preset_id) || [];
    arr.push(item);
    itemsByPreset.set(row.preset_id, arr);
  }

  return presetRows.map((p) => {
    const ckptRaw = (p.checkpoint_name || '').trim() || null;
    const ckptMeta = ckptRaw ? baseModelMap.get(normalizeModelKey(ckptRaw)) : undefined;
    return {
      id: p.id,
      name: p.name,
      nickname: p.nickname || '',
      userDescription: p.user_description || '',
      agentDescription: p.agent_description || '',
      pillColor: normalizePresetPillColor(p.pill_color),
      checkpointName: ckptMeta?.filename || ckptRaw,
      checkpointDisplayName: ckptRaw
        ? ckptMeta?.nickname?.trim().replace(/^@+/, '') ||
          ckptMeta?.name ||
          ckptRaw.replace(/\.(safetensors|pt|ckpt|gguf|sft)$/i, '')
        : null,
      checkpointInstalled: ckptRaw ? (ckptMeta ? Boolean(ckptMeta.is_installed) : true) : true,
      items: itemsByPreset.get(p.id) || [],
      createdAt: p.created_at,
      updatedAt: p.updated_at,
    };
  });
}

/** Creates or updates a LoRA Preset inside a transaction and returns the saved preset + updated list. */
export function saveLoraPreset(
  payload: LoraPresetPayload & { id?: number }
): { preset: LoraPreset; items: LoraPreset[] } {
  const cleanName = (payload.name || '').trim();
  if (!cleanName) {
    throw new Error('Preset name is required.');
  }

  const normalizedNick = cleanNickname(payload.nickname);
  const pillColor = normalizePresetPillColor(payload.pillColor);
  const checkpointName = (payload.checkpointName || '').trim() || null;
  const userDescription = (payload.userDescription || '').trim();
  const agentDescription = (payload.agentDescription || '').trim();

  const rawItems = Array.isArray(payload.items) ? payload.items : [];
  const seenLoras = new Set<string>();
  const cleanItems: Array<{ loraName: string; modelStrength: number; clipStrength: number }> = [];
  for (const item of rawItems) {
    const loraName = (item?.loraName || '').trim();
    const key = normalizeModelKey(loraName);
    if (!key || seenLoras.has(key)) continue;
    seenLoras.add(key);
    const modelStrength = clampStrength(item.modelStrength, 1.0);
    const clipStrength = clampStrength(item.clipStrength ?? modelStrength, modelStrength);
    cleanItems.push({ loraName, modelStrength, clipStrength });
  }

  if (cleanItems.length > MAX_LORAS_PER_PRESET) {
    throw new Error(`A preset can include at most ${MAX_LORAS_PER_PRESET} LoRAs.`);
  }
  if (!checkpointName && cleanItems.length === 0) {
    throw new Error('Select at least one Base Model or LoRA for this preset.');
  }

  // Prevent colliding preset handles when a custom nickname is configured
  if (normalizedNick) {
    const existingNick = db
      .prepare('SELECT id FROM lora_presets WHERE LOWER(nickname) = LOWER(?) AND id != ?')
      .get(normalizedNick, payload.id ? Number(payload.id) : -1) as { id: number } | undefined;
    if (existingNick) {
      throw new Error(`Preset pill nickname @${normalizedNick} is already in use.`);
    }
  }

  const savedId = db.transaction(() => {
    let targetId = payload.id ? Number(payload.id) : null;
    if (targetId) {
      const exists = db.prepare('SELECT id FROM lora_presets WHERE id = ?').get(targetId);
      if (!exists) {
        throw new Error('Preset not found.');
      }
      db.prepare(
        `UPDATE lora_presets
         SET name = ?, nickname = ?, user_description = ?, agent_description = ?,
             pill_color = ?, checkpoint_name = ?, updated_at = datetime('now')
         WHERE id = ?`
      ).run(
        cleanName,
        normalizedNick,
        userDescription,
        agentDescription,
        pillColor,
        checkpointName,
        targetId
      );
      db.prepare('DELETE FROM lora_preset_items WHERE preset_id = ?').run(targetId);
    } else {
      const info = db
        .prepare(
          `INSERT INTO lora_presets
             (name, nickname, user_description, agent_description, pill_color, checkpoint_name)
           VALUES (?, ?, ?, ?, ?, ?)`
        )
        .run(
          cleanName,
          normalizedNick,
          userDescription,
          agentDescription,
          pillColor,
          checkpointName
        );
      targetId = Number(info.lastInsertRowid);
    }

    const insertItem = db.prepare(
      `INSERT INTO lora_preset_items (preset_id, lora_name, model_strength, clip_strength, sort_order)
       VALUES (?, ?, ?, ?, ?)`
    );
    cleanItems.forEach((item, index) => {
      insertItem.run(targetId, item.loraName, item.modelStrength, item.clipStrength, index);
    });

    return targetId;
  })();

  const allItems = listLoraPresets();
  const preset = allItems.find((p) => p.id === savedId);
  if (!preset) {
    throw new Error('Saved preset could not be reloaded.');
  }
  return { preset, items: allItems };
}

/** Deletes a saved LoRA Preset by id and returns the updated list. */
export function deleteLoraPreset(id: number): LoraPreset[] {
  const numericId = Number(id);
  const info = db.prepare('DELETE FROM lora_presets WHERE id = ?').run(numericId);
  if (info.changes === 0) {
    throw new Error('Preset not found.');
  }
  return listLoraPresets();
}
