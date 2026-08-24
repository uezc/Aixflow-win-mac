/**
 * AI导演执行表 · 时间轴事件（TimelineEvent）
 *
 * 真相源：timeline_events[]（每段视听事件）。
 * timeline_beats 仅为遗留展示/迁移输入，不得作为 Adapter 执行核心。
 */

import { dramaNewId } from './ids.js';
import type { DramaShot, DramaShotTimelineBeat, DramaTimelineEvent } from './types.js';

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

export function createEmptyDramaTimelineEvent(
  partial?: Partial<DramaTimelineEvent>,
): DramaTimelineEvent {
  const start = Math.max(0, Number(partial?.start_sec) || 0);
  let end = Math.max(0, Number(partial?.end_sec) || 0);
  if (end <= start) end = round1(start + 0.1);
  const dialogue = String(partial?.dialogue || '').trim();
  const dialogue_character_id = String(partial?.dialogue_character_id || '').trim();
  const lip_sync =
    typeof partial?.lip_sync === 'boolean'
      ? partial.lip_sync
      : !!(dialogue && dialogue_character_id);
  return {
    event_id: String(partial?.event_id || '').trim() || dramaNewId('tev'),
    start_sec: round1(start),
    end_sec: round1(end),
    character_ids: Array.isArray(partial?.character_ids)
      ? [...new Set(partial!.character_ids.map(String).filter(Boolean))]
      : [],
    visual_action: String(partial?.visual_action || '').trim(),
    character_state: String(partial?.character_state || '').trim(),
    position: String(partial?.position || '').trim(),
    expression: String(partial?.expression || '').trim(),
    eyeline: String(partial?.eyeline || '').trim(),
    dialogue,
    dialogue_character_id,
    environment_audio: Array.isArray(partial?.environment_audio)
      ? partial!.environment_audio.map((x) => String(x || '').trim()).filter(Boolean)
      : [],
    lip_sync,
    camera_action: String(partial?.camera_action || '').trim(),
  };
}

/** 过薄：空、或仍是整段散文、或对白未绑角色 */
export function isDramaTimelineEventsThin(
  events: DramaTimelineEvent[] | undefined | null,
): boolean {
  const list = Array.isArray(events) ? events : [];
  if (!list.length) return true;
  if (list.length === 1 && String(list[0].visual_action || '').length > 220) return true;
  return list.some((e) => {
    if (!String(e.visual_action || '').trim()) return true;
    if (e.dialogue && !e.dialogue_character_id) return true;
    if (e.lip_sync && (!e.dialogue || !e.dialogue_character_id)) return true;
    return false;
  });
}

/** 归一化：排序、去空、铺满 0→duration（仅校正缝隙，不猜测内容） */
export function normalizeDramaTimelineEvents(
  events: DramaTimelineEvent[] | undefined | null,
  durationSec: number,
): DramaTimelineEvent[] {
  const dur = Math.max(0.1, Number(durationSec) || 0.1);
  const list = (Array.isArray(events) ? events : [])
    .map((e) => createEmptyDramaTimelineEvent(e))
    .filter((e) => e.end_sec > e.start_sec)
    .sort((a, b) => a.start_sec - b.start_sec || a.end_sec - b.end_sec);

  if (!list.length) return [];

  list[0].start_sec = 0;
  for (let i = 1; i < list.length; i += 1) {
    if (list[i].start_sec < list[i - 1].end_sec) {
      list[i].start_sec = list[i - 1].end_sec;
    } else if (list[i].start_sec > list[i - 1].end_sec) {
      list[i - 1].end_sec = list[i].start_sec;
    }
    if (list[i].end_sec <= list[i].start_sec) {
      list[i].end_sec = round1(list[i].start_sec + 0.1);
    }
  }
  list[list.length - 1].end_sec = round1(Math.max(list[list.length - 1].end_sec, dur));
  if (list[list.length - 1].end_sec > dur) {
    list[list.length - 1].end_sec = round1(dur);
  }
  return list.map((e) => createEmptyDramaTimelineEvent(e));
}

/** 用户改本镜时长：按比例拉伸/压缩各段，再归一化铺满新时长。 */
export function rescaleDramaTimelineEventsToDuration(
  events: DramaTimelineEvent[] | undefined | null,
  fromSec: number,
  toSec: number,
): DramaTimelineEvent[] {
  const next = Math.max(0.1, Number(toSec) || 0.1);
  const prev = Math.max(0.1, Number(fromSec) || next);
  const list = Array.isArray(events) ? events : [];
  if (!list.length || Math.abs(prev - next) < 1e-6) {
    return normalizeDramaTimelineEvents(list, next);
  }
  const scale = next / prev;
  const scaled = list.map((e) =>
    createEmptyDramaTimelineEvent({
      ...e,
      start_sec: round1((Number(e.start_sec) || 0) * scale),
      end_sec: round1((Number(e.end_sec) || 0) * scale),
    }),
  );
  return normalizeDramaTimelineEvents(scaled, next);
}

const MIN_EVENT_SEC = 0.2;

function joinPromptText(a: string, b: string): string {
  const x = String(a || '').trim();
  const y = String(b || '').trim();
  if (!x) return y;
  if (!y) return x;
  if (x === y || x.includes(y)) return x;
  if (y.includes(x)) return y;
  return `${x.replace(/[。；;，,\s]+$/g, '')}。${y}`;
}

function mergeEventContent(
  a: DramaTimelineEvent,
  b: DramaTimelineEvent,
): Partial<DramaTimelineEvent> {
  const uniq = (xs: string[]) => [...new Set(xs.map((x) => String(x || '').trim()).filter(Boolean))];
  const da = String(a.dialogue || '').trim();
  const db = String(b.dialogue || '').trim();
  const dialogue = joinPromptText(da, db);
  const dialogue_character_id = da
    ? a.dialogue_character_id
    : db
      ? b.dialogue_character_id
      : '';
  return {
    character_ids: uniq([...(a.character_ids || []), ...(b.character_ids || [])]),
    visual_action: joinPromptText(a.visual_action, b.visual_action),
    character_state: joinPromptText(a.character_state, b.character_state),
    position: joinPromptText(a.position, b.position),
    expression: joinPromptText(a.expression, b.expression),
    eyeline: joinPromptText(a.eyeline, b.eyeline),
    dialogue,
    dialogue_character_id,
    environment_audio: uniq([...(a.environment_audio || []), ...(b.environment_audio || [])]),
    lip_sync: !!(dialogue && dialogue_character_id && (a.lip_sync || b.lip_sync)),
    camera_action: joinPromptText(a.camera_action, b.camera_action),
  };
}

function splitPromptText(text: string): [string, string] {
  const raw = String(text || '').trim();
  if (!raw) return ['', ''];
  const sentences = raw
    .split(/(?<=[。！？；;])\s*/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (sentences.length >= 2) {
    const mid = Math.ceil(sentences.length / 2);
    return [sentences.slice(0, mid).join(''), sentences.slice(mid).join('')];
  }
  const one = sentences[0] || raw;
  const parts = one
    .replace(/[。！？；;]+$/g, '')
    .split(/[，,、]/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (parts.length >= 2) {
    const mid = Math.ceil(parts.length / 2);
    return [parts.slice(0, mid).join('，'), parts.slice(mid).join('，')];
  }
  return [one, ''];
}

function splitStringList(items: string[]): [string[], string[]] {
  const list = items.map((x) => String(x || '').trim()).filter(Boolean);
  if (list.length <= 1) return [list, list];
  const mid = Math.ceil(list.length / 2);
  return [list.slice(0, mid), list.slice(mid)];
}

function splitEventContent(ev: DramaTimelineEvent): {
  left: Partial<DramaTimelineEvent>;
  right: Partial<DramaTimelineEvent>;
} {
  const [vaL, vaR] = splitPromptText(ev.visual_action);
  const [camL, camR] = splitPromptText(ev.camera_action);
  const [stL, stR] = splitPromptText(ev.character_state);
  const [dlgL, dlgR] = splitPromptText(ev.dialogue);
  const [envL, envR] = splitStringList(ev.environment_audio || []);
  return {
    left: {
      visual_action: vaL,
      camera_action: camL || ev.camera_action,
      character_state: stL || ev.character_state,
      dialogue: dlgL,
      dialogue_character_id: dlgL ? ev.dialogue_character_id : '',
      lip_sync: !!(dlgL && ev.lip_sync),
      environment_audio: envL,
    },
    right: {
      visual_action: vaR,
      camera_action: camR || ev.camera_action,
      character_state: stR || ev.character_state,
      dialogue: dlgR,
      dialogue_character_id: dlgR ? ev.dialogue_character_id : '',
      lip_sync: !!(dlgR && ev.lip_sync),
      environment_audio: envR,
    },
  };
}

/** 切段后若表演句拆不开：用不同景别/角度，避免三段同一句。 */
const TIMELINE_CUT_CYCLE: Array<{ cam: string; prefix: string; focus: string }> = [
  { cam: '全景｜平视｜固定｜35mm｜三分法', prefix: '全景交代人物与环境位置', focus: '空间与站位' },
  { cam: '中景｜平视｜缓慢推入｜35mm｜三分法', prefix: '中景看肢体与站位', focus: '上半身与手部' },
  { cam: '近景｜平视｜固定｜50mm｜居中', prefix: '近景看面部与眼神', focus: '面部与眼神' },
];

function stripCutPrefix(text: string): string {
  return String(text || '')
    .replace(/^【[^】]{1,24}】\s*/, '')
    .trim();
}

function withCutPrefix(text: string, prefix: string): string {
  const body = stripCutPrefix(text);
  return body ? `【${prefix}】${body}` : `【${prefix}】`;
}

function normVisualAction(text: string): string {
  return stripCutPrefix(text)
    .replace(/^(?:空间与站位|上半身与手部|面部与眼神)[：:]\s*/g, '')
    .replace(/\s+/g, '');
}

/** 把一句表演拆成短语，供连续切段各取一段，避免整句复制。 */
function splitVisualActionPhrases(text: string): string[] {
  const raw = stripCutPrefix(text)
    .replace(/^(?:空间与站位|上半身与手部|面部与眼神)[：:]\s*/g, '')
    .trim();
  if (!raw) return [];
  const byStop = raw
    .split(/[。；;]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  const out: string[] = [];
  for (const p of byStop) {
    const bits = p
      .split(/[，,、→]/)
      .map((s) => s.trim())
      .filter((s) => s.length >= 2);
    if (bits.length > 1 && p.length > 12) out.push(...bits);
    else out.push(p);
  }
  return out.length ? out : [raw];
}

function bodyForCutPhase(
  body: string,
  phaseIndex: number,
  phaseCount: number,
  focus: string,
): string {
  const parts = splitVisualActionPhrases(body);
  if (parts.length >= phaseCount) {
    if (phaseIndex < phaseCount - 1) return parts[phaseIndex] || body;
    return parts.slice(phaseIndex).join('，') || body;
  }
  if (parts.length > 1) {
    const idx = Math.min(phaseIndex, parts.length - 1);
    if (phaseIndex === phaseCount - 1) return parts.slice(idx).join('，');
    return parts[idx] || body;
  }
  // 拆不开时：同一表演按景别焦点重写可见信息，禁止整句原样粘贴
  const core = parts[0] || body;
  return `${focus}：${core}`;
}

/**
 * 连续多段 visual_action 相同（或几乎相同）时：
 * 1) 换景别/机位前缀；2) 把表演正文按阶段拆开（或按景别焦点改写）。
 * 禁止只改【】前缀而正文整句重复。
 */
export function differentiateDuplicateTimelineCuts(
  events: DramaTimelineEvent[] | undefined | null,
): DramaTimelineEvent[] {
  const list = Array.isArray(events) ? events.map((e) => ({ ...e })) : [];
  if (list.length < 2) return list;
  let i = 0;
  while (i < list.length) {
    const key = normVisualAction(list[i].visual_action);
    let j = i + 1;
    while (j < list.length && normVisualAction(list[j].visual_action) === key) j += 1;
    const run = j - i;
    if (run >= 2 && key) {
      const bodies = list.slice(i, j).map((e) => stripCutPrefix(e.visual_action));
      const sameBody = bodies.every((b) => normVisualAction(b) === key);
      const alreadyPhased = list
        .slice(i, j)
        .every((e) =>
          /^【(全景交代|中景看|近景看)/.test(String(e.visual_action || '')) &&
          /^(?:空间与站位|上半身与手部|面部与眼神)[：:]/.test(stripCutPrefix(e.visual_action)),
        );
      if (sameBody && !alreadyPhased) {
        const cams = list.slice(i, j).map((e) => String(e.camera_action || '').trim());
        const allCamSame = cams.every((c) => c === cams[0]);
        const sharedBody = bodies[0] || stripCutPrefix(list[i].visual_action);
        for (let k = 0; k < run; k += 1) {
          const cut = TIMELINE_CUT_CYCLE[k % TIMELINE_CUT_CYCLE.length];
          const ev = list[i + k];
          const phased = bodyForCutPhase(sharedBody, k, run, cut.focus);
          ev.visual_action = withCutPrefix(phased, cut.prefix);
          if (allCamSame) ev.camera_action = cut.cam;
        }
      }
    }
    i = j;
  }
  return list;
}

function splitCoveragePair(cameraAction: string): {
  leftCam: string;
  rightCam: string;
  leftPrefix: string;
  rightPrefix: string;
} {
  const cam = String(cameraAction || '');
  if (/近景|特写/.test(cam)) {
    return {
      leftCam: TIMELINE_CUT_CYCLE[1].cam,
      rightCam: TIMELINE_CUT_CYCLE[2].cam,
      leftPrefix: TIMELINE_CUT_CYCLE[1].prefix,
      rightPrefix: TIMELINE_CUT_CYCLE[2].prefix,
    };
  }
  if (/中景/.test(cam)) {
    return {
      leftCam: TIMELINE_CUT_CYCLE[1].cam,
      rightCam: TIMELINE_CUT_CYCLE[2].cam,
      leftPrefix: TIMELINE_CUT_CYCLE[1].prefix,
      rightPrefix: TIMELINE_CUT_CYCLE[2].prefix,
    };
  }
  return {
    leftCam: TIMELINE_CUT_CYCLE[0].cam,
    rightCam: TIMELINE_CUT_CYCLE[1].cam,
    leftPrefix: TIMELINE_CUT_CYCLE[0].prefix,
    rightPrefix: TIMELINE_CUT_CYCLE[1].prefix,
  };
}

/** 在 atSec 切开所在段，切段数 +1；提示词按句号/逗号拆到左右，不整段复制。 */
export function splitDramaTimelineEventAt(
  events: DramaTimelineEvent[] | undefined | null,
  atSec: number,
  durationSec: number,
): DramaTimelineEvent[] {
  const dur = Math.max(0.1, Number(durationSec) || 0.1);
  const list = normalizeDramaTimelineEvents(events, dur);
  const t = round1(Math.min(Math.max(Number(atSec) || 0, MIN_EVENT_SEC), dur - MIN_EVENT_SEC));
  const idx = list.findIndex((e) => t >= e.start_sec + MIN_EVENT_SEC && t <= e.end_sec - MIN_EVENT_SEC);
  if (idx < 0) return list;
  const ev = list[idx];
  const { left: leftBody, right: rightBody } = splitEventContent(ev);
  const left = createEmptyDramaTimelineEvent({
    ...ev,
    ...leftBody,
    end_sec: t,
  });
  const right = createEmptyDramaTimelineEvent({
    ...ev,
    ...rightBody,
    event_id: '',
    start_sec: t,
  });
  const sameVisual =
    !String(right.visual_action || '').trim() ||
    normVisualAction(left.visual_action) === normVisualAction(right.visual_action || ev.visual_action);
  if (sameVisual) {
    const pair = splitCoveragePair(ev.camera_action);
    const bodyL = stripCutPrefix(left.visual_action || ev.visual_action);
    const bodyR = stripCutPrefix(right.visual_action || ev.visual_action);
    left.camera_action = pair.leftCam;
    right.camera_action = pair.rightCam;
    left.visual_action = withCutPrefix(bodyL, pair.leftPrefix);
    right.visual_action = withCutPrefix(bodyR, pair.rightPrefix);
  }
  return normalizeDramaTimelineEvents(
    differentiateDuplicateTimelineCuts([...list.slice(0, idx), left, right, ...list.slice(idx + 1)]),
    dur,
  );
}

/**
 * 拖动第 afterIndex 段右边界（与下一段共享）。
 * 首尾锁在 0 与 duration，不能改本镜总时长。
 */
export function setDramaTimelineBoundarySec(
  events: DramaTimelineEvent[] | undefined | null,
  afterIndex: number,
  nextEndSec: number,
  durationSec: number,
): DramaTimelineEvent[] {
  const dur = Math.max(0.1, Number(durationSec) || 0.1);
  const list = normalizeDramaTimelineEvents(events, dur);
  if (afterIndex < 0 || afterIndex >= list.length - 1) return list;
  const left = list[afterIndex];
  const right = list[afterIndex + 1];
  const minT = round1(left.start_sec + MIN_EVENT_SEC);
  const maxT = round1(right.end_sec - MIN_EVENT_SEC);
  if (maxT <= minT) return list;
  const t = round1(Math.min(Math.max(Number(nextEndSec) || 0, minT), maxT));
  return normalizeDramaTimelineEvents(
    list.map((e, i) => {
      if (i === afterIndex) return { ...e, end_sec: t };
      if (i === afterIndex + 1) return { ...e, start_sec: t };
      return e;
    }),
    dur,
  );
}

/** 合并 index 与 index+1，切段数 -1。 */
export function mergeDramaTimelineEventsAt(
  events: DramaTimelineEvent[] | undefined | null,
  index: number,
  durationSec: number,
): DramaTimelineEvent[] {
  const dur = Math.max(0.1, Number(durationSec) || 0.1);
  const list = normalizeDramaTimelineEvents(events, dur);
  if (index < 0 || index >= list.length - 1) return list;
  const a = list[index];
  const b = list[index + 1];
  const merged = createEmptyDramaTimelineEvent({
    ...a,
    ...mergeEventContent(a, b),
    event_id: a.event_id,
    start_sec: a.start_sec,
    end_sec: b.end_sec,
  });
  return normalizeDramaTimelineEvents(
    [...list.slice(0, index), merged, ...list.slice(index + 2)],
    dur,
  );
}

/**
 * 弱迁移：旧 timeline_beats（自然语言）→ TimelineEvent 骨架。
 * 只保留时间与 visual_action=原文；不猜测谁说话/台词/口型。
 */
export function migrateBeatsToTimelineEvents(
  beats: DramaShotTimelineBeat[] | undefined | null,
  durationSec: number,
): DramaTimelineEvent[] {
  const raw = Array.isArray(beats) ? beats : [];
  const mapped = raw
    .map((b) =>
      createEmptyDramaTimelineEvent({
        start_sec: Number(b.start_sec) || 0,
        end_sec: Number(b.end_sec) || 0,
        visual_action: String(b.text || '').trim(),
        lip_sync: false,
        environment_audio: [],
        character_ids: [],
        dialogue: '',
        dialogue_character_id: '',
      }),
    )
    .filter((e) => e.visual_action);
  return normalizeDramaTimelineEvents(mapped, durationSec);
}

/**
 * 无 LLM：直接产出多段结构化视听事件（非一整段自由 Prompt）。
 */
export function buildHeuristicTimelineEvents(
  shot: Partial<DramaShot>,
  durationSec: number,
  ctx?: {
    characterNames?: string[];
    characterIds?: string[];
    sceneName?: string;
    sceneLocation?: string;
    sceneAnchors?: string;
  },
): DramaTimelineEvent[] {
  const dur =
    Number(durationSec) > 0
      ? Number(durationSec)
      : Number(shot.duration_sec) > 0
        ? Number(shot.duration_sec)
        : 10;

  const idList = (ctx?.characterIds || shot.character_ids || []).map(String).filter(Boolean);
  const nameList =
    (ctx?.characterNames || []).filter(Boolean).length > 0
      ? (ctx?.characterNames || []).filter(Boolean)
      : (shot.dialogue || [])
          .map((d) => String(d.character_name || '').trim())
          .filter(Boolean);
  const leadId = idList[0] || '';
  const leadName = nameList[0] || '';
  const sceneTitle = String(ctx?.sceneName || '').trim();
  const loc = String(ctx?.sceneLocation || shot.environment || '').trim();
  const anchors = String(ctx?.sceneAnchors || '').trim();
  const where =
    [sceneTitle, loc, anchors].filter(Boolean).join(' · ') ||
    sceneTitle ||
    loc ||
    '室内';
  const cam = [
    String(shot.size || shot.framing || '中景').trim(),
    String(shot.angle || shot.camera || '正面').trim(),
    String(shot.move || '固定镜头').trim(),
  ]
    .filter(Boolean)
    .join(' · ');
  const expression = String(shot.expression || '').trim() || '神情克制';
  const eyeline = String(shot.eyeline || '').trim() || '目光朝向对方或画面纵深';
  const blocking = String(shot.blocking || '').trim();
  const action = String(shot.action || '').trim();
  const sfxParts = String(shot.sfx || '')
    .split(/[，,、／/|]/)
    .map((x) => x.trim())
    .filter(Boolean);

  const dlgLines = (shot.dialogue || []).filter((d) => String(d.text || '').trim());
  const hasAnyDlg = dlgLines.length > 0;

  const events: DramaTimelineEvent[] = [];
  let t = 0;
  const push = (len: number, partial: Partial<DramaTimelineEvent>) => {
    const span = Math.max(0.5, len);
    const end = Math.min(dur, round1(t + span));
    if (end <= t) return;
    events.push(
      createEmptyDramaTimelineEvent({
        ...partial,
        start_sec: t,
        end_sec: end,
        camera_action: partial.camera_action || cam,
      }),
    );
    t = end;
  };

  const establish = Math.max(2, dur * 0.18);
  // 建立镜只写站位/环境，禁止把整镜 action 原文再贴一遍（后面动作段才写）
  push(establish, {
    character_ids: idList.length ? idList.slice(0, 2) : [],
    visual_action: leadName
      ? `${leadName}进入${where}画面，站位落定，双手自然下垂`
      : `交代${where}环境与站位，画面内无匿名路人占位`,
    character_state: leadName ? `${leadName}${expression}` : expression,
    position: blocking || where,
    expression,
    eyeline,
    dialogue: '',
    dialogue_character_id: '',
    environment_audio: sfxParts.length ? [sfxParts[0]] : ['场景底噪'],
    lip_sync: false,
  });

  if (action) {
    const actionSpan = Math.max(2.5, (dur - t) * (hasAnyDlg ? 0.32 : 0.55));
    const phrases = splitVisualActionPhrases(action);
    if (phrases.length >= 2 && actionSpan >= 4 && !hasAnyDlg) {
      const mid = Math.ceil(phrases.length / 2);
      const firstSpan = Math.max(2, actionSpan * 0.48);
      push(firstSpan, {
        character_ids: idList.length ? idList : [],
        visual_action: phrases.slice(0, mid).join('，'),
        character_state: leadName ? `${leadName}${expression}` : expression,
        position: blocking || where,
        expression,
        eyeline,
        dialogue: '',
        dialogue_character_id: '',
        environment_audio: sfxParts.slice(0, 2).length
          ? sfxParts.slice(0, 2)
          : ['动作带起细碎声响'],
        lip_sync: false,
      });
      push(Math.max(2, actionSpan - firstSpan), {
        character_ids: idList.length ? idList : [],
        visual_action: phrases.slice(mid).join('，'),
        character_state: leadName ? `${leadName}${expression}` : expression,
        position: blocking || where,
        expression,
        eyeline,
        dialogue: '',
        dialogue_character_id: '',
        environment_audio: sfxParts.slice(0, 2).length
          ? sfxParts.slice(0, 2)
          : ['动作带起细碎声响'],
        lip_sync: false,
      });
    } else {
      push(actionSpan, {
        character_ids: idList.length ? idList : [],
        visual_action: action,
        character_state: leadName ? `${leadName}${expression}` : expression,
        position: blocking || where,
        expression,
        eyeline,
        dialogue: '',
        dialogue_character_id: '',
        environment_audio: sfxParts.slice(0, 2).length
          ? sfxParts.slice(0, 2)
          : ['动作带起细碎声响'],
        lip_sync: false,
      });
    }
  }

  const remainForDlg = Math.max(0, dur - t - 1.5);
  const perDlgBudget =
    dlgLines.length > 0 ? remainForDlg / dlgLines.length : 0;
  for (const line of dlgLines) {
    const dlgText = String(line.text || '').trim();
    if (!dlgText) continue;
    const dlgId = String(line.character_id || leadId || '').trim();
    const speakerName =
      nameList.find((_, i) => idList[i] === dlgId) ||
      String(line.character_name || '').trim() ||
      leadName;
    const dlgSec = Math.max(
      2,
      Math.min(
        perDlgBudget || dur * 0.28,
        dlgText.replace(/\s+/g, '').length / 4 + 0.5,
      ),
    );
    if (dlgId) {
      push(dlgSec, {
        character_ids: idList.length ? idList : [dlgId],
        visual_action: `${speakerName}面向听者，肩线略前倾，下颌开合随语句起伏，双手保持上一落点姿态`,
        character_state: `${speakerName}说话中，${expression}`,
        position: blocking || where,
        expression,
        eyeline,
        dialogue: dlgText,
        dialogue_character_id: dlgId,
        environment_audio: sfxParts.slice(-1),
        lip_sync: true,
      });
    } else {
      // 缺绑定：仍分段写出对白，但口型关，供 Dependency Checker / 补全拦截
      push(dlgSec, {
        character_ids: idList,
        visual_action: `${speakerName}有对白但未绑定角色 id`,
        character_state: expression,
        position: blocking || where,
        expression,
        eyeline,
        dialogue: dlgText,
        dialogue_character_id: '',
        environment_audio: sfxParts.slice(-1),
        lip_sync: false,
      });
    }
  }

  if (t < dur - 0.05) {
    push(dur - t, {
      character_ids: idList,
      visual_action: leadName
        ? `${leadName}维持落点，呼吸起伏`
        : `维持环境余韵，画面呼吸起伏`,
      character_state: leadName ? `${leadName}${expression}` : expression,
      position: blocking || where,
      expression,
      eyeline,
      dialogue: '',
      dialogue_character_id: '',
      environment_audio: sfxParts[0] ? [`${sfxParts[0]}余韵`] : ['环境声收回'],
      lip_sync: false,
    });
  }

  if (!events.length) {
    events.push(
      createEmptyDramaTimelineEvent({
        start_sec: 0,
        end_sec: dur,
        character_ids: idList,
        visual_action:
          action ||
          (leadName
            ? `${leadName}在${where}完成可见调度`
            : `交代${where}环境与可见调度`),
        character_state: leadName ? `${leadName}${expression}` : expression,
        position: blocking || where,
        expression,
        eyeline,
        dialogue: '',
        dialogue_character_id: '',
        environment_audio: sfxParts,
        lip_sync: false,
        camera_action: cam,
      }),
    );
  }

  return normalizeDramaTimelineEvents(events, dur);
}

/** 展示用：从结构化事件压成一行自然语言（非真相源） */
export function formatDramaTimelineEventDisplay(ev: DramaTimelineEvent): string {
  const t0 = Number.isInteger(ev.start_sec) ? String(ev.start_sec) : ev.start_sec.toFixed(1);
  const t1 = Number.isInteger(ev.end_sec) ? String(ev.end_sec) : ev.end_sec.toFixed(1);
  const cam = ev.camera_action || '机位未写';
  const env =
    ev.environment_audio.length > 0
      ? `环境音：${ev.environment_audio.join('、')}`
      : '环境音：无';
  const dlg =
    ev.dialogue && ev.dialogue_character_id
      ? `说话人=${ev.dialogue_character_id}：「${ev.dialogue}」·口型开`
      : '无台词 · 口型关';
  return `${t0}–${t1}秒｜${cam}｜${env}｜${ev.visual_action || '动作未写'}｜${dlg}`;
}

/**
 * 确保 shot 带有 timeline_events：
 * - 已有结构化事件且不过薄 → 归一化
 * - 否则启发式生成多段事件
 * - 若仅有旧 beats → 弱迁移后再检查，仍薄则启发式覆盖
 */
export function ensureDramaShotTimelineEvents(shot: DramaShot): DramaShot {
  const dur = Number(shot.duration_sec) > 0 ? Number(shot.duration_sec) : 10;
  const existing = Array.isArray(shot.timeline_events) ? shot.timeline_events : [];
  let timeline_events: DramaTimelineEvent[];

  if (existing.length && !isDramaTimelineEventsThin(existing)) {
    timeline_events = differentiateDuplicateTimelineCuts(
      normalizeDramaTimelineEvents(existing, dur),
    );
  } else {
    const migrated = migrateBeatsToTimelineEvents(shot.timeline_beats, dur);
    if (migrated.length >= 2 && !isDramaTimelineEventsThin(migrated)) {
      timeline_events = differentiateDuplicateTimelineCuts(migrated);
    } else {
      timeline_events = differentiateDuplicateTimelineCuts(
        buildHeuristicTimelineEvents(shot, dur, {
          characterIds: shot.character_ids,
        }),
      );
    }
  }

  const timeline_beats: DramaShotTimelineBeat[] = timeline_events.map((e) => ({
    start_sec: e.start_sec,
    end_sec: e.end_sec,
    text: formatDramaTimelineEventDisplay(e),
    kind: e.lip_sync || e.dialogue ? 'dialogue' : e.environment_audio.length ? 'sfx' : 'action',
  }));

  return {
    ...shot,
    timeline_events,
    timeline_beats,
  };
}

/** 验收：从执行表时间轴能否明确回答关键问题（缺则列出） */
export function auditDramaTimelineEventsAnswerability(shot: DramaShot): {
  ok: boolean;
  answered: string[];
  missing: string[];
} {
  const events = ensureDramaShotTimelineEvents(shot).timeline_events;
  const answered: string[] = [];
  const missing: string[] = [];

  if (!events.length) {
    missing.push('时间轴事件为空');
    return { ok: false, answered, missing };
  }
  answered.push(`共 ${events.length} 段时间轴事件`);

  const who = new Set<string>();
  for (const e of events) e.character_ids.forEach((id) => who.add(id));
  if (who.size) answered.push(`谁在画面里：${[...who].join('、')}`);
  else missing.push('谁在画面里（character_ids）');

  const actions = events.filter((e) => e.visual_action);
  if (actions.length) answered.push(`谁在什么时候做什么：${actions.length} 段有 visual_action`);
  else missing.push('人物动作（visual_action）');

  const dlgEvents = events.filter((e) => e.dialogue && e.dialogue_character_id);
  const vagueDlg = events.filter((e) => e.dialogue && !e.dialogue_character_id);
  if (vagueDlg.length) {
    missing.push('存在对白但未绑定 dialogue_character_id（禁止“有人说话”）');
  }
  if (dlgEvents.length) {
    answered.push(
      `谁在什么时候说话：${dlgEvents
        .map(
          (e) =>
            `${e.start_sec}–${e.end_sec}s ${e.dialogue_character_id}「${e.dialogue.slice(0, 24)}」`,
        )
        .join('；')}`,
    );
  } else {
    answered.push('本镜时间轴无绑定对白（或全段无台词）');
  }

  const lipOn = events.filter((e) => e.lip_sync);
  const lipOff = events.filter((e) => !e.lip_sync);
  answered.push(`口型：开启 ${lipOn.length} 段 / 关闭 ${lipOff.length} 段`);
  for (const e of lipOn) {
    if (!e.dialogue_character_id || !e.dialogue) {
      missing.push(`lip_sync=true 但缺对白主体/内容（${e.start_sec}–${e.end_sec}s）`);
    }
  }

  const envOnly = events.filter((e) => e.environment_audio.length && !e.dialogue);
  if (envOnly.length) {
    answered.push(
      `仅环境音时段：${envOnly
        .map((e) => `${e.start_sec}–${e.end_sec}s[${e.environment_audio.join(',')}]`)
        .join('；')}`,
    );
  }

  const cam = events.filter((e) => e.camera_action);
  if (cam.length) answered.push(`机位/运镜：${cam.length} 段有 camera_action`);
  else missing.push('机位/运镜（camera_action）');

  if (!String(shot.scene_asset_id || '').trim()) {
    missing.push('场景绑定 scene_asset_id');
  } else {
    answered.push(`场景：${shot.scene_asset_id}`);
  }

  return { ok: missing.length === 0, answered, missing };
}
