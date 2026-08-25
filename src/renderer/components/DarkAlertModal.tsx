import React from 'react';
import { Coins } from 'lucide-react';
import { useAppLocale } from '../contexts/AppLocaleContext';
import {
  DarkModalFrame,
  darkModalBodyClass,
  darkModalBtnOkClass,
  darkModalFooterClass,
  darkModalPanelSmClass,
  DARK_MODAL_Z,
} from './darkModalShell';
import { forceClearVoiceModalLock } from '../utils/voiceModalGate';

interface DarkAlertModalProps {
  open: boolean;
  message: string;
  onClose: () => void;
  /** 加宽加高（如登录成功），默认保持小弹窗；double 为居中卡片（约 1/6 视口宽、中等主体区） */
  size?: 'default' | 'lg' | 'double';
  /** loginShell：与登录页 nexflow-glass-panel 同系（账户/登录成功弹窗） */
  appearance?: 'default' | 'loginShell';
  /** 主按钮文案（loginShell 等）；默认「确定」/ OK */
  confirmLabel?: string;
  /** 覆盖最外层 z-index（全屏层如 z-[100001] 时需高于该层） */
  stackZClass?: string;
}

/**
 * 暗黑系弹窗，替代原生 alert
 */
export const DarkAlertModal: React.FC<DarkAlertModalProps> = ({
  open,
  message,
  onClose,
  size = 'default',
  appearance = 'default',
  stackZClass = DARK_MODAL_Z,
  confirmLabel,
}) => {
  const { locale } = useAppLocale();
  if (!open) return null;
  const isLoginShell = appearance === 'loginShell';
  const isLg = size === 'lg';
  const isDouble = size === 'double';
  const isBalanceMsg =
    message.includes('元宝不足') ||
    message.includes('余额不足') ||
    /insufficient|low balance|top up/i.test(message);
  const okLabel = confirmLabel ?? (locale === 'en' ? 'OK' : '确定');
  const handleClose = () => {
    try {
      forceClearVoiceModalLock();
    } catch {
      /* ignore */
    }
    onClose();
  };

  if (isLoginShell) {
    return (
      <DarkModalFrame
        open={open}
        onBackdropClick={handleClose}
        stackZClass={stackZClass}
        panelClassName="nexflow-glass-panel flex w-full max-w-[min(100%,380px)] flex-col overflow-hidden rounded-2xl border border-white/[0.12]"
        showBrandHeader={false}
        footer={
          <div className="px-5 pb-5 pt-2 sm:px-6 sm:pb-6">
            <button
              type="button"
              onClick={handleClose}
              onPointerDown={(e) => {
                e.stopPropagation();
                handleClose();
              }}
              className="nexflow-btn-primary w-full pointer-events-auto"
            >
              {okLabel}
            </button>
          </div>
        }
      >
        <div className="px-5 pb-2 pt-8 text-center sm:px-6 sm:pt-9">
          <h2 className="text-xl font-semibold tracking-tight text-white sm:text-[1.35rem]">{message}</h2>
        </div>
      </DarkModalFrame>
    );
  }

  const panelClass = isLg
    ? 'nexflow-glass-panel rounded-2xl border border-white/[0.12] shadow-2xl w-[min(92vw,720px)] max-w-[720px] min-h-[220px] mx-4 overflow-hidden flex flex-col'
    : isDouble
      ? 'nexflow-glass-panel rounded-2xl border border-white/[0.12] shadow-2xl flex flex-col overflow-hidden mx-4 w-[min(92vw,max(220px,16.5vw))] min-h-[min(200px,22vh)] max-h-[min(88vh,320px)]'
      : darkModalPanelSmClass;

  const bodyClass = isLg
    ? 'flex flex-1 flex-col items-center justify-center px-10 py-12 text-white text-center text-2xl font-semibold tracking-wide whitespace-pre-wrap min-h-[140px]'
    : isDouble
      ? 'flex-1 px-5 py-4 text-white/90 text-base text-center font-medium whitespace-pre-wrap flex flex-col items-center justify-center min-h-0'
      : darkModalBodyClass;

  return (
    <DarkModalFrame
      open={open}
      onBackdropClick={handleClose}
      stackZClass={stackZClass}
      panelClassName={panelClass}
      footer={
        <div className={isLg ? `${darkModalFooterClass} px-8` : isDouble ? `${darkModalFooterClass} shrink-0` : darkModalFooterClass}>
          <button
            type="button"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              handleClose();
            }}
            onPointerDown={(e) => {
              e.preventDefault();
              e.stopPropagation();
              handleClose();
            }}
            onMouseDown={(e) => {
              e.preventDefault();
              e.stopPropagation();
              handleClose();
            }}
            className={
              isLg || isDouble
                ? `${darkModalBtnOkClass} !px-8 pointer-events-auto relative z-[1]`
                : `${darkModalBtnOkClass} w-full max-w-[280px] pointer-events-auto relative z-[1]`
            }
          >
            {okLabel}
          </button>
        </div>
      }
    >
      <div className={bodyClass}>
        {isBalanceMsg && !isLg && !isDouble && (
          <div className="flex justify-center mb-3">
            <div className="w-12 h-12 rounded-full bg-amber-500/20 flex items-center justify-center">
              <Coins className="w-6 h-6 text-amber-400" />
            </div>
          </div>
        )}
        {message}
      </div>
    </DarkModalFrame>
  );
};
