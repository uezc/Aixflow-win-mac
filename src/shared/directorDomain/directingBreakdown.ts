/**
 * 导演拆戏与时间编译层。
 * 硬规则：只细化已有 Shot 的表演/时间轴，禁止新增或删除镜头。
 * 拆镜（Visual Events → Shot Suggestions）属于 Shot Planning，不在本模块。
 */

import { dramaNewId } from './ids.js';
import { createEmptyDramaShot } from './factories.js';
import {
  createEmptyDramaTimelineEvent,
  differentiateDuplicateTimelineCuts,
  isDramaTimelineEventsThin,
  normalizeDramaTimelineEvents,
} from './timelineEvent.js';
import { dramaShotHasSpokenDialogue } from './migrateH3Compiler.js';
import {
  allocateBeatWindows,
  clampDramaEmotionIntensity,
  inferDramaAxisStatus,
  inferDramaEmotionTrend,
  lipSyncAllowed,
} from './directingBreakdownRules.js';
import {
  applyLockedCameraToBeatFields,
  inferDramaPrimaryPurpose,
  stripConflictingCameraLanguage,
  PURPOSE_ZH,
} from './directorCameraSchema.js';
import { composeDramaCinematicCameraDesign } from './cinematicCameraAction.js';
import {
  actionRespectsEndState,
  collapseDuplicateActionText,
  expandVisiblePerformance,
  formatEndState,
  inferBeatEndState,
  inferGazeTargetId,
  mergeActionAndEvent,
  sanitizeSilentCharacterText,
} from './visiblePerformance.js';
import { qaDramaDirectingBeats } from './directorQa.js';
import type {
  DramaAxisStatus,
  DramaBeatEndState,
  DramaContinuityStatus,
  DramaDirectingAnswers,
  DramaDirectingBeat,
  DramaDirectorSession,
  DramaShot,
  DramaShotDirectingBreakdown,
  DramaTimelineEvent,
} from './types.js';

export function dramaShotDirectingFingerprint(shot: Pick<
  DramaShot,
  'shot_id' | 'action' | 'purpose' | 'duration_sec' | 'scene_asset_id' | 'character_ids' | 'dialogue'
>): string {
  const dlg = (shot.dialogue || [])
    .map((d) => `${d.character_id || d.character_name || ''}:${d.text || ''}`)
    .join('|');
  return [
    shot.shot_id,
    shot.duration_sec,
    shot.scene_asset_id,
    (shot.character_ids || []).join(','),
    String(shot.purpose || '').trim(),
    String(shot.action || '').trim().slice(0, 180),
    dlg.slice(0, 240),
  ].join('::');
}

function emptyAnswers(shot: DramaShot): DramaDirectingAnswers {
  const hasDialogue = dramaShotHasSpokenDialogue(shot);
  return {
    story: String(shot.action || shot.purpose || '').trim() || '推进本镜事件',
    purpose: String(shot.purpose || '').trim() || '推进剧情',
    visualSubject: (shot.character_ids || [])[0] || '',
    emotion: String(shot.expression || '').trim() || '克制',
    emotionTrend: 'hold',
    keyInfo: String(shot.action || '').trim().slice(0, 80) || '关键动作',
    seeFirst: '先看主体动作',
    seeNext: '再看反应或结果',
    hasDialogue,
    needsLipsync: hasDialogue,
    nextHandoff: String(shot.continuity_notes || '').trim() || '保持结束状态进入下一镜',
  };
}

function beatFromTimelineEvent(
  ev: DramaTimelineEvent,
  shot: DramaShot,
  idx: number,
  prevOut: string,
): DramaDirectingBeat {
  const dlg = String(ev.dialogue || '').trim();
  const speaker = String(ev.dialogue_character_id || '').trim();
  const lip = lipSyncAllowed(dlg, speaker) && !!ev.lip_sync;
  const emotion = String(ev.expression || ev.character_state || shot.expression || '').trim();
  const intensity = clampDramaEmotionIntensity(lip ? 8 : /惊|怒|爆/.test(emotion) ? 7 : 5);
  return {
    beatId: ev.event_id || dramaNewId('beat'),
    purpose: lip ? '对白' : idx === 0 ? '建立' : '反应',
    event: ev.visual_action || shot.action,
    emotion,
    emotionIntensity: intensity,
    characters: ev.character_ids?.length ? [...ev.character_ids] : [...(shot.character_ids || [])],
    action: ev.visual_action || shot.action,
    dialogue: dlg,
    dialogueCharacterId: speaker,
    audioStart: ev.start_sec,
    audioEnd: ev.end_sec,
    duration: Math.max(0.4, ev.end_sec - ev.start_sec),
    shotType: '',
    camera: '',
    lens: '',
    composition: '',
    movement: '',
    performance: '',
    continuityIn: prevOut || '从上一拍结束状态进入',
    continuityOut: ev.visual_action || '保持本拍结束姿态',
    lipSync: lip,
    environmentSound: (ev.environment_audio || []).join('、'),
  };
}

function constrainBeat(
  raw: Partial<DramaDirectingBeat>,
  shot: DramaShot,
  fallbackId: string,
): DramaDirectingBeat {
  const dialogue = String(raw.dialogue || '').trim();
  const dialogueCharacterId = String(raw.dialogueCharacterId || '').trim();
  const lip = lipSyncAllowed(dialogue, dialogueCharacterId);
  const emotion = String(raw.emotion || shot.expression || '').trim();
  const intensity = clampDramaEmotionIntensity(Number(raw.emotionIntensity) || (lip ? 8 : 5));
  return {
    beatId: String(raw.beatId || '').trim() || fallbackId,
    purpose: String(raw.purpose || '').trim() || (lip ? '对白' : '动作'),
    event: String(raw.event || raw.action || shot.action || '').trim(),
    emotion,
    emotionIntensity: intensity,
    characters: Array.isArray(raw.characters) && raw.characters.length
      ? raw.characters.map(String)
      : [...(shot.character_ids || [])],
    action: String(raw.action || raw.event || shot.action || '').trim(),
    dialogue,
    dialogueCharacterId: lip ? dialogueCharacterId : '',
    audioStart: Number(raw.audioStart) || 0,
    audioEnd: Number(raw.audioEnd) || 0,
    duration: Math.max(0.4, Number(raw.duration) || 1),
    shotType: '',
    camera: '',
    lens: '',
    composition: '',
    movement: '',
    performance: '',
    continuityIn: String(raw.continuityIn || '').trim() || '承接上一拍结束状态',
    continuityOut: String(raw.continuityOut || '').trim() || '保持本拍结束姿态',
    lipSync: lip,
    environmentSound: String(raw.environmentSound || '').trim(),
  };
}

function differentiateDuplicateBeatCoverage(
  shot: DramaShot,
  beats: DramaDirectingBeat[],
): DramaDirectingBeat[] {
  // 不再注入【全景交代…】等 AI 导演前缀；仅剥离历史污染，导演权交给 Skill
  void shot;
  return beats.map((b) => {
    const visibleAction = String(b.visibleAction || '')
      .replace(/^【(?:全景交代人物与环境位置|中景看肢体与站位|近景看面部与眼神)】\s*/g, '')
      .replace(/【(?:全景交代人物与环境位置|中景看肢体与站位|近景看面部与眼神)】/g, '')
      .trim();
    return visibleAction === b.visibleAction ? b : { ...b, visibleAction };
  });
}

function designBeatCinematicCamera(
  shot: DramaShot,
  b: Pick<DramaDirectingBeat, 'event' | 'action' | 'dialogue' | 'emotion' | 'camera'>,
  index: number,
  total: number,
  prevLine: string,
) {
  return composeDramaCinematicCameraDesign({
    shot,
    event: {
      visual_action: `${b.event || ''} ${b.action || ''}`.trim(),
      dialogue: b.dialogue,
      expression: b.emotion,
      camera_action: b.camera,
    },
    index,
    total,
    prevLine,
  });
}

export function finalizeDramaDirectingBeats(
  shot: DramaShot,
  beats: DramaDirectingBeat[],
  nameById?: Map<string, string>,
): DramaDirectingBeat[] {
  let prevCamLine = '';
  let prevEnd: DramaBeatEndState | null = null;
  let prevPrimary: string[] = [];
  const names = nameById || new Map<string, string>();
  const shotIds = [...(shot.character_ids || [])];
  const total = beats.length;
  const out = beats.map((b, i) => {
    const lip = lipSyncAllowed(b.dialogue, b.dialogueCharacterId);
    const primaryPurpose = inferDramaPrimaryPurpose({
      purpose: b.purpose,
      event: b.event,
      action: b.action,
      emotion: b.emotion,
      hasDialogue: lip,
      index: i,
      total,
    });
    const design = designBeatCinematicCamera(shot, b, i, total, prevCamLine);
    const lockedCamera = design.recipe.locked;
    prevCamLine = design.line;
    const rawAction = lip ? String(b.action || '').trim() : sanitizeSilentCharacterText(b.action);
    const action = stripConflictingCameraLanguage(
      actionRespectsEndState(mergeActionAndEvent(rawAction, String(b.event || '')), prevEnd),
      lockedCamera.cameraMovement,
    );
    const visiblePerformance = stripConflictingCameraLanguage(
      expandVisiblePerformance(b.emotion, action),
      lockedCamera.cameraMovement,
    );
    const visibleAction = collapseDuplicateActionText(visiblePerformance || action, [...names.values()]);
    const mutual = b.characters.length > 1 && /彼此|试探/.test(visiblePerformance);
    const gazeTarget = inferGazeTargetId({
      selfIds: b.characters,
      shotCharacterIds: shotIds.length ? shotIds : b.characters,
      prevPrimaryIds: prevPrimary,
      prevGazeTarget: prevEnd?.gazeTarget,
      blob: `${b.event || ''} ${action} ${visiblePerformance} ${b.emotion || ''}`,
      nameById: names,
      mutual,
    });
    const endState = inferBeatEndState(action, visiblePerformance, prevEnd, gazeTarget);
    const fields = applyLockedCameraToBeatFields(lockedCamera);
    fields.camera = design.line;
    fields.movement = design.recipe.move;
    const continuityIn = prevEnd ? `承接：${formatEndState(prevEnd, names)}` : b.continuityIn;
    const continuityOut = formatEndState(endState, names);
    prevEnd = endState;
    prevPrimary = [...(b.characters || [])];
    return {
      ...b,
      lipSync: lip,
      dialogue: lip ? b.dialogue : '',
      dialogueCharacterId: lip ? b.dialogueCharacterId : '',
      action,
      primaryPurpose,
      lockedCamera,
      visiblePerformance,
      visibleAction,
      performance: visiblePerformance,
      gazeTarget,
      endState,
      purpose: PURPOSE_ZH[primaryPurpose],
      ...fields,
      continuityIn,
      continuityOut,
    };
  });
  const qa = qaDramaDirectingBeats(shot, out);
  if (qa.ok) return differentiateDuplicateBeatCoverage(shot, out);
  prevCamLine = '';
  prevEnd = null;
  prevPrimary = [];
  return differentiateDuplicateBeatCoverage(shot, out.map((b, i) => {
    const design = designBeatCinematicCamera(shot, b, i, total, prevCamLine);
    const lockedCamera = design.recipe.locked;
    prevCamLine = design.line;
    const action = stripConflictingCameraLanguage(
      b.lipSync ? b.action : sanitizeSilentCharacterText(actionRespectsEndState(b.action, prevEnd)),
      lockedCamera.cameraMovement,
    );
    const visiblePerformance = stripConflictingCameraLanguage(
      expandVisiblePerformance(b.emotion, action),
      lockedCamera.cameraMovement,
    );
    const visibleAction = collapseDuplicateActionText(visiblePerformance || action, [...names.values()]);
    const mutual = b.characters.length > 1 && /彼此|试探/.test(visiblePerformance);
    const gazeTarget = inferGazeTargetId({
      selfIds: b.characters,
      shotCharacterIds: shotIds.length ? shotIds : b.characters,
      prevPrimaryIds: prevPrimary,
      prevGazeTarget: prevEnd?.gazeTarget,
      blob: `${action} ${visiblePerformance}`,
      nameById: names,
      mutual,
    });
    const endState = inferBeatEndState(action, visiblePerformance, prevEnd, gazeTarget);
    prevEnd = endState;
    prevPrimary = [...(b.characters || [])];
    const fields = applyLockedCameraToBeatFields(lockedCamera);
    fields.camera = design.line;
    fields.movement = design.recipe.move;
    return {
      ...b,
      action,
      visiblePerformance,
      visibleAction,
      performance: visiblePerformance,
      gazeTarget,
      lockedCamera,
      endState,
      ...fields,
      continuityIn: i === 0 ? b.continuityIn : `承接：${formatEndState(out[i - 1].endState!, names)}`,
      continuityOut: formatEndState(endState, names),
    };
  }));
}

function layoutBeats(
  durationSec: number,
  beats: DramaDirectingBeat[],
  audioAnchors?: Array<{ text: string; start: number; end: number }>,
): DramaDirectingBeat[] {
  const windows = allocateBeatWindows(durationSec, beats, audioAnchors);
  return beats.map((b, i) => {
    const w = windows[i] || { start: 0, end: durationSec };
    return {
      ...b,
      audioStart: w.start,
      audioEnd: w.end,
      duration: Math.max(0.4, w.end - w.start),
      lipSync: lipSyncAllowed(b.dialogue, b.dialogueCharacterId),
    };
  });
}

export function buildDramaDirectingBreakdown(
  session: DramaDirectorSession,
  shot: DramaShot,
  prev: DramaShot | null,
  llm?: { answers?: Partial<DramaDirectingAnswers>; beats?: Array<Partial<DramaDirectingBeat>> },
): DramaShotDirectingBreakdown {
  const events = Array.isArray(shot.timeline_events) ? shot.timeline_events : [];
  const dur = shot.duration_sec || 10;
  const audioAnchors = (Array.isArray(shot.audio_timeline) ? shot.audio_timeline : [])
    .filter((a) => {
      const text = String(a?.text || '').trim();
      const span = Number(a?.end_sec) - Number(a?.start_sec);
      return text && Number.isFinite(span) && span >= 0.4 && span < dur * 0.9;
    })
    .map((a) => ({ text: String(a.text), start: Number(a.start_sec) || 0, end: Number(a.end_sec) || 0 }));
  let beats: DramaDirectingBeat[] = [];
  if (llm?.beats?.length) {
    beats = llm.beats.map((b, i) => constrainBeat(b, shot, dramaNewId(`beat${i + 1}`)));
    beats = layoutBeats(dur, beats, audioAnchors);
  } else if (events.length) {
    let prevOut = String(prev?.directing_breakdown?.beats?.slice(-1)[0]?.continuityOut || prev?.action || '').trim();
    beats = events.map((ev, i) => {
      const beat = beatFromTimelineEvent(ev, shot, i, prevOut);
      prevOut = beat.continuityOut;
      return beat;
    });
  } else {
    beats = layoutBeats(
      dur,
      [
        constrainBeat(
          {
            purpose: shot.purpose,
            event: shot.action,
            action: shot.action,
            emotion: shot.expression,
            dialogue: shot.dialogue?.[0]?.text || '',
            dialogueCharacterId: shot.dialogue?.[0]?.character_id || '',
            environmentSound: shot.sfx,
          },
          shot,
          dramaNewId('beat1'),
        ),
      ],
      audioAnchors,
    );
  }

  beats = finalizeDramaDirectingBeats(
    shot,
    beats,
    new Map((session.bible.characters || []).map((c) => [c.character_id, c.name])),
  );

  const intensities = beats.map((b) => b.emotionIntensity);
  const answers: DramaDirectingAnswers = {
    ...emptyAnswers(shot),
    ...(llm?.answers || {}),
    hasDialogue: beats.some((b) => !!b.dialogue),
    needsLipsync: beats.some((b) => b.lipSync),
    emotionTrend: inferDramaEmotionTrend(intensities[0] || 5, intensities[intensities.length - 1] || 5),
  };
  const last = beats[beats.length - 1];
  if (last?.endState) {
    answers.nextHandoff = answers.nextHandoff || formatEndState(last.endState);
  }

  const axis = inferDramaAxisStatus(prev?.cast, shot.cast, `${shot.action} ${beats.map((b) => b.action).join(' ')}`);
  const notes: string[] = [];
  if (prev && prev.scene_asset_id && shot.scene_asset_id && prev.scene_asset_id !== shot.scene_asset_id) {
    notes.push('场景切换，需转场或明确新空间');
  }
  if (axis.status === 'cross' && !/故意/.test(axis.note)) notes.push(axis.note);

  let continuityStatus: DramaContinuityStatus = 'ok';
  if (notes.some((n) => /越轴|跳变/.test(n))) continuityStatus = 'warn';
  if (notes.some((n) => /场景切换/.test(n)) && !shot.continuity_notes) continuityStatus = 'warn';

  return {
    schema: 'drama-directing-breakdown.v1',
    shot_id: shot.shot_id,
    answers,
    beats,
    axisStatus: axis.status as DramaAxisStatus,
    axisNote: axis.note,
    continuityStatus,
    continuityNotes: notes,
    sourceFingerprint: dramaShotDirectingFingerprint(shot),
    updated_at: Date.now(),
    source: llm?.beats?.length ? 'llm' : 'rules',
  };
}

export function breakdownBeatsToTimelineEvents(
  shot: DramaShot,
  breakdown: DramaShotDirectingBreakdown,
): DramaTimelineEvent[] {
  const events = breakdown.beats.map((b) =>
    createEmptyDramaTimelineEvent({
      start_sec: b.audioStart,
      end_sec: b.audioEnd,
      character_ids: b.characters,
      visual_action: b.visibleAction || b.visiblePerformance || b.action,
      character_state: b.visiblePerformance || b.action,
      expression: '',
      eyeline: '',
      dialogue: b.lipSync ? b.dialogue : '',
      dialogue_character_id: b.lipSync ? b.dialogueCharacterId : '',
      environment_audio: b.environmentSound
        ? b.environmentSound.split(/[、,，]/).map((s) => s.trim()).filter(Boolean)
        : [],
      lip_sync: b.lipSync,
      camera_action: b.camera,
    }),
  );
  return differentiateDuplicateTimelineCuts(
    normalizeDramaTimelineEvents(events, shot.duration_sec || 10),
  );
}

export function applyDramaDirectingBreakdownToShot(
  session: DramaDirectorSession,
  shot: DramaShot,
  prev: DramaShot | null,
  opts?: { llm?: { answers?: Partial<DramaDirectingAnswers>; beats?: Array<Partial<DramaDirectingBeat>> }; force?: boolean },
): DramaShot {
  const fp = dramaShotDirectingFingerprint(shot);
  if (
    !opts?.force &&
    shot.directing_breakdown?.sourceFingerprint === fp &&
    shot.directing_breakdown.beats?.length &&
    shot.directing_breakdown.beats.every((b) => b.lockedCamera && b.visiblePerformance)
  ) {
    return shot;
  }
  const breakdown = buildDramaDirectingBreakdown(session, shot, prev, opts?.llm);
  // force 只刷新 directing_breakdown 展示层。有效 Timeline 禁止被
  // breakdownBeatsToTimelineEvents / cinematic 整表覆盖（P0 / P1-A3）。
  const existing = Array.isArray(shot.timeline_events) ? shot.timeline_events : [];
  const keepTimeline = existing.length > 0 && !isDramaTimelineEventsThin(existing);
  return createEmptyDramaShot({
    ...shot,
    directing_breakdown: breakdown,
    timeline_events: keepTimeline ? existing : shot.timeline_events,
    continuity_notes:
      shot.continuity_notes ||
      [breakdown.axisNote, ...breakdown.continuityNotes, breakdown.answers.nextHandoff]
        .filter(Boolean)
        .join('；'),
  });
}

export function listDirtyDirectingShotIds(session: DramaDirectorSession): string[] {
  const shots = session.shots || [];
  const ids: string[] = [];
  for (let i = 0; i < shots.length; i += 1) {
    const s = shots[i];
    const fp = dramaShotDirectingFingerprint(s);
    const stale =
      !s.directing_breakdown?.beats?.length || s.directing_breakdown.sourceFingerprint !== fp;
    if (!stale) continue;
    ids.push(s.shot_id);
    if (i + 1 < shots.length) ids.push(shots[i + 1].shot_id);
  }
  return [...new Set(ids)];
}

export function applyDramaDirectingBreakdownSession(
  session: DramaDirectorSession,
  opts?: {
    shotIds?: string[];
    force?: boolean;
    llmByShotId?: Record<
      string,
      { answers?: Partial<DramaDirectingAnswers>; beats?: Array<Partial<DramaDirectingBeat>> }
    >;
  },
): DramaDirectorSession {
  const originalLen = (session.shots || []).length;
  const allow = opts?.shotIds ? new Set(opts.shotIds) : null;
  const shots = [...(session.shots || [])];
  for (let i = 0; i < shots.length; i += 1) {
    if (allow && !allow.has(shots[i].shot_id) && !allow.has(shots[i].shot_no)) continue;
    shots[i] = applyDramaDirectingBreakdownToShot(session, shots[i], i > 0 ? shots[i - 1] : null, {
      force: opts?.force,
      llm: opts?.llmByShotId?.[shots[i].shot_id],
    });
  }
  // 锁死：不得因拆戏改变镜头条数
  if (shots.length !== originalLen) return session;
  return { ...session, shots };
}

export function formatDramaDirectingBreakdownDisplay(breakdown: DramaShotDirectingBreakdown): string {
  const a = breakdown.answers;
  const lines = [
    '【导演拆戏】',
    `本镜讲什么：${a.story}`,
    `叙事目的：${a.purpose}`,
    `视觉主体：${a.visualSubject || '—'}`,
    `情绪：${a.emotion}（${a.emotionTrend === 'rise' ? '增强' : a.emotionTrend === 'fall' ? '下降' : '维持'}）`,
    `最重要信息：${a.keyInfo}`,
    `先看到：${a.seeFirst}；后看到：${a.seeNext}`,
    `对白：${a.hasDialogue ? '有' : '无'}　口型：${a.needsLipsync ? '开（仅对白窗）' : '关'}`,
    `下一镜承接：${a.nextHandoff}`,
    `轴线：${breakdown.axisStatus}${breakdown.axisNote ? ` · ${breakdown.axisNote}` : ''}`,
    breakdown.continuityNotes.length ? `连续性：${breakdown.continuityNotes.join('；')}` : '连续性：通过',
    '',
    '【戏剧节拍】',
    ...breakdown.beats.map((b) => {
      const lip = b.lipSync ? '口型开' : '口型关';
      const dlg = b.lipSync && b.dialogue ? `对白：「${b.dialogue}」` : '无对白';
      return `${b.audioStart}–${b.audioEnd}秒 · ${lip}\n目的：${b.purpose}${b.primaryPurpose ? ` (${b.primaryPurpose})` : ''}\n${b.camera || `${b.shotType} · ${b.movement}`}。\n${b.visiblePerformance || b.action}。${dlg}。\n环境音：${b.environmentSound || '—'}。\nEndState：${b.continuityOut}${b.gazeTarget ? `\ngazeTarget：${b.gazeTarget}` : ''}`;
    }),
  ];
  return lines.join('\n');
}

export function parseDramaDirectingBreakdownLlm(
  raw: string,
  shotId: string,
): { answers?: Partial<DramaDirectingAnswers>; beats?: Array<Partial<DramaDirectingBeat>> } | null {
  const text = String(raw || '').trim();
  if (!text) return null;
  const json = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  const start = json.indexOf('{');
  const end = json.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    const obj = JSON.parse(json.slice(start, end + 1)) as Record<string, unknown>;
    if (obj.shot_id && String(obj.shot_id) !== shotId && String(obj.shot_id) !== String(shotId)) {
      /* still accept if beats exist */
    }
    const answers = obj.answers && typeof obj.answers === 'object'
      ? (obj.answers as Partial<DramaDirectingAnswers>)
      : undefined;
    const beats = Array.isArray(obj.beats) ? (obj.beats as Array<Partial<DramaDirectingBeat>>) : undefined;
    if (!answers && !beats?.length) return null;
    return { answers, beats };
  } catch {
    return null;
  }
}
