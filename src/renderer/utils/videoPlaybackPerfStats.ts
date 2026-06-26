/**
 * 视频播放性能调试统计（开发/验收用）
 * 启用：localStorage.setItem('nexflow_video_perf_debug', '1') 后刷新
 * 查看：window.__nexflowVideoPerfStats?.()
 * 重置：window.__nexflowVideoPerfStatsReset?.()
 */

const DEBUG_KEY = 'nexflow_video_perf_debug';

export function isVideoPlaybackPerfDebugEnabled(): boolean {
  return typeof localStorage !== 'undefined' && localStorage.getItem(DEBUG_KEY) === '1';
}

export function enableVideoPlaybackPerfDebug(): void {
  if (typeof localStorage !== 'undefined') localStorage.setItem(DEBUG_KEY, '1');
}

export function disableVideoPlaybackPerfDebug(): void {
  if (typeof localStorage !== 'undefined') localStorage.removeItem(DEBUG_KEY);
}

type PerfSnapshot = {
  playbackPersistCalls: number;
  setNodesPlaybackCalls: number;
  videoNodeRenders: Record<string, number>;
  videoNodeRenderTotal: number;
  sessionStartedAt: number;
};

const stats: PerfSnapshot = {
  playbackPersistCalls: 0,
  setNodesPlaybackCalls: 0,
  videoNodeRenders: {},
  videoNodeRenderTotal: 0,
  sessionStartedAt: Date.now(),
};

export function resetVideoPlaybackPerfStats(): void {
  stats.playbackPersistCalls = 0;
  stats.setNodesPlaybackCalls = 0;
  stats.videoNodeRenders = {};
  stats.videoNodeRenderTotal = 0;
  stats.sessionStartedAt = Date.now();
}

export function recordPlaybackPersistCall(source: string): void {
  if (!isVideoPlaybackPerfDebugEnabled()) return;
  stats.playbackPersistCalls += 1;
  if (typeof console !== 'undefined' && console.debug) {
    console.debug('[VideoPerf] playbackPersist', stats.playbackPersistCalls, source);
  }
}

export function recordSetNodesPlaybackCall(nodeId: string): void {
  if (!isVideoPlaybackPerfDebugEnabled()) return;
  stats.setNodesPlaybackCalls += 1;
  if (typeof console !== 'undefined' && console.debug) {
    console.debug('[VideoPerf] setNodes(playbackCurrentTimeSec)', stats.setNodesPlaybackCalls, nodeId);
  }
}

export function recordVideoNodeRender(nodeId: string): void {
  if (!isVideoPlaybackPerfDebugEnabled()) return;
  stats.videoNodeRenderTotal += 1;
  stats.videoNodeRenders[nodeId] = (stats.videoNodeRenders[nodeId] ?? 0) + 1;
}

export function getVideoPlaybackPerfSnapshot(): PerfSnapshot & { elapsedSec: number } {
  return {
    ...stats,
    elapsedSec: (Date.now() - stats.sessionStartedAt) / 1000,
  };
}

export function installVideoPlaybackPerfDebugGlobals(): void {
  if (typeof window === 'undefined') return;
  const w = window as Window & {
    __nexflowVideoPerfStats?: () => ReturnType<typeof getVideoPlaybackPerfSnapshot>;
    __nexflowVideoPerfStatsReset?: () => void;
    __nexflowVideoPerfDebugOn?: () => void;
    __nexflowVideoPerfDebugOff?: () => void;
  };
  w.__nexflowVideoPerfStats = getVideoPlaybackPerfSnapshot;
  w.__nexflowVideoPerfStatsReset = resetVideoPlaybackPerfStats;
  w.__nexflowVideoPerfDebugOn = enableVideoPlaybackPerfDebug;
  w.__nexflowVideoPerfDebugOff = disableVideoPlaybackPerfDebug;
}
