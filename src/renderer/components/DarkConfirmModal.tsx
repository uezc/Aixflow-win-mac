import React from 'react';
import { useAppLocale } from '../contexts/AppLocaleContext';
import {
  DarkModalFrame,
  darkModalBodyClass,
  darkModalBtnCancelClass,
  darkModalBtnDangerClass,
  darkModalBtnOkClass,
  darkModalFooterClass,
  darkModalPanelMdClass,
  DARK_MODAL_Z,
} from './darkModalShell';

export type DarkConfirmVariant = 'primary' | 'danger';

interface DarkConfirmModalProps {
  open: boolean;
  message: string;
  onConfirm: () => void;
  onCancel: () => void;
  variant?: DarkConfirmVariant;
  okLabel?: string;
  cancelLabel?: string;
  /** 覆盖最外层 z-index（如卡拉OK全屏预览之上） */
  stackZClass?: string;
}

/** 暗黑系确认框，替代原生 confirm */
export const DarkConfirmModal: React.FC<DarkConfirmModalProps> = ({
  open,
  message,
  onConfirm,
  onCancel,
  variant = 'primary',
  okLabel: okLabelProp,
  cancelLabel: cancelLabelProp,
  stackZClass = DARK_MODAL_Z,
}) => {
  const { locale } = useAppLocale();
  if (!open) return null;
  const cancelLabel = cancelLabelProp ?? (locale === 'en' ? 'Cancel' : '取消');
  const okLabel = okLabelProp ?? (locale === 'en' ? 'OK' : '确定');
  const okClass = variant === 'danger' ? darkModalBtnDangerClass : darkModalBtnOkClass;

  return (
    <DarkModalFrame
      open={open}
      onBackdropClick={onCancel}
      stackZClass={stackZClass}
      panelClassName={darkModalPanelMdClass}
      footer={
        <div className={`${darkModalFooterClass} gap-2 !justify-end border-t border-white/10 pt-3`}>
          <button type="button" onClick={onCancel} className={darkModalBtnCancelClass}>
            {cancelLabel}
          </button>
          <button type="button" onClick={onConfirm} className={okClass}>
            {okLabel}
          </button>
        </div>
      }
    >
      <div className={darkModalBodyClass}>{message}</div>
    </DarkModalFrame>
  );
};
