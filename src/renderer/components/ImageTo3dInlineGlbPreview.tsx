import React, { useCallback, useEffect, useState } from 'react';
import GlbModelViewer, { type GlbCameraFramingMode } from './Canvas/GlbModelViewer';
import type { Character } from './characterListShared';
import {
  resolveCharacterGlbUrlForPreview,
  resolveCharacterTextureUrlForPreview,
  resolveImageTo3dLibraryThumbUrl,
} from './characterListShared';

/** 约 24 秒缓慢转一圈（弧度/秒） */
const TURNTABLE_SPEED = Math.PI / 12;

export interface ImageTo3dInlineGlbPreviewProps {
  /** 资产库条目（与 glbUrl 二选一或同时提供时 glbUrl 优先） */
  character?: Character;
  glbUrl?: string;
  textureUrl?: string;
  /** 画布参考图 URL；资产库不传则从 character 解析 */
  placeholderImageUrl?: string;
  className?: string;
  wrapperClassName?: string;
  previewKey?: string;
  onModelReady?: () => void;
  showReferencePlaceholder?: boolean;
  cameraFraming?: GlbCameraFramingMode;
  turntableRotate?: boolean;
  useStudioEnvironment?: boolean;
  showGrid?: boolean;
  showGizmo?: boolean;
  gridStyle?: 'default' | 'showcase';
  showFog?: boolean;
  showGridWhenEmpty?: boolean;
  enabled?: boolean;
  renderActive?: boolean;
  captureRef?: React.MutableRefObject<(() => string | null) | null>;
  placeholderMessage?: string;
  placeholderSubMessage?: string;
  controlsInteractive?: boolean;
  /** false：全屏等脱离画布场景，不加 nodrag/nowheel，避免阻断轨道控制 */
  embeddedInFlow?: boolean;
  controlMinDistance?: number;
  controlMaxDistance?: number;
  /** 全屏纯黑背景模式 */
  usePureBlackBackground?: boolean;
  /** 全屏纯白背景模式 */
  usePureWhiteBackground?: boolean;
}

/** 资产库 / 画布节点 / 全屏预览共用的 3D 展示（支持参考图秒出 + 轻量光照） */
const ImageTo3dInlineGlbPreview: React.FC<ImageTo3dInlineGlbPreviewProps> = ({
  character,
  glbUrl: glbUrlProp,
  textureUrl: textureUrlProp,
  placeholderImageUrl,
  className = 'absolute inset-0 h-full w-full',
  wrapperClassName = 'relative h-full w-full',
  previewKey,
  onModelReady,
  showReferencePlaceholder = false,
  cameraFraming = 'fit',
  turntableRotate = true,
  useStudioEnvironment = false,
  showGrid = true,
  showGizmo = false,
  gridStyle = 'showcase',
  showFog = false,
  showGridWhenEmpty = true,
  enabled = true,
  renderActive = true,
  captureRef,
  placeholderMessage,
  placeholderSubMessage,
  controlsInteractive = false,
  embeddedInFlow = true,
  controlMinDistance,
  controlMaxDistance,
  usePureBlackBackground = false,
  usePureWhiteBackground = false,
}) => {
  const glbUrl =
    (glbUrlProp || '').trim() || (character ? resolveCharacterGlbUrlForPreview(character) : '');
  const textureUrl =
    (textureUrlProp || '').trim() ||
    (character ? resolveCharacterTextureUrlForPreview(character) : undefined);
  const thumbUrl = showReferencePlaceholder
    ? (placeholderImageUrl || '').trim() ||
      (character ? resolveImageTo3dLibraryThumbUrl(character) : '')
    : '';
  const viewerKey = previewKey || character?.id || glbUrl;
  const [modelReady, setModelReady] = useState(false);

  useEffect(() => {
    setModelReady(false);
  }, [viewerKey, glbUrl, textureUrl]);

  const handleModelReady = useCallback(() => {
    setModelReady(true);
    onModelReady?.();
  }, [onModelReady]);

  if (!glbUrl && !showGridWhenEmpty) return null;

  /** 全屏模式（embeddedInFlow=false）不显示参考图占位，只显示 3D 画布 */
  const shouldShowThumb = thumbUrl && embeddedInFlow;

  return (
    <div className={`${wrapperClassName || 'absolute inset-0 h-full w-full'} min-h-0 min-w-0`}>
      {shouldShowThumb ? (
        <img
          src={thumbUrl}
          alt=""
          className={`pointer-events-none absolute inset-0 z-[1] h-full w-full object-contain bg-[#1a1a1e] transition-opacity duration-200 ${
            modelReady ? 'opacity-0' : 'opacity-100'
          }`}
          draggable={false}
        />
      ) : null}
      <GlbModelViewer
        key={viewerKey}
        url={glbUrl}
        overrideTextureUrl={textureUrl || undefined}
        className={`${className || 'absolute inset-0 h-full w-full'} transition-opacity duration-200 ${
          modelReady || !thumbUrl ? 'opacity-100' : 'opacity-0'
        }`}
        showGridWhenEmpty={showGridWhenEmpty}
        showGrid={showGrid}
        gridStyle={gridStyle}
        showFog={showFog}
        showGizmo={showGizmo}
        enabled={enabled}
        renderActive={renderActive}
        captureRef={captureRef}
        cameraFraming={cameraFraming}
        turntableRotate={turntableRotate}
        turntableSpeed={TURNTABLE_SPEED}
        controlsInteractive={controlsInteractive}
        embeddedInFlow={embeddedInFlow}
        controlMinDistance={controlMinDistance}
        controlMaxDistance={controlMaxDistance}
        useStudioEnvironment={useStudioEnvironment}
        usePureBlackBackground={usePureBlackBackground}
        usePureWhiteBackground={usePureWhiteBackground}
        onModelReady={handleModelReady}
        placeholderMessage={placeholderMessage}
        placeholderSubMessage={placeholderSubMessage}
      />
    </div>
  );
};

export default ImageTo3dInlineGlbPreview;
