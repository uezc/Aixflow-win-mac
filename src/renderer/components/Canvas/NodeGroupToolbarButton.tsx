/**
 * 框选多模块时的「组合 / 解除组合 / 整理」浮动条（对齐图片模块顶部工具条：单行胶囊 + 36px 间距）。
 */
import React from 'react';
import { Layers, LayoutGrid, Unlink } from 'lucide-react';

export const GROUP_COL_OPTIONS = [1, 2, 3, 4] as const;

type Props = {
  mode: 'group' | 'ungroup';
  position: { x: number; y: number };
  isDarkMode: boolean;
  cols: number;
  onColsChange: (cols: number) => void;
  onClick: () => void;
  /** 解除组合模式下：右侧「整理」 */
  onArrange?: () => void;
};

function dividerClass(isDarkMode: boolean) {
  return `mx-0.5 h-4 w-px shrink-0 ${isDarkMode ? 'bg-white/15' : 'bg-black/10'}`;
}

export default function NodeGroupToolbarButton({
  mode,
  position,
  isDarkMode,
  cols,
  onColsChange,
  onClick,
  onArrange,
}: Props) {
  const label = mode === 'group' ? '组合' : '解除组合';
  const Icon = mode === 'group' ? Layers : Unlink;
  return (
    <div
      className={[
        'pointer-events-auto absolute z-[60]',
        'flex w-max flex-nowrap items-center justify-center gap-0.5',
        'overflow-visible rounded-full px-2 py-1.5',
        isDarkMode
          ? 'nexflow-glass-panel border border-white/[0.14] shadow-[0_8px_28px_rgba(0,0,0,0.28)]'
          : 'apple-panel-light border border-black/[0.08] shadow-[0_8px_28px_rgba(0,0,0,0.06)]',
      ].join(' ')}
      style={{
        left: position.x,
        top: position.y,
        transform: 'translate(-50%, -100%)',
      }}
      onPointerDown={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
    >
      {GROUP_COL_OPTIONS.map((n) => (
        <button
          key={n}
          type="button"
          title={`${n} 列`}
          onClick={(e) => {
            e.stopPropagation();
            onColsChange(n);
          }}
          onMouseDown={(e) => e.stopPropagation()}
          className={`nodrag nopan flex h-7 min-w-[1.75rem] items-center justify-center rounded-full px-1.5 text-xs font-semibold transition ${
            cols === n
              ? isDarkMode
                ? 'bg-white/20 text-white'
                : 'bg-gray-900/10 text-gray-900'
              : isDarkMode
                ? 'text-white/70 hover:bg-white/10'
                : 'text-gray-600 hover:bg-gray-100'
          }`}
        >
          {n}
        </button>
      ))}
      <span className={dividerClass(isDarkMode)} aria-hidden />
      <button
        type="button"
        title={mode === 'group' ? `组合（${cols} 列）` : label}
        onClick={(e) => {
          e.stopPropagation();
          onClick();
        }}
        onMouseDown={(e) => e.stopPropagation()}
        className={`nodrag nopan inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium transition ${
          isDarkMode ? 'text-white/85 hover:bg-white/10' : 'text-gray-700 hover:bg-gray-100'
        }`}
      >
        <Icon className="h-3.5 w-3.5 shrink-0" strokeWidth={2.25} />
        {label}
      </button>
      {mode === 'ungroup' && onArrange ? (
        <>
          <span className={dividerClass(isDarkMode)} aria-hidden />
          <button
            type="button"
            title={`整理为 ${cols} 列`}
            onClick={(e) => {
              e.stopPropagation();
              onArrange();
            }}
            onMouseDown={(e) => e.stopPropagation()}
            className={`nodrag nopan inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium transition ${
              isDarkMode ? 'text-white/85 hover:bg-white/10' : 'text-gray-700 hover:bg-gray-100'
            }`}
          >
            <LayoutGrid className="h-3.5 w-3.5 shrink-0" strokeWidth={2.25} />
            整理
          </button>
        </>
      ) : null}
    </div>
  );
}
