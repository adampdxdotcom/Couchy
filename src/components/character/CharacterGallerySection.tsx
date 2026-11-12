import React from 'react';
import {
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Download,
  Heart,
  RotateCcw,
  Star,
  Trash2,
} from 'lucide-react';
import type { CharacterProfile, ImageRecord } from '../../shared/types.ts';

interface CharacterGallerySectionProps {
  title: string;
  images: ImageRecord[];
  character: CharacterProfile;
  activePortraitId: number | null;
  onOpenImage: (img: ImageRecord) => void;
  onQuickRate: (id: number, rating: number) => void;
  onQuickFavorite?: (id: number, nextFav: boolean) => void;
  onSetPortrait: (img: ImageRecord) => Promise<void>;
  onReusePrompt?: (img: ImageRecord) => void;
  onQuickReject?: (id: number, nextRejected: boolean) => void;
  emptyText?: string;
  isExpandable?: boolean;
  isExpanded?: boolean;
  onToggleExpand?: () => void;
  totalPoolCount?: number;
}

export const CharacterGallerySection: React.FC<CharacterGallerySectionProps> = ({
  title,
  images,
  character,
  activePortraitId,
  onOpenImage,
  onQuickRate,
  onQuickFavorite,
  onSetPortrait,
  onReusePrompt,
  onQuickReject,
  emptyText,
  isExpandable = false,
  isExpanded = false,
  onToggleExpand,
  totalPoolCount,
}) => {
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2.5">
        <h3 className="text-sm font-display font-semibold text-zinc-100">
          {title}
        </h3>
        {isExpandable && onToggleExpand && (
          <button
            type="button"
            onClick={onToggleExpand}
            className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-lg bg-zinc-900 hover:bg-zinc-800 text-indigo-400 hover:text-indigo-300 border border-zinc-800 hover:border-zinc-700 transition-colors cursor-pointer select-none"
            title={
              isExpanded
                ? 'Show 1 row only'
                : `Show all ${totalPoolCount ?? images.length} 5-star photos`
            }
          >
            {isExpanded ? (
              <>
                <ChevronUp className="w-3.5 h-3.5" />
                <span>Collapse</span>
              </>
            ) : (
              <>
                <ChevronDown className="w-3.5 h-3.5" />
                <span>Expand ({totalPoolCount ?? images.length})</span>
              </>
            )}
          </button>
        )}
      </div>

      {images.length === 0 ? (
        emptyText ? (
          <p className="text-xs text-zinc-500">{emptyText}</p>
        ) : null
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-3">
          {images.map((img) => {
            const isPortrait =
              (activePortraitId !== null && activePortraitId === img.id) ||
              (character.portraitContentHash !== null &&
                character.portraitContentHash === img.contentHash);

            return (
              <div
                key={img.id}
                className={`bg-zinc-900 rounded-lg overflow-hidden group flex flex-col justify-between transition-all duration-200 ${
                  isPortrait
                    ? 'border-2 border-amber-400 shadow-[0_0_15px_rgba(251,191,36,0.35)] ring-1 ring-amber-400/50'
                    : 'border border-zinc-800 hover:border-zinc-700'
                }`}
              >
                <div
                  onClick={() => onOpenImage(img)}
                  className="relative aspect-square bg-black cursor-pointer overflow-hidden"
                >
                  <img
                    src={img.thumbnailUrl}
                    alt={img.filename}
                    className="w-full h-full object-cover group-hover:scale-[1.02] transition-transform duration-200"
                  />

                  {/* Top Overlay Controls (Portrait Badge & Favorite) */}
                  <div
                    className="absolute top-2 left-2 right-2 flex items-center justify-between pointer-events-none z-10"
                    onClick={(e) => e.stopPropagation()}
                  >
                    {isPortrait ? (
                      <div className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-400 text-zinc-950 text-[10px] font-bold tracking-wider uppercase shadow-md pointer-events-none">
                        <Star className="w-2.5 h-2.5 fill-zinc-950 text-zinc-950" />
                        <span>Portrait</span>
                      </div>
                    ) : <div />}

                    {onQuickFavorite && (
                      <button
                        type="button"
                        onClick={() => onQuickFavorite(img.id, !img.isFavorite)}
                        aria-label="Toggle Favorite"
                        className={`pointer-events-auto p-1.5 rounded-md bg-black/65 backdrop-blur-xs transition-opacity cursor-pointer mobile-show-actions ${
                          img.isFavorite
                            ? 'opacity-100 text-rose-400'
                            : 'opacity-100 sm:opacity-0 sm:group-hover:opacity-100 text-zinc-300 hover:text-rose-400'
                        }`}
                        title={img.isFavorite ? 'Remove from Favorites' : 'Add to Favorites'}
                      >
                        <Heart className={`w-4 h-4 ${img.isFavorite ? 'fill-rose-400' : ''}`} />
                      </button>
                    )}
                  </div>

                  {/* Bottom Floating Bar on Card: Rating Stars (Left) + Actions (Right) */}
                  <div
                    className="absolute bottom-0 inset-x-0 p-1.5 sm:p-2.5 bg-gradient-to-t from-black/90 via-black/60 to-transparent flex items-center justify-between opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity z-10 mobile-show-actions"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <div
                      className="flex items-center gap-0.5 shrink-0"
                      onClick={(e) => e.stopPropagation()}
                    >
                      {[1, 2, 3, 4, 5].map((star) => (
                        <button
                          key={star}
                          type="button"
                          onClick={() => onQuickRate(img.id, img.rating === star ? 0 : star)}
                          className="p-0.5 cursor-pointer"
                        >
                          <Star
                            className={`w-3.5 h-3.5 ${
                              star <= img.rating
                                ? 'fill-amber-400 text-amber-400'
                                : 'text-zinc-400 hover:text-amber-300'
                            }`}
                          />
                        </button>
                      ))}
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      {onReusePrompt && (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            onReusePrompt(img);
                          }}
                          className="p-1 text-zinc-300 hover:text-white hover:bg-zinc-800/80 rounded transition-colors cursor-pointer"
                          title="Reuse prompt & settings in Quick Gen"
                        >
                          <RotateCcw className="w-3.5 h-3.5" />
                        </button>
                      )}
                      <a
                        href={`/api/images/${img.id}/file?download=1`}
                        onClick={(e) => e.stopPropagation()}
                        className="p-1 text-zinc-200 hover:text-white hover:bg-zinc-800/80 rounded transition-colors"
                        title="Download Unchanged Original File"
                      >
                        <Download className="w-3.5 h-3.5" />
                      </a>
                      {onQuickReject && (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            onQuickReject(img.id, !img.isRejected);
                          }}
                          className={`p-1 rounded transition-colors cursor-pointer ${
                            img.isRejected
                              ? 'text-rose-400 hover:text-rose-300 hover:bg-rose-950/60'
                              : 'text-zinc-300 hover:text-rose-400 hover:bg-zinc-800/80'
                          }`}
                          title={img.isRejected ? 'Restore from rejected' : 'Reject image (hide from library)'}
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  </div>
                </div>
                <div className="p-2 text-xs flex items-center justify-between gap-1.5">
                  <span
                    onClick={() => onOpenImage(img)}
                    className="truncate text-zinc-200 cursor-pointer hover:text-white"
                    title={img.filename}
                  >
                    {img.filename}
                  </span>
                  {isPortrait ? (
                    <span
                      className="inline-flex items-center gap-1 text-[11px] font-semibold text-amber-400 shrink-0"
                      title="Current Character Portrait"
                    >
                      <CheckCircle2 className="w-3 h-3 text-amber-400" />
                      <span>Portrait</span>
                    </span>
                  ) : (
                    <button
                      type="button"
                      onClick={async (e) => {
                        e.stopPropagation();
                        await onSetPortrait(img);
                      }}
                      className="text-[11px] text-zinc-400 hover:text-amber-400 shrink-0 cursor-pointer transition-colors"
                      title="Set as Character Portrait"
                    >
                      Set Portrait
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
