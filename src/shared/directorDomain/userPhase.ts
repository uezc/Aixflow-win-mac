/**
 * AI 短剧导演台：用户可见阶段 ↔ Domain 内部 phase 映射。
 * 用户顶部流程：剧本(分集) → 画风色调 → 剧本分析(仍属剧本域) → 素材准备 → 导演分镜 → 成片
 * 剧本域：①分集 →（选画风色调）→ ②分场 → ③时长拆 → ④确认去素材
 */

import { normalizeDramaDomainPhase } from './factories.js';
import {
  isDramaAssetMatchDone,
  isDramaDurationSplitDone,
  isDramaVisualStyleLocked,
} from './dramaManualPipeline.js';
import type { DramaDirectorSession, DramaDomainPhase } from './types.js';

/** 用户主流程（顶部步骤条） */
export type DramaUserPhase = 'script' | 'visual' | 'assets' | 'board' | 'final';

export const DRAMA_USER_PHASES: DramaUserPhase[] = [
  'script',
  'visual',
  'assets',
  'board',
  'final',
];

export const DRAMA_USER_PHASE_LABELS: Record<DramaUserPhase, string> = {
  script: '剧本',
  visual: '画风色调',
  assets: '素材准备',
  board: '导演分镜',
  final: '成片',
};

export const DRAMA_USER_PHASE_SUB: Record<DramaUserPhase, string> = {
  script: '①分集 → 画风后②分场③时长拆④确认',
  visual: '①画风 → ②色调 → ③锁定 → 剧本分析',
  assets: '①定妆/声音 → ②素材匹配 → ③确认',
  board: '①提示词优化 → ②出片',
  final: '按序入轨 · 剪辑',
};

/** 内部 phase → 用户顶部 phase */
export function domainPhaseToUserPhase(phase: DramaDomainPhase | string): DramaUserPhase {
  const p = normalizeDramaDomainPhase(phase);
  if (p === 'board' || p === 'videos') return 'board';
  if (p === 'assets' || p === 'bible') return 'assets';
  if (p === 'visual') return 'visual';
  if (p === 'review') return 'final';
  return 'script';
}

/**
 * 进入某用户阶段时，落到哪个内部 phase。
 * 剧本：已锁画风则进分析页，否则进分集。
 */
export function preferredDomainPhaseForUserPhase(
  userPhase: DramaUserPhase,
  session: DramaDirectorSession,
): DramaDomainPhase {
  if (userPhase === 'visual') return 'visual';
  if (userPhase === 'assets') return 'assets';
  if (userPhase === 'board') return 'board';
  if (userPhase === 'final') return 'review';

  const hasEpisodes = (session.episodes || []).length > 0;
  const hasActive = !!(session.active_episode_id || '').trim();
  if (!hasEpisodes) return 'ingest';
  if (!hasActive) return 'episodes';
  if (isDramaVisualStyleLocked(session)) return 'analyze';
  return 'episodes';
}

/** 与 pipeline 同步用的代表 phase */
export function userPhaseToPipelinePhase(userPhase: DramaUserPhase): DramaDomainPhase {
  if (userPhase === 'visual') return 'visual';
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

  if (target === 'visual') {
    if (!(session.episodes || []).length) {
      return { ok: false, reason: '请先完成剧本分集', fallback: 'script' };
    }
    if (!(session.active_episode_id || '').trim()) {
      return { ok: false, reason: '请先选择一集，再选画风色调', fallback: 'script' };
    }
    return { ok: true };
  }

  if (target === 'assets') {
    if (!isDramaVisualStyleLocked(session)) {
      return {
        ok: false,
        reason: '请先锁定画风与色调',
        fallback: 'visual',
      };
    }
    if (!isDramaAnalyzeConfirmed(session) && !isDramaDurationSplitDone(session)) {
      return {
        ok: false,
        reason: '请先完成剧本分析（分场与时长拆镜）',
        fallback: 'script',
      };
    }
    // 时长拆镜完成即视为确认，不再要求单独点「确认」
    return { ok: true };
  }

  if (target === 'board') {
    if (!isDramaVisualStyleLocked(session)) {
      return {
        ok: false,
        reason: '请先锁定画风与色调',
        fallback: 'visual',
      };
    }
    if (!isDramaAnalyzeConfirmed(session) && !isDramaDurationSplitDone(session)) {
      return {
        ok: false,
        reason: '请先完成剧本分析（分场与时长拆镜）',
        fallback: 'script',
      };
    }
    if (!isDramaAssetMatchDone(session)) {
      return {
        ok: false,
        reason: '请先在素材准备完成「素材匹配」',
        fallback: 'assets',
      };
    }
    return { ok: true };
  }

  // 成片：不再要求「确认导演表」；有分镜即可进入
  if (!(session.shots || []).length) {
    return { ok: false, reason: '请先在导演分镜准备镜头，再进入成片', fallback: 'board' };
  }
  return { ok: true };
}

export function isDramaUserPhaseDone(
  session: DramaDirectorSession,
  userPhase: DramaUserPhase,
): boolean {
  if (userPhase === 'script') return isDramaAnalyzeConfirmed(session);
  if (userPhase === 'visual') return isDramaVisualStyleLocked(session);
  if (userPhase === 'assets') return isDramaAssetsConfirmed(session) && isDramaAssetMatchDone(session);
  if (userPhase === 'board') return (session.shots || []).length > 0;
  return domainPhaseToUserPhase(session.meta.phase) === 'final';
}
