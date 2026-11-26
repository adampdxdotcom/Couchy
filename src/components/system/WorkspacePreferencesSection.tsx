import React from 'react';

interface WorkspacePreferencesSectionProps {
  saveUploadedPromptImages: boolean;
  saveCivitaiImportImages: boolean;
  allowCivitaiShareUncharacterized: boolean;
  civitaiActivityNotificationsEnabled: boolean;
  insertCouchyMetadataOnExport: boolean;
  insertCivitaiMetadataOnExport: boolean;
  uploadedImagesDir?: string;
  onToggleSaveUploadedPromptImages: (enabled: boolean) => Promise<void>;
  onToggleSaveCivitaiImportImages: (enabled: boolean) => Promise<void>;
  onToggleAllowCivitaiShareUncharacterized: (enabled: boolean) => Promise<void>;
  onToggleCivitaiActivityNotifications: (enabled: boolean) => Promise<void>;
  onToggleInsertCouchyMetadataOnExport: (enabled: boolean) => Promise<void>;
  onToggleInsertCivitaiMetadataOnExport: (enabled: boolean) => Promise<void>;
}

export const WorkspacePreferencesSection: React.FC<WorkspacePreferencesSectionProps> = ({
  saveUploadedPromptImages,
  saveCivitaiImportImages,
  allowCivitaiShareUncharacterized,
  civitaiActivityNotificationsEnabled,
  insertCouchyMetadataOnExport,
  insertCivitaiMetadataOnExport,
  uploadedImagesDir = 'data/uploaded',
  onToggleSaveUploadedPromptImages,
  onToggleSaveCivitaiImportImages,
  onToggleAllowCivitaiShareUncharacterized,
  onToggleCivitaiActivityNotifications,
  onToggleInsertCouchyMetadataOnExport,
  onToggleInsertCivitaiMetadataOnExport,
}) => {
  return (
    <section className="grid grid-cols-1 md:grid-cols-2 gap-4">
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl px-4 py-3.5 flex items-center justify-between gap-4">
        <div className="space-y-0.5 min-w-0">
          <h2 className="text-xs font-display font-semibold text-zinc-100">
            Save Uploaded Prompt Images (1MP)
          </h2>
          <p
            className="text-[11px] text-zinc-400 leading-snug truncate"
            title={`Archive interrogated 1MP copies into ${uploadedImagesDir}`}
          >
            Archive interrogated 1MP images to{' '}
            <code className="font-mono text-zinc-200">{uploadedImagesDir}</code>.
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

      <div className="bg-zinc-900 border border-zinc-800 rounded-xl px-4 py-3.5 flex items-center justify-between gap-4">
        <div className="space-y-0.5 min-w-0">
          <h2 className="text-xs font-display font-semibold text-zinc-100">
            Save Civitai Import Images (1MP)
          </h2>
          <p
            className="text-[11px] text-zinc-400 leading-snug truncate"
            title={`Save 1MP copy of Civitai URL photos into ${uploadedImagesDir} as stack #1`}
          >
            Save 1MP Civitai URL photos to{' '}
            <code className="font-mono text-zinc-200">{uploadedImagesDir}</code> as stack #1.
          </p>
        </div>

        <label className="inline-flex items-center gap-2.5 cursor-pointer select-none shrink-0">
          <span className="text-[11px] text-zinc-300 font-medium">
            {saveCivitaiImportImages ? 'On' : 'Off'}
          </span>
          <input
            type="checkbox"
            checked={saveCivitaiImportImages}
            onChange={(e) => onToggleSaveCivitaiImportImages(e.target.checked)}
            className="sr-only peer"
          />
          <div className="w-10 h-5 bg-zinc-800 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all relative peer-checked:bg-indigo-600" />
        </label>
      </div>

      <div className="bg-zinc-900 border border-zinc-800 rounded-xl px-4 py-3.5 flex items-center justify-between gap-4">
        <div className="space-y-0.5 min-w-0">
          <h2 className="text-xs font-display font-semibold text-zinc-100">
            Share 0-Character Images (Civitai)
          </h2>
          <p
            className="text-[11px] text-zinc-400 leading-snug truncate"
            title="When On, images with zero linked characters may be shared as Civitai drafts (Off by default)"
          >
            Allow Civitai draft sharing when an image has no linked character.
          </p>
        </div>

        <label className="inline-flex items-center gap-2.5 cursor-pointer select-none shrink-0">
          <span className="text-[11px] text-zinc-300 font-medium">
            {allowCivitaiShareUncharacterized ? 'On' : 'Off'}
          </span>
          <input
            type="checkbox"
            checked={allowCivitaiShareUncharacterized}
            onChange={(e) => onToggleAllowCivitaiShareUncharacterized(e.target.checked)}
            className="sr-only peer"
          />
          <div className="w-10 h-5 bg-zinc-800 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all relative peer-checked:bg-indigo-600" />
        </label>
      </div>

      <div className="bg-zinc-900 border border-zinc-800 rounded-xl px-4 py-3.5 flex items-center justify-between gap-4">
        <div className="space-y-0.5 min-w-0">
          <h2 className="text-xs font-display font-semibold text-zinc-100">
            Civitai Activity Notifications
          </h2>
          <p
            className="text-[11px] text-zinc-400 leading-snug truncate"
            title="Show header alerts and gallery card counters for Civitai reactions & comments"
          >
            Show header alerts and gallery card counters for Civitai reactions &amp; comments.
          </p>
        </div>

        <label className="inline-flex items-center gap-2.5 cursor-pointer select-none shrink-0">
          <span className="text-[11px] text-zinc-300 font-medium">
            {civitaiActivityNotificationsEnabled ? 'On' : 'Off'}
          </span>
          <input
            type="checkbox"
            checked={civitaiActivityNotificationsEnabled}
            onChange={(e) => onToggleCivitaiActivityNotifications(e.target.checked)}
            className="sr-only peer"
          />
          <div className="w-10 h-5 bg-zinc-800 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all relative peer-checked:bg-indigo-600" />
        </label>
      </div>

      {/* Export metadata switches (both Off by default; applied in-memory on download/ZIP) */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl px-4 py-3.5 flex items-center justify-between gap-4">
        <div className="space-y-0.5 min-w-0">
          <h2 className="text-xs font-display font-semibold text-zinc-100">
            Insert Couchy Metadata on Export
          </h2>
          <p
            className="text-[11px] text-zinc-400 leading-snug truncate"
            title="Embed XMP photo metadata (rating, characters, tags, LoRAs, notes) & Couchy JSON on download/ZIP"
          >
            Embed XMP photo metadata (rating, characters, tags, LoRAs, notes) &amp; Couchy JSON on
            download/ZIP.
          </p>
        </div>

        <label className="inline-flex items-center gap-2.5 cursor-pointer select-none shrink-0">
          <span className="text-[11px] text-zinc-300 font-medium">
            {insertCouchyMetadataOnExport ? 'On' : 'Off'}
          </span>
          <input
            type="checkbox"
            checked={insertCouchyMetadataOnExport}
            onChange={(e) => onToggleInsertCouchyMetadataOnExport(e.target.checked)}
            className="sr-only peer"
          />
          <div className="w-10 h-5 bg-zinc-800 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all relative peer-checked:bg-indigo-600" />
        </label>
      </div>

      <div className="bg-zinc-900 border border-zinc-800 rounded-xl px-4 py-3.5 flex items-center justify-between gap-4">
        <div className="space-y-0.5 min-w-0">
          <h2 className="text-xs font-display font-semibold text-zinc-100">
            Insert Civitai Metadata on Export
          </h2>
          <p
            className="text-[11px] text-zinc-400 leading-snug truncate"
            title="Embed Civitai/A1111 parameters, resource IDs & LoRA hashes on download/ZIP"
          >
            Embed Civitai/A1111 parameters, resource IDs &amp; LoRA hashes on download/ZIP.
          </p>
        </div>

        <label className="inline-flex items-center gap-2.5 cursor-pointer select-none shrink-0">
          <span className="text-[11px] text-zinc-300 font-medium">
            {insertCivitaiMetadataOnExport ? 'On' : 'Off'}
          </span>
          <input
            type="checkbox"
            checked={insertCivitaiMetadataOnExport}
            onChange={(e) => onToggleInsertCivitaiMetadataOnExport(e.target.checked)}
            className="sr-only peer"
          />
          <div className="w-10 h-5 bg-zinc-800 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all relative peer-checked:bg-indigo-600" />
        </label>
      </div>
    </section>
  );
};
