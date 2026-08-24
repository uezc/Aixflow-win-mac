/**
 * Character / Scene 约束层：LOCK / DEFAULT / OVERRIDE / TEMPORARY
 */

import type {
  DramaCharacter,
  DramaConstraintTier,
  DramaSceneAsset,
} from './types.js';

export const DRAMA_CHARACTER_LOCK_FIELDS = [
  'identity',
  'gender',
  'core_face',
  'hair_color',
  'visual_anchors',
  'signature_clothing',
] as const;

export type DramaCharacterLockField = (typeof DRAMA_CHARACTER_LOCK_FIELDS)[number];

/** 从角色现有字段启发式提取锚点（不伪造新事实；仅整理已有文本） */
export function deriveCharacterVisualAnchors(character: DramaCharacter): string[] {
  const existing = (character.visual_anchors || []).map((x) => String(x || '').trim()).filter(Boolean);
  if (existing.length >= 3) return existing.slice(0, 5);

  const candidates: string[] = [...existing];
  const push = (s: string) => {
    const t = String(s || '').trim();
    if (!t) return;
    if (candidates.some((c) => c === t || c.includes(t) || t.includes(c))) return;
    candidates.push(t);
  };

  push(character.visual?.specialFeature);
  push(character.visual?.hair);
  if (character.hair_color) push(`${character.hair_color}发色`);
  push(character.visual?.clothing);
  push(character.visual?.face);
  push(character.visual?.body);

  return candidates.slice(0, 5);
}

function firstCostumeImage(character: DramaCharacter): string {
  const list = character.costumes || [];
  const active = list.find((c) => c.active) || list[0];
  // 只跟当前造型：空造型不得回退到其它套的图（主卡展示用）
  return String(active?.images?.[0] || '').trim();
}

/** 任意有图造型（含非当前），供分镜/H3 推送兜底 */
function anyCostumeImage(character: DramaCharacter): string {
  for (const c of character.costumes || []) {
    const u = String(c?.images?.[0] || '').trim();
    if (u) return u;
  }
  return '';
}

function legacyCharacterReferenceUrl(character: DramaCharacter): string {
  if (String(character.imageUrl || '').trim()) return String(character.imageUrl).trim();
  const master = (character.reference_images || []).find(
    (r) => r.kind === 'master' && String(r.url || '').trim(),
  );
  if (master?.url) return String(master.url).trim();
  const front = (character.reference_images || []).find(
    (r) => r.kind === 'front' && String(r.url || '').trim(),
  );
  if (front?.url) return String(front.url).trim();
  if (String(character.assets?.fullBodyImage || '').trim()) {
    return String(character.assets.fullBodyImage).trim();
  }
  if (String(character.assets?.frontImage || '').trim()) {
    return String(character.assets.frontImage).trim();
  }
  const vFull = (character.views?.full || []).find(Boolean);
  if (vFull) return String(vFull).trim();
  const vFront = (character.views?.front || []).find(Boolean);
  if (vFront) return String(vFront).trim();
  return '';
}

export function characterHasUsableReference(character: DramaCharacter | null | undefined): boolean {
  return !!resolveCharacterMasterReferenceUrl(character);
}

/**
 * 人物主参考图（分镜槽 / H3 推送）。
 * 优先当前造型；当前空时回退其它有图造型与旧主图，避免「库里有图但镜头推不出去」。
 * （空当前造型清空主卡仅影响素材页展示，不阻断出片参考。）
 */
export function resolveCharacterMasterReferenceUrl(
  character: DramaCharacter | null | undefined,
): string {
  if (!character) return '';
  const fromActive = firstCostumeImage(character);
  if (fromActive) return fromActive;
  const fromOther = anyCostumeImage(character);
  if (fromOther) return fromOther;
  return legacyCharacterReferenceUrl(character);
}

export function sceneHasUsableReference(scene: DramaSceneAsset | null | undefined): boolean {
  if (!scene) return false;
  if (String(scene.imageUrl || '').trim()) return true;
  const refs = scene.reference_images || [];
  return refs.some((r) => String(r.url || '').trim());
}

export function resolveSceneMasterReferenceUrl(scene: DramaSceneAsset | null | undefined): string {
  if (!scene) return '';
  if (String(scene.imageUrl || '').trim()) return String(scene.imageUrl).trim();
  const master = (scene.reference_images || []).find(
    (r) => (r.kind === 'master' || r.kind === 'main') && String(r.url || '').trim(),
  );
  if (master?.url) return String(master.url).trim();
  const any = (scene.reference_images || []).find((r) => String(r.url || '').trim());
  return any ? String(any.url).trim() : '';
}

export function propHasUsableReference(prop: {
  imageUrl?: string;
  reference_images?: { url?: string }[];
} | null | undefined): boolean {
  if (!prop) return false;
  if (String(prop.imageUrl || '').trim()) return true;
  return (prop.reference_images || []).some((r) => String(r.url || '').trim());
}

export function resolvePropMasterReferenceUrl(prop: {
  imageUrl?: string;
  reference_images?: { url?: string; kind?: string }[];
} | null | undefined): string {
  if (!prop) return '';
  if (String(prop.imageUrl || '').trim()) return String(prop.imageUrl).trim();
  const master = (prop.reference_images || []).find(
    (r) => r.kind === 'master' && String(r.url || '').trim(),
  );
  if (master?.url) return String(master.url).trim();
  const any = (prop.reference_images || []).find((r) => String(r.url || '').trim());
  return any ? String(any.url).trim() : '';
}

/** 约束层级说明（文档用） */
export const DRAMA_CONSTRAINT_TIER_HELP: Record<DramaConstraintTier, string> = {
  LOCK: '绝对不可被模型擅自改变（身份、核心外观、锚点、主服装等）',
  DEFAULT: '默认继承，导演可改（默认表情/姿态/光线等）',
  OVERRIDE: '本镜可覆盖（表情、动作、机位、光线等）',
  TEMPORARY: '剧情临时状态（破损、受伤、湿身、临时换装等）',
};
