// @ts-nocheck
import React, { useCallback, useMemo, useRef, useState } from 'react';
import { Play, Upload } from 'lucide-react';
import { useAppLocale } from '../../contexts/AppLocaleContext';
import { imageTo3dT } from '../../i18n/imageTo3dI18n';
import { useNxModelPricing } from '../../contexts/NxModelPricingContext';
import { getImageTo3dDisplayPrice } from '../../utils/cloudModelPricing';
import { importImageTo3dAssetsToCharacters } from '../../utils/importImageTo3dAsset';
import { preloadGlbPreviewUrl } from '../../utils/glbPreviewPreload';
import type { Character } from '../characterListShared';
import { canvasBottomInputPanelShell } from '../../theme/canvasBottomInputPanel';

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
}

const REF_PANEL_W = 120;
const INPUT_BOX_HEIGHT = 138;

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
}) => {
  const { locale } = useAppLocale();
  const t = imageTo3dT(locale);
  const { cloudMap } = useNxModelPricing();
  const [processing, setProcessing] = useState(false);
  const uploadInputRef = useRef<HTMLInputElement>(null);
  const priceYuanbao = useMemo(() => getImageTo3dDisplayPrice(cloudMap), [cloudMap]);

  const hasRef = !!inputImageUrl?.trim();
  const hasResultTexture = !!resultTextureUrl?.trim();
  const isRunDisabled = processing || !hasRef;
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
      const res = await window.electronAPI.imageTo3d(src, projectId, nodeId);
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
      onError?.(e?.message || t.failedDefault);
      onProgressChange?.(0, '');
    } finally {
      setProcessing(false);
    }
  }, [inputImageUrl, projectId, nodeId, onStart, onComplete, onError, onProgressChange, t]);

  return (
    <div className={canvasBottomInputPanelShell(isDarkMode)}>
      <div
        className={`flex items-center justify-between px-2 py-1.5 border-b flex-shrink-0 gap-2 ${
          isDarkMode ? 'border-gray-700/50' : 'border-gray-300/50'
        }`}
      >
        <div className="flex items-center gap-1.5 min-w-0">
          {hasRef ? (
            <span
              className={`text-xs font-medium px-2 py-1 rounded flex-shrink-0 ${
                isDarkMode ? 'text-white/80 bg-purple-500/20' : 'text-gray-700 bg-purple-100'
              }`}
            >
              {t.refImagesCount(1)}
            </span>
          ) : (
            <span
              className={`text-xs px-2 py-1 rounded ${isDarkMode ? 'text-white/45 bg-white/10' : 'text-gray-500 bg-gray-100'}`}
            >
              {t.noInput}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
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
            className={`px-2 py-1 rounded-lg text-xs font-medium flex items-center gap-1 transition-all ${
              isDarkMode
                ? 'bg-white/10 text-white/80 hover:bg-white/20 disabled:opacity-40'
                : 'bg-gray-200 text-gray-700 hover:bg-gray-300 disabled:opacity-40'
            }`}
            title={t.uploadRefImage}
          >
            <Upload className="w-3.5 h-3.5" />
            {t.upload}
          </button>
          <span
            className={`text-xs font-medium px-2 py-1 rounded ${
              isDarkMode ? 'text-yellow-200 bg-yellow-500/25' : 'text-yellow-800 bg-yellow-100'
            }`}
          >
            {priceYuanbao}
            {t.creditsSuffix}
          </span>
          <button
            type="button"
            disabled={isRunDisabled}
            onClick={handleGenerate}
            className={`px-3 py-1 rounded-lg text-xs font-medium flex items-center gap-1.5 transition-all ${
              isRunDisabled
                ? 'bg-gray-500/50 text-white/50 cursor-not-allowed'
                : isBusy
                  ? 'bg-cyan-600 text-white'
                  : 'bg-cyan-500 text-white hover:bg-cyan-600 shadow-md shadow-cyan-500/25'
            }`}
          >
            {isBusy ? (
              <>
                <div className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" />
                {progressMessage || t.generating}
              </>
            ) : (
              <>
                <Play className="w-3 h-3" />
                {t.generate}
              </>
            )}
          </button>
        </div>
      </div>

      <div className="p-3 pt-2 flex-1 min-h-0 flex flex-col">
        <div className="flex flex-1 min-h-0 gap-3">
          <div className="flex-1 min-w-0 flex flex-col justify-center">
            {errorMessage && <p className="text-xs text-red-400 leading-relaxed">{errorMessage}</p>}
            {hasOutput && !errorMessage && (
              <p className="text-xs text-emerald-400/90 leading-relaxed">{t.successHint}</p>
            )}
            {!hasOutput && (
              <p className={`text-xs mt-1 ${isDarkMode ? 'text-white/40' : 'text-gray-500'}`}>{t.resultTextureHint}</p>
            )}
            {!errorMessage && !hasOutput && hasRef && (
              <p className={`text-xs ${isDarkMode ? 'text-white/40' : 'text-gray-500'}`}>{t.inputFromEdge}</p>
            )}
            {!errorMessage && !hasOutput && !hasRef && (
              <p className={`text-xs ${isDarkMode ? 'text-white/35' : 'text-gray-500'}`}>{t.noInput}</p>
            )}
          </div>
          <div className="flex flex-shrink-0 gap-2">
            <div
              className={`rounded-lg overflow-hidden flex flex-col ${
                isDarkMode ? 'bg-black/35 border border-gray-600/40' : 'bg-white/80 border border-gray-300'
              }`}
              style={{ width: REF_PANEL_W, height: INPUT_BOX_HEIGHT }}
            >
              <div
                className={`text-[10px] px-2 py-1 flex-shrink-0 ${
                  isDarkMode ? 'text-white/55 bg-black/20' : 'text-gray-600 bg-gray-100'
                }`}
              >
                {t.refImageLabel}
              </div>
              <div className="flex-1 min-h-0 flex items-center justify-center p-1.5">
                {hasRef ? (
                  <img
                    src={formatImagePath(inputImageUrl)}
                    alt=""
                    className="max-w-full max-h-full object-contain rounded"
                    draggable={false}
                  />
                ) : (
                  <span className={`text-[10px] text-center px-1 ${isDarkMode ? 'text-white/30' : 'text-gray-400'}`}>
                    —
                  </span>
                )}
              </div>
            </div>
            <div
              className={`rounded-lg overflow-hidden flex flex-col ${
                isDarkMode ? 'bg-black/35 border border-amber-500/35' : 'bg-white/80 border border-amber-400/60'
              }`}
              style={{ width: REF_PANEL_W, height: INPUT_BOX_HEIGHT }}
            >
              <div
                className={`text-[10px] px-2 py-1 flex-shrink-0 ${
                  isDarkMode ? 'text-amber-200/80 bg-amber-500/15' : 'text-amber-900 bg-amber-100'
                }`}
              >
                {t.resultTextureLabel}
              </div>
              <div className="flex-1 min-h-0 flex items-center justify-center p-1.5">
                {hasResultTexture ? (
                  <img
                    src={formatImagePath(resultTextureUrl)}
                    alt=""
                    className="max-w-full max-h-full object-contain rounded"
                    draggable={false}
                  />
                ) : (
                  <span className={`text-[10px] text-center px-1 ${isDarkMode ? 'text-white/30' : 'text-gray-400'}`}>
                    {hasOutput ? '—' : t.resultTexturePending}
                  </span>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ImageTo3dInputPanel;
