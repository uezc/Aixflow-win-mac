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
  /** 导演规划裁切锁定：有效时长勿被探测 duration 撑开 */
  lockTrim?: boolean;
  sourceNodeId?: string;
  name?: string;
  volume?: number;
  directorShotNo?: string;
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

function normalizeDirectorShotNoForTrack(raw: unknown): string {
  const s = String(raw || '').trim();
  if (!s) return '';
  return s.replace(/^镜\s*/i, '').replace(/^0+(\d)/, '$1') || s;
}

function findClipByDirectorShotNo<T extends TimelineClipLike>(
  tracks: T[][],
  shotNo: string,
): { trackIdx: number; clipIdx: number } | null {
  const key = normalizeDirectorShotNoForTrack(shotNo);
  if (!key) return null;
  for (let trackIdx = 0; trackIdx < tracks.length; trackIdx++) {
    const clipIdx = tracks[trackIdx].findIndex(
      (c) => normalizeDirectorShotNoForTrack(c.directorShotNo) === key,
    );
    if (clipIdx >= 0) return { trackIdx, clipIdx };
  }
  return null;
}

/** 导演绝对时间轴片段：应落在同一逻辑视频轨，禁止「一镜一轨」叠播 */
function isDirectorAbsoluteTimelineClip(c: TimelineClipLike): boolean {
  if (c.lockTrim) return true;
  if (normalizeDirectorShotNoForTrack(c.directorShotNo)) return true;
  const sid = String(c.sourceNodeId || '');
  return sid.startsWith('director-');
}

/**
 * 若视频轨上全是导演绝对时间片段却散落在多轨，收拢到单轨并按 startTime 排序。
 * 修复历史「一镜一轨」脏数据；含非导演素材时不改动（保留手动分层）。
 */
export function collapseDirectorAbsoluteVideoTracks<T extends TimelineClipLike>(
  tracks: T[][],
): T[][] {
  const flat = tracks.flat();
  if (flat.length <= 1) return tracks;
  if (tracks.filter((t) => t.length > 0).length <= 1) return tracks;
  if (!flat.every(isDirectorAbsoluteTimelineClip)) return tracks;
  const sorted = [...flat].sort((a, b) => a.startTime - b.startTime || String(a.id).localeCompare(String(b.id)));
  return [sorted];
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
  retainSourceIds: Set<string>,
  /** 剪辑节点上是否存在导演 lockTrim 视频（用于保留未连线的原曲） */
  preserveDirectorAudio = false,
): T[][] {
  const hasDirectorLock =
    preserveDirectorAudio || existingTracks.some((t) => t.some((c) => c.lockTrim));
  let result = existingTracks.map((track) =>
    track
      .filter((c) => {
        if (!c.sourceNodeId) return true;
        if (retainSourceIds.has(c.sourceNodeId)) return true;
        // 导演绝对时间轴片段：源可能是隐藏视频节点（未连入剪辑），勿因边同步滤掉
        if (c.lockTrim) return true;
        if (c.directorShotNo) return true;
        if (String(c.sourceNodeId).startsWith('director-')) return true;
        // 同节点已有导演 lockTrim 时，保留原曲（可能绑真实 audio 节点 id）
        if (hasDirectorLock && c.type === 'audio') return true;
        return false;
      })
      .map((c) => ({ ...c })),
  );

  for (const builtClip of builtTracks.flat()) {
    if (!builtClip.sourceNodeId && !normalizeDirectorShotNoForTrack(builtClip.directorShotNo)) {
      continue;
    }
    // 优先 sourceNodeId；换源（分镜占位→成片节点）时用镜号对齐，避免踢到新轨造成同时间多轨叠播
    const loc =
      (builtClip.sourceNodeId
        ? findClipBySourceId(result, builtClip.sourceNodeId)
        : null) ||
      (builtClip.directorShotNo
        ? findClipByDirectorShotNo(result, builtClip.directorShotNo)
        : null);
    if (loc) {
      const prev = result[loc.trackIdx][loc.clipIdx];
      const useBuiltTiming = Boolean(builtClip.lockTrim || prev.lockTrim);
      result[loc.trackIdx][loc.clipIdx] = {
        ...prev,
        src: builtClip.src,
        duration: builtClip.duration,
        type: builtClip.type,
        name: prev.name || builtClip.name,
        startTime: useBuiltTiming ? builtClip.startTime : prev.startTime,
        id: prev.id,
        sourceNodeId: builtClip.sourceNodeId || prev.sourceNodeId,
        ...((builtClip as { hasAlpha?: boolean }).hasAlpha || (prev as { hasAlpha?: boolean }).hasAlpha
          ? { hasAlpha: true as const }
          : {}),
        trimStart: builtClip.trimStart ?? prev.trimStart,
        trimEnd: builtClip.trimEnd ?? prev.trimEnd,
        lockTrim: builtClip.lockTrim ?? prev.lockTrim,
        directorShotNo: builtClip.directorShotNo ?? prev.directorShotNo,
        volume: prev.volume ?? builtClip.volume,
      };
      continue;
    }
    const clip = { ...builtClip };
    if (isDirectorAbsoluteTimelineClip(clip)) {
      // MV 导演：按 audioStartSec 绝对时间铺同一逻辑轨，勿一镜一轨
      if (result.length === 0) result = [[clip]];
      else result[0] = [...(result[0] || []), clip];
      continue;
    }
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

/** 收集剪辑节点当前入边的源节点 id */
export function collectSpliceIncomingSourceIds(
  spliceNodeId: string,
  edges: Array<{ source: string; target: string }>,
): Set<string> {
  const ids = new Set<string>();
  for (const e of edges) {
    if (e.target === spliceNodeId && e.source) ids.add(e.source);
  }
  return ids;
}

/**
 * 若某条仍存在的入边源「轨道上已有 clip，但本次 built 没有」，视为危险重建。
 * 注意：调用方若已把 connectedSourceIds 传给 applyBuiltClipsToSpliceData，
 * apply 会按边保留旧片段；此时不应因 wouldDrop 而跳过整次写入（否则新接入的音频也进不了轨）。
 */
export function spliceRebuildWouldDropConnected<T extends TimelineClipLike>(
  existing: { videoTracks?: T[][]; videoClips?: T[]; audioTracks?: T[][] } | undefined,
  built: { videoClips?: T[]; videoTracks?: T[][]; audioTracks: T[][] },
  connectedSourceIds: Iterable<string>,
): boolean {
  const existingVideo = normalizeVideoTracks(existing);
  const existingAudio = normalizeAudioTracks(existing?.audioTracks);
  const existingIds = new Set<string>();
  for (const c of [...existingVideo.flat(), ...existingAudio.flat()]) {
    if (c.sourceNodeId) existingIds.add(c.sourceNodeId);
  }
  const builtIds = new Set<string>();
  const builtVideo = built.videoTracks?.length
    ? built.videoTracks.flat()
    : (built.videoClips || []);
  for (const c of [...builtVideo, ...built.audioTracks.flat()]) {
    if (c.sourceNodeId) builtIds.add(c.sourceNodeId);
  }
  for (const sid of connectedSourceIds) {
    if (existingIds.has(sid) && !builtIds.has(sid)) return true;
  }
  return false;
}

/** built 是否包含 existing 尚无的新源片段（例如刚连上的音频） */
export function spliceBuiltHasNewConnectedSources<T extends TimelineClipLike>(
  existing: { videoTracks?: T[][]; videoClips?: T[]; audioTracks?: T[][] } | undefined,
  built: { videoClips?: T[]; videoTracks?: T[][]; audioTracks: T[][] },
): boolean {
  const existingIds = new Set<string>();
  for (const c of [
    ...normalizeVideoTracks(existing).flat(),
    ...normalizeAudioTracks(existing?.audioTracks).flat(),
  ]) {
    if (c.sourceNodeId) existingIds.add(c.sourceNodeId);
  }
  const builtVideo = built.videoTracks?.length
    ? built.videoTracks.flat()
    : (built.videoClips || []);
  for (const c of [...builtVideo, ...built.audioTracks.flat()]) {
    if (c.sourceNodeId && !existingIds.has(c.sourceNodeId)) return true;
  }
  return false;
}

/** 将 buildVideoSpliceClipsFromEdges 结果写入节点 */
export function applyBuiltClipsToSpliceData<T extends TimelineClipLike>(
  existing: { videoTracks?: T[][]; videoClips?: T[]; audioTracks?: T[][] } | undefined,
  built: { videoClips?: T[]; videoTracks?: T[][]; audioTracks: T[][] },
  /** 当前仍连着的源节点 id；传入后按边保留片段，避免 resolve 瞬时失败把音频滤掉 */
  connectedSourceIds?: Iterable<string>,
): { videoTracks: T[][]; videoClips: T[]; audioTracks: T[][] } {
  const builtVideo =
    built.videoTracks?.length
      ? built.videoTracks.map((t) => t.map((c) => ({ ...c })) as T[])
      : [((built.videoClips || []) as T[]).map((c) => ({ ...c }))];
  const builtAudio = built.audioTracks.map((row) => row.map((c) => ({ ...c })));

  const existingVideo = normalizeVideoTracks(existing);
  const existingAudio = normalizeAudioTracks(existing?.audioTracks);

  const retainSourceIds = new Set<string>();
  if (connectedSourceIds) {
    for (const id of connectedSourceIds) {
      if (id) retainSourceIds.add(id);
    }
  }
  // 至少保留本次成功建成的源；无 connected 时退化为旧行为
  for (const c of [...builtVideo.flat(), ...builtAudio.flat()]) {
    if (c.sourceNodeId) retainSourceIds.add(c.sourceNodeId);
  }

  if (!spliceHasPersistedTimelineLayout(existingVideo, existingAudio)) {
    let videoTracks = builtVideo.length ? builtVideo : [[]];
    videoTracks = collapseDirectorAbsoluteVideoTracks(videoTracks);
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

  const directorLockPresent =
    existingVideo.some((t) => t.some((c) => c.lockTrim)) ||
    builtVideo.some((t) => t.some((c) => c.lockTrim));

  let videoTracks = mergeBuiltClipsIntoTracks(
    existingVideo,
    builtVideo,
    retainSourceIds,
    directorLockPresent,
  );
  let audioTracks = mergeBuiltClipsIntoTracks(
    existingAudio,
    builtAudio,
    retainSourceIds,
    directorLockPresent,
  );

  videoTracks = collapseDirectorAbsoluteVideoTracks(videoTracks);

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
  if (c.type === 'image') {
    // 导演锁定或显式 trim：图片按 trim 区间占轨
    if (c.trimEnd != null && c.trimEnd > (c.trimStart ?? 0)) {
      return Math.max(0.1, c.trimEnd - (c.trimStart ?? 0));
    }
    return imageClipDurationSec(c);
  }
  const base = clipMediaDurationBase(c, sourceHint);
  const ts = c.trimStart ?? 0;
  // 尊重显式 trimEnd（用户鼠标裁剪）；占位短 trim 由 sanitize / mergeProbed 清理
  const te = c.trimEnd != null && c.trimEnd > ts ? c.trimEnd : base;
  return Math.max(0, te - ts);
}

/** 命中/播放区间：未探测时长时仍认轨道上有效 src 的片段（与 UI 0.1s 占位一致，或无限延伸直至 probe） */
export function clipPlaybackSpanDurationSec(c: TimelineClipLike, sourceHint = 0): number {
  const span = clipTimelineDurationSec(c, sourceHint);
  if (span > 0) return span;
  if (c.src && c.type !== 'image') return Number.POSITIVE_INFINITY;
  return span;
}

/** 素材内有效 trimEnd（显式 trim 优先；未设置时用成片/源时长） */
export function effectiveClipTrimEnd(c: TimelineClipLike, sourceHint = 0): number {
  if (c.type === 'image') {
    if (c.trimEnd != null && c.trimEnd > (c.trimStart ?? 0)) return c.trimEnd;
    return imageClipDurationSec(c);
  }
  const base = clipMediaDurationBase(c, sourceHint);
  const ts = c.trimStart ?? 0;
  const te = c.trimEnd != null && c.trimEnd > ts ? c.trimEnd : base;
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
      // 显式 trim / 导演 lockTrim 图片占位按 trim 占轨，与 clipTimelineDurationSec 一致
      const dur =
        c.trimEnd != null && c.trimEnd > (c.trimStart ?? 0)
          ? Math.max(0.1, c.trimEnd - (c.trimStart ?? 0))
          : imageClipDurationSec(c);
      return t >= c.startTime && t < c.startTime + dur;
    }
    const end = clipPlaybackEndSec(c, hint);
    // 半开区间 [start, end)：包含起点，避免 t=0 时预览找不到片段
    return t >= c.startTime && (end === Number.POSITIVE_INFINITY || t < end);
  });
}
