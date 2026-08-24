/**
 * MiniMax H3 编译 mode：显式枚举，禁止从提示词内容猜测。
 * 导演执行表只有一份；差异只在 Adapter 编译层。
 */

export type DramaH3CompileMode = 'h3-multi' | 'h3-audio';

/** 无对白：只声明一次，禁止再堆叠「不要说话」句。 */
export const H3_NO_DIALOGUE_PROMPT_BANNER = `[NO_DIALOGUE]
Picture + Foley only. Mouths closed. Ambience and physical sound. Zero human voice.`;

export const H3_MULTI_MODE_BANNER =
  '[H3 compile · full-reference] mode=h3-multi. Audio slots = character timbre only (not the finished soundtrack). Generate picture from the execute table. Generate speech ONLY from <d>[Chinese] tags. Timbre follows the matching <Audio N>. Do not speak this banner.';

export const H3_AUDIO_MODE_BANNER =
  '[H3 compile · audio reuse] mode=h3-audio. This request is system-compiled; do not reclassify as full-reference. The only audio = Audio 1 (this shot track). Use that track as-is. Do not invent extra speech, ambience, or character sample audio. Do not speak this banner.';

export const H3_LIPSYNC_TIMELINE_RULE_DIALOGUE =
  'Lip-sync lock: mouths open ONLY in speech windows, matching the <d> words. Others stay silent. Do not speak this rule.';

export const H3_LIPSYNC_TIMELINE_RULE_SILENT =
  'Lip-sync lock: no dialogue events. All mouths rest. Do not treat foley as speech. Do not speak this rule.';

/** @deprecated 使用 h3LipsyncTimelineRule(hasDialogueEvents) */
export const H3_LIPSYNC_TIMELINE_RULE = H3_LIPSYNC_TIMELINE_RULE_DIALOGUE;

export const H3_MULTI_SOUND_CONSTRAINT =
  '[Sound · full-reference] Generate diegetic audio from the timeline: (1) spoken words = ONLY <d>[Chinese] … </d> in detailed_description; (2) voice timbre follows the matching <Audio N> without copying its sample script; (3) ambience/foley from environment_audio. No BGM/songs. No on-screen captions. Never read director notes aloud.';

export const H3_AUDIO_SOUND_CONSTRAINT =
  '[Sound · audio reuse] The finished track must reuse Audio 1 (this shot) as-is. Do not invent speech, ambience, score, or humming. Zero on-screen captions. Do not speak this rule.';

export const H3_AUDIO_LIPSYNC_WHEN_DIALOGUE =
  'When the Audio Timeline has dialogue/singing: only that speaker opens their mouth in the matching window, lip-synced to Audio 1; everyone else stays silent. Do not speak this rule.';

export const H3_AUDIO_NO_LIPSYNC_WHEN_SILENT =
  'When the Audio Timeline has no dialogue: all mouths rest closed; do not lip-sync speech to the track. Do not speak this rule.';

export const H3_SPEAKING_FACE_VISIBLE_RULE =
  'Only in dialogue/singing windows must the speaker face and mouth be clearly visible for lip sync; otherwise facing may follow blocking (ride, stop, walk). Do not speak this rule.';

/** 无对白时段：Compiler 现算，不入库 */
export const H3_NATURAL_NO_DIALOGUE_MOUTH_RULE =
  'No dialogue this window: do not speak. Natural breathing only. Do not read director notes.';

export const H3_LISTENER_MOUTH_RULE =
  'Listeners keep a natural closed or resting mouth; no speech-like lip motion.';

/** MiniMax H3 全能参考：中文指令会被念出来。能说的字只能在 <d> 里。 */
export const H3_SPOKEN_WORDS_LOCK =
  '[Spoken-words lock · highest priority] The only human speech in the finished video is the exact text inside <d>[Chinese] ... </d> tags. Speak those words only, in those time windows, in that language. NEVER read, whisper, paraphrase, or sing: director notes, constraints, camera lines, section titles, English instructions, parentheticals, bracket labels, Visual-only lines, Audio Timeline labels, negative prompts, or any sample script from reference audio. If a time window has no <d> tag, generate ZERO speech (ambience and foley only). Do not speak this lock.';

export function h3LipsyncTimelineRule(hasDialogueEvents: boolean): string {
  return hasDialogueEvents ? H3_LIPSYNC_TIMELINE_RULE_DIALOGUE : H3_LIPSYNC_TIMELINE_RULE_SILENT;
}

export function h3MultiModeBanner(hasDialogueEvents: boolean): string {
  return hasDialogueEvents
    ? `${H3_MULTI_MODE_BANNER} ${H3_SPOKEN_WORDS_LOCK}`
    : H3_NO_DIALOGUE_PROMPT_BANNER;
}

export function h3MultiSoundConstraint(hasDialogueEvents: boolean): string {
  return hasDialogueEvents ? H3_MULTI_SOUND_CONSTRAINT : '';
}

export function h3AudioModeBanner(hasDialogueEvents: boolean): string {
  return [
    H3_AUDIO_MODE_BANNER,
    hasDialogueEvents ? H3_AUDIO_LIPSYNC_WHEN_DIALOGUE : H3_AUDIO_NO_LIPSYNC_WHEN_SILENT,
    hasDialogueEvents ? H3_SPEAKING_FACE_VISIBLE_RULE : '',
  ]
    .filter(Boolean)
    .join('');
}

export function h3AudioSoundConstraint(hasDialogueEvents: boolean): string {
  return `${H3_AUDIO_SOUND_CONSTRAINT}${
    hasDialogueEvents
      ? ' During dialogue windows, lip-sync only to Audio 1 timing.'
      : ' No dialogue this shot: do not treat Audio 1 as speech lip-sync.'
  }`;
}

export function assertDramaH3CompileMode(mode: string): asserts mode is DramaH3CompileMode {
  if (mode !== 'h3-multi' && mode !== 'h3-audio') {
    throw new Error(`H3 编译 mode 必须显式为 h3-multi 或 h3-audio，收到：${mode || '(空)'}`);
  }
}
