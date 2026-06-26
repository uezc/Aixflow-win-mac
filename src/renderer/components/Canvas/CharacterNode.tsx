import React, { useState, useRef, useEffect, useCallback, useMemo, memo } from 'react';
import { Handle, Position, NodeProps, useReactFlow } from 'reactflow';
import { Check, Mic } from 'lucide-react';
import { ModuleProgressBar } from './ModuleProgressBar';
import {
  CHARACTER_SOURCE_OUTPUT_HANDLE,
  DEFAULT_REFERENCE_TRANSMIT_SLOTS,
  parseReferenceTransmitSlots,
  resolveReferenceTransmitSlots,
} from '../../utils/connectionRules';

/** 形象参考四槽位文案（与角色库四视图顺序一致） */
const VIEW_SLOT_LABELS = ['面部', '正面全身', '侧面全身', '背面全身'] as const;

/** 默认外框 4:3 */
const DEFAULT_CARD_W = 624;
const DEFAULT_CARD_H = 468;

/** 柱数多 + grid 等分，视觉上左右更密 */
const WAVE_BAR_COUNT = 72;
/** 与图一红框接近：整块参考音区域加高 */
const WAVE_STRIP_MIN_H_PX = 120;
const WAVE_TRACK_MIN_H_PX = 104;

/** 空槽或未解码尺寸前：默认竖图比例（宽/高） */
const DEFAULT_SLOT_AR = 9 / 16;
const SLOT_GAP_PX = 4;

const waveBarGradient = (isDarkMode: boolean) =>
  isDarkMode
    ? 'bg-gradient-to-t from-[#14081f] via-violet-800 to-violet-300'
    : 'bg-gradient-to-t from-violet-950 via-violet-600 to-violet-200';

/**
 * 第二行参考音：紫色渐变柱状示意；点击区域切换播放/暂停（无独立播放按钮）。
 * 不 decode 整段音频，preload=none；播放中竖条带交错波动动画。
 */
const ReferenceAudioWaveStrip: React.FC<{
  src: string;
  isDarkMode: boolean;
}> = ({ src, isDarkMode }) => {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    const el = audioRef.current;
    if (!el) return;
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    const onEnded = () => setPlaying(false);
    el.addEventListener('play', onPlay);
    el.addEventListener('pause', onPause);
    el.addEventListener('ended', onEnded);
    return () => {
      el.removeEventListener('play', onPlay);
      el.removeEventListener('pause', onPause);
      el.removeEventListener('ended', onEnded);
    };
  }, [src]);

  const togglePlay = useCallback(() => {
    const a = audioRef.current;
    if (!a || !src.trim()) return;
    if (a.paused) void a.play().catch(() => undefined);
    else a.pause();
  }, [src]);

  /** 每段参考音（含空占位）固定一套随机柱高，避免用下标公式出现周期锯齿 */
  const barHeightsPx = useMemo(() => {
    const span = Math.max(12, WAVE_TRACK_MIN_H_PX - 8);
    const lo = Math.round(0.16 * span);
    const hi = Math.round(0.98 * span);
    return Array.from({ length: WAVE_BAR_COUNT }, () => lo + Math.floor(Math.random() * (hi - lo + 1)));
  }, [src]);

  const barGrad = waveBarGradient(isDarkMode);
  const trackBg = isDarkMode
    ? 'bg-gradient-to-b from-violet-950/90 via-black/70 to-black/85'
    : 'bg-gradient-to-b from-violet-100 to-violet-200/70';
  const outerBorder = isDarkMode ? 'border-violet-500/25' : 'border-violet-400/35';
  const gridCols = { gridTemplateColumns: `repeat(${WAVE_BAR_COUNT}, minmax(0, 1fr))` } as const;

  if (!src.trim()) {
    const emptyOuterBorder = isDarkMode ? 'border-white/10' : 'border-gray-300/80';
    const emptyOuterBg = isDarkMode ? 'bg-white/[0.03]' : 'bg-gray-100/90';
    const emptyMic = isDarkMode ? 'text-white/28' : 'text-gray-400/70';
    const emptyTrackBg = isDarkMode
      ? 'bg-gradient-to-b from-zinc-800/35 via-zinc-900/55 to-black/65'
      : 'bg-gradient-to-b from-gray-200/90 to-gray-300/60';
    const emptyBarGrad = isDarkMode
      ? 'bg-gradient-to-t from-zinc-800 via-zinc-600/90 to-zinc-500/80'
      : 'bg-gradient-to-t from-gray-500/70 via-gray-400/60 to-gray-300/50';

    return (
      <div
        className={`rounded-lg border px-2 py-2 flex w-full items-stretch gap-2 nodrag ${emptyOuterBorder} ${emptyOuterBg}`}
        style={{ minHeight: WAVE_STRIP_MIN_H_PX }}
        title="暂无参考音"
        aria-label="暂无参考音"
      >
        <Mic className={`w-4 h-4 shrink-0 self-center ${emptyMic}`} aria-hidden />
        <div
          className={`grid w-full min-w-0 items-end gap-px rounded-md px-1 py-1 ${emptyTrackBg}`}
          style={{ ...gridCols, minHeight: WAVE_TRACK_MIN_H_PX }}
        >
          {barHeightsPx.map((hPx, i) => (
            <span
              key={i}
              className={`min-w-0 w-full justify-self-center max-w-[3px] rounded-t-full ${emptyBarGrad} opacity-35`}
              style={{ height: `${hPx}px` }}
            />
          ))}
        </div>
      </div>
    );
  }

  return (
    <>
      <style>{`
        @keyframes nexflow-char-wave-y {
          0% { transform: scaleY(0.45); }
          100% { transform: scaleY(1.08); }
        }
      `}</style>
      <button
        type="button"
        onClick={togglePlay}
        title={playing ? '点击暂停' : '点击播放'}
        className={`nodrag flex w-full flex-col rounded-lg border overflow-hidden text-left cursor-pointer transition-opacity hover:opacity-95 active:opacity-90 ${outerBorder} ${
          isDarkMode ? 'bg-violet-950/25' : 'bg-violet-50/95'
        }`}
        style={{ minHeight: WAVE_STRIP_MIN_H_PX }}
      >
        <audio ref={audioRef} src={src} preload="none" className="hidden" />
        <div
          className={`grid w-full min-w-0 flex-1 items-end gap-px px-1 py-1 ${trackBg}`}
          style={{ ...gridCols, minHeight: WAVE_TRACK_MIN_H_PX }}
        >
          {barHeightsPx.map((hPx, i) => (
            <span
              key={i}
              className={`min-w-0 w-full justify-self-center max-w-[3px] rounded-t-full origin-bottom ${barGrad}`}
              style={{
                height: `${hPx}px`,
                opacity: playing ? 0.98 : 0.88,
                animation: playing ? 'nexflow-char-wave-y 0.38s ease-in-out infinite alternate' : undefined,
                animationDelay: playing ? `${(i % 12) * 35}ms` : undefined,
              }}
            />
          ))}
        </div>
      </button>
    </>
  );
};

interface CharacterNodeData {
  title?: string;
  nickname?: string;
  name?: string;
  username?: string;
  avatar?: string;
  videoUrl?: string;
  timestamp?: string;
  roleId?: string;
  progress?: number;
  progressMessage?: string;
  errorMessage?: string;
  width?: number;
  height?: number;
  viewImages?: string[];
  voiceClip?: string;
  referenceAudioUrl?: string;
  libraryCharacterId?: string;
  /** 四视图是否参与「接图片 / 接视频」传出；缺省为 DEFAULT_REFERENCE_TRANSMIT_SLOTS（默认勾选正面全身） */
  referenceTransmitSlots?: boolean[];
}

interface CharacterNodeProps extends NodeProps<CharacterNodeData> {
  isDarkMode?: boolean;
  performanceMode?: boolean;
  onDataChange?: (updates: Partial<CharacterNodeData>) => void;
}

const CharacterNodeComponent: React.FC<CharacterNodeProps> = (props) => {
  const {
    id,
    data,
    selected,
    isDarkMode = true,
    performanceMode: _performanceMode = false,
    onDataChange,
    xPos = 0,
    yPos = 0,
    dragging,
    zIndex: _zIndex,
    width: _width,
    height: _height,
    type: _type,
    targetPosition: _targetPosition,
    sourcePosition: _sourcePosition,
    position: _position,
  } = props as any;
  const { setNodes } = useReactFlow();

  const cardW = useMemo(() => {
    const fromData = typeof data?.width === 'number' && data.width >= 160 ? data.width : null;
    const fromProps = typeof _width === 'number' && _width >= 160 ? _width : null;
    return fromData ?? fromProps ?? DEFAULT_CARD_W;
  }, [data?.width, _width]);

  const cardH = useMemo(() => {
    const fromData = typeof data?.height === 'number' && data.height >= 120 ? data.height : null;
    const fromProps = typeof _height === 'number' && _height >= 120 ? _height : null;
    return fromData ?? fromProps ?? DEFAULT_CARD_H;
  }, [data?.height, _height]);

  const displayName = useMemo(() => {
    const n = (data?.nickname || '').trim();
    if (n) return n;
    if ((data?.name || '').trim()) return (data?.name || '').trim();
    if ((data?.username || '').trim()) return (data?.username || '').trim();
    return '角色';
  }, [data?.nickname, data?.name, data?.username]);

  const [nickname, setNickname] = useState(data?.nickname || '');
  const [isEditingNickname, setIsEditingNickname] = useState(false);
  const nicknameInputRef = useRef<HTMLInputElement>(null);
  const [progress, setProgress] = useState(data?.progress || 0);
  const [errorMessage, setErrorMessage] = useState(data?.errorMessage || '');

  const nodeRef = useRef<HTMLDivElement>(null);

  const viewSlots = useMemo(() => {
    const vi = Array.isArray(data?.viewImages) ? data!.viewImages! : [];
    return VIEW_SLOT_LABELS.map((_, i) => (typeof vi[i] === 'string' ? vi[i].trim() : ''));
  }, [data?.viewImages]);

  const viewSlotsKey = useMemo(() => viewSlots.join('\0'), [viewSlots]);

  type SlotArTuple = [number, number, number, number];
  const [slotAspects, setSlotAspects] = useState<SlotArTuple>(() => [
    DEFAULT_SLOT_AR,
    DEFAULT_SLOT_AR,
    DEFAULT_SLOT_AR,
    DEFAULT_SLOT_AR,
  ]);
  const prevSlotsKeyRef = useRef<string | null>(null);

  useEffect(() => {
    if (prevSlotsKeyRef.current === viewSlotsKey) return;
    if (prevSlotsKeyRef.current !== null) {
      const prev = prevSlotsKeyRef.current.split('\0');
      const cur = viewSlotsKey.split('\0');
      setSlotAspects((ar) => {
        const next = [...ar] as number[];
        for (let i = 0; i < 4; i++) {
          if ((prev[i] || '') !== (cur[i] || '')) {
            next[i] = DEFAULT_SLOT_AR;
          }
        }
        return next as SlotArTuple;
      });
    } else {
      setSlotAspects([DEFAULT_SLOT_AR, DEFAULT_SLOT_AR, DEFAULT_SLOT_AR, DEFAULT_SLOT_AR]);
    }
    prevSlotsKeyRef.current = viewSlotsKey;
  }, [viewSlotsKey]);

  const handleSlotImageLoad = useCallback((index: number) => (e: React.SyntheticEvent<HTMLImageElement>) => {
    const im = e.currentTarget;
    const nw = im.naturalWidth;
    const nh = im.naturalHeight;
    if (nw < 2 || nh < 2) return;
    const ratio = nw / nh;
    setSlotAspects((prev) => {
      if (Math.abs(prev[index] - ratio) < 0.0005) return prev;
      const next = [...prev] as number[];
      next[index] = ratio;
      return next as SlotArTuple;
    });
  }, []);

  const referenceAudioSrc = useMemo(() => {
    return (data?.voiceClip || data?.referenceAudioUrl || '').trim();
  }, [data?.voiceClip, data?.referenceAudioUrl]);

  useEffect(() => {
    if (data?.nickname !== undefined && !isEditingNickname && data.nickname !== nickname) {
      setNickname(data.nickname);
    }
    if (data?.progress !== undefined) {
      setProgress(data.progress);
    }
    if (data?.errorMessage !== undefined) {
      setErrorMessage(data.errorMessage);
    }
  }, [data?.nickname, data?.progress, data?.errorMessage, isEditingNickname]);

  const updateNodeData = useCallback(
    (updates: Partial<CharacterNodeData>) => {
      if (onDataChange) {
        onDataChange(updates);
        return;
      }
      setNodes((nds: any[]) =>
        nds.map((node) => (node.id === id ? { ...node, data: { ...node.data, ...updates } } : node))
      );
    },
    [id, setNodes, onDataChange]
  );

  const transmitSlotsUi = useMemo(
    () => resolveReferenceTransmitSlots(data?.referenceTransmitSlots),
    [data?.referenceTransmitSlots],
  );

  const toggleTransmitSlot = useCallback(
    (index: number) => {
      const parsed = parseReferenceTransmitSlots(data?.referenceTransmitSlots);
      const base = parsed ?? [...DEFAULT_REFERENCE_TRANSMIT_SLOTS];
      const next = [...base] as boolean[];
      next[index] = !next[index];
      updateNodeData({ referenceTransmitSlots: next });
    },
    [data?.referenceTransmitSlots, updateNodeData]
  );

  const handleHeaderDoubleClick = useCallback(() => {
    setIsEditingNickname(true);
    setNickname(data?.nickname ?? displayName);
    setTimeout(() => {
      nicknameInputRef.current?.focus();
      nicknameInputRef.current?.select();
    }, 0);
  }, [data?.nickname, displayName]);

  const imageRowRef = useRef<HTMLDivElement>(null);
  const [imageRowWidth, setImageRowWidth] = useState(0);

  useEffect(() => {
    const el = imageRowRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setImageRowWidth(el.clientWidth));
    ro.observe(el);
    setImageRowWidth(el.clientWidth);
    return () => ro.disconnect();
  }, [id, errorMessage]);

  const slotRowMetrics = useMemo(() => {
    const W = Math.max(0, imageRowWidth);
    const inner = Math.max(0, W - 3 * SLOT_GAP_PX);
    const sumAr = slotAspects.reduce((a, b) => a + b, 0) || DEFAULT_SLOT_AR * 4;
    const h = inner > 0 ? Math.max(40, inner / sumAr) : 56;
    const widths = slotAspects.map((ar) => h * ar);
    return { h, widths };
  }, [imageRowWidth, slotAspects]);

  const slotBorder = isDarkMode ? 'border-white/20 bg-white/[0.04]' : 'border-gray-300 bg-gray-50/80';
  const slotEmptyBorder = isDarkMode ? 'border-dashed border-white/25' : 'border-dashed border-gray-400';

  return (
    <>
      <div
        ref={nodeRef}
        data-id={id}
        style={{
          width: cardW,
          height: cardH,
          userSelect: 'auto',
          willChange: dragging ? 'transform' : 'auto',
        }}
        className={`custom-node-container group relative rounded-2xl p-2 overflow-visible flex flex-col ${
          isDarkMode ? 'nexflow-glass-panel' : 'apple-panel-light'
        } ${selected && isDarkMode ? 'ring-2 ring-green-400/80' : ''} ${selected && !isDarkMode ? 'ring-2 ring-green-500' : ''}`}
      >
        <Handle
          type="target"
          position={Position.Left}
          id="input"
          style={{ top: '50%' }}
          className="nexflow-plus-handle nexflow-plus-handle-left"
        />
        <Handle
          type="source"
          position={Position.Right}
          id={CHARACTER_SOURCE_OUTPUT_HANDLE}
          style={{ top: '52%', right: 0 }}
          title="输出：接图片/视频模块传勾选参考图（视频可多张）；接音频仅参考音"
          className="nexflow-plus-handle nexflow-plus-handle-right"
        />

        <>
            {/* 模块外左上角：角色展示名（双击改备注 nickname） */}
            <div className="title-area absolute -top-7 left-0 z-10 max-w-[min(280px,calc(100vw-40px))]">
              {isEditingNickname ? (
                <input
                  ref={nicknameInputRef}
                  type="text"
                  value={nickname}
                  onChange={(e) => setNickname(e.target.value)}
                  onBlur={() => {
                    setIsEditingNickname(false);
                    const next = nickname.trim();
                    if (data?.nickname !== next) {
                      updateNodeData({ nickname: next || undefined });
                    }
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      setIsEditingNickname(false);
                      const next = nickname.trim();
                      if (data?.nickname !== next) {
                        updateNodeData({ nickname: next || undefined });
                      }
                    }
                    if (e.key === 'Escape') {
                      setIsEditingNickname(false);
                      setNickname(data?.nickname || '');
                    }
                  }}
                  className={`bg-transparent outline-none font-bold text-xs w-full max-w-[240px] ${
                    isDarkMode ? 'text-white/90' : 'text-gray-900'
                  }`}
                  style={{ caretColor: isDarkMode ? '#34d399' : '#059669' }}
                  title="编辑显示名（备注）"
                  autoFocus
                />
              ) : (
                <span
                  onDoubleClick={handleHeaderDoubleClick}
                  className={`font-bold text-xs cursor-default select-none truncate block ${
                    isDarkMode ? 'text-white/90' : 'text-gray-900'
                  } hover:opacity-85 transition-opacity`}
                  title="双击编辑显示名"
                >
                  {displayName}
                </span>
              )}
            </div>

            <ModuleProgressBar
              visible={progress > 0}
              progress={progress}
              solidBackground={isDarkMode ? '#1C1C1E' : '#f5f5f5'}
              progressMessage="正在生成角色..."
              borderRadius={16}
              onFadeComplete={() => updateNodeData({ progress: 0 })}
            />

            {errorMessage ? (
              <div className="flex flex-1 flex-col items-center justify-center gap-2 p-2">
                <div className={`text-xl ${isDarkMode ? 'text-red-400' : 'text-red-600'}`}>⚠️</div>
                <p className={`text-xs text-center line-clamp-3 ${isDarkMode ? 'text-red-300' : 'text-red-700'}`}>{errorMessage}</p>
              </div>
            ) : (
              <div className="flex flex-1 flex-col min-h-0 pt-5 gap-2">
                <div
                  ref={imageRowRef}
                  className="flex flex-row min-w-0 shrink-0 items-start"
                  style={{ gap: SLOT_GAP_PX }}
                >
                  {VIEW_SLOT_LABELS.map((label, i) => {
                    const url = viewSlots[i];
                    const w = slotRowMetrics.widths[i] ?? 0;
                    const h = slotRowMetrics.h;
                    const slotOn = transmitSlotsUi[i] ?? false;
                    return (
                      <div key={label} className="flex flex-col shrink-0" style={{ width: w }}>
                        <div
                          className={`relative overflow-hidden rounded-md border flex items-center justify-center ${
                            url ? slotBorder : slotEmptyBorder
                          }`}
                          style={{ width: w, height: h }}
                        >
                          {url ? (
                            <>
                              <button
                                type="button"
                                title={slotOn ? '取消勾选（不传出此图）' : '勾选传出此参考图'}
                                onPointerDown={(e) => e.stopPropagation()}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  toggleTransmitSlot(i);
                                }}
                                className={`character-transmit-slot-btn nodrag nopan absolute right-0.5 top-0.5 z-20 flex h-5 w-5 items-center justify-center rounded border shadow-sm transition-colors ${
                                  slotOn
                                    ? isDarkMode
                                      ? 'border-emerald-400/80 bg-emerald-500 text-white'
                                      : 'border-emerald-600 bg-emerald-600 text-white'
                                    : isDarkMode
                                      ? 'border-white/25 bg-black/55 text-white/50 hover:text-white/90'
                                      : 'border-gray-400 bg-white/90 text-gray-400 hover:text-gray-700'
                                }`}
                              >
                                <Check className="h-3 w-3" strokeWidth={3} />
                              </button>
                              <img
                                loading="lazy"
                                decoding="async"
                                fetchPriority="low"
                                src={url}
                                alt={label}
                                draggable={false}
                                className="max-w-full max-h-full w-full h-full object-contain"
                                onLoad={handleSlotImageLoad(i)}
                                onError={(e) => {
                                  (e.target as HTMLImageElement).style.display = 'none';
                                }}
                              />
                            </>
                          ) : null}
                        </div>
                        <div
                          className={`shrink-0 px-0.5 py-0.5 text-[9px] font-medium text-center truncate w-full ${
                            url
                              ? isDarkMode
                                ? 'bg-black/55 text-white/95'
                                : 'bg-white/90 text-gray-800'
                              : isDarkMode
                                ? 'text-violet-300/95'
                                : 'text-violet-700'
                          }`}
                        >
                          {label}
                        </div>
                      </div>
                    );
                  })}
                </div>

                <div className="shrink-0">
                  <ReferenceAudioWaveStrip src={referenceAudioSrc} isDarkMode={isDarkMode} />
                </div>
              </div>
            )}
        </>
      </div>
    </>
  );
};

export const CharacterNode = memo(CharacterNodeComponent);
