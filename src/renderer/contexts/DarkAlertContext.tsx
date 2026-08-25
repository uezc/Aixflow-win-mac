import React, { createContext, useContext, useState, useCallback, useMemo, useRef } from 'react';
import { DarkAlertModal } from '../components/DarkAlertModal';
import { DarkConfirmModal, type DarkConfirmVariant } from '../components/DarkConfirmModal';
import { DARK_MODAL_Z, DARK_MODAL_Z_ABOVE_DIRECTOR_FS } from '../components/darkModalShell';
import { getGlobalInteractionSnapshot } from '../utils/globalInteractionStore';
import { abortAllPushToTalkPointers } from '../utils/pushToTalkPointer';

export type DarkConfirmOptions = {
  variant?: DarkConfirmVariant;
  okLabel?: string;
  cancelLabel?: string;
  /** 覆盖确认框 z-index（浮层之上时需传入，如 z-[100060]） */
  stackZClass?: string;
};

interface DarkAlertContextValue {
  showAlert: (message: string, options?: { stackZClass?: string }) => void;
  /** 暗黑确认框，返回 true=确定、false=取消 */
  showConfirm: (message: string, options?: DarkConfirmOptions) => Promise<boolean>;
}

const DarkAlertContext = createContext<DarkAlertContextValue | null>(null);

function resolveModalStackZ(override?: string): string {
  if (override) return override;
  if (typeof document !== 'undefined' && document.documentElement.classList.contains('nexflow-director-overlay-open')) {
    return DARK_MODAL_Z_ABOVE_DIRECTOR_FS;
  }
  if (getGlobalInteractionSnapshot().directorFullscreenNodeId) {
    return DARK_MODAL_Z_ABOVE_DIRECTOR_FS;
  }
  return DARK_MODAL_Z;
}

export const DarkAlertProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState('');
  const [alertStackZ, setAlertStackZ] = useState(DARK_MODAL_Z);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmMessage, setConfirmMessage] = useState('');
  const [confirmOptions, setConfirmOptions] = useState<DarkConfirmOptions>({});
  const confirmResolverRef = useRef<((v: boolean) => void) | null>(null);

  const showAlert = useCallback((msg: string, options?: { stackZClass?: string }) => {
    abortAllPushToTalkPointers();
    setMessage(msg);
    setAlertStackZ(resolveModalStackZ(options?.stackZClass));
    setOpen(true);
  }, []);

  const showConfirm = useCallback((msg: string, options?: DarkConfirmOptions) => {
    return new Promise<boolean>((resolve) => {
      confirmResolverRef.current = resolve;
      setConfirmOptions({
        ...options,
        stackZClass: resolveModalStackZ(options?.stackZClass),
      });
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

  const ctxValue = useMemo(
    () => ({ showAlert, showConfirm }),
    [showAlert, showConfirm],
  );

  return (
    <DarkAlertContext.Provider value={ctxValue}>
      {children}
      <DarkAlertModal
        open={open}
        message={message}
        onClose={() => {
          setOpen(false);
          setAlertStackZ(DARK_MODAL_Z);
        }}
        stackZClass={alertStackZ}
      />
      <DarkConfirmModal
        open={confirmOpen}
        message={confirmMessage}
        variant={confirmOptions.variant}
        okLabel={confirmOptions.okLabel}
        cancelLabel={confirmOptions.cancelLabel}
        stackZClass={confirmOptions.stackZClass || DARK_MODAL_Z}
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
