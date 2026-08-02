// @ts-nocheck
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Handle, Position, NodeProps } from 'reactflow';
import { useFrozenFlowZoom } from '../../hooks/useFrozenFlowViewport';
import { Maximize2, Download, Save, Check } from 'lucide-react';
import { useAppLocale } from '../../contexts/AppLocaleContext';
import { useImageTo3dInputPanelAnchor } from '../../contexts/ImageTo3dInputPanelContext';
import { imageTo3dT } from '../../i18n/imageTo3dI18n';
import { userFacingErrorMessage } from '../../utils/userErrorMessageCn';
import ImageTo3dFullscreenView from './ImageTo3dFullscreenView';
import ImageTo3dInlineGlbPreview from '../ImageTo3dInlineGlbPreview';
import GlbModelViewer from './GlbModelViewer';
import GlbViewerPlaceholder from './GlbViewerPlaceholder';
import { preloadGlbPreviewUrl } from '../../utils/glbPreviewPreload';
import { isRhPreviewRenderTextureUrl } from '../../utils/glbViewerUtils';
import { ErrorBoundary } from '../ErrorBoundary';
import { ModuleProgressBar } from './ModuleProgressBar';
import {
  IMAGE_TO_3D_HEIGHT,
  IMAGE_TO_3D_PREVIEW_CAMERA_FRAMING,
  IMAGE_TO_3D_WIDTH,
} from '../../constants/imageTo3dLayout';

export interface ImageTo3dNodeData {
  width?: number;
  height?: number;
  inputImageUrl?: string;
  /** 生成后从云端结果解析的贴图（仅画布预览） */
  resultTextureUrl?: string;
  resultTextureRemoteUrl?: string;
  outputGlbUrl?: string;
  remoteGlbUrl?: string;
  localGlbPath?: string;
  localGlbUrl?: string;
  localTexturePath?: string;
  progress?: number;
  progressMessage?: string;
  errorMessage?: string;
  /** 失焦时截取的 3D 预览图，用于未选中时在画布上保持画面 */
  previewSnapshotUrl?: string;
  /** 已写入左侧「3D 模型」资产库的角色 id */
  libraryCharacterId?: string;
  /** image-to-3d | trellis2 */
  model?: string;
}

interface ImageTo3dNodeProps extends NodeProps<ImageTo3dNodeData> {
  projectId?: string;
  isDarkMode?: boolean;
  onDataChange?: (nodeId: string, updates: Partial<ImageTo3dNodeData>) => void;
  /** 保存到资产库后刷新左侧 3D 模型库 */
  onLibrarySaved?: () => void;
  workspaceHeaderBottom?: number;
}

const ImageTo3dNode: React.FC<ImageTo3dNodeProps> = ({
  id,
  data,
  selected,
  projectId,
  isDarkMode = true,
  onDataChange,
  onLibrarySaved,
  workspaceHeaderBottom = 0,
}) => {
  const { locale } = useAppLocale();
  const t = imageTo3dT(locale);

  const [fullscreen, setFullscreen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savingToLibrary, setSavingToLibrary] = useState(false);
  const savedToLibrary = !!(data?.libraryCharacterId || '').trim();
  const [downloadNotice, setDownloadNotice] = useState<{
    variant: 'success' | 'error';
    message: string;
  } | null>(null);
  const downloadNoticeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const captureRef = useRef<(() => string | null) | null>(null);
  const prevSelectedRef = useRef(!!selected);
  const prevGlbKeyRef = useRef('');
  const wasGeneratingRef = useRef(false);
  /** 离开/失焦时截帧，供持久化缩略图（界面展示始终用实时 WebGL） */
  const [freezeFrameUrl, setFreezeFrameUrl] = useState<string | null>(null);

  const previewGlbUrl =
    (data?.localGlbUrl || data?.remoteGlbUrl || data?.outputGlbUrl || '').trim() || '';
  const resultTextureUrlRaw = (data?.resultTextureUrl || '').trim();
  const resultTextureUrl = isRhPreviewRenderTextureUrl(resultTextureUrlRaw)
    ? ''
    : resultTextureUrlRaw;
  const [embeddedTextureUrl, setEmbeddedTextureUrl] = useState('');
  const previewTextureUrl = resultTextureUrl || embeddedTextureUrl;
  const hasOutput = !!previewGlbUrl;
  const rawProgress = typeof data?.progress === 'number' ? data.progress : 0;
  /** 兼容旧数据 progress=100；仅 1–99 为生成中 */
  const progress = rawProgress >= 100 ? 0 : rawProgress;
  const isGenerating = progress > 0 && progress < 100;

  const flashDownloadNotice = useCallback((variant: 'success' | 'error', message: string) => {
    if (downloadNoticeTimerRef.current) clearTimeout(downloadNoticeTimerRef.current);
    setDownloadNotice({ variant, message });
    downloadNoticeTimerRef.current = setTimeout(() => setDownloadNotice(null), 4500);
  }, []);

  useEffect(
    () => () => {
      if (downloadNoticeTimerRef.current) clearTimeout(downloadNoticeTimerRef.current);
    },
    [],
  );

  const handleDownload = useCallback(async () => {
    if (!previewGlbUrl && !data?.localGlbPath?.trim()) {
      flashDownloadNotice('error', t.noModelToDownload);
      return;
    }
    if (!window.electronAPI?.saveImageTo3dAixflow) {
      flashDownloadNotice('error', t.downloadApiUnavailable);
      return;
    }
    setSaving(true);
    try {
      const r = await window.electronAPI.saveImageTo3dAixflow({
        defaultName: `image-to-3d-${id.slice(-8)}.aixflow`,
        glbLocalPath: data?.localGlbPath,
        glbRemoteUrl: data?.remoteGlbUrl || data?.outputGlbUrl || data?.localGlbUrl,
        textureLocalPath: data?.localTexturePath,
        textureRemoteUrl: data?.resultTextureRemoteUrl as string | undefined,
        textureResourceUrl: previewTextureUrl,
        referenceRemoteUrl: (data?.inputImageUrl || '').trim() || undefined,
      });
      if (r?.canceled) return;
      if (r?.filePath) {
        const fileName = r.filePath.replace(/^.*[/\\]/, '');
        let base = t.downloadSuccessGlbOnly;
        if (r.hasReference && r.hasTexture) base = t.downloadSuccessWithTexture;
        else if (r.hasReference) base = t.downloadSuccessGlbOnly;
        else if (r.hasTexture) base = t.downloadSuccessTextureNoRef;
        else base = t.downloadSuccessGlbOnlyNoRef;
        flashDownloadNotice('success', `${base}\n${fileName}`);
      } else {
        flashDownloadNotice('error', t.downloadFailed);
      }
    } catch (err) {
      flashDownloadNotice(
        'error',
        userFacingErrorMessage(err instanceof Error ? err.message : t.downloadFailed, locale),
      );
    } finally {
      setSaving(false);
    }
  }, [
    data?.localGlbPath,
    data?.localTexturePath,
    data?.localGlbUrl,
    data?.remoteGlbUrl,
    data?.outputGlbUrl,
    data?.inputImageUrl,
    data?.resultTextureRemoteUrl,
    previewGlbUrl,
    previewTextureUrl,
    flashDownloadNotice,
    id,
    locale,
    t,
  ]);

  const handleSaveToLibrary = useCallback(async () => {
    if (!hasOutput) {
      flashDownloadNotice('error', t.noModelToDownload);
      return;
    }
    if (savedToLibrary) {
      flashDownloadNotice('success', t.saveToLibraryAlready);
      return;
    }
    if (!window.electronAPI?.registerImageTo3dCharacter) {
      flashDownloadNotice('error', t.downloadApiUnavailable);
      return;
    }
    setSavingToLibrary(true);
    try {
      const tex = previewTextureUrl || undefined;
      const char = await window.electronAPI.registerImageTo3dCharacter({
        inputImageUrl: (data?.inputImageUrl || '').trim() || undefined,
        localGlbPath: data?.localGlbPath,
        localGlbUrl: data?.localGlbUrl,
        remoteGlbUrl: data?.remoteGlbUrl || data?.outputGlbUrl,
        resultTextureLocalUrl: tex,
        resultTextureRemoteUrl: data?.resultTextureRemoteUrl || tex,
      });
      onDataChange?.(id, { libraryCharacterId: char.id });
      onLibrarySaved?.();
      flashDownloadNotice('success', t.saveToLibrarySuccess);
    } catch (err) {
      flashDownloadNotice(
        'error',
        userFacingErrorMessage(err instanceof Error ? err.message : t.saveToLibraryFailed, locale),
      );
    } finally {
      setSavingToLibrary(false);
    }
  }, [
    data?.inputImageUrl,
    data?.localGlbPath,
    data?.localGlbUrl,
    data?.remoteGlbUrl,
    data?.outputGlbUrl,
    data?.resultTextureRemoteUrl,
    hasOutput,
    id,
    locale,
    onDataChange,
    onLibrarySaved,
    previewTextureUrl,
    savedToLibrary,
    flashDownloadNotice,
    t,
  ]);

  const w = data?.width || IMAGE_TO_3D_WIDTH;
  const h = data?.height || IMAGE_TO_3D_HEIGHT;

  const panelBg = isDarkMode ? 'nexflow-glass-panel' : 'bg-gray-200/90 backdrop-blur-md';
  const panelStyle = !isDarkMode
    ? {
        background: 'rgba(229, 231, 235, 0.9)',
        backdropFilter: 'blur(12px) saturate(150%)',
        WebkitBackdropFilter: 'blur(12px) saturate(150%)',
      }
    : undefined;

  const showCornerActions = hasOutput;
  const snapshotUrl = (data?.previewSnapshotUrl || '').trim();
  const inputStillUrl = (data?.inputImageUrl || '').trim();

  const capturePreviewFrame = useCallback(() => {
    const frame = captureRef.current?.();
    if (!frame) return null;
    setFreezeFrameUrl(frame);
    onDataChange?.(id, { previewSnapshotUrl: frame });
    return frame;
  }, [id, onDataChange]);

  /** 离开节点时可选截帧，供持久化缩略图（展示始终用实时 WebGL，不再切静态图） */
  const handleNodeBodyMouseLeave = useCallback(() => {
    if (selected && hasOutput && !fullscreen && !isGenerating) {
      capturePreviewFrame();
    }
  }, [selected, hasOutput, fullscreen, isGenerating, capturePreviewFrame]);

  /** 画布预览：有结果时也常驻 WebGL（含地面网格），不因悬停/失焦切到无网格静态截图 */
  const mountWebGL = !fullscreen && !isGenerating;

  const persistPreviewSnapshot = useCallback(() => {
    const dataUrl = captureRef.current?.();
    if (!dataUrl) return;
    onDataChange?.(id, { previewSnapshotUrl: dataUrl });
  }, [id, onDataChange]);

  const schedulePersistPreviewSnapshot = useCallback(() => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        persistPreviewSnapshot();
      });
    });
  }, [persistPreviewSnapshot]);

  const glbKey = `${previewGlbUrl}|${previewTextureUrl}`;

  useEffect(() => {
    if (previewGlbUrl) preloadGlbPreviewUrl(previewGlbUrl);
  }, [previewGlbUrl]);

  /** Trellis2：工作流未单独输出 base_color PNG，从本地 GLB 内嵌贴图提取并用于预览 */
  useEffect(() => {
    if (!hasOutput || resultTextureUrl) {
      setEmbeddedTextureUrl('');
      return;
    }
    const api = window.electronAPI?.ensureImageTo3dLocalTexture;
    if (!api) return;
    let cancelled = false;
    void api({
      glbLocalPath: data?.localGlbPath,
      glbResourceUrl: previewGlbUrl,
    }).then((r) => {
      if (cancelled || !r?.textureLocalUrl) return;
      setEmbeddedTextureUrl(r.textureLocalUrl);
      onDataChange?.(id, {
        resultTextureUrl: r.textureLocalUrl,
        localTexturePath: r.textureLocalPath,
      });
    });
    return () => {
      cancelled = true;
    };
  }, [hasOutput, resultTextureUrl, data?.localGlbPath, previewGlbUrl, id, onDataChange]);

  useEffect(() => {
    if (selected && previewGlbUrl) preloadGlbPreviewUrl(previewGlbUrl);
  }, [selected, previewGlbUrl]);

  useEffect(() => {
    if (prevGlbKeyRef.current && prevGlbKeyRef.current !== glbKey) {
      setFreezeFrameUrl(null);
      if (data?.previewSnapshotUrl) {
        onDataChange?.(id, { previewSnapshotUrl: undefined });
      }
    }
    prevGlbKeyRef.current = glbKey;
  }, [glbKey, data?.previewSnapshotUrl, id, onDataChange]);

  useEffect(() => {
    const wasSelected = prevSelectedRef.current;
    if (wasSelected && !selected && hasOutput && !fullscreen && !isGenerating) {
      capturePreviewFrame() || schedulePersistPreviewSnapshot();
    }
    prevSelectedRef.current = !!selected;
  }, [
    selected,
    hasOutput,
    fullscreen,
    isGenerating,
    capturePreviewFrame,
    schedulePersistPreviewSnapshot,
  ]);

  /** 生成结束且仍选中时预截一帧，便于随后失焦即可展示 */
  useEffect(() => {
    const generationJustEnded = wasGeneratingRef.current && !isGenerating;
    wasGeneratingRef.current = isGenerating;
    if (!generationJustEnded || !hasOutput || !selected || !mountWebGL) return;
    const timer = window.setTimeout(schedulePersistPreviewSnapshot, 1500);
    return () => window.clearTimeout(timer);
  }, [isGenerating, hasOutput, selected, mountWebGL, schedulePersistPreviewSnapshot]);

  const frozenSnapshotUrl = (freezeFrameUrl || snapshotUrl || '').trim();
  /** 始终用实时 WebGL（图一：模型+地面网格），不再用无网格静态截图顶替 */
  const showFrozenSnapshot = false;
  const showInputStill =
    !mountWebGL &&
    hasOutput &&
    !frozenSnapshotUrl &&
    !!inputStillUrl &&
    !isGenerating;
  const showLiveGlbPreview = mountWebGL && hasOutput;

  const liveZoom = useFrozenFlowZoom(1);
  // 镜头拉远：随画布缩小；拉近：反缩放，避免操作栏撑满屏幕
  const zoomInv = useMemo(() => {
    const z = Math.max(liveZoom || 1, 0.01);
    const raw = Math.min(1, 1 / z);
    return Math.round(raw * 50) / 50;
  }, [liveZoom]);
  const imageTo3dPromptAnchor = useImageTo3dInputPanelAnchor();
  const showImageTo3dPromptPanel =
    !!imageTo3dPromptAnchor && imageTo3dPromptAnchor.nodeId === id && !!selected && !fullscreen;

  return (
    <>
      <div
        data-id={id}
        className={`custom-node-container group relative rounded-2xl overflow-visible ${panelBg} transition-all duration-200 ${
          selected
            ? isDarkMode
              ? 'ring-2 ring-green-400/80'
              : 'ring-2 ring-green-500'
            : ''
        }`}
        style={{ width: w, height: h, minHeight: h }}
      >
        {/* 磁吸「+」在节点外侧渲染，外层必须 overflow-visible（与 Image/Video 节点一致） */}
        <Handle
          type="target"
          position={Position.Left}
          id="input"
          style={{ top: '50%' }}
          className="nexflow-plus-handle nexflow-plus-handle-left"
          title={t.refImageLabel}
        />
        <Handle
          type="source"
          position={Position.Right}
          id="output"
          style={{ top: '50%', right: 0 }}
          className="nexflow-plus-handle nexflow-plus-handle-right"
        />

        <div
          className="node-body absolute inset-0 rounded-2xl overflow-hidden"
          style={panelStyle}
          onMouseLeave={handleNodeBodyMouseLeave}
        >
          {showFrozenSnapshot ? (
            <img
              src={frozenSnapshotUrl}
              alt=""
              className="absolute inset-0 z-[3] h-full w-full object-contain bg-[#1a1a1e] pointer-events-none select-none"
              draggable={false}
            />
          ) : null}
          {showInputStill ? (
            <img
              src={inputStillUrl}
              alt=""
              className="absolute inset-0 z-[1] h-full w-full object-contain bg-[#1a1a1e] opacity-70 pointer-events-none select-none"
              draggable={false}
            />
          ) : null}
          <ErrorBoundary
            fallback={
              <GlbViewerPlaceholder
                className="absolute inset-0 w-full h-full"
                message={t.webglUnavailable}
                subMessage={t.webglUnavailableHint}
              />
            }
          >
            {showLiveGlbPreview ? (
              <div
                className="absolute inset-0 z-[2] h-full w-full min-h-0 min-w-0 nodrag nopan nowheel"
                title={t.rotateHint}
              >
                <ImageTo3dInlineGlbPreview
                  glbUrl={previewGlbUrl}
                  textureUrl={previewTextureUrl}
                  placeholderImageUrl={inputStillUrl}
                  previewKey={id}
                  // 鼠标在节点内时，优先显示 3D 模型，不显示参考图占位
                  showReferencePlaceholder={false}
                  wrapperClassName="absolute inset-0 h-full w-full min-h-0 min-w-0"
                  className="absolute inset-0 h-full w-full"
                  cameraFraming={IMAGE_TO_3D_PREVIEW_CAMERA_FRAMING}
                  gridStyle="showcase"
                  showGrid
                  turntableRotate={false}
                  turntableSpeed={Math.PI / 12}
                  useStudioEnvironment={false}
                  showFog={false}
                  enabled
                  renderActive
                  captureRef={captureRef}
                  showGridWhenEmpty
                  showGizmo={false}
                  controlsInteractive
                />
              </div>
            ) : (
              <GlbModelViewer
                url={previewGlbUrl}
                overrideTextureUrl={previewTextureUrl}
                className={`absolute inset-0 w-full h-full ${showFrozenSnapshot ? 'opacity-0 pointer-events-none' : ''}`}
                showGridWhenEmpty
                enabled={mountWebGL}
                renderActive={mountWebGL}
                captureRef={captureRef}
                cameraFraming={IMAGE_TO_3D_PREVIEW_CAMERA_FRAMING}
                gridStyle="showcase"
                useStudioEnvironment={false}
                showFog={false}
                placeholderMessage={
                  !mountWebGL && hasOutput && !showFrozenSnapshot && !showInputStill
                    ? t.selectToPreview3d
                    : undefined
                }
                placeholderSubMessage={
                  !mountWebGL && hasOutput && !showFrozenSnapshot && !showInputStill
                    ? t.webglUnavailableHint
                    : undefined
                }
              />
            )}
          </ErrorBoundary>

          <ModuleProgressBar
            visible={isGenerating}
            progress={progress}
            solidBackground={isDarkMode ? '#1C1C1E' : '#f5f5f5'}
            progressMessage={isGenerating ? (data?.progressMessage || t.generating) : undefined}
            borderRadius={16}
            onFadeComplete={() => onDataChange?.(id, { progress: 0, progressMessage: '' })}
          />

          {showCornerActions && (
            <>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  void handleSaveToLibrary();
                }}
                onMouseDown={(e) => {
                  e.stopPropagation();
                  e.preventDefault();
                }}
                disabled={savingToLibrary || saving}
                className={`nodrag absolute top-2 left-2 p-1.5 rounded-lg transition-all z-10 ${
                  savedToLibrary
                    ? isDarkMode
                      ? 'apple-panel bg-emerald-500/25 ring-1 ring-emerald-400/50'
                      : 'apple-panel-light bg-emerald-100/80 ring-1 ring-emerald-500/40'
                    : isDarkMode
                      ? 'apple-panel hover:bg-white/20'
                      : 'apple-panel-light hover:bg-gray-200/30'
                } disabled:opacity-40`}
                style={{ pointerEvents: 'all' }}
                title={savedToLibrary ? t.saveToLibraryAlready : t.saveToLibrary}
                aria-label={t.saveToLibrary}
              >
                {savedToLibrary ? (
                  <Check className={`w-3.5 h-3.5 ${isDarkMode ? 'text-emerald-300' : 'text-emerald-700'}`} />
                ) : (
                  <Save className={`w-3.5 h-3.5 ${isDarkMode ? 'text-white/80' : 'text-gray-700'}`} />
                )}
              </button>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  handleDownload();
                }}
                onMouseDown={(e) => {
                  e.stopPropagation();
                  e.preventDefault();
                }}
                disabled={saving || savingToLibrary}
                className={`nodrag absolute top-2 left-11 p-1.5 rounded-lg transition-all z-10 ${
                  isDarkMode ? 'apple-panel hover:bg-white/20' : 'apple-panel-light hover:bg-gray-200/30'
                } disabled:opacity-40`}
                style={{ pointerEvents: 'all' }}
                title={t.download}
                aria-label={t.download}
              >
                <Download className={`w-3.5 h-3.5 ${isDarkMode ? 'text-white/80' : 'text-gray-700'}`} />
              </button>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  capturePreviewFrame() || persistPreviewSnapshot();
                  setFullscreen(true);
                }}
                onMouseDown={(e) => {
                  e.stopPropagation();
                  e.preventDefault();
                }}
                className={`nodrag absolute top-2 right-2 p-1.5 rounded-lg transition-all z-10 ${
                  isDarkMode ? 'apple-panel hover:bg-white/20' : 'apple-panel-light hover:bg-gray-200/30'
                }`}
                style={{ pointerEvents: 'all' }}
                title={t.preview}
                aria-label={t.preview}
              >
                <Maximize2 className={`w-3.5 h-3.5 ${isDarkMode ? 'text-white/80' : 'text-gray-700'}`} />
              </button>
            </>
          )}
        </div>

        {/* 对齐 Image/Video：操作台贴主模块下方，随节点平移/缩放 */}
        {showImageTo3dPromptPanel && imageTo3dPromptAnchor ? (
          <div
            className="image-to-3d-text-prompt-panel nodrag nopan absolute z-[60]"
            style={{
              top: 'calc(100% + 8px)',
              left: '50%',
              width: imageTo3dPromptAnchor.width,
              height: imageTo3dPromptAnchor.height === 'auto' ? 'auto' : imageTo3dPromptAnchor.height,
              transform: `translateX(-50%) scale(${zoomInv})`,
              transformOrigin: 'top center',
              pointerEvents: 'auto',
              transition: 'none',
            }}
            onPointerDown={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
            onWheel={(e) => e.stopPropagation()}
          >
            {imageTo3dPromptAnchor.panel}
          </div>
        ) : null}
      </div>

      {fullscreen && hasOutput && (
        <ImageTo3dFullscreenView
          glbUrl={previewGlbUrl}
          overrideTextureUrl={previewTextureUrl}
          referenceImageUrl={inputStillUrl}
          topOffset={workspaceHeaderBottom}
          onClose={() => setFullscreen(false)}
          onDownload={handleDownload}
          onSaveToLibrary={handleSaveToLibrary}
          downloading={saving}
          savingToLibrary={savingToLibrary}
          savedToLibrary={savedToLibrary}
        />
      )}

      {downloadNotice
        ? createPortal(
            <div
              className={`fixed bottom-24 left-1/2 z-[10050] flex max-w-[min(92vw,28rem)] -translate-x-1/2 items-start gap-3 rounded-lg border border-white/15 border-l-4 px-4 py-3 text-sm text-white shadow-xl backdrop-blur-md ${
                downloadNotice.variant === 'success'
                  ? 'border-l-emerald-500 bg-emerald-950/90'
                  : 'border-l-red-500 bg-red-950/90'
              }`}
              role="alert"
            >
              <p className="flex-1 whitespace-pre-line leading-snug pt-0.5">{downloadNotice.message}</p>
            </div>,
            document.body,
          )
        : null}
    </>
  );
};

export default ImageTo3dNode;
