import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  Clapperboard,
  GripHorizontal,
  Maximize2,
  Minimize2,
  PictureInPicture2,
  RefreshCw,
  X,
} from 'lucide-react';
import {
  DarkModalFrame,
  DARK_MODAL_Z,
} from '../darkModalShell';

export type TutorialVideoListItem = {
  objectKey: string;
  title: string;
  url: string;
  sortIndex: number;
};

export type TutorialVideosStrings = {
  tutorialVideos: string;
  tutorialVideosTitle: string;
  tutorialVideosHint: string;
  tutorialVideosClose: string;
  tutorialVideosLoading: string;
  tutorialVideosEmpty: string;
  tutorialVideosLoadFailed: string;
  tutorialVideosRetry: string;
  tutorialVideosEnlarge: string;
  tutorialVideosShrink: string;
  tutorialVideosPip: string;
  tutorialVideosRestore: string;
  tutorialVideosNoSelection: string;
};

type TutorialVideosEntryProps = {
  strings: TutorialVideosStrings;
  buttonClassName: string;
  isDarkMode: boolean;
  /** 窄顶栏：仅图标，文案放 title */
  hideLabel?: boolean;
};

type ViewMode = 'panel' | 'enlarged' | 'pip';

const PIP_MIN_W = 280;
const PIP_MIN_H = 180;
const PIP_DEFAULT_W = 360;
const PIP_DEFAULT_H = 240;

async function fetchTutorialList(force = false): Promise<
  { ok: true; items: TutorialVideoListItem[] } | { ok: false; error: string }
> {
  const api = window.electronAPI?.listTutorialVideos;
  if (!api) return { ok: false, error: 'unavailable' };
  return api(force);
}

/** 顶栏「教学视频」：列表 + 内嵌播放，支持放大与挂起旁观浮窗 */
export default function TutorialVideosEntry({
  strings: s,
  buttonClassName,
  isDarkMode,
  hideLabel = false,
}: TutorialVideosEntryProps) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<ViewMode>('panel');
  const [items, setItems] = useState<TutorialVideoListItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [errorKind, setErrorKind] = useState<'empty' | 'network' | null>(null);
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const resumeTimeRef = useRef(0);
  const wasPlayingRef = useRef(false);

  const [pipPos, setPipPos] = useState({ x: 24, y: 96 });
  const [pipSize, setPipSize] = useState({ w: PIP_DEFAULT_W, h: PIP_DEFAULT_H });
  const dragRef = useRef<{
    kind: 'move' | 'resize';
    startX: number;
    startY: number;
    origX: number;
    origY: number;
    origW: number;
    origH: number;
  } | null>(null);

  const active = items.find((it) => it.objectKey === activeKey) || items[0] || null;

  const rememberPlayback = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    resumeTimeRef.current = v.currentTime || 0;
    wasPlayingRef.current = !v.paused;
  }, []);

  const restorePlayback = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    const t = resumeTimeRef.current;
    if (Number.isFinite(t) && t > 0) {
      try {
        v.currentTime = t;
      } catch {
        /* ignore seek errors during load */
      }
    }
    if (wasPlayingRef.current) {
      void v.play().catch(() => undefined);
    }
  }, []);

  const loadList = useCallback(async (force = false) => {
    setLoading(true);
    setErrorKind(null);
    try {
      const res = await fetchTutorialList(force);
      if (res.ok && res.items.length > 0) {
        setItems(res.items);
        setActiveKey((prev) => {
          if (prev && res.items.some((it) => it.objectKey === prev)) return prev;
          return res.items[0]!.objectKey;
        });
        setErrorKind(null);
      } else {
        setItems([]);
        setActiveKey(null);
        setErrorKind(res.ok || res.error === 'empty' ? 'empty' : 'network');
      }
    } catch {
      setItems([]);
      setActiveKey(null);
      setErrorKind('network');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    void loadList(false);
  }, [open, loadList]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (mode === 'enlarged') {
          rememberPlayback();
          setMode('panel');
          return;
        }
        if (mode === 'pip') return;
        rememberPlayback();
        setOpen(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, mode, rememberPlayback]);

  useEffect(() => {
    if (!open || mode === 'pip') return;
    const id = requestAnimationFrame(() => restorePlayback());
    return () => cancelAnimationFrame(id);
  }, [mode, open, active?.url, restorePlayback]);

  useEffect(() => {
    if (!open || mode !== 'pip') return;
    const id = requestAnimationFrame(() => restorePlayback());
    return () => cancelAnimationFrame(id);
  }, [mode, open, restorePlayback]);

  const closeAll = useCallback(() => {
    rememberPlayback();
    const v = videoRef.current;
    if (v) {
      v.pause();
    }
    setOpen(false);
    setMode('panel');
  }, [rememberPlayback]);

  const openPanel = useCallback(() => {
    setMode('panel');
    setOpen(true);
  }, []);

  const selectVideo = useCallback(
    (key: string) => {
      if (key === activeKey) return;
      rememberPlayback();
      resumeTimeRef.current = 0;
      wasPlayingRef.current = true;
      setActiveKey(key);
    },
    [activeKey, rememberPlayback],
  );

  const enterEnlarge = useCallback(() => {
    rememberPlayback();
    setMode('enlarged');
  }, [rememberPlayback]);

  const exitEnlarge = useCallback(() => {
    rememberPlayback();
    setMode('panel');
  }, [rememberPlayback]);

  const enterPip = useCallback(() => {
    rememberPlayback();
    setMode('pip');
  }, [rememberPlayback]);

  const restoreFromPip = useCallback(() => {
    rememberPlayback();
    setMode('panel');
  }, [rememberPlayback]);

  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      const d = dragRef.current;
      if (!d) return;
      if (d.kind === 'move') {
        const nx = Math.max(0, Math.min(window.innerWidth - 80, d.origX + (e.clientX - d.startX)));
        const ny = Math.max(0, Math.min(window.innerHeight - 48, d.origY + (e.clientY - d.startY)));
        setPipPos({ x: nx, y: ny });
      } else {
        const nw = Math.max(PIP_MIN_W, Math.min(window.innerWidth - d.origX, d.origW + (e.clientX - d.startX)));
        const nh = Math.max(PIP_MIN_H, Math.min(window.innerHeight - d.origY, d.origH + (e.clientY - d.startY)));
        setPipSize({ w: nw, h: nh });
      }
    };
    const onUp = () => {
      dragRef.current = null;
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
  }, []);

  const startPipMove = (e: React.PointerEvent) => {
    e.preventDefault();
    dragRef.current = {
      kind: 'move',
      startX: e.clientX,
      startY: e.clientY,
      origX: pipPos.x,
      origY: pipPos.y,
      origW: pipSize.w,
      origH: pipSize.h,
    };
  };

  const startPipResize = (e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragRef.current = {
      kind: 'resize',
      startX: e.clientX,
      startY: e.clientY,
      origX: pipPos.x,
      origY: pipPos.y,
      origW: pipSize.w,
      origH: pipSize.h,
    };
  };

  const listPanel = (
    <div
      className={`flex flex-col overflow-hidden border-r ${
        isDarkMode ? 'border-white/10 bg-black/25' : 'border-gray-200 bg-gray-50'
      } ${mode === 'enlarged' ? 'w-[220px]' : 'w-[200px]'}`}
    >
      <div
        className={`px-3 py-2 text-xs font-medium tracking-wide ${
          isDarkMode ? 'text-white/45' : 'text-gray-500'
        }`}
      >
        {s.tutorialVideosHint}
      </div>
      <div className="flex-1 overflow-y-auto px-2 pb-2">
        {loading && items.length === 0 ? (
          <p className={`px-2 py-4 text-xs ${isDarkMode ? 'text-white/50' : 'text-gray-500'}`}>
            {s.tutorialVideosLoading}
          </p>
        ) : errorKind ? (
          <div className="flex flex-col items-start gap-2 px-2 py-4">
            <p className={`text-xs leading-relaxed ${isDarkMode ? 'text-white/60' : 'text-gray-600'}`}>
              {errorKind === 'empty' ? s.tutorialVideosEmpty : s.tutorialVideosLoadFailed}
            </p>
            <button
              type="button"
              onClick={() => void loadList(true)}
              className={`inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs ${
                isDarkMode
                  ? 'bg-white/10 text-white/80 hover:bg-white/15'
                  : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
              }`}
            >
              <RefreshCw className="h-3 w-3" />
              {s.tutorialVideosRetry}
            </button>
          </div>
        ) : (
          <ul className="flex flex-col gap-0.5">
            {items.map((it) => {
              const selected = active?.objectKey === it.objectKey;
              return (
                <li key={it.objectKey}>
                  <button
                    type="button"
                    onClick={() => selectVideo(it.objectKey)}
                    className={`w-full rounded-lg px-2.5 py-2 text-left text-xs leading-snug transition-colors ${
                      selected
                        ? isDarkMode
                          ? 'bg-white/15 text-white'
                          : 'bg-amber-100 text-gray-900'
                        : isDarkMode
                          ? 'text-white/70 hover:bg-white/8 hover:text-white'
                          : 'text-gray-700 hover:bg-gray-200'
                    }`}
                    title={it.title}
                  >
                    {it.title}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );

  const renderVideo = () =>
    active?.url ? (
      <video
        ref={videoRef}
        key={active.url}
        src={active.url}
        controls
        playsInline
        className="h-full w-full bg-black object-contain"
        onLoadedMetadata={() => {
          restorePlayback();
        }}
      />
    ) : (
      <div
        className={`flex h-full min-h-[200px] items-center justify-center px-4 text-center text-sm ${
          isDarkMode ? 'text-white/45' : 'text-gray-400'
        }`}
      >
        {loading ? s.tutorialVideosLoading : s.tutorialVideosNoSelection}
      </div>
    );

  const toolbarBtn = (label: string, onClick: () => void, icon: React.ReactNode) => (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs transition-colors ${
        isDarkMode
          ? 'text-white/70 hover:bg-white/10 hover:text-white'
          : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'
      }`}
      title={label}
      aria-label={label}
    >
      {icon}
      <span className="hidden sm:inline">{label}</span>
    </button>
  );

  const playerHeader = (opts: { showEnlarge: boolean; showPip: boolean; onClose: () => void }) => (
    <div
      className={`flex items-center justify-between gap-2 border-b px-3 py-2 ${
        isDarkMode ? 'border-white/10' : 'border-gray-200'
      }`}
    >
      <div className={`min-w-0 truncate text-sm font-medium ${isDarkMode ? 'text-white/90' : 'text-gray-900'}`}>
        {active?.title || s.tutorialVideos}
      </div>
      <div className="flex shrink-0 items-center gap-0.5">
        {opts.showEnlarge
          ? mode === 'enlarged'
            ? toolbarBtn(s.tutorialVideosShrink, exitEnlarge, <Minimize2 className="h-3.5 w-3.5" />)
            : toolbarBtn(s.tutorialVideosEnlarge, enterEnlarge, <Maximize2 className="h-3.5 w-3.5" />)
          : null}
        {opts.showPip
          ? toolbarBtn(s.tutorialVideosPip, enterPip, <PictureInPicture2 className="h-3.5 w-3.5" />)
          : null}
        <button
          type="button"
          onClick={opts.onClose}
          className={`rounded-md p-1.5 transition-colors ${
            isDarkMode ? 'text-white/50 hover:bg-white/10 hover:text-white' : 'text-gray-400 hover:bg-gray-100 hover:text-gray-700'
          }`}
          aria-label={s.tutorialVideosClose}
          title={s.tutorialVideosClose}
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );

  const mainPlayerBody = (
    <div className="flex min-h-0 flex-1 flex-col">
      {playerHeader({
        showEnlarge: true,
        showPip: true,
        onClose: closeAll,
      })}
      <div className={`relative min-h-0 flex-1 ${mode === 'enlarged' ? 'bg-black' : 'bg-black/90'}`}>
        {renderVideo()}
      </div>
    </div>
  );

  const panelOpen = open && mode !== 'pip';

  return (
    <>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          if (open && mode === 'pip') {
            restoreFromPip();
            return;
          }
          openPanel();
        }}
        onMouseDown={(e) => e.stopPropagation()}
        className={buttonClassName}
        title={s.tutorialVideosTitle}
        aria-label={s.tutorialVideos}
      >
        <Clapperboard className="w-4 h-4 shrink-0" />
        {!hideLabel && <span className="whitespace-nowrap">{s.tutorialVideos}</span>}
      </button>

      <DarkModalFrame
        open={panelOpen}
        onBackdropClick={() => {
          if (mode === 'enlarged') {
            exitEnlarge();
            return;
          }
          closeAll();
        }}
        showBrandHeader={false}
        stackZClass={mode === 'enlarged' ? 'z-[100020]' : DARK_MODAL_Z}
        panelClassName={`nexflow-glass-panel relative flex overflow-hidden rounded-2xl border border-white/[0.12] shadow-2xl ${
          mode === 'enlarged'
            ? 'h-[min(92vh,900px)] w-[min(96vw,1200px)] flex-row'
            : 'mx-4 h-[min(78vh,560px)] w-full max-w-[860px] flex-row'
        } ${isDarkMode ? '' : 'border-gray-200 bg-white'}`}
      >
        {listPanel}
        {mainPlayerBody}
      </DarkModalFrame>

      {open && mode === 'pip'
        ? createPortal(
            <div
              className={`fixed overflow-hidden rounded-xl border shadow-2xl ${
                isDarkMode ? 'border-white/20 bg-gray-900/95' : 'border-gray-300 bg-white'
              }`}
              style={{
                left: pipPos.x,
                top: pipPos.y,
                width: pipSize.w,
                height: pipSize.h,
                zIndex: 100030,
              }}
              role="dialog"
              aria-label={s.tutorialVideos}
            >
              <div
                className={`flex cursor-grab items-center gap-1 border-b px-2 py-1.5 active:cursor-grabbing ${
                  isDarkMode ? 'border-white/10 bg-black/40' : 'border-gray-200 bg-gray-50'
                }`}
                onPointerDown={startPipMove}
              >
                <GripHorizontal
                  className={`h-3.5 w-3.5 shrink-0 ${isDarkMode ? 'text-white/40' : 'text-gray-400'}`}
                />
                <span
                  className={`min-w-0 flex-1 truncate text-xs font-medium ${
                    isDarkMode ? 'text-white/80' : 'text-gray-800'
                  }`}
                >
                  {active?.title || s.tutorialVideos}
                </span>
                <button
                  type="button"
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={(e) => {
                    e.stopPropagation();
                    restoreFromPip();
                  }}
                  className={`rounded p-1 text-xs ${
                    isDarkMode ? 'text-white/60 hover:bg-white/10 hover:text-white' : 'text-gray-500 hover:bg-gray-200'
                  }`}
                  title={s.tutorialVideosRestore}
                  aria-label={s.tutorialVideosRestore}
                >
                  <Maximize2 className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={(e) => {
                    e.stopPropagation();
                    closeAll();
                  }}
                  className={`rounded p-1 ${
                    isDarkMode ? 'text-white/50 hover:bg-white/10 hover:text-white' : 'text-gray-400 hover:bg-gray-200'
                  }`}
                  title={s.tutorialVideosClose}
                  aria-label={s.tutorialVideosClose}
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
              <div className="relative h-[calc(100%-36px)] w-full bg-black">
                {renderVideo()}
                <div
                  className="absolute bottom-0 right-0 h-4 w-4 cursor-se-resize"
                  onPointerDown={startPipResize}
                  aria-hidden
                >
                  <div
                    className={`absolute bottom-1 right-1 h-2 w-2 border-b-2 border-r-2 ${
                      isDarkMode ? 'border-white/40' : 'border-white/70'
                    }`}
                  />
                </div>
              </div>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
