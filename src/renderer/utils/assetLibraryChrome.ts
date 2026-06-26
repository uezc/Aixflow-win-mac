/** 左侧资产栏：与登录/账户页一致的控件样式；明亮模式仅换 Scratch 色，外形与暗黑模式一致 */

import { scratchTintClass, type ScratchColorId } from '../theme/scratchColors';

export type AssetLibTabId = 'role' | 'scene' | 'model3d';

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

export function assetLibTabActive(isDarkMode: boolean, tab?: AssetLibTabId) {
  if (!isDarkMode && tab) {
    return `scratch-tab-active scratch-tab-active--${tab} px-1.5 py-1.5 rounded-full text-[11px] font-medium border shadow-sm flex items-center justify-center gap-0.5 whitespace-nowrap`;
  }
  return isDarkMode
    ? 'bg-white/12 text-white border border-white/15 shadow-sm'
    : 'bg-white text-gray-900 border border-gray-200/80 shadow-sm';
}

export function assetLibTabInactive(isDarkMode: boolean) {
  return isDarkMode
    ? 'text-white/45 hover:text-white/70 hover:bg-white/5 border border-transparent'
    : 'text-gray-500 hover:text-gray-800 hover:bg-gray-100/80 border border-transparent';
}

export function assetLibSelectionRing(isDarkMode: boolean, strong = false) {
  if (!isDarkMode) {
    return strong ? 'ring-2 ring-[var(--scratch-control)]/80' : 'ring-1 ring-[var(--scratch-control)]/70';
  }
  return strong
    ? 'ring-2 ring-amber-400/70'
    : 'ring-1 ring-amber-400/60';
}

export function assetLibMsgSuccess(isDarkMode: boolean) {
  return isDarkMode ? 'text-sky-300/90' : 'text-[var(--scratch-operators)]';
}

export function assetLibListCard(isDarkMode: boolean) {
  return isDarkMode
    ? 'nexflow-glass-panel border border-white/10 hover:border-sky-500/35'
    : 'bg-white hover:bg-gray-50 border border-gray-200 hover:border-[var(--scratch-motion)]/50';
}

export function assetLibListCardSelected(_isDarkMode: boolean) {
  return 'asset-lib-card-selected bg-[#52525b] border border-[#3f3f46] shadow-sm';
}

export function assetLibGalleryCardSelected(isDarkMode: boolean) {
  if (!isDarkMode) {
    return 'border-[var(--scratch-looks)] bg-[var(--scratch-looks)]/10 ring-2 ring-[var(--scratch-looks)]/40';
  }
  return 'border-sky-500/55 bg-sky-500/10 ring-2 ring-sky-400/40';
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
