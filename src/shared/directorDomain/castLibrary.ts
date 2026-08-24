/**
 * 剧本专属人物库（工程级定妆档案）。
 * 与本集 bible 分离：分析/换集只改卡片，档案按名字保留。
 */

import { normDramaAssetName } from './mergeAnalyzeBible.js';

export const DRAMA_CAST_LIBRARY_SCHEMA = 'drama-cast-library.v1' as const;

export type DramaCastLibraryCharacter = {
  id: string;
  name: string;
  gender?: string;
  prompt?: string;
  imageUrl: string;
  voiceUrl: string;
  updated_at: number;
};

export type DramaCastLibraryScene = {
  id: string;
  name: string;
  imageUrl: string;
  updated_at: number;
};

export type DramaCastLibrary = {
  schemaVersion: typeof DRAMA_CAST_LIBRARY_SCHEMA;
  updated_at: number;
  characters: DramaCastLibraryCharacter[];
  scenes: DramaCastLibraryScene[];
};

export function createEmptyDramaCastLibrary(
  partial?: Partial<DramaCastLibrary>,
): DramaCastLibrary {
  return {
    schemaVersion: DRAMA_CAST_LIBRARY_SCHEMA,
    updated_at: Number(partial?.updated_at) || Date.now(),
    characters: Array.isArray(partial?.characters) ? partial!.characters : [],
    scenes: Array.isArray(partial?.scenes) ? partial!.scenes : [],
  };
}

export function mergeDramaCastLibrary(
  prev: DramaCastLibrary | null | undefined,
  incoming: {
    characters?: Array<Partial<DramaCastLibraryCharacter> & { name?: string }>;
    scenes?: Array<Partial<DramaCastLibraryScene> & { name?: string }>;
  },
): DramaCastLibrary {
  const base = createEmptyDramaCastLibrary(prev || undefined);
  const chars = [...base.characters];
  const charIndex = new Map<string, number>();
  chars.forEach((c, i) => {
    const k = normDramaAssetName(c.name);
    if (k && !charIndex.has(k)) charIndex.set(k, i);
  });
  for (const raw of incoming.characters || []) {
    const name = String(raw.name || '').trim();
    const key = normDramaAssetName(name);
    if (!key) continue;
    const imageUrl = String(raw.imageUrl || '').trim();
    const voiceUrl = String(raw.voiceUrl || '').trim();
    const prompt = String(raw.prompt || '').trim();
    const gender = String(raw.gender || '').trim();
    const idx = charIndex.get(key);
    if (idx == null) {
      if (!imageUrl && !voiceUrl) continue;
      charIndex.set(key, chars.length);
      chars.push({
        id: String(raw.id || '').trim() || `cast-${key}`,
        name,
        gender,
        prompt,
        imageUrl,
        voiceUrl,
        updated_at: Date.now(),
      });
      continue;
    }
    const prevChar = chars[idx];
    chars[idx] = {
      ...prevChar,
      name: name || prevChar.name,
      gender: gender || prevChar.gender,
      prompt: prompt || prevChar.prompt,
      imageUrl: imageUrl || prevChar.imageUrl,
      voiceUrl: voiceUrl || prevChar.voiceUrl,
      updated_at: Date.now(),
    };
  }

  const scenes = [...base.scenes];
  const sceneIndex = new Map<string, number>();
  scenes.forEach((s, i) => {
    const k = normDramaAssetName(s.name);
    if (k && !sceneIndex.has(k)) sceneIndex.set(k, i);
  });
  for (const raw of incoming.scenes || []) {
    const name = String(raw.name || '').trim();
    const key = normDramaAssetName(name);
    if (!key) continue;
    const imageUrl = String(raw.imageUrl || '').trim();
    const idx = sceneIndex.get(key);
    if (idx == null) {
      if (!imageUrl) continue;
      sceneIndex.set(key, scenes.length);
      scenes.push({
        id: String(raw.id || '').trim() || `cscene-${key}`,
        name,
        imageUrl,
        updated_at: Date.now(),
      });
      continue;
    }
    const prevScene = scenes[idx];
    scenes[idx] = {
      ...prevScene,
      name: name || prevScene.name,
      imageUrl: imageUrl || prevScene.imageUrl,
      updated_at: Date.now(),
    };
  }

  return {
    schemaVersion: DRAMA_CAST_LIBRARY_SCHEMA,
    updated_at: Date.now(),
    characters: chars,
    scenes,
  };
}
