/**
 * 导演拆戏：视觉事件 → 戏剧 Beat → 镜头。
 * 禁止「一段小说 = 两三镜」；先拆必须被看见的事件，再合并。
 */

import { normalizeDramaShotPlanPaceGear } from './types.js';

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
  /** 观众这一拍最该看见什么 */
  see: string;
  /** 切点理由 */
  cut: string;
  /** 硬事件 / 辅助事件；缺省由 classify 补全 */
  priority: DramaVisualEventPriority;
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
      Math.min(14, dlgTurns) * 0.55 +
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
  /** 短剧略密、正剧略疏、15秒高密度合镜 */
  paceGear?: 'dense_15s' | 'short_drama' | 'cinematic' | string,
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

/** 按信息量落到 6 / 10 / 15 / 20：环境/信息闪现 6；赶路/单句 10；对白冲突/复杂动作 15；完整段落 20。 */
export function recommendDramaShotPlanDurationSec(shot: {
  dramatic_purpose?: string;
  purpose?: string;
  action?: string;
  dialogue?: string;
  size?: string;
}): 6 | 10 | 15 | 20 {
  const purpose = String(shot.dramatic_purpose || '').toLowerCase();
  const intent = `${shot.purpose || ''} ${shot.action || ''}`;
  const action = String(shot.action || '');
  const dlg = String(shot.dialogue || '').replace(/\s+/g, '');
  const dlgTurns = (String(shot.dialogue || '').match(/[：:]/g) || []).length;
  const dlgChars = dlg.replace(/[^0-9A-Za-z\u4e00-\u9fff]/g, '').length;
  const actionHits = (action.match(/骑|冲|停|砍|刺|跳|握|剑|打|追|摔|升级|击杀|对峙|加速|急停/g) || [])
    .length;

  let rec = 6;
  // 对白细切：1～2 句/短反应保持 6；勿因 dramatic_purpose=dialogue 一律抬到 10/15
  if (dlgTurns >= 5 || dlgChars >= 60) rec = 15;
  else if (dlgTurns >= 3 || dlgChars >= 35) rec = 10;
  else if (dlgTurns >= 1 || dlgChars >= 12) rec = 6;

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

export function createEmptyDramaVisualEvent(
  partial?: Partial<DramaVisualEvent>,
): DramaVisualEvent {
  const base = {
    event_id: String(partial?.event_id || '').trim(),
    index: Number.isFinite(Number(partial?.index)) ? Number(partial?.index) : 0,
    location: String(partial?.location || '').trim(),
    kind: normalizeDramaVisualEventKind(partial?.kind),
    who: String(partial?.who || '').trim(),
    see: String(partial?.see || '').trim(),
    cut: String(partial?.cut || '').trim(),
    priority: (normalizeDramaVisualEventPriority(partial?.priority) || 'A') as DramaVisualEventPriority,
  };
  return {
    ...base,
    priority: classifyDramaVisualEventPriority(base, { llmPriority: partial?.priority }),
  };
}
