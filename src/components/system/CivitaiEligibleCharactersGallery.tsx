import React, { useMemo, useState } from 'react';
import { Download, Heart, Share2, ThumbsUp, Users } from 'lucide-react';
import type { CharacterProfile } from '../../shared/types.ts';
import type { CivitaiEligibleCharacterCardStats } from '../../shared/apiTypes.ts';
import { CharacterPortraitImage } from '../character/CharacterPortraitImage.tsx';

const MY_UPLOADS_FIRST_STORAGE_KEY = 'couchy.civitaiGallery.myUploadsFirst';

interface CivitaiEligibleCharactersGalleryProps {
  characters: CharacterProfile[];
  eligibleCharacterStats: CivitaiEligibleCharacterCardStats[];
  onOpenCharacter: (characterId: number) => void;
  onOpenCharactersTab: () => void;
}

function formatCompactCount(val: number): string {
  if (val >= 1_000_000) return `${(val / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
  if (val >= 1_000) return `${(val / 1_000).toFixed(1).replace(/\.0$/, '')}K`;
  return val.toLocaleString();
}

function readInitialMyUploadsFirst(): boolean {
  try {
    const saved = window.localStorage.getItem(MY_UPLOADS_FIRST_STORAGE_KEY);
    if (saved === 'false') return false;
    if (saved === 'true') return true;
  } catch {
    // ignore storage errors
  }
  return true;
}

/**
 * Portrait gallery of CivitAI-eligible characters on Settings -> Civitai, styled after
 * CharacterCard, sorted by optional "My Uploads First", then Civitai model downloads
 * and cumulative photo reactions.
 */
export const CivitaiEligibleCharactersGallery: React.FC<CivitaiEligibleCharactersGalleryProps> = ({
  characters,
  eligibleCharacterStats,
  onOpenCharacter,
  onOpenCharactersTab,
}) => {
  const [myUploadsFirst, setMyUploadsFirst] = useState<boolean>(readInitialMyUploadsFirst);

  const handleToggleMyUploadsFirst = (enabled: boolean) => {
    setMyUploadsFirst(enabled);
    try {
      window.localStorage.setItem(MY_UPLOADS_FIRST_STORAGE_KEY, String(enabled));
    } catch {
      // ignore storage errors
    }
  };

  const statsById = useMemo(() => {
    const map = new Map<number, CivitaiEligibleCharacterCardStats>();
    for (const s of eligibleCharacterStats) {
      map.set(s.characterId, s);
    }
    return map;
  }, [eligibleCharacterStats]);

  const sortedEligibleCharacters = useMemo(() => {
    const eligible = characters.filter((c) => c.allowCivitaiShare);
    return eligible.sort((a, b) => {
      const sa = statsById.get(a.id);
      const sb = statsById.get(b.id);
      if (myUploadsFirst) {
        const ownDiff =
          Number(Boolean(sb?.hasOwnCivitaiUpload)) - Number(Boolean(sa?.hasOwnCivitaiUpload));
        if (ownDiff !== 0) return ownDiff;
      }
      const dlDiff = (sb?.modelDownloadCount ?? 0) - (sa?.modelDownloadCount ?? 0);
      if (dlDiff !== 0) return dlDiff;
      const reactDiff = (sb?.photoReactionCount ?? 0) - (sa?.photoReactionCount ?? 0);
      if (reactDiff !== 0) return reactDiff;
      const thumbsDiff = (sb?.modelThumbsUpCount ?? 0) - (sa?.modelThumbsUpCount ?? 0);
      if (thumbsDiff !== 0) return thumbsDiff;
      const postDiff = (sb?.publishedPostCount ?? 0) - (sa?.publishedPostCount ?? 0);
      if (postDiff !== 0) return postDiff;
      return a.name.localeCompare(b.name);
    });
  }, [characters, statsById, myUploadsFirst]);

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-display font-semibold text-zinc-100 flex items-center gap-2">
            <span>CivitAI-Eligible Characters</span>
            <span className="text-[11px] font-mono tabular-nums text-zinc-400 font-normal">
              ({sortedEligibleCharacters.length})
            </span>
          </h3>
          <p className="text-[11px] text-zinc-400 mt-0.5">
            Ordered by Civitai model downloads, then cumulative photo reactions. Click a portrait to open their profile.
          </p>
        </div>

        {sortedEligibleCharacters.length > 0 && (
          <label className="inline-flex items-center gap-2.5 px-3 py-1.5 rounded-lg bg-zinc-900 border border-zinc-800 cursor-pointer select-none shrink-0">
            <span className="text-[11px] text-zinc-200 font-medium">My Uploads First</span>
            <input
              type="checkbox"
              checked={myUploadsFirst}
              onChange={(e) => handleToggleMyUploadsFirst(e.target.checked)}
              className="sr-only peer"
            />
            <div className="w-9 h-5 bg-zinc-800 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-4 after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all relative peer-checked:bg-indigo-600" />
          </label>
        )}
      </div>

      {sortedEligibleCharacters.length === 0 ? (
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl px-4 py-3.5 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 text-zinc-400 min-w-0">
            <Share2 className="w-4 h-4 text-zinc-500 shrink-0" />
            <span className="text-xs">
              No characters are marked eligible for Civitai yet. Turn on{' '}
              <strong className="text-zinc-200 font-medium">Share on CivitAI</strong> on any
              character profile to show them here.
            </span>
          </div>
          <button
            type="button"
            onClick={onOpenCharactersTab}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-zinc-950 border border-zinc-800 hover:border-zinc-700 text-zinc-200 font-medium cursor-pointer shrink-0"
          >
            <Users className="w-3.5 h-3.5" />
            <span>Open Characters</span>
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3.5">
          {sortedEligibleCharacters.map((char) => {
            const stats = statsById.get(char.id);
            const isOwnUpload = Boolean(stats?.hasOwnCivitaiUpload);
            const downloads = stats?.modelDownloadCount ?? 0;
            const thumbsUp = stats?.modelThumbsUpCount ?? 0;
            const photoReactions = stats?.photoReactionCount ?? 0;
            const publishedPosts = stats?.publishedPostCount ?? 0;
            const hasCivitaiRatings = downloads > 0 || thumbsUp > 0 || photoReactions > 0;

            return (
              <button
                key={char.id}
                type="button"
                onClick={() => onOpenCharacter(char.id)}
                className="bg-zinc-900 border border-zinc-800/80 hover:border-zinc-700 rounded-xl overflow-hidden cursor-pointer transition-colors flex flex-col justify-between text-left group"
              >
                <div className="aspect-[4/3] w-full bg-zinc-950 relative overflow-hidden flex items-center justify-center">
                  <CharacterPortraitImage
                    src={char.portraitThumbnailUrl}
                    alt={char.name}
                    crop={char.portraitCrop}
                    iconClassName="w-10 h-10 text-zinc-700"
                  />
                </div>

                <div className="p-3 space-y-1.5 w-full">
                  <div className="flex items-center justify-between gap-1.5">
                    <h4 className="text-xs font-display font-semibold text-zinc-100 group-hover:text-indigo-300 transition-colors truncate">
                      {char.name}
                    </h4>
                    {isOwnUpload && (
                      <span
                        title="Linked to your uploaded Civitai LoRA"
                        className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-indigo-500/15 border border-indigo-500/30 text-indigo-300 shrink-0"
                      >
                        Mine
                      </span>
                    )}
                  </div>

                  {hasCivitaiRatings ? (
                    <div className="text-[11px] text-zinc-400 font-mono tabular-nums flex flex-wrap items-center gap-x-2.5 gap-y-1">
                      {downloads > 0 && (
                        <span
                          className="inline-flex items-center gap-1 text-zinc-300"
                          title={`${downloads.toLocaleString()} Civitai model downloads`}
                        >
                          <Download className="w-3 h-3 text-indigo-400 shrink-0" />
                          <span>{formatCompactCount(downloads)}</span>
                        </span>
                      )}
                      {thumbsUp > 0 && (
                        <span
                          className="inline-flex items-center gap-1 text-zinc-300"
                          title={`${thumbsUp.toLocaleString()} Civitai model thumbs-up`}
                        >
                          <ThumbsUp className="w-3 h-3 text-emerald-400 shrink-0" />
                          <span>{formatCompactCount(thumbsUp)}</span>
                        </span>
                      )}
                      {photoReactions > 0 && (
                        <span
                          className="inline-flex items-center gap-1 text-zinc-300"
                          title={
                            publishedPosts > 0
                              ? `${photoReactions.toLocaleString()} Civitai photo reactions across ${publishedPosts} published ${publishedPosts === 1 ? 'post' : 'posts'}`
                              : `${photoReactions.toLocaleString()} Civitai photo reactions`
                          }
                        >
                          <Heart className="w-3 h-3 text-rose-400 shrink-0" />
                          <span>{formatCompactCount(photoReactions)}</span>
                        </span>
                      )}
                    </div>
                  ) : (
                    <div className="text-[11px] text-zinc-500 truncate">
                      {publishedPosts > 0
                        ? `${publishedPosts} published ${publishedPosts === 1 ? 'post' : 'posts'}`
                        : 'No Civitai ratings yet'}
                    </div>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      )}
    </section>
  );
};
