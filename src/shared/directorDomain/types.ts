/**
 * AI 短剧导演台 Domain V2 — 核心实体类型。
 * 与 directorPipeline（画布节点投影 / MV）并存；短剧真理源逐步迁到此层。
 *
 * 数据语义（固定）：
 * Project Bible = 项目总规则 | Episode Bible = 单集剧情规则
 * Asset = 制作资产（Character/Scene/Prop/Voice）
 * Beat = 剧情发生了什么 | Shot = 怎么拍
 * GenerationPackage = 给视频模型的执行输入（业务 Source of Truth）
 * Adapter = Package→具体模型 | H3 = 当前执行引擎 | Review = 结果检查
 *
 * final_prompt / adapter_prompt_cache / last_compiled_prompt ≠ Source of Truth。
 * 出片只走 H3 Compiler（Bible + Assets + Shots + AudioTimeline + PerformancePlan + SystemRules）。
 * 详见 principles.ts。
 */

export const DIRECTOR_DOMAIN_SCHEMA_VERSION = 'director-domain.v2' as const;

export {
  DIRECTOR_DOMAIN_CONTRACT_VERSION,
  DRAMA_PRODUCT_PRINCIPLES_DOC,
} from './principles.js';
import type { DramaLockedCamera, DramaPrimaryPurpose } from './directorCameraSchema.js';
import type { DramaVisualEvent } from './shotPlanning.js';

/**
 * 制片流程（对齐人工步骤）：
 * 1 剧本(分集/分场/时长) → 2 画风色调 → 3 资产匹配 → 4 导演分镜 → 5 成片
 */
export type DramaDomainPhase =
  | 'visual'
  | 'ingest'
  | 'episodes'
  | 'analyze'
  /** @deprecated 旧「准备资产」；读盘时归一到 assets */
  | 'bible'
  | 'assets'
  | 'board'
  | 'videos'
  | 'review';

export const DRAMA_DOMAIN_PHASES: DramaDomainPhase[] = [
  'ingest',
  'visual',
  'episodes',
  'analyze',
  'assets',
  'board',
  'videos',
  'review',
];

export type DramaAssetStatus = 'pending' | 'generating' | 'ready' | 'error';

/** 资产生产计划状态（与实体 DramaAssetStatus 分离，UI/计划用） */
export type DramaProductionAssetStatus =
  | 'missing'
  | 'pending'
  | 'generating'
  | 'completed'
  | 'failed'
  | 'blocked';

export type DramaAssetPriority = 'P0' | 'P1' | 'P2';

export type DramaGender = 'male' | 'female' | 'other' | '';

/** 约束层级：LOCK 不可擅自变；TEMPORARY 允许剧情临时态 */
export type DramaConstraintTier = 'LOCK' | 'DEFAULT' | 'OVERRIDE' | 'TEMPORARY';

/** 依赖检查状态 */
export type DramaDependencyStatus =
  | 'READY'
  | 'WARNING'
  | 'BLOCKED'
  | 'NOT_APPLICABLE';

/**
 * Voice 在「当前生成链」中的依赖策略。
 * - REQUIRED：本流程必须有可用 Voice（如口型/音频驱动）
 * - OPTIONAL：有则更好，缺不 BLOCK
 * - POST_PRODUCTION：声音走后期，视频生成不要求
 * - NOT_APPLICABLE：本 Adapter/流程不涉及声音
 */
export type DramaVoiceDependencyMode =
  | 'REQUIRED'
  | 'OPTIONAL'
  | 'POST_PRODUCTION'
  | 'NOT_APPLICABLE';

/** 资产版本（Shot 可钉住某一版，避免改资产毁掉历史成片） */
export interface DramaAssetVersionInfo {
  version: number;
  updated_at: number;
  label?: string;
}

/** 项目内稳定说话人编号，如 S1。一次分配，跨镜不变。 */
export type DramaSpeakerId = `S${number}`;

/** 入库导演决策来源。系统硬规则不入库，由 Compiler 现算。 */
export type DramaDirectingSource = 'user' | 'llm_enhanced';

/** 出片音频模式：跟 H3 模型绑定，不是 LLM 可改事实 */
export type DramaShotAudioMode = 'character_reference' | 'lip_sync';

/**
 * 参考图「锁什么」。
 * asset role（character/scene/storyboard）说图是谁；
 * lock_intent 说 Compiler 允许它覆盖哪些视觉决策。
 */
export type DramaReferenceLockIntent =
  | 'composition'
  | 'visual_anchor'
  | 'identity'
  | 'style';

/** 嘴部：系统硬约束只区分「说话 / 非说话」，非说话不是蜡像 */
export type DramaMouthState = 'speaking' | 'closed' | 'natural';

export type DramaH3CompileSectionId = 'A' | 'B' | 'C' | 'D' | 'E' | 'F' | 'G' | 'H';

/** 通用参考图槽（Character / Scene / Prop） */
export interface DramaAssetReferenceImage {
  ref_id: string;
  /** front | full_body | profile | expression | master | main | custom */
  kind: string;
  url: string;
  label?: string;
  /** 缺省按 role 推断：storyboard→visual_anchor（画风优先），scene→visual_anchor，character→identity */
  lock_intent?: DramaReferenceLockIntent;
}

/** 人物一致性规则条目 */
export interface DramaCharacterConstraintRule {
  field: string;
  tier: DramaConstraintTier;
  note?: string;
}

export interface DramaProjectInfo {
  project_id: string;
  name: string;
  type: string;
  style: string;
  worldview: string;
  visual_style: string;
  color_style: string;
  references: string[];
  era: string;
}

/** Story Bible：世界观 / 时代 / 规则 / 禁用元素（项目级） */
export interface DramaStoryBible {
  worldview: string;
  era: string;
  rules: string[];
  forbidden_elements: string[];
  synopsis: string;
  /** 分析页手动添加的额外字段 */
  extra_fields?: { label: string; value: string }[];
}

/** Visual Bible：项目级视觉规范（文案层） */
export interface DramaVisualBible {
  style: string;
  color: string;
  camera: string;
  lighting: string;
  referenceWorks: string[];
  /** 资产生成约束，非视频 Prompt */
  negativePrompt: string;
  extra_fields?: { label: string; value: string }[];
}

/** Visual DNA — 后台电影视觉参数（对用户隐藏，由风格预设注入） */
export type DramaVisualLensMm = 18 | 24 | 35 | 50 | 85 | 135;

export interface DramaVisualDnaColor {
  /** -100 冷 ~ +100 暖 */
  temperature: number;
  /** 0–100 */
  saturation: number;
  /** 0–100 */
  contrast: number;
  /** 0–100 黑位 */
  blackLevel: number;
}

export interface DramaVisualDnaCamera {
  lens: DramaVisualLensMm;
  /** 0–100 景深强度（越高越浅） */
  depthOfField: number;
  anamorphic: boolean;
  /** 运镜 */
  movement: string;
}

export interface DramaVisualDnaLighting {
  style: string;
  direction: string;
  /** 0–100 光影对比 */
  contrast: number;
}

export interface DramaVisualDnaTexture {
  /** 0–100 胶片颗粒 */
  filmGrain: number;
  filmStock: string;
  /** 0–100 锐度 */
  sharpness: number;
}

export interface DramaVisualDnaMood {
  emotion: string;
  atmosphere: string;
}

export interface DramaVisualDnaReferenceImage {
  id: string;
  /** original | generated */
  kind: 'original' | 'generated';
  url: string;
  label: string;
  created_at: number;
}

/**
 * Visual DNA 运行时快照（绑定进 Project Visual Bible）
 * 参数不对普通用户暴露。
 */
export interface DramaVisualDNA {
  color: DramaVisualDnaColor;
  camera: DramaVisualDnaCamera;
  lighting: DramaVisualDnaLighting;
  texture: DramaVisualDnaTexture;
  mood: DramaVisualDnaMood;
  /** 来源预设 id */
  presetId: string;
  referenceImages: DramaVisualDnaReferenceImage[];
  /** 由 DNA + promptTemplate 合成的权威 cinematic prompt */
  generatedPrompt: string;
  updated_at: number;
}

/**
 * 影视级视觉风格预设（风格库卡片）
 * visualDNA 为后台参数，UI 仅展示 name / cover / tags / description。
 */
export interface VisualStylePreset {
  id: string;
  name: string;
  nameEn: string;
  coverImage: string;
  previewVideo: string;
  description: string;
  descriptionEn: string;
  tags: string[];
  /** 卡片强调色（无 cover 时作渐变） */
  accent: string;
  visualDNA: {
    color: DramaVisualDnaColor;
    camera: DramaVisualDnaCamera;
    lighting: DramaVisualDnaLighting;
    texture: DramaVisualDnaTexture;
    mood: DramaVisualDnaMood;
    /** 权威画风+色调铅字（中文） */
    promptTemplate: string;
    /** 中文对照主干（与 promptTemplate 同权威） */
    promptTemplateZh: string;
  };
}

/**
 * Project Visual Bible — 整部剧锁定的视觉方案
 * 角色 / 场景 / 分镜 / 视频生成一律继承。
 */
export interface DramaProjectVisualBible {
  presetId: string;
  presetName: string;
  coverImage: string;
  tags: string[];
  description: string;
  /** 冻结的后台 Visual DNA */
  visualDNA: DramaVisualDNA;
  /** 权威风格 Prompt（= visualDNA.generatedPrompt） */
  stylePrompt: string;
  /** AI 推荐候选（暂不接模型，可本地启发式填充） */
  recommendedPresetIds: string[];
  selected_at: number;
}

/** 视频生成后视觉一致性评分（结构预留，暂不接模型） */
export interface DramaVisualConsistencyScore {
  color: number;
  lighting: number;
  camera: number;
  filmTexture: number;
  overall: number;
  notes: string[];
  scored_at: number;
}

/** Sound Bible：项目级声音规范 */
export interface DramaSoundBible {
  voiceStyle: string;
  emotionRange: string;
  ambientSound: string[];
  musicStyle: string;
  extra_fields?: { label: string; value: string }[];
}

/** Organization Bible：帮派 / 公司 / 势力等非人物资产 */
export interface DramaOrganization {
  organization_id: string;
  name: string;
  kind: string;
  description: string;
  visual_traits: string;
  related_character_ids: string[];
  imageUrl: string;
  status: DramaAssetStatus;
  priority?: DramaAssetPriority;
  error?: string;
}

export interface DramaCharacterCostume {
  costume_id: string;
  name: string;
  prompt: string;
  images: string[];
  active: boolean;
  /** 归类：常服 / 制服 / 作战 / 礼服 / 其他 */
  tag?: string;
}

export interface DramaCharacterViews {
  front: string[];
  half: string[];
  full: string[];
  multi: string[];
  expression: string[];
  costume: string[];
}

/** Character Bible — 视觉固定 */
export interface DramaCharacterVisualLock {
  face: string;
  hair: string;
  body: string;
  clothing: string;
  specialFeature: string;
}

/** Character Bible — 状态 */
export interface DramaCharacterStates {
  normal: string;
  battle: string;
  injured: string;
}

/** Character Bible — 资产槽（与 views 并存，逐步对齐） */
export interface DramaCharacterAssetSlots {
  frontImage: string;
  sideImage: string;
  fullBodyImage: string;
  expressionImages: string[];
}

export interface DramaCharacter {
  character_id: string;
  name: string;
  age: string;
  gender: DramaGender;
  /** 身高描述，如 178cm / 偏高 */
  height: string;
  /** 高矮胖瘦 / 体型 */
  body_type: string;
  /** 发色（可与 visual.hair 并存） */
  hair_color: string;
  /** 配饰 */
  accessories: string;
  /** 材质质感 */
  material_texture: string;
  /** 身份（Character Bible） */
  identity: string;
  role: string;
  personality: string;
  backstory: string;
  relations: string[];
  /**
   * 文生图主提示词（资产生成用，非 Shot 真相）。
   * Shot 生成不得把全文重复塞进导演指令；由 Package/Adapter 按需引用。
   */
  prompt: string;
  visual: DramaCharacterVisualLock;
  /**
   * 跨镜视觉锚点 3～5 个（识别特征）。
   * 进入 GenerationPackage.character_locks，不是普通 prompt 附注。
   */
  visual_anchors: string[];
  /** 禁止模型擅自改变的项（脸型、发色、主服装等） */
  forbidden_changes: string[];
  /** 约束规则表（LOCK/DEFAULT/…） */
  constraint_rules: DramaCharacterConstraintRule[];
  /** 结构化参考图（可多张；Adapter 按引擎能力降维） */
  reference_images: DramaAssetReferenceImage[];
  states: DramaCharacterStates;
  assets: DramaCharacterAssetSlots;
  views: DramaCharacterViews;
  costumes: DramaCharacterCostume[];
  voice_id: string;
  /**
   * 项目级稳定 speaker（S1…Sn）。分析或首次迁移按出场序分配。
   * 空 = 尚未分配；禁止 LLM Patch 改。
   */
  speaker_id?: DramaSpeakerId;
  /** 主形象图（快捷 Master；等同 reference master / views.full[0]） */
  imageUrl: string;
  status: DramaAssetStatus;
  /** 资产版本；Shot 可钉住 */
  asset_version: number;
  asset_version_label?: string;
  /** 旧数据缺锚点/锁时标记，勿 AI 伪造补全 */
  needs_reanalyze?: boolean;
  needs_review?: boolean;
  priority?: DramaAssetPriority;
  error?: string;
}

export interface DramaSceneVariant {
  variant_id: string;
  /** day | night | rain | damaged | custom */
  tag: string;
  label: string;
  images: string[];
}

export interface DramaSceneAsset {
  scene_id: string;
  name: string;
  location: string;
  kind: string;
  time_default: string;
  weather_default: string;
  mood: string;
  /**
   * 场景资产生成提示词（非 Shot 真相）。
   * 同场多镜必须继承 Scene Lock，禁止每镜自由重造场景。
   */
  prompt: string;
  imageUrl: string;
  variants: DramaSceneVariant[];
  /** Scene Bible */
  spatial_structure: string;
  /** 建筑风格 */
  architecture: string;
  materials: string;
  fixed_elements: string[];
  lighting: string;
  /** 光源描述 */
  light_sources: string;
  weather: string;
  /** 主色调 */
  color_palette: string;
  /** 镜头默认可视区域 */
  camera_visible_area: string;
  /** 禁止出现的元素（时代/世界观冲突等） */
  forbidden_elements: string[];
  camera_reference: string;
  time_variants: DramaSceneVariant[];
  reference_images: DramaAssetReferenceImage[];
  status: DramaAssetStatus;
  asset_version: number;
  asset_version_label?: string;
  needs_reanalyze?: boolean;
  needs_review?: boolean;
  priority?: DramaAssetPriority;
  error?: string;
}

export interface DramaPropState {
  state_id: string;
  name: string;
  images: string[];
}

export interface DramaProp {
  prop_id: string;
  name: string;
  description: string;
  material: string;
  appearance: string;
  prompt: string;
  imageUrl: string;
  reference_images: DramaAssetReferenceImage[];
  states: DramaPropState[];
  related_character_ids: string[];
  related_scene_ids: string[];
  status: DramaAssetStatus;
  asset_version: number;
  asset_version_label?: string;
  needs_reanalyze?: boolean;
  needs_review?: boolean;
  priority?: DramaAssetPriority;
  error?: string;
}

export interface DramaCreature {
  creature_id: string;
  name: string;
  appearance: string;
  behavior: string;
  motion_traits: string;
  prompt: string;
  imageUrl: string;
  status: DramaAssetStatus;
  priority?: DramaAssetPriority;
  error?: string;
}

/**
 * Voice Identity = 谁的声音（角色声线身份，跨镜稳定）。
 * 与 Voice Performance（本镜怎么说）严格分开。
 */
export interface DramaVoice {
  voice_id: string;
  character_id: string;
  model: string;
  /** @deprecated 兼容旧字段；等同 identity.timbre */
  timbre: string;
  /** @deprecated 兼容；倾向写入 identity.voice_character */
  voiceStyle: string;
  /** 参考音频 URL */
  sample_url: string;
  /**
   * 声音提示词（名字 + 年龄 + 性别 + 口语化音色描述 + 剧本 2～3 句台词）。
   * 卡片展示与送豆包均用全文；模型自行区分台词与描述。
   */
  sample_text: string;
  language: string;
  language_style: string;
  emotion_range: string;
  /** Voice Identity 结构化字段 */
  identity: DramaVoiceIdentity;
  /**
   * 系统提示音形象图（全息面板等非人物视觉）。
   * 仅系统声实体使用；不进 bible.characters / H3 Subject。
   */
  imageUrl?: string;
  /** 系统形象生图提示词 */
  image_prompt?: string;
  /** 系统形象生图/上传状态（与声音 status 分离） */
  image_status?: DramaAssetStatus;
  /** 样本上传 / AI 生成状态 */
  status?: DramaAssetStatus;
  asset_version: number;
  asset_version_label?: string;
  needs_reanalyze?: boolean;
  needs_review?: boolean;
  error?: string;
}

/** 声音身份（跨镜 LOCK） */
export interface DramaVoiceIdentity {
  gender: string;
  age_range: string;
  pitch: string;
  timbre: string;
  accent: string;
  pronunciation: string;
  dry_wet: string;
  speaking_rate: string;
  voice_character: string;
  reference_audio: string;
}

/**
 * 本镜表演指导（可随 Shot/对白变化）。
 * 不得写回 Voice Identity。
 */
export interface DramaVoicePerformance {
  emotion: string;
  delivery: string;
  pause: string;
  stress: string;
  pitch_change: string;
  speaking_rate: string;
  performance: string;
}

export interface DramaProjectBible {
  project: DramaProjectInfo;
  /** Story Bible */
  story: DramaStoryBible;
  /** Visual Bible（项目级文案） */
  visual: DramaVisualBible;
  /**
   * Visual DNA 快照（与 projectVisualBible.visualDNA 同步）
   * 供下游直接读取。
   */
  visualDNA: DramaVisualDNA;
  /** Project Visual Bible：用户选定的整片视觉方案 */
  projectVisualBible: DramaProjectVisualBible;
  /** Sound Bible（项目级） */
  sound: DramaSoundBible;
  plot: string;
  relationships: string;
  script_keywords: string[];
  characters: DramaCharacter[];
  scenes: DramaSceneAsset[];
  props: DramaProp[];
  creatures: DramaCreature[];
  voices: DramaVoice[];
  /** Organization Bible */
  organizations: DramaOrganization[];
  /**
   * 用户在素材页主动删掉的角色名（规范化小写无空格）。
   * ensureAppearingCharactersInBible 不得按剧本/分镜再自动补回。
   */
  suppressed_character_names: string[];
  /** 用户确认圣经的时间戳；0=未确认 */
  confirmed_at: number;
}

export interface DramaDialogueLine {
  dialogue_id: string;
  character_id: string;
  character_name: string;
  text: string;
  /** 本句表演（Voice Performance）；不写入 Voice Identity */
  performance?: DramaVoicePerformance;
}

/**
 * 场次 / 剧情 Beat。
 * Scene = 在哪里；Beat = 这一段剧情发生了什么；Shot = 怎么拍。
 * 保留场次字段，并扩展真正剧情 Beat 语义（一个 Beat 可对应多 Shot）。
 */
export interface DramaSceneBeat {
  scene_beat_id: string;
  scene_no: string;
  scene_asset_id: string;
  location_name: string;
  int_ext: string;
  day_night: string;
  weather: string;
  cast_ids: string[];
  prop_ids: string[];
  creature_ids: string[];
  /** @deprecated 兼容；等同 purpose */
  dramatic_goal: string;
  /** 剧情目的 */
  purpose: string;
  /** 事件：发生了什么 */
  event: string;
  /** 冲突 */
  conflict: string;
  /** 结果 */
  result: string;
  emotion: string;
  /** 本 Beat 出场人物（可与 cast_ids 同步） */
  characters: string[];
}

/**
 * 结构化情绪：贯穿 Visual Event → Shot → Breakdown → H3 Prompt 全链路。
 * 转换可以（emotion → visible performance），但不得覆盖或删除主导情绪。
 */
export interface DramaEmotion {
  /** 主导情绪：愤怒/疑惑/恐惧/释然/压抑/震惊/冷漠... */
  primary: string;
  /** 辅助情绪/状态：压抑中的克制/混合的震惊与恐惧... */
  secondary?: string;
  /** 0-1 强度：0.2轻微 / 0.5中等 / 0.7中强 / 0.9极强；前端不直接暴露滑块，用自然语言渲染 */
  intensity: number;
  /** 情绪变化弧线（可选）：克制→加剧 / 从震惊转为恐惧 / 持续稳定... */
  arc?: string;
}

/**
 * 本镜角色表演位：人物「是谁」由 Character Asset 决定；
 * 「这一镜怎么演」由 Shot Cast 决定。严禁混为一谈。
 */
export interface DramaShotCastMember {
  character_id: string;
  /** left | right | center | background | foreground | custom */
  screen_position: string;
  action: string;
  /** 可见表情与肢体微相（眉压低/下颌收紧/瞳孔放大...），区别于抽象 emotion */
  expression?: string;
  emotion: DramaEmotion | string;
  performance: string;
  dialogue_ids: string[];
  voice_id: string;
  /** 本镜临时覆盖（TEMPORARY），如湿身/破损 */
  temporary_state?: string;
  /**
   * 本镜造型覆盖（SHOT-LEVEL）：指定本镜该角色使用的造型 costume_id。
   * 不影响其他镜头；为空时回退角色 active costume。
   * 切换后参考图按此 costume 解析（resolveCharacterMasterReferenceUrl 传 tag）。
   */
  costume_id?: string;
}

/** 镜头层实体 — 一个 Shot = 一个实际生成的视频镜头 */
/**
 * @deprecated 遗留自然语言拍；执行真相源为 DramaTimelineEvent。
 * 仅用于弱迁移与 UI 兼容展示。
 */
export interface DramaShotTimelineBeat {
  start_sec: number;
  end_sec: number;
  text: string;
  /** action | camera | dialogue | sfx | env | performance */
  kind?: 'action' | 'camera' | 'dialogue' | 'sfx' | 'env' | 'performance' | string;
}

/**
 * AI导演执行表 · 时间轴视听事件（唯一时间轴真相源）。
 * 禁止用「有人说话」等无主体描述；对白必须绑 dialogue_character_id。
 */
export interface DramaTimelineEvent {
  event_id: string;
  start_sec: number;
  end_sec: number;
  character_ids: string[];
  /** 可拍摄的画面动作（起止/过程/落点） */
  visual_action: string;
  /** 人物状态/表演（多角色时写清各自） */
  character_state: string;
  /** 相对站位 / 空间位置 */
  position: string;
  expression: string;
  eyeline: string;
  /** 对白原文；无台词为空串 */
  dialogue: string;
  /** 说话人 character_id；无台词为空串 */
  dialogue_character_id: string;
  /** 环境音效列表（不绑定人物、不参与口型） */
  environment_audio: string[];
  /** 本段是否触发口型（仅 dialogue 绑定角色时可 true） */
  lip_sync: boolean;
  /** 本段机位/运镜（景别·角度·运镜） */
  camera_action: string;
}

/**
 * 本镜对白事实轴。LLM 只读；禁止改 speaker / 文本 / 起止秒。
 * 空则 Compiler 从 timeline_events 派生。
 */
export interface DramaAudioEvent {
  event_id: string;
  start_sec: number;
  end_sec: number;
  speaker_id: DramaSpeakerId;
  character_id: string;
  text: string;
  emotion?: string;
  pause_before_sec?: number;
  pause_after_sec?: number;
  /** 空 = 继承本镜 audio_mode */
  audio_mode?: DramaShotAudioMode | 'inherit';
}

/**
 * 镜头表演加细。source 仅 user | llm_enhanced。
 * 系统口型规则不入库，见 Compiler F 段。
 */
export interface DramaPerformanceBeat {
  beat_id: string;
  character_id: string;
  speaker_id?: DramaSpeakerId;
  audio_event_id?: string;
  timeline_event_id?: string;
  facial_expression?: string;
  eye_direction?: string;
  mouth_state?: DramaMouthState;
  breathing?: string;
  head_movement?: string;
  body_movement?: string;
  hand_movement?: string;
  emotional_change?: string;
  post_dialogue_reaction?: string;
  emotion_intensity?: string;
  emotional_transition?: string;
  reaction_to_other_character?: string;
  rain_interaction?: string;
  clothing_motion?: string;
  prop_interaction?: string;
  subtle_background_motion?: string;
  source: DramaDirectingSource;
  updated_at?: number;
}

/** LLM/用户对运镜与环境微动作的加细，不替代 Shot.size/move/angle 事实 */
export interface DramaShotDirectingEnhance {
  camera_movement?: string;
  framing?: string;
  focus_behavior?: string;
  subject_attention?: string;
  subtle_environment_action?: string;
  rain_interaction?: string;
  clothing_motion?: string;
  prop_interaction?: string;
  subtle_background_motion?: string;
  source: DramaDirectingSource;
  updated_at?: number;
}

export interface DramaDirectingEnhancePatch {
  schema: 'drama-directing-enhance.v1';
  shot_id: string;
  performance_plan?: Array<Partial<DramaPerformanceBeat> & { character_id?: string }>;
  directing_enhance?: Partial<Omit<DramaShotDirectingEnhance, 'source' | 'updated_at'>>;
}

export interface DramaDirectingEnhanceRevision {
  at: number;
  accepted: boolean;
  patch: DramaDirectingEnhancePatch;
  original_performance_plan: DramaPerformanceBeat[];
  enhanced_performance_plan: DramaPerformanceBeat[];
  original_directing_enhance?: DramaShotDirectingEnhance;
  enhanced_directing_enhance?: DramaShotDirectingEnhance;
  blocked: Array<{ path: string; reason: string }>;
}

/** 导演拆戏节拍：LLM 判断 + 规则库约束后的内部结构，禁止当最终 Prompt */
export type DramaAxisStatus = 'hold' | 'cross' | 'n/a';
export type DramaContinuityStatus = 'ok' | 'warn' | 'break';
export type DramaEmotionTrend = 'rise' | 'hold' | 'fall';

export type DramaBeatEndState = {
  pose: 'seated' | 'standing' | 'down' | string;
  action: 'stationary' | 'moving' | string;
  gaze: string;
  /** 视线落点：角色 ID 或地点 token（如 building_entrance） */
  gazeTarget?: string;
  propState: string;
  spatialState: string;
  vehicleState?: 'moving' | 'stopped' | 'none' | string;
  helmetState?: 'worn' | 'removed' | 'none' | string;
  facing?: string;
};

export interface DramaDirectingBeat {
  beatId: string;
  purpose: string;
  event: string;
  emotion: string;
  emotionIntensity: number;
  characters: string[];
  action: string;
  dialogue: string;
  dialogueCharacterId: string;
  audioStart: number;
  audioEnd: number;
  duration: number;
  shotType: string;
  camera: string;
  lens: string;
  composition: string;
  movement: string;
  performance: string;
  continuityIn: string;
  continuityOut: string;
  lipSync: boolean;
  environmentSound: string;
  primaryPurpose?: DramaPrimaryPurpose;
  lockedCamera?: DramaLockedCamera;
  visiblePerformance?: string;
  /** 本拍主要视线对象的 character_id 或地点 token */
  gazeTarget?: string;
  /** 最终 Prompt 只输出一次的可见动作（不含主体前缀） */
  visibleAction?: string;
  endState?: DramaBeatEndState;
}

export interface DramaDirectingAnswers {
  story: string;
  purpose: string;
  visualSubject: string;
  emotion: string;
  emotionTrend: DramaEmotionTrend;
  keyInfo: string;
  seeFirst: string;
  seeNext: string;
  hasDialogue: boolean;
  needsLipsync: boolean;
  nextHandoff: string;
}

export interface DramaShotDirectingBreakdown {
  schema: 'drama-directing-breakdown.v1';
  shot_id: string;
  answers: DramaDirectingAnswers;
  beats: DramaDirectingBeat[];
  axisStatus: DramaAxisStatus;
  axisNote?: string;
  continuityStatus: DramaContinuityStatus;
  continuityNotes: string[];
  sourceFingerprint: string;
  updated_at: number;
  source: 'rules' | 'llm' | 'user';
}

export interface DramaShot {
  shot_id: string;
  /** 关联剧情 Beat（现为 scene_beat_id） */
  scene_beat_id: string;
  /** 别名语义：beat_id === scene_beat_id */
  beat_id: string;
  shot_no: string;
  duration_sec: number;
  purpose: string;
  size: string;
  framing: string;
  camera: string;
  angle: string;
  focal: string;
  move: string;
  /** 本镜新增导演意图（勿重复贴 Character/Scene Bible 全文） */
  action: string;
  expression: string;
  eyeline: string;
  blocking: string;
  /** 构图 */
  composition: string;
  lighting: string;
  /** 本镜光影覆盖（OVERRIDE） */
  lighting_override: string;
  atmosphere: string;
  environment: string;
  vfx: string;
  dialogue: DramaDialogueLine[];
  sfx: string;
  music_note: string;
  /** 本镜唯一导演目的：establish|action|reaction|dialogue|reveal|… */
  dramatic_purpose: string;
  /** 观众这一镜最该看见什么 */
  visual_focus: string;
  transition_in: string;
  transition_out: string;
  visual_event_ids: string[];
  /** 多人角色 ID（正式能力） */
  character_ids: string[];
  /** 用户主动删除的角色 ID（自动匹配不会再加回来） */
  removed_character_ids: string[];
  /** 本镜 Cast：每人站位/动作/情绪/表演 */
  cast: DramaShotCastMember[];
  scene_asset_id: string;
  prop_ids: string[];
  /** 导演指令中明确要求、缺失则 BLOCK 的关键道具 */
  required_prop_ids: string[];
  creature_ids: string[];
  voice_ids: string[];
  continuity_notes: string;
  costume_notes: string;
  package_id: string;
  /**
   * 历史对照。出片 Compiler 不读取。导演增强不再写入本字段。
   */
  final_prompt: string;
  /**
   * 历史 Adapter 缓存。出片 Compiler 不读取。
   */
  adapter_prompt_cache: string;
  /**
   * 最近一次成功 Compiler 输出。调试用，不是真相源。
   * 数据变更后必须重新编译。
   */
  last_compiled_prompt?: string;
  /**
   * MiniMax skill 优化后的出片稿。有值则生成视频时优先发送这一份。
   * 改切段/时间轴后应清空，避免用过期稿。
   */
  h3_skill_prompt?: string;
  /** 生成 h3_skill_prompt 时所用的 Compiler 原文（用于判断是否过期） */
  h3_skill_prompt_from?: string;
  /** 当前切段/编译稿所依据的分镜建议指纹；与上游不一致则显示「更新提示词」 */
  prompt_source_fingerprint?: string;
  /** 钉住的资产版本（空=用资产当前版） */
  scene_asset_version?: number;
  character_asset_versions?: Record<string, number>;
  prop_asset_versions?: Record<string, number>;
  voice_asset_versions?: Record<string, number>;
  /** 本镜 Voice 依赖策略；默认跟随 session/meta */
  voice_dependency_mode?: DramaVoiceDependencyMode;
  model_params: Record<string, string>;
  storyboard_image_url: string;
  /**
   * 出片是否把本镜分镜图当作参考图。
   * - true：必须用分镜（缺图会先触发生成）；参考槽 = 分镜+人物+道具+生物（不带场景）
   * - false：不用分镜；参考槽 = 场景+人物+道具+生物
   * - 缺省：有分镜图则同 true（兼容旧数据）；无图则同 false，可直接出片
   */
  use_storyboard_as_video_ref?: boolean;
  video_url: string;
  video_status: string;
  video_node_id: string;
  /**
   * 本镜成片音轨（豆包 1.0：对白+环境音，可挂角色参考音）。
   * 出片时可作 H3 multi 参考音。
   */
  audio_url: string;
  audio_status: string;
  audio_error?: string;
  /**
   * @deprecated 遗留自然语言时间轴；执行请用 timeline_events。
   */
  timeline_beats: DramaShotTimelineBeat[];
  /**
   * AI导演执行表时间轴事件（画面切段真相源）：画面/人物/对白/环境音/口型/机位。
   */
  timeline_events: DramaTimelineEvent[];
  /**
   * 对白事实轴。空则 Compiler 从 timeline_events 派生。
   * LLM 不得修改。
   */
  audio_timeline?: DramaAudioEvent[];
  /**
   * 本镜合成音是否已含环境底噪。
   * 缺省：h3-audio 视为 true；h3-multi 视为 false。
   */
  audio_contains_environment?: boolean;
  performance_plan?: DramaPerformanceBeat[];
  directing_enhance?: DramaShotDirectingEnhance;
  directing_enhance_revision?: DramaDirectingEnhanceRevision;
  /** 导演拆戏层：内部分析，不是最终 H3 Prompt */
  directing_breakdown?: DramaShotDirectingBreakdown;
  needs_review?: boolean;
  /** 本镜执行表确认时间；>0 表示已确认本镜，可单镜出片 */
  confirmed_at?: number;
  /** v3：关联 Shot Intent（Beat Coverage 校验靠它） */
  intent_id?: string;
  /** v3：character_id → costume_tag（防换装穿帮） */
  costume_tags?: Record<string, string>;
}

// ================= v3：Narrative Beat × Director Beat × Shot Intent =================

/** 峰值强调联合类型：校验只查"是否命中一种"，不限定具体哪种 */
export type VisualEmphasis =
  | 'close_up'
  | 'push_in'
  | 'isolation'
  | 'composition_shift'
  | 'silence_hold'
  | 'reaction'
  | 'reveal_object';

/** ① 剧情层：这段故事发生了什么变化 */
export interface DramaNarrativeBeat {
  beat_id: string; // NB01
  dramatic_function: 'setup' | 'conflict' | 'reveal' | 'climax' | 'turn' | 'suspense';
  /** ⭐ 核心：观众这一拍结束后新知道了什么（必须可从原文/see/dialogue 推导，禁止情绪形容词） */
  audience_change: string;
  /** 情绪走向，如 "慌张 → 绝望" */
  emotion_arc: string;
  scene: string;
  /** 关联 visual_events（A 事件全覆盖靠这里） */
  event_ids: string[];
}

/** ② 导演层：导演决定怎么呈现 */
export interface DramaDirectorBeat {
  director_beat_id: string; // DB01
  narrative_beat_id: string;
  director_function: 'establish' | 'reveal' | 'reaction' | 'confrontation' | 'action' | 'impact';
  /** 峰值节拍必须声明一种 */
  visual_emphasis?: VisualEmphasis;
  /** 推荐时长范围 */
  target_seconds: [number, number];
}

/** ③ 意图层：为什么需要这个镜头 — 本方案的灵魂增量 */
export interface DramaShotIntent {
  intent_id: string; // SI01
  director_beat_id: string;
  purpose: 'establish' | 'reveal' | 'action' | 'reaction' | 'relationship' | 'impact' | 'transition';
  /** 给观众看什么（画面内容一句话） */
  visual_information: string;
  /** 本镜结束观众知道了什么新东西 */
  audience_change: string;
  /** 主体 */
  subject: string[];
  /** ⭐ 本 intent 内可视化变化次数 → shotPlan 据此定镜数 */
  visual_change_count: number;
  visual_emphasis?: VisualEmphasis;
  /** 承接上一镜（防穿帮） */
  transition_from_previous?: string;
}

/** v3 Narrative Planning 三层输出 */
export interface DramaNarrativePlanningResult {
  narrative_beats: DramaNarrativeBeat[];
  director_beats: DramaDirectorBeat[];
  shot_intents: DramaShotIntent[];
}

export type DramaRefImageRole =
  | 'style'
  | 'storyboard'
  | 'character'
  | 'scene'
  | 'prop'
  | 'creature';

export interface DramaPackageRefImage {
  url: string;
  role: DramaRefImageRole;
  name: string;
  asset_id?: string;
  asset_version?: number;
  lock_intent?: DramaReferenceLockIntent;
}

/** Character Lock 进入 Package（跨镜一致性） */
export interface DramaPackageCharacterLock {
  character_id: string;
  name: string;
  asset_version: number;
  reference_url: string;
  visual_anchors: string[];
  forbidden_changes: string[];
  identity: string;
  gender: string;
  clothing: string;
}

/** Scene Lock 进入 Package */
export interface DramaPackageSceneLock {
  scene_id: string;
  name: string;
  asset_version: number;
  reference_url: string;
  spatial_structure: string;
  architecture: string;
  materials: string;
  fixed_elements: string[];
  lighting: string;
  light_sources: string;
  time_of_day: string;
  weather: string;
  color_palette: string;
  camera_visible_area: string;
  forbidden_elements: string[];
}

export interface DramaPackagePropRef {
  prop_id: string;
  name: string;
  asset_version: number;
  reference_url: string;
  material: string;
  appearance: string;
}

export interface DramaPackageVoiceRef {
  voice_id: string;
  character_id: string;
  asset_version: number;
  identity: DramaVoiceIdentity;
  reference_audio: string;
  /** 本镜表演（可空） */
  performance?: DramaVoicePerformance;
}

export interface DramaPackageShotDirection {
  purpose: string;
  action: string;
  blocking: string;
  composition: string;
  environment: string;
  duration_sec: number;
  cast: DramaShotCastMember[];
}

export interface DramaPackageCameraDirection {
  size: string;
  framing: string;
  camera: string;
  angle: string;
  focal: string;
  move: string;
  lighting_override: string;
}

/**
 * GenerationPackage = 业务 Source of Truth（给 Adapter 的完整执行输入）。
 * Asset Reference + Constraint > Text Prompt。
 * prompt_* / adapter_prompt_cache 仅为兼容与调试缓存。
 */
export interface DramaGenerationPackage {
  package_id: string;
  shot_id: string;
  adapter_id: string;
  adapter_version: string;
  /** 结构化引用 */
  scene_reference: DramaPackageSceneLock | null;
  character_references: DramaPackageCharacterLock[];
  prop_references: DramaPackagePropRef[];
  voice_assets: DramaPackageVoiceRef[];
  project_constraints: {
    visual_style: string;
    style_prompt: string;
    era: string;
    worldview: string;
    forbidden_elements: string[];
    aspect_ratio: string;
  };
  character_locks: DramaPackageCharacterLock[];
  scene_locks: DramaPackageSceneLock[];
  visual_style: string;
  shot_direction: DramaPackageShotDirection;
  performance_direction: string;
  camera_direction: DramaPackageCameraDirection;
  dialogue: DramaDialogueLine[];
  sound_direction: string;
  forbidden_elements: string[];
  /** 扁平参考图列表（Adapter 降维用） */
  ref_images: DramaPackageRefImage[];
  /**
   * @deprecated 兼容旧读取；应由 Adapter 从结构化字段生成
   */
  prompt_text: string;
  /**
   * @deprecated 兼容；同 adapter 输出缓存
   */
  prompt_structured: string;
  /** Adapter 提示词缓存 */
  adapter_prompt_cache: string;
  audio_refs: string[];
  prev_shot_summary: string;
  dependency_status?: DramaDependencyStatus;
  created_at: number;
  version: number;
}

export type ContinuitySeverity = 'info' | 'warn' | 'error';

export interface ContinuityIssue {
  issue_id: string;
  shot_id: string;
  prev_shot_id?: string;
  type: string;
  severity: ContinuitySeverity;
  message: string;
}

export type DramaReviewStatus = 'pass' | 'warn' | 'fail' | 'pending';

/** 分镜建议节奏挡位：20秒长视频高密度 / 15秒高密度（默认）/ 短剧快切 / 正剧细致感 */
export type DramaShotPlanPaceGear = 'dense_20s' | 'dense_15s' | 'short_drama' | 'cinematic';

/** 分镜建议：时段枚举（分析剧情后必填其一） */
export const DRAMA_SHOT_TIME_OF_DAY_OPTIONS = [
  '朦胧亮',
  '日出',
  '正午',
  '下午',
  '傍晚',
  '晚上',
  '深夜',
  '黎明',
] as const;

export type DramaShotTimeOfDay = (typeof DRAMA_SHOT_TIME_OF_DAY_OPTIONS)[number];

export function normalizeDramaShotPlanPaceGear(raw: unknown): DramaShotPlanPaceGear {
  const s = String(raw || '').trim();
  if (s === 'cinematic' || s === '正剧' || s === '正剧细致感') return 'cinematic';
  if (s === 'short_drama' || s === '短剧快切' || s === '短剧快节奏') return 'short_drama';
  if (s === 'dense_15s' || s === '15秒高密度' || s === '15秒') return 'dense_15s';
  if (s === 'dense_20s' || s === '20秒高密度' || s === '20秒' || s === '长视频高密度') return 'dense_20s';
  return 'short_drama';
}

/** 把 LLM/手写时段归一到固定词表；无法识别则原样截断保留 */
export function normalizeDramaShotTimeOfDay(raw: unknown): string {
  const t = String(raw || '').trim();
  if (!t) return '';
  for (const opt of DRAMA_SHOT_TIME_OF_DAY_OPTIONS) {
    if (t === opt || t.startsWith(opt)) return opt;
  }
  if (/朦朦?亮|天刚亮|破晓前|蒙蒙亮/.test(t)) return '朦胧亮';
  if (/日出|太阳升|朝阳升起|清晨升起/.test(t)) return '日出';
  if (/正午|中午|当空|当红|艳阳|烈日/.test(t)) return '正午';
  if (/下午|午后/.test(t)) return '下午';
  if (/傍晚|黄昏|半晚|日落|夕阳|暮色/.test(t)) return '傍晚';
  if (/深夜|午夜|半夜|凌晨/.test(t)) return '深夜';
  if (/黎明|破晓/.test(t)) return '黎明';
  if (/晚上|夜晚|夜里|夜间|(^|[^深])夜/.test(t)) return '晚上';
  return t.slice(0, 12);
}

/** 表里「时段环境」展示/编辑用 */
export function formatDramaShotTimeEnv(timeOfDay: string, environment: string): string {
  const a = normalizeDramaShotTimeOfDay(timeOfDay);
  const b = String(environment || '').trim();
  if (a && b) return `${a} · ${b}`;
  return a || b;
}

export function parseDramaShotTimeEnv(raw: string): { time_of_day: string; environment: string } {
  const s = String(raw || '').trim();
  if (!s) return { time_of_day: '', environment: '' };
  const split = s.match(/^(.+?)\s*[·•｜|]\s*(.+)$/);
  if (split) {
    return {
      time_of_day: normalizeDramaShotTimeOfDay(split[1]),
      environment: String(split[2] || '').trim().slice(0, 40),
    };
  }
  for (const opt of DRAMA_SHOT_TIME_OF_DAY_OPTIONS) {
    if (s === opt) return { time_of_day: opt, environment: '' };
    if (s.startsWith(opt)) {
      return {
        time_of_day: opt,
        environment: s.slice(opt.length).replace(/^[·•｜|\s]+/, '').trim().slice(0, 40),
      };
    }
  }
  return { time_of_day: normalizeDramaShotTimeOfDay(s), environment: '' };
}

/** Review 一致性维度（可先人工，后接视觉模型） */
export interface DramaReviewConsistencyScores {
  character_consistency: number;
  clothing_consistency: number;
  scene_consistency: number;
  prop_consistency: number;
  visual_style_consistency: number;
  motion_quality: number;
  dialogue_quality: number;
}

export interface DramaReviewResult {
  shot_id: string;
  score: number;
  status: DramaReviewStatus;
  issues: ContinuityIssue[];
  suggestions: string[];
  reviewed_at: number;
  consistency?: DramaReviewConsistencyScores;
  verdict?: 'PASS' | 'WARNING' | 'FAIL';
}

/** 节点内轻量指针 + 会话摘要（大对象落盘 director-v2/） */
export interface DramaDirectorNodeMeta {
  schemaVersion: typeof DIRECTOR_DOMAIN_SCHEMA_VERSION;
  /** shot-contract.v1 等；旧盘缺省时由 migration 填入 */
  contract_version: string;
  phase: DramaDomainPhase;
  /** 工程内相对根：director-v2 */
  store_rel: string;
  chatModel: string;
  imageModel: string;
  videoBatchModel: string;
  videoBatchLipsyncModel: string;
  /**
   * 出片清晰度：MiniMax-H3 为 480p|720p（全能参考等非口型镜）。
   */
  videoBatchResolution: string;
  /**
   * 口型同步清晰度：MiniMax-H3 为 480p|720p。
   */
  videoBatchLipsyncResolution: string;
  stylePresetId: string;
  globalStyle: string;
  styleReferenceImageUrl: string;
  /**
   * 画幅：用户选择竖屏/横屏
   * '9:16' = 竖屏；'16:9' = 横屏
   */
  aspect_ratio: string;
  source_script: string;
  /** 整本小说/剧本原文（分集前） */
  source_novel: string;
  analyze_confirmed: boolean;
  /**
   * 导演表确认时间戳；>0 表示已确认，可出片并进入成片。
   * 用户流程：先确认素材，再确认导演表。
   */
  board_confirmed_at: number;
  /**
   * 素材确认时间戳；>0 表示已确认，可进导演分镜。
   */
  assets_confirmed_at: number;
  /**
   * 旧 8 步工程打开时：提示部分阶段需按新 5 步重新确认。
   * 非破坏性；用户确认后可清除。
   */
  needs_stage_reconfirm?: boolean;
  migrated_from_v1: boolean;
  /**
   * 默认 Voice 依赖策略（单镜可覆盖）。
   * 纯画面 H3 multi 通常为 POST_PRODUCTION 或 NOT_APPLICABLE。
   */
  default_voice_dependency_mode: DramaVoiceDependencyMode;
  /**
   * 分镜建议挡位：短剧快节奏 / 正剧细致感。
   * 分析本集与「重新生成分镜建议」共用。
   */
  shotPlanPaceGear?: DramaShotPlanPaceGear;
  /**
   * 时长分配节奏（独立于 shotPlanPaceGear）：standard | fast | slow
   */
  durationPaceStyle?: 'standard' | 'fast' | 'slow' | string;
  /** 分镜表总时长上限（秒）；空/0 = 不压缩 */
  durationTotalCapSec?: number;
  isGenerating: boolean;
  error: string;
}

/** 分集文档：先入库分集，再按集分析制作 */
export interface DramaEpisode {
  episode_id: string;
  episode_no: number;
  title: string;
  text: string;
  analyzed: boolean;
  updated_at: number;
}

/** Episode Bible — 剧情节拍 */
export interface DramaEpisodeBeat {
  hook: string;
  conflict: string;
  turningPoint: string;
  climax: string;
  endingHook: string;
}

/** Episode Bible — 节奏点 */
export interface DramaEpisodePacingPoint {
  /** 0–100 时间百分比，或秒数（见 unit） */
  at: number;
  unit: 'pct' | 'sec';
  label: string;
  emotion: string;
  intensity: number;
  is_spike: boolean;
}

export interface DramaEpisodePacing {
  timeline: DramaEpisodePacingPoint[];
  emotion_curve: number[];
  spike_labels: string[];
}

/** 标准化人设（供自动拆镜；与外貌定妆分开） */
export interface DramaCharacterDossier {
  /** C-01 */
  code: string;
  /** 主角/配角/反派/功能性角色 */
  character_type: string;
  age: string;
  /** 职业+经济层级 */
  identity: string;
  desire: string;
  fear: string;
  surface_personality: string;
  deep_personality: string;
  /** 微表情/肢体 JSON 或短句 */
  emotion_signals: string;
  signature_actions: string;
  dialogue_style: string;
  subtext_rule: string;
  relation_to_lead: string;
  scene_anchor: string;
  /** 触发场景 → 强制动作，供拆镜检索 */
  action_index: string;
}

export type DramaCharacterDossierRow = DramaCharacterDossier & { name: string };

/** 本集人物导演备注（表演向） */
export interface DramaCharacterDirecting {
  character_id: string;
  name: string;
  positioning: string;
  episode_goal: string;
  psychological_arc: string;
  key_actions: string;
  performance_focus: string;
  relationship_changes: string;
  dossier?: DramaCharacterDossier;
}

/**
 * 分镜建议（Shot Planning 阶段产出；分析阶段只出 Visual Events）
 * 确认素材后再转正式 DramaShot。directingBreakdown 不得新增本列表。
 * action = 画面动作；purpose = 镜头目的（叙事任务，不是动作复述）。
 */
export interface DramaShotSuggestion {
  suggestion_id: string;
  scene: string;
  shot: string;
  purpose: string;
  size: string;
  camera: string;
  move: string;
  action: string;
  dialogue: string;
  sound: string;
  /** 演员情绪：[主导情绪]（微表情/肢体…），转折写从A转向B */
  emotion_play: string;
  /** 对白潜台词（不得写入可说出台词） */
  subtext: string;
  lighting: string;
  /** 构图/站位 */
  blocking: string;
  /**
   * 时段：朦胧亮 / 日出 / 正午 / 下午 / 傍晚 / 晚上 / 深夜 / 黎明
   * （由剧情与场次推断，不是光影技术词）
   */
  time_of_day: string;
  /** 环境简述：天气/室内外/可见景物，≤20 字 */
  environment: string;
  /**
   * 当前生效时长（秒，允许小数，如 4.0）。
   * 导演/剪辑参考基准；出片档位另用 snapToTier，不强制覆盖本字段。
   */
  duration_sec: number;
  /** 为何选该时长，如 信息闪现 / 赶路单句；引擎重算时写入 reason */
  duration_why: string;
  /** 引擎置信区间下限（秒） */
  duration_min?: number;
  /** 引擎置信区间上限（秒） */
  duration_max?: number;
  /** 上次引擎建议值（秒）；与 duration_sec 分离，便于区分人工改写 */
  duration_ai?: number;
  /** true 时「重新计算 / 总时长压缩」不得覆盖 duration_sec */
  duration_locked?: boolean;
  cast_names: string[];
  dramatic_purpose?: string;
  visual_focus?: string;
  transition_in?: string;
  transition_out?: string;
  visual_event_ids?: string[];
  /** 本镜用到的道具名（与素材准备 props.name 对齐，出片时按名绑定 prop_ids） */
  prop_names?: string[];
  /** 本镜用到的生物名（与素材准备 creatures.name 对齐） */
  creature_names?: string[];
  /** 脚本设计：【参考】图1=角色卡（锚点）；图2=场景（锚点） */
  asset_match?: string;
  /** 脚本设计：整片已选视觉风格提示词（原样挂上，不改写） */
  visual_style?: string;
  /** v3：关联 Shot Intent（Beat Coverage 校验靠它） */
  intent_id?: string;
  /** v3：character_id → costume_tag（防换装穿帮） */
  costume_tags?: Record<string, string>;
}
export type DramaOriginalSegmentType =
  | 'action'
  | 'dialogue'
  | 'stage_direction'
  | 'performance_direction'
  | 'system'
  | 'montage'
  | 'transition'
  | 'screen_text'
  | 'narration'
  | 'other';

export type DramaAssetBindingStatus = 'MATCHED' | 'UNMATCHED' | 'AMBIGUOUS';

export interface DramaOriginalSourceRange {
  start: number;
  end: number;
}

/** 分析阶段场次：只整理原文边界，不创作 */
export interface DramaOriginalScene {
  scene_id: string;
  episode_id: string;
  scene_number: number;
  scene_no: string;
  location_type: string;
  location: string;
  time: string;
  original_heading: string;
  order: number;
  source_range?: DramaOriginalSourceRange;
  scene_asset_id?: string;
  scene_image_id?: string;
  binding_status?: DramaAssetBindingStatus;
}

/** 分析阶段原文片段：original_text 是事实源，禁止截断 */
export interface DramaOriginalSegment {
  segment_id: string;
  episode_id: string;
  scene_id: string;
  scene_no: string;
  order: number;
  original_text: string;
  type: DramaOriginalSegmentType;
  /** 剧本里的人物名，永不改成资产名 */
  character_name?: string;
  character_names?: string[];
  character_id?: string;
  image_id?: string;
  voice_id?: string;
  performance?: string;
  speaker_type?: 'character' | 'system' | 'narration';
  voice_description?: string;
  source_range?: DramaOriginalSourceRange;
}

export interface DramaCharacterBinding {
  original_name: string;
  status: DramaAssetBindingStatus;
  character_id?: string;
  asset_name?: string;
  image_id?: string;
  voice_id?: string;
  speaker_type?: 'character' | 'system' | 'narration';
  candidate_character_ids?: string[];
  candidate_names?: string[];
}

export interface DramaVoiceBinding {
  original_name: string;
  status: DramaAssetBindingStatus;
  voice_id?: string;
  voice_name?: string;
  character_id?: string;
  speaker_type?: 'character' | 'system' | 'narration';
  voice_description?: string;
  candidate_voice_ids?: string[];
}

export interface DramaSceneAssetBinding {
  original_location: string;
  status: DramaAssetBindingStatus;
  scene_id?: string;
  asset_name?: string;
  scene_image_id?: string;
  candidate_scene_ids?: string[];
  candidate_names?: string[];
}

export interface DramaVisualBibleBinding {
  visual_bible_id: string;
  style_id: string;
  style_name: string;
  bound: boolean;
}

export interface DramaOriginalIntegrityReport {
  ok: boolean;
  source_chars: number;
  covered_chars: number;
  missing_samples: string[];
  dialogue_ok: boolean;
  notes: string[];
}

export interface DramaEpisodeAnalysisSummary {
  scene_count: number;
  segment_count: number;
  character_mention_count: number;
  scene_mention_count: number;
  character_matched: number;
  character_pending: number;
  character_ambiguous: number;
  voice_matched: number;
  voice_pending: number;
  voice_ambiguous: number;
  scene_matched: number;
  scene_pending: number;
  scene_ambiguous: number;
  visual_bible_bound: boolean;
  integrity_ok: boolean;
  analyzed_at: number;
}

export interface DramaEpisodeBible {
  episode_id: string;
  episode_no: number;
  title: string;
  logline: string;
  genre: string;
  theme: string;
  target_audience: string;
  episodeBeat: DramaEpisodeBeat;
  episodePacing: DramaEpisodePacing;
  directing_notes: DramaCharacterDirecting[];
  /** 分析阶段：原文场次（完整 heading） */
  original_scenes?: DramaOriginalScene[];
  /** 分析阶段：原文片段（完整 original_text） */
  original_segments?: DramaOriginalSegment[];
  character_bindings?: DramaCharacterBinding[];
  voice_bindings?: DramaVoiceBinding[];
  scene_bindings?: DramaSceneAssetBinding[];
  visual_bible_binding?: DramaVisualBibleBinding;
  original_integrity?: DramaOriginalIntegrityReport;
  analysis_summary?: DramaEpisodeAnalysisSummary;
  /** 本集覆盖项目级 Visual Bible（空字段表示不覆盖） */
  visual_override: DramaVisualBible;
  /** 本集覆盖项目级 Sound Bible */
  sound_override: DramaSoundBible;
  /** 本集视觉预设 id；空=跟随项目 */
  style_preset_id: string;
  shot_suggestions: DramaShotSuggestion[];
  /** 分析阶段先拆出的视觉事件（合并成镜之前） */
  visual_events: DramaVisualEvent[];
  /** v3 Narrative Planning：剧情层 / 导演层 / 意图层（analyze 后、shotPlan 前产出） */
  narrative_beats?: DramaNarrativeBeat[];
  director_beats?: DramaDirectorBeat[];
  shot_intents?: DramaShotIntent[];
  /** 本集正式导演表（与 session.shots 工作副本对应，切集时换入） */
  official_shots: DramaShot[];
  /** 本集场次（随官方镜头表一起切集） */
  official_scene_beats: DramaSceneBeat[];
  /** 步骤 2：分场（剧本拆分）完成时间 */
  scene_split_at?: number;
  /** 步骤 3：时长拆镜完成时间 */
  duration_split_at?: number;
  /** 步骤 6：素材匹配（脚本设计）完成时间；须在资产之后 */
  asset_match_at?: number;
  updated_at: number;
}

/** 资产生产计划条目 */
export interface DramaProductionAssetItem {
  asset_kind: 'character' | 'scene' | 'prop' | 'creature' | 'voice' | 'style' | 'organization';
  asset_id: string;
  name: string;
  priority: DramaAssetPriority;
  status: DramaProductionAssetStatus;
  required_views: string[];
  notes: string;
}

export interface DramaAssetProductionPlan {
  episode_id: string;
  items: DramaProductionAssetItem[];
  updated_at: number;
}

/** 内存会话：UI 工作真理源 */
export interface DramaDirectorSession {
  meta: DramaDirectorNodeMeta;
  /** 整本入库后的分集列表 */
  episodes: DramaEpisode[];
  /** 当前选中制作的集 */
  active_episode_id: string;
  bible: DramaProjectBible;
  scene_beats: DramaSceneBeat[];
  /** 正式镜头表：仅用户确认策划后写入 */
  shots: DramaShot[];
  /** 按集 Episode Bible */
  episode_bibles: Record<string, DramaEpisodeBible>;
  /** 按集资产生产计划 */
  production_plans: Record<string, DramaAssetProductionPlan>;
  packages: Record<string, DramaGenerationPackage>;
  reviews: Record<string, DramaReviewResult>;
  continuity_issues: ContinuityIssue[];
}

/** Adapter 输出：可交给现有 invokeAI video 的 payload 片段 */
export interface DramaVideoAdapterPayload {
  adapter_id: string;
  model: string;
  prompt: string;
  inputImages: string[];
  inputAudios?: string[];
  durationSec?: number;
  aspectRatio?: string;
  extra?: Record<string, unknown>;
}
