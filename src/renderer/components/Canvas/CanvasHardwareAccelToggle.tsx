import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Gauge, RotateCcw } from 'lucide-react';
import { useAppLocale } from '../../contexts/AppLocaleContext';
import { settingsT } from '../../i18n/settingsI18n';

type CanvasHardwareAccelToggleProps = {
  isDarkMode: boolean;
};

type GpuDiagnostics = {
  experimentalEnabled: boolean;
  sessionActive: boolean;
  featureStatus: Record<string, string>;
  gpuDevice: string | null;
};

function featureLabel(raw: string | undefined, t: ReturnType<typeof settingsT>) {
  const v = String(raw ?? '').toLowerCase();
  if (v === 'enabled' || v === 'enabled_readback') return t.hwAccelFeatureEnabled;
  if (v === 'disabled' || v === 'disabled_software') return t.hwAccelFeatureDisabled;
  return t.hwAccelFeatureUnknown;
}

/** 画布右下角：实验性硬件加速开关 */
export default function CanvasHardwareAccelToggle({ isDarkMode }: CanvasHardwareAccelToggleProps) {
  const { locale } = useAppLocale();
  const t = settingsT(locale);
  const [enabled, setEnabled] = useState(false);
  const [active, setActive] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [restartBusy, setRestartBusy] = useState(false);
  const [pendingRestart, setPendingRestart] = useState(false);
  const [open, setOpen] = useState(false);
  const [diag, setDiag] = useState<GpuDiagnostics | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    if (!window.electronAPI?.getExperimentalHardwareAcceleration) {
      setLoading(false);
      return;
    }
    try {
      const state = await window.electronAPI.getExperimentalHardwareAcceleration();
      setEnabled(state.enabled);
      setActive(state.active);
      setPendingRestart(state.enabled !== state.active);
    } catch {
      /* ignore */
    } finally {
      setLoading(false);
    }
  }, []);

  const loadDiagnostics = useCallback(async () => {
    if (!window.electronAPI?.getGpuDiagnostics) return;
    try {
      const d = await window.electronAPI.getGpuDiagnostics();
      setDiag(d);
      setEnabled(d.experimentalEnabled);
      setActive(d.sessionActive);
      setPendingRestart(d.experimentalEnabled !== d.sessionActive);
    } catch {
      setDiag(null);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!open) return;
    void loadDiagnostics();
    const onDocClick = (e: MouseEvent) => {
      const el = e.target as Node;
      if (rootRef.current?.contains(el)) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [open, loadDiagnostics]);

  const handleToggle = async () => {
    if (!window.electronAPI?.setExperimentalHardwareAcceleration || busy || loading) return;
    const next = !enabled;
    setBusy(true);
    try {
      const res = await window.electronAPI.setExperimentalHardwareAcceleration(next);
      setEnabled(res.enabled);
      setPendingRestart(res.needsRestart);
      setOpen(true);
      if (res.needsRestart) {
        void loadDiagnostics();
      }
    } catch (e) {
      console.error('[CanvasHardwareAccelToggle] toggle failed:', e);
    } finally {
      setBusy(false);
    }
  };

  const handleRestart = async () => {
    if (!window.electronAPI?.relaunchApp || restartBusy) return;
    setRestartBusy(true);
    try {
      await window.electronAPI.relaunchApp();
    } catch (e) {
      console.error('[CanvasHardwareAccelToggle] relaunch failed:', e);
      setRestartBusy(false);
    }
  };

  if (!window.electronAPI?.getExperimentalHardwareAcceleration) return null;

  const pillLabel = pendingRestart
    ? locale === 'zh'
      ? 'GPU·重启'
      : 'GPU·restart'
    : active
      ? locale === 'zh'
        ? 'GPU 开'
        : 'GPU on'
      : locale === 'zh'
        ? 'GPU 关'
        : 'GPU off';

  const pillClass = pendingRestart
    ? isDarkMode
      ? 'ring-1 ring-amber-400/70 bg-amber-500/20 text-amber-100'
      : 'ring-1 ring-amber-500/60 bg-amber-50 text-amber-900'
    : active
      ? isDarkMode
        ? 'ring-1 ring-sky-400/60 bg-sky-500/20 text-sky-100'
        : 'ring-1 ring-sky-500/50 bg-sky-50 text-sky-900'
      : isDarkMode
        ? 'nexflow-frosted-glass-dark text-white/75 hover:bg-white/12'
        : 'nexflow-frosted-glass-light text-gray-700 hover:bg-white/60';

  const muted = isDarkMode ? 'text-white/45' : 'text-gray-500';
  const textMain = isDarkMode ? 'text-white' : 'text-gray-900';

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setOpen((o) => !o);
        }}
        disabled={loading}
        className={`nexflow-theme-fixed nexflow-frosted-glass flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium transition-all disabled:opacity-50 ${pillClass}`}
        title={t.hwAccelTitle}
        aria-expanded={open}
        aria-haspopup="dialog"
      >
        <Gauge className="h-4 w-4 shrink-0" aria-hidden />
        <span className="tabular-nums">{pillLabel}</span>
      </button>

      {open ? (
        <div
          role="dialog"
          aria-label={t.hwAccelTitle}
          className={`absolute bottom-full right-0 z-[20] mb-2 w-[min(19rem,calc(100vw-2rem))] rounded-xl border p-3 shadow-xl ${
            isDarkMode ? 'nexflow-glass-panel border-white/20' : 'border-gray-200 bg-white/95'
          }`}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <div className="mb-2 flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className={`text-sm font-medium ${textMain}`}>{t.hwAccelTitle}</p>
              <p className={`mt-1 text-[11px] leading-relaxed ${muted}`}>{t.hwAccelDesc}</p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={enabled}
              aria-label={t.hwAccelTitle}
              disabled={loading || busy}
              onClick={() => void handleToggle()}
              className={`relative h-6 w-11 shrink-0 rounded-full transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-400/50 disabled:opacity-45 ${
                enabled ? 'bg-sky-500/85' : 'bg-white/20'
              }`}
            >
              <span
                className={`absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${
                  enabled ? 'translate-x-5' : 'translate-x-0'
                }`}
              />
            </button>
          </div>

          {!loading ? (
            <p className={`mb-2 text-[10px] ${isDarkMode ? 'text-white/40' : 'text-gray-400'}`}>
              {active ? t.hwAccelStatusActive : t.hwAccelStatusInactive}
            </p>
          ) : null}

          {enabled && !active ? (
            <p className="mb-2 rounded-lg border border-amber-500/35 bg-amber-500/12 px-2.5 py-2 text-[11px] leading-relaxed text-amber-100/95">
              {t.hwAccelNotActiveWarning}
            </p>
          ) : null}

          <p className={`mb-2 text-[10px] leading-relaxed ${muted}`}>{t.hwAccelExpectHint}</p>

          {diag ? (
            <div className={`mb-2 rounded-lg border px-2.5 py-2 text-[10px] ${isDarkMode ? 'border-white/10 bg-black/25' : 'border-gray-200 bg-gray-50'}`}>
              <p className={`mb-1.5 font-medium ${textMain}`}>{t.hwAccelDiagTitle}</p>
              <div className={`space-y-1 ${muted}`}>
                <div className="flex justify-between gap-2">
                  <span>{t.hwAccelDiagCompositing}</span>
                  <span className={textMain}>{featureLabel(diag.featureStatus.gpu_compositing, t)}</span>
                </div>
                <div className="flex justify-between gap-2">
                  <span>{t.hwAccelDiagVideoDecode}</span>
                  <span className={textMain}>{featureLabel(diag.featureStatus.video_decode, t)}</span>
                </div>
                {diag.gpuDevice ? (
                  <div className="pt-1 border-t border-white/10">
                    <span className="block text-[9px] opacity-80">{t.hwAccelDiagGpuDevice}</span>
                    <span className={`block truncate ${textMain}`} title={diag.gpuDevice}>
                      {diag.gpuDevice}
                    </span>
                  </div>
                ) : null}
              </div>
            </div>
          ) : null}

          {pendingRestart || (enabled && !active) ? (
            <div className="flex flex-col gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-2.5 py-2">
              <p className="text-[11px] text-amber-100/95">{t.hwAccelRestartHint}</p>
              <button
                type="button"
                disabled={restartBusy}
                onClick={() => void handleRestart()}
                className="nexflow-btn-secondary nexflow-btn-secondary-sm w-full justify-center"
              >
                <RotateCcw className={`h-3.5 w-3.5 ${restartBusy ? 'animate-spin' : ''}`} />
                {restartBusy ? t.hwAccelRestarting : t.hwAccelRestart}
              </button>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
