/** 场景资产内置后缀：九宫格空场景参考图（写入卡片展示文案） */
export const DIRECTOR_SCENE_BUILTIN_SUFFIX =
  '无人物，无人脸，无肢体，无人影，空场景，九宫格图，不同的视角，九个宫格同等大小，宫格之间无间隙，画面内无任何文字';

/**
 * 场景九宫格通用强约束（中文，生成时始终追加）。
 * 强调等大分格、无间隙、禁止字幕/标注、禁止单张长卷。
 */
export const DIRECTOR_SCENE_UNIVERSAL_PROMPT =
  '【通用九宫格约束】输出一张完整的 3×3 九宫格场景参考图（共九格），同一地点、同一画风、同一光照与色调；九个宫格必须严格同等大小、等宽等高、整齐对齐成规整九宫格；宫格与宫格之间禁止出现任何间隙、空隙、黑边、白边、分隔条、沟槽或留白边框，九格必须紧密贴合拼成一张完整画面，不得露出底层背景色；可用极细分割线，但不得形成宽缝或空洞；九格为不同机位与景别（正面、侧面、背面、俯视、仰视、远景、中景、近景、斜角），但不要在画面上写出「俯视」「仰视」「远景」等任何中英文标签、字幕、水印、logo、标题或说明文字；画面内零文字、零字母、零数字标注；无人物、无人脸、无肢体、无人影，仅环境与静物，空场景；禁止单张全景长卷、禁止等距柱状 360 全景、禁止左右接缝连续构图、禁止把九个视角糊成一张不规则拼贴。';

/**
 * 场景生图隐藏链接后缀（与通用约束互补，可直接拼进最终 prompt）。
 */
export const DIRECTOR_SCENE_NINE_GRID_LINKED_PROMPT = DIRECTOR_SCENE_UNIVERSAL_PROMPT;

/**
 * 360 等距柱状全景英文结构（不含 # Positive Prompt:）。
 * 供「场景转换360图」等能力使用；导演场景资产生图请用九宫格，勿再拼此模板。
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

/** 场景九宫格英文约束（生成时链接） */
export const DIRECTOR_SCENE_NINE_GRID_ENGLISH =
  'Mandatory: one single image that is a clean 3x3 storyboard sheet of the SAME empty location. All nine cells MUST be exactly equal size (same width and height), perfectly aligned in a uniform grid, tightly packed with ZERO gaps, ZERO gutters, ZERO margins, ZERO black/white borders or empty strips between cells — tiles must touch edge-to-edge with no background showing through. Show nine different camera angles/distances only through the photography itself. Absolutely NO text, NO captions, NO labels, NO watermarks, NO logos, NO Chinese or English words, NO numbers on the image. No people, no faces, no limbs, no human silhouettes — environment and still life only, empty set. Not a panorama, not equirectangular 360, not an irregular collage with uneven tiles.';

export function ensureDirectorSceneBuiltinPrompt(prompt: string): string {
  const p = String(prompt || '').trim();
  if (!p) return DIRECTOR_SCENE_BUILTIN_SUFFIX;
  const hasBuiltin =
    p.includes('无人物') &&
    p.includes('空场景') &&
    (p.includes('九宫格') || p.includes('九宫格图'));
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
  if (!/同等大小|相等大小|等大/.test(next)) {
    next = `${next.replace(/[，,]\s*$/, '')}，九个宫格同等大小`;
  }
  if (!/无间隙|无空隙|紧密贴合|无缝/.test(next)) {
    next = `${next.replace(/[，,]\s*$/, '')}，宫格之间无间隙`;
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
 * 场景生图最终提示词：风格对齐 + 场景描述 + 通用九宫格强约束（中英）。
 * 不再拼接 360 全景模板（该模板会压过九宫格要求，生成单张海边长卷）。
 */
export function buildDirectorSceneImagePrompt(opts: {
  name?: string;
  prompt?: string;
  styleHint?: string;
}): string {
  const sceneDescription = ensureDirectorSceneBuiltinPrompt(
    String(opts.prompt || opts.name || '').trim(),
  );
  const styleHint = String(opts.styleHint || '').trim();
  const chunks: string[] = [];
  if (styleHint) {
    chunks.push(`画风必须严格对齐：${styleHint}`);
  }
  chunks.push(
    '【场景公式】年代/时代气质 + 地点 + 物品陈设（名称+位置+状态） + 材质 + 光线 + 无人物/无人脸/无肢体/无人影；仅环境与静物，禁止写手眼脸运镜表演。',
  );
  chunks.push(sceneDescription);
  chunks.push(DIRECTOR_SCENE_UNIVERSAL_PROMPT);
  chunks.push(DIRECTOR_SCENE_NINE_GRID_ENGLISH);
  chunks.push(
    '再次强调：九宫格每格必须同等大小；宫格之间禁止任何间隙、空隙、黑白边或分隔沟；画面上禁止出现任何文字、字母、数字或机位标签。',
  );
  return chunks.join('\n\n');
}

/** 资产生图固定比例：角色竖版、场景横版（利于九宫格铺开）、道具方图 */
export function directorAssetAspectRatio(kind: 'character' | 'scene' | 'prop' | string): string {
  if (kind === 'character') return '9:16';
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
 * 风格须作用在人物服装/肤色受光/发丝妆造与整体色调上（不只背景），
 * 不得改成插画或概念设定画风，也不得默认加墨镜等道具。
 */
export function buildDirectorCharacterImagePrompt(opts: {
  name?: string;
  prompt?: string;
  styleHint?: string;
  /** male / female / 男 / 女 */
  gender?: string;
}): string {
  const userPart = stripDirectorAssetEmbeddedStyle(String(opts.prompt || opts.name || '').trim());
  const styleHint = sanitizeDirectorStyleHintForCharacter(opts.styleHint);
  const linked = DIRECTOR_CHARACTER_LINKED_PROMPT;
  const alreadySheet =
    /四宫格真人写实|高清4视图展示|2×2\s*四宫格|2x2\s*character\s*reference/i.test(userPart);
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
  // 默认强制真人写实，再允许风格影响服饰/光色
  chunks.push('人物必须为真人写实摄影（photorealistic real human），禁止插画、卡通、二次元与概念设定画风');
  if (genderZh === '男') {
    chunks.push(
      '【性别锁·硬性】本角色必须是成年男性（cis male adult man），男性面部骨骼与体型，禁止生成女性、女装、中性偏女或双性别混杂外貌',
    );
  } else if (genderZh === '女') {
    chunks.push(
      '【性别锁·硬性】本角色必须是成年女性（cis female adult woman），女性面部与体型，禁止生成男性或偏男外貌',
    );
  }
  if (styleHint) {
    chunks.push(
      `【人物风格锁·硬性】人物必须对齐全片画风（不只背景）：服装造型与面料质感、肤色受光、发丝与妆造气质、整体色调均须贴合：${styleHint}。禁止人物像另一套片；不得照抄风格参考图里的墨镜/吉他/麦克风等未写进人物设定的道具；更不得把风格参考图里的人物性别套到本角色上。`,
    );
  }
  if (userPart && !alreadySheet) chunks.push(userPart);
  else if (userPart && alreadySheet) chunks.push(userPart);
  if (!alreadySheet) chunks.push(linked);
  chunks.push(DIRECTOR_CHARACTER_FOUR_GRID_ENGLISH);
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
  chunks.push(
    '再次强调：必须真人写实；四宫格每格同等大小；宫格之间禁止任何间隙、分界线、黑白边；纯白背景；画面无文字。',
  );
  return chunks.join('，');
}

/** 道具生图 */
export function buildDirectorPropImagePrompt(opts: {
  name?: string;
  prompt?: string;
  styleHint?: string;
}): string {
  return [opts.prompt || opts.name, opts.styleHint]
    .map((s) => String(s || '').trim())
    .filter(Boolean)
    .join('，');
}
