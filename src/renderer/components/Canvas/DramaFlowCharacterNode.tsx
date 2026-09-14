/**
 * AI 短剧 2 代 — 角色卡画布节点。
 * 简介 + 角色提示词下拉；音色专区（未生成灰色）；正下方垃圾桶删除。
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Handle, Position, NodeProps, useStore } from 'reactflow';
import { Loader2, Pause, Play, Trash2, Volume2 } from 'lucide-react';
import { scaleModulePx } from '../../utils/moduleDisplayScale';
import { useCanvasTheme } from '../../contexts/CanvasThemeContext';
import { useDarkAlert } from '../../contexts/DarkAlertContext';
import {
  nexflowOrangePillBtnBg,
  nexflowOrangePillBtnClass,
} from '../darkModalShell';
import AssetLibLazyThumb from '../AssetLibLazyThumb';
import { buildAudioEqBarHeightsPct } from '../../utils/audioEqThumb';
import { useViewportIntersection } from '../../hooks/useViewportIntersection';
import { DramaFlowCharacterNameTag } from './DramaFlowModuleTitleTag';
import { DramaFlowPromptEditDialog } from './DramaFlowPromptEditDialog';
import { DramaCharacterLibraryPickModal } from '../DirectorStudio/DramaCharacterLibraryPick';
import {
  composeDramaVoiceSampleLine,
  type DramaDirectorSession,
} from '../../../shared/directorDomain';

export const DRAMA_FLOW_CHARACTER_NODE_TYPE = 'dramaFlowCharacter';

export const DRAMA_FLOW_CHARACTER_DEFAULT_W = scaleModulePx(400);
export const DRAMA_FLOW_CHARACTER_DEFAULT_H = scaleModulePx(278);

export type DramaFlowCharacterNodeData = {
  label?: string;
  title?: string;
  parentDramaFlowId?: string;
  characterId?: string;
  name?: string;
  role?: string;
  identity?: string;
  personality?: string;
  /** 人物简单介绍（主展示区） */
  intro?: string;
  /** 角色定妆提示词（独立弹窗编辑） */
  prompt?: string;
  imageUrl?: string;
  status?: 'idle' | 'generating' | 'ready' | 'error' | string;
  error?: string;
  voiceId?: string;
  voiceSampleUrl?: string;
  voiceStatus?: 'idle' | 'generating' | 'ready' | 'error' | string;
  voiceError?: string;
  /** 声音试听台词 / 声音提示词 */
  voicePrompt?: string;
  stylePresetId?: string;
  width?: number;
  height?: number;
};

type Props = NodeProps<DramaFlowCharacterNodeData> & {
  onDataChange?: (nodeId: string, updates: Partial<DramaFlowCharacterNodeData>) => void;
  onGenerateImage?: (nodeId: string) => void;
  onGenerateVoice?: (nodeId: string) => void;
  onUploadImage?: (nodeId: string, file: File) => void;
  onPickImageFromCanvas?: (nodeId: string) => void;
  onUploadVoice?: (nodeId: string, file: File) => void;
  onPickVoiceFromCanvas?: (nodeId: string) => void;
  onClearVoice?: (nodeId: string) => void;
  onDelete?: (nodeId: string) => void;
  projectId?: string;
  /** 读取关联剧本节点的 directorDomain */
  getDirectorDomain?: (parentDramaFlowId: string) => DramaDirectorSession | null;
  /** 角色仓库写入后回写 domain + 本卡形象/声音 */
  onApplyLibrarySession?: (
    nodeId: string,
    next: DramaDirectorSession,
    summary: string,
  ) => void;
};

function SourceMenu({
  isDark,
  primaryLabel,
  generating,
  generatingLabel,
  onGenerate,
  onUpload,
  onPickCanvas,
  variant = 'sky',
  extraItems,
}: {
  isDark: boolean;
  primaryLabel: string;
  generating?: boolean;
  generatingLabel: string;
  onGenerate?: () => void;
  onUpload?: () => void;
  onPickCanvas?: () => void;
  variant?: 'sky' | 'orange';
  /** 「从画布选择」下方的额外菜单项（角色仓库 / 提示词弹窗入口） */
  extraItems?: Array<{ label: string; onClick: () => void }>;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement | null>(null);
  const [menuPos, setMenuPos] = useState<{ left: number; top: number; width: number } | null>(null);
  const itemCls = `nodrag flex h-7 w-full items-center px-2 text-left text-[10px] transition-colors ${
    isDark
      ? 'text-white/90 hover:bg-sky-500 hover:text-white'
      : 'text-gray-800 hover:bg-sky-500 hover:text-white'
  }`;
  const openMenu = () => {
    const r = btnRef.current?.getBoundingClientRect();
    if (r) setMenuPos({ left: r.left, top: r.bottom + 2, width: Math.max(r.width, 128) });
    setMenuOpen(true);
  };
  const skyCls = `nodrag box-border flex h-6 w-full items-center justify-center rounded-md px-1 text-[9px] leading-none ${
    isDark ? 'bg-sky-500/70 text-white' : 'bg-gray-900 text-white'
  } disabled:opacity-50`;
  return (
    <div
      className="relative min-w-0 flex-1"
      onMouseEnter={openMenu}
      onMouseLeave={() => setMenuOpen(false)}
    >
      <button
        ref={btnRef}
        type="button"
        className={
          variant === 'orange'
            ? `${nexflowOrangePillBtnClass} !h-6 w-full !px-2 !text-[9px] disabled:opacity-50`
            : skyCls
        }
        style={variant === 'orange' ? { background: nexflowOrangePillBtnBg } : undefined}
        disabled={generating}
        onClick={() => {
          if (!generating) onGenerate?.();
        }}
      >
        <span className="truncate">{generating ? generatingLabel : primaryLabel}</span>
      </button>
      {menuOpen && menuPos
        ? createPortal(
            <div
              className={`nodrag fixed z-[100090] overflow-hidden rounded-md border shadow-lg ${
                isDark ? 'border-white/15 bg-[#1c1c1e]' : 'border-gray-200 bg-white'
              }`}
              style={{ left: menuPos.left, top: menuPos.top, width: menuPos.width }}
              onMouseEnter={openMenu}
              onMouseLeave={() => setMenuOpen(false)}
            >
              <button
                type="button"
                className={itemCls}
                onClick={() => {
                  onUpload?.();
                  setMenuOpen(false);
                }}
              >
                本地上传
              </button>
              <button
                type="button"
                className={`${itemCls} disabled:opacity-40`}
                disabled={!onPickCanvas}
                onClick={() => {
                  onPickCanvas?.();
                  setMenuOpen(false);
                }}
              >
                从画布选择
              </button>
              {(extraItems || []).map((it) => (
                <button
                  key={it.label}
                  type="button"
                  className={itemCls}
                  onClick={() => {
                    setMenuOpen(false);
                    it.onClick();
                  }}
                >
                  {it.label}
                </button>
              ))}
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}

/** 定妆图空态：上传（悬停菜单）+ 生成 */
function EmptyImageActions({
  isDark,
  generating,
  onGenerate,
  onLocalUpload,
  onPickCanvas,
  onLibrary,
  onEditPrompt,
}: {
  isDark: boolean;
  generating?: boolean;
  onGenerate?: () => void;
  onLocalUpload?: () => void;
  onPickCanvas?: () => void;
  onLibrary?: () => void;
  onEditPrompt?: () => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement | null>(null);
  const [menuPos, setMenuPos] = useState<{ left: number; top: number; width: number } | null>(null);
  const itemCls = `nodrag flex h-7 w-full items-center px-2 text-left text-[10px] transition-colors ${
    isDark
      ? 'text-white/90 hover:bg-sky-500 hover:text-white'
      : 'text-gray-800 hover:bg-sky-500 hover:text-white'
  }`;
  const openMenu = () => {
    const r = btnRef.current?.getBoundingClientRect();
    if (r) {
      setMenuPos({
        left: r.left,
        top: r.bottom + 2,
        width: Math.max(r.width, 132),
      });
    }
    setMenuOpen(true);
  };
  const uploadCls = `nodrag box-border flex h-7 min-w-[4.5rem] items-center justify-center rounded-md px-2.5 text-[10px] leading-none ${
    isDark ? 'bg-white/12 text-white/90 ring-1 ring-white/15' : 'bg-gray-800 text-white'
  } disabled:opacity-50`;

  return (
    <div
      className="nodrag flex flex-col items-center justify-center gap-2 px-2"
      onPointerDown={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <div className="flex flex-wrap items-center justify-center gap-1.5">
        <div
          className="relative"
          onMouseEnter={openMenu}
          onMouseLeave={() => setMenuOpen(false)}
        >
          <button
            ref={btnRef}
            type="button"
            className={uploadCls}
            disabled={generating}
            title="上传定妆图"
          >
            上传
          </button>
          {menuOpen && menuPos
            ? createPortal(
                <div
                  className={`nodrag fixed z-[100090] overflow-hidden rounded-md border shadow-lg ${
                    isDark ? 'border-white/15 bg-[#1c1c1e]' : 'border-gray-200 bg-white'
                  }`}
                  style={{ left: menuPos.left, top: menuPos.top, width: menuPos.width }}
                  onMouseEnter={openMenu}
                  onMouseLeave={() => setMenuOpen(false)}
                >
                  <button
                    type="button"
                    className={itemCls}
                    onClick={() => {
                      setMenuOpen(false);
                      onLocalUpload?.();
                    }}
                  >
                    本地上传
                  </button>
                  <button
                    type="button"
                    className={`${itemCls} disabled:opacity-40`}
                    disabled={!onPickCanvas}
                    onClick={() => {
                      setMenuOpen(false);
                      onPickCanvas?.();
                    }}
                  >
                    画布选择
                  </button>
                  <button
                    type="button"
                    className={`${itemCls} disabled:opacity-40`}
                    disabled={!onLibrary}
                    onClick={() => {
                      setMenuOpen(false);
                      onLibrary?.();
                    }}
                  >
                    角色仓库
                  </button>
                  {onEditPrompt ? (
                    <button
                      type="button"
                      className={itemCls}
                      onClick={() => {
                        setMenuOpen(false);
                        onEditPrompt();
                      }}
                    >
                      角色提示词
                    </button>
                  ) : null}
                </div>,
                document.body,
              )
            : null}
        </div>
        <button
          type="button"
          className={`${nexflowOrangePillBtnClass} !h-7 !min-w-[4.5rem] !px-2.5 !text-[10px] disabled:opacity-50`}
          style={{ background: nexflowOrangePillBtnBg }}
          disabled={generating}
          title="生成定妆四宫格"
          onClick={() => {
            if (!generating) onGenerate?.();
          }}
        >
          {generating ? '生成中' : '生成'}
        </button>
      </div>
    </div>
  );
}

function formatClock(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return '0:00';
  const s = Math.floor(sec);
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${String(r).padStart(2, '0')}`;
}

/** 图2：紫波形播放器；canvas 细柱 + 仅可见且播放时动画；无音频时整块灰色 */
function DramaFlowVoicePlayer({
  url,
  generating,
  error,
  active = true,
}: {
  url: string;
  generating?: boolean;
  error?: string;
  /** 视口内才跑波形动画 / 保留轻量静态图 */
  active?: boolean;
}) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const progressRafRef = useRef<number | null>(null);
  const waveRafRef = useRef<number | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const hostRef = useRef<HTMLDivElement | null>(null);
  const progressFillRef = useRef<HTMLDivElement | null>(null);
  const progressThumbRef = useRef<HTMLDivElement | null>(null);
  const timeLabelRef = useRef<HTMLSpanElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [durationSec, setDurationSec] = useState(0);
  const [volume, setVolume] = useState(0.85);
  const hasMedia = !!String(url || '').trim();
  const bars = useMemo(
    () => buildAudioEqBarHeightsPct(url || 'empty-voice', 48).map((pct) => Math.max(14, Math.min(92, pct))),
    [url],
  );

  const stopProgressRaf = () => {
    if (progressRafRef.current != null) {
      cancelAnimationFrame(progressRafRef.current);
      progressRafRef.current = null;
    }
  };

  const stopWaveRaf = () => {
    if (waveRafRef.current != null) {
      cancelAnimationFrame(waveRafRef.current);
      waveRafRef.current = null;
    }
  };

  const paintProgress = (t: number, dur: number) => {
    const ratio = dur > 0 && Number.isFinite(dur) ? Math.max(0, Math.min(1, t / dur)) : 0;
    const pct = `${ratio * 100}%`;
    if (progressFillRef.current) progressFillRef.current.style.width = pct;
    if (progressThumbRef.current) progressThumbRef.current.style.left = pct;
    if (timeLabelRef.current) {
      timeLabelRef.current.textContent =
        dur > 0 ? `${formatClock(t)} / ${formatClock(dur)}` : formatClock(t);
    }
  };

  const drawWave = useCallback(
    (tSec = 0, animate = false) => {
      const canvas = canvasRef.current;
      const host = hostRef.current;
      if (!canvas || !host) return;
      const cssW = Math.max(1, host.clientWidth);
      const cssH = Math.max(1, host.clientHeight);
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const pw = Math.round(cssW * dpr);
      const ph = Math.round(cssH * dpr);
      if (canvas.width !== pw || canvas.height !== ph) {
        canvas.width = pw;
        canvas.height = ph;
        canvas.style.width = `${cssW}px`;
        canvas.style.height = `${cssH}px`;
      }
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      const bg = hasMedia
        ? ctx.createLinearGradient(0, 0, 0, cssH)
        : null;
      if (bg) {
        bg.addColorStop(0, '#5a3a9e');
        bg.addColorStop(0.55, '#3a2468');
        bg.addColorStop(1, '#1e1238');
        ctx.fillStyle = bg;
      } else {
        ctx.fillStyle = '#2a2a2e';
      }
      ctx.fillRect(0, 0, cssW, cssH);

      const n = bars.length;
      const padX = 6;
      const padBottom = 4;
      const padTop = 6;
      const usableW = Math.max(1, cssW - padX * 2);
      const usableH = Math.max(1, cssH - padTop - padBottom);
      const gap = 1.25;
      const barW = Math.min(1.5, Math.max(1, (usableW - gap * (n - 1)) / n));
      const totalW = n * barW + (n - 1) * gap;
      const startX = padX + (usableW - totalW) / 2;
      const fill = hasMedia ? '#c9b6f2' : '#7a7a82';
      ctx.fillStyle = fill;
      ctx.globalAlpha = hasMedia ? 0.95 : 0.5;

      for (let i = 0; i < n; i += 1) {
        const base = bars[i] / 100;
        let scale = 1;
        if (animate) {
          // 连续正弦，避免 CSS alternate 顿挫
          scale = 0.45 + 0.55 * (0.5 + 0.5 * Math.sin(tSec * 5.2 + i * 0.55));
        }
        const h = Math.max(2, usableH * base * scale);
        const x = startX + i * (barW + gap);
        const y = padTop + usableH - h;
        const r = Math.min(1, barW / 2);
        ctx.beginPath();
        if (typeof ctx.roundRect === 'function') {
          ctx.roundRect(x, y, barW, h, [r, r, 0.5, 0.5]);
        } else {
          ctx.rect(x, y, barW, h);
        }
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    },
    [bars, hasMedia],
  );

  const startProgressRaf = () => {
    stopProgressRaf();
    const tick = () => {
      const a = audioRef.current;
      if (a && !a.paused) {
        paintProgress(a.currentTime, Number.isFinite(a.duration) ? a.duration : 0);
        progressRafRef.current = requestAnimationFrame(tick);
      } else {
        progressRafRef.current = null;
      }
    };
    progressRafRef.current = requestAnimationFrame(tick);
  };

  useEffect(() => {
    setPlaying(false);
    paintProgress(0, 0);
    setDurationSec(0);
    stopProgressRaf();
    stopWaveRaf();
    const prev = audioRef.current;
    if (prev) {
      prev.pause();
      prev.removeAttribute('src');
      prev.load();
      audioRef.current = null;
    }
  }, [url]);

  useEffect(() => {
    return () => {
      stopProgressRaf();
      stopWaveRaf();
      const a = audioRef.current;
      if (!a) return;
      a.pause();
      a.removeAttribute('src');
      a.load();
      audioRef.current = null;
    };
  }, []);

  useEffect(() => {
    const a = audioRef.current;
    if (a) a.volume = volume;
  }, [volume]);

  // 静态波形：激活后绘制；尺寸变化重绘；离屏停动画
  useEffect(() => {
    if (!active) {
      stopWaveRaf();
      return;
    }
    drawWave(0, false);
    const host = hostRef.current;
    if (!host || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => {
      if (!playing) drawWave(0, false);
    });
    ro.observe(host);
    return () => ro.disconnect();
  }, [active, drawWave, playing]);

  // 仅可见且播放时跑波形 rAF
  useEffect(() => {
    stopWaveRaf();
    if (!active || !playing || !hasMedia) {
      if (active) drawWave(0, false);
      return;
    }
    const t0 = performance.now();
    const tick = (now: number) => {
      drawWave((now - t0) / 1000, true);
      waveRafRef.current = requestAnimationFrame(tick);
    };
    waveRafRef.current = requestAnimationFrame(tick);
    return () => stopWaveRaf();
  }, [active, playing, hasMedia, drawWave]);

  const ensureAudio = () => {
    let a = audioRef.current;
    if (!a) {
      a = new Audio();
      a.preload = 'metadata';
      a.volume = volume;
      a.addEventListener('ended', () => {
        setPlaying(false);
        stopProgressRaf();
        paintProgress(0, a!.duration || 0);
      });
      a.addEventListener('loadedmetadata', () => {
        const d = a!.duration;
        if (Number.isFinite(d) && d > 0) setDurationSec(d);
      });
      a.addEventListener('pause', () => stopProgressRaf());
      audioRef.current = a;
    }
    return a;
  };

  const toggle = () => {
    if (!hasMedia || generating) return;
    const a = ensureAudio();
    if (!a.paused) {
      a.pause();
      setPlaying(false);
      stopProgressRaf();
      return;
    }
    if (a.getAttribute('src') !== url) a.src = url;
    setPlaying(true);
    void a
      .play()
      .then(() => startProgressRaf())
      .catch(() => {
        setPlaying(false);
        stopProgressRaf();
      });
  };

  const seek = (ratio: number) => {
    if (!hasMedia) return;
    const a = ensureAudio();
    const dur = a.duration;
    if (!Number.isFinite(dur) || dur <= 0) return;
    const next = Math.max(0, Math.min(1, ratio)) * dur;
    a.currentTime = next;
    paintProgress(next, dur);
  };

  const thumb = hasMedia ? '#b794f6' : '#8a8a90';
  const trackActive = hasMedia ? 'bg-[#a78bfa]' : 'bg-white/25';

  return (
    <div
      className={`nodrag flex shrink-0 flex-col gap-1 rounded-lg border p-1 ${
        hasMedia
          ? 'border-[#3a2a5c]/70 bg-[#0a0a0c]'
          : 'border-white/10 bg-[#141416]'
      }`}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
    >
      <div
        ref={hostRef}
        className="relative h-10 w-full shrink-0 overflow-hidden rounded-md"
        title={hasMedia ? (playing ? '点击暂停' : '点击播放') : '暂无音色'}
        onClick={toggle}
      >
        {active ? (
          <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" />
        ) : (
          <div
            className="absolute inset-0"
            style={{
              background: hasMedia
                ? 'linear-gradient(180deg, #5a3a9e 0%, #3a2468 55%, #1e1238 100%)'
                : 'linear-gradient(180deg, #4a4a4e 0%, #2c2c2e 55%, #1a1a1c 100%)',
            }}
          />
        )}
        {generating ? (
          <div className="absolute inset-0 flex items-center justify-center bg-black/40 text-[10px] text-white/85">
            <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
            生成中…
          </div>
        ) : null}
      </div>

      <div className="flex shrink-0 items-center gap-2 px-0.5">
        <button
          type="button"
          className={`nodrag flex h-5 w-5 shrink-0 items-center justify-center disabled:opacity-35 ${
            hasMedia ? 'text-white/90' : 'text-white/35'
          }`}
          disabled={!hasMedia || generating}
          title={playing ? '暂停' : '播放'}
          onClick={toggle}
        >
          {playing ? (
            <Pause className="h-3.5 w-3.5" strokeWidth={2.25} />
          ) : (
            <Play className="ml-px h-3.5 w-3.5" strokeWidth={2.25} />
          )}
        </button>
        <div
          className={`relative h-4 min-w-0 flex-1 ${hasMedia ? 'cursor-pointer' : 'cursor-default'}`}
          onPointerDown={(e) => {
            e.stopPropagation();
            if (!hasMedia) return;
            const rect = e.currentTarget.getBoundingClientRect();
            const ratio = (e.clientX - rect.left) / Math.max(1, rect.width);
            seek(ratio);
            const onMove = (ev: PointerEvent) => {
              const r = (ev.clientX - rect.left) / Math.max(1, rect.width);
              seek(r);
            };
            const onUp = () => {
              window.removeEventListener('pointermove', onMove);
              window.removeEventListener('pointerup', onUp);
            };
            window.addEventListener('pointermove', onMove);
            window.addEventListener('pointerup', onUp);
          }}
        >
          <div className="absolute left-0 right-0 top-1/2 h-[5px] -translate-y-1/2 rounded-full bg-white/20" />
          <div
            ref={progressFillRef}
            className={`absolute left-0 top-1/2 h-[5px] -translate-y-1/2 rounded-full ${trackActive}`}
            style={{ width: '0%' }}
          />
          <div
            ref={progressThumbRef}
            className="absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full shadow"
            style={{ left: '0%', background: thumb }}
          />
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-2 px-0.5">
        <span
          ref={timeLabelRef}
          className={`min-w-[2.4rem] text-[10px] tabular-nums ${hasMedia ? 'text-white/55' : 'text-white/30'}`}
        >
          {durationSec > 0 ? `0:00 / ${formatClock(durationSec)}` : '0:00'}
        </span>
        <div className="ml-auto flex min-w-0 flex-1 items-center justify-end gap-1.5">
          <Volume2 className={`h-3 w-3 shrink-0 ${hasMedia ? 'text-white/50' : 'text-white/25'}`} />
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={volume}
            disabled={!hasMedia}
            className="nodrag h-1 w-14 max-w-[40%] cursor-pointer accent-[#a78bfa] disabled:opacity-40"
            onChange={(e) => setVolume(Number(e.target.value))}
            onPointerDown={(e) => e.stopPropagation()}
          />
        </div>
      </div>

      {error ? <div className="truncate px-0.5 text-[10px] text-red-400">{error}</div> : null}
    </div>
  );
}

export default function DramaFlowCharacterNode({
  id,
  data,
  selected,
  onDataChange,
  onGenerateImage,
  onGenerateVoice,
  onUploadImage,
  onPickImageFromCanvas,
  onUploadVoice,
  onPickVoiceFromCanvas,
  onClearVoice: _onClearVoice,
  onDelete,
  projectId,
  getDirectorDomain,
  onApplyLibrarySession,
}: Props) {
  const { isDarkMode } = useCanvasTheme();
  const { showAlert } = useDarkAlert();
  const selectedFromStore = useStore((state) => state.nodeInternals.get(id)?.selected ?? false);
  const isSelected = selectedFromStore || selected;
  const rootRef = useRef<HTMLDivElement | null>(null);
  const imageInputRef = useRef<HTMLInputElement | null>(null);
  const voiceInputRef = useRef<HTMLInputElement | null>(null);
  const [promptEdit, setPromptEdit] = useState<'image' | 'voice' | null>(null);
  const [libraryOpen, setLibraryOpen] = useState(false);
  // 视口外不解码定妆图 / 不跑波形；一旦进过视口则 sticky，避免来回闪占位
  const nearViewport = useViewportIntersection(rootRef, '280px', 0, false);
  const [mediaArmed, setMediaArmed] = useState(false);
  useEffect(() => {
    if (nearViewport) setMediaArmed(true);
  }, [nearViewport]);
  const mediaActive = mediaArmed || nearViewport;

  const name = String(data?.name || '未命名角色').trim() || '未命名角色';
  const prompt = String(data?.prompt || '');
  const fallbackIntro = [data?.role, data?.identity, data?.personality]
    .map((s) => String(s || '').trim())
    .filter(Boolean)
    .join(' · ');
  const intro = String(data?.intro ?? fallbackIntro);
  const imageUrl = String(data?.imageUrl || '').trim();
  const status = String(data?.status || 'idle');
  const generating = status === 'generating';
  const err = String(data?.error || '').trim();
  const voiceUrl = String(data?.voiceSampleUrl || '').trim();
  const voiceStatus = String(data?.voiceStatus || 'idle');
  const voiceGenerating = voiceStatus === 'generating';
  const voiceErr = String(data?.voiceError || '').trim();
  const voicePrompt = String(data?.voicePrompt || '');
  const parentId = String(data?.parentDramaFlowId || '').trim();
  const characterId = String(data?.characterId || '').trim();
  const directorDomain = parentId ? getDirectorDomain?.(parentId) || null : null;
  const w = DRAMA_FLOW_CHARACTER_DEFAULT_W;
  const h = DRAMA_FLOW_CHARACTER_DEFAULT_H;

  const patch = useCallback(
    (updates: Partial<DramaFlowCharacterNodeData>) => {
      onDataChange?.(id, updates);
    },
    [id, onDataChange],
  );

  const resolveVoicePromptText = useCallback(() => {
    const existing = String(data?.voicePrompt || '').trim();
    if (existing) return existing;
    const domain = parentId ? getDirectorDomain?.(parentId) || null : null;
    const cid = String(data?.characterId || '').trim();
    const ch =
      domain?.bible?.characters?.find((c) => String(c.character_id || '') === cid) || null;
    const voiceId = String(data?.voiceId || ch?.voice_id || '').trim();
    const voice =
      domain?.bible?.voices?.find((v) => String(v.voice_id || '') === voiceId) ||
      domain?.bible?.voices?.find((v) => String(v.character_id || '') === cid) ||
      null;
    const fromDomain = String(voice?.sample_text || '').trim();
    if (fromDomain) return fromDomain;
    return composeDramaVoiceSampleLine({
      name: ch?.name || String(data?.name || ''),
      age: ch?.age,
      role: ch?.role || String(data?.role || ''),
      identity: ch?.identity || String(data?.identity || ''),
      personality: ch?.personality || String(data?.personality || ''),
      gender: ch?.gender,
      timbre: voice?.timbre,
      voiceStyle: voice?.voiceStyle,
      language_style: voice?.language_style,
      emotion_range: voice?.emotion_range,
    });
  }, [data, getDirectorDomain, parentId]);

  const openVoicePromptEdit = useCallback(() => {
    const text = resolveVoicePromptText();
    if (text && text !== String(data?.voicePrompt || '').trim()) {
      patch({ voicePrompt: text });
    }
    setPromptEdit('voice');
  }, [data?.voicePrompt, patch, resolveVoicePromptText]);

  useEffect(() => {
    const curW = Number(data?.width) || 0;
    const curH = Number(data?.height) || 0;
    if (curW === w && curH === h) return;
    onDataChange?.(id, { width: w, height: h });
  }, [data?.width, data?.height, h, id, onDataChange, w]);

  // 旧卡无 intro 时回填一次
  useEffect(() => {
    if (String(data?.intro || '').trim()) return;
    if (!fallbackIntro) return;
    onDataChange?.(id, { intro: fallbackIntro });
  }, [data?.intro, fallbackIntro, id, onDataChange]);

  // 旧卡声音提示词为空时按分析结果回填
  useEffect(() => {
    if (String(data?.voicePrompt || '').trim()) return;
    const text = resolveVoicePromptText();
    if (!text.trim()) return;
    onDataChange?.(id, { voicePrompt: text });
  }, [data?.voicePrompt, id, onDataChange, resolveVoicePromptText]);

  return (
    <div
      ref={rootRef}
      data-id={id}
      className={`custom-node-container nexflow-drama-flow-keep-chrome group relative flex overflow-visible rounded-2xl ${
        isDarkMode ? 'nexflow-glass-panel' : 'apple-panel-light'
      } ${
        isSelected
          ? isDarkMode
            ? 'ring-2 ring-green-400/80'
            : 'ring-2 ring-green-500'
          : ''
      }`}
      style={{ width: w, height: h, minWidth: w, minHeight: h }}
    >
      <Handle
        type="target"
        position={Position.Left}
        id="in"
        style={{ top: '50%' }}
        className="nexflow-plus-handle nexflow-plus-handle-left"
      />
      <Handle
        type="source"
        position={Position.Right}
        id="out"
        style={{ top: '50%', right: 0 }}
        className="nexflow-plus-handle nexflow-plus-handle-right"
      />

      <div className="title-area absolute -top-6 left-0 z-20">
        <DramaFlowCharacterNameTag>{name}</DramaFlowCharacterNameTag>
      </div>

      <input
        ref={imageInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (f) onUploadImage?.(id, f);
        }}
      />
      <input
        ref={voiceInputRef}
        type="file"
        accept="audio/*"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (f) onUploadVoice?.(id, f);
        }}
      />

      <div className="flex min-h-0 flex-1 gap-2 p-2.5 pt-1.5">
        <div className="flex min-w-0 flex-[1.1] flex-col gap-1">
          {/* 人物简介占满；角色音色紧凑，波形不再拉高留空 */}
          <div className="flex min-h-0 flex-1 flex-col gap-1">
            <div className="flex min-h-0 flex-1 flex-col gap-0.5">
              <div className="flex shrink-0 items-center gap-1">
                <span
                  className={`text-[10px] font-semibold ${
                    isDarkMode ? 'text-white/40' : 'text-gray-500'
                  }`}
                >
                  人物简介
                </span>
              </div>
              <textarea
                className={`nodrag nowheel min-h-0 w-full flex-1 resize-none rounded-md border px-1.5 py-1 text-[11px] leading-snug outline-none custom-scrollbar-dark ${
                  isDarkMode
                    ? 'border-white/10 bg-black/25 text-white/80 placeholder:text-white/30'
                    : 'border-gray-200 bg-white/80 text-gray-800 placeholder:text-gray-400'
                }`}
                value={intro}
                placeholder="人物简单介绍…"
                onChange={(e) => patch({ intro: e.target.value })}
                onPointerDown={(e) => e.stopPropagation()}
                onMouseDown={(e) => e.stopPropagation()}
              />
            </div>

            <div className="flex shrink-0 flex-col gap-0.5">
              <div className="flex shrink-0 items-center gap-1">
                <span
                  className={`text-[10px] font-semibold ${
                    isDarkMode ? 'text-white/40' : 'text-gray-500'
                  }`}
                >
                  角色音色
                </span>
              </div>
              <DramaFlowVoicePlayer
                url={voiceUrl}
                generating={voiceGenerating}
                error={voiceErr}
                active={nearViewport}
              />
            </div>
          </div>

          {/* 仅声音：定妆上传/生成改到右侧空图区 */}
          <div className="flex shrink-0 items-center gap-1.5">
            <SourceMenu
              isDark={isDarkMode}
              primaryLabel="声音生成"
              generating={voiceGenerating}
              generatingLabel="生成中"
              onGenerate={() => onGenerateVoice?.(id)}
              onUpload={() => voiceInputRef.current?.click()}
              onPickCanvas={
                onPickVoiceFromCanvas ? () => onPickVoiceFromCanvas(id) : undefined
              }
              extraItems={[
                {
                  label: '声音提示词',
                  onClick: () => openVoicePromptEdit(),
                },
              ]}
            />
          </div>
        </div>

        <div
          className={`relative flex aspect-square h-full max-h-full w-[44%] shrink-0 items-center justify-center overflow-hidden rounded-xl ${
            isDarkMode ? 'bg-black/50 ring-1 ring-white/10' : 'bg-gray-100 ring-1 ring-gray-200'
          }`}
        >
          {imageUrl && mediaActive ? (
            <AssetLibLazyThumb
              src={imageUrl}
              alt={name}
              className="h-full w-full"
              imgClassName="h-full w-full object-contain"
              maxEdge={640}
            />
          ) : imageUrl && !mediaActive ? (
            <div
              className={`h-full w-full animate-pulse ${
                isDarkMode ? 'bg-white/5' : 'bg-gray-200/60'
              }`}
              aria-hidden
            />
          ) : generating ? (
            <div
              className={`flex flex-col items-center gap-1 text-[11px] ${
                isDarkMode ? 'text-white/55' : 'text-gray-500'
              }`}
            >
              <Loader2 className="h-5 w-5 animate-spin" />
              生成中…
            </div>
          ) : (
            <div className="flex h-full w-full flex-col items-center justify-center gap-2">
              {err ? (
                <div className="max-w-full px-2 text-center text-[10px] text-red-400 line-clamp-2">
                  {err}
                </div>
              ) : null}
              <EmptyImageActions
                isDark={isDarkMode}
                generating={generating}
                onGenerate={() => onGenerateImage?.(id)}
                onLocalUpload={() => imageInputRef.current?.click()}
                onPickCanvas={
                  onPickImageFromCanvas ? () => onPickImageFromCanvas(id) : undefined
                }
                onLibrary={
                  directorDomain && characterId
                    ? () => setLibraryOpen(true)
                    : () => showAlert('请先确认并继续分析角色')
                }
                onEditPrompt={() => setPromptEdit('image')}
              />
            </div>
          )}
        </div>
      </div>

      <button
        type="button"
        className="nodrag absolute -bottom-7 left-1/2 z-20 flex h-6 w-6 -translate-x-1/2 items-center justify-center rounded-full text-white/35 transition-colors hover:bg-white/10 hover:text-white/70"
        title="删除角色卡"
        onClick={(e) => {
          e.stopPropagation();
          onDelete?.(id);
        }}
      >
        <Trash2 className="h-3.5 w-3.5" strokeWidth={2} />
      </button>

      {promptEdit ? (
        <DramaFlowPromptEditDialog
          isDark={isDarkMode}
          title={promptEdit === 'voice' ? '声音提示词' : '图片提示词'}
          mode={promptEdit}
          value={
            promptEdit === 'voice'
              ? String(voicePrompt || '').trim() || resolveVoicePromptText()
              : prompt
          }
          placeholder={
            promptEdit === 'voice'
              ? '名字\n年龄：…\n性别：男/女\n音色描述：…\n台词：\n（剧本 2～3 句）'
              : '年龄性别、高矮胖瘦、发型发色、服饰穿搭、表情、材质；须符合背景故事'
          }
          projectId={projectId}
          nodeId={id}
          showAlert={showAlert}
          onSave={(text) => {
            if (promptEdit === 'voice') patch({ voicePrompt: text });
            else patch({ prompt: text });
          }}
          onClose={() => setPromptEdit(null)}
        />
      ) : null}

      {directorDomain && characterId ? (
        <DramaCharacterLibraryPickModal
          open={libraryOpen}
          isDark={isDarkMode}
          session={directorDomain}
          projectId={projectId}
          targetCharacterId={characterId}
          prefer="both"
          onClose={() => setLibraryOpen(false)}
          onApply={(next, summary) => {
            onApplyLibrarySession?.(id, next, summary);
            if (summary) showAlert(summary);
          }}
        />
      ) : null}
    </div>
  );
}
