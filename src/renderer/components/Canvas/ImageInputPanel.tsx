// @ts-nocheck
import React, { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import { Loader2, ArrowUp, X } from 'lucide-react';
import { motion } from 'framer-motion';
import { useAI } from '../../hooks/useAI';
import { useDarkAlert } from '../../contexts/DarkAlertContext';
import { useCloudRealtimeDictation } from '../../hooks/useCloudRealtimeDictation';
import { useDictationPushToTalk } from '../../hooks/useDictationPushToTalk';
import { micLevelCssVars } from '../../utils/micInputLevel';
import VoiceMicGlyph from './VoiceMicGlyph';
import { acquireVoiceModalLock, releaseVoiceModalLock } from '../../utils/voiceModalGate';
import { isModelNotPricedError } from '../../utils/priceCalc';
import { getImageDisplayPrice } from '../../utils/cloudModelPricing';
import { useNxModelPricing } from '../../contexts/NxModelPricingContext';
import { useAppLocale } from '../../contexts/AppLocaleContext';
import { imageInputPanelT } from '../../i18n/imageInputPanelI18n';
import { audioInputPanelT } from '../../i18n/audioInputPanelI18n';
import { RefImageHoverThumb } from './RefImageHoverThumb';
import {
  filterImageModelOptionsForMode,
  getImageModelLabel,
  getImageModelMaxRefs,
  imageModelSupportsI2I,
  normalizeImageModelIfRetired,
} from '../../config/imageModelUiPolicy';
import {
  Z_IMAGE_ASPECT_RATIOS,
  Z_IMAGE_RESOLUTION_VALUES,
  zImageDimensionsForAspect,
  normalizeZImageResolutionTier,
} from '../../../common/zImageDimensions';
import { isImageQueueOnlyModel } from '../../../shared/imageQueueGoldenPath';
import { PanelOptionDropdown } from './PanelOptionDropdown';
import { AtMentionMenu } from './AtMentionMenu';
import { PromptRichInput, type PromptRichInputHandle } from './PromptRichInput';
import { usePromptAtMention } from '../../hooks/usePromptAtMention';
import { resolveRefPillToOrderedIndex } from '../../utils/promptRefPill';

interface ImageInputPanelProps {
  nodeId: string;
  isDarkMode: boolean;
  prompt: string;
  resolution: string;
  aspectRatio: string;
  model: string;
  /** 全能图片 G-2 文生图质量档：low | medium | high */
  quality?: string;
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
  onQualityChange?: (value: string) => void;
  onSeedreamWidthChange?: (value: number) => void;
  onSeedreamHeightChange?: (value: number) => void;
  /** 第二项为 FC 回传的公网原图地址；第三项为多图结果（如 MJ V7 四宫格） */
  onOutputImageChange: (imageUrl: string, originalImageUrl?: string, outputImages?: string[]) => void;
  onInputImagesChange?: (images: string[]) => void;
  /** 删除某张参考图时断开对应入边 */
  onDisconnectRefImage?: (imageUrl: string) => void;
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
  id: string;
  text?: string;
  color: string;
  useNineGridMultiAnglePrompt?: boolean;
  useLocalePrompt?: boolean;
  /** 以输入框内胶囊显示，正文不写入 textarea，生成时再拼接 */
  asInputCapsule?: boolean;
  /** 激活胶囊时顺带切换比例 */
  applyAspectRatio?: string;
}[] = [
  {
    id: 'nineGrid',
    color: 'bg-violet-500/90 hover:bg-violet-500 text-white border-violet-400/50',
    useNineGridMultiAnglePrompt: true,
    asInputCapsule: true,
  },
  {
    id: 'cinematic',
    text: '[Subject], cinematic lighting, masterpiece, volumetric fog, realistic shadows, anamorphic lens flares, high contrast, 8k resolution, shot on 35mm lens.',
    color: 'bg-amber-500/90 hover:bg-amber-500 text-white border-amber-400/50',
    asInputCapsule: true,
  },
  {
    id: 'threeView',
    color: 'bg-teal-600/90 hover:bg-teal-600 text-white border-teal-400/50',
    useLocalePrompt: true,
    asInputCapsule: true,
    applyAspectRatio: '9:16',
  },
];

type PromptInputCapsule = {
  id: string;
  label: string;
  prompt: string;
  color: string;
};

/** 快捷胶囊标签防误触：两次点击至少间隔 1.5s */
const PROMPT_TAG_CLICK_COOLDOWN_MS = 1500;

const ImageInputPanel: React.FC<ImageInputPanelProps> = ({
  nodeId,
  isDarkMode,
  prompt,
  resolution,
  aspectRatio,
  model,
  quality = 'low',
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
  onQualityChange,
  onSeedreamWidthChange,
  onSeedreamHeightChange,
  onOutputImageChange,
  onInputImagesChange,
  onDisconnectRefImage,
  onProgressChange,
  onProgressMessageChange,
}) => {
  const promptInputRef = useRef<PromptRichInputHandle>(null);
  const dragImageIndexRef = useRef<number | null>(null);
  const latestOrderedImagesRef = useRef<string[]>([]);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
  const [isDraggingThumb, setIsDraggingThumb] = useState(false);
  const [hoveredRefFromPillIndex, setHoveredRefFromPillIndex] = useState<number | null>(null);
  const [orderedInputImages, setOrderedInputImages] = useState<string[]>(() => (inputImages || []).slice(0, 10));
  const { showAlert } = useDarkAlert();
  const { cloudMap } = useNxModelPricing();
  const { locale } = useAppLocale();
  const it = useMemo(() => imageInputPanelT(locale), [locale]);
  const refMicAt = useMemo(() => audioInputPanelT(locale), [locale]);
  const promptTags = useMemo(
    () =>
      PROMPT_TAG_DEFS.map((def) => {
        const labelById: Record<string, string> = {
          nineGrid: it.tagNineGridMultiAngle,
          cinematic: it.tagCinematic,
          threeView: it.tagThreeView,
        };
        const text = def.useNineGridMultiAnglePrompt
          ? it.tagNineGridMultiAnglePrompt
          : def.useLocalePrompt
            ? it.tagThreeViewPrompt
            : String(def.text || '');
        return {
          ...def,
          text,
          label: labelById[def.id] || def.id,
        };
      }),
    [it],
  );
  const [promptCapsules, setPromptCapsules] = useState<PromptInputCapsule[]>([]);
  const lastPromptTagClickAtRef = useRef(0);
  /** 九宫格多角度胶囊是否激活（用于离开面板时还原模块尺寸） */
  const nineGridEnlargeActiveRef = useRef(false);

  const dispatchNineGridEnlarge = useCallback(
    (targetNodeId: string, active: boolean) => {
      window.dispatchEvent(
        new CustomEvent('nexflow-image-ninegrid-enlarge', {
          detail: { nodeId: targetNodeId, active },
        }),
      );
    },
    [],
  );

  /** 切换节点 / 卸载面板时：若九宫格放大仍开着，通知对应 Image 节点还原 */
  useEffect(() => {
    const boundId = nodeId;
    return () => {
      if (!nineGridEnlargeActiveRef.current) return;
      nineGridEnlargeActiveRef.current = false;
      dispatchNineGridEnlarge(boundId, false);
    };
  }, [nodeId, dispatchNineGridEnlarge]);
  // 本地 prompt + 防抖：避免每次按键触发父组件重渲染导致输入框闪动（图生图模式尤为明显）
  const [localPrompt, setLocalPrompt] = useState(prompt);
  const [promptComposing, setPromptComposing] = useState(false);
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

  // 外部 inputImages 变化时：保留本地面板拖拽顺序，仅增删缺失/新增项。
  useEffect(() => {
    const incoming = (inputImages || []).slice(0, 10);
    setOrderedInputImages((prev) => {
      if (incoming.length === 0) return [];
      if (prev.length === 0) return incoming;
      const incomingSet = new Set(incoming);
      const kept = prev.filter((url) => incomingSet.has(url));
      if (kept.length === incoming.length) return kept;
      const keptSet = new Set(kept);
      const appended = incoming.filter((url) => !keptSet.has(url));
      if (kept.length === 0 && prev.length === incoming.length) return incoming;
      return [...kept, ...appended];
    });
  }, [inputImages]);

  useEffect(() => {
    latestOrderedImagesRef.current = orderedInputImages;
  }, [orderedInputImages]);

  const thumbDragDidReorderRef = useRef(false);

  const primeThumbDragTransfer = useCallback((e?: React.DragEvent<HTMLElement>) => {
    if (!e?.dataTransfer) return;
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', 'thumb');
  }, []);

  const commitInputImagesOrder = useCallback((nextImages: string[]) => {
    const normalized = nextImages.filter((u) => typeof u === 'string' && u.trim().length > 0).slice(0, 10);
    setOrderedInputImages(normalized);
    latestOrderedImagesRef.current = normalized;
    onInputImagesChange?.(normalized);
  }, [onInputImagesChange]);

  const handleThumbDragStart = useCallback((index: number, e?: React.DragEvent<HTMLDivElement>) => {
    e?.stopPropagation();
    thumbDragDidReorderRef.current = false;
    dragImageIndexRef.current = index;
    primeThumbDragTransfer(e);
    setIsDraggingThumb(true);
    setDragOverIndex(null);
  }, [primeThumbDragTransfer]);

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
    thumbDragDidReorderRef.current = true;
  }, []);

  const handleThumbDragEnd = useCallback((e?: React.DragEvent<HTMLDivElement>) => {
    e?.stopPropagation();
    const shouldCommit = thumbDragDidReorderRef.current;
    thumbDragDidReorderRef.current = false;
    dragImageIndexRef.current = null;
    setDragOverIndex(null);
    setIsDraggingThumb(false);
    if (shouldCommit) {
      commitInputImagesOrder(latestOrderedImagesRef.current);
    }
  }, [commitInputImagesOrder]);

  const finalizeThumbDrag = useCallback(() => {
    const shouldCommit = thumbDragDidReorderRef.current;
    thumbDragDidReorderRef.current = false;
    dragImageIndexRef.current = null;
    setDragOverIndex(null);
    setIsDraggingThumb(false);
    if (shouldCommit) {
      commitInputImagesOrder(latestOrderedImagesRef.current);
    }
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
    promptInputRef.current?.setPlainText(next);
    setLocalPrompt(next);
    lastSentPromptRef.current = next;
    onPromptChange(next);
    promptInputRef.current?.focus();
  }, [localPrompt, onPromptChange]);

  const applyMentionToPrompt = useCallback(
    (next: string) => {
      setLocalPrompt(next);
      lastSentPromptRef.current = next;
      onPromptChange(next);
    },
    [onPromptChange],
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
      const prev = (promptInputRef.current?.getPlainText() ?? localPromptRef.current ?? '').trimEnd();
      return prev ? `${prev}\n` : '';
    },
    onLiveText: (full) => {
      promptInputRef.current?.setPlainText(full);
      setLocalPrompt(full);
      lastSentPromptRef.current = full;
      onPromptChange(full);
    },
    onError: (message) => {
      showAlert(message);
    },
    onMicDenied: () => {
      showAlert(refMicAt.micPermissionDenied);
    },
  });

  const micVoiceBusy = dictationStatus === 'connecting' || dictationStatus === 'stopping';
  const micVoiceStopping = dictationStatus === 'stopping';
  const micInputLocked = isDictationActive || micVoiceBusy;

  const { pointerHandlers: promptMicPointerHandlers } = useDictationPushToTalk({
    start: startRealtimeDictation,
    stop: stopRealtimeDictation,
    cancel: cancelRealtimeDictation,
    status: dictationStatus,
    disabled: micVoiceStopping,
  });

  useEffect(() => {
    if (!isDictationActive) return;
    acquireVoiceModalLock();
    return () => releaseVoiceModalLock();
  }, [isDictationActive]);

  const hideScrollbarsForVoice = isDictationActive || micVoiceBusy;

  /** 与 VideoInputPanel 同款：输入框内右上角小方角麦克风；按住说话 */
  const promptVoiceMicButton = (
    <button
      type="button"
      {...promptMicPointerHandlers}
      disabled={micVoiceStopping}
      style={
        dictationStatus === 'listening' || dictationStatus === 'connecting'
          ? micLevelCssVars(dictationInputLevel)
          : undefined
      }
      className={`nexflow-voice-mic-btn nodrag nopan relative flex h-7 w-7 shrink-0 items-center justify-center rounded border select-none ${
        dictationStatus === 'connecting'
          ? 'connecting'
          : dictationStatus === 'listening'
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
          ? it.voiceTranscribing
          : isDictationActive
            ? it.voiceStopTitle
            : it.voiceStartTitle
      }
      aria-label={
        micVoiceBusy
          ? it.voiceTranscribing
          : isDictationActive
            ? it.voiceStopTitle
            : it.voiceStartTitle
      }
    >
      <VoiceMicGlyph
        busy={micVoiceBusy}
        active={dictationStatus === 'listening'}
        level={dictationInputLevel}
      />
    </button>
  );

  const {
    mentionMenuProps,
    mentionCandidates,
    onMentionKeyDown,
    onMentionInputCheck,
    onMentionCompositionChange,
  } = usePromptAtMention({
    nodeId,
    value: localPrompt,
    richEditorRef: promptInputRef,
    enabled: !micInputLocked,
    composing: promptComposing,
    orderedInputImages,
    locale,
    preferSeedanceTag: false,
    onApply: applyMentionToPrompt,
  });

  /** 点击参考图缩略图：插入与 @ 菜单相同的缩略图+文字胶囊（序列化 @图片N） */
  const appendRefImageMentionToPrompt = useCallback(
    (indexZeroBased: number) => {
      const fromMenu = mentionCandidates.find((c) => c.id === `ref-image-${indexZeroBased}`);
      const url = String(orderedInputImages[indexZeroBased] || '').trim();
      const n = indexZeroBased + 1;
      const label = locale === 'en' ? `Image${n}` : `图片${n}`;
      const item = fromMenu ?? {
        id: `ref-image-${indexZeroBased}`,
        origin: 'ref' as const,
        type: 'image' as const,
        label,
        refLabel: label,
        thumbUrl: url || undefined,
        insertText: locale === 'en' ? `@Image${n}` : `@图片${n}`,
        subtitle: locale === 'en' ? 'Reference' : '参考图',
      };
      const next =
        promptInputRef.current?.insertMention(item) ??
        (() => {
          const tag = item.insertText;
          const trimmedEnd = localPrompt.trimEnd();
          const needSpace = trimmedEnd.length > 0 && !/\s$/.test(localPrompt);
          return trimmedEnd + (needSpace ? ' ' : '') + tag;
        })();
      setLocalPrompt(next);
      lastSentPromptRef.current = next;
      onPromptChange(next);
      promptInputRef.current?.focus();
    },
    [mentionCandidates, orderedInputImages, locale, localPrompt, onPromptChange],
  );

  /** 从正文去掉已粘贴过的胶囊提示词（改由胶囊承载） */
  const stripCapsulePromptsFromText = useCallback(
    (raw: string) => {
      let next = String(raw || '');
      const cinematicBody =
        '[Subject], cinematic lighting, masterpiece, volumetric fog, realistic shadows, anamorphic lens flares, high contrast, 8k resolution, shot on 35mm lens.';
      const bodies = [
        it.tagThreeViewPrompt,
        it.tagNineGridMultiAnglePrompt,
        cinematicBody,
        // 旧版短文案
        '纯人物（无道具）四视图，纯白背景，统一画风，四幅图拼接排列：\n1. 正面脸部特写\n2. 正面全身站立\n3. 侧面全身站立\n4. 背面全身站立',
        '白色背景，高清4视图展示，一个人物设计，上半身脸部特写，人物全身正面照，人物侧面照，人物全身背面照，精致细腻的细节，清晰的轮廓，人物穿着时尚服饰，脸部表情自然，身体比例协调，精致的光影效果，角色设计感强，适合用于角色概念设计或模型参考，统一的白色背景，干净简洁。',
      ].filter(Boolean);
      for (const body of bodies) {
        if (!body) continue;
        if (next.includes(body)) next = next.split(body).join('');
      }
      // 新版含「每个宫格大小相等」的正文，以及四宫格真人写实模板
      if (next.includes('高清4视图展示') && next.includes('每个宫格大小相等')) {
        next = next
          .replace(
            /[，,]?\s*白色背景，高清4视图展示，每个宫格大小相等[^。]*。无文字/g,
            '',
          )
          .replace(
            /白色背景，高清4视图展示，每个宫格大小相等[^。]*。无文字/g,
            '',
          );
      }
      if (next.includes('四宫格真人写实')) {
        next = next.replace(/[，,]?\s*【四宫格真人写实】[^。]*。?/g, '');
      }
      return next.replace(/^[，,\s]+|[，,\s]+$/g, '').replace(/[，,]\s*[，,]/g, '，').trim();
    },
    [it.tagThreeViewPrompt, it.tagNineGridMultiAnglePrompt],
  );

  const togglePromptCapsule = useCallback(
    (tag: { id: string; label: string; text: string; color: string }) => {
      const exists = promptCapsules.some((c) => c.id === tag.id);
      const nextActive = !exists;
      if (tag.id === 'nineGrid') {
        nineGridEnlargeActiveRef.current = nextActive;
        dispatchNineGridEnlarge(nodeId, nextActive);
      }
      setPromptCapsules((prev) => {
        if (exists) return prev.filter((c) => c.id !== tag.id);
        return [
          ...prev.filter((c) => c.id !== tag.id),
          { id: tag.id, label: tag.label, prompt: tag.text, color: tag.color },
        ];
      });
      // 激活时：清掉输入框里已露出的同款正文
      const cleaned = stripCapsulePromptsFromText(localPrompt);
      if (cleaned !== localPrompt) {
        promptInputRef.current?.setPlainText(cleaned);
        setLocalPrompt(cleaned);
        lastSentPromptRef.current = cleaned;
        onPromptChange(cleaned);
      }
      promptInputRef.current?.focus();
    },
    [
      promptCapsules,
      localPrompt,
      onPromptChange,
      stripCapsulePromptsFromText,
      dispatchNineGridEnlarge,
      nodeId,
    ],
  );

  const removePromptCapsule = useCallback(
    (id: string) => {
      if (id === 'nineGrid' && nineGridEnlargeActiveRef.current) {
        nineGridEnlargeActiveRef.current = false;
        dispatchNineGridEnlarge(nodeId, false);
      }
      setPromptCapsules((prev) => prev.filter((c) => c.id !== id));
    },
    [dispatchNineGridEnlarge, nodeId],
  );

  const composePromptWithCapsules = useCallback(
    (base: string) => {
      const body = String(base || '').trim();
      const linked = promptCapsules.map((c) => String(c.prompt || '').trim()).filter(Boolean);
      return [body, ...linked].filter(Boolean).join('，');
    },
    [promptCapsules],
  );

  const isImageToImageMode = orderedInputImages.length > 0;
  const refCount = orderedInputImages.length;

  /** 图生图模式下各模型最大参考图数量（与共享目录 / ImageProvider 一致） */
  const getMaxRefImages = (m: string): number => getImageModelMaxRefs(m);
  const maxRefImages = getMaxRefImages(model);
  const imagePriceLabel = useMemo(() => {
    const value = getImageDisplayPrice({ model, resolution }, cloudMap);
    return value == null ? ({ ok: false as const }) : ({ ok: true as const, value });
  }, [model, resolution, cloudMap]);

  const modelOptions = useMemo(
    () =>
      filterImageModelOptionsForMode({
        hasRefs: isImageToImageMode,
        refCount: isImageToImageMode ? refCount : 0,
      }),
    [isImageToImageMode, refCount],
  );

  // 当前模型不在当前模式可用列表时，自动切到第一个可用项
  useEffect(() => {
    if (modelOptions.length === 0) return;
    if (modelOptions.some((opt) => opt.value === model)) return;
    onModelChange?.(modelOptions[0].value);
  }, [isImageToImageMode, model, modelOptions, onModelChange]);

  /** 下架 / 未知活跃目录外模型 → 默认全能图片 G-2.0 */
  useEffect(() => {
    const next = normalizeImageModelIfRetired(model);
    if (next !== model) {
      onModelChange?.(next);
      if (!['1k', '2k', '4k'].includes(resolution)) onResolutionChange('1k');
    }
  }, [model, resolution, onModelChange, onResolutionChange]);

  useEffect(() => {
    if (model !== 'banana-2.0' && model !== 'rhart-image-g-2' && model !== 'rhart-image-g-2.5') return;
    if (!['1k', '2k', '4k'].includes(resolution)) {
      onResolutionChange('1k');
    }
  }, [model, resolution, onResolutionChange]);

  useEffect(() => {
    if (model !== 'seedream-v5') return;
    if (resolution !== '2k' && resolution !== '3k') {
      onResolutionChange('2k');
    }
  }, [model, resolution, onResolutionChange]);

  // 比例选项（根据 API 文档）
  const aspectRatioValues = (
    model === 'rhart-image-g-2' || model === 'rhart-image-g-2.5'
      ? (['1:1', '2:3', '3:2', '3:4', '4:3', '4:5', '5:4', '9:16', '16:9', '21:9', '9:21', '2:1', '1:2', '3:1', '1:3'] as const)
      : model === 'banana-2.0'
        ? (['1:1', '16:9', '9:16', '4:3', '3:4', '3:2', '2:3', '5:4', '4:5', '21:9', '1:4', '4:1', '1:8', '8:1'] as const)
        : (['1:1', '2:3', '3:2', '3:4', '4:3', '4:5', '5:4', '9:16', '16:9', '21:9'] as const)
  );
  const aspectRatioOptions = aspectRatioValues.map((value) => ({ value, label: value }));

  const isSeedreamV5 = model === 'seedream-v5';
  const isZImage = model === 'z-image';
  const isLens = model === 'lens';
  const isFlux2Klein = model === 'flux2-klein';
  const usesTierResolution = isZImage || isLens || isFlux2Klein;
  const isBanana20 =
    model === 'banana-2.0' || model === 'rhart-image-g-2' || model === 'rhart-image-g-2.5';
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
  /** Seedream v5 国内 API：resolution 枚举 2k | 3k（优先于宽高） */
  const seedreamV5ResolutionOptions = [
    { value: '2k', label: '2k' },
    { value: '3k', label: '3k' },
  ];
  const seedreamV5Resolution = resolution === '3k' ? '3k' : '2k';
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
  const isYouchuanV81 = model === 'youchuan-text-to-image-v81';
  const isYouchuanV82 = model === 'youchuan-text-to-image-v82';
  const isYouchuanOpenApi = isYouchuanV81 || isYouchuanV82;
  const isRhartImageX = model === 'rhart-image-g';
  const isGptImage2 = model === 'gpt-image-2';
  const aspectRatioOptionsYouchuanV81 = [
    { value: '1:1', label: '1:1' },
    { value: '4:3', label: '4:3' },
    { value: '3:2', label: '3:2' },
    { value: '16:9', label: '16:9' },
    { value: '3:4', label: '3:4' },
    { value: '2:3', label: '2:3' },
    { value: '9:16', label: '9:16' },
  ];
  /** 全能图片 X：API 用像素枚举作 aspectRatio；UI 用与 1k/2k 同风格的短标签 */
  const aspectRatioOptionsRhartImageX = [
    { value: '960x960', label: '1:1' },
    { value: '1280x720', label: '16:9' },
    { value: '720x1280', label: '9:16' },
    { value: '1168x784', label: '3:2' },
    { value: '784x1168', label: '2:3' },
  ];
  const youchuanHdOptions = [
    { value: '1k', label: '标准' },
    { value: 'hd', label: '2K HD' },
  ];
  const effectiveAspectRatioOptions = isSeedreamV5
    ? SEEDREAM_V5_RATIO_OPTIONS
    : usesTierResolution
      ? zImageAspectRatioOptions
      : isGptImage2
        ? aspectRatioOptionsGptImage2
        : isMjV7
          ? aspectRatioOptionsMjV7
          : isYouchuanOpenApi
            ? aspectRatioOptionsYouchuanV81
            : isRhartImageX
              ? aspectRatioOptionsRhartImageX
              : aspectRatioOptions;

  const resolvedModel = useMemo(() => {
    if (modelOptions.some((o) => o.value === model)) return model;
    return modelOptions[0]?.value ?? model;
  }, [model, modelOptions]);

  const resolvedAspectRatio = useMemo(() => {
    if (effectiveAspectRatioOptions.some((o) => o.value === aspectRatio)) return aspectRatio;
    if (isRhartImageX) {
      const map: Record<string, string> = {
        '1:1': '960x960',
        '16:9': '1280x720',
        '9:16': '720x1280',
        '3:2': '1168x784',
        '2:3': '784x1168',
      };
      return map[aspectRatio] || '960x960';
    }
    if (isGptImage2) return 'empty';
    if (isMjV7) return 'auto';
    return '1:1';
  }, [aspectRatio, effectiveAspectRatioOptions, isGptImage2, isMjV7, isRhartImageX]);

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
      const rawLocalPath = typeof result?.localPath === 'string' ? result.localPath.trim() : '';
      // 拒绝 AICore 误写入的文本落盘路径（.txt 等），否则主图变成「图片加载失败」
      const localPath =
        rawLocalPath && !/\.(txt|json|md|csv|html?|xml)$/i.test(rawLocalPath) ? rawLocalPath : '';
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
      } else if (rawLocalPath) {
        console.warn('[ImageInputPanel] onComplete 忽略非图片 localPath:', rawLocalPath);
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
      // 切节点时丢掉上一节点的胶囊态（放大还原由 nodeId effect cleanup 负责）
      nineGridEnlargeActiveRef.current = false;
      setPromptCapsules([]);
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
    const finalPrompt = composePromptWithCapsules(localPrompt);
    if (!finalPrompt.trim()) {
      return;
    }

    // 以 ref 快照为准，避免闭包/自动切模型竞态导致「UI 有参考图但请求未带 image」
    const refsNow = (latestOrderedImagesRef.current || [])
      .map((u) => String(u || '').trim())
      .filter(Boolean)
      .slice(0, 10);
    const hasRefs = refsNow.length > 0;

    // 强制验证：如果图生图模式但没有图片数据，报错
    // 注意：text/llm 连接到 image 时，isConnected 可能为 true，但 inputImages 为空，这是正常的文生图模式
    if (hasRefs === false && isImageToImageMode) {
      console.error('错误：图生图模式但无法获取源图片数据');
      return;
    }

    // 有参考图但当前模型不支持图生图（或 maxRefs=0）：禁止提交，避免误走文生图接口
    if (hasRefs && !imageModelSupportsI2I(model)) {
      const label = getImageModelLabel(model);
      const msg = `${label} 仅支持文生图，请移除参考图后重试，或改选支持图生图的模型`;
      console.error('[图片生成]', msg);
      showAlert?.(msg);
      onErrorTask?.(msg);
      return;
    }

    const maxRefsAllowed = Math.max(0, getImageModelMaxRefs(model));
    const imagesToUse = hasRefs ? refsNow.slice(0, Math.min(10, maxRefsAllowed)) : [];
    if (hasRefs && imagesToUse.length === 0) {
      const label = getImageModelLabel(model);
      const msg = `${label} 无法携带参考图（maxRefs=${maxRefsAllowed}），请改选支持图生图的模型`;
      console.error('[图片生成]', msg);
      showAlert?.(msg);
      onErrorTask?.(msg);
      return;
    }

    // 立即显示进度条动画（点击运行即开始）
    if (onProgressChange) onProgressChange(1);
    if (onProgressMessageChange) onProgressMessageChange(it.generatingImage);
    onStart?.();

    try {
      const requestParams: any = {
        model,
        prompt: finalPrompt,
        response_format: 'url',
        aspect_ratio: aspectRatio,
        resolution,
        ...(model === 'rhart-image-g'
          ? { rhartGModel: 'g-4.2', quality: 'g-4.2' }
          : {}),
      };
      if (usesTierResolution) {
        const tier = normalizeZImageResolutionTier(resolution);
        const dims = zImageDimensionsForAspect(aspectRatio, tier);
        requestParams.resolution = tier;
        requestParams.seedreamWidth = dims.width;
        requestParams.seedreamHeight = dims.height;
      } else if (isSeedreamV5) {
        requestParams.resolution = seedreamV5Resolution;
        requestParams.seedreamWidth = seedreamWidth;
        requestParams.seedreamHeight = seedreamHeight;
      }

      // 图生图：必须带非空 image，否则主进程会误判为文生图
      if (imagesToUse.length > 0) {
        requestParams.image = imagesToUse;
        console.log(`[图片生成] 图生图模式，使用 ${imagesToUse.length} 张参考图`);
      }

      // 添加项目ID用于资源保存
      if (projectId) {
        requestParams.projectId = projectId;
      }

      if (isImageQueueOnlyModel(model)) {
        requestParams.nxCloudQueueGoldenPath = true;
      }

      await executeAI(requestParams);
    } catch (error) {
      console.error('图片生成失败:', error);
    }
  }, [flushPromptSync, composePromptWithCapsules, localPrompt, model, aspectRatio, resolution, seedreamV5Resolution, seedreamWidth, seedreamHeight, orderedInputImages, executeAI, isImageToImageMode, onStart, onProgressChange, onProgressMessageChange, projectId, isSeedreamV5, usesTierResolution, it.generatingImage, showAlert, onErrorTask]);

  // 图生图模式时，必须有图片数据才能运行；有参考图但模型仅文生时禁用（等自动切模型）
  // 无 OTS 云端价禁止生成（禁止本地价回退）
  const isRunDisabled =
    aiStatus === 'PROCESSING' ||
    !composePromptWithCapsules(localPrompt).trim() ||
    (isImageToImageMode && orderedInputImages.length === 0) ||
    (isImageToImageMode && !imageModelSupportsI2I(model)) ||
    !imagePriceLabel.ok;

  const TAG_ROW_HEIGHT = 30;
  const INPUT_BOX_HEIGHT = 88;
  const THUMB_PANEL_WIDTH = 120;
  const THUMB_COLUMNS = 3;
  const thumbRows = Math.max(1, Math.ceil(orderedInputImages.length / THUMB_COLUMNS));
  const THUMB_AREA_HEIGHT = INPUT_BOX_HEIGHT;
  const THUMB_GAP = 6;
  const thumbColWidth = Math.floor((THUMB_PANEL_WIDTH - 12 - THUMB_GAP * (THUMB_COLUMNS - 1)) / THUMB_COLUMNS);
  const thumbRowHeight = Math.floor((THUMB_AREA_HEIGHT - THUMB_GAP * (thumbRows - 1)) / thumbRows);
  const thumbSize = Math.max(8, Math.min(thumbColWidth, thumbRowHeight));
  const shouldEnableThumbScroll = orderedInputImages.length >= 10;

  const modelControls = (
    <>
      <div className="flex items-center gap-1 shrink-0">
        <PanelOptionDropdown
          value={resolvedModel}
          options={modelOptions}
          onChange={onModelChange}
          isDarkMode={isDarkMode}
          title={it.chooseModelTitle}
          minWidthPx={96}
        />
      </div>
      <div className="flex items-center gap-1 shrink-0">
        <PanelOptionDropdown
          value={resolvedAspectRatio}
          options={effectiveAspectRatioOptions}
          onChange={handleAspectRatioChange}
          isDarkMode={isDarkMode}
          title={it.chooseAspectTitle}
          minWidthPx={64}
        />
      </div>
      {usesTierResolution && (
        <div className="flex items-center gap-1 shrink-0">
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
            minWidthPx={64}
          />
        </div>
      )}
      {isBanana20 && (
        <div className="flex items-center gap-1 shrink-0">
          <PanelOptionDropdown
            value={['1k', '2k', '4k'].includes(resolution) ? resolution : '1k'}
            options={rhartResolutionOptions}
            onChange={onResolutionChange}
            isDarkMode={isDarkMode}
            title={it.chooseResolutionTitle}
            minWidthPx={48}
          />
        </div>
      )}
      {isSeedreamV5 && (
        <div className="flex items-center gap-1 shrink-0">
          <PanelOptionDropdown
            value={seedreamV5Resolution}
            options={seedreamV5ResolutionOptions}
            onChange={onResolutionChange}
            isDarkMode={isDarkMode}
            title={locale === 'en' ? '2k or 3k output (overrides width×height)' : '2k / 3k 输出档（优先于宽高）'}
            minWidthPx={48}
          />
        </div>
      )}
      {isYouchuanOpenApi && (
        <div className="flex items-center gap-1 shrink-0">
          <PanelOptionDropdown
            value={resolution === 'hd' || resolution === '2k' ? 'hd' : '1k'}
            options={youchuanHdOptions}
            onChange={onResolutionChange}
            isDarkMode={isDarkMode}
            title={locale === 'en' ? 'Native 2K HD' : '是否开启原生 2K'}
            minWidthPx={64}
          />
        </div>
      )}
    </>
  );

  const capsuleRow = (
    <div className="mt-2 flex items-center gap-1.5 flex-wrap content-start">
      {promptTags.map((tag) => (
        <button
          key={tag.id}
          type="button"
          onClick={() => {
            const now = Date.now();
            if (now - lastPromptTagClickAtRef.current < PROMPT_TAG_CLICK_COOLDOWN_MS) return;
            lastPromptTagClickAtRef.current = now;
            if (tag.asInputCapsule) {
              const turningOn = !promptCapsules.some((c) => c.id === tag.id);
              togglePromptCapsule(tag);
              if (turningOn && tag.applyAspectRatio) {
                handleAspectRatioChange(tag.applyAspectRatio);
              }
              return;
            }
            appendToPrompt(tag.text);
          }}
          className={`px-2 py-0.5 text-[11px] rounded-full border font-medium transition-colors whitespace-nowrap flex-shrink-0 ${tag.color} ${
            tag.asInputCapsule && promptCapsules.some((c) => c.id === tag.id)
              ? 'ring-2 ring-white/70'
              : ''
          }`}
          title={tag.asInputCapsule ? `${tag.label}（胶囊挂载，正文不显示）` : tag.label}
        >
          {tag.label}
        </button>
      ))}
    </div>
  );

  return (
    <div className="relative flex w-full flex-col">
      <div
        className={[
          'relative flex flex-col overflow-hidden rounded-[18px] border transition-colors',
          'h-[170px]',
          isDarkMode
            ? 'nexflow-glass-panel border-white/[0.14] shadow-[0_8px_28px_rgba(0,0,0,0.28)]'
            : 'apple-panel-light border-black/[0.08] shadow-[0_8px_28px_rgba(0,0,0,0.06)]',
          'px-3.5 pt-2.5 pb-2',
        ].join(' ')}
      >
        <div className="flex-1 min-h-0 flex gap-2">
          <div className="flex-1 min-w-0 flex flex-col min-h-0">
            {(isImageToImageMode && orderedInputImages.length > 0) || promptCapsules.length > 0 ? (
              <div className="mb-1 flex flex-wrap items-center gap-1 flex-shrink-0">
                {isImageToImageMode && orderedInputImages.length > 0 ? (
                  <span
                    className={`inline-flex items-center px-1.5 py-0.5 rounded-md text-[11px] font-semibold ${
                      isDarkMode ? 'bg-sky-500/25 text-sky-300' : 'bg-sky-100 text-sky-700'
                    }`}
                  >
                    @{it.refImagesCount(orderedInputImages.length)}
                  </span>
                ) : null}
                {promptCapsules.map((chip) => (
                  <span
                    key={chip.id}
                    className={`inline-flex items-center gap-0.5 max-w-[180px] px-1.5 py-0.5 rounded-md text-[11px] font-semibold border ${chip.color}`}
                    title={chip.label}
                  >
                    <span className="truncate">@{chip.label}</span>
                    <button
                      type="button"
                      className="nodrag shrink-0 rounded p-0.5 opacity-80 hover:opacity-100"
                      aria-label={`remove ${chip.label}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        removePromptCapsule(chip.id);
                      }}
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </span>
                ))}
              </div>
            ) : null}
            <div className="relative flex-1 min-h-0 flex flex-col">
              <PromptRichInput
                ref={promptInputRef}
                value={localPrompt}
                candidates={mentionCandidates}
                readOnly={micInputLocked}
                disabled={micInputLocked}
                isDarkMode={isDarkMode}
                placeholder={it.placeholderPrompt}
                title={it.titlePromptInput}
                onFocus={() => {
                  if (micInputLocked) return;
                  promptInputFocusedRef.current = true;
                  onPromptFocus?.();
                }}
                onCompositionChange={(next) => {
                  onMentionCompositionChange(next);
                  setPromptComposing(next);
                }}
                onBlur={() => {
                  promptInputFocusedRef.current = false;
                  if (promptDebounceRef.current) {
                    clearTimeout(promptDebounceRef.current);
                    promptDebounceRef.current = null;
                  }
                  const v = promptInputRef.current?.getPlainText() ?? localPrompt;
                  if (v !== lastSentPromptRef.current) {
                    lastSentPromptRef.current = v;
                    setLocalPrompt(v);
                    onPromptChange(v);
                  }
                }}
                onKeyDown={onMentionKeyDown}
                onSubmit={() => {
                  if (micInputLocked || isRunDisabled) return;
                  void handleExecute();
                }}
                onInputCheck={onMentionInputCheck}
                onChange={(v) => {
                  if (micInputLocked) return;
                  setLocalPrompt(v);
                  if (promptDebounceRef.current) clearTimeout(promptDebounceRef.current);
                  promptDebounceRef.current = setTimeout(() => {
                    promptDebounceRef.current = null;
                    lastSentPromptRef.current = v;
                    onPromptChange(v);
                  }, 450);
                }}
                onRefPillHover={(match) => {
                  setHoveredRefFromPillIndex(resolveRefPillToOrderedIndex(match, latestOrderedImagesRef.current));
                }}
                className={`w-full flex-1 min-h-0 [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden transition-opacity pr-9 pt-8 ${
                  micInputLocked ? 'opacity-45 cursor-not-allowed' : ''
                }`}
                style={{ caretColor: isDarkMode ? '#0A84FF' : '#22c55e' }}
              />
              <div className="absolute top-0.5 right-0 z-10 pointer-events-auto">
                {promptVoiceMicButton}
              </div>
              <AtMentionMenu {...mentionMenuProps} />
            </div>
          </div>

          {orderedInputImages.length > 0 && (
            <div
              className={`w-[100px] flex-shrink-0 rounded-lg border p-1 flex flex-col min-h-0 overflow-hidden ${
                isDarkMode ? 'border-gray-600/40 bg-black/20' : 'border-gray-300/60 bg-white/60'
              }`}
            >
              <div
                className={`grid grid-cols-2 gap-1 flex-1 min-h-0 ${
                  shouldEnableThumbScroll && !hideScrollbarsForVoice
                    ? 'overflow-y-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden'
                    : 'overflow-hidden'
                }`}
                style={{
                  gridTemplateColumns: `repeat(2, 1fr)`,
                  alignContent: 'start',
                }}
                onDragOver={(e) => {
                  if (!isDraggingThumb) return;
                  e.preventDefault();
                  e.stopPropagation();
                }}
              >
                {orderedInputImages.map((url, index) => {
                  const isDragSource = isDraggingThumb && dragImageIndexRef.current === index;
                  const isDropTarget = isDraggingThumb && dragOverIndex === index && dragImageIndexRef.current !== index;
                  const isPillHoverMatch = hoveredRefFromPillIndex === index;
                  return (
                    <motion.div
                      key={url || `ref-${index}`}
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
                        if (isDraggingThumb || thumbDragDidReorderRef.current) return;
                        appendRefImageMentionToPrompt(index);
                      }}
                      onDragEnd={(e) => handleThumbDragEnd(e)}
                      className={`relative rounded-md overflow-visible border aspect-square ${isDraggingThumb ? 'cursor-grabbing' : 'cursor-grab'} ${
                        isDropTarget
                          ? 'border-green-400 ring-2 ring-green-400/90'
                          : isDragSource
                            ? 'border-white/30 border-dashed'
                            : isDarkMode
                              ? 'border-white/20'
                              : 'border-gray-300'
                      }`}
                      style={{
                        transition: 'border-color 0.15s ease, box-shadow 0.15s ease, opacity 0.18s ease',
                        opacity: isDragSource ? 0.35 : 1,
                      }}
                      animate={{ scale: isDropTarget ? 1.04 : 1 }}
                    >
                      <RefImageHoverThumb
                        url={url}
                        alt={it.refThumbAlt(index + 1)}
                        title={it.refThumbTitle(index + 1)}
                        indexLabel={index + 1}
                        objectFit="cover"
                        className="h-full w-full overflow-visible rounded-md"
                        previewDisabled={isDraggingThumb}
                        emphasize={isPillHoverMatch}
                        onRemove={() => {
                          const removed = String(url || '').trim();
                          const next = latestOrderedImagesRef.current.filter((_, i) => i !== index);
                          onDisconnectRefImage?.(removed);
                          commitInputImagesOrder(next);
                        }}
                      />
                    </motion.div>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        <div className="mt-1 flex items-center gap-1.5 flex-shrink-0 min-w-0">
          {modelControls}
          <div className="flex-1" />
          {isImageToImageMode && orderedInputImages.length > 0 && (
            <span
              className={`text-[11px] font-medium px-2 py-0.5 rounded-full shrink-0 ${
                isDarkMode ? 'text-white/50 bg-white/10' : 'text-gray-500 bg-gray-100'
              }`}
              title={it.maxRefImagesTitle(maxRefImages)}
            >
              {it.maxRefImages(maxRefImages)}
            </span>
          )}
          {imagePriceLabel.ok ? (
            <span
              className={`text-[11px] font-medium px-2 py-0.5 rounded-full shrink-0 tabular-nums border ${
                isDarkMode
                  ? 'text-amber-200/90 bg-amber-500/15 border-amber-400/25'
                  : 'text-amber-700 bg-amber-50 border-amber-200'
              }`}
              title={it.priceTooltip}
            >
              {imagePriceLabel.value}
              {locale === 'en' ? ' ' : ''}
              {it.creditsSuffix}
            </span>
          ) : (
            <span
              className={`text-[11px] font-medium px-2 py-0.5 rounded-full shrink-0 ${
                isDarkMode ? 'text-white/45 bg-white/10' : 'text-gray-500 bg-gray-100'
              }`}
              title={it.noPricingTitle}
            >
              {it.noPricingYet}
            </span>
          )}
          {model === 'rhart-image-g-2' ||
          model === 'rhart-image-g-2.5' ||
          model === 'banana-2.0' ||
          model === 'rhart-image-g' ? (
            <span
              className={`text-[11px] font-medium px-2 py-0.5 rounded-full shrink-0 border ${
                isImageToImageMode
                  ? isDarkMode
                    ? 'text-violet-200/90 bg-violet-500/20 border-violet-400/30'
                    : 'text-violet-700 bg-violet-50 border-violet-200'
                  : isDarkMode
                    ? 'text-sky-200/90 bg-sky-500/20 border-sky-400/30'
                    : 'text-sky-700 bg-sky-50 border-sky-200'
              }`}
              title={isImageToImageMode ? it.modeTooltipI2I(orderedInputImages.length) : it.modeTooltipT2I}
            >
              {isImageToImageMode ? it.runI2I : it.runT2I}
            </span>
          ) : null}
          <button
            type="button"
            onClick={handleExecute}
            disabled={isRunDisabled}
            className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 transition-colors ${
              isRunDisabled
                ? isDarkMode
                  ? 'bg-white/[0.08] text-white/25 cursor-not-allowed'
                  : 'bg-black/[0.06] text-gray-400 cursor-not-allowed'
                : isImageToImageMode
                  ? 'bg-purple-500 text-white hover:bg-purple-600'
                  : isDarkMode
                    ? 'bg-white text-black hover:bg-white/90'
                    : 'bg-gray-900 text-white hover:bg-gray-800'
            }`}
            title={isImageToImageMode ? it.modeTooltipI2I(orderedInputImages.length) : it.modeTooltipT2I}
            aria-label={isImageToImageMode ? it.runI2I : it.runT2I}
          >
            {aiStatus === 'PROCESSING' ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <ArrowUp className="w-3.5 h-3.5" strokeWidth={2.5} />
            )}
          </button>
        </div>
      </div>

      {capsuleRow}
    </div>
  );
};

export default ImageInputPanel;
