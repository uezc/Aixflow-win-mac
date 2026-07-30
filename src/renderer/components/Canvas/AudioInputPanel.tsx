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
import { confirmOptionalEngineDownload } from '../../utils/confirmOptionalEngineDownload';
import { rvcVoiceModelPackageUrl } from '../characterListShared';
import {
  filterActiveAudioModelOptions,
  isRetiredAudioModel,
  normalizeAudioModelIfRetired,
} from '../../config/audioModelUiPolicy';
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

/** 苹果风格面板滑块（语速/音量/音调） */
function ApplePanelRange({
  isDarkMode,
  min,
  max,
  step,
  value,
  onChange,
  title,
  'aria-label': ariaLabel,
}: {
  isDarkMode: boolean;
  min: number;
  max: number;
  step: number;
  value: number;
  onChange: (v: number) => void;
  title?: string;
  'aria-label'?: string;
}) {
  const span = max - min || 1;
  const pct = Math.max(0, Math.min(100, ((value - min) / span) * 100));
  const fill = isDarkMode ? '#30D158' : '#34C759';
  const track = isDarkMode ? 'rgba(255,255,255,0.14)' : 'rgba(60,60,67,0.18)';
  return (
    <input
      type="range"
      min={min}
      max={max}
      step={step}
      value={value}
      title={title}
      aria-label={ariaLabel}
      onChange={(e) => onChange(Number(e.target.value))}
      className="nexflow-apple-panel-range nodrag w-full cursor-pointer"
      style={{
        background: `linear-gradient(to right, ${fill} 0%, ${fill} ${pct}%, ${track} ${pct}%, ${track} 100%)`,
      }}
    />
  );
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
  const [micVoiceBusy, setMicVoiceBusy] = useState(false);
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

  const referenceAudioDisplayName = useMemo(() => {
    const fromUrl = displayNameFromAudioUrl(referenceAudioUrl || '');
    if (fromUrl) return fromUrl;
    if (isAudioConnected) return at.linkedRefAudioTag;
    return '';
  }, [referenceAudioUrl, isAudioConnected, at.linkedRefAudioTag]);

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

  const mergeVoiceIntoText = useCallback(
    (recognized: string) => {
      const t = recognized.trim();
      if (!t) return;
      const prev = localText.trim();
      const next = prev ? `${prev}\n${t}` : t;
      textInputRef.current?.setPlainText(next);
      setLocalText(next);
      lastSentTextRef.current = next;
      onTextChange(next);
      textInputRef.current?.focus();
    },
    [localText, onTextChange],
  );

  const applyMentionToText = useCallback(
    (next: string) => {
      setLocalText(next);
      lastSentTextRef.current = next;
      onTextChange(next);
    },
    [onTextChange],
  );

  const {
    mentionMenuProps,
    mentionCandidates,
    onMentionKeyDown,
    onMentionInputCheck,
  } = usePromptAtMention({
    nodeId,
    value: localText,
    richEditorRef: textInputRef,
    enabled: !micVoiceBusy && !isTextConnected,
    composing: textComposing,
    orderedInputImages: [],
    locale,
    preferSeedanceTag: false,
    onApply: applyMentionToText,
  });

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
      const downloadOk = await confirmOptionalEngineDownload('whisper', showConfirm, locale);
      if (!downloadOk) {
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
    [locale, mergeVoiceIntoLyrics, mergeVoiceIntoStyleDesc, mergeVoiceIntoText, projectId, showAlert, showConfirm],
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
      const downloadOk = await confirmOptionalEngineDownload('rvc', showConfirm, locale);
      if (!downloadOk) return;
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
      } else if (isDoubaoSeedAudio) {
        let refUrl = (referenceAudioUrl || '').trim();
        if (refUrl.startsWith('local-resource://') || refUrl.startsWith('file://')) {
          refUrl = refUrl.replace(/%5C/gi, '/').replace(/^local-resource:\/\/+/, 'local-resource://').replace(/^file:\/\/+/, 'file://');
        }
        requestParams.model = DOUBAO_SEED_AUDIO_MODEL_ID;
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
      await executeAI(requestParams);
    } catch (error) {
      console.error('音频生成失败:', error);
    }
  }, [flushTextSync, localText, model, isIndexTts2, isDoubaoSeedAudio, isAudioCover, isRvcTrain, isRhartSong, songName, styleDesc, lyrics, sourceSongAudioUrl, referenceAudioUrl, speechRate, loudnessRate, effectiveRvcCoverModel, rvcTrainModelName, outputModelUrl, outputModelRemoteUrl, coverReferenceAudioUrl, libraryRvcVoiceId, coverPitch, coverIndexRate, coverVocalMixPct, coverAccompanimentMixPct, voiceId, speed, volume, pitch, emotion, executeAI, onStart, projectId, showAlert, showConfirm, locale, at]);

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
      <style>{`
        .nexflow-apple-panel-range {
          -webkit-appearance: none;
          appearance: none;
          height: 4px;
          border-radius: 999px;
          outline: none;
        }
        .nexflow-apple-panel-range::-webkit-slider-thumb {
          -webkit-appearance: none;
          appearance: none;
          width: 18px;
          height: 18px;
          border-radius: 50%;
          background: #ffffff;
          border: none;
          box-shadow:
            0 0.5px 1px rgba(0, 0, 0, 0.12),
            0 2px 6px rgba(0, 0, 0, 0.18),
            0 0 0 0.5px rgba(0, 0, 0, 0.06);
          cursor: pointer;
          margin-top: -7px;
        }
        .nexflow-apple-panel-range::-webkit-slider-runnable-track {
          height: 4px;
          border-radius: 999px;
          background: transparent;
        }
        .nexflow-apple-panel-range::-moz-range-thumb {
          width: 18px;
          height: 18px;
          border-radius: 50%;
          background: #ffffff;
          border: none;
          box-shadow:
            0 0.5px 1px rgba(0, 0, 0, 0.12),
            0 2px 6px rgba(0, 0, 0, 0.18);
          cursor: pointer;
        }
        .nexflow-apple-panel-range::-moz-range-track {
          height: 4px;
          border-radius: 999px;
          background: transparent;
        }
        .nexflow-apple-panel-range:active::-webkit-slider-thumb {
          transform: scale(1.06);
        }
      `}</style>
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

      {/* 无参考音时：Doubao / Index-TTS 提供轻量选文件入口（有 @ 标签后不再占一整行） */}
      {(isDoubaoSeedAudio || isIndexTts2) &&
        onReferenceAudioUrlChange &&
        !referenceAudioDisplayName && (
        <div className="mb-1 flex items-center justify-end flex-shrink-0">
          <button
            type="button"
            onClick={async () => {
              if (typeof window.electronAPI?.showOpenAudioDialog !== 'function') return;
              const res = await window.electronAPI.showOpenAudioDialog();
              if (res.success && res.filePath) {
                onReferenceAudioUrlChange(localResourceUrlFromSavedPath(res.filePath));
              }
            }}
            title={isIndexTts2 ? at.selectFileTitle : undefined}
            aria-label={isIndexTts2 ? at.selectFileAria : undefined}
            className={`px-2 py-1 rounded-lg text-xs font-medium flex-shrink-0 transition-colors ${
              isDarkMode
                ? 'bg-blue-500/90 text-white border border-blue-400/55 hover:bg-blue-500'
                : 'bg-blue-500 text-white border border-blue-500 hover:bg-blue-600'
            }`}
          >
            {at.selectFileButton}
          </button>
        </div>
      )}
      {isRvcTrain && onRvcTrainModelNameChange && (
        <div className="mb-2 flex items-center gap-2 min-w-0 flex-shrink-0">
          <span className={`text-xs whitespace-nowrap shrink-0 ${isDarkMode ? 'text-white/70' : 'text-gray-700'}`}>
            {at.rvcTrainModelLabel}
          </span>
          <input
            type="text"
            value={rvcTrainModelName}
            onChange={(e) => onRvcTrainModelNameChange(e.target.value)}
            placeholder={at.rvcTrainModelPlaceholder}
            className={`flex-1 min-w-0 px-2 py-1 rounded-lg text-xs ${
              isDarkMode ? 'bg-black/30 text-white border border-gray-600/50 placeholder:text-white/40' : 'bg-white/90 text-gray-900 border border-gray-300 placeholder:text-gray-500'
            } outline-none`}
          />
        </div>
      )}

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

      {/* 参考音 / 文本 / 原曲 @ 标签同一排 */}
      {(isTextConnected || isSourceSongConnected || !!referenceAudioDisplayName || isAudioConnected) && (
        <div className="mb-1 flex flex-wrap items-center gap-1.5 flex-shrink-0">
          {referenceAudioDisplayName ? (
            <span
              className={`inline-flex items-center max-w-[220px] px-1.5 py-0.5 rounded-md text-[11px] font-semibold truncate ${
                isDarkMode ? 'bg-sky-500/25 text-sky-300' : 'bg-sky-100 text-sky-700'
              }`}
              title={referenceAudioUrl || at.linkedRefAudioTagTitle}
            >
              @{referenceAudioDisplayName}
            </span>
          ) : isAudioConnected ? (
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
                <div className="mb-1 flex items-center gap-2 min-w-0">
                  <label className={`text-xs shrink-0 ${isDarkMode ? 'text-white/70' : 'text-gray-700'}`}>{at.styleDescLabel}</label>
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
                <label className={`text-xs shrink-0 ${isDarkMode ? 'text-white/70' : 'text-gray-700'}`}>{at.lyricsLabel}</label>
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
          <div className="mb-1 flex items-center gap-2 min-w-0 flex-shrink-0">
            {!isTextConnected && !isAudioConnected && !isSourceSongConnected ? (
              <label className={`text-xs shrink-0 ${isDarkMode ? 'text-white/70' : 'text-gray-700'}`}>
                {at.textContentLabel}
              </label>
            ) : null}
            <div className="flex-1" />
            {renderVoiceMicButton('text')}
          </div>
          <PromptRichInput
            ref={textInputRef}
            value={localText}
            candidates={mentionCandidates}
            readOnly={micVoiceBusy || isTextConnected}
            disabled={micVoiceBusy}
            isDarkMode={isDarkMode}
            placeholder={isDoubaoSeedAudio ? (locale === 'en' ? 'Audio generation prompt (≤3000 chars)…' : '输入音频生成提示词（≤3000 字符）…') : at.textContentPlaceholder}
            title={at.textInputTitle}
            onFocus={() => {
              if (micVoiceBusy || isTextConnected) return;
              textInputFocusedRef.current = true;
            }}
            onCompositionChange={setTextComposing}
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
            onInputCheck={onMentionInputCheck}
            onChange={(v) => {
              if (micVoiceBusy) return;
              setLocalText(v);
              if (textDebounceRef.current) clearTimeout(textDebounceRef.current);
              textDebounceRef.current = setTimeout(() => {
                textDebounceRef.current = null;
                lastSentTextRef.current = v;
                onTextChange(v);
              }, 250);
            }}
            className={`w-full flex-1 min-h-[112px] custom-scrollbar px-0 py-1 ${
              micVoiceBusy || isTextConnected ? 'opacity-45 cursor-not-allowed' : ''
            }`}
            style={{ caretColor: isDarkMode ? '#0A84FF' : '#22c55e' }}
          />
          <AtMentionMenu {...mentionMenuProps} />
        </div>
        )}

        {/* 右侧：语速/音量/音调（MiniMax 或 Doubao）— 苹果风格滑块 */}
        {isDoubaoSeedAudio && (
          <div className="w-44 flex-shrink-0 flex flex-col gap-3.5 justify-center pl-1">
            <div className="flex flex-col gap-1.5">
              <label className={`text-[11px] font-medium tracking-wide ${isDarkMode ? 'text-white/55' : 'text-gray-500'}`}>
                {at.doubaoSpeechRateLabel(String(clampDoubaoSpeechRate(speechRate)))}
              </label>
              <ApplePanelRange
                isDarkMode={isDarkMode}
                min={-50}
                max={100}
                step={1}
                value={clampDoubaoSpeechRate(speechRate)}
                onChange={(v) => onSpeechRateChange?.(v)}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className={`text-[11px] font-medium tracking-wide ${isDarkMode ? 'text-white/55' : 'text-gray-500'}`}>
                {at.doubaoLoudnessRateLabel(String(clampDoubaoLoudnessRate(loudnessRate)))}
              </label>
              <ApplePanelRange
                isDarkMode={isDarkMode}
                min={-50}
                max={100}
                step={1}
                value={clampDoubaoLoudnessRate(loudnessRate)}
                onChange={(v) => onLoudnessRateChange?.(v)}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className={`text-[11px] font-medium tracking-wide ${isDarkMode ? 'text-white/55' : 'text-gray-500'}`}>
                {at.pitchLabel(`${pitch > 0 ? '+' : ''}${clampDoubaoPitchRate(pitch)}`)}
              </label>
              <ApplePanelRange
                isDarkMode={isDarkMode}
                min={-12}
                max={12}
                step={1}
                value={clampDoubaoPitchRate(pitch)}
                onChange={(v) => onPitchChange(v)}
              />
            </div>
          </div>
        )}
        {!isIndexTts2 && !isDoubaoSeedAudio && !isRhartSong && !isAudioCover && !isRvcTrain && (
          <div className="w-44 flex-shrink-0 flex flex-col gap-3.5 justify-center pl-1">
            <div className="flex flex-col gap-1.5">
              <label className={`text-[11px] font-medium tracking-wide ${isDarkMode ? 'text-white/55' : 'text-gray-500'}`}>
                {at.speedLabel(speed.toFixed(1))}
              </label>
              <ApplePanelRange
                isDarkMode={isDarkMode}
                min={0.5}
                max={2}
                step={0.1}
                value={speed}
                onChange={onSpeedChange}
                title={at.speedLabel(speed.toFixed(1))}
                aria-label={at.speedAria}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className={`text-[11px] font-medium tracking-wide ${isDarkMode ? 'text-white/55' : 'text-gray-500'}`}>
                {at.volumeLabel(volume.toFixed(1))}
              </label>
              <ApplePanelRange
                isDarkMode={isDarkMode}
                min={0.1}
                max={10}
                step={0.1}
                value={volume}
                onChange={onVolumeChange}
                title={at.volumeLabel(volume.toFixed(1))}
                aria-label={at.volumeAria}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className={`text-[11px] font-medium tracking-wide ${isDarkMode ? 'text-white/55' : 'text-gray-500'}`}>
                {at.pitchLabel(`${pitch > 0 ? '+' : ''}${pitch}`)}
              </label>
              <ApplePanelRange
                isDarkMode={isDarkMode}
                min={-12}
                max={12}
                step={1}
                value={pitch}
                onChange={onPitchChange}
                title={at.pitchLabel(`${pitch > 0 ? '+' : ''}${pitch}`)}
                aria-label={at.pitchAria}
              />
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
