/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { api } from './api/client.ts';
import { TopNavHeader, type WorkspaceTab } from './components/TopNavHeader.tsx';
import { GalleryFilterBar, type GalleryViewLayout } from './components/GalleryFilterBar.tsx';
import { GalleryGridView } from './components/GalleryGridView.tsx';
import { ImageInspectorDrawer } from './components/ImageInspectorDrawer.tsx';
import { CharacterExplorerView } from './components/CharacterExplorerView.tsx';
import { GenerationStudioView } from './components/GenerationStudioView.tsx';
import { LoraAndModelManagerView } from './components/LoraAndModelManagerView.tsx';
import { WorkflowLibraryView } from './components/WorkflowLibraryView.tsx';
import { SystemAndBackupView } from './components/SystemAndBackupView.tsx';
import { FloatingQuickGenBar } from './components/FloatingQuickGenBar.tsx';
import type {
  AppToastMessage,
  CharacterProfile,
  ComfyUiLiveStatus,
  GalleryFilterState,
  ImageRecord,
  LoraExplorerItem,
  ModelInventoryItem,
  SavedSearchPreset,
  WorkflowLibraryItem,
} from './shared/types.ts';

const INITIAL_FILTERS: GalleryFilterState = {
  query: '',
  sortBy: 'newest',
  minRating: 0,
  favoritesOnly: false,
  rejectedMode: 'exclude',
  archivedMode: 'exclude',
  checkpoint: '',
  collectionId: null,
  tagIds: [],
  loras: [],
  loraMatchMode: 'ALL',
  minLoraStrength: null,
  maxLoraStrength: null,
  characterIds: [],
  characterMatchMode: 'ALL',
  includeSuggestedCharacters: false,
  dependencyStatus: '',
  dateFrom: '',
  dateTo: '',
};

export default function App() {
  const [activeTab, setActiveTab] = useState<WorkspaceTab>('gallery');
  const [layout, setLayout] = useState<GalleryViewLayout>('masonry');
  const [thumbScale, setThumbScale] = useState<'sm' | 'md' | 'lg'>('md');
  const [filters, setFilters] = useState<GalleryFilterState>(INITIAL_FILTERS);

  const [images, setImages] = useState<ImageRecord[]>([]);
  const [allImages, setAllImages] = useState<ImageRecord[]>([]);
  const [characters, setCharacters] = useState<CharacterProfile[]>([]);
  const [loras, setLoras] = useState<LoraExplorerItem[]>([]);
  const [models, setModels] = useState<ModelInventoryItem[]>([]);
  const [workflows, setWorkflows] = useState<WorkflowLibraryItem[]>([]);
  const [collections, setCollections] = useState<
    { id: number; name: string; description: string; imageCount: number }[]
  >([]);
  const [tags, setTags] = useState<{ id: number; name: string; color: string; imageCount: number }[]>(
    []
  );
  const [checkpoints, setCheckpoints] = useState<string[]>([]);
  const [savedSearches, setSavedSearches] = useState<SavedSearchPreset[]>([]);
  const [healthData, setHealthData] = useState<any>(null);

  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [inspectedImageId, setInspectedImageId] = useState<number | null>(null);

  // Header ComfyUI Live Status & Toast Message History (Last 10 messages + 3s toast override)
  const [comfyStatus, setComfyStatus] = useState<ComfyUiLiveStatus>({
    online: false,
    runningCount: 0,
    queuedCount: 0,
    progressPercent: null,
    step: null,
    maxSteps: null,
    currentNode: null,
  });
  const [messages, setMessages] = useState<AppToastMessage[]>([]);
  const [activeToast, setActiveToast] = useState<AppToastMessage | null>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const prevBusyRef = useRef<boolean>(false);
  const lastIndexedAtRef = useRef<number>(0);

  const pushToast = useCallback(
    (text: string, type: AppToastMessage['type'] = 'info') => {
      const now = new Date();
      const timeStr = now.toTimeString().slice(0, 8);
      const entry: AppToastMessage = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        text,
        type,
        createdAt: timeStr,
      };
      setMessages((prev) => [entry, ...prev].slice(0, 10));
      setActiveToast(entry);

      if (toastTimerRef.current) {
        clearTimeout(toastTimerRef.current);
      }
      // Show incoming message for 3 seconds, then revert to ComfyUI progress / status
      toastTimerRef.current = setTimeout(() => {
        setActiveToast(null);
        toastTimerRef.current = null;
      }, 3000);
    },
    []
  );

  const isDefaultFilters = (f: GalleryFilterState): boolean =>
    !f.query.trim() &&
    f.sortBy === 'newest' &&
    f.minRating === 0 &&
    !f.favoritesOnly &&
    f.rejectedMode === 'exclude' &&
    f.archivedMode === 'exclude' &&
    !f.checkpoint &&
    f.collectionId === null &&
    f.tagIds.length === 0 &&
    f.loras.length === 0 &&
    f.minLoraStrength === null &&
    f.maxLoraStrength === null &&
    f.characterIds.length === 0 &&
    !f.includeSuggestedCharacters &&
    !f.dependencyStatus &&
    !f.dateFrom &&
    !f.dateTo;

  const loadMetadataAndEntities = useCallback(async () => {
    try {
      const [healthRes, orgMetaRes, charRes, loraRes, modelRes, wfRes, unfilteredRes] =
        await Promise.allSettled([
          api.getHealth(),
          api.getOrganizationMeta(),
          api.listCharacters(),
          api.listLoras(),
          api.listModelInventory(),
          api.listWorkflows(),
          api.queryImages({ rejectedMode: 'include', archivedMode: 'include' }),
        ]);

      if (healthRes.status === 'fulfilled') {
        setHealthData(healthRes.value);
      }
      if (orgMetaRes.status === 'fulfilled') {
        setTags(orgMetaRes.value.tags || []);
        setCollections(orgMetaRes.value.collections || []);
        setCheckpoints(orgMetaRes.value.checkpoints || []);
        setSavedSearches(orgMetaRes.value.savedSearches || []);
      }
      if (charRes.status === 'fulfilled') {
        setCharacters(charRes.value.items || []);
      }
      if (loraRes.status === 'fulfilled') {
        setLoras(loraRes.value.items || []);
      }
      if (modelRes.status === 'fulfilled') {
        setModels(modelRes.value.items || []);
      }
      if (wfRes.status === 'fulfilled') {
        setWorkflows(wfRes.value.items || []);
      }
      if (unfilteredRes.status === 'fulfilled') {
        const allItems = unfilteredRes.value.items || [];
        setAllImages(allItems);
        setFilters((currFilters) => {
          if (isDefaultFilters(currFilters)) {
            setImages(allItems.filter((img) => !img.isRejected && !img.isArchived));
          }
          return currFilters;
        });
      }
    } catch (err) {
      console.error('Failed to load gallery metadata:', err);
    }
  }, []);

  const loadFilteredImages = useCallback(async () => {
    if (isDefaultFilters(filters) && allImages.length > 0) {
      setImages(allImages.filter((img) => !img.isRejected && !img.isArchived));
      return;
    }
    try {
      const res = await api.queryImages(filters);
      setImages(res.items || []);
    } catch (err) {
      console.error('Failed to query filtered images:', err);
    }
  }, [filters, allImages]);

  useEffect(() => {
    loadMetadataAndEntities();
  }, [loadMetadataAndEntities]);

  useEffect(() => {
    if (!isDefaultFilters(filters)) {
      loadFilteredImages();
    } else if (allImages.length > 0) {
      setImages(allImages.filter((img) => !img.isRejected && !img.isArchived));
    }
  }, [filters, allImages, loadFilteredImages]);

  const refreshAll = useCallback(async () => {
    await loadMetadataAndEntities();
    if (!isDefaultFilters(filters)) {
      await loadFilteredImages();
    }
  }, [loadMetadataAndEntities, loadFilteredImages, filters]);

  // Poll ComfyUI live queue & job progress percentage
  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const poll = async () => {
      try {
        const status = await api.getComfyUiLiveStatus();
        if (cancelled) return;
        setComfyStatus(status);

        // Silently refresh gallery as soon as any newly generated image is indexed
        if (status.lastIndexedAt && status.lastIndexedAt > lastIndexedAtRef.current) {
          lastIndexedAtRef.current = status.lastIndexedAt;
          refreshAll();
        }

        const isBusy = status.runningCount > 0 || status.queuedCount > 0;
        if (prevBusyRef.current && !isBusy) {
          refreshAll();
        }
        prevBusyRef.current = isBusy;

        timer = setTimeout(poll, isBusy ? 1200 : 3500);
      } catch {
        if (!cancelled) {
          timer = setTimeout(poll, 5000);
        }
      }
    };

    poll();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [pushToast, refreshAll]);

  const handleTriggerScan = async () => {
    pushToast('Scanning mounted output directory...', 'info');
    try {
      await api.triggerScan('incremental');
      setTimeout(async () => {
        await refreshAll();
        pushToast('Directory scan complete', 'success');
      }, 900);
    } catch {
      pushToast('Directory scan failed', 'error');
    }
  };

  const inspectedImage =
    images.find((i) => i.id === inspectedImageId) ||
    allImages.find((i) => i.id === inspectedImageId) ||
    null;

  const inspectedIdx = images.findIndex((i) => i.id === inspectedImageId);
  const showQuickGenBar = healthData?.config?.quickGenBoxEnabled !== false;

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 flex flex-col">
      {/* 3-Zone Top Bar with Unified Status & Toast Message Area */}
      <TopNavHeader
        activeTab={activeTab}
        onSelectTab={setActiveTab}
        comfyStatus={comfyStatus}
        activeToast={activeToast}
        messages={messages}
        onClearMessages={() => {
          setMessages([]);
          setActiveToast(null);
        }}
      />

      {/* Main Content Area */}
      <main className={`flex-1 ${showQuickGenBar ? 'pb-28' : ''}`}>
        {activeTab === 'gallery' && (
          <>
            <GalleryFilterBar
              filters={filters}
              onChange={setFilters}
              onReset={() => setFilters(INITIAL_FILTERS)}
              layout={layout}
              onLayoutChange={setLayout}
              thumbScale={thumbScale}
              onThumbScaleChange={setThumbScale}
              totalMatching={images.length}
              characters={characters}
              loras={loras}
              checkpoints={checkpoints}
              collections={collections}
              tags={tags}
              savedSearches={savedSearches}
              onSaveSearch={async (name) => {
                await api.saveSearchPreset(name, filters.query, filters);
                await loadMetadataAndEntities();
                pushToast(`Saved search preset "${name}"`, 'success');
              }}
              onDeleteSavedSearch={async (id) => {
                await api.deleteSearchPreset(id);
                await loadMetadataAndEntities();
                pushToast('Deleted saved search preset', 'info');
              }}
              onExportFilteredZip={() => {
                pushToast('Preparing filtered ZIP archive...', 'info');
                api.exportImagesZip({
                  filters,
                  archiveName: 'couchy-filtered-export',
                });
              }}
            />

            <GalleryGridView
              images={images}
              layout={layout}
              thumbScale={thumbScale}
              selectedIds={selectedIds}
              onToggleSelect={(id) => {
                setSelectedIds((prev) => {
                  const next = new Set(prev);
                  if (next.has(id)) next.delete(id);
                  else next.add(id);
                  return next;
                });
              }}
              onSelectAll={() => setSelectedIds(new Set(images.map((i) => i.id)))}
              onClearSelection={() => setSelectedIds(new Set())}
              onOpenInspector={(img) => setInspectedImageId(img.id)}
              onQuickRate={async (id, rating) => {
                setImages((prev) => prev.map((img) => (img.id === id ? { ...img, rating } : img)));
                setAllImages((prev) =>
                  prev.map((img) => (img.id === id ? { ...img, rating } : img))
                );
                await api.updateImageAnnotations(id, { rating });
                pushToast(rating > 0 ? `Rated image ★ ${rating}` : 'Cleared image rating', 'info');
              }}
              onQuickFavorite={async (id, isFavorite) => {
                const favoritedAt = isFavorite ? new Date().toISOString() : null;
                setImages((prev) =>
                  prev.map((img) => (img.id === id ? { ...img, isFavorite, favoritedAt } : img))
                );
                setAllImages((prev) =>
                  prev.map((img) => (img.id === id ? { ...img, isFavorite, favoritedAt } : img))
                );
                await api.updateImageAnnotations(id, { isFavorite });
                pushToast(isFavorite ? 'Added to Favorites' : 'Removed from Favorites', 'info');
              }}
              onBulkAction={async (payload) => {
                const count = selectedIds.size;
                await api.bulkUpdateImages({
                  imageIds: Array.from(selectedIds),
                  ...payload,
                });
                await refreshAll();
                pushToast(`Updated ${count} selected image(s)`, 'success');
              }}
              onExportSelectedZip={() => {
                pushToast(`Exporting ${selectedIds.size} selected image(s) as ZIP...`, 'info');
                api.exportImagesZip({
                  imageIds: Array.from(selectedIds),
                  archiveName: 'couchy-selected-export',
                });
              }}
              characters={characters}
              collections={collections}
              mountedOutputDir={healthData?.config?.comfyuiOutputDir || '/data/output'}
              onTriggerScan={handleTriggerScan}
              onOpenSystemSettings={() => setActiveTab('system')}
            />
          </>
        )}

        {activeTab === 'characters' && (
          <CharacterExplorerView
            characters={characters}
            allImages={allImages}
            loras={loras}
            workflows={workflows}
            collections={collections}
            onRefresh={refreshAll}
            onOpenImage={(img) => setInspectedImageId(img.id)}
            onFilterGalleryByCharacter={(charId) => {
              setFilters({ ...INITIAL_FILTERS, characterIds: [charId] });
              setActiveTab('gallery');
            }}
          />
        )}

        {activeTab === 'generation' && (
          <GenerationStudioView
            characters={characters}
            loras={loras}
            models={models}
            workflows={workflows}
            checkpoints={checkpoints}
            allImages={allImages}
            onRefreshAll={refreshAll}
            onOpenImage={(img) => setInspectedImageId(img.id)}
            onOpenSystemSettings={() => setActiveTab('system')}
          />
        )}

        {activeTab === 'loras' && (
          <LoraAndModelManagerView
            loras={loras}
            models={models}
            allImages={allImages}
            onRefresh={refreshAll}
            onOpenImage={(img) => setInspectedImageId(img.id)}
            onFilterGalleryByLora={(loraFilename) => {
              setFilters({ ...INITIAL_FILTERS, loras: [loraFilename] });
              setActiveTab('gallery');
            }}
          />
        )}

        {activeTab === 'workflows' && (
          <WorkflowLibraryView
            workflows={workflows}
            allImages={allImages}
            models={models}
            loras={loras}
            checkpoints={checkpoints}
            onRefresh={refreshAll}
            onOpenImage={(img) => setInspectedImageId(img.id)}
            onPushToast={pushToast}
          />
        )}

        {activeTab === 'system' && (
          <SystemAndBackupView
            healthData={healthData}
            collections={collections}
            onRefreshAll={refreshAll}
          />
        )}
      </main>

      {/* Floating Quick Generation Bar (Visible across all tabs when enabled) */}
      {showQuickGenBar && (
        <FloatingQuickGenBar
          characters={characters}
          allImages={allImages}
          workflows={workflows}
          onRefreshAll={refreshAll}
          onOpenGenerationTab={() => setActiveTab('generation')}
          onPushToast={pushToast}
        />
      )}

      {/* Full-Resolution Lightbox & Inspector Drawer */}
      {inspectedImage && (
        <ImageInspectorDrawer
          image={inspectedImage}
          onClose={() => setInspectedImageId(null)}
          onPrev={
            inspectedIdx > 0 ? () => setInspectedImageId(images[inspectedIdx - 1].id) : undefined
          }
          onNext={
            inspectedIdx >= 0 && inspectedIdx < images.length - 1
              ? () => setInspectedImageId(images[inspectedIdx + 1].id)
              : undefined
          }
          onUpdated={refreshAll}
          characters={characters}
          collections={collections}
          onFilterByLora={(loraName) => {
            setFilters({ ...INITIAL_FILTERS, loras: [loraName] });
            setActiveTab('gallery');
          }}
          onFilterByCharacter={(charId) => {
            setFilters({ ...INITIAL_FILTERS, characterIds: [charId] });
            setActiveTab('gallery');
          }}
          visualTaggerEnabled={Boolean(healthData?.visualTagger?.enabled)}
          onFilterByVisualKeyword={(keyword) => {
            setFilters({
              ...INITIAL_FILTERS,
              query: keyword.includes(' ') ? `"${keyword}"` : keyword,
            });
            setActiveTab('gallery');
          }}
        />
      )}
    </div>
  );
}
