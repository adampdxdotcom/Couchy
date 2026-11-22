/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, X } from 'lucide-react';
import { api } from './api/client.ts';
import type { GenerationReadinessResponse } from './shared/apiTypes.ts';
import { TopNavHeader, type WorkspaceTab } from './components/TopNavHeader.tsx';
import { GalleryFilterBar, type GalleryViewLayout } from './components/GalleryFilterBar.tsx';
import { GalleryGridView } from './components/GalleryGridView.tsx';
import { ImageInspectorDrawer } from './components/ImageInspectorDrawer.tsx';
import { CharacterExplorerView } from './components/CharacterExplorerView.tsx';
import { GenerationStudioView } from './components/GenerationStudioView.tsx';
import { LoraAndModelManagerView } from './components/LoraAndModelManagerView.tsx';
import { WorkflowLibraryView } from './components/WorkflowLibraryView.tsx';
import { SystemAndBackupView, type SystemSubTab } from './components/SystemAndBackupView.tsx';
import { FloatingQuickGenBar, type QuickGenPrefill } from './components/FloatingQuickGenBar.tsx';
import { useAppToasts } from './hooks/useAppToasts.ts';
import { INITIAL_FILTERS, useWorkspaceData } from './hooks/useWorkspaceData.ts';
import { useLiveStatusPolling } from './hooks/useLiveStatusPolling.ts';
import { useGalleryImageActions } from './hooks/useGalleryImageActions.ts';

export default function App() {
  const [activeTab, setActiveTab] = useState<WorkspaceTab>('gallery');
  const [systemSubTab, setSystemSubTab] = useState<SystemSubTab>('tagger');
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [layout, setLayout] = useState<GalleryViewLayout>('standard');
  const [thumbScale, setThumbScale] = useState<'sm' | 'md' | 'lg'>('md');
  const [inspectedImageId, setInspectedImageId] = useState<number | null>(null);
  const [selectedCharacterId, setSelectedCharacterId] = useState<number | null>(null);
  const [quickGenPrefill, setQuickGenPrefill] = useState<QuickGenPrefill | null>(null);
  const [readiness, setReadiness] = useState<GenerationReadinessResponse | null>(null);
  const [readinessDismissed, setReadinessDismissed] = useState<boolean>(() => {
    try {
      return localStorage.getItem('couchy_readiness_banner_dismissed') === '1';
    } catch {
      return false;
    }
  });

  useEffect(() => {
    let active = true;
    api
      .getGenerationReadiness()
      .then((res) => {
        if (active) setReadiness(res);
      })
      .catch(() => {
        // ignore startup check failure
      });
    return () => {
      active = false;
    };
  }, []);

  const handleClearQuickGenPrefill = useCallback(() => {
    setQuickGenPrefill(null);
  }, []);

  const toasts = useAppToasts();
  const workspace = useWorkspaceData();

  const livePolling = useLiveStatusPolling({
    allImages: workspace.allImages,
    characters: workspace.characters,
    pushToast: toasts.pushToast,
    onRefreshWorkspace: workspace.refreshWorkspaceData,
    setQuickGenPrefill,
  });

  // Combined refresh updates live ComfyUI queue status alongside workspace entities
  const refreshAll = useCallback(async () => {
    livePolling.refreshComfyStatus();
    await workspace.refreshWorkspaceData();
  }, [livePolling.refreshComfyStatus, workspace.refreshWorkspaceData]);

  const imageActions = useGalleryImageActions({
    activeTab,
    setActiveTab,
    inspectedImageId,
    setInspectedImageId,
    images: workspace.images,
    setImages: workspace.setImages,
    allImages: workspace.allImages,
    setAllImages: workspace.setAllImages,
    characters: workspace.characters,
    models: workspace.models,
    filters: workspace.filters,
    lmStudioOnline: livePolling.lmStudioStatus.online,
    pushToast: toasts.pushToast,
    onRefreshAll: refreshAll,
    setQuickGenPrefill,
  });

  const inspectedImage =
    workspace.images.find((i) => i.id === inspectedImageId) ||
    workspace.allImages.find((i) => i.id === inspectedImageId) ||
    null;

  const inspectedIdx = workspace.images.findIndex((i) => i.id === inspectedImageId);
  const showQuickGenBar =
    workspace.healthData?.config?.quickGenBoxEnabled !== false && activeTab !== 'generation';

  return (
    <div className="min-h-screen w-full max-w-full overflow-x-clip bg-zinc-950 text-zinc-100 flex flex-col">
      {/* Unified Sticky Chrome: Top Navigation across all tabs + Gallery Search/Filters flush below on Gallery */}
      <div className="sticky top-0 z-40 w-full bg-zinc-950/95 backdrop-blur-md">
        <TopNavHeader
          activeTab={activeTab}
          onSelectTab={(tab) => {
            if (tab === 'characters') {
              setSelectedCharacterId(null);
            }
            setActiveTab(tab);
            setIsMobileMenuOpen(false);
          }}
          comfyStatus={livePolling.comfyStatus}
          activeToast={toasts.activeToast}
          messages={toasts.messages}
          onClearMessages={toasts.clearMessages}
          isMobileMenuOpen={isMobileMenuOpen}
          onMobileMenuOpenChange={setIsMobileMenuOpen}
          lmStudioStatus={livePolling.lmStudioStatus}
        />

        {activeTab === 'gallery' && (
          <GalleryFilterBar
            filters={workspace.filters}
            onChange={(nextFilters) => {
              workspace.setGalleryPage(1);
              workspace.setFilters(nextFilters);
            }}
            onReset={() => {
              workspace.setGalleryPage(1);
              workspace.setFilters(INITIAL_FILTERS);
            }}
            layout={layout}
            onLayoutChange={setLayout}
            thumbScale={thumbScale}
            onThumbScaleChange={setThumbScale}
            totalMatching={workspace.images.length}
            page={workspace.currentGalleryPage}
            totalPages={workspace.totalGalleryPages}
            onPageChange={workspace.handleGalleryPageChange}
            infiniteScroll={workspace.infiniteScroll}
            onInfiniteScrollChange={workspace.handleInfiniteScrollChange}
            characters={workspace.characters}
            loras={workspace.visibleLoras}
            checkpoints={workspace.checkpoints}
            collections={workspace.collections}
            tags={workspace.tags}
            savedSearches={workspace.savedSearches}
            onSaveSearch={async (name) => {
              await api.saveSearchPreset(name, workspace.filters.query, workspace.filters);
              await workspace.loadMetadataAndEntities();
              toasts.pushToast(`Saved search preset "${name}"`, 'success');
            }}
            onDeleteSavedSearch={async (id) => {
              await api.deleteSearchPreset(id);
              await workspace.loadMetadataAndEntities();
              toasts.pushToast('Deleted saved search preset', 'info');
            }}
            onExportFilteredZip={() => {
              toasts.pushToast('Preparing filtered ZIP archive...', 'info');
              api.exportImagesZip({
                filters: workspace.filters,
                archiveName: 'couchy-filtered-export',
              });
            }}
            isHiddenOnMobile={isMobileMenuOpen}
          />
        )}
      </div>

      {/* Main Content Area */}
      <main className={`flex-1 w-full max-w-full min-w-0 overflow-x-clip ${showQuickGenBar ? 'pb-36 md:pb-28' : ''}`}>
        {readiness?.needsAttention && !readinessDismissed && activeTab !== 'system' && (
          <div className="max-w-7xl mx-auto px-4 pt-3">
            <div className="flex flex-wrap items-center justify-between gap-3 px-3.5 py-2.5 rounded-xl bg-amber-500/10 border border-amber-500/35 text-xs text-amber-200">
              <div className="flex items-center gap-2 min-w-0">
                <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
                <span className="truncate">
                  {!readiness.defaultUnetName
                    ? 'First-run Krea 2 setup: pick your default base model (Node #30_10) to enable generation.'
                    : 'Krea 2 setup needs attention: one or more required ComfyUI nodes or default weights are missing.'}
                </span>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={() => {
                    setSystemSubTab('comfyui');
                    setActiveTab('system');
                  }}
                  className="px-2.5 py-1 rounded-lg bg-amber-500/20 hover:bg-amber-500/30 border border-amber-400/40 text-amber-100 font-medium cursor-pointer"
                >
                  Open Setup
                </button>
                <button
                  type="button"
                  aria-label="Dismiss setup notice"
                  onClick={() => {
                    setReadinessDismissed(true);
                    try {
                      localStorage.setItem('couchy_readiness_banner_dismissed', '1');
                    } catch {
                      // ignore storage error
                    }
                  }}
                  className="p-1 rounded-lg text-amber-300/80 hover:text-amber-100 hover:bg-amber-500/15 cursor-pointer"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          </div>
        )}
        {activeTab === 'gallery' && (
          <GalleryGridView
            images={workspace.images}
            loras={workspace.visibleLoras}
            models={workspace.models}
            galleryPillColorsEnabled={workspace.healthData?.config?.galleryPillColorsEnabled === true}
            pillTypeSettings={workspace.pillTypeSettings}
            ghostItems={livePolling.activeGhostItems}
            filters={workspace.filters}
            page={workspace.currentGalleryPage}
            pageSize={workspace.galleryPageSize}
            infiniteScroll={workspace.infiniteScroll}
            isLoading={workspace.isLoadingImages}
            layout={layout}
            thumbScale={thumbScale}
            selectedIds={imageActions.selectedIds}
            onToggleSelect={imageActions.handleToggleSelect}
            onSelectAll={() =>
              imageActions.setSelectedIds(new Set(workspace.images.map((i) => i.id)))
            }
            onClearSelection={imageActions.handleClearSelection}
            onOpenInspector={(img) => setInspectedImageId(img.id)}
            onOpenCharacterGallery={(charId) => {
              setSelectedCharacterId(charId);
              setActiveTab('characters');
              window.scrollTo({ top: 0, behavior: 'smooth' });
            }}
            onReusePrompt={imageActions.handleReusePrompt}
            onOpenConversation={imageActions.handleOpenConversationForImage}
            onQuickRate={imageActions.handleQuickRate}
            onQuickFavorite={imageActions.handleQuickFavorite}
            onQuickReject={imageActions.handleQuickReject}
            onBulkAction={async (payload) => {
              const count = imageActions.selectedIds.size;
              await api.bulkUpdateImages({
                imageIds: Array.from(imageActions.selectedIds),
                ...payload,
              });
              await refreshAll();
              toasts.pushToast(`Updated ${count} selected image(s)`, 'success');
            }}
            onExportSelectedZip={() => {
              toasts.pushToast(
                `Exporting ${imageActions.selectedIds.size} selected image(s) as ZIP...`,
                'info'
              );
              api.exportImagesZip({
                imageIds: Array.from(imageActions.selectedIds),
                archiveName: 'couchy-selected-export',
              });
            }}
            characters={workspace.characters}
            collections={workspace.collections}
            mountedOutputDir={workspace.healthData?.config?.comfyuiOutputDir || '/data/output'}
            onTriggerScan={imageActions.handleTriggerScan}
            onOpenSystemSettings={() => {
              setSystemSubTab('comfyui');
              setActiveTab('system');
            }}
            onCancelGhost={livePolling.cancelGhostJob}
          />
        )}

        {activeTab === 'characters' && (
          <CharacterExplorerView
            characters={workspace.characters}
            allImages={workspace.allImages}
            ghostItems={livePolling.activeGhostItems}
            loras={workspace.visibleLoras}
            models={workspace.models}
            workflows={workspace.workflows}
            collections={workspace.collections}
            pillTypeSettings={workspace.pillTypeSettings}
            selectedCharacterId={selectedCharacterId}
            onSelectCharacterId={setSelectedCharacterId}
            onRefresh={refreshAll}
            onOpenImage={(img) => setInspectedImageId(img.id)}
            onFilterGalleryByCharacter={(charId, addonFilter) => {
              workspace.setGalleryPage(1);
              workspace.setFilters({
                ...INITIAL_FILTERS,
                characterIds: [charId],
                checkpoint: addonFilter?.checkpoint || '',
                loras: addonFilter?.loraName ? [addonFilter.loraName] : [],
              });
              setActiveTab('gallery');
            }}
            onLaunchNewImage={({ character: char, checkpointName, loras: pickedLoras }) => {
              setQuickGenPrefill({
                prompt: '',
                character: char,
                checkpointName: checkpointName || null,
                loras: pickedLoras,
                batchCount: 1,
                timestamp: Date.now(),
              });
              const extraParts = [
                checkpointName ? 'base model' : null,
                pickedLoras.length > 0 ? `${pickedLoras.length} LoRA(s)` : null,
              ].filter(Boolean);
              toasts.pushToast(
                extraParts.length > 0
                  ? `Prepared ${char.name} + ${extraParts.join(' + ')} in Quick Gen`
                  : `Prepared ${char.name} in Quick Gen`,
                'success'
              );
            }}
            onReusePrompt={imageActions.handleReusePrompt}
            onOpenConversation={imageActions.handleOpenConversationForImage}
            onQuickRate={imageActions.handleQuickRate}
            onQuickFavorite={imageActions.handleQuickFavorite}
            onQuickReject={imageActions.handleQuickReject}
            onPushToast={toasts.pushToast}
            onCancelGhost={livePolling.cancelGhostJob}
          />
        )}

        {activeTab === 'generation' && (
          <GenerationStudioView
            characters={workspace.characters}
            loras={workspace.visibleLoras}
            models={workspace.models}
            workflows={workspace.workflows}
            checkpoints={workspace.checkpoints}
            allImages={workspace.allImages}
            onRefreshAll={refreshAll}
            onOpenImage={(img) => setInspectedImageId(img.id)}
            onOpenSystemSettings={() => {
              setSystemSubTab('lm_studio');
              setActiveTab('system');
            }}
          />
        )}

        {activeTab === 'loras' && (
          <LoraAndModelManagerView
            loras={workspace.loras}
            models={workspace.models}
            presets={workspace.presets}
            allImages={workspace.allImages}
            pillTypeSettings={workspace.pillTypeSettings}
            onRefresh={refreshAll}
            onOpenImage={(img) => setInspectedImageId(img.id)}
            onFilterGalleryByLora={(loraFilename) => {
              workspace.setFilters({ ...INITIAL_FILTERS, loras: [loraFilename] });
              setActiveTab('gallery');
            }}
            onFilterGalleryByModel={(modelFilename) => {
              workspace.setFilters({ ...INITIAL_FILTERS, checkpoint: modelFilename });
              setActiveTab('gallery');
            }}
            onPushToast={toasts.pushToast}
          />
        )}

        {activeTab === 'workflows' && (
          <WorkflowLibraryView
            workflows={workspace.workflows}
            allImages={workspace.allImages}
            models={workspace.models}
            loras={workspace.visibleLoras}
            checkpoints={workspace.checkpoints}
            onRefresh={refreshAll}
            onOpenImage={(img) => setInspectedImageId(img.id)}
            onPushToast={toasts.pushToast}
          />
        )}

        {activeTab === 'system' && (
          <SystemAndBackupView
            healthData={workspace.healthData}
            onRefreshAll={refreshAll}
            initialSubTab={systemSubTab}
            onReadinessUpdated={setReadiness}
          />
        )}
      </main>

      {/* Full-Resolution Lightbox & Inspector Drawer */}
      {inspectedImage && (
        <ImageInspectorDrawer
          image={inspectedImage}
          allImages={workspace.allImages}
          loras={workspace.visibleLoras}
          models={workspace.models}
          presets={workspace.presets}
          pillTypeSettings={workspace.pillTypeSettings}
          ghostItems={livePolling.activeGhostItems}
          onCancelGhost={livePolling.cancelGhostJob}
          onClose={() => setInspectedImageId(null)}
          onPrev={
            inspectedIdx > 0
              ? () => setInspectedImageId(workspace.images[inspectedIdx - 1].id)
              : undefined
          }
          onNext={
            inspectedIdx >= 0 && inspectedIdx < workspace.images.length - 1
              ? () => setInspectedImageId(workspace.images[inspectedIdx + 1].id)
              : undefined
          }
          onUpdated={refreshAll}
          onPushToast={toasts.pushToast}
          onRateImage={imageActions.handleQuickRate}
          onToggleFavoriteImage={imageActions.handleQuickFavorite}
          onRejectImage={imageActions.handleQuickReject}
          onAdvanceAfterReject={imageActions.handleAdvanceAfterReject}
          onNavigateToImage={(targetId) => setInspectedImageId(targetId)}
          onOpenConversation={imageActions.handleOpenConversationForImage}
          onReusePrompt={(img) => imageActions.handleReusePrompt(img, { stackFromSource: true })}
          characters={workspace.characters}
          collections={workspace.collections}
          onFilterByLora={(loraName) => {
            workspace.setFilters({ ...INITIAL_FILTERS, loras: [loraName] });
            setActiveTab('gallery');
          }}
          onFilterByCharacter={(charId) => {
            workspace.setFilters({ ...INITIAL_FILTERS, characterIds: [charId] });
            setActiveTab('gallery');
          }}
          visualTaggerEnabled={Boolean(workspace.healthData?.visualTagger?.enabled)}
          onFilterByVisualKeyword={(keyword) => {
            workspace.setFilters({
              ...INITIAL_FILTERS,
              query: keyword.includes(' ') ? `"${keyword}"` : keyword,
            });
            setActiveTab('gallery');
          }}
        />
      )}

      {/* Floating Quick Generation Bar (Visible across all tabs and over Image Inspector) */}
      {showQuickGenBar && (
        <FloatingQuickGenBar
          characters={workspace.characters}
          loras={workspace.visibleLoras}
          models={workspace.models}
          presets={workspace.presets}
          allImages={workspace.allImages}
          workflows={workspace.workflows}
          prefillPayload={quickGenPrefill}
          onClearPrefill={handleClearQuickGenPrefill}
          onRefreshAll={refreshAll}
          onPushToast={toasts.pushToast}
          lmStudioOnline={livePolling.lmStudioStatus.online}
          pillTypeSettings={workspace.pillTypeSettings}
          isInspectorOpen={Boolean(inspectedImage)}
        />
      )}
    </div>
  );
}
