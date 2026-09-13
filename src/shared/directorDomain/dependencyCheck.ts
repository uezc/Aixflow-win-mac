/**
 * Dependency Checker + Shot Generation Contract（纯函数，Phase 1）
 *
 * 原则：模型未被明确提供的信息，不允许自行创造。
 * 缺关键资产 → BLOCKED，禁止调用 H3。
 */

import {
  characterHasUsableReference,
  propHasUsableReference,
  resolveCharacterMasterReferenceUrl,
  resolvePropMasterReferenceUrl,
  resolveSceneMasterReferenceUrl,
  sceneHasUsableReference,
} from './constraints.js';
import { DIRECTOR_DOMAIN_CONTRACT_VERSION } from './principles.js';
import { dramaShotRequiresCast } from './shotCastGate.js';
import type {
  DramaDependencyStatus,
  DramaDirectorSession,
  DramaShot,
  DramaVoiceDependencyMode,
} from './types.js';

export interface DramaDependencyItem {
  key: string;
  kind: 'scene' | 'character' | 'prop' | 'voice' | 'direction' | 'dialogue' | 'reference';
  label: string;
  asset_id?: string;
  status: DramaDependencyStatus;
  message?: string;
}

export interface DramaDependencyReport {
  shot_id: string;
  shot_no: string;
  overall: DramaDependencyStatus;
  items: DramaDependencyItem[];
  missing: string[];
  warnings: string[];
  resolved_assets: Array<{
    kind: string;
    asset_id: string;
    name: string;
    reference_url?: string;
  }>;
  voice_mode: DramaVoiceDependencyMode;
  generation_status: 'READY_TO_GENERATE' | 'BLOCKED' | 'WARNING';
  contract_version: typeof DIRECTOR_DOMAIN_CONTRACT_VERSION;
}

export interface DramaShotGenerationContract {
  shot_id: string;
  ready: boolean;
  status: 'READY_TO_GENERATE' | 'BLOCKED' | 'WARNING';
  dependency: DramaDependencyReport;
  /** 可进入 Package 组装的前提说明 */
  blockers: string[];
}

function resolveVoiceMode(
  session: DramaDirectorSession,
  shot: DramaShot,
): DramaVoiceDependencyMode {
  const shotMode = shot.voice_dependency_mode;
  if (shotMode) return shotMode;
  const metaMode = session.meta.default_voice_dependency_mode;
  if (metaMode) return metaMode;
  const model = String(session.meta.videoBatchModel || '').toLowerCase();
  if (model.includes('audio') || model.includes('lipsync') || model.includes('口型')) {
    return 'REQUIRED';
  }
  // 默认：纯画面生成不把 Voice 当硬依赖
  return 'POST_PRODUCTION';
}

function hasDirection(shot: DramaShot): boolean {
  return !!(
    String(shot.action || '').trim() ||
    String(shot.purpose || '').trim() ||
    (shot.cast || []).some((c) => String(c.action || '').trim())
  );
}

/**
 * 对本镜做依赖检查。
 * Scene 参考图、每位出场人物参考图、required props 参考图为硬门禁。
 * Voice 按 voice_mode 决定 REQUIRED / OPTIONAL / POST / N/A。
 */
export function checkDramaShotDependencies(
  session: DramaDirectorSession,
  shotId: string,
): DramaDependencyReport {
  const shot =
    session.shots.find((s) => s.shot_id === shotId) ||
    session.shots.find((s) => s.shot_no === shotId);
  const empty: DramaDependencyReport = {
    shot_id: shotId,
    shot_no: '',
    overall: 'BLOCKED',
    items: [
      {
        key: 'shot',
        kind: 'direction',
        label: '镜头',
        status: 'BLOCKED',
        message: '镜头不存在',
      },
    ],
    missing: ['镜头不存在'],
    warnings: [],
    resolved_assets: [],
    voice_mode: 'NOT_APPLICABLE',
    generation_status: 'BLOCKED',
    contract_version: DIRECTOR_DOMAIN_CONTRACT_VERSION,
  };
  if (!shot) return empty;

  const voiceMode = resolveVoiceMode(session, shot);
  const items: DramaDependencyItem[] = [];
  const missing: string[] = [];
  const warnings: string[] = [];
  const resolved: DramaDependencyReport['resolved_assets'] = [];

  // —— Scene ——
  const sceneId = String(shot.scene_asset_id || '').trim();
  const scene = sceneId
    ? (session.bible?.scenes || []).find((s) => s.scene_id === sceneId)
    : null;
  if (!sceneId) {
    items.push({
      key: 'scene',
      kind: 'scene',
      label: '场景',
      status: 'BLOCKED',
      message: '缺少 scene_asset_id',
    });
    missing.push('缺少场景绑定（scene_asset_id）');
  } else if (!scene) {
    items.push({
      key: 'scene',
      kind: 'scene',
      label: '场景',
      asset_id: sceneId,
      status: 'BLOCKED',
      message: '场景资产不存在',
    });
    missing.push(`场景资产不存在：${sceneId}`);
  } else if (!sceneHasUsableReference(scene)) {
    items.push({
      key: 'scene',
      kind: 'scene',
      label: scene.name || '场景',
      asset_id: scene.scene_id,
      status: 'BLOCKED',
      message: '缺少场景参考图',
    });
    missing.push(`缺少场景参考图：${scene.name || scene.scene_id}`);
  } else {
    const url = resolveSceneMasterReferenceUrl(scene);
    items.push({
      key: 'scene',
      kind: 'scene',
      label: scene.name || '场景',
      asset_id: scene.scene_id,
      status: 'READY',
    });
    resolved.push({
      kind: 'scene',
      asset_id: scene.scene_id,
      name: scene.name,
      reference_url: url,
    });
    if (scene.needs_reanalyze || scene.needs_review) {
      warnings.push(`场景「${scene.name}」标记为需复查/重分析`);
      items[items.length - 1].status = 'WARNING';
    }
  }

  // —— Characters ——
  const charIds = [...new Set((shot.character_ids || []).filter(Boolean))];
  if (dramaShotRequiresCast(shot) && !charIds.length) {
    items.push({
      key: 'cast',
      kind: 'character',
      label: '出场人物',
      status: 'BLOCKED',
      message: '非空镜须绑定出场人物并配人物素材',
    });
    missing.push('本镜未标明空镜，须绑定出场人物并配人物素材，提示词须写清谁出演');
  }
  if (!charIds.length && (shot.dialogue || []).some((d) => d.character_name || d.character_id)) {
    warnings.push('有对白但未绑定 character_ids');
  }
  for (const id of charIds) {
    const ch = (session.bible?.characters || []).find((c) => c.character_id === id);
    if (!ch) {
      items.push({
        key: `character:${id}`,
        kind: 'character',
        label: id,
        asset_id: id,
        status: 'BLOCKED',
        message: '人物资产不存在',
      });
      missing.push(`缺少人物资产：${id}`);
      continue;
    }
    if (!characterHasUsableReference(ch)) {
      items.push({
        key: `character:${id}`,
        kind: 'character',
        label: ch.name || id,
        asset_id: id,
        status: 'BLOCKED',
        message: '缺少人物参考图',
      });
      missing.push(`缺少人物参考图：${ch.name || id}`);
      continue;
    }
    const url = resolveCharacterMasterReferenceUrl(ch);
    let st: DramaDependencyStatus = 'READY';
    if (ch.needs_reanalyze || ch.needs_review || !(ch.visual_anchors || []).length) {
      st = 'WARNING';
      if (!(ch.visual_anchors || []).length) {
        warnings.push(`人物「${ch.name}」缺少 visual_anchors（建议重分析，勿伪造）`);
      } else {
        warnings.push(`人物「${ch.name}」标记为需复查/重分析`);
      }
    }
    items.push({
      key: `character:${id}`,
      kind: 'character',
      label: ch.name || id,
      asset_id: id,
      status: st,
    });
    resolved.push({
      kind: 'character',
      asset_id: id,
      name: ch.name,
      reference_url: url,
    });
  }

  // —— Required Props ——
  const requiredProps = [
    ...new Set([...(shot.required_prop_ids || []), ...(shot.prop_ids || [])].filter(Boolean)),
  ];
  // prop_ids 默认也要求参考图（导演已绑定的道具）；若只要「关键道具」可只用 required_prop_ids
  // 产品原则：明确使用的道具必须有参考。绑定到 shot.prop_ids 即视为明确使用。
  for (const id of requiredProps) {
    const prop = session.bible.props.find((p) => p.prop_id === id);
    if (!prop) {
      items.push({
        key: `prop:${id}`,
        kind: 'prop',
        label: id,
        asset_id: id,
        status: 'BLOCKED',
        message: '道具资产不存在',
      });
      missing.push(`缺少道具资产：${id}`);
      continue;
    }
    if (!propHasUsableReference(prop)) {
      items.push({
        key: `prop:${id}`,
        kind: 'prop',
        label: prop.name || id,
        asset_id: id,
        status: 'BLOCKED',
        message: '缺少道具参考图',
      });
      missing.push(`缺少道具参考图：${prop.name || id}`);
      continue;
    }
    items.push({
      key: `prop:${id}`,
      kind: 'prop',
      label: prop.name || id,
      asset_id: id,
      status: 'READY',
    });
    resolved.push({
      kind: 'prop',
      asset_id: id,
      name: prop.name,
      reference_url: resolvePropMasterReferenceUrl(prop),
    });
  }

  // —— Voice ——
  const voiceIds = [...new Set((shot.voice_ids || []).filter(Boolean))];
  const dialogueNeedsSpeaker = (shot.dialogue || []).some((d) => String(d.text || '').trim());
  if (voiceMode === 'NOT_APPLICABLE') {
    items.push({
      key: 'voice',
      kind: 'voice',
      label: '声音',
      status: 'NOT_APPLICABLE',
      message: '当前生成链不涉及 Voice',
    });
  } else if (voiceMode === 'POST_PRODUCTION') {
    items.push({
      key: 'voice',
      kind: 'voice',
      label: '声音',
      status: 'NOT_APPLICABLE',
      message: '声音走后期 / 口型流程，不阻断画面生成',
    });
    if (dialogueNeedsSpeaker && !voiceIds.length) {
      warnings.push('有对白但未绑定 Voice（后期流程需补齐）');
    }
  } else if (voiceMode === 'OPTIONAL') {
    if (!voiceIds.length) {
      items.push({
        key: 'voice',
        kind: 'voice',
        label: '声音',
        status: 'WARNING',
        message: '未绑定 Voice（可选）',
      });
      warnings.push('未绑定 Voice（可选）');
    } else {
      for (const vid of voiceIds) {
        const v = session.bible.voices.find((x) => x.voice_id === vid);
        if (!v) {
          items.push({
            key: `voice:${vid}`,
            kind: 'voice',
            label: vid,
            asset_id: vid,
            status: 'WARNING',
            message: 'Voice 不存在',
          });
          warnings.push(`Voice 不存在：${vid}`);
        } else {
          items.push({
            key: `voice:${vid}`,
            kind: 'voice',
            label: v.timbre || vid,
            asset_id: vid,
            status: 'READY',
          });
          resolved.push({ kind: 'voice', asset_id: vid, name: v.timbre || vid });
        }
      }
    }
  } else {
    // REQUIRED
    if (!voiceIds.length && dialogueNeedsSpeaker) {
      items.push({
        key: 'voice',
        kind: 'voice',
        label: '声音',
        status: 'BLOCKED',
        message: '当前流程要求 Voice，但未绑定',
      });
      missing.push('缺少 Voice（口型/音频驱动流程）');
    } else if (!voiceIds.length) {
      items.push({
        key: 'voice',
        kind: 'voice',
        label: '声音',
        status: 'WARNING',
        message: 'REQUIRED 模式但无对白且未绑 Voice',
      });
      warnings.push('REQUIRED 声音模式但未绑定 Voice');
    }
    for (const vid of voiceIds) {
      const v = session.bible.voices.find((x) => x.voice_id === vid);
      if (!v) {
        items.push({
          key: `voice:${vid}`,
          kind: 'voice',
          label: vid,
          asset_id: vid,
          status: 'BLOCKED',
          message: 'Voice 不存在',
        });
        missing.push(`缺少 Voice：${vid}`);
        continue;
      }
      const hasSample = String(v.sample_url || v.identity?.reference_audio || '').trim();
      if (!hasSample) {
        items.push({
          key: `voice:${vid}`,
          kind: 'voice',
          label: v.timbre || vid,
          asset_id: vid,
          status: 'BLOCKED',
          message: '缺少参考音频',
        });
        missing.push(`缺少声音参考音频：${v.timbre || vid}`);
      } else {
        items.push({
          key: `voice:${vid}`,
          kind: 'voice',
          label: v.timbre || vid,
          asset_id: vid,
          status: 'READY',
        });
        resolved.push({ kind: 'voice', asset_id: vid, name: v.timbre || vid });
      }
    }
  }

  // —— Direction ——
  if (!hasDirection(shot)) {
    items.push({
      key: 'direction',
      kind: 'direction',
      label: '导演指令',
      status: 'BLOCKED',
      message: '缺少本镜动作/目的',
    });
    missing.push('缺少导演指令（action / purpose / cast.action）');
  } else {
    items.push({
      key: 'direction',
      kind: 'direction',
      label: '导演指令',
      status: 'READY',
    });
  }

  const hasBlocked = items.some((i) => i.status === 'BLOCKED');
  const hasWarn = items.some((i) => i.status === 'WARNING') || warnings.length > 0;
  let overall: DramaDependencyStatus = 'READY';
  if (hasBlocked) overall = 'BLOCKED';
  else if (hasWarn) overall = 'WARNING';

  const generation_status: DramaDependencyReport['generation_status'] =
    overall === 'BLOCKED' ? 'BLOCKED' : overall === 'WARNING' ? 'WARNING' : 'READY_TO_GENERATE';

  return {
    shot_id: shot.shot_id,
    shot_no: shot.shot_no,
    overall,
    items,
    missing,
    warnings,
    resolved_assets: resolved,
    voice_mode: voiceMode,
    generation_status,
    contract_version: DIRECTOR_DOMAIN_CONTRACT_VERSION,
  };
}

export function buildDramaShotGenerationContract(
  session: DramaDirectorSession,
  shotId: string,
): DramaShotGenerationContract {
  const dependency = checkDramaShotDependencies(session, shotId);
  return {
    shot_id: dependency.shot_id,
    ready: dependency.generation_status === 'READY_TO_GENERATE',
    status: dependency.generation_status,
    dependency,
    blockers: dependency.missing,
  };
}

export function checkAllDramaShotDependencies(
  session: DramaDirectorSession,
): Record<string, DramaDependencyReport> {
  const out: Record<string, DramaDependencyReport> = {};
  for (const s of session.shots || []) {
    out[s.shot_id] = checkDramaShotDependencies(session, s.shot_id);
  }
  return out;
}
