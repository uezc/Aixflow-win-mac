import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Handle, Position, NodeProps, useViewport } from 'reactflow';
import { Video } from 'lucide-react';
import { ReferenceAudioWaveStrip } from './ReferenceAudioWaveStrip';
import {
  DIGITAL_HUMAN_OUTPUT_AUDIO_HANDLE,
  DIGITAL_HUMAN_OUTPUT_VIDEO_HANDLE,
  pickDigitalHumanAudioUrl,
  pickDigitalHumanVideoUrl,
} from '../../utils/digitalHumanNodeMedia';
import { dispatchCanvasPickNode, isCanvasPickDigitalHumanVideoTarget } from '../../utils/canvasPickStore';
import { normalizeVideoUrl, toElectronVideoElementSrc } from '../../utils/normalizeVideoUrl';
import {
  scheduleClearActiveDigitalHumanVideoNodeId,
  setActiveDigitalHumanVideoNodeId,
  useGlobalInteractionSelector,
} from '../../utils/globalInteractionStore';

const DEFAULT_CARD_W = 380;
const PORTRAIT_VIDEO_ASPECT = 9 / 16;
const MIN_CARD_W = 280;
const CHROME_V = 36;
const AUDIO_BLOCK_H = 132;
const INNER_PAD = 16;

export interface DigitalHumanNodeData {
  title?: string;
  nickname?: string;
  name?: string;
  width?: number;
  height?: number;
  isUserResized?: boolean;
  mediaAspectRatio?: number;
  referenceVideoUrl?: string;
  originalVideoUrl?: string;
  outputVideo?: string;
  referenceAudioUrl?: string;
  originalAudioUrl?: string;
  poster?: string;
  libraryDigitalHumanId?: string;
}

interface DigitalHumanNodeProps extends NodeProps<DigitalHumanNodeData> {
  isDarkMode?: boolean;
  onDataChange?: (updates: Partial<DigitalHumanNodeData>) => void;
}

function layoutHeightForWidth(cardW: number, aspect: number): number {
  const innerW = Math.max(160, cardW - INNER_PAD);
  const videoH = aspect > 0 ? Math.round(innerW / aspect) : Math.round(innerW / PORTRAIT_VIDEO_ASPECT);
  return CHROME_V + videoH + 8 + AUDIO_BLOCK_H + 8;
}

const DigitalHumanNodeComponent: React.FC<DigitalHumanNodeProps> = ({
  id,
  data,
  selected,
  isDarkMode = true,
  onDataChange,
  dragging,
}) => {
  const { zoom } = useViewport();
  const activeDigitalHumanVideoNodeId = useGlobalInteractionSelector((s) => s.activeDigitalHumanVideoNodeId);
  const isActiveVideoPlayback = activeDigitalHumanVideoNodeId === id;
  const nodeRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [isEditingNickname, setIsEditingNickname] = useState(false);
  const [nickname, setNickname] = useState(data?.nickname || '');
  const nicknameInputRef = useRef<HTMLInputElement>(null);
  const [videoAspect, setVideoAspect] = useState<number | null>(
    typeof data?.mediaAspectRatio === 'number' && data.mediaAspectRatio > 0 ? data.mediaAspectRatio : null,
  );
  const [videoLoadError, setVideoLoadError] = useState(false);
  const [isVideoHovered, setIsVideoHovered] = useState(false);

  const cardW = data?.width || DEFAULT_CARD_W;
  const aspect = videoAspect || (typeof data?.mediaAspectRatio === 'number' && data.mediaAspectRatio > 0 ? data.mediaAspectRatio : PORTRAIT_VIDEO_ASPECT);
  const cardH = data?.height || layoutHeightForWidth(cardW, aspect);
  const innerW = Math.max(160, cardW - INNER_PAD);
  const videoPanelH = Math.max(120, Math.round(innerW / aspect));

  const rawVideoUrl = pickDigitalHumanVideoUrl(data as Record<string, unknown>);
  const normalizedVideoUrl = useMemo(() => normalizeVideoUrl(rawVideoUrl), [rawVideoUrl]);
  const displaySrc = useMemo(() => toElectronVideoElementSrc(normalizedVideoUrl), [normalizedVideoUrl]);
  const audioUrl = pickDigitalHumanAudioUrl(data as Record<string, unknown>);
  const displayName = (data?.nickname || data?.name || '数字人').trim();

  const updateNodeData = useCallback(
    (updates: Partial<DigitalHumanNodeData>) => {
      onDataChange?.(updates);
    },
    [onDataChange],
  );

  const applyLayoutForAspect = useCallback(
    (nextAspect: number, nextW: number, userResized?: boolean) => {
      const w = Math.max(MIN_CARD_W, Math.round(nextW));
      const h = layoutHeightForWidth(w, nextAspect);
      updateNodeData({
        width: w,
        height: h,
        mediaAspectRatio: nextAspect,
        ...(userResized ? { isUserResized: true } : {}),
      });
    },
    [updateNodeData],
  );

  useEffect(() => {
    setVideoAspect(null);
    setVideoLoadError(false);
  }, [displaySrc]);

  useEffect(() => {
    if (dragging) setIsVideoHovered(false);
  }, [dragging]);

  useEffect(() => {
    const v = videoRef.current;
    if (!v || !displaySrc || videoLoadError) return;

    const shouldPlay = isVideoHovered && isActiveVideoPlayback;

    if (!shouldPlay) {
      v.pause();
      v.muted = true;
      v.loop = false;
      try {
        v.currentTime = 0.001;
      } catch {
        /* ignore */
      }
      return;
    }

    v.loop = true;
    v.muted = false;
    v.volume = 1;
    v.playbackRate = 1;
    v.currentTime = 0;
    void v.play().catch(() => {
      v.muted = true;
      void v.play().catch(() => undefined);
    });

    return () => {
      v.pause();
      v.muted = true;
      v.loop = false;
    };
  }, [isVideoHovered, isActiveVideoPlayback, displaySrc, videoLoadError]);

  const primeVideoFrame = useCallback(() => {
    const v = videoRef.current;
    if (!v || !displaySrc) return;
    try {
      v.currentTime = 0.001;
    } catch {
      /* ignore */
    }
  }, [displaySrc]);

  const handleVideoMetadata = useCallback(() => {
    const v = videoRef.current;
    if (!v || v.videoWidth < 1 || v.videoHeight < 1) return;
    setVideoLoadError(false);
    const nextAspect = v.videoWidth / v.videoHeight;
    setVideoAspect(nextAspect);
    if (!data?.isUserResized) {
      applyLayoutForAspect(nextAspect, cardW, false);
    }
    primeVideoFrame();
  }, [applyLayoutForAspect, cardW, data?.isUserResized, primeVideoFrame]);

  const handleHeaderDoubleClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    setNickname(data?.nickname || '');
    setIsEditingNickname(true);
    requestAnimationFrame(() => nicknameInputRef.current?.focus());
  }, [data?.nickname]);

  const handleResizePointerDown = useCallback(
    (e: React.PointerEvent) => {
      e.stopPropagation();
      e.preventDefault();
      const startX = e.clientX;
      const startW = cardW;
      const ar = aspect;
      const z = zoom > 0 ? zoom : 1;

      const onMove = (ev: PointerEvent) => {
        const nextW = Math.max(MIN_CARD_W, startW + (ev.clientX - startX) / z);
        applyLayoutForAspect(ar, nextW, true);
      };
      const onUp = () => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
      };
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
    },
    [applyLayoutForAspect, aspect, cardW, zoom],
  );

  const slotBorder = isDarkMode ? 'border-white/20 bg-black' : 'border-gray-300 bg-black';

  return (
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
        type="source"
        position={Position.Right}
        id={DIGITAL_HUMAN_OUTPUT_VIDEO_HANDLE}
        style={{ top: `${Math.round((CHROME_V + videoPanelH * 0.5) / cardH * 100)}%`, right: 0 }}
        title="输出参考视频"
        className="nexflow-plus-handle nexflow-plus-handle-right"
      />
      <Handle
        type="source"
        position={Position.Right}
        id={DIGITAL_HUMAN_OUTPUT_AUDIO_HANDLE}
        style={{ top: `${Math.round((CHROME_V + videoPanelH + 8 + AUDIO_BLOCK_H * 0.55) / cardH * 100)}%`, right: 0 }}
        title="输出参考音"
        className="nexflow-plus-handle nexflow-plus-handle-right"
      />

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
              if (data?.nickname !== next) updateNodeData({ nickname: next || undefined });
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                setIsEditingNickname(false);
                const next = nickname.trim();
                if (data?.nickname !== next) updateNodeData({ nickname: next || undefined });
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
            title="编辑显示名"
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

      <div className="flex flex-col min-h-0 pt-5 gap-2">
        <div
          className={`relative shrink-0 overflow-hidden rounded-lg border ${slotBorder}`}
          style={{ width: innerW, height: videoPanelH, maxWidth: '100%', alignSelf: 'center' }}
          onMouseEnter={() => {
            setIsVideoHovered(true);
            setActiveDigitalHumanVideoNodeId(id);
          }}
          onMouseLeave={() => {
            setIsVideoHovered(false);
            scheduleClearActiveDigitalHumanVideoNodeId();
          }}
          onClickCapture={() => {
            if (!isCanvasPickDigitalHumanVideoTarget() || !rawVideoUrl) return;
            dispatchCanvasPickNode(id);
          }}
        >
          {displaySrc && !videoLoadError ? (
            <video
              ref={videoRef}
              key={displaySrc}
              src={displaySrc}
              className="absolute inset-0 h-full w-full object-contain bg-black"
              muted={!isVideoHovered}
              loop={isVideoHovered && isActiveVideoPlayback}
              playsInline
              preload={isVideoHovered ? 'auto' : 'none'}
              onLoadedMetadata={handleVideoMetadata}
              onLoadedData={primeVideoFrame}
              onError={() => setVideoLoadError(true)}
            />
          ) : (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 bg-black/80">
              <Video className={`w-8 h-8 ${isDarkMode ? 'text-white/25' : 'text-gray-400'}`} />
              <span className={`text-[10px] ${isDarkMode ? 'text-white/35' : 'text-gray-500'}`}>
                {videoLoadError ? '视频加载失败' : '参考视频'}
              </span>
            </div>
          )}
          <div
            className={`absolute left-1.5 top-1.5 rounded px-1.5 py-0.5 text-[10px] font-medium pointer-events-none ${
              isDarkMode ? 'bg-black/55 text-white/85' : 'bg-white/90 text-gray-700'
            }`}
          >
            参考视频
          </div>
        </div>

        <div className="shrink-0">
          <div className={`mb-1 text-[10px] font-medium ${isDarkMode ? 'text-white/45' : 'text-gray-500'}`}>
            参考音
          </div>
          <ReferenceAudioWaveStrip src={audioUrl} isDarkMode={isDarkMode} />
        </div>
      </div>

      {selected ? (
        <div
          role="presentation"
          title="拖拽调整模块宽度（按视频比例缩放）"
          onPointerDown={handleResizePointerDown}
          className="absolute bottom-1 right-1 z-20 h-3.5 w-3.5 cursor-nwse-resize rounded-sm border border-white/70 bg-white/90 shadow nodrag nopan"
        />
      ) : null}
    </div>
  );
};

export const DigitalHumanNode = memo(DigitalHumanNodeComponent);
export default DigitalHumanNode;
