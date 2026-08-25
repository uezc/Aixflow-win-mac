/**
 * 卡拉OK 歌词角色标记：
 * - 括号形：`(男)` / `（女）` / `(合)`（全半角括号；规范显示半角括号 `(男)` 等）
 * - 冒号形：`男：` / `女:` / `合：`（全半角冒号均可解析；规范输出/显示/回写为全角 `男：` / `女：` / `合：`）
 * - 普通歌词中的半角 `:` 一并规范为全角 `：`（LRC 时间戳内冒号除外）
 * - 可显示为行首/行内标签
 * - 不参与字级 wipe / ASR 对齐
 * - 状态机：出现后后续字用该角色已唱色，直到下一标记
 * 单独汉字「男」「女」「合」不是标记，仍作唱词。
 */

import {
  assBgrToCssHex,
  KARAOKE_ROLE_SUNG_COLORS,
  resolveKaraokeRoleColors,
  type KaraokeCharTiming,
  type KaraokeLine,
  type KaraokeRole,
  type KaraokeRoleColors,
} from './types.js';

export type { KaraokeRole } from './types.js';

/** 角色已唱色 RGB hex（预览 CSS 默认） */
export const KARAOKE_ROLE_SUNG_CSS = {
  male: '#0000FF',
  female: '#FF0000',
  chorus: '#16E521',
} as const;

/** 角色已唱色 ASS BGR（= KARAOKE_ROLE_SUNG_COLORS） */
export const KARAOKE_ROLE_SUNG_ASS = KARAOKE_ROLE_SUNG_COLORS;

/**
 * 匹配角色标记：
 * - `[（(]\s*([男女合])\s*[）)]` → 捕获组 1
 * - `([男女合])\s*[：:]` → 捕获组 2
 * 二者互斥；取角色字用 `roleCharFromMarkerMatch`。
 */
export const KARAOKE_ROLE_MARKER_RE =
  /(?:[（(]\s*([男女合])\s*[）)]|([男女合])\s*[：:])/g;

const ROLE_CHAR_TO_ROLE: Record<string, KaraokeRole> = {
  男: 'male',
  女: 'female',
  合: 'chorus',
};

/** 从 RE 匹配结果取 男|女|合 */
function roleCharFromMarkerMatch(m: RegExpMatchArray): string {
  return String(m[1] || m[2] || '').trim();
}

/** 整段精确匹配用（须包非捕获组，避免 `^a|b$` 优先级问题） */
function exactKaraokeRoleMarkerRe(): RegExp {
  return new RegExp(`^(?:${KARAOKE_ROLE_MARKER_RE.source})$`);
}

function globalKaraokeRoleMarkerRe(): RegExp {
  return new RegExp(KARAOKE_ROLE_MARKER_RE.source, 'g');
}

export function karaokeRoleFromMarkerChar(ch: string): KaraokeRole | null {
  return ROLE_CHAR_TO_ROLE[String(ch || '').trim()] || null;
}

/** 整段文本是否恰好为一个角色标记 */
export function isKaraokeRoleMarker(text: string | undefined | null): boolean {
  const t = String(text || '').trim();
  if (!t) return false;
  return exactKaraokeRoleMarkerRe().test(t);
}

/** 解析单元文本为角色；非标记返回 null */
export function parseKaraokeRoleMarker(text: string | undefined | null): KaraokeRole | null {
  const t = String(text || '').trim();
  if (!t) return null;
  const m = exactKaraokeRoleMarkerRe().exec(t);
  if (!m) return null;
  return karaokeRoleFromMarkerChar(roleCharFromMarkerMatch(m));
}

/** 文本是否含角色标记 */
export function karaokeTextHasRoleMarker(text: string | undefined | null): boolean {
  const t = String(text || '');
  if (!t) return false;
  const re = globalKaraokeRoleMarkerRe();
  return re.test(t);
}

/** 去掉全部角色标记（对齐 / 字数统计用） */
export function stripKaraokeRoleMarkers(text: string | undefined | null): string {
  return String(text || '').replace(globalKaraokeRoleMarkerRe(), '');
}

/** 角色字 男|女|合 */
function roleCharFromRole(role: KaraokeRole): string {
  return role === 'male' ? '男' : role === 'female' ? '女' : '合';
}

/** 规范化括号形标记：`(男)`（半角括号） */
export function formatKaraokeRoleMarker(role: KaraokeRole): string {
  return `(${roleCharFromRole(role)})`;
}

/** 规范化冒号形标记：`男：`（中文全角冒号） */
export function formatKaraokeRoleMarkerColon(role: KaraokeRole): string {
  return `${roleCharFromRole(role)}：`;
}

/**
 * 半角 `:` → 全角 `：`。
 * 保留 LRC 时间戳 `[mm:ss]` / `[mm:ss.xx]` 内的半角冒号，避免破坏时间轴解析。
 */
export function normalizeKaraokeLyricColons(text: string | undefined | null): string {
  const raw = String(text || '');
  if (!raw.includes(':')) return raw;
  const placeholders: string[] = [];
  const protectedText = raw.replace(/\[\d{1,2}:\d{2}(?:[.:]\d{1,3})?\]/g, (m) => {
    const i = placeholders.length;
    placeholders.push(m);
    return `\uE000${i}\uE001`;
  });
  const converted = protectedText.replace(/:/g, '：');
  return converted.replace(/\uE000(\d+)\uE001/g, (_, i) => placeholders[Number(i)] || '');
}

/**
 * 显示用标记文本：保留括号/冒号形；
 * 已是标记则规范化标点，否则按 role 回退半角括号形。
 */
export function displayKaraokeRoleMarker(
  text: string | undefined | null,
  role?: KaraokeRole | null,
): string {
  if (isKaraokeRoleMarker(text)) return normalizeKaraokeRoleMarkerUnit(text);
  if (role) return formatKaraokeRoleMarker(role);
  return normalizeKaraokeLyricColons(text);
}

/**
 * 将文本中的角色标记按原形规范化，并把普通歌词半角冒号转为全角：
 * - 括号形 → 半角 `(男)`/`(女)`/`(合)`
 * - 冒号形 → 全角 `男：`/`女：`/`合：`（半角 `:` 自动换成中文 `：`）
 * - 其余 `:` → `：`（LRC 时间戳除外）
 */
export function normalizeKaraokeRoleMarkersInText(text: string | undefined | null): string {
  const re = globalKaraokeRoleMarkerRe();
  const withMarkers = String(text || '').replace(re, (full, g1: string, g2: string) => {
    const role = karaokeRoleFromMarkerChar(g1 || g2);
    if (!role) return full;
    // 捕获组 2 = 冒号形
    return g2 ? formatKaraokeRoleMarkerColon(role) : formatKaraokeRoleMarker(role);
  });
  return normalizeKaraokeLyricColons(withMarkers);
}

/** 单段若为角色标记则按原形规范标点，否则原样返回 */
export function normalizeKaraokeRoleMarkerUnit(text: string | undefined | null): string {
  const t = String(text || '').trim();
  if (!t) return String(text || '');
  const m = exactKaraokeRoleMarkerRe().exec(t);
  if (!m) return String(text || '');
  const role = karaokeRoleFromMarkerChar(roleCharFromMarkerMatch(m));
  if (!role) return String(text || '');
  return m[2] ? formatKaraokeRoleMarkerColon(role) : formatKaraokeRoleMarker(role);
}

export function karaokeRoleSungAss(
  role: KaraokeRole | null | undefined,
  colors?: Partial<KaraokeRoleColors> | null,
): string | null {
  if (!role) return null;
  const ass = (colors?.[role] && String(colors[role]).trim()) || KARAOKE_ROLE_SUNG_ASS[role];
  return ass || null;
}

export function karaokeRoleSungCss(
  role: KaraokeRole | null | undefined,
  colors?: Partial<KaraokeRoleColors> | null,
): string | null {
  if (!role) return null;
  const fallback = KARAOKE_ROLE_SUNG_CSS[role];
  const ass = karaokeRoleSungAss(role, colors);
  if (!ass) return null;
  return assBgrToCssHex(ass, fallback);
}

/**
 * 即将开唱行的已唱色（ASS BGR）：取首个唱词字角色色；无角色标记 → 男色。
 * 开场/间奏再入/每句倒计时点与指示灯同源。
 */
export function karaokeLineLeadSungAss(
  line: KaraokeLine | null | undefined,
  colors?: Partial<KaraokeRoleColors> | null,
): string {
  const roleColors = resolveKaraokeRoleColors(colors);
  if (line?.chars?.length) {
    for (const ch of line.chars) {
      if (ch.roleTag) continue;
      return karaokeRoleSungAss(ch.role, roleColors) || roleColors.male;
    }
    for (const ch of line.chars) {
      const ass = karaokeRoleSungAss(ch.role, roleColors);
      if (ass) return ass;
    }
  }
  return roleColors.male;
}

/** 即将开唱行的已唱色（CSS hex）；逻辑同 karaokeLineLeadSungAss */
export function karaokeLineLeadSungCss(
  line: KaraokeLine | null | undefined,
  colors?: Partial<KaraokeRoleColors> | null,
): string {
  const roleColors = resolveKaraokeRoleColors(colors);
  const maleCss = assBgrToCssHex(roleColors.male, KARAOKE_ROLE_SUNG_CSS.male);
  if (!line?.chars?.length) return maleCss;
  for (const ch of line.chars) {
    if (ch.roleTag) continue;
    return karaokeRoleSungCss(ch.role, roleColors) || maleCss;
  }
  for (const ch of line.chars) {
    const css = karaokeRoleSungCss(ch.role, roleColors);
    if (css) return css;
  }
  return maleCss;
}

/** 累加串是否仍可能是角色标记前缀（用于旧工程拆字迁移） */
export function couldBeKaraokeRoleMarkerPrefix(acc: string): boolean {
  const t = String(acc || '');
  if (!t || t.length > 6) return false;
  // 括号形
  if (/^[（(]$/.test(t)) return true;
  if (/^[（(]\s*$/.test(t)) return true;
  if (/^[（(]\s*[男女合]\s*$/.test(t)) return true;
  if (/^[（(]\s*[男女合]\s*[）)]$/.test(t)) return true;
  // 冒号形（单独「男」可为「男：」前缀；完整匹配后由 isKaraokeRoleMarker 消费）
  if (/^[男女合]$/.test(t)) return true;
  if (/^[男女合]\s*$/.test(t)) return true;
  if (/^[男女合]\s*[：:]$/.test(t)) return true;
  return false;
}

/**
 * 从旧字级数组中跳过角色标记跨度（含误拆成「（」「男」「）」或「男」「：」的情况），
 * 只保留唱词字的时间轴。
 */
export function extractSingableCharsSkippingRoleMarkers(
  chars: KaraokeCharTiming[] | null | undefined,
): KaraokeCharTiming[] {
  const list = chars || [];
  if (!list.length) return [];
  const out: KaraokeCharTiming[] = [];
  let i = 0;
  while (i < list.length) {
    if (list[i].roleTag || isKaraokeRoleMarker(list[i].text)) {
      i += 1;
      continue;
    }
    let acc = '';
    let j = i;
    let matchedEnd = -1;
    while (j < list.length && acc.length < 8) {
      acc += String(list[j].text || '');
      if (isKaraokeRoleMarker(acc)) {
        matchedEnd = j;
        break;
      }
      if (!couldBeKaraokeRoleMarkerPrefix(acc)) break;
      j += 1;
    }
    if (matchedEnd >= 0) {
      i = matchedEnd + 1;
      continue;
    }
    out.push({ ...list[i] });
    i += 1;
  }
  return out;
}

/**
 * 将唱词时间轴与角色标记单元编织成完整 chars，并套用状态机颜色。
 * `singableTimed` 与 strip 后的唱词单元一一对应。
 */
export function weaveKaraokeRoleChars(
  units: string[],
  singableTimed: KaraokeCharTiming[],
  incomingRole: KaraokeRole | null = null,
): { chars: KaraokeCharTiming[]; carryRole: KaraokeRole | null } {
  let role: KaraokeRole | null = incomingRole;
  let ti = 0;
  const chars: KaraokeCharTiming[] = [];
  for (const u of units) {
    const markerRole = parseKaraokeRoleMarker(u);
    if (markerRole) {
      role = markerRole;
      const t =
        ti < singableTimed.length
          ? Number(singableTimed[ti].startSec) || 0
          : chars.length
            ? Number(chars[chars.length - 1].endSec) || 0
            : Number(singableTimed[0]?.startSec) || 0;
      chars.push({
        text: normalizeKaraokeRoleMarkerUnit(u),
        startSec: t,
        endSec: t,
        roleTag: true,
        role: markerRole,
      });
      continue;
    }
    const base = singableTimed[ti];
    ti += 1;
    if (!base) {
      const t = chars.length ? Number(chars[chars.length - 1].endSec) || 0 : 0;
      chars.push({
        text: u,
        startSec: t,
        endSec: t + 0.03,
        ...(role ? { role } : {}),
      });
      continue;
    }
    chars.push({
      text: u,
      startSec: base.startSec,
      endSec: base.endSec,
      ...(role ? { role } : {}),
    });
  }
  return { chars, carryRole: role };
}

/**
 * 跨行状态机：标注 role / roleTag；有标记的行会重编织字级（标记不占 wipe 时长）。
 * 无标记行仅继承上一角色色。曲首无标记时 role 为空 → 沿用男色（sungColor = roleColors.male）。
 */
export function annotateKaraokeLinesRoles(lines: KaraokeLine[]): KaraokeLine[] {
  let carry: KaraokeRole | null = null;
  return (lines || []).map((line) => {
    if (line.instrumental) return line;
    const rawText = String(line.text || line.chars?.map((c) => c.text).join('') || '');
    const text = normalizeKaraokeRoleMarkersInText(rawText);
    const units = splitKaraokeUnitsKeepingRoles(text);
    if (!units.length) return line;

    if (!karaokeTextHasRoleMarker(text) && !line.chars?.some((c) => c.roleTag || c.role)) {
      const prevChars = line.chars || [];
      const chars = prevChars.map((c) => {
        const ct = normalizeKaraokeLyricColons(c.text);
        return ct === c.text ? c : { ...c, text: ct };
      });
      const charsChanged = chars.some((c, i) => c.text !== prevChars[i]?.text);
      if (!carry) {
        if (text === rawText && !charsChanged) return line;
        return {
          ...line,
          text,
          ...(prevChars.length ? { chars } : {}),
        };
      }
      return {
        ...line,
        text,
        chars: chars.map((c) => ({ ...c, role: carry! })),
      };
    }

    const singableTimed = extractSingableCharsSkippingRoleMarkers(line.chars);
    const singableUnits = units.filter((u) => !isKaraokeRoleMarker(u));
    let timed = singableTimed;
    if (timed.length !== singableUnits.length) {
      // 数量对不上时按行窗均分唱词（标记仍不占时长）
      const lo = Number(line.startSec) || 0;
      const hi = Math.max(lo + 0.05, Number(line.endSec) || lo + 0.05);
      timed = distributeUniformCharTiming(singableUnits, lo, hi);
    } else {
      // 纠正文本与单元一致
      timed = timed.map((c, i) => ({ ...c, text: singableUnits[i] }));
    }

    const woven = weaveKaraokeRoleChars(units, timed, carry);
    carry = woven.carryRole;
    return {
      ...line,
      text: text || woven.chars.map((c) => c.text).join(''),
      chars: woven.chars,
    };
  });
}

function distributeUniformCharTiming(
  units: string[],
  startSec: number,
  endSec: number,
): KaraokeCharTiming[] {
  if (!units.length) return [];
  const start = Math.max(0, startSec);
  const end = Math.max(start + 0.05, endSec);
  const span = end - start;
  const n = units.length;
  const out: KaraokeCharTiming[] = [];
  for (let i = 0; i < n; i++) {
    const s = start + (span * i) / n;
    const e = i === n - 1 ? end : start + (span * (i + 1)) / n;
    out.push({ text: units[i], startSec: s, endSec: Math.max(s + 0.03, e) });
  }
  return out;
}

/** 非角色标记段：CJK/标点逐字，拉丁按词（与 wordTiming 一致） */
function splitPlainKaraokeUnits(text: string): string[] {
  const raw = String(text || '');
  if (!raw) return [];
  const units: string[] = [];
  let latin = '';
  const flushLatin = () => {
    if (!latin) return;
    units.push(latin);
    latin = '';
  };
  for (const ch of Array.from(raw)) {
    if (/\s/.test(ch)) {
      if (latin) {
        latin += ch;
        flushLatin();
      } else if (units.length > 0) {
        units[units.length - 1] += ch;
      }
      continue;
    }
    if (/[A-Za-z0-9'']/.test(ch)) {
      latin += ch;
      continue;
    }
    flushLatin();
    units.push(ch);
  }
  flushLatin();
  return units.filter((u) => u.length > 0 && !/^\s+$/.test(u));
}

/**
 * 拆卡拉OK 字单元：角色标记收成原子，其余 CJK 逐字 / 拉丁按词。
 * wordTiming.splitKaraokeUnits 直接委托本函数。
 */
export function splitKaraokeUnitsKeepingRoles(text: string): string[] {
  const raw = String(text || '');
  if (!raw) return [];
  const out: string[] = [];
  let last = 0;
  const re = globalKaraokeRoleMarkerRe();
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw))) {
    if (m.index > last) out.push(...splitPlainKaraokeUnits(raw.slice(last, m.index)));
    const role = karaokeRoleFromMarkerChar(roleCharFromMarkerMatch(m));
    out.push(role ? normalizeKaraokeRoleMarkerUnit(m[0]) : m[0]);
    last = m.index + m[0].length;
  }
  if (last < raw.length) out.push(...splitPlainKaraokeUnits(raw.slice(last)));
  return out;
}
