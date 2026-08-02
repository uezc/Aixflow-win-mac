/**
 * MV 人声/乐句时间轴：Whisper 片段、用户歌词校准、以及按视频模型时长档切镜。
 * 切镜分两档位：长镜 10/15s、短镜严格 4/5/6s（含纯音乐；句间大间隔拆段）。
 */

export type DirectorMvLyricSegmentStatus = 'idle' | 'transcribing' | 'ready' | 'error';

/** 长镜（10–15s）/ 短镜（4–6s） */
export type DirectorMvClipLengthMode = 'long' | 'short';

export interface DirectorMvLyricSegment {
  id: string;
  text: string;
  startSec: number;
  endSec: number;
  /** 无人声过门/补齐空隙 */
  instrumental?: boolean;
}

export interface DirectorLyricShotPack {
  startSec: number;
  endSec: number;
  durationSec: number;
  text: string;
  segmentIds: string[];
  /** 命中的模型时长档（秒） */
  tierSec?: number;
  /** 该镜包无可用人声歌词（前奏/间奏/尾奏/纯音乐） */
  instrumental?: boolean;
}

/** 长镜：LTX 10/15 + Grok 10/15 */
export const DIRECTOR_MV_CLIP_DURATION_TIERS_LONG = [10, 15] as const;
/** 短镜：优先 5/6，对不上时可落 4；以歌词小句为准 */
export const DIRECTOR_MV_CLIP_DURATION_TIERS_SHORT = [4, 5, 6] as const;
/**
 * 全量友好档（兼容旧调用）；新逻辑请用 resolveMvClipDurationTiers。
 */
export const DIRECTOR_MV_CLIP_DURATION_TIERS = [4, 5, 6, 10, 15] as const;

export function resolveMvClipDurationTiers(
  mode?: DirectorMvClipLengthMode | string | null,
): { tiers: readonly number[]; preferredSec: number; mode: DirectorMvClipLengthMode } {
  if (String(mode || '').trim() === 'long') {
    return {
      mode: 'long',
      tiers: DIRECTOR_MV_CLIP_DURATION_TIERS_LONG,
      preferredSec: 10,
    };
  }
  return {
    mode: 'short',
    tiers: DIRECTOR_MV_CLIP_DURATION_TIERS_SHORT,
    preferredSec: 5,
  };
}

function clampSec(n: number): number {
  if (!Number.isFinite(n) || n < 0) return 0;
  return n;
}

function newSegId(i: number): string {
  return `ls-${i}-${Math.random().toString(36).slice(2, 7)}`;
}

const INSTRUMENTAL_LABELS = new Set([
  '（间奏）',
  '（尾奏）',
  '（全曲）',
  '（音乐中）',
  '(instrumental)',
  '(outro)',
  '(full)',
  '(music)',
  '间奏',
  '尾奏',
  '全曲',
  '音乐中',
  '纯音乐',
  '伴奏',
]);

/** 是否为「无人声」占位文案（非真实歌词） */
export function isDirectorInstrumentalLyricText(text: string | undefined | null): boolean {
  const t = String(text || '').trim();
  if (!t) return true;
  if (INSTRUMENTAL_LABELS.has(t)) return true;
  // Whisper 常见：整段只有「音乐中」/ Music
  if (/^[\(（]?(音乐中|纯音乐|伴奏|间奏|instrumental|music)[\)）]?$/i.test(t)) return true;
  // 拼接后的纯占位（如「音乐中 音乐中」「（间奏） （尾奏）」）
  const tokens = t.split(/[\s|/·•,，、]+/).filter(Boolean);
  if (
    tokens.length > 0 &&
    tokens.every((tok) => {
      const s = tok.trim();
      return (
        INSTRUMENTAL_LABELS.has(s) ||
        /^[\(（]?(音乐中|纯音乐|伴奏|间奏|尾奏|instrumental|music|outro)[\)）]?$/i.test(s)
      );
    })
  ) {
    return true;
  }
  return false;
}

/**
 * 非歌词元信息：歌名、词曲/编曲署名、台标/无关英文等。
 * 用于清洗识别分段展示，避免把「《歌名》词曲:xxx」当成歌词。
 */
export function isDirectorNonLyricMetaText(text: string | undefined | null): boolean {
  const t = String(text || '').trim();
  if (!t) return true;
  if (isDirectorInstrumentalLyricText(t)) return true;
  if (/^《[^》]{1,40}》$/.test(t)) return true;
  if (/^(词曲|作词|作曲|编曲|演唱|原唱|翻唱|监制|混音|出品|制作|作詞|作曲者|編曲)\s*[:：]/.test(t)) {
    return true;
  }
  // 整行几乎只有署名（无实质歌词句）
  if (
    /^(?:《[^》]+》\s*)?(?:词曲|作词|作曲|编曲|演唱|监制)[:：][^\n]{0,48}$/.test(t) &&
    !/[，。！？；、]/.test(t) &&
    t.replace(/《[^》]+》|(?:词曲|作词|作曲|编曲|演唱|监制)[:：]\S+/g, '').trim().length < 4
  ) {
    return true;
  }
  // 台标 / 版权 / 新闻水印（如 MING PAO CANADA）
  if (/ming\s*pao|toronto|all\s*rights|copyright|subscribe|www\.|\.com\b/i.test(t)) return true;
  if (/^[A-Z0-9\s|/.\-_]{10,}$/.test(t) && /[A-Z]{3,}/.test(t) && !/[a-z\u4e00-\u9fff]/.test(t)) {
    return true;
  }
  return false;
}

/** 去掉歌名、署名、无关信息，只保留可唱歌词 */
export function sanitizeDirectorLyricDisplayText(text: string | undefined | null): string {
  let t = String(text || '').trim();
  if (!t) return '';
  // 前置歌名 《xxx》
  t = t.replace(/^《[^》]{1,40}》\s*/g, '');
  // 行内歌名（夹在署名前后）
  t = t.replace(/《[^》]{1,40}》/g, ' ');
  // 词曲/编曲等署名块（人名通常 2–4 字；可紧挨下一段署名）
  t = t.replace(
    /(?:词曲|作词|作曲|编曲|演唱|原唱|翻唱|监制|混音|出品|制作人?|作詞|編曲|作词人|作曲人)\s*[:：]\s*(?:[\u4e00-\u9fff·•]{2,8}|[A-Za-z][A-Za-z.\s-]{1,24})/gi,
    ' ',
  );
  // 英文台标 / 水印
  t = t.replace(
    /\b(?:MING\s*PAO(?:\s*(?:CANADA|TORONTO|HONG\s*KONG))?|ALL\s*RIGHTS\s*RESERVED|COPYRIGHT)\b(?:\s*[|/]\s*[A-Z][A-Z\s]*)?/gi,
    ' ',
  );
  t = t.replace(/[|/]{2,}/g, ' ').replace(/\s+/g, ' ').trim();
  // 去掉残留的「词曲 编曲」光秃标签
  t = t.replace(/^(?:词曲|作词|作曲|编曲|演唱)\s+/g, '').trim();
  if (!t || isDirectorNonLyricMetaText(t) || isDirectorInstrumentalLyricText(t)) return '';
  return t;
}

/**
 * 清洗整段歌词脚本：去掉歌名、词曲/编曲/作词人等元信息行，只保留可唱歌词。
 * 用于歌词输入框默认脚本，以及识别/校准前预处理。
 */
export function stripDirectorLyricsScriptMeta(raw: string): string {
  const lines = String(raw || '').replace(/\r/g, '').split('\n');
  const out: string[] = [];
  for (const line of lines) {
    const rawLine = line.trim();
    if (!rawLine) continue;
    if (/^《[^》]{1,40}》$/.test(rawLine)) continue;
    if (
      /^(词曲|作词|作曲|编曲|演唱|原唱|翻唱|监制|混音|出品|制作|作詞|編曲|Lyricist|Composer|Arranger|Artist)\b/i.test(
        rawLine,
      )
    ) {
      continue;
    }
    if (isDirectorNonLyricMetaText(rawLine)) continue;
    const cleaned = sanitizeDirectorLyricDisplayText(rawLine);
    if (!cleaned) continue;
    out.push(cleaned);
  }
  return out.join('\n').trim();
}

/** 无 timed segments 时：按句读把整段歌词断成「一句一行」，避免过度切碎。 */
export function breakDirectorLyricTextIntoLines(raw: string): string {
  const text = String(raw || '').replace(/\r/g, '').trim();
  if (!text) return '';
  const seed = text.includes('\n')
    ? text
        .split('\n')
        .map((l) => l.trim())
        .filter(Boolean)
    : [text];
  const out: string[] = [];
  for (const blob of seed) {
    out.push(...breakDirectorLyricBlobIntoLines(blob));
  }
  return out.join('\n');
}

function breakDirectorLyricBlobIntoLines(blob: string): string[] {
  const t = String(blob || '').trim();
  if (!t) return [];

  // 强句读：。！？；… 及英文 !?
  if (/[。！？；…!?]/.test(t)) {
    const parts = t
      .split(/(?<=[。！？；…]+)|(?<=[!?]+)/)
      .map((x) => x.trim())
      .filter(Boolean);
    if (parts.length >= 2) return parts;
  }

  // 无强句读：逗号/顿号适度断行（偏长才拆，避免碎成词语）
  if (t.length > 18 && /[，、,]/.test(t)) {
    const parts = t
      .split(/[，、,]+/)
      .map((x) => x.trim())
      .filter((x) => x.length >= 2);
    const merged = mergeShortLyricParts(parts, 6, 18);
    if (merged.length >= 2) return merged;
  }

  // 纯中文长坨、无标点：按约句长软断（不拆英词）
  if (t.length > 20 && /[\u4e00-\u9fff]/.test(t) && !/[A-Za-z]{3,}/.test(t)) {
    return softWrapCjkLyricLine(t, 14);
  }

  // 英文长句：按词边界约 42 字符软断；短句/无空格整坨不动
  if (t.length > 56 && /\s/.test(t) && !/[\u4e00-\u9fff]/.test(t)) {
    return softWrapWordsLyricLine(t, 42);
  }

  return [t];
}

function mergeShortLyricParts(parts: string[], minLen: number, maxLen: number): string[] {
  const out: string[] = [];
  let buf = '';
  for (const p of parts) {
    if (!buf) {
      buf = p;
      continue;
    }
    const joiner = /[\u4e00-\u9fff]/.test(buf) || /[\u4e00-\u9fff]/.test(p) ? '' : ' ';
    // 只粘过短碎片；两边都已像半句时保持分行
    if (buf.length < minLen || (p.length < minLen && buf.length + p.length <= maxLen)) {
      buf = `${buf}${joiner}${p}`.replace(/\s+/g, ' ').trim();
    } else {
      out.push(buf);
      buf = p;
    }
  }
  if (buf) out.push(buf);
  return out;
}

function softWrapCjkLyricLine(text: string, target: number): string[] {
  const out: string[] = [];
  let i = 0;
  while (i < text.length) {
    if (text.length - i <= target + 4) {
      out.push(text.slice(i).trim());
      break;
    }
    let end = Math.min(text.length, i + target);
    // 在目标长度后半段找虚字/语气词，尽量落在其后
    const lo = i + Math.floor(target * 0.55);
    const hi = Math.min(text.length, i + target + 5);
    const softRel = text.slice(lo, hi).search(/[的了着过呢吗吧啊呀喔噢啦]/);
    if (softRel >= 0) end = lo + softRel + 1;
    if (end <= i) end = Math.min(text.length, i + target);
    out.push(text.slice(i, end).trim());
    i = end;
  }
  return out.filter(Boolean);
}

function softWrapWordsLyricLine(text: string, target: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const out: string[] = [];
  let buf = '';
  for (const w of words) {
    const next = buf ? `${buf} ${w}` : w;
    if (buf && next.length > target) {
      out.push(buf);
      buf = w;
    } else {
      buf = next;
    }
  }
  if (buf) out.push(buf);
  return out.length ? out : [text];
}

/**
 * ASR 转写 → 歌词框脚本：优先 timed segments（每段一行），
 * 否则对整段 text 句读断行；最后做署名清洗并保持一句一行。
 */
export function formatDirectorLyricsFromAsr(
  text?: string | null,
  segments?: Array<{ text?: string | null } | null> | null,
): string {
  const fromSegs = (segments || [])
    .map((s) => String(s?.text || '').trim())
    .filter(Boolean)
    .join('\n');
  const raw = fromSegs || breakDirectorLyricTextIntoLines(String(text || ''));
  if (!raw.trim()) return '';
  return stripDirectorLyricsScriptMeta(raw) || raw.trim();
}

/**
 * 每句歌词只归属一个镜头包（优先落在句首所在镜），避免短镜切开后同一句在多卡重复。
 */
function assignUniqueLyricTextsToPacks(
  packs: DirectorLyricShotPack[],
  segments: DirectorMvLyricSegment[],
): DirectorLyricShotPack[] {
  if (packs.length === 0) return packs;
  const bucket: string[][] = packs.map(() => []);
  const claimed = new Set<string>();

  for (const seg of segments) {
    if (isInstrumentalSeg(seg)) continue;
    const text = sanitizeDirectorLyricDisplayText(seg.text);
    if (!text) continue;
    const claimKey = String(seg.id || '').trim() || `${seg.startSec.toFixed(2)}:${text}`;
    if (claimed.has(claimKey)) continue;

    let startPack = -1;
    for (let i = 0; i < packs.length; i++) {
      const p = packs[i];
      if (seg.startSec >= p.startSec - 0.08 && seg.startSec < p.endSec - 0.05) {
        startPack = i;
        break;
      }
    }
    if (startPack < 0) {
      let bestI = -1;
      let bestOverlap = 0;
      for (let i = 0; i < packs.length; i++) {
        const p = packs[i];
        const overlap = Math.min(seg.endSec, p.endSec) - Math.max(seg.startSec, p.startSec);
        if (overlap > bestOverlap) {
          bestOverlap = overlap;
          bestI = i;
        }
      }
      if (bestI < 0 || bestOverlap < 0.12) continue;
      startPack = bestI;
    }

    claimed.add(claimKey);
    bucket[startPack].push(text);
  }

  return packs.map((p, i) => {
    const seen = new Set<string>();
    const parts: string[] = [];
    for (const t of bucket[i]) {
      const key = t.replace(/\s+/g, '').toLowerCase();
      if (!key || seen.has(key)) continue;
      seen.add(key);
      parts.push(t);
    }
    return {
      ...p,
      text: parts.join(' ').trim(),
      instrumental: parts.length === 0,
    };
  });
}

function isInstrumentalSeg(seg: Pick<DirectorMvLyricSegment, 'text' | 'instrumental'>): boolean {
  if (seg.instrumental === true) return true;
  const cleaned = sanitizeDirectorLyricDisplayText(seg.text);
  if (!cleaned) return true;
  return isDirectorInstrumentalLyricText(cleaned);
}

/** 取最接近的 MV 切镜时长档 */
export function pickNearestMvClipDurationTier(
  sec: number,
  tiers: readonly number[] = DIRECTOR_MV_CLIP_DURATION_TIERS,
): number {
  const list = (tiers || DIRECTOR_MV_CLIP_DURATION_TIERS).filter((t) => t > 0);
  if (list.length === 0) return 10;
  const s = Number.isFinite(sec) && sec > 0 ? sec : list[0];
  let best = list[0];
  let bestDiff = Math.abs(best - s);
  for (const t of list) {
    const d = Math.abs(t - s);
    if (d < bestDiff - 1e-9 || (Math.abs(d - bestDiff) < 1e-9 && t < best)) {
      best = t;
      bestDiff = d;
    }
  }
  return best;
}

/** 解析简易 LRC：`[mm:ss.xx]text` / `[mm:ss]` */
export function parseLrcToLyricSegments(raw: string, songDurationSec = 0): DirectorMvLyricSegment[] {
  const lines = String(raw || '').split(/\r?\n/);
  const tagged: Array<{ t: number; text: string }> = [];
  for (const line of lines) {
    const m = line.match(/^\[(\d{1,2}):(\d{2})(?:[.:](\d{1,3}))?\]\s*(.*)$/);
    if (!m) continue;
    const mm = Number(m[1]);
    const ss = Number(m[2]);
    const frac = m[3] ? Number(m[3].length <= 2 ? m[3] : m[3].slice(0, 3)) : 0;
    const fracSec =
      m[3] && m[3].length === 2 ? frac / 100 : m[3] && m[3].length === 1 ? frac / 10 : frac / 1000;
    const t = mm * 60 + ss + (Number.isFinite(fracSec) ? fracSec : 0);
    const text = String(m[4] || '').trim();
    if (!Number.isFinite(t)) continue;
    tagged.push({ t, text });
  }
  if (tagged.length === 0) return [];
  tagged.sort((a, b) => a.t - b.t);
  const songEnd = Math.max(
    songDurationSec > 0 ? songDurationSec : 0,
    tagged[tagged.length - 1].t + 4,
  );
  const out: DirectorMvLyricSegment[] = [];
  for (let i = 0; i < tagged.length; i++) {
    const startSec = clampSec(tagged[i].t);
    const next = tagged[i + 1]?.t;
    const endSec = clampSec(
      Number.isFinite(next) && (next as number) > startSec + 0.12
        ? (next as number)
        : Math.min(songEnd, startSec + 4),
    );
    if (endSec <= startSec + 0.05) continue;
    out.push({
      id: newSegId(i),
      text: tagged[i].text || (i === 0 ? '（间奏）' : ''),
      startSec,
      endSec,
      ...(tagged[i].text ? {} : { instrumental: true }),
    });
  }
  return coverSongWithLyricSegments(out, songEnd);
}

export function normalizeDirectorMvLyricSegments(raw: unknown): DirectorMvLyricSegment[] {
  if (!Array.isArray(raw)) return [];
  const out: DirectorMvLyricSegment[] = [];
  for (let i = 0; i < raw.length; i++) {
    const v = raw[i];
    if (!v || typeof v !== 'object') continue;
    const o = v as Record<string, unknown>;
    const startSec = clampSec(Number(o.startSec));
    const endSec = Number(o.endSec);
    if (!Number.isFinite(endSec) || endSec <= startSec + 0.05) continue;
    const rawText = String(o.text || '').trim();
    const text = sanitizeDirectorLyricDisplayText(rawText);
    const instrumental =
      o.instrumental === true || !text || isDirectorInstrumentalLyricText(text);
    out.push({
      id: String(o.id || '').trim() || newSegId(i),
      text,
      startSec,
      endSec: clampSec(endSec),
      ...(instrumental ? { instrumental: true } : {}),
    });
  }
  out.sort((a, b) => a.startSec - b.startSec || a.endSec - b.endSec);
  return out;
}

/**
 * 用空隙补齐 0 → songDuration，保证切满全曲；不在已有人声段中间切开。
 */
export function coverSongWithLyricSegments(
  segments: DirectorMvLyricSegment[],
  songDurationSec: number,
): DirectorMvLyricSegment[] {
  const songEnd = Math.max(0, Number(songDurationSec) || 0);
  const sorted = normalizeDirectorMvLyricSegments(segments);
  if (songEnd <= 0.05 && sorted.length === 0) return [];
  const endTarget = Math.max(songEnd, sorted.length ? sorted[sorted.length - 1].endSec : 0);
  if (sorted.length === 0) {
    return [
      {
        id: newSegId(0),
        text: '（全曲）',
        startSec: 0,
        endSec: Math.max(1, endTarget || 5),
        instrumental: true,
      },
    ];
  }
  const out: DirectorMvLyricSegment[] = [];
  let cursor = 0;
  for (let i = 0; i < sorted.length; i++) {
    const seg = sorted[i];
    if (seg.startSec > cursor + 0.15) {
      out.push({
        id: newSegId(1000 + i),
        text: cursor <= 0.05 ? '（前奏）' : '（间奏）',
        startSec: cursor,
        endSec: seg.startSec,
        instrumental: true,
      });
    }
    out.push({
      ...seg,
      startSec: Math.max(cursor, seg.startSec),
    });
    cursor = Math.max(cursor, seg.endSec);
  }
  if (endTarget > cursor + 0.15) {
    out.push({
      id: newSegId(9000),
      text: '（尾奏）',
      startSec: cursor,
      endSec: endTarget,
      instrumental: true,
    });
  }
  return out;
}

/** 去掉 LRC 时间戳，拆成可校准的歌词行 */
export function splitUserLyricLines(raw: string): string[] {
  const text = String(raw || '')
    .replace(/\[\d{1,2}:\d{2}(?:[.:]\d{1,3})?\]/g, '')
    .replace(/\r/g, '');
  const out: string[] = [];
  for (const line of text.split('\n')) {
    let t = line.trim();
    if (!t) continue;
    if (/^(作词|作曲|编曲|演唱|监制|混音|出品|歌词|Lyric|Composer|Artist|词曲)\b/i.test(t)) continue;
    if (/^《.+》$/.test(t) && t.length < 40) continue;
    if (isDirectorNonLyricMetaText(t)) continue;
    t = sanitizeDirectorLyricDisplayText(t);
    if (!t) continue;
    // 过长行按逗号/顿号再拆半句，便于对齐 Whisper
    if (t.length > 22 && /[，、；;]/.test(t)) {
      const parts = t
        .split(/[，、；;]+/)
        .map((x) => sanitizeDirectorLyricDisplayText(x.trim()))
        .filter((x) => x.length >= 2);
      if (parts.length >= 2) {
        out.push(...parts);
        continue;
      }
    }
    out.push(t);
  }
  return out;
}

function normalizeLyricMatchText(s: string): string {
  return String(s || '')
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/[，。！？、…·\-—~～"'“”‘’（）()【】\[\]《》<>]/g, '');
}

/** 粗粒度相似：公共字符占比 */
function lyricTextSimilarity(a: string, b: string): number {
  const x = normalizeLyricMatchText(a);
  const y = normalizeLyricMatchText(b);
  if (!x || !y) return 0;
  if (x === y) return 1;
  if (x.includes(y) || y.includes(x)) return 0.85;
  const setY = new Set(y);
  let hit = 0;
  for (const ch of x) if (setY.has(ch)) hit += 1;
  return hit / Math.max(x.length, y.length);
}

/**
 * 用用户填写的歌词校准 Whisper 时间轴：
 * - 保留人声起止锚点，替换/分配正确歌词文本
 * - 行数与识别段数不一致时按字数比例切开或合并时间
 */
export function calibrateLyricSegmentsWithUserLyrics(
  whisperSegments: DirectorMvLyricSegment[],
  userLyrics: string,
  songDurationSec: number,
): DirectorMvLyricSegment[] {
  const songDur = Math.max(0, Number(songDurationSec) || 0);
  const covered = coverSongWithLyricSegments(whisperSegments, songDur);
  const lines = splitUserLyricLines(userLyrics);
  if (lines.length === 0) return covered;

  const vocals = covered.filter((s) => !isInstrumentalSeg(s));
  if (vocals.length === 0) {
    // 无可靠人声锚点：按字数把歌词均分到全曲，再交给档位打包
    const totalChars = lines.reduce((a, l) => a + Math.max(1, l.length), 0);
    const end = Math.max(songDur, 1);
    const out: DirectorMvLyricSegment[] = [];
    let cursor = 0;
    for (let i = 0; i < lines.length; i++) {
      const share = Math.max(1, lines[i].length) / totalChars;
      const dur = i === lines.length - 1 ? end - cursor : Math.max(0.4, end * share);
      const startSec = cursor;
      const endSec = i === lines.length - 1 ? end : Math.min(end, cursor + dur);
      if (endSec > startSec + 0.05) {
        out.push({
          id: newSegId(2000 + i),
          text: lines[i],
          startSec,
          endSec,
        });
      }
      cursor = endSec;
    }
    return coverSongWithLyricSegments(out, songDur || end);
  }

  // 1) 顺序贪婪：把每行歌词挂到最相近的识别段
  type Assign = { lineIdx: number; vocalIdx: number; score: number };
  const assigns: Assign[] = [];
  let vPtr = 0;
  for (let li = 0; li < lines.length; li++) {
    let bestJ = Math.min(vPtr, vocals.length - 1);
    let bestScore = -1;
    const searchEnd = Math.min(vocals.length, vPtr + 3);
    for (let j = vPtr; j < searchEnd; j++) {
      const sc = lyricTextSimilarity(lines[li], vocals[j].text);
      const orderBonus = j === vPtr ? 0.08 : 0;
      if (sc + orderBonus > bestScore) {
        bestScore = sc + orderBonus;
        bestJ = j;
      }
    }
    // 识别文本太差时仍按顺序推进
    if (bestScore < 0.12) bestJ = Math.min(vPtr, vocals.length - 1);
    assigns.push({ lineIdx: li, vocalIdx: bestJ, score: bestScore });
    vPtr = Math.min(vocals.length - 1, bestJ + (bestScore >= 0.2 ? 1 : 0));
  }

  // 2) 按 vocalIdx 分组行，在该识别段时间窗内按字数切开
  const byVocal = new Map<number, number[]>();
  for (const a of assigns) {
    const arr = byVocal.get(a.vocalIdx) || [];
    arr.push(a.lineIdx);
    byVocal.set(a.vocalIdx, arr);
  }

  const calibratedVocals: DirectorMvLyricSegment[] = [];
  for (let vi = 0; vi < vocals.length; vi++) {
    const v = vocals[vi];
    const lineIdxs = byVocal.get(vi);
    if (!lineIdxs || lineIdxs.length === 0) {
      // 未被歌词点名的识别段：保留原文本作锚点
      calibratedVocals.push({ ...v });
      continue;
    }
    const parts = lineIdxs.map((i) => lines[i]);
    const totalChars = parts.reduce((a, t) => a + Math.max(1, t.length), 0);
    const span = Math.max(0.2, v.endSec - v.startSec);
    let cursor = v.startSec;
    for (let pi = 0; pi < parts.length; pi++) {
      const share = Math.max(1, parts[pi].length) / totalChars;
      const dur = pi === parts.length - 1 ? v.endSec - cursor : Math.max(0.25, span * share);
      const startSec = cursor;
      const endSec = pi === parts.length - 1 ? v.endSec : Math.min(v.endSec, cursor + dur);
      calibratedVocals.push({
        id: newSegId(3000 + vi * 20 + pi),
        text: parts[pi],
        startSec,
        endSec,
      });
      cursor = endSec;
    }
  }

  // 未分配到的歌词行：接在末段人声后均分剩余人声空隙（少见）
  const usedLines = new Set(assigns.map((a) => a.lineIdx));
  const unused = lines.map((t, i) => ({ t, i })).filter((x) => !usedLines.has(x.i));
  if (unused.length > 0 && calibratedVocals.length > 0) {
    const last = calibratedVocals[calibratedVocals.length - 1];
    const pad = 0.45;
    for (let i = 0; i < unused.length; i++) {
      const startSec = last.endSec + i * pad;
      calibratedVocals.push({
        id: newSegId(4000 + i),
        text: unused[i].t,
        startSec,
        endSec: startSec + pad,
      });
    }
  }

  calibratedVocals.sort((a, b) => a.startSec - b.startSec || a.endSec - b.endSec);
  return coverSongWithLyricSegments(calibratedVocals, songDur || covered[covered.length - 1]?.endSec || 0);
}

/** 短镜：两句人声之间间隔超过该秒数则拆成两段（不跨大间隔硬并） */
const SHORT_INTER_PHRASE_GAP_SEC = 0.55;

function collectBoundaries(segments: DirectorMvLyricSegment[]): number[] {
  const set = new Set<number>();
  for (const s of segments) {
    set.add(Number(s.startSec.toFixed(3)));
    set.add(Number(s.endSec.toFixed(3)));
  }
  return [...set].sort((a, b) => a - b);
}

/** 切点是否落在「有歌词人声段」腹部（会把一句歌词从中间切断） */
function cutsVocalPhraseMid(
  segments: DirectorMvLyricSegment[],
  cutAt: number,
  slack = 0.28,
): boolean {
  for (const s of segments) {
    if (isInstrumentalSeg(s)) continue;
    if (s.startSec + slack < cutAt && cutAt < s.endSec - slack) return true;
  }
  return false;
}

/**
 * 区间内已开始的人声小句是否都被完整覆盖（不准切断正在唱的歌词）。
 * 允许切点落在句后间奏里做时长补齐。
 */
function vocalsStartedInRangeFullyCovered(
  segments: DirectorMvLyricSegment[],
  start: number,
  end: number,
): boolean {
  for (const s of segments) {
    if (isInstrumentalSeg(s)) continue;
    if (s.startSec >= end - 0.05) continue;
    if (s.endSec <= start + 0.05) continue;
    if (s.startSec < end - 0.05 && s.endSec > end + 0.28) return false;
    if (s.startSec + 0.28 < end && end < s.endSec - 0.28) return false;
  }
  return true;
}

function nearestBoundary(boundaries: number[], t: number): { b: number; dist: number } {
  let best = t;
  let dist = Infinity;
  for (const b of boundaries) {
    const d = Math.abs(b - t);
    if (d < dist) {
      dist = d;
      best = b;
    }
  }
  return { b: best, dist: Number.isFinite(dist) ? dist : 0 };
}

function listVocalPhrases(segments: DirectorMvLyricSegment[]): DirectorMvLyricSegment[] {
  return segments.filter((s) => !isInstrumentalSeg(s)).sort((a, b) => a.startSec - b.startSec);
}

/** 下一句完整人声小句（起点在 cursor 之后，或正在唱的当前句） */
function findActiveOrNextVocal(
  vocals: DirectorMvLyricSegment[],
  cursor: number,
): DirectorMvLyricSegment | null {
  for (const s of vocals) {
    if (s.endSec <= cursor + 0.08) continue;
    if (s.startSec < cursor + 0.35 && s.endSec > cursor + 0.35) return s;
    if (s.startSec >= cursor - 0.08) return s;
  }
  return null;
}

function nextVocalAfter(
  vocals: DirectorMvLyricSegment[],
  afterEndSec: number,
): DirectorMvLyricSegment | null {
  for (const s of vocals) {
    if (s.startSec >= afterEndSec - 0.05) return s;
  }
  return null;
}

/**
 * 短镜专用：严格只准 4/5/6 秒（含纯音乐），禁止升长档。
 * - 两句间隔较大 → 在间隔处拆成两段
 * - 优先不切断正在唱的句子；单句超过 6s 时仍强制落在 4–6（不可避免时切 6）
 */
function pickShortStrictCut(
  cursor: number,
  songEnd: number,
  segments: DirectorMvLyricSegment[],
  tiers: readonly number[] = DIRECTOR_MV_CLIP_DURATION_TIERS_SHORT,
): { tier: number; end: number } {
  const unique = [...new Set(tiers.map(Number).filter((t) => t > 0))].sort((a, b) => a - b);
  const minT = unique[0] || 4;
  const maxT = unique[unique.length - 1] || 6;
  // 偏好：5 → 6 → 4
  const preferOrder = [...unique].sort((a, b) => {
    const rank = (t: number) => (t === 5 ? 0 : t === 6 ? 1 : t === 4 ? 2 : 3 + t);
    return rank(a) - rank(b);
  });

  const vocals = listVocalPhrases(segments);
  const active = findActiveOrNextVocal(vocals, cursor);

  /** 在 [cursor, hardLimit] 内选严格档位；hardLimit 为「不可跨越」的上限（如下一句开口） */
  const pickInWindow = (
    hardLimit: number,
    opts?: { preferCoverUntil?: number; avoidMidVocal?: boolean },
  ): { tier: number; end: number; score: number } | null => {
    const coverUntil = opts?.preferCoverUntil;
    let best: { tier: number; end: number; score: number } | null = null;
    for (const t of preferOrder) {
      const end = cursor + t;
      if (end > songEnd + 0.12) continue;
      // 不可越过硬上限太多（进入下一句开口之后）
      if (end > hardLimit + 0.12) continue;
      if (opts?.avoidMidVocal !== false) {
        if (cutsVocalPhraseMid(segments, end)) continue;
        if (!vocalsStartedInRangeFullyCovered(segments, cursor, end)) continue;
      }
      let score = 50 - preferOrder.indexOf(t) * 3;
      if (coverUntil != null) {
        if (end < coverUntil - 0.18) score -= 80; // 没盖住当前句
        else score += 40 - Math.max(0, end - coverUntil) * 8; // 盖住后少垫为佳
      }
      // 切在硬上限附近（句间空隙）加分
      if (Math.abs(end - hardLimit) < 0.35) score += 25;
      if (end <= hardLimit + 0.05) score += 10;
      if (!best || score > best.score) best = { tier: t, end, score };
    }
    return best;
  };

  // —— 纯音乐 / 句间大间隔：严格切 4–6，切点尽量落在下一句开口前 ——
  if (!active || active.startSec >= cursor + 0.45) {
    const nextStart = active ? active.startSec : songEnd;
    const gapLen = nextStart - cursor;
    // 间隔内足够一整镜：只切音乐，不把下一句并进来
    if (gapLen >= minT - 0.05) {
      const hardLimit = nextStart;
      const picked =
        pickInWindow(hardLimit, { avoidMidVocal: true }) ||
        pickInWindow(Math.min(songEnd, cursor + maxT), { avoidMidVocal: true });
      if (picked) return { tier: picked.tier, end: picked.end };
      // 强制一档
      const t = preferOrder.find((x) => cursor + x <= songEnd + 0.12) || maxT;
      return { tier: t, end: Math.min(songEnd, cursor + t) };
    }
    // 空隙很短且后面有人声：并入下一句逻辑（落到 active 分支）
  }

  if (active) {
    const phraseEnd = active.endSec;
    const following = nextVocalAfter(vocals, phraseEnd);
    const gapToNext = following ? following.startSec - phraseEnd : Number.POSITIVE_INFINITY;
    const splitByGap = gapToNext >= SHORT_INTER_PHRASE_GAP_SEC;

    // 大间隔：本镜只收当前小句，时长垫在间隔里，严格 4/5/6
    if (splitByGap) {
      const hardLimit = following ? following.startSec : Math.min(songEnd, cursor + maxT);
      const picked = pickInWindow(hardLimit, {
        preferCoverUntil: phraseEnd,
        avoidMidVocal: true,
      });
      if (picked && picked.end >= Math.min(phraseEnd, cursor + maxT) - 0.15) {
        return { tier: picked.tier, end: picked.end };
      }
      // 当前句本身 ≤6：选能盖住句末的最小合适档
      const need = phraseEnd - cursor;
      if (need <= maxT + 0.2) {
        const t =
          preferOrder.find(
            (x) =>
              x >= need - 0.15 &&
              cursor + x <= hardLimit + 0.12 &&
              !cutsVocalPhraseMid(segments, cursor + x),
          ) || preferOrder.find((x) => x >= need - 0.15) || maxT;
        const end = Math.min(songEnd, cursor + t);
        if (end <= hardLimit + 0.15 || !following) return { tier: t, end };
      }
      // 单句 >6：仍严格 6（用户要求短镜必须 4–6）
      return { tier: maxT, end: Math.min(songEnd, cursor + maxT) };
    }

    // 小间隔：可把后续紧挨的小句并进同一镜，但总长严格 ≤6，且不跨「大间隔」
    let coverUntil = phraseEnd;
    let probe = following;
    while (probe) {
      const g = probe.startSec - coverUntil;
      if (g >= SHORT_INTER_PHRASE_GAP_SEC) break;
      if (probe.endSec - cursor > maxT + 0.15) break;
      coverUntil = probe.endSec;
      probe = nextVocalAfter(vocals, probe.endSec);
    }
    const hardLimit = probe ? probe.startSec : Math.min(songEnd, cursor + maxT + 0.5);
    const picked = pickInWindow(Math.min(hardLimit, cursor + maxT + 0.05), {
      preferCoverUntil: coverUntil,
      avoidMidVocal: true,
    });
    if (picked) return { tier: picked.tier, end: picked.end };

    const need = coverUntil - cursor;
    if (need <= maxT + 0.2) {
      const t =
        preferOrder.find((x) => x >= need - 0.15 && cursor + x <= songEnd + 0.12) || maxT;
      return { tier: t, end: Math.min(songEnd, cursor + t) };
    }
    return { tier: maxT, end: Math.min(songEnd, cursor + maxT) };
  }

  // 无任何锚点：纯铺 4–6
  const t = preferOrder.find((x) => cursor + x <= songEnd + 0.12) || maxT;
  return { tier: t, end: Math.min(songEnd, cursor + t) };
}

/**
 * 长镜：以歌词小句边界选切，10/15 向后垫间奏；不硬切正在唱的句子。
 */
function pickLongPhraseCut(
  cursor: number,
  songEnd: number,
  boundaries: number[],
  segments: DirectorMvLyricSegment[],
  primaryTiers: readonly number[],
): { tier: number; end: number } {
  const unique = [...new Set(primaryTiers.map(Number).filter((t) => t > 0))].sort((a, b) => a - b);
  const maxT = unique[unique.length - 1] || 15;
  const preferOrder = [...unique].sort((a, b) => (a === 10 ? -1 : b === 10 ? 1 : a - b));
  const vocals = listVocalPhrases(segments);
  const active = findActiveOrNextVocal(vocals, cursor);

  // 用对象承载候选，避免闭包赋值导致 TS 将 best 收窄为 never
  const bestBox: { v: { tier: number; end: number; score: number } | null } = { v: null };
  const consider = (coverUntil: number, hardLimit: number) => {
    for (const t of preferOrder) {
      if (t < coverUntil - cursor - 0.18) continue;
      const end = cursor + t;
      if (end > songEnd + 0.15) continue;
      if (end > hardLimit + 0.2) continue;
      if (cutsVocalPhraseMid(segments, end)) continue;
      if (!vocalsStartedInRangeFullyCovered(segments, cursor, end)) continue;
      let score = 80 - Math.abs(t - (coverUntil - cursor)) * 4 - Math.max(0, end - coverUntil) * 5;
      if (t === 10) score += 8;
      const { dist } = nearestBoundary(boundaries, end);
      if (dist < 0.25) score += 15;
      if (!bestBox.v || score > bestBox.v.score) bestBox.v = { tier: t, end, score };
    }
  };

  if (active) {
    const phraseEnd = active.endSec;
    const following = nextVocalAfter(vocals, phraseEnd);
    const hardLimit = following ? following.startSec : songEnd;
    consider(phraseEnd, hardLimit);
    // 可合并后续紧挨小句
    let coverUntil = phraseEnd;
    let probe = following;
    while (probe && probe.endSec - cursor <= maxT + 0.2) {
      if (probe.startSec - coverUntil >= SHORT_INTER_PHRASE_GAP_SEC) break;
      coverUntil = probe.endSec;
      probe = nextVocalAfter(vocals, probe.endSec);
      consider(coverUntil, probe ? probe.startSec : songEnd);
    }
  } else {
    consider(Math.min(songEnd, cursor + maxT), songEnd);
  }

  if (bestBox.v) return { tier: bestBox.v.tier, end: bestBox.v.end };

  const t = preferOrder.find((x) => cursor + x <= songEnd + 0.12) || maxT;
  return { tier: t, end: Math.min(songEnd, cursor + t) };
}

function textInRange(segments: DirectorMvLyricSegment[], start: number, end: number): string {
  const parts = segments
    .filter((s) => s.endSec > start + 0.05 && s.startSec < end - 0.05 && !isInstrumentalSeg(s))
    .map((s) => sanitizeDirectorLyricDisplayText(s.text))
    .filter((t) => t && !isDirectorInstrumentalLyricText(t) && !isDirectorNonLyricMetaText(t));
  return parts.join(' ').trim();
}

function idsInRange(segments: DirectorMvLyricSegment[], start: number, end: number): string[] {
  return segments
    .filter((s) => s.endSec > start + 0.05 && s.startSec < end - 0.05)
    .map((s) => s.id);
}

/**
 * 按时长档打包镜头音频。
 * - 短镜：严格 4/5/6（含纯音乐）；两句间隔较大则拆段；不升 10/15。
 * - 长镜：10/15，贴歌词小句边界。
 * - 长短镜共用同一识别时间轴，切换仅重打包。
 */
export function packLyricSegmentsIntoShotPacks(
  segments: DirectorMvLyricSegment[],
  opts?: {
    /** @deprecated 使用 durationTiers；保留兼容 */
    targetSec?: number;
    /** @deprecated 使用 durationTiers */
    maxSec?: number;
    durationTiers?: readonly number[];
    preferredSec?: number;
    /** 长镜 long=10/15 · 短镜 short=4/5/6；未传 durationTiers 时生效，默认 short */
    clipLengthMode?: DirectorMvClipLengthMode | string | null;
  },
): DirectorLyricShotPack[] {
  const mode = resolveMvClipDurationTiers(opts?.clipLengthMode).mode;
  const resolved = resolveMvClipDurationTiers(mode);
  const tiers = (
    opts?.durationTiers && opts.durationTiers.length > 0
      ? opts.durationTiers
      : resolved.tiers
  )
    .map((t) => Number(t))
    .filter((t) => Number.isFinite(t) && t > 0)
    .sort((a, b) => a - b);
  const uniqueTiers = [...new Set(tiers)];
  const maxTier = uniqueTiers[uniqueTiers.length - 1] || resolved.preferredSec;
  const minTier = uniqueTiers[0] || 4;

  const list = normalizeDirectorMvLyricSegments(segments);
  if (list.length === 0) return [];
  const songEnd = list[list.length - 1].endSec;
  const boundaries = collectBoundaries(list);
  const packs: DirectorLyricShotPack[] = [];
  let cursor = 0;

  {
    const { b, dist } = nearestBoundary(boundaries, cursor);
    if (dist < 0.2 && b >= 0) cursor = Math.max(0, b);
  }

  const pickCut = (from: number) =>
    mode === 'short'
      ? pickShortStrictCut(from, songEnd, list, uniqueTiers)
      : pickLongPhraseCut(from, songEnd, boundaries, list, uniqueTiers);

  while (cursor < songEnd - 0.08) {
    const remaining = songEnd - cursor;
    if (remaining <= maxTier + 0.12) {
      const exact = uniqueTiers.find((t) => Math.abs(t - remaining) < 0.28);
      if (
        exact &&
        (mode === 'short'
          ? !cutsVocalPhraseMid(list, cursor + exact) || remaining <= maxTier
          : !cutsVocalPhraseMid(list, cursor + exact) &&
            vocalsStartedInRangeFullyCovered(list, cursor, cursor + exact))
      ) {
        // 短镜尾段：即使纯音乐也必须落在 4–6
        packs.push({
          startSec: cursor,
          endSec: cursor + exact,
          durationSec: exact,
          text: textInRange(list, cursor, cursor + exact),
          segmentIds: idsInRange(list, cursor, cursor + exact),
          tierSec: exact,
        });
        break;
      }
      if (remaining < minTier - 0.05 && packs.length > 0) {
        const prev = packs[packs.length - 1];
        // 尾巴过短：并入上一镜并重选严格档
        const pick = pickCut(prev.startSec);
        prev.endSec = pick.end;
        prev.durationSec = pick.tier;
        prev.tierSec = pick.tier;
        prev.text = textInRange(list, prev.startSec, prev.endSec);
        prev.segmentIds = idsInRange(list, prev.startSec, prev.endSec);
        if (songEnd - prev.endSec > 0.35) {
          const rest = pickCut(prev.endSec);
          packs.push({
            startSec: prev.endSec,
            endSec: rest.end,
            durationSec: rest.tier,
            text: textInRange(list, prev.endSec, rest.end),
            segmentIds: idsInRange(list, prev.endSec, rest.end),
            tierSec: rest.tier,
          });
        }
        break;
      }
      // 尾段不够整档：短镜仍强制选 4/5/6 中最接近且不超过曲尾过多的
      if (mode === 'short') {
        const t =
          uniqueTiers.find((x) => Math.abs(x - remaining) < 0.35) ||
          [...uniqueTiers].reverse().find((x) => x <= remaining + 0.2) ||
          minTier;
        const end = Math.min(songEnd, cursor + t);
        packs.push({
          startSec: cursor,
          endSec: end,
          durationSec: t,
          text: textInRange(list, cursor, end),
          segmentIds: idsInRange(list, cursor, end),
          tierSec: t,
        });
        break;
      }
    }

    const pick = pickCut(cursor);
    if (pick.end <= cursor + 0.2) {
      const bump = Math.min(songEnd, cursor + minTier);
      packs.push({
        startSec: cursor,
        endSec: bump,
        durationSec: minTier,
        text: textInRange(list, cursor, bump),
        segmentIds: idsInRange(list, cursor, bump),
        tierSec: minTier,
      });
      cursor = bump;
    } else {
      packs.push({
        startSec: cursor,
        endSec: pick.end,
        durationSec: pick.tier,
        text: textInRange(list, cursor, pick.end),
        segmentIds: idsInRange(list, cursor, pick.end),
        tierSec: pick.tier,
      });
      cursor = pick.end;
    }
    {
      const { b, dist } = nearestBoundary(boundaries, cursor);
      if (dist < 0.22 && b >= cursor - 0.01) cursor = Math.max(cursor, b);
    }
    if (packs.length > 400) break;
  }

  // 档位规范化后必须重链 start/end，否则各镜仍用旧 startSec + 新 duration → 重叠/空隙，入轨与原曲错位。
  // 已落在档位且 end-start≈tier 的镜尽量保留绝对时间，仅在 duration 被改写时向后挤压，减少相对歌词漂移。
  let chainCursor =
    packs.length > 0 ? Math.max(0, Number(packs[0].startSec) || 0) : 0;
  const normalizedPacks = packs.map((p) => {
    const tier =
      p.tierSec ||
      pickNearestMvClipDurationTier(p.durationSec, uniqueTiers);
    // 短镜：强制规范化到 4/5/6
    const forcedTier =
      mode === 'short'
        ? uniqueTiers.every((t) => t >= 4 && t <= 6)
          ? uniqueTiers
          : [...DIRECTOR_MV_CLIP_DURATION_TIERS_SHORT]
        : uniqueTiers;
    const finalTier = mode === 'short' ? forcedTier : uniqueTiers;
    const finalTierSec =
      mode === 'short' ? pickNearestMvClipDurationTier(tier, finalTier) : tier;
    const origStart = Math.max(0, Number(p.startSec) || 0);
    const origEnd = Number(p.endSec);
    const origSpan =
      Number.isFinite(origEnd) && origEnd > origStart + 0.05 ? origEnd - origStart : Number(p.durationSec) || 0;
    const tierUnchanged = Math.abs(origSpan - finalTierSec) < 0.06;
    // 与上一镜无重叠时可保留原 start（贴齐歌词边界）；否则接到 chainCursor
    const startSec = Number(
      (tierUnchanged && origStart >= chainCursor - 0.001 ? origStart : chainCursor).toFixed(3),
    );
    const endSec = Number((startSec + finalTierSec).toFixed(3));
    chainCursor = endSec;
    return {
      ...p,
      startSec,
      endSec,
      durationSec: finalTierSec,
      tierSec: finalTierSec,
      text: '',
      segmentIds: idsInRange(list, startSec, endSec),
    };
  });
  // 每句歌词只出现在一句首所在镜，避免短镜切开后同一句重复刷屏
  return assignUniqueLyricTextsToPacks(normalizedPacks, list);
}

/** 镜头包在曲中的音频角色：前奏 / 人声 / 间奏 / 尾奏 */
export type DirectorMvPackAudioRole = 'intro' | 'vocal' | 'bridge' | 'outro';

export function classifyDirectorMvPackAudioRole(
  packs: DirectorLyricShotPack[],
  index: number,
): DirectorMvPackAudioRole {
  if (!packs.length || index < 0 || index >= packs.length) return 'vocal';
  const firstVocal = packs.findIndex((p) => !p.instrumental && String(p.text || '').trim());
  const lastVocal = (() => {
    for (let i = packs.length - 1; i >= 0; i--) {
      if (!packs[i].instrumental && String(packs[i].text || '').trim()) return i;
    }
    return -1;
  })();
  const p = packs[index];
  const isInst =
    p.instrumental === true ||
    !String(p.text || '').trim() ||
    isDirectorInstrumentalLyricText(p.text);
  if (!isInst) return 'vocal';
  if (firstVocal < 0) return 'intro'; // 整曲无人声
  if (index < firstVocal) return 'intro';
  if (lastVocal >= 0 && index > lastVocal) return 'outro';
  return 'bridge';
}

export function directorMvPackAudioRoleLabelZh(role: DirectorMvPackAudioRole): string {
  if (role === 'intro') return '前奏/无人声';
  if (role === 'outro') return '尾奏/无人声';
  if (role === 'bridge') return '间奏/无人声';
  return '有人声';
}

/** 镜头包是否无人声（前奏/间奏/尾奏/纯音乐） */
export function isDirectorLyricShotPackInstrumental(
  pack: Pick<DirectorLyricShotPack, 'text' | 'instrumental'> | null | undefined,
): boolean {
  if (!pack) return false;
  if (pack.instrumental === true) return true;
  const t = String(pack.text || '').trim();
  if (!t) return true;
  return isDirectorInstrumentalLyricText(t);
}

const SINGING_PERFORMANCE_RE =
  /手持(?:麦克|话筒)|拿着(?:麦克|话筒)|(?:麦克|话筒)风?演唱|对着(?:麦克|话筒)|开麦(?:演唱|演出)?|对口型(?:唱歌|演唱)?|KTV\s*唱歌|舞台(?:开麦|演唱)|正在唱(?:歌|着)|演唱会主唱|lip[\s-]?sync(?:ing)?|singing\s+into\s+(?:a\s+)?mic(?:rophone)?|holding\s+(?:a\s+)?microphone/gi;

/** 去掉「正在演唱」类描述（用于无人声镜画面/提示词清洗） */
export function stripDirectorSingingPerformanceFromText(text: string | undefined | null): string {
  let t = String(text || '').trim();
  if (!t) return '';
  t = t.replace(SINGING_PERFORMANCE_RE, '沉默表演');
  t = t.replace(/(沉默表演[，,]?\s*){2,}/g, '沉默表演，');
  t = t.replace(/[。]{2,}/g, '。').replace(/\s{2,}/g, ' ').trim();
  return t;
}

export const DIRECTOR_INSTRUMENTAL_NO_SING_GUARD =
  '本镜为前奏/间奏/尾奏或无人声：禁止拿麦克风、对口型演唱、开麦演出；可空镜建置，或人物背影/侧影、行走、第三视角跟拍、写真等沉默表演';

/** 按镜头包角色清洗无人声镜的画面/对白/最终提示，防止拿麦唱歌 */
export function applyDirectorInstrumentalVisualGuards(
  shots: Array<Record<string, string>>,
  packs: DirectorLyricShotPack[],
): Array<Record<string, string>> {
  if (!shots.length || !packs.length) return shots;
  return shots.map((shot, i) => {
    const p = packs[Math.min(i, packs.length - 1)];
    if (!isDirectorLyricShotPackInstrumental(p)) return shot;
    const role = classifyDirectorMvPackAudioRole(packs, i);
    const roleZh = directorMvPackAudioRoleLabelZh(role);
    const desc = stripDirectorSingingPerformanceFromText(shot['画面描述']);
    let final = stripDirectorSingingPerformanceFromText(shot['最终提示词']);
    if (final && !/不拿麦克风|不对口型|无人声|前奏\/间奏/.test(final)) {
      final = `${final}。${DIRECTOR_INSTRUMENTAL_NO_SING_GUARD}（${roleZh}）`;
    } else if (!final) {
      final = '';
    }
    return {
      ...shot,
      画面描述: desc,
      对白旁白: '',
      ...(final ? { 最终提示词: final } : {}),
    };
  });
}

/** 打包结果写成镜头「时长」+ 分镜音频绑定所需区间 */
export function shotMusicRangesFromLyricPacks(
  packs: DirectorLyricShotPack[],
): Array<{ startSec: number; endSec: number; durationSec: number; text: string }> {
  return packs.map((p) => ({
    startSec: p.startSec,
    endSec: p.endSec,
    durationSec: p.durationSec,
    text: p.text,
  }));
}

/** 区间是否覆盖到非间奏人声段；无时间轴数据时返回 null（未知） */
export function shotAudioRangeHasHumanVoice(
  segments: DirectorMvLyricSegment[] | undefined | null,
  startSec: number,
  endSec: number,
): boolean | null {
  const list = normalizeDirectorMvLyricSegments(segments);
  if (list.length === 0) return null;
  const a = Math.max(0, Number(startSec) || 0);
  const b = Number(endSec);
  if (!Number.isFinite(b) || b <= a + 0.05) return null;
  let hitAny = false;
  for (const seg of list) {
    if (seg.endSec <= a + 0.05 || seg.startSec >= b - 0.05) continue;
    hitAny = true;
    if (isInstrumentalSeg(seg)) continue;
    return true;
  }
  if (!hitAny) return false;
  return false;
}
