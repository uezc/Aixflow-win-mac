import type { Node } from 'reactflow';

/** 与 VideoNode / FlowContent 一致：节点 data.progress 表示生成中 */
export function isVideoNodeGeneratingProgress(progress: unknown): boolean {
  const p = Number(progress ?? 0);
  return Number.isFinite(p) && p > 0 && p < 100;
}

export function readVideoInputPanelProgressFromNode(
  node: Node | null | undefined
): { progress: number; progressMessage?: string } {
  if (!node) return { progress: 0 };
  const p = Number(node.data?.progress ?? 0);
  const progress = Number.isFinite(p) ? p : 0;
  const msg = node.data?.progressMessage;
  return {
    progress,
    ...(typeof msg === 'string' && msg.trim() ? { progressMessage: msg.trim() } : {}),
  };
}
