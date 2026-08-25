// @ts-nocheck
import React, { useCallback, useMemo, useRef, useState } from 'react';
import { Play, Upload, Loader2 } from 'lucide-react';
import { useAppLocale } from '../../contexts/AppLocaleContext';
import { imageTo3dT } from '../../i18n/imageTo3dI18n';
import { useNxModelPricing } from '../../contexts/NxModelPricingContext';
import { getImageTo3dDisplayPrice } from '../../utils/cloudModelPricing';
import {
  DEFAULT_IMAGE_TO_3D_MODEL,
  getVisibleImageTo3dModelOptions,
  resolveImageTo3dModelId,
  type ImageTo3dModelId,
} from '../../../shared/imageTo3dModels';
import { importImageTo3dAssetsToCharacters } from '../../utils/importImageTo3dAsset';
import { preloadGlbPreviewUrl } from '../../utils/glbPreviewPreload';
import type { Character } from '../characterListShared';
import { promptNxSaasLoginIfNeeded } from '../../utils/cloudAiGateMessage';
import { AiGenerateDisclaimerTip } from '../legal/AiGenerateDisclaimerTip';
import { PanelOptionDropdown } from './PanelOptionDropdown';

const UPLOAD_ACCEPT = 'image/*,.aixflow,.glb,model/gltf-binary,application/octet-stream';

function isImageTo3dAssetFile(name: string): boolean {
  return /\.(aixflow|glb)$/i.test(name || '');
}

function characterToImportPayload(char: Character) {
  const tex =
    (char.resultTextureUrl || '').trim() ||
    (char.localTexturePath ? formatImagePath(char.localTexturePath) : '');
  const glb =
    (char.localGlbUrl || '').trim() ||
    (char.localGlbPath ? formatImagePath(char.localGlbPath) : '') ||
    (char.remoteGlbUrl || '').trim();
  return {
    inputImageUrl: (char.inputImageUrl || char.avatar || '').trim(),
    outputGlbUrl: glb,
    remoteGlbUrl: char.remoteGlbUrl,
    localGlbPath: char.localGlbPath,
    localGlbUrl: char.localGlbUrl,
    localTexturePath: char.localTexturePath,
    resultTextureUrl: tex || undefined,
    resultTextureRemoteUrl: tex || undefined,
  };
}

export interface ImageTo3dInputPanelProps {
  nodeId: string;
  isDarkMode: boolean;
  inputImageUrl: string;
  model?: string;
  resultTextureUrl?: string;
  projectId?: string;
  errorMessage?: string;
  hasOutput?: boolean;
  progress?: number;
  progressMessage?: string;
  onStart?: () => void;
  onComplete?: (payload: {
    inputImageUrl: string;
    outputGlbUrl: string;
    remoteGlbUrl?: string;
    localGlbPath?: string;
    localGlbUrl?: string;
    localTexturePath?: string;
    resultTextureUrl?: string;
    resultTextureRemoteUrl?: string;
    libraryCharacterId?: string;
  }) => void;
  onError?: (message: string) => void;
  onProgressChange?: (progress: number, message?: string) => void;
  onInputImageChange?: (url: string) => void;
  onModelChange?: (model: ImageTo3dModelId) => void;
}

function formatImagePath(path: string): string {
  if (!path) return '';
  if (
    path.startsWith('http://') ||
    path.startsWith('https://') ||
    path.startsWith('data:') ||
    path.startsWith('blob:') ||
    path.startsWith('local-resource://')
  ) {
    return path;
  }
  let normalizedPath = path.replace(/\\/g, '/');
  if (normalizedPath.match(/^([a-zA-Z])\//)) {
    normalizedPath = normalizedPath[0].toUpperCase() + ':' + normalizedPath.substring(1);
  }
  return `local-resource://${normalizedPath}`;
}

const ImageTo3dInputPanel: React.FC<ImageTo3dInputPanelProps> = ({
  nodeId,
  isDarkMode,
  inputImageUrl,
  model: modelProp,
  resultTextureUrl = '',
  projectId,
  errorMessage,
  hasOutput = false,
  progress: panelProgress = 0,
  progressMessage,
  onStart,
  onComplete,
  onError,
  onProgressChange,
  onInputImageChange,
  onModelChange,
}) => {
  const { locale } = useAppLocale();
  const t = imageTo3dT(locale);
  const { cloudMap } = useNxModelPricing();
  const model = resolveImageTo3dModelId(modelProp || DEFAULT_IMAGE_TO_3D_MODEL);
  const [processing, setProcessing] = useState(false);
  const uploadInputRef = useRef<HTMLInputElement>(null);
  const priceYuanbao = useMemo(() => getImageTo3dDisplayPrice(cloudMap, 1, model), [cloudMap, model]);
  const modelOptions = useMemo(
    () =>
      getVisibleImageTo3dModelOptions().map((opt) => ({
        value: opt.value,
        label:
          (locale === 'en' ? opt.labelEn : opt.labelZh) +
          (opt.plus ? ` (${t.modelPlusBadge})` : ''),
        plus: opt.plus,
      })),
    [locale, t.modelPlusBadge],
  );
  const dropdownOptions = useMemo(
    () => modelOptions.map((o) => ({ value: o.value, label: o.label })),
    [modelOptions],
  );
  const showModelSelect = modelOptions.length > 1;
  const selectedModelMeta = modelOptions.find((o) => o.value === model) ?? modelOptions[0];

  const hasRef = !!inputImageUrl?.trim();
  const hasResultTexture = !!resultTextureUrl?.trim();
  const isRunDisabled = processing || !hasRef || priceYuanbao == null;
  const progress = panelProgress >= 100 ? 0 : panelProgress;
  const isGenerating = progress > 0 && progress < 100;
  const isBusy = processing || isGenerating;

  const importAssetFromPath = useCallback(
    async (filePath: string) => {
      setProcessing(true);
      try {
        const { canceled, characters } = await importImageTo3dAssetsToCharacters({ filePath });
        if (canceled || !characters.length) return;
          const payload = characterToImportPayload(characters[0]);
          if (!payload.outputGlbUrl) {
            onError?.(t.uploadAssetInvalid);
            return;
          }
          onComplete?.({ ...payload, libraryCharacterId: characters[0].id });
        onProgressChange?.(0, '');
      } catch (err: any) {
        if (err?.message && !String(err.message).includes('取消')) {
          onError?.(err.message || t.uploadFailed);
        }
      } finally {
        setProcessing(false);
      }
    },
    [onComplete, onError, onProgressChange, t],
  );

  const uploadImageFromPath = useCallback(
    async (filePath: string) => {
      try {
        const api = window.electronAPI;
        let url = '';
        if (api?.copyFileToProjectAssets && projectId) {
          const { savedPath } = await api.copyFileToProjectAssets(projectId, filePath);
          url = formatImagePath(savedPath);
        } else {
          url = formatImagePath(filePath);
        }
        if (url) onInputImageChange?.(url);
      } catch {
        onError?.(t.uploadFailed);
      }
    },
    [onError, onInputImageChange, projectId, t],
  );

  const handleUploadClick = useCallback(async () => {
    if (window.electronAPI?.pickImageTo3dUpload) {
      try {
        const pick = await window.electronAPI.pickImageTo3dUpload();
        if (pick.canceled || !pick.filePath) return;
        const name = pick.filePath.toLowerCase();
        if (isImageTo3dAssetFile(name)) {
          await importAssetFromPath(pick.filePath);
        } else if (/\.(png|jpe?g|gif|webp|bmp)$/i.test(name)) {
          await uploadImageFromPath(pick.filePath);
        } else {
          onError?.(t.uploadImageOnly);
        }
      } catch {
        onError?.(t.uploadFailed);
      }
      return;
    }
    uploadInputRef.current?.click();
  }, [importAssetFromPath, onError, t, uploadImageFromPath]);

  const handleUploadFile = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (e.target) e.target.value = '';
      if (!file) return;

      const f = file as File & { path?: string };
      const name = (file.name || '').toLowerCase();

      if (isImageTo3dAssetFile(name)) {
        if (!f.path) {
          onError?.(t.notSupported);
          return;
        }
        await importAssetFromPath(f.path);
        return;
      }

      if (!file.type.startsWith('image/') && !/\.(png|jpe?g|gif|webp|bmp)$/i.test(name)) {
        onError?.(t.uploadImageOnly);
        return;
      }
      if (f.path) {
        await uploadImageFromPath(f.path);
        return;
      }
      try {
        const url = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result || ''));
          reader.onerror = () => reject(new Error('read failed'));
          reader.readAsDataURL(file);
        });
        if (url) onInputImageChange?.(url);
      } catch {
        onError?.(t.uploadFailed);
      }
    },
    [importAssetFromPath, onError, onInputImageChange, t, uploadImageFromPath],
  );

  const handleGenerate = useCallback(async () => {
    const src = inputImageUrl?.trim();
    if (!src) {
      onError?.(t.noInput);
      return;
    }
    if (!window.electronAPI?.imageTo3d) {
      onError?.(t.notSupported);
      return;
    }
    setProcessing(true);
    onStart?.();
    onProgressChange?.(5, t.generating);
    try {
      const res = await window.electronAPI.imageTo3d(src, projectId, nodeId, model);
      const glb =
        res.localGlbUrl ||
        (res.localGlbPath ? formatImagePath(res.localGlbPath) : '') ||
        res.glbUrl ||
        res.remoteGlbUrl ||
        '';
      const tex =
        res.resultTextureLocalUrl ||
        res.resultTextureRemoteUrl ||
        '';
      if (glb) preloadGlbPreviewUrl(glb);
      onComplete?.({
        inputImageUrl: src,
        outputGlbUrl: glb,
        remoteGlbUrl: res.remoteGlbUrl || res.glbUrl,
        localGlbPath: res.localGlbPath,
        localGlbUrl: res.localGlbUrl || (res.localGlbPath ? formatImagePath(res.localGlbPath) : ''),
        localTexturePath: res.resultTextureLocalPath,
        resultTextureUrl: tex,
        resultTextureRemoteUrl: res.resultTextureRemoteUrl,
      });
      onProgressChange?.(0, '');
    } catch (e: any) {
      const msg = e?.message || t.failedDefault;
      onError?.(msg);
      onProgressChange?.(0, '');
      promptNxSaasLoginIfNeeded(msg);
    } finally {
      setProcessing(false);
    }
  }, [inputImageUrl, projectId, nodeId, model, onStart, onComplete, onError, onProgressChange, t]);

  return (
    <div className="relative flex w-full flex-col nodrag nopan">
      {/* 无框贴水：弱边框 + 轻玻璃，与视频/图像底栏同系 */}
      <div
        className={[
          'relative flex flex-col overflow-hidden rounded-[18px] transition-colors',
          isDarkMode
            ? 'border border-white/[0.08] bg-[rgba(22,22,26,0.55)] shadow-[0_8px_28px_rgba(0,0,0,0.22)] backdrop-blur-xl'
            : 'border border-black/[0.06] bg-white/70 shadow-[0_8px_24px_rgba(0,0,0,0.06)] backdrop-blur-xl',
          'px-3.5 pt-2.5 pb-2',
        ].join(' ')}
      >
        <AiGenerateDisclaimerTip isDarkMode={isDarkMode} />

        {hasRef ? (
          <div className="mb-1.5 flex flex-wrap items-center gap-1 flex-shrink-0">
            <span
              className={`inline-flex items-center px-1.5 py-0.5 rounded-md text-[11px] font-semibold ${
                isDarkMode ? 'bg-sky-500/25 text-sky-300' : 'bg-sky-100 text-sky-700'
              }`}
              title={t.inputFromEdge}
            >
              @{t.refImagesCount(1)}
            </span>
          </div>
        ) : null}

        {errorMessage ? (
          <p className="mb-1.5 text-[12px] text-red-400 leading-relaxed flex-shrink-0">{errorMessage}</p>
        ) : null}

        {/* 居中双槽：对齐 RVC 翻唱接入区排版 */}
        <div className="w-full max-w-[420px] mx-auto grid grid-cols-2 gap-2 flex-shrink-0">
          <div
            className={`rounded-xl overflow-hidden flex flex-col min-h-[112px] ${
              hasRef
                ? isDarkMode
                  ? 'border border-emerald-500/45 bg-emerald-500/10'
                  : 'border border-emerald-400/70 bg-emerald-50/90'
                : isDarkMode
                  ? 'border border-white/12 bg-black/30'
                  : 'border border-gray-300/80 bg-gray-50/90'
            }`}
          >
            <div
              className={`text-[10px] px-2 py-1 flex-shrink-0 text-center ${
                isDarkMode ? 'text-white/55' : 'text-gray-600'
              }`}
            >
              {t.refImageLabel}
            </div>
            <div className="flex-1 min-h-0 flex items-center justify-center p-2">
              {hasRef ? (
                <img
                  src={formatImagePath(inputImageUrl)}
                  alt=""
                  className="max-w-full max-h-[88px] object-contain rounded"
                  draggable={false}
                />
              ) : (
                <span className={`text-[11px] text-center px-1 ${isDarkMode ? 'text-white/35' : 'text-gray-400'}`}>
                  {t.noInput}
                </span>
              )}
            </div>
          </div>
          <div
            className={`rounded-xl overflow-hidden flex flex-col min-h-[112px] ${
              hasResultTexture
                ? isDarkMode
                  ? 'border border-amber-500/45 bg-amber-500/10'
                  : 'border border-amber-400/70 bg-amber-50/90'
                : isDarkMode
                  ? 'border border-amber-500/30 bg-black/30'
                  : 'border border-amber-400/50 bg-gray-50/90'
            }`}
          >
            <div
              className={`text-[10px] px-2 py-1 flex-shrink-0 text-center ${
                isDarkMode ? 'text-amber-200/80' : 'text-amber-900'
              }`}
            >
              {t.resultTextureLabel}
            </div>
            <div className="flex-1 min-h-0 flex items-center justify-center p-2">
              {hasResultTexture ? (
                <img
                  src={formatImagePath(resultTextureUrl)}
                  alt=""
                  className="max-w-full max-h-[88px] object-contain rounded"
                  draggable={false}
                />
              ) : (
                <span className={`text-[11px] text-center px-1 ${isDarkMode ? 'text-white/35' : 'text-gray-400'}`}>
                  {hasOutput ? '—' : t.resultTexturePending}
                </span>
              )}
            </div>
          </div>
        </div>

        {/* 底栏：与图像/视频同系 — 下拉左、上传+价格+生成右 */}
        <div className="mt-2 flex items-center gap-1.5 flex-shrink-0 min-w-0">
          {showModelSelect ? (
            <div className="flex items-center gap-1 shrink-0">
              <PanelOptionDropdown
                value={model}
                options={dropdownOptions}
                onChange={(v) => {
                  if (isBusy) return;
                  onModelChange?.(resolveImageTo3dModelId(v));
                }}
                isDarkMode={isDarkMode}
                title={selectedModelMeta?.plus ? '48G PLUS 实例' : '24G 默认实例'}
                minWidthPx={88}
                menuPlacement="up"
              />
            </div>
          ) : null}
          <div className="flex-1" />
          <input
            ref={uploadInputRef}
            type="file"
            accept={UPLOAD_ACCEPT}
            className="hidden"
            onChange={handleUploadFile}
          />
          <button
            type="button"
            onClick={() => void handleUploadClick()}
            disabled={processing}
            className={`px-2 py-1 rounded-lg text-xs font-medium flex items-center gap-1 transition-colors shrink-0 ${
              isDarkMode
                ? 'bg-black/30 text-white/80 border border-gray-600/50 hover:bg-black/40 disabled:opacity-40'
                : 'bg-white/90 text-gray-700 border border-gray-300 hover:bg-white disabled:opacity-40'
            }`}
            title={t.uploadRefImage}
          >
            <Upload className="w-3.5 h-3.5" />
            {t.upload}
          </button>
          <span
            className={`text-[11px] font-medium px-2 py-0.5 rounded-full shrink-0 tabular-nums border ${
              isDarkMode
                ? 'text-amber-200/90 bg-amber-500/15 border-amber-400/25'
                : 'text-amber-700 bg-amber-50 border-amber-200'
            }`}
          >
            {priceYuanbao}
            {locale === 'en' ? ' ' : ''}
            {t.creditsSuffix}
          </span>
          <button
            type="button"
            disabled={isRunDisabled}
            onClick={handleGenerate}
            className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 transition-colors ${
              isRunDisabled
                ? isDarkMode
                  ? 'bg-white/[0.08] text-white/25 cursor-not-allowed'
                  : 'bg-black/[0.06] text-gray-400 cursor-not-allowed'
                : isBusy
                  ? 'bg-cyan-500/70 text-white cursor-not-allowed'
                  : 'bg-cyan-500 text-white hover:bg-cyan-600'
            }`}
            title={isBusy ? progressMessage || t.generating : t.generate}
            aria-label={t.generate}
          >
            {isBusy ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Play className="w-3.5 h-3.5" fill="currentColor" />
            )}
          </button>
        </div>
      </div>
    </div>
  );
};

export default ImageTo3dInputPanel;
