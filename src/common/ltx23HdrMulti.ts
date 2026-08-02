/** LTX2.3 高动态（多图视频控制）RunningHub AI App */

export const LTX23_HDR_MULTI_APP_ID = '2063811739870916610';

export const LTX23_HDR_MAX_STORYBOARD = 4;

/** RunningHub 工作流 ImageResizeKJv2 要求 image1、image2 均有图（空槽会 805） */
export const LTX23_HDR_MIN_STORYBOARD = 2;

/** 分镜图顺序 → RH 工作流节点 */
export const LTX23_HDR_STORYBOARD_NODES = [
  { nodeId: '29', description: 'image1' },
  { nodeId: '40', description: 'image2' },
  { nodeId: '30', description: 'image3' },
  { nodeId: '84', description: 'image4' },
] as const;

/** 固定 4 个分镜槽位，未填则为 ''；并去掉与背景或彼此重复的 URL（只保留首次出现） */
export function normalizeLtx23HdrStoryboardSlots(
  storyboard: string[],
  background?: string,
): string[] {
  const bg = String(background || '').trim();
  const seen = new Set<string>(bg ? [bg] : []);
  const result: string[] = [];
  for (let i = 0; i < LTX23_HDR_MAX_STORYBOARD; i++) {
    const t = String((storyboard || [])[i] || '').trim();
    if (!t || seen.has(t)) {
      result.push('');
      continue;
    }
    seen.add(t);
    result.push(t);
  }
  return result;
}

/** 去重并保持顺序 */
export function uniqueUrlsPreserveOrder(urls: string[], limit = LTX23_HDR_MAX_STORYBOARD + 1): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const u of urls || []) {
    const t = String(u || '').trim();
    if (!t || seen.has(t)) continue;
    seen.add(t);
    out.push(t);
    if (out.length >= limit) break;
  }
  return out;
}

/** 从画布连线收集的 URL 拆分为背景 + 分镜（最多 1+4）；未指定背景时首张作背景 */
export function splitLtx23HdrMultiImagesFromCollected(
  collected: string[],
  existingBackground?: string,
): { background: string; storyboard: string[] } {
  const all = uniqueUrlsPreserveOrder(collected, LTX23_HDR_MAX_STORYBOARD + 1);
  let bg = String(existingBackground || '').trim();
  if (bg && !all.includes(bg)) bg = '';
  if (!bg && all.length >= 1) bg = all[0];
  const storyboard = normalizeLtx23HdrStoryboardSlots(
    all.filter((u) => u !== bg),
    bg,
  );
  return { background: bg, storyboard };
}

/**
 * 合并连线收集的图片到背景+分镜槽：保留用户拖拽后的槽位顺序与空槽，只增删 URL。
 * 避免边同步按连线顺序把面板排序冲掉。
 */
export function mergeLtx23HdrMultiPreserveOrder(
  currentBackground: string | undefined,
  currentStoryboard: string[] | undefined,
  collectedFromEdges: string[],
): { background: string; storyboard: string[] } {
  const collected = uniqueUrlsPreserveOrder(collectedFromEdges, LTX23_HDR_MAX_STORYBOARD + 1);
  const collectedSet = new Set(collected);

  const hadLayout =
    !!String(currentBackground || '').trim() ||
    (currentStoryboard || []).some((u) => !!String(u || '').trim());

  if (!hadLayout) {
    return splitLtx23HdrMultiImagesFromCollected(collected, currentBackground);
  }

  let bg = String(currentBackground || '').trim();
  if (bg && !collectedSet.has(bg)) bg = '';

  let storyboard = normalizeLtx23HdrStoryboardSlots(currentStoryboard || [], bg).map((u) => {
    const t = String(u || '').trim();
    if (!t) return '';
    return collectedSet.has(t) ? t : '';
  });
  storyboard = normalizeLtx23HdrStoryboardSlots(storyboard, bg);

  const present = new Set<string>([bg, ...storyboard].filter(Boolean));
  for (const url of collected) {
    if (present.has(url)) continue;
    if (!bg) {
      bg = url;
      present.add(url);
      continue;
    }
    const emptyIdx = storyboard.findIndex((s) => !s);
    if (emptyIdx < 0) break;
    storyboard[emptyIdx] = url;
    present.add(url);
  }

  if (!bg) {
    const firstIdx = storyboard.findIndex((s) => !!s);
    if (firstIdx >= 0) {
      bg = storyboard[firstIdx];
      storyboard[firstIdx] = '';
    }
  }

  return { background: bg, storyboard: normalizeLtx23HdrStoryboardSlots(storyboard, bg) };
}

/** 5 槽扁平视图：0=背景，1–4=分镜（保证无重复 URL） */
export function flattenLtx23HdrSlots(background: string, storyboard: string[]): string[] {
  const bg = String(background || '').trim();
  return [bg, ...normalizeLtx23HdrStoryboardSlots(storyboard, bg)];
}

/** 从 5 槽扁平数组写回背景 + 分镜（自动去重） */
export function unflattenLtx23HdrSlots(slots: string[]): { background: string; storyboard: string[] } {
  const list = (slots || []).map((u) => String(u || '').trim());
  while (list.length < LTX23_HDR_MAX_STORYBOARD + 1) list.push('');
  const seen = new Set<string>();
  const deduped = list.slice(0, LTX23_HDR_MAX_STORYBOARD + 1).map((t) => {
    if (!t || seen.has(t)) return '';
    seen.add(t);
    return t;
  });
  const background = deduped[0] || '';
  return {
    background,
    storyboard: normalizeLtx23HdrStoryboardSlots(deduped.slice(1), background),
  };
}

/** 互换两个槽位（含背景与空槽） */
export function swapLtx23HdrFlatSlots(slots: string[], fromIndex: number, toIndex: number): string[] {
  const next = (slots || []).map((u) => String(u || '').trim());
  while (next.length < LTX23_HDR_MAX_STORYBOARD + 1) next.push('');
  const max = LTX23_HDR_MAX_STORYBOARD;
  const a = Math.max(0, Math.min(fromIndex, max));
  const b = Math.max(0, Math.min(toIndex, max));
  if (a === b) return next.slice(0, max + 1);
  const tmp = next[a];
  next[a] = next[b];
  next[b] = tmp;
  return next.slice(0, max + 1);
}

/** 提交 payload：背景 + 分镜固定 4 槽位（空槽为 ''） */
export function buildLtx23HdrMultiPayload(
  background: string,
  storyboard: string[],
): { background: string; storyboardSlots: string[] } {
  const bg = String(background || '').trim();
  return {
    background: bg,
    storyboardSlots: normalizeLtx23HdrStoryboardSlots(storyboard, bg),
  };
}

export function validateLtx23HdrMultiInputs(
  background: string,
  storyboard: string[],
): { ok: true } | { ok: false; error: string } {
  const bg = String(background || '').trim();
  const { storyboardSlots } = buildLtx23HdrMultiPayload(background, storyboard);
  const filledStoryboard = storyboardSlots.filter((u) => !!u);
  if (!bg) {
    return { ok: false, error: 'LTX2.3 MSR 需要 1 张背景图，请在面板中指定背景。' };
  }
  if (filledStoryboard.length < LTX23_HDR_MIN_STORYBOARD) {
    return {
      ok: false,
      error: `LTX2.3 MSR 需要 1 张背景 + 至少 ${LTX23_HDR_MIN_STORYBOARD} 张分镜（分镜 1、分镜 2 必填；工作流 ImageResize 节点不接受空图）。`,
    };
  }
  if (filledStoryboard.length > LTX23_HDR_STORYBOARD_NODES.length) {
    return {
      ok: false,
      error: `LTX2.3 MSR 最多支持 ${LTX23_HDR_STORYBOARD_NODES.length} 张分镜图，当前 ${filledStoryboard.length} 张。`,
    };
  }
  return { ok: true };
}

/** 1 张背景 + 至少 2 张分镜（image1、image2）已填时可运行 */
export function isLtx23HdrMultiRunnable(background: string, storyboard: string[]): boolean {
  return validateLtx23HdrMultiInputs(background, storyboard).ok;
}

/** 与 LTX2.3 文生视频相同的宽高换算 */
export function ltx23HdrMultiDimensions(
  aspectRatio: '16:9' | '9:16' | string | undefined,
  resolution: '720' | '1280' | '1920' | string | undefined,
): { width: number; height: number } {
  const ratio = aspectRatio === '9:16' ? '9:16' : '16:9';
  const res = resolution === '1280' || resolution === '1920' ? resolution : '720';
  if (res === '720') return ratio === '16:9' ? { width: 1280, height: 720 } : { width: 720, height: 1280 };
  if (res === '1280') return ratio === '16:9' ? { width: 1280, height: 720 } : { width: 720, height: 1280 };
  return ratio === '16:9' ? { width: 1920, height: 1080 } : { width: 1080, height: 1920 };
}
