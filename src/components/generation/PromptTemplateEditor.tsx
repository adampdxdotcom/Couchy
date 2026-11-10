import React, { useState } from 'react';
import {
  Bot,
  Eye,
  Play,
  Plus,
  RefreshCw,
  Save,
  Settings2,
  Sparkles,
} from 'lucide-react';
import type {
  CharacterProfile,
  GenerationLoraSelection,
  LmStudioGuidingTemplate,
  LmStudioStatus,
  PromptTemplate,
} from '../../shared/types.ts';
import { interpolatePrompt as interpolatePromptClient } from '../../shared/utils.ts';

export interface PromptTemplateEditorProps {
  generationMode: 'single' | 'theme_set';
  onChangeGenerationMode: (mode: 'single' | 'theme_set') => void;
  generationCount: number;
  templates: PromptTemplate[];
  selectedTemplateId: number | null;
  onSelectTemplateId: (id: number) => void;
  positivePromptTemplate: string;
  onChangePositivePrompt: (val: string) => void;
  negativePrompt: string;
  onChangeNegativePrompt: (val: string) => void;
  onSaveTemplate: (isNew: boolean) => void;
  templateSaveFeedback: string | null;
  themeText: string;
  onChangeThemeText: (val: string) => void;
  guidingTemplates: LmStudioGuidingTemplate[];
  selectedGuidingTemplateId: number | null;
  onSelectGuidingTemplateId: (id: number) => void;
  selectedCharacter: CharacterProfile | null;
  activeLoras: GenerationLoraSelection[];
  lmStatus: LmStudioStatus | null;
  lmUrlInput: string;
  onChangeLmUrl: (val: string) => void;
  lmModelInput: string;
  onChangeLmModel: (val: string) => void;
  isTestingLm: boolean;
  onTestLmStudio: () => void;
  isGeneratingAgentPrompts: boolean;
  onRunLmStudioAgent: () => void;
  agentFeedback: string | null;
  isSubmitting: boolean;
  onSubmitBatch: () => void;
  submitFeedback: { message: string; type: 'success' | 'error' } | null;
  onOpenSystemSettings?: () => void;
}

/**
 * Editor for prompt templates, variables ({character}, {lora}, {theme}),
 * and LM Studio Agent theme generation.
 */
export const PromptTemplateEditor: React.FC<PromptTemplateEditorProps> = ({
  generationMode,
  onChangeGenerationMode,
  generationCount,
  templates,
  selectedTemplateId,
  onSelectTemplateId,
  positivePromptTemplate,
  onChangePositivePrompt,
  negativePrompt,
  onChangeNegativePrompt,
  onSaveTemplate,
  templateSaveFeedback,
  themeText,
  onChangeThemeText,
  guidingTemplates,
  selectedGuidingTemplateId,
  onSelectGuidingTemplateId,
  selectedCharacter,
  activeLoras,
  lmStatus,
  lmUrlInput,
  onChangeLmUrl,
  lmModelInput,
  onChangeLmModel,
  isTestingLm,
  onTestLmStudio,
  isGeneratingAgentPrompts,
  onRunLmStudioAgent,
  agentFeedback,
  isSubmitting,
  onSubmitBatch,
  submitFeedback,
  onOpenSystemSettings,
}) => {
  const [showGuidingPreview, setShowGuidingPreview] = useState(false);

  const activeGuidingTemplate = guidingTemplates.find(
    (g) => g.id === selectedGuidingTemplateId
  ) || guidingTemplates[0];

  const loraTriggerSummary = activeLoras
    .map((l) => l.triggerWord || l.loraName)
    .filter(Boolean)
    .join(', ');

  return (
    <section className="p-5 bg-zinc-900/60 border border-zinc-800/90 rounded-xl space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-display font-semibold text-zinc-100">
          04. Prompt Mode & LM Studio Set Agent
        </h2>
        <div className="flex items-center gap-1 p-1 bg-zinc-950 border border-zinc-800 rounded-lg">
          <button
            type="button"
            onClick={() => onChangeGenerationMode('single')}
            className={`px-2.5 py-1 text-xs font-medium rounded transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              generationMode === 'single'
                ? 'bg-zinc-800 text-zinc-100'
                : 'text-zinc-400 hover:text-zinc-200'
            }`}
          >
            Single Prompt (Verbatim)
          </button>
          <button
            type="button"
            onClick={() => onChangeGenerationMode('theme_set')}
            className={`px-2.5 py-1 text-xs font-medium rounded transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              generationMode === 'theme_set'
                ? 'bg-indigo-600 text-white'
                : 'text-zinc-400 hover:text-zinc-200'
            }`}
          >
            Photo Set Theme (LM Studio)
          </button>
        </div>
      </div>

      {generationMode === 'single' ? (
        <div className="p-2.5 bg-zinc-950 border border-zinc-800/80 rounded-lg text-xs text-zinc-400">
          <strong>Verbatim Mode:</strong> LM Studio is bypassed. Your prompt below is injected verbatim into Node #30_19 {generationCount} time{generationCount === 1 ? '' : 's'} with unique 64-bit seeds in Node #30_3.
        </div>
      ) : (
        <div className="p-2.5 bg-indigo-950/30 border border-indigo-800/50 rounded-lg text-xs text-indigo-200">
          <strong>Theme Set Mode:</strong> Enter a theme and click <strong>Generate Set Prompts with LM Studio</strong>. LM Studio will script {generationCount} distinct prompts into the Outgoing Batch Queue on the right for you to preview and edit before sending to ComfyUI.
        </div>
      )}

      {/* Saved Prompt Templates Selector */}
      <div className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <label className="text-xs font-medium text-zinc-400">
            Base Prompt Template (Supports {'{character}'}, {'{lora}'}, {'{theme}'})
          </label>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={selectedTemplateId ?? ''}
            onChange={(e) => onSelectTemplateId(Number(e.target.value))}
            className="flex-1 px-3 py-1.5 text-xs bg-zinc-950 border border-zinc-800 rounded-lg text-zinc-100"
          >
            {templates.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name} {t.isDefault ? '(Default)' : ''}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => onSaveTemplate(false)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-zinc-200 bg-zinc-800 hover:bg-zinc-700 rounded-lg whitespace-nowrap shrink-0 cursor-pointer transition-colors"
            title="Update and set as Default Prompt in database"
          >
            <Save className="w-3.5 h-3.5" />
            <span>Save Default</span>
          </button>
          <button
            type="button"
            onClick={() => onSaveTemplate(true)}
            className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-zinc-300 bg-zinc-900 border border-zinc-800 hover:bg-zinc-800 rounded-lg whitespace-nowrap shrink-0 cursor-pointer transition-colors"
            title="Save as a new template in database"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>New</span>
          </button>
        </div>

        {templateSaveFeedback && (
          <p className="text-xs text-emerald-400">{templateSaveFeedback}</p>
        )}
      </div>

      {/* Base Positive & Negative Prompt Inputs */}
      <div className="space-y-3">
        <div>
          <label className="block text-xs font-medium text-zinc-300 mb-1">
            {generationMode === 'single'
              ? 'User Prompt (Sent Verbatim to Node #30_19 value)'
              : 'Base Positive Style Prompt (Passed to LM Studio)'}
          </label>
          <textarea
            rows={3}
            value={positivePromptTemplate}
            onChange={(e) => onChangePositivePrompt(e.target.value)}
            className="w-full px-3 py-2 text-xs bg-zinc-950 border border-zinc-800 rounded-lg text-zinc-100 focus:outline-none focus:border-indigo-500"
          />
        </div>

        <div>
          <label className="block text-xs font-medium text-zinc-400 mb-1">
            Negative Prompt (Used if workflow maps a negative conditioning node)
          </label>
          <textarea
            rows={2}
            value={negativePrompt}
            onChange={(e) => onChangeNegativePrompt(e.target.value)}
            className="w-full px-3 py-1.5 text-xs bg-zinc-950 border border-zinc-800 rounded-lg text-zinc-300 focus:outline-none focus:border-indigo-500"
          />
        </div>
      </div>

      {/* Photo Set Theme & LM Studio Agent Panel */}
      {generationMode === 'theme_set' && (
        <div className="p-4 bg-zinc-950 border border-zinc-800 rounded-xl space-y-4">
          <div>
            <label className="block text-xs font-medium text-zinc-300 mb-1">
              Photo Set Theme Description
            </label>
            <input
              type="text"
              value={themeText}
              onChange={(e) => onChangeThemeText(e.target.value)}
              placeholder="e.g., Cozy rainy afternoon in a vintage bookstore, warm tungsten lamps"
              className="w-full px-3 py-2 text-xs bg-zinc-900 border border-zinc-800 rounded-lg text-zinc-100 focus:outline-none focus:border-indigo-500"
            />
          </div>

          {/* Guiding Prompt Template Selector */}
          <div className="space-y-2 pt-2 border-t border-zinc-800/80">
            <div className="flex items-center justify-between">
              <label className="text-xs font-medium text-zinc-300">
                LM Studio Guiding Prompt Template
              </label>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setShowGuidingPreview((prev) => !prev)}
                  className="inline-flex items-center gap-1 text-[11px] text-zinc-400 hover:text-zinc-200 cursor-pointer"
                >
                  <Eye className="w-3 h-3" />
                  <span>
                    {showGuidingPreview ? 'Hide Guiding Prompt' : 'Inspect Guiding Prompt'}
                  </span>
                </button>
                {onOpenSystemSettings && (
                  <>
                    <span className="text-zinc-700">·</span>
                    <button
                      type="button"
                      onClick={onOpenSystemSettings}
                      className="inline-flex items-center gap-1 text-[11px] text-indigo-400 hover:text-indigo-300 cursor-pointer"
                    >
                      <Settings2 className="w-3 h-3" />
                      <span>Edit Templates in System & Backup</span>
                    </button>
                  </>
                )}
              </div>
            </div>

            <select
              value={selectedGuidingTemplateId ?? ''}
              onChange={(e) => onSelectGuidingTemplateId(Number(e.target.value))}
              className="w-full px-3 py-1.5 text-xs bg-zinc-900 border border-zinc-800 rounded-lg text-zinc-100"
            >
              {guidingTemplates.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name} {g.isDefault ? '(Default)' : ''}
                </option>
              ))}
            </select>

            {showGuidingPreview && activeGuidingTemplate && (
              <div className="p-3 bg-zinc-900/90 border border-zinc-800 rounded-lg space-y-2 text-[11px] font-mono text-zinc-300">
                <div>
                  <span className="text-indigo-400 block mb-0.5">
                    System Prompt Sent to LM Studio:
                  </span>
                  <p className="whitespace-pre-wrap text-zinc-400">
                    {interpolatePromptClient(activeGuidingTemplate.systemPrompt, {
                      characterName: selectedCharacter?.name || 'Character',
                      loraSummary: loraTriggerSummary,
                      theme: themeText,
                      count: generationCount,
                    })}
                  </p>
                </div>
                <div className="pt-2 border-t border-zinc-800">
                  <span className="text-indigo-400 block mb-0.5">
                    User Message Sent to LM Studio:
                  </span>
                  <p className="whitespace-pre-wrap text-zinc-400">
                    {interpolatePromptClient(activeGuidingTemplate.userPromptTemplate, {
                      characterName: selectedCharacter?.name || 'Character',
                      loraSummary: loraTriggerSummary,
                      theme: themeText,
                      count: generationCount,
                      basePrompt: positivePromptTemplate,
                    })}
                  </p>
                </div>
              </div>
            )}
          </div>

          {/* LM Studio Connection & Model Bar */}
          <div className="space-y-3 pt-2 border-t border-zinc-800/80">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5 text-xs font-medium text-zinc-200">
                <Bot className="w-4 h-4 text-indigo-400" />
                <span>LM Studio Local LLM</span>
              </div>
              <span className="text-[11px] text-zinc-400">
                {lmStatus?.online ? 'Connected' : 'Offline (Fallback Ready)'}
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <div>
                <label className="block text-[11px] text-zinc-400 mb-1">
                  LM Studio Endpoint
                </label>
                <div className="flex items-center gap-1">
                  <input
                    type="text"
                    value={lmUrlInput}
                    onChange={(e) => onChangeLmUrl(e.target.value)}
                    placeholder="http://localhost:1234/v1"
                    className="w-full px-2.5 py-1.5 text-xs font-mono bg-zinc-900 border border-zinc-800 rounded text-zinc-200"
                  />
                  <button
                    type="button"
                    onClick={onTestLmStudio}
                    disabled={isTestingLm}
                    className="p-1.5 bg-zinc-900 border border-zinc-800 hover:bg-zinc-800 rounded text-zinc-300 cursor-pointer"
                    title="Refresh LM Studio connection & models"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${isTestingLm ? 'animate-spin' : ''}`} />
                  </button>
                </div>
              </div>

              <div>
                <label className="block text-[11px] text-zinc-400 mb-1">LLM Model</label>
                {lmStatus && lmStatus.availableModels.length > 0 ? (
                  <select
                    value={lmModelInput}
                    onChange={(e) => onChangeLmModel(e.target.value)}
                    className="w-full px-2.5 py-1.5 text-xs bg-zinc-900 border border-zinc-800 rounded text-zinc-200"
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
                    value={lmModelInput}
                    onChange={(e) => onChangeLmModel(e.target.value)}
                    placeholder="local-model (auto)"
                    className="w-full px-2.5 py-1.5 text-xs font-mono bg-zinc-900 border border-zinc-800 rounded text-zinc-200"
                  />
                )}
              </div>
            </div>

            <button
              type="button"
              onClick={onRunLmStudioAgent}
              disabled={isGeneratingAgentPrompts}
              className="w-full inline-flex items-center justify-center gap-2 px-4 py-2 text-xs font-medium text-indigo-100 bg-indigo-950/80 hover:bg-indigo-900/80 border border-indigo-700/70 rounded-lg transition-colors cursor-pointer"
            >
              <Sparkles className="w-3.5 h-3.5 text-indigo-400" />
              <span>
                {isGeneratingAgentPrompts
                  ? `Scripting ${generationCount} Set Prompts via LM Studio...`
                  : `Generate ${generationCount} Photo Set Prompts with LM Studio (Preview in Queue)`}
              </span>
            </button>

            {agentFeedback && (
              <p className="text-[11px] text-zinc-400 leading-relaxed">{agentFeedback}</p>
            )}
          </div>
        </div>
      )}

      {/* Primary Dispatch Button: Send All at Once to ComfyUI */}
      {submitFeedback && (
        <div
          className={`p-3 rounded-lg text-xs border ${
            submitFeedback.type === 'success'
              ? 'bg-emerald-950/40 border-emerald-800/70 text-emerald-200'
              : 'bg-red-950/40 border-red-800/70 text-red-200'
          }`}
        >
          {submitFeedback.message}
        </div>
      )}

      <button
        type="button"
        onClick={onSubmitBatch}
        disabled={isSubmitting}
        className="w-full inline-flex items-center justify-center gap-2 px-5 py-3 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 rounded-xl transition-colors cursor-pointer"
      >
        <Play className="w-4 h-4 fill-current" />
        <span>
          {isSubmitting
            ? `Sending ${generationCount} Jobs to ComfyUI...`
            : `Send All ${generationCount} Generation${generationCount === 1 ? '' : 's'} at Once to ComfyUI`}
        </span>
      </button>
    </section>
  );
};
