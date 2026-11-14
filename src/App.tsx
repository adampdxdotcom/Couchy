/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from './api/client.ts';
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
import { resolveClosestAspectRatio } from './shared/utils.ts';
import type {
  AppToastMessage,
  CharacterProfile,
  ComfyUiLiveStatus,
  GalleryFilterState,
  ImageRecord,
  LoraExplorerItem,
  ModelInventoryItem,
  QuickGenChatMessage,
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
  const [systemSubTab, setSystemSubTab] = useState<SystemSubTab>('tagger');
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [layout, setLayout] = useState<GalleryViewLayout>('standard');
  const [thumbScale, setThumbScale] = useState<'sm' | 'md' | 'lg'>('md');
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
  const [selectedCharacterId, setSelectedCharacterId] = useState<number | null>(null);
  const [quickGenPrefill, setQuickGenPrefill] = useState<QuickGenPrefill | null>(null);

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
  const [lmStudioStatus, setLmStudioStatus] = useState<{
    online: boolean;
    selectedModel: string;
    baseUrl: string;
  }>({
    online: false,
    selectedModel: '',
    baseUrl: '',
  });
  const prevLmStudioOnlineRef = useRef<boolean | null>(null);
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
    // Prioritize querying gallery images immediately to render cards/skeletons without waiting for secondary metadata
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

    // Secondary metadata runs concurrently in the background without blocking image presentation
    const metaPromise = Promise.allSettled([
      api.getHealth(),
      api.getOrganizationMeta(),
      api.listCharacters(),
      api.listLoras(),
      api.listModelInventory(),
      api.listWorkflows(),
    ]).then(([healthRes, orgMetaRes, charRes, loraRes, modelRes, wfRes]) => {
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

  const allImageIdsRef = useRef<Set<number>>(new Set());
  const allImagesRef = useRef<ImageRecord[]>([]);
  const charactersRef = useRef<CharacterProfile[]>([]);
  const lastSeenErrorIdRef = useRef<string | null>(null);

  useEffect(() => {
    allImagesRef.current = allImages;
    const ids = new Set<number>();
    for (const img of allImages) {
      ids.add(img.id);
      if (img.seriesItems) {
        for (const si of img.seriesItems) {
          ids.add(si.imageId);
        }
      }
    }
    allImageIdsRef.current = ids;
  }, [allImages]);

  useEffect(() => {
    charactersRef.current = characters;
  }, [characters]);

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

  // Filter out ghost cards as soon as their indexed image (or stacked iteration) is present in allImages
  const activeGhostItems = useMemo(() => {
    const raw = comfyStatus.ghostItems || [];
    if (raw.length === 0) return [];
    const knownIds = new Set<number>();
    for (const img of allImages) {
      knownIds.add(img.id);
      if (img.seriesItems) {
        for (const si of img.seriesItems) {
          knownIds.add(si.imageId);
        }
      }
    }
    return raw.filter((g) => !g.outputImageId || !knownIds.has(g.outputImageId));
  }, [comfyStatus.ghostItems, allImages]);

  const refreshAll = useCallback(async () => {
    api.getComfyUiLiveStatus().then(setComfyStatus).catch(() => {});
    await loadMetadataAndEntities();
    if (!isDefaultFilters(filters)) {
      await loadFilteredImages();
    }
  }, [loadMetadataAndEntities, loadFilteredImages, filters]);

  // Poll ComfyUI live queue & job progress percentage
  const [hasUnseenCompletion, setHasUnseenCompletion] = useState<boolean>(false);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const poll = async () => {
      try {
        const status = await api.getComfyUiLiveStatus();
        if (cancelled) return;
        setComfyStatus(status);

        // Surface ComfyUI execution failures (e.g. disk full, OOM) and auto-restore failed Conversation turns
        if (status.lastError && status.lastError.id !== lastSeenErrorIdRef.current) {
          lastSeenErrorIdRef.current = status.lastError.id;
          const rec = status.lastError.recovery;
          if (rec && rec.chatMessages && rec.chatMessages.length > 0) {
            const matchedChar = rec.characterId
              ? charactersRef.current.find((c) => c.id === rec.characterId) || null
              : null;
            const sourceImg = rec.branchFromImageId
              ? allImagesRef.current.find((img) => img.id === rec.branchFromImageId) || null
              : null;
            const latestExcludedMsg = [...rec.chatMessages]
              .reverse()
              .find((m) => Array.isArray(m.excludedLoras) && m.excludedLoras.length > 0);

            setQuickGenPrefill({
              prompt: '',
              character: matchedChar,
              loras: sourceImg?.loras || [],
              excludedLoras: latestExcludedMsg?.excludedLoras || [],
              aspectRatio: rec.aspectRatio,
              megapixels: rec.megapixels,
              batchCount: 1,
              conversationMode: true,
              chatMessages: rec.chatMessages,
              seriesId: rec.seriesId,
              branchFromImageId: rec.branchFromImageId,
              timestamp: Date.now(),
            });
            pushToast(
              `ComfyUI error (${status.lastError.message}) — Conversation restored in Quick Gen`,
              'error'
            );
          } else {
            pushToast(`ComfyUI generation failed: ${status.lastError.message}`, 'error');
          }
          refreshAll();
        }

        const hasUnindexedGhost = (status.ghostItems || []).some(
          (g) =>
            g.state === 'indexing' &&
            (!g.outputImageId || !allImageIdsRef.current.has(g.outputImageId))
        );

        // Silently refresh gallery as soon as any newly generated image is indexed
        if (
          (status.lastIndexedAt && status.lastIndexedAt > lastIndexedAtRef.current) ||
          hasUnindexedGhost
        ) {
          if (status.lastIndexedAt) {
            lastIndexedAtRef.current = status.lastIndexedAt;
          }
          refreshAll();
        }

        const isBusy =
          status.runningCount > 0 ||
          status.queuedCount > 0 ||
          (status.ghostItems && status.ghostItems.length > 0);
        if (status.runningCount > 0 || status.queuedCount > 0) {
          setHasUnseenCompletion(false);
        } else if (prevBusyRef.current && status.runningCount === 0 && status.queuedCount === 0) {
          // Run just completed: if the user is not actively viewing the tab, show "Couchy (Done)"
          if (document.hidden || !document.hasFocus()) {
            setHasUnseenCompletion(true);
          }
          refreshAll();
        }
        prevBusyRef.current = status.runningCount > 0 || status.queuedCount > 0;

        timer = setTimeout(poll, isBusy ? 1000 : 3500);
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

  // Clear "Couchy (Done)" immediately when the user focuses or makes the tab visible
  useEffect(() => {
    const clearIfVisible = () => {
      if (!document.hidden) {
        setHasUnseenCompletion(false);
      }
    };
    window.addEventListener('focus', clearIfVisible);
    document.addEventListener('visibilitychange', clearIfVisible);
    return () => {
      window.removeEventListener('focus', clearIfVisible);
      document.removeEventListener('visibilitychange', clearIfVisible);
    };
  }, []);

  // Synchronize browser tab title with live generation progress and unseen completion state
  useEffect(() => {
    const isBusy = comfyStatus.runningCount > 0 || comfyStatus.queuedCount > 0;
    if (isBusy) {
      const total =
        comfyStatus.totalRunJobs ?? comfyStatus.runningCount + comfyStatus.queuedCount;
      const current = comfyStatus.currentJobIndex ?? 1;
      const pct = comfyStatus.progressPercent ?? 0;
      document.title = `Couchy (${current} of ${total} - ${pct}%)`;
    } else if (hasUnseenCompletion) {
      document.title = 'Couchy (Done)';
    } else {
      document.title = 'Couchy';
    }
  }, [comfyStatus, hasUnseenCompletion]);

  // Poll LM Studio connection every 15s; alert on state transitions after initial check
  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const pollLmStudio = async () => {
      try {
        const res = await api.getLmStudioStatus();
        if (cancelled) return;

        setLmStudioStatus({
          online: Boolean(res.online),
          selectedModel: res.selectedModel || '',
          baseUrl: res.baseUrl || '',
        });

        const prev = prevLmStudioOnlineRef.current;
        if (prev !== null) {
          if (prev === true && !res.online) {
            pushToast('LM Studio Offline', 'warning');
          } else if (prev === false && res.online) {
            pushToast('LM Studio Reconnected', 'success');
          }
        }
        prevLmStudioOnlineRef.current = Boolean(res.online);
      } catch {
        if (cancelled) return;
        const prev = prevLmStudioOnlineRef.current;
        if (prev !== null && prev === true) {
          pushToast('LM Studio Offline', 'warning');
        }
        prevLmStudioOnlineRef.current = false;
        setLmStudioStatus((prevStatus) => ({ ...prevStatus, online: false }));
      } finally {
        if (!cancelled) {
          timer = setTimeout(pollLmStudio, 15000);
        }
      }
    };

    pollLmStudio();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [pushToast]);

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

  const handleReusePrompt = useCallback(
    (img: ImageRecord) => {
      // Find character profile associated with image
      const confirmedCharLink = img.characters.find((c) => c.status === 'confirmed');
      const firstCharLink = confirmedCharLink || img.characters[0];
      const matchedChar = firstCharLink
        ? characters.find((c) => c.id === firstCharLink.characterId) || null
        : null;

      // Extract and format prompt text cleanly
      let promptText = (img.positivePrompt || '').trim();
      if (!promptText && matchedChar?.name) {
        promptText = `portrait of ${matchedChar.name}`;
      }

      // Calculate matching aspect ratio preset from dimensions
      const targetRatio = resolveClosestAspectRatio(img.width, img.height);

      setQuickGenPrefill({
        prompt: promptText,
        character: matchedChar,
        loras: img.loras || [],
        aspectRatio: targetRatio,
        batchCount: 1,
        timestamp: Date.now(),
      });

      const charLabel = matchedChar ? ` with ${matchedChar.name}` : '';
      const loraCount = img.loras?.length || 0;
      const loraLabel = loraCount > 0 ? ` + ${loraCount} LoRA(s)` : '';
      pushToast(`Reused prompt${charLabel}${loraLabel} (${targetRatio}, 1 image) in Quick Gen`, 'success');
    },
    [characters, pushToast]
  );

  const handleClearQuickGenPrefill = useCallback(() => {
    setQuickGenPrefill(null);
  }, []);

  const handleOpenConversationForImage = useCallback(
    (img: ImageRecord) => {
      if (!lmStudioStatus.online) {
        pushToast('LM Studio is offline — start LM Studio to use Conversation mode.', 'warning');
        return;
      }

      const confirmedCharLink = img.characters.find((c) => c.status === 'confirmed');
      const firstCharLink = confirmedCharLink || img.characters[0];
      const matchedChar = firstCharLink
        ? characters.find((c) => c.id === firstCharLink.characterId) || null
        : null;

      const targetRatio = resolveClosestAspectRatio(img.width, img.height);
      const targetMp =
        img.width > 0 && img.height > 0
          ? Math.max(0.5, Math.min(10.0, Math.round(((img.width * img.height) / 1_000_000) * 2) / 2))
          : undefined;

      let initialChatMessages: QuickGenChatMessage[] = [];
      if (img.chatSnapshot && img.chatSnapshot.length > 0) {
        initialChatMessages = img.chatSnapshot;
      } else {
        const promptText = (img.positivePrompt || '').trim();
        if (promptText) {
          initialChatMessages = [
            {
              id: `seed-${img.id}`,
              role: 'assistant',
              content: 'Loaded prompt from this image. How would you like to iterate on it?',
              proposedPrompt: promptText,
            },
          ];
        }
      }

      const latestExcludedMsg = [...initialChatMessages]
        .reverse()
        .find((m) => Array.isArray(m.excludedLoras) && m.excludedLoras.length > 0);

      setQuickGenPrefill({
        prompt: '',
        character: matchedChar,
        loras: img.loras || [],
        excludedLoras: latestExcludedMsg?.excludedLoras || [],
        aspectRatio: targetRatio,
        megapixels: targetMp,
        batchCount: 1,
        conversationMode: true,
        chatMessages: initialChatMessages,
        seriesId: img.seriesId ?? null,
        branchFromImageId: img.id,
        timestamp: Date.now(),
      });

      setInspectedImageId(null);
      if (activeTab === 'generation') {
        setActiveTab('gallery');
      }
      pushToast(
        img.seriesId
          ? 'Reopened image series conversation in Quick Gen'
          : 'Started Conversation stack from image in Quick Gen',
        'info'
      );
    },
    [activeTab, characters, lmStudioStatus.online, pushToast]
  );

  const handleQuickFavorite = useCallback(
    async (id: number, isFavorite: boolean) => {
      const favoritedAt = isFavorite ? new Date().toISOString() : null;
      const targetImg = allImages.find((img) => img.id === id);
      setImages((prev) =>
        prev.map((img) => (img.id === id ? { ...img, isFavorite, favoritedAt } : img))
      );
      setAllImages((prev) =>
        prev.map((img) => (img.id === id ? { ...img, isFavorite, favoritedAt } : img))
      );
      await api.updateImageAnnotations(id, { isFavorite });
      if ((targetImg?.seriesCount || 1) > 1) {
        await refreshAll();
      }
      pushToast(isFavorite ? 'Added to Favorites' : 'Removed from Favorites', 'info');
    },
    [allImages, pushToast, refreshAll]
  );

  const handleQuickReject = useCallback(
    async (id: number, nextRejected: boolean) => {
      setAllImages((prev) =>
        prev.map((img) => (img.id === id ? { ...img, isRejected: nextRejected } : img))
      );
      setImages((prev) => {
        if (filters.rejectedMode === 'exclude' && nextRejected) {
          return prev.filter((img) => img.id !== id);
        }
        if (filters.rejectedMode === 'only' && !nextRejected) {
          return prev.filter((img) => img.id !== id);
        }
        return prev.map((img) => (img.id === id ? { ...img, isRejected: nextRejected } : img));
      });
      try {
        await api.updateImageAnnotations(id, { isRejected: nextRejected });
        pushToast(
          nextRejected
            ? 'Image rejected (hidden from standard library)'
            : 'Image restored from rejected',
          'info'
        );
      } catch (err: any) {
        console.error('Failed to update rejection status:', err);
        pushToast('Failed to update rejection status', 'error');
        refreshAll();
      }
    },
    [filters.rejectedMode, pushToast, refreshAll]
  );

  const inspectedImage =
    images.find((i) => i.id === inspectedImageId) ||
    allImages.find((i) => i.id === inspectedImageId) ||
    null;

  const inspectedIdx = images.findIndex((i) => i.id === inspectedImageId);
  const showQuickGenBar =
    healthData?.config?.quickGenBoxEnabled !== false && activeTab !== 'generation';

  return (
    <div className="min-h-screen w-full max-w-full overflow-x-hidden bg-zinc-950 text-zinc-100 flex flex-col">
      {/* 3-Zone Top Bar with Unified Status & Toast Message Area */}
      <TopNavHeader
        activeTab={activeTab}
        onSelectTab={(tab) => {
          if (tab === 'characters') {
            setSelectedCharacterId(null);
          }
          setActiveTab(tab);
          setIsMobileMenuOpen(false);
        }}
        comfyStatus={comfyStatus}
        activeToast={activeToast}
        messages={messages}
        onClearMessages={() => {
          setMessages([]);
          setActiveToast(null);
        }}
        isMobileMenuOpen={isMobileMenuOpen}
        onMobileMenuOpenChange={setIsMobileMenuOpen}
        lmStudioStatus={lmStudioStatus}
      />

      {/* Main Content Area */}
      <main className={`flex-1 w-full max-w-full min-w-0 overflow-x-hidden ${showQuickGenBar ? 'pb-36 md:pb-28' : ''}`}>
        {activeTab === 'gallery' && (
          <>
            <GalleryFilterBar
              filters={filters}
              onChange={(nextFilters) => {
                setGalleryPage(1);
                setFilters(nextFilters);
              }}
              onReset={() => {
                setGalleryPage(1);
                setFilters(INITIAL_FILTERS);
              }}
              layout={layout}
              onLayoutChange={setLayout}
              thumbScale={thumbScale}
              onThumbScaleChange={setThumbScale}
              totalMatching={images.length}
              page={currentGalleryPage}
              totalPages={totalGalleryPages}
              onPageChange={handleGalleryPageChange}
              infiniteScroll={infiniteScroll}
              onInfiniteScrollChange={handleInfiniteScrollChange}
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
              isHiddenOnMobile={isMobileMenuOpen}
            />

            <GalleryGridView
              images={images}
              loras={loras}
              ghostItems={activeGhostItems}
              filters={filters}
              page={currentGalleryPage}
              pageSize={galleryPageSize}
              infiniteScroll={infiniteScroll}
              isLoading={isLoadingImages}
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
              onOpenCharacterGallery={(charId) => {
                setSelectedCharacterId(charId);
                setActiveTab('characters');
                window.scrollTo({ top: 0, behavior: 'smooth' });
              }}
              onReusePrompt={handleReusePrompt}
              onOpenConversation={handleOpenConversationForImage}
              onQuickRate={async (id, rating) => {
                setImages((prev) => prev.map((img) => (img.id === id ? { ...img, rating } : img)));
                setAllImages((prev) =>
                  prev.map((img) => (img.id === id ? { ...img, rating } : img))
                );
                await api.updateImageAnnotations(id, { rating });
                pushToast(rating > 0 ? `Rated image ★ ${rating}` : 'Cleared image rating', 'info');
              }}
              onQuickFavorite={handleQuickFavorite}
              onQuickReject={handleQuickReject}
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
              onOpenSystemSettings={() => {
                setSystemSubTab('comfyui');
                setActiveTab('system');
              }}
            />
          </>
        )}

        {activeTab === 'characters' && (
          <CharacterExplorerView
            characters={characters}
            allImages={allImages}
            ghostItems={activeGhostItems}
            loras={loras}
            workflows={workflows}
            collections={collections}
            selectedCharacterId={selectedCharacterId}
            onSelectCharacterId={setSelectedCharacterId}
            onRefresh={refreshAll}
            onOpenImage={(img) => setInspectedImageId(img.id)}
            onFilterGalleryByCharacter={(charId) => {
              setGalleryPage(1);
              setFilters({ ...INITIAL_FILTERS, characterIds: [charId] });
              setActiveTab('gallery');
            }}
            onReusePrompt={handleReusePrompt}
            onOpenConversation={handleOpenConversationForImage}
            onQuickRate={async (id, rating) => {
              setImages((prev) => prev.map((img) => (img.id === id ? { ...img, rating } : img)));
              setAllImages((prev) =>
                prev.map((img) => (img.id === id ? { ...img, rating } : img))
              );
              await api.updateImageAnnotations(id, { rating });
              pushToast(rating > 0 ? `Rated image ★ ${rating}` : 'Cleared image rating', 'info');
            }}
            onQuickFavorite={handleQuickFavorite}
            onQuickReject={handleQuickReject}
            onPushToast={pushToast}
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
            onOpenSystemSettings={() => {
              setSystemSubTab('lm_studio');
              setActiveTab('system');
            }}
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
            onPushToast={pushToast}
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
            onRefreshAll={refreshAll}
            initialSubTab={systemSubTab}
          />
        )}
      </main>

      {/* Floating Quick Generation Bar (Visible across all tabs when enabled) */}
      {showQuickGenBar && (
        <FloatingQuickGenBar
          characters={characters}
          loras={loras}
          allImages={allImages}
          workflows={workflows}
          prefillPayload={quickGenPrefill}
          onClearPrefill={handleClearQuickGenPrefill}
          onRefreshAll={refreshAll}
          onPushToast={pushToast}
          lmStudioOnline={lmStudioStatus.online}
        />
      )}

      {/* Full-Resolution Lightbox & Inspector Drawer */}
      {inspectedImage && (
        <ImageInspectorDrawer
          image={inspectedImage}
          allImages={allImages}
          loras={loras}
          ghostItems={activeGhostItems}
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
          onOpenConversation={handleOpenConversationForImage}
          onReusePrompt={handleReusePrompt}
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
