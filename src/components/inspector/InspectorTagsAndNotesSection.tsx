import React, { useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { api } from '../../api/client.ts';
import type { ImageRecord, VisualTagItem } from '../../shared/types.ts';
import type { InspectorDetailData } from './useInspectorState.ts';

interface InspectorTagsAndNotesSectionProps {
  activeImage: ImageRecord;
  detailData: InspectorDetailData | null;
  onUpdateVisualTags: (visualTags: VisualTagItem[]) => void;
  visualTaggerEnabled: boolean;
  collections: { id: number; name: string }[];
  notes: string;
  onChangeNotes: (value: string) => void;
  onSaveNotes: () => void;
  onFilterByVisualKeyword?: (keyword: string) => void;
  onClose: () => void;
  onRefreshDetail: (imageId: number) => void;
  onUpdated: () => void;
}

/**
 * WD14 visual keywords, user tags, collections, private notes,
 * and collapsible raw embedded workflow JSON viewer.
 */
export const InspectorTagsAndNotesSection: React.FC<
  InspectorTagsAndNotesSectionProps
> = ({
  activeImage,
  detailData,
  onUpdateVisualTags,
  visualTaggerEnabled,
  collections,
  notes,
  onChangeNotes,
  onSaveNotes,
  onFilterByVisualKeyword,
  onClose,
  onRefreshDetail,
  onUpdated,
}) => {
  const [newTag, setNewTag] = useState('');
  const [selectedColId, setSelectedColId] = useState('');
  const [isRescanningVisualTags, setIsRescanningVisualTags] = useState(false);
  const [showRawWorkflow, setShowRawWorkflow] = useState(false);

  return (
    <div className="space-y-3 pt-2 border-t border-zinc-800">
      {visualTaggerEnabled && (
        <div className="space-y-1.5 pb-2 border-b border-zinc-800/70">
          <div className="flex items-center justify-between gap-2">
            <span className="font-display font-semibold text-zinc-200 uppercase tracking-wider">
              Visual Keywords ({(activeImage.visualTags || []).length})
            </span>
            <button
              type="button"
              disabled={isRescanningVisualTags}
              onClick={async () => {
                setIsRescanningVisualTags(true);
                try {
                  const res = await api.rescanImageVisualTags(activeImage.id);
                  onUpdateVisualTags(res.visualTags);
                  onUpdated();
                } finally {
                  setIsRescanningVisualTags(false);
                }
              }}
              className="inline-flex items-center gap-1 text-[11px] text-indigo-400 hover:text-indigo-300 disabled:opacity-50 cursor-pointer"
              title="Re-run WD14 ONNX visual keyword extractor on this image"
            >
              <RefreshCw
                className={`w-3 h-3 ${isRescanningVisualTags ? 'animate-spin' : ''}`}
              />
              <span>{isRescanningVisualTags ? 'Tagging...' : 'Re-tag Image'}</span>
            </button>
          </div>

          {!activeImage.visualTags || activeImage.visualTags.length === 0 ? (
            <p className="text-[11px] text-zinc-500">
              No visual keywords extracted yet. Click &ldquo;Re-tag Image&rdquo; or let the
              background queue scan it.
            </p>
          ) : (
            <div className="flex flex-wrap items-center gap-1.5">
              {activeImage.visualTags.map((vt) => (
                <div
                  key={vt.tag}
                  className="inline-flex items-center bg-zinc-950 border border-zinc-800 hover:border-indigo-500/50 rounded overflow-hidden"
                >
                  <button
                    type="button"
                    onClick={() => {
                      if (onFilterByVisualKeyword) {
                        onFilterByVisualKeyword(vt.tag);
                        onClose();
                      }
                    }}
                    className="px-2 py-0.5 text-zinc-200 hover:text-indigo-300 cursor-pointer font-mono text-[11px]"
                    title={`Filter gallery by "${vt.tag}" (Confidence: ${Math.round(
                      vt.confidence * 100
                    )}%)`}
                  >
                    {vt.tag}
                  </button>
                  <button
                    type="button"
                    onClick={async () => {
                      const res = await api.removeImageVisualTag(activeImage.id, vt.tag);
                      onUpdateVisualTags(res.visualTags);
                      onUpdated();
                    }}
                    className="px-1.5 py-0.5 text-zinc-500 hover:text-rose-400 hover:bg-rose-500/10 border-l border-zinc-800/80 cursor-pointer"
                    title={`Remove "${vt.tag}" from this image`}
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="space-y-1.5">
        <span className="font-display font-semibold text-zinc-200 uppercase tracking-wider block">
          Tags
        </span>
        <div className="flex flex-wrap items-center gap-1.5">
          {activeImage.tags.map((t) => (
            <span
              key={t.id}
              className="inline-flex items-center gap-1 text-zinc-300 bg-zinc-950 border border-zinc-800 px-2 py-0.5 rounded"
            >
              <span>#{t.name}</span>
              <button
                type="button"
                onClick={async () => {
                  await api.bulkUpdateImages({
                    imageIds: [activeImage.id],
                    removeTagId: t.id,
                  });
                  onRefreshDetail(activeImage.id);
                  onUpdated();
                }}
                className="text-zinc-500 hover:text-rose-400 cursor-pointer"
              >
                ×
              </button>
            </span>
          ))}
          <input
            type="text"
            value={newTag}
            onChange={(e) => setNewTag(e.target.value)}
            onKeyDown={async (e) => {
              if (e.key === 'Enter' && newTag.trim()) {
                await api.bulkUpdateImages({
                  imageIds: [activeImage.id],
                  addTagName: newTag.trim(),
                });
                setNewTag('');
                onRefreshDetail(activeImage.id);
                onUpdated();
              }
            }}
            placeholder="+ Add tag & Enter"
            className="px-2 py-0.5 bg-zinc-950 border border-zinc-800 rounded text-zinc-200 w-32"
          />
        </div>
      </div>

      <div className="space-y-1.5">
        <span className="font-display font-semibold text-zinc-200 uppercase tracking-wider block">
          Collections
        </span>
        <div className="flex flex-wrap items-center gap-2">
          {activeImage.collections.map((c) => (
            <span
              key={c.id}
              className="inline-flex items-center gap-1 text-zinc-300 bg-zinc-950 border border-zinc-800 px-2 py-0.5 rounded"
            >
              <span>{c.name}</span>
              <button
                type="button"
                onClick={async () => {
                  await api.bulkUpdateImages({
                    imageIds: [activeImage.id],
                    removeCollectionId: c.id,
                  });
                  onRefreshDetail(activeImage.id);
                  onUpdated();
                }}
                className="text-zinc-500 hover:text-rose-400 cursor-pointer"
              >
                ×
              </button>
            </span>
          ))}
          {collections.length > 0 && (
            <select
              value={selectedColId}
              onChange={async (e) => {
                const cid = e.target.value;
                if (!cid) return;
                await api.bulkUpdateImages({
                  imageIds: [activeImage.id],
                  addCollectionId: Number(cid),
                });
                setSelectedColId('');
                onRefreshDetail(activeImage.id);
                onUpdated();
              }}
              className="px-2 py-1 bg-zinc-950 border border-zinc-800 rounded text-zinc-200"
            >
              <option value="">+ Add to collection...</option>
              {collections.map((col) => (
                <option key={col.id} value={col.id}>
                  {col.name}
                </option>
              ))}
            </select>
          )}
        </div>
      </div>

      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <span className="font-display font-semibold text-zinc-200 uppercase tracking-wider">
            User Notes
          </span>
          <button
            type="button"
            onClick={onSaveNotes}
            className="text-indigo-400 hover:text-indigo-300 cursor-pointer"
          >
            Save Notes
          </button>
        </div>
        <textarea
          rows={2}
          value={notes}
          onChange={(e) => onChangeNotes(e.target.value)}
          onBlur={onSaveNotes}
          placeholder="Add private notes about lighting, prompt adjustments, or defects..."
          className="w-full p-2.5 bg-zinc-950 border border-zinc-800 rounded-lg text-zinc-200"
        />
      </div>

      {/* Raw Workflow JSON Inspector Toggle */}
      <div className="pt-2">
        <button
          type="button"
          onClick={() => setShowRawWorkflow((v) => !v)}
          className="text-zinc-400 hover:text-zinc-200 underline cursor-pointer"
        >
          {showRawWorkflow ? 'Hide Raw Embedded Workflow JSON' : 'Inspect Raw Embedded Workflow JSON'}
        </button>
        {showRawWorkflow && detailData && (
          <pre className="mt-2 p-3 bg-zinc-950 border border-zinc-800 rounded-lg text-[11px] font-mono text-zinc-300 max-h-60 overflow-auto">
            {detailData.apiWorkflowJson ||
              detailData.visualWorkflowJson ||
              JSON.stringify(detailData.rawMetadata, null, 2)}
          </pre>
        )}
      </div>
    </div>
  );
};
