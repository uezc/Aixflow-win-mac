/**
 * AI 卡拉OK字幕 V1.0 — 工程与字级时间轴类型。
 */

/**
 * 时间轴来源：
 * - asrWords：fun-asr 字/词级时间戳映射到用户歌词
 * - asr / lyricSegments / lrc：仅有句/行级锚点，行内为匀速插值
 */
export type KaraokeTimingSource = 'lrc' | 'lyricSegments' | 'asr' | 'asrWords' | 'manual';

/**
 * 预览/烧录音源：
 * - video：成片自带音轨
 * - song：导演台上传的原曲音频（画面仍用成片）
 */
export type KaraokeAudioSource = 'video' | 'song';

/**
 * 云端 fun-asr 识别语言偏好（经 FC language → language_hints）。
 * - auto：不强制语种，由模型自动识别
 * - zh：普通话/中文（官方 language_hints: zh）
 * - yue：粤语（传 yue；fun-asr 能力含粤语，但文件转写文档未正式列出 yue）
 */
export type KaraokeAsrLanguage = 'auto' | 'zh' | 'yue';

export const KARAOKE_ASR_LANGUAGE_OPTIONS: readonly KaraokeAsrLanguage[] = [
  'auto',
  'zh',
  'yue',
] as const;

export function normalizeKaraokeAsrLanguage(raw: unknown): KaraokeAsrLanguage {
  const s = String(raw || '')
    .trim()
    .toLowerCase()
    .replace(/_/g, '-');
  if (
    s === 'yue' ||
    s === 'cantonese' ||
    s === 'zh-yue' ||
    s === 'zh-hk' ||
    s === 'yue-hk'
  ) {
    return 'yue';
  }
  if (
    s === 'zh' ||
    s === 'zh-cn' ||
    s === 'zh-hans' ||
    s === 'cmn' ||
    s === 'mandarin' ||
    s === 'chinese'
  ) {
    return 'zh';
  }
  return 'auto';
}

/** IPC / FC body.language */
export function karaokeAsrLanguageToApiParam(lang: KaraokeAsrLanguage | unknown): string {
  return normalizeKaraokeAsrLanguage(lang);
}

/** ASR 字/词级锚点（秒）；卡拉OK 优先用其节奏，不再句内匀速 */
export interface KaraokeAsrWordTiming {
  text: string;
  startSec: number;
  endSec: number;
}

/** 演唱角色（歌词 `(男)` / `男：` 等状态机；括号/冒号全半角兼容） */
export type KaraokeRole = 'male' | 'female' | 'chorus';

/** 单字时间轴（秒） */
export interface KaraokeCharTiming {
  text: string;
  startSec: number;
  endSec: number;
  /**
   * 角色标记（如「(男)」/「男：」）：可显示，不参与 wipe / 进度条填字。
   * 字级 ASR 对齐时应跳过。
   */
  roleTag?: boolean;
  /**
   * 本字所属演唱角色（状态机继承）。
   * 有则已唱色用 style.roleColors（缺省 KARAOKE_ROLE_SUNG_COLORS）；无则用男色（= sungColor / roleColors.male）。
   */
  role?: KaraokeRole;
}

/** 行级对齐质量（字级 ASR 映射后 / 人工微调） */
export type KaraokeLineTimingQuality = 'asr' | 'interpolated' | 'weak' | 'manual';

/** 一行歌词 + 字级时间 */
export interface KaraokeLine {
  id: string;
  text: string;
  startSec: number;
  endSec: number;
  chars: KaraokeCharTiming[];
  /** 纯音乐/过门占位，不写入 ASS 对白 */
  instrumental?: boolean;
  /**
   * 行级对齐质量：
   * - asr：在 ASR words 流上独立匹配成功
   * - interpolated：漏识别，按前后已匹配行插值（不抢后续锚点）
   * - weak：匹配分偏低，时间可能不准
   * - manual：人工改过字级/行级时间（不再当弱对齐）
   */
  timingQuality?: KaraokeLineTimingQuality;
}

/** ASS Alignment 1–9（底左…顶右）；卡拉OK默认底中=2 */
export type KaraokeAssAlignment = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;

/** 垂直位置预设（映射到 Alignment 2/5/8） */
export type KaraokePositionPreset = 'bottom' | 'middle' | 'top';

/** 字幕排布：单行当前位置 / 奇偶行双位置交替（经典 KTV） */
export type KaraokeLayoutMode = 'single' | 'dualAlternate';

/** PlayRes 像素坐标（与 buildAss PlayResX/Y 一致） */
export interface KaraokePos {
  x: number;
  y: number;
}

/** 设计稿逻辑坐标（预览 / 工程 pos / fontSize 均按此） */
export const ASS_PLAY_RES_X = 1920;
export const ASS_PLAY_RES_Y = 1080;
/**
 * 烧录 ASS 超采样：写出 PlayRes = 设计稿×此值，字号/坐标/`\\bord`/`\\clip` 同步×N。
 * 根因：libass 对 `\\clip`+`\\t` 按整数坐标插值；1080p 大字号下台阶明显。
 * ×3 → PlayRes 5760；再配合烧录链路 2× 栅格超采样降回片源（见 karaokeBurn），
 * 硬 clip 边经 lanczos 抗锯齿，接近预览 CSS 连续 percent（1.8.0 安装包无此二者）。
 */
export const ASS_KARAOKE_RENDER_SCALE = 3;

/**
 * 默认位置 A：左缘 x=147、顶缘 Y=759（PlayRes 1920×1080；ASS `\an4` 左锚）。
 * 默认位置 B：右缘 x=1778、顶缘 Y=911（ASS `\an6` 右锚）。
 * 经典 KTV：双行交替 + A 左 B 右；「底部」预设同此坐标。
 */
export const DEFAULT_KARAOKE_POS_A: KaraokePos = { x: 147, y: 759 };
export const DEFAULT_KARAOKE_POS_B: KaraokePos = { x: 1778, y: 911 };

/**
 * 单行布局默认：水平居中 x=960、下方 Y=950（PlayRes 1920×1080）。
 * ASS / 预览在中区偏下时用 `\an2` 底中对齐（pos = 字底中点）。
 * 与双行 A/B 左右锚分离；切到单行且仍为旧左对齐默认时迁到此点。
 * Y 固定 950，不跟随双行 B（B 默认 Y=911）。
 */
export const DEFAULT_KARAOKE_POS_SINGLE: KaraokePos = {
  x: Math.round(ASS_PLAY_RES_X / 2),
  y: 950,
};

/** 旧版默认双行居中（打开编辑器时迁移为新默认） */
export const LEGACY_CENTERED_KARAOKE_POS_A: KaraokePos = { x: 960, y: 800 };
export const LEGACY_CENTERED_KARAOKE_POS_B: KaraokePos = { x: 960, y: 950 };

/** 旧版极端贴边 A(0,800)/B(1920,950)（打开时迁到当前默认双行坐标） */
export const LEGACY_EDGE_KARAOKE_POS_A: KaraokePos = { x: 0, y: 800 };
export const LEGACY_EDGE_KARAOKE_POS_B: KaraokePos = { x: ASS_PLAY_RES_X, y: 950 };

export function isLegacyCenteredKaraokeDualPos(
  posA?: Partial<KaraokePos> | null,
  posB?: Partial<KaraokePos> | null,
): boolean {
  return (
    Number(posA?.x) === LEGACY_CENTERED_KARAOKE_POS_A.x &&
    Number(posA?.y) === LEGACY_CENTERED_KARAOKE_POS_A.y &&
    Number(posB?.x) === LEGACY_CENTERED_KARAOKE_POS_B.x &&
    Number(posB?.y) === LEGACY_CENTERED_KARAOKE_POS_B.y
  );
}

export function isLegacyEdgeKaraokeDualPos(
  posA?: Partial<KaraokePos> | null,
  posB?: Partial<KaraokePos> | null,
): boolean {
  return (
    Number(posA?.x) === LEGACY_EDGE_KARAOKE_POS_A.x &&
    Number(posA?.y) === LEGACY_EDGE_KARAOKE_POS_A.y &&
    Number(posB?.x) === LEGACY_EDGE_KARAOKE_POS_B.x &&
    Number(posB?.y) === LEGACY_EDGE_KARAOKE_POS_B.y
  );
}

/** 打开编辑器时应迁到当前默认双行坐标的旧工程 */
export function shouldMigrateKaraokeDualPosToDefault(
  posA?: Partial<KaraokePos> | null,
  posB?: Partial<KaraokePos> | null,
): boolean {
  return isLegacyCenteredKaraokeDualPos(posA, posB) || isLegacyEdgeKaraokeDualPos(posA, posB);
}

/** 是否仍为双行左锚默认 A（单行模式下应迁到 DEFAULT_KARAOKE_POS_SINGLE） */
export function isKaraokeDualDefaultPosA(pos?: Partial<KaraokePos> | null): boolean {
  return (
    Number(pos?.x) === DEFAULT_KARAOKE_POS_A.x && Number(pos?.y) === DEFAULT_KARAOKE_POS_A.y
  );
}

/** 切到单行时：无 pos / 仍为双行左默认 / 旧贴左边 → 落到单行下方居中 */
export function shouldMigrateKaraokeSinglePosToDefault(
  posA?: Partial<KaraokePos> | null,
): boolean {
  if (posA == null) return true;
  if (!Number.isFinite(Number(posA.x)) || !Number.isFinite(Number(posA.y))) return true;
  if (isKaraokeDualDefaultPosA(posA)) return true;
  return (
    Number(posA.x) === LEGACY_EDGE_KARAOKE_POS_A.x &&
    Number(posA.y) === LEGACY_EDGE_KARAOKE_POS_A.y
  );
}

/** 指示灯（简易跟随当前字；偏移/大小为 PlayRes 像素） */
export interface KaraokeIndicatorOptions {
  enabled?: boolean;
  offsetX?: number;
  offsetY?: number;
  size?: number;
  /** 与当前字的额外间距（PlayRes px） */
  gap?: number;
}

export const DEFAULT_KARAOKE_INDICATOR: Required<KaraokeIndicatorOptions> = {
  /** 默认关闭：预览不画球，ASS 也不画指示灯 */
  enabled: false,
  offsetX: 28,
  offsetY: -24,
  size: 76,
  gap: 5,
};

/**
 * 开唱前倒计时圆点（经典 KTV：行上方逐秒熄灭；非跟随字的指示球）。
 * color 为 ASS BGR（默认蓝 #0000FF → &H00FF0000）。
 * 开场 / 间奏再入共用 size·spacing·anchor；拖任意一点整组平移；ASS 各点 `\pos` = anchor + i×spacing。
 */
export interface KaraokeCountdownOptions {
  enabled?: boolean;
  /** 圆点个数，默认 4 */
  count?: number;
  /** ASS BGR，默认蓝 */
  color?: string;
  /** 每点间隔秒，默认 1 */
  intervalSec?: number;
  /** 相对字幕行的垂直上移（PlayRes px），默认约 0.85×字号 */
  offsetY?: number;
  /**
   * 倒计时蓝点字号（PlayRes；ASS ● / 预览圆点直径同源）。
   * 开场 KaraokeOpeningCD + 每句 KaraokeCD 共用；默认 146；可调 8～300。
   */
  size?: number;
  /**
   * 相邻点水平间距（PlayRes；圆心距）。由滑条调节；与 anchor 一起决定四点排布。
   */
  spacing?: number;
  /**
   * 组锚点（首点圆心，PlayRes）。默认 DEFAULT_KARAOKE_COUNTDOWN_ANCHOR (185,653)；
   * `null`/缺省解析时回退 Line A 上方锚（旧工程）。
   * 拖任意一点或整组时只更新本字段，四点相对间距保持 spacing。
   */
  anchor?: KaraokePos | null;
  /**
   * @deprecated 旧工程单点位；解析时仅 positions[0] 可回退为 anchor。
   */
  positions?: Array<KaraokePos | null>;
}

/** 倒计时蓝点字号可调范围（PlayRes；UI 滑条与 resolve 共用） */
export const KARAOKE_COUNTDOWN_DOT_SIZE_MIN = 8;
export const KARAOKE_COUNTDOWN_DOT_SIZE_MAX = 300;
export const KARAOKE_COUNTDOWN_DOT_SIZE_DEFAULT = 146;

/** 相邻点圆心距可调范围（PlayRes） */
export const KARAOKE_COUNTDOWN_SPACING_MIN = 16;
export const KARAOKE_COUNTDOWN_SPACING_MAX = 400;
export const KARAOKE_COUNTDOWN_SPACING_DEFAULT = 120;

/** 倒计时默认组锚（首点圆心，PlayRes 1920×1080）；「恢复默认」写回 */
export const DEFAULT_KARAOKE_COUNTDOWN_ANCHOR: KaraokePos = { x: 185, y: 653 };

/** 倒计时点位最多下标（与开场/再入 maxDots 上限一致） */
export const KARAOKE_COUNTDOWN_POSITIONS_MAX = 8;

export const DEFAULT_KARAOKE_COUNTDOWN: Required<KaraokeCountdownOptions> = {
  /** 默认关闭：预览不画蓝点，ASS 也不写 KaraokeCD */
  enabled: false,
  count: 4,
  /** 蓝 #0000FF */
  color: '&H00FF0000',
  intervalSec: 1,
  offsetY: 0,
  size: KARAOKE_COUNTDOWN_DOT_SIZE_DEFAULT,
  spacing: KARAOKE_COUNTDOWN_SPACING_DEFAULT,
  /** 首点圆心；「恢复默认」= DEFAULT_KARAOKE_COUNTDOWN_ANCHOR */
  anchor: { ...DEFAULT_KARAOKE_COUNTDOWN_ANCHOR },
  positions: [],
};

/**
 * 男/女/合唱已唱分色（ASS BGR）。
 * 男 #0000FF / 女 #FF0000 / 合唱 #16E521
 */
export type KaraokeRoleColors = {
  male: string;
  female: string;
  chorus: string;
};

export const KARAOKE_ROLE_SUNG_COLORS: KaraokeRoleColors = {
  male: '&H00FF0000',
  female: '&H000000FF',
  chorus: '&H0021E516',
};

/**
 * 首选字体（样片风黑体；系统已安装则生效）。
 * 未安装时烧录/预览回退 SimHei / 其它系统黑体。
 */
export const KARAOKE_PREFERRED_FONT = 'Microsoft YaHei';
/**
 * 旧默认圆体（ASS Fontname / CSS family = 字体 name 表「文鼎中特圓」）。
 * 内嵌 `public/fonts/AR-Yenti-Extra-B5.ttf`（AR Yenti Extra B5），无需系统安装即可预览/方案 A 烧录。
 */
export const KARAOKE_PREFERRED_FONT_LEGACY = '文鼎中特圓';
export const KARAOKE_FALLBACK_FONT = 'SimHei';

export interface KaraokeStyleOptions {
  /** 未唱：白（ASS SecondaryColour，BGR） */
  unsungColor?: string;
  /**
   * 已唱高亮（ASS PrimaryColour，BGR）。
   * 始终跟随 roleColors.male；无角色标记时使用。UI 不再单独暴露。
   */
  sungColor?: string;
  /**
   * 男/女/合 已唱分色（ASS BGR）；有 (男)/男： 等标记时扫字用；
   * 无标记时用 male（并写入 sungColor）。缺省 = KARAOKE_ROLE_SUNG_COLORS。
   */
  roleColors?: KaraokeRoleColors;
  fontName?: string;
  fontSize?: number;
  /** 垂直边距（ASS MarginV，相对 Alignment 锚边；无 pos 时回退用） */
  marginV?: number;
  /** ASS Alignment 1–9；默认 2（底中） */
  alignment?: number;
  /** 单行 | 奇偶双位置交替 */
  layoutMode?: KaraokeLayoutMode;
  /**
   * 位置 A（PlayRes 像素）：单行模式唯一位置；双行模式下奇数行（第 1、3、5… 句）。
   * 双行默认左缘 x=147（`\an4`）；单行默认下方居中 (960,950)（`\an2`）。
   * 写入 ASS 时由 fit 按 x/y 选用 `\an2`/`\an4`/`\an5`/`\an6` + `\pos(x,y)`。
   */
  posA?: KaraokePos;
  /** 位置 B：双行模式下偶数行（第 2、4、6… 句）；默认右缘 x=1778 */
  posB?: KaraokePos;
  /** 未唱描边（ASS OutlineColour） */
  outlineColor?: string;
  /**
   * 已唱描边色（hold / 角色 Style `KaraokeSung` 的 OutlineColour + `\\3c`；默认白）。
   * 默认方案 A（CSS 预览级）做字内半扫白/黑边。方案 C（可选 ASS）：扫字期描边靠 L0 未唱黑边；
   * L1 `KaraokeWipe`+`\\kf` 填色（无歌词 `\\clip`）；唱完 hold 用本色白边。
   */
  sungOutlineColor?: string;
  /** 阴影色（ASS BackColour） */
  shadowColor?: string;
  /**
   * 未唱描边宽度（ASS Outline；Style `Karaoke`；默认 2；可调 0～8）。
   * 旧工程仅此字段时，已唱粗细缺省跟随本值。
   */
  outline?: number;
  /**
   * 已唱描边宽度（ASS Outline；Style `KaraokeSung` + Dialogue `\\bord`；默认 2；可调 0～8）。
   * 缺省时跟随 `outline`（兼容旧工程）。
   */
  sungOutlineWidth?: number;
  /**
   * 阴影距离（ASS Shadow；默认 3）。
   * 未唱/已唱均用：半透明 BackColour + 适度 `\\blur` 虚开右下影（非硬投影第二圈黑边）。
   */
  shadow?: number;
  /** 开场曲名描边宽（ASS Outline；默认 KARAOKE_OPENING_TITLE_OUTLINE；可调 0～8） */
  openingTitleOutline?: number;
  /** 开场作词/作曲描边宽（ASS Outline；默认 KARAOKE_OPENING_CREDIT_OUTLINE；可调 0～8） */
  openingCreditOutline?: number;
  /** 指示灯（跟随字；默认关） */
  indicator?: KaraokeIndicatorOptions;
  /** 开唱前倒计时点（默认关；显式 enabled:true 才开） */
  countdown?: KaraokeCountdownOptions;
  /** 开场曲名字号（PlayRes；默认 KARAOKE_OPENING_TITLE_FONT_SIZE；范围 48–160） */
  openingTitleFontSize?: number;
  /** 开场作词/作曲字号（共用一档；默认 KARAOKE_OPENING_CREDIT_FONT_SIZE；范围 24–96） */
  openingCreditFontSize?: number;
  /**
   * 句间渐隐时长（秒）：唱完立刻淡出至透明，再换同槽下一句（预览 opacity + ASS `\fad(0, ms)`）。
   * 默认 KARAOKE_LINE_FADE_OUT_SEC（1s）；范围 0～1（0 = 瞬间切走）。勿与下一句叠化。
   */
  lineFadeOutSec?: number;
  /**
   * 间奏清屏间隙（秒）：相邻可唱行 gap **大于**本值则清屏且 `appear=singStart`（不提前挂词）。
   * 默认 `KARAOKE_INTERLUDE_GAP_SEC`（10）；范围 1～10。写入 project.style，可「恢复默认」。
   */
  interludeClearGapSec?: number;
  /**
   * 再入倒计时间隙（秒）：gap **≥** 本值才可能再入蓝点+提前显词（全曲最多 1 次）。
   * 默认 `KARAOKE_COUNTDOWN_REENTRY_GAP_SEC`（≥清屏，缺省 10）；范围 3～15；resolve 时强制 ≥ 清屏间隙。
   */
  countdownReentryGapSec?: number;
  /**
   * 开场/再入提前显词与蓝点窗上限（秒）：lead-in = min(本值, 可用间隙)；hold/扣点按此上限缩放。
   * 默认 `KARAOKE_OPENING_COUNTDOWN_MAX_SEC`（7）；范围 2～15。
   */
  countdownLeadInMaxSec?: number;
  /**
   * 开场曲名字顶位置（PlayRes；缺省 DEFAULT_KARAOKE_OPENING_TITLE_POS ≈(961,337)）。
   * 预览/ASS 用；「恢复默认」写回。
   */
  openingTitlePos?: KaraokePos;
  /** 开场作词字顶位置（缺省 KARAOKE_OPENING_LYRICIST_POS） */
  openingLyricistPos?: KaraokePos;
  /** 开场作曲字顶位置（缺省 KARAOKE_OPENING_COMPOSER_POS） */
  openingComposerPos?: KaraokePos;
}

/**
 * 开场叠层（PlayRes 1920×1080；Y = 字顶，非字心）。
 * 曲名 `\an8` 近水平居中；作词/作曲 `\an7` 左对齐。
 * 颜色统一：白填充 `#FFFFFF` + 蓝描边 `#0000FF`（与正歌已唱蓝同色系描边）。
 */
export const KARAOKE_OPENING_TITLE_Y = 337;
/** 开场作词：左缘 114、字顶 Y=694 */
export const KARAOKE_OPENING_LYRICIST_POS: KaraokePos = { x: 114, y: 694 };
/** 开场作曲：左缘 115、字顶 Y=822 */
export const KARAOKE_OPENING_COMPOSER_POS: KaraokePos = { x: 115, y: 822 };
/** 开场曲名字号默认 */
export const KARAOKE_OPENING_TITLE_FONT_SIZE = 135;
/** 开场曲名字号可调范围 */
export const KARAOKE_OPENING_TITLE_FONT_SIZE_MIN = 48;
export const KARAOKE_OPENING_TITLE_FONT_SIZE_MAX = 160;
/** 开场作词/作曲字号默认（小于曲名） */
export const KARAOKE_OPENING_CREDIT_FONT_SIZE = 96;
/** 开场作词/作曲字号可调范围 */
export const KARAOKE_OPENING_CREDIT_FONT_SIZE_MIN = 24;
export const KARAOKE_OPENING_CREDIT_FONT_SIZE_MAX = 96;

/** 钳制开场曲名字号；缺省用默认 */
export function clampKaraokeOpeningTitleFontSize(n: unknown): number {
  const v = Math.round(Number(n));
  if (!Number.isFinite(v)) return KARAOKE_OPENING_TITLE_FONT_SIZE;
  return Math.max(
    KARAOKE_OPENING_TITLE_FONT_SIZE_MIN,
    Math.min(KARAOKE_OPENING_TITLE_FONT_SIZE_MAX, v),
  );
}

/** 钳制开场作词/作曲字号；缺省用默认 */
export function clampKaraokeOpeningCreditFontSize(n: unknown): number {
  const v = Math.round(Number(n));
  if (!Number.isFinite(v)) return KARAOKE_OPENING_CREDIT_FONT_SIZE;
  return Math.max(
    KARAOKE_OPENING_CREDIT_FONT_SIZE_MIN,
    Math.min(KARAOKE_OPENING_CREDIT_FONT_SIZE_MAX, v),
  );
}
/** 开场填充色 ASS BGR = CSS `#FFFFFF`（白字） */
export const KARAOKE_OPENING_PRIMARY_ASS = '&H00FFFFFF';
export const KARAOKE_OPENING_PRIMARY_CSS = '#FFFFFF';
/** 开场描边色 ASS BGR = CSS `#0000FF`（蓝边） */
export const KARAOKE_OPENING_OUTLINE_ASS = '&H00FF0000';
export const KARAOKE_OPENING_OUTLINE_CSS = '#0000FF';
/** 开场曲名描边宽（蓝边） */
export const KARAOKE_OPENING_TITLE_OUTLINE = 8;
/** 开场署名描边宽（与曲名同档） */
export const KARAOKE_OPENING_CREDIT_OUTLINE = 8;
/** 描边粗细可调范围（ASS Outline 单位；正歌/曲名/署名共用） */
export const KARAOKE_OUTLINE_MIN = 0;
export const KARAOKE_OUTLINE_MAX = 8;
/** 正歌未唱描边默认（与 DEFAULT_KARAOKE_STYLE.outline 一致；样片细黑边 ≈1.5–2） */
export const KARAOKE_LYRIC_OUTLINE_DEFAULT = 2;
/** 正歌已唱描边默认（与 DEFAULT_KARAOKE_STYLE.sungOutlineWidth 一致；旧工程无字段时用此缺省） */
export const KARAOKE_LYRIC_SUNG_OUTLINE_DEFAULT = 7;
/** 旧默认描边（工程里仍为 4 时打开编辑器迁到当前默认） */
export const KARAOKE_LYRIC_OUTLINE_LEGACY_DEFAULT = 4;
/** 正歌阴影距离范围（ASS Shadow / `\shad`；UI 已移除，固定 0） */
export const KARAOKE_SHADOW_MIN = 0;
export const KARAOKE_SHADOW_MAX = 12;
/** 正歌阴影默认（关闭软阴影；与 DEFAULT_KARAOKE_STYLE.shadow 一致） */
export const KARAOKE_LYRIC_SHADOW_DEFAULT = 0;
/** 旧已唱描边色（黑）；当前默认改回白边对齐预览 */
export const KARAOKE_SUNG_OUTLINE_COLOR_LEGACY = '&H00000000';

/**
 * 旧工程仍写死 outline=4 / shadow>0 / 已唱黑描边时，迁到当前样片默认。
 * 软阴影 UI 已移除：任意 shadow>0 静默迁到 0。字体不自动迁移（圆体仍可选）。
 */
export function karaokeLyricStrokeLegacyPatch(
  style?: Pick<KaraokeStyleOptions, 'outline' | 'shadow' | 'sungOutlineColor'> | null,
): Partial<Pick<KaraokeStyleOptions, 'outline' | 'shadow' | 'sungOutlineColor'>> | null {
  if (!style) return null;
  const patch: Partial<Pick<KaraokeStyleOptions, 'outline' | 'shadow' | 'sungOutlineColor'>> =
    {};
  if (Number(style.outline) === KARAOKE_LYRIC_OUTLINE_LEGACY_DEFAULT) {
    patch.outline = KARAOKE_LYRIC_OUTLINE_DEFAULT;
  }
  const sh = Number(style.shadow);
  if (Number.isFinite(sh) && sh > 0) {
    patch.shadow = KARAOKE_LYRIC_SHADOW_DEFAULT;
  }
  const sungOc = String(style.sungOutlineColor || '')
    .trim()
    .toUpperCase();
  // 短暂默认过黑描边的工程 → 迁回白边（与预览扫字白边一致）
  if (
    sungOc === KARAOKE_SUNG_OUTLINE_COLOR_LEGACY.toUpperCase() ||
    sungOc === '&H000000' ||
    sungOc === '#000000'
  ) {
    patch.sungOutlineColor = '&H00FFFFFF';
  }
  return Object.keys(patch).length ? patch : null;
}

/** 钳制描边粗细；缺省用 fallback */
export function clampKaraokeOutline(n: unknown, fallback: number): number {
  const v = Number(n);
  if (!Number.isFinite(v)) return fallback;
  const snapped = Math.round(v * 10) / 10;
  return Math.max(KARAOKE_OUTLINE_MIN, Math.min(KARAOKE_OUTLINE_MAX, snapped));
}

/** 钳制软阴影距离；0 合法（ASS `\shad0` 关阴影）；缺省用 fallback（勿用 `||`，会吞掉 0） */
export function clampKaraokeShadow(
  n: unknown,
  fallback: number = KARAOKE_LYRIC_SHADOW_DEFAULT,
): number {
  const v = Number(n);
  if (!Number.isFinite(v)) return fallback;
  const snapped = Math.round(v * 10) / 10;
  return Math.max(KARAOKE_SHADOW_MIN, Math.min(KARAOKE_SHADOW_MAX, snapped));
}
/** 无首句人声时开场显示时长（秒） */
export const KARAOKE_OPENING_FALLBACK_SEC = 4;
/**
 * 开场曲名/作词作曲渐隐时长（秒）：须在「倒计时+首句提前显词」窗口开始时已结束。
 * 预览与 ASS `\fad(0, ms)` 共用（约 0.8～1.5s）；片头不足时压缩。
 */
export const KARAOKE_OPENING_FADE_OUT_SEC = 1.2;
/**
 * 开场/再入倒计时蓝点（锚 `singStart`）：
 * - 提前 `MAX_SEC`（= hold + count×interval = 7s）亮起 4 点；
 * - 窗内前 `HOLD_SEC`（3s）全亮；第 3s 起每秒熄 1 个（点级渐隐）；
 * - 扣点段约 4s（4×1s）→ 开唱；
 * - 前奏/间隙不足 7s：先缩短 hold；仍不足则 hold=0 并整体压缩扣点间隔（保持 4 点）。
 * 曲名/署名须在该窗口开始前或开始时渐隐完毕（勿拖到正歌）。
 */
export const KARAOKE_OPENING_COUNTDOWN_HOLD_SEC = 3;
export const KARAOKE_OPENING_COUNTDOWN_INTERVAL_SEC = 1;
export const KARAOKE_OPENING_COUNTDOWN_COUNT = 4;
/** lead-in 理想时长 = hold + 扣点段 */
export const KARAOKE_OPENING_COUNTDOWN_MAX_SEC =
  KARAOKE_OPENING_COUNTDOWN_HOLD_SEC +
  KARAOKE_OPENING_COUNTDOWN_COUNT * KARAOKE_OPENING_COUNTDOWN_INTERVAL_SEC;
/**
 * 单点熄灭渐隐时长（秒）；满窗时 = interval（整秒 fade）。
 * 短窗压缩后随 `intervalSec` 走；ASS `\fad(0,ms)` / 预览 opacity 共用。
 */
export const KARAOKE_OPENING_COUNTDOWN_DOT_FADE_SEC =
  KARAOKE_OPENING_COUNTDOWN_INTERVAL_SEC;
/** 开场蓝点相对 Line A（默认 y=759）的上移（PlayRes px）；勿锚曲名 Y≈337 */
export const KARAOKE_OPENING_COUNTDOWN_OFFSET_Y = 88;
/**
 * 句末渐隐时长（秒）：旧句自 singEnd 起淡至透明，再挂同槽下一句（预览 opacity + ASS `\fad(0, ms)`）。
 * Dialogue / 可见窗结束于 singEnd + fade（间隙不足时压缩 fade）；同槽下一句 appear = 该时刻。
 * 经 style.lineFadeOutSec 使用；本常量作默认（编辑器 UI 不再调节，缺省/恢复默认写入此值）。
 */
export const KARAOKE_LINE_FADE_OUT_SEC = 1;
/** 句间渐隐可调范围（秒） */
export const KARAOKE_LINE_FADE_OUT_SEC_MIN = 0;
export const KARAOKE_LINE_FADE_OUT_SEC_MAX = 1;
/** 钳制句间渐隐；缺省用默认；步进 0.05 */
export function clampKaraokeLineFadeOutSec(n: unknown): number {
  const v = Number(n);
  if (!Number.isFinite(v)) return KARAOKE_LINE_FADE_OUT_SEC;
  const snapped = Math.round(v * 20) / 20;
  return Math.max(
    KARAOKE_LINE_FADE_OUT_SEC_MIN,
    Math.min(KARAOKE_LINE_FADE_OUT_SEC_MAX, snapped),
  );
}
/** 作词/作曲默认署名 */
export const DEFAULT_KARAOKE_CREDIT_NAME = '致音';

/** 开场倒计时 + 渐隐时间线（对齐首句开唱前） */
export interface KaraokeOpeningTimeline {
  /**
   * 曲名/署名 Dialogue End（= lyricAppearSec）。
   * 须 ≤ 倒计时/提前显词起点，正歌期不再出现。
   */
  endSec: number;
  fadeSec: number;
  /** 首句人声开唱（chars[0].startSec 等价） */
  firstSingStart: number;
  /** 倒计时 + 首句提前显词起点（= firstSingStart − leadInDur） */
  lyricAppearSec: number;
  countdownDur: number;
  countdownStart: number;
  countdownEnd: number;
  maxDots: number;
  intervalSec: number;
  /** 窗内全亮保持秒数（理想 3；短前奏可压到 0） */
  holdSec: number;
  /** 单点熄灭渐隐秒数（理想 = intervalSec） */
  dotFadeSec: number;
}

/** 由可用时长推导 hold / 点数 / 扣点间隔（开场与再入共用） */
export interface KaraokeCountdownPlan {
  countdownDur: number;
  holdSec: number;
  maxDots: number;
  intervalSec: number;
  dotFadeSec: number;
}

/**
 * 前奏/间隙压缩策略（可用时长 T，理想 lead = leadIdealSec，默认 7s = hold3 + 扣点4×1）：
 * 1) T≥leadIdeal：满窗（hold = leadIdeal−4，扣点段 4×interval）；
 * 2) 扣点段≤T<leadIdeal：缩短 hold，保留满扣点段；
 * 3) T<扣点段：hold=0，保持 4 点，interval=T/4 整体压缩；
 * 4) T≤0.05：不出点。
 * 绝不产生负 hold / 负 interval。`leadIdealSec` 来自 style.countdownLeadInMaxSec。
 */
export function karaokeCountdownPlanFromAvailable(
  availableSec: number,
  leadIdealSec: number = KARAOKE_OPENING_COUNTDOWN_MAX_SEC,
): KaraokeCountdownPlan {
  const intervalIdeal = KARAOKE_OPENING_COUNTDOWN_INTERVAL_SEC;
  const countIdeal = KARAOKE_OPENING_COUNTDOWN_COUNT;
  const extinguishCap = countIdeal * intervalIdeal;
  let leadIdeal = Number(leadIdealSec);
  if (!Number.isFinite(leadIdeal) || leadIdeal <= 0.05) {
    leadIdeal = KARAOKE_OPENING_COUNTDOWN_MAX_SEC;
  }
  const holdIdeal = Math.max(0, leadIdeal - extinguishCap);
  const extinguishIdeal = Math.min(extinguishCap, leadIdeal);
  const empty: KaraokeCountdownPlan = {
    countdownDur: 0,
    holdSec: 0,
    maxDots: 0,
    intervalSec: intervalIdeal,
    dotFadeSec: KARAOKE_OPENING_COUNTDOWN_DOT_FADE_SEC,
  };
  const T = Number(availableSec);
  if (!(T > 0.05)) return empty;

  if (T >= leadIdeal - 1e-9) {
    const intervalSec = extinguishIdeal / countIdeal;
    return {
      countdownDur: leadIdeal,
      holdSec: holdIdeal,
      maxDots: countIdeal,
      intervalSec,
      dotFadeSec: intervalSec,
    };
  }

  // 缩短 hold，保留满扣点段（仅当理想窗含完整扣点段时）
  if (holdIdeal > 0 && T >= extinguishIdeal - 1e-9) {
    const holdSec = Math.max(0, T - extinguishIdeal);
    return {
      countdownDur: T,
      holdSec,
      maxDots: countIdeal,
      intervalSec: intervalIdeal,
      dotFadeSec: intervalIdeal,
    };
  }

  // 整体压缩扣点段（hold=0，4 点均分）
  const intervalSec = T / countIdeal;
  return {
    countdownDur: T,
    holdSec: 0,
    maxDots: countIdeal,
    intervalSec,
    dotFadeSec: intervalSec,
  };
}

/** 开场 lead-in 时长：`min(leadIdeal, firstSingStart)`；极短开唱则 0 */
export function karaokeOpeningLeadInDurSec(
  firstSingStart: number,
  leadIdealSec: number = KARAOKE_OPENING_COUNTDOWN_MAX_SEC,
): number {
  return karaokeCountdownPlanFromAvailable(firstSingStart, leadIdealSec).countdownDur;
}

/**
 * 由首句开唱时刻推导：
 * 曲名/署名在 lyricAppear 前渐隐完毕 → [lyricAppear, firstSingStart) 蓝点倒计时 + 首句白字 → 开唱扫字。
 * 锚点为 firstSingStart，不是片头 0s。
 */
export function karaokeOpeningTimeline(
  firstSingStart: number,
  opts?: { leadInMaxSec?: number },
): KaraokeOpeningTimeline {
  const sing = Number(firstSingStart) || 0;
  const baseInterval = KARAOKE_OPENING_COUNTDOWN_INTERVAL_SEC;
  const leadIdeal = opts?.leadInMaxSec ?? KARAOKE_OPENING_COUNTDOWN_MAX_SEC;
  const empty: KaraokeOpeningTimeline = {
    endSec: 0,
    fadeSec: 0,
    firstSingStart: 0,
    lyricAppearSec: 0,
    countdownDur: 0,
    countdownStart: 0,
    countdownEnd: 0,
    maxDots: 0,
    intervalSec: baseInterval,
    holdSec: 0,
    dotFadeSec: KARAOKE_OPENING_COUNTDOWN_DOT_FADE_SEC,
  };
  if (sing <= 0.05) return empty;

  const plan = karaokeCountdownPlanFromAvailable(sing, leadIdeal);
  const countdownDur = plan.countdownDur;
  const lyricAppearSec = Math.max(0, sing - countdownDur);
  const countdownStart = lyricAppearSec;
  const countdownEnd = sing;

  // 曲名最晚在 lyricAppear 消失；渐隐占用其前的片头空档（与倒计时窗口不重叠）
  const titleEnd = lyricAppearSec;
  const fadeSec =
    titleEnd <= 0.05
      ? 0
      : Math.min(KARAOKE_OPENING_FADE_OUT_SEC, Math.max(0, titleEnd - 0.05));

  return {
    endSec: titleEnd,
    fadeSec,
    firstSingStart: sing,
    lyricAppearSec,
    countdownDur,
    countdownStart,
    countdownEnd,
    maxDots: plan.maxDots,
    intervalSec: plan.intervalSec,
    holdSec: plan.holdSec,
    dotFadeSec: plan.dotFadeSec,
  };
}

/**
 * 开场蓝点锚点：双行 Line A / 左行（默认 ≈(147,759)），点在其上方一小段。
 * 预览与 ASS `\an4\pos` 共用；勿用曲名 Y≈337。
 */
export function karaokeOpeningCountdownAnchorPos(posA?: KaraokePos | null): KaraokePos {
  const ax = Number(posA?.x);
  const ay = Number(posA?.y);
  const x = Number.isFinite(ax) ? ax : DEFAULT_KARAOKE_POS_A.x;
  const y = Number.isFinite(ay) ? ay : DEFAULT_KARAOKE_POS_A.y;
  return {
    x: Math.max(40, Math.round(x)),
    y: Math.max(
      8,
      Math.min(ASS_PLAY_RES_Y - 8, Math.round(y - KARAOKE_OPENING_COUNTDOWN_OFFSET_Y)),
    ),
  };
}

/**
 * 倒计时窗亮灯个数（开场 / 间奏再入共用）：
 * hold 段全亮；其后每 interval 熄 1 个（整数个数；渐隐见 `karaokeCountdownDotOpacity`）。
 */
export function karaokeCountdownWindowLitDots(
  t: number,
  timeline: KaraokeCountdownWindow | null | undefined,
): number {
  if (!timeline || timeline.maxDots <= 0) return 0;
  if (!Number.isFinite(t)) return 0;
  if (t < timeline.countdownStart - 1e-6 || t >= timeline.countdownEnd - 1e-9) return 0;
  const hold = Math.max(0, Number(timeline.holdSec) || 0);
  const extinguishStart = timeline.countdownStart + hold;
  if (t < extinguishStart - 1e-9) return timeline.maxDots;
  const remaining = timeline.countdownEnd - t;
  if (remaining <= 0) return 0;
  const interval = Math.max(1e-6, Number(timeline.intervalSec) || KARAOKE_OPENING_COUNTDOWN_INTERVAL_SEC);
  return Math.min(
    timeline.maxDots,
    Math.max(0, Math.ceil(remaining / interval - 1e-9)),
  );
}

/**
 * 单点透明度（0=左起）：hold 后按右→左依次熄灭；末尾 `dotFadeSec` 内线性降到 0。
 * 满窗：点 i 在 `countdownStart + hold + (maxDots−i)×interval` 结束（右点先灭）。
 */
export function karaokeCountdownDotOpacity(
  t: number,
  timeline: KaraokeCountdownWindow | null | undefined,
  dotIndex: number,
): number {
  if (!timeline || timeline.maxDots <= 0) return 0;
  if (!Number.isFinite(t)) return 0;
  const i = Math.floor(Number(dotIndex));
  if (!(i >= 0 && i < timeline.maxDots)) return 0;
  if (t < timeline.countdownStart - 1e-6 || t >= timeline.countdownEnd - 1e-9) return 0;

  const hold = Math.max(0, Number(timeline.holdSec) || 0);
  const interval = Math.max(1e-6, Number(timeline.intervalSec) || KARAOKE_OPENING_COUNTDOWN_INTERVAL_SEC);
  const end = Math.min(
    timeline.countdownEnd,
    timeline.countdownStart + hold + (timeline.maxDots - i) * interval,
  );
  if (t >= end - 1e-9) return 0;
  if (t < timeline.countdownStart) return 0;

  const fade = Math.max(
    0,
    Number(timeline.dotFadeSec) > 0
      ? Number(timeline.dotFadeSec)
      : Math.min(interval, KARAOKE_OPENING_COUNTDOWN_DOT_FADE_SEC),
  );
  if (fade <= 1e-6) return 1;
  const fadeStart = end - fade;
  if (t <= fadeStart + 1e-9) return 1;
  return Math.max(0, Math.min(1, (end - t) / fade));
}

/**
 * 开场蓝点亮灯个数：hold 全亮，其后每 interval 熄 1 个。
 */
export function karaokeOpeningCountdownLitDots(
  t: number,
  timeline: KaraokeOpeningTimeline | null | undefined,
): number {
  return karaokeCountdownWindowLitDots(t, timeline);
}

/**
 * 清屏间奏阈值（秒）：相邻可唱行 `nextSingStart − prevSingEnd > 本值` 视为长间奏。
 * 间奏中清屏（旧句按 lineFadeOutSec 渐隐后不挂词）。
 * 注意：倒计时蓝点另用 `KARAOKE_COUNTDOWN_REENTRY_GAP_SEC`，勿每个 >清屏 空隙都出点。
 * 工程可经 `style.interludeClearGapSec` 覆盖；本常量为缺省。
 */
export const KARAOKE_INTERLUDE_GAP_SEC = 10;
/**
 * 倒计时再入候选阈值（秒）：间隙须 ≥ 本值才可能出蓝点（与清屏阈值分开）。
 * 须能容纳满窗 lead-in；正歌句间「清屏～再入」喘息只清屏、不出倒计时。
 * 缺省 ≥ 清屏间隙（与 `KARAOKE_INTERLUDE_GAP_SEC` 对齐）；工程可经 `style.countdownReentryGapSec` 覆盖。
 */
export const KARAOKE_COUNTDOWN_REENTRY_GAP_SEC = Math.max(
  KARAOKE_OPENING_COUNTDOWN_MAX_SEC,
  KARAOKE_INTERLUDE_GAP_SEC,
);
/**
 * 全曲间奏再入倒计时上限（开场另计 1 次；合计最多 开场 + 本值）。
 * 多段长间隙时只取最长的那一次。
 */
export const KARAOKE_MAX_COUNTDOWN_REENTRY = 1;

/** 间奏清屏间隙可调范围（秒） */
export const KARAOKE_INTERLUDE_CLEAR_GAP_SEC_MIN = 1;
export const KARAOKE_INTERLUDE_CLEAR_GAP_SEC_MAX = 10;
/** 再入倒计时间隙可调范围（秒） */
export const KARAOKE_COUNTDOWN_REENTRY_GAP_SEC_MIN = 3;
export const KARAOKE_COUNTDOWN_REENTRY_GAP_SEC_MAX = 15;
/** 提前显词 / lead-in 窗上限可调范围（秒） */
export const KARAOKE_COUNTDOWN_LEAD_IN_MAX_SEC_MIN = 2;
export const KARAOKE_COUNTDOWN_LEAD_IN_MAX_SEC_MAX = 15;

/** 钳制间奏清屏间隙；缺省 10；步进 1 */
export function clampKaraokeInterludeClearGapSec(n: unknown): number {
  const v = Math.round(Number(n));
  if (!Number.isFinite(v)) return KARAOKE_INTERLUDE_GAP_SEC;
  return Math.max(
    KARAOKE_INTERLUDE_CLEAR_GAP_SEC_MIN,
    Math.min(KARAOKE_INTERLUDE_CLEAR_GAP_SEC_MAX, v),
  );
}

/** 钳制再入倒计时间隙；缺省 ≥清屏（10）；步进 1（未强制 ≥ 清屏，见 resolve） */
export function clampKaraokeCountdownReentryGapSec(n: unknown): number {
  const v = Math.round(Number(n));
  if (!Number.isFinite(v)) return KARAOKE_COUNTDOWN_REENTRY_GAP_SEC;
  return Math.max(
    KARAOKE_COUNTDOWN_REENTRY_GAP_SEC_MIN,
    Math.min(KARAOKE_COUNTDOWN_REENTRY_GAP_SEC_MAX, v),
  );
}

/** 钳制提前显词 / lead-in 窗上限；缺省 7；步进 1 */
export function clampKaraokeCountdownLeadInMaxSec(n: unknown): number {
  const v = Math.round(Number(n));
  if (!Number.isFinite(v)) return KARAOKE_OPENING_COUNTDOWN_MAX_SEC;
  return Math.max(
    KARAOKE_COUNTDOWN_LEAD_IN_MAX_SEC_MIN,
    Math.min(KARAOKE_COUNTDOWN_LEAD_IN_MAX_SEC_MAX, v),
  );
}

/** 自 style 解析清屏 / 再入 / lead-in；缺省常量；再入 ≥ 清屏 */
export function resolveKaraokeInterludeTiming(
  style?: Pick<
    KaraokeStyleOptions,
    'interludeClearGapSec' | 'countdownReentryGapSec' | 'countdownLeadInMaxSec'
  > | null,
): {
  interludeClearGapSec: number;
  countdownReentryGapSec: number;
  countdownLeadInMaxSec: number;
} {
  const interludeClearGapSec = clampKaraokeInterludeClearGapSec(
    style?.interludeClearGapSec ?? KARAOKE_INTERLUDE_GAP_SEC,
  );
  let countdownReentryGapSec = clampKaraokeCountdownReentryGapSec(
    style?.countdownReentryGapSec ?? KARAOKE_COUNTDOWN_REENTRY_GAP_SEC,
  );
  if (countdownReentryGapSec < interludeClearGapSec) {
    countdownReentryGapSec = Math.min(
      KARAOKE_COUNTDOWN_REENTRY_GAP_SEC_MAX,
      interludeClearGapSec,
    );
  }
  const countdownLeadInMaxSec = clampKaraokeCountdownLeadInMaxSec(
    style?.countdownLeadInMaxSec ?? KARAOKE_OPENING_COUNTDOWN_MAX_SEC,
  );
  return { interludeClearGapSec, countdownReentryGapSec, countdownLeadInMaxSec };
}

/** 倒计时窗公共字段（开场 / 间奏再入） */
export interface KaraokeCountdownWindow {
  countdownStart: number;
  countdownEnd: number;
  maxDots: number;
  intervalSec: number;
  holdSec: number;
  dotFadeSec: number;
}

/**
 * 间奏后再入时间线：锚下一句 `singStart`，`leadIn = min(leadIdeal, gap)`（并避开旧句 fade 尾）。
 * 点在左行 Line A 上方（与开场一致）；可在倒计时窗内提前显词。
 * 默认按倒计时阈值判定；清屏请用 `karaokeIsInterludeGap`。
 */
export interface KaraokeReentryTimeline extends KaraokeCountdownWindow {
  /** 间奏后下一句开唱 */
  singStart: number;
  /** 间奏前上一句唱完 */
  prevSingEnd: number;
  gapSec: number;
  leadInDur: number;
  /** 倒计时 + 提前显词起点 */
  lyricAppearSec: number;
  countdownDur: number;
}

/** 是否清屏长间奏：`nextSingStart − prevSingEnd > threshold`（默认 10s） */
export function karaokeIsInterludeGap(
  nextSingStart: number,
  prevSingEnd: number,
  thresholdSec: number = KARAOKE_INTERLUDE_GAP_SEC,
): boolean {
  const gap = Number(nextSingStart) - Number(prevSingEnd);
  return Number.isFinite(gap) && gap > thresholdSec;
}

/** 间奏 lead-in：`min(leadIdeal, gapAvailable)`（含 hold/压缩策略）；极短则 0 */
export function karaokeReentryLeadInDurSec(
  gapAvailableSec: number,
  leadIdealSec: number = KARAOKE_OPENING_COUNTDOWN_MAX_SEC,
): number {
  return karaokeCountdownPlanFromAvailable(gapAvailableSec, leadIdealSec).countdownDur;
}

/**
 * 由相邻两句推导间奏再入倒计时时间线；间隙未达阈值返回 null。
 * 默认阈值 `KARAOKE_COUNTDOWN_REENTRY_GAP_SEC`；清屏另用 `gapThreshold` / style。
 * 旧句先按 fade 清掉 →（静默）→ [lyricAppear, singStart) 蓝点 + 白字 → 开唱。
 */
export function karaokeReentryTimeline(
  nextSingStart: number,
  prevSingEnd: number,
  opts?: {
    gapThresholdSec?: number;
    fadeOutSec?: number;
    leadInMaxSec?: number;
  },
): KaraokeReentryTimeline | null {
  const threshold = opts?.gapThresholdSec ?? KARAOKE_COUNTDOWN_REENTRY_GAP_SEC;
  const leadIdeal = opts?.leadInMaxSec ?? KARAOKE_OPENING_COUNTDOWN_MAX_SEC;
  const sing = Number(nextSingStart) || 0;
  const prevEnd = Number(prevSingEnd);
  if (!Number.isFinite(sing) || !Number.isFinite(prevEnd)) return null;
  const gapSec = sing - prevEnd;
  // ≥ threshold：满阈值整也算再入候选（须能放下满窗 lead-in 时更佳）
  if (!(gapSec >= threshold - 1e-9)) return null;

  const fade = karaokeLineCompressedFadeSec(
    prevEnd,
    sing,
    opts?.fadeOutSec ?? KARAOKE_LINE_FADE_OUT_SEC,
  );
  // 起点不早于旧句淡完；可用窗再套压缩策略（短于 leadIdeal 时缩短 hold / 整体压缩）
  const earliestAppear = Math.max(0, prevEnd + fade);
  const available = Math.max(0, sing - earliestAppear);
  if (available <= 0.05) return null;
  const plan = karaokeCountdownPlanFromAvailable(available, leadIdeal);
  if (plan.countdownDur <= 0.05) return null;
  // 若旧句 fade 尾顶住窗起点，countdownDur 可能略短于 plan → 再压缩一次
  const countdownDur = Math.min(plan.countdownDur, available);
  const finalPlan =
    Math.abs(countdownDur - plan.countdownDur) < 1e-6
      ? plan
      : karaokeCountdownPlanFromAvailable(countdownDur, leadIdeal);
  const lyricAppearSec = Math.max(earliestAppear, sing - finalPlan.countdownDur);

  return {
    singStart: sing,
    prevSingEnd: prevEnd,
    gapSec,
    leadInDur: finalPlan.countdownDur,
    lyricAppearSec,
    countdownDur: finalPlan.countdownDur,
    countdownStart: lyricAppearSec,
    countdownEnd: sing,
    maxDots: finalPlan.maxDots,
    intervalSec: finalPlan.intervalSec,
    holdSec: finalPlan.holdSec,
    dotFadeSec: finalPlan.dotFadeSec,
  };
}

/**
 * 全曲选出至多 `KARAOKE_MAX_COUNTDOWN_REENTRY` 个倒计时再入句（返回下一句行下标）。
 * 在 ≥ countdown 阈值的间隙中取最长；同分取更早。无合格间隙则空（仅开场倒计时）。
 */
export function karaokeSelectCountdownReentryLineIndexes(
  adjacentEnds: ReadonlyArray<{ singStart: number; singEnd: number }>,
  opts?: {
    fadeOutSec?: number;
    gapThresholdSec?: number;
    leadInMaxSec?: number;
    maxCount?: number;
  },
): number[] {
  const threshold = opts?.gapThresholdSec ?? KARAOKE_COUNTDOWN_REENTRY_GAP_SEC;
  const leadIdeal = opts?.leadInMaxSec ?? KARAOKE_OPENING_COUNTDOWN_MAX_SEC;
  const maxCount = Math.max(0, Math.floor(opts?.maxCount ?? KARAOKE_MAX_COUNTDOWN_REENTRY));
  if (maxCount <= 0 || adjacentEnds.length < 2) return [];
  const fade = opts?.fadeOutSec ?? KARAOKE_LINE_FADE_OUT_SEC;
  const cands: Array<{ lineIndex: number; gapSec: number }> = [];
  for (let i = 1; i < adjacentEnds.length; i++) {
    const re = karaokeReentryTimeline(adjacentEnds[i].singStart, adjacentEnds[i - 1].singEnd, {
      fadeOutSec: fade,
      gapThresholdSec: threshold,
      leadInMaxSec: leadIdeal,
    });
    if (!re) continue;
    cands.push({ lineIndex: i, gapSec: re.gapSec });
  }
  cands.sort((a, b) => b.gapSec - a.gapSec || a.lineIndex - b.lineIndex);
  return cands
    .slice(0, maxCount)
    .map((c) => c.lineIndex)
    .sort((a, b) => a - b);
}

/** 间奏再入蓝点亮灯（与开场算法相同） */
export function karaokeReentryCountdownLitDots(
  t: number,
  timeline: KaraokeReentryTimeline | null | undefined,
): number {
  return karaokeCountdownWindowLitDots(t, timeline);
}

/**
 * 本句显示起点（预览挂行 / ASS Dialogue Start 共用）：
 * - 首句：开场 lyricAppear（若有）
 * - 选中的倒计时再入句：再入 lyricAppear（= singStart − leadIn）
 * - 清屏长间奏但非倒计时再入：appear = singStart（静默不挂词）
 * - 否则：同槽 prevEnd + fade（短间隙压缩；可早于 singStart 挂白字）
 */
export function karaokeLineDisplayAppearSec(
  singStartSec: number,
  opts?: {
    prevAdjacentSingEndSec?: number | null;
    prevSameSlotSingEndSec?: number | null;
    fadeOutSec?: number;
    firstLyricAppearSec?: number | null;
    isFirstLine?: boolean;
    /** 清屏阈值（默认 10s） */
    gapThresholdSec?: number;
    /** 本句是否为全曲选中的倒计时再入句 */
    isCountdownReentry?: boolean;
    countdownGapThresholdSec?: number;
    leadInMaxSec?: number;
  },
): number {
  const singStart = Number(singStartSec) || 0;
  const fade = opts?.fadeOutSec ?? KARAOKE_LINE_FADE_OUT_SEC;
  if (opts?.isFirstLine) {
    if (
      opts.firstLyricAppearSec != null &&
      Number.isFinite(Number(opts.firstLyricAppearSec))
    ) {
      return Math.min(singStart, Number(opts.firstLyricAppearSec));
    }
    return singStart;
  }

  const adjEnd = opts?.prevAdjacentSingEndSec;
  if (adjEnd != null && Number.isFinite(Number(adjEnd))) {
    if (opts?.isCountdownReentry) {
      const re = karaokeReentryTimeline(singStart, Number(adjEnd), {
        gapThresholdSec: opts?.countdownGapThresholdSec ?? KARAOKE_COUNTDOWN_REENTRY_GAP_SEC,
        fadeOutSec: fade,
        leadInMaxSec: opts?.leadInMaxSec,
      });
      if (re) return re.lyricAppearSec;
    }
    // 清屏间奏：不提前挂词（避免清屏～再入喘息被当成再入提前显词）
    if (
      karaokeIsInterludeGap(
        singStart,
        Number(adjEnd),
        opts?.gapThresholdSec ?? KARAOKE_INTERLUDE_GAP_SEC,
      )
    ) {
      return singStart;
    }
  }

  const sameEnd =
    opts?.prevSameSlotSingEndSec != null &&
    Number.isFinite(Number(opts.prevSameSlotSingEndSec))
      ? Number(opts.prevSameSlotSingEndSec)
      : adjEnd != null && Number.isFinite(Number(adjEnd))
        ? Number(adjEnd)
        : null;
  if (sameEnd != null) {
    return karaokeLineSameSlotAppearSec(singStart, sameEnd, fade);
  }
  return singStart;
}

/**
 * 双行：把「过早的同槽提前显词」推到更早间奏的清屏/再入窗之后，
 * 避免间奏中对侧仍挂着下一句白字。
 * - 清屏静默区：两侧都不挂待唱，直到下一句开唱或倒计时再入窗
 * - 倒计时再入窗内：仅再入那一句挂词；对侧延到该句开唱后再挂
 */
export function karaokeClampAppearAfterInterludes(
  appearSec: number,
  singStartSec: number,
  lineIndex: number,
  adjacentEnds: ReadonlyArray<{ singStart: number; singEnd: number }>,
  opts?: {
    fadeOutSec?: number;
    gapThresholdSec?: number;
    countdownGapThresholdSec?: number;
    leadInMaxSec?: number;
    countdownReentryIndexes?: ReadonlyArray<number> | ReadonlySet<number>;
  },
): number {
  let appear = Number(appearSec) || 0;
  const singStart = Number(singStartSec) || 0;
  const fade = opts?.fadeOutSec ?? KARAOKE_LINE_FADE_OUT_SEC;
  const clearThreshold = opts?.gapThresholdSec ?? KARAOKE_INTERLUDE_GAP_SEC;
  const cdThreshold = opts?.countdownGapThresholdSec ?? KARAOKE_COUNTDOWN_REENTRY_GAP_SEC;
  const leadIdeal = opts?.leadInMaxSec ?? KARAOKE_OPENING_COUNTDOWN_MAX_SEC;
  const cdSet =
    opts?.countdownReentryIndexes instanceof Set
      ? opts.countdownReentryIndexes
      : new Set(
          opts?.countdownReentryIndexes ??
            karaokeSelectCountdownReentryLineIndexes(adjacentEnds, {
              fadeOutSec: fade,
              gapThresholdSec: cdThreshold,
              leadInMaxSec: leadIdeal,
            }),
        );

  for (let j = 1; j <= lineIndex && j < adjacentEnds.length; j++) {
    const nextStart = adjacentEnds[j].singStart;
    const prevEnd = adjacentEnds[j - 1].singEnd;
    if (!karaokeIsInterludeGap(nextStart, prevEnd, clearThreshold)) continue;
    if (singStart + 1e-9 < nextStart) continue;

    const isCd = cdSet.has(j);
    const re = isCd
      ? karaokeReentryTimeline(nextStart, prevEnd, {
          fadeOutSec: fade,
          gapThresholdSec: cdThreshold,
          leadInMaxSec: leadIdeal,
        })
      : null;

    // 本句就是该间奏后的下一句
    if (Math.abs(singStart - nextStart) <= 1e-6) {
      if (re) appear = Math.max(appear, re.lyricAppearSec);
      else appear = Math.max(appear, nextStart);
      continue;
    }
    // 更晚的句：清屏静默 +（若有）再入倒计时期间不挂
    const silenceEnd = re ? re.countdownEnd : nextStart;
    if (appear < silenceEnd - 1e-9) {
      appear = Math.max(appear, silenceEnd);
    }
  }
  return Math.min(appear, singStart);
}

/**
 * 句间实际渐隐时长：目标 `fadeOutSec`；与下一句间隙不足时压缩，重叠则为 0。
 * 顺序始终「旧句淡到 0 → 再出新句」，不叠化。
 */
export function karaokeLineCompressedFadeSec(
  prevSingEndSec: number,
  nextSingStartSec?: number | null,
  fadeOutSec: number = KARAOKE_LINE_FADE_OUT_SEC,
): number {
  const fade = clampKaraokeLineFadeOutSec(fadeOutSec);
  const prevEnd = Number(prevSingEndSec);
  if (!Number.isFinite(prevEnd)) return fade;
  if (nextSingStartSec == null || !Number.isFinite(Number(nextSingStartSec))) {
    return fade;
  }
  const gap = Number(nextSingStartSec) - prevEnd;
  if (gap <= 0) return 0;
  return Math.min(fade, gap);
}

/**
 * 本句可见结束时刻：singEnd + 实际 fade（唱完立刻渐隐）。
 * `nextSingStartSec` 为同槽下一句开唱点时，间隙不足会压缩 fade，使 End 对齐下一句 appear。
 * 预览 fade / ASS Dialogue End 共用。
 */
export function karaokeLineVisibleEndSec(
  singEndSec: number,
  nextSingStartSec?: number | null,
  fadeOutSec: number = KARAOKE_LINE_FADE_OUT_SEC,
): number {
  const end = Number(singEndSec);
  if (!Number.isFinite(end)) return 0;
  return end + karaokeLineCompressedFadeSec(end, nextSingStartSec, fadeOutSec);
}

/**
 * 同槽「下一句」显示起点：`prevSingEnd + fade`（fade 来自 style.lineFadeOutSec，可压缩）。
 * - 须等旧句 opacity 到 0 后再出现；**禁止**在旧句仍淡出时叠化挂新句
 * - 间隙 ≥ fade：appear = prevSingEnd + fade（可早于 nextSingStart 挂待唱白字）
 * - 间隙不足 / 重叠：压缩 fade，appear = prevSingEnd + compressedFade（≤ nextSingStart；重叠则 = prevSingEnd）
 * - 单行：prev = 紧邻 i−1；双行：prev = 同奇偶槽 i−2（A=0,2,4… / B=1,3,5…），两侧互不影响
 * 预览挂行与 ASS Dialogue Start / `\fad` 共用。
 */
export function karaokeLineSameSlotAppearSec(
  nextSingStartSec: number,
  prevSingEndSec?: number | null,
  fadeOutSec: number = KARAOKE_LINE_FADE_OUT_SEC,
): number {
  const singStart = Number(nextSingStartSec) || 0;
  if (prevSingEndSec == null || !Number.isFinite(Number(prevSingEndSec))) {
    return singStart;
  }
  const prevEnd = Number(prevSingEndSec);
  return prevEnd + karaokeLineCompressedFadeSec(prevEnd, singStart, fadeOutSec);
}

/**
 * 句显示窗末尾渐隐：自 singEnd 起在 fadeOutSec 内 1→0（立刻渐隐，不 hold）。
 * 无 singEnd 时退化为 visibleEnd 前的末段 fade。visibleEnd / fade 结束后为 0。
 * 调用方应传入与 VisibleEnd 一致的（可压缩）fade，使 opacity=0 时刻对齐下一句 appear。
 */
export function karaokeLineFadeOutOpacity(
  visibleEndSec: number,
  t: number,
  fadeOutSec: number = KARAOKE_LINE_FADE_OUT_SEC,
  singEndSec?: number,
): number {
  const end = Number(visibleEndSec);
  const fadeBudget = clampKaraokeLineFadeOutSec(fadeOutSec);
  if (!Number.isFinite(end) || !Number.isFinite(t)) return 0;

  const singEnd = singEndSec == null ? NaN : Number(singEndSec);
  let fadeStart: number;
  let fadeEnd: number;
  if (Number.isFinite(singEnd)) {
    // 贴 singEnd 立刻渐隐；时长固定为 fadeBudget（不因 visibleEnd 被拉长）
    fadeStart = singEnd;
    fadeEnd = Math.min(end, singEnd + fadeBudget);
  } else {
    fadeEnd = end;
    fadeStart = end - fadeBudget;
  }
  if (fadeEnd <= fadeStart + 1e-9) {
    return t < end - 1e-9 ? 1 : 0;
  }
  if (t < fadeStart - 1e-6) return 1;
  if (t >= fadeEnd - 1e-9) return 0;
  return Math.max(0, Math.min(1, 1 - (t - fadeStart) / (fadeEnd - fadeStart)));
}

export interface KaraokeProject {
  version: 1;
  /** 原曲音频 URL/路径（来自导演台 mvMusic） */
  audioUrl?: string;
  /** 成片视频 URL/路径 */
  videoUrl?: string;
  /**
   * 预览与烧录使用的音源。
   * 缺省时由 resolveKaraokeAudioSource 按可用媒体推断。
   */
  audioSource?: KaraokeAudioSource;
  /** 用户歌词原文 */
  lyrics: string;
  /** 歌曲名（开场居中） */
  songTitle?: string;
  /** 作词人；空则用致音 */
  lyricist?: string;
  /** 作曲人；空则用致音 */
  composer?: string;
  /**
   * 预览是否叠开场曲名+作词作曲（默认 true）。
   * 烧录 / 导出 ASS 始终写入开场，不受此开关影响。
   */
  previewOpeningCredits?: boolean;
  songDurationSec: number;
  /** 全局时间偏移（秒），行级微调 */
  globalOffsetSec: number;
  timingSource: KaraokeTimingSource;
  lines: KaraokeLine[];
  /**
   * 最近一次 fun-asr 字/词级时间戳（可选）。
   * 有则生成/重映射时优先用真实节奏；切镜仍只用句级 lyricSegments。
   */
  asrWords?: KaraokeAsrWordTiming[];
  /**
   * 生成后若多句为弱匹配/漏句插值则为 true，UI 提示「部分句对齐较弱」。
   */
  weakLineAlignment?: boolean;
  /**
   * 生成字级时间轴时的识别语言（默认 auto）。
   * 粤语歌请选 yue 后重新生成。
   */
  asrLanguage?: KaraokeAsrLanguage;
  style?: KaraokeStyleOptions;
  /** 生成时间 */
  updatedAt?: number;
}

/** 作词/作曲空串 → 致音 */
export function resolveKaraokeCreditName(raw: string | undefined | null): string {
  const s = String(raw || '').trim();
  return s || DEFAULT_KARAOKE_CREDIT_NAME;
}

/** 解析有效音源：尊重用户选择；缺源时回退到另一可用源 */
export function resolveKaraokeAudioSource(
  project: Pick<KaraokeProject, 'audioSource' | 'audioUrl' | 'videoUrl'> | null | undefined,
  opts?: { allowPendingVideo?: boolean },
): KaraokeAudioSource {
  const hasAudio = !!String(project?.audioUrl || '').trim();
  const hasVideo = !!String(project?.videoUrl || '').trim() || !!opts?.allowPendingVideo;
  const pref =
    project?.audioSource === 'song' || project?.audioSource === 'video'
      ? project.audioSource
      : hasVideo
        ? 'video'
        : 'song';
  if (pref === 'song' && !hasAudio && hasVideo) return 'video';
  if (pref === 'video' && !hasVideo && hasAudio) return 'song';
  return pref;
}

export type KaraokeStyleResolved = Required<
  Omit<KaraokeStyleOptions, 'indicator' | 'countdown'>
> & {
  indicator: Required<KaraokeIndicatorOptions>;
  countdown: Required<KaraokeCountdownOptions>;
};

/** 开场曲名默认坐标（近居中 x=961 + 字顶 Y） */
export const DEFAULT_KARAOKE_OPENING_TITLE_POS: KaraokePos = {
  x: 961,
  y: KARAOKE_OPENING_TITLE_Y,
};

export const DEFAULT_KARAOKE_STYLE: KaraokeStyleResolved = {
  /** 已唱 = 男色（无角色标记时；有 (男)/男： 等则用对应 roleColors） */
  sungColor: KARAOKE_ROLE_SUNG_COLORS.male,
  /** 未唱白 #FFFFFF */
  unsungColor: '&H00FFFFFF',
  /** 男蓝 / 女红 / 合绿（男色同时作为无标记已唱色） */
  roleColors: { ...KARAOKE_ROLE_SUNG_COLORS },
  fontName: KARAOKE_PREFERRED_FONT,
  fontSize: 96,
  marginV: 48,
  alignment: 2,
  layoutMode: 'dualAlternate',
  posA: { ...DEFAULT_KARAOKE_POS_A },
  posB: { ...DEFAULT_KARAOKE_POS_B },
  /** 未唱描边黑 */
  outlineColor: '&H00000000',
  /** 已唱描边白（对齐预览扫字白边；上层 KaraokeSung，UI 可改） */
  sungOutlineColor: '&H00FFFFFF',
  /** 阴影黑（ASS BackColour；导出时写入半透明 alpha + Style Shadow + 适度 blur） */
  shadowColor: '&H00000000',
  outline: KARAOKE_LYRIC_OUTLINE_DEFAULT,
  sungOutlineWidth: KARAOKE_LYRIC_SUNG_OUTLINE_DEFAULT,
  /** 软阴影距离（固定 0；UI 已移除） */
  shadow: KARAOKE_LYRIC_SHADOW_DEFAULT,
  indicator: { ...DEFAULT_KARAOKE_INDICATOR },
  countdown: {
    ...DEFAULT_KARAOKE_COUNTDOWN,
    anchor: { ...DEFAULT_KARAOKE_COUNTDOWN_ANCHOR },
    positions: [],
  },
  openingTitleFontSize: KARAOKE_OPENING_TITLE_FONT_SIZE,
  openingCreditFontSize: KARAOKE_OPENING_CREDIT_FONT_SIZE,
  openingTitleOutline: KARAOKE_OPENING_TITLE_OUTLINE,
  openingCreditOutline: KARAOKE_OPENING_CREDIT_OUTLINE,
  lineFadeOutSec: KARAOKE_LINE_FADE_OUT_SEC,
  interludeClearGapSec: KARAOKE_INTERLUDE_GAP_SEC,
  countdownReentryGapSec: KARAOKE_COUNTDOWN_REENTRY_GAP_SEC,
  countdownLeadInMaxSec: KARAOKE_OPENING_COUNTDOWN_MAX_SEC,
  openingTitlePos: { ...DEFAULT_KARAOKE_OPENING_TITLE_POS },
  openingLyricistPos: { ...KARAOKE_OPENING_LYRICIST_POS },
  openingComposerPos: { ...KARAOKE_OPENING_COMPOSER_POS },
};

/** 合并/缺省补齐男/女/合已唱色（ASS BGR） */
export function resolveKaraokeRoleColors(
  colors?: Partial<KaraokeRoleColors> | null,
): KaraokeRoleColors {
  const d = KARAOKE_ROLE_SUNG_COLORS;
  return {
    male: (colors?.male && String(colors.male).trim()) || d.male,
    female: (colors?.female && String(colors.female).trim()) || d.female,
    chorus: (colors?.chorus && String(colors.chorus).trim()) || d.chorus,
  };
}

/** 深拷贝一份可写入工程的默认字幕样式（位置 + 字号/描边/颜色等） */
export function createDefaultKaraokeStyle(): KaraokeStyleResolved {
  const roleColors = { ...KARAOKE_ROLE_SUNG_COLORS };
  return {
    ...DEFAULT_KARAOKE_STYLE,
    roleColors,
    sungColor: roleColors.male,
    posA: { ...DEFAULT_KARAOKE_POS_A },
    posB: { ...DEFAULT_KARAOKE_POS_B },
    indicator: { ...DEFAULT_KARAOKE_INDICATOR },
    countdown: {
      ...DEFAULT_KARAOKE_COUNTDOWN,
      anchor: { ...DEFAULT_KARAOKE_COUNTDOWN_ANCHOR },
      positions: [],
    },
    openingTitlePos: { ...DEFAULT_KARAOKE_OPENING_TITLE_POS },
    openingLyricistPos: { ...KARAOKE_OPENING_LYRICIST_POS },
    openingComposerPos: { ...KARAOKE_OPENING_COMPOSER_POS },
  };
}

/** 中文字体预设（value 写入 ASS Fontname / CSS font-family；文鼎为应用内嵌） */
export const KARAOKE_FONT_PRESETS: ReadonlyArray<{ value: string; labelZh: string; labelEn: string }> = [
  {
    value: KARAOKE_PREFERRED_FONT,
    labelZh: '微软雅黑（样片风格建议）',
    labelEn: 'Microsoft YaHei (sample style)',
  },
  { value: 'Noto Sans SC', labelZh: '思源黑体 / Noto', labelEn: 'Noto Sans SC' },
  { value: 'SimHei', labelZh: '黑体', labelEn: 'SimHei' },
  { value: 'Microsoft JhengHei', labelZh: '微软正黑体', labelEn: 'Microsoft JhengHei' },
  {
    value: KARAOKE_PREFERRED_FONT_LEGACY,
    labelZh: '文鼎中特圆',
    labelEn: 'AR Yenti Extra B5 / WenDing Round',
  },
  { value: 'SimSun', labelZh: '宋体', labelEn: 'SimSun' },
  { value: 'KaiTi', labelZh: '楷体', labelEn: 'KaiTi' },
  { value: 'FangSong', labelZh: '仿宋', labelEn: 'FangSong' },
  { value: 'PingFang SC', labelZh: '苹方', labelEn: 'PingFang SC' },
];

/** ASS &HAABBGGRR → CSS #RRGGBB */
export function assBgrToCssHex(ass: string | undefined | null, fallback = '#FFFFFF'): string {
  const m = String(ass || '').match(/&H([0-9A-Fa-f]{6,8})/i);
  if (!m) return fallback;
  const raw = m[1].padStart(8, '0').slice(-6);
  const bb = raw.slice(0, 2);
  const gg = raw.slice(2, 4);
  const rr = raw.slice(4, 6);
  return `#${rr}${gg}${bb}`.toUpperCase();
}

/** CSS #RRGGBB → ASS &H00BBGGRR */
export function cssHexToAssBgr(hex: string | undefined | null, fallback = '&H00FFFFFF'): string {
  const m = String(hex || '')
    .replace(/^#/, '')
    .match(/^([0-9A-Fa-f]{6})$/);
  if (!m) return fallback;
  const rr = m[1].slice(0, 2);
  const gg = m[1].slice(2, 4);
  const bb = m[1].slice(4, 6);
  return `&H00${bb}${gg}${rr}`.toUpperCase();
}

/**
 * 规范化为 ASS Style 色 `&HAABBGGRR`（无尾部 `&`）。
 * 兼容已是 ASS、或误存的 CSS `#RRGGBB`（后者若不转会让 `\\3c#FFF&` 失效而回落 Style 黑边）。
 */
export function normalizeKaraokeAssColor(
  raw: string | undefined | null,
  fallback: string,
): string {
  const fbRaw = String(fallback || '').trim();
  const fb = fbRaw.endsWith('&') ? fbRaw.slice(0, -1) : fbRaw || '&H00FFFFFF';
  const s = String(raw || '').trim();
  if (!s) return fb;
  const ass = s.match(/^&H([0-9A-Fa-f]{6,8})&?$/i);
  if (ass) {
    return `&H${ass[1].padStart(8, '0').slice(-8).toUpperCase()}`;
  }
  const asCss = cssHexToAssBgr(s, '');
  if (asCss) return asCss;
  return fb;
}

/** ASS 颜色写入 override 标签时补尾部 & */
export function assColorTag(ass: string): string {
  const normalized = normalizeKaraokeAssColor(ass, '&H00FFFFFF');
  return normalized.endsWith('&') ? normalized : `${normalized}&`;
}

export function resolveKaraokeIndicator(
  ind?: KaraokeIndicatorOptions | null,
): Required<KaraokeIndicatorOptions> {
  const d = DEFAULT_KARAOKE_INDICATOR;
  return {
    // 显式 true 才开；缺省 / false → 关（与 DEFAULT.enabled=false 一致）
    enabled: ind?.enabled === true,
    offsetX: Number.isFinite(Number(ind?.offsetX)) ? Math.round(Number(ind?.offsetX)) : d.offsetX,
    offsetY: Number.isFinite(Number(ind?.offsetY)) ? Math.round(Number(ind?.offsetY)) : d.offsetY,
    size: Math.max(8, Math.min(200, Math.round(Number(ind?.size) || d.size))),
    gap: Math.max(0, Math.min(80, Math.round(Number(ind?.gap) ?? d.gap))),
  };
}

/** 钳制倒计时点间距（圆心距） */
export function clampKaraokeCountdownSpacing(n: unknown): number {
  const v = Math.round(Number(n));
  if (!Number.isFinite(v)) return KARAOKE_COUNTDOWN_SPACING_DEFAULT;
  return Math.max(
    KARAOKE_COUNTDOWN_SPACING_MIN,
    Math.min(KARAOKE_COUNTDOWN_SPACING_MAX, v),
  );
}

/** 解析 countdown.positions：非法项 → null（仅作旧工程 anchor 回退） */
export function resolveKaraokeCountdownPositions(
  raw?: ReadonlyArray<KaraokePos | null | undefined> | null,
): Array<KaraokePos | null> {
  if (!Array.isArray(raw) || raw.length === 0) return [];
  const out: Array<KaraokePos | null> = [];
  const n = Math.min(KARAOKE_COUNTDOWN_POSITIONS_MAX, raw.length);
  for (let i = 0; i < n; i++) {
    const p = raw[i];
    if (!p || typeof p !== 'object') {
      out.push(null);
      continue;
    }
    const x = Math.round(Number((p as KaraokePos).x));
    const y = Math.round(Number((p as KaraokePos).y));
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      out.push(null);
      continue;
    }
    out.push({
      x: Math.max(0, Math.min(ASS_PLAY_RES_X, x)),
      y: Math.max(0, Math.min(ASS_PLAY_RES_Y, y)),
    });
  }
  return out;
}

/** 钳制组锚点（首点圆心）；可选按点数与间距预留右侧跨度，避免末点挤出画布 */
export function clampKaraokeCountdownAnchor(
  pos: KaraokePos | null | undefined,
  opts?: { spacing?: number; count?: number },
): KaraokePos | null {
  if (!pos || typeof pos !== 'object') return null;
  const x = Math.round(Number(pos.x));
  const y = Math.round(Number(pos.y));
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  const count = Math.max(1, Math.min(8, Math.round(Number(opts?.count) || 4)));
  const sp = clampKaraokeCountdownSpacing(
    opts?.spacing != null ? opts.spacing : KARAOKE_COUNTDOWN_SPACING_DEFAULT,
  );
  const span = Math.max(0, (count - 1) * sp);
  const maxX = Math.max(0, ASS_PLAY_RES_X - span);
  return {
    x: Math.max(0, Math.min(maxX, x)),
    y: Math.max(0, Math.min(ASS_PLAY_RES_Y, y)),
  };
}

/**
 * 解析组锚点：显式 anchor → 旧 positions[0] → null（调用方用 Line A 默认锚）。
 */
export function resolveKaraokeCountdownAnchor(
  cd?: KaraokeCountdownOptions | null,
): KaraokePos | null {
  const spacing = clampKaraokeCountdownSpacing(
    cd?.spacing != null ? cd.spacing : KARAOKE_COUNTDOWN_SPACING_DEFAULT,
  );
  const count = Math.max(1, Math.min(8, Math.round(Number(cd?.count) || 4)));
  const fromAnchor = clampKaraokeCountdownAnchor(cd?.anchor, { spacing, count });
  if (fromAnchor) return fromAnchor;
  const legacy = resolveKaraokeCountdownPositions(cd?.positions);
  const first = legacy.find((p) => p != null) || null;
  return clampKaraokeCountdownAnchor(first, { spacing, count });
}

/**
 * 有效组锚点：自定义 anchor（或旧 positions 回退）优先，否则 defaultAnchor。
 */
export function karaokeCountdownGroupAnchor(
  cd: Pick<KaraokeCountdownOptions, 'anchor' | 'positions' | 'spacing' | 'count'> | null | undefined,
  defaultAnchor: KaraokePos,
): KaraokePos {
  const custom = resolveKaraokeCountdownAnchor(cd);
  if (custom) return custom;
  const ax = Number(defaultAnchor?.x);
  const ay = Number(defaultAnchor?.y);
  return {
    x: Number.isFinite(ax) ? Math.round(ax) : DEFAULT_KARAOKE_POS_A.x,
    y: Number.isFinite(ay) ? Math.round(ay) : DEFAULT_KARAOKE_POS_A.y,
  };
}

/**
 * 锚点 + 间距下第 index 个点的圆心（左起 0）。
 * 开场/再入与每句 KaraokeCD 共用。
 */
export function karaokeCountdownDefaultDotPos(
  anchor: KaraokePos,
  index: number,
  spacing: number,
): KaraokePos {
  const sp = clampKaraokeCountdownSpacing(spacing);
  const i = Math.max(0, Math.floor(Number(index) || 0));
  const ax = Number(anchor?.x);
  const ay = Number(anchor?.y);
  const x = (Number.isFinite(ax) ? ax : DEFAULT_KARAOKE_POS_A.x) + i * sp;
  const y = Number.isFinite(ay) ? ay : DEFAULT_KARAOKE_POS_A.y;
  return {
    x: Math.max(0, Math.min(ASS_PLAY_RES_X, Math.round(x))),
    y: Math.max(0, Math.min(ASS_PLAY_RES_Y, Math.round(y))),
  };
}

/** 解析第 index 点最终圆心：组锚 + i×spacing（四点整组，无单点覆盖） */
export function karaokeCountdownResolvedDotPos(
  cd: Pick<KaraokeCountdownOptions, 'spacing' | 'anchor' | 'positions' | 'count'>,
  defaultAnchor: KaraokePos,
  index: number,
): KaraokePos {
  const group = karaokeCountdownGroupAnchor(cd, defaultAnchor);
  return karaokeCountdownDefaultDotPos(group, index, cd.spacing ?? KARAOKE_COUNTDOWN_SPACING_DEFAULT);
}

export function resolveKaraokeCountdown(
  cd?: KaraokeCountdownOptions | null,
): Required<KaraokeCountdownOptions> {
  const d = DEFAULT_KARAOKE_COUNTDOWN;
  // 显式 true 才开；缺省 / false → 关（与 DEFAULT.enabled=false 一致）
  const enabled = cd?.enabled === true;
  const count = Math.max(1, Math.min(8, Math.round(Number(cd?.count) || d.count)));
  const intervalSec = Math.max(
    0.25,
    Math.min(3, Number(cd?.intervalSec) || d.intervalSec),
  );
  const size = Math.max(
    KARAOKE_COUNTDOWN_DOT_SIZE_MIN,
    Math.min(
      KARAOKE_COUNTDOWN_DOT_SIZE_MAX,
      Math.round(Number(cd?.size) || d.size),
    ),
  );
  const spacing = clampKaraokeCountdownSpacing(
    cd?.spacing != null ? cd.spacing : d.spacing,
  );
  const offsetY = Number.isFinite(Number(cd?.offsetY))
    ? Math.round(Number(cd?.offsetY))
    : d.offsetY;
  const color = String(cd?.color || d.color).trim() || d.color;
  // 迁移旧 positions → anchor；持久化侧可随后清掉 positions
  const anchor = resolveKaraokeCountdownAnchor(cd);
  return {
    enabled,
    count,
    color,
    intervalSec,
    offsetY,
    size,
    spacing,
    anchor,
    positions: [],
  };
}

/**
 * 单句倒计时窗起点：默认 start - count×interval。
 * - 与上一句空隙 ≥ 1×interval：倒计时收进空隙（min(满 lead, gap)）
 * - 空隙更短或时间重叠：倒计时仍从上一句结束后开始（可缩短亮点个数），
 *   避免上一句演唱中把下一句的点画在上一句下方
 */
export function karaokeCountdownWindowStartSec(
  singStartSec: number,
  prevEndSec?: number | null,
  cd?: KaraokeCountdownOptions | null,
): number {
  const c = resolveKaraokeCountdown(cd);
  const start = Number(singStartSec);
  if (!Number.isFinite(start)) return 0;
  const idealLead = c.count * c.intervalSec;
  let windowStart = start - idealLead;
  const prev = Number(prevEndSec);
  // 有上一句时：倒计时不得侵入上一句演唱区间（短间隙则压缩 lead）
  if (Number.isFinite(prev) && prev < start) {
    windowStart = Math.max(windowStart, prev);
  }
  return Math.max(0, Math.min(start, windowStart));
}

/**
 * 开唱前倒计时：t ∈ [windowStart, start) 时亮点个数。
 * 每 intervalSec 熄灭 1 个；t≥start 时为 0。
 * 可传 windowStartSec（短句间隙缩短后的窗）；缺省为 start - count×interval。
 */
export function karaokeCountdownLitDots(
  lineStartSec: number,
  t: number,
  cd?: KaraokeCountdownOptions | null,
  opts?: { windowStartSec?: number },
): number {
  const c = resolveKaraokeCountdown(cd);
  if (!c.enabled) return 0;
  const start = Number(lineStartSec);
  if (!Number.isFinite(start) || !Number.isFinite(t) || t >= start) return 0;
  const idealLead = c.count * c.intervalSec;
  const windowStart =
    opts?.windowStartSec != null && Number.isFinite(Number(opts.windowStartSec))
      ? Math.max(0, Math.min(start, Number(opts.windowStartSec)))
      : start - idealLead;
  if (t < windowStart - 1e-6) return 0;
  const remaining = start - t;
  const avail = Math.max(0, start - windowStart);
  if (remaining <= 0 || avail <= 1e-6) return 0;
  const maxDots = Math.min(c.count, Math.max(1, Math.ceil(avail / c.intervalSec - 1e-9)));
  return Math.min(maxDots, Math.max(0, Math.ceil(remaining / c.intervalSec - 1e-9)));
}

export function clampKaraokeAssAlignment(n: unknown): KaraokeAssAlignment {
  const v = Math.round(Number(n));
  if (v >= 1 && v <= 9) return v as KaraokeAssAlignment;
  return DEFAULT_KARAOKE_STYLE.alignment as KaraokeAssAlignment;
}

export function karaokeAlignmentFromPreset(preset: KaraokePositionPreset): KaraokeAssAlignment {
  switch (preset) {
    case 'top':
      return 8;
    case 'middle':
      return 5;
    default:
      return 2;
  }
}

export function karaokePresetFromAlignment(alignment: unknown): KaraokePositionPreset {
  const a = clampKaraokeAssAlignment(alignment);
  if (a >= 7) return 'top';
  if (a >= 4) return 'middle';
  return 'bottom';
}

export function clampKaraokePos(p: Partial<KaraokePos> | undefined, fallback: KaraokePos): KaraokePos {
  const fx = Math.round(Number(fallback?.x));
  const fy = Math.round(Number(fallback?.y));
  const safeFb: KaraokePos = {
    x: Number.isFinite(fx) ? Math.max(0, Math.min(ASS_PLAY_RES_X, fx)) : DEFAULT_KARAOKE_POS_A.x,
    y: Number.isFinite(fy) ? Math.max(0, Math.min(ASS_PLAY_RES_Y, fy)) : DEFAULT_KARAOKE_POS_A.y,
  };
  const x = Math.round(Number(p?.x));
  const y = Math.round(Number(p?.y));
  return {
    x: Number.isFinite(x) ? Math.max(0, Math.min(ASS_PLAY_RES_X, x)) : safeFb.x,
    y: Number.isFinite(y) ? Math.max(0, Math.min(ASS_PLAY_RES_Y, y)) : safeFb.y,
  };
}

/** 由 MarginV + Alignment 推导 PlayRes 中心对齐点（无 pos 旧工程回退） */
export function karaokePosFromMarginAlignment(marginV: unknown, alignment: unknown): KaraokePos {
  const a = clampKaraokeAssAlignment(alignment);
  const mv = Math.max(0, Math.min(500, Math.round(Number(marginV) || 0)));
  const col = ((a - 1) % 3) as 0 | 1 | 2;
  const x = col === 0 ? 80 : col === 2 ? ASS_PLAY_RES_X - 80 : Math.round(ASS_PLAY_RES_X / 2);
  let y: number;
  if (a >= 7) y = mv;
  else if (a >= 4) y = Math.round(ASS_PLAY_RES_Y / 2);
  else y = ASS_PLAY_RES_Y - mv;
  return clampKaraokePos({ x, y }, DEFAULT_KARAOKE_POS_A);
}

/** 预设 → PlayRes 位置（单行：底/中/顶水平居中） */
export function karaokePosFromPreset(preset: KaraokePositionPreset, marginV = DEFAULT_KARAOKE_STYLE.marginV): KaraokePos {
  return karaokePosFromMarginAlignment(marginV, karaokeAlignmentFromPreset(preset));
}

/**
 * 双行预设：A 左缘锚 / B 右缘锚（x=147 / x=1778）；Y 随底/中/顶，底部固定 Y759/Y911。
 */
export function karaokeDualPosFromPreset(
  preset: KaraokePositionPreset,
  marginV = DEFAULT_KARAOKE_STYLE.marginV,
): { posA: KaraokePos; posB: KaraokePos } {
  const mv = Math.max(0, Math.min(500, Math.round(Number(marginV) || DEFAULT_KARAOKE_STYLE.marginV)));
  const gap = Math.max(80, DEFAULT_KARAOKE_POS_B.y - DEFAULT_KARAOKE_POS_A.y);
  const xA = DEFAULT_KARAOKE_POS_A.x;
  const xB = DEFAULT_KARAOKE_POS_B.x;
  switch (preset) {
    case 'top': {
      const yA = mv;
      const yB = Math.min(ASS_PLAY_RES_Y, yA + gap);
      return {
        posA: clampKaraokePos({ x: xA, y: yA }, DEFAULT_KARAOKE_POS_A),
        posB: clampKaraokePos({ x: xB, y: yB }, DEFAULT_KARAOKE_POS_B),
      };
    }
    case 'middle': {
      const mid = Math.round(ASS_PLAY_RES_Y / 2);
      const yA = Math.max(0, mid - Math.round(gap / 2));
      const yB = Math.min(ASS_PLAY_RES_Y, yA + gap);
      return {
        posA: clampKaraokePos({ x: xA, y: yA }, DEFAULT_KARAOKE_POS_A),
        posB: clampKaraokePos({ x: xB, y: yB }, DEFAULT_KARAOKE_POS_B),
      };
    }
    default:
      return {
        posA: { ...DEFAULT_KARAOKE_POS_A },
        posB: { ...DEFAULT_KARAOKE_POS_B },
      };
  }
}

export function resolveKaraokeLayoutMode(mode: unknown): KaraokeLayoutMode {
  return mode === 'single' ? 'single' : 'dualAlternate';
}

/** 按布局取位置 A 缺省：单行下方居中；双行左锚 */
export function defaultKaraokePosAForLayout(layoutMode?: unknown): KaraokePos {
  return resolveKaraokeLayoutMode(layoutMode) === 'single'
    ? { ...DEFAULT_KARAOKE_POS_SINGLE }
    : { ...DEFAULT_KARAOKE_POS_A };
}

/** 解析位置 A：显式 posA 优先，否则由 marginV/alignment 推导 */
export function resolveKaraokePosA(style?: KaraokeStyleOptions | null): KaraokePos {
  const s = style || {};
  const fallback = defaultKaraokePosAForLayout(s.layoutMode);
  if (s.posA != null && Number.isFinite(Number(s.posA.x)) && Number.isFinite(Number(s.posA.y))) {
    return clampKaraokePos(s.posA, fallback);
  }
  // 无显式 pos 且未用旧 margin 推导意图时：单行居中 / 双行左锚
  if (s.marginV == null && s.alignment == null) {
    return clampKaraokePos(fallback, fallback);
  }
  return karaokePosFromMarginAlignment(
    s.marginV ?? DEFAULT_KARAOKE_STYLE.marginV,
    s.alignment ?? DEFAULT_KARAOKE_STYLE.alignment,
  );
}

/** 开场曲名位置（缺省 DEFAULT_KARAOKE_OPENING_TITLE_POS ≈(961,337)） */
export function resolveKaraokeOpeningTitlePos(style?: KaraokeStyleOptions | null): KaraokePos {
  const p = style?.openingTitlePos;
  if (p != null && Number.isFinite(Number(p.x)) && Number.isFinite(Number(p.y))) {
    return clampKaraokePos(p, DEFAULT_KARAOKE_OPENING_TITLE_POS);
  }
  return { ...DEFAULT_KARAOKE_OPENING_TITLE_POS };
}

/** 开场作词位置 */
export function resolveKaraokeOpeningLyricistPos(style?: KaraokeStyleOptions | null): KaraokePos {
  const p = style?.openingLyricistPos;
  if (p != null && Number.isFinite(Number(p.x)) && Number.isFinite(Number(p.y))) {
    return clampKaraokePos(p, KARAOKE_OPENING_LYRICIST_POS);
  }
  return { ...KARAOKE_OPENING_LYRICIST_POS };
}

/** 开场作曲位置 */
export function resolveKaraokeOpeningComposerPos(style?: KaraokeStyleOptions | null): KaraokePos {
  const p = style?.openingComposerPos;
  if (p != null && Number.isFinite(Number(p.x)) && Number.isFinite(Number(p.y))) {
    return clampKaraokePos(p, KARAOKE_OPENING_COMPOSER_POS);
  }
  return { ...KARAOKE_OPENING_COMPOSER_POS };
}

export function resolveKaraokePosB(style?: KaraokeStyleOptions | null): KaraokePos {
  const s = style || {};
  if (s.posB != null && Number.isFinite(Number(s.posB.x)) && Number.isFinite(Number(s.posB.y))) {
    return clampKaraokePos(s.posB, DEFAULT_KARAOKE_POS_B);
  }
  return clampKaraokePos(DEFAULT_KARAOKE_POS_B, DEFAULT_KARAOKE_POS_B);
}

/** 由 PlayRes Y 回写近似 marginV + alignment（保持滑条/预设可用） */
export function karaokeMarginAlignmentFromPos(pos: KaraokePos): { marginV: number; alignment: KaraokeAssAlignment } {
  const y = clampKaraokePos(pos, DEFAULT_KARAOKE_POS_A).y;
  const topBand = ASS_PLAY_RES_Y * 0.33;
  const bottomBand = ASS_PLAY_RES_Y * 0.67;
  if (y <= topBand) {
    return { marginV: Math.max(0, Math.min(500, y)), alignment: 8 };
  }
  if (y >= bottomBand) {
    return { marginV: Math.max(0, Math.min(500, ASS_PLAY_RES_Y - y)), alignment: 2 };
  }
  return { marginV: Math.max(0, Math.min(500, Math.round(Math.abs(y - ASS_PLAY_RES_Y / 2)))), alignment: 5 };
}
