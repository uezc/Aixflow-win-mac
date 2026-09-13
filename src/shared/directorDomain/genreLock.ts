/**
 * 短剧题材锁：分析阶段识别题材，生图时强制服装/时代，避免古装戏出成霓虹现代风。
 */

export type DramaGenreKind =
  | 'costume_xuanhuan'
  | 'wuxia'
  | 'historical'
  | 'modern_urban'
  | 'scifi_apocalypse'
  | 'period_republic'
  | 'unknown';

export type DramaGenreLock = {
  kind: DramaGenreKind;
  /** 短标签：古装玄幻 / 现代都市 … */
  label: string;
  /** 写入 project.style / 展示 */
  styleLine: string;
  /** 拼进生图 styleHint */
  imageConstraint: string;
  /** 追加到角色 prompt 的服装时代锁（若原文缺失） */
  costumeAppend: string;
};

const COSTUME_KEYS =
  /古装|仙侠|玄幻|修仙|武侠|侠客|江湖|宫斗|朝堂|皇宫|公主|王爷|剑修|灵力|飞升|宗门|门派|绣裙|襦裙|汉服|道袍|长剑|斗笠|竹笠|侠客装/;
const MODERN_KEYS = /都市|现代|当代|职场|甜宠|霸总|公寓|咖啡|手机|地铁|写字楼/;
const SCIFI_KEYS = /末世|科幻|赛博|未来|废土|机甲|太空|星际|霓虹朋克/;
const REPUBLIC_KEYS = /民国|海派|旗袍|租界/;
const HIST_KEYS = /历史|朝代|唐宋|明清|秦汉|三国/;

function joinCorpus(parts: Array<string | undefined | null>): string {
  return parts
    .map((p) => String(p || '').trim())
    .filter(Boolean)
    .join('\n');
}

export function inferDramaGenreKind(corpus: string): DramaGenreKind {
  const t = String(corpus || '');
  if (!t.trim()) return 'unknown';
  const costumeHit = COSTUME_KEYS.test(t);
  const modernHit = MODERN_KEYS.test(t);
  const scifiHit = SCIFI_KEYS.test(t);
  const republicHit = REPUBLIC_KEYS.test(t);
  const histHit = HIST_KEYS.test(t);

  // 古装/玄幻优先于「霓虹」等误伤词（剧本氛围描写）
  if (costumeHit && !modernHit) return 'costume_xuanhuan';
  if (costumeHit && /仙|修|侠|宗门|灵/.test(t)) return 'costume_xuanhuan';
  if (/武侠|江湖|侠客/.test(t)) return 'wuxia';
  if (histHit && !modernHit) return 'historical';
  if (republicHit) return 'period_republic';
  if (scifiHit && !costumeHit) return 'scifi_apocalypse';
  if (modernHit) return 'modern_urban';
  if (costumeHit) return 'costume_xuanhuan';
  return 'unknown';
}

const LOCKS: Record<DramaGenreKind, Omit<DramaGenreLock, 'kind'>> = {
  costume_xuanhuan: {
    label: '古装玄幻',
    styleLine: '中国古装玄幻（汉服/道袍/侠客装体系，冷色仙气或江湖写实）',
    imageConstraint:
      '【题材锁·硬性·古装玄幻】本片为中国古装玄幻题材：人物服装必须是中国传统古装/仙侠造型（交领、襦裙、道袍、侠客劲装、斗笠等），发髻或古风长发；禁止现代西装、夹克、T恤、牛仔裤、运动鞋；禁止赛博朋克、霓虹招牌都市夜景作为人物主造型依据；背景可有氛围光，但人物服饰时代必须锁在中国古代/仙侠。',
    costumeAppend:
      '中国古装玄幻造型，传统服饰与发饰，禁止现代服装与赛博霓虹时装',
  },
  wuxia: {
    label: '武侠',
    styleLine: '中国武侠（劲装、披风、江湖写实）',
    imageConstraint:
      '【题材锁·硬性·武侠】人物须为中国武侠古装/劲装，禁止现代时装与赛博霓虹造型。',
    costumeAppend: '中国武侠古装劲装，禁止现代服装',
  },
  historical: {
    label: '历史古装',
    styleLine: '中国历史古装（朝代服饰考据感）',
    imageConstraint:
      '【题材锁·硬性·历史古装】人物服饰须符合中国历史古装，禁止现代装与赛博霓虹风。',
    costumeAppend: '中国历史古装，禁止现代服装',
  },
  modern_urban: {
    label: '现代都市',
    styleLine: '现代都市写实',
    imageConstraint:
      '【题材锁·硬性·现代都市】人物为当代都市装扮，禁止古装仙侠道袍襦裙作为默认服装。',
    costumeAppend: '当代都市常服',
  },
  scifi_apocalypse: {
    label: '科幻/末世',
    styleLine: '科幻或末世写实',
    imageConstraint:
      '【题材锁·硬性·科幻末世】服装与场景贴合科幻/末世设定，避免无依据地混入古装仙侠。',
    costumeAppend: '贴合科幻或末世设定的服装',
  },
  period_republic: {
    label: '民国',
    styleLine: '民国年代感（旗袍/长衫等）',
    imageConstraint:
      '【题材锁·硬性·民国】人物服饰须有民国年代感，禁止唐装仙侠或当代潮牌混搭错位。',
    costumeAppend: '民国时期服饰',
  },
  unknown: {
    label: '',
    styleLine: '',
    imageConstraint: '',
    costumeAppend: '',
  },
};

export function resolveDramaGenreLock(input: {
  style?: string;
  type?: string;
  era?: string;
  visual_style?: string;
  worldview?: string;
  plot?: string;
  script?: string;
  keywords?: string[];
}): DramaGenreLock {
  const corpus = joinCorpus([
    input.style,
    input.type,
    input.era,
    input.visual_style,
    input.worldview,
    input.plot,
    input.script,
    ...(input.keywords || []),
  ]);
  const kind = inferDramaGenreKind(corpus);
  const base = LOCKS[kind];
  return { kind, ...base };
}

/**
 * 生图用风格提示：不再注入题材 imageConstraint 光色锁（用户要求提示词不对题材做限制）。
 * 只保留用户选择的风格预设/自定义风格（extraHints）。
 */
export function composeDramaImageStyleHint(
  _genreLock: DramaGenreLock,
  ...extraHints: Array<string | undefined | null>
): string {
  return extraHints
    .map((s) => String(s || '').trim())
    .filter(Boolean)
    .join('；');
}

/**
 * 角色 prompt：不做题材服装锁自动追加（用户要求提示词按填写内容，不对题材做限制）。
 * 原样返回用户描述，仅做空值 trim。
 */
export function ensureDramaCharacterPromptGenreLock(
  prompt: string,
  _genreLock: DramaGenreLock,
): string {
  return String(prompt || '').trim();
}
