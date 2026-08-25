import React, { useState, useRef, useEffect, useCallback, useMemo, memo } from 'react';
import { Handle, Position, NodeProps, useReactFlow, useUpdateNodeInternals } from 'reactflow';
import { Check } from 'lucide-react';
import { ModuleProgressBar } from './ModuleProgressBar';
import { ReferenceAudioWaveStrip } from './ReferenceAudioWaveStrip';
import {
  CHARACTER_SOURCE_OUTPUT_HANDLE,
  DEFAULT_REFERENCE_TRANSMIT_SLOTS,
  parseReferenceTransmitSlots,
  resolveReferenceTransmitSlots,
} from '../../utils/connectionRules';
import { scaleModulePx } from '../../utils/moduleDisplayScale';
import { nodeStyleDimensions } from '../../utils/nodeSizeFromAspectRatio';

/** 形象参考四槽位文案（与角色库四视图顺序一致） */
const VIEW_SLOT_LABELS = ['面部', '正面全身', '侧面全身', '背面全身'] as const;

/** 四视图统一竖图比例（CSS aspect-ratio = 宽/高） */
const SLOT_ASPECT_RATIO = '9 / 16';
const SLOT_ASPECT_W_OVER_H = 9 / 16;
const SLOT_GAP_PX = 4;

/** 外框内边距（与 className p-2 一致） */
const CARD_PAD_PX = 8;
/** 内容区顶部留白（标题在模块外，内部不必再留大块） */
const CONTENT_PT_PX = 4;
/** 四视图与音频条间距 */
const CONTENT_GAP_PX = 6;
/** 参考音条固定高度（与 compact+waveOnly 的 stripMinH 对齐；有/无音频一致） */
const AUDIO_STRIP_H_PX = 44;

/** 角色卡固定宽度（与历史 624 逻辑宽一致，经模块缩放） */
export const CHARACTER_CARD_W = scaleModulePx(624);

/** 按「四等分竖图 + 紧凑音频条」算出的固定高度 */
function computeCharacterCardHeight(cardW: number): number {
  const innerW = Math.max(0, cardW - CARD_PAD_PX * 2);
  const slotW = (innerW - SLOT_GAP_PX * 3) / 4;
  const slotH = slotW / SLOT_ASPECT_W_OVER_H;
  return Math.ceil(CARD_PAD_PX * 2 + CONTENT_PT_PX + slotH + CONTENT_GAP_PX + AUDIO_STRIP_H_PX);
}

export const CHARACTER_CARD_H = computeCharacterCardHeight(CHARACTER_CARD_W);

/** @deprecated 使用 CHARACTER_CARD_W / CHARACTER_CARD_H */
const DEFAULT_CARD_W = CHARACTER_CARD_W;
const DEFAULT_CARD_H = CHARACTER_CARD_H;

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
  isUserResized?: boolean;
  viewImages?: string[];
  /** 角色形象文字描述（来自角色库，可手写或图像反推） */
  imageDescription?: string;
  voiceClip?: string;
  referenceAudioUrl?: string;
  libraryCharacterId?: string;
  /** 四视图是否参与「接图片 / 接视频」传出；缺省为 DEFAULT_REFERENCE_TRANSMIT_SLOTS（默认勾选正面全身） */
  referenceTransmitSlots?: boolean[];
  /** 参考音是否参与「接视频」传出；缺省 false。接音频：有声音片段即传，不看此勾选 */
  referenceTransmitAudio?: boolean;
  /** 形象描述是否写入下游图片/视频的 prompt；缺省 false */
  referenceTransmitPrompt?: boolean;
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
  const updateNodeInternals = useUpdateNodeInternals();
  const nodeStyleProp = (props as { style?: { width?: unknown; height?: unknown } }).style;

  const userResized = data?.isUserResized === true;

  const cardW = useMemo(() => {
    if (userResized) {
      const fromData = typeof data?.width === 'number' && data.width >= 160 ? data.width : null;
      const fromProps = typeof _width === 'number' && _width >= 160 ? _width : null;
      return fromData ?? fromProps ?? DEFAULT_CARD_W;
    }
    return DEFAULT_CARD_W;
  }, [userResized, data?.width, _width]);

  const cardH = useMemo(() => {
    if (userResized) {
      const fromData = typeof data?.height === 'number' && data.height >= 120 ? data.height : null;
      const fromProps = typeof _height === 'number' && _height >= 120 ? _height : null;
      return fromData ?? fromProps ?? computeCharacterCardHeight(cardW);
    }
    return computeCharacterCardHeight(cardW);
  }, [userResized, data?.height, _height, cardW]);

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

  /** 非手动缩放时：把 RF 选框 / style / data 尺寸对齐到真实卡片外框（修复历史过大虚线选框） */
  useEffect(() => {
    if (userResized) return;
    const styleW = parseFloat(String(nodeStyleProp?.width || '').replace('px', ''));
    const styleH = parseFloat(String(nodeStyleProp?.height || '').replace('px', ''));
    const rfW = typeof _width === 'number' && _width > 0 ? _width : styleW;
    const rfH = typeof _height === 'number' && _height > 0 ? _height : styleH;
    const dataW = typeof data?.width === 'number' ? data.width : null;
    const dataH = typeof data?.height === 'number' ? data.height : null;
    const needFix =
      dataW !== cardW ||
      dataH !== cardH ||
      (Number.isFinite(rfW) && rfW > 0 && Math.abs(rfW - cardW) > 0.5) ||
      (Number.isFinite(rfH) && rfH > 0 && Math.abs(rfH - cardH) > 0.5);
    if (!needFix) return;
    setNodes((nds) =>
      nds.map((node) =>
        node.id === id
          ? {
              ...node,
              width: cardW,
              height: cardH,
              style: {
                ...(node.style as object),
                ...nodeStyleDimensions(cardW, cardH),
              },
              data: {
                ...node.data,
                width: cardW,
                height: cardH,
              },
            }
          : node,
      ),
    );
    updateNodeInternals(id);
  }, [
    userResized,
    data?.width,
    data?.height,
    _width,
    _height,
    nodeStyleProp?.width,
    nodeStyleProp?.height,
    cardW,
    cardH,
    id,
    setNodes,
    updateNodeInternals,
  ]);

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

  const transmitAudioOn = data?.referenceTransmitAudio === true;

  const toggleTransmitAudio = useCallback(() => {
    const cur = data?.referenceTransmitAudio === true;
    updateNodeData({
      referenceTransmitAudio: cur ? false : true,
    });
  }, [data?.referenceTransmitAudio, updateNodeData]);

  const imageDescriptionText = String(data?.imageDescription || '').trim();
  const transmitPromptOn = data?.referenceTransmitPrompt === true;
  const [promptHoverOpen, setPromptHoverOpen] = useState(false);
  const promptHoverLeaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearPromptHoverLeaveTimer = useCallback(() => {
    if (promptHoverLeaveTimerRef.current != null) {
      clearTimeout(promptHoverLeaveTimerRef.current);
      promptHoverLeaveTimerRef.current = null;
    }
  }, []);

  const openPromptHover = useCallback(() => {
    if (!imageDescriptionText) return;
    clearPromptHoverLeaveTimer();
    setPromptHoverOpen(true);
  }, [imageDescriptionText, clearPromptHoverLeaveTimer]);

  const scheduleClosePromptHover = useCallback(() => {
    clearPromptHoverLeaveTimer();
    promptHoverLeaveTimerRef.current = setTimeout(() => {
      setPromptHoverOpen(false);
      promptHoverLeaveTimerRef.current = null;
    }, 120);
  }, [clearPromptHoverLeaveTimer]);

  useEffect(() => () => clearPromptHoverLeaveTimer(), [clearPromptHoverLeaveTimer]);

  useEffect(() => {
    if (!imageDescriptionText) setPromptHoverOpen(false);
  }, [imageDescriptionText]);

  const toggleTransmitPrompt = useCallback(() => {
    if (!imageDescriptionText) return;
    const cur = data?.referenceTransmitPrompt === true;
    updateNodeData({
      referenceTransmitPrompt: cur ? false : true,
    });
  }, [data?.referenceTransmitPrompt, imageDescriptionText, updateNodeData]);

  const handleHeaderDoubleClick = useCallback(() => {
    setIsEditingNickname(true);
    setNickname(data?.nickname ?? displayName);
    setTimeout(() => {
      nicknameInputRef.current?.focus();
      nicknameInputRef.current?.select();
    }, 0);
  }, [data?.nickname, displayName]);

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
          minWidth: cardW,
          minHeight: cardH,
          maxWidth: cardW,
          maxHeight: cardH,
          userSelect: 'auto',
          willChange: dragging ? 'transform' : 'auto',
        }}
        className={`custom-node-container group relative rounded-2xl p-2 overflow-visible flex flex-col ${
          isDarkMode ? 'nexflow-glass-panel' : 'apple-panel-light'
        } ${selected && isDarkMode ? 'ring-2 ring-green-400/80' : ''} ${selected && !isDarkMode ? 'ring-2 ring-green-500' : ''}`}
        onMouseEnter={openPromptHover}
        onMouseLeave={scheduleClosePromptHover}
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
          title="输出：接图片/视频传勾选参考图；勾选形象描述可写入 prompt；有参考音时连音频即传入；勾选参考音后可传给视频"
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
              <div className="flex h-full flex-col items-center justify-center gap-2 p-2">
                <div className={`text-xl ${isDarkMode ? 'text-red-400' : 'text-red-600'}`}>⚠️</div>
                <p className={`text-xs text-center line-clamp-3 ${isDarkMode ? 'text-red-300' : 'text-red-700'}`}>{errorMessage}</p>
              </div>
            ) : (
              <div
                className="flex min-h-0 w-full flex-col"
                style={{ paddingTop: CONTENT_PT_PX, gap: CONTENT_GAP_PX }}
              >
                <div
                  className="grid min-w-0 w-full shrink-0"
                  style={{
                    gridTemplateColumns: 'repeat(4, minmax(0, 1fr))',
                    gap: SLOT_GAP_PX,
                  }}
                >
                  {VIEW_SLOT_LABELS.map((label, i) => {
                    const url = viewSlots[i];
                    const slotOn = transmitSlotsUi[i] ?? false;
                    return (
                      <div
                        key={label}
                        className={`relative w-full overflow-hidden rounded-md border ${
                          url ? slotBorder : slotEmptyBorder
                        }`}
                        style={{ aspectRatio: SLOT_ASPECT_RATIO }}
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
                              className="absolute inset-0 h-full w-full object-cover"
                              onError={(e) => {
                                (e.target as HTMLImageElement).style.display = 'none';
                              }}
                            />
                          </>
                        ) : null}
                        {/* 标签叠在格子底部，不额外撑高卡片 */}
                        <div
                          className={`pointer-events-none absolute inset-x-0 bottom-0 z-10 truncate px-0.5 py-0.5 text-center text-[9px] font-medium ${
                            url
                              ? isDarkMode
                                ? 'bg-black/55 text-white/95'
                                : 'bg-white/90 text-gray-800'
                              : isDarkMode
                                ? 'bg-black/40 text-violet-300/95'
                                : 'bg-white/70 text-violet-700'
                          }`}
                        >
                          {label}
                        </div>
                      </div>
                    );
                  })}
                </div>

                <div className="relative shrink-0" style={{ height: AUDIO_STRIP_H_PX }}>
                  {referenceAudioSrc ? (
                    <button
                      type="button"
                      title={
                        transmitAudioOn
                          ? '取消勾选（不传给视频当参考音；连音频仍会传）'
                          : '勾选后传给视频当参考音（连音频：有声音即传）'
                      }
                      onPointerDown={(e) => e.stopPropagation()}
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleTransmitAudio();
                      }}
                      className={`character-transmit-slot-btn nodrag nopan absolute right-0.5 top-0.5 z-20 flex h-3.5 w-3.5 items-center justify-center rounded border shadow-sm transition-colors ${
                        transmitAudioOn
                          ? isDarkMode
                            ? 'border-emerald-400/80 bg-emerald-500/90 text-white'
                            : 'border-emerald-600 bg-emerald-600/90 text-white'
                          : isDarkMode
                            ? 'border-white/25 bg-black/45 text-white/45 hover:text-white/85'
                            : 'border-gray-400 bg-white/80 text-gray-400 hover:text-gray-700'
                      }`}
                    >
                      <Check className="h-2.5 w-2.5" strokeWidth={3} />
                    </button>
                  ) : null}
                  {/* 右侧留白给勾选角标，避免挡住波形主体 */}
                  <div className="h-full w-full" style={{ paddingRight: referenceAudioSrc ? 16 : 0 }}>
                    <ReferenceAudioWaveStrip
                      src={referenceAudioSrc}
                      isDarkMode={isDarkMode}
                      variant="compact"
                      waveOnly
                      minHeightPx={AUDIO_STRIP_H_PX}
                    />
                  </div>
                </div>
              </div>
            )}

            {/* 有形象描述时：悬停在卡片底部弹出描述框，右上角勾选是否传出 prompt */}
            {promptHoverOpen && imageDescriptionText ? (
              <div
                className={`nodrag nopan absolute left-0 right-0 top-full z-30 mt-1.5 rounded-xl border px-2.5 pb-2 pt-2 shadow-xl ${
                  isDarkMode
                    ? 'border-white/15 bg-zinc-900/95 text-white/90 backdrop-blur-sm'
                    : 'border-black/10 bg-white/95 text-gray-800 backdrop-blur-sm'
                }`}
                onMouseEnter={openPromptHover}
                onMouseLeave={scheduleClosePromptHover}
                onPointerDown={(e) => e.stopPropagation()}
              >
                <button
                  type="button"
                  title={
                    transmitPromptOn
                      ? '取消勾选（不写入图片/视频 prompt）'
                      : '勾选后传到图片/视频的 prompt'
                  }
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={(e) => {
                    e.stopPropagation();
                    toggleTransmitPrompt();
                  }}
                  className={`character-transmit-slot-btn absolute right-1.5 top-1.5 z-10 flex h-5 w-5 items-center justify-center rounded border shadow-sm transition-colors ${
                    transmitPromptOn
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
                <div
                  className={`mb-1 pr-7 text-[10px] font-medium ${
                    isDarkMode ? 'text-violet-300/90' : 'text-violet-700'
                  }`}
                >
                  形象描述
                </div>
                <p
                  className={`max-h-[5.5rem] overflow-y-auto pr-1 text-[11px] leading-relaxed custom-scrollbar ${
                    isDarkMode ? 'text-white/80' : 'text-gray-700'
                  }`}
                >
                  {imageDescriptionText}
                </p>
              </div>
            ) : null}
        </>
      </div>
    </>
  );
};

export const CharacterNode = memo(CharacterNodeComponent);
