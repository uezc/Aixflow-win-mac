import { useSyncExternalStore } from 'react';

const playingNodeIds = new Set<string>();
const listeners = new Set<() => void>();

function emit(): void {
  listeners.forEach((fn) => fn());
}

export function setAudioNodePlaying(nodeId: string, playing: boolean): void {
  if (!nodeId) return;
  if (playing) {
    if (playingNodeIds.has(nodeId)) return;
    playingNodeIds.add(nodeId);
  } else {
    if (!playingNodeIds.has(nodeId)) return;
    playingNodeIds.delete(nodeId);
  }
  emit();
}

export function hasPlayingAudioNodes(): boolean {
  return playingNodeIds.size > 0;
}

export function isAudioNodePlaying(nodeId: string): boolean {
  return playingNodeIds.has(nodeId);
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot(): boolean {
  return playingNodeIds.size > 0;
}

/** 任一 AudioNode 正在播放时为 true，用于关闭 React Flow 视口外卸载 */
export function useHasPlayingAudioNodes(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
