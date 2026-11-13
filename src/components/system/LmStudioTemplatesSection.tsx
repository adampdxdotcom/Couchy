import React from 'react';
import {
  Bot,
  MessageSquare,
  Plus,
  RefreshCw,
  RotateCcw,
  Save,
  Trash2,
} from 'lucide-react';
import type {
  LmStudioGuidingTemplate,
  LmStudioStatus,
} from '../../shared/types.ts';

interface LmStudioTemplatesSectionProps {
  lmStatus: LmStudioStatus | null;
  lmBaseUrl: string;
  setLmBaseUrl: (val: string) => void;
  lmSelectedModel: string;
  setLmSelectedModel: (val: string) => void;
  isTestingLm: boolean;
  onTestLmStudio: () => Promise<void>;
  conversationSystemPrompt: string;
  setConversationSystemPrompt: (val: string) => void;
  onSaveConversationPrompt: () => Promise<void>;
  onResetConversationPrompt: () => Promise<void>;
  guidingTemplates: LmStudioGuidingTemplate[];
  selectedGuidingId: number | null;
  onSelectGuidingTemplate: (id: number) => void;
  guidingName: string;
  setGuidingName: (val: string) => void;
  guidingIsDefault: boolean;
  setGuidingIsDefault: (val: boolean) => void;
  guidingSystemPrompt: string;
  setGuidingSystemPrompt: (val: string) => void;
  guidingUserTemplate: string;
  setGuidingUserTemplate: (val: string) => void;
  guidingFeedback: string | null;
  onSaveGuidingTemplate: (createAsNew: boolean) => Promise<void>;
  onDeleteGuidingTemplate: () => Promise<void>;
}

export const LmStudioTemplatesSection: React.FC<LmStudioTemplatesSectionProps> = ({
  lmStatus,
  lmBaseUrl,
  setLmBaseUrl,
  lmSelectedModel,
  setLmSelectedModel,
  isTestingLm,
  onTestLmStudio,
  conversationSystemPrompt,
  setConversationSystemPrompt,
  onSaveConversationPrompt,
  onResetConversationPrompt,
  guidingTemplates,
  selectedGuidingId,
  onSelectGuidingTemplate,
  guidingName,
  setGuidingName,
  guidingIsDefault,
  setGuidingIsDefault,
  guidingSystemPrompt,
  setGuidingSystemPrompt,
  guidingUserTemplate,
  setGuidingUserTemplate,
  guidingFeedback,
  onSaveGuidingTemplate,
  onDeleteGuidingTemplate,
}) => {
  return (
    <section className="bg-zinc-900 border border-zinc-800 rounded-xl p-5 space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-800 pb-4">
        <div className="flex items-center gap-2.5">
          <Bot className="w-4 h-4 text-indigo-400" />
          <div>
            <h2 className="text-sm font-display font-semibold text-zinc-100">
              LM Studio Agent &amp; Guiding Prompt Templates (Database)
            </h2>
            <p className="text-zinc-400">
              Configure your local LM Studio endpoint, Quick Gen Conversation prompt, and saved Guiding Prompt Templates for themed photo sets.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <span className="text-zinc-400 font-mono">
            Status: {lmStatus?.online ? 'Connected' : 'Offline'}
          </span>
          <button
            type="button"
            onClick={onTestLmStudio}
            disabled={isTestingLm}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-100 font-medium rounded-lg cursor-pointer"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isTestingLm ? 'animate-spin' : ''}`} />
            <span>{isTestingLm ? 'Testing...' : 'Save & Test LM Studio'}</span>
          </button>
        </div>
      </div>

      {guidingFeedback && (
        <div className="p-3 bg-indigo-950/50 border border-indigo-800/70 rounded-lg text-indigo-200">
          {guidingFeedback}
        </div>
      )}

      {/* LM Studio Endpoint & Model Row */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label className="block text-zinc-400 mb-1">
            LM Studio OpenAI-Compatible Endpoint URL
          </label>
          <input
            type="text"
            value={lmBaseUrl}
            onChange={(e) => setLmBaseUrl(e.target.value)}
            placeholder="http://localhost:1234/v1"
            className="w-full px-3 py-2 bg-zinc-950 border border-zinc-800 rounded-lg font-mono text-zinc-100"
          />
        </div>

        <div>
          <label className="block text-zinc-400 mb-1">
            Default LM Studio Model
          </label>
          {lmStatus && lmStatus.availableModels.length > 0 ? (
            <select
              value={lmSelectedModel}
              onChange={(e) => setLmSelectedModel(e.target.value)}
              className="w-full px-3 py-2 bg-zinc-950 border border-zinc-800 rounded-lg text-zinc-100"
            >
              {lmStatus.availableModels.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          ) : (
            <input
              type="text"
              value={lmSelectedModel}
              onChange={(e) => setLmSelectedModel(e.target.value)}
              placeholder="local-model (auto-detected when LM Studio is running)"
              className="w-full px-3 py-2 bg-zinc-950 border border-zinc-800 rounded-lg font-mono text-zinc-100"
            />
          )}
        </div>
      </div>

      {/* Quick Gen Conversation Mode Guiding Prompt */}
      <div className="pt-3 border-t border-zinc-800/80 space-y-2.5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <MessageSquare className="w-3.5 h-3.5 text-amber-400" />
            <label className="font-medium text-zinc-200">
              Quick Gen Conversation System Prompt
            </label>
          </div>
          <span className="text-[11px] text-zinc-400 font-mono">
            Used when Agent &rarr; Conversation is active in Quick Gen
          </span>
        </div>

        <textarea
          rows={6}
          value={conversationSystemPrompt}
          onChange={(e) => setConversationSystemPrompt(e.target.value)}
          className="w-full px-3 py-2 bg-zinc-950 border border-zinc-800 rounded-lg text-zinc-100 font-mono text-xs focus:outline-none focus:border-indigo-500"
        />

        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-[11px] text-zinc-400">
            Keep{' '}
            <code className="text-zinc-200">&lt;proposed_prompt&gt;...&lt;/proposed_prompt&gt;</code>{' '}
            in the instructions so the Quick Gen conversation knows when to render a one-click{' '}
            <span className="text-zinc-200 font-medium">Submit</span> button.
          </p>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onResetConversationPrompt}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 font-medium rounded-lg cursor-pointer"
              title="Reset Conversation System Prompt to factory default"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>Reset Default</span>
            </button>
            <button
              type="button"
              onClick={onSaveConversationPrompt}
              className="inline-flex items-center gap-1.5 px-3.5 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white font-medium rounded-lg cursor-pointer"
            >
              <Save className="w-3.5 h-3.5" />
              <span>Save Conversation Prompt</span>
            </button>
          </div>
        </div>
      </div>

      {/* Saved Guiding Prompt Templates Editor */}
      <div className="pt-3 border-t border-zinc-800/80 space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-12 gap-4 items-end">
          <div className="md:col-span-5">
            <label className="block text-zinc-400 mb-1">
              Select Saved Guiding Prompt Template ({guidingTemplates.length})
            </label>
            <select
              value={selectedGuidingId ?? ''}
              onChange={(e) => onSelectGuidingTemplate(Number(e.target.value))}
              className="w-full px-3 py-2 bg-zinc-950 border border-zinc-800 rounded-lg text-zinc-100"
            >
              {guidingTemplates.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name} {t.isDefault ? '(Default)' : ''}
                </option>
              ))}
            </select>
          </div>

          <div className="md:col-span-4">
            <label className="block text-zinc-400 mb-1">Template Name</label>
            <input
              type="text"
              value={guidingName}
              onChange={(e) => setGuidingName(e.target.value)}
              className="w-full px-3 py-2 bg-zinc-950 border border-zinc-800 rounded-lg text-zinc-100"
            />
          </div>

          <div className="md:col-span-3 flex items-center gap-2 pb-1">
            <label className="inline-flex items-center gap-2 text-zinc-300 cursor-pointer">
              <input
                type="checkbox"
                checked={guidingIsDefault}
                onChange={(e) => setGuidingIsDefault(e.target.checked)}
                className="rounded border-zinc-700 text-indigo-600 focus:ring-indigo-500"
              />
              <span>Default Guiding Template</span>
            </label>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="font-medium text-zinc-200">
                System Prompt (Guides how the LLM scripts the photo set)
              </label>
              <span className="text-[11px] text-zinc-400 font-mono">role: &quot;system&quot;</span>
            </div>
            <textarea
              rows={7}
              value={guidingSystemPrompt}
              onChange={(e) => setGuidingSystemPrompt(e.target.value)}
              className="w-full px-3 py-2 bg-zinc-950 border border-zinc-800 rounded-lg text-zinc-100 font-mono text-xs focus:outline-none focus:border-indigo-500"
            />
          </div>

          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="font-medium text-zinc-200">
                User Payload Template (Variables: {'{character}'}, {'{lora}'}, {'{theme}'}, {'{count}'}, {'{base_prompt}'})
              </label>
              <span className="text-[11px] text-zinc-400 font-mono">role: &quot;user&quot;</span>
            </div>
            <textarea
              rows={7}
              value={guidingUserTemplate}
              onChange={(e) => setGuidingUserTemplate(e.target.value)}
              className="w-full px-3 py-2 bg-zinc-950 border border-zinc-800 rounded-lg text-zinc-100 font-mono text-xs focus:outline-none focus:border-indigo-500"
            />
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
          <p className="text-[11px] text-zinc-400">
            Placeholders <code className="text-zinc-200">{'{character}'}</code>,{' '}
            <code className="text-zinc-200">{'{lora}'}</code>,{' '}
            <code className="text-zinc-200">{'{theme}'}</code>,{' '}
            <code className="text-zinc-200">{'{count}'}</code>, and{' '}
            <code className="text-zinc-200">{'{base_prompt}'}</code> are automatically replaced when you generate a themed set in the Generation tab.
          </p>

          <div className="flex items-center gap-2">
            {guidingTemplates.length > 1 && (
              <button
                type="button"
                onClick={onDeleteGuidingTemplate}
                className="inline-flex items-center gap-1.5 px-3 py-2 bg-zinc-950 hover:bg-red-950/50 text-zinc-400 hover:text-red-300 border border-zinc-800 rounded-lg cursor-pointer"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>Delete</span>
              </button>
            )}
            <button
              type="button"
              onClick={() => onSaveGuidingTemplate(true)}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-100 font-medium rounded-lg cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Save as New Template</span>
            </button>
            <button
              type="button"
              onClick={() => onSaveGuidingTemplate(false)}
              className="inline-flex items-center gap-1.5 px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white font-medium rounded-lg cursor-pointer"
            >
              <Save className="w-3.5 h-3.5" />
              <span>Save Guiding Template</span>
            </button>
          </div>
        </div>
      </div>
    </section>
  );
};
