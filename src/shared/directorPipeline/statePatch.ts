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
  getDirectorShotStoryboard,
  mergeDirectorShotStoryboardImageHistory,
  mergeDirectorShotVideoHistory,
  replaceDirectorShotVideoUrlInPlace,
  directorMediaUrlKey,
  resolveDirectorStoryboardStorageKey,
} from './schema.js';
import type {
  NormalizeDirectorAssetsResult,
  NormalizeDirectorPromptsResult,
  NormalizeDirectorShotsResult,
} from './normalize.js';
import { withComposedDirectorFinalPrompts, composeDirectorShotFinalPrompt, canRecomposeDirectorFinalPrompt } from './composeFinalPrompt.js';
import { resolveDirectorStylePrompt, resolveDirectorStyleReferenceImageUrl } from './stylePresets.js';
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
    shots: withComposedDirectorFinalPrompts(normalized.shots, style, true, {
      shotChangePace: prev.mvMusic?.shotChangePace,
      stylePresetId: prev.stylePresetId,
    }),
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
    const prompt = bindDirectorShotAssetRefs(String(rawPrompt || ''), shot, orderedRefs, {
      styleUrl: resolveDirectorStyleReferenceImageUrl(prev.stylePresetId, prev.styleReferenceImageUrl),
    });
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
      next['最终提示词'] = composeDirectorShotFinalPrompt(next, style, {
        stylePresetId: state.stylePresetId,
      });
    }
    return next;
  });
  let nextState = createDefaultDirectorPipelineState({ ...state, shots });
  const shotNo = String(shots[rowIndex]?.['镜号'] || rowIndex + 1).trim() || String(rowIndex + 1);
  if (columnKey === '最终提示词') {
    nextState = updateDirectorShotStoryboard(nextState, shotNo, { finalPromptManual: true });
  } else if (columnKey === '画面描述') {
    nextState = updateDirectorShotStoryboard(nextState, shotNo, { descManual: true });
  } else if (
    columnKey === '镜头角度' ||
    columnKey === '焦距' ||
    columnKey === '景别' ||
    columnKey === '运镜' ||
    columnKey === '光影氛围'
  ) {
    nextState = updateDirectorShotStoryboard(nextState, shotNo, { framingManual: true });
  } else if (columnKey === '对口型动作') {
    nextState = updateDirectorShotStoryboard(nextState, shotNo, { lipsyncActionManual: true });
  }
  return nextState;
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

/**
 * 短剧 Domain 增删镜头后：按「旧镜顺序」对齐成片表，再按新镜号写回（含 ep: 键）。
 * op.index = 删除下标，或插入位置（插入时空板 undefined）。
 */
export function remapDramaStoryboardsAfterShotListEdit(
  state: Pick<DirectorPipelineState, 'storyboardsByShotNo' | 'mode' | 'activeDramaEpisodeId'>,
  prevShotNos: string[],
  nextShotNos: string[],
  op: { type: 'remove' | 'insert'; index: number },
): Record<string, DirectorShotStoryboard> {
  const map = { ...(state.storyboardsByShotNo || {}) };
  const ordered: Array<DirectorShotStoryboard | undefined> = prevShotNos.map((no) => {
    const key = resolveDirectorStoryboardStorageKey(state, String(no || '').trim());
    const raw = String(no || '').trim();
    return (key && map[key]) || (raw ? map[raw] : undefined);
  });

  let nextOrdered: Array<DirectorShotStoryboard | undefined>;
  if (op.type === 'remove') {
    nextOrdered = ordered.filter((_, i) => i !== op.index);
  } else {
    const idx = Math.max(0, Math.min(op.index, ordered.length));
    nextOrdered = [...ordered.slice(0, idx), undefined, ...ordered.slice(idx)];
  }
  if (nextOrdered.length !== nextShotNos.length) {
    // 长度异常时保守：不改 map
    return map;
  }

  const ep = String(state.activeDramaEpisodeId || '').trim();
  const next = { ...map };
  if (ep) {
    const prefix = `ep:${ep}:`;
    for (const k of Object.keys(next)) {
      if (k.startsWith(prefix)) delete next[k];
    }
  } else {
    for (const no of prevShotNos) {
      const raw = String(no || '').trim();
      if (raw && !raw.startsWith('ep:')) delete next[raw];
    }
  }

  nextShotNos.forEach((no, i) => {
    const board = nextOrdered[i];
    if (!board) return;
    const key = resolveDirectorStoryboardStorageKey(state, String(no || '').trim());
    if (key) next[key] = board;
  });
  return next;
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
  // MV：角色已在选角确定，资产步只做场景；短剧旧资产步归一到分镜导演
          assetsStep:
            state.mode === 'mv'
              ? ('scenes' as const)
              : ('characters' as const),
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
  const nextMode: DirectorMode = mode === 'drama' ? 'drama' : 'mv';
  const defaultTitle = nextMode === 'mv' ? 'MV导演' : 'AI短剧导演';
  const titleIsDefault =
    !String(state.title || '').trim() ||
    state.title === '导演' ||
    state.title === 'MV导演' ||
    state.title === 'AI短剧导演';
  return createDefaultDirectorPipelineState({
    ...state,
    mode: nextMode,
    phase: nextMode === 'mv' ? 'music' : 'story',
    title: titleIsDefault ? defaultTitle : state.title,
    videoBatchModel:
      nextMode === 'drama'
        ? state.videoBatchModel === 'ltx-2.3-i2v' || !String(state.videoBatchModel || '').trim()
          ? 'minimax-h3-multi'
          : state.videoBatchModel
        : state.videoBatchModel,
    videoBatchLipsyncModel:
      nextMode === 'drama'
        ? state.videoBatchLipsyncModel === 'ltx-2.3-lipsync' ||
          !String(state.videoBatchLipsyncModel || '').trim()
          ? 'minimax-h3-audio'
          : state.videoBatchLipsyncModel
        : state.videoBatchLipsyncModel,
  });
}

export function patchDirectorMvMusic(
  state: DirectorPipelineState,
  patch: Partial<DirectorMvMusic>,
): DirectorPipelineState {
  const prevMusic = normalizeDirectorMvMusic(state.mvMusic);
  const nextMusic = normalizeDirectorMvMusic({ ...prevMusic, ...patch });
  const urlChanged = String(prevMusic.url || '').trim() !== String(nextMusic.url || '').trim();
  const srcChanged = String(prevMusic.sourceNodeId || '') !== String(nextMusic.sourceNodeId || '');
  if (urlChanged || srcChanged) {
    nextMusic.bindRev = Math.max(0, Number(prevMusic.bindRev) || 0) + 1;
  }
  return createDefaultDirectorPipelineState({
    ...state,
    mvMusic: nextMusic,
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
  patch: {
    mvScriptUseReferenceGen?: boolean;
    mvScriptReference?: string;
    mvStoryOutline?: string;
    mvStoryOutlineConfirmed?: boolean;
    mvStoryGenreType?: string;
    mvStoryToneStyle?: string;
    mvStoryEndingType?: string;
  },
): DirectorPipelineState {
  const nextOutline =
    typeof patch.mvStoryOutline === 'string' ? patch.mvStoryOutline : undefined;
  const outlineChanged =
    typeof nextOutline === 'string' &&
    nextOutline.trim() !== String(state.mvStoryOutline || '').trim();
  return createDefaultDirectorPipelineState({
    ...state,
    ...(typeof patch.mvScriptUseReferenceGen === 'boolean'
      ? { mvScriptUseReferenceGen: patch.mvScriptUseReferenceGen }
      : {}),
    ...(typeof patch.mvScriptReference === 'string'
      ? { mvScriptReference: patch.mvScriptReference }
      : {}),
    ...(typeof nextOutline === 'string' ? { mvStoryOutline: nextOutline } : {}),
    ...(typeof patch.mvStoryOutlineConfirmed === 'boolean'
      ? { mvStoryOutlineConfirmed: patch.mvStoryOutlineConfirmed }
      : outlineChanged
        ? { mvStoryOutlineConfirmed: false }
        : {}),
    ...(typeof patch.mvStoryGenreType === 'string'
      ? { mvStoryGenreType: patch.mvStoryGenreType.trim() }
      : {}),
    ...(typeof patch.mvStoryToneStyle === 'string'
      ? { mvStoryToneStyle: patch.mvStoryToneStyle.trim() }
      : {}),
    ...(typeof patch.mvStoryEndingType === 'string'
      ? { mvStoryEndingType: patch.mvStoryEndingType.trim() }
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
    creatures: mapList(state.assets.creatures),
  };
  return createDefaultDirectorPipelineState({ ...state, assets });
}

/** 按 id 写入或追加资产（换装生图会临时挂一条 character 资产） */
export function upsertDirectorAsset(
  state: DirectorPipelineState,
  asset: DirectorAsset,
): DirectorPipelineState {
  const id = String(asset?.id || '').trim();
  if (!id) return state;
  const kind = asset.kind || 'character';
  const key: keyof DirectorAssetsBag =
    kind === 'scene' ? 'scenes' : kind === 'prop' ? 'props' : kind === 'creature' ? 'creatures' : 'characters';
  const list = [...(state.assets[key] || [])];
  const idx = list.findIndex((a) => a.id === id);
  if (idx >= 0) list[idx] = { ...list[idx], ...asset, id, kind: list[idx].kind || kind };
  else list.push({ ...asset, id, kind });
  return createDefaultDirectorPipelineState({
    ...state,
    assets: { ...state.assets, [key]: list },
  });
}

/** 删除角色 / 场景 / 道具 / 生物卡 */
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
    creatures: filterList(state.assets.creatures),
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

/**
 * 合并导演状态时保留已有媒体 URL。
 * 卡死/旧 patch 整包回写时，incoming 常缺 imageUrl/videoUrl；直接 ...spread 会把已生成图/成片冲掉。
 */
export function mergeDirectorMediaPreserve(
  prev: DirectorPipelineState,
  incoming: DirectorPipelineState,
): DirectorPipelineState {
  const pickUrl = (next: string | undefined, old: string | undefined) => {
    const n = String(next || '').trim();
    if (n) return n;
    return String(old || '').trim();
  };
  const mergeAssetList = (
    prevList: DirectorAsset[] | undefined,
    nextList: DirectorAsset[] | undefined,
  ): DirectorAsset[] => {
    const prevMap = new Map((prevList || []).map((a) => [a.id, a]));
    const out = (nextList || []).map((a) => {
      const p = prevMap.get(a.id);
      if (!p) return a;
      const imageUrl = pickUrl(a.imageUrl, p.imageUrl);
      return {
        ...p,
        ...a,
        imageUrl,
        status: imageUrl
          ? a.status === 'generating'
            ? a.status
            : a.status === 'ready' || p.status === 'ready'
              ? 'ready'
              : a.status || p.status
          : a.status || p.status,
      };
    });
    // 短剧：禁止把上一份（常为同画布 MV 导演）多出来的角色/场景图挂回资产库
    if (incoming.mode !== 'drama') {
      for (const p of prevList || []) {
        if (!out.some((a) => a.id === p.id) && String(p.imageUrl || '').trim()) {
          out.push(p);
        }
      }
    }
    return out;
  };

  const prevBoards = prev.storyboardsByShotNo || {};
  const nextBoards = incoming.storyboardsByShotNo || {};
  const boardKeys = new Set([...Object.keys(prevBoards), ...Object.keys(nextBoards)]);
  const storyboardsByShotNo: Record<string, DirectorShotStoryboard> = {};
  for (const key of boardKeys) {
    const p = prevBoards[key];
    const n = nextBoards[key];
    if (!p) {
      storyboardsByShotNo[key] = n!;
      continue;
    }
    if (!n) {
      storyboardsByShotNo[key] =
        incoming.mode === 'drama' ? { ...p, imageUrl: '', status: p.videoStatus === 'ready' ? p.status : 'pending' } : p;
      continue;
    }
    const imageUrl =
      incoming.mode === 'drama'
        ? String(n?.imageUrl || '').trim()
        : pickUrl(n?.imageUrl, p?.imageUrl);
    const videoUrl = pickUrl(n.videoUrl, p.videoUrl);
    const merged: DirectorShotStoryboard = {
      ...p,
      ...n,
      imageUrl,
      ...(videoUrl ? { videoUrl } : p.videoUrl ? { videoUrl: p.videoUrl } : {}),
      status: imageUrl
        ? n.status === 'generating'
          ? n.status
          : 'ready'
        : n.status || p.status,
      videoStatus: videoUrl
        ? n.videoStatus === 'generating' &&
          p.videoStatus === 'ready' &&
          (directorMediaUrlKey(String(n.videoUrl || '')) || String(n.videoUrl || '').trim()) ===
            (directorMediaUrlKey(String(p.videoUrl || '')) || String(p.videoUrl || '').trim())
          ? 'ready'
          : n.videoStatus === 'generating'
            ? n.videoStatus
            : 'ready'
        : n.videoStatus || p.videoStatus,
      videoNodeId: String(n.videoNodeId || p.videoNodeId || '').trim() || undefined,
    };
    // 未查看绿标以 incoming 为准：节点内已清除时勿从 prev 再合并回来
    if (n.storyboardUnseen === true) merged.storyboardUnseen = true;
    else delete merged.storyboardUnseen;
    if (n.videoUnseen === true) merged.videoUnseen = true;
    else delete merged.videoUnseen;
    if (n.promptOptimizedUnseen === true) merged.promptOptimizedUnseen = true;
    else if (n.promptOptimizedUnseen === false) merged.promptOptimizedUnseen = false;
    else if (p.promptOptimizedUnseen === true) merged.promptOptimizedUnseen = true;
    else if (p.promptOptimizedUnseen === false) merged.promptOptimizedUnseen = false;
    else delete merged.promptOptimizedUnseen;
    storyboardsByShotNo[key] = merged;
  }

  const prevAssets = prev.assets || { characters: [], scenes: [], props: [], creatures: [] };
  const nextAssets = incoming.assets || prevAssets;

  return createDefaultDirectorPipelineState({
    ...prev,
    ...incoming,
    assets: {
      characters: mergeAssetList(prevAssets.characters, nextAssets.characters),
      scenes: mergeAssetList(prevAssets.scenes, nextAssets.scenes),
      props: mergeAssetList(prevAssets.props, nextAssets.props),
      creatures: mergeAssetList(prevAssets.creatures, nextAssets.creatures),
    },
    storyboardsByShotNo,
    styleReferenceImageUrl: pickUrl(
      incoming.styleReferenceImageUrl,
      prev.styleReferenceImageUrl,
    ),
  });
}

export function updateDirectorShotStoryboard(
  state: DirectorPipelineState,
  shotNo: string,
  patch: Partial<DirectorShotStoryboard>,
): DirectorPipelineState {
  const key = resolveDirectorStoryboardStorageKey(state, shotNo);
  if (!key) return state;
  // 与 getDirectorShotStoryboard 一致：ep 键空壳时合并裸镜号旧成片，regen 才能归档进 history
  const prev = getDirectorShotStoryboard(state, shotNo);
  const nextUrl =
    patch.imageUrl !== undefined ? String(patch.imageUrl || '').trim() : prev.imageUrl;
  const nextHistory =
    patch.imageUrlHistory !== undefined
      ? [
          ...new Set(
            (patch.imageUrlHistory || []).map((u) => String(u || '').trim()).filter(Boolean),
          ),
        ].filter((u) => u !== nextUrl)
      : patch.imageUrl !== undefined
        ? mergeDirectorShotStoryboardImageHistory(prev, nextUrl)
        : prev.imageUrlHistory;
  const nextVideoUrl =
    patch.videoUrl !== undefined ? String(patch.videoUrl || '').trim() : String(prev.videoUrl || '').trim();
  const patchNodeId = String(patch.videoNodeId || '').trim();
  const prevNodeId = String(prev.videoNodeId || '').trim();
  // 同隐藏视频节点二次写回（先公网后本地）：只替换当前 URL，勿把中间态堆进「选择成片」
  const refineSameGenerationVideo =
    patch.videoUrl !== undefined &&
    !!patchNodeId &&
    !!prevNodeId &&
    patchNodeId === prevNodeId &&
    prev.videoStatus === 'ready';
  const keepCurrentInVideoHistory =
    patch.videoStatus === 'generating' && patch.videoUrl === undefined;
  const nextVideoHistory =
    patch.videoUrlHistory !== undefined
      ? (() => {
          const nextKey = directorMediaUrlKey(nextVideoUrl) || nextVideoUrl;
          const seen = new Set<string>();
          const out: string[] = [];
          for (const raw of patch.videoUrlHistory || []) {
            const u = String(raw || '').trim();
            if (!u) continue;
            const k = directorMediaUrlKey(u) || u;
            // 开始重新生成时允许历史里暂存当前成片，SUCCESS 换 URL 后列表才有上一版
            if (!k || seen.has(k)) continue;
            if (!keepCurrentInVideoHistory && k === nextKey) continue;
            seen.add(k);
            out.push(u);
          }
          return out;
        })()
      : patch.videoUrl !== undefined
        ? refineSameGenerationVideo
          ? replaceDirectorShotVideoUrlInPlace(prev, nextVideoUrl)
          : mergeDirectorShotVideoHistory(prev, nextVideoUrl)
        : prev.videoUrlHistory;
  const next: DirectorShotStoryboard = {
    ...prev,
    ...patch,
    imageUrl: nextUrl,
    ...(nextHistory && nextHistory.length
      ? { imageUrlHistory: nextHistory }
      : { imageUrlHistory: undefined }),
    ...(nextVideoUrl ? { videoUrl: nextVideoUrl } : { videoUrl: undefined }),
    ...(nextVideoHistory && nextVideoHistory.length
      ? { videoUrlHistory: nextVideoHistory }
      : { videoUrlHistory: undefined }),
  };
  if (next.imageUrl && next.status === 'pending') {
    next.status = 'ready';
  }
  const prevImgKey =
    directorMediaUrlKey(String(prev.imageUrl || '').trim()) || String(prev.imageUrl || '').trim();
  const nextImgKey = directorMediaUrlKey(nextUrl) || nextUrl;
  const imageMediaChanged =
    patch.imageUrl !== undefined && !!nextImgKey && nextImgKey !== prevImgKey;
  const prevVidKey =
    directorMediaUrlKey(String(prev.videoUrl || '').trim()) || String(prev.videoUrl || '').trim();
  const nextVidKey = directorMediaUrlKey(nextVideoUrl) || nextVideoUrl;
  const videoMediaChanged =
    patch.videoUrl !== undefined &&
    !refineSameGenerationVideo &&
    !!nextVidKey &&
    nextVidKey !== prevVidKey;
  if (patch.storyboardUnseen !== undefined) {
    if (patch.storyboardUnseen) next.storyboardUnseen = true;
    else delete next.storyboardUnseen;
  } else if (imageMediaChanged) {
    next.storyboardUnseen = true;
  }
  if (patch.videoUnseen !== undefined) {
    if (patch.videoUnseen) next.videoUnseen = true;
    else delete next.videoUnseen;
  } else if (videoMediaChanged) {
    next.videoUnseen = true;
  }
  if (patch.promptOptimizedUnseen !== undefined) {
    next.promptOptimizedUnseen = !!patch.promptOptimizedUnseen;
  } else if (patch.promptOptimized !== undefined) {
    const nextOpt = String(patch.promptOptimized || '').trim();
    const prevOpt = String(prev.promptOptimized || '').trim();
    if (nextOpt && nextOpt !== prevOpt) next.promptOptimizedUnseen = true;
    else if (!nextOpt) next.promptOptimizedUnseen = false;
  }
  if (patch.promptOptimizedFrom !== undefined) {
    const from = String(patch.promptOptimizedFrom || '').trim();
    if (from) next.promptOptimizedFrom = from;
    else delete next.promptOptimizedFrom;
  } else if (patch.promptOptimized !== undefined && !String(patch.promptOptimized || '').trim()) {
    delete next.promptOptimizedFrom;
  }
  return createDefaultDirectorPipelineState({
    ...state,
    storyboardsByShotNo: {
      ...(state.storyboardsByShotNo || {}),
      [key]: next,
    },
  });
}
