// @ts-nocheck
import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, Download, Save, Check } from 'lucide-react';
import { useAppLocale } from '../../contexts/AppLocaleContext';
import { imageTo3dT } from '../../i18n/imageTo3dI18n';
import ImageTo3dInlineGlbPreview from '../ImageTo3dInlineGlbPreview';
import { IMAGE_TO_3D_PREVIEW_CAMERA_FRAMING } from '../../constants/imageTo3dLayout';
import { preloadGlbPreviewUrl } from '../../utils/glbPreviewPreload';

export interface ImageTo3dFullscreenViewProps {
  glbUrl: string;
  overrideTextureUrl?: string;
  referenceImageUrl?: string;
  topOffset?: number;
  onClose: () => void;
  onDownload: () => void;
  onSaveToLibrary?: () => void;
  downloading?: boolean;
  savingToLibrary?: boolean;
  savedToLibrary?: boolean;
}

const ImageTo3dFullscreenView: React.FC<ImageTo3dFullscreenViewProps> = ({
  glbUrl,
  overrideTextureUrl,
  referenceImageUrl,
  topOffset = 0,
  onClose,
  onDownload,
  onSaveToLibrary,
  downloading = false,
  savingToLibrary = false,
  savedToLibrary = false,
}) => {
  const { locale } = useAppLocale();
  const t = imageTo3dT(locale);
  const previewAreaRef = useRef<HTMLDivElement>(null);
  type FullscreenBgMode = 'grid' | 'black' | 'white';
  const [bgMode, setBgMode] = useState<FullscreenBgMode>('grid');
  const showGrid = bgMode === 'grid';
  const usePureBlackBackground = bgMode === 'black';
  const usePureWhiteBackground = bgMode === 'white';
  const shellBgClass =
    bgMode === 'white' ? 'bg-white' : bgMode === 'black' ? 'bg-black' : 'bg-[#0a0a0c]';

  useEffect(() => {
    if (glbUrl) preloadGlbPreviewUrl(glbUrl);
  }, [glbUrl]);

  /** 全屏预览区滚轮用于 3D 缩放，不向画布传递以免触发画布 zoom */
  useEffect(() => {
    const root = previewAreaRef.current;
    if (!root) return;
    const onWheel = (e: WheelEvent) => {
      e.stopPropagation();
    };
    root.addEventListener('wheel', onWheel, { capture: true });
    return () => root.removeEventListener('wheel', onWheel, { capture: true });
  }, []);

  /** ESC 退出全屏（捕获阶段，避免落到画布触发退出应用确认） */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (e.defaultPrevented) return;
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) {
        return;
      }
      e.preventDefault();
      e.stopPropagation();
      onClose();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);

  return createPortal(
    <div
      className={`fixed left-0 right-0 bottom-0 z-[920] flex flex-col ${shellBgClass}`}
      style={{ top: topOffset }}
    >
      <div className="flex items-center justify-between gap-3 px-4 py-2 border-b border-white/10 bg-black/50 flex-shrink-0">
        <div>
          <h2 className="text-sm font-medium text-white">{t.fullscreenTitle}</h2>
          <p className="text-xs text-white/50">{t.rotateHint}</p>
        </div>
        <div className="flex items-center gap-3">
          {/* 网格 / 纯黑 / 纯白 背景切换 */}
          <div className="flex items-center rounded-lg border border-white/15 bg-white/5 p-0.5 text-xs">
            <button
              type="button"
              onClick={() => setBgMode('grid')}
              className={`rounded-md px-2.5 py-1 transition-colors ${bgMode === 'grid' ? 'bg-white/20 text-white' : 'text-white/60 hover:text-white/80'}`}
            >
              {t.fullscreenBgGrid}
            </button>
            <button
              type="button"
              onClick={() => setBgMode('black')}
              className={`rounded-md px-2.5 py-1 transition-colors ${bgMode === 'black' ? 'bg-white/20 text-white' : 'text-white/60 hover:text-white/80'}`}
            >
              {t.fullscreenBgBlack}
            </button>
            <button
              type="button"
              onClick={() => setBgMode('white')}
              className={`rounded-md px-2.5 py-1 transition-colors ${bgMode === 'white' ? 'bg-white/20 text-white' : 'text-white/60 hover:text-white/80'}`}
            >
              {t.fullscreenBgWhite}
            </button>
          </div>

          {onSaveToLibrary ? (
            <button
              type="button"
              onClick={onSaveToLibrary}
              disabled={savingToLibrary || downloading}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium disabled:opacity-50 ${
                savedToLibrary
                  ? 'bg-emerald-700/80 text-emerald-100'
                  : 'bg-violet-600 hover:bg-violet-500 text-white'
              }`}
              title={savedToLibrary ? t.saveToLibraryAlready : t.saveToLibrary}
            >
              {savedToLibrary ? <Check className="w-3.5 h-3.5" /> : <Save className="w-3.5 h-3.5" />}
              {savedToLibrary ? t.saveToLibraryAlready : t.saveToLibrary}
            </button>
          ) : null}
          <button
            type="button"
            onClick={onDownload}
            disabled={downloading || savingToLibrary}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-emerald-600 hover:bg-emerald-500 text-white disabled:opacity-50"
          >
            <Download className="w-3.5 h-3.5" />
            {t.download}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-white/80 hover:bg-white/10"
            title={t.close}
          >
            <X className="w-5 h-5" />
          </button>
        </div>
      </div>
      <div ref={previewAreaRef} className="flex-1 min-h-0">
        <ImageTo3dInlineGlbPreview
          glbUrl={glbUrl}
          textureUrl={overrideTextureUrl}
          placeholderImageUrl={referenceImageUrl}
          previewKey={`fullscreen-${glbUrl}`}
          showReferencePlaceholder={!!referenceImageUrl?.trim()}
          wrapperClassName="relative h-full w-full"
          className="absolute inset-0 z-[2] h-full w-full"
          cameraFraming={IMAGE_TO_3D_PREVIEW_CAMERA_FRAMING}
          gridStyle="showcase"
          turntableRotate={false}
          useStudioEnvironment={false}
          showFog={false}
          showGrid={showGrid}
          usePureBlackBackground={usePureBlackBackground}
          usePureWhiteBackground={usePureWhiteBackground}
          showGizmo
          enabled
          renderActive
          controlsInteractive
          embeddedInFlow={false}
          controlMinDistance={0.2}
          controlMaxDistance={32}
          placeholderMessage={t.webglUnavailable}
          placeholderSubMessage={t.webglUnavailableHint}
        />
      </div>
    </div>,
    document.body,
  );
};

export default ImageTo3dFullscreenView;
