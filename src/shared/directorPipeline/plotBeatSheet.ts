/**
 * MV 剧情规划「分段明细表」：用 | 分隔，便于 LLM 输出与 UI 表格展示。
 * 列：段号|曲式段|人声|画面类型|场景|出场角色|镜头角度|焦距|动作与画面|对口型动作|情绪
 */

import type { DirectorMvScriptSections, DirectorShot } from './schema.js';
import {
  isBlankDirectorShot,
  normalizeDirectorMvScriptSections,
  parseDirectorMvScriptSectionsFromText,
} from './schema.js';
import {
  pickCinematicAngleFallback,
  pickCinematicFocalFallback,
} from './cinematicCameraLanguage.js';

export const DIRECTOR_MV_PLOT_BEAT_HEADER =
  '段号|曲式段|人声|画面类型|场景|出场角色|镜头角度|焦距|动作与画面|对口型动作|情绪';

export type DirectorMvPlotBeatRow = {
  no: string;
  section: string;
  vocal: string;
  castType: string;
  scene: string;
  cast: string;
  /** 机位：电影级手法短词（过肩窥视/低机位仰拍/荷兰斜角…） */
  angle: string;
  /** 焦距：具体焦段+气质（35mm纪实/85mm人像压…） */
  focal: string;
  action: string;
  /** 开口/对口型表演；仅对口型开关打开时拼进视频提示词 */
  lipsyncAction: string;
  mood: string;
};

const HEADER_ALIASES = [
  DIRECTOR_MV_PLOT_BEAT_HEADER,
  '段号|曲式段|人声|画面类型|场景|出场角色|镜头角度|焦距|动作与画面|情绪',
  '段号|曲式段|人声|画面类型|场景|出场角色|动作与画面|情绪',
  '段号|曲式|人声|画面类型|场景|角色|动作|情绪',
  'no|section|vocal|type|scene|cast|angle|focal|action|lipsyncAction|mood',
  'no|section|vocal|type|scene|cast|angle|focal|action|mood',
  'no|section|vocal|type|scene|cast|action|mood',
];

function splitPipeLine(line: string): string[] {
  return String(line || '')
    .split('|')
    .map((c) => c.trim());
}

function isHeaderRow(cells: string[]): boolean {
  if (cells.length < 4) return false;
  const joined = cells.join('|').toLowerCase();
  if (/段号/.test(cells[0] || '') && /曲式|画面类型|场景/.test(joined)) return true;
  if (/^no$/i.test(cells[0] || '') && /section|scene/i.test(joined)) return true;
  return HEADER_ALIASES.some((h) => h.toLowerCase() === joined.toLowerCase());
}

function normalizeCastType(raw: string): string {
  const t = String(raw || '').trim();
  if (/空镜|无人物|empty/i.test(t)) return '空镜';
  if (/有人|人物|角色|有人物/i.test(t)) return '有人';
  return t || '—';
}

function normalizeVocal(raw: string): string {
  const t = String(raw || '').trim();
  if (/无人声|前奏|间奏|尾奏|instrumental|no\s*vocal/i.test(t)) return '无人声';
  if (/有人声|vocal/i.test(t)) return '有人声';
  return t || '—';
}

function looksLikeAngle(s: string): boolean {
  return /平视|俯拍|仰拍|俯视|仰视|微俯|微仰|侧面|过肩|荷兰|倾斜|鸟瞰|虫视|低机|高机|正面|背面|斜侧|窥视|对切|贴脸|贴地|窗框|三分|航拍|剪影|审判|对位|远距|极近|angle|overhead|low[\s-]?angle|high[\s-]?angle|dutch|pov/i.test(
    s,
  );
}

function looksLikeFocal(s: string): boolean {
  const t = String(s || '').trim();
  if (!t || t === '—') return false;
  // 「标准」单独也可作焦距；避免误伤「标准答案」等长句
  if (/^标准$|^标准焦|^标准镜/.test(t)) return true;
  return /广角|中焦|长焦|微距|鱼眼|焦段|空间感|纪实|人文|人像|偷窥|浅景深|街拍|畸变|压缩|\d+\s*mm|mm\b|wide|tele|focal|anamorphic/i.test(
    t,
  );
}

function looksLikeCastLabel(s: string): boolean {
  const t = String(s || '').trim();
  if (!t || t === '—') return false;
  if (/男主|女主|主角|配角|路人|群众|人群|行人|背景人/.test(t)) return true;
  // 「张三、李四」这类短称呼串
  if (/[、，,]/.test(t) && t.length <= 24 && !looksLikeAngle(t) && !/[。；;]/.test(t)) return true;
  return false;
}

function looksLikeSceneName(s: string): boolean {
  const t = String(s || '').trim();
  if (!t || t === '—') return false;
  if (looksLikeCastLabel(t) || looksLikeAngle(t) || looksLikeFocal(t)) return false;
  if (/空镜|有人声|无人声|^有人$|^空镜$/.test(t)) return false;
  // 场景短名：2–12 字，无长句标点
  if (t.length >= 2 && t.length <= 12 && !/[。；;]/.test(t)) return true;
  return false;
}

/**
 * 修复 LLM 常见错列：把「出场角色|镜头角度」写到「场景|出场角色」，
 * 场景名落到「动作」，真正动作落到「情绪」；角度/焦距空着。
 */
function healDirectorMvPlotBeatRow(row: DirectorMvPlotBeatRow): DirectorMvPlotBeatRow {
  let r: DirectorMvPlotBeatRow = { ...row };

  const sceneIsCast = looksLikeCastLabel(r.scene);
  const castIsAngle = looksLikeAngle(r.cast);
  const actionIsScene = looksLikeSceneName(r.action);
  const angleEmpty = !r.angle || r.angle === '—';
  const focalEmpty = !r.focal || r.focal === '—';

  // A: 场景←角色、角色←角度、动作←场景名、情绪←动作正文
  if (sceneIsCast && castIsAngle && actionIsScene) {
    const realCast = r.scene;
    const realAngle = r.cast;
    const realScene = r.action;
    const realAction = r.mood && r.mood !== '—' ? r.mood : '—';
    r = {
      ...r,
      castType: '有人',
      scene: realScene,
      cast: realCast,
      angle: realAngle,
      focal: looksLikeFocal(r.focal)
        ? r.focal
        : pickCinematicFocalFallback({ section: r.section, emptyShot: false, index: 0 }),
      action: realAction,
      mood: '—',
    };
  } else if (sceneIsCast && looksLikeSceneName(r.cast)) {
    // B: 仅场景与角色对调
    r = {
      ...r,
      castType: '有人',
      scene: r.cast,
      cast: r.scene,
    };
  } else if (sceneIsCast && castIsAngle && angleEmpty) {
    // C: 缺场景列，角色|角度挤进场景|角色；焦距/动作可能仍错位
    const realCast = r.scene;
    const realAngle = r.cast;
    let realScene = '—';
    let realAction = r.action;
    let realMood = r.mood;
    if (actionIsScene) {
      realScene = r.action;
      realAction = r.mood && r.mood !== '—' ? r.mood : '—';
      realMood = '—';
    } else if (looksLikeSceneName(r.focal)) {
      realScene = r.focal;
    }
    r = {
      ...r,
      castType: '有人',
      scene: realScene,
      cast: realCast,
      angle: realAngle,
      focal:
        looksLikeFocal(r.focal) && !looksLikeSceneName(r.focal)
          ? r.focal
          : pickCinematicFocalFallback({ section: r.section, emptyShot: false, index: 1 }),
      action: realAction,
      mood: realMood || '—',
    };
  }

  // 推断画面类型（避免「—」被 UI 当成有人展示却统计成空镜）
  if (r.castType !== '空镜' && r.castType !== '有人') {
    if (looksLikeCastLabel(r.cast) || (r.cast && r.cast !== '—')) r.castType = '有人';
    else r.castType = '空镜';
  }
  if (r.castType === '空镜' && looksLikeCastLabel(r.cast)) {
    r.castType = '有人';
  }
  // 动作里写了路人/人群，却误标空镜 → 纠正为有人
  if (
    r.castType === '空镜' &&
    /路人|群众|人群|行人|奔逃|逃散|人群/.test(String(r.action || ''))
  ) {
    r.castType = '有人';
    if (!r.cast || r.cast === '—') r.cast = '路人';
  }
  if (r.castType === '有人' && (!r.cast || r.cast === '—') && looksLikeCastLabel(r.scene)) {
    r.cast = r.scene;
    r.scene = actionIsScene ? r.action : r.scene;
  }

  // 补齐角度/焦距：电影级短词兜底，避免一律平视+中焦
  const emptyShot = r.castType === '空镜';
  if (!r.angle || r.angle === '—') {
    r.angle = pickCinematicAngleFallback({
      section: r.section,
      emptyShot,
      index: Number(r.no) || 0,
    });
  }
  if (!r.focal || r.focal === '—' || !looksLikeFocal(r.focal)) {
    r.focal = pickCinematicFocalFallback({
      section: r.section,
      emptyShot,
      index: Number(r.no) || 0,
    });
  }

  if (r.vocal === '无人声') {
    r.lipsyncAction = '—';
  } else if (!r.lipsyncAction) {
    r.lipsyncAction = '—';
  }
  return r;
}

type ColMap = {
  no: number;
  section: number;
  vocal: number;
  castType: number;
  scene: number;
  cast: number;
  angle: number;
  focal: number;
  action: number;
  lipsyncAction: number;
  mood: number;
};

function buildColMapFromHeader(cells: string[]): ColMap | null {
  if (!isHeaderRow(cells)) return null;
  const find = (...preds: RegExp[]) => {
    for (let i = 0; i < cells.length; i++) {
      const c = cells[i] || '';
      if (preds.some((re) => re.test(c))) return i;
    }
    return -1;
  };
  const no = find(/^段号$/i, /^no$/i);
  const section = find(/曲式/, /section/i);
  const vocal = find(/人声/, /vocal/i);
  const castType = find(/画面类型/, /shot\s*type|cast\s*type/i);
  const scene = find(/^场景$/, /scene/i);
  const cast = find(/出场角色|^角色$/, /cast/i);
  const angle = find(/镜头角度|机位|^角度$/, /angle/i);
  const focal = find(/焦距|焦段/, /focal/i);
  // 禁止用裸「画面」匹配，否则会误命中「画面类型」列
  const action = find(/动作与画面/, /^动作$/, /action/i);
  const lipsyncAction = find(/对口型动作|对口型表演|开口动作/, /lipsync\s*action/i);
  const mood = find(/情绪/, /mood/i);
  if (no < 0 || scene < 0 || action < 0) return null;
  return {
    no: no >= 0 ? no : 0,
    section: section >= 0 ? section : 1,
    vocal: vocal >= 0 ? vocal : 2,
    castType: castType >= 0 ? castType : 3,
    scene: scene >= 0 ? scene : 4,
    cast: cast >= 0 ? cast : 5,
    angle: angle >= 0 ? angle : -1,
    focal: focal >= 0 ? focal : -1,
    action: action >= 0 ? action : 6,
    lipsyncAction: lipsyncAction >= 0 ? lipsyncAction : -1,
    mood: mood >= 0 ? mood : 7,
  };
}

function defaultColMap(cellCount: number): ColMap {
  // 新表 11 列（含对口型动作）；旧表 10 列；更旧 8 列（无角度/焦距）
  if (cellCount >= 11) {
    return {
      no: 0,
      section: 1,
      vocal: 2,
      castType: 3,
      scene: 4,
      cast: 5,
      angle: 6,
      focal: 7,
      action: 8,
      lipsyncAction: 9,
      mood: 10,
    };
  }
  if (cellCount >= 10) {
    return {
      no: 0,
      section: 1,
      vocal: 2,
      castType: 3,
      scene: 4,
      cast: 5,
      angle: 6,
      focal: 7,
      action: 8,
      lipsyncAction: -1,
      mood: 9,
    };
  }
  return {
    no: 0,
    section: 1,
    vocal: 2,
    castType: 3,
    scene: 4,
    cast: 5,
    angle: -1,
    focal: -1,
    action: 6,
    lipsyncAction: -1,
    mood: 7,
  };
}

function cellAt(cells: string[], idx: number): string {
  if (idx < 0 || idx >= cells.length) return '';
  return String(cells[idx] || '').trim();
}

function toPlotCell(v: unknown): string {
  if (v == null) return '';
  if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') {
    return String(v).trim();
  }
  return '';
}

/** 对象数组 → 明细行（兼容中英字段名） */
function plotObjectArrayToRows(raw: unknown[]): DirectorMvPlotBeatRow[] {
  return raw
    .filter((x) => x && typeof x === 'object' && !Array.isArray(x))
    .map((item, i) => {
      const o = item as Record<string, unknown>;
      return healDirectorMvPlotBeatRow({
        no: toPlotCell(o.no ?? o.段号 ?? o.index ?? i + 1) || String(i + 1),
        section: toPlotCell(o.section ?? o.曲式段 ?? o.曲式) || '—',
        vocal: toPlotCell(o.vocal ?? o.人声) || '—',
        castType: toPlotCell(o.castType ?? o.画面类型 ?? o.type) || '—',
        scene: toPlotCell(o.scene ?? o.场景) || '—',
        cast: toPlotCell(o.cast ?? o.出场角色 ?? o.角色) || '—',
        angle: toPlotCell(o.angle ?? o.镜头角度 ?? o.机位) || '—',
        focal: toPlotCell(o.focal ?? o.焦距 ?? o.焦段) || '—',
        action: toPlotCell(o.action ?? o.动作与画面 ?? o.动作 ?? o.画面) || '—',
        lipsyncAction:
          toPlotCell(o.lipsyncAction ?? o.对口型动作 ?? o.对口型表演 ?? o.开口动作) || '—',
        mood: toPlotCell(o.mood ?? o.情绪) || '—',
      });
    });
}

/** 从整段 JSON / 截断 JSON / plot 数组字符串里捞出行 */
function tryParsePlotJsonToRows(rawIn: string): DirectorMvPlotBeatRow[] | null {
  let raw = String(rawIn || '').trim();
  if (!raw) return null;
  raw = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
  if (!raw.startsWith('{') && !raw.startsWith('[')) return null;

  const tryObj = (parsed: unknown): DirectorMvPlotBeatRow[] | null => {
    if (Array.isArray(parsed)) {
      const rows = plotObjectArrayToRows(parsed);
      return rows.length >= 1 ? rows : null;
    }
    if (!parsed || typeof parsed !== 'object') return null;
    const o = parsed as Record<string, unknown>;
    const plot = o.plot ?? o.剧情规划 ?? o.sections;
    if (Array.isArray(plot)) {
      const rows = plotObjectArrayToRows(plot);
      return rows.length >= 1 ? rows : null;
    }
    if (plot && typeof plot === 'object' && !Array.isArray(plot) && Array.isArray((plot as any).plot)) {
      return tryObj(plot);
    }
    if (typeof plot === 'string' && plot.trim()) {
      return tryParsePlotJsonToRows(plot) || parseDirectorMvPlotBeatTablePipeOnly(plot);
    }
    return null;
  };

  try {
    const parsed = JSON.parse(raw);
    const rows = tryObj(parsed);
    if (rows?.length) return rows;
  } catch {
    /* 截断 JSON：尽量捞出 plot 数组里已完整的对象 */
  }

  const plotArrMatch = raw.match(/"plot"\s*:\s*\[([\s\S]*)/i) || raw.match(/"剧情规划"\s*:\s*\[([\s\S]*)/);
  if (plotArrMatch) {
    const body = plotArrMatch[1] || '';
    const objs: Record<string, unknown>[] = [];
    const objRe = /\{[^{}]*\}/g;
    let m: RegExpExecArray | null;
    while ((m = objRe.exec(body))) {
      try {
        const one = JSON.parse(m[0]);
        if (one && typeof one === 'object') objs.push(one);
      } catch {
        /* skip broken fragment */
      }
    }
    if (objs.length >= 1) {
      const rows = plotObjectArrayToRows(objs);
      if (rows.length >= 1) return rows;
    }
  }
  return null;
}

/** 仅解析竖线表（内部） */
function parseDirectorMvPlotBeatTablePipeOnly(plot: string): DirectorMvPlotBeatRow[] | null {
  let raw = String(plot || '').trim();
  if (!raw) return null;
  if (!raw.includes('\n') && /\\n/.test(raw)) {
    raw = raw.replace(/\\n/g, '\n');
  }
  const lines = raw
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !/^```/.test(l) && !/^\|?\s*-{3,}/.test(l))
    .map((l) => l.replace(/^\|/, '').replace(/\|$/, '').trim());

  const pipeLines = lines.filter((l) => l.includes('|'));
  if (pipeLines.length < 2) return null;

  let start = 0;
  let colMap: ColMap | null = null;
  const firstCells = splitPipeLine(pipeLines[0]);
  if (isHeaderRow(firstCells)) {
    start = 1;
    colMap = buildColMapFromHeader(firstCells);
  }

  const rows: DirectorMvPlotBeatRow[] = [];
  for (let i = start; i < pipeLines.length; i++) {
    const cells = splitPipeLine(pipeLines[i]);
    if (cells.length < 5) continue;
    if (isHeaderRow(cells)) continue;
    const map = colMap || defaultColMap(cells.length);
    let angle = cellAt(cells, map.angle);
    let focal = cellAt(cells, map.focal);
    let action = cellAt(cells, map.action) || '—';
    let lipsyncAction = cellAt(cells, map.lipsyncAction) || '—';
    let mood = cellAt(cells, map.mood) || '—';
    if (map.angle < 0 && cells.length >= 9) {
      const c6 = cells[6] || '';
      const c7 = cells[7] || '';
      if (looksLikeAngle(c6) || looksLikeFocal(c7)) {
        angle = c6;
        focal = c7;
        action = cells[8] || '—';
        mood = cells[9] || cells[8] || '—';
        if (cells.length === 9 && !cells[9]) {
          action = cells[8] || '—';
          mood = '—';
        }
      }
    }

    const no = cellAt(cells, map.no) || String(rows.length + 1);
    if (!/^\d+/.test(no) && !cellAt(cells, map.section)) continue;

    let useMap = map;
    if (colMap && cells.length >= 5 && cells.length <= 8 && (map.angle >= 0 || map.focal >= 0)) {
      useMap = {
        ...map,
        angle: -1,
        focal: -1,
        action: cells.length >= 8 ? 6 : map.action,
        lipsyncAction: -1,
        mood: cells.length >= 8 ? 7 : map.mood,
      };
      angle = '';
      focal = '';
      action = cellAt(cells, useMap.action) || '—';
      lipsyncAction = '—';
      mood = cellAt(cells, useMap.mood) || '—';
    }

    const vocalNorm = normalizeVocal(cellAt(cells, useMap.vocal));
    if (vocalNorm === '无人声') lipsyncAction = '—';

    const rawRow: DirectorMvPlotBeatRow = {
      no: no.replace(/[^\d]/g, '') || String(rows.length + 1),
      section: cellAt(cells, useMap.section) || '—',
      vocal: vocalNorm,
      castType: normalizeCastType(cellAt(cells, useMap.castType)),
      scene: cellAt(cells, useMap.scene) || '—',
      cast: cellAt(cells, useMap.cast) || '—',
      angle: angle || '—',
      focal: focal || '—',
      action,
      lipsyncAction: lipsyncAction || '—',
      mood,
    };
    rows.push(healDirectorMvPlotBeatRow(rawRow));
  }

  return rows.length >= 2 ? rows : null;
}

/** 从剧情规划正文解析分段明细表；解析失败返回 null（支持 | 表与 JSON plot 数组） */
export function parseDirectorMvPlotBeatTable(plot: string): DirectorMvPlotBeatRow[] | null {
  let raw = String(plot || '').trim();
  if (!raw) return null;
  raw = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();

  const fromJson = tryParsePlotJsonToRows(raw);
  if (fromJson && fromJson.length >= 1) return fromJson;

  return parseDirectorMvPlotBeatTablePipeOnly(raw);
}

/**
 * 把任意剧情规划正文尽量规范成标准 | 表。
 * 用于 UI：模型把整段 JSON 塞进 plot 时自动转回表格。
 */
export function coerceDirectorMvPlotToBeatTable(plot: string): string | null {
  const rows = parseDirectorMvPlotBeatTable(plot);
  if (!rows?.length) return null;
  return formatDirectorMvPlotBeatTable(rows);
}

/** 序列化为标准表（含表头） */
export function formatDirectorMvPlotBeatTable(rows: DirectorMvPlotBeatRow[]): string {
  const lines = [DIRECTOR_MV_PLOT_BEAT_HEADER];
  for (const r of rows || []) {
    lines.push(
      [
        r.no,
        r.section,
        r.vocal,
        r.castType,
        r.scene,
        r.cast || '—',
        r.angle || '—',
        r.focal || '—',
        r.action,
        r.lipsyncAction || '—',
        r.mood || '—',
      ]
        .map((c) => String(c || '').replace(/\|/g, '｜').trim())
        .join('|'),
    );
  }
  return lines.join('\n');
}

/** 表中空镜 / 有人行数量（供 UI 摘要） */
export function countDirectorMvPlotBeatsWithCast(rows: DirectorMvPlotBeatRow[]): {
  total: number;
  withCast: number;
  empty: number;
} {
  const list = rows || [];
  let withCast = 0;
  let empty = 0;
  for (const r of list) {
    if (r.castType === '有人') withCast += 1;
    else empty += 1;
  }
  return { total: list.length, withCast, empty };
}

/** 镜头下标 → 剧情段
 * - 镜数 = 段数：一一对应
 * - 镜数 > 段数：前 N 镜与段号 1:1（镜6=段6），多出的镜再按比例分摊
 * - 镜数 < 段数：按比例抽样
 */
export function mapDirectorMvShotIndexToPlotBeat(
  shotIndex: number,
  shotCount: number,
  beats: DirectorMvPlotBeatRow[],
): DirectorMvPlotBeatRow | null {
  const n = beats?.length || 0;
  if (!n || shotIndex < 0 || shotCount <= 0) return null;
  if (n === shotCount) return beats[shotIndex] || null;
  if (shotCount > n) {
    // 硬性对齐：镜号 i+1 ↔ 段号 i+1（用户按「第六条」对照「第六镜」）
    if (shotIndex < n) return beats[shotIndex] || null;
    const extra = shotCount - n;
    const extraIdx = shotIndex - n;
    const idx = Math.min(n - 1, Math.max(0, Math.floor((extraIdx * n) / Math.max(1, extra))));
    return beats[idx] || null;
  }
  const idx = Math.min(n - 1, Math.max(0, Math.floor((shotIndex * n) / shotCount)));
  return beats[idx] || null;
}

/**
 * 将剧情明细表行数强制对齐到目标段数（= 音频 lyric pack / 分镜数）。
 * 少则按比例复用相邻段内容扩行，多则均匀抽样；对齐后段号 1..N 与第 i 音频片段一一对应。
 */
export function alignDirectorMvPlotBeatsToCount(
  beats: DirectorMvPlotBeatRow[] | null | undefined,
  targetCount: number,
): DirectorMvPlotBeatRow[] | null {
  const list = beats || [];
  const t = Math.max(0, Math.round(Number(targetCount) || 0));
  if (!list.length || t <= 0) return list.length ? list : null;
  if (list.length === t) {
    return list.map((b, i) => ({ ...b, no: String(i + 1) }));
  }
  return Array.from({ length: t }, (_, i) => {
    const srcIdx = Math.min(list.length - 1, Math.max(0, Math.floor((i * list.length) / t)));
    const src = list[srcIdx];
    return { ...src, no: String(i + 1) };
  });
}

/** 写回 sections.plot，使剧情表行数 = 音频片段数 */
export function alignDirectorMvScriptSectionsToClipCount(
  sections: DirectorMvScriptSections,
  targetCount: number,
): DirectorMvScriptSections {
  const rows = parseDirectorMvPlotBeatTable(sections.plot);
  if (!rows?.length) return sections;
  const t = Math.max(0, Math.round(Number(targetCount) || 0));
  if (t <= 0) return sections;
  if (rows.length === t) {
    return {
      ...sections,
      plot: formatDirectorMvPlotBeatTable(rows.map((b, i) => ({ ...b, no: String(i + 1) }))),
    };
  }
  const aligned = alignDirectorMvPlotBeatsToCount(rows, t);
  if (!aligned?.length) return sections;
  return { ...sections, plot: formatDirectorMvPlotBeatTable(aligned) };
}

function focalToShotSize(focal: string, fallback: string): string {
  const f = String(focal || '');
  if (/14\s*mm|鱼眼|畸变|超广|空间感|wide/i.test(f)) return '全景';
  if (/24\s*mm|28\s*mm|广角|街拍/i.test(f)) return '全景';
  if (/85\s*mm|105\s*mm|135\s*mm|长焦|人像压|偷窥|浅景深|tele|压缩/i.test(f)) return '近景';
  if (/50\s*mm|中焦|人文|standard|标准/i.test(f)) return '中景';
  if (/微距|macro|贴脸/i.test(f)) return '特写';
  if (/35\s*mm|纪实/i.test(f)) return '中全景';
  if (/70\s*mm/.test(f)) return '中近景';
  return fallback;
}

function angleToCameraHint(angle: string): string {
  const a = String(angle || '');
  if (/俯|鸟瞰|高机|航拍|审判|overhead|high/i.test(a)) return '微俯缓降';
  if (/仰|低机|虫视|贴地|low/i.test(a)) return '微仰跟拍';
  if (/过肩|窥视|ot[sｓ]/i.test(a)) return '过肩缓推';
  if (/侧面|侧拍|侧窥|斜侧/i.test(a)) return '侧向平移';
  if (/荷兰|倾斜|失衡/i.test(a)) return '固定（荷兰角）';
  if (/远距|背影/i.test(a)) return '长焦缓拉';
  if (/贴脸|极近/i.test(a)) return '手持呼吸感';
  if (/窗框|三分|对位/i.test(a)) return '固定构图';
  if (/平视|正面/i.test(a)) return '缓推';
  return '';
}

/** 由剧情段推断景别 / 运镜 / 光影 / 角度 / 焦距（优先用表内角度与焦距） */
export function inferDirectorMvShotFramingFromBeat(
  beat: DirectorMvPlotBeatRow,
  opts?: { closeUpFraming?: boolean },
): {
  景别: string;
  运镜: string;
  光影氛围: string;
  镜头角度: string;
  焦距: string;
} {
  const section = String(beat.section || '');
  const mood = String(beat.mood || '').trim();
  const empty = beat.castType === '空镜';
  const isChorus = /副歌|高潮|chorus/i.test(section);
  const isBridge = /间奏|桥|bridge/i.test(section);
  const isOutro = /尾奏|outro|结尾/i.test(section);
  const isIntro = /前奏|intro/i.test(section);
  const closeUpOn = opts?.closeUpFraming === true;

  let 景别 = '中景';
  let 运镜 = '缓推';
  if (empty) {
    景别 = isIntro || isOutro ? '远景' : isBridge ? '全景' : '全景';
    运镜 = isBridge ? '缓移' : '固定';
  } else if (closeUpOn) {
    // 近景特写开：有人镜强制特写级，禁止半身/全身推断
    景别 = isChorus ? '大特写' : '特写';
    运镜 = /贴脸|极近/.test(String(beat.angle || '')) ? '手持呼吸感' : '缓推';
  } else if (isChorus) {
    景别 = '近景';
    运镜 = '缓推';
  } else if (isOutro) {
    景别 = '全身景';
    运镜 = '缓拉';
  } else if (isIntro) {
    景别 = '中全景';
    运镜 = '跟拍';
  } else if (isBridge) {
    景别 = '中景';
    运镜 = '平移';
  } else {
    景别 = '中近景';
    运镜 = '缓推';
  }

  const focal = String(beat.focal || '').trim();
  if (focal && focal !== '—' && !closeUpOn) {
    景别 = focalToShotSize(focal, 景别);
  } else if (focal && focal !== '—' && closeUpOn && !empty) {
    // 近景开仍可用焦距气质，但景别锁在特写
    if (/微距|macro|贴脸|大特写/i.test(focal)) 景别 = '大特写';
    else 景别 = '特写';
  }
  const angleCam = angleToCameraHint(String(beat.angle || ''));
  if (angleCam) {
    // 近景开时禁止「长焦缓拉」等拉开全身的运镜
    if (closeUpOn && !empty && /缓拉|拉远/.test(angleCam)) {
      运镜 = '手持呼吸感';
    } else {
      运镜 = angleCam;
    }
  }

  const angle = String(beat.angle || '').trim();
  const lightBits = empty
    ? [mood || '', '光色跟第1张分镜图，不要另写日照'].filter(Boolean)
    : [mood || '', '光影贴合情绪，人物与环境受光一致'].filter(Boolean);

  let 镜头角度 = angle && angle !== '—' ? angle : '';
  let 焦距Out = focal && focal !== '—' ? focal : '';
  if (closeUpOn && !empty) {
    if (!镜头角度 || /远距|背影|高机|航拍|鸟瞰/.test(镜头角度)) {
      镜头角度 = isChorus ? '贴脸极近' : '过肩窥视';
    }
    if (!焦距Out || /14\s*mm|24\s*mm|鱼眼|畸变|超广/i.test(焦距Out)) {
      焦距Out = isChorus ? '85mm人像压' : '70mm浅景深';
    }
  }

  return {
    景别,
    运镜,
    光影氛围:
      lightBits.join('，') ||
      (empty ? '光色跟第1张分镜图' : '人物与环境统一受光，情绪清晰'),
    镜头角度,
    焦距: 焦距Out,
  };
}

/** 从剧情段推出应出场角色标签 */
export function resolveDirectorMvBeatCastLabel(beat: DirectorMvPlotBeatRow): string {
  if (beat.castType === '空镜') return '—';
  const blob = `${beat.cast || ''}\n${beat.action || ''}`;
  const male = /男主/.test(blob);
  const female = /女主/.test(blob);
  const extras = /路人|群众|人群|行人|背景人/.test(blob);
  const bits: string[] = [];
  if (male) bits.push('男主');
  if (female) bits.push('女主');
  if (extras) bits.push('路人');
  if (bits.length) return bits.join('、');
  const cast = String(beat.cast || '').trim();
  if (cast && cast !== '—') return cast.replace(/[，,]/g, '、');
  return '—';
}

/** 由剧情段合成「画面描述」（角度/焦距已有独立列，此处不再重复写入） */
export function composeDirectorMvShotDescFromBeat(beat: DirectorMvPlotBeatRow): string {
  const scene = String(beat.scene || '').trim();
  const action = String(beat.action || '').trim();
  const mood = String(beat.mood || '').trim();
  const cast = resolveDirectorMvBeatCastLabel(beat);
  const empty = beat.castType === '空镜' || !cast || cast === '—';

  const parts: string[] = [];
  if (empty) {
    parts.push('空镜/无人物');
    if (scene && scene !== '—') parts.push(`场景：${scene}`);
    if (action && action !== '—') parts.push(action);
    else if (scene && scene !== '—') {
      parts.push(
        `${scene}：按场景公式写清年代气质、地点、物品陈设（名称+位置+状态）、材质与光线`,
      );
    }
    if (!/无人脸|无肢体|无人影|严禁任何人/.test(`${action}`)) {
      parts.push('严禁任何人、人脸、人形、雕像与疑似人形阴影，仅环境与静物');
    }
  } else {
    if (scene && scene !== '—') parts.push(`场景：${scene}`);
    parts.push(`出场：${cast}`);
    if (action && action !== '—') parts.push(action);
    else parts.push(`${cast}在画面中的姿态与运动（动作类型单选一条：手部/眼部/脸部/运镜）`);
  }
  if (mood && mood !== '—') parts.push(`情绪：${mood}`);
  return parts.filter(Boolean).join('。').replace(/。。+/g, '。');
}

/**
 * 用步骤四剧情明细表回填镜头表。
 */
/** 由单段剧情回填单镜字段（可按锁控制是否强制覆盖） */
export function applyDirectorMvPlotBeatToOneShot(
  shot: DirectorShot,
  beat: DirectorMvPlotBeatRow | null | undefined,
  opts?: {
    forceDesc?: boolean;
    forceFraming?: boolean;
    forceLipsyncAction?: boolean;
    closeUpFraming?: boolean;
    /** forceDesc 且画面描述变化时清空最终提示词，便于重拼 */
    clearFinalPromptOnDescChange?: boolean;
  },
): DirectorShot {
  if (!beat) return shot;
  const forceDesc = opts?.forceDesc !== false;
  const forceFraming = opts?.forceFraming === true;
  const forceLipsyncAction = opts?.forceLipsyncAction ?? forceDesc;
  const closeUpFraming = opts?.closeUpFraming === true;
  const clearFinal = opts?.clearFinalPromptOnDescChange !== false;

  const framing = inferDirectorMvShotFramingFromBeat(beat, { closeUpFraming });
  const descFromBeat = composeDirectorMvShotDescFromBeat(beat);
  const curDesc = String(shot['画面描述'] || '').trim();
  const scene = String(beat.scene || '').trim();
  const cast = resolveDirectorMvBeatCastLabel(beat);
  const empty = beat.castType === '空镜' || !cast || cast === '—';

  let 画面描述 = curDesc;
  if (forceDesc && descFromBeat) {
    画面描述 = descFromBeat;
  } else if (!curDesc && descFromBeat) {
    画面描述 = descFromBeat;
  } else if (curDesc && scene && scene !== '—' && !curDesc.includes(scene)) {
    画面描述 = `${curDesc.replace(/[。．]?$/, '')}。场景：${scene}`;
  }
  if (!empty && cast && cast !== '—' && 画面描述 && !画面描述.includes(cast)) {
    画面描述 = `${画面描述.replace(/[。．]?$/, '')}。出场：${cast}`;
  }
  if (empty && 画面描述 && !/空镜|无人物/.test(画面描述)) {
    画面描述 = `空镜/无人物。${画面描述}`;
  }

  const curSize = String(shot['景别'] || '').trim();
  const curCam = String(shot['运镜'] || '').trim();
  const curLight = String(shot['光影氛围'] || '').trim();
  const curAngle = String(shot['镜头角度'] || '').trim();
  const curFocal = String(shot['焦距'] || '').trim();
  const beatAngle = framing.镜头角度 || String(beat.angle || '').trim();
  const beatFocal = framing.焦距 || String(beat.focal || '').trim();

  const beatLipsync = String(beat.lipsyncAction || '').trim();
  const curLipsync = String(shot['对口型动作'] || '').trim();

  return {
    ...shot,
    画面描述,
    对口型动作:
      forceLipsyncAction || !curLipsync || curLipsync === '—'
        ? beat.vocal === '无人声'
          ? '—'
          : beatLipsync && beatLipsync !== '—'
            ? beatLipsync
            : curLipsync || '—'
        : curLipsync,
    镜头角度:
      forceFraming || !curAngle || curAngle === '—'
        ? beatAngle && beatAngle !== '—'
          ? beatAngle
          : curAngle
        : curAngle,
    焦距:
      forceFraming || !curFocal || curFocal === '—'
        ? beatFocal && beatFocal !== '—'
          ? beatFocal
          : curFocal
        : curFocal,
    景别: forceFraming || !curSize || curSize === '—' ? framing.景别 : curSize,
    运镜: forceFraming || !curCam || curCam === '—' ? framing.运镜 : curCam,
    光影氛围: forceFraming || !curLight || curLight === '—' ? framing.光影氛围 : curLight,
    ...(clearFinal && forceDesc && descFromBeat && descFromBeat !== curDesc
      ? { 最终提示词: '' }
      : {}),
  };
}

export function applyDirectorMvPlotBeatsToShots(
  shots: DirectorShot[],
  beats: DirectorMvPlotBeatRow[] | null | undefined,
  opts?: {
    forceDesc?: boolean;
    forceFraming?: boolean;
    closeUpFraming?: boolean;
    /** 保留手动添加的全空行，勿用剧情表灌画面描述 */
    preserveBlankShots?: boolean;
  },
): DirectorShot[] {
  const list = shots || [];
  const beatRows = beats || [];
  if (!list.length || !beatRows.length) return list;
  const forceDesc = opts?.forceDesc !== false;
  const forceFraming = opts?.forceFraming === true;
  const closeUpFraming = opts?.closeUpFraming === true;
  const preserveBlankShots = opts?.preserveBlankShots === true;

  return list.map((shot, i) => {
    if (preserveBlankShots && isBlankDirectorShot(shot)) return shot;
    const beat = mapDirectorMvShotIndexToPlotBeat(i, list.length, beatRows);
    return applyDirectorMvPlotBeatToOneShot(shot, beat, {
      forceDesc,
      forceFraming,
      forceLipsyncAction: forceDesc,
      closeUpFraming,
      clearFinalPromptOnDescChange: true,
    });
  });
}

/** 从导演状态读取可解析的剧情明细表 */
export function getDirectorMvPlotBeatsFromState(state: {
  mvStoryAnalysis?: { sections?: unknown } | null;
  scriptText?: string;
}): DirectorMvPlotBeatRow[] | null {
  const sections = normalizeDirectorMvScriptSections(state?.mvStoryAnalysis?.sections);
  let plot = String(sections.plot || '').trim();
  if (!plot) {
    plot = parseDirectorMvScriptSectionsFromText(String(state?.scriptText || '')).plot;
  }
  return (
    parseDirectorMvPlotBeatTable(plot) ||
    parseDirectorMvPlotBeatTable(String(state?.scriptText || '')) ||
    null
  );
}
