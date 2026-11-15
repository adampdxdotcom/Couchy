import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { BookOpen, Check, Copy, Loader2, RefreshCw, Search } from 'lucide-react';
import { api } from '../../api/client.ts';
import type { HelpDocSectionSummary, LmStudioStatus } from '../../shared/types.ts';
import { copyTextToClipboard } from '../../shared/utils.ts';
import { HelpDocsChatPanel } from './HelpDocsChatPanel.tsx';

interface SystemHelpSectionProps {
  lmStatus: LmStudioStatus | null;
}

function extractNodeText(node: React.ReactNode): string {
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(extractNodeText).join('');
  if (React.isValidElement<{ children?: React.ReactNode }>(node)) {
    return extractNodeText(node.props.children);
  }
  return '';
}

function slugifyHeading(raw: string): string {
  return raw
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, '')
    .replace(/ /g, '-');
}

const CodeBlockWithCopy: React.FC<{ children?: React.ReactNode }> = ({ children }) => {
  const [copied, setCopied] = useState(false);

  let codeText = '';
  let language = '';
  if (React.isValidElement<{ className?: string; children?: React.ReactNode }>(children)) {
    const cls = children.props.className || '';
    const langMatch = cls.match(/language-([\w-]+)/);
    if (langMatch) language = langMatch[1];
    codeText = extractNodeText(children.props.children).replace(/\n$/, '');
  } else {
    codeText = extractNodeText(children).replace(/\n$/, '');
  }

  const handleCopy = async () => {
    if (await copyTextToClipboard(codeText)) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    }
  };

  return (
    <div className="my-3 rounded-xl border border-zinc-800 bg-zinc-950 overflow-hidden">
      <div className="px-3 py-1.5 border-b border-zinc-800/80 bg-zinc-900/70 flex items-center justify-between text-[11px] text-zinc-400">
        <span className="font-mono uppercase tracking-wider">{language || 'text'}</span>
        <button
          type="button"
          onClick={() => void handleCopy()}
          className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-200 cursor-pointer transition-colors"
        >
          {copied ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
          <span>{copied ? 'Copied' : 'Copy'}</span>
        </button>
      </div>
      <pre className="p-3.5 overflow-x-auto text-xs font-mono text-zinc-200 leading-relaxed">
        {children}
      </pre>
    </div>
  );
};

const ReadmeMarkdownArticle = React.memo<{
  markdown: string;
  onJumpToSection: (sectionId: string) => void;
}>(({ markdown, onJumpToSection }) => {
  // Fresh per render so duplicate-heading suffixes stay 100% deterministic across re-renders
  const seenSlugs = new Map<string, number>();
  const nextHeadingId = (children: React.ReactNode) => {
    const base = slugifyHeading(extractNodeText(children));
    const count = seenSlugs.get(base) || 0;
    seenSlugs.set(base, count + 1);
    return count === 0 ? base : `${base}-${count}`;
  };

  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        h1: ({ children }) => (
          <h1
            id={nextHeadingId(children)}
            className="scroll-mt-20 text-2xl font-display font-bold text-zinc-100 pb-3 border-b border-zinc-800 mb-4"
          >
            {children}
          </h1>
        ),
        h2: ({ children }) => (
          <h2
            id={nextHeadingId(children)}
            className="scroll-mt-20 text-lg font-display font-semibold text-zinc-100 mt-8 mb-3 pb-2 border-b border-zinc-800/80"
          >
            {children}
          </h2>
        ),
        h3: ({ children }) => (
          <h3
            id={nextHeadingId(children)}
            className="scroll-mt-20 text-sm font-display font-semibold text-indigo-300 mt-6 mb-2"
          >
            {children}
          </h3>
        ),
        h4: ({ children }) => (
          <h4
            id={nextHeadingId(children)}
            className="scroll-mt-20 text-xs font-display font-semibold uppercase tracking-wider text-zinc-200 mt-5 mb-2"
          >
            {children}
          </h4>
        ),
        p: ({ children }) => (
          <p className="text-xs sm:text-[13px] text-zinc-300 leading-relaxed mb-3">{children}</p>
        ),
        ul: ({ children }) => (
          <ul className="list-disc pl-5 space-y-1.5 text-xs sm:text-[13px] text-zinc-300 mb-3">
            {children}
          </ul>
        ),
        ol: ({ children }) => (
          <ol className="list-decimal pl-5 space-y-1.5 text-xs sm:text-[13px] text-zinc-300 mb-3">
            {children}
          </ol>
        ),
        li: ({ children }) => (
          <li className="leading-relaxed [&>ul]:mt-1.5 [&>ul]:mb-1">{children}</li>
        ),
        blockquote: ({ children }) => (
          <blockquote className="my-4 pl-3.5 pr-3 py-2.5 border-l-2 border-indigo-500 bg-indigo-950/25 rounded-r-lg text-zinc-200 [&>p]:mb-0">
            {children}
          </blockquote>
        ),
        hr: () => <hr className="my-6 border-zinc-800" />,
        a: ({ href, children }) => {
          if (href?.startsWith('#')) {
            return (
              <a
                href={href}
                onClick={(e) => {
                  e.preventDefault();
                  onJumpToSection(href);
                }}
                className="text-indigo-400 hover:text-indigo-300 underline underline-offset-2 cursor-pointer"
              >
                {children}
              </a>
            );
          }
          return (
            <a
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              className="text-indigo-400 hover:text-indigo-300 underline underline-offset-2"
            >
              {children}
            </a>
          );
        },
        code: ({ className, children }) => {
          const isBlock = Boolean(className) || extractNodeText(children).includes('\n');
          if (isBlock) {
            return <code className={className}>{children}</code>;
          }
          return (
            <code className="px-1.5 py-0.5 rounded bg-zinc-950 border border-zinc-800/80 text-indigo-300 font-mono text-[11px]">
              {children}
            </code>
          );
        },
        pre: ({ children }) => <CodeBlockWithCopy>{children}</CodeBlockWithCopy>,
        table: ({ children }) => (
          <div className="my-4 overflow-x-auto rounded-xl border border-zinc-800">
            <table className="w-full text-left border-collapse text-xs">{children}</table>
          </div>
        ),
        thead: ({ children }) => (
          <thead className="bg-zinc-950 text-zinc-200 border-b border-zinc-800">{children}</thead>
        ),
        th: ({ children }) => (
          <th className="px-3 py-2 font-semibold whitespace-nowrap">{children}</th>
        ),
        td: ({ children }) => (
          <td className="px-3 py-2 border-t border-zinc-800/80 text-zinc-300 align-top">
            {children}
          </td>
        ),
        strong: ({ children }) => <strong className="font-semibold text-zinc-100">{children}</strong>,
      }}
    >
      {markdown}
    </ReactMarkdown>
  );
});

/**
 * Renders live README.md documentation with smooth anchor navigation and code copy buttons,
 * paired with a Local LLM Help Assistant panel whenever an LLM is connected.
 */
export const SystemHelpSection: React.FC<SystemHelpSectionProps> = ({ lmStatus }) => {
  const [markdown, setMarkdown] = useState<string>('');
  const [sections, setSections] = useState<HelpDocSectionSummary[]>([]);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [sectionFilter, setSectionFilter] = useState('');
  const articleRef = useRef<HTMLDivElement | null>(null);

  const loadReadme = useCallback(async () => {
    setIsLoading(true);
    setErrorMsg(null);
    try {
      const payload = await api.getHelpReadme();
      setMarkdown(payload.markdown);
      setSections(payload.sections || []);
      setUpdatedAt(payload.updatedAt || null);
    } catch (err: any) {
      setErrorMsg(err?.message || 'Failed to load README documentation.');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadReadme();
  }, [loadReadme]);

  const jumpToSection = useCallback((sectionId: string) => {
    const cleanId = sectionId.replace(/^#/, '');
    if (!cleanId) return;
    const container = articleRef.current;
    const target =
      container?.querySelector<HTMLElement>(`[id="${CSS.escape(cleanId)}"]`) ||
      document.getElementById(cleanId);
    target?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, []);

  const filteredSections = useMemo(() => {
    const q = sectionFilter.trim().toLowerCase();
    if (!q) return sections;
    return sections.filter(
      (s) =>
        s.title.toLowerCase().includes(q) ||
        (s.parentTitle || '').toLowerCase().includes(q)
    );
  }, [sections, sectionFilter]);

  const showHelpChat = Boolean(lmStatus?.online);

  return (
    <div className="space-y-4">
      {/* Top Help Controls Bar */}
      <section className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <BookOpen className="w-4 h-4 text-indigo-400 shrink-0" />
          <div>
            <h2 className="text-sm font-display font-semibold text-zinc-100">
              Couchy Documentation &amp; Quick Reference
            </h2>
            <p className="text-[11px] text-zinc-400">
              Rendered live from <code className="text-zinc-300">README.md</code>
              {updatedAt ? ` · Updated ${new Date(updatedAt).toLocaleDateString()}` : ''}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto">
          <div className="relative flex-1 sm:w-56">
            <Search className="w-3.5 h-3.5 text-zinc-500 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              value={sectionFilter}
              onChange={(e) => setSectionFilter(e.target.value)}
              placeholder="Filter sections..."
              className="w-full pl-8 pr-2.5 py-1.5 bg-zinc-950 border border-zinc-800 focus:border-indigo-500 rounded-lg text-xs text-zinc-200 focus:outline-none"
            />
          </div>

          <select
            value=""
            onChange={(e) => {
              if (e.target.value) jumpToSection(e.target.value);
            }}
            className="px-2.5 py-1.5 bg-zinc-950 border border-zinc-800 rounded-lg text-xs text-zinc-300 max-w-[220px]"
            aria-label="Jump to documentation section"
          >
            <option value="">Jump to section...</option>
            {filteredSections.map((sec) => (
              <option key={sec.id} value={sec.id}>
                {sec.level === 3 ? `  ↳ ${sec.title}` : sec.title}
              </option>
            ))}
          </select>

          <button
            type="button"
            onClick={() => void loadReadme()}
            disabled={isLoading}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 disabled:opacity-50 text-zinc-200 rounded-lg cursor-pointer"
            title="Reload README.md from disk"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
            <span>Reload</span>
          </button>
        </div>
      </section>

      {/* Main Content + Conditional LLM Docs Assistant */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
        <div
          ref={articleRef}
          className={`${
            showHelpChat ? 'lg:col-span-8' : 'lg:col-span-12'
          } bg-zinc-900 border border-zinc-800 rounded-xl p-5 sm:p-7 min-w-0`}
        >
          {isLoading ? (
            <div className="py-16 flex items-center justify-center gap-2 text-zinc-400">
              <Loader2 className="w-4 h-4 animate-spin text-indigo-400" />
              <span>Loading README.md...</span>
            </div>
          ) : errorMsg ? (
            <div className="p-4 rounded-lg bg-rose-950/50 border border-rose-800/70 text-rose-200">
              {errorMsg}
            </div>
          ) : (
            <ReadmeMarkdownArticle markdown={markdown} onJumpToSection={jumpToSection} />
          )}
        </div>

        {showHelpChat && lmStatus && (
          <div className="lg:col-span-4 min-w-0">
            <HelpDocsChatPanel lmStatus={lmStatus} onJumpToSection={jumpToSection} />
          </div>
        )}
      </div>
    </div>
  );
};
