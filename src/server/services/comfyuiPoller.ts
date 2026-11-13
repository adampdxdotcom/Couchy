import fs from 'fs';
import path from 'path';
import { db } from '../db.ts';
import { appConfig } from '../config.ts';
import { indexSingleImageFile, runDirectoryScan } from './scannerService.ts';
import { notifyImageIndexed } from './comfyuiLiveMonitor.ts';

export interface PolledComfyOutputResult {
  outputImageIds: number[];
  firstImageId: number | null;
  firstOutputSpec: { filename: string; subfolder: string } | null;
}

export interface PollComfyPromptOptions {
  promptId: string;
  characterId?: number | null;
  maxAttempts?: number;
  intervalMs?: number;
  onSuccess: (result: PolledComfyOutputResult) => void | Promise<void>;
  onError?: (errorMessage: string) => void | Promise<void>;
  onTimeout?: () => void | Promise<void>;
}

function formatComfyHistoryError(messages: unknown): string {
  if (Array.isArray(messages)) {
    for (const msg of messages) {
      if (Array.isArray(msg) && msg[0] === 'execution_error' && msg[1] && typeof msg[1] === 'object') {
        const details = msg[1] as Record<string, any>;
        const excMsg = String(details.exception_message || '').trim();
        const nodeType = String(details.node_type || '').trim();
        if (excMsg && nodeType) return `${nodeType}: ${excMsg}`;
        if (excMsg) return excMsg;
      }
    }
  }
  if (typeof messages === 'string' && messages.trim()) {
    return messages.trim();
  }
  return 'ComfyUI execution error';
}

/**
 * Polls ComfyUI `/history/<promptId>` until completion or error, indexes any generated
 * output files into SQLite, runs caller hooks, and notifies live gallery listeners.
 */
export function pollComfyPromptCompletion(options: PollComfyPromptOptions): void {
  const {
    promptId,
    characterId = null,
    maxAttempts = 480,
    intervalMs = 2500,
    onSuccess,
    onError,
    onTimeout,
  } = options;

  const tick = (attempt: number) => {
    if (attempt > maxAttempts) {
      Promise.resolve(onTimeout?.()).catch((err) => {
        console.warn(`ComfyUI poller timeout handler failed for ${promptId}:`, err);
      });
      return;
    }

    setTimeout(async () => {
      try {
        const res = await fetch(`${appConfig.comfyuiUrl}/history/${promptId}`);
        if (res.ok) {
          const hist = (await res.json()) as Record<string, any>;
          const entry = hist[promptId];
          if (entry) {
            if (entry.status?.status_str === 'error') {
              const errMsg = formatComfyHistoryError(entry.status?.messages);
              await onError?.(errMsg);
              return;
            }

            const outputImageIds: number[] = [];
            let firstOutputSpec: { filename: string; subfolder: string } | null = null;
            let anyIndexed = false;
            const outputs = entry.outputs || {};

            for (const nodeOut of Object.values(outputs) as any[]) {
              if (!Array.isArray(nodeOut?.images) || nodeOut.images.length === 0) continue;
              for (const imgSpec of nodeOut.images) {
                if (imgSpec?.type === 'temp') continue;
                const filename = imgSpec?.filename;
                const subfolder = imgSpec?.subfolder || '';
                if (!filename) continue;
                if (!firstOutputSpec) {
                  firstOutputSpec = { filename, subfolder };
                }

                const fullPath = path.join(appConfig.comfyuiOutputDir, subfolder, filename);
                if (fs.existsSync(fullPath)) {
                  const resIndex = await indexSingleImageFile(
                    fullPath,
                    appConfig.comfyuiOutputDir,
                    false,
                    characterId
                  );
                  if (resIndex.imageId) {
                    outputImageIds.push(resIndex.imageId);
                    anyIndexed = true;
                  }
                } else {
                  const imgRow = db
                    .prepare('SELECT id FROM images WHERE filename = ? ORDER BY id DESC LIMIT 1')
                    .get(filename) as { id: number } | undefined;
                  if (imgRow) {
                    outputImageIds.push(imgRow.id);
                  }
                }
              }
            }

            await onSuccess({
              outputImageIds,
              firstImageId: outputImageIds[0] ?? null,
              firstOutputSpec,
            });

            if (anyIndexed || outputImageIds.length > 0) {
              notifyImageIndexed();
            } else {
              runDirectoryScan('incremental');
            }
            return;
          }
        }
        tick(attempt + 1);
      } catch {
        tick(attempt + 1);
      }
    }, intervalMs);
  };

  tick(0);
}
