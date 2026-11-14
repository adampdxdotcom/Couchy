import { db } from '../db.ts';

export interface LoraMentionConfigInput {
  loraName: string;
  mentionEnabled?: unknown;
  nickname?: unknown;
  defaultModelStrength?: unknown;
  defaultClipStrength?: unknown;
  triggerWord?: unknown;
  llmDescription?: unknown;
}

/**
 * Persists visibility (hidden vs shown across Explorer, @mention, Agent, and pickers) for a LoRA.
 */
export function updateLoraVisibility(loraName: string, isHidden: boolean): void {
  const cleanName = loraName.trim();
  const hiddenFlag = isHidden ? 1 : 0;

  db.prepare(
    `INSERT INTO models (name, filename, model_type, lora_category, is_hidden)
     VALUES (?, ?, 'lora', 'unclassified', ?)
     ON CONFLICT(filename) DO UPDATE SET
       is_hidden = excluded.is_hidden`
  ).run(cleanName.replace(/\.(safetensors|pt|ckpt)$/i, ''), cleanName, hiddenFlag);
}

/**
 * Updates Quick Gen @mention settings (nickname, strengths, trigger word, description)
 * with nickname uniqueness checks and strength clamping.
 */
export function updateLoraMentionConfig(input: LoraMentionConfigInput): void {
  const {
    loraName,
    mentionEnabled,
    nickname,
    defaultModelStrength,
    defaultClipStrength,
    triggerWord,
    llmDescription,
  } = input;

  const existingRow = db
    .prepare(
      `SELECT id, filename, nickname, mention_enabled, default_model_strength, default_clip_strength, trigger_word, llm_description
       FROM models WHERE LOWER(filename) = LOWER(?)`
    )
    .get(loraName) as
    | {
        id: number;
        filename: string;
        nickname: string | null;
        mention_enabled: number;
        default_model_strength: number | null;
        default_clip_strength: number | null;
        trigger_word: string | null;
        llm_description: string | null;
      }
    | undefined;

  const cleanNick =
    nickname !== undefined
      ? typeof nickname === 'string'
        ? nickname.trim().replace(/^@+/, '').toLowerCase() || null
        : null
      : (existingRow?.nickname ?? null);

  if (cleanNick) {
    const existing = db
      .prepare(
        `SELECT filename FROM models WHERE LOWER(nickname) = ? AND LOWER(filename) != LOWER(?)`
      )
      .get(cleanNick, loraName) as { filename: string } | undefined;
    if (existing) {
      throw new Error(`Nickname "@${cleanNick}" is already assigned to ${existing.filename}`);
    }
  }

  const cleanTriggerWord =
    triggerWord !== undefined
      ? typeof triggerWord === 'string'
        ? triggerWord.trim() || null
        : null
      : (existingRow?.trigger_word ?? null);

  const cleanLlmDescription =
    llmDescription !== undefined
      ? typeof llmDescription === 'string'
        ? llmDescription.trim() || null
        : null
      : (existingRow?.llm_description ?? null);

  const cleanModelStr =
    defaultModelStrength !== undefined && !Number.isNaN(Number(defaultModelStrength))
      ? Math.max(0.0, Math.min(2.0, Number(defaultModelStrength)))
      : (existingRow?.default_model_strength ?? 1.0);
  const cleanClipStr =
    defaultClipStrength !== undefined && !Number.isNaN(Number(defaultClipStrength))
      ? Math.max(0.0, Math.min(2.0, Number(defaultClipStrength)))
      : (existingRow?.default_clip_strength ?? 1.0);
  const isMention =
    mentionEnabled !== undefined ? (mentionEnabled ? 1 : 0) : (existingRow?.mention_enabled ?? 0);

  if (existingRow) {
    db.prepare(
      `UPDATE models
       SET nickname = ?,
           mention_enabled = ?,
           default_model_strength = ?,
           default_clip_strength = ?,
           trigger_word = ?,
           llm_description = ?
       WHERE id = ?`
    ).run(
      cleanNick,
      isMention,
      cleanModelStr,
      cleanClipStr,
      cleanTriggerWord,
      cleanLlmDescription,
      existingRow.id
    );
  } else {
    db.prepare(
      `INSERT INTO models (name, filename, model_type, lora_category, nickname, mention_enabled, default_model_strength, default_clip_strength, trigger_word, llm_description)
       VALUES (?, ?, 'lora', 'unclassified', ?, ?, ?, ?, ?, ?)`
    ).run(
      loraName.replace(/\.(safetensors|pt|ckpt)$/i, ''),
      loraName,
      cleanNick,
      isMention,
      cleanModelStr,
      cleanClipStr,
      cleanTriggerWord,
      cleanLlmDescription
    );
  }
}
