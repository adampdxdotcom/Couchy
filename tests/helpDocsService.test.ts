import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  getHelpDocsPayload,
  listManualChapterFiles,
  MANUAL_CHAPTER_FILES,
  parseReadmeSections,
  selectRelevantSections,
  shiftChapterHeadings,
} from '../src/server/services/helpDocsService.ts';

describe('helpDocsService modular User Manual', () => {
  it('loads all curated docs/*.md chapters in manifest order and stitches them cleanly', () => {
    const payload = getHelpDocsPayload(process.cwd());

    assert.equal(payload.source, 'docs');
    assert.equal(payload.chapters?.length, MANUAL_CHAPTER_FILES.length);
    assert.deepEqual(
      payload.chapters?.map((c) => c.filename),
      [...MANUAL_CHAPTER_FILES]
    );
    assert.ok(payload.markdown.startsWith('# Couchy User Manual'));
    assert.ok(payload.sections.length > MANUAL_CHAPTER_FILES.length);

    // Every section ID must be unique so DOM anchor jumps are deterministic
    const ids = payload.sections.map((s) => s.id);
    assert.equal(new Set(ids).size, ids.length);

    // Technical Reference should appear last in the stitched chapters
    assert.equal(
      payload.chapters?.[payload.chapters.length - 1].filename,
      'technical-reference.md'
    );
  });

  it('shifts chapter headings down one level without touching # comments inside code fences', () => {
    const sample = [
      '# Setup Chapter',
      '',
      '## YAML Example',
      '```yaml',
      '# This comment must stay a single hash',
      'base_path: /data',
      '```',
    ].join('\n');

    const shifted = shiftChapterHeadings(sample);
    assert.ok(shifted.includes('## Setup Chapter'));
    assert.ok(shifted.includes('### YAML Example'));
    assert.ok(shifted.includes('# This comment must stay a single hash'));
  });

  it('retrieves relevant sections across multiple chapters for Ask the Docs queries', () => {
    const payload = getHelpDocsPayload(process.cwd());
    const chapterByAnchor = new Map(
      (payload.chapters || []).map((c) => [c.anchorId, { slug: c.slug, title: c.title }])
    );
    const sections = parseReadmeSections(payload.markdown, chapterByAnchor);

    const civitaiMatches = selectRelevantSections(
      'How do I turn off Civitai Activity Notifications and what metrics are pulled?',
      'Civitai Activity Notifications metrics',
      sections
    );
    assert.ok(
      civitaiMatches.some((s) => s.chapterSlug === 'civitai-integration'),
      'expected civitai-integration chapter to rank in top matches'
    );

    const yamlMatches = selectRelevantSections(
      'How do I configure extra_model_paths.yaml for downloaded models?',
      'extra_model_paths.yaml',
      sections
    );
    assert.ok(
      yamlMatches.some((s) => s.chapterSlug === 'technical-reference'),
      'expected technical-reference chapter to rank in top matches'
    );

    const hotkeyMatches = selectRelevantSections(
      'What are the arrow and bracket shortcuts in the inspector?',
      'hotkeys inspector arrows',
      sections
    );
    assert.ok(
      hotkeyMatches.some(
        (s) => s.chapterSlug === 'keyboard-shortcuts' || s.chapterSlug === 'gallery-and-inspector'
      ),
      'expected keyboard-shortcuts or gallery-and-inspector chapter to rank in top matches'
    );
  });

  it('appends extra docs/*.md chapters alphabetically and falls back to README.md when docs/ is missing', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'couchy-help-docs-'));
    try {
      const docsDir = path.join(tmpDir, 'docs');
      fs.mkdirSync(docsDir);
      fs.writeFileSync(path.join(docsDir, 'keyboard-shortcuts.md'), '# Shortcuts\n\n## Keys\n- F\n');
      fs.writeFileSync(path.join(docsDir, 'getting-started.md'), '# Start\n\n## Intro\nHello\n');
      fs.writeFileSync(path.join(docsDir, 'z-custom.md'), '# Custom Notes\n\n## Extra\nHi\n');
      fs.writeFileSync(path.join(docsDir, 'a-addon.md'), '# Addon Guide\n\n## Setup\nYo\n');

      assert.deepEqual(listManualChapterFiles(docsDir), [
        'getting-started.md',
        'keyboard-shortcuts.md',
        'a-addon.md',
        'z-custom.md',
      ]);

      // Remove docs/ and verify fallback to README.md
      fs.rmSync(docsDir, { recursive: true, force: true });
      fs.writeFileSync(path.join(tmpDir, 'README.md'), '# Couchy\n\n## Fallback\nStill works.\n');

      const fallback = getHelpDocsPayload(tmpDir);
      assert.equal(fallback.source, 'readme');
      assert.equal(fallback.chapters?.length, 0);
      assert.equal(fallback.sections[0]?.title, 'Fallback');
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
