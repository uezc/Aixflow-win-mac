/**
 * AI 短剧 2 代 — 场景卡画布节点。
 * 场景简介 + 场景生成；右侧横图预览（16:9）；无音色区（2B）。
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Handle, Position, NodeProps, useStore } from 'reactflow';
import { Loader2, Trash2 } from 'lucide-react';
import { scaleModulePx } from '../../utils/moduleDisplayScale';
import { useCanvasTheme } from '../../contexts/CanvasThemeContext';
import { useDarkAlert } from '../../contexts/DarkAlertContext';
import {
  nexflowOrangePillBtnBg,
  nexflowOrangePillBtnClass,
} from '../darkModalShell';
import AssetLibLazyThumb from '../AssetLibLazyThumb';
import { useViewportIntersection } from '../../hooks/useViewportIntersection';
import { DramaFlowCharacterNameTag } from './DramaFlowModuleTitleTag';
import { DramaFlowPromptEditDialog } from './DramaFlowPromptEditDialog';

export const DRAMA_FLOW_SCENE_NODE_TYPE = 'dramaFlowScene';

export const DRAMA_FLOW_SCENE_DEFAULT_W = scaleModulePx(560);
export const DRAMA_FLOW_SCENE_DEFAULT_H = scaleModulePx(268);

export type DramaFlowSceneNodeData = {
  label?: string;
  title?: string;
  parentDramaFlowId?: string;
  sceneId?: string;
  name?: string;
  location?: string;
  kind?: string;
  mood?: string;
  timeDefault?: string;
  weatherDefault?: string;
  /** 场景简介（主展示区） */
  intro?: string;
  /** 场景生图提示词（独立弹窗编辑） */
  prompt?: string;
  imageUrl?: string;
  status?: 'idle' | 'generating' | 'ready' | 'error' | string;
  error?: string;
  stylePresetId?: string;
  width?: number;
  height?: number;
};

type Props = NodeProps<DramaFlowSceneNodeData> & {
  onDataChange?: (nodeId: string, updates: Partial<DramaFlowSceneNodeData>) => void;
  onGenerateImage?: (nodeId: string) => void;
  onUploadImage?: (nodeId: string, file: File) => void;
  onPickImageFromCanvas?: (nodeId: string) => void;
  onDelete?: (nodeId: string) => void;
  projectId?: string;
};

function SourceMenu({
  isDark,
  primaryLabel,
  generating,
  generatingLabel,
  onGenerate,
  onUpload,
  onPickCanvas,
  extraItems,
}: {
  isDark: boolean;
  primaryLabel: string;
  generating?: boolean;
  generatingLabel: string;
  onGenerate?: () => void;
  onUpload?: () => void;
  onPickCanvas?: () => void;
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
  return (
    <div
      className="relative min-w-0 flex-1"
      onMouseEnter={openMenu}
      onMouseLeave={() => setMenuOpen(false)}
    >
      <button
        ref={btnRef}
        type="button"
        className={`${nexflowOrangePillBtnClass} !h-6 w-full !px-2 !text-[9px] disabled:opacity-50`}
        style={{ background: nexflowOrangePillBtnBg }}
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

export default function DramaFlowSceneNode({
  id,
  data,
  selected,
  onDataChange,
  onGenerateImage,
  onUploadImage,
  onPickImageFromCanvas,
  onDelete,
  projectId,
}: Props) {
  const { isDarkMode } = useCanvasTheme();
  const { showAlert } = useDarkAlert();
  const selectedFromStore = useStore((state) => state.nodeInternals.get(id)?.selected ?? false);
  const isSelected = selectedFromStore || selected;
  const rootRef = useRef<HTMLDivElement | null>(null);
  const imageInputRef = useRef<HTMLInputElement | null>(null);
  const [promptEdit, setPromptEdit] = useState(false);
  const nearViewport = useViewportIntersection(rootRef, '280px', 0, false);
  const [mediaArmed, setMediaArmed] = useState(false);
  useEffect(() => {
    if (nearViewport) setMediaArmed(true);
  }, [nearViewport]);
  const mediaActive = mediaArmed || nearViewport;

  const name = String(data?.name || '未命名场景').trim() || '未命名场景';
  const prompt = String(data?.prompt || '');
  const fallbackIntro = [data?.location, data?.kind, data?.mood, data?.timeDefault]
    .map((s) => String(s || '').trim())
    .filter(Boolean)
    .join(' · ');
  const intro = String(data?.intro ?? fallbackIntro);
  const imageUrl = String(data?.imageUrl || '').trim();
  const status = String(data?.status || 'idle');
  const generating = status === 'generating';
  const err = String(data?.error || '').trim();
  const w = DRAMA_FLOW_SCENE_DEFAULT_W;
  const h = DRAMA_FLOW_SCENE_DEFAULT_H;

  const patch = useCallback(
    (updates: Partial<DramaFlowSceneNodeData>) => {
      onDataChange?.(id, updates);
    },
    [id, onDataChange],
  );

  useEffect(() => {
    const curW = Number(data?.width) || 0;
    const curH = Number(data?.height) || 0;
    if (curW === w && curH === h) return;
    onDataChange?.(id, { width: w, height: h });
  }, [data?.width, data?.height, h, id, onDataChange, w]);

  useEffect(() => {
    if (String(data?.intro || '').trim()) return;
    if (!fallbackIntro) return;
    onDataChange?.(id, { intro: fallbackIntro });
  }, [data?.intro, fallbackIntro, id, onDataChange]);

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

      <div className="flex min-h-0 flex-1 items-stretch gap-2 overflow-hidden p-2.5 pt-1.5">
        {/* 简介区收窄，右侧加宽给 16:9 场景图 */}
        <div className="flex w-[20%] min-w-0 shrink-0 flex-col gap-1">
          <div className="flex shrink-0 items-center gap-1">
            <span
              className={`text-[10px] font-semibold ${
                isDarkMode ? 'text-white/40' : 'text-gray-500'
              }`}
            >
              场景简介
            </span>
          </div>
          <textarea
            className={`nodrag nowheel min-h-0 w-full flex-1 resize-none rounded-md border px-1.5 py-1 text-[11px] leading-snug outline-none custom-scrollbar-dark ${
              isDarkMode
                ? 'border-white/10 bg-black/25 text-white/80 placeholder:text-white/30'
                : 'border-gray-200 bg-white/80 text-gray-800 placeholder:text-gray-400'
            }`}
            value={intro}
            placeholder="场景简单介绍…"
            onChange={(e) => patch({ intro: e.target.value })}
            onPointerDown={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
          />
          <div className="flex shrink-0 items-center gap-1.5">
            <SourceMenu
              isDark={isDarkMode}
              primaryLabel="场景生成"
              generating={generating}
              generatingLabel="生成中"
              onGenerate={() => onGenerateImage?.(id)}
              onUpload={() => imageInputRef.current?.click()}
              onPickCanvas={
                onPickImageFromCanvas ? () => onPickImageFromCanvas(id) : undefined
              }
              extraItems={[
                {
                  label: '场景提示词',
                  onClick: () => setPromptEdit(true),
                },
              ]}
            />
          </div>
        </div>

        <div
          className={`relative min-h-0 min-w-0 flex-1 self-center overflow-hidden rounded-xl aspect-video ${
            isDarkMode ? 'bg-black/50 ring-1 ring-white/10' : 'bg-gray-100 ring-1 ring-gray-200'
          }`}
        >
          {imageUrl && mediaActive ? (
            <AssetLibLazyThumb
              src={imageUrl}
              alt={name}
              className="absolute inset-0 h-full w-full"
              imgClassName="h-full w-full object-cover"
              maxEdge={960}
            />
          ) : imageUrl && !mediaActive ? (
            <div
              className={`absolute inset-0 h-full w-full animate-pulse ${
                isDarkMode ? 'bg-white/5' : 'bg-gray-200/60'
              }`}
              aria-hidden
            />
          ) : generating ? (
            <div
              className={`absolute inset-0 flex flex-col items-center justify-center gap-1 text-[11px] ${
                isDarkMode ? 'text-white/55' : 'text-gray-500'
              }`}
            >
              <Loader2 className="h-5 w-5 animate-spin" />
              生成中…
            </div>
          ) : err ? (
            <div className="absolute inset-0 flex items-center justify-center px-2 text-center text-[11px] text-red-400">
              {err}
            </div>
          ) : (
            <div
              className={`absolute inset-0 flex items-center justify-center px-2 text-center text-[11px] ${
                isDarkMode ? 'text-white/40' : 'text-gray-400'
              }`}
            >
              场景图
            </div>
          )}
        </div>
      </div>

      <button
        type="button"
        className="nodrag absolute -bottom-7 left-1/2 z-20 flex h-6 w-6 -translate-x-1/2 items-center justify-center rounded-full text-white/35 transition-colors hover:bg-white/10 hover:text-white/70"
        title="删除场景卡"
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
          title="场景提示词"
          mode="image"
          value={prompt}
          placeholder="空场景、地点、建筑材质、陈设硬事实、光影氛围；须无人物"
          projectId={projectId}
          nodeId={id}
          showAlert={showAlert}
          onSave={(text) => patch({ prompt: text })}
          onClose={() => setPromptEdit(false)}
        />
      ) : null}
    </div>
  );
}
