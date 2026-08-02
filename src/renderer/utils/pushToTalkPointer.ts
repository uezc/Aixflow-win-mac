import type { MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from 'react';

export type PushToTalkPointerHandlers = {
  onPointerDown: (e: ReactPointerEvent<HTMLElement>) => void;
  onPointerUp: (e: ReactPointerEvent<HTMLElement>) => void;
  onPointerCancel: (e: ReactPointerEvent<HTMLElement>) => void;
  onPointerLeave: (e: ReactPointerEvent<HTMLElement>) => void;
  onContextMenu: (e: ReactMouseEvent<HTMLElement>) => void;
};

export type BindPushToTalkPointerOptions = {
  onPressStart: () => void;
  onPressEnd: () => void;
  /** 静态或动态禁用 */
  disabled?: boolean | (() => boolean);
  /** 仅响应主键（默认 true） */
  primaryOnly?: boolean;
};

function isDisabled(disabled: BindPushToTalkPointerOptions['disabled']): boolean {
  return typeof disabled === 'function' ? disabled() : !!disabled;
}

function releaseCapture(el: Element, pointerId: number): void {
  try {
    if (typeof (el as HTMLElement).hasPointerCapture === 'function' && (el as HTMLElement).hasPointerCapture(pointerId)) {
      (el as HTMLElement).releasePointerCapture(pointerId);
    }
  } catch {
    /* ignore */
  }
}

/**
 * 按住说话：pointerdown 开始；pointerup / cancel /（无 capture 时）leave-仍按下 → 结束。
 * 使用 setPointerCapture，保证在按钮外松开也能收到 pointerup。
 */
export function bindPushToTalkPointerHandlers(
  opts: BindPushToTalkPointerOptions,
): PushToTalkPointerHandlers {
  const primaryOnly = opts.primaryOnly !== false;

  const endPress = (e: ReactPointerEvent<HTMLElement>) => {
    releaseCapture(e.currentTarget, e.pointerId);
    opts.onPressEnd();
  };

  return {
    onPointerDown: (e) => {
      e.stopPropagation();
      if (primaryOnly && e.button !== 0) return;
      if (isDisabled(opts.disabled)) return;
      e.preventDefault();
      try {
        e.currentTarget.setPointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
      opts.onPressStart();
    },
    onPointerUp: (e) => {
      e.stopPropagation();
      e.preventDefault();
      endPress(e);
    },
    onPointerCancel: (e) => {
      e.stopPropagation();
      endPress(e);
    },
    onPointerLeave: (e) => {
      // 有 capture 时离开按钮仍继续说话，等 pointerup；无 capture 时仍按下离开则结束
      if (e.buttons === 0) return;
      try {
        if (e.currentTarget.hasPointerCapture?.(e.pointerId)) return;
      } catch {
        /* fall through → end */
      }
      e.stopPropagation();
      endPress(e);
    },
    onContextMenu: (e) => {
      e.preventDefault();
      e.stopPropagation();
    },
  };
}
