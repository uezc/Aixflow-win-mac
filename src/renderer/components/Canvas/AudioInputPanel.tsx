// @ts-nocheck
import React, { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import { Play, Mic, Loader2 } from 'lucide-react';
import { useReferenceMicRecording, localResourceUrlFromSavedPath } from '../../hooks/useReferenceMicRecording';
import { useAI } from '../../hooks/useAI';
import { useDarkAlert } from '../../contexts/DarkAlertContext';
import { isModelNotPricedError } from '../../utils/priceCalc';
import { getAudioDisplayPrice } from '../../utils/cloudModelPricing';
import { useNxModelPricing } from '../../contexts/NxModelPricingContext';
import { useAppLocale } from '../../contexts/AppLocaleContext';
import { workspaceChromeT } from '../../i18n/workspaceI18n';
import { isAudioSongModel } from '../../utils/audioSongModels';
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

const audioModelOptions = filterActiveAudioModelOptions([
  { value: 'speech-2.8-hd', label: 'MiniMax 2.8 HD' },
  { value: 'index-tts2', label: 'Index-TTS 2.0' },
  { value: 'rhart-song-v5.5', label: 'SUNO v5.5' },
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
  /** 全能写歌：歌曲名 / 风格描述 / 歌词 */
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
  onSongNameChange?: (value: string) => void;
  onStyleDescChange?: (value: string) => void;
  onLyricsChange?: (value: string) => void;
  onOutputAudioChange: (audioUrl: string, originalUrl?: string) => void;
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
  onSongNameChange,
  onStyleDescChange,
  onLyricsChange,
  onOutputAudioChange,
}) => {
  const { cloudMap } = useNxModelPricing();
  const { locale } = useAppLocale();
  const at = useMemo(() => audioInputPanelT(locale), [locale]);
  const wc = useMemo(() => workspaceChromeT(locale), [locale]);
  const [micVoiceBusy, setMicVoiceBusy] = useState(false);
  const voiceMergeTargetRef = useRef<'text' | 'lyrics' | 'styleDesc'>('text');
  const isIndexTts2 = model === 'index-tts2';
  const isRhartSong = isAudioSongModel(model);

  useEffect(() => {
    if (!isRetiredAudioModel(model) || !onModelChange) return;
    onModelChange(normalizeAudioModelIfRetired(model));
  }, [model, onModelChange]);

  /** 有参考音时自动切到 Index-TTS 2.0（写歌模型不强制切换） */
  useEffect(() => {
    const ref = (referenceAudioUrl || '').trim();
    if (!ref || !onModelChange) return;
    if (isAudioSongModel(model)) return;
    if (model !== 'index-tts2') {
      onModelChange('index-tts2');
    }
  }, [referenceAudioUrl, model, onModelChange]);
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
        // SUCCESS 状态：更新输出音频
        const audioUrl = packet.payload?.url || packet.payload?.audioUrl;
        const originalUrl = packet.payload?.originalAudioUrl;
        
        if (audioUrl) {
          onOutputAudioChange(audioUrl, originalUrl);
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
        onOutputAudioChange(audioUrl, originalUrl);
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
    } else if (!effectiveText) {
      return;
    }

    onStart?.();

    try {
      const requestParams: any = {
        model,
        text: (effectiveText || '').trim(),
        enable_base64_output: false,
        english_normalization: false,
      };
      if (isRhartSong) {
        requestParams.songName = (songName ?? '').trim();
        requestParams.styleDesc = (styleDesc ?? '').trim();
        requestParams.lyrics = (lyrics ?? '').trim();
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
  }, [flushTextSync, localText, model, isIndexTts2, isRhartSong, songName, styleDesc, lyrics, referenceAudioUrl, voiceId, speed, volume, pitch, emotion, executeAI, onStart, projectId]);

  const isRunDisabled =
    aiStatus === 'PROCESSING' ||
    (isRhartSong
      ? !(songName ?? '').trim() || !(styleDesc ?? '').trim() || !(lyrics ?? '').trim()
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
          {!isIndexTts2 && !isRhartSong && (
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
        </div>

        {/* 右侧：价格 + 运行按钮（与图片模块一致：价格在左、按钮在右） */}
        <div className="flex items-center gap-2 flex-shrink-0">
          {(() => {
            if (!model) return null;
            try {
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
                {at.generating}
              </>
            ) : (
              <>
                <Play className="w-3 h-3" />
                {at.generateAudio}
              </>
            )}
          </button>
        </div>
      </div>

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

        {/* 右侧：语速/音量/音调（仅语音合成模型） */}
        {!isIndexTts2 && !isRhartSong && (
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
