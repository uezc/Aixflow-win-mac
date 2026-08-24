/**
 * 分镜卡参考图 / 参考音序号：与 GenerationPackage / H3 提交顺序对齐。
 */

import {
  buildMinimaxH3ZhRefImageSlots,
  type MinimaxH3ZhRefImageSlot,
} from '../directorPipeline/minimaxH3DramaPrompt.js';
import {
  resolveCharacterMasterReferenceUrl,
  resolvePropMasterReferenceUrl,
  resolveSceneMasterReferenceUrl,
} from './constraints.js';
import { defaultDramaReferenceLockIntent } from './migrateH3Compiler.js';
import { collectDramaShotVoiceRefUrls } from './shotAudio.js';
import { resolveEffectiveDramaShotCharacterIds } from './shotCastGate.js';
import type {
  DramaCreature,
  DramaDirectorSession,
  DramaPackageRefImage,
  DramaProp,
  DramaReferenceLockIntent,
  DramaShot,
} from './types.js';

export type DramaShotRefImageSlotView = {
  /** 1-based，与提示词 <图片N> / 参考图N 一致 */
  index: number;
  role: MinimaxH3ZhRefImageSlot['role'];
  name: string;
  url: string;
  asset_id?: string;
  lock_intent?: DramaReferenceLockIntent;
};

export type DramaShotRefAudioSlotView = {
  /** 1-based，角色参考音（本镜声音 / 视频 audio_refs 中的人声参考） */
  index: number;
  character_id: string;
  character_name: string;
  voice_id: string;
  sample_url: string;
};

function buildMatchedAssets(session: DramaDirectorSession, shot: DramaShot) {
  const matched: {
    imageUrl: string;
    name?: string;
    kind?: string;
    asset_id?: string;
  }[] = [];

  const sceneId = shot.scene_asset_id;
  if (sceneId) {
    const sc = session.bible.scenes.find((s) => s.scene_id === sceneId);
    const url = resolveSceneMasterReferenceUrl(sc);
    if (url) {
      matched.push({
        imageUrl: url,
        name: sc?.name,
        kind: 'scene',
        asset_id: sc?.scene_id,
      });
    }
  }

  // 镜级绑定 + 时间轴出场 + 文案点名：与门禁/出片一致
  const charIds = resolveEffectiveDramaShotCharacterIds(session, shot);

  for (const id of charIds) {
    const c = session.bible.characters.find((x) => x.character_id === id);
    const url = resolveCharacterMasterReferenceUrl(c);
    if (url) {
      matched.push({
        imageUrl: url,
        name: c?.name,
        kind: 'character',
        asset_id: c?.character_id,
      });
    }
  }
  const propIds = [...(shot.prop_ids || []), ...(shot.required_prop_ids || [])];
  const seenProp = new Set<string>();
  for (const id of propIds) {
    if (!id || seenProp.has(id)) continue;
    seenProp.add(id);
    const p = session.bible.props.find((x) => x.prop_id === id);
    const url = resolvePropMasterReferenceUrl(p);
    if (url) {
      matched.push({
        imageUrl: url,
        name: p?.name,
        kind: 'prop',
        asset_id: p?.prop_id,
      });
    }
  }
  for (const id of shot.creature_ids || []) {
    const c = session.bible.creatures.find((x) => x.creature_id === id);
    if (c?.imageUrl) {
      matched.push({
        imageUrl: c.imageUrl,
        name: c.name,
        kind: 'creature',
        asset_id: c.creature_id,
      });
    }
  }
  return matched;
}

/** 本镜已绑定、会占用模型参考图槽的图片数（不去重上限截断） */
export function countDramaShotRefImages(session: DramaDirectorSession, shot: DramaShot): number {
  const urls = new Set<string>();
  for (const m of buildMatchedAssets(session, shot)) {
    const u = String(m.imageUrl || '').trim();
    if (u) urls.add(u);
  }
  return urls.size;
}

/** 本镜参考图槽：短剧风格/分镜静帧不占 <图片N>；序号从场景/人物/道具等有图资产起算 */
export function listDramaShotRefImageSlots(
  session: DramaDirectorSession,
  shot: DramaShot,
  opts?: { maxImages?: number },
): DramaShotRefImageSlotView[] {
  const matched = buildMatchedAssets(session, shot);
  const byUrl = new Map(matched.map((m) => [String(m.imageUrl).trim(), m]));

  const slots = buildMinimaxH3ZhRefImageSlots({
    // 风格：仅 stylePrompt 文本约束，不提交风格图
    styleReferenceImageUrl: '',
    // 短剧出片只用本镜绑定的人物/场景/道具。MV 残留分镜静帧若作为图片1会锁死成片身份。
    storyboardImageUrl: '',
    matchedAssets: matched,
    maxImages: opts?.maxImages ?? 9,
    onlyStoryboardAndCharacters: false,
  });

  return slots.map((s, i) => {
    const url = String(s.url || '').trim();
    const hit = byUrl.get(url);
    return {
      index: i + 1,
      role: s.role,
      name: String(s.name || hit?.name || ''),
      url,
      asset_id: hit?.asset_id,
      lock_intent: defaultDramaReferenceLockIntent(s.role),
    };
  });
}

/** Package.ref_images 扁平列表（带正确 asset_id） */
export function resolveDramaShotPackageRefImages(
  session: DramaDirectorSession,
  shot: DramaShot,
): DramaPackageRefImage[] {
  return listDramaShotRefImageSlots(session, shot).map((s) => ({
    url: s.url,
    role: s.role as DramaPackageRefImage['role'],
    name: s.name,
    ...(s.asset_id ? { asset_id: s.asset_id } : {}),
    ...(s.lock_intent ? { lock_intent: s.lock_intent } : {}),
  }));
}

/** 本镜角色参考音（最多 3），序号与生成本镜声音一致 */
export function listDramaShotRefAudioSlots(
  session: DramaDirectorSession,
  shot: DramaShot,
  max = 3,
): DramaShotRefAudioSlotView[] {
  return collectDramaShotVoiceRefUrls(session, shot, max).map((r, i) => ({
    index: i + 1,
    character_id: r.character_id,
    character_name: r.character_name,
    voice_id: r.voice_id,
    sample_url: r.sample_url,
  }));
}

export function findDramaShotRefImageIndex(
  slots: DramaShotRefImageSlotView[],
  opts: { role?: string; asset_id?: string; url?: string },
): number | null {
  const assetId = String(opts.asset_id || '').trim();
  const url = String(opts.url || '').trim();
  const role = String(opts.role || '').trim();
  const hit = slots.find((s) => {
    if (assetId && s.asset_id === assetId) return true;
    if (url && s.url === url && (!role || s.role === role)) return true;
    if (role && assetId && s.role === role && s.asset_id === assetId) return true;
    return false;
  });
  return hit ? hit.index : null;
}

export function findDramaShotRefAudioIndex(
  slots: DramaShotRefAudioSlotView[],
  opts: { character_id?: string; sample_url?: string },
): number | null {
  const cid = String(opts.character_id || '').trim();
  const url = String(opts.sample_url || '').trim();
  const hit = slots.find((s) => {
    if (cid && s.character_id === cid) return true;
    if (url && s.sample_url === url) return true;
    return false;
  });
  return hit ? hit.index : null;
}

export function resolveBoardShotProps(
  session: DramaDirectorSession,
  shot: DramaShot,
): DramaProp[] {
  const ids = [...(shot.prop_ids || []), ...(shot.required_prop_ids || [])];
  const seen = new Set<string>();
  const out: DramaProp[] = [];
  for (const id of ids) {
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const p = session.bible.props.find((x) => x.prop_id === id);
    if (p) out.push(p);
  }
  return out;
}

export function resolveBoardShotCreatures(
  session: DramaDirectorSession,
  shot: DramaShot,
): DramaCreature[] {
  const out: DramaCreature[] = [];
  const seen = new Set<string>();
  for (const id of shot.creature_ids || []) {
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const c = session.bible.creatures.find((x) => x.creature_id === id);
    if (c) out.push(c);
  }
  return out;
}
