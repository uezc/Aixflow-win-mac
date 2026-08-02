/**
 * MV 导演分镜表 / 视频表行虚拟化。
 * 用 spacer 行保留原生 table 布局与 sticky thead，仅 mount 视口内行 + overscan。
 */
import React, { forwardRef, useImperativeHandle, useRef } from 'react';
import { useVirtualizer, type VirtualItem } from '@tanstack/react-virtual';

export const DIRECTOR_MV_SHOT_ROW_ESTIMATE_PX = 152;
export const DIRECTOR_MV_VIDEO_ROW_ESTIMATE_PX = 160;
export const DIRECTOR_MV_TABLE_OVERSCAN = 5;

export function DirectorTableVirtualPad({
  height,
  colSpan,
}: {
  height: number;
  colSpan: number;
}) {
  if (height <= 0) return null;
  return (
    <tr aria-hidden="true">
      <td
        colSpan={colSpan}
        style={{
          height,
          padding: 0,
          border: 'none',
          lineHeight: 0,
          verticalAlign: 'top',
        }}
      />
    </tr>
  );
}

export type DirectorShotTableVirtualRenderArgs = {
  virtualItems: VirtualItem[];
  paddingTop: number;
  paddingBottom: number;
  measureElement: (node: Element | null) => void;
};

export type DirectorShotTableVirtualHandle = {
  scrollToIndex: (
    index: number,
    opts?: {
      align?: 'auto' | 'start' | 'center' | 'end';
      behavior?: ScrollBehavior;
    },
  ) => void;
  getScrollElement: () => HTMLDivElement | null;
};

type DirectorShotTableVirtualProps = {
  count: number;
  estimateSize?: number | ((index: number) => number);
  overscan?: number;
  getItemKey?: (index: number) => string | number;
  className?: string;
  style?: React.CSSProperties;
  children: (args: DirectorShotTableVirtualRenderArgs) => React.ReactNode;
};

/**
 * 滚动容器 + 行虚拟化。children 内渲染完整 `<table>`（含 thead/tbody），
 * 在 tbody 首尾插入 `DirectorTableVirtualPad`，中间只渲染 virtualItems。
 * 行上需设置 `ref={measureElement}` 与 `data-index={rowIndex}`（行高可变时）。
 */
export const DirectorShotTableVirtual = forwardRef<
  DirectorShotTableVirtualHandle,
  DirectorShotTableVirtualProps
>(function DirectorShotTableVirtual(
  {
    count,
    estimateSize = DIRECTOR_MV_SHOT_ROW_ESTIMATE_PX,
    overscan = DIRECTOR_MV_TABLE_OVERSCAN,
    getItemKey,
    className,
    style,
    children,
  },
  ref,
) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const estimate =
    typeof estimateSize === 'function' ? estimateSize : () => estimateSize;

  const virtualizer = useVirtualizer({
    count,
    getScrollElement: () => scrollRef.current,
    estimateSize: estimate,
    overscan,
    getItemKey,
  });

  useImperativeHandle(
    ref,
    () => ({
      scrollToIndex: (index, opts) => {
        const n = Math.max(0, Math.min(Math.floor(index), Math.max(0, count - 1)));
        virtualizer.scrollToIndex(n, {
          align: opts?.align ?? 'center',
          behavior: opts?.behavior ?? 'smooth',
        });
      },
      getScrollElement: () => scrollRef.current,
    }),
    [count, virtualizer],
  );

  const virtualItems = virtualizer.getVirtualItems();
  const paddingTop = virtualItems.length > 0 ? virtualItems[0]!.start : 0;
  const paddingBottom =
    virtualItems.length > 0
      ? virtualizer.getTotalSize() - virtualItems[virtualItems.length - 1]!.end
      : 0;

  return (
    <div ref={scrollRef} className={className} style={style}>
      {children({
        virtualItems,
        paddingTop,
        paddingBottom,
        measureElement: virtualizer.measureElement,
      })}
    </div>
  );
});

export default DirectorShotTableVirtual;
