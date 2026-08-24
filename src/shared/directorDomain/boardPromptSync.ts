/**
 * 分镜建议（上游）→ 导演分镜切段/编译稿。
 * 上游更新后，本镜显示「更新提示词」并按建议重写切段。
 */

import { resolveDramaCharacterIdByName } from './ensureAppearingCharacters.js';
import { getActiveEpisodeBible } from './episodeBible.js';
import { createEmptyDramaDialogueLine } from './factories.js';
import { enrichDramaShotLocally } from './shotTimeline.js';
import type {
  DramaDirectorSession,
  DramaShot,
  DramaShotSuggestion,
} from './types.js';

export type DramaPromptSourceFields = {
  action: string;
  move: string;
  lighting: string;
  expression: string;
  blocking: string;
  dialogue: string;
  sfx: string;
  size: string;
  purpose: string;
};

function norm(s: string): string {
  return String(s || '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function dramaPromptSourceFingerprint(src: DramaPromptSourceFields): string {
  return [
    src.action,
    src.move,
    src.lighting,
    src.expression,
    src.blocking,
    src.dialogue,
    src.sfx,
    src.size,
    src.purpose,
  ]
    .map(norm)
    .join('||');
}

export function dramaShotFieldsAsPromptSource(shot: DramaShot): DramaPromptSourceFields {
  const dialogue = (shot.dialogue || [])
    .map((d) => {
      const name = String(d.character_name || '').trim();
      const text = String(d.text || '').trim();
      if (!text) return '';
      return name ? `${name}：${text}` : text;
    })
    .filter(Boolean)
    .join(' / ');
  return {
    action: String(shot.action || ''),
    move: String(shot.move || ''),
    lighting: String(shot.lighting || ''),
    expression: String(shot.expression || ''),
    blocking: String(shot.blocking || ''),
    dialogue,
    sfx: String(shot.sfx || ''),
    size: String(shot.size || ''),
    purpose: String(shot.purpose || ''),
  };
}

export function dramaSuggestionAsPromptSource(
  sug: DramaShotSuggestion,
): DramaPromptSourceFields {
  return {
    action: String(sug.action || ''),
    move: String(sug.move || ''),
    lighting: String(sug.lighting || ''),
    expression: String(sug.emotion_play || ''),
    blocking: String(sug.blocking || ''),
    dialogue: String(sug.dialogue || ''),
    sfx: String(sug.sound || ''),
    size: String(sug.size || ''),
    purpose: String(sug.purpose || ''),
  };
}

export function suggestionHasPromptBody(sug: DramaShotSuggestion | undefined | null): boolean {
  if (!sug) return false;
  return !!(norm(sug.action) || norm(sug.move) || norm(sug.emotion_play) || norm(sug.lighting));
}

export function findDramaShotSuggestion(
  session: DramaDirectorSession,
  shot: DramaShot,
): DramaShotSuggestion | undefined {
  const list = getActiveEpisodeBible(session).shot_suggestions || [];
  const no = String(shot.shot_no || '').trim();
  if (!no) return undefined;
  const exact = list.find((s) => String(s.shot || '').trim() === no);
  if (exact) return exact;
  const n = Number(no);
  if (Number.isFinite(n) && n >= 1) return list[n - 1];
  return undefined;
}

function isBareCameraWord(s: string): boolean {
  return /^(固定|跟拍|推|拉|摇|俯拍|仰拍|旋转|固定镜头)$/.test(norm(s));
}

function blobLooksBareCamera(blob: string): boolean {
  return /(^|[·｜|\s，,])(固定镜头|固定|跟拍)([·｜|\s，,]|$)/.test(blob);
}

function containsLoose(hay: string, needle: string): boolean {
  const h = norm(hay);
  const n = norm(needle);
  if (!n || n.length < 4) return true;
  return h.includes(n);
}

function pickNeedle(text: string): string {
  const t = norm(text);
  if (t.length <= 16) return t;
  return t.slice(0, 16);
}

export function resolveDramaPromptSource(
  session: DramaDirectorSession,
  shot: DramaShot,
): DramaPromptSourceFields {
  const sug = findDramaShotSuggestion(session, shot);
  if (suggestionHasPromptBody(sug)) return dramaSuggestionAsPromptSource(sug!);
  return dramaShotFieldsAsPromptSource(shot);
}

/** 分镜建议或镜头字段已比当前切段/编译稿新 */
export function isDramaBoardPromptStale(
  session: DramaDirectorSession,
  shot: DramaShot,
): boolean {
  const source = resolveDramaPromptSource(session, shot);
  const srcFp = dramaPromptSourceFingerprint(source);
  if (!srcFp.replace(/\|/g, '')) return false;

  const stored = String(shot.prompt_source_fingerprint || '').trim();
  if (stored) return stored !== srcFp;

  const sug = findDramaShotSuggestion(session, shot);
  if (suggestionHasPromptBody(sug)) {
    const shotFp = dramaPromptSourceFingerprint(dramaShotFieldsAsPromptSource(shot));
    if (srcFp !== shotFp) return true;
  }

  const events = shot.timeline_events || [];
  if (!events.length) return true;
  const camBlob = events.map((e) => String(e.camera_action || '')).join('\n');
  const visBlob = events.map((e) => String(e.visual_action || '')).join('\n');
  const move = norm(source.move);
  if (move.length >= 6 && !isBareCameraWord(move)) {
    if (blobLooksBareCamera(camBlob) && !containsLoose(camBlob, pickNeedle(move))) return true;
  }
  const action = norm(source.action);
  if (action.length >= 10 && visBlob) {
    const needle = pickNeedle(action);
    if (needle && !containsLoose(visBlob, needle) && !containsLoose(action, pickNeedle(visBlob))) {
      return true;
    }
  }
  return false;
}

function resolveCastId(session: DramaDirectorSession, name: string): string {
  return resolveDramaCharacterIdByName(session.bible.characters || [], name);
}

export function applyDramaShotSuggestionToShot(
  session: DramaDirectorSession,
  shot: DramaShot,
  sug: DramaShotSuggestion,
): DramaShot {
  const dialogueParts = String(sug.dialogue || '')
    .split(/\s*\/\s*/)
    .map((x) => x.trim())
    .filter(Boolean);
  const dialogue = dialogueParts
    .map((part) => {
      const cleaned = part.replace(/【潜台词[:：]?[^】]*】/g, '').trim();
      const m = cleaned.match(/^(.+?)[：:](.+)$/);
      if (m) {
        const character_name = m[1].trim();
        return createEmptyDramaDialogueLine({
          character_name,
          character_id: resolveCastId(session, character_name),
          text: m[2].trim(),
        });
      }
      return createEmptyDramaDialogueLine({
        character_name: '',
        character_id: '',
        text: cleaned,
      });
    })
    .filter((d) => d.text);
  const cast_names = sug.cast_names || [];
  return {
    ...shot,
    purpose: sug.purpose || shot.purpose,
    size: sug.size || shot.size,
    camera: sug.camera || shot.camera,
    angle: sug.camera || shot.angle,
    move: sug.move || shot.move,
    action: sug.action || shot.action,
    expression: sug.emotion_play || shot.expression,
    blocking: sug.blocking || shot.blocking,
    lighting: sug.lighting || shot.lighting,
    atmosphere: sug.time_of_day || shot.atmosphere,
    environment: sug.environment || shot.environment,
    dialogue: dialogue.length ? dialogue : shot.dialogue,
    sfx: sug.sound || shot.sfx,
    continuity_notes:
      [sug.subtext, sug.transition_in, sug.transition_out].filter(Boolean).join(' → ') ||
      shot.continuity_notes,
    character_ids: cast_names.length
      ? cast_names.map((n) => resolveCastId(session, n)).filter(Boolean)
      : shot.character_ids,
    dramatic_purpose: sug.dramatic_purpose || shot.dramatic_purpose,
    visual_focus: sug.visual_focus || shot.visual_focus,
    transition_in: sug.transition_in || shot.transition_in,
    transition_out: sug.transition_out || shot.transition_out,
  };
}

/** 用分镜建议（若有）重写镜头字段，并重建切段；清空过期 skill 稿 */
export function rebuildDramaShotPromptFromUpstream(
  session: DramaDirectorSession,
  shot: DramaShot,
): DramaShot {
  const sug = findDramaShotSuggestion(session, shot);
  let next = suggestionHasPromptBody(sug)
    ? applyDramaShotSuggestionToShot(session, shot, sug!)
    : { ...shot };
  next = {
    ...next,
    timeline_events: [],
    timeline_beats: [],
    h3_skill_prompt: '',
    h3_skill_prompt_from: '',
    last_compiled_prompt: '',
  };
  next = enrichDramaShotLocally(session, next);
  const source = suggestionHasPromptBody(sug)
    ? dramaSuggestionAsPromptSource(sug!)
    : dramaShotFieldsAsPromptSource(next);
  return {
    ...next,
    prompt_source_fingerprint: dramaPromptSourceFingerprint(source),
  };
}
