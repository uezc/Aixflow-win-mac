import React, { useEffect, useState } from 'react';
import { DarkAlertModal } from './DarkAlertModal';
import { useAppLocale } from '../contexts/AppLocaleContext';
import { settingsT } from '../i18n/settingsI18n';

export const NEXFLOW_RECHARGE_SETTLED_EVENT = 'nexflow-recharge-settled';

/** 请求打开账户页充值弹窗（画布顶栏「云端元宝」等入口） */
export const NEXFLOW_OPEN_RECHARGE_EVENT = 'nexflow-open-recharge';
export const NEXFLOW_OPEN_RECHARGE_FLAG = 'nexflow_open_recharge';

export function requestOpenRechargeUi(): void {
  try {
    sessionStorage.setItem(NEXFLOW_OPEN_RECHARGE_FLAG, '1');
  } catch {
    /* ignore */
  }
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(NEXFLOW_OPEN_RECHARGE_EVENT));
  }
}

/** 全局监听充值到账（任意页面均弹出成功提示） */
export const RechargeSettledNotifier: React.FC = () => {
  const { locale } = useAppLocale();
  const [open, setOpen] = useState(false);
  const [added, setAdded] = useState(0);
  const t = settingsT(locale);

  useEffect(() => {
    if (!window.electronAPI?.onRechargeSettled) return;
    const unsub = window.electronAPI.onRechargeSettled((payload) => {
      const addedYuanbao = Math.max(0, Number(payload.added_yuanbao) || 0);
      setAdded(addedYuanbao);
      setOpen(true);
      window.dispatchEvent(new CustomEvent(NEXFLOW_RECHARGE_SETTLED_EVENT, { detail: payload }));
    });
    return unsub;
  }, []);

  return (
    <DarkAlertModal
      open={open}
      message={t.rechargeSuccessMessage(added)}
      onClose={() => setOpen(false)}
      appearance="loginShell"
      stackZClass="z-[100002]"
    />
  );
};

export default RechargeSettledNotifier;
