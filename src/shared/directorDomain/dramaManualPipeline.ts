/**
 * AI 短剧人工步骤门禁：
 * 分集 → 画风色调 → 剧本分析(分场/时长) → 素材匹配 → 提示词优化 → 出片
 */

import { getActiveEpisodeBible } from './episodeBible.js';
import {
  isDramaH3AntiCrosstalkPrompt,
  isDramaH3ProductionPrompt,
  isDramaZhPlainProductionPrompt,
} from './composeDramaShotLensPrompt.js';
import { isMinimaxH3ChineseSkillPrompt } from '../minimaxH3OptimizePrompt.js';
import type { DramaDirectorSession, DramaShot } from './types.js';

export function isDramaVisualStyleLocked(session: DramaDirectorSession): boolean {
  return Number(session.bible?.projectVisualBible?.selected_at || 0) > 0;
}

export function isDramaSceneSplitDone(session: DramaDirectorSession): boolean {
  const bible = getActiveEpisodeBible(session);
  if (Number(bible.scene_split_at || 0) > 0) return true;
  return !!(bible.original_scenes || []).length && !!(bible.original_segments || []).length;
}

export function isDramaDurationSplitDone(session: DramaDirectorSession): boolean {
  const bible = getActiveEpisodeBible(session);
  if (Number(bible.duration_split_at || 0) > 0) return true;
  return (bible.shot_suggestions || []).length > 0;
}

export function isDramaAssetMatchDone(session: DramaDirectorSession): boolean {
  const bible = getActiveEpisodeBible(session);
  if (Number(bible.asset_match_at || 0) > 0) return true;
  return (bible.shot_suggestions || []).some(
    (s) => String(s.asset_match || '').trim() || String(s.visual_style || '').trim(),
  );
}

/** 中文白话优化稿（@图片 / 风格色调 / 剧情） */
export function isDramaShotZhPlainSkillPrompt(text: string): boolean {
  return isDramaZhPlainProductionPrompt(text);
}

/** 本镜已写入可用优化稿（中文 Skill 六段 / 英文 Ref2VA / 中文白话 / 任意中文优化稿） */
export function isDramaShotH3SkillSealed(shot: DramaShot | null | undefined): boolean {
  const sealed = String(shot?.h3_skill_prompt || '').trim();
  if (!sealed) return false;
  if (isDramaH3AntiCrosstalkPrompt(sealed)) return true;
  if (isMinimaxH3ChineseSkillPrompt(sealed)) return true;
  if (isDramaZhPlainProductionPrompt(sealed)) return true;
  if (/[\u4e00-\u9fff]/.test(sealed) && sealed.length >= 40) return true;
  return isDramaH3ProductionPrompt(sealed);
}

/** 本镜是否已具备可上云的 MiniMax H3 Skill 终稿。
 * 短剧：中文六段 / 英文 Ref2VA / 中文白话 / 任意已写入的中文优化稿均算已优化。
 */
export function dramaShotSkillMatchesLocale(
  shot: DramaShot | null | undefined,
  _locale?: string,
): boolean {
  const sealed = String(shot?.h3_skill_prompt || '').trim();
  if (!sealed) return false;
  if (isDramaH3AntiCrosstalkPrompt(sealed)) return true;
  if (isMinimaxH3ChineseSkillPrompt(sealed)) return true;
  if (isDramaZhPlainProductionPrompt(sealed)) return true;
  return /[\u4e00-\u9fff]/.test(sealed) && sealed.length >= 40;
}

export function dramaManualPipelineBlockReason(
  session: DramaDirectorSession,
  step:
    | 'ingest'
    | 'scene_split'
    | 'duration_split'
    | 'assets'
    | 'asset_match'
    | 'board'
    | 'skill_seal'
    | 'generate',
): string {
  // 画风色调：素材/出片前强制；剧本分场可先做
  if (
    !isDramaVisualStyleLocked(session) &&
    (step === 'assets' ||
      step === 'asset_match' ||
      step === 'board' ||
      step === 'skill_seal' ||
      step === 'generate')
  ) {
    return '请先完成「画风 + 色调」锁定整片风格';
  }
  if (step === 'scene_split' || step === 'duration_split' || step === 'assets') {
    if (!(session.episodes || []).length) return '请先完成小说分集';
    if (!(session.active_episode_id || '').trim()) return '请先选择要制作的一集';
  }
  if (step === 'duration_split' && !isDramaSceneSplitDone(session)) {
    return '请先点「分场」（剧本拆分）';
  }
  if (step === 'assets' && !isDramaDurationSplitDone(session)) {
    return '请先完成「时长拆镜」，再进入素材准备';
  }
  if (step === 'asset_match') {
    if (!isDramaDurationSplitDone(session)) return '请先完成时长拆镜';
  }
  if (step === 'board' || step === 'skill_seal' || step === 'generate') {
    if (!isDramaDurationSplitDone(session)) return '请先完成时长拆镜';
    if (!isDramaAssetMatchDone(session)) return '请先完成「素材匹配」（人物/场景/声音对应切分段）';
  }
  return '';
}
