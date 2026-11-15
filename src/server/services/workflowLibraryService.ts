import crypto from 'crypto';
import { db } from '../db.ts';
import { getExecutableApiGraph, getWorkflowDefaults } from './workflowCompilerService.ts';
import type { WorkflowLibraryItem } from '../../shared/types.ts';

export class WorkflowServiceError extends Error {
  statusCode: number;
  constructor(statusCode: number, message: string) {
    super(message);
    this.statusCode = statusCode;
  }
}

/**
 * Lists saved library workflows and extracted image workflows with character links and default dimensions.
 */
export function listWorkflowLibraryItems(): WorkflowLibraryItem[] {
  const rows = db
    .prepare(
      `
      SELECT
        w.id,
        w.name,
        w.description,
        w.is_saved_library,
        w.is_default,
        (w.visual_workflow_json IS NOT NULL AND w.visual_workflow_json != '') AS has_visual,
        (w.api_workflow_json IS NOT NULL AND w.api_workflow_json != '') AS has_api,
        w.workflow_hash,
        w.created_at,
        w.updated_at,
        COUNT(DISTINCT iw.image_id) AS imageCount
      FROM workflows w
      LEFT JOIN image_workflows iw ON iw.workflow_id = w.id
      GROUP BY w.id
      ORDER BY w.is_default DESC, w.is_saved_library DESC, w.updated_at DESC
    `
    )
    .all() as any[];

  const charRows = db
    .prepare(
      `SELECT cw.workflow_id AS workflowId, c.id, c.name, cw.role_label AS roleLabel
       FROM character_workflows cw
       JOIN characters c ON c.id = cw.character_id`
    )
    .all() as any[];
  const charsByWf = new Map<number, any[]>();
  for (const cr of charRows) {
    const { workflowId, ...rest } = cr;
    const arr = charsByWf.get(workflowId) || [];
    arr.push(rest);
    charsByWf.set(workflowId, arr);
  }

  return rows.map((r) => {
    let defaultMegapixels: number | null = null;
    let defaultAspectRatio: string | null = null;
    let defaultCheckpoint: string | null = null;
    if (r.has_api || r.has_visual) {
      try {
        const wfDefaults = getWorkflowDefaults(Number(r.id));
        defaultMegapixels = wfDefaults.defaultMegapixels ?? null;
        defaultAspectRatio = wfDefaults.defaultAspectRatio ?? null;
        defaultCheckpoint = wfDefaults.defaultCheckpoint ?? null;
      } catch {
        // ignore unparseable workflow defaults
      }
    }
    return {
      id: r.id,
      name: r.name,
      description: r.description || '',
      isSavedLibrary: Boolean(r.is_saved_library),
      isDefault: Boolean(r.is_default),
      hasVisualWorkflow: Boolean(r.has_visual),
      hasApiWorkflow: Boolean(r.has_api),
      workflowHash: r.workflow_hash,
      imageCount: Number(r.imageCount || 0),
      characters: charsByWf.get(r.id) || [],
      defaultMegapixels,
      defaultAspectRatio,
      defaultCheckpoint,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    };
  });
}

/**
 * Fetches a single workflow record and resolves the executable API graph for the primary default workflow.
 */
export function getWorkflowRecordById(wfId: number): any {
  const wf = db.prepare('SELECT * FROM workflows WHERE id = ?').get(wfId) as any;
  if (!wf) {
    throw new WorkflowServiceError(404, 'Workflow not found');
  }
  if (!wf.api_workflow_json) {
    const fallbackGraph = getExecutableApiGraph(wf);
    if (fallbackGraph) {
      wf.api_workflow_json = JSON.stringify(fallbackGraph, null, 2);
    }
  }
  return wf;
}

/**
 * Promotes the target workflow as the primary default across Quick Gen and Generation Studio.
 */
export function setDefaultWorkflow(wfId: number): any {
  const existing = db.prepare('SELECT * FROM workflows WHERE id = ?').get(wfId) as any;
  if (!existing) {
    throw new WorkflowServiceError(404, 'Workflow not found');
  }

  const tx = db.transaction(() => {
    db.prepare('UPDATE workflows SET is_default = 0 WHERE is_default = 1').run();
    db.prepare(
      "UPDATE workflows SET is_default = 1, is_saved_library = 1, updated_at = datetime('now') WHERE id = ?"
    ).run(wfId);
  });
  tx();

  return db.prepare('SELECT * FROM workflows WHERE id = ?').get(wfId);
}

/**
 * Validates and saves or updates a workflow in the Independent Workflow Library.
 */
export function saveOrUpdateWorkflow(input: {
  id?: unknown;
  name?: unknown;
  description?: unknown;
  visualWorkflowJson?: unknown;
  apiWorkflowJson?: unknown;
  isDefault?: unknown;
}): any {
  const { id, name, description, visualWorkflowJson, apiWorkflowJson, isDefault } = input;

  if (id) {
    const wfId = Number(id);
    const current = db.prepare('SELECT * FROM workflows WHERE id = ?').get(wfId) as any;
    if (!current) {
      throw new WorkflowServiceError(404, 'Workflow not found');
    }

    const nextName = name !== undefined ? String(name || 'Saved Workflow').trim() : current.name;
    const nextDesc = description !== undefined ? String(description || '') : current.description;
    const nextVisual =
      visualWorkflowJson !== undefined ? visualWorkflowJson : current.visual_workflow_json;
    const nextApi = apiWorkflowJson !== undefined ? apiWorkflowJson : current.api_workflow_json;

    if (typeof nextApi === 'string' && nextApi.trim()) {
      try {
        JSON.parse(nextApi);
      } catch {
        throw new WorkflowServiceError(400, 'API Workflow JSON is not valid JSON');
      }
    }
    if (typeof nextVisual === 'string' && nextVisual.trim()) {
      try {
        JSON.parse(nextVisual);
      } catch {
        throw new WorkflowServiceError(400, 'Visual Workflow JSON is not valid JSON');
      }
    }

    const tx = db.transaction(() => {
      if (isDefault) {
        db.prepare('UPDATE workflows SET is_default = 0 WHERE is_default = 1').run();
      }
      const nextDefault = isDefault !== undefined ? (isDefault ? 1 : 0) : current.is_default;

      db.prepare(
        `UPDATE workflows
         SET name = ?,
             description = ?,
             visual_workflow_json = ?,
             api_workflow_json = ?,
             is_saved_library = 1,
             is_default = ?,
             updated_at = datetime('now')
         WHERE id = ?`
      ).run(nextName, nextDesc, nextVisual, nextApi, nextDefault, wfId);
    });
    tx();

    return db.prepare('SELECT * FROM workflows WHERE id = ?').get(wfId);
  }

  if (!visualWorkflowJson && !apiWorkflowJson) {
    throw new WorkflowServiceError(400, 'Provide visual or API workflow JSON');
  }

  const wfHash = crypto
    .createHash('sha256')
    .update((visualWorkflowJson || '') + '||' + (apiWorkflowJson || ''))
    .digest('hex');

  const tx = db.transaction(() => {
    if (isDefault) {
      db.prepare('UPDATE workflows SET is_default = 0 WHERE is_default = 1').run();
    }
    db.prepare(
      `INSERT INTO workflows (name, description, is_saved_library, is_default, visual_workflow_json, api_workflow_json, workflow_hash)
       VALUES (?, ?, 1, ?, ?, ?, ?)
       ON CONFLICT(workflow_hash) DO UPDATE SET
         name = excluded.name,
         description = excluded.description,
         visual_workflow_json = COALESCE(excluded.visual_workflow_json, workflows.visual_workflow_json),
         api_workflow_json = COALESCE(excluded.api_workflow_json, workflows.api_workflow_json),
         is_saved_library = 1,
         is_default = CASE WHEN excluded.is_default = 1 THEN 1 ELSE workflows.is_default END,
         updated_at = datetime('now')`
    ).run(
      String(name || `Workflow ${wfHash.slice(0, 8)}`),
      String(description || ''),
      isDefault ? 1 : 0,
      visualWorkflowJson || null,
      apiWorkflowJson || null,
      wfHash
    );
  });
  tx();

  return db.prepare('SELECT * FROM workflows WHERE workflow_hash = ?').get(wfHash);
}
