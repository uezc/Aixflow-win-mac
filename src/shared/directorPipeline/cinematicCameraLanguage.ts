/**
 * MV / 分镜：电影级拍摄手法总盘点
 * —— 短标签（表内）→ 生图/生视频提示词展开句
 * 气质参考（不署名写入 prompt）：Deakins / Lubezki / van Hoytema /
 * Storaro / Doyle·王家卫 / Gordon Willis / Spike Jonze MV /
 * Annie Leibovitz / Platon / Chivo 贴身广角 等。
 */

/** 嵌入 LLM 剧本/拆镜：禁止只会「平视+中焦」 */
export const DIRECTOR_CINEMATIC_CAMERA_GUIDE = `【电影级镜头语言·硬性】
「镜头角度」「焦距」必须写可拍的电影摄影手法，禁止整表反复「平视」「中焦」「标准」「正常」。
角度优先用短而具体的手法词（可带修饰，控制在 2–8 字）：
· 建置/空镜：高机俯瞰、航拍俯冲感、天花板鸟瞰、窗框窥视、侧逆轮廓剪影
· 亲密/对口型：过肩窥视、微俯压迫、低机位仰拍、贴脸极近、荷兰斜角
· 关系/双人：过肩对切、镜像对位、斜侧三分、背影远距窥视
· 情绪冲击：荷兰角失衡、虫视角仰望、俯视审判感、贴地跟拍
焦距优先写具体焦段+气质（或等价短词），例如：
· 14–24mm 畸变空间感 / 超广角沉浸
· 28–35mm 纪实街拍感
· 40–50mm 人文叙事感
· 70–85mm 人像压缩 / 浅景深隔离
· 100–135mm 偷窥压缩 / 远距抽离
· 鱼眼/微距仅偶尔用于间奏或抽象空镜
曲式建议：前奏偏广角建置；主歌 35–50mm 叙事；副歌可 85mm 近距或低机仰拍；间奏可荷兰角/非常规焦段；尾奏可长焦远距或高机缓退。
相邻行角度或焦距必须变化；同一「平视」连续不得超过 2 行；「中焦/标准」合计不得超过总行数 25%。`;

/**
 * MV 场景提示词公式（含空场景 / 场景库 / 空镜画面）。
 * 结构：年代 + 地点 + 物品陈设 + 材质 + 光线 + 无人硬约束。
 */
export const DIRECTOR_MV_SCENE_PROMPT_FORMULA_GUIDE = `【场景提示词公式·硬性】
结构（按槽位成句，可用逗号/顿号串联）：
【年代】+【地点】+【物品/陈设】+【材质】+【光线】+【约束】
即：年代/时代气质 + 地点 + 物品/陈设（详细具体） + 材质 + 光线 + 硬性约束：无人。
要求：
· 物品/陈设必须具体：名称 + 位置 + 状态（如「石桌上倾倒的粗陶罐，罐口朝向左侧，干枯枝条散落桌面」）；
· 空场景/空镜硬约束必须写清：无人物、无人脸、无肢体、无人影、无人形雕像、无疑似人形阴影；仅环境与静物；
· 场景提示词禁止写手部/眼部/脸部微动态与运镜表演（那些属于动作提示词）；
· 场景库每行、空镜的「动作与画面」/画面描述中的环境部分，均须按此公式落笔。`;

/**
 * MV 动作提示词：按本镜时长切成秒级时轴，每段写清动作 / 表情 / 场景动态。
 * 具体切段密度由「镜头变化」三档决定（见 resolveDirectorMvShotChangePaceGuide）。
 */
export const DIRECTOR_MV_PERFORMANCE_DYNAMICS_GUIDE = `【动作时轴公式·硬性·成片级】
有人镜的「画面描述 / 最终提示词·详细描述」必须按本镜「时长」写成相对本镜 0 秒起算的连续毫秒时轴，禁止只写一句笼统动作。
格式（对齐 MiniMax-H3）：
详细描述内按切段写 [镜头N]，时段用 MM:SS.mmm：
[镜头1] 00:00.000至00:01.200区间，…｜动作/表情/场景动态…
[镜头2] 00:01.200处，… 00:01.200至00:02.400区间，…
亦允许同镜内连续时段（不必每段都切镜头号），但必须出现「00:00.000至…」毫秒区间。
每段必填：可见动作、表情微变、场景动态（光影/风/帘影等）；禁止抽象「很伤感」。
切段规则：以当前「镜头变化」档的推荐转换时长 T 为基准；末段终点必须等于本镜时长；相邻段首尾相接。
【口型与台词】
· 默认不对口型：禁止 <d> 标签与歌词原文；全员双唇紧闭。
· 仅当本镜开启对口型且有真实歌词/台词：须在对应毫秒区间写
  <主体N>（S1）口型与<音频1>同步，台词：<d>[中文] …</d>
  画面仍禁止出现字幕/歌词叠字。
空镜：写环境时轴同格式，无人物无人脸。
禁止只写「0.0–1.2s｜动作：…」粗秒格式敷衍（须升级为 00:00.000 毫秒格式）。`;

/** MV 镜头变化三档：影响动作时轴切段密度与提示词节奏气质 */
export type DirectorMvShotChangePace = 'fast' | 'normal' | 'slow';

export type DirectorMvShotChangePacePreset = {
  id: DirectorMvShotChangePace;
  /** 快速变化 / 普通切换 / 慢速切换 */
  labelZh: string;
  labelEn: string;
  /** 激烈 / 叙事 / 抒情 */
  moodZh: string;
  moodEn: string;
  /** 推荐转换时长（秒） */
  recommendSec: number;
  beatMinSec: number;
  beatMaxSec: number;
  /** 段数指引文案 */
  segmentHintZh: string;
};

export const DIRECTOR_MV_SHOT_CHANGE_PACE_PRESETS: Record<
  DirectorMvShotChangePace,
  DirectorMvShotChangePacePreset
> = {
  fast: {
    id: 'fast',
    labelZh: '快速变化',
    labelEn: 'Fast cuts',
    moodZh: '激烈',
    moodEn: 'Intense',
    recommendSec: 0.8,
    beatMinSec: 0.6,
    beatMaxSec: 1.0,
    segmentHintZh: '4s→4–5 段；5–6s→5–7 段；10–15s→8–12 段；信息密度高、切点利落',
  },
  normal: {
    id: 'normal',
    labelZh: '普通切换',
    labelEn: 'Normal cuts',
    moodZh: '叙事',
    moodEn: 'Narrative',
    recommendSec: 1.2,
    beatMinSec: 1.0,
    beatMaxSec: 1.5,
    segmentHintZh: '4s→2–3 段；5–6s→3–4 段；10–15s→5–8 段；节奏清晰可跟读',
  },
  slow: {
    id: 'slow',
    labelZh: '慢速切换',
    labelEn: 'Slow cuts',
    moodZh: '抒情',
    moodEn: 'Lyrical',
    recommendSec: 2.0,
    beatMinSec: 1.8,
    beatMaxSec: 2.5,
    segmentHintZh: '4s→2 段；5–6s→2–3 段；10–15s→4–6 段；留白与余韵更强',
  },
};

export function normalizeDirectorMvShotChangePace(
  raw: string | undefined | null,
): DirectorMvShotChangePace {
  const s = String(raw || '').trim();
  if (s === 'fast' || s === 'slow' || s === 'normal') return s;
  return 'normal';
}

export function getDirectorMvShotChangePacePreset(
  pace?: string | null,
): DirectorMvShotChangePacePreset {
  return DIRECTOR_MV_SHOT_CHANGE_PACE_PRESETS[normalizeDirectorMvShotChangePace(pace)];
}

/** 写入 LLM：当前镜头变化档 + 推荐转换时长 + 切段规则 */
export function resolveDirectorMvShotChangePaceGuide(pace?: string | null): string {
  const p = getDirectorMvShotChangePacePreset(pace);
  return `【镜头变化档·硬性·已选】
档位：${p.labelZh}（${p.moodZh}）
推荐转换时长：${p.recommendSec}s（单段宜落在 ${p.beatMinSec}–${p.beatMaxSec}s）
切段：${p.segmentHintZh}
提示词必须显式写出「推荐转换时长 ${p.recommendSec}s」与对应气质（${p.moodZh}）；动作时轴按此密度切分，勿退回一句笼统动作。
气质指引：
· 快速变化/激烈：信息点密、动作切换干脆，运镜可略跟节拍但勿每段换一套强运镜；
· 普通切换/叙事：因果清楚、段与段有承接，适合主歌叙事；
· 慢速切换/抒情：动作与表情变化更绵长，环境动态可更慢、更克制。`;
}

/**
 * MiniMax-H3 中文六段式（对齐用户示例：主体定义/概述/内容保留分析/详细描述/整体声景/非剧情配乐）。
 * MV 专用：可空镜、可有配角，但禁止路人莫名开口唱歌；对口型由客户端开关注入。
 */
export const DIRECTOR_MV_H3_ZH_PROMPT_FORMAT_GUIDE = `【MiniMax-H3 提示词格式·中文六段·硬性】
MV 每镜「最终提示词」必须用中文按下列六段顺序书写（段名用中文，勿用英文键），段与段空行分隔：

主体定义：
用 <主体N> / <图片N> / <图N> 定义本镜参考。角色写清可识别外貌与服装（可写「为图N中出现的…」）；构图参考写清对应 [镜头N]。
对口型开启时追加：<音频1>为已上传的时长X秒同步音轨，人声专属对应<主体N>（S1）。
允许空镜、配角/路人；禁止给未对口型的配角分配（S1）歌手身份。

概述：
以【参考生成】或【参考素材生成+音频复用】开头，写清目标时长、场景、谁出镜、构图/音频关系。
默认不对口型：全员闭嘴；对口型由客户端开关决定是否写入音频复用。

内容保留分析：
逐条 <主体N>/<图N>/<音频1>：完整保留——… 或 部分沿用——…

详细描述：
先写「光色参考第1张风格图；画风固定真人写实」（只写参考图序号与光色锁，禁止写风格图名称或插画画风长文）+ 机位/焦距/景别/运镜。
再按毫秒时轴写 [镜头N]（单镜成片内可多段切换）：
  [镜头1] 00:00.000至00:01.700区间，动作/表情/场景动态…
  [镜头2] 00:01.820处，切到… 00:01.940至00:04.540区间，…
【口型·硬性】
· 默认：全员双唇紧闭；禁止开口；禁止把歌词写成画面字幕。
· 对口型开启：在对应毫秒区间写 <主体N>（S1）口型与<音频1>同步，台词：<d>[中文] …</d>；倾听者双唇紧闭。
· <d> 仅用于驱动口型，画面仍禁止叠字字幕。

整体声景：
环境底噪与物理动作音；有 <音频1> 时写清复用关系。

非剧情配乐：
写「无」（原曲/对口型音轨不进此段）。

禁止把六段压成「画风：…」散文；详细描述必须含 00:00.000 毫秒时轴。`;

/** 示例表行（嵌入 JSON 示例） */
export const DIRECTOR_CINEMATIC_PLOT_EXAMPLE_ROWS = [
  '1|前奏|无人声|有人|繁华街道|路人|高机俯瞰|24mm空间感|路人四散奔逃、车流堵塞，远处烟尘滚起；全员闭嘴禁止开口|—|紧张',
  '2|前奏|无人声|有人|石庭院|男主|背影远距窥视|85mm压缩|手部：手缓缓伸出，像要触碰旧物，最终在空中停滞、收回|—|沉静引入',
  '3|主歌|有人声|有人|窗边书房|男主|过肩窥视|35mm纪实|手部：手指无意识地摩挲衣角，传达不安或眷恋|正面朝向镜头，嘴巴清晰可见跟唱口型|思念',
  '4|副歌|有人声|有人|天台平台|男主|低机位仰拍|85mm人像压|脸部：副歌部分，表情完全放开，无视镜头，仿佛独自倾诉|正面朝向镜头对口型，口部可见|爆发',
  '5|间奏|无人声|空镜|篱笆旁|—|荷兰斜角|14mm畸变|当代乡野黄昏，木质篱笆旁干草小径，倒伏的干草捆靠篱笆，木纹与干草纤维质感，逆光尘粒漂浮，无人物无人脸无肢体无人影|—|过渡',
  '6|尾奏|无人声|有人|石庭院|男主|远距侧窥|135mm偷窥感|脸部：最后一个音符结束后，一个短暂的、似笑非笑的复杂表情|—|余韵',
].join('\\n');

/** 近景特写开：有人行示例须为特写级（禁止半身/全身） */
export const DIRECTOR_CINEMATIC_PLOT_EXAMPLE_ROWS_CLOSE_UP = [
  '1|前奏|无人声|有人|繁华街道|路人|高机俯瞰|24mm空间感|路人四散奔逃、车流堵塞，远处烟尘滚起；全员闭嘴禁止开口|—|紧张',
  '2|前奏|无人声|有人|石庭院|男主|贴脸极近|85mm人像压|眼部：眼神从直视镜头缓缓移向侧下方，再轻轻闭上|—|沉静引入',
  '3|主歌|有人声|有人|窗边书房|男主|过肩窥视|85mm人像压|手部：手指随节奏轻叩衣角，关节微动|正面朝向镜头，嘴巴清晰可见跟唱口型|思念',
  '4|副歌|有人声|有人|天台平台|男主|微俯压迫|70mm浅景深|脸部：副歌部分，表情完全放开，无视镜头，仿佛独自倾诉|正面朝向镜头对口型，口部可见|爆发',
  '5|间奏|无人声|空镜|篱笆旁|—|荷兰斜角|14mm畸变|当代乡野黄昏，木质篱笆旁干草小径，倒伏的干草捆靠篱笆，木纹与干草纤维质感，逆光尘粒漂浮，无人物无人脸无肢体无人影|—|过渡',
  '6|尾奏|无人声|有人|石庭院|男主|贴脸极近|85mm人像压|脸部：最后一个音符结束后，一个短暂的、似笑非笑的复杂表情|—|余韵',
].join('\\n');

/**
 * 近景特写开关·开：有人镜硬规则（写入剧本/拆镜生成指令）。
 * 空镜不受本条约束。
 */
export const DIRECTOR_MV_CLOSE_UP_FRAMING_ON_GUIDE = `【近景特写模式·硬性·已开启】
适用范围：出场含具名主角（男主/女主等）的有人镜。
有人·主角镜：景别只能写「特写」或「大特写」（脸贴镜头、五官清晰占画面主体）；禁止半身、禁止全身、禁止中景/中全景/全景/远景等任何「人小、环境大」或半身入画的景别。
运镜禁止：缓慢拉远（特写→全身）、缓慢推进（全身→面部特写）、全身环绕拉开等会离开脸部特写的运镜；运镜须保持脸部始终贴近镜头。
机位/焦距：优先贴脸极近、微俯压迫、过肩窥视、低机位仰拍；焦距偏 50–85mm 人像压缩/浅景深隔离。
动作句库：优先手部/眼部/脸部近距类，按时轴分段写清；禁止全身舞蹈拉远、禁止写「头脚入画」「腰部以上」等半身/全身描述。
【路人例外·硬性】出场仅为「路人/群众/人群」（无具名主角）时：不受近景特写约束，可用高机俯瞰/全景/远景表现群体奔逃或过场；禁止为了迁就特写模式而把路人戏改成空镜+无人物。
空镜（画面类型=空镜/无人物）：不受本条约束，仍按场景公式写环境。`;

/** 近景特写开关·关 */
export const DIRECTOR_MV_CLOSE_UP_FRAMING_OFF_GUIDE = `【近景特写模式·已关闭】
有人镜允许各种景别与运镜（全身、半身、近景、特写、推拉环绕等），按叙事需要自由调度。
空镜仍按场景公式。`;

/** 按开关选出写入 LLM 的近景规则块 */
export function resolveDirectorMvCloseUpFramingGuide(on: boolean): string {
  return on ? DIRECTOR_MV_CLOSE_UP_FRAMING_ON_GUIDE : DIRECTOR_MV_CLOSE_UP_FRAMING_OFF_GUIDE;
}

/** 按开关选出剧情表示例行 */
export function resolveDirectorMvPlotExampleRows(closeUpFramingOn: boolean): string {
  return closeUpFramingOn
    ? DIRECTOR_CINEMATIC_PLOT_EXAMPLE_ROWS_CLOSE_UP
    : DIRECTOR_CINEMATIC_PLOT_EXAMPLE_ROWS;
}

/** 手法总盘点（写入生图/生视频提示词说明，供模型理解标签） */
export const DIRECTOR_CINEMATIC_TECHNIQUE_INVENTORY = `【拍摄手法盘点·须写入画面】
机位/角度：平视叙事、微俯压迫、微仰英雄、低机位仰拍、高机俯瞰、天花板鸟瞰、航拍俯冲、虫视角、荷兰斜角、过肩窥视、过肩对切、侧面轮廓、斜侧三分、背影远距窥视、窗框窥视、门缝窥视、镜像对位、贴脸极近、贴地跟拍、俯视审判、侧逆剪影。
焦段/光学：14mm畸变沉浸、24mm空间感、28mm街拍、35mm纪实、50mm人文、70mm浅景深、85mm人像压缩、105–135mm偷窥隔离、鱼眼夸张、微距局部、变形宽银幕感(anamorphic)、背景虚化隔离、前景遮挡层次。
景别：大远景建置、远景、全景、全身景、中全景、中景、中近景、近景、特写、大特写、空镜环境。
运镜：固定三脚架、缓推（全身至面部情感递进）、缓拉（特写至全身落幕感）、横移、跟拍、极慢环绕/180°弧形、升镜（随情绪升华）、降镜、手持呼吸感微动、焦点转换（前景虚→眼睛清晰）、斯坦尼康跟移、肩扛晃动、变焦急推、希区柯克推拉(dolly zoom)、一镜到底感、轨道滑移。
动作提示（有人镜·成片时轴）：按本镜时长切 0.0–Xs 连续段，每段写「动作｜表情｜场景动态」；句库可跨段组合手/眼/脸，禁止整镜一句敷衍。空镜写环境时轴或只用场景公式。
构图：三分法、中心对称、引导线、框中框、前景遮挡、负空间、剪影轮廓、浅景深主体分离、深焦前后清晰。`;

type ExpandRule = { re: RegExp; zh: string; en: string };

const ANGLE_EXPAND: ExpandRule[] = [
  {
    re: /高机|鸟瞰|天花板|航拍|overhead|bird/i,
    zh: '高机位俯瞰，地面几何铺开，人物被空间压小，电影建置感',
    en: 'high-angle overhead establishing, geometric ground plane, subject diminished by space',
  },
  {
    re: /低机|仰拍|仰视|虫视|贴地仰|hero|low[\s-]?angle/i,
    zh: '低机位仰拍，主体被抬高呈英雄感或压迫感，天空/天花占画面上沿',
    en: 'low-angle hero shot looking up, subject monumental against sky/ceiling',
  },
  {
    re: /荷兰|斜角|倾斜|失衡|dutch/i,
    zh: '荷兰斜角构图，地平线倾斜，心理失衡与不安',
    en: 'Dutch angle tilted horizon, psychological unease',
  },
  {
    re: /过肩|ot[sｓ]|窥视/i,
    zh: '过肩窥视机位，前景肩背虚化，视线落在对面主体',
    en: 'over-the-shoulder peek framing, soft foreground shoulder, gaze on subject',
  },
  {
    re: /背影|远距.*窥|远距侧/i,
    zh: '远距离背影窥视，主体孤寂抽离，偷窥式旁观',
    en: 'distant back-view voyeur framing, lonely isolation',
  },
  {
    re: /窗框|门缝|框中框|frame/i,
    zh: '框中框构图，窗框/门洞切出画面，窥视与隔离',
    en: 'frame-within-frame through window/doorway, voyeur isolation',
  },
  {
    re: /贴脸|极近|大特写感/i,
    zh: '贴脸极近机位，五官占满画面，情绪放大',
    en: 'extreme close facial framing, features fill the frame',
  },
  {
    re: /贴地|地面跟/i,
    zh: '贴地低机跟拍，地面纹理清晰，动态紧迫',
    en: 'ground-level tracking, textured floor, urgent motion',
  },
  {
    re: /微俯|压迫|审判/i,
    zh: '微俯机位，略压主体，带审视/压迫气质',
    en: 'slight high angle looking down, judgmental pressure',
  },
  {
    re: /微仰/i,
    zh: '微仰机位，略抬主体，威严或憧憬',
    en: 'slight low angle looking up, dignity or yearning',
  },
  {
    re: /侧面|侧拍|侧窥|轮廓/i,
    zh: '侧面轮廓机位，侧光勾勒鼻梁与肩线',
    en: 'profile side angle, rim light on nose and shoulder line',
  },
  {
    re: /斜侧|三分/i,
    zh: '斜侧三分构图，主体偏置，画面有呼吸空间',
    en: 'oblique three-quarter framing, subject off-center with breathing room',
  },
  {
    re: /镜像|对位|对切/i,
    zh: '镜像/对位构图，对称或对切关系明确',
    en: 'mirrored or opposing-shot composition, clear dual relationship',
  },
  {
    re: /剪影/i,
    zh: '侧逆光剪影，轮廓清晰、面部欠曝',
    en: 'backlit silhouette, crisp outline, underexposed face',
  },
  {
    re: /平视|正面|eye[\s-]?level/i,
    zh: '平视电影叙事机位，自然透视，镜头与视线同高',
    en: 'eye-level cinematic narrative camera, natural perspective',
  },
];

const FOCAL_EXPAND: ExpandRule[] = [
  {
    re: /14\s*mm|鱼眼|畸变|超广/i,
    zh: '约14mm超广角畸变，空间夸张包裹主体，沉浸贴近',
    en: 'approx 14mm ultra-wide distortion, immersive wraparound space',
  },
  {
    re: /24\s*mm|空间感/i,
    zh: '约24mm广角空间感，前景深远、环境信息丰富',
    en: 'approx 24mm wide spatial depth, rich environment',
  },
  {
    re: /28\s*mm|街拍/i,
    zh: '约28mm街拍广角，纪实距离感',
    en: 'approx 28mm street-photography wide, documentary distance',
  },
  {
    re: /35\s*mm|纪实/i,
    zh: '约35mm纪实焦段，人文叙事常用，轻微环境纳入',
    en: 'approx 35mm documentary lens, humanistic narrative',
  },
  {
    re: /50\s*mm|人文|标准/i,
    zh: '约50mm人文标准焦段，透视自然接近人眼',
    en: 'approx 50mm normal lens, natural human-eye perspective',
  },
  {
    re: /70\s*mm|浅景深/i,
    zh: '约70mm浅景深，主体清晰、背景柔化隔离',
    en: 'approx 70mm shallow depth of field, subject isolation',
  },
  {
    re: /85\s*mm|人像压|压缩/i,
    zh: '约85mm人像长焦压缩，背景虚化，五官比例讨喜',
    en: 'approx 85mm portrait compression, creamy bokeh',
  },
  {
    re: /105\s*mm|135\s*mm|偷窥|长焦|tele/i,
    zh: '约105–135mm长焦偷窥压缩，远距抽离、背景堆叠',
    en: 'approx 105–135mm telephoto voyeur compression, stacked background',
  },
  {
    re: /微距|macro/i,
    zh: '微距焦段，局部材质与细节放大',
    en: 'macro optics, magnified local texture detail',
  },
  {
    re: /变形|anamorphic|宽银幕/i,
    zh: '变形宽银幕光学感，椭圆形光斑与横向拉伸气质',
    en: 'anamorphic widescreen look, oval bokeh, horizontal stretch feel',
  },
  {
    re: /广角|wide/i,
    zh: '广角镜头，空间开阔，轻微透视拉伸',
    en: 'wide-angle lens, open space, mild perspective stretch',
  },
  {
    re: /中焦/i,
    zh: '中焦叙事焦段（约50mm气质），主体与环境平衡',
    en: 'mid focal narrative (approx 50mm feel), subject-environment balance',
  },
];

const MOVE_EXPAND: ExpandRule[] = [
  {
    re: /缓推|推进|dolly\s*in|push\s*in/i,
    zh: '镜头缓慢推进，从全身平稳推至面部特写，强调情感递进',
    en: 'slow push-in from full body to face close-up, emotional escalation',
  },
  {
    re: /缓拉|拉远|dolly\s*out|pull\s*out/i,
    zh: '镜头缓慢拉远，从特写退至全身，营造疏离或落幕感',
    en: 'slow pull-out from close-up to full body, distance or curtain-fall feel',
  },
  { re: /平移|横移|truck|pan/i, zh: '镜头水平平移扫过场景', en: 'lateral tracking / pan across scene' },
  { re: /跟拍|跟随|tracking|follow/i, zh: '跟随主体运动跟拍', en: 'tracking shot following subject motion' },
  {
    re: /环绕|orbit|circle|弧形/i,
    zh: '极慢环绕，围绕人物做约180度缓慢弧形移动，沉浸氛围',
    en: 'very slow ~180° arc orbit around subject, immersive mood',
  },
  {
    re: /升镜|升起|升降|crane\s*up|boom\s*up/i,
    zh: '升降运镜：随音乐情绪缓慢升起，带来升华感',
    en: 'crane/boom rising with musical emotion, uplifting feel',
  },
  { re: /降镜|落下|crane\s*down|boom\s*down/i, zh: '镜头下降贴近', en: 'crane/boom down closer' },
  {
    re: /手持|呼吸|handheld/i,
    zh: '呼吸感微动：模拟手持轻微晃动，增强真实与亲密感',
    en: 'handheld breathing micro-shake, intimate realism',
  },
  {
    re: /焦点|rack\s*focus|focus\s*pull|虚化.*眼|眼.*清晰/i,
    zh: '焦点转换：焦点从前景物件虚化，平滑转移到清晰的眼睛，引导视线',
    en: 'rack focus from soft foreground object to sharp eyes, guiding gaze',
  },
  { re: /斯坦尼|steadicam|稳定器/i, zh: '斯坦尼康稳定跟移', en: 'Steadicam smooth follow' },
  { re: /急推|变焦推|zoom\s*in/i, zh: '变焦急推强调情绪', en: 'snap zoom-in for emphasis' },
  { re: /希区柯克|dolly\s*zoom|眩晕/i, zh: '希区柯克推拉眩晕效果', en: 'Hitchcock dolly zoom vertigo effect' },
  { re: /固定|locked|tripod/i, zh: '三脚架固定机位', en: 'locked-off tripod camera' },
];

const SIZE_EXPAND: ExpandRule[] = [
  { re: /大远景|extreme\s*wide/i, zh: '大远景建置，环境压倒人物', en: 'extreme wide establishing' },
  { re: /远景|wide\s*shot/i, zh: '远景，人物在环境中完整可读', en: 'wide shot, full figure in environment' },
  { re: /全景|全身/i, zh: '全身全景，头脚入画', en: 'full shot head-to-toe' },
  { re: /中全景|cowboy/i, zh: '中全景，膝上入画', en: 'medium-full / cowboy framing' },
  { re: /中近景|medium\s*close/i, zh: '中近景，胸部以上', en: 'medium close-up, chest-up' },
  { re: /中景|medium/i, zh: '中景，腰部以上叙事', en: 'medium shot, waist-up narrative' },
  { re: /大特写|extreme\s*close/i, zh: '大特写，局部器官/物件占满', en: 'extreme close-up detail fill' },
  { re: /特写|close[\s-]?up/i, zh: '特写，面部或关键物件', en: 'close-up of face or key object' },
];

function expandByRules(raw: string, rules: ExpandRule[], fallbackZh: (t: string) => string): string {
  const t = String(raw || '').trim();
  if (!t || t === '—') return '';
  for (const rule of rules) {
    if (rule.re.test(t)) return `${rule.zh}（${rule.en}）`;
  }
  return fallbackZh(t);
}

export function expandCinematicAngle(angle: string): string {
  return expandByRules(angle, ANGLE_EXPAND, (t) => `机位：${t}，电影摄影构图明确`);
}

export function expandCinematicFocal(focal: string): string {
  return expandByRules(focal, FOCAL_EXPAND, (t) => `焦段气质：${t}，光学透视清晰`);
}

export function expandCinematicCameraMove(cam: string): string {
  return expandByRules(cam, MOVE_EXPAND, (t) => `运镜：${t}`);
}

export function expandCinematicShotSize(size: string): string {
  return expandByRules(size, SIZE_EXPAND, (t) => `景别：${t}`);
}

/**
 * 把表内短标签展开为可直接拼进生图/生视频的「镜头语言」段落。
 * 始终带上手法盘点提醒，避免模型忽略机位光学。
 */
export function composeDirectorCinematicLensPromptBlock(opts: {
  angle?: string;
  focal?: string;
  size?: string;
  cameraMove?: string;
  /** image=分镜静帧；video=成片运动 */
  mode?: 'image' | 'video';
}): string {
  const mode = opts.mode || 'image';
  const bits = [
    expandCinematicAngle(String(opts.angle || '')),
    expandCinematicFocal(String(opts.focal || '')),
    expandCinematicShotSize(String(opts.size || '')),
    expandCinematicCameraMove(String(opts.cameraMove || '')),
  ].filter(Boolean);

  if (!bits.length) {
    return mode === 'video'
      ? '镜头语言：电影级机位与焦段明确，运镜克制可还原；禁止默认业余平视中焦空镜。'
      : '镜头语言：电影级机位与焦段明确，静帧构图完整；禁止默认业余平视中焦空镜。';
  }

  const head =
    mode === 'video'
      ? '镜头语言（须体现在成片运镜与透视）：'
      : '镜头语言（须体现在分镜静帧构图与光学透视）：';

  return `${head}${bits.join('；')}。拍摄手法参考：机位/焦段/景别/运镜须可辨认，禁止忽略镜头语言只画内容。`;
}

const ANGLE_FALLBACKS = [
  '高机俯瞰',
  '过肩窥视',
  '低机位仰拍',
  '荷兰斜角',
  '背影远距窥视',
  '斜侧三分',
  '窗框窥视',
  '贴地仰望',
] as const;

const FOCAL_FALLBACKS = [
  '24mm空间感',
  '35mm纪实',
  '50mm人文',
  '85mm人像压',
  '135mm偷窥感',
  '28mm街拍',
  '70mm浅景深',
] as const;

export function pickCinematicAngleFallback(opts: {
  section?: string;
  emptyShot?: boolean;
  index?: number;
}): string {
  const section = String(opts.section || '');
  const i = Math.max(0, Number(opts.index) || 0);
  if (opts.emptyShot || /前奏|intro/i.test(section)) {
    return i % 2 === 0 ? '高机俯瞰' : '窗框窥视';
  }
  if (/副歌|高潮|chorus/i.test(section)) {
    return i % 2 === 0 ? '低机位仰拍' : '贴脸极近';
  }
  if (/间奏|桥|bridge/i.test(section)) {
    return i % 2 === 0 ? '荷兰斜角' : '虫视角';
  }
  if (/尾奏|outro|结尾/i.test(section)) {
    return '远距侧窥';
  }
  return ANGLE_FALLBACKS[i % ANGLE_FALLBACKS.length];
}

export function pickCinematicFocalFallback(opts: {
  section?: string;
  emptyShot?: boolean;
  index?: number;
}): string {
  const section = String(opts.section || '');
  const i = Math.max(0, Number(opts.index) || 0);
  if (opts.emptyShot || /前奏|intro/i.test(section)) {
    return i % 2 === 0 ? '24mm空间感' : '28mm街拍';
  }
  if (/副歌|高潮|chorus/i.test(section)) {
    return i % 2 === 0 ? '85mm人像压' : '70mm浅景深';
  }
  if (/间奏|桥|bridge/i.test(section)) {
    return i % 2 === 0 ? '14mm畸变' : '135mm偷窥感';
  }
  if (/尾奏|outro|结尾/i.test(section)) {
    return '135mm偷窥感';
  }
  return FOCAL_FALLBACKS[i % FOCAL_FALLBACKS.length];
}
