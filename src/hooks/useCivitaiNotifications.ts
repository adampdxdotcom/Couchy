import { useCallback, useEffect, useMemo, useRef } from 'react';
import { api } from '../api/client.ts';
import type { CivitaiActivityAlertSummary } from '../shared/apiTypes.ts';
import type { AppToastMessage, ImageRecord } from '../shared/types.ts';

interface UseCivitaiNotificationsParams {
  allImages: ImageRecord[];
  isLoadingImages: boolean;
  notificationsEnabled: boolean;
  pushToast: (text: string, type?: AppToastMessage['type']) => void;
  onRefreshAll: () => Promise<void>;
  onOpenImage: (imageId: number) => void;
  onFilterGalleryUnseen: () => void;
}

/**
 * Computes persistent unseen Civitai activity from hydrated gallery records,
 * emits a session toast when background sync detects new reactions/comments,
 * and handles opening or dismissing the persistent header alert.
 */
export function useCivitaiNotifications({
  allImages,
  isLoadingImages,
  notificationsEnabled,
  pushToast,
  onRefreshAll,
  onOpenImage,
  onFilterGalleryUnseen,
}: UseCivitaiNotificationsParams) {
  const baselineReadyRef = useRef(false);
  const prevCountsRef = useRef<Map<number, { reactions: number; comments: number; unseen: boolean }>>(
    new Map()
  );

  const unseenImages = useMemo(
    () =>
      allImages.filter(
        (img) =>
          !img.isRejected &&
          !img.isArchived &&
          Boolean(img.civitaiShareSummary?.hasUnseenActivity)
      ),
    [allImages]
  );

  // Detect newly arrived Civitai reactions/comments after initial hydration and log to Recent Messages
  useEffect(() => {
    if (isLoadingImages) return;

    const nextMap = new Map<number, { reactions: number; comments: number; unseen: boolean }>();
    let newlyDetectedPosts = 0;

    for (const img of allImages) {
      const s = img.civitaiShareSummary;
      if (!s) continue;
      const reactions = Number(s.reactionCount || 0);
      const comments = Number(s.commentCount || 0);
      const unseen = Boolean(s.hasUnseenActivity);
      nextMap.set(img.id, { reactions, comments, unseen });

      if (baselineReadyRef.current && notificationsEnabled && !img.isRejected && !img.isArchived && unseen) {
        const prev = prevCountsRef.current.get(img.id);
        if (!prev || !prev.unseen || reactions > prev.reactions || comments > prev.comments) {
          newlyDetectedPosts += 1;
        }
      }
    }

    if (baselineReadyRef.current && newlyDetectedPosts > 0 && notificationsEnabled) {
      pushToast(
        newlyDetectedPosts === 1
          ? 'New Civitai activity on a shared post'
          : `New Civitai activity on ${newlyDetectedPosts} shared posts`,
        'warning'
      );
    }

    baselineReadyRef.current = true;
    prevCountsRef.current = nextMap;
  }, [allImages, isLoadingImages, notificationsEnabled, pushToast]);

  const civitaiAlert: CivitaiActivityAlertSummary | null = useMemo(() => {
    if (!notificationsEnabled || unseenImages.length === 0) return null;

    let reactionCount = 0;
    let commentCount = 0;
    for (const img of unseenImages) {
      reactionCount += Number(img.civitaiShareSummary?.reactionCount || 0);
      commentCount += Number(img.civitaiShareSummary?.commentCount || 0);
    }

    return {
      imageCount: unseenImages.length,
      singleImageId: unseenImages.length === 1 ? unseenImages[0].id : null,
      reactionCount,
      commentCount,
    };
  }, [notificationsEnabled, unseenImages]);

  const handleOpenCivitaiAlert = useCallback(() => {
    if (!civitaiAlert) return;
    if (civitaiAlert.imageCount === 1 && civitaiAlert.singleImageId) {
      onOpenImage(civitaiAlert.singleImageId);
      return;
    }
    onFilterGalleryUnseen();
  }, [civitaiAlert, onOpenImage, onFilterGalleryUnseen]);

  const handleDismissCivitaiAlert = useCallback(async () => {
    try {
      await api.markAllCivitaiShareSeen();
      await onRefreshAll();
    } catch (err: any) {
      pushToast(err?.message || 'Failed to mark Civitai activity as seen', 'error');
    }
  }, [onRefreshAll, pushToast]);

  return {
    civitaiAlert,
    handleOpenCivitaiAlert,
    handleDismissCivitaiAlert,
  };
}
