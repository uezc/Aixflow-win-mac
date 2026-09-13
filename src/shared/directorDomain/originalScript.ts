/**
 * 原文保真分析：本地切分 Scene / OriginalSegment，绑定已有素材。
 * 剧本拆分：Narrative Beat → Shot Beat → H3 Clip（硬切必拆；同链合并；超 H3 上限再软拆）。
 * 中英文冒号结尾的句子不与后文拆开。
 * 素材人物只收主要/次要（开口≥2次）；只出现一次的配角不建卡。
 * 时长软拆：估时落在 6/10/15 ±35% 内不拆（约 20 秒仍是 15 档）。
 * 切出来不足 25 字、冒号结尾、或同一人物话没说完，不拆。
 * 脚本设计：本地挂素材匹配 + 已选视觉风格，不改写原文、不填景别/运镜。
 * 不改写剧情、不创建假角色卡。
 */

import {
  coreDramaPersonName,
  extractCharacterNamesFromScriptText,
  isDramaCharacterNamePlausible,
  isDramaNonCastLabel,
  isDramaStrictCastName,
  isDramaSceneTransitionText,
  isSystemSpeakerName,
  stripDramaMarkdownDecor,
} from './extractCastFromScript.js';
import { characterHasUsableReference, sceneHasUsableReference } from './constraints.js';
import { DRAMA_SYSTEM_HOLOGRAM_VISUAL_ZH } from './voiceEntity.js';
import {
  originalSegmentToFastPaceInput,
  packDramaFastPaceScene,
  packDramaFastPaceByDurationTiers,
  snapDramaFastPaceTierSec,
  snapDramaDurationSplitTierSec,
  estimateDramaFastPaceSegment,
  durationSplitHardCapSec,
  DRAMA_FAST_PACE_DURATION_CONFIG,
} from './shotDurationFastPace.js';
import type { DramaVisualEvent } from './shotPlanning.js';
import { parseDramaH3CraftTag } from './prompts/h3VideoCraftHandbook.js';
import type {
  DramaAssetBindingStatus,
  DramaCharacter,
  DramaCharacterBinding,
  DramaEpisodeAnalysisSummary,
  DramaOriginalIntegrityReport,
  DramaOriginalScene,
  DramaOriginalSegment,
  DramaOriginalSegmentType,
  DramaOriginalSourceRange,
  DramaProjectVisualBible,
  DramaSceneAsset,
  DramaSceneAssetBinding,
  DramaSceneBeat,
  DramaShotSuggestion,
  DramaVisualBibleBinding,
  DramaVoice,
  DramaVoiceBinding,
} from './types.js';

export interface DramaParsedSceneHeading {
  scene_number: number;
  scene_no: string;
  location_type: string;
  location: string;
  time: string;
}

export interface DramaOriginalAnalyzeInput {
  source: string;
  episodeId: string;
  characters: DramaCharacter[];
  scenes: DramaSceneAsset[];
  voices: DramaVoice[];
  visualBible?: DramaProjectVisualBible | null;
}

export interface DramaOriginalAnalyzeResult {
  original_scenes: DramaOriginalScene[];
  original_segments: DramaOriginalSegment[];
  visual_events: DramaVisualEvent[];
  scene_beats: DramaSceneBeat[];
  character_bindings: DramaCharacterBinding[];
  voice_bindings: DramaVoiceBinding[];
  scene_bindings: DramaSceneAssetBinding[];
  visual_bible_binding: DramaVisualBibleBinding;
  integrity: DramaOriginalIntegrityReport;
  summary: DramaEpisodeAnalysisSummary;
  /** 按场次写入整段原文（action=原文），不含导演切镜（景别/运镜由脚本设计负责） */
  shot_suggestions: DramaShotSuggestion[];
}

interface LineRec {
  raw: string;
  start: number;
  end: number;
}

const STANDARD_SCENE_HEADING_RE =
  /^(?:#{1,6}\s*)?(\d{1,3})\.\s*(内景|外景|内|外)\s+(.+)$/;

export const DRAMA_LEGACY_SCENE_MARKER_RE =
  /(?:【\s*(?:S\d+|第[一二三四五六七八九十\d]+[场幕]|场景[一二三四五六七八九十\d]?)\s*[^】]*】)|(?:第[一二三四五六七八九十\d]+[场幕][\s:：][^\n]*)|(?:场景[一二三四五六七八九十\d]+[\s:：][^\n]*)|(?:^场景\s*[:：]\s*[^\n]+)/;

const TRANSITION_RE =
  /^(切至|淡入|淡出|CUT\s*TO|FADE\s*IN|FADE\s*OUT)\s*[:：]?\s*(.*)$/i;
const SCREEN_TEXT_RE = /^【\s*弹幕/;
const MONTAGE_RE = /^【[^】]*蒙太奇/;
const SYSTEM_BLOCK_RE = /^【\s*系统/;

function padSceneNo(n: number): string {
  return `S${String(Math.max(1, n)).padStart(2, '0')}`;
}

function padSegId(n: number): string {
  return `SEG${String(Math.max(1, n)).padStart(3, '0')}`;
}

function padEventId(n: number): string {
  return `EV${String(Math.max(1, n)).padStart(3, '0')}`;
}

/** 场次号重复时（两个「## 4.」）仍拆成两场，scene_id 保持唯一 */
function allocOriginalSceneNos(
  heading: DramaParsedSceneHeading,
  existing: DramaOriginalScene[],
): { scene_id: string; scene_no: string } {
  const occ = existing.filter((s) => s.scene_number === heading.scene_number).length;
  const base = padSceneNo(heading.scene_number);
  const scene_no = occ === 0 ? base : `${base}-${occ + 1}`;
  return { scene_id: scene_no, scene_no };
}

function cnToNum(cn: string): number {
  const map: Record<string, number> = {
    一: 1,
    二: 2,
    三: 3,
    四: 4,
    五: 5,
    六: 6,
    七: 7,
    八: 8,
    九: 9,
    十: 10,
  };
  return map[cn] || 1;
}

function splitLocationTime(rest: string): { location: string; time: string } {
  const s = String(rest || '').trim();
  const m = s.match(/^(.*?)\s*[-—–－]\s*(.+)$/);
  if (m) return { location: m[1].trim(), time: m[2].trim() };
  return { location: s, time: '' };
}

function parseLegacySceneMarker(marker: string): DramaParsedSceneHeading | null {
  const s = String(marker || '').trim();
  if (!s || !DRAMA_LEGACY_SCENE_MARKER_RE.test(s)) return null;
  let m = s.match(/【\s*S(\d+)/i);
  if (m) {
    const num = Number(m[1]) || 1;
    const rest = s.replace(/【\s*S\d+\s*/i, '').replace(/】$/, '').trim();
    const { location, time } = splitLocationTime(rest);
    return { scene_number: num, scene_no: padSceneNo(num), location_type: '', location: location || `场景${num}`, time };
  }
  m = s.match(/第([一二三四五六七八九十\d]+)[场幕]/);
  if (m) {
    const num = m[1].match(/\d+/) ? Number(m[1]) : cnToNum(m[1]);
    const rest = s.replace(/第[一二三四五六七八九十\d]+[场幕]\s*/, '').replace(/^[:：]\s*/, '').trim();
    const { location, time } = splitLocationTime(rest.replace(/】$/, ''));
    return {
      scene_number: num || 1,
      scene_no: padSceneNo(num || 1),
      location_type: '',
      location: location || `场景${num || 1}`,
      time,
    };
  }
  m = s.match(/场景([一二三四五六七八九十\d]+)\s*[:：]\s*(.*)$/);
  if (m) {
    const num = m[1].match(/\d+/) ? Number(m[1]) : cnToNum(m[1]);
    const rest = String(m[2] || '').replace(/】$/, '').trim();
    const { location, time } = splitLocationTime(rest);
    return {
      scene_number: num || 1,
      scene_no: padSceneNo(num || 1),
      location_type: '',
      location: location || `场景${num || 1}`,
      time,
    };
  }
  m = s.match(/场景\s*[:：]?\s*(.+)/);
  if (m) {
    const name = m[1].replace(/】$/, '').trim();
    const num = Number(name.match(/\d+/)?.[0] || '1') || 1;
    const { location, time } = splitLocationTime(name);
    return { scene_number: num, scene_no: padSceneNo(num), location_type: '', location: location || name, time };
  }
  return null;
}

export function parseDramaSceneHeadingLine(trimmed: string): DramaParsedSceneHeading | null {
  const s = stripDramaMarkdownDecor(String(trimmed || '').trim());
  if (!s) return null;
  const craftField = parseDramaH3CraftTag(s);
  if (craftField?.tag === '场' && craftField.rest) {
    const rest = craftField.rest;
    const ie = rest.match(/^(内景|外景|内|外)\s+(.+)$/);
    const { location, time } = splitLocationTime(ie ? ie[2] : rest);
    return {
      scene_number: 1,
      scene_no: padSceneNo(1),
      location_type: ie ? ie[1] : '',
      location: location || rest,
      time,
    };
  }
  const std = s.match(STANDARD_SCENE_HEADING_RE);
  if (std) {
    const num = Number(std[1]) || 1;
    const { location, time } = splitLocationTime(std[3] || '');
    return {
      scene_number: num,
      scene_no: padSceneNo(num),
      location_type: String(std[2] || '').trim(),
      location,
      time,
    };
  }
  return parseLegacySceneMarker(s);
}

export function isDramaSceneHeadingLine(trimmed: string): boolean {
  return !!parseDramaSceneHeadingLine(trimmed);
}

function splitLinesWithOffsets(text: string): LineRec[] {
  const out: LineRec[] = [];
  let i = 0;
  while (i < text.length) {
    const nl = text.indexOf('\n', i);
    const end = nl < 0 ? text.length : nl;
    let lineEnd = end;
    if (lineEnd > i && text[lineEnd - 1] === '\r') lineEnd -= 1;
    out.push({ raw: text.slice(i, lineEnd), start: i, end: lineEnd });
    if (nl < 0) break;
    i = nl + 1;
  }
  return out;
}

function sliceSource(source: string, start: number, end: number): string {
  return source.slice(Math.max(0, start), Math.max(start, end));
}

function lineTrim(line: LineRec): string {
  return line.raw.replace(/\s+$/, '').trim();
}

/** 中英文冒号收尾：剧本拆分不得在此后切开 */
export function originalLineEndsWithColon(text: string): boolean {
  const t = String(text || '').trim();
  return /[：:]$/.test(t);
}

function isBlankLine(line: LineRec): boolean {
  return !lineTrim(line);
}

/**
 * 分场时跳过的元信息/装饰行：标题、作者、分隔线、单独书名等，不进入原文片段。
 */
export function isDramaScriptMetaNoiseLine(trimmed: string): boolean {
  const raw = String(trimmed || '').trim();
  if (!raw) return true;
  const t = stripDramaMarkdownDecor(raw).trim();
  if (!t) return true;
  // --- / *** / ═══ 等装饰分隔
  if (/^[-–—_*·•─═=~]{3,}$/.test(t)) return true;
  if (/^(?:标题|书名|作品名|剧名|片名)\s*[:：]/.test(t)) return true;
  if (
    /^(?:作者|编剧|出品|监制|导演|字数|集数|类型|题材|简介|梗概|大纲|备注|说明|版本)\s*[:：]/.test(
      t,
    )
  ) {
    return true;
  }
  // 单独《书名》或加粗书名行
  if (/^《[^》\n]{1,40}》$/.test(t)) return true;
  // 仅「第N集」而无正文
  if (/^第\s*[0-9一二三四五六七八九十百千]+\s*集$/.test(t)) return true;
  if (/^EP\.?\s*\d+$/i.test(t)) return true;
  return false;
}

function isStructureBreak(trimmed: string, knownNames: string[]): boolean {
  if (!trimmed) return true;
  if (isDramaScriptMetaNoiseLine(trimmed)) return true;
  const craft = parseDramaH3CraftTag(trimmed);
  if (craft && craft.tag !== '台') return true;
  if (parseDramaSceneHeadingLine(trimmed)) return true;
  if (TRANSITION_RE.test(trimmed)) return true;
  if (SCREEN_TEXT_RE.test(trimmed)) return true;
  if (MONTAGE_RE.test(trimmed)) return true;
  if (SYSTEM_BLOCK_RE.test(trimmed)) return true;
  if (parseSpeakerCue(trimmed, knownNames)) return true;
  return false;
}

function extractBracketMeta(text: string): { title: string; note: string } {
  const inner = text.replace(/^【/, '').replace(/】$/, '').trim();
  const m = inner.match(/^([^（(]+)[（(]([^)）]*)[)）]\s*$/);
  if (m) return { title: m[1].trim(), note: m[2].trim() };
  return { title: inner, note: '' };
}

function parseSpeakerCue(
  trimmed: string,
  knownNames: string[],
): { name: string; performance: string; dialogue: string; system: boolean; innerOs?: boolean } | null {
  const s = stripDramaMarkdownDecor(String(trimmed || '').trim());
  if (!s) return null;
  if (parseDramaSceneHeadingLine(s)) return null;
  if (TRANSITION_RE.test(s) || SCREEN_TEXT_RE.test(s) || MONTAGE_RE.test(s) || SYSTEM_BLOCK_RE.test(s)) {
    return null;
  }

  const thought = s.match(
    /^([\u4e00-\u9fffA-Za-z·•]{2,16})\s*(?:心想|心里想|暗想)\s*[:：]\s*(.*)$/,
  );
  if (thought) {
    const name = thought[1].trim();
    if (isSpeakerName(name, knownNames) && !isSystemSpeakerName(name)) {
      return {
        name,
        performance: '内心OS',
        dialogue: String(thought[2] || '').trim(),
        system: false,
        innerOs: true,
      };
    }
  }

  const oneLine = s.match(
    /^([\u4e00-\u9fffA-Za-z·•]{2,16})\s*(?:[（(]([^)）]*)[)）])?\s*[:：]\s*(.+)$/,
  );
  if (oneLine) {
    const name = oneLine[1].trim();
    if (isDramaSceneTransitionText(name) || isDramaSceneTransitionText(`${name}：`)) {
      return null;
    }
    if (/(?:心想|心里想|暗想)$/.test(name)) return null;
    if (isSpeakerName(name, knownNames)) {
      return {
        name,
        performance: String(oneLine[2] || '').trim(),
        dialogue: String(oneLine[3] || '').trim(),
        system: isSystemSpeakerName(name),
      };
    }
  }

  const sysPeriod = s.match(
    /^(系统提示音|系统声音|系统提示|系统播报|系统音|系统|SYSTEM|System|机械声音|电子声音|机械提示音|机械女声)\s*(?:[（(]([^)）]*)[)）])?\s*[：:。.]\s*(.+)$/i,
  );
  if (sysPeriod) {
    return {
      name: sysPeriod[1].trim(),
      performance: String(sysPeriod[2] || '').trim(),
      dialogue: String(sysPeriod[3] || '').trim(),
      system: true,
    };
  }

  const guideCue = s.match(/^(新手引导)\s*[：:]\s*(.+)$/);
  if (guideCue) {
    return {
      name: '系统',
      performance: '',
      dialogue: String(guideCue[2] || '').trim(),
      system: true,
    };
  }

  const nameColonOnly = s.match(
    /^([\u4e00-\u9fffA-Za-z·•]{2,16})\s*(?:[（(]([^)）]*)[)）])?\s*[:：]\s*$/,
  );
  if (nameColonOnly) {
    const name = nameColonOnly[1].trim();
    if (isSpeakerName(name, knownNames)) {
      return {
        name,
        performance: String(nameColonOnly[2] || '').trim(),
        dialogue: '',
        system: isSystemSpeakerName(name),
      };
    }
  }

  const nameParen = s.match(/^([\u4e00-\u9fffA-Za-z·•]{2,16})\s*[（(]([^)）]*)[)）]\s*$/);
  if (nameParen) {
    const name = nameParen[1].trim();
    if (isSpeakerName(name, knownNames)) {
      return { name, performance: String(nameParen[2] || '').trim(), dialogue: '', system: isSystemSpeakerName(name) };
    }
  }

  if (
    isSpeakerName(s, knownNames) &&
    !/\s/.test(s) &&
    !/[—–\-，,。！？!?…：:、]/.test(s)
  ) {
    return { name: s, performance: '', dialogue: '', system: isSystemSpeakerName(s) };
  }
  return null;
}

function isSpeakerName(name: string, knownNames: string[]): boolean {
  const n = String(name || '').trim();
  if (!n || n.length > 16) return false;
  if (isDramaNonCastLabel(n)) return false;
  if (knownNames.some((k) => k === n || coreDramaPersonName(k) === n)) return true;
  if (isSystemSpeakerName(n)) return true;
  return isDramaCharacterNamePlausible(n);
}

/** 【画】【台】【元】【转】：从本行吃到下一标签/场次之前 */
function consumeH3CraftBlock(
  lines: LineRec[],
  start: number,
  knownNames: string[],
): number {
  let j = start + 1;
  while (j < lines.length) {
    const t = lineTrim(lines[j]);
    if (!t) {
      let k = j + 1;
      while (k < lines.length && isBlankLine(lines[k])) k += 1;
      if (k >= lines.length) return Math.max(start, j - 1);
      const next = lineTrim(lines[k]);
      if (
        parseDramaH3CraftTag(next) ||
        parseDramaSceneHeadingLine(next) ||
        TRANSITION_RE.test(next) ||
        SCREEN_TEXT_RE.test(next) ||
        MONTAGE_RE.test(next) ||
        SYSTEM_BLOCK_RE.test(next)
      ) {
        return Math.max(start, j - 1);
      }
      j = k;
      continue;
    }
    if (parseDramaH3CraftTag(t) || parseDramaSceneHeadingLine(t)) return j - 1;
    if (TRANSITION_RE.test(t) || SCREEN_TEXT_RE.test(t) || MONTAGE_RE.test(t) || SYSTEM_BLOCK_RE.test(t)) {
      return j - 1;
    }
    if (knownNames.length && parseSpeakerCue(t, knownNames) && parseDramaH3CraftTag(lineTrim(lines[start]))?.tag === '画') {
      return j - 1;
    }
    j += 1;
  }
  return lines.length - 1;
}

function collectBracketBlock(lines: LineRec[], start: number): { end: number; closed: boolean } {
  let i = start;
  const first = lineTrim(lines[i]);
  if (first.includes('】')) return { end: i, closed: true };
  i += 1;
  while (i < lines.length) {
    const t = lineTrim(lines[i]);
    if (t.includes('】')) return { end: i, closed: true };
    if (!t) break;
    i += 1;
  }
  return { end: Math.max(start, i - 1), closed: false };
}

function uniqueKeepOrder(names: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of names) {
    const n = String(raw || '').trim();
    if (!n || seen.has(n)) continue;
    seen.add(n);
    out.push(n);
  }
  return out;
}

/** 对白说话人按小说首次出现顺序（素材人物排序真源） */
export function collectOriginalSpeakerNamesInOrder(
  segments: DramaOriginalSegment[],
): string[] {
  return collectOriginalSpeakerAppearances(segments)
    .filter((a) => a.tier !== 'extra')
    .map((a) => a.name);
}

/** 至少开口 2 次才进素材：一次过场的龙套不建卡 */
export const DRAMA_CAST_MIN_TALK_TURNS = 2;

export type DramaCastTier = 'lead' | 'support' | 'extra';

export interface DramaSpeakerAppearance {
  name: string;
  talkTurns: number;
  sceneCount: number;
  tier: DramaCastTier;
}

function isOriginalTalkSpeakerSegment(seg: DramaOriginalSegment): boolean {
  return seg.type === 'dialogue' || seg.type === 'system' || seg.type === 'narration';
}

export function classifyDramaSpeakerTier(talkTurns: number, sceneCount: number): DramaCastTier {
  if (talkTurns < DRAMA_CAST_MIN_TALK_TURNS) return 'extra';
  if (sceneCount >= 2 || talkTurns >= 4) return 'lead';
  return 'support';
}

/** 统计每位说话人开口次数与出场场次；只出现一次的配角标 extra */
export function collectOriginalSpeakerAppearances(
  segments: DramaOriginalSegment[],
): DramaSpeakerAppearance[] {
  const sourceText = (segments || []).map((s) => String(s.original_text || '')).join('\n');
  const order: string[] = [];
  const byKey = new Map<string, { name: string; talkTurns: number; scenes: Set<string> }>();
  for (const seg of segments || []) {
    if (!isOriginalTalkSpeakerSegment(seg)) continue;
    const raw = String(seg.character_name || '').trim();
    if (!raw) continue;
    if (isSystemSpeakerName(raw)) continue;
    if (isDramaNonCastLabel(raw)) continue;
    if (!isDramaStrictCastName(raw, sourceText)) continue;
    const name = coreDramaPersonName(raw) || raw;
    const k = name.toLowerCase();
    let rec = byKey.get(k);
    if (!rec) {
      rec = { name, talkTurns: 0, scenes: new Set() };
      byKey.set(k, rec);
      order.push(k);
    }
    rec.talkTurns += 1;
    const scene = String(seg.scene_id || seg.scene_no || '').trim();
    if (scene) rec.scenes.add(scene);
  }
  return order.map((k) => {
    const rec = byKey.get(k)!;
    const sceneCount = rec.scenes.size;
    return {
      name: rec.name,
      talkTurns: rec.talkTurns,
      sceneCount,
      tier: classifyDramaSpeakerTier(rec.talkTurns, sceneCount),
    };
  });
}

export function findOriginalSpeakerAppearance(
  segments: DramaOriginalSegment[],
  name: string,
): DramaSpeakerAppearance | undefined {
  const core = coreDramaPersonName(name) || String(name || '').trim();
  if (!core) return undefined;
  return collectOriginalSpeakerAppearances(segments).find(
    (a) => a.name === core || a.name.toLowerCase() === core.toLowerCase(),
  );
}

/** 主要/次要才准入素材；只出现一次的配角排除 */
export function isDramaKeepCastSpeaker(name: string, segments: DramaOriginalSegment[]): boolean {
  const hit = findOriginalSpeakerAppearance(segments, name);
  return !!hit && hit.tier !== 'extra';
}

export function dramaCastTierLabel(tier: DramaCastTier): string {
  if (tier === 'lead') return '主要角色';
  if (tier === 'support') return '次要角色';
  return '配角';
}

/** 场景地点按场次首次出现顺序（素材场景排序真源） */
export function collectOriginalSceneLocationsInOrder(
  scenes: DramaOriginalScene[],
): string[] {
  const sorted = [...(scenes || [])].sort(
    (a, b) => (Number(a.order) || 0) - (Number(b.order) || 0),
  );
  return uniqueKeepOrder(sorted.map((s) => String(s.location || '').trim()).filter(Boolean));
}

/** 正文里出现的人名：长名优先，避免「长老」吞掉「执事长老」 */
export function namesMentionedInText(text: string, catalog: string[]): string[] {
  const src = String(text || '');
  if (!src) return [];
  const names = uniqueKeepOrder(catalog.filter((n) => n && src.includes(n))).sort(
    (a, b) => b.length - a.length,
  );
  const kept: string[] = [];
  for (const name of names) {
    const subsumed = kept.some((longer) => {
      if (!longer.includes(name) || longer === name) return false;
      let from = 0;
      let idx = src.indexOf(name, from);
      while (idx >= 0) {
        const insideLonger = src.slice(Math.max(0, idx - (longer.length - name.length)), idx + longer.length).includes(
          longer,
        );
        if (!insideLonger) return false;
        from = idx + name.length;
        idx = src.indexOf(name, from);
      }
      return true;
    });
    if (!subsumed) kept.push(name);
  }
  return kept;
}

/** 视线/看向宾语区间：这些名字是对象，不是动作主语 */
const DRAMA_GAZE_OBJECT_RE =
  /(?:看向|望向|目光(?:投向|落在)?|视线(?:投向|落在)?|看着|转头看向|回头看向|转向)[着]?([^，。,.\s「」"“”]{1,16})/g;

const DRAMA_ACTION_SUBJECT_LEAD_RE =
  /^([\u4e00-\u9fffA-Za-z·]{1,12}?)(?=没有|不(?:回答|说话|语)|转头|回头|看向|望向|看着|拿起|走进|走入|站定|起身|走向|坐下|推门|开口|点头|摇头|沉默|打了|哈欠|灌了|靠在|掏出|站在)/;

function dramaGazeObjectSpans(text: string): Array<{ start: number; end: number; name: string }> {
  const src = String(text || '');
  const out: Array<{ start: number; end: number; name: string }> = [];
  DRAMA_GAZE_OBJECT_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = DRAMA_GAZE_OBJECT_RE.exec(src))) {
    const name = String(m[1] || '').trim();
    if (!name) continue;
    const start = m.index + m[0].length - name.length;
    out.push({ start, end: start + name.length, name });
  }
  return out;
}

function nameOccursOutsideGazeObjects(src: string, name: string, spans: Array<{ start: number; end: number }>): number {
  let from = 0;
  let idx = src.indexOf(name, from);
  while (idx >= 0) {
    const end = idx + name.length;
    const onlyObject = spans.some((s) => idx >= s.start && end <= s.end);
    if (!onlyObject) return idx;
    from = end;
    idx = src.indexOf(name, from);
  }
  return -1;
}

/**
 * 动作段主语：以句中动作发起者为准。
 * 「江澈没有回答，转头看向执事长老」→ 江澈（看向后的执事长老是宾语）。
 * 「青衫少年看向江澈」→ 少年（江澈是看向对象）。
 * 「他打了个哈欠」→ 回落 previousWho（代词主语）。
 */
export function resolveDramaActionSubjectName(
  text: string,
  catalog: string[] = [],
  opts?: { previousWho?: string },
): string {
  const src = String(text || '')
    .trim()
    .replace(/^【\s*(?:画|台|转|元)\s*】\s*/m, '')
    .trim();
  if (!src) return '';
  const prev = String(opts?.previousWho || '').trim();
  if (/^(?:他|她|他们|她们)(?:们)?/.test(src) && prev) return prev;
  const spans = dramaGazeObjectSpans(src);
  const mentioned = namesMentionedInText(src, catalog);
  const subjectHits: Array<{ name: string; idx: number }> = [];
  for (const name of mentioned) {
    const idx = nameOccursOutsideGazeObjects(src, name, spans);
    if (idx >= 0) subjectHits.push({ name, idx });
  }
  if (subjectHits.length) {
    subjectHits.sort((a, b) => a.idx - b.idx || b.name.length - a.name.length);
    return subjectHits[0].name;
  }
  const lead = src.match(DRAMA_ACTION_SUBJECT_LEAD_RE);
  if (lead) {
    const raw = String(lead[1] || '').trim();
    if (/^(?:他|她|他们|她们)$/.test(raw) && prev) return prev;
    const fromCatalog = mentioned
      .filter((n) => raw.endsWith(n) || raw.includes(n))
      .sort((a, b) => b.length - a.length)[0];
    if (fromCatalog) return fromCatalog;
    if (raw.length >= 2 && raw.length <= 8 && !isDramaNonCastLabel(raw) && !isSystemSpeakerName(raw)) {
      return raw;
    }
  }
  return '';
}

/** 看向/望向宾语（人物名），供 see / 对白最小面向 */
export function resolveDramaGazeObjectName(text: string, catalog: string[] = []): string {
  const src = String(text || '').trim();
  if (!src) return '';
  const spans = dramaGazeObjectSpans(src);
  if (!spans.length) return '';
  const obj = spans[spans.length - 1].name;
  if (!obj) return '';
  const hit = namesMentionedInText(obj, catalog)[0];
  if (hit) return hit;
  const mentioned = namesMentionedInText(src, catalog).find((n) => obj.includes(n) || n.includes(obj));
  return mentioned || (obj.length <= 8 ? obj : '');
}

function isActionLikeSegmentType(type: DramaOriginalSegmentType): boolean {
  return (
    type === 'action' ||
    type === 'stage_direction' ||
    type === 'performance_direction' ||
    type === 'montage' ||
    type === 'other'
  );
}

function minimalDialogueVisualAction(who: string, faceToward: string): string {
  const target = String(faceToward || '').trim();
  if (target) return `面向${target}`;
  const speaker = String(who || '').trim();
  if (speaker) return '站定';
  return '';
}

export function parseOriginalScript(
  source: string,
  episodeId: string,
  knownCharacterNames: string[] = [],
): { scenes: DramaOriginalScene[]; segments: DramaOriginalSegment[] } {
  const text = String(source || '');
  const epId = String(episodeId || '').trim();
  const lines = splitLinesWithOffsets(text);
  const extracted = extractCharacterNamesFromScriptText(text);
  const knownNames = uniqueKeepOrder([...knownCharacterNames, ...extracted, '系统提示音', '系统']);
  for (const line of lines) {
    const t = lineTrim(line);
    if (!t) continue;
    const cue = parseSpeakerCue(t, knownNames);
    // 仅收录说话人提示行，禁止把「峡谷之巅」等整行标题/地名塞进人物目录
    if (cue?.name && !isDramaNonCastLabel(cue.name)) knownNames.push(cue.name);
  }

  const scenes: DramaOriginalScene[] = [];
  const segments: DramaOriginalSegment[] = [];
  let current: DramaOriginalScene | null = null;
  let segOrder = 0;
  let i = 0;

  const ensureScene = (): DramaOriginalScene => {
    if (current) return current;
    current = {
      scene_id: padSceneNo(1),
      episode_id: epId,
      scene_number: 1,
      scene_no: padSceneNo(1),
      location_type: '',
      location: '开场',
      time: '',
      original_heading: '',
      order: 0,
    };
    scenes.push(current);
    return current;
  };

  const pushSegment = (
    scene: DramaOriginalScene,
    type: DramaOriginalSegmentType,
    start: number,
    end: number,
    extra?: Partial<DramaOriginalSegment>,
  ) => {
    const original_text = sliceSource(text, start, end);
    if (!original_text && type !== 'transition') return;
    segOrder += 1;
    const mentioned = namesMentionedInText(original_text, knownNames).filter(
      (n) => !isSystemSpeakerName(n) && !isDramaNonCastLabel(n),
    );
    // 动作段：主语 ≠ 看向宾语；禁止用「最长提及名」误绑听者/被看者
    const actionSubject =
      !extra?.character_name && isActionLikeSegmentType(type)
        ? resolveDramaActionSubjectName(original_text, knownNames)
        : '';
    const character_name = extra?.character_name || actionSubject || mentioned[0] || '';
    segments.push({
      segment_id: padSegId(segOrder),
      episode_id: epId,
      scene_id: scene.scene_id,
      scene_no: scene.scene_no,
      order: segOrder,
      original_text,
      type,
      ...(character_name ? { character_name } : {}),
      ...(mentioned.length ? { character_names: mentioned } : {}),
      source_range: { start, end },
      ...extra,
      ...(extra?.character_name ? { character_name: extra.character_name } : character_name ? { character_name } : {}),
    });
  };

  const flushAction = (buf: LineRec[]) => {
    if (!buf.length) return;
    const scene = ensureScene();
    const start = buf[0].start;
    const end = buf[buf.length - 1].end;
    const body = sliceSource(text, start, end);
    if (!body.replace(/\s+/g, '')) {
      buf.length = 0;
      return;
    }
    pushSegment(scene, 'action', start, end);
    buf.length = 0;
  };

  const actionBuf: LineRec[] = [];

  const consumeFollowingSpeech = (from: number, known: string[]): number => {
    let j = from;
    while (j < lines.length) {
      if (isBlankLine(lines[j])) break;
      const t = lineTrim(lines[j]);
      if (isStructureBreak(t, known) && j !== from) break;
      if (parseDramaSceneHeadingLine(t) || TRANSITION_RE.test(t) || SCREEN_TEXT_RE.test(t) || MONTAGE_RE.test(t) || SYSTEM_BLOCK_RE.test(t)) {
        break;
      }
      if (j !== from && parseSpeakerCue(t, known)) break;
      j += 1;
    }
    return j - 1;
  };

  const actionEndsWithColon = () =>
    actionBuf.length > 0 && originalLineEndsWithColon(lineTrim(actionBuf[actionBuf.length - 1]));

  const skipBlankLines = (from: number): number => {
    let j = from;
    while (j < lines.length && isBlankLine(lines[j])) j += 1;
    return j;
  };

  const takeParenAndSpeechAfter = (
    from: number,
  ): { nextI: number; end: number; performance: string } => {
    let j = from;
    let end = from > 0 ? lines[from - 1].end : 0;
    let performance = '';
    if (j < lines.length) {
      const nextTrim = lineTrim(lines[j]);
      const parenOnly = nextTrim.match(/^[（(]([^)）]+)[)）]\s*$/);
      if (parenOnly && !parseDramaSceneHeadingLine(nextTrim)) {
        performance = parenOnly[1].trim();
        end = lines[j].end;
        j += 1;
      }
    }
    j = skipBlankLines(j);
    if (j < lines.length) {
      const t = lineTrim(lines[j]);
      const nextCue = parseSpeakerCue(t, knownNames);
      if (
        !parseDramaSceneHeadingLine(t) &&
        !TRANSITION_RE.test(t) &&
        !SCREEN_TEXT_RE.test(t) &&
        !MONTAGE_RE.test(t) &&
        !SYSTEM_BLOCK_RE.test(t) &&
        !nextCue
      ) {
        const speechEnd = consumeFollowingSpeech(j, knownNames);
        if (speechEnd >= j) {
          end = lines[speechEnd].end;
          j = speechEnd + 1;
        }
      }
    }
    return { nextI: j, end, performance };
  };

  while (i < lines.length) {
    const line = lines[i];
    const trimmed = lineTrim(line);
    if (!trimmed) {
      if (actionEndsWithColon()) {
        i += 1;
        continue;
      }
      flushAction(actionBuf);
      i += 1;
      continue;
    }

    // 标题/作者/分隔线等与正文无关：直接跳过，不进片段表
    if (isDramaScriptMetaNoiseLine(trimmed)) {
      flushAction(actionBuf);
      i += 1;
      continue;
    }

    const craftTag = parseDramaH3CraftTag(trimmed);
    if (craftTag?.tag === '场') {
      flushAction(actionBuf);
      let rest = craftTag.rest;
      let headingEnd = line.end;
      let nextI = i + 1;
      if (!rest) {
        const j = skipBlankLines(i + 1);
        if (j < lines.length) {
          const t = lineTrim(lines[j]);
          if (t && !parseDramaH3CraftTag(t)) {
            rest = t;
            headingEnd = lines[j].end;
            nextI = j + 1;
          }
        }
      }
      const heading =
        parseDramaSceneHeadingLine(`【场】${rest}`) || {
          scene_number: scenes.length + 1,
          scene_no: padSceneNo(scenes.length + 1),
          location_type: '',
          location: rest || '开场',
          time: '',
        };
      const numbered = {
        ...heading,
        scene_number: scenes.length + 1,
        scene_no: padSceneNo(scenes.length + 1),
      };
      const reuse =
        current &&
        !current.original_heading &&
        current.location === '开场' &&
        scenes.length === 1;
      if (reuse && current) {
        current.location_type = heading.location_type;
        current.location = heading.location;
        current.time = heading.time;
        current.original_heading = sliceSource(text, line.start, headingEnd);
        current.source_range = { start: line.start, end: headingEnd };
      } else {
        const ids = allocOriginalSceneNos(numbered, scenes);
        current = {
          scene_id: ids.scene_id,
          episode_id: epId,
          scene_number: numbered.scene_number,
          scene_no: ids.scene_no,
          location_type: heading.location_type,
          location: heading.location,
          time: heading.time,
          original_heading: sliceSource(text, line.start, headingEnd),
          order: scenes.length,
          source_range: { start: line.start, end: headingEnd },
        };
        scenes.push(current);
      }
      i = nextI;
      continue;
    }
    if (craftTag) {
      flushAction(actionBuf);
      const blockEnd = consumeH3CraftBlock(lines, i, knownNames);
      const start = line.start;
      const end = lines[blockEnd].end;
      if (craftTag.tag === '元') {
        // 元信息块不进分场原文
        i = blockEnd + 1;
        continue;
      }
      if (craftTag.tag === '转') {
        pushSegment(ensureScene(), 'transition', start, end);
        i = blockEnd + 1;
        continue;
      }
      if (craftTag.tag === '画') {
        pushSegment(ensureScene(), 'action', start, end);
        i = blockEnd + 1;
        continue;
      }
      if (craftTag.tag === '台') {
        const body = sliceSource(text, start, end).replace(/^【\s*台\s*】\s*/m, '').trim();
        const firstLine = body.split(/\r?\n/).map((x) => x.trim()).find(Boolean) || '';
        const cue = parseSpeakerCue(firstLine, knownNames);
        pushSegment(ensureScene(), 'dialogue', start, end, {
          character_name: cue?.name || '',
          ...(cue?.performance ? { performance: cue.performance } : {}),
        });
        if (cue?.name && !isDramaNonCastLabel(cue.name)) knownNames.push(cue.name);
        i = blockEnd + 1;
        continue;
      }
    }

    const heading = parseDramaSceneHeadingLine(trimmed);
    if (heading) {
      flushAction(actionBuf);
      const ids = allocOriginalSceneNos(heading, scenes);
      current = {
        scene_id: ids.scene_id,
        episode_id: epId,
        scene_number: heading.scene_number,
        scene_no: ids.scene_no,
        location_type: heading.location_type,
        location: heading.location,
        time: heading.time,
        original_heading: line.raw,
        order: scenes.length,
        source_range: { start: line.start, end: line.end },
      };
      scenes.push(current);
      i += 1;
      continue;
    }

    if (TRANSITION_RE.test(trimmed)) {
      flushAction(actionBuf);
      pushSegment(ensureScene(), 'transition', line.start, line.end);
      i += 1;
      continue;
    }

    if (SCREEN_TEXT_RE.test(trimmed)) {
      flushAction(actionBuf);
      const block = collectBracketBlock(lines, i);
      pushSegment(ensureScene(), 'screen_text', lines[i].start, lines[block.end].end);
      i = block.end + 1;
      continue;
    }

    if (MONTAGE_RE.test(trimmed)) {
      flushAction(actionBuf);
      const block = collectBracketBlock(lines, i);
      pushSegment(ensureScene(), 'montage', lines[i].start, lines[block.end].end);
      i = block.end + 1;
      continue;
    }

    if (SYSTEM_BLOCK_RE.test(trimmed)) {
      flushAction(actionBuf);
      const meta = extractBracketMeta(trimmed);
      let k = i + 1;
      while (k < lines.length && isBlankLine(lines[k])) k += 1;
      const speechEnd =
        k < lines.length &&
        !parseDramaSceneHeadingLine(lineTrim(lines[k])) &&
        !TRANSITION_RE.test(lineTrim(lines[k])) &&
        !SCREEN_TEXT_RE.test(lineTrim(lines[k])) &&
        !MONTAGE_RE.test(lineTrim(lines[k])) &&
        !SYSTEM_BLOCK_RE.test(lineTrim(lines[k])) &&
        !parseSpeakerCue(lineTrim(lines[k]), knownNames)
          ? consumeFollowingSpeech(k, knownNames)
          : i;
      const end = lines[Math.max(i, speechEnd)].end;
      pushSegment(ensureScene(), 'system', line.start, end, {
        character_name: meta.title || '系统提示音',
        speaker_type: 'system',
        voice_description: meta.note,
        performance: meta.note,
      });
      i = Math.max(i, speechEnd) + 1;
      continue;
    }

    const cue = parseSpeakerCue(trimmed, knownNames);
    if (cue) {
      const scene = ensureScene();
      const speakerType: DramaOriginalSegment['speaker_type'] = cue.system ? 'system' : 'character';
      const cueHasColon = originalLineEndsWithColon(trimmed);

      if (actionEndsWithColon()) {
        const tail = takeParenAndSpeechAfter(i + 1);
        const end = Math.max(line.end, tail.end || 0);
        pushSegment(scene, 'action', actionBuf[0].start, end, {
          character_name: cue.name,
          speaker_type: speakerType,
          ...(cue.performance || tail.performance
            ? { performance: cue.performance || tail.performance }
            : {}),
        });
        actionBuf.length = 0;
        i = tail.nextI > i ? tail.nextI : i + 1;
        continue;
      }

      flushAction(actionBuf);

      if (cue.innerOs) {
        let end = line.end;
        let nextI = i + 1;
        if (cueHasColon || !cue.dialogue || originalLineEndsWithColon(cue.dialogue)) {
          const tail = takeParenAndSpeechAfter(i + 1);
          if (tail.end > end) end = tail.end;
          nextI = tail.nextI > i ? tail.nextI : nextI;
        }
        pushSegment(scene, 'performance_direction', line.start, end, {
          character_name: cue.name,
          performance: '内心OS',
          speaker_type: 'character',
        });
        i = nextI;
        continue;
      }

      if (cue.dialogue) {
        let end = line.end;
        let nextI = i + 1;
        if (cueHasColon || originalLineEndsWithColon(cue.dialogue)) {
          const tail = takeParenAndSpeechAfter(i + 1);
          if (tail.end > end) end = tail.end;
          nextI = tail.nextI > i ? tail.nextI : nextI;
        }
        pushSegment(scene, cue.system ? 'system' : 'dialogue', line.start, end, {
          character_name: cue.name,
          performance: cue.performance,
          speaker_type: speakerType,
          voice_description: cue.system ? cue.performance : undefined,
        });
        i = nextI;
        continue;
      }

      if (cueHasColon) {
        const tail = takeParenAndSpeechAfter(i + 1);
        const hasSpeech = tail.end > line.end;
        pushSegment(scene, hasSpeech ? (cue.system ? 'system' : 'dialogue') : 'other', line.start, hasSpeech ? tail.end : line.end, {
          character_name: cue.name,
          speaker_type: speakerType,
          ...(cue.performance || tail.performance
            ? { performance: cue.performance || tail.performance }
            : {}),
        });
        i = tail.nextI > i ? tail.nextI : i + 1;
        continue;
      }

      // 裸名「江澈」+ 可选括注 + 随后台词
      let scan = i + 1;
      let parenPerf = '';
      let parenEnd = 0;
      if (scan < lines.length) {
        const nextTrim = lineTrim(lines[scan]);
        const parenOnly = nextTrim.match(/^[（(]([^)）]+)[)）]\s*$/);
        if (parenOnly && !parseDramaSceneHeadingLine(nextTrim)) {
          parenPerf = parenOnly[1].trim();
          parenEnd = lines[scan].end;
          scan += 1;
        }
      }
      const abstractPerf =
        !!parenPerf &&
        /^(?:紧张|压抑|愤怒|悲伤|恐惧|疑惑|冷漠|震惊|释然|克制|沉默|开心|兴奋|绝望|孤独|疲惫|困倦|轻松|慵懒|机械|懵逼|无奈|困惑|迷茫|失落|决心|怀疑|专注|确认|平静|低声|内心OS)$/.test(
          parenPerf,
        );
      if (scan < lines.length && !isBlankLine(lines[scan])) {
        const t = lineTrim(lines[scan]);
        const nextCue = parseSpeakerCue(t, knownNames);
        if (
          !parseDramaSceneHeadingLine(t) &&
          !TRANSITION_RE.test(t) &&
          !SCREEN_TEXT_RE.test(t) &&
          !MONTAGE_RE.test(t) &&
          !SYSTEM_BLOCK_RE.test(t) &&
          !nextCue
        ) {
          const speechEnd = consumeFollowingSpeech(scan, knownNames);
          if (speechEnd >= scan) {
            // 物理括注（打个汽水嗝）先落 performance_direction，再落对白
            if (parenPerf && !abstractPerf) {
              const parenLine = lines[scan - 1];
              pushSegment(scene, 'performance_direction', parenLine.start, parenLine.end, {
                character_name: cue.name,
                performance: parenPerf,
                speaker_type: speakerType,
              });
              pushSegment(scene, cue.system ? 'system' : 'dialogue', lines[scan].start, lines[speechEnd].end, {
                character_name: cue.name,
                speaker_type: speakerType,
              });
            } else {
              pushSegment(scene, cue.system ? 'system' : 'dialogue', line.start, lines[speechEnd].end, {
                character_name: cue.name,
                speaker_type: speakerType,
                ...(parenPerf || cue.performance
                  ? { performance: parenPerf || cue.performance }
                  : {}),
                ...(cue.system && (parenPerf || cue.performance)
                  ? { voice_description: parenPerf || cue.performance }
                  : {}),
              });
            }
            i = speechEnd + 1;
            continue;
          }
        }
      }

      // 仅有括注表演、无台词
      if (parenPerf) {
        pushSegment(scene, 'performance_direction', line.start, parenEnd || line.end, {
          character_name: cue.name,
          performance: parenPerf,
          speaker_type: speakerType,
        });
        i = scan;
        continue;
      }

      // 裸名且无后续：不产出 other 噪声段
      i += 1;
      continue;
    }

    actionBuf.push(line);
    i += 1;
  }

  flushAction(actionBuf);
  if (!scenes.length && text.trim()) {
    scenes.push({
      scene_id: padSceneNo(1),
      episode_id: epId,
      scene_number: 1,
      scene_no: padSceneNo(1),
      location_type: '',
      location: '全本',
      time: '',
      original_heading: '',
      order: 0,
    });
  }
  return { scenes, segments };
}

function pendingStatus(status: DramaAssetBindingStatus): boolean {
  return status === 'UNMATCHED' || status === 'AMBIGUOUS';
}

interface NamedAsset {
  id: string;
  name: string;
  extraNames?: string[];
}

function matchNamedAssets(originalName: string, assets: NamedAsset[]): {
  status: DramaAssetBindingStatus;
  hits: NamedAsset[];
} {
  const orig = String(originalName || '').trim();
  if (!orig || !assets.length) return { status: 'UNMATCHED', hits: [] };
  const origCore = coreDramaPersonName(orig) || orig;

  const exact = assets.filter((a) => {
    const names = [a.name, ...(a.extraNames || [])].map((n) => String(n || '').trim()).filter(Boolean);
    return names.some((n) => n === orig || (coreDramaPersonName(n) || n) === orig || (coreDramaPersonName(n) || n) === origCore);
  });
  if (exact.length === 1) return { status: 'MATCHED', hits: exact };
  if (exact.length > 1) return { status: 'AMBIGUOUS', hits: exact };

  const fuzzy = assets.filter((a) => {
    const names = [a.name, ...(a.extraNames || [])].map((n) => String(n || '').trim()).filter(Boolean);
    return names.some((n) => {
      const c = coreDramaPersonName(n) || n;
      if (n === orig || c === orig || c === origCore) return true;
      if (orig.length >= 2 && (n.includes(orig) || c.includes(orig))) return true;
      if (n.length >= 2 && orig.includes(n)) return true;
      if (origCore.length >= 2 && (c.includes(origCore) || origCore.includes(c))) return true;
      return false;
    });
  });
  if (fuzzy.length === 1) return { status: 'MATCHED', hits: fuzzy };
  if (fuzzy.length > 1) return { status: 'AMBIGUOUS', hits: fuzzy };
  return { status: 'UNMATCHED', hits: [] };
}

function characterImageId(ch: DramaCharacter): string {
  const master = (ch.reference_images || []).find((r) => r.kind === 'master' && String(r.url || '').trim());
  if (master?.ref_id) return master.ref_id;
  if (characterHasUsableReference(ch)) return ch.character_id;
  return '';
}

function sceneImageId(sc: DramaSceneAsset): string {
  const master = (sc.reference_images || []).find((r) => r.kind === 'master' && String(r.url || '').trim());
  if (master?.ref_id) return master.ref_id;
  if (sceneHasUsableReference(sc)) return sc.scene_id;
  return '';
}

function voiceLabel(v: DramaVoice): string {
  return String(v.identity?.voice_character || v.voiceStyle || v.timbre || v.voice_id || '').trim();
}

function findVoiceForCharacter(voices: DramaVoice[], characterId: string, originalName: string): DramaVoice | undefined {
  const byChar = voices.filter((v) => v.character_id && v.character_id === characterId);
  if (byChar.length === 1) return byChar[0];
  if (byChar.length > 1) return byChar.find((v) => String(v.sample_url || '').trim()) || byChar[0];
  const byName = voices.filter((v) => {
    const label = voiceLabel(v);
    return label && (label === originalName || label.includes(originalName) || originalName.includes(label));
  });
  if (byName.length === 1) return byName[0];
  return undefined;
}

function findSystemVoice(voices: DramaVoice[], description: string): { status: DramaAssetBindingStatus; hits: DramaVoice[] } {
  const desc = String(description || '');
  const hits = voices.filter((v) => {
    const blob = `${voiceLabel(v)} ${v.sample_text || ''} ${v.timbre || ''} ${v.identity?.timbre || ''}`.toLowerCase();
    return /系统|机械女|机械音|电子音/.test(blob) || (desc && blob.includes(desc.slice(0, 4).toLowerCase()));
  });
  if (hits.length === 1) return { status: 'MATCHED', hits };
  if (hits.length > 1) return { status: 'AMBIGUOUS', hits };
  return { status: 'UNMATCHED', hits: [] };
}

export function bindOriginalScriptAssets(
  parsed: { scenes: DramaOriginalScene[]; segments: DramaOriginalSegment[] },
  input: Pick<DramaOriginalAnalyzeInput, 'characters' | 'scenes' | 'voices' | 'visualBible'>,
): {
  scenes: DramaOriginalScene[];
  segments: DramaOriginalSegment[];
  character_bindings: DramaCharacterBinding[];
  voice_bindings: DramaVoiceBinding[];
  scene_bindings: DramaSceneAssetBinding[];
  visual_bible_binding: DramaVisualBibleBinding;
} {
  const characters = input.characters || [];
  const sceneAssets = input.scenes || [];
  const voices = input.voices || [];

  const nameSet: string[] = [];
  const sourceText = parsed.segments.map((s) => String(s.original_text || '')).join('\n');
  for (const seg of parsed.segments) {
    // 素材/绑定只认对白说话人，不认动作正文里的「提及」以免混入地名碎片
    if (!seg.character_name) continue;
    if (
      seg.type !== 'dialogue' &&
      seg.type !== 'system' &&
      seg.type !== 'narration' &&
      seg.type !== 'performance_direction'
    ) {
      continue;
    }
    nameSet.push(seg.character_name);
  }
  const originalNames = uniqueKeepOrder(nameSet).filter((n) => {
    if (isSystemSpeakerName(n)) return true;
    if (isDramaNonCastLabel(n)) return false;
    if (!isDramaStrictCastName(n, sourceText)) return false;
    return isDramaKeepCastSpeaker(n, parsed.segments);
  });

  const character_bindings: DramaCharacterBinding[] = originalNames.map((original_name) => {
    const system = isSystemSpeakerName(original_name);
    const charAssets: NamedAsset[] = characters.map((c) => ({
      id: c.character_id,
      name: c.name,
    }));
    const matched = matchNamedAssets(original_name, charAssets);
    const hit = matched.hits[0];
    const ch = hit ? characters.find((c) => c.character_id === hit.id) : undefined;
    const binding: DramaCharacterBinding = {
      original_name,
      status: system && matched.status === 'UNMATCHED' ? 'UNMATCHED' : matched.status,
      speaker_type: system ? 'system' : 'character',
    };
    if (matched.status === 'MATCHED' && ch) {
      binding.character_id = ch.character_id;
      binding.asset_name = ch.name;
      binding.image_id = characterImageId(ch) || undefined;
      binding.voice_id = ch.voice_id || undefined;
    } else if (matched.status === 'AMBIGUOUS') {
      binding.candidate_character_ids = matched.hits.map((h) => h.id);
      binding.candidate_names = matched.hits.map((h) => h.name);
    }
    return binding;
  });

  const voice_bindings: DramaVoiceBinding[] = originalNames.map((original_name) => {
    const cb = character_bindings.find((b) => b.original_name === original_name);
    const system = isSystemSpeakerName(original_name);
    const desc = parsed.segments.find((s) => s.character_name === original_name && s.voice_description)?.voice_description || '';
    if (system) {
      const sys = findSystemVoice(voices, desc);
      const hit = sys.hits[0];
      return {
        original_name,
        status: sys.status,
        speaker_type: 'system',
        voice_description: desc,
        ...(hit
          ? { voice_id: hit.voice_id, voice_name: voiceLabel(hit) || hit.voice_id, character_id: hit.character_id || undefined }
          : {}),
        ...(sys.status === 'AMBIGUOUS' ? { candidate_voice_ids: sys.hits.map((v) => v.voice_id) } : {}),
      };
    }
    if (cb?.status === 'MATCHED' && cb.character_id) {
      const v =
        (cb.voice_id ? voices.find((x) => x.voice_id === cb.voice_id) : undefined) ||
        findVoiceForCharacter(voices, cb.character_id, original_name);
      if (v) {
        return {
          original_name,
          status: 'MATCHED',
          voice_id: v.voice_id,
          voice_name: voiceLabel(v) || v.voice_id,
          character_id: cb.character_id,
          speaker_type: 'character',
        };
      }
    }
    return {
      original_name,
      status: 'UNMATCHED',
      speaker_type: system ? 'system' : 'character',
      character_id: cb?.character_id,
    };
  });

  const locationNames = uniqueKeepOrder(parsed.scenes.map((s) => s.location).filter(Boolean));
  const scene_bindings: DramaSceneAssetBinding[] = locationNames.map((original_location) => {
    const assets: NamedAsset[] = sceneAssets.map((s) => ({
      id: s.scene_id,
      name: s.name || s.location,
      extraNames: [s.location, s.name].filter(Boolean),
    }));
    const matched = matchNamedAssets(original_location, assets);
    const hit = matched.hits[0];
    const sc = hit ? sceneAssets.find((s) => s.scene_id === hit.id) : undefined;
    const binding: DramaSceneAssetBinding = {
      original_location,
      status: matched.status,
    };
    if (matched.status === 'MATCHED' && sc) {
      binding.scene_id = sc.scene_id;
      binding.asset_name = sc.name || sc.location;
      binding.scene_image_id = sceneImageId(sc) || undefined;
    } else if (matched.status === 'AMBIGUOUS') {
      binding.candidate_scene_ids = matched.hits.map((h) => h.id);
      binding.candidate_names = matched.hits.map((h) => h.name);
    }
    return binding;
  });

  const scenes = parsed.scenes.map((scene) => {
    const b = scene_bindings.find((x) => x.original_location === scene.location);
    return {
      ...scene,
      scene_asset_id: b?.scene_id,
      scene_image_id: b?.scene_image_id,
      binding_status: b?.status,
    };
  });

  const segments = parsed.segments.map((seg) => {
    const cb = seg.character_name
      ? character_bindings.find((b) => b.original_name === seg.character_name)
      : undefined;
    const vb = seg.character_name
      ? voice_bindings.find((b) => b.original_name === seg.character_name)
      : undefined;
    return {
      ...seg,
      character_id: cb?.status === 'MATCHED' ? cb.character_id : undefined,
      image_id: cb?.status === 'MATCHED' ? cb.image_id : undefined,
      voice_id: vb?.status === 'MATCHED' ? vb.voice_id : undefined,
    };
  });

  const pvb = input.visualBible;
  const styleId = String(pvb?.presetId || '').trim();
  const bound = !!(styleId && styleId !== 'unset');
  const visual_bible_binding: DramaVisualBibleBinding = {
    visual_bible_id: styleId || '',
    style_id: styleId,
    style_name: String(pvb?.presetName || pvb?.stylePrompt || '').trim(),
    bound,
  };

  return { scenes, segments, character_bindings, voice_bindings, scene_bindings, visual_bible_binding };
}

function segmentKindToEvent(
  type: DramaOriginalSegmentType,
): { kind: DramaVisualEvent['kind']; cut: string; priority: DramaVisualEvent['priority'] } {
  switch (type) {
    case 'dialogue':
      return { kind: 'dialogue', cut: 'speaker', priority: 'A' };
    case 'system':
      return { kind: 'dialogue', cut: 'speaker', priority: 'A' };
    case 'transition':
      return { kind: 'transition', cut: 'cut', priority: 'A' };
    case 'montage':
      return { kind: 'insert', cut: 'montage', priority: 'A' };
    case 'screen_text':
      return { kind: 'information', cut: 'text', priority: 'A' };
    case 'performance_direction':
      return { kind: 'reaction', cut: 'emotion', priority: 'B' };
    case 'stage_direction':
      return { kind: 'information', cut: 'direction', priority: 'B' };
    case 'narration':
      return { kind: 'information', cut: 'narration', priority: 'A' };
    case 'action':
      return { kind: 'action', cut: 'action', priority: 'A' };
    default:
      return { kind: 'action', cut: 'other', priority: 'B' };
  }
}

export function buildVisualEventsFromOriginalSegments(
  scenes: DramaOriginalScene[],
  segments: DramaOriginalSegment[],
): { visualEvents: DramaVisualEvent[]; sceneBeats: DramaSceneBeat[] } {
  const sceneBeats: DramaSceneBeat[] = scenes.map((scene) => ({
    scene_beat_id: `SB-${scene.scene_id}`,
    scene_no: scene.scene_no,
    scene_asset_id: scene.scene_asset_id || '',
    location_name: scene.location,
    int_ext: scene.location_type,
    day_night: scene.time,
    weather: '',
    cast_ids: [],
    prop_ids: [],
    creature_ids: [],
    dramatic_goal: '',
    purpose: '',
    event: '',
    conflict: '',
    result: '',
    emotion: '',
    characters: uniqueKeepOrder(
      segments.filter((s) => s.scene_id === scene.scene_id && s.character_name).map((s) => s.character_name as string),
    ),
  }));

  const catalog = uniqueKeepOrder(
    segments.flatMap((s) => [
      ...(s.character_name ? [s.character_name] : []),
      ...((s.character_names || []) as string[]),
    ]),
  );
  const visualEvents: DramaVisualEvent[] = [];
  let index = 0;
  const established = new Set<string>();
  /** 每人最近一次看向对象，供对白段最小「面向」承接 */
  const lastGazeByWho = new Map<string, string>();
  let lastActionWho = '';
  for (const seg of segments) {
    if (seg.type === 'other') {
      const tag = parseDramaH3CraftTag(String(seg.original_text || '').trim());
      if (tag?.tag === '元' || !String(seg.original_text || '').trim()) continue;
      const bare = String(seg.original_text || '')
        .replace(/[。．.\s：:]+/g, '')
        .trim();
      const whoName = String(seg.character_name || '').trim();
      // 裸说话人行（仅「江澈」）不单独成 VE，避免噪声
      if (whoName && bare === whoName) continue;
    }
    // 纯括注表演（慵懒）并入对白 expression，不单独成 reaction VE
    if (seg.type === 'performance_direction') {
      const body = String(seg.original_text || '').trim();
      const perf = String(seg.performance || '').trim();
      const onlyParen = /^[（(][^)）]+[)）]\s*$/.test(body) || (!!perf && body.replace(/[（）()\s]/g, '') === perf.replace(/\s/g, ''));
      const abstract =
        !!perf &&
        /^(?:紧张|压抑|愤怒|悲伤|恐惧|疑惑|冷漠|震惊|释然|克制|沉默|开心|兴奋|绝望|孤独|疲惫|困倦|轻松|慵懒|机械|懵逼|无奈|困惑|迷茫|失落|决心|怀疑|专注|确认|平静|低声)$/.test(
          perf,
        );
      if (onlyParen && abstract) continue;
    }
    index += 1;
    const mapped = segmentKindToEvent(seg.type);
    const original_text = seg.original_text;
    const body = String(original_text || '').replace(/^【\s*(?:画|台|转|元)\s*】\s*/m, '').trim();
    const firstInScene = !established.has(seg.scene_no);
    if (firstInScene) established.add(seg.scene_no);
    const kind = firstInScene && mapped.kind === 'action' ? 'establish' : mapped.kind;
    const talk = seg.type === 'dialogue' || seg.type === 'system' || seg.type === 'narration';
    const actionLike = !talk && isActionLikeSegmentType(seg.type);
    const who = actionLike
      ? String(seg.character_name || '').trim() ||
        resolveDramaActionSubjectName(body || original_text, catalog, {
          previousWho: lastActionWho,
        })
      : String(seg.character_name || '').trim();
    if (actionLike && who) lastActionWho = who;
    else if (talk && who) lastActionWho = who;
    const gazeObj = actionLike
      ? resolveDramaGazeObjectName(body || original_text, catalog)
      : '';
    if (who && gazeObj) lastGazeByWho.set(who, gazeObj);
    const dialogueFace = talk && seg.type === 'dialogue' ? lastGazeByWho.get(who) || '' : '';
    visualEvents.push({
      event_id: padEventId(index),
      index,
      location: seg.scene_no,
      kind,
      who,
      action:
        seg.type === 'system'
          ? DRAMA_SYSTEM_HOLOGRAM_VISUAL_ZH
          : seg.type === 'dialogue'
            ? minimalDialogueVisualAction(who, dialogueFace)
            : body || original_text,
      expression: seg.performance || '',
      emotion: { primary: '', intensity: 0.5 },
      see:
        seg.type === 'system'
          ? DRAMA_SYSTEM_HOLOGRAM_VISUAL_ZH
          : seg.type === 'screen_text'
            ? ''
            : gazeObj || (seg.type === 'dialogue' ? dialogueFace : '') || (talk ? '' : body || original_text),
      cut: firstInScene && kind === 'establish' ? 'space' : mapped.cut,
      priority: mapped.priority,
      source_segment_ids: [seg.segment_id],
      original_text,
    });
  }
  return { visualEvents, sceneBeats };
}

export function auditOriginalScriptIntegrity(
  source: string,
  scenes: DramaOriginalScene[],
  segments: DramaOriginalSegment[],
): DramaOriginalIntegrityReport {
  const text = String(source || '');
  const covered = new Uint8Array(text.length);
  const mark = (range?: DramaOriginalSourceRange, fallback?: string) => {
    if (range && range.end > range.start) {
      const start = Math.max(0, Math.min(text.length, range.start));
      const end = Math.max(start, Math.min(text.length, range.end));
      for (let i = start; i < end; i += 1) covered[i] = 1;
      return;
    }
    if (fallback) {
      const idx = text.indexOf(fallback);
      if (idx >= 0) {
        for (let i = idx; i < idx + fallback.length; i += 1) covered[i] = 1;
      }
    }
  };
  for (const scene of scenes) mark(scene.source_range, scene.original_heading);
  for (const seg of segments) mark(seg.source_range, seg.original_text);

  const missing: string[] = [];
  let uncovered = 0;
  let i = 0;
  while (i < text.length) {
    if (covered[i] || /\s/.test(text[i])) {
      i += 1;
      continue;
    }
    uncovered += 1;
    const start = i;
    while (i < text.length && !covered[i] && !/\s/.test(text[i])) i += 1;
    if (missing.length < 6) missing.push(text.slice(start, Math.min(text.length, start + 24)));
  }

  const dialogueSegs = segments.filter((s) => s.type === 'dialogue' || s.type === 'system');
  const dialogue_ok = dialogueSegs.every((s) => {
    const t = s.original_text;
    if (!t) return false;
    if (s.source_range) return text.slice(s.source_range.start, s.source_range.end) === t;
    return text.includes(t);
  });

  const notes: string[] = [];
  if (uncovered) notes.push(`有 ${uncovered} 个非空白字符未覆盖`);
  if (!dialogue_ok) notes.push('对白原文无法从片段完整还原');
  if (!segments.length && text.trim()) notes.push('未切出任何原文片段');

  return {
    ok: uncovered === 0 && dialogue_ok && (!!segments.length || !text.trim()),
    source_chars: text.length,
    covered_chars: text.length - uncovered,
    missing_samples: missing,
    dialogue_ok,
    notes,
  };
}

export function buildDramaEpisodeAnalysisSummary(
  result: Omit<DramaOriginalAnalyzeResult, 'summary' | 'shot_suggestions'>,
): DramaEpisodeAnalysisSummary {
  const charMention = collectOriginalSpeakerNamesInOrder(result.original_segments).length;
  const count = (list: { status: DramaAssetBindingStatus }[]) => {
    let matched = 0;
    let pending = 0;
    let ambiguous = 0;
    for (const b of list) {
      if (b.status === 'MATCHED') matched += 1;
      else if (b.status === 'AMBIGUOUS') {
        ambiguous += 1;
        pending += 1;
      } else pending += 1;
    }
    return { matched, pending, ambiguous };
  };
  const c = count(result.character_bindings);
  const v = count(result.voice_bindings);
  const s = count(result.scene_bindings);
  return {
    scene_count: result.original_scenes.length,
    segment_count: result.original_segments.length,
    character_mention_count: charMention,
    scene_mention_count: result.original_scenes.filter((x) => x.location).length,
    character_matched: c.matched,
    character_pending: c.pending,
    character_ambiguous: c.ambiguous,
    voice_matched: v.matched,
    voice_pending: v.pending,
    voice_ambiguous: v.ambiguous,
    scene_matched: s.matched,
    scene_pending: s.pending,
    scene_ambiguous: s.ambiguous,
    visual_bible_bound: !!result.visual_bible_binding.bound,
    integrity_ok: result.integrity.ok,
    analyzed_at: Date.now(),
  };
}

const ORIGINAL_SEGMENT_PURPOSE: Record<DramaOriginalSegmentType, string> = {
  action: '动作',
  dialogue: '对白',
  stage_direction: '舞台指示',
  performance_direction: '表演',
  system: '系统',
  montage: '蒙太奇',
  transition: '转场',
  screen_text: '字幕',
  narration: '旁白',
  other: '原文',
};

/** 成片档：优先 15 秒；场景累计 >20 拆场次续；落档仅 6/10/15 */
export const DRAMA_ORIGINAL_SHOT_PREF_SEC = DRAMA_FAST_PACE_DURATION_CONFIG.packPreferSec;
export const DRAMA_ORIGINAL_SHOT_CAP_SEC = DRAMA_FAST_PACE_DURATION_CONFIG.packCapSec;

function estimateOriginalSegmentDurationSec(
  text: string,
  type: DramaOriginalSegmentType,
  opts?: { performance?: string; isSceneStart?: boolean },
): number {
  return estimateDramaFastPaceSegment({
    type,
    text: String(text || ''),
    parenthetical: opts?.performance,
    isSceneStart: opts?.isSceneStart === true,
  }).estSec;
}

function isTalkSegmentType(type: DramaOriginalSegmentType): boolean {
  return type === 'dialogue' || type === 'system' || type === 'narration';
}

function formatOriginalSceneLabel(scene: DramaOriginalScene): string {
  const heading = String(scene.original_heading || '')
    .trim()
    .replace(/^#{1,6}\s*/, '');
  if (heading) return heading;
  const bits = [
    scene.scene_number ? `${scene.scene_number}.` : '',
    scene.location_type,
    scene.location,
    scene.time ? `- ${scene.time}` : '',
  ]
    .map((x) => String(x || '').trim())
    .filter(Boolean);
  return bits.join(' ').replace(/\s+-\s+/g, ' - ');
}

function snapOriginalShotDurationSec(est: number): number {
  return snapDramaFastPaceTierSec(est);
}

function visualEventIdsBySegment(ves: DramaVisualEvent[]): Map<string, string[]> {
  const veIdsBySeg = new Map<string, string[]>();
  for (const ev of ves || []) {
    if (!ev.event_id) continue;
    for (const sid of ev.source_segment_ids || []) {
      const id = String(sid || '').trim();
      if (!id) continue;
      const list = veIdsBySeg.get(id) || [];
      list.push(ev.event_id);
      veIdsBySeg.set(id, list);
    }
  }
  return veIdsBySeg;
}

function groupOriginalSegmentsByScene(segments: DramaOriginalSegment[]): Map<string, DramaOriginalSegment[]> {
  const segsByScene = new Map<string, DramaOriginalSegment[]>();
  for (const seg of segments || []) {
    const key = String(seg.scene_id || seg.scene_no || '').trim();
    if (!key) continue;
    const list = segsByScene.get(key) || [];
    list.push(seg);
    segsByScene.set(key, list);
  }
  return segsByScene;
}

/** H3 单请求最大时长（秒）；超过才允许软边界再拆 */
export const DRAMA_H3_CLIP_MAX_SEC = 20;

/**
 * 叙事硬切起点：类型翻转 / 换场过渡 / 时间·视角大跳。
 * 「画面切黑」单独成行时并入上一高潮镜，不新开空镜。
 * 「第二道雷 / 浑身一麻」等是高潮链续拍，禁止在此切断。
 */
export function isDramaNarrativeHardCutStart(seg: DramaOriginalSegment): boolean {
  if (!seg) return false;
  if (seg.type === 'transition') return true;
  const raw = String(seg.original_text || '').trim();
  if (!raw) return false;
  const t = raw.replace(/\s+/g, '');
  if (/^(?:画面)?切黑\.?$|^黑屏\.?$|^淡出\.?$|^淡入\.?$/.test(t)) return false;
  if (isDramaSceneTransitionText(raw) || isDramaSceneTransitionText(t)) return true;
  // 高潮续拍：禁止为「第二击 / 身体反应」另开 Shot
  if (/第二道雷|浑身一麻|眼睛瞪大/.test(t)) return false;
  if (/^(?:与此同时|片刻后|不久后|第二天|次日|闪回)/.test(t)) return true;
  if (/^切至|^切到|^镜头猛地|^POV/.test(t)) return true;
  // 类型墙 / 异象入侵入口（须有可见冲击，单句「雷声由远及近」环境声不够）
  if (/(?:一道)?白光|白光闪过|屏幕炸开(?:蓝光)?|雷(?:直接)?劈|劈进(?:电脑)?屏幕|突然天崩|穿越至|时空碎裂/.test(t)) {
    return true;
  }
  if (/(?:窗外)?雷声/.test(t) && /白光|闪过|炸|劈/.test(t)) return true;
  return false;
}

/** 按叙事硬切把一场切成若干 Shot Beat（硬切点之前收口，硬切段开新包） */
export function splitOriginalSegmentsByNarrativeHardCuts(
  segments: DramaOriginalSegment[],
): DramaOriginalSegment[][] {
  const list = (segments || []).filter(Boolean);
  if (!list.length) return [];
  const packs: DramaOriginalSegment[][] = [];
  let cur: DramaOriginalSegment[] = [];
  for (let i = 0; i < list.length; i += 1) {
    const seg = list[i];
    if (cur.length && isDramaNarrativeHardCutStart(seg)) {
      packs.push(cur);
      cur = [seg];
      continue;
    }
    cur.push(seg);
  }
  if (cur.length) packs.push(cur);
  return packs;
}

/**
 * Shot Beat 超 H3 上限时，才按软边界（对白/未说完保护）再拆；
 * 禁止仅为凑 15 秒切断同链。
 */
export function softPackOriginalSegmentsForH3Clip(
  segments: DramaOriginalSegment[],
): DramaOriginalSegment[][] {
  const list = (segments || []).filter(Boolean);
  if (!list.length) return [];
  const total = estimateOriginalSegmentPackSec(list, true);
  const hardCap = Math.max(DRAMA_H3_CLIP_MAX_SEC, durationSplitHardCapSec());
  if (total <= hardCap + 1e-6) return [list];
  const inputs = list.map((seg, i) => originalSegmentToFastPaceInput(seg, { isSceneStart: i === 0 }));
  const packed = packDramaFastPaceByDurationTiers(inputs);
  if (!packed.packs.length) return [list];
  return packed.packs.map((p) => list.slice(p.start, p.end)).filter((x) => x.length);
}

/** Narrative Beat → Shot Beat →（必要时）软拆成 H3 Clip 包 */
export function packOriginalSegmentsIntoH3ShotBeats(
  segments: DramaOriginalSegment[],
): DramaOriginalSegment[][] {
  const hardPacks = splitOriginalSegmentsByNarrativeHardCuts(segments);
  const out: DramaOriginalSegment[][] = [];
  for (const pack of hardPacks) {
    const soft = softPackOriginalSegmentsForH3Clip(pack);
    for (const p of soft) {
      if (p.length) out.push(p);
    }
  }
  return out.length ? out : segments.length ? [segments] : [];
}

function estimateOriginalSegmentPackSec(pack: DramaOriginalSegment[], sceneStart: boolean): number {
  return pack.reduce(
    (n, s, idx) =>
      n +
      estimateOriginalSegmentDurationSec(s.original_text, s.type, {
        performance: s.performance,
        isSceneStart: sceneStart && idx === 0,
      }),
    0,
  );
}

/** 按短剧快节奏估算打包；拆点优先对白边界（见 packDramaFastPaceScene） */
export function packOriginalSegmentsByShotCap(
  segments: DramaOriginalSegment[],
  capSec = DRAMA_ORIGINAL_SHOT_CAP_SEC,
): DramaOriginalSegment[][] {
  if (!segments.length) return [];
  const inputs = segments.map((seg, i) =>
    originalSegmentToFastPaceInput(seg, { isSceneStart: i === 0 }),
  );
  const scene = packDramaFastPaceScene(inputs, {
    ...DRAMA_FAST_PACE_DURATION_CONFIG,
    packCapSec: capSec,
  });
  return scene.packs.map((p) => segments.slice(p.start, p.end));
}

/** 时长拆镜打包：档位 ±35% 内不拆；不足 25 字、冒号结尾或人物话没说完不拆 */
export function packOriginalSegmentsByDurationTiers(
  segments: DramaOriginalSegment[],
): DramaOriginalSegment[][] {
  if (!segments.length) return [];
  const inputs = segments.map((seg, i) =>
    originalSegmentToFastPaceInput(seg, { isSceneStart: i === 0 }),
  );
  const scene = packDramaFastPaceByDurationTiers(inputs);
  return scene.packs.map((p) => segments.slice(p.start, p.end));
}

function composePackedShotText(pack: DramaOriginalSegment[]): {
  action: string;
  dialogue: string;
  emotion_play: string;
  cast_names: string[];
} {
  const actions: string[] = [];
  const dialogues: string[] = [];
  const emotions: string[] = [];
  const cast: string[] = [];
  for (const seg of pack) {
    const text = String(seg.original_text || '').trim();
    if (seg.performance) emotions.push(seg.performance);
    if (seg.character_name) cast.push(seg.character_name);
    // 动作段仅保留「已是说话人」的 character_name，不用 character_names 提及列表
    if (!text) continue;
    if (isTalkSegmentType(seg.type)) dialogues.push(text);
    else actions.push(text);
  }
  return {
    action: actions.join('\n'),
    dialogue: dialogues.join('\n'),
    emotion_play: uniqueKeepOrder(emotions).join('；'),
    cast_names: uniqueKeepOrder(cast).filter((n) => !isSystemSpeakerName(n) && isDramaStrictCastName(n)),
  };
}

/** 保序拼接原文：优先按 source_range 从原文切片，避免拆成动作/对白/情绪。 */
function originalPackLiteralText(pack: DramaOriginalSegment[], source?: string): string {
  if (!pack.length) return '';
  const src = String(source || '');
  const ranges = pack
    .map((s) => s.source_range)
    .filter((r): r is DramaOriginalSourceRange => !!r && Number(r.end) > Number(r.start));
  if (src && ranges.length) {
    const start = Math.min(...ranges.map((r) => Number(r.start) || 0));
    const end = Math.max(...ranges.map((r) => Number(r.end) || 0));
    if (end > start) {
      return src.slice(start, Math.min(end, src.length)).replace(/^\n+|\n+$/g, '');
    }
  }
  return pack
    .map((s) => String(s.original_text || '').replace(/\s+$/g, ''))
    .filter(Boolean)
    .join('\n');
}

function literalFieldsFromOriginalPack(
  pack: DramaOriginalSegment[],
  source?: string,
): {
  action: string;
  dialogue: string;
  emotion_play: string;
  subtext: string;
  cast_names: string[];
} {
  const packed = composePackedShotText(pack);
  return {
    action: originalPackLiteralText(pack, source),
    dialogue: packed.dialogue,
    emotion_play: packed.emotion_play,
    subtext: '',
    cast_names: packed.cast_names,
  };
}

function isLiteralOriginalDraft(s: {
  size?: string;
  move?: string;
  camera?: string;
  dialogue?: string;
  emotion_play?: string;
}): boolean {
  return (
    !String(s.size || '').trim() &&
    !String(s.move || s.camera || '').trim() &&
    !String(s.dialogue || '').trim() &&
    !String(s.emotion_play || '').trim()
  );
}

type OriginalShotDraft = DramaShotSuggestion & { raw_est_sec: number };

function joinUniqueField(parts: string[], sep: string): string {
  return uniqueKeepOrder(parts.map((p) => String(p || '').trim()).filter(Boolean)).join(sep);
}

/** 多镜合并：原文块直接拼接；脚本设计后才按画面/对白/运镜切时间窗 */
function composeMergedShotContent(
  group: OriginalShotDraft[],
  totalRaw: number,
  snappedSec: number,
): Pick<
  DramaShotSuggestion,
  | 'action'
  | 'dialogue'
  | 'emotion_play'
  | 'purpose'
  | 'size'
  | 'camera'
  | 'move'
  | 'blocking'
  | 'lighting'
  | 'sound'
  | 'subtext'
  | 'dramatic_purpose'
  | 'visual_focus'
  | 'transition_in'
  | 'transition_out'
> {
  if (group.length === 1) {
    const s = group[0];
    return {
      action: s.action || '',
      dialogue: s.dialogue || '',
      emotion_play: s.emotion_play || '',
      purpose: s.purpose || '',
      size: s.size || '',
      camera: s.camera || '',
      move: s.move || '',
      blocking: s.blocking || '',
      lighting: s.lighting || '',
      sound: s.sound || '',
      subtext: s.subtext || '',
      dramatic_purpose: s.dramatic_purpose || '',
      visual_focus: s.visual_focus || '',
      transition_in: s.transition_in || '',
      transition_out: s.transition_out || '',
    };
  }

  if (group.every(isLiteralOriginalDraft)) {
    return {
      action: group
        .map((s) => String(s.action || '').replace(/^\n+|\n+$/g, ''))
        .filter(Boolean)
        .join('\n\n'),
      dialogue: group
        .map((s) => String(s.dialogue || '').replace(/^\n+|\n+$/g, ''))
        .filter(Boolean)
        .join('\n'),
      emotion_play: joinUniqueField(
        group.map((s) => String(s.emotion_play || '')),
        '；',
      ),
      purpose: `合并${group.length}段原文`,
      size: '',
      camera: '',
      move: '',
      blocking: '',
      lighting: '',
      sound: '',
      subtext: '',
      dramatic_purpose: joinUniqueField(
        group.map((s) => String(s.dramatic_purpose || '')),
        ' / ',
      ),
      visual_focus: '',
      transition_in: String(group[0]?.transition_in || '').trim(),
      transition_out: String(group[group.length - 1]?.transition_out || '').trim(),
    };
  }

  const actions: string[] = [];
  const dialogues: string[] = [];
  const emotions: string[] = [];
  const purposes: string[] = [];
  const sizes: string[] = [];
  const cameras: string[] = [];
  const moves: string[] = [];
  const blockings: string[] = [];
  const lightings: string[] = [];
  const sounds: string[] = [];
  const subtexts: string[] = [];
  const dramatic: string[] = [];
  const focuses: string[] = [];
  let cursor = 0;
  const denom = Math.max(0.1, totalRaw);

  for (let i = 0; i < group.length; i += 1) {
    const s = group[i];
    const est = Math.max(0.1, Number(s.raw_est_sec) || Number(s.duration_sec) || 0);
    const span =
      i === group.length - 1
        ? Math.max(0.1, Math.round((snappedSec - cursor) * 10) / 10)
        : Math.max(0.1, Math.round(((est / denom) * snappedSec) * 10) / 10);
    const t0 = Math.round(cursor * 10) / 10;
    const t1 = Math.round((cursor + span) * 10) / 10;
    cursor += span;
    const sceneBit = String(s.scene || '').trim();
    const head = sceneBit ? `[${t0}-${t1}s · ${sceneBit}]` : `[${t0}-${t1}s]`;

    const act = String(s.action || '').trim();
    const dia = String(s.dialogue || '').trim();
    const vis = String(s.visual_focus || '').trim();
    if (act) actions.push(`${head}\n${act}`);
    else if (vis) actions.push(`${head}\n${vis}`);
    else actions.push(`${head}\n（本段无单独画面描述）`);

    if (dia) dialogues.push(`${head}\n${dia}`);
    if (s.emotion_play) emotions.push(`${t0}-${t1}s ${String(s.emotion_play).trim()}`);
    if (s.purpose) purposes.push(String(s.purpose).trim());
    if (s.size) sizes.push(String(s.size).trim());
    if (s.camera) cameras.push(String(s.camera).trim());
    if (s.move) moves.push(String(s.move).trim());
    if (s.blocking) blockings.push(`${t0}-${t1}s ${String(s.blocking).trim()}`);
    if (s.lighting) lightings.push(`${t0}-${t1}s ${String(s.lighting).trim()}`);
    if (s.sound) sounds.push(`${t0}-${t1}s ${String(s.sound).trim()}`);
    if (s.subtext) subtexts.push(String(s.subtext).trim());
    if (s.dramatic_purpose) dramatic.push(String(s.dramatic_purpose).trim());
    if (vis) focuses.push(`${t0}-${t1}s ${vis}`);
  }

  return {
    action: actions.join('\n\n'),
    dialogue: dialogues.join('\n\n'),
    emotion_play: emotions.join('；'),
    purpose: purposes.length ? `合并${group.length}镜：${joinUniqueField(purposes, ' / ')}` : `合并${group.length}镜`,
    size: joinUniqueField(sizes, ' → ') || '',
    camera: joinUniqueField(cameras, ' → ') || '',
    move: joinUniqueField(moves, ' → ') || '',
    blocking: blockings.join('\n'),
    lighting: lightings.join('\n'),
    sound: sounds.join('\n'),
    subtext: joinUniqueField(subtexts, '；'),
    dramatic_purpose: joinUniqueField(dramatic, ' / '),
    visual_focus: focuses.join('\n'),
    transition_in: String(group[0]?.transition_in || '').trim(),
    transition_out: String(group[group.length - 1]?.transition_out || '').trim(),
  };
}

/**
 * 短镜顺延合并：优先凑满 15 秒档，最多装到 15 秒档（与时长拆镜一致）。
 * 合并时同步拼接画面/对白/景别/运镜等内容。
 */
export function mergeShortOriginalShotSuggestions(
  drafts: OriginalShotDraft[],
  prefSec = DRAMA_ORIGINAL_SHOT_PREF_SEC,
  capSec = DRAMA_ORIGINAL_SHOT_CAP_SEC,
): DramaShotSuggestion[] {
  if (!drafts.length) return [];
  const SHORT_TAIL = 10;
  const groups: OriginalShotDraft[][] = [];
  let cur: OriginalShotDraft[] = [];
  let sum = 0;
  const flush = () => {
    if (!cur.length) return;
    groups.push(cur);
    cur = [];
    sum = 0;
  };
  for (const d of drafts) {
    const est = Math.max(0.1, Number(d.raw_est_sec) || Number(d.duration_sec) || 0);
    if (!cur.length) {
      cur = [d];
      sum = est;
      continue;
    }
    if (sum + est > capSec + 0.05) {
      flush();
      cur = [d];
      sum = est;
      continue;
    }
    if (sum < prefSec) {
      cur.push(d);
      sum += est;
      continue;
    }
    if (est < SHORT_TAIL) {
      cur.push(d);
      sum += est;
      continue;
    }
    flush();
    cur = [d];
    sum = est;
  }
  flush();

  return groups.map((group, gi) =>
    finalizeMergedShotGroup(group, String(gi + 1).padStart(2, '0')),
  );
}

function finalizeMergedShotGroup(
  group: OriginalShotDraft[],
  shotNo: string,
  mode: 'precise' | 'tier' = 'tier',
): DramaShotSuggestion {
  const raw = group.reduce((n, s) => n + Math.max(0.1, Number(s.raw_est_sec) || 0), 0);
  const first = group[0];
  const scenes = uniqueKeepOrder(group.map((s) => s.scene));
  // 分析阶段用精确秒；脚本设计等可落档 6/10/15
  const sec =
    mode === 'precise' ? Math.round(Math.max(0.1, raw) * 10) / 10 : snapOriginalShotDurationSec(raw);
  const content = composeMergedShotContent(group, raw, sec);
  return {
    ...first,
    suggestion_id: group.length === 1 ? first.suggestion_id : `ssug-merge-${shotNo}-${Date.now().toString(36)}`,
    shot: shotNo,
    scene: scenes.join(' / '),
    ...content,
    time_of_day: first.time_of_day,
    environment: uniqueKeepOrder(group.map((s) => s.environment).filter(Boolean)).join(' · '),
    duration_sec: sec,
    duration_ai: sec,
    duration_min: sec,
    duration_max: sec,
    duration_locked: true,
    duration_why:
      mode === 'precise'
        ? group.length === 1
          ? first.duration_why || `快节奏估 ${sec}s`
          : `合并 ${group.length} 镜（估 ${sec}s）`
        : group.length === 1
          ? first.duration_why || `${sec}秒档`
          : `合并 ${group.length} 镜画面/对白（估 ${Math.round(raw * 10) / 10}s）→ ${sec}秒档`,
    cast_names: uniqueKeepOrder(group.flatMap((s) => s.cast_names || [])),
    visual_event_ids: uniqueKeepOrder(group.flatMap((s) => s.visual_event_ids || [])),
    prop_names: uniqueKeepOrder(group.flatMap((s) => s.prop_names || [])),
    creature_names: uniqueKeepOrder(group.flatMap((s) => s.creature_names || [])),
  };
}

/** 把已有分镜建议按 15 秒档合并（剧本拆分 / 脚本设计共用） */
export function mergeDramaShotSuggestionsToDurationTiers(
  suggestions: DramaShotSuggestion[],
): DramaShotSuggestion[] {
  const drafts: OriginalShotDraft[] = (suggestions || []).map((s, i) => ({
    ...s,
    suggestion_id: s.suggestion_id || `ssug-${i + 1}`,
    raw_est_sec: Math.max(
      0.1,
      Number(s.duration_ai) > 0
        ? Number(s.duration_ai)
        : Number(s.duration_sec) > 0
          ? Number(s.duration_sec)
          : 5,
    ),
  }));
  return mergeShortOriginalShotSuggestions(drafts);
}

/**
 * 手动勾选合并：须勾选 ≥2 条且在表中连续；原文块直接拼接，时长为估算秒之和（精确到 0.1s，不落档）。
 */
export function mergeDramaShotSuggestionsByIds(
  suggestions: DramaShotSuggestion[],
  selectedIds: string[],
): { ok: true; suggestions: DramaShotSuggestion[] } | { ok: false; error: string } {
  const want = new Set((selectedIds || []).map((id) => String(id || '').trim()).filter(Boolean));
  if (want.size < 2) return { ok: false, error: '请至少勾选 2 条连续分镜再合并' };
  const list = suggestions || [];
  const indices: number[] = [];
  list.forEach((s, i) => {
    if (want.has(String(s.suggestion_id || '').trim())) indices.push(i);
  });
  if (indices.length < 2) return { ok: false, error: '勾选的分镜无效' };
  for (let k = 1; k < indices.length; k += 1) {
    if (indices[k] !== indices[k - 1] + 1) {
      return { ok: false, error: '请勾选表中连续的分镜行再合并' };
    }
  }
  const firstIdx = indices[0];
  const lastIdx = indices[indices.length - 1];
  const drafts: OriginalShotDraft[] = indices.map((i) => {
    const s = list[i];
    return {
      ...s,
      raw_est_sec: Math.max(
        0.1,
        Number(s.duration_ai) > 0
          ? Number(s.duration_ai)
          : Number(s.duration_sec) > 0
            ? Number(s.duration_sec)
            : 5,
      ),
    };
  });
  const merged = finalizeMergedShotGroup(drafts, String(firstIdx + 1).padStart(2, '0'), 'precise');
  const next = [...list.slice(0, firstIdx), merged, ...list.slice(lastIdx + 1)].map((s, i) => ({
    ...s,
    shot: String(i + 1).padStart(2, '0'),
  }));
  return { ok: true, suggestions: next };
}

function normalizeShotSceneKey(scene: string): string {
  return String(scene || '')
    .replace(/\s+/g, '')
    .replace(/续\d+$/u, '')
    .trim()
    .toLowerCase();
}

/**
 * 短镜凑档（同场相邻两镜）：
 * 10+10 → 20；6+10 / 10+6 → 15；6+6 → 10。
 * 自左向右扫一遍；跨场不合。
 */
export function coalesceAdjacentShortDurationShots(
  suggestions: DramaShotSuggestion[],
): DramaShotSuggestion[] {
  const list = suggestions || [];
  if (list.length < 2) return list.map((s, i) => ({ ...s, shot: String(i + 1).padStart(2, '0') }));

  const out: DramaShotSuggestion[] = [];
  let i = 0;
  while (i < list.length) {
    const a = list[i];
    const b = list[i + 1];
    const ta = Math.round(Number(a?.duration_sec) || 0);
    const tb = b ? Math.round(Number(b.duration_sec) || 0) : 0;
    const sameScene =
      !!b && normalizeShotSceneKey(a.scene) === normalizeShotSceneKey(b.scene);
    let target = 0;
    if (sameScene) {
      if (ta === 10 && tb === 10) target = 20;
      else if ((ta === 6 && tb === 10) || (ta === 10 && tb === 6)) target = 15;
      else if (ta === 6 && tb === 6) target = 10;
    }
    if (target > 0 && b) {
      const drafts: OriginalShotDraft[] = [a, b].map((s) => ({
        ...s,
        raw_est_sec: Math.max(
          0.1,
          Number(s.duration_ai) > 0
            ? Number(s.duration_ai)
            : Number(s.duration_sec) > 0
              ? Number(s.duration_sec)
              : target,
        ),
      }));
      const merged = finalizeMergedShotGroup(
        drafts,
        String(out.length + 1).padStart(2, '0'),
        'precise',
      );
      out.push({
        ...merged,
        duration_sec: target,
        duration_ai: target,
        duration_min: target,
        duration_max: target,
        duration_locked: true,
        duration_why: `短镜凑档 ${ta}+${tb}→${target}秒`,
      });
      i += 2;
      continue;
    }
    out.push({ ...a, shot: String(out.length + 1).padStart(2, '0') });
    i += 1;
  }
  return out.map((s, idx) => ({ ...s, shot: String(idx + 1).padStart(2, '0') }));
}

/** 剧本拆分：Narrative → Shot Beat → H3 Clip；硬切必拆，超上限再软拆落 6/10/15。 */
export function shotSuggestionsFromOriginalAnalysis(input: {
  original_scenes: DramaOriginalScene[];
  original_segments: DramaOriginalSegment[];
  visual_events: DramaVisualEvent[];
  source?: string;
}): DramaShotSuggestion[] {
  const scenes = input.original_scenes || [];
  const segments = input.original_segments || [];
  const ves = input.visual_events || [];
  const veIdsBySeg = visualEventIdsBySegment(ves);
  const segsByScene = groupOriginalSegmentsByScene(segments);

  const toH3ClipShot = (d: OriginalShotDraft, shotNo: string): DramaShotSuggestion => {
    const raw = Math.round(Math.max(0.1, Number(d.raw_est_sec) || 0) * 10) / 10;
    const tier = snapDramaDurationSplitTierSec(raw);
    const lo = Math.min(raw, tier);
    const why = String(d.duration_why || '').trim() || `叙事拆镜 估 ${raw}s → ${tier}秒档`;
    return {
      suggestion_id: d.suggestion_id,
      scene: d.scene,
      shot: shotNo,
      purpose: d.purpose,
      size: d.size,
      camera: d.camera,
      move: d.move,
      action: d.action,
      dialogue: d.dialogue,
      sound: d.sound,
      emotion_play: d.emotion_play,
      subtext: d.subtext,
      lighting: d.lighting,
      blocking: d.blocking,
      time_of_day: d.time_of_day,
      environment: d.environment,
      duration_sec: tier,
      duration_ai: raw,
      duration_min: lo,
      duration_max: tier,
      duration_locked: true,
      duration_why: why.includes('→') ? why : `${why} → ${tier}秒档`,
      cast_names: d.cast_names,
      visual_event_ids: d.visual_event_ids,
      prop_names: d.prop_names,
      creature_names: d.creature_names,
    };
  };

  const drafts: OriginalShotDraft[] = [];
  for (let si = 0; si < scenes.length; si += 1) {
    const scene = scenes[si];
    const sceneSegs = (segsByScene.get(scene.scene_id) || segsByScene.get(scene.scene_no) || []).slice();
    if (!sceneSegs.length) continue;
    const packs = packOriginalSegmentsIntoH3ShotBeats(sceneSegs);
    const sceneOrd = si + 1;
    for (let pi = 0; pi < packs.length; pi += 1) {
      const pack = packs[pi];
      const est = Math.round(estimateOriginalSegmentPackSec(pack, pi === 0) * 10) / 10;
      const composed = literalFieldsFromOriginalPack(pack, input.source);
      const eventIds = uniqueKeepOrder(pack.flatMap((s) => veIdsBySeg.get(s.segment_id) || []));
      const hardCut = pi > 0 && pack[0] && isDramaNarrativeHardCutStart(pack[0]);
      drafts.push({
        suggestion_id: `ssug-scene-${scene.scene_id}-${pi + 1}`,
        scene: formatOriginalSceneLabel(scene),
        shot:
          packs.length === 1
            ? String(sceneOrd).padStart(2, '0')
            : `${String(sceneOrd).padStart(2, '0')}-${pi + 1}`,
          purpose:
            packs.length === 1 ? '场次' : hardCut ? `叙事硬切${pi + 1}` : pi === 0 ? '场次' : `场次续${pi + 1}`,
        size: '',
        camera: '',
        move: '',
        action: composed.action,
        dialogue: composed.dialogue,
        sound: '',
        emotion_play: composed.emotion_play,
        subtext: composed.subtext,
        lighting: '',
        blocking: '',
        time_of_day: String(scene.time || '').trim(),
        environment: String(scene.location || '').trim(),
        duration_sec: est,
        duration_why: hardCut
          ? `叙事硬切 估 ${est}s`
          : packs.length > 1
            ? `叙事拆镜 估 ${est}s`
            : `快节奏估 ${est}s`,
        cast_names: composed.cast_names,
        visual_event_ids: eventIds,
        prop_names: [],
        creature_names: [],
        raw_est_sec: est,
      });
    }
  }
  if (drafts.length) {
    return drafts.map((d, i) => toH3ClipShot(d, String(i + 1).padStart(2, '0')));
  }
  // 无场次标题时退回按片段，落 H3 档
  const fallback: OriginalShotDraft[] = ves.map((ev, i) => {
    const seg = (ev.source_segment_ids || []).map((id) => segments.find((s) => s.segment_id === id)).find(Boolean);
    const type = seg?.type || 'other';
    const text = String(ev.original_text || seg?.original_text || ev.see || '').trim();
    const est = estimateOriginalSegmentDurationSec(text, type, {
      performance: seg?.performance,
      isSceneStart: i === 0,
    });
    const pack = seg ? [seg] : [];
    const composed = pack.length
      ? literalFieldsFromOriginalPack(pack, input.source)
      : {
          action: text,
          dialogue: '',
          emotion_play: '',
          subtext: '',
          cast_names: uniqueKeepOrder(
            [String(ev.who || '').trim()].filter((n) => !isSystemSpeakerName(n) && isDramaStrictCastName(n)),
          ),
        };
    return {
      suggestion_id: `ssug-orig-${ev.event_id || String(i + 1).padStart(3, '0')}`,
      scene: String(ev.location || '').trim(),
      shot: String(i + 1).padStart(2, '0'),
      purpose: ORIGINAL_SEGMENT_PURPOSE[type] || '原文',
      size: '',
      camera: '',
      move: '',
      action: composed.action || text,
      dialogue: composed.dialogue,
      sound: '',
      emotion_play: composed.emotion_play,
      subtext: '',
      lighting: '',
      blocking: '',
      time_of_day: '',
      environment: '',
      duration_sec: est,
      duration_why: `快节奏估 ${Math.round(est * 10) / 10}s`,
      cast_names: composed.cast_names.length
        ? composed.cast_names
        : uniqueKeepOrder(
            [String(seg?.character_name || ev.who || '').trim()].filter(
              (n) => !isSystemSpeakerName(n) && isDramaStrictCastName(n),
            ),
          ),
      visual_event_ids: ev.event_id ? [ev.event_id] : [],
      prop_names: [],
      creature_names: [],
      raw_est_sec: est,
    };
  });
  return fallback.map((d, i) => toH3ClipShot(d, String(i + 1).padStart(2, '0')));
}

/**
 * 时长拆镜：按对白+动作估时把每场原文切成几段。
 * 单镜估时落在档位 ±35% 内不拆（约 20 秒→15）；超过 15×1.35 再拆。
 * 切出来不足 25 字、冒号结尾、或同一人物话没说完，不拆。原文整段写入，不填景别/运镜。
 */
export function shotSuggestionsFromDurationSplit(input: {
  original_scenes: DramaOriginalScene[];
  original_segments: DramaOriginalSegment[];
  visual_events: DramaVisualEvent[];
  source?: string;
}): DramaShotSuggestion[] {
  const scenes = input.original_scenes || [];
  const segments = input.original_segments || [];
  const ves = input.visual_events || [];
  const veIdsBySeg = visualEventIdsBySegment(ves);
  const segsByScene = groupOriginalSegmentsByScene(segments);

  const toTierShot = (d: OriginalShotDraft, shotNo: string): DramaShotSuggestion => {
    const raw = Math.round(Math.max(0.1, Number(d.raw_est_sec) || 0) * 10) / 10;
    const tier = snapDramaDurationSplitTierSec(raw);
    const lo = Math.min(raw, tier);
    return {
      suggestion_id: d.suggestion_id,
      scene: d.scene,
      shot: shotNo,
      purpose: d.purpose,
      size: '',
      camera: '',
      move: '',
      action: d.action,
      dialogue: d.dialogue,
      sound: d.sound,
      emotion_play: d.emotion_play,
      subtext: d.subtext,
      lighting: d.lighting,
      blocking: d.blocking,
      time_of_day: d.time_of_day,
      environment: d.environment,
      duration_sec: tier,
      duration_ai: raw,
      duration_min: lo,
      duration_max: tier,
      duration_locked: true,
      duration_why: `时长拆镜 本镜估 ${raw}s（±35%）→ ${tier}秒档`,
      cast_names: d.cast_names,
      visual_event_ids: d.visual_event_ids,
      prop_names: d.prop_names,
      creature_names: d.creature_names,
    };
  };

  const drafts: OriginalShotDraft[] = [];
  for (let si = 0; si < scenes.length; si += 1) {
    const scene = scenes[si];
    const sceneSegs = (segsByScene.get(scene.scene_id) || segsByScene.get(scene.scene_no) || []).slice();
    if (!sceneSegs.length) continue;
    const inputs = sceneSegs.map((seg, idx) =>
      originalSegmentToFastPaceInput(seg, { isSceneStart: idx === 0 }),
    );
    const packed = packDramaFastPaceByDurationTiers(inputs);
    const packs = packed.packs.length
      ? packed.packs
      : [{ start: 0, end: sceneSegs.length, totalSec: 0, tierSec: 6 }];
    const sceneOrd = si + 1;
    for (let pi = 0; pi < packs.length; pi += 1) {
      const p = packs[pi];
      const pack = sceneSegs.slice(p.start, p.end);
      const est = Math.round(Math.max(0.1, Number(p.totalSec) || 0) * 10) / 10;
      const composed = literalFieldsFromOriginalPack(pack, input.source);
      const eventIds = uniqueKeepOrder(pack.flatMap((s) => veIdsBySeg.get(s.segment_id) || []));
      drafts.push({
        suggestion_id: `ssug-dur-${scene.scene_id}-${pi + 1}`,
        scene: formatOriginalSceneLabel(scene),
        shot:
          packs.length === 1 ? String(sceneOrd).padStart(2, '0') : `${String(sceneOrd).padStart(2, '0')}-${pi + 1}`,
        purpose: packs.length === 1 ? '场次' : `场次续${pi + 1}`,
        size: '',
        camera: '',
        move: '',
        action: composed.action,
        dialogue: composed.dialogue,
        sound: '',
        emotion_play: composed.emotion_play,
        subtext: composed.subtext,
        lighting: '',
        blocking: '',
        time_of_day: String(scene.time || '').trim(),
        environment: String(scene.location || '').trim(),
        duration_sec: est,
        duration_why: `时长拆镜 本镜估 ${est}s`,
        cast_names: composed.cast_names,
        visual_event_ids: eventIds,
        prop_names: [],
        creature_names: [],
        raw_est_sec: est,
      });
    }
  }
  if (drafts.length) {
    return coalesceAdjacentShortDurationShots(
      drafts.map((d, i) => toTierShot(d, String(i + 1).padStart(2, '0'))),
    );
  }
  const analysis = shotSuggestionsFromOriginalAnalysis(input);
  return coalesceAdjacentShortDurationShots(
    analysis.map((s, i) =>
      toTierShot(
        { ...s, raw_est_sec: Number(s.duration_ai) || Number(s.duration_sec) || 5 },
        String(i + 1).padStart(2, '0'),
      ),
    ),
  );
}

export function formatDramaOriginalAnalyzeAlert(title: string, summary: DramaEpisodeAnalysisSummary, integrity?: DramaOriginalIntegrityReport, shotCount?: number): string {
  const ep = String(title || '本集').trim() || '本集';
  const lines = [
    `「${ep}」本集分析完成`,
    '',
    `${summary.scene_count} 个场景`,
    `${summary.segment_count} 个原文片段`,
    ...(Number.isFinite(Number(shotCount)) && Number(shotCount) >= 0
      ? [`${shotCount} 条分镜已写入（叙事拆镜：硬切必拆，超 H3 上限再软拆落档）`]
      : []),
    `${summary.character_mention_count} 个角色引用`,
    `${summary.scene_mention_count} 个场景引用`,
    '',
    '人物素材：',
    `✓ ${summary.character_matched} 个已匹配`,
    `⚠ ${summary.character_pending} 个待匹配`,
    '',
    '声音：',
    `✓ ${summary.voice_matched} 个已匹配`,
    `⚠ ${summary.voice_pending} 个待匹配`,
    '',
    '场景素材：',
    `✓ ${summary.scene_matched} 个已匹配`,
    `⚠ ${summary.scene_pending} 个待匹配`,
    '',
    '视觉风格：',
    summary.visual_bible_bound ? '✓ 已绑定 Visual Bible' : '⚠ 未绑定 Visual Bible',
  ];
  if (summary.character_ambiguous) {
    lines.push('', `其中 ${summary.character_ambiguous} 个人物名称有歧义，需人工确认。`);
  }
  if (integrity && !integrity.ok) {
    lines.push('', `⚠ 原文完整性校验未通过：${integrity.notes.join('；') || '存在未覆盖原文'}`);
    if (integrity.missing_samples.length) {
      lines.push(`未覆盖样例：${integrity.missing_samples.join(' / ')}`);
    }
  }
  return lines.join('\n');
}

export function analyzeDramaEpisodeOriginal(input: DramaOriginalAnalyzeInput): DramaOriginalAnalyzeResult {
  const source = String(input.source || '');
  const known = (input.characters || []).map((c) => c.name).filter(Boolean);
  const parsed = parseOriginalScript(source, input.episodeId, known);
  const bound = bindOriginalScriptAssets(parsed, input);
  const { visualEvents, sceneBeats } = buildVisualEventsFromOriginalSegments(bound.scenes, bound.segments);
  const integrity = auditOriginalScriptIntegrity(source, bound.scenes, bound.segments);
  const partial = {
    original_scenes: bound.scenes,
    original_segments: bound.segments,
    visual_events: visualEvents,
    scene_beats: sceneBeats,
    character_bindings: bound.character_bindings,
    voice_bindings: bound.voice_bindings,
    scene_bindings: bound.scene_bindings,
    visual_bible_binding: bound.visual_bible_binding,
    integrity,
  };
  const shot_suggestions = shotSuggestionsFromOriginalAnalysis({
    original_scenes: bound.scenes,
    original_segments: bound.segments,
    visual_events: visualEvents,
    source,
  });
  return {
    ...partial,
    shot_suggestions,
    summary: buildDramaEpisodeAnalysisSummary(partial),
  };
}
