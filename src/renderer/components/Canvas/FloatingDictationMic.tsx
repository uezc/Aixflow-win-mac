/**
 * 画布悬浮大话筒：先点输入框聚焦 → 按住大话筒 / 按住语音快捷键听写，松开结束。
 * 可拖动；拖到窗口边缘松开会半露收起，再拖回画布即展开。
 * 各面板右上角小话筒仍保留。
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
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
import { acquireVoiceModalLock, forceClearVoiceModalLock, releaseVoiceModalLock } from '../../utils/voiceModalGate';
import {
  formatVoiceInputShortcutLabel,
  isVoiceShortcutRecording,
  matchesVoiceInputShortcut,
  readVoiceInputShortcut,
  VOICE_INPUT_SHORTCUT_CHANGED_EVENT,
  type VoiceInputShortcut,
} from '../../utils/voiceInputShortcutPrefs';
import VoiceMicGlyph from './VoiceMicGlyph';

const POSITION_LS_KEY = 'nexflow.floatingDictation.position';
const LEGACY_COLLAPSED_LS_KEY = 'nexflow.floatingDictation.collapsed';
/** 超过该像素位移视为拖动，取消按住说话 */
const DRAG_THRESHOLD_PX = 8;
/** 松手时距边缘小于此值则半露吸附 */
const EDGE_SNAP_PX = 36;
const MIC_SIZE = 56;
const VIEW_INSET = MIC_SIZE / 2 + 8;

type DockEdge = 'left' | 'right' | 'top' | 'bottom';
/** left/top 为话筒中心点（fixed + translate(-50%,-50%)） */
type FloatingLayout = { left: number; top: number; edge: DockEdge | null };

function readLayoutPref(): FloatingLayout {
  const vw = typeof window !== 'undefined' ? window.innerWidth : 1200;
  const vh = typeof window !== 'undefined' ? window.innerHeight : 800;
  const fallback: FloatingLayout = { left: vw / 2, top: vh - 56, edge: null };
  try {
    const raw = localStorage.getItem(POSITION_LS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<FloatingLayout>;
      const left = Number(parsed?.left);
      const top = Number(parsed?.top);
      const edgeRaw = String(parsed?.edge || '').trim();
      const edge =
        edgeRaw === 'left' || edgeRaw === 'right' || edgeRaw === 'top' || edgeRaw === 'bottom'
          ? edgeRaw
          : null;
      if (Number.isFinite(left) && Number.isFinite(top)) {
        return snapLayout({ left, top, edge }, vw, vh);
      }
    }
    // 旧版「收起」偏好 → 默认贴底半露
    if (localStorage.getItem(LEGACY_COLLAPSED_LS_KEY) === '1') {
      localStorage.removeItem(LEGACY_COLLAPSED_LS_KEY);
      return snapLayout({ left: vw / 2, top: vh, edge: 'bottom' }, vw, vh);
    }
  } catch {
    /* ignore */
  }
  return fallback;
}

function writeLayoutPref(layout: FloatingLayout): void {
  try {
    localStorage.setItem(POSITION_LS_KEY, JSON.stringify(layout));
    localStorage.removeItem(LEGACY_COLLAPSED_LS_KEY);
  } catch {
    /* ignore */
  }
}

function clampFree(left: number, top: number, vw: number, vh: number): { left: number; top: number } {
  return {
    left: Math.min(vw, Math.max(0, left)),
    top: Math.min(vh, Math.max(0, top)),
  };
}

function pickDockEdge(left: number, top: number, vw: number, vh: number): DockEdge | null {
  const distL = left;
  const distR = vw - left;
  const distT = top;
  const distB = vh - top;
  const min = Math.min(distL, distR, distT, distB);
  if (min > EDGE_SNAP_PX) return null;
  if (min === distL) return 'left';
  if (min === distR) return 'right';
  if (min === distT) return 'top';
  return 'bottom';
}

function snapLayout(layout: FloatingLayout, vw: number, vh: number): FloatingLayout {
  const edge = layout.edge;
  if (!edge) {
    return {
      left: Math.min(vw - VIEW_INSET, Math.max(VIEW_INSET, layout.left)),
      top: Math.min(vh - VIEW_INSET, Math.max(VIEW_INSET, layout.top)),
      edge: null,
    };
  }
  const free = clampFree(layout.left, layout.top, vw, vh);
  switch (edge) {
    case 'left':
      return { left: 0, top: Math.min(vh - VIEW_INSET, Math.max(VIEW_INSET, free.top)), edge };
    case 'right':
      return { left: vw, top: Math.min(vh - VIEW_INSET, Math.max(VIEW_INSET, free.top)), edge };
    case 'top':
      return { left: Math.min(vw - VIEW_INSET, Math.max(VIEW_INSET, free.left)), top: 0, edge };
    case 'bottom':
      return { left: Math.min(vw - VIEW_INSET, Math.max(VIEW_INSET, free.left)), top: vh, edge };
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
  const [voiceShortcut, setVoiceShortcut] = useState<VoiceInputShortcut>(() =>
    readVoiceInputShortcut(),
  );
  const voiceShortcutRef = useRef(voiceShortcut);
  voiceShortcutRef.current = voiceShortcut;

  const t = useMemo(() => {
    void voiceShortcut;
    return floatingDictationT(locale);
  }, [locale, voiceShortcut]);
  const refMicAt = useMemo(() => audioInputPanelT(locale), [locale]);

  const [layout, setLayout] = useState<FloatingLayout>(() => readLayoutPref());
  const layoutRef = useRef(layout);
  layoutRef.current = layout;
  const shellRef = useRef<HTMLDivElement | null>(null);
  const targetRef = useRef<DictationTargetAdapter | null>(null);
  const shortcutHeldRef = useRef(false);
  const dragRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    originLeft: number;
    originTop: number;
    dragging: boolean;
  } | null>(null);

  useEffect(() => {
    const sync = () => setVoiceShortcut(readVoiceInputShortcut());
    const onChanged = () => sync();
    window.addEventListener(VOICE_INPUT_SHORTCUT_CHANGED_EVENT, onChanged);
    window.addEventListener('storage', onChanged);
    return () => {
      window.removeEventListener(VOICE_INPUT_SHORTCUT_CHANGED_EVENT, onChanged);
      window.removeEventListener('storage', onChanged);
    };
  }, []);

  useEffect(() => {
    const onResize = () => {
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      setLayout((prev) => {
        const next = snapLayout(prev, vw, vh);
        writeLayoutPref(next);
        return next;
      });
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

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
  const docked = !!layout.edge && !isDictationActive;

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
    stop: async () => {
      const text = await stopRealtimeDictation();
      const ad = targetRef.current ?? getLastDictationTarget();
      ad?.commit?.();
      return text;
    },
    cancel: () => {
      cancelRealtimeDictation();
      const ad = targetRef.current ?? getLastDictationTarget();
      ad?.commit?.();
    },
    status: dictationStatus,
    disabled: false,
    canStart: ensureTargetOrToast,
  });

  useEffect(() => {
    if (!isDictationActive) return;
    acquireVoiceModalLock();
    return () => releaseVoiceModalLock();
  }, [isDictationActive]);

  const commitLayout = useCallback((next: FloatingLayout) => {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const snapped = snapLayout(next, vw, vh);
    layoutRef.current = snapped;
    setLayout(snapped);
    writeLayoutPref(snapped);
  }, []);

  const applyDragMove = useCallback(
    (clientX: number, clientY: number) => {
      const d = dragRef.current;
      if (!d) return;
      const dx = clientX - d.startX;
      const dy = clientY - d.startY;
      if (!d.dragging) {
        if (Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return;
        d.dragging = true;
        if (holdingRef.current || shortcutHeldRef.current) {
          shortcutHeldRef.current = false;
          pressEnd();
          cancelRealtimeDictation();
        }
      }
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const free = clampFree(d.originLeft + dx, d.originTop + dy, vw, vh);
      // 拖动中先取消吸附，便于拖出边缘
      const next: FloatingLayout = { ...free, edge: null };
      layoutRef.current = next;
      setLayout(next);
    },
    [cancelRealtimeDictation, holdingRef, pressEnd],
  );

  const endDragSession = useCallback(
    (pointerId: number, commit: boolean) => {
      const d = dragRef.current;
      if (!d || d.pointerId !== pointerId) return;
      const wasDragging = d.dragging;
      dragRef.current = null;
      if (wasDragging && commit) {
        const cur = layoutRef.current;
        const vw = window.innerWidth;
        const vh = window.innerHeight;
        const edge = pickDockEdge(cur.left, cur.top, vw, vh);
        commitLayout({ left: cur.left, top: cur.top, edge });
      }
      return wasDragging;
    },
    [commitLayout],
  );

  const onShellPointerDown = useCallback((e: React.PointerEvent<HTMLElement>) => {
    if (e.button !== 0) return;
    if ((e.target as HTMLElement | null)?.closest?.('.nexflow-floating-dictation-mic')) return;
    e.preventDefault();
    e.stopPropagation();
    dragRef.current = {
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      originLeft: layoutRef.current.left,
      originTop: layoutRef.current.top,
      dragging: false,
    };
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
  }, []);

  const onShellPointerMove = useCallback(
    (e: React.PointerEvent<HTMLElement>) => {
      const d = dragRef.current;
      if (!d || d.pointerId !== e.pointerId) return;
      applyDragMove(e.clientX, e.clientY);
    },
    [applyDragMove],
  );

  const onShellPointerUp = useCallback(
    (e: React.PointerEvent<HTMLElement>) => {
      const d = dragRef.current;
      if (!d || d.pointerId !== e.pointerId) return;
      endDragSession(e.pointerId, true);
      try {
        if (e.currentTarget.hasPointerCapture?.(e.pointerId)) {
          e.currentTarget.releasePointerCapture(e.pointerId);
        }
      } catch {
        /* ignore */
      }
    },
    [endDragSession],
  );

  const micPointerHandlers = useMemo(() => {
    const base = pointerHandlers;
    return {
      ...base,
      onPointerDown: (e: React.PointerEvent<HTMLElement>) => {
        dragRef.current = {
          pointerId: e.pointerId,
          startX: e.clientX,
          startY: e.clientY,
          originLeft: layoutRef.current.left,
          originTop: layoutRef.current.top,
          dragging: false,
        };
        base.onPointerDown(e);
      },
      onPointerMove: (e: React.PointerEvent<HTMLElement>) => {
        const d = dragRef.current;
        if (!d || d.pointerId !== e.pointerId) return;
        applyDragMove(e.clientX, e.clientY);
      },
      onPointerUp: (e: React.PointerEvent<HTMLElement>) => {
        const wasDragging = endDragSession(e.pointerId, true);
        if (wasDragging) {
          e.preventDefault();
          e.stopPropagation();
          return;
        }
        base.onPointerUp(e);
      },
      onPointerCancel: (e: React.PointerEvent<HTMLElement>) => {
        endDragSession(e.pointerId, false);
        base.onPointerCancel(e);
      },
    };
  }, [applyDragMove, endDragSession, pointerHandlers]);

  useEffect(() => {
    const endShortcutHold = () => {
      if (!shortcutHeldRef.current) return;
      shortcutHeldRef.current = false;
      pressEnd();
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (isVoiceShortcutRecording()) return;
      const sc = voiceShortcutRef.current;
      if (!matchesVoiceInputShortcut(e, sc)) return;

      const active = document.activeElement;
      const inScope =
        isInWorkspaceScope(active instanceof Element ? active : null) ||
        !!getLastDictationTarget() ||
        isDictationActive ||
        shortcutHeldRef.current;

      if (!inScope) return;

      e.preventDefault();
      e.stopPropagation();
      if (e.repeat || shortcutHeldRef.current) return;
      pressStart();
      if (!holdingRef.current) return;
      shortcutHeldRef.current = true;
    };

    const onKeyUp = (e: KeyboardEvent) => {
      if (!shortcutHeldRef.current) return;
      const sc = voiceShortcutRef.current;
      const releasedMod =
        e.key === 'Control' ||
        e.key === 'Meta' ||
        e.key === 'Alt' ||
        e.key === 'Shift';
      const releasedMain = e.code === sc.code;
      if (!releasedMod && !releasedMain) return;
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

  useEffect(() => {
    const onForceEnd = () => {
      if (shortcutHeldRef.current) {
        shortcutHeldRef.current = false;
        pressEnd();
      } else if (isDictationActive || holdingRef.current) {
        pressEnd();
      }
      cancelRealtimeDictation();
      forceClearVoiceModalLock();
    };
    window.addEventListener('nexflow-force-end-dictation', onForceEnd);
    return () => window.removeEventListener('nexflow-force-end-dictation', onForceEnd);
  }, [pressEnd, isDictationActive, holdingRef, cancelRealtimeDictation]);

  if (typeof document === 'undefined') return null;

  const keyLabel = formatVoiceInputShortcutLabel(voiceShortcut);
  const title = micVoiceBusy
    ? t.busyTitle
    : isDictationActive
      ? t.stopTitle
      : docked
        ? `${t.startTitle} · ${t.dockHint}`
        : `${t.startTitle} · ${t.dragHint}`;

  const shellStyle: React.CSSProperties = {
    left: layout.left,
    top: layout.top,
    transform: 'translate(-50%, -50%)',
  };

  return createPortal(
    <div
      ref={shellRef}
      className={`fixed z-[100040] flex flex-col items-center gap-1.5 touch-none ${
        docked ? 'pointer-events-auto' : 'pointer-events-none'
      }`}
      style={shellStyle}
      data-nexflow-floating-dictation
      data-dock={layout.edge || 'none'}
      onPointerDown={onShellPointerDown}
      onPointerMove={onShellPointerMove}
      onPointerUp={onShellPointerUp}
      onPointerCancel={onShellPointerUp}
    >
      {!docked ? (
        <p
          className={`pointer-events-auto max-w-[220px] select-none text-center text-[11px] leading-snug cursor-grab active:cursor-grabbing ${
            isDarkMode ? 'text-white/45' : 'text-gray-500'
          }`}
          title={t.dragHint}
        >
          {t.shortcutHint}
        </p>
      ) : null}
      <div className="pointer-events-auto relative flex flex-col items-center">
        <button
          type="button"
          {...micPointerHandlers}
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
      </div>
      <span className="sr-only">{keyLabel}</span>
    </div>,
    document.body,
  );
};

export default FloatingDictationMic;
