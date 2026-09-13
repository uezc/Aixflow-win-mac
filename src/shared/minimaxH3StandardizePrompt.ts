/**
 * MiniMax-H3 出片提示词确定性标准化（不调 LLM、不编造台词）。
 * 清禁人声句、修换行时间戳、补口型/解剖/声轨规则、[cut]、Negative。
 */

const SUBJECT_RULES = [
  'When a visible character Subject speaks that character\'s own <d> lines, generate accurate lip-sync matching that spoken dialogue. Do not lip-sync system-voice or narrator <d> lines onto any visible face.',
  'Maintain correct human anatomy, avoid distorted hands, malformed fingers, extra fingers, twisted limbs.',
  'No unwanted camera shake, no random camera jitter.',
  'Character vocal lines run on dedicated vocal-audio track; environmental sounds occupy background track.',
].join('\n');

const NEGATIVE_EXTRA =
  'deformed hands, extra fingers, distorted facial features, unwanted camera shake';

const DIALOGUE_PLACEHOLDER =
  '# Example line: Jiang Che speaks in tired tone: "input your dialogue here"';

const AUDIO1_VOCAL =
  '<Audio 1> is a voice-timbre reference for its bound speaker only; never assign Audio 1 to system-voice or narrator lines.';

const AUDIO1_VOCAL_WITH_SYSTEM =
  '<Audio 1> is a voice-timbre reference for its bound speaker only. Never use Audio 1 for system-voice or narrator lines.';

const AUDIO1_TIMBRE_ONLY =
  '<Audio 1> is a voice-timbre reference for its bound speaker only.';

/** 英文六段 / Picture1 锁 / base 三段才做标准化；中文正文混排终稿跳过 */
export function isMinimaxH3EnglishSkillPrompt(text: string): boolean {
  const t = String(text || '');
  if (!t.trim()) return false;
  // 短剧中英混排：有汉字正文则不走英文 standardize（避免注入锁色/口型英文块）
  if (
    /[\u4e00-\u9fff]/.test(t) &&
    (/retention_analysis\s*:/i.test(t) || /detailed_description\s*:/i.test(t))
  ) {
    return false;
  }
  return (
    /subject_definitions\s*:/i.test(t) ||
    /Keep Picture 1 colors and rendering/i.test(t) ||
    /integrated_multimodal_description\s*:/i.test(t)
  );
}

function tidyBlankLines(text: string): string {
  return String(text || '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\s*;\s*;+/g, ';')
    .replace(/;\s*\./g, '.')
    .replace(/\s+([,.;])/g, '$1')
    .trim();
}

function isSystemVoiceContext(src: string, offset: number, span: number): boolean {
  const ctx = String(src || '').slice(Math.max(0, offset - 100), offset + span + 100);
  return /system[- ]voice|off-screen system|off-screen narrator|off-screen voiceover|off-camera|do not lip-sync|lips remain completely closed/i.test(ctx);
}

function stripUnlessSystem(
  s: string,
  re: RegExp,
  repl: string | ((full: string) => string) = '',
): string {
  return s.replace(re, (full, ...rest) => {
    const offset = Number(rest[rest.length - 2]) || 0;
    const src = String(rest[rest.length - 1] || '');
    if (isSystemVoiceContext(src, offset, full.length)) return full;
    return typeof repl === 'function' ? repl(full) : repl;
  });
}

function stripVocalSuppression(text: string): string {
  let s = String(text || '');
  const hasSpokenD = /<d>\s*\[Chinese/i.test(s);
  const hasSystemVoice = /system[- ]voice|off-screen system|off-screen narrator|Off-camera system voice/i.test(s);
  const audio1 = hasSpokenD
    ? hasSystemVoice
      ? AUDIO1_VOCAL_WITH_SYSTEM
      : AUDIO1_VOCAL
    : AUDIO1_TIMBRE_ONLY;

  s = s.replace(/<Audio 1>[^\n]*nonverbal[^\n]*/gi, audio1);
  s = s.replace(/\bsilent yawn\b/gi, 'yawn');
  s = s.replace(/\bsilent closed[- ]mouth breaths?\b/gi, 'breaths');
  s = s.replace(/\bswallowing silently\b/gi, 'swallowing');
  s = s.replace(/\bsilent performance\b[,.]?/gi, '');
  s = s.replace(/\bwithout dialogue or vocals\b[,.]?/gi, '');
  s = stripUnlessSystem(s, /\bkeep (?:his|her|their) mouth closed\b[,.]?/gi);
  s = stripUnlessSystem(s, /\bmouth still closed\b[,.]?/gi);
  s = stripUnlessSystem(s, /\bclosed[- ]mouth\b[,.]?/gi);
  s = s.replace(/\bNo dialogue, narration, singing, or vocal sound occurs\.?/gi, '');
  s = stripUnlessSystem(s, /\bJiang Che does not speak\.?/gi);
  s = stripUnlessSystem(s, /\bhe does not speak or move\b/gi, () => 'he does not move');
  s = stripUnlessSystem(s, /\bdoes not speak or move\b/gi, () => 'does not move');
  s = stripUnlessSystem(s, /\bhe does not speak\b[,.]?/gi);
  s = stripUnlessSystem(s, /\bdoes not speak\b[,.]?/gi);
  s = s.replace(/\bNo voices are audible\.?/gi, '');
  s = s.replace(/\bNo one speaks\.?/gi, '');
  s = s.replace(/\bNo voices, narration, or music are present\.?/gi, '');
  s = s.replace(/\bNo dialogue or narration\.?/gi, '');
  s = s.replace(/\bno vocal or music signal is copied\.?/gi, '');
  s = s.replace(/\bNo dialogue; do not add speech\.?/gi, '');
  s = s.replace(/\bNo dialogue\. Camera, blocking, and Foley only[^.]*\.?/gi, '');
  s = s.replace(/\bwithout copying voices or music\.?/gi, '');
  s = s.replace(/\bno speaking or singing mouth shapes\.?/gi, '');
  return tidyBlankLines(s);
}

/** At 00:03.\n600 → At 00:03.600 */
function fixBrokenTimestamps(text: string): string {
  return String(text || '').replace(/(\d{2}:\d{2})\.\s*[\r\n]+\s*(\d{1,3})\b/g, '$1.$2');
}

function injectSubjectRules(text: string): string {
  const s = String(text || '');
  if (/generate accurate lip-sync/i.test(s)) return s;
  if (/System-voice <d> lines|Narration <d> lines|says in an off-screen voiceover/i.test(s)) return s;
  if (!/subject_definitions\s*:/i.test(s)) return s;
  const insert = `\n${SUBJECT_RULES}`;
  if (/\nsummary\s*:/i.test(s)) {
    return s.replace(/\n(?=summary\s*:)/i, `${insert}\n\n`);
  }
  if (/\nretention_analysis\s*:/i.test(s)) {
    return s.replace(/\n(?=retention_analysis\s*:)/i, `${insert}\n\n`);
  }
  if (/\ndetailed_description\s*:/i.test(s)) {
    return s.replace(/\n(?=detailed_description\s*:)/i, `${insert}\n\n`);
  }
  return `${s.trim()}\n${SUBJECT_RULES}`;
}

function markHardCuts(text: string): string {
  return String(text || '')
    .split('\n')
    .map((line) => {
      if (/^\s*\[cut\]/i.test(line)) return line;
      if (!/\bhard cut\b|\bcut to\b/i.test(line)) return line;
      const lead = line.match(/^(\s*)/)?.[1] || '';
      return `${lead}[cut] ${line.slice(lead.length)}`;
    })
    .join('\n');
}

function expandNegative(text: string): string {
  return String(text || '').replace(/Negative:\s*([^\n]+)/i, (_full, list: string) => {
    if (/deformed hands/i.test(list)) return `Negative: ${list}`;
    const cleaned = String(list).replace(/[.,\s]+$/, '');
    return `Negative: ${cleaned}, ${NEGATIVE_EXTRA}`;
  });
}

function maybeAddDialoguePlaceholder(text: string): string {
  const s = String(text || '');
  if (/<d>\s*\[Chinese/i.test(s)) return s;
  if (/input your dialogue here/i.test(s)) return s;
  if (!/detailed_description\s*:/i.test(s)) return s;
  // 已是完整分镜稿时不要塞模板台词，避免 H3 把 placeholder 念出来
  if (/\[Shot\s*\d+\]/i.test(s) && s.length > 400) return s;
  if (/\n\[Shot 1\]/i.test(s)) {
    return s.replace(/(\n\[Shot 1\][^\n]*\n)/i, `$1${DIALOGUE_PLACEHOLDER}\n`);
  }
  return s.replace(/(detailed_description\s*:\s*\n)/i, `$1${DIALOGUE_PLACEHOLDER}\n`);
}

export function standardizeMinimaxH3VideoPrompt(text: string): string {
  let s = String(text || '').trim();
  if (!s) return s;
  if (!isMinimaxH3EnglishSkillPrompt(s)) return s;
  s = fixBrokenTimestamps(s);
  s = stripVocalSuppression(s);
  s = injectSubjectRules(s);
  s = markHardCuts(s);
  s = expandNegative(s);
  s = maybeAddDialoguePlaceholder(s);
  return tidyBlankLines(s);
}
