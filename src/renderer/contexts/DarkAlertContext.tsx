import React, { createContext, useContext, useState, useCallback, useRef } from 'react';
import { DarkAlertModal } from '../components/DarkAlertModal';
import { DarkConfirmModal, type DarkConfirmVariant } from '../components/DarkConfirmModal';

export type DarkConfirmOptions = {
  variant?: DarkConfirmVariant;
  okLabel?: string;
  cancelLabel?: string;
};

interface DarkAlertContextValue {
  showAlert: (message: string) => void;
  /** 暗黑确认框，返回 true=确定、false=取消 */
  showConfirm: (message: string, options?: DarkConfirmOptions) => Promise<boolean>;
}

const DarkAlertContext = createContext<DarkAlertContextValue | null>(null);

export const DarkAlertProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState('');
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmMessage, setConfirmMessage] = useState('');
  const [confirmOptions, setConfirmOptions] = useState<DarkConfirmOptions>({});
  const confirmResolverRef = useRef<((v: boolean) => void) | null>(null);

  const showAlert = useCallback((msg: string) => {
    setMessage(msg);
    setOpen(true);
  }, []);

  const showConfirm = useCallback((msg: string, options?: DarkConfirmOptions) => {
    return new Promise<boolean>((resolve) => {
      confirmResolverRef.current = resolve;
      setConfirmOptions(options ?? {});
      setConfirmMessage(msg);
      setConfirmOpen(true);
    });
  }, []);

  const resolveConfirm = useCallback((value: boolean) => {
    setConfirmOpen(false);
    setConfirmOptions({});
    const fn = confirmResolverRef.current;
    confirmResolverRef.current = null;
    fn?.(value);
  }, []);

  return (
    <DarkAlertContext.Provider value={{ showAlert, showConfirm }}>
      {children}
      <DarkAlertModal open={open} message={message} onClose={() => setOpen(false)} />
      <DarkConfirmModal
        open={confirmOpen}
        message={confirmMessage}
        variant={confirmOptions.variant}
        okLabel={confirmOptions.okLabel}
        cancelLabel={confirmOptions.cancelLabel}
        onConfirm={() => resolveConfirm(true)}
        onCancel={() => resolveConfirm(false)}
      />
    </DarkAlertContext.Provider>
  );
};

export const useDarkAlert = (): DarkAlertContextValue => {
  const ctx = useContext(DarkAlertContext);
  if (!ctx) {
    return {
      showAlert: (msg: string) => {
        console.warn('[DarkAlert] Provider 未挂载，降级为原生 alert:', msg);
        alert(msg);
      },
      showConfirm: (msg: string) => Promise.resolve(window.confirm(msg)),
    };
  }
  return ctx;
};
