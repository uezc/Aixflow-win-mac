/**
 * 连续性规则引擎（第一版启发式，不依赖视觉模型）。
 */

import { dramaNewId } from './ids.js';
import { formatDramaDialogueLines } from './factories.js';
import { dramaShotLooksOverloaded } from './shotPlanning.js';
import type { ContinuityIssue, DramaDirectorSession, DramaShot } from './types.js';

function handSideHint(text: string): 'left' | 'right' | null {
  const t = String(text || '');
  if (/左手|左侧手/.test(t)) return 'left';
  if (/右手|右侧手/.test(t)) return 'right';
  return null;
}

function activeCostumeId(session: DramaDirectorSession, characterId: string): string {
  const c = session.bible.characters.find((x) => x.character_id === characterId);
  if (!c) return '';
  const active = (c.costumes || []).find((x) => x.active);
  return active?.costume_id || (c.costumes[0]?.costume_id || '') || c.imageUrl || '';
}

/**
 * 扫描相邻镜头，产出 ContinuityIssue 列表。
 */
export function runDramaContinuityCheck(session: DramaDirectorSession): ContinuityIssue[] {
  const shots = session.shots || [];
  const issues: ContinuityIssue[] = [];
  const push = (partial: Omit<ContinuityIssue, 'issue_id'>) => {
    issues.push({ ...partial, issue_id: dramaNewId('cont') });
  };

  for (let i = 1; i < shots.length; i++) {
    const prev = shots[i - 1];
    const cur = shots[i];
    const prevBeat = session.scene_beats.find((b) => b.scene_beat_id === prev.scene_beat_id);
    const curBeat = session.scene_beats.find((b) => b.scene_beat_id === cur.scene_beat_id);

    // 日夜跳变（同场次）
    if (
      prevBeat &&
      curBeat &&
      prevBeat.scene_beat_id === curBeat.scene_beat_id &&
      prevBeat.day_night &&
      curBeat.day_night &&
      prevBeat.day_night !== curBeat.day_night
    ) {
      push({
        shot_id: cur.shot_id,
        prev_shot_id: prev.shot_id,
        type: 'time_of_day',
        severity: 'warn',
        message: `同场次日夜从「${prevBeat.day_night}」变为「${curBeat.day_night}」，请确认是否转场/跳时。`,
      });
    }

    // 出场人物突变（无空镜）
    const prevCast = new Set(prev.character_ids || []);
    const curCast = new Set(cur.character_ids || []);
    const isEmptyPrev = /空镜|无人物/.test(prev.action) || prevCast.size === 0;
    const isEmptyCur = /空镜|无人物/.test(cur.action) || curCast.size === 0;
    if (!isEmptyPrev && !isEmptyCur) {
      const added = [...curCast].filter((id) => !prevCast.has(id));
      const removed = [...prevCast].filter((id) => !curCast.has(id));
      if (added.length || removed.length) {
        const nameOf = (id: string) =>
          session.bible.characters.find((c) => c.character_id === id)?.name || id;
        push({
          shot_id: cur.shot_id,
          prev_shot_id: prev.shot_id,
          type: 'cast_change',
          severity: 'info',
          message: `出场变化：离开 ${removed.map(nameOf).join('、') || '无'}；加入 ${
            added.map(nameOf).join('、') || '无'
          }`,
        });
      }
    }

    // 服装 ID 变化（同角色连续出场）
    for (const id of curCast) {
      if (!prevCast.has(id)) continue;
      const a = activeCostumeId(session, id);
      const b = activeCostumeId(session, id);
      // 同角色若服装数组有多个且 active 不同才会有差异——比较 costume_notes
      if (
        prev.costume_notes &&
        cur.costume_notes &&
        prev.costume_notes !== cur.costume_notes &&
        /换装|服装/.test(`${prev.costume_notes}${cur.costume_notes}`)
      ) {
        const name = session.bible.characters.find((c) => c.character_id === id)?.name || id;
        push({
          shot_id: cur.shot_id,
          prev_shot_id: prev.shot_id,
          type: 'costume',
          severity: 'warn',
          message: `角色「${name}」制作备注服装描述变化，请核对换装场次。`,
        });
      }
      void a;
      void b;
    }

    // 180° 轴线
    const axis = cur.directing_breakdown?.axisStatus || prev.directing_breakdown?.axisStatus;
    const axisNote = cur.directing_breakdown?.axisNote || '';
    if (axis === 'cross' && !/故意|混乱|战斗|失控/.test(axisNote)) {
      push({
        shot_id: cur.shot_id,
        prev_shot_id: prev.shot_id,
        type: 'axis_cross',
        severity: 'warn',
        message: `疑似无理由越轴${axisNote ? `：${axisNote}` : ''}。`,
      });
    }

    // 结束状态未承接
    const prevOut = prev.directing_breakdown?.answers.nextHandoff || prev.directing_breakdown?.beats?.slice(-1)[0]?.continuityOut || '';
    if (prevOut && cur.directing_breakdown?.beats?.[0]?.continuityIn && !cur.directing_breakdown.beats[0].continuityIn.includes(prevOut.slice(0, 6))) {
      push({
        shot_id: cur.shot_id,
        prev_shot_id: prev.shot_id,
        type: 'action_handoff',
        severity: 'info',
        message: `上一镜结束「${prevOut.slice(0, 24)}」，请确认本镜开场承接。`,
      });
    }
    const prevHand = handSideHint(`${prev.action} ${prev.continuity_notes}`);
    const curHand = handSideHint(`${cur.action} ${cur.continuity_notes}`);
    if (prevHand && curHand && prevHand !== curHand) {
      push({
        shot_id: cur.shot_id,
        prev_shot_id: prev.shot_id,
        type: 'prop_hand',
        severity: 'error',
        message: `连续性可疑：上一镜倾向${prevHand === 'left' ? '左' : '右'}手持物，本镜为${
          curHand === 'left' ? '左' : '右'
        }手。`,
      });
    }

    // 地点突变无转场备注
    if (
      prevBeat &&
      curBeat &&
      prevBeat.location_name &&
      curBeat.location_name &&
      prevBeat.location_name !== curBeat.location_name &&
      !/转场|切至|跳至|离开|进入|电梯|走廊/.test(
        `${cur.continuity_notes || ''} ${cur.transition_in || ''} ${cur.dramatic_purpose || ''}`,
      ) &&
      cur.dramatic_purpose !== 'transition' &&
      cur.dramatic_purpose !== 'establish'
    ) {
      push({
        shot_id: cur.shot_id,
        prev_shot_id: prev.shot_id,
        type: 'location_jump',
        severity: 'warn',
        message: `地点从「${prevBeat.location_name}」到「${curBeat.location_name}」，缺少离开→移动→到达的过渡镜。`,
      });
    }

    const prevHandoff = (prev.transition_out || prev.directing_breakdown?.answers.nextHandoff || '').trim();
    const curHandoff = (cur.transition_in || '').trim();
    if (prevHandoff && curHandoff) {
      const prevDir = /左|右|上|下|前|后/.exec(prevHandoff)?.[0];
      const curDir = /左|右|上|下|前|后/.exec(curHandoff)?.[0];
      if (prevDir && curDir && prevDir !== curDir && !/转头|回头|转身/.test(`${prevHandoff}${curHandoff}`)) {
        push({
          shot_id: cur.shot_id,
          prev_shot_id: prev.shot_id,
          type: 'motion_direction',
          severity: 'warn',
          message: `运动/视线方向可能跳变：上一镜「${prevDir}」本镜「${curDir}」。`,
        });
      }
    }

    const prevEmo = String(prev.expression || '').trim();
    const curEmo = String(cur.expression || '').trim();
    if (
      prevEmo &&
      curEmo &&
      prevEmo !== curEmo &&
      prev.scene_asset_id === cur.scene_asset_id &&
      cur.dramatic_purpose !== 'emotional' &&
      cur.dramatic_purpose !== 'reaction'
    ) {
      push({
        shot_id: cur.shot_id,
        prev_shot_id: prev.shot_id,
        type: 'emotion_jump',
        severity: 'info',
        message: `情绪从「${prevEmo}」到「${curEmo}」，建议确认中间是否缺反应镜。`,
      });
    }
  }

  for (const shot of shots) {
    if (dramaShotLooksOverloaded(shot.action, formatDramaDialogueLines(shot.dialogue || []))) {
      push({
        shot_id: shot.shot_id,
        type: 'shot_overload',
        severity: 'warn',
        message: `镜${shot.shot_no} 可能把多个独立动作/对白塞进一镜（信息过载）。应先拆视觉事件再合并。`,
      });
    }
    if (!String(shot.dramatic_purpose || shot.purpose || '').trim()) {
      push({
        shot_id: shot.shot_id,
        type: 'missing_purpose',
        severity: 'info',
        message: `镜${shot.shot_no} 缺少明确导演目的。`,
      });
    }
  }

  // 对白无名说话人
  for (const shot of shots) {
    for (const line of shot.dialogue || []) {
      if (line.text && !line.character_id && !line.character_name) {
        push({
          shot_id: shot.shot_id,
          type: 'dialogue_speaker',
          severity: 'warn',
          message: `对白缺少说话人：「${line.text.slice(0, 24)}」`,
        });
      }
    }
  }

  return issues;
}

export function dramaShotSummaryForPackage(shot: DramaShot): string {
  const dlg = formatDramaDialogueLines(shot.dialogue || []);
  return [
    `镜${shot.shot_no}`,
    shot.action && `动作：${shot.action.slice(0, 60)}`,
    dlg && `对白：${dlg.slice(0, 40)}`,
  ]
    .filter(Boolean)
    .join('；');
}
