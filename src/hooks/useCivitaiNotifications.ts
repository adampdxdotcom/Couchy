import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api/client.ts';
import type {
  CivitaiActivityAlertSummary,
  CivitaiUnseenActivityItem,
} from '../shared/apiTypes.ts';
import type { AppToastMessage } from '../shared/types.ts';

interface UseCivitaiNotificationsParams {
  refreshVersion: number;
  notificationsEnabled: boolean;
  pushToast: (text: string, type?: AppToastMessage['type']) => void;
  onRefreshAll: () => Promise<void>;
  onOpenImage: (imageId: number) => void;
  onFilterGalleryUnseen: () => void;
}

/**
 * Fetches compact unseen Civitai activity directly from `/api/images/civitai-share/unseen`
 * without scanning the full gallery image list, emits a toast on newly detected activity,
 * and handles opening or dismissing the persistent header alert.
 */
export function useCivitaiNotifications({
  refreshVersion,
  notificationsEnabled,
  pushToast,
  onRefreshAll,
  onOpenImage,
  onFilterGalleryUnseen,
}: UseCivitaiNotificationsParams) {
  const [unseenItems, setUnseenItems] = useState<CivitaiUnseenActivityItem[]>([]);
  const baselineReadyRef = useRef(false);
  const prevCountsRef = useRef<Map<number, { reactions: number; comments: number }>>(new Map());

  useEffect(() => {
    if (!notificationsEnabled) {
      setUnseenItems([]);
      return;
    }

    let cancelled = false;
    api
      .getUnseenCivitaiActivity()
      .then((res) => {
        if (cancelled) return;
        const items = res.items || [];
        setUnseenItems(items);

        const nextMap = new Map<number, { reactions: number; comments: number }>();
        let newlyDetectedPosts = 0;

        for (const item of items) {
          const reactions = Number(item.reactionCount || 0);
          const comments = Number(item.commentCount || 0);
          nextMap.set(item.imageId, { reactions, comments });

          if (baselineReadyRef.current) {
            const prev = prevCountsRef.current.get(item.imageId);
            if (!prev || reactions > prev.reactions || comments > prev.comments) {
              newlyDetectedPosts += 1;
            }
          }
        }

        if (baselineReadyRef.current && newlyDetectedPosts > 0) {
          pushToast(
            newlyDetectedPosts === 1
              ? 'New Civitai activity on a shared post'
              : `New Civitai activity on ${newlyDetectedPosts} shared posts`,
            'warning'
          );
        }

        baselineReadyRef.current = true;
        prevCountsRef.current = nextMap;
      })
      .catch(() => {});

    return () => {
      cancelled = true;
    };
  }, [notificationsEnabled, refreshVersion, pushToast]);

  const civitaiAlert: CivitaiActivityAlertSummary | null = useMemo(() => {
    if (!notificationsEnabled || unseenItems.length === 0) return null;

    let reactionCount = 0;
    let commentCount = 0;
    for (const item of unseenItems) {
      reactionCount += Number(item.reactionCount || 0);
      commentCount += Number(item.commentCount || 0);
    }

    return {
      imageCount: unseenItems.length,
      singleImageId: unseenItems.length === 1 ? unseenItems[0].imageId : null,
      reactionCount,
      commentCount,
    };
  }, [notificationsEnabled, unseenItems]);

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
      setUnseenItems([]);
      prevCountsRef.current = new Map();
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
