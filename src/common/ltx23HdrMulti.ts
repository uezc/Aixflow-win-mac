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

/** 固定 4 个分镜槽位，未填则为 '' */
export function normalizeLtx23HdrStoryboardSlots(storyboard: string[]): string[] {
  const slots = (storyboard || []).map((u) => String(u || '').trim());
  const result: string[] = [];
  for (let i = 0; i < LTX23_HDR_MAX_STORYBOARD; i++) {
    result.push(slots[i] || '');
  }
  return result;
}

/** 从画布连线收集的 URL 拆分为背景 + 分镜（最多 1+4）；未指定背景时首张作背景 */
export function splitLtx23HdrMultiImagesFromCollected(
  collected: string[],
  existingBackground?: string,
): { background: string; storyboard: string[] } {
  const all = collected.filter(Boolean).slice(0, LTX23_HDR_MAX_STORYBOARD + 1);
  let bg = String(existingBackground || '').trim();
  if (bg && !all.includes(bg)) bg = '';
  if (!bg && all.length >= 1) bg = all[0];
  const storyboard = normalizeLtx23HdrStoryboardSlots(all.filter((u) => u !== bg));
  return { background: bg, storyboard };
}

/** 提交 payload：背景 + 分镜固定 4 槽位（空槽为 ''） */
export function buildLtx23HdrMultiPayload(
  background: string,
  storyboard: string[],
): { background: string; storyboardSlots: string[] } {
  return {
    background: String(background || '').trim(),
    storyboardSlots: normalizeLtx23HdrStoryboardSlots(storyboard),
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
