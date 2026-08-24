/**
 * Shot Planning 系统校验：镜数、事件覆盖率、空间/时间连续性。
 * 不信任模型自称「已拆完」。
 */

import {
  normalizeDramaEventId,
  type DramaAnalyzeShotBudget,
  type DramaVisualEvent,
} from './shotPlanning.js';
import type { DramaSceneBeat, DramaShotSuggestion } from './types.js';
import { normalizeDramaShotPlanPaceGear } from './types.js';

export type DramaShotPlanValidation = {
  ok: boolean;
  errors: string[];
  shotCount: number;
  eventCount: number;
  coveredCount: number;
  coverage: number;
  missingEventIds: string[];
  hardEventCount: number;
  hardCoveredCount: number;
  hardCoverage: number;
  missingHardEventIds: string[];
  auxEventCount: number;
  auxCoverage: number;
  missingAuxEventIds: string[];
};

function locKey(s: string): string {
  return String(s || '')
    .trim()
    .replace(/\s+/g, '')
    .toLowerCase();
}

function spaceFamily(loc: string): string {
  const s = locKey(loc);
  if (!s) return '';
  if (/电梯|走廊|楼层|写字楼|大厅|门口|办公室|1708|十七楼|17楼/.test(s)) return 'office-tower';
  if (/雨夜|街头|街道|车流|马路|滨江/.test(s)) return 'street';
  if (/便利店|超市/.test(s)) return 'store';
  if (/出租|居民楼|小房间|阳台/.test(s)) return 'home';
  if (/草原|平原|晨曦/.test(s)) return 'plain';
  if (/白空间|纯白|神经/.test(s)) return 'white';
  return s;
}

function isConnectedMove(prevLoc: string, curLoc: string): boolean {
  const a = spaceFamily(prevLoc);
  const b = spaceFamily(curLoc);
  if (!a || !b) return true;
  if (a === b) return true;
  const path = `${a}>${b}`;
  return (
    path === 'street>office-tower' ||
    path === 'office-tower>street' ||
    path === 'street>store' ||
    path === 'store>street' ||
    path === 'street>home' ||
    path === 'home>street' ||
    path === 'white>plain' ||
    path === 'plain>white'
  );
}

function purposeOf(shot: DramaShotSuggestion): string {
  return String(shot.dramatic_purpose || shot.purpose || '')
    .trim()
    .toLowerCase();
}

function isEstablishOrTransition(shot: DramaShotSuggestion): boolean {
  const p = purposeOf(shot);
  return /establish|transition|environment|introduce/.test(p) || /建立|转场|空镜|交代/.test(p);
}

function hasSpokenDialogue(shot: DramaShotSuggestion): boolean {
  return dialogueSpokenCount(shot) > 0;
}

/** 对白句数：建议表 dialogue 多为「角色：台词 / 角色：台词」字符串，偶发数组 */
function dialogueSpokenCount(shot: DramaShotSuggestion): number {
  const raw = shot.dialogue as unknown;
  if (Array.isArray(raw)) {
    return raw.filter((x) => String((x as { text?: string })?.text || '').trim()).length;
  }
  const s = String(raw || '').trim();
  if (!s) return 0;
  const parts = s
    .split(/\s*\/\s*|\n+/)
    .map((x) => x.trim())
    .filter(Boolean);
  return Math.max(1, parts.length);
}

/** 服务对话/对峙/反应的镜头（含无台词的反应镜） */
function isDialogueServiceShot(shot: DramaShotSuggestion): boolean {
  if (hasSpokenDialogue(shot)) return true;
  const p = purposeOf(shot);
  if (/dialogue|reaction|emotional|reveal/.test(p) || /对白|对话|反应|对峙|质问|冲突/.test(p)) {
    return true;
  }
  const action = String(shot.action || '');
  const emotion = String(shot.emotion_play || '');
  return /攥拳|喉结|点屏|差评|反应|低头不语/.test(`${action} ${emotion}`);
}

/** 纯赶路/过渡镜（无对白服务） */
function isTravelOrTransitionShot(shot: DramaShotSuggestion): boolean {
  if (isDialogueServiceShot(shot)) return false;
  if (isEstablishOrTransition(shot)) return true;
  const scene = String(shot.scene || '');
  const action = String(shot.action || '');
  return (
    /街头|街道|车流|雨夜|走廊|电梯|大堂|门厅|赶路|马路/.test(scene) ||
    /赶路|穿车|骑行|冲进|电梯|走廊|跟拍走路/.test(action)
  );
}

function coveredIdsOf(shot: DramaShotSuggestion): string[] {
  return (shot.visual_event_ids || []).map((id) => normalizeDramaEventId(id)).filter(Boolean);
}

/** 事件层可接受下限：约为目标的一半。模型给出 30 条而公式要 33 时不应整集作废。 */
export function dramaVisualEventAcceptMin(budget: DramaAnalyzeShotBudget): number {
  return Math.max(6, Math.min(budget.eventsMin, Math.round(budget.eventsTarget * 0.5)));
}

export function validateDramaVisualEventCount(
  events: DramaVisualEvent[],
  budget: DramaAnalyzeShotBudget,
): { ok: boolean; error?: string } {
  const n = events.length;
  const acceptMin = dramaVisualEventAcceptMin(budget);
  if (n < acceptMin) {
    return {
      ok: false,
      error: `视觉事件仅 ${n} 条，低于可接受下限 ${acceptMin}（目标约 ${budget.eventsTarget}）。事件层过短，不能进入分镜。`,
    };
  }
  return { ok: true };
}

/**
 * 镜头数量 + A/B 事件覆盖 + 空间连续性。
 * A 类硬事件必须 100%；B 类默认 ≥80%；短剧挡位 B 可降至 0（砍前戏）。
 */
export function validateDramaShotPlan(opts: {
  suggestions: DramaShotSuggestion[];
  visualEvents: DramaVisualEvent[];
  sceneBeats?: DramaSceneBeat[];
  budget: DramaAnalyzeShotBudget;
  /** 短剧快节奏时放宽 B 类覆盖与空间硬切 */
  paceGear?: import('./types.js').DramaShotPlanPaceGear | string;
}): DramaShotPlanValidation {
  const suggestions = opts.suggestions || [];
  const events = opts.visualEvents || [];
  const budget = opts.budget;
  const pace = normalizeDramaShotPlanPaceGear(opts.paceGear);
  const shortDrama = pace === 'short_drama';
  const dense15 = pace === 'dense_15s';
  const auxMin = shortDrama || dense15 ? 0 : 0.8;
  const errors: string[] = [];

  const tagged = events.map((e, i) => ({
    id: normalizeDramaEventId(e.event_id || e.index || i + 1),
    priority: e.priority === 'B' ? ('B' as const) : ('A' as const),
  }));
  const uniqueEventIds = [...new Set(tagged.map((x) => x.id).filter(Boolean))];
  const hardIds = [...new Set(tagged.filter((x) => x.priority === 'A' && x.id).map((x) => x.id))];
  const auxIds = [...new Set(tagged.filter((x) => x.priority === 'B' && x.id).map((x) => x.id))];
  const covered = new Set<string>();
  for (const shot of suggestions) {
    for (const id of coveredIdsOf(shot)) covered.add(id);
  }
  const missingEventIds = uniqueEventIds.filter((id) => !covered.has(id));
  const coveredCount = uniqueEventIds.length - missingEventIds.length;
  const coverage = uniqueEventIds.length ? coveredCount / uniqueEventIds.length : 0;
  const missingHardEventIds = hardIds.filter((id) => !covered.has(id));
  const hardCoveredCount = hardIds.length - missingHardEventIds.length;
  const hardCoverage = hardIds.length ? hardCoveredCount / hardIds.length : 1;
  const missingAuxEventIds = auxIds.filter((id) => !covered.has(id));
  const auxCoveredCount = auxIds.length - missingAuxEventIds.length;
  const auxCoverage = auxIds.length ? auxCoveredCount / auxIds.length : 1;

  if (suggestions.length < budget.shotsMin) {
    errors.push(
      `当前仅生成 ${suggestions.length} 个镜头，远低于本集最低镜头数 ${budget.shotsMin}（目标约 ${budget.shotsTarget}）。请基于已有 Visual Events 重新生成完整分镜，不得遗漏事件。`,
    );
  }
  if (suggestions.length > budget.shotsMax) {
    errors.push(
      `镜头 ${suggestions.length} 条超过本集上限 ${budget.shotsMax}（目标约 ${budget.shotsTarget}）。请合并同空间连续动作，不要为切而切。`,
    );
  }

  if (missingHardEventIds.length) {
    const preview = missingHardEventIds.slice(0, 12).join('、');
    errors.push(
      `硬事件覆盖 ${Math.round(hardCoverage * 100)}%（${hardCoveredCount}/${hardIds.length}），必须 100%。未覆盖：${preview}${
        missingHardEventIds.length > 12 ? '…' : ''
      }。人物首次出场、换地点、关键道具/能力、信息揭示、冲突与结果、死伤、升级、关键对白不得漏镜。`,
    );
  }
  if (auxIds.length && auxCoverage < auxMin) {
    const preview = missingAuxEventIds.slice(0, 8).join('、');
    errors.push(
      `辅助事件覆盖 ${Math.round(auxCoverage * 100)}%（${auxCoveredCount}/${auxIds.length}），低于 ${Math.round(
        auxMin * 100,
      )}%。未覆盖：${preview}${
        missingAuxEventIds.length > 8 ? '…' : ''
      }。雨水/车流/走路等可压缩，但不能大段丢掉。`,
    );
  }

  if (!shortDrama && !dense15) {
    for (let i = 1; i < suggestions.length; i += 1) {
      const prev = suggestions[i - 1];
      const cur = suggestions[i];
      if (!prev.scene || !cur.scene) continue;
      if (isConnectedMove(prev.scene, cur.scene)) continue;
      if (isEstablishOrTransition(cur)) continue;
      errors.push(
        `空间跳跃：镜 ${prev.shot || i}「${prev.scene}」直接切到镜 ${cur.shot || i + 1}「${cur.scene}」，中间缺少建立/转场。`,
      );
      break;
    }
  }

  // 短剧快节奏：对话服务镜 ≥45%，赶路/过渡 ≤35%（略宽于提示词 50%/30%，避免边界误杀）
  if (shortDrama && suggestions.length >= 6) {
    const dialogueService = suggestions.filter(isDialogueServiceShot).length;
    const travel = suggestions.filter(isTravelOrTransitionShot).length;
    const dialogueRatio = dialogueService / suggestions.length;
    const travelRatio = travel / suggestions.length;
    if (dialogueRatio < 0.45) {
      errors.push(
        `短剧节奏不合格：服务对话/对峙/反应的镜头仅 ${dialogueService}/${suggestions.length}（${Math.round(
          dialogueRatio * 100,
        )}%），须 ≥45%（目标 ≥50%）。请砍赶路镜、把室内对白细切为多镜并补反应镜。`,
      );
    }
    if (travelRatio > 0.35) {
      errors.push(
        `短剧节奏不合格：赶路/过渡镜 ${travel}/${suggestions.length}（${Math.round(
          travelRatio * 100,
        )}%），须 ≤35%（目标 ≤30%）。请合并雨夜街头/大堂/电梯/走廊，把镜数还给对话场景。`,
      );
    }
    const megaDialogue = suggestions.filter((s) => dialogueSpokenCount(s) >= 5);
    if (megaDialogue.length) {
      errors.push(
        `短剧节奏不合格：存在把 ≥5 句对白压进单镜的镜头（镜 ${megaDialogue
          .map((s) => s.shot || '?')
          .slice(0, 4)
          .join('、')}）。请每 2～3 句切镜，并插入反应镜。`,
      );
    }
  }

  // 15秒高密度：合镜段落 + 镜内时间轴
  if (dense15 && suggestions.length >= 3) {
    const dur15 = suggestions.filter((s) => Number(s.duration_sec) === 15).length;
    const ratio15 = dur15 / suggestions.length;
    if (ratio15 < 0.5) {
      errors.push(
        `15秒高密度不合格：仅 ${dur15}/${suggestions.length} 镜为 15 秒（${Math.round(
          ratio15 * 100,
        )}%），须 ≥50%。请把同地点连续 3～8 个事件合并为 15 秒段落镜。`,
      );
    }
    const sixShots = suggestions.filter((s) => Number(s.duration_sec) === 6).length;
    if (sixShots / suggestions.length > 0.25) {
      errors.push(
        `15秒高密度不合格：6 秒碎镜 ${sixShots}/${suggestions.length}（${Math.round(
          (sixShots / suggestions.length) * 100,
        )}%），须 ≤25%。请合镜，不要快切堆镜。`,
      );
    }
    const thinAction = suggestions.filter(
      (s) => !/\[\d+(\.\d+)?-\d|0-\d+s|\d+-\d+s/.test(String(s.action || '')),
    ).length;
    if (thinAction > Math.ceil(suggestions.length * 0.4)) {
      errors.push(
        `15秒高密度不合格：${thinAction} 镜 action 缺少镜内时间子窗（如 [0-6s]…[6-12s]…）。请按出片密度写镜内时间轴。`,
      );
    }
  }

  return {
    ok: errors.length === 0,
    errors,
    shotCount: suggestions.length,
    eventCount: uniqueEventIds.length,
    coveredCount,
    coverage,
    missingEventIds,
    hardEventCount: hardIds.length,
    hardCoveredCount,
    hardCoverage,
    missingHardEventIds,
    auxEventCount: auxIds.length,
    auxCoverage,
    missingAuxEventIds,
  };
}

/** 容错收下：硬事件必须 100%；短剧可略降镜数下限。节奏配额（对话≥45%/赶路≤35%）不可容错。 */
export function dramaShotPlanIsAcceptable(
  v: DramaShotPlanValidation,
  budget: DramaAnalyzeShotBudget,
  paceGear?: string,
): boolean {
  if (v.ok) return true;
  const pace = normalizeDramaShotPlanPaceGear(paceGear);
  const shortDrama = pace === 'short_drama';
  const dense15 = pace === 'dense_15s';
  if (shortDrama && v.errors.some((e) => e.includes('短剧节奏不合格'))) return false;
  if (dense15 && v.errors.some((e) => e.includes('15秒高密度不合格'))) return false;
  const minShots = dense15
    ? Math.max(3, Math.floor(budget.shotsMin * 0.65))
    : shortDrama
      ? Math.max(4, Math.floor(budget.shotsMin * 0.7))
      : Math.max(8, budget.shotsMin);
  return v.hardCoverage >= 1 && v.shotCount >= minShots;
}

export function formatDramaShotPlanValidationError(v: DramaShotPlanValidation): string {
  if (v.ok) return '';
  return v.errors.join('\n');
}
