// @ts-nocheck
import React, { useCallback, useRef, useEffect, useState, useMemo } from 'react';
import { Play, ChevronUp, ChevronDown, Mic, Loader2, Video, Check, Image as ImageIcon } from 'lucide-react';
import { useAI } from '../../hooks/useAI';
import { useAppLocale } from '../../contexts/AppLocaleContext';
import { useDarkAlert } from '../../contexts/DarkAlertContext';
import { videoInputPanelT } from '../../i18n/videoInputPanelI18n';
import { audioInputPanelT } from '../../i18n/audioInputPanelI18n';
import { workspaceChromeT } from '../../i18n/workspaceI18n';
import {
  useReferenceMicRecording,
} from '../../hooks/useReferenceMicRecording';
import { canvasBottomInputPanelShell } from '../../theme/canvasBottomInputPanel';
import { isModelNotPricedError } from '../../utils/priceCalc';
import { getVideoDisplayPrice } from '../../utils/cloudModelPricing';
import {
  GROK3_DURATION_SEC_OPTIONS,
  GROK3_STABLE_DURATION_SEC_OPTIONS,
  normalizeGrok3DurationStr,
  normalizeGrok3StableDurationStr,
  SEEDANCE_DURATION_SEC_OPTIONS,
  normalizeSeedanceDurationChoice,
  coerceSeedanceResolution,
  GEMINI_OMNI_DURATION_SEC_OPTIONS,
  normalizeGeminiOmniDurationChoice,
} from '../../utils/videoBillingSku';
import { useNxModelPricing } from '../../contexts/NxModelPricingContext';
import { HIDE_SORA2_AND_SORA_CHARACTER_UI, DEFAULT_VIDEO_MODEL_REPLACING_SORA2 } from '../../config/sora2UiPolicy';
import {
  filterActiveVideoModels,
  isRetiredVideoModel,
  normalizeVideoModelIfRetired,
} from '../../config/videoModelUiPolicy';
import {
  LTX23_HDR_MAX_STORYBOARD,
  LTX23_HDR_MIN_STORYBOARD,
  buildLtx23HdrMultiPayload,
  isLtx23HdrMultiRunnable,
  validateLtx23HdrMultiInputs,
  normalizeLtx23HdrStoryboardSlots,
  splitLtx23HdrMultiImagesFromCollected,
} from '../../../common/ltx23HdrMulti';

/** 判断 AI 返回的地址是否应视为视频（含 local-resource 无扩展名但带 localPath 的情况） */
function isLikelyGeneratedVideoUrl(
  url: string,
  extras?: { localPath?: string; originalVideoUrl?: string },
): boolean {
  const u = String(url || '').trim();
  if (!u) return false;
  if (/\.(mp4|webm|mov|avi|mkv)$/i.test(u)) return true;
  if (/^https?:\/\//i.test(u)) return true;
  if (u.startsWith('local-resource://') || u.startsWith('file://')) {
    if (extras?.localPath || extras?.originalVideoUrl) return true;
    return /\.(mp4|webm|mov|avi|mkv)$/i.test(u);
  }
  return false;
}

interface VideoInputPanelProps {
  nodeId: string;
  isDarkMode: boolean;
  prompt: string;
  aspectRatio: '16:9' | '9:16' | '1:1' | '2:3' | '3:2';
  model: 'sora-2' | 'sora-2-pro' | 'kling-v2.6-pro' | 'kling-video-o1' | 'kling-video-o1-i2v' | 'kling-video-o1-start-end' | 'kling-video-o1-ref' | 'wan-2.6' | 'wan-2.6-flash' | 'wan-animate' | 'hey-gem' | 'gemini-omni' | 'seedance-2.0-fast' | 'seedance-2.0-mini' | 'ltx-2.3-lipsync' | 'ltx-2.3-i2v' | 'ltx-2.3-t2v' | 'ltx-2.3-hdr-multi' | 'rhart-v3.1-fast' | 'rhart-v3.1-fast-se' | 'rhart-v3.1-pro' | 'rhart-v3.1-pro-se' | 'grok-3' | 'grok-3-stable' | 'rhart-v3.1-pro-official-i2v' | 'hailuo-02-t2v-standard' | 'hailuo-2.3-t2v-standard' | 'hailuo-02-i2v-standard' | 'hailuo-2.3-i2v-standard' | 'rh-video-start-end';
  hd: boolean;
  duration: '5' | '10' | '15' | '25';
  inputImages?: string[]; // 图生视频参考图
  /** ltx-2.3-lipsync：输入音频 URL（由画布从连线解析传入） */
  inputAudioUrl?: string;
  isConnected?: boolean;
  projectId?: string; // 项目 ID（用于保存到项目文件夹）
  /** 可灵参考生视频o1：参考视频 URL（由画布从连线解析传入） */
  referenceVideoUrl?: string;
  /** 可灵参考生视频o1：是否保留参考视频原声 */
  keepOriginalSound?: boolean;
  // kling-v2.6-pro 参数
  guidanceScale?: number;
  sound?: 'true' | 'false';
  // 万相2.6 参数
  shotType?: 'single' | 'multi';
  // ltx-2.3-lipsync 参数（动作提示词复用 prompt 字段）
  resolutionLtx23Lipsync?: '720' | '1280' | '1920';
  onResolutionLtx23LipsyncChange?: (value: '720' | '1280' | '1920') => void;
  // ltx-2.3-i2v 图生视频：时长 5|10|15 秒，分辨率 720|1280|1920（标准/高清/超清），工作流默认保持参考图比例
  durationLtx23I2v?: '5' | '10' | '15';
  resolutionLtx23I2v?: '720' | '1280' | '1920';
  onDurationLtx23I2vChange?: (value: '5' | '10' | '15') => void;
  onResolutionLtx23I2vChange?: (value: '720' | '1280' | '1920') => void;
  durationLtx23T2v?: '5' | '10' | '15';
  resolutionLtx23T2v?: '720' | '1280' | '1920';
  onDurationLtx23T2vChange?: (value: '5' | '10' | '15') => void;
  onResolutionLtx23T2vChange?: (value: '720' | '1280' | '1920') => void;
  durationLtx23HdrMulti?: '5' | '10' | '15';
  resolutionLtx23HdrMulti?: '720' | '1280';
  ltx23HdrBackgroundImage?: string;
  onDurationLtx23HdrMultiChange?: (value: '5' | '10' | '15') => void;
  onResolutionLtx23HdrMultiChange?: (value: '720' | '1280') => void;
  onLtx23HdrBackgroundImageChange?: (value: string) => void;
  /** LTX2.3 高动态：分镜图顺序写回节点 data.inputImages */
  onInputImagesOrderChange?: (images: string[]) => void;
  /** Sora2 算力渠道：plugin=插件算力(RunningHub)，core=核心算力(BLTCY) */
  sora2Channel?: 'plugin' | 'core';
  onSora2ChannelChange?: (value: 'plugin' | 'core') => void;
  negativePrompt?: string;
  resolutionWan26?: '720p' | '1080p';
  durationWan26Flash?: '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | '10' | '11' | '12' | '13' | '14' | '15';
  enableAudio?: boolean;
  durationVeo31ProOfficial?: '4' | '6' | '8';
  generateAudioVeo31ProOfficial?: boolean;
  // 全能视频V3.1-fast 文生视频（仅文生，分辨率 720p|1080p|4k）
  resolutionRhartV31?: '720p' | '1080p' | '4k';
  /** Grok video3 图生视频（标准 rhart-video-g/image-to-video）：时长 6|10|15|30 秒 */
  durationGrok3?: string;
  resolutionGrok3?: '720p';
  onDurationGrok3Change?: (value: string) => void;
  onResolutionGrok3Change?: (value: '720p') => void;
  // 海螺-02 文生视频标准：仅文生，时长 6|10 秒；分辨率仅用于 FC 计费 SKU（默认 na）
  durationHailuo02?: '6' | '10';
  resolutionHailuo?: 'na' | '720p' | '1080p' | '4k';
  // 可灵文生视频o1：仅文生，时长 5|10 秒，模式 std|pro
  durationKlingO1?: '5' | '10';
  modeKlingO1?: 'std' | 'pro';
  /** WanAnimate 角色替换：输出挡位 720P / 1080P（映射 RH node 259） */
  resolutionWanAnimate?: '720p' | '1080p';
  /** WanAnimate：片段档位（工作流 node 250） */
  wanAnimateClipSec?: '5' | '8' | '10' | '15';
  onKeepOriginalSoundChange?: (value: boolean) => void;
  onGuidanceScaleChange?: (value: number) => void;
  onSoundChange?: (value: 'true' | 'false') => void;
  onShotTypeChange?: (value: 'single' | 'multi') => void;
  onNegativePromptChange?: (value: string) => void;
  onResolutionWan26Change?: (value: '720p' | '1080p') => void;
  onDurationWan26FlashChange?: (value: '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | '10' | '11' | '12' | '13' | '14' | '15') => void;
  onEnableAudioChange?: (value: boolean) => void;
  onDurationVeo31ProOfficialChange?: (value: '4' | '6' | '8') => void;
  onGenerateAudioVeo31ProOfficialChange?: (value: boolean) => void;
  onResolutionRhartV31Change?: (value: '720p' | '1080p' | '4k') => void;
  onDurationHailuo02Change?: (value: '6' | '10') => void;
  onResolutionHailuoChange?: (value: 'na' | '720p' | '1080p' | '4k') => void;
  onDurationKlingO1Change?: (value: '5' | '10') => void;
  onModeKlingO1Change?: (value: 'std' | 'pro') => void;
  onResolutionWanAnimateChange?: (value: '720p' | '1080p') => void;
  onWanAnimateClipSecChange?: (value: '5' | '8' | '10' | '15') => void;
  /** Seedance 2.0 Fast / Mini：720p|1080p（Mini 另支持 480p/2k/4k），时长 5|10|15 秒 */
  resolutionSeedance?: '480p' | '720p' | '1080p' | '2k' | '4k';
  durationSeedance?: '5' | '10' | '15';
  onResolutionSeedanceChange?: (value: '480p' | '720p' | '1080p' | '2k' | '4k') => void;
  onDurationSeedanceChange?: (value: '5' | '10' | '15') => void;
  /** Gemini Omni 图生视频：720p|1080p|4k，时长 4|6|8|10 秒 */
  resolutionGeminiOmni?: '720p' | '1080p' | '4k';
  durationGeminiOmni?: '6' | '8' | '10';
  onResolutionGeminiOmniChange?: (value: '720p' | '1080p' | '4k') => void;
  onDurationGeminiOmniChange?: (value: '6' | '8' | '10') => void;
  onPromptChange: (value: string) => void;
  onAspectRatioChange: (value: '16:9' | '9:16' | '1:1' | '2:3' | '3:2') => void;
  onModelChange: (value: 'sora-2' | 'sora-2-pro' | 'kling-v2.6-pro' | 'kling-video-o1' | 'kling-video-o1-i2v' | 'kling-video-o1-start-end' | 'kling-video-o1-ref' | 'wan-2.6' | 'wan-2.6-flash' | 'wan-animate' | 'gemini-omni' | 'seedance-2.0-fast' | 'seedance-2.0-mini' | 'ltx-2.3-lipsync' | 'ltx-2.3-i2v' | 'ltx-2.3-t2v' | 'ltx-2.3-hdr-multi' | 'rhart-v3.1-fast' | 'rhart-v3.1-fast-se' | 'rhart-v3.1-pro' | 'rhart-v3.1-pro-se' | 'grok-3' | 'grok-3-stable' | 'rhart-v3.1-pro-official-i2v' | 'hailuo-02-t2v-standard' | 'hailuo-2.3-t2v-standard' | 'hailuo-02-i2v-standard' | 'hailuo-2.3-i2v-standard' | 'rh-video-start-end') => void;
  onHdChange: (value: boolean) => void;
  onDurationChange: (value: '5' | '10' | '15' | '25') => void;
  onOutputVideoChange: (
    url?: string,
    originalUrl?: string,
    localAsset?: { poster?: string; ghost?: string; width?: number; height?: number },
  ) => void;
  onProgressChange?: (progress: number) => void;
  onProgressMessageChange?: (message: string) => void; // 进度文案更新回调
  onErrorTask?: (message: string) => void; // 任务失败时的回调（用于任务列表）
  /** 当前进度 0–100，用于面板内立即显示进度条（点击生成后无需取消选中即可看到） */
  progress?: number;
  progressMessage?: string;
  /** 独立「视频换人」画布模块：固定 WanAnimate，隐藏模型下拉，且不因图+音频强制切对口型 */
  wanAnimateStandalone?: boolean;
  /** 独立 HeyGem 数字人模块：固定 hey-gem，参考视频 + 驱动音频 */
  heyGemStandalone?: boolean;
}

const VideoInputPanel: React.FC<VideoInputPanelProps> = ({
  nodeId,
  isDarkMode,
  prompt,
  aspectRatio,
  model,
  hd,
  duration,
  inputImages = [],
  isConnected = false,
  projectId,
  onPromptChange,
  onAspectRatioChange,
  onModelChange,
  onHdChange,
  onDurationChange,
  onOutputVideoChange,
  onProgressChange,
  onProgressMessageChange,
  onErrorTask,
  progress = 0,
  progressMessage = '',
  wanAnimateStandalone = false,
  heyGemStandalone = false,
  guidanceScale = 0.5,
  sound = 'false',
  shotType = 'single',
  negativePrompt = '',
  resolutionWan26 = '1080p',
  durationWan26Flash = '5',
  enableAudio = true,
  durationVeo31ProOfficial = '4',
  generateAudioVeo31ProOfficial = false,
  resolutionRhartV31 = '1080p',
  onGuidanceScaleChange,
  onSoundChange,
  onShotTypeChange,
  onNegativePromptChange,
  onResolutionWan26Change,
  onDurationWan26FlashChange,
  onEnableAudioChange,
  onDurationVeo31ProOfficialChange,
  onGenerateAudioVeo31ProOfficialChange,
  onResolutionRhartV31Change,
  durationGrok3 = '10',
  resolutionGrok3 = '720p',
  onDurationGrok3Change,
  onResolutionGrok3Change,
  durationHailuo02 = '6',
  resolutionHailuo = 'na',
  onDurationHailuo02Change,
  onResolutionHailuoChange,
  durationKlingO1 = '5',
  modeKlingO1 = 'std',
  onDurationKlingO1Change,
  onModeKlingO1Change,
  referenceVideoUrl,
  keepOriginalSound = false,
  onKeepOriginalSoundChange,
  inputAudioUrl,
  resolutionLtx23Lipsync = '720', // 标准 720 | 高清 1280 | 超清 1920
  onResolutionLtx23LipsyncChange,
  durationLtx23I2v = '10',
  resolutionLtx23I2v = '720',
  onDurationLtx23I2vChange,
  onResolutionLtx23I2vChange,
  durationLtx23T2v = '10',
  resolutionLtx23T2v = '720',
  onDurationLtx23T2vChange,
  onResolutionLtx23T2vChange,
  durationLtx23HdrMulti = '15',
  resolutionLtx23HdrMulti = '720',
  ltx23HdrBackgroundImage = '',
  onDurationLtx23HdrMultiChange,
  onResolutionLtx23HdrMultiChange,
  onLtx23HdrBackgroundImageChange,
  onInputImagesOrderChange,
  sora2Channel = 'plugin',
  onSora2ChannelChange,
  resolutionWanAnimate = '720p',
  wanAnimateClipSec = '8',
  onResolutionWanAnimateChange,
  onWanAnimateClipSecChange,
  resolutionSeedance = '720p',
  durationSeedance = '10',
  onResolutionSeedanceChange,
  onDurationSeedanceChange,
  resolutionGeminiOmni = '720p',
  durationGeminiOmni = '6',
  onResolutionGeminiOmniChange,
  onDurationGeminiOmniChange,
}) => {
  const { locale } = useAppLocale();
  const { showAlert } = useDarkAlert();
  const vt = useMemo(() => videoInputPanelT(locale), [locale]);
  const refMicAt = useMemo(() => audioInputPanelT(locale), [locale]);
  const wc = useMemo(() => workspaceChromeT(locale), [locale]);
  const [micVoiceBusy, setMicVoiceBusy] = useState(false);
  const promptInputRef = useRef<HTMLTextAreaElement>(null);
  const dragImageIndexRef = useRef<number | null>(null);
  /** LTX2.3 高动态：'background' 或分镜 index */
  const hdrDragSourceRef = useRef<'background' | number | null>(null);
  const hdrBackgroundRef = useRef('');
  const latestOrderedImagesRef = useRef<string[]>([]);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
  const [dragOverBackground, setDragOverBackground] = useState(false);
  const [isDraggingThumb, setIsDraggingThumb] = useState(false);
  const [orderedInputImages, setOrderedInputImages] = useState<string[]>(() => (inputImages || []).slice(0, 10));
  const [hdrBackground, setHdrBackground] = useState('');
  const [storyboardImages, setStoryboardImages] = useState<string[]>(() =>
    normalizeLtx23HdrStoryboardSlots(inputImages || []),
  );
  const { cloudMap } = useNxModelPricing();
  // 本地 prompt + 防抖：修复输入法（IME）问题，避免每次按键触发父组件重渲染打断中文输入
  const [localPrompt, setLocalPrompt] = useState(prompt);
  const lastSentPromptRef = useRef(prompt);
  const promptDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const prevNodeIdRef = useRef(nodeId);
  const promptInputFocusedRef = useRef(false);
  const [promptComposing, setPromptComposing] = useState(false);
  const [promptLocal, setPromptLocal] = useState('');

  useEffect(() => {
    const nodeIdChanged = prevNodeIdRef.current !== nodeId;
    prevNodeIdRef.current = nodeId;
    if (nodeIdChanged) {
      if (promptDebounceRef.current) {
        clearTimeout(promptDebounceRef.current);
        promptDebounceRef.current = null;
      }
      promptInputFocusedRef.current = false;
      lastSentPromptRef.current = prompt;
      setLocalPrompt(prompt);
      return;
    }
    if (promptInputFocusedRef.current || promptDebounceRef.current !== null) return;
    if (prompt !== lastSentPromptRef.current) {
      lastSentPromptRef.current = prompt;
      setLocalPrompt(prompt);
    }
  }, [prompt, nodeId]);

  useEffect(() => {
    return () => {
      if (promptDebounceRef.current) {
        clearTimeout(promptDebounceRef.current);
        promptDebounceRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (model === 'ltx-2.3-hdr-multi') return;
    const incoming = (inputImages || []).slice(0, 10);
    setOrderedInputImages((prev) => {
      if (incoming.length === prev.length) {
        return incoming;
      }
      const kept = prev.filter((url) => incoming.includes(url));
      const appended = incoming.filter((url) => !kept.includes(url));
      return [...kept, ...appended];
    });
  }, [inputImages, model]);

  const storyboardImagesRef = useRef(storyboardImages);
  useEffect(() => {
    storyboardImagesRef.current = storyboardImages;
  }, [storyboardImages]);

  useEffect(() => {
    hdrBackgroundRef.current = hdrBackground;
  }, [hdrBackground]);

  useEffect(() => {
    latestOrderedImagesRef.current = orderedInputImages;
  }, [orderedInputImages]);

  const handleThumbDragStart = useCallback((index: number, e?: React.DragEvent<HTMLButtonElement>) => {
    e?.stopPropagation();
    hdrDragSourceRef.current = null;
    dragImageIndexRef.current = index;
    setIsDraggingThumb(true);
    setDragOverIndex(null);
    setDragOverBackground(false);
  }, []);

  const handleHdrDragStart = useCallback((source: 'background' | number, e?: React.DragEvent<HTMLButtonElement>) => {
    e?.stopPropagation();
    hdrDragSourceRef.current = source;
    dragImageIndexRef.current = source === 'background' ? -1 : source;
    setIsDraggingThumb(true);
    setDragOverIndex(source === 'background' ? null : source);
    setDragOverBackground(false);
  }, []);

  const handleThumbDrop = useCallback((targetIndex: number) => {
    const sourceIndex = dragImageIndexRef.current;
    if (sourceIndex == null || sourceIndex < 0 || sourceIndex === targetIndex) return;
    const next = [...latestOrderedImagesRef.current];
    const [moved] = next.splice(sourceIndex, 1);
    if (!moved) return;
    next.splice(targetIndex, 0, moved);
    latestOrderedImagesRef.current = next;
    setOrderedInputImages(next);
    dragImageIndexRef.current = targetIndex;
  }, []);

  const finalizeThumbDrag = useCallback(
    (e?: React.DragEvent<HTMLButtonElement>) => {
      e?.stopPropagation();
      if (model !== 'ltx-2.3-hdr-multi' && onInputImagesOrderChange) {
        onInputImagesOrderChange(latestOrderedImagesRef.current);
      }
      hdrDragSourceRef.current = null;
      dragImageIndexRef.current = null;
      setDragOverIndex(null);
      setDragOverBackground(false);
      setIsDraggingThumb(false);
    },
    [model, onInputImagesOrderChange],
  );

  useEffect(() => {
    if (isDraggingThumb) {
      document.body.style.cursor = 'grabbing';
      return () => {
        document.body.style.cursor = '';
      };
    }
    document.body.style.cursor = '';
    return undefined;
  }, [isDraggingThumb]);

  const appendToPrompt = useCallback((text: string) => {
    const sep = localPrompt.trim() ? ', ' : '';
    const next = localPrompt + sep + text;
    setLocalPrompt(next);
    lastSentPromptRef.current = next;
    onPromptChange(next);
    const el = promptInputRef.current;
    if (el && typeof el.focus === 'function') el.focus();
  }, [localPrompt, onPromptChange]);

  /** Seedance：点击参考图插入 @图片N（空格分隔，便于与提示词混写） */
  const appendSeedanceImageTagToPrompt = useCallback(
    (imageIndex: number) => {
      const tag = vt.appendSeedanceImageTag(imageIndex);
      const trimmedEnd = localPrompt.trimEnd();
      const needSpace = trimmedEnd.length > 0 && !/\s$/.test(localPrompt);
      const next = trimmedEnd + (needSpace ? ' ' : '') + tag;
      setLocalPrompt(next);
      lastSentPromptRef.current = next;
      onPromptChange(next);
      promptInputRef.current?.focus();
    },
    [localPrompt, onPromptChange, vt],
  );

  const mergeVoiceIntoPrompt = useCallback(
    (text: string) => {
      const t = text.trim();
      if (!t) return;
      const prev = localPrompt.trim();
      const next = prev ? `${prev}\n${t}` : t;
      setLocalPrompt(next);
      lastSentPromptRef.current = next;
      onPromptChange(next);
      promptInputRef.current?.focus();
    },
    [localPrompt, onPromptChange],
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
        mergeVoiceIntoPrompt(recognized);
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        showAlert(msg || (locale === 'en' ? 'Transcription failed.' : '语音识别失败'));
      } finally {
        setMicVoiceBusy(false);
      }
    },
    [locale, mergeVoiceIntoPrompt, projectId, showAlert],
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
      micPermissionDenied: refMicAt.micPermissionDenied,
      micSaveFailed: refMicAt.micSaveFailed,
      recordTooShort: refMicAt.recordTooShort,
      recordModalTitle: wc.textVoiceModalTitle,
      recordModalSubtitle: wc.textVoiceModalSubtitle,
      recordModalStop: refMicAt.recordModalStop,
    },
    isDarkMode,
  });

  const handleStopMicVoiceRecording = useCallback(() => {
    setMicVoiceBusy(true);
    stopMicVoiceRecording();
  }, [stopMicVoiceRecording]);

  const handlePromptVoiceInput = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      if (micVoiceBusy) return;
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

  const promptVoiceMicButton = (
    <button
      type="button"
      onClick={handlePromptVoiceInput}
      disabled={micVoiceBusy}
      className={`ml-auto relative flex h-7 w-7 shrink-0 items-center justify-center rounded border transition-colors ${
        micVoiceBusy
          ? isDarkMode
            ? 'cursor-wait border-violet-400/50 bg-violet-500/20 text-violet-200'
            : 'cursor-wait border-violet-400/60 bg-violet-100 text-violet-700'
          : isMicVoiceRecording
            ? 'border-orange-400/70 bg-orange-500/30 text-orange-100 hover:bg-orange-500/40'
            : isDarkMode
              ? 'border-white/25 bg-white/5 text-white/75 hover:bg-white/10 hover:text-white'
              : 'border-gray-300 bg-white/90 text-gray-600 hover:bg-gray-100'
      }`}
      title={
        micVoiceBusy
          ? vt.voiceTranscribing
          : isMicVoiceRecording
            ? wc.textVoiceInputStopButton
            : wc.textVoiceInputTitle
      }
      aria-label={
        micVoiceBusy
          ? vt.voiceTranscribing
          : isMicVoiceRecording
            ? wc.textVoiceInputStopButton
            : wc.textVoiceInputTitle
      }
    >
      {micVoiceBusy || isMicVoiceRecording ? (
        <Loader2
          className={`relative h-3.5 w-3.5 animate-spin ${isMicVoiceRecording && !micVoiceBusy ? 'text-orange-200' : ''}`}
          strokeWidth={2.25}
        />
      ) : (
        <Mic className="relative h-3.5 w-3.5" strokeWidth={2.25} />
      )}
    </button>
  );

  /** 图+音频同时接入时，仅显示对口型模式 */
  const hasImageAndAudio = orderedInputImages.length > 0 && !!(inputAudioUrl || '').trim();
  const isKlingModel = model === 'kling-v2.6-pro';
  const isSora2Model = model === 'sora-2';
  const isSora2ProModel = model === 'sora-2-pro';
  const isWan26Model = model === 'wan-2.6';
  const isWan26FlashModel = model === 'wan-2.6-flash';
  const isRhartV31FastModel = model === 'rhart-v3.1-fast';
  const isRhartV31FastSEModel = model === 'rhart-v3.1-fast-se';
  const isRhartV31ProSEModel = model === 'rhart-v3.1-pro-se';
  const isRhartV31ProModel = model === 'rhart-v3.1-pro'; // Veo3.1 Pro 文生视频（仅文生，固定 8s，必填 resolution）
  const isRhartV31ProOfficialI2vModel = model === 'rhart-v3.1-pro-official-i2v'; // Veo3.1 Pro 图生视频（官方 image-to-video）
  const isGrok3Model = model === 'grok-3';
  const isGrok3StableModel = model === 'grok-3-stable';
  const isHailuo02Model = model === 'hailuo-02-t2v-standard';
  const isHailuo23Model = model === 'hailuo-2.3-t2v-standard';
  const isHailuo02I2vModel = model === 'hailuo-02-i2v-standard';
  const isHailuo23I2vModel = model === 'hailuo-2.3-i2v-standard';
  const isKlingVideoO1Model = model === 'kling-video-o1';
  const isKlingVideoO1I2vModel = model === 'kling-video-o1-i2v';
  const isKlingVideoO1StartEndModel = model === 'kling-video-o1-start-end';
  const isRhVideoStartEndModel = model === 'rh-video-start-end';
  const isKlingVideoO1RefModel = model === 'kling-video-o1-ref';
  const isLtx23LipsyncModel = model === 'ltx-2.3-lipsync';
  const isLtx23I2vModel = model === 'ltx-2.3-i2v';
  const isLtx23T2vModel = model === 'ltx-2.3-t2v';
  const isLtx23HdrMultiModel = model === 'ltx-2.3-hdr-multi';
  const isWanAnimateModel = model === 'wan-animate';
  const isHeyGemModel = model === 'hey-gem' || heyGemStandalone;
  /** 独立 HeyGem / WanAnimate 模块：提交时强制模型 id，避免误走文生视频链路 */
  const effectiveVideoModel = (
    heyGemStandalone ? 'hey-gem' : wanAnimateStandalone ? 'wan-animate' : model
  ) as VideoInputPanelProps['model'];
  const isSeedanceFastModel = model === 'seedance-2.0-fast';
  const isSeedanceMiniModel = model === 'seedance-2.0-mini';
  const isSeedanceModel = isSeedanceFastModel || isSeedanceMiniModel;
  const isGeminiOmniModel = model === 'gemini-omni';

  /** LTX2.3 高动态已下架 1920，旧节点数据归一为 1280 */
  useEffect(() => {
    if (model !== 'ltx-2.3-hdr-multi') return;
    const r = String(resolutionLtx23HdrMulti ?? '');
    if (r === '1920' || r === '1080') {
      onResolutionLtx23HdrMultiChange?.('1280');
    }
  }, [model, resolutionLtx23HdrMulti, onResolutionLtx23HdrMultiChange]);

  /** 旧节点仍可能为 sora-2：面板打开后归一到替代模型并写回（与 onModelChange 一致） */
  useEffect(() => {
    if (!HIDE_SORA2_AND_SORA_CHARACTER_UI) return;
    if (model === 'sora-2' || model === 'sora-2-pro') {
      onModelChange(DEFAULT_VIDEO_MODEL_REPLACING_SORA2);
    }
  }, [model, onModelChange]);

  /** 全能视频 G（Grok 1.5）已下线，迁移到 Grok video3 */
  useEffect(() => {
    if (model === 'rhart-video-g') {
      onModelChange('grok-3');
      onDurationGrok3Change?.('10');
      onResolutionGrok3Change?.('720p');
      onAspectRatioChange('16:9');
    }
  }, [model, onModelChange, onDurationGrok3Change, onResolutionGrok3Change, onAspectRatioChange]);

  /** 可灵 / 万相 / 海螺 已从前端下架，迁移到默认视频模型 */
  useEffect(() => {
    if (!isRetiredVideoModel(model)) return;
    const next = normalizeVideoModelIfRetired(model);
    onModelChange(next as Parameters<typeof onModelChange>[0]);
    if (next === 'grok-3' || next === 'grok-3-stable') {
      onDurationGrok3Change?.('10');
      onResolutionGrok3Change?.('720p');
    }
  }, [model, onModelChange, onDurationGrok3Change, onResolutionGrok3Change]);

  useEffect(() => {
    if (model === 'grok-3' && resolutionGrok3 !== '720p') {
      onResolutionGrok3Change?.('720p');
    }
  }, [model, resolutionGrok3, onResolutionGrok3Change]);

  useEffect(() => {
    if (model !== 'grok-3') return;
    const normalized = normalizeGrok3DurationStr(durationGrok3, '10');
    if (durationGrok3 !== normalized) onDurationGrok3Change?.(normalized);
  }, [model, durationGrok3, onDurationGrok3Change]);

  useEffect(() => {
    if (model === 'grok-3-stable' && resolutionGrok3 !== '720p') {
      onResolutionGrok3Change?.('720p');
    }
  }, [model, resolutionGrok3, onResolutionGrok3Change]);

  useEffect(() => {
    if (model !== 'grok-3-stable') return;
    const normalized = normalizeGrok3StableDurationStr(durationGrok3, '10');
    if (durationGrok3 !== normalized) onDurationGrok3Change?.(normalized);
  }, [model, durationGrok3, onDurationGrok3Change]);

  useEffect(() => {
    if (!isLtx23HdrMultiModel) return;
    const collected: string[] = [];
    const pushUnique = (u: string) => {
      const t = String(u || '').trim();
      if (!t || collected.includes(t)) return;
      collected.push(t);
    };
    pushUnique(ltx23HdrBackgroundImage || '');
    (inputImages || []).forEach(pushUnique);
    const split = splitLtx23HdrMultiImagesFromCollected(collected, ltx23HdrBackgroundImage);
    setHdrBackground(split.background);
    setStoryboardImages(split.storyboard);
  }, [isLtx23HdrMultiModel, ltx23HdrBackgroundImage, inputImages]);

  const commitStoryboardSlots = useCallback(
    (next: string[]) => {
      const normalized = normalizeLtx23HdrStoryboardSlots(next);
      setStoryboardImages(normalized);
      onInputImagesOrderChange?.(normalized);
    },
    [onInputImagesOrderChange],
  );

  const assignHdrBackground = useCallback(
    (url: string) => {
      const trimmed = String(url || '').trim();
      if (!trimmed) return;
      setHdrBackground(trimmed);
      onLtx23HdrBackgroundImageChange?.(trimmed);
      setStoryboardImages((prev) => {
        const next = normalizeLtx23HdrStoryboardSlots(prev);
        const idx = next.indexOf(trimmed);
        if (idx >= 0) next[idx] = '';
        onInputImagesOrderChange?.(next);
        return next;
      });
    },
    [onLtx23HdrBackgroundImageChange, onInputImagesOrderChange],
  );

  /** 将背景图移回分镜区（点击背景缩略图或拖到分镜区） */
  const demoteBackgroundToStoryboard = useCallback(
    (insertIndex?: number) => {
      const bg = hdrBackgroundRef.current?.trim();
      if (!bg) return;
      setHdrBackground('');
      onLtx23HdrBackgroundImageChange?.('');
      setStoryboardImages((prev) => {
        const next = normalizeLtx23HdrStoryboardSlots(prev);
        const targetIdx =
          typeof insertIndex === 'number'
            ? Math.max(0, Math.min(insertIndex, LTX23_HDR_MAX_STORYBOARD - 1))
            : next.findIndex((s) => !s);
        const idx = targetIdx >= 0 ? targetIdx : 0;
        next[idx] = bg;
        onInputImagesOrderChange?.(next);
        return next;
      });
    },
    [onLtx23HdrBackgroundImageChange, onInputImagesOrderChange],
  );

  const reorderStoryboardImages = useCallback(
    (next: string[]) => {
      commitStoryboardSlots(next);
    },
    [commitStoryboardSlots],
  );

  /** 背景与指定分镜互换（拖放释放时调用） */
  const swapBackgroundWithStoryboard = useCallback(
    (storyIndex: number) => {
      const sb = normalizeLtx23HdrStoryboardSlots(storyboardImagesRef.current);
      const sbUrl = sb[storyIndex]?.trim() || '';
      const bg = hdrBackgroundRef.current?.trim() || '';
      if (!sbUrl && !bg) return;
      if (!bg && sbUrl) {
        assignHdrBackground(sbUrl);
        return;
      }
      if (bg && !sbUrl) {
        demoteBackgroundToStoryboard(storyIndex);
        return;
      }
      sb[storyIndex] = bg;
      setHdrBackground(sbUrl);
      onLtx23HdrBackgroundImageChange?.(sbUrl);
      reorderStoryboardImages(sb);
    },
    [assignHdrBackground, demoteBackgroundToStoryboard, onLtx23HdrBackgroundImageChange, reorderStoryboardImages],
  );

  const handleHdrDropOnBackground = useCallback(() => {
    const src = hdrDragSourceRef.current;
    if (src == null || src === 'background') return;
    if (typeof src === 'number') {
      swapBackgroundWithStoryboard(src);
    }
  }, [swapBackgroundWithStoryboard]);

  const handleHdrDropOnStoryboard = useCallback(
    (targetIndex: number) => {
      const src = hdrDragSourceRef.current;
      if (src === 'background') {
        swapBackgroundWithStoryboard(targetIndex);
        return;
      }
      if (typeof src === 'number' && src !== targetIndex) {
        const next = normalizeLtx23HdrStoryboardSlots(storyboardImagesRef.current);
        const moved = next[src]?.trim();
        if (!moved) return;
        const targetVal = next[targetIndex]?.trim() || '';
        next[src] = targetVal;
        next[targetIndex] = moved;
        reorderStoryboardImages(next);
      }
    },
    [swapBackgroundWithStoryboard, reorderStoryboardImages],
  );

  const storyboardSlots = useMemo(
    () => normalizeLtx23HdrStoryboardSlots(storyboardImages),
    [storyboardImages],
  );

  const hdrRequiredSlotStatus = useMemo(() => {
    const missing: string[] = [];
    if (!String(hdrBackground || '').trim()) missing.push('背景');
    for (let i = 0; i < LTX23_HDR_MIN_STORYBOARD; i++) {
      if (!String(storyboardSlots[i] || '').trim()) missing.push(`分镜${i + 1}`);
    }
    return { missing, allRequiredOk: missing.length === 0 };
  }, [hdrBackground, storyboardSlots]);

  const ltx23HdrRefImageCount = useMemo(() => {
    const bg = (hdrBackground || ltx23HdrBackgroundImage || '').trim();
    const urls: string[] = [];
    const seen = new Set<string>();
    const push = (u: string) => {
      const t = String(u || '').trim();
      if (!t || seen.has(t)) return;
      seen.add(t);
      urls.push(t);
    };
    push(bg);
    storyboardSlots.forEach(push);
    if (urls.length === 0) {
      normalizeLtx23HdrStoryboardSlots(inputImages || []).forEach(push);
    }
    return urls.length;
  }, [hdrBackground, ltx23HdrBackgroundImage, storyboardSlots, inputImages]);

  const isImageToVideoMode = isHeyGemModel
    ? false
    : isLtx23HdrMultiModel
      ? isLtx23HdrMultiRunnable(hdrBackground, storyboardSlots)
      : orderedInputImages.length > 0;

  /** 已接参考视频（无图+音频强制对口型场景） */
  const hasReferenceVideo =
    !hasImageAndAudio && !!(referenceVideoUrl || '').trim();
  /** 图 + 参考视频：角色替换 */
  const hasImageAndVideo = isImageToVideoMode && hasReferenceVideo;

  // 图生视频候选模型（再按参考图数量过滤）
  const imageToVideoModelCandidates = filterActiveVideoModels([
    ...(HIDE_SORA2_AND_SORA_CHARACTER_UI ? [] : (['sora-2'] as const)),
    'ltx-2.3-lipsync',
    'ltx-2.3-i2v',
    'ltx-2.3-hdr-multi',
    'rhart-v3.1-fast',
    'rhart-v3.1-fast-se',
    'rh-video-start-end',
    'grok-3',
    'grok-3-stable',
    'seedance-2.0-fast',
    'seedance-2.0-mini',
    'gemini-omni',
    'wan-animate',
  ] as const);

  /** 图生视频模式下，当前模型最大参考图数量（与主进程 VideoProvider 校验一致） */
  const getMaxRefImagesVideo = (m: string): number => {
    if (m === 'grok-3' || m === 'grok-3-stable') return 7;
    if (m === 'ltx-2.3-hdr-multi') return 5;
    if (m === 'seedance-2.0-fast' || m === 'seedance-2.0-mini') return 9;
    if (m === 'rhart-v3.1-fast') return 3;
    if (m === 'gemini-omni') return 3;
    if (['rhart-v3.1-fast-se', 'rh-video-start-end'].includes(m)) return 2;
    if (m === 'wan-animate') return 1;
    return 1; // sora-2, kling-v2.6-pro, wan-2.6, wan-2.6-flash, ltx-2.3-lipsync, ltx-2.3-i2v, hailuo-2.3-i2v-standard, kling-video-o1-i2v 等
  };

  /** 首尾帧类模型必须恰好 2 张；其余为 1 张起 */
  const modelSupportsRefImageCount = (m: string, count: number): boolean => {
    if (count < 1) return false;
    if (['rhart-v3.1-fast-se', 'rh-video-start-end'].includes(m)) return count === 2;
    if (m === 'ltx-2.3-hdr-multi') return count >= 3 && count <= 5;
    return count >= 1 && count <= getMaxRefImagesVideo(m);
  };

  const I2V_MODEL_DISPLAY_ORDER = [
    'sora-2',
    'ltx-2.3-lipsync',
    'ltx-2.3-i2v',
    'ltx-2.3-hdr-multi',
    'rhart-v3.1-fast',
    'rhart-v3.1-fast-se',
    'rh-video-start-end',
    'seedance-2.0-fast',
    'seedance-2.0-mini',
    'gemini-omni',
    'grok-3',
    'grok-3-stable',
    'wan-animate',
  ] as const;

  const VIDEO_I2V_MODEL_LABELS: Record<string, { label: string; title?: string }> = {
    'sora-2': { label: 'Sora2' },
    'ltx-2.3-lipsync': { label: 'LTX2.3 对口型' },
    'ltx-2.3-i2v': { label: 'LTX2.3 图生视频' },
    'ltx-2.3-hdr-multi': { label: 'LTX2.3 MSR', title: '需要 1 背景 + 至少 2 张分镜（分镜1、2 必填）' },
    'rhart-v3.1-fast': { label: 'Veo 3.1 fast' },
    'rhart-v3.1-fast-se': { label: 'Veo3.1 fast (首尾帧)' },
    'rh-video-start-end': { label: 'LTX2.3（首位帧）' },
    'seedance-2.0-fast': { label: 'Seedance 2.0 Fast', title: '支持 0–9 张参考图' },
    'seedance-2.0-mini': { label: 'Seedance 2.0 Mini', title: '支持参考图/视频/音频，0–9 张参考图' },
    'gemini-omni': { label: 'Gemini Omni', title: '图生视频：1–3 张参考图 + 提示词' },
    'grok-3': { label: 'Grok video3', title: '文生无参考图；图生 1–7 张' },
    'grok-3-stable': { label: 'Grok video3 plus', title: '参考图生 1–7 张，仅 720p，时长 6s/10s' },
    'wan-animate': { label: 'WanAnimate（角色替换）', title: '角色替换：参考图 + 参考视频' },
  };

  const maxRefImagesVideo = getMaxRefImagesVideo(model);

  useEffect(() => {
    // 海螺 02/2.3 固定单档计费，切换到该系列时重置为默认档，避免残留旧分辨率值。
    if ((isHailuo02Model || isHailuo23Model || isHailuo02I2vModel || isHailuo23I2vModel) && resolutionHailuo !== 'na') {
      onResolutionHailuoChange?.('na');
    }
  }, [isHailuo02Model, isHailuo23Model, isHailuo02I2vModel, isHailuo23I2vModel, resolutionHailuo, onResolutionHailuoChange]);

  const videoPriceLabel = useMemo(() => {
    try {
      return {
        ok: true as const,
        value: getVideoDisplayPrice(
          {
            model,
            duration,
            sound,
            durationHailuo02,
            resolutionHailuo,
            durationKlingO1,
            modeKlingO1,
            durationGrok3,
            resolutionGrok3,
            resolutionRhartV31,
            resolutionWan26,
            durationWan26Flash,
            enableAudio,
            durationVeo31ProOfficial,
            generateAudioVeo31ProOfficial,
            durationLtx23I2v,
            resolutionLtx23I2v,
            durationLtx23T2v,
            resolutionLtx23T2v,
            durationLtx23HdrMulti,
            resolutionLtx23HdrMulti,
            resolutionLtx23Lipsync,
            resolutionWanAnimate,
            wanAnimateClipSec,
            resolutionSeedance,
            durationSeedance,
            resolutionGeminiOmni,
            durationGeminiOmni,
          },
          cloudMap,
        ),
      };
    } catch (e) {
      if (isModelNotPricedError(e)) return { ok: false as const };
      throw e;
    }
  }, [
    model,
    duration,
    sound,
    durationHailuo02,
    resolutionHailuo,
    durationKlingO1,
    modeKlingO1,
    durationGrok3,
    resolutionGrok3,
    resolutionRhartV31,
    resolutionWan26,
    durationWan26Flash,
    enableAudio,
    durationVeo31ProOfficial,
    generateAudioVeo31ProOfficial,
    durationLtx23I2v,
    resolutionLtx23I2v,
    durationLtx23T2v,
    resolutionLtx23T2v,
    resolutionLtx23Lipsync,
    resolutionWanAnimate,
    wanAnimateClipSec,
    resolutionSeedance,
    durationSeedance,
    resolutionGeminiOmni,
    durationGeminiOmni,
    cloudMap,
  ]);
  // ltx-2.3-lipsync 模式：需要图+音频+动作提示词
  const isWan22LipsyncMode = isLtx23LipsyncModel;

  const imageCount = isLtx23HdrMultiModel ? ltx23HdrRefImageCount : orderedInputImages.length;

  const availableModels = useMemo(() => {
    if (hasImageAndAudio) return ['ltx-2.3-lipsync'] as const;
    if (!isImageToVideoMode) return [] as const;
    const filtered = imageToVideoModelCandidates.filter((m) => {
      if (m === 'seedance-2.0-fast' && hasReferenceVideo) return false;
      if (m === 'gemini-omni' && hasReferenceVideo) return false;
      if (m === 'wan-animate' && (!hasReferenceVideo || imageCount !== 1)) return false;
      if (m === 'ltx-2.3-lipsync' && !hasImageAndAudio) return false;
      return modelSupportsRefImageCount(m, imageCount);
    });
    const orderIdx = (m: string) => {
      const i = I2V_MODEL_DISPLAY_ORDER.indexOf(m as (typeof I2V_MODEL_DISPLAY_ORDER)[number]);
      return i === -1 ? 999 : i;
    };
    return [...filtered].sort((a, b) => orderIdx(a) - orderIdx(b)) as readonly string[];
  }, [
    hasImageAndAudio,
    isImageToVideoMode,
    imageToVideoModelCandidates,
    hasReferenceVideo,
    imageCount,
  ]);

  // 图+音频同时接入时，强制对口型模式（独立 WanAnimate 模块不切换）
  useEffect(() => {
    if (wanAnimateStandalone || heyGemStandalone) return;
    if (hasImageAndAudio && model !== 'ltx-2.3-lipsync') {
      onModelChange('ltx-2.3-lipsync');
    }
  }, [wanAnimateStandalone, hasImageAndAudio, model, onModelChange]);

  /** 图+参考视频齐备时自动切到 WanAnimate（仅在组合刚成立时，避免覆盖用户手动选型） */
  const prevWanAnimateInputsRef = useRef({
    imageAndVideoReady: false,
  });
  useEffect(() => {
    if (wanAnimateStandalone || heyGemStandalone || hasImageAndAudio) return;
    const imageAndVideoReady = hasImageAndVideo && imageCount === 1;
    const becameReady =
      imageAndVideoReady && !prevWanAnimateInputsRef.current.imageAndVideoReady;
    prevWanAnimateInputsRef.current.imageAndVideoReady = imageAndVideoReady;
    if (becameReady && model !== 'wan-animate') {
      onModelChange('wan-animate');
      onResolutionWanAnimateChange?.('720p');
      onWanAnimateClipSecChange?.('8');
    }
  }, [
    wanAnimateStandalone,
    hasImageAndAudio,
    hasImageAndVideo,
    imageCount,
    model,
    onModelChange,
    onResolutionWanAnimateChange,
    onWanAnimateClipSecChange,
  ]);

  /** 参考视频断开时，若当前为 WanAnimate 则回退默认模型 */
  useEffect(() => {
    if (wanAnimateStandalone || heyGemStandalone) return;
    if (model !== 'wan-animate' || hasReferenceVideo) return;
    onModelChange(DEFAULT_VIDEO_MODEL_REPLACING_SORA2 as Parameters<typeof onModelChange>[0]);
  }, [wanAnimateStandalone, model, hasReferenceVideo, onModelChange]);

  useEffect(() => {
    if (!isSeedanceFastModel) return;
    const normalized = coerceSeedanceResolution(resolutionSeedance, 'seedance-2.0-fast');
    if (normalized !== resolutionSeedance) {
      onResolutionSeedanceChange?.(normalized);
    }
  }, [isSeedanceFastModel, resolutionSeedance, onResolutionSeedanceChange]);

  /** Seedance Fast 不支持参考视频：接入参考视频时自动切到 Mini */
  useEffect(() => {
    if (wanAnimateStandalone || heyGemStandalone || !isSeedanceFastModel || !hasReferenceVideo) return;
    onModelChange('seedance-2.0-mini');
  }, [wanAnimateStandalone, heyGemStandalone, isSeedanceFastModel, hasReferenceVideo, onModelChange]);

  // Grok video3 / 稳定版 最多 7 张参考图：从其他模型切过来时裁掉多余
  useEffect(() => {
    if (model !== 'grok-3' && model !== 'grok-3-stable') return;
    setOrderedInputImages((prev) => (prev.length > 7 ? prev.slice(0, 7) : prev));
  }, [model]);

  // 对口型模式下，提示词为空时初始自动填入默认动作提示词
  useEffect(() => {
    if (hasImageAndAudio && isLtx23LipsyncModel && !(prompt || '').trim()) {
      onPromptChange(vt.defaultLipsyncAction);
    }
  }, [hasImageAndAudio, isLtx23LipsyncModel, prompt, onPromptChange, vt.defaultLipsyncAction]);

  // 图生视频：当前模型不支持参考图数量时自动切换
  useEffect(() => {
    if (wanAnimateStandalone || heyGemStandalone) return;
    if (isImageToVideoMode && !hasImageAndAudio) {
      if (!availableModels.includes(model as any)) {
        const defaultModel = (availableModels[0] as string) || DEFAULT_VIDEO_MODEL_REPLACING_SORA2;
        console.log(
          `[VideoInputPanel] 当前模型 ${model} 不支持 ${imageCount} 张参考图，自动切换到 ${defaultModel}`,
        );
        onModelChange(defaultModel as any);
      }
    }
  }, [wanAnimateStandalone, isImageToVideoMode, hasImageAndAudio, imageCount, model, availableModels, onModelChange]);

  // 模式标签和按钮文案
  const modeLabel = isLtx23LipsyncModel
    ? vt.modeLipsync
    : isHeyGemModel
      ? vt.heyGemInputLabel
    : isWanAnimateModel
      ? vt.wanAnimateInputLabel
      : isSeedanceModel
        ? vt.modeMultimodalVideo
        : isImageToVideoMode
        ? vt.modeImageToVideo
        : vt.modeTextToVideo;

  // 超时定时器引用
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);
  const startTimeRef = useRef<number | null>(null);
  // AI Hook
  const { status: aiStatus, execute: executeAI } = useAI({
    nodeId,
    modelId: 'video',
    onStatusUpdate: async (packet) => {
      const payload = packet.payload || {};
      
      // 处理 START 状态：显示初始进度条（优先处理，确保重新生成时能显示进度条）
      if (packet.status === 'START') {
        console.log('[VideoInputPanel] 视频生成开始（包括从 ERROR 状态重新生成），强制清除错误状态');
        // 强制清除错误信息：通过设置 progress > 0 来触发进度条显示，覆盖错误状态
        // 注意：这里需要通知 Workspace 清除 errorMessage，但由于我们没有直接访问，
        // 我们通过设置 progress 和 progressMessage 来确保进度条显示
        if (onProgressChange) {
          onProgressChange(1); // 设置为 1% 以强制显示进度条
        }
        if (onProgressMessageChange) {
          onProgressMessageChange(vt.initializing); // 清除之前的错误消息
        }
        // 启动超时定时器：SORA2/SORA2 Pro 25分钟，其他模型 15分钟
        const timeoutMinutes = (model === 'sora-2' || model === 'sora-2-pro') ? 25 : 15;
        startTimeRef.current = Date.now();
        if (timeoutRef.current) {
          clearTimeout(timeoutRef.current);
        }
        timeoutRef.current = setTimeout(() => {
          console.warn(`[VideoInputPanel] 视频生成超时（${timeoutMinutes}分钟无响应），取消任务`);
          // 清除进度条
          if (onProgressChange) {
            onProgressChange(0);
          }
          // 通知错误
          if (onErrorTask) {
            onErrorTask(`视频生成超时（${timeoutMinutes}分钟无响应）`);
          }
          // 重置超时定时器
          timeoutRef.current = null;
          startTimeRef.current = null;
        }, timeoutMinutes * 60 * 1000);
      }
      
      // 处理 ERROR 状态：停止进度条并显示错误
      if (packet.status === 'ERROR') {
        const errorMessage = payload.error || '视频生成失败';
        if ((payload as { balanceInsufficient?: boolean }).balanceInsufficient === true) {
          showAlert('余额不足\n\n您的账户余额不足以完成此次操作，请前往设置页面充值后再试。');
        }
        console.error('[VideoInputPanel] 视频生成错误:', errorMessage);
        
        // 清除超时定时器
        if (timeoutRef.current) {
          clearTimeout(timeoutRef.current);
          timeoutRef.current = null;
        }
        startTimeRef.current = null;
        
        // 停止进度条（设置为 0，但不清除，以便重新生成时能立即显示）
        if (onProgressChange) {
          onProgressChange(0);
        }
        
        // 通知任务列表（用于显示失败任务）
        if (onErrorTask) {
          onErrorTask(errorMessage);
        }
        
        return; // 不处理视频 URL，直接返回
      }
      
      // 处理 SUCCESS 状态：清除超时定时器和进度条
      if (packet.status === 'SUCCESS') {
        if (timeoutRef.current) {
          clearTimeout(timeoutRef.current);
          timeoutRef.current = null;
        }
        startTimeRef.current = null;
        // SUCCESS 状态时，清除进度条
        if (onProgressChange) {
          onProgressChange(0);
        }
      }
      
      // 显示进度信息并更新节点（仅在非 SUCCESS 状态时更新进度）
      if (packet.status !== 'SUCCESS') {
        if (packet.payload?.progress !== undefined) {
          const progressValue = packet.payload.progress;
          const progressText = packet.payload.text || vt.generatingVideo;
          // 提取进度文案（去掉百分比）
          const progressMessage = progressText.replace(/\s*\d+%$/, '').trim() || vt.generatingVideo;
          console.log(`[VideoInputPanel] 视频生成进度: ${progressValue}%`);
          // 更新节点的进度显示
          if (onProgressChange) {
            onProgressChange(progressValue);
          }
          // 更新进度文案
          if (onProgressMessageChange) {
            onProgressMessageChange(progressMessage);
          }
        } else if (packet.status === 'PROCESSING' && !packet.payload?.progress) {
          // 如果状态是 PROCESSING 但没有进度值，设置一个最小进度值以确保显示进度条
          if (onProgressChange) {
            onProgressChange(1);
          }
        }
      }
      
      // URL 嗅探：如果 payload 中包含 URL，立即更新（支持 HTTP/HTTPS 和 local-resource://）
      // 注意：并发任务时，确保使用正确的 payload（packet.payload 优先）
      const currentPayload = packet.payload || payload || {};
      const localPath = currentPayload.localPath;
      
      // 优先使用 localPath（如果存在），否则使用 url 或 videoUrl
      let videoUrl: string | undefined;
      if (localPath) {
        // 如果有本地路径，转换为 local-resource:// 格式
        let filePath = localPath.replace(/\\/g, '/');
        // 确保 Windows 路径格式正确（C:/Users 而不是 /C:/Users）
        if (filePath.match(/^\/[a-zA-Z]:/)) {
          filePath = filePath.substring(1); // 移除开头的 /
        }
        videoUrl = `local-resource://${filePath}`;
        console.log('[VideoInputPanel] 使用本地路径:', localPath, '->', videoUrl);
      } else {
        videoUrl = currentPayload.url || 
                    currentPayload.videoUrl ||
                    (typeof currentPayload.text === 'string' && 
                     currentPayload.text.match(/https?:\/\/[^\s\)]+/)?.[0]);
      }
      
      // 优先从 payload 中提取 originalVideoUrl，确保获取网络 URL
      const originalVideoUrl = currentPayload.originalVideoUrl || 
                               (videoUrl && (videoUrl.startsWith('http://') || videoUrl.startsWith('https://')) ? videoUrl : undefined);
      
      console.log('[VideoInputPanel] onStatusUpdate - nodeId:', nodeId, '视频 URL:', videoUrl);
      console.log('[VideoInputPanel] onStatusUpdate - 原始网络 URL:', originalVideoUrl);
      console.log('[VideoInputPanel] onStatusUpdate - payload:', JSON.stringify(currentPayload, null, 2));
      
      // 将 file:// 格式转换为 local-resource:// 格式
      if (videoUrl && videoUrl.startsWith('file://')) {
        let filePath = videoUrl.replace(/^file:\/\/\/?/, '');
        // 处理 Windows 路径（file:///C:/ 格式）
        if (filePath.match(/^[a-zA-Z]:/)) {
          // 已经是正确的 Windows 路径格式
        } else if (filePath.match(/^[a-zA-Z]\//)) {
          // 处理 file:///c/Users 格式，转换为 C:/Users
          filePath = filePath[0].toUpperCase() + ':' + filePath.substring(1);
        }
        videoUrl = `local-resource://${filePath.replace(/\\/g, '/')}`;
      }
      
      // 检查 URL 是否是视频文件（通过文件扩展名或协议判断）
      if (videoUrl) {
        const isVideoFile = isLikelyGeneratedVideoUrl(videoUrl, {
          localPath: currentPayload.localPath,
          originalVideoUrl: originalVideoUrl,
        });
        
        if (isVideoFile) {
          console.log('[VideoInputPanel] 检测到视频 URL:', videoUrl);
          // 清除超时定时器
          if (timeoutRef.current) {
            clearTimeout(timeoutRef.current);
            timeoutRef.current = null;
          }
          startTimeRef.current = null;
          // 视频生成后不自动上传到OSS，只在创建角色时才上传
          // 直接使用原始 URL（网络 URL 或本地路径）
          onOutputVideoChange(videoUrl, originalVideoUrl);
          // 清除进度条（视频已生成）
          if (onProgressChange) {
            onProgressChange(0);
          }
        } else {
          console.warn('[VideoInputPanel] 检测到非视频文件 URL，跳过:', videoUrl);
        }
      }
    },
    onComplete: async (payload) => {
      // 防御性检查：确保 payload 存在
      if (!payload) {
        console.warn('[VideoInputPanel] onComplete 接收到 undefined payload');
        return;
      }
      
      // URL 嗅探：如果 payload 中包含 URL，立即更新（支持 HTTP/HTTPS 和 local-resource://）
      const localPathComplete = payload?.localPath;
      let videoUrl = payload?.url || payload?.videoUrl;
      if (!videoUrl && localPathComplete) {
        let filePath = String(localPathComplete).replace(/\\/g, '/');
        if (filePath.match(/^\/[a-zA-Z]:/)) {
          filePath = filePath.substring(1);
        }
        videoUrl = `local-resource://${filePath}`;
      }
      if (!videoUrl && typeof payload?.text === 'string') {
        const localFromText = payload.text.match(/local-resource:\/\/[^\s\)]+/)?.[0];
        const httpFromText = payload.text.match(/https?:\/\/[^\s\)]+/)?.[0];
        videoUrl = localFromText || httpFromText;
      }
      
      // 验证 videoUrl 是否为有效的字符串（排除 false、null、undefined 等）
      if (!videoUrl || typeof videoUrl !== 'string' || videoUrl === 'false' || videoUrl === 'null' || videoUrl.trim() === '') {
        console.warn('[VideoInputPanel] 视频生成完成，但 URL 无效:', videoUrl, 'payload:', payload);
        // 视频生成完成，清除进度
        if (onProgressChange) {
          onProgressChange(0);
        }
        return;
      }
      
      // 优先从 payload 中提取 originalVideoUrl，确保获取网络 URL
      const originalVideoUrl = payload?.originalVideoUrl || 
                               (videoUrl && (videoUrl.startsWith('http://') || videoUrl.startsWith('https://')) ? videoUrl : undefined);
      
      console.log('[VideoInputPanel] 视频生成完成，URL:', videoUrl);
      console.log('[VideoInputPanel] 原始网络 URL:', originalVideoUrl);
      
      // 将 file:// 格式转换为 local-resource:// 格式
      if (videoUrl && videoUrl.startsWith('file://')) {
        let filePath = videoUrl.replace(/^file:\/\/\/?/, '');
        // 处理 Windows 路径（file:///C:/ 格式）
        if (filePath.match(/^[a-zA-Z]:/)) {
          // 已经是正确的 Windows 路径格式
        } else if (filePath.match(/^[a-zA-Z]\//)) {
          // 处理 file:///c/Users 格式，转换为 C:/Users
          filePath = filePath[0].toUpperCase() + ':' + filePath.substring(1);
        }
        videoUrl = `local-resource://${filePath.replace(/\\/g, '/')}`;
      }
      
      // 检查 URL 是否是视频文件（通过文件扩展名或协议判断）
      const isVideoFile = isLikelyGeneratedVideoUrl(videoUrl, {
        localPath: localPathComplete,
        originalVideoUrl: originalVideoUrl,
      });
      
      // 清除超时定时器
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
      startTimeRef.current = null;
      
      if (isVideoFile) {
        console.log('[VideoInputPanel] 视频生成完成，URL:', videoUrl);
        // 视频生成后不自动上传到OSS，只在创建角色时才上传
        // 直接使用原始 URL（网络 URL 或本地路径）
        onOutputVideoChange(videoUrl, originalVideoUrl);
        
        // 视频生成完成，清除进度
        if (onProgressChange) {
          onProgressChange(0);
        }
      } else {
        console.warn('[VideoInputPanel] 检测到非视频文件 URL，跳过:', videoUrl);
        // 即使不是视频文件，也清除进度
        if (onProgressChange) {
          onProgressChange(0);
        }
      }
    },
    onError: (error) => {
      // 严格验证 error 是否存在且格式正确
      let errorMessage = '视频生成失败';
      if (error) {
        if (typeof error === 'string') {
          errorMessage = error;
        } else if (typeof error === 'object' && error !== null) {
          errorMessage = (error as any).message || (error as any).error || String(error);
        } else {
          errorMessage = String(error);
        }
      }
      
      console.error('视频生成失败:', errorMessage, '原始错误对象:', error);
      
      // 检测余额不足错误
      const isQuotaError = errorMessage.includes('quota is not enough') || 
                          errorMessage.includes('remain quota') ||
                          errorMessage.includes('余额不足');
      
      if (isQuotaError) {
        showAlert('余额不足\n\n您的账户余额不足以完成此次操作，请前往设置页面充值后再试。');
      }
      
      // 停止进度条
      if (onProgressChange) {
        onProgressChange(0);
      }
      
      // 通知任务列表创建失败任务
      if (onErrorTask) {
        onErrorTask(errorMessage || '视频生成失败，请检查提示词或稍后重试');
      }
    },
  });

  const flushPromptSync = useCallback(() => {
    if (promptDebounceRef.current) {
      clearTimeout(promptDebounceRef.current);
      promptDebounceRef.current = null;
    }
    if (localPrompt !== lastSentPromptRef.current) {
      lastSentPromptRef.current = localPrompt;
      onPromptChange(localPrompt);
    }
  }, [localPrompt, onPromptChange]);

  const handleExecute = useCallback(async () => {
    flushPromptSync();
    if (progress > 0 && progress < 100) return;
    if (aiStatus === 'START' || aiStatus === 'PROCESSING') return;
    if (!isWanAnimateModel && !isHeyGemModel && !localPrompt.trim()) return;

    // MSR：工作流需 1 背景 + 至少 2 分镜（RH ImageResizeKJv2 要求 image2 非空）
    if (isLtx23HdrMultiModel) {
      const hdrCheck = validateLtx23HdrMultiInputs(hdrBackground, storyboardImages);
      if (!hdrCheck.ok) {
        console.error(hdrCheck.error);
        onErrorTask?.(hdrCheck.error);
        return;
      }
    } else if (isImageToVideoMode && orderedInputImages.length === 0) {
      console.error('图生视频模式但没有参考图片');
      return;
    }

    // 立即重置并显示进度条（确保每次点击运行都能看到进度条，包括从 ERROR 状态重新生成）
    // 无论之前是什么状态，都重置为初始进度
    if (onProgressChange) {
      onProgressChange(1); // 设置为 1% 以显示进度条
    }
    
    // 强制重置状态：清除错误信息，重置进度条，确保 UI 能够正确显示新的进度
    console.log('[VideoInputPanel] 开始新的视频生成，强制重置所有状态');
    
    // 清除错误信息（通过 onProgressChange 和 onProgressMessageChange 回调）
    // 注意：这里需要通过 Workspace 的 handleVideoNodeDataChange 来清除 errorMessage
    // 但由于我们没有直接访问，我们通过设置 progress > 0 来触发进度条显示
    // 实际的 errorMessage 清除会在 executeAI 调用后通过 START 状态处理
    
    // 设置初始进度（1%），确保显示进度条
    if (onProgressChange) {
      onProgressChange(1);
    }
    if (onProgressMessageChange) {
      onProgressMessageChange(vt.initializing);
    }

    try {
      // 前端只负责"传地址"，不做任何处理
      // 本地图片路径（local-resource:// 或 file://）直接发送给后端
      // 由后端的 VideoProvider.ts 接收到地址后，触发 uploadImageToOSS 方法进行转运
      // 后端转运成功拿到 https URL 后，再由后端发起请求给 RunningHub
      console.log('[VideoInputPanel] 准备发送图片路径给后端处理:', orderedInputImages);

      const payload: any = {
        prompt: isWanAnimateModel || isHeyGemModel ? '' : localPrompt,
        model: effectiveVideoModel,
      };
      if (!isHeyGemModel && !isWanAnimateModel) {
        payload.aspect_ratio = aspectRatio;
      }

      // sora-2 系列参数
      if (model === 'sora-2' || model === 'sora-2-pro') {
        payload.hd = hd;
        payload.duration = duration;
        payload.sora2Channel = sora2Channel;
      }

      // 全能视频V3.1-fast / Veo3.1 Pro 文生视频参数（分辨率 720p/1080p/4k）
      if (isRhartV31FastModel || isRhartV31ProModel || isRhVideoStartEndModel) {
        payload.resolutionRhartV31 = resolutionRhartV31;
      }
      if (isRhVideoStartEndModel) {
        payload.duration = duration;
      }

      // kling-v2.6-pro 系列参数
      if (isKlingModel) {
        payload.duration = duration;
        if (guidanceScale !== undefined) {
          payload.guidanceScale = guidanceScale;
        }
        if (sound) {
          payload.sound = sound;
        }
      }

      // 万相2.6 文生/图生视频参数
      if (isWan26Model) {
        payload.duration = duration;
        payload.shotType = shotType;
        if (negativePrompt !== undefined && negativePrompt.trim() !== '') {
          payload.negativePrompt = negativePrompt.trim();
        }
        if (isImageToVideoMode) {
          payload.resolutionWan26 = resolutionWan26;
        }
      }

      // 海螺-02/2.3 文生、海螺-02/2.3 图生视频标准参数（时长 6|10 秒）
      if (isHailuo02Model || isHailuo23Model || isHailuo02I2vModel || isHailuo23I2vModel) {
        payload.durationHailuo02 = durationHailuo02;
      }

      // 可灵文生/图生/首尾帧/参考生视频o1 参数（时长 5|10 秒，模式 std|pro）
      if (isKlingVideoO1Model || isKlingVideoO1I2vModel || isKlingVideoO1StartEndModel || isKlingVideoO1RefModel) {
        payload.durationKlingO1 = durationKlingO1;
        payload.modeKlingO1 = modeKlingO1;
      }
      if (isKlingVideoO1RefModel) {
        payload.referenceVideoUrl = (referenceVideoUrl || '').trim();
        if (keepOriginalSound) payload.keepOriginalSound = true;
      }

      if (isWanAnimateModel) {
        payload.referenceVideoUrl = (referenceVideoUrl || '').trim();
        payload.resolutionWanAnimate = resolutionWanAnimate;
        payload.wanAnimateClipSec = wanAnimateClipSec;
      }

      if (isHeyGemModel) {
        payload.referenceVideoUrl = (referenceVideoUrl || '').trim();
        payload.inputAudioUrl = (inputAudioUrl || '').trim();
      }

      if (isSeedanceModel) {
        payload.resolutionSeedance = resolutionSeedance;
        payload.durationSeedance = normalizeSeedanceDurationChoice(durationSeedance, 10);
      }

      if (isSeedanceMiniModel) {
        payload.referenceVideoUrl = (referenceVideoUrl || '').trim();
        payload.inputAudioUrl = (inputAudioUrl || '').trim();
      }

      if (isGeminiOmniModel) {
        payload.resolutionGeminiOmni = resolutionGeminiOmni;
        payload.durationGeminiOmni = normalizeGeminiOmniDurationChoice(durationGeminiOmni, 6);
        payload.aspect_ratio = aspectRatio === '9:16' ? '9:16' : '16:9';
      }

      // LTX2.3 数字人对口型参数（动作提示词复用 prompt 字段）
      if (isLtx23LipsyncModel) {
        payload.images = orderedInputImages.slice(0, 1);
        payload.inputAudioUrl = (inputAudioUrl || '').trim();
        payload.resolutionLtx23Lipsync = resolutionLtx23Lipsync;
        payload.actionPrompt = (localPrompt || '').trim() || vt.defaultLipsyncAction;
      }

      // LTX2.3 图生视频参数（时长、分辨率，工作流保持参考图比例）
      if (isLtx23I2vModel) {
        payload.durationLtx23I2v = durationLtx23I2v;
        payload.resolutionLtx23I2v = resolutionLtx23I2v;
      }

      // LTX2.3 文生视频参数（时长、分辨率、比例）
      if (isLtx23T2vModel) {
        payload.durationLtx23T2v = durationLtx23T2v;
        payload.resolutionLtx23T2v = resolutionLtx23T2v;
      }
      if (isLtx23HdrMultiModel) {
        const built = buildLtx23HdrMultiPayload(hdrBackground, storyboardImages);
        payload.ltx23HdrBackgroundImage = built.background;
        payload.images = built.storyboardSlots;
        payload.durationLtx23HdrMulti = durationLtx23HdrMulti;
        payload.resolutionLtx23HdrMulti = resolutionLtx23HdrMulti;
        payload.aspect_ratio = aspectRatio === '9:16' ? '9:16' : '16:9';
      }

      // 万相2.6 Flash 图生视频参数（仅图生，时长 2-15 秒）
      if (isWan26FlashModel) {
        payload.durationWan26Flash = durationWan26Flash;
        payload.shotType = shotType;
        payload.resolutionWan26 = resolutionWan26;
        if (negativePrompt !== undefined && negativePrompt.trim() !== '') {
          payload.negativePrompt = negativePrompt.trim();
        }
        payload.enableAudio = enableAudio;
      }

      // Veo 3.1 Pro 官方图生视频参数（仅图生）
      if (isRhartV31ProOfficialI2vModel) {
        payload.durationVeo31ProOfficial = durationVeo31ProOfficial;
        payload.generateAudioVeo31ProOfficial = generateAudioVeo31ProOfficial;
        payload.resolutionRhartV31 = resolutionRhartV31;
      }

      if (isGrok3Model || isGrok3StableModel) {
        payload.durationGrok3 = durationGrok3;
        payload.resolutionGrok3 = resolutionGrok3;
      }

      // 直接传递原始图片路径给后端，不做任何前端处理
      // 后端会检测本地路径并自动上传到 OSS
      if (isImageToVideoMode && orderedInputImages.length > 0 && !isLtx23HdrMultiModel) {
        payload.images =
          isLtx23LipsyncModel || isLtx23I2vModel || isWanAnimateModel
            ? orderedInputImages.slice(0, 1)
            : isGeminiOmniModel
              ? orderedInputImages.filter((u) => String(u || '').trim()).slice(0, 3)
            : isSeedanceModel
              ? orderedInputImages.slice(0, 9)
              : isGrok3Model || isGrok3StableModel
                ? orderedInputImages.slice(0, 7)
                : orderedInputImages.slice(0, 10);
      }

      // LTX2.3 数字人对口型参数（动作提示词使用 prompt）
      if (isLtx23LipsyncModel) {
        payload.inputAudioUrl = (inputAudioUrl || '').trim();
        payload.resolutionLtx23Lipsync = resolutionLtx23Lipsync;
        payload.actionPrompt = (localPrompt || '').trim();
      }

      // 传递 projectId 以便保存到项目文件夹
      if (projectId) {
        payload.projectId = projectId;
      }

      // 调试日志：发送最终请求前，打印所有图片路径（可能包含本地路径）
      if (isImageToVideoMode && payload.images && payload.images.length > 0) {
        console.log('[VideoInputPanel] 发送图片路径给后端处理:');
        payload.images.forEach((url: string, index: number) => {
          console.log(`  [${index}] Image Path:`, url);
          // 注意：现在允许本地路径（local-resource:// 或 file://），由后端处理
        });
      }

      await executeAI(payload);
    } catch (error: any) {
      console.error('视频生成失败:', error);
      // 传递错误给 onErrorTask
      if (onErrorTask) {
        onErrorTask(error.message || '视频生成失败，请检查提示词或稍后重试');
      }
    }
  }, [flushPromptSync, progress, aiStatus, localPrompt, model, effectiveVideoModel, aspectRatio, hd, duration, orderedInputImages, executeAI, isImageToVideoMode, isKlingModel, isKlingVideoO1Model, isKlingVideoO1I2vModel, isKlingVideoO1StartEndModel, isRhVideoStartEndModel, isKlingVideoO1RefModel, referenceVideoUrl, keepOriginalSound, isWan26Model, isWan26FlashModel, isWanAnimateModel, isHeyGemModel, isSeedanceModel, isSeedanceMiniModel, isGeminiOmniModel, isLtx23LipsyncModel, isLtx23I2vModel, isLtx23T2vModel, inputAudioUrl, resolutionLtx23Lipsync, durationLtx23I2v, resolutionLtx23I2v, durationLtx23T2v, resolutionLtx23T2v, isRhartV31FastModel, isRhartV31ProOfficialI2vModel, isHailuo02Model, isHailuo23Model, isHailuo02I2vModel, isHailuo23I2vModel, guidanceScale, sound, shotType, negativePrompt, resolutionWan26, resolutionRhartV31, durationWan26Flash, durationVeo31ProOfficial, generateAudioVeo31ProOfficial, durationHailuo02, resolutionHailuo, durationKlingO1, modeKlingO1, enableAudio, resolutionWanAnimate, wanAnimateClipSec, resolutionSeedance, durationSeedance, resolutionGeminiOmni, durationGeminiOmni, projectId, onErrorTask, isGrok3Model, durationGrok3, resolutionGrok3, showAlert, vt.initializing, onProgressChange, onProgressMessageChange]);

  // 清理超时定时器
  useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
      startTimeRef.current = null;
    };
  }, []);

  // 按钮禁用逻辑：只基于当前模块自己的状态（含节点 progress，避免重选后 aiStatus 重置导致误亮）
  const isGenerating = progress > 0 && progress < 100;
  const isAiBusy = aiStatus === 'START' || aiStatus === 'PROCESSING';
  const isRunDisabled =
    isGenerating ||
    isAiBusy ||
    (!isWanAnimateModel && !isHeyGemModel && !localPrompt.trim()) ||
    (isImageToVideoMode && !isLtx23HdrMultiModel && (!inputImages || inputImages.length === 0)) ||
    (isLtx23HdrMultiModel && !isLtx23HdrMultiRunnable(hdrBackground, storyboardImages)) ||
    (isKlingVideoO1RefModel && !(referenceVideoUrl || '').trim()) ||
    (isWanAnimateModel &&
      (!(referenceVideoUrl || '').trim() || orderedInputImages.length === 0)) ||
    (isHeyGemModel &&
      (!(referenceVideoUrl || '').trim() || !(inputAudioUrl || '').trim())) ||
    (isLtx23LipsyncModel && (!inputImages || inputImages.length === 0)) ||
    (isLtx23LipsyncModel && !(inputAudioUrl || '').trim());

  const isRunBusy = isGenerating || isAiBusy;

  // 调试日志：确认每个模块的状态是独立的
  useEffect(() => {
    console.log(`[VideoInputPanel ${nodeId}] aiStatus: ${aiStatus}, isRunDisabled: ${isRunDisabled}`);
  }, [nodeId, aiStatus, isRunDisabled]);

  return (
    <div className={canvasBottomInputPanelShell(isDarkMode)}>
      {/* 顶部控制栏 */}
      <div
        className={`flex items-center justify-between px-2 py-1.5 border-b flex-shrink-0 gap-2 ${
          isDarkMode ? 'border-gray-700/50' : 'border-gray-300/50'
        }`}
      >
        {/* 左侧：参数 */}
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <span
            className={`text-xs ${
              isDarkMode ? 'text-white/70' : 'text-gray-700'
            } truncate`}
          >
            {vt.modelLabel}
          </span>
          {wanAnimateStandalone ? (
            <span
              className={`px-2 py-1 rounded-lg text-xs whitespace-nowrap ${
                isDarkMode
                  ? 'bg-black/30 text-white border border-gray-600/50'
                  : 'bg-white/90 text-gray-900 border border-gray-300'
              }`}
              title="WanAnimate（角色替换）"
            >
              WanAnimate（角色替换）
            </span>
          ) : heyGemStandalone ? (
            <span
              className={`px-2 py-1 rounded-lg text-xs whitespace-nowrap ${
                isDarkMode
                  ? 'bg-black/30 text-white border border-gray-600/50'
                  : 'bg-white/90 text-gray-900 border border-gray-300'
              }`}
              title="HeyGem 数字人"
            >
              HeyGem 数字人
            </span>
          ) : (
          <select
            value={model}
            onChange={(e) => {
              e.stopPropagation();
              e.preventDefault();
              const newModel = e.target.value as VideoInputPanelProps['model'];
              console.log('[VideoInputPanel] 模型切换:', newModel, '当前模型:', model, 'nodeId:', nodeId);
              
              // 如果模型没有变化，直接返回
              if (newModel === model) {
                console.log('[VideoInputPanel] 模型未变化，跳过更新');
                return;
              }
              
              // 立即调用 onModelChange（这会触发父组件更新状态）
              // 使用 requestAnimationFrame 确保 UI 立即更新
              requestAnimationFrame(() => {
                onModelChange(newModel);
              });
              
              // 切换模型时自动设置默认值
              if (newModel === 'kling-v2.6-pro') {
                // kling 系列默认值
                if (onDurationChange) {
                  onDurationChange('10');
                }
              } else if (newModel === 'wan-2.6') {
                if (onDurationChange) onDurationChange('5');
                if (onShotTypeChange) onShotTypeChange('single');
                if (onResolutionWan26Change) onResolutionWan26Change('1080p');
              } else if (newModel === 'wan-2.6-flash') {
                if (onDurationWan26FlashChange) onDurationWan26FlashChange('5');
                if (onShotTypeChange) onShotTypeChange('single');
                if (onResolutionWan26Change) onResolutionWan26Change('1080p');
                if (onEnableAudioChange) onEnableAudioChange(true);
              } else if (newModel === 'rhart-v3.1-fast' || newModel === 'rhart-v3.1-fast-se') {
                if (onResolutionRhartV31Change) onResolutionRhartV31Change('1080p');
                if (onAspectRatioChange) onAspectRatioChange('16:9');
              } else if (newModel === 'grok-3') {
                if (onAspectRatioChange) onAspectRatioChange('16:9');
                onDurationGrok3Change?.('10');
                onResolutionGrok3Change?.('720p');
              } else if (newModel === 'grok-3-stable') {
                onDurationGrok3Change?.('10');
                onResolutionGrok3Change?.('720p');
              } else if (newModel === 'ltx-2.3-lipsync') {
                if (onResolutionLtx23LipsyncChange) onResolutionLtx23LipsyncChange('720'); // 标准
              } else if (newModel === 'ltx-2.3-i2v') {
                if (onDurationLtx23I2vChange) onDurationLtx23I2vChange('10');
                if (onResolutionLtx23I2vChange) onResolutionLtx23I2vChange('720');
              } else if (newModel === 'ltx-2.3-t2v') {
                if (onDurationLtx23T2vChange) onDurationLtx23T2vChange('10');
                if (onResolutionLtx23T2vChange) onResolutionLtx23T2vChange('720');
                if (onAspectRatioChange) onAspectRatioChange('16:9');
              } else if (newModel === 'ltx-2.3-hdr-multi') {
                if (onDurationLtx23HdrMultiChange) onDurationLtx23HdrMultiChange('15');
                if (onResolutionLtx23HdrMultiChange) onResolutionLtx23HdrMultiChange('720');
                if (onAspectRatioChange) onAspectRatioChange('16:9');
                const collected: string[] = [];
                const pushUnique = (u: string) => {
                  const t = String(u || '').trim();
                  if (!t || collected.includes(t)) return;
                  collected.push(t);
                };
                pushUnique(ltx23HdrBackgroundImage || hdrBackgroundRef.current || '');
                latestOrderedImagesRef.current.forEach(pushUnique);
                (inputImages || []).forEach(pushUnique);
                if (collected.length > 0) {
                  const split = splitLtx23HdrMultiImagesFromCollected(
                    collected,
                    ltx23HdrBackgroundImage || hdrBackgroundRef.current || '',
                  );
                  setHdrBackground(split.background);
                  setStoryboardImages(split.storyboard);
                  onLtx23HdrBackgroundImageChange?.(split.background);
                  onInputImagesOrderChange?.(split.storyboard);
                }
              } else if (newModel === 'rh-video-start-end') {
                if (onDurationChange) onDurationChange('5');
                if (onResolutionRhartV31Change) onResolutionRhartV31Change('1080p');
                if (onAspectRatioChange) onAspectRatioChange('9:16');
              } else if (newModel === 'wan-animate') {
                if (onResolutionWanAnimateChange) onResolutionWanAnimateChange('720p');
                if (onWanAnimateClipSecChange) onWanAnimateClipSecChange('8');
              } else {
                // sora-2 系列默认值
                if (isSora2Model) {
                  // sora-2 使用 runninghub-api，只支持 duration: [10, 15], aspectRatio: [9:16, 16:9]
                  if (onDurationChange) {
                    onDurationChange('10');
                  }
                  if (onAspectRatioChange) {
                    onAspectRatioChange('16:9');
                  }
                } else {
                  // sora-2-pro 默认值
                  if (onHdChange) {
                    onHdChange(false);
                  }
                  if (onDurationChange) {
                    onDurationChange('10');
                  }
                }
              }
            }}
            onClick={(e) => {
              e.stopPropagation();
            }}
            onMouseDown={(e) => {
              e.stopPropagation();
            }}
            className={`px-2 py-1 rounded-lg text-xs ${
              isDarkMode
                ? 'bg-black/30 text-white border border-gray-600/50'
                : 'bg-white/90 text-gray-900 border border-gray-300'
            } outline-none`}
            title={vt.chooseModelTitle}
          >
            {hasImageAndAudio ? (
              // 图+音频同时存在：仅对口型
              <>
                <option value="ltx-2.3-lipsync">LTX2.3 对口型</option>
              </>
            ) : isImageToVideoMode ? (
              availableModels.map((m) => {
                const meta = VIDEO_I2V_MODEL_LABELS[m] || { label: m };
                return (
                  <option key={m} value={m} title={meta.title}>
                    {meta.label}
                  </option>
                );
              })
            ) : (
              <>
                {!HIDE_SORA2_AND_SORA_CHARACTER_UI ? (
                  <>
                    <option value="sora-2">Sora2</option>
                    <option value="sora-2-pro">Sora2 Pro</option>
                  </>
                ) : null}
                <option value="ltx-2.3-t2v">LTX2.3 文生视频</option>
                {!hasReferenceVideo ? (
                  <option value="seedance-2.0-fast" title="文/图多模态，最多 9 张参考图">Seedance 2.0 Fast</option>
                ) : null}
                <option value="seedance-2.0-mini" title="文/图/视频多模态，支持参考视频与音频">Seedance 2.0 Mini</option>
                <option value="rhart-v3.1-fast">Veo3.1 fast</option>
                <option value="grok-3" title="文生无参考图；图生 1–7 张">Grok video3</option>
                <option value="grok-3-stable" title="参考图生 1–7 张，仅 720p">Grok video3 plus</option>
                {hasReferenceVideo ? (
                  <option value="wan-animate" title="角色替换：参考图 + 参考视频">
                    WanAnimate（角色替换）
                  </option>
                ) : null}
              </>
            )}
          </select>
          )}

          {/* LTX2.3 对口型：分辨率 标准(720)/高清(1280)/超清(1920)，无时长选项 */}
          {isLtx23LipsyncModel && (
            <>
              <span className={`text-xs ${isDarkMode ? 'text-white/70' : 'text-gray-700'}`}>{vt.resolutionLabel}</span>
              <select
                value={resolutionLtx23Lipsync}
                onChange={(e) => onResolutionLtx23LipsyncChange?.(e.target.value as '720' | '1280' | '1920')}
                className={`px-2 py-1 rounded-lg text-xs ${
                  isDarkMode ? 'bg-black/30 text-white border border-gray-600/50' : 'bg-white/90 text-gray-900 border border-gray-300'
                } outline-none`}
                title={vt.titleLtxLipsyncResolution}
              >
                <option value="720">{vt.resStandard}</option>
                <option value="1280">{vt.resHD}</option>
                <option value="1920">{vt.resUHD}</option>
              </select>
            </>
          )}

          {/* LTX2.3 图生视频：时长 5|10|15 秒，分辨率 标准720P/高清1280/超清1920，比例 16:9|9:16 */}
          {isLtx23I2vModel && (
            <>
              <span className={`text-xs ${isDarkMode ? 'text-white/70' : 'text-gray-700'}`}>{vt.durationLabel}</span>
              <select
                value={durationLtx23I2v}
                onChange={(e) => onDurationLtx23I2vChange?.(e.target.value as '5' | '10' | '15')}
                className={`px-2 py-1 rounded-lg text-xs ${
                  isDarkMode ? 'bg-black/30 text-white border border-gray-600/50' : 'bg-white/90 text-gray-900 border border-gray-300'
                } outline-none`}
                title={vt.titleLtxI2vDuration}
              >
                <option value="5">{vt.secSuffix(5)}</option>
                <option value="10">{vt.secSuffix(10)}</option>
                <option value="15">{vt.secSuffix(15)}</option>
              </select>
              <span className={`text-xs ${isDarkMode ? 'text-white/70' : 'text-gray-700'}`}>{vt.resolutionLabel}</span>
              <select
                value={resolutionLtx23I2v}
                onChange={(e) => onResolutionLtx23I2vChange?.(e.target.value as '720' | '1280' | '1920')}
                className={`px-2 py-1 rounded-lg text-xs ${
                  isDarkMode ? 'bg-black/30 text-white border border-gray-600/50' : 'bg-white/90 text-gray-900 border border-gray-300'
                } outline-none`}
                title={vt.titleLtxI2vResolution}
              >
                <option value="720">{vt.resStandard720p}</option>
                <option value="1280">{vt.resHD1280}</option>
                <option value="1920">{vt.resUHD1920}</option>
              </select>
            </>
          )}

          {/* LTX2.3 文生视频：时长、分辨率、比例（需换算宽高传入） */}
          {isLtx23T2vModel && (
            <>
              <span className={`text-xs ${isDarkMode ? 'text-white/70' : 'text-gray-700'}`}>{vt.durationLabel}</span>
              <select
                value={durationLtx23T2v}
                onChange={(e) => onDurationLtx23T2vChange?.(e.target.value as '5' | '10' | '15')}
                className={`px-2 py-1 rounded-lg text-xs ${
                  isDarkMode ? 'bg-black/30 text-white border border-gray-600/50' : 'bg-white/90 text-gray-900 border border-gray-300'
                } outline-none`}
                title={vt.titleLtxT2vDuration}
              >
                <option value="5">{vt.secSuffix(5)}</option>
                <option value="10">{vt.secSuffix(10)}</option>
                <option value="15">{vt.secSuffix(15)}</option>
              </select>
              <span className={`text-xs ${isDarkMode ? 'text-white/70' : 'text-gray-700'}`}>{vt.resolutionLabel}</span>
              <select
                value={resolutionLtx23T2v}
                onChange={(e) => onResolutionLtx23T2vChange?.(e.target.value as '720' | '1280' | '1920')}
                className={`px-2 py-1 rounded-lg text-xs ${
                  isDarkMode ? 'bg-black/30 text-white border border-gray-600/50' : 'bg-white/90 text-gray-900 border border-gray-300'
                } outline-none`}
                title={vt.titleLtxT2vResolution}
              >
                <option value="720">{vt.resStandard720p}</option>
                <option value="1280">{vt.resHD1280}</option>
                <option value="1920">{vt.resUHD1920}</option>
              </select>
              <span className={`text-xs ${isDarkMode ? 'text-white/70' : 'text-gray-700'}`}>{vt.aspectRatioLabel}</span>
              <select
                value={aspectRatio}
                onChange={(e) => onAspectRatioChange(e.target.value as '16:9' | '9:16')}
                className={`px-2 py-1 rounded-lg text-xs ${
                  isDarkMode ? 'bg-black/30 text-white border border-gray-600/50' : 'bg-white/90 text-gray-900 border border-gray-300'
                } outline-none`}
                title={vt.titleLtxT2vAspect}
              >
                <option value="16:9">{vt.aspect169Landscape}</option>
                <option value="9:16">{vt.aspect916Portrait}</option>
              </select>
            </>
          )}

          {isLtx23HdrMultiModel && (
            <>
              <span className={`text-xs ${isDarkMode ? 'text-white/70' : 'text-gray-700'}`}>{vt.durationLabel}</span>
              <select
                value={durationLtx23HdrMulti}
                onChange={(e) => onDurationLtx23HdrMultiChange?.(e.target.value as '5' | '10' | '15')}
                className={`px-2 py-1 rounded-lg text-xs ${
                  isDarkMode ? 'bg-black/30 text-white border border-gray-600/50' : 'bg-white/90 text-gray-900 border border-gray-300'
                } outline-none`}
              >
                <option value="5">{vt.secSuffix(5)}</option>
                <option value="10">{vt.secSuffix(10)}</option>
                <option value="15">{vt.secSuffix(15)}</option>
              </select>
              <span className={`text-xs ${isDarkMode ? 'text-white/70' : 'text-gray-700'}`}>{vt.resolutionLabel}</span>
              <select
                value={resolutionLtx23HdrMulti}
                onChange={(e) => onResolutionLtx23HdrMultiChange?.(e.target.value as '720' | '1280')}
                className={`px-2 py-1 rounded-lg text-xs ${
                  isDarkMode ? 'bg-black/30 text-white border border-gray-600/50' : 'bg-white/90 text-gray-900 border border-gray-300'
                } outline-none`}
              >
                <option value="720">{vt.resStandard720p}</option>
                <option value="1280">{vt.resHD1280}</option>
              </select>
              <span className={`text-xs ${isDarkMode ? 'text-white/70' : 'text-gray-700'}`}>{vt.aspectRatioLabel}</span>
              <select
                value={aspectRatio === '9:16' ? '9:16' : '16:9'}
                onChange={(e) => onAspectRatioChange(e.target.value as '16:9' | '9:16')}
                className={`px-2 py-1 rounded-lg text-xs ${
                  isDarkMode ? 'bg-black/30 text-white border border-gray-600/50' : 'bg-white/90 text-gray-900 border border-gray-300'
                } outline-none`}
              >
                <option value="16:9">{vt.aspect169Landscape}</option>
                <option value="9:16">{vt.aspect916Portrait}</option>
              </select>
            </>
          )}

          {!isLtx23LipsyncModel && !isLtx23I2vModel && !isLtx23T2vModel && !isLtx23HdrMultiModel && !isWanAnimateModel && !isHeyGemModel && !isSeedanceModel && !isGeminiOmniModel && !isGrok3StableModel && (
          <>
          <span
            className={`text-xs ${
              isDarkMode ? 'text-white/70' : 'text-gray-700'
            }`}
          >
            {vt.aspectRatioLabel}
          </span>
            <select
            value={aspectRatio}
            onChange={(e) => onAspectRatioChange(e.target.value as '16:9' | '9:16' | '1:1' | '2:3' | '3:2')}
            className={`px-2 py-1 rounded-lg text-xs ${
              isDarkMode
                ? 'bg-black/30 text-white border border-gray-600/50'
                : 'bg-white/90 text-gray-900 border border-gray-300'
            } outline-none`}
            title={vt.chooseAspectTitle}
          >
            {isGrok3Model ? (
              <>
                <option value="2:3">2:3</option>
                <option value="3:2">3:2</option>
                <option value="1:1">{vt.aspect11Square}</option>
                <option value="16:9">{vt.aspect169Landscape}</option>
                <option value="9:16">{vt.aspect916Portrait}</option>
              </>
            ) : (
              <>
                <option value="16:9">{vt.aspect169Landscape}</option>
                <option value="9:16">{vt.aspect916Portrait}</option>
                {(isKlingModel || isKlingVideoO1Model || isKlingVideoO1I2vModel || isKlingVideoO1StartEndModel || isKlingVideoO1RefModel) && <option value="1:1">{vt.aspect11Square}</option>}
              </>
            )}
          </select>
          </>
          )}

          {isGrok3Model && (
            <>
              <span className={`text-xs ${isDarkMode ? 'text-white/70' : 'text-gray-700'}`}>{vt.durationLabel}</span>
              <select
                value={normalizeGrok3DurationStr(durationGrok3, '10')}
                onChange={(e) => onDurationGrok3Change?.(e.target.value)}
                className={`px-2 py-1 rounded-lg text-xs ${
                  isDarkMode ? 'bg-black/30 text-white border border-gray-600/50' : 'bg-white/90 text-gray-900 border border-gray-300'
                } outline-none`}
                title="Grok video3：6s / 10s / 15s / 30s"
              >
                {GROK3_DURATION_SEC_OPTIONS.map((s) => (
                  <option key={s} value={String(s)}>
                    {s}s
                  </option>
                ))}
              </select>
              <span className={`text-xs ${isDarkMode ? 'text-white/70' : 'text-gray-700'}`} title="Grok video3 固定 720p">
                720p
              </span>
            </>
          )}

          {isGrok3StableModel && (
            <>
              <span className={`text-xs ${isDarkMode ? 'text-white/70' : 'text-gray-700'}`}>{vt.durationLabel}</span>
              <select
                value={normalizeGrok3StableDurationStr(durationGrok3, '10')}
                onChange={(e) => onDurationGrok3Change?.(e.target.value)}
                className={`px-2 py-1 rounded-lg text-xs ${
                  isDarkMode ? 'bg-black/30 text-white border border-gray-600/50' : 'bg-white/90 text-gray-900 border border-gray-300'
                } outline-none`}
                title="Grok video3 plus：6s / 10s"
              >
                {GROK3_STABLE_DURATION_SEC_OPTIONS.map((s) => (
                  <option key={s} value={String(s)}>
                    {s}s
                  </option>
                ))}
              </select>
              <span className={`text-xs ${isDarkMode ? 'text-white/70' : 'text-gray-700'}`} title="Grok video3 plus 固定 720p">
                720p
              </span>
            </>
          )}

          {/* 海螺-02/2.3 文生、海螺-02 图生视频标准：时长 6/10 秒 */}
          {(isHailuo02Model || isHailuo23Model || isHailuo02I2vModel || isHailuo23I2vModel) && (
            <>
              <span className={`text-xs ${isDarkMode ? 'text-white/70' : 'text-gray-700'}`}>{vt.durationLabel}</span>
              <select
                value={durationHailuo02}
                onChange={(e) => onDurationHailuo02Change?.(e.target.value as '6' | '10')}
                className={`px-2 py-1 rounded-lg text-xs ${
                  isDarkMode ? 'bg-black/30 text-white border border-gray-600/50' : 'bg-white/90 text-gray-900 border border-gray-300'
                } outline-none`}
                title={vt.titleHailuoDuration}
              >
                <option value="6">6s</option>
                <option value="10">10s</option>
              </select>
            </>
          )}

          {/* 可灵文生视频o1：时长 5/10 秒，模式 std/pro */}
          {/* 可灵文生/图生/首尾帧/参考生视频o1：时长 5/10 秒，模式 std/pro */}
          {(isKlingVideoO1Model || isKlingVideoO1I2vModel || isKlingVideoO1StartEndModel || isKlingVideoO1RefModel) && (
            <>
              <span className={`text-xs ${isDarkMode ? 'text-white/70' : 'text-gray-700'}`}>{vt.durationLabel}</span>
              <select
                value={durationKlingO1}
                onChange={(e) => onDurationKlingO1Change?.(e.target.value as '5' | '10')}
                className={`px-2 py-1 rounded-lg text-xs ${
                  isDarkMode ? 'bg-black/30 text-white border border-gray-600/50' : 'bg-white/90 text-gray-900 border border-gray-300'
                } outline-none`}
                title={vt.titleKlingO1Duration}
              >
                <option value="5">5s</option>
                <option value="10">10s</option>
              </select>
              <span className={`text-xs ${isDarkMode ? 'text-white/70' : 'text-gray-700'}`}>{vt.klingModeLabel}</span>
              <select
                value={modeKlingO1}
                onChange={(e) => onModeKlingO1Change?.(e.target.value as 'std' | 'pro')}
                className={`px-2 py-1 rounded-lg text-xs ${
                  isDarkMode ? 'bg-black/30 text-white border border-gray-600/50' : 'bg-white/90 text-gray-900 border border-gray-300'
                } outline-none`}
                title={vt.titleKlingO1Mode}
              >
                <option value="std">std</option>
                <option value="pro">pro</option>
              </select>
              {isKlingVideoO1RefModel && (
                <label className="flex items-center gap-1.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={keepOriginalSound}
                    onChange={(e) => onKeepOriginalSoundChange?.(e.target.checked)}
                    className="rounded border-gray-500"
                  />
                  <span className={`text-xs ${isDarkMode ? 'text-white/70' : 'text-gray-700'}`}>{vt.keepRefVideoAudio}</span>
                </label>
              )}
            </>
          )}

          {/* 全能视频V3.1-fast / V3.1-pro 首尾帧 / Veo3.1 Pro 文生：分辨率 720p/1080p/4k（比例仅 16:9/9:16）；Pro 文生/首尾帧固定 8s */}
          {(isRhartV31FastModel || isRhartV31FastSEModel || isRhartV31ProSEModel || isRhartV31ProModel) && (
            <>
              <span className={`text-xs ${isDarkMode ? 'text-white/70' : 'text-gray-700'}`}>{vt.resolutionLabel}</span>
              <select
                value={resolutionRhartV31}
                onChange={(e) => onResolutionRhartV31Change?.(e.target.value as '720p' | '1080p' | '4k')}
                className={`px-2 py-1 rounded-lg text-xs ${
                  isDarkMode ? 'bg-black/30 text-white border border-gray-600/50' : 'bg-white/90 text-gray-900 border border-gray-300'
                } outline-none`}
                title={vt.titleOutputResolution}
                aria-label={vt.resolutionLabel}
              >
                <option value="720p">720p</option>
                <option value="1080p">1080p</option>
                <option value="4k">4k</option>
              </select>
              {(isRhartV31ProModel || isRhartV31ProSEModel) && (
                <span className={`text-xs ${isDarkMode ? 'text-white/70' : 'text-gray-700'}`}>{vt.durationFixed8s}</span>
              )}
            </>
          )}

          {/* LTX2.3（首位帧）：分辨率 720p/1080p/4k + 时长 5/10/15 秒 */}
          {isRhVideoStartEndModel && (
            <>
              <span className={`text-xs ${isDarkMode ? 'text-white/70' : 'text-gray-700'}`}>{vt.resolutionLabel}</span>
              <select
                value={resolutionRhartV31}
                onChange={(e) => onResolutionRhartV31Change?.(e.target.value as '720p' | '1080p' | '4k')}
                className={`px-2 py-1 rounded-lg text-xs ${
                  isDarkMode ? 'bg-black/30 text-white border border-gray-600/50' : 'bg-white/90 text-gray-900 border border-gray-300'
                } outline-none`}
                title={vt.titleOutputResolution}
              >
                <option value="720p">720p</option>
                <option value="1080p">1080p</option>
                <option value="4k">4k</option>
              </select>
              <span className={`text-xs ${isDarkMode ? 'text-white/70' : 'text-gray-700'}`}>{vt.durationLabel}</span>
              <select
                value={duration === '15' ? '15' : duration === '10' ? '10' : '5'}
                onChange={(e) => onDurationChange(e.target.value as '5' | '10' | '15' | '25')}
                className={`px-2 py-1 rounded-lg text-xs ${
                  isDarkMode ? 'bg-black/30 text-white border border-gray-600/50' : 'bg-white/90 text-gray-900 border border-gray-300'
                } outline-none`}
                title={vt.durationChooseTitle}
              >
                <option value="5">5s</option>
                <option value="10">10s</option>
                <option value="15">15s</option>
              </select>
            </>
          )}

          {/* WanAnimate 角色替换：分辨率 + 片段档位（与 RH 工作流 259/250） */}
          {isWanAnimateModel && (
            <>
              <span className={`text-xs ${isDarkMode ? 'text-white/70' : 'text-gray-700'}`}>{vt.resolutionLabel}</span>
              <select
                value={resolutionWanAnimate}
                onChange={(e) => onResolutionWanAnimateChange?.(e.target.value as '720p' | '1080p')}
                className={`px-2 py-1 rounded-lg text-xs ${
                  isDarkMode ? 'bg-black/30 text-white border border-gray-600/50' : 'bg-white/90 text-gray-900 border border-gray-300'
                } outline-none`}
                title={vt.titleWanAnimateResolution}
              >
                <option value="720p">720P</option>
                <option value="1080p">1080P</option>
              </select>
              <span className={`text-xs ${isDarkMode ? 'text-white/70' : 'text-gray-700'}`}>{vt.durationLabel}</span>
              <select
                value={wanAnimateClipSec}
                onChange={(e) => onWanAnimateClipSecChange?.(e.target.value as '5' | '8' | '10' | '15')}
                className={`px-2 py-1 rounded-lg text-xs ${
                  isDarkMode ? 'bg-black/30 text-white border border-gray-600/50' : 'bg-white/90 text-gray-900 border border-gray-300'
                } outline-none`}
                title={vt.titleWanAnimateClip}
              >
                <option value="5">5s</option>
                <option value="8">8s</option>
                <option value="10">10s</option>
                <option value="15">15s</option>
              </select>
            </>
          )}

          {isSeedanceModel && (
            <>
              <span className={`text-xs ${isDarkMode ? 'text-white/70' : 'text-gray-700'}`}>{vt.resolutionLabel}</span>
              <select
                value={coerceSeedanceResolution(resolutionSeedance, model)}
                onChange={(e) => onResolutionSeedanceChange?.(e.target.value as '480p' | '720p' | '1080p' | '2k' | '4k')}
                className={`px-2 py-1 rounded-lg text-xs ${
                  isDarkMode ? 'bg-black/30 text-white border border-gray-600/50' : 'bg-white/90 text-gray-900 border border-gray-300'
                } outline-none`}
                title={isSeedanceMiniModel ? '480P / 720P / 1080P / 2K / 4K' : vt.titleSeedanceResolution}
              >
                {isSeedanceMiniModel ? <option value="480p">480P</option> : null}
                <option value="720p">720P</option>
                <option value="1080p">1080P</option>
                {isSeedanceMiniModel ? (
                  <>
                    <option value="2k">2K</option>
                    <option value="4k">4K</option>
                  </>
                ) : null}
              </select>
              <span className={`text-xs ${isDarkMode ? 'text-white/70' : 'text-gray-700'}`}>{vt.durationLabel}</span>
              <select
                value={normalizeSeedanceDurationChoice(durationSeedance, 10)}
                onChange={(e) => onDurationSeedanceChange?.(e.target.value as '5' | '10' | '15')}
                className={`px-2 py-1 rounded-lg text-xs ${
                  isDarkMode ? 'bg-black/30 text-white border border-gray-600/50' : 'bg-white/90 text-gray-900 border border-gray-300'
                } outline-none`}
                title={vt.titleSeedanceDuration}
              >
                {SEEDANCE_DURATION_SEC_OPTIONS.map((sec) => (
                  <option key={sec} value={String(sec)}>{vt.secSuffix(sec)}</option>
                ))}
              </select>
            </>
          )}

          {isGeminiOmniModel && (
            <>
              <span className={`text-xs ${isDarkMode ? 'text-white/70' : 'text-gray-700'}`}>{vt.resolutionLabel}</span>
              <select
                value={resolutionGeminiOmni}
                onChange={(e) => onResolutionGeminiOmniChange?.(e.target.value as '720p' | '1080p' | '4k')}
                className={`px-2 py-1 rounded-lg text-xs ${
                  isDarkMode ? 'bg-black/30 text-white border border-gray-600/50' : 'bg-white/90 text-gray-900 border border-gray-300'
                } outline-none`}
                title="720p / 1080p / 4k"
              >
                <option value="720p">720p</option>
                <option value="1080p">1080p</option>
                <option value="4k">4k</option>
              </select>
              <span className={`text-xs ${isDarkMode ? 'text-white/70' : 'text-gray-700'}`}>{vt.durationLabel}</span>
              <select
                value={normalizeGeminiOmniDurationChoice(durationGeminiOmni, 6)}
                onChange={(e) => onDurationGeminiOmniChange?.(e.target.value as '6' | '8' | '10')}
                className={`px-2 py-1 rounded-lg text-xs ${
                  isDarkMode ? 'bg-black/30 text-white border border-gray-600/50' : 'bg-white/90 text-gray-900 border border-gray-300'
                } outline-none`}
                title="4s / 6s / 8s / 10s"
              >
                {GEMINI_OMNI_DURATION_SEC_OPTIONS.map((sec) => (
                  <option key={sec} value={String(sec)}>{vt.secSuffix(sec)}</option>
                ))}
              </select>
              <span className={`text-xs ${isDarkMode ? 'text-white/70' : 'text-gray-700'}`}>{vt.aspectRatioLabel}</span>
              <select
                value={aspectRatio === '9:16' ? '9:16' : '16:9'}
                onChange={(e) => onAspectRatioChange(e.target.value as '16:9' | '9:16')}
                className={`px-2 py-1 rounded-lg text-xs ${
                  isDarkMode ? 'bg-black/30 text-white border border-gray-600/50' : 'bg-white/90 text-gray-900 border border-gray-300'
                } outline-none`}
              >
                <option value="16:9">{vt.aspect169Landscape}</option>
                <option value="9:16">{vt.aspect916Portrait}</option>
              </select>
            </>
          )}

          {/* Veo 3.1 Pro（官方图生）：分辨率 720p/1080p/4k，时长 4/6/8，可选生成音频 */}
          {isRhartV31ProOfficialI2vModel && (
            <>
              <span className={`text-xs ${isDarkMode ? 'text-white/70' : 'text-gray-700'}`}>{vt.resolutionLabel}</span>
              <select
                value={resolutionRhartV31}
                onChange={(e) => onResolutionRhartV31Change?.(e.target.value as '720p' | '1080p' | '4k')}
                className={`px-2 py-1 rounded-lg text-xs ${
                  isDarkMode ? 'bg-black/30 text-white border border-gray-600/50' : 'bg-white/90 text-gray-900 border border-gray-300'
                } outline-none`}
                title={vt.titleVeoResolution}
              >
                <option value="720p">720p</option>
                <option value="1080p">1080p</option>
                <option value="4k">4k</option>
              </select>
              <span className={`text-xs ${isDarkMode ? 'text-white/70' : 'text-gray-700'}`}>{vt.durationLabel}</span>
              <select
                value={durationVeo31ProOfficial}
                onChange={(e) => onDurationVeo31ProOfficialChange?.(e.target.value as '4' | '6' | '8')}
                className={`px-2 py-1 rounded-lg text-xs ${
                  isDarkMode ? 'bg-black/30 text-white border border-gray-600/50' : 'bg-white/90 text-gray-900 border border-gray-300'
                } outline-none`}
                title={vt.titleVeoDuration}
              >
                <option value="4">4s</option>
                <option value="6">6s</option>
                <option value="8">8s</option>
              </select>
              <label className="flex items-center gap-1.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={generateAudioVeo31ProOfficial}
                  onChange={(e) => onGenerateAudioVeo31ProOfficialChange?.(e.target.checked)}
                  className="rounded border-gray-500"
                />
                <span className={`text-xs ${isDarkMode ? 'text-white/70' : 'text-gray-700'}`}>{vt.genAudio}</span>
              </label>
            </>
          )}

          {/* sora-2、kling、万相2.6：显示时长选项（Veo3.1 Pro 文生固定 8s，不显示此项） */}
          {!isWan26FlashModel && !isRhartV31FastModel && !isGrok3Model && !isGrok3StableModel && !isHailuo02Model && !isHailuo23Model && !isHailuo02I2vModel && !isHailuo23I2vModel && !isKlingVideoO1Model && !isKlingVideoO1I2vModel && !isKlingVideoO1StartEndModel && !isRhVideoStartEndModel && !isKlingVideoO1RefModel && !isRhartV31ProSEModel && !isRhartV31ProModel && !isRhartV31ProOfficialI2vModel && !isLtx23LipsyncModel && !isLtx23I2vModel && !isLtx23T2vModel && !isLtx23HdrMultiModel && !isWanAnimateModel && !isHeyGemModel && !isSeedanceModel && !isGeminiOmniModel && (
            <>
              <span
                className={`text-xs ${
                  isDarkMode ? 'text-white/70' : 'text-gray-700'
                }`}
              >
                {vt.durationLabel}
              </span>
              <select
                value={isSora2ProModel ? (duration === '25' ? '25' : '15') : duration}
                onChange={(e) => onDurationChange(e.target.value as '5' | '10' | '15' | '25')}
                className={`px-2 py-1 rounded-lg text-xs ${
                  isDarkMode
                    ? 'bg-black/30 text-white border border-gray-600/50'
                    : 'bg-white/90 text-gray-900 border border-gray-300'
                } outline-none`}
                title={vt.durationChooseTitle}
              >
                {(isKlingModel || isWan26Model) && !isSora2ProModel && <option value="5">5s</option>}
                {isSora2ProModel ? (
                  <>
                    <option value="15">15s</option>
                    <option value="25">25s</option>
                  </>
                ) : isSora2Model ? (
                  <>
                    <option value="10">10s</option>
                    <option value="15">15s</option>
                  </>
                ) : (
                  <>
                    <option value="10">10s</option>
                    {!isKlingModel && (
                      <>
                        <option value="15">15s</option>
                      </>
                    )}
                  </>
                )}
              </select>
              {(isSora2Model || isSora2ProModel) && (
                <select
                  value={sora2Channel}
                  onChange={(e) => onSora2ChannelChange?.(e.target.value as 'plugin' | 'core')}
                  className={`px-2 py-1 rounded-lg text-xs ${
                    isDarkMode ? 'bg-black/30 text-white border border-gray-600/50' : 'bg-white/90 text-gray-900 border border-gray-300'
                  } outline-none`}
                  title={vt.sora2ChannelTitle}
                >
                  <option value="plugin">{vt.sora2Plugin}</option>
                  <option value="core">{vt.sora2Core}</option>
                </select>
              )}

            </>
          )}

          {/* 万相2.6：镜头类型 + 图生视频时显示分辨率 */}
          {isWan26Model && (
            <>
              <span className={`text-xs ${isDarkMode ? 'text-white/70' : 'text-gray-700'}`}>{vt.shotLabel}</span>
              <select
                value={shotType}
                onChange={(e) => onShotTypeChange?.(e.target.value as 'single' | 'multi')}
                className={`px-2 py-1 rounded-lg text-xs ${
                  isDarkMode ? 'bg-black/30 text-white border border-gray-600/50' : 'bg-white/90 text-gray-900 border border-gray-300'
                } outline-none`}
                title={vt.shotTitle}
              >
                <option value="single">{vt.shotSingle}</option>
                <option value="multi">{vt.shotMulti}</option>
              </select>
              {isImageToVideoMode && (
                <>
                  <span className={`text-xs ${isDarkMode ? 'text-white/70' : 'text-gray-700'}`}>{vt.resolutionLabel}</span>
                  <select
                    value={resolutionWan26}
                    onChange={(e) => onResolutionWan26Change?.(e.target.value as '720p' | '1080p')}
                    className={`px-2 py-1 rounded-lg text-xs ${
                      isDarkMode ? 'bg-black/30 text-white border border-gray-600/50' : 'bg-white/90 text-gray-900 border border-gray-300'
                    } outline-none`}
                    title={vt.titleWanI2vResolution}
                  >
                    <option value="720p">720p</option>
                    <option value="1080p">1080p</option>
                  </select>
                </>
              )}
            </>
          )}

          {/* 万相2.6 Flash 图生视频：第一行 时长、镜头、分辨率；第二行 生成音频 */}
          {isWan26FlashModel && (
            <div className="flex flex-col gap-1">
              <div className="flex items-center gap-2">
                <span className={`text-xs ${isDarkMode ? 'text-white/70' : 'text-gray-700'}`}>{vt.durationLabel}</span>
                <select
                  value={durationWan26Flash}
                  onChange={(e) => onDurationWan26FlashChange?.(e.target.value as '2'|'3'|'4'|'5'|'6'|'7'|'8'|'9'|'10'|'11'|'12'|'13'|'14'|'15')}
                  className={`px-2 py-1 rounded-lg text-xs ${
                    isDarkMode ? 'bg-black/30 text-white border border-gray-600/50' : 'bg-white/90 text-gray-900 border border-gray-300'
                  } outline-none`}
                  title={vt.titleWanFlashDuration}
                >
                  {([2,3,4,5,6,7,8,9,10,11,12,13,14,15] as const).map((n) => (
                    <option key={n} value={String(n)}>{n}s</option>
                  ))}
                </select>
                <span className={`text-xs ${isDarkMode ? 'text-white/70' : 'text-gray-700'}`}>{vt.shotLabel}</span>
                <select
                  value={shotType}
                  onChange={(e) => onShotTypeChange?.(e.target.value as 'single' | 'multi')}
                  className={`px-2 py-1 rounded-lg text-xs ${
                    isDarkMode ? 'bg-black/30 text-white border border-gray-600/50' : 'bg-white/90 text-gray-900 border border-gray-300'
                  } outline-none`}
                  title={vt.shotTitle}
                  aria-label={vt.shotLabel}
                >
                  <option value="single">{vt.shotSingle}</option>
                  <option value="multi">{vt.shotMulti}</option>
                </select>
                <span className={`text-xs ${isDarkMode ? 'text-white/70' : 'text-gray-700'}`}>{vt.resolutionLabel}</span>
                <select
                  value={resolutionWan26}
                  onChange={(e) => onResolutionWan26Change?.(e.target.value as '720p' | '1080p')}
                  className={`px-2 py-1 rounded-lg text-xs ${
                    isDarkMode ? 'bg-black/30 text-white border border-gray-600/50' : 'bg-white/90 text-gray-900 border border-gray-300'
                  } outline-none`}
                  title={vt.titleOutputResolution}
                  aria-label={vt.resolutionLabel}
                >
                  <option value="720p">720p</option>
                  <option value="1080p">1080p</option>
                </select>
              </div>
              <div className="flex items-center">
                <label className="flex items-center gap-1 text-xs cursor-pointer">
                  <input
                    type="checkbox"
                    checked={enableAudio}
                    onChange={(e) => onEnableAudioChange?.(e.target.checked)}
                    className="rounded border-gray-400"
                    title={vt.genAudioTitle}
                  />
                  <span className={isDarkMode ? 'text-white/70' : 'text-gray-700'}>{vt.genAudio}</span>
                </label>
              </div>
            </div>
          )}

          {/* kling-v2.6-pro 系列：显示额外参数 */}
          {isKlingModel && (
            <>
              <span
                className={`text-xs ${
                  isDarkMode ? 'text-white/70' : 'text-gray-700'
                }`}
              >
                {vt.guidanceLabel}
              </span>
              <div
                className={`flex items-stretch rounded-lg text-xs overflow-hidden border ${
                  isDarkMode
                    ? 'border-gray-600/50 bg-black/30'
                    : 'border-gray-300 bg-white/90'
                }`}
                title={vt.guidanceTitle}
              >
                <input
                  type="number"
                  min={0}
                  max={1}
                  step={0.1}
                  value={Number(guidanceScale.toFixed(1))}
                  onChange={(e) => {
                    const raw = parseFloat(e.target.value);
                    if (Number.isNaN(raw)) return;
                    const clamped = Math.min(1, Math.max(0, raw));
                    onGuidanceScaleChange?.(Math.round(clamped * 10) / 10);
                  }}
                  className={`w-11 min-w-0 px-1 py-0.5 text-center outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none ${
                    isDarkMode ? 'bg-transparent text-white' : 'bg-transparent text-gray-900'
                  }`}
                />
                <div
                  className={`flex flex-col border-l shrink-0 ${
                    isDarkMode ? 'border-gray-600/50' : 'border-gray-300'
                  }`}
                >
                  <button
                    type="button"
                    aria-label="Guidance +0.1"
                    disabled={guidanceScale >= 1 - 1e-6}
                    onClick={() => {
                      const next = Math.min(1, Math.round((guidanceScale + 0.1) * 10) / 10);
                      onGuidanceScaleChange?.(next);
                    }}
                    className={`flex items-center justify-center px-0.5 leading-none disabled:opacity-35 ${
                      isDarkMode
                        ? 'hover:bg-white/10 text-white/80'
                        : 'hover:bg-gray-100 text-gray-700'
                    }`}
                  >
                    <ChevronUp className="w-3.5 h-3.5" strokeWidth={2.5} />
                  </button>
                  <button
                    type="button"
                    aria-label="Guidance -0.1"
                    disabled={guidanceScale <= 1e-6}
                    onClick={() => {
                      const next = Math.max(0, Math.round((guidanceScale - 0.1) * 10) / 10);
                      onGuidanceScaleChange?.(next);
                    }}
                    className={`flex items-center justify-center px-0.5 leading-none border-t disabled:opacity-35 ${
                      isDarkMode
                        ? 'border-gray-600/50 hover:bg-white/10 text-white/80'
                        : 'border-gray-300 hover:bg-gray-100 text-gray-700'
                    }`}
                  >
                    <ChevronDown className="w-3.5 h-3.5" strokeWidth={2.5} />
                  </button>
                </div>
              </div>

              <label className="flex items-center gap-1 text-xs cursor-pointer">
                <input
                  type="checkbox"
                  checked={sound === 'true'}
                  onChange={(e) => onSoundChange?.(e.target.checked ? 'true' : 'false')}
                  className="rounded border-gray-400"
                  title={vt.soundTitle}
                />
                <span
                  className={`${
                    isDarkMode ? 'text-white/70' : 'text-gray-700'
                  }`}
                >
                  {vt.soundLabel}
                </span>
              </label>
            </>
          )}

        </div>

        {/* 右侧：运行按钮（图生视频时显示最多 N 张，以及价格） */}
        <div className="flex items-center gap-2 flex-shrink-0">
          <div className="flex flex-col items-end gap-1">
            {isImageToVideoMode && imageCount > 0 && (
              <span
                className={`w-24 text-center text-xs font-medium px-2 py-1 rounded ${
                  isDarkMode ? 'text-white/80 bg-purple-500/20' : 'text-gray-700 bg-purple-100'
                }`}
                title={vt.refImagesTitle(imageCount, maxRefImagesVideo)}
              >
                {vt.refImagesBadge(imageCount, maxRefImagesVideo)}
              </span>
            )}
            {videoPriceLabel.ok ? (
              <span
                className={`w-24 text-center text-xs font-medium px-2 py-1 rounded ${
                  isDarkMode ? 'text-yellow-200 bg-yellow-500/25' : 'text-yellow-700 bg-yellow-100'
                }`}
                title={vt.priceTooltip}
              >
                {videoPriceLabel.value}
                {locale === 'en' ? ' ' : ''}
                {vt.creditsSuffix}
              </span>
            ) : (
              <span
                className={`w-24 text-center text-xs font-medium px-2 py-1 rounded ${
                  isDarkMode ? 'text-white/45 bg-white/10' : 'text-gray-500 bg-gray-100'
                }`}
                title={vt.noPricingTableTitle}
              >
                {vt.noPricingYet}
              </span>
            )}
          </div>

          <button
            onClick={handleExecute}
            disabled={isRunDisabled}
            className={`px-3 py-1 rounded-lg text-xs font-medium flex items-center gap-1.5 transition-all duration-200 ${
              isRunDisabled
                ? 'bg-gray-500/50 text-white/50 cursor-not-allowed'
                : isRunBusy
                  ? isImageToVideoMode
                    ? 'bg-purple-500/70 text-white/80 cursor-not-allowed'
                    : 'bg-blue-500/70 text-white/80 cursor-not-allowed'
                  : isImageToVideoMode
                    ? 'bg-purple-500 text-white hover:bg-purple-600 shadow-md shadow-purple-500/30'
                    : 'bg-blue-500 text-white hover:bg-blue-600 shadow-md shadow-blue-500/30'
            }`}
            title={modeLabel}
          >
            {isRunBusy ? (
              <>
                <div className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" />
                {modeLabel}
              </>
            ) : (
              <>
                <Play className="w-3 h-3" />
                {modeLabel}
              </>
            )}
          </button>
        </div>
      </div>

      {/* 输入区：WanAnimate 无需提示词；其余模式见下方 */}
      <div className="p-3 pt-2 pb-2 flex-1 min-h-0 flex flex-col">
        {(isHeyGemModel || isWanAnimateModel) ? (
          <div className="grid grid-cols-2 gap-2 flex-1 min-h-0">
            {(isHeyGemModel
              ? [
                  {
                    key: 'video',
                    label: vt.heyGemSlotVideoLabel,
                    connected: !!(referenceVideoUrl || '').trim(),
                    Icon: Video,
                  },
                  {
                    key: 'audio',
                    label: vt.heyGemSlotAudioLabel,
                    connected: !!(inputAudioUrl || '').trim(),
                    Icon: Mic,
                  },
                ]
              : [
                  {
                    key: 'video',
                    label: vt.heyGemSlotVideoLabel,
                    connected: !!(referenceVideoUrl || '').trim(),
                    Icon: Video,
                  },
                  {
                    key: 'refImage',
                    label: vt.wanAnimateSlotRefImageLabel,
                    connected: orderedInputImages.length > 0,
                    Icon: ImageIcon,
                  },
                ]
            ).map(({ key, label, connected, Icon }) => (
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
                <span
                  className={`text-xs font-medium ${
                    isDarkMode ? 'text-white/85' : 'text-gray-800'
                  }`}
                >
                  {label}
                </span>
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
                      {vt.heyGemSlotConnected}
                    </>
                  ) : (
                    vt.heyGemSlotPending
                  )}
                </span>
              </div>
            ))}
          </div>
        ) : isLtx23HdrMultiModel ? (
          <div className="grid grid-cols-[minmax(0,1fr)_240px] gap-x-3 gap-y-1">
            <div className="h-[30px] flex items-center gap-2 min-w-0">
              <label className={`text-xs font-medium shrink-0 ${isDarkMode ? 'text-white/80' : 'text-gray-900'}`}>
                {vt.promptVideoDesc}
              </label>
              {promptVoiceMicButton}
            </div>
            <div className={`h-[30px] flex items-center justify-between gap-1 min-w-0 text-xs font-medium ${
              isDarkMode ? 'text-white/80' : 'text-gray-900'
            }`}>
              <span>背景 / 分镜</span>
              <span
                className={`text-[9px] font-semibold shrink-0 ${
                  hdrRequiredSlotStatus.allRequiredOk
                    ? isDarkMode
                      ? 'text-emerald-400'
                      : 'text-emerald-600'
                    : isDarkMode
                      ? 'text-rose-400'
                      : 'text-rose-600'
                }`}
              >
                {hdrRequiredSlotStatus.allRequiredOk
                  ? '✓ 必填已齐'
                  : `还差 ${hdrRequiredSlotStatus.missing.join('、')}`}
              </span>
            </div>
            <div className="min-w-0">
              <textarea
                ref={promptInputRef}
                value={promptComposing ? promptLocal : localPrompt}
                readOnly={micVoiceBusy}
                disabled={micVoiceBusy}
                onChange={(e) => {
                  if (micVoiceBusy) return;
                  const v = e.target.value;
                  setLocalPrompt(v);
                  if (promptDebounceRef.current) clearTimeout(promptDebounceRef.current);
                  promptDebounceRef.current = setTimeout(() => {
                    promptDebounceRef.current = null;
                    lastSentPromptRef.current = v;
                    onPromptChange(v);
                  }, 250);
                }}
                className={`w-full h-[112px] resize-none rounded-xl px-3 py-2 text-xs custom-scrollbar ${
                  isDarkMode
                    ? 'bg-black/40 text-white border border-gray-700/70 placeholder:text-white/30'
                    : 'bg-white text-gray-900 border border-gray-300 placeholder:text-gray-400'
                } outline-none`}
                placeholder={vt.placeholderVideoPrompt}
              />
            </div>
            <div className={`rounded-lg border p-1.5 h-[112px] overflow-hidden flex flex-col ${
              isDarkMode ? 'border-gray-600/40 bg-black/20' : 'border-gray-300/60 bg-white/60'
            }`}>
              <div className={`text-[9px] mb-1 shrink-0 leading-snug ${
                isDarkMode ? 'text-white/45' : 'text-gray-500'
              }`}>
                带
                <span className={`font-semibold ${isDarkMode ? 'text-rose-400/90' : 'text-rose-600'}`}>必填</span>
                的槽位须上传；分镜3、4 选填
              </div>
              <div className="grid grid-cols-5 gap-0.5 items-start w-full shrink-0">
                {/* 背景槽：9:16 竖版，下方留白 */}
                <div
                  className={`min-h-0 rounded transition-colors ${
                    dragOverBackground ? 'ring-1 ring-green-400/80' : ''
                  }`}
                  onDragOver={(e) => {
                    e.preventDefault();
                    if (hdrDragSourceRef.current != null && hdrDragSourceRef.current !== 'background') {
                      setDragOverBackground(true);
                    }
                  }}
                  onDragLeave={() => setDragOverBackground(false)}
                  onDrop={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    handleHdrDropOnBackground();
                    finalizeThumbDrag(e);
                  }}
                >
                  {hdrBackground ? (
                    <button
                      type="button"
                      draggable
                      onDragStart={(e) => handleHdrDragStart('background', e)}
                      onDragEnd={(e) => finalizeThumbDrag(e)}
                      className={`group relative w-full aspect-[9/16] rounded overflow-hidden border cursor-grab active:cursor-grabbing ${
                        isDraggingThumb && hdrDragSourceRef.current === 'background'
                          ? 'border-dashed border-white/40 opacity-50'
                          : 'border-amber-500/60 hover:border-amber-400'
                      }`}
                      title="背景：点击移回分镜，或拖到分镜槽"
                      onClick={(e) => {
                        e.stopPropagation();
                        demoteBackgroundToStoryboard();
                      }}
                    >
                      <img src={hdrBackground} alt="背景" className="w-full h-full object-contain bg-black/20" draggable={false} />
                      <div className={`absolute left-0.5 top-0.5 text-[7px] px-0.5 py-0 rounded font-semibold leading-tight ${
                        isDarkMode ? 'bg-amber-500/80 text-amber-950' : 'bg-amber-200 text-amber-900'
                      }`}>
                        背景
                      </div>
                      <div className={`absolute right-0.5 top-0.5 text-[6px] px-0.5 rounded font-bold leading-tight ${
                        isDarkMode ? 'bg-emerald-500/80 text-emerald-950' : 'bg-emerald-200 text-emerald-900'
                      }`}>
                        ✓
                      </div>
                    </button>
                  ) : (
                    <div
                      role="button"
                      tabIndex={0}
                      title="必填：请连线或拖入背景图"
                      className={`w-full aspect-[9/16] rounded border border-dashed flex flex-col items-center justify-center gap-0.5 text-center px-0.5 ${
                        dragOverBackground
                          ? 'border-green-400 ring-2 ring-green-400/90 text-green-300'
                          : isDarkMode
                            ? 'border-rose-500/55 bg-rose-950/30 text-rose-200/90'
                            : 'border-rose-400/80 bg-rose-50 text-rose-800'
                      }`}
                    >
                      <span className={`text-[7px] font-bold leading-none ${
                        isDarkMode ? 'text-rose-400' : 'text-rose-600'
                      }`}>
                        必填
                      </span>
                      <span className="font-semibold text-[8px] leading-tight">背景</span>
                    </div>
                  )}
                </div>
                {storyboardSlots.map((url, index) => {
                  const trimmed = String(url || '').trim();
                  const isRequiredSlot = index < LTX23_HDR_MIN_STORYBOARD;
                  const isDragSource = isDraggingThumb && hdrDragSourceRef.current === index;
                  const isDropTarget =
                    isDraggingThumb &&
                    dragOverIndex === index &&
                    hdrDragSourceRef.current !== index &&
                    (hdrDragSourceRef.current === 'background' || hdrDragSourceRef.current !== index);
                  if (!trimmed) {
                    return (
                      <div
                        key={`slot-empty-${index}`}
                        role="button"
                        tabIndex={0}
                        title={
                          isRequiredSlot
                            ? `必填：请连线或拖入分镜 ${index + 1}`
                            : `选填：分镜 ${index + 1}`
                        }
                        onDragOver={(e) => {
                          e.preventDefault();
                          if (hdrDragSourceRef.current == null) return;
                          setDragOverIndex(index);
                        }}
                        onDragLeave={() => setDragOverIndex(null)}
                        onDrop={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          handleHdrDropOnStoryboard(index);
                          finalizeThumbDrag(e);
                        }}
                        className={`w-full aspect-[9/16] rounded border border-dashed flex flex-col items-center justify-center gap-0.5 text-[8px] ${
                          isDropTarget
                            ? 'border-green-400 ring-2 ring-green-400/90 text-green-300'
                            : isRequiredSlot
                              ? isDarkMode
                                ? 'border-rose-500/55 bg-rose-950/25 text-rose-200/85'
                                : 'border-rose-400/75 bg-rose-50 text-rose-800'
                              : isDarkMode
                                ? 'border-white/15 text-white/28'
                                : 'border-gray-300/80 text-gray-400'
                        }`}
                      >
                        {isRequiredSlot ? (
                          <>
                            <span className={`text-[7px] font-bold leading-none ${
                              isDarkMode ? 'text-rose-400' : 'text-rose-600'
                            }`}>
                              必填
                            </span>
                            <span className="font-semibold leading-tight">分镜{index + 1}</span>
                          </>
                        ) : (
                          <>
                            <span className="text-[7px] leading-none opacity-60">选填</span>
                            <span>{index + 1}</span>
                          </>
                        )}
                      </div>
                    );
                  }
                  return (
                    <button
                      key={`slot-${index}-${trimmed}`}
                      type="button"
                      draggable
                      onDragStart={(e) => handleHdrDragStart(index, e)}
                      onDragOver={(e) => {
                        e.preventDefault();
                        if (hdrDragSourceRef.current == null) return;
                        if (hdrDragSourceRef.current !== 'background' && hdrDragSourceRef.current === index) return;
                        setDragOverIndex(index);
                      }}
                      onDrop={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        handleHdrDropOnStoryboard(index);
                        finalizeThumbDrag(e);
                      }}
                      onDragEnd={(e) => finalizeThumbDrag(e)}
                      onClick={(e) => {
                        e.stopPropagation();
                        assignHdrBackground(trimmed);
                      }}
                      className={`group relative w-full aspect-[9/16] rounded overflow-hidden border cursor-grab active:cursor-grabbing ${
                        isDropTarget
                          ? 'border-green-400 ring-2 ring-green-400/90'
                          : isDragSource
                            ? 'border-white/30 border-dashed opacity-40'
                            : isRequiredSlot
                              ? isDarkMode
                                ? 'border-sky-500/50 hover:border-sky-400'
                                : 'border-sky-400/70 hover:border-sky-500'
                              : 'border-white/20 hover:border-green-500'
                      }`}
                      style={{
                        boxShadow: isDropTarget ? '0 0 0 1px rgba(74,222,128,0.45)' : undefined,
                        zIndex: isDragSource || isDropTarget ? 10 : 1,
                      }}
                      title={`分镜 ${index + 1}${isRequiredSlot ? '（必填）' : '（选填）'}，拖拽排序；拖到背景互换；点击设为背景`}
                    >
                      <img src={trimmed} alt={`分镜${index + 1}`} className="w-full h-full object-contain bg-black/20" draggable={false} />
                      <div className={`absolute left-0.5 top-0.5 text-[7px] px-0.5 py-0 rounded font-semibold leading-tight ${
                        isRequiredSlot
                          ? isDarkMode
                            ? 'bg-sky-500/85 text-sky-950'
                            : 'bg-sky-200 text-sky-900'
                          : isDarkMode
                            ? 'bg-black/60 text-white/70'
                            : 'bg-black/50 text-white/90'
                      }`}>
                        {isRequiredSlot ? `分镜${index + 1}` : index + 1}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        ) : (isImageToVideoMode || isLtx23LipsyncModel) && orderedInputImages.length > 0 ? (
          <div className="grid grid-cols-[minmax(0,1fr)_120px] gap-x-3 gap-y-1">
            <div className="h-[30px] flex items-center gap-2 min-w-0">
              <label
                className={`text-xs font-medium shrink-0 ${
                  isDarkMode ? 'text-white/80' : 'text-gray-900'
                }`}
              >
                {isLtx23LipsyncModel ? vt.promptAction : vt.promptVideoDesc}
              </label>
              {isLtx23LipsyncModel && (
                <span className={`text-xs shrink-0 ${inputAudioUrl ? (isDarkMode ? 'text-green-400' : 'text-green-600') : (isDarkMode ? 'text-amber-400' : 'text-amber-600')}`}>
                  {inputAudioUrl ? vt.audioConnected : vt.audioNeedConnect}
                </span>
              )}
              {promptVoiceMicButton}
            </div>
            <div className={`h-[30px] flex items-center text-xs font-medium ${
              isDarkMode ? 'text-white/80' : 'text-gray-900'
            }`}>
              {vt.refImageColumn}
            </div>
            <div className="min-w-0">
              <textarea
                ref={promptInputRef}
                value={promptComposing ? promptLocal : localPrompt}
                readOnly={micVoiceBusy}
                disabled={micVoiceBusy}
                onFocus={() => {
                  if (micVoiceBusy) return;
                  promptInputFocusedRef.current = true;
                }}
                onCompositionStart={(e) => {
                  setPromptComposing(true);
                  setPromptLocal((e.target as HTMLTextAreaElement).value);
                }}
                onCompositionEnd={(e) => {
                  setPromptComposing(false);
                  const v = (e.target as HTMLTextAreaElement).value;
                  setLocalPrompt(v);
                  if (promptDebounceRef.current) {
                    clearTimeout(promptDebounceRef.current);
                    promptDebounceRef.current = null;
                  }
                  lastSentPromptRef.current = v;
                  onPromptChange(v);
                }}
                onBlur={(e) => {
                  promptInputFocusedRef.current = false;
                  if (promptDebounceRef.current) {
                    clearTimeout(promptDebounceRef.current);
                    promptDebounceRef.current = null;
                  }
                  const v = (e.target as HTMLTextAreaElement).value;
                  if (v !== lastSentPromptRef.current) {
                    lastSentPromptRef.current = v;
                    setLocalPrompt(v);
                    onPromptChange(v);
                  }
                }}
                onChange={(e) => {
                  if (micVoiceBusy) return;
                  const v = e.target.value;
                  if (promptComposing) {
                    setPromptLocal(v);
                  } else {
                    setLocalPrompt(v);
                    if (promptDebounceRef.current) clearTimeout(promptDebounceRef.current);
                    promptDebounceRef.current = setTimeout(() => {
                      promptDebounceRef.current = null;
                      lastSentPromptRef.current = v;
                      onPromptChange(v);
                    }, 250);
                  }
                }}
                className={`w-full h-[112px] resize-none rounded-xl px-3 py-2 text-xs custom-scrollbar ${
                  isDarkMode
                    ? 'bg-black/40 text-white border border-gray-700/70 placeholder:text-white/30'
                    : 'bg-white text-gray-900 border border-gray-300 placeholder:text-gray-400'
                } outline-none ${micVoiceBusy ? 'opacity-45 cursor-not-allowed' : ''}`}
                placeholder={isLtx23LipsyncModel ? vt.defaultLipsyncAction : vt.placeholderVideoPrompt}
              />
            </div>
            <div className={`rounded-lg border p-1.5 h-[112px] overflow-hidden ${
              isDarkMode ? 'border-gray-600/40 bg-black/20' : 'border-gray-300/60 bg-white/60'
            }`}>
              <div
                className={`grid gap-1.5 h-full overflow-y-auto custom-scrollbar pr-0.5 ${
                  orderedInputImages.length === 1
                    ? 'grid-cols-1 grid-rows-1'
                    : orderedInputImages.length === 2
                      ? 'grid-cols-2 grid-rows-1'
                      : 'grid-cols-3 content-start'
                }`}
              >
                {orderedInputImages.map((url, index) => {
                  const isDragSource = isDraggingThumb && dragImageIndexRef.current === index;
                  const isDropTarget = isDraggingThumb && dragOverIndex === index && dragImageIndexRef.current !== index;
                  return (
                  <button
                    key={`${url}-${index}`}
                    type="button"
                    draggable
                    onDragStart={(e) => handleThumbDragStart(index, e)}
                    onDragOver={(e) => {
                      e.preventDefault();
                      if (dragImageIndexRef.current == null || dragImageIndexRef.current === index) return;
                      setDragOverIndex(index);
                    }}
                    onDrop={(e) => {
                      e.preventDefault();
                      handleThumbDrop(index);
                      finalizeThumbDrag(e);
                    }}
                    onDragEnd={(e) => finalizeThumbDrag(e)}
                    onClick={(e) => {
                      e.stopPropagation();
                      if (isSeedanceModel) {
                        appendSeedanceImageTagToPrompt(index + 1);
                      } else {
                        appendToPrompt(vt.appendImageSubject(index + 1));
                      }
                    }}
                    className={`group relative w-full ${
                      orderedInputImages.length <= 2 ? 'h-full' : 'aspect-square'
                    } rounded-md overflow-hidden border transition-all cursor-grab active:cursor-grabbing ${
                      isDropTarget
                        ? 'border-green-400 ring-2 ring-green-400/90'
                        : isDragSource
                          ? 'border-white/30 border-dashed opacity-40'
                          : 'border-white/20 hover:border-green-500'
                    }`}
                    style={{
                      boxShadow: isDropTarget ? '0 0 0 1px rgba(74,222,128,0.45)' : undefined,
                      zIndex: isDragSource || isDropTarget ? 10 : 1,
                    }}
                    title={
                      isSeedanceModel
                        ? vt.seedanceRefImageThumbTitle(index + 1)
                        : vt.refImageThumbTitle(index + 1)
                    }
                  >
                    <img src={url} alt={vt.refImageThumbAlt(index + 1)} className="w-full h-full object-contain bg-black/20" draggable={false} />
                    <div className="absolute right-1 bottom-1 min-w-[14px] h-[14px] px-1 rounded bg-black/75 text-white text-[9px] leading-[14px] text-center font-semibold opacity-0 group-hover:opacity-100 transition-opacity">
                      {index + 1}
                    </div>
                  </button>
                  );
                })}
              </div>
            </div>
          </div>
        ) : (
          <>
            <div className="mb-1 h-[30px] flex-shrink-0 flex items-center gap-2 min-w-0">
              <label
                className={`text-xs font-medium shrink-0 ${
                  isDarkMode ? 'text-white/80' : 'text-gray-900'
                }`}
              >
                {vt.promptVideoDesc}
              </label>
              {promptVoiceMicButton}
            </div>
            <div className="min-w-0">
              <textarea
                ref={promptInputRef}
                value={promptComposing ? promptLocal : localPrompt}
                readOnly={micVoiceBusy}
                disabled={micVoiceBusy}
                onFocus={() => {
                  if (micVoiceBusy) return;
                  promptInputFocusedRef.current = true;
                }}
                onCompositionStart={(e) => {
                  setPromptComposing(true);
                  setPromptLocal((e.target as HTMLTextAreaElement).value);
                }}
                onCompositionEnd={(e) => {
                  setPromptComposing(false);
                  const v = (e.target as HTMLTextAreaElement).value;
                  setLocalPrompt(v);
                  if (promptDebounceRef.current) {
                    clearTimeout(promptDebounceRef.current);
                    promptDebounceRef.current = null;
                  }
                  lastSentPromptRef.current = v;
                  onPromptChange(v);
                }}
                onBlur={(e) => {
                  promptInputFocusedRef.current = false;
                  if (promptDebounceRef.current) {
                    clearTimeout(promptDebounceRef.current);
                    promptDebounceRef.current = null;
                  }
                  const v = (e.target as HTMLTextAreaElement).value;
                  if (v !== lastSentPromptRef.current) {
                    lastSentPromptRef.current = v;
                    setLocalPrompt(v);
                    onPromptChange(v);
                  }
                }}
                onChange={(e) => {
                  if (micVoiceBusy) return;
                  const v = e.target.value;
                  if (promptComposing) {
                    setPromptLocal(v);
                  } else {
                    setLocalPrompt(v);
                    if (promptDebounceRef.current) clearTimeout(promptDebounceRef.current);
                    promptDebounceRef.current = setTimeout(() => {
                      promptDebounceRef.current = null;
                      lastSentPromptRef.current = v;
                      onPromptChange(v);
                    }, 250);
                  }
                }}
                className={`w-full h-[112px] resize-none rounded-xl px-3 py-2 text-xs custom-scrollbar ${
                  isDarkMode
                    ? 'bg-black/40 text-white border border-gray-700/70 placeholder:text-white/30'
                    : 'bg-white text-gray-900 border border-gray-300 placeholder:text-gray-400'
                } outline-none ${micVoiceBusy ? 'opacity-45 cursor-not-allowed' : ''}`}
                placeholder={vt.placeholderVideoPrompt}
              />
            </div>
          </>
        )}
      </div>

    </div>
  );
};

export default VideoInputPanel;

