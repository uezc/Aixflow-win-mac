/**
 * AI 短剧导演台：用户可见 4 阶段 ↔ Domain 内部 phase 映射。
 * 用户流程：剧本 → 素材准备 → 导演分镜 → 成片
 * （出片在导演分镜完成；先出参考图/音色，再排导演表）
 */

import { normalizeDramaDomainPhase } from './factories.js';
import type { DramaDirectorSession, DramaDomainPhase } from './types.js';

/** 用户主流程（顶部只显示这 4 步） */
export type DramaUserPhase = 'script' | 'assets' | 'board' | 'final';

export const DRAMA_USER_PHASES: DramaUserPhase[] = [
  'script',
  'assets',
  'board',
  'final',
];

export const DRAMA_USER_PHASE_LABELS: Record<DramaUserPhase, string> = {
  script: '剧本',
  assets: '素材准备',
  board: '导演分镜',
  final: '成片',
};

export const DRAMA_USER_PHASE_SUB: Record<DramaUserPhase, string> = {
  script: '导入 · 视觉 · 分析 · 确认',
  assets: '本剧共用 · 不分集 · 确认',
  board: '导演表 · 出片 · 确认',
  final: '按序入轨 · 剪辑',
};

/** 内部 phase → 用户 4 phase。旧数据 videos（原批量生成）并入导演分镜。 */
export function domainPhaseToUserPhase(phase: DramaDomainPhase | string): DramaUserPhase {
  const p = normalizeDramaDomainPhase(phase);
  if (p === 'board' || p === 'videos') return 'board';
  if (p === 'assets' || p === 'bible') return 'assets';
  if (p === 'review') return 'final';
  return 'script';
}

/**
 * 进入某用户阶段时，落到哪个内部 phase。
 * 剧本阶段：无分集→episodes（空态 + 卡）；有分集无视觉→visual；无选集→episodes；否则 analyze。
 */
export function preferredDomainPhaseForUserPhase(
  userPhase: DramaUserPhase,
  session: DramaDirectorSession,
): DramaDomainPhase {
  if (userPhase === 'assets') return 'assets';
  if (userPhase === 'board') return 'board';
  if (userPhase === 'final') return 'review';

  const hasEpisodes = (session.episodes || []).length > 0;
  const hasVisual = !!session.bible.projectVisualBible?.selected_at;
  const hasActive = !!(session.active_episode_id || '').trim();
  if (!hasEpisodes) return 'episodes';
  if (!hasVisual) return 'visual';
  if (!hasActive) return 'episodes';
  return 'analyze';
}

/** 与 pipeline 同步用的代表 phase */
export function userPhaseToPipelinePhase(userPhase: DramaUserPhase): DramaDomainPhase {
  if (userPhase === 'assets') return 'assets';
  if (userPhase === 'board') return 'board';
  if (userPhase === 'final') return 'review';
  return 'analyze';
}

export function isDramaAnalyzeConfirmed(session: DramaDirectorSession): boolean {
  return !!(session.meta.analyze_confirmed || session.bible.confirmed_at);
}

export function isDramaBoardConfirmed(session: DramaDirectorSession): boolean {
  return Number(session.meta.board_confirmed_at || 0) > 0;
}

export function isDramaAssetsConfirmed(session: DramaDirectorSession): boolean {
  return Number(session.meta.assets_confirmed_at || 0) > 0;
}

/** 镜头审核：全部 pass（无 review 视为未通过） */
export function areDramaShotsAllPassed(session: DramaDirectorSession): boolean {
  const shots = session.shots || [];
  if (!shots.length) return false;
  const reviews = session.reviews || {};
  return shots.every((s) => {
    const r = reviews[s.shot_id];
    return r && (r.status === 'pass' || r.verdict === 'PASS');
  });
}

export type DramaUserPhaseGate =
  | { ok: true }
  | { ok: false; reason: string; fallback: DramaUserPhase };

export function canEnterDramaUserPhase(
  session: DramaDirectorSession,
  target: DramaUserPhase,
): DramaUserPhaseGate {
  if (target === 'script') return { ok: true };

  if (target === 'assets') {
    if (!isDramaAnalyzeConfirmed(session)) {
      return {
        ok: false,
        reason: '请先完成并确认剧本分析，再进入素材准备',
        fallback: 'script',
      };
    }
    return { ok: true };
  }

  if (target === 'board') {
    if (!isDramaAnalyzeConfirmed(session)) {
      return {
        ok: false,
        reason: '请先完成并确认剧本分析',
        fallback: 'script',
      };
    }
    return { ok: true };
  }

  if (!isDramaBoardConfirmed(session)) {
    return { ok: false, reason: '请先确认导演表，再进入成片', fallback: 'board' };
  }
  return { ok: true };
}

export function isDramaUserPhaseDone(
  session: DramaDirectorSession,
  userPhase: DramaUserPhase,
): boolean {
  if (userPhase === 'script') return isDramaAnalyzeConfirmed(session);
  if (userPhase === 'assets') return isDramaAssetsConfirmed(session);
  if (userPhase === 'board') return isDramaBoardConfirmed(session);
  return domainPhaseToUserPhase(session.meta.phase) === 'final';
}
