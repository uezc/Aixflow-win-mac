import React from 'react';
import { useAppLocale } from '../contexts/AppLocaleContext';
import { workspaceChromeT } from '../i18n/workspaceI18n';

interface StatusBarProps {
  /** 右侧「运行中」左侧可选插槽（如全屏切换） */
  trailingControls?: React.ReactNode;
}

const StatusBar: React.FC<StatusBarProps> = ({ trailingControls }) => {
  const { locale } = useAppLocale();
  const wc = workspaceChromeT(locale);
  return (
    <div
      className="fixed top-0 left-0 right-0 z-50 apple-panel border-b"
      style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
    >
      <div className="px-6 py-3 flex items-center justify-end" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
        <div className="flex items-center gap-3">
          {trailingControls}
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-apple-blue animate-pulse" />
            <span className="text-xs text-white/60">{wc.statusRunning}</span>
          </div>
        </div>
      </div>
    </div>
  );
};

export default StatusBar;
