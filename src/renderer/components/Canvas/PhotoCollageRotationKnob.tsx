import React, { useCallback, useRef } from 'react';

export type RotationKnobAccent = 'violet' | 'sky' | 'amber' | 'emerald' | 'rose';

export interface PhotoCollageRotationKnobProps {
  /** 当前角度（度） */
  value: number;
  disabled?: boolean;
  isDarkMode?: boolean;
  size?: number;
  title?: string;
  /** 明亮模式下的主色；暗色模式仍用半透明强调色 */
  accent?: RotationKnobAccent;
  onChange: (degrees: number) => void;
  onCommit?: (degrees: number) => void;
}

const ACCENT_SKIN: Record<
  RotationKnobAccent,
  { lightRing: string; lightTick: string; lightDot: string; darkRing: string; darkTick: string; darkDot: string }
> = {
  violet: {
    lightRing: 'border-violet-500 bg-gradient-to-br from-violet-400 to-fuchsia-500 shadow-md shadow-violet-300/50',
    lightTick: 'bg-white',
    lightDot: 'bg-white',
    darkRing: 'border-violet-400/45 bg-violet-500/20 shadow-[inset_0_1px_2px_rgba(0,0,0,0.35)]',
    darkTick: 'bg-violet-300',
    darkDot: 'bg-violet-200/90',
  },
  sky: {
    lightRing: 'border-sky-500 bg-gradient-to-br from-sky-400 to-cyan-500 shadow-md shadow-sky-300/50',
    lightTick: 'bg-white',
    lightDot: 'bg-white',
    darkRing: 'border-sky-400/45 bg-sky-500/20 shadow-[inset_0_1px_2px_rgba(0,0,0,0.35)]',
    darkTick: 'bg-sky-300',
    darkDot: 'bg-sky-200/90',
  },
  amber: {
    lightRing: 'border-amber-500 bg-gradient-to-br from-amber-400 to-orange-500 shadow-md shadow-amber-300/50',
    lightTick: 'bg-white',
    lightDot: 'bg-white',
    darkRing: 'border-amber-400/45 bg-amber-500/20 shadow-[inset_0_1px_2px_rgba(0,0,0,0.35)]',
    darkTick: 'bg-amber-300',
    darkDot: 'bg-amber-200/90',
  },
  emerald: {
    lightRing: 'border-emerald-500 bg-gradient-to-br from-emerald-400 to-teal-500 shadow-md shadow-emerald-300/50',
    lightTick: 'bg-white',
    lightDot: 'bg-white',
    darkRing: 'border-emerald-400/45 bg-emerald-500/20 shadow-[inset_0_1px_2px_rgba(0,0,0,0.35)]',
    darkTick: 'bg-emerald-300',
    darkDot: 'bg-emerald-200/90',
  },
  rose: {
    lightRing: 'border-rose-500 bg-gradient-to-br from-rose-400 to-pink-500 shadow-md shadow-rose-300/50',
    lightTick: 'bg-white',
    lightDot: 'bg-white',
    darkRing: 'border-rose-400/45 bg-rose-500/20 shadow-[inset_0_1px_2px_rgba(0,0,0,0.35)]',
    darkTick: 'bg-rose-300',
    darkDot: 'bg-rose-200/90',
  },
};

/** 拼图 / 图片模块：圆形旋转旋钮，拖动即可调整角度 */
export const PhotoCollageRotationKnob: React.FC<PhotoCollageRotationKnobProps> = ({
  value,
  disabled = false,
  isDarkMode = true,
  size = 28,
  title = '拖动旋钮旋转',
  accent = 'violet',
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

  const skin = ACCENT_SKIN[accent] ?? ACCENT_SKIN.violet;
  const ring = isDarkMode ? skin.darkRing : skin.lightRing;
  const tick = isDarkMode ? skin.darkTick : skin.lightTick;
  const dot = isDarkMode ? skin.darkDot : skin.lightDot;
  const tickW = size >= 40 ? 2.5 : 2;
  const centerDot = size >= 40 ? 6 : 4;

  return (
    <div
      ref={knobRef}
      role="slider"
      aria-label={title}
      aria-valuemin={-360}
      aria-valuemax={360}
      aria-valuenow={Math.round(value)}
      title={title}
      className={`relative shrink-0 rounded-full border nodrag nopan touch-none select-none ${
        disabled ? 'opacity-35 pointer-events-none' : 'cursor-grab active:cursor-grabbing'
      } ${ring}`}
      style={{ width: size, height: size }}
      onPointerDown={onPointerDown}
    >
      <div
        className="absolute left-1/2 top-1/2 h-[42%] origin-bottom rounded-full"
        style={{
          width: tickW,
          transform: `translate(-50%, -100%) rotate(${value}deg)`,
        }}
      >
        <div className={`h-full w-full rounded-full ${tick}`} />
      </div>
      <div
        className={`absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full ${dot}`}
        style={{ width: centerDot, height: centerDot }}
      />
    </div>
  );
};
