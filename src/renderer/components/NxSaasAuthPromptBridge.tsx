import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAppLocale } from '../contexts/AppLocaleContext';
import { NX_SAAS_LOGIN_REQUIRED_EVENT } from '../utils/cloudAiGateMessage';
import { DarkAlertModal } from './DarkAlertModal';

/** 算力门禁 / 未登录：提示「账号未登录」，点按钮回到账户登录页（/settings） */
export const NxSaasAuthPromptBridge: React.FC = () => {
  const navigate = useNavigate();
  const { locale } = useAppLocale();
  const [open, setOpen] = useState(false);
  const showingRef = useRef(false);

  const message = locale === 'en' ? 'Account not signed in' : '账号未登录';
  const confirmLabel = locale === 'en' ? 'Go to sign in' : '返回登录界面';

  useEffect(() => {
    const handler = () => {
      if (showingRef.current) return;
      showingRef.current = true;
      setOpen(true);
    };
    window.addEventListener(NX_SAAS_LOGIN_REQUIRED_EVENT, handler);
    return () => window.removeEventListener(NX_SAAS_LOGIN_REQUIRED_EVENT, handler);
  }, []);

  const goToLoginPage = () => {
    setOpen(false);
    showingRef.current = false;
    void window.electronAPI?.setFullscreen?.(false);
    navigate('/settings', { replace: true });
  };

  return (
    <DarkAlertModal
      open={open}
      message={message}
      appearance="loginShell"
      confirmLabel={confirmLabel}
      onClose={goToLoginPage}
    />
  );
};
