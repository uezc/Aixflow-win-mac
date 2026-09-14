/**
 * 画布模块组合框：虚线外壳 + 左右连接点；
 * 「角色设计师 / 场景设计师」组选中时下方显示定妆图模型 / 分辨率 / 一键生成。
 */
import React, { memo, useMemo } from 'react';
import { Handle, NodeProps, Position, useStore } from 'reactflow';
import { Loader2 } from 'lucide-react';
import { useCanvasTheme } from '../../contexts/CanvasThemeContext';
import {
  DEFAULT_IMAGE_MODEL,
  filterImageModelsForMode,
  normalizeImageModelIfRetired,
} from '../../config/imageModelUiPolicy';
import { normalizeDirectorImageResolution } from '../../../shared/directorPipeline';
import {
  nexflowOrangePillBtnBg,
  nexflowOrangePillBtnClass,
} from '../darkModalShell';
import { DramaFlowModuleTitleTag } from './DramaFlowModuleTitleTag';
import { DramaFlowGlassSelect } from './DramaFlowGlassSelect';

export const NODE_GROUP_TYPE = 'nodeGroup';

/** 设计师组生图最高分辨率：不超过 2K（与分镜图策略一致） */
export const DRAMA_FLOW_IMAGE_RESOLUTION_TIERS = ['1K', '2K'] as const;

export type NodeGroupData = {
  label?: string;
  width?: number;
  height?: number;
  childIds?: string[];
  arrangeCols?: number;
  kind?: string;
  parentDramaFlowId?: string;
  imageModel?: string;
  imageResolution?: string;
  batchGenerating?: boolean;
};

type Props = NodeProps<NodeGroupData> & {
  onDataChange?: (nodeId: string, updates: Partial<NodeGroupData> & { width?: number; height?: number }) => void;
  onBatchGenerate?: (groupId: string) => void;
};

function capDramaFlowImageResolution(raw: unknown): (typeof DRAMA_FLOW_IMAGE_RESOLUTION_TIERS)[number] {
  const r = normalizeDirectorImageResolution(raw);
  return r === '4K' ? '2K' : (r as '1K' | '2K');
}

function NodeGroupFrame({ id, data, selected, onDataChange, onBatchGenerate }: Props) {
  const { isDarkMode } = useCanvasTheme();
  const selectedFromStore = useStore((s) => s.nodeInternals.get(id)?.selected ?? false);
  const childSelected = useStore((s) => {
    for (const n of s.nodeInternals.values()) {
      if (String((n.data as any)?.nodeGroupId || '') === id && n.selected) return true;
    }
    return false;
  });
  const isSelected = selectedFromStore || selected;
  const w = Math.max(120, Number(data?.width) || 240);
  const h = Math.max(80, Number(data?.height) || 160);
  const label = String(data?.label || '组合').trim() || '组合';
  const kind = String(data?.kind || '');
  const isAssetDesigner =
    kind === 'dramaFlowCharacterDesigner' ||
    kind === 'dramaFlowSceneDesigner' ||
    kind === 'dramaFlowPropDesigner' ||
    kind === 'dramaFlowCreatureDesigner';
  const isSceneDesigner = kind === 'dramaFlowSceneDesigner';
  const isPropDesigner = kind === 'dramaFlowPropDesigner';
  const isCreatureDesigner = kind === 'dramaFlowCreatureDesigner';
  const showChrome = isAssetDesigner && (isSelected || childSelected);
  const batchGenerating = !!data?.batchGenerating;

  const modelOpts = useMemo(
    () => filterImageModelsForMode({ hasRefs: false, refCount: 0 }),
    [],
  );
  const imageModel = normalizeImageModelIfRetired(data?.imageModel || DEFAULT_IMAGE_MODEL);
  const imageResolution = capDramaFlowImageResolution(data?.imageResolution || '2K');

  return (
    <div
      data-id={id}
      className={`relative box-border rounded-2xl nexflow-drama-flow-keep-chrome ${
        isSelected
          ? isDarkMode
            ? 'ring-2 ring-emerald-400/70'
            : 'ring-2 ring-emerald-500'
          : ''
      }`}
      style={{
        width: w,
        height: h,
        background: isDarkMode ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.03)',
        border: isDarkMode
          ? '1.5px dashed rgba(255,255,255,0.35)'
          : '1.5px dashed rgba(0,0,0,0.28)',
      }}
    >
      <Handle
        type="target"
        position={Position.Left}
        id="in"
        className="nexflow-plus-handle nexflow-plus-handle-left"
      />
      <Handle
        type="source"
        position={Position.Right}
        id="output"
        className="nexflow-plus-handle nexflow-plus-handle-right"
      />
      <div className="title-area pointer-events-none absolute -top-9 left-0 z-20">
        <DramaFlowModuleTitleTag>{label}</DramaFlowModuleTitleTag>
      </div>

      {showChrome ? (
        <div
          className={[
            'nodrag nopan absolute left-1/2 top-[calc(100%+10px)] z-30',
            'flex w-max max-w-[min(96vw,42rem)] -translate-x-1/2 flex-nowrap items-center gap-1.5',
            'overflow-visible rounded-full px-2 py-1.5',
            isDarkMode
              ? 'nexflow-glass-panel border border-white/[0.14] shadow-[0_8px_28px_rgba(0,0,0,0.28)]'
              : 'apple-panel-light border border-black/[0.08] shadow-[0_8px_28px_rgba(0,0,0,0.06)]',
          ].join(' ')}
          style={{ pointerEvents: 'all' }}
          onPointerDown={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <DramaFlowGlassSelect
            isDark={isDarkMode}
            value={
              modelOpts.some((m) => m.value === imageModel)
                ? imageModel
                : modelOpts[0]?.value || DEFAULT_IMAGE_MODEL
            }
            options={modelOpts.map((m) => ({ value: m.value, label: m.label }))}
            menuMinWidth={168}
            title={
              isSceneDesigner
                ? '场景图模型'
                : isPropDesigner
                  ? '道具图模型'
                  : isCreatureDesigner
                    ? '生物图模型'
                    : '定妆图模型'
            }
            onChange={(v) => onDataChange?.(id, { imageModel: v })}
          />
          <span className={`h-4 w-px shrink-0 ${isDarkMode ? 'bg-white/15' : 'bg-black/10'}`} />
          <DramaFlowGlassSelect
            isDark={isDarkMode}
            value={imageResolution}
            options={DRAMA_FLOW_IMAGE_RESOLUTION_TIERS.map((r) => ({ value: r, label: r }))}
            menuMinWidth={72}
            title="分辨率（最高 2K）"
            onChange={(v) =>
              onDataChange?.(id, {
                imageResolution: capDramaFlowImageResolution(v),
              })
            }
          />
          <button
            type="button"
            className={`${nexflowOrangePillBtnClass} !text-[11px]`}
            style={{ background: nexflowOrangePillBtnBg }}
            disabled={batchGenerating}
            title={
              isSceneDesigner
                ? '一键生成全部场景图'
                : isPropDesigner
                  ? '一键生成全部道具图'
                  : isCreatureDesigner
                    ? '一键生成全部生物图'
                    : '一键生成全部角色定妆图（四宫格）'
            }
            onClick={(e) => {
              e.stopPropagation();
              onBatchGenerate?.(id);
            }}
          >
            {batchGenerating ? (
              <span className="inline-flex items-center gap-1">
                <Loader2 className="h-3 w-3 animate-spin" />
                生成中
              </span>
            ) : (
              '一键生成'
            )}
          </button>
        </div>
      ) : null}
    </div>
  );
}

export default memo(NodeGroupFrame);
