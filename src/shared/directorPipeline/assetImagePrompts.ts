import {
  composeDramaCreatureDesignPrompt,
  dramaCreaturePromptLooksHuman,
} from '../directorDomain/extractCastFromScript.js';
import {
  dramaScenePeriodHardLockLine,
  inferDramaSceneSettingPeriod,
  sanitizeDirectorStyleHintForScene,
} from '../directorDomain/sceneSettingPeriod.js';

/** 场景资产内置后缀：单张空场景参考图（写入卡片展示文案） */
export const DIRECTOR_SCENE_BUILTIN_SUFFIX =
  '无人物，无人脸，无肢体，无人影，空场景，单张场景定妆图，画面内无任何文字';

/**
 * 单张场景通用强约束（中文，生成时始终追加）。
 * 禁止九宫格/拼贴；强调空场景、无字幕。
 */
export const DIRECTOR_SCENE_UNIVERSAL_PROMPT =
  '【单张场景约束】输出一张完整的单幅空场景参考图（非九宫格、非四宫格、非多视角拼贴），同一地点、同一画风、同一光照与色调；横构图电影定妆/建立镜头；无人物、无人脸、无肢体、无人影，仅环境与静物，空场景；画面内零文字、零字母、零数字标注、无水印、无 logo、无字幕；禁止 3×3/2×2 分格拼贴、禁止等距柱状 360 全景、禁止左右接缝连续构图、禁止把多视角糊成不规则拼贴。';

/**
 * 场景生图隐藏链接后缀（与通用约束互补，可直接拼进最终 prompt）。
 * @deprecated 名称保留兼容；语义已改为单张场景。
 */
export const DIRECTOR_SCENE_NINE_GRID_LINKED_PROMPT = DIRECTOR_SCENE_UNIVERSAL_PROMPT;

/**
 * 360 等距柱状全景英文结构（不含 # Positive Prompt:）。
 * 供「场景转换360图」等能力使用；导演场景资产生图请用单张场景定妆，勿再拼此模板。
 */
export const DIRECTOR_360_EQUIRECTANGULAR_PROMPT_TEMPLATE = `(360-degree equirectangular panorama:1.3) of a {scene_type} environment,
(designed for VR viewing with perfect spherical continuity:1.2).

{scene_description}

The environment is a seamless 360-degree wrap-around space.
The areas outside the original view are logically completed: [AI补充内容].
Consistent architectural and landscape logic throughout.
{lighting_desc} lighting creating {color_tone} tones.
Textures and perspectives flow continuously, (left and right edges match flawlessly:1.3),
(horizon line is perfectly level and continuous:1.2),
no visible seams, no stitch lines, spherical projection.

Photorealistic, ultra-detailed, cinematic composition, 8k resolution, {emotional_keywords}.`;

/** @deprecated 与 DIRECTOR_360_EQUIRECTANGULAR_PROMPT_TEMPLATE 相同 */
export const DIRECTOR_SCENE_360_PROMPT_TEMPLATE = DIRECTOR_360_EQUIRECTANGULAR_PROMPT_TEMPLATE;

/**
 * 角色生图必须链接的默认后缀（2×2 四宫格设定板，白色背景）。
 * 默认真人写实；四格等大、无分界线。追加在中文属性串之后，不写入卡片展示文案。
 */
export const DIRECTOR_CHARACTER_LINKED_PROMPT =
  '【四宫格真人写实】输出一张完整的 2×2 四宫格人物参考图（共四格）：左上正面脸部特写、右上正面全身站立、左下侧面全身站立、右下背面全身站立；同一人物、同一服装、同一发型；必须是真人写实摄影质感（photorealistic real human），禁止卡通、插画、二次元、二次元上色、概念设定板、角色设计稿画风；统一纯白背景，干净简洁；四个宫格必须严格同等大小、等宽等高、整齐对齐成规整四宫格；宫格与宫格之间禁止出现任何间隙、空隙、黑边、白边、分隔线、分割线、沟槽或留白边框，四格必须紧密贴合拼成一张完整画面，不得露出底层背景色；画面内无任何文字、字幕、水印、logo、标题或数字标注';

/** 角色四宫格英文强约束（生成时链接） */
export const DIRECTOR_CHARACTER_FOUR_GRID_ENGLISH =
  'Mandatory: one single image that is a clean 2x2 character reference sheet of the SAME real human. Photorealistic photography only — NOT illustration, NOT anime, NOT cartoon, NOT concept-art style. All four cells MUST be exactly equal size (same width and height), perfectly aligned, tightly packed with ZERO gaps, ZERO gutters, ZERO divider lines, ZERO black/white borders or empty strips between cells — tiles must touch edge-to-edge with no background showing through. Layout: top-left face close-up, top-right full-body front, bottom-left full-body side, bottom-right full-body back. Pure white background. Absolutely NO text, NO captions, NO labels, NO watermarks on the image.';

/** @deprecated 请用 DIRECTOR_CHARACTER_LINKED_PROMPT */
export const DIRECTOR_CHARACTER_LINKED_PROMPT_TEMPLATE = DIRECTOR_CHARACTER_LINKED_PROMPT;

/** 单张场景英文约束（生成时链接） */
export const DIRECTOR_SCENE_SINGLE_ENGLISH =
  'Mandatory: one single full-frame empty location plate (NOT a 3x3 nine-grid, NOT a 2x2 sheet, NOT a collage). Same place, consistent lighting, materials, and architecture. Cinematic establishing / master-shot framing. Absolutely NO text, NO captions, NO labels, NO watermarks, NO logos, NO Chinese or English words, NO numbers on the image. No people, no faces, no limbs, no human silhouettes — environment and still life only, empty set. Not a panorama, not equirectangular 360, not a multi-panel storyboard sheet.';

/** @deprecated 已改为单张场景；别名保留兼容旧引用 */
export const DIRECTOR_SCENE_NINE_GRID_ENGLISH = DIRECTOR_SCENE_SINGLE_ENGLISH;

/** 去掉旧版九宫格后缀，避免历史卡片继续诱导分格生图 */
function stripLegacySceneNineGridPhrases(prompt: string): string {
  return String(prompt || '')
    .replace(/【通用九宫格约束】[^【]*/g, '')
    .replace(/九宫格图/g, '')
    .replace(/九宫格/g, '')
    .replace(/九个宫格同等大小/g, '')
    .replace(/宫格之间无间隙/g, '')
    .replace(/不同的视角/g, '')
    .replace(/3\s*[×xX]\s*3/g, '')
    .replace(/[，,]{2,}/g, '，')
    .replace(/^[，,\s]+|[，,\s]+$/g, '')
    .trim();
}

export function ensureDirectorSceneBuiltinPrompt(prompt: string): string {
  let p = stripLegacySceneNineGridPhrases(String(prompt || '').trim());
  if (!p) return DIRECTOR_SCENE_BUILTIN_SUFFIX;
  const hasBuiltin =
    p.includes('无人物') &&
    p.includes('空场景') &&
    (p.includes('单张场景') || p.includes('场景定妆'));
  let next = hasBuiltin ? p : `${p.replace(/[，,]\s*$/, '')}，${DIRECTOR_SCENE_BUILTIN_SUFFIX}`;
  if (!/无人脸/.test(next)) {
    next = `${next.replace(/[，,]\s*$/, '')}，无人脸`;
  }
  if (!/无肢体/.test(next)) {
    next = `${next.replace(/[，,]\s*$/, '')}，无肢体`;
  }
  if (!/无人影|无人形/.test(next)) {
    next = `${next.replace(/[，,]\s*$/, '')}，无人影`;
  }
  if (!/无文字|无任何文字|不要出现文字/.test(next)) {
    next = `${next.replace(/[，,]\s*$/, '')}，画面内无任何文字`;
  }
  return next;
}

function fillSceneTemplate(
  template: string,
  vars: Record<string, string>,
): string {
  return template.replace(/\{([a-zA-Z0-9_]+)\}/g, (_, key: string) => {
    const v = String(vars[key] ?? '').trim();
    return v || `{${key}}`;
  });
}

/** 从风格/场景描述里抽一点光影与情绪关键词（弱启发式，缺省可回退） */
function deriveSceneVisualHints(styleHint: string, scenePrompt: string): {
  lighting_desc: string;
  color_tone: string;
  emotional_keywords: string;
} {
  const blob = `${styleHint} ${scenePrompt}`;
  let lighting_desc = 'cinematic natural';
  if (/夜|neon|霓虹|月光|night/i.test(blob)) lighting_desc = 'moody nighttime';
  else if (/阳光|日光|暖|sun|warm/i.test(blob)) lighting_desc = 'warm sunlight';
  else if (/体积光|逆光|rim|backlit/i.test(blob)) lighting_desc = 'dramatic rim';
  else if (/电影|cinematic|胶片/i.test(blob)) lighting_desc = 'cinematic volumetric';

  let color_tone = 'balanced cinematic';
  if (/冷|青|蓝|teal|cold/i.test(blob)) color_tone = 'cool teal';
  else if (/暖|橙|金色|warm|amber/i.test(blob)) color_tone = 'warm amber';
  else if (/赛博|neon|霓虹/i.test(blob)) color_tone = 'neon contrast';
  else if (/水墨|国风|雅致/i.test(blob)) color_tone = 'muted elegant';

  const emotional_keywords =
    String(styleHint || '').trim() ||
    'immersive atmosphere, coherent worldbuilding, empty set, no people';

  return { lighting_desc, color_tone, emotional_keywords };
}

/** 构建 360 全景英文（仅供转换 360 等入口，不用于导演场景资产生图） */
export function buildDirector360EquirectangularPrompt(opts: {
  sceneType: string;
  description: string;
  styleHint?: string;
}): string {
  const hints = deriveSceneVisualHints(opts.styleHint || '', opts.description);
  return fillSceneTemplate(DIRECTOR_360_EQUIRECTANGULAR_PROMPT_TEMPLATE, {
    scene_type: opts.sceneType,
    scene_description: opts.description,
    lighting_desc: hints.lighting_desc,
    color_tone: hints.color_tone,
    emotional_keywords: hints.emotional_keywords,
  });
}

/**
 * 场景生图最终提示词：风格对齐 + 场景描述 + 单张空场景强约束（中英）。
 * 默认不再拼九宫格；也不拼 360 全景模板。
 * 按地点时代加硬锁，避免全片古风题材/风格图污染现代场景。
 */
export function buildDirectorSceneImagePrompt(opts: {
  name?: string;
  prompt?: string;
  styleHint?: string;
  location?: string;
  kind?: string;
  spatial_structure?: string;
  architecture?: string;
  materials?: string;
  lighting?: string;
  time_default?: string;
  fixed_elements?: string[];
}): string {
  const location = String(opts.location || opts.name || '').trim();
  const kindRaw = String(opts.kind || '').trim();
  const kindZh = /ext|外/i.test(kindRaw)
    ? '室外'
    : /int|内/i.test(kindRaw)
      ? '室内'
      : kindRaw;
  const fixed = (Array.isArray(opts.fixed_elements) ? opts.fixed_elements : [])
    .map((x) => String(x || '').trim())
    .filter(Boolean)
    .slice(0, 10);
  const hardFacts = [
    location ? `地点：${location}` : '',
    kindZh ? `内外景：${kindZh}` : '',
    opts.time_default ? `时段：${String(opts.time_default).trim()}` : '',
    opts.spatial_structure ? `空间：${String(opts.spatial_structure).trim()}` : '',
    opts.architecture ? `建筑：${String(opts.architecture).trim()}` : '',
    opts.materials ? `材质：${String(opts.materials).trim()}` : '',
    opts.lighting ? `光影：${String(opts.lighting).trim()}` : '',
    fixed.length ? `陈设硬事实：${fixed.join('、')}` : '',
  ]
    .filter(Boolean)
    .join('；');

  const sceneDescription = ensureDirectorSceneBuiltinPrompt(
    String(opts.prompt || opts.name || '').trim(),
  );
  const period = inferDramaSceneSettingPeriod(
    location,
    kindZh,
    fixed.join('、'),
    sceneDescription,
    opts.spatial_structure,
    opts.architecture,
  );
  const styleHint = sanitizeDirectorStyleHintForScene(opts.styleHint, period);
  const chunks: string[] = [];

  // 地点硬事实必须压在版式约束之前，避免被模板冲成空壳电影感
  if (hardFacts) {
    chunks.push(
      `【地点硬事实·必须入画】${hardFacts}。必须按剧本地点与陈设还原，禁止换成无关的通用电影棚/空旷大厅。`,
    );
  }
  const periodLock = dramaScenePeriodHardLockLine(period);
  if (periodLock) chunks.push(periodLock);
  chunks.push(
    '【场景公式】年代/时代气质 + 地点 + 物品陈设（名称+位置+状态） + 材质 + 光线 + 无人物/无人脸/无肢体/无人影；仅环境与静物，禁止写手眼脸运镜表演。',
  );
  if (styleHint) {
    chunks.push(
      period === 'modern'
        ? `光色与画质对齐：${styleHint}；只借鉴明暗/对比/色温，禁止借鉴古建、山水、仙侠地貌或古风装饰；画风固定真人写实摄影（photorealistic），禁止插画/卡通/二次元/三维CG；风格不得覆盖或删改上方地点硬事实`
        : `光色对齐：${styleHint}；画风固定真人写实摄影（photorealistic），禁止插画/卡通/二次元/三维CG；风格不得覆盖或删改上方地点硬事实`,
    );
  }
  chunks.push(sceneDescription);
  chunks.push(DIRECTOR_SCENE_UNIVERSAL_PROMPT);
  chunks.push(DIRECTOR_SCENE_SINGLE_ENGLISH);
  chunks.push(
    '再次强调：必须是单张完整场景定妆图，禁止九宫格/多宫格拼贴；画面上禁止出现任何文字、字母、数字或机位标签；内容必须仍是同一剧本地点与同一套陈设。',
  );
  return chunks.join('\n\n');
}

/** 资产生图固定比例：角色/生物竖版、场景横版、道具方图 */
export function directorAssetAspectRatio(kind: 'character' | 'scene' | 'prop' | 'creature' | string): string {
  if (kind === 'character' || kind === 'creature') return '9:16';
  if (kind === 'scene') return '16:9';
  return '1:1';
}

/**
 * 去掉资产抽取时写入的尾部风格标签，避免与顶部当前风格标签冲突。
 */
function stripDirectorAssetEmbeddedStyle(prompt: string): string {
  let p = String(prompt || '').trim();
  p = p.replace(
    /[，,]\s*(画风[:：][^，,]+|电影剧照风格|日系动漫风格|中国国风视觉[^，,]*|国风|高质量三维CG渲染[^，,]*|三维CG|真人写实摄影风格|真人写实|水彩插画风格|水彩插画|赛博朋克风格|赛博朋克)\s*$/u,
    '',
  );
  return p.trim();
}

/**
 * 角色生图用风格摘要：只保留光色/氛围，去掉风格预设里的墨镜、吉他、麦克风等道具穿搭，
 * 避免未写进人物设定却被风格文案「带上」墨镜。
 */
export function sanitizeDirectorStyleHintForCharacter(styleHint: string | undefined | null): string {
  let t = String(styleHint || '').trim();
  if (!t) return '';
  t = t
    .replace(/墨镜(?:休闲穿搭)?/g, '')
    .replace(/太阳镜/g, '')
    .replace(/\bsunglasses?\b/gi, '')
    .replace(/原声吉他|木吉他|电吉他/g, '')
    .replace(/吉他/g, '')
    .replace(/\bguitars?\b/gi, '')
    .replace(/麦克风(?:演唱姿态)?/g, '')
    .replace(/话筒/g, '')
    .replace(/\bmicrophones?\b/gi, '')
    .replace(/萨克斯(?:管)?/g, '')
    .replace(/三角钢琴|钢琴/g, '')
    .replace(/[，,]{2,}/g, '，')
    .replace(/[：:]{2,}/g, '：')
    .replace(/^[,，、\s]+|[,，、\s]+$/g, '')
    .trim();
  return t;
}

/**
 * 角色生图：属性串 → 真人写实四宫格（隐藏后缀）。
 * 风格参考图只锁光色（肤色受光/服装色调），画风始终真人写实，
 * 不得改成插画或概念设定画风，也不得默认加墨镜等道具。
 */
export function buildDirectorCharacterImagePrompt(opts: {
  name?: string;
  prompt?: string;
  styleHint?: string;
  /** male / female / 男 / 女 */
  gender?: string;
  /** creature：生物四视图白底（布局同人物） */
  subject?: 'character' | 'creature';
}): string {
  const isCreature = opts.subject === 'creature';
  const rawUser = String(opts.prompt || opts.name || '').trim();
  const userPart = stripDirectorAssetEmbeddedStyle(
    isCreature
      ? composeDramaCreatureDesignPrompt({
          name: opts.name,
          prompt: dramaCreaturePromptLooksHuman(rawUser) ? '' : rawUser,
        })
      : rawUser,
  );
  const styleHint = sanitizeDirectorStyleHintForCharacter(opts.styleHint);
  const linked = DIRECTOR_CHARACTER_LINKED_PROMPT;
  const alreadySheet =
    /四宫格真人写实|高清4视图展示|2×2\s*四宫格|2x2\s*character\s*reference|生物四视图|creature\s*reference\s*sheet/i.test(
      userPart,
    );
  const userWantsSunglasses = /墨镜|太阳镜|sunglasses/i.test(userPart);
  const userWantsGuitar = /吉他|guitar/i.test(userPart);
  const userWantsMic = /麦克风|话筒|microphone|mic\b/i.test(userPart);
  const gRaw = String(opts.gender || '').trim().toLowerCase();
  const genderZh =
    gRaw === 'male' || gRaw === 'm' || gRaw === '男' || /男主/.test(String(opts.name || ''))
      ? '男'
      : gRaw === 'female' || gRaw === 'f' || gRaw === '女' || /女主/.test(String(opts.name || ''))
        ? '女'
        : '';

  const chunks: string[] = [];
  if (isCreature) {
    chunks.push(
      '生物必须为写实非人类动物（photorealistic non-human animal），禁止卡通、插画与扁平设定画风',
      '【物种锁·硬性】禁止人类、人脸、人体、四肢直立的人物、外卖骑手、服装模特、背包少年；必须是四足/有翅/有鳞的动物本体',
      '【生物四视图·硬性】2×2 四宫格参考图：左上正面全身、右上侧面全身、左下背面全身、右下头部特写；每格同等大小；宫格之间禁止间隙、分界线、黑白边；纯白背景 #FFFFFF；画面无文字',
    );
  } else {
    chunks.push('人物必须为真人写实摄影（photorealistic real human），禁止插画、卡通、二次元与概念设定画风');
  }
  if (!isCreature && genderZh === '男') {
    chunks.push(
      '【性别锁·硬性】本角色必须是成年男性（cis male adult man），男性面部骨骼与体型，禁止生成女性、女装、中性偏女或双性别混杂外貌',
    );
  } else if (!isCreature && genderZh === '女') {
    chunks.push(
      '【性别锁·硬性】本角色必须是成年女性（cis female adult woman），女性面部与体型，禁止生成男性或偏男外貌',
    );
  }
  if (styleHint) {
    chunks.push(
      isCreature
        ? `材质受光与整体色调参考：${styleHint}。保持写实摄影；纯白背景不变。`
        : `风格质感参考：${styleHint}。画风保持真人写实摄影；服装与道具以人物设定描述为准，参考图仅用于相貌（长相与发型）的一致性，不套取其服装、配饰或其他人物特征。`,
    );
  }
  if (userPart && !alreadySheet) chunks.push(userPart);
  else if (userPart && alreadySheet) chunks.push(userPart);
  if (!alreadySheet) {
    if (isCreature) {
      chunks.push(
        'high-resolution 2x2 creature reference sheet, front full-body, side full-body, back full-body, head close-up, equal panels, no gaps, no borders, pure white background',
      );
    } else {
      chunks.push(linked);
      chunks.push(DIRECTOR_CHARACTER_FOUR_GRID_ENGLISH);
    }
  }
  if (!isCreature) {
    if (!userWantsSunglasses) {
      chunks.push(
        '人物设定未要求戴墨镜：禁止佩戴墨镜、太阳镜或严重遮挡五官的深色眼镜，双眼与五官须清晰可见',
      );
    }
    if (!userWantsGuitar) {
      chunks.push('人物设定未要求吉他：禁止手持或背着吉他等抢戏道具');
    }
    if (!userWantsMic) {
      chunks.push('人物设定未要求麦克风：禁止手持麦克风或话筒');
    }
  }
  chunks.push(
    isCreature
      ? '再次强调：必须是非人类动物，禁止画出人；四宫格每格同等大小；宫格之间禁止任何间隙、分界线、黑白边；纯白背景；画面无文字。'
      : '再次强调：必须真人写实；四宫格每格同等大小；宫格之间禁止任何间隙、分界线、黑白边；纯白背景；画面无文字。',
  );
  return chunks.join('，');
}

/**
 * 道具生图必须链接的默认后缀（2×2 四宫格商品棚拍，白色背景）。
 * 追加在中文描述之后，不写入卡片展示文案。
 */
export const DIRECTOR_PROP_LINKED_PROMPT =
  '【道具四宫格】输出一张完整的 2×2 四宫格道具参考图（共四格）：左上正面、右上侧面、左下背面、右下材质/结构特写；同一件道具、同一材质、同一颜色与磨损；商品棚拍写实摄影，禁止卡通、插画、概念设定画风；统一纯白背景 #FFFFFF，干净简洁；四个宫格必须严格同等大小、等宽等高、整齐对齐成规整四宫格；宫格与宫格之间禁止出现任何间隙、空隙、黑边、白边、分隔线、分割线、沟槽或留白边框，四格必须紧密贴合拼成一张完整画面，不得露出底层背景色；画面内无任何文字、字幕、水印、logo、标题或数字标注；无人物、无手持环境、无桌面场景';

export const DIRECTOR_PROP_FOUR_GRID_ENGLISH =
  'Mandatory: one single image that is a clean 2x2 product reference sheet of the SAME prop. Studio product photography on seamless pure white #FFFFFF. Layout: top-left front, top-right side, bottom-left back, bottom-right material/detail close-up. All four cells MUST be exactly equal size, tightly packed with ZERO gaps, ZERO gutters, ZERO divider lines, ZERO black/white borders. Isolated object only — no environment, no room, no table, no floor, no hands, no people. Absolutely NO text, NO captions, NO labels, NO watermarks on the image.';

/** 道具生图：白底 2×2 四视图（商品棚拍；禁止场景/地面/手持环境） */
export function buildDirectorPropImagePrompt(opts: {
  name?: string;
  prompt?: string;
  /** 道具通常忽略题材环境 hint，避免画出酒馆/峡谷等背景 */
  styleHint?: string;
}): string {
  const base = [opts.name, opts.prompt]
    .map((s) => String(s || '').trim())
    .filter(Boolean)
    .join('，');
  const alreadySheet = /道具四宫格|四宫格道具|2×2\s*四宫格|2x2\s*product\s*reference/i.test(base);
  const chunks: string[] = [
    '商品棚拍道具参考图',
    '纯白背景 #FFFFFF',
    'isolated object only, no environment, no room, no table, no floor, no hands',
  ];
  if (base) chunks.push(base);
  if (!alreadySheet) {
    chunks.push(DIRECTOR_PROP_LINKED_PROMPT);
    chunks.push(DIRECTOR_PROP_FOUR_GRID_ENGLISH);
  }
  chunks.push('再次强调：必须纯白背景 #FFFFFF；四宫格每格同等大小；宫格之间禁止间隙、分界线、黑白边；无场景、无人物；画面无文字。');
  return chunks.join('，');
}

/**
 * 系统提示音形象生图：科技 UI / 全息面板定妆，不是人物卡。
 * 必须以用户 image_prompt 为主体，禁止套真人四宫格角色模板。
 */
export const DIRECTOR_SYSTEM_VISUAL_LINKED_PROMPT =
  '【系统形象四宫格】输出一张完整的 2×2 四宫格系统界面/全息面板参考图（共四格）：左上正面、右上侧面斜视、左下背面或关闭态、右下结构/光效特写；同一系统装置、同一材质与光色；科技产品棚拍或科幻全息定妆，禁止真人面孔、人体、四肢、人类模特；禁止卡通二次元人物；统一纯白或简洁深色棚拍背景；四个宫格必须严格同等大小、紧密贴合无间隙；画面内无可读汉字/字母字幕、水印、logo 或数字标注';

export const DIRECTOR_SYSTEM_VISUAL_FOUR_GRID_ENGLISH =
  'Mandatory: one single 2x2 reference sheet of the SAME non-human system UI / holographic panel device. Product or sci-fi hologram look. No human face, no human body, no limbs, no people. Equal tiles, zero gaps, zero borders. Pure white or clean dark studio backdrop. Absolutely NO readable text, captions, labels, watermarks, or logos on the image.';

export function buildDirectorSystemVisualImagePrompt(opts: {
  name?: string;
  prompt?: string;
  styleHint?: string;
}): string {
  const userPart = stripDirectorAssetEmbeddedStyle(String(opts.prompt || '').trim());
  const name = String(opts.name || '').trim();
  const styleHint = sanitizeDirectorStyleHintForCharacter(opts.styleHint);
  const alreadySheet =
    /系统形象四宫格|四宫格系统|2×2\s*四宫格|2x2\s*(?:system|hologram|product)\s*reference/i.test(
      userPart,
    );
  const chunks: string[] = [
    '系统界面/全息面板定妆参考图，非人物角色',
    '禁止真人面孔、人体、四肢、人类模特；禁止把系统画成人形角色',
  ];
  if (styleHint) {
    chunks.push(`材质受光与色调参考：${styleHint}。保持科技界面质感，背景简洁，不画真人。`);
  }
  // 用户提示词优先：放在硬约束之后、模板之前，避免被人物卡模板淹没
  if (userPart) chunks.push(userPart);
  else if (name) chunks.push(name);
  if (!alreadySheet) {
    chunks.push(DIRECTOR_SYSTEM_VISUAL_LINKED_PROMPT);
    chunks.push(DIRECTOR_SYSTEM_VISUAL_FOUR_GRID_ENGLISH);
  }
  chunks.push(
    '再次强调：以用户描述的系统形象为准；禁止人类面孔与人体；四宫格等大无间隙；画面无可读文字。',
  );
  return chunks.join('，');
}
