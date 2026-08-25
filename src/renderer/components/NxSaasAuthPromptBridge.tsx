import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAppLocale } from '../contexts/AppLocaleContext';
import {
  NX_SAAS_LOGIN_REQUIRED_EVENT,
  type NxSaasLoginRequiredDetail,
} from '../utils/cloudAiGateMessage';
import { DarkAlertModal } from './DarkAlertModal';

/** 算力门禁 / 未登录：提示登录，点按钮回到账户登录页（/settings） */
export const NxSaasAuthPromptBridge: React.FC = () => {
  const navigate = useNavigate();
  const { locale } = useAppLocale();
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState('');
  const [confirmLabel, setConfirmLabel] = useState('');
  const showingRef = useRef(false);

  const defaultMessage = locale === 'en' ? 'Account not signed in' : '账号未登录';
  const defaultConfirm = locale === 'en' ? 'Go to sign in' : '返回登录界面';

  useEffect(() => {
    const handler = (ev: Event) => {
      if (showingRef.current) return;
      const detail = (ev as CustomEvent<NxSaasLoginRequiredDetail | undefined>).detail;
      showingRef.current = true;
      setMessage(String(detail?.message || '').trim() || defaultMessage);
      setConfirmLabel(String(detail?.confirmLabel || '').trim() || defaultConfirm);
      setOpen(true);
    };
    window.addEventListener(NX_SAAS_LOGIN_REQUIRED_EVENT, handler);
    return () => window.removeEventListener(NX_SAAS_LOGIN_REQUIRED_EVENT, handler);
  }, [defaultConfirm, defaultMessage]);

  const goToLoginPage = () => {
    setOpen(false);
    showingRef.current = false;
    void window.electronAPI?.setFullscreen?.(false);
    navigate('/settings', { replace: true });
  };

  return (
    <DarkAlertModal
      open={open}
      message={message || defaultMessage}
      appearance="loginShell"
      confirmLabel={confirmLabel || defaultConfirm}
      onClose={goToLoginPage}
      stackZClass="z-[100060]"
    />
  );
};
