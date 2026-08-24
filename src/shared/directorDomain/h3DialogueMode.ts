/**
 * MiniMax H3 对白模式：用结构化 dialogueEvents 决定编译模板与是否传参考音。
 * 禁止用 prompt.includes('说') 猜测是否有对白。
 */

import type { DramaAudioEvent, DramaDirectingBeat } from './types.js';
import type { DramaH3CompileMode } from './compilers/h3CompileMode.js';

export type DramaH3DialogueMode = 'DIALOGUE_MODE' | 'NO_DIALOGUE_MODE';

export type DramaH3DialogueEvent = {
  speaker: string;
  character_id: string;
  language: 'Chinese';
  text: string;
  start: number;
  end: number;
};

export type DramaH3DialoguePlan = {
  dialogue: boolean;
  dialogue_mode: DramaH3DialogueMode;
  dialogueEvents: DramaH3DialogueEvent[];
};

export { H3_NO_DIALOGUE_PROMPT_BANNER } from './compilers/h3CompileMode.js';

export const H3_DIALOGUE_PROMPT_VERSION = 'h3-dialogue-v1';
export const H3_NO_DIALOGUE_PROMPT_VERSION = 'h3-no-dialogue-v2';

export function dramaH3PromptVersion(dialogue: boolean): string {
  return dialogue ? H3_DIALOGUE_PROMPT_VERSION : H3_NO_DIALOGUE_PROMPT_VERSION;
}

const QUOTE_RE = /[「『“"‘']([^」』”"’']{1,120})[」』”"’']/g;

const SPEECH_ACT_CLAUSE_RE =
  /[^。；;\n]{0,24}(?:骂道|说道|喊道|大喊|低声说|怒斥|抱怨|回答|回应|道歉|解释|询问|质问|嘀咕|喃喃|耳语|谩骂声?|喊叫|开口说|继续抱怨)[^。；;\n]{0,120}[。；;]?/g;

const DRIVER_VOICE_RE = /司机(?:的)?(?:声音|说话|谩骂|抱怨|怒吼)[^。；;\n]{0,40}/g;

const HUMAN_VOICE_ENV_RE =
  /(?:人声|对话声|说话声|喊叫声|低语声|耳语声|哼唱|歌唱|speech-like)/gi;

export function resolveDramaH3DialoguePlan(
  audioTimeline: DramaAudioEvent[] | undefined | null,
  nameById?: Map<string, string>,
): DramaH3DialoguePlan {
  const dialogueEvents: DramaH3DialogueEvent[] = [];
  for (const a of audioTimeline || []) {
    const text = String(a?.text || '').trim();
    const character_id = String(a?.character_id || '').trim();
    if (!text || !character_id) continue;
    dialogueEvents.push({
      speaker: nameById?.get(character_id) || character_id,
      character_id,
      language: 'Chinese',
      text,
      start: Number(a.start_sec) || 0,
      end: Number(a.end_sec) || 0,
    });
  }
  const dialogue = dialogueEvents.length > 0;
  return {
    dialogue,
    dialogue_mode: dialogue ? 'DIALOGUE_MODE' : 'NO_DIALOGUE_MODE',
    dialogueEvents,
  };
}

/** h3-multi 仅在有对白时传角色参考音；h3-audio 始终传本镜声轨（复用成片音）。 */
export function shouldSendDramaH3AudioReference(opts: {
  mode: DramaH3CompileMode;
  hasDialogue: boolean;
}): boolean {
  if (opts.mode === 'h3-audio') return true;
  return !!opts.hasDialogue;
}

function tidyPunctuation(text: string): string {
  return String(text || '')
    .replace(/[，,]{2,}/g, '，')
    .replace(/[。.]{2,}/g, '。')
    .replace(/[；;]{2,}/g, '；')
    .replace(/^[，,。.\s]+|[，,。.\s]+$/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

/**
 * 无对白：去掉引号台词与语言行为，只留可见动作/环境。
 * 有对白：仍从画面/环境描述里清掉引号台词（台词只允许出现在 <d>）。
 */
export function scrubH3SpeechLeak(
  text: string,
  opts?: { allowedSpoken?: string[] },
): string {
  let s = String(text || '');
  if (!s.trim()) return '';
  const allowed = new Set(
    (opts?.allowedSpoken || []).map((x) => String(x || '').trim()).filter(Boolean),
  );
  s = s.replace(QUOTE_RE, (_full, inner: string) => {
    const t = String(inner || '').trim();
    if (t && allowed.has(t)) return '';
    return '';
  });
  if (!allowed.size) {
    s = s.replace(SPEECH_ACT_CLAUSE_RE, '');
    s = s.replace(DRIVER_VOICE_RE, '周围车辆经过');
    s = s.replace(HUMAN_VOICE_ENV_RE, '');
    s = s.replace(/(?:背景)?传来[^。]{0,8}(?:声音|人声)/g, '周围环境声增强');
  }
  return tidyPunctuation(s);
}

export function scrubH3EnvironmentAudio(
  items: string[] | undefined | null,
  opts?: { allowedSpoken?: string[] },
): string[] {
  const out: string[] = [];
  for (const raw of items || []) {
    const s = scrubH3SpeechLeak(String(raw || ''), opts);
    if (!s) continue;
    if (/骂|抱怨|道歉|说话|台词|对白/.test(s)) continue;
    out.push(s);
  }
  return out;
}

/** 编译期净化 directing beat，避免 visual 被清掉后又从 continuityOut 回填台词。 */
export function scrubDramaDirectingBeatSpeech(
  beat: DramaDirectingBeat,
  opts?: { allowedSpoken?: string[]; noDialogue?: boolean },
): DramaDirectingBeat {
  const allowedSpoken = opts?.allowedSpoken || [];
  const scrub = (t: string | undefined) => scrubH3SpeechLeak(String(t || ''), { allowedSpoken });
  const env = scrubH3EnvironmentAudio(
    String(beat.environmentSound || '')
      .split(/[、,，]/)
      .map((x) => x.trim())
      .filter(Boolean),
    { allowedSpoken },
  );
  return {
    ...beat,
    action: scrub(beat.action),
    event: scrub(beat.event),
    visibleAction: scrub(beat.visibleAction),
    visiblePerformance: scrub(beat.visiblePerformance),
    performance: scrub(beat.performance),
    continuityIn: scrub(beat.continuityIn),
    continuityOut: scrub(beat.continuityOut),
    environmentSound: env.join('、'),
    ...(opts?.noDialogue ? { dialogue: '', lipSync: false } : {}),
  };
}

export function assertNoSpokenLeaks(prompt: string, forbidden: string[]): string[] {
  const body = String(prompt || '');
  return forbidden.filter((line) => {
    const t = String(line || '').trim();
    return t.length >= 2 && body.includes(t);
  });
}
