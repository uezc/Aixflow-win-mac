/**
 * 风格选择只约束「画风 + 色彩基调」，禁止题材/场景/地点词渗入 H3 风格铅字。
 * 场景内容以 Picture / 场景卡为准。
 */

/** 题材、地点、时代、叙事氛围（风格铅字中应剔除） */
const SCENE_THEME_SCRUB_RE =
  /\b(?:wuxia|xianxia|guofeng|oriental\s+landscape|ink-wash\s+oriental|chinese\s+guofeng|poetic\s+wuxia|cinema\s+mist|megacity|neon\s+megacity|rain[- ]?slick\s+streets?|hong\s+kong|cantonese|1980s|night\s+streets?|urban\s+(?:night\s+)?(?:drama|suspense)|slice[- ]of[- ]life\s+streets?|workplaces?|penthouse|ceo\s+romance|crime\s+night|social\s+drama\s+scenes?|lived[- ]in\s+social|youth\s+fantasy|fantasy\s+romance|comic\s+panels?|manga\s+panel|short\s+drama|thriller|neo-noir|period\s+urban|everyday\s+city\s+life)\b/gi;

const SCENE_THEME_SCRUB_ZH_RE =
  /诗意武侠|武侠薄雾|东方意境|东方美学|水墨东方意境|水墨东方|仙侠|修仙|古装玄幻|雨夜湿街|霓虹巨城|港夜街头|八十年代|都市夜戏|都市悬疑|市井日常|职场生活|豪宅轻奢|总裁豪门|犯罪夜色|社会剧场景|青春奇幻|漫画分镜|港剧光影|年代都市|薄雾影像/g;

/** 画风 / 色彩允许保留的词干（用于自测与文档；清洗时不依赖白名单） */
export const VISUAL_STYLE_LOOK_COLOR_SCOPE =
  'rendering look + color grade only; no scene, place, era, or genre set dressing';

/**
 * 把风格铅字压成画风+色彩基调：去掉地点/题材/时代场景词。
 * 已是干净铅字时尽量原样返回。
 */
export function scrubVisualStyleToLookAndColor(raw: string): string {
  let t = String(raw || '').trim();
  if (!t) return '';
  t = t
    .replace(SCENE_THEME_SCRUB_RE, ' ')
    .replace(SCENE_THEME_SCRUB_ZH_RE, ' ')
    .replace(/[，,]?\s*(?:都市|悬疑|商战|甜宠|校园|爱情|科幻|逆袭|异能|犯罪|复仇|惊悚|年代|情仇|古装|玄幻|历史|国风|仙侠|总裁|豪门|社会|现实|职业剧)\s*(?:调色|氛围|题材)?/g, ' ')
    .replace(/[·｜|]/g, ', ')
    .replace(/\s+/g, ' ')
    .replace(/(?:,\s*){2,}/g, ', ')
    .replace(/(?:，\s*){2,}/g, '，')
    .replace(/^[,\s，]+|[,\s，]+$/g, '')
    .trim();
  return t;
}

/** 氛围字段若像场景描写则丢弃（风格 DNA 合成时用） */
export function isScenicAtmospherePhrase(raw: string): boolean {
  const t = String(raw || '').trim();
  if (!t) return false;
  if (SCENE_THEME_SCRUB_RE.test(t) || SCENE_THEME_SCRUB_ZH_RE.test(t)) {
    SCENE_THEME_SCRUB_RE.lastIndex = 0;
    SCENE_THEME_SCRUB_ZH_RE.lastIndex = 0;
    return true;
  }
  SCENE_THEME_SCRUB_RE.lastIndex = 0;
  SCENE_THEME_SCRUB_ZH_RE.lastIndex = 0;
  return /landscape|streets?|city|workplace|penthouse|megacity|山谷|街|城|宅|殿|山河/i.test(t);
}
