import React, { useState, useEffect } from 'react';
import { formatCloudAuthError } from '../utils/cloudAuthError';

type Props = {
  open: boolean;
  onClose: () => void;
  /** 新用户时 `isNewUser` 为 true，供外层展示欢迎 Toast（弹窗会立即关闭，提示需在父级渲染） */
  onLoggedIn: (opts?: { isNewUser?: boolean }) => void;
};

/**
 * 正式版 SaaS：纯邮箱验证码登录；成功后由主进程持久化 JWT。
 */
const NxSaaSLoginModal: React.FC<Props> = ({ open, onClose, onLoggedIn }) => {
  const [email, setEmail] = useState('');
  const [verifyCode, setVerifyCode] = useState('');
  const [sendCodeSec, setSendCodeSec] = useState(0);
  const [sendCodeBusy, setSendCodeBusy] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => {
    if (!open) {
      setErr('');
      setVerifyCode('');
      setSendCodeSec(0);
    }
  }, [open]);

  useEffect(() => {
    if (sendCodeSec <= 0) return;
    const id = window.setInterval(() => setSendCodeSec((s) => (s <= 1 ? 0 : s - 1)), 1000);
    return () => window.clearInterval(id);
  }, [sendCodeSec]);

  if (!open) return null;

  const sendCode = async () => {
    const api = window.electronAPI;
    if (!api?.nxCloudSendAuthCode) {
      setErr('当前环境不支持发送验证码');
      return;
    }
    if (!email.trim()) {
      setErr('请先填写邮箱');
      return;
    }
    setErr('');
    setSendCodeBusy(true);
    try {
      await api.nxCloudSendAuthCode(email.trim());
      setSendCodeSec(60);
    } catch (e: unknown) {
      setErr(formatCloudAuthError(e));
    } finally {
      setSendCodeBusy(false);
    }
  };

  const submit = async () => {
    const api = window.electronAPI;
    if (!api?.nxCloudLoginWithCode) {
      setErr('当前版本不支持验证码登录');
      return;
    }
    if (!email.trim() || !verifyCode.trim()) {
      setErr('请输入邮箱和验证码');
      return;
    }
    setErr('');
    setBusy(true);
    try {
      const result = await api.nxCloudLoginWithCode(email.trim(), verifyCode.trim());
      onLoggedIn({ isNewUser: result.isNewUser === true });
    } catch (e: unknown) {
      setErr(formatCloudAuthError(e));
    } finally {
      setBusy(false);
    }
  };

  const codeBtnDisabled = sendCodeBusy || sendCodeSec > 0 || busy;
  const codeBtnClass = codeBtnDisabled
    ? 'shrink-0 rounded-lg bg-white/[0.06] px-3 py-2 text-xs font-medium text-white/35 cursor-not-allowed border border-white/[0.06]'
    : 'shrink-0 rounded-lg bg-white/10 px-3 py-2 text-xs font-medium text-white hover:bg-white/15 border border-white/10 whitespace-nowrap';

  return (
    <div
      className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/80 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="nx-saas-title"
    >
      <div className="w-full max-w-md rounded-xl border border-white/10 bg-neutral-900 p-6 shadow-2xl">
        <h2 id="nx-saas-title" className="text-lg font-medium text-white mb-1">
          Aixflow 云端账号
        </h2>
        <p className="text-sm text-white/50 mb-5">使用邮箱验证码进入云端服务</p>

        <label className="block text-xs text-white/50 mb-1">邮箱</label>
        <input
          type="email"
          autoComplete="email"
          className="mb-3 w-full rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-sm text-white outline-none focus:border-apple-blue"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@example.com"
        />

        <label className="block text-xs text-white/50 mb-1">验证码</label>
        <div className="flex gap-2 mb-4">
          <input
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={8}
            className="min-w-0 flex-1 rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-sm text-white outline-none focus:border-apple-blue tracking-widest"
            value={verifyCode}
            onChange={(e) => setVerifyCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
            placeholder="6 位数字"
            onKeyDown={(e) => {
              if (e.key === 'Enter') void submit();
            }}
          />
          <button
            type="button"
            className={codeBtnClass}
            onClick={() => void sendCode()}
            disabled={codeBtnDisabled}
          >
            {sendCodeSec > 0 ? `${sendCodeSec}s 后可重发` : sendCodeBusy ? '发送中…' : '获取验证码'}
          </button>
        </div>

        {err ? <p className="text-sm text-red-400 mb-3">{err}</p> : null}

        <div className="flex gap-2 justify-end">
          <button
            type="button"
            className="rounded-lg px-4 py-2 text-sm text-white/60 hover:text-white"
            onClick={onClose}
            disabled={busy}
          >
            稍后
          </button>
          <button
            type="button"
            className="rounded-lg bg-apple-blue px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
            onClick={() => void submit()}
            disabled={busy}
          >
            {busy ? '处理中…' : '进入 Aixflow'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default NxSaaSLoginModal;
