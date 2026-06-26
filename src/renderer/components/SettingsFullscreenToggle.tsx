import React, { useCallback, useEffect, useState } from 'react';
import { Maximize2, Minimize2 } from 'lucide-react';
import { useAppLocale } from '../contexts/AppLocaleContext';
import { workspaceChromeT } from '../i18n/workspaceI18n';
import { readIsDarkMode, NEXFLOW_THEME_CHANGE_EVENT } from '../utils/appTheme';
import { scratchTintClass } from '../theme/scratchColors';

/**
 * 账户页顶栏：与画布顶栏一致调用主进程全屏切换；明亮模式 Scratch 彩色图标按钮。
 */
const SettingsFullscreenToggle: React.FC = () => {
  const { locale } = useAppLocale();
  const wc = workspaceChromeT(locale);
  const [isFullScreen, setIsFullScreen] = useState(false);
  const [isDarkMode, setIsDarkMode] = useState(() => readIsDarkMode());

  useEffect(() => {
    const onTheme = (e: Event) => {
      const detail = (e as CustomEvent<{ isDarkMode?: boolean }>).detail;
      if (typeof detail?.isDarkMode === 'boolean') setIsDarkMode(detail.isDarkMode);
    };
    window.addEventListener(NEXFLOW_THEME_CHANGE_EVENT, onTheme);
    return () => window.removeEventListener(NEXFLOW_THEME_CHANGE_EVENT, onTheme);
  }, []);

  const sync = useCallback(async () => {
    try {
      const api = window.electronAPI;
      if (!api?.getFullscreenState) return;
      const { isFullScreen: v } = await api.getFullscreenState();
      setIsFullScreen(!!v);
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    void sync();
  }, [sync]);

  useEffect(() => {
    const onFocus = () => void sync();
    const onVis = () => {
      if (document.visibilityState === 'visible') void sync();
    };
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVis);
    return () => {
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [sync]);

  const onClick = useCallback(async () => {
    if (!window.electronAPI?.toggleFullscreen) return;
    try {
      const r = await window.electronAPI.toggleFullscreen();
      if (r && typeof r.isFullScreen === 'boolean') {
        setIsFullScreen(r.isFullScreen);
      } else {
        void sync();
      }
    } catch (err) {
      console.error('切换全屏失败:', err);
    }
  }, [sync]);

  const btnCls = isDarkMode
    ? 'inline-flex items-center justify-center rounded-lg border-0 bg-zinc-800/85 hover:bg-zinc-700/80 text-white p-2 transition-colors shrink-0 outline-none shadow-none focus-visible:ring-1 focus-visible:ring-white/15'
    : `inline-flex items-center justify-center rounded-lg p-2 transition-colors shrink-0 outline-none shadow-none scratch-float-btn ${scratchTintClass('sensing')}`;

  return (
    <button
      type="button"
      onClick={() => void onClick()}
      className={btnCls}
      title={wc.fullscreenTitle}
      aria-label={wc.fullscreenTitle}
      aria-pressed={isFullScreen}
    >
      {isFullScreen ? <Minimize2 className="w-4 h-4" strokeWidth={2} /> : <Maximize2 className="w-4 h-4" strokeWidth={2} />}
    </button>
  );
};

export default SettingsFullscreenToggle;
