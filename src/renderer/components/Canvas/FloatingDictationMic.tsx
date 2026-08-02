/**
 * 画布居中大话筒：先点输入框聚焦 → 按住大话筒 / 按住 Ctrl+S 听写，松开结束。
 * 写入最近聚焦的可听写输入；可向下收起（偏好 localStorage）。
 * 各面板右上角小话筒仍保留。
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown } from 'lucide-react';
import { useAppLocale } from '../../contexts/AppLocaleContext';
import { useDarkAlert } from '../../contexts/DarkAlertContext';
import { useCloudRealtimeDictation } from '../../hooks/useCloudRealtimeDictation';
import { useDictationPushToTalk } from '../../hooks/useDictationPushToTalk';
import { floatingDictationT } from '../../i18n/floatingDictationI18n';
import { audioInputPanelT } from '../../i18n/audioInputPanelI18n';
import {
  getLastDictationTarget,
  type DictationTargetAdapter,
} from '../../utils/dictationTargetRegistry';
import { showQuickConnectToast } from '../../utils/quickConnectStore';
import { micLevelCssVars } from '../../utils/micInputLevel';
import VoiceMicGlyph from './VoiceMicGlyph';

const COLLAPSED_LS_KEY = 'nexflow.floatingDictation.collapsed';

function readCollapsedPref(): boolean {
  try {
    return localStorage.getItem(COLLAPSED_LS_KEY) === '1';
  } catch {
    return false;
  }
}

function writeCollapsedPref(collapsed: boolean): void {
  try {
    localStorage.setItem(COLLAPSED_LS_KEY, collapsed ? '1' : '0');
  } catch {
    /* ignore */
  }
}

function isInWorkspaceScope(el: Element | null): boolean {
  if (!el) return false;
  return !!(
    el.closest?.('[data-nexflow-workspace-root]') ||
    el.closest?.('.react-flow') ||
    el.closest?.('[data-nexflow-dictation-target]') ||
    el.closest?.('[data-nexflow-floating-dictation]')
  );
}

export type FloatingDictationMicProps = {
  isDarkMode?: boolean;
};

const FloatingDictationMic: React.FC<FloatingDictationMicProps> = ({ isDarkMode = true }) => {
  const { locale } = useAppLocale();
  const { showAlert } = useDarkAlert();
  const t = useMemo(() => floatingDictationT(locale), [locale]);
  const refMicAt = useMemo(() => audioInputPanelT(locale), [locale]);

  const [collapsed, setCollapsed] = useState(readCollapsedPref);
  const targetRef = useRef<DictationTargetAdapter | null>(null);
  const ctrlSHeldRef = useRef(false);

  const {
    status: dictationStatus,
    isActive: isDictationActive,
    inputLevel: dictationInputLevel,
    start: startRealtimeDictation,
    stop: stopRealtimeDictation,
    cancel: cancelRealtimeDictation,
  } = useCloudRealtimeDictation({
    getBaseText: () => {
      const ad = targetRef.current ?? getLastDictationTarget();
      const prev = (ad?.getText() ?? '').trimEnd();
      return prev ? `${prev}\n` : '';
    },
    onLiveText: (full) => {
      const ad = targetRef.current ?? getLastDictationTarget();
      ad?.setText(full);
    },
    onError: (message) => {
      showAlert(message);
    },
    onMicDenied: () => {
      showAlert(refMicAt.micPermissionDenied);
    },
  });

  const micVoiceBusy = dictationStatus === 'connecting' || dictationStatus === 'stopping';
  const micVoiceStopping = dictationStatus === 'stopping';

  const ensureTargetOrToast = useCallback((): boolean => {
    const ad = getLastDictationTarget();
    if (!ad || !ad.isAvailable()) {
      showQuickConnectToast(t.needFocusToast, isDarkMode);
      return false;
    }
    targetRef.current = ad;
    return true;
  }, [t.needFocusToast, isDarkMode]);

  const { pressStart, pressEnd, pointerHandlers, holdingRef } = useDictationPushToTalk({
    start: startRealtimeDictation,
    stop: stopRealtimeDictation,
    cancel: cancelRealtimeDictation,
    status: dictationStatus,
    disabled: micVoiceStopping,
    canStart: ensureTargetOrToast,
  });

  useEffect(() => {
    const open = isDictationActive;
    (window as Window & { __nexflowVoiceModalOpen?: boolean }).__nexflowVoiceModalOpen = open;
    return () => {
      (window as Window & { __nexflowVoiceModalOpen?: boolean }).__nexflowVoiceModalOpen = false;
    };
  }, [isDictationActive]);

  const setCollapsedPref = useCallback((next: boolean) => {
    setCollapsed(next);
    writeCollapsedPref(next);
  }, []);

  // Ctrl+S / Cmd+S：按住开始、松开结束；听写优先于浏览器/应用「保存」
  useEffect(() => {
    const endShortcutHold = () => {
      if (!ctrlSHeldRef.current) return;
      ctrlSHeldRef.current = false;
      pressEnd();
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey) return;
      if (e.key.toLowerCase() !== 's') return;

      const active = document.activeElement;
      const inScope =
        isInWorkspaceScope(active instanceof Element ? active : null) ||
        !!getLastDictationTarget() ||
        isDictationActive ||
        ctrlSHeldRef.current;

      if (!inScope) return;

      e.preventDefault();
      e.stopPropagation();
      // 防系统自动重复 keydown 多次 start
      if (e.repeat || ctrlSHeldRef.current) return;
      pressStart();
      // canStart 失败时不会进入 holding，勿锁住后续按键
      if (!holdingRef.current) return;
      ctrlSHeldRef.current = true;
    };

    const onKeyUp = (e: KeyboardEvent) => {
      if (!ctrlSHeldRef.current) return;
      const key = e.key.toLowerCase();
      const releasedMod = e.key === 'Control' || e.key === 'Meta';
      const releasedS = key === 's';
      if (!releasedMod && !releasedS) return;
      e.preventDefault();
      e.stopPropagation();
      endShortcutHold();
    };

    const onWindowBlur = () => {
      endShortcutHold();
    };

    window.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('keyup', onKeyUp, true);
    window.addEventListener('blur', onWindowBlur);
    return () => {
      window.removeEventListener('keydown', onKeyDown, true);
      window.removeEventListener('keyup', onKeyUp, true);
      window.removeEventListener('blur', onWindowBlur);
    };
  }, [pressStart, pressEnd, isDictationActive, holdingRef]);

  useEffect(() => {
    if (!isDictationActive) {
      targetRef.current = null;
    }
  }, [isDictationActive]);

  if (typeof document === 'undefined') return null;

  if (collapsed && !isDictationActive) {
    return createPortal(
      <div
        className="pointer-events-none fixed inset-x-0 bottom-3 z-[100040] flex justify-center"
        data-nexflow-floating-dictation
      >
        <button
          type="button"
          className={`pointer-events-auto flex h-3 w-14 items-center justify-center rounded-full border shadow-lg transition-all hover:h-5 hover:w-16 ${
            isDarkMode
              ? 'border-white/20 bg-zinc-800/90 text-white/70 hover:bg-zinc-700'
              : 'border-gray-300 bg-white/95 text-gray-500 hover:bg-gray-100'
          }`}
          title={t.expandTitle}
          aria-label={t.expandTitle}
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setCollapsedPref(false);
          }}
        >
          <span className="sr-only">{t.expandTitle}</span>
          <span
            className={`block h-1 w-6 rounded-full ${isDarkMode ? 'bg-white/45' : 'bg-gray-400'}`}
          />
        </button>
      </div>,
      document.body,
    );
  }

  const title = micVoiceBusy
    ? t.busyTitle
    : isDictationActive
      ? t.stopTitle
      : t.startTitle;

  return createPortal(
    <div
      className="pointer-events-none fixed inset-x-0 bottom-8 z-[100040] flex flex-col items-center gap-2"
      data-nexflow-floating-dictation
    >
      <p
        className={`pointer-events-none select-none text-[11px] ${
          isDarkMode ? 'text-white/45' : 'text-gray-500'
        }`}
      >
        {t.shortcutHint}
      </p>
      <div className="pointer-events-auto relative flex flex-col items-center">
        <button
          type="button"
          {...pointerHandlers}
          disabled={micVoiceStopping}
          style={
            dictationStatus === 'listening' || dictationStatus === 'connecting'
              ? micLevelCssVars(dictationInputLevel)
              : undefined
          }
          className={`nexflow-floating-dictation-mic nexflow-voice-mic-btn flex h-14 w-14 items-center justify-center rounded-full border-2 shadow-xl select-none ${
            dictationStatus === 'connecting'
              ? 'connecting'
              : dictationStatus === 'listening'
                ? 'listening'
                : ''
          } ${
            micVoiceStopping
              ? isDarkMode
                ? 'cursor-wait border-white/30 bg-zinc-800/95 text-white'
                : 'cursor-wait border-gray-300 bg-white text-gray-700'
              : isDarkMode
                ? 'border-white/30 bg-zinc-800/95 text-white hover:bg-zinc-700'
                : 'border-gray-300 bg-white text-gray-700 hover:bg-gray-50'
          }`}
          title={title}
          aria-label={title}
        >
          <VoiceMicGlyph
            size="lg"
            busy={micVoiceBusy}
            active={dictationStatus === 'listening'}
            level={dictationInputLevel}
          />
        </button>
        {!isDictationActive && (
          <button
            type="button"
            className={`mt-1.5 flex h-6 w-6 items-center justify-center rounded-full border transition-colors ${
              isDarkMode
                ? 'border-white/15 bg-zinc-900/80 text-white/50 hover:text-white/80'
                : 'border-gray-200 bg-white/90 text-gray-400 hover:text-gray-600'
            }`}
            title={t.collapseTitle}
            aria-label={t.collapseTitle}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setCollapsedPref(true);
            }}
          >
            <ChevronDown className="h-3.5 w-3.5" strokeWidth={2.5} />
          </button>
        )}
      </div>
    </div>,
    document.body,
  );
};

export default FloatingDictationMic;
