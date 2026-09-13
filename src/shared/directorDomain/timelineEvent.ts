/**
 * AI导演执行表 · 时间轴事件（TimelineEvent）
 *
 * 真相源：timeline_events[]（每段视听事件）。
 * timeline_beats 仅为遗留展示/迁移输入，不得作为 Adapter 执行核心。
 */

import { dramaNewId } from './ids.js';
import { getActiveEpisodeBible } from './episodeBible.js';
import { resolveDramaCharacterIdByName } from './ensureAppearingCharacters.js';
import { stripDramaSpokenLineBody } from './characterDesignPrompt.js';
import { isSystemSpeakerName, looksLikeDramaSystemSpokenText, looksLikeDramaInMindSystemVoice, isDramaSceneTransitionText, isDramaSystemSpeechSpeaker, isNonVisualDramaEyeline, isDramaScreenTextVisual, isDramaNarrationVisual, isDramaInnerOsCue, cleanDramaMappedVisualAction, stripDramaDirectorLensTags, stripDramaInnerOsFromVisual, stripDramaNarrationLabel, stripDramaSystemSpokenLabel } from './extractCastFromScript.js';
import {
  DRAMA_NARRATOR_SPEAKER_ID,
  DRAMA_SYSTEM_SPEAKER_ID,
  ensureDramaSystemHologramVisual,
  isDramaSystemVoiceId,
  resolveDramaVoiceRole,
  sanitizeDramaCharacterIds,
} from './voiceEntity.js';
import {
  formatDramaEmotionAsCharacterState,
  mapDramaSeeToEyeline,
  pickVisibleDramaExpression,
  resolveDramaWhoToCharacterIds,
} from './mergeDramaVisualEvents.js';
import { resolveDramaActionSubjectName } from './originalScript.js';
import { estimateDramaFastPaceSegment, estimateDramaTalkSec } from './shotDurationFastPace.js';
import type { DramaVisualEvent } from './shotPlanning.js';
import type {
  DramaDialogueLine,
  DramaDirectorSession,
  DramaOriginalSegment,
  DramaShot,
  DramaShotTimelineBeat,
  DramaTimelineEvent,
} from './types.js';

const SPEECH_MARK_RE =
  /[啊吧呢吗呀]|家人们|卧槽|怎么不|播啊|这把|下播|管饭|我知道|修仙|灵根|资质|体魄|用力了啊|再用点力|没用力|来都来了|你知道还来/;
const ACTION_ONLY_RE =
  /走进|坐下|站定|推门|打哈欠|喝汽水|屏幕炸|雷劈|闪光|呼吸|进入|全身用力|长叹|维持落点|双手|自然下垂|毫无反应|玉石|站位落定|画面过渡/;

function tidyPeeledVisual(visual: string): string {
  return String(visual || '')
    .replace(/\s{2,}/g, ' ')
    .replace(/[。.]{2,}/g, '。')
    .replace(/^[。.\s]+|[。.\s]+$/g, '')
    .trim();
}

function looksLikeSpokenLine(raw: string): boolean {
  const t = String(raw || '').trim();
  if (t.length < 2 || t.length > 80) return false;
  if (ACTION_ONLY_RE.test(t) && !SPEECH_MARK_RE.test(t)) return false;
  return SPEECH_MARK_RE.test(t) || /——|…|\.{2,}|[！？!]/.test(t);
}

/** 从画面动作里剥出误写进去的台词（「」或（表演）口语——） */
export function peelSpokenLineFromVisualAction(visual: string): {
  visual: string;
  dialogue: string;
} {
  let v = String(visual || '').trim();
  if (!v) return { visual: '', dialogue: '' };

  const quotes: string[] = [];
  v = v.replace(/[「『""]([^」』""]{1,160})[」』""]/g, (_all, inner: string) => {
    const t = String(inner || '')
      .replace(/【炸弹字幕[:：][^】]*】/g, '')
      .trim();
    if (t && !/无参考图|按文字描述生成/.test(t)) quotes.push(t);
    return '';
  });
  if (quotes.length) {
    return { visual: tidyPeeledVisual(v), dialogue: quotes.join(' ') };
  }

  const paren = /[（(]([^）)]{1,20})[）)]\s*([^（(\n「]{2,80}?(?:——|…+|\.{2,}|！|!|？|\?))/;
  const m = v.match(paren);
  if (m && looksLikeSpokenLine(m[2])) {
    const dialogue = String(m[2] || '').trim();
    const next = tidyPeeledVisual(v.replace(m[0], ''));
    return { visual: next, dialogue };
  }
  return { visual: v, dialogue: '' };
}

export function spokenTextFromDramaTimelineEvent(ev: {
  dialogue?: string;
  visual_action?: string;
}): string {
  void ev?.visual_action;
  return String(ev?.dialogue || '').trim();
}

export type DramaSpeakerRef = {
  name: string;
  character_id: string;
};

export type DramaSpokenTurn = DramaSpeakerRef & {
  line: string;
};

function classifyDramaChunk(raw: string): 'speech' | 'action' {
  const t = String(raw || '').trim();
  if (!t) return 'action';
  if (/[「『""]/.test(t)) return 'speech';
  if (looksLikeSpokenLine(t)) return 'speech';
  const speech = SPEECH_MARK_RE.test(t) || /[？！…]/.test(t);
  const action = ACTION_ONLY_RE.test(t);
  if (speech && !action) return 'speech';
  if (action && !speech) return 'action';
  if (speech) return 'speech';
  return 'action';
}

function matchSpeakerByName(
  token: string,
  speakers: DramaSpeakerRef[],
): DramaSpeakerRef | null {
  const t = String(token || '');
  const ordered = [...speakers].sort((a, b) => b.name.length - a.name.length);
  for (const s of ordered) {
    if (s.name && t.includes(s.name)) return s;
  }
  return null;
}

/**
 * 把「江澈 用力了啊，执事长老 再用点力」拆成按说话人绑定的多句。
 * 动作句留在 visual，台词进 turns。
 */
export function splitDramaSpeakerTurns(
  text: string,
  speakers: DramaSpeakerRef[],
  defaultSpeaker?: DramaSpeakerRef | null,
): { visual: string; turns: DramaSpokenTurn[] } {
  let raw = String(text || '').trim();
  if (!raw) return { visual: '', turns: [] };

  const turns: DramaSpokenTurn[] = [];
  const visualBits: string[] = [];
  const pushTurn = (speaker: DramaSpeakerRef | null | undefined, line: string) => {
    const names = speakers.map((s) => String(s.name || '').trim()).filter(Boolean);
    const t = stripDramaSpokenLineBody(
      String(line || '')
        .replace(/[「『""」』""]/g, '')
        .replace(/^(?:说|道|喊)[：:]\s*/, '')
        .replace(/^[,，;；\s]+|[,，;；\s]+$/g, '')
        .trim(),
      names,
    );
    if (!t || t.length > 180) return;
    const who = speaker || defaultSpeaker;
    if (!who?.name && !who?.character_id) return;
    if (turns.some((x) => x.line === t && x.character_id === (who?.character_id || ''))) return;
    turns.push({
      name: String(who?.name || '').trim(),
      character_id: String(who?.character_id || '').trim(),
      line: t,
    });
  };
  const pushVisual = (bit: string) => {
    const t = String(bit || '').replace(/\s+/g, ' ').trim();
    if (t) visualBits.push(t);
  };

  raw = raw.replace(/<d>\s*\[Chinese[^\]]*\]\s*([\s\S]*?)<\/d>/gi, (_all, inner: string) => {
    pushTurn(defaultSpeaker, String(inner || ''));
    return '\n';
  });

  const quotes: string[] = [];
  raw = raw.replace(/[「『""]([^」』""]{1,160})[」』""]/g, (_all, inner: string) => {
    quotes.push(String(inner || '').trim());
    return '\n';
  });
  for (const q of quotes) pushTurn(defaultSpeaker, q);

  const names = [...speakers]
    .filter((s) => String(s.name || '').trim())
    .sort((a, b) => b.name.length - a.name.length);
  const nameAlt = names
    .map((s) => s.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('|');
  // 称呼「江澈，你来了」不应当说话人切段；仅名后紧跟台词/标点才切
  const splitRe = nameAlt
    ? new RegExp(
        `(?:<Subject\\s*\\d+>\\s*[（(]S\\d+[）)]\\s*)?(?:${nameAlt})(?![，,])`,
        'g',
      )
    : null;

  const parts: Array<{ speaker: DramaSpeakerRef | null; text: string }> = [];
  if (splitRe) {
    let lastIndex = 0;
    let lastSpeaker: DramaSpeakerRef | null = defaultSpeaker || null;
    let m: RegExpExecArray | null;
    splitRe.lastIndex = 0;
    while ((m = splitRe.exec(raw)) !== null) {
      const before = raw.slice(lastIndex, m.index).trim();
      if (before) parts.push({ speaker: lastSpeaker, text: before });
      lastSpeaker = matchSpeakerByName(m[0], speakers) || lastSpeaker;
      lastIndex = m.index + m[0].length;
    }
    const tail = raw.slice(lastIndex).trim();
    if (tail) parts.push({ speaker: lastSpeaker, text: tail });
    if (!parts.length && raw.trim()) {
      parts.push({ speaker: defaultSpeaker || null, text: raw.trim() });
    }
  } else if (raw.trim()) {
    parts.push({ speaker: defaultSpeaker || null, text: raw.trim() });
  }

  for (const part of parts) {
    let rest = part.text.replace(/^(?:说|道|喊)[：:]\s*/, '').trim();
    const acting = rest.match(/^[（(]([^）)]{1,24})[）)]\s*(.*)$/);
    if (acting) {
      pushVisual(acting[1]);
      rest = String(acting[2] || '').trim();
    }
    if (!rest) continue;
    if (classifyDramaChunk(rest) === 'speech') pushTurn(part.speaker, rest);
    else pushVisual(rest);
  }

  return {
    visual: visualBits.join(' ').replace(/\s+/g, ' ').trim(),
    turns,
  };
}

/** 只从 event.dialogue 拆说话人；禁止再从 visual_action 找台词 */
export function collectDramaEventSpokenTurns(
  ev: {
    dialogue?: string;
    visual_action?: string;
    dialogue_character_id?: string;
    character_ids?: string[];
  },
  speakers: DramaSpeakerRef[],
  fallbackCharacterId = '',
): { visual: string; turns: DramaSpokenTurn[] } {
  void fallbackCharacterId;
  const visual = String(ev.visual_action || '').trim();
  const dlg = String(ev.dialogue || '').trim();
  if (!dlg) return { visual, turns: [] };
  const defaultId = String(ev.dialogue_character_id || '').trim();
  const role = resolveDramaVoiceRole(defaultId);
  const systemText =
    looksLikeDramaSystemSpokenText(dlg) || looksLikeDramaInMindSystemVoice(dlg);
  const defaultSpeaker =
    role === 'narrator'
      ? { name: '旁白', character_id: DRAMA_NARRATOR_SPEAKER_ID }
      : role === 'system' || systemText
        ? { name: '系统', character_id: DRAMA_SYSTEM_SPEAKER_ID }
        : speakers.find((s) => s.character_id === defaultId) ||
          (defaultId ? { name: '', character_id: defaultId } : null);
  const names = speakers.map((s) => String(s.name || '').trim()).filter(Boolean);
  const cleaned = stripDramaSpokenLineBody(dlg, names);
  if (!cleaned) return { visual, turns: [] };
  const fromDlg = splitDramaSpeakerTurns(cleaned, speakers, defaultSpeaker);
  if (fromDlg.turns.length) {
    return {
      visual,
      turns: fromDlg.turns.map((t) => ({
        ...t,
        line: stripDramaSpokenLineBody(t.line, names) || t.line,
      })),
    };
  }
  // 已有明确说话人时：整段纯对白单 turn，禁止回退脏原文
  if (defaultSpeaker?.character_id || defaultSpeaker?.name) {
    return {
      visual,
      turns: [
        {
          name: String(defaultSpeaker.name || '').trim(),
          character_id: String(defaultSpeaker.character_id || '').trim(),
          line: cleaned,
        },
      ],
    };
  }
  return { visual, turns: [] };
}

export function inferDramaTimelineDialogueSpeakerId(
  ev: {
    dialogue_character_id?: string;
    character_ids?: string[];
    dialogue?: string;
    visual_action?: string;
    expression?: string;
  },
  fallbackCharacterId = '',
): string {
  const cid = String(ev?.dialogue_character_id || '').trim();
  const dlg = String(ev?.dialogue || '').trim();
  const visual = String(ev?.visual_action || '').trim();
  if (resolveDramaVoiceRole(cid) === 'narrator') {
    return DRAMA_NARRATOR_SPEAKER_ID;
  }
  if (resolveDramaVoiceRole(cid) === 'system' || isDramaSystemTimelineSpeaker(cid, '')) {
    return resolveDramaVoiceRole(cid, '') === 'narrator'
      ? DRAMA_NARRATOR_SPEAKER_ID
      : DRAMA_SYSTEM_SPEAKER_ID;
  }
  if (
    looksLikeDramaSystemSpokenText(dlg) ||
    looksLikeDramaInMindSystemVoice(dlg) ||
    looksLikeDramaSystemSpokenText(visual) ||
    looksLikeDramaInMindSystemVoice(visual)
  ) {
    return DRAMA_SYSTEM_SPEAKER_ID;
  }
  if (isDramaInnerOsCue(dlg) || isDramaInnerOsCue(String(ev?.expression || ''))) {
    return '';
  }
  if (cid) return cid;
  const fallback = String(fallbackCharacterId || '').trim();
  if (isDramaSystemVoiceId(fallback) || isDramaSystemTimelineSpeaker(fallback, '')) {
    return DRAMA_SYSTEM_SPEAKER_ID;
  }
  if (fallback) return fallback;
  const onScreen = sanitizeDramaCharacterIds(ev.character_ids);
  return onScreen.length === 1 ? onScreen[0] : '';
}

/** 只补已有 dialogue 的说话人；禁止从 visual_action 剥台词，禁止把系统声绑成主演 */
export function hydrateDramaTimelineEventDialogue(
  ev: DramaTimelineEvent,
  fallbackCharacterId = '',
): DramaTimelineEvent {
  const dialogue = String(ev.dialogue || '').trim();
  if (!dialogue) return ev;
  if (
    (isDramaInnerOsCue(dialogue) || isDramaInnerOsCue(String(ev.expression || ''))) &&
    !looksLikeDramaSystemSpokenText(dialogue) &&
    !looksLikeDramaInMindSystemVoice(dialogue)
  ) {
    return {
      ...ev,
      dialogue: '',
      dialogue_character_id: '',
      lip_sync: false,
    };
  }
  const inferred = inferDramaTimelineDialogueSpeakerId(ev, fallbackCharacterId);
  if (resolveDramaVoiceRole(inferred) === 'narrator') {
    return {
      ...ev,
      dialogue,
      dialogue_character_id: DRAMA_NARRATOR_SPEAKER_ID,
      lip_sync: false,
      character_ids: sanitizeDramaCharacterIds(ev.character_ids),
    };
  }
  if (isDramaSystemVoiceId(inferred) || isDramaSystemTimelineSpeaker(inferred, '')) {
    return {
      ...ev,
      dialogue,
      dialogue_character_id: DRAMA_SYSTEM_SPEAKER_ID,
      lip_sync: false,
      character_ids: sanitizeDramaCharacterIds(ev.character_ids),
      visual_action: ensureDramaSystemHologramVisual(ev.visual_action, true),
    };
  }
  if (!inferred) {
    return {
      ...ev,
      dialogue,
      dialogue_character_id: '',
      lip_sync: false,
    };
  }
  return {
    ...ev,
    dialogue,
    dialogue_character_id: inferred,
    lip_sync:
      String(ev.dialogue_character_id || '').trim() === inferred ? ev.lip_sync : true,
    character_ids: sanitizeDramaCharacterIds(ev.character_ids),
  };
}

export function hydrateDramaTimelineEventsDialogue(
  events: DramaTimelineEvent[] | undefined | null,
  fallbackCharacterId = '',
): DramaTimelineEvent[] {
  return (Array.isArray(events) ? events : []).map((e) =>
    hydrateDramaTimelineEventDialogue(e, fallbackCharacterId),
  );
}

function dialogueLinesFromTimelineEvents(
  events: DramaTimelineEvent[],
): DramaDialogueLine[] {
  return events
    .filter((e) => String(e.dialogue || '').trim())
    .map((e) => ({
      dialogue_id: String(e.event_id || '').trim()
        ? `dlg-${e.event_id}`
        : dramaNewId('dlg'),
      character_id: String(e.dialogue_character_id || '').trim(),
      character_name: '',
      text: String(e.dialogue || '').trim(),
    }));
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

const MIN_EVENT_SEC = 0.2;

/**
 * TEMP 测试开关：true = 彩条不做时间切分，整镜压成单段 0→总长。
 * 测完改回 false。
 */
export const DRAMA_TIMELINE_SPLIT_DISABLED = true;

/** 将多段彩条合并为整镜单段（内容拼接保留，时间不再切分） */
export function collapseDramaTimelineEventsToSingle(
  events: DramaTimelineEvent[] | undefined | null,
  durationSec: number,
): DramaTimelineEvent[] {
  const dur = Math.max(0.1, Number(durationSec) || 0.1);
  const list = (Array.isArray(events) ? events : [])
    .map((e) => createEmptyDramaTimelineEvent(e))
    .sort((a, b) => a.start_sec - b.start_sec || a.end_sec - b.end_sec);
  if (!list.length) {
    return [
      createEmptyDramaTimelineEvent({
        start_sec: 0,
        end_sec: dur,
        visual_action: '',
        camera_action: '',
        dialogue: '',
        dialogue_character_id: '',
        expression: '',
        environment_audio: [],
        lip_sync: false,
      }),
    ];
  }
  const joinUnique = (xs: string[]) =>
    [...new Set(xs.map((x) => String(x || '').trim()).filter(Boolean))].join('。');
  const dlgEv = list.filter((e) => String(e.dialogue || '').trim());
  const dialogue = dlgEv.map((e) => String(e.dialogue || '').trim()).filter(Boolean).join(' ');
  const dialogue_character_id = String(dlgEv[0]?.dialogue_character_id || '').trim();
  const character_ids = [
    ...new Set(list.flatMap((e) => (e.character_ids || []).map((id) => String(id || '').trim()).filter(Boolean))),
  ];
  const environment_audio = [
    ...new Set(list.flatMap((e) => e.environment_audio || []).map((x) => String(x || '').trim()).filter(Boolean)),
  ];
  const asSystem = isDramaSystemVoiceId(dialogue_character_id);
  return [
    createEmptyDramaTimelineEvent({
      ...list[0],
      start_sec: 0,
      end_sec: round1(dur),
      visual_action: joinUnique(list.map((e) => e.visual_action)),
      expression: joinUnique(list.map((e) => e.expression)),
      character_state: joinUnique(list.map((e) => e.character_state)),
      position: joinUnique(list.map((e) => e.position)),
      eyeline: joinUnique(list.map((e) => e.eyeline)),
      camera_action: joinUnique(list.map((e) => e.camera_action)),
      dialogue,
      dialogue_character_id,
      character_ids,
      environment_audio,
      lip_sync: !!(dialogue && dialogue_character_id && !asSystem),
    }),
  ];
}

export function createEmptyDramaTimelineEvent(
  partial?: Partial<DramaTimelineEvent>,
): DramaTimelineEvent {
  const start = Math.max(0, Number(partial?.start_sec) || 0);
  let end = Math.max(0, Number(partial?.end_sec) || 0);
  if (end <= start) end = round1(start + 0.1);
  const dialogue = String(partial?.dialogue || '').trim();
  const rawSpeakerId = String(partial?.dialogue_character_id || '').trim();
  const speakerRole = resolveDramaVoiceRole(rawSpeakerId);
  const asNarrator = speakerRole === 'narrator';
  const asSystem =
    !asNarrator &&
    (speakerRole === 'system' ||
      looksLikeDramaSystemSpokenText(dialogue) ||
      looksLikeDramaInMindSystemVoice(dialogue));
  const dialogue_character_id = dialogue
    ? asNarrator
      ? DRAMA_NARRATOR_SPEAKER_ID
      : asSystem
        ? DRAMA_SYSTEM_SPEAKER_ID
        : rawSpeakerId
    : rawSpeakerId;
  const lip_sync =
    typeof partial?.lip_sync === 'boolean'
      ? partial.lip_sync
      : !!(dialogue && dialogue_character_id && !asSystem && !asNarrator);
  return {
    event_id: String(partial?.event_id || '').trim() || dramaNewId('tev'),
    start_sec: round1(start),
    end_sec: round1(end),
    character_ids: sanitizeDramaCharacterIds(
      Array.isArray(partial?.character_ids) ? partial!.character_ids : [],
    ),
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

export { DRAMA_SYSTEM_SPEAKER_ID };

export function isDramaSystemTimelineSpeaker(id: string, who = ''): boolean {
  const cid = String(id || '').trim();
  const name = String(who || '').trim();
  if (/^system$|^narrator$|^narration$/i.test(cid)) return true;
  return isSystemSpeakerName(cid) || isSystemSpeakerName(name);
}

export function isDramaSystemTimelineBeat(e: DramaTimelineEvent | undefined | null): boolean {
  if (!e) return false;
  if (isDramaSceneTransitionText(e.dialogue)) return false;
  if (looksLikeDramaSystemSpokenText(e.dialogue)) return true;
  if (isDramaNarrationVisual(e.dialogue) || isDramaNarrationVisual(e.visual_action)) return true;
  if (isDramaSystemTimelineSpeaker(e.dialogue_character_id, '') && !isDramaSceneTransitionText(e.visual_action)) {
    return true;
  }
  if (isDramaSceneTransitionText(e.visual_action)) return false;
  if (looksLikeDramaSystemSpokenText(e.visual_action)) return true;
  return false;
}

/** 旧轴里系统台词误写在 visual_action 时，编译前剥回 dialogue。 */
export function peelSystemSpokenFromTimelineVisual(
  visual: string,
  dialogue: string,
): { visual: string; dialogue: string } {
  const vis = tidyDramaTimelineVisualAction(visual);
  const dlg = String(dialogue || '').trim();
  if (isDramaSceneTransitionText(dlg)) {
    const merged = vis || dlg;
    return {
      visual: isPlaceholderDramaVisualAction(merged) ? '' : merged,
      dialogue: '',
    };
  }
  if (isDramaSceneTransitionText(vis)) {
    return {
      visual: isPlaceholderDramaVisualAction(vis) ? '' : vis,
      dialogue: dlg && !isDramaSceneTransitionText(dlg) ? dlg : '',
    };
  }
  if (isDramaScreenTextVisual(vis)) {
    // 专段弹幕/屏字保留进 visual，供 Compiler 画 overlay；对白字段不吃屏字
    return {
      visual: vis,
      dialogue: dlg && !isDramaScreenTextVisual(dlg) ? dlg : '',
    };
  }
  if (isDramaNarrationVisual(vis)) {
    return { visual: '', dialogue: dlg || stripDramaNarrationLabel(vis) };
  }
  const cleaned = cleanDramaMappedVisualAction(vis);
  if (dlg) {
    const nextDlg = isDramaInnerOsCue(dlg)
      ? ''
      : looksLikeDramaSystemSpokenText(dlg) || isDramaNarrationVisual(dlg)
        ? stripDramaNarrationLabel(stripDramaSystemSpokenLabel(dlg))
        : dlg;
    return {
      visual: looksLikeDramaSystemSpokenText(vis) ? '' : cleaned,
      dialogue: nextDlg,
    };
  }
  if (isDramaInnerOsCue(vis) && !cleaned) return { visual: '', dialogue: '' };
  if (!looksLikeDramaSystemSpokenText(vis)) return { visual: cleaned, dialogue: '' };
  const stripped = stripDramaSpeakerPrefix(vis);
  const body = isDramaSystemSpeechSpeaker(stripped.speaker)
    ? stripped.body || vis
    : stripped.body || vis;
  return { visual: '', dialogue: stripDramaSystemSpokenLabel(body) };
}

/** 去掉句首句尾空标点，避免 “。一道白光闪过” 这类切段残片。 */
export function tidyDramaTimelineVisualAction(raw: string): string {
  let t = String(raw || '')
    .replace(/^[。．.\s]+/g, '')
    .replace(/[。．.\s]+$/g, '')
    .trim();
  const wrapped = t.match(/^[（(]([^）)]+)[）)]$/);
  if (wrapped) t = String(wrapped[1] || '').trim();
  return t;
}

/** 空转场 / 无目的地切至，不算成片事实。 */
export function isPlaceholderDramaVisualAction(raw: string): boolean {
  const t = tidyDramaTimelineVisualAction(raw);
  if (!t) return true;
  if (/^(?:切至|切入|切到|淡入|淡出)[:：]?\s*$/i.test(t)) return true;
  if (/^(?:CUT\s*TO|FADE\s*(?:IN|OUT))[:：]?\s*$/i.test(t)) return true;
  return false;
}

export function dramaTimelineEventHasContent(e: DramaTimelineEvent | undefined | null): boolean {
  if (!e) return false;
  if (String(e.dialogue || '').trim()) return true;
  if ((e.environment_audio || []).some((x) => String(x || '').trim())) return true;
  if (String(e.camera_action || '').trim()) return true;
  const vis = String(e.visual_action || '').trim();
  if (vis && !isPlaceholderDramaVisualAction(vis)) return true;
  return false;
}

/** 过薄：空轴、或单条整场原文dump。纯对白/环境声不算 thin。 */
export function isDramaTimelineEventsThin(
  events: DramaTimelineEvent[] | undefined | null,
): boolean {
  const list = Array.isArray(events) ? events : [];
  if (!list.length) return true;
  const valid = list.filter((e) => dramaTimelineEventHasContent(e));
  if (valid.length >= 2) return false;
  if (valid.length === 1) {
    const e = valid[0];
    const vis = String(e.visual_action || '').trim();
    if (vis.length > 220 && !String(e.dialogue || '').trim()) return true;
    return false;
  }
  return true;
}

function timelineEventDialogueText(e: DramaTimelineEvent): string {
  return String(e.dialogue || '').trim();
}

export function minDramaTimelineDialogueSpanSec(dialogue: string): number {
  const text = String(dialogue || '').trim();
  if (!text) return 0;
  return Math.max(MIN_EVENT_SEC, round1(estimateDramaTalkSec(text)));
}

/** 只填空导演字段；不改对白/动作/环境声/时间。 */
export function fillEmptyDramaTimelineEventFields(
  base: DramaTimelineEvent,
  patch?: Partial<DramaTimelineEvent> | null,
): DramaTimelineEvent {
  const cur = createEmptyDramaTimelineEvent(base);
  if (!patch) return cur;
  const pick = (a: string, b: unknown) => String(a || '').trim() || String(b || '').trim();
  return createEmptyDramaTimelineEvent({
    ...cur,
    character_state: pick(cur.character_state, patch.character_state),
    position: pick(cur.position, patch.position),
    expression: pick(cur.expression, patch.expression),
    eyeline: pick(cur.eyeline, patch.eyeline),
    camera_action: pick(cur.camera_action, patch.camera_action),
    character_ids:
      cur.character_ids.length > 0
        ? cur.character_ids
        : Array.isArray(patch.character_ids)
          ? patch.character_ids.map(String).filter(Boolean)
          : cur.character_ids,
    visual_action: cur.visual_action,
    dialogue: cur.dialogue,
    dialogue_character_id: cur.dialogue_character_id,
    environment_audio: cur.environment_audio,
    start_sec: cur.start_sec,
    end_sec: cur.end_sec,
    lip_sync: cur.lip_sync,
    event_id: cur.event_id,
  });
}

/** 按 event_id 再按序号，把 incoming 的空字段补进已有有效轴。不增删事件。 */
export function mergeDramaTimelineEventsFillEmpty(
  existing: DramaTimelineEvent[] | undefined | null,
  incoming: DramaTimelineEvent[] | undefined | null,
): DramaTimelineEvent[] {
  const base = (Array.isArray(existing) ? existing : []).map((e) =>
    createEmptyDramaTimelineEvent(e),
  );
  const patch = (Array.isArray(incoming) ? incoming : []).map((e) =>
    createEmptyDramaTimelineEvent(e),
  );
  if (!patch.length) return base;
  return base.map((e, i) => {
    const byId = e.event_id ? patch.find((x) => x.event_id && x.event_id === e.event_id) : undefined;
    return fillEmptyDramaTimelineEventFields(e, byId || patch[i]);
  });
}

/**
 * 归一化：排序、去空、铺满 0→duration。
 * 对白事件不可裁短于 estimateDramaTalkSec；不足则抬高总时长。
 * 多余时间由非对白事件吸收。
 */
export function normalizeDramaTimelineEvents(
  events: DramaTimelineEvent[] | undefined | null,
  durationSec: number,
): DramaTimelineEvent[] {
  const requested = Math.max(0.1, Number(durationSec) || 0.1);
  const list = (Array.isArray(events) ? events : [])
    .map((e) => createEmptyDramaTimelineEvent(e))
    .filter((e) => e.end_sec > e.start_sec)
    .sort((a, b) => a.start_sec - b.start_sec || a.end_sec - b.end_sec);

  if (!list.length) return [];

  const spans = list.map((e) => {
    const raw = Math.max(MIN_EVENT_SEC, e.end_sec - e.start_sec);
    const dlg = timelineEventDialogueText(e);
    if (!dlg) return round1(raw);
    return round1(Math.max(raw, minDramaTimelineDialogueSpanSec(dlg)));
  });

  let t = 0;
  const packed = list.map((e, i) => {
    const start = round1(t);
    const end = round1(t + spans[i]);
    t = end;
    return createEmptyDramaTimelineEvent({ ...e, start_sec: start, end_sec: end });
  });

  const needed = packed[packed.length - 1].end_sec;
  const dur = round1(Math.max(requested, needed));
  const extra = round1(dur - needed);
  if (extra <= 0.05) return packed;

  let absorb = packed.length - 1;
  for (let i = packed.length - 1; i >= 0; i -= 1) {
    if (!timelineEventDialogueText(packed[i])) {
      absorb = i;
      break;
    }
  }
  packed[absorb] = createEmptyDramaTimelineEvent({
    ...packed[absorb],
    end_sec: round1(packed[absorb].end_sec + extra),
  });
  for (let i = absorb + 1; i < packed.length; i += 1) {
    packed[i] = createEmptyDramaTimelineEvent({
      ...packed[i],
      start_sec: round1(packed[i].start_sec + extra),
      end_sec: round1(packed[i].end_sec + extra),
    });
  }
  return packed;
}

/** 用户改本镜时长：按目标秒数等比缩放（可缩短），再对白保底。 */
export function rescaleDramaTimelineEventsToDuration(
  events: DramaTimelineEvent[] | undefined | null,
  fromSec: number,
  toSec: number,
): DramaTimelineEvent[] {
  const requested = Math.max(0.1, Number(toSec) || 0.1);
  const list = Array.isArray(events) ? events : [];
  if (!list.length) return [];
  const lastEnd = Math.max(0, ...list.map((e) => Number(e.end_sec) || 0));
  const prev = Math.max(0.1, Number(fromSec) || lastEnd || requested);
  const scaled =
    Math.abs(prev - requested) < 1e-6
      ? list
      : list.map((e) =>
          createEmptyDramaTimelineEvent({
            ...e,
            start_sec: round1((Number(e.start_sec) || 0) * (requested / prev)),
            end_sec: round1((Number(e.end_sec) || 0) * (requested / prev)),
          }),
        );
  // 对白保底可能抬高总时长；不得把「当前轴尾」当成不可缩短下限
  return normalizeDramaTimelineEvents(scaled, requested);
}

/**
 * 按总时长「百分比」纯等比缩放切段：边界位置 = 原占比 × 新总长。
 * 不对白保底抬高总长，保证换档后分界线相对位置不变。
 */
export function rescaleDramaTimelineEventsByPercent(
  events: DramaTimelineEvent[] | undefined | null,
  fromSec: number,
  toSec: number,
): DramaTimelineEvent[] {
  const requested = Math.max(0.1, Number(toSec) || 0.1);
  const list = (Array.isArray(events) ? events : [])
    .map((e) => createEmptyDramaTimelineEvent(e))
    .filter((e) => e.end_sec > e.start_sec)
    .sort((a, b) => a.start_sec - b.start_sec || a.end_sec - b.end_sec);
  if (!list.length) return [];
  const lastEnd = Math.max(0, ...list.map((e) => Number(e.end_sec) || 0));
  const prev = Math.max(0.1, Number(fromSec) || lastEnd || requested);
  if (Math.abs(prev - requested) < 1e-6) {
    const locked = list.map((e) => createEmptyDramaTimelineEvent(e));
    locked[0] = createEmptyDramaTimelineEvent({ ...locked[0], start_sec: 0 });
    locked[locked.length - 1] = createEmptyDramaTimelineEvent({
      ...locked[locked.length - 1],
      end_sec: round1(requested),
    });
    return locked;
  }
  const scaled = list.map((e) => {
    const start = round1(Math.min(requested, Math.max(0, (Number(e.start_sec) || 0) * (requested / prev))));
    let end = round1(Math.min(requested, Math.max(0, (Number(e.end_sec) || 0) * (requested / prev))));
    if (end <= start) end = round1(Math.min(requested, start + MIN_EVENT_SEC));
    return createEmptyDramaTimelineEvent({ ...e, start_sec: start, end_sec: end });
  });
  scaled[0] = createEmptyDramaTimelineEvent({ ...scaled[0], start_sec: 0 });
  scaled[scaled.length - 1] = createEmptyDramaTimelineEvent({
    ...scaled[scaled.length - 1],
    end_sec: round1(requested),
  });
  // 消除因 round 产生的缝隙/重叠，保持占比顺序
  for (let i = 0; i < scaled.length - 1; i += 1) {
    const seam = round1(scaled[i].end_sec);
    scaled[i] = createEmptyDramaTimelineEvent({ ...scaled[i], end_sec: seam });
    scaled[i + 1] = createEmptyDramaTimelineEvent({
      ...scaled[i + 1],
      start_sec: seam,
    });
  }
  scaled[scaled.length - 1] = createEmptyDramaTimelineEvent({
    ...scaled[scaled.length - 1],
    end_sec: round1(requested),
  });
  return scaled;
}

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

/** 切段后若表演句拆不开：曾用景别/站位前缀分化（已停用，导演权交给 Skill）。 */
const TIMELINE_CUT_CYCLE: Array<{ cam: string; prefix: string; focus: string }> = [
  { cam: '全景｜平视｜固定｜35mm｜三分法', prefix: '全景交代人物与环境位置', focus: '空间与站位' },
  { cam: '中景｜平视｜缓慢推入｜35mm｜三分法', prefix: '中景看肢体与站位', focus: '上半身与手部' },
  { cam: '近景｜平视｜固定｜50mm｜居中', prefix: '近景看面部与眼神', focus: '面部与眼神' },
];

const AI_COVERAGE_CAM_SET = new Set(TIMELINE_CUT_CYCLE.map((c) => c.cam));

function stripCutPrefix(text: string): string {
  return stripDramaDirectorLensTags(
    String(text || '')
      .replace(/^【[^】]{1,24}】\s*/, '')
      .trim(),
  );
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

/**
 * 连续多段 visual 去重：不再注入景别/站位导演词（非小说原文）。
 * 仅剥离历史污染；导演景别/运镜/站位规划交给后续 MiniMax H3 Skill。
 */
export function differentiateDuplicateTimelineCuts(
  events: DramaTimelineEvent[] | undefined | null,
): DramaTimelineEvent[] {
  const list = Array.isArray(events) ? events.map((e) => ({ ...e })) : [];
  for (const ev of list) {
    const cleaned = stripDramaDirectorLensTags(String(ev.visual_action || ''));
    if (cleaned !== ev.visual_action) ev.visual_action = cleaned;
    const cam = String(ev.camera_action || '').trim();
    if (AI_COVERAGE_CAM_SET.has(cam) || /全景｜平视｜固定｜35mm｜三分法|中景｜平视｜缓慢推入｜35mm｜三分法|近景｜平视｜固定｜50mm｜居中/.test(cam)) {
      ev.camera_action = '';
    }
  }
  return list;
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
    // 切段仅拆正文，不再写入景别/站位前缀；导演语言交给 Skill
    left.visual_action = stripCutPrefix(left.visual_action || ev.visual_action);
    right.visual_action = stripCutPrefix(right.visual_action || ev.visual_action);
  }
  return normalizeDramaTimelineEvents(
    differentiateDuplicateTimelineCuts([...list.slice(0, idx), left, right, ...list.slice(idx + 1)]),
    dur,
  );
}

/**
 * 拖动第 afterIndex 段右边界（与下一段共享）。
 * 首尾锁在 0 与 duration，不能改本镜总时长；左右都能拉。
 * 不走对白保底铺开，否则长对白段无法缩短、总时长还会被抬高。
 */
export function setDramaTimelineBoundarySec(
  events: DramaTimelineEvent[] | undefined | null,
  afterIndex: number,
  nextEndSec: number,
  durationSec: number,
): DramaTimelineEvent[] {
  const dur = Math.max(0.1, Number(durationSec) || 0.1);
  const list = (Array.isArray(events) ? events : [])
    .map((e) => createEmptyDramaTimelineEvent(e))
    .filter((e) => e.end_sec > e.start_sec)
    .sort((a, b) => a.start_sec - b.start_sec || a.end_sec - b.end_sec);
  if (afterIndex < 0 || afterIndex >= list.length - 1) return list;
  if (list.length) {
    list[0] = createEmptyDramaTimelineEvent({ ...list[0], start_sec: 0 });
    list[list.length - 1] = createEmptyDramaTimelineEvent({
      ...list[list.length - 1],
      end_sec: round1(dur),
    });
  }
  const left = list[afterIndex];
  const right = list[afterIndex + 1];
  const minT = round1(left.start_sec + MIN_EVENT_SEC);
  const maxT = round1(right.end_sec - MIN_EVENT_SEC);
  if (maxT <= minT) return list;
  const t = round1(Math.min(Math.max(Number(nextEndSec) || 0, minT), maxT));
  return list.map((e, i) => {
    if (i === afterIndex) return createEmptyDramaTimelineEvent({ ...e, end_sec: t });
    if (i === afterIndex + 1) return createEmptyDramaTimelineEvent({ ...e, start_sec: t });
    return e;
  });
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

const INVENTED_EXPRESSION_RE = /神情克制|目光深邃|表情复杂|目光直接|目光朝向对方/;
const ENV_AUDIO_RE =
  /雷声|远雷|雨声|雨点|键盘声|鼠标声|汽水气泡|气泡声|汽水嗝|风扇|底噪|电流声|环境底噪|提示音/;
const VISUAL_HINT_RE =
  /闪电|白光|屏幕|击中|画面|切黑|黑屏|黑场|睁|坐|站|走|掏|拿|掐|摸|喝|灌|打哈欠|放下|进入|抬|回头/;

function stripDramaSpeakerPrefix(text: string): { speaker: string; body: string } {
  const t = String(text || '').trim();
  if (!t) return { speaker: '', body: '' };
  const m = t.match(/^(?:【[^】]+】\s*)?([^\n：:]{1,24})[：:]\s*([\s\S]+)$/);
  if (m) return { speaker: m[1].trim(), body: m[2].trim() };
  const sys = t.match(
    /^(?:【[^】]+】\s*)?(系统提示音|系统声音|系统提示|系统播报|系统音|系统|SYSTEM|System|机械声音|电子声音|机械提示音|机械女声)[。.:：]\s*([\s\S]+)$/i,
  );
  if (sys) return { speaker: sys[1].trim(), body: sys[2].trim() };
  const guide = t.match(/^新手引导\s*[：:]\s*([\s\S]+)$/);
  if (guide) return { speaker: '系统', body: guide[1].trim() };
  return { speaker: '', body: t };
}

function splitVisualAndEnvironment(text: string): { visual: string; env: string[] } {
  const chunks = String(text || '')
    .split(/[\n；;]+/)
    .flatMap((s) => s.split(/[，,、]/))
    .map((s) => s.replace(/[。！？]+$/g, '').trim())
    .filter(Boolean);
  const visual: string[] = [];
  const env: string[] = [];
  for (const chunk of chunks) {
    const hasEnv = ENV_AUDIO_RE.test(chunk);
    const hasVisual = VISUAL_HINT_RE.test(chunk);
    if (hasEnv && !hasVisual) env.push(chunk);
    else if (hasEnv && hasVisual) {
      const envBit = chunk.match(/[^，。]*?(?:雷声|远雷|气泡声|键盘声|鼠标声|底噪)[^，。]*/)?.[0]?.trim();
      const visBit = chunk
        .replace(/[^，。]*?(?:雷声|远雷|气泡声|键盘声|鼠标声|底噪)[^，。]*/g, '')
        .replace(/^[，,\s]+|[，,\s]+$/g, '')
        .trim();
      if (envBit) env.push(envBit);
      if (visBit) visual.push(visBit);
    } else {
      visual.push(chunk);
    }
  }
  return { visual: visual.join('，'), env };
}

function isSpeakerLabelOnly(text: string, who: string): boolean {
  const t = String(text || '')
    .replace(/[。．.\s：:]+/g, '')
    .replace(/^[（(]+|[）)]+$/g, '')
    .trim();
  const w = String(who || '').replace(/\s/g, '');
  return !!w && !!t && t === w;
}

function stripParenExpression(text: string): string {
  return String(text || '')
    .replace(/^[（(]+|[）)]+$/g, '')
    .trim();
}

function isAbstractPerformanceBody(text: string): boolean {
  const t = stripParenExpression(text)
    .replace(/[。．.!！?？]+$/g, '')
    .trim();
  if (!t) return true;
  if (/机械女声|脑海中响起|内心OS/.test(t) && t.length <= 24) return true;
  return /^(?:紧张|压抑|愤怒|悲伤|恐惧|疑惑|冷漠|震惊|释然|克制|沉默|开心|兴奋|绝望|孤独|疲惫|困倦|轻松|慵懒|机械|懵逼|无奈|困惑|迷茫|失落|决心|怀疑|专注|确认|平静|低声)(?:[、，,].*)?$/.test(
    t,
  );
}

/** 表演指示只有短表情/语气时并进上一拍，不单独占时间窗。 */
function performanceBodyIsOwnBeat(text: string): boolean {
  const t = stripParenExpression(text).trim();
  if (!t || isAbstractPerformanceBody(t)) return false;
  if (VISUAL_HINT_RE.test(t) || /汽水嗝|掐|摸脸/.test(t)) return true;
  return t.length > 12;
}

function originalExpressionOf(ve: DramaVisualEvent, seg?: DramaOriginalSegment): string {
  const raw = String(ve.expression || seg?.performance || '').trim();
  if (!raw || INVENTED_EXPRESSION_RE.test(raw)) return '';
  return stripParenExpression(raw);
}

function estimateVisualEventSec(ve: DramaVisualEvent, seg?: DramaOriginalSegment): number {
  const type = seg?.type || (ve.kind === 'dialogue' ? 'dialogue' : 'action');
  const text = String(ve.original_text || ve.action || '').trim();
  return Math.max(
    0.4,
    estimateDramaFastPaceSegment({
      type,
      text,
      parenthetical: ve.expression,
    }).estSec,
  );
}

function resolveSourceSegment(
  segments: DramaOriginalSegment[],
  ve: DramaVisualEvent,
): DramaOriginalSegment | undefined {
  for (const id of ve.source_segment_ids || []) {
    const hit = segments.find((s) => s.segment_id === id);
    if (hit) return hit;
  }
  return undefined;
}

function mapOneVisualEventToTimeline(
  ve: DramaVisualEvent,
  session: DramaDirectorSession,
  startSec: number,
): DramaTimelineEvent {
  const bible = getActiveEpisodeBible(session);
  const seg = resolveSourceSegment(bible.original_segments || [], ve);
  let who = String(ve.who || seg?.character_name || '').trim();
  const sourceText = String(ve.original_text || ve.action || '').trim();
  const segLooksTalk =
    seg?.type === 'dialogue' ||
    seg?.type === 'system' ||
    seg?.type === 'narration' ||
    ve.kind === 'dialogue';
  if (!segLooksTalk) {
    const catalog = (session.bible?.characters || [])
      .map((c) => String(c.name || '').trim())
      .filter(Boolean);
    const subject = resolveDramaActionSubjectName(
      String(ve.action || '').trim() || sourceText,
      catalog,
    );
    if (subject) who = subject;
  }
  const stripped = stripDramaSpeakerPrefix(sourceText);
  const sourceLooksSystem =
    looksLikeDramaSystemSpokenText(sourceText) ||
    looksLikeDramaInMindSystemVoice(sourceText) ||
    looksLikeDramaSystemSpokenText(stripped.body) ||
    looksLikeDramaInMindSystemVoice(stripped.body) ||
    looksLikeDramaSystemSpokenText(String(ve.action || '').trim()) ||
    isDramaSystemSpeechSpeaker(stripped.speaker);
  const transition =
    seg?.type === 'transition' ||
    ve.kind === 'transition' ||
    isDramaSceneTransitionText(sourceText) ||
    isDramaSceneTransitionText(stripped.speaker);
  const screenText =
    !transition &&
    (seg?.type === 'screen_text' ||
      ve.cut === 'text' ||
      isDramaScreenTextVisual(sourceText) ||
      isDramaScreenTextVisual(String(ve.action || '').trim()));
  const narration =
    !transition &&
    !screenText &&
    (seg?.type === 'narration' ||
      ve.cut === 'narration' ||
      isDramaNarrationVisual(sourceText) ||
      isDramaNarrationVisual(String(ve.action || '').trim()) ||
      (isDramaSystemSpeechSpeaker(stripped.speaker) && /旁白|画外音/.test(stripped.speaker)));
  const innerOs =
    !transition &&
    !screenText &&
    (isDramaInnerOsCue(seg?.performance || '') ||
      isDramaInnerOsCue(ve.expression) ||
      isDramaInnerOsCue(sourceText));
  const system =
    !transition &&
    !screenText &&
    (seg?.speaker_type === 'system' ||
      seg?.type === 'system' ||
      narration ||
      isDramaSystemTimelineSpeaker(who, who) ||
      sourceLooksSystem);
  const talk =
    !transition &&
    !screenText &&
    !innerOs &&
    (ve.kind === 'dialogue' ||
      seg?.type === 'dialogue' ||
      seg?.type === 'system' ||
      seg?.type === 'narration' ||
      sourceLooksSystem);
  let dialogue = '';
  let visual_action = '';
  let environment_audio: string[] = [];
  const expression = pickVisibleDramaExpression(originalExpressionOf(ve, seg), ve.emotion);
  const isReaction = seg?.type === 'performance_direction' || ve.kind === 'reaction';
  if (transition) {
    dialogue = '';
    visual_action = isPlaceholderDramaVisualAction(sourceText)
      ? ''
      : tidyDramaTimelineVisualAction(sourceText);
  } else if (screenText) {
    dialogue = '';
    visual_action = isPlaceholderDramaVisualAction(sourceText)
      ? ''
      : tidyDramaTimelineVisualAction(sourceText);
  } else if (narration) {
    visual_action = '';
    dialogue = stripDramaNarrationLabel(stripped.body || sourceText);
  } else if (innerOs && !sourceLooksSystem) {
    dialogue = '';
    visual_action = stripDramaInnerOsFromVisual(
      tidyDramaTimelineVisualAction(stripped.body || sourceText),
    );
  } else if (isReaction && !sourceLooksSystem) {
    dialogue = '';
    const body = tidyDramaTimelineVisualAction(stripped.body || sourceText);
    if (performanceBodyIsOwnBeat(body) && !isSpeakerLabelOnly(body, who)) {
      visual_action = body;
    } else {
      visual_action = '';
    }
  } else if (talk || system) {
    const castNames = (session.bible?.characters || [])
      .map((c) => String(c.name || '').trim())
      .filter(Boolean);
    const rawDlg = stripped.body || sourceText;
    dialogue = system
      ? stripDramaNarrationLabel(stripDramaSystemSpokenLabel(rawDlg))
      : stripDramaSpokenLineBody(rawDlg, castNames);
    if (/^【/.test(dialogue) && /叮——|激活完毕/.test(dialogue)) {
      const body = dialogue.replace(/^【[^】]+】\s*/g, '').trim();
      if (body) dialogue = body;
    }
    const ownVisual = tidyDramaTimelineVisualAction(String(ve.action || '').trim());
    if (
      ownVisual &&
      !looksLikeDramaSystemSpokenText(ownVisual) &&
      !isDramaScreenTextVisual(ownVisual) &&
      !isDramaNarrationVisual(ownVisual)
    ) {
      visual_action = ownVisual;
    } else if (system) {
      visual_action = ensureDramaSystemHologramVisual('', true);
    }
  } else if (!isSpeakerLabelOnly(sourceText, who) && !isSpeakerLabelOnly(ve.action || '', who)) {
    const split = splitVisualAndEnvironment(String(ve.action || sourceText).trim());
    visual_action = tidyDramaTimelineVisualAction(split.visual);
    environment_audio = split.env;
    if (isSpeakerLabelOnly(visual_action, who)) visual_action = '';
    if (visual_action && expression && stripParenExpression(visual_action) === expression) {
      visual_action = '';
    }
    if (looksLikeDramaSystemSpokenText(visual_action)) {
      const peeled = stripDramaSpeakerPrefix(visual_action);
      dialogue = peeled.body || visual_action;
      visual_action = '';
    }
  }
  const whoWarnings: string[] = [];
  const fromWho = resolveDramaWhoToCharacterIds(
    who,
    session.bible?.characters || [],
    whoWarnings,
    ve.event_id || 'VE',
  );
  let dialogue_character_id = '';
  let character_ids: string[] = [];
  const asSystem =
    system || looksLikeDramaSystemSpokenText(dialogue) || looksLikeDramaInMindSystemVoice(dialogue);
  if (asSystem) {
    dialogue_character_id = dialogue ? DRAMA_SYSTEM_SPEAKER_ID : '';
    character_ids = sanitizeDramaCharacterIds(fromWho);
  } else if (dialogue) {
    // Dialogue：ve.who（→ fromWho / 姓名解析）为说话人唯一 SoT；
    // 禁止 segment.character_id 覆盖（segment 常绑错镜/错人）。
    const fromName = resolveDramaCharacterIdByName(session.bible?.characters || [], who);
    const cid = String(fromWho[0] || fromName || '').trim();
    dialogue_character_id = cid;
    character_ids = sanitizeDramaCharacterIds(cid ? [cid, ...fromWho] : fromWho);
  } else {
    // 动作/反应段：who 解析优先；禁止错误的 segment.character_id 盖住动作主语
    const cid = String(seg?.character_id || '').trim();
    character_ids = sanitizeDramaCharacterIds(fromWho.length ? fromWho : cid ? [cid] : []);
  }
  const sceneNames = [
    ...(session.bible?.scenes || []).flatMap((s) => [s.name, s.location]),
    ...(bible.original_scenes || []).map((s) => s.location),
  ]
    .map((s) => String(s || '').trim())
    .filter(Boolean);
  const eyelineRaw =
    asSystem || screenText || narration || innerOs
      ? ''
      : mapDramaSeeToEyeline(
          String(ve.see || '').trim(),
          session.bible?.characters || [],
          sourceText,
          sceneNames,
        );
  const eyeline = isNonVisualDramaEyeline(eyelineRaw, sceneNames) ? '' : eyelineRaw;
  let character_state = formatDramaEmotionAsCharacterState(ve.emotion);
  if (stripDramaDirectorLensTags(character_state) === '' && /镜头/.test(character_state)) {
    character_state = '';
  }
  const position = String(ve.position || '').trim();
  const span = estimateVisualEventSec(ve, seg);
  if ((asSystem || narration) && dialogue) {
    dialogue = stripDramaNarrationLabel(stripDramaSystemSpokenLabel(dialogue));
  }
  // 专段弹幕/屏字保留进 TE；其余走 clean（scrub 混入动作句的弹幕飞滚等）
  if (!screenText && !isDramaScreenTextVisual(visual_action)) {
    visual_action = cleanDramaMappedVisualAction(visual_action);
  }
  if (asSystem && dialogue) {
    visual_action = ensureDramaSystemHologramVisual(visual_action, true);
  }
  void whoWarnings;
  return createEmptyDramaTimelineEvent({
    start_sec: startSec,
    end_sec: startSec + span,
    character_ids,
    visual_action,
    expression,
    character_state,
    position,
    eyeline,
    dialogue,
    dialogue_character_id,
    environment_audio,
    lip_sync: !!(dialogue && dialogue_character_id && !asSystem),
    camera_action: '',
  });
}

/** 每个 Visual Event → 一条 DramaTimelineEvent；不压缩、不发明运镜/剧情 */
export function buildTimelineEventsFromVisualEvents(
  session: DramaDirectorSession,
  shot: Partial<DramaShot>,
): DramaTimelineEvent[] {
  const ids = (shot.visual_event_ids || []).map((id) => String(id || '').trim()).filter(Boolean);
  if (!ids.length) return [];
  const bible = getActiveEpisodeBible(session);
  const ves = ids
    .map((id) => (bible.visual_events || []).find((e) => e.event_id === id))
    .filter((e): e is DramaVisualEvent => !!e);
  if (!ves.length) return [];
  const events: DramaTimelineEvent[] = [];
  let t = 0;
  for (const ve of ves) {
    const ev = mapOneVisualEventToTimeline(ve, session, t);
    if (
      isSpeakerLabelOnly(ev.visual_action, String(ve.who || '').trim()) &&
      !ev.dialogue &&
      !(ev.environment_audio || []).length &&
      !ev.expression
    ) {
      continue;
    }
    if (isPlaceholderDramaVisualAction(ev.visual_action) && !dramaTimelineEventHasContent({
      ...ev,
      visual_action: '',
    })) {
      continue;
    }
    if (!dramaTimelineEventHasContent(ev)) {
      if (events.length) {
        events[events.length - 1] = fillEmptyDramaTimelineEventFields(events[events.length - 1], ev);
      }
      continue;
    }
    events.push(ev);
    t = ev.end_sec;
  }
  const dur = Math.max(
    Number(shot.duration_sec) > 0 ? Number(shot.duration_sec) : 0,
    t,
    0.1,
  );
  return normalizeDramaTimelineEvents(events, dur);
}

function buildMinimalFallbackTimeline(durationSec: number): DramaTimelineEvent[] {
  const dur = Math.max(0.1, Number(durationSec) || 0.1);
  return [
    createEmptyDramaTimelineEvent({
      start_sec: 0,
      end_sec: dur,
      visual_action: '',
      camera_action: '',
      dialogue: '',
      dialogue_character_id: '',
      expression: '',
      environment_audio: [],
      lip_sync: false,
    }),
  ];
}

/** 展示用：从结构化事件压成一行自然语言（非真相源） */
export function formatDramaTimelineEventDisplay(ev: DramaTimelineEvent): string {
  const t0 = Number.isInteger(ev.start_sec) ? String(ev.start_sec) : ev.start_sec.toFixed(1);
  const t1 = Number.isInteger(ev.end_sec) ? String(ev.end_sec) : ev.end_sec.toFixed(1);
  const env =
    ev.environment_audio.length > 0
      ? `环境音：${ev.environment_audio.join('、')}`
      : '环境音：无';
  const dlgText = spokenTextFromDramaTimelineEvent(ev);
  const speaker = isDramaSystemVoiceId(ev.dialogue_character_id)
    ? DRAMA_SYSTEM_SPEAKER_ID
    : String(ev.dialogue_character_id || '').trim();
  const dlg = dlgText
    ? `说话人=${speaker || '未绑定'}：「${dlgText}」·口型开`
    : '无台词 · 口型关';
  // 不展示机位/运镜：源稿与 Skill brief 只保留动作/对白，机位由 Skill 补全
  return `${t0}–${t1}秒｜${env}｜${ev.visual_action || '动作未写'}｜${dlg}`;
}

/**
 * 确保 shot 带有 timeline_events。
 * 优先级：用户/已有有效轴 > Visual Event 映射 > 最小 fallback。
 * 禁止启发式重导演，禁止默认套电影运镜。
 */
export function ensureDramaShotTimelineEvents(
  shot: DramaShot,
  session?: DramaDirectorSession | null,
  opts?: { preserveTiming?: boolean },
): DramaShot {
  const existing = Array.isArray(shot.timeline_events) ? shot.timeline_events : [];
  let timeline_events: DramaTimelineEvent[];
  let dur = Number(shot.duration_sec) > 0 ? Number(shot.duration_sec) : 0;

  if (existing.length && !isDramaTimelineEventsThin(existing)) {
    const last = Math.max(0, ...existing.map((e) => Number(e.end_sec) || 0));
    if (opts?.preserveTiming) {
      dur = Number(shot.duration_sec) > 0 ? Number(shot.duration_sec) : Math.max(0.1, last || 0.1);
      timeline_events = hydrateDramaTimelineEventsDialogue(
        differentiateDuplicateTimelineCuts(existing),
        '',
      ).map((e, i, arr) => {
        const start = i === 0 ? 0 : Math.max(0, Number(e.start_sec) || 0);
        const end =
          i === arr.length - 1
            ? dur
            : Math.min(dur, Math.max(start + MIN_EVENT_SEC, Number(e.end_sec) || 0));
        return {
          ...e,
          start_sec: round1(start),
          end_sec: round1(end),
          character_ids: sanitizeDramaCharacterIds(e.character_ids),
        };
      });
    } else {
      dur = Math.max(dur || 0.1, last || 0.1);
      timeline_events = hydrateDramaTimelineEventsDialogue(
        differentiateDuplicateTimelineCuts(normalizeDramaTimelineEvents(existing, dur)),
        '',
      ).map((e) => ({
        ...e,
        character_ids: sanitizeDramaCharacterIds(e.character_ids),
      }));
      const after = Math.max(0, ...timeline_events.map((e) => Number(e.end_sec) || 0));
      dur = Math.max(dur, after || 0.1);
    }
  } else {
    const fromVe =
      session && (shot.visual_event_ids || []).length
        ? buildTimelineEventsFromVisualEvents(session, shot)
        : [];
    if (fromVe.length) {
      const last = Math.max(0, ...fromVe.map((e) => Number(e.end_sec) || 0));
      dur = Math.max(dur || 0.1, last || 0.1);
      timeline_events = hydrateDramaTimelineEventsDialogue(
        differentiateDuplicateTimelineCuts(normalizeDramaTimelineEvents(fromVe, dur)),
        '',
      ).map((e) => ({
        ...e,
        character_ids: sanitizeDramaCharacterIds(e.character_ids),
      }));
      const after = Math.max(0, ...timeline_events.map((e) => Number(e.end_sec) || 0));
      dur = Math.max(dur, after || 0.1);
    } else {
      dur = dur || 10;
      timeline_events = buildMinimalFallbackTimeline(dur);
    }
  }

  const fromCuts = dialogueLinesFromTimelineEvents(timeline_events);
  const hasShotDlg = (shot.dialogue || []).some((d) => String(d?.text || '').trim());

  // 注意：DRAMA_TIMELINE_SPLIT_DISABLED 只作用彩条 UI 写回，不在 ensure/compose 路径压段，
  // 避免源提示词/Skill 入参被整镜糊成单段。
  const nextEvents = timeline_events;
  const nextDur = dur;

  const timeline_beats: DramaShotTimelineBeat[] = nextEvents.map((e) => ({
    start_sec: e.start_sec,
    end_sec: e.end_sec,
    text: formatDramaTimelineEventDisplay(e),
    kind: e.lip_sync || e.dialogue ? 'dialogue' : e.environment_audio.length ? 'sfx' : 'action',
  }));

  return {
    ...shot,
    duration_sec: nextDur,
    timeline_events: nextEvents,
    timeline_beats,
    ...(fromCuts.length && !hasShotDlg ? { dialogue: fromCuts } : {}),
  };
}

/** 验收：从执行表时间轴能否明确回答关键问题（缺则列出） */
export function auditDramaTimelineEventsAnswerability(shot: DramaShot): {
  ok: boolean;
  answered: string[];
  missing: string[];
} {
  const events = shot.timeline_events || [];
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
  else answered.push('机位/运镜：未写（保持为空）');

  if (!String(shot.scene_asset_id || '').trim()) {
    missing.push('场景绑定 scene_asset_id');
  } else {
    answered.push(`场景：${shot.scene_asset_id}`);
  }

  return { ok: missing.length === 0, answered, missing };
}
