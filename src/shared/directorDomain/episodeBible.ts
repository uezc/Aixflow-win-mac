/**
 * Episode Bible + Production Plan
 * — 工厂、派生（analyze 阶段不写正式 DramaShot）
 */

import { dramaNewId } from './ids.js';
import type {
  DramaAssetPriority,
  DramaAssetProductionPlan,
  DramaCharacterDirecting,
  DramaCharacterDossier,
  DramaDirectorSession,
  DramaEpisode,
  DramaEpisodeBeat,
  DramaEpisodeBible,
  DramaEpisodePacing,
  DramaProductionAssetItem,
  DramaProductionAssetStatus,
  DramaShotSuggestion,
  DramaSoundBible,
  DramaVisualBible,
} from './types.js';
import { assignDramaVisualEventPriorities, createEmptyDramaVisualEvent, type DramaVisualEvent } from './shotPlanning.js';
import {
  coreDramaPersonName,
  extractCharacterNamesFromDialogueBlob,
  isDramaStrictCastName,
  isSystemSpeakerName,
  namesLikelySameDramaPerson,
} from './extractCastFromScript.js';
import { collectOriginalSpeakerNamesInOrder, isDramaKeepCastSpeaker } from './originalScript.js';
import { finalizeShotSuggestionDurations } from './shotDurationEngine.js';

export function createEmptyDramaCharacterDossier(
  partial?: Partial<DramaCharacterDossier> | null,
): DramaCharacterDossier | undefined {
  if (!partial || typeof partial !== 'object') return undefined;
  const dossier: DramaCharacterDossier = {
    code: String(partial.code || '').trim(),
    character_type: String(partial.character_type || '').trim(),
    age: String(partial.age || '').trim(),
    identity: String(partial.identity || '').trim(),
    desire: String(partial.desire || '').trim(),
    fear: String(partial.fear || '').trim(),
    surface_personality: String(partial.surface_personality || '').trim(),
    deep_personality: String(partial.deep_personality || '').trim(),
    emotion_signals: String(partial.emotion_signals || '').trim(),
    signature_actions: String(partial.signature_actions || '').trim(),
    dialogue_style: String(partial.dialogue_style || '').trim(),
    subtext_rule: String(partial.subtext_rule || '').trim(),
    relation_to_lead: String(partial.relation_to_lead || '').trim(),
    scene_anchor: String(partial.scene_anchor || '').trim(),
    action_index: String(partial.action_index || '').trim(),
  };
  return Object.values(dossier).some(Boolean) ? dossier : undefined;
}

export function createEmptyDramaEpisodeBeat(
  partial?: Partial<DramaEpisodeBeat>,
): DramaEpisodeBeat {
  return {
    hook: String(partial?.hook || '').trim(),
    conflict: String(partial?.conflict || '').trim(),
    turningPoint: String(partial?.turningPoint || '').trim(),
    climax: String(partial?.climax || '').trim(),
    endingHook: String(partial?.endingHook || '').trim(),
  };
}

export function createEmptyDramaEpisodePacing(
  partial?: Partial<DramaEpisodePacing>,
): DramaEpisodePacing {
  return {
    timeline: Array.isArray(partial?.timeline)
      ? partial!.timeline.map((p) => ({
          at: Number(p.at) || 0,
          unit: p.unit === 'sec' ? 'sec' : 'pct',
          label: String(p.label || '').trim(),
          emotion: String(p.emotion || '').trim(),
          intensity: Number.isFinite(Number(p.intensity)) ? Number(p.intensity) : 0,
          is_spike: !!p.is_spike,
        }))
      : [],
    emotion_curve: Array.isArray(partial?.emotion_curve)
      ? partial!.emotion_curve.map((n) => Number(n) || 0)
      : [],
    spike_labels: Array.isArray(partial?.spike_labels)
      ? partial!.spike_labels.map(String).filter(Boolean)
      : [],
  };
}

export function createEmptyDramaShotSuggestion(
  partial?: Partial<DramaShotSuggestion>,
): DramaShotSuggestion {
  return {
    suggestion_id: partial?.suggestion_id || dramaNewId('ssug'),
    scene: String(partial?.scene || '').trim(),
    shot: String(partial?.shot || '').trim(),
    purpose: String(partial?.purpose || '').trim(),
    size: String(partial?.size || '').trim(),
    camera: String(partial?.camera || '').trim(),
    move: String(partial?.move || '').trim(),
    action: String(partial?.action || '').trim(),
    dialogue: String(partial?.dialogue || '').trim(),
    sound: String(partial?.sound || '').trim(),
    emotion_play: String(partial?.emotion_play || '').trim(),
    subtext: String(partial?.subtext || '').trim(),
    lighting: String(partial?.lighting || '').trim(),
    blocking: String(partial?.blocking || '').trim(),
    time_of_day: String(partial?.time_of_day || '').trim(),
    environment: String(partial?.environment || '').trim(),
    duration_sec:
      Number.isFinite(Number(partial?.duration_sec)) && Number(partial?.duration_sec) > 0
        ? Math.round(Number(partial!.duration_sec) * 10) / 10
        : 5,
    duration_why: String(partial?.duration_why || '').trim(),
    duration_min:
      Number.isFinite(Number(partial?.duration_min)) && Number(partial?.duration_min) > 0
        ? Math.round(Number(partial!.duration_min) * 10) / 10
        : undefined,
    duration_max:
      Number.isFinite(Number(partial?.duration_max)) && Number(partial?.duration_max) > 0
        ? Math.round(Number(partial!.duration_max) * 10) / 10
        : undefined,
    duration_ai:
      Number.isFinite(Number(partial?.duration_ai)) && Number(partial?.duration_ai) > 0
        ? Math.round(Number(partial!.duration_ai) * 10) / 10
        : undefined,
    duration_locked: partial?.duration_locked === true ? true : undefined,
    cast_names: Array.isArray(partial?.cast_names)
      ? partial!.cast_names.map(String).filter(Boolean)
      : [],
    dramatic_purpose: String(partial?.dramatic_purpose || '').trim(),
    visual_focus: String(partial?.visual_focus || '').trim(),
    transition_in: String(partial?.transition_in || '').trim(),
    transition_out: String(partial?.transition_out || '').trim(),
    visual_event_ids: Array.isArray(partial?.visual_event_ids)
      ? partial!.visual_event_ids.map(String).filter(Boolean)
      : Array.isArray((partial as { event_ids?: string[] })?.event_ids)
        ? ((partial as { event_ids?: string[] }).event_ids || []).map(String).filter(Boolean)
        : [],
    prop_names: Array.isArray(partial?.prop_names)
      ? partial!.prop_names.map(String).filter(Boolean)
      : [],
    creature_names: Array.isArray(partial?.creature_names)
      ? partial!.creature_names.map(String).filter(Boolean)
      : [],
    asset_match: String(partial?.asset_match || '').trim(),
    visual_style: String(partial?.visual_style || '').trim(),
  };
}

export function createEmptyDramaEpisodeBible(
  partial?: Partial<DramaEpisodeBible>,
): DramaEpisodeBible {
  return {
    episode_id: String(partial?.episode_id || '').trim(),
    episode_no: Number(partial?.episode_no) || 0,
    title: String(partial?.title || '').trim(),
    logline: String(partial?.logline || '').trim(),
    genre: String(partial?.genre || '').trim(),
    theme: String(partial?.theme || '').trim(),
    target_audience: String(partial?.target_audience || '').trim(),
    episodeBeat: createEmptyDramaEpisodeBeat(partial?.episodeBeat),
    episodePacing: createEmptyDramaEpisodePacing(partial?.episodePacing),
    directing_notes: Array.isArray(partial?.directing_notes)
      ? partial!.directing_notes.map((c) => ({
          character_id: String(c.character_id || '').trim(),
          name: String(c.name || '').trim(),
          positioning: String(c.positioning || '').trim(),
          episode_goal: String(c.episode_goal || '').trim(),
          psychological_arc: String(c.psychological_arc || '').trim(),
          key_actions: String(c.key_actions || '').trim(),
          performance_focus: String(c.performance_focus || '').trim(),
          relationship_changes: String(c.relationship_changes || '').trim(),
          dossier: createEmptyDramaCharacterDossier(c.dossier),
        }))
      : [],
    visual_override: {
      style: String(partial?.visual_override?.style || '').trim(),
      color: String(partial?.visual_override?.color || '').trim(),
      camera: String(partial?.visual_override?.camera || '').trim(),
      lighting: String(partial?.visual_override?.lighting || '').trim(),
      referenceWorks: Array.isArray(partial?.visual_override?.referenceWorks)
        ? partial!.visual_override!.referenceWorks.map(String).filter(Boolean)
        : [],
      negativePrompt: String(partial?.visual_override?.negativePrompt || '').trim(),
      extra_fields: Array.isArray(partial?.visual_override?.extra_fields)
        ? partial!.visual_override!.extra_fields.map((x) => ({
            label: String(x.label || '').trim(),
            value: String(x.value || '').trim(),
          }))
        : [],
    },
    sound_override: {
      voiceStyle: String(partial?.sound_override?.voiceStyle || '').trim(),
      emotionRange: String(partial?.sound_override?.emotionRange || '').trim(),
      ambientSound: Array.isArray(partial?.sound_override?.ambientSound)
        ? partial!.sound_override!.ambientSound.map(String).filter(Boolean)
        : [],
      musicStyle: String(partial?.sound_override?.musicStyle || '').trim(),
      extra_fields: Array.isArray(partial?.sound_override?.extra_fields)
        ? partial!.sound_override!.extra_fields.map((x) => ({
            label: String(x.label || '').trim(),
            value: String(x.value || '').trim(),
          }))
        : [],
    },
    style_preset_id: String(partial?.style_preset_id || '').trim(),
    original_scenes: Array.isArray(partial?.original_scenes) ? [...partial!.original_scenes] : [],
    original_segments: Array.isArray(partial?.original_segments) ? [...partial!.original_segments] : [],
    character_bindings: Array.isArray(partial?.character_bindings) ? [...partial!.character_bindings] : [],
    voice_bindings: Array.isArray(partial?.voice_bindings) ? [...partial!.voice_bindings] : [],
    scene_bindings: Array.isArray(partial?.scene_bindings) ? [...partial!.scene_bindings] : [],
    ...(partial?.visual_bible_binding ? { visual_bible_binding: partial.visual_bible_binding } : {}),
    ...(partial?.original_integrity ? { original_integrity: partial.original_integrity } : {}),
    ...(partial?.analysis_summary ? { analysis_summary: partial.analysis_summary } : {}),
    shot_suggestions: Array.isArray(partial?.shot_suggestions)
      ? partial!.shot_suggestions.map((s) => createEmptyDramaShotSuggestion(s))
      : [],
    visual_events: Array.isArray(partial?.visual_events)
      ? assignDramaVisualEventPriorities(partial!.visual_events.map((e) => createEmptyDramaVisualEvent(e)))
      : [],
    official_shots: Array.isArray(partial?.official_shots) ? [...partial!.official_shots] : [],
    official_scene_beats: Array.isArray(partial?.official_scene_beats)
      ? [...partial!.official_scene_beats]
      : [],
    ...(Number(partial?.scene_split_at) > 0
      ? { scene_split_at: Number(partial!.scene_split_at) }
      : {}),
    ...(Number(partial?.duration_split_at) > 0
      ? { duration_split_at: Number(partial!.duration_split_at) }
      : {}),
    ...(Number(partial?.asset_match_at) > 0
      ? { asset_match_at: Number(partial!.asset_match_at) }
      : {}),
    updated_at: Number(partial?.updated_at) || 0,
  };
}

export function normalizeProductionStatus(raw: unknown): DramaProductionAssetStatus {
  const s = String(raw || '').trim();
  if (
    s === 'missing' ||
    s === 'pending' ||
    s === 'generating' ||
    s === 'completed' ||
    s === 'failed' ||
    s === 'blocked'
  ) {
    return s;
  }
  if (s === 'ready') return 'completed';
  if (s === 'error') return 'failed';
  return 'missing';
}

export function createEmptyDramaProductionAssetItem(
  partial?: Partial<DramaProductionAssetItem>,
): DramaProductionAssetItem {
  const priority = partial?.priority;
  return {
    asset_kind: partial?.asset_kind || 'character',
    asset_id: String(partial?.asset_id || '').trim(),
    name: String(partial?.name || '').trim(),
    priority: priority === 'P0' || priority === 'P1' || priority === 'P2' ? priority : 'P1',
    status: normalizeProductionStatus(partial?.status),
    required_views: Array.isArray(partial?.required_views)
      ? partial!.required_views.map(String).filter(Boolean)
      : [],
    notes: String(partial?.notes || '').trim(),
  };
}

export function createEmptyDramaAssetProductionPlan(
  partial?: Partial<DramaAssetProductionPlan>,
): DramaAssetProductionPlan {
  return {
    episode_id: String(partial?.episode_id || '').trim(),
    items: Array.isArray(partial?.items)
      ? partial!.items.map((i) => createEmptyDramaProductionAssetItem(i))
      : [],
    updated_at: Number(partial?.updated_at) || 0,
  };
}

export function normalizeDramaEpisodeBibles(raw: unknown): Record<string, DramaEpisodeBible> {
  if (!raw || typeof raw !== 'object') return {};
  const out: Record<string, DramaEpisodeBible> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    const id = String(k || '').trim();
    if (!id || !v || typeof v !== 'object') continue;
    out[id] = createEmptyDramaEpisodeBible(v as Partial<DramaEpisodeBible>);
  }
  return out;
}

export function normalizeDramaProductionPlans(
  raw: unknown,
): Record<string, DramaAssetProductionPlan> {
  if (!raw || typeof raw !== 'object') return {};
  const out: Record<string, DramaAssetProductionPlan> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    const id = String(k || '').trim();
    if (!id || !v || typeof v !== 'object') continue;
    out[id] = createEmptyDramaAssetProductionPlan(v as Partial<DramaAssetProductionPlan>);
  }
  return out;
}

function hasEpisodeBibleContent(b: DramaEpisodeBible | null | undefined): boolean {
  if (!b) return false;
  return !!(
    b.logline ||
    b.episodeBeat.hook ||
    b.episodeBeat.conflict ||
    b.directing_notes.length ||
    b.shot_suggestions.length ||
    b.official_shots?.length ||
    b.visual_events?.length ||
    b.original_segments?.length ||
    b.original_scenes?.length ||
    b.episodePacing.timeline.length
  );
}

function inferPriority(
  kind: DramaProductionAssetItem['asset_kind'],
  index: number,
): DramaAssetPriority {
  if (kind === 'character' && index < 2) return 'P0';
  if (kind === 'scene' && index < 2) return 'P0';
  if (kind === 'style') return 'P0';
  if (kind === 'character' || kind === 'scene') return 'P1';
  return 'P2';
}

/** 合并项目级 Visual + 本集 override（override 非空字段优先） */
export function resolveVisualBible(
  session: DramaDirectorSession,
  episodeId?: string,
): DramaVisualBible {
  const base = session.bible.visual;
  const epId = episodeId || session.active_episode_id;
  const ov = session.episode_bibles?.[epId]?.visual_override;
  if (!ov) return { ...base, referenceWorks: [...(base.referenceWorks || [])], extra_fields: [...(base.extra_fields || [])] };
  return {
    style: ov.style || base.style,
    color: ov.color || base.color,
    camera: ov.camera || base.camera,
    lighting: ov.lighting || base.lighting,
    referenceWorks: ov.referenceWorks?.length
      ? ov.referenceWorks
      : [...(base.referenceWorks || [])],
    negativePrompt: ov.negativePrompt || base.negativePrompt,
    extra_fields: ov.extra_fields?.length ? ov.extra_fields : [...(base.extra_fields || [])],
  };
}

export function resolveSoundBible(
  session: DramaDirectorSession,
  episodeId?: string,
): DramaSoundBible {
  const base = session.bible.sound;
  const epId = episodeId || session.active_episode_id;
  const ov = session.episode_bibles?.[epId]?.sound_override;
  if (!ov) {
    return {
      ...base,
      ambientSound: [...(base.ambientSound || [])],
      extra_fields: [...(base.extra_fields || [])],
    };
  }
  return {
    voiceStyle: ov.voiceStyle || base.voiceStyle,
    emotionRange: ov.emotionRange || base.emotionRange,
    ambientSound: ov.ambientSound?.length
      ? ov.ambientSound
      : [...(base.ambientSound || [])],
    musicStyle: ov.musicStyle || base.musicStyle,
    extra_fields: ov.extra_fields?.length ? ov.extra_fields : [...(base.extra_fields || [])],
  };
}

/**
 * 从 analyze 归一后的 bible / ShotSuggestion 派生 Episode Bible + Production Plan。
 * 不写入正式 DramaShot。
 */
export function deriveEpisodeBibleAndPlan(
  session: DramaDirectorSession,
  opts: {
    episode?: DramaEpisode | null;
    shotSuggestions?: DramaShotSuggestion[];
    visualEvents?: DramaVisualEvent[];
  } = {},
): { episodeBible: DramaEpisodeBible; productionPlan: DramaAssetProductionPlan } {
  const ep =
    opts.episode ||
    session.episodes.find((e) => e.episode_id === session.active_episode_id) ||
    null;
  const bible = session.bible;
  const project = bible.project;
  const epId = ep?.episode_id || session.active_episode_id || '';

  const prevNotes = session.episode_bibles?.[epId]?.directing_notes || [];
  const directing_notes: DramaCharacterDirecting[] = bible.characters.map((c) => {
    const prev = prevNotes.find(
      (n) => n.character_id === c.character_id || n.name === c.name,
    );
    return {
      character_id: c.character_id,
      name: c.name,
      positioning: prev?.positioning || c.identity || c.role,
      episode_goal: prev?.episode_goal || '',
      psychological_arc: prev?.psychological_arc || c.personality,
      key_actions: prev?.key_actions || '',
      performance_focus: prev?.performance_focus || c.personality,
      relationship_changes:
        prev?.relationship_changes ||
        (c.relations || []).join('；') ||
        bible.relationships.slice(0, 80),
      dossier: createEmptyDramaCharacterDossier(prev?.dossier),
    };
  });

  const shot_suggestions =
    opts.shotSuggestions && opts.shotSuggestions.length
      ? opts.shotSuggestions.map((s) => createEmptyDramaShotSuggestion(s))
      : [];
  const visual_events = Array.isArray(opts.visualEvents) ? opts.visualEvents : [];

  const prev = session.episode_bibles?.[epId];
  const episodeBible = createEmptyDramaEpisodeBible({
    episode_id: epId,
    episode_no: ep?.episode_no || 0,
    title: ep?.title || project.name || '',
    logline: bible.plot.slice(0, 120),
    genre: project.type || project.style,
    theme: (bible.script_keywords || []).slice(0, 4).join(' · '),
    target_audience: '',
    episodeBeat: createEmptyDramaEpisodeBeat({}),
    episodePacing: createEmptyDramaEpisodePacing({}),
    directing_notes,
    shot_suggestions,
    visual_events,
    official_shots: prev?.official_shots,
    official_scene_beats: prev?.official_scene_beats,
    updated_at: Date.now(),
  });

  const items: DramaProductionAssetItem[] = [];
  items.push(
    createEmptyDramaProductionAssetItem({
      asset_kind: 'style',
      asset_id: 'visual-style',
      name: '全局视觉风格',
      priority: 'P0',
      status: bible.visual?.style || project.visual_style ? 'pending' : 'missing',
      required_views: ['style_ref'],
      notes: bible.visual?.style || project.visual_style,
    }),
  );
  bible.characters.forEach((c, i) => {
    items.push(
      createEmptyDramaProductionAssetItem({
        asset_kind: 'character',
        asset_id: c.character_id,
        name: c.name,
        priority: c.priority || inferPriority('character', i),
        status: c.imageUrl || c.assets?.frontImage ? 'completed' : 'missing',
        required_views: ['front', 'side', 'full', 'expression'],
        notes: c.identity || c.role,
      }),
    );
  });
  bible.scenes.forEach((s, i) => {
    items.push(
      createEmptyDramaProductionAssetItem({
        asset_kind: 'scene',
        asset_id: s.scene_id,
        name: s.name || s.location,
        priority: s.priority || inferPriority('scene', i),
        status: s.imageUrl ? 'completed' : 'missing',
        required_views: ['wide', 'medium', 'close'],
        notes: [s.time_default || s.weather, s.mood].filter(Boolean).join(' · '),
      }),
    );
  });
  bible.props.forEach((p, i) => {
    items.push(
      createEmptyDramaProductionAssetItem({
        asset_kind: 'prop',
        asset_id: p.prop_id,
        name: p.name,
        priority: p.priority || inferPriority('prop', i),
        status: p.imageUrl ? 'completed' : 'missing',
        required_views: ['hero'],
        notes: p.description,
      }),
    );
  });
  bible.creatures.forEach((c) => {
    items.push(
      createEmptyDramaProductionAssetItem({
        asset_kind: 'creature',
        asset_id: c.creature_id,
        name: c.name,
        priority: c.priority || 'P2',
        status: c.imageUrl ? 'completed' : 'missing',
        required_views: ['full'],
        notes: c.appearance,
      }),
    );
  });
  (bible.organizations || []).forEach((o) => {
    items.push(
      createEmptyDramaProductionAssetItem({
        asset_kind: 'organization',
        asset_id: o.organization_id,
        name: o.name,
        priority: o.priority || 'P2',
        status: o.imageUrl ? 'completed' : 'missing',
        required_views: ['emblem'],
        notes: o.kind,
      }),
    );
  });
  bible.voices.forEach((v) => {
    const ch = bible.characters.find((c) => c.character_id === v.character_id);
    items.push(
      createEmptyDramaProductionAssetItem({
        asset_kind: 'voice',
        asset_id: v.voice_id,
        name: ch?.name ? `${ch.name} 音色` : v.timbre || '音色',
        priority: 'P2',
        status: v.sample_url ? 'completed' : 'missing',
        required_views: ['sample'],
        notes: v.voiceStyle || v.timbre,
      }),
    );
  });

  const productionPlan = createEmptyDramaAssetProductionPlan({
    episode_id: epId,
    items,
    updated_at: Date.now(),
  });

  return { episodeBible, productionPlan };
}

function splitDramaCastBlob(raw: string): string[] {
  return String(raw || '')
    .split(/[、,，/|；;]+/)
    .map((s) => String(s || '').trim())
    .filter(Boolean);
}

/** 本集 visual_events / 分镜建议 / 原文说话人里实际出场的人物（用于分析页与前集体隔离） */
export function collectDramaEpisodeAppearingCharacterIds(
  session: DramaDirectorSession,
  episodeId?: string,
): Set<string> {
  const epId = String(episodeId || session.active_episode_id || '').trim();
  const names: string[] = [];
  const bibleEp = epId ? session.episode_bibles?.[epId] : undefined;
  // 优先：原文对白说话人顺序
  names.push(...collectOriginalSpeakerNamesInOrder(bibleEp?.original_segments || []));
  for (const ev of bibleEp?.visual_events || []) {
    if (ev.who && (ev.kind === 'dialogue' || String(ev.cut || '') === 'dialogue')) {
      names.push(...splitDramaCastBlob(ev.who));
    }
  }
  for (const seg of bibleEp?.original_segments || []) {
    if (
      seg.character_name &&
      (seg.type === 'dialogue' || seg.type === 'system' || seg.type === 'narration')
    ) {
      names.push(seg.character_name);
    }
  }
  for (const b of bibleEp?.character_bindings || []) {
    if (b.original_name && b.speaker_type !== 'system' && !isSystemSpeakerName(b.original_name)) {
      names.push(b.original_name);
    }
  }
  for (const s of bibleEp?.shot_suggestions || []) {
    for (const n of s.cast_names || []) names.push(String(n || '').trim());
    names.push(...extractCharacterNamesFromDialogueBlob(String(s.dialogue || '')));
  }
  if (epId && epId === session.active_episode_id) {
    for (const b of session.scene_beats || []) {
      for (const n of b.characters || []) names.push(String(n || '').trim());
    }
  }
  // 手动「添加角色」写入 directing_notes，必须计入本集出场
  for (const n of bibleEp?.directing_notes || []) {
    const nm = String(n.name || '').trim();
    if (nm) names.push(nm);
  }
  const segs = bibleEp?.original_segments || [];
  const cleaned = names
    .map((n) => coreDramaPersonName(n) || String(n || '').trim())
    .filter((n) => {
      if (!n) return false;
      if (isSystemSpeakerName(n)) return true;
      if (!isDramaStrictCastName(n)) return false;
      if (!segs.length) return true;
      return isDramaKeepCastSpeaker(n, segs);
    });
  const ids = new Set<string>();
  for (const n of bibleEp?.directing_notes || []) {
    const id = String(n.character_id || '').trim();
    if (id) ids.add(id);
  }
  for (const b of bibleEp?.character_bindings || []) {
    if (b.status === 'MATCHED' && b.character_id) ids.add(b.character_id);
  }
  for (const c of session.bible?.characters || []) {
    if (ids.has(c.character_id)) continue;
    if (
      cleaned.some(
        (n) => n === c.name || namesLikelySameDramaPerson(n, c.name),
      )
    ) {
      ids.add(c.character_id);
    }
  }
  return ids;
}

export function getActiveEpisodeBible(session: DramaDirectorSession): DramaEpisodeBible {
  const epId = session.active_episode_id;
  const cached = epId ? session.episode_bibles?.[epId] : undefined;
  if (hasEpisodeBibleContent(cached)) return createEmptyDramaEpisodeBible(cached);
  const ep = session.episodes.find((e) => e.episode_id === epId) || null;
  return deriveEpisodeBibleAndPlan(session, { episode: ep }).episodeBible;
}

export function getActiveProductionPlan(
  session: DramaDirectorSession,
): DramaAssetProductionPlan {
  const epId = session.active_episode_id;
  const cached = epId ? session.production_plans?.[epId] : undefined;
  if (cached?.items?.length) return createEmptyDramaAssetProductionPlan(cached);
  const ep = session.episodes.find((e) => e.episode_id === epId) || null;
  return deriveEpisodeBibleAndPlan(session, { episode: ep }).productionPlan;
}

export function attachEpisodeBibleAndPlan(
  session: DramaDirectorSession,
  episodeBible: DramaEpisodeBible,
  productionPlan: DramaAssetProductionPlan,
  episodeId?: string,
): DramaDirectorSession {
  const id = String(
    episodeId ||
      episodeBible.episode_id ||
      productionPlan.episode_id ||
      session.active_episode_id,
  ).trim();
  if (!id) return session;
  return {
    ...session,
    episode_bibles: {
      ...(session.episode_bibles || {}),
      [id]: createEmptyDramaEpisodeBible({
        ...episodeBible,
        episode_id: id,
        updated_at: Date.now(),
      }),
    },
    production_plans: {
      ...(session.production_plans || {}),
      [id]: createEmptyDramaAssetProductionPlan({
        ...productionPlan,
        episode_id: id,
        updated_at: Date.now(),
      }),
    },
  };
}

/** 把第二阶段 Shot Planning 结果写入本集 Episode Bible，不碰正式 shots。 */
export function attachDramaShotSuggestions(
  session: DramaDirectorSession,
  suggestions: DramaShotSuggestion[],
  episodeId?: string,
): DramaDirectorSession {
  const epId = String(episodeId || session.active_episode_id || '').trim();
  if (!epId) return session;
  const prev = session.episode_bibles?.[epId];
  const mapped = (suggestions || []).map((s) => createEmptyDramaShotSuggestion(s));
  const withDuration = finalizeShotSuggestionDurations(mapped, {
    paceStyle: session.meta?.durationPaceStyle,
    totalCapSec: session.meta?.durationTotalCapSec,
    previous: prev?.shot_suggestions,
  });
  if (!prev) {
    const { episodeBible, productionPlan } = deriveEpisodeBibleAndPlan(session, {
      shotSuggestions: withDuration,
    });
    return attachEpisodeBibleAndPlan(session, episodeBible, productionPlan, epId);
  }
  return {
    ...session,
    episode_bibles: {
      ...session.episode_bibles,
      [epId]: createEmptyDramaEpisodeBible({
        ...prev,
        shot_suggestions: withDuration,
        updated_at: Date.now(),
      }),
    },
  };
}

/** 旧 episode_plans → EpisodeBible */
export function migrateLegacyEpisodePlans(raw: unknown): Record<string, DramaEpisodeBible> {
  if (!raw || typeof raw !== 'object') return {};
  const out: Record<string, DramaEpisodeBible> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!v || typeof v !== 'object') continue;
    const p = v as Record<string, any>;
    const info = p.episode_info || {};
    const plot = p.plot_structure || {};
    const visual = p.visual_plan || {};
    out[k] = createEmptyDramaEpisodeBible({
      episode_id: info.episode_id || k,
      episode_no: info.episode_no,
      title: info.title,
      logline: info.logline,
      genre: info.genre,
      theme: info.theme,
      target_audience: info.target_audience,
      episodeBeat: {
        hook: plot.opening_hook || '',
        conflict: plot.main_conflict || '',
        turningPoint: plot.emotional_turn || '',
        climax: plot.climax || '',
        endingHook: plot.ending_suspense || '',
      },
      directing_notes: Array.isArray(p.character_directing) ? p.character_directing : [],
      visual_override: {
        style: visual.overall_style || '',
        color: visual.color_scheme || '',
        camera: visual.camera_language || visual.photography_style || '',
        lighting: '',
        referenceWorks: visual.reference_films || [],
        negativePrompt: '',
      },
      shot_suggestions: Array.isArray(p.shot_suggestions)
        ? p.shot_suggestions.map((s: any) => createEmptyDramaShotSuggestion(s))
        : [],
      updated_at: p.updated_at || Date.now(),
    });
  }
  return out;
}
