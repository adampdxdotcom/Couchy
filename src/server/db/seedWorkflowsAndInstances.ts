import fs from 'fs';
import type Database from 'better-sqlite3';
import { appConfig } from '../config.ts';
import { resolveServerWorkflowPath } from '../workflows/workflowPaths.ts';

const PRIMARY_WORKFLOW_PATH = resolveServerWorkflowPath('primary_workflow.json');

/**
 * Idempotently seeds the default ComfyUI instance, primary Krea2_turbo workflow
 * (upgrading legacy rows to include inline upscale nodes #51-#54), node mappings,
 * default workflow flag, and fallback diffusion model entry.
 */
export function seedWorkflowsAndInstances(db: Database.Database): void {
  // Ensure default ComfyUI instance record exists
  const existingInstance = db.prepare('SELECT id FROM comfyui_instances WHERE is_default = 1').get();
  if (!existingInstance) {
    db.prepare('INSERT INTO comfyui_instances (name, base_url, is_default) VALUES (?, ?, 1)').run(
      'Primary ComfyUI',
      appConfig.comfyuiUrl
    );
  }

  // Load primary Krea2_turbo workflow directly from src/server/workflows/primary_workflow.json
  const krea2TurboApiWorkflow: Record<string, any> = JSON.parse(
    fs.readFileSync(PRIMARY_WORKFLOW_PATH, 'utf-8')
  );

  // Replace old placeholder default workflow if present or insert/upgrade Krea2_turbo primary workflow
  const legacyDefault = db
    .prepare("SELECT id FROM workflows WHERE workflow_hash = 'default-couchy-character-lora-workflow'")
    .get() as { id: number } | undefined;
  const kreaDefault = db
    .prepare("SELECT id, api_workflow_json FROM workflows WHERE workflow_hash = 'default-krea2-turbo-workflow'")
    .get() as { id: number; api_workflow_json?: string } | undefined;

  let kreaWorkflowId: number | null = kreaDefault?.id ?? null;

  if (legacyDefault && !kreaDefault) {
    db.prepare(`
      UPDATE workflows
      SET name = ?, description = ?, api_workflow_json = ?, workflow_hash = 'default-krea2-turbo-workflow', updated_at = datetime('now')
      WHERE id = ?
    `).run(
      'Krea2_turbo Studio Workflow (Default)',
      'Primary Krea2_turbo workflow with conditional inline 4x-ESRGAN upscaling (>3.0 MP via Switch #51 & Scale #52), Power Lora Loader (#50), ResolutionSelector (#49), and KSampler (#30_3).',
      JSON.stringify(krea2TurboApiWorkflow, null, 2),
      legacyDefault.id
    );
    kreaWorkflowId = legacyDefault.id;
  } else if (!kreaDefault) {
    const info = db.prepare(`
      INSERT INTO workflows (name, description, is_saved_library, api_workflow_json, workflow_hash)
      VALUES (?, ?, 1, ?, 'default-krea2-turbo-workflow')
    `).run(
      'Krea2_turbo Studio Workflow (Default)',
      'Primary Krea2_turbo workflow with conditional inline 4x-ESRGAN upscaling (>3.0 MP via Switch #51 & Scale #52), Power Lora Loader (#50), ResolutionSelector (#49), and KSampler (#30_3).',
      JSON.stringify(krea2TurboApiWorkflow, null, 2)
    );
    kreaWorkflowId = Number(info.lastInsertRowid);
  } else if (kreaDefault.api_workflow_json) {
    // Upgrade older default-krea2-turbo-workflow DB rows that predate inline upscale nodes #51-#54
    try {
      const currentGraph = JSON.parse(kreaDefault.api_workflow_json) as Record<string, any>;
      if (!currentGraph['51'] || currentGraph['51']?.class_type !== 'ComfySwitchNode') {
        const upgradedGraph = JSON.parse(JSON.stringify(krea2TurboApiWorkflow)) as Record<string, any>;
        if (currentGraph['49']?.inputs && upgradedGraph['49']?.inputs) {
          if (currentGraph['49'].inputs.aspect_ratio) {
            upgradedGraph['49'].inputs.aspect_ratio = currentGraph['49'].inputs.aspect_ratio;
          }
          if (typeof currentGraph['49'].inputs.megapixels === 'number') {
            upgradedGraph['49'].inputs.megapixels = currentGraph['49'].inputs.megapixels;
          }
        }
        if (currentGraph['30_10']?.inputs?.unet_name && upgradedGraph['30_10']?.inputs) {
          upgradedGraph['30_10'].inputs.unet_name = currentGraph['30_10'].inputs.unet_name;
        }
        if (currentGraph['29']?.inputs?.filename_prefix && upgradedGraph['29']?.inputs) {
          upgradedGraph['29'].inputs.filename_prefix = currentGraph['29'].inputs.filename_prefix;
        }
        db.prepare(`
          UPDATE workflows
          SET description = ?, api_workflow_json = ?, updated_at = datetime('now')
          WHERE id = ?
        `).run(
          'Primary Krea2_turbo workflow with conditional inline 4x-ESRGAN upscaling (>3.0 MP via Switch #51 & Scale #52), Power Lora Loader (#50), ResolutionSelector (#49), and KSampler (#30_3).',
          JSON.stringify(upgradedGraph, null, 2),
          kreaDefault.id
        );
      }
    } catch {
      // ignore parse failures
    }
  }

  if (kreaWorkflowId) {
    const existingMap = db
      .prepare('SELECT workflow_id FROM workflow_mappings WHERE workflow_id = ?')
      .get(kreaWorkflowId);
    if (!existingMap) {
      db.prepare(`
        INSERT INTO workflow_mappings (
          workflow_id,
          positive_prompt_node_id, positive_prompt_field,
          negative_prompt_node_id, negative_prompt_field,
          trigger_word_node_id, trigger_word_field,
          seed_node_id, seed_field,
          steps_node_id, cfg_node_id, sampler_node_id,
          latent_node_id, aspect_ratio_field, megapixels_field,
          checkpoint_node_id, checkpoint_field,
          enable_lora_node_id, enable_lora_field,
          lora_node_ids_json
        ) VALUES (?, '30_19', 'value', NULL, 'text', '30_27', 'string_b', '30_3', 'seed', '30_3', '30_3', '30_3', '49', 'aspect_ratio', 'megapixels', '30_10', 'unet_name', '30_23', 'value', '["50"]')
      `).run(kreaWorkflowId);
    }
  }

  // Ensure at least one workflow is marked as default
  const anyDefaultWf = db
    .prepare('SELECT id FROM workflows WHERE is_default = 1 LIMIT 1')
    .get() as { id: number } | undefined;
  if (!anyDefaultWf) {
    const defaultWf = db
      .prepare(
        "SELECT id FROM workflows WHERE workflow_hash = 'default-krea2-turbo-workflow' OR id = 1 LIMIT 1"
      )
      .get() as { id: number } | undefined;
    const targetDefaultId = defaultWf?.id ?? kreaWorkflowId ?? 1;
    db.prepare('UPDATE workflows SET is_default = 1 WHERE id = ?').run(targetDefaultId);
  }
}
