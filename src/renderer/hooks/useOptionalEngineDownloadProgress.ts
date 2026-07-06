import { useEffect, useRef, useState } from 'react';

export type OptionalEngineDownloadProgress = {
  kind: 'rvc' | 'whisper';
  phase: 'downloading' | 'extracting' | 'done' | 'error';
  percent: number;
  message: string;
};

const DONE_HIDE_MS = 2000;
const ERROR_HIDE_MS = 5000;

export function useOptionalEngineDownloadProgress() {
  const [progress, setProgress] = useState<OptionalEngineDownloadProgress | null>(null);
  const [visible, setVisible] = useState(false);
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const clearHideTimer = () => {
      if (hideTimerRef.current) {
        clearTimeout(hideTimerRef.current);
        hideTimerRef.current = null;
      }
    };

    const scheduleHide = (ms: number) => {
      clearHideTimer();
      hideTimerRef.current = setTimeout(() => {
        setVisible(false);
        hideTimerRef.current = null;
      }, ms);
    };

    const unsub = window.electronAPI?.onOptionalEngineDownloadProgress?.((payload) => {
      setProgress(payload);
      setVisible(true);
      if (payload.phase === 'done') {
        scheduleHide(DONE_HIDE_MS);
      } else if (payload.phase === 'error') {
        scheduleHide(ERROR_HIDE_MS);
      } else {
        clearHideTimer();
      }
    });

    return () => {
      clearHideTimer();
      unsub?.();
    };
  }, []);

  return {
    progress,
    visible: visible && progress != null,
    percent: progress?.percent ?? 0,
    message: progress?.message ?? '',
    phase: progress?.phase,
    kind: progress?.kind,
  };
}
