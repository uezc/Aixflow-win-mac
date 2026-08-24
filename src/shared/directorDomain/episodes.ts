/**
 * 小说/长剧本 → 规则分集（零成本、本地、不调用大模型）
 *
 * 策略（两级）：
 * 1) 标题标记：行首「第N集/章/回/部/卷/幕」或「Chapter N」等 → 按标题切开（章与集同级）
 * 2) 无可用标题：按篇幅约 4500 字切，尽量落在段落边界
 */

import { dramaNewId } from './ids.js';
import type { DramaDirectorSession, DramaEpisode } from './types.js';

/** 每集目标上限（无标题时的默认） */
export const DRAMA_EPISODE_MAX_CHARS = 4500;
/** 凑够这么多字才允许在段界切开 */
export const DRAMA_EPISODE_MIN_CHARS = 400;
/** 标题之间过短则跳过该空壳段 */
const MIN_MARKER_CHUNK_CHARS = 40;

/**
 * 行首标题（章=集=一级；支持英文 Chapter）
 * 用 (^|\\n) 锚定，降低正文误切
 */
const TITLE_AT_LINE =
  /(?:^|\n)[ \t]*((?:【[ \t]*)?(?:第[零〇一二三四五六七八九十百千万两\d]+[集章节回部卷幕]|Chapter[ \t]+\d+|CHAPTER[ \t]+\d+)(?:[ \t]*】)?(?:[ \t]*[：:\-—–]?[ \t]*[^\n]{0,40})?)/giu;

function cleanTitle(raw: string, fallbackNo: number): string {
  const t = String(raw || '')
    .replace(/^【\s*|\s*】$/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 48);
  return t || `第${fallbackNo}集`;
}

function makeEpisode(
  episode_no: number,
  title: string,
  text: string,
  partial?: Partial<DramaEpisode>,
): DramaEpisode {
  return {
    episode_id: partial?.episode_id || dramaNewId('ep'),
    episode_no,
    title: cleanTitle(title, episode_no),
    text: String(text || '').trim(),
    analyzed: !!partial?.analyzed,
    updated_at: partial?.updated_at || Date.now(),
  };
}

/** 按「第X章/集」等标题行切分（章=集=一级） */
export function splitByChapterMarkers(source: string): DramaEpisode[] {
  const text = String(source || '').replace(/^\uFEFF/, '');
  if (!text.trim()) return [];

  const matches: { index: number; title: string }[] = [];
  const re = new RegExp(TITLE_AT_LINE.source, TITLE_AT_LINE.flags);
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const full = m[0] || '';
    const title = String(m[1] || '').trim();
    if (!title) continue;
    const index = m.index + (full.startsWith('\n') ? 1 : 0);
    if (matches.length && index <= matches[matches.length - 1].index) continue;
    matches.push({ index, title });
  }

  if (matches.length < 1) return [];

  // 标题前的序言并入第 1 集，避免丢掉书名页/引子
  if (matches[0].index > 0) {
    matches[0] = { ...matches[0], index: 0 };
  }

  const out: DramaEpisode[] = [];
  for (let i = 0; i < matches.length; i++) {
    const start = matches[i].index;
    const end = i + 1 < matches.length ? matches[i + 1].index : text.length;
    const chunk = text.slice(start, end).trim();
    if (chunk.length < MIN_MARKER_CHUNK_CHARS) continue;
    out.push(makeEpisode(out.length + 1, matches[i].title, chunk));
  }
  // 仅一集（如「第一集」整本）也视为有效分集；多集至少 1 条有效正文
  return out.length >= 1 ? out : [];
}

/** 无标题时按长度切成「第N集」 */
export function splitByLength(
  source: string,
  maxChars = DRAMA_EPISODE_MAX_CHARS,
): DramaEpisode[] {
  const text = String(source || '').replace(/^\uFEFF/, '').trim();
  if (!text) return [];
  if (text.length <= maxChars) {
    return [makeEpisode(1, '第1集', text)];
  }

  const paras = text.split(/\n{2,}/);
  const chunks: string[] = [];
  let buf = '';
  const flush = () => {
    const t = buf.trim();
    if (t) chunks.push(t);
    buf = '';
  };
  for (const p of paras) {
    const next = buf ? `${buf}\n\n${p}` : p;
    if (next.length > maxChars && buf.length >= DRAMA_EPISODE_MIN_CHARS) {
      flush();
      buf = p;
    } else {
      buf = next;
    }
  }
  flush();

  const flat: string[] = [];
  for (const c of chunks) {
    if (c.length <= maxChars * 1.35) {
      flat.push(c);
      continue;
    }
    for (let i = 0; i < c.length; i += maxChars) {
      flat.push(c.slice(i, i + maxChars));
    }
  }

  return flat.map((t, i) => makeEpisode(i + 1, `第${i + 1}集`, t));
}

/** 入库分集：标题优先（章/集同级 + Chapter，含单集「第一集」），否则约 4500 字 */
export function splitNovelIntoEpisodes(source: string): DramaEpisode[] {
  const byChapter = splitByChapterMarkers(source);
  if (byChapter.length >= 1) return byChapter;
  return splitByLength(source);
}

export function createEmptyDramaEpisode(partial?: Partial<DramaEpisode>): DramaEpisode {
  const no = Math.max(1, Number(partial?.episode_no) || 1);
  return makeEpisode(no, partial?.title || `第${no}集`, partial?.text || '', partial);
}

export function normalizeDramaEpisodes(raw: unknown): DramaEpisode[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((item, i) => {
    const v = (item && typeof item === 'object' ? item : {}) as Partial<DramaEpisode>;
    return createEmptyDramaEpisode({
      ...v,
      episode_no: Number(v.episode_no) || i + 1,
    });
  });
}

/** 去掉「· 第N集」，避免项目名被某一次单集分析写成剧名+集数 */
const EPISODE_TITLE_SUFFIX =
  /(?:\s*[·•\-—–]\s*)?第[零〇一二三四五六七八九十百千万两\d]+集\s*$/u;

export function stripDramaEpisodeTitleSuffix(name: string): string {
  return String(name || '')
    .replace(EPISODE_TITLE_SUFFIX, '')
    .trim();
}

export function resolveDramaProjectSeriesName(incoming: string, prev: string): string {
  const a = stripDramaEpisodeTitleSuffix(incoming);
  const b = stripDramaEpisodeTitleSuffix(prev);
  if (b && (!a || /^第.+集$/.test(a))) return b;
  return a || b || '未命名短剧';
}

export function dramaStudioSeriesName(session: DramaDirectorSession): string {
  return stripDramaEpisodeTitleSuffix(session.bible?.project?.name || '') || 'AI短剧导演';
}

/** 顶栏标题：剧名；素材准备为全集共用仓库不挂集数，其余阶段挂当前集 */
export function dramaStudioNodeTitle(session: DramaDirectorSession): string {
  const series = dramaStudioSeriesName(session);
  const phase = String(session.meta?.phase || '').trim();
  // 素材准备 = 本剧圣经仓库（人物/场景/道具/生物），不分集（含旧 phase bible）
  if (phase === 'assets' || phase === 'bible') return series;
  const ep =
    (session.episodes || []).find((e) => e.episode_id === session.active_episode_id) || null;
  const epTitle = String(ep?.title || '').trim();
  if (!epTitle || series === epTitle || series.endsWith(epTitle)) return series;
  return `${series} · ${epTitle}`;
}

/**
 * 单集分析用正文：优先当前集 episodes[].text。
 * 禁止优先 meta.source_script（常为上一集残留），否则选第1集却分析成第2集。
 */
export function dramaActiveEpisodeSourceText(
  session:
    | Partial<Pick<DramaDirectorSession, 'episodes' | 'active_episode_id' | 'meta'>>
    | null
    | undefined,
  episodeId?: string,
): string {
  if (!session) return '';
  const epId = String(episodeId || session.active_episode_id || '').trim();
  const ep = (session.episodes || []).find((e) => e.episode_id === epId);
  const fromEp = String(ep?.text || '').trim();
  if (fromEp) return fromEp;
  // 无分集正文时才回退（兼容未分集的旧数据）
  return String(session.meta?.source_script || '').trim();
}
