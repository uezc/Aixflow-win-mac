/**
 * 将 directorPipeline V1（扁平行 DirectorShot + assets 箱）迁移为 Domain V2 Session。
 */

import type { DirectorAsset, DirectorPipelineState, DirectorShot } from '../directorPipeline/schema.js';
import { dramaNewId } from './ids.js';
import {
  createEmptyDramaBible,
  createEmptyDramaCharacter,
  createEmptyDramaCreature,
  createEmptyDramaDialogueLine,
  createEmptyDramaNodeMeta,
  createEmptyDramaProp,
  createEmptyDramaSceneAsset,
  createEmptyDramaSceneBeat,
  createEmptyDramaSession,
  createEmptyDramaShot,
  createEmptyDramaVoice,
  normalizeDramaDomainPhase,
  parseDurationSec,
} from './factories.js';
import { composeDramaVoiceSampleLine } from './characterDesignPrompt.js';
import type {
  DramaCharacter,
  DramaDialogueLine,
  DramaDirectorSession,
  DramaSceneBeat,
  DramaShot,
} from './types.js';

function splitNames(raw: string): string[] {
  return String(raw || '')
    .split(/[、,，/／|]+/)
    .map((s) => s.trim())
    .filter((s) => s && s !== '—' && s !== '-');
}

function parseDialogue(raw: string, nameToId: Map<string, string>): DramaDialogueLine[] {
  const text = String(raw || '').trim();
  if (!text || text === '—' || text === '-') return [];
  const lines = text.split(/\n+/).map((l) => l.trim()).filter(Boolean);
  const out: DramaDialogueLine[] = [];
  for (const line of lines) {
    const m = line.match(/^([\u4e00-\u9fffA-Za-z0-9·]{1,16})\s*[：:]\s*(.+)$/);
    if (m) {
      const name = m[1].trim();
      out.push(
        createEmptyDramaDialogueLine({
          character_id: nameToId.get(name) || '',
          character_name: name,
          text: m[2].trim(),
        }),
      );
    } else {
      out.push(createEmptyDramaDialogueLine({ character_id: '', character_name: '', text: line }));
    }
  }
  return out;
}

function assetToCharacter(a: DirectorAsset): DramaCharacter {
  const genderRaw = String(a.gender || '').toLowerCase();
  const gender =
    genderRaw === 'male' || genderRaw === '男' ? 'male' : genderRaw === 'female' || genderRaw === '女' ? 'female' : '';
  return createEmptyDramaCharacter({
    character_id: a.id || dramaNewId('char'),
    name: a.name,
    prompt: a.prompt,
    imageUrl: a.imageUrl,
    gender: gender as DramaCharacter['gender'],
    status: a.status === 'ready' || a.imageUrl ? 'ready' : a.status === 'error' ? 'error' : 'pending',
    error: a.error,
  });
}

function parseCharacterSection(text: string): DramaCharacter[] {
  const out: DramaCharacter[] = [];
  for (const line of String(text || '').split(/\n+/)) {
    const t = line.trim();
    if (!t) continue;
    const m = t.match(/^([\u4e00-\u9fffA-Za-z0-9·]{1,16})\s*[：:]\s*(.+)$/);
    if (!m) continue;
    const name = m[1].trim();
    const prompt = m[2].trim();
    const gender = /女|female/i.test(prompt) ? 'female' : /男|male/i.test(prompt) ? 'male' : '';
    out.push(
      createEmptyDramaCharacter({
        name,
        prompt,
        gender: gender as DramaCharacter['gender'],
        role: '角色',
      }),
    );
  }
  return out;
}

function parseSceneSection(text: string) {
  const out = [];
  for (const line of String(text || '').split(/\n+/)) {
    const t = line.trim();
    if (!t) continue;
    const m = t.match(/^([^：:]{1,32})\s*[：:]\s*(.+)$/);
    if (!m) continue;
    out.push(
      createEmptyDramaSceneAsset({
        name: m[1].trim(),
        location: m[1].trim(),
        prompt: m[2].trim(),
      }),
    );
  }
  return out;
}

function parsePropSection(text: string) {
  const out = [];
  for (const line of String(text || '').split(/\n+/)) {
    const t = line.trim();
    if (!t) continue;
    const m = t.match(/^([^：:]{1,32})\s*[：:]\s*(.+)$/);
    if (m) {
      out.push(createEmptyDramaProp({ name: m[1].trim(), description: m[2].trim(), prompt: m[2].trim() }));
    } else {
      out.push(createEmptyDramaProp({ name: t, description: t, prompt: t }));
    }
  }
  return out;
}

/**
 * V1 DirectorPipelineState → DramaDirectorSession
 */
export function migrateDramaV1ToDomainV2(
  state: DirectorPipelineState | null | undefined,
): DramaDirectorSession {
  const s = state || ({} as DirectorPipelineState);
  const sections = s.mvStoryAnalysis?.sections;
  const assets = s.assets || { characters: [], scenes: [], props: [], creatures: [] };

  let characters =
    (assets.characters || []).length > 0
      ? (assets.characters || []).map(assetToCharacter)
      : parseCharacterSection(String(sections?.characters || ''));

  // 去重姓名
  const seenNames = new Set<string>();
  characters = characters.filter((c) => {
    const n = c.name;
    if (!n || seenNames.has(n)) return false;
    seenNames.add(n);
    return true;
  });

  let scenes =
    (assets.scenes || []).length > 0
      ? (assets.scenes || []).map((a) =>
          createEmptyDramaSceneAsset({
            scene_id: a.id,
            name: a.name,
            location: a.name,
            prompt: a.prompt,
            imageUrl: a.imageUrl,
            status: a.status === 'ready' || a.imageUrl ? 'ready' : 'pending',
          }),
        )
      : parseSceneSection(String(sections?.scenes || ''));

  const props =
    (assets.props || []).length > 0
      ? (assets.props || []).map((a) =>
          createEmptyDramaProp({
            prop_id: a.id,
            name: a.name,
            description: a.prompt,
            prompt: a.prompt,
            imageUrl: a.imageUrl,
            status: a.status === 'ready' || a.imageUrl ? 'ready' : 'pending',
          }),
        )
      : parsePropSection(String(sections?.props || ''));

  const creatures = (assets.creatures || []).map((a) =>
    createEmptyDramaCreature({
      creature_id: a.id,
      name: a.name,
      appearance: a.prompt,
      prompt: a.prompt,
      imageUrl: a.imageUrl,
      status: a.status === 'ready' || a.imageUrl ? 'ready' : 'pending',
    }),
  );

  const nameToId = new Map<string, string>();
  for (const c of characters) nameToId.set(c.name, c.character_id);

  const locToSceneId = new Map<string, string>();
  for (const sc of scenes) {
    locToSceneId.set(sc.name, sc.scene_id);
    if (sc.location) locToSceneId.set(sc.location, sc.scene_id);
  }

  const voices = characters
    .filter((c) => c.name)
    .map((c) =>
      createEmptyDramaVoice({
        character_id: c.character_id,
        timbre: `${c.name}音色待定`,
        language: 'zh',
        sample_text: composeDramaVoiceSampleLine({ name: c.name, role: c.role }),
      }),
    );
  for (const c of characters) {
    const v = voices.find((x) => x.character_id === c.character_id);
    if (v) c.voice_id = v.voice_id;
  }

  const bible = createEmptyDramaBible({
    project: {
      project_id: dramaNewId('proj'),
      name: String(s.title || 'AI短剧').trim(),
      type: '竖屏短剧',
      style: String(s.globalStyle || '').slice(0, 80),
      worldview: String(sections?.worldView || '').trim(),
      visual_style: String(s.globalStyle || '').trim(),
      color_style: '',
      references: [],
      era: '',
    },
    plot: String(sections?.plot || '').trim(),
    relationships: String(sections?.relationships || '').trim(),
    script_keywords: Array.isArray(s.mvStoryAnalysis?.scriptKeywords)
      ? s.mvStoryAnalysis!.scriptKeywords.map(String)
      : [],
    characters,
    scenes,
    props,
    creatures,
    voices,
    confirmed_at: 0,
  });

  const v1Shots: DirectorShot[] = Array.isArray(s.shots) ? s.shots : [];
  const beatByKey = new Map<string, DramaSceneBeat>();
  const scene_beats: DramaSceneBeat[] = [];
  const shots: DramaShot[] = [];

  for (let i = 0; i < v1Shots.length; i++) {
    const row = v1Shots[i];
    const loc = String(row['地点'] || '').trim();
    const sceneNo = String(row['场号'] || '').trim() || '1';
    const beatKey = `${sceneNo}::${loc || 'unknown'}`;
    let beat = beatByKey.get(beatKey);
    if (!beat) {
      const castNames = splitNames(String(row['出场人物'] || ''));
      const cast_ids = castNames.map((n) => nameToId.get(n) || '').filter(Boolean);
      let scene_asset_id = locToSceneId.get(loc) || '';
      if (!scene_asset_id && loc) {
        const sc = createEmptyDramaSceneAsset({ name: loc, location: loc });
        bible.scenes.push(sc);
        locToSceneId.set(loc, sc.scene_id);
        scene_asset_id = sc.scene_id;
      }
      beat = createEmptyDramaSceneBeat({
        scene_no: sceneNo,
        scene_asset_id,
        location_name: loc,
        int_ext: String(row['内外景'] || '').trim(),
        day_night: String(row['日夜'] || '').trim(),
        cast_ids,
        emotion: String(row['光影氛围'] || '').trim(),
      });
      beatByKey.set(beatKey, beat);
      scene_beats.push(beat);
    }

    const castNames = splitNames(String(row['出场人物'] || ''));
    const character_ids = castNames.map((n) => nameToId.get(n) || '').filter(Boolean);
    const dialogue = parseDialogue(String(row['对白旁白'] || ''), nameToId);
    const sb = s.storyboardsByShotNo?.[String(row['镜号'] || i + 1)];

    shots.push(
      createEmptyDramaShot({
        scene_beat_id: beat.scene_beat_id,
        shot_no: String(row['镜号'] || i + 1),
        duration_sec: parseDurationSec(row['时长'], 10),
        size: String(row['景别'] || '').trim(),
        angle: String(row['镜头角度'] || '').trim(),
        focal: String(row['焦距'] || '').trim(),
        move: String(row['运镜'] || '').trim(),
        action: String(row['画面描述'] || '').trim(),
        lighting: String(row['光影氛围'] || '').trim(),
        atmosphere: String(row['光影氛围'] || '').trim(),
        dialogue,
        sfx: String(row['音效'] || '').trim(),
        character_ids,
        scene_asset_id: beat.scene_asset_id,
        continuity_notes: String(row['连贯性'] || '').trim(),
        costume_notes: String(row['制作备注'] || '').trim(),
        final_prompt: String(row['最终提示词'] || '').trim(),
        storyboard_image_url: String(sb?.imageUrl || '').trim(),
        video_url: String(sb?.videoUrl || '').trim(),
        video_status: String(sb?.videoStatus || '').trim(),
        video_node_id: String(sb?.videoNodeId || '').trim(),
      }),
    );
  }

  return createEmptyDramaSession({
    meta: createEmptyDramaNodeMeta({
      phase: normalizeDramaDomainPhase(s.phase),
      chatModel: s.chatModel,
      imageModel: s.imageModel,
      videoBatchModel: s.videoBatchModel,
      videoBatchLipsyncModel: s.videoBatchLipsyncModel,
      stylePresetId: s.stylePresetId,
      globalStyle: s.globalStyle,
      styleReferenceImageUrl: s.styleReferenceImageUrl,
      source_script: String(s.mvScriptReference || s.scriptText || '').trim(),
      source_novel: String(s.mvScriptReference || s.scriptText || '').trim(),
      migrated_from_v1: true,
      analyze_confirmed: shots.length > 0,
      isGenerating: !!s.isGenerating,
      error: String(s.error || ''),
    }),
    bible,
    scene_beats,
    shots,
  });
}
