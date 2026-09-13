import { runDramaContinuityCheck } from './continuity.js';
import {
  createEmptyDramaSceneBeat,
  createEmptyDramaSession,
  createEmptyDramaShot,
  createEmptyDramaDialogueLine,
  parseDurationSec,
} from './factories.js';
import { buildAllDramaGenerationPackages } from './package.js';
import { reviewAllDramaShots } from './review.js';
import { ensureAppearingCharactersInBible, resolveDramaCharacterIdByName } from './ensureAppearingCharacters.js';
import { dramaPromptSourceFingerprint, dramaSuggestionAsPromptSource } from './boardPromptSync.js';
import { createEmptyDramaEpisodeBible } from './episodeBible.js';
import { ensureDramaShotTimelineEvents } from './timelineEvent.js';
import type {
  DramaDirectorSession,
  DramaDomainPhase,
  DramaShot,
  DramaShotSuggestion,
} from './types.js';
import { normalizeDramaDomainPhase } from './factories.js';

export function setDramaSessionPhase(
  session: DramaDirectorSession,
  phase: DramaDomainPhase | string,
): DramaDirectorSession {
  return {
    ...session,
    meta: {
      ...session.meta,
      phase: normalizeDramaDomainPhase(phase),
    },
  };
}

export function refreshDramaContinuity(session: DramaDirectorSession): DramaDirectorSession {
  return {
    ...session,
    continuity_issues: runDramaContinuityCheck(session),
  };
}

export function refreshDramaPackages(
  session: DramaDirectorSession,
  adapter_id?: string,
): DramaDirectorSession {
  return {
    ...session,
    packages: buildAllDramaGenerationPackages(session, adapter_id),
  };
}

export function refreshDramaReviews(session: DramaDirectorSession): DramaDirectorSession {
  return {
    ...session,
    reviews: reviewAllDramaShots(session),
    continuity_issues: runDramaContinuityCheck(session),
  };
}

/** 用户确认后：一条 ShotSuggestion → 一条正式 DramaShot（1:1，禁止在此拆出更多镜头） */
export function convertShotSuggestionsToDramaShots(
  session: DramaDirectorSession,
  suggestions?: DramaShotSuggestion[],
): { shots: DramaShot[]; scene_beats: DramaDirectorSession['scene_beats'] } {
  const epId = session.active_episode_id;
  const list =
    suggestions || session.episode_bibles?.[epId]?.shot_suggestions || [];
  const characters = session.bible.characters || [];
  const locToId = new Map<string, string>();
  for (const sc of session.bible.scenes) {
    locToId.set(sc.name, sc.scene_id);
    locToId.set(sc.location, sc.scene_id);
  }

  const sceneNoToBeat = new Map<string, DramaDirectorSession['scene_beats'][0]>();
  const locationToBeat = new Map<string, DramaDirectorSession['scene_beats'][0]>();
  for (const b of session.scene_beats || []) {
    if (b.scene_no) sceneNoToBeat.set(String(b.scene_no), b);
    if (b.location_name) locationToBeat.set(b.location_name, b);
  }
  const scene_beats: DramaDirectorSession['scene_beats'] = [];

  // 场景名宽松匹配：精确 → 去空白小写 → 包含，避免 LLM 场景名与素材名细微差异导致丢场景
  const normScene = (s: string) => String(s || '').replace(/\s+/g, '').toLowerCase();
  const resolveSceneId = (raw: string): string => {
    const name = String(raw || '').trim();
    if (!name) return '';
    const exact = locToId.get(name);
    if (exact) return exact;
    const target = normScene(name);
    if (!target) return '';
    for (const sc of session.bible.scenes) {
      if (normScene(sc.name) === target || normScene(sc.location) === target) return sc.scene_id;
    }
    for (const sc of session.bible.scenes) {
      const n = normScene(sc.name);
      const l = normScene(sc.location);
      if ((n && (n.includes(target) || target.includes(n))) ||
          (l && (l.includes(target) || target.includes(l)))) {
        return sc.scene_id;
      }
    }
    return '';
  };

  const shots: DramaShot[] = [];
  list.forEach((sug, idx) => {
    let beat =
      locationToBeat.get(sug.scene) ||
      sceneNoToBeat.get(sug.scene) ||
      null;
    if (!beat) {
      beat = createEmptyDramaSceneBeat({
        scene_no: String(idx + 1),
        location_name: sug.scene,
        scene_asset_id: resolveSceneId(sug.scene),
      });
      sceneNoToBeat.set(beat.scene_no, beat);
      if (beat.location_name) locationToBeat.set(beat.location_name, beat);
      scene_beats.push(beat);
    }
    const resolveCastId = (name: string): string =>
      resolveDramaCharacterIdByName(characters, name);
    const cast_names = sug.cast_names || [];
    const dialogueParts = String(sug.dialogue || '')
      .split(/\s*\/\s*/)
      .map((x) => x.trim())
      .filter(Boolean);
    const spokenParts = dialogueParts.map((part) => {
      const cleaned = String(part || '')
        .replace(/【潜台词[:：]?[^】]*】/g, '')
        .trim();
      const m = cleaned.match(/^(.+?)[：:](.+)$/);
      if (m) {
        const character_name = m[1].trim();
        return createEmptyDramaDialogueLine({
          character_name,
          character_id: resolveCastId(character_name),
          text: m[2].trim(),
        });
      }
      return createEmptyDramaDialogueLine({ character_name: '', character_id: '', text: cleaned });
    });
    const dialogue = spokenParts.filter((d) => d.text);

    // 道具/生物绑定：优先用分镜建议的结构化 prop_names/creature_names 按名匹配素材；文本检测兜底
    const shotText = [
      sug.action,
      sug.purpose,
      sug.environment,
      sug.visual_focus,
      sug.blocking,
      sug.dramatic_purpose,
      String(sug.dialogue || ''),
    ]
      .filter(Boolean)
      .join(' ')
      .replace(/\s+/g, '')
      .toLowerCase();
    const normName = (s: string) => String(s || '').replace(/\s+/g, '').toLowerCase();
    const nameHit = (rawName: string, name: string): boolean => {
      const a = normName(rawName);
      const b = normName(name);
      if (!a || !b) return false;
      return a === b || (a.length >= 2 && b.length >= 2 && (a.includes(b) || b.includes(a)));
    };
    const resolvePropIds = (names: string[] | undefined): string[] =>
      (names || [])
        .map((rawName) => session.bible.props.find((p) => nameHit(rawName, p.name))?.prop_id)
        .filter(Boolean) as string[];
    const resolveCreatureIds = (names: string[] | undefined): string[] =>
      (names || [])
        .map((rawName) => session.bible.creatures.find((c) => nameHit(rawName, c.name))?.creature_id)
        .filter(Boolean) as string[];
    const structuredPropIds = resolvePropIds(sug.prop_names);
    const structuredCreatureIds = resolveCreatureIds(sug.creature_names);
    const mentionHit = (rawName: string): boolean => {
      const n = normName(rawName);
      return n.length >= 2 && !!shotText && shotText.includes(n);
    };
    const prop_ids = [
      ...new Set([
        ...structuredPropIds,
        ...session.bible.props.filter((p) => mentionHit(p.name)).map((p) => p.prop_id),
      ]),
    ];
    const creature_ids = [
      ...new Set([
        ...structuredCreatureIds,
        ...session.bible.creatures.filter((c) => mentionHit(c.name)).map((c) => c.creature_id),
      ]),
    ];

    shots.push(
      ensureDramaShotTimelineEvents(createEmptyDramaShot({
        scene_beat_id: beat.scene_beat_id,
        shot_no: sug.shot || String(idx + 1),
        duration_sec: parseDurationSec(sug.duration_sec, 6),
        purpose: sug.purpose,
        size: sug.size,
        camera: sug.camera,
        angle: sug.camera,
        move: sug.move,
        action: sug.action,
        expression: sug.emotion_play || '',
        blocking: sug.blocking || '',
        lighting: sug.lighting || '',
        atmosphere: sug.time_of_day || '',
        environment: sug.environment || '',
        dialogue,
        sfx: sug.sound,
        continuity_notes: [sug.subtext, sug.transition_in, sug.transition_out]
          .filter(Boolean)
          .join(' → '),
        character_ids: cast_names.map((n) => resolveCastId(n)).filter(Boolean),
        scene_asset_id: beat.scene_asset_id || resolveSceneId(beat.location_name || sug.scene),
        prop_ids,
        creature_ids,
        dramatic_purpose: sug.dramatic_purpose || '',
        visual_focus: sug.visual_focus || '',
        transition_in: sug.transition_in || '',
        transition_out: sug.transition_out || '',
        visual_event_ids:
          (sug.visual_event_ids || []).length > 0
            ? sug.visual_event_ids
            : Array.isArray((sug as { event_ids?: string[] }).event_ids)
              ? ((sug as { event_ids?: string[] }).event_ids || []).map(String).filter(Boolean)
              : [],
        prompt_source_fingerprint: dramaPromptSourceFingerprint(
          dramaSuggestionAsPromptSource(sug),
        ),
      }), session),
    );
  });

  return { shots, scene_beats };
}

function shotActionSig(action: string, no: string): string {
  return `${String(no || '').trim()}|${String(action || '')
    .replace(/\s+/g, '')
    .slice(0, 24)}`;
}

function workingShotsFingerprint(shots: DramaShot[]): string {
  return (shots || [])
    .slice(0, 8)
    .map((s) => shotActionSig(s.action, s.shot_no))
    .join('~');
}

function suggestionFingerprint(suggestions: DramaShotSuggestion[]): string {
  return (suggestions || [])
    .slice(0, 8)
    .map((s) => shotActionSig(s.action, s.shot))
    .join('~');
}

export function dramaWorkingShotsBelongToEpisode(
  session: DramaDirectorSession,
  episodeId: string,
): boolean {
  const shots = session.shots || [];
  if (!shots.length) return true;
  const epId = String(episodeId || '').trim();
  if (!epId) return false;
  const bible = session.episode_bibles?.[epId];
  if (!bible) return false;
  const official = bible.official_shots || [];
  if (official.length && workingShotsFingerprint(shots) === workingShotsFingerprint(official)) {
    return true;
  }
  const sug = bible.shot_suggestions || [];
  if (!sug.length) return false;
  if (workingShotsFingerprint(shots) === suggestionFingerprint(sug)) return true;
  if (shots.length === sug.length) {
    const a = String(shots[0]?.action || '')
      .replace(/\s+/g, '')
      .slice(0, 16);
    const b = String(sug[0]?.action || '')
      .replace(/\s+/g, '')
      .slice(0, 16);
    if (a && b && (a === b || a.includes(b) || b.includes(a))) return true;
  }
  return false;
}

function inferEpisodeIdForWorkingShots(session: DramaDirectorSession): string {
  const active = String(session.active_episode_id || '').trim();
  if (dramaWorkingShotsBelongToEpisode(session, active)) return active;
  for (const ep of session.episodes || []) {
    if (ep.episode_id !== active && dramaWorkingShotsBelongToEpisode(session, ep.episode_id)) {
      return ep.episode_id;
    }
  }
  if ((session.shots || []).length && (session.episodes || [])[0]?.episode_id) {
    return session.episodes[0].episode_id;
  }
  return active;
}

export function stashDramaEpisodeWorkingSet(
  session: DramaDirectorSession,
  episodeId?: string,
): DramaDirectorSession {
  const epId = String(episodeId || session.active_episode_id || '').trim();
  if (!epId) return session;
  const prev = session.episode_bibles?.[epId];
  const ep = (session.episodes || []).find((e) => e.episode_id === epId);
  return {
    ...session,
    episode_bibles: {
      ...(session.episode_bibles || {}),
      [epId]: createEmptyDramaEpisodeBible({
        ...(prev || {}),
        episode_id: epId,
        episode_no: prev?.episode_no || ep?.episode_no || 0,
        title: prev?.title || ep?.title || '',
        official_shots: session.shots || [],
        official_scene_beats: session.scene_beats || [],
        updated_at: Date.now(),
      }),
    },
  };
}

export function restoreDramaEpisodeWorkingSet(
  session: DramaDirectorSession,
  episodeId: string,
): DramaDirectorSession {
  const epId = String(episodeId || '').trim();
  if (!epId) return session;
  const bible = session.episode_bibles?.[epId];
  const official = bible?.official_shots || [];
  if (official.length) {
    return {
      ...session,
      active_episode_id: epId,
      shots: official,
      scene_beats: bible?.official_scene_beats?.length
        ? bible.official_scene_beats
        : [],
    };
  }
  const converted = convertShotSuggestionsToDramaShots({
    ...session,
    active_episode_id: epId,
  });
  return {
    ...session,
    active_episode_id: epId,
    shots: converted.shots,
    scene_beats: converted.scene_beats,
  };
}

/** 切集：先把当前镜头表存回所属集，再载入目标集 */
export function activateDramaEpisode(
  session: DramaDirectorSession,
  episodeId: string,
): DramaDirectorSession {
  const target = String(episodeId || '').trim();
  if (!target) return session;
  const owner = inferEpisodeIdForWorkingShots(session);
  let next = session;
  if ((next.shots || []).length || (next.scene_beats || []).length) {
    next = stashDramaEpisodeWorkingSet(next, owner);
  }
  const ep = (next.episodes || []).find((e) => e.episode_id === target);
  next = {
    ...next,
    active_episode_id: target,
    meta: {
      ...next.meta,
      source_script: String(ep?.text || next.meta.source_script || '').trim(),
    },
  };
  return restoreDramaEpisodeWorkingSet(next, target);
}

/** 删除一集：清 episodes / episode_bibles / production_plans，并重选 active */
export function removeDramaEpisode(
  session: DramaDirectorSession,
  episodeId: string,
): DramaDirectorSession {
  const id = String(episodeId || '').trim();
  if (!id) return session;
  const episodes = (session.episodes || []).filter((e) => e.episode_id !== id);
  if (episodes.length === (session.episodes || []).length) return session;
  const episode_bibles = { ...(session.episode_bibles || {}) };
  delete episode_bibles[id];
  const production_plans = { ...(session.production_plans || {}) };
  delete production_plans[id];
  const wasActive = String(session.active_episode_id || '').trim() === id;
  const nextActive = wasActive
    ? String(episodes[0]?.episode_id || '').trim()
    : String(session.active_episode_id || '').trim();
  const activeEp = episodes.find((e) => e.episode_id === nextActive) || null;
  let next = createEmptyDramaSession({
    ...session,
    episodes,
    episode_bibles,
    production_plans,
    active_episode_id: nextActive,
    meta: {
      ...session.meta,
      source_script: activeEp ? String(activeEp.text || '').trim() : '',
      phase:
        wasActive && String(session.meta?.phase || '').trim() === 'analyze'
          ? 'episodes'
          : session.meta.phase,
      analyze_confirmed: wasActive ? false : session.meta.analyze_confirmed,
    },
  });
  if (nextActive && wasActive) {
    next = restoreDramaEpisodeWorkingSet(next, nextActive);
  } else if (wasActive && !nextActive) {
    next = createEmptyDramaSession({
      ...next,
      shots: [],
      scene_beats: [],
    });
  }
  return next;
}

/** 当前工作镜头表若仍是其他集的，换成本集 */
export function ensureDramaActiveEpisodeWorkingSet(
  session: DramaDirectorSession,
): DramaDirectorSession {
  const active = String(session.active_episode_id || '').trim();
  if (!active) return session;
  if (dramaWorkingShotsBelongToEpisode(session, active)) return session;
  return activateDramaEpisode(session, active);
}

export function confirmDramaAnalyze(session: DramaDirectorSession): DramaDirectorSession {
  const aligned = ensureDramaActiveEpisodeWorkingSet(session);
  const epId = aligned.active_episode_id;
  let shots = aligned.shots || [];
  let scene_beats = aligned.scene_beats || [];
  if (!shots.length || !dramaWorkingShotsBelongToEpisode(aligned, epId)) {
    const converted = convertShotSuggestionsToDramaShots(aligned);
    shots = converted.shots;
    scene_beats = converted.scene_beats;
  }
  const withShots: DramaDirectorSession = {
    ...aligned,
    scene_beats,
    shots,
    bible: {
      ...aligned.bible,
      confirmed_at: Date.now(),
    },
    meta: {
      ...aligned.meta,
      analyze_confirmed: true,
      board_confirmed_at: 0,
      assets_confirmed_at: 0,
      phase: 'assets',
      needs_stage_reconfirm: false,
    },
  };
  return stashDramaEpisodeWorkingSet(
    ensureAppearingCharactersInBible(withShots),
    epId,
  );
}

/** @deprecated 旧名；语义改为确认分析并进入素材准备 */
export function confirmDramaBible(session: DramaDirectorSession): DramaDirectorSession {
  return confirmDramaAnalyze(session);
}

export function invalidateDramaConfirmationsAfter(
  session: DramaDirectorSession,
  from: 'analyze' | 'board' | 'assets' | 'visual' | 'asset_match',
): DramaDirectorSession {
  const meta = { ...session.meta };
  if (from === 'analyze' || from === 'visual') {
    if (from === 'analyze') meta.analyze_confirmed = false;
    meta.board_confirmed_at = 0;
    meta.assets_confirmed_at = 0;
    const epId = String(session.active_episode_id || '').trim();
    let episode_bibles = session.episode_bibles || {};
    if (epId && episode_bibles[epId]) {
      const b = episode_bibles[epId];
      episode_bibles = {
        ...episode_bibles,
        [epId]: {
          ...b,
          ...(from === 'analyze'
            ? { asset_match_at: 0, duration_split_at: b.duration_split_at }
            : {}),
          ...(from === 'visual' ? { asset_match_at: 0 } : {}),
        },
      };
    }
    return createEmptyDramaSession({
      ...session,
      episode_bibles,
      bible: {
        ...session.bible,
        confirmed_at: from === 'analyze' ? 0 : session.bible.confirmed_at,
      },
      meta,
    });
  }
  if (from === 'assets' || from === 'asset_match') {
    meta.assets_confirmed_at = 0;
    meta.board_confirmed_at = 0;
    const epId = String(session.active_episode_id || '').trim();
    let episode_bibles = session.episode_bibles || {};
    if (from === 'asset_match' && epId && episode_bibles[epId]) {
      episode_bibles = {
        ...episode_bibles,
        [epId]: { ...episode_bibles[epId], asset_match_at: 0 },
      };
    }
    return createEmptyDramaSession({ ...session, episode_bibles, meta });
  }
  // from === 'board'：只解除导演表，保留已确认素材
  meta.board_confirmed_at = 0;
  return createEmptyDramaSession({ ...session, meta });
}

/** 确认导演表；出片仍在本步，不跳转已取消的「批量生成」页 */
export function confirmDramaBoard(session: DramaDirectorSession): DramaDirectorSession {
  return {
    ...session,
    meta: {
      ...session.meta,
      board_confirmed_at: Date.now(),
      phase: 'board',
      needs_stage_reconfirm: false,
    },
  };
}

export function isDramaShotConfirmed(shot: DramaShot): boolean {
  return Number(shot?.confirmed_at || 0) > 0;
}

export function unlockDramaBoard(session: DramaDirectorSession): DramaDirectorSession {
  return invalidateDramaConfirmationsAfter(
    { ...session, meta: { ...session.meta, phase: 'board' } },
    'board',
  );
}

/** 确认素材 → 导演分镜 */
export function confirmDramaAssets(session: DramaDirectorSession): DramaDirectorSession {
  return {
    ...session,
    meta: {
      ...session.meta,
      assets_confirmed_at: Date.now(),
      board_confirmed_at: 0,
      phase: 'board',
      needs_stage_reconfirm: false,
    },
  };
}

export function unlockDramaAssets(session: DramaDirectorSession): DramaDirectorSession {
  return invalidateDramaConfirmationsAfter(
    { ...session, meta: { ...session.meta, phase: 'assets' } },
    'assets',
  );
}

/**
 * 旧项目打开：标记需重新确认（不改 phase / 不删数据）。
 */
export function applyDramaLegacyUserFlowNotice(
  session: DramaDirectorSession,
): DramaDirectorSession {
  const analyzeOk = !!(session.meta.analyze_confirmed || session.bible.confirmed_at);
  const boardOk = Number(session.meta.board_confirmed_at || 0) > 0;
  const assetsOk = Number(session.meta.assets_confirmed_at || 0) > 0;
  const phase = normalizeDramaDomainPhase(session.meta.phase);

  let needs = !!session.meta.needs_stage_reconfirm;
  // 新流程：分析后应先有素材确认，再进分镜/批量
  if (
    analyzeOk &&
    !assetsOk &&
    (phase === 'board' || phase === 'videos' || phase === 'review')
  ) {
    needs = true;
  }
  if ((phase === 'videos' || phase === 'review') && assetsOk && !boardOk) {
    needs = true;
  }
  if (needs === !!session.meta.needs_stage_reconfirm) return session;
  return createEmptyDramaSession({
    ...session,
    meta: { ...session.meta, needs_stage_reconfirm: needs },
  });
}

export function clearDramaLegacyUserFlowNotice(
  session: DramaDirectorSession,
): DramaDirectorSession {
  if (!session.meta.needs_stage_reconfirm) return session;
  return createEmptyDramaSession({
    ...session,
    meta: { ...session.meta, needs_stage_reconfirm: false },
  });
}

/** 落盘快照结构 */
export interface DramaDomainDiskSnapshot {
  schemaVersion: string;
  saved_at: number;
  session: DramaDirectorSession;
}

export function createDramaDiskSnapshot(session: DramaDirectorSession): DramaDomainDiskSnapshot {
  return {
    schemaVersion: session.meta.schemaVersion,
    saved_at: Date.now(),
    session: createEmptyDramaSession(session),
  };
}
