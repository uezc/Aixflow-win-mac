// @ts-nocheck
import React, { useState } from 'react';
import { Handle, Position, NodeProps } from 'reactflow';
import { Package, Check, ZoomIn, ZoomOut } from 'lucide-react';
import { useAppLocale } from '../../contexts/AppLocaleContext';
import { rvcTrainT } from '../../i18n/rvcTrainI18n';
import { workspaceChromeT } from '../../i18n/workspaceI18n';
import { resolveRvcTrainNickname } from '../../utils/rvcTrainCanvasPlacement';
import { ReferenceAudioWaveStrip } from './ReferenceAudioWaveStrip';
import { ModuleProgressBar } from './ModuleProgressBar';
import {
  RVC_TRAIN_HEIGHT,
  RVC_TRAIN_WIDTH,
  RVC_TRAIN_BODY_PAD_Y_PX,
  RVC_TRAIN_NAME_FONT_MAX_PX,
  RVC_TRAIN_NAME_FONT_MIN_PX,
  RVC_TRAIN_NAME_FONT_STEP_PX,
  clampRvcTrainNameFontPx,
} from '../../constants/rvcTrainLayout';
import { nodeFloatToolBtn } from '../../utils/assetLibraryChrome';
import type { ScratchColorId } from '../../theme/scratchColors';

export interface RvcTrainNodeData {
  width?: number;
  height?: number;
  rvcTrainModelName?: string;
  rvcTrainNameFontPx?: number;
  referenceAudioUrl?: string;
  outputModelUrl?: string;
  outputModelRemoteUrl?: string;
  libraryRvcVoiceId?: string;
  libraryAvatarUrl?: string;
  aiStatus?: 'idle' | 'START' | 'PROCESSING' | 'SUCCESS' | 'ERROR';
  progress?: number;
  progressMessage?: string;
  errorMessage?: string;
  model?: string;
  title?: string;
}

interface RvcTrainNodeProps extends NodeProps<RvcTrainNodeData> {
  isDarkMode?: boolean;
  onDataChange?: (nodeId: string, updates: Partial<RvcTrainNodeData>) => void;
}

const RvcTrainNode: React.FC<RvcTrainNodeProps> = ({ id, data, selected, isDarkMode = true, onDataChange }) => {
  const { locale } = useAppLocale();
  const t = rvcTrainT(locale);
  const wc = workspaceChromeT(locale);
  const [isHovered, setIsHovered] = useState(false);

  const w = data?.width || RVC_TRAIN_WIDTH;
  const h = data?.height || RVC_TRAIN_HEIGHT;
  const modelName = resolveRvcTrainNickname(data);
  const displayName = modelName || t.nodeNicknamePlaceholder;
  const isNicknamePlaceholder = !modelName;
  const nameFontPx = clampRvcTrainNameFontPx(data?.rvcTrainNameFontPx);
  const atMinNameFont = nameFontPx <= RVC_TRAIN_NAME_FONT_MIN_PX;
  const atMaxNameFont = nameFontPx >= RVC_TRAIN_NAME_FONT_MAX_PX;
  const floatToolBtn = (scratch: ScratchColorId, disabled: boolean) =>
    nodeFloatToolBtn(isDarkMode, false, disabled ? '!opacity-40 cursor-not-allowed' : '', scratch);
  const bumpNameFont = (delta: number) => {
    const next = clampRvcTrainNameFontPx(nameFontPx + delta);
    if (next === nameFontPx) return;
    onDataChange?.(id, { rvcTrainNameFontPx: next });
  };
  const hasPackage = !!(data?.outputModelUrl || data?.libraryRvcVoiceId);
  const hasTrainAudio = !!(data?.referenceAudioUrl || '').trim();
  const trainAudioUrl = (data?.referenceAudioUrl || '').trim();
  const aiStatus = data?.aiStatus || 'idle';
  const rawProgress = typeof data?.progress === 'number' ? data.progress : 0;
  const progress = rawProgress >= 100 ? 0 : rawProgress;
  const isProcessing =
    aiStatus !== 'ERROR' &&
    aiStatus !== 'SUCCESS' &&
    aiStatus !== 'idle' &&
    (aiStatus === 'PROCESSING' || aiStatus === 'START' || (progress > 0 && progress < 100));
  const isSuccess = aiStatus === 'SUCCESS' || hasPackage;
  const avatar = (data?.libraryAvatarUrl || '').trim();
  const onColorPanel = !isDarkMode;

  const panelBg = isDarkMode ? 'nexflow-glass-panel' : 'apple-panel-light';
  const solidBg = isDarkMode ? '#1C1C1E' : '#f5f5f5';
  const nameCls = onColorPanel ? 'text-white/95' : isDarkMode ? 'text-white/90' : 'text-gray-900';
  const metaCls = onColorPanel ? 'text-white/50' : isDarkMode ? 'text-white/40' : 'text-gray-500';
  const firstLetter = (modelName || 'R').charAt(0).toUpperCase();
  const showFontToolbar = (selected || isHovered) && !isNicknamePlaceholder;
  const avatarColumnHeight = Math.max(120, h - RVC_TRAIN_BODY_PAD_Y_PX);
  const avatarColumnWidth = Math.round((avatarColumnHeight * 3) / 4);

  return (
    <div
      data-id={id}
      className={`custom-node-container group relative rounded-2xl overflow-visible ${panelBg} transition-all duration-200 ${
        selected
          ? isDarkMode
            ? 'ring-2 ring-violet-400/80'
            : 'ring-2 ring-violet-500'
          : ''
      }`}
      style={{ width: w, height: h, minHeight: h }}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
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

      <div className="title-area absolute -top-7 left-0 z-10 flex items-center gap-1.5 max-w-full">
        <span
          className={`text-[10px] font-medium truncate ${isDarkMode ? 'text-white/75' : 'text-gray-900'}`}
        >
          {t.moduleTitle}
        </span>
        {isSuccess ? (
          <span
            className={`inline-flex items-center gap-0.5 text-[10px] font-medium shrink-0 ${
              isDarkMode ? 'text-emerald-400' : 'text-emerald-600'
            }`}
          >
            <Check className="w-3 h-3" strokeWidth={2.5} />
            {t.trainedBadge}
          </span>
        ) : null}
      </div>

      <div className="node-body absolute inset-0 rounded-2xl overflow-hidden flex flex-col">
        <div className="flex flex-1 min-h-0 gap-3 px-4 py-3">
          <div
            className="relative shrink-0 self-stretch"
            style={{ width: avatarColumnWidth, minHeight: avatarColumnHeight }}
          >
            {avatar ? (
              <img
                src={avatar}
                alt=""
                className={`h-full w-full rounded-2xl object-cover aspect-[3/4] ${
                  onColorPanel ? 'ring-1 ring-white/20' : isDarkMode ? 'ring-1 ring-white/10' : 'ring-1 ring-black/10'
                }`}
              />
            ) : (
              <div
                className={`h-full w-full aspect-[3/4] rounded-2xl flex items-center justify-center ${
                  onColorPanel
                    ? 'bg-white/12 text-white/85'
                    : isDarkMode
                      ? 'bg-violet-500/12 text-violet-300/90'
                      : 'bg-violet-100 text-violet-600'
                }`}
              >
                {modelName ? (
                  <span className="text-4xl font-semibold leading-none">{firstLetter}</span>
                ) : (
                  <Package className="w-12 h-12" strokeWidth={1.5} />
                )}
              </div>
            )}
            {isSuccess ? (
              <span className="absolute -bottom-1 -right-1 flex h-5 w-5 items-center justify-center rounded-full bg-emerald-500 text-white shadow-sm">
                <Check className="w-3 h-3" strokeWidth={3} />
              </span>
            ) : null}
          </div>

          <div className="min-w-0 flex-1 flex flex-col min-h-0 gap-2">
            <div className="flex-1 min-h-0 flex flex-col items-center justify-center gap-0.5 text-center px-1">
              <div
                data-rvc-train-model-name
                className={`max-w-full font-semibold ${
                  isNicknamePlaceholder ? `${metaCls} text-[15px] leading-snug truncate` : `${nameCls} whitespace-nowrap`
                }`}
                style={isNicknamePlaceholder ? undefined : { fontSize: nameFontPx, lineHeight: 1 }}
                title={modelName || undefined}
              >
                {displayName}
              </div>
              {!isSuccess && !isProcessing && (
                <div className={`max-w-full text-[11px] truncate ${metaCls}`}>
                  {hasTrainAudio ? t.slotConnected : t.slotPending}
                </div>
              )}
              {data?.errorMessage && aiStatus === 'ERROR' && (
                <div className="max-w-full text-[10px] text-red-300 truncate" title={data.errorMessage}>
                  {data.errorMessage}
                </div>
              )}
            </div>

            <div className="shrink-0 w-full">
              <ReferenceAudioWaveStrip
                src={trainAudioUrl}
                isDarkMode={isDarkMode}
                variant="compact"
                waveOnly
                emptyLabel={t.trainAudioPreviewEmpty}
                playLabel={t.trainAudioPreview}
              />
            </div>
          </div>
        </div>

        <ModuleProgressBar
          visible={isProcessing}
          progress={progress > 0 ? progress : 1}
          solidBackground={solidBg}
          progressMessage={data?.progressMessage || t.training}
          borderRadius={16}
          onFadeComplete={() => onDataChange?.(id, { progress: 0, progressMessage: '' })}
        />
      </div>

      {showFontToolbar ? (
        <div
          className="node-floating-toolbar nodrag nopan absolute top-full left-1/2 z-20 mt-1.5 flex w-max max-w-[min(520px,calc(100vw-2rem))] -translate-x-1/2 flex-wrap items-center justify-center gap-1.5 overflow-visible"
          style={{ pointerEvents: 'all' }}
          onPointerDown={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
          onWheel={(e) => e.stopPropagation()}
        >
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              bumpNameFont(-RVC_TRAIN_NAME_FONT_STEP_PX);
            }}
            disabled={atMinNameFont}
            className={floatToolBtn('control', atMinNameFont)}
            title={wc.fontZoomOutTitle}
            aria-label={wc.fontZoomOutTitle}
          >
            <ZoomOut className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              bumpNameFont(RVC_TRAIN_NAME_FONT_STEP_PX);
            }}
            disabled={atMaxNameFont}
            className={floatToolBtn('operators', atMaxNameFont)}
            title={wc.fontZoomInTitle}
            aria-label={wc.fontZoomInTitle}
          >
            <ZoomIn className="w-3.5 h-3.5" />
          </button>
        </div>
      ) : null}
    </div>
  );
};

export default RvcTrainNode;
