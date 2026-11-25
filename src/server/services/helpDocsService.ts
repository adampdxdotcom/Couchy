import fs from 'fs';
import path from 'path';
import {
  checkLmStudioStatus,
  getLmStudioSettings,
  getLocalLlmHeaders,
} from './llm/llmClientService.ts';
import { logger } from '../logger.ts';
import type { HelpDocChapterSummary, HelpReadmePayload } from '../../shared/types.ts';

export interface ReadmeSection {
  id: string;
  level: number;
  title: string;
  parentTitle: string | null;
  chapterSlug?: string;
  chapterTitle?: string;
  content: string;
}

/** Curated reading order for modular User Manual chapters in `docs/`. */
export const MANUAL_CHAPTER_FILES = [
  'getting-started.md',
  'quick-gen-and-agent.md',
  'gallery-and-inspector.md',
  'characters-and-studio.md',
  'loras-models-and-downloader.md',
  'civitai-integration.md',
  'workflows-and-system.md',
  'keyboard-shortcuts.md',
  'technical-reference.md',
] as const;

const STOP_WORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'by', 'can', 'do', 'does',
  'for', 'from', 'how', 'i', 'if', 'in', 'into', 'is', 'it', 'its', 'me',
  'my', 'of', 'on', 'or', 'our', 'please', 'should', 'so', 'tell', 'that',
  'the', 'their', 'them', 'then', 'there', 'these', 'this', 'to', 'up',
  'use', 'using', 'what', 'when', 'where', 'which', 'who', 'why', 'will',
  'with', 'you', 'your',
]);

// Domain synonyms improve local keyword matching across chapters without a vector DB
const SYNONYM_GROUPS: string[][] = [
  ['hotkey', 'hotkeys', 'shortcut', 'shortcuts', 'key', 'keys', 'keybind', 'keyboard', 'arrow', 'arrows'],
  ['install', 'setup', 'deploy', 'docker', 'compose', 'container', 'yaml'],
  ['env', 'environment', 'variable', 'variables', 'port', 'api', 'key', 'token'],
  ['agent', 'prompt', 'prompts', 'concept', 'batch', 'expand', 'expansion', 'preset'],
  ['lora', 'loras', 'civitai', 'huggingface', 'download', 'downloader', 'early', 'access'],
  ['civitai', 'reactions', 'comments', 'buzz', 'draft', 'publish', 'notifications', 'stats', 'link'],
  ['character', 'characters', 'portrait', 'physical', 'personality', 'analyze', 'bio', 'face'],
  ['split', 'compare', 'loupe', 'zoom', 'stack', 'series', 'branch', 'iterate', 'inspo'],
  ['tagger', 'wd14', 'onnx', 'interrogate', 'interrogation', 'vision'],
  ['workflow', 'workflows', 'krea', 'node', 'mapper', 'resolution', 'upscale'],
  ['backup', 'backups', 'restore', 'database', 'sqlite', 'annotations'],
];

/**
 * Generates deterministic heading anchor slugs matching both GitHub and the in-app Markdown renderer.
 */
export function slugifyHeading(raw: string): string {
  return raw
    .replace(/`([^`]*)`/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/__([^_]+)__/g, '$1')
    .replace(/&[a-z0-9#]+;/gi, ' ')
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, '')
    .replace(/ /g, '-');
}

/**
 * Shifts Markdown heading levels down by one outside fenced code blocks
 * so each standalone chapter (`# Title`) stitches cleanly under `# Couchy User Manual`.
 */
export function shiftChapterHeadings(markdown: string): string {
  const lines = markdown.split(/\r?\n/);
  let inFence = false;
  return lines
    .map((line) => {
      if (/^\s*```/.test(line)) {
        inFence = !inFence;
        return line;
      }
      if (!inFence) {
        const match = line.match(/^(#{1,5})(\s+.+)$/);
        if (match) {
          return `${match[1]}#${match[2]}`;
        }
      }
      return line;
    })
    .join('\n')
    .trim();
}

/**
 * Resolves ordered chapter files inside `docs/`, keeping curated chapters first
 * and appending any extra `.md` files alphabetically.
 */
export function listManualChapterFiles(docsDir: string): string[] {
  if (!fs.existsSync(docsDir)) return [];
  const entries = fs
    .readdirSync(docsDir, { withFileTypes: true })
    .filter((d) => d.isFile() && d.name.toLowerCase().endsWith('.md'))
    .map((d) => d.name);

  if (entries.length === 0) return [];

  const available = new Set(entries);
  const ordered: string[] = [];
  for (const preferred of MANUAL_CHAPTER_FILES) {
    if (available.has(preferred)) {
      ordered.push(preferred);
      available.delete(preferred);
    }
  }
  const extras = Array.from(available).sort((a, b) => a.localeCompare(b));
  return [...ordered, ...extras];
}

/**
 * Parses stitched manual Markdown into heading-delimited sections while ignoring `#` lines
 * inside fenced code blocks. Counts duplicate slugs across h1–h4 to match DOM heading IDs.
 */
export function parseReadmeSections(
  markdown: string,
  chapterSlugByAnchorId?: Map<string, { slug: string; title: string }>
): ReadmeSection[] {
  const lines = markdown.split(/\r?\n/);
  const sections: ReadmeSection[] = [];
  let current: ReadmeSection | null = null;
  let lastH2Title: string | null = null;
  let currentChapter: { slug: string; title: string } | null = null;
  let inFence = false;
  const slugCounts = new Map<string, number>();

  for (const line of lines) {
    if (/^\s*```/.test(line)) {
      inFence = !inFence;
    }

    const headingMatch = !inFence ? line.match(/^(#{1,4})\s+(.+)$/) : null;
    if (headingMatch) {
      const level = headingMatch[1].length;
      const title = headingMatch[2].trim();
      const baseSlug = slugifyHeading(title);
      const seen = slugCounts.get(baseSlug) || 0;
      slugCounts.set(baseSlug, seen + 1);
      const id = seen === 0 ? baseSlug : `${baseSlug}-${seen}`;

      if (level === 2 || level === 3) {
        if (current) {
          current.content = current.content.trim();
          sections.push(current);
        }

        if (level === 2) {
          lastH2Title = title;
          currentChapter = chapterSlugByAnchorId?.get(id) ?? {
            slug: id,
            title,
          };
        }

        current = {
          id,
          level,
          title,
          parentTitle: level === 3 ? lastH2Title : null,
          chapterSlug: currentChapter?.slug,
          chapterTitle: currentChapter?.title,
          content: line + '\n',
        };
      } else if (current) {
        current.content += line + '\n';
      }
    } else if (current) {
      current.content += line + '\n';
    }
  }

  if (current) {
    current.content = current.content.trim();
    sections.push(current);
  }

  return sections;
}

function loadStitchedManualFromDocs(docsDir: string): {
  markdown: string;
  chapters: HelpDocChapterSummary[];
  chapterByAnchor: Map<string, { slug: string; title: string }>;
  updatedAt: string;
} | null {
  const chapterFiles = listManualChapterFiles(docsDir);
  if (chapterFiles.length === 0) return null;

  const chunks: string[] = ['# Couchy User Manual'];
  const chapters: HelpDocChapterSummary[] = [];
  const chapterByAnchor = new Map<string, { slug: string; title: string }>();
  const slugCounts = new Map<string, number>([['couchy-user-manual', 1]]);
  let latestMtimeMs = 0;

  for (const filename of chapterFiles) {
    const fullPath = path.join(docsDir, filename);
    const raw = fs.readFileSync(fullPath, 'utf-8').trim();
    const stat = fs.statSync(fullPath);
    if (stat.mtimeMs > latestMtimeMs) latestMtimeMs = stat.mtimeMs;

    const shifted = shiftChapterHeadings(raw);
    const slug = filename.replace(/\.md$/i, '');

    // Extract the chapter's main title (first h2 after shifting) and compute its deterministic anchor ID
    const headingMatch = shifted.match(/^##\s+(.+)$/m);
    const title = headingMatch ? headingMatch[1].trim() : slug;

    // Advance slugCounts across headings in this chapter to align anchor IDs cleanly
    let anchorId = slugifyHeading(title);
    let inFence = false;
    let recordedChapterAnchor = false;
    for (const line of shifted.split(/\r?\n/)) {
      if (/^\s*```/.test(line)) inFence = !inFence;
      const m = !inFence ? line.match(/^(#{1,4})\s+(.+)$/) : null;
      if (!m) continue;
      const base = slugifyHeading(m[2].trim());
      const count = slugCounts.get(base) || 0;
      slugCounts.set(base, count + 1);
      const resolvedId = count === 0 ? base : `${base}-${count}`;
      if (!recordedChapterAnchor && m[1].length === 2) {
        anchorId = resolvedId;
        recordedChapterAnchor = true;
      }
    }

    chapters.push({ slug, title, filename, anchorId });
    chapterByAnchor.set(anchorId, { slug, title });
    chunks.push(shifted);
  }

  return {
    markdown: chunks.join('\n\n---\n\n') + '\n',
    chapters,
    chapterByAnchor,
    updatedAt: new Date(latestMtimeMs || Date.now()).toISOString(),
  };
}

/**
 * Loads the modular User Manual chapters from `docs/` stitched into one document,
 * falling back to root `README.md` if `docs/` is absent.
 */
export function getHelpDocsPayload(rootDir: string = process.cwd()): HelpReadmePayload {
  const docsDir = path.join(rootDir, 'docs');
  const stitched = loadStitchedManualFromDocs(docsDir);

  if (stitched) {
    const parsed = parseReadmeSections(stitched.markdown, stitched.chapterByAnchor);
    return {
      markdown: stitched.markdown,
      sections: parsed.map(({ id, level, title, parentTitle, chapterSlug, chapterTitle }) => ({
        id,
        level,
        title,
        parentTitle,
        chapterSlug,
        chapterTitle,
      })),
      chapters: stitched.chapters,
      source: 'docs',
      updatedAt: stitched.updatedAt,
    };
  }

  const readmePath = path.join(rootDir, 'README.md');
  if (!fs.existsSync(readmePath)) {
    throw new Error('Help documentation was not found in docs/ or README.md.');
  }
  const markdown = fs.readFileSync(readmePath, 'utf-8');
  const stat = fs.statSync(readmePath);
  const parsed = parseReadmeSections(markdown);

  return {
    markdown,
    sections: parsed.map(({ id, level, title, parentTitle, chapterSlug, chapterTitle }) => ({
      id,
      level,
      title,
      parentTitle,
      chapterSlug,
      chapterTitle,
    })),
    chapters: [],
    source: 'readme',
    updatedAt: stat.mtime.toISOString(),
  };
}

function tokenizeQuery(text: string): string[] {
  const rawTokens = text
    .toLowerCase()
    .replace(/[^\w\s-]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length >= 2 && !STOP_WORDS.has(t));

  const expanded = new Set(rawTokens);
  for (const token of rawTokens) {
    for (const group of SYNONYM_GROUPS) {
      if (group.includes(token)) {
        for (const syn of group) expanded.add(syn);
      }
    }
  }
  return Array.from(expanded);
}

/**
 * Ranks manual sections across all chapters against the user's question and selects
 * a bounded context window safe for 8k-context local LLMs.
 */
export function selectRelevantSections(
  latestQuestion: string,
  recentUserText: string,
  sections: ReadmeSection[],
  maxChars = 13500
): ReadmeSection[] {
  const queryTokens = tokenizeQuery(latestQuestion);
  const historyTokens = tokenizeQuery(recentUserText);

  const scored = sections.map((sec, index) => {
    const titleLower = sec.title.toLowerCase();
    const parentLower = (sec.parentTitle || sec.chapterTitle || '').toLowerCase();
    const bodyLower = sec.content.toLowerCase();

    let score = 0;
    for (const tok of queryTokens) {
      if (titleLower.includes(tok)) score += 10;
      if (parentLower.includes(tok)) score += 4;
      if (bodyLower.includes(tok)) {
        // Cap per-token body hits so dense sections rank well without dominating
        const hits = bodyLower.split(tok).length - 1;
        score += Math.min(6, hits) * 2;
      }
    }
    for (const tok of historyTokens) {
      if (titleLower.includes(tok)) score += 3;
      if (bodyLower.includes(tok)) score += 1;
    }

    if (queryTokens.length === 0 && index <= 2) {
      score += 2;
    }

    return { sec, score, index };
  });

  scored.sort((a, b) => b.score - a.score || a.index - b.index);

  const picked: ReadmeSection[] = [];
  let usedChars = 0;

  for (const item of scored) {
    if (item.score <= 0 && picked.length >= 2) break;
    if (picked.length >= 5) break;

    const sectionLen = item.sec.content.length;
    if (picked.length > 0 && usedChars + sectionLen > maxChars) {
      continue;
    }

    picked.push(item.sec);
    usedChars += sectionLen;
  }

  // Fallback to opening sections if nothing matched keywords
  if (picked.length === 0) {
    for (const sec of sections.slice(0, 3)) {
      if (usedChars + sec.content.length > maxChars && picked.length > 0) break;
      picked.push(sec);
      usedChars += sec.content.length;
    }
  }

  return picked;
}

/**
 * Answers a user question strictly from Couchy's User Manual chapters using the connected Local LLM.
 */
export async function askReadmeHelpAssistant(params: {
  messages: Array<{ role: 'user' | 'assistant'; content: string }>;
}): Promise<{
  reply: string;
  matchedSections: Array<{ id: string; title: string; chapterTitle?: string }>;
  modelUsed: string;
}> {
  const status = await checkLmStudioStatus();
  if (!status.online) {
    throw new Error('Local LLM is offline. Connect a Local LLM in System -> Agent to use Help Chat.');
  }

  const validMessages = (params.messages || [])
    .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && m.content?.trim())
    .slice(-8);

  const latestUserMsg = [...validMessages].reverse().find((m) => m.role === 'user');
  if (!latestUserMsg) {
    throw new Error('A question message is required.');
  }

  const payload = getHelpDocsPayload();
  const chapterByAnchor = new Map(
    (payload.chapters || []).map((c) => [c.anchorId, { slug: c.slug, title: c.title }])
  );
  const sections = parseReadmeSections(payload.markdown, chapterByAnchor).filter(
    (s) => s.title.toLowerCase() !== 'contents'
  );

  const recentUserText = validMessages
    .filter((m) => m.role === 'user')
    .slice(-3)
    .map((m) => m.content)
    .join(' ');

  const relevant = selectRelevantSections(latestUserMsg.content, recentUserText, sections);
  const outline = sections
    .map((s) => `${s.level === 3 ? '  ' : ''}- ${s.title}`)
    .join('\n');

  const excerptBlock = relevant
    .map((s) => {
      const header =
        s.chapterTitle && s.chapterTitle !== s.title
          ? `${s.chapterTitle} › ${s.title}`
          : s.title;
      return `=== SECTION: ${header} ===\n${s.content}`;
    })
    .join('\n\n');

  const systemPrompt = `You are Couchy's built-in Documentation Assistant.
Answer the user's question concisely and accurately using ONLY the Couchy User Manual excerpts below.

Rules:
- Cite the relevant chapter or section heading(s) (e.g., **Keyboard Shortcuts & Hotkeys**) so the user knows where to read more.
- Preserve exact UI labels, hotkeys, environment variable names, and commands from the documentation.
- If the provided documentation does not contain the answer, clearly say that it is not covered in the User Manual excerpts rather than guessing.
- Never output <proposed_prompt>, <proposed_concept>, or image-generation tags.

Manual Section Outline:
${outline}

Retrieved Manual Excerpts:
${excerptBlock}`;

  const settings = getLmStudioSettings();
  const baseUrl = settings.baseUrl.replace(/\/+$/, '');
  const chatEndpoint = baseUrl.endsWith('/v1')
    ? `${baseUrl}/chat/completions`
    : `${baseUrl}/v1/chat/completions`;
  const modelToUse = status.selectedModel || settings.selectedModel || 'local-model';

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 60000);

  try {
    const res = await fetch(chatEndpoint, {
      method: 'POST',
      headers: getLocalLlmHeaders(true),
      signal: controller.signal,
      body: JSON.stringify({
        model: modelToUse,
        messages: [{ role: 'system', content: systemPrompt }, ...validMessages],
        temperature: 0.25,
        max_tokens: 1200,
      }),
    });
    clearTimeout(timer);

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Local LLM returned HTTP ${res.status}: ${errText}`);
    }

    const data = (await res.json()) as any;
    const rawReply: string = data?.choices?.[0]?.message?.content?.trim() || '';
    const cleaned = rawReply.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
    if (!cleaned) {
      throw new Error('Local LLM returned an empty answer.');
    }

    logger.info(
      'HelpDocs',
      `User Manual Q&A answered via ${data?.model || modelToUse} (${relevant.length} sections)`
    );

    return {
      reply: cleaned,
      matchedSections: relevant.map(({ id, title, chapterTitle }) => ({
        id,
        title,
        chapterTitle,
      })),
      modelUsed: data?.model || modelToUse,
    };
  } finally {
    clearTimeout(timer);
  }
}
