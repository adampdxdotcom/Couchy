import React, { useEffect, useState } from 'react';
import { api } from '../api/client.ts';
import type {
  CharacterProfile,
  ImageRecord,
  LoraExplorerItem,
  QueuedGhostCardItem,
  WorkflowLibraryItem,
} from '../shared/types.ts';
import { CharacterRosterView } from './character/CharacterRosterView.tsx';
import { CharacterProfileHeader } from './character/CharacterProfileHeader.tsx';
import { CharacterLorasAndWorkflows } from './character/CharacterLorasAndWorkflows.tsx';
import { CharacterSuggestionsReview } from './character/CharacterSuggestionsReview.tsx';
import { CharacterGallerySection } from './character/CharacterGallerySection.tsx';
import { CreateCharacterModal } from './character/CreateCharacterModal.tsx';
import { MergeCharactersModal } from './character/MergeCharactersModal.tsx';

interface CharacterExplorerViewProps {
  characters: CharacterProfile[];
  allImages: ImageRecord[];
  ghostItems?: QueuedGhostCardItem[];
  loras: LoraExplorerItem[];
  workflows: WorkflowLibraryItem[];
  collections: { id: number; name: string }[];
  selectedCharacterId?: number | null;
  onSelectCharacterId?: (id: number | null) => void;
  onRefresh: () => Promise<void>;
  onOpenImage: (img: ImageRecord) => void;
  onFilterGalleryByCharacter: (charId: number) => void;
  onQuickRate: (id: number, rating: number) => void;
  onQuickFavorite?: (id: number, nextFav: boolean) => void;
  onReusePrompt?: (img: ImageRecord) => void;
  onQuickReject?: (id: number, nextRejected: boolean) => void;
  onPushToast?: (text: string, type?: 'info' | 'success' | 'warning' | 'error') => void;
}

/**
 * Dedicated First-Class Character Explorer & Profile Manager.
 */
export const CharacterExplorerView: React.FC<CharacterExplorerViewProps> = ({
  characters,
  allImages,
  ghostItems = [],
  loras,
  workflows,
  collections,
  selectedCharacterId: controlledCharId,
  onSelectCharacterId,
  onRefresh,
  onOpenImage,
  onFilterGalleryByCharacter,
  onQuickRate,
  onQuickFavorite,
  onReusePrompt,
  onQuickReject,
  onPushToast,
}) => {
  const [internalCharId, setInternalCharId] = useState<number | null>(null);
  const selectedCharId = controlledCharId !== undefined ? controlledCharId : internalCharId;
  const setSelectedCharId = (nextId: number | null) => {
    setInternalCharId(nextId);
    onSelectCharacterId?.(nextId);
  };
  const [isHighestRatedExpanded, setIsHighestRatedExpanded] = useState(false);
  const [optimisticPortraitId, setOptimisticPortraitId] = useState<number | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showMergeModal, setShowMergeModal] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [selectedSuggestedIds, setSelectedSuggestedIds] = useState<Set<number>>(new Set());

  useEffect(() => {
    setIsHighestRatedExpanded(false);
    setOptimisticPortraitId(null);
    setSelectedSuggestedIds(new Set());
  }, [selectedCharId]);

  useEffect(() => {
    setOptimisticPortraitId(null);
  }, [characters]);

  const selectedCharacter = characters.find((c) => c.id === selectedCharId) || null;

  const handleCreateCharacter = async (data: {
    name: string;
    aliases: string[];
    description: string;
    notes: string;
  }) => {
    await api.createCharacter(data);
    await onRefresh();
  };

  const handleMergeCharacters = async (targetId: number, sourceId: number) => {
    await api.mergeCharacters(targetId, sourceId);
    await onRefresh();
    setStatusMessage('Characters merged non-destructively.');
    setTimeout(() => setStatusMessage(null), 3000);
  };

  const handleRunSuggestions = async () => {
    const res = await api.runCharacterSuggestions();
    await onRefresh();
    setStatusMessage(`Assisted identification complete: ${res.newSuggestions} new suggestion(s) found.`);
    setTimeout(() => setStatusMessage(null), 3500);
  };

  const handleSetPortrait = async (img: ImageRecord) => {
    if (!selectedCharacter) return;
    setOptimisticPortraitId(img.id);
    try {
      await api.updateCharacter(selectedCharacter.id, {
        portraitImageId: img.id,
      });
      await onRefresh();
      setStatusMessage(`Set "${img.filename}" as character portrait.`);
      if (onPushToast) {
        onPushToast(`Set ${selectedCharacter.name}'s portrait`, 'success');
      }
      setTimeout(() => setStatusMessage(null), 3000);
    } catch (err: any) {
      console.error('Failed to set character portrait:', err);
      setOptimisticPortraitId(null);
      setStatusMessage('Failed to set character portrait.');
      if (onPushToast) {
        onPushToast('Failed to set character portrait', 'error');
      }
      setTimeout(() => setStatusMessage(null), 3000);
    }
  };

  // Detailed Character Profile Page
  if (selectedCharacter) {
    const confirmedImages = allImages.filter(
      (img) =>
        !img.isRejected &&
        img.characters.some(
          (c) => c.characterId === selectedCharacter.id && c.status === 'confirmed'
        )
    );
    const suggestedImages = allImages.filter(
      (img) =>
        !img.isRejected &&
        img.characters.some(
          (c) => c.characterId === selectedCharacter.id && c.status === 'suggested'
        )
    );
    const fiveStarImages = confirmedImages.filter((img) => img.rating === 5);
    const fourStarOrHigher = [...confirmedImages]
      .filter((i) => i.rating >= 4)
      .sort((a, b) => b.rating - a.rating);

    // Target pool for Highest Rated: 5-star photos if any exist, otherwise 4+ star photos
    const targetHighestRatedPool = fiveStarImages.length > 0 ? fiveStarImages : fourStarOrHigher;
    const canExpandHighestRated = targetHighestRatedPool.length > 6;
    const displayedHighestRated = isHighestRatedExpanded
      ? targetHighestRatedPool
      : targetHighestRatedPool.slice(0, 6);

    const activePortraitId = optimisticPortraitId ?? selectedCharacter.portraitImageId;
    const currentPortraitThumb =
      (optimisticPortraitId
        ? allImages.find((i) => i.id === optimisticPortraitId)?.thumbnailUrl
        : null) || selectedCharacter.portraitThumbnailUrl;

    return (
      <div className="px-3.5 sm:px-6 py-4 sm:py-6 w-full max-w-7xl mx-auto space-y-6 overflow-x-hidden">
        <CharacterProfileHeader
          character={selectedCharacter}
          confirmedImages={confirmedImages}
          currentPortraitThumb={currentPortraitThumb}
          onBack={() => setSelectedCharId(null)}
          onFilterGallery={() => onFilterGalleryByCharacter(selectedCharacter.id)}
          onDeleteProfile={async () => {
            await api.deleteCharacter(selectedCharacter.id);
            setSelectedCharId(null);
            await onRefresh();
          }}
          onRefresh={onRefresh}
        />

        <CharacterLorasAndWorkflows
          character={selectedCharacter}
          loras={loras}
          workflows={workflows}
          collections={collections}
          onRefresh={onRefresh}
        />

        <CharacterSuggestionsReview
          character={selectedCharacter}
          suggestedImages={suggestedImages}
          selectedSuggestedIds={selectedSuggestedIds}
          onSelectSuggestedId={(id) => {
            setSelectedSuggestedIds((prev) => {
              const next = new Set(prev);
              if (next.has(id)) next.delete(id);
              else next.add(id);
              return next;
            });
          }}
          onSetSelectedSuggestedIds={setSelectedSuggestedIds}
          onOpenImage={onOpenImage}
          onRefresh={onRefresh}
        />

        {displayedHighestRated.length > 0 && (
          <CharacterGallerySection
            title="Highest-Rated Generations"
            images={displayedHighestRated}
            character={selectedCharacter}
            activePortraitId={activePortraitId}
            onOpenImage={onOpenImage}
            onQuickRate={onQuickRate}
            onQuickFavorite={onQuickFavorite}
            onSetPortrait={handleSetPortrait}
            onReusePrompt={onReusePrompt}
            onQuickReject={onQuickReject}
            isExpandable={canExpandHighestRated}
            isExpanded={isHighestRatedExpanded}
            onToggleExpand={() => setIsHighestRatedExpanded((prev) => !prev)}
            totalPoolCount={targetHighestRatedPool.length}
          />
        )}

        <CharacterGallerySection
          title={`All Confirmed Images (${confirmedImages.length})`}
          images={confirmedImages}
          ghostItems={ghostItems.filter((g) => g.characterId === selectedCharacter.id)}
          character={selectedCharacter}
          activePortraitId={activePortraitId}
          onOpenImage={onOpenImage}
          onQuickRate={onQuickRate}
          onQuickFavorite={onQuickFavorite}
          onSetPortrait={handleSetPortrait}
          onReusePrompt={onReusePrompt}
          onQuickReject={onQuickReject}
          emptyText="No confirmed images yet. Assign images from the gallery or confirm suggestions above."
        />
      </div>
    );
  }

  // Main Character Explorer Roster View
  return (
    <>
      <CharacterRosterView
        characters={characters}
        onSelectCharacter={setSelectedCharId}
        onOpenCreateModal={() => setShowCreateModal(true)}
        onOpenMergeModal={() => setShowMergeModal(true)}
        onRunSuggestions={handleRunSuggestions}
        statusMessage={statusMessage}
      />

      <CreateCharacterModal
        isOpen={showCreateModal}
        onClose={() => setShowCreateModal(false)}
        onSubmit={handleCreateCharacter}
      />

      <MergeCharactersModal
        isOpen={showMergeModal}
        characters={characters}
        onClose={() => setShowMergeModal(false)}
        onMerge={handleMergeCharacters}
      />
    </>
  );
};
