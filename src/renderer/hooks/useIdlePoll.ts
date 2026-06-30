import { useEffect } from 'react';

/** 侧栏/后台列表：仅在 active 且窗口可见时轮询，避免空转占用主线程 */
export function useIdlePoll(active: boolean, callback: () => void, intervalMs = 20000) {
  useEffect(() => {
    if (!active) return;
    const tick = () => {
      if (document.visibilityState !== 'visible') return;
      callback();
    };
    const id = window.setInterval(tick, intervalMs);
    const onVisibility = () => {
      if (document.visibilityState === 'visible') tick();
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.clearInterval(id);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [active, callback, intervalMs]);
}
