import React from 'react';
import { useOptionalEngineDownloadProgress } from '../../hooks/useOptionalEngineDownloadProgress';
import { WORKSPACE_CANVAS_OVERLAY_Z } from '../../utils/workspaceChromeLayout';

type OptionalEngineDownloadBarProps = {
  isDarkMode?: boolean;
};

/**
 * 画布顶部非阻塞进度条：首次下载 RVC / 语音转写引擎时显示，不拦截画布交互。
 */
export function OptionalEngineDownloadBar({ isDarkMode = true }: OptionalEngineDownloadBarProps) {
  const { visible, percent, message, phase } = useOptionalEngineDownloadProgress();

  if (!visible) return null;

  const isError = phase === 'error';
  const barColor = isError ? '#ef4444' : isDarkMode ? '#8b5cf6' : '#7c3aed';

  return (
    <div
      className="absolute top-0 left-0 right-0 pointer-events-none"
      style={{ zIndex: WORKSPACE_CANVAS_OVERLAY_Z + 1 }}
      aria-live="polite"
      aria-label={message || '引擎下载进度'}
    >
      <div
        className="h-[3px] w-full overflow-hidden"
        style={{
          backgroundColor: isDarkMode ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.08)',
        }}
      >
        <div
          className="h-full transition-[width] duration-200 ease-out"
          style={{
            width: `${Math.max(0, Math.min(100, percent))}%`,
            backgroundColor: barColor,
          }}
        />
      </div>
      {message ? (
        <div
          className="px-3 py-1.5 text-center text-xs font-medium truncate backdrop-blur-sm"
          style={{
            color: isDarkMode ? 'rgba(255,255,255,0.92)' : 'rgba(15,23,42,0.9)',
            backgroundColor: isDarkMode ? 'rgba(0,0,0,0.45)' : 'rgba(255,255,255,0.82)',
            boxShadow: isDarkMode ? '0 4px 12px rgba(0,0,0,0.25)' : '0 4px 12px rgba(15,23,42,0.08)',
          }}
        >
          {message}
        </div>
      ) : null}
    </div>
  );
}

export default OptionalEngineDownloadBar;
