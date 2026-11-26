import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api/client.ts';
import { normalizePillTypeSettings } from '../shared/pillSettings.ts';
import { OptimisticRejectionTracker } from './optimisticRejectionTracker.ts';
import type { WorkspaceTab } from '../components/TopNavHeader.tsx';
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
 * Loads core workspace entities and manages true server-side paginated Gallery state
 * (using slim catalogs on startup and lazily upgrading full LoRA/Model catalogs on the LoRAs tab).
 */
export function useWorkspaceData(activeTab: WorkspaceTab = 'gallery') {
  const [filters, setFilters] = useState<GalleryFilterState>(INITIAL_FILTERS);
  const [galleryPage, setGalleryPage] = useState<number>(1);
  const [loadedInfinitePages, setLoadedInfinitePages] = useState<number>(1);
  const [infiniteScroll, setInfiniteScroll] = useState<boolean>(() => {
    try {
      return localStorage.getItem('couchy_gallery_infinite_scroll') === 'true';
    } catch {
      return false;
    }
  });
  const galleryPageSize = 48;

  const [images, setImages] = useState<ImageRecord[]>([]);
  const [totalImages, setTotalImages] = useState<number>(0);
  const [isLoadingImages, setIsLoadingImages] = useState<boolean>(true);
  const [isLoadingMore, setIsLoadingMore] = useState<boolean>(false);
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
  const [refreshVersion, setRefreshVersion] = useState<number>(0);

  // Live refs keep async fetches race-safe across filter edits, page flips, and silent refreshes
  const filtersRef = useRef<GalleryFilterState>(filters);
  filtersRef.current = filters;
  const galleryPageRef = useRef<number>(galleryPage);
  galleryPageRef.current = galleryPage;
  const infiniteScrollRef = useRef<boolean>(infiniteScroll);
  infiniteScrollRef.current = infiniteScroll;
  const loadedInfinitePagesRef = useRef<number>(loadedInfinitePages);
  loadedInfinitePagesRef.current = loadedInfinitePages;
  const totalImagesRef = useRef<number>(totalImages);
  totalImagesRef.current = totalImages;
  const imagesRef = useRef<ImageRecord[]>(images);
  imagesRef.current = images;

  const galleryQuerySeqRef = useRef<number>(0);
  const galleryAbortRef = useRef<AbortController | null>(null);
  const loadMoreInFlightRef = useRef<boolean>(false);
  const metadataQuerySeqRef = useRef<number>(0);
  const fullCatalogSeqRef = useRef<number>(0);
  const activeTabRef = useRef<WorkspaceTab>(activeTab);
  activeTabRef.current = activeTab;
  const hasFullModelCatalogsRef = useRef<boolean>(false);
  const rejectionTrackerRef = useRef<OptimisticRejectionTracker>(new OptimisticRejectionTracker());
  const prevQueryRef = useRef<string>(filters.query);
  const didInitGalleryRef = useRef<boolean>(false);

  const beginRejectMutation = useCallback((imageId: number, nextRejected: boolean) => {
    return rejectionTrackerRef.current.beginMutation(imageId, nextRejected);
  }, []);

  const settleRejectMutation = useCallback(
    (imageId: number, token: number, committed: boolean) => {
      rejectionTrackerRef.current.settleMutation(imageId, token, committed);
    },
    []
  );

  const cancelPendingGalleryQuery = useCallback(() => {
    galleryQuerySeqRef.current += 1;
    if (galleryAbortRef.current) {
      galleryAbortRef.current.abort();
      galleryAbortRef.current = null;
    }
    loadMoreInFlightRef.current = false;
  }, []);

  /**
   * Fetches a single server-paginated slice (or preserved infinite-scroll depth) for the gallery.
   */
  const fetchGallerySlice = useCallback(
    async (
      targetFilters: GalleryFilterState,
      options: {
        page: number;
        pageSize?: number;
        silent?: boolean;
      }
    ): Promise<{ items: ImageRecord[]; total: number; page: number; totalPages: number } | null> => {
      cancelPendingGalleryQuery();
      const seq = galleryQuerySeqRef.current;
      const controller = new AbortController();
      galleryAbortRef.current = controller;
      const queryTicket = rejectionTrackerRef.current.beginQuery();
      const requestedPageSize = options.pageSize ?? galleryPageSize;

      if (!options.silent) {
        setIsLoadingImages(true);
      }

      try {
        const res = await api.queryImages(
          { ...targetFilters, page: options.page, pageSize: requestedPageSize },
          { signal: controller.signal }
        );
        if (seq !== galleryQuerySeqRef.current) return null;

        const reconciled = rejectionTrackerRef.current.reconcileFilteredImages(
          res.items || [],
          queryTicket.startEpoch,
          targetFilters.rejectedMode
        );
        const total = typeof res.total === 'number' ? res.total : reconciled.length;
        const resolvedPage = res.page ?? options.page;
        const resolvedTotalPages = res.totalPages ?? Math.max(1, Math.ceil(total / galleryPageSize));

        imagesRef.current = reconciled;
        totalImagesRef.current = total;
        setImages(reconciled);
        setTotalImages(total);
        if (!infiniteScrollRef.current && resolvedPage !== galleryPageRef.current) {
          setGalleryPage(resolvedPage);
        }

        return {
          items: reconciled,
          total,
          page: resolvedPage,
          totalPages: resolvedTotalPages,
        };
      } catch (err: any) {
        if (err?.name === 'AbortError' || seq !== galleryQuerySeqRef.current) return null;
        console.error('Failed to query gallery images:', err);
        return null;
      } finally {
        rejectionTrackerRef.current.endQuery(queryTicket.queryId);
        if (seq === galleryQuerySeqRef.current) {
          if (galleryAbortRef.current === controller) {
            galleryAbortRef.current = null;
          }
          setIsLoadingImages(false);
        }
      }
    },
    [cancelPendingGalleryQuery, galleryPageSize]
  );

  /**
   * Loads workspace catalogs independently. Uses compact LoRA/Model payloads and saved-only
   * workflows outside the LoRAs & Models tab to keep startup and Gallery refreshes lean.
   */
  const loadMetadataAndEntities = useCallback(async () => {
    const seq = ++metadataQuerySeqRef.current;
    fullCatalogSeqRef.current += 1;
    const needsFullCatalogs = activeTabRef.current === 'loras';
    const catalogMode = needsFullCatalogs ? 'full' : 'compact';
    hasFullModelCatalogsRef.current = needsFullCatalogs;

    const metaPromises = [
      api
        .getHealth()
        .then((res) => {
          if (seq === metadataQuerySeqRef.current) setHealthData(res);
        })
        .catch(() => {}),
      api
        .getOrganizationMeta()
        .then((res) => {
          if (seq !== metadataQuerySeqRef.current) return;
          setTags(res.tags || []);
          setCollections(res.collections || []);
          setCheckpoints(res.checkpoints || []);
          setSavedSearches(res.savedSearches || []);
        })
        .catch(() => {}),
      api
        .listCharacters()
        .then((res) => {
          if (seq === metadataQuerySeqRef.current) setCharacters(res.items || []);
        })
        .catch(() => {}),
      api
        .listLoras({ mode: catalogMode })
        .then((res) => {
          if (seq === metadataQuerySeqRef.current) setLoras(res.items || []);
        })
        .catch(() => {}),
      api
        .listModelInventory({ mode: catalogMode })
        .then((res) => {
          if (seq === metadataQuerySeqRef.current) setModels(res.items || []);
        })
        .catch(() => {}),
      api
        .listPresets()
        .then((res) => {
          if (seq === metadataQuerySeqRef.current) setPresets(res.items || []);
        })
        .catch(() => {}),
      api
        .listWorkflows({ scope: 'saved' })
        .then((res) => {
          if (seq === metadataQuerySeqRef.current) setWorkflows(res.items || []);
        })
        .catch(() => {}),
    ];

    await Promise.allSettled(metaPromises);
  }, []);

  // Lazily upgrade LoRAs & Models to full enriched payloads (descriptions, stats, comments, previews)
  // the first time the user visits the LoRAs & Models tab (or after a refresh while on another tab).
  useEffect(() => {
    if (activeTab !== 'loras' || hasFullModelCatalogsRef.current) return;

    const seq = ++fullCatalogSeqRef.current;
    let cancelled = false;
    Promise.all([api.listLoras({ mode: 'full' }), api.listModelInventory({ mode: 'full' })])
      .then(([loraRes, modelRes]) => {
        if (cancelled || seq !== fullCatalogSeqRef.current) return;
        setLoras(loraRes.items || []);
        setModels(modelRes.items || []);
        hasFullModelCatalogsRef.current = true;
      })
      .catch(() => {
        // Keep compact catalogs visible if upgrade fails transiently
      });

    return () => {
      cancelled = true;
    };
  }, [activeTab]);

  // Initial mount: fire page-1 gallery query and metadata endpoints immediately in parallel
  useEffect(() => {
    didInitGalleryRef.current = true;
    void fetchGallerySlice(filtersRef.current, { page: 1, pageSize: galleryPageSize });
    void loadMetadataAndEntities();
    return () => {
      cancelPendingGalleryQuery();
      metadataQuerySeqRef.current += 1;
      fullCatalogSeqRef.current += 1;
    };
  }, [fetchGallerySlice, loadMetadataAndEntities, cancelPendingGalleryQuery, galleryPageSize]);

  // Re-query page 1 whenever filters change (debounced for active search typing)
  const isFirstFilterEffectRef = useRef<boolean>(true);
  useEffect(() => {
    if (isFirstFilterEffectRef.current) {
      isFirstFilterEffectRef.current = false;
      prevQueryRef.current = filters.query;
      return;
    }

    const queryChanged = prevQueryRef.current !== filters.query;
    prevQueryRef.current = filters.query;

    setGalleryPage(1);
    setLoadedInfinitePages(1);
    loadedInfinitePagesRef.current = 1;

    const silent = imagesRef.current.length > 0;
    const delayMs = queryChanged && filters.query.trim().length > 0 ? 180 : 0;
    if (delayMs === 0) {
      void fetchGallerySlice(filters, { page: 1, pageSize: galleryPageSize, silent });
      return;
    }

    const timer = window.setTimeout(() => {
      void fetchGallerySlice(filters, { page: 1, pageSize: galleryPageSize, silent });
    }, delayMs);
    return () => {
      window.clearTimeout(timer);
    };
  }, [filters, fetchGallerySlice, galleryPageSize]);

  /** Appends the next server page (48 items) when Infinite Scroll reaches the bottom sentinel. */
  const loadMoreGalleryImages = useCallback(async (): Promise<ImageRecord[]> => {
    if (loadMoreInFlightRef.current) return [];
    const totalPages = Math.max(1, Math.ceil(totalImagesRef.current / galleryPageSize));
    const nextPage = loadedInfinitePagesRef.current + 1;
    if (nextPage > totalPages) return [];

    loadMoreInFlightRef.current = true;
    setIsLoadingMore(true);
    const activeSeq = galleryQuerySeqRef.current;
    const queryTicket = rejectionTrackerRef.current.beginQuery();

    try {
      const res = await api.queryImages({
        ...filtersRef.current,
        page: nextPage,
        pageSize: galleryPageSize,
      });
      if (activeSeq !== galleryQuerySeqRef.current) return [];

      const incoming = rejectionTrackerRef.current.reconcileFilteredImages(
        res.items || [],
        queryTicket.startEpoch,
        filtersRef.current.rejectedMode
      );
      const total = typeof res.total === 'number' ? res.total : totalImagesRef.current;

      setTotalImages(total);
      totalImagesRef.current = total;
      setLoadedInfinitePages(nextPage);
      loadedInfinitePagesRef.current = nextPage;
      setImages((prev) => {
        const seen = new Set(prev.map((i) => i.id));
        const appended = incoming.filter((i) => !seen.has(i.id));
        const merged = appended.length > 0 ? [...prev, ...appended] : prev;
        imagesRef.current = merged;
        return merged;
      });
      return incoming;
    } catch (err) {
      console.error('Failed to load next gallery page:', err);
      return [];
    } finally {
      rejectionTrackerRef.current.endQuery(queryTicket.queryId);
      loadMoreInFlightRef.current = false;
      setIsLoadingMore(false);
    }
  }, [galleryPageSize]);

  const refreshWorkspaceData = useCallback(async () => {
    setRefreshVersion((v) => v + 1);
    const currentFilters = filtersRef.current;
    const galleryPromise = infiniteScrollRef.current
      ? fetchGallerySlice(currentFilters, {
          page: 1,
          pageSize: Math.max(galleryPageSize, loadedInfinitePagesRef.current * galleryPageSize),
          silent: true,
        })
      : fetchGallerySlice(currentFilters, {
          page: galleryPageRef.current,
          pageSize: galleryPageSize,
          silent: true,
        });
    await Promise.allSettled([galleryPromise, loadMetadataAndEntities()]);
  }, [fetchGallerySlice, loadMetadataAndEntities, galleryPageSize]);

  const totalGalleryPages = Math.max(1, Math.ceil(totalImages / galleryPageSize));
  const currentGalleryPage = Math.min(Math.max(1, galleryPage), totalGalleryPages);
  const hasMoreGalleryImages = infiniteScroll
    ? images.length < totalImages
    : currentGalleryPage < totalGalleryPages;

  const handleInfiniteScrollChange = useCallback(
    (enabled: boolean) => {
      setInfiniteScroll(enabled);
      infiniteScrollRef.current = enabled;
      try {
        localStorage.setItem('couchy_gallery_infinite_scroll', String(enabled));
      } catch {
        // ignore storage errors
      }
      if (enabled) {
        const pagesToKeep = Math.min(Math.max(1, galleryPageRef.current), 3);
        setLoadedInfinitePages(pagesToKeep);
        loadedInfinitePagesRef.current = pagesToKeep;
        void fetchGallerySlice(filtersRef.current, {
          page: 1,
          pageSize: pagesToKeep * galleryPageSize,
          silent: true,
        });
      } else {
        setGalleryPage(1);
        setLoadedInfinitePages(1);
        loadedInfinitePagesRef.current = 1;
        void fetchGallerySlice(filtersRef.current, {
          page: 1,
          pageSize: galleryPageSize,
          silent: true,
        });
      }
    },
    [fetchGallerySlice, galleryPageSize]
  );

  const handleGalleryPageChange = useCallback(
    (nextPage: number) => {
      const totalPages = Math.max(1, Math.ceil(totalImagesRef.current / galleryPageSize));
      const clamped = Math.min(Math.max(1, nextPage), totalPages);
      setGalleryPage(clamped);
      galleryPageRef.current = clamped;
      window.scrollTo({ top: 0, behavior: 'smooth' });
      void fetchGallerySlice(filtersRef.current, {
        page: clamped,
        pageSize: galleryPageSize,
        silent: false,
      });
    },
    [fetchGallerySlice, galleryPageSize]
  );

  /**
   * Loads the previous or next gallery page when arrowing past a page boundary inside the Inspector,
   * returning the adjacent boundary card so chronological walkthrough continues seamlessly across pages.
   */
  const loadAdjacentPageForInspector = useCallback(
    async (direction: 'prev' | 'next'): Promise<ImageRecord | null> => {
      if (infiniteScrollRef.current) {
        if (direction === 'prev') return null;
        const appended = await loadMoreGalleryImages();
        return appended[0] || null;
      }

      const totalPages = Math.max(1, Math.ceil(totalImagesRef.current / galleryPageSize));
      const targetPage =
        direction === 'next' ? galleryPageRef.current + 1 : galleryPageRef.current - 1;
      if (targetPage < 1 || targetPage > totalPages) return null;

      setGalleryPage(targetPage);
      galleryPageRef.current = targetPage;
      const res = await fetchGallerySlice(filtersRef.current, {
        page: targetPage,
        pageSize: galleryPageSize,
        silent: true,
      });
      if (!res || res.items.length === 0) return null;
      return direction === 'next' ? res.items[0] : res.items[res.items.length - 1];
    },
    [fetchGallerySlice, galleryPageSize, loadMoreGalleryImages]
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
    totalImages,
    hasMoreGalleryImages,
    isLoadingImages,
    isLoadingMore,
    loadMoreGalleryImages,
    loadAdjacentPageForInspector,
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
    refreshVersion,
    loadMetadataAndEntities,
    refreshWorkspaceData,
    beginRejectMutation,
    settleRejectMutation,
  };
}
