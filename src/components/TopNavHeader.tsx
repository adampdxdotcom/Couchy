import React, { useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  Bell,
  CheckCircle2,
  ChevronDown,
  Images,
  Info,
  Layers,
  Loader2,
  Menu,
  Network,
  Settings,
  Sparkles,
  Trash2,
  Users,
  X,
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
  isMobileMenuOpen?: boolean;
  onMobileMenuOpenChange?: (open: boolean) => void;
  lmStudioStatus?: {
    online: boolean;
    selectedModel?: string;
    baseUrl?: string;
  };
}

/**
 * 3-Zone Top Navigation Header:
 * Zone 1: Mobile Hamburger Toggle + Brand Wordmark
 * Zone 2: Workspace Navigation Links (Desktop)
 * Zone 3: Unified ComfyUI Live Progress & Toast Message Dropdown Area
 */
export const TopNavHeader: React.FC<TopNavHeaderProps> = ({
  activeTab,
  onSelectTab,
  comfyStatus,
  activeToast,
  messages,
  onClearMessages,
  isMobileMenuOpen,
  onMobileMenuOpenChange,
  lmStudioStatus,
}) => {
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [internalMobileMenuOpen, setInternalMobileMenuOpen] = useState(false);
  const mobileMenuOpen = isMobileMenuOpen !== undefined ? isMobileMenuOpen : internalMobileMenuOpen;

  const setMobileMenuOpenState = (valueOrUpdater: boolean | ((prev: boolean) => boolean)) => {
    const next = typeof valueOrUpdater === 'function' ? valueOrUpdater(mobileMenuOpen) : valueOrUpdater;
    if (isMobileMenuOpen === undefined) {
      setInternalMobileMenuOpen(next);
    }
    onMobileMenuOpenChange?.(next);
  };

  const dropdownRef = useRef<HTMLDivElement | null>(null);
  const mobileMenuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const handleOutside = (e: MouseEvent) => {
      const target = e.target as Node;
      if (dropdownRef.current && !dropdownRef.current.contains(target)) {
        setDropdownOpen(false);
      }
      if (
        mobileMenuRef.current &&
        !mobileMenuRef.current.contains(target) &&
        !(target as HTMLElement).closest?.('[data-mobile-menu-trigger]')
      ) {
        setMobileMenuOpenState(false);
      }
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setDropdownOpen(false);
        setMobileMenuOpenState(false);
      }
    };

    const handleResize = () => {
      if (window.innerWidth >= 768) {
        setMobileMenuOpenState(false);
      }
    };

    document.addEventListener('mousedown', handleOutside);
    document.addEventListener('keydown', handleKeyDown);
    window.addEventListener('resize', handleResize);
    return () => {
      document.removeEventListener('mousedown', handleOutside);
      document.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('resize', handleResize);
    };
  }, [mobileMenuOpen, isMobileMenuOpen]);

  const navItems: {
    id: WorkspaceTab;
    label: string;
    icon: React.ComponentType<{ className?: string }>;
  }[] = [
    { id: 'gallery', label: 'Gallery', icon: Images },
    { id: 'characters', label: 'Characters', icon: Users },
    { id: 'generation', label: 'Generation Studio', icon: Sparkles },
    { id: 'loras', label: 'LoRAs & Models', icon: Layers },
    { id: 'workflows', label: 'Workflow', icon: Network },
    { id: 'system', label: 'System & Backup', icon: Settings },
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
    <header className="relative flex items-center justify-between gap-3 sm:gap-6 px-3.5 sm:px-6 py-2.5 sm:py-3 bg-zinc-950 border-b border-zinc-800/80 sticky top-0 z-40">
      {/* Zone 1: Mobile Hamburger Toggle & Brand Wordmark */}
      <div className="flex items-center gap-2 sm:gap-3 shrink-0">
        <button
          type="button"
          data-mobile-menu-trigger="true"
          onClick={() => {
            setMobileMenuOpenState((prev) => !prev);
            if (dropdownOpen) setDropdownOpen(false);
          }}
          className="md:hidden inline-flex items-center justify-center min-w-[44px] min-h-[44px] rounded-xl text-zinc-300 hover:text-zinc-100 hover:bg-zinc-900 border border-zinc-800/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 cursor-pointer transition-colors"
          aria-label={mobileMenuOpen ? 'Close navigation menu' : 'Open navigation menu'}
          aria-expanded={mobileMenuOpen}
        >
          {mobileMenuOpen ? (
            <X className="w-5 h-5 text-zinc-200" />
          ) : (
            <Menu className="w-5 h-5 text-zinc-200" />
          )}
        </button>

        <button
          type="button"
          onClick={() => {
            onSelectTab('gallery');
            setMobileMenuOpenState(false);
          }}
          className="text-lg font-display font-bold tracking-tight text-zinc-100 whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 rounded cursor-pointer py-1"
        >
          Couchy
        </button>
      </div>

      {/* Zone 2: Navigation Links (Desktop only, hidden on mobile) */}
      <nav className="hidden md:flex items-center gap-6 overflow-x-auto">
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
          onClick={() => {
            setDropdownOpen((prev) => !prev);
            if (mobileMenuOpen) setMobileMenuOpenState(false);
          }}
          className={`relative overflow-hidden inline-flex items-center justify-between gap-2 px-2.5 sm:px-3.5 py-1.5 rounded-xl border text-xs font-medium transition-all min-w-[140px] xs:min-w-[180px] sm:min-w-[230px] max-w-[190px] xs:max-w-[240px] sm:max-w-[340px] cursor-pointer ${
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
          <div className="relative z-10 flex items-center gap-1.5 sm:gap-2 min-w-0 flex-1">
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
                <span className="hidden sm:inline text-indigo-300/90 font-mono tabular-nums shrink-0">
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
          <div className="absolute right-0 mt-2 w-[calc(100vw-1.75rem)] sm:w-96 max-w-sm bg-zinc-950/98 backdrop-blur-2xl border border-zinc-800 rounded-2xl shadow-2xl overflow-hidden z-50 text-xs">
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

              {lmStudioStatus && (
                <div className="flex items-center justify-between pt-1.5 border-t border-zinc-800/60 text-[11px]">
                  <div className="flex items-center gap-2">
                    <span
                      className={`w-2 h-2 rounded-full ${
                        lmStudioStatus.online ? 'bg-emerald-400' : 'bg-zinc-500'
                      }`}
                    />
                    <span className="font-semibold text-zinc-200">
                      LM Studio {lmStudioStatus.online ? 'Online' : 'Offline'}
                    </span>
                  </div>
                  <span className="font-mono text-zinc-400 truncate max-w-[150px]">
                    {lmStudioStatus.online
                      ? lmStudioStatus.selectedModel || 'Connected'
                      : 'Disconnected'}
                  </span>
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

      {/* Mobile Navigation Slide-Down Drawer */}
      {mobileMenuOpen && (
        <>
          {/* Scrim backdrop */}
          <div
            className="fixed inset-0 top-[53px] sm:top-[57px] bg-black/85 backdrop-blur-sm z-30 md:hidden"
            onClick={() => setMobileMenuOpenState(false)}
            aria-hidden="true"
          />

          {/* Slide-Down Menu Panel */}
          <div
            ref={mobileMenuRef}
            className="md:hidden absolute top-full left-0 right-0 bg-zinc-950 border-b border-zinc-800 shadow-2xl z-50 px-3 py-3 space-y-1 animate-in fade-in slide-in-from-top-2 duration-150"
          >
            <div className="px-3 py-1 text-[10px] font-mono uppercase tracking-wider text-zinc-500">
              Workspace Navigation
            </div>
            {navItems.map((item) => {
              const isActive = activeTab === item.id;
              const Icon = item.icon;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => {
                    onSelectTab(item.id);
                    setMobileMenuOpenState(false);
                  }}
                  className={`w-full flex items-center gap-3 px-3.5 py-3 rounded-xl text-sm font-medium transition-colors text-left cursor-pointer min-h-[48px] ${
                    isActive
                      ? 'bg-indigo-600/15 text-indigo-200 border border-indigo-500/40'
                      : 'text-zinc-300 hover:text-zinc-100 hover:bg-zinc-900/80 border border-transparent'
                  }`}
                >
                  <Icon
                    className={`w-4 h-4 shrink-0 ${
                      isActive ? 'text-indigo-400' : 'text-zinc-400'
                    }`}
                  />
                  <span className="flex-1 font-medium">{item.label}</span>
                  {isActive && (
                    <span className="px-2 py-0.5 rounded text-[10px] font-mono uppercase bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">
                      Active
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </>
      )}
    </header>
  );
};
