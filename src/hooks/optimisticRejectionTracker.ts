import type { GalleryFilterState, ImageRecord } from '../shared/types.ts';

interface PendingRejectionEntry {
  isRejected: boolean;
  inFlight: boolean;
  resolvedAtEpoch: number;
  token: number;
}

export interface QueryTicket {
  queryId: number;
  startEpoch: number;
}

/**
 * Tracks optimistic reject/restore mutations against concurrent `queryImages` requests
 * so stale in-flight snapshots cannot temporarily resurrect a just-rejected image.
 */
export class OptimisticRejectionTracker {
  private mutationEpoch = 0;
  private nextToken = 1;
  private nextQueryId = 1;
  private pending = new Map<number, PendingRejectionEntry>();
  private activeQueries = new Map<number, number>();

  beginMutation(imageId: number, isRejected: boolean): number {
    this.mutationEpoch += 1;
    const token = this.nextToken++;
    this.pending.set(imageId, {
      isRejected,
      inFlight: true,
      resolvedAtEpoch: Infinity,
      token,
    });
    return token;
  }

  settleMutation(imageId: number, token: number, committed: boolean): void {
    const current = this.pending.get(imageId);
    if (!current || current.token !== token) return;

    if (!committed) {
      this.pending.delete(imageId);
      return;
    }

    this.mutationEpoch += 1;
    const resolvedAtEpoch = this.mutationEpoch;
    const hasEarlierActiveQuery = this.hasQueryStartedBefore(resolvedAtEpoch);

    if (!hasEarlierActiveQuery) {
      this.pending.delete(imageId);
      return;
    }

    this.pending.set(imageId, {
      ...current,
      inFlight: false,
      resolvedAtEpoch,
    });
  }

  beginQuery(): QueryTicket {
    const queryId = this.nextQueryId++;
    const startEpoch = this.mutationEpoch;
    this.activeQueries.set(queryId, startEpoch);
    return { queryId, startEpoch };
  }

  endQuery(queryId: number): void {
    this.activeQueries.delete(queryId);
    this.pruneSettled();
  }

  /**
   * Patches unfiltered `allImages` results with any optimistic rejection whose mutation
   * was still in flight or settled after the query started.
   */
  reconcileAllImages(items: ImageRecord[], queryStartEpoch: number): ImageRecord[] {
    const overrides = this.collectApplicableOverrides(queryStartEpoch);
    if (overrides.size === 0) return items;

    return items.map((img) => {
      const nextRejected = overrides.get(img.id);
      return nextRejected === undefined || img.isRejected === nextRejected
        ? img
        : { ...img, isRejected: nextRejected };
    });
  }

  /**
   * Patches filtered `images` results so a stale query cannot re-insert an optimistically
   * rejected image into `rejectedMode === 'exclude'` (or keep a restored one in `'only'`).
   */
  reconcileFilteredImages(
    items: ImageRecord[],
    queryStartEpoch: number,
    rejectedMode: GalleryFilterState['rejectedMode']
  ): ImageRecord[] {
    const overrides = this.collectApplicableOverrides(queryStartEpoch);
    if (overrides.size === 0) return items;

    const result: ImageRecord[] = [];
    for (const img of items) {
      const nextRejected = overrides.get(img.id);
      if (nextRejected === undefined) {
        result.push(img);
        continue;
      }
      if (rejectedMode === 'exclude' && nextRejected) continue;
      if (rejectedMode === 'only' && !nextRejected) continue;
      result.push(img.isRejected === nextRejected ? img : { ...img, isRejected: nextRejected });
    }
    return result;
  }

  private collectApplicableOverrides(queryStartEpoch: number): Map<number, boolean> {
    const overrides = new Map<number, boolean>();
    for (const [imageId, entry] of this.pending.entries()) {
      if (entry.inFlight || queryStartEpoch < entry.resolvedAtEpoch) {
        overrides.set(imageId, entry.isRejected);
      }
    }
    return overrides;
  }

  private hasQueryStartedBefore(epoch: number): boolean {
    for (const startEpoch of this.activeQueries.values()) {
      if (startEpoch < epoch) return true;
    }
    return false;
  }

  private pruneSettled(): void {
    let minActiveStartEpoch = Infinity;
    for (const startEpoch of this.activeQueries.values()) {
      if (startEpoch < minActiveStartEpoch) {
        minActiveStartEpoch = startEpoch;
      }
    }

    for (const [imageId, entry] of this.pending.entries()) {
      if (!entry.inFlight && entry.resolvedAtEpoch <= minActiveStartEpoch) {
        this.pending.delete(imageId);
      }
    }
  }
}
