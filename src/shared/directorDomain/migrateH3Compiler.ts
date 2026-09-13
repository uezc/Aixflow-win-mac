/**
 * H3 Compiler v1 读盘派生：speaker_id / audio_timeline / lock_intent。
 * 幂等；不删除 final_prompt；不改对白文本与起止秒。
 */

import { dramaNewId } from './ids.js';
import { isSystemSpeakerName, looksLikeDramaSystemSpokenText } from './extractCastFromScript.js';
import {
  inferDramaTimelineDialogueSpeakerId,
  spokenTextFromDramaTimelineEvent,
} from './timelineEvent.js';
import type {
  DramaAudioEvent,
  DramaDialogueLine,
  DramaDirectorSession,
  DramaReferenceLockIntent,
  DramaSpeakerId,
} from './types.js';

/** 非人物说话者（系统/旁白/画外音）的固定 speaker 槽位，不抢角色音色 */
const SYSTEM_SPEAKER_POOL = ['S99', 'S98', 'S97', 'S96'] as const;
function systemSpeakerForName(name: string): DramaSpeakerId {
  const n = String(name || '').trim().toLowerCase();
  if (/旁白|叙述|旁述/.test(n)) return SYSTEM_SPEAKER_POOL[0] as DramaSpeakerId;
  if (/画外|os|内心|独白/.test(n)) return SYSTEM_SPEAKER_POOL[1] as DramaSpeakerId;
  if (/系统|电子|机械|播报|广播|滴|提示音/.test(n)) return SYSTEM_SPEAKER_POOL[2] as DramaSpeakerId;
  if (/弹幕|字幕|小字|公屏|评论/.test(n)) return SYSTEM_SPEAKER_POOL[3] as DramaSpeakerId;
  return SYSTEM_SPEAKER_POOL[2] as DramaSpeakerId;
}

export const DRAMA_H3_COMPILER_CONTRACT = 'h3-compiler.v1';

export interface DramaH3CompilerMigrationReport {
  speakers_assigned: number;
  audio_events_derived: number;
  lock_intents_filled: number;
  legacy_final_prompt_kept: number;
}

const SPEAKER_RE = /^S\d+$/;

export function isDramaSpeakerId(raw: unknown): raw is DramaSpeakerId {
  return SPEAKER_RE.test(String(raw || '').trim());
}

export function formatDramaSpeakerId(n: number): DramaSpeakerId {
  return `S${Math.max(1, Math.floor(n))}` as DramaSpeakerId;
}

export function defaultDramaReferenceLockIntent(role: string): DramaReferenceLockIntent {
  const r = String(role || '').trim();
  if (r === 'storyboard') return 'visual_anchor';
  if (r === 'scene' || r === 'style') return 'visual_anchor';
  return 'identity';
}

export function speakerIdForCharacter(
  session: DramaDirectorSession,
  characterId: string,
): DramaSpeakerId | '' {
  const ch = (session.bible?.characters || []).find((c) => c.character_id === characterId);
  // 角色是系统/旁白类（名字在 STOP_NAMES 里）→ 返回固定特殊 speaker，不抢真实角色音色
  if (ch && isSystemSpeakerName(ch.name)) {
    return systemSpeakerForName(ch.name);
  }
  if (ch && isDramaSpeakerId(ch.speaker_id)) return ch.speaker_id;
  // character_id 本身暗示是系统旁白（如 narrator/system）
  const cid = String(characterId || '').toLowerCase();
  if (/narrator|system|旁白|画外|system_speaker/.test(cid)) {
    return systemSpeakerForName(cid);
  }
  return '';
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function audioOverlaps(a0: number, a1: number, b0: number, b1: number): boolean {
  return a0 < b1 - 1e-6 && b0 < a1 - 1e-6;
}

function audioFactKey(a: { character_id?: string; text?: string }): string {
  return `${String(a.character_id || '').trim()}|${String(a.text || '').trim()}`;
}

/** 对白时长：约 4 字/秒 + 气口（仅用于把 shot.dialogue 映到时间窗） */
function estimateLineSeconds(text: string): number {
  const chars = String(text || '').replace(/\s+/g, '').length;
  if (!chars) return 0;
  return Math.max(1.2, chars / 4 + 0.4);
}

export function clipDramaAudioEventToRange(
  ev: DramaAudioEvent,
  startSec: number,
  endSec: number,
): DramaAudioEvent | null {
  const a0 = Number(ev.start_sec) || 0;
  const a1 = Number(ev.end_sec) || a0;
  const b0 = Number(startSec) || 0;
  const b1 = Number(endSec) || b0;
  if (!audioOverlaps(a0, a1, b0, b1)) return null;
  const start = round1(Math.max(a0, b0));
  const end = round1(Math.min(a1, b1));
  if (end <= start) return null;
  return { ...ev, start_sec: start, end_sec: end };
}

export function clipDramaAudioEventsToRange(
  events: DramaAudioEvent[],
  startSec: number,
  endSec: number,
): DramaAudioEvent[] {
  return (events || [])
    .map((e) => clipDramaAudioEventToRange(e, startSec, endSec))
    .filter(Boolean) as DramaAudioEvent[];
}

function resolveDialogueSpeakerId(
  session: DramaDirectorSession,
  shot: { character_ids?: string[] },
  line: DramaDialogueLine,
): string {
  const cid = String(line.character_id || '').trim();
  const name = String(line.character_name || '').trim();
  const text = String(line.text || '').trim();
  if (isSystemSpeakerName(cid) || isSystemSpeakerName(name) || /^(?:system|narrator)$/i.test(cid)) {
    return 'system';
  }
  if (looksLikeDramaSystemSpokenText(text)) return 'system';
  if (cid) return cid;
  if (name) {
    const hit = (session.bible?.characters || []).find(
      (c) => String(c.name || '').trim() === name || String(c.character_id || '').trim() === name,
    );
    if (hit?.character_id && !isSystemSpeakerName(hit.name)) return String(hit.character_id).trim();
  }
  return '';
}

function deriveFromShotDialogueLines(
  session: DramaDirectorSession,
  shot: {
    duration_sec?: number;
    character_ids?: string[];
    dialogue?: DramaDialogueLine[];
    timeline_events?: Array<{
      start_sec?: number;
      end_sec?: number;
      character_ids?: string[];
      dialogue?: string;
    }>;
  },
): DramaAudioEvent[] {
  const lines = (shot.dialogue || [])
    .map((d) => ({
      ...d,
      character_id: resolveDialogueSpeakerId(session, shot, d),
    }))
    .filter((d) => String(d.text || '').trim() && String(d.character_id || '').trim());
  if (!lines.length) return [];
  const events = Array.isArray(shot.timeline_events) ? shot.timeline_events : [];
  const dur = Math.max(0.5, Number(shot.duration_sec) || 10);
  const out: DramaAudioEvent[] = [];
  const used = new Set<number>();
  for (const line of lines) {
    const text = String(line.text || '').trim();
    const cid = String(line.character_id || '').trim();
    const host = events.findIndex((ev, i) => {
      if (used.has(i)) return false;
      const dlg = String(ev.dialogue || '').trim();
      if (dlg && dlg !== text) return false;
      const ids = ev.character_ids || [];
      return !ids.length || ids.includes(cid);
    });
    let start: number;
    let end: number;
    if (host >= 0) {
      used.add(host);
      const ev = events[host];
      start = Number(ev.start_sec) || 0;
      end = Number(ev.end_sec) || start;
      const need = estimateLineSeconds(text);
      if (end - start > need + 0.8) {
        start = round1(Math.max(start, end - need - 0.4));
      }
    } else {
      const prevEnd = out.length ? out[out.length - 1].end_sec : Math.max(0, dur * 0.25);
      start = round1(prevEnd);
      end = round1(Math.min(dur, start + estimateLineSeconds(text)));
      if (end <= start) continue;
    }
    out.push({
      event_id: String(line.dialogue_id || '').trim()
        ? `aud-${line.dialogue_id}`
        : dramaNewId('aud'),
      start_sec: start,
      end_sec: end > start ? end : round1(start + 0.1),
      speaker_id: speakerIdForCharacter(session, cid) || formatDramaSpeakerId(out.length + 1),
      character_id: cid,
      text,
    });
  }
  return out;
}

export function deriveDramaAudioTimelineFromShotEvents(
  session: DramaDirectorSession,
  events: Array<{
    event_id?: string;
    start_sec?: number;
    end_sec?: number;
    dialogue?: string;
    dialogue_character_id?: string;
    character_ids?: string[];
    visual_action?: string;
    character_state?: string;
    lip_sync?: boolean;
  }>,
  fallbackCharacterId = '',
): DramaAudioEvent[] {
  const out: DramaAudioEvent[] = [];
  for (const ev of events || []) {
    const text = spokenTextFromDramaTimelineEvent(ev);
    const cid = inferDramaTimelineDialogueSpeakerId(ev, fallbackCharacterId);
    if (!text || !cid) continue;
    const speaker = speakerIdForCharacter(session, cid) || formatDramaSpeakerId(out.length + 1);
    const start = Number(ev.start_sec) || 0;
    const end = Number(ev.end_sec) || start;
    out.push({
      event_id: String(ev.event_id || '').trim()
        ? `aud-${ev.event_id}`
        : dramaNewId('aud'),
      start_sec: start,
      end_sec: end > start ? end : start + 0.1,
      speaker_id: speaker,
      character_id: cid,
      text,
      ...(String(ev.character_state || '').trim()
        ? { emotion: String(ev.character_state).trim() }
        : {}),
    });
  }
  return out;
}

function assignSpeakerIds(session: DramaDirectorSession): number {
  let n = 0;
  const used = new Set<string>();
  for (const c of session.bible.characters || []) {
    if (isDramaSpeakerId(c.speaker_id)) used.add(c.speaker_id);
  }
  let next = 1;
  const take = (): DramaSpeakerId => {
    while (used.has(formatDramaSpeakerId(next))) next += 1;
    const id = formatDramaSpeakerId(next);
    used.add(id);
    next += 1;
    return id;
  };
  for (const c of session.bible.characters || []) {
    if (isDramaSpeakerId(c.speaker_id)) continue;
    c.speaker_id = take();
    n += 1;
  }
  return n;
}

function fillLockIntents(session: DramaDirectorSession): number {
  let n = 0;
  const fill = (
    refs: Array<{ kind?: string; lock_intent?: DramaReferenceLockIntent }> | undefined,
    fallbackRole: string,
  ) => {
    for (const r of refs || []) {
      if (r.lock_intent) continue;
      const kind = String(r.kind || '').trim();
      const role =
        kind === 'master' || kind === 'main' ? fallbackRole : kind || fallbackRole;
      r.lock_intent = defaultDramaReferenceLockIntent(
        fallbackRole === 'character' || fallbackRole === 'scene' ? fallbackRole : role,
      );
      n += 1;
    }
  };
  for (const c of session.bible.characters || []) fill(c.reference_images, 'character');
  for (const s of session.bible.scenes || []) fill(s.reference_images, 'scene');
  for (const p of session.bible.props || []) fill(p.reference_images, 'prop');
  return n;
}

export function resolveDramaShotAudioTimeline(
  session: DramaDirectorSession,
  shot: {
    audio_timeline?: DramaAudioEvent[];
    timeline_events?: unknown[];
    dialogue?: DramaDialogueLine[];
    character_ids?: string[];
    duration_sec?: number;
  },
): DramaAudioEvent[] {
  const events = Array.isArray(shot.timeline_events)
    ? (shot.timeline_events as Array<{
        event_id?: string;
        start_sec?: number;
        end_sec?: number;
        dialogue?: string;
        dialogue_character_id?: string;
        character_ids?: string[];
        character_state?: string;
      }>)
    : [];
  const fromEvents = deriveDramaAudioTimelineFromShotEvents(session, events, '');
  const stored = (Array.isArray(shot.audio_timeline) ? shot.audio_timeline : []).filter(
    (a) => String(a?.text || '').trim() && String(a?.character_id || '').trim(),
  );
  const spanStart = events.length
    ? Math.min(...events.map((e) => Number(e.start_sec) || 0))
    : 0;
  const spanEnd = events.length
    ? Math.max(
        Number(shot.duration_sec) || 0,
        ...events.map((e) => Number(e.end_sec) || 0),
      )
    : Number(shot.duration_sec) || 0;
  const storedInSpan = stored.filter((a) =>
    audioOverlaps(Number(a.start_sec) || 0, Number(a.end_sec) || 0, spanStart, spanEnd),
  );

  const merged = new Map<string, DramaAudioEvent>();
  const take = (list: DramaAudioEvent[]) => {
    for (const a of list) {
      const key = audioFactKey(a);
      if (!key.endsWith('|') && !merged.has(key)) merged.set(key, a);
    }
  };
  // 时间窗对不上的旧 audio_timeline 视为过期，改用切段对白
  if (storedInSpan.length) take(storedInSpan);
  else if (fromEvents.length) take(fromEvents);
  else take(stored);
  take(fromEvents);
  if (!merged.size) {
    take(
      deriveFromShotDialogueLines(session, {
        duration_sec: shot.duration_sec,
        character_ids: shot.character_ids,
        dialogue: shot.dialogue,
        timeline_events: events,
      }),
    );
  }
  return [...merged.values()].sort((a, b) => a.start_sec - b.start_sec || a.end_sec - b.end_sec);
}

/** 本镜是否存在可开口的对白/歌唱事件（只认结构化时间轴，不认空环境音轨） */
export function dramaShotHasSpokenDialogue(shot: {
  audio_timeline?: DramaAudioEvent[];
  timeline_events?: unknown[];
  dialogue?: DramaDialogueLine[];
}): boolean {
  if ((shot.dialogue || []).some((d) => String(d?.text || '').trim())) return true;
  const events = Array.isArray(shot.timeline_events) ? shot.timeline_events : [];
  if (
    events.some(
      (e) =>
        typeof e === 'object' &&
        e &&
        !!spokenTextFromDramaTimelineEvent(e as { dialogue?: string; visual_action?: string }),
    )
  ) {
    return true;
  }
  if ((shot.audio_timeline || []).some((a) => String(a?.text || '').trim())) return true;
  return false;
}

/**
 * 纯派生，可重复执行。
 */
export function migrateDramaSessionToH3CompilerV1(
  session: DramaDirectorSession,
): { session: DramaDirectorSession; report: DramaH3CompilerMigrationReport } {
  const report: DramaH3CompilerMigrationReport = {
    speakers_assigned: 0,
    audio_events_derived: 0,
    lock_intents_filled: 0,
    legacy_final_prompt_kept: 0,
  };
  if (!session?.bible) return { session, report };

  report.speakers_assigned = assignSpeakerIds(session);
  report.lock_intents_filled = fillLockIntents(session);

  for (const shot of session.shots || []) {
    if (String(shot.final_prompt || '').trim()) report.legacy_final_prompt_kept += 1;
    if (!Array.isArray(shot.audio_timeline) || !shot.audio_timeline.length) {
      const derived = deriveDramaAudioTimelineFromShotEvents(
        session,
        shot.timeline_events || [],
        String((shot.character_ids || []).find(Boolean) || ''),
      );
      if (derived.length) {
        shot.audio_timeline = derived;
        report.audio_events_derived += derived.length;
      }
    }
  }

  return { session, report };
}
