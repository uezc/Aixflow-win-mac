/** 左侧资产栏：与登录/账户页一致的控件样式；明亮模式仅换 Scratch 色，外形与暗黑模式一致 */

import { scratchTintClass, type ScratchColorId } from '../theme/scratchColors';

/** 展开时资产库宽度（与 WorkspaceSidebar / FlowContent 小地图偏移同步） */
export const ASSET_LIBRARY_SIDEBAR_WIDTH_PX = 320;
export const ASSET_LIBRARY_SIDEBAR_COLLAPSED_WIDTH_PX = 48;
/** 画布控件相对侧栏右缘的内边距 */
export const ASSET_LIBRARY_CANVAS_GAP_PX = 23;

export type AssetLibTabId = 'role' | 'scene' | 'model3d' | 'digitalHuman';

export function assetLibBtnSecondary(isDarkMode: boolean, extra = '', scratch?: ScratchColorId) {
  const base = `nexflow-btn-secondary nexflow-btn-secondary-sm inline-flex items-center justify-center ${extra}`;
  if (!isDarkMode && scratch) {
    return `${base} ${scratchTintClass(scratch)}`.trim();
  }
  return `${base} ${
    isDarkMode ? '' : '!border-gray-300/80 !bg-white !text-gray-800 hover:!bg-gray-50'
  }`.trim();
}

export function assetLibBtnPrimary(isDarkMode: boolean, extra = '', scratch: ScratchColorId = 'control') {
  const base = `nexflow-btn-primary nexflow-btn-primary-sm inline-flex items-center justify-center ${extra}`;
  if (!isDarkMode) {
    return `${base} ${scratchTintClass(scratch)}`.trim();
  }
  return base.trim();
}

export function assetLibBtnIcon(isDarkMode: boolean, scratch?: ScratchColorId) {
  return assetLibBtnSecondary(isDarkMode, '!p-1.5 !min-w-0', isDarkMode ? undefined : scratch);
}

export function assetLibTabActive(isDarkMode: boolean, _tab?: AssetLibTabId) {
  return isDarkMode
    ? 'text-white bg-blue-500/12 border border-blue-400/65 shadow-sm'
    : 'text-gray-900 bg-blue-50 border border-blue-500/75 shadow-sm';
}

export function assetLibTabInactive(isDarkMode: boolean) {
  return isDarkMode
    ? 'text-white/45 hover:text-white/70 hover:bg-white/5 border border-transparent'
    : 'text-gray-500 hover:text-gray-800 hover:bg-gray-100/80 border border-transparent';
}

/** 资产库卡片选中：统一蓝色呼吸灯边框 */
export function assetLibCardSelected(_isDarkMode: boolean): string {
  return 'asset-lib-selection-breathe';
}

export function assetLibSelectionRing(isDarkMode: boolean, _strong = false) {
  return assetLibCardSelected(isDarkMode);
}

export function assetLibListCardSelected(isDarkMode: boolean) {
  return `${assetLibListCard(isDarkMode)} ${assetLibCardSelected(isDarkMode)}`;
}

export function assetLibGalleryCardSelected(isDarkMode: boolean) {
  return assetLibCardSelected(isDarkMode);
}

export function assetLibMsgSuccess(isDarkMode: boolean) {
  return isDarkMode ? 'text-sky-300/90' : 'text-[var(--scratch-operators)]';
}

export function assetLibListCard(isDarkMode: boolean) {
  return isDarkMode
    ? 'nexflow-glass-panel border border-white/10 hover:border-sky-500/35'
    : 'bg-white hover:bg-gray-50 border border-gray-200 hover:border-[var(--scratch-motion)]/50';
}

export function assetLibAddDashed(isDarkMode: boolean) {
  return isDarkMode
    ? 'border-white/20 hover:border-sky-500/50 bg-zinc-900/40 hover:bg-white/[0.03]'
    : 'border-[var(--scratch-control)]/40 hover:border-[var(--scratch-control)] bg-gray-50 hover:bg-[var(--scratch-control)]/10';
}

export function assetLibGalleryToggleActive(isDarkMode: boolean) {
  if (!isDarkMode) {
    return `${assetLibBtnIcon(isDarkMode, 'motion')} !w-8 !h-8`;
  }
  return 'bg-sky-600/30 text-sky-200 border border-sky-500/35';
}

export function assetLibCopySuccess(isDarkMode: boolean) {
  return isDarkMode ? 'text-sky-400' : 'text-[var(--scratch-operators)]';
}

export function assetLibBtnDanger(isDarkMode: boolean, extra = '') {
  if (!isDarkMode) {
    return assetLibBtnSecondary(isDarkMode, extra, 'myBlocks');
  }
  return `nexflow-btn-secondary nexflow-btn-secondary-sm inline-flex items-center justify-center ${extra} !border-red-400/35 !text-red-300 hover:!bg-red-500/15`.trim();
}

/** 资产库工具栏删除：未勾选素材为浅粉（图一），已勾选为深红（图二） */
export function assetLibDeleteToolbarBtn(isDarkMode: boolean, hasSelection: boolean, extra = ''): string {
  const base = `inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full transition-colors disabled:pointer-events-none disabled:opacity-100 ${extra}`;
  if (hasSelection) {
    if (isDarkMode) {
      return `${base} bg-red-500 text-white hover:bg-red-400 border border-red-400/50`;
    }
    return `${base} bg-[#D85C71] text-white hover:bg-[#C94F64] border border-[#C94F64]/40 shadow-sm`;
  }
  if (isDarkMode) {
    return `${base} bg-red-500/22 text-white/75 border border-red-400/25`;
  }
  return `${base} bg-[#F8D7DA] text-white border border-[#F5C2C7]`;
}

/** 画布节点悬浮工具栏图标按钮（拼图 / 文本 / LLM 同款） */
export function nodeFloatToolBtn(isDarkMode: boolean, active = false, extra = '', scratch?: ScratchColorId) {
  if (!isDarkMode && scratch) {
    const activeRing = active ? 'ring-2 ring-offset-1 ring-gray-900/20' : '';
    return `p-1.5 rounded-lg scratch-float-btn ${scratchTintClass(scratch)} inline-flex items-center justify-center disabled:opacity-30 ${activeRing} ${extra}`.trim();
  }
  return `p-1.5 rounded-lg transition-all disabled:opacity-30 ${
    active
      ? isDarkMode
        ? 'apple-panel ring-1 ring-violet-400/40 bg-violet-500/20 text-violet-200'
        : 'apple-panel-light ring-1 ring-violet-400/40 bg-violet-100 text-violet-800'
      : isDarkMode
        ? 'apple-panel hover:bg-white/20 text-white/80'
        : 'apple-panel-light hover:bg-gray-200/30 text-gray-700'
  } ${extra}`.trim();
}

/** 画布节点悬浮工具栏文字胶囊按钮 */
export function nodeFloatPillBtn(isDarkMode: boolean, extra = '', scratch?: ScratchColorId, active = false) {
  if (!isDarkMode && scratch) {
    const activeRing = active ? 'ring-2 ring-offset-1 ring-gray-900/20' : '';
    return `inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium scratch-float-btn ${scratchTintClass(scratch)} ${activeRing} ${extra}`.trim();
  }
  return `inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium transition-all ${
    isDarkMode
      ? 'apple-panel hover:bg-white/20 text-white/80'
      : 'apple-panel-light hover:bg-gray-200/30 text-gray-700'
  } ${extra}`.trim();
}

/** 角色卡片行内圆形操作钮（明亮模式 Scratch 色） */
export function assetLibCardActionBtn(isDarkMode: boolean, scratch: ScratchColorId, extra = '') {
  if (!isDarkMode) {
    return `${assetLibBtnIcon(isDarkMode, scratch)} !p-1.5 ${extra}`.trim();
  }
  return `${assetLibBtnIcon(isDarkMode)} !p-1.5 ${extra}`.trim();
}
