/**
 * P1-A1：程序 Visual Event × LLM 导演理解 Merge。
 * 程序原文层 authoritative；LLM 只做 semantic enrichment。
 * 不生成 Shot、不覆盖 Timeline、不发明 segment / character / camera。
 */

import { createEmptyDramaEpisodeBible, getActiveEpisodeBible } from './episodeBible.js';
import { isNonVisualDramaEyeline, isSystemSpeakerName } from './extractCastFromScript.js';
import { resolveDramaCharacterIdByName } from './ensureAppearingCharacters.js';
import { createEmptyDramaVisualEvent, normalizeDramaEventId, type DramaVisualEvent } from './shotPlanning.js';
import type {
  DramaCharacter,
  DramaDirectorSession,
  DramaEmotion,
  DramaOriginalIntegrityReport,
  DramaOriginalSegment,
} from './types.js';

const FORBIDDEN_EYELINE_RE =
  /^(?:the\s+)?(?:camera|viewer|lens|audience)$|^镜头(?:前|里|中)?$|^观众$|^镜头$/i;

const ABSTRACT_EMOTION_EXPR_RE =
  /^(?:紧张|压抑|愤怒|悲伤|恐惧|疑惑|冷漠|震惊|释然|克制|沉默|开心|兴奋|绝望|孤独|疲惫|困倦|轻松|慵懒|机械|懵逼|无奈|困惑|迷茫|失落|决心|怀疑|专注|确认|平静|低声|内心OS)(?:[、，,].*)?$/;

const VISIBLE_PERFORMANCE_ANATOMY_RE = /[眉眼嘴脸鼻颌唇瞳呼吸肩手齿牙喉颈头]|皱眉|眯眼|瞪大|张嘴|咬唇/;

const GAZE_RE =
  /(?:看向|望向|目光(?:投向|落在)?|视线(?:投向|落在)?|看着)[着]?([^，。,.\s「」"“”]{1,16})/;

export type MergeDramaVisualEventsResult = {
  visual_events: DramaVisualEvent[];
  warnings: string[];
};

export function compactSegmentId(id: string): string {
  return String(id || '')
    .trim()
    .replace(/[-_\s]/g, '')
    .toUpperCase();
}

export function resolveAllowedSegmentId(raw: string, allowed: Set<string>): string {
  const id = String(raw || '').trim();
  if (!id) return '';
  if (allowed.has(id)) return id;
  const compact = compactSegmentId(id);
  if (!compact) return '';
  for (const a of allowed) {
    if (compactSegmentId(a) === compact) return a;
  }
  return '';
}

export function sanitizeLlmSourceSegmentIds(
  raw: unknown,
  allowed: Set<string>,
  warnings: string[],
  eventLabel: string,
): string[] {
  const list = Array.isArray(raw) ? raw : raw != null && String(raw).trim() ? [raw] : [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of list) {
    const id = String(item || '').trim();
    if (!id) continue;
    const hit = resolveAllowedSegmentId(id, allowed);
    if (!hit) {
      warnings.push(`${eventLabel}: 忽略未知 source_segment_id「${id}」（禁止编造）`);
      continue;
    }
    if (seen.has(hit)) continue;
    seen.add(hit);
    out.push(hit);
  }
  if (list.length && !out.length) {
    warnings.push(`${eventLabel}: source_segment_ids 无法匹配原文片段，已置空`);
  }
  return out;
}

function overlapSegmentIds(a: string[] | undefined, b: string[] | undefined): boolean {
  if (!a?.length || !b?.length) return false;
  const set = new Set(a);
  return b.some((id) => set.has(id));
}

function isVisibleExpression(text: string): boolean {
  const t = String(text || '').trim();
  if (!t) return false;
  if (/机械女声|脑海中响起|内心OS/.test(t) && !VISIBLE_PERFORMANCE_ANATOMY_RE.test(t)) {
    return false;
  }
  if (VISIBLE_PERFORMANCE_ANATOMY_RE.test(t)) return true;
  if (ABSTRACT_EMOTION_EXPR_RE.test(t)) return false;
  if (t.length <= 8 && !/[，。、]/.test(t)) return false;
  return true;
}

export function pickVisibleDramaExpression(raw: string, emotion?: DramaEmotion | null): string {
  const t = String(raw || '').trim();
  if (!t) return '';
  const primary = String(emotion?.primary || '').trim();
  const secondary = String(emotion?.secondary || '').trim();
  if (primary && t === primary) return '';
  if (secondary && t === secondary) return '';
  if (!isVisibleExpression(t)) return '';
  return t;
}

export function formatDramaEmotionAsCharacterState(emotion?: DramaEmotion | null): string {
  const primary = String(emotion?.primary || '').trim();
  const secondary = String(emotion?.secondary || '').trim();
  const parts = [primary, secondary].filter(Boolean);
  if (!parts.length) return '';
  let s = parts.join('、');
  const intensity = Number(emotion?.intensity);
  if (Number.isFinite(intensity) && intensity >= 0.75) s += '，情绪强度高';
  return s;
}

export function resolveDramaWhoToCharacterIds(
  who: string,
  characters: DramaCharacter[],
  warnings: string[],
  eventLabel = 'VE',
): string[] {
  const raw = String(who || '').trim();
  if (!raw) return [];
  const tokens = raw
    .split(/[、，,;；/|]+/)
    .map((x) => x.trim())
    .filter(Boolean);
  const ids: string[] = [];
  const seen = new Set<string>();
  for (const token of tokens) {
    if (isSystemSpeakerName(token) || /^(?:system|narrator|narration)$/i.test(token)) continue;
    const byId = (characters || []).find((c) => c.character_id === token);
    const cid = byId?.character_id || resolveDramaCharacterIdByName(characters || [], token);
    if (!cid) {
      warnings.push(`${eventLabel}: who「${token}」无法匹配已有角色，未创造角色 ID`);
      continue;
    }
    if (seen.has(cid)) continue;
    seen.add(cid);
    ids.push(cid);
  }
  return ids;
}

function looksLikeNonGazeSee(see: string, sceneNames: string[] = []): boolean {
  const t = String(see || '').trim();
  if (!t) return true;
  if (isNonVisualDramaEyeline(t, sceneNames)) return true;
  if (/[「」""]/.test(t)) return true;
  if (/^[（(][^）)]{1,24}[）)]$/.test(t)) return true;
  if (/(?:拿起|走进|打了|切黑|闪烁|灌了|劈进|靠在|激活完毕|由远及近)/.test(t)) return true;
  if (/[。！？]$/.test(t) && t.length > 8) return true;
  return false;
}

export function mapDramaSeeToEyeline(
  see: string,
  characters: DramaCharacter[],
  fallbackText = '',
  sceneNames: string[] = [],
): string {
  const original = String(fallbackText || '').trim();
  let raw = String(see || '').trim();
  if (raw === original) raw = '';
  if (looksLikeNonGazeSee(raw, sceneNames)) raw = '';

  const tryResolve = (value: string): string => {
    const t = String(value || '').trim();
    if (!t) return '';
    if (FORBIDDEN_EYELINE_RE.test(t)) return '';
    if (isNonVisualDramaEyeline(t, sceneNames)) return '';
    const byId = (characters || []).find((c) => c.character_id === t);
    if (byId) return byId.character_id;
    const cid = resolveDramaCharacterIdByName(characters || [], t);
    if (cid) return cid;
    if (t.length <= 16 && !looksLikeNonGazeSee(t, sceneNames)) return t;
    return '';
  };

  const fromSee = tryResolve(raw);
  if (fromSee) return fromSee;

  const gazeFrom = (blob: string): string => {
    const m = String(blob || '').match(GAZE_RE);
    if (!m) return '';
    return tryResolve(String(m[1] || '').trim());
  };
  return gazeFrom(raw) || gazeFrom(original) || '';
}

function enrichProgramVeWithLlm(
  program: DramaVisualEvent,
  llm: DramaVisualEvent,
): DramaVisualEvent {
  const llmSee = String(llm.see || '').trim();
  const llmExpr = String(llm.expression || '').trim();
  const llmWho = String(llm.who || '').trim();
  const llmCut = String(llm.cut || '').trim();
  const llmPos = String(llm.position || '').trim();
  const llmEmotion = llm.emotion;
  const hasLlmEmotion = !!(
    String(llmEmotion?.primary || '').trim() || String(llmEmotion?.secondary || '').trim()
  );
  return createEmptyDramaVisualEvent({
    ...program,
    action: String(program.action || '').trim(),
    original_text: program.original_text,
    source_segment_ids: Array.isArray(program.source_segment_ids)
      ? [...program.source_segment_ids]
      : program.source_segment_ids,
    kind: program.kind,
    who: String(program.who || '').trim() || llmWho,
    expression: String(program.expression || '').trim() || llmExpr,
    emotion: hasLlmEmotion ? llmEmotion : program.emotion,
    see: llmSee || String(program.see || '').trim(),
    cut: llmCut || String(program.cut || '').trim(),
    position: llmPos || String(program.position || '').trim(),
  });
}

export function mergeProgramAndLlmVisualEvents(
  program: DramaVisualEvent[],
  llm: DramaVisualEvent[],
  allowedSegmentIds: Iterable<string>,
): MergeDramaVisualEventsResult {
  const warnings: string[] = [];
  const allowed = new Set(
    [...allowedSegmentIds].map((id) => String(id || '').trim()).filter(Boolean),
  );
  const programList = Array.isArray(program) ? program : [];
  const llmSanitized = (Array.isArray(llm) ? llm : []).map((ve, i) => {
    const label = `LLM VE ${ve.event_id || i + 1}`;
    return createEmptyDramaVisualEvent({
      ...ve,
      source_segment_ids: sanitizeLlmSourceSegmentIds(
        ve.source_segment_ids,
        allowed,
        warnings,
        label,
      ),
    });
  });

  if (!programList.length) {
    return { visual_events: llmSanitized, warnings };
  }

  const usedByEventId = new Set<number>();
  const merged = programList.map((pve) => {
    const pids = pve.source_segment_ids || [];
    let matchIdx = -1;
    if (pids.length) {
      matchIdx = llmSanitized.findIndex((l) => overlapSegmentIds(pids, l.source_segment_ids));
    }
    if (matchIdx < 0 && pve.event_id) {
      const pid = normalizeDramaEventId(pve.event_id);
      matchIdx = llmSanitized.findIndex(
        (l, i) => !usedByEventId.has(i) && normalizeDramaEventId(l.event_id) === pid,
      );
      if (matchIdx >= 0) usedByEventId.add(matchIdx);
    }
    if (matchIdx < 0) {
      warnings.push(`VE ${pve.event_id || pve.index}: 无法可靠匹配 LLM 事件，保留程序原文`);
      return createEmptyDramaVisualEvent(pve);
    }
    return enrichProgramVeWithLlm(pve, llmSanitized[matchIdx]);
  });

  return { visual_events: merged, warnings };
}

function appendIntegrityNotes(
  prev: DramaOriginalIntegrityReport | undefined,
  warnings: string[],
): DramaOriginalIntegrityReport | undefined {
  if (!warnings.length) return prev;
  if (!prev) {
    return {
      ok: true,
      source_chars: 0,
      covered_chars: 0,
      missing_samples: [],
      dialogue_ok: true,
      notes: [...warnings],
    };
  }
  return { ...prev, notes: [...(prev.notes || []), ...warnings] };
}

/** 把 LLM normalize 结果作为理解层 merge 进本次程序分析 session，禁止整表替换原文层。 */
export function applyLlmAnalyzeOntoProgramSession(
  program: DramaDirectorSession,
  llm: DramaDirectorSession,
): DramaDirectorSession {
  const epId = String(program.active_episode_id || llm.active_episode_id || '').trim();
  const progBible = getActiveEpisodeBible(program);
  const llmBible = getActiveEpisodeBible({ ...llm, active_episode_id: epId || llm.active_episode_id });
  const allowed = (progBible.original_segments || []).map((s: DramaOriginalSegment) => s.segment_id);
  const merged = mergeProgramAndLlmVisualEvents(
    progBible.visual_events || [],
    llmBible.visual_events || [],
    allowed,
  );
  const nextBible = createEmptyDramaEpisodeBible({
    ...llmBible,
    episode_id: epId || llmBible.episode_id || progBible.episode_id,
    original_segments: progBible.original_segments || [],
    original_scenes: progBible.original_scenes || [],
    shot_suggestions: progBible.shot_suggestions?.length
      ? progBible.shot_suggestions
      : llmBible.shot_suggestions,
    character_bindings: progBible.character_bindings,
    voice_bindings: progBible.voice_bindings,
    scene_bindings: progBible.scene_bindings,
    visual_bible_binding: progBible.visual_bible_binding,
    original_integrity: appendIntegrityNotes(progBible.original_integrity, merged.warnings),
    analysis_summary: progBible.analysis_summary || llmBible.analysis_summary,
    official_scene_beats: progBible.official_scene_beats?.length
      ? progBible.official_scene_beats
      : llmBible.official_scene_beats,
    visual_events: merged.visual_events,
  });
  return {
    ...program,
    bible: llm.bible || program.bible,
    scene_beats: llm.scene_beats?.length ? llm.scene_beats : program.scene_beats,
    shots: [],
    episode_bibles: {
      ...(program.episode_bibles || {}),
      ...(llm.episode_bibles || {}),
      [nextBible.episode_id]: nextBible,
    },
  };
}
