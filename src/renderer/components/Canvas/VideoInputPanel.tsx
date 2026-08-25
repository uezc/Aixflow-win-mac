// @ts-nocheck
import React, { useCallback, useRef, useEffect, useState, useMemo } from 'react';
import { ArrowUp, ChevronUp, ChevronDown, Mic, Loader2, Video, Check, Image as ImageIcon, X, AudioLines, Volume2, VolumeX, Plus } from 'lucide-react';
import { assetLibBtnPrimary } from '../../utils/assetLibraryChrome';
import { useAI } from '../../hooks/useAI';
import { useAppLocale } from '../../contexts/AppLocaleContext';
import { useDarkAlert } from '../../contexts/DarkAlertContext';
import { videoInputPanelT } from '../../i18n/videoInputPanelI18n';
import { audioInputPanelT } from '../../i18n/audioInputPanelI18n';
import { workspaceChromeT } from '../../i18n/workspaceI18n';
import {
  DarkModalFrame,
  darkModalBtnCancelClass,
  darkModalBtnOkClass,
  darkModalFooterClass,
  darkModalPanelMdClass,
} from '../darkModalShell';
import { useCloudRealtimeDictation } from '../../hooks/useCloudRealtimeDictation';
import { useDictationPushToTalk } from '../../hooks/useDictationPushToTalk';
import { micLevelCssVars } from '../../utils/micInputLevel';
import { acquireVoiceModalLock, releaseVoiceModalLock } from '../../utils/voiceModalGate';
import VoiceMicGlyph from './VoiceMicGlyph';
import { AiGenerateDisclaimerTip } from '../legal/AiGenerateDisclaimerTip';
import { RefImageHoverThumb } from './RefImageHoverThumb';
import { AudioEqThumb } from './AudioEqThumb';
import { AtMentionMenu } from './AtMentionMenu';
import { PromptRichInput, type PromptRichInputHandle } from './PromptRichInput';
import { usePromptAtMention } from '../../hooks/usePromptAtMention';
import { resolveRefPillToOrderedIndex } from '../../utils/promptRefPill';
import { isModelNotPricedError } from '../../utils/priceCalc';
import { getVideoDisplayPrice, LLM_CHAT_DISPLAY_MODEL_ID, LLM_CHAT_MODEL_IDS, LLM_CHAT_MODEL_LABELS } from '../../utils/cloudModelPricing';
import { PanelOptionDropdown } from './PanelOptionDropdown';
import { coerceAssistantText } from '../../../shared/directorPipeline/normalize';
import {
  buildMinimaxH3OptimizeMessages,
  isAcceptableMinimaxH3OptimizedPrompt,
  parseMinimaxH3OptimizedPrompt,
  recoverMinimaxH3OptimizedPrompt,
  resolveMinimaxH3BaseSubMode,
  resolveMinimaxH3OptimizeStructure,
} from '../../../shared/minimaxH3OptimizePrompt';
import { toElectronVideoElementSrc } from '../../utils/normalizeVideoUrl';
import {
  DOUBAO_SEED_AUDIO_MODEL_ID,
  DOUBAO_SEED_AUDIO_LABEL,
  isDoubaoSeedAudioModel,
} from '../../utils/doubaoSeedAudioModel';
import {
  beginDigitalHumanLibraryPick,
  openAssetLibrary,
} from '../../utils/assetLibraryOpenStore';
import { basenameFromAudioUrl } from '../../utils/audioSongModels';

export type VideoConnectedAudioInfo = {
  nodeId: string;
  name: string;
  url?: string;
};

/** 本机路径 → local-resource://（与数字人库上传一致） */
function pathToLocalResourceUrl(filePath: string): string {
  const normalized = filePath.replace(/\\/g, '/').replace(/^\/[a-zA-Z]:/, (m) => m.substring(1));
  return `local-resource://${normalized}`;
}

const HEYGEM_TTS_MODELS = [
  { value: DOUBAO_SEED_AUDIO_MODEL_ID, label: DOUBAO_SEED_AUDIO_LABEL },
  { value: 'index-tts2', label: 'Index-TTS 2.0' },
] as const;
const HEYGEM_SCRIPT_MAX = 1000;
import {
  GROK3_STABLE_DURATION_SEC_OPTIONS,
  RHART_VIDEO_X_DURATION_SEC_OPTIONS,
  normalizeGrok3Resolution,
  normalizeGrok3StableDurationStr,
  normalizeRhartVideoXDurationStr,
  SEEDANCE_DURATION_SEC_OPTIONS,
  SEEDANCE_RATIO_OPTIONS,
  normalizeSeedanceDurationChoice,
  coerceSeedanceResolution,
  coerceSeedanceRatio,
  GEMINI_OMNI_DURATION_SEC_OPTIONS,
  GEMINI_OMNI_FLASH_DURATION_SEC_OPTIONS,
  normalizeGeminiOmniDurationChoice,
  normalizeGeminiOmniFlashDurationChoice,
  mapMinimaxH3AudioBillingDurationSec,
  normalizeMinimaxH3AudioDurationChoice,
} from '../../utils/videoBillingSku';
import { extractSeedanceImageMentionIndices } from '../../utils/seedanceImageMentions';
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
  flattenLtx23HdrSlots,
  isLtx23HdrMultiRunnable,
  normalizeLtx23HdrStoryboardSlots,
  splitLtx23HdrMultiImagesFromCollected,
  swapLtx23HdrFlatSlots,
  unflattenLtx23HdrSlots,
  validateLtx23HdrMultiInputs,
} from '../../../common/ltx23HdrMulti';
import {
  LTX23_MSR_AV_MODEL_ID,
  LTX23_MSR_AV_LABEL,
  isLtx23MsrAvModel,
} from '../../../common/ltx23MsrAv';

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
  aspectRatio: '16:9' | '9:16' | '1:1' | '2:3' | '3:2' | 'adaptive' | '4:3' | '3:4' | '21:9';
  model: 'sora-2' | 'sora-2-pro' | 'kling-v2.6-pro' | 'kling-video-o1' | 'kling-video-o1-i2v' | 'kling-video-o1-start-end' | 'kling-video-o1-ref' | 'wan-2.6' | 'wan-2.6-flash' | 'wan-animate' | 'wan-animate-2' | 'hey-gem' | 'gemini-omni' | 'gemini-omni-flash' | 'seedance-2.0-fast' | 'seedance-2.0-mini' | 'ltx-2.3-lipsync' | 'ltx-2.3-i2v' | 'ltx-2.3-t2v' | 'ltx-2.3-hdr-multi' | 'ltx-2.3-msr-av' | 'rhart-v3.1-fast' | 'rhart-v3.1-fast-se' | 'rhart-v3.1-pro' | 'rhart-v3.1-pro-se' | 'grok-3' | 'rhart-video-x' | 'grok-3-stable' | 'rhart-v3.1-pro-official-i2v' | 'hailuo-02-t2v-standard' | 'hailuo-2.3-t2v-standard' | 'hailuo-02-i2v-standard' | 'hailuo-2.3-i2v-standard' | 'rh-video-start-end' | 'minimax-h3-t2v' | 'minimax-h3-i2v' | 'minimax-h3-multi' | 'minimax-h3-audio' | 'rhart-video-upscaler';
  hd: boolean;
  duration: '5' | '10' | '15' | '25';
  inputImages?: string[]; // 图生视频参考图
  /** ltx-2.3-lipsync / MiniMax H3 全能参考（可选）：输入音频 URL（由画布从连线解析传入） */
  inputAudioUrl?: string;
  /** 画布连到该视频节点的全部音频入边（展示数量与名称；提交仍取第 1 路 URL） */
  connectedAudios?: VideoConnectedAudioInfo[];
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
  /** MiniMax-H3 文生/图生/多参：时长 6|10|15|20；分辨率仅 720P → megapixels 0.9 */
  durationMinimaxH3?: '6' | '10' | '15' | '20';
  resolutionMinimaxH3?: '720p';
  onDurationMinimaxH3Change?: (value: '6' | '10' | '15' | '20') => void;
  onResolutionMinimaxH3Change?: (value: '720p') => void;
  durationLtx23HdrMulti?: '5' | '10' | '15';
  resolutionLtx23HdrMulti?: '720' | '1280';
  ltx23HdrBackgroundImage?: string;
  onDurationLtx23HdrMultiChange?: (value: '5' | '10' | '15') => void;
  onResolutionLtx23HdrMultiChange?: (value: '720' | '1280') => void;
  onLtx23HdrBackgroundImageChange?: (value: string) => void;
  /** LTX2.3 高动态：分镜图顺序写回节点 data.inputImages */
  onInputImagesOrderChange?: (images: string[]) => void;
  /** LTX2.3 MSR：删除选中卡槽对应图片的入边（或取消角色传出勾选） */
  onDisconnectHdrSlotImage?: (imageUrl: string) => void;
  /** Sora2 算力渠道：plugin=插件算力(RunningHub)，core=核心算力(BLTCY) */
  sora2Channel?: 'plugin' | 'core';
  onSora2ChannelChange?: (value: 'plugin' | 'core') => void;
  negativePrompt?: string;
  resolutionWan26?: '720p' | '1080p';
  durationWan26Flash?: '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | '10' | '11' | '12' | '13' | '14' | '15';
  enableAudio?: boolean;
  durationVeo31ProOfficial?: '4' | '6' | '8';
  generateAudioVeo31ProOfficial?: boolean;
  // 全能视频V3.1-fast：720p|1080p|4k；LTX2.3 首位帧：720p|1080p|1920p
  resolutionRhartV31?: '720p' | '1080p' | '4k' | '1920p' | '720' | '1280' | '1920';
  /** Grok video3：时长 6|10|15|30 秒 */
  durationGrok3?: string;
  resolutionGrok3?: '480p' | '720p';
  onDurationGrok3Change?: (value: string) => void;
  onResolutionGrok3Change?: (value: '480p' | '720p') => void;
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
  onResolutionRhartV31Change?: (value: '720p' | '1080p' | '4k' | '1920p' | '720' | '1280' | '1920') => void;
  onDurationHailuo02Change?: (value: '6' | '10') => void;
  onResolutionHailuoChange?: (value: 'na' | '720p' | '1080p' | '4k') => void;
  onDurationKlingO1Change?: (value: '5' | '10') => void;
  onModeKlingO1Change?: (value: 'std' | 'pro') => void;
  onResolutionWanAnimateChange?: (value: '720p' | '1080p') => void;
  onWanAnimateClipSecChange?: (value: '5' | '8' | '10' | '15') => void;
  /** 视频超分放大：目标分辨率 */
  targetResolution?: '720p' | '1080p' | '2k' | '4k';
  onTargetResolutionChange?: (value: '720p' | '1080p' | '2k' | '4k') => void;
  /** Seedance 2.0 Fast / Mini：720p|1080p（Mini 另支持 480p/2k/4k），时长 5|10|15 秒 */
  resolutionSeedance?: '480p' | '720p' | '1080p' | '2k' | '4k';
  durationSeedance?: '5' | '10' | '15';
  onResolutionSeedanceChange?: (value: '480p' | '720p' | '1080p' | '2k' | '4k') => void;
  onDurationSeedanceChange?: (value: '5' | '10' | '15') => void;
  /** Gemini Omni / Omni Flash 图生视频：720p|1080p|4k，时长 6|8|10 秒 */
  resolutionGeminiOmni?: '720p' | '1080p' | '4k';
  durationGeminiOmni?: '6' | '8' | '10';
  onResolutionGeminiOmniChange?: (value: '720p' | '1080p' | '4k') => void;
  onDurationGeminiOmniChange?: (value: '6' | '8' | '10') => void;
  /**
   * 提示词写回。第二参为产生该值的节点 id，避免切节点/卸载时写到错误目标。
   */
  onPromptChange: (value: string, sourceNodeId?: string) => void;
  /** MiniMax-H3：优化提示词成功写回前保存的原文（持久化到节点 data） */
  promptBeforeOptimize?: string;
  onPromptBeforeOptimizeChange?: (value: string, sourceNodeId?: string) => void;
  /** MiniMax-H3：用于「优化提示词」的大语言模型（与视频生成模型分开） */
  optimizePromptChatModel?: string;
  onOptimizePromptChatModelChange?: (value: string, sourceNodeId?: string) => void;
  /**
   * MiniMax-H3：优化成功时原子写回（prompt + promptBeforeOptimize），
   * 避免两次 setNodes 竞态导致原文丢失。
   */
  onMinimaxH3OptimizeApply?: (payload: {
    nodeId: string;
    prompt: string;
    promptBeforeOptimize: string;
  }) => void;
  onAspectRatioChange: (value: '16:9' | '9:16' | '1:1' | '2:3' | '3:2' | 'adaptive' | '4:3' | '3:4' | '21:9') => void;
  onModelChange: (value: 'sora-2' | 'sora-2-pro' | 'kling-v2.6-pro' | 'kling-video-o1' | 'kling-video-o1-i2v' | 'kling-video-o1-start-end' | 'kling-video-o1-ref' | 'wan-2.6' | 'wan-2.6-flash' | 'wan-animate' | 'wan-animate-2' | 'gemini-omni' | 'gemini-omni-flash' | 'seedance-2.0-fast' | 'seedance-2.0-mini' | 'ltx-2.3-lipsync' | 'ltx-2.3-i2v' | 'ltx-2.3-t2v' | 'ltx-2.3-hdr-multi' | 'ltx-2.3-msr-av' | 'rhart-v3.1-fast' | 'rhart-v3.1-fast-se' | 'rhart-v3.1-pro' | 'rhart-v3.1-pro-se' | 'grok-3' | 'rhart-video-x' | 'grok-3-stable' | 'rhart-v3.1-pro-official-i2v' | 'hailuo-02-t2v-standard' | 'hailuo-2.3-t2v-standard' | 'hailuo-02-i2v-standard' | 'hailuo-2.3-i2v-standard' | 'rh-video-start-end' | 'minimax-h3-t2v' | 'minimax-h3-i2v' | 'minimax-h3-multi' | 'minimax-h3-audio' | 'rhart-video-upscaler') => void;
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
  /** 配置 UI 嵌进节点主框时去掉外层玻璃边框，避免与节点壳叠框 */
  embedInNode?: boolean;
  /** HeyGem：模块内写入参考视频（不依赖左侧连线） */
  onReferenceVideoUrlChange?: (url: string) => void;
  /** HeyGem：模块内写入驱动音频 */
  onInputAudioUrlChange?: (url: string) => void;
  /** HeyGem：从画布点选参考视频 */
  onPickReferenceVideoFromCanvas?: () => Promise<string | null>;
  /** HeyGem：台词（TTS） */
  heyGemScript?: string;
  onHeyGemScriptChange?: (value: string) => void;
  /** HeyGem：配音模型（语音克隆） */
  heyGemTtsModel?: string;
  onHeyGemTtsModelChange?: (value: string) => void;
  /** HeyGem：克隆参考音（可选；Index-TTS 优先） */
  heyGemCloneAudioUrl?: string;
  onHeyGemCloneAudioUrlChange?: (value: string) => void;
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
  promptBeforeOptimize = '',
  onPromptBeforeOptimizeChange,
  optimizePromptChatModel = LLM_CHAT_DISPLAY_MODEL_ID,
  onOptimizePromptChatModelChange,
  onMinimaxH3OptimizeApply,
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
  embedInNode = false,
  onReferenceVideoUrlChange,
  onInputAudioUrlChange,
  onPickReferenceVideoFromCanvas,
  heyGemScript = '',
  onHeyGemScriptChange,
  heyGemTtsModel = DOUBAO_SEED_AUDIO_MODEL_ID,
  onHeyGemTtsModelChange,
  heyGemCloneAudioUrl = '',
  onHeyGemCloneAudioUrlChange,
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
  connectedAudios,
  resolutionLtx23Lipsync = '720', // API 档 720/1280/1920；展示为 720p/1280/1920
  onResolutionLtx23LipsyncChange,
  durationLtx23I2v = '10',
  resolutionLtx23I2v = '720',
  onDurationLtx23I2vChange,
  onResolutionLtx23I2vChange,
  durationLtx23T2v = '10',
  resolutionLtx23T2v = '720',
  onDurationLtx23T2vChange,
  onResolutionLtx23T2vChange,
  durationMinimaxH3 = '10',
  resolutionMinimaxH3 = '720p',
  onDurationMinimaxH3Change,
  onResolutionMinimaxH3Change,
  durationLtx23HdrMulti = '15',
  resolutionLtx23HdrMulti = '720',
  ltx23HdrBackgroundImage = '',
  onDurationLtx23HdrMultiChange,
  onResolutionLtx23HdrMultiChange,
  onLtx23HdrBackgroundImageChange,
  onInputImagesOrderChange,
  onDisconnectHdrSlotImage,
  sora2Channel = 'plugin',
  onSora2ChannelChange,
  resolutionWanAnimate = '720p',
  wanAnimateClipSec = '8',
  onResolutionWanAnimateChange,
  onWanAnimateClipSecChange,
  targetResolution = '1080p',
  onTargetResolutionChange,
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
  const promptInputRef = useRef<PromptRichInputHandle>(null);
  const dragImageIndexRef = useRef<number | null>(null);
  /** LTX2.3 高动态：'background' 或分镜 index */
  const hdrDragSourceRef = useRef<'background' | number | null>(null);
  const hdrBackgroundRef = useRef('');
  const latestOrderedImagesRef = useRef<string[]>([]);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
  const [dragOverBackground, setDragOverBackground] = useState(false);
  const [isDraggingThumb, setIsDraggingThumb] = useState(false);
  const [hoveredRefFromPillIndex, setHoveredRefFromPillIndex] = useState<number | null>(null);
  const [orderedInputImages, setOrderedInputImages] = useState<string[]>(() => (inputImages || []).slice(0, 10));
  const [hdrBackground, setHdrBackground] = useState('');
  const [storyboardImages, setStoryboardImages] = useState<string[]>(() =>
    normalizeLtx23HdrStoryboardSlots(inputImages || []),
  );
  /** 选中的 MSR 卡槽：0=背景，1–4=分镜；Delete 断开对应连线 */
  const [selectedHdrSlotIndex, setSelectedHdrSlotIndex] = useState<number | null>(null);
  const { cloudMap } = useNxModelPricing();
  // 本地 prompt + 防抖：修复输入法（IME）问题，避免每次按键触发父组件重渲染打断中文输入
  const [localPrompt, setLocalPrompt] = useState(prompt);
  const localPromptRef = useRef(localPrompt);
  localPromptRef.current = localPrompt;
  const lastSentPromptRef = useRef(prompt);
  const promptDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const prevNodeIdRef = useRef(nodeId);
  const promptInputFocusedRef = useRef(false);
  const [promptComposing, setPromptComposing] = useState(false);
  const onPromptChangeRef = useRef(onPromptChange);
  onPromptChangeRef.current = onPromptChange;

  /** 将本地未落盘的提示词写回指定节点（切节点 / 卸载时必须带旧 nodeId） */
  const flushPromptToNode = useCallback((targetNodeId: string, value: string) => {
    if (promptDebounceRef.current) {
      clearTimeout(promptDebounceRef.current);
      promptDebounceRef.current = null;
    }
    if (value === lastSentPromptRef.current) return;
    lastSentPromptRef.current = value;
    onPromptChangeRef.current(value, targetNodeId);
  }, []);

  /** HeyGem 一体化：台词 / TTS / 数字人库选择 */
  const [localHeyGemScript, setLocalHeyGemScript] = useState(heyGemScript || '');
  const localHeyGemScriptRef = useRef(localHeyGemScript);
  const heyGemScriptFocusedRef = useRef(false);
  const heyGemPreviewVideoRef = useRef<HTMLVideoElement | null>(null);
  const [heyGemPreviewMuted, setHeyGemPreviewMuted] = useState(true);
  const [heyGemTtsBusy, setHeyGemTtsBusy] = useState(false);
  const heyGemTtsWaiterRef = useRef<{
    resolve: (url: string) => void;
    reject: (err: Error) => void;
  } | null>(null);

  useEffect(() => {
    localHeyGemScriptRef.current = localHeyGemScript;
  }, [localHeyGemScript]);

  useEffect(() => {
    if (heyGemScriptFocusedRef.current) return;
    setLocalHeyGemScript(heyGemScript || '');
  }, [heyGemScript, nodeId]);

  useEffect(() => {
    setHeyGemPreviewMuted(true);
  }, [referenceVideoUrl, nodeId]);

  useEffect(() => {
    const prevId = prevNodeIdRef.current;
    const nodeIdChanged = prevId !== nodeId;
    if (nodeIdChanged) {
      // 先把上一节点未防抖落盘的编辑写回旧 nodeId，再切换本地态
      flushPromptToNode(prevId, localPromptRef.current);
      prevNodeIdRef.current = nodeId;
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
  }, [prompt, nodeId, flushPromptToNode]);

  useEffect(() => {
    return () => {
      // 取消选中卸载时：绝不能只清 debounce 而丢掉用户输入（否则重选会回退到旧优化稿）
      flushPromptToNode(prevNodeIdRef.current, localPromptRef.current);
    };
  }, [flushPromptToNode]);

  useEffect(() => {
    if (model === 'ltx-2.3-hdr-multi' || isLtx23MsrAvModel(model)) return;
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

  const thumbDragDidReorderRef = useRef(false);

  const primeThumbDragTransfer = useCallback((e?: React.DragEvent<HTMLElement>) => {
    if (!e?.dataTransfer) return;
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', 'thumb');
  }, []);

  const handleThumbDragStart = useCallback((index: number, e?: React.DragEvent<HTMLButtonElement>) => {
    e?.stopPropagation();
    thumbDragDidReorderRef.current = false;
    hdrDragSourceRef.current = null;
    dragImageIndexRef.current = index;
    primeThumbDragTransfer(e);
    setIsDraggingThumb(true);
    setDragOverIndex(null);
    setDragOverBackground(false);
  }, [primeThumbDragTransfer]);

  const handleHdrDragStart = useCallback((source: 'background' | number, e?: React.DragEvent<HTMLButtonElement>) => {
    e?.stopPropagation();
    thumbDragDidReorderRef.current = false;
    hdrDragSourceRef.current = source;
    dragImageIndexRef.current = source === 'background' ? -1 : source;
    primeThumbDragTransfer(e);
    setIsDraggingThumb(true);
    setDragOverIndex(source === 'background' ? null : source);
    setDragOverBackground(false);
  }, [primeThumbDragTransfer]);

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
    thumbDragDidReorderRef.current = true;
  }, []);

  const finalizeThumbDrag = useCallback(
    (e?: React.DragEvent<HTMLElement>) => {
      e?.stopPropagation();
      if (model !== 'ltx-2.3-hdr-multi' && model !== LTX23_MSR_AV_MODEL_ID && onInputImagesOrderChange) {
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
    promptInputRef.current?.setPlainText(next);
    setLocalPrompt(next);
    lastSentPromptRef.current = next;
    onPromptChange(next, nodeId);
    promptInputRef.current?.focus();
  }, [onPromptChange, localPrompt, nodeId]);

  /** 点击参考图缩略图：插入与 @ 菜单相同的缩略图+文字胶囊（序列化 @图片N） */
  const appendRefImageMentionToPrompt = useCallback(
    (imageIndex: number) => {
      const idx = imageIndex - 1;
      const tag = vt.appendSeedanceImageTag(imageIndex);
      const url = String(orderedInputImages[idx] || '').trim();
      const label = locale === 'en' ? `Image${imageIndex}` : `图片${imageIndex}`;
      const item = {
        id: `ref-image-${idx}`,
        origin: 'ref' as const,
        type: 'image' as const,
        label,
        refLabel: label,
        thumbUrl: url || undefined,
        insertText: tag,
        subtitle: locale === 'en' ? 'Reference' : '参考图',
      };
      const next =
        promptInputRef.current?.insertMention(item) ??
        (() => {
          const trimmedEnd = localPrompt.trimEnd();
          const needSpace = trimmedEnd.length > 0 && !/\s$/.test(localPrompt);
          return trimmedEnd + (needSpace ? ' ' : '') + tag;
        })();
      setLocalPrompt(next);
      lastSentPromptRef.current = next;
      onPromptChange(next, nodeId);
      promptInputRef.current?.focus();
    },
    [onPromptChange, localPrompt, nodeId, vt, orderedInputImages, locale],
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
      onPromptChange(full, nodeId);
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
          ? vt.voiceTranscribing
          : isDictationActive
            ? wc.textVoiceInputStopButton
            : wc.textVoiceInputTitle
      }
      aria-label={
        micVoiceBusy
          ? vt.voiceTranscribing
          : isDictationActive
            ? wc.textVoiceInputStopButton
            : wc.textVoiceInputTitle
      }
    >
      <VoiceMicGlyph
        busy={micVoiceBusy}
        active={dictationStatus === 'listening'}
        level={dictationInputLevel}
      />
    </button>
  );

  /** HeyGem 台词框：云端实时听写（PTT） */
  const {
    status: heyGemDictationStatus,
    isActive: isHeyGemDictationActive,
    inputLevel: heyGemDictationInputLevel,
    start: startHeyGemRealtimeDictation,
    stop: stopHeyGemRealtimeDictation,
    cancel: cancelHeyGemRealtimeDictation,
  } = useCloudRealtimeDictation({
    getBaseText: () => {
      const prev = (localHeyGemScriptRef.current || '').trimEnd();
      return prev ? `${prev}\n` : '';
    },
    onLiveText: (full) => {
      const clipped = String(full || '').slice(0, HEYGEM_SCRIPT_MAX);
      setLocalHeyGemScript(clipped);
      onHeyGemScriptChange?.(clipped);
    },
    onError: (message) => {
      showAlert(message);
    },
    onMicDenied: () => {
      showAlert(refMicAt.micPermissionDenied);
    },
  });

  const heyGemMicVoiceBusy =
    heyGemDictationStatus === 'connecting' || heyGemDictationStatus === 'stopping';
  const heyGemMicVoiceStopping = heyGemDictationStatus === 'stopping';

  const { pointerHandlers: heyGemScriptMicPointerHandlers } = useDictationPushToTalk({
    start: startHeyGemRealtimeDictation,
    stop: stopHeyGemRealtimeDictation,
    cancel: cancelHeyGemRealtimeDictation,
    status: heyGemDictationStatus,
    disabled: heyGemMicVoiceStopping,
  });

  const heyGemScriptVoiceMicButton = (
    <button
      type="button"
      {...heyGemScriptMicPointerHandlers}
      disabled={heyGemMicVoiceStopping}
      style={
        heyGemDictationStatus === 'listening' || heyGemDictationStatus === 'connecting'
          ? micLevelCssVars(heyGemDictationInputLevel)
          : undefined
      }
      className={`nexflow-voice-mic-btn nodrag nopan relative flex h-7 w-7 shrink-0 items-center justify-center rounded border select-none ${
        heyGemDictationStatus === 'connecting'
          ? 'connecting'
          : heyGemDictationStatus === 'listening'
            ? 'listening'
            : ''
      } ${
        heyGemMicVoiceStopping
          ? isDarkMode
            ? 'cursor-wait border-white/25 bg-white/5 text-white/75'
            : 'cursor-wait border-gray-300 bg-white/90 text-gray-600'
          : isDarkMode
            ? 'border-white/25 bg-white/5 text-white/75 hover:bg-white/10 hover:text-white'
            : 'border-gray-300 bg-white/90 text-gray-600 hover:bg-gray-100'
      }`}
      title={
        heyGemMicVoiceBusy
          ? vt.voiceTranscribing
          : isHeyGemDictationActive
            ? wc.textVoiceInputStopButton
            : wc.textVoiceInputTitle
      }
      aria-label={
        heyGemMicVoiceBusy
          ? vt.voiceTranscribing
          : isHeyGemDictationActive
            ? wc.textVoiceInputStopButton
            : wc.textVoiceInputTitle
      }
    >
      <VoiceMicGlyph
        busy={heyGemMicVoiceBusy}
        active={heyGemDictationStatus === 'listening'}
        level={heyGemDictationInputLevel}
      />
    </button>
  );

  /** 图+音频同时接入时：MSR 图像+声音 / 对口型 / Seedance Mini / H3 多参 */
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
  const isRhartVideoXModel = model === 'rhart-video-x';
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
  const isMinimaxH3T2vModel = model === 'minimax-h3-t2v';
  const isMinimaxH3I2vModel = model === 'minimax-h3-i2v';
  const isMinimaxH3MultiModel = model === 'minimax-h3-multi';
  const isMinimaxH3AudioModel = model === 'minimax-h3-audio';
  /** 文生/图生/多参有时长下拉；口型同步不展示计费档 UI（后台仍按参考音映射） */
  const isMinimaxH3DurationModel =
    isMinimaxH3T2vModel || isMinimaxH3I2vModel || isMinimaxH3MultiModel;
  const isMinimaxH3Model = isMinimaxH3DurationModel || isMinimaxH3AudioModel;

  const OPTIMIZE_CHAT_MODEL_OPTIONS = useMemo(
    () =>
      LLM_CHAT_MODEL_IDS.map((m) => ({
        value: m,
        label: LLM_CHAT_MODEL_LABELS[m] || m,
      })),
    [],
  );
  const resolvedOptimizeChatModel = useMemo(() => {
    const raw = String(optimizePromptChatModel || '').trim();
    if ((LLM_CHAT_MODEL_IDS as readonly string[]).includes(raw)) return raw;
    if (raw === 'gpt-4o') return 'gpt-4o';
    return LLM_CHAT_DISPLAY_MODEL_ID;
  }, [optimizePromptChatModel]);

  const [optimizePromptBusy, setOptimizePromptBusy] = useState(false);
  const [showOriginalPromptModal, setShowOriginalPromptModal] = useState(false);
  const optimizePromptCancelRef = useRef(false);
  const optimizeChatResolverRef = useRef<{
    resolve: (text: string) => void;
    reject: (err: Error) => void;
  } | null>(null);
  const savedOriginalPrompt = String(promptBeforeOptimize || '').trim();
  const hasSavedOriginalPrompt = !!savedOriginalPrompt;

  const { execute: executeOptimizeChat, cancel: cancelOptimizeChat } = useAI({
    nodeId: `${nodeId}__minimax_h3_optimize_prompt`,
    modelId: 'chat',
    onComplete: (payload) => {
      const text = coerceAssistantText(
        payload?.text ?? payload?.content ?? payload?.result ?? '',
      );
      const resolver = optimizeChatResolverRef.current;
      optimizeChatResolverRef.current = null;
      if (!resolver) return;
      if (payload?.error && !text) {
        resolver.reject(new Error(String(payload.error)));
        return;
      }
      resolver.resolve(text);
    },
    onError: (msg) => {
      const resolver = optimizeChatResolverRef.current;
      optimizeChatResolverRef.current = null;
      if (resolver) resolver.reject(new Error(msg || vt.optimizePromptFailed));
    },
  });

  const runOptimizeChat = useCallback(
    async (systemPrompt: string, userPrompt: string, chatModel: string) => {
      return new Promise<string>((resolve, reject) => {
        optimizeChatResolverRef.current = { resolve, reject };
        void executeOptimizeChat({
          model: chatModel || LLM_CHAT_DISPLAY_MODEL_ID,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt },
          ],
          stream: false,
          projectId: projectId || undefined,
          nodeTitle: 'MiniMax-H3优化提示词',
          max_tokens: 8192,
          temperature: 0.35,
        }).catch((e) => {
          optimizeChatResolverRef.current = null;
          reject(e instanceof Error ? e : new Error(String(e)));
        });
      });
    },
    [executeOptimizeChat, projectId],
  );

  const handleCancelOptimizePrompt = useCallback(() => {
    optimizePromptCancelRef.current = true;
    const resolver = optimizeChatResolverRef.current;
    optimizeChatResolverRef.current = null;
    if (resolver) resolver.reject(new Error('__optimize_cancelled__'));
    cancelOptimizeChat();
    setOptimizePromptBusy(false);
  }, [cancelOptimizeChat]);

  /** 点一下才跑 LLM：成功后写回输入框，并保存优化前原文 */
  const handleOptimizePrompt = useCallback(async () => {
    if (!isMinimaxH3Model || optimizePromptBusy) return;
    const current =
      (promptInputRef.current?.getPlainText() ?? localPromptRef.current ?? localPrompt ?? '').trim();
    if (!current) {
      showAlert(vt.optimizePromptNeedText);
      return;
    }
    if (!window.electronAPI?.getMinimaxH3PromptGuide) {
      showAlert(vt.optimizePromptGuideMissing);
      return;
    }

    const structure = resolveMinimaxH3OptimizeStructure(model);
    const imageCount = Array.isArray(orderedInputImages) ? orderedInputImages.length : 0;
    const hasRefAudio = !!(inputAudioUrl || '').trim();
    const durationSec = Number(durationMinimaxH3) || undefined;

    optimizePromptCancelRef.current = false;
    setOptimizePromptBusy(true);
    try {
      const guideRes = await window.electronAPI.getMinimaxH3PromptGuide(structure);
      if (optimizePromptCancelRef.current) return;
      if (!guideRes?.ok) {
        throw new Error(
          (guideRes as { error?: string })?.error || vt.optimizePromptGuideMissing,
        );
      }

      const { systemPrompt, userPrompt } = buildMinimaxH3OptimizeMessages({
        structure,
        skillMd: guideRes.skillMd,
        guideText: guideRes.guide,
        prompt: current,
        imageCount,
        hasRefAudio,
        durationSec,
        baseSubMode: resolveMinimaxH3BaseSubMode(model, imageCount),
        modelId: model,
      });

      const raw = await runOptimizeChat(systemPrompt, userPrompt, resolvedOptimizeChatModel);
      if (optimizePromptCancelRef.current) return;

      let next = parseMinimaxH3OptimizedPrompt(raw, structure);
      if (!isAcceptableMinimaxH3OptimizedPrompt(next)) {
        const alt = structure === 'ref' ? 'base' : 'ref';
        next = parseMinimaxH3OptimizedPrompt(raw, alt);
      }
      next = recoverMinimaxH3OptimizedPrompt(next);
      if (!isAcceptableMinimaxH3OptimizedPrompt(next)) {
        throw new Error(vt.optimizePromptEmptyResult);
      }

      if (promptDebounceRef.current) {
        clearTimeout(promptDebounceRef.current);
        promptDebounceRef.current = null;
      }
      // 原子写回：优化稿 → prompt，优化前稿 → promptBeforeOptimize（供「原文」弹层恢复）
      if (onMinimaxH3OptimizeApply) {
        onMinimaxH3OptimizeApply({
          nodeId,
          prompt: next,
          promptBeforeOptimize: current,
        });
      } else {
        onPromptBeforeOptimizeChange?.(current, nodeId);
        onPromptChange(next, nodeId);
      }
      promptInputRef.current?.setPlainText(next);
      setLocalPrompt(next);
      lastSentPromptRef.current = next;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e || '');
      if (optimizePromptCancelRef.current || msg === '__optimize_cancelled__') return;
      showAlert(msg || vt.optimizePromptFailed);
    } finally {
      if (!optimizePromptCancelRef.current) setOptimizePromptBusy(false);
    }
  }, [
    durationMinimaxH3,
    inputAudioUrl,
    isMinimaxH3Model,
    localPrompt,
    model,
    nodeId,
    onMinimaxH3OptimizeApply,
    onPromptBeforeOptimizeChange,
    onPromptChange,
    optimizePromptBusy,
    orderedInputImages,
    resolvedOptimizeChatModel,
    runOptimizeChat,
    showAlert,
    vt.optimizePromptEmptyResult,
    vt.optimizePromptFailed,
    vt.optimizePromptGuideMissing,
    vt.optimizePromptNeedText,
  ]);

  const handleRestoreOriginalPrompt = useCallback(() => {
    if (!hasSavedOriginalPrompt) return;
    if (promptDebounceRef.current) {
      clearTimeout(promptDebounceRef.current);
      promptDebounceRef.current = null;
    }
    promptInputRef.current?.setPlainText(savedOriginalPrompt);
    setLocalPrompt(savedOriginalPrompt);
    lastSentPromptRef.current = savedOriginalPrompt;
    onPromptChange(savedOriginalPrompt, nodeId);
    setShowOriginalPromptModal(false);
  }, [hasSavedOriginalPrompt, nodeId, onPromptChange, savedOriginalPrompt]);

  useEffect(() => {
    if (!isMinimaxH3Model) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || !e.shiftKey) return;
      if (e.key !== 'H' && e.key !== 'h') return;
      e.preventDefault();
      e.stopPropagation();
      if (optimizePromptBusy) return;
      void handleOptimizePrompt();
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [handleOptimizePrompt, isMinimaxH3Model, optimizePromptBusy]);

  const renderH3OptimizePromptControls = () => {
    if (!isMinimaxH3Model) return null;
    return (
      <>
        <div className="flex items-center gap-1.5 shrink-0 nodrag nopan">
          <div
            className="nodrag nopan shrink-0"
            title={vt.optimizePromptChatModelHint}
            onMouseDown={(e) => e.stopPropagation()}
            onPointerDown={(e) => e.stopPropagation()}
          >
            <PanelOptionDropdown
              value={resolvedOptimizeChatModel}
              options={OPTIMIZE_CHAT_MODEL_OPTIONS}
              onChange={(v) => onOptimizePromptChatModelChange?.(v, nodeId)}
              isDarkMode={isDarkMode}
              title={vt.optimizePromptChatModelHint}
              minWidthPx={118}
              menuPlacement="up"
              className={
                optimizePromptBusy
                  ? 'opacity-50 pointer-events-none'
                  : isDarkMode
                    ? '!h-6 !text-[10px] !bg-white/10 !text-white/85 !border-white/20'
                    : '!h-6 !text-[10px] !bg-white !text-gray-700 !border-gray-300'
              }
            />
          </div>
          {optimizePromptBusy ? (
            <button
              type="button"
              onClick={handleCancelOptimizePrompt}
              className={`h-6 px-1.5 rounded text-[10px] font-medium border ${
                isDarkMode
                  ? 'border-white/20 text-white/70 hover:bg-white/10'
                  : 'border-gray-300 text-gray-600 hover:bg-gray-100'
              }`}
            >
              {vt.optimizePromptCancel}
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => void handleOptimizePrompt()}
            disabled={optimizePromptBusy}
            title={`${vt.optimizePromptButton}（${vt.optimizePromptShortcutHint}）`}
            className={`inline-flex items-center gap-1 h-6 px-2 rounded text-[10px] font-medium border transition-colors ${
              optimizePromptBusy
                ? isDarkMode
                  ? 'bg-white/10 text-white/40 border-white/10 cursor-not-allowed'
                  : 'bg-gray-100 text-gray-400 border-gray-200 cursor-not-allowed'
                : isDarkMode
                  ? 'bg-emerald-500/20 text-emerald-200 border-emerald-400/30 hover:bg-emerald-500/30'
                  : 'bg-emerald-50 text-emerald-800 border-emerald-200 hover:bg-emerald-100'
            }`}
          >
            {optimizePromptBusy ? (
              <>
                <Loader2 className="w-3 h-3 animate-spin" />
                {vt.optimizePromptBusy}
              </>
            ) : (
              vt.optimizePromptButton
            )}
          </button>
          <button
            type="button"
            onClick={() => setShowOriginalPromptModal(true)}
            disabled={!hasSavedOriginalPrompt || optimizePromptBusy}
            title={
              hasSavedOriginalPrompt
                ? vt.optimizePromptOriginalTitle
                : vt.optimizePromptOriginalEmpty
            }
            className={`inline-flex items-center gap-1 h-6 px-2 rounded text-[10px] font-medium border transition-colors ${
              !hasSavedOriginalPrompt || optimizePromptBusy
                ? isDarkMode
                  ? 'bg-white/5 text-white/30 border-white/10 cursor-not-allowed'
                  : 'bg-gray-50 text-gray-400 border-gray-200 cursor-not-allowed'
                : isDarkMode
                  ? 'bg-white/10 text-white/80 border-white/20 hover:bg-white/15'
                  : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'
            }`}
          >
            {vt.optimizePromptOriginalButton}
          </button>
        </div>
        <DarkModalFrame
          open={showOriginalPromptModal}
          onBackdropClick={() => setShowOriginalPromptModal(false)}
          panelClassName={`${darkModalPanelMdClass} max-w-lg`}
          brandLabel={vt.optimizePromptOriginalTitle}
          footer={
            <div className={`${darkModalFooterClass} gap-2 !justify-end border-t border-white/10 pt-3`}>
              <button
                type="button"
                onClick={() => setShowOriginalPromptModal(false)}
                className={darkModalBtnCancelClass}
              >
                {vt.optimizePromptOriginalClose}
              </button>
              <button
                type="button"
                onClick={handleRestoreOriginalPrompt}
                disabled={!hasSavedOriginalPrompt}
                className={`${darkModalBtnOkClass} disabled:opacity-40 disabled:cursor-not-allowed`}
              >
                {vt.optimizePromptOriginalRestore}
              </button>
            </div>
          }
        >
          <div className="px-5 py-4 max-h-[min(50vh,360px)] overflow-y-auto">
            {hasSavedOriginalPrompt ? (
              <pre className="whitespace-pre-wrap break-words text-sm text-white/90 font-sans leading-relaxed m-0">
                {savedOriginalPrompt}
              </pre>
            ) : (
              <p className="text-sm text-white/55 m-0">{vt.optimizePromptOriginalEmpty}</p>
            )}
          </div>
        </DarkModalFrame>
      </>
    );
  };

  const isLtx23HdrMultiModel = model === 'ltx-2.3-hdr-multi';
  const isLtx23MsrAv = isLtx23MsrAvModel(model);
  /** MSR 分镜面板：无音频版 / 图像+声音版共用槽位 UI */
  const isLtx23MsrStoryboardUi = isLtx23HdrMultiModel || isLtx23MsrAv;
  const isWanAnimateModel = model === 'wan-animate';
  const isWanAnimate2Model = model === 'wan-animate-2';
  const isWanAnimateFamily = isWanAnimateModel || isWanAnimate2Model;
  /** Wan animate2：原视频探测时长（秒），用于价签 Quantity */
  const [wanAnimate2MediaDurationSec, setWanAnimate2MediaDurationSec] = useState(0);
  const isRhartVideoUpscaler = model === 'rhart-video-upscaler';
  const isHeyGemModel = model === 'hey-gem' || heyGemStandalone;
  /** 独立 HeyGem / WanAnimate 模块：提交时强制模型 id，避免误走文生视频链路 */
  const effectiveVideoModel = (
    heyGemStandalone ? 'hey-gem' : wanAnimateStandalone ? 'wan-animate' : model
  ) as VideoInputPanelProps['model'];

  const heyGemRefVideoReady = !!(referenceVideoUrl || '').trim();
  const heyGemDriveAudioReady = !!(inputAudioUrl || '').trim();
  const heyGemEffectiveTtsModel =
    (heyGemTtsModel || DOUBAO_SEED_AUDIO_MODEL_ID).trim() || DOUBAO_SEED_AUDIO_MODEL_ID;

  const applyHeyGemReferenceVideo = useCallback(
    (url: string) => {
      onReferenceVideoUrlChange?.(String(url || '').trim());
    },
    [onReferenceVideoUrlChange],
  );

  const handleHeyGemUploadVideo = useCallback(async () => {
    if (!window.electronAPI?.showOpenVideoDialog) {
      showAlert(vt.heyGemNeedRefVideo);
      return;
    }
    const res = await window.electronAPI.showOpenVideoDialog();
    if (!res.success || !res.filePath) return;
    applyHeyGemReferenceVideo(pathToLocalResourceUrl(res.filePath));
  }, [applyHeyGemReferenceVideo, showAlert, vt.heyGemNeedRefVideo]);

  const handleHeyGemPickFromCanvas = useCallback(async () => {
    if (!onPickReferenceVideoFromCanvas) return;
    const url = await onPickReferenceVideoFromCanvas();
    if (url) applyHeyGemReferenceVideo(url);
  }, [applyHeyGemReferenceVideo, onPickReferenceVideoFromCanvas]);

  const handleHeyGemOpenLibrary = useCallback(async () => {
    openAssetLibrary('digitalHuman');
    const picked = await beginDigitalHumanLibraryPick();
    if (!picked?.videoUrl) return;
    applyHeyGemReferenceVideo(picked.videoUrl);
    if (picked.audioUrl) onInputAudioUrlChange?.(picked.audioUrl);
  }, [applyHeyGemReferenceVideo, onInputAudioUrlChange]);

  const handleHeyGemUploadDriveAudio = useCallback(async () => {
    if (!window.electronAPI?.showOpenAudioDialog) return;
    const res = await window.electronAPI.showOpenAudioDialog();
    if (!res.success || !res.filePath) return;
    onInputAudioUrlChange?.(pathToLocalResourceUrl(res.filePath));
  }, [onInputAudioUrlChange]);

  const { execute: executeHeyGemTts } = useAI({
    nodeId: `${nodeId}__heygem_tts`,
    modelId: 'audio',
    onComplete: (result) => {
      setHeyGemTtsBusy(false);
      let audioUrl = (result?.audioUrl || result?.url || '').trim();
      const localPath = (result?.localPath || '').trim();
      if (localPath && !audioUrl.startsWith('http')) {
        audioUrl = pathToLocalResourceUrl(localPath);
      } else if (localPath && !audioUrl) {
        audioUrl = pathToLocalResourceUrl(localPath);
      }
      if (!audioUrl) {
        heyGemTtsWaiterRef.current?.reject(new Error(vt.heyGemDubFailed));
        heyGemTtsWaiterRef.current = null;
        showAlert(vt.heyGemDubFailed);
        return;
      }
      onInputAudioUrlChange?.(audioUrl);
      heyGemTtsWaiterRef.current?.resolve(audioUrl);
      heyGemTtsWaiterRef.current = null;
    },
    onError: (error) => {
      setHeyGemTtsBusy(false);
      const msg = error || vt.heyGemDubFailed;
      heyGemTtsWaiterRef.current?.reject(new Error(msg));
      heyGemTtsWaiterRef.current = null;
      showAlert(msg);
    },
  });

  const runHeyGemTts = useCallback(async (): Promise<string> => {
    const script = localHeyGemScript.trim();
    if (!script) {
      showAlert(vt.heyGemNeedScript);
      throw new Error(vt.heyGemNeedScript);
    }
    if (!heyGemRefVideoReady && !String(heyGemCloneAudioUrl || '').trim()) {
      // Index-TTS 必须有参考音；无视频也无克隆音时无法配音
      if (heyGemEffectiveTtsModel === 'index-tts2') {
        showAlert(vt.heyGemNeedCloneAudio);
        throw new Error(vt.heyGemNeedCloneAudio);
      }
    }
    onHeyGemScriptChange?.(script);
    setHeyGemTtsBusy(true);
    try {
      let refUrl = String(heyGemCloneAudioUrl || '').trim();
      if (!refUrl && heyGemRefVideoReady && window.electronAPI?.extractAudioFromVideo) {
        try {
          const extracted = await window.electronAPI.extractAudioFromVideo(
            projectId || undefined,
            String(referenceVideoUrl || '').trim(),
          );
          refUrl = String(extracted?.audioUrl || '').trim();
          if (refUrl) onHeyGemCloneAudioUrlChange?.(refUrl);
        } catch (e) {
          console.warn('[VideoInputPanel] HeyGem 从参考视频抽音失败', e);
        }
      }
      if (heyGemEffectiveTtsModel === 'index-tts2' && !refUrl) {
        setHeyGemTtsBusy(false);
        showAlert(vt.heyGemNeedCloneAudio);
        throw new Error(vt.heyGemNeedCloneAudio);
      }
      const requestParams: Record<string, unknown> = {
        model: heyGemEffectiveTtsModel,
        text: script,
        enable_base64_output: false,
        english_normalization: false,
      };
      if (refUrl) {
        let normalized = refUrl;
        if (normalized.startsWith('local-resource://') || normalized.startsWith('file://')) {
          normalized = normalized
            .replace(/%5C/gi, '/')
            .replace(/^local-resource:\/\/+/, 'local-resource://')
            .replace(/^file:\/\/+/, 'file://');
        }
        requestParams.referenceAudioUrl = normalized;
      }
      if (isDoubaoSeedAudioModel(heyGemEffectiveTtsModel)) {
        requestParams.model = DOUBAO_SEED_AUDIO_MODEL_ID;
        requestParams.speechRate = 0;
        requestParams.loudnessRate = 0;
        requestParams.pitch = 0;
        requestParams.doubaoFormat = 'mp3';
        requestParams.doubaoSampleRate = '24000';
      }
      if (projectId) requestParams.projectId = projectId;

      return await new Promise<string>((resolve, reject) => {
        heyGemTtsWaiterRef.current = { resolve, reject };
        void executeHeyGemTts(requestParams).catch((e) => {
          setHeyGemTtsBusy(false);
          const err = e instanceof Error ? e : new Error(String(e));
          heyGemTtsWaiterRef.current?.reject(err);
          heyGemTtsWaiterRef.current = null;
          showAlert(err.message || vt.heyGemDubFailed);
        });
      });
    } catch (e) {
      setHeyGemTtsBusy(false);
      console.error('[VideoInputPanel] HeyGem 一键配音失败', e);
      // 校验失败 / onError 已弹窗，此处只保证 Promise 失败并重置 busy
      throw e instanceof Error ? e : new Error(vt.heyGemDubFailed);
    }
  }, [
    localHeyGemScript,
    heyGemRefVideoReady,
    heyGemCloneAudioUrl,
    heyGemEffectiveTtsModel,
    onHeyGemScriptChange,
    onHeyGemCloneAudioUrlChange,
    referenceVideoUrl,
    projectId,
    executeHeyGemTts,
    showAlert,
    vt.heyGemNeedScript,
    vt.heyGemNeedCloneAudio,
    vt.heyGemDubFailed,
  ]);

  const handleHeyGemOneClickDub = useCallback(async () => {
    try {
      await runHeyGemTts();
    } catch {
      /* alerts already shown */
    }
  }, [runHeyGemTts]);

  const isSeedanceFastModel = model === 'seedance-2.0-fast';
  const isSeedanceMiniModel = model === 'seedance-2.0-mini';
  const isSeedanceModel = isSeedanceFastModel || isSeedanceMiniModel;
  const isGeminiOmniModel = model === 'gemini-omni';
  const isGeminiOmniFlashModel = model === 'gemini-omni-flash';
  const isGeminiOmniFamily = isGeminiOmniModel || isGeminiOmniFlashModel;

  const applyMentionToPrompt = useCallback(
    (next: string) => {
      setLocalPrompt(next);
      lastSentPromptRef.current = next;
      onPromptChange(next, nodeId);
    },
    [onPromptChange, nodeId],
  );

  /** 已连接音频入边列表；无连线但有 inputAudioUrl（如导演裁剪）时回退为 1 条 */
  const resolvedConnectedAudios = useMemo((): VideoConnectedAudioInfo[] => {
    if (Array.isArray(connectedAudios) && connectedAudios.length > 0) {
      return connectedAudios;
    }
    const aud = String(inputAudioUrl || '').trim();
    if (!aud) return [];
    return [{ nodeId: '', name: basenameFromAudioUrl(aud) || 'audio', url: aud }];
  }, [connectedAudios, inputAudioUrl]);

  const orderedInputAudios = useMemo(
    () =>
      resolvedConnectedAudios.map((a) => ({
        url: String(a.url || '').trim() || undefined,
        nodeId: String(a.nodeId || '').trim() || undefined,
        name: String(a.name || '').trim() || undefined,
      })),
    [resolvedConnectedAudios],
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
    orderedInputAudios,
    locale,
    preferSeedanceTag: isSeedanceModel,
    onApply: applyMentionToPrompt,
  });

  const seedanceMentionIndices = useMemo(() => {
    if (!isSeedanceModel) return [] as number[];
    return extractSeedanceImageMentionIndices(localPrompt);
  }, [isSeedanceModel, localPrompt]);

  const renderSeedanceMentionThumbs = () => {
    if (!isSeedanceModel || seedanceMentionIndices.length === 0) return null;
    return (
      <div className="mb-1 flex flex-wrap items-center gap-1.5 min-w-0">
        {seedanceMentionIndices.map((n) => {
          const url = String(orderedInputImages[n - 1] || '').trim();
          const label = vt.appendSeedanceImageTag(n);
          return (
            <span
              key={`mention-${n}`}
              className={`inline-flex items-center gap-1 max-w-[160px] rounded-md border pl-0.5 pr-1.5 py-0.5 text-[11px] font-semibold ${
                isDarkMode
                  ? url
                    ? 'bg-sky-500/20 border-sky-400/40 text-sky-100'
                    : 'bg-amber-500/15 border-amber-400/35 text-amber-100'
                  : url
                    ? 'bg-sky-50 border-sky-200 text-sky-800'
                    : 'bg-amber-50 border-amber-200 text-amber-800'
              }`}
              title={url ? label : `${label}（无对应参考图）`}
            >
              {url ? (
                <img
                  src={url}
                  alt={label}
                  className="w-6 h-6 rounded object-cover shrink-0 bg-black/20"
                  draggable={false}
                />
              ) : (
                <span
                  className={`w-6 h-6 rounded shrink-0 flex items-center justify-center text-[9px] ${
                    isDarkMode ? 'bg-white/10' : 'bg-black/5'
                  }`}
                >
                  ?
                </span>
              )}
              <span className="truncate">{label}</span>
            </span>
          );
        })}
      </div>
    );
  };

  const renderPromptRichField = (opts: { className: string; placeholder: string }) => (
    <div className={`relative min-w-0 ${opts.className}`}>
      <PromptRichInput
        ref={promptInputRef}
        value={localPrompt}
        candidates={mentionCandidates}
        readOnly={micInputLocked || optimizePromptBusy}
        disabled={micInputLocked || optimizePromptBusy}
        isDarkMode={isDarkMode}
        placeholder={opts.placeholder}
        onFocus={() => {
          if (micInputLocked || optimizePromptBusy) return;
          promptInputFocusedRef.current = true;
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
            onPromptChange(v, nodeId);
          }
        }}
        onKeyDown={onMentionKeyDown}
        onSubmit={() => {
          if (micInputLocked || optimizePromptBusy || isRunDisabled) return;
          void handleExecute();
        }}
        onInputCheck={onMentionInputCheck}
        onChange={(v) => {
          if (micInputLocked || optimizePromptBusy) return;
          setLocalPrompt(v);
          const sourceId = nodeId;
          if (promptDebounceRef.current) clearTimeout(promptDebounceRef.current);
          promptDebounceRef.current = setTimeout(() => {
            promptDebounceRef.current = null;
            lastSentPromptRef.current = v;
            onPromptChange(v, sourceId);
          }, 250);
        }}
        onRefPillHover={(match) => {
          setHoveredRefFromPillIndex(resolveRefPillToOrderedIndex(match, latestOrderedImagesRef.current));
        }}
        className={`w-full h-full resize-none bg-transparent px-0 py-1 pr-9 pt-8 [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden ${
          micInputLocked || optimizePromptBusy ? 'opacity-45 cursor-not-allowed' : ''
        }`}
      />
      <div className="absolute top-0.5 right-0 z-10 pointer-events-auto flex items-center gap-1.5">
        {renderH3OptimizePromptControls()}
        {promptVoiceMicButton}
      </div>
      <AtMentionMenu {...mentionMenuProps} />
    </div>
  );

  /** LTX2.3 高动态已下架 1920，旧节点数据归一为 1280 */
  useEffect(() => {
    if (model !== 'ltx-2.3-hdr-multi') return;
    const r = String(resolutionLtx23HdrMulti ?? '');
    if (r === '1920' || r === '1080') {
      onResolutionLtx23HdrMultiChange?.('1280');
    }
  }, [model, resolutionLtx23HdrMulti, onResolutionLtx23HdrMultiChange]);

  /** LTX2.3 首位帧：归一为 720p|1080p|1920p（最高 1920p，非 4K） */
  useEffect(() => {
    if (model !== 'rh-video-start-end') return;
    const r = String(resolutionRhartV31 || '').trim().toLowerCase();
    if (r === '720') onResolutionRhartV31Change?.('720p');
    else if (r === '1280' || r === '1080') onResolutionRhartV31Change?.('1080p');
    else if (r === '1920' || r === '4k' || r === '2160p') onResolutionRhartV31Change?.('1920p');
  }, [model, resolutionRhartV31, onResolutionRhartV31Change]);

  /** 旧节点仍可能为 sora-2：面板打开后归一到替代模型并写回（与 onModelChange 一致） */
  useEffect(() => {
    if (!HIDE_SORA2_AND_SORA_CHARACTER_UI) return;
    if (model === 'sora-2' || model === 'sora-2-pro') {
      onModelChange(DEFAULT_VIDEO_MODEL_REPLACING_SORA2);
    }
  }, [model, onModelChange]);

  /** 旧 rhart-video-g 迁移到全能视频X */
  useEffect(() => {
    if (model === 'rhart-video-g') {
      onModelChange('rhart-video-x');
      onDurationGrok3Change?.('10');
      onResolutionGrok3Change?.('720p');
      onAspectRatioChange('16:9');
    }
  }, [model, onModelChange, onDurationGrok3Change, onResolutionGrok3Change, onAspectRatioChange]);

  /** 可灵 / 万相 / 海螺 / Grok video3 / Gemini Omni 等已从前端下架，迁移到默认视频模型 */
  useEffect(() => {
    if (!isRetiredVideoModel(model)) return;
    const next = normalizeVideoModelIfRetired(model);
    onModelChange(next as Parameters<typeof onModelChange>[0]);
    if (next === 'rhart-video-x' || next === 'grok-3-stable') {
      onDurationGrok3Change?.('10');
      onResolutionGrok3Change?.('720p');
    }
  }, [model, onModelChange, onDurationGrok3Change, onResolutionGrok3Change]);

  useEffect(() => {
    if (model !== 'rhart-video-x') return;
    const normalized = normalizeGrok3Resolution(resolutionGrok3);
    if (resolutionGrok3 !== normalized) onResolutionGrok3Change?.(normalized);
  }, [model, resolutionGrok3, onResolutionGrok3Change]);

  useEffect(() => {
    if (model !== 'rhart-video-x') return;
    const normalized = normalizeRhartVideoXDurationStr(durationGrok3, '10');
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
    if (!isLtx23MsrStoryboardUi) return;
    // 拖拽互换过程中勿用可能尚未合并完的 props 回写本地，否则缩略图会「拖完看起来没换」
    if (isDraggingThumb) return;
    const bg = String(ltx23HdrBackgroundImage || '').trim();
    const nextStoryboard = normalizeLtx23HdrStoryboardSlots(inputImages || []);
    const currentStoryboard = normalizeLtx23HdrStoryboardSlots(storyboardImagesRef.current);
    if (hdrBackgroundRef.current !== bg) setHdrBackground(bg);
    if (JSON.stringify(nextStoryboard) !== JSON.stringify(currentStoryboard)) {
      setStoryboardImages(nextStoryboard);
    }
  }, [isLtx23MsrStoryboardUi, ltx23HdrBackgroundImage, inputImages, isDraggingThumb]);

  useEffect(() => {
    if (!isDraggingThumb) return;
    document.body.style.cursor = 'grabbing';
    return () => {
      document.body.style.cursor = '';
    };
  }, [isDraggingThumb]);

  const commitStoryboardSlots = useCallback(
    (next: string[]) => {
      const normalized = normalizeLtx23HdrStoryboardSlots(next, hdrBackgroundRef.current);
      storyboardImagesRef.current = normalized;
      setStoryboardImages(normalized);
      onInputImagesOrderChange?.(normalized);
    },
    [onInputImagesOrderChange],
  );

  const commitHdrFlatSlots = useCallback(
    (flat: string[]) => {
      const { background, storyboard } = unflattenLtx23HdrSlots(flat);
      hdrBackgroundRef.current = background;
      storyboardImagesRef.current = storyboard;
      setHdrBackground(background);
      onLtx23HdrBackgroundImageChange?.(background);
      commitStoryboardSlots(storyboard);
    },
    [onLtx23HdrBackgroundImageChange, commitStoryboardSlots],
  );

  const swapHdrFlatSlot = useCallback(
    (fromIndex: number, toIndex: number) => {
      if (fromIndex === toIndex) return;
      const flat = flattenLtx23HdrSlots(hdrBackgroundRef.current, storyboardImagesRef.current);
      if (!flat[fromIndex]?.trim() && !flat[toIndex]?.trim()) return;
      commitHdrFlatSlots(swapLtx23HdrFlatSlots(flat, fromIndex, toIndex));
      thumbDragDidReorderRef.current = true;
    },
    [commitHdrFlatSlots],
  );

  const assignHdrBackground = useCallback(
    (url: string) => {
      const trimmed = String(url || '').trim();
      if (!trimmed) return;
      const flat = flattenLtx23HdrSlots(hdrBackgroundRef.current, storyboardImagesRef.current);
      const fromIdx = flat.findIndex((u) => u === trimmed);
      if (fromIdx === 0) return;
      if (fromIdx > 0) {
        commitHdrFlatSlots(swapLtx23HdrFlatSlots(flat, fromIdx, 0));
        return;
      }
      flat[0] = trimmed;
      commitHdrFlatSlots(flat);
    },
    [commitHdrFlatSlots],
  );

  /** 将背景图移回分镜区（点击背景缩略图或拖到分镜区） */
  const demoteBackgroundToStoryboard = useCallback(
    (insertIndex?: number) => {
      const flat = flattenLtx23HdrSlots(hdrBackgroundRef.current, storyboardImagesRef.current);
      const bg = flat[0]?.trim();
      if (!bg) return;
      flat[0] = '';
      const targetIdx =
        typeof insertIndex === 'number'
          ? Math.max(1, Math.min(insertIndex + 1, LTX23_HDR_MAX_STORYBOARD))
          : flat.findIndex((s, i) => i > 0 && !s);
      const idx = targetIdx > 0 ? targetIdx : 1;
      flat[idx] = bg;
      commitHdrFlatSlots(flat);
    },
    [commitHdrFlatSlots],
  );

  const handleHdrDropOnBackground = useCallback(() => {
    const src = hdrDragSourceRef.current;
    if (src == null || src === 'background') return;
    if (typeof src === 'number') {
      swapHdrFlatSlot(src + 1, 0);
      hdrDragSourceRef.current = 'background';
    }
  }, [swapHdrFlatSlot]);

  const handleHdrDropOnStoryboard = useCallback(
    (targetIndex: number) => {
      const src = hdrDragSourceRef.current;
      if (src === 'background') {
        swapHdrFlatSlot(0, targetIndex + 1);
        hdrDragSourceRef.current = targetIndex;
        return;
      }
      if (typeof src === 'number' && src !== targetIndex) {
        swapHdrFlatSlot(src + 1, targetIndex + 1);
        hdrDragSourceRef.current = targetIndex;
      }
    },
    [swapHdrFlatSlot],
  );

  const storyboardSlots = useMemo(
    () => normalizeLtx23HdrStoryboardSlots(storyboardImages, hdrBackground),
    [storyboardImages, hdrBackground],
  );

  const clearSelectedHdrSlot = useCallback(() => {
    if (selectedHdrSlotIndex == null) return;
    const flat = flattenLtx23HdrSlots(hdrBackgroundRef.current, storyboardImagesRef.current);
    const url = String(flat[selectedHdrSlotIndex] || '').trim();
    if (!url) {
      setSelectedHdrSlotIndex(null);
      return;
    }
    flat[selectedHdrSlotIndex] = '';
    commitHdrFlatSlots(flat);
    onDisconnectHdrSlotImage?.(url);
    setSelectedHdrSlotIndex(null);
  }, [selectedHdrSlotIndex, commitHdrFlatSlots, onDisconnectHdrSlotImage]);

  useEffect(() => {
    if (!isLtx23MsrStoryboardUi) {
      setSelectedHdrSlotIndex(null);
      return;
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Delete' && e.key !== 'Backspace') return;
      const el = e.target as HTMLElement | null;
      if (el) {
        const tag = el.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable) return;
      }
      if (selectedHdrSlotIndex == null) return;
      e.preventDefault();
      e.stopPropagation();
      clearSelectedHdrSlot();
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [isLtx23MsrStoryboardUi, selectedHdrSlotIndex, clearSelectedHdrSlot]);

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
    : isLtx23MsrStoryboardUi
      ? isLtx23HdrMultiRunnable(hdrBackground, storyboardSlots)
      : orderedInputImages.length > 0;

  /** 是否接了参考视频（WanAnimate / 视频超分等；全能参考不再使用） */
  const hasVideoRef = !!(referenceVideoUrl || '').trim();
  /** 是否接了参考音 */
  const hasAudioRef =
    !!(inputAudioUrl || '').trim() ||
    (Array.isArray(connectedAudios) &&
      connectedAudios.some((a) => String(a?.url || '').trim()));
  /**
   * 已接参考视频且非「图+音」专用列表场景：用于 WanAnimate 等旧分流。
   * 图+音时仍走 hasImageAndAudio 列表（含全能参考）。
   */
  const hasReferenceVideo = !hasImageAndAudio && hasVideoRef;
  /** 图 + 参考视频：角色替换 */
  const hasImageAndVideo = isImageToVideoMode && hasVideoRef;
  /**
   * MiniMax H3 全能参考：始终可选（无参考=文生；有图/音则按槽位提交；不支持参考视频）。
   * 仅限制参考图不超过 9 张。
   */
  const canUseMinimaxH3Multi = orderedInputImages.length <= 9;

  // 图生视频候选模型（再按参考图数量过滤）
  const imageToVideoModelCandidates = filterActiveVideoModels([
    ...(HIDE_SORA2_AND_SORA_CHARACTER_UI ? [] : (['sora-2'] as const)),
    'ltx-2.3-lipsync',
    'ltx-2.3-i2v',
    'minimax-h3-i2v',
    'minimax-h3-multi',
    'minimax-h3-audio',
    'rhart-v3.1-pro-se',
    'rh-video-start-end',
    'rhart-video-x',
    'seedance-2.0-fast',
    'seedance-2.0-mini',
    'gemini-omni-flash',
    'wan-animate',
    'wan-animate-2',
  ] as const);

  /** 图生视频模式下，当前模型最大参考图数量（与主进程 VideoProvider 校验一致） */
  const getMaxRefImagesVideo = (m: string): number => {
    if (m === 'grok-3' || m === 'rhart-video-x' || m === 'grok-3-stable') return 7;
    if (m === 'minimax-h3-multi') return 9;
    if (m === 'minimax-h3-audio') return 5;
    if (m === 'ltx-2.3-hdr-multi' || m === LTX23_MSR_AV_MODEL_ID) return 5;
    if (m === 'seedance-2.0-fast' || m === 'seedance-2.0-mini') return 9;
    if (m === 'rhart-v3.1-fast') return 3;
    if (m === 'gemini-omni' || m === 'gemini-omni-flash') return 3;
    if (['rhart-v3.1-fast-se', 'rhart-v3.1-pro-se', 'rh-video-start-end'].includes(m)) return 2;
    if (m === 'wan-animate' || m === 'wan-animate-2') return 1;
    return 1; // sora-2, kling-v2.6-pro, wan-2.6, wan-2.6-flash, ltx-2.3-lipsync, ltx-2.3-i2v, hailuo-2.3-i2v-standard, kling-video-o1-i2v 等
  };

  /** 首尾帧：fast-se / LTX 首位帧须恰好 2 张；pro-se 首帧必填、尾帧可选（1–2）；Gemini Omni 仅 1 或 3 张 */
  const modelSupportsRefImageCount = (m: string, count: number): boolean => {
    if (count < 1) return false;
    if (m === 'rhart-v3.1-pro-se') return count === 1 || count === 2;
    if (['rhart-v3.1-fast-se', 'rh-video-start-end'].includes(m)) return count === 2;
    if (m === 'ltx-2.3-hdr-multi' || m === LTX23_MSR_AV_MODEL_ID) return count >= 3 && count <= 5;
    if (m === 'gemini-omni' || m === 'gemini-omni-flash') return count === 1 || count === 3;
    return count >= 1 && count <= getMaxRefImagesVideo(m);
  };

  const I2V_MODEL_DISPLAY_ORDER = [
    'sora-2',
    'ltx-2.3-lipsync',
    'ltx-2.3-i2v',
    'minimax-h3-i2v',
    'minimax-h3-multi',
    'minimax-h3-audio',
    'rhart-v3.1-pro-se',
    'rh-video-start-end',
    'seedance-2.0-fast',
    'seedance-2.0-mini',
    'gemini-omni-flash',
    'rhart-video-x',
    'wan-animate',
    'wan-animate-2',
  ] as const;

  const VIDEO_I2V_MODEL_LABELS: Record<string, { label: string; title?: string }> = {
    'sora-2': { label: 'Sora2' },
    'sora-2-pro': { label: 'Sora2 Pro' },
    'ltx-2.3-lipsync': { label: 'LTX2.3 对口型' },
    'ltx-2.3-i2v': { label: 'LTX2.3 图生视频' },
    'ltx-2.3-t2v': { label: 'LTX2.3 文生视频' },
    'minimax-h3-t2v': {
      label: 'MiniMax-H3 文生视频',
      title: 'MiniMax-H3 文生视频；720P；时长 6/10/15/20 秒',
    },
    'minimax-h3-i2v': {
      label: 'MiniMax-H3 图生视频',
      title: '1 张参考图；720P；时长 6/10/15/20 秒',
    },
    'minimax-h3-multi': {
      label: 'MiniMax H3 全能参考',
      title:
        '无参考可文生；最多 9 张参考图 + 最多 3 路参考音；720P；时长 6/10/15/20 秒',
    },
    'minimax-h3-audio': {
      label: vt.modelMinimaxH3Audio,
      title: vt.modelMinimaxH3AudioTitle,
    },
    'ltx-2.3-hdr-multi': { label: 'LTX2.3 MSR（已下架）' },
    'ltx-2.3-msr-av': {
      label: LTX23_MSR_AV_LABEL + '（已下架）',
    },
    'rhart-v3.1-pro-se': {
      label: '全能视频V3.1-pro-首尾帧生视频',
      title: '首尾帧；海外站；首帧必填、尾帧可选；时长仅 8s；比例 16:9/9:16；分辨率 720p/1080p/4k',
    },
    'rh-video-start-end': { label: 'LTX2.3（首位帧）' },
    'seedance-2.0-fast': { label: 'Seedance 2.0 Fast', title: '支持 0–9 张参考图' },
    'seedance-2.0-mini': { label: 'Seedance 2.0 Mini', title: '支持参考图/视频/音频，0–9 张参考图' },
    'gemini-omni-flash': {
      label: '全能视频 Omni Flash',
      title: '图生视频：1 或 3 张参考图（不支持 2 张）；时长 6/8/10；720p/1080p/4k',
    },
    'rhart-video-x': {
      label: '全能视频X',
      title: '文生/图生；海外站；720p；时长 6/8/10/15/30；图生最多 7 张',
    },
    'grok-3-stable': { label: 'Grok video3 plus', title: '参考图生 1–7 张，仅 720p，时长 6s/10s' },
    'wan-animate': { label: 'WanAnimate（角色替换）', title: '角色替换：参考图 + 参考视频' },
    'wan-animate-2': { label: 'Wan animate2 视频换人', title: '视频换人：参考图 + 参考视频（提示词选填）' },
    'rhart-video-upscaler': {
      label: '视频超分放大',
      title: '输入参考视频；目标分辨率 720P / 1080P / 2K / 4K；最长 10 分钟',
    },
  };

  const maxRefImagesVideo = getMaxRefImagesVideo(model);

  useEffect(() => {
    // 海螺 02/2.3 固定单档计费，切换到该系列时重置为默认档，避免残留旧分辨率值。
    if ((isHailuo02Model || isHailuo23Model || isHailuo02I2vModel || isHailuo23I2vModel) && resolutionHailuo !== 'na') {
      onResolutionHailuoChange?.('na');
    }
  }, [isHailuo02Model, isHailuo23Model, isHailuo02I2vModel, isHailuo23I2vModel, resolutionHailuo, onResolutionHailuoChange]);

  const videoPriceLabel = useMemo(() => {
    const value = getVideoDisplayPrice(
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
        durationMinimaxH3,
        resolutionMinimaxH3,
        durationLtx23HdrMulti,
        resolutionLtx23HdrMulti,
        resolutionLtx23Lipsync,
        resolutionWanAnimate,
        wanAnimateClipSec,
        resolutionSeedance,
        durationSeedance,
        resolutionGeminiOmni,
        durationGeminiOmni,
        targetResolution,
        mediaDurationSec: isWanAnimate2Model ? wanAnimate2MediaDurationSec : undefined,
      },
      cloudMap,
    );
    return value == null ? ({ ok: false as const }) : ({ ok: true as const, value });
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
    durationMinimaxH3,
    resolutionMinimaxH3,
    durationLtx23HdrMulti,
    resolutionLtx23HdrMulti,
    resolutionLtx23Lipsync,
    resolutionWanAnimate,
    wanAnimateClipSec,
    resolutionSeedance,
    durationSeedance,
    resolutionGeminiOmni,
    durationGeminiOmni,
    targetResolution,
    isWanAnimate2Model,
    wanAnimate2MediaDurationSec,
    cloudMap,
  ]);
  // ltx-2.3-lipsync 模式：需要图+音频+动作提示词
  const isWan22LipsyncMode = isLtx23LipsyncModel;

  const imageCount = isLtx23MsrStoryboardUi ? ltx23HdrRefImageCount : orderedInputImages.length;

  const availableModels = useMemo(() => {
    const orderIdx = (m: string) => {
      const i = I2V_MODEL_DISPLAY_ORDER.indexOf(m as (typeof I2V_MODEL_DISPLAY_ORDER)[number]);
      return i === -1 ? 999 : i;
    };
    const withMultiFirst = (list: string[]) => {
      const out = [...list];
      if (canUseMinimaxH3Multi && !out.includes('minimax-h3-multi')) {
        out.unshift('minimax-h3-multi');
      }
      return out.sort((a, b) => orderIdx(a) - orderIdx(b)) as readonly string[];
    };

    // 图+音：对口型 / Mini / 全能参考（MSR 图像+声音已下架）
    if (hasImageAndAudio) {
      return withMultiFirst([
        'ltx-2.3-lipsync',
        'minimax-h3-audio',
        'seedance-2.0-mini',
        'minimax-h3-multi',
      ]);
    }
    // 无图：纯音 / 纯视频 / 音+视频 → 仅暴露适合的模型（全能参考忽略视频；纯视频用超分）
    if (!isImageToVideoMode) {
      const list: string[] = [];
      if (canUseMinimaxH3Multi) list.push('minimax-h3-multi');
      if (hasVideoRef) {
        list.push('rhart-video-upscaler');
        list.push('wan-animate-2');
        list.push('wan-animate');
      }
      return list as readonly string[];
    }
    // 有图（单图/多图），可叠加音或视频
    const filtered = imageToVideoModelCandidates.filter((m) => {
      if (m === 'minimax-h3-multi') return canUseMinimaxH3Multi;
      // 参考视频接入：Wan animate2 / WanAnimate（角色替换）；全能参考已在上方单独放行
      if (hasVideoRef) {
        return m === 'wan-animate-2' || m === 'wan-animate';
      }
      if (m === 'ltx-2.3-lipsync' && !hasImageAndAudio) return false;
      if (m === LTX23_MSR_AV_MODEL_ID) return false;
      if (m === 'wan-animate' || m === 'wan-animate-2') return false;
      return modelSupportsRefImageCount(m, imageCount);
    });
    const out = withMultiFirst(filtered as string[]);
    if (hasVideoRef && !out.includes('rhart-video-upscaler')) {
      out.unshift('rhart-video-upscaler');
    }
    return out;
  }, [
    hasImageAndAudio,
    isImageToVideoMode,
    imageToVideoModelCandidates,
    hasVideoRef,
    canUseMinimaxH3Multi,
    imageCount,
  ]);

  const videoModelDropdownOptions = useMemo(() => {
    const toOpt = (id: string) => {
      const meta = VIDEO_I2V_MODEL_LABELS[id] || { label: id };
      return { value: id, label: meta.label };
    };
    let ids: string[] = [];
    if (hasImageAndAudio) {
      ids = ['ltx-2.3-lipsync', 'minimax-h3-audio', 'seedance-2.0-mini', 'minimax-h3-multi'];
    } else if (isImageToVideoMode) {
      ids = [...availableModels];
    } else {
      if (canUseMinimaxH3Multi) ids.push('minimax-h3-multi');
      if (hasVideoRef) ids.push('wan-animate-2', 'wan-animate');
      if (!HIDE_SORA2_AND_SORA_CHARACTER_UI) ids.push('sora-2', 'sora-2-pro');
      ids.push(
        'ltx-2.3-t2v',
        'minimax-h3-t2v',
        'seedance-2.0-fast',
        'seedance-2.0-mini',
        'rhart-video-x',
      );
    }
    if (model && !ids.includes(model)) ids = [model, ...ids];
    return ids.map(toOpt);
  }, [
    VIDEO_I2V_MODEL_LABELS,
    hasImageAndAudio,
    isImageToVideoMode,
    availableModels,
    canUseMinimaxH3Multi,
    hasVideoRef,
    model,
  ]);

  // 图+音频：可在「LTX 对口型」「MiniMax 口型同步」「Seedance Mini」「H3 全能参考」间选择；默认 LTX 对口型
  useEffect(() => {
    if (wanAnimateStandalone || heyGemStandalone) return;
    if (!hasImageAndAudio) return;
    if (
      model === 'ltx-2.3-lipsync' ||
      model === 'minimax-h3-audio' ||
      model === 'seedance-2.0-mini' ||
      model === 'minimax-h3-multi'
    ) {
      return;
    }
    if (model === 'seedance-2.0-fast') {
      onModelChange('seedance-2.0-mini');
      return;
    }
    onModelChange('ltx-2.3-lipsync');
  }, [
    wanAnimateStandalone,
    heyGemStandalone,
    hasImageAndAudio,
    model,
    onModelChange,
  ]);

  /** 图+参考视频齐备时自动切到 Wan animate2 视频换人 */
  const prevWanAnimateInputsRef = useRef({
    imageAndVideoReady: false,
  });
  useEffect(() => {
    if (wanAnimateStandalone || heyGemStandalone || hasImageAndAudio) return;
    if (isMinimaxH3MultiModel) return;
    // 仅「1 张图 + 参考视频」才自动角色替换；纯视频留给视频超分
    const imageAndVideoReady = hasImageAndVideo && imageCount === 1;
    const becameReady =
      imageAndVideoReady && !prevWanAnimateInputsRef.current.imageAndVideoReady;
    prevWanAnimateInputsRef.current.imageAndVideoReady = imageAndVideoReady;
    if (becameReady && model !== 'wan-animate-2' && model !== 'wan-animate') {
      onModelChange('wan-animate-2');
      onResolutionWanAnimateChange?.('720p');
      onWanAnimateClipSecChange?.('8');
    }
  }, [
    wanAnimateStandalone,
    hasImageAndAudio,
    hasImageAndVideo,
    imageCount,
    model,
    isMinimaxH3MultiModel,
    onModelChange,
    onResolutionWanAnimateChange,
    onWanAnimateClipSecChange,
  ]);

  /** Wan animate2：探测原视频时长供价签按秒估算 */
  useEffect(() => {
    if (!isWanAnimate2Model) {
      setWanAnimate2MediaDurationSec(0);
      return;
    }
    const url = String(referenceVideoUrl || '').trim();
    if (!url) {
      setWanAnimate2MediaDurationSec(0);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        let sec = 0;
        if (window.electronAPI?.getMediaDuration) {
          sec = Number(await window.electronAPI.getMediaDuration(url, projectId)) || 0;
        }
        if (!cancelled) setWanAnimate2MediaDurationSec(sec > 0 ? sec : 0);
      } catch {
        if (!cancelled) setWanAnimate2MediaDurationSec(0);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isWanAnimate2Model, referenceVideoUrl, projectId]);

  /** 参考视频断开时，若当前为 WanAnimate / 视频超分则回退默认模型 */
  useEffect(() => {
    if (wanAnimateStandalone || heyGemStandalone) return;
    if ((model !== 'wan-animate' && model !== 'wan-animate-2' && model !== 'rhart-video-upscaler') || hasVideoRef) return;
    onModelChange(DEFAULT_VIDEO_MODEL_REPLACING_SORA2 as Parameters<typeof onModelChange>[0]);
  }, [wanAnimateStandalone, model, hasVideoRef, onModelChange]);

  /** 纯参考视频（无图）接入时默认切到视频超分放大 */
  const prevVideoOnlyRef = useRef(false);
  useEffect(() => {
    if (wanAnimateStandalone || heyGemStandalone || hasImageAndAudio || isImageToVideoMode) return;
    const videoOnly = hasVideoRef;
    const became = videoOnly && !prevVideoOnlyRef.current;
    prevVideoOnlyRef.current = videoOnly;
    if (!became) return;
    if (model === 'rhart-video-upscaler' || model === 'minimax-h3-multi') return;
    onModelChange('rhart-video-upscaler');
    onTargetResolutionChange?.('1080p');
  }, [
    wanAnimateStandalone,
    heyGemStandalone,
    hasImageAndAudio,
    isImageToVideoMode,
    hasVideoRef,
    model,
    onModelChange,
    onTargetResolutionChange,
  ]);

  useEffect(() => {
    if (!isSeedanceFastModel) return;
    const normalized = coerceSeedanceResolution(resolutionSeedance, 'seedance-2.0-fast');
    if (normalized !== resolutionSeedance) {
      onResolutionSeedanceChange?.(normalized);
    }
  }, [isSeedanceFastModel, resolutionSeedance, onResolutionSeedanceChange]);

  /**
   * 无图但已接参考音/视频：仅当当前仍是「图生专用」模型（连线变化后失效）时，
   * 才自动落到全能参考；不要抢走用户选的文生模型。
   */
  useEffect(() => {
    if (wanAnimateStandalone || heyGemStandalone) return;
    if (isImageToVideoMode || hasImageAndAudio) return;
    if (!canUseMinimaxH3Multi) return;
    const i2vOnlyStuck =
      model === 'minimax-h3-i2v' ||
      model === 'ltx-2.3-i2v' ||
      model === 'minimax-h3-audio' ||
      model === 'ltx-2.3-lipsync' ||
      model === LTX23_MSR_AV_MODEL_ID ||
      model === 'gemini-omni-flash' ||
      model === 'rhart-v3.1-pro-se';
    if (!i2vOnlyStuck) return;
    if (availableModels.includes('minimax-h3-multi')) {
      onModelChange('minimax-h3-multi');
    }
  }, [
    wanAnimateStandalone,
    heyGemStandalone,
    isImageToVideoMode,
    hasImageAndAudio,
    canUseMinimaxH3Multi,
    availableModels,
    model,
    onModelChange,
  ]);

  // Grok video3 / 稳定版 最多 7 张参考图：从其他模型切过来时裁掉多余
  useEffect(() => {
    if (model !== 'grok-3' && model !== 'rhart-video-x' && model !== 'grok-3-stable') return;
    setOrderedInputImages((prev) => (prev.length > 7 ? prev.slice(0, 7) : prev));
  }, [model]);

  // MiniMax H3 全能参考最多 9 张；口型同步最多 5 张
  useEffect(() => {
    if (model === 'minimax-h3-multi') {
      setOrderedInputImages((prev) => (prev.length > 9 ? prev.slice(0, 9) : prev));
      return;
    }
    if (model === 'minimax-h3-audio') {
      setOrderedInputImages((prev) => (prev.length > 5 ? prev.slice(0, 5) : prev));
    }
  }, [model]);

  // 口型同步：读参考音时长 → 向上取整计费档，写入 durationMinimaxH3（供标价/提交）；不展示计费时长 UI
  const durationMinimaxH3Ref = useRef(durationMinimaxH3);
  durationMinimaxH3Ref.current = durationMinimaxH3;
  const onDurationMinimaxH3ChangeRef = useRef(onDurationMinimaxH3Change);
  onDurationMinimaxH3ChangeRef.current = onDurationMinimaxH3Change;
  useEffect(() => {
    if (!isMinimaxH3AudioModel) return;
    const aud = String(inputAudioUrl || '').trim();
    let cancelled = false;
    const applyBilling = (actualSec: number | undefined) => {
      if (cancelled) return;
      const tier = mapMinimaxH3AudioBillingDurationSec(actualSec);
      const next = String(tier) as '6' | '10' | '15' | '20';
      if (String(durationMinimaxH3Ref.current) !== next) {
        onDurationMinimaxH3ChangeRef.current?.(next);
      }
    };
    if (!aud) {
      applyBilling(undefined);
      return;
    }
    const probe = async () => {
      let sec = 0;
      try {
        if (window.electronAPI?.getMediaDuration) {
          sec = Number(await window.electronAPI.getMediaDuration(aud, projectId)) || 0;
        }
      } catch {
        sec = 0;
      }
      applyBilling(sec > 0 ? sec : undefined);
    };
    void probe();
    return () => {
      cancelled = true;
    };
  }, [isMinimaxH3AudioModel, inputAudioUrl, projectId]);

  // 对口型模式下，提示词为空时初始自动填入默认动作提示词
  useEffect(() => {
    if (hasImageAndAudio && isLtx23LipsyncModel && !(prompt || '').trim()) {
      onPromptChange(vt.defaultLipsyncAction, nodeId);
    }
  }, [hasImageAndAudio, isLtx23LipsyncModel, nodeId, prompt, onPromptChange, vt.defaultLipsyncAction]);

  // 图生视频：当前模型不支持参考图数量时自动切换（H3 文生→图生/多参；多图优先多参）
  // 已选 minimax-h3-multi / audio 时绝不自动改成 i2v / 其它模型
  useEffect(() => {
    if (wanAnimateStandalone || heyGemStandalone) return;
    if (model === 'minimax-h3-multi' || model === 'minimax-h3-audio') return;
    if (isImageToVideoMode && !hasImageAndAudio) {
      if (!availableModels.includes(model as any)) {
        const paired =
          (model === 'minimax-h3-t2v' || model === 'minimax-h3-i2v') &&
          imageCount > 1 &&
          availableModels.includes('minimax-h3-multi')
            ? 'minimax-h3-multi'
            : model === 'minimax-h3-t2v' && availableModels.includes('minimax-h3-i2v')
              ? 'minimax-h3-i2v'
              : null;
        const defaultModel =
          paired || (availableModels[0] as string) || DEFAULT_VIDEO_MODEL_REPLACING_SORA2;
        console.log(
          `[VideoInputPanel] 当前模型 ${model} 不支持 ${imageCount} 张参考图，自动切换到 ${defaultModel}`,
        );
        onModelChange(defaultModel as any);
      }
    }
  }, [wanAnimateStandalone, isImageToVideoMode, hasImageAndAudio, imageCount, model, availableModels, onModelChange]);

  /** 点击参考音缩略标签：插入 @音频N 胶囊（与图片 @ 机制对齐） */
  const appendRefAudioMentionToPrompt = useCallback(
    (audioIndex: number) => {
      const idx = audioIndex - 1;
      const tag = vt.appendAudioTag(audioIndex);
      const meta = resolvedConnectedAudios[idx];
      const label = locale === 'en' ? `Audio${audioIndex}` : `音频${audioIndex}`;
      const item = {
        id: `ref-audio-${idx}`,
        origin: 'ref' as const,
        type: 'audio' as const,
        label,
        refLabel: label,
        thumbUrl: undefined as string | undefined,
        nodeId: String(meta?.nodeId || '').trim() || undefined,
        insertText: tag,
        subtitle: locale === 'en' ? 'Reference audio' : '参考音',
      };
      const next =
        promptInputRef.current?.insertMention(item) ??
        (() => {
          const trimmedEnd = localPrompt.trimEnd();
          const needSpace = trimmedEnd.length > 0 && !/\s$/.test(localPrompt);
          return trimmedEnd + (needSpace ? ' ' : '') + tag;
        })();
      setLocalPrompt(next);
      lastSentPromptRef.current = next;
      onPromptChange(next, nodeId);
      promptInputRef.current?.focus();
    },
    [onPromptChange, localPrompt, nodeId, vt, resolvedConnectedAudios, locale],
  );

  /** 未连接时的提示文案；已连接则不展示绿字，改由声音标签缩略图表达 */
  const renderConnectedAudioEmptyHint = (mode: 'required' | 'optional') => {
    if (resolvedConnectedAudios.length > 0) return null;
    const warnColor = isDarkMode ? 'text-amber-400' : 'text-amber-600';
    const mutedColor = isDarkMode ? 'text-white/45' : 'text-gray-500';
    return (
      <span className={`text-xs shrink-0 ${mode === 'required' ? warnColor : mutedColor}`}>
        {mode === 'required' ? vt.audioNeedConnect : vt.audioRefOptional}
      </span>
    );
  };

  /** 参考图区旁：每路参考音一个紫色 equalizer 缩略标签（点击插入 @音频N） */
  const renderConnectedAudioThumbs = (opts?: { className?: string }) => {
    const list = resolvedConnectedAudios;
    if (list.length === 0) return null;
    return (
      <div
        className={`flex flex-wrap items-center gap-1.5 min-w-0 ${opts?.className || ''}`}
        role="list"
        aria-label={vt.refAudioColumn}
      >
        {list.map((a, index) => {
          const n = index + 1;
          const seed = String(a.nodeId || a.url || a.name || `audio-${n}`).trim();
          return (
            <button
              key={`ref-audio-thumb-${a.nodeId || seed}-${n}`}
              type="button"
              role="listitem"
              onClick={(e) => {
                e.stopPropagation();
                appendRefAudioMentionToPrompt(n);
              }}
              className={`relative w-9 h-9 shrink-0 rounded-md border transition-colors nodrag nopan cursor-pointer ${
                isDarkMode
                  ? 'border-violet-400/40 hover:border-violet-300/80'
                  : 'border-violet-300/70 hover:border-violet-500'
              }`}
              title={vt.refAudioThumbTitle(n)}
              aria-label={vt.refAudioThumbAlt(n)}
            >
              <AudioEqThumb
                seed={seed}
                isDarkMode={isDarkMode}
                indexLabel={n}
                className="w-full h-full rounded-md"
              />
            </button>
          );
        })}
      </div>
    );
  };

  const showAudioRefUi =
    isLtx23LipsyncModel ||
    isLtx23MsrAv ||
    isMinimaxH3AudioModel ||
    isMinimaxH3MultiModel ||
    isSeedanceMiniModel;
  const audioRefMode: 'required' | 'optional' =
    isLtx23LipsyncModel || isLtx23MsrAv || isMinimaxH3AudioModel ? 'required' : 'optional';

  // 模式标签和按钮文案
  const modeLabel = isLtx23LipsyncModel
    ? vt.modeLipsync
    : isHeyGemModel
      ? vt.heyGemInputLabel
    : isWanAnimate2Model
      ? vt.wanAnimate2InputLabel
    : isWanAnimateModel
      ? vt.wanAnimateInputLabel
      : isSeedanceMiniModel
        ? vt.modeSeedanceMini
      : isSeedanceModel
        ? vt.modeMultimodalVideo
        : isImageToVideoMode
        ? vt.modeImageToVideo
        : vt.modeTextToVideo;

  // 超时定时器引用
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);
  const startTimeRef = useRef<number | null>(null);
  const lastProgressUiRef = useRef<{ at: number; progress: number }>({ at: 0, progress: -1 });
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
        // HeyGem：由 VideoNode 统一 DarkAlert，避免与内联 errorMessage 弹窗重复
        if (
          !isHeyGemModel &&
          (payload as { balanceInsufficient?: boolean }).balanceInsufficient === true
        ) {
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
          const progressMessage = progressText.replace(/\s*\d+%$/, '').trim() || vt.generatingVideo;
          const now = Date.now();
          const prev = lastProgressUiRef.current;
          const skipUi =
            now - prev.at < 1500 &&
            Math.abs(progressValue - prev.progress) < 5 &&
            progressValue < 95;
          if (!skipUi) {
            lastProgressUiRef.current = { at: now, progress: progressValue };
            if (onProgressChange) {
              onProgressChange(progressValue);
            }
            if (onProgressMessageChange) {
              onProgressMessageChange(progressMessage);
            }
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
      
      // 检测余额不足错误（HeyGem 由 VideoNode 统一弹窗）
      const isQuotaError = errorMessage.includes('quota is not enough') || 
                          errorMessage.includes('remain quota') ||
                          errorMessage.includes('余额不足');
      
      if (isQuotaError && !isHeyGemModel) {
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
      onPromptChange(localPrompt, nodeId);
    }
  }, [onPromptChange, localPrompt, nodeId]);

  const handleExecute = useCallback(async () => {
    flushPromptSync();
    if (progress > 0 && progress < 100) return;
    if (aiStatus === 'START' || aiStatus === 'PROCESSING') return;
    if (!isWanAnimateFamily && !isHeyGemModel && !isRhartVideoUpscaler && !localPrompt.trim()) return;

    // MSR：工作流需 1 背景 + 至少 2 分镜（RH ImageResizeKJv2 要求 image2 非空）
    if (isLtx23MsrStoryboardUi) {
      const hdrCheck = validateLtx23HdrMultiInputs(hdrBackground, storyboardImages);
      if (!hdrCheck.ok) {
        console.error(hdrCheck.error);
        onErrorTask?.(hdrCheck.error);
        return;
      }
      if (isLtx23MsrAv && !(inputAudioUrl || '').trim()) {
        const msg = 'LTX2.3-MSR 图像+声音需连接音频节点';
        console.error(msg);
        onErrorTask?.(msg);
        return;
      }
    } else if (isMinimaxH3AudioModel && !(inputAudioUrl || '').trim()) {
      const msg = vt.modelMinimaxH3AudioNeedRefAudio;
      console.error(msg);
      onErrorTask?.(msg);
      return;
    } else if (isMinimaxH3MultiModel) {
      if (orderedInputImages.length > 9) {
        const msg = 'MiniMax H3 全能参考最多 9 张参考图';
        onErrorTask?.(msg);
        return;
      }
    } else if (isImageToVideoMode && orderedInputImages.length === 0) {
      console.error('图生视频模式但没有参考图片');
      return;
    }
    if (isGeminiOmniFamily) {
      const n = orderedInputImages.length;
      if (n !== 1 && n !== 3) {
        const msg = isGeminiOmniFlashModel
          ? '全能视频 Omni Flash 仅支持 1 张或 3 张参考图，不支持 2 张'
          : 'Gemini Omni 仅支持 1 张或 3 张参考图，不支持 2 张';
        console.error(msg);
        onErrorTask?.(msg);
        return;
      }
      if (localPrompt.trim().length > 2048) {
        const msg = '提示词最长 2048 字';
        console.error(msg);
        onErrorTask?.(msg);
        return;
      }
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
      // HeyGem：校验 + 有台词时先一键 TTS，再用驱动音频生成
      let heyGemDriveAudio = (inputAudioUrl || '').trim();
      if (isHeyGemModel) {
        if (!(referenceVideoUrl || '').trim()) {
          showAlert(vt.heyGemNeedRefVideo);
          onProgressChange?.(0);
          return;
        }
        if (!heyGemDriveAudio && !localHeyGemScript.trim()) {
          showAlert(vt.heyGemNeedScriptOrAudio);
          onProgressChange?.(0);
          return;
        }
        if (localHeyGemScript.trim()) {
          heyGemDriveAudio = await runHeyGemTts();
        }
      }

      // 前端只负责"传地址"，不做任何处理
      // 本地图片路径（local-resource:// 或 file://）直接发送给后端
      // 由后端的 VideoProvider.ts 接收到地址后，触发 uploadImageToOSS 方法进行转运
      // 后端转运成功拿到 https URL 后，再由后端发起请求给 RunningHub
      console.log('[VideoInputPanel] 准备发送图片路径给后端处理:', orderedInputImages);

      const payload: any = {
        // wan-animate：强制空提示词；wan-animate-2：提示词选填（有则下发）
        prompt: isWanAnimateModel || isHeyGemModel || isRhartVideoUpscaler ? '' : localPrompt,
        model: effectiveVideoModel,
      };
      if (!isHeyGemModel && !isWanAnimateFamily && !isRhartVideoUpscaler) {
        payload.aspect_ratio = aspectRatio;
      }

      // sora-2 系列参数
      if (model === 'sora-2' || model === 'sora-2-pro') {
        payload.hd = hd;
        payload.duration = duration;
        payload.sora2Channel = sora2Channel;
      }

      // 全能视频V3.1-fast / fast-se / pro-se / Veo3.1 Pro 文生：分辨率 720p/1080p/4k
      if (isRhartV31FastModel || isRhartV31FastSEModel || isRhartV31ProSEModel || isRhartV31ProModel || isRhVideoStartEndModel) {
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

      if (isRhartVideoUpscaler) {
        if (!(referenceVideoUrl || '').trim()) {
          showAlert('视频超分放大需要连接参考视频');
          onProgressChange?.(0);
          return;
        }
        payload.referenceVideoUrl = (referenceVideoUrl || '').trim();
        payload.targetResolution = targetResolution;
      }
      if (isWanAnimateFamily) {
        payload.referenceVideoUrl = (referenceVideoUrl || '').trim();
        payload.resolutionWanAnimate = resolutionWanAnimate;
        if (isWanAnimateModel) {
          payload.wanAnimateClipSec = wanAnimateClipSec;
        }
        if (isWanAnimate2Model && wanAnimate2MediaDurationSec > 0) {
          payload.mediaDurationSec = wanAnimate2MediaDurationSec;
        }
      }

      if (isHeyGemModel) {
        payload.referenceVideoUrl = (referenceVideoUrl || '').trim();
        payload.inputAudioUrl = heyGemDriveAudio;
        if (localHeyGemScript.trim()) {
          onHeyGemScriptChange?.(localHeyGemScript.trim());
        }
      }

      if (isSeedanceModel) {
        payload.resolutionSeedance = resolutionSeedance;
        payload.durationSeedance = normalizeSeedanceDurationChoice(durationSeedance, 10);
        payload.aspect_ratio = coerceSeedanceRatio(aspectRatio);
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

      if (isGeminiOmniFlashModel) {
        payload.resolutionGeminiOmni = resolutionGeminiOmni;
        payload.durationGeminiOmni = normalizeGeminiOmniFlashDurationChoice(durationGeminiOmni, 6);
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
      // MiniMax-H3 文生/图生/多参/口型同步：分辨率(仅 720P→megapixels 0.9)、比例；多参可选参考音；口型同步必填参考音
      // 口型同步 durationMinimaxH3 为按参考音映射的计费档（RH 不再传时长节点）
      if (isMinimaxH3Model) {
        payload.resolutionMinimaxH3 = resolutionMinimaxH3;
        payload.aspect_ratio = aspectRatio;
        payload.durationMinimaxH3 = isMinimaxH3AudioModel
          ? normalizeMinimaxH3AudioDurationChoice(durationMinimaxH3, 20)
          : durationMinimaxH3;
        if (isMinimaxH3MultiModel) {
          payload.images = orderedInputImages.slice(0, 9);
          const audios = (Array.isArray(connectedAudios) ? connectedAudios : [])
            .map((a) => String(a?.url || '').trim())
            .filter(Boolean)
            .slice(0, 3);
          const aud = audios[0] || (inputAudioUrl || '').trim();
          if (audios.length > 0) payload.inputAudioUrls = audios;
          if (aud) payload.inputAudioUrl = aud;
        }
        if (isMinimaxH3AudioModel) {
          payload.images = orderedInputImages.slice(0, 5);
          payload.inputAudioUrl = (inputAudioUrl || '').trim();
        }
      }
      if (isLtx23HdrMultiModel || isLtx23MsrAv) {
        const built = buildLtx23HdrMultiPayload(hdrBackground, storyboardImages);
        payload.ltx23HdrBackgroundImage = built.background;
        payload.images = built.storyboardSlots;
        payload.durationLtx23HdrMulti = durationLtx23HdrMulti;
        payload.resolutionLtx23HdrMulti = resolutionLtx23HdrMulti;
        payload.aspect_ratio = aspectRatio === '9:16' ? '9:16' : '16:9';
        if (isLtx23MsrAv) {
          payload.inputAudioUrl = (inputAudioUrl || '').trim();
        }
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

      if (isGrok3Model || isRhartVideoXModel || isGrok3StableModel) {
        payload.durationGrok3 = durationGrok3;
        payload.resolutionGrok3 = resolutionGrok3;
      }

      // 直接传递原始图片路径给后端，不做任何前端处理
      // 后端会检测本地路径并自动上传到 OSS
      if (isImageToVideoMode && orderedInputImages.length > 0 && !isLtx23MsrStoryboardUi) {
        payload.images =
          isLtx23LipsyncModel || isLtx23I2vModel || isWanAnimateFamily
            ? orderedInputImages.slice(0, 1)
            : isMinimaxH3MultiModel
              ? orderedInputImages.slice(0, 9)
            : isMinimaxH3AudioModel
              ? orderedInputImages.slice(0, 5)
            : isGeminiOmniFamily
              ? orderedInputImages.filter((u) => String(u || '').trim()).slice(0, 3)
            : isSeedanceModel
              ? orderedInputImages.slice(0, 9)
              : isGrok3Model || isRhartVideoXModel || isGrok3StableModel
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
  }, [flushPromptSync, progress, aiStatus, localPrompt, model, effectiveVideoModel, aspectRatio, hd, duration, orderedInputImages, executeAI, isImageToVideoMode, isKlingModel, isKlingVideoO1Model, isKlingVideoO1I2vModel, isKlingVideoO1StartEndModel, isRhVideoStartEndModel, isKlingVideoO1RefModel, referenceVideoUrl, keepOriginalSound, isWan26Model, isWan26FlashModel, isWanAnimateModel, isWanAnimate2Model, isWanAnimateFamily, isHeyGemModel, isSeedanceModel, isSeedanceMiniModel, isGeminiOmniModel, isLtx23LipsyncModel, isLtx23I2vModel, isLtx23T2vModel, isMinimaxH3Model, isMinimaxH3MultiModel, isMinimaxH3AudioModel, isLtx23HdrMultiModel, isLtx23MsrAv, isLtx23MsrStoryboardUi, hdrBackground, storyboardImages, inputAudioUrl, connectedAudios, resolutionLtx23Lipsync, durationLtx23I2v, resolutionLtx23I2v, durationLtx23T2v, resolutionLtx23T2v, durationMinimaxH3, resolutionMinimaxH3, durationLtx23HdrMulti, resolutionLtx23HdrMulti, isRhartV31FastModel, isRhartV31FastSEModel, isRhartV31ProSEModel, isRhartV31ProOfficialI2vModel, isHailuo02Model, isHailuo23Model, isHailuo02I2vModel, isHailuo23I2vModel, guidanceScale, sound, shotType, negativePrompt, resolutionWan26, resolutionRhartV31, durationWan26Flash, durationVeo31ProOfficial, generateAudioVeo31ProOfficial, durationHailuo02, resolutionHailuo, durationKlingO1, modeKlingO1, enableAudio, resolutionWanAnimate, wanAnimateClipSec, wanAnimate2MediaDurationSec, resolutionSeedance, durationSeedance, resolutionGeminiOmni, durationGeminiOmni, projectId, onErrorTask, isGrok3Model, durationGrok3, resolutionGrok3, showAlert, vt.initializing, vt.heyGemNeedRefVideo, vt.heyGemNeedScriptOrAudio, onProgressChange, onProgressMessageChange, runHeyGemTts, localHeyGemScript, onHeyGemScriptChange]);

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
    !videoPriceLabel.ok ||
    (!isWanAnimateFamily && !isHeyGemModel && !isRhartVideoUpscaler && !localPrompt.trim()) ||
    (isMinimaxH3MultiModel
      ? orderedInputImages.length > 9
      : isImageToVideoMode &&
        !isLtx23MsrStoryboardUi &&
        !isRhartVideoUpscaler &&
        (!inputImages || inputImages.length === 0)) ||
    (isLtx23MsrStoryboardUi && !isLtx23HdrMultiRunnable(hdrBackground, storyboardImages)) ||
    (isKlingVideoO1RefModel && !(referenceVideoUrl || '').trim()) ||
    (isRhartVideoUpscaler && !(referenceVideoUrl || '').trim()) ||
    (isWanAnimateFamily &&
      (!(referenceVideoUrl || '').trim() || orderedInputImages.length === 0)) ||
    (isHeyGemModel &&
      (!(referenceVideoUrl || '').trim() ||
        (!(inputAudioUrl || '').trim() && !localHeyGemScript.trim()))) ||
    (isHeyGemModel && heyGemTtsBusy) ||
    (isLtx23LipsyncModel && (!inputImages || inputImages.length === 0)) ||
    (isLtx23LipsyncModel && !(inputAudioUrl || '').trim()) ||
    (isLtx23MsrAv && !(inputAudioUrl || '').trim()) ||
    (isMinimaxH3AudioModel && !(inputAudioUrl || '').trim());

  const isRunBusy = isGenerating || isAiBusy || (isHeyGemModel && heyGemTtsBusy);

  // 调试日志：确认每个模块的状态是独立的
  useEffect(() => {
    console.log(`[VideoInputPanel ${nodeId}] aiStatus: ${aiStatus}, isRunDisabled: ${isRunDisabled}`);
  }, [nodeId, aiStatus, isRunDisabled]);

  return (
    <div className={`relative flex w-full flex-col nodrag nopan ${embedInNode ? 'h-full' : ''}`}>
      {/* 无框贴水：弱边框 + 轻玻璃；嵌进节点主框时去外框，由节点壳承担 */}
      <div
        className={[
          'relative flex flex-col transition-colors',
          embedInNode
            ? 'h-full min-h-0 overflow-auto rounded-2xl border-0 bg-transparent shadow-none'
            : [
                'overflow-hidden rounded-[18px] border',
                isDarkMode
                  ? 'nexflow-glass-panel border-white/[0.14] shadow-[0_8px_28px_rgba(0,0,0,0.28)]'
                  : 'apple-panel-light border-black/[0.08] shadow-[0_8px_28px_rgba(0,0,0,0.06)]',
              ].join(' '),
          isHeyGemModel ? 'px-3 pt-2 pb-2' : 'px-3.5 pt-2.5 pb-2',
        ].join(' ')}
      >
      {/* 输入区：HeyGem 一体化 / WanAnimate 槽位 / 其余模式见下方 */}
      <div className="pt-1 pb-0 flex-1 min-h-0 flex flex-col">
        {isHeyGemModel ? (
          <div className="flex flex-col gap-3 flex-1 min-h-0 nodrag nopan">
            <div
              className={`grid gap-2 flex-1 min-h-0 ${
                embedInNode ? 'grid-cols-2 h-full divide-x divide-white/[0.06]' : 'grid-cols-1 sm:grid-cols-2'
              }`}
            >
              {/* ① 参考视频 */}
              <div
                className={`rounded-2xl p-3 flex flex-col gap-2 min-h-0 h-full w-full border-0 ${
                  isDarkMode ? 'bg-transparent' : 'bg-transparent'
                }`}
              >
                <div className="flex items-center gap-2 shrink-0">
                  <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-emerald-500 text-[12px] font-semibold text-white shrink-0">
                    1
                  </span>
                  <span className={`text-sm font-medium ${isDarkMode ? 'text-white/90' : 'text-gray-900'}`}>
                    {vt.heyGemStepRefVideo}
                  </span>
                </div>
                <p className={`text-[11px] leading-snug shrink-0 ${isDarkMode ? 'text-white/45' : 'text-gray-500'}`}>
                  {vt.heyGemStepRefVideoHint}
                </p>
                {heyGemRefVideoReady ? (
                  <div
                    className={`relative w-full flex-1 min-h-0 rounded-xl overflow-hidden flex items-center justify-center ${
                      isDarkMode ? 'bg-black/40' : 'bg-black/5'
                    }`}
                    onMouseEnter={() => {
                      const v = heyGemPreviewVideoRef.current;
                      if (!v) return;
                      v.loop = true;
                      void v.play().catch(() => undefined);
                    }}
                    onMouseLeave={() => {
                      const v = heyGemPreviewVideoRef.current;
                      if (!v) return;
                      v.pause();
                      try {
                        v.currentTime = 0;
                      } catch {
                        /* ignore */
                      }
                    }}
                  >
                    <video
                      ref={heyGemPreviewVideoRef}
                      src={toElectronVideoElementSrc(String(referenceVideoUrl)) || String(referenceVideoUrl)}
                      className="max-h-full max-w-full w-full h-full object-contain rounded-xl"
                      muted={heyGemPreviewMuted}
                      playsInline
                      preload="metadata"
                    />
                    <button
                      type="button"
                      className="nodrag nopan absolute top-2 left-2 z-10 inline-flex h-7 w-7 items-center justify-center rounded-md bg-black/70 text-white/90 ring-1 ring-white/20 hover:bg-black/85"
                      title={heyGemPreviewMuted ? (locale === 'en' ? 'Unmute' : '开声') : locale === 'en' ? 'Mute' : '静音'}
                      onClick={(e) => {
                        e.stopPropagation();
                        setHeyGemPreviewMuted((m) => !m);
                      }}
                      onPointerDown={(e) => e.stopPropagation()}
                    >
                      {heyGemPreviewMuted ? (
                        <VolumeX className="h-3.5 w-3.5" />
                      ) : (
                        <Volume2 className="h-3.5 w-3.5" />
                      )}
                    </button>
                    <button
                      type="button"
                      className="nodrag nopan absolute top-2 right-2 z-10 inline-flex h-6 w-6 items-center justify-center rounded-full bg-black/60 text-white hover:bg-black/80"
                      title={vt.heyGemClearVideo}
                      onClick={(e) => {
                        e.stopPropagation();
                        applyHeyGemReferenceVideo('');
                      }}
                      onPointerDown={(e) => e.stopPropagation()}
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ) : (
                  <div className="flex flex-1 min-h-0 flex-wrap items-center justify-center content-center gap-1.5">
                    {(
                      [
                        {
                          key: 'upload',
                          label: vt.heyGemClickUploadRefVideo,
                          onClick: () => void handleHeyGemUploadVideo(),
                          disabled: false,
                        },
                        {
                          key: 'library',
                          label: vt.heyGemPickFromLibrary,
                          onClick: () => void handleHeyGemOpenLibrary(),
                          disabled: false,
                        },
                        {
                          key: 'canvas',
                          label: vt.heyGemPickFromCanvas,
                          onClick: () => void handleHeyGemPickFromCanvas(),
                          disabled: !onPickReferenceVideoFromCanvas,
                        },
                      ] as const
                    ).map(({ key, label, onClick, disabled }) => (
                      <button
                        key={key}
                        type="button"
                        onClick={onClick}
                        disabled={disabled}
                        title={key === 'upload' ? vt.heyGemUploadFormatsHint : label}
                        className={`text-xs flex items-center gap-1.5 shrink-0 disabled:opacity-40 disabled:pointer-events-none ${assetLibBtnPrimary(
                          isDarkMode,
                          '!py-0.5 !px-2',
                          'control',
                        )}`}
                      >
                        <span
                          className={`inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-dashed ${
                            isDarkMode ? 'border-white/35 text-white/90' : 'border-white/55 text-white'
                          }`}
                        >
                          <Plus className="w-3 h-3" strokeWidth={2.5} />
                        </span>
                        {label}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* ② 台词与声音 */}
              <div
                className={`rounded-2xl p-3 flex flex-col gap-2 min-h-0 border-0 ${
                  isDarkMode ? 'bg-transparent' : 'bg-transparent'
                }`}
              >
                <div className="flex items-center gap-2">
                  <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-emerald-500 text-[12px] font-semibold text-white shrink-0">
                    2
                  </span>
                  <span className={`text-sm font-medium ${isDarkMode ? 'text-white/90' : 'text-gray-900'}`}>
                    {vt.heyGemStepScriptVoice}
                  </span>
                </div>
                <label className={`text-[11px] font-medium ${isDarkMode ? 'text-white/70' : 'text-gray-700'}`}>
                  {vt.heyGemScriptLabel}
                </label>
                <div className="relative flex-1 min-h-[120px]">
                  <textarea
                    value={localHeyGemScript}
                    maxLength={HEYGEM_SCRIPT_MAX}
                    onFocus={() => {
                      heyGemScriptFocusedRef.current = true;
                    }}
                    onBlur={() => {
                      heyGemScriptFocusedRef.current = false;
                      onHeyGemScriptChange?.(localHeyGemScript);
                    }}
                    onChange={(e) => setLocalHeyGemScript(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key !== 'Enter' || e.shiftKey) return;
                      if (e.nativeEvent.isComposing || e.keyCode === 229) return;
                      if (isRunDisabled) return;
                      e.preventDefault();
                      void handleExecute();
                    }}
                    placeholder={vt.heyGemScriptPlaceholder}
                    className={`absolute inset-0 w-full h-full resize-none rounded-xl px-3 py-2.5 pr-10 pb-7 text-xs outline-none ${
                      isDarkMode
                        ? 'bg-black/40 text-white border-0 placeholder:text-white/30'
                        : 'bg-white text-gray-900 border-0 placeholder:text-gray-400'
                    }`}
                  />
                  <div className="absolute top-1.5 right-1.5 z-10 pointer-events-auto">
                    {heyGemScriptVoiceMicButton}
                  </div>
                  <span
                    className={`pointer-events-none absolute bottom-2 right-3 text-[10px] tabular-nums ${
                      isDarkMode ? 'text-white/35' : 'text-gray-400'
                    }`}
                  >
                    {vt.heyGemScriptCharCount(localHeyGemScript.length, HEYGEM_SCRIPT_MAX)}
                  </span>
                </div>
                <label className={`text-[11px] font-medium ${isDarkMode ? 'text-white/70' : 'text-gray-700'}`}>
                  {vt.heyGemVoiceModelLabel}
                </label>
                <div className="flex items-center gap-2 rounded-xl px-2.5 py-1.5 bg-black border-0">
                  <AudioLines className="h-4 w-4 text-emerald-500 shrink-0" />
                  <PanelOptionDropdown
                    value={heyGemEffectiveTtsModel}
                    options={HEYGEM_TTS_MODELS.map((m) => ({ value: m.value, label: m.label }))}
                    onChange={(v) => onHeyGemTtsModelChange?.(v)}
                    isDarkMode
                    title={vt.heyGemVoiceModelLabel}
                    minWidthPx={148}
                    menuPlacement="up"
                    className="!bg-black !text-white !border-0 flex-1"
                  />
                </div>
                <p className={`text-[10px] leading-snug ${isDarkMode ? 'text-white/35' : 'text-gray-400'}`}>
                  {vt.heyGemTtsModelHint}
                </p>
                {/* 底栏：上传驱动音频 + 元宝/数字人/运行（参考音默认从参考视频抽音） */}
                <div className="mt-auto flex flex-wrap items-center justify-between gap-x-3 gap-y-2 pt-1">
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 min-w-0">
                    <button
                      type="button"
                      onClick={() => void handleHeyGemUploadDriveAudio()}
                      className={`text-[11px] underline-offset-2 hover:underline ${
                        isDarkMode ? 'text-white/45 hover:text-white/70' : 'text-gray-500 hover:text-gray-700'
                      }`}
                    >
                      {vt.heyGemUploadDriveAudio}
                      {heyGemDriveAudioReady ? ` · ${vt.heyGemSlotConnected}` : ''}
                    </button>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0 ml-auto">
                    {videoPriceLabel.ok ? (
                      <span
                        className={`text-[11px] font-medium px-2 py-0.5 rounded-full shrink-0 tabular-nums border ${
                          isDarkMode
                            ? 'text-amber-200/90 bg-amber-500/15 border-amber-400/25'
                            : 'text-amber-700 bg-amber-50 border-amber-200'
                        }`}
                        title={vt.priceTooltip}
                      >
                        {videoPriceLabel.value}
                        {locale === 'en' ? ' ' : ''}
                        {vt.creditsSuffix}
                      </span>
                    ) : (
                      <span
                        className={`text-[11px] font-medium px-2 py-0.5 rounded-full shrink-0 ${
                          isDarkMode ? 'text-white/45 bg-white/10' : 'text-gray-500 bg-gray-100'
                        }`}
                        title={vt.noPricingTableTitle}
                      >
                        {vt.noPricingYet}
                      </span>
                    )}
                    <span
                      className={`text-[11px] font-medium px-2 py-0.5 rounded-full shrink-0 border ${
                        isDarkMode
                          ? 'text-emerald-200/90 bg-emerald-500/20 border-emerald-400/30'
                          : 'text-emerald-700 bg-emerald-50 border-emerald-200'
                      }`}
                      title={modeLabel}
                    >
                      {modeLabel}
                    </span>
                    <button
                      type="button"
                      onClick={() => void handleExecute()}
                      disabled={isRunDisabled}
                      className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 transition-colors ${
                        isRunDisabled
                          ? isDarkMode
                            ? 'bg-white/[0.08] text-white/25 cursor-not-allowed'
                            : 'bg-black/[0.06] text-gray-400 cursor-not-allowed'
                          : isRunBusy
                            ? isDarkMode
                              ? 'bg-white/70 text-black cursor-not-allowed'
                              : 'bg-gray-700 text-white cursor-not-allowed'
                            : isDarkMode
                              ? 'bg-white text-black hover:bg-white/90'
                              : 'bg-gray-900 text-white hover:bg-gray-800'
                      }`}
                      title={heyGemTtsBusy ? vt.heyGemDubbing : isRunBusy ? vt.heyGemGenerating : modeLabel}
                      aria-label={modeLabel}
                    >
                      {isRunBusy ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <ArrowUp className="w-3.5 h-3.5" strokeWidth={2.5} />
                      )}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        ) : isWanAnimateFamily ? (
          <div className="grid grid-cols-2 gap-2 flex-1 min-h-0">
            {[
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
            {isWanAnimate2Model ? (
              <div className="col-span-2 mt-1 flex flex-col gap-1 nodrag nopan">
                <label className={`text-[11px] font-medium ${isDarkMode ? 'text-white/70' : 'text-gray-700'}`}>
                  {vt.wanAnimate2PromptOptionalLabel}
                </label>
                <textarea
                  value={localPrompt}
                  onFocus={() => {
                    promptInputFocusedRef.current = true;
                  }}
                  onBlur={() => {
                    promptInputFocusedRef.current = false;
                    if (promptDebounceRef.current) {
                      clearTimeout(promptDebounceRef.current);
                      promptDebounceRef.current = null;
                    }
                    const v = localPromptRef.current;
                    if (v !== lastSentPromptRef.current) {
                      lastSentPromptRef.current = v;
                      onPromptChange(v, nodeId);
                    }
                  }}
                  onChange={(e) => {
                    const v = e.target.value;
                    setLocalPrompt(v);
                    // 防抖写回节点，避免每键触发父级重渲染打断输入（尤其是 IME）
                    if (promptDebounceRef.current) clearTimeout(promptDebounceRef.current);
                    promptDebounceRef.current = setTimeout(() => {
                      promptDebounceRef.current = null;
                      if (v !== lastSentPromptRef.current) {
                        lastSentPromptRef.current = v;
                        onPromptChange(v, nodeId);
                      }
                    }, 300);
                  }}
                  onPointerDown={(e) => e.stopPropagation()}
                  onKeyDown={(e) => e.stopPropagation()}
                  placeholder={vt.wanAnimate2PromptOptionalPlaceholder}
                  rows={2}
                  className={`nodrag nopan w-full resize-none rounded-lg border px-2.5 py-1.5 text-xs outline-none ${
                    isDarkMode
                      ? 'border-white/12 bg-black/35 text-white/90 placeholder:text-white/35'
                      : 'border-gray-300 bg-white text-gray-900 placeholder:text-gray-400'
                  }`}
                />
              </div>
            ) : (
              <p className={`col-span-2 text-[10px] ${isDarkMode ? 'text-white/45' : 'text-gray-500'}`}>
                {vt.wanAnimateNoPromptHint}
              </p>
            )}
          </div>
        ) : isLtx23MsrStoryboardUi ? (
          <div className="grid grid-cols-[minmax(0,1fr)_240px] gap-x-3 gap-y-1">
            <div className="h-[30px] flex items-center gap-2 min-w-0">
              <label className={`text-xs font-medium shrink-0 ${isDarkMode ? 'text-white/80' : 'text-gray-900'}`}>
                {vt.promptVideoDesc}
              </label>
              {isLtx23MsrAv && renderConnectedAudioEmptyHint('required')}
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
            <div className="min-w-0 flex flex-col gap-1.5">
              {isLtx23MsrAv ? renderConnectedAudioThumbs() : null}
              {renderPromptRichField({
                className: 'h-[112px]',
                placeholder: vt.placeholderVideoPrompt,
              })}
            </div>
            <div className={`rounded-lg border p-1.5 h-[112px] overflow-hidden flex flex-col nodrag nopan ${
              isDarkMode ? 'border-gray-600/40 bg-black/20' : 'border-gray-300/60 bg-white/60'
            }`}>
              <div className={`text-[9px] mb-1 shrink-0 leading-snug ${
                isDarkMode ? 'text-white/45' : 'text-gray-500'
              }`}>
                带
                <span className={`font-semibold ${isDarkMode ? 'text-rose-400/90' : 'text-rose-600'}`}>必填</span>
                的槽位须上传；分镜3、4 选填；拖动互换；选中后按 Delete 断开连线
              </div>
              <div className="grid grid-cols-5 gap-0.5 items-start w-full shrink-0 nodrag nopan">
                {/* 背景槽：9:16 竖版，下方留白 */}
                <div
                  className={`min-h-0 rounded transition-colors nodrag nopan ${
                    dragOverBackground ? 'ring-1 ring-green-400/80' : ''
                  }`}
                  onDragOver={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
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
                      onMouseDown={(e) => e.stopPropagation()}
                      onDragStart={(e) => handleHdrDragStart('background', e)}
                      onDragEnd={(e) => finalizeThumbDrag(e)}
                      className={`group relative w-full aspect-[9/16] rounded overflow-hidden border cursor-grab active:cursor-grabbing nodrag nopan ${
                        isDraggingThumb && hdrDragSourceRef.current === 'background'
                          ? 'border-dashed border-white/40 opacity-50'
                          : selectedHdrSlotIndex === 0
                            ? 'border-violet-400 ring-2 ring-violet-400/80'
                            : 'border-amber-500/60 hover:border-amber-400'
                      }`}
                      title="背景：拖动互换；单击选中后 Delete 断开连线；双击移回分镜"
                      onClick={(e) => {
                        e.stopPropagation();
                        if (thumbDragDidReorderRef.current) {
                          thumbDragDidReorderRef.current = false;
                          return;
                        }
                        setSelectedHdrSlotIndex(0);
                      }}
                      onDoubleClick={(e) => {
                        e.stopPropagation();
                        demoteBackgroundToStoryboard();
                        setSelectedHdrSlotIndex(null);
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
                  const isSelected = selectedHdrSlotIndex === index + 1;
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
                        onClick={(e) => {
                          e.stopPropagation();
                          setSelectedHdrSlotIndex(index + 1);
                        }}
                        onDragOver={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          if (hdrDragSourceRef.current == null) return;
                          setDragOverIndex(index);
                        }}
                        onDragLeave={() => setDragOverIndex((prev) => (prev === index ? null : prev))}
                        onDrop={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          handleHdrDropOnStoryboard(index);
                          finalizeThumbDrag(e);
                        }}
                        className={`w-full aspect-[9/16] rounded border border-dashed flex flex-col items-center justify-center gap-0.5 text-[8px] nodrag nopan ${
                          isDropTarget
                            ? 'border-green-400 ring-2 ring-green-400/90 text-green-300'
                            : isSelected
                              ? 'border-violet-400 ring-2 ring-violet-400/70'
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
                      key={`slot-${index}`}
                      type="button"
                      draggable
                      onMouseDown={(e) => e.stopPropagation()}
                      onDragStart={(e) => handleHdrDragStart(index, e)}
                      onDragOver={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        if (hdrDragSourceRef.current == null) return;
                        if (hdrDragSourceRef.current !== 'background' && hdrDragSourceRef.current === index) return;
                        setDragOverIndex(index);
                      }}
                      onDragLeave={() => setDragOverIndex((prev) => (prev === index ? null : prev))}
                      onDrop={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        handleHdrDropOnStoryboard(index);
                        finalizeThumbDrag(e);
                      }}
                      onDragEnd={(e) => finalizeThumbDrag(e)}
                      onClick={(e) => {
                        e.stopPropagation();
                        if (thumbDragDidReorderRef.current) {
                          thumbDragDidReorderRef.current = false;
                          return;
                        }
                        setSelectedHdrSlotIndex(index + 1);
                      }}
                      onDoubleClick={(e) => {
                        e.stopPropagation();
                        assignHdrBackground(trimmed);
                        setSelectedHdrSlotIndex(0);
                      }}
                      className={`group relative w-full aspect-[9/16] rounded overflow-hidden border cursor-grab active:cursor-grabbing nodrag nopan ${
                        isDropTarget
                          ? 'border-green-400 ring-2 ring-green-400/90'
                          : isSelected
                            ? 'border-violet-400 ring-2 ring-violet-400/80'
                          : isDragSource
                            ? 'border-white/30 border-dashed opacity-40'
                            : isRequiredSlot
                              ? isDarkMode
                                ? 'border-sky-500/50 hover:border-sky-400'
                                : 'border-sky-400/70 hover:border-sky-500'
                              : 'border-white/20 hover:border-green-500'
                      }`}
                      style={{
                        boxShadow: isDropTarget || isSelected ? '0 0 0 1px rgba(167,139,250,0.45)' : undefined,
                        zIndex: isDragSource || isDropTarget || isSelected ? 10 : 1,
                      }}
                      title={`分镜 ${index + 1}${isRequiredSlot ? '（必填）' : '（选填）'}：拖动互换；单击选中后 Delete 断开；双击设为背景`}
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
            <div className="h-[30px] flex items-center gap-2 min-w-0 w-full">
              <label
                className={`text-xs font-medium shrink-0 ${
                  isDarkMode ? 'text-white/80' : 'text-gray-900'
                }`}
              >
                {isLtx23LipsyncModel ? vt.promptAction : vt.promptVideoDesc}
              </label>
            </div>
            <div className={`h-[30px] flex items-center text-xs font-medium ${
              isDarkMode ? 'text-white/80' : 'text-gray-900'
            }`}>
              {isMinimaxH3MultiModel
                ? vt.minimaxH3MultiRefColumn
                : showAudioRefUi && resolvedConnectedAudios.length > 0
                  ? `${vt.refImageColumn} / ${vt.refAudioColumn}`
                  : vt.refImageColumn}
            </div>
            <div className="min-w-0">
              {renderSeedanceMentionThumbs()}
              {renderPromptRichField({
                className:
                  isSeedanceModel && seedanceMentionIndices.length > 0 ? 'h-[88px]' : 'h-[112px]',
                placeholder: isLtx23LipsyncModel ? vt.defaultLipsyncAction : vt.placeholderVideoPrompt,
              })}
            </div>
            <div className="min-w-0 flex flex-col gap-1.5">
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
                    const isPillHoverMatch = hoveredRefFromPillIndex === index;
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
                        if (isDraggingThumb || thumbDragDidReorderRef.current) {
                          thumbDragDidReorderRef.current = false;
                          return;
                        }
                        appendRefImageMentionToPrompt(index + 1);
                      }}
                      className={`relative w-full overflow-visible ${
                        orderedInputImages.length <= 2 ? 'h-full' : 'aspect-square'
                      } rounded-md border transition-all cursor-grab active:cursor-grabbing ${
                        isDropTarget
                          ? 'border-green-400 ring-2 ring-green-400/90'
                          : isDragSource
                            ? 'border-white/30 border-dashed opacity-40'
                            : 'border-white/20 hover:border-green-500'
                      }`}
                      style={{
                        boxShadow: isDropTarget ? '0 0 0 1px rgba(74,222,128,0.45)' : undefined,
                        zIndex: isDragSource || isDropTarget || isPillHoverMatch ? 10 : 1,
                      }}
                    >
                      <RefImageHoverThumb
                        url={url}
                        alt={vt.refImageThumbAlt(index + 1)}
                        title={
                          isSeedanceModel
                            ? vt.seedanceRefImageThumbTitle(index + 1)
                            : vt.refImageThumbTitle(index + 1)
                        }
                        indexLabel={index + 1}
                        objectFit="contain"
                        className="h-full w-full overflow-visible rounded-md"
                        previewDisabled={isDraggingThumb}
                        emphasize={isPillHoverMatch}
                        onRemove={() => {
                          const removed = String(url || '').trim();
                          const next = latestOrderedImagesRef.current.filter((_, i) => i !== index);
                          latestOrderedImagesRef.current = next;
                          setOrderedInputImages(next);
                          onDisconnectHdrSlotImage?.(removed);
                          onInputImagesOrderChange?.(next);
                        }}
                      />
                    </button>
                    );
                  })}
                </div>
              </div>
              {showAudioRefUi ? (
                <div className="min-w-0 flex flex-col gap-1">
                  {renderConnectedAudioEmptyHint(audioRefMode)}
                  {renderConnectedAudioThumbs()}
                </div>
              ) : null}
            </div>
          </div>
        ) : (
          <>
            <div className="mb-1 h-[30px] flex-shrink-0 flex items-center gap-2 min-w-0 w-full">
              <label
                className={`text-xs font-medium shrink-0 ${
                  isDarkMode ? 'text-white/80' : 'text-gray-900'
                }`}
              >
                {vt.promptVideoDesc}
              </label>
            </div>
            {showAudioRefUi ? (
              <div className="mb-1.5 flex flex-wrap items-center gap-1.5 min-w-0">
                {renderConnectedAudioEmptyHint(audioRefMode)}
                {renderConnectedAudioThumbs()}
              </div>
            ) : null}
            <div className="min-w-0">
              {renderPromptRichField({
                className: 'h-[112px]',
                placeholder: vt.placeholderVideoPrompt,
              })}
            </div>
          </>
        )}
      </div>

{!isHeyGemModel && (
      <>
      {/* 底部工具条：与 ImageInputPanel 同构 */}
      <div className="mt-1 flex items-center gap-1.5 flex-shrink-0 min-w-0">
        {/* 左侧：参数（模型 / 比例 / 时长 / 分辨率等） */}
        <div className="flex items-center gap-1.5 min-w-0 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
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
          <PanelOptionDropdown
            value={model}
            options={videoModelDropdownOptions}
            isDarkMode={isDarkMode}
            title={vt.chooseModelTitle}
            minWidthPx={148}
            menuPlacement="up"
            onChange={(newModelRaw) => {
              const newModel = newModelRaw as VideoInputPanelProps['model'];
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
              } else if (newModel === 'rhart-v3.1-pro-se') {
                if (onResolutionRhartV31Change) onResolutionRhartV31Change('1080p');
                if (onAspectRatioChange) onAspectRatioChange('16:9');
              } else if (newModel === 'rhart-video-x') {
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
              } else if (
                newModel === 'minimax-h3-t2v' ||
                newModel === 'minimax-h3-i2v' ||
                newModel === 'minimax-h3-multi' ||
                newModel === 'minimax-h3-audio'
              ) {
                if (onDurationMinimaxH3Change) {
                  // 口型同步默认先按保守 20s，连上参考音后由探测 effect 覆盖
                  onDurationMinimaxH3Change(newModel === 'minimax-h3-audio' ? '20' : '10');
                }
                if (onResolutionMinimaxH3Change) onResolutionMinimaxH3Change('720p');
                if (onAspectRatioChange) onAspectRatioChange('16:9');
              } else if (newModel === 'ltx-2.3-hdr-multi' || newModel === LTX23_MSR_AV_MODEL_ID) {
                if (onDurationLtx23HdrMultiChange) {
                  onDurationLtx23HdrMultiChange(newModel === LTX23_MSR_AV_MODEL_ID ? '10' : '15');
                }
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
              } else if (newModel === 'wan-animate' || newModel === 'wan-animate-2') {
                if (onResolutionWanAnimateChange) onResolutionWanAnimateChange('720p');
                if (onWanAnimateClipSecChange) onWanAnimateClipSecChange('8');
              } else if (newModel === 'seedance-2.0-mini' || newModel === 'seedance-2.0-fast') {
                onResolutionSeedanceChange?.(
                  coerceSeedanceResolution(resolutionSeedance, newModel),
                );
                onDurationSeedanceChange?.(normalizeSeedanceDurationChoice(durationSeedance, 10));
                if (onAspectRatioChange) {
                  onAspectRatioChange(coerceSeedanceRatio(aspectRatio));
                }
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
          />
          )}

          {/* LTX2.3 对口型：API 档 720/1280/1920，展示与 LTX 图生一致为 720p/1280/1920 */}
          {isLtx23LipsyncModel && (
            <>
              <span className={`text-xs ${isDarkMode ? 'text-white/70' : 'text-gray-700'}`}>{vt.resolutionLabel}</span>
              <PanelOptionDropdown
                value={resolutionLtx23Lipsync}
                options={[
                  { value: '720', label: vt.resStandard720p },
                  { value: '1280', label: vt.resHD1280 },
                  { value: '1920', label: vt.resUHD1920 },
                ]}
                onChange={(v) => onResolutionLtx23LipsyncChange?.(v as '720' | '1280' | '1920')}
                isDarkMode={isDarkMode}
                title={vt.titleLtxLipsyncResolution}
                minWidthPx={88}
                menuPlacement="up"
              />
            </>
          )}

          {/* LTX2.3 图生视频：时长 5|10|15 秒，分辨率 标准720P/高清1280/超清1920，比例 16:9|9:16 */}
          {isLtx23I2vModel && (
            <>
              <span className={`text-xs ${isDarkMode ? 'text-white/70' : 'text-gray-700'}`}>{vt.durationLabel}</span>
              <PanelOptionDropdown
                value={durationLtx23I2v}
                options={[
                  { value: '5', label: vt.secSuffix(5) },
                  { value: '10', label: vt.secSuffix(10) },
                  { value: '15', label: vt.secSuffix(15) },
                ]}
                onChange={(v) => onDurationLtx23I2vChange?.(v as '5' | '10' | '15')}
                isDarkMode={isDarkMode}
                title={vt.titleLtxI2vDuration}
                minWidthPx={72}
                menuPlacement="up"
              />
              <span className={`text-xs ${isDarkMode ? 'text-white/70' : 'text-gray-700'}`}>{vt.resolutionLabel}</span>
              <PanelOptionDropdown
                value={resolutionLtx23I2v}
                options={[
                  { value: '720', label: vt.resStandard720p },
                  { value: '1280', label: vt.resHD1280 },
                  { value: '1920', label: vt.resUHD1920 },
                ]}
                onChange={(v) => onResolutionLtx23I2vChange?.(v as '720' | '1280' | '1920')}
                isDarkMode={isDarkMode}
                title={vt.titleLtxI2vResolution}
                minWidthPx={88}
                menuPlacement="up"
              />
            </>
          )}

          {/* LTX2.3 文生视频：时长、分辨率、比例（需换算宽高传入） */}
          {isLtx23T2vModel && (
            <>
              <span className={`text-xs ${isDarkMode ? 'text-white/70' : 'text-gray-700'}`}>{vt.durationLabel}</span>
              <PanelOptionDropdown
                value={durationLtx23T2v}
                options={[
                  { value: '5', label: vt.secSuffix(5) },
                  { value: '10', label: vt.secSuffix(10) },
                  { value: '15', label: vt.secSuffix(15) },
                ]}
                onChange={(v) => onDurationLtx23T2vChange?.(v as '5' | '10' | '15')}
                isDarkMode={isDarkMode}
                title={vt.titleLtxT2vDuration}
                minWidthPx={72}
                menuPlacement="up"
              />
              <span className={`text-xs ${isDarkMode ? 'text-white/70' : 'text-gray-700'}`}>{vt.resolutionLabel}</span>
              <PanelOptionDropdown
                value={resolutionLtx23T2v}
                options={[
                  { value: '720', label: vt.resStandard720p },
                  { value: '1280', label: vt.resHD1280 },
                  { value: '1920', label: vt.resUHD1920 },
                ]}
                onChange={(v) => onResolutionLtx23T2vChange?.(v as '720' | '1280' | '1920')}
                isDarkMode={isDarkMode}
                title={vt.titleLtxT2vResolution}
                minWidthPx={88}
                menuPlacement="up"
              />
              <span className={`text-xs ${isDarkMode ? 'text-white/70' : 'text-gray-700'}`}>{vt.aspectRatioLabel}</span>
              <PanelOptionDropdown
                value={aspectRatio}
                options={[
                  { value: '16:9', label: vt.aspect169Landscape },
                  { value: '9:16', label: vt.aspect916Portrait },
                ]}
                onChange={(v) => onAspectRatioChange(v as '16:9' | '9:16')}
                isDarkMode={isDarkMode}
                title={vt.titleLtxT2vAspect}
                minWidthPx={88}
                menuPlacement="up"
              />
            </>
          )}

          {/* MiniMax-H3：文生/图生/多参可选时长；口型同步不展示计费档 UI（后台仍按参考音向上取整计费） */}
          {isMinimaxH3Model && (
            <>
              {isMinimaxH3DurationModel && (
                <>
                  <span className={`text-xs ${isDarkMode ? 'text-white/70' : 'text-gray-700'}`}>{vt.durationLabel}</span>
                  <PanelOptionDropdown
                    value={
                      ['6', '10', '15', '20'].includes(String(durationMinimaxH3))
                        ? durationMinimaxH3
                        : '10'
                    }
                    options={[
                      { value: '6', label: vt.secSuffix(6) },
                      { value: '10', label: vt.secSuffix(10) },
                      { value: '15', label: vt.secSuffix(15) },
                      { value: '20', label: vt.secSuffix(20) },
                    ]}
                    onChange={(v) => onDurationMinimaxH3Change?.(v as '6' | '10' | '15' | '20')}
                    isDarkMode={isDarkMode}
                    title={vt.titleMinimaxH3Duration}
                    minWidthPx={72}
                    menuPlacement="up"
                  />
                </>
              )}
              <span className={`text-xs ${isDarkMode ? 'text-white/70' : 'text-gray-700'}`}>{vt.resolutionLabel}</span>
              <PanelOptionDropdown
                value="720p"
                options={[{ value: '720p', label: '720P' }]}
                onChange={(v) => onResolutionMinimaxH3Change?.(v as '720p')}
                isDarkMode={isDarkMode}
                title={vt.titleMinimaxH3Resolution}
                minWidthPx={72}
                menuPlacement="up"
              />
              <span className={`text-xs ${isDarkMode ? 'text-white/70' : 'text-gray-700'}`}>{vt.aspectRatioLabel}</span>
              <PanelOptionDropdown
                value={
                  ['1:1', '2:3', '3:2', '3:4', '4:3', '9:16', '16:9', '21:9'].includes(aspectRatio)
                    ? aspectRatio
                    : '16:9'
                }
                options={[
                  { value: '16:9', label: '16:9' },
                  { value: '9:16', label: '9:16' },
                  { value: '1:1', label: '1:1' },
                  { value: '4:3', label: '4:3' },
                  { value: '3:4', label: '3:4' },
                  { value: '3:2', label: '3:2' },
                  { value: '2:3', label: '2:3' },
                  { value: '21:9', label: '21:9' },
                ]}
                onChange={(v) =>
                  onAspectRatioChange(
                    v as '16:9' | '9:16' | '1:1' | '2:3' | '3:2' | '4:3' | '3:4' | '21:9',
                  )
                }
                isDarkMode={isDarkMode}
                title={vt.titleMinimaxH3Aspect}
                minWidthPx={72}
                menuPlacement="up"
              />
            </>
          )}

          {isLtx23MsrStoryboardUi && (
            <>
              <span className={`text-xs ${isDarkMode ? 'text-white/70' : 'text-gray-700'}`}>{vt.durationLabel}</span>
              <PanelOptionDropdown
                value={durationLtx23HdrMulti}
                options={[
                  { value: '5', label: vt.secSuffix(5) },
                  { value: '10', label: vt.secSuffix(10) },
                  { value: '15', label: vt.secSuffix(15) },
                ]}
                onChange={(v) => onDurationLtx23HdrMultiChange?.(v as '5' | '10' | '15')}
                isDarkMode={isDarkMode}
                minWidthPx={72}
                menuPlacement="up"
              />
              <span className={`text-xs ${isDarkMode ? 'text-white/70' : 'text-gray-700'}`}>{vt.resolutionLabel}</span>
              <PanelOptionDropdown
                value={resolutionLtx23HdrMulti}
                options={[
                  { value: '720', label: vt.resStandard720p },
                  { value: '1280', label: vt.resHD1280 },
                ]}
                onChange={(v) => onResolutionLtx23HdrMultiChange?.(v as '720' | '1280')}
                isDarkMode={isDarkMode}
                minWidthPx={88}
                menuPlacement="up"
              />
              <span className={`text-xs ${isDarkMode ? 'text-white/70' : 'text-gray-700'}`}>{vt.aspectRatioLabel}</span>
              <PanelOptionDropdown
                value={aspectRatio === '9:16' ? '9:16' : '16:9'}
                options={[
                  { value: '16:9', label: vt.aspect169Landscape },
                  { value: '9:16', label: vt.aspect916Portrait },
                ]}
                onChange={(v) => onAspectRatioChange(v as '16:9' | '9:16')}
                isDarkMode={isDarkMode}
                minWidthPx={88}
                menuPlacement="up"
              />
            </>
          )}

          {!isLtx23LipsyncModel && !isLtx23I2vModel && !isLtx23T2vModel && !isMinimaxH3Model && !isLtx23HdrMultiModel && !isLtx23MsrAv && !isWanAnimateFamily && !isRhartVideoUpscaler && !isHeyGemModel && !isSeedanceModel && !isGeminiOmniFamily && !isGrok3StableModel && (
          <>
          <span
            className={`text-xs ${
              isDarkMode ? 'text-white/70' : 'text-gray-700'
            }`}
          >
            {vt.aspectRatioLabel}
          </span>
            <PanelOptionDropdown
            value={aspectRatio}
            options={
              isRhartVideoXModel
                ? [
                    { value: '2:3', label: '2:3' },
                    { value: '3:2', label: '3:2' },
                    { value: '1:1', label: vt.aspect11Square },
                    { value: '16:9', label: vt.aspect169Landscape },
                    { value: '9:16', label: vt.aspect916Portrait },
                  ]
                : [
                    { value: '16:9', label: vt.aspect169Landscape },
                    { value: '9:16', label: vt.aspect916Portrait },
                    ...(isKlingModel || isKlingVideoO1Model || isKlingVideoO1I2vModel || isKlingVideoO1StartEndModel || isKlingVideoO1RefModel
                      ? [{ value: '1:1', label: vt.aspect11Square }]
                      : []),
                  ]
            }
            onChange={(v) => onAspectRatioChange(v as '16:9' | '9:16' | '1:1' | '2:3' | '3:2')}
            isDarkMode={isDarkMode}
            title={vt.chooseAspectTitle}
            minWidthPx={88}
            menuPlacement="up"
          />
          </>
          )}

          {isRhartVideoXModel && (
            <>
              <span className={`text-xs ${isDarkMode ? 'text-white/70' : 'text-gray-700'}`}>{vt.durationLabel}</span>
              <PanelOptionDropdown
                value={normalizeRhartVideoXDurationStr(durationGrok3, '10')}
                options={RHART_VIDEO_X_DURATION_SEC_OPTIONS.map((s) => ({
                  value: String(s),
                  label: `${s}s`,
                }))}
                onChange={(v) => onDurationGrok3Change?.(v)}
                isDarkMode={isDarkMode}
                title="全能视频X：6 / 8 / 10 / 15 / 30 秒"
                minWidthPx={72}
                menuPlacement="up"
              />
              <span className={`text-xs ${isDarkMode ? 'text-white/70' : 'text-gray-700'}`}>{vt.resolutionLabel}</span>
              <PanelOptionDropdown
                value="720p"
                options={[{ value: '720p', label: '720p' }]}
                onChange={() => onResolutionGrok3Change?.('720p')}
                isDarkMode={isDarkMode}
                title="全能视频X：720p"
                minWidthPx={72}
                menuPlacement="up"
              />
            </>
          )}

          {isGrok3StableModel && (
            <>
              <span className={`text-xs ${isDarkMode ? 'text-white/70' : 'text-gray-700'}`}>{vt.durationLabel}</span>
              <PanelOptionDropdown
                value={normalizeGrok3StableDurationStr(durationGrok3, '10')}
                options={GROK3_STABLE_DURATION_SEC_OPTIONS.map((s) => ({
                  value: String(s),
                  label: `${s}s`,
                }))}
                onChange={(v) => onDurationGrok3Change?.(v)}
                isDarkMode={isDarkMode}
                title="Grok video3 plus：6s / 10s"
                minWidthPx={72}
                menuPlacement="up"
              />
              <span className={`text-xs ${isDarkMode ? 'text-white/70' : 'text-gray-700'}`} title="Grok video3 plus 固定 720p">
                720p
              </span>
            </>
          )}

          {/* 海螺-02/2.3 文生、海螺-02 图生视频标准：时长 6/10 秒 */}
          {(isHailuo02Model || isHailuo23Model || isHailuo02I2vModel || isHailuo23I2vModel) && (
            <>
              <span className={`text-xs ${isDarkMode ? 'text-white/70' : 'text-gray-700'}`}>{vt.durationLabel}</span>
              <PanelOptionDropdown
                value={durationHailuo02}
                options={[
                  { value: '6', label: '6s' },
                  { value: '10', label: '10s' },
                ]}
                onChange={(v) => onDurationHailuo02Change?.(v as '6' | '10')}
                isDarkMode={isDarkMode}
                title={vt.titleHailuoDuration}
                minWidthPx={72}
                menuPlacement="up"
              />
            </>
          )}

          {/* 可灵文生视频o1：时长 5/10 秒，模式 std/pro */}
          {/* 可灵文生/图生/首尾帧/参考生视频o1：时长 5/10 秒，模式 std/pro */}
          {(isKlingVideoO1Model || isKlingVideoO1I2vModel || isKlingVideoO1StartEndModel || isKlingVideoO1RefModel) && (
            <>
              <span className={`text-xs ${isDarkMode ? 'text-white/70' : 'text-gray-700'}`}>{vt.durationLabel}</span>
              <PanelOptionDropdown
                value={durationKlingO1}
                options={[
                  { value: '5', label: '5s' },
                  { value: '10', label: '10s' },
                ]}
                onChange={(v) => onDurationKlingO1Change?.(v as '5' | '10')}
                isDarkMode={isDarkMode}
                title={vt.titleKlingO1Duration}
                minWidthPx={72}
                menuPlacement="up"
              />
              <span className={`text-xs ${isDarkMode ? 'text-white/70' : 'text-gray-700'}`}>{vt.klingModeLabel}</span>
              <PanelOptionDropdown
                value={modeKlingO1}
                options={[
                  { value: 'std', label: 'std' },
                  { value: 'pro', label: 'pro' },
                ]}
                onChange={(v) => onModeKlingO1Change?.(v as 'std' | 'pro')}
                isDarkMode={isDarkMode}
                title={vt.titleKlingO1Mode}
                minWidthPx={64}
                menuPlacement="up"
              />
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
              <PanelOptionDropdown
                value={resolutionRhartV31}
                options={[
                  { value: '720p', label: '720p' },
                  { value: '1080p', label: '1080p' },
                  { value: '4k', label: '4k' },
                ]}
                onChange={(v) => onResolutionRhartV31Change?.(v as '720p' | '1080p' | '4k')}
                isDarkMode={isDarkMode}
                title={vt.titleOutputResolution}
                minWidthPx={80}
                menuPlacement="up"
              />
              {(isRhartV31ProModel || isRhartV31ProSEModel) && (
                <span className={`text-xs ${isDarkMode ? 'text-white/70' : 'text-gray-700'}`}>{vt.durationFixed8s}</span>
              )}
            </>
          )}

          {/* LTX2.3（首位帧）：分辨率 720p/1080p/1920p（最高 1920p，非 4K）+ 时长 5/10/15 秒 */}
          {isRhVideoStartEndModel && (
            <>
              <span className={`text-xs ${isDarkMode ? 'text-white/70' : 'text-gray-700'}`}>{vt.resolutionLabel}</span>
              <PanelOptionDropdown
                value={(() => {
                  const r = String(resolutionRhartV31 || '').toLowerCase();
                  if (r === '720' || r === '720p') return '720p';
                  if (r === '1920' || r === '1920p' || r === '4k' || r === '2160p') return '1920p';
                  return '1080p';
                })()}
                options={[
                  { value: '720p', label: '720p' },
                  { value: '1080p', label: '1080p' },
                  { value: '1920p', label: '1920p' },
                ]}
                onChange={(v) => onResolutionRhartV31Change?.(v as '720p' | '1080p' | '1920p')}
                isDarkMode={isDarkMode}
                title="720p / 1080p / 1920p（最高 1920p，非 4K）"
                minWidthPx={80}
                menuPlacement="up"
              />
              <span className={`text-xs ${isDarkMode ? 'text-white/70' : 'text-gray-700'}`}>{vt.durationLabel}</span>
              <PanelOptionDropdown
                value={duration === '15' ? '15' : duration === '10' ? '10' : '5'}
                options={[
                  { value: '5', label: '5s' },
                  { value: '10', label: '10s' },
                  { value: '15', label: '15s' },
                ]}
                onChange={(v) => onDurationChange(v as '5' | '10' | '15' | '25')}
                isDarkMode={isDarkMode}
                title={vt.durationChooseTitle}
                minWidthPx={72}
                menuPlacement="up"
              />
            </>
          )}

          {/* 视频超分放大：目标分辨率 */}
          {isRhartVideoUpscaler && (
            <>
              <span className={`text-xs ${isDarkMode ? 'text-white/70' : 'text-gray-700'}`}>{vt.resolutionLabel}</span>
              <PanelOptionDropdown
                value={targetResolution}
                options={[
                  { value: '720p', label: '720P' },
                  { value: '1080p', label: '1080P' },
                  { value: '2k', label: '2K' },
                  { value: '4k', label: '4K' },
                ]}
                onChange={(v) => onTargetResolutionChange?.(v as '720p' | '1080p' | '2k' | '4k')}
                isDarkMode={isDarkMode}
                title="目标分辨率：720P / 1080P / 2K / 4K"
                minWidthPx={80}
                menuPlacement="up"
              />
            </>
          )}

          {/* WanAnimate：分辨率 + 片段；Wan animate2：仅分辨率（按时长按原视频秒数计费） */}
          {isWanAnimateFamily && (
            <>
              <span className={`text-xs ${isDarkMode ? 'text-white/70' : 'text-gray-700'}`}>{vt.resolutionLabel}</span>
              <PanelOptionDropdown
                value={resolutionWanAnimate}
                options={[
                  { value: '720p', label: '720P' },
                  { value: '1080p', label: '1080P' },
                ]}
                onChange={(v) => onResolutionWanAnimateChange?.(v as '720p' | '1080p')}
                isDarkMode={isDarkMode}
                title={vt.titleWanAnimateResolution}
                minWidthPx={80}
                menuPlacement="up"
              />
              {isWanAnimateModel ? (
                <>
                  <span className={`text-xs ${isDarkMode ? 'text-white/70' : 'text-gray-700'}`}>{vt.durationLabel}</span>
                  <PanelOptionDropdown
                    value={wanAnimateClipSec}
                    options={[
                      { value: '5', label: '5s' },
                      { value: '8', label: '8s' },
                      { value: '10', label: '10s' },
                      { value: '15', label: '15s' },
                    ]}
                    onChange={(v) => onWanAnimateClipSecChange?.(v as '5' | '8' | '10' | '15')}
                    isDarkMode={isDarkMode}
                    title={vt.titleWanAnimateClip}
                    minWidthPx={72}
                    menuPlacement="up"
                  />
                </>
              ) : null}
            </>
          )}

          {isSeedanceModel && (
            <>
              <span className={`text-xs ${isDarkMode ? 'text-white/70' : 'text-gray-700'}`}>{vt.resolutionLabel}</span>
              <PanelOptionDropdown
                value={coerceSeedanceResolution(resolutionSeedance, model)}
                options={[
                  ...(isSeedanceMiniModel ? [{ value: '480p', label: '480P' }] : []),
                  { value: '720p', label: '720P' },
                  { value: '1080p', label: '1080P' },
                  ...(isSeedanceMiniModel
                    ? [
                        { value: '2k', label: '2K' },
                        { value: '4k', label: '4K' },
                      ]
                    : []),
                ]}
                onChange={(v) => onResolutionSeedanceChange?.(v as '480p' | '720p' | '1080p' | '2k' | '4k')}
                isDarkMode={isDarkMode}
                title={isSeedanceMiniModel ? '480P / 720P / 1080P / 2K / 4K' : vt.titleSeedanceResolution}
                minWidthPx={80}
                menuPlacement="up"
              />
              <span className={`text-xs ${isDarkMode ? 'text-white/70' : 'text-gray-700'}`}>{vt.durationLabel}</span>
              <PanelOptionDropdown
                value={normalizeSeedanceDurationChoice(durationSeedance, 10)}
                options={SEEDANCE_DURATION_SEC_OPTIONS.map((sec) => ({
                  value: String(sec),
                  label: vt.secSuffix(sec),
                }))}
                onChange={(v) => onDurationSeedanceChange?.(v as '5' | '10' | '15')}
                isDarkMode={isDarkMode}
                title={vt.titleSeedanceDuration}
                minWidthPx={72}
                menuPlacement="up"
              />
              <span className={`text-xs ${isDarkMode ? 'text-white/70' : 'text-gray-700'}`}>{vt.aspectRatioLabel}</span>
              <PanelOptionDropdown
                value={coerceSeedanceRatio(aspectRatio)}
                options={SEEDANCE_RATIO_OPTIONS.map((r) => ({
                  value: r,
                  label: r === 'adaptive' ? vt.aspectAdaptive : r,
                }))}
                onChange={(v) =>
                  onAspectRatioChange(
                    v as 'adaptive' | '16:9' | '4:3' | '1:1' | '3:4' | '9:16' | '21:9',
                  )
                }
                isDarkMode={isDarkMode}
                title={vt.titleSeedanceRatio}
                minWidthPx={88}
                menuPlacement="up"
              />
            </>
          )}

          {isGeminiOmniFamily && (
            <>
              <span className={`text-xs ${isDarkMode ? 'text-white/70' : 'text-gray-700'}`}>{vt.resolutionLabel}</span>
              <PanelOptionDropdown
                value={resolutionGeminiOmni}
                options={[
                  { value: '720p', label: '720p' },
                  { value: '1080p', label: '1080p' },
                  { value: '4k', label: '4k' },
                ]}
                onChange={(v) => onResolutionGeminiOmniChange?.(v as '720p' | '1080p' | '4k')}
                isDarkMode={isDarkMode}
                title="720p / 1080p / 4k"
                minWidthPx={80}
                menuPlacement="up"
              />
              <span className={`text-xs ${isDarkMode ? 'text-white/70' : 'text-gray-700'}`}>{vt.durationLabel}</span>
              <PanelOptionDropdown
                value={
                  isGeminiOmniFlashModel
                    ? normalizeGeminiOmniFlashDurationChoice(durationGeminiOmni, 6)
                    : normalizeGeminiOmniDurationChoice(durationGeminiOmni, 6)
                }
                options={(isGeminiOmniFlashModel
                  ? GEMINI_OMNI_FLASH_DURATION_SEC_OPTIONS
                  : GEMINI_OMNI_DURATION_SEC_OPTIONS
                ).map((sec) => ({
                  value: String(sec),
                  label: vt.secSuffix(sec),
                }))}
                onChange={(v) => onDurationGeminiOmniChange?.(v as '6' | '8' | '10')}
                isDarkMode={isDarkMode}
                title="6s / 8s / 10s"
                minWidthPx={72}
                menuPlacement="up"
              />
              <span className={`text-xs ${isDarkMode ? 'text-white/70' : 'text-gray-700'}`}>{vt.aspectRatioLabel}</span>
              <PanelOptionDropdown
                value={aspectRatio === '9:16' ? '9:16' : '16:9'}
                options={[
                  { value: '16:9', label: vt.aspect169Landscape },
                  { value: '9:16', label: vt.aspect916Portrait },
                ]}
                onChange={(v) => onAspectRatioChange(v as '16:9' | '9:16')}
                isDarkMode={isDarkMode}
                minWidthPx={88}
                menuPlacement="up"
              />
            </>
          )}

          {/* Veo 3.1 Pro（官方图生）：分辨率 720p/1080p/4k，时长 4/6/8，可选生成音频 */}
          {isRhartV31ProOfficialI2vModel && (
            <>
              <span className={`text-xs ${isDarkMode ? 'text-white/70' : 'text-gray-700'}`}>{vt.resolutionLabel}</span>
              <PanelOptionDropdown
                value={resolutionRhartV31}
                options={[
                  { value: '720p', label: '720p' },
                  { value: '1080p', label: '1080p' },
                  { value: '4k', label: '4k' },
                ]}
                onChange={(v) => onResolutionRhartV31Change?.(v as '720p' | '1080p' | '4k')}
                isDarkMode={isDarkMode}
                title={vt.titleVeoResolution}
                minWidthPx={80}
                menuPlacement="up"
              />
              <span className={`text-xs ${isDarkMode ? 'text-white/70' : 'text-gray-700'}`}>{vt.durationLabel}</span>
              <PanelOptionDropdown
                value={durationVeo31ProOfficial}
                options={[
                  { value: '4', label: '4s' },
                  { value: '6', label: '6s' },
                  { value: '8', label: '8s' },
                ]}
                onChange={(v) => onDurationVeo31ProOfficialChange?.(v as '4' | '6' | '8')}
                isDarkMode={isDarkMode}
                title={vt.titleVeoDuration}
                minWidthPx={72}
                menuPlacement="up"
              />
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
          {!isWan26FlashModel && !isRhartV31FastModel && !isGrok3Model && !isRhartVideoXModel && !isGrok3StableModel && !isHailuo02Model && !isHailuo23Model && !isHailuo02I2vModel && !isHailuo23I2vModel && !isKlingVideoO1Model && !isKlingVideoO1I2vModel && !isKlingVideoO1StartEndModel && !isRhVideoStartEndModel && !isKlingVideoO1RefModel && !isRhartV31ProSEModel && !isRhartV31ProModel && !isRhartV31ProOfficialI2vModel && !isLtx23LipsyncModel && !isLtx23I2vModel && !isLtx23T2vModel && !isMinimaxH3Model && !isLtx23HdrMultiModel && !isLtx23MsrAv && !isWanAnimateFamily && !isRhartVideoUpscaler && !isHeyGemModel && !isSeedanceModel && !isGeminiOmniFamily && (
            <>
              <span
                className={`text-xs ${
                  isDarkMode ? 'text-white/70' : 'text-gray-700'
                }`}
              >
                {vt.durationLabel}
              </span>
              <PanelOptionDropdown
                value={isSora2ProModel ? (duration === '25' ? '25' : '15') : duration}
                options={
                  isSora2ProModel
                    ? [
                        { value: '15', label: '15s' },
                        { value: '25', label: '25s' },
                      ]
                    : isSora2Model
                      ? [
                          { value: '10', label: '10s' },
                          { value: '15', label: '15s' },
                        ]
                      : [
                          ...((isKlingModel || isWan26Model) ? [{ value: '5', label: '5s' }] : []),
                          { value: '10', label: '10s' },
                          ...(!isKlingModel ? [{ value: '15', label: '15s' }] : []),
                        ]
                }
                onChange={(v) => onDurationChange(v as '5' | '10' | '15' | '25')}
                isDarkMode={isDarkMode}
                title={vt.durationChooseTitle}
                minWidthPx={72}
                menuPlacement="up"
              />
              {(isSora2Model || isSora2ProModel) && (
                <PanelOptionDropdown
                  value={sora2Channel}
                  options={[
                    { value: 'plugin', label: vt.sora2Plugin },
                    { value: 'core', label: vt.sora2Core },
                  ]}
                  onChange={(v) => onSora2ChannelChange?.(v as 'plugin' | 'core')}
                  isDarkMode={isDarkMode}
                  title={vt.sora2ChannelTitle}
                  minWidthPx={88}
                  menuPlacement="up"
                />
              )}

            </>
          )}

          {/* 万相2.6：镜头类型 + 图生视频时显示分辨率 */}
          {isWan26Model && (
            <>
              <span className={`text-xs ${isDarkMode ? 'text-white/70' : 'text-gray-700'}`}>{vt.shotLabel}</span>
              <PanelOptionDropdown
                value={shotType}
                options={[
                  { value: 'single', label: vt.shotSingle },
                  { value: 'multi', label: vt.shotMulti },
                ]}
                onChange={(v) => onShotTypeChange?.(v as 'single' | 'multi')}
                isDarkMode={isDarkMode}
                title={vt.shotTitle}
                minWidthPx={80}
                menuPlacement="up"
              />
              {isImageToVideoMode && (
                <>
                  <span className={`text-xs ${isDarkMode ? 'text-white/70' : 'text-gray-700'}`}>{vt.resolutionLabel}</span>
                  <PanelOptionDropdown
                    value={resolutionWan26}
                    options={[
                      { value: '720p', label: '720p' },
                      { value: '1080p', label: '1080p' },
                    ]}
                    onChange={(v) => onResolutionWan26Change?.(v as '720p' | '1080p')}
                    isDarkMode={isDarkMode}
                    title={vt.titleWanI2vResolution}
                    minWidthPx={80}
                    menuPlacement="up"
                  />
                </>
              )}
            </>
          )}

          {/* 万相2.6 Flash 图生视频：第一行 时长、镜头、分辨率；第二行 生成音频 */}
          {isWan26FlashModel && (
            <div className="flex flex-col gap-1">
              <div className="flex items-center gap-2">
                <span className={`text-xs ${isDarkMode ? 'text-white/70' : 'text-gray-700'}`}>{vt.durationLabel}</span>
                <PanelOptionDropdown
                  value={durationWan26Flash}
                  options={([2,3,4,5,6,7,8,9,10,11,12,13,14,15] as const).map((n) => ({
                    value: String(n),
                    label: `${n}s`,
                  }))}
                  onChange={(v) => onDurationWan26FlashChange?.(v as '2'|'3'|'4'|'5'|'6'|'7'|'8'|'9'|'10'|'11'|'12'|'13'|'14'|'15')}
                  isDarkMode={isDarkMode}
                  title={vt.titleWanFlashDuration}
                  minWidthPx={72}
                  menuPlacement="up"
                />
                <span className={`text-xs ${isDarkMode ? 'text-white/70' : 'text-gray-700'}`}>{vt.shotLabel}</span>
                <PanelOptionDropdown
                  value={shotType}
                  options={[
                    { value: 'single', label: vt.shotSingle },
                    { value: 'multi', label: vt.shotMulti },
                  ]}
                  onChange={(v) => onShotTypeChange?.(v as 'single' | 'multi')}
                  isDarkMode={isDarkMode}
                  title={vt.shotTitle}
                  minWidthPx={80}
                  menuPlacement="up"
                />
                <span className={`text-xs ${isDarkMode ? 'text-white/70' : 'text-gray-700'}`}>{vt.resolutionLabel}</span>
                <PanelOptionDropdown
                  value={resolutionWan26}
                  options={[
                    { value: '720p', label: '720p' },
                    { value: '1080p', label: '1080p' },
                  ]}
                  onChange={(v) => onResolutionWan26Change?.(v as '720p' | '1080p')}
                  isDarkMode={isDarkMode}
                  title={vt.titleOutputResolution}
                  minWidthPx={80}
                  menuPlacement="up"
                />
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

        <div className="flex-1" />
        {((isMinimaxH3MultiModel &&
          (imageCount > 0 || hasAudioRef || hasVideoRef)) ||
          (isImageToVideoMode && imageCount > 0 && !isMinimaxH3MultiModel)) && (
          <span
            className={`text-[11px] font-medium px-2 py-0.5 rounded-full shrink-0 ${
              isDarkMode ? 'text-white/50 bg-white/10' : 'text-gray-500 bg-gray-100'
            }`}
            title={
              isMinimaxH3MultiModel
                ? vt.minimaxH3MultiRefTitle(
                    imageCount,
                    Math.min(3, resolvedConnectedAudios.length || (hasAudioRef ? 1 : 0)),
                  )
                : vt.refImagesTitle(imageCount, maxRefImagesVideo)
            }
          >
            {isMinimaxH3MultiModel
              ? vt.minimaxH3MultiRefBadge(
                  imageCount,
                  Math.min(3, resolvedConnectedAudios.length || (hasAudioRef ? 1 : 0)),
                )
              : vt.refImagesBadge(imageCount, maxRefImagesVideo)}
          </span>
        )}
        {videoPriceLabel.ok ? (
          <span
            className={`text-[11px] font-medium px-2 py-0.5 rounded-full shrink-0 tabular-nums border ${
              isDarkMode
                ? 'text-amber-200/90 bg-amber-500/15 border-amber-400/25'
                : 'text-amber-700 bg-amber-50 border-amber-200'
            }`}
            title={vt.priceTooltip}
          >
            {videoPriceLabel.value}
            {locale === 'en' ? ' ' : ''}
            {vt.creditsSuffix}
          </span>
        ) : (
          <span
            className={`text-[11px] font-medium px-2 py-0.5 rounded-full shrink-0 ${
              isDarkMode ? 'text-white/45 bg-white/10' : 'text-gray-500 bg-gray-100'
            }`}
            title={vt.noPricingTableTitle}
          >
            {vt.noPricingYet}
          </span>
        )}
        <button
          type="button"
          onClick={handleExecute}
          disabled={isRunDisabled}
          className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 transition-colors ${
            isRunDisabled
              ? isDarkMode
                ? 'bg-white/[0.08] text-white/25 cursor-not-allowed'
                : 'bg-black/[0.06] text-gray-400 cursor-not-allowed'
              : isRunBusy
                ? isImageToVideoMode
                  ? 'bg-purple-500/70 text-white cursor-not-allowed'
                  : isDarkMode
                    ? 'bg-white/70 text-black cursor-not-allowed'
                    : 'bg-gray-700 text-white cursor-not-allowed'
                : isImageToVideoMode
                  ? 'bg-purple-500 text-white hover:bg-purple-600'
                  : isDarkMode
                    ? 'bg-white text-black hover:bg-white/90'
                    : 'bg-gray-900 text-white hover:bg-gray-800'
          }`}
          title={modeLabel}
          aria-label={modeLabel}
        >
          {isRunBusy ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
          ) : (
            <ArrowUp className="w-3.5 h-3.5" strokeWidth={2.5} />
          )}
        </button>
      </div>
      </>
      )}
      </div>
      <AiGenerateDisclaimerTip isDarkMode={isDarkMode} />
    </div>
  );
};

export default VideoInputPanel;
