import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Bot, RefreshCw, Sparkles } from 'lucide-react';
import { api } from '../api/client.ts';
import type {
  CharacterProfile,
  GenerationBatchRecord,
  GenerationLoraSelection,
  ImageRecord,
  LmStudioGuidingTemplate,
  LmStudioStatus,
  LoraExplorerItem,
  ModelInventoryItem,
  PromptTemplate,
  WorkflowLibraryItem,
} from '../shared/types.ts';
import {
  interpolatePrompt as interpolatePromptClient,
  resolveDefaultWorkflow,
} from '../shared/utils.ts';
import { CharacterLoraStackPanel } from './generation/CharacterLoraStackPanel.tsx';
import { ResolutionSelectorPanel } from './generation/ResolutionSelectorPanel.tsx';
import { WorkflowSelectionPanel } from './generation/WorkflowSelectionPanel.tsx';
import { PromptTemplateEditor } from './generation/PromptTemplateEditor.tsx';
import { BatchQueueHistory } from './generation/BatchQueueHistory.tsx';

interface GenerationStudioViewProps {
  characters: CharacterProfile[];
  loras: LoraExplorerItem[];
  models?: ModelInventoryItem[];
  workflows: WorkflowLibraryItem[];
  checkpoints: string[];
  allImages: ImageRecord[];
  onRefreshAll: () => Promise<void>;
  onOpenImage: (img: ImageRecord) => void;
  onOpenSystemSettings?: () => void;
}

export const GenerationStudioView: React.FC<GenerationStudioViewProps> = ({
  characters,
  loras,
  models = [],
  workflows,
  checkpoints,
  allImages,
  onRefreshAll,
  onOpenImage,
  onOpenSystemSettings,
}) => {
  // 1. Character, LoRA Stack & Trigger Word State
  const [selectedCharacterId, setSelectedCharacterId] = useState<number | null>(
    characters[0]?.id ?? null
  );
  const [activeLoras, setActiveLoras] = useState<GenerationLoraSelection[]>([]);
  const [triggerWord, setTriggerWord] = useState<string>('');

  // 2. Resolution & Batch Count State
  const [aspectRatio, setAspectRatio] = useState<string>('2:3 (Portrait Photo)');
  const [megapixels, setMegapixels] = useState<number>(3.0);
  const [generationCount, setGenerationCount] = useState<number>(4);

  // 3. System Workflow & Diffusion Model State
  const primaryWorkflow = useMemo(() => resolveDefaultWorkflow(workflows), [workflows]);
  const selectedWorkflowId = primaryWorkflow?.id ?? null;

  const [selectedCheckpoint, setSelectedCheckpoint] = useState<string>('');
  const [workflowDefaultCheckpoint, setWorkflowDefaultCheckpoint] = useState<string>('');

  // 4. Prompt Mode & Template State
  const [generationMode, setGenerationMode] = useState<'single' | 'theme_set'>('single');
  const [positivePromptTemplate, setPositivePromptTemplate] = useState<string>(
    'beautiful portrait, soft cinematic lighting, highly detailed, masterwork'
  );
  const [negativePrompt, setNegativePrompt] = useState<string>(
    'worst quality, normal quality, low quality, low res, blurry, distorted, extra limbs, bad anatomy'
  );
  const [themeText, setThemeText] = useState<string>('');
  const [templates, setTemplates] = useState<PromptTemplate[]>([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState<number | null>(null);
  const [templateSaveFeedback, setTemplateSaveFeedback] = useState<string | null>(null);

  // 5. LM Studio Guiding Templates & Connection State
  const [guidingTemplates, setGuidingTemplates] = useState<LmStudioGuidingTemplate[]>([]);
  const [selectedGuidingTemplateId, setSelectedGuidingTemplateId] = useState<number | null>(null);
  const [lmStatus, setLmStatus] = useState<LmStudioStatus | null>(null);
  const [lmUrlInput, setLmUrlInput] = useState<string>('http://localhost:1234/v1');
  const [lmModelInput, setLmModelInput] = useState<string>('');
  const [isTestingLm, setIsTestingLm] = useState<boolean>(false);
  const [isGeneratingAgentPrompts, setIsGeneratingAgentPrompts] = useState<boolean>(false);
  const [agentFeedback, setAgentFeedback] = useState<string | null>(null);

  // 6. Outgoing Queue & Batch History
  const [outgoingPrompts, setOutgoingPrompts] = useState<string[]>([]);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [submitFeedback, setSubmitFeedback] = useState<{
    message: string;
    type: 'success' | 'error';
  } | null>(null);
  const [batches, setBatches] = useState<GenerationBatchRecord[]>([]);

  // Selected Character Entity
  const selectedCharacter = useMemo(
    () => characters.find((c) => c.id === selectedCharacterId) || null,
    [characters, selectedCharacterId]
  );

  // Combined diffusion models list
  const availableDiffusionModels = useMemo(() => {
    const set = new Set<string>(checkpoints);
    for (const m of models) {
      if (
        m.modelType === 'checkpoint' ||
        m.modelType === 'diffusion' ||
        m.modelType === 'other'
      ) {
        set.add(m.filename);
      }
    }
    return Array.from(set).filter(Boolean).sort();
  }, [checkpoints, models]);

  // Load Prompt Templates, LM Studio templates, and Batch History
  useEffect(() => {
    api.listPromptTemplates().then((res) => {
      const items = res.items || [];
      setTemplates(items);
      const def = items.find((t) => t.isDefault) || items[0];
      if (def) {
        setSelectedTemplateId(def.id);
        setPositivePromptTemplate(def.positiveTemplate);
        setNegativePrompt(def.negativeTemplate);
      }
    });

    api.listLmStudioGuidingTemplates().then((res) => {
      const items = res.items || [];
      setGuidingTemplates(items);
      const def = items.find((g: LmStudioGuidingTemplate) => g.isDefault) || items[0];
      if (def) setSelectedGuidingTemplateId(def.id);
    });

    api.getLmStudioStatus().then((status) => {
      if (status) {
        setLmStatus(status);
        if (status.baseUrl) setLmUrlInput(status.baseUrl);
        if (status.selectedModel) setLmModelInput(status.selectedModel);
      }
    });

    api.listGenerationBatches().then((res) => setBatches(res.items || []));
  }, []);

  // Sync Character profile LoRAs & Trigger word when selected character changes
  useEffect(() => {
    if (selectedCharacter) {
      const lorasFromChar: GenerationLoraSelection[] = selectedCharacter.loras.map((l) => ({
        loraName: l.loraName,
        modelStrength: 0.85,
        clipStrength: 0.85,
        appearanceLabel: l.appearanceLabel,
        triggerWord: l.triggerWord || '',
      }));
      setActiveLoras(lorasFromChar);

      const triggerWords = selectedCharacter.loras
        .map((l) => l.triggerWord)
        .filter(Boolean)
        .join(', ');
      setTriggerWord(triggerWords);
    } else {
      setActiveLoras([]);
      setTriggerWord('');
    }
  }, [selectedCharacter]);

  // Sync default resolution & diffusion model from the primary System Workflow
  const loadSystemWorkflowDefaults = useCallback(
    async (wf: WorkflowLibraryItem) => {
      if (typeof wf.defaultMegapixels === 'number' && wf.defaultMegapixels > 0) {
        setMegapixels(wf.defaultMegapixels);
      }
      if (typeof wf.defaultAspectRatio === 'string' && wf.defaultAspectRatio.trim()) {
        setAspectRatio(wf.defaultAspectRatio);
      }
      try {
        const wfDetail = await api.getWorkflow(wf.id);
        const rawStr =
          wfDetail.workflow?.api_workflow_json || wfDetail.workflow?.visual_workflow_json;
        if (rawStr) {
          const parsed = JSON.parse(rawStr);
          let defaultCkpt = '';
          for (const node of Object.values(parsed) as any[]) {
            const inputs = node.inputs || {};
            if (inputs.unet_name) defaultCkpt = String(inputs.unet_name);
            else if (inputs.ckpt_name) defaultCkpt = String(inputs.ckpt_name);
            if (defaultCkpt) break;
          }
          setWorkflowDefaultCheckpoint(defaultCkpt);
          if (!selectedCheckpoint) setSelectedCheckpoint(defaultCkpt);
        }
      } catch (err) {
        console.warn('Failed to load system workflow defaults:', err);
      }
    },
    [selectedCheckpoint]
  );

  useEffect(() => {
    if (primaryWorkflow) {
      loadSystemWorkflowDefaults(primaryWorkflow);
    }
  }, [primaryWorkflow, loadSystemWorkflowDefaults]);

  const loraTriggerSummary = useMemo(() => {
    return activeLoras
      .map((l) => l.triggerWord || l.loraName)
      .filter(Boolean)
      .join(', ');
  }, [activeLoras]);

  // Sync outgoing prompts preview queue
  useEffect(() => {
    if (generationMode === 'single') {
      const single = interpolatePromptClient(positivePromptTemplate, {
        characterName: selectedCharacter?.name || '',
        loraSummary: loraTriggerSummary,
        theme: '',
      });
      setOutgoingPrompts(Array(generationCount).fill(single));
    } else if (themeText.trim()) {
      setOutgoingPrompts((prev) => {
        if (prev.length === generationCount) return prev;
        const themed = interpolatePromptClient(positivePromptTemplate, {
          characterName: selectedCharacter?.name || '',
          loraSummary: loraTriggerSummary,
          theme: themeText,
        });
        return Array(generationCount)
          .fill(themed)
          .map((base, idx) => `${base}, variation #${idx + 1}`);
      });
    }
  }, [
    generationMode,
    positivePromptTemplate,
    selectedCharacter,
    loraTriggerSummary,
    themeText,
    generationCount,
  ]);

  const handleTestLmStudio = async () => {
    setIsTestingLm(true);
    setAgentFeedback(null);
    try {
      const status = await api.getLmStudioStatus(lmUrlInput);
      setLmStatus(status);
      if (status.selectedModel) setLmModelInput(status.selectedModel);
      setAgentFeedback(
        `LM Studio connection verified: ${status.availableModels?.length || 0} models available.`
      );
    } catch (err: any) {
      setAgentFeedback(`Connection check failed: ${err.message}`);
    } finally {
      setIsTestingLm(false);
    }
  };

  const handleRunLmStudioAgent = async () => {
    if (!selectedGuidingTemplateId) return;
    setIsGeneratingAgentPrompts(true);
    setAgentFeedback(null);
    try {
      const res = await api.generateSetPromptsWithAgent({
        characterName: selectedCharacter?.name || '',
        loraNames: activeLoras.map((l) => l.loraName),
        theme: themeText.trim() || 'Cinematic expressive portrait series',
        count: generationCount,
        basePromptTemplate: positivePromptTemplate,
        guidingTemplateId: selectedGuidingTemplateId,
        baseUrlOverride: lmUrlInput || undefined,
      });

      if (res.prompts && res.prompts.length > 0) {
        setOutgoingPrompts(res.prompts);
        setAgentFeedback(
          `LM Studio agent successfully generated ${res.prompts.length} distinct set prompts.`
        );
      } else {
        setAgentFeedback('LM Studio did not return prompt variations. Used fallback prompts.');
      }
    } catch (err: any) {
      setAgentFeedback(`LM Studio Agent failed: ${err.message}`);
    } finally {
      setIsGeneratingAgentPrompts(false);
    }
  };

  const handleUpdateDefaultTemplate = async (isNew = false) => {
    try {
      const name = isNew
        ? `Template ${new Date().toLocaleTimeString()}`
        : templates.find((t) => t.id === selectedTemplateId)?.name || 'Default Template';

      const res = await api.savePromptTemplate({
        id: isNew ? undefined : selectedTemplateId ?? undefined,
        name,
        positiveTemplate: positivePromptTemplate,
        negativeTemplate: negativePrompt,
        isDefault: true,
      });
      setTemplateSaveFeedback(`Saved prompt template "${res.template.name}"`);
      setTimeout(() => setTemplateSaveFeedback(null), 3000);
      const listRes = await api.listPromptTemplates();
      setTemplates(listRes.items || []);
      setSelectedTemplateId(res.template.id);
    } catch (err: any) {
      setTemplateSaveFeedback(`Save error: ${err.message}`);
    }
  };

  const handleSubmitBatch = async () => {
    if (!selectedWorkflowId) {
      setSubmitFeedback({
        message: 'Please select a workflow before generating.',
        type: 'error',
      });
      return;
    }
    setIsSubmitting(true);
    setSubmitFeedback(null);

    try {
      const res = await api.submitGenerationBatch({
        characterId: selectedCharacterId,
        workflowId: selectedWorkflowId,
        mode: generationMode,
        themeTitle: generationMode === 'theme_set' ? themeText : undefined,
        aspectRatio,
        megapixels,
        prompts: outgoingPrompts,
        triggerWord: triggerWord.trim() || undefined,
        negativePrompt,
        loras: activeLoras,
        checkpointName: selectedCheckpoint || undefined,
      });

      setSubmitFeedback({
        message: `Batch #${res.batch.id} (${res.batch.items?.length || 0} generations) dispatched to ComfyUI.`,
        type: 'success',
      });
      const batchRes = await api.listGenerationBatches();
      setBatches(batchRes.items || []);
      await onRefreshAll();
    } catch (err: any) {
      setSubmitFeedback({
        message: `Batch submission failed: ${err.message}`,
        type: 'error',
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="px-6 py-6 max-w-7xl mx-auto space-y-8">
      {/* Top Banner */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-display font-semibold text-zinc-100">
            Generation Studio & Photo Set Director
          </h1>
          <p className="text-xs text-zinc-400 mt-0.5">
            Configure multi-LoRA stacks (Node #50), Resolution Selector dimensions (Node #49), and
            script photo sets using local LM Studio LLMs before sending batches to ComfyUI.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {onOpenSystemSettings && (
            <button
              type="button"
              onClick={onOpenSystemSettings}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs bg-zinc-900 border border-zinc-800 hover:bg-zinc-800 text-zinc-300 rounded-lg cursor-pointer transition-colors"
            >
              <Bot className="w-3.5 h-3.5 text-indigo-400" />
              <span>Configure LM Studio</span>
            </button>
          )}
        </div>
      </div>

      {/* Main Studio Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* LEFT COLUMN: Controls & Settings (5 cols on desktop) */}
        <div className="lg:col-span-5 space-y-5">
          {/* STEP 1: Character, LoRA Stack & Trigger Word */}
          <CharacterLoraStackPanel
            characters={characters}
            selectedCharacterId={selectedCharacterId}
            onSelectCharacterId={setSelectedCharacterId}
            triggerWord={triggerWord}
            onChangeTriggerWord={setTriggerWord}
            activeLoras={activeLoras}
            onChangeActiveLoras={setActiveLoras}
            loras={loras}
          />

          {/* STEP 2: ResolutionSelector (Node #49) */}
          <ResolutionSelectorPanel
            aspectRatio={aspectRatio}
            onChangeAspectRatio={setAspectRatio}
            megapixels={megapixels}
            onChangeMegapixels={setMegapixels}
            generationCount={generationCount}
            onChangeGenerationCount={setGenerationCount}
          />

          {/* STEP 3: Diffusion Model (Node #30_10) */}
          <WorkflowSelectionPanel
            selectedCheckpoint={selectedCheckpoint}
            onChangeCheckpoint={setSelectedCheckpoint}
            workflowDefaultCheckpoint={workflowDefaultCheckpoint}
            availableDiffusionModels={availableDiffusionModels}
          />

          {/* STEP 4: Prompt Mode & LM Studio Set Agent */}
          <PromptTemplateEditor
            generationMode={generationMode}
            onChangeGenerationMode={setGenerationMode}
            generationCount={generationCount}
            templates={templates}
            selectedTemplateId={selectedTemplateId}
            onSelectTemplateId={(id) => {
              setSelectedTemplateId(id);
              const found = templates.find((t) => t.id === id);
              if (found) {
                setPositivePromptTemplate(found.positiveTemplate);
                setNegativePrompt(found.negativeTemplate);
              }
            }}
            positivePromptTemplate={positivePromptTemplate}
            onChangePositivePrompt={setPositivePromptTemplate}
            negativePrompt={negativePrompt}
            onChangeNegativePrompt={setNegativePrompt}
            onSaveTemplate={handleUpdateDefaultTemplate}
            templateSaveFeedback={templateSaveFeedback}
            themeText={themeText}
            onChangeThemeText={setThemeText}
            guidingTemplates={guidingTemplates}
            selectedGuidingTemplateId={selectedGuidingTemplateId}
            onSelectGuidingTemplateId={setSelectedGuidingTemplateId}
            selectedCharacter={selectedCharacter}
            activeLoras={activeLoras}
            lmStatus={lmStatus}
            lmUrlInput={lmUrlInput}
            onChangeLmUrl={setLmUrlInput}
            lmModelInput={lmModelInput}
            onChangeLmModel={setLmModelInput}
            isTestingLm={isTestingLm}
            onTestLmStudio={handleTestLmStudio}
            isGeneratingAgentPrompts={isGeneratingAgentPrompts}
            onRunLmStudioAgent={handleRunLmStudioAgent}
            agentFeedback={agentFeedback}
            isSubmitting={isSubmitting}
            onSubmitBatch={handleSubmitBatch}
            submitFeedback={submitFeedback}
            onOpenSystemSettings={onOpenSystemSettings}
          />
        </div>

        {/* RIGHT COLUMN: Prompt Set Inspector & Live ComfyUI Batch Queue (7 cols on desktop) */}
        <div className="lg:col-span-7 space-y-5">
          {/* Outgoing Generation Batch Preview Queue */}
          <section className="p-5 bg-zinc-900/60 border border-zinc-800/90 rounded-xl space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-sm font-display font-semibold text-zinc-100 flex items-center gap-1.5">
                  <Sparkles className="w-4 h-4 text-indigo-400" />
                  <span>Outgoing Prompt Queue Preview ({outgoingPrompts.length} Shots)</span>
                </h2>
                <p className="text-xs text-zinc-400">
                  {generationMode === 'single'
                    ? 'Verbatim single prompt dispatched across batch slots with unique 64-bit seeds'
                    : 'LM Studio scripted prompt sequence for this themed photo set'}
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  const single = interpolatePromptClient(positivePromptTemplate, {
                    characterName: selectedCharacter?.name || '',
                    loraSummary: loraTriggerSummary,
                    theme: themeText,
                  });
                  setOutgoingPrompts(Array(generationCount).fill(single));
                }}
                className="inline-flex items-center gap-1 text-xs text-zinc-400 hover:text-zinc-200 cursor-pointer transition-colors"
                title="Reset queue to current template"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                <span>Reset Prompts</span>
              </button>
            </div>

            <div className="space-y-2.5 max-h-[460px] overflow-y-auto pr-1">
              {outgoingPrompts.map((promptText, idx) => (
                <div
                  key={idx}
                  className="p-3 bg-zinc-950 border border-zinc-800 rounded-lg space-y-1.5"
                >
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-mono text-indigo-300 font-semibold tabular-nums">
                      Shot #{idx + 1}
                    </span>
                    <span className="text-[11px] font-mono text-zinc-500">
                      Seed: Random 64-bit on submit
                    </span>
                  </div>
                  <textarea
                    rows={2}
                    value={promptText}
                    onChange={(e) => {
                      const next = [...outgoingPrompts];
                      next[idx] = e.target.value;
                      setOutgoingPrompts(next);
                    }}
                    className="w-full px-2.5 py-1.5 text-xs bg-zinc-900 border border-zinc-800 rounded font-mono text-zinc-200 focus:outline-none focus:border-indigo-500"
                  />
                </div>
              ))}
            </div>
          </section>

          {/* Historical Batches Queue */}
          <BatchQueueHistory
            batches={batches}
            allImages={allImages}
            onRefreshBatches={() =>
              api.listGenerationBatches().then((res) => setBatches(res.items || []))
            }
            onOpenImage={onOpenImage}
          />
        </div>
      </div>
    </div>
  );
};
