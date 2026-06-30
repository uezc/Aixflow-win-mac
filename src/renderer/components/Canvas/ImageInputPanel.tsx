// @ts-nocheck
import React, { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { Play, ChevronDown, Mic, Loader2 } from 'lucide-react';
import { motion } from 'framer-motion';
import { useAI } from '../../hooks/useAI';
import { useDarkAlert } from '../../contexts/DarkAlertContext';
import {
  useReferenceMicRecording,
} from '../../hooks/useReferenceMicRecording';
import { isModelNotPricedError } from '../../utils/priceCalc';
import { getImageDisplayPrice } from '../../utils/cloudModelPricing';
import { useNxModelPricing } from '../../contexts/NxModelPricingContext';
import { useAppLocale } from '../../contexts/AppLocaleContext';
import { imageInputPanelT } from '../../i18n/imageInputPanelI18n';
import { audioInputPanelT } from '../../i18n/audioInputPanelI18n';
import { workspaceChromeT } from '../../i18n/workspaceI18n';
import {
  filterActiveImageModels,
  isRetiredImageModel,
  normalizeImageModelIfRetired,
  DEFAULT_IMAGE_MODEL,
} from '../../config/imageModelUiPolicy';
import {
  Z_IMAGE_ASPECT_RATIOS,
  Z_IMAGE_RESOLUTION_VALUES,
  zImageDimensionsForAspect,
  normalizeZImageResolutionTier,
} from '../../../common/zImageDimensions';
import { PanelOptionDropdown } from './PanelOptionDropdown';
import { canvasBottomInputPanelShell } from '../../theme/canvasBottomInputPanel';

interface ImageInputPanelProps {
  nodeId: string;
  isDarkMode: boolean;
  prompt: string;
  resolution: string;
  aspectRatio: string;
  model: string;
  /** seedream-v4.5 / seedream-v5 专用：宽 */
  seedreamWidth?: number;
  /** seedream-v4.5 / seedream-v5 专用：高 */
  seedreamHeight?: number;
  inputImages?: string[]; // 输入的参考图数组（最多10张）
  isConnected?: boolean; // 是否有输入连线（从父组件传递）
  projectId?: string; // 项目ID，用于资源保存
  onStart?: () => void; // 任务开始时的回调
  onErrorTask?: (message: string) => void; // 任务失败时的回调（用于任务列表）
  onPromptChange: (value: string) => void;
  onPromptFocus?: () => void;
  onResolutionChange: (value: string) => void;
  onAspectRatioChange: (value: string) => void;
  onModelChange: (value: string) => void;
  onSeedreamWidthChange?: (value: number) => void;
  onSeedreamHeightChange?: (value: number) => void;
  /** 第二项为 FC 回传的公网原图地址；第三项为多图结果（如 MJ V7 四宫格） */
  onOutputImageChange: (imageUrl: string, originalImageUrl?: string, outputImages?: string[]) => void;
  onInputImagesChange?: (images: string[]) => void;
  onProgressChange?: (progress: number) => void;
  onProgressMessageChange?: (message: string) => void; // 进度文案更新回调
}

// seedream-v4.5 比例与宽高映射（1024-4096）
const SEEDREAM_RATIO_MAP: Record<string, { width: number; height: number }> = {
  '1:1': { width: 2048, height: 2048 },
  '2:3': { width: 1664, height: 2496 },
  '3:2': { width: 2496, height: 1664 },
  '3:4': { width: 1728, height: 2304 },
  '4:3': { width: 2304, height: 1728 },
  '9:16': { width: 1440, height: 2560 },
  '16:9': { width: 2560, height: 1440 },
  '21:9': { width: 3024, height: 1296 },
};
// seedream-v5 比例与宽高映射（API: width 1600-4704, height 1344-4096，与图中选项一致）
const SEEDREAM_V5_RATIO_MAP: Record<string, { width: number; height: number }> = {
  '1:1': { width: 2048, height: 2048 },
  '2:3': { width: 1664, height: 2496 },
  '3:2': { width: 2496, height: 1664 },
  '3:4': { width: 1728, height: 2304 },
  '4:3': { width: 2304, height: 1728 },
  '9:16': { width: 1600, height: 2845 },   // 原 1440×2560 超出 width 下限，调整为 API 兼容
  '16:9': { width: 2560, height: 1440 },
  '21:9': { width: 3136, height: 1344 },   // 原 3024×1296 超出 height 下限，调整为 API 兼容
};
const SEEDREAM_RATIO_VALUES = ['1:1', '2:3', '3:2', '3:4', '4:3', '9:16', '16:9', '21:9'] as const;
const SEEDREAM_RATIO_OPTIONS = SEEDREAM_RATIO_VALUES.map((value) => ({ value, label: value }));
// seedream-v5 专用选项（与 v4.5 同一套比例值，仅下发尺寸不同）
const SEEDREAM_V5_RATIO_OPTIONS = SEEDREAM_RATIO_VALUES.map((value) => ({ value, label: value }));

/** 提示词标签：展示文案由 imageInputPanelT 提供 */
const PROMPT_TAG_DEFS: {
  text: string;
  color: string;
  useLocalePrompt?: boolean;
  useScene3dPrompt?: boolean;
  useNineGridMultiAnglePrompt?: boolean;
  /** 点击时切换 banana 2.0 + 21:9 并填入全景模板（非追加） */
  applyScene3dPreset?: boolean;
}[] = [
  {
    text: '',
    color: 'bg-green-600/90 hover:bg-green-600 text-white border-green-400/50',
    useNineGridMultiAnglePrompt: true,
  },
  { text: '[Subject], cinematic lighting, masterpiece, volumetric fog, realistic shadows, anamorphic lens flares, high contrast, 8k resolution, shot on 35mm lens.', color: 'bg-violet-500/90 hover:bg-violet-500 text-white border-violet-400/50' },
  { text: '', color: 'bg-amber-500/90 hover:bg-amber-500 text-white border-amber-400/50', useLocalePrompt: true },
  { text: '', color: 'bg-teal-600/90 hover:bg-teal-600 text-white border-teal-400/50', useScene3dPrompt: true, applyScene3dPreset: true },
];

const ImageInputPanel: React.FC<ImageInputPanelProps> = ({
  nodeId,
  isDarkMode,
  prompt,
  resolution,
  aspectRatio,
  model,
  seedreamWidth = 2048,
  seedreamHeight = 2048,
  inputImages = [],
  isConnected = false, // 从父组件传递连线状态
  projectId,
  onStart,
  onErrorTask,
  onPromptChange,
  onPromptFocus,
  onResolutionChange,
  onAspectRatioChange,
  onModelChange,
  onSeedreamWidthChange,
  onSeedreamHeightChange,
  onOutputImageChange,
  onInputImagesChange,
  onProgressChange,
  onProgressMessageChange,
}) => {
  const promptInputRef = useRef<HTMLTextAreaElement>(null);
  const enlargeButtonRef = useRef<HTMLButtonElement>(null);
  const dragImageIndexRef = useRef<number | null>(null);
  const latestOrderedImagesRef = useRef<string[]>([]);
  const [enlargeDropdownOpen, setEnlargeDropdownOpen] = useState(false);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
  const [isDraggingThumb, setIsDraggingThumb] = useState(false);
  const [orderedInputImages, setOrderedInputImages] = useState<string[]>(() => (inputImages || []).slice(0, 10));
  const { showAlert } = useDarkAlert();
  const { cloudMap } = useNxModelPricing();
  const { locale } = useAppLocale();
  const it = useMemo(() => imageInputPanelT(locale), [locale]);
  const refMicAt = useMemo(() => audioInputPanelT(locale), [locale]);
  const wc = useMemo(() => workspaceChromeT(locale), [locale]);
  const [micVoiceBusy, setMicVoiceBusy] = useState(false);
  const promptTags = useMemo(
    () =>
      PROMPT_TAG_DEFS.map((def, i) => {
        const labels = [it.tagNineGridMultiAngle, it.tagCinematic, it.tagThreeView, it.tagScene3d] as const;
        const text = def.useScene3dPrompt
          ? it.tagScene3dPrompt
          : def.useNineGridMultiAnglePrompt
            ? it.tagNineGridMultiAnglePrompt
            : def.useLocalePrompt
              ? it.tagThreeViewPrompt
              : def.text;
        return { ...def, text, label: labels[i] };
      }),
    [it],
  );
  const enlargeOptions = useMemo(() => Array.from({ length: 9 }, (_, i) => it.enlargeSlot(i)), [it]);
  // 本地 prompt + 防抖：避免每次按键触发父组件重渲染导致输入框闪动（图生图模式尤为明显）
  const [localPrompt, setLocalPrompt] = useState(prompt);
  const [promptComposing, setPromptComposing] = useState(false);
  const [promptLocal, setPromptLocal] = useState('');
  const lastSentPromptRef = useRef(prompt);
  const localPromptRef = useRef(localPrompt);
  const promptDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const prevNodeIdRef = useRef(nodeId);
  const promptInputFocusedRef = useRef(false);
  localPromptRef.current = localPrompt;

  useEffect(() => {
    return () => {
      if (promptDebounceRef.current) {
        clearTimeout(promptDebounceRef.current);
        promptDebounceRef.current = null;
      }
    };
  }, []);

  // 外部 inputImages 变化时：保持已排序顺序，新增图片追加到末尾。
  // 与上游条数相同时，完全采用上游顺序（同索引上参考图仅 URL/路径变更时，避免 kept/appended 合并打乱顺序、错用参考图）
  useEffect(() => {
    const incoming = (inputImages || []).slice(0, 10);
    setOrderedInputImages((prev) => {
      if (incoming.length === prev.length) {
        return incoming;
      }
      const kept = prev.filter((url) => incoming.includes(url));
      const appended = incoming.filter((url) => !kept.includes(url));
      return [...kept, ...appended];
    });
  }, [inputImages]);

  useEffect(() => {
    latestOrderedImagesRef.current = orderedInputImages;
  }, [orderedInputImages]);

  const commitInputImagesOrder = useCallback((nextImages: string[]) => {
    const normalized = nextImages.filter((u) => typeof u === 'string' && u.trim().length > 0).slice(0, 10);
    setOrderedInputImages(normalized);
    onInputImagesChange?.(normalized);
  }, [onInputImagesChange]);

  const handleThumbDragStart = useCallback((index: number, e?: React.DragEvent<HTMLDivElement>) => {
    e?.stopPropagation();
    dragImageIndexRef.current = index;
    setIsDraggingThumb(true);
    setDragOverIndex(null);
  }, []);

  const handleThumbDrop = useCallback((targetIndex: number) => {
    const sourceIndex = dragImageIndexRef.current;
    if (sourceIndex == null || sourceIndex === targetIndex) return;
    const next = [...latestOrderedImagesRef.current];
    const [moved] = next.splice(sourceIndex, 1);
    if (!moved) return;
    next.splice(targetIndex, 0, moved);
    latestOrderedImagesRef.current = next;
    setOrderedInputImages(next);
    dragImageIndexRef.current = targetIndex;
  }, []);

  const handleThumbDragEnd = useCallback((e?: React.DragEvent<HTMLDivElement>) => {
    e?.stopPropagation();
    dragImageIndexRef.current = null;
    setDragOverIndex(null);
    setIsDraggingThumb(false);
    commitInputImagesOrder(latestOrderedImagesRef.current);
  }, [commitInputImagesOrder]);

  const finalizeThumbDrag = useCallback(() => {
    dragImageIndexRef.current = null;
    setDragOverIndex(null);
    setIsDraggingThumb(false);
    commitInputImagesOrder(latestOrderedImagesRef.current);
  }, [commitInputImagesOrder]);

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

  /** 将文案填入提示词（追加，已有内容前加空格） */
  const appendToPrompt = useCallback((text: string) => {
    const sep = localPrompt.trim() ? ', ' : '';
    const next = localPrompt + sep + text;
    setLocalPrompt(next);
    lastSentPromptRef.current = next;
    onPromptChange(next);
    const el = promptInputRef.current;
    if (el && typeof el.focus === 'function') el.focus();
  }, [localPrompt, onPromptChange]);

  /** 3D 场景转换：banana 2.0 + 21:9 + 全景提示词模板 */
  const applyScene3dPreset = useCallback(() => {
    const next = it.tagScene3dPrompt;
    setLocalPrompt(next);
    lastSentPromptRef.current = next;
    onPromptChange(next);
    onModelChange('banana-2.0');
    onResolutionChange('1k');
    // 比例须最后设置：父组件 onResolutionChange 若用旧 state 合并会覆盖 aspectRatio
    onAspectRatioChange('21:9');
    promptInputRef.current?.focus();
  }, [it.tagScene3dPrompt, onPromptChange, onModelChange, onAspectRatioChange, onResolutionChange]);

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

  const hideScrollbarsForVoice = isMicVoiceRecording || micVoiceBusy;

  const allModelOptions = filterActiveImageModels([
    { value: 'banana-2.0', label: 'banana 2.0' },
    { value: 'z-image', label: 'Z-image' },
    { value: 'lens', label: 'Lens' },
    { value: 'flux2-klein', label: 'Flux2 Klein' },
    { value: 'mj-v7', label: 'Mj v7' },
    { value: 'gpt-image-2', label: 'GPT image 2' },
    { value: 'seedream-v5', label: 'Seedream v5' },
  ]);
  
  // 根据模式过滤模型选项
  // 只有当有输入图片时才切换到图生图模式
  const isImageToImageMode = orderedInputImages.length > 0;

  /** 图生图模式下各模型最大参考图数量（与 ImageProvider 一致） */
  const getMaxRefImages = (m: string): number => {
    if (m === 'flux2-klein') return 3;
    if (m === 'gpt-image-2') return 2;
    if (m === 'banana-2.0') return 10;
    if (m === 'seedream-v5') return 10;
    return 5;
  };
  const maxRefImages = getMaxRefImages(model);
  const imagePriceLabel = useMemo(() => {
    try {
      return { ok: true as const, value: getImageDisplayPrice({ model, resolution }, cloudMap) };
    } catch (e) {
      if (isModelNotPricedError(e)) return { ok: false as const };
      throw e;
    }
  }, [model, resolution, cloudMap]);

  const refCount = orderedInputImages.length;
  const imageToImageOptions = allModelOptions
    .filter((opt) => opt.value !== 'mj-v7' && opt.value !== 'z-image' && opt.value !== 'lens')
    .map((opt) => (opt.value === 'seedream-v5' ? { ...opt, label: 'Seedream v5' } : opt));
  const textToImageOptions = allModelOptions.filter((opt) => opt.value !== 'flux2-klein');
  const modelOptions = isImageToImageMode
    ? imageToImageOptions.filter((opt) => {
        if (opt.value === 'flux2-klein') return refCount <= 3;
        if (refCount <= 2) return true;
        if (refCount <= 5) return opt.value === 'banana-2.0' || opt.value === 'seedream-v5';
        return opt.value === 'banana-2.0' || opt.value === 'seedream-v5';
      })
    : textToImageOptions;

  // 图生图模式下若当前为仅文生图模型（MJ V7 / Z-image），自动切到第一个可用图生图模型
  useEffect(() => {
    if (isImageToImageMode && (model === 'mj-v7' || model === 'z-image' || model === 'lens') && modelOptions.length > 0) {
      onModelChange?.(modelOptions[0].value);
    }
  }, [isImageToImageMode, model, modelOptions, onModelChange]);

  // 文生图模式下 Flux2 Klein 不可用
  useEffect(() => {
    if (!isImageToImageMode && model === 'flux2-klein' && modelOptions.length > 0) {
      onModelChange?.(modelOptions[0].value);
    }
  }, [isImageToImageMode, model, modelOptions, onModelChange]);
  useEffect(() => {
    if (!isImageToImageMode || modelOptions.length === 0) return;
    if (!modelOptions.some((opt) => opt.value === model)) {
      onModelChange?.(modelOptions[0].value);
    }
  }, [isImageToImageMode, model, modelOptions, onModelChange]);

  /** Nano banana / Seedream 4.5 已下架，迁移到 banana 2.0 */
  useEffect(() => {
    if (!isRetiredImageModel(model)) return;
    onModelChange?.(normalizeImageModelIfRetired(model));
    if (!['1k', '2k', '4k'].includes(resolution)) {
      onResolutionChange('1k');
    }
  }, [model, resolution, onModelChange, onResolutionChange]);

  /** 全能图片 G-1.5（Grok 1.5）已下线，迁移到 banana 2.0 */
  useEffect(() => {
    if (model === 'rhart-image-g-1.5') {
      onModelChange?.(DEFAULT_IMAGE_MODEL);
    }
  }, [model, onModelChange]);

  useEffect(() => {
    if (model !== 'banana-2.0') return;
    if (!['1k', '2k', '4k'].includes(resolution)) {
      onResolutionChange('1k');
    }
  }, [model, resolution, onResolutionChange]);

  // 比例选项（根据 API 文档）
  const aspectRatioValues = ['1:1', '2:3', '3:2', '3:4', '4:3', '4:5', '5:4', '9:16', '16:9', '21:9'] as const;
  const aspectRatioOptions = aspectRatioValues.map((value) => ({ value, label: value }));

  const isSeedreamV5 = model === 'seedream-v5';
  const isZImage = model === 'z-image';
  const isLens = model === 'lens';
  const isFlux2Klein = model === 'flux2-klein';
  const usesTierResolution = isZImage || isLens || isFlux2Klein;
  const isBanana20 = model === 'banana-2.0';
  const zImageAspectRatioOptions = Z_IMAGE_ASPECT_RATIOS.map((value) => ({ value, label: value }));
  const zImageResolutionOptions = [
    { value: '720p', label: '720P' },
    { value: '1080p', label: '1080P' },
  ];
  const zImageResolution = normalizeZImageResolutionTier(resolution);
  const rhartResolutionOptions = [
    { value: '1k', label: '1k' },
    { value: '2k', label: '2k' },
    { value: '4k', label: '4k' },
  ];
  const aspectRatioOptionsMjV7 = [
    { value: 'auto', label: 'auto' },
    { value: '1:1', label: '1:1' },
    { value: '16:9', label: '16:9' },
    { value: '16:10', label: '16:10' },
    { value: '4:3', label: '4:3' },
    { value: '3:2', label: '3:2' },
    { value: '9:16', label: '9:16' },
    { value: '10:16', label: '10:16' },
    { value: '3:4', label: '3:4' },
    { value: '2:3', label: '2:3' },
  ];
  /** GPT image 2（RunningHub AI App）：与官方 fieldData 一致，含 empty 默认 */
  const aspectRatioOptionsGptImage2 = [
    { value: 'empty', label: 'empty' },
    { value: '1:1', label: '1:1' },
    { value: '3:2', label: '3:2' },
    { value: '2:3', label: '2:3' },
    { value: '5:4', label: '5:4' },
    { value: '4:5', label: '4:5' },
    { value: '16:9', label: '16:9' },
    { value: '9:16', label: '9:16' },
    { value: '21:9', label: '21:9' },
    { value: '3:4', label: '3:4' },
    { value: '4:3', label: '4:3' },
  ];
  const isMjV7 = model === 'mj-v7';
  const isGptImage2 = model === 'gpt-image-2';
  const effectiveAspectRatioOptions = isSeedreamV5
    ? SEEDREAM_V5_RATIO_OPTIONS
    : usesTierResolution
      ? zImageAspectRatioOptions
      : isGptImage2
        ? aspectRatioOptionsGptImage2
        : isMjV7
          ? aspectRatioOptionsMjV7
          : aspectRatioOptions;

  const resolvedModel = useMemo(() => {
    if (modelOptions.some((o) => o.value === model)) return model;
    return modelOptions[0]?.value ?? model;
  }, [model, modelOptions]);

  const resolvedAspectRatio = useMemo(() => {
    if (effectiveAspectRatioOptions.some((o) => o.value === aspectRatio)) return aspectRatio;
    if (isGptImage2) return 'empty';
    if (isMjV7) return 'auto';
    return '1:1';
  }, [aspectRatio, effectiveAspectRatioOptions, isGptImage2, isMjV7]);

  const handleAspectRatioChange = useCallback(
    (ratio: string) => {
      onAspectRatioChange(ratio);
      if (isSeedreamV5 && SEEDREAM_V5_RATIO_MAP[ratio]) {
        const { width, height } = SEEDREAM_V5_RATIO_MAP[ratio];
        onSeedreamWidthChange?.(width);
        onSeedreamHeightChange?.(height);
      }
      if (usesTierResolution) {
        const { width, height } = zImageDimensionsForAspect(ratio, zImageResolution);
        onSeedreamWidthChange?.(width);
        onSeedreamHeightChange?.(height);
      }
    },
    [
      onAspectRatioChange,
      isSeedreamV5,
      usesTierResolution,
      zImageResolution,
      onSeedreamWidthChange,
      onSeedreamHeightChange,
    ],
  );

  useEffect(() => {
    if (!usesTierResolution) return;
    const dims = zImageDimensionsForAspect(aspectRatio, zImageResolution);
    onSeedreamWidthChange?.(dims.width);
    onSeedreamHeightChange?.(dims.height);
  }, [usesTierResolution, aspectRatio, zImageResolution, onSeedreamWidthChange, onSeedreamHeightChange]);

  useEffect(() => {
    if (!usesTierResolution) return;
    if (!Z_IMAGE_RESOLUTION_VALUES.includes(resolution as (typeof Z_IMAGE_RESOLUTION_VALUES)[number])) {
      onResolutionChange('1080p');
    }
  }, [usesTierResolution, resolution, onResolutionChange]);

  useEffect(() => {
    if (!usesTierResolution) return;
    if (!(Z_IMAGE_ASPECT_RATIOS as readonly string[]).includes(aspectRatio)) {
      onAspectRatioChange('16:9');
    }
  }, [usesTierResolution, aspectRatio, onAspectRatioChange]);

  useEffect(() => {
    if (!isGptImage2) return;
    const allowed = ['empty', '3:2', '1:1', '2:3', '5:4', '4:5', '16:9', '9:16', '21:9', '3:4', '4:3'];
    if (!allowed.includes(aspectRatio)) onAspectRatioChange('empty');
  }, [isGptImage2, aspectRatio, onAspectRatioChange]);

  // AI Hook
  const { status: aiStatus, execute: executeAI } = useAI({
    nodeId,
    modelId: 'image',
    onStatusUpdate: (packet) => {
      // 处理进度更新
      if (packet.status === 'START') {
        if (onProgressChange) {
          onProgressChange(1);
        }
        if (onProgressMessageChange) {
          onProgressMessageChange(it.initializingModel);
        }
      } else if (packet.status === 'PROCESSING') {
        if (packet.payload?.progress !== undefined) {
          const progressValue = packet.payload.progress;
          const progressText = packet.payload.text || it.generatingImage;
          
          // 移除进度百分比后缀（如果存在）
          const progressMessage = progressText.replace(/\s*\d+%$/, '').trim() || it.generatingImage;
          console.log(`[ImageInputPanel] 图片生成进度: ${progressValue}%`);
          
          if (onProgressChange) {
            onProgressChange(progressValue);
          }
          if (onProgressMessageChange) {
            onProgressMessageChange(progressMessage);
          }
        }
      } else if (packet.status === 'SUCCESS') {
        // SUCCESS 状态：仅清除进度，不在此调用 onOutputImageChange
        // 任务更新与添加由 onComplete 统一处理，避免与 useAI 的 onComplete 重复导致任务列表重复
        if (onProgressChange) {
          onProgressChange(0);
        }
        if (onProgressMessageChange) {
          onProgressMessageChange('');
        }
      } else if (packet.status === 'ERROR') {
        // 清除进度
        if (onProgressChange) {
          onProgressChange(0);
        }
        if (onProgressMessageChange) {
          onProgressMessageChange('');
        }
      }
    },
    // 仅在完成时更新输出图片，避免任务列表重复记录
    onComplete: (result) => {
      const localPath = result?.localPath;
      const originalHttp = typeof (result as { originalImageUrl?: string })?.originalImageUrl === 'string'
        ? String((result as { originalImageUrl?: string }).originalImageUrl).trim()
        : '';
      const rawOutputImages = Array.isArray((result as { outputImages?: unknown[] })?.outputImages)
        ? (result as { outputImages: unknown[] }).outputImages
            .filter((u): u is string => typeof u === 'string' && String(u).trim() !== '')
        : [];

      const toLocalResource = (diskPath: string) => {
        let filePath = diskPath.replace(/\\/g, '/');
        if (filePath.match(/^\/[a-zA-Z]:/)) {
          filePath = filePath.substring(1);
        }
        return `local-resource://${filePath}`;
      };

      let imageUrl = result?.imageUrl;
      if (localPath) {
        imageUrl = toLocalResource(localPath);
        console.log('[ImageInputPanel] onComplete 使用本地路径:', localPath, '->', imageUrl, '公网原图:', originalHttp || '无');
      }

      let outputImages: string[] = [];
      if (rawOutputImages.length > 0) {
        outputImages = rawOutputImages.map((u, idx) => {
          if (idx === 0 && imageUrl) return imageUrl;
          if (u.startsWith('http://') || u.startsWith('https://') || u.startsWith('data:') || u.startsWith('local-resource://')) {
            return u;
          }
          const cleanPath = u.replace(/^(file:\/\/|local-resource:\/\/)/, '').replace(/\\/g, '/');
          return `local-resource://${cleanPath}`;
        });
      } else if (imageUrl) {
        outputImages = [imageUrl];
      }

      if (imageUrl) {
        onOutputImageChange(
          imageUrl,
          originalHttp && /^https?:\/\//i.test(originalHttp) ? originalHttp : undefined,
          outputImages.length > 1 ? outputImages : undefined,
        );
      }
      // 清除进度
      if (onProgressChange) {
        onProgressChange(0);
      }
      if (onProgressMessageChange) {
        onProgressMessageChange('');
      }
    },
    onError: (error) => {
      console.error('图片生成失败:', error);
      
      // 清除进度
      if (onProgressChange) {
        onProgressChange(0);
      }
      if (onProgressMessageChange) {
        onProgressMessageChange('');
      }
      
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

  // 外部 prompt 变化时同步到本地（切换节点、连线同步）。聚焦、防抖中或图片生成进行中时不覆盖，避免闪动
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
    const isImageGenBusy = aiStatus === 'START' || aiStatus === 'PROCESSING';
    if (promptInputFocusedRef.current || promptDebounceRef.current !== null) return;
    if (isImageGenBusy) return;
    if (prompt !== lastSentPromptRef.current) {
      // 父级短暂传出空串时，勿覆盖输入框内仍有的提示词（生成完成后常见）
      if (prompt === '' && localPromptRef.current.trim() !== '') {
        lastSentPromptRef.current = prompt;
        onPromptChange(localPromptRef.current);
        return;
      }
      lastSentPromptRef.current = prompt;
      setLocalPrompt(prompt);
    }
  }, [prompt, nodeId, aiStatus, onPromptChange]);

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

  // 执行图片生成
  const handleExecute = useCallback(async () => {
    flushPromptSync();
    if (!localPrompt.trim()) {
      return;
    }

    // 强制验证：如果图生图模式但没有图片数据，报错
    // 注意：text/llm 连接到 image 时，isConnected 可能为 true，但 inputImages 为空，这是正常的文生图模式
    if (isImageToImageMode && orderedInputImages.length === 0) {
      console.error("错误：图生图模式但无法获取源图片数据");
      return;
    }

    // 立即显示进度条动画（点击运行即开始）
    if (onProgressChange) onProgressChange(1);
    if (onProgressMessageChange) onProgressMessageChange(it.generatingImage);
    onStart?.();

    try {
      const requestParams: any = {
        model,
        prompt: localPrompt,
        response_format: 'url',
        aspect_ratio: aspectRatio,
        resolution,
      };
      if (usesTierResolution) {
        const tier = normalizeZImageResolutionTier(resolution);
        const dims = zImageDimensionsForAspect(aspectRatio, tier);
        requestParams.resolution = tier;
        requestParams.seedreamWidth = dims.width;
        requestParams.seedreamHeight = dims.height;
      } else if (isSeedreamV5) {
        requestParams.seedreamWidth = seedreamWidth;
        requestParams.seedreamHeight = seedreamHeight;
      }

      // 图生图模式：如果有输入图片，添加 image 参数
      if (isImageToImageMode && orderedInputImages.length > 0) {
        // 限制最多10张参考图
        const imagesToUse = orderedInputImages.slice(0, Math.min(10, maxRefImages));
        requestParams.image = imagesToUse;
        console.log(`[图片生成] 图生图模式，使用 ${imagesToUse.length} 张参考图`);
      }

      // 添加项目ID用于资源保存
      if (projectId) {
        requestParams.projectId = projectId;
      }

      await executeAI(requestParams);
    } catch (error) {
      console.error('图片生成失败:', error);
    }
  }, [flushPromptSync, localPrompt, model, aspectRatio, resolution, seedreamWidth, seedreamHeight, orderedInputImages, executeAI, isImageToImageMode, onStart, onProgressChange, projectId, isSeedreamV5, usesTierResolution, maxRefImages]);

  // 判断当前模式：根据输入图片数量自动切换（已在上面定义）
  // 图生图模式时，必须有图片数据才能运行
  // 按钮禁用逻辑：只基于当前模块自己的状态
  const isRunDisabled = aiStatus === 'PROCESSING' || !localPrompt.trim() || (isImageToImageMode && orderedInputImages.length === 0);

  const TAG_ROW_HEIGHT = 30;
  const INPUT_BOX_HEIGHT = 138;
  const THUMB_PANEL_WIDTH = 120;
  const THUMB_COLUMNS = 3;
  const thumbRows = Math.max(1, Math.ceil(orderedInputImages.length / THUMB_COLUMNS));
  const THUMB_AREA_HEIGHT = INPUT_BOX_HEIGHT;
  const THUMB_GAP = 6;
  const thumbColWidth = Math.floor((THUMB_PANEL_WIDTH - 12 - THUMB_GAP * (THUMB_COLUMNS - 1)) / THUMB_COLUMNS);
  const thumbRowHeight = Math.floor((THUMB_AREA_HEIGHT - THUMB_GAP * (thumbRows - 1)) / thumbRows);
  const thumbSize = Math.max(8, Math.min(thumbColWidth, thumbRowHeight));
  const shouldEnableThumbScroll = orderedInputImages.length >= 10;

  return (
    <div 
      className={canvasBottomInputPanelShell(isDarkMode)}
      style={!isDarkMode ? {
        background: 'rgba(229, 231, 235, 0.9)',
        backdropFilter: 'blur(12px) saturate(150%)',
        WebkitBackdropFilter: 'blur(12px) saturate(150%)',
      } : {}}
    >
      {/* 顶部控制栏 */}
      <div className={`flex items-center justify-between px-2 py-1.5 border-b flex-shrink-0 gap-2 ${isDarkMode ? 'border-gray-700/50' : 'border-gray-300/50'}`}>
        {/* 左侧：模型选择和比例选择（紧挨着） */}
        <div className="flex items-center gap-1.5 flex-1 min-w-0">
          {/* 模型选择 */}
          <div className="flex items-center gap-1.5 shrink-0">
            <label className={`text-xs whitespace-nowrap ${isDarkMode ? 'text-white/80' : 'text-gray-900'}`}>
              {it.modelLabel}
            </label>
            <PanelOptionDropdown
              value={resolvedModel}
              options={modelOptions}
              onChange={onModelChange}
              isDarkMode={isDarkMode}
              title={it.chooseModelTitle}
              minWidthPx={96}
            />
          </div>

          {/* 比例选择（seedream-v4.5 使用固定 8 档比例→宽高映射，其他模型用通用比例） */}
          <div className="flex items-center gap-1.5 shrink-0">
            <label className={`text-xs whitespace-nowrap ${isDarkMode ? 'text-white/80' : 'text-gray-900'}`}>
              {it.ratioLabel}
            </label>
            <PanelOptionDropdown
              value={resolvedAspectRatio}
              options={effectiveAspectRatioOptions}
              onChange={handleAspectRatioChange}
              isDarkMode={isDarkMode}
              title={it.chooseAspectTitle}
              minWidthPx={72}
            />
          </div>
          {usesTierResolution && (
            <div className="flex items-center gap-1.5 shrink-0">
              <label className={`text-xs whitespace-nowrap ${isDarkMode ? 'text-white/80' : 'text-gray-900'}`}>
                {locale === 'en' ? 'Resolution' : '分辨率'}
              </label>
              <PanelOptionDropdown
                value={zImageResolution}
                options={zImageResolutionOptions}
                onChange={(tier) => {
                  const normalized = normalizeZImageResolutionTier(tier);
                  onResolutionChange(normalized);
                  const { width, height } = zImageDimensionsForAspect(aspectRatio, normalized);
                  onSeedreamWidthChange?.(width);
                  onSeedreamHeightChange?.(height);
                }}
                isDarkMode={isDarkMode}
                title={locale === 'en' ? '720P or 1080P output tier' : '选择 720P 或 1080P 输出档位'}
                minWidthPx={72}
              />
            </div>
          )}
          {isBanana20 && (
            <div className="flex items-center gap-1.5 shrink-0">
              <label className={`text-xs whitespace-nowrap ${isDarkMode ? 'text-white/80' : 'text-gray-900'}`}>
                {it.resolutionLabel}
              </label>
              <PanelOptionDropdown
                value={['1k', '2k', '4k'].includes(resolution) ? resolution : '1k'}
                options={rhartResolutionOptions}
                onChange={onResolutionChange}
                isDarkMode={isDarkMode}
                title={it.chooseResolutionTitle}
                minWidthPx={56}
              />
            </div>
          )}
        </div>

        {/* 右侧：模式按钮（自动切换文生图/图生图） */}
        <div className="flex items-center gap-2 flex-shrink-0">
          {/* 图生图模式下显示参考图数量与当前模型最大数量 */}
          {isImageToImageMode && orderedInputImages.length > 0 && (
            <>
              <span className={`text-xs font-medium px-2 py-1 rounded ${
                isDarkMode ? 'text-white/80 bg-purple-500/20' : 'text-gray-700 bg-purple-100'
              }`}>
                {it.refImagesCount(orderedInputImages.length)}
              </span>
              <span className={`text-xs font-medium px-2 py-1 rounded ${
                isDarkMode ? 'text-white/50 bg-white/10' : 'text-gray-500 bg-gray-100'
              }`} title={it.maxRefImagesTitle(maxRefImages)}>
                {it.maxRefImages(maxRefImages)}
              </span>
            </>
          )}
          {imagePriceLabel.ok ? (
            <span
              className={`w-24 text-center text-xs font-medium px-2 py-1 rounded ${
                isDarkMode ? 'text-yellow-200 bg-yellow-500/25' : 'text-yellow-700 bg-yellow-100'
              }`}
              title={it.priceTooltip}
            >
              {imagePriceLabel.value}
              {locale === 'en' ? ' ' : ''}
              {it.creditsSuffix}
            </span>
          ) : (
            <span
              className={`w-24 text-center text-xs font-medium px-2 py-1 rounded ${
                isDarkMode ? 'text-white/45 bg-white/10' : 'text-gray-500 bg-gray-100'
              }`}
              title={it.noPricingTitle}
            >
              {it.noPricingYet}
            </span>
          )}
          {/* 模式按钮：根据输入状态自动切换文案和颜色 */}
          <button
            onClick={handleExecute}
            disabled={isRunDisabled}
            className={`px-3 py-1 rounded-lg text-xs font-medium flex items-center gap-1.5 transition-all duration-200 ${
              isRunDisabled
                ? 'bg-gray-500/50 text-white/50 cursor-not-allowed'
                : aiStatus === 'PROCESSING'
                  ? isImageToImageMode
                    ? 'bg-purple-500 text-white'
                    : 'bg-blue-500 text-white'
                  : isImageToImageMode
                    ? 'bg-purple-500 text-white hover:bg-purple-600 shadow-md shadow-purple-500/30'
                    : 'bg-blue-500 text-white hover:bg-blue-600 shadow-md shadow-blue-500/30'
            }`}
            title={isImageToImageMode ? it.modeTooltipI2I(orderedInputImages.length) : it.modeTooltipT2I}
          >
            {aiStatus === 'PROCESSING' ? (
              <>
                <div className={`w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin`} />
                {isImageToImageMode ? it.processingI2I : it.processingT2I}
              </>
            ) : (
              <>
                <Play className="w-3 h-3" />
                {isImageToImageMode ? it.runI2I : it.runT2I}
              </>
            )}
          </button>
        </div>
      </div>

      {/* 提示词输入区域：左侧输入，右侧参考图缩略图（2列，可拖拽排序） */}
      <div className="p-3 pt-2 flex-1 min-h-0 flex flex-col">
        <div className="flex flex-1 min-h-0 gap-3">
          <div className="flex-1 min-w-0 flex flex-col">
            {/* 提示词标签按钮：点击快速填入下方提示词 */}
            <div
              className={`mb-1 flex items-center gap-1.5 flex-nowrap flex-shrink-0 ${
                hideScrollbarsForVoice ? 'overflow-x-hidden' : 'overflow-x-auto custom-scrollbar'
              }`}
              style={{ height: `${TAG_ROW_HEIGHT}px` }}
            >
              <div className="relative">
                <button
                  ref={enlargeButtonRef}
                  type="button"
                  onClick={() => setEnlargeDropdownOpen((v) => !v)}
                  className={`px-2 py-1 text-xs rounded border font-medium transition-colors bg-blue-500/90 hover:bg-blue-500 text-white border-blue-400/50 flex items-center gap-0.5 ${enlargeDropdownOpen ? 'ring-1 ring-blue-300' : ''}`}
                  title={it.enlargeTitle}
                >
                  {it.enlargeButton}
                  <ChevronDown className="w-3 h-3" />
                </button>
                {enlargeDropdownOpen && (() => {
                  const anchor = enlargeButtonRef.current;
                  if (!anchor) return null;
                  const rect = anchor.getBoundingClientRect();
                  return createPortal(
                    <>
                      <div
                        className="fixed inset-0 z-[10001]"
                        aria-hidden
                        onClick={() => setEnlargeDropdownOpen(false)}
                      />
                      <div
                        className={`rounded-lg border shadow-xl p-2 grid grid-cols-3 gap-1 fixed z-[10002] ${
                          isDarkMode ? 'nexflow-glass-panel border-white/15' : 'bg-white border-gray-200 shadow-gray-900/20'
                        }`}
                        style={{ left: rect.left, top: rect.bottom + 6 }}
                      >
                        {enlargeOptions.map((opt) => (
                          <button
                            key={opt}
                            type="button"
                            onClick={() => {
                              appendToPrompt(opt);
                              setEnlargeDropdownOpen(false);
                            }}
                            className={`px-2 py-1.5 text-xs rounded font-medium transition-colors ${
                              isDarkMode
                                ? 'hover:bg-white/15 text-white'
                                : 'hover:bg-gray-100 text-gray-900'
                            }`}
                          >
                            {opt}
                          </button>
                        ))}
                      </div>
                    </>,
                    document.body
                  );
                })()}
              </div>
              {promptTags.map((tag) => (
                <button
                  key={tag.label}
                  type="button"
                  onClick={() => (tag.applyScene3dPreset ? applyScene3dPreset() : appendToPrompt(tag.text))}
                  className={`px-2 py-1 text-xs rounded border font-medium transition-colors whitespace-nowrap flex-shrink-0 ${tag.color}`}
                  title={tag.label}
                >
                  {tag.label}
                </button>
              ))}
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
                    ? it.voiceTranscribing
                    : isMicVoiceRecording
                      ? wc.textVoiceInputStopButton
                      : wc.textVoiceInputTitle
                }
                aria-label={
                  micVoiceBusy
                    ? it.voiceTranscribing
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
            </div>
            <div className="relative">
              <textarea
                ref={promptInputRef}
                value={promptComposing ? promptLocal : localPrompt}
                readOnly={micVoiceBusy}
                disabled={micVoiceBusy}
                onFocus={() => {
                  if (micVoiceBusy) return;
                  promptInputFocusedRef.current = true;
                  onPromptFocus?.();
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
                requestAnimationFrame(() => {
                  onPromptChange(v);
                });
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
                  }, 450);
                }
              }}
              className={`w-full custom-scrollbar bg-transparent resize-none outline-none text-sm rounded-lg p-2 border transition-opacity ${
                micVoiceBusy ? 'opacity-45 cursor-not-allowed' : ''
              } ${
                isDarkMode
                  ? 'text-white placeholder:text-white/40 border-gray-600/50'
                  : 'text-gray-900 placeholder:text-gray-500 border-gray-300/50'
              }`}
              placeholder={it.placeholderPrompt}
              style={{ caretColor: isDarkMode ? '#0A84FF' : '#22c55e', height: `${INPUT_BOX_HEIGHT}px` }}
              title={it.titlePromptInput}
            />
            </div>
          </div>

          {orderedInputImages.length > 0 && (
            <div className="w-[120px] flex-shrink-0 flex flex-col min-h-0">
              <div className={`mb-1 flex items-center px-1 text-[11px] font-medium ${isDarkMode ? 'text-white/70' : 'text-gray-700'}`} style={{ height: `${TAG_ROW_HEIGHT}px` }}>
                {it.refImagesColumnTitle}
              </div>
              <div className={`rounded-lg border p-1.5 flex flex-col min-h-0 overflow-hidden ${
                isDarkMode ? 'border-gray-600/40 bg-black/20' : 'border-gray-300/60 bg-white/60'
              }`} style={{ height: `${INPUT_BOX_HEIGHT}px` }}>
              <div
                className={`grid grid-cols-2 gap-1.5 flex-1 min-h-0 ${
                  shouldEnableThumbScroll && !hideScrollbarsForVoice
                    ? 'overflow-y-auto custom-scrollbar pr-0.5'
                    : 'overflow-hidden'
                }`}
                style={{
                  height: `${THUMB_AREA_HEIGHT}px`,
                  gridTemplateColumns: `repeat(${THUMB_COLUMNS}, ${thumbSize}px)`,
                  gridTemplateRows: `repeat(${thumbRows}, ${thumbSize}px)`,
                  justifyContent: 'center',
                  alignContent: 'start',
                }}
              >
                {orderedInputImages.map((url, index) => {
                  const isDragSource = isDraggingThumb && dragImageIndexRef.current === index;
                  const isDropTarget = isDraggingThumb && dragOverIndex === index && dragImageIndexRef.current !== index;
                  return (
                  <motion.div
                    key={`${url}-${index}`}
                    draggable
                    onDragStart={(e) => handleThumbDragStart(index, e)}
                    onDragOver={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      if (dragImageIndexRef.current == null || dragImageIndexRef.current === index) return;
                      setDragOverIndex(index);
                    }}
                    onDrop={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      handleThumbDrop(index);
                      finalizeThumbDrag();
                    }}
                    onClick={(e) => {
                      e.stopPropagation();
                      if (isDraggingThumb) return;
                      appendToPrompt(it.appendImageSubject(index));
                    }}
                    onDragEnd={(e) => handleThumbDragEnd(e)}
                    className={`group relative rounded-md overflow-hidden border ${isDraggingThumb ? 'cursor-grabbing' : 'cursor-grab'} ${
                      isDropTarget
                        ? 'border-green-400 ring-2 ring-green-400/90'
                        : isDragSource
                          ? 'border-white/30 border-dashed'
                          : isDarkMode
                            ? 'border-white/20'
                            : 'border-gray-300'
                    }`}
                    style={{
                      width: `${thumbSize}px`,
                      height: `${thumbSize}px`,
                      transition: 'border-color 0.15s ease, box-shadow 0.15s ease, opacity 0.18s ease',
                      opacity: isDragSource ? 0.35 : 1,
                      background: isDragSource ? 'rgba(255,255,255,0.06)' : undefined,
                      boxShadow: isDropTarget
                        ? '0 0 0 1px rgba(74,222,128,0.45), 0 4px 12px rgba(74,222,128,0.25)'
                        : isDragSource
                          ? '0 6px 14px rgba(0,0,0,0.34)'
                          : 'none',
                      zIndex: isDragSource || isDropTarget ? 10 : 1,
                    }}
                    animate={{ scale: isDropTarget ? 1.04 : 1 }}
                    title={it.refThumbTitle(index + 1)}
                  >
                    <img
                      src={url}
                      alt={it.refThumbAlt(index + 1)}
                      className="w-full h-full object-cover"
                      draggable={false}
                    />
                    <div className={`absolute right-1 bottom-1 min-w-[16px] h-4 px-1 rounded bg-black/75 text-white text-[10px] leading-4 text-center font-semibold transition-opacity ${
                      isDragSource
                        ? 'opacity-0'
                        : 'opacity-0 group-hover:opacity-100 group-active:opacity-0'
                    }`}>
                      {index + 1}
                    </div>
                  </motion.div>
                  );
                })}
              </div>
            </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default ImageInputPanel;
