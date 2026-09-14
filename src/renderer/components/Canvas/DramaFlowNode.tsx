/**
 * AI 短剧 2 代 — 画布独立节点（右键菜单新建）。
 * 主体框对齐系统「文本」模块 UI；右下角可自由缩放。
 * 选中时下方：比例 / 风格选择（导演台画风+色调）/ 确认并继续。
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Handle,
  Position,
  NodeProps,
  useStore,
  useStoreApi,
  useUpdateNodeInternals,
} from 'reactflow';
import { ChevronDown, Palette } from 'lucide-react';
import { scaleModulePx } from '../../utils/moduleDisplayScale';
import { useCanvasTheme } from '../../contexts/CanvasThemeContext';
import { nodeFloatPillBtn } from '../../utils/assetLibraryChrome';
import {
  nexflowOrangePillBtnBg,
  nexflowOrangePillBtnClass,
} from '../darkModalShell';
import {
  VISUAL_LOOK_OPTIONS,
  VISUAL_GRADE_OPTIONS,
  applyVisualStyleLookGrade,
  buildVisualStylePreset,
  getVisualLookOption,
  getVisualGradeOption,
  parseVisualStyleLookGrade,
  type VisualLookId,
  type VisualGradeId,
} from '../../../shared/directorDomain';
import {
  VISUAL_GRADE_COVERS,
  VISUAL_LOOK_COVERS,
} from '../../assets/visual-style-previews';
import { DramaFlowModuleTitleTag } from './DramaFlowModuleTitleTag';

export const DRAMA_FLOW_NODE_TYPE = 'directorDramaV2';

export const DRAMA_FLOW_DEFAULT_W = scaleModulePx(360);
export const DRAMA_FLOW_DEFAULT_H = scaleModulePx(320);

const MIN_W = scaleModulePx(200);
const MIN_H = scaleModulePx(160);

export type DramaFlowAspect = '16:9' | '9:16';

export type DramaFlowNodeData = {
  label?: string;
  title?: string;
  scriptTitle?: string;
  scriptText?: string;
  aspectRatio?: DramaFlowAspect | string;
  /** 画风 id（与导演台 VisualStyleLibrary 同源） */
  visualLookId?: string;
  /** 色调 id */
  visualGradeId?: string;
  /** 合成预设 id，如 live__muted_gray */
  stylePresetId?: string;
  /** 展示名：画风 · 色调 */
  styleLabel?: string;
  stylePrompt?: string;
  /** 点过「确认并继续」的时间戳；后续在此派生画布下游卡 */
  confirmedAt?: number;
  analyzing?: boolean;
  analyzingHint?: string;
  /** 分析后的 Domain 会话（供后续场景卡等复用） */
  directorDomain?: unknown;
  width?: number;
  height?: number;
  isUserResized?: boolean;
  _isResizing?: boolean;
};

type DramaFlowNodeProps = NodeProps<DramaFlowNodeData> & {
  onDataChange?: (nodeId: string, updates: Partial<DramaFlowNodeData>) => void;
  /** 确认并继续：分析角色并在画布铺卡 */
  onConfirmContinue?: (nodeId: string) => void | Promise<void>;
};

export default function DramaFlowNode({
  id,
  data,
  selected,
  onDataChange,
  onConfirmContinue,
}: DramaFlowNodeProps) {
  const { isDarkMode } = useCanvasTheme();
  const store = useStoreApi();
  const updateNodeInternals = useUpdateNodeInternals();
  const selectedFromStore = useStore((state) => state.nodeInternals.get(id)?.selected ?? false);
  const isSelected = selectedFromStore || selected;

  const nodeRef = useRef<HTMLDivElement>(null);
  const sizeRef = useRef({ w: DRAMA_FLOW_DEFAULT_W, h: DRAMA_FLOW_DEFAULT_H });
  const [isResizing, setIsResizing] = useState(false);
  const [styleOpen, setStyleOpen] = useState(false);
  const [aspectOpen, setAspectOpen] = useState(false);
  const [draftLookId, setDraftLookId] = useState<VisualLookId | ''>('');
  const [draftGradeId, setDraftGradeId] = useState<VisualGradeId | ''>('');
  const [size, setSize] = useState(() => {
    const w = Number(data?.width) > 0 ? Number(data.width) : DRAMA_FLOW_DEFAULT_W;
    const h = Number(data?.height) > 0 ? Number(data.height) : DRAMA_FLOW_DEFAULT_H;
    return { w: Math.max(MIN_W, w), h: Math.max(MIN_H, h) };
  });
  sizeRef.current = size;

  const scriptText = String(data?.scriptText || '');
  const scriptTitleRaw = String(data?.scriptTitle || '').trim();
  const scriptTitleDisplay = scriptTitleRaw === '我的剧本' ? '' : scriptTitleRaw;
  const aspect: DramaFlowAspect =
    data?.aspectRatio === '16:9' || data?.aspectRatio === '9:16' ? data.aspectRatio : '9:16';
  const hasText = !!scriptText.trim();
  const analyzing = !!data?.analyzing;
  const analyzingHint = String(data?.analyzingHint || '').trim();

  const parsedStyle = useMemo(
    () => parseVisualStyleLookGrade(data?.stylePresetId),
    [data?.stylePresetId],
  );
  const lookId = (data?.visualLookId || parsedStyle.lookId || '') as VisualLookId | '';
  const gradeId = (data?.visualGradeId || parsedStyle.gradeId || '') as VisualGradeId | '';
  const styleLabel =
    String(data?.styleLabel || '').trim() ||
    (() => {
      const look = lookId ? getVisualLookOption(lookId) : null;
      const grade = gradeId ? getVisualGradeOption(gradeId) : null;
      if (look && grade) return `${look.name} · ${grade.name}`;
      if (look) return look.name;
      if (grade) return grade.name;
      return '';
    })();

  const patch = useCallback(
    (updates: Partial<DramaFlowNodeData>) => {
      onDataChange?.(id, updates);
    },
    [id, onDataChange],
  );

  useEffect(() => {
    if (isResizing) return;
    const w = Number(data?.width);
    const h = Number(data?.height);
    if (Number.isFinite(w) && w > 0 && Number.isFinite(h) && h > 0) {
      const next = { w: Math.max(MIN_W, w), h: Math.max(MIN_H, h) };
      setSize((prev) => (prev.w === next.w && prev.h === next.h ? prev : next));
    }
  }, [data?.width, data?.height, isResizing]);

  useEffect(() => {
    if (!isSelected) {
      setStyleOpen(false);
      setAspectOpen(false);
    }
  }, [isSelected]);

  const commitSize = useCallback(
    (next: { w: number; h: number }) => {
      const c = { w: Math.max(MIN_W, next.w), h: Math.max(MIN_H, next.h) };
      setSize(c);
      sizeRef.current = c;
      patch({
        width: Math.round(c.w),
        height: Math.round(c.h),
        isUserResized: true,
        _isResizing: false,
      });
    },
    [patch],
  );

  const openStylePicker = () => {
    setAspectOpen(false);
    setDraftLookId(lookId || '');
    setDraftGradeId(gradeId || '');
    setStyleOpen((v) => !v);
  };

  const openAspectPicker = () => {
    setStyleOpen(false);
    setAspectOpen((v) => !v);
  };

  const commitStyleIfReady = (nextLook: VisualLookId | '', nextGrade: VisualGradeId | '') => {
    if (!nextLook || !nextGrade) return;
    const preset = buildVisualStylePreset(nextLook, nextGrade);
    const bible = applyVisualStyleLookGrade(nextLook, nextGrade);
    const look = getVisualLookOption(nextLook);
    const grade = getVisualGradeOption(nextGrade);
    patch({
      visualLookId: nextLook,
      visualGradeId: nextGrade,
      stylePresetId: preset?.id || `${nextLook}__${nextGrade}`,
      styleLabel: look && grade ? `${look.name} · ${grade.name}` : String(bible.presetName || ''),
      stylePrompt: String(bible.stylePrompt || bible.visualDNA?.generatedPrompt || ''),
    });
    setStyleOpen(false);
  };

  return (
    <div
      ref={nodeRef}
      data-id={id}
      className={`custom-node-container nexflow-drama-flow-keep-chrome group relative flex flex-col overflow-visible rounded-2xl p-4 ${
        isDarkMode ? 'nexflow-glass-panel' : 'apple-panel-light'
      } ${
        isSelected && !isResizing
          ? isDarkMode
            ? 'ring-2 ring-green-400/80'
            : 'ring-2 ring-green-500'
          : ''
      } ${isResizing ? '!shadow-none !ring-0' : ''}`}
      style={{
        width: size.w,
        height: size.h,
        minWidth: MIN_W,
        minHeight: MIN_H,
        userSelect: isResizing ? 'none' : 'auto',
        transition: isResizing ? 'none' : 'background-color 0.2s, border-color 0.2s',
      }}
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
        id="output"
        style={{ top: '50%', right: 0 }}
        className="nexflow-plus-handle nexflow-plus-handle-right"
      />

      <div className="title-area absolute -top-9 left-0 z-10">
        <DramaFlowModuleTitleTag>剧本</DramaFlowModuleTitleTag>
      </div>
      {(isSelected || isResizing) && (
        <div className="title-area absolute -top-9 right-0 z-10 max-w-[60%]">
          <input
            type="text"
            className={`nodrag nopan w-full min-w-[4.5rem] max-w-full truncate bg-transparent text-right text-xs font-bold outline-none ${
              isDarkMode
                ? 'text-white/80 placeholder:text-white/35'
                : 'text-gray-900 placeholder:text-gray-400'
            }`}
            style={{ caretColor: isDarkMode ? '#0A84FF' : '#22c55e' }}
            value={scriptTitleDisplay}
            placeholder="剧本标题"
            title="剧本标题"
            onChange={(e) => patch({ scriptTitle: e.target.value })}
            onPointerDown={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
          />
        </div>
      )}

      <textarea
        className={`nodrag nowheel drag-handle-area h-full min-h-0 w-full flex-1 resize-none overflow-auto bg-transparent p-2 text-center text-sm outline-none ${
          isDarkMode
            ? 'custom-scrollbar-dark text-white placeholder:text-white/40'
            : 'custom-scrollbar text-gray-900 placeholder:text-gray-400'
        }`}
        style={{ caretColor: isDarkMode ? '#0A84FF' : '#22c55e' }}
        placeholder="粘贴小说或剧本正文…"
        value={scriptText}
        onChange={(e) => patch({ scriptText: e.target.value })}
        onMouseDown={(e) => e.stopPropagation()}
        onPointerDown={(e) => e.stopPropagation()}
      />

      <div
        className="nodrag absolute -bottom-2 -right-2 z-[9999] flex h-6 w-6 cursor-nwse-resize items-center justify-center opacity-0 transition-opacity group-hover:opacity-100 hover:opacity-100"
        style={{ pointerEvents: 'all' }}
        onMouseDown={(e) => {
          e.preventDefault();
          e.stopPropagation();
          e.nativeEvent.stopImmediatePropagation();
          setStyleOpen(false);
          setIsResizing(true);
          patch({ _isResizing: true });
          const originalCursor = document.body.style.cursor;
          document.body.style.setProperty('cursor', 'nwse-resize', 'important');
          const startX = e.clientX;
          const startY = e.clientY;
          const startW = sizeRef.current.w;
          const startH = sizeRef.current.h;
          let rafId: number | null = null;
          const scheduleUpdate = () => {
            if (rafId === null) {
              rafId = requestAnimationFrame(() => {
                updateNodeInternals(id);
                rafId = null;
              });
            }
          };
          const onMouseMove = (moveEvent: MouseEvent) => {
            moveEvent.preventDefault();
            moveEvent.stopPropagation();
            const currentZoom = store.getState().transform[2] || 1;
            const deltaX = (moveEvent.clientX - startX) / currentZoom;
            const deltaY = (moveEvent.clientY - startY) / currentZoom;
            const newW = Math.max(MIN_W, startW + deltaX);
            const newH = Math.max(MIN_H, startH + deltaY);
            sizeRef.current = { w: newW, h: newH };
            if (nodeRef.current) {
              nodeRef.current.style.transition = 'none';
              nodeRef.current.style.width = `${newW}px`;
              nodeRef.current.style.height = `${newH}px`;
            }
            scheduleUpdate();
          };
          const onMouseUp = (upEvent: MouseEvent) => {
            const finalSize = {
              w: nodeRef.current
                ? parseFloat(nodeRef.current.style.width) || sizeRef.current.w
                : sizeRef.current.w,
              h: nodeRef.current
                ? parseFloat(nodeRef.current.style.height) || sizeRef.current.h
                : sizeRef.current.h,
            };
            commitSize(finalSize);
            setIsResizing(false);
            document.body.style.cursor = originalCursor;
            if (nodeRef.current) nodeRef.current.style.transition = '';
            if (rafId !== null) {
              cancelAnimationFrame(rafId);
              rafId = null;
            }
            updateNodeInternals(id);
            document.removeEventListener('mousemove', onMouseMove);
            document.removeEventListener('mouseup', onMouseUp);
            upEvent.preventDefault();
            upEvent.stopPropagation();
          };
          document.addEventListener('mousemove', onMouseMove, { passive: false });
          document.addEventListener('mouseup', onMouseUp, { passive: false });
        }}
        onClick={(e) => {
          e.stopPropagation();
          e.nativeEvent.stopImmediatePropagation();
        }}
        onDragStart={(e) => {
          e.preventDefault();
          e.stopPropagation();
        }}
      >
        <div
          className={`h-4 w-4 rounded-br-2xl border-b-2 border-r-2 ${
            isDarkMode ? 'border-white/40' : 'border-gray-400/60'
          }`}
        />
      </div>

      {isSelected && !isResizing ? (
        <div
          className="node-floating-toolbar nodrag nopan absolute left-1/2 top-full z-20 mt-1.5 flex w-max max-w-[min(92vw,36rem)] -translate-x-1/2 flex-col items-center gap-1.5 overflow-visible"
          style={{ pointerEvents: 'all' }}
          onPointerDown={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <div className="flex flex-wrap items-center justify-center gap-1.5">
            <div className="relative">
              <button
                type="button"
                className={nodeFloatPillBtn(
                  isDarkMode,
                  aspectOpen ? 'ring-1 ring-violet-400/50' : '',
                  'looks',
                  aspectOpen,
                )}
                onClick={(e) => {
                  e.stopPropagation();
                  openAspectPicker();
                }}
                title="画面比例"
              >
                <span
                  className={`inline-block shrink-0 rounded-[2px] border ${
                    aspect === '16:9' ? 'h-2.5 w-4' : 'h-4 w-2.5'
                  } ${isDarkMode ? 'border-white/70' : 'border-gray-700'}`}
                  aria-hidden
                />
                <span>{aspect}</span>
                <ChevronDown
                  className={`h-3 w-3 shrink-0 transition-transform ${aspectOpen ? 'rotate-180' : ''}`}
                />
              </button>
              {aspectOpen ? (
                <div
                  className={`nodrag nopan absolute left-1/2 top-full z-30 mt-1.5 min-w-[7.5rem] -translate-x-1/2 overflow-hidden rounded-xl border p-1 shadow-xl ${
                    isDarkMode
                      ? 'border-white/12 bg-[#1c1c1e]/95 text-white'
                      : 'border-gray-200 bg-white/95 text-gray-900'
                  }`}
                  onPointerDown={(e) => e.stopPropagation()}
                  onMouseDown={(e) => e.stopPropagation()}
                >
                  {(
                    [
                      { id: '16:9' as const, label: '16:9 横屏', icon: 'h-2.5 w-4' },
                      { id: '9:16' as const, label: '9:16 竖屏', icon: 'h-4 w-2.5' },
                    ] as const
                  ).map((opt) => {
                    const active = aspect === opt.id;
                    return (
                      <button
                        key={opt.id}
                        type="button"
                        className={`nodrag flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs font-medium transition ${
                          active
                            ? isDarkMode
                              ? 'bg-white/15 text-white'
                              : 'bg-gray-100 text-gray-900'
                            : isDarkMode
                              ? 'text-white/80 hover:bg-white/10'
                              : 'text-gray-700 hover:bg-gray-50'
                        }`}
                        onClick={(e) => {
                          e.stopPropagation();
                          patch({ aspectRatio: opt.id });
                          setAspectOpen(false);
                        }}
                      >
                        <span
                          className={`inline-block shrink-0 rounded-[2px] border ${opt.icon} ${
                            isDarkMode ? 'border-white/70' : 'border-gray-700'
                          }`}
                          aria-hidden
                        />
                        {opt.label}
                      </button>
                    );
                  })}
                </div>
              ) : null}
            </div>
            <button
              type="button"
              className={nodeFloatPillBtn(
                isDarkMode,
                styleOpen || !!styleLabel ? 'ring-1 ring-violet-400/50' : '',
                'operators',
                styleOpen || !!styleLabel,
              )}
              onClick={(e) => {
                e.stopPropagation();
                openStylePicker();
              }}
              title="画风与色调（与导演台同源）"
            >
              <Palette className="h-3.5 w-3.5 shrink-0" />
              <span className="max-w-[9rem] truncate">{styleLabel || '风格选择'}</span>
              <ChevronDown
                className={`h-3 w-3 shrink-0 transition-transform ${styleOpen ? 'rotate-180' : ''}`}
              />
            </button>
            <button
              type="button"
              className={`${nexflowOrangePillBtnClass} !text-xs`}
              style={{ background: nexflowOrangePillBtnBg }}
              disabled={!hasText || analyzing}
              onClick={(e) => {
                e.stopPropagation();
                if (!hasText || analyzing) return;
                void onConfirmContinue?.(id);
              }}
            >
              {analyzing ? analyzingHint || '分析中…' : '确认并继续'}
            </button>
          </div>

          {styleOpen ? (
            <div
              className={`nodrag nopan w-[min(92vw,34rem)] overflow-hidden rounded-xl border p-2 shadow-xl ${
                isDarkMode
                  ? 'border-white/12 bg-[#1c1c1e]/95 text-white'
                  : 'border-gray-200 bg-white/95 text-gray-900'
              }`}
              onWheel={(e) => e.stopPropagation()}
            >
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <div
                    className={`mb-1.5 px-0.5 text-[11px] font-medium ${
                      isDarkMode ? 'text-white/55' : 'text-gray-500'
                    }`}
                  >
                    画风
                  </div>
                  <div className="grid max-h-[13.5rem] grid-cols-2 gap-1.5 overflow-auto custom-scrollbar-dark pr-0.5">
                    {VISUAL_LOOK_OPTIONS.map((opt) => {
                      const active = draftLookId === opt.id;
                      const cover = VISUAL_LOOK_COVERS[opt.id];
                      return (
                        <button
                          key={opt.id}
                          type="button"
                          title={opt.description}
                          className={`nodrag relative aspect-[4/3] overflow-hidden rounded-lg text-left transition ${
                            active
                              ? isDarkMode
                                ? 'ring-2 ring-sky-400'
                                : 'ring-2 ring-sky-500'
                              : isDarkMode
                                ? 'ring-1 ring-white/10 hover:ring-white/30'
                                : 'ring-1 ring-gray-200 hover:ring-gray-300'
                          }`}
                          style={
                            cover
                              ? { backgroundColor: '#0c0c12' }
                              : {
                                  background: `linear-gradient(145deg, ${opt.accent}f0 0%, ${opt.accent}88 42%, #0c0c12 100%)`,
                                }
                          }
                          onClick={(e) => {
                            e.stopPropagation();
                            setDraftLookId(opt.id);
                            commitStyleIfReady(opt.id, draftGradeId);
                          }}
                        >
                          {cover ? (
                            <img
                              src={cover}
                              alt=""
                              className="absolute inset-0 h-full w-full object-cover"
                              draggable={false}
                            />
                          ) : null}
                          <span className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 to-transparent px-1.5 pb-1 pt-3 text-[10px] font-medium text-white">
                            {opt.name}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
                <div>
                  <div
                    className={`mb-1.5 px-0.5 text-[11px] font-medium ${
                      isDarkMode ? 'text-white/55' : 'text-gray-500'
                    }`}
                  >
                    色调
                  </div>
                  <div className="grid max-h-[13.5rem] grid-cols-2 gap-1.5 overflow-auto custom-scrollbar-dark pr-0.5">
                    {VISUAL_GRADE_OPTIONS.map((opt) => {
                      const active = draftGradeId === opt.id;
                      const cover = VISUAL_GRADE_COVERS[opt.id];
                      return (
                        <button
                          key={opt.id}
                          type="button"
                          title={opt.description}
                          className={`nodrag relative aspect-[4/3] overflow-hidden rounded-lg text-left transition ${
                            active
                              ? isDarkMode
                                ? 'ring-2 ring-sky-400'
                                : 'ring-2 ring-sky-500'
                              : isDarkMode
                                ? 'ring-1 ring-white/10 hover:ring-white/30'
                                : 'ring-1 ring-gray-200 hover:ring-gray-300'
                          }`}
                          style={
                            cover
                              ? { backgroundColor: '#0c0c12' }
                              : {
                                  background: `linear-gradient(145deg, ${opt.accent}f0 0%, ${opt.accent}88 42%, #0c0c12 100%)`,
                                }
                          }
                          onClick={(e) => {
                            e.stopPropagation();
                            setDraftGradeId(opt.id);
                            commitStyleIfReady(draftLookId, opt.id);
                          }}
                        >
                          {cover ? (
                            <img
                              src={cover}
                              alt=""
                              className="absolute inset-0 h-full w-full object-cover"
                              draggable={false}
                            />
                          ) : null}
                          <span className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 to-transparent px-1.5 pb-1 pt-3 text-[10px] font-medium text-white">
                            {opt.name}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>
              <p
                className={`mt-1.5 text-center text-[10px] ${
                  isDarkMode ? 'text-white/40' : 'text-gray-500'
                }`}
              >
                左选画风、右选色调；两项都选好后自动收起
              </p>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
