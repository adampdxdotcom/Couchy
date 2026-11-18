/**
 * Public facade for ComfyUI WebSocket/HTTP live status monitoring,
 * workspace mutation version tracking, and active ghost-card aggregation under `./liveMonitor/`.
 */

export {
  COUCHY_COMFY_CLIENT_ID,
  invalidateComfyQueueCache,
  notifyImageIndexed,
  notifyWorkspaceDataChanged,
  recordComfyExecutionError,
  registerQueuedPromptSeriesTarget,
} from './liveMonitor/liveMonitorState.ts';

export { extractMetadataFromPromptGraph } from './liveMonitor/promptGraphUtils.ts';

export { getActiveGhostItems } from './liveMonitor/ghostCardAggregator.ts';

export {
  ensureComfyUiWsMonitor,
  getComfyUiLiveStatus,
} from './liveMonitor/comfyuiTransportMonitor.ts';
