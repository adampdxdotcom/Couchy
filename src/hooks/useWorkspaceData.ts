import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../api/client.ts';
import { normalizePillTypeSettings } from '../shared/pillSettings.ts';
import type {
  CharacterProfile,
  GalleryFilterState,
  ImageRecord,
  LoraExplorerItem,
  LoraPreset,
  ModelInventoryItem,
  SavedSearchPreset,
  WorkflowLibraryItem,
} from '../shared/types.ts';

export const INITIAL_FILTERS: GalleryFilterState = {
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

export function isDefaultFilters(f: GalleryFilterState): boolean {
  return (
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
    !f.dateTo
  );
}

/**
 * Loads core workspace entities (images, characters, LoRAs, models, presets, workflows,
 * organization metadata, health config) and manages Gallery filtering & pagination state.
 */
export function useWorkspaceData() {
  const [filters, setFilters] = useState<GalleryFilterState>(INITIAL_FILTERS);
  const [galleryPage, setGalleryPage] = useState<number>(1);
  const [infiniteScroll, setInfiniteScroll] = useState<boolean>(() => {
    try {
      return localStorage.getItem('couchy_gallery_infinite_scroll') === 'true';
    } catch {
      return false;
    }
  });
  const galleryPageSize = 48;

  const [images, setImages] = useState<ImageRecord[]>([]);
  const [allImages, setAllImages] = useState<ImageRecord[]>([]);
  const [isLoadingImages, setIsLoadingImages] = useState<boolean>(true);
  const [characters, setCharacters] = useState<CharacterProfile[]>([]);
  const [loras, setLoras] = useState<LoraExplorerItem[]>([]);
  const [models, setModels] = useState<ModelInventoryItem[]>([]);
  const [presets, setPresets] = useState<LoraPreset[]>([]);
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

  const loadMetadataAndEntities = useCallback(async () => {
    // Prioritize querying gallery images immediately so cards render without waiting for secondary metadata
    const imagesPromise = api
      .queryImages({ rejectedMode: 'include', archivedMode: 'include' })
      .then((unfilteredRes) => {
        const allItems = unfilteredRes.items || [];
        setAllImages(allItems);
        setFilters((currFilters) => {
          if (isDefaultFilters(currFilters)) {
            setImages(allItems.filter((img) => !img.isRejected && !img.isArchived));
          }
          return currFilters;
        });
      })
      .catch((err) => {
        console.error('Failed to query images:', err);
      })
      .finally(() => {
        setIsLoadingImages(false);
      });

    const metaPromise = Promise.allSettled([
      api.getHealth(),
      api.getOrganizationMeta(),
      api.listCharacters(),
      api.listLoras(),
      api.listModelInventory(),
      api.listPresets(),
      api.listWorkflows(),
    ]).then(([healthRes, orgMetaRes, charRes, loraRes, modelRes, presetRes, wfRes]) => {
      if (healthRes.status === 'fulfilled') setHealthData(healthRes.value);
      if (orgMetaRes.status === 'fulfilled') {
        setTags(orgMetaRes.value.tags || []);
        setCollections(orgMetaRes.value.collections || []);
        setCheckpoints(orgMetaRes.value.checkpoints || []);
        setSavedSearches(orgMetaRes.value.savedSearches || []);
      }
      if (charRes.status === 'fulfilled') setCharacters(charRes.value.items || []);
      if (loraRes.status === 'fulfilled') setLoras(loraRes.value.items || []);
      if (modelRes.status === 'fulfilled') setModels(modelRes.value.items || []);
      if (presetRes.status === 'fulfilled') setPresets(presetRes.value.items || []);
      if (wfRes.status === 'fulfilled') setWorkflows(wfRes.value.items || []);
    });

    await Promise.allSettled([imagesPromise, metaPromise]);
  }, []);

  const loadFilteredImages = useCallback(async () => {
    if (isDefaultFilters(filters) && allImages.length > 0) {
      setImages(allImages.filter((img) => !img.isRejected && !img.isArchived));
      setIsLoadingImages(false);
      return;
    }
    setIsLoadingImages(true);
    try {
      const res = await api.queryImages(filters);
      setImages(res.items || []);
    } catch (err) {
      console.error('Failed to query filtered images:', err);
    } finally {
      setIsLoadingImages(false);
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

  const refreshWorkspaceData = useCallback(async () => {
    await loadMetadataAndEntities();
    if (!isDefaultFilters(filters)) {
      await loadFilteredImages();
    }
  }, [loadMetadataAndEntities, loadFilteredImages, filters]);

  const totalGalleryPages = Math.max(1, Math.ceil(images.length / galleryPageSize));
  const currentGalleryPage = Math.min(Math.max(1, galleryPage), totalGalleryPages);

  const handleInfiniteScrollChange = useCallback((enabled: boolean) => {
    setInfiniteScroll(enabled);
    try {
      localStorage.setItem('couchy_gallery_infinite_scroll', String(enabled));
    } catch {
      // ignore storage errors
    }
  }, []);

  const handleGalleryPageChange = useCallback(
    (nextPage: number) => {
      const clamped = Math.min(Math.max(1, nextPage), totalGalleryPages);
      setGalleryPage(clamped);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    },
    [totalGalleryPages]
  );

  const pillTypeSettings = useMemo(
    () => normalizePillTypeSettings(healthData?.config?.pillTypeSettings),
    [healthData?.config?.pillTypeSettings]
  );
  const visibleLoras = useMemo(() => loras.filter((l) => !l.isHidden), [loras]);

  return {
    filters,
    setFilters,
    galleryPageSize,
    setGalleryPage,
    totalGalleryPages,
    currentGalleryPage,
    handleGalleryPageChange,
    infiniteScroll,
    handleInfiniteScrollChange,
    images,
    setImages,
    allImages,
    setAllImages,
    isLoadingImages,
    characters,
    loras,
    visibleLoras,
    models,
    presets,
    workflows,
    collections,
    tags,
    checkpoints,
    savedSearches,
    healthData,
    pillTypeSettings,
    loadMetadataAndEntities,
    refreshWorkspaceData,
  };
}
