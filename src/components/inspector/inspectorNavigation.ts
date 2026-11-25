import type { GalleryFilterState, ImageRecord, ImageSeriesItem } from '../../shared/types.ts';

export interface InspectorVisibilityFilter {
  sortBy: GalleryFilterState['sortBy'];
  rejectedMode: GalleryFilterState['rejectedMode'];
  archivedMode: GalleryFilterState['archivedMode'];
}

export const DEFAULT_INSPECTOR_VISIBILITY_FILTER: InspectorVisibilityFilter = {
  sortBy: 'newest',
  rejectedMode: 'exclude',
  archivedMode: 'exclude',
};

export type InspectorPhotoNavTarget =
  | {
      type: 'step';
      imageId: number;
      originalUrl: string;
    }
  | {
      type: 'card';
      cardId: number;
      iterationId: number;
      originalUrl: string;
    };

export interface InspectorNavigationTargets {
  prevPhoto: InspectorPhotoNavTarget | null;
  nextPhoto: InspectorPhotoNavTarget | null;
  prevStackCardId: number | null;
  nextStackCardId: number | null;
}

/**
 * Determines whether a photo/stack step is visible under the active rejected/archived filter.
 * Uploaded `Inspo` reference photos remain visible unless explicitly rejected or archived.
 */
export function isSeriesItemVisible(
  item: { isRejected?: boolean; isArchived?: boolean },
  filter: InspectorVisibilityFilter = DEFAULT_INSPECTOR_VISIBILITY_FILTER
): boolean {
  const rejected = Boolean(item.isRejected);
  const archived = Boolean(item.isArchived);

  if (filter.rejectedMode === 'exclude' && rejected) return false;
  if (filter.rejectedMode === 'only' && !rejected) return false;
  if (filter.archivedMode === 'exclude' && archived) return false;
  if (filter.archivedMode === 'only' && !archived) return false;
  return true;
}

/**
 * Orders stack steps chronologically to match the gallery sort direction:
 * oldest-first (`stepOrder ASC`) when `sortBy === 'oldest'`, otherwise newest-first (`stepOrder DESC`).
 */
export function orderSeriesItemsChronologically(
  seriesItems: ImageSeriesItem[] | undefined,
  sortBy: GalleryFilterState['sortBy'] = 'newest'
): ImageSeriesItem[] {
  if (!seriesItems || seriesItems.length === 0) return [];
  const asc = sortBy === 'oldest';
  return [...seriesItems].sort((a, b) => {
    const stepDiff = a.stepOrder - b.stepOrder;
    if (stepDiff !== 0) return asc ? stepDiff : -stepDiff;
    return asc ? a.imageId - b.imageId : b.imageId - a.imageId;
  });
}

/**
 * Returns only non-hidden steps of a stack ordered chronologically.
 */
export function getOrderedVisibleSeriesItems(
  seriesItems: ImageSeriesItem[] | undefined,
  filter: InspectorVisibilityFilter = DEFAULT_INSPECTOR_VISIBILITY_FILTER
): ImageSeriesItem[] {
  return orderSeriesItemsChronologically(seriesItems, filter.sortBy).filter((item) =>
    isSeriesItemVisible(item, filter)
  );
}

/**
 * Picks the entry photo when crossing into an adjacent gallery card via Left/Right arrows.
 * Moving forward lands on the card's first chronological photo; moving backward lands on its last.
 */
function resolveCardEntryPhoto(
  card: ImageRecord,
  edge: 'first' | 'last',
  filter: InspectorVisibilityFilter
): Extract<InspectorPhotoNavTarget, { type: 'card' }> | null {
  if (card.seriesItems && card.seriesItems.length > 0) {
    const visible = getOrderedVisibleSeriesItems(card.seriesItems, filter);
    if (visible.length > 0) {
      const chosen = edge === 'first' ? visible[0] : visible[visible.length - 1];
      return {
        type: 'card',
        cardId: card.id,
        iterationId: chosen.imageId,
        originalUrl: chosen.originalUrl,
      };
    }
    if (!isSeriesItemVisible(card, filter)) return null;
    return {
      type: 'card',
      cardId: card.id,
      iterationId: card.id,
      originalUrl: card.originalUrl,
    };
  }

  if (!isSeriesItemVisible(card, filter)) return null;
  return {
    type: 'card',
    cardId: card.id,
    iterationId: card.id,
    originalUrl: card.originalUrl,
  };
}

/**
 * Resolves chronological photo-by-photo targets (`←` / `→`) across stacks and standalone cards,
 * plus direct stack-jump targets (`[` / `]`) that land on adjacent collapsed card posters.
 */
export function resolveInspectorNavigationTargets(params: {
  activeImageId: number;
  activeSeriesItems?: ImageSeriesItem[];
  cardImageId: number;
  galleryCards: ImageRecord[];
  filter?: InspectorVisibilityFilter;
}): InspectorNavigationTargets {
  const {
    activeImageId,
    activeSeriesItems,
    cardImageId,
    galleryCards,
    filter = DEFAULT_INSPECTOR_VISIBILITY_FILTER,
  } = params;

  let prevPhoto: InspectorPhotoNavTarget | null = null;
  let nextPhoto: InspectorPhotoNavTarget | null = null;

  // 1. Step chronologically through visible items inside the current stack first
  const orderedAll = orderSeriesItemsChronologically(activeSeriesItems, filter.sortBy);
  if (orderedAll.length > 1) {
    const orderedVisible = orderedAll.filter((it) => isSeriesItemVisible(it, filter));
    const visibleIdx = orderedVisible.findIndex((it) => it.imageId === activeImageId);

    if (visibleIdx >= 0) {
      if (visibleIdx > 0) {
        const prev = orderedVisible[visibleIdx - 1];
        prevPhoto = { type: 'step', imageId: prev.imageId, originalUrl: prev.originalUrl };
      }
      if (visibleIdx < orderedVisible.length - 1) {
        const next = orderedVisible[visibleIdx + 1];
        nextPhoto = { type: 'step', imageId: next.imageId, originalUrl: next.originalUrl };
      }
    } else {
      // If viewing a currently hidden step (e.g. manually clicked from stack strip), find nearest visible neighbors
      const allIdx = orderedAll.findIndex((it) => it.imageId === activeImageId);
      if (allIdx >= 0) {
        for (let i = allIdx - 1; i >= 0; i--) {
          if (isSeriesItemVisible(orderedAll[i], filter)) {
            prevPhoto = {
              type: 'step',
              imageId: orderedAll[i].imageId,
              originalUrl: orderedAll[i].originalUrl,
            };
            break;
          }
        }
        for (let i = allIdx + 1; i < orderedAll.length; i++) {
          if (isSeriesItemVisible(orderedAll[i], filter)) {
            nextPhoto = {
              type: 'step',
              imageId: orderedAll[i].imageId,
              originalUrl: orderedAll[i].originalUrl,
            };
            break;
          }
        }
      }
    }
  }

  // 2. Roll into adjacent gallery cards when reaching the edge of the current stack (or standalone photo)
  let cardIdx = galleryCards.findIndex((c) => c.id === cardImageId);
  if (cardIdx < 0) {
    cardIdx = galleryCards.findIndex((c) =>
      c.seriesItems?.some((si) => si.imageId === activeImageId)
    );
  }

  let prevStackCardId: number | null = null;
  let nextStackCardId: number | null = null;

  if (cardIdx >= 0) {
    prevStackCardId = cardIdx > 0 ? galleryCards[cardIdx - 1].id : null;
    nextStackCardId = cardIdx < galleryCards.length - 1 ? galleryCards[cardIdx + 1].id : null;

    if (!prevPhoto) {
      for (let i = cardIdx - 1; i >= 0; i--) {
        const candidate = resolveCardEntryPhoto(galleryCards[i], 'last', filter);
        if (candidate) {
          prevPhoto = candidate;
          break;
        }
      }
    }

    if (!nextPhoto) {
      for (let i = cardIdx + 1; i < galleryCards.length; i++) {
        const candidate = resolveCardEntryPhoto(galleryCards[i], 'first', filter);
        if (candidate) {
          nextPhoto = candidate;
          break;
        }
      }
    }
  }

  return {
    prevPhoto,
    nextPhoto,
    prevStackCardId,
    nextStackCardId,
  };
}
