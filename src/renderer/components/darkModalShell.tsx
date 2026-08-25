import React, { useEffect } from 'react';
import { createPortal } from 'react-dom';

/** Aixflow 标准 alert/confirm 弹窗样式（与 DarkAlertModal 一致） */
export const DARK_MODAL_Z = 'z-[100010]';
/** 导演节点全屏（z-[100001]）之上的弹窗 */
export const DARK_MODAL_Z_ABOVE_DIRECTOR_FS = 'z-[100060]';
/**
 * 绝对顶层：须高于导演 promptHover（2147483000）等内联超高 z，
 * 否则超时弹窗看得见但「确定」点不到。
 */
export const DARK_MODAL_Z_INDEX = 2147483646;

export const darkModalOverlayClass = (stackZClass = DARK_MODAL_Z) =>
  `fixed inset-0 ${stackZClass} flex items-center justify-center bg-black/60 backdrop-blur-sm`;

export const darkModalPanelSmClass =
  'nexflow-glass-panel rounded-2xl border border-white/[0.12] shadow-2xl w-full max-w-[min(100%,380px)] mx-4 overflow-hidden';

export const darkModalPanelMdClass =
  'nexflow-glass-panel rounded-2xl border border-white/[0.12] shadow-2xl w-full max-w-md mx-4 overflow-hidden min-w-[280px]';

export const darkModalHeaderClass =
  'px-5 py-2.5 border-b border-white/10 text-white/50 text-xs font-medium tracking-wide';

export const darkModalBodyClass =
  'px-5 py-5 text-white/90 text-sm text-center whitespace-pre-wrap leading-relaxed';

export const darkModalFooterClass = 'px-5 pb-5 pt-1 flex justify-center';

export const darkModalBtnCancelClass =
  'px-4 py-2 rounded-full bg-white/10 hover:bg-white/15 text-white/85 text-sm transition-colors';

export const darkModalBtnOkClass = 'nexflow-btn-primary nexflow-btn-primary-sm min-w-[100px]';

export const darkModalBtnDangerClass =
  'px-4 py-2 rounded-full bg-red-500/20 hover:bg-red-500/30 text-red-300 font-medium text-sm border border-red-500/40 transition-colors';

/**
 * 分镜步 / 第 7 步「剪辑预览」、卡拉OK「字幕生成」共用橙色 pill（勿各写一套色）。
 * 背景用 nexflowOrangePillBtnBg。
 */
export const nexflowOrangePillBtnClass =
  'nodrag inline-flex items-center justify-center gap-1 rounded-full border-0 !px-2.5 !py-1 !h-auto font-medium text-white shadow-[0_6px_18px_rgba(249,115,22,0.45)] transition-[filter,opacity] hover:brightness-110 disabled:opacity-50 disabled:cursor-not-allowed';

export const nexflowOrangePillBtnBg = 'linear-gradient(to right, #ea580c, #f97316)';

/** 元宝悬停价签（金边金字，按钮上方） */
export const yuanbaoHoverTipAboveCls =
  'pointer-events-none absolute left-1/2 z-[80] -translate-x-1/2 bottom-[calc(100%+6px)] whitespace-nowrap rounded-full border px-2.5 py-0.5 text-[11px] font-medium tabular-nums shadow-md bg-[#2a2218]/95 text-amber-200/95 border-amber-500/45';

/** 元宝悬停价签（向下弹出，避免顶栏裁切） */
export const yuanbaoHoverTipBelowCls =
  'pointer-events-none absolute left-1/2 z-[80] -translate-x-1/2 top-[calc(100%+6px)] bottom-auto whitespace-nowrap rounded-full border px-2.5 py-0.5 text-[11px] font-medium tabular-nums shadow-md bg-[#2a2218]/95 text-amber-200/95 border-amber-500/45';

export type DarkModalFrameProps = {
  open: boolean;
  onBackdropClick?: () => void;
  stackZClass?: string;
  panelClassName?: string;
  brandLabel?: string;
  showBrandHeader?: boolean;
  children: React.ReactNode;
  footer?: React.ReactNode;
};

/** 标准 Aixflow 弹窗壳（头/体/脚由 children + footer 组成） */
export function DarkModalFrame({
  open,
  onBackdropClick,
  stackZClass = DARK_MODAL_Z,
  panelClassName = darkModalPanelSmClass,
  brandLabel = 'Aixflow',
  showBrandHeader = true,
  children,
  footer,
}: DarkModalFrameProps) {
  useEffect(() => {
    if (!open || !onBackdropClick) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopPropagation();
      onBackdropClick();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [open, onBackdropClick]);

  if (!open) return null;
  return createPortal(
    <div
      className={`${darkModalOverlayClass(stackZClass)} pointer-events-auto`}
      style={{ zIndex: DARK_MODAL_Z_INDEX }}
      onClick={onBackdropClick}
      onPointerDown={(e) => {
        // 防止底层导演全屏/悬停层抢指针
        e.stopPropagation();
      }}
      role="presentation"
    >
      <div
        className={`${panelClassName} pointer-events-auto`}
        onClick={(e) => e.stopPropagation()}
        onPointerDown={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        {showBrandHeader ? <div className={darkModalHeaderClass}>{brandLabel}</div> : null}
        {children}
        {footer}
      </div>
    </div>,
    document.body,
  );
}
