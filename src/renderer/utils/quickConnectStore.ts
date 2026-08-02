/** Ctrl+点击快速连线模式：供画布 / 节点判断与同步 DOM class */

let quickConnectActive = false;
let quickConnectSourceId: string | null = null;

export function syncQuickConnectState(active: boolean, sourceId: string | null = null): void {
  quickConnectActive = active;
  quickConnectSourceId = active ? sourceId : null;
  if (typeof document !== 'undefined') {
    document.documentElement.classList.toggle('nexflow-quick-connect-on', active);
  }
}

export function readQuickConnectState(): { active: boolean; sourceId: string | null } {
  return { active: quickConnectActive, sourceId: quickConnectSourceId };
}

export function isQuickConnectActive(): boolean {
  return quickConnectActive;
}

/** 轻量 toast（成功连线等），不打断画布操作 */
export function showQuickConnectToast(message: string, isDarkMode = true): void {
  if (typeof document === 'undefined') return;
  const toast = document.createElement('div');
  toast.textContent = message;
  toast.style.cssText = `
    position: fixed;
    top: 20px;
    left: 50%;
    transform: translateX(-50%);
    background: ${isDarkMode ? 'rgba(0, 0, 0, 0.82)' : 'rgba(255, 255, 255, 0.94)'};
    color: ${isDarkMode ? '#fff' : '#111'};
    padding: 10px 20px;
    border-radius: 8px;
    box-shadow: 0 4px 14px rgba(0, 0, 0, 0.18);
    z-index: 10000;
    font-size: 13px;
    font-weight: 560;
    pointer-events: none;
    animation: nexflow-qc-toast-in 0.28s ease-out;
  `;
  if (!document.getElementById('nexflow-qc-toast-style')) {
    const style = document.createElement('style');
    style.id = 'nexflow-qc-toast-style';
    style.textContent = `
      @keyframes nexflow-qc-toast-in {
        from { opacity: 0; transform: translateX(-50%) translateY(-6px); }
        to { opacity: 1; transform: translateX(-50%) translateY(0); }
      }
    `;
    document.head.appendChild(style);
  }
  document.body.appendChild(toast);
  window.setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transition = 'opacity 0.2s ease';
    window.setTimeout(() => toast.remove(), 220);
  }, 1600);
}
