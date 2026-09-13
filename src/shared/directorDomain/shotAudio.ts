/**
 * 短剧本镜声音：豆包 1.0 文本提示 + 角色参考音收集（最多 3 路）。
 */

import { isSystemSpeakerName } from './extractCastFromScript.js';
import { buildDramaShotVoiceBindingTable } from './voiceBinding.js';
import {
  isDramaNarratorVoiceId,
  isDramaSystemOnlyVoiceId,
  isDramaSystemVoiceId,
  resolveDramaVoiceRole,
} from './voiceEntity.js';
import type {
  DramaCharacter,
  DramaDirectorSession,
  DramaShot,
  DramaTimelineEvent,
  DramaVoice,
} from './types.js';

/** 与 AudioProvider Doubao 1.0 上限对齐 */
const DOUBAO_TEXT_PROMPT_MAX = 3000;

export type DramaShotVoiceRef = {
  character_id: string;
  character_name: string;
  voice_id: string;
  sample_url: string;
};

const SYSTEM_SPEAKER_ID_RE = /narrator|system|旁白|画外|system_speaker/;

function characterNameById(session: DramaDirectorSession, id: string): string {
  const cid = String(id || '').trim();
  if (!cid) return '';
  return String(
    (session.bible?.characters || []).find((c) => c.character_id === cid)?.name || '',
  ).trim();
}

function isSystemSpeakerId(id: string): boolean {
  return isDramaSystemVoiceId(id) || SYSTEM_SPEAKER_ID_RE.test(String(id || '').toLowerCase());
}

function collectDramaShotSpokenLines(
  session: DramaDirectorSession,
  shot: DramaShot,
): Array<{ character_id: string; character_name: string; text: string }> {
  const out: Array<{ character_id: string; character_name: string; text: string }> = [];
  const seen = new Set<string>();
  const push = (character_id: string, character_name: string, text: string) => {
    const t = String(text || '').trim();
    if (!t) return;
    const id = String(character_id || '').trim();
    const name = String(character_name || '').trim() || characterNameById(session, id);
    const key = `${id}|${name}|${t}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ character_id: id, character_name: name, text: t });
  };
  for (const ev of shot.timeline_events || []) {
    push(String(ev.dialogue_character_id || ''), '', String(ev.dialogue || ''));
  }
  for (const line of shot.dialogue || []) {
    push(
      String(line.character_id || ''),
      String(line.character_name || ''),
      String(line.text || ''),
    );
  }
  return out;
}

function isSpokenLineHuman(
  session: DramaDirectorSession,
  line: { character_id: string; character_name: string },
): boolean {
  const name = String(line.character_name || '').trim();
  const id = String(line.character_id || '').trim();
  if (name && isSystemSpeakerName(name)) return false;
  if (id && isSystemSpeakerId(id)) return false;
  const ch = id
    ? (session.bible?.characters || []).find((c) => c.character_id === id)
    : name
      ? (session.bible?.characters || []).find((c) => c.name === name)
      : null;
  if (ch && isSystemSpeakerName(ch.name)) return false;
  if (!id && !name) return false;
  return true;
}

/** 本镜有台词的**真实人物角色**（按对白顺序，去重）。排除系统旁白类（旁白/系统/画外音等）。 */
export function listDramaShotDialogueCharacters(
  session: DramaDirectorSession,
  shot: DramaShot,
): DramaCharacter[] {
  const out: DramaCharacter[] = [];
  const seen = new Set<string>();
  const pushChar = (ch: DramaCharacter | null | undefined) => {
    if (!ch || isSystemSpeakerName(ch.name) || seen.has(ch.character_id)) return;
    seen.add(ch.character_id);
    out.push(ch);
  };
  for (const line of collectDramaShotSpokenLines(session, shot)) {
    if (!isSpokenLineHuman(session, line)) continue;
    const id = line.character_id;
    const name = line.character_name;
    pushChar(
      (id && (session.bible?.characters || []).find((c) => c.character_id === id)) ||
        (name && (session.bible?.characters || []).find((c) => c.name === name)) ||
        null,
    );
  }
  if (!out.length) {
    for (const cid of shot.character_ids || []) {
      pushChar((session.bible?.characters || []).find((c) => c.character_id === cid));
    }
  }
  return out;
}

/** 判断本镜对白是否仅含系统旁白（无真实人物）：无 ref voice 也允许生成（用豆包预设音色）。 */
export function dramaShotHasOnlySystemDialogue(
  session: DramaDirectorSession,
  shot: DramaShot,
): boolean {
  const lines = collectDramaShotSpokenLines(session, shot);
  if (!lines.length) return false;
  return lines.every((line) => !isSpokenLineHuman(session, line));
}

export function resolveDramaVoiceForCharacter(
  session: DramaDirectorSession,
  ch: DramaCharacter,
): DramaVoice | null {
  return (
    session.bible.voices.find((v) => v.voice_id === ch.voice_id) ||
    session.bible.voices.find((v) => v.character_id === ch.character_id) ||
    null
  );
}

/**
 * 收集本镜可用参考音（最多 3 段，供 Doubao audio_url）。
 * 优先使用镜头显式 voice_ids（支持分镜卡手动增删）；为空时回退对白/出场人物启发式。
 */
export function collectDramaShotVoiceRefUrls(
  session: DramaDirectorSession,
  shot: DramaShot,
  max = 3,
): DramaShotVoiceRef[] {
  const table = buildDramaShotVoiceBindingTable(session, shot, max);
  return table.rows
    .filter((r) => !!r.audio && r.audio > 0 && !!r.sample_url)
    .sort((a, b) => (a.audio || 0) - (b.audio || 0))
    .map((r) => ({
      character_id: r.entity_id,
      character_name: r.name,
      voice_id: r.voice_id,
      sample_url: r.sample_url,
    }));
}

/** 当前镜头应展示的参考音 id 列表（显式或启发式物化） */
export function resolveDramaShotVoiceIds(
  session: DramaDirectorSession,
  shot: DramaShot,
  max = 3,
): string[] {
  const fromCollect = collectDramaShotVoiceRefUrls(session, shot, max)
    .map((r) => r.voice_id)
    .filter(Boolean);
  if (fromCollect.length) return fromCollect.slice(0, max);
  return (shot.voice_ids || []).map(String).filter(Boolean).slice(0, max);
}

function fmtAudioRange(start: number, end: number): string {
  const fmt = (n: number) => {
    const x = Math.round(n * 10) / 10;
    return Number.isInteger(x) ? String(x) : x.toFixed(1);
  };
  return `${fmt(start)}–${fmt(end)}秒`;
}

function citeCutSpeaker(
  session: DramaDirectorSession,
  ev: DramaTimelineEvent,
  refs: DramaShotVoiceRef[],
): string {
  let cid = String(ev.dialogue_character_id || '').trim();
  const role = resolveDramaVoiceRole(cid);
  if (role === 'system' || isDramaSystemOnlyVoiceId(cid)) {
    const idx = refs.findIndex((r) => isDramaSystemOnlyVoiceId(r.character_id));
    return idx >= 0 ? `系统（音色跟随音频${idx + 1}）` : '系统（电子/系统播报音色）';
  }
  if (role === 'narrator' || isDramaNarratorVoiceId(cid)) {
    const idx = refs.findIndex((r) => isDramaNarratorVoiceId(r.character_id));
    return idx >= 0 ? `旁白（音色跟随音频${idx + 1}）` : '旁白（画外音，非人物音色）';
  }
  if (!cid) {
    const onScreen = (ev.character_ids || []).map((x) => String(x || '').trim()).filter(Boolean);
    if (onScreen.length === 1) cid = onScreen[0];
  }
  const name = characterNameById(session, cid) || '说话人';
  let idx = refs.findIndex((r) => r.character_id === cid && !isDramaSystemVoiceId(r.character_id));
  if (idx < 0 && name && name !== '说话人') {
    idx = refs.findIndex(
      (r) =>
        !isDramaSystemVoiceId(r.character_id) &&
        (r.character_name === name || characterNameById(session, r.character_id) === name),
    );
  }
  if (idx >= 0) return `${name}（音色跟随音频${idx + 1}）`;
  if (isSystemSpeakerName(name)) {
    return isDramaNarratorVoiceId(name) || /旁白|画外/.test(name)
      ? '旁白（画外音，非人物音色）'
      : '系统（电子/系统播报音色）';
  }
  return name;
}

function formatCutAudioBlock(
  session: DramaDirectorSession,
  ev: DramaTimelineEvent,
  refs: DramaShotVoiceRef[],
  includeVisual: boolean,
): string {
  const who = (ev.character_ids || [])
    .map((id) => characterNameById(session, id) || id)
    .filter(Boolean)
    .join('、');
  const dlg = String(ev.dialogue || '').trim();
  const env = (ev.environment_audio || []).map((x) => String(x || '').trim()).filter(Boolean).join('、');
  const visual = String(ev.visual_action || '').trim();
  const lines = [
    `[${fmtAudioRange(ev.start_sec, ev.end_sec)}] ${ev.lip_sync ? '口型开' : '口型关'}${
      who ? ` · ${who}` : ''
    }`,
  ];
  if (includeVisual && visual) lines.push(`画面：${visual}`);
  lines.push(`对白：${dlg ? `${citeCutSpeaker(session, ev, refs)}：「${dlg}」` : '无'}`);
  lines.push(`环境音：${env || '无'}`);
  return lines.join('\n');
}

function fallbackAudioPromptFromShotFields(
  session: DramaDirectorSession,
  shot: DramaShot,
  refs: DramaShotVoiceRef[],
): string {
  const lines: string[] = [];
  for (const line of shot.dialogue || []) {
    const text = String(line.text || '').trim();
    if (!text) continue;
    let cid = String(line.character_id || '').trim();
    const name =
      String(line.character_name || '').trim() || characterNameById(session, cid) || '说话人';
    if (!cid && name && name !== '说话人') {
      const hit = refs.find(
        (r) =>
          !isDramaSystemVoiceId(r.character_id) &&
          (r.character_name === name || characterNameById(session, r.character_id) === name),
      );
      if (hit) cid = hit.character_id;
    }
    const role = resolveDramaVoiceRole(cid, name);
    let idx = refs.findIndex((r) =>
      role === 'system'
        ? isDramaSystemOnlyVoiceId(r.character_id)
        : role === 'narrator'
          ? isDramaNarratorVoiceId(r.character_id)
          : r.character_id === cid && !isDramaSystemVoiceId(r.character_id),
    );
    if (idx < 0 && role === 'character' && name && name !== '说话人') {
      idx = refs.findIndex(
        (r) =>
          !isDramaSystemVoiceId(r.character_id) &&
          (r.character_name === name || characterNameById(session, r.character_id) === name),
      );
    }
    const cite =
      role === 'system'
        ? idx >= 0
          ? `系统（音色跟随音频${idx + 1}）`
          : '系统（电子/系统播报音色）'
        : role === 'narrator'
          ? idx >= 0
            ? `旁白（音色跟随音频${idx + 1}）`
            : '旁白（画外音，非人物音色）'
          : idx >= 0
            ? `${name}（音色跟随音频${idx + 1}）`
            : name;
    lines.push(`${cite}：「${text}」`);
  }
  const sfx = String(shot.sfx || '').trim();
  if (sfx) lines.push(`环境音：${sfx}`);
  return lines.join('\n');
}

/**
 * 豆包 Seed Audio 1.0：本镜声音生成提示词。
 * 按彩条切段（timeline_events）组装对白 + 环境音时间轴，不送视频编译稿。
 */
export function buildDramaShotDoubaoAudioPrompt(
  session: DramaDirectorSession,
  shot: DramaShot,
): string {
  const dur = Math.max(1, Number(shot.duration_sec) || 10);
  const refs = collectDramaShotVoiceRefUrls(session, shot, 3);
  const events = [...(shot.timeline_events || [])].sort(
    (a, b) => (Number(a.start_sec) || 0) - (Number(b.start_sec) || 0),
  );
  const header = [
    `本镜时长 ${Number.isInteger(dur) ? String(dur) : dur.toFixed(1)} 秒。按下列彩条切段生成完整声轨。`,
    '规则：只朗读「对白」原文；「环境音」做成对应拟音/系统音/UI音；「画面」只作时间参考，禁止朗读。不要配乐、不要歌曲、不要把角色名或时间标签念出来。说话人音色跟随对应参考音，不要念参考音里的试听台词。',
    refs.length
      ? `参考音：${refs.map((r, i) => `音频${i + 1}=${r.character_name}`).join('；')}。`
      : '本镜无角色参考音；系统/旁白用电子播报或旁白音色。',
  ].join('\n');

  const assemble = (includeVisual: boolean) => {
    const body = events.length
      ? events.map((ev) => formatCutAudioBlock(session, ev, refs, includeVisual)).join('\n\n')
      : fallbackAudioPromptFromShotFields(session, shot, refs);
    return body ? `${header}\n\n${body}` : header;
  };

  let prompt = assemble(true);
  if (prompt.length > DOUBAO_TEXT_PROMPT_MAX) prompt = assemble(false);
  if (prompt.length > DOUBAO_TEXT_PROMPT_MAX) {
    prompt = `${prompt.slice(0, DOUBAO_TEXT_PROMPT_MAX - 1).trimEnd()}…`;
  }
  return prompt;
}

export function dramaShotNeedsAudioContent(shot: DramaShot): boolean {
  if ((shot.dialogue || []).some((d) => String(d.text || '').trim())) return true;
  if (String(shot.sfx || '').trim()) return true;
  for (const ev of shot.timeline_events || []) {
    if (String(ev.dialogue || '').trim()) return true;
    if ((ev.environment_audio || []).some((x) => String(x || '').trim())) return true;
  }
  return false;
}
