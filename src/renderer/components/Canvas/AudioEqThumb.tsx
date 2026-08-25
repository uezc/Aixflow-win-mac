/**
 * 紫色 equalizer 缩略图：对齐音频节点波形色，用于参考音槽位 / @ 菜单 / 提示词胶囊。
 */
import React, { useMemo } from 'react';
import { buildAudioEqBarHeightsPct } from '../../utils/audioEqThumb';
import { audioWaveBarGradient } from './AudioWaveformVisualizer';

export type AudioEqThumbProps = {
  seed?: string;
  barCount?: number;
  isDarkMode?: boolean;
  indexLabel?: number | string;
  className?: string;
  title?: string;
};

export const AudioEqThumb: React.FC<AudioEqThumbProps> = ({
  seed = 'audio',
  barCount = 5,
  isDarkMode = true,
  indexLabel,
  className = '',
  title,
}) => {
  const heights = useMemo(() => buildAudioEqBarHeightsPct(seed, barCount), [seed, barCount]);
  const barGrad = audioWaveBarGradient(isDarkMode);
  return (
    <span
      className={`mention-ref-thumb-audio relative inline-flex items-end justify-center gap-[1.5px] overflow-hidden rounded-md ${className}`}
      title={title}
      aria-hidden={title ? undefined : true}
    >
      {heights.map((pct, i) => (
        <span
          key={i}
          className={`mention-ref-thumb-audio-bar origin-bottom ${barGrad}`}
          style={{ height: `${pct}%` }}
        />
      ))}
      {indexLabel != null && String(indexLabel) !== '' ? (
        <span className="mention-ref-thumb-audio-index">{indexLabel}</span>
      ) : null}
    </span>
  );
};

export default AudioEqThumb;
