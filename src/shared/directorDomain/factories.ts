import { dramaNewId } from './ids.js';
import { normalizeDramaEpisodes } from './episodes.js';
import {
  migrateLegacyEpisodePlans,
  normalizeDramaEpisodeBibles,
  normalizeDramaProductionPlans,
} from './episodeBible.js';
import {
  createEmptyDramaProjectVisualBible,
  createEmptyDramaVisualDNA,
} from './visualDna.js';
import { applyVisualStylePreset, resolveVisualStylePresetId } from './visualStylePresets.js';
import type {
  DramaAudioEvent,
  DramaCharacter,
  DramaCharacterAssetSlots,
  DramaCharacterStates,
  DramaCharacterVisualLock,
  DramaCreature,
  DramaDialogueLine,
  DramaDirectorNodeMeta,
  DramaDirectorSession,
  DramaDomainPhase,
  DramaGenerationPackage,
  DramaOrganization,
  DramaProjectBible,
  DramaProjectInfo,
  DramaProp,
  DramaReviewResult,
  DramaSceneAsset,
  DramaSceneBeat,
  DramaShot,
  DramaShotCastMember,
  DramaShotDirectingBreakdown,
  DramaSoundBible,
  DramaSpeakerId,
  DramaStoryBible,
  DramaVisualBible,
  DramaVoice,
  DramaVoiceIdentity,
  DramaVoicePerformance,
  DramaCharacterViews,
  DramaAssetReferenceImage,
  DramaCharacterCostume,
} from './types.js';
import {
  DIRECTOR_DOMAIN_SCHEMA_VERSION,
  DIRECTOR_DOMAIN_CONTRACT_VERSION,
  DRAMA_DOMAIN_PHASES,
  normalizeDramaShotPlanPaceGear,
} from './types.js';
import { migrateDramaSessionToContractV1 } from './migrateContract.js';
import { migrateDramaSessionToH3CompilerV1 } from './migrateH3Compiler.js';

export function emptyCharacterViews(): DramaCharacterViews {
  return { front: [], half: [], full: [], multi: [], expression: [], costume: [] };
}

export function createEmptyDramaCharacterVisual(
  partial?: Partial<DramaCharacterVisualLock>,
): DramaCharacterVisualLock {
  return {
    face: String(partial?.face || '').trim(),
    hair: String(partial?.hair || '').trim(),
    body: String(partial?.body || '').trim(),
    clothing: String(partial?.clothing || '').trim(),
    specialFeature: String(partial?.specialFeature || '').trim(),
  };
}

export function createEmptyDramaCharacterStates(
  partial?: Partial<DramaCharacterStates>,
): DramaCharacterStates {
  return {
    normal: String(partial?.normal || '').trim(),
    battle: String(partial?.battle || '').trim(),
    injured: String(partial?.injured || '').trim(),
  };
}

export function createEmptyDramaCharacterAssetSlots(
  partial?: Partial<DramaCharacterAssetSlots>,
): DramaCharacterAssetSlots {
  return {
    frontImage: String(partial?.frontImage || '').trim(),
    sideImage: String(partial?.sideImage || '').trim(),
    fullBodyImage: String(partial?.fullBodyImage || '').trim(),
    expressionImages: Array.isArray(partial?.expressionImages)
      ? partial!.expressionImages.map(String).filter(Boolean)
      : [],
  };
}

function copyExtraFields(
  raw?: { label?: string; value?: string }[],
): { label: string; value: string }[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((x) => ({
    label: String(x?.label || ''),
    value: String(x?.value || ''),
  }));
}

export function createEmptyDramaStoryBible(partial?: Partial<DramaStoryBible>): DramaStoryBible {
  return {
    worldview: String(partial?.worldview || '').trim(),
    era: String(partial?.era || '').trim(),
    rules: Array.isArray(partial?.rules) ? partial!.rules.map(String).filter(Boolean) : [],
    forbidden_elements: Array.isArray(partial?.forbidden_elements)
      ? partial!.forbidden_elements.map(String).filter(Boolean)
      : [],
    synopsis: String(partial?.synopsis || '').trim(),
    extra_fields: copyExtraFields(partial?.extra_fields),
  };
}

export function createEmptyDramaVisualBible(partial?: Partial<DramaVisualBible>): DramaVisualBible {
  return {
    style: String(partial?.style || '').trim(),
    color: String(partial?.color || '').trim(),
    camera: String(partial?.camera || '').trim(),
    lighting: String(partial?.lighting || '').trim(),
    referenceWorks: Array.isArray(partial?.referenceWorks)
      ? partial!.referenceWorks.map(String).filter(Boolean)
      : [],
    negativePrompt: String(partial?.negativePrompt || '').trim(),
    extra_fields: copyExtraFields(partial?.extra_fields),
  };
}

export function createEmptyDramaSoundBible(partial?: Partial<DramaSoundBible>): DramaSoundBible {
  return {
    voiceStyle: String(partial?.voiceStyle || '').trim(),
    emotionRange: String(partial?.emotionRange || '').trim(),
    ambientSound: Array.isArray(partial?.ambientSound)
      ? partial!.ambientSound.map(String).filter(Boolean)
      : [],
    musicStyle: String(partial?.musicStyle || '').trim(),
    extra_fields: copyExtraFields(partial?.extra_fields),
  };
}

export function createEmptyDramaOrganization(
  partial?: Partial<DramaOrganization>,
): DramaOrganization {
  return {
    organization_id: partial?.organization_id || dramaNewId('org'),
    name: String(partial?.name || '').trim(),
    kind: String(partial?.kind || '').trim(),
    description: String(partial?.description || '').trim(),
    visual_traits: String(partial?.visual_traits || '').trim(),
    related_character_ids: Array.isArray(partial?.related_character_ids)
      ? partial!.related_character_ids.map(String)
      : [],
    imageUrl: String(partial?.imageUrl || '').trim(),
    status: partial?.status || (partial?.imageUrl ? 'ready' : 'pending'),
    priority: partial?.priority,
    error: partial?.error,
  };
}

export function createEmptyDramaProjectInfo(partial?: Partial<DramaProjectInfo>): DramaProjectInfo {
  return {
    project_id: partial?.project_id || dramaNewId('proj'),
    name: String(partial?.name || '未命名短剧').trim() || '未命名短剧',
    type: String(partial?.type || '竖屏短剧').trim(),
    style: String(partial?.style || '').trim(),
    worldview: String(partial?.worldview || '').trim(),
    visual_style: String(partial?.visual_style || '').trim(),
    color_style: String(partial?.color_style || '').trim(),
    references: Array.isArray(partial?.references) ? partial!.references.map(String) : [],
    era: String(partial?.era || '').trim(),
  };
}

export function inferDramaCostumeTag(name: string, prompt?: string): string {
  const t = `${name || ''} ${prompt || ''}`;
  if (/盔|甲|作战|战斗|头盔|铠|战术|防弹|铠甲/.test(t)) return '作战';
  if (/制服|工装|职业|外卖|警|军|医护|厨师|校服|工作服/.test(t)) return '制服';
  if (/礼服|正装|婚纱|西装|晚装|盛装|锦袍/.test(t)) return '礼服';
  if (/睡衣|家居/.test(t)) return '家居';
  return '常服';
}

export function createEmptyDramaCharacterCostume(
  partial?: Partial<DramaCharacterCostume>,
): DramaCharacterCostume {
  const name = String(partial?.name || '').trim() || '默认服装';
  const prompt = String(partial?.prompt || '').trim();
  return {
    costume_id: String(partial?.costume_id || dramaNewId('cos')).trim(),
    name,
    prompt,
    images: Array.isArray(partial?.images)
      ? partial!.images.map((u) => String(u || '').trim()).filter(Boolean)
      : [],
    active: partial?.active === true,
    tag: String(partial?.tag || inferDramaCostumeTag(name, prompt)).trim() || '常服',
  };
}

export function createEmptyDramaAssetReferenceImage(
  partial?: Partial<DramaAssetReferenceImage>,
): DramaAssetReferenceImage {
  return {
    ref_id: String(partial?.ref_id || dramaNewId('aref')).trim(),
    kind: String(partial?.kind || 'master').trim() || 'master',
    url: String(partial?.url || '').trim(),
    ...(partial?.label !== undefined ? { label: String(partial.label || '').trim() } : {}),
    ...(partial?.lock_intent ? { lock_intent: partial.lock_intent } : {}),
  };
}

export function createEmptyDramaVoiceIdentity(
  partial?: Partial<DramaVoiceIdentity>,
): DramaVoiceIdentity {
  return {
    gender: String(partial?.gender || '').trim(),
    age_range: String(partial?.age_range || '').trim(),
    pitch: String(partial?.pitch || '').trim(),
    timbre: String(partial?.timbre || '').trim(),
    accent: String(partial?.accent || '').trim(),
    pronunciation: String(partial?.pronunciation || '').trim(),
    dry_wet: String(partial?.dry_wet || '').trim(),
    speaking_rate: String(partial?.speaking_rate || '').trim(),
    voice_character: String(partial?.voice_character || '').trim(),
    reference_audio: String(partial?.reference_audio || '').trim(),
  };
}

export function createEmptyDramaVoicePerformance(
  partial?: Partial<DramaVoicePerformance>,
): DramaVoicePerformance {
  return {
    emotion: String(partial?.emotion || '').trim(),
    delivery: String(partial?.delivery || '').trim(),
    pause: String(partial?.pause || '').trim(),
    stress: String(partial?.stress || '').trim(),
    pitch_change: String(partial?.pitch_change || '').trim(),
    speaking_rate: String(partial?.speaking_rate || '').trim(),
    performance: String(partial?.performance || '').trim(),
  };
}

export function createEmptyDramaDialogueLine(
  partial?: Partial<DramaDialogueLine>,
): DramaDialogueLine {
  return {
    dialogue_id: String(partial?.dialogue_id || dramaNewId('dlg')).trim(),
    character_id: String(partial?.character_id || '').trim(),
    character_name: String(partial?.character_name || '').trim(),
    text: String(partial?.text || '').trim(),
    ...(partial?.performance
      ? { performance: createEmptyDramaVoicePerformance(partial.performance) }
      : {}),
  };
}

export function createEmptyDramaShotCastMember(
  partial?: Partial<DramaShotCastMember>,
): DramaShotCastMember {
  return {
    character_id: String(partial?.character_id || '').trim(),
    screen_position: String(partial?.screen_position || '').trim(),
    action: String(partial?.action || '').trim(),
    emotion: String(partial?.emotion || '').trim(),
    performance: String(partial?.performance || '').trim(),
    dialogue_ids: Array.isArray(partial?.dialogue_ids)
      ? partial!.dialogue_ids.map(String).filter(Boolean)
      : [],
    voice_id: String(partial?.voice_id || '').trim(),
    ...(partial?.temporary_state !== undefined
      ? { temporary_state: String(partial.temporary_state || '').trim() }
      : {}),
  };
}

export function createEmptyDramaCharacter(partial?: Partial<DramaCharacter>): DramaCharacter {
  const views = partial?.views || emptyCharacterViews();
  const assets = createEmptyDramaCharacterAssetSlots(partial?.assets);
  if (!assets.frontImage && views.front?.[0]) assets.frontImage = views.front[0];
  if (!assets.fullBodyImage && (views.full?.[0] || partial?.imageUrl)) {
    assets.fullBodyImage = views.full?.[0] || String(partial?.imageUrl || '');
  }
  if (!assets.expressionImages.length && views.expression?.length) {
    assets.expressionImages = [...views.expression];
  }
  const imageUrl = String(partial?.imageUrl || '').trim();
  const reference_images = Array.isArray(partial?.reference_images)
    ? partial!.reference_images.map((r) => createEmptyDramaAssetReferenceImage(r))
    : imageUrl
      ? [createEmptyDramaAssetReferenceImage({ kind: 'master', url: imageUrl, label: 'master' })]
      : [];
  return {
    character_id: partial?.character_id || dramaNewId('char'),
    name: String(partial?.name || '').trim(),
    age: String(partial?.age || '').trim(),
    gender: (partial?.gender as DramaCharacter['gender']) || '',
    height: String(partial?.height || '').trim(),
    body_type: String(partial?.body_type || '').trim(),
    hair_color: String(partial?.hair_color || '').trim(),
    accessories: String(partial?.accessories || '').trim(),
    material_texture: String(partial?.material_texture || '').trim(),
    identity: String(partial?.identity || partial?.role || '').trim(),
    role: String(partial?.role || '').trim(),
    personality: String(partial?.personality || '').trim(),
    backstory: String(partial?.backstory || '').trim(),
    relations: Array.isArray(partial?.relations) ? partial!.relations.map(String) : [],
    prompt: String(partial?.prompt || '').trim(),
    visual: createEmptyDramaCharacterVisual(partial?.visual),
    visual_anchors: Array.isArray(partial?.visual_anchors)
      ? partial!.visual_anchors.map(String).filter(Boolean)
      : [],
    forbidden_changes: Array.isArray(partial?.forbidden_changes)
      ? partial!.forbidden_changes.map(String).filter(Boolean)
      : [],
    constraint_rules: Array.isArray(partial?.constraint_rules) ? partial!.constraint_rules : [],
    reference_images,
    states: createEmptyDramaCharacterStates(partial?.states),
    assets,
    views,
    costumes: Array.isArray(partial?.costumes)
      ? partial!.costumes.map((x) => createEmptyDramaCharacterCostume(x))
      : [],
    voice_id: String(partial?.voice_id || '').trim(),
    ...(partial?.speaker_id
      ? { speaker_id: String(partial.speaker_id).trim() as DramaCharacter['speaker_id'] }
      : {}),
    imageUrl,
    status: partial?.status || (imageUrl ? 'ready' : 'pending'),
    asset_version: Number(partial?.asset_version) > 0 ? Number(partial!.asset_version) : 1,
    ...(partial?.asset_version_label !== undefined
      ? { asset_version_label: String(partial.asset_version_label || '') }
      : {}),
    ...(partial?.needs_reanalyze !== undefined ? { needs_reanalyze: !!partial.needs_reanalyze } : {}),
    ...(partial?.needs_review !== undefined ? { needs_review: !!partial.needs_review } : {}),
    priority: partial?.priority,
    error: partial?.error,
  };
}

export function createEmptyDramaSceneAsset(partial?: Partial<DramaSceneAsset>): DramaSceneAsset {
  const variants = Array.isArray(partial?.variants) ? partial!.variants : [];
  const time_variants = Array.isArray(partial?.time_variants)
    ? partial!.time_variants
    : variants;
  const imageUrl = String(partial?.imageUrl || '').trim();
  const reference_images = Array.isArray(partial?.reference_images)
    ? partial!.reference_images.map((r) => createEmptyDramaAssetReferenceImage(r))
    : imageUrl
      ? [createEmptyDramaAssetReferenceImage({ kind: 'master', url: imageUrl, label: 'master' })]
      : [];
  return {
    scene_id: partial?.scene_id || dramaNewId('scene'),
    name: String(partial?.name || '').trim(),
    location: String(partial?.location || partial?.name || '').trim(),
    kind: String(partial?.kind || '').trim(),
    time_default: String(partial?.time_default || '').trim(),
    weather_default: String(partial?.weather_default || '').trim(),
    mood: String(partial?.mood || '').trim(),
    prompt: String(partial?.prompt || '').trim(),
    imageUrl,
    variants,
    spatial_structure: String(partial?.spatial_structure || '').trim(),
    architecture: String(partial?.architecture || '').trim(),
    materials: String(partial?.materials || '').trim(),
    fixed_elements: Array.isArray(partial?.fixed_elements)
      ? partial!.fixed_elements.map(String).filter(Boolean)
      : [],
    camera_reference: String(partial?.camera_reference || '').trim(),
    lighting: String(partial?.lighting || '').trim(),
    light_sources: String(partial?.light_sources || '').trim(),
    weather: String(partial?.weather || partial?.weather_default || '').trim(),
    color_palette: String(partial?.color_palette || '').trim(),
    camera_visible_area: String(partial?.camera_visible_area || '').trim(),
    forbidden_elements: Array.isArray(partial?.forbidden_elements)
      ? partial!.forbidden_elements.map(String).filter(Boolean)
      : [],
    time_variants,
    reference_images,
    status: partial?.status || (imageUrl ? 'ready' : 'pending'),
    asset_version: Number(partial?.asset_version) > 0 ? Number(partial!.asset_version) : 1,
    ...(partial?.asset_version_label !== undefined
      ? { asset_version_label: String(partial.asset_version_label || '') }
      : {}),
    ...(partial?.needs_reanalyze !== undefined ? { needs_reanalyze: !!partial.needs_reanalyze } : {}),
    ...(partial?.needs_review !== undefined ? { needs_review: !!partial.needs_review } : {}),
    priority: partial?.priority,
    error: partial?.error,
  };
}

export function createEmptyDramaProp(partial?: Partial<DramaProp>): DramaProp {
  const imageUrl = String(partial?.imageUrl || '').trim();
  const reference_images = Array.isArray(partial?.reference_images)
    ? partial!.reference_images.map((r) => createEmptyDramaAssetReferenceImage(r))
    : imageUrl
      ? [createEmptyDramaAssetReferenceImage({ kind: 'master', url: imageUrl, label: 'master' })]
      : [];
  return {
    prop_id: partial?.prop_id || dramaNewId('prop'),
    name: String(partial?.name || '').trim(),
    description: String(partial?.description || '').trim(),
    material: String(partial?.material || '').trim(),
    appearance: String(partial?.appearance || partial?.description || '').trim(),
    prompt: String(partial?.prompt || '').trim(),
    imageUrl,
    reference_images,
    states: Array.isArray(partial?.states) ? partial!.states : [],
    related_character_ids: Array.isArray(partial?.related_character_ids)
      ? partial!.related_character_ids.map(String)
      : [],
    related_scene_ids: Array.isArray(partial?.related_scene_ids)
      ? partial!.related_scene_ids.map(String)
      : [],
    status: partial?.status || (imageUrl ? 'ready' : 'pending'),
    asset_version: Number(partial?.asset_version) > 0 ? Number(partial!.asset_version) : 1,
    ...(partial?.asset_version_label !== undefined
      ? { asset_version_label: String(partial.asset_version_label || '') }
      : {}),
    ...(partial?.needs_reanalyze !== undefined ? { needs_reanalyze: !!partial.needs_reanalyze } : {}),
    ...(partial?.needs_review !== undefined ? { needs_review: !!partial.needs_review } : {}),
    priority: partial?.priority,
    error: partial?.error,
  };
}

export function createEmptyDramaCreature(partial?: Partial<DramaCreature>): DramaCreature {
  return {
    creature_id: partial?.creature_id || dramaNewId('creature'),
    name: String(partial?.name || '').trim(),
    appearance: String(partial?.appearance || '').trim(),
    behavior: String(partial?.behavior || '').trim(),
    motion_traits: String(partial?.motion_traits || '').trim(),
    prompt: String(partial?.prompt || '').trim(),
    imageUrl: String(partial?.imageUrl || '').trim(),
    status: partial?.status || (partial?.imageUrl ? 'ready' : 'pending'),
    priority: partial?.priority,
    error: partial?.error,
  };
}

export function createEmptyDramaVoice(partial?: Partial<DramaVoice>): DramaVoice {
  const sample = String(partial?.sample_url || '').trim();
  const timbre = String(partial?.timbre || partial?.identity?.timbre || '').trim();
  const voiceStyle = String(partial?.voiceStyle || partial?.identity?.voice_character || timbre).trim();
  const identity = createEmptyDramaVoiceIdentity({
    ...(partial?.identity || {}),
    timbre: String(partial?.identity?.timbre || timbre).trim(),
    voice_character: String(partial?.identity?.voice_character || voiceStyle).trim(),
    reference_audio: String(partial?.identity?.reference_audio || sample).trim(),
  });
  const status = partial?.status || (sample ? 'ready' : 'pending');
  return {
    voice_id: partial?.voice_id || dramaNewId('voice'),
    character_id: String(partial?.character_id || '').trim(),
    model: String(partial?.model || 'doubao-seed-audio-1.0').trim() || 'doubao-seed-audio-1.0',
    timbre: timbre || identity.timbre,
    voiceStyle: voiceStyle || identity.voice_character,
    sample_url: sample || identity.reference_audio,
    sample_text: String(partial?.sample_text || '').trim(),
    language: String(partial?.language || 'zh').trim(),
    language_style: String(partial?.language_style || '').trim(),
    emotion_range: String(partial?.emotion_range || '').trim(),
    identity,
    status,
    asset_version: Number(partial?.asset_version) > 0 ? Number(partial!.asset_version) : 1,
    ...(partial?.asset_version_label !== undefined
      ? { asset_version_label: String(partial.asset_version_label || '') }
      : {}),
    ...(partial?.needs_reanalyze !== undefined ? { needs_reanalyze: !!partial.needs_reanalyze } : {}),
    ...(partial?.needs_review !== undefined ? { needs_review: !!partial.needs_review } : {}),
    ...(partial?.error !== undefined ? { error: partial.error } : {}),
  };
}

export function createEmptyDramaBible(partial?: Partial<DramaProjectBible>): DramaProjectBible {
  const project = createEmptyDramaProjectInfo(partial?.project);
  const story = createEmptyDramaStoryBible({
    worldview: partial?.story?.worldview || project.worldview,
    era: partial?.story?.era || project.era,
    rules: partial?.story?.rules,
    forbidden_elements: partial?.story?.forbidden_elements,
    synopsis: partial?.story?.synopsis || partial?.plot,
    extra_fields: partial?.story?.extra_fields,
  });
  const visual = createEmptyDramaVisualBible({
    style: partial?.visual?.style || project.visual_style || project.style,
    color: partial?.visual?.color || project.color_style,
    camera: partial?.visual?.camera,
    lighting: partial?.visual?.lighting,
    referenceWorks: partial?.visual?.referenceWorks?.length
      ? partial.visual.referenceWorks
      : project.references,
    negativePrompt: partial?.visual?.negativePrompt,
    extra_fields: partial?.visual?.extra_fields,
  });
  const sound = createEmptyDramaSoundBible(partial?.sound);
  let projectVisualBible = createEmptyDramaProjectVisualBible(partial?.projectVisualBible);
  let visualDNA = createEmptyDramaVisualDNA(
    partial?.visualDNA || projectVisualBible.visualDNA || undefined,
  );

  // 若已选风格预设，以 Project Visual Bible 为权威并回写 visualDNA
  const presetId =
    resolveVisualStylePresetId(projectVisualBible.presetId) ||
    resolveVisualStylePresetId(visualDNA.presetId);
  if (presetId && (!projectVisualBible.selected_at || projectVisualBible.presetId !== presetId)) {
    projectVisualBible = applyVisualStylePreset(presetId, {
      ...projectVisualBible,
      visualDNA,
    });
    visualDNA = projectVisualBible.visualDNA;
  } else if (projectVisualBible.selected_at && projectVisualBible.stylePrompt) {
    visualDNA = createEmptyDramaVisualDNA({
      ...projectVisualBible.visualDNA,
      generatedPrompt: projectVisualBible.stylePrompt || projectVisualBible.visualDNA.generatedPrompt,
    });
    projectVisualBible = {
      ...projectVisualBible,
      visualDNA,
      stylePrompt: visualDNA.generatedPrompt,
    };
  } else if (visualDNA.presetId && visualDNA.presetId !== 'unset') {
    const resolved = resolveVisualStylePresetId(visualDNA.presetId);
    if (resolved) {
      projectVisualBible = applyVisualStylePreset(resolved, {
        visualDNA,
        recommendedPresetIds: projectVisualBible.recommendedPresetIds,
      });
      visualDNA = projectVisualBible.visualDNA;
    }
  }

  if (visualDNA.generatedPrompt && !visual.style) {
    visual.style = visualDNA.generatedPrompt;
  }
  return {
    project,
    story,
    visual,
    visualDNA,
    projectVisualBible,
    sound,
    plot: String(partial?.plot || '').trim(),
    relationships: String(partial?.relationships || '').trim(),
    script_keywords: Array.isArray(partial?.script_keywords)
      ? partial!.script_keywords.map(String)
      : [],
    characters: Array.isArray(partial?.characters)
      ? partial!.characters.map((c) => createEmptyDramaCharacter(c))
      : [],
    scenes: Array.isArray(partial?.scenes)
      ? partial!.scenes.map((s) => createEmptyDramaSceneAsset(s))
      : [],
    props: Array.isArray(partial?.props) ? partial!.props.map((p) => createEmptyDramaProp(p)) : [],
    creatures: Array.isArray(partial?.creatures)
      ? partial!.creatures.map((c) => createEmptyDramaCreature(c))
      : [],
    voices: Array.isArray(partial?.voices) ? partial!.voices.map((v) => createEmptyDramaVoice(v)) : [],
    organizations: Array.isArray(partial?.organizations)
      ? partial!.organizations.map((o) => createEmptyDramaOrganization(o))
      : [],
    suppressed_character_names: Array.isArray(partial?.suppressed_character_names)
      ? [...new Set(partial!.suppressed_character_names.map((n) => String(n || '').trim()).filter(Boolean))]
      : [],
    confirmed_at: Number(partial?.confirmed_at) || 0,
  };
}

export function createEmptyDramaSceneBeat(partial?: Partial<DramaSceneBeat>): DramaSceneBeat {
  const dramatic_goal = String(partial?.dramatic_goal || partial?.purpose || '').trim();
  return {
    scene_beat_id: partial?.scene_beat_id || dramaNewId('beat'),
    scene_no: String(partial?.scene_no || '1').trim() || '1',
    scene_asset_id: String(partial?.scene_asset_id || '').trim(),
    location_name: String(partial?.location_name || '').trim(),
    int_ext: String(partial?.int_ext || '').trim(),
    day_night: String(partial?.day_night || '').trim(),
    weather: String(partial?.weather || '').trim(),
    cast_ids: Array.isArray(partial?.cast_ids) ? partial!.cast_ids.map(String) : [],
    prop_ids: Array.isArray(partial?.prop_ids) ? partial!.prop_ids.map(String) : [],
    creature_ids: Array.isArray(partial?.creature_ids) ? partial!.creature_ids.map(String) : [],
    dramatic_goal,
    purpose: String(partial?.purpose || dramatic_goal).trim(),
    event: String(partial?.event || '').trim(),
    conflict: String(partial?.conflict || '').trim(),
    result: String(partial?.result || '').trim(),
    emotion: String(partial?.emotion || '').trim(),
    characters: Array.isArray(partial?.characters)
      ? partial!.characters.map(String)
      : Array.isArray(partial?.cast_ids)
        ? partial!.cast_ids.map(String)
        : [],
  };
}

function cloneDramaDirectingBreakdown(
  raw: DramaShotDirectingBreakdown,
): DramaShotDirectingBreakdown {
  return {
    schema: 'drama-directing-breakdown.v1',
    shot_id: String(raw.shot_id || '').trim(),
    answers: { ...raw.answers },
    beats: (raw.beats || []).map((b) => ({
      ...b,
      characters: [...(b.characters || [])],
      ...(b.lockedCamera ? { lockedCamera: { ...b.lockedCamera } } : {}),
      ...(b.endState ? { endState: { ...b.endState } } : {}),
      ...(b.gazeTarget ? { gazeTarget: b.gazeTarget } : {}),
      ...(b.visibleAction ? { visibleAction: b.visibleAction } : {}),
    })),
    axisStatus: raw.axisStatus,
    ...(raw.axisNote ? { axisNote: raw.axisNote } : {}),
    continuityStatus: raw.continuityStatus,
    continuityNotes: [...(raw.continuityNotes || [])],
    sourceFingerprint: String(raw.sourceFingerprint || '').trim(),
    updated_at: Number(raw.updated_at) || 0,
    source: raw.source === 'llm' || raw.source === 'user' ? raw.source : 'rules',
  };
}

export function createEmptyDramaShot(partial?: Partial<DramaShot>): DramaShot {
  const scene_beat_id = String(partial?.scene_beat_id || partial?.beat_id || '').trim();
  const beat_id = String(partial?.beat_id || scene_beat_id).trim();
  const final_prompt = String(partial?.final_prompt || '').trim();
  const adapter_prompt_cache = String(
    partial?.adapter_prompt_cache || final_prompt || '',
  ).trim();
  const dialogue = Array.isArray(partial?.dialogue)
    ? partial!.dialogue.map((d) => createEmptyDramaDialogueLine(d))
    : [];
  let cast = Array.isArray(partial?.cast)
    ? partial!.cast.map((c) => createEmptyDramaShotCastMember(c))
    : [];
  const character_ids = Array.isArray(partial?.character_ids)
    ? partial!.character_ids.map(String)
    : [];
  if (!cast.length && character_ids.length) {
    cast = character_ids.map((id) =>
      createEmptyDramaShotCastMember({
        character_id: id,
        dialogue_ids: dialogue.filter((d) => d.character_id === id).map((d) => d.dialogue_id),
      }),
    );
  }
  return {
    shot_id: partial?.shot_id || dramaNewId('shot'),
    scene_beat_id,
    beat_id,
    shot_no: String(partial?.shot_no || '1').trim() || '1',
    duration_sec: (() => {
      const n = Number(partial?.duration_sec);
      if (!Number.isFinite(n) || n <= 0) return 10;
      return snapDramaPlanDurationSec(n, 10);
    })(),
    purpose: String(partial?.purpose || '').trim(),
    size: String(partial?.size || '').trim(),
    framing: String(partial?.framing || '').trim(),
    camera: String(partial?.camera || '').trim(),
    angle: String(partial?.angle || '').trim(),
    focal: String(partial?.focal || '').trim(),
    move: String(partial?.move || '').trim(),
    action: String(partial?.action || '').trim(),
    expression: String(partial?.expression || '').trim(),
    eyeline: String(partial?.eyeline || '').trim(),
    blocking: String(partial?.blocking || '').trim(),
    composition: String(partial?.composition || '').trim(),
    lighting: String(partial?.lighting || '').trim(),
    lighting_override: String(partial?.lighting_override || '').trim(),
    atmosphere: String(partial?.atmosphere || '').trim(),
    environment: String(partial?.environment || '').trim(),
    vfx: String(partial?.vfx || '').trim(),
    dialogue,
    sfx: String(partial?.sfx || '').trim(),
    music_note: String(partial?.music_note || '').trim(),
    dramatic_purpose: String(partial?.dramatic_purpose || '').trim(),
    visual_focus: String(partial?.visual_focus || '').trim(),
    transition_in: String(partial?.transition_in || '').trim(),
    transition_out: String(partial?.transition_out || '').trim(),
    visual_event_ids: Array.isArray(partial?.visual_event_ids)
      ? partial!.visual_event_ids.map(String).filter(Boolean)
      : [],
    character_ids,
    cast,
    scene_asset_id: String(partial?.scene_asset_id || '').trim(),
    prop_ids: Array.isArray(partial?.prop_ids) ? partial!.prop_ids.map(String) : [],
    required_prop_ids: Array.isArray(partial?.required_prop_ids)
      ? partial!.required_prop_ids.map(String)
      : [],
    creature_ids: Array.isArray(partial?.creature_ids) ? partial!.creature_ids.map(String) : [],
    voice_ids: Array.isArray(partial?.voice_ids) ? partial!.voice_ids.map(String) : [],
    continuity_notes: String(partial?.continuity_notes || '').trim(),
    costume_notes: String(partial?.costume_notes || '').trim(),
    package_id: String(partial?.package_id || '').trim(),
    final_prompt,
    adapter_prompt_cache,
    ...(partial?.last_compiled_prompt !== undefined
      ? { last_compiled_prompt: String(partial.last_compiled_prompt || '').trim() }
      : {}),
    ...(partial?.h3_skill_prompt !== undefined
      ? { h3_skill_prompt: String(partial.h3_skill_prompt || '').trim() }
      : {}),
    ...(partial?.h3_skill_prompt_from !== undefined
      ? { h3_skill_prompt_from: String(partial.h3_skill_prompt_from || '').trim() }
      : {}),
    ...(partial?.prompt_source_fingerprint !== undefined
      ? { prompt_source_fingerprint: String(partial.prompt_source_fingerprint || '').trim() }
      : {}),
    ...(partial?.scene_asset_version !== undefined
      ? { scene_asset_version: Number(partial.scene_asset_version) }
      : {}),
    ...(partial?.character_asset_versions
      ? { character_asset_versions: { ...partial.character_asset_versions } }
      : {}),
    ...(partial?.prop_asset_versions
      ? { prop_asset_versions: { ...partial.prop_asset_versions } }
      : {}),
    ...(partial?.voice_asset_versions
      ? { voice_asset_versions: { ...partial.voice_asset_versions } }
      : {}),
    ...(partial?.voice_dependency_mode
      ? { voice_dependency_mode: partial.voice_dependency_mode }
      : {}),
    model_params:
      partial?.model_params && typeof partial.model_params === 'object' ? { ...partial.model_params } : {},
    storyboard_image_url: String(partial?.storyboard_image_url || '').trim(),
    video_url: String(partial?.video_url || '').trim(),
    video_status: String(partial?.video_status || '').trim(),
    video_node_id: String(partial?.video_node_id || '').trim(),
    audio_url: String(partial?.audio_url || '').trim(),
    audio_status: String(partial?.audio_status || '').trim(),
    ...(partial?.audio_error !== undefined
      ? { audio_error: String(partial.audio_error || '').trim() }
      : {}),
    timeline_beats: Array.isArray(partial?.timeline_beats)
      ? partial!.timeline_beats.map((b) => ({
          start_sec: Number(b?.start_sec) || 0,
          end_sec: Number(b?.end_sec) || 0,
          text: String(b?.text || '').trim(),
          ...(b?.kind ? { kind: String(b.kind) } : {}),
        }))
      : [],
    timeline_events: Array.isArray(partial?.timeline_events)
      ? partial!.timeline_events.map((e) => ({
          event_id: String(e?.event_id || '').trim(),
          start_sec: Number(e?.start_sec) || 0,
          end_sec: Number(e?.end_sec) || 0,
          character_ids: Array.isArray(e?.character_ids)
            ? e!.character_ids.map(String)
            : [],
          visual_action: String(e?.visual_action || '').trim(),
          character_state: String(e?.character_state || '').trim(),
          position: String(e?.position || '').trim(),
          expression: String(e?.expression || '').trim(),
          eyeline: String(e?.eyeline || '').trim(),
          dialogue: String(e?.dialogue || '').trim(),
          dialogue_character_id: String(e?.dialogue_character_id || '').trim(),
          environment_audio: Array.isArray(e?.environment_audio)
            ? e!.environment_audio.map((x) => String(x || '').trim()).filter(Boolean)
            : [],
          lip_sync: !!e?.lip_sync,
            camera_action: String(e?.camera_action || '').trim(),
        }))
      : [],
    ...(Array.isArray(partial?.audio_timeline)
      ? {
          audio_timeline: partial!.audio_timeline.map((e) => ({
            event_id: String(e?.event_id || '').trim(),
            start_sec: Number(e?.start_sec) || 0,
            end_sec: Number(e?.end_sec) || 0,
            speaker_id: String(e?.speaker_id || '').trim() as DramaSpeakerId,
            character_id: String(e?.character_id || '').trim(),
            text: String(e?.text || '').trim(),
            ...(e?.emotion ? { emotion: String(e.emotion).trim() } : {}),
            ...(Number(e?.pause_before_sec) > 0
              ? { pause_before_sec: Number(e.pause_before_sec) }
              : {}),
            ...(Number(e?.pause_after_sec) > 0
              ? { pause_after_sec: Number(e.pause_after_sec) }
              : {}),
            ...(e?.audio_mode ? { audio_mode: e.audio_mode } : {}),
          })) as DramaAudioEvent[],
        }
      : {}),
    ...(partial?.audio_contains_environment !== undefined
      ? { audio_contains_environment: !!partial.audio_contains_environment }
      : {}),
    ...(Array.isArray(partial?.performance_plan)
      ? { performance_plan: partial!.performance_plan.map((b) => ({ ...b })) }
      : {}),
    ...(partial?.directing_enhance ? { directing_enhance: { ...partial.directing_enhance } } : {}),
    ...(partial?.directing_enhance_revision
      ? { directing_enhance_revision: { ...partial.directing_enhance_revision } }
      : {}),
    ...(partial?.directing_breakdown
      ? { directing_breakdown: cloneDramaDirectingBreakdown(partial.directing_breakdown) }
      : {}),
    ...(partial?.needs_review !== undefined ? { needs_review: !!partial.needs_review } : {}),
    ...(Number(partial?.confirmed_at) > 0
      ? { confirmed_at: Number(partial?.confirmed_at) }
      : {}),
  };
}

export function normalizeDramaDomainPhase(raw: unknown): DramaDomainPhase {
  const s = String(raw || '').trim();
  // 旧「准备资产」→ 参考图
  if (s === 'bible') return 'assets';
  if ((DRAMA_DOMAIN_PHASES as string[]).includes(s)) return s as DramaDomainPhase;
  if (s === 'visual_tuning' || s === 'visualTuning') return 'visual';
  if (s === 'story') return 'analyze';
  if (s === 'shots' || s === 'prompts' || s === 'storyboards') return 'board';
  if (s === 'preview') return 'review';
  if (s === 'assets') return 'assets';
  if (s === 'videos') return 'videos';
  if (s === 'board') return 'board';
  if (s === 'analyze') return 'analyze';
  if (s === 'visual') return 'visual';
  if (s === 'review') return 'review';
  if (s === 'episodes' || s === 'episode_pick' || s === 'select') return 'episodes';
  if (s === 'ingest' || s === 'split') return 'ingest';
  return 'ingest';
}

export function createEmptyDramaNodeMeta(
  partial?: Partial<DramaDirectorNodeMeta>,
): DramaDirectorNodeMeta {
  return {
    schemaVersion: DIRECTOR_DOMAIN_SCHEMA_VERSION,
    contract_version: String(partial?.contract_version || DIRECTOR_DOMAIN_CONTRACT_VERSION).trim(),
    phase: normalizeDramaDomainPhase(partial?.phase),
    store_rel: 'director-v2',
    chatModel: String(partial?.chatModel || 'gpt-4o').trim(),
    imageModel: String(partial?.imageModel || 'rhart-image-g-2').trim(),
    videoBatchModel: String(partial?.videoBatchModel || 'minimax-h3-multi').trim(),
    videoBatchLipsyncModel: String(partial?.videoBatchLipsyncModel || 'minimax-h3-audio').trim(),
    stylePresetId: String(partial?.stylePresetId || 'street_crew').trim(),
    globalStyle: String(partial?.globalStyle || '').trim(),
    styleReferenceImageUrl: String(partial?.styleReferenceImageUrl || '').trim(),
    aspect_ratio: (() => {
      const a = String(partial?.aspect_ratio || '').trim();
      if (a === '16:9' || a === '9:16' || a === '3:4' || a === '4:3') return a;
      return '9:16';
    })(),
    source_script: String(partial?.source_script || '').trim(),
    source_novel: String(partial?.source_novel || '').trim(),
    analyze_confirmed: !!partial?.analyze_confirmed,
    board_confirmed_at: Number(partial?.board_confirmed_at) > 0 ? Number(partial!.board_confirmed_at) : 0,
    assets_confirmed_at:
      Number(partial?.assets_confirmed_at) > 0 ? Number(partial!.assets_confirmed_at) : 0,
    ...(partial?.needs_stage_reconfirm !== undefined
      ? { needs_stage_reconfirm: !!partial.needs_stage_reconfirm }
      : {}),
    migrated_from_v1: !!partial?.migrated_from_v1,
    default_voice_dependency_mode: partial?.default_voice_dependency_mode || 'POST_PRODUCTION',
    shotPlanPaceGear: normalizeDramaShotPlanPaceGear(partial?.shotPlanPaceGear),
    durationPaceStyle: (() => {
      const s = String(partial?.durationPaceStyle || '')
        .trim()
        .toLowerCase();
      if (s === 'fast' || s === 'slow' || s === 'standard') return s;
      return 'standard';
    })(),
    durationTotalCapSec: (() => {
      const n = Number(partial?.durationTotalCapSec);
      return Number.isFinite(n) && n > 0 ? n : undefined;
    })(),
    isGenerating: !!partial?.isGenerating,
    error: String(partial?.error || '').trim(),
  };
}

export function createEmptyDramaSession(
  partial?: Partial<DramaDirectorSession> & { episode_plans?: unknown },
): DramaDirectorSession {
  const episodes = normalizeDramaEpisodes(partial?.episodes);
  const active =
    String(partial?.active_episode_id || '').trim() ||
    episodes[0]?.episode_id ||
    '';
  let episode_bibles = normalizeDramaEpisodeBibles(partial?.episode_bibles);
  if (!Object.keys(episode_bibles).length && (partial as any)?.episode_plans) {
    episode_bibles = migrateLegacyEpisodePlans((partial as any).episode_plans);
  }
  const base: DramaDirectorSession = {
    meta: createEmptyDramaNodeMeta(partial?.meta),
    episodes,
    active_episode_id: active,
    bible: createEmptyDramaBible(partial?.bible),
    scene_beats: Array.isArray(partial?.scene_beats)
      ? partial!.scene_beats.map((b) => createEmptyDramaSceneBeat(b))
      : [],
    shots: Array.isArray(partial?.shots) ? partial!.shots.map((s) => createEmptyDramaShot(s)) : [],
    episode_bibles,
    production_plans: normalizeDramaProductionPlans(partial?.production_plans),
    packages:
      partial?.packages && typeof partial.packages === 'object'
        ? { ...(partial.packages as Record<string, DramaGenerationPackage>) }
        : {},
    reviews:
      partial?.reviews && typeof partial.reviews === 'object'
        ? { ...(partial.reviews as Record<string, DramaReviewResult>) }
        : {},
    continuity_issues: Array.isArray(partial?.continuity_issues) ? partial!.continuity_issues : [],
  };
  return migrateDramaSessionToH3CompilerV1(migrateDramaSessionToContractV1(base)).session;
}

export function createEmptyDramaGenerationPackage(
  partial?: Partial<DramaGenerationPackage>,
): DramaGenerationPackage {
  const cache = String(
    partial?.adapter_prompt_cache || partial?.prompt_structured || partial?.prompt_text || '',
  ).trim();
  return {
    package_id: partial?.package_id || dramaNewId('pkg'),
    shot_id: String(partial?.shot_id || '').trim(),
    adapter_id: String(partial?.adapter_id || 'minimax-h3-multi').trim(),
    adapter_version: String(partial?.adapter_version || '1').trim() || '1',
    scene_reference: partial?.scene_reference ?? null,
    character_references: Array.isArray(partial?.character_references)
      ? partial!.character_references
      : [],
    prop_references: Array.isArray(partial?.prop_references) ? partial!.prop_references : [],
    voice_assets: Array.isArray(partial?.voice_assets) ? partial!.voice_assets : [],
    project_constraints: partial?.project_constraints || {
      visual_style: '',
      style_prompt: '',
      era: '',
      worldview: '',
      forbidden_elements: [],
      aspect_ratio: '',
    },
    character_locks: Array.isArray(partial?.character_locks) ? partial!.character_locks : [],
    scene_locks: Array.isArray(partial?.scene_locks) ? partial!.scene_locks : [],
    visual_style: String(partial?.visual_style || '').trim(),
    shot_direction: partial?.shot_direction || {
      purpose: '',
      action: '',
      blocking: '',
      composition: '',
      environment: '',
      duration_sec: 10,
      cast: [],
    },
    performance_direction: String(partial?.performance_direction || '').trim(),
    camera_direction: partial?.camera_direction || {
      size: '',
      framing: '',
      camera: '',
      angle: '',
      focal: '',
      move: '',
      lighting_override: '',
    },
    dialogue: Array.isArray(partial?.dialogue)
      ? partial!.dialogue.map((d) => createEmptyDramaDialogueLine(d))
      : [],
    sound_direction: String(partial?.sound_direction || '').trim(),
    forbidden_elements: Array.isArray(partial?.forbidden_elements)
      ? partial!.forbidden_elements.map(String)
      : [],
    ref_images: Array.isArray(partial?.ref_images) ? partial!.ref_images : [],
    prompt_text: String(partial?.prompt_text || cache).trim(),
    prompt_structured: String(partial?.prompt_structured || cache).trim(),
    adapter_prompt_cache: cache,
    audio_refs: Array.isArray(partial?.audio_refs) ? partial!.audio_refs : [],
    prev_shot_summary: String(partial?.prev_shot_summary || '').trim(),
    ...(partial?.dependency_status ? { dependency_status: partial.dependency_status } : {}),
    created_at: Number(partial?.created_at) || Date.now(),
    version: Number(partial?.version) || 1,
  };
}

/** 对白数组 → 展示文案 */
export function formatDramaDialogueLines(
  lines: { character_name?: string; character_id?: string; text?: string }[],
): string {
  return (lines || [])
    .map((l) => {
      const name = String(l.character_name || l.character_id || '').trim();
      const text = String(l.text || '').trim();
      if (!text) return '';
      return name ? `${name}：${text}` : text;
    })
    .filter(Boolean)
    .join('\n');
}

/** 导演规划时长落到 H3 支持档 6 / 10 / 15 / 20 */
export function snapDramaPlanDurationSec(sec: number, fallback = 10): number {
  const tiers = [6, 10, 15, 20] as const;
  const n = Number(sec);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  if ((tiers as readonly number[]).includes(n)) return n;
  let best = fallback;
  let bestDist = Infinity;
  for (const t of tiers) {
    const d = Math.abs(t - n);
    const tiePreferCeil = d === bestDist && t >= n;
    if (d < bestDist || tiePreferCeil) {
      bestDist = d;
      best = t;
    }
  }
  return best;
}

export function parseDurationSec(raw: unknown, fallback = 10): number {
  const s = String(raw ?? '').trim();
  const m = s.match(/(\d+(?:\.\d+)?)/);
  if (m) {
    const n = Number(m[1]);
    if (Number.isFinite(n) && n > 0) return snapDramaPlanDurationSec(n, fallback);
  }
  const n = Number(raw);
  if (Number.isFinite(n) && n > 0) return snapDramaPlanDurationSec(n, fallback);
  return snapDramaPlanDurationSec(fallback, 10);
}
