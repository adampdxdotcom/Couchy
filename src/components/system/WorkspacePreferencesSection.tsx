import React from 'react';

interface WorkspacePreferencesSectionProps {
  quickGenBoxEnabled: boolean;
  saveUploadedPromptImages: boolean;
  uploadedImagesDir?: string;
  onToggleQuickGenBox: (enabled: boolean) => Promise<void>;
  onToggleSaveUploadedPromptImages: (enabled: boolean) => Promise<void>;
}

export const WorkspacePreferencesSection: React.FC<WorkspacePreferencesSectionProps> = ({
  quickGenBoxEnabled,
  saveUploadedPromptImages,
  uploadedImagesDir = 'data/uploaded',
  onToggleQuickGenBox,
  onToggleSaveUploadedPromptImages,
}) => {
  return (
    <section className="grid grid-cols-1 md:grid-cols-2 gap-4">
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl px-4 py-3.5 flex items-center justify-between gap-4">
        <div className="space-y-0.5 min-w-0">
          <h2 className="text-xs font-display font-semibold text-zinc-100">
            Floating Quick Generation Box
          </h2>
          <p className="text-[11px] text-zinc-400 leading-snug">
            Cross-tab prompt dock with <code className="text-zinc-200">@character</code> mentions &amp; Agent support.
          </p>
        </div>

        <label className="inline-flex items-center gap-2.5 cursor-pointer select-none shrink-0">
          <span className="text-[11px] text-zinc-300 font-medium">
            {quickGenBoxEnabled ? 'On' : 'Off'}
          </span>
          <input
            type="checkbox"
            checked={quickGenBoxEnabled}
            onChange={(e) => onToggleQuickGenBox(e.target.checked)}
            className="sr-only peer"
          />
          <div className="w-10 h-5 bg-zinc-800 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all relative peer-checked:bg-indigo-600" />
        </label>
      </div>

      <div className="bg-zinc-900 border border-zinc-800 rounded-xl px-4 py-3.5 flex items-center justify-between gap-4">
        <div className="space-y-0.5 min-w-0">
          <h2 className="text-xs font-display font-semibold text-zinc-100">
            Save Uploaded Prompt Images (1MP)
          </h2>
          <p className="text-[11px] text-zinc-400 leading-snug truncate" title={`Archive interrogated 1MP copies into ${uploadedImagesDir}`}>
            Archive interrogated 1MP images to <code className="font-mono text-zinc-200">{uploadedImagesDir}</code>.
          </p>
        </div>

        <label className="inline-flex items-center gap-2.5 cursor-pointer select-none shrink-0">
          <span className="text-[11px] text-zinc-300 font-medium">
            {saveUploadedPromptImages ? 'On' : 'Off'}
          </span>
          <input
            type="checkbox"
            checked={saveUploadedPromptImages}
            onChange={(e) => onToggleSaveUploadedPromptImages(e.target.checked)}
            className="sr-only peer"
          />
          <div className="w-10 h-5 bg-zinc-800 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all relative peer-checked:bg-indigo-600" />
        </label>
      </div>
    </section>
  );
};
