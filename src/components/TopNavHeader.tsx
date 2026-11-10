import React, { useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  Bell,
  CheckCircle2,
  ChevronDown,
  Info,
  Loader2,
  Trash2,
  XCircle,
} from 'lucide-react';
import type { AppToastMessage, ComfyUiLiveStatus } from '../shared/types.ts';

export type WorkspaceTab =
  | 'gallery'
  | 'characters'
  | 'generation'
  | 'loras'
  | 'workflows'
  | 'system';

interface TopNavHeaderProps {
  activeTab: WorkspaceTab;
  onSelectTab: (tab: WorkspaceTab) => void;
  comfyStatus: ComfyUiLiveStatus;
  activeToast: AppToastMessage | null;
  messages: AppToastMessage[];
  onClearMessages: () => void;
}

/**
 * 3-Zone Top Navigation Header:
 * Zone 1: Brand Wordmark
 * Zone 2: Workspace Navigation Links
 * Zone 3: Unified ComfyUI Live Progress & Toast Message Dropdown Area
 */
export const TopNavHeader: React.FC<TopNavHeaderProps> = ({
  activeTab,
  onSelectTab,
  comfyStatus,
  activeToast,
  messages,
  onClearMessages,
}) => {
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const handleOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleOutside);
    return () => document.removeEventListener('mousedown', handleOutside);
  }, []);

  const navItems: { id: WorkspaceTab; label: string }[] = [
    { id: 'gallery', label: 'Gallery' },
    { id: 'characters', label: 'Characters' },
    { id: 'generation', label: 'Generation' },
    { id: 'loras', label: 'LoRAs & Models' },
    { id: 'workflows', label: 'Workflows' },
    { id: 'system', label: 'System & Backup' },
  ];

  const isComfyBusy = comfyStatus.runningCount > 0 || comfyStatus.queuedCount > 0;
  const totalJobs = comfyStatus.runningCount + comfyStatus.queuedCount;

  const renderToastIcon = (type: AppToastMessage['type']) => {
    switch (type) {
      case 'success':
        return <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />;
      case 'warning':
        return <AlertTriangle className="w-3.5 h-3.5 text-amber-400 shrink-0" />;
      case 'error':
        return <XCircle className="w-3.5 h-3.5 text-rose-400 shrink-0" />;
      default:
        return <Info className="w-3.5 h-3.5 text-indigo-400 shrink-0" />;
    }
  };

  const getToastPillStyle = (type: AppToastMessage['type']) => {
    switch (type) {
      case 'success':
        return 'bg-emerald-950/60 border-emerald-500/50 text-emerald-200';
      case 'warning':
        return 'bg-amber-950/60 border-amber-500/50 text-amber-200';
      case 'error':
        return 'bg-rose-950/60 border-rose-500/50 text-rose-200';
      default:
        return 'bg-indigo-950/60 border-indigo-500/50 text-indigo-200';
    }
  };

  return (
    <header className="flex items-center justify-between gap-6 px-6 py-3 bg-zinc-950 border-b border-zinc-800/80 sticky top-0 z-30">
      {/* Zone 1: Brand Wordmark */}
      <button
        type="button"
        onClick={() => onSelectTab('gallery')}
        className="text-lg font-display font-bold tracking-tight text-zinc-100 whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 rounded cursor-pointer"
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
              className={`text-sm font-medium transition-colors whitespace-nowrap shrink-0 py-1 border-b-2 cursor-pointer ${
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

      {/* Zone 3: Unified Status & Toast Message Dropdown Area */}
      <div ref={dropdownRef} className="relative shrink-0">
        <button
          type="button"
          onClick={() => setDropdownOpen((prev) => !prev)}
          className={`relative overflow-hidden inline-flex items-center justify-between gap-2.5 px-3.5 py-1.5 rounded-xl border text-xs font-medium transition-all min-w-[230px] max-w-[340px] cursor-pointer ${
            activeToast
              ? getToastPillStyle(activeToast.type)
              : isComfyBusy
              ? 'bg-zinc-900 border-indigo-500/50 text-indigo-100'
              : 'bg-zinc-900/90 hover:bg-zinc-900 border-zinc-800 text-zinc-300'
          }`}
          title="Click to view recent messages and ComfyUI status"
        >
          {/* Progress Bar Fill when ComfyUI is actively running and no 3-second toast is overriding */}
          {!activeToast && isComfyBusy && comfyStatus.progressPercent !== null && (
            <div
              className="absolute inset-y-0 left-0 bg-indigo-500/20 transition-all duration-300 pointer-events-none"
              style={{ width: `${comfyStatus.progressPercent}%` }}
            />
          )}

          {/* Left Content: 3s Toast Override -> ComfyUI Progress -> Idle Status */}
          <div className="relative z-10 flex items-center gap-2 min-w-0 flex-1">
            {activeToast ? (
              <>
                {renderToastIcon(activeToast.type)}
                <span className="truncate">{activeToast.text}</span>
              </>
            ) : isComfyBusy ? (
              <>
                <Loader2 className="w-3.5 h-3.5 text-indigo-400 animate-spin shrink-0" />
                <span className="font-mono tabular-nums truncate">
                  ComfyUI{' '}
                  {comfyStatus.progressPercent !== null
                    ? `${comfyStatus.progressPercent}%`
                    : 'Running'}
                </span>
                <span className="text-indigo-300/90 font-mono tabular-nums shrink-0">
                  · {totalJobs} {totalJobs === 1 ? 'job' : 'queued'}
                </span>
              </>
            ) : (
              <>
                <span
                  className={`w-2 h-2 rounded-full shrink-0 ${
                    comfyStatus.online ? 'bg-emerald-400' : 'bg-zinc-500'
                  }`}
                />
                <span className="truncate text-zinc-300">
                  {messages.length > 0
                    ? messages[0].text
                    : comfyStatus.online
                    ? 'ComfyUI Ready'
                    : 'ComfyUI Offline'}
                </span>
              </>
            )}
          </div>

          {/* Right Badge & Chevron */}
          <div className="relative z-10 flex items-center gap-1.5 shrink-0 pl-1">
            {messages.length > 0 && (
              <span className="px-1.5 py-0.5 rounded-md bg-zinc-800/90 text-[10px] font-mono tabular-nums text-zinc-300">
                {messages.length}
              </span>
            )}
            <ChevronDown
              className={`w-3.5 h-3.5 text-zinc-400 transition-transform ${
                dropdownOpen ? 'rotate-180' : ''
              }`}
            />
          </div>
        </button>

        {/* Dropdown Panel: Live ComfyUI Summary + Last 10 Messages */}
        {dropdownOpen && (
          <div className="absolute right-0 mt-2 w-96 bg-zinc-950/98 backdrop-blur-2xl border border-zinc-800 rounded-2xl shadow-2xl overflow-hidden z-50 text-xs">
            {/* Live ComfyUI Queue Status Header */}
            <div className="px-4 py-3 bg-zinc-900/70 border-b border-zinc-800/80 space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span
                    className={`w-2 h-2 rounded-full ${
                      isComfyBusy
                        ? 'bg-indigo-400 animate-pulse'
                        : comfyStatus.online
                        ? 'bg-emerald-400'
                        : 'bg-zinc-500'
                    }`}
                  />
                  <span className="font-semibold text-zinc-100">
                    {isComfyBusy
                      ? 'ComfyUI Generating'
                      : comfyStatus.online
                      ? 'ComfyUI Idle'
                      : 'ComfyUI Offline'}
                  </span>
                </div>
                <span className="font-mono tabular-nums text-zinc-400">
                  {comfyStatus.runningCount} running · {comfyStatus.queuedCount} queued
                </span>
              </div>

              {isComfyBusy && (
                <div className="space-y-1">
                  <div className="flex items-center justify-between text-[11px] font-mono tabular-nums text-indigo-300">
                    <span>
                      Current Job Progress
                      {comfyStatus.step !== null && comfyStatus.maxSteps !== null
                        ? ` (Step ${comfyStatus.step}/${comfyStatus.maxSteps})`
                        : ''}
                    </span>
                    <span>
                      {comfyStatus.progressPercent !== null
                        ? `${comfyStatus.progressPercent}%`
                        : 'Executing...'}
                    </span>
                  </div>
                  <div className="w-full h-1.5 bg-zinc-800 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-indigo-500 transition-all duration-300"
                      style={{ width: `${comfyStatus.progressPercent ?? 15}%` }}
                    />
                  </div>
                </div>
              )}
            </div>

            {/* Last 10 Messages Header */}
            <div className="px-4 py-2 border-b border-zinc-800/60 flex items-center justify-between text-[11px] text-zinc-400">
              <div className="flex items-center gap-1.5">
                <Bell className="w-3 h-3" />
                <span>Recent Messages (Last {Math.min(10, messages.length)})</span>
              </div>
              {messages.length > 0 && (
                <button
                  type="button"
                  onClick={onClearMessages}
                  className="inline-flex items-center gap-1 text-zinc-400 hover:text-zinc-200 cursor-pointer"
                >
                  <Trash2 className="w-3 h-3" />
                  <span>Clear</span>
                </button>
              )}
            </div>

            {/* Last 10 Messages List */}
            {messages.length === 0 ? (
              <div className="p-6 text-center text-zinc-500">
                No recent messages yet. Actions and generation events will appear here.
              </div>
            ) : (
              <div className="max-h-72 overflow-y-auto divide-y divide-zinc-800/50">
                {messages.slice(0, 10).map((msg) => (
                  <div
                    key={msg.id}
                    className="px-4 py-2.5 flex items-start justify-between gap-3 hover:bg-zinc-900/50"
                  >
                    <div className="flex items-start gap-2.5 min-w-0">
                      <div className="mt-0.5">{renderToastIcon(msg.type)}</div>
                      <span className="text-zinc-200 leading-relaxed break-words">
                        {msg.text}
                      </span>
                    </div>
                    <span className="text-[10px] font-mono tabular-nums text-zinc-500 shrink-0 mt-0.5">
                      {msg.createdAt}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </header>
  );
};
