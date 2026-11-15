import React, { useState } from 'react';
import { CheckCircle2, Sparkles, XCircle } from 'lucide-react';
import { api } from '../../api/client.ts';
import type { CharacterProfile, ImageRecord } from '../../shared/types.ts';
import { CharacterPortraitImage } from '../character/CharacterPortraitImage.tsx';

interface InspectorCharacterSectionProps {
  activeImage: ImageRecord;
  characters: CharacterProfile[];
  onFilterByCharacter: (characterId: number) => void;
  onClose: () => void;
  onRefreshDetail: (imageId: number) => void;
  onUpdated: () => void;
}

/**
 * Character association selector and confirmed/suggested character cards.
 */
export const InspectorCharacterSection: React.FC<InspectorCharacterSectionProps> = ({
  activeImage,
  characters,
  onFilterByCharacter,
  onClose,
  onRefreshDetail,
  onUpdated,
}) => {
  const [selectedCharId, setSelectedCharId] = useState('');
  const [charAppearance, setCharAppearance] = useState('');

  return (
    <div className="space-y-2.5 min-w-0">
      <h4 className="text-[11px] font-display font-semibold text-zinc-400 uppercase tracking-wider">
        Assigned Character
      </h4>

      {activeImage.characters.length === 0 ? (
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 pt-0.5">
          <select
            value={selectedCharId}
            onChange={(e) => setSelectedCharId(e.target.value)}
            className="w-full sm:flex-1 min-w-0 px-2.5 py-2 sm:py-1.5 bg-zinc-950 border border-zinc-800 rounded text-zinc-200"
          >
            <option value="">Assign Character...</option>
            {characters.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          <div className="flex items-center gap-2 w-full sm:w-auto min-w-0">
            <input
              type="text"
              value={charAppearance}
              onChange={(e) => setCharAppearance(e.target.value)}
              placeholder="Outfit/Variant (optional)"
              className="flex-1 sm:w-36 min-w-0 px-2.5 py-2 sm:py-1.5 bg-zinc-950 border border-zinc-800 rounded text-zinc-200"
            />
            <button
              type="button"
              onClick={async () => {
                if (!selectedCharId) return;
                await api.updateCharacterAssociationStatus({
                  imageId: activeImage.id,
                  characterId: Number(selectedCharId),
                  status: 'confirmed',
                  appearanceLabel: charAppearance.trim() || undefined,
                });
                setSelectedCharId('');
                setCharAppearance('');
                onRefreshDetail(activeImage.id);
                onUpdated();
              }}
              className="px-3.5 py-2 sm:py-1.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 rounded cursor-pointer shrink-0"
            >
              Add
            </button>
          </div>
        </div>
      ) : (
        <div className="space-y-2">
          {activeImage.characters.map((ch) => {
            const charProfile = characters.find((c) => c.id === ch.characterId);
            return (
              <div
                key={ch.id}
                className="flex items-center justify-between gap-3 bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2.5 min-w-0"
              >
                <div className="flex items-center gap-3 min-w-0 flex-1">
                  <button
                    type="button"
                    onClick={() => {
                      onFilterByCharacter(ch.characterId);
                      onClose();
                    }}
                    className="w-12 h-12 rounded-lg overflow-hidden bg-zinc-900 border border-zinc-800 shrink-0 flex items-center justify-center cursor-pointer hover:border-indigo-500/60 transition-colors"
                    title={`Filter gallery by ${ch.characterName}`}
                  >
                    {
                      <CharacterPortraitImage
                        src={charProfile?.portraitThumbnailUrl}
                        alt={ch.characterName}
                        crop={charProfile?.portraitCrop}
                        referrerPolicy="no-referrer"
                        iconClassName="w-5 h-5 text-zinc-600"
                      />
                    }
                  </button>

                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-baseline gap-1.5">
                      <button
                        type="button"
                        onClick={() => {
                          onFilterByCharacter(ch.characterId);
                          onClose();
                        }}
                        className="text-base font-display font-semibold text-zinc-100 hover:text-indigo-400 cursor-pointer truncate leading-tight"
                      >
                        {ch.characterName}
                      </button>
                      {ch.appearanceLabel && (
                        <span className="text-xs text-zinc-400">· {ch.appearanceLabel}</span>
                      )}
                      {ch.status === 'suggested' && (
                        <span className="inline-flex items-center gap-1 text-[11px] text-amber-400">
                          <Sparkles className="w-3 h-3 shrink-0" />
                          <span>Suggested ({Math.round(ch.confidence * 100)}%)</span>
                        </span>
                      )}
                    </div>
                    {ch.matchReason && (
                      <p className="text-[11px] text-zinc-500 truncate mt-0.5">{ch.matchReason}</p>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-1.5 shrink-0">
                  {ch.status === 'suggested' ? (
                    <>
                      <button
                        type="button"
                        onClick={async () => {
                          await api.updateCharacterAssociationStatus({
                            imageId: activeImage.id,
                            characterId: ch.characterId,
                            status: 'confirmed',
                          });
                          onRefreshDetail(activeImage.id);
                          onUpdated();
                        }}
                        className="inline-flex items-center gap-1 px-2 py-1 bg-emerald-600/20 border border-emerald-500/40 text-emerald-300 rounded hover:bg-emerald-600/30 cursor-pointer"
                        title="Confirm Character Suggestion"
                      >
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        <span>Confirm</span>
                      </button>
                      <button
                        type="button"
                        onClick={async () => {
                          await api.updateCharacterAssociationStatus({
                            imageId: activeImage.id,
                            characterId: ch.characterId,
                            status: 'rejected',
                          });
                          onRefreshDetail(activeImage.id);
                          onUpdated();
                        }}
                        className="inline-flex items-center gap-1 px-2 py-1 bg-rose-600/20 border border-rose-500/40 text-rose-300 rounded hover:bg-rose-600/30 cursor-pointer"
                        title="Reject Suggestion Permanently"
                      >
                        <XCircle className="w-3.5 h-3.5" />
                        <span>Reject</span>
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      onClick={async () => {
                        await api.updateCharacterAssociationStatus({
                          imageId: activeImage.id,
                          characterId: ch.characterId,
                          status: 'remove',
                        });
                        onRefreshDetail(activeImage.id);
                        onUpdated();
                      }}
                      className="text-zinc-500 hover:text-rose-400 px-1.5 py-0.5 cursor-pointer"
                    >
                      Unlink
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
