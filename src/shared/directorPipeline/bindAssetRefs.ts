import type { DirectorAsset, DirectorShot } from './schema.js';
import { composeDirectorCinematicLensPromptBlock } from './cinematicCameraLanguage.js';

const ROLE_PREFIX_RE = /^(男主|女主|主角|配角|角色|人物|场景|地点|道具)/;

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** 从名称/设定串推断性别：男 | 女 | 场景 | 道具 | 未知 */
export function inferDirectorAssetGender(
  asset: Pick<DirectorAsset, 'name' | 'kind' | 'prompt' | 'gender'> | null | undefined,
): string {
  if (!asset) return '未知';
  if (asset.kind === 'scene') return '场景';
  if (asset.kind === 'prop') return '道具';
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
  return '参考';
}

/** @图片N 绑定说明：第几张、类型、名称、性别、用途 */
export function formatDirectorImageBindingClause(
  n: number,
  asset: Pick<DirectorAsset, 'name' | 'kind' | 'prompt'> | null | undefined,
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
  >
>;

type OrderedRef = Pick<DirectorAsset, 'name' | 'kind' | 'imageUrl' | 'prompt'>;

/**
 * 从镜头字段拼检索文本：以画面描述 + 最终提示词为主。
 * 不对白/歌词/音效参与匹配，避免歌词误命中角色名、也不因歌词把全员塞进空镜。
 */
export function buildDirectorShotAssetSearchBlob(shot: ShotSearchFields): string {
  return [
    shot['画面描述'],
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
  let score = 0;
  for (const alias of directorAssetMatchAliases(name)) {
    if (alias.length < 2) continue;
    if (blobMentionsAlias(blob, alias)) score += Math.min(40, alias.length * 8);
  }
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

/** 提示词写明有人但未点名具体角色时，回退已选主角（最多 2） */
function pickDefaultLeadCharacterIndices(
  chars: Array<{ a: OrderedRef; index: number; score: number }>,
  maxCount: number,
): number[] {
  if (!chars.length || maxCount <= 0) return [];
  const ranked = chars.map((c) => {
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

  const chars = withImage.filter((x) => x.a.kind === 'character');
  const scenes = withImage.filter((x) => x.a.kind === 'scene');
  const props = withImage.filter((x) => x.a.kind === 'prop');

  const picked: number[] = [];
  void opts?.hasHumanVoice;
  const skipCast = shotSuggestsNoCharacterRefs(shot);
  const personPresent = shotSuggestsPersonPresent(shot);
  // 角色点名只看画面描述（避免最终提示词旧文案把男主/女主绑错）
  const castBlob = String(shot['画面描述'] || '').trim();

  if (!skipCast && castBlob && chars.length > 0) {
    const charPicked: number[] = [];
    const wantMale = /男主/.test(castBlob);
    const wantFemale = /女主/.test(castBlob);
    const wantDuo = /双人|两人|二人|男主[与和及、,]\s*女主|女主[与和及、,]\s*男主/.test(castBlob);
    const hasExplicitLeadName = wantMale || wantFemale;

    const roleMatches = (c: (typeof chars)[number], role: 'male' | 'female') => {
      const n = String(c.a.name || '');
      const g = inferDirectorAssetGender(c.a);
      if (role === 'male') return /男主/.test(n) || g === '男';
      return /女主/.test(n) || g === '女';
    };

    const scoreOnDesc = (c: (typeof chars)[number]) =>
      scoreAssetAgainstBlob(c.a, castBlob);

    // ① 画面点名男主/女主 → 只绑被点到的人
    if (hasExplicitLeadName) {
      const pickRole = (role: 'male' | 'female') => {
        const ranked = [...chars].sort((a, b) => scoreOnDesc(b) - scoreOnDesc(a));
        const hit = ranked.find((c) => roleMatches(c, role));
        if (hit && !charPicked.includes(hit.index)) charPicked.push(hit.index);
      };
      if (wantMale) pickRole('male');
      if (wantFemale) pickRole('female');
    }

    // ② 未点名主角称呼，但资产名被描述命中
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

    // ③ 有人物线索但未点名：默认 1 个；双人戏 2 个
    if (charPicked.length === 0 && personPresent) {
      const n = wantDuo ? Math.min(2, chars.length) : 1;
      for (const idx of pickDefaultLeadCharacterIndices(chars, n)) {
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

/**
 * 批量匹配：场景未命中时沿用邻近镜场景；角色按各镜画面描述点名匹配（无人声亦可有人物沉默戏）。
 */
export function matchDirectorShotsAssetIndices(
  shots: DirectorShot[],
  orderedRefs: Array<OrderedRef>,
  opts?: { hasHumanVoiceByShot?: Array<boolean | null | undefined> },
): number[][] {
  const refs = orderedRefs || [];
  const voiceFlags = opts?.hasHumanVoiceByShot || [];

  const base = (shots || []).map((shot, i) =>
    matchDirectorAssetIndicesForShot(shot, refs, {
      hasHumanVoice: voiceFlags[i],
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

function buildBindingClause(
  orderedRefs: Array<Pick<DirectorAsset, 'name' | 'kind' | 'imageUrl' | 'prompt'>>,
  indices: number[],
): string {
  return indices
    .map((idx) => formatDirectorImageBindingClause(idx + 1, orderedRefs[idx]))
    .filter(Boolean)
    .join('，');
}

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
 * 用于镜头行参考图卡槽替换；indices 为空时仅剥离旧绑定。
 */
export function applyDirectorShotAssetBindingIndices(
  prompt: string,
  shot: ShotSearchFields & Partial<Pick<DirectorShot, '最终提示词'>>,
  orderedRefs: Array<Pick<DirectorAsset, 'name' | 'kind' | 'imageUrl' | 'prompt'>>,
  indices: number[],
): string {
  const refs = orderedRefs || [];
  const uniq = [...new Set((indices || []).filter((i) => Number.isFinite(i) && i >= 0 && i < refs.length))];
  const body = buildShotPromptBody(prompt, shot);
  if (uniq.length === 0) {
    return body || String(prompt || '').trim();
  }
  const clause = buildBindingClause(refs, uniq);
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
  orderedRefs: Array<Pick<DirectorAsset, 'name' | 'kind' | 'imageUrl' | 'prompt'>>,
  opts?: MatchDirectorAssetOpts,
): string {
  const refs = orderedRefs || [];
  const indices = matchDirectorAssetIndicesForShot(shot, refs, opts);
  return applyDirectorShotAssetBindingIndices(prompt, shot, refs, indices);
}

/** 批量为多镜绑定资产引用（含场景沿用；可按歌段有人声标志跳过角色） */
export function bindDirectorShotsAssetRefs(
  shots: DirectorShot[],
  orderedRefs: Array<Pick<DirectorAsset, 'name' | 'kind' | 'imageUrl' | 'prompt'>>,
  opts?: { hasHumanVoiceByShot?: Array<boolean | null | undefined> },
): DirectorShot[] {
  const refs = orderedRefs || [];
  const indexLists = matchDirectorShotsAssetIndices(shots || [], refs, opts);
  return (shots || []).map((shot, i) => {
    const prompt = String(shot['最终提示词'] || '').trim();
    if (!prompt) return shot;
    const indices = indexLists[i] || [];
    const next = applyDirectorShotAssetBindingIndices(prompt, shot, refs, indices);
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
    assets: { characters: DirectorAsset[]; scenes: DirectorAsset[]; props: DirectorAsset[] };
  },
  opts?: { hasHumanVoiceByShot?: Array<boolean | null | undefined> },
): { shots: DirectorShot[]; changed: boolean } {
  const orderedRefs = [
    ...(state.assets?.characters || []),
    ...(state.assets?.scenes || []),
    ...(state.assets?.props || []),
  ].filter((a) => String(a?.imageUrl || '').trim());

  const prev = state.shots || [];
  const shots = bindDirectorShotsAssetRefs(prev, orderedRefs, opts);
  const changed = shots.some((s, i) => s['最终提示词'] !== prev[i]?.['最终提示词']);
  return { shots, changed };
}

/** 供 LLM 用户提示：每镜建议引用哪些图片（含性别） */
export function buildDirectorShotAssetHintLines(
  shots: DirectorShot[],
  orderedRefs: Array<Pick<DirectorAsset, 'name' | 'kind' | 'imageUrl' | 'prompt'>>,
  opts?: { hasHumanVoiceByShot?: Array<boolean | null | undefined> },
): string {
  const lines: string[] = [];
  (shots || []).forEach((shot, i) => {
    const no = String(shot['镜号'] || i + 1);
    const indices = matchDirectorAssetIndicesForShot(shot, orderedRefs, {
      hasHumanVoice: opts?.hasHumanVoiceByShot?.[i],
    });
    if (indices.length === 0) {
      lines.push(
        shotSuggestsNoCharacterRefs(shot)
          ? `镜${no}：空镜/未点名角色（可只绑场景；有人物背影/行走时请在画面描述点名）`
          : `镜${no}：无匹配资产（勿乱加 @图片N）`,
      );
      return;
    }
    const parts = indices.map((idx) => {
      const a = orderedRefs[idx];
      const kind = directorAssetKindLabel(a?.kind);
      const gender = inferDirectorAssetGender(a);
      return `第${idx + 1}张=@图片${idx + 1}（${kind}·${a?.name || ''}·性别:${gender}）`;
    });
    lines.push(`镜${no}：必须写明并引用 ${parts.join('、')}`);
  });
  return lines.join('\n') || '（无）';
}
