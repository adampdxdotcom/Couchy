import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Bot,
  Eye,
  Layers,
  Play,
  Plus,
  RefreshCw,
  Save,
  Settings2,
  Sliders,
  Sparkles,
  Trash2,
  Upload,
} from 'lucide-react';
import { api } from '../api/client.ts';
import { NodeMapperModal } from './NodeMapperModal.tsx';
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
  WorkflowNodeMapping,
} from '../shared/types.ts';

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

/**
 * Standard ComfyUI ResolutionSelector (Node #49) aspect_ratio strings.
 */
const ASPECT_RATIO_PRESETS: {
  value: string;
  shortRatio: string;
  label: string;
  boxW: number;
  boxH: number;
}[] = [
  { value: '1:1 (Square)', shortRatio: '1:1', label: 'Square', boxW: 18, boxH: 18 },
  { value: '2:3 (Portrait Photo)', shortRatio: '2:3', label: 'Portrait Photo', boxW: 14, boxH: 21 },
  { value: '3:2 (Photo)', shortRatio: '3:2', label: 'Photo', boxW: 21, boxH: 14 },
  { value: '3:4 (Portrait Standard)', shortRatio: '3:4', label: 'Portrait Std', boxW: 15, boxH: 20 },
  { value: '4:3 (Standard)', shortRatio: '4:3', label: 'Standard', boxW: 20, boxH: 15 },
  { value: '9:16 (Portrait Widescreen)', shortRatio: '9:16', label: 'Vertical Wide', boxW: 12, boxH: 22 },
  { value: '16:9 (Widescreen)', shortRatio: '16:9', label: 'Widescreen', boxW: 22, boxH: 12 },
  { value: '21:9 (Ultrawide)', shortRatio: '21:9', label: 'Ultrawide', boxW: 24, boxH: 10 },
];

const MEGAPIXEL_PRESETS = [0.5, 1.0, 2.0, 3.0, 4.0, 8.0];

function interpolatePromptClient(
  template: string,
  vars: {
    characterName: string;
    loraSummary: string;
    theme: string;
    count?: number;
    basePrompt?: string;
  }
): string {
  let out = template
    .replace(/\{character\}/gi, vars.characterName || 'subject')
    .replace(/\{lora\}/gi, vars.loraSummary || '')
    .replace(/\{theme\}/gi, vars.theme || '');
  if (vars.count !== undefined) {
    out = out.replace(/\{count\}/gi, String(vars.count));
  }
  if (vars.basePrompt !== undefined) {
    out = out.replace(/\{base_prompt\}/gi, vars.basePrompt);
  }
  return out
    .replace(/,\s*,/g, ',')
    .replace(/\s{2,}/g, ' ')
    .replace(/^,\s*|\s*,\s*$/g, '')
    .trim();
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
  // 1. Character, LoRA Stack (Node #50 Power Lora Loader), and Trigger Word (Node #30_27 string_b)
  const [selectedCharacterId, setSelectedCharacterId] = useState<number | null>(
    characters[0]?.id ?? null
  );
  const [activeLoras, setActiveLoras] = useState<GenerationLoraSelection[]>([]);
  const [triggerWord, setTriggerWord] = useState<string>('');
  const [extraLoraToAdd, setExtraLoraToAdd] = useState<string>('');

  // 2. ResolutionSelector (Node #49): Aspect Ratio & Megapixels (0.1 to 10.0) + Batch Count
  const [aspectRatio, setAspectRatio] = useState<string>('2:3 (Portrait Photo)');
  const [megapixels, setMegapixels] = useState<number>(3.0);
  const [generationCount, setGenerationCount] = useState<number>(4);

  // 3. Workflow & Diffusion Model (Node #30_10 UNETLoader unet_name)
  const [selectedWorkflowId, setSelectedWorkflowId] = useState<number | null>(
    workflows[0]?.id ?? null
  );
  const [selectedCheckpoint, setSelectedCheckpoint] = useState<string>('');
  const [workflowMapping, setWorkflowMapping] = useState<WorkflowNodeMapping | null>(null);
  const [mapperModalState, setMapperModalState] = useState<{
    open: boolean;
    tab: 'map' | 'import';
  }>({ open: false, tab: 'map' });

  // 4. Prompt Templates (stored in SQLite)
  const [templates, setTemplates] = useState<PromptTemplate[]>([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState<number | null>(null);
  const [templateNameInput, setTemplateNameInput] = useState<string>('');
  const [positivePromptTemplate, setPositivePromptTemplate] = useState<string>(
    'masterpiece, best quality, ultra-detailed editorial photography of {character}, {lora}, {theme}, natural skin texture, sharp focus on eyes, cinematic rim lighting, shot on 85mm f/1.4 lens, shallow depth of field'
  );
  const [negativePrompt, setNegativePrompt] = useState<string>(
    'worst quality, low quality, blurry, deformed, bad anatomy, extra limbs, mutated hands, watermark, text, signature, oversaturated'
  );
  const [templateSaveFeedback, setTemplateSaveFeedback] = useState<string | null>(null);

  // 5. Mode & Photo Set Theme / LM Studio Agent
  const [generationMode, setGenerationMode] = useState<'single' | 'theme_set'>('single');
  const [themeText, setThemeText] = useState<string>(
    'golden hour rooftop lounge in Tokyo, candid editorial portrait series'
  );
  const [lmStatus, setLmStatus] = useState<LmStudioStatus | null>(null);
  const [guidingTemplates, setGuidingTemplates] = useState<LmStudioGuidingTemplate[]>([]);
  const [selectedGuidingTemplateId, setSelectedGuidingTemplateId] = useState<number | null>(null);
  const [showGuidingPreview, setShowGuidingPreview] = useState<boolean>(false);
  const [lmUrlInput, setLmUrlInput] = useState<string>('http://localhost:1234/v1');
  const [lmModelInput, setLmModelInput] = useState<string>('');
  const [isTestingLm, setIsTestingLm] = useState<boolean>(false);
  const [isGeneratingAgentPrompts, setIsGeneratingAgentPrompts] = useState<boolean>(false);
  const [agentPrompts, setAgentPrompts] = useState<string[]>([]);
  const [agentFeedback, setAgentFeedback] = useState<string | null>(null);

  // 6. Batch Queue & Submission
  const [batches, setBatches] = useState<GenerationBatchRecord[]>([]);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [submitFeedback, setSubmitFeedback] = useState<{
    type: 'success' | 'error';
    message: string;
  } | null>(null);

  const selectedCharacter = useMemo(
    () => characters.find((c) => c.id === selectedCharacterId) || null,
    [characters, selectedCharacterId]
  );

  // Combine available diffusion/UNET/checkpoint models from inventory and metadata
  const availableDiffusionModels = useMemo(() => {
    const set = new Set<string>(checkpoints);
    for (const m of models) {
      if (m.modelType === 'checkpoint' || m.modelType === 'other') {
        set.add(m.filename);
      }
    }
    return Array.from(set).sort();
  }, [checkpoints, models]);

  // Prefill LoRAs and Trigger Word (Node #30_27 string_b) whenever character changes
  useEffect(() => {
    if (!selectedCharacter) {
      setActiveLoras([]);
      setTriggerWord('');
      return;
    }
    const prefilled: GenerationLoraSelection[] = selectedCharacter.loras.map((l) => ({
      loraName: l.loraName,
      modelStrength: 1.0,
      clipStrength: 1.0,
      appearanceLabel: l.appearanceLabel,
      triggerWord: l.triggerWord || '',
    }));
    setActiveLoras(prefilled);

    const combinedTrigger = prefilled
      .map((l) => (l.triggerWord || '').trim())
      .filter(Boolean)
      .join(', ');
    setTriggerWord(combinedTrigger);

    if (selectedCharacter.workflows.length > 0) {
      setSelectedWorkflowId(selectedCharacter.workflows[0].workflowId);
    }
  }, [selectedCharacter]);

  useEffect(() => {
    if (!selectedWorkflowId && workflows.length > 0) {
      setSelectedWorkflowId(workflows[0].id);
    }
  }, [workflows, selectedWorkflowId]);

  useEffect(() => {
    if (!selectedWorkflowId) return;
    api
      .getWorkflowMapping(selectedWorkflowId)
      .then((res) => setWorkflowMapping(res.mapping))
      .catch(() => setWorkflowMapping(null));
  }, [selectedWorkflowId]);

  // Load initial templates, LM Studio status + guiding templates, and recent batches
  const loadStudioData = useCallback(async () => {
    try {
      const [tplRes, lmRes, batchRes] = await Promise.all([
        api.listPromptTemplates(),
        api.getLmStudioStatus(),
        api.listGenerationBatches(),
      ]);

      const tplItems = tplRes.items || [];
      setTemplates(tplItems);
      if (tplItems.length > 0 && !selectedTemplateId) {
        const def = tplItems.find((t) => t.isDefault) || tplItems[0];
        setSelectedTemplateId(def.id);
        setTemplateNameInput(def.name);
        setPositivePromptTemplate(def.positiveTemplate);
        setNegativePrompt(def.negativeTemplate);
      }

      setLmStatus(lmRes);
      setLmUrlInput(lmRes.baseUrl || 'http://localhost:1234/v1');
      setLmModelInput(lmRes.selectedModel || lmRes.availableModels[0] || '');

      const guidingList = lmRes.guidingTemplates || [];
      setGuidingTemplates(guidingList);
      if (guidingList.length > 0 && !selectedGuidingTemplateId) {
        const defGuiding = guidingList.find((g) => g.isDefault) || guidingList[0];
        setSelectedGuidingTemplateId(defGuiding.id);
      }

      setBatches(batchRes.items || []);
    } catch (err) {
      console.error('Failed to load Generation Studio data:', err);
    }
  }, [selectedTemplateId, selectedGuidingTemplateId]);

  useEffect(() => {
    loadStudioData();
  }, [loadStudioData]);

  // Poll batches every 4 seconds while any batch item is pending/submitted
  useEffect(() => {
    const hasActive = batches.some((b) =>
      b.items.some((it) => it.status === 'pending' || it.status === 'submitted')
    );
    if (!hasActive) return;
    const timer = setInterval(() => {
      api
        .listGenerationBatches()
        .then((res) => setBatches(res.items || []))
        .catch(() => {});
    }, 4000);
    return () => clearInterval(timer);
  }, [batches]);

  const loraTriggerSummary = useMemo(
    () =>
      activeLoras
        .map((l) =>
          l.appearanceLabel && l.appearanceLabel !== 'Default'
            ? l.appearanceLabel
            : l.loraName.replace(/\.(safetensors|ckpt|pt)$/i, '')
        )
        .join(', '),
    [activeLoras]
  );

  const activeGuidingTemplate = useMemo(
    () =>
      guidingTemplates.find((g) => g.id === selectedGuidingTemplateId) ||
      guidingTemplates[0] ||
      null,
    [guidingTemplates, selectedGuidingTemplateId]
  );

  // Compute resolved prompts that will be sent to ComfyUI Node #30_19
  const previewPrompts = useMemo(() => {
    const charName = selectedCharacter?.name || 'character';
    if (generationMode === 'single') {
      // Verbatim single prompt mode (never touches LM Studio)
      const single = interpolatePromptClient(positivePromptTemplate, {
        characterName: charName,
        loraSummary: loraTriggerSummary,
        theme: '',
      });
      return Array.from({ length: generationCount }, () => single);
    }

    // Photo Set Theme Mode: if LM Studio Agent has generated prompts, show them in the queue
    if (agentPrompts.length > 0) {
      const list: string[] = [];
      for (let i = 0; i < generationCount; i++) {
        list.push(agentPrompts[i % agentPrompts.length]);
      }
      return list;
    }

    // Before clicking Generate with LM Studio, show a preview with the theme interpolated
    const themed = interpolatePromptClient(positivePromptTemplate, {
      characterName: charName,
      loraSummary: loraTriggerSummary,
      theme: themeText,
    });
    return Array.from({ length: generationCount }, () => themed);
  }, [
    selectedCharacter,
    generationMode,
    positivePromptTemplate,
    loraTriggerSummary,
    generationCount,
    agentPrompts,
    themeText,
  ]);

  const handleUpdateDefaultTemplate = async (asNew = false) => {
    setTemplateSaveFeedback(null);
    try {
      const res = await api.savePromptTemplate({
        id: asNew ? undefined : selectedTemplateId || undefined,
        name: asNew
          ? `${templateNameInput || 'Custom Prompt'} (Copy)`
          : templateNameInput || 'Default Character Prompt',
        positiveTemplate: positivePromptTemplate,
        negativeTemplate: negativePrompt,
        isDefault: true,
      });
      setTemplates(res.items);
      setSelectedTemplateId(res.template.id);
      setTemplateNameInput(res.template.name);
      setTemplateSaveFeedback(
        asNew
          ? 'Saved as new default prompt template in database.'
          : 'Updated default prompt in database.'
      );
      setTimeout(() => setTemplateSaveFeedback(null), 3500);
    } catch (err: any) {
      setTemplateSaveFeedback(`Error: ${err.message}`);
    }
  };

  const handleTestLmStudio = async () => {
    setIsTestingLm(true);
    try {
      const status = await api.updateLmStudioConfig({
        baseUrl: lmUrlInput,
        selectedModel: lmModelInput,
      });
      setLmStatus(status);
      if (status.selectedModel) setLmModelInput(status.selectedModel);
    } catch (err: any) {
      setAgentFeedback(`LM Studio error: ${err.message}`);
    } finally {
      setIsTestingLm(false);
    }
  };

  const handleRunLmStudioAgent = async () => {
    setIsGeneratingAgentPrompts(true);
    setAgentFeedback(null);
    try {
      const res = await api.generateSetPromptsWithAgent({
        characterName: selectedCharacter?.name || 'Character',
        characterDescription: selectedCharacter?.description || '',
        loraNames: activeLoras.map((l) => l.loraName),
        theme: themeText,
        count: generationCount,
        basePromptTemplate: positivePromptTemplate,
        guidingTemplateId: selectedGuidingTemplateId || undefined,
        modelOverride: lmModelInput || undefined,
        baseUrlOverride: lmUrlInput || undefined,
      });
      setAgentPrompts(res.prompts);
      if (res.warning) {
        setAgentFeedback(res.warning);
      } else {
        setAgentFeedback(
          `Generated ${res.prompts.length} photo set prompts via ${res.modelUsed} using guiding template "${res.guidingTemplateName}". Review or edit any shot on the right before sending to ComfyUI.`
        );
      }
    } catch (err: any) {
      setAgentFeedback(`Agent generation failed: ${err.message}`);
    } finally {
      setIsGeneratingAgentPrompts(false);
    }
  };

  const handleSubmitBatch = async () => {
    if (!selectedWorkflowId) {
      setSubmitFeedback({
        type: 'error',
        message: 'Please select or import a ComfyUI workflow first.',
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
        prompts: previewPrompts,
        triggerWord,
        negativePrompt,
        loras: activeLoras,
        checkpointName: selectedCheckpoint || undefined,
      });
      setBatches(res.batches || []);
      setSubmitFeedback({
        type: 'success',
        message: `Dispatched all ${previewPrompts.length} generation jobs (${aspectRatio} @ ${megapixels.toFixed(1)} MP) at once to ComfyUI.`,
      });
      await onRefreshAll();
    } catch (err: any) {
      setSubmitFeedback({
        type: 'error',
        message: err.message || 'Failed to submit batch to ComfyUI',
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="max-w-[1600px] mx-auto px-6 py-6">
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* LEFT COLUMN: Generation Studio Control Deck (5 cols on desktop) */}
        <div className="lg:col-span-5 space-y-5">
          {/* STEP 1: Character, Power Lora Loader (#50), and Trigger Word (#30_27) */}
          <section className="p-5 bg-zinc-900/60 border border-zinc-800/90 rounded-xl space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-display font-semibold text-zinc-100">
                01. Character, LoRA Stack & Trigger Word
              </h2>
              <span className="text-xs text-zinc-400 font-mono tabular-nums">
                {activeLoras.length} LoRA{activeLoras.length === 1 ? '' : 's'} · Enable LoRA:{' '}
                {activeLoras.length > 0 ? 'ON' : 'OFF'}
              </span>
            </div>

            <div>
              <label className="block text-xs font-medium text-zinc-400 mb-1.5">
                Select Character (Auto-Prefills Character LoRAs & Trigger Word)
              </label>
              <select
                value={selectedCharacterId ?? ''}
                onChange={(e) =>
                  setSelectedCharacterId(e.target.value ? Number(e.target.value) : null)
                }
                className="w-full px-3 py-2 text-sm bg-zinc-950 border border-zinc-800 rounded-lg text-zinc-100 focus:outline-none focus:border-indigo-500"
              >
                <option value="">-- Unassigned / Custom Subject --</option>
                {characters.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} ({c.loras.length} LoRA{c.loras.length === 1 ? '' : 's'} ·{' '}
                    {c.confirmedImageCount} images)
                  </option>
                ))}
              </select>
            </div>

            {/* Editable Trigger Word for Node #30_27 string_b */}
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-xs font-medium text-zinc-300">
                  Character / LoRA Trigger Word (Injected into Node #30_27{' '}
                  <code className="text-indigo-300">string_b</code>)
                </label>
                <span className="text-[11px] font-mono text-zinc-500">
                  {triggerWord.trim() ? `"${triggerWord.trim()}"` : 'Empty'}
                </span>
              </div>
              <input
                type="text"
                value={triggerWord}
                onChange={(e) => setTriggerWord(e.target.value)}
                placeholder="e.g. xmelx (auto-filled from Character LoRA, editable per run)"
                className="w-full px-3 py-2 text-xs font-mono bg-zinc-950 border border-zinc-800 rounded-lg text-indigo-200 focus:outline-none focus:border-indigo-500"
              />
            </div>

            {/* Active LoRAs list (Node #50 Power Lora Loader: lora_1, lora_2, ...) */}
            <div className="space-y-2">
              {activeLoras.length === 0 ? (
                <div className="p-3 bg-zinc-950/60 border border-zinc-800/80 rounded-lg text-xs text-zinc-400">
                  No LoRAs active. Node #30_23 (Enable LoRA) will be set to{' '}
                  <code className="text-zinc-300">false</code>. Choose a character or add a LoRA below.
                </div>
              ) : (
                activeLoras.map((item, idx) => (
                  <div
                    key={`${item.loraName}-${idx}`}
                    className="p-3 bg-zinc-950 border border-zinc-800 rounded-lg space-y-2"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-[11px] font-mono text-indigo-400">
                            lora_{idx + 1}
                          </span>
                          <p className="text-xs font-medium text-zinc-100 truncate">
                            {item.loraName}
                          </p>
                        </div>
                        <p className="text-[11px] text-zinc-400">
                          {item.appearanceLabel || 'LoRA'}
                          {item.triggerWord ? ` · Trigger: ${item.triggerWord}` : ''}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() =>
                          setActiveLoras((prev) => prev.filter((_, i) => i !== idx))
                        }
                        className="p-1 text-zinc-500 hover:text-red-400 rounded cursor-pointer"
                        title="Remove LoRA from this generation"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>

                    <div className="grid grid-cols-2 gap-3 pt-1">
                      <div>
                        <div className="flex justify-between text-[11px] text-zinc-400 mb-1">
                          <span>Strength (Power Lora)</span>
                          <span className="font-mono tabular-nums">
                            {item.modelStrength.toFixed(2)}
                          </span>
                        </div>
                        <input
                          type="range"
                          min="0"
                          max="2"
                          step="0.05"
                          value={item.modelStrength}
                          onChange={(e) => {
                            const val = parseFloat(e.target.value);
                            setActiveLoras((prev) =>
                              prev.map((l, i) =>
                                i === idx ? { ...l, modelStrength: val, clipStrength: val } : l
                              )
                            );
                          }}
                          className="w-full accent-indigo-500"
                        />
                      </div>
                      <div>
                        <div className="flex justify-between text-[11px] text-zinc-400 mb-1">
                          <span>CLIP Strength</span>
                          <span className="font-mono tabular-nums">
                            {item.clipStrength.toFixed(2)}
                          </span>
                        </div>
                        <input
                          type="range"
                          min="0"
                          max="2"
                          step="0.05"
                          value={item.clipStrength}
                          onChange={(e) => {
                            const val = parseFloat(e.target.value);
                            setActiveLoras((prev) =>
                              prev.map((l, i) => (i === idx ? { ...l, clipStrength: val } : l))
                            );
                          }}
                          className="w-full accent-indigo-500"
                        />
                      </div>
                    </div>
                  </div>
                ))
              )}

              {/* Add additional LoRA dropdown */}
              <div className="flex items-center gap-2 pt-1">
                <select
                  value={extraLoraToAdd}
                  onChange={(e) => setExtraLoraToAdd(e.target.value)}
                  className="flex-1 px-2.5 py-1.5 text-xs bg-zinc-950 border border-zinc-800 rounded-lg text-zinc-300"
                >
                  <option value="">+ Add another LoRA to Power Lora Loader (#50)...</option>
                  {loras.map((l) => (
                    <option key={l.filename} value={l.filename}>
                      {l.name} ({l.loraCategory})
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  disabled={!extraLoraToAdd}
                  onClick={() => {
                    if (!extraLoraToAdd) return;
                    // Check if any character has a saved triggerWord for this LoRA
                    let knownTrigger = '';
                    for (const c of characters) {
                      const found = c.loras.find(
                        (cl) => cl.loraName.toLowerCase() === extraLoraToAdd.toLowerCase()
                      );
                      if (found?.triggerWord) {
                        knownTrigger = found.triggerWord;
                        break;
                      }
                    }
                    setActiveLoras((prev) => [
                      ...prev,
                      {
                        loraName: extraLoraToAdd,
                        modelStrength: 1.0,
                        clipStrength: 1.0,
                        appearanceLabel: 'Additional LoRA',
                        triggerWord: knownTrigger,
                      },
                    ]);
                    if (knownTrigger && !triggerWord.includes(knownTrigger)) {
                      setTriggerWord((prev) =>
                        prev.trim() ? `${prev.trim()}, ${knownTrigger}` : knownTrigger
                      );
                    }
                    setExtraLoraToAdd('');
                  }}
                  className="px-3 py-1.5 text-xs font-medium text-zinc-100 bg-zinc-800 hover:bg-zinc-700 disabled:opacity-40 rounded-lg whitespace-nowrap shrink-0 cursor-pointer"
                >
                  Add LoRA
                </button>
              </div>
            </div>
          </section>

          {/* STEP 2: ResolutionSelector (Node #49): Aspect Ratio & Megapixels (0.1 - 10.0) */}
          <section className="p-5 bg-zinc-900/60 border border-zinc-800/90 rounded-xl space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-display font-semibold text-zinc-100">
                02. Resolution Selector (Node #49) & Batch Size
              </h2>
              <span className="text-xs font-mono text-zinc-400 tabular-nums">
                {megapixels.toFixed(1)} MP · {generationCount} shot
                {generationCount === 1 ? '' : 's'}
              </span>
            </div>

            {/* Aspect Ratio Grid */}
            <div className="grid grid-cols-4 sm:grid-cols-8 gap-1.5">
              {ASPECT_RATIO_PRESETS.map((preset) => {
                const isSelected =
                  aspectRatio === preset.value || aspectRatio === preset.shortRatio;
                return (
                  <button
                    key={preset.value}
                    type="button"
                    onClick={() => setAspectRatio(preset.value)}
                    className={`flex flex-col items-center justify-center py-2.5 px-1.5 rounded-lg border transition-colors cursor-pointer ${
                      isSelected
                        ? 'bg-indigo-600/15 border-indigo-500 text-zinc-100'
                        : 'bg-zinc-950 border-zinc-800 text-zinc-400 hover:border-zinc-700 hover:text-zinc-200'
                    }`}
                  >
                    <div className="h-6 flex items-center justify-center mb-1">
                      <div
                        style={{ width: `${preset.boxW}px`, height: `${preset.boxH}px` }}
                        className={`border rounded-[2px] ${
                          isSelected ? 'border-indigo-400 bg-indigo-500/20' : 'border-zinc-600'
                        }`}
                      />
                    </div>
                    <span className="text-xs font-mono font-semibold">{preset.shortRatio}</span>
                    <span className="text-[10px] text-zinc-400 truncate max-w-full">
                      {preset.label}
                    </span>
                  </button>
                );
              })}
            </div>

            {/* Megapixels (0.1 to 10.0) Controls */}
            <div className="p-3.5 bg-zinc-950 border border-zinc-800 rounded-lg space-y-3">
              <div className="flex items-center justify-between gap-4">
                <div className="flex-1">
                  <div className="flex items-center justify-between text-xs mb-1">
                    <span className="font-medium text-zinc-300">
                      Megapixels (Node #49 <code className="text-indigo-300">megapixels</code>: 0.1 – 10.0)
                    </span>
                    <span className="font-mono font-semibold text-indigo-400 tabular-nums">
                      {megapixels.toFixed(1)} MP
                    </span>
                  </div>
                  <input
                    type="range"
                    min="0.1"
                    max="10.0"
                    step="0.1"
                    value={megapixels}
                    onChange={(e) =>
                      setMegapixels(
                        Math.max(0.1, Math.min(10.0, parseFloat(e.target.value) || 3.0))
                      )
                    }
                    className="w-full accent-indigo-500"
                  />
                </div>

                <div className="w-24 shrink-0">
                  <label className="block text-[11px] text-zinc-400 mb-1">Exact MP</label>
                  <input
                    type="number"
                    min={0.1}
                    max={10.0}
                    step={0.1}
                    value={megapixels}
                    onChange={(e) =>
                      setMegapixels(
                        Math.max(0.1, Math.min(10.0, parseFloat(e.target.value) || 3.0))
                      )
                    }
                    className="w-full px-2.5 py-1.5 text-xs font-mono tabular-nums bg-zinc-900 border border-zinc-800 rounded-lg text-zinc-100"
                  />
                </div>
              </div>

              {/* Quick Megapixel Presets */}
              <div className="flex items-center justify-between gap-2 pt-1">
                <span className="text-[11px] text-zinc-400">Quick MP:</span>
                <div className="flex flex-wrap items-center gap-1.5">
                  {MEGAPIXEL_PRESETS.map((mpVal) => (
                    <button
                      key={mpVal}
                      type="button"
                      onClick={() => setMegapixels(mpVal)}
                      className={`px-2 py-1 text-xs font-mono tabular-nums rounded border transition-colors cursor-pointer ${
                        Math.abs(megapixels - mpVal) < 0.01
                          ? 'bg-indigo-600 text-white border-indigo-500'
                          : 'bg-zinc-900 text-zinc-400 border-zinc-800 hover:text-zinc-200'
                      }`}
                    >
                      {mpVal.toFixed(1)} MP
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Aspect Ratio Node String & Generation Count */}
            <div className="grid grid-cols-2 gap-3 pt-1">
              <div>
                <label className="block text-[11px] text-zinc-400 mb-1">
                  Exact <code className="text-indigo-300">aspect_ratio</code> Sent to Node #49
                </label>
                <input
                  type="text"
                  value={aspectRatio}
                  onChange={(e) => setAspectRatio(e.target.value)}
                  placeholder="e.g. 2:3 (Portrait Photo)"
                  className="w-full px-2.5 py-1.5 text-xs font-mono bg-zinc-950 border border-zinc-800 rounded-lg text-zinc-100"
                />
              </div>
              <div>
                <label className="block text-[11px] text-zinc-400 mb-1">
                  Number of Generations (1–20)
                </label>
                <input
                  type="number"
                  min={1}
                  max={20}
                  value={generationCount}
                  onChange={(e) =>
                    setGenerationCount(Math.max(1, Math.min(20, Number(e.target.value) || 1)))
                  }
                  className="w-full px-2.5 py-1.5 text-xs font-mono tabular-nums bg-zinc-950 border border-zinc-800 rounded-lg text-zinc-100"
                />
              </div>
            </div>

            {/* Quick Count Buttons */}
            <div className="flex items-center justify-between gap-2 pt-1">
              <span className="text-xs text-zinc-400">Quick Batch Size:</span>
              <div className="flex items-center gap-1.5">
                {[1, 2, 4, 6, 8, 12].map((num) => (
                  <button
                    key={num}
                    type="button"
                    onClick={() => setGenerationCount(num)}
                    className={`px-2.5 py-1 text-xs font-mono tabular-nums rounded border transition-colors cursor-pointer ${
                      generationCount === num
                        ? 'bg-indigo-600 text-white border-indigo-500'
                        : 'bg-zinc-950 text-zinc-400 border-zinc-800 hover:text-zinc-200'
                    }`}
                  >
                    {num}×
                  </button>
                ))}
              </div>
            </div>
          </section>

          {/* STEP 3: Workflow, Diffusion Model (#30_10 UNETLoader) & Node Mapping */}
          <section className="p-5 bg-zinc-900/60 border border-zinc-800/90 rounded-xl space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-display font-semibold text-zinc-100">
                03. Workflow & Diffusion Model (Node #30_10)
              </h2>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setMapperModalState({ open: true, tab: 'import' })}
                  className="inline-flex items-center gap-1 text-xs text-indigo-400 hover:text-indigo-300 cursor-pointer"
                >
                  <Upload className="w-3.5 h-3.5" />
                  <span>Import JSON</span>
                </button>
                <span className="text-zinc-700">·</span>
                <button
                  type="button"
                  onClick={() => setMapperModalState({ open: true, tab: 'map' })}
                  className="inline-flex items-center gap-1 text-xs text-zinc-300 hover:text-zinc-100 cursor-pointer"
                >
                  <Sliders className="w-3.5 h-3.5" />
                  <span>Map Nodes</span>
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-zinc-400 mb-1">
                  Active ComfyUI Workflow
                </label>
                <select
                  value={selectedWorkflowId ?? ''}
                  onChange={(e) => setSelectedWorkflowId(Number(e.target.value) || null)}
                  className="w-full px-3 py-2 text-xs bg-zinc-950 border border-zinc-800 rounded-lg text-zinc-100"
                >
                  {workflows.map((w) => (
                    <option key={w.id} value={w.id}>
                      {w.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium text-zinc-400 mb-1">
                  Diffusion Model (Node #30_10 <code className="text-indigo-300">unet_name</code>)
                </label>
                <input
                  type="text"
                  list="diffusion-models-datalist"
                  value={selectedCheckpoint}
                  onChange={(e) => setSelectedCheckpoint(e.target.value)}
                  placeholder="Keep workflow default or select model..."
                  className="w-full px-3 py-2 text-xs font-mono bg-zinc-950 border border-zinc-800 rounded-lg text-zinc-100"
                />
                <datalist id="diffusion-models-datalist">
                  {availableDiffusionModels.map((m) => (
                    <option key={m} value={m} />
                  ))}
                </datalist>
              </div>
            </div>

            {workflowMapping && (
              <div className="p-2.5 bg-zinc-950 border border-zinc-800/80 rounded-lg text-[11px] text-zinc-400 font-mono flex flex-wrap items-center gap-x-2 gap-y-1">
                <span>
                  Prompt: {workflowMapping.positivePromptNodeId ? `#${workflowMapping.positivePromptNodeId} (${workflowMapping.positivePromptField})` : 'None'}
                </span>
                <span>·</span>
                <span>
                  Trigger: {workflowMapping.triggerWordNodeId ? `#${workflowMapping.triggerWordNodeId} (${workflowMapping.triggerWordField || 'string_b'})` : 'None'}
                </span>
                <span>·</span>
                <span>
                  LoRA: {workflowMapping.loraNodeIds.length > 0 ? workflowMapping.loraNodeIds.map((id) => `#${id}`).join(', ') : 'Auto'}
                </span>
                <span>·</span>
                <span>
                  Resolution: {workflowMapping.latentNodeId ? `#${workflowMapping.latentNodeId}` : 'None'}
                </span>
                <span>·</span>
                <span>
                  Seed: {workflowMapping.seedNodeId ? `#${workflowMapping.seedNodeId}` : 'None'}
                </span>
                <span>·</span>
                <span>
                  Model: {workflowMapping.checkpointNodeId ? `#${workflowMapping.checkpointNodeId}` : 'Default'}
                </span>
              </div>
            )}
          </section>

          {/* STEP 4: Single Prompt (Verbatim) vs. Photo Set Theme (LM Studio Agent) */}
          <section className="p-5 bg-zinc-900/60 border border-zinc-800/90 rounded-xl space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-display font-semibold text-zinc-100">
                04. Prompt Mode & LM Studio Set Agent
              </h2>
              <div className="flex items-center gap-1 p-1 bg-zinc-950 border border-zinc-800 rounded-lg">
                <button
                  type="button"
                  onClick={() => setGenerationMode('single')}
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
                  onClick={() => setGenerationMode('theme_set')}
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

            {/* Saved Prompt Templates Selector & Database Persistence */}
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <label className="text-xs font-medium text-zinc-400">
                  Base Prompt Template (Supports {'{character}'}, {'{lora}'}, {'{theme}'})
                </label>
              </div>
              <div className="flex items-center gap-2">
                <select
                  value={selectedTemplateId ?? ''}
                  onChange={(e) => {
                    const id = Number(e.target.value);
                    setSelectedTemplateId(id);
                    const found = templates.find((t) => t.id === id);
                    if (found) {
                      setTemplateNameInput(found.name);
                      setPositivePromptTemplate(found.positiveTemplate);
                      setNegativePrompt(found.negativeTemplate);
                    }
                  }}
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
                  onClick={() => handleUpdateDefaultTemplate(false)}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-zinc-200 bg-zinc-800 hover:bg-zinc-700 rounded-lg whitespace-nowrap shrink-0 cursor-pointer"
                  title="Update and set as Default Prompt in database"
                >
                  <Save className="w-3.5 h-3.5" />
                  <span>Save Default</span>
                </button>
                <button
                  type="button"
                  onClick={() => handleUpdateDefaultTemplate(true)}
                  className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-zinc-300 bg-zinc-900 border border-zinc-800 hover:bg-zinc-800 rounded-lg whitespace-nowrap shrink-0 cursor-pointer"
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
                  onChange={(e) => setPositivePromptTemplate(e.target.value)}
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
                  onChange={(e) => setNegativePrompt(e.target.value)}
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
                    onChange={(e) => setThemeText(e.target.value)}
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
                    onChange={(e) => setSelectedGuidingTemplateId(Number(e.target.value))}
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
                          onChange={(e) => setLmUrlInput(e.target.value)}
                          placeholder="http://localhost:1234/v1"
                          className="w-full px-2.5 py-1.5 text-xs font-mono bg-zinc-900 border border-zinc-800 rounded text-zinc-200"
                        />
                        <button
                          type="button"
                          onClick={handleTestLmStudio}
                          disabled={isTestingLm}
                          className="p-1.5 bg-zinc-900 border border-zinc-800 hover:bg-zinc-800 rounded text-zinc-300 cursor-pointer"
                          title="Refresh LM Studio connection & models"
                        >
                          <RefreshCw
                            className={`w-3.5 h-3.5 ${isTestingLm ? 'animate-spin' : ''}`}
                          />
                        </button>
                      </div>
                    </div>

                    <div>
                      <label className="block text-[11px] text-zinc-400 mb-1">LLM Model</label>
                      {lmStatus && lmStatus.availableModels.length > 0 ? (
                        <select
                          value={lmModelInput}
                          onChange={(e) => {
                            setLmModelInput(e.target.value);
                            api.updateLmStudioConfig({ selectedModel: e.target.value });
                          }}
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
                          onChange={(e) => setLmModelInput(e.target.value)}
                          placeholder="local-model (auto)"
                          className="w-full px-2.5 py-1.5 text-xs font-mono bg-zinc-900 border border-zinc-800 rounded text-zinc-200"
                        />
                      )}
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={handleRunLmStudioAgent}
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
              onClick={handleSubmitBatch}
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
        </div>

        {/* RIGHT COLUMN: Prompt Set Inspector & Live ComfyUI Batch Queue (7 cols on desktop) */}
        <div className="lg:col-span-7 space-y-6">
          {/* Active Batch Prompt Sequence Preview & Editor */}
          <section className="p-5 bg-zinc-900/60 border border-zinc-800/90 rounded-xl space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-sm font-display font-semibold text-zinc-100">
                  Outgoing Batch Prompt Queue ({previewPrompts.length} Shot
                  {previewPrompts.length === 1 ? '' : 's'} Ready)
                </h2>
                <p className="text-xs text-zinc-400">
                  {generationMode === 'single'
                    ? 'Verbatim Mode: All shots use your exact prompt below with unique 64-bit seeds dispatched simultaneously.'
                    : agentPrompts.length > 0
                    ? 'LM Studio Set Prompts: Review or edit any individual shot prompt below before clicking Send All to ComfyUI.'
                    : 'Theme Set Mode: Click "Generate Photo Set Prompts with LM Studio" on the left to populate distinct shots, or edit directly below.'}
                </p>
              </div>
              <span className="text-xs font-mono text-zinc-400 tabular-nums">
                {aspectRatio} · {megapixels.toFixed(1)} MP
              </span>
            </div>

            <div className="space-y-2.5 max-h-[380px] overflow-y-auto pr-1">
              {previewPrompts.map((promptStr, idx) => (
                <div
                  key={idx}
                  className="p-3 bg-zinc-950 border border-zinc-800 rounded-lg space-y-1.5"
                >
                  <div className="flex items-center justify-between text-[11px] text-zinc-400">
                    <span className="font-mono font-medium text-zinc-300">
                      Shot #{idx + 1} of {previewPrompts.length}
                    </span>
                    <span className="font-mono">
                      {selectedCharacter ? selectedCharacter.name : 'Custom Subject'} ·{' '}
                      {activeLoras.length} LoRA{activeLoras.length === 1 ? '' : 's'}
                      {triggerWord.trim() ? ` · Trigger: "${triggerWord.trim()}"` : ''}
                    </span>
                  </div>
                  <textarea
                    rows={2}
                    value={promptStr}
                    onChange={(e) => {
                      const val = e.target.value;
                      if (generationMode === 'theme_set') {
                        setAgentPrompts((prev) => {
                          const next = [...prevPromptsOrDefault(prev, previewPrompts)];
                          next[idx] = val;
                          return next;
                        });
                      } else {
                        setPositivePromptTemplate(val);
                      }
                    }}
                    className="w-full px-2.5 py-1.5 text-xs bg-zinc-900/70 border border-zinc-800/90 rounded text-zinc-200 focus:outline-none focus:border-indigo-500"
                  />
                </div>
              ))}
            </div>
          </section>

          {/* Dispatched ComfyUI Generation Batches History & Live Status */}
          <section className="p-5 bg-zinc-900/60 border border-zinc-800/90 rounded-xl space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Layers className="w-4 h-4 text-indigo-400" />
                <h2 className="text-sm font-display font-semibold text-zinc-100">
                  Dispatched ComfyUI Generation Batches
                </h2>
              </div>
              <button
                type="button"
                onClick={() =>
                  api.listGenerationBatches().then((res) => setBatches(res.items || []))
                }
                className="inline-flex items-center gap-1.5 text-xs text-zinc-400 hover:text-zinc-200 cursor-pointer"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                <span>Refresh Queue</span>
              </button>
            </div>

            {batches.length === 0 ? (
              <div className="py-12 text-center border border-dashed border-zinc-800 rounded-xl space-y-2">
                <p className="text-sm font-medium text-zinc-300">No generation batches sent yet</p>
                <p className="text-xs text-zinc-500 max-w-md mx-auto">
                  Choose a character, pick an aspect ratio and megapixel target (0.1–10.0 MP), and click Send All to dispatch a batch to ComfyUI.
                </p>
              </div>
            ) : (
              <div className="space-y-4">
                {batches.map((batch) => {
                  const completedCount = batch.items.filter(
                    (i) => i.status === 'completed'
                  ).length;
                  const submittedCount = batch.items.filter(
                    (i) => i.status === 'submitted' || i.status === 'pending'
                  ).length;
                  const failedCount = batch.items.filter((i) => i.status === 'failed').length;

                  return (
                    <div
                      key={batch.id}
                      className="p-4 bg-zinc-950 border border-zinc-800 rounded-xl space-y-3"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2 pb-2 border-b border-zinc-800/80">
                        <div className="flex flex-wrap items-center gap-2 text-xs">
                          <span className="font-semibold text-zinc-100">Batch #{batch.id}</span>
                          <span className="text-zinc-600">·</span>
                          <span className="text-zinc-300">
                            {batch.characterName || 'Unassigned Subject'}
                          </span>
                          <span className="text-zinc-600">·</span>
                          <span className="font-mono text-zinc-400 tabular-nums">
                            {batch.aspectRatio} · {Number(batch.megapixels || 3.0).toFixed(1)} MP
                          </span>
                          {batch.themeTitle && (
                            <>
                              <span className="text-zinc-600">·</span>
                              <span className="text-indigo-300 truncate max-w-xs">
                                Theme: {batch.themeTitle}
                              </span>
                            </>
                          )}
                        </div>

                        <div className="flex items-center gap-2 text-xs font-mono tabular-nums">
                          {completedCount > 0 && (
                            <span className="text-emerald-400">{completedCount} completed</span>
                          )}
                          {submittedCount > 0 && (
                            <span className="text-amber-400">{submittedCount} queued</span>
                          )}
                          {failedCount > 0 && (
                            <span className="text-red-400">{failedCount} failed</span>
                          )}
                        </div>
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                        {batch.items.map((item) => {
                          const linkedImage = item.outputImageId
                            ? allImages.find((img) => img.id === item.outputImageId)
                            : null;

                          return (
                            <div
                              key={item.id}
                              className="p-2.5 bg-zinc-900/60 border border-zinc-800/90 rounded-lg flex gap-3 items-start"
                            >
                              {item.outputThumbnailUrl ? (
                                <button
                                  type="button"
                                  onClick={() => {
                                    if (linkedImage) onOpenImage(linkedImage);
                                  }}
                                  className="w-16 h-16 rounded overflow-hidden bg-zinc-950 border border-zinc-800 shrink-0 cursor-pointer"
                                >
                                  <img
                                    src={item.outputThumbnailUrl}
                                    alt={`Shot ${item.itemIndex}`}
                                    referrerPolicy="no-referrer"
                                    className="w-full h-full object-cover"
                                  />
                                </button>
                              ) : (
                                <div className="w-16 h-16 rounded bg-zinc-950 border border-zinc-800 flex flex-col items-center justify-center text-[10px] font-mono text-zinc-500 shrink-0">
                                  <span>#{item.itemIndex}</span>
                                  <span>{item.status}</span>
                                </div>
                              )}

                              <div className="min-w-0 flex-1 space-y-1">
                                <div className="flex items-center justify-between text-[11px]">
                                  <span className="font-mono text-zinc-300 tabular-nums">
                                    Shot #{item.itemIndex} · Seed {item.seed}
                                  </span>
                                  <span
                                    className={`font-medium ${
                                      item.status === 'completed'
                                        ? 'text-emerald-400'
                                        : item.status === 'failed'
                                        ? 'text-red-400'
                                        : 'text-amber-400'
                                    }`}
                                  >
                                    {item.status === 'completed'
                                      ? 'Completed'
                                      : item.status === 'failed'
                                      ? 'Failed'
                                      : 'Sent to ComfyUI'}
                                  </span>
                                </div>
                                <p className="text-xs text-zinc-300 line-clamp-2">{item.prompt}</p>
                                {item.errorMessage && (
                                  <p className="text-[11px] text-red-400 truncate">
                                    {item.errorMessage}
                                  </p>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        </div>
      </div>

      {/* Workflow Node Mapper & API JSON Importer Modal */}
      {mapperModalState.open && (
        <NodeMapperModal
          workflowId={selectedWorkflowId}
          workflows={workflows}
          initialTab={mapperModalState.tab}
          onClose={() => setMapperModalState({ ...mapperModalState, open: false })}
          onSavedMapping={(wfId, newMapping) => {
            if (wfId === selectedWorkflowId) {
              setWorkflowMapping(newMapping);
            }
          }}
          onWorkflowCreated={async (newWfId) => {
            await onRefreshAll();
            setSelectedWorkflowId(newWfId);
          }}
        />
      )}
    </div>
  );
};

function prevPromptsOrDefault(current: string[], fallback: string[]): string[] {
  return current.length === fallback.length ? current : [...fallback];
}
