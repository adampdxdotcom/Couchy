import React from 'react';
import { RefreshCw } from 'lucide-react';

export type WorkspaceTab = 'gallery' | 'characters' | 'loras' | 'workflows' | 'system';

interface TopNavHeaderProps {
  activeTab: WorkspaceTab;
  onSelectTab: (tab: WorkspaceTab) => void;
  onTriggerScan: () => void;
  isScanning: boolean;
}

/**
 * Strict 3-Zone Top Bar Contract:
 * Zone 1: Single-line Brand Wordmark
 * Zone 2: 5 concise single-line workspace navigation links
 * Zone 3: 1 primary action button (Scan Directory)
 */
export const TopNavHeader: React.FC<TopNavHeaderProps> = ({
  activeTab,
  onSelectTab,
  onTriggerScan,
  isScanning,
}) => {
  const navItems: { id: WorkspaceTab; label: string }[] = [
    { id: 'gallery', label: 'Gallery' },
    { id: 'characters', label: 'Characters' },
    { id: 'loras', label: 'LoRAs & Models' },
    { id: 'workflows', label: 'Workflows' },
    { id: 'system', label: 'System & Backup' },
  ];

  return (
    <header className="flex items-center justify-between gap-8 px-6 py-3.5 bg-zinc-950 border-b border-zinc-800/80 sticky top-0 z-30">
      {/* Zone 1: Brand Wordmark */}
      <button
        type="button"
        onClick={() => onSelectTab('gallery')}
        className="text-lg font-display font-bold tracking-tight text-zinc-100 whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 rounded"
      >
        Couchy
      </button>

      {/* Zone 2: Navigation Links */}
      <nav className="flex items-center gap-6 overflow-x-auto">
        {navItems.map((item) => {
          const isActive = activeTab === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => onSelectTab(item.id)}
              className={`text-sm font-medium transition-colors whitespace-nowrap shrink-0 py-1 border-b-2 ${
                isActive
                  ? 'text-zinc-100 border-indigo-500'
                  : 'text-zinc-400 border-transparent hover:text-zinc-200 hover:border-zinc-700'
              }`}
            >
              {item.label}
            </button>
          );
        })}
      </nav>

      {/* Zone 3: 1 Primary Action */}
      <div className="flex items-center shrink-0">
        <button
          type="button"
          onClick={onTriggerScan}
          disabled={isScanning}
          className="inline-flex items-center gap-2 px-4 py-2 text-xs font-medium text-white bg-indigo-600 hover:bg-indigo-500 disabled:opacity-60 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${isScanning ? 'animate-spin' : ''}`} />
          <span>{isScanning ? 'Scanning Directory...' : 'Scan Directory'}</span>
        </button>
      </div>
    </header>
  );
};
