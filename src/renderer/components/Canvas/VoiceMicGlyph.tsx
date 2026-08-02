import React from 'react';
import { Loader2, Mic } from 'lucide-react';

export type VoiceMicGlyphProps = {
  /** 0–1 输入电平；录制中驱动话筒内波动条 */
  level?: number;
  /** 正在连接 / 停止 / 转写等：转圈 */
  busy?: boolean;
  /** 录制/听写中（非 busy） */
  active?: boolean;
  className?: string;
  strokeWidth?: number;
  /** 浮动大麦用稍大尺寸 */
  size?: 'sm' | 'md' | 'lg';
};

const SIZE_MAP = {
  sm: { icon: 'h-3.5 w-3.5', barsH: 10, barsGap: 1.5, barW: 1.5 },
  md: { icon: 'h-4 w-4', barsH: 11, barsGap: 1.5, barW: 1.75 },
  lg: { icon: 'h-6 w-6', barsH: 16, barsGap: 2, barW: 2.25 },
} as const;

/**
 * 话筒图标：录制中显示随电平起伏的三根波动条（叠在麦头区域）。
 */
export const VoiceMicGlyph: React.FC<VoiceMicGlyphProps> = ({
  level = 0,
  busy = false,
  active = false,
  className = '',
  strokeWidth = 2.25,
  size = 'sm',
}) => {
  const dim = SIZE_MAP[size];
  if (busy) {
    return <Loader2 className={`relative animate-spin ${dim.icon} ${className}`.trim()} strokeWidth={strokeWidth} />;
  }

  const l = Math.max(0, Math.min(1, level));
  // 无声时几乎静止；有声时三根条错位起伏
  const h1 = active ? 0.22 + l * 0.78 : 0.18;
  const h2 = active ? 0.28 + Math.min(1, l * 1.15) * 0.72 : 0.22;
  const h3 = active ? 0.2 + Math.min(1, l * 0.95) * 0.8 : 0.16;

  return (
    <span className={`relative inline-flex items-center justify-center ${dim.icon} ${className}`.trim()}>
      <Mic className="absolute inset-0 h-full w-full" strokeWidth={strokeWidth} aria-hidden />
      {active ? (
        <span
          className="nexflow-voice-mic-bars pointer-events-none absolute left-1/2 flex items-end justify-center"
          style={{
            bottom: size === 'lg' ? '38%' : '36%',
            transform: 'translateX(-50%)',
            height: dim.barsH,
            gap: dim.barsGap,
          }}
          aria-hidden
        >
          <span
            className="nexflow-voice-mic-bar rounded-full"
            style={{ width: dim.barW, height: `${h1 * 100}%` }}
          />
          <span
            className="nexflow-voice-mic-bar rounded-full"
            style={{ width: dim.barW, height: `${h2 * 100}%` }}
          />
          <span
            className="nexflow-voice-mic-bar rounded-full"
            style={{ width: dim.barW, height: `${h3 * 100}%` }}
          />
        </span>
      ) : null}
    </span>
  );
};

export default VoiceMicGlyph;
