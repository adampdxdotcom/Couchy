import fs from 'fs';
import path from 'path';
import {
  checkLmStudioStatus,
  getLmStudioSettings,
  getLocalLlmHeaders,
} from './llm/llmClientService.ts';
import { logger } from '../logger.ts';

export interface ReadmeSection {
  id: string;
  level: number;
  title: string;
  parentTitle: string | null;
  content: string;
}

const STOP_WORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'by', 'can', 'do', 'does',
  'for', 'from', 'how', 'i', 'if', 'in', 'into', 'is', 'it', 'its', 'me',
  'my', 'of', 'on', 'or', 'our', 'please', 'should', 'so', 'tell', 'that',
  'the', 'their', 'them', 'then', 'there', 'these', 'this', 'to', 'up',
  'use', 'using', 'what', 'when', 'where', 'which', 'who', 'why', 'will',
  'with', 'you', 'your',
]);

// Domain synonyms improve local keyword matching without requiring a vector DB
const SYNONYM_GROUPS: string[][] = [
  ['hotkey', 'hotkeys', 'shortcut', 'shortcuts', 'key', 'keys', 'keybind', 'keyboard'],
  ['install', 'setup', 'deploy', 'docker', 'compose', 'container'],
  ['env', 'environment', 'variable', 'variables', 'port', 'api', 'key', 'token'],
  ['agent', 'prompt', 'prompts', 'concept', 'batch', 'expand', 'expansion', 'preset'],
  ['lora', 'loras', 'civitai', 'huggingface', 'download', 'downloader', 'early', 'access'],
  ['character', 'characters', 'portrait', 'physical', 'personality', 'analyze', 'bio'],
  ['split', 'compare', 'loupe', 'zoom', 'stack', 'series', 'branch', 'iterate'],
  ['tagger', 'wd14', 'onnx', 'interrogate', 'interrogation', 'vision'],
  ['workflow', 'workflows', 'krea', 'node', 'mapper', 'resolution', 'upscale'],
  ['backup', 'backups', 'restore', 'database', 'sqlite', 'annotations'],
];

/**
 * Generates GitHub-compatible heading anchor slugs matching README Table of Contents links.
 */
export function slugifyHeading(raw: string): string {
  return raw
    .replace(/`([^`]*)`/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, '')
    .replace(/ /g, '-');
}

function getReadmePath(): string {
  return path.join(process.cwd(), 'README.md');
}

/**
 * Parses README.md into heading-delimited sections while ignoring `#` lines inside fenced code blocks.
 */
export function parseReadmeSections(markdown: string): ReadmeSection[] {
  const lines = markdown.split(/\r?\n/);
  const sections: ReadmeSection[] = [];
  let current: ReadmeSection | null = null;
  let lastH2: string | null = null;
  let inFence = false;
  const slugCounts = new Map<string, number>();

  for (const line of lines) {
    if (/^\s*```/.test(line)) {
      inFence = !inFence;
    }

    const headingMatch = !inFence ? line.match(/^(#{2,3})\s+(.+)$/) : null;
    if (headingMatch) {
      if (current) {
        current.content = current.content.trim();
        sections.push(current);
      }

      const level = headingMatch[1].length;
      const title = headingMatch[2].trim();
      if (level === 2) {
        lastH2 = title;
      }

      const baseSlug = slugifyHeading(title);
      const seen = slugCounts.get(baseSlug) || 0;
      slugCounts.set(baseSlug, seen + 1);
      const id = seen === 0 ? baseSlug : `${baseSlug}-${seen}`;

      current = {
        id,
        level,
        title,
        parentTitle: level === 3 ? lastH2 : null,
        content: line + '\n',
      };
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

/**
 * Loads README.md from disk and returns raw markdown plus section outline for UI navigation.
 */
export function getHelpDocsPayload(): {
  markdown: string;
  sections: Array<{ id: string; level: number; title: string; parentTitle: string | null }>;
  updatedAt: string;
} {
  const readmePath = getReadmePath();
  if (!fs.existsSync(readmePath)) {
    throw new Error('README.md was not found in the application root directory.');
  }
  const markdown = fs.readFileSync(readmePath, 'utf-8');
  const stat = fs.statSync(readmePath);
  const parsed = parseReadmeSections(markdown);

  return {
    markdown,
    sections: parsed.map(({ id, level, title, parentTitle }) => ({
      id,
      level,
      title,
      parentTitle,
    })),
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
 * Ranks README sections against the user's question and selects a bounded context window
 * safe for 8k-context local LLMs.
 */
function selectRelevantSections(
  latestQuestion: string,
  recentUserText: string,
  sections: ReadmeSection[],
  maxChars = 13500
): ReadmeSection[] {
  const queryTokens = tokenizeQuery(latestQuestion);
  const historyTokens = tokenizeQuery(recentUserText);

  const scored = sections.map((sec, index) => {
    const titleLower = sec.title.toLowerCase();
    const parentLower = (sec.parentTitle || '').toLowerCase();
    const bodyLower = sec.content.toLowerCase();

    let score = 0;
    for (const tok of queryTokens) {
      if (titleLower.includes(tok)) score += 10;
      if (parentLower.includes(tok)) score += 4;
      if (bodyLower.includes(tok)) {
        // Count capped occurrences so dense sections rank well without huge bias
        const hits = bodyLower.split(tok).length - 1;
        score += Math.min(6, hits) * 2;
      }
    }
    for (const tok of historyTokens) {
      if (titleLower.includes(tok)) score += 3;
      if (bodyLower.includes(tok)) score += 1;
    }

    // Slight boost for core reference tables when query is broad
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

  // Fallback to Overview + first couple sections if nothing matched keywords
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
 * Answers a user question strictly from README.md sections using the connected Local LLM.
 */
export async function askReadmeHelpAssistant(params: {
  messages: Array<{ role: 'user' | 'assistant'; content: string }>;
}): Promise<{
  reply: string;
  matchedSections: Array<{ id: string; title: string }>;
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

  const { markdown } = getHelpDocsPayload();
  const sections = parseReadmeSections(markdown).filter(
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
    .map((s) => `=== SECTION: ${s.title} ===\n${s.content}`)
    .join('\n\n');

  const systemPrompt = `You are Couchy's built-in Documentation Assistant.
Answer the user's question concisely and accurately using ONLY the Couchy README documentation excerpts below.

Rules:
- Cite the relevant section heading(s) (e.g., **Keyboard Shortcuts & Curation Hotkeys**) so the user knows where to read more.
- Preserve exact UI labels, hotkeys, environment variable names, and commands from the documentation.
- If the provided documentation does not contain the answer, clearly say that it is not covered in the README excerpts rather than guessing.
- Never output <proposed_prompt>, <proposed_concept>, or image-generation tags.

README Section Outline:
${outline}

Retrieved README Excerpts:
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
      `README Help Q&A answered via ${data?.model || modelToUse} (${relevant.length} sections)`
    );

    return {
      reply: cleaned,
      matchedSections: relevant.map(({ id, title }) => ({ id, title })),
      modelUsed: data?.model || modelToUse,
    };
  } finally {
    clearTimeout(timer);
  }
}
