import React from 'react';
import { Upload } from 'lucide-react';

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

export interface WorkflowCreateModalProps {
  isOpen: boolean;
  newName: string;
  onChangeName: (val: string) => void;
  newDesc: string;
  onChangeDesc: (val: string) => void;
  newIsDefault: boolean;
  onChangeIsDefault: (val: boolean) => void;
  newApiJson: string;
  onChangeApiJson: (val: string) => void;
  newVisualJson: string;
  onChangeVisualJson: (val: string) => void;
  onFileUpload: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onClose: () => void;
  onSubmit: (e: React.FormEvent) => void;
}

/**
 * Modal dialog for uploading or pasting a new ComfyUI workflow JSON into the library.
 */
export const WorkflowCreateModal: React.FC<WorkflowCreateModalProps> = ({
  isOpen,
  newName,
  onChangeName,
  newDesc,
  onChangeDesc,
  newIsDefault,
  onChangeIsDefault,
  newApiJson,
  onChangeApiJson,
  newVisualJson,
  onChangeVisualJson,
  onFileUpload,
  onClose,
  onSubmit,
}) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4">
      <form
        onSubmit={onSubmit}
        className="bg-zinc-900 border border-zinc-800 rounded-xl max-w-lg w-full p-6 space-y-4 text-xs"
      >
        <div className="flex items-center justify-between">
          <h3 className="text-base font-display font-semibold text-zinc-100">
            Import / Save Workflow to Library
          </h3>
          <label className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 text-indigo-300 rounded-lg cursor-pointer">
            <Upload className="w-3.5 h-3.5" />
            <span>Load .json File</span>
            <input
              type="file"
              accept=".json,application/json"
              onChange={onFileUpload}
              className="hidden"
            />
          </label>
        </div>

        <div>
          <label className="block text-zinc-300 mb-1">Workflow Name *</label>
          <input
            type="text"
            required
            value={newName}
            onChange={(e) => onChangeName(e.target.value)}
            placeholder="e.g. Portrait Studio Lighting v3"
            className="w-full px-3 py-2 bg-zinc-950 border border-zinc-800 rounded-lg text-zinc-100"
          />
        </div>
        <div>
          <label className="block text-zinc-300 mb-1">Description</label>
          <input
            type="text"
            value={newDesc}
            onChange={(e) => onChangeDesc(e.target.value)}
            className="w-full px-3 py-2 bg-zinc-950 border border-zinc-800 rounded-lg text-zinc-100"
          />
        </div>
        <div>
          <label className="inline-flex items-center gap-2 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={newIsDefault}
              onChange={(e) => onChangeIsDefault(e.target.checked)}
              className="rounded border-zinc-700 bg-zinc-950 text-indigo-600"
            />
            <span className="text-zinc-200 font-medium">
              Set as primary Default workflow across Quick Gen & Studio
            </span>
          </label>
        </div>
        <div>
          <label className="block text-zinc-300 mb-1">
            API-Format Workflow JSON (Prompt Graph)
          </label>
          <textarea
            rows={4}
            value={newApiJson}
            onChange={(e) => onChangeApiJson(e.target.value)}
            placeholder='{"3": {"class_type": "KSampler", "inputs": {...}}}'
            className="w-full p-2.5 bg-zinc-950 border border-zinc-800 rounded-lg font-mono text-zinc-200"
          />
        </div>
        <div>
          <label className="block text-zinc-300 mb-1">
            Visual ComfyUI Workflow JSON (Optional)
          </label>
          <textarea
            rows={4}
            value={newVisualJson}
            onChange={(e) => onChangeVisualJson(e.target.value)}
            placeholder='{"nodes": [...], "links": [...]}'
            className="w-full p-2.5 bg-zinc-950 border border-zinc-800 rounded-lg font-mono text-zinc-200"
          />
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <button
            type="button"
            onClick={onClose}
            className="px-3.5 py-2 bg-zinc-800 text-zinc-300 rounded-lg cursor-pointer"
          >
            Cancel
          </button>
          <button
            type="submit"
            className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white font-medium rounded-lg cursor-pointer"
          >
            Save Workflow
          </button>
        </div>
      </form>
    </div>
  );
};
