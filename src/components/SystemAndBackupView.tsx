import React, { useEffect, useState } from 'react';
import { BookOpen, Bot, Database, RefreshCw, Server, Tags } from 'lucide-react';
import { api } from '../api/client.ts';
import type {
  LmStudioStatus,
  VisualTaggerStatus,
} from '../shared/types.ts';
import { WorkspacePreferencesSection } from './system/WorkspacePreferencesSection.tsx';
import { VisualTaggerSection } from './system/VisualTaggerSection.tsx';
import { LmStudioTemplatesSection } from './system/LmStudioTemplatesSection.tsx';
import { ComfyUiConnectionSection } from './system/ComfyUiConnectionSection.tsx';
import { ModelCleanupSection } from './system/ModelCleanupSection.tsx';
import { DatabaseBackupSection } from './system/DatabaseBackupSection.tsx';
import { CollectionsAndScannerSection } from './system/CollectionsAndScannerSection.tsx';
import { SystemHelpSection } from './system/SystemHelpSection.tsx';

export type SystemSubTab = 'tagger' | 'lm_studio' | 'comfyui' | 'backup' | 'scanner' | 'help';

const SYSTEM_SUB_TABS: {
  id: SystemSubTab;
  label: string;
  icon: React.FC<{ className?: string }>;
}[] = [
  { id: 'tagger', label: 'Search', icon: Tags },
  { id: 'lm_studio', label: 'Agent', icon: Bot },
  { id: 'comfyui', label: 'ComfyUI', icon: Server },
  { id: 'backup', label: 'Database', icon: Database },
  { id: 'scanner', label: 'Metadata', icon: RefreshCw },
  { id: 'help', label: 'Help', icon: BookOpen },
];

interface SystemAndBackupViewProps {
  healthData: any;
  onRefreshAll: () => Promise<void>;
  initialSubTab?: SystemSubTab;
}

/**
 * System Workspace: organizes Workspace Preferences, Visual Tagger, LM Studio Templates,
 * ComfyUI Connection, Database Backups, and Filesystem Scanner into focused sub-tabs.
 */
export const SystemAndBackupView: React.FC<SystemAndBackupViewProps> = ({
  healthData,
  onRefreshAll,
  initialSubTab = 'tagger',
}) => {
  const [activeSubTab, setActiveSubTab] = useState<SystemSubTab>(initialSubTab);

  useEffect(() => {
    setActiveSubTab(initialSubTab);
  }, [initialSubTab]);
  const [comfyuiUrl, setComfyuiUrl] = useState(
    healthData?.config?.comfyuiUrl || 'http://comfyui:8188'
  );
  const [outputDir, setOutputDir] = useState(
    healthData?.config?.comfyuiOutputDir || '/data/output'
  );
  const [modelsDir, setModelsDir] = useState(
    healthData?.config?.comfyuiModelsDir || '/data/models'
  );
  const [downloadsDir, setDownloadsDir] = useState(
    healthData?.config?.downloadsDir || '/downloads'
  );
  const [scheduledHours, setScheduledHours] = useState<number>(
    healthData?.config?.scheduledBackupHours || 0
  );
  const [quickGenBoxEnabled, setQuickGenBoxEnabled] = useState<boolean>(
    healthData?.config?.quickGenBoxEnabled !== false
  );
  const [saveUploadedPromptImages, setSaveUploadedPromptImages] = useState<boolean>(
    healthData?.config?.saveUploadedPromptImages === true
  );

  // Visual Keyword Tagger (WD14 ONNX) State
  const [taggerStatus, setTaggerStatus] = useState<VisualTaggerStatus | null>(
    healthData?.visualTagger || null
  );
  const [isUpdatingTagger, setIsUpdatingTagger] = useState(false);

  useEffect(() => {
    if (healthData?.config?.quickGenBoxEnabled !== undefined) {
      setQuickGenBoxEnabled(healthData.config.quickGenBoxEnabled !== false);
    }
    if (healthData?.config?.saveUploadedPromptImages !== undefined) {
      setSaveUploadedPromptImages(healthData.config.saveUploadedPromptImages === true);
    }
    if (healthData?.visualTagger) {
      setTaggerStatus(healthData.visualTagger);
    }
  }, [
    healthData?.config?.quickGenBoxEnabled,
    healthData?.config?.saveUploadedPromptImages,
    healthData?.visualTagger,
  ]);

  const [connTestResult, setConnTestResult] = useState<any | null>(null);
  const [isTestingConn, setIsTestingConn] = useState(false);

  const [scanHistory, setScanHistory] = useState<any[]>([]);
  const [backups, setBackups] = useState<any[]>([]);
  const [integrityOk, setIntegrityOk] = useState(true);
  const [backupMsg, setBackupMsg] = useState<string | null>(null);

  // Local LLM & Unified Agent State
  const [lmStatus, setLmStatus] = useState<LmStudioStatus | null>(null);
  const [lmBaseUrl, setLmBaseUrl] = useState('http://localhost:1234/v1');
  const [lmSelectedModel, setLmSelectedModel] = useState('');
  const [conversationSystemPrompt, setConversationSystemPrompt] = useState('');
  const [batchExpansionPrompt, setBatchExpansionPrompt] = useState('');
  const [isTestingLm, setIsTestingLm] = useState(false);
  const [guidingFeedback, setGuidingFeedback] = useState<string | null>(null);

  const loadSystemDetails = async () => {
    try {
      const [scansRes, backupsRes, lmRes, taggerRes] = await Promise.all([
        api.getScans(),
        api.getBackups(),
        api.getLmStudioStatus(),
        api.getVisualTaggerStatus(),
      ]);
      setScanHistory(scansRes.history || []);
      setBackups(backupsRes.backups || []);
      setIntegrityOk(backupsRes.integrityOk);
      setTaggerStatus(taggerRes);

      setLmStatus(lmRes);
      setLmBaseUrl(lmRes.baseUrl || 'http://localhost:1234/v1');
      setLmSelectedModel(lmRes.selectedModel || lmRes.availableModels[0] || '');
      setConversationSystemPrompt(lmRes.conversationSystemPrompt || '');
      setBatchExpansionPrompt(lmRes.batchExpansionPrompt || '');
    } catch (err: any) {
      console.error('Failed to load system details:', err);
    }
  };

  useEffect(() => {
    loadSystemDetails();
  }, []);

  const handleTestLmStudio = async () => {
    setIsTestingLm(true);
    try {
      const updated = await api.updateLmStudioConfig({
        baseUrl: lmBaseUrl.trim(),
        selectedModel: lmSelectedModel.trim(),
      });
      setLmBaseUrl(updated.baseUrl);
      setLmSelectedModel(updated.selectedModel);

      const status = await api.getLmStudioStatus(updated.baseUrl);
      setLmStatus(status);
      setGuidingFeedback(
        status.online
          ? `Local LLM is online. Found ${status.availableModels.length} loaded model(s).`
          : `Local LLM offline: ${status.error || 'Connection refused at ' + updated.baseUrl}`
      );
      setTimeout(() => setGuidingFeedback(null), 4000);
    } catch (err: any) {
      setGuidingFeedback(`Local LLM test failed: ${err.message}`);
    } finally {
      setIsTestingLm(false);
    }
  };

  const handleSaveConversationPrompt = async () => {
    try {
      const updated = await api.updateLmStudioConfig({
        conversationSystemPrompt: conversationSystemPrompt.trim(),
      });
      setLmStatus(updated);
      setConversationSystemPrompt(updated.conversationSystemPrompt);
      setGuidingFeedback('Agent System Prompt saved.');
      setTimeout(() => setGuidingFeedback(null), 3000);
    } catch (err: any) {
      setGuidingFeedback(`Error saving Agent prompt: ${err.message}`);
    }
  };

  const handleResetConversationPrompt = async () => {
    try {
      const updated = await api.updateLmStudioConfig({
        conversationSystemPrompt: '',
      });
      setLmStatus(updated);
      setConversationSystemPrompt(updated.conversationSystemPrompt);
      setGuidingFeedback('Agent System Prompt reset to default.');
      setTimeout(() => setGuidingFeedback(null), 3000);
    } catch (err: any) {
      setGuidingFeedback(`Error resetting Agent prompt: ${err.message}`);
    }
  };

  const handleSaveBatchExpansionPrompt = async () => {
    try {
      const updated = await api.updateLmStudioConfig({
        batchExpansionPrompt: batchExpansionPrompt.trim(),
      });
      setLmStatus(updated);
      setBatchExpansionPrompt(updated.batchExpansionPrompt);
      setGuidingFeedback('Batch Expansion Instructions saved.');
      setTimeout(() => setGuidingFeedback(null), 3000);
    } catch (err: any) {
      setGuidingFeedback(`Error saving batch expansion instructions: ${err.message}`);
    }
  };

  const handleResetBatchExpansionPrompt = async () => {
    try {
      const updated = await api.updateLmStudioConfig({
        batchExpansionPrompt: '',
      });
      setLmStatus(updated);
      setBatchExpansionPrompt(updated.batchExpansionPrompt);
      setGuidingFeedback('Batch Expansion Instructions reset to default.');
      setTimeout(() => setGuidingFeedback(null), 3000);
    } catch (err: any) {
      setGuidingFeedback(`Error resetting batch expansion instructions: ${err.message}`);
    }
  };

  const handleSaveConfig = async (e: React.FormEvent) => {
    e.preventDefault();
    await api.updateConfig({
      comfyuiUrl,
      comfyuiOutputDir: outputDir,
      comfyuiModelsDir: modelsDir,
      downloadsDir,
      scheduledBackupHours: scheduledHours,
      quickGenBoxEnabled,
      saveUploadedPromptImages,
    });
    setBackupMsg('Configuration updated successfully.');
    setTimeout(() => setBackupMsg(null), 3000);
    await onRefreshAll();
  };

  const handleToggleQuickGenBox = async (enabled: boolean) => {
    setQuickGenBoxEnabled(enabled);
    try {
      await api.updateConfig({
        quickGenBoxEnabled: enabled,
      });
      setBackupMsg(
        enabled
          ? 'Floating Quick Generation Box enabled.'
          : 'Floating Quick Generation Box disabled.'
      );
      setTimeout(() => setBackupMsg(null), 2500);
      await onRefreshAll();
    } catch (err: any) {
      setBackupMsg(`Failed to update Quick Gen Box setting: ${err.message}`);
    }
  };

  const handleToggleSaveUploadedPromptImages = async (enabled: boolean) => {
    setSaveUploadedPromptImages(enabled);
    try {
      await api.updateConfig({
        saveUploadedPromptImages: enabled,
      });
      setBackupMsg(
        enabled
          ? `Uploaded prompt images will be saved to ${healthData?.config?.uploadedImagesDir || 'data/uploaded'}.`
          : 'Uploaded prompt images will not be saved to disk.'
      );
      setTimeout(() => setBackupMsg(null), 3000);
      await onRefreshAll();
    } catch (err: any) {
      setBackupMsg(`Failed to update uploaded prompt images setting: ${err.message}`);
    }
  };

  const handleTestComfyUi = async () => {
    setIsTestingConn(true);
    setConnTestResult(null);
    try {
      const res = await api.testComfyUi(comfyuiUrl);
      setConnTestResult(res);
    } catch (err: any) {
      setConnTestResult({ online: false, error: err.message });
    } finally {
      setIsTestingConn(false);
    }
  };

  const handleToggleVisualTagger = async (nextEnabled: boolean) => {
    setIsUpdatingTagger(true);
    try {
      const nextStatus = await api.updateVisualTaggerConfig({ enabled: nextEnabled });
      setTaggerStatus(nextStatus);
      setBackupMsg(
        nextEnabled
          ? 'Visual Keyword Tagging enabled. Model download (if needed) and background indexing have started.'
          : 'Visual Keyword Tagging disabled and background scan paused.'
      );
      setTimeout(() => setBackupMsg(null), 4000);
    } catch (err: any) {
      setBackupMsg(`Tagger error: ${err.message}`);
    } finally {
      setIsUpdatingTagger(false);
    }
  };

  const handleTaggerConfigChange = async (payload: {
    threshold?: number;
    device?: 'cpu' | 'gpu';
  }) => {
    setIsUpdatingTagger(true);
    try {
      const nextStatus = await api.updateVisualTaggerConfig(payload);
      setTaggerStatus(nextStatus);
    } catch (err: any) {
      setBackupMsg(`Tagger config error: ${err.message}`);
    } finally {
      setIsUpdatingTagger(false);
    }
  };

  const handleTaggerControl = async (
    action: 'pause' | 'resume' | 'scan_unindexed' | 'rescan_all'
  ) => {
    setIsUpdatingTagger(true);
    try {
      const nextStatus = await api.controlVisualTaggerQueue(action);
      setTaggerStatus(nextStatus);
    } catch (err: any) {
      setBackupMsg(`Tagger queue error: ${err.message}`);
    } finally {
      setIsUpdatingTagger(false);
    }
  };

  const handleCreateBackup = async () => {
    const res = await api.createBackup('manual');
    await loadSystemDetails();
    setBackupMsg(`Created SQLite backup: ${res.backup.filename}`);
    setTimeout(() => setBackupMsg(null), 3500);
  };

  const handleRestoreAnnotationsFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      const res = await api.restoreAnnotationsJson(parsed);
      await onRefreshAll();
      setBackupMsg(
        `Restored annotations: ${res.restoredCounts.ratings} ratings, ${res.restoredCounts.characters} characters, ${res.restoredCounts.collections} collections.`
      );
    } catch (err: any) {
      setBackupMsg(`Restore error: ${err.message}`);
    }
  };

  return (
    <div className="px-6 py-6 max-w-7xl mx-auto space-y-5 text-xs">
      {backupMsg && (
        <div className="p-3.5 bg-indigo-500/15 border border-indigo-500/40 rounded-xl text-indigo-200">
          {backupMsg}
        </div>
      )}

      {/* Compact Global Workspace UI Toggles */}
      <WorkspacePreferencesSection
        quickGenBoxEnabled={quickGenBoxEnabled}
        saveUploadedPromptImages={saveUploadedPromptImages}
        uploadedImagesDir={healthData?.config?.uploadedImagesDir}
        onToggleQuickGenBox={handleToggleQuickGenBox}
        onToggleSaveUploadedPromptImages={handleToggleSaveUploadedPromptImages}
      />

      {/* System Sub-Tab Navigation */}
      <div
        role="tablist"
        aria-label="System settings sections"
        className="bg-zinc-900/90 border border-zinc-800 rounded-xl p-1.5 flex flex-wrap gap-1.5"
      >
        {SYSTEM_SUB_TABS.map((tab) => {
          const Icon = tab.icon;
          const isActive = activeSubTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={isActive}
              onClick={() => setActiveSubTab(tab.id)}
              className={`flex items-center gap-2 px-3.5 py-2 rounded-lg text-xs font-medium transition-colors cursor-pointer ${
                isActive
                  ? 'bg-indigo-600/20 text-indigo-300 border border-indigo-500/40'
                  : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/70 border border-transparent'
              }`}
            >
              <Icon className="w-3.5 h-3.5 shrink-0" />
              <span>{tab.label}</span>
            </button>
          );
        })}
      </div>

      {/* Active Sub-Tab Panel */}
      {activeSubTab === 'tagger' && (
        <VisualTaggerSection
          taggerStatus={taggerStatus}
          isUpdatingTagger={isUpdatingTagger}
          onToggleVisualTagger={handleToggleVisualTagger}
          onTaggerConfigChange={handleTaggerConfigChange}
          onTaggerControl={handleTaggerControl}
        />
      )}

      {activeSubTab === 'lm_studio' && (
        <LmStudioTemplatesSection
          lmStatus={lmStatus}
          lmBaseUrl={lmBaseUrl}
          setLmBaseUrl={setLmBaseUrl}
          lmSelectedModel={lmSelectedModel}
          setLmSelectedModel={setLmSelectedModel}
          isTestingLm={isTestingLm}
          onTestLmStudio={handleTestLmStudio}
          conversationSystemPrompt={conversationSystemPrompt}
          setConversationSystemPrompt={setConversationSystemPrompt}
          onSaveConversationPrompt={handleSaveConversationPrompt}
          onResetConversationPrompt={handleResetConversationPrompt}
          batchExpansionPrompt={batchExpansionPrompt}
          setBatchExpansionPrompt={setBatchExpansionPrompt}
          onSaveBatchExpansionPrompt={handleSaveBatchExpansionPrompt}
          onResetBatchExpansionPrompt={handleResetBatchExpansionPrompt}
          guidingFeedback={guidingFeedback}
        />
      )}

      {activeSubTab === 'comfyui' && (
        <div className="space-y-5">
          <ComfyUiConnectionSection
            comfyuiUrl={comfyuiUrl}
            setComfyuiUrl={setComfyuiUrl}
            outputDir={outputDir}
            setOutputDir={setOutputDir}
            modelsDir={modelsDir}
            setModelsDir={setModelsDir}
            downloadsDir={downloadsDir}
            setDownloadsDir={setDownloadsDir}
            scheduledHours={scheduledHours}
            setScheduledHours={setScheduledHours}
            connTestResult={connTestResult}
            isTestingConn={isTestingConn}
            onTestComfyUi={handleTestComfyUi}
            onSaveConfig={handleSaveConfig}
          />
          <ModelCleanupSection
            initialStatus={healthData?.modelCleanup || null}
            onRefreshAll={onRefreshAll}
            onFeedback={(msg) => {
              setBackupMsg(msg);
              setTimeout(() => setBackupMsg(null), 4000);
            }}
          />
        </div>
      )}

      {activeSubTab === 'backup' && (
        <DatabaseBackupSection
          integrityOk={integrityOk}
          backups={backups}
          onCreateBackup={handleCreateBackup}
          onRestoreAnnotationsFile={handleRestoreAnnotationsFile}
        />
      )}

      {activeSubTab === 'scanner' && (
        <CollectionsAndScannerSection
          scanHistory={scanHistory}
          onRefreshAll={onRefreshAll}
          onReloadSystemDetails={loadSystemDetails}
        />
      )}

      {activeSubTab === 'help' && <SystemHelpSection lmStatus={lmStatus} />}
    </div>
  );
};
