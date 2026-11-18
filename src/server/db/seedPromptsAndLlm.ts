import type Database from 'better-sqlite3';
import { appConfig } from '../config.ts';
import {
  DEFAULT_CONVERSATION_SYSTEM_PROMPT,
  DEFAULT_BATCH_EXPANSION_PROMPT,
} from '../../shared/agentPromptDefaults.ts';

/**
 * Idempotently seeds default prompt templates, LM Studio settings,
 * guiding templates, and upgrades legacy factory prompt wording.
 */
export function seedPromptsAndLlmSettings(db: Database.Database): void {
  // Seed default Prompt Templates if none exist
  const templateCount = (db.prepare('SELECT COUNT(*) as c FROM prompt_templates').get() as { c: number }).c;
  if (templateCount === 0) {
    const insertTemplate = db.prepare(`
      INSERT INTO prompt_templates (name, positive_template, negative_template, is_default, category)
      VALUES (?, ?, ?, ?, ?)
    `);
    insertTemplate.run(
      'Default Character Portrait & Theme Set',
      'masterpiece, best quality, ultra-detailed editorial photography of {character}, {lora}, {theme}, natural skin texture, sharp focus on eyes, cinematic rim lighting, shot on 85mm f/1.4 lens, shallow depth of field',
      'worst quality, low quality, blurry, deformed, bad anatomy, extra limbs, mutated hands, watermark, text, signature, oversaturated',
      1,
      'character'
    );
    insertTemplate.run(
      'Cinematic Environmental Full-Body',
      'cinematic wide angle shot of {character}, {lora}, {theme}, dynamic posture, atmospheric volumetric lighting, detailed background environment, film grain, 35mm anamorphic lens, 8k resolution',
      'worst quality, low quality, blurry, bad proportions, cropped feet, watermark, text, plastic skin',
      0,
      'cinematic'
    );
  }

  // Seed default LM Studio settings if row 1 does not exist
  const existingLm = db
    .prepare(
      'SELECT id, conversation_system_prompt, batch_expansion_prompt FROM lm_studio_settings WHERE id = 1'
    )
    .get() as
    | { id: number; conversation_system_prompt?: string; batch_expansion_prompt?: string }
    | undefined;
  if (!existingLm) {
    db.prepare(`
      INSERT INTO lm_studio_settings (id, base_url, selected_model, system_prompt, conversation_system_prompt, batch_expansion_prompt)
      VALUES (1, ?, '', ?, ?, ?)
    `).run(
      appConfig.lmStudioUrl,
      `You are a creative photography director and Stable Diffusion / Flux prompt engineer.
Given a Photo Set Theme and Base Scene Style, generate an array of distinct, cohesive image generation prompts for a full photo set.
Use gender/pronouns matching the Character Profile (or natural singular phrasing like "the subject", "a woman", or "a man") without including character names or LoRA/model filenames.
Vary the camera framing (close-up portrait, medium candid, wide environmental shot, over-the-shoulder, dynamic angle), poses, lighting nuances, and micro-actions within the theme.
Return ONLY a JSON array of prompt strings.`,
      DEFAULT_CONVERSATION_SYSTEM_PROMPT,
      DEFAULT_BATCH_EXPANSION_PROMPT
    );
  } else {
    const curConv = existingLm.conversation_system_prompt || '';
    const isPriorFactoryConversation =
      !curConv.trim() ||
      (curConv.includes('The final objective is a prompt that communicates exactly what the camera should capture') &&
        !curConv.includes('Prompt Structure & Sentence Order:')) ||
      curConv.includes('stay faithful to its stated permanent biological traits without inventing conflicting permanent features');
    if (isPriorFactoryConversation) {
      db.prepare(
        'UPDATE lm_studio_settings SET conversation_system_prompt = ? WHERE id = 1'
      ).run(DEFAULT_CONVERSATION_SYSTEM_PROMPT);
    } else if (curConv.includes('Refer to the subject neutrally')) {
      db.prepare(`
        UPDATE lm_studio_settings
        SET conversation_system_prompt = REPLACE(
              conversation_system_prompt,
              '4. Refer to the subject neutrally (e.g., "the subject", "they", "a person") when a character is attached, and NEVER include character names or model/LoRA filenames (such as .safetensors).',
              '4. Never include character names or model/LoRA filenames (such as .safetensors) in <proposed_prompt>. When a character profile is attached, use gender/pronouns matching their Character Profile (or natural singular phrasing like "the subject", "a woman", or "a man") without inventing a personal name.'
            )
        WHERE id = 1
      `).run();
    }

    const curBatch = existingLm.batch_expansion_prompt || '';
    const isPriorFactoryBatch =
      !curBatch.trim() ||
      (curBatch.startsWith('You are now expanding the approved Set Concept / Theme into {count} distinct') &&
        !curBatch.includes('Respect Concept Intent'));
    if (isPriorFactoryBatch) {
      db.prepare(
        'UPDATE lm_studio_settings SET batch_expansion_prompt = ? WHERE id = 1'
      ).run(DEFAULT_BATCH_EXPANSION_PROMPT);
    }
  }

  // Seed multiple saved LM Studio Guiding Prompt Templates if none exist
  const guidingCount = (
    db.prepare('SELECT COUNT(*) as c FROM lm_studio_prompt_templates').get() as { c: number }
  ).c;
  if (guidingCount === 0) {
    const insertGuiding = db.prepare(`
      INSERT INTO lm_studio_prompt_templates (name, system_prompt, user_prompt_template, is_default)
      VALUES (?, ?, ?, ?)
    `);

    insertGuiding.run(
      'Editorial Photo Set Director (Default)',
      `You are a creative photography director and ComfyUI prompt engineer.
Your job is to take a Photo Set Theme and Base Scene Style, and write {count} distinct, cohesive image generation prompts for a multi-photo set.
Vary the camera framing across the set (e.g., intimate close-up portrait, medium three-quarter candid, wide full-body environmental shot, dramatic over-the-shoulder angle), vary poses and micro-expressions, and enrich the lighting and background details to match the theme.
Use gender/pronouns matching the attached Character Profile (or natural singular phrasing like "the subject", "a woman", or "a man") without including character names or model/LoRA filenames.
Return ONLY a valid JSON array of {count} prompt strings (e.g. ["prompt 1", "prompt 2"]) with no markdown formatting or extra commentary.`,
      `Generate {count} distinct image prompts for a cohesive photo set:
Subject: The subject (match the attached Character Profile's pronouns and presentation if provided, or use natural singular phrasing)
Photo Set Theme: {theme}
Base Scene Style: {base_prompt}

Rules:
- Use gender/pronouns matching the Character Profile (or natural singular phrasing like "the subject", "a woman", or "a man") without inventing personal names.
- Do NOT include character names, model filenames, or file extensions (e.g. no .safetensors).
- Focus on setting, lighting, framing, poses, and clothing/mood.
- Return ONLY a JSON array of {count} complete prompt strings.`,
      1
    );

    insertGuiding.run(
      'Cinematic Storyboard Sequence',
      `You are a film director and cinematographer scripting a sequential {count}-shot storyboard for a character scene.
Progress the scene chronologically across the {count} shots: start with an establishing atmospheric shot, move into medium action/interaction within the setting, then capture an emotional close-up and a dramatic climax angle.
Use gender/pronouns matching the attached Character Profile (or natural singular phrasing like "the subject", "a woman", or "a man") without including character names or LoRA filenames.
Return ONLY a valid JSON array of {count} prompt strings.`,
      `Create a {count}-shot sequential cinematic storyboard:
Subject: The subject (match the attached Character Profile's pronouns and presentation if provided, or use natural singular phrasing)
Scene / Theme: {theme}
Visual Style Foundation: {base_prompt}

Rules:
- Use gender/pronouns matching the Character Profile (or natural singular phrasing like "the subject", "a woman", or "a man") without inventing personal names.
- Do NOT include character names or model/LoRA filenames.
- Return ONLY a JSON array of {count} complete prompt strings.`,
      0
    );

    insertGuiding.run(
      'Pose, Angle & Lighting Lookbook Variations',
      `You are a studio fashion & portrait photographer directing a {count}-image lookbook session.
Keep the setting and theme ({theme}) consistent, but systematically vary the pose, camera lens (35mm, 50mm, 85mm, 135mm), camera angle (eye-level, low angle, profile, three-quarter), and lighting mood across all {count} prompts.
Use gender/pronouns matching the attached Character Profile (or natural singular phrasing) without hardcoding names or model filenames.
Return ONLY a valid JSON array of {count} prompt strings.`,
      `Generate {count} lookbook variation prompts:
Subject: The subject (match the attached Character Profile's pronouns and presentation if provided, or use natural singular phrasing)
Theme & Wardrobe Context: {theme}
Base Prompt Template: {base_prompt}

Rules:
- Use gender/pronouns matching the Character Profile (or natural singular phrasing like "the subject", "a woman", or "a man") without inventing personal names.
- Do NOT include character names or model/LoRA filenames.
- Return ONLY a JSON array of {count} complete prompt strings.`,
      0
    );
  }

  // Sanitize existing database templates so they do not prompt LLM for {lora} filenames, character names, or forced they/them phrasing
  try {
    db.prepare(`
      UPDATE lm_studio_prompt_templates
      SET system_prompt = REPLACE(
            REPLACE(
              REPLACE(
                REPLACE(
                  REPLACE(
                    system_prompt,
                    'Keep the character ({character}) and LoRA triggers ({lora}) consistent in every prompt.',
                    'Use gender/pronouns matching the attached Character Profile (or natural singular phrasing like "the subject", "a woman", or "a man") without including character names or LoRA filenames.'
                  ),
                  'a Character identity, and a Base Prompt Style',
                  'and a Base Scene Style'
                ),
                'Refer to the subject neutrally (e.g., "they", "them", "the subject", "a person") without including specific character names or model/LoRA filenames.',
                'Use gender/pronouns matching the attached Character Profile (or natural singular phrasing like "the subject", "a woman", or "a man") without including character names or model/LoRA filenames.'
              ),
              'Refer to the subject neutrally (e.g. "they", "the subject") without including character names or LoRA filenames.',
              'Use gender/pronouns matching the attached Character Profile (or natural singular phrasing like "the subject", "a woman", or "a man") without including character names or LoRA filenames.'
            ),
            'Refer to the subject neutrally without hardcoding names or model filenames.',
            'Use gender/pronouns matching the attached Character Profile (or natural singular phrasing) without hardcoding names or model filenames.'
          ),
          user_prompt_template = REPLACE(
            REPLACE(
              REPLACE(
                REPLACE(
                  REPLACE(
                    REPLACE(
                      REPLACE(
                        user_prompt_template,
                        'Character: {character}\nLoRA / Appearance Triggers: {lora}\n',
                        'Subject: The subject (match the attached Character Profile''s pronouns and presentation if provided, or use natural singular phrasing)\n'
                      ),
                      'Character: {character}\nLoRA Triggers: {lora}\n',
                      'Subject: The subject (match the attached Character Profile''s pronouns and presentation if provided, or use natural singular phrasing)\n'
                    ),
                    'Character: {character}\n',
                    ''
                  ),
                  'Subject: The subject (refer to them using neutral terms like "they", "them", or "the subject")',
                  'Subject: The subject (match the attached Character Profile''s pronouns and presentation if provided, or use natural singular phrasing)'
                ),
                'Subject: The subject (refer to them using neutral terms like "they" or "the subject")',
                'Subject: The subject (match the attached Character Profile''s pronouns and presentation if provided, or use natural singular phrasing)'
              ),
              '- Refer to the subject neutrally (e.g. "they", "them", "the subject", "a person").',
              '- Use gender/pronouns matching the Character Profile (or natural singular phrasing like "the subject", "a woman", or "a man") without inventing personal names.'
            ),
            '- Refer to the subject neutrally (e.g. "they", "the subject").',
            '- Use gender/pronouns matching the Character Profile (or natural singular phrasing like "the subject", "a woman", or "a man") without inventing personal names.'
          )
      WHERE user_prompt_template LIKE '%{lora}%'
         OR user_prompt_template LIKE '%{character}%'
         OR system_prompt LIKE '%Refer to the subject neutrally%'
         OR user_prompt_template LIKE '%Refer to the subject neutrally%'
         OR user_prompt_template LIKE '%neutral terms like "they"%'
    `).run();
  } catch {
    // ignore if table doesn't have matching rows
  }
}
