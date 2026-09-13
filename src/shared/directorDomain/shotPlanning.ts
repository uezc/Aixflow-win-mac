import { normalizeDramaShotPlanPaceGear } from './types.js';
import type {
  DramaEmotion,
  DramaNarrativeBeat,
  DramaDirectorBeat,
  DramaSceneBeat,
  DramaShotIntent,
  DramaShotPlanPaceGear,
  DramaShotSuggestion,
  DramaNarrativePlanningResult,
  VisualEmphasis,
} from './types.js';
import { parseDramaSceneHeadingLine } from './originalScript.js';

/**
 * 导演拆戏：视觉事件 → 戏剧 Beat → 镜头。
 * 禁止「一段小说 = 两三镜」；先拆必须被看见的事件，再合并。
 */

// ================= 反拖沓共享规则（所有挡位统一注入） =================
// 规则文本用数组组织，注入提示词时 join 成段落，便于维护和二次扩展
export const DRAMA_ANTI_DILUTION_RULE_LINES: readonly string[] = [
  '【反拖沓共享铁律 1·一节拍一信息点】无论镜头/视频段内部采用何种子窗口结构，每个节拍（时间窗/子窗）必须承载一个新信息点：新动作/新对白/新情绪/新揭示/新人物入场/新空间切换。禁止无信息的"慢推半张脸""掠过走廊""沉默呼吸""匀速横移"等纯视觉填充；这类窗口若没有新事实，必须删除或并入相邻有信息节拍。',
  '【反拖沓共享铁律 2·运镜默认固定】运镜默认使用固定机位或手持微晃（真实人眼观察的轻微位移）。长推/缓推只留给情绪峰值节拍（如反转揭晓、崩溃点、关键揭示），且整条 20s 视频最多 1 处缓推。禁止出现的慢推词：缓慢掠过、匀速横移、慢推、呼吸平移、持续压缩、缓缓推进、缓慢拉近。扫描到这些词必须替换为固定机位/手持微晃/动作打断切。',
  '【反拖沓共享铁律 3·节奏靠节拍切换，不靠长镜硬撑】信息密度和节奏来自节拍与节拍之间的快切、动作打断、光影突变、说话人切换，而不是把一个长动作拉满整条时长。如果某段 4-5 秒没有信息点更新 → 必须通过切点把它压缩或把下一个信息点提前塞入。',
] as const;
export const DRAMA_ANTI_DILUTION_SLOW_MOVE_KEYWORDS: readonly string[] = [
  '缓慢掠过',
  '匀速横移',
  '慢推',
  '呼吸平移',
  '持续压缩',
  '缓缓推进',
  '缓慢拉近',
  '缓慢拉远',
  '慢慢推进',
  '匀速推移',
] as const;
// ================= 反拖沓共享规则结束 =================

// dense_20s 节拍窗口定义：5 段式结构，时长和严格等于 20s
export interface DramaDense20sBeatWindow {
index: 1 | 2 | 3 | 4 | 5;
label: string;
window: string; // 如 "0-4s"
startSec: number;
endSec: number;
durationSec: number;
role: 'hook' | 'push' | 'emotion' | 'twist' | 'suspense';
maxDialogueChars: number; // 4.5 字/秒 * duration
}
export const DRAMA_DENSE_20S_BEAT_WINDOWS: readonly DramaDense20sBeatWindow[] = [
{ index: 1, label: '钩子', window: '0-4s', startSec: 0, endSec: 4, durationSec: 4, role: 'hook', maxDialogueChars: 18 }, // 4.5*4=18
{ index: 2, label: '推进', window: '4-9s', startSec: 4, endSec: 9, durationSec: 5, role: 'push', maxDialogueChars: 22 }, // 4.5*5≈22
{ index: 3, label: '情绪/反应', window: '9-13s', startSec: 9, endSec: 13, durationSec: 4, role: 'emotion', maxDialogueChars: 18 },
{ index: 4, label: '反转/新事件', window: '13-17s', startSec: 13, endSec: 17, durationSec: 4, role: 'twist', maxDialogueChars: 18 },
{ index: 5, label: '悬念收口', window: '17-20s', startSec: 17, endSec: 20, durationSec: 3, role: 'suspense', maxDialogueChars: 13 },
] as const;
export const DRAMA_DENSE_20S_SEGMENT_DURATION = 20;
export const DRAMA_DENSE_20S_MAX_DIALOGUE_CHARS_PER_SEGMENT = 90; // 4.5 * 20

export const DRAMA_DRAMATIC_PURPOSES = [
'establish',
'introduce',
'action',
'reaction',
'dialogue',
'reveal',
'emotional',
'relationship',
'transition',
'suspense',
'foreshadow',
'impact',
'result',
'information',
'environment',
'insert',
] as const;

export type DramaDramaticPurpose = (typeof DRAMA_DRAMATIC_PURPOSES)[number];

export type DramaVisualEventKind =
| 'establish'
| 'introduce'
| 'action'
| 'reaction'
| 'dialogue'
| 'reveal'
| 'emotional'
| 'transition'
| 'information'
| 'environment'
| 'insert';

/** A = 剧情硬事件（必须 100% 入镜）；B = 视觉辅助（允许 80%～90%） */
export type DramaVisualEventPriority = 'A' | 'B';

export interface DramaVisualEvent {
event_id: string;
index: number;
location: string;
kind: DramaVisualEventKind;
who: string;
/** 演员具体做什么：推开门、后退半步、拿起杯子... */
action: string;
/** 可见表情/肢体微相：眉压低、下颌收紧、瞳孔放大... */
expression: string;
/** 导演情绪意图 — 结构化，贯穿全链路不得被覆盖或删除 */
emotion: DramaEmotion;
/** 视线落点 / 被看对象（如「远处」「江澈」）；不是整幅画面散文，也不是运镜 */
see: string;
/** 切点理由；只表达事件边界，不生成 cinematic camera */
cut: string;
/** 站位理解（自然语言）；写入 Timeline.position，不新增 Timeline 字段 */
position?: string;
/** 硬事件 / 辅助事件；缺省由 classify 补全 */
priority: DramaVisualEventPriority;
/** 追溯到 OriginalSegment；分析阶段不得另写摘要；禁止编造 ID */
source_segment_ids?: string[];
/** 完整原文（与 source segment 一致，禁止 substring 截断） */
original_text?: string;
}

// ================= 原文场景分割（不调 LLM，正则切分 + 字符串匹配） =================

const SCENE_MARKER_RE =
  /(?:【\s*(?:S\d+|第[一二三四五六七八九十\d]+[场幕]|场景[一二三四五六七八九十\d]?)\s*[^】]*】)|(?:第[一二三四五六七八九十\d]+[场幕][\s:：][^\n]*)|(?:^场景\s*[:：]\s*[^\n]+)/m;

function parseSceneMarker(marker: string): { sceneNo: string; locationName: string } {
  const s = String(marker || '').trim();
  let m = s.match(/【\s*S(\d+)/);
  if (m) {
    const sceneNo = `S${m[1].padStart(2, '0')}`;
    const rest = s.replace(/【\s*S\d+\s*/, '').replace(/】$/, '').trim();
    return { sceneNo, locationName: rest || `场景${m[1]}` };
  }
  m = s.match(/第([一二三四五六七八九十\d]+)[场幕]/);
  if (m) {
    const num = m[1].match(/\d+/) ? m[1] : String(cnToNum(m[1]));
    const sceneNo = `S${num.padStart(2, '0')}`;
    const rest = s.replace(/第[一二三四五六七八九十\d]+[场幕]\s*/, '').replace(/[:：]\s*/, '').trim();
    return { sceneNo, locationName: rest || `场景${num}` };
  }
  m = s.match(/场景\s*[:：]?\s*(.+)/);
  if (m) {
    const name = m[1].trim();
    const num = name.match(/\d+/)?.[0] || '01';
    return { sceneNo: `S${num.padStart(2, '0')}`, locationName: name };
  }
  return { sceneNo: 'S01', locationName: s };
}

function cnToNum(cn: string): number {
  const map: Record<string, number> = { '一': 1, '二': 2, '三': 3, '四': 4, '五': 5, '六': 6, '七': 7, '八': 8, '九': 9, '十': 10 };
  return map[cn] || 1;
}

export interface DramaScriptScene {
  sceneNo: string;
  locationName: string;
  text: string;
  matchedCharacters: string[];
}

export function splitScriptByScenes(
  source: string,
  characterNames?: string[],
): DramaScriptScene[] {
  const text = String(source || '').trim();
  if (!text) return [];
  const lines = text.split(/\n/);
  const scenes: DramaScriptScene[] = [];
  let current: { sceneNo: string; locationName: string; lines: string[] } | null = null;
  for (const line of lines) {
    const trimmed = line.trim();
    const parsedHeading = parseDramaSceneHeadingLine(trimmed);
    const isMarker = !!parsedHeading || SCENE_MARKER_RE.test(trimmed);
    if (isMarker) {
      if (current && current.lines.length) {
        const sceneText = current.lines.join('\n').trim();
        scenes.push({ sceneNo: current.sceneNo, locationName: current.locationName, text: sceneText, matchedCharacters: matchCharactersInText(sceneText, characterNames) });
      }
      const parsed = parsedHeading
        ? { sceneNo: parsedHeading.scene_no, locationName: parsedHeading.location }
        : parseSceneMarker(trimmed);
      current = { sceneNo: parsed.sceneNo, locationName: parsed.locationName, lines: [] };
      if (!parsedHeading) {
        const afterMarker = trimmed.replace(SCENE_MARKER_RE, '').trim();
        if (afterMarker) current.lines.push(afterMarker);
      }
    } else {
      if (!current) current = { sceneNo: 'S01', locationName: '开场', lines: [] };
      current.lines.push(line);
    }
  }
  if (current && current.lines.length) {
    const sceneText = current.lines.join('\n').trim();
    scenes.push({ sceneNo: current.sceneNo, locationName: current.locationName, text: sceneText, matchedCharacters: matchCharactersInText(sceneText, characterNames) });
  }
  if (!scenes.length && text) {
    scenes.push({ sceneNo: 'S01', locationName: '全本', text, matchedCharacters: matchCharactersInText(text, characterNames) });
  }
  return scenes;
}

function matchCharactersInText(text: string, names?: string[]): string[] {
  if (!names || !names.length) return [];
  const matched: string[] = [];
  for (const name of names) {
    const n = String(name || '').trim();
    if (n && text.includes(n)) matched.push(n);
  }
  return matched;
}

/** 对白正则（与 extractDialogueFromText 一致，用于定位对白在原文中的位置） */
const DIALOGUE_REGEX =
  /(?:(?:([^\n「」:：]{1,8})\s*[（(]([^)）]*)[)）]\s*[:：]\s*)|(?:([^\n「」:：]{1,8})\s*[:：]\s*))?[「""]([^」""]{1,200})[」""]/g;

/**
 * 把场景文本按「对白」与「非对白描述」交替切分为有序片段。
 * 对白 → dialogue 片段（逐字保留）；对白之间/前后的描述 → action 片段（动作/反应/揭示等）。
 * 这样 shotPlan 阶段能看到剧本中所有内容，不会遗漏非对白描写。
 */
function splitSceneTextIntoSegments(
  text: string,
): { type: 'action' | 'dialogue'; speaker: string; content: string }[] {
  const segments: { type: 'action' | 'dialogue'; speaker: string; content: string }[] = [];
  const re = new RegExp(DIALOGUE_REGEX.source, 'g');
  let lastEnd = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const before = text.slice(lastEnd, m.index).trim();
    if (before && before.replace(/\s+/g, '').length > 4) {
      segments.push({ type: 'action', speaker: '', content: before });
    }
    const speaker = (m[1] || m[3] || '').trim();
    const line = (m[4] || '').trim();
    if (line) {
      segments.push({ type: 'dialogue', speaker, content: line });
    }
    lastEnd = m.index + m[0].length;
  }
  const after = text.slice(lastEnd).trim();
  if (after && after.replace(/\s+/g, '').length > 4) {
    segments.push({ type: 'action', speaker: '', content: after });
  }
  return segments;
}

function extractDialogueFromText(text: string): { speaker: string; line: string }[] {
  const dialogues: { speaker: string; line: string }[] = [];
  const re = new RegExp(DIALOGUE_REGEX.source, 'g');
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const speaker = (m[1] || m[3] || '').trim();
    const line = (m[4] || '').trim();
    if (line) dialogues.push({ speaker, line });
  }
  return dialogues;
}

/**
 * 从文本推断视觉事件类型：揭示关键词 → reveal；反应关键词 → reaction；
 * 情绪关键词 → emotional；转场关键词 → transition；其余 → action。
 */
function classifyActionEventKind(text: string): DramaVisualEventKind {
  if (/(?:发现|看见|露出|揭示|揭晓|出现|浮现|显现|原来是|赫然)/.test(text)) return 'reveal';
  if (/(?:转身|后退|向前|走向|跑|冲|推|拉|握|松|跪|倒|摔|跳|爬|停住|顿住|愣)/.test(text)) return 'action';
  if (/(?:脸色|表情|眼神|颤抖|发抖|泛红|泛白|咬唇|皱眉|微笑|落泪|呼吸)/.test(text)) return 'reaction';
  if (/(?:转场|切换|黑屏|渐隐|渐显|次日|后来|不久|随后)/.test(text)) return 'transition';
  return 'action';
}

export function buildVisualEventsFromScenes(
  scenes: DramaScriptScene[],
): { visualEvents: DramaVisualEvent[]; sceneBeats: DramaSceneBeat[] } {
  const visualEvents: DramaVisualEvent[] = [];
  const sceneBeats: DramaSceneBeat[] = [];
  let eventIndex = 1;
  for (const scene of scenes) {
    sceneBeats.push({
      scene_beat_id: `SB-${scene.sceneNo}`,
      scene_no: scene.sceneNo,
      scene_asset_id: '',
      location_name: scene.locationName,
      int_ext: '', day_night: '', weather: '',
      cast_ids: [], prop_ids: [], creature_ids: [],
      dramatic_goal: '', purpose: '', event: '', conflict: '', result: '', emotion: '',
      characters: scene.matchedCharacters,
    });
    visualEvents.push({
      event_id: `EV${String(eventIndex).padStart(3, '0')}`,
      index: eventIndex, location: scene.sceneNo, kind: 'establish',
      who: '', action: scene.locationName, expression: '',
      emotion: { primary: '', intensity: 0.5 },
      see: scene.locationName, cut: 'space', priority: 'B',
      original_text: scene.locationName,
    });
    eventIndex++;
    // 交替提取对白与非对白描述，确保剧本内容全部进入分镜流程
    const segments = splitSceneTextIntoSegments(scene.text);
    for (const seg of segments) {
      if (seg.type === 'dialogue') {
        visualEvents.push({
          event_id: `EV${String(eventIndex).padStart(3, '0')}`,
          index: eventIndex, location: scene.sceneNo, kind: 'dialogue',
          who: seg.speaker, action: '', expression: '',
          emotion: { primary: '', intensity: 0.5 },
          see: seg.speaker ? `${seg.speaker}：「${seg.content}」` : `「${seg.content}」`,
          cut: 'speaker', priority: 'A',
          original_text: seg.content,
        });
      } else {
        const contentTrimmed = seg.content.replace(/\s+/g, ' ').trim();
        const who = scene.matchedCharacters.find((name) => contentTrimmed.includes(name)) || '';
        const kind = classifyActionEventKind(contentTrimmed);
        visualEvents.push({
          event_id: `EV${String(eventIndex).padStart(3, '0')}`,
          index: eventIndex, location: scene.sceneNo, kind,
          who, action: contentTrimmed, expression: '',
          emotion: { primary: '', intensity: 0.5 },
          see: contentTrimmed, cut: kind === 'reaction' ? 'emotion' : 'action', priority: 'A',
          original_text: seg.content,
        });
      }
      eventIndex++;
    }
  }
  return { visualEvents, sceneBeats };
}

export interface DramaAnalyzeShotBudget {
eventsMin: number;
eventsTarget: number;
shotsMin: number;
shotsTarget: number;
shotsMax: number;
}

export function normalizeDramaDramaticPurpose(raw: unknown): DramaDramaticPurpose | '' {
const s = String(raw || '')
.trim()
.toLowerCase();
return (DRAMA_DRAMATIC_PURPOSES as readonly string[]).includes(s)
? (s as DramaDramaticPurpose)
: '';
}

export function normalizeDramaVisualEventKind(raw: unknown): DramaVisualEventKind {
const s = String(raw || '')
.trim()
.toLowerCase();
const map: Record<string, DramaVisualEventKind> = {
establish: 'establish',
introduce: 'introduce',
action: 'action',
reaction: 'reaction',
dialogue: 'dialogue',
reveal: 'reveal',
emotional: 'emotional',
emotion: 'emotional',
transition: 'transition',
information: 'information',
info: 'information',
environment: 'environment',
insert: 'insert',
};
return map[s] || 'action';
}

function clampInt(n: number, lo: number, hi: number): number {
return Math.max(lo, Math.min(hi, Math.round(n)));
}

/** 统一事件编号：1 / "3" / "ve-3" / "EV3" → EV003 */
export function normalizeDramaEventId(raw: unknown): string {
const s = String(raw || '').trim();
if (!s) return '';
const m = s.match(/(\d+)/);
if (m) return `EV${String(Number(m[1])).padStart(3, '0')}`;
return s.toUpperCase();
}

/**
* 按信息密度动态估算事件/镜数预算。
* 短场可以 3～5 镜；对白场 8～15；动作/蒙太奇可到 20～32。禁止写死每集 18。
*/
export function estimateDramaAnalyzeShotBudget(sourceText: string): DramaAnalyzeShotBudget {
const text = String(sourceText || '').trim();
const chars = text.replace(/\s+/g, '').length;
const dlgTurns =
(text.match(/[“"「][^”"」]{1,}[”"」]/g) || []).length ||
(text.match(/：\s*[^\n]{2,}/g) || []).length;
// 旁白/画外音/内心独白也算对白事件
const narrationTurns = (
text.match(/旁白\s*[:：]|画外音\s*[:：]|(VO|OS)\s*[:：]|内心独白\s*[:：]/g) || []
).length;
const locHints = (
text.match(
/电梯|走廊|门口|房间|街道|写字楼|雨夜|室内|室外|楼层|大厅|车|骑|便利店|出租屋|草原|平原|办公室/g,
) || []
).length;
const sceneMarks = (
text.match(/第[一二三四五六七八九十\d]+场|换场|来到|走进|离开|冲进|回到/g) || []
).length;
const infoReveals = (
text.match(/手机|屏幕|血条|差评|进度条|广告|账单|面板|超时|攻击力|等级/g) || []
).length;
const actionHits = (text.match(/骑|冲|停|砍|刺|跳|握|松|摔|坠|敲|推|滑/g) || []).length;

const eventsTarget = clampInt(
chars / 90 +
Math.min(14, dlgTurns + narrationTurns) * 0.55 +
Math.min(10, locHints) +
sceneMarks * 1.1 +
Math.min(8, infoReveals) * 0.4,
chars < 700 ? 6 : 10,
// 上限 24：避免一次分析输出过长，在 FC 120s 内被掐断
24,
);
const eventsMin = clampInt(eventsTarget * 0.55, chars < 700 ? 4 : 8, eventsTarget);
const shotsTarget = clampInt(
eventsTarget * 0.55 + sceneMarks * 0.6 + Math.min(8, actionHits) * 0.15,
chars < 700 ? 3 : 6,
32,
);
const shotsMin = clampInt(shotsTarget * 0.72, chars < 700 ? 3 : 5, shotsTarget);
const shotsMax = clampInt(shotsTarget + Math.max(4, shotsTarget * 0.35), shotsTarget + 2, 40);
return { eventsMin, eventsTarget, shotsMin, shotsTarget, shotsMax };
}

/** 第一阶段已有 Visual Events / 场次后，用真实密度收紧镜头预算（靠近 target，而不是死卡 min）。 */
export function refineDramaShotBudgetFromAnalyze(
sourceText: string,
events: Array<{ location?: string }>,
beats: Array<{ location_name?: string }>,
/** 长视频高密度 / 短剧略密、正剧略疏、15秒高密度合镜 */
paceGear?: 'dense_20s' | 'dense_15s' | 'short_drama' | 'cinematic' | string,
): DramaAnalyzeShotBudget {
const base = estimateDramaAnalyzeShotBudget(sourceText);
const ev = Array.isArray(events) ? events.length : 0;
if (ev <= 0) return base;
const locSet = new Set<string>();
for (const e of events) {
const loc = String(e?.location || '').trim();
if (loc) locSet.add(loc);
}
for (const b of beats || []) {
const loc = String(b?.location_name || '').trim();
if (loc) locSet.add(loc);
}
const locCount = Math.max(1, locSet.size, (beats || []).length);
const eventsTarget = ev;
const eventsMin = ev;
const pace = normalizeDramaShotPlanPaceGear(paceGear);
// 20s 长视频高密度：每段含 4-6 个事件 → 段数 ≈ ev*0.45；地点多的略增，总段控制在 2-8
if (pace === 'dense_20s') {
const segmentsTarget = clampInt(ev * 0.45 + locCount * 0.3, 2, 8);
const segmentsMin = clampInt(segmentsTarget * 0.6, 2, segmentsTarget);
const segmentsMax = clampInt(segmentsTarget + Math.max(2, segmentsTarget * 0.35), segmentsTarget + 1, 10);
// shots 字段保持兼容：dense_20s 下游会用 beats 映射为 shots 视图
// 这里预算仍以"可渲染视频段"为单位，避免调用方误判过少
return { eventsMin, eventsTarget, shotsMin: segmentsMin, shotsTarget: segmentsTarget, shotsMax: segmentsMax };
}
const cinematic = pace === 'cinematic';
if (pace === 'dense_15s') {
const shotsTarget = clampInt(ev * 0.28 + locCount * 0.45, 3, 18);
const shotsMin = clampInt(shotsTarget * 0.65, 3, shotsTarget);
const shotsMax = clampInt(shotsTarget + Math.max(3, shotsTarget * 0.35), shotsTarget + 2, 24);
return { eventsMin, eventsTarget, shotsMin, shotsTarget, shotsMax };
}
// 短剧快切：对白细切 + 砍赶路 → 镜数多；正剧略疏
const density = cinematic ? 0.9 : 1.12;
const shotsTarget = clampInt((ev * 0.55 + locCount * 0.8) * density, 3, 36);
const shotsMin = clampInt(shotsTarget * (cinematic ? 0.75 : 0.65), 3, shotsTarget);
const shotsMax = clampInt(
shotsTarget + Math.max(4, shotsTarget * (cinematic ? 0.25 : 0.3)),
shotsTarget + 2,
44,
);
return { eventsMin, eventsTarget, shotsMin, shotsTarget, shotsMax };
}

/** 单次分镜 LLM 超过这些量，容易撞上阿里云 FC 120s 超时 */
export const DRAMA_SHOT_PLAN_SINGLE_MAX_EVENTS = 10;
export const DRAMA_SHOT_PLAN_SINGLE_MAX_SOURCE_CHARS = 1400;
export const DRAMA_SHOT_PLAN_BATCH_MAX_EVENTS = 8;

export function shouldBatchDramaShotPlan(opts: {
  events: Array<{ location?: string }>;
  sourceText: string;
}): boolean {
  const ev = (opts.events || []).length;
  const chars = String(opts.sourceText || '').replace(/\s+/g, '').length;
  return ev > DRAMA_SHOT_PLAN_SINGLE_MAX_EVENTS || chars > DRAMA_SHOT_PLAN_SINGLE_MAX_SOURCE_CHARS;
}

export type DramaShotPlanEventBatch = {
  index: number;
  total: number;
  events: DramaVisualEvent[];
  beats: DramaSceneBeat[];
  sourceText: string;
};

/**
 * 按场次拆分镜请求：每批只带本场 events + 本场原文，避免一次 JSON 撑爆 120s。
 */
export function splitDramaShotPlanEventBatches(opts: {
  events: DramaVisualEvent[];
  beats: DramaSceneBeat[];
  sourceText: string;
  characterNames?: string[];
  maxEventsPerBatch?: number;
}): DramaShotPlanEventBatch[] {
  const events = [...(opts.events || [])].sort(
    (a, b) => (Number(a.index) || 0) - (Number(b.index) || 0),
  );
  if (!events.length) return [];
  const beats = opts.beats || [];
  const maxEv = Math.max(3, opts.maxEventsPerBatch || DRAMA_SHOT_PLAN_BATCH_MAX_EVENTS);
  const scenes = splitScriptByScenes(opts.sourceText, opts.characterNames);
  const sceneByNo = new Map(scenes.map((s) => [s.sceneNo, s]));
  const beatByNo = new Map(beats.map((b) => [String(b.scene_no || ''), b]));

  const groups: DramaVisualEvent[][] = [];
  let current: DramaVisualEvent[] = [];
  let currentLoc = '';
  const flush = () => {
    if (!current.length) return;
    groups.push(current);
    current = [];
  };
  for (const ev of events) {
    const loc = String(ev.location || '').trim() || currentLoc || 'S01';
    if (current.length && (loc !== currentLoc || current.length >= maxEv)) flush();
    currentLoc = loc;
    current.push(ev);
  }
  flush();

  return groups.map((evs, i) => {
    const locs = [
      ...new Set(evs.map((e) => String(e.location || '').trim()).filter(Boolean)),
    ];
    const batchBeats = locs
      .map((loc) => beatByNo.get(loc))
      .filter(Boolean) as DramaSceneBeat[];
    const texts = locs
      .map((loc) => sceneByNo.get(loc)?.text)
      .filter((t): t is string => !!String(t || '').trim());
    return {
      index: i,
      total: groups.length,
      events: evs,
      beats: batchBeats.length ? batchBeats : beats,
      sourceText: texts.length ? texts.join('\n\n') : opts.sourceText,
    };
  });
}

export function scaleDramaShotBudgetForBatch(
  full: DramaAnalyzeShotBudget,
  batchEventCount: number,
  totalEventCount: number,
): DramaAnalyzeShotBudget {
  const ratio = batchEventCount / Math.max(1, totalEventCount);
  const shotsTarget = Math.max(1, Math.round(full.shotsTarget * ratio));
  return {
    eventsMin: batchEventCount,
    eventsTarget: batchEventCount,
    shotsMin: Math.max(1, Math.round(full.shotsMin * ratio)),
    shotsTarget,
    shotsMax: Math.max(shotsTarget + 1, Math.round(full.shotsMax * ratio)),
  };
}

const OVERLOAD_MARKERS = /并|然后|随后|同时|接着|一边|一边|然后又|之后又/;

/** 一镜塞了多个独立动作/多人轮换对白 → 信息过载 */
export function dramaShotLooksOverloaded(action: string, dialogue: string): boolean {
const a = String(action || '');
const d = String(dialogue || '');
const actionHits = (a.match(/骑|减速|刹车|停车|拿|冲|进|出|看|掏|握|松|敲|推|放|转/g) || [])
.length;
const speakers = new Set(
(d.match(/^(.+?)[：:]/gm) || []).map((x) => x.replace(/[：:].*$/, '').trim()).filter(Boolean),
);
const dlgLines = (d.match(/[：:].+/g) || []).length;
return (
(OVERLOAD_MARKERS.test(a) && actionHits >= 3) ||
actionHits >= 5 ||
dlgLines >= 3 ||
speakers.size >= 3
);
}

const HARD_EVENT_KIND = new Set<DramaVisualEventKind>([
'introduce',
'reveal',
'information',
'dialogue',
'transition',
]);

const HARD_EVENT_TEXT =
/天赋|能力|削弱|升级|加点|血条|攻击|差评|超时|订单|死亡|受伤|冲突|对峙|嘲笑|击杀|面板|系统|获得|第一次|首次|关键|道具|技能|限制|进度条|任务|揭示|身份|枪|剑/;

const AUX_EVENT_TEXT =
/雨水|雨滴|车流|皱眉|微皱|走路|走过|氛围|路过|空镜|霓虹|沥青|风吹|呼吸|水帘|帽檐|滴下|穿梭/;

export function normalizeDramaVisualEventPriority(raw: unknown): DramaVisualEventPriority | '' {
const s = String(raw || '')
.trim()
.toUpperCase();
if (s === 'A' || s.startsWith('A') || s === 'HARD' || s === 'PLOT') return 'A';
if (s === 'B' || s.startsWith('B') || s === 'AUX' || s === 'SOFT') return 'B';
return '';
}

/**
* 硬事件：人物首次出场、换地点、关键道具/能力、信息揭示、冲突与结果、死伤、升级、关键对白。
* 辅助事件：雨水、车流、皱眉、走路、氛围空镜。未知默认 A，避免漏剧情。
*/
export function classifyDramaVisualEventPriority(
event: Pick<DramaVisualEvent, 'kind' | 'see' | 'cut' | 'who' | 'location'>,
ctx?: {
isFirstAtLocation?: boolean;
isFirstWho?: boolean;
llmPriority?: unknown;
},
): DramaVisualEventPriority {
const llm = normalizeDramaVisualEventPriority(ctx?.llmPriority);
const blob = `${event.see || ''} ${event.cut || ''} ${event.who || ''}`;
if (HARD_EVENT_KIND.has(event.kind)) return 'A';
if (event.kind === 'establish' && ctx?.isFirstAtLocation) return 'A';
if (ctx?.isFirstWho && String(event.who || '').trim()) return 'A';
if (HARD_EVENT_TEXT.test(blob)) return 'A';
if (llm === 'A') return 'A';
if (event.kind === 'environment' || event.kind === 'insert') return 'B';
if (AUX_EVENT_TEXT.test(blob) && !HARD_EVENT_TEXT.test(blob)) return 'B';
if (event.kind === 'reaction' && /皱眉|微皱|看了一眼/.test(blob) && !HARD_EVENT_TEXT.test(blob)) {
return 'B';
}
if (llm === 'B') return 'B';
return 'A';
}

export function assignDramaVisualEventPriorities(
events: DramaVisualEvent[],
llmPriorities?: unknown[],
): DramaVisualEvent[] {
const seenLoc = new Set<string>();
const seenWho = new Set<string>();
return (events || []).map((e, i) => {
const loc = String(e.location || '').trim();
const isFirstAtLocation = Boolean(loc && !seenLoc.has(loc));
if (loc) seenLoc.add(loc);
const names = String(e.who || '')
.split(/[、,，/]/)
.map((x) => x.trim())
.filter(Boolean);
let isFirstWho = false;
for (const n of names) {
if (!seenWho.has(n)) {
isFirstWho = true;
seenWho.add(n);
}
}
return {
...e,
priority: classifyDramaVisualEventPriority(e, {
isFirstAtLocation,
isFirstWho,
llmPriority: llmPriorities?.[i] ?? e.priority,
}),
};
});
}

/** 按信息量落到 6 / 10 / 15 / 20：环境/信息闪现 6；赶路/单句 10；对白冲突/复杂动作 15；完整段落 20。
*  对白字数按 4.5 字/秒计算所需时长，确保说话时长足够。
*  paceGear=dense_20s 时，统一返回 20（长视频单段固定时长），节拍级分配使用 recommendDense20sBeatDialoguePlan */
export function recommendDramaShotPlanDurationSec(
shot: {
dramatic_purpose?: string;
purpose?: string;
action?: string;
dialogue?: string;
size?: string;
},
paceGear?: unknown,
): 6 | 10 | 15 | 20 {
const pace = normalizeDramaShotPlanPaceGear(paceGear);
// 长视频高密度模式：单段统一 20s，内部节拍分配由专用函数负责
if (pace === 'dense_20s') return 20;
const purpose = String(shot.dramatic_purpose || '').toLowerCase();
const intent = `${shot.purpose || ''} ${shot.action || ''}`;
const action = String(shot.action || '');
const dlgRaw = String(shot.dialogue || '');
// 去掉角色名（"周一川：" → 去掉"周一川"），只统计纯台词字数
const dlgTextOnly = dlgRaw
.replace(/[A-Za-z\u4e00-\u9fff（()）]+[：:]/g, '') // 去掉说话人名+冒号
.replace(/\s+/g, '');
const dlgTurns = (dlgRaw.match(/[：:]/g) || []).length;
const dlgChars = dlgTextOnly.replace(/[^0-9A-Za-z\u4e00-\u9fff]/g, '').length;
const actionHits = (action.match(/骑|冲|停|砍|刺|跳|握|剑|打|追|摔|升级|击杀|对峙|加速|急停/g) || [])
.length;

// 对白字数 → 所需时长（4.5 字/秒，向上取到档位）
// 6s≤27字 / 10s≤45字 / 15s≤68字 / 20s≤90字
let dlgRec = 0;
if (dlgChars > 0) {
const secondsNeeded = dlgChars / 4.5;
if (secondsNeeded <= 6) dlgRec = 6;
else if (secondsNeeded <= 10) dlgRec = 10;
else if (secondsNeeded <= 15) dlgRec = 15;
else dlgRec = 20; // 超过 15s 容量 → 应拆镜，但单镜推荐封顶 20
}

let rec = Math.max(6, dlgRec);
// 对白细切：1～2 句/短反应保持 6；勿因 dramatic_purpose=dialogue 一律抬到 10/15
if (dlgTurns >= 5 || dlgChars >= 60) rec = Math.max(rec, 15);
else if (dlgTurns >= 3 || dlgChars >= 35) rec = Math.max(rec, 10);
else if (dlgTurns >= 1 || dlgChars >= 12) rec = Math.max(rec, 6);

if (actionHits >= 4 || /第二|第三|连续|升级|击杀/.test(action)) rec = Math.max(rec, 15);
else if (actionHits >= 2 || /骑|赶|冲入|加速/.test(intent)) rec = Math.max(rec, 10);

if (/reveal/.test(purpose) && dlgChars >= 20) rec = Math.max(rec, 10);
if (/reaction/.test(purpose)) rec = 6;
if (action.length > 70) rec = Math.max(rec, 15);
else if (action.length > 42) rec = Math.max(rec, 10);

if (/establish|environment|information|insert|reaction|transition/.test(purpose) && rec <= 6) {
rec = 6;
}
if (/全景|大全景|建立/.test(String(shot.size || '')) && rec <= 6 && dlgChars < 8) rec = 6;
if (rec >= 18) return 20;
if (rec >= 13) return 15;
if (rec >= 8) return 10;
return 6;
}

/** dense_20s 节拍级对白分配：
*  把一段对话按节拍窗口容量（0-4s≤18字/4-9s≤22字/9-13s≤18字/13-17s≤18字/17-20s≤13字）
*  依次填入，超载则把溢出对白挤到相邻节拍；若全段总字数 > 90，返回 overflowNeeded=true 提示需要拆到下一段
*  返回：每节拍计划字数 + 是否超出单段 90 字总容量 + 建议拆段提示
*/
export function planDense20sDialogueBeat(rawDialogueChars: number): {
beatPlans: Array<{ window: string; allocatedChars: number }>;
overflowNeeded: boolean;
overflowChars: number;
recommendedSegments: number;
} {
const chars = Math.max(0, Math.floor(rawDialogueChars || 0));
// 计算按 4.5 字/秒 实际需要多少秒，再算需要几段（每段 20s / 90 字）
const totalSecondsNeeded = chars / 4.5;
const recommendedSegments = Math.max(1, Math.ceil(totalSecondsNeeded / DRAMA_DENSE_20S_SEGMENT_DURATION));
const overflowNeeded = chars > DRAMA_DENSE_20S_MAX_DIALOGUE_CHARS_PER_SEGMENT;
const overflowChars = Math.max(0, chars - DRAMA_DENSE_20S_MAX_DIALOGUE_CHARS_PER_SEGMENT);
let remaining = chars;
const beatPlans = DRAMA_DENSE_20S_BEAT_WINDOWS.map((bw) => {
const alloc = Math.min(remaining, bw.maxDialogueChars);
remaining -= alloc;
return { window: bw.window, allocatedChars: alloc };
});
return { beatPlans, overflowNeeded, overflowChars, recommendedSegments };
}

/** 扫描一段运镜/动作文本，统计命中慢推禁词的次数（dense_20s 要求 = 0） */
export function countSlowMoveHits(text: string): number {
const blob = String(text || '');
let hits = 0;
for (const kw of DRAMA_ANTI_DILUTION_SLOW_MOVE_KEYWORDS) {
if (blob.includes(kw)) hits++;
}
return hits;
}

export function normalizeDramaEmotion(raw: unknown): DramaEmotion {
if (raw == null) return { primary: '', intensity: 0.5 };
if (typeof raw === 'object') {
const obj = raw as Record<string, unknown>;
const primary = String(obj?.primary || '').trim();
const secondary = String(obj?.secondary || '').trim();
let intensity = Number(obj?.intensity);
if (!Number.isFinite(intensity)) intensity = 0.5;
intensity = Math.max(0, Math.min(1, intensity));
const arc = String(obj?.arc || '').trim();
return { primary, secondary: secondary || undefined, intensity, arc: arc || undefined };
}
// 遗留字符串形式：宽松解析 "愤怒(克制) @0.8 #隐忍→爆发" 或 "紧张,心虚"
const text = String(raw).trim();
if (!text) return { primary: '', intensity: 0.5 };
let intensity = 0.5;
let rest = text;
const intMatch = text.match(/@\s*([01](?:\.\d+)?|\d\.\d+)/);
if (intMatch) {
const parsed = Number(intMatch[1]);
if (Number.isFinite(parsed)) intensity = Math.max(0, Math.min(1, parsed));
rest = rest.replace(intMatch[0], '');
}
let arc: string | undefined;
const arcMatch = rest.match(/#([^\s,，()（）]+(?:\s*→\s*[^\s,，()（）]+)?)/);
if (arcMatch) {
arc = arcMatch[1].replace(/\s*→\s*/g, '→').trim() || undefined;
rest = rest.replace(arcMatch[0], '');
}
const tokens = rest
.replace(/[()（）]/g, ',')
.split(/[,，、\s]+/)
.map((s) => s.trim())
.filter(Boolean);
const primary = tokens[0] || '';
const secondary = tokens.slice(1).join('、') || undefined;
return { primary, secondary, intensity, arc };
}

export function createEmptyDramaVisualEvent(
partial?: Partial<DramaVisualEvent>,
): DramaVisualEvent {
const base = {
event_id: String(partial?.event_id || '').trim(),
index: Number.isFinite(Number(partial?.index)) ? Number(partial?.index) : 0,
location: String(partial?.location || '').trim(),
kind: normalizeDramaVisualEventKind(partial?.kind),
who: String(partial?.who || '').trim(),
action: String(partial?.action || '').trim(),
expression: String(partial?.expression || '').trim(),
emotion: normalizeDramaEmotion(partial?.emotion),
see: String(partial?.see || '').trim(),
cut: String(partial?.cut || '').trim(),
priority: (normalizeDramaVisualEventPriority(partial?.priority) || 'A') as DramaVisualEventPriority,
};
return {
...base,
...(Array.isArray(partial?.source_segment_ids)
  ? { source_segment_ids: partial!.source_segment_ids.map(String).filter(Boolean) }
  : {}),
...(partial?.original_text !== undefined ? { original_text: String(partial.original_text || '') } : {}),
...(partial?.position !== undefined ? { position: String(partial.position || '').trim() } : {}),
priority: classifyDramaVisualEventPriority(
{
kind: base.kind,
see: base.see,
cut: base.cut,
who: base.who,
location: base.location,
},
{ llmPriority: partial?.priority },
),
};
}

// ================= v3：Narrative / Director / Shot Intent 规划层 =================

/** v3 Prompt 硬约束（数组形式，禁止大段模板字符串拼接） */
export const DRAMA_NARRATIVE_PLANNING_RULES: readonly string[] = [
'【角色设定：Narrative Beat × Director Beat × Shot Intent 三层规划 · 覆盖上文一切冲突规则】',
'你是电影级叙事节奏导演。任务：把 Visual Events 和 Scene Beats 组合为三层结构——Narrative Beat（剧情变化）→ Director Beat（导演呈现）→ Shot Intent（镜头意图）。',
'主线原则（不可动摇）：1. 事件不是镜头。事件先形成叙事变化（audience_change），叙事变化再形成导演意图（Shot Intent），导演意图最后才变成镜头。2. 快节奏 ≠ 碎切。节奏来自"观众持续获得新信息/情绪变化"，不来自"每段时间切几镜"。3. 导演不是算法。不写死"高潮=特写""每15s=6镜"，只约束"信息停滞"和"视觉重复"。',
'',
'【输出契约 · 一次 JSON 输出三层 · schema 固定】',
'只输出合法 JSON，不要 Markdown，不要代码块。顶层结构：',
'{"narrative_beats":[...],"director_beats":[...],"shot_intents":[...]}',
'',
'【Narrative Beat 字段（3-6 个）】',
'- beat_id: "NB01" 递增',
'- dramatic_function: setup|conflict|reveal|climax|turn|suspense',
'- audience_change: ⭐ 核心——观众这一拍结束后新知道了什么。必须可从原文/see/dialogue 推导，写"观众知道了 X"。禁止"悲伤/紧张"等无客观指涉的情绪形容词。',
'- emotion_arc: 情绪走向，如 "慌张 → 绝望"',
'- scene: 场景名',
'- event_ids: 关联 visual_events 的 event_id（pri=A 事件必须全覆盖）',
'',
'【Director Beat 字段（每 beat 一个）】',
'- director_beat_id: "DB01" 递增',
'- narrative_beat_id: 关联 NB',
'- director_function: establish|reveal|reaction|confrontation|action|impact',
'- visual_emphasis: 峰值节拍（climax/reveal）必须声明一种：close_up|push_in|isolation|composition_shift|silence_hold|reaction|reveal_object。普通节拍可省。',
'- target_seconds: [min, max] 推荐时长范围',
'',
'【Shot Intent 字段（一个 beat 可多个 intent）】',
'- intent_id: "SI01" 递增',
'- director_beat_id: 关联 DB',
'- purpose: establish|reveal|action|reaction|relationship|impact|transition',
'- visual_information: 给观众看什么（画面内容一句话）',
'- audience_change: 本镜结束观众知道了什么新东西（必须可从原文推导，禁止情绪形容词）',
'- subject: 主体（角色名/物体名）',
'- visual_change_count: ⭐ 本 intent 内可视化变化次数（动作变化/信息揭示/关系变化）。shotPlan 据此定镜数——通常 1-2 镜。',
'- visual_emphasis: 可选，峰值声明',
'- transition_from_previous: 承接上一镜（防穿帮）',
'',
'【Prompt 硬约束（防核心字段漂移）】',
'1. audience_change 必须从原文/see/dialogue 推导，写"观众知道了 X"；禁止"悲伤/紧张"等无客观指涉的词。',
'2. 对白本身就是 audience_change 来源（一句"客户已差评"= 一个变化），提炼时纳入。',
'3. visual_change_count = 本 intent 内发生了几次"可视化变化"（动作变化/信息揭示/关系变化），shotPlan 据此定镜数——这是"通常 1-2 镜"的可执行化。',
'4. 峰值节拍（climax/reveal）必须声明 visual_emphasis（任选一种），普通节拍可省。',
'5. 不碰对白逐字（对白完整性仍由 ShotPlan 的 dialogue[] 铁律承担）。',
] as const;

/** VisualEmphasis → 可执行写法映射表（进 Enrich prompt） */
export const DRAMA_VISUAL_EMPHASIS_MAPPING: Record<VisualEmphasis, string> = {
close_up: 'CU/ECU + 固定/急推，聚焦面部/局部',
push_in: '急推（限 1 处）',
isolation: '广角孤立构图 + 大面积留白 + 环境音',
composition_shift: '构图重心变化（角色从画面边缘移至中心）',
silence_hold: '静音停顿 + 固定机位 + 呼吸',
reaction: '反应镜，写清物理微相',
reveal_object: '道具特写',
};

/**
* 组装 v3 Narrative/Director Planning LLM 消息。
* 输入：sourceText + visual_events + scene_beats（不含 characters 全量，控制成本）
*/
export function buildDramaNarrativePlanning(opts: {
sourceText: string;
visualEvents: DramaVisualEvent[];
sceneBeats: Array<{ scene_no?: string; location_name?: string; int_ext?: string; day_night?: string; weather?: string; dramatic_goal?: string; emotion?: string }>;
}): { systemPrompt: string; userPrompt: string } {
const eventsJson = JSON.stringify(
(opts.visualEvents || []).map((e) => ({
id: e.event_id,
i: e.index,
loc: e.location,
kind: e.kind,
pri: e.priority || 'A',
who: e.who,
see: e.see,
cut: e.cut,
})),
);
const beatsJson = JSON.stringify(
(opts.sceneBeats || []).map((b) => ({
scene_no: b.scene_no,
location_name: b.location_name,
int_ext: b.int_ext,
day_night: b.day_night,
weather: b.weather,
dramatic_goal: b.dramatic_goal,
emotion: b.emotion,
})),
);
const systemPrompt = `${DRAMA_NARRATIVE_PLANNING_RULES.join('\n')}`;
const userPrompt = `【原文】\n${opts.sourceText}\n\n【Visual Events】\n${eventsJson}\n\n【Scene Beats】\n${beatsJson}\n\n请输出三层 JSON（narrative_beats + director_beats + shot_intents）。`;
return { systemPrompt, userPrompt };
}

/**
* 估算 Narrative Beat 的推荐时长范围（秒）。
* 简单启发式：每 beat 6-10s，总长 = beats * 6-10，clamp 到 [12, 120]。
*/
export function estimateNarrativeTargetSeconds(beatCount: number): [number, number] {
const n = Math.max(1, Math.min(beatCount, 10));
return [Math.max(12, n * 6), Math.min(120, n * 10)];
}

// ---- 归一化：解析 LLM JSON → DramaNarrativePlanningResult ----

const VALID_EMPHASIS: VisualEmphasis[] = [
'close_up', 'push_in', 'isolation', 'composition_shift', 'silence_hold', 'reaction', 'reveal_object',
];
const VALID_DRAMATIC_FUNCTIONS = ['setup', 'conflict', 'reveal', 'climax', 'turn', 'suspense'] as const;
const VALID_DIRECTOR_FUNCTIONS = ['establish', 'reveal', 'reaction', 'confrontation', 'action', 'impact'] as const;
const VALID_INTENT_PURPOSES = ['establish', 'reveal', 'action', 'reaction', 'relationship', 'impact', 'transition'] as const;

function normalizeVisualEmphasis(raw: unknown): VisualEmphasis | undefined {
const s = String(raw || '').trim().toLowerCase();
return (VALID_EMPHASIS as readonly string[]).includes(s) ? (s as VisualEmphasis) : undefined;
}

/** 轻量 JSON 抽取：去 Markdown fences + 找首末大括号（叙事规划专用，避免循环依赖 normalizeAnalyze） */
function extractJsonObjectForPlanning(raw: unknown): Record<string, unknown> {
  const text = String(raw || '').trim();
  if (!text) return {};
  let candidate = text
    .replace(/^```(?:json|JSON)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
  if (!candidate) return {};
  try {
    const p = JSON.parse(candidate);
    if (p && typeof p === 'object') return p as Record<string, unknown>;
  } catch {
    /* continue */
  }
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start >= 0 && end > start) {
    try {
      const p = JSON.parse(candidate.slice(start, end + 1));
      if (p && typeof p === 'object') return p as Record<string, unknown>;
    } catch {
      /* continue */
    }
  }
  return {};
}

/**
 * 解析 LLM 输出的三层 JSON，校验并归一化。
 * 入参支持已解析对象（Record）或原始字符串（含 markdown fences 也可）。
 * 不做 audience_change 可溯源校验（那需要 sourceText，留给 validateDramaShotPlan）。
 */
export function normalizeDramaNarrativePlanningResult(raw: unknown): DramaNarrativePlanningResult {
  const obj = typeof raw === 'string' || raw == null ? extractJsonObjectForPlanning(raw) : (raw as Record<string, unknown>);
const narrative_beats: DramaNarrativeBeat[] = [];
const director_beats: DramaDirectorBeat[] = [];
const shot_intents: DramaShotIntent[] = [];

const nbList = Array.isArray(obj.narrative_beats) ? obj.narrative_beats : [];
nbList.forEach((item: unknown, idx: number) => {
const nb = (item || {}) as Record<string, unknown>;
const fn = String(nb.dramatic_function || '').trim().toLowerCase();
narrative_beats.push({
beat_id: String(nb.beat_id || `NB${String(idx + 1).padStart(2, '0')}`).trim(),
dramatic_function: (VALID_DRAMATIC_FUNCTIONS as readonly string[]).includes(fn)
? (fn as DramaNarrativeBeat['dramatic_function'])
: 'setup',
audience_change: String(nb.audience_change || '').trim(),
emotion_arc: String(nb.emotion_arc || '').trim(),
scene: String(nb.scene || '').trim(),
event_ids: Array.isArray(nb.event_ids) ? nb.event_ids.map((x) => String(x || '').trim()).filter(Boolean) : [],
});
});

const dbList = Array.isArray(obj.director_beats) ? obj.director_beats : [];
dbList.forEach((item: unknown, idx: number) => {
const db = (item || {}) as Record<string, unknown>;
const fn = String(db.director_function || '').trim().toLowerCase();
const ts = Array.isArray(db.target_seconds) ? db.target_seconds : [6, 10];
director_beats.push({
director_beat_id: String(db.director_beat_id || `DB${String(idx + 1).padStart(2, '0')}`).trim(),
narrative_beat_id: String(db.narrative_beat_id || '').trim(),
director_function: (VALID_DIRECTOR_FUNCTIONS as readonly string[]).includes(fn)
? (fn as DramaDirectorBeat['director_function'])
: 'establish',
visual_emphasis: normalizeVisualEmphasis(db.visual_emphasis),
target_seconds: [Number(ts[0]) || 6, Number(ts[1]) || 10],
});
});

const siList = Array.isArray(obj.shot_intents) ? obj.shot_intents : [];
siList.forEach((item: unknown, idx: number) => {
const si = (item || {}) as Record<string, unknown>;
const purpose = String(si.purpose || '').trim().toLowerCase();
shot_intents.push({
intent_id: String(si.intent_id || `SI${String(idx + 1).padStart(2, '0')}`).trim(),
director_beat_id: String(si.director_beat_id || '').trim(),
purpose: (VALID_INTENT_PURPOSES as readonly string[]).includes(purpose)
? (purpose as DramaShotIntent['purpose'])
: 'action',
visual_information: String(si.visual_information || '').trim(),
audience_change: String(si.audience_change || '').trim(),
subject: Array.isArray(si.subject) ? si.subject.map((x) => String(x || '').trim()).filter(Boolean) : [],
visual_change_count: Math.max(1, Math.min(5, Number(si.visual_change_count) || 1)),
visual_emphasis: normalizeVisualEmphasis(si.visual_emphasis),
transition_from_previous: si.transition_from_previous ? String(si.transition_from_previous).trim() : undefined,
});
});

return { narrative_beats, director_beats, shot_intents };
}