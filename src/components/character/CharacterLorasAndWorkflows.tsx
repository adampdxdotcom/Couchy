import React from 'react';
import type {
  CharacterProfile,
  ImageRecord,
  LoraExplorerItem,
  ModelInventoryItem,
  PillTypeSettings,
} from '../../shared/types.ts';
import {
  CharacterFavoriteAddonsCard,
  type CharacterNewImagePayload,
} from './CharacterFavoriteAddonsCard.tsx';
import { CharacterHighestRatedCard } from './CharacterHighestRatedCard.tsx';

interface CharacterLorasAndWorkflowsProps {
  character: CharacterProfile;
  allCharacters: CharacterProfile[];
  confirmedImages: ImageRecord[];
  highestRatedImages: ImageRecord[];
  usesFiveStarOnly: boolean;
  activePortraitId: number | null;
  loras: LoraExplorerItem[];
  models?: ModelInventoryItem[];
  defaultCheckpoint?: string | null;
  collections: { id: number; name: string }[];
  pillTypeSettings?: PillTypeSettings;
  onRefresh: () => Promise<void>;
  onSelectCharacter?: (characterId: number) => void;
  onFilterGalleryByAddon?: (
    characterId: number,
    filter: { checkpoint?: string; loraName?: string }
  ) => void;
  onLaunchNewImage?: (payload: CharacterNewImagePayload) => void;
  onOpenImage: (img: ImageRecord) => void;
  onQuickRate: (id: number, rating: number) => void;
  onQuickFavorite?: (id: number, nextFav: boolean) => void;
  onSetPortrait: (img: ImageRecord) => Promise<void>;
  onReusePrompt?: (img: ImageRecord) => void;
  onOpenConversation?: (img: ImageRecord) => void;
  onQuickReject?: (id: number, nextRejected: boolean) => void;
}

export const CharacterLorasAndWorkflows: React.FC<CharacterLorasAndWorkflowsProps> = ({
  character,
  allCharacters,
  confirmedImages,
  highestRatedImages,
  usesFiveStarOnly,
  activePortraitId,
  loras,
  models = [],
  defaultCheckpoint = null,
  collections,
  pillTypeSettings,
  onRefresh,
  onSelectCharacter,
  onFilterGalleryByAddon,
  onLaunchNewImage,
  onOpenImage,
  onQuickRate,
  onQuickFavorite,
  onSetPortrait,
  onReusePrompt,
  onOpenConversation,
  onQuickReject,
}) => {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-stretch">
      {/* Highest-Rated Images (2x2 Scrollable Spotlight Grid) */}
      <CharacterHighestRatedCard
        character={character}
        images={highestRatedImages}
        usesFiveStarOnly={usesFiveStarOnly}
        activePortraitId={activePortraitId}
        onOpenImage={onOpenImage}
        onQuickRate={onQuickRate}
        onQuickFavorite={onQuickFavorite}
        onSetPortrait={onSetPortrait}
        onReusePrompt={onReusePrompt}
        onOpenConversation={onOpenConversation}
        onQuickReject={onQuickReject}
      />

      {/* Favorite Addons, Friends (hidden when empty), & Collections */}
      <CharacterFavoriteAddonsCard
        character={character}
        allCharacters={allCharacters}
        confirmedImages={confirmedImages}
        loras={loras}
        models={models}
        defaultCheckpoint={defaultCheckpoint}
        collections={collections}
        pillTypeSettings={pillTypeSettings}
        onRefresh={onRefresh}
        onSelectCharacter={onSelectCharacter}
        onFilterGalleryByAddon={onFilterGalleryByAddon}
        onLaunchNewImage={onLaunchNewImage}
      />
    </div>
  );
};
