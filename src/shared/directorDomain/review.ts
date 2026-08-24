/**
 * 成片审核：启发式评分 + 可选 LLM 结果归一。
 */

import { runDramaContinuityCheck } from './continuity.js';
import type { DramaDirectorSession, DramaReviewResult, DramaReviewStatus } from './types.js';

export function scoreDramaShotHeuristically(
  session: DramaDirectorSession,
  shotId: string,
): DramaReviewResult {
  const shot = session.shots.find((s) => s.shot_id === shotId);
  const allIssues = runDramaContinuityCheck(session).filter((i) => i.shot_id === shotId);
  let score = 100;
  for (const issue of allIssues) {
    if (issue.severity === 'error') score -= 25;
    else if (issue.severity === 'warn') score -= 10;
    else score -= 2;
  }
  if (!shot?.video_url) {
    score -= 40;
    allIssues.push({
      issue_id: `novideo-${shotId}`,
      shot_id: shotId,
      type: 'missing_video',
      severity: 'error',
      message: '尚未生成成片视频',
    });
  }
  if (!shot?.action) {
    score -= 10;
    allIssues.push({
      issue_id: `noaction-${shotId}`,
      shot_id: shotId,
      type: 'missing_action',
      severity: 'warn',
      message: '画面动作为空',
    });
  }
  score = Math.max(0, Math.min(100, score));
  let status: DramaReviewStatus = 'pass';
  if (score < 60 || allIssues.some((i) => i.severity === 'error')) status = 'fail';
  else if (score < 80 || allIssues.some((i) => i.severity === 'warn')) status = 'warn';

  const suggestions: string[] = [];
  if (allIssues.some((i) => i.type === 'prop_hand')) {
    suggestions.push('统一持物左右手，或在连贯性备注中写明换手动机');
  }
  if (allIssues.some((i) => i.type === 'location_jump')) {
    suggestions.push('补充转场空镜或连贯性「转场」说明');
  }
  if (!shot?.video_url) suggestions.push('先生成视频再复审');
  if (status === 'fail') suggestions.push('按建议修正分镜或重新生成该镜视频');

  return {
    shot_id: shotId,
    score,
    status,
    issues: allIssues,
    suggestions,
    reviewed_at: Date.now(),
  };
}

export function reviewAllDramaShots(
  session: DramaDirectorSession,
): Record<string, DramaReviewResult> {
  const out: Record<string, DramaReviewResult> = {};
  for (const shot of session.shots) {
    out[shot.shot_id] = scoreDramaShotHeuristically(session, shot.shot_id);
  }
  return out;
}

/** LLM 审核结果归一（若未来接 Chat QA） */
export function normalizeDramaReviewFromLlm(
  shotId: string,
  raw: unknown,
): DramaReviewResult | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const score = Math.max(0, Math.min(100, Number(o.score) || 0));
  const statusRaw = String(o.status || '').toLowerCase();
  const status: DramaReviewStatus =
    statusRaw === 'pass' || statusRaw === 'warn' || statusRaw === 'fail'
      ? (statusRaw as DramaReviewStatus)
      : score >= 80
        ? 'pass'
        : score >= 60
          ? 'warn'
          : 'fail';
  const suggestions = Array.isArray(o.suggestions)
    ? o.suggestions.map((x) => String(x)).filter(Boolean)
    : [];
  return {
    shot_id: shotId,
    score,
    status,
    issues: [],
    suggestions,
    reviewed_at: Date.now(),
  };
}
