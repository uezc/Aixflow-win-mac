/** 画布点选模式（角色库 / 数字人库弹窗共用），供节点内 stopPropagation 判断 */

export type CanvasPickTarget =
  | 'avatar'
  | 'voice'
  | 'view'
  | 'sceneNormal'
  | 'sceneDisplay3d'
  | 'digitalHumanVideo';

let pickActive = false;
let pickTarget: CanvasPickTarget = 'avatar';

export function syncCanvasPickState(active: boolean, target: CanvasPickTarget = 'avatar'): void {
  pickActive = active;
  pickTarget = target;
}

export function readCanvasPickState(): { active: boolean; target: CanvasPickTarget } {
  return { active: pickActive, target: pickTarget };
}

export function isCanvasPickVoiceTarget(): boolean {
  return pickActive && pickTarget === 'voice';
}

export function isCanvasPickDigitalHumanVideoTarget(): boolean {
  return pickActive && pickTarget === 'digitalHumanVideo';
}

/** 音频/视频节点在点选模式下主动通知 Workspace 完成选取（绕过内部 stopPropagation） */
export const CANVAS_PICK_NODE_EVENT = 'nexflow-canvas-pick-node';

export function dispatchCanvasPickNode(nodeId: string): void {
  if (!pickActive || !nodeId) return;
  window.dispatchEvent(new CustomEvent(CANVAS_PICK_NODE_EVENT, { detail: { nodeId } }));
}
