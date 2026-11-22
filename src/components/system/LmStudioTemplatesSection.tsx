import React, { useState } from 'react';
import {
  Bot,
  ChevronDown,
  ChevronRight,
  Info,
  Layers,
  MessageSquare,
  RefreshCw,
  RotateCcw,
  Save,
} from 'lucide-react';
import type { LmStudioStatus } from '../../shared/types.ts';
import { BATCH_EXPANSION_PRESETS } from '../../shared/agentPromptDefaults.ts';

interface LmStudioTemplatesSectionProps {
  lmStatus: LmStudioStatus | null;
  lmBaseUrl: string;
  setLmBaseUrl: (val: string) => void;
  lmSelectedModel: string;
  setLmSelectedModel: (val: string) => void;
  lmFollowLoadedModel: boolean;
  onToggleFollowLoadedModel: (next: boolean, overrideSelectedModel?: string) => Promise<void>;
  isTestingLm: boolean;
  onTestLmStudio: () => Promise<void>;
  conversationSystemPrompt: string;
  setConversationSystemPrompt: (val: string) => void;
  onSaveConversationPrompt: () => Promise<void>;
  onResetConversationPrompt: () => Promise<void>;
  batchExpansionPrompt: string;
  setBatchExpansionPrompt: (val: string) => void;
  onSaveBatchExpansionPrompt: () => Promise<void>;
  onResetBatchExpansionPrompt: () => Promise<void>;
  guidingFeedback: string | null;
}

/**
 * Fast synchronous BPE-style token estimator (typically within ~5% of Gemma/Llama/Qwen tokenizers).
 */
function estimatePromptTokens(text: string): number {
  const trimmed = text.trim();
  if (!trimmed) return 0;
  const pieces = trimmed.match(/[A-Za-z0-9]+|[^\sA-Za-z0-9]|\n+/g);
  if (!pieces) return Math.ceil(trimmed.length / 4);
  let count = 0;
  for (const piece of pieces) {
    if (piece.startsWith('\n')) {
      count += piece.length;
    } else if (/^[A-Za-z0-9]+$/.test(piece)) {
      count += piece.length <= 7 ? 1 : Math.ceil(piece.length / 4);
    } else {
      count += 1;
    }
  }
  return count;
}

export const LmStudioTemplatesSection: React.FC<LmStudioTemplatesSectionProps> = ({
  lmStatus,
  lmBaseUrl,
  setLmBaseUrl,
  lmSelectedModel,
  setLmSelectedModel,
  lmFollowLoadedModel,
  onToggleFollowLoadedModel,
  isTestingLm,
  onTestLmStudio,
  conversationSystemPrompt,
  setConversationSystemPrompt,
  onSaveConversationPrompt,
  onResetConversationPrompt,
  batchExpansionPrompt,
  setBatchExpansionPrompt,
  onSaveBatchExpansionPrompt,
  onResetBatchExpansionPrompt,
  guidingFeedback,
}) => {
  const [showRuntimeContext, setShowRuntimeContext] = useState(false);
  const agentPromptTokens = estimatePromptTokens(conversationSystemPrompt);
  const batchPromptTokens = estimatePromptTokens(batchExpansionPrompt);

  return (
    <section className="bg-zinc-900 border border-zinc-800 rounded-xl p-5 space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-800 pb-4">
        <div className="flex items-center gap-2.5">
          <Bot className="w-4 h-4 text-indigo-400" />
          <div>
            <h2 className="text-sm font-display font-semibold text-zinc-100">
              Local LLM Agent Configuration
            </h2>
            <p className="text-zinc-400">
              One unified Agent powers Quick Gen brainstorming, batch Concept &rarr; Shot expansion (x2–x8), and Generation Studio sets.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {lmStatus?.apiKeyConfigured && (
            <span
              className="px-2 py-0.5 rounded bg-emerald-500/15 border border-emerald-500/35 text-emerald-300 font-mono text-[11px]"
              title="Server-side Bearer API key is configured via LOCAL_LLM_API_KEY"
            >
              Bearer Auth Configured
            </span>
          )}
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
            <span>{isTestingLm ? 'Testing...' : 'Save & Test Local LLM'}</span>
          </button>
        </div>
      </div>

      {guidingFeedback && (
        <div className="p-3 bg-indigo-950/50 border border-indigo-800/70 rounded-lg text-indigo-200">
          {guidingFeedback}
        </div>
      )}

      {/* Local LLM Endpoint & Model Row */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <label className="block text-zinc-400">
            Local LLM OpenAI-Compatible Endpoint URL
          </label>
          <input
            type="text"
            value={lmBaseUrl}
            onChange={(e) => setLmBaseUrl(e.target.value)}
            placeholder="http://localhost:11434/v1"
            className="w-full px-3 py-2 bg-zinc-950 border border-zinc-800 rounded-lg font-mono text-zinc-100"
          />
          <div className="flex flex-wrap items-center gap-1.5 pt-0.5 text-[11px] text-zinc-500">
            <span>Presets:</span>
            {[
              { label: 'Ollama (:11434)', url: 'http://localhost:11434/v1' },
              { label: 'llama.cpp (:8080)', url: 'http://localhost:8080/v1' },
              { label: 'KoboldCpp (:5001)', url: 'http://localhost:5001/v1' },
              { label: 'vLLM (:8000)', url: 'http://localhost:8000/v1' },
              { label: 'Port 1234', url: 'http://localhost:1234/v1' },
            ].map((preset) => (
              <button
                key={preset.url}
                type="button"
                onClick={() => setLmBaseUrl(preset.url)}
                className={`px-2 py-0.5 rounded border font-mono transition-colors cursor-pointer ${
                  lmBaseUrl.replace(/\/+$/, '') === preset.url
                    ? 'bg-indigo-600/20 border-indigo-500/50 text-indigo-300'
                    : 'bg-zinc-950 border-zinc-800 text-zinc-400 hover:text-zinc-200 hover:border-zinc-700'
                }`}
              >
                {preset.label}
              </button>
            ))}
          </div>
        </div>

        <div className="space-y-1.5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <label className="block text-zinc-400">
              {lmFollowLoadedModel ? 'Active Local LLM Model' : 'Pinned Local LLM Model'}
            </label>
            <div className="inline-flex items-center p-0.5 bg-zinc-950 border border-zinc-800 rounded-lg text-[11px]">
              <button
                type="button"
                onClick={() => void onToggleFollowLoadedModel(true)}
                className={`px-2 py-0.5 rounded-md font-medium transition-colors cursor-pointer ${
                  lmFollowLoadedModel
                    ? 'bg-indigo-600/25 text-indigo-300 border border-indigo-500/40'
                    : 'text-zinc-400 hover:text-zinc-200 border border-transparent'
                }`}
                title="Automatically follow whichever chat or vision model is currently loaded on your LLM server (LM Studio, Ollama, etc.)"
              >
                Auto-follow loaded
              </button>
              <button
                type="button"
                onClick={() => void onToggleFollowLoadedModel(false)}
                className={`px-2 py-0.5 rounded-md font-medium transition-colors cursor-pointer ${
                  !lmFollowLoadedModel
                    ? 'bg-zinc-800 text-zinc-100 border border-zinc-700'
                    : 'text-zinc-400 hover:text-zinc-200 border border-transparent'
                }`}
                title="Stay pinned to your manually chosen model ID (useful for on-demand servers like Ollama)"
              >
                Pin manually
              </button>
            </div>
          </div>

          {lmStatus && lmStatus.availableModels.length > 0 ? (
            <select
              value={lmSelectedModel}
              onChange={(e) => {
                const nextVal = e.target.value;
                setLmSelectedModel(nextVal);
                if (
                  lmFollowLoadedModel &&
                  lmStatus.loadedModels.length > 0 &&
                  !lmStatus.loadedModels.includes(nextVal)
                ) {
                  void onToggleFollowLoadedModel(false, nextVal);
                }
              }}
              className="w-full px-3 py-2 bg-zinc-950 border border-zinc-800 rounded-lg text-zinc-100"
            >
              {lmStatus.availableModels.map((m) => {
                const isLoaded = lmStatus.loadedModels.includes(m);
                return (
                  <option key={m} value={m}>
                    {isLoaded ? `${m} (loaded)` : m}
                  </option>
                );
              })}
            </select>
          ) : (
            <input
              type="text"
              value={lmSelectedModel}
              onChange={(e) => setLmSelectedModel(e.target.value)}
              placeholder="local-model (auto-detected when Local LLM is running)"
              className="w-full px-3 py-2 bg-zinc-950 border border-zinc-800 rounded-lg font-mono text-zinc-100"
            />
          )}

          <p className="text-[11px] text-zinc-500">
            {!lmStatus?.online ? (
              'Connect your Local LLM server to detect loaded models.'
            ) : lmStatus.loadedModels.length > 0 ? (
              <span className="text-emerald-400/90">
                Loaded on server: <span className="font-mono">{lmStatus.loadedModels.join(', ')}</span>
                {lmFollowLoadedModel ? ' · Auto-sync active' : ' · Pinned'}
              </span>
            ) : lmStatus.detectedProvider === 'lmstudio' ? (
              'No model loaded in LM Studio yet — load any model in LM Studio and Couchy will follow it automatically.'
            ) : lmStatus.detectedProvider === 'ollama' ? (
              'No model currently in VRAM — Couchy will send the fallback model so Ollama loads it on demand.'
            ) : (
              'Using fallback selection from /v1/models.'
            )}
          </p>
        </div>
      </div>

      {/* Primary Agent System Prompt */}
      <div className="pt-3 border-t border-zinc-800/80 space-y-2.5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <MessageSquare className="w-3.5 h-3.5 text-amber-400" />
            <label className="font-medium text-zinc-200">
              Primary Agent System Prompt
            </label>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-[11px] font-mono tabular-nums">
            <span
              title="Estimated BPE token count for this base system prompt (before runtime LoRA/preset catalog and chat history)"
              className={`px-2 py-0.5 rounded border ${
                agentPromptTokens > 1500
                  ? 'bg-amber-500/15 border-amber-500/40 text-amber-300'
                  : 'bg-zinc-950 border-zinc-800 text-indigo-300'
              }`}
            >
              ~{agentPromptTokens.toLocaleString()} tokens
            </span>
            <span className="text-zinc-500">
              {conversationSystemPrompt.length.toLocaleString()} chars
            </span>
            <span className="text-zinc-600 hidden sm:inline">·</span>
            <span className="text-zinc-400 hidden sm:inline">
              Used in ALL Agent chat turns &amp; batch expansions
            </span>
          </div>
        </div>

        <textarea
          rows={7}
          value={conversationSystemPrompt}
          onChange={(e) => setConversationSystemPrompt(e.target.value)}
          className="w-full px-3 py-2 bg-zinc-950 border border-zinc-800 rounded-lg text-zinc-100 font-mono text-xs focus:outline-none focus:border-indigo-500"
        />

        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-[11px] text-zinc-400">
            Keep{' '}
            <code className="text-zinc-200">&lt;proposed_prompt&gt;...&lt;/proposed_prompt&gt;</code>{' '}
            in the instructions for <code className="text-zinc-200">x1</code> mode (in{' '}
            <code className="text-zinc-200">x2–x8</code> mode, Concept instructions are appended automatically).
          </p>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onResetConversationPrompt}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 font-medium rounded-lg cursor-pointer"
              title="Reset Primary Agent System Prompt to factory default"
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
              <span>Save Agent Prompt</span>
            </button>
          </div>
        </div>
      </div>

      {/* Batch Expansion Instructions (x2-x8 & Generation Studio) */}
      <div className="pt-3 border-t border-zinc-800/80 space-y-2.5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Layers className="w-3.5 h-3.5 text-indigo-400" />
            <label className="font-medium text-zinc-200">
              Batch Expansion Instructions (x2–x8 &amp; Generation Studio)
            </label>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-[11px] font-mono tabular-nums">
            <span
              title="Estimated BPE token count for the batch expansion instructions"
              className="px-2 py-0.5 rounded bg-zinc-950 border border-zinc-800 text-indigo-300"
            >
              ~{batchPromptTokens.toLocaleString()} tokens
            </span>
            <span className="text-zinc-400">
              4096 max tokens &middot; 90s timeout &middot; &lt;shot_1&gt; tags
            </span>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
          <span className="text-zinc-500 mr-1">Style Presets:</span>
          {BATCH_EXPANSION_PRESETS.map((preset) => (
            <button
              key={preset.label}
              type="button"
              onClick={() => setBatchExpansionPrompt(preset.text)}
              className={`px-2.5 py-1 rounded border transition-colors cursor-pointer ${
                batchExpansionPrompt.trim() === preset.text.trim()
                  ? 'bg-indigo-600/20 border-indigo-500/50 text-indigo-300'
                  : 'bg-zinc-950 border-zinc-800 text-zinc-400 hover:text-zinc-200 hover:border-zinc-700'
              }`}
            >
              {preset.label}
            </button>
          ))}
        </div>

        <textarea
          rows={6}
          value={batchExpansionPrompt}
          onChange={(e) => setBatchExpansionPrompt(e.target.value)}
          className="w-full px-3 py-2 bg-zinc-950 border border-zinc-800 rounded-lg text-zinc-100 font-mono text-xs focus:outline-none focus:border-indigo-500"
        />

        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-[11px] text-zinc-400">
            Guides shot framing and pacing when expanding a Set Concept into{' '}
            <code className="text-zinc-200">{'{count}'}</code> shots—each shot is authored
            individually for full ~80–140 word detail while preserving requested wardrobe and mood.
          </p>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onResetBatchExpansionPrompt}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 font-medium rounded-lg cursor-pointer"
              title="Reset Batch Expansion Instructions to factory default"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>Reset Default</span>
            </button>
            <button
              type="button"
              onClick={onSaveBatchExpansionPrompt}
              className="inline-flex items-center gap-1.5 px-3.5 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white font-medium rounded-lg cursor-pointer"
            >
              <Save className="w-3.5 h-3.5" />
              <span>Save Batch Instructions</span>
            </button>
          </div>
        </div>
      </div>

      {/* Collapsible Runtime Context Explanation */}
      <div className="pt-2 border-t border-zinc-800/80">
        <button
          type="button"
          onClick={() => setShowRuntimeContext((prev) => !prev)}
          className="inline-flex items-center gap-1.5 text-[11px] text-zinc-400 hover:text-zinc-200 cursor-pointer"
        >
          {showRuntimeContext ? (
            <ChevronDown className="w-3.5 h-3.5" />
          ) : (
            <ChevronRight className="w-3.5 h-3.5" />
          )}
          <Info className="w-3.5 h-3.5 text-indigo-400" />
          <span>Runtime Context Injected Automatically (do not duplicate in prompts)</span>
        </button>

        {showRuntimeContext && (
          <div className="mt-2 p-3 rounded-lg bg-zinc-950 border border-zinc-800/90 text-[11px] text-zinc-400 space-y-1">
            <p>
              <span className="text-zinc-200 font-medium">1. Character Profile:</span> Attached Personality/Bio (450 chars), Physical Reference Guide (500 chars), and active character variant label—used as a guiding reference (not copied verbatim) without outputting names or filenames.
            </p>
            <p>
              <span className="text-zinc-200 font-medium">2. Attached LoRA Descriptions:</span> Category &amp; Agent description of every currently attached LoRA (clamped to 240 chars) so scenes complement active LoRAs without writing trigger words into the prompt.
            </p>
            <p>
              <span className="text-zinc-200 font-medium">3. Optional LoRA Catalog (Chat):</span> Curated non-character{' '}
              <code className="text-zinc-300">@handle</code> LoRAs available for automatic selection via{' '}
              <code className="text-zinc-300">&lt;selected_loras&gt;</code>.
            </p>
            <p>
              <span className="text-zinc-200 font-medium">4. Batch Mode Directive:</span> When Quick Gen is set to{' '}
              <code className="text-zinc-300">x2–x8</code>, the chat automatically receives Set Concept rules (<code className="text-zinc-300">&lt;proposed_concept&gt;</code>) before expansion.
            </p>
          </div>
        )}
      </div>
    </section>
  );
};
