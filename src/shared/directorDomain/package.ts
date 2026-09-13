/**
 * Generation Package：AssetResolver + PromptBuilder（Phase 1 骨架）
 *
 * 业务 Source of Truth = 结构化引用 + locks + shot direction。
 * prompt_* / adapter_prompt_cache 仅为兼容缓存；Phase 2 将完善锁组装与 Adapter 桥。
 *
 * prompt_* / adapter_prompt_cache / last_compiled_prompt 仅为历史与调试；
 * 出片正文一律由 H3 Compiler 现场生成。
 */

import {
  resolveCharacterMasterReferenceUrl,
  resolvePropMasterReferenceUrl,
  resolveSceneMasterReferenceUrl,
} from './constraints.js';
import { dramaShotSummaryForPackage } from './continuity.js';
import { createEmptyDramaGenerationPackage } from './factories.js';
import { listDramaShotRefAudioSlots, resolveDramaShotPackageRefImages } from './shotRefs.js';
import { resolveDramaH3DialoguePlan, shouldSendDramaH3AudioReference } from './h3DialogueMode.js';
import { dramaShotHasSpokenDialogue, resolveDramaShotAudioTimeline } from './migrateH3Compiler.js';
import { collectDramaShotSpokenLinesForH3, finalizeMinimaxH3SkillPrompt } from '../minimaxH3OptimizePrompt.js';
import type {
  DramaDirectorSession,
  DramaGenerationPackage,
  DramaPackageCharacterLock,
  DramaPackagePropRef,
  DramaPackageRefImage,
  DramaPackageSceneLock,
  DramaPackageVoiceRef,
  DramaShot,
} from './types.js';

function resolveRefImages(
  session: DramaDirectorSession,
  shot: DramaShot,
): DramaPackageRefImage[] {
  return resolveDramaShotPackageRefImages(session, shot);
}

function buildPromptText(session: DramaDirectorSession, shot: DramaShot): string {
  // 打包刷新只写缓存/摘要，禁止对全部分镜跑 H3 全量编译（进导演台会卡死）
  const cached = String(
    shot.h3_skill_prompt || shot.last_compiled_prompt || shot.final_prompt || '',
  ).trim();
  if (cached) {
    return finalizeMinimaxH3SkillPrompt(cached, collectDramaShotSpokenLinesForH3(shot));
  }
  const bits = [shot.size, shot.move, shot.action, shot.expression]
    .map((x) => String(x || '').trim())
    .filter(Boolean);
  return bits.join(' · ') || `Shot ${shot.shot_no || shot.shot_id}`;
}

function buildSceneLock(
  session: DramaDirectorSession,
  shot: DramaShot,
): DramaPackageSceneLock | null {
  const sc = (session.bible?.scenes || []).find((s) => s.scene_id === shot.scene_asset_id);
  if (!sc) return null;
  return {
    scene_id: sc.scene_id,
    name: sc.name,
    asset_version: sc.asset_version || 1,
    reference_url: resolveSceneMasterReferenceUrl(sc),
    spatial_structure: sc.spatial_structure || '',
    architecture: sc.architecture || '',
    materials: sc.materials || '',
    fixed_elements: [...(sc.fixed_elements || [])],
    lighting: sc.lighting || '',
    light_sources: sc.light_sources || '',
    time_of_day: sc.time_default || '',
    weather: sc.weather || sc.weather_default || '',
    color_palette: sc.color_palette || '',
    camera_visible_area: sc.camera_visible_area || '',
    forbidden_elements: [...(sc.forbidden_elements || [])],
  };
}

function buildCharacterLocks(
  session: DramaDirectorSession,
  shot: DramaShot,
): DramaPackageCharacterLock[] {
  return (shot.character_ids || [])
    .map((id) => (session.bible?.characters || []).find((c) => c.character_id === id))
    .filter(Boolean)
    .map((c) => ({
      character_id: c!.character_id,
      name: c!.name,
      asset_version: c!.asset_version || 1,
      reference_url: resolveCharacterMasterReferenceUrl(c!),
      visual_anchors: [...(c!.visual_anchors || [])],
      forbidden_changes: [...(c!.forbidden_changes || [])],
      identity: c!.identity || c!.role || '',
      gender: c!.gender || '',
      clothing: c!.visual?.clothing || '',
    }));
}

function buildPropRefs(session: DramaDirectorSession, shot: DramaShot): DramaPackagePropRef[] {
  const ids = [...new Set([...(shot.prop_ids || []), ...(shot.required_prop_ids || [])])];
  return ids
    .map((id) => session.bible.props.find((p) => p.prop_id === id))
    .filter(Boolean)
    .map((p) => ({
      prop_id: p!.prop_id,
      name: p!.name,
      asset_version: p!.asset_version || 1,
      reference_url: resolvePropMasterReferenceUrl(p!),
      material: p!.material || '',
      appearance: p!.appearance || p!.description || '',
    }));
}

function buildVoiceRefs(session: DramaDirectorSession, shot: DramaShot): DramaPackageVoiceRef[] {
  return (shot.voice_ids || [])
    .map((id) => session.bible.voices.find((v) => v.voice_id === id))
    .filter(Boolean)
    .map((v) => ({
      voice_id: v!.voice_id,
      character_id: v!.character_id,
      asset_version: v!.asset_version || 1,
      identity: v!.identity,
      reference_audio: v!.identity?.reference_audio || v!.sample_url || '',
    }));
}

export function buildDramaGenerationPackage(
  session: DramaDirectorSession,
  shotId: string,
  opts?: { adapter_id?: string; prev?: DramaShot | null },
): DramaGenerationPackage {
  const shot = session.shots.find((s) => s.shot_id === shotId);
  if (!shot) {
    throw new Error(`镜头不存在: ${shotId}`);
  }
  const audio_refs: string[] = [];
  const shotAudio = String(shot.audio_url || '').trim();
  const hasDialogue = dramaShotHasSpokenDialogue(shot);
  const dialoguePlan = resolveDramaH3DialoguePlan(resolveDramaShotAudioTimeline(session, shot));
  const adapter_id = String(
    opts?.adapter_id ||
      (hasDialogue && shotAudio
        ? session.meta.videoBatchLipsyncModel || 'minimax-h3-audio'
        : session.meta.videoBatchModel || 'minimax-h3-multi'),
  ).trim();
  const h3Mode = adapter_id === 'minimax-h3-audio' ? 'h3-audio' : 'h3-multi';
  const sendAudioRef = shouldSendDramaH3AudioReference({
    mode: h3Mode,
    hasDialogue: dialoguePlan.dialogue,
  });
  if (adapter_id === 'minimax-h3-audio') {
    if (sendAudioRef && shotAudio) audio_refs.push(shotAudio);
  } else if (sendAudioRef) {
    for (const a of listDramaShotRefAudioSlots(session, shot, 3)) {
      const url = String(a.sample_url || '').trim();
      if (url && !audio_refs.includes(url)) audio_refs.push(url);
    }
  }
  const ref_images = resolveRefImages(session, shot);
  const prompt_structured = buildPromptText(session, shot);
  const prev = opts?.prev;

  const existing = session.packages[shotId];
  const version = existing ? existing.version + 1 : 1;
  const scene_reference = buildSceneLock(session, shot);
  const character_locks = buildCharacterLocks(session, shot);
  const prop_references = buildPropRefs(session, shot);
  const voice_assets = buildVoiceRefs(session, shot);
  const stylePrompt =
    session.bible.projectVisualBible?.stylePrompt ||
    session.bible.visualDNA?.generatedPrompt ||
    session.meta.globalStyle ||
    session.bible.project.visual_style ||
    '';

  const forbidden = [
    ...(session.bible.story?.forbidden_elements || []),
    ...(scene_reference?.forbidden_elements || []),
    '不得新增未绑定人物',
    '不得改变 LOCK 人物外观与服装',
    '不得改变已锁定场景结构',
    '不得新增未绑定关键道具',
  ];

  return createEmptyDramaGenerationPackage({
    package_id: existing?.package_id,
    shot_id: shot.shot_id,
    adapter_id,
    adapter_version: 'phase1-scaffold',
    scene_reference,
    character_references: character_locks,
    prop_references,
    voice_assets,
    project_constraints: {
      visual_style: session.bible.project.visual_style || '',
      style_prompt: stylePrompt,
      era: session.bible.project.era || session.bible.story?.era || '',
      worldview: session.bible.project.worldview || session.bible.story?.worldview || '',
      forbidden_elements: [...(session.bible.story?.forbidden_elements || [])],
      aspect_ratio: session.meta.aspect_ratio || '9:16',
    },
    character_locks,
    scene_locks: scene_reference ? [scene_reference] : [],
    visual_style: stylePrompt,
    shot_direction: {
      purpose: shot.purpose || '',
      action: shot.action || '',
      blocking: shot.blocking || '',
      composition: shot.composition || '',
      environment: shot.environment || shot.atmosphere || '',
      duration_sec: shot.duration_sec,
      cast: [...(shot.cast || [])],
    },
    performance_direction: (shot.cast || [])
      .map((c) => {
        const name =
          (session.bible?.characters || []).find((x) => x.character_id === c.character_id)?.name ||
          c.character_id;
        return [name, c.emotion, c.performance, c.action].filter(Boolean).join(' · ');
      })
      .filter(Boolean)
      .join('\n'),
    camera_direction: {
      size: shot.size || '',
      framing: shot.framing || '',
      camera: shot.camera || '',
      angle: shot.angle || '',
      focal: shot.focal || '',
      move: shot.move || '',
      lighting_override: shot.lighting_override || '',
    },
    dialogue: [...(shot.dialogue || [])],
    sound_direction: shot.sfx || '',
    forbidden_elements: forbidden,
    ref_images,
    prompt_text: prompt_structured,
    prompt_structured,
    adapter_prompt_cache: prompt_structured,
    audio_refs,
    prev_shot_summary: prev ? dramaShotSummaryForPackage(prev) : '',
    created_at: Date.now(),
    version,
  });
}

export function buildAllDramaGenerationPackages(
  session: DramaDirectorSession,
  adapter_id?: string,
): Record<string, DramaGenerationPackage> {
  const out: Record<string, DramaGenerationPackage> = { ...session.packages };
  for (let i = 0; i < session.shots.length; i++) {
    const shot = session.shots[i];
    const prev = i > 0 ? session.shots[i - 1] : null;
    out[shot.shot_id] = buildDramaGenerationPackage(session, shot.shot_id, { adapter_id, prev });
  }
  return out;
}
