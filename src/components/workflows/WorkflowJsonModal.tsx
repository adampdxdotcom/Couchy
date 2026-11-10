import React, { useState } from 'react';
import { Check, Code, Copy, Download, Save, X } from 'lucide-react';

export interface WorkflowJsonModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  jsonText: string;
  onChangeJsonText: (val: string) => void;
  syntaxError: string | null;
  onSave?: () => Promise<void>;
  isSaving?: boolean;
}

/**
 * Dedicated modal and panel for viewing, editing, formatting, and copying
 * ComfyUI prompt graphs and visual workflow JSON documents.
 */
export const WorkflowJsonModal: React.FC<WorkflowJsonModalProps> = ({
  isOpen,
  onClose,
  title,
  jsonText,
  onChangeJsonText,
  syntaxError,
  onSave,
  isSaving = false,
}) => {
  const [copied, setCopied] = useState(false);

  if (!isOpen) return null;

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(jsonText);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback
    }
  };

  const handleDownload = () => {
    const blob = new Blob([jsonText], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${title.toLowerCase().replace(/[^a-z0-9]+/g, '_')}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/85 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl max-w-4xl w-full flex flex-col max-h-[90vh] shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-zinc-800 bg-zinc-950/60">
          <div className="flex items-center gap-2 min-w-0">
            <Code className="w-4 h-4 text-indigo-400 shrink-0" />
            <h3 className="text-sm font-display font-semibold text-zinc-100 truncate">
              {title}
            </h3>
            {syntaxError ? (
              <span className="text-rose-400 font-mono text-[11px] truncate">
                {syntaxError}
              </span>
            ) : (
              <span className="text-emerald-400 font-mono text-[11px]">Valid JSON</span>
            )}
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={handleCopy}
              className="inline-flex items-center gap-1 px-2.5 py-1 text-xs bg-zinc-800 hover:bg-zinc-700 text-zinc-200 rounded-md cursor-pointer transition-colors"
            >
              {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
              <span>{copied ? 'Copied' : 'Copy'}</span>
            </button>
            <button
              type="button"
              onClick={handleDownload}
              className="inline-flex items-center gap-1 px-2.5 py-1 text-xs bg-zinc-800 hover:bg-zinc-700 text-zinc-200 rounded-md cursor-pointer transition-colors"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Download</span>
            </button>
            <button
              type="button"
              onClick={onClose}
              className="p-1 text-zinc-400 hover:text-zinc-200 rounded-md cursor-pointer transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* JSON Content Area */}
        <div className="flex-1 p-4 bg-zinc-950 overflow-hidden flex flex-col">
          <textarea
            value={jsonText}
            onChange={(e) => onChangeJsonText(e.target.value)}
            spellCheck={false}
            className="w-full flex-1 p-3 bg-zinc-900 border border-zinc-800 rounded-lg font-mono text-[11px] text-zinc-200 focus:border-indigo-500 focus:outline-none resize-none leading-relaxed"
          />
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-5 py-3 border-t border-zinc-800 bg-zinc-950/60 text-xs">
          <span className="text-zinc-400 font-mono text-[11px]">
            {jsonText.length.toLocaleString()} characters
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-3.5 py-1.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded-lg cursor-pointer"
            >
              Close
            </button>
            {onSave && (
              <button
                type="button"
                disabled={Boolean(syntaxError) || isSaving}
                onClick={onSave}
                className="inline-flex items-center gap-1.5 px-4 py-1.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white font-medium rounded-lg cursor-pointer transition-colors"
              >
                <Save className="w-3.5 h-3.5" />
                <span>{isSaving ? 'Saving…' : 'Save JSON'}</span>
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
