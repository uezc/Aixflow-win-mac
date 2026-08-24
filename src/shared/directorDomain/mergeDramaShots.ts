/**
 * 导演分镜：多镜合并为一镜（去重参考绑定、拼接时间轴与提示词草稿）。
 */

import { createEmptyDramaShot } from './factories.js';
import { deriveDramaAudioTimelineFromShotEvents } from './migrateH3Compiler.js';
import { resolveEffectiveDramaShotCharacterIds } from './shotCastGate.js';
import {
  createEmptyDramaTimelineEvent,
  ensureDramaShotTimelineEvents,
  normalizeDramaTimelineEvents,
} from './timelineEvent.js';
import type { DramaDialogueLine, DramaDirectorSession, DramaShot, DramaTimelineEvent } from './types.js';

function uniq(ids: string[]): string[] {
  return [...new Set(ids.map((x) => String(x || '').trim()).filter(Boolean))];
}

function joinText(a: string, b: string): string {
  const x = String(a || '').trim();
  const y = String(b || '').trim();
  if (!x) return y;
  if (!y) return x;
  if (x === y || x.includes(y)) return x;
  if (y.includes(x)) return y;
  return `${x.replace(/[。；;，,\s]+$/g, '')}。${y}`;
}

function mergeDialogueLines(lines: DramaDialogueLine[][]): DramaDialogueLine[] {
  const out: DramaDialogueLine[] = [];
  const seen = new Set<string>();
  for (const group of lines) {
    for (const line of group || []) {
      const key = `${line.character_id || ''}|${line.text || ''}`;
      if (!String(line.text || '').trim() || seen.has(key)) continue;
      seen.add(key);
      out.push({ ...line });
    }
  }
  return out;
}

function offsetTimelineEvents(
  events: DramaTimelineEvent[],
  offsetSec: number,
): DramaTimelineEvent[] {
  const off = Math.max(0, Number(offsetSec) || 0);
  return (events || []).map((e) =>
    createEmptyDramaTimelineEvent({
      ...e,
      event_id: '',
      start_sec: (Number(e.start_sec) || 0) + off,
      end_sec: (Number(e.end_sec) || 0) + off,
    }),
  );
}

function shotDurationSec(shot: DramaShot): number {
  const stored = Number(shot.duration_sec);
  if (Number.isFinite(stored) && stored > 0) return stored;
  const lastEnd = Math.max(
    0,
    ...(shot.timeline_events || []).map((e) => Number(e.end_sec) || 0),
  );
  return lastEnd > 0.1 ? lastEnd : 10;
}

/** 多镜参考绑定并集（按 asset_id / character_id 去重，保留顺序） */
export function collectMergedDramaShotBindings(
  session: DramaDirectorSession,
  shots: DramaShot[],
): {
  character_ids: string[];
  prop_ids: string[];
  required_prop_ids: string[];
  creature_ids: string[];
  scene_asset_id: string;
} {
  let character_ids: string[] = [];
  let prop_ids: string[] = [];
  let required_prop_ids: string[] = [];
  let creature_ids: string[] = [];
  let scene_asset_id = '';

  for (const shot of shots) {
    character_ids = uniq([
      ...character_ids,
      ...resolveEffectiveDramaShotCharacterIds(session, shot),
    ]);
    prop_ids = uniq([...prop_ids, ...(shot.prop_ids || [])]);
    required_prop_ids = uniq([...required_prop_ids, ...(shot.required_prop_ids || [])]);
    creature_ids = uniq([...creature_ids, ...(shot.creature_ids || [])]);
    if (!scene_asset_id && String(shot.scene_asset_id || '').trim()) {
      scene_asset_id = String(shot.scene_asset_id).trim();
    }
  }

  return {
    character_ids,
    prop_ids,
    required_prop_ids,
    creature_ids,
    scene_asset_id,
  };
}

/** 将多镜拼成单镜草稿（不含 LLM 终稿） */
export function buildMergedDramaShotsDraft(
  session: DramaDirectorSession,
  shots: DramaShot[],
): Partial<DramaShot> {
  if (!shots.length) return {};
  const [first, ...rest] = shots;
  const bindings = collectMergedDramaShotBindings(session, shots);

  let timeline: DramaTimelineEvent[] = [...(first.timeline_events || [])];
  let totalDur = shotDurationSec(first);

  let action = String(first.action || '').trim();
  let expression = String(first.expression || '').trim();
  let blocking = String(first.blocking || '').trim();
  let lighting = String(first.lighting || '').trim();
  let environment = String(first.environment || '').trim();
  let sfx = String(first.sfx || '').trim();
  let purpose = String(first.purpose || first.dramatic_purpose || '').trim();
  let continuity_notes = String(first.continuity_notes || '').trim();
  const dialogueGroups: DramaDialogueLine[][] = [first.dialogue || []];

  for (const shot of rest) {
    const dur = shotDurationSec(shot);
    timeline = [...timeline, ...offsetTimelineEvents(shot.timeline_events || [], totalDur)];
    totalDur += dur;
    action = joinText(action, shot.action || '');
    expression = joinText(expression, shot.expression || '');
    blocking = joinText(blocking, shot.blocking || '');
    lighting = joinText(lighting, shot.lighting || '');
    environment = joinText(environment, shot.environment || '');
    sfx = joinText(sfx, shot.sfx || '');
    purpose = joinText(purpose, shot.purpose || shot.dramatic_purpose || '');
    continuity_notes = joinText(continuity_notes, shot.continuity_notes || '');
    dialogueGroups.push(shot.dialogue || []);
  }

  timeline = normalizeDramaTimelineEvents(timeline, totalDur);

  const compiledParts = shots
    .map((s) =>
      String(s.h3_skill_prompt || s.last_compiled_prompt || s.final_prompt || '').trim(),
    )
    .filter(Boolean);

  const stitched = shots
    .map((s) => {
      const no = String(s.shot_no || '').trim();
      const body = String(s.action || s.purpose || '').trim();
      return body ? `【原镜${no}】${body}` : '';
    })
    .filter(Boolean)
    .join('\n');

  return {
    ...bindings,
    duration_sec: totalDur,
    timeline_events: timeline,
    action,
    expression,
    blocking,
    lighting,
    environment,
    sfx,
    purpose,
    dramatic_purpose: purpose,
    continuity_notes,
    dialogue: mergeDialogueLines(dialogueGroups),
    size: String(first.size || rest.find((s) => s.size)?.size || '').trim(),
    angle: String(first.angle || first.camera || '').trim(),
    camera: String(first.camera || first.angle || '').trim(),
    move: String(first.move || rest.find((s) => s.move)?.move || '').trim(),
    scene_beat_id: String(first.scene_beat_id || first.beat_id || '').trim(),
    beat_id: String(first.beat_id || first.scene_beat_id || '').trim(),
    video_url: '',
    video_status: '',
    video_node_id: '',
    storyboard_image_url: '',
    h3_skill_prompt: '',
    h3_skill_prompt_from: '',
    last_compiled_prompt: compiledParts.length
      ? compiledParts.join('\n\n---\n\n')
      : stitched,
    final_prompt: '',
    adapter_prompt_cache: '',
    confirmed_at: 0,
    needs_review: true,
  };
}

export type DramaMergeShotsPlan = {
  targetIndex: number;
  targetShotId: string;
  removeIndices: number[];
  patch: Partial<DramaShot>;
  mergedShot: DramaShot;
};

/** 计算多镜合并方案（按表内顺序；目标为最早一镜） */
export function planMergeDramaShots(
  session: DramaDirectorSession,
  shotIds: string[],
): DramaMergeShotsPlan | null {
  const list = session.shots || [];
  const idSet = new Set(shotIds.map((id) => String(id || '').trim()).filter(Boolean));
  if (idSet.size < 2) return null;

  const indices = list
    .map((s, i) => ({ i, id: s.shot_id }))
    .filter((x) => idSet.has(x.id))
    .map((x) => x.i)
    .sort((a, b) => a - b);
  if (indices.length < 2) return null;

  const selected = indices.map((i) => list[i]);
  const targetIndex = indices[0];
  const target = selected[0];
  const patch = buildMergedDramaShotsDraft(session, selected);
  const mergedShot = ensureDramaShotTimelineEvents({
    ...target,
    ...patch,
    shot_id: target.shot_id,
    shot_no: target.shot_no,
    audio_timeline: deriveDramaAudioTimelineFromShotEvents(
      session,
      patch.timeline_events || target.timeline_events || [],
    ),
  });

  return {
    targetIndex,
    targetShotId: target.shot_id,
    removeIndices: indices.slice(1),
    patch,
    mergedShot,
  };
}
