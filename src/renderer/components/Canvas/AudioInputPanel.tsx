// @ts-nocheck
import React, { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import { Play, Mic, Loader2, Check, Music2, Package } from 'lucide-react';
import { useReferenceMicRecording, localResourceUrlFromSavedPath } from '../../hooks/useReferenceMicRecording';
import { useAI } from '../../hooks/useAI';
import { useDarkAlert } from '../../contexts/DarkAlertContext';
import { isModelNotPricedError } from '../../utils/priceCalc';
import { getAudioDisplayPrice } from '../../utils/cloudModelPricing';
import { useNxModelPricing } from '../../contexts/NxModelPricingContext';
import { useAppLocale } from '../../contexts/AppLocaleContext';
import { workspaceChromeT } from '../../i18n/workspaceI18n';
import { isAudioSongModel } from '../../utils/audioSongModels';
import { isAudioCoverModel, AI_VOICE_COVER_MODEL_ID, resolveRvcCoverModelPath, clampCoverPitch, clampCoverIndexRate, clampCoverVocalMixPct, clampCoverAccompanimentMixPct } from '../../utils/audioCoverModel';
import { isRvcTrainModel, RVC_VOICE_TRAIN_MODEL_ID } from '../../utils/audioRvcTrainModel';
import { isRvcModelPackageUrl } from '../../../shared/rvcVoiceTrainUtils';
import { rvcVoiceModelPackageUrl } from '../characterListShared';
import {
  filterActiveAudioModelOptions,
  isRetiredAudioModel,
  normalizeAudioModelIfRetired,
} from '../../config/audioModelUiPolicy';
import {
  audioInputPanelT,
  audioVoiceDisplayLabel,
  audioEmotionDisplayLabel,
} from '../../i18n/audioInputPanelI18n';
import { canvasBottomInputPanelShell } from '../../theme/canvasBottomInputPanel';

const baseAudioModelOptions = filterActiveAudioModelOptions([
  { value: 'speech-2.8-hd', label: 'MiniMax 2.8 HD' },
  { value: 'index-tts2', label: 'Index-TTS 2.0' },
  { value: 'rhart-song-v5.5', label: 'SUNO v5.5' },
  { value: AI_VOICE_COVER_MODEL_ID, label: 'RVC 翻唱' },
]);

interface AudioInputPanelProps {
  nodeId: string;
  isDarkMode: boolean;
  text: string;
  model?: string;
  voiceId: string;
  speed: number;
  volume: number;
  pitch: number;
  emotion?: 'happy' | 'sad' | 'angry' | 'fearful' | 'disgusted' | 'surprised' | 'neutral';
  referenceAudioUrl?: string;
  sourceSongAudioUrl?: string;
  coverRhVolume?: number;
  coverPitch?: number;
  coverIndexRate?: number;
  coverVocalMixPct?: number;
  coverAccompanimentMixPct?: number;
  rvcTrainModelName?: string;
  rvcCoverModelName?: string;
  outputModelUrl?: string;
  outputModelRemoteUrl?: string;
  coverReferenceAudioUrl?: string;
  libraryRvcVoiceId?: string;
  songName?: string;
  styleDesc?: string;
  lyrics?: string;
  projectId?: string;
  onStart?: () => void;
  onErrorTask?: (message: string) => void;
  onTextChange: (value: string) => void;
  onModelChange?: (value: string) => void;
  onVoiceIdChange: (value: string) => void;
  onSpeedChange: (value: number) => void;
  onVolumeChange: (value: number) => void;
  onPitchChange: (value: number) => void;
  onEmotionChange?: (value: 'happy' | 'sad' | 'angry' | 'fearful' | 'disgusted' | 'surprised' | 'neutral' | undefined) => void;
  onReferenceAudioUrlChange?: (value: string) => void;
  onSourceSongAudioUrlChange?: (value: string) => void;
  onCoverRhVolumeChange?: (value: number) => void;
  onCoverPitchChange?: (value: number) => void;
  onCoverIndexRateChange?: (value: number) => void;
  onCoverVocalMixPctChange?: (value: number) => void;
  onCoverAccompanimentMixPctChange?: (value: number) => void;
  onRvcTrainModelNameChange?: (value: string) => void;
  onRvcCoverModelNameChange?: (value: string) => void;
  onSongNameChange?: (value: string) => void;
  onStyleDescChange?: (value: string) => void;
  onLyricsChange?: (value: string) => void;
  onOutputAudioChange: (audioUrl: string, originalUrl?: string, outputAudios?: string[], originalOutputAudios?: string[]) => void;
  onRvcTrainComplete?: (payload: {
    outputModelUrl: string;
    outputModelRemoteUrl?: string;
    outputModelLocalPath?: string;
    rvcTrainModelName?: string;
  }) => void;
}

const VOICE_IDS = [
  'Wise_Woman',
  'Friendly_Person',
  'Inspirational_girl',
  'Deep_Voice_Man',
  'Calm_Woman',
  'Casual_Guy',
  'Lively_Girl',
  'Patient_Man',
  'Young_Knight',
  'Determined_Man',
  'Lovely_Girl',
  'Decent_Boy',
  'Imposing_Manner',
  'Elegant_Man',
  'Abbess',
  'Sweet_Girl_2',
  'Exuberant_Girl',
] as const;

const EMOTION_VALUES = ['happy', 'sad', 'angry', 'fearful', 'disgusted', 'surprised', 'neutral'] as const;

const AudioInputPanel: React.FC<AudioInputPanelProps> = ({
  nodeId,
  isDarkMode,
  text,
  model = 'speech-2.8-hd',
  voiceId,
  speed,
  volume,
  pitch,
  emotion,
  referenceAudioUrl = '',
  sourceSongAudioUrl = '',
  coverRhVolume = 5,
  coverPitch = 0,
  coverIndexRate = 0.75,
  coverVocalMixPct = 100,
  coverAccompanimentMixPct = 100,
  rvcTrainModelName = '',
  rvcCoverModelName = '',
  outputModelUrl = '',
  outputModelRemoteUrl = '',
  coverReferenceAudioUrl = '',
  libraryRvcVoiceId = '',
  songName = '',
  styleDesc = '',
  lyrics = '',
  projectId,
  onStart,
  onErrorTask,
  onTextChange,
  onModelChange,
  onVoiceIdChange,
  onSpeedChange,
  onVolumeChange,
  onPitchChange,
  onEmotionChange,
  onReferenceAudioUrlChange,
  onSourceSongAudioUrlChange,
  onCoverRhVolumeChange,
  onCoverPitchChange,
  onCoverIndexRateChange,
  onCoverVocalMixPctChange,
  onCoverAccompanimentMixPctChange,
  onRvcTrainModelNameChange,
  onRvcCoverModelNameChange,
  onSongNameChange,
  onStyleDescChange,
  onLyricsChange,
  onOutputAudioChange,
  onRvcTrainComplete,
}) => {
  const { cloudMap } = useNxModelPricing();
  const { locale } = useAppLocale();
  const at = useMemo(() => audioInputPanelT(locale), [locale]);
  const wc = useMemo(() => workspaceChromeT(locale), [locale]);
  const [micVoiceBusy, setMicVoiceBusy] = useState(false);
  const voiceMergeTargetRef = useRef<'text' | 'lyrics' | 'styleDesc'>('text');
  const isIndexTts2 = model === 'index-tts2';
  const isRhartSong = isAudioSongModel(model);
  const effectiveRvcCoverModel = resolveRvcCoverModelPath({
    rvcCoverModelName,
    rvcTrainModelName,
  });
  const hasRvcCoverModel =
    !!((outputModelUrl || outputModelRemoteUrl || '').trim()) || !!effectiveRvcCoverModel;
  const hasCoverSource = !!(sourceSongAudioUrl || '').trim();
  const isAudioCover = isAudioCoverModel(model);
  const isRvcTrain = isRvcTrainModel(model);

  const audioModelOptions = useMemo(() => baseAudioModelOptions, []);

  useEffect(() => {
    if (!isRetiredAudioModel(model) || !onModelChange) return;
    onModelChange(normalizeAudioModelIfRetired(model));
  }, [model, onModelChange]);

  /** rvcTrain 入边时由 Workspace 写入 model；此处不再按双路 audio 自动切换 */
  const textInputRef = useRef<HTMLTextAreaElement>(null);
  const showAlert = useDarkAlert().showAlert;

  // IME 输入法支持：全能写歌字段在 composition 期间使用本地状态，避免中文输入被打断
  const [songNameComposing, setSongNameComposing] = useState(false);
  const [songNameLocal, setSongNameLocal] = useState('');
  const [styleDescComposing, setStyleDescComposing] = useState(false);
  const [styleDescLocal, setStyleDescLocal] = useState('');
  const [lyricsComposing, setLyricsComposing] = useState(false);
  const [lyricsLocal, setLyricsLocal] = useState('');

  // 本地 text + 防抖：修复输入法（IME）问题，避免每次按键触发父组件重渲染打断中文输入
  const [localText, setLocalText] = useState(text);
  const lastSentTextRef = useRef(text);
  const textDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const prevNodeIdRef = useRef(nodeId);
  const textInputFocusedRef = useRef(false);
  const [textComposing, setTextComposing] = useState(false);
  const [textLocal, setTextLocal] = useState('');

  useEffect(() => {
    const nodeIdChanged = prevNodeIdRef.current !== nodeId;
    prevNodeIdRef.current = nodeId;
    if (nodeIdChanged) {
      if (textDebounceRef.current) {
        clearTimeout(textDebounceRef.current);
        textDebounceRef.current = null;
      }
      textInputFocusedRef.current = false;
      lastSentTextRef.current = text;
      setLocalText(text);
      return;
    }
    if (textInputFocusedRef.current || textDebounceRef.current !== null) return;
    if (text !== lastSentTextRef.current) {
      lastSentTextRef.current = text;
      setLocalText(text);
    }
  }, [text, nodeId]);

  /** rvcTrain 入边或节点已有 RVC 模型包 → 有原曲时自动切翻唱 */
  useEffect(() => {
    if (!onModelChange || isAudioSongModel(model)) return;
    if (hasRvcCoverModel && hasCoverSource && !isAudioCoverModel(model)) {
      onModelChange(AI_VOICE_COVER_MODEL_ID);
    }
  }, [hasRvcCoverModel, hasCoverSource, model, onModelChange]);

  /** 1 路参考音：无台词 → Index-TTS；有 RVC 模型卡时不切训练模块 */
  useEffect(() => {
    const ref = (referenceAudioUrl || '').trim();
    if (!ref || !onModelChange) return;
    if (isAudioSongModel(model) || isAudioCoverModel(model)) return;
    if (hasRvcCoverModel) return;
    if ((sourceSongAudioUrl || '').trim()) return;
    const hasText = localText.trim().length > 0;
    if (!hasText) {
      if (!isRvcTrainModel(model)) onModelChange(RVC_VOICE_TRAIN_MODEL_ID);
      return;
    }
    if (isRvcTrainModel(model)) onModelChange('index-tts2');
  }, [referenceAudioUrl, sourceSongAudioUrl, localText, model, onModelChange, hasRvcCoverModel]);

  useEffect(() => {
    return () => {
      if (textDebounceRef.current) {
        clearTimeout(textDebounceRef.current);
        textDebounceRef.current = null;
      }
    };
  }, []);

  const mergeVoiceIntoText = useCallback(
    (recognized: string) => {
      const t = recognized.trim();
      if (!t) return;
      const prev = localText.trim();
      const next = prev ? `${prev}\n${t}` : t;
      setLocalText(next);
      lastSentTextRef.current = next;
      onTextChange(next);
      textInputRef.current?.focus();
    },
    [localText, onTextChange],
  );

  const mergeVoiceIntoLyrics = useCallback(
    (recognized: string) => {
      const t = recognized.trim();
      if (!t) return;
      const prev = (lyrics || '').trim();
      const next = prev ? `${prev}\n${t}` : t;
      onLyricsChange?.(next);
    },
    [lyrics, onLyricsChange],
  );

  const mergeVoiceIntoStyleDesc = useCallback(
    (recognized: string) => {
      const t = recognized.trim();
      if (!t) return;
      const prev = (styleDesc || '').trim();
      const next = prev ? `${prev} ${t}` : t;
      onStyleDescChange?.(next);
    },
    [styleDesc, onStyleDescChange],
  );

  const runMicTranscribeOnUrl = useCallback(
    async (localResourceUrl: string) => {
      if (!window.electronAPI?.transcribeSpeechFromAudioUrl) {
        showAlert(locale === 'en' ? 'Transcription is not available in this build.' : '当前环境不支持语音转写');
        setMicVoiceBusy(false);
        return;
      }
      setMicVoiceBusy(true);
      try {
        const { text: out } = await window.electronAPI.transcribeSpeechFromAudioUrl(
          projectId || undefined,
          localResourceUrl,
          locale === 'zh' ? 'zh' : locale === 'en' ? 'en' : undefined,
        );
        const recognized = (out || '').trim();
        if (!recognized) {
          showAlert(locale === 'en' ? 'No speech recognized.' : '未识别到文字，请重试。');
          return;
        }
        const target = voiceMergeTargetRef.current;
        if (target === 'lyrics') mergeVoiceIntoLyrics(recognized);
        else if (target === 'styleDesc') mergeVoiceIntoStyleDesc(recognized);
        else mergeVoiceIntoText(recognized);
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        showAlert(msg || (locale === 'en' ? 'Transcription failed.' : '语音识别失败'));
      } finally {
        setMicVoiceBusy(false);
      }
    },
    [locale, mergeVoiceIntoLyrics, mergeVoiceIntoStyleDesc, mergeVoiceIntoText, projectId, showAlert],
  );

  const {
    isRecording: isMicVoiceRecording,
    startReferenceRecording: startMicVoiceRecording,
    stopReferenceRecording: stopMicVoiceRecording,
  } = useReferenceMicRecording({
    projectId,
    onSaved: (url) => {
      void runMicTranscribeOnUrl(url);
    },
    onRecordingFailed: () => {
      setMicVoiceBusy(false);
    },
    showAlert,
    strings: {
      micPermissionDenied: at.micPermissionDenied,
      micSaveFailed: at.micSaveFailed,
      recordTooShort: at.recordTooShort,
      recordModalTitle: wc.textVoiceModalTitle,
      recordModalSubtitle: wc.textVoiceModalSubtitle,
      recordModalStop: at.recordModalStop,
    },
    isDarkMode,
  });

  const handleStopMicVoiceRecording = useCallback(() => {
    setMicVoiceBusy(true);
    stopMicVoiceRecording();
  }, [stopMicVoiceRecording]);

  const handleVoiceInput = useCallback(
    (target: 'text' | 'lyrics' | 'styleDesc') => (e: React.MouseEvent) => {
      e.stopPropagation();
      if (micVoiceBusy) return;
      voiceMergeTargetRef.current = target;
      if (isMicVoiceRecording) {
        handleStopMicVoiceRecording();
        return;
      }
      void startMicVoiceRecording();
    },
    [isMicVoiceRecording, micVoiceBusy, startMicVoiceRecording, handleStopMicVoiceRecording],
  );

  useEffect(() => {
    const open = isMicVoiceRecording || micVoiceBusy;
    (window as Window & { __nexflowVoiceModalOpen?: boolean }).__nexflowVoiceModalOpen = open;
    return () => {
      (window as Window & { __nexflowVoiceModalOpen?: boolean }).__nexflowVoiceModalOpen = false;
    };
  }, [isMicVoiceRecording, micVoiceBusy]);

  const renderVoiceMicButton = (target: 'text' | 'lyrics' | 'styleDesc') => (
    <button
      type="button"
      onClick={handleVoiceInput(target)}
      disabled={micVoiceBusy}
      className={`ml-auto relative flex h-7 w-7 shrink-0 items-center justify-center rounded border transition-colors ${
        micVoiceBusy
          ? isDarkMode
            ? 'cursor-wait border-violet-400/50 bg-violet-500/20 text-violet-200'
            : 'cursor-wait border-violet-400/60 bg-violet-100 text-violet-700'
          : isMicVoiceRecording && voiceMergeTargetRef.current === target
            ? 'border-orange-400/70 bg-orange-500/30 text-orange-100 hover:bg-orange-500/40'
            : isDarkMode
              ? 'border-white/25 bg-white/5 text-white/75 hover:bg-white/10 hover:text-white'
              : 'border-gray-300 bg-white/90 text-gray-600 hover:bg-gray-100'
      }`}
      title={
        micVoiceBusy
          ? at.voiceTranscribing
          : isMicVoiceRecording && voiceMergeTargetRef.current === target
            ? wc.textVoiceInputStopButton
            : wc.textVoiceInputTitle
      }
      aria-label={
        micVoiceBusy
          ? at.voiceTranscribing
          : isMicVoiceRecording && voiceMergeTargetRef.current === target
            ? wc.textVoiceInputStopButton
            : wc.textVoiceInputTitle
      }
    >
      {micVoiceBusy || (isMicVoiceRecording && voiceMergeTargetRef.current === target) ? (
        <Loader2
          className={`relative h-3.5 w-3.5 animate-spin ${isMicVoiceRecording && !micVoiceBusy ? 'text-orange-200' : ''}`}
          strokeWidth={2.25}
        />
      ) : (
        <Mic className="relative h-3.5 w-3.5" strokeWidth={2.25} />
      )}
    </button>
  );

  // AI Hook
  const { status: aiStatus, execute: executeAI } = useAI({
    nodeId,
    modelId: 'audio',
    onStatusUpdate: (packet) => {
      // 处理状态更新
      if (packet.status === 'SUCCESS') {
        const modelUrl =
          packet.payload?.outputModelUrl ||
          (isRvcModelPackageUrl(String(packet.payload?.audioUrl ?? '')) ? packet.payload?.audioUrl : undefined) ||
          (isRvcModelPackageUrl(String(packet.payload?.url ?? '')) ? packet.payload?.url : undefined);
        if (modelUrl && (isRvcTrain || isRvcModelPackageUrl(String(modelUrl)))) {
          onRvcTrainComplete?.({
            outputModelUrl: String(modelUrl),
            outputModelRemoteUrl: packet.payload?.outputModelRemoteUrl as string | undefined,
            outputModelLocalPath: packet.payload?.outputModelLocalPath as string | undefined,
            rvcTrainModelName: packet.payload?.rvcTrainModelName as string | undefined,
          });
          return;
        }
        const audioUrl = packet.payload?.url || packet.payload?.audioUrl;
        const originalUrl = packet.payload?.originalAudioUrl;
        const outputAudiosRaw = Array.isArray(packet.payload?.outputAudios)
          ? packet.payload.outputAudios.filter((u: unknown) => typeof u === 'string' && String(u).trim() !== '')
          : undefined;
        const originalOutputAudiosRaw = Array.isArray(packet.payload?.originalOutputAudios)
          ? packet.payload.originalOutputAudios.filter((u: unknown) => typeof u === 'string' && String(u).trim() !== '')
          : undefined;
        
        if (audioUrl) {
          onOutputAudioChange(audioUrl, originalUrl, outputAudiosRaw, originalOutputAudiosRaw);
        }
      } else if (packet.status === 'ERROR') {
        // 错误处理
        const errorMessage = packet.payload?.error || '音频生成失败';
        if ((packet.payload as { balanceInsufficient?: boolean } | undefined)?.balanceInsufficient === true) {
          showAlert('余额不足\n\n您的账户余额不足以完成此次操作，请前往设置页面充值后再试。');
        }
        if (onErrorTask) {
          onErrorTask(errorMessage);
        }
      }
    },
    onComplete: (result) => {
      if (isRvcTrain) {
        const modelUrl =
          result?.outputModelUrl ||
          (isRvcModelPackageUrl(String(result?.url ?? '')) ? result?.url : undefined) ||
          (isRvcModelPackageUrl(String(result?.audioUrl ?? '')) ? result?.audioUrl : undefined);
        if (modelUrl) return;
      }
      // 优先使用 localPath（如果存在）
      const localPath = result?.localPath;
      let audioUrl = result?.url || result?.audioUrl;
      
      if (localPath) {
        let filePath = localPath.replace(/\\/g, '/');
        if (filePath.match(/^[a-zA-Z]\//)) filePath = filePath[0].toUpperCase() + ':' + filePath.substring(1);
        else if (filePath.match(/^[a-zA-Z]:\//)) filePath = filePath[0].toUpperCase() + filePath.substring(1);
        if (filePath.match(/^\/[a-zA-Z]:/)) filePath = filePath.substring(1);
        audioUrl = `local-resource://${filePath}`;
        console.log('[AudioInputPanel] onComplete 使用本地路径:', localPath, '->', audioUrl);
      }
      
      if (audioUrl) {
        const originalUrl = result?.originalAudioUrl;
        const outputAudiosRaw = Array.isArray(result?.outputAudios)
          ? result.outputAudios.filter((u: unknown) => typeof u === 'string' && String(u).trim() !== '')
          : undefined;
        const originalOutputAudiosRaw = Array.isArray(result?.originalOutputAudios)
          ? result.originalOutputAudios.filter((u: unknown) => typeof u === 'string' && String(u).trim() !== '')
          : undefined;
        onOutputAudioChange(audioUrl, originalUrl, outputAudiosRaw, originalOutputAudiosRaw);
      }
    },
    onError: (error) => {
      console.error('音频生成失败:', error);
      
      // 检测余额不足错误
      const errorMessage = typeof error === 'string' ? error : (error?.message || String(error));
      const isQuotaError = errorMessage.includes('quota is not enough') || 
                          errorMessage.includes('remain quota') ||
                          errorMessage.includes('余额不足');
      
      if (isQuotaError) {
        showAlert('余额不足\n\n您的账户余额不足以完成此次操作，请前往设置页面充值后再试。');
      }
      
      if (onErrorTask) {
        onErrorTask(error);
      }
    },
  });

  const flushTextSync = useCallback(() => {
    if (textDebounceRef.current) {
      clearTimeout(textDebounceRef.current);
      textDebounceRef.current = null;
    }
    if (localText !== lastSentTextRef.current) {
      lastSentTextRef.current = localText;
      onTextChange(localText);
    }
  }, [localText, onTextChange]);

  // 执行音频生成
  const handleExecute = useCallback(async () => {
    flushTextSync();
    const effectiveText = localText.trim();
    if (isRhartSong) {
      if (!(songName ?? '').trim() || !(styleDesc ?? '').trim() || !(lyrics ?? '').trim()) return;
    } else if (isAudioCover) {
      if (!(sourceSongAudioUrl ?? '').trim()) {
        showAlert(at.coverMissingSource);
        return;
      }
      const hasModel =
        !!((outputModelUrl || outputModelRemoteUrl || '').trim()) ||
        !!(libraryRvcVoiceId || '').trim() ||
        !!effectiveRvcCoverModel;
      if (!hasModel) {
        showAlert(at.coverMissingModel);
        return;
      }
    } else if (isRvcTrain) {
      if (!(referenceAudioUrl ?? '').trim() || !(rvcTrainModelName ?? '').trim()) return;
    } else if (!effectiveText) {
      return;
    }

    onStart?.();

    try {
      const requestParams: any = {
        model: isAudioCover ? AI_VOICE_COVER_MODEL_ID : isRvcTrain ? RVC_VOICE_TRAIN_MODEL_ID : model,
        text: isAudioCover || isRvcTrain ? '' : (effectiveText || '').trim(),
        enable_base64_output: false,
        english_normalization: false,
      };
      if (isRhartSong) {
        requestParams.songName = (songName ?? '').trim();
        requestParams.styleDesc = (styleDesc ?? '').trim();
        requestParams.lyrics = (lyrics ?? '').trim();
      } else if (isAudioCover) {
        let srcUrl = (sourceSongAudioUrl || '').trim();
        if (srcUrl.startsWith('local-resource://') || srcUrl.startsWith('file://')) {
          srcUrl = srcUrl.replace(/%5C/gi, '/').replace(/^local-resource:\/\/+/, 'local-resource://').replace(/^file:\/\/+/, 'file://');
        }
        let resolvedOutputModelUrl = (outputModelUrl || '').trim();
        let resolvedOutputModelRemoteUrl = (outputModelRemoteUrl || '').trim();
        const libId = (libraryRvcVoiceId || '').trim();
        if (!resolvedOutputModelUrl && libId && window.electronAPI?.getRvcVoices) {
          try {
            const voices = await window.electronAPI.getRvcVoices();
            const item = (voices as Array<{ id: string }>).find((v) => v.id === libId);
            if (item) {
              resolvedOutputModelUrl = rvcVoiceModelPackageUrl(item as Parameters<typeof rvcVoiceModelPackageUrl>[0]) || '';
              resolvedOutputModelRemoteUrl =
                (item as { originalModelUrl?: string }).originalModelUrl || resolvedOutputModelRemoteUrl;
            }
          } catch {
            /* 主进程补全 */
          }
        }
        requestParams.sourceSongAudioUrl = srcUrl;
        requestParams.rvcCoverModelName = effectiveRvcCoverModel || undefined;
        requestParams.rvcTrainModelName = (rvcTrainModelName || '').trim() || undefined;
        requestParams.outputModelUrl = resolvedOutputModelUrl || undefined;
        requestParams.outputModelRemoteUrl = resolvedOutputModelRemoteUrl || undefined;
        requestParams.libraryRvcVoiceId = libId || undefined;
        requestParams.coverPitch = clampCoverPitch(coverPitch);
        requestParams.coverIndexRate = clampCoverIndexRate(coverIndexRate);
        requestParams.coverVocalMixPct = clampCoverVocalMixPct(coverVocalMixPct);
        requestParams.coverAccompanimentMixPct = clampCoverAccompanimentMixPct(coverAccompanimentMixPct);
      } else if (isRvcTrain) {
        let refUrl = (referenceAudioUrl || '').trim();
        if (refUrl.startsWith('local-resource://') || refUrl.startsWith('file://')) {
          refUrl = refUrl.replace(/%5C/gi, '/').replace(/^local-resource:\/\/+/, 'local-resource://').replace(/^file:\/\/+/, 'file://');
        }
        requestParams.referenceAudioUrl = refUrl;
        requestParams.rvcTrainModelName = (rvcTrainModelName || '').trim();
      } else if (isIndexTts2) {
        let refUrl = (referenceAudioUrl || '').trim();
        if (refUrl.startsWith('local-resource://') || refUrl.startsWith('file://')) {
          refUrl = refUrl.replace(/%5C/gi, '/').replace(/^local-resource:\/\/+/, 'local-resource://').replace(/^file:\/\/+/, 'file://');
        }
        requestParams.referenceAudioUrl = refUrl;
      } else {
        requestParams.voice_id = voiceId;
        requestParams.speed = Math.max(0.5, Math.min(2, speed));
        requestParams.volume = Math.max(0.1, Math.min(10, volume));
        requestParams.pitch = Math.max(-12, Math.min(12, pitch));
        if (emotion) requestParams.emotion = emotion;
      }
      if (projectId) requestParams.projectId = projectId;
      await executeAI(requestParams);
    } catch (error) {
      console.error('音频生成失败:', error);
    }
  }, [flushTextSync, localText, model, isIndexTts2, isAudioCover, isRvcTrain, isRhartSong, songName, styleDesc, lyrics, sourceSongAudioUrl, referenceAudioUrl, effectiveRvcCoverModel, rvcTrainModelName, outputModelUrl, outputModelRemoteUrl, coverReferenceAudioUrl, libraryRvcVoiceId, coverPitch, coverIndexRate, coverVocalMixPct, coverAccompanimentMixPct, voiceId, speed, volume, pitch, emotion, executeAI, onStart, projectId]);

  const isRunDisabled =
    aiStatus === 'PROCESSING' ||
    (isRhartSong
      ? !(songName ?? '').trim() || !(styleDesc ?? '').trim() || !(lyrics ?? '').trim()
      : isAudioCover
        ? !(sourceSongAudioUrl ?? '').trim() ||
          (!hasRvcCoverModel && !(outputModelUrl || outputModelRemoteUrl || '').trim() && !(libraryRvcVoiceId || '').trim())
        : isRvcTrain
          ? !(referenceAudioUrl ?? '').trim() || !(rvcTrainModelName ?? '').trim()
          : !localText.trim() || (isIndexTts2 && !(referenceAudioUrl || '').trim()));

  return (
    <div className={canvasBottomInputPanelShell(isDarkMode, { pad: 'p-4' })}>
      {/* 顶部控制栏 */}
      <div className={`flex items-center justify-between mb-3 flex-shrink-0 gap-3 ${isDarkMode ? 'border-b border-gray-700/30 pb-3' : 'border-b border-gray-300/30 pb-3'}`}>
        <div className="flex items-center gap-3 flex-1 min-w-0">
          <div className="flex items-center gap-1.5 flex-shrink-0">
            <label className={`text-xs font-medium whitespace-nowrap ${isDarkMode ? 'text-white/80' : 'text-gray-900'}`}>
              {at.modelLabel}
            </label>
            <select
              value={model}
              onChange={(e) => onModelChange?.(e.target.value)}
              className={`px-2 py-1.5 rounded-lg text-xs min-w-[140px] ${
                isDarkMode ? 'bg-black/30 text-white border border-gray-600/50' : 'bg-white/90 text-gray-900 border border-gray-300'
              } outline-none focus:ring-2 focus:ring-green-500/50`}
              title={at.chooseModelTitle}
              aria-label={at.chooseModelAria}
            >
              {audioModelOptions.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </div>
          {!isIndexTts2 && !isRhartSong && !isAudioCover && !isRvcTrain && (
            <>
              <div className="flex items-center gap-1.5 flex-shrink-0">
                <label className={`text-xs font-medium whitespace-nowrap ${isDarkMode ? 'text-white/80' : 'text-gray-900'}`}>{at.voiceLabel}</label>
                <select
                  value={voiceId}
                  onChange={(e) => onVoiceIdChange(e.target.value)}
                  className={`px-2 py-1.5 rounded-lg text-xs min-w-[100px] ${isDarkMode ? 'bg-black/30 text-white border border-gray-600/50' : 'bg-white/90 text-gray-900 border border-gray-300'} outline-none focus:ring-2 focus:ring-green-500/50`}
                  title={at.chooseVoiceTitle}
                  aria-label={at.chooseVoiceAria}
                >
                  {VOICE_IDS.map((vid) => (
                    <option key={vid} value={vid}>
                      {audioVoiceDisplayLabel(locale, vid)}
                    </option>
                  ))}
                </select>
              </div>
              {onEmotionChange && (
                <div className="flex items-center gap-1.5 flex-shrink-0">
                  <label className={`text-xs font-medium whitespace-nowrap ${isDarkMode ? 'text-white/80' : 'text-gray-900'}`}>{at.emotionLabel}</label>
                  <select
                    value={emotion || ''}
                    onChange={(e) => onEmotionChange(e.target.value as any || undefined)}
                    className={`px-2 py-1.5 rounded-lg text-xs min-w-[80px] ${isDarkMode ? 'bg-black/30 text-white border border-gray-600/50' : 'bg-white/90 text-gray-900 border border-gray-300'} outline-none focus:ring-2 focus:ring-green-500/50`}
                  >
                    <option value="">{at.emotionNone}</option>
                    {EMOTION_VALUES.map((ev) => (
                      <option key={ev} value={ev}>
                        {audioEmotionDisplayLabel(locale, ev)}
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </>
          )}
          {isIndexTts2 && onReferenceAudioUrlChange && (
            <div className="flex items-center gap-2 flex-1 min-w-0">
              <label className={`text-xs font-medium whitespace-nowrap ${isDarkMode ? 'text-white/80' : 'text-gray-900'}`}>{at.referenceAudioLabel}</label>
              <input
                type="text"
                value={referenceAudioUrl}
                onChange={(e) => onReferenceAudioUrlChange(e.target.value)}
                placeholder={at.referenceAudioPlaceholder}
                title={at.referenceAudioTitle}
                aria-label={at.referenceAudioAria}
                className={`flex-1 min-w-0 px-2 py-1.5 rounded-lg text-xs ${
                  isDarkMode ? 'bg-black/30 text-white border border-gray-600/50 placeholder:text-white/40' : 'bg-white/90 text-gray-900 border border-gray-300 placeholder:text-gray-500'
                } outline-none focus:ring-2 focus:ring-green-500/50`}
              />
              <button
                type="button"
                onClick={async () => {
                  if (typeof window.electronAPI?.showOpenAudioDialog !== 'function') return;
                  const res = await window.electronAPI.showOpenAudioDialog();
                  if (res.success && res.filePath) {
                    onReferenceAudioUrlChange(localResourceUrlFromSavedPath(res.filePath));
                  }
                }}
                title={at.selectFileTitle}
                aria-label={at.selectFileAria}
                className={`px-2 py-1.5 rounded-lg text-xs font-medium flex-shrink-0 transition-colors ${
                  isDarkMode
                    ? 'bg-blue-500/90 text-white border border-blue-400/55 hover:bg-blue-500'
                    : 'bg-blue-500 text-white border border-blue-500 hover:bg-blue-600'
                } outline-none focus:ring-2 focus:ring-blue-400/50`}
              >
                {at.selectFileButton}
              </button>
            </div>
          )}
          {isRvcTrain && onRvcTrainModelNameChange && (
            <div className="flex items-center gap-2 flex-1 min-w-0">
              <label className={`text-xs font-medium whitespace-nowrap shrink-0 ${isDarkMode ? 'text-white/80' : 'text-gray-900'}`}>
                {at.rvcTrainModelLabel}
              </label>
              <input
                type="text"
                value={rvcTrainModelName}
                onChange={(e) => onRvcTrainModelNameChange(e.target.value)}
                placeholder={at.rvcTrainModelPlaceholder}
                className={`flex-1 min-w-0 px-2 py-1.5 rounded-lg text-xs ${
                  isDarkMode ? 'bg-black/30 text-white border border-gray-600/50 placeholder:text-white/40' : 'bg-white/90 text-gray-900 border border-gray-300 placeholder:text-gray-500'
                } outline-none focus:ring-2 focus:ring-green-500/50`}
              />
            </div>
          )}
        </div>

        {/* 右侧：价格 + 运行按钮（与图片模块一致：价格在左、按钮在右） */}
        <div className="flex items-center gap-2 flex-shrink-0">
          {(() => {
            if (!model) return null;
            try {
              if (isAudioCover) {
                return (
                  <span
                    className={`w-24 text-center text-xs font-medium px-2 py-1 rounded ${
                      isDarkMode ? 'text-green-200 bg-green-500/25' : 'text-green-700 bg-green-100'
                    }`}
                    title={at.localCoverFreeTitle}
                  >
                    {at.localCoverFree}
                  </span>
                );
              }
              const price = getAudioDisplayPrice(model, cloudMap);
              return (
                <span
                  className={`w-24 text-center text-xs font-medium px-2 py-1 rounded ${
                    isDarkMode ? 'text-yellow-200 bg-yellow-500/25' : 'text-yellow-700 bg-yellow-100'
                  }`}
                  title={at.priceTitle}
                >
                  {price}
                  {locale === 'en' ? ' ' : ''}
                  {at.creditsSuffix}
                </span>
              );
            } catch (e) {
              if (isModelNotPricedError(e)) {
                return (
                  <span
                    className={`w-24 text-center text-xs font-medium px-2 py-1 rounded ${
                      isDarkMode ? 'text-white/45 bg-white/10' : 'text-gray-500 bg-gray-100'
                    }`}
                    title={at.noPricingTitle}
                  >
                    {at.noPricingYet}
                  </span>
                );
              }
              throw e;
            }
          })()}
          <button
            onClick={handleExecute}
            disabled={isRunDisabled}
            className={`px-4 py-1.5 rounded-lg text-xs font-medium flex items-center gap-1.5 transition-all duration-200 ${
              isRunDisabled
                ? 'bg-gray-500/50 text-white/50 cursor-not-allowed'
                : aiStatus === 'PROCESSING'
                  ? 'bg-green-500 text-white'
                  : 'bg-green-500 text-white hover:bg-green-600 shadow-md shadow-green-500/30'
            }`}
            title={at.generateAudioTitle}
          >
            {aiStatus === 'PROCESSING' ? (
              <>
                <div className={`w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin`} />
                {isRvcTrain ? at.generatingRvcTrain : at.generating}
              </>
            ) : (
              <>
                <Play className="w-3 h-3" />
                {isRvcTrain ? at.generateRvcTrain : at.generateAudio}
              </>
            )}
          </button>
        </div>
      </div>

      {isAudioCover && onCoverPitchChange && (
        <div
          className={`flex flex-wrap items-center gap-x-4 gap-y-2 mb-3 flex-shrink-0 pb-3 ${
            isDarkMode ? 'border-b border-gray-700/30' : 'border-b border-gray-300/30'
          }`}
        >
          <div className="flex items-center gap-2 min-w-[140px] flex-1 max-w-[200px]">
            <label className={`text-xs font-medium whitespace-nowrap shrink-0 ${isDarkMode ? 'text-white/80' : 'text-gray-900'}`}>
              {at.coverPitchLabel(`${clampCoverPitch(coverPitch) > 0 ? '+' : ''}${clampCoverPitch(coverPitch)}`)}
            </label>
            <input
              type="range"
              min={-12}
              max={12}
              step={1}
              value={clampCoverPitch(coverPitch)}
              onChange={(e) => onCoverPitchChange(clampCoverPitch(parseInt(e.target.value, 10)))}
              className="flex-1 min-w-0 h-2 accent-green-500 cursor-pointer"
              title={at.coverPitchTitle}
              aria-label={at.coverPitchTitle}
            />
          </div>
          {onCoverIndexRateChange && (
            <div className="flex items-center gap-2 min-w-[140px] flex-1 max-w-[200px]">
              <label className={`text-xs font-medium whitespace-nowrap shrink-0 ${isDarkMode ? 'text-white/80' : 'text-gray-900'}`}>
                {at.coverIndexRateLabel(String(Math.round(clampCoverIndexRate(coverIndexRate) * 100)))}
              </label>
              <input
                type="range"
                min={0}
                max={100}
                step={5}
                value={Math.round(clampCoverIndexRate(coverIndexRate) * 100)}
                onChange={(e) => onCoverIndexRateChange(clampCoverIndexRate(parseInt(e.target.value, 10) / 100))}
                className="flex-1 min-w-0 h-2 accent-green-500 cursor-pointer"
                title={at.coverIndexRateTitle}
                aria-label={at.coverIndexRateTitle}
              />
            </div>
          )}
        </div>
      )}

      {/* 主要内容区域 - 左右分栏布局 */}
      <div className="flex-1 min-h-0 flex gap-4 overflow-hidden">
        {/* 左侧：文本内容 或 全能写歌（左：歌曲名+风格描述，右：歌词） */}
        {isRhartSong ? (
          <div className="flex-1 min-w-0 min-h-0 flex gap-4 overflow-hidden">
            <div className="w-52 flex-shrink-0 flex flex-col gap-3 overflow-auto custom-scrollbar">
              <div className="flex flex-col flex-shrink-0">
                <label className={`text-xs font-medium mb-1 ${isDarkMode ? 'text-white/80' : 'text-gray-900'}`}>{at.songNameLabel}</label>
                <input
                  type="text"
                  value={songNameComposing ? songNameLocal : songName}
                  onCompositionStart={(e) => {
                    setSongNameComposing(true);
                    setSongNameLocal((e.target as HTMLInputElement).value);
                  }}
                  onCompositionEnd={(e) => {
                    setSongNameComposing(false);
                    onSongNameChange?.((e.target as HTMLInputElement).value);
                  }}
                  onChange={(e) => {
                    const v = e.target.value;
                    if (songNameComposing) setSongNameLocal(v);
                    else onSongNameChange?.(v);
                  }}
                  placeholder={at.songNamePlaceholder}
                  className={`w-full px-3 py-2 rounded-lg text-sm border ${
                    isDarkMode ? 'bg-black/30 text-white border-gray-600/50 placeholder:text-white/40' : 'bg-white/90 text-gray-900 border-gray-300 placeholder:text-gray-500'
                  } outline-none focus:ring-2 focus:ring-green-500/30`}
                  style={{ caretColor: isDarkMode ? '#0A84FF' : '#22c55e' }}
                />
              </div>
              <div className="flex flex-col flex-shrink-0">
                <div className="mb-1 flex items-center gap-2 min-w-0">
                  <label className={`text-xs font-medium shrink-0 ${isDarkMode ? 'text-white/80' : 'text-gray-900'}`}>{at.styleDescLabel}</label>
                  {renderVoiceMicButton('styleDesc')}
                </div>
                <input
                  type="text"
                  value={styleDescComposing ? styleDescLocal : styleDesc}
                  readOnly={micVoiceBusy}
                  disabled={micVoiceBusy}
                  onCompositionStart={(e) => {
                    setStyleDescComposing(true);
                    setStyleDescLocal((e.target as HTMLInputElement).value);
                  }}
                  onCompositionEnd={(e) => {
                    setStyleDescComposing(false);
                    onStyleDescChange?.((e.target as HTMLInputElement).value);
                  }}
                  onChange={(e) => {
                    if (micVoiceBusy) return;
                    const v = e.target.value;
                    if (styleDescComposing) setStyleDescLocal(v);
                    else onStyleDescChange?.(v);
                  }}
                  placeholder={at.styleDescPlaceholder}
                  className={`w-full px-3 py-2 rounded-lg text-sm border ${
                    isDarkMode ? 'bg-black/30 text-white border-gray-600/50 placeholder:text-white/40' : 'bg-white/90 text-gray-900 border-gray-300 placeholder:text-gray-500'
                  } outline-none focus:ring-2 focus:ring-green-500/30 ${micVoiceBusy ? 'opacity-45 cursor-not-allowed' : ''}`}
                  style={{ caretColor: isDarkMode ? '#0A84FF' : '#22c55e' }}
                />
              </div>
            </div>
            <div className="flex-1 min-w-0 min-h-0 flex flex-col">
              <div className="mb-1 flex items-center gap-2 min-w-0 flex-shrink-0">
                <label className={`text-xs font-medium shrink-0 ${isDarkMode ? 'text-white/80' : 'text-gray-900'}`}>{at.lyricsLabel}</label>
                {renderVoiceMicButton('lyrics')}
              </div>
              <textarea
                value={lyricsComposing ? lyricsLocal : lyrics}
                readOnly={micVoiceBusy}
                disabled={micVoiceBusy}
                onCompositionStart={(e) => {
                  setLyricsComposing(true);
                  setLyricsLocal((e.target as HTMLTextAreaElement).value);
                }}
                onCompositionEnd={(e) => {
                  setLyricsComposing(false);
                  onLyricsChange?.((e.target as HTMLTextAreaElement).value);
                }}
                onChange={(e) => {
                  if (micVoiceBusy) return;
                  const v = e.target.value;
                  if (lyricsComposing) setLyricsLocal(v);
                  else onLyricsChange?.(v);
                }}
                placeholder={at.lyricsPlaceholder}
                className={`w-full flex-1 min-h-0 custom-scrollbar resize-none rounded-lg p-3 text-sm border ${
                  isDarkMode ? 'bg-black/30 text-white border-gray-600/50 placeholder:text-white/40' : 'bg-white/90 text-gray-900 border-gray-300 placeholder:text-gray-500'
                } outline-none focus:ring-2 focus:ring-green-500/30 ${micVoiceBusy ? 'opacity-45 cursor-not-allowed' : ''}`}
                style={{ caretColor: isDarkMode ? '#0A84FF' : '#22c55e' }}
              />
            </div>
          </div>
        ) : isRvcTrain ? (
          <div className="flex-1 min-w-0 min-h-0 grid grid-cols-2 gap-2">
            {(() => {
              const connected = !!(referenceAudioUrl || '').trim();
              return (
                <div
                  className={`flex flex-col items-center justify-center gap-2 min-h-[120px] rounded-xl border transition-colors ${
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
                    className={`flex h-11 w-11 items-center justify-center rounded-full ${
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
                  <span className={`text-sm font-medium ${isDarkMode ? 'text-white/85' : 'text-gray-800'}`}>
                    {at.rvcTrainAudioLabel}
                  </span>
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
                        {at.coverSlotConnected}
                      </>
                    ) : (
                      at.coverSlotPending
                    )}
                  </span>
                </div>
              );
            })()}
          </div>
        ) : isAudioCover ? (
          <div className="flex-1 min-w-0 min-h-0 grid grid-cols-2 gap-2">
            {[
              {
                key: 'model',
                label: at.coverRvcModelLabel,
                connected: hasRvcCoverModel,
                Icon: Package,
              },
              {
                key: 'source',
                label: at.coverSourceSongLabel,
                connected: hasCoverSource,
                Icon: Music2,
              },
            ].map(({ key, label, connected, Icon }) => (
              <div
                key={key}
                className={`flex flex-col items-center justify-center gap-1.5 min-h-[96px] rounded-xl border transition-colors ${
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
                  className={`flex h-9 w-9 items-center justify-center rounded-full ${
                    connected
                      ? isDarkMode
                        ? 'bg-emerald-500/20 text-emerald-400'
                        : 'bg-emerald-100 text-emerald-600'
                      : isDarkMode
                        ? 'bg-white/5 text-white/30'
                        : 'bg-gray-200/80 text-gray-400'
                  }`}
                >
                  <Icon className="h-4 w-4" strokeWidth={2} />
                </div>
                <span className={`text-xs font-medium ${isDarkMode ? 'text-white/85' : 'text-gray-800'}`}>{label}</span>
                <span
                  className={`inline-flex items-center gap-0.5 text-[10px] font-medium ${
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
                      <Check className="h-3 w-3" strokeWidth={2.5} />
                      {at.coverSlotConnected}
                    </>
                  ) : (
                    at.coverSlotPending
                  )}
                </span>
              </div>
            ))}
          </div>
        ) : (
        <div className="flex-1 min-w-0 min-h-0 flex flex-col">
          <div className="mb-2 flex items-center gap-2 min-w-0 flex-shrink-0">
            <label className={`text-xs font-medium shrink-0 ${isDarkMode ? 'text-white/80' : 'text-gray-900'}`}>
              {at.textContentLabel}
            </label>
            {renderVoiceMicButton('text')}
          </div>
          <textarea
            ref={textInputRef}
            value={textComposing ? textLocal : localText}
            readOnly={micVoiceBusy}
            disabled={micVoiceBusy}
            onFocus={() => {
              if (micVoiceBusy) return;
              textInputFocusedRef.current = true;
            }}
            onCompositionStart={(e) => {
              setTextComposing(true);
              setTextLocal((e.target as HTMLTextAreaElement).value);
            }}
            onCompositionEnd={(e) => {
              setTextComposing(false);
              const v = (e.target as HTMLTextAreaElement).value;
              setLocalText(v);
              if (textDebounceRef.current) {
                clearTimeout(textDebounceRef.current);
                textDebounceRef.current = null;
              }
              lastSentTextRef.current = v;
              onTextChange(v);
            }}
            onBlur={(e) => {
              textInputFocusedRef.current = false;
              if (textDebounceRef.current) {
                clearTimeout(textDebounceRef.current);
                textDebounceRef.current = null;
              }
              const v = (e.target as HTMLTextAreaElement).value;
              if (v !== lastSentTextRef.current) {
                lastSentTextRef.current = v;
                setLocalText(v);
                onTextChange(v);
              }
            }}
            onChange={(e) => {
              if (micVoiceBusy) return;
              const v = e.target.value;
              if (textComposing) {
                setTextLocal(v);
              } else {
                setLocalText(v);
                if (textDebounceRef.current) clearTimeout(textDebounceRef.current);
                textDebounceRef.current = setTimeout(() => {
                  textDebounceRef.current = null;
                  lastSentTextRef.current = v;
                  onTextChange(v);
                }, 250);
              }
            }}
            className={`w-full flex-1 custom-scrollbar bg-transparent resize-none outline-none text-sm rounded-lg p-3 border ${
              isDarkMode 
                ? 'text-white placeholder:text-white/40 border-gray-600/50 focus:border-green-500/50' 
                : 'text-gray-900 placeholder:text-gray-500 border-gray-300/50 focus:border-green-500/50'
            } focus:ring-2 focus:ring-green-500/30 ${micVoiceBusy ? 'opacity-45 cursor-not-allowed' : ''}`}
            placeholder={at.textContentPlaceholder}
            style={{ caretColor: isDarkMode ? '#0A84FF' : '#22c55e' }}
            title={at.textInputTitle}
          />
        </div>
        )}

        {/* 右侧：语速/音量/音调（仅 MiniMax 语音合成） */}
        {!isIndexTts2 && !isRhartSong && !isAudioCover && !isRvcTrain && (
            <div className="w-48 flex-shrink-0 flex flex-col gap-4">
            <div className="flex flex-col">
              <label className={`text-xs font-medium mb-2 ${isDarkMode ? 'text-white/80' : 'text-gray-900'}`}>
                {at.speedLabel(speed.toFixed(1))}
              </label>
              <input type="range" min="0.5" max="2" step="0.1" value={speed} onChange={(e) => onSpeedChange(parseFloat(e.target.value))} className="w-full h-2 bg-gray-600/30 rounded-lg appearance-none cursor-pointer accent-green-500" title={at.speedLabel(speed.toFixed(1))} aria-label={at.speedAria} />
            </div>
            <div className="flex flex-col">
              <label className={`text-xs font-medium mb-2 ${isDarkMode ? 'text-white/80' : 'text-gray-900'}`}>
                {at.volumeLabel(volume.toFixed(1))}
              </label>
              <input type="range" min="0.1" max="10" step="0.1" value={volume} onChange={(e) => onVolumeChange(parseFloat(e.target.value))} className="w-full h-2 bg-gray-600/30 rounded-lg appearance-none cursor-pointer accent-green-500" title={at.volumeLabel(volume.toFixed(1))} aria-label={at.volumeAria} />
            </div>
            <div className="flex flex-col">
              <label className={`text-xs font-medium mb-2 ${isDarkMode ? 'text-white/80' : 'text-gray-900'}`}>
                {at.pitchLabel(`${pitch > 0 ? '+' : ''}${pitch}`)}
              </label>
              <input type="range" min="-12" max="12" step="1" value={pitch} onChange={(e) => onPitchChange(parseInt(e.target.value))} className="w-full h-2 bg-gray-600/30 rounded-lg appearance-none cursor-pointer accent-green-500" title={at.pitchLabel(`${pitch > 0 ? '+' : ''}${pitch}`)} aria-label={at.pitchAria} />
            </div>
          </div>
        )}
      </div>

    </div>
  );
};

export default AudioInputPanel;
