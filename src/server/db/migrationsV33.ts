import type { SchemaMigration } from './migrationsCore.ts';

/**
 * Schema migration v33: adds missing lowercase and foreign-key indexes used by
 * startup inventory, LoRA explorer, character profile, and workflow queries.
 */
export const migrationsV33: SchemaMigration[] = [
  {
    version: 33,
    name: 'startup_query_performance_indexes',
    sql: `
      CREATE INDEX IF NOT EXISTS idx_image_models_name_lower ON image_models(LOWER(model_name));
      CREATE INDEX IF NOT EXISTS idx_char_loras_name_lower ON character_loras(LOWER(lora_name));
      CREATE INDEX IF NOT EXISTS idx_char_loras_char_id ON character_loras(character_id);
      CREATE INDEX IF NOT EXISTS idx_char_aliases_char_id ON character_aliases(character_id);
      CREATE INDEX IF NOT EXISTS idx_char_workflows_char_id ON character_workflows(character_id);
      CREATE INDEX IF NOT EXISTS idx_char_tags_char_id ON character_tags(character_id);
      CREATE INDEX IF NOT EXISTS idx_char_collections_char_id ON character_collections(character_id);
      CREATE INDEX IF NOT EXISTS idx_image_workflows_image_id ON image_workflows(image_id);
    `,
  },
];
