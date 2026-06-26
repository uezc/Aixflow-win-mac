import React from 'react';
import { createPortal } from 'react-dom';

/** Aixflow 标准 alert/confirm 弹窗样式（与 DarkAlertModal 一致） */
export const DARK_MODAL_Z = 'z-[100010]';

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
  if (!open) return null;
  return createPortal(
    <div
      className={darkModalOverlayClass(stackZClass)}
      onClick={onBackdropClick}
      role="presentation"
    >
      <div
        className={panelClassName}
        onClick={(e) => e.stopPropagation()}
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
