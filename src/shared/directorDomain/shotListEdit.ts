/**
 * 导演分镜：手动增删镜头（镜号重排；成片表按位置对齐）
 */

import { createEmptyDramaShot } from './factories.js';
import type { DramaDirectorSession, DramaShot } from './types.js';

function renumberDramaShotNos(shots: DramaShot[]): DramaShot[] {
  return shots.map((s, i) => ({
    ...s,
    shot_no: String(i + 1),
  }));
}

function unlockBoardMeta(session: DramaDirectorSession): DramaDirectorSession['meta'] {
  return {
    ...session.meta,
    board_confirmed_at: 0,
    needs_stage_reconfirm: true,
  };
}

function prunePackages(
  packages: DramaDirectorSession['packages'],
  keepShotIds: Set<string>,
): DramaDirectorSession['packages'] {
  const next: DramaDirectorSession['packages'] = { ...(packages || {}) };
  for (const id of Object.keys(next)) {
    if (!keepShotIds.has(id)) delete next[id];
  }
  return next;
}

/** 删除 index 处镜头，其后镜号前移 */
export function removeDramaShotAt(
  session: DramaDirectorSession,
  index: number,
): DramaDirectorSession {
  const list = session.shots || [];
  if (index < 0 || index >= list.length) return session;
  if (list.length <= 1) return session;
  const nextShots = renumberDramaShotNos(list.filter((_, i) => i !== index));
  const keep = new Set(nextShots.map((s) => s.shot_id));
  return {
    ...session,
    shots: nextShots,
    packages: prunePackages(session.packages, keep),
    meta: unlockBoardMeta(session),
  };
}

/**
 * 在 atIndex 插入空镜头（0=表首，length=表尾）。
 * 新镜继承邻镜场景绑定，便于立刻补提示词。
 */
export function insertDramaShotAt(
  session: DramaDirectorSession,
  atIndex: number,
): DramaDirectorSession {
  const list = session.shots || [];
  const idx = Math.max(0, Math.min(Math.floor(atIndex), list.length));
  const neighbor = list[idx] || list[idx - 1] || null;
  const blank = createEmptyDramaShot({
    shot_no: String(idx + 1),
    duration_sec: Number(neighbor?.duration_sec) > 0 ? Number(neighbor!.duration_sec) : 10,
    scene_beat_id: String(neighbor?.scene_beat_id || neighbor?.beat_id || '').trim(),
    beat_id: String(neighbor?.beat_id || neighbor?.scene_beat_id || '').trim(),
    scene_asset_id: String(neighbor?.scene_asset_id || '').trim(),
    size: String(neighbor?.size || '').trim(),
    angle: String(neighbor?.angle || '').trim(),
    move: String(neighbor?.move || '').trim(),
    lighting: String(neighbor?.lighting || '').trim(),
    environment: String(neighbor?.environment || '').trim(),
  });
  const nextShots = renumberDramaShotNos([
    ...list.slice(0, idx),
    blank,
    ...list.slice(idx),
  ]);
  const keep = new Set(nextShots.map((s) => s.shot_id));
  return {
    ...session,
    shots: nextShots,
    packages: prunePackages(session.packages, keep),
    meta: unlockBoardMeta(session),
  };
}
