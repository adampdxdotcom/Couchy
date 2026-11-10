import { appConfig } from '../config.ts';
import type { ComfyUiLiveStatus } from '../../shared/types.ts';

export const COUCHY_COMFY_CLIENT_ID = 'couchy-studio-client';

interface LiveMonitorState {
  online: boolean;
  runningCount: number;
  queuedCount: number;
  progressPercent: number | null;
  step: number | null;
  maxSteps: number | null;
  currentNode: string | null;
  lastQueueFetchMs: number;
}

const state: LiveMonitorState = {
  online: false,
  runningCount: 0,
  queuedCount: 0,
  progressPercent: null,
  step: null,
  maxSteps: null,
  currentNode: null,
  lastQueueFetchMs: 0,
};

let wsInstance: WebSocket | null = null;
let connectedWsUrl = '';
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

function buildWsUrl(httpBaseUrl: string): string {
  const clean = httpBaseUrl.trim().replace(/\/+$/, '');
  const wsBase = clean.replace(/^http:/i, 'ws:').replace(/^https:/i, 'wss:');
  return `${wsBase}/ws?clientId=${encodeURIComponent(COUCHY_COMFY_CLIENT_ID)}`;
}

/**
 * Ensures a background WebSocket listener is connected to ComfyUI /ws
 * to capture real-time step progress (value / max -> percentage).
 */
export function ensureComfyUiWsMonitor(): void {
  if (typeof WebSocket === 'undefined') return;

  const targetWsUrl = buildWsUrl(appConfig.comfyuiUrl);
  if (wsInstance && connectedWsUrl === targetWsUrl && wsInstance.readyState <= 1) {
    return;
  }

  if (wsInstance) {
    try {
      wsInstance.close();
    } catch {
      // ignore
    }
    wsInstance = null;
  }

  connectedWsUrl = targetWsUrl;
  try {
    const ws = new WebSocket(targetWsUrl);
    wsInstance = ws;

    ws.addEventListener('open', () => {
      state.online = true;
    });

    ws.addEventListener('message', (event) => {
      if (typeof event.data !== 'string') return;
      try {
        const msg = JSON.parse(event.data);
        const type = msg?.type;
        const data = msg?.data;

        if (type === 'progress' && data) {
          const val = Number(data.value ?? 0);
          const max = Number(data.max ?? 0);
          state.step = val;
          state.maxSteps = max;
          state.progressPercent =
            max > 0 ? Math.min(100, Math.max(0, Math.round((val / max) * 100))) : null;
          if (data.node) {
            state.currentNode = String(data.node);
          }
        } else if (type === 'executing' && data) {
          if (data.node === null) {
            // Current prompt finished executing
            state.progressPercent = null;
            state.step = null;
            state.maxSteps = null;
            state.currentNode = null;
          } else {
            state.currentNode = String(data.node);
          }
        } else if (type === 'execution_cached' || type === 'executed') {
          state.online = true;
        } else if (type === 'status' && data?.status?.exec_info) {
          const totalRemaining = Number(data.status.exec_info.queue_remaining ?? 0);
          if (totalRemaining === 0) {
            state.runningCount = 0;
            state.queuedCount = 0;
            state.progressPercent = null;
            state.step = null;
            state.maxSteps = null;
            state.currentNode = null;
          }
        }
      } catch {
        // ignore non-JSON frames
      }
    });

    ws.addEventListener('close', () => {
      wsInstance = null;
      if (!reconnectTimer) {
        reconnectTimer = setTimeout(() => {
          reconnectTimer = null;
          ensureComfyUiWsMonitor();
        }, 5000);
      }
    });

    ws.addEventListener('error', () => {
      // Handled by close listener
    });
  } catch {
    // WebSocket connection failed; HTTP /queue fallback will still update status
  }
}

/**
 * Queries ComfyUI GET /queue (cached for 800ms) and merges with live WebSocket step progress.
 */
export async function getComfyUiLiveStatus(): Promise<ComfyUiLiveStatus> {
  ensureComfyUiWsMonitor();

  const now = Date.now();
  if (now - state.lastQueueFetchMs >= 800) {
    state.lastQueueFetchMs = now;
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 1500);
      const res = await fetch(`${appConfig.comfyuiUrl}/queue`, {
        signal: controller.signal,
      });
      clearTimeout(timer);

      if (res.ok) {
        const data = (await res.json()) as {
          queue_running?: any[];
          queue_pending?: any[];
        };
        const running = Array.isArray(data.queue_running) ? data.queue_running.length : 0;
        const pending = Array.isArray(data.queue_pending) ? data.queue_pending.length : 0;
        state.online = true;
        state.runningCount = running;
        state.queuedCount = pending;

        if (running === 0) {
          state.progressPercent = null;
          state.step = null;
          state.maxSteps = null;
          state.currentNode = null;
        }
      } else {
        state.online = false;
        state.runningCount = 0;
        state.queuedCount = 0;
      }
    } catch {
      state.online = false;
      state.runningCount = 0;
      state.queuedCount = 0;
      state.progressPercent = null;
      state.step = null;
      state.maxSteps = null;
      state.currentNode = null;
    }
  }

  return {
    online: state.online,
    runningCount: state.runningCount,
    queuedCount: state.queuedCount,
    progressPercent: state.runningCount > 0 ? state.progressPercent : null,
    step: state.runningCount > 0 ? state.step : null,
    maxSteps: state.runningCount > 0 ? state.maxSteps : null,
    currentNode: state.runningCount > 0 ? state.currentNode : null,
  };
}
