/**
 * 短剧分镜图：参考素材组装 + 生图提示词（固定前缀 + 优化稿）。
 */

import { resolveDramaProductionH3Prompt } from './composeDramaShotLensPrompt.js';
import {
  resolveCharacterMasterReferenceUrl,
  resolvePropMasterReferenceUrl,
  resolveSceneMasterReferenceUrl,
} from './constraints.js';
import { resolveDramaCharacterLookUrl } from './characterCostumes.js';
import { resolveEffectiveDramaShotCharacterIds } from './shotCastGate.js';
import { isDramaShotUsingStoryboardAsVideoRef } from './shotRefs.js';
import type { DramaDirectorSession, DramaShot } from './types.js';

/** 分镜图生图固定前缀：单帧构图锚（勿出多宫格，否则出片易「从远拉近」扫格） */
export const DRAMA_STORYBOARD_IMAGE_PROMPT_PREFIX =
  '绘制本镜单帧分镜图（一张完整画面，禁止九宫格/多格分镜页/序号格子）。锁定本镜景别与构图，人物对话用气泡标在画面内即可。';

export type DramaStoryboardSourceRef = {
  url: string;
  role: 'scene' | 'character' | 'prop' | 'creature';
  name: string;
  asset_id?: string;
};

/** 生成分镜图用的参考图：场景 / 人物 / 道具 / 生物（有什么用什么） */
export function listDramaShotStoryboardSourceRefs(
  session: DramaDirectorSession,
  shot: DramaShot,
  max = 8,
): DramaStoryboardSourceRef[] {
  const out: DramaStoryboardSourceRef[] = [];
  const seen = new Set<string>();
  const push = (item: DramaStoryboardSourceRef) => {
    const url = String(item.url || '').trim();
    if (!url || out.length >= max) return;
    const key = `${item.role}::${item.asset_id || url}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ ...item, url });
  };

  const sceneId = String(shot.scene_asset_id || '').trim();
  if (sceneId) {
    const sc = (session.bible?.scenes || []).find((s) => s.scene_id === sceneId);
    const url = resolveSceneMasterReferenceUrl(sc);
    if (url) {
      push({
        url,
        role: 'scene',
        name: String(sc?.name || '场景').trim() || '场景',
        asset_id: sc?.scene_id,
      });
    }
  }

  for (const id of resolveEffectiveDramaShotCharacterIds(session, shot)) {
    const c = (session.bible?.characters || []).find((x) => x.character_id === id);
    const castMember = (shot.cast || []).find((m) => m.character_id === id);
    const lookUrl = resolveDramaCharacterLookUrl(c, castMember?.costume_id);
    const url = lookUrl || (!castMember?.costume_id ? resolveCharacterMasterReferenceUrl(c) : '');
    if (url) {
      push({
        url,
        role: 'character',
        name: String(c?.name || '人物').trim() || '人物',
        asset_id: c?.character_id,
      });
    }
  }

  const propIds = [...(shot.prop_ids || []), ...(shot.required_prop_ids || [])];
  const seenProp = new Set<string>();
  for (const id of propIds) {
    if (!id || seenProp.has(id)) continue;
    seenProp.add(id);
    const p = (session.bible?.props || []).find((x) => x.prop_id === id);
    const url = resolvePropMasterReferenceUrl(p);
    if (url) {
      push({
        url,
        role: 'prop',
        name: String(p?.name || '道具').trim() || '道具',
        asset_id: p?.prop_id,
      });
    }
  }

  for (const id of shot.creature_ids || []) {
    const c = (session.bible?.creatures || []).find((x) => x.creature_id === id);
    const url = String(c?.imageUrl || '').trim();
    if (url) {
      push({
        url,
        role: 'creature',
        name: String(c?.name || '生物').trim() || '生物',
        asset_id: c?.creature_id,
      });
    }
  }

  return out;
}

/** 分镜图生图提示词：固定前缀 + 本镜优化终稿 */
export function composeDramaShotStoryboardImagePrompt(
  session: DramaDirectorSession,
  shot: DramaShot,
  opts?: { locale?: string },
): string {
  const optimized =
    String(shot.h3_skill_prompt || '').trim() ||
    resolveDramaProductionH3Prompt(session, shot, {
      locale: opts?.locale,
      durationSec: Number(shot.duration_sec) > 0 ? Number(shot.duration_sec) : undefined,
    });
  const body = String(optimized || '').trim();
  if (!body) return DRAMA_STORYBOARD_IMAGE_PROMPT_PREFIX;
  if (body.startsWith(DRAMA_STORYBOARD_IMAGE_PROMPT_PREFIX)) return body;
  return `${DRAMA_STORYBOARD_IMAGE_PROMPT_PREFIX}\n\n${body}`;
}

export function resolveDramaShotStoryboardImageUrl(
  shot: DramaShot | null | undefined,
  pipelineImageUrl?: string | null,
): string {
  return (
    String(shot?.storyboard_image_url || '').trim() ||
    String(pipelineImageUrl || '').trim()
  );
}

/** 本镜分镜图在出片参考槽中的 1-based 序号；未启用或不存在返回 null */
export function resolveDramaShotStoryboardPictureIndex(
  _session: DramaDirectorSession,
  shot: DramaShot,
): number | null {
  if (!isDramaShotUsingStoryboardAsVideoRef(shot)) return null;
  // 启用分镜时槽位固定：分镜优先第一张
  return 1;
}
