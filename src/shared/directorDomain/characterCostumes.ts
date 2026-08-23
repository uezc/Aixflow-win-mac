/**
 * 同一人物多套服饰：归类、补默认装、切当前装。
 * 换装不得拆成新人物。
 */

import { createEmptyDramaAssetReferenceImage, createEmptyDramaCharacterCostume, createEmptyDramaSession } from './factories.js';
import { composeDramaCharacterDesignPrompt } from './characterDesignPrompt.js';
import type { DramaCharacter, DramaCharacterCostume, DramaDirectorSession } from './types.js';

export const DRAMA_COSTUME_TAG_ORDER = ['常服', '制服', '作战', '礼服', '家居', '其他'] as const;

export function dramaCostumeImageUrl(costume: DramaCharacterCostume | undefined | null): string {
  return String(costume?.images?.[0] || '').trim();
}

export function findDramaCostumeOwner(
  session: DramaDirectorSession,
  costumeId: string,
): { character: DramaCharacter; costume: DramaCharacterCostume } | null {
  const id = String(costumeId || '').trim();
  if (!id) return null;
  for (const ch of session.bible.characters || []) {
    const costume = (ch.costumes || []).find((c) => c.costume_id === id);
    if (costume) return { character: ch, costume };
  }
  return null;
}

export function activeDramaCostume(character: DramaCharacter): DramaCharacterCostume | undefined {
  const list = character.costumes || [];
  return list.find((c) => c.active) || list[0];
}

export function composeDramaCharacterCostumePrompt(
  character: DramaCharacter,
  costume: Pick<DramaCharacterCostume, 'name' | 'prompt'>,
): string {
  const clothing = String(costume.prompt || '').trim() || String(costume.name || '').trim();
  const base = composeDramaCharacterDesignPrompt({
    name: character.name,
    age: character.age,
    gender: character.gender,
    role: character.role,
    identity: character.identity,
    personality: character.personality,
    backstory: character.backstory,
    prompt: '',
    visual: {
      ...character.visual,
      clothing,
    },
    expression: character.states?.normal,
  });
  const look = String(costume.name || '').trim();
  return look
    ? `${base}。本套装扮：${look}。同一人物换装，五官发型体型必须与该角色其他装扮一致，只改服装与随身配饰。`
    : `${base}。同一人物换装，五官发型体型必须与该角色其他装扮一致，只改服装。`;
}

export function groupDramaCostumesByTag(
  costumes: DramaCharacterCostume[],
): { tag: string; items: DramaCharacterCostume[] }[] {
  const buckets = new Map<string, DramaCharacterCostume[]>();
  for (const c of costumes || []) {
    const tag = String(c.tag || '').trim() || '常服';
    const list = buckets.get(tag) || [];
    list.push(c);
    buckets.set(tag, list);
  }
  const ordered: { tag: string; items: DramaCharacterCostume[] }[] = [];
  for (const tag of DRAMA_COSTUME_TAG_ORDER) {
    const items = buckets.get(tag);
    if (items?.length) {
      ordered.push({ tag, items });
      buckets.delete(tag);
    }
  }
  for (const [tag, items] of buckets) {
    if (items.length) ordered.push({ tag, items });
  }
  return ordered;
}

/** 每人至少一套默认服装；无当前装则激活第一套。 */
export function ensureCharacterCostumes(
  session: DramaDirectorSession,
): DramaDirectorSession {
  let changed = false;
  const characters = (session.bible.characters || []).map((ch) => {
    let costumes = [...(ch.costumes || [])];
    if (!costumes.length) {
      const clothing = String(ch.visual?.clothing || '').trim();
      costumes = [
        createEmptyDramaCharacterCostume({
          name: '默认服装',
          prompt: clothing,
          images: String(ch.imageUrl || '').trim() ? [ch.imageUrl] : [],
          active: true,
          tag: '常服',
        }),
      ];
      changed = true;
    } else if (!costumes.some((c) => c.active)) {
      costumes = costumes.map((c, i) => (i === 0 ? { ...c, active: true } : { ...c, active: false }));
      changed = true;
    }
    // 不把主形象图写进空的当前造型：否则「新建造型」会被立刻回填旧图
    if (costumes === ch.costumes) return ch;
    return { ...ch, costumes };
  });
  if (!changed) return session;
  // 热路径：只补造型，禁止 createEmptyDramaSession 扫全部分镜（新建人物会卡死）
  return {
    ...session,
    bible: { ...session.bible, characters },
  };
}

/**
 * 设为当前装扮：切 active，并把该装图片同步到人物主形象（供分镜参考图 / H3）。
 * 无图造型会清空主卡，便于「新建造型」后重新生成。
 */
export function setActiveDramaCharacterCostume(
  session: DramaDirectorSession,
  characterId: string,
  costumeId: string,
): DramaDirectorSession {
  const cid = String(characterId || '').trim();
  const cosId = String(costumeId || '').trim();
  if (!cid || !cosId) return session;
  const ch = session.bible.characters.find((c) => c.character_id === cid);
  if (!ch) return session;
  const hit = (ch.costumes || []).find((c) => c.costume_id === cosId);
  if (!hit) return session;
  const url = dramaCostumeImageUrl(hit);
  const characters = session.bible.characters.map((c) => {
    if (c.character_id !== cid) return c;
    const nextRefs = (() => {
      const list = Array.isArray(c.reference_images)
        ? c.reference_images.map((r) => ({ ...r }))
        : [];
      const idx = list.findIndex((r) => r.kind === 'master' || r.kind === 'main');
      if (url) {
        if (idx >= 0) {
          list[idx] = { ...list[idx], kind: 'master', url, label: list[idx].label || 'master' };
          return list;
        }
        return [
          createEmptyDramaAssetReferenceImage({ kind: 'master', url, label: 'master' }),
          ...list,
        ];
      }
      if (idx >= 0) {
        list.splice(idx, 1);
      }
      return list;
    })();
    return {
      ...c,
      costumes: (c.costumes || []).map((x) => ({ ...x, active: x.costume_id === cosId })),
      imageUrl: url || '',
      status: url ? ('ready' as const) : ('pending' as const),
      reference_images: nextRefs,
      error: undefined,
    };
  });
  return createEmptyDramaSession({
    ...session,
    bible: { ...session.bible, characters },
  });
}

/** 把当前主形象另存为新造型，并切到该造型（旧造型保留） */
export function saveDramaCharacterLookAsNewCostume(
  session: DramaDirectorSession,
  characterId: string,
  opts?: { name?: string; tag?: string },
): DramaDirectorSession {
  const cid = String(characterId || '').trim();
  if (!cid) return session;
  let base = ensureCharacterCostumes(session);
  const ch = base.bible.characters.find((c) => c.character_id === cid);
  if (!ch) return session;
  const active = activeDramaCostume(ch);
  const url =
    String(ch.imageUrl || '').trim() ||
    dramaCostumeImageUrl(active) ||
    '';
  const n = (ch.costumes || []).length + 1;
  const name = String(opts?.name || '').trim() || `造型${n}`;
  const tag = String(opts?.tag || active?.tag || '其他').trim() || '其他';
  const prompt = String(active?.prompt || '').trim();
  const created = createEmptyDramaCharacterCostume({
    name,
    prompt,
    images: url ? [url] : [],
    active: true,
    tag,
  });
  base = createEmptyDramaSession({
    ...base,
    bible: {
      ...base.bible,
      characters: base.bible.characters.map((c) => {
        if (c.character_id !== cid) return c;
        return {
          ...c,
          costumes: [
            ...(c.costumes || []).map((x) => ({ ...x, active: false })),
            created,
          ],
        };
      }),
    },
  });
  return setActiveDramaCharacterCostume(base, cid, created.costume_id);
}

/** 新建空白造型并设为当前（可再生成/上传，不覆盖旧造型图） */
export function addBlankDramaCharacterCostume(
  session: DramaDirectorSession,
  characterId: string,
  opts?: { name?: string; tag?: string },
): DramaDirectorSession {
  const cid = String(characterId || '').trim();
  if (!cid) return session;
  let base = ensureCharacterCostumes(session);
  const ch = base.bible.characters.find((c) => c.character_id === cid);
  if (!ch) return session;
  const n = (ch.costumes || []).length + 1;
  const created = createEmptyDramaCharacterCostume({
    name: String(opts?.name || '').trim() || `造型${n}`,
    prompt: '',
    images: [],
    active: true,
    tag: String(opts?.tag || '其他').trim() || '其他',
  });
  base = createEmptyDramaSession({
    ...base,
    bible: {
      ...base.bible,
      characters: base.bible.characters.map((c) => {
        if (c.character_id !== cid) return c;
        return {
          ...c,
          costumes: [
            ...(c.costumes || []).map((x) => ({ ...x, active: false })),
            created,
          ],
        };
      }),
    },
  });
  return setActiveDramaCharacterCostume(base, cid, created.costume_id);
}

/** 删除一套造型（至少保留一套）；若删的是当前造型，自动切到另一套并同步主卡 */
export function removeDramaCharacterCostume(
  session: DramaDirectorSession,
  characterId: string,
  costumeId: string,
): DramaDirectorSession {
  const cid = String(characterId || '').trim();
  const cosId = String(costumeId || '').trim();
  if (!cid || !cosId) return session;
  let base = ensureCharacterCostumes(session);
  const ch = base.bible.characters.find((c) => c.character_id === cid);
  if (!ch) return session;
  const list = ch.costumes || [];
  if (list.length <= 1) return base;
  const removing = list.find((c) => c.costume_id === cosId);
  if (!removing) return base;
  const wasActive = !!removing.active || removing.costume_id === activeDramaCostume(ch)?.costume_id;
  const nextList = list.filter((c) => c.costume_id !== cosId);
  const fallbackId =
    (wasActive ? nextList[0]?.costume_id : activeDramaCostume(ch)?.costume_id) ||
    nextList[0]?.costume_id;
  base = createEmptyDramaSession({
    ...base,
    bible: {
      ...base.bible,
      characters: base.bible.characters.map((c) => {
        if (c.character_id !== cid) return c;
        return {
          ...c,
          costumes: nextList.map((x) => ({
            ...x,
            active: fallbackId ? x.costume_id === fallbackId : false,
          })),
        };
      }),
    },
  });
  if (!fallbackId) return base;
  return setActiveDramaCharacterCostume(base, cid, fallbackId);
}
