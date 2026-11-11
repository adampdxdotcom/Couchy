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
    <section className="bg-zinc-900 border border-zinc-800 rounded-xl p-5 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="space-y-1">
          <h2 className="text-sm font-display font-semibold text-zinc-100">
            Floating Quick Generation Box
          </h2>
          <p className="text-zinc-400">
            Show a floating prompt bar across all tabs with <code className="text-zinc-200">@character</code> mentions, aspect ratio &amp; batch count controls, and LM Studio Agent support.
          </p>
        </div>

        <label className="inline-flex items-center gap-3 cursor-pointer select-none">
          <span className="text-zinc-300 font-medium">
            {quickGenBoxEnabled ? 'Enabled' : 'Disabled'}
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

      <div className="pt-4 border-t border-zinc-800 flex flex-wrap items-center justify-between gap-4">
        <div className="space-y-1">
          <h2 className="text-sm font-display font-semibold text-zinc-100">
            Save Uploaded Prompt Images (1MP)
          </h2>
          <p className="text-zinc-400">
            Automatically save the 1MP downscaled copy of images dropped, pasted, or uploaded into the Quick Gen Bar for prompt interrogation into{' '}
            <code className="font-mono text-zinc-200">
              {uploadedImagesDir}
            </code>
            .
          </p>
        </div>

        <label className="inline-flex items-center gap-3 cursor-pointer select-none">
          <span className="text-zinc-300 font-medium">
            {saveUploadedPromptImages ? 'Enabled' : 'Disabled'}
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
