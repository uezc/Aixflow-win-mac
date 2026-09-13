/**
 * Domain Contract v1 Migration：旧 Session → 新字段默认值。
 * 不伪造 visual_anchors / scene locks / 资产事实；缺则标记 needs_reanalyze。
 */

import { deriveCharacterVisualAnchors } from './constraints.js';
import { DIRECTOR_DOMAIN_CONTRACT_VERSION } from './principles.js';
import type {
  DramaDialogueLine,
  DramaDirectorSession,
  DramaGenerationPackage,
  DramaShot,
  DramaShotCastMember,
  DramaVoice,
  DramaVoiceIdentity,
  DramaVoicePerformance,
} from './types.js';
import { normalizeDramaEmotion } from './shotPlanning.js';

function str(v: unknown): string {
  return String(v || '').trim();
}

function syncMasterRefs<T extends { kind?: string; url?: string; ref_id?: string; label?: string }>(
  refs: T[] | undefined,
  imageUrl: string,
  id: string,
): T[] {
  const img = str(imageUrl);
  const list = Array.isArray(refs) ? [...refs] : [];
  if (!img) return list;
  const idx = list.findIndex((r) => r.kind === 'master' || r.kind === 'main');
  if (idx >= 0) {
    if (str(list[idx]?.url) === img) return list;
    return list.map((r, i) => (i === idx ? { ...r, kind: 'master', url: img } : r));
  }
  return [
    { ref_id: `ref-${id}-master`, kind: 'master', url: img, label: 'master' } as T,
    ...list,
  ];
}

function emptyIdentity(partial?: Partial<DramaVoiceIdentity>): DramaVoiceIdentity {
  return {
    gender: str(partial?.gender),
    age_range: str(partial?.age_range),
    pitch: str(partial?.pitch),
    timbre: str(partial?.timbre),
    accent: str(partial?.accent),
    pronunciation: str(partial?.pronunciation),
    dry_wet: str(partial?.dry_wet),
    speaking_rate: str(partial?.speaking_rate),
    voice_character: str(partial?.voice_character),
    reference_audio: str(partial?.reference_audio),
  };
}

function emptyPerformance(
  partial?: Partial<DramaVoicePerformance>,
): DramaVoicePerformance {
  return {
    emotion: str(partial?.emotion),
    delivery: str(partial?.delivery),
    pause: str(partial?.pause),
    stress: str(partial?.stress),
    pitch_change: str(partial?.pitch_change),
    speaking_rate: str(partial?.speaking_rate),
    performance: str(partial?.performance),
  };
}

function emptyDialogue(partial?: Partial<DramaDialogueLine>): DramaDialogueLine {
  return {
    dialogue_id: str(partial?.dialogue_id),
    character_id: str(partial?.character_id),
    character_name: str(partial?.character_name),
    text: str(partial?.text),
    ...(partial?.performance
      ? { performance: emptyPerformance(partial.performance) }
      : {}),
  };
}

function emptyCast(partial?: Partial<DramaShotCastMember>): DramaShotCastMember {
  return {
    character_id: str(partial?.character_id),
    screen_position: str(partial?.screen_position),
    action: str(partial?.action),
    emotion: normalizeDramaEmotion(partial?.emotion),
    expression: str(partial?.expression),
    performance: str(partial?.performance),
    dialogue_ids: Array.isArray(partial?.dialogue_ids)
      ? partial!.dialogue_ids.map(String)
      : [],
    voice_id: str(partial?.voice_id),
    ...(partial?.temporary_state !== undefined
      ? { temporary_state: str(partial.temporary_state) }
      : {}),
    ...(partial?.costume_id ? { costume_id: str(partial.costume_id) } : {}),
  };
}

function migrateVoice(v: DramaVoice): DramaVoice {
  const identity = emptyIdentity({
    ...(v.identity || {}),
    timbre: str(v.identity?.timbre) || str(v.timbre),
    voice_character: str(v.identity?.voice_character) || str(v.voiceStyle),
    reference_audio: str(v.identity?.reference_audio) || str(v.sample_url),
  });
  const needs = !str(identity.timbre) || /默认音色|音色待定/.test(identity.timbre);
  return {
    ...v,
    identity,
    sample_text: str(v.sample_text),
    asset_version: Number(v.asset_version) > 0 ? Number(v.asset_version) : 1,
    ...(needs ? { needs_reanalyze: true } : {}),
  };
}

function migrateShot(shot: DramaShot): DramaShot {
  const finalPrompt = str(shot.final_prompt);
  const cache = str(shot.adapter_prompt_cache) || finalPrompt;
  const dialogue = (shot.dialogue || []).map((d, i) =>
    emptyDialogue({
      ...d,
      dialogue_id: str(d.dialogue_id) || `dlg-${shot.shot_id}-${i + 1}`,
      performance: d.performance ? emptyPerformance(d.performance) : undefined,
    }),
  );

  let cast = Array.isArray(shot.cast) ? shot.cast.map((c) => emptyCast(c)) : [];
  if (!cast.length && (shot.character_ids || []).length) {
    cast = (shot.character_ids || []).map((id) => {
      const lines = dialogue.filter((x) => x.character_id === id).map((x) => x.dialogue_id);
      return emptyCast({
        character_id: id,
        dialogue_ids: lines,
        voice_id: '',
      });
    });
  }

  const beatId = str(shot.beat_id) || str(shot.scene_beat_id);

  return {
    ...shot,
    beat_id: beatId,
    scene_beat_id: str(shot.scene_beat_id) || beatId,
    cast,
    dialogue,
    required_prop_ids: Array.isArray(shot.required_prop_ids)
      ? shot.required_prop_ids.map(String)
      : [],
    composition: str(shot.composition),
    lighting_override: str(shot.lighting_override),
    environment: str(shot.environment),
    adapter_prompt_cache: cache,
    final_prompt: finalPrompt,
  };
}

function migratePackage(pkg: DramaGenerationPackage): DramaGenerationPackage {
  const cache =
    str(pkg.adapter_prompt_cache) || str(pkg.prompt_structured) || str(pkg.prompt_text);
  return {
    ...pkg,
    adapter_version: str(pkg.adapter_version) || 'legacy',
    scene_reference: pkg.scene_reference ?? null,
    character_references: Array.isArray(pkg.character_references)
      ? pkg.character_references
      : [],
    prop_references: Array.isArray(pkg.prop_references) ? pkg.prop_references : [],
    voice_assets: Array.isArray(pkg.voice_assets) ? pkg.voice_assets : [],
    project_constraints: pkg.project_constraints || {
      visual_style: '',
      style_prompt: '',
      era: '',
      worldview: '',
      forbidden_elements: [],
      aspect_ratio: '',
    },
    character_locks: Array.isArray(pkg.character_locks) ? pkg.character_locks : [],
    scene_locks: Array.isArray(pkg.scene_locks) ? pkg.scene_locks : [],
    visual_style: str(pkg.visual_style),
    shot_direction: pkg.shot_direction || {
      purpose: '',
      action: '',
      blocking: '',
      composition: '',
      environment: '',
      duration_sec: 10,
      cast: [],
    },
    performance_direction: str(pkg.performance_direction),
    camera_direction: pkg.camera_direction || {
      size: '',
      framing: '',
      camera: '',
      angle: '',
      focal: '',
      move: '',
      lighting_override: '',
    },
    dialogue: Array.isArray(pkg.dialogue) ? pkg.dialogue : [],
    sound_direction: str(pkg.sound_direction),
    forbidden_elements: Array.isArray(pkg.forbidden_elements)
      ? pkg.forbidden_elements.map(String)
      : [],
    adapter_prompt_cache: cache,
    prompt_text: str(pkg.prompt_text) || cache,
    prompt_structured: str(pkg.prompt_structured) || cache,
    ref_images: Array.isArray(pkg.ref_images) ? pkg.ref_images : [],
    audio_refs: Array.isArray(pkg.audio_refs) ? pkg.audio_refs : [],
  };
}

/**
 * 将任意旧/新 Session 归一到 shot-contract.v1 字段形状。
 * - 不删除 final_prompt
 * - 不伪造锚点事实；可从已有 visual 字段整理 anchors，仍可能 needs_reanalyze
 */
export function migrateDramaSessionToContractV1(
  session: DramaDirectorSession,
): DramaDirectorSession {
  const characters = (session.bible?.characters || []).map((c) => {
    const anchors = deriveCharacterVisualAnchors(c);
    const hasAnchors = anchors.length >= 3;
    const withMaster = syncMasterRefs(c.reference_images, str(c.imageUrl), c.character_id);
    return {
      ...c,
      height: str(c.height),
      body_type: str(c.body_type) || str(c.visual?.body),
      hair_color: str(c.hair_color),
      accessories: str(c.accessories),
      material_texture: str(c.material_texture),
      visual_anchors: anchors,
      forbidden_changes: Array.isArray(c.forbidden_changes)
        ? c.forbidden_changes.map(String).filter(Boolean)
        : [],
      constraint_rules: Array.isArray(c.constraint_rules) ? c.constraint_rules : [],
      reference_images: withMaster,
      asset_version: Number(c.asset_version) > 0 ? Number(c.asset_version) : 1,
      ...(!hasAnchors || !str(c.imageUrl) ? { needs_reanalyze: c.needs_reanalyze ?? !hasAnchors } : {}),
    };
  });

  const scenes = (session.bible?.scenes || []).map((s) => {
    const withMaster = syncMasterRefs(s.reference_images, str(s.imageUrl), s.scene_id);
    const thinLock =
      !str(s.spatial_structure) &&
      !(s.fixed_elements || []).length &&
      !(s.forbidden_elements || []).length;
    return {
      ...s,
      architecture: str(s.architecture),
      materials: str(s.materials),
      light_sources: str(s.light_sources),
      color_palette: str(s.color_palette),
      camera_visible_area: str(s.camera_visible_area),
      forbidden_elements: Array.isArray(s.forbidden_elements)
        ? s.forbidden_elements.map(String)
        : [],
      reference_images: withMaster,
      asset_version: Number(s.asset_version) > 0 ? Number(s.asset_version) : 1,
      ...(thinLock ? { needs_reanalyze: true } : {}),
    };
  });

  const props = (session.bible?.props || []).map((p) => {
    const withMaster = syncMasterRefs(p.reference_images, str(p.imageUrl), p.prop_id);
    return {
      ...p,
      material: str(p.material),
      appearance: str(p.appearance) || str(p.description),
      reference_images: withMaster,
      asset_version: Number(p.asset_version) > 0 ? Number(p.asset_version) : 1,
    };
  });

  const voices = (session.bible?.voices || []).map(migrateVoice);
  const scene_beats = (session.scene_beats || []).map((b) => ({
    ...b,
    purpose: str(b.purpose) || str(b.dramatic_goal),
    event: str(b.event),
    conflict: str(b.conflict),
    result: str(b.result),
    characters: Array.isArray(b.characters)
      ? b.characters.map(String)
      : Array.isArray(b.cast_ids)
        ? [...b.cast_ids]
        : [],
  }));

  const shots = (session.shots || []).map(migrateShot);
  const packages: Record<string, DramaGenerationPackage> = {};
  for (const [k, pkg] of Object.entries(session.packages || {})) {
    packages[k] = migratePackage(pkg);
  }

  const reviews = { ...(session.reviews || {}) };
  for (const [k, r] of Object.entries(reviews)) {
    reviews[k] = {
      ...r,
      verdict:
        r.verdict ||
        (r.status === 'pass' ? 'PASS' : r.status === 'fail' ? 'FAIL' : r.status === 'warn' ? 'WARNING' : undefined),
      consistency: r.consistency || {
        character_consistency: 0,
        clothing_consistency: 0,
        scene_consistency: 0,
        prop_consistency: 0,
        visual_style_consistency: 0,
        motion_quality: 0,
        dialogue_quality: 0,
      },
    };
  }

  return {
    ...session,
    meta: {
      ...session.meta,
      contract_version:
        str(session.meta.contract_version) || DIRECTOR_DOMAIN_CONTRACT_VERSION,
      default_voice_dependency_mode:
        session.meta.default_voice_dependency_mode || 'POST_PRODUCTION',
    },
    bible: {
      ...session.bible,
      characters,
      scenes,
      props,
      voices,
    },
    scene_beats,
    shots,
    packages,
    reviews,
  };
}
