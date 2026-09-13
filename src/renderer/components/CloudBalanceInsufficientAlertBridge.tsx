import React, { useEffect } from 'react';
import { useAppLocale } from '../contexts/AppLocaleContext';
import { useDarkAlert } from '../contexts/DarkAlertContext';
import {
  NX_CLOUD_BALANCE_INSUFFICIENT_EVENT,
  cloudBalanceInsufficientAlert,
  promptCloudBalanceInsufficientIfNeeded,
} from '../utils/cloudAiGateMessage';

/**
 * 全局：生成任务元宝不足时弹「元宝不足，请充值」。
 * - 自定义事件（useAI / 各面板主动触发）
 * - onAIStatusUpdate ERROR（漏网的画布/导演台任务）
 */
export const CloudBalanceInsufficientAlertBridge: React.FC = () => {
  const { showAlert } = useDarkAlert();
  const { locale } = useAppLocale();

  useEffect(() => {
    const onEvent = () => {
      showAlert(cloudBalanceInsufficientAlert(locale));
    };
    window.addEventListener(NX_CLOUD_BALANCE_INSUFFICIENT_EVENT, onEvent);

    const remove =
      typeof window !== 'undefined' && window.electronAPI?.onAIStatusUpdate
        ? window.electronAPI.onAIStatusUpdate((packet) => {
            if (packet?.status !== 'ERROR') return;
            const payload = packet.payload as
              | { error?: string; balanceInsufficient?: boolean }
              | undefined;
            promptCloudBalanceInsufficientIfNeeded(payload?.error || payload, {
              balanceInsufficient: payload?.balanceInsufficient === true,
            });
          })
        : undefined;

    return () => {
      window.removeEventListener(NX_CLOUD_BALANCE_INSUFFICIENT_EVENT, onEvent);
      if (typeof remove === 'function') remove();
    };
  }, [locale, showAlert]);

  return null;
};
