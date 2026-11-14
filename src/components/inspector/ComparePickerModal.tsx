import React, { useEffect, useMemo, useState } from 'react';
import { Heart, Layers, Loader2, Search, Star, X } from 'lucide-react';
import { api } from '../../api/client.ts';
import type {
  CharacterProfile,
  ImageRecord,
  LoraExplorerItem,
} from '../../shared/types.ts';

interface ComparePickerModalProps {
  targetSlot: 'A' | 'B';
  currentSlotAId: number;
  currentSlotBId: number | null;
  initialImages: ImageRecord[];
  characters: CharacterProfile[];
  loras: LoraExplorerItem[];
  onSelectImage: (img: ImageRecord) => void;
  onClose: () => void;
}

/**
 * Lightweight library picker modal for Split Mode ("Compare with...").
 * Mirrors main-gallery series stacks with search and core filters (Character, LoRA, Rating, Favorites).
 */
export const ComparePickerModal: React.FC<ComparePickerModalProps> = ({
  targetSlot,
  currentSlotAId,
  currentSlotBId,
  initialImages,
  characters,
  loras,
  onSelectImage,
  onClose,
}) => {
  const [query, setQuery] = useState('');
  const [characterId, setCharacterId] = useState<string>('');
  const [loraName, setLoraName] = useState<string>('');
  const [minRating, setMinRating] = useState<number>(0);
  const [favoritesOnly, setFavoritesOnly] = useState<boolean>(false);

  const defaultPool = useMemo(
    () => initialImages.filter((img) => !img.isRejected && !img.isArchived),
    [initialImages]
  );

  const [items, setItems] = useState<ImageRecord[]>(defaultPool);
  const [isLoading, setIsLoading] = useState(false);

  const hasActiveFilter =
    Boolean(query.trim()) ||
    Boolean(characterId) ||
    Boolean(loraName) ||
    minRating > 0 ||
    favoritesOnly;

  useEffect(() => {
    if (!hasActiveFilter) {
      setItems(defaultPool);
      setIsLoading(false);
      return;
    }

    let cancelled = false;
    setIsLoading(true);
    const timer = window.setTimeout(async () => {
      try {
        const res = await api.queryImages({
          query: query.trim(),
          characterIds: characterId ? [Number(characterId)] : [],
          loras: loraName ? [loraName] : [],
          minRating,
          favoritesOnly,
          rejectedMode: 'exclude',
          archivedMode: 'exclude',
          sortBy: 'newest',
        });
        if (!cancelled) {
          setItems(res.items || []);
        }
      } catch {
        if (!cancelled) {
          // Graceful client-side fallback if query request fails
          const q = query.trim().toLowerCase();
          setItems(
            defaultPool.filter((img) => {
              if (favoritesOnly && !img.isFavorite) return false;
              if (minRating > 0 && img.rating < minRating) return false;
              if (
                characterId &&
                !img.characters.some((c) => c.characterId === Number(characterId))
              ) {
                return false;
              }
              if (
                loraName &&
                !img.loras.some((l) => l.loraName.toLowerCase() === loraName.toLowerCase())
              ) {
                return false;
              }
              if (q) {
                const hay = `${img.filename} ${img.positivePrompt || ''} ${img.checkpointName || ''}`.toLowerCase();
                if (!hay.includes(q)) return false;
              }
              return true;
            })
          );
        }
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }, 180);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [hasActiveFilter, query, characterId, loraName, minRating, favoritesOnly, defaultPool]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Choose Image ${targetSlot} to Compare`}
      onClick={onClose}
      className="fixed inset-0 z-[70] bg-black/80 backdrop-blur-sm flex items-center justify-center p-3 sm:p-6"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-6xl h-[86vh] bg-zinc-900 border border-zinc-700/80 rounded-2xl shadow-2xl flex flex-col overflow-hidden"
      >
        {/* Modal Header */}
        <div className="px-4 sm:px-5 py-3.5 border-b border-zinc-800 bg-zinc-900/95 flex items-center justify-between gap-3 shrink-0">
          <div className="min-w-0">
            <h3 className="text-sm sm:text-base font-display font-semibold text-zinc-100 truncate">
              Compare with Image {targetSlot}
            </h3>
            <p className="text-[11px] text-zinc-400">
              Select a series stack or standalone image from your library. Pick individual steps inside a stack from the comparison drawer.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded-lg bg-zinc-950 border border-zinc-800 text-zinc-400 hover:text-zinc-100 cursor-pointer shrink-0"
            title="Close Picker (Esc)"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Search & Compact Filters */}
        <div className="px-4 sm:px-5 py-3 border-b border-zinc-800/80 bg-zinc-950/60 flex flex-wrap items-center gap-2.5 shrink-0 text-xs">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="w-3.5 h-3.5 text-zinc-500 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search prompts, filenames, tags, checkpoints..."
              className="w-full pl-8 pr-3 py-1.5 bg-zinc-900 border border-zinc-800 focus:border-indigo-500 focus:outline-none rounded-lg text-zinc-100 placeholder-zinc-500"
            />
          </div>

          <select
            value={characterId}
            onChange={(e) => setCharacterId(e.target.value)}
            className="px-2.5 py-1.5 bg-zinc-900 border border-zinc-800 rounded-lg text-zinc-200 max-w-[170px]"
          >
            <option value="">All Characters</option>
            {characters.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>

          <select
            value={loraName}
            onChange={(e) => setLoraName(e.target.value)}
            className="px-2.5 py-1.5 bg-zinc-900 border border-zinc-800 rounded-lg text-zinc-200 max-w-[180px]"
          >
            <option value="">All LoRAs</option>
            {loras.map((l) => (
              <option key={l.filename} value={l.filename}>
                {l.nickname ? `@${l.nickname}` : l.name}
              </option>
            ))}
          </select>

          <select
            value={minRating}
            onChange={(e) => setMinRating(Number(e.target.value))}
            className="px-2.5 py-1.5 bg-zinc-900 border border-zinc-800 rounded-lg text-zinc-200"
          >
            <option value={0}>Any Rating</option>
            <option value={3}>3+ Stars</option>
            <option value={4}>4+ Stars</option>
            <option value={5}>5 Stars</option>
          </select>

          <button
            type="button"
            onClick={() => setFavoritesOnly((prev) => !prev)}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border font-medium transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
              favoritesOnly
                ? 'bg-rose-500/15 border-rose-500/40 text-rose-300'
                : 'bg-zinc-900 border-zinc-800 text-zinc-300 hover:border-zinc-700'
            }`}
          >
            <Heart className={`w-3.5 h-3.5 ${favoritesOnly ? 'fill-rose-400 text-rose-400' : ''}`} />
            <span>Favorites</span>
          </button>

          {hasActiveFilter && (
            <button
              type="button"
              onClick={() => {
                setQuery('');
                setCharacterId('');
                setLoraName('');
                setMinRating(0);
                setFavoritesOnly(false);
              }}
              className="px-2.5 py-1.5 text-zinc-400 hover:text-zinc-200 cursor-pointer whitespace-nowrap shrink-0"
            >
              Reset
            </button>
          )}
        </div>

        {/* Stacked Gallery Grid */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-5">
          {isLoading ? (
            <div className="h-full flex items-center justify-center text-zinc-400 text-xs gap-2">
              <Loader2 className="w-4 h-4 animate-spin text-indigo-400" />
              <span>Filtering library...</span>
            </div>
          ) : items.length === 0 ? (
            <div className="h-full flex items-center justify-center text-zinc-500 text-xs">
              No matching images found for these filters.
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3 sm:gap-4">
              {items.map((img) => {
                const isSlotA = img.id === currentSlotAId;
                const isSlotB = img.id === currentSlotBId;
                const stackCount = img.seriesCount ?? img.seriesItems?.length ?? 1;

                return (
                  <button
                    key={img.id}
                    type="button"
                    onClick={() => onSelectImage(img)}
                    className={`group relative rounded-xl overflow-hidden bg-zinc-950 border text-left transition-all cursor-pointer flex flex-col ${
                      isSlotA || isSlotB
                        ? 'border-indigo-400 ring-2 ring-indigo-500/50'
                        : 'border-zinc-800 hover:border-zinc-600'
                    }`}
                  >
                    <div className="relative aspect-[3/4] w-full bg-zinc-900 overflow-hidden">
                      <img
                        src={img.thumbnailUrl}
                        alt={img.filename}
                        referrerPolicy="no-referrer"
                        className="w-full h-full object-cover transition-transform duration-200 group-hover:scale-[1.03]"
                      />

                      {(isSlotA || isSlotB) && (
                        <span className="absolute top-2 left-2 px-2 py-0.5 rounded bg-indigo-600/95 text-[10px] font-mono font-semibold text-white">
                          {isSlotA ? 'In Slot A' : 'In Slot B'}
                        </span>
                      )}

                      {stackCount > 1 && (
                        <span className="absolute bottom-2 right-2 inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-black/80 text-[10px] font-mono text-zinc-200 tabular-nums">
                          <Layers className="w-3 h-3 text-indigo-400" />
                          <span>{stackCount}</span>
                        </span>
                      )}

                      {img.isFavorite && (
                        <span className="absolute top-2 right-2 p-1 rounded-full bg-black/75 text-rose-400">
                          <Heart className="w-3 h-3 fill-rose-400" />
                        </span>
                      )}
                    </div>

                    <div className="px-2.5 py-2 border-t border-zinc-800/80 space-y-0.5">
                      <div className="text-[11px] font-medium text-zinc-200 truncate">
                        {img.filename}
                      </div>
                      <div className="flex items-center justify-between gap-2 text-[10px] font-mono tabular-nums text-zinc-400">
                        <span>
                          {img.width}×{img.height}
                        </span>
                        {img.rating > 0 && (
                          <span className="inline-flex items-center gap-0.5 text-amber-400">
                            <Star className="w-2.5 h-2.5 fill-amber-400" />
                            {img.rating}
                          </span>
                        )}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
