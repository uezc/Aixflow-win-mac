/**
 * 整镜编译稿：短中文时间轴生产稿（台词进 <d>）。英文由提示词优化生成。
 */

import { getActiveEpisodeBible } from './episodeBible.js';
import { isDramaSystemVoiceId } from './voiceEntity.js';
import { resolveDramaH3DialoguePlan } from './h3DialogueMode.js';
import {
  clipDramaAudioEventsToRange,
  defaultDramaReferenceLockIntent,
  dramaShotHasSpokenDialogue,
  resolveDramaShotAudioTimeline,
  speakerIdForCharacter,
} from './migrateH3Compiler.js';
import { listDramaShotRefAudioSlots, listDramaShotRefImageSlots } from './shotRefs.js';
import {
  characterRefLook,
  formatDramaAssetMatchEntries,
  sceneRefLook,
  type DramaAssetMatchEntry,
} from './scriptDesign.js';
import { listDramaShotCastDisplayNames } from './shotCastGate.js';
import { resolveCharacterIdsForShot } from './shotTimeline.js';
import {
  dramaVideoModelMaxRefAudios,
  dramaVideoModelMaxRefImages,
  resolveDramaShotVideoModel,
} from './dramaVideoModels.js';
import { getVisualStylePreset } from './visualStylePresets.js';
import { scrubVisualStyleToLookAndColor } from './visualStyleLookColor.js';
import type { DramaH3CompileDebug } from './h3PromptCompiler.js';
import type { DramaH3CompileMode } from './compilers/h3CompileMode.js';
import type {
  DramaCharacterBinding,
  DramaDirectorSession,
  DramaOriginalSegment,
  DramaSceneAssetBinding,
  DramaShot,
} from './types.js';
import { composeDramaShotLensTaggedPrompt } from './composeDramaShotLensPrompt.js';

export const DRAMA_LITERAL_PROMPT_VERSION = 'lens-prod.v1';

function trimLine(s: unknown): string {
  return String(s || '').trim();
}

function originalNameForCharacter(
  bindings: DramaCharacterBinding[] | undefined,
  characterId: string,
  fallback: string,
): string {
  const hit = (bindings || []).find(
    (b) => b.status === 'MATCHED' && b.character_id === characterId && trimLine(b.original_name),
  );
  return trimLine(hit?.original_name) || fallback;
}

function originalLocationForScene(
  bindings: DramaSceneAssetBinding[] | undefined,
  sceneId: string,
  fallback: string,
): string {
  const hit = (bindings || []).find(
    (b) => b.status === 'MATCHED' && b.scene_id === sceneId && trimLine(b.original_location),
  );
  return trimLine(hit?.original_location) || fallback;
}

/** 本镜关联的原文：visual_event_ids → OriginalSegment.original_text */
export function collectDramaShotOriginalScript(
  session: DramaDirectorSession,
  shot: DramaShot,
): string {
  const bible = getActiveEpisodeBible(session);
  const eventIds = new Set((shot.visual_event_ids || []).map((id) => trimLine(id)).filter(Boolean));
  const ves = (bible.visual_events || []).filter((e) => eventIds.has(trimLine(e.event_id)));
  const segIds = new Set<string>();
  for (const ve of ves) {
    for (const id of ve.source_segment_ids || []) {
      if (trimLine(id)) segIds.add(trimLine(id));
    }
  }
  const segs = ((bible.original_segments || []) as DramaOriginalSegment[])
    .filter((s) => segIds.has(s.segment_id))
    .sort((a, b) => (a.order || 0) - (b.order || 0));
  if (segs.length) {
    return segs
      .map((s) => s.original_text)
      .filter((t) => trimLine(t))
      .join('\n');
  }

  const fromVe = ves
    .slice()
    .sort((a, b) => (a.index || 0) - (b.index || 0))
    .map((e) => trimLine(e.original_text || e.see))
    .filter(Boolean);
  if (fromVe.length) return fromVe.join('\n');

  const cuts = [...(shot.timeline_events || [])].sort(
    (a, b) => (Number(a.start_sec) || 0) - (Number(b.start_sec) || 0),
  );
  const nameById = new Map(
    (session.bible?.characters || []).map((c) => [c.character_id, c.name] as const),
  );
  const parts: string[] = [];
  for (const ev of cuts) {
    const vis = trimLine(ev.visual_action);
    const dlg = trimLine(ev.dialogue);
    const dlgId = trimLine(ev.dialogue_character_id);
    const who = isDramaSystemVoiceId(dlgId)
      ? '系统'
      : trimLine(nameById.get(dlgId)) || dlgId;
    if (vis) parts.push(vis);
    if (dlg) parts.push(who ? `${who}\n${dlg}` : dlg);
  }
  if (parts.length) return parts.join('\n\n');

  const dlg = (shot.dialogue || [])
    .map((line) => {
      const text = trimLine(line.text);
      if (!text) return '';
      const who = trimLine(line.character_name) || trimLine(line.character_id);
      return who ? `${who}\n${text}` : text;
    })
    .filter(Boolean);
  const action = trimLine(shot.action);
  return [action, ...dlg].filter(Boolean).join('\n\n');
}

function composeAssetMatchBlock(session: DramaDirectorSession, shot: DramaShot): string {
  const bible = getActiveEpisodeBible(session);
  const charBind = bible.character_bindings || [];
  const sceneBind = bible.scene_bindings || [];
  const entries: DramaAssetMatchEntry[] = [];
  const seen = new Set<string>();
  const push = (entry: DramaAssetMatchEntry) => {
    const name = trimLine(entry.name);
    if (!name) return;
    const key = `${entry.kind}:${name}`;
    if (seen.has(key)) return;
    seen.add(key);
    entries.push({ ...entry, name });
  };

  for (const name of listDramaShotCastDisplayNames(session, shot)) {
    const ch = (session.bible?.characters || []).find((c) => trimLine(c.name) === trimLine(name));
    const orig = ch
      ? originalNameForCharacter(charBind, ch.character_id, name)
      : name;
    push({
      kind: 'character',
      name: orig || name,
      look: characterRefLook(ch),
    });
  }

  const scene = (session.bible?.scenes || []).find((s) => s.scene_id === shot.scene_asset_id);
  const veLoc = (shot.visual_event_ids || [])
    .map((id) => (bible.visual_events || []).find((e) => e.event_id === id)?.location)
    .find(Boolean);
  const origScene = (bible.original_scenes || []).find((s) => s.scene_no === veLoc);
  const sceneName =
    originalLocationForScene(
      sceneBind,
      shot.scene_asset_id,
      trimLine(scene?.name || scene?.location),
    ) ||
    trimLine(origScene?.location) ||
    trimLine(scene?.name || scene?.location);
  push({ kind: 'scene', name: sceneName, look: sceneRefLook(scene) });

  const propIds = [...(shot.prop_ids || []), ...(shot.required_prop_ids || [])];
  const seenProp = new Set<string>();
  for (const id of propIds) {
    if (!id || seenProp.has(id)) continue;
    seenProp.add(id);
    const p = (session.bible?.props || []).find((x) => x.prop_id === id);
    if (p?.name) {
      push({
        kind: 'prop',
        name: p.name,
        look: trimLine(p.appearance || p.description).slice(0, 24),
      });
    }
  }
  for (const id of shot.creature_ids || []) {
    const c = (session.bible?.creatures || []).find((x) => x.creature_id === id);
    if (c?.name) push({ kind: 'creature', name: c.name });
  }

  return formatDramaAssetMatchEntries(entries);
}

function composeStyleBlock(session: DramaDirectorSession, shot: DramaShot): string {
  const bible = getActiveEpisodeBible(session);
  const pvb = session.bible?.projectVisualBible;
  const dna = pvb?.visualDNA || session.bible?.visualDNA;
  const preset = getVisualStylePreset(pvb?.presetId || dna?.presetId || '');
  const styleName =
    trimLine(bible.visual_bible_binding?.style_name) ||
    trimLine(pvb?.presetName) ||
    trimLine(preset?.name) ||
    '';
  const styleBody = scrubVisualStyleToLookAndColor(
    trimLine(preset?.visualDNA?.promptTemplateZh) ||
      trimLine(preset?.visualDNA?.promptTemplate) ||
      trimLine(pvb?.stylePrompt || dna?.generatedPrompt || session.bible?.visual?.style),
  );

  const scene = (session.bible?.scenes || []).find((s) => s.scene_id === shot.scene_asset_id);
  const origLoc = originalLocationForScene(
    bible.scene_bindings,
    shot.scene_asset_id,
    trimLine(scene?.name || scene?.location),
  );
  const veLoc = (shot.visual_event_ids || [])
    .map((id) => (bible.visual_events || []).find((e) => e.event_id === id)?.location)
    .find(Boolean);
  const origScene = (bible.original_scenes || []).find((s) => s.scene_no === veLoc);
  const place = [
    trimLine(origScene?.location_type) || trimLine(scene?.kind),
    origLoc || trimLine(origScene?.location),
    trimLine(origScene?.time) || trimLine(scene?.time_default),
  ]
    .filter(Boolean)
    .join(' ');

  const lines = [
    styleName ? `视觉方案：${styleName}` : '',
    styleBody ? `风格：${styleBody}` : '',
    place ? `本场：${place}` : '',
  ].filter(Boolean);
  return lines.join('\n') || '（未绑定 Visual Bible）';
}

export function composeDramaShotLiteralPrompt(
  session: DramaDirectorSession,
  shot: DramaShot,
): string {
  return composeDramaShotLensTaggedPrompt(session, shot);
}

export function buildLiteralDramaH3CompileDebug(
  session: DramaDirectorSession,
  shot: DramaShot,
  mode: DramaH3CompileMode,
  prompt: string,
): DramaH3CompileDebug {
  const lipsync = mode === 'h3-audio';
  const events = Array.isArray(shot.timeline_events) ? shot.timeline_events : [];
  const audioTimeline = resolveDramaShotAudioTimeline(session, {
    ...shot,
    timeline_events: events,
  });
  const nameById = new Map(
    (session.bible?.characters || []).map((c) => [c.character_id, c.name] as const),
  );
  const dialoguePlan = resolveDramaH3DialoguePlan(audioTimeline, nameById);
  const videoModel = resolveDramaShotVideoModel(shot.model_params, session.meta.videoBatchModel, {
    hasDialogue: dialoguePlan.dialogue,
    hasShotAudio: !!trimLine(shot.audio_url),
  });
  const slots = listDramaShotRefImageSlots(session, shot, {
    maxImages: dramaVideoModelMaxRefImages(videoModel),
  });
  const audioSlots = listDramaShotRefAudioSlots(
    session,
    shot,
    dramaVideoModelMaxRefAudios(videoModel),
  );
  const charIds = resolveCharacterIdsForShot(session, shot);
  const pvb = session.bible?.projectVisualBible;
  const stylePrompt = composeStyleBlock(session, shot);
  const sections = [
    { id: 'D' as const, title: '素材匹配', text: prompt, sources: [{ kind: 'literal' }] },
  ];
  return {
    mode,
    dialogue: dialoguePlan.dialogue,
    dialogue_mode: dialoguePlan.dialogue_mode,
    dialogue_events: dialoguePlan.dialogueEvents,
    prompt_version: DRAMA_LITERAL_PROMPT_VERSION,
    audio_reference_intended: !lipsync && dialoguePlan.dialogue && audioSlots.length > 0,
    audio_mode: lipsync ? 'lip_sync' : 'character_reference',
    duration_sec: Math.max(0.5, Number(shot.duration_sec) || 10),
    visual_bible: {
      preset_id: pvb?.presetId,
      style_prompt: stylePrompt,
      used_in_section: 'C',
    },
    references: slots.map((s) => ({
      index: s.index,
      role: s.role,
      lock_intent: s.lock_intent || defaultDramaReferenceLockIntent(s.role),
      name: s.name,
      url: s.url,
      asset_id: s.asset_id,
    })),
    characters: charIds.map((id) => {
      const c = (session.bible?.characters || []).find((x) => x.character_id === id);
      const ai = audioSlots.findIndex((a) => a.character_id === id);
      return {
        character_id: id,
        speaker_id: (c?.speaker_id ||
          speakerIdForCharacter(session, id) ||
          '') as DramaH3CompileDebug['characters'][0]['speaker_id'],
        name: c?.name || '',
        audio_slot_n: lipsync ? undefined : ai >= 0 ? ai + 1 : undefined,
      };
    }),
    shots: events.map((e) => ({
      timeline_event_id: e.event_id,
      start_sec: e.start_sec,
      end_sec: e.end_sec,
      camera: e.camera_action || '',
      character_ids: e.character_ids || [],
      audio_event_ids: clipDramaAudioEventsToRange(audioTimeline, e.start_sec, e.end_sec).map(
        (a) => a.event_id,
      ),
    })),
    audio_timeline: audioTimeline,
    performance_plan: [],
    environment_audio: events
      .filter((e) => (e.environment_audio || []).length)
      .map((e) => ({
        start_sec: e.start_sec,
        end_sec: e.end_sec,
        items: e.environment_audio || [],
      })),
    constraints: {
      no_subtitle: true,
      no_bgm: true,
      lipsync_reuse_shot_audio: lipsync,
      generate_dialogue: dialoguePlan.dialogue && !lipsync,
      generate_environment: true,
    },
    provenance: { sections, final_prompt: prompt },
    qa: { ok: true, issues: [] },
    final_prompt: prompt,
  };
}
