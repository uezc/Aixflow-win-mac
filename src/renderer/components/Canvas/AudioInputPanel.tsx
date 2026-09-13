// @ts-nocheck
import React, { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import { Play, Mic, Loader2, Check, Music2, Package } from 'lucide-react';
import { useCloudRealtimeDictation } from '../../hooks/useCloudRealtimeDictation';
import { useDictationPushToTalk } from '../../hooks/useDictationPushToTalk';
import { bindPushToTalkPointerHandlers } from '../../utils/pushToTalkPointer';
import { micLevelCssVars } from '../../utils/micInputLevel';
import { acquireVoiceModalLock, releaseVoiceModalLock } from '../../utils/voiceModalGate';
import VoiceMicGlyph from './VoiceMicGlyph';
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
import { confirmOptionalEngineDownload } from '../../utils/confirmOptionalEngineDownload';
import { rvcVoiceModelPackageUrl } from '../characterListShared';
import {
  filterActiveAudioModelOptions,
  isRetiredAudioModel,
  normalizeAudioModelIfRetired,
} from '../../config/audioModelUiPolicy';
import { isAudioQueueOnlyModel } from '../../../shared/audioQueueGoldenPath';
import {
  DOUBAO_SEED_AUDIO_MODEL_ID,
  DOUBAO_SEED_AUDIO_LABEL,
  isDoubaoSeedAudioModel,
  clampDoubaoSpeechRate,
  clampDoubaoLoudnessRate,
  clampDoubaoPitchRate,
} from '../../utils/doubaoSeedAudioModel';
import {
  audioInputPanelT,
  audioVoiceDisplayLabel,
  audioEmotionDisplayLabel,
} from '../../i18n/audioInputPanelI18n';
import { AiGenerateDisclaimerTip } from '../legal/AiGenerateDisclaimerTip';
import { PanelOptionDropdown } from './PanelOptionDropdown';
import { AtMentionMenu } from './AtMentionMenu';
import { PromptRichInput, type PromptRichInputHandle } from './PromptRichInput';
import { usePromptAtMention } from '../../hooks/usePromptAtMention';

const baseAudioModelOptions = filterActiveAudioModelOptions([
  { value: 'speech-2.8-hd', label: 'MiniMax 2.8 HD' },
  { value: DOUBAO_SEED_AUDIO_MODEL_ID, label: DOUBAO_SEED_AUDIO_LABEL },
  { value: 'index-tts2', label: 'Index-TTS 2.0' },
  { value: 'rhart-song-v5.5', label: 'SUNO v5.5' },
  { value: AI_VOICE_COVER_MODEL_ID, label: 'RVC 翻唱' },
]);

/** 从参考音 URL / 本地路径提取展示用文件名 */
function displayNameFromAudioUrl(url: string): string {
  const raw = (url || '').trim();
  if (!raw) return '';
  let path = raw;
  if (path.startsWith('local-resource://')) path = path.slice('local-resource://'.length);
  else if (path.startsWith('file://')) path = path.replace(/^file:\/+/i, '');
  path = path.split('?')[0].split('#')[0];
  const parts = path.replace(/\\/g, '/').split('/').filter(Boolean);
  let name = parts[parts.length - 1] || '';
  try {
    name = decodeURIComponent(name);
  } catch {
    /* keep raw */
  }
  return name.trim();
}

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
  speechRate?: number;
  loudnessRate?: number;
  projectId?: string;
  /** 上游文本已连入 */
  isTextConnected?: boolean;
  /** 上游参考音已连入 */
  isAudioConnected?: boolean;
  /** 多路参考音（Doubao 最多 3；有值时优先用于标签与提交） */
  connectedReferenceAudios?: Array<{ url: string; name: string; nodeId?: string }>;
  referenceAudioUrls?: string[];
  /** 上游原曲已连入 */
  isSourceSongConnected?: boolean;
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
  onSpeechRateChange?: (value: number) => void;
  onLoudnessRateChange?: (value: number) => void;
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
  speechRate = 0,
  loudnessRate = 0,
  projectId,
  isTextConnected = false,
  isAudioConnected = false,
  connectedReferenceAudios,
  referenceAudioUrls,
  isSourceSongConnected = false,
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
  onSpeechRateChange,
  onLoudnessRateChange,
  onOutputAudioChange,
  onRvcTrainComplete,
}) => {
  const { cloudMap } = useNxModelPricing();
  const { locale } = useAppLocale();
  const at = useMemo(() => audioInputPanelT(locale), [locale]);
  const wc = useMemo(() => workspaceChromeT(locale), [locale]);
  const voiceMergeTargetRef = useRef<'text' | 'lyrics' | 'styleDesc'>('text');
  const isIndexTts2 = model === 'index-tts2';
  const isDoubaoSeedAudio = isDoubaoSeedAudioModel(model);
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

  /** rvcTrain 入边时由 Workspace 写入 model；此处不再按双路 audio 自动切换 */
  const textInputRef = useRef<PromptRichInputHandle>(null);
  const { showAlert, showConfirm } = useDarkAlert();

  // IME 输入法支持：全能写歌字段在 composition 期间使用本地状态，避免中文输入被打断
  const [songNameComposing, setSongNameComposing] = useState(false);
  const [songNameLocal, setSongNameLocal] = useState('');
  const [styleDescComposing, setStyleDescComposing] = useState(false);
  const [styleDescLocal, setStyleDescLocal] = useState('');
  const [lyricsComposing, setLyricsComposing] = useState(false);
  const [lyricsLocal, setLyricsLocal] = useState('');

  // 本地 text + 防抖：修复输入法（IME）问题，避免每次按键触发父组件重渲染打断中文输入
  const [localText, setLocalText] = useState(text);
  const localTextRef = useRef(localText);
  localTextRef.current = localText;
  const lastSentTextRef = useRef(text);
  const textDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const prevNodeIdRef = useRef(nodeId);
  const textInputFocusedRef = useRef(false);
  const [textComposing, setTextComposing] = useState(false);

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

  /** 参考音 + 文本同时就绪：仅保留支持参考音配音的模型（Index-TTS / Doubao） */
  const isVoiceCloneTtsMode =
    !!(referenceAudioUrl || '').trim() &&
    localText.trim().length > 0 &&
    !(sourceSongAudioUrl || '').trim() &&
    !hasRvcCoverModel;

  const DOUBAO_MAX_REF = 3;

  /** 多路参考音展示列表（最多 3）；单路时退回旧逻辑 */
  const referenceAudioTags = useMemo(() => {
    const fromConnected = Array.isArray(connectedReferenceAudios)
      ? connectedReferenceAudios
          .map((a, i) => {
            const url = String(a?.url || '').trim();
            if (!url) return null;
            const name =
              String(a?.name || '').trim() ||
              displayNameFromAudioUrl(url) ||
              at.linkedRefAudioTagN(i + 1);
            return { url, name };
          })
          .filter(Boolean) as Array<{ url: string; name: string }>
      : [];
    if (fromConnected.length > 0) return fromConnected.slice(0, DOUBAO_MAX_REF);
    const fromUrls = Array.isArray(referenceAudioUrls)
      ? referenceAudioUrls
          .map((u, i) => {
            const url = String(u || '').trim();
            if (!url) return null;
            return {
              url,
              name: displayNameFromAudioUrl(url) || at.linkedRefAudioTagN(i + 1),
            };
          })
          .filter(Boolean) as Array<{ url: string; name: string }>
      : [];
    if (fromUrls.length > 0) return fromUrls.slice(0, DOUBAO_MAX_REF);
    const single = (referenceAudioUrl || '').trim();
    if (single) {
      return [
        {
          url: single,
          name: displayNameFromAudioUrl(single) || at.linkedRefAudioTag,
        },
      ];
    }
    if (isAudioConnected) return [{ url: '', name: at.linkedRefAudioTag }];
    return [];
  }, [
    connectedReferenceAudios,
    referenceAudioUrls,
    referenceAudioUrl,
    isAudioConnected,
    at,
  ]);

  const audioModelOptions = useMemo(() => {
    if (!isVoiceCloneTtsMode) return baseAudioModelOptions;
    return baseAudioModelOptions.filter(
      (o) => o.value === 'index-tts2' || o.value === DOUBAO_SEED_AUDIO_MODEL_ID,
    );
  }, [isVoiceCloneTtsMode]);

  const voiceOptions = useMemo(
    () => VOICE_IDS.map((vid) => ({ value: vid, label: audioVoiceDisplayLabel(locale, vid) })),
    [locale],
  );

  const emotionOptions = useMemo(
    () => [
      { value: '', label: at.emotionNone },
      ...EMOTION_VALUES.map((ev) => ({ value: ev, label: audioEmotionDisplayLabel(locale, ev) })),
    ],
    [locale, at.emotionNone],
  );

  useEffect(() => {
    if (!isRetiredAudioModel(model) || !onModelChange) return;
    onModelChange(normalizeAudioModelIfRetired(model));
  }, [model, onModelChange]);

  /** rvcTrain 入边或节点已有 RVC 模型包 → 有原曲时自动切翻唱 */
  useEffect(() => {
    if (!onModelChange || isAudioSongModel(model)) return;
    if (hasRvcCoverModel && hasCoverSource && !isAudioCoverModel(model)) {
      onModelChange(AI_VOICE_COVER_MODEL_ID);
    }
  }, [hasRvcCoverModel, hasCoverSource, model, onModelChange]);

  /** 1 路参考音：无台词 → RVC 训练；有台词 → 仅 Index-TTS / Doubao */
  useEffect(() => {
    const ref = (referenceAudioUrl || '').trim();
    if (!ref || !onModelChange) return;
    if (hasRvcCoverModel) return;
    if ((sourceSongAudioUrl || '').trim()) return;
    const hasText = localText.trim().length > 0;
    if (!hasText) {
      if (isAudioSongModel(model) || isAudioCoverModel(model)) return;
      if (!isRvcTrainModel(model)) onModelChange(RVC_VOICE_TRAIN_MODEL_ID);
      return;
    }
    if (isVoiceCloneTtsMode && !audioModelOptions.some((o) => o.value === model)) {
      onModelChange('index-tts2');
    }
  }, [
    referenceAudioUrl,
    sourceSongAudioUrl,
    localText,
    model,
    onModelChange,
    hasRvcCoverModel,
    isVoiceCloneTtsMode,
    audioModelOptions,
  ]);

  useEffect(() => {
    return () => {
      if (textDebounceRef.current) {
        clearTimeout(textDebounceRef.current);
        textDebounceRef.current = null;
      }
    };
  }, []);

  const applyMentionToText = useCallback(
    (next: string) => {
      setLocalText(next);
      lastSentTextRef.current = next;
      onTextChange(next);
    },
    [onTextChange],
  );

  const {
    status: dictationStatus,
    isActive: isDictationActive,
    inputLevel: dictationInputLevel,
    start: startRealtimeDictation,
    stop: stopRealtimeDictation,
    cancel: cancelRealtimeDictation,
  } = useCloudRealtimeDictation({
    getBaseText: () => {
      const target = voiceMergeTargetRef.current;
      if (target === 'lyrics') {
        const prev = (lyricsComposing ? lyricsLocal : lyrics || '').trimEnd();
        return prev ? `${prev}\n` : '';
      }
      if (target === 'styleDesc') {
        const prev = (styleDescComposing ? styleDescLocal : styleDesc || '').trimEnd();
        return prev ? `${prev} ` : '';
      }
      const prev = (textInputRef.current?.getPlainText() ?? localTextRef.current ?? '').trimEnd();
      return prev ? `${prev}\n` : '';
    },
    onLiveText: (full) => {
      const target = voiceMergeTargetRef.current;
      if (target === 'lyrics') {
        setLyricsComposing(false);
        onLyricsChange?.(full);
        return;
      }
      if (target === 'styleDesc') {
        setStyleDescComposing(false);
        onStyleDescChange?.(full);
        return;
      }
      textInputRef.current?.setPlainText(full);
      setLocalText(full);
      lastSentTextRef.current = full;
      onTextChange(full);
    },
    onError: (message) => {
      showAlert(message);
    },
    onMicDenied: () => {
      showAlert(at.micPermissionDenied);
    },
  });

  const micVoiceBusy = dictationStatus === 'connecting' || dictationStatus === 'stopping';
  const micVoiceStopping = dictationStatus === 'stopping';
  const micInputLocked = isDictationActive || micVoiceBusy;

  const { pressStart: dictationPressStart, pressEnd: dictationPressEnd, holdingRef: dictationHoldingRef } =
    useDictationPushToTalk({
      start: startRealtimeDictation,
      stop: stopRealtimeDictation,
      cancel: cancelRealtimeDictation,
      status: dictationStatus,
      disabled: micVoiceStopping,
    });

  const {
    mentionMenuProps,
    mentionCandidates,
    onMentionKeyDown,
    onMentionInputCheck,
    onMentionCompositionChange,
  } = usePromptAtMention({
    nodeId,
    value: localText,
    richEditorRef: textInputRef,
    enabled: !micInputLocked && !isTextConnected,
    composing: textComposing,
    orderedInputImages: [],
    locale,
    preferSeedanceTag: false,
    onApply: applyMentionToText,
  });

  useEffect(() => {
    if (!isDictationActive) return;
    acquireVoiceModalLock();
    return () => releaseVoiceModalLock();
  }, [isDictationActive]);

  const renderVoiceMicButton = (target: 'text' | 'lyrics' | 'styleDesc') => {
    const handlers = bindPushToTalkPointerHandlers({
      onPressStart: () => {
        if (
          micVoiceStopping ||
          dictationHoldingRef.current ||
          dictationStatus === 'connecting' ||
          dictationStatus === 'listening' ||
          dictationStatus === 'stopping'
        ) {
          return;
        }
        voiceMergeTargetRef.current = target;
        dictationPressStart();
      },
      onPressEnd: dictationPressEnd,
      disabled: () => micVoiceStopping,
    });
    const activeForTarget =
      (dictationStatus === 'listening' || dictationStatus === 'connecting') &&
      voiceMergeTargetRef.current === target;
    return (
      <button
        type="button"
        {...handlers}
        disabled={micVoiceStopping}
        style={activeForTarget ? micLevelCssVars(dictationInputLevel) : undefined}
        className={`nexflow-voice-mic-btn nodrag nopan relative flex h-7 w-7 shrink-0 items-center justify-center rounded border select-none ${
          dictationStatus === 'connecting' && activeForTarget
            ? 'connecting'
            : dictationStatus === 'listening' && activeForTarget
              ? 'listening'
              : ''
        } ${
          micVoiceStopping
            ? isDarkMode
              ? 'cursor-wait border-white/25 bg-white/5 text-white/75'
              : 'cursor-wait border-gray-300 bg-white/90 text-gray-600'
            : isDarkMode
              ? 'border-white/25 bg-white/5 text-white/75 hover:bg-white/10 hover:text-white'
              : 'border-gray-300 bg-white/90 text-gray-600 hover:bg-gray-100'
        }`}
        title={
          micVoiceBusy
            ? at.voiceTranscribing
            : activeForTarget
              ? wc.textVoiceInputStopButton
              : wc.textVoiceInputTitle
        }
        aria-label={
          micVoiceBusy
            ? at.voiceTranscribing
            : activeForTarget
              ? wc.textVoiceInputStopButton
              : wc.textVoiceInputTitle
        }
      >
        <VoiceMicGlyph
          busy={micVoiceBusy && activeForTarget}
          active={dictationStatus === 'listening' && activeForTarget}
          level={dictationInputLevel}
        />
      </button>
    );
  };

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
          showAlert('元宝不足，请充值');
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
                          errorMessage.includes('余额不足') ||
                          errorMessage.includes('元宝不足') ||
                          /BALANCE_INSUFFICIENT/i.test(errorMessage);
      
      if (isQuotaError) {
        showAlert('元宝不足，请充值');
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
      const downloadOk = await confirmOptionalEngineDownload('rvc', showConfirm, locale);
      if (!downloadOk) return;
    } else if (isRvcTrain) {
      if (!(referenceAudioUrl ?? '').trim()) return;
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
        // 已去掉面板「模型名称」输入：优先已有值，否则回退节点展示名（Workspace 会注入 title）
        requestParams.rvcTrainModelName = (rvcTrainModelName || '').trim() || 'audio';
      } else if (isDoubaoSeedAudio) {
        const normalizeLocal = (u: string) =>
          u.startsWith('local-resource://') || u.startsWith('file://')
            ? u
                .replace(/%5C/gi, '/')
                .replace(/^local-resource:\/\/+/, 'local-resource://')
                .replace(/^file:\/\/+/, 'file://')
            : u;
        const multiUrls = referenceAudioTags
          .map((t) => normalizeLocal(String(t.url || '').trim()))
          .filter(Boolean)
          .slice(0, DOUBAO_MAX_REF);
        let refUrl = multiUrls[0] || (referenceAudioUrl || '').trim();
        if (refUrl) refUrl = normalizeLocal(refUrl);
        requestParams.model = DOUBAO_SEED_AUDIO_MODEL_ID;
        if (multiUrls.length > 0) requestParams.doubaoAudioUrls = multiUrls;
        if (refUrl) requestParams.referenceAudioUrl = refUrl;
        requestParams.speechRate = clampDoubaoSpeechRate(speechRate);
        requestParams.loudnessRate = clampDoubaoLoudnessRate(loudnessRate);
        requestParams.pitch = clampDoubaoPitchRate(pitch);
        requestParams.doubaoFormat = 'mp3';
        requestParams.doubaoSampleRate = '24000';
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
      // Queue-only 音频模型强制云端排队（ai-voice-cover 不在 AUDIO_QUEUE_ONLY 内）
      if (isAudioQueueOnlyModel(requestParams.model)) {
        requestParams.nxCloudQueueGoldenPath = true;
      }
      await executeAI(requestParams);
    } catch (error) {
      console.error('音频生成失败:', error);
    }
  }, [flushTextSync, localText, model, isIndexTts2, isDoubaoSeedAudio, isAudioCover, isRvcTrain, isRhartSong, songName, styleDesc, lyrics, sourceSongAudioUrl, referenceAudioUrl, referenceAudioTags, speechRate, loudnessRate, effectiveRvcCoverModel, rvcTrainModelName, outputModelUrl, outputModelRemoteUrl, coverReferenceAudioUrl, libraryRvcVoiceId, coverPitch, coverIndexRate, coverVocalMixPct, coverAccompanimentMixPct, voiceId, speed, volume, pitch, emotion, executeAI, onStart, projectId, showAlert, showConfirm, locale, at]);

  const audioPriceOk = (() => {
    if (isAudioCover) return true;
    if (!model) return false;
    return getAudioDisplayPrice(model, cloudMap) != null;
  })();

  const isRunDisabled =
    aiStatus === 'PROCESSING' ||
    !audioPriceOk ||
    (isRhartSong
      ? !(songName ?? '').trim() || !(styleDesc ?? '').trim() || !(lyrics ?? '').trim()
      : isAudioCover
        ? !(sourceSongAudioUrl ?? '').trim() ||
          (!hasRvcCoverModel && !(outputModelUrl || outputModelRemoteUrl || '').trim() && !(libraryRvcVoiceId || '').trim())
        : isRvcTrain
          ? !(referenceAudioUrl ?? '').trim()
          : !localText.trim() || (isIndexTts2 && !(referenceAudioUrl || '').trim()));

  const showVoiceEmotionControls =
    !isIndexTts2 && !isDoubaoSeedAudio && !isRhartSong && !isAudioCover && !isRvcTrain;

  const modelControls = (
    <>
      <div className="flex items-center gap-1 shrink-0">
        <PanelOptionDropdown
          value={model}
          options={audioModelOptions}
          onChange={(v) => onModelChange?.(v)}
          isDarkMode={isDarkMode}
          title={at.chooseModelTitle}
          minWidthPx={112}
          menuPlacement="up"
        />
      </div>
      {showVoiceEmotionControls && (
        <>
          <div className="flex items-center gap-1 shrink-0">
            <PanelOptionDropdown
              value={voiceId}
              options={voiceOptions}
              onChange={onVoiceIdChange}
              isDarkMode={isDarkMode}
              title={at.chooseVoiceTitle}
              minWidthPx={88}
              menuPlacement="up"
            />
          </div>
          {onEmotionChange && (
            <div className="flex items-center gap-1 shrink-0">
              <PanelOptionDropdown
                value={emotion || ''}
                options={emotionOptions}
                onChange={(v) => onEmotionChange((v as any) || undefined)}
                isDarkMode={isDarkMode}
                title={at.emotionLabel}
                minWidthPx={64}
                menuPlacement="up"
              />
            </div>
          )}
        </>
      )}
    </>
  );

  const priceBadge = (() => {
    if (!model) return null;
    try {
      if (isAudioCover) {
        return (
          <span
            className={`text-[11px] font-medium px-2 py-0.5 rounded-full shrink-0 tabular-nums border ${
              isDarkMode
                ? 'text-emerald-200/90 bg-emerald-500/15 border-emerald-400/25'
                : 'text-emerald-700 bg-emerald-50 border-emerald-200'
            }`}
            title={at.localCoverFreeTitle}
          >
            {at.localCoverFree}
          </span>
        );
      }
      const price = getAudioDisplayPrice(model, cloudMap);
      if (price == null) {
        return (
          <span
            className={`text-[11px] font-medium px-2 py-0.5 rounded-full shrink-0 ${
              isDarkMode ? 'text-white/45 bg-white/10' : 'text-gray-500 bg-gray-100'
            }`}
            title={at.noPricingTitle}
          >
            {at.noPricingYet}
          </span>
        );
      }
      return (
        <span
          className={`text-[11px] font-medium px-2 py-0.5 rounded-full shrink-0 tabular-nums border ${
            isDarkMode
              ? 'text-amber-200/90 bg-amber-500/15 border-amber-400/25'
              : 'text-amber-700 bg-amber-50 border-amber-200'
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
            className={`text-[11px] font-medium px-2 py-0.5 rounded-full shrink-0 ${
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
  })();

  const runButton = (
    <button
      type="button"
      onClick={handleExecute}
      disabled={isRunDisabled}
      className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 transition-colors ${
        isRunDisabled
          ? isDarkMode
            ? 'bg-white/[0.08] text-white/25 cursor-not-allowed'
            : 'bg-black/[0.06] text-gray-400 cursor-not-allowed'
          : aiStatus === 'PROCESSING'
            ? 'bg-green-500/70 text-white cursor-not-allowed'
            : 'bg-green-500 text-white hover:bg-green-600'
      }`}
      title={at.generateAudioTitle}
      aria-label={isRvcTrain ? at.generateRvcTrain : at.generateAudio}
    >
      {aiStatus === 'PROCESSING' ? (
        <Loader2 className="w-3.5 h-3.5 animate-spin" />
      ) : (
        <Play className="w-3.5 h-3.5" fill="currentColor" />
      )}
    </button>
  );

  return (
    <div className="relative flex w-full flex-col nodrag nopan">
      {/* 无框贴水：弱边框 + 轻玻璃，与视频/图像/LLM 底栏同系 */}
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

      {isAudioCover && onCoverPitchChange && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 flex-shrink-0 pb-2 mb-2">
          <div className="flex items-center gap-2 min-w-[140px] flex-1 max-w-[200px]">
            <label className={`text-xs whitespace-nowrap shrink-0 ${isDarkMode ? 'text-white/70' : 'text-gray-700'}`}>
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
              <label className={`text-xs whitespace-nowrap shrink-0 ${isDarkMode ? 'text-white/70' : 'text-gray-700'}`}>
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

      {/* 参考音 / 文本 / 原曲 @ 标签同一排（多路参考音逐条展示） */}
      {(isTextConnected ||
        isSourceSongConnected ||
        referenceAudioTags.length > 0 ||
        isAudioConnected) && (
        <div className="mb-1 flex flex-wrap items-center gap-1.5 flex-shrink-0">
          {referenceAudioTags.length > 1 ? (
            <span
              className={`inline-flex items-center px-1.5 py-0.5 rounded-md text-[11px] font-semibold ${
                isDarkMode ? 'bg-sky-500/20 text-sky-200/90' : 'bg-sky-50 text-sky-800'
              }`}
              title={at.linkedRefAudioCountBadge(referenceAudioTags.length, DOUBAO_MAX_REF)}
            >
              {at.linkedRefAudioCountBadge(referenceAudioTags.length, DOUBAO_MAX_REF)}
            </span>
          ) : null}
          {referenceAudioTags.length > 0
            ? referenceAudioTags.map((tag, idx) => (
                <span
                  key={`${tag.url || 'ref'}-${idx}`}
                  className={`inline-flex items-center max-w-[220px] px-1.5 py-0.5 rounded-md text-[11px] font-semibold truncate ${
                    isDarkMode ? 'bg-sky-500/25 text-sky-300' : 'bg-sky-100 text-sky-700'
                  }`}
                  title={
                    tag.url ||
                    (referenceAudioTags.length > 1
                      ? at.linkedRefAudioTagTitleN(idx + 1, DOUBAO_MAX_REF)
                      : at.linkedRefAudioTagTitle)
                  }
                >
                  @{tag.name}
                </span>
              ))
            : isAudioConnected ? (
                <span
                  className={`inline-flex items-center px-1.5 py-0.5 rounded-md text-[11px] font-semibold ${
                    isDarkMode ? 'bg-sky-500/25 text-sky-300' : 'bg-sky-100 text-sky-700'
                  }`}
                  title={at.linkedRefAudioTagTitle}
                >
                  @{at.linkedRefAudioTag}
                </span>
              ) : null}
          {isTextConnected ? (
            <span
              className={`inline-flex items-center px-1.5 py-0.5 rounded-md text-[11px] font-semibold ${
                isDarkMode ? 'bg-sky-500/25 text-sky-300' : 'bg-sky-100 text-sky-700'
              }`}
              title={at.linkedTextTagTitle}
            >
              @{at.linkedTextTag}
            </span>
          ) : null}
          {isSourceSongConnected ? (
            <span
              className={`inline-flex items-center px-1.5 py-0.5 rounded-md text-[11px] font-semibold ${
                isDarkMode ? 'bg-sky-500/25 text-sky-300' : 'bg-sky-100 text-sky-700'
              }`}
              title={at.linkedSourceSongTagTitle}
            >
              @{at.linkedSourceSongTag}
            </span>
          ) : null}
        </div>
      )}

      {/* 主要内容区域 - 左右分栏布局 */}
      <div className="pt-0 pb-0 flex-1 min-h-0 flex gap-3 overflow-hidden">
        {/* 左侧：文本内容 或 全能写歌（左：歌曲名+风格描述，右：歌词） */}
        {isRhartSong ? (
          <div className="flex-1 min-w-0 min-h-0 flex gap-3 overflow-hidden">
            <div className="w-52 flex-shrink-0 flex flex-col gap-3 overflow-auto custom-scrollbar">
              <div className="flex flex-col flex-shrink-0">
                <label className={`text-xs mb-1 ${isDarkMode ? 'text-white/70' : 'text-gray-700'}`}>{at.songNameLabel}</label>
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
                <label className={`text-xs mb-1 shrink-0 ${isDarkMode ? 'text-white/70' : 'text-gray-700'}`}>{at.styleDescLabel}</label>
                <div className="relative">
                  <input
                    type="text"
                    data-nexflow-dictation-target="1"
                    value={styleDescComposing ? styleDescLocal : styleDesc}
                    readOnly={micInputLocked}
                    disabled={micInputLocked}
                    onCompositionStart={(e) => {
                      setStyleDescComposing(true);
                      setStyleDescLocal((e.target as HTMLInputElement).value);
                    }}
                    onCompositionEnd={(e) => {
                      setStyleDescComposing(false);
                      onStyleDescChange?.((e.target as HTMLInputElement).value);
                    }}
                    onChange={(e) => {
                      if (micInputLocked) return;
                      const v = e.target.value;
                      if (styleDescComposing) setStyleDescLocal(v);
                      else onStyleDescChange?.(v);
                    }}
                    placeholder={at.styleDescPlaceholder}
                    className={`w-full px-3 py-2 pr-10 rounded-lg text-sm border ${
                      isDarkMode ? 'bg-black/30 text-white border-gray-600/50 placeholder:text-white/40' : 'bg-white/90 text-gray-900 border-gray-300 placeholder:text-gray-500'
                    } outline-none focus:ring-2 focus:ring-green-500/30 ${micInputLocked ? 'opacity-45 cursor-not-allowed' : ''}`}
                    style={{ caretColor: isDarkMode ? '#0A84FF' : '#22c55e' }}
                  />
                  <div className="absolute top-1/2 -translate-y-1/2 right-1.5 z-10 pointer-events-auto">
                    {renderVoiceMicButton('styleDesc')}
                  </div>
                </div>
              </div>
            </div>
            <div className="flex-1 min-w-0 min-h-0 flex flex-col">
              <label className={`text-xs mb-1 shrink-0 flex-shrink-0 ${isDarkMode ? 'text-white/70' : 'text-gray-700'}`}>{at.lyricsLabel}</label>
              <div className="relative flex-1 min-h-0 flex flex-col">
                <textarea
                  data-nexflow-dictation-target="1"
                  value={lyricsComposing ? lyricsLocal : lyrics}
                  readOnly={micInputLocked}
                  disabled={micInputLocked}
                  onCompositionStart={(e) => {
                    setLyricsComposing(true);
                    setLyricsLocal((e.target as HTMLTextAreaElement).value);
                  }}
                  onCompositionEnd={(e) => {
                    setLyricsComposing(false);
                    onLyricsChange?.((e.target as HTMLTextAreaElement).value);
                  }}
                  onChange={(e) => {
                    if (micInputLocked) return;
                    const v = e.target.value;
                    if (lyricsComposing) setLyricsLocal(v);
                    else onLyricsChange?.(v);
                  }}
                  placeholder={at.lyricsPlaceholder}
                  className={`w-full flex-1 min-h-0 custom-scrollbar resize-none rounded-lg p-3 pr-10 pt-10 text-sm border ${
                    isDarkMode ? 'bg-black/30 text-white border-gray-600/50 placeholder:text-white/40' : 'bg-white/90 text-gray-900 border-gray-300 placeholder:text-gray-500'
                  } outline-none focus:ring-2 focus:ring-green-500/30 ${micInputLocked ? 'opacity-45 cursor-not-allowed' : ''}`}
                  style={{ caretColor: isDarkMode ? '#0A84FF' : '#22c55e' }}
                />
                <div className="absolute top-1.5 right-1.5 z-10 pointer-events-auto">
                  {renderVoiceMicButton('lyrics')}
                </div>
              </div>
            </div>
          </div>
        ) : isRvcTrain ? (
          <div className="flex-1 min-w-0 min-h-0 flex justify-center">
            {(() => {
              const connected = !!(referenceAudioUrl || '').trim();
              return (
                <div
                  className={`w-1/2 flex flex-col items-center justify-center gap-2 min-h-[120px] rounded-xl border transition-colors ${
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
          {!isTextConnected && !isAudioConnected && !isSourceSongConnected ? (
            <label className={`mb-1 text-xs shrink-0 flex-shrink-0 ${isDarkMode ? 'text-white/70' : 'text-gray-700'}`}>
              {at.textContentLabel}
            </label>
          ) : null}
          <div className="relative min-w-0 h-[112px]">
            <PromptRichInput
              ref={textInputRef}
              value={localText}
              candidates={mentionCandidates}
              readOnly={micInputLocked || isTextConnected}
              disabled={micInputLocked}
              isDarkMode={isDarkMode}
              placeholder={isDoubaoSeedAudio ? (locale === 'en' ? 'Audio generation prompt (≤3000 chars)…' : '输入音频生成提示词（≤3000 字符）…') : at.textContentPlaceholder}
              title={at.textInputTitle}
              onFocus={() => {
                if (micInputLocked || isTextConnected) return;
                textInputFocusedRef.current = true;
              }}
              onCompositionChange={(next) => {
                onMentionCompositionChange(next);
                setTextComposing(next);
              }}
              onBlur={() => {
                textInputFocusedRef.current = false;
                if (textDebounceRef.current) {
                  clearTimeout(textDebounceRef.current);
                  textDebounceRef.current = null;
                }
                const v = textInputRef.current?.getPlainText() ?? localText;
                if (v !== lastSentTextRef.current) {
                  lastSentTextRef.current = v;
                  setLocalText(v);
                  onTextChange(v);
                }
              }}
              onKeyDown={onMentionKeyDown}
              onSubmit={() => {
                if (micInputLocked || isTextConnected || isRunDisabled) return;
                void handleExecute();
              }}
              onInputCheck={onMentionInputCheck}
              onChange={(v) => {
                if (micInputLocked) return;
                setLocalText(v);
                if (textDebounceRef.current) clearTimeout(textDebounceRef.current);
                textDebounceRef.current = setTimeout(() => {
                  textDebounceRef.current = null;
                  lastSentTextRef.current = v;
                  onTextChange(v);
                }, 250);
              }}
              className={`w-full h-full px-0 py-1 pr-9 pt-8 [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden ${
                micInputLocked || isTextConnected ? 'opacity-45 cursor-not-allowed' : ''
              }`}
              style={{ caretColor: isDarkMode ? '#0A84FF' : '#22c55e' }}
            />
            <div className="absolute top-0.5 right-0 z-10 pointer-events-auto">
              {renderVoiceMicButton('text')}
            </div>
            <AtMentionMenu {...mentionMenuProps} />
          </div>
        </div>
        )}
      </div>

      {/* 底栏：与图像模块同系 — 下拉左、价格+圆形生成右 */}
      <div className="mt-1 flex items-center gap-1.5 flex-shrink-0 min-w-0">
        {modelControls}
        <div className="flex-1" />
        {priceBadge}
        {runButton}
      </div>

      </div>
    </div>
  );
};

export default AudioInputPanel;
