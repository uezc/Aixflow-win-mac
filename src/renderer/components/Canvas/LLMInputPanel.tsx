// @ts-nocheck
/* eslint-disable react/forbid-dom-props */
import React, { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import { Save, Play, Trash2, Loader2, ArrowUp, ChevronDown, ChevronUp, X } from 'lucide-react';
import { useAI } from '../../hooks/useAI';
import { isModelNotPricedError } from '../../utils/priceCalc';
import {
  getImageReverseDisplayPrice,
  getLlmChatDisplayPrice,
  getVideoAnalysisDisplayPrice,
  IMAGE_REVERSE_DEFAULT_MODEL,
  LLM_CHAT_DISPLAY_MODEL_ID,
  LLM_CHAT_MODEL_GPT56_TERRA,
  LLM_CHAT_MODEL_IDS,
  normalizeImageReverseCaptionModel,
  type ImageReverseCaptionModel,
} from '../../utils/cloudModelPricing';
import { useNxModelPricing } from '../../contexts/NxModelPricingContext';
import { useAppLocale } from '../../contexts/AppLocaleContext';
import { useDarkAlert } from '../../contexts/DarkAlertContext';
import { llmInputPanelT } from '../../i18n/llmInputPanelI18n';
import { audioInputPanelT } from '../../i18n/audioInputPanelI18n';
import { useCloudRealtimeDictation } from '../../hooks/useCloudRealtimeDictation';
import { useDictationPushToTalk } from '../../hooks/useDictationPushToTalk';
import { micLevelCssVars } from '../../utils/micInputLevel';
import { AiGenerateDisclaimerTip } from '../legal/AiGenerateDisclaimerTip';
import VoiceMicGlyph from './VoiceMicGlyph';

interface LLMInputPanelProps {
  nodeId: string;
  isDarkMode: boolean;
  inputText: string;
  userInput: string;
  // 当 true 且存在来自 Text 节点的连线时，底部"用户输入"框变为只读灰色，显示 Text 文本
  isInputLocked?: boolean;
  /** 是否有上游文本连入（显示标题标签；连线正文不进入底栏） */
  hasLinkedText?: boolean;
  /** 上游连入的正文，仅作为 user 消息发送，不填入底栏 */
  linkedInputText?: string;
  /** 上游文本节点标题（角标 + 输入区内标签） */
  linkedTextTitle?: string;
  savedPrompts: Array<{
    id: string;
    name: string;
    content: string;
  }>;
  isImageReverseMode?: boolean;
  imageUrlForReverse?: string;
  isVideoAnalysisMode?: boolean;
  videoUrlForAnalysis?: string;
  /** 图像反推模型：openai/gpt-5.6-terra | joy-caption-two（旧 gpt-4o 会规范为 Terra） */
  reverseCaptionModel?: ImageReverseCaptionModel;
  onReverseCaptionModelChange?: (value: ImageReverseCaptionModel) => void;
  projectId?: string;
  // 节点标题，用于资源保存
  nodeTitle?: string;
  onUserInputChange: (value: string) => void;
  onInputTextChange: (value: string) => void;
  onSavedPromptsChange: (prompts: Array<{ id: string; name: string; content: string }>) => void;
  onOutputTextChange: (text: string) => void;
  // 当选择的人设变化时，用于同步到 LLM 节点小标题
  onPersonaChange?: (personaName: string | null) => void;
  /** 点击运行立即调用，用于显示进度条动画 */
  onRunStart?: () => void;
  /** 普通对话选用的聊天模型（如 gpt-3.5-turbo） */
  chatModel?: string;
  onChatModelChange?: (model: string) => void;
}

import { STORYBOARD_SCRIPT_TEXT_ONLY_SYSTEM_PROMPT } from '../../../shared/storyboardScript';

/** LLM 快捷标签：点击可快速填入系统人设文案（按钮文案由 llmInputPanelT 提供） */
const LLM_QUICK_TAG_DEFS: { content: string; color: string }[] = [
  {
    color: 'bg-emerald-500/90 hover:bg-emerald-500 text-white border-emerald-400/50',
    content: `你是：
顶级导演 + 影视分镜师 + 叙事结构设计师 + SORA2 视频提示工程专家

你的唯一使命：
将用户输入的 小说片段 / 剧本 / 对话，自动拆解为【可直接用于 SORA2 文生视频】的专业级分镜稿。

你必须严格遵守以下全部规则执行，不得省略、不得解释。剧本中的对话不可省略。人物的外形穿着不用描述。

【用户可选参数】

用户在输入时可以选择：

视频片段时长 = 10 秒 / 15 秒（默认 15 秒）

你必须根据时长差异，自动调整镜头密度、运镜节奏与台词预留时间。

【镜头时长总控规则】

当用户选择 15 秒：

单镜头可容纳：

1 句中句台词（30～60 字）

或 2 句短句（≤30 字）

运镜允许完整展开（推进 / 拉远 / 过肩 / 环绕）

允许 1～2 秒情绪停留镜头（无台词）

总时长为15秒

当用户选择 10 秒：

单镜头原则：

1 句 = 1 镜头

运镜必须简化（推进或固定为主）

情绪停留 ≤0.5 秒

禁止同镜头内多次景别变化

总时长为10秒

【镜头数量计算规则（强制）】

① 基础镜头数
基础镜头 = 台词总字数 ÷ 40（向上取整）

② 按句强制拆镜头

每一句台词 = 至少 1 个镜头

45 字 = 必须独立镜头

80 字 = 拆为 2 个镜头（自然断点）

③ 最终镜头数
最终镜头数 = max（基础镜头数，按句镜头数）

【特殊台词长度处理】

≤30 字（短句）
→ 可与其他短句合并（仅限 15 秒模式）
→ 视频提示词中必须标明口型分段

30～60 字（中句）
→ 必须独立镜头

60 字（长句）
→ 拆为 2 个镜头

100 字（极长句）
→ 拆为 3 个镜头（强制）

所有台词：
不可修改、不可扩写、不可删减、不可重排
台词前必须用小括号标注说话人。

【镜头语言使用强制规则】

你必须根据台词功能，自动匹配镜头语言：

交代信息 → 中景 / 稳定镜头

情绪开始变化 → 近景 + 轻推

情绪明确 → 特写

决定 / 压迫 → 推镜特写

留白 / 结尾 → 拉远 / 全景

禁止无意义切镜。


【每个分镜固定输出结构（不可更改）】

分镜X
视频提示词：

【视频提示词生成规则】

每个视频提示词必须拆成 连续时间段（每段 2～2.5 秒），并包含：

镜头类型

运镜方式

人物动作（表情、呼吸、肢体）

光线特征

氛围

环境音

台词准确出现的时间点

示例结构（仅结构示例）：

0-2s：广角全景，建立环境……
2-4s：中景推进，人物进入画面……
4-6s：近景，人物开口说话（台词开始）
6-8s：特写，口型对应台词后半句……
8-10s：镜头轻推停留，呼吸声保留……

【场景拆解规则】

在生成任何镜头前，你必须先在脑中完成以下分析（不输出）：

时间

地点

光线来源

环境状态

人物站位与关系

并将其转化为可直接视觉生成的画面元素。

禁止抽象、不可视内容。


【人物一致性锁定规则】

同一角色：

外形

年龄

发型

服装

气质

在所有镜头中必须保持一致，不得变化。

【图片提示词规则（如需要）】

图片提示词只用于构图基准，必须包含：

具体场景位置

时间

光线来源

主体构图

景深

氛围

禁止使用抽象词（如“愤怒”“紧张”）。


【输出风格强制要求】

高度结构化、逻辑严谨、运镜连贯。
只输出用户要的镜头，不评价、不解释、不废话。
每个镜头的信息同行输出，不同镜头之间空一行，不要输出任何符号。

每个分镜头之间用"&&&"符号来分隔
每个分镜前，交代画风，场景信息
保持中文输出。
输出的内容必须符合Sora2和Nano banana2的内容规范。

案例：
分镜1
台词：中文
画风：仙侠CG动画
场景信息：
1. 妖域森林：幽暗、潮湿、发光植被、暴雨、泥泞、紫黑色调。
2. 木屋：简陋、温暖烛光、木质纹理、床榻、暧昧暖黄色调。
人物一致性设定：
1. 洛如缨（女主）：参考图1，白衣银饰，黑长直发，清冷高贵，衣衫带血污。
2. 宁夜辰（男主）：参考图4，黑袍，长发散落，剑眉星目，魔尊气质但目前伪装凡人。
3. 仙界使者1：参考图2，金甲壮汉，骑紫晶犀牛。
4. 仙界使者2：参考图3，银袍法师，骑金晶蝎。
视频提示词：
0-2s：低角度跟拍，暴雨夜，妖域森林地面泥泞，洛如缨（白衣）跌跌撞撞奔跑入画，衣摆破碎。
2-5s：近景侧拍，洛如缨面色苍白，嘴角带血，眼神涣散但坚定，雨水顺着脸颊滑落。
5-10s：特写镜头，洛如缨咬牙坚持，眼神痛苦，内心独白（洛如缨 os：该死……这淫毒已侵入心脉……再不尽快逼出恐怕……），无口型动作，仅表情抽搐。
10-15s：后拉镜头，洛如缨身形踉跄，前方荆棘密布，她强行提气加速。

&&&

分镜2
台词：中文
画风：仙侠CG动画
场景信息：
1. 妖域森林：幽暗、潮湿、发光植被、暴雨、泥泞、紫黑色调。
2. 木屋：简陋、温暖烛光、木质纹理、床榻、暧昧暖黄色调。
人物一致性设定：
1. 洛如缨（女主）：参考图1，白衣银饰，黑长直发，清冷高贵，衣衫带血污。
2. 宁夜辰（男主）：参考图4，黑袍，长发散落，剑眉星目，魔尊气质但目前伪装凡人。
3. 仙界使者1：参考图2，金甲壮汉，骑紫晶犀牛。
4. 仙界使者2：参考图3，银袍法师，骑金晶蝎。
视频提示词：
0-3s：广角追逐镜头，两名仙界使者骑着巨大的紫晶犀牛与金晶蝎撞破树木冲出。
3-8s：中景推进，金甲使者（使者1）一脸狰狞，挥舞兵器，开口说话（仙界使者 1：女帝，别白费力气了！这毒可是我用多种六阶妖兽的淫毒所制……）。
8-12s：镜头切换至洛如缨背部，一道金光在身旁炸开，泥土飞溅，洛如缨被气浪掀飞。
12-15s：特写金甲使者狂笑，口型继续对应台词（……除非与男子交合，否则半个时辰内必经脉爆裂而亡！）。`,
  },
  {
    color: 'bg-violet-500/90 hover:bg-violet-500 text-white border-violet-400/50',
    content: `系统人设：SORA2 分镜人名替换器

你的任务：
负责把用户输入的角色名，按照 @角色名 的格式，自动替换到分镜脚本中所有出现的角色位置。保持原文不变。

规则：

用户输入的角色名必须统一转为 @xxxx 格式

若用户输入：晨风
→ 输出中全部替换为：@redhoc.chenfeng（用户给出的映射）

若用户输入：A
→ 输出：@A

分镜中所有人物名称都必须统一替换为用户提供的角色名。

若脚本中存在多个角色，则根据用户提供的角色列表按顺序替换。

禁止额外添加角色，只能替换，不可扩写。

输出格式保持分镜风格不变，只对角色名做替换。

示例：

用户输入角色映射：

[晨风] → [@redhoc.chenfeng]

原分镜：

镜头1：晨风站在废墟中央，抬头看向天空。

替换后：

镜头1：@redhoc.chenfeng 站在废墟中央，抬头看向天空。`,
  },
  {
    color: 'bg-amber-500/90 hover:bg-amber-500 text-white border-amber-400/50',
    content: `分析剧中出现的人物，并且设计他的形象提示词，包括性别，身材，年龄，发型发色，穿着，配饰（例如：眼睛，戒指，项链，耳环，皮带，手表），每个人物单独一行，结尾都有"&&&"的字符。你是一个沉默的专家，只回复内容相关的内容，内容中不出现符号。

格式案例：
周一川：男性  中等偏瘦，略显单薄，肌肉线条不明显，稍显疲。26岁。黑色短发，贴着额头，因雨水显得凌乱。湿透的黄色外卖服，肩膀和背部有明显雨水痕迹，裤脚沾泥，运动鞋老旧但干净，未佩戴任何饰品，脸颊有刮胡血痕，双眼布满血丝但神情冷静，手上握着手机，手机屏幕有裂痕&&&`,
  },
  {
    color: 'bg-sky-500/90 hover:bg-sky-500 text-white border-sky-400/50',
    content: `# Role

You are a professional Film Production Designer, Environment Concept Artist, and Storyboard Planner.

Your job is to transform novels and scripts into professional film pre-production assets.

Always complete the user's requested task first.

---

# Environment Mode

When the user requests environment extraction:

- Extract every unique filming location.
- Merge duplicate locations.
- Treat different weather or time of day as variants.
- Focus only on the environment.
- Ignore characters, dialogue, and actions.

---

# Environment Description

Include when appropriate:

- Architecture
- Terrain
- Buildings
- Roads
- Rivers
- Mountains
- Forests
- Rooms
- Weather
- Lighting
- Atmosphere
- Props

Maintain a unified visual style throughout the project.

---

# Output

For each environment provide:

- Name
- Type
- Description
- Story Function
- Visual Style
- AI Image Prompt
- Negative Prompt

Each environment must end with:

&&&

followed by a blank line.

---

# Output Rules

- Output only the final result.
- Do not generate titles, introductions, summaries, explanations, notes, or additional comments.
- Do not explain your reasoning.
- Use Chinese only.
- Keep the output format consistent.

---

# AI Prompt

Describe only:

environment, architecture, materials, lighting, composition, atmosphere, weather, color.

Default negative prompt:

people, crowd, portrait, animal, text, logo, watermark, blurry, low quality.

---

Generate production-ready cinematic environment documents suitable for AI image generation.

The separator "&&&" is mandatory.

Every environment must end with exactly:

&&&

Do not omit it.`,
  },
  {
    color: 'bg-rose-500/90 hover:bg-rose-500 text-white border-rose-400/50',
    /** AI Canvas 分镜脚本 text-only system（含图片提示词/视频提示词规则） */
    content: STORYBOARD_SCRIPT_TEXT_ONLY_SYSTEM_PROMPT,
  },
];

const LLMInputPanel: React.FC<LLMInputPanelProps> = ({
  nodeId,
  isDarkMode,
  inputText,
  userInput,
  isImageReverseMode,
  imageUrlForReverse,
  isVideoAnalysisMode,
  videoUrlForAnalysis,
  reverseCaptionModel = IMAGE_REVERSE_DEFAULT_MODEL,
  onReverseCaptionModelChange,
  isInputLocked,
  hasLinkedText = false,
  linkedInputText = '',
  linkedTextTitle = '',
  savedPrompts,
  projectId,
  nodeTitle,
  onUserInputChange,
  onInputTextChange,
  onSavedPromptsChange,
  onOutputTextChange,
  onPersonaChange,
  onRunStart,
  chatModel = LLM_CHAT_DISPLAY_MODEL_ID,
  onChatModelChange,
}) => {
  const userInputRef = useRef<HTMLTextAreaElement>(null);
  const promptInputRef = useRef<HTMLTextAreaElement>(null);
  const [showSaveDialog, setShowSaveDialog] = useState(false);
  const isSpecialMode = !!isImageReverseMode || !!isVideoAnalysisMode;
  /** IME 输入法组合状态：组合中不立即同步到父级，避免中文输入被截断 */
  const [userInputComposing, setUserInputComposing] = useState(false);
  const [userInputLocal, setUserInputLocal] = useState('');
  const [inputTextComposing, setInputTextComposing] = useState(false);
  const [inputTextLocal, setInputTextLocal] = useState('');
  const [savePromptNameComposing, setSavePromptNameComposing] = useState(false);
  const [savePromptNameLocal, setSavePromptNameLocal] = useState('');
  const [savePromptName, setSavePromptName] = useState('');
  const { cloudMap } = useNxModelPricing();
  const [showPersonaDropdown, setShowPersonaDropdown] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [personaToDelete, setPersonaToDelete] = useState<{ id: string; name: string } | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const { locale } = useAppLocale();
  const { showAlert, showConfirm } = useDarkAlert();
  const lt = llmInputPanelT(locale);
  const displayLinkedTitle =
    (linkedTextTitle || '').trim() || (hasLinkedText ? (locale === 'en' ? 'Text' : '文本') : '');
  const refMicAt = useMemo(() => audioInputPanelT(locale), [locale]);
  /** 提示词区「文本走廊」芯片：只显示名称，完整人设进 system */
  const [corridorChips, setCorridorChips] = useState<
    Array<{ id: string; name: string; content: string; color: string }>
  >([]);
  /** 长按进入胶囊管理态：抖动 + 右上角删除 */
  const [capsuleManageMode, setCapsuleManageMode] = useState(false);
  const capsuleLongPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const capsuleLongPressFiredRef = useRef(false);
  const capsuleBarRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setCorridorChips([]);
    setCapsuleManageMode(false);
  }, [nodeId]);

  useEffect(() => {
    if (!capsuleManageMode) return;
    const onDocPointer = (e: PointerEvent) => {
      const root = capsuleBarRef.current;
      if (root && e.target instanceof Node && root.contains(e.target)) return;
      setCapsuleManageMode(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setCapsuleManageMode(false);
    };
    document.addEventListener('pointerdown', onDocPointer, true);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDocPointer, true);
      document.removeEventListener('keydown', onKey);
    };
  }, [capsuleManageMode]);

  const clearCapsuleLongPress = useCallback(() => {
    if (capsuleLongPressTimerRef.current) {
      clearTimeout(capsuleLongPressTimerRef.current);
      capsuleLongPressTimerRef.current = null;
    }
  }, []);

  const startCapsuleLongPress = useCallback(() => {
    clearCapsuleLongPress();
    capsuleLongPressFiredRef.current = false;
    capsuleLongPressTimerRef.current = setTimeout(() => {
      capsuleLongPressTimerRef.current = null;
      capsuleLongPressFiredRef.current = true;
      setCapsuleManageMode(true);
    }, 520);
  }, [clearCapsuleLongPress]);

  const endCapsuleLongPress = useCallback(() => {
    clearCapsuleLongPress();
  }, [clearCapsuleLongPress]);

  const CAPSULE_COLORS = useMemo(
    () => [
      'bg-emerald-500/90 hover:bg-emerald-500 text-white border-emerald-400/50',
      'bg-violet-500/90 hover:bg-violet-500 text-white border-violet-400/50',
      'bg-amber-500/90 hover:bg-amber-500 text-white border-amber-400/50',
      'bg-sky-500/90 hover:bg-sky-500 text-white border-sky-400/50',
      'bg-rose-500/90 hover:bg-rose-500 text-white border-rose-400/50',
      'bg-indigo-500/90 hover:bg-indigo-500 text-white border-indigo-400/50',
    ],
    [],
  );
  const quickTags = useMemo(
    () =>
      LLM_QUICK_TAG_DEFS.map((def, i) => {
        const labels = [
          lt.quickTagScriptRewrite,
          lt.quickTagCharacterReplace,
          lt.quickTagCharacterAnalysis,
          lt.quickTagSceneAnalysis,
          lt.quickTagStoryboard,
        ] as const;
        return { ...def, label: labels[i], id: `quick-${i}` };
      }),
    [lt],
  );

  /** 底栏胶囊 = 内置快捷标签 + 已保存人设 */
  const footerCapsules = useMemo(() => {
    const builtin = quickTags.map((t) => ({
      id: t.id,
      name: t.label,
      content: t.content,
      color: t.color,
      isBuiltin: true as const,
    }));
    const saved = savedPrompts.map((p, i) => ({
      id: p.id,
      name: p.name,
      content: p.content,
      color: CAPSULE_COLORS[i % CAPSULE_COLORS.length],
      isBuiltin: false as const,
    }));
    return [...builtin, ...saved];
  }, [quickTags, savedPrompts, CAPSULE_COLORS]);

  // 获取光标颜色样式（caretColor 必须通过内联样式设置，CSS 类无法实现）
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const getCaretColorStyle = useCallback(() => ({
    caretColor: isDarkMode ? '#0A84FF' : '#22c55e',
  }), [isDarkMode]);

  const syncCorridorToSystem = useCallback(
    (chips: Array<{ id: string; name: string; content: string; color: string }>) => {
      // 底栏 textarea 专用于自由系统文；胶囊只影响标题与发送时的 system 拼接
      onPersonaChange?.(chips.length ? chips.map((c) => c.name).join(' · ') : null);
    },
    [onPersonaChange],
  );

  const toggleCorridorChip = useCallback(
    (chip: { id: string; name: string; content: string; color: string }) => {
      setCorridorChips((prev) => {
        const exists = prev.some((c) => c.id === chip.id);
        const next = exists ? prev.filter((c) => c.id !== chip.id) : [...prev, chip];
        syncCorridorToSystem(next);
        return next;
      });
    },
    [syncCorridorToSystem],
  );

  const removeCorridorChip = useCallback(
    (chipId: string) => {
      setCorridorChips((prev) => {
        const next = prev.filter((c) => c.id !== chipId);
        syncCorridorToSystem(next);
        return next;
      });
    },
    [syncCorridorToSystem],
  );

  /** 将快捷标签内容填入系统人设（追加）— 特殊模式仍用 */
  const appendQuickTagToPersona = useCallback((content: string) => {
    const sep = userInput.trim() ? '\n\n' : '';
    onUserInputChange(userInput + sep + content);
    userInputRef.current?.focus();
  }, [userInput, onUserInputChange]);

  const {
    status: dictationStatus,
    isActive: isDictationActive,
    inputLevel: dictationInputLevel,
    start: startRealtimeDictation,
    stop: stopRealtimeDictation,
    cancel: cancelRealtimeDictation,
  } = useCloudRealtimeDictation({
    getBaseText: () => {
      const prev = (userInputRef.current?.value ?? userInput ?? '').trimEnd();
      return prev ? `${prev}\n` : '';
    },
    onLiveText: (full) => {
      onUserInputChange(full);
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

  const { pointerHandlers: personaMicPointerHandlers } = useDictationPushToTalk({
    start: startRealtimeDictation,
    stop: stopRealtimeDictation,
    cancel: cancelRealtimeDictation,
    status: dictationStatus,
    disabled: micVoiceStopping,
  });

  useEffect(() => {
    const open = isDictationActive;
    (window as Window & { __nexflowVoiceModalOpen?: boolean }).__nexflowVoiceModalOpen = open;
    return () => {
      (window as Window & { __nexflowVoiceModalOpen?: boolean }).__nexflowVoiceModalOpen = false;
    };
  }, [isDictationActive]);

  /** 与 VideoInputPanel 提示词区麦克风同款：小方角、输入框内右上角；按住说话 */
  const personaVoiceMicButton = (
    <button
      type="button"
      {...personaMicPointerHandlers}
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
          ? lt.voiceTranscribing
          : isDictationActive
            ? lt.voiceStopTitle
            : lt.voiceStartTitle
      }
      aria-label={
        micVoiceBusy
          ? lt.voiceTranscribing
          : isDictationActive
            ? lt.voiceStopTitle
            : lt.voiceStartTitle
      }
    >
      <VoiceMicGlyph
        busy={micVoiceBusy}
        active={dictationStatus === 'listening'}
        level={dictationInputLevel}
      />
    </button>
  );

  // AI Hook
  const { status: aiStatus, execute: executeAI } = useAI({
    nodeId,
    modelId: 'chat',
    onStatusUpdate: (packet) => {
      // 调试日志：记录所有状态更新
      const hasPayload = !!packet.payload;
      const hasText = !!(packet.payload as any)?.text;
      const textLength = (packet.payload as any)?.text?.length || 0;
      const hasLocalPath = !!(packet.payload as any)?.localPath;
      const localPath = (packet.payload as any)?.localPath || 'none';
      const progress = (packet.payload as any)?.progress;
      
      console.log(`[LLMInputPanel] 收到状态更新: nodeId=${nodeId}, status=${packet.status}, hasPayload=${hasPayload}, hasText=${hasText}, textLength=${textLength}, hasLocalPath=${hasLocalPath}, localPath=${localPath}, progress=${progress}`);
      
      // START 和 PROCESSING 状态：确保进度条显示（通过 Workspace 的全局更新）
      // 这里不需要手动更新，因为 Workspace 会处理全局更新
      
      // 更新输出文本（仅在 SUCCESS 时）
      // 放弃路径依赖：有文本就先上文本，不再等待 localPath 读取
      if (packet.status === 'SUCCESS') {
        const text = (packet.payload as any)?.text;
        // 优先使用 text 字段，确保是字符串且已 trim
        const trimmedText = text ? String(text).trim() : '';
        if (trimmedText) {
          console.log(`[LLMInputPanel] SUCCESS 状态，text 长度: ${trimmedText.length}, 调用 onOutputTextChange（放弃路径依赖）`);
          onOutputTextChange(trimmedText);
        } else {
          // 如果没有 text，记录警告但不等待 localPath
          console.warn(`[LLMInputPanel] SUCCESS 状态但没有有效的 text 字段，payload keys:`, packet.payload ? Object.keys(packet.payload) : []);
          console.warn(`[LLMInputPanel] 放弃路径依赖：不再等待 localPath 读取`);
        }
      }
    },
    onComplete: (result) => {
      console.log(`[LLMInputPanel] 收到 onComplete 回调:`, {
        hasResult: !!result,
        hasText: !!result?.text,
        textLength: result?.text?.length || 0,
        hasLocalPath: !!result?.localPath,
        localPath: result?.localPath || 'none',
        keys: result ? Object.keys(result) : [],
      });
      
      // 放弃路径依赖：有文本就先上文本，不再等待 localPath 读取
      const text = result?.text;
      const trimmedText = text ? String(text).trim() : '';
      if (trimmedText) {
        console.log(`[LLMInputPanel] onComplete 调用 onOutputTextChange，text 长度: ${trimmedText.length}（放弃路径依赖）`);
        onOutputTextChange(trimmedText);
      } else {
        console.warn(`[LLMInputPanel] onComplete 回调但没有有效的 text 字段，result keys:`, result ? Object.keys(result) : []);
        console.warn(`[LLMInputPanel] 放弃路径依赖：不再等待 localPath 读取`);
      }
    },
  });

  // 保存：普通对话把「系统提示」收成胶囊；特殊模式仍保存系统人设
  const handleSavePrompt = useCallback(() => {
    if (!userInput.trim()) return;
    setShowSaveDialog(true);
    setSavePromptName('');
  }, [userInput]);

  // 确认保存
  const handleConfirmSave = useCallback(async () => {
    const contentSource = userInput.trim();
    if (!savePromptName.trim() || !contentSource) {
      return;
    }
    
    const newPrompt = {
      id: `prompt-${Date.now()}`,
      name: savePromptName.trim(),
      content: contentSource,
    };
    
    if (window.electronAPI) {
      try {
        await window.electronAPI.saveGlobalLLMPersona(newPrompt);
      } catch (error) {
        console.error('保存全局人设失败:', error);
      }
    }
    
    onSavedPromptsChange([...savedPrompts, newPrompt]);

    // 普通对话：收成胶囊后清空系统文，并自动挂到走廊
    if (!isSpecialMode) {
      const color = CAPSULE_COLORS[savedPrompts.length % CAPSULE_COLORS.length];
      const chip = { id: newPrompt.id, name: newPrompt.name, content: newPrompt.content, color };
      setCorridorChips((prev) => {
        if (prev.some((c) => c.id === chip.id)) return prev;
        const next = [...prev, chip];
        syncCorridorToSystem(next);
        return next;
      });
      onUserInputChange('');
    }

    setShowSaveDialog(false);
    setSavePromptName('');
  }, [
    savePromptName,
    userInput,
    isSpecialMode,
    savedPrompts,
    onSavedPromptsChange,
    onUserInputChange,
    CAPSULE_COLORS,
    syncCorridorToSystem,
  ]);

  // 取消保存
  const handleCancelSave = useCallback(() => {
    setShowSaveDialog(false);
    setSavePromptName('');
  }, []);

  // 加载提示词（加载到 userInput 区域）
  const handleLoadPrompt = useCallback((content: string) => {
    onUserInputChange(content);
    setShowPersonaDropdown(false);
  }, [onUserInputChange]);

  // 处理删除人设
  const handleDeletePersona = useCallback((e: React.MouseEvent, personaId: string, personaName: string) => {
    e.stopPropagation(); // 阻止下拉菜单关闭
    setPersonaToDelete({ id: personaId, name: personaName });
    setShowDeleteConfirm(true);
  }, []);

  // 确认删除人设
  const handleConfirmDelete = useCallback(async () => {
    if (!personaToDelete) return;

    try {
      if (window.electronAPI) {
        await window.electronAPI.deleteGlobalLLMPersona(personaToDelete.id);
      }
      
      // 更新本地状态
      const updatedPrompts = savedPrompts.filter((p) => p.id !== personaToDelete.id);
      onSavedPromptsChange(updatedPrompts);

      // 如果删除的是当前选中的人设，清空 userInput
      const currentSelectedId = savedPrompts.find((p) => p.content === userInput)?.id;
      if (currentSelectedId === personaToDelete.id) {
        onUserInputChange('');
        if (onPersonaChange) {
          onPersonaChange(null);
        }
      }
      setCorridorChips((prev) => {
        const next = prev.filter((c) => c.id !== personaToDelete.id);
        if (next.length !== prev.length) {
          syncCorridorToSystem(next);
        }
        return next;
      });

      setShowDeleteConfirm(false);
      setPersonaToDelete(null);
      setCapsuleManageMode(false);
    } catch (error) {
      console.error('删除人设失败:', error);
    }
  }, [personaToDelete, savedPrompts, onSavedPromptsChange, userInput, onUserInputChange, onPersonaChange, syncCorridorToSystem]);

  // 取消删除
  const handleCancelDelete = useCallback(() => {
    setShowDeleteConfirm(false);
    setPersonaToDelete(null);
  }, []);

  // 点击外部关闭下拉菜单
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setShowPersonaDropdown(false);
      }
    };

    if (showPersonaDropdown) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => {
        document.removeEventListener('mousedown', handleClickOutside);
      };
    }
  }, [showPersonaDropdown]);

  const resolvedChatModel = useMemo(() => {
    const raw = (chatModel || LLM_CHAT_DISPLAY_MODEL_ID).trim();
    return (LLM_CHAT_MODEL_IDS as readonly string[]).includes(raw) ? raw : LLM_CHAT_DISPLAY_MODEL_ID;
  }, [chatModel]);

  // 执行 AI
  const handleExecuteAI = useCallback(async () => {
    // 立即显示进度条动画（点击运行即开始）
    onRunStart?.();

    // 视频分析模式：调用 RunningHub 视频分析 API，返回文本传入 LLM 显示
    if (isVideoAnalysisMode && videoUrlForAnalysis && window.electronAPI?.invokeAI) {
      try {
        await window.electronAPI.invokeAI({
          modelId: 'video-analysis',
          nodeId,
          input: { videoUrl: videoUrlForAnalysis, nodeId, projectId },
        });
      } catch (error) {
        console.error('视频分析失败:', error);
      }
      return;
    }

    // 图像反推模式：构造带 image_url 的消息
    if (isImageReverseMode && imageUrlForReverse) {
      const question = (userInput.trim() || lt.placeholderImageReverse).trim();
      const model = normalizeImageReverseCaptionModel(reverseCaptionModel);

      const messages: Array<{ role: 'user'; content: any }> = [
        {
          role: 'user',
          content: [
            { type: 'text', text: question },
            {
              type: 'image_url',
              image_url: {
                url: imageUrlForReverse,
              },
            },
          ],
        },
      ];

      try {
        await executeAI({
          model,
          messages,
          max_tokens: 400,
          stream: false,
          projectId: projectId,
          nodeTitle: nodeTitle || 'llm',
        });
      } catch (error) {
        console.error('AI 调用失败:', error);
      }
      return;
    }

    // 普通文本对话：底栏专供系统文；上游连线正文作 user（不写入底栏）
    // 无上游连线时：胶囊 → system，底栏自由文 → user，便于单独对话
    const messages: Array<{ role: 'system' | 'user'; content: string }> = [];
    const chipSystem = corridorChips.map((c) => c.content.trim()).filter(Boolean);
    const freeSystem = userInput.trim();
    const linkedUser = (linkedInputText || '').trim();

    if (linkedUser) {
      const systemParts = [...chipSystem, freeSystem].filter(Boolean);
      if (systemParts.length) {
        messages.push({ role: 'system', content: systemParts.join('\n\n') });
      }
      messages.push({ role: 'user', content: linkedUser });
    } else {
      if (chipSystem.length) {
        messages.push({ role: 'system', content: chipSystem.join('\n\n') });
      }
      if (freeSystem) {
        messages.push({ role: 'user', content: freeSystem });
      }
    }

    if (messages.length === 0) {
      return;
    }

    try {
      await executeAI({
        model: resolvedChatModel,
        messages,
        temperature: 0.7,
        max_tokens: 2000,
        stream: false,
        projectId: projectId, // 传递项目ID用于资源保存
        nodeTitle: nodeTitle || 'llm', // 传递节点标题用于资源保存
      });
    } catch (error) {
      console.error('AI 调用失败:', error);
    }
  }, [
    userInput,
    linkedInputText,
    corridorChips,
    executeAI,
    isImageReverseMode,
    imageUrlForReverse,
    isVideoAnalysisMode,
    videoUrlForAnalysis,
    reverseCaptionModel,
    resolvedChatModel,
    projectId,
    nodeTitle,
    onRunStart,
    nodeId,
    lt.placeholderImageReverse,
  ]);

  const hasUserContent =
    (isImageReverseMode ? !!imageUrlForReverse : false) ||
    (isVideoAnalysisMode ? !!videoUrlForAnalysis : false) ||
    userInput.trim().length > 0 ||
    corridorChips.length > 0 ||
    (linkedInputText || '').trim().length > 0 ||
    inputText.trim().length > 0;
  // 处理运行中状态：除了 idle/SUCCESS/ERROR 之外的状态都视为运行中（包括 START / PROCESSING）
  // 按钮禁用逻辑：只基于当前模块自己的状态
  const isProcessing = aiStatus !== 'idle' && aiStatus !== 'SUCCESS' && aiStatus !== 'ERROR';
  const isRunDisabled =
    isProcessing || (!hasUserContent && !(isImageReverseMode && imageUrlForReverse) && !(isVideoAnalysisMode && videoUrlForAnalysis));

  const reversePriceLabel = useMemo(() => {
    if (!isImageReverseMode) return null;
    try {
      return {
        ok: true as const,
        value: getImageReverseDisplayPrice(
          normalizeImageReverseCaptionModel(reverseCaptionModel),
          cloudMap,
        ),
      };
    } catch (e) {
      if (isModelNotPricedError(e)) return { ok: false as const };
      throw e;
    }
  }, [isImageReverseMode, reverseCaptionModel, cloudMap]);

  /** 普通对话 / 视频分析：与图片节点一致的金色元宝预估（反推模式用 reversePriceLabel） */
  const runPriceYuanbao = useMemo(() => {
    if (isImageReverseMode) return null;
    return isVideoAnalysisMode ? getVideoAnalysisDisplayPrice(cloudMap) : getLlmChatDisplayPrice(cloudMap);
  }, [isImageReverseMode, isVideoAnalysisMode, cloudMap]);

  return (
    <div className="relative flex w-full flex-col">
    <div 
      className={[
        'relative flex flex-col overflow-hidden rounded-[18px] border transition-colors',
        isVideoAnalysisMode ? 'h-[72px]' : 'h-[170px]',
        isDarkMode
          ? 'nexflow-glass-panel border-white/[0.14] shadow-[0_8px_28px_rgba(0,0,0,0.28)]'
          : 'apple-panel-light border-black/[0.08] shadow-[0_8px_28px_rgba(0,0,0,0.06)]',
        isVideoAnalysisMode ? 'px-3.5 py-2.5' : 'px-3.5 pt-2.5 pb-2',
      ].join(' ')}
    >
      {isImageReverseMode && <AiGenerateDisclaimerTip isDarkMode={isDarkMode} />}

      {/* 删除确认对话框 */}
      {showDeleteConfirm && personaToDelete && (
        <div className="absolute inset-0 bg-black/50 flex items-center justify-center z-50 rounded-2xl">
          <div className={`${isDarkMode ? 'nexflow-glass-panel' : 'bg-white/90'} rounded-lg p-4 w-80 border-2 ${isDarkMode ? 'border-gray-600' : 'border-gray-300'}`}>
            <div className="mb-4">
              <h3 className={`text-sm font-medium mb-2 ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>
                {lt.confirmDeleteTitle}
              </h3>
              <p className={`text-xs ${isDarkMode ? 'text-white/70' : 'text-gray-600'}`}>
                {lt.confirmDeleteBody(personaToDelete.name)}
              </p>
            </div>
            <div className="flex gap-2 justify-end">
              <button
                onClick={handleCancelDelete}
                className={`px-4 py-2 rounded-lg text-sm ${
                  isDarkMode 
                    ? 'bg-gray-700/50 text-white hover:bg-gray-700/70' 
                    : 'bg-gray-200 text-gray-900 hover:bg-gray-300'
                } transition-colors`}
              >
                {lt.cancel}
              </button>
              <button
                onClick={handleConfirmDelete}
                className={`px-4 py-2 rounded-lg text-sm ${
                  isDarkMode
                    ? 'bg-red-500/20 text-red-400 hover:bg-red-500/30'
                    : 'bg-red-500 text-white hover:bg-red-600'
                } transition-colors`}
              >
                {lt.confirmDelete}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 保存人设名称输入弹窗 */}
      {showSaveDialog && (
        <div className="absolute inset-0 bg-black/50 flex items-center justify-center z-50 rounded-2xl">
          <div className="nexflow-glass-panel rounded-lg p-4 w-80 border-2 border-white/15">
            <div className="mb-4">
              <label className="block text-sm font-medium mb-2 text-white">
                {lt.savePersonaLabel}
              </label>
              {/* eslint-disable-next-line react/forbid-dom-props */}
              <input
                type="text"
                value={savePromptNameComposing ? savePromptNameLocal : savePromptName}
                onCompositionStart={(e) => {
                  setSavePromptNameComposing(true);
                  setSavePromptNameLocal(e.target.value);
                }}
                onCompositionEnd={(e) => {
                  setSavePromptNameComposing(false);
                  setSavePromptName(e.target.value);
                }}
                onChange={(e) => {
                  const v = e.target.value;
                  if (savePromptNameComposing) {
                    setSavePromptNameLocal(v);
                  } else {
                    setSavePromptName(v);
                  }
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    handleConfirmSave();
                  } else if (e.key === 'Escape') {
                    handleCancelSave();
                  }
                }}
                className="w-full px-3 py-2 rounded-lg text-sm border bg-black/30 text-white border-white/15 focus:border-green-500 outline-none placeholder-white/40"
                placeholder={lt.savePersonaPlaceholder}
                autoFocus
                style={getCaretColorStyle()}
              />
            </div>
            <div className="flex gap-2 justify-end">
              <button
                onClick={handleCancelSave}
                className="px-4 py-2 rounded-lg text-sm bg-white/10 text-white hover:bg-white/15 transition-colors"
              >
                {lt.cancel}
              </button>
              <button
                onClick={handleConfirmSave}
                disabled={
                  !savePromptName.trim() || !userInput.trim()
                }
                className={`px-4 py-2 rounded-lg text-sm ${
                  !savePromptName.trim() || !userInput.trim()
                    ? 'opacity-50 cursor-not-allowed bg-gray-500/50 text-white/50'
                    : 'bg-green-500 text-white hover:bg-green-600'
                } transition-colors`}
              >
                {lt.ok}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 视频分析：仅标签 + 元宝价签 + 运行 */}
      {isVideoAnalysisMode && (
        <div className="flex flex-1 min-h-0 items-center gap-2">
          <span
            className={`text-sm font-medium px-2.5 py-1 rounded-lg flex-shrink-0 ${
              isDarkMode ? 'text-blue-200 bg-blue-500/20' : 'text-blue-700 bg-blue-100'
            }`}
          >
            {lt.videoAnalysisBadge}
          </span>
          <div className="flex-1" />
          {runPriceYuanbao != null ? (
            <span
              className={`text-[11px] font-medium px-2 py-0.5 rounded-full shrink-0 tabular-nums border ${
                isDarkMode
                  ? 'text-amber-200/90 bg-amber-500/15 border-amber-400/25'
                  : 'text-amber-700 bg-amber-50 border-amber-200'
              }`}
              title={lt.runPriceTooltip}
            >
              {runPriceYuanbao}
              {locale === 'en' ? ' ' : ''}
              {lt.creditsSuffix}
            </span>
          ) : null}
          <button
            type="button"
            onClick={handleExecuteAI}
            disabled={isRunDisabled}
            className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 transition-colors ${
              isRunDisabled
                ? isDarkMode
                  ? 'bg-white/[0.08] text-white/25 cursor-not-allowed'
                  : 'bg-black/[0.06] text-gray-400 cursor-not-allowed'
                : 'bg-green-500 text-white hover:bg-green-600'
            }`}
            title={lt.runVideoAnalysis}
            aria-label={lt.runVideoAnalysis}
          >
            {isProcessing ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Play className="w-3.5 h-3.5" strokeWidth={2.5} />
            )}
          </button>
        </div>
      )}

      {/* 图像反推：上方输入，下方人设/模型/运行（胶囊在框外） */}
      {isImageReverseMode && (
      <>
      <div className="relative flex-1 min-h-0 flex flex-col pt-1">
        <textarea
          ref={userInputRef}
          data-nexflow-dictation-target="1"
          value={userInputComposing ? userInputLocal : (userInput ?? '')}
          readOnly={micInputLocked}
          onCompositionStart={(e) => {
            setUserInputComposing(true);
            setUserInputLocal(e.target.value);
          }}
          onCompositionEnd={(e) => {
            setUserInputComposing(false);
            onUserInputChange(e.target.value);
          }}
          onChange={(e) => {
            if (micInputLocked) return;
            const v = e.target.value;
            if (userInputComposing) {
              setUserInputLocal(v);
            } else {
              onUserInputChange(v);
            }
          }}
          className={`w-full flex-1 min-h-0 custom-scrollbar bg-transparent resize-none outline-none text-sm leading-[1.5] p-0 pr-9 pt-8 border-0 ${
            isDarkMode 
              ? 'text-white placeholder:text-white/40' 
              : 'text-gray-900 placeholder:text-gray-500'
          } ${micInputLocked ? 'opacity-45 cursor-not-allowed' : ''}`}
          placeholder={lt.placeholderImageReverse}
          title={lt.systemPersonaInputTitle}
          style={getCaretColorStyle()}
        />
        <div className="absolute top-0.5 right-0 z-10 pointer-events-auto">
          {personaVoiceMicButton}
        </div>
      </div>
      <div className="mt-1 flex items-center gap-1.5 flex-shrink-0 min-w-0">
        <button
          type="button"
          onClick={handleSavePrompt}
          disabled={!userInput.trim()}
          className={`px-2 py-1 rounded-lg text-xs flex items-center gap-1 flex-shrink-0 ${
            !userInput.trim()
              ? 'opacity-50 cursor-not-allowed'
              : isDarkMode
                ? 'bg-green-500/20 text-green-400 hover:bg-green-500/30'
                : 'bg-green-500/10 text-green-600 hover:bg-green-500/20'
          } transition-colors`}
        >
          <Save className="w-3 h-3" />
          {lt.saveButton}
        </button>
        <div className="relative min-w-0 max-w-[140px] flex-shrink" ref={dropdownRef}>
          <button
            type="button"
            onClick={() => setShowPersonaDropdown(!showPersonaDropdown)}
            className={`w-full px-2 py-1 rounded-lg text-xs text-left flex items-center justify-between gap-1 ${
              isDarkMode ? 'bg-white/[0.06] text-white' : 'bg-black/[0.04] text-gray-900'
            } outline-none hover:opacity-80 transition-opacity`}
            title={lt.selectPersonaTitle}
          >
            <span className="truncate">
              {savedPrompts.find((p: { id: string; content: string }) => p.content === userInput)?.name ||
                lt.selectPersona}
            </span>
            <span className={`shrink-0 transition-transform ${showPersonaDropdown ? 'rotate-180' : ''}`}>▼</span>
          </button>
          {showPersonaDropdown && (
            <div className="absolute bottom-full left-0 right-0 mb-1 rounded-lg border z-50 max-h-48 overflow-y-auto nexflow-glass-panel border-white/15 shadow-lg">
              <div
                className="px-2 py-1.5 text-xs cursor-pointer hover:bg-white/10 text-white/60"
                onClick={() => {
                  onUserInputChange('');
                  if (onPersonaChange) onPersonaChange(null);
                  setShowPersonaDropdown(false);
                }}
              >
                {lt.selectPersona}
              </div>
              {savedPrompts.map((saved: { id: string; name: string; content: string }) => {
                const isSelected = saved.content === userInput;
                return (
                  <div
                    key={saved.id}
                    className={`px-2 py-1.5 text-xs flex items-center justify-between group ${
                      isSelected ? 'bg-green-500/20 text-green-400' : 'hover:bg-white/10 text-white'
                    } cursor-pointer`}
                    onClick={() => {
                      handleLoadPrompt(saved.content);
                      if (onPersonaChange) onPersonaChange(saved.name);
                    }}
                  >
                    <span className="flex-1 truncate">{saved.name}</span>
                    <button
                      type="button"
                      onClick={(e) => handleDeletePersona(e, saved.id, saved.name)}
                      className="ml-2 p-0.5 rounded opacity-0 group-hover:opacity-100 transition-opacity hover:bg-red-500/20 text-red-400"
                      title={lt.deletePersonaTitle}
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
        <select
          value={normalizeImageReverseCaptionModel(reverseCaptionModel)}
          onChange={(e) =>
            onReverseCaptionModelChange?.(normalizeImageReverseCaptionModel(e.target.value))
          }
          className={`px-2 py-1 rounded-lg text-xs flex-shrink-0 max-w-[140px] ${
            isDarkMode ? 'bg-white/[0.06] text-white' : 'bg-black/[0.04] text-gray-900'
          } outline-none`}
          title={lt.chooseReverseModelTitle}
        >
          <option value={LLM_CHAT_MODEL_GPT56_TERRA}>{lt.gpt4oOptionLabel}</option>
          <option value="joy-caption-two">Joy Caption Two</option>
        </select>
        <div className="flex-1" />
        {reversePriceLabel?.ok ? (
          <span
            className={`text-[11px] font-medium px-2 py-0.5 rounded-full shrink-0 tabular-nums border ${
              isDarkMode
                ? 'text-amber-200/90 bg-amber-500/15 border-amber-400/25'
                : 'text-amber-700 bg-amber-50 border-amber-200'
            }`}
            title={lt.reversePriceTooltip}
          >
            {reversePriceLabel.value}
            {locale === 'en' ? ' ' : ''}
            {lt.creditsSuffix}
          </span>
        ) : reversePriceLabel && !reversePriceLabel.ok ? (
          <span
            className={`text-[11px] font-medium px-2 py-0.5 rounded-full shrink-0 ${
              isDarkMode ? 'text-white/45 bg-white/10' : 'text-gray-500 bg-gray-100'
            }`}
            title={lt.noPricingReverseModelTitle}
          >
            {lt.noPricingYet}
          </span>
        ) : null}
        <button
          type="button"
          onClick={handleExecuteAI}
          disabled={isRunDisabled}
          className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 transition-colors ${
            isRunDisabled
              ? isDarkMode
                ? 'bg-white/[0.08] text-white/25 cursor-not-allowed'
                : 'bg-black/[0.06] text-gray-400 cursor-not-allowed'
              : 'bg-green-500 text-white hover:bg-green-600'
          }`}
          title={lt.runImageReverse}
          aria-label={lt.runImageReverse}
        >
          {isProcessing ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
          ) : (
            <Play className="w-3.5 h-3.5" strokeWidth={2.5} />
          )}
        </button>
      </div>
      </>
      )}

      {/* 普通对话：半高输入卡；@接入标签在系统提示区内；胶囊在卡片外 */}
      {!isSpecialMode && (
        <div className="flex-1 min-h-0 flex flex-col">
          <div
            className="flex-1 min-h-0 flex flex-col"
            onClick={() => {
              if (micInputLocked) return;
              userInputRef.current?.focus();
            }}
          >
            <div className="flex-1 min-h-0 overflow-hidden [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden flex flex-col">
              {/* 红框区：@接入 + 已选胶囊标签与手输系统文同一输入处，可穿插 */}
              {(hasLinkedText && !!displayLinkedTitle) || corridorChips.length > 0 ? (
                <div className="flex flex-wrap items-center gap-1.5 content-start flex-shrink-0 mb-1">
                  {hasLinkedText && !!displayLinkedTitle && (
                    <span
                      className={`inline-flex items-center max-w-[90%] px-1.5 py-0.5 rounded-md text-[12px] font-semibold tracking-tight ${
                        isDarkMode
                          ? 'bg-sky-500/25 text-sky-300'
                          : 'bg-sky-100 text-sky-700'
                      }`}
                      title={locale === 'en' ? 'Linked as user message' : '已接入为用户消息'}
                    >
                      @{displayLinkedTitle}
                    </span>
                  )}
                  {corridorChips.map((chip) => (
                    <span
                      key={chip.id}
                      className={`inline-flex items-center gap-0.5 max-w-[160px] px-1.5 py-0.5 rounded-md text-[11px] font-medium border ${chip.color}`}
                      title={chip.name}
                    >
                      <span className="truncate">@{chip.name}</span>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          removeCorridorChip(chip.id);
                        }}
                        className="shrink-0 opacity-80 hover:opacity-100 leading-none ml-0.5"
                        aria-label="remove"
                      >
                        ×
                      </button>
                    </span>
                  ))}
                </div>
              ) : null}
              <div className="relative flex-1 min-h-0 flex flex-col">
                <textarea
                  ref={userInputRef}
                  data-nexflow-dictation-target="1"
                  value={userInputComposing ? userInputLocal : (userInput ?? '')}
                  readOnly={micInputLocked}
                  onCompositionStart={(e) => {
                    setUserInputComposing(true);
                    setUserInputLocal(e.target.value);
                  }}
                  onCompositionEnd={(e) => {
                    setUserInputComposing(false);
                    onUserInputChange(e.target.value);
                  }}
                  onChange={(e) => {
                    if (micInputLocked) return;
                    const v = e.target.value;
                    if (userInputComposing) {
                      setUserInputLocal(v);
                    } else {
                      onUserInputChange(v);
                    }
                  }}
                  onKeyDown={(e) => {
                    if (micInputLocked) return;
                    if (e.key !== 'Enter' || e.shiftKey || isRunDisabled) return;
                    if (userInputComposing || e.nativeEvent.isComposing || e.keyCode === 229) return;
                    e.preventDefault();
                    void handleExecuteAI();
                  }}
                  className={`w-full flex-1 min-h-[40px] bg-transparent resize-none outline-none text-[13px] leading-[1.5] overflow-y-auto [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden pr-9 pt-8 ${
                    isDarkMode
                      ? 'text-white/90 placeholder:text-white/35'
                      : 'text-gray-900 placeholder:text-gray-400'
                  } ${micInputLocked ? 'opacity-45 cursor-not-allowed' : ''}`}
                  placeholder={lt.placeholderSystemPersona}
                  title={lt.systemPersonaInputTitle}
                  style={getCaretColorStyle()}
                />
                <div className="absolute top-0.5 right-0 z-10 pointer-events-auto">
                  {personaVoiceMicButton}
                </div>
              </div>
            </div>
          </div>

          <div className="mt-1 flex items-center gap-1.5 flex-shrink-0 min-w-0">
            <label
              className={`nodrag nopan nowheel relative inline-flex items-center gap-1.5 max-w-[200px] px-1 py-1 rounded-md text-[12px] cursor-pointer ${
                isDarkMode ? 'text-white/80 hover:bg-white/5' : 'text-gray-700 hover:bg-black/5'
              }`}
              title={lt.chatModelLabel}
              onMouseDown={(e) => e.stopPropagation()}
              onPointerDown={(e) => e.stopPropagation()}
            >
              <span
                className={`pointer-events-none inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-[4px] text-[9px] font-bold ${
                  resolvedChatModel === LLM_CHAT_MODEL_GPT56_TERRA
                    ? 'bg-violet-500/90 text-white'
                    : resolvedChatModel === 'gpt-4o'
                      ? 'bg-emerald-500/90 text-white'
                      : 'bg-sky-500/90 text-white'
                }`}
              >
                {resolvedChatModel === LLM_CHAT_MODEL_GPT56_TERRA
                  ? '5'
                  : resolvedChatModel === 'gpt-4o'
                    ? '4'
                    : '3'}
              </span>
              <select
                value={resolvedChatModel}
                onChange={(e) => onChatModelChange?.(e.target.value)}
                onMouseDown={(e) => e.stopPropagation()}
                onPointerDown={(e) => e.stopPropagation()}
                onClick={(e) => e.stopPropagation()}
                className={`nodrag nopan nowheel appearance-none bg-transparent border-0 outline-none cursor-pointer pr-4 font-medium truncate max-w-[140px] ${
                  isDarkMode ? 'text-white/80' : 'text-gray-700'
                }`}
                aria-label={lt.chatModelLabel}
              >
                <option value={LLM_CHAT_DISPLAY_MODEL_ID}>{lt.chatModelGpt35}</option>
                <option value="gpt-4o">{lt.chatModelGpt4o}</option>
                <option value={LLM_CHAT_MODEL_GPT56_TERRA}>{lt.chatModelGpt56Terra}</option>
              </select>
              <ChevronDown className="pointer-events-none absolute right-1 top-1/2 -translate-y-1/2 w-3 h-3 opacity-55" />
            </label>

            <button
              type="button"
              onClick={handleSavePrompt}
              disabled={!userInput.trim()}
              className={`shrink-0 px-2 py-1 rounded-lg text-[11px] flex items-center gap-0.5 ${
                !userInput.trim()
                  ? 'opacity-40 cursor-not-allowed'
                  : isDarkMode
                    ? 'text-white/70 hover:bg-white/10'
                    : 'text-gray-600 hover:bg-gray-100'
              }`}
              title={lt.saveButton}
            >
              <Save className="w-3 h-3" />
              {lt.saveButton}
            </button>

            <div className="flex-1" />

            {runPriceYuanbao != null && (
              <span
                className={`text-[11px] font-medium px-2 py-0.5 rounded-full shrink-0 tabular-nums border ${
                  isDarkMode
                    ? 'text-amber-200/90 bg-amber-500/15 border-amber-400/25'
                    : 'text-amber-700 bg-amber-50 border-amber-200'
                }`}
                title={lt.runPriceTooltip}
              >
                {runPriceYuanbao}
                {locale === 'en' ? ' ' : ''}
                {lt.creditsSuffix}
              </span>
            )}

            <button
              type="button"
              onClick={handleExecuteAI}
              disabled={isRunDisabled}
              className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 transition-colors ${
                isRunDisabled
                  ? isDarkMode
                    ? 'bg-white/[0.08] text-white/25 cursor-not-allowed'
                    : 'bg-black/[0.06] text-gray-400 cursor-not-allowed'
                  : isDarkMode
                    ? 'bg-white text-black hover:bg-white/90'
                    : 'bg-gray-900 text-white hover:bg-gray-800'
              }`}
              title={lt.send}
              aria-label={lt.send}
            >
              {isProcessing ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <ArrowUp className="w-3.5 h-3.5" strokeWidth={2.5} />
              )}
            </button>
          </div>
        </div>
      )}

    </div>

      {/* 图像反推：胶囊标签在输入框外（对齐文生图排版） */}
      {isImageReverseMode && (
        <div className="mt-2 flex flex-shrink-0 flex-wrap items-center gap-1.5 content-start px-0.5">
          {quickTags.map((tag, qi) => (
            <button
              key={qi}
              type="button"
              onClick={() => appendQuickTagToPersona(tag.content)}
              className={`px-2 py-0.5 rounded-full text-[11px] font-medium border transition-opacity ${tag.color} opacity-90 hover:opacity-100`}
              title={tag.label}
            >
              {tag.label}
            </button>
          ))}
        </div>
      )}

      {/* 胶囊在输入框卡片外（红框位置），换行无横向滚动；视频分析模式不显示 */}
      {!isSpecialMode && (
        <div
          ref={capsuleBarRef}
          className="mt-2 flex flex-wrap items-center gap-1.5 content-start px-0.5"
        >
          {footerCapsules.map((cap) => {
            const active = corridorChips.some((c) => c.id === cap.id);
            const canDelete = !cap.isBuiltin;
            const showDelete = capsuleManageMode && canDelete;
            return (
              <span key={cap.id} className="relative inline-flex">
                <button
                  type="button"
                  onPointerDown={(e) => {
                    if (e.button !== 0) return;
                    startCapsuleLongPress();
                  }}
                  onPointerUp={endCapsuleLongPress}
                  onPointerLeave={endCapsuleLongPress}
                  onPointerCancel={endCapsuleLongPress}
                  onClick={() => {
                    if (capsuleLongPressFiredRef.current) {
                      capsuleLongPressFiredRef.current = false;
                      return;
                    }
                    if (capsuleManageMode) return;
                    toggleCorridorChip({
                      id: cap.id,
                      name: cap.name,
                      content: cap.content,
                      color: cap.color,
                    });
                  }}
                  className={`relative px-2 py-0.5 rounded-full text-[11px] font-medium border transition-opacity select-none ${cap.color} ${
                    active ? 'ring-2 ring-offset-1 ring-sky-400/50 opacity-100' : 'opacity-90 hover:opacity-100'
                  } ${showDelete ? 'animate-llm-capsule-wiggle' : ''}`}
                  title={
                    canDelete
                      ? locale === 'en'
                        ? `${cap.name} (long-press to manage)`
                        : `${cap.name}（长按管理删除）`
                      : cap.name
                  }
                >
                  {cap.name}
                </button>
                {showDelete && (
                  <button
                    type="button"
                    className="absolute -top-1.5 -right-1.5 z-10 flex h-4 w-4 items-center justify-center rounded-full bg-rose-500 text-white shadow ring-1 ring-white/90"
                    title={lt.deletePersonaTitle}
                    aria-label={lt.deletePersonaTitle}
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      handleDeletePersona(e, cap.id, cap.name);
                    }}
                  >
                    <X className="h-2.5 w-2.5" strokeWidth={3} />
                  </button>
                )}
              </span>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default LLMInputPanel;
