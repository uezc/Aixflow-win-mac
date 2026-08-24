/**
 * 剧本重生后：受控把单镜提示词/素材匹配对齐到最新剧情表。
 * 不碰分镜图、成片、歌曲片段等生成结果。
 */

import {
  applyDirectorShotAssetBindingIndices,
  matchDirectorAssetIndicesForShot,
} from './bindAssetRefs.js';
import {
  composeDirectorShotFinalPrompt,
  shouldAutoSyncDirectorFinalPrompt,
} from './composeFinalPrompt.js';
import {
  applyDirectorMvPlotBeatToOneShot,
  getDirectorMvPlotBeatsFromState,
  mapDirectorMvShotIndexToPlotBeat,
} from './plotBeatSheet.js';
import type { DirectorAsset, DirectorPipelineState, DirectorShot } from './schema.js';
import {
  createDefaultDirectorPipelineState,
  getDirectorShotStoryboard,
  isDirectorShotPromptsStale,
  listDirectorMvLeadAssetIds,
  markDirectorShotPromptsSynced,
} from './schema.js';
import { resolveDirectorStylePrompt, resolveDirectorStyleReferenceImageUrl } from './stylePresets.js';

function orderedAssetsWithImages(state: DirectorPipelineState): DirectorAsset[] {
  return [
    ...(state.assets?.characters || []),
    ...(state.assets?.scenes || []),
    ...(state.assets?.props || []),
    ...(state.assets?.creatures || []),
  ].filter((a) => String(a?.imageUrl || '').trim());
}

/** 解析本镜自动/手动素材索引 */
function resolveShotBindingIndices(
  state: DirectorPipelineState,
  shot: DirectorShot,
  rowIndex: number,
): number[] {
  const refs = orderedAssetsWithImages(state);
  const shotNo = String(shot['镜号'] || rowIndex + 1).trim() || String(rowIndex + 1);
  const sb = getDirectorShotStoryboard(state, shotNo);
  let indices = matchDirectorAssetIndicesForShot(shot, refs, {
    leadAssetIds: listDirectorMvLeadAssetIds(state),
  });

  if (Array.isArray(sb.sceneAssetIds)) {
    indices = indices.filter((i) => refs[i]?.kind !== 'scene');
    for (const id of sb.sceneAssetIds) {
      const i = refs.findIndex((r) => String(r?.id || '') === id && r?.kind === 'scene');
      if (i >= 0 && !indices.includes(i)) indices.push(i);
    }
  }
  if (Array.isArray(sb.castAssetIds)) {
    indices = indices.filter((i) => refs[i]?.kind !== 'character');
    for (const id of sb.castAssetIds) {
      const i = refs.findIndex((r) => String(r?.id || '') === id && r?.kind === 'character');
      if (i >= 0 && !indices.includes(i)) indices.push(i);
    }
  }
  return indices;
}

type SyncShotPromptFromScriptOpts = {
  /** 忽略 finalPromptManual，强制用镜头脚本重拼最终提示词 */
  forceFinalPrompt?: boolean;
  /** 把新拼出的提示词写入 promptOriginal，并清空优化稿 */
  clearOptimized?: boolean;
};

/**
 * 用最新剧本剧情表更新单镜：画面/机位/对口型动作/最终提示词 + @图片 匹配。
 * 默认尊重 finalPromptManual / descManual / framingManual / lipsyncActionManual。
 * 不修改 storyboard 的 imageUrl / videoUrl 等生成结果。
 */
function syncDirectorShotPromptFromScript(
  state: DirectorPipelineState,
  rowIndex: number,
  opts: SyncShotPromptFromScriptOpts = {},
): DirectorPipelineState {
  if (rowIndex < 0 || rowIndex >= (state.shots || []).length) return state;
  const shot0 = state.shots[rowIndex];
  if (!shot0) return state;
  const shotNo = String(shot0['镜号'] || rowIndex + 1).trim() || String(rowIndex + 1);
  const sb = getDirectorShotStoryboard(state, shotNo);
  const beats = getDirectorMvPlotBeatsFromState(state);
  const beat = beats?.length
    ? mapDirectorMvShotIndexToPlotBeat(rowIndex, state.shots.length, beats)
    : null;

  const forceDesc = !sb.descManual;
  const forceFraming = !sb.framingManual;
  const forceLipsync = !sb.lipsyncActionManual;
  // 仅「明确手改过」才保护；自动拼装的最终提示词应随剧本更新。用户点「从脚本重出」时强制重拼。
  const keepFinalManual = opts.forceFinalPrompt ? false : !!sb.finalPromptManual;

  let nextShot = applyDirectorMvPlotBeatToOneShot(shot0, beat, {
    forceDesc,
    forceFraming,
    forceLipsyncAction: forceLipsync,
    closeUpFraming: state.mvCloseUpFraming !== false,
    clearFinalPromptOnDescChange: !keepFinalManual,
  });

  const style = resolveDirectorStylePrompt(state.stylePresetId, state.globalStyle);
  if (!keepFinalManual) {
    const composed = composeDirectorShotFinalPrompt(nextShot, style, {
      stylePresetId: state.stylePresetId,
    });
    if (composed) nextShot = { ...nextShot, 最终提示词: composed };
  } else if (shouldAutoSyncDirectorFinalPrompt(nextShot['最终提示词'])) {
    const composed = composeDirectorShotFinalPrompt(nextShot, style, {
      stylePresetId: state.stylePresetId,
    });
    if (composed) nextShot = { ...nextShot, 最终提示词: composed };
  } else {
    nextShot = { ...nextShot, 最终提示词: String(shot0['最终提示词'] || '') };
  }

  const refs = orderedAssetsWithImages(state);
  const indices = resolveShotBindingIndices(
    { ...state, shots: state.shots.map((s, i) => (i === rowIndex ? nextShot : s)) },
    nextShot,
    rowIndex,
  );
  const basePrompt = String(nextShot['最终提示词'] || '').trim();
  if (basePrompt && refs.length) {
    nextShot = {
      ...nextShot,
      最终提示词: applyDirectorShotAssetBindingIndices(basePrompt, nextShot, refs, indices, {
        styleUrl: resolveDirectorStyleReferenceImageUrl(state.stylePresetId, state.styleReferenceImageUrl),
      }),
    };
  }

  let next: DirectorPipelineState = createDefaultDirectorPipelineState({
    ...state,
    shots: state.shots.map((s, i) => (i === rowIndex ? nextShot : s)),
  });

  next = markDirectorShotPromptsSynced(next, shotNo, {
    descManual: forceDesc,
    framingManual: forceFraming,
    lipsyncActionManual: forceLipsync,
    finalPromptManual: !keepFinalManual,
  });

  if (opts.clearOptimized) {
    const composedPrompt = String(nextShot['最终提示词'] || '').trim();
    const prevSb = getDirectorShotStoryboard(next, shotNo);
    next = createDefaultDirectorPipelineState({
      ...next,
      storyboardsByShotNo: {
        ...(next.storyboardsByShotNo || {}),
        [shotNo]: {
          ...prevSb,
          promptOriginal: composedPrompt,
          promptOptimized: '',
          promptOptimizedFrom: '',
          useOptimizedPrompt: false,
        },
      },
    });
  }

  return next;
}

/**
 * 用最新剧本剧情表更新单镜：画面/机位/对口型动作/最终提示词 + @图片 匹配。
 * 尊重 finalPromptManual / descManual / framingManual / lipsyncActionManual。
 * 不修改 storyboard 的 imageUrl / videoUrl 等生成结果。
 */
export function applyDirectorMvStaleScriptUpdateToShot(
  state: DirectorPipelineState,
  rowIndex: number,
): DirectorPipelineState {
  return syncDirectorShotPromptFromScript(state, rowIndex);
}

/** 批量：更新所有过期镜（仍不重跑图/视频） */
export function applyDirectorMvStaleScriptUpdateToAllStaleShots(
  state: DirectorPipelineState,
): DirectorPipelineState {
  let next = state;
  for (let i = 0; i < (state.shots || []).length; i++) {
    const no = String(state.shots[i]?.['镜号'] || i + 1).trim() || String(i + 1);
    if (!isDirectorShotPromptsStale(next, no)) continue;
    next = applyDirectorMvStaleScriptUpdateToShot(next, i);
  }
  return next;
}

/**
 * 用户明确点「从脚本重出」：强制用剧情表 + 镜头脚本重拼最终提示词，
 * 清空优化稿与 finalPromptManual。不重跑分镜图、成片。
 */
export function rebuildDirectorShotPromptFromScript(
  state: DirectorPipelineState,
  rowIndex: number,
): DirectorPipelineState {
  return syncDirectorShotPromptFromScript(state, rowIndex, {
    forceFinalPrompt: true,
    clearOptimized: true,
  });
}

/** 对全部镜头从脚本重出提示词（仍不重跑图/视频） */
export function rebuildDirectorAllShotPromptsFromScript(
  state: DirectorPipelineState,
): DirectorPipelineState {
  let next = state;
  for (let i = 0; i < (state.shots || []).length; i++) {
    next = rebuildDirectorShotPromptFromScript(next, i);
  }
  return next;
}
