import type { DirectorAsset, DirectorPipelineState, DirectorShot } from './schema.js';
import { listDirectorMvLeadAssetIds } from './schema.js';
import { composeDirectorCinematicLensPromptBlock } from './cinematicCameraLanguage.js';
import { resolveDirectorStyleReferenceImageUrl } from './stylePresets.js';
import {
  DIRECTOR_EMPTY_SHOT_BEAT_LOCK,
  DIRECTOR_EMPTY_SHOT_FRONT_BANNER,
  DIRECTOR_EMPTY_SHOT_NEGATIVE_LINE,
} from './lyricTimeline.js';

const ROLE_PREFIX_RE = /^(男主|女主|主角|配角|角色|人物|场景|地点|道具|生物|宠物|怪物|灵兽)/;

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** 从名称/设定串推断性别：男 | 女 | 场景 | 道具 | 生物 | 未知 */
export function inferDirectorAssetGender(
  asset: Pick<DirectorAsset, 'name' | 'kind' | 'prompt' | 'gender'> | null | undefined,
): string {
  if (!asset) return '未知';
  if (asset.kind === 'scene') return '场景';
  if (asset.kind === 'prop') return '道具';
  if (asset.kind === 'creature') return '生物';
  if (asset.gender === 'female') return '女';
  if (asset.gender === 'male') return '男';
  const blob = `${asset.name || ''}\n${asset.prompt || ''}`;
  if (/女主|性别\s*[:：]\s*女|女性|[:：]\s*女\s*[，,]/.test(blob)) return '女';
  if (/男主|性别\s*[:：]\s*男|男性|[:：]\s*男\s*[，,]/.test(blob)) return '男';
  return '未知';
}

export function directorAssetKindLabel(kind: DirectorAsset['kind'] | string | undefined): string {
  if (kind === 'character') return '角色';
  if (kind === 'scene') return '场景';
  if (kind === 'prop') return '道具';
  if (kind === 'creature') return '生物';
  return '参考';
}

export type DirectorShotRefRole = 'style' | 'storyboard' | 'character' | 'scene' | 'prop' | 'creature';

export type DirectorShotRefItem = {
  n: number;
  role: DirectorShotRefRole;
  name: string;
  url: string;
  gender?: string;
};

/** 视频提示词参考图：第1张=分镜，其后仅角色 */
export function buildDirectorShotRefItems(opts: {
  styleUrl?: string | null;
  storyboardUrl?: string | null;
  boundAssets?: Array<Pick<DirectorAsset, 'name' | 'kind' | 'imageUrl' | 'prompt' | 'gender'>>;
}): DirectorShotRefItem[] {
  const items: Array<Omit<DirectorShotRefItem, 'n'>> = [];
  void opts.styleUrl;
  const storyboardUrl = String(opts.storyboardUrl || '').trim() || 'ref://storyboard';
  items.push({
    role: 'storyboard',
    name: '本镜分镜图',
    url: storyboardUrl,
    gender: '分镜',
  });
  const bound = (opts.boundAssets || []).filter((a) => String(a.imageUrl || '').trim());
  const seen = new Set<string>();
  for (const a of bound) {
    if (String(a.kind || '') !== 'character') continue;
    const url = String(a.imageUrl || '').trim();
    if (!url || seen.has(url)) continue;
    seen.add(url);
    items.push({
      role: 'character',
      name: String(a.name || '').trim() || '角色',
      url,
      gender: inferDirectorAssetGender(a),
    });
  }
  return items.map((it, i) => ({ ...it, n: i + 1 }));
}

export function formatDirectorShotRefBindingClause(item: DirectorShotRefItem): string {
  if (item.role === 'storyboard') {
    return `@图片${item.n} 作为第${item.n}张参考图｜分镜｜本镜分镜图｜性别：分镜｜用途：构图、场景与光色锁`;
  }
  if (item.role === 'style') {
    return `@图片${item.n} 作为第${item.n}张参考图｜风格｜风格图｜性别：风格｜用途：全片光色锁（画风固定真人写实）`;
  }
  return formatDirectorImageBindingClause(item.n, {
    name: item.name,
    kind: item.role === 'character' ? 'character' : item.role,
    prompt: '',
    gender: item.gender === '女' ? 'female' : item.gender === '男' ? 'male' : undefined,
  });
}

export function parseDirectorShotRefBindings(
  prompt: string,
): Array<{ n: number; kind: string; name: string }> {
  const out: Array<{ n: number; kind: string; name: string }> = [];
  const re = /@图片\s*(\d+)\s*作为第\d+张参考图｜([^｜\n]+)｜([^｜\n]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(String(prompt || '')))) {
    const n = Number.parseInt(m[1], 10);
    if (!Number.isFinite(n) || n < 1) continue;
    out.push({ n, kind: String(m[2] || '').trim(), name: String(m[3] || '').trim() });
  }
  return out;
}

const DIRECTOR_REF_BINDING_LINE_RE =
  /@图片\s*\d+\s*作为第\d+张参考图｜[^\n@]+/g;

const INTERFERING_LOOK_WORD_RE =
  /\b(?:sands?|dust(?:\s+particles)?|dust[- ]storm|grains of sand|wind[- ]eroded|desert)\b/i;

const OFF_STORY_PROP_RULES: Array<{ re: RegExp; ok: RegExp }> = [
  {
    re: /\s*,?\s*onto a view of rusted machinery/gi,
    ok: /机械|机件|machinery|\bmachine\b/i,
  },
  { re: /\brusted machinery\b/gi, ok: /机械|机件|machinery|\bmachine\b/i },
  {
    re: /\s*,?\s*with vines beginning to overtake(?:\s+\w+){0,6}/gi,
    ok: /藤|常春藤|\bvines?\b|\bivy\b/i,
  },
  { re: /\b(?:vines?|ivy)\b/gi, ok: /藤|常春藤|\bvines?\b|\bivy\b/i },
  {
    re: /\s*,?\s*Broken glass and twisted metal remain scattered on the ground\.?/gi,
    ok: /玻璃|钢筋|\bglass\b|twisted metal/i,
  },
  { re: /\bbroken glass\b/gi, ok: /玻璃|\bglass\b/i },
  { re: /\btwisted metal\b/gi, ok: /钢筋|扭曲金属|twisted metal/i },
  {
    re: /\s*,?\s*centering on a tangle of exposed wires and broken tiles on the floor/gi,
    ok: /电线|电缆|瓷砖|\bwires?\b|\btiles?\b/i,
  },
  { re: /\b(?:a tangle of )?exposed wires\b/gi, ok: /电线|电缆|\bwires?\b/i },
  { re: /\bbroken tiles\b/gi, ok: /瓷砖|地砖|\btiles?\b/i },
  { re: /\brusted piece of metal\b/gi, ok: /锈铁|机械|\brusty\b|\bmachinery\b/i },
  { re: /\bgraffiti\b/gi, ok: /涂鸦|graffiti/i },
  { re: /\bchain[- ]link\b/gi, ok: /铁丝网|chain[- ]link/i },
  { re: /\bcorrugated(?:\s+metal)?\b/gi, ok: /波纹铁|彩钢|corrugated/i },
  { re: /\boil drums?\b/gi, ok: /油桶|oil drum/i },
  { re: /\bfluorescent(?:\s+lights?)?\b/gi, ok: /日光灯|荧光灯|fluorescent/i },
  { re: /\bshopping carts?\b/gi, ok: /购物车|shopping cart/i },
  { re: /\bforklifts?\b/gi, ok: /叉车|forklift/i },
  { re: /\bgenerators?\b/gi, ok: /发电机|generator/i },
  { re: /\b(?:electrical )?(?:cables?|wiring|circuit boards?)\b/gi, ok: /电缆|电路|电线|wiring|cable/i },
  { re: /\bparking lots?\b/gi, ok: /停车场|parking lot/i },
  { re: /\bdumpsters?\b/gi, ok: /垃圾箱|dumpster/i },
  { re: /\bbarbed wire\b/gi, ok: /铁丝网|barbed wire/i },
  { re: /\bvending machines?\b/gi, ok: /自动售货|vending/i },
  { re: /\btraffic cones?\b/gi, ok: /锥桶|路锥|traffic cone/i },
];

function stripOffStoryInventedProps(text: string, sourcePrompt?: string): string {
  const src = String(sourcePrompt || '').trim();
  let t = text;
  for (const rule of OFF_STORY_PROP_RULES) {
    if (!src || !rule.ok.test(src)) t = t.replace(rule.re, '');
  }
  return t
    .replace(/[^\S\n]{2,}/g, ' ')
    .replace(/,\s*,+/g, ',')
    .replace(/[^\S\n]+,/g, ',')
    .replace(/,\s*\./g, '.')
    .replace(/[^\S\n]+\./g, '.')
    .trim();
}

/** 给优化器用：本镜故事场景白名单（地点+画面描述） */
export function buildDirectorShotSceneStoryHint(shot: {
  地点?: string;
  画面描述?: string;
  光影氛围?: string;
}): string {
  const loc = String(shot['地点'] || '').trim();
  const desc = String(shot['画面描述'] || '').trim();
  const lines = [
    loc && loc !== '—' ? `地点：${loc}` : '',
    desc ? `画面描述：${desc}` : '',
  ].filter(Boolean);
  if (!lines.length) return '';
  return [
    ...lines,
    '只允许出现上述场景与第1张分镜图里已有的景物。禁止另编现代工业废墟套件（机械、电线、玻璃、藤蔓、瓷砖、厂房等），除非上面已经写到。',
    '光色以第1张分镜图画面为准；文字只写运镜与可见物，不要写色名、时段或氛围词。',
  ].join('\n');
}

/** 删会改画风/色调的干扰词，保留运镜句。故事里若是沙漠则保留 sand。 */
function stripInterferingLookClauses(text: string, sourcePrompt?: string): string {
  const allowDesert = /沙漠|黄沙|沙丘|\bdesert\b/i.test(String(sourcePrompt || ''));
  const parts = String(text || '').split(/(?<=[.。!?])\s*/);
  const kept: string[] = [];
  for (const raw of parts) {
    const sent = raw.trim();
    if (!sent) continue;
    if (allowDesert || !INTERFERING_LOOK_WORD_RE.test(sent)) {
      kept.push(sent);
      continue;
    }
    const hasCamera = /\bcamera\b|运镜|镜头/.test(sent);
    if (!hasCamera) continue;
    let s = sent
      .replace(/\s*,?\s*while dust and [^.]*?(?=[.]|$)/gi, '')
      .replace(/\s*,?\s*(?:and )?the buildup of sand\b/gi, '')
      .replace(/\s*,?\s*partially obscured by shifting sands?\b/gi, '')
      .replace(/\s*,?\s*Wind[- ]stirred sands?[^.]*?(?=[.]|$)/gi, '')
      .replace(/\b(?:wind[- ]stirred\s+)?(?:sands?|dust(?:\s+particles)?)\b/gi, '')
      .replace(/\b(?:grains of sand|dust[- ]storm|wind[- ]eroded|desert)\b/gi, '')
      .replace(/\s{2,}/g, ' ')
      .replace(/\s+,/g, ',')
      .replace(/,\s*\./g, '.')
      .replace(/\s+\./g, '.')
      .trim();
    if (s && /\bcamera\b|运镜|镜头/.test(s)) kept.push(s);
  }
  const joiner = /\n/.test(String(text || '')) ? '\n' : ' ';
  return kept.join(joiner).replace(/[^\S\n]{2,}/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
}

function stripCharacterLockedToStoryboard(text: string): string {
  const hasPic2 = /<Picture\s*2>/i.test(text) || /第2张图/.test(text) || /@图片\s*2/.test(text);
  if (!hasPic2) return text;
  let t = text;
  t = t.replace(/,\s*as seen in\s*<Picture\s*1>\s*,?/gi, ',');
  t = t.replace(/\bas seen in\s*<Picture\s*1>\b/gi, '');
  t = t.replace(/\bas (?:depicted|shown|portrayed) in\s*<Picture\s*1>(?=,?\s*(?:appears|stands|sits|walks))/gi, '');
  t = t.replace(
    /\b(?:face|features|attire|costume|appearance|looks?)\s+(?:from|in)\s*<Picture\s*1>/gi,
    'identity from <Picture 2>',
  );
  t = t.replace(/外貌参考第1张图/g, '外貌参考第2张图');
  t = t.replace(/\s{2,}/g, ' ').replace(/,\s*,+/g, ',').replace(/\s+,/g, ',');
  return t.trim();
}

const EMPTY_SHOT_BEAT_LOCK_EN = DIRECTOR_EMPTY_SHOT_BEAT_LOCK;

export function isDirectorEmptyShotPrompt(text: string, sourcePrompt?: string): boolean {
  const noCharRef = !/<Picture\s*2>/i.test(text) && !/@图片\s*2/.test(text);
  if (!noCharRef) return false;
  const labeledEmpty = /空镜无人物|本镜为空镜|空镜禁止任何人|Empty frame:|严禁出现任何人/i.test(text);
  const sourceEmpty = /空镜|无人物|无人出镜/.test(String(sourcePrompt || ''));
  const englishEmpty = /no people|no human presence|no silhouettes/i.test(text);
  return labeledEmpty || sourceEmpty || englishEmpty;
}

const PIC1_RENDER_LOCK_EN =
  "Keep Picture 1's rendering as it appears in the image; do not restyle into 3D CGI.";
/** 跟色锁：必须紧跟「参考图对照 / 图片1分镜句」，不要埋在禁人段落后面。H3 会念中文，故纯英文。 */
export const DIRECTOR_PIC1_COLOR_FRONT =
  'Keep Picture 1 colors and rendering as they appear in the image; do not regrade; do not restyle into 3D CGI. Do not speak this line.';

/** 固定视觉锚点：本地硬插入，优化器须原文保留。H3 会念中文，故纯英文。 */
export const DIRECTOR_PIC1_VISUAL_ANCHOR =
  'Picture 1 is the first frame and visual anchor. Keep its visible scene structure, materials, lighting direction, and rendering. All camera moves, FPV passes, cuts, and angle extensions stay in that same visual space: no regrade, no style drift, no invented color atmosphere. Only describe what is visible in Picture 1. Do not name colors. Do not write lighting, time of day, mood, or atmosphere words. Do not speak this line.';

/** H3 无独立负面框：跟色/风格漂移兜底写进正文前段 */
export const DIRECTOR_PIC1_LOOK_NEGATIVE_LINE =
  'Negative: unrealistic color shift, over-saturation, style drift, CGI remake, warm golden hour, purple haze, cold blue mood, orange sunlight, watermark, logo.';

const LOOK_HEAD_RE =
  /^(参考图对照[：:][^\n]*\n(?:<[^\n]+\n){0,8}(?:Keep Picture 1 colors[^\n]*\n)?(?:Picture 1 is the first frame[^\n]*\n)?(?:以第1张分镜图为首帧[^\n]*\n)?(?:Negative: unrealistic color shift[^\n]*\n)?)/;

function splitPic1StoryboardLine(text: string): string {
  return String(text || '').replace(
    /(<图片\d+>为本镜分镜图，构图、场景、画风与光色参考第\d+张图。)\s*/g,
    '$1\n',
  );
}

function dedupeRefMapHeaders(text: string): string {
  let seen = false;
  return String(text || '').replace(/(?:^|\n)\s*参考图对照[：:]\s*[。.]?\s*/g, () => {
    if (seen) return '\n';
    seen = true;
    return '参考图对照：\n';
  });
}

function stripBuriedPicture1ColorLocks(text: string): string {
  return String(text || '')
    .replace(
      /(?:^|\n)[^\S\n]*Keep Picture 1 colors[^\n]*/gi,
      '\n',
    )
    .replace(
      /(?:^|\n)[^\S\n]*Keep Picture 1['’]s rendering[^\n]*/gi,
      '\n',
    )
    .replace(
      /(?:^|\n)[^\S\n]*光色与渲染严格跟第1张分镜图画面，禁止重新调色。[^\n]*/g,
      '\n',
    )
    .replace(
      /(?:^|\n)[^\S\n]*以第1张分镜图为首帧与视觉锚点[^\n]*/g,
      '\n',
    )
    .replace(
      /(?:^|\n)[^\S\n]*Picture 1 is the first frame and visual anchor[^\n]*/gi,
      '\n',
    )
    .replace(
      /(?:^|\n)[^\S\n]*Negative:\s*unrealistic color shift[^\n]*/gi,
      '\n',
    )
    // 历史脏稿：锚点被压成同一行重复多次
    .replace(
      /(?:\s*以第1张分镜图为首帧与视觉锚点[\s\S]*?atmosphere words\.)+/gi,
      '\n',
    )
    .replace(
      /(?:\s*Picture 1 is the first frame and visual anchor[\s\S]*?Do not speak this line\.)+/gi,
      '\n',
    )
    .replace(
      /(?:\s*Negative:\s*unrealistic color shift[\s\S]*?logo\.)+/gi,
      '\n',
    )
    .replace(
      /(?:\s*Keep Picture 1 colors and rendering as they appear in the image;\s*do not regrade;\s*do not restyle into 3D CGI\.(?:\s*Do not speak this line\.)?\s*(?:光色与渲染严格跟第1张分镜图画面，禁止重新调色。)?)+/gi,
      '\n',
    );
}

/** 把一段文字插到对照/跟色锁之后，避免盖住第1张分镜的光色锁 */
export function insertDirectorPromptAfterLookHead(prompt: string, block: string): string {
  const t = String(prompt || '').trim();
  const g = String(block || '').trim();
  if (!g) return t;
  if (!t) return g;
  if (t.includes(g.slice(0, Math.min(18, g.length)))) return t;
  const head = t.match(LOOK_HEAD_RE);
  if (head) {
    return `${head[1]}${g}\n${t.slice(head[1].length)}`.replace(/\n{3,}/g, '\n\n').trim();
  }
  const colorOnly = t.match(/^(Keep Picture 1 colors[^\n]*\n)/);
  if (colorOnly) {
    return `${colorOnly[1]}${g}\n${t.slice(colorOnly[1].length)}`.replace(/\n{3,}/g, '\n\n').trim();
  }
  return `${g}\n${t}`;
}

function injectEmptyShotBeatLocks(text: string): string {
  return String(text || '').replace(/(\[(?:Shot|镜头)\s*\d+\])/gi, (full, _g, offset, src) => {
    const prev = String(src).slice(Math.max(0, Number(offset) - 18), Number(offset));
    if (/\(\s*from\s+$/i.test(prev) || /from\s+$/i.test(prev)) return full;
    return `${full} ${EMPTY_SHOT_BEAT_LOCK_EN}`;
  });
}

function repairBrokenPic1FirstFrameLock(text: string): string {
  return String(text || '')
    .replace(
      /(<Picture\s*1>\s*\(\s*from\s*\[Shot\s*1\])\s*Empty frame:[^)]*(\)\s*is fully referenced)/gi,
      '$1$2',
    )
    .replace(/(\(\s*from\s*\[(?:Shot|镜头)\s*\d+\])\s+\)/gi, '$1)');
}

function ensureEmptyShotFrontMatter(text: string): string {
  let t = String(text || '').trim();
  if (!t) return t;
  const pack: string[] = [];
  if (!/严禁出现任何人/.test(t)) pack.push(DIRECTOR_EMPTY_SHOT_FRONT_BANNER);
  if (!/不要出现：人/.test(t)) pack.push(DIRECTOR_EMPTY_SHOT_NEGATIVE_LINE);
  if (!pack.length) return t;
  return insertDirectorPromptAfterLookHead(t, pack.join('\n'));
}

function ensureEmptyShotNoPeople(text: string, sourcePrompt?: string): string {
  if (!isDirectorEmptyShotPrompt(text, sourcePrompt)) return text;
  let t = splitPic1StoryboardLine(repairBrokenPic1FirstFrameLock(text))
    .replace(/无人声≠无人[^。\n]*[。.]?/g, '')
    .replace(/也可主角沉默戏[^。\n]*[。.]?/g, '')
    .replace(/或路人\/群众奔逃过场[^。\n]*[。.]?/g, '')
    .replace(/人物须闭嘴沉默[。.]?/g, '')
    .replace(/【非对口型硬性】[^。\n]*/g, '')
    .replace(/Mouth closed for everyone[^。\n]*/gi, '')
    .replace(/口型约束：全员双唇紧闭[^。\n]*/g, '')
    .replace(/所有出场人物（含主角、配角、路人）[^。\n]*/g, '')
    .replace(/，空旷环境/g, '')
    .replace(/空旷环境[。.]?/g, '')
    .replace(/\s*Empty frame:[^.。\n]*[.。]?/gi, ' ')
    .replace(/\s*严禁任何人、人脸、人形、雕像与疑似人形阴影[。.]?/g, ' ');
  t = repairBrokenPic1FirstFrameLock(t);
  if (/\[(?:Shot|镜头)\s*\d+\]/i.test(t)) {
    t = injectEmptyShotBeatLocks(t);
  } else if (!/Empty frame:/i.test(t)) {
    t = `${t} ${EMPTY_SHOT_BEAT_LOCK_EN}`.trim();
  }
  t = repairBrokenPic1FirstFrameLock(t);
  t = splitPic1StoryboardLine(t);
  t = ensureEmptyShotFrontMatter(t);
  return t.replace(/[^\S\n]{2,}/g, ' ').replace(/\n /g, '\n').trim();
}

/** 优化稿已合格时也会跳过重写；这些残留句会把分镜色漂成日照，必须直接删。 */
function stripInventedLightingClauses(text: string): string {
  const lines = String(text || '').split('\n');
  const out = lines.map((line) => {
    // 勿清洗固定视觉锚点 / Negative 行（否则会自我破坏并触发重复插入）
    if (
      /^[^\S\n]*Keep Picture 1 colors/i.test(line) ||
      /^[^\S\n]*Picture 1 is the first frame/i.test(line) ||
      /^[^\S\n]*以第1张分镜图为首帧/.test(line) ||
      /^[^\S\n]*Negative:\s*unrealistic color shift/i.test(line) ||
      /^[^\S\n]*Negative:\s*people/i.test(line)
    ) {
      return line;
    }
    let t = line;
    t = t.replace(
      /\s*Lighting falls unevenly\s*,?\s*accentuating deep shadows(?:\s+in the recesses)?\s*\.?/gi,
      ' ',
    );
    t = t.replace(/\bLighting falls[^.。\n]*[.。]?/gi, ' ');
    t = t.replace(
      /\b(?:The\s+)?(?:lighting|sunlight|daylight)\s+(?:falls|is|comes|streams|hits|casts)[^.。\n]*[.。]?/gi,
      ' ',
    );
    t = t.replace(/\baccentuating deep shadows(?:\s+in the recesses)?\s*\.?/gi, ' ');
    t = t.replace(/\b(?:golden hour|god rays|warm sunlight|warm amber|cinematic (?:color )?grade)\b/gi, '');
    t = t.replace(/(?:夕阳|黄金时段|晨光|丁达尔效应|紫雾|暖色|冷色|暖金|冷蓝|紫色黄昏|金色阳光|暖橙日光)/g, '');
    t = t.replace(
      /\b(?:purple(?:\s+(?:dusk|haze|mist|glow|atmosphere))?|warm(?:\s+(?:orange|golden|amber))?|cold blue(?:\s+mood)?|orange sunlight|golden sunset)\b/gi,
      '',
    );
    t = t.replace(
      /\b(?:environment feels|oppressively silent|abandoned scene|atmospheric|moody)\b[^.。\n]*[.。]?/gi,
      ' ',
    );
    return t.replace(/[^\S\n]{2,}/g, ' ').replace(/[^\S\n]+([.。])/g, '$1');
  });
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

function ensurePicture1LookStack(text: string): string {
  if (!/<Picture\s*1>/i.test(text) && !/第1张分镜/.test(text) && !/@图片\s*1/.test(text)) {
    return text;
  }
  let t = splitPic1StoryboardLine(stripInventedLightingClauses(text));
  t = t.replace(/\bcinematic(?:\s+depiction)?\b/gi, '');
  t = stripBuriedPicture1ColorLocks(t);
  const head = t.match(/^(参考图对照[：:][^\n]*\n(?:<[^\n]+\n){0,8})/);
  const stack = [DIRECTOR_PIC1_COLOR_FRONT, DIRECTOR_PIC1_VISUAL_ANCHOR, DIRECTOR_PIC1_LOOK_NEGATIVE_LINE];
  if (head) {
    t = `${head[1]}${stack.join('\n')}\n${t.slice(head[1].length)}`;
  } else {
    t = `${stack.join('\n')}\n${t}`;
  }
  if (!/do not restyle into 3D CGI|不要改成三维CG/i.test(t)) {
    t = t.replace(/(do not regrade\.)/i, `$1 ${PIC1_RENDER_LOCK_EN} `);
  }
  return t.replace(/[^\S\n]{2,}/g, ' ').replace(/\n /g, '\n').trim();
}

export function directorMvPromptNeedsLookRelock(prompt: string): boolean {
  const t = String(prompt || '');
  const looksEmpty =
    !/<Picture\s*2>/i.test(t) &&
    !/@图片\s*2/.test(t) &&
    /no people|空镜|无人物/i.test(t);
  const emptyMissingBeat =
    looksEmpty &&
    /\[(?:Shot|镜头)\s*2\]/i.test(t) &&
    !/Empty frame:/i.test(t);
  const emptyMissingFront =
    looksEmpty &&
    (!/严禁出现任何人/.test(t) ||
      !/类似人形|疑似人形|statues?/i.test(t) ||
      !/不要出现：人/.test(t));
  return (
    /\bLighting falls\b/i.test(t) ||
    /用途：构图与画风锁/.test(t) ||
    /构图、场景与画风参考第\d+张图/.test(t) ||
    /参考图对照：。/.test(t) ||
    /(?:参考图对照[：:])[\s\S]*参考图对照[：:]/.test(t) ||
    /\(\s*from\s*\[Shot\s*1\]\s*Empty frame:/i.test(t) ||
    /，空旷环境/.test(t) ||
    /空旷环境/.test(t) ||
    emptyMissingBeat ||
    emptyMissingFront ||
    (/(?:<Picture\s*1>|@图片\s*1|第1张分镜)/i.test(t) &&
      (!/严格继承参考图中可见|Picture 1 is the first frame and visual anchor/i.test(t) ||
        !/unrealistic color shift|style drift/i.test(t) ||
        (!/光色与渲染严格跟第1张/.test(t) &&
          !/Keep Picture 1 colors and rendering/i.test(t))))
  );
}

export function stripDirectorPromptInventedLook(prompt: string, sourcePrompt?: string): string {
  let t = String(prompt || '');
  const lockPic1 =
    '构图、场景、画风与光色以第1张分镜图画面为准；文字只写运镜与运动。';
  t = t.replace(/（无参考图）按文字描述生成[，,]?[^\n。]*[。.]?/g, lockPic1);
  t = t.replace(/（本镜无参考图，按文字描述生成[^）]*）/g, lockPic1);
  t = t.replace(/本镜无参考图，按文字描述生成[；;，,]?[^\n。]*[。.]?/g, lockPic1);
  t = t.replace(
    /Copy\s*<Picture\s*1>\s*color grade and rendering exactly[^.]*(?:\.\s*)?/gi,
    '',
  );
  t = t.replace(/Forbidden:\s*warm-golden[^.]*?(?:\.\s*)?/gi, '');
  t = t.replace(/\bLive-action\s*,\s*cinematic\s*,?/gi, '');
  t = t.replace(/\blive[- ]action(?:\s*,\s*cinematic)?\s*,?/gi, '');
  t = t.replace(/\bphotoreal(?:istic)?(?:\s+real\s+human)?\s*,?/gi, '');
  t = t.replace(/\s*参考图对照[：:]\s*[。.]?\s*/g, '\n参考图对照：\n');
  t = t.replace(/^\n+/, '');
  t = splitPic1StoryboardLine(t);
  t = dedupeRefMapHeaders(t);
  t = t.replace(
    /(?:<图片1>为本镜分镜图，构图、场景、画风与光色参考第1张图。\s*){2,}/g,
    '<图片1>为本镜分镜图，构图、场景、画风与光色参考第1张图。\n',
  );
  t = t.replace(
    /(<图片1>为本镜分镜图，构图、场景、画风与光色参考第1张图。\n)([\s\S]*?)<图片1>为本镜分镜图，构图、场景、画风与光色参考第1张图。\s*/g,
    '$1$2',
  );
  t = t.replace(/构图、场景与画风参考第(\d+)张图/g, '构图、场景、画风与光色参考第$1张图');
  t = t.replace(/用途：构图与画风锁/g, '用途：构图、场景与光色锁');
  t = stripOffStoryInventedProps(t, sourcePrompt);
  t = stripInterferingLookClauses(t, sourcePrompt);
  t = stripCharacterLockedToStoryboard(t);
  t = ensureEmptyShotNoPeople(t, sourcePrompt);
  t = ensurePicture1LookStack(t);
  t = t.replace(/\[Shot 1\]\s*,+/gi, '[Shot 1] ');
  t = t.replace(/,\s*,+/g, ',');
  t = t.replace(/[^\S\n]{2,}/g, ' ');
  t = t.replace(/\n{3,}/g, '\n\n');
  return t.trim();
}

export function stripDirectorPromptRefMapAndBindings(prompt: string): string {
  let t = String(prompt || '');
  t = stripBuriedPicture1ColorLocks(t);
  t = t.replace(/(?:^|\n)\s*参考图对照[：:]\s*[。.]?\s*/g, '\n');
  t = t.replace(/^[。.\s]+/u, '');
  t = t.replace(
    /(?:<图片1>为本镜分镜图，构图、场景、画风与光色参考第1张图。\s*){2,}/g,
    '<图片1>为本镜分镜图，构图、场景、画风与光色参考第1张图。\n',
  );
  t = t.replace(
    /^(?:<图片\d+>[^。\n]*。\s*|「[^」]+」外貌参考第\d+张图[^。\n]*。\s*|成片色调与画风必须跟第\d+张[^。\n]*。\s*|成片画风参考第\d+张[^。\n]*。\s*)+/u,
    '',
  );
  t = t.replace(DIRECTOR_REF_BINDING_LINE_RE, '');
  t = t.replace(/N\/A\s*\.\s*(?=@图片)/gi, 'N/A\n');
  t = t.replace(/[，,；;\s]+$/g, '');
  t = t.replace(/\n{3,}/g, '\n\n');
  return t.trim();
}

export function buildDirectorShotRefMapLines(items: DirectorShotRefItem[]): string[] {
  const defLines: string[] = [];
  for (const it of items) {
    if (it.role === 'storyboard') {
      defLines.push(`<图片${it.n}>为本镜分镜图，构图、场景、画风与光色参考第${it.n}张图。`);
    } else if (it.role === 'style') {
      defLines.push(
        `<图片${it.n}>为风格参考图，只参考光色；画风固定真人写实摄影，禁止插画/卡通/二次元/三维CG。`,
      );
    } else if (it.role === 'character') {
      defLines.push(`「${it.name}」外貌参考第${it.n}张图。`);
    }
  }
  if (items.some((i) => i.role === 'storyboard') && items.some((i) => i.role === 'character')) {
    defLines.push('成片画风参考第1张分镜图；角色图只提供外貌身份。');
  }
  return defLines;
}

/** 主体定义 / 画风里写清每样东西参考第几张图 */
export function annotateDirectorPromptRefNumbers(
  prompt: string,
  items: DirectorShotRefItem[],
  sourcePrompt?: string,
): string {
  // 先剥对照再统一 strip（含视觉锚点），避免「剥对照留下锚点 → 再 prepend 锚点」叠层
  let t = stripDirectorPromptInventedLook(
    stripDirectorPromptRefMapAndBindings(prompt),
    sourcePrompt,
  );
  if (!t || items.length === 0) return t;
  const storyboard = items.find((i) => i.role === 'storyboard');
  const style = items.find((i) => i.role === 'style');
  const hint = storyboard
    ? `构图、场景与光色参考第${storyboard.n}张分镜图；画风固定真人写实`
    : style
      ? `光色参考第${style.n}张风格图；画风固定真人写实摄影`
      : '';
  if (hint) {
    t = t.replace(/构图(?:、画风与光色|、场景与光色|与画风)参考第\d+张分镜图[^。\n]*/g, hint);
    t = t.replace(/画面风格参考所选风格图片(?:「[^」]*」)?/g, hint);
    t = t.replace(/画面风格参考第\d+张图/g, hint);
    t = t.replace(/光色参考第\d+张风格图；画风固定真人写实摄影[^。\n]*/g, hint);
    t = t.replace(/画风\s*[：:]\s*[^\n。]*/g, `画风：${hint}`);
    t = t.replace(
      /目标视频画风须同时作用在人物与场景[：:][^\n]*/g,
      `目标视频画风须同时作用在人物与场景：${hint}`,
    );
  }
  const firstChar = items.find((i) => i.role === 'character');
  if (storyboard && firstChar) {
    const enKeep = `keeping composition, scene, look and colors consistent with <Picture ${storyboard.n}>, and the lead's face/hair/costume identity consistent with <Picture ${firstChar.n}>`;
    t = t.replace(
      /keeping composition, scene, lighting and art style consistent with <Picture \d+>, and the lead's face\/hair\/costume identity consistent with <Picture \d+>\s*\(do not copy the character sheet's white-studio lighting\)/gi,
      enKeep,
    );
    t = t.replace(
      /keeping[^.]*?(?:clothing|facial appearance|face)[^.]*?consistent with <Picture 1>/gi,
      enKeep,
    );
  }
  const defLines = buildDirectorShotRefMapLines(items);
  if (defLines.length && /主体定义\s*[：:]/.test(t)) {
    t = t.replace(
      /(主体定义：\s*\n?)([\s\S]*?)(?=\n概述\s*[：:])/,
      (_m, head: string, body: string) => {
        const audioLines = String(body || '')
          .split('\n')
          .map((l) => l.trim())
          .filter((l) => /<音频/.test(l));
        const keepEmpty =
          /空镜|无人物主体/.test(body) && !items.some((i) => i.role === 'character');
        const emptyLine = keepEmpty
          ? ['（本镜为空镜：无人物主体；严禁任何人、人脸、人形、雕像与疑似人形阴影；仅环境与构图；光色跟第1张分镜图；不要改成三维CG。）']
          : [];
        return `${head}${[...emptyLine, ...defLines, ...audioLines].join('\n')}\n`;
      },
    );
  } else if (defLines.length) {
    t = stripBuriedPicture1ColorLocks(t);
    t = t.replace(/(?:^|\n)\s*参考图对照[：:]\s*[。.]?\s*/g, '\n').trim();
    t = `参考图对照：\n${defLines.join('\n')}\n${[
      DIRECTOR_PIC1_COLOR_FRONT,
      DIRECTOR_PIC1_VISUAL_ANCHOR,
      DIRECTOR_PIC1_LOOK_NEGATIVE_LINE,
    ].join('\n')}\n\n${t}`;
  }
  return t;
}

/** 按本镜分镜+角色重写对照与页脚绑定（优化稿纠错 / 生成前补绑） */
export function repairDirectorMvPromptImageMap(
  prompt: string,
  items: DirectorShotRefItem[],
  sourcePrompt?: string,
): string {
  if (!items.length) {
    return stripDirectorPromptInventedLook(String(prompt || ''), sourcePrompt);
  }
  // 只走 annotate 一次（内部已 strip）；禁止外层再 strip 一遍导致锚点叠层
  let body = annotateDirectorPromptRefNumbers(String(prompt || ''), items, sourcePrompt);
  const clause = items.map(formatDirectorShotRefBindingClause).join('\n');
  if (!clause) return body;
  if (/@图片\s*1\s*作为第1张参考图/.test(body)) {
    body = body.replace(DIRECTOR_REF_BINDING_LINE_RE, '').replace(/[，,；;\s]+$/g, '').trim();
  }
  return `${body}\n${clause}`;
}

const BINDING_KIND_TO_ROLE: Record<string, DirectorAsset['kind']> = {
  角色: 'character',
  人物: 'character',
  场景: 'scene',
  道具: 'prop',
  生物: 'creature',
};

function findLibraryAssetByBindingName(
  name: string,
  library: Array<Pick<DirectorAsset, 'name' | 'kind' | 'imageUrl' | 'prompt' | 'gender'>>,
): (typeof library)[number] | undefined {
  const n = String(name || '').trim();
  if (!n) return undefined;
  return (
    library.find((a) => String(a.name || '').trim() === n) ||
    library.find((a) => {
      const an = String(a.name || '').trim();
      return !!an && (an.includes(n) || n.includes(an));
    })
  );
}

/** 本镜参考图清单：优先用已绑资产，否则从提示词绑定句按名称回找 */
export function resolveDirectorShotRefItems(opts: {
  prompt?: string;
  styleUrl?: string | null;
  storyboardUrl?: string | null;
  boundAssets?: Array<Pick<DirectorAsset, 'name' | 'kind' | 'imageUrl' | 'prompt' | 'gender'>>;
  libraryAssets?: Array<Pick<DirectorAsset, 'name' | 'kind' | 'imageUrl' | 'prompt' | 'gender'>>;
}): DirectorShotRefItem[] {
  void opts.styleUrl;
  let bound = (opts.boundAssets || []).filter(
    (a) => String(a.kind || '') === 'character' && String(a.imageUrl || '').trim(),
  );
  if (bound.length === 0) {
    const lib = opts.libraryAssets || [];
    const seen = new Set<string>();
    bound = parseDirectorShotRefBindings(opts.prompt || '')
      .filter((b) => /角色|人物/.test(b.kind) && !/风格|场景|道具|生物|分镜/.test(b.kind))
      .map((b) => {
        const hit = findLibraryAssetByBindingName(b.name, lib);
        if (hit) return hit;
        return {
          name: b.name,
          kind: BINDING_KIND_TO_ROLE[b.kind] || 'character',
          imageUrl: '',
          prompt: '',
        };
      })
      .filter((a) => {
        const key = `${a.kind}:${String(a.name || '').trim()}:${String(a.imageUrl || '').trim()}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return String(a.imageUrl || '').trim() || String(a.name || '').trim();
      });
  }
  // 无图时仍要写出「参考第N张」，给 build 一个占位 URL
  const withUrl = bound.map((a) =>
    String(a.imageUrl || '').trim()
      ? a
      : { ...a, imageUrl: `ref://${a.kind}/${a.name || 'asset'}` },
  );
  return buildDirectorShotRefItems({
    storyboardUrl: opts.storyboardUrl,
    boundAssets: withUrl,
  });
}

/** 把正文/绑定改成「每样东西参考第N张图」，序号与页脚 @图片N 一致 */
export function clarifyDirectorPromptRefPictureNumbers(
  prompt: string,
  opts: {
    styleUrl?: string | null;
    storyboardUrl?: string | null;
    boundAssets?: Array<Pick<DirectorAsset, 'name' | 'kind' | 'imageUrl' | 'prompt' | 'gender'>>;
    libraryAssets?: Array<Pick<DirectorAsset, 'name' | 'kind' | 'imageUrl' | 'prompt' | 'gender'>>;
  },
): string {
  const items = resolveDirectorShotRefItems({
    prompt,
    styleUrl: opts.styleUrl,
    storyboardUrl: opts.storyboardUrl,
    boundAssets: opts.boundAssets,
    libraryAssets: opts.libraryAssets,
  });
  if (!items.length) return String(prompt || '').trim();
  return repairDirectorMvPromptImageMap(buildShotPromptBody(prompt, {}), items);
}

/** @图片N 绑定说明：第几张、类型、名称、性别、用途 */
export function formatDirectorImageBindingClause(
  n: number,
  asset: Pick<DirectorAsset, 'name' | 'kind' | 'prompt' | 'gender'> | null | undefined,
): string {
  const kind = directorAssetKindLabel(asset?.kind);
  const name = String(asset?.name || '').trim() || `图片${n}`;
  const gender = inferDirectorAssetGender(asset);
  const use =
    asset?.kind === 'character'
      ? '角色身份锁'
      : asset?.kind === 'scene'
        ? '场景环境锁'
        : asset?.kind === 'prop'
          ? '道具外观锁'
          : asset?.kind === 'creature'
            ? '生物外观锁'
            : '参考锁';
  return `@图片${n} 作为第${n}张参考图｜${kind}｜${name}｜性别：${gender}｜用途：${use}`;
}

const ROLE_TOKEN_RE = /男主|女主|主角|配角|角色|人物/g;
const SCENE_LOC_WORDS = [
  '街头',
  '街道',
  '街景',
  '雨夜',
  '雨中',
  '公园',
  '室内',
  '窗边',
  '天台',
  '酒吧',
  '地铁',
  '教室',
  '海边',
  '屋顶',
  '巷子',
  '小巷',
  '卧室',
  '客厅',
  '厨房',
  '咖啡馆',
  '舞台',
  '后台',
  '车内',
  '桥上',
  '广场',
  '校园',
  '走廊',
  '阳台',
  '夜景',
];

/** 资产显示名及其可匹配别名（更长短语优先） */
export function directorAssetMatchAliases(name: string): string[] {
  const n = String(name || '').trim();
  if (!n) return [];
  const out: string[] = [n];

  // 「男主/先生」「女主｜莉莉」等拆分
  for (const part of n.split(/[/|／｜、，,]/u)) {
    const p = String(part || '').trim();
    if (p.length >= 1) out.push(p);
  }

  const roleHits = n.match(ROLE_TOKEN_RE);
  if (roleHits) {
    for (const r of roleHits) out.push(r);
  }

  let stripped = n.replace(ROLE_PREFIX_RE, '').trim();
  stripped = stripped.replace(/^[/|／｜\s]+/u, '').trim();
  if (stripped.length >= 2 && stripped !== n) out.push(stripped);

  const seen = new Set<string>();
  return out.filter((x) => {
    const t = String(x || '').trim();
    if (t.length < 1) return false;
    if (seen.has(t)) return false;
    seen.add(t);
    return true;
  });
}

function blobMentionsAlias(blob: string, alias: string): boolean {
  if (!blob || !alias || alias.length < 2) return false;
  if (blob.includes(alias)) return true;
  if (/^[a-zA-Z0-9_\-\s]+$/.test(alias)) {
    const re = new RegExp(`\\b${escapeRegExp(alias)}\\b`, 'i');
    return re.test(blob);
  }
  return false;
}

/** 「男主」「角色」等泛称不能当成素材库人物的专名命中 */
function isGenericRoleAlias(alias: string, fullName: string): boolean {
  if (!/^(男主|女主|主角|配角|角色|人物)$/.test(alias)) return false;
  const n = String(fullName || '').trim();
  return n !== alias && !/^(男主|女主)[12]$/.test(n);
}

function isDefaultLeadRoleName(name: string): boolean {
  const n = String(name || '').trim();
  return n === '男主' || n === '女主' || /^(男主|女主)[12]$/.test(n);
}

/** 仅姓名/别名点名分，不含性别或「人物/行走」泛线索 */
function nameMentionScore(asset: OrderedRef, blob: string): number {
  const name = String(asset?.name || '').trim();
  if (!name || !blob) return 0;
  let score = 0;
  for (const alias of directorAssetMatchAliases(name)) {
    if (alias.length < 2) continue;
    if (isGenericRoleAlias(alias, name)) continue;
    if (blobMentionsAlias(blob, alias)) score += Math.min(40, alias.length * 8);
  }
  return score;
}

type ShotSearchFields = Partial<
  Pick<
    DirectorShot,
    | '画面描述'
    | '镜头角度'
    | '焦距'
    | '景别'
    | '光影氛围'
    | '运镜'
    | '最终提示词'
    | '对白旁白'
    | '音效'
    | '出场人物'
  >
>;

type OrderedRef = Pick<DirectorAsset, 'id' | 'name' | 'kind' | 'imageUrl' | 'prompt' | 'gender'>;

/**
 * 从镜头字段拼检索文本：以画面描述 + 最终提示词 + 出场人物为主。
 * 不对白/歌词/音效参与匹配，避免歌词误命中角色名、也不因歌词把全员塞进空镜。
 */
export function buildDirectorShotAssetSearchBlob(shot: ShotSearchFields): string {
  return [
    shot['画面描述'],
    shot['出场人物'],
    shot['最终提示词'],
    shot['景别'],
    shot['光影氛围'],
    shot['运镜'],
  ]
    .map((x) => String(x || '').trim())
    .filter(Boolean)
    .join('\n');
}

/**
 * 画面描述是否明确声明空镜/无人物（优先于最终提示词里的旧角色残留）。
 */
export function shotDescriptionSuggestsEmptyCast(shot: ShotSearchFields): boolean {
  const desc = String(shot['画面描述'] || '').trim();
  if (!desc) return false;
  return /空镜\s*[\/／、,]?\s*无人物|无人物|空镜|空场景|无人出镜|无人脸|只有风景|纯风景|纯环境|建置空镜|纯空镜|establishing(?:\s*shot)?|empty\s*(?:set|scene)|no\s*(?:people|characters|cast|figures)/i.test(
    desc,
  );
}

/**
 * 提示词是否出现人物线索（点名、背影、行走、写真等）。
 * 有人声/无人声不直接决定；只看画面描述与最终提示词。
 * 注意：不能把「无人物」里的「人物」误判为有人。
 */
export function shotSuggestsPersonPresent(shot: ShotSearchFields): boolean {
  if (shotDescriptionSuggestsEmptyCast(shot)) return false;
  const blob = buildDirectorShotAssetSearchBlob(shot)
    // 去掉否定人物表述，避免「无人物」命中「人物」
    .replace(/无人物|无人出镜|无人脸|空镜|空场景/gi, ' ')
    .replace(/\bno\s*(?:people|characters|cast|figures)\b/gi, ' ');
  if (!blob.trim()) return false;
  return /男主|女主|主角|配角|少年|少女|\bhe\b|\bshe\b|他(?:的|正|在|走|望|站|坐)?|她(?:的|正|在|走|望|站|坐)?|背影|侧影|剪影|身影|行走|缓行|走过|穿过|第三视角|过肩|写真|肖像|人物|silhouette|from\s*behind|walking/i.test(
    blob,
  );
}

/**
 * 画面暗示本镜不需要角色参考图。
 * 判定依据是提示词/画面描述，不是「有没有人声」、也不是每镜默认塞人。
 * 【硬性】画面描述写明空镜/无人物 → 一律不传角色图。
 */
export function shotSuggestsNoCharacterRefs(shot: ShotSearchFields): boolean {
  if (shotDescriptionSuggestsEmptyCast(shot)) return true;

  const blob = buildDirectorShotAssetSearchBlob(shot);
  if (!blob.trim()) return true;
  if (shotSuggestsPersonPresent(shot)) return false;

  const emptyCue =
    /空镜|空场景|无人物|无人出镜|无人脸|只有风景|纯风景|纯环境|建置空镜|纯空镜|establishing(?:\s*shot)?|empty\s*(?:set|scene)|no\s*(?:people|characters|cast|figures)/i.test(
      blob,
    );
  if (emptyCue) return true;

  if (/大远景|远景|全景|wide\s*shot|extreme\s*wide/i.test(blob)) {
    // 仅景别远/全且无人物点名 → 视为可不传角色；若已点名角色则上面 personPresent 已拦下
    return true;
  }

  // 无任何人物线索 → 不传角色图
  return true;
}

function scoreAssetAgainstBlob(asset: OrderedRef, blob: string): number {
  const name = String(asset?.name || '').trim();
  if (!name || !blob) return 0;
  let score = nameMentionScore(asset, blob);
  if (asset.kind === 'scene') {
    for (const w of SCENE_LOC_WORDS) {
      if (name.includes(w) && blob.includes(w)) score += 12;
    }
    const core = name
      .replace(ROLE_PREFIX_RE, '')
      .replace(/[/|／｜].*$/u, '')
      .trim();
    for (let i = 0; i < core.length - 1; i++) {
      const bi = core.slice(i, i + 2);
      if (bi && blob.includes(bi)) score += 3;
    }
    const promptHead = String(asset.prompt || '')
      .replace(/无人物|空场景|九宫格.*$/u, '')
      .trim()
      .slice(0, 40);
    for (const w of SCENE_LOC_WORDS) {
      if (promptHead.includes(w) && blob.includes(w)) score += 6;
    }
  }
  if (asset.kind === 'character') {
    const gender = inferDirectorAssetGender(asset);
    if (gender === '男' && /男主|男生|少年|他\b|青年男|男人/.test(blob)) score += 16;
    if (gender === '女' && /女主|女生|少女|她\b|青年女|女人/.test(blob)) score += 16;
    if (/主角|角色|背影|侧影|剪影|身影|行走|跟拍|写真|人物/.test(blob)) score += 4;
  }
  return score;
}

/** 提示词写明有人但未点名具体角色时，只回退主角槽 / 默认男主女主名，禁止抓素材库第一人 */
function pickDefaultLeadCharacterIndices(
  chars: Array<{ a: OrderedRef; index: number; score: number }>,
  maxCount: number,
  leadAssetIds?: string[],
): number[] {
  if (!chars.length || maxCount <= 0) return [];
  const leadSet = new Set((leadAssetIds || []).map((id) => String(id || '').trim()).filter(Boolean));
  const pool = leadSet.size
    ? chars.filter((c) => leadSet.has(String(c.a.id || '').trim()))
    : chars.filter((c) => isDefaultLeadRoleName(String(c.a.name || '')));
  if (!pool.length) return [];
  const ranked = pool.map((c) => {
    const n = String(c.a.name || '');
    let bonus = 0;
    if (/男主/.test(n)) bonus += 40;
    if (/女主/.test(n)) bonus += 40;
    if (/主角/.test(n)) bonus += 12;
    return { index: c.index, bonus, order: c.index };
  });
  ranked.sort((a, b) => b.bonus - a.bonus || a.order - b.order);
  return ranked.slice(0, maxCount).map((x) => x.index);
}

/** 单镜最多绑定的角色参考图数（仅绑提示词分析出的出场角色） */
export const MAX_DIRECTOR_CHARACTER_IMAGE_REFS = 3;

export type MatchDirectorAssetOpts = {
  /** 有人声标志仅供调用方传入；是否传角色图一律看提示词人物线索 */
  hasHumanVoice?: boolean | null;
  /** 选角计划主角槽 id；未点名时只回退这些槽，禁止抓素材库/额外角色第一项 */
  leadAssetIds?: string[];
};

/**
 * 返回应绑定的资产下标（0-based，对应有图有序列表）。
 * - 角色：根据提示词分析——有人物线索才传角色图；空镜/无人物线索不传；不每镜默认塞人
 * - 场景：按描述打分取最佳 1 个
 * - 道具：仅在名称明确命中时附加
 */
export function matchDirectorAssetIndicesForShot(
  shot: ShotSearchFields,
  orderedRefs: Array<OrderedRef>,
  opts?: MatchDirectorAssetOpts,
): number[] {
  const blob = buildDirectorShotAssetSearchBlob(shot);
  const refs = orderedRefs || [];
  if (refs.length === 0) return [];

  const withImage = refs
    .map((a, index) => ({ a, index, score: blob ? scoreAssetAgainstBlob(a, blob) : 0 }))
    .filter((x) => !!String(x.a?.imageUrl || '').trim());

  const chars = withImage.filter((x) => x.a.kind === 'character' || x.a.kind === 'creature');
  const scenes = withImage.filter((x) => x.a.kind === 'scene');
  const props = withImage.filter((x) => x.a.kind === 'prop');

  const picked: number[] = [];
  void opts?.hasHumanVoice;
  const personPresent = shotSuggestsPersonPresent(shot);
  // 角色点名：画面描述 + 出场人物（避免最终提示词旧文案绑错）
  const castBlob = [String(shot['画面描述'] || '').trim(), String(shot['出场人物'] || '').trim()]
    .filter(Boolean)
    .join('\n');
  const namedHits = chars.filter((c) => nameMentionScore(c.a, castBlob) >= 12);
  // 画面写了具体角色名时，即使没有「人物/他」等泛线索也要绑，不能 skip
  const skipCast = shotSuggestsNoCharacterRefs(shot) && namedHits.length === 0;

  if (!skipCast && castBlob && chars.length > 0) {
    const charPicked: number[] = [];
    const wantMale = /男主/.test(castBlob);
    const wantFemale = /女主/.test(castBlob);
    const wantDuo = /双人|两人|二人|男主[与和及、,]\s*女主|女主[与和及、,]\s*男主/.test(castBlob);
    const hasExplicitLeadName = wantMale || wantFemale;
    const leadSet = new Set(
      (opts?.leadAssetIds || []).map((id) => String(id || '').trim()).filter(Boolean),
    );

    const isLeadSlot = (c: (typeof chars)[number]) => {
      const id = String(c.a.id || '').trim();
      if (leadSet.size && id && leadSet.has(id)) return true;
      return isDefaultLeadRoleName(String(c.a.name || ''));
    };

    const roleMatches = (c: (typeof chars)[number], role: 'male' | 'female') => {
      const n = String(c.a.name || '');
      const g = inferDirectorAssetGender(c.a);
      // 点名「男主/女主」只绑主角槽或名字带男主/女主的卡，不绑素材库额外男性/女性
      if (role === 'male') return /男主/.test(n) || (isLeadSlot(c) && g === '男');
      return /女主/.test(n) || (isLeadSlot(c) && g === '女');
    };

    const scoreOnDesc = (c: (typeof chars)[number]) => nameMentionScore(c.a, castBlob);

    // ① 画面点名男主/女主 → 只绑主角槽 / 名字带男主女主的卡
    if (hasExplicitLeadName) {
      const pickRole = (role: 'male' | 'female') => {
        const ranked = [...chars].sort((a, b) => scoreOnDesc(b) - scoreOnDesc(a));
        const hit = ranked.find((c) => roleMatches(c, role));
        if (hit && !charPicked.includes(hit.index)) charPicked.push(hit.index);
      };
      if (wantMale) pickRole('male');
      if (wantFemale) pickRole('female');
    }

    // ② 资产专名被画面描述 / 出场人物点名（不含性别泛分）
    if (charPicked.length === 0) {
      const charHits = chars
        .map((c) => ({ ...c, descScore: scoreOnDesc(c) }))
        .filter((x) => x.descScore >= 12)
        .sort((a, b) => b.descScore - a.descScore);
      for (const h of charHits) {
        if (charPicked.length >= MAX_DIRECTOR_CHARACTER_IMAGE_REFS) break;
        charPicked.push(h.index);
      }
    }

    // ③ 有人物线索但未点名：只回退主角槽，绝不取素材库第一人
    if (charPicked.length === 0 && personPresent) {
      const n = wantDuo ? Math.min(2, chars.length) : 1;
      for (const idx of pickDefaultLeadCharacterIndices(chars, n, opts?.leadAssetIds)) {
        charPicked.push(idx);
      }
    }

    for (const idx of charPicked) picked.push(idx);
  }

  // 场景：有描述时按分取最佳；无描述时留给批量匹配沿用邻近镜
  if (blob) {
    const sceneHits = scenes.filter((x) => x.score >= 8).sort((a, b) => b.score - a.score);
    if (sceneHits.length > 0) {
      picked.push(sceneHits[0].index);
    } else if (scenes.length === 1) {
      picked.push(scenes[0].index);
    } else if (scenes.length > 0) {
      const best = [...scenes].sort((a, b) => b.score - a.score)[0];
      if (best && best.score >= 4) picked.push(best.index);
    }
  }

  // 道具：明确命中才加
  if (blob) {
    for (const p of props) {
      if (p.score >= 24) picked.push(p.index);
    }
  }

  // 稳定顺序：按 orderedRefs 下标
  return [...new Set(picked)].sort((a, b) => a - b);
}

const MAX_DIRECTOR_MV_VIDEO_CAST_IMAGES = 2;

/**
 * MV 出片本镜角色 id：勾选优先；否则按点名/主角槽匹配。
 * 始终返回数组（可空）。空数组=本镜不传角色图，禁止再按 @图片1 回退素材库第一人。
 */
export function resolveDirectorShotCastAssetIds(
  shot: ShotSearchFields,
  orderedRefs: Array<OrderedRef>,
  opts?: {
    castAssetIds?: string[];
    leadAssetIds?: string[];
    emptyShot?: boolean;
    max?: number;
  },
): string[] {
  const max = Math.max(1, Math.min(MAX_DIRECTOR_CHARACTER_IMAGE_REFS, opts?.max ?? MAX_DIRECTOR_MV_VIDEO_CAST_IMAGES));
  if (opts?.emptyShot) return [];
  const refs = orderedRefs || [];
  const asCharacterId = (id: string) => {
    const hit = refs.find((a) => String(a?.id || '').trim() === id && a?.kind === 'character');
    return hit && String(hit.imageUrl || '').trim() ? id : '';
  };
  if (Array.isArray(opts?.castAssetIds)) {
    return [
      ...new Set(
        opts!.castAssetIds!.map((id) => asCharacterId(String(id || '').trim())).filter(Boolean),
      ),
    ].slice(0, max);
  }
  return [
    ...new Set(
      matchDirectorAssetIndicesForShot(shot, refs, { leadAssetIds: opts?.leadAssetIds })
        .map((i) => refs[i])
        .filter((a) => a?.kind === 'character' && String(a.id || '').trim() && String(a.imageUrl || '').trim())
        .map((a) => String(a.id)),
    ),
  ].slice(0, max);
}

/**
 * 批量匹配：场景未命中时沿用邻近镜场景；角色按各镜画面描述点名匹配（无人声亦可有人物沉默戏）。
 */
export function matchDirectorShotsAssetIndices(
  shots: DirectorShot[],
  orderedRefs: Array<OrderedRef>,
  opts?: {
    hasHumanVoiceByShot?: Array<boolean | null | undefined>;
    leadAssetIds?: string[];
  },
): number[][] {
  const refs = orderedRefs || [];
  const voiceFlags = opts?.hasHumanVoiceByShot || [];

  const base = (shots || []).map((shot, i) =>
    matchDirectorAssetIndicesForShot(shot, refs, {
      hasHumanVoice: voiceFlags[i],
      leadAssetIds: opts?.leadAssetIds,
    }),
  );

  // 正向：仅沿用上一镜场景（不补全员角色）；当前镜无画面描述时不沿用，避免空描述整表同场景
  let lastSceneIdx: number | null = null;
  const forward = base.map((indices, shotI) => {
    let next = [...indices];
    const sceneIdx = next.find((i) => refs[i]?.kind === 'scene');
    const shotBlob = buildDirectorShotAssetSearchBlob(shots[shotI] || {});
    if (sceneIdx != null) lastSceneIdx = sceneIdx;
    else if (lastSceneIdx != null && shotBlob.trim()) next.push(lastSceneIdx);
    return [...new Set(next)].sort((a, b) => a - b);
  });

  // 反向：开头几镜尚未命中场景时，用后续最近场景回填（仅对已有画面描述的镜）
  let nextSceneIdx: number | null = null;
  for (let i = forward.length - 1; i >= 0; i--) {
    const hasScene = forward[i].some((idx) => refs[idx]?.kind === 'scene');
    const shotBlob = buildDirectorShotAssetSearchBlob(shots[i] || {});
    if (hasScene) {
      nextSceneIdx = forward[i].find((idx) => refs[idx]?.kind === 'scene') ?? nextSceneIdx;
    } else if (nextSceneIdx != null && shotBlob.trim()) {
      forward[i] = [...new Set([...forward[i], nextSceneIdx])].sort((a, b) => a - b);
    }
  }

  // 覆盖：每个有图场景至少绑定到一镜（避免场景库 5 个只用到 3～4 个）
  const allSceneIdx = refs
    .map((a, index) => ({ a, index }))
    .filter((x) => x.a.kind === 'scene' && !!String(x.a.imageUrl || '').trim())
    .map((x) => x.index);
  if (allSceneIdx.length > 0 && forward.length > 0) {
    const usage = new Map<number, number[]>();
    for (const si of allSceneIdx) usage.set(si, []);
    forward.forEach((indices, shotI) => {
      for (const idx of indices) {
        if (refs[idx]?.kind === 'scene' && usage.has(idx)) usage.get(idx)!.push(shotI);
      }
    });
    const unused = allSceneIdx.filter((si) => (usage.get(si) || []).length === 0);
    for (let u = 0; u < unused.length; u++) {
      const sceneIdx = unused[u];
      // 优先占用「使用次数最多」的场景所在镜，或均匀空位
      let bestShot = Math.min(forward.length - 1, Math.floor(((u + 0.5) * forward.length) / unused.length));
      let bestOveruse = -1;
      for (let shotI = 0; shotI < forward.length; shotI++) {
        const curScene = forward[shotI].find((idx) => refs[idx]?.kind === 'scene');
        const over = curScene != null ? (usage.get(curScene) || []).length : 999;
        if (over > bestOveruse) {
          bestOveruse = over;
          bestShot = shotI;
        }
      }
      const prevScene = forward[bestShot].find((idx) => refs[idx]?.kind === 'scene');
      if (prevScene != null) {
        const list = usage.get(prevScene) || [];
        usage.set(
          prevScene,
          list.filter((i) => i !== bestShot),
        );
      }
      forward[bestShot] = [
        ...new Set([
          ...forward[bestShot].filter((idx) => refs[idx]?.kind !== 'scene'),
          sceneIdx,
        ]),
      ].sort((a, b) => a - b);
      usage.get(sceneIdx)!.push(bestShot);
    }
  }

  return forward;
}

/** 去掉提示词中已有的 @图片N / @ImageN 及旧式绑定尾巴，避免与确定性绑定冲突 */
export function stripDirectorImageMentions(prompt: string): string {
  return String(prompt || '')
    .replace(/@(?:图片|Image)\s*\d+(?:\s*作为第\d+张参考图[^。；;]*)?/gi, '')
    .replace(/@(?:图片|Image)\s*\d+(?:\s*作为[^，,。；;]*)?/gi, '')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/\s*([，,。；;])\s*/g, '$1')
    .replace(/^[，,。；;\s]+|[，,。；;\s]+$/g, '')
    .trim();
}

export type ApplyDirectorShotBindingOpts = {
  styleUrl?: string | null;
};

function buildShotPromptBody(prompt: string, shot: ShotSearchFields): string {
  const raw = String(prompt || '').trim();
  return (
    stripDirectorImageMentions(raw) ||
    stripDirectorImageMentions(
      [
        shot['画面描述'],
        composeDirectorCinematicLensPromptBlock({
          angle: shot['镜头角度'],
          focal: shot['焦距'],
          size: shot['景别'],
          cameraMove: shot['运镜'],
          mode: 'video',
        }),
        shot['光影氛围'] ? `光影氛围：${shot['光影氛围']}` : '',
        shot['对白旁白'] ? `对白/旁白：${shot['对白旁白']}` : '',
        shot['音效'] ? `音效：${shot['音效']}` : '',
      ]
        .filter(Boolean)
        .join('。'),
    )
  );
}

/**
 * 用指定有序资产下标（0-based）写入最终提示词的 @图片N 绑定。
 * 本镜连着编号：风格图（若有）为第1张，再按场景→角色→道具→生物。
 * 主体定义 / 画风会写明每样东西参考第几张图。
 */
export function applyDirectorShotAssetBindingIndices(
  prompt: string,
  shot: ShotSearchFields & Partial<Pick<DirectorShot, '最终提示词'>>,
  orderedRefs: Array<Pick<DirectorAsset, 'id' | 'name' | 'kind' | 'imageUrl' | 'prompt' | 'gender'>>,
  indices: number[],
  opts?: ApplyDirectorShotBindingOpts,
): string {
  const refs = orderedRefs || [];
  const uniq = [...new Set((indices || []).filter((i) => Number.isFinite(i) && i >= 0 && i < refs.length))];
  const boundAssets = uniq.map((i) => refs[i]).filter(Boolean);
  const items = buildDirectorShotRefItems({
    styleUrl: opts?.styleUrl,
    boundAssets,
  });
  let body = buildShotPromptBody(prompt, shot);
  if (items.length === 0) {
    return body || String(prompt || '').trim();
  }
  body = annotateDirectorPromptRefNumbers(body, items);
  const clause = items.map(formatDirectorShotRefBindingClause).join('，');
  if (!body) return clause;
  const sep = /[。.!？?]$/.test(body) ? '' : '。';
  return `${body}${sep}${clause}`;
}

/**
 * 将匹配到的角色/场景/道具确定性写入最终提示词。
 * - 有匹配：剥离旧 @图片N 后追加正确绑定
 * - 无匹配：剥离旧绑定，保留正文（纯空镜不再残留角色 @图片）
 */
export function bindDirectorShotAssetRefs(
  prompt: string,
  shot: ShotSearchFields & Partial<Pick<DirectorShot, '最终提示词'>>,
  orderedRefs: Array<Pick<DirectorAsset, 'id' | 'name' | 'kind' | 'imageUrl' | 'prompt' | 'gender'>>,
  opts?: MatchDirectorAssetOpts & ApplyDirectorShotBindingOpts,
): string {
  const refs = orderedRefs || [];
  const indices = matchDirectorAssetIndicesForShot(shot, refs, opts);
  return applyDirectorShotAssetBindingIndices(prompt, shot, refs, indices, {
    styleUrl: opts?.styleUrl,
  });
}

/** 批量为多镜绑定资产引用（含场景沿用；可按歌段有人声标志跳过角色） */
export function bindDirectorShotsAssetRefs(
  shots: DirectorShot[],
  orderedRefs: Array<Pick<DirectorAsset, 'id' | 'name' | 'kind' | 'imageUrl' | 'prompt' | 'gender'>>,
  opts?: {
    hasHumanVoiceByShot?: Array<boolean | null | undefined>;
    styleUrl?: string | null;
    leadAssetIds?: string[];
  },
): DirectorShot[] {
  const refs = orderedRefs || [];
  const indexLists = matchDirectorShotsAssetIndices(shots || [], refs, opts);
  return (shots || []).map((shot, i) => {
    const prompt = String(shot['最终提示词'] || '').trim();
    if (!prompt) return shot;
    const indices = indexLists[i] || [];
    const next = applyDirectorShotAssetBindingIndices(prompt, shot, refs, indices, {
      styleUrl: opts?.styleUrl,
    });
    if (next === prompt) return shot;
    return { ...shot, 最终提示词: next };
  });
}

/**
 * 对整份导演状态重跑资产绑定（不调用 LLM）。
 * 用于修复已合成但漏写 @图片N 的提示词。
 */
export function rebindDirectorPipelineAssetRefs(
  state: {
    shots: DirectorShot[];
    assets: {
      characters: DirectorAsset[];
      scenes: DirectorAsset[];
      props: DirectorAsset[];
      creatures?: DirectorAsset[];
    };
    mvCastPlan?: DirectorPipelineState['mvCastPlan'];
    stylePresetId?: string | null;
    styleReferenceImageUrl?: string | null;
  },
  opts?: { hasHumanVoiceByShot?: Array<boolean | null | undefined>; styleUrl?: string | null },
): { shots: DirectorShot[]; changed: boolean } {
  const orderedRefs = [
    ...(state.assets?.characters || []),
    ...(state.assets?.scenes || []),
    ...(state.assets?.props || []),
    ...(state.assets?.creatures || []),
  ].filter((a) => String(a?.imageUrl || '').trim());
  const styleUrl =
    String(opts?.styleUrl || '').trim() ||
    resolveDirectorStyleReferenceImageUrl(state.stylePresetId, state.styleReferenceImageUrl);

  const prev = state.shots || [];
  const shots = bindDirectorShotsAssetRefs(prev, orderedRefs, {
    ...opts,
    styleUrl,
    leadAssetIds: listDirectorMvLeadAssetIds(state),
  });
  const changed = shots.some((s, i) => s['最终提示词'] !== prev[i]?.['最终提示词']);
  return { shots, changed };
}

/** 供 LLM 用户提示：每镜建议引用哪些图片（含性别） */
export function buildDirectorShotAssetHintLines(
  shots: DirectorShot[],
  orderedRefs: Array<Pick<DirectorAsset, 'id' | 'name' | 'kind' | 'imageUrl' | 'prompt' | 'gender'>>,
  opts?: {
    hasHumanVoiceByShot?: Array<boolean | null | undefined>;
    styleUrl?: string | null;
    leadAssetIds?: string[];
  },
): string {
  const lines: string[] = [];
  (shots || []).forEach((shot, i) => {
    const no = String(shot['镜号'] || i + 1);
    const indices = matchDirectorAssetIndicesForShot(shot, orderedRefs, {
      hasHumanVoice: opts?.hasHumanVoiceByShot?.[i],
      leadAssetIds: opts?.leadAssetIds,
    });
    const items = buildDirectorShotRefItems({
      styleUrl: opts?.styleUrl,
      boundAssets: indices.map((idx) => orderedRefs[idx]).filter(Boolean),
    });
    if (items.length === 0) {
      lines.push(
        shotSuggestsNoCharacterRefs(shot)
          ? `镜${no}：空镜/未点名角色（可只绑场景；有人物背影/行走时请在画面描述点名）`
          : `镜${no}：无匹配资产（勿乱加 @图片N）`,
      );
      return;
    }
    const parts = items.map((it) => {
      const kind =
        it.role === 'style' ? '风格' : directorAssetKindLabel(it.role);
      return `第${it.n}张=@图片${it.n}（${kind}·${it.name}·性别:${it.gender || '未知'}）`;
    });
    lines.push(`镜${no}：必须写明每样东西参考第几张图，并引用 ${parts.join('、')}`);
  });
  return lines.join('\n') || '（无）';
}
