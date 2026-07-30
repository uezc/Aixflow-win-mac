import React, { useCallback, useEffect, useState } from 'react';
import { X } from 'lucide-react';
import {
  DarkModalFrame,
  darkModalBtnOkClass,
  darkModalFooterClass,
} from '../darkModalShell';
import { getWeChatGroupQrUrlOverride } from '../../constants/wechatGroup';

function WeChatIcon({ className = 'h-3.5 w-3.5' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M8.691 2.188C3.891 2.188 0 5.476 0 9.53c0 2.212 1.17 4.203 3.002 5.55a.59.59 0 0 1 .213.665l-.39 1.48c-.019.07-.048.141-.048.213 0 .163.13.295.29.295a.326.326 0 0 0 .167-.054l1.903-1.114a.864.864 0 0 1 .717-.098 10.16 10.16 0 0 0 2.837.403c.276 0 .543-.027.811-.05-.857-2.578.157-4.972 1.932-6.446 1.703-1.415 3.882-1.98 5.853-1.838-.576-3.583-4.196-6.348-8.596-6.348zM5.785 5.991c.642 0 1.162.529 1.162 1.18a1.17 1.17 0 0 1-1.162 1.178A1.17 1.17 0 0 1 4.623 7.17c0-.651.52-1.18 1.162-1.18zm5.813 0c.642 0 1.162.529 1.162 1.18a1.17 1.17 0 0 1-1.162 1.178 1.17 1.17 0 0 1-1.162-1.178c0-.651.52-1.18 1.162-1.18zm5.34 2.867c-1.797-.052-3.746.512-5.28 1.786-1.72 1.428-2.687 3.72-1.78 6.22.942 2.453 3.666 4.229 6.884 4.229.826 0 1.622-.12 2.361-.336a.722.722 0 0 1 .598.082l1.584.926a.272.272 0 0 0 .14.047c.134 0 .24-.111.24-.247 0-.06-.023-.12-.038-.177l-.327-1.233a.582.582 0 0 1-.023-.156.49.49 0 0 1 .201-.398C23.024 18.48 24 16.82 24 14.98c0-3.21-2.931-5.837-6.656-6.088V8.89c-.135-.01-.27-.027-.407-.032zm-2.53 3.274c.535 0 .969.44.969.982a.976.976 0 0 1-.969.983.976.976 0 0 1-.969-.983c0-.542.434-.982.97-.982zm4.844 0c.535 0 .969.44.969.982a.976.976 0 0 1-.969.983.976.976 0 0 1-.969-.983c0-.542.434-.982.969-.982z" />
    </svg>
  );
}

type WeChatGroupEntryProps = {
  label: string;
  title: string;
  hint: string;
  closeLabel: string;
  loadingLabel: string;
  loadFailedLabel: string;
};

async function resolveQrUrl(force = false): Promise<string | null> {
  const override = getWeChatGroupQrUrlOverride();
  if (override) return override;
  const api = window.electronAPI?.getWeChatGroupQrUrl;
  if (!api) return null;
  const res = await api(force);
  return res?.ok ? res.url : null;
}

/** 登录卡底部：微信图标 +「交流群」，点击弹出群二维码（OSS WX/ 动态列举） */
export default function WeChatGroupEntry({
  label,
  title,
  hint,
  closeLabel,
  loadingLabel,
  loadFailedLabel,
}: WeChatGroupEntryProps) {
  const [open, setOpen] = useState(false);
  const [qrUrl, setQrUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);

  const loadQr = useCallback(async (force = false) => {
    setLoading(true);
    setFailed(false);
    try {
      const url = await resolveQrUrl(force);
      if (url) {
        setQrUrl(url);
        setFailed(false);
      } else {
        setQrUrl(null);
        setFailed(true);
      }
    } catch {
      setQrUrl(null);
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    void loadQr(false);
  }, [open, loadQr]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-[#07C160]/35 bg-[#07C160]/10 px-2.5 py-1 text-xs text-white/85 transition-colors hover:bg-[#07C160]/18 hover:text-white"
        aria-label={label}
      >
        <WeChatIcon className="h-3.5 w-3.5 text-[#07C160]" />
        <span>{label}</span>
      </button>

      <DarkModalFrame
        open={open}
        onBackdropClick={() => setOpen(false)}
        showBrandHeader={false}
        panelClassName="nexflow-glass-panel relative flex w-full max-w-[min(100%,360px)] flex-col overflow-hidden rounded-2xl border border-white/[0.12] shadow-2xl mx-4"
        footer={
          <div className={darkModalFooterClass}>
            <button type="button" onClick={() => setOpen(false)} className={`${darkModalBtnOkClass} w-full max-w-[280px]`}>
              {closeLabel}
            </button>
          </div>
        }
      >
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="absolute right-3 top-3 z-10 rounded-full p-1.5 text-white/45 transition-colors hover:bg-white/10 hover:text-white/80"
          aria-label={closeLabel}
        >
          <X className="h-4 w-4" />
        </button>
        <div className="px-5 pb-2 pt-6 text-center sm:px-6">
          <div className="mb-1 flex items-center justify-center gap-2 text-white">
            <WeChatIcon className="h-5 w-5 text-[#07C160]" />
            <h2 className="text-base font-semibold tracking-tight">{title}</h2>
          </div>
          <p className="text-xs text-white/50">{hint}</p>
        </div>
        <div className="flex justify-center px-5 pb-4 pt-3 sm:px-6">
          <div className="flex h-[236px] w-[236px] items-center justify-center overflow-hidden rounded-xl border border-white/10 bg-white p-2 shadow-inner">
            {loading && !qrUrl ? (
              <span className="text-xs text-neutral-500">{loadingLabel}</span>
            ) : failed && !qrUrl ? (
              <button
                type="button"
                onClick={() => void loadQr(true)}
                className="px-3 text-center text-xs text-neutral-600 underline-offset-2 hover:underline"
              >
                {loadFailedLabel}
              </button>
            ) : qrUrl ? (
              <img
                src={qrUrl}
                alt={title}
                className="h-[220px] w-[220px] object-contain"
                draggable={false}
                onError={() => {
                  setFailed(true);
                  setQrUrl(null);
                }}
              />
            ) : null}
          </div>
        </div>
      </DarkModalFrame>
    </>
  );
}
