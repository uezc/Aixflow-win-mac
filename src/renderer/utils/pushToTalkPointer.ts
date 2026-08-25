import type { MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from 'react';

export type PushToTalkPointerHandlers = {
  onPointerDown: (e: ReactPointerEvent<HTMLElement>) => void;
  onPointerUp: (e: ReactPointerEvent<HTMLElement>) => void;
  onPointerCancel: (e: ReactPointerEvent<HTMLElement>) => void;
  onPointerLeave: (e: ReactPointerEvent<HTMLElement>) => void;
  onLostPointerCapture: (e: ReactPointerEvent<HTMLElement>) => void;
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
    if (
      typeof (el as HTMLElement).hasPointerCapture === 'function' &&
      (el as HTMLElement).hasPointerCapture(pointerId)
    ) {
      (el as HTMLElement).releasePointerCapture(pointerId);
    }
  } catch {
    /* ignore */
  }
}

const pttReleasers = new Set<() => void>();

/** 听写失败/弹窗出现时必须松开 capture，否则全屏导演台「确定」点不到，表现为卡死 */
export function abortAllPushToTalkPointers(): void {
  for (const release of [...pttReleasers]) {
    try {
      release();
    } catch {
      /* ignore */
    }
  }
}

if (typeof window !== 'undefined') {
  window.addEventListener('nexflow-force-end-dictation', () => {
    abortAllPushToTalkPointers();
  });
}

/**
 * 按住说话：pointerdown 开始；pointerup / cancel /（无 capture 时）leave-仍按下 → 结束。
 * 使用 setPointerCapture，保证在按钮外松开也能收到 pointerup。
 *
 * 关键：若 pointerup 丢失（切后台 / 卡顿），capture 会吞掉后续所有点击，
 * 表现为整页「点不动」。因此额外监听 window pointerup/blur/visibility。
 */
export function bindPushToTalkPointerHandlers(
  opts: BindPushToTalkPointerOptions,
): PushToTalkPointerHandlers {
  const primaryOnly = opts.primaryOnly !== false;
  let activeEl: HTMLElement | null = null;
  let activePointerId: number | null = null;
  let windowBound = false;

  const bindWindow = () => {
    if (windowBound || typeof window === 'undefined') return;
    windowBound = true;
    pttReleasers.add(forceEnd);
    window.addEventListener('pointerup', onWinPointerUp, true);
    window.addEventListener('pointercancel', onWinPointerUp, true);
    // 勿监听 window blur：系统麦克风授权框会 blur，导致刚按下就被 forceEnd
    document.addEventListener('visibilitychange', onVis);
  };

  const unbindWindow = () => {
    if (!windowBound || typeof window === 'undefined') return;
    windowBound = false;
    pttReleasers.delete(forceEnd);
    window.removeEventListener('pointerup', onWinPointerUp, true);
    window.removeEventListener('pointercancel', onWinPointerUp, true);
    document.removeEventListener('visibilitychange', onVis);
  };

  const forceEnd = () => {
    const el = activeEl;
    const pid = activePointerId;
    activeEl = null;
    activePointerId = null;
    unbindWindow();
    if (el != null && pid != null) releaseCapture(el, pid);
    opts.onPressEnd();
  };

  const onWinPointerUp = (e: Event) => {
    if (activePointerId == null) return;
    if (e instanceof PointerEvent && e.pointerId !== activePointerId) return;
    forceEnd();
  };
  const onVis = () => {
    if (document.visibilityState === 'hidden') forceEnd();
  };

  const endPress = (e: ReactPointerEvent<HTMLElement>) => {
    if (activePointerId != null && e.pointerId !== activePointerId) return;
    forceEnd();
  };

  return {
    onPointerDown: (e) => {
      e.stopPropagation();
      if (primaryOnly && e.button !== 0) return;
      if (isDisabled(opts.disabled)) return;
      // 若上次 capture 未释放，先强制收尾，避免整页点击被吞
      if (activeEl) forceEnd();
      e.preventDefault();
      activeEl = e.currentTarget;
      activePointerId = e.pointerId;
      try {
        e.currentTarget.setPointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
      bindWindow();
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
    onLostPointerCapture: (e) => {
      if (activePointerId != null && e.pointerId !== activePointerId) return;
      if (!activeEl) return;
      // React 重渲染（转圈→话筒、电平刷新）会偶发 lostcapture。
      // 主键还按着时不要结束听写，否则 MV 导演台参考框会「按一下就断」。
      if (typeof e.buttons === 'number' && e.buttons !== 0) {
        try {
          e.currentTarget.setPointerCapture(e.pointerId);
          activeEl = e.currentTarget;
          activePointerId = e.pointerId;
        } catch {
          /* window pointerup 仍会收尾 */
        }
        return;
      }
      forceEnd();
    },
    onContextMenu: (e) => {
      e.preventDefault();
      e.stopPropagation();
    },
  };
}
