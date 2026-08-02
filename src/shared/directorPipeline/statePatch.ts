import {
  applyDirectorMvCastPlan,
  coerceDirectorMvAspectRatio,
  createDefaultDirectorPipelineState,
  createEmptyDirectorShot,
  flattenDirectorAssets,
  normalizeDirectorMvMusic,
  normalizeDirectorMvStoryAnalysis,
  type DirectorAsset,
  type DirectorAssetsBag,
  type DirectorAssetsStep,
  type DirectorMode,
  type DirectorMvAspectRatio,
  type DirectorMvCastPlan,
  type DirectorMvMusic,
  type DirectorMvStoryAnalysis,
  type DirectorPhase,
  type DirectorPipelineState,
  type DirectorShot,
  type DirectorShotColumnKey,
  type DirectorShotStoryboard,
} from './schema.js';
import type {
  NormalizeDirectorAssetsResult,
  NormalizeDirectorPromptsResult,
  NormalizeDirectorShotsResult,
} from './normalize.js';
import { withComposedDirectorFinalPrompts, composeDirectorShotFinalPrompt, canRecomposeDirectorFinalPrompt } from './composeFinalPrompt.js';
import { resolveDirectorStylePrompt } from './stylePresets.js';
import { bindDirectorShotAssetRefs } from './bindAssetRefs.js';

export function applyDirectorShotsPatch(
  prev: DirectorPipelineState,
  normalized: NormalizeDirectorShotsResult,
): DirectorPipelineState {
  if (!normalized.ok) {
    return createDefaultDirectorPipelineState({
      ...prev,
      error: normalized.error,
      isGenerating: false,
    });
  }
  const style = resolveDirectorStylePrompt(prev.stylePresetId, prev.globalStyle);
  return createDefaultDirectorPipelineState({
    ...prev,
    title: normalized.title || prev.title,
    shots: withComposedDirectorFinalPrompts(normalized.shots, style, true),
    phase: 'shots',
    error: '',
    isGenerating: false,
  });
}

export function applyDirectorAssetsPatch(
  prev: DirectorPipelineState,
  normalized: NormalizeDirectorAssetsResult,
): DirectorPipelineState {
  if (!normalized.ok) {
    return createDefaultDirectorPipelineState({
      ...prev,
      error: normalized.error,
      isGenerating: false,
    });
  }
  const selectedAssetIds = flattenDirectorAssets(normalized.assets).map((a) => a.id);
  return createDefaultDirectorPipelineState({
    ...prev,
    globalStyle: String(prev.globalStyle || '').trim() || normalized.globalStyle || '',
    stylePresetId: prev.stylePresetId,
    assets: normalized.assets,
    selectedAssetIds,
    phase: 'assets',
    assetsStep: 'characters',
    error: '',
    isGenerating: false,
  });
}

export function applyDirectorPromptsPatch(
  prev: DirectorPipelineState,
  normalized: NormalizeDirectorPromptsResult,
): DirectorPipelineState {
  if (!normalized.ok) {
    return createDefaultDirectorPipelineState({
      ...prev,
      error: normalized.error,
      isGenerating: false,
    });
  }
  const orderedRefs = getOrderedAssetsWithImages(prev);
  const shots = prev.shots.map((shot, i) => {
    const no = String(shot['镜号'] || i + 1);
    const rawPrompt =
      normalized.promptsByShotNo[no] ||
      normalized.promptsByShotNo[String(i + 1)] ||
      shot['最终提示词'] ||
      '';
    const prompt = bindDirectorShotAssetRefs(String(rawPrompt || ''), shot, orderedRefs);
    return { ...shot, 最终提示词: prompt || '' };
  });
  return createDefaultDirectorPipelineState({
    ...prev,
    shots,
    phase: 'prompts',
    error: '',
    isGenerating: false,
  });
}

export function updateDirectorShotCell(
  state: DirectorPipelineState,
  rowIndex: number,
  columnKey: DirectorShotColumnKey,
  value: string,
): DirectorPipelineState {
  if (rowIndex < 0 || rowIndex >= state.shots.length) return state;
  const style = resolveDirectorStylePrompt(state.stylePresetId, state.globalStyle);
  const shots = state.shots.map((shot, i) => {
    if (i !== rowIndex) return shot;
    const next = { ...shot, [columnKey]: value } as DirectorShot;
    if (
      columnKey !== '最终提示词' &&
      canRecomposeDirectorFinalPrompt(shot['最终提示词'])
    ) {
      next['最终提示词'] = composeDirectorShotFinalPrompt(next, style);
    }
    return next;
  });
  return createDefaultDirectorPipelineState({ ...state, shots });
}

export function addDirectorShot(state: DirectorPipelineState): DirectorPipelineState {
  const shots = [...state.shots, createEmptyDirectorShot(state.shots.length)];
  return createDefaultDirectorPipelineState({ ...state, shots });
}

/** 按当前镜头顺序收集分镜板，便于删插后按新镜号重排 */
function orderedStoryboardsForShots(
  shots: DirectorShot[],
  boards: Record<string, DirectorShotStoryboard> | undefined,
): Array<DirectorShotStoryboard | undefined> {
  const map = boards || {};
  return (shots || []).map((shot, i) => {
    const no = String(shot['镜号'] || i + 1).trim() || String(i + 1);
    if (map[no]) return map[no];
    const norm = no.replace(/^镜\s*/i, '').replace(/^0+(\d)/, '$1');
    if (map[norm]) return map[norm];
    for (const [k, v] of Object.entries(map)) {
      const kn = String(k || '')
        .trim()
        .replace(/^镜\s*/i, '')
        .replace(/^0+(\d)/, '$1');
      if (kn && kn === norm) return v;
    }
    return undefined;
  });
}

function renumberShotsWithStoryboards(
  shots: DirectorShot[],
  orderedBoards: Array<DirectorShotStoryboard | undefined>,
): Pick<DirectorPipelineState, 'shots' | 'storyboardsByShotNo'> {
  const storyboardsByShotNo: Record<string, DirectorShotStoryboard> = {};
  const nextShots = (shots || []).map((shot, i) => {
    const no = String(i + 1);
    const board = orderedBoards[i];
    if (board) storyboardsByShotNo[no] = board;
    return { ...shot, 镜号: no };
  });
  return { shots: nextShots, storyboardsByShotNo };
}

/** 删除一行镜头；镜号与分镜板键同步重排 */
export function removeDirectorShot(
  state: DirectorPipelineState,
  rowIndex: number,
): DirectorPipelineState {
  if (rowIndex < 0 || rowIndex >= state.shots.length) return state;
  const orderedBoards = orderedStoryboardsForShots(state.shots, state.storyboardsByShotNo);
  const nextShots = state.shots.filter((_, i) => i !== rowIndex);
  const nextBoards = orderedBoards.filter((_, i) => i !== rowIndex);
  const remapped = renumberShotsWithStoryboards(nextShots, nextBoards);
  return createDefaultDirectorPipelineState({ ...state, ...remapped });
}

/** 在 atIndex 位置插入空镜头（0 = 表首；length = 表尾）；镜号与分镜板键同步重排 */
export function insertDirectorShot(
  state: DirectorPipelineState,
  atIndex: number,
): DirectorPipelineState {
  const len = state.shots.length;
  const idx = Math.max(0, Math.min(Math.floor(atIndex), len));
  const orderedBoards = orderedStoryboardsForShots(state.shots, state.storyboardsByShotNo);
  const nextShots = [
    ...state.shots.slice(0, idx),
    createEmptyDirectorShot(idx),
    ...state.shots.slice(idx),
  ];
  const nextBoards: Array<DirectorShotStoryboard | undefined> = [
    ...orderedBoards.slice(0, idx),
    undefined,
    ...orderedBoards.slice(idx),
  ];
  const remapped = renumberShotsWithStoryboards(nextShots, nextBoards);
  return createDefaultDirectorPipelineState({ ...state, ...remapped });
}

/** 拖拽调整镜头行顺序；镜号与分镜板键同步重排 */
export function reorderDirectorShot(
  state: DirectorPipelineState,
  fromIndex: number,
  toIndex: number,
): DirectorPipelineState {
  const len = state.shots.length;
  if (
    fromIndex < 0 ||
    fromIndex >= len ||
    toIndex < 0 ||
    toIndex >= len ||
    fromIndex === toIndex
  ) {
    return state;
  }
  const orderedBoards = orderedStoryboardsForShots(state.shots, state.storyboardsByShotNo);
  const nextShots = [...state.shots];
  const nextBoards = [...orderedBoards];
  const [movedShot] = nextShots.splice(fromIndex, 1);
  const [movedBoard] = nextBoards.splice(fromIndex, 1);
  if (!movedShot) return state;
  nextShots.splice(toIndex, 0, movedShot);
  nextBoards.splice(toIndex, 0, movedBoard);
  const remapped = renumberShotsWithStoryboards(nextShots, nextBoards);
  return createDefaultDirectorPipelineState({ ...state, ...remapped });
}

export function setDirectorPhase(
  state: DirectorPipelineState,
  phase: DirectorPhase,
): DirectorPipelineState {
  const assetsStepPatch =
    phase === 'assets'
      ? {
          // MV：角色已在选角确定，资产步只做场景九宫格
          assetsStep: state.mode === 'mv' ? ('scenes' as const) : ('characters' as const),
        }
      : {};
  return createDefaultDirectorPipelineState({
    ...state,
    phase,
    ...assetsStepPatch,
  });
}

export function setDirectorMode(
  state: DirectorPipelineState,
  mode: DirectorMode,
): DirectorPipelineState {
  const nextMode = mode === 'mv' ? 'mv' : 'script';
  return createDefaultDirectorPipelineState({
    ...state,
    mode: nextMode,
    phase: nextMode === 'mv' ? 'music' : 'shots',
    title:
      state.title === '导演' || state.title === 'MV导演' || !String(state.title || '').trim()
        ? nextMode === 'mv'
          ? 'MV导演'
          : '导演'
        : state.title,
  });
}

export function patchDirectorMvMusic(
  state: DirectorPipelineState,
  patch: Partial<DirectorMvMusic>,
): DirectorPipelineState {
  return createDefaultDirectorPipelineState({
    ...state,
    mvMusic: normalizeDirectorMvMusic({ ...state.mvMusic, ...patch }),
  });
}

export function patchDirectorMvStoryAnalysis(
  state: DirectorPipelineState,
  patch: Partial<DirectorMvStoryAnalysis>,
): DirectorPipelineState {
  return createDefaultDirectorPipelineState({
    ...state,
    mvStoryAnalysis: normalizeDirectorMvStoryAnalysis({ ...state.mvStoryAnalysis, ...patch }),
  });
}

/** MV 剧本步：参考生成开关 / 参考正文 */
export function patchDirectorMvScriptInput(
  state: DirectorPipelineState,
  patch: { mvScriptUseReferenceGen?: boolean; mvScriptReference?: string },
): DirectorPipelineState {
  return createDefaultDirectorPipelineState({
    ...state,
    ...(typeof patch.mvScriptUseReferenceGen === 'boolean'
      ? { mvScriptUseReferenceGen: patch.mvScriptUseReferenceGen }
      : {}),
    ...(typeof patch.mvScriptReference === 'string'
      ? { mvScriptReference: patch.mvScriptReference }
      : {}),
  });
}

/** MV：近景特写开关（剧本步 UI；分镜/视频逻辑共用同一字段） */
export function setDirectorMvCloseUpFraming(
  state: DirectorPipelineState,
  on: boolean,
): DirectorPipelineState {
  return createDefaultDirectorPipelineState({
    ...state,
    mvCloseUpFraming: !!on,
  });
}

export function patchDirectorMvCastPlan(
  state: DirectorPipelineState,
  patch: Partial<DirectorMvCastPlan>,
): DirectorPipelineState {
  return applyDirectorMvCastPlan(state, patch);
}

export function setDirectorMvAspectRatio(
  state: DirectorPipelineState,
  ratio: DirectorMvAspectRatio | string,
): DirectorPipelineState {
  const mvAspectRatio = coerceDirectorMvAspectRatio(ratio);
  return createDefaultDirectorPipelineState({
    ...state,
    mvAspectRatio,
    videoBatchAspectRatio: mvAspectRatio,
    imageAspectRatio: mvAspectRatio,
  });
}

export function setDirectorAssetsStep(
  state: DirectorPipelineState,
  assetsStep: DirectorAssetsStep,
): DirectorPipelineState {
  return createDefaultDirectorPipelineState({
    ...state,
    phase: 'assets',
    assetsStep,
  });
}

export function updateDirectorAsset(
  state: DirectorPipelineState,
  assetId: string,
  patch: Partial<DirectorAsset>,
): DirectorPipelineState {
  const mapList = (list: DirectorAsset[]) =>
    list.map((a) => (a.id === assetId ? { ...a, ...patch, id: a.id, kind: a.kind } : a));
  const assets: DirectorAssetsBag = {
    characters: mapList(state.assets.characters),
    scenes: mapList(state.assets.scenes),
    props: mapList(state.assets.props),
  };
  return createDefaultDirectorPipelineState({ ...state, assets });
}

/** 删除角色 / 场景 / 道具卡 */
export function removeDirectorAsset(
  state: DirectorPipelineState,
  assetId: string,
): DirectorPipelineState {
  const id = String(assetId || '').trim();
  if (!id) return state;
  const filterList = (list: DirectorAsset[]) => (list || []).filter((a) => a.id !== id);
  const assets: DirectorAssetsBag = {
    characters: filterList(state.assets.characters),
    scenes: filterList(state.assets.scenes),
    props: filterList(state.assets.props),
  };
  const selectedAssetIds = (state.selectedAssetIds || []).filter((x) => x !== id);
  return createDefaultDirectorPipelineState({ ...state, assets, selectedAssetIds });
}

export function setSelectedDirectorAssetIds(
  state: DirectorPipelineState,
  ids: string[],
): DirectorPipelineState {
  const allIds = new Set(flattenDirectorAssets(state.assets).map((a) => a.id));
  const selectedAssetIds = [...new Set(ids.filter((id) => allIds.has(id)))];
  return createDefaultDirectorPipelineState({ ...state, selectedAssetIds });
}

export function getOrderedAssetsWithImages(state: DirectorPipelineState): DirectorAsset[] {
  return flattenDirectorAssets(state.assets).filter((a) => String(a.imageUrl || '').trim());
}

export function updateDirectorShotStoryboard(
  state: DirectorPipelineState,
  shotNo: string,
  patch: Partial<DirectorShotStoryboard>,
): DirectorPipelineState {
  const key = String(shotNo || '').trim();
  if (!key) return state;
  const prev = state.storyboardsByShotNo?.[key] || {
    imageUrl: '',
    status: 'pending' as const,
  };
  const next: DirectorShotStoryboard = {
    ...prev,
    ...patch,
    imageUrl: patch.imageUrl !== undefined ? String(patch.imageUrl || '').trim() : prev.imageUrl,
  };
  if (next.imageUrl && next.status === 'pending') {
    next.status = 'ready';
  }
  return createDefaultDirectorPipelineState({
    ...state,
    storyboardsByShotNo: {
      ...(state.storyboardsByShotNo || {}),
      [key]: next,
    },
  });
}
