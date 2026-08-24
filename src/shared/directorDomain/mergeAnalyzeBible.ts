/**
 * 分析新一集时：按名字对齐项目圣经，保留已有形象/声音/场景图。
 * 禁止用本集 LLM 结果整表替换，否则第一集人物会被冲掉。
 */

import { dramaNewId } from './ids.js';
import type {
  DramaCharacter,
  DramaCharacterCostume,
  DramaCreature,
  DramaOrganization,
  DramaProp,
  DramaSceneAsset,
  DramaVoice,
} from './types.js';
import {
  canonicalizeDramaCreatureName,
  composeDramaCreatureDesignPrompt,
  coreDramaPersonName,
  dramaCreaturePromptLooksHuman,
  dramaNameCostumeSuffix,
  isDramaManualCharacterCardName,
  namesLikelySameDramaCreature,
  namesLikelySameDramaPerson,
  preferCanonicalDramaCreatureName,
  preferCanonicalDramaPersonName,
} from './extractCastFromScript.js';

export function normDramaAssetName(name: string): string {
  return String(name || '')
    .trim()
    .replace(/\s+/g, '')
    .toLowerCase();
}

function firstMedia(...vals: Array<string | undefined>): string {
  for (const v of vals) {
    const s = String(v || '').trim();
    if (s) return s;
  }
  return '';
}

function mergeCostumes(
  prev: DramaCharacterCostume[] | undefined,
  incoming: DramaCharacterCostume[] | undefined,
): DramaCharacterCostume[] {
  const prevList = Array.isArray(prev) ? prev : [];
  const nextList = Array.isArray(incoming) ? incoming : [];
  if (!prevList.length) return nextList;
  if (!nextList.length) return prevList;
  const prevByKey = new Map<string, DramaCharacterCostume>();
  for (const c of prevList) {
    const k = normDramaAssetName(c.name) || normDramaAssetName(c.tag || '') || c.costume_id;
    if (k && !prevByKey.has(k)) prevByKey.set(k, c);
  }
  const used = new Set<string>();
  const out = nextList.map((inc, i) => {
    const k = normDramaAssetName(inc.name) || normDramaAssetName(inc.tag || '');
    const hit = (k && prevByKey.get(k)) || prevList[i];
    if (!hit) return inc;
    used.add(hit.costume_id);
    const images = (hit.images || []).filter(Boolean).length
      ? hit.images
      : inc.images;
    return {
      ...inc,
      costume_id: hit.costume_id,
      images: images || [],
      active: hit.active || inc.active,
    };
  });
  for (const c of prevList) {
    if (!used.has(c.costume_id)) out.push(c);
  }
  return out;
}

function extraAliasCostume(name: string): DramaCharacterCostume {
  return {
    costume_id: dramaNewId('costume'),
    name,
    prompt: '',
    images: [],
    active: false,
    tag: name,
  };
}

function foldDramaCharacter(keep: DramaCharacter, drop: DramaCharacter): DramaCharacter {
  const imageUrl = firstMedia(keep.imageUrl, drop.imageUrl);
  const suffix = dramaNameCostumeSuffix(drop.name) || dramaNameCostumeSuffix(keep.name);
  let costumes = mergeCostumes(keep.costumes, drop.costumes);
  if (suffix) {
    const key = normDramaAssetName(suffix);
    const exists = costumes.some(
      (c) => normDramaAssetName(c.name) === key || normDramaAssetName(c.tag || '') === key,
    );
    if (!exists) {
      costumes = [
        ...costumes,
        extraAliasCostume(suffix),
      ];
    }
    const dropImg = String(drop.imageUrl || '').trim();
    if (dropImg) {
      costumes = costumes.map((c) => {
        if (normDramaAssetName(c.name) !== key && normDramaAssetName(c.tag || '') !== key) return c;
        if ((c.images || []).some(Boolean)) return c;
        return { ...c, images: [dropImg] };
      });
    }
  }
  const hasLook = !!imageUrl;
  return {
    ...keep,
    name: preferCanonicalDramaPersonName(keep.name, drop.name),
    imageUrl,
    status: hasLook ? keep.status || drop.status || 'ready' : keep.status,
    error: hasLook ? undefined : keep.error || drop.error,
    prompt: hasLook && String(keep.prompt || '').trim() ? keep.prompt : keep.prompt || drop.prompt,
    visual: keep.visual || drop.visual,
    visual_anchors: keep.visual_anchors?.length ? keep.visual_anchors : drop.visual_anchors,
    reference_images: keep.reference_images?.length ? keep.reference_images : drop.reference_images,
    assets: keep.assets?.frontImage || keep.assets?.fullBodyImage ? keep.assets : drop.assets,
    views: keep.views || drop.views,
    costumes,
    voice_id: keep.voice_id || drop.voice_id,
    speaker_id: keep.speaker_id || drop.speaker_id,
    identity: keep.identity || drop.identity,
    role: keep.role || drop.role,
  };
}

/** 周一川 / 一川 / 一川/黑衣打手 收成一条；斜杠后缀变成服装 */
export function dedupeDramaCharactersByAlias(chars: DramaCharacter[]): {
  characters: DramaCharacter[];
  idMap: Map<string, string>;
} {
  const out: DramaCharacter[] = [];
  const idMap = new Map<string, string>();
  for (const c of chars || []) {
    const idx = out.findIndex((x) => namesLikelySameDramaPerson(x.name, c.name));
    if (idx < 0) {
      const suffix = dramaNameCostumeSuffix(c.name);
      const next: DramaCharacter = {
        ...c,
        name: coreDramaPersonName(c.name) || c.name,
      };
      if (suffix) {
        const key = normDramaAssetName(suffix);
        const exists = (next.costumes || []).some(
          (x) => normDramaAssetName(x.name) === key || normDramaAssetName(x.tag || '') === key,
        );
        if (!exists) {
          next.costumes = [
            ...(next.costumes || []),
            extraAliasCostume(suffix),
          ];
        }
      }
      out.push(next);
      continue;
    }
    if (
      isDramaManualCharacterCardName(c.name) ||
      isDramaManualCharacterCardName(out[idx].name)
    ) {
      out.push(c);
      continue;
    }
    idMap.set(c.character_id, out[idx].character_id);
    out[idx] = foldDramaCharacter(out[idx], c);
  }
  return { characters: out, idMap };
}

function findPrevCharacter(
  prevList: DramaCharacter[],
  prevByName: Map<string, DramaCharacter>,
  name: string,
) {
  const exact = prevByName.get(normDramaAssetName(name));
  if (exact) return exact;
  const core = coreDramaPersonName(name);
  if (core) {
    const hit = prevByName.get(normDramaAssetName(core));
    if (hit) return hit;
  }
  const fuzzy = prevList.find((p) => namesLikelySameDramaPerson(p.name, name));
  if (fuzzy) return fuzzy;
  const key = normDramaAssetName(core || name);
  if (key.length < 3) return undefined;
  return prevList.find((p) => {
    const pk = normDramaAssetName(coreDramaPersonName(p.name) || p.name);
    if (pk.length < 3) return false;
    return key.endsWith(pk) || pk.endsWith(key);
  });
}

export function mergeAnalyzeCharacters(
  incoming: DramaCharacter[],
  prev: DramaCharacter[] | undefined,
): DramaCharacter[] {
  const prevList = prev || [];
  const prevByName = new Map<string, DramaCharacter>();
  for (const c of prevList) {
    const k = normDramaAssetName(c.name);
    if (k && !prevByName.has(k)) prevByName.set(k, c);
    const core = coreDramaPersonName(c.name);
    if (core && !prevByName.has(normDramaAssetName(core))) {
      prevByName.set(normDramaAssetName(core), c);
    }
  }
  const used = new Set<string>();
  const merged = (incoming || []).map((inc) => {
    const hit = findPrevCharacter(prevList, prevByName, inc.name);
    if (!hit) return inc;
    used.add(hit.character_id);
    return foldDramaCharacter(
      {
        ...inc,
        character_id: hit.character_id,
        voice_id: hit.voice_id || inc.voice_id,
        speaker_id: hit.speaker_id || inc.speaker_id,
        asset_version: hit.asset_version || inc.asset_version,
        asset_version_label: hit.asset_version_label || inc.asset_version_label,
      },
      hit,
    );
  });
  for (const c of prevList) {
    if (used.has(c.character_id)) continue;
    const hit = merged.find((m) => namesLikelySameDramaPerson(m.name, c.name));
    if (hit) {
      const idx = merged.indexOf(hit);
      merged[idx] = foldDramaCharacter(hit, c);
      used.add(c.character_id);
      continue;
    }
    merged.push(c);
  }
  return dedupeDramaCharactersByAlias(merged).characters;
}

export function mergeAnalyzeVoices(
  incoming: DramaVoice[],
  characters: DramaCharacter[],
  prev: DramaVoice[] | undefined,
): DramaVoice[] {
  const prevList = prev || [];
  const prevByChar = new Map<string, DramaVoice>();
  const prevById = new Map<string, DramaVoice>();
  for (const v of prevList) {
    prevById.set(v.voice_id, v);
    const cid = String(v.character_id || '').trim();
    if (cid && !prevByChar.has(cid)) prevByChar.set(cid, v);
  }
  const incomingByChar = new Map<string, DramaVoice>();
  for (const v of incoming || []) {
    const cid = String(v.character_id || '').trim();
    if (cid && !incomingByChar.has(cid)) incomingByChar.set(cid, v);
  }
  const used = new Set<string>();
  const out: DramaVoice[] = [];
  for (const ch of characters) {
    const prevV =
      (ch.voice_id && prevById.get(ch.voice_id)) || prevByChar.get(ch.character_id);
    const incV = incomingByChar.get(ch.character_id);
    if (prevV && String(prevV.sample_url || '').trim()) {
      used.add(prevV.voice_id);
      out.push({
        ...prevV,
        character_id: ch.character_id,
        sample_text: String(prevV.sample_text || '').trim() || incV?.sample_text || prevV.sample_text,
      });
      continue;
    }
    if (prevV) {
      used.add(prevV.voice_id);
      out.push({
        ...prevV,
        ...(!String(prevV.sample_text || '').trim() && incV?.sample_text
          ? { sample_text: incV.sample_text }
          : {}),
        character_id: ch.character_id,
      });
      continue;
    }
    if (incV) {
      used.add(incV.voice_id);
      out.push({ ...incV, character_id: ch.character_id });
    }
  }
  for (const v of prevList) {
    if (!used.has(v.voice_id)) out.push(v);
  }
  return out;
}

function mergeByNames<T extends { name: string }>(
  incoming: T[],
  prev: T[] | undefined,
  idKey: keyof T,
  extraNameKeys: Array<keyof T>,
  keepMedia: (prevItem: T, incomingItem: T) => T,
): T[] {
  const prevList = prev || [];
  const prevByName = new Map<string, T>();
  const add = (item: T, raw: unknown) => {
    const k = normDramaAssetName(String(raw || ''));
    if (k && !prevByName.has(k)) prevByName.set(k, item);
  };
  for (const item of prevList) {
    add(item, item.name);
    for (const key of extraNameKeys) add(item, item[key]);
  }
  const used = new Set<string>();
  const merged = (incoming || []).map((inc) => {
    const keys = [inc.name, ...extraNameKeys.map((k) => inc[k])];
    let hit: T | undefined;
    for (const raw of keys) {
      hit = prevByName.get(normDramaAssetName(String(raw || '')));
      if (hit) break;
    }
    if (!hit) return inc;
    used.add(String(hit[idKey]));
    return keepMedia(hit, inc);
  });
  for (const item of prevList) {
    if (!used.has(String(item[idKey]))) merged.push(item);
  }
  return merged;
}

export function mergeAnalyzeScenes(
  incoming: DramaSceneAsset[],
  prev: DramaSceneAsset[] | undefined,
): DramaSceneAsset[] {
  return mergeByNames(incoming, prev, 'scene_id', ['location'], (hit, inc) => {
    const imageUrl = firstMedia(hit.imageUrl, inc.imageUrl);
    return {
      ...inc,
      scene_id: hit.scene_id,
      imageUrl,
      status: imageUrl ? hit.status || 'ready' : inc.status,
      variants: hit.variants?.length ? hit.variants : inc.variants,
      prompt: imageUrl && String(hit.prompt || '').trim() ? hit.prompt : inc.prompt,
    };
  });
}

export function mergeAnalyzeProps(
  incoming: DramaProp[],
  prev: DramaProp[] | undefined,
): DramaProp[] {
  return mergeByNames(incoming, prev, 'prop_id', [], (hit, inc) => {
    const imageUrl = firstMedia(hit.imageUrl, inc.imageUrl);
    return {
      ...inc,
      prop_id: hit.prop_id,
      imageUrl,
      status: imageUrl ? hit.status || 'ready' : inc.status,
      prompt: imageUrl && String(hit.prompt || '').trim() ? hit.prompt : inc.prompt,
    };
  });
}

export function mergeAnalyzeCreatures(
  incoming: DramaCreature[],
  prev: DramaCreature[] | undefined,
): DramaCreature[] {
  const prevList = prev || [];
  const used = new Set<string>();
  const merged = (incoming || []).map((inc) => {
    const hit = prevList.find(
      (p) => !used.has(p.creature_id) && namesLikelySameDramaCreature(p.name, inc.name),
    );
    const name = preferCanonicalDramaCreatureName(
      canonicalizeDramaCreatureName(inc.name) || inc.name,
      canonicalizeDramaCreatureName(hit?.name || '') || hit?.name || inc.name,
    );
    if (!hit) {
      const humanish = dramaCreaturePromptLooksHuman(inc.prompt) || dramaCreaturePromptLooksHuman(inc.appearance);
      return {
        ...inc,
        name,
        appearance: humanish ? '' : inc.appearance,
        prompt: composeDramaCreatureDesignPrompt({
          name,
          appearance: humanish ? '' : inc.appearance,
          behavior: inc.behavior,
          prompt: humanish ? '' : inc.prompt,
        }),
        ...(humanish ? { imageUrl: '', status: 'pending' as const } : {}),
      };
    }
    used.add(hit.creature_id);
    const humanPrev =
      dramaCreaturePromptLooksHuman(hit.prompt) ||
      dramaCreaturePromptLooksHuman(hit.appearance) ||
      /血条|进度条|生命值|HP|面板/.test(String(hit.name || ''));
    const humanInc =
      dramaCreaturePromptLooksHuman(inc.prompt) || dramaCreaturePromptLooksHuman(inc.appearance);
    const imageUrl = humanPrev || humanInc ? '' : firstMedia(hit.imageUrl, inc.imageUrl);
    return {
      ...inc,
      creature_id: hit.creature_id,
      name,
      appearance: humanInc
        ? hit.appearance && !dramaCreaturePromptLooksHuman(hit.appearance)
          ? hit.appearance
          : ''
        : inc.appearance,
      imageUrl,
      status: imageUrl ? hit.status || 'ready' : inc.status || 'pending',
      prompt: composeDramaCreatureDesignPrompt({
        name,
        appearance: humanInc ? '' : inc.appearance || hit.appearance,
        behavior: inc.behavior || hit.behavior,
        prompt: humanInc ? (humanPrev ? '' : hit.prompt) : inc.prompt,
      }),
    };
  });
  for (const item of prevList) {
    if (used.has(item.creature_id)) continue;
    const name = canonicalizeDramaCreatureName(item.name) || item.name;
    const humanish =
      dramaCreaturePromptLooksHuman(item.prompt) ||
      dramaCreaturePromptLooksHuman(item.appearance) ||
      /血条|进度条|生命值|HP|面板/.test(String(item.name || ''));
    merged.push({
      ...item,
      name,
      appearance: humanish ? '' : item.appearance,
      prompt: composeDramaCreatureDesignPrompt({
        name,
        appearance: humanish ? '' : item.appearance,
        prompt: humanish ? '' : item.prompt,
      }),
      ...(humanish ? { imageUrl: '', status: 'pending' as const } : {}),
    });
  }
  return merged;
}

export function mergeAnalyzeOrganizations(
  incoming: DramaOrganization[],
  prev: DramaOrganization[] | undefined,
): DramaOrganization[] {
  return mergeByNames(incoming, prev, 'organization_id', [], (hit, inc) => ({
    ...inc,
    organization_id: hit.organization_id,
    imageUrl: firstMedia(hit.imageUrl, inc.imageUrl) || hit.imageUrl,
    status: hit.imageUrl ? hit.status || 'ready' : inc.status,
  }));
}
