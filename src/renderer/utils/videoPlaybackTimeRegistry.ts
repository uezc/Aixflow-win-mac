/**
 * 画布抽帧 / 连线时需读取「此刻」播放头，不能仅依赖节点 data 上的 playbackCurrentTimeSec
 *（该字段在 timeupdate 上 200ms 节流，连续播放时可能明显落后于 <video>.currentTime）。
 */
type PlaybackReader = () => number | undefined;

const readers = new Map<string, PlaybackReader>();

export function registerVideoNodePlaybackReader(nodeId: string, read: PlaybackReader): void {
  readers.set(nodeId, read);
}

export function unregisterVideoNodePlaybackReader(nodeId: string): void {
  readers.delete(nodeId);
}

export function readVideoNodePlaybackTimeSec(nodeId: string): number | undefined {
  const fn = readers.get(nodeId);
  if (!fn) return undefined;
  try {
    const t = fn();
    return typeof t === 'number' && Number.isFinite(t) ? t : undefined;
  } catch {
    return undefined;
  }
}
