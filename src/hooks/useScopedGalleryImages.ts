import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api/client.ts';
import type { GalleryFilterState, ImageRecord } from '../shared/types.ts';

/**
 * Fetches a scoped subset of gallery images on demand for entity detail views
 * (Characters, LoRAs, Base Models, Workflows) instead of filtering a full global array.
 */
export function useScopedGalleryImages(
  filters: Partial<GalleryFilterState> | null,
  refreshVersion = 0
): {
  items: ImageRecord[];
  isLoading: boolean;
  reload: () => void;
} {
  const [items, setItems] = useState<ImageRecord[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(Boolean(filters));
  const [manualTick, setManualTick] = useState<number>(0);
  const seqRef = useRef<number>(0);

  const filterKey = filters ? JSON.stringify(filters) : '';

  const reload = useCallback(() => {
    setManualTick((t) => t + 1);
  }, []);

  useEffect(() => {
    if (!filterKey) {
      seqRef.current += 1;
      setItems([]);
      setIsLoading(false);
      return;
    }

    const parsed = JSON.parse(filterKey) as Partial<GalleryFilterState>;
    const seq = ++seqRef.current;
    const controller = new AbortController();
    setIsLoading(true);

    api
      .queryImages(parsed, { signal: controller.signal })
      .then((res) => {
        if (seq !== seqRef.current) return;
        setItems(res.items || []);
      })
      .catch((err: any) => {
        if (err?.name === 'AbortError' || seq !== seqRef.current) return;
        console.error('Failed to query scoped gallery images:', err);
      })
      .finally(() => {
        if (seq === seqRef.current) {
          setIsLoading(false);
        }
      });

    return () => {
      controller.abort();
    };
  }, [filterKey, refreshVersion, manualTick]);

  return { items, isLoading, reload };
}
