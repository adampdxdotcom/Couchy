import React from 'react';
import { Layers, RefreshCw } from 'lucide-react';
import type { GenerationBatchRecord, ImageRecord } from '../../shared/types.ts';

export interface BatchQueueHistoryProps {
  batches: GenerationBatchRecord[];
  allImages: ImageRecord[];
  onRefreshBatches: () => void;
  onOpenImage: (img: ImageRecord) => void;
}

/**
 * Historical generation batch queue panel displaying item progress,
 * linked outputs, and error states.
 */
export const BatchQueueHistory: React.FC<BatchQueueHistoryProps> = ({
  batches,
  allImages,
  onRefreshBatches,
  onOpenImage,
}) => {
  return (
    <section className="p-5 bg-zinc-900/60 border border-zinc-800/90 rounded-xl space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Layers className="w-4 h-4 text-indigo-400" />
          <h2 className="text-sm font-display font-semibold text-zinc-100">
            Dispatched ComfyUI Generation Batches
          </h2>
        </div>
        <button
          type="button"
          onClick={onRefreshBatches}
          className="inline-flex items-center gap-1.5 text-xs text-zinc-400 hover:text-zinc-200 cursor-pointer transition-colors"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          <span>Refresh Queue</span>
        </button>
      </div>

      {batches.length === 0 ? (
        <div className="py-12 text-center border border-dashed border-zinc-800 rounded-xl space-y-2">
          <p className="text-sm font-medium text-zinc-300">No generation batches sent yet</p>
          <p className="text-xs text-zinc-500 max-w-md mx-auto">
            Choose a character, pick an aspect ratio and megapixel target (0.1–10.0 MP), and click Send All to dispatch a batch to ComfyUI.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {batches.map((batch) => {
            const completedCount = batch.items.filter((i) => i.status === 'completed').length;
            const submittedCount = batch.items.filter(
              (i) => i.status === 'submitted' || i.status === 'pending'
            ).length;
            const failedCount = batch.items.filter((i) => i.status === 'failed').length;

            return (
              <div
                key={batch.id}
                className="p-4 bg-zinc-950 border border-zinc-800 rounded-xl space-y-3"
              >
                <div className="flex flex-wrap items-center justify-between gap-2 pb-2 border-b border-zinc-800/80">
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    <span className="font-semibold text-zinc-100">Batch #{batch.id}</span>
                    <span className="text-zinc-600">·</span>
                    <span className="text-zinc-300">
                      {batch.characterName || 'Unassigned Subject'}
                    </span>
                    <span className="text-zinc-600">·</span>
                    <span className="font-mono text-zinc-400 tabular-nums">
                      {batch.aspectRatio} · {Number(batch.megapixels || 3.0).toFixed(1)} MP
                    </span>
                    {batch.themeTitle && (
                      <>
                        <span className="text-zinc-600">·</span>
                        <span className="text-indigo-300 truncate max-w-xs">
                          Theme: {batch.themeTitle}
                        </span>
                      </>
                    )}
                  </div>

                  <div className="flex items-center gap-2 text-xs font-mono tabular-nums">
                    {completedCount > 0 && (
                      <span className="text-emerald-400">{completedCount} completed</span>
                    )}
                    {submittedCount > 0 && (
                      <span className="text-amber-400">{submittedCount} queued</span>
                    )}
                    {failedCount > 0 && (
                      <span className="text-red-400">{failedCount} failed</span>
                    )}
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  {batch.items.map((item) => {
                    const linkedImage = item.outputImageId
                      ? allImages.find((img) => img.id === item.outputImageId)
                      : null;

                    return (
                      <div
                        key={item.id}
                        className="p-2.5 bg-zinc-900/60 border border-zinc-800/90 rounded-lg flex gap-3 items-start"
                      >
                        {item.outputThumbnailUrl ? (
                          <button
                            type="button"
                            onClick={() => {
                              if (linkedImage) onOpenImage(linkedImage);
                            }}
                            className="w-16 h-16 rounded overflow-hidden bg-zinc-950 border border-zinc-800 shrink-0 cursor-pointer"
                          >
                            <img
                              src={item.outputThumbnailUrl}
                              alt={`Shot ${item.itemIndex}`}
                              referrerPolicy="no-referrer"
                              className="w-full h-full object-cover"
                            />
                          </button>
                        ) : (
                          <div className="w-16 h-16 rounded bg-zinc-950 border border-zinc-800 flex flex-col items-center justify-center text-[10px] font-mono text-zinc-500 shrink-0">
                            <span>#{item.itemIndex}</span>
                            <span>{item.status}</span>
                          </div>
                        )}

                        <div className="min-w-0 flex-1 space-y-1">
                          <div className="flex items-center justify-between text-[11px]">
                            <span className="font-mono text-zinc-300 tabular-nums">
                              Shot #{item.itemIndex} · Seed {item.seed}
                            </span>
                            <span
                              className={`font-medium ${
                                item.status === 'completed'
                                  ? 'text-emerald-400'
                                  : item.status === 'failed'
                                  ? 'text-red-400'
                                  : 'text-amber-400'
                              }`}
                            >
                              {item.status === 'completed'
                                ? 'Completed'
                                : item.status === 'failed'
                                ? 'Failed'
                                : 'Sent to ComfyUI'}
                            </span>
                          </div>
                          <p className="text-xs text-zinc-300 line-clamp-2">{item.prompt}</p>
                          {item.errorMessage && (
                            <p className="text-[11px] text-red-400 truncate">
                              {item.errorMessage}
                            </p>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
};
