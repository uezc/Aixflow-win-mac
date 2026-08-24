/**
 * 导演增强 Patch：LLM 只写表演/运镜加细；禁止改事实字段。
 * 可撤销：revision 保存 original / enhanced。
 */

import { dramaNewId } from './ids.js';
import type {
  DramaDirectingEnhancePatch,
  DramaDirectingEnhanceRevision,
  DramaDirectingSource,
  DramaPerformanceBeat,
  DramaShot,
  DramaShotDirectingEnhance,
} from './types.js';

export const DRAMA_ENHANCE_ALLOWED_PERFORMANCE_FIELDS = [
  'facial_expression',
  'eye_direction',
  'mouth_state',
  'breathing',
  'head_movement',
  'body_movement',
  'hand_movement',
  'emotional_change',
  'post_dialogue_reaction',
] as const;

export const DRAMA_ENHANCE_ALLOWED_DIRECTING_FIELDS = [
  'camera_movement',
  'focus_behavior',
  'subtle_environment_action',
] as const;

export const DRAMA_ENHANCE_FORBIDDEN_PATHS = [
  'speaker_id',
  'speakerId',
  'character_id',
  'characterId',
  'dialogue',
  'text',
  'start_sec',
  'end_sec',
  'audio_timeline',
  'audio_url',
  'voice_ids',
  'scene_asset_id',
  'character_ids',
  'storyboard_image_url',
  'reference_images',
  'lock_intent',
  'visual_bible',
  'projectVisualBible',
  'model_params',
  'duration_sec',
  'final_prompt',
  'adapter_prompt_cache',
  'identity',
  'visual_anchors',
  'forbidden_changes',
] as const;

const FORBIDDEN_SET = new Set(
  DRAMA_ENHANCE_FORBIDDEN_PATHS.map((p) => p.toLowerCase().replace(/_/g, '')),
);

function normKey(k: string): string {
  return String(k || '')
    .trim()
    .toLowerCase()
    .replace(/_/g, '');
}

export function isDramaEnhanceForbiddenKey(key: string): boolean {
  return FORBIDDEN_SET.has(normKey(key));
}

function beatKey(b: Pick<DramaPerformanceBeat, 'character_id' | 'audio_event_id' | 'timeline_event_id'>): string {
  return `${String(b.character_id || '').trim()}|${String(b.audio_event_id || '').trim()}|${String(b.timeline_event_id || '').trim()}`;
}

function pickAllowed(
  raw: Record<string, unknown>,
  allowed: readonly string[],
  blocked: Array<{ path: string; reason: string }>,
  pathPrefix: string,
): Record<string, string> {
  const out: Record<string, string> = {};
  const allow = new Set(allowed);
  for (const [k, v] of Object.entries(raw || {})) {
    if (k === 'character_id' || k === 'beat_id' || k === 'audio_event_id' || k === 'timeline_event_id' || k === 'speaker_id' || k === 'source' || k === 'schema' || k === 'shot_id') {
      continue;
    }
    if (isDramaEnhanceForbiddenKey(k)) {
      blocked.push({ path: `${pathPrefix}.${k}`, reason: '禁止修改事实字段' });
      continue;
    }
    if (!allow.has(k)) {
      blocked.push({ path: `${pathPrefix}.${k}`, reason: '不在导演增强允许字段内，已丢弃' });
      continue;
    }
    const t = String(v ?? '').trim();
    if (t) out[k] = t;
  }
  return out;
}

function userFilledFields(beats: DramaPerformanceBeat[], key: string): Set<string> {
  const set = new Set<string>();
  for (const b of beats) {
    if (b.source !== 'user' || beatKey(b) !== key) continue;
    for (const f of DRAMA_ENHANCE_ALLOWED_PERFORMANCE_FIELDS) {
      if (String((b as unknown as Record<string, unknown>)[f] || '').trim()) set.add(f);
    }
  }
  return set;
}

export function parseDramaDirectingEnhancePatch(
  raw: string,
  shotId: string,
): { patch: DramaDirectingEnhancePatch; blocked: Array<{ path: string; reason: string }> } {
  const blocked: Array<{ path: string; reason: string }> = [];
  const text = String(raw || '').trim();
  let json: unknown = null;
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = fence ? fence[1] : text;
  const start = body.indexOf('{');
  const end = body.lastIndexOf('}');
  if (start >= 0 && end > start) {
    try {
      json = JSON.parse(body.slice(start, end + 1));
    } catch {
      blocked.push({ path: '$', reason: '无法解析 JSON' });
    }
  } else {
    blocked.push({ path: '$', reason: '未找到 JSON 对象' });
  }
  const obj = json && typeof json === 'object' ? (json as Record<string, unknown>) : {};
  for (const k of Object.keys(obj)) {
    if (isDramaEnhanceForbiddenKey(k) && k !== 'character_id' && k !== 'shot_id') {
      blocked.push({ path: k, reason: '禁止修改事实字段' });
      delete obj[k];
    }
  }
  const perfRaw = Array.isArray(obj.performance_plan) ? obj.performance_plan : [];
  const performance_plan: DramaDirectingEnhancePatch['performance_plan'] = [];
  for (let i = 0; i < perfRaw.length; i += 1) {
    const row = perfRaw[i] && typeof perfRaw[i] === 'object' ? (perfRaw[i] as Record<string, unknown>) : {};
    const cid = String(row.character_id || '').trim();
    if (!cid) {
      blocked.push({ path: `performance_plan[${i}].character_id`, reason: '缺少 character_id 指向，已丢弃' });
      continue;
    }
    const fields = pickAllowed(row, DRAMA_ENHANCE_ALLOWED_PERFORMANCE_FIELDS, blocked, `performance_plan[${i}]`);
    performance_plan.push({
      character_id: cid,
      ...(String(row.beat_id || '').trim() ? { beat_id: String(row.beat_id).trim() } : {}),
      ...(String(row.audio_event_id || '').trim()
        ? { audio_event_id: String(row.audio_event_id).trim() }
        : {}),
      ...(String(row.timeline_event_id || '').trim()
        ? { timeline_event_id: String(row.timeline_event_id).trim() }
        : {}),
      ...fields,
    });
  }
  let directing_enhance: DramaDirectingEnhancePatch['directing_enhance'];
  if (obj.directing_enhance && typeof obj.directing_enhance === 'object') {
    directing_enhance = pickAllowed(
      obj.directing_enhance as Record<string, unknown>,
      DRAMA_ENHANCE_ALLOWED_DIRECTING_FIELDS,
      blocked,
      'directing_enhance',
    );
  }
  return {
    patch: {
      schema: 'drama-directing-enhance.v1',
      shot_id: shotId,
      ...(performance_plan.length ? { performance_plan } : {}),
      ...(directing_enhance && Object.keys(directing_enhance).length
        ? { directing_enhance }
        : {}),
    },
    blocked,
  };
}

export function applyDramaDirectingEnhancePatch(
  shot: DramaShot,
  patch: DramaDirectingEnhancePatch,
  blockedIn?: Array<{ path: string; reason: string }>,
): { shot: DramaShot; revision: DramaDirectingEnhanceRevision } {
  const blocked = [...(blockedIn || [])];
  const original_performance_plan = [...(shot.performance_plan || [])];
  const original_directing_enhance = shot.directing_enhance
    ? { ...shot.directing_enhance }
    : undefined;
  const now = Date.now();

  const nextPlan = original_performance_plan.filter((b) => b.source !== 'llm_enhanced');
  const userBeats = nextPlan.filter((b) => b.source === 'user');

  for (const row of patch.performance_plan || []) {
    const cid = String(row.character_id || '').trim();
    if (!cid) continue;
    const key = beatKey({
      character_id: cid,
      audio_event_id: row.audio_event_id,
      timeline_event_id: row.timeline_event_id,
    });
    const locked = userFilledFields(userBeats, key);
    const beat: DramaPerformanceBeat = {
      beat_id: String(row.beat_id || '').trim() || dramaNewId('pbm'),
      character_id: cid,
      source: 'llm_enhanced',
      updated_at: now,
      ...(row.audio_event_id ? { audio_event_id: String(row.audio_event_id).trim() } : {}),
      ...(row.timeline_event_id ? { timeline_event_id: String(row.timeline_event_id).trim() } : {}),
    };
    for (const f of DRAMA_ENHANCE_ALLOWED_PERFORMANCE_FIELDS) {
      const v = String((row as Record<string, unknown>)[f] || '').trim();
      if (!v) continue;
      if (locked.has(f)) {
        blocked.push({
          path: `performance_plan.${f}`,
          reason: '用户已明确设置，LLM 不得覆盖',
        });
        continue;
      }
      (beat as unknown as Record<string, unknown>)[f] = v;
    }
    const hasPerf = DRAMA_ENHANCE_ALLOWED_PERFORMANCE_FIELDS.some((f) =>
      String((beat as unknown as Record<string, unknown>)[f] || '').trim(),
    );
    if (hasPerf) nextPlan.push(beat);
  }

  let nextEnhance = original_directing_enhance;
  if (patch.directing_enhance) {
    const userLocked =
      original_directing_enhance?.source === 'user' ? original_directing_enhance : null;
    const merged: DramaShotDirectingEnhance = {
      source: 'llm_enhanced',
      updated_at: now,
    };
    for (const f of DRAMA_ENHANCE_ALLOWED_DIRECTING_FIELDS) {
      const v = String((patch.directing_enhance as Record<string, unknown>)[f] || '').trim();
      if (!v) continue;
      if (userLocked && String((userLocked as unknown as Record<string, unknown>)[f] || '').trim()) {
        blocked.push({
          path: `directing_enhance.${f}`,
          reason: '用户已明确设置，LLM 不得覆盖',
        });
        continue;
      }
      (merged as unknown as Record<string, unknown>)[f] = v;
    }
    const has = DRAMA_ENHANCE_ALLOWED_DIRECTING_FIELDS.some((f) =>
      String((merged as unknown as Record<string, unknown>)[f] || '').trim(),
    );
    if (has) {
      nextEnhance = userLocked ? { ...userLocked, ...omitEmpty(merged), source: 'user' } : merged;
      // 用户层字段保留 source=user；LLM 只填空位时仍标 user 会混。分开存：
      if (userLocked) {
        nextEnhance = { ...userLocked };
        for (const f of DRAMA_ENHANCE_ALLOWED_DIRECTING_FIELDS) {
          if (String((userLocked as unknown as Record<string, unknown>)[f] || '').trim()) continue;
          const v = String((merged as unknown as Record<string, unknown>)[f] || '').trim();
          if (v) (nextEnhance as unknown as Record<string, unknown>)[f] = v;
        }
      } else {
        nextEnhance = merged;
      }
    }
  }

  const revision: DramaDirectingEnhanceRevision = {
    at: now,
    accepted: true,
    patch,
    original_performance_plan,
    enhanced_performance_plan: nextPlan,
    ...(original_directing_enhance ? { original_directing_enhance } : {}),
    ...(nextEnhance ? { enhanced_directing_enhance: nextEnhance } : {}),
    blocked,
  };

  return {
    shot: {
      ...shot,
      performance_plan: nextPlan,
      ...(nextEnhance ? { directing_enhance: nextEnhance } : {}),
      directing_enhance_revision: revision,
    },
    revision,
  };
}

function omitEmpty(e: DramaShotDirectingEnhance): Partial<DramaShotDirectingEnhance> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(e)) {
    if (k === 'source' || k === 'updated_at') continue;
    if (String(v || '').trim()) out[k] = v;
  }
  return out;
}

export function revertDramaDirectingEnhance(shot: DramaShot): DramaShot {
  const rev = shot.directing_enhance_revision;
  if (!rev) return shot;
  return {
    ...shot,
    performance_plan: [...(rev.original_performance_plan || [])],
    directing_enhance: rev.original_directing_enhance,
    directing_enhance_revision: { ...rev, accepted: false },
  };
}

export function pickMergedPerformanceField(
  beats: DramaPerformanceBeat[],
  characterId: string,
  field: keyof DramaPerformanceBeat,
  opts?: { audioEventId?: string; timelineEventId?: string; structured?: string },
): { value: string; source: DramaDirectingSource | 'structured' | 'default' } {
  const cid = String(characterId || '').trim();
  const audioId = String(opts?.audioEventId || '').trim();
  const tlId = String(opts?.timelineEventId || '').trim();
  const match = (b: DramaPerformanceBeat, src: DramaDirectingSource) => {
    if (b.source !== src || b.character_id !== cid) return '';
    if (audioId && b.audio_event_id && b.audio_event_id !== audioId) return '';
    if (tlId && b.timeline_event_id && b.timeline_event_id !== tlId) return '';
    return String((b as unknown as Record<string, unknown>)[field] || '').trim();
  };
  for (const b of beats) {
    const v = match(b, 'user');
    if (v) return { value: v, source: 'user' };
  }
  const structured = String(opts?.structured || '').trim();
  if (structured) return { value: structured, source: 'structured' };
  for (const b of beats) {
    const v = match(b, 'llm_enhanced');
    if (v) return { value: v, source: 'llm_enhanced' };
  }
  return { value: '', source: 'default' };
}
