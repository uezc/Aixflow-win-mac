/** Workspace 顶栏标记，用于测量高度、避免画布模块 fixed 层盖住菜单 */
export const WORKSPACE_HEADER_SELECTOR = '[data-nexflow-workspace-header]';

export function measureWorkspaceHeaderBottom(): number {
  if (typeof document === 'undefined') return 0;
  const el = document.querySelector(WORKSPACE_HEADER_SELECTOR);
  if (!el) return 0;
  return el.getBoundingClientRect().bottom;
}

/** 将 fixed 定位区域压到顶栏下方（预览 Portal 等） */
export function clampRectBelowWorkspaceHeader(rect: {
  top: number;
  left: number;
  width: number;
  height: number;
}): { top: number; left: number; width: number; height: number } {
  const headerBottom = measureWorkspaceHeaderBottom();
  if (headerBottom <= 0 || rect.top >= headerBottom) return rect;
  const overlap = headerBottom - rect.top;
  const height = Math.max(0, rect.height - overlap);
  if (height < 1) return { ...rect, top: headerBottom, width: rect.width, height: 0 };
  return { top: headerBottom, left: rect.left, width: rect.width, height };
}

/** 画布内拖拽框选等 overlay（低于侧栏 z-20、顶栏 z-[1000]，避免压住资产库/任务列表） */
export const WORKSPACE_CANVAS_OVERLAY_Z = 12;
