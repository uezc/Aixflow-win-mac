/**
 * 短剧出片补强（不大改 UI）：
 * - 切段缺动作/运镜时，从镜级 action/move 回填（不发明戏）
 * - camera_action 与镜级 recipe 皆空时，按拍类型填最小导演镜头语言（不覆盖已有）
 * - 抽象表情 → 可见微相
 * - 镜间承接入编译开场
 */

import { isDramaScreenTextVisual } from './extractCastFromScript.js';
import { isBlankDramaCameraMarker } from './dramaVisualToEnglish.js';
import type { DramaShot, DramaTimelineEvent } from './types.js';
import { createEmptyDramaTimelineEvent, isPlaceholderDramaVisualAction } from './timelineEvent.js';
import {
  expandVisiblePerformance,
  stripAbstractEmotionFromPhysicalText,
} from './visiblePerformance.js';
import { splitDramaSfxLayers } from './prompts/h3TimingSoundHandbook.js';

function trimLine(s: unknown): string {
  return String(s || '').trim();
}

const PHYSICAL_MICRO_RE =
  /眉|眼|瞳|唇|嘴|下颌|颌|肩|颈|喉|呼吸|攥|握|拳|指|手|胸|背|站|坐|倾|垂|抖|眨|咬|抿/;

/** Compiler 默认镜头语言拍型（仅填空；禁止默认脸部大特写） */
export type DramaCameraBeatKind =
  | 'establish'
  | 'screen'
  | 'dialogue'
  | 'action_environment'
  | 'action';

/** 景别·角度·运镜；Picture 1 锁空间不锁死机位，故允许景别/运动变化 */
export const DRAMA_DEFAULT_CAMERA_BY_BEAT: Record<DramaCameraBeatKind, string> = {
  establish: '中全景 · 平视 · 缓慢推入',
  screen: '屏幕插入 · 平视 · 推屏',
  dialogue: '中近景 · 平视 · 固定机位',
  action_environment: '中景 · 平视 · 缓移带环境元素',
  action: '中景 · 平视 · 固定机位',
};

const ESTABLISH_PURPOSE_RE = /establish|introduce|environment|建立|交代|开场/i;
const ENV_CUE_RE = /窗|窗外|雷|环境|显示器|屏幕|霓虹|门框|走廊|直播间|房间|桌面|键盘|鼠标|电竞椅/;
const FACE_CU_RE = /大特写|脸部特写|贴脸|面部特写|extreme\s*close-?up|tight\s*on\s*(?:the\s*)?face/i;

/** 按切段内容判定拍型（screen > dialogue > establish > action_environment > action） */
export function classifyDramaCameraBeatKind(
  ev: DramaTimelineEvent,
  shot: DramaShot,
  eventIndex: number,
): DramaCameraBeatKind {
  const visual = trimLine(ev.visual_action);
  const dlg = trimLine(ev.dialogue);
  if (isDramaScreenTextVisual(visual)) return 'screen';
  if (dlg) return 'dialogue';

  const purposeBlob = [shot.dramatic_purpose, shot.purpose, shot.visual_focus]
    .map(trimLine)
    .filter(Boolean)
    .join(' ');
  const establishCue =
    ESTABLISH_PURPOSE_RE.test(purposeBlob) ||
    /RGB|灯条|直播间|靠在电竞椅|坐在电竞椅|昏暗房间/.test(visual);
  if (eventIndex === 0 && establishCue) return 'establish';
  if (eventIndex === 0 && ESTABLISH_PURPOSE_RE.test(purposeBlob)) return 'establish';

  if (ENV_CUE_RE.test(visual) && visual.length >= 6) return 'action_environment';
  return 'action';
}

export function defaultDramaCameraActionForBeat(
  ev: DramaTimelineEvent,
  shot: DramaShot,
  eventIndex: number,
): string {
  const kind = classifyDramaCameraBeatKind(ev, shot, eventIndex);
  return DRAMA_DEFAULT_CAMERA_BY_BEAT[kind];
}

/** 镜级景别·角度·运镜 → 切段 camera_action 配方 */
export function dramaShotCameraRecipeFromFields(shot: DramaShot): string {
  const size = trimLine(shot.size || shot.framing);
  const angle = trimLine(shot.angle || shot.camera);
  const move = trimLine(shot.move);
  const parts = [size, angle, move].filter(Boolean);
  if (!parts.length) return '';
  if (parts.length === 1) return parts[0];
  return parts.join(' · ');
}

/** 是否已是可见微相（非纯抽象情绪词） */
export function looksLikeVisibleMicroExpression(raw: string): boolean {
  const t = trimLine(raw);
  if (!t) return false;
  if (PHYSICAL_MICRO_RE.test(t)) return true;
  const stripped = stripAbstractEmotionFromPhysicalText(t);
  return !!stripped && stripped.length >= 4 && stripped !== t;
}

/**
 * 空/抽象表情 → 可见微相。优先用切段已有具体描写，其次镜级 expression。
 * P0：禁止用「整段镜级 action（多行/含对白）」当展开 hint，否则对白切段会被全文污染。
 */
export function resolveDramaVisibleExpressionZh(
  shot: DramaShot,
  existingExpression?: string,
  visualHint?: string,
): string {
  const existing = trimLine(existingExpression);
  if (existing && looksLikeVisibleMicroExpression(existing)) return existing;

  const shotExpr = trimLine(shot.expression);
  if (shotExpr && looksLikeVisibleMicroExpression(shotExpr)) return shotExpr;

  const emotionBlob = [existing, shotExpr].filter(Boolean).join(' ');
  // 无表情/情绪字段时不硬编微相，避免凭空加戏
  if (!emotionBlob) return '';

  let actionHint = trimLine(visualHint);
  if (!actionHint) {
    const sa = trimLine(shot.action);
    // 短、单行、无对白标记的动作才可作 hint
    if (
      sa &&
      sa.length <= 48 &&
      !/\n/.test(sa) &&
      !/[「」]/.test(sa) &&
      !/(?:^|\n)\s*\S{1,12}\s*[：:]\s*/.test(sa)
    ) {
      actionHint = sa;
    }
  }
  const expanded = expandVisiblePerformance(emotionBlob, actionHint);
  return trimLine(expanded);
}

/** 镜间承接：只读已有字段，不新算戏 */
export function dramaShotHandoffLineZh(shot: DramaShot): string {
  const breakdown = shot.directing_breakdown;
  const beatIn = trimLine(breakdown?.beats?.[0]?.continuityIn);
  if (beatIn && beatIn.length >= 4 && !/^承接[:：]?$/.test(beatIn)) {
    return beatIn.replace(/^承接[:：]\s*/, '');
  }
  const answers = breakdown?.answers as { continuityIn?: string; nextHandoff?: string } | undefined;
  const fromAnswers = trimLine(answers?.continuityIn);
  if (fromAnswers && fromAnswers.length >= 4) {
    return fromAnswers.replace(/^承接[:：]\s*/, '');
  }
  const tin = trimLine(shot.transition_in);
  if (tin && tin.length >= 2 && !/^(?:无|—|－|-)$/.test(tin)) return tin;
  const notes = trimLine(shot.continuity_notes);
  if (notes) {
    const first = notes.split(/[→;\n]/)[0]?.trim() || '';
    if (first.length >= 4 && first.length <= 80) return first;
  }
  return '';
}

function needsVisualBackfill(visual: string): boolean {
  const t = trimLine(visual);
  return !t || isPlaceholderDramaVisualAction(t);
}

function needsCameraBackfill(cam: string): boolean {
  return isBlankDramaCameraMarker(cam);
}

/** 表情字段是否被整段剧本/对白污染 */
function isDialogueBeatActionDumpLike(expression: string, dialogue: string): boolean {
  const v = trimLine(expression);
  if (!v) return false;
  const dlg = trimLine(dialogue);
  if (dlg && v.includes(dlg.slice(0, Math.min(12, dlg.length)))) return true;
  if (/\n/.test(v)) return true;
  if (v.length > 60) return true;
  if (/[「」]/.test(v)) return true;
  return false;
}

function shotExprLooksLikeMicroOnly(raw: unknown): boolean {
  const t = trimLine(raw);
  if (!t || t.length > 24 || /\n/.test(t)) return false;
  // 「慵懒；打个汽水嗝」取首段情绪词即可
  const first = t.split(/[；;、,，]/)[0]?.trim() || '';
  return !!first && first.length <= 8;
}

/** 镜级 sfx → 切段 environment_audio 列表（保留｜分层，再拆顿号） */
export function splitDramaShotSfxParts(sfx: unknown): string[] {
  const { ambient, foley } = splitDramaSfxLayers(sfx);
  const out: string[] = [];
  for (const x of [...ambient, ...foley]) {
    if (x && !out.includes(x)) out.push(x);
  }
  if (out.length) return out;
  return String(sfx || '')
    .split(/[、,，;/|｜]+/)
    .map((x) => x.replace(/^环境音效\s*[：:]\s*/, '').trim())
    .filter(Boolean);
}

/**
 * 只填空：把镜级动作/运镜/微相/视线/音效写入切段空字段。
 * 不覆盖已有有效 visual_action / camera_action / environment_audio。
 */
export function backfillDramaTimelineEventsFromShot(shot: DramaShot): DramaTimelineEvent[] {
  const list = Array.isArray(shot.timeline_events) ? shot.timeline_events : [];
  if (!list.length) return list;

  const camRecipe = dramaShotCameraRecipeFromFields(shot);
  const shotAction = trimLine(shot.action);
  const shotEye = trimLine(shot.eyeline);
  const { ambient, foley } = splitDramaSfxLayers(shot.sfx);
  const sfxParts = splitDramaShotSfxParts(shot.sfx);
  let actionPlaced = false;
  let sfxPlaced = false;

  return list.map((raw, idx) => {
    const ev = createEmptyDramaTimelineEvent(raw);
    let visual_action = ev.visual_action;
    let camera_action = ev.camera_action;
    let expression = ev.expression;
    let eyeline = ev.eyeline;
    let environment_audio = [...(ev.environment_audio || [])].map(trimLine).filter(Boolean);

    // 优先保留已有 camera_action；其次镜级 recipe；皆空才按拍型默认（禁止默认看脸大特写）
    if (needsCameraBackfill(camera_action)) {
      if (camRecipe) {
        camera_action = camRecipe;
      } else {
        const fallback = defaultDramaCameraActionForBeat(ev, shot, idx);
        if (fallback && !FACE_CU_RE.test(fallback)) {
          camera_action = fallback;
        }
      }
    }

    // 对白切段禁止回填整段镜级 action（会把全场原文/说话人标签糊进台词 Shot）
    const hasDialogue = !!trimLine(ev.dialogue);
    if (needsVisualBackfill(visual_action) && shotAction && !actionPlaced && !hasDialogue) {
      visual_action = shotAction;
      actionPlaced = true;
    }

    // 对白切段：不用整段 action 展开表情；非对白才允许 micro 回填
    if (!hasDialogue) {
      const micro = resolveDramaVisibleExpressionZh(shot, expression, visual_action);
      if (micro && (!trimLine(expression) || !looksLikeVisibleMicroExpression(expression))) {
        expression = micro;
      }
    } else if (trimLine(expression) && isDialogueBeatActionDumpLike(expression, trimLine(ev.dialogue))) {
      expression = '';
    } else if (
      !trimLine(expression) &&
      shotExprLooksLikeMicroOnly(shot.expression)
    ) {
      expression = trimLine(shot.expression).split(/[；;]/)[0] || '';
    }

    if (!trimLine(eyeline) && shotEye) {
      eyeline = shotEye;
    }

    // 切段无环境音：首段偏底噪+Foley；后续段优先同步 Foley，保留一条底噪
    if (!environment_audio.length && sfxParts.length) {
      if (!sfxPlaced) {
        environment_audio = [...ambient.slice(0, 1), ...foley.slice(0, 2)].filter(Boolean);
        if (!environment_audio.length) environment_audio = sfxParts.slice(0, 3);
        sfxPlaced = true;
      } else if (foley.length) {
        environment_audio = [foley[Math.min(idx - 1, foley.length - 1)]];
        if (ambient[0]) environment_audio = [ambient[0], ...environment_audio];
      } else {
        environment_audio = [sfxParts[0]];
      }
    }

    return createEmptyDramaTimelineEvent({
      ...ev,
      visual_action,
      camera_action,
      expression,
      eyeline,
      environment_audio,
    });
  });
}

/** ensure / enrich 出口：回填后写回 shot */
export function applyDramaShotPromptBackfill(shot: DramaShot): DramaShot {
  const timeline_events = backfillDramaTimelineEventsFromShot(shot);
  if (timeline_events === shot.timeline_events) return shot;
  return { ...shot, timeline_events };
}
