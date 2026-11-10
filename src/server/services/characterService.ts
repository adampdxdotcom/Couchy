import { db } from '../db.ts';
import type { CharacterProfile, LoraCategory } from '../../shared/types.ts';

/**
 * First-Class Character Organization & Assisted Character Identification Service.
 */
export function listCharacterProfiles(): CharacterProfile[] {
  const rows = db
    .prepare(
      `
      SELECT
        c.*,
        img.id AS resolved_portrait_id
      FROM characters c
      LEFT JOIN images img ON (c.portrait_content_hash IS NOT NULL AND img.content_hash = c.portrait_content_hash)
        OR (c.portrait_image_id IS NOT NULL AND img.id = c.portrait_image_id)
      ORDER BY c.name COLLATE NOCASE ASC
    `
    )
    .all() as any[];

  return rows.map((row) => buildCharacterProfile(row));
}

export function getCharacterProfileById(characterId: number): CharacterProfile | null {
  const row = db
    .prepare(
      `
      SELECT
        c.*,
        img.id AS resolved_portrait_id
      FROM characters c
      LEFT JOIN images img ON (c.portrait_content_hash IS NOT NULL AND img.content_hash = c.portrait_content_hash)
        OR (c.portrait_image_id IS NOT NULL AND img.id = c.portrait_image_id)
      WHERE c.id = ?
    `
    )
    .get(characterId) as any;

  if (!row) return null;
  return buildCharacterProfile(row);
}

function buildCharacterProfile(row: any): CharacterProfile {
  const aliases = db
    .prepare('SELECT id, alias FROM character_aliases WHERE character_id = ? ORDER BY alias ASC')
    .all(row.id) as { id: number; alias: string }[];

  const loras = db
    .prepare(
      `
      SELECT
        cl.id,
        cl.model_id AS modelId,
        cl.lora_name AS loraName,
        cl.lora_hash AS loraHash,
        cl.lora_category AS loraCategory,
        cl.appearance_label AS appearanceLabel,
        COALESCE(cl.trigger_word, '') AS triggerWord,
        cl.notes,
        COALESCE(m.is_installed, 0) AS isInstalled
      FROM character_loras cl
      LEFT JOIN models m ON m.id = cl.model_id OR LOWER(m.filename) = LOWER(cl.lora_name)
      WHERE cl.character_id = ?
      ORDER BY cl.lora_name ASC
    `
    )
    .all(row.id) as any[];

  const workflows = db
    .prepare(
      `
      SELECT
        cw.workflow_id AS workflowId,
        w.name AS workflowName,
        cw.role_label AS roleLabel
      FROM character_workflows cw
      JOIN workflows w ON w.id = cw.workflow_id
      WHERE cw.character_id = ?
    `
    )
    .all(row.id) as any[];

  const tags = db
    .prepare(
      `
      SELECT t.id, t.name, t.color
      FROM character_tags ct
      JOIN tags t ON t.id = ct.tag_id
      WHERE ct.character_id = ?
    `
    )
    .all(row.id) as any[];

  const collections = db
    .prepare(
      `
      SELECT col.id, col.name
      FROM character_collections cc
      JOIN collections col ON col.id = cc.collection_id
      WHERE cc.character_id = ?
    `
    )
    .all(row.id) as any[];

  const stats = db
    .prepare(
      `
      SELECT
        SUM(CASE WHEN ic.status = 'confirmed' THEN 1 ELSE 0 END) AS confirmedCount,
        SUM(CASE WHEN ic.status = 'suggested' THEN 1 ELSE 0 END) AS suggestedCount,
        AVG(CASE WHEN ic.status = 'confirmed' AND r.rating > 0 THEN r.rating ELSE NULL END) AS avgRating,
        MIN(CASE WHEN ic.status = 'confirmed' THEN i.file_mtime ELSE NULL END) AS firstGen,
        MAX(CASE WHEN ic.status = 'confirmed' THEN i.file_mtime ELSE NULL END) AS latestGen
      FROM image_characters ic
      LEFT JOIN images i ON i.content_hash = ic.image_content_hash AND i.is_missing = 0
      LEFT JOIN ratings r ON r.content_hash = ic.image_content_hash
      WHERE ic.character_id = ?
    `
    )
    .get(row.id) as any;

  // Fallback portrait to highest-rated confirmed image for this character if none explicitly set
  let portraitId = row.resolved_portrait_id || null;
  if (!portraitId) {
    const fallbackImg = db
      .prepare(
        `
        SELECT i.id
        FROM image_characters ic
        JOIN images i ON i.content_hash = ic.image_content_hash AND i.is_missing = 0
        LEFT JOIN ratings r ON r.content_hash = i.content_hash
        WHERE ic.character_id = ? AND ic.status = 'confirmed'
        ORDER BY COALESCE(r.rating, 0) DESC, i.file_mtime DESC
        LIMIT 1
      `
      )
      .get(row.id) as { id: number } | undefined;
    if (fallbackImg) portraitId = fallbackImg.id;
  }

  return {
    id: row.id,
    name: row.name,
    description: row.description || '',
    notes: row.notes || '',
    portraitImageId: portraitId,
    portraitContentHash: row.portrait_content_hash || null,
    portraitThumbnailUrl: portraitId ? `/api/images/${portraitId}/thumbnail` : null,
    aliases,
    loras: loras.map((l) => ({
      ...l,
      isInstalled: Boolean(l.isInstalled),
    })),
    workflows,
    tags,
    collections,
    confirmedImageCount: Number(stats?.confirmedCount || 0),
    suggestedImageCount: Number(stats?.suggestedCount || 0),
    averageRating: Number(stats?.avgRating ? Number(stats.avgRating).toFixed(2) : 0),
    firstGenerationDate: stats?.firstGen || null,
    latestGenerationDate: stats?.latestGen || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * Transactional merge of sourceCharacterId into targetCharacterId,
 * preserving all aliases, image associations, LoRAs, workflows, tags, collections, and notes.
 */
export function mergeCharacters(targetCharacterId: number, sourceCharacterId: number): CharacterProfile {
  if (targetCharacterId === sourceCharacterId) {
    throw new Error('Cannot merge a character into itself.');
  }

  const target = db.prepare('SELECT * FROM characters WHERE id = ?').get(targetCharacterId) as any;
  const source = db.prepare('SELECT * FROM characters WHERE id = ?').get(sourceCharacterId) as any;
  if (!target || !source) {
    throw new Error('One or both character records do not exist.');
  }

  const tx = db.transaction(() => {
    // 1. Add source primary name and aliases to target aliases
    db.prepare('INSERT OR IGNORE INTO character_aliases (character_id, alias) VALUES (?, ?)').run(
      targetCharacterId,
      source.name
    );
    const sourceAliases = db
      .prepare('SELECT alias FROM character_aliases WHERE character_id = ?')
      .all(sourceCharacterId) as { alias: string }[];
    for (const a of sourceAliases) {
      if (a.alias.toLowerCase() !== target.name.toLowerCase()) {
        db.prepare('INSERT OR IGNORE INTO character_aliases (character_id, alias) VALUES (?, ?)').run(
          targetCharacterId,
          a.alias
        );
      }
    }

    // 2. Move LoRA links
    const sourceLoras = db
      .prepare('SELECT * FROM character_loras WHERE character_id = ?')
      .all(sourceCharacterId) as any[];
    for (const l of sourceLoras) {
      db.prepare(
        `INSERT OR IGNORE INTO character_loras
          (character_id, model_id, lora_name, lora_hash, lora_category, appearance_label, trigger_word, notes)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        targetCharacterId,
        l.model_id,
        l.lora_name,
        l.lora_hash,
        l.lora_category,
        l.appearance_label,
        l.trigger_word || '',
        l.notes
      );
    }

    // 3. Move Image associations (upgrading suggested -> confirmed if source was confirmed)
    const sourceImgs = db
      .prepare('SELECT * FROM image_characters WHERE character_id = ?')
      .all(sourceCharacterId) as any[];
    for (const ic of sourceImgs) {
      const existing = db
        .prepare('SELECT * FROM image_characters WHERE image_content_hash = ? AND character_id = ?')
        .get(ic.image_content_hash, targetCharacterId) as any;
      if (!existing) {
        db.prepare(
          `INSERT INTO image_characters
            (image_id, image_content_hash, character_id, status, source, confidence, match_reason, appearance_label)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
        ).run(
          ic.image_id,
          ic.image_content_hash,
          targetCharacterId,
          ic.status,
          ic.source,
          ic.confidence,
          ic.match_reason,
          ic.appearance_label
        );
      } else if (ic.status === 'confirmed' && existing.status !== 'confirmed') {
        db.prepare(
          `UPDATE image_characters
           SET status = 'confirmed', source = ?, confidence = 1.0, updated_at = datetime('now')
           WHERE id = ?`
        ).run(ic.source, existing.id);
      }
    }

    // 4. Move Workflows, Tags, Collections
    db.prepare(
      'INSERT OR IGNORE INTO character_workflows (character_id, workflow_id, role_label) SELECT ?, workflow_id, role_label FROM character_workflows WHERE character_id = ?'
    ).run(targetCharacterId, sourceCharacterId);
    db.prepare(
      'INSERT OR IGNORE INTO character_tags (character_id, tag_id) SELECT ?, tag_id FROM character_tags WHERE character_id = ?'
    ).run(targetCharacterId, sourceCharacterId);
    db.prepare(
      'INSERT OR IGNORE INTO character_collections (character_id, collection_id) SELECT ?, collection_id FROM character_collections WHERE character_id = ?'
    ).run(targetCharacterId, sourceCharacterId);

    // 5. Merge description & notes
    const mergedDesc = [target.description, source.description].filter(Boolean).join('\n\n');
    const mergedNotes = [
      target.notes,
      source.notes ? `[Merged from ${source.name}]: ${source.notes}` : '',
    ]
      .filter(Boolean)
      .join('\n\n');

    db.prepare(
      `UPDATE characters
       SET description = ?, notes = ?,
           portrait_image_id = COALESCE(portrait_image_id, ?),
           portrait_content_hash = COALESCE(portrait_content_hash, ?),
           updated_at = datetime('now')
       WHERE id = ?`
    ).run(
      mergedDesc,
      mergedNotes,
      source.portrait_image_id,
      source.portrait_content_hash,
      targetCharacterId
    );

    // 6. Delete merged source record
    db.prepare('DELETE FROM characters WHERE id = ?').run(sourceCharacterId);
  });

  tx();
  runAssistedCharacterIdentificationForAll();
  return getCharacterProfileById(targetCharacterId)!;
}

/**
 * Deterministic Assisted Character Identification Engine.
 * Evaluates a single image or all indexed images against known Character LoRAs, Prompt Names/Aliases, and Workflows.
 * Never overwrites confirmed or rejected associations.
 */
export function runAssistedCharacterIdentificationForImage(imageId: number): number {
  const img = db
    .prepare(
      `SELECT i.id, i.content_hash, m.positive_prompt
       FROM images i
       LEFT JOIN image_metadata m ON m.image_id = i.id
       WHERE i.id = ?`
    )
    .get(imageId) as { id: number; content_hash: string; positive_prompt: string | null } | undefined;

  if (!img) return 0;

  const characters = db.prepare('SELECT id, name FROM characters').all() as { id: number; name: string }[];
  if (characters.length === 0) return 0;

  const imageLoras = db
    .prepare('SELECT LOWER(lora_name) AS lname, lora_hash FROM image_loras WHERE image_id = ?')
    .all(img.id) as { lname: string; lora_hash: string | null }[];

  const imageWorkflows = db
    .prepare('SELECT workflow_id FROM image_workflows WHERE image_id = ?')
    .all(img.id) as { workflow_id: number }[];

  const insertSuggestion = db.prepare(`
    INSERT OR IGNORE INTO image_characters
      (image_id, image_content_hash, character_id, status, source, confidence, match_reason, appearance_label)
    VALUES (?, ?, ?, 'suggested', ?, ?, ?, ?)
  `);

  let createdCount = 0;

  for (const char of characters) {
    // Check if an association (confirmed, suggested, or rejected) already exists
    const existing = db
      .prepare('SELECT status FROM image_characters WHERE image_content_hash = ? AND character_id = ?')
      .get(img.content_hash, char.id) as { status: string } | undefined;
    if (existing) continue;

    // 1. Check Linked Character LoRAs (Confidence 0.90)
    const charLoras = db
      .prepare(
        'SELECT LOWER(lora_name) AS lname, lora_hash, appearance_label FROM character_loras WHERE character_id = ?'
      )
      .all(char.id) as { lname: string; lora_hash: string | null; appearance_label: string }[];

    let matched = false;
    for (const cl of charLoras) {
      const hit = imageLoras.find(
        (il) =>
          il.lname === cl.lname ||
          il.lname.replace(/\.(safetensors|pt|ckpt)$/i, '') ===
            cl.lname.replace(/\.(safetensors|pt|ckpt)$/i, '') ||
          (cl.lora_hash && il.lora_hash && cl.lora_hash === il.lora_hash)
      );
      if (hit) {
        const info = insertSuggestion.run(
          img.id,
          img.content_hash,
          char.id,
          'lora_match',
          0.9,
          `Matched linked character LoRA: ${hit.lname}`,
          cl.appearance_label || 'Default'
        );
        if (info.changes > 0) createdCount++;
        matched = true;
        break;
      }
    }
    if (matched) continue;

    // 2. Check Positive Prompt for Character Name or Aliases (Confidence 0.75)
    if (img.positive_prompt && img.positive_prompt.trim().length > 0) {
      const aliases = db
        .prepare('SELECT alias FROM character_aliases WHERE character_id = ?')
        .all(char.id) as { alias: string }[];
      const terms = [char.name, ...aliases.map((a) => a.alias)].filter((t) => t.trim().length >= 3);

      for (const term of terms) {
        const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const regex = new RegExp(`(^|[^a-zA-Z0-9_])${escaped}([^a-zA-Z0-9_]|$)`, 'i');
        if (regex.test(img.positive_prompt)) {
          const info = insertSuggestion.run(
            img.id,
            img.content_hash,
            char.id,
            'prompt_alias',
            0.75,
            `Prompt text matched character name/alias: "${term}"`,
            null
          );
          if (info.changes > 0) createdCount++;
          matched = true;
          break;
        }
      }
    }
    if (matched) continue;

    // 3. Check Linked Character Workflows (Confidence 0.65)
    if (imageWorkflows.length > 0) {
      const charWfIds = new Set(
        (
          db
            .prepare('SELECT workflow_id FROM character_workflows WHERE character_id = ?')
            .all(char.id) as { workflow_id: number }[]
        ).map((w) => w.workflow_id)
      );
      for (const iw of imageWorkflows) {
        if (charWfIds.has(iw.workflow_id)) {
          const info = insertSuggestion.run(
            img.id,
            img.content_hash,
            char.id,
            'workflow_match',
            0.65,
            'Generated using a workflow linked to this character',
            null
          );
          if (info.changes > 0) createdCount++;
          break;
        }
      }
    }
  }

  return createdCount;
}

export function runAssistedCharacterIdentificationForAll(): number {
  const characters = db.prepare('SELECT id, name FROM characters').all() as {
    id: number;
    name: string;
  }[];
  if (characters.length === 0) return 0;

  const allImages = db
    .prepare(
      `SELECT i.id, i.content_hash, m.positive_prompt
       FROM images i
       LEFT JOIN image_metadata m ON m.image_id = i.id
       WHERE i.is_missing = 0`
    )
    .all() as { id: number; content_hash: string; positive_prompt: string | null }[];
  if (allImages.length === 0) return 0;

  // Bulk load character rules
  const charLorasByChar = new Map<
    number,
    { lname: string; baseName: string; lora_hash: string | null; appearance_label: string }[]
  >();
  for (const cl of db
    .prepare(
      'SELECT character_id, LOWER(lora_name) AS lname, lora_hash, appearance_label FROM character_loras'
    )
    .all() as any[]) {
    const arr = charLorasByChar.get(cl.character_id) || [];
    arr.push({
      lname: cl.lname,
      baseName: cl.lname.replace(/\.(safetensors|pt|ckpt)$/i, ''),
      lora_hash: cl.lora_hash,
      appearance_label: cl.appearance_label || 'Default',
    });
    charLorasByChar.set(cl.character_id, arr);
  }

  const charRegexesByChar = new Map<number, { term: string; regex: RegExp }[]>();
  const aliasesByChar = new Map<number, string[]>();
  for (const al of db.prepare('SELECT character_id, alias FROM character_aliases').all() as {
    character_id: number;
    alias: string;
  }[]) {
    const arr = aliasesByChar.get(al.character_id) || [];
    arr.push(al.alias);
    aliasesByChar.set(al.character_id, arr);
  }
  for (const char of characters) {
    const terms = [char.name, ...(aliasesByChar.get(char.id) || [])].filter(
      (t) => t.trim().length >= 3
    );
    charRegexesByChar.set(
      char.id,
      terms.map((term) => {
        const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        return {
          term,
          regex: new RegExp(`(^|[^a-zA-Z0-9_])${escaped}([^a-zA-Z0-9_]|$)`, 'i'),
        };
      })
    );
  }

  const charWfsByChar = new Map<number, Set<number>>();
  for (const cw of db
    .prepare('SELECT character_id, workflow_id FROM character_workflows')
    .all() as { character_id: number; workflow_id: number }[]) {
    let set = charWfsByChar.get(cw.character_id);
    if (!set) {
      set = new Set<number>();
      charWfsByChar.set(cw.character_id, set);
    }
    set.add(cw.workflow_id);
  }

  // Bulk load existing associations and image relations
  const existingAssocKeys = new Set<string>(
    (
      db
        .prepare('SELECT image_content_hash, character_id FROM image_characters')
        .all() as { image_content_hash: string; character_id: number }[]
    ).map((r) => `${r.image_content_hash}:${r.character_id}`)
  );

  const lorasByImageId = new Map<
    number,
    { lname: string; baseName: string; lora_hash: string | null }[]
  >();
  for (const il of db
    .prepare('SELECT image_id, LOWER(lora_name) AS lname, lora_hash FROM image_loras')
    .all() as any[]) {
    const arr = lorasByImageId.get(il.image_id) || [];
    arr.push({
      lname: il.lname,
      baseName: il.lname.replace(/\.(safetensors|pt|ckpt)$/i, ''),
      lora_hash: il.lora_hash,
    });
    lorasByImageId.set(il.image_id, arr);
  }

  const wfsByImageId = new Map<number, number[]>();
  for (const iw of db
    .prepare('SELECT image_id, workflow_id FROM image_workflows')
    .all() as { image_id: number; workflow_id: number }[]) {
    const arr = wfsByImageId.get(iw.image_id) || [];
    arr.push(iw.workflow_id);
    wfsByImageId.set(iw.image_id, arr);
  }

  const insertSuggestion = db.prepare(`
    INSERT OR IGNORE INTO image_characters
      (image_id, image_content_hash, character_id, status, source, confidence, match_reason, appearance_label)
    VALUES (?, ?, ?, 'suggested', ?, ?, ?, ?)
  `);

  let totalSuggested = 0;
  const tx = db.transaction(() => {
    for (const img of allImages) {
      const imageLoras = lorasByImageId.get(img.id) || [];
      const imageWorkflows = wfsByImageId.get(img.id) || [];

      for (const char of characters) {
        if (existingAssocKeys.has(`${img.content_hash}:${char.id}`)) continue;

        // 1. Check Linked Character LoRAs (Confidence 0.90)
        const charLoras = charLorasByChar.get(char.id) || [];
        let matched = false;
        for (const cl of charLoras) {
          const hit = imageLoras.find(
            (il) =>
              il.lname === cl.lname ||
              il.baseName === cl.baseName ||
              (cl.lora_hash && il.lora_hash && cl.lora_hash === il.lora_hash)
          );
          if (hit) {
            const info = insertSuggestion.run(
              img.id,
              img.content_hash,
              char.id,
              'lora_match',
              0.9,
              `Matched linked character LoRA: ${hit.lname}`,
              cl.appearance_label
            );
            if (info.changes > 0) totalSuggested++;
            matched = true;
            break;
          }
        }
        if (matched) continue;

        // 2. Check Positive Prompt for Character Name or Aliases (Confidence 0.75)
        if (img.positive_prompt && img.positive_prompt.trim().length > 0) {
          const regexes = charRegexesByChar.get(char.id) || [];
          for (const { term, regex } of regexes) {
            if (regex.test(img.positive_prompt)) {
              const info = insertSuggestion.run(
                img.id,
                img.content_hash,
                char.id,
                'prompt_alias',
                0.75,
                `Prompt text matched character name/alias: "${term}"`,
                null
              );
              if (info.changes > 0) totalSuggested++;
              matched = true;
              break;
            }
          }
        }
        if (matched) continue;

        // 3. Check Linked Character Workflows (Confidence 0.65)
        if (imageWorkflows.length > 0) {
          const charWfIds = charWfsByChar.get(char.id);
          if (charWfIds) {
            for (const wfId of imageWorkflows) {
              if (charWfIds.has(wfId)) {
                const info = insertSuggestion.run(
                  img.id,
                  img.content_hash,
                  char.id,
                  'workflow_match',
                  0.65,
                  'Generated using a workflow linked to this character',
                  null
                );
                if (info.changes > 0) totalSuggested++;
                break;
              }
            }
          }
        }
      }
    }
  });
  tx();
  return totalSuggested;
}

export function updateLoraCategory(loraName: string, category: LoraCategory, notes?: string): void {
  db.prepare(
    `INSERT INTO models (name, filename, model_type, lora_category, user_notes)
     VALUES (?, ?, 'lora', ?, ?)
     ON CONFLICT(filename) DO UPDATE SET
       lora_category = excluded.lora_category,
       user_notes = COALESCE(excluded.user_notes, models.user_notes)`
  ).run(loraName.replace(/\.(safetensors|pt|ckpt)$/i, ''), loraName, category, notes ?? null);

  db.prepare('UPDATE character_loras SET lora_category = ? WHERE LOWER(lora_name) = LOWER(?)').run(
    category,
    loraName
  );
}
