/**
 * 语音听写「占用」门闩：多组件共用，用引用计数避免互相踩 true/false。
 * Workspace 在听写中会跳过 pane/selection，避免松手选中被清掉。
 */

let depth = 0;

function syncWindowFlag(): void {
  if (typeof window === 'undefined') return;
  (window as Window & { __nexflowVoiceModalOpen?: boolean }).__nexflowVoiceModalOpen = depth > 0;
}

export function acquireVoiceModalLock(): void {
  depth += 1;
  syncWindowFlag();
}

export function releaseVoiceModalLock(): void {
  depth = Math.max(0, depth - 1);
  syncWindowFlag();
}

/** 取消 LLM / 导演等异常路径：强制清零，避免听写卡死导致画布/话筒失效 */
export function forceClearVoiceModalLock(): void {
  depth = 0;
  syncWindowFlag();
}

export function isVoiceModalLocked(): boolean {
  return depth > 0;
}
