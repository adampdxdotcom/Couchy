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

const EXPANSION_STYLE_PRESETS: { label: string; text: string }[] = [
  {
    label: 'Editorial Variety',
    text: `You are now expanding the approved Set Concept / Theme into {count} distinct, cohesive image generation prompts for a multi-shot set.

Follow all visual translation, pronoun, character-safety, and concrete detail rules from your primary instructions, plus these expansion rules:
1. Lock Invariants Across Every Shot: Preserve the approved wardrobe details (garment cuts, colors, fabrics, fasteners, footwear, accessories), environment/room props, lighting direction/color temperature, and visual style consistently across all {count} shots unless the concept explicitly calls for a progression.
2. Vary Composition & Action: Give each shot a clearly distinct camera framing (e.g., wide environmental establishing shot, medium three-quarter candid, intimate close-up portrait, over-the-shoulder or dynamic low angle), body posture, physical action, and expression.
3. Self-Contained Prompts: Every shot must be written as a complete, standalone text-to-image paragraph with no cross-references like "same outfit as shot 1".
4. Never include character names or model/LoRA filenames (such as .safetensors).
5. Output Format: Wrap each prompt in numbered XML tags <shot_1>...</shot_1> through <shot_{count}>...</shot_{count}> with no markdown code fences or extra commentary.`,
  },
  {
    label: 'Storyboard Arc',
    text: `You are now expanding the approved Set Concept / Theme into a chronological {count}-shot cinematic storyboard sequence.

Follow all visual translation, pronoun, character-safety, and concrete detail rules from your primary instructions, plus these progression rules:
1. Chronological Flow: Progress smoothly across the {count} shots—open with an establishing wide atmospheric shot, move into medium action/interaction within the setting, build toward a close-up emotional beat, and finish with a dramatic culminating angle.
2. Lock Continuity: Carry forward the exact wardrobe details, room architecture, props, and lighting setup consistently from shot 1 through shot {count}.
3. Self-Contained Prompts: Write each shot as a complete, standalone text-to-image paragraph with clear spatial positioning and contact points.
4. Never include character names or model/LoRA filenames (such as .safetensors).
5. Output Format: Wrap each prompt in numbered XML tags <shot_1>...</shot_1> through <shot_{count}>...</shot_{count}> with no markdown code fences or extra commentary.`,
  },
  {
    label: 'Lookbook Angles',
    text: `You are now expanding the approved Set Concept / Theme into {count} studio & editorial lookbook variations.

Follow all visual translation, pronoun, character-safety, and concrete detail rules from your primary instructions, plus these lookbook rules:
1. Keep Outfit & Set Locked: Preserve the exact garment details, fabrics, colors, lighting mood, and setting props verbatim across all {count} shots.
2. Systematically Vary Camera & Pose: Rotate focal length (35mm, 50mm, 85mm, 135mm), camera angle (eye-level, low angle, profile, three-quarter, over-the-shoulder), and distinct body poses/head tilts across every shot.
3. Self-Contained Prompts: Write each shot as a complete, standalone text-to-image paragraph.
4. Never include character names or model/LoRA filenames (such as .safetensors).
5. Output Format: Wrap each prompt in numbered XML tags <shot_1>...</shot_1> through <shot_{count}>...</shot_{count}> with no markdown code fences or extra commentary.`,
  },
];

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
  batchExpansionPrompt: string;
  setBatchExpansionPrompt: (val: string) => void;
  onSaveBatchExpansionPrompt: () => Promise<void>;
  onResetBatchExpansionPrompt: () => Promise<void>;
  guidingFeedback: string | null;
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
  batchExpansionPrompt,
  setBatchExpansionPrompt,
  onSaveBatchExpansionPrompt,
  onResetBatchExpansionPrompt,
  guidingFeedback,
}) => {
  const [showRuntimeContext, setShowRuntimeContext] = useState(false);

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

        <div>
          <label className="block text-zinc-400 mb-1.5">Default Local LLM Model</label>
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
              placeholder="local-model (auto-detected when Local LLM is running)"
              className="w-full px-3 py-2 bg-zinc-950 border border-zinc-800 rounded-lg font-mono text-zinc-100"
            />
          )}
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
          <span className="text-[11px] text-zinc-400 font-mono">
            Used in ALL Agent chat turns &amp; batch expansions
          </span>
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
          <span className="text-[11px] text-zinc-400 font-mono">
            4096 max tokens &middot; 90s timeout &middot; &lt;shot_1&gt; tags
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
          <span className="text-zinc-500 mr-1">Style Presets:</span>
          {EXPANSION_STYLE_PRESETS.map((preset) => (
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
            Appended after your Primary Agent Prompt whenever expanding a Set Concept into{' '}
            <code className="text-zinc-200">{'{count}'}</code> shots. Keep{' '}
            <code className="text-zinc-200">&lt;shot_1&gt;...&lt;/shot_&#123;count&#125;&gt;</code>{' '}
            so multi-shot quotes and detailed paragraphs parse reliably.
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
              <span className="text-zinc-200 font-medium">1. Character Profile:</span> Attached character traits/description (clamped to 500 chars) + active character variant label, paired with rules to match profile pronouns without outputting names or filenames.
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
