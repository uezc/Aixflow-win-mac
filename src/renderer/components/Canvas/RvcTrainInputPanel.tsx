// @ts-nocheck
import React, { useCallback, useMemo } from 'react';
import { Play, Mic, Check, Upload, Layers, User } from 'lucide-react';
import { useAI } from '../../hooks/useAI';
import { useDarkAlert } from '../../contexts/DarkAlertContext';
import { isModelNotPricedError } from '../../utils/priceCalc';
import { getAudioDisplayPrice } from '../../utils/cloudModelPricing';
import { useNxModelPricing } from '../../contexts/NxModelPricingContext';
import { useAppLocale } from '../../contexts/AppLocaleContext';
import { RVC_VOICE_TRAIN_MODEL_ID } from '../../utils/audioRvcTrainModel';
import { isRvcModelPackageUrl } from '../../../shared/rvcVoiceTrainUtils';
import { rvcTrainT } from '../../i18n/rvcTrainI18n';
import { canvasBottomInputPanelShell } from '../../theme/canvasBottomInputPanel';
import { promptNxSaasLoginIfNeeded } from '../../utils/cloudAiGateMessage';
import { ensureOssAudioUrlForRhTrain, normalizeLocalAudioPathUrl } from '../../utils/rvcTrainAudioUrl';
import {
  assetLibBtnPrimary,
  assetLibEditModalCanvasPickScratch,
  assetLibEditModalSecondaryActionScratch,
} from '../../utils/assetLibraryChrome';

function pathToPreviewUrl(filePath: string): string {
  const normalized = filePath.replace(/\\/g, '/').replace(/^\/[a-zA-Z]:/, (m) => m.substring(1));
  return `local-resource://${normalized}`;
}

export interface RvcTrainInputPanelProps {
  nodeId: string;
  isDarkMode: boolean;
  rvcTrainModelName?: string;
  referenceAudioUrl?: string;
  libraryAvatarUrl?: string;
  projectId?: string;
  onStart?: () => void;
  onRvcTrainModelNameChange?: (value: string) => void;
  onReferenceAudioUrlChange?: (url: string) => void;
  onLibraryAvatarUrlChange?: (url: string) => void;
  onError?: (message: string) => void;
  /** 从画布点选图片作为音色头像 */
  requestAvatarPickFromCanvas?: () => Promise<string | null>;
}

const RvcTrainInputPanel: React.FC<RvcTrainInputPanelProps> = ({
  nodeId,
  isDarkMode,
  rvcTrainModelName = '',
  referenceAudioUrl = '',
  libraryAvatarUrl = '',
  projectId,
  onStart,
  onRvcTrainModelNameChange,
  onReferenceAudioUrlChange,
  onLibraryAvatarUrlChange,
  onError,
  requestAvatarPickFromCanvas,
}) => {
  const { locale } = useAppLocale();
  const t = rvcTrainT(locale);
  const { showAlert } = useDarkAlert();
  const { cloudMap } = useNxModelPricing();

  const { status: aiStatus, execute: executeAI } = useAI({
    nodeId,
    modelId: 'audio',
    onStatusUpdate: (packet) => {
      if (packet.status === 'SUCCESS') {
        const modelUrl =
          packet.payload?.outputModelUrl ||
          (isRvcModelPackageUrl(String(packet.payload?.audioUrl ?? '')) ? packet.payload?.audioUrl : undefined) ||
          (isRvcModelPackageUrl(String(packet.payload?.url ?? '')) ? packet.payload?.url : undefined);
        if (modelUrl) return;
      } else if (packet.status === 'ERROR') {
        const errorMessage = packet.payload?.error || t.noTrainAudio;
        if ((packet.payload as { balanceInsufficient?: boolean } | undefined)?.balanceInsufficient === true) {
          showAlert('余额不足\n\n您的账户余额不足以完成此次操作，请前往设置页面充值后再试。');
        }
        promptNxSaasLoginIfNeeded(errorMessage, (packet.payload as { nxAuthRequired?: boolean })?.nxAuthRequired);
        onError?.(errorMessage);
      }
    },
    onComplete: (result) => {
      const modelUrl =
        result?.outputModelUrl ||
        (isRvcModelPackageUrl(String(result?.url ?? '')) ? result?.url : undefined) ||
        (isRvcModelPackageUrl(String(result?.audioUrl ?? '')) ? result?.audioUrl : undefined);
      if (modelUrl) return;
    },
    onError: (error) => {
      const msg = typeof error === 'string' ? error : error?.message || String(error);
      promptNxSaasLoginIfNeeded(msg);
      onError?.(msg);
    },
  });

  const connected = !!(referenceAudioUrl || '').trim();
  const hasAvatar = !!(libraryAvatarUrl || '').trim();
  const canRun = connected && !!(rvcTrainModelName || '').trim() && aiStatus !== 'PROCESSING';
  const isBusy = aiStatus === 'PROCESSING' || aiStatus === 'START';

  const priceLabel = useMemo(() => {
    try {
      return getAudioDisplayPrice(RVC_VOICE_TRAIN_MODEL_ID, cloudMap);
    } catch (e) {
      if (isModelNotPricedError(e)) return null;
      throw e;
    }
  }, [cloudMap]);

  const handleExecute = useCallback(async () => {
    if (!connected) {
      onError?.(t.noTrainAudio);
      return;
    }
    if (!(rvcTrainModelName || '').trim()) {
      onError?.(t.noModelName);
      return;
    }
    onStart?.();
    try {
      let refUrl = normalizeLocalAudioPathUrl((referenceAudioUrl || '').trim());
      refUrl = await ensureOssAudioUrlForRhTrain(refUrl);
      if (refUrl !== (referenceAudioUrl || '').trim()) {
        onReferenceAudioUrlChange?.(refUrl);
      }
      await executeAI({
        model: RVC_VOICE_TRAIN_MODEL_ID,
        referenceAudioUrl: refUrl,
        rvcTrainModelName: (rvcTrainModelName || '').trim(),
        text: '',
        projectId,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      promptNxSaasLoginIfNeeded(msg);
      onError?.(msg);
    }
  }, [
    connected,
    executeAI,
    onError,
    onReferenceAudioUrlChange,
    onStart,
    projectId,
    referenceAudioUrl,
    rvcTrainModelName,
    t,
  ]);

  const handlePickAvatar = useCallback(async () => {
    const pick = await window.electronAPI?.pickRvcVoiceAvatar?.();
    if (pick && !pick.canceled && pick.filePath) {
      onLibraryAvatarUrlChange?.(pathToPreviewUrl(pick.filePath));
    }
  }, [onLibraryAvatarUrlChange]);

  const handlePickAvatarFromCanvas = useCallback(async () => {
    if (!requestAvatarPickFromCanvas) return;
    try {
      const url = await requestAvatarPickFromCanvas();
      if (url?.trim()) onLibraryAvatarUrlChange?.(url.trim());
    } catch {
      /* ignore */
    }
  }, [requestAvatarPickFromCanvas, onLibraryAvatarUrlChange]);

  return (
    <div className={canvasBottomInputPanelShell(isDarkMode)}>
      <div
        className={`flex items-center justify-between px-2 py-1.5 border-b flex-shrink-0 gap-2 ${
          isDarkMode ? 'border-gray-700/50' : 'border-gray-300/50'
        }`}
      >
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <span className={`text-xs font-semibold shrink-0 ${isDarkMode ? 'text-white/85' : 'text-gray-900'}`}>
            {t.moduleTitle}
          </span>
          <label className={`text-xs font-medium whitespace-nowrap shrink-0 ${isDarkMode ? 'text-white/80' : 'text-gray-900'}`}>
            {t.modelNameLabel}
          </label>
          <input
            type="text"
            value={rvcTrainModelName}
            onChange={(e) => onRvcTrainModelNameChange?.(e.target.value)}
            placeholder={t.modelNamePlaceholder}
            className={`flex-1 min-w-0 px-2 py-1.5 rounded-lg text-xs ${
              isDarkMode ? 'bg-black/30 text-white border border-gray-600/50 placeholder:text-white/40' : 'bg-white/90 text-gray-900 border border-gray-300 placeholder:text-gray-500'
            } outline-none focus:ring-2 focus:ring-violet-500/50`}
          />
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {priceLabel != null ? (
            <span
              className={`w-24 text-center text-xs font-medium px-2 py-1 rounded ${
                isDarkMode ? 'text-yellow-200 bg-yellow-500/25' : 'text-yellow-700 bg-yellow-100'
              }`}
              title={t.priceTitle}
            >
              {priceLabel}
              {locale === 'en' ? ' ' : ''}
              {t.creditsSuffix}
            </span>
          ) : (
            <span
              className={`w-24 text-center text-xs font-medium px-2 py-1 rounded ${
                isDarkMode ? 'text-white/45 bg-white/10' : 'text-gray-500 bg-gray-100'
              }`}
            >
              {t.noPricingYet}
            </span>
          )}
          <button
            type="button"
            onClick={handleExecute}
            disabled={!canRun}
            className={`px-4 py-1.5 rounded-lg text-xs font-medium flex items-center gap-1.5 transition-all ${
              !canRun
                ? 'bg-gray-500/50 text-white/50 cursor-not-allowed'
                : isBusy
                  ? 'bg-violet-500 text-white'
                  : 'bg-violet-500 text-white hover:bg-violet-600 shadow-md shadow-violet-500/30'
            }`}
          >
            {isBusy ? (
              <>
                <div className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" />
                {t.training}
              </>
            ) : (
              <>
                <Play className="w-3 h-3" />
                {t.startTrain}
              </>
            )}
          </button>
        </div>
      </div>

      <div className="flex-1 min-h-0 p-3 flex flex-row gap-2.5">
        {/* 左：头像上传 */}
        <div
          className={`flex flex-1 min-w-0 flex-col items-center justify-center gap-1.5 rounded-xl border px-3 py-3 transition-colors ${
            hasAvatar
              ? isDarkMode
                ? 'border-violet-500/40 bg-violet-500/10'
                : 'border-violet-300/80 bg-violet-50/90'
              : isDarkMode
                ? 'border-white/12 bg-black/30'
                : 'border-gray-300/80 bg-gray-50/90'
          }`}
        >
          {hasAvatar ? (
            <img
              src={libraryAvatarUrl}
              alt=""
              className="w-12 h-12 rounded-full object-cover border-2 border-violet-400/40"
              draggable={false}
            />
          ) : (
            <div
              className={`flex h-12 w-12 items-center justify-center rounded-full ${
                isDarkMode ? 'bg-violet-500/15 text-violet-300/60' : 'bg-violet-100 text-violet-400'
              }`}
            >
              <User className="h-5 w-5" />
            </div>
          )}
          <span className={`text-sm font-medium ${isDarkMode ? 'text-white/85' : 'text-gray-800'}`}>{t.avatarLabel}</span>
          <div className="flex w-full flex-col gap-1.5 px-1">
            <button
              type="button"
              onClick={() => void handlePickAvatar()}
              className={assetLibBtnPrimary(
                isDarkMode,
                'w-full text-xs !px-2.5 !py-1.5 gap-1 justify-center',
                assetLibEditModalSecondaryActionScratch(isDarkMode),
              )}
            >
              <Upload className="w-3.5 h-3.5 shrink-0" />
              {t.uploadAvatarLocal}
            </button>
            {requestAvatarPickFromCanvas ? (
              <button
                type="button"
                onClick={() => void handlePickAvatarFromCanvas()}
                className={assetLibBtnPrimary(
                  isDarkMode,
                  'w-full text-xs !px-2.5 !py-1.5 gap-1 justify-center',
                  assetLibEditModalCanvasPickScratch(isDarkMode, 0),
                )}
              >
                <Layers className="w-3.5 h-3.5 shrink-0" />
                {t.pickAvatarFromCanvas}
              </button>
            ) : null}
          </div>
        </div>

        {/* 右：训练音频 */}
        <div
          className={`flex flex-1 min-w-0 flex-col items-center justify-center gap-1.5 rounded-xl border transition-colors ${
            connected
              ? isDarkMode
                ? 'border-emerald-500/45 bg-emerald-500/10'
                : 'border-emerald-400/70 bg-emerald-50/90'
              : isDarkMode
                ? 'border-white/12 bg-black/30'
                : 'border-gray-300/80 bg-gray-50/90'
          }`}
        >
          <div
            className={`flex h-12 w-12 items-center justify-center rounded-full ${
              connected
                ? isDarkMode
                  ? 'bg-emerald-500/20 text-emerald-400'
                  : 'bg-emerald-100 text-emerald-600'
                : isDarkMode
                  ? 'bg-white/5 text-white/30'
                  : 'bg-gray-200/80 text-gray-400'
            }`}
          >
            <Mic className="h-5 w-5" strokeWidth={2} />
          </div>
          <span className={`text-sm font-medium ${isDarkMode ? 'text-white/85' : 'text-gray-800'}`}>{t.trainAudioLabel}</span>
          <span
            className={`inline-flex items-center gap-0.5 text-xs font-medium ${
              connected
                ? isDarkMode
                  ? 'text-emerald-400'
                  : 'text-emerald-600'
                : isDarkMode
                  ? 'text-white/40'
                  : 'text-gray-400'
            }`}
          >
            {connected ? (
              <>
                <Check className="h-3.5 w-3.5" strokeWidth={2.5} />
                {t.slotConnected}
              </>
            ) : (
              t.slotPending
            )}
          </span>
        </div>
      </div>
    </div>
  );
};

export default RvcTrainInputPanel;
