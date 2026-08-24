/**
 * MV「生成故事」前的短剧偏好选项（类型 / 风格 / 结局）。
 * 空字符串 = 由模型根据歌词与分析自选。
 */

export const DIRECTOR_MV_STORY_GENRE_TYPES = [
  '都市',
  '言情',
  '仙侠',
  '武侠',
  '玄幻',
  '科幻',
  '悬疑',
  '灵异',
  '历史',
  '军事',
  '网游',
  '穿越',
  '末日',
  '校园',
] as const;

export const DIRECTOR_MV_STORY_TONE_STYLES = [
  '轻松',
  '搞笑',
  '甜宠',
  '校园',
  '虐恋',
  '爽文',
  '种田',
  '正剧',
  '燃向',
  '治愈',
] as const;

export const DIRECTOR_MV_STORY_ENDING_TYPES = [
  '圆满向',
  '悲观向',
  '开放式',
  '反转向',
  '悬念式',
] as const;

export type DirectorMvStoryGenreType = (typeof DIRECTOR_MV_STORY_GENRE_TYPES)[number] | '';
export type DirectorMvStoryToneStyle = (typeof DIRECTOR_MV_STORY_TONE_STYLES)[number] | '';
export type DirectorMvStoryEndingType = (typeof DIRECTOR_MV_STORY_ENDING_TYPES)[number] | '';

export function normalizeDirectorMvStoryGenreType(raw: unknown): string {
  const t = String(raw || '').trim();
  if (!t) return '';
  return (DIRECTOR_MV_STORY_GENRE_TYPES as readonly string[]).includes(t) ? t : t.slice(0, 24);
}

export function normalizeDirectorMvStoryToneStyle(raw: unknown): string {
  const t = String(raw || '').trim();
  if (!t) return '';
  return (DIRECTOR_MV_STORY_TONE_STYLES as readonly string[]).includes(t) ? t : t.slice(0, 24);
}

export function normalizeDirectorMvStoryEndingType(raw: unknown): string {
  const t = String(raw || '').trim();
  if (!t) return '';
  return (DIRECTOR_MV_STORY_ENDING_TYPES as readonly string[]).includes(t) ? t : t.slice(0, 24);
}

/** 写入 LLM：用户已选偏好 */
export function formatDirectorMvStoryPrefsForPrompt(opts: {
  genreType?: string;
  toneStyle?: string;
  endingType?: string;
}): string {
  const genre = String(opts.genreType || '').trim() || '（未选·请根据歌词与分析自选合适题材）';
  const tone = String(opts.toneStyle || '').trim() || '（未选·请根据歌词情绪自选风格）';
  const ending = String(opts.endingType || '').trim() || '（未选·请自选一种结局倾向）';
  const genreLocked = !!String(opts.genreType || '').trim();
  const lines = [`故事类型：${genre}`, `风格：${tone}`, `结局倾向：${ending}`];
  if (genreLocked) {
    lines.push(
      `【类型硬锁】用户已选定「${genre}」：【故事类型】必须原样写「${genre}」，禁止改写成「都市${genre}」「现代${genre}」等拼接词；背景时空必须符合「${genre}」本义，不得擅自混入未选题材（如选仙侠则禁止霓虹/地铁/现代都市夜景）。`,
    );
  }
  return lines.join('\n');
}

/**
 * 生成后校正：把大纲里的【故事类型】/【风格】/【结局倾向】标题行对齐用户已选偏好。
 * 不改正文情节，只纠正标签与类型字段被模型擅自改写的问题。
 */
export function applyDirectorMvStoryPrefsToOutline(
  story: string,
  prefs: { genreType?: string; toneStyle?: string; endingType?: string },
): string {
  let s = String(story || '').replace(/\r\n/g, '\n');
  if (!s.trim()) return s;
  const genre = String(prefs.genreType || '').trim();
  const tone = String(prefs.toneStyle || '').trim();
  const ending = String(prefs.endingType || '').trim();

  const replaceLabeled = (label: string, value: string) => {
    if (!value) return;
    const re = new RegExp(`【\\s*${label}\\s*】\\s*[^\\n【]*`);
    if (re.test(s)) {
      s = s.replace(re, `【${label}】${value}`);
    } else {
      s = `【${label}】${value}\n${s}`;
    }
  };

  replaceLabeled('故事类型', genre);
  replaceLabeled('风格', tone);
  if (ending) {
    // 正文里常写「结局（圆满向）」；标题行优先校正「结局倾向」
    if (/【\s*结局倾向\s*】/.test(s)) replaceLabeled('结局倾向', ending);
    else if (/【\s*结局\s*】/.test(s)) replaceLabeled('结局', ending);
    else s = `【结局倾向】${ending}\n${s}`;
  }
  return s.trim();
}
