import React from 'react';

export interface ExportPromptModalProps {
  isOpen: boolean;
  draftName: string;
  onClose: () => void;
  onExportWithoutSaving: () => void;
  onSaveAndExport: () => void;
}

/**
 * Confirmation dialog prompting user whether to save changes before exporting.
 */
export const ExportPromptModal: React.FC<ExportPromptModalProps> = ({
  isOpen,
  draftName,
  onClose,
  onExportWithoutSaving,
  onSaveAndExport,
}) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4">
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl max-w-md w-full p-6 space-y-4 text-xs">
        <h3 className="text-base font-display font-semibold text-zinc-100">
          Save Changes Before Exporting?
        </h3>
        <p className="text-zinc-300 leading-relaxed">
          You have unsaved edits in <strong>{draftName || 'this workflow'}</strong>. Would you
          like to save your changes to the server first before downloading the JSON file?
        </p>
        <div className="flex flex-wrap justify-end gap-2 pt-2">
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded-lg cursor-pointer"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onExportWithoutSaving}
            className="px-3.5 py-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-100 font-medium rounded-lg cursor-pointer"
          >
            No, Export Without Saving
          </button>
          <button
            type="button"
            onClick={onSaveAndExport}
            className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white font-medium rounded-lg cursor-pointer"
          >
            Yes, Save & Export
          </button>
        </div>
      </div>
    </div>
  );
};
