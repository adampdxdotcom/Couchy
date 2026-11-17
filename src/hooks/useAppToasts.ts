import { useCallback, useEffect, useRef, useState } from 'react';
import type { AppToastMessage } from '../shared/types.ts';

/**
 * Manages global header toast notifications and the rolling 10-item message log.
 */
export function useAppToasts() {
  const [messages, setMessages] = useState<AppToastMessage[]>([]);
  const [activeToast, setActiveToast] = useState<AppToastMessage | null>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (toastTimerRef.current) {
        clearTimeout(toastTimerRef.current);
      }
    };
  }, []);

  const pushToast = useCallback(
    (text: string, type: AppToastMessage['type'] = 'info') => {
      const now = new Date();
      const timeStr = now.toTimeString().slice(0, 8);
      const entry: AppToastMessage = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        text,
        type,
        createdAt: timeStr,
      };
      setMessages((prev) => [entry, ...prev].slice(0, 10));
      setActiveToast(entry);

      if (toastTimerRef.current) {
        clearTimeout(toastTimerRef.current);
      }
      // Show incoming message for 3 seconds, then revert to ComfyUI progress / status
      toastTimerRef.current = setTimeout(() => {
        setActiveToast(null);
        toastTimerRef.current = null;
      }, 3000);
    },
    []
  );

  const clearMessages = useCallback(() => {
    if (toastTimerRef.current) {
      clearTimeout(toastTimerRef.current);
      toastTimerRef.current = null;
    }
    setMessages([]);
    setActiveToast(null);
  }, []);

  return { messages, activeToast, pushToast, clearMessages };
}
