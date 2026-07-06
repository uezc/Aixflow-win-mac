/** 时间轴轨引用：'video' / 'video-N' 为视频轨，非负整数为音频轨索引 */
export type TimelineTrackRef = 'video' | string | number;

export const DEFAULT_VIDEO_TRACK_COUNT = 1;
/** 剪辑模块默认音频轨数量 */
export const DEFAULT_AUDIO_TRACK_COUNT = 1;
/** 图片片段默认显示时长（秒） */
export const DEFAULT_IMAGE_CLIP_DURATION_SEC = 3;

/** 剪辑时间轴：音频轨/音频片段音量倍数上限（3 = 300%） */
export const SPLICE_AUDIO_VOLUME_MAX = 3;
export const SPLICE_AUDIO_VOLUME_SLIDER_PCT_MAX = 300;

export function clampSpliceAudioVolume(value: unknown, fallback = 1): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0, Math.min(SPLICE_AUDIO_VOLUME_MAX, n));
}

export function isVideoTrackRef(track: TimelineTrackRef): boolean {
  return track === 'video' || (typeof track === 'string' && track.startsWith('video-'));
}

export function isAudioTrackRef(track: TimelineTrackRef): boolean {
  return typeof track === 'number';
}

export function videoTrackIndexFromRef(track: TimelineTrackRef): number {
  if (track === 'video') return 0;
  if (typeof track === 'string' && track.startsWith('video-')) {
    const n = parseInt(track.slice('video-'.length), 10);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

export function encodeVideoTrackRef(index: number): TimelineTrackRef {
  return index === 0 ? 'video' : `video-${index}`;
}

export interface TimelineClipLike {
  id: string;
  type: string;
  src?: string;
  startTime: number;
  duration: number;
  trimStart?: number;
  trimEnd?: number;
}

function clipMediaDurationBase(c: TimelineClipLike, sourceHint = 0): number {
  if (c.type === 'image') return imageClipDurationSec(c);
  return Math.max(c.duration, sourceHint);
}

export function normalizeVideoTracks<T extends TimelineClipLike>(
  data?: { videoTracks?: T[][]; videoClips?: T[] },
): T[][] {
  if (data?.videoTracks?.length) {
    const base = data.videoTracks.map((t) => [...t]) as T[][];
    while (base.length < DEFAULT_VIDEO_TRACK_COUNT) base.push([]);
    // 连线同步只写了 videoClips 时，避免 track0 仍为空导致预览无画面
    if ((base[0]?.length ?? 0) === 0 && (data.videoClips?.length ?? 0) > 0) {
      base[0] = [...data.videoClips] as T[];
    }
    return base;
  }
  return [data?.videoClips?.length ? [...data.videoClips] : []];
}

export function normalizeAudioTracks<T extends TimelineClipLike>(
  tracks: T[][] | undefined,
): T[][] {
  const base = (tracks?.length ? tracks.map((t) => [...t]) : [[]]) as T[][];
  while (base.length < DEFAULT_AUDIO_TRACK_COUNT) base.push([]);
  return base;
}

function findClipBySourceId<T extends TimelineClipLike>(
  tracks: T[][],
  sourceId: string,
): { trackIdx: number; clipIdx: number } | null {
  for (let trackIdx = 0; trackIdx < tracks.length; trackIdx++) {
    const clipIdx = tracks[trackIdx].findIndex((c) => c.sourceNodeId === sourceId);
    if (clipIdx >= 0) return { trackIdx, clipIdx };
  }
  return null;
}

function spliceHasPersistedTimelineLayout<T extends TimelineClipLike>(
  existingVideo: T[][],
  existingAudio: T[][],
): boolean {
  if (existingVideo.some((t) => t.length > 0) || existingAudio.some((t) => t.length > 0)) return true;
  return (
    existingVideo.length > DEFAULT_VIDEO_TRACK_COUNT ||
    existingAudio.length > DEFAULT_AUDIO_TRACK_COUNT
  );
}

function mergeBuiltClipsIntoTracks<T extends TimelineClipLike>(
  existingTracks: T[][],
  builtTracks: T[][],
  incomingSourceIds: Set<string>,
): T[][] {
  let result = existingTracks.map((track) =>
    track
      .filter((c) => !c.sourceNodeId || incomingSourceIds.has(c.sourceNodeId))
      .map((c) => ({ ...c })),
  );

  for (const builtClip of builtTracks.flat()) {
    if (!builtClip.sourceNodeId) continue;
    const loc = findClipBySourceId(result, builtClip.sourceNodeId);
    if (loc) {
      const prev = result[loc.trackIdx][loc.clipIdx];
      result[loc.trackIdx][loc.clipIdx] = {
        ...prev,
        src: builtClip.src,
        duration: builtClip.duration,
        type: builtClip.type,
        name: prev.name || builtClip.name,
        startTime: prev.startTime,
        id: prev.id,
        sourceNodeId: prev.sourceNodeId,
        trimStart: builtClip.trimStart ?? prev.trimStart,
        trimEnd: builtClip.trimEnd ?? prev.trimEnd,
        volume: prev.volume ?? builtClip.volume,
      };
      continue;
    }
    const clip = { ...builtClip };
    const emptyIdx = result.findIndex((t) => t.length === 0);
    if (emptyIdx >= 0) {
      result[emptyIdx] = [clip];
    } else {
      result = [...result, [clip]];
    }
  }

  while (result.length < existingTracks.length) {
    result.push([]);
  }
  return result;
}

/** 将 buildVideoSpliceClipsFromEdges 结果写入节点 */
export function applyBuiltClipsToSpliceData<T extends TimelineClipLike>(
  existing: { videoTracks?: T[][]; videoClips?: T[]; audioTracks?: T[][] } | undefined,
  built: { videoClips?: T[]; videoTracks?: T[][]; audioTracks: T[][] },
): { videoTracks: T[][]; videoClips: T[]; audioTracks: T[][] } {
  const builtVideo =
    built.videoTracks?.length
      ? built.videoTracks.map((t) => t.map((c) => ({ ...c })) as T[])
      : [((built.videoClips || []) as T[]).map((c) => ({ ...c }))];
  const builtAudio = built.audioTracks.map((row) => row.map((c) => ({ ...c })));

  const existingVideo = normalizeVideoTracks(existing);
  const existingAudio = normalizeAudioTracks(existing?.audioTracks);

  const incomingSourceIds = new Set<string>();
  for (const c of [...builtVideo.flat(), ...builtAudio.flat()]) {
    if (c.sourceNodeId) incomingSourceIds.add(c.sourceNodeId);
  }

  if (!spliceHasPersistedTimelineLayout(existingVideo, existingAudio)) {
    const videoTracks = builtVideo.length ? builtVideo : [[]];
    while (videoTracks.length < DEFAULT_VIDEO_TRACK_COUNT) videoTracks.push([]);
    const audioTracks = builtAudio.length ? builtAudio : [[]];
    while (audioTracks.length < DEFAULT_AUDIO_TRACK_COUNT) audioTracks.push([]);
    const track0 = videoTracks[0] ?? [];
    return {
      videoTracks,
      videoClips: track0,
      audioTracks,
    };
  }

  let videoTracks = mergeBuiltClipsIntoTracks(existingVideo, builtVideo, incomingSourceIds);
  let audioTracks = mergeBuiltClipsIntoTracks(existingAudio, builtAudio, incomingSourceIds);

  while (videoTracks.length < DEFAULT_VIDEO_TRACK_COUNT) videoTracks.push([]);
  while (audioTracks.length < DEFAULT_AUDIO_TRACK_COUNT) audioTracks.push([]);

  const track0 = videoTracks[0] ?? [];
  return {
    videoTracks,
    videoClips: track0,
    audioTracks,
  };
}

function imageClipDurationSec(c: TimelineClipLike): number {
  return Number.isFinite(c.duration) && c.duration > 0 ? c.duration : DEFAULT_IMAGE_CLIP_DURATION_SEC;
}

/** 片段在时间轴上的有效时长（与轨道显示、clipEndSec 一致） */
export function clipTimelineDurationSec(c: TimelineClipLike, sourceHint = 0): number {
  if (c.type === 'image') return imageClipDurationSec(c);
  const base = clipMediaDurationBase(c, sourceHint);
  const ts = c.trimStart ?? 0;
  let te = c.trimEnd ?? base;
  if (base > te + 0.5) te = base;
  return Math.max(0, te - ts);
}

/** 命中/播放区间：未探测时长时仍认轨道上有效 src 的片段（与 UI 0.1s 占位一致，或无限延伸直至 probe） */
export function clipPlaybackSpanDurationSec(c: TimelineClipLike, sourceHint = 0): number {
  const span = clipTimelineDurationSec(c, sourceHint);
  if (span > 0) return span;
  if (c.src && c.type !== 'image') return Number.POSITIVE_INFINITY;
  return span;
}

/** 素材内有效 trimEnd（探测后 duration 已更新但 trimEnd 仍为占位短值时对齐 duration） */
export function effectiveClipTrimEnd(c: TimelineClipLike, sourceHint = 0): number {
  if (c.type === 'image') return imageClipDurationSec(c);
  const base = clipMediaDurationBase(c, sourceHint);
  let te = c.trimEnd ?? base;
  if (base > te + 0.5) te = base;
  if (te <= 0 && c.src) return Number.POSITIVE_INFINITY;
  return te;
}

export function clipEndSec(c: TimelineClipLike, sourceHint = 0): number {
  return c.startTime + clipTimelineDurationSec(c, sourceHint);
}

export function clipPlaybackEndSec(c: TimelineClipLike, sourceHint = 0): number {
  const span = clipPlaybackSpanDurationSec(c, sourceHint);
  if (!Number.isFinite(span)) return Number.POSITIVE_INFINITY;
  return c.startTime + span;
}

export function findClipAtTimelineTime<T extends TimelineClipLike>(
  track: T[],
  t: number,
  resolveSourceHint?: (c: T) => number,
): T | undefined {
  return track.find((c) => {
    const hint = resolveSourceHint?.(c) ?? 0;
    if (c.type === 'image') {
      const dur = imageClipDurationSec(c);
      return t >= c.startTime + 1e-4 && t < c.startTime + dur - 1e-4;
    }
    const end = clipPlaybackEndSec(c, hint);
    return t >= c.startTime + 1e-4 && (end === Number.POSITIVE_INFINITY || t < end - 1e-4);
  });
}
