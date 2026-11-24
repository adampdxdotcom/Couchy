import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api/client.ts';
import { normalizePillTypeSettings } from '../shared/pillSettings.ts';
import { OptimisticRejectionTracker } from './optimisticRejectionTracker.ts';
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
  civitaiShareMode: '',
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
    !f.civitaiShareMode &&
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

  // Live refs prevent stale search/filter closures and out-of-order responses from overwriting cleared results
  const filtersRef = useRef<GalleryFilterState>(filters);
  filtersRef.current = filters;
  const allImagesRef = useRef<ImageRecord[]>(allImages);
  allImagesRef.current = allImages;
  const filterQuerySeqRef = useRef<number>(0);
  const filterAbortRef = useRef<AbortController | null>(null);
  const metadataQuerySeqRef = useRef<number>(0);
  const metadataAbortRef = useRef<AbortController | null>(null);
  const rejectionTrackerRef = useRef<OptimisticRejectionTracker>(new OptimisticRejectionTracker());
  const prevQueryRef = useRef<string>(filters.query);

  const beginRejectMutation = useCallback((imageId: number, nextRejected: boolean) => {
    return rejectionTrackerRef.current.beginMutation(imageId, nextRejected);
  }, []);

  const settleRejectMutation = useCallback(
    (imageId: number, token: number, committed: boolean) => {
      rejectionTrackerRef.current.settleMutation(imageId, token, committed);
    },
    []
  );

  const cancelPendingMetadataQuery = useCallback(() => {
    metadataQuerySeqRef.current += 1;
    if (metadataAbortRef.current) {
      metadataAbortRef.current.abort();
      metadataAbortRef.current = null;
    }
  }, []);

  const cancelPendingFilterQuery = useCallback(() => {
    filterQuerySeqRef.current += 1;
    if (filterAbortRef.current) {
      filterAbortRef.current.abort();
      filterAbortRef.current = null;
    }
  }, []);

  const loadMetadataAndEntities = useCallback(async () => {
    cancelPendingMetadataQuery();
    const seq = metadataQuerySeqRef.current;
    const controller = new AbortController();
    metadataAbortRef.current = controller;
    const queryTicket = rejectionTrackerRef.current.beginQuery();

    // Prioritize querying gallery images immediately so cards render without waiting for secondary metadata
    const imagesPromise = api
      .queryImages(
        { rejectedMode: 'include', archivedMode: 'include' },
        { signal: controller.signal }
      )
      .then((unfilteredRes) => {
        if (seq !== metadataQuerySeqRef.current) return;
        const allItems = rejectionTrackerRef.current.reconcileAllImages(
          unfilteredRes.items || [],
          queryTicket.startEpoch
        );
        allImagesRef.current = allItems;
        setAllImages(allItems);
        if (isDefaultFilters(filtersRef.current)) {
          cancelPendingFilterQuery();
          setImages(allItems.filter((img) => !img.isRejected && !img.isArchived));
        }
      })
      .catch((err: any) => {
        if (err?.name === 'AbortError' || seq !== metadataQuerySeqRef.current) return;
        console.error('Failed to query images:', err);
      })
      .finally(() => {
        rejectionTrackerRef.current.endQuery(queryTicket.queryId);
        if (seq === metadataQuerySeqRef.current) {
          if (metadataAbortRef.current === controller) {
            metadataAbortRef.current = null;
          }
          setIsLoadingImages(false);
        }
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
  }, [cancelPendingMetadataQuery, cancelPendingFilterQuery]);

  const loadFilteredImages = useCallback(
    async (targetFilters: GalleryFilterState, options?: { silent?: boolean }) => {
      // Always cancel any earlier in-flight filter request and advance sequence counter
      cancelPendingFilterQuery();
      const seq = filterQuerySeqRef.current;

      if (isDefaultFilters(targetFilters)) {
        if (allImagesRef.current.length > 0) {
          setImages(allImagesRef.current.filter((img) => !img.isRejected && !img.isArchived));
        }
        setIsLoadingImages(false);
        return;
      }

      const controller = new AbortController();
      filterAbortRef.current = controller;
      const queryTicket = rejectionTrackerRef.current.beginQuery();

      if (!options?.silent) {
        setIsLoadingImages(true);
      }
      try {
        const res = await api.queryImages(targetFilters, { signal: controller.signal });
        if (seq !== filterQuerySeqRef.current) return;
        const reconciled = rejectionTrackerRef.current.reconcileFilteredImages(
          res.items || [],
          queryTicket.startEpoch,
          targetFilters.rejectedMode
        );
        setImages(reconciled);
      } catch (err: any) {
        if (err?.name === 'AbortError' || seq !== filterQuerySeqRef.current) return;
        console.error('Failed to query filtered images:', err);
      } finally {
        rejectionTrackerRef.current.endQuery(queryTicket.queryId);
        if (seq === filterQuerySeqRef.current) {
          if (filterAbortRef.current === controller) {
            filterAbortRef.current = null;
          }
          setIsLoadingImages(false);
        }
      }
    },
    [cancelPendingFilterQuery]
  );

  useEffect(() => {
    loadMetadataAndEntities();
    return () => {
      cancelPendingMetadataQuery();
      cancelPendingFilterQuery();
    };
  }, [loadMetadataAndEntities, cancelPendingMetadataQuery, cancelPendingFilterQuery]);

  useEffect(() => {
    const queryChanged = prevQueryRef.current !== filters.query;
    prevQueryRef.current = filters.query;

    if (isDefaultFilters(filters)) {
      cancelPendingFilterQuery();
      if (allImagesRef.current.length > 0) {
        setImages(allImagesRef.current.filter((img) => !img.isRejected && !img.isArchived));
      }
      setIsLoadingImages(false);
      return;
    }

    // Debounce active text typing so intermediate keystrokes don't race; run filter toggles immediately
    const delayMs = queryChanged && filters.query.trim().length > 0 ? 180 : 0;
    if (delayMs === 0) {
      void loadFilteredImages(filters, { silent: allImagesRef.current.length > 0 });
      return;
    }

    const timer = window.setTimeout(() => {
      void loadFilteredImages(filters, { silent: allImagesRef.current.length > 0 });
    }, delayMs);
    return () => {
      window.clearTimeout(timer);
    };
  }, [filters, loadFilteredImages, cancelPendingFilterQuery]);

  const refreshWorkspaceData = useCallback(async () => {
    await loadMetadataAndEntities();
    // Read latest filters from ref after metadata refresh finishes so cleared searches never resurrect
    const latestFilters = filtersRef.current;
    if (!isDefaultFilters(latestFilters)) {
      await loadFilteredImages(latestFilters, { silent: true });
    }
  }, [loadMetadataAndEntities, loadFilteredImages]);

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
    beginRejectMutation,
    settleRejectMutation,
  };
}
