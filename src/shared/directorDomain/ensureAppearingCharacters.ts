/**
 * 凡出场/对白出现的主要+次要人物必须进入圣经，便于资产生成设计形象。
 * 只出现一次的配角不建卡。角色卡按剧集、再按本集出场顺序排列。
 */

import { dramaActiveEpisodeSourceText } from './episodes.js';
import {
  createEmptyDramaCharacter,
  createEmptyDramaCreature,
  createEmptyDramaSceneAsset,
  createEmptyDramaSession,
  createEmptyDramaVoice,
  syncDramaSystemVoice,
} from './factories.js';
import {
  composeDramaCharacterDesignPrompt,
  composeDramaSceneDesignPrompt,
  composeDramaVoiceDesign,
  composeDramaVoiceSampleLine,
} from './characterDesignPrompt.js';
import { enrichDramaBibleScenesFromOriginal, extractDramaSceneEnvFactsFromOriginal } from './scenePromptFromOriginal.js';
import { collectDramaCharacterScriptLines, ensureVoiceSampleTexts } from './ensureVoiceSampleTexts.js';
import { DRAMA_SYSTEM_SPEAKER_ID, isDramaSystemSpeakerCharacter, stripDramaSystemSpeakerCharacters } from './voiceEntity.js';
import {
  coreDramaPersonName,
  extractCharacterNamesFromDialogueBlob,
  isDramaAnimalCreatureName,
  isDramaCharacterNamePlausible,
  isDramaManualCharacterCardName,
  isDramaStrictCastName,
  isSystemSpeakerName,
  mergeUniqueNames,
  namesLikelySameDramaPerson,
  salvageDramaPersonName,
  canonicalizeDramaCreatureName,
  composeDramaCreatureDesignPrompt,
  dramaCreaturePromptLooksHuman,
  namesLikelySameDramaCreature,
  preferCanonicalDramaCreatureName,
} from './extractCastFromScript.js';
import {
  collectOriginalSceneLocationsInOrder,
  collectOriginalSpeakerNamesInOrder,
  dramaCastTierLabel,
  findOriginalSpeakerAppearance,
  isDramaKeepCastSpeaker,
} from './originalScript.js';
import { dedupeDramaCharactersByAlias } from './mergeAnalyzeBible.js';
import { characterHasUsableReference } from './constraints.js';
import type { DramaCharacter, DramaDirectorSession, DramaEpisode, DramaSceneAsset, DramaVoice } from './types.js';

function normName(n: string): string {
  return String(n || '')
    .trim()
    .replace(/\s+/g, '')
    .toLowerCase();
}

function isNameInSuppressedList(suppressed: string[] | undefined, name: string): boolean {
  const list = Array.isArray(suppressed) ? suppressed : [];
  if (!list.length) return false;
  const key = normName(name);
  const core = normName(coreDramaPersonName(name));
  return list.some(
    (s) =>
      s === key ||
      s === core ||
      (core && s === core) ||
      namesLikelySameDramaPerson(s, name) ||
      namesLikelySameDramaPerson(name, s),
  );
}

function suppressKeysForName(name: string): string[] {
  const key = normName(name);
  const core = normName(coreDramaPersonName(name));
  return [...new Set([key, core].filter(Boolean))];
}

export function unsuppressDramaCharacterName(
  session: DramaDirectorSession,
  name: string,
): DramaDirectorSession {
  const prev = session.bible.suppressed_character_names || [];
  const drop = new Set(suppressKeysForName(name));
  const next = prev.filter((s) => !drop.has(s) && !isNameInSuppressedList([...drop], s));
  if (next.length === prev.length) return session;
  return {
    ...session,
    bible: { ...session.bible, suppressed_character_names: next },
  };
}

/** 素材页删除角色卡：记下名字，后续分析补全不得再自动加回来 */
export function suppressDramaCharacter(
  session: DramaDirectorSession,
  characterId: string,
): DramaDirectorSession {
  const id = String(characterId || '').trim();
  if (!id) return session;
  const ch = (session.bible?.characters || []).find((c) => c.character_id === id);
  if (!ch) return session;
  const extra = suppressKeysForName(ch.name);
  const suppressed = [
    ...new Set([...(session.bible.suppressed_character_names || []), ...extra]),
  ];
  const characters = (session.bible?.characters || []).filter((c) => c.character_id !== id);
  const voices = (session.bible.voices || []).filter(
    (v) => v.character_id !== id && v.voice_id !== ch.voice_id,
  );
  const shots = (session.shots || []).map((s) => ({
    ...s,
    character_ids: (s.character_ids || []).filter((cid) => cid !== id),
    dialogue: (s.dialogue || []).map((line) =>
      line.character_id === id ? { ...line, character_id: '' } : line,
    ),
  }));
  const scene_beats = (session.scene_beats || []).map((b) => ({
    ...b,
    cast_ids: (b.cast_ids || []).filter((cid) => cid !== id),
    characters: (b.characters || []).filter((n) => !isNameInSuppressedList(extra, String(n))),
  }));
  return {
    ...session,
    shots,
    scene_beats,
    bible: {
      ...session.bible,
      characters,
      voices,
      suppressed_character_names: suppressed,
    },
  };
}

function findCharacterByLooseName(characters: DramaCharacter[], name: string): DramaCharacter | undefined {
  const key = normName(name);
  const core = normName(coreDramaPersonName(name));
  const exact = characters.find((c) => normName(c.name) === key || normName(c.name) === core);
  if (exact) return exact;
  return characters.find((c) => namesLikelySameDramaPerson(c.name, name));
}

/** 分镜 cast_names / 对白名 → 圣经 character_id（支持「C-01 周一川」） */
export function resolveDramaCharacterIdByName(
  characters: DramaCharacter[],
  name: string,
): string {
  return findCharacterByLooseName(characters, name)?.character_id || '';
}

/** 从镜头对白、场次、分镜建议、原文说话人收集出场人名（保留小说出现顺序） */
export function collectAppearingCharacterNames(session: DramaDirectorSession): string[] {
  const epId = session.active_episode_id;
  const epBible = session.episode_bibles?.[epId];
  const fromOriginal = collectOriginalSpeakerNamesInOrder(epBible?.original_segments || []);

  const fromShots: string[] = [];
  for (const shot of session.shots || []) {
    for (const line of shot.dialogue || []) {
      const n = String(line.character_name || '').trim();
      if (n) fromShots.push(n);
    }
  }
  const fromBeats: string[] = [];
  for (const beat of session.scene_beats || []) {
    for (const n of beat.characters || []) {
      if (n) fromBeats.push(String(n));
    }
  }
  const fromSug: string[] = [];
  for (const s of epBible?.shot_suggestions || []) {
    for (const n of s.cast_names || []) {
      const t = coreDramaPersonName(n) || String(n || '').trim();
      if (t) fromSug.push(t);
    }
    fromSug.push(...extractCharacterNamesFromDialogueBlob(String(s.dialogue || '')));
  }
  const fromBindings = (epBible?.character_bindings || [])
    .filter((b) => b.speaker_type !== 'system' && !isSystemSpeakerName(b.original_name))
    .map((b) => b.original_name);

  // 顺序：原文说话人优先；其余去重追加；再严格过滤（一次过场的配角不进）
  const merged = mergeUniqueNames(fromOriginal, fromBindings, fromShots, fromBeats, fromSug);
  const sourceText = dramaActiveEpisodeSourceText(session);
  const segs = epBible?.original_segments || [];
  return merged.filter((n) => {
    if (!isDramaStrictCastName(n, sourceText)) return false;
    if (!segs.length) return true;
    return isDramaKeepCastSpeaker(n, segs);
  });
}

function appearanceRank(name: string, order: string[]): number {
  const core = coreDramaPersonName(name) || name;
  const i = order.findIndex(
    (o) => o === name || o === core || namesLikelySameDramaPerson(o, name),
  );
  return i >= 0 ? i : 10_000;
}

/** 按「先剧集、再本集出场顺序」重排人物卡；未出场的排后 */
export function sortDramaCharactersByAppearanceOrder(
  characters: DramaCharacter[],
  appearanceOrder: string[],
): DramaCharacter[] {
  if (!characters.length) return characters;
  return [...characters].sort((a, b) => {
    const ra = appearanceRank(a.name, appearanceOrder);
    const rb = appearanceRank(b.name, appearanceOrder);
    if (ra !== rb) return ra - rb;
    return 0;
  });
}

export function listDramaEpisodesInOrder(session: DramaDirectorSession): DramaEpisode[] {
  return [...(session.episodes || [])].sort((a, b) => {
    const na = Number(a.episode_no) || 0;
    const nb = Number(b.episode_no) || 0;
    if (na !== nb) return na - nb;
    return String(a.episode_id || '').localeCompare(String(b.episode_id || ''));
  });
}

/**
 * 全集人物出场序：第 1 集先出现的在前，同集内按开口先后。
 * 只收主要/次要（开口≥2）；跨集去重，以首次出场为准。
 */
export function collectSeriesCharacterAppearanceOrder(session: DramaDirectorSession): string[] {
  const out: string[] = [];
  const add = (name: string) => {
    const core = coreDramaPersonName(name) || String(name || '').trim();
    if (!core) return;
    if (out.some((o) => o === core || namesLikelySameDramaPerson(o, core))) return;
    out.push(core);
  };
  const bibles = session.episode_bibles || {};
  const episodes = listDramaEpisodesInOrder(session);
  const seenEp = new Set<string>();
  for (const ep of episodes) {
    const id = String(ep.episode_id || '').trim();
    if (!id) continue;
    seenEp.add(id);
    for (const n of collectOriginalSpeakerNamesInOrder(bibles[id]?.original_segments || [])) add(n);
  }
  const leftover = Object.keys(bibles)
    .filter((id) => id && !seenEp.has(id))
    .sort((a, b) => {
      const na = Number(bibles[a]?.episode_no) || 0;
      const nb = Number(bibles[b]?.episode_no) || 0;
      if (na !== nb) return na - nb;
      return a.localeCompare(b);
    });
  for (const id of leftover) {
    for (const n of collectOriginalSpeakerNamesInOrder(bibles[id]?.original_segments || [])) add(n);
  }
  return out;
}

/** 按场次出现顺序重排场景卡 */
export function sortDramaScenesByAppearanceOrder(
  scenes: DramaSceneAsset[],
  appearanceOrder: string[],
): DramaSceneAsset[] {
  if (!scenes.length) return scenes;
  return [...scenes].sort((a, b) => {
    const ra = appearanceRank(a.location || a.name, appearanceOrder);
    const rb = appearanceRank(b.location || b.name, appearanceOrder);
    if (ra !== rb) return ra - rb;
    return 0;
  });
}

/** 按原文场次补齐场景素材，并按出现顺序排列 */
export function ensureAppearingScenesInBible(session: DramaDirectorSession): DramaDirectorSession {
  const epId = session.active_episode_id;
  const epBible = session.episode_bibles?.[epId];
  const locations = collectOriginalSceneLocationsInOrder(epBible?.original_scenes || []);
  const storyContext = [
    session.bible.project.worldview,
    session.bible.plot,
    session.bible.project.style,
    session.bible.project.era,
  ]
    .filter(Boolean)
    .join('；');
  const eraStyle = String(session.bible.project.era || session.bible.project.style || '').trim();

  if (!locations.length) {
    const enrichedEmpty = enrichDramaBibleScenesFromOriginal(session);
    const sorted = sortDramaScenesByAppearanceOrder(enrichedEmpty.bible.scenes || [], []);
    if (
      enrichedEmpty === session &&
      sorted === session.bible.scenes
    ) {
      return session;
    }
    return {
      ...enrichedEmpty,
      bible: { ...enrichedEmpty.bible, scenes: sorted },
    };
  }

  let scenes = [...(session.bible.scenes || [])];
  let changed = false;
  const findScene = (loc: string) =>
    scenes.find(
      (s) =>
        normName(s.location) === normName(loc) ||
        normName(s.name) === normName(loc) ||
        (s.location && loc.includes(s.location)) ||
        (s.name && loc.includes(s.name)),
    );

  for (const loc of locations) {
    if (findScene(loc)) continue;
    const facts = extractDramaSceneEnvFactsFromOriginal({
      location: loc,
      original_scenes: epBible?.original_scenes,
      original_segments: epBible?.original_segments,
    });
    scenes.push(
      createEmptyDramaSceneAsset({
        name: loc,
        location: loc,
        kind: facts.kind,
        time_default: facts.time_default,
        spatial_structure: facts.spatial_structure,
        fixed_elements: facts.fixed_elements,
        prompt: composeDramaSceneDesignPrompt({
          name: loc,
          location: loc,
          kind: facts.kind,
          time_default: facts.time_default,
          spatial_structure: facts.spatial_structure,
          fixed_elements: facts.fixed_elements,
          storyContext,
          eraStyle,
        }),
        status: 'pending',
      }),
    );
    changed = true;
  }

  const sorted = sortDramaScenesByAppearanceOrder(scenes, locations);
  const base =
    changed ||
    !sorted.every((s, i) => s.scene_id === (session.bible.scenes || [])[i]?.scene_id)
      ? { ...session, bible: { ...session.bible, scenes: sorted } }
      : session;
  return enrichDramaBibleScenesFromOriginal(base);
}

/**
 * 补全圣经角色 + 默认音色；并把对白名写回 shot.character_ids。
 * 同时剔除不像人名的条目（镜头动作、画面说明、字幕等）。
 * 不覆盖已有 imageUrl / sample_url。
 */
export function ensureAppearingCharactersInBible(
  session: DramaDirectorSession,
): DramaDirectorSession {
  const stripped = stripDramaSystemSpeakerCharacters(syncDramaSystemVoice(session));
  let working = stripped;
  let characters = [...(working.bible.characters || [])];
  let voices = [...(working.bible.voices || [])];
  let creatures = [...(working.bible.creatures || [])];
  let changed = stripped !== session;

  const droppedIds = new Set<string>();
  const droppedVoiceIds = new Set<string>();
  const idMap = new Map<string, string>();
  const remapId = (id: string) => idMap.get(id) || id;

  const sourceText = dramaActiveEpisodeSourceText(session);
  const findByName = (name: string) =>
    characters.find(
      (x) =>
        normName(x.name) === normName(name) || namesLikelySameDramaPerson(x.name, name),
    );

  characters = characters.filter((c) => {
    if (isDramaSystemSpeakerCharacter(c)) {
      droppedIds.add(c.character_id);
      changed = true;
      return false;
    }
    if (isDramaAnimalCreatureName(c.name)) {
      const exists = creatures.some(
        (x) => namesLikelySameDramaCreature(x.name, c.name),
      );
      if (!exists) {
        const creatureName = canonicalizeDramaCreatureName(c.name) || c.name;
        creatures.push(
          createEmptyDramaCreature({
            name: creatureName,
            appearance: '',
            prompt: composeDramaCreatureDesignPrompt({ name: creatureName }),
            imageUrl: '',
            status: 'pending',
          }),
        );
      }
      droppedIds.add(c.character_id);
      if (c.voice_id) droppedVoiceIds.add(c.voice_id);
      changed = true;
      return false;
    }
    if (isDramaManualCharacterCardName(c.name)) return true;
    // 已有参考图：保留（用户可能故意留怪名）
    if (String(c.imageUrl || '').trim()) return true;
    const segs = session.episode_bibles?.[session.active_episode_id]?.original_segments || [];
    if (segs.length && !isDramaKeepCastSpeaker(c.name, segs)) {
      droppedIds.add(c.character_id);
      if (c.voice_id) droppedVoiceIds.add(c.voice_id);
      changed = true;
      return false;
    }
    // 严格过滤：地名/标题/系统/不像人名 → 剔除无图空卡
    if (isSystemSpeakerName(c.name) || !isDramaStrictCastName(c.name, sourceText)) {
      const salvaged = salvageDramaPersonName(c.name, sourceText);
      if (salvaged && isDramaStrictCastName(salvaged, sourceText)) {
        const existing = findByName(salvaged);
        if (existing && existing.character_id !== c.character_id) {
          idMap.set(c.character_id, existing.character_id);
          droppedIds.add(c.character_id);
          if (c.voice_id) droppedVoiceIds.add(c.voice_id);
          changed = true;
          return false;
        }
        if (salvaged !== c.name) {
          c.name = salvaged;
          changed = true;
        }
        return true;
      }
      droppedIds.add(c.character_id);
      if (c.voice_id) droppedVoiceIds.add(c.voice_id);
      changed = true;
      return false;
    }
    return true;
  });

  const alias = dedupeDramaCharactersByAlias(characters);
  if (alias.idMap.size || alias.characters.length !== characters.length) {
    changed = true;
  }
  for (const [from, to] of alias.idMap) {
    idMap.set(from, to);
  }
  characters = alias.characters;

  if (droppedIds.size || droppedVoiceIds.size || idMap.size) {
    voices = voices.filter((v) => {
      if (v.character_id === DRAMA_SYSTEM_SPEAKER_ID) return true;
      if (droppedVoiceIds.has(v.voice_id) && !characters.some((c) => c.voice_id === v.voice_id)) {
        return false;
      }
      if (droppedIds.has(v.character_id) && !idMap.has(v.character_id)) return false;
      return true;
    });
    voices = voices.map((v) => {
      const cid = remapId(v.character_id);
      return cid !== v.character_id ? { ...v, character_id: cid } : v;
    });
  }

  {
    const healed: typeof creatures = [];
    for (const c of creatures) {
      const name = canonicalizeDramaCreatureName(c.name) || c.name;
      const nameWasUiJunk = /血条|进度条|生命值|HP|面板/.test(String(c.name || ''));
      const humanish =
        dramaCreaturePromptLooksHuman(c.prompt) ||
        dramaCreaturePromptLooksHuman(c.appearance) ||
        nameWasUiJunk;
      const appearance = humanish ? '' : c.appearance;
      const prompt =
        humanish || name !== c.name || !String(c.prompt || '').trim()
          ? composeDramaCreatureDesignPrompt({
              name,
              appearance,
              prompt: humanish ? '' : c.prompt,
            })
          : c.prompt;
      const next = {
        ...c,
        name,
        appearance,
        prompt,
        ...(humanish && String(c.imageUrl || '').trim()
          ? { imageUrl: '', status: 'pending' as const }
          : {}),
      };
      const hit = healed.findIndex((x) => namesLikelySameDramaCreature(x.name, name));
      if (hit >= 0) {
        const keepName = preferCanonicalDramaCreatureName(healed[hit].name, name);
        const dropImage = humanish || !String(healed[hit].imageUrl || '').trim();
        healed[hit] = {
          ...healed[hit],
          name: keepName,
          appearance: healed[hit].appearance || next.appearance,
          prompt: healed[hit].prompt || next.prompt,
          ...(dropImage && humanish ? { imageUrl: '', status: 'pending' as const } : {}),
        };
        changed = true;
        continue;
      }
      if (next.name !== c.name || next.prompt !== c.prompt || next.imageUrl !== c.imageUrl) {
        changed = true;
      }
      healed.push(next);
    }
    creatures = healed;
  }

  const prunedSession: DramaDirectorSession = {
    ...session,
    bible: { ...session.bible, characters, voices, creatures },
  };
  const names = collectAppearingCharacterNames(prunedSession);
  const byNorm = new Map(characters.map((c) => [normName(c.name), c]));
  const suppressed = prunedSession.bible.suppressed_character_names || [];

  for (const name of names) {
    const key = normName(name);
    if (!key) continue;
    if (isNameInSuppressedList(suppressed, name)) continue;
    if (findCharacterByLooseName(characters, name)) continue;
    if (isDramaAnimalCreatureName(name)) {
      const creatureName = canonicalizeDramaCreatureName(name) || name;
      if (!creatures.some((x) => namesLikelySameDramaCreature(x.name, creatureName))) {
        creatures.push(
          createEmptyDramaCreature({
            name: creatureName,
            prompt: composeDramaCreatureDesignPrompt({ name: creatureName }),
          }),
        );
        changed = true;
      }
      continue;
    }
    if (!isDramaStrictCastName(name, sourceText)) continue;
    const segs = prunedSession.episode_bibles?.[prunedSession.active_episode_id]?.original_segments || [];
    if (segs.length && !isDramaKeepCastSpeaker(name, segs)) continue;
    const tier = findOriginalSpeakerAppearance(segs, name)?.tier || 'support';
    const role = dramaCastTierLabel(tier);
    const ch = createEmptyDramaCharacter({
      name: coreDramaPersonName(name) || name,
      role,
      identity: role,
      prompt: composeDramaCharacterDesignPrompt({
        name: coreDramaPersonName(name) || name,
        role,
        identity: role,
        prompt: '',
        storyContext: [
          session.bible.project.worldview,
          session.bible.plot,
          session.bible.project.style,
          session.bible.project.era,
        ]
          .filter(Boolean)
          .join('；'),
        eraStyle: String(session.bible.project.era || session.bible.project.style || '').trim(),
      }),
      priority: tier === 'lead' ? 'P0' : 'P1',
    });
    const designedVoice = composeDramaVoiceDesign({
      name,
      role,
    });
    const scriptLines = collectDramaCharacterScriptLines(prunedSession, {
      characterName: coreDramaPersonName(name) || name,
    });
    const voice = createEmptyDramaVoice({
      character_id: ch.character_id,
      timbre: designedVoice.timbre,
      voiceStyle: designedVoice.voiceStyle,
      language: 'zh',
      language_style: designedVoice.language_style,
      emotion_range: designedVoice.emotion_range,
      sample_text: composeDramaVoiceSampleLine({
        name,
        role,
        timbre: designedVoice.timbre,
        voiceStyle: designedVoice.voiceStyle,
        language_style: designedVoice.language_style,
        emotion_range: designedVoice.emotion_range,
        dialogueHint: scriptLines,
        forceScriptLines: Boolean(scriptLines),
      }),
    });
    ch.voice_id = voice.voice_id;
    characters.push(ch);
    voices.push(voice);
    byNorm.set(key, ch);
    changed = true;
  }

  // 每个人物必须有一条绑定声音（素材页人物卡下方的声音槽）
  for (let i = 0; i < characters.length; i++) {
    const ch = characters[i];
    const byVoiceId = ch.voice_id
      ? voices.find((v) => v.voice_id === ch.voice_id)
      : undefined;
    const byCharId = voices.find((v) => v.character_id === ch.character_id);
    const hit = byVoiceId || byCharId;
    if (hit) {
      if (ch.voice_id !== hit.voice_id) {
        characters[i] = { ...ch, voice_id: hit.voice_id };
        changed = true;
      }
      if (hit.character_id !== ch.character_id) {
        voices = voices.map((v) =>
          v.voice_id === hit.voice_id ? { ...v, character_id: ch.character_id } : v,
        );
        changed = true;
      }
      continue;
    }
    const designedVoice = composeDramaVoiceDesign({
      name: ch.name,
      role: ch.role,
      gender: ch.gender,
    });
    const scriptLines = collectDramaCharacterScriptLines(prunedSession, {
      characterId: ch.character_id,
      characterName: ch.name,
    });
    const voice = createEmptyDramaVoice({
      character_id: ch.character_id,
      timbre: designedVoice.timbre,
      voiceStyle: designedVoice.voiceStyle,
      language: 'zh',
      language_style: designedVoice.language_style,
      emotion_range: designedVoice.emotion_range,
      sample_text: composeDramaVoiceSampleLine({
        name: ch.name,
        age: ch.age,
        role: ch.role,
        identity: ch.identity,
        personality: ch.personality,
        gender: ch.gender,
        timbre: designedVoice.timbre,
        voiceStyle: designedVoice.voiceStyle,
        language_style: designedVoice.language_style,
        emotion_range: designedVoice.emotion_range,
        dialogueHint: scriptLines,
        forceScriptLines: Boolean(scriptLines),
      }),
    });
    characters[i] = { ...ch, voice_id: voice.voice_id };
    voices.push(voice);
    changed = true;
  }

  // 对白 character_id 回填 + shot.character_ids 合并；去掉已剔除人物
  const shots = (working.shots || []).map((s) => {
    let ids = [...(s.character_ids || [])]
      .map((id) => remapId(id))
      .filter((id) => {
        if (droppedIds.has(id)) {
          changed = true;
          return false;
        }
        return true;
      });
    ids = [...new Set(ids)];
    const idSet = new Set(ids);
    const dialogue = (s.dialogue || []).map((line) => {
      const n = String(line.character_name || '').trim();
      if (!n) return line;
      const ch = findCharacterByLooseName(characters, n) || byNorm.get(normName(n));
      if (!ch) return line;
      if (!idSet.has(ch.character_id)) {
        idSet.add(ch.character_id);
        ids.push(ch.character_id);
        changed = true;
      }
      if (line.character_id !== ch.character_id || line.character_name !== ch.name) {
        changed = true;
        return { ...line, character_id: ch.character_id, character_name: ch.name || n };
      }
      return line;
    });
    return { ...s, character_ids: ids, dialogue };
  });

  const scene_beats = (working.scene_beats || []).map((b) => {
    const nextCast = [...new Set((b.cast_ids || []).map((id) => remapId(id)).filter((id) => !droppedIds.has(id)))];
    const nextNames = [...new Set(
      (b.characters || [])
        .filter((n) => isDramaCharacterNamePlausible(String(n)))
        .map((n) => findCharacterByLooseName(characters, String(n))?.name || coreDramaPersonName(String(n)) || String(n)),
    )];
    if (
      nextCast.length !== (b.cast_ids || []).length ||
      nextNames.join('\0') !== (b.characters || []).join('\0')
    ) {
      changed = true;
    }
    return { ...b, cast_ids: nextCast, characters: nextNames };
  });

  if (
    !changed &&
    characters.length === (session.bible.characters || []).length &&
    creatures.length === (session.bible.creatures || []).length
  ) {
    const orderedOnly = sortDramaCharactersByAppearanceOrder(
      characters,
      collectSeriesCharacterAppearanceOrder(prunedSession),
    );
    const withChars =
      orderedOnly.map((c) => c.character_id).join('|') ===
      characters.map((c) => c.character_id).join('|')
        ? ensureVoiceSampleTexts(session)
        : ensureVoiceSampleTexts(
            createEmptyDramaSession({
              ...session,
              bible: { ...session.bible, characters: orderedOnly },
            }),
          );
    return ensureAppearingScenesInBible(withChars);
  }

  const appearanceOrder = collectSeriesCharacterAppearanceOrder({
    ...prunedSession,
    bible: { ...prunedSession.bible, characters, voices, creatures },
  });
  characters = sortDramaCharactersByAppearanceOrder(characters, appearanceOrder);

  return ensureAppearingScenesInBible(
    ensureVoiceSampleTexts(
      createEmptyDramaSession({
        ...session,
        shots,
        scene_beats,
        bible: {
          ...session.bible,
          characters,
          voices,
          creatures,
        },
      }),
    ),
  );
}

export function listCharactersMissingDesign(session: DramaDirectorSession): DramaCharacter[] {
  return (session.bible.characters || []).filter(
    (c) => !isDramaSystemSpeakerCharacter(c) && !characterHasUsableReference(c),
  );
}

export function listVoicesMissingSample(session: DramaDirectorSession): DramaVoice[] {
  return (session.bible.voices || []).filter((v) => !String(v.sample_url || '').trim());
}
