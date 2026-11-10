/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useCallback, useEffect, useState } from 'react';
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
  CharacterProfile,
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
  const [isScanning, setIsScanning] = useState(false);

  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [inspectedImageId, setInspectedImageId] = useState<number | null>(null);

  const loadMetadataAndEntities = useCallback(async () => {
    try {
      const [health, orgMeta, charRes, loraRes, modelRes, wfRes, unfilteredImgs] =
        await Promise.all([
          api.getHealth(),
          api.getOrganizationMeta(),
          api.listCharacters(),
          api.listLoras(),
          api.listModelInventory(),
          api.listWorkflows(),
          api.queryImages({ rejectedMode: 'include', archivedMode: 'include' }),
        ]);

      setHealthData(health);
      setIsScanning(health?.activeScan?.status === 'running');
      setTags(orgMeta.tags || []);
      setCollections(orgMeta.collections || []);
      setCheckpoints(orgMeta.checkpoints || []);
      setSavedSearches(orgMeta.savedSearches || []);
      setCharacters(charRes.items || []);
      setLoras(loraRes.items || []);
      setModels(modelRes.items || []);
      setWorkflows(wfRes.items || []);
      setAllImages(unfilteredImgs.items || []);
    } catch (err) {
      console.error('Failed to load gallery metadata:', err);
    }
  }, []);

  const loadFilteredImages = useCallback(async () => {
    try {
      const res = await api.queryImages(filters);
      setImages(res.items || []);
    } catch (err) {
      console.error('Failed to query filtered images:', err);
    }
  }, [filters]);

  useEffect(() => {
    loadMetadataAndEntities();
  }, [loadMetadataAndEntities]);

  useEffect(() => {
    loadFilteredImages();
  }, [loadFilteredImages]);

  const refreshAll = async () => {
    await Promise.all([loadMetadataAndEntities(), loadFilteredImages()]);
  };

  const handleTriggerScan = async () => {
    setIsScanning(true);
    try {
      await api.triggerScan('incremental');
      setTimeout(async () => {
        await refreshAll();
        setIsScanning(false);
      }, 900);
    } catch {
      setIsScanning(false);
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
      {/* 3-Zone Top Bar */}
      <TopNavHeader
        activeTab={activeTab}
        onSelectTab={setActiveTab}
        onTriggerScan={handleTriggerScan}
        isScanning={isScanning}
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
              }}
              onDeleteSavedSearch={async (id) => {
                await api.deleteSearchPreset(id);
                await loadMetadataAndEntities();
              }}
              onExportFilteredZip={() =>
                api.exportImagesZip({
                  filters,
                  archiveName: 'couchy-filtered-export',
                })
              }
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
                await api.updateImageAnnotations(id, { rating });
                await refreshAll();
              }}
              onQuickFavorite={async (id, isFavorite) => {
                await api.updateImageAnnotations(id, { isFavorite });
                await refreshAll();
              }}
              onBulkAction={async (payload) => {
                await api.bulkUpdateImages({
                  imageIds: Array.from(selectedIds),
                  ...payload,
                });
                await refreshAll();
              }}
              onExportSelectedZip={() =>
                api.exportImagesZip({
                  imageIds: Array.from(selectedIds),
                  archiveName: 'couchy-selected-export',
                })
              }
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
            onRefresh={refreshAll}
            onOpenImage={(img) => setInspectedImageId(img.id)}
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
        />
      )}
    </div>
  );
}
