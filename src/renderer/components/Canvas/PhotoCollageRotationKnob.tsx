import React, { useCallback, useRef } from 'react';

export interface PhotoCollageRotationKnobProps {
  /** 当前角度（度） */
  value: number;
  disabled?: boolean;
  isDarkMode?: boolean;
  size?: number;
  title?: string;
  onChange: (degrees: number) => void;
  onCommit?: (degrees: number) => void;
}

/** 拼图 / 图片模块：圆形旋转旋钮，拖动即可调整角度 */
export const PhotoCollageRotationKnob: React.FC<PhotoCollageRotationKnobProps> = ({
  value,
  disabled = false,
  isDarkMode = true,
  size = 28,
  title = '拖动旋钮旋转',
  onChange,
  onCommit,
}) => {
  const knobRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ startPointerRad: number; startValue: number } | null>(null);
  const latestDegRef = useRef(value);
  latestDegRef.current = value;

  const onPointerMove = useCallback(
    (ev: PointerEvent) => {
      const knob = knobRef.current;
      const d = dragRef.current;
      if (!knob || !d) return;
      const rect = knob.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      const pointerRad = Math.atan2(ev.clientY - cy, ev.clientX - cx);
      const deltaDeg = ((pointerRad - d.startPointerRad) * 180) / Math.PI;
      const next = d.startValue + deltaDeg;
      latestDegRef.current = next;
      onChange(next);
    },
    [onChange],
  );

  const onPointerUp = useCallback(() => {
    const hadDrag = !!dragRef.current;
    dragRef.current = null;
    if (hadDrag) onCommit?.(latestDegRef.current);
    window.removeEventListener('pointermove', onPointerMove);
    window.removeEventListener('pointerup', onPointerUp);
    window.removeEventListener('pointercancel', onPointerUp);
  }, [onCommit, onPointerMove]);

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (disabled) return;
      e.stopPropagation();
      e.preventDefault();
      const knob = knobRef.current;
      if (!knob) return;
      const rect = knob.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      dragRef.current = {
        startPointerRad: Math.atan2(e.clientY - cy, e.clientX - cx),
        startValue: value,
      };
      knob.setPointerCapture(e.pointerId);
      window.addEventListener('pointermove', onPointerMove);
      window.addEventListener('pointerup', onPointerUp);
      window.addEventListener('pointercancel', onPointerUp);
    },
    [disabled, onPointerMove, onPointerUp, value],
  );

  const ring = isDarkMode ? 'border-white/25 bg-zinc-800/90' : 'border-gray-300 bg-gray-100';
  const tick = isDarkMode ? 'bg-violet-400' : 'bg-violet-600';

  return (
    <div
      ref={knobRef}
      role="slider"
      aria-label={title}
      aria-valuemin={-360}
      aria-valuemax={360}
      aria-valuenow={Math.round(value)}
      title={title}
      className={`relative shrink-0 rounded-full border shadow-inner nodrag nopan touch-none select-none ${
        disabled ? 'opacity-35 pointer-events-none' : 'cursor-grab active:cursor-grabbing'
      } ${ring}`}
      style={{ width: size, height: size }}
      onPointerDown={onPointerDown}
    >
      <div
        className="absolute left-1/2 top-1/2 h-[42%] w-0.5 origin-bottom rounded-full"
        style={{
          transform: `translate(-50%, -100%) rotate(${value}deg)`,
        }}
      >
        <div className={`h-full w-full ${tick}`} />
      </div>
      <div
        className={`absolute left-1/2 top-1/2 h-1 w-1 -translate-x-1/2 -translate-y-1/2 rounded-full ${
          isDarkMode ? 'bg-white/50' : 'bg-gray-500'
        }`}
      />
    </div>
  );
};
