import { normalizeVideoUrl } from './normalizeVideoUrl';
import { DEFAULT_IMAGE_CLIP_DURATION_SEC, normalizeVideoTracks } from './videoSpliceTracks';
import { mapProjectPath } from './pathMapper';
import { pickImageUrlFromNodeData } from './pickImageUrlFromNodeData';
import {
  isDigitalHumanAudioOutputHandle,
  isDigitalHumanVideoOutputHandle,
  pickDigitalHumanAudioUrl,
  pickDigitalHumanVideoUrl,
} from './digitalHumanNodeMedia';

export type TimelineSourceMediaKind = 'video' | 'image' | 'audio';

export type TimelineSourceMedia = {
  clipType: TimelineSourceMediaKind;
  url: string;
};

export type TimelineClipRecord = {
  id: string;
  type: TimelineSourceMediaKind;
  src: string;
  duration: number;
  startTime: number;
  trimStart?: number;
  trimEnd?: number;
  /** 导演规划裁切：探测不得清除/拉长有效 trim */
  lockTrim?: boolean;
  name?: string;
  sourceNodeId?: string;
  volume?: number;
  directorShotNo?: string;
  /** 色度抠像 WebM 等带透明通道 */
  hasAlpha?: boolean;
};

export type VideoSpliceClipLabels = {
  video: string;
  image: string;
  audio: string;
};

const isVideoSourceNodeType = (t: string | undefined) =>
  t === 'video' || t === 'wanAnimate' || t === 'heyGem';

export function isTimelineVideoSourceNodeType(t: string | undefined): boolean {
  return isVideoSourceNodeType(t);
}

/**
 * 画布阅读顺序：从上到下（同行容差），再从左到右。
 * 用于多选视频一键拼接等。
 */
export function sortNodesByReadingOrder<T extends { id: string; position?: { x?: number; y?: number } }>(
  nodes: T[],
  rowTolerance = 48,
): T[] {
  return [...nodes].sort((a, b) => {
    const ya = a.position?.y ?? 0;
    const yb = b.position?.y ?? 0;
    if (Math.abs(ya - yb) > rowTolerance) return ya - yb;
    return (a.position?.x ?? 0) - (b.position?.x ?? 0);
  });
}

/** 可连入剪辑轨道的源模块类型 */
export function isTimelineMediaSourceNodeType(t: string | undefined): boolean {
  return t === 'image' || isVideoSourceNodeType(t) || t === 'audio' || t === 'digitalHuman';
}

function sortIncomingEdgesBySourceLayout(
  incoming: Array<{ source: string; target: string; data?: unknown }>,
  nodes: Array<{ id: string; position?: { x?: number; y?: number } }>,
): Array<{ source: string; target: string; data?: unknown }> {
  return [...incoming].sort((a, b) => {
    const na = nodes.find((n) => n.id === a.source);
    const nb = nodes.find((n) => n.id === b.source);
    const ya = na?.position?.y ?? 0;
    const yb = nb?.position?.y ?? 0;
    if (Math.abs(ya - yb) > 1) return ya - yb;
    return (na?.position?.x ?? 0) - (nb?.position?.x ?? 0);
  });
}

/** HTML5/buffered 误读常见占位（秒） */
const TIMELINE_UNTRUSTED_DURATIONS = [5, 8] as const;
const TIMELINE_MIN_TRUSTED_SEC = 1.01;

export function effectiveTimelineClipDurationSec(c: TimelineClipRecord): number {
  if (c.type === 'image') {
    return Number.isFinite(c.duration) && c.duration > 0 ? c.duration : DEFAULT_IMAGE_CLIP_DURATION_SEC;
  }
  // 导演锁定：探测决策用规划 trim，勿把 5s 规划段当成 HTML5 占位时长反复打回 0
  if (c.lockTrim && c.trimEnd != null && c.trimEnd > (c.trimStart ?? 0)) {
    return Math.max(0.1, c.trimEnd - (c.trimStart ?? 0));
  }
  return Math.max(0.1, (c.trimEnd ?? c.duration) - (c.trimStart ?? 0));
}

function isUntrustedTimelineDuration(duration: number): boolean {
  if (!Number.isFinite(duration) || duration <= 0) return true;
  if (duration <= TIMELINE_MIN_TRUSTED_SEC) return true;
  return TIMELINE_UNTRUSTED_DURATIONS.some((p) => Math.abs(duration - p) < 0.01);
}

/** 占位/误读时长、或短于源节点已知时长 → 需重新探测 */
export function needsTimelineDurationProbe(duration: number, sourceHint = 0): boolean {
  if (isUntrustedTimelineDuration(duration)) return true;
  if (sourceHint > duration + 0.01) return true;
  return false;
}

/**
 * 导演 lockTrim 片段：有效轨长已由 trim 锁定时，不必因「恰为 5s」反复探测。
 * 仍会在成片 duration 明显短于 trim、或 sourceHint 更大时探测以抬高 media duration。
 */
export function needsDirectorLockedClipDurationProbe(
  clip: TimelineClipRecord,
  sourceHint = 0,
): boolean {
  if (!clip.lockTrim) return needsTimelineDurationProbe(clip.duration, sourceHint);
  const ts = clip.trimStart ?? 0;
  const te =
    clip.trimEnd != null && clip.trimEnd > ts
      ? clip.trimEnd
      : Number.isFinite(clip.duration) && clip.duration > ts
        ? clip.duration
        : 0;
  if (!(te > ts)) return needsTimelineDurationProbe(clip.duration, sourceHint);
  if (sourceHint > clip.duration + 0.01) return true;
  // 成片尚短于规划 trim：需要探测真实媒体长（或确认无法拉长）
  if (Number.isFinite(clip.duration) && clip.duration + 0.05 < te) return true;
  return false;
}

/** 从源节点 data 读取已探测的媒体时长（VideoNode/AudioNode 写入 mediaDurationSec） */
export function resolveSourceMediaDurationSec(
  sourceNode: { type?: string; data?: Record<string, unknown> },
): number {
  const d = sourceNode.data || {};
  const raw = Number(d.mediaDurationSec);
  if (Number.isFinite(raw) && raw > 0) return raw;
  return 0;
}

function resolveConnectedClipDuration(
  clipType: TimelineSourceMediaKind,
  resolvedUrl: string,
  sourceNode: { type?: string; data?: Record<string, unknown> },
  prev?: TimelineClipRecord,
): number {
  if (clipType === 'image') {
    return prev?.type === 'image' && prev.duration > 0 ? prev.duration : DEFAULT_IMAGE_CLIP_DURATION_SEC;
  }
  const sourceHint = resolveSourceMediaDurationSec(sourceNode);
  if (sourceHint > 0) return sourceHint;
  // 保留同 URL 已探测的真实时长；仅丢弃已知占位/误读值（1s、5s、8s 等）
  if (prev && prev.src === resolvedUrl && !needsTimelineDurationProbe(prev.duration, sourceHint)) {
    return prev.duration;
  }
  return 0;
}

function shouldPreserveClipTrim(
  prev: TimelineClipRecord | undefined,
  resolvedUrl: string,
  duration: number,
  sourceHint = 0,
): boolean {
  if (!prev) return false;
  // 导演规划裁切：换成本地路径后仍须保留 trim/lockTrim，否则有效时长被成片撑开并与原曲错位
  if (prev.lockTrim && prev.trimEnd != null && (prev.trimEnd ?? 0) > (prev.trimStart ?? 0)) {
    return true;
  }
  if (prev.src !== resolvedUrl) return false;
  // 新媒体时长尚未可信时先不保留，等探测后再合并
  if (needsTimelineDurationProbe(duration, sourceHint)) return false;
  const ts = prev.trimStart ?? 0;
  const te = prev.trimEnd;
  // 无显式 trim 无需保留
  if (te == null || !(te > ts + 0.05)) return false;
  // 超出新媒体时长的 trim 无效
  if (te > duration + 0.05) return false;
  // 仅丢弃「贴在旧占位短 duration 上」的 trim；用户裁短（te << sourceHint）必须保留
  const prevDurUntrusted =
    needsTimelineDurationProbe(prev.duration, 0) || isUntrustedTimelineDuration(prev.duration);
  if (duration > prev.duration + 0.5 && te <= prev.duration + 0.01 && prevDurUntrusted) {
    return false;
  }
  return true;
}

/** 清除占位探测或 sourceHint 不一致时遗留的错误 trim（duration 已正确但 trimEnd 仍为几秒） */
export function sanitizeTimelineClipTrim(
  clip: TimelineClipRecord,
  sourceHint = 0,
): TimelineClipRecord {
  if (clip.lockTrim) {
    const ts = clip.trimStart ?? 0;
    let te = clip.trimEnd;
    if (te == null || !(te > ts)) {
      te = Number.isFinite(clip.duration) && clip.duration > ts ? clip.duration : ts + 0.1;
    }
    const mediaDur = Math.max(
      Number.isFinite(clip.duration) ? clip.duration : 0,
      sourceHint,
      te,
    );
    return {
      ...clip,
      duration: mediaDur > 0 ? mediaDur : clip.duration,
      trimStart: ts,
      trimEnd: te,
      lockTrim: true,
    };
  }
  if (clip.type === 'image') {
    const dur =
      Number.isFinite(clip.duration) && clip.duration > 0 ? clip.duration : DEFAULT_IMAGE_CLIP_DURATION_SEC;
    if (clip.trimStart == null && clip.trimEnd == null) {
      return clip.duration > 0 ? clip : { ...clip, duration: dur };
    }
    const { trimStart: _ts, trimEnd: _te, ...rest } = clip;
    return { ...rest, duration: dur };
  }
  if (clip.trimStart == null && clip.trimEnd == null) return clip;
  const dur = clip.duration;
  const ts = clip.trimStart ?? 0;
  const te = clip.trimEnd ?? dur;
  const effective = te - ts;

  // 可信成片上的合法 in/out：保留（含用户时间轴鼠标裁剪），勿因 te < sourceHint 误清
  const mediaTrusted =
    Number.isFinite(dur) && dur > TIMELINE_MIN_TRUSTED_SEC && !isUntrustedTimelineDuration(dur);
  const trimInMedia =
    ts >= -0.001 && te > ts + 0.05 && te <= dur + 0.05 && (!sourceHint || te <= sourceHint + 0.05);
  if (mediaTrusted && trimInMedia) return clip;

  // 仅清除占位探测遗留 trim。注意：needsTimelineDurationProbe(x, sourceHint) 在 x < sourceHint 时为 true，
  // 不能用来判断「用户裁短」是否 stale，否则会清掉时间轴上的有意 trimEnd。
  const trimEndPinnedToOldShortDuration =
    sourceHint > dur + 0.5 &&
    te <= dur + 0.01 &&
    effective <= dur + 0.01 &&
    isUntrustedTimelineDuration(dur);
  const trimLooksStale =
    !Number.isFinite(dur) ||
    dur <= 0 ||
    effective <= 0.01 ||
    (isUntrustedTimelineDuration(effective) && sourceHint > effective + 0.5) ||
    (isUntrustedTimelineDuration(te) && sourceHint > te + 0.5) ||
    trimEndPinnedToOldShortDuration;

  if (!trimLooksStale) return clip;
  const { trimStart: _ts, trimEnd: _te, ...rest } = clip;
  return rest;
}

/** 探测到真实时长后合并进片段，并清理占位时长遗留的错误 trim */
export function mergeProbedTimelineClipDuration(
  clip: TimelineClipRecord,
  probedDur: number,
  sourceHint = 0,
): TimelineClipRecord {
  if (clip.type === 'image') return sanitizeTimelineClipTrim(clip, sourceHint);
  if (!Number.isFinite(probedDur) || probedDur <= 0) return sanitizeTimelineClipTrim(clip, sourceHint);

  // 导演有意裁切：抬高成片 duration；若成片短于规划 trim 则收缩 trimEnd，避免片尾空转而原曲继续
  if (clip.lockTrim) {
    const ts = clip.trimStart ?? 0;
    let te =
      clip.trimEnd != null && clip.trimEnd > ts
        ? clip.trimEnd
        : Number.isFinite(clip.duration) && clip.duration > ts
          ? clip.duration
          : ts + 0.1;
    const mediaLen = Math.max(
      Number.isFinite(probedDur) ? probedDur : 0,
      Number.isFinite(sourceHint) ? sourceHint : 0,
    );
    if (mediaLen > ts + 0.05 && te > mediaLen + 0.05) {
      te = mediaLen;
    }
    const nextDur = Math.max(
      Number.isFinite(clip.duration) ? clip.duration : 0,
      probedDur,
      sourceHint,
      te,
    );
    return sanitizeTimelineClipTrim(
      { ...clip, duration: nextDur, trimStart: ts, trimEnd: te, lockTrim: true },
      Math.max(nextDur, sourceHint),
    );
  }

  const prevDur = clip.duration;
  const nextDur = Math.max(prevDur, probedDur, sourceHint);
  const next: TimelineClipRecord = { ...clip, duration: nextDur };
  if (next.trimEnd != null && next.trimEnd > nextDur) {
    const { trimEnd: _te, ...rest } = next;
    return sanitizeTimelineClipTrim(rest, Math.max(nextDur, sourceHint));
  }
  const ts = next.trimStart ?? 0;
  const trimEnd = next.trimEnd;
  // 仅当 trim 钉在「不可信的旧短 duration」上时才清；用户裁到 te < 新媒体长必须保留
  const trimPinnedToUntrustedPrevDur =
    trimEnd != null &&
    trimEnd > ts + 0.05 &&
    trimEnd <= prevDur + 0.01 &&
    probedDur > prevDur + 0.5 &&
    isUntrustedTimelineDuration(prevDur);
  if (trimPinnedToUntrustedPrevDur) {
    const { trimEnd: _te, trimStart: _ts, ...rest } = next;
    return sanitizeTimelineClipTrim(rest, Math.max(nextDur, sourceHint));
  }
  return sanitizeTimelineClipTrim(next, Math.max(nextDur, sourceHint));
}

/** 探测视频/音频真实时长：主进程 ffmpeg 优先，渲染进程 metadata 兜底（短于 1s 的 metadata 不可信） */
export async function probeTimelineMediaDuration(
  url: string,
  kind: 'video' | 'audio',
  projectId?: string,
): Promise<number> {
  const raw = url.trim();
  if (!raw) return 0;
  const normalized = normalizeVideoUrl(raw);
  const mapped = projectId ? await mapProjectPath(normalized, projectId).catch(() => normalized) : normalized;
  const candidates = [...new Set([mapped, normalized, raw].filter(Boolean))];

  if (typeof window !== 'undefined' && window.electronAPI?.getMediaDuration) {
    for (const candidate of candidates) {
      try {
        const d = await window.electronAPI.getMediaDuration(candidate, projectId);
        // ffmpeg 探测结果可信，不做 timeline 占位过滤
        if (Number.isFinite(d) && d > 0) return d;
      } catch {
        /* try next */
      }
    }
  }

  return new Promise<number>((resolve) => {
    const finish = (d: number) => resolve(isUntrustedTimelineDuration(d) ? 0 : d);
    const tryWithSrc = (src: string, onFail: () => void) => {
      const el = document.createElement(kind === 'audio' ? 'audio' : 'video');
      el.preload = 'metadata';
      if (el instanceof HTMLVideoElement) el.muted = true;
      el.onloadedmetadata = () => {
        const d = el.duration;
        el.remove();
        finish(d);
      };
      el.onerror = () => {
        el.remove();
        onFail();
      };
      el.src = src;
    };
    const tryAudioFallback = () => {
      if (kind !== 'audio') {
        finish(0);
        return;
      }
      tryWithSrc(mapped, () => finish(0));
    };
    if (kind === 'audio') {
      tryWithSrc(mapped, () => {
        if (mapped !== normalized) tryWithSrc(normalized, () => tryAudioFallback());
        else tryAudioFallback();
      });
    } else {
      tryWithSrc(mapped, () => finish(0));
    }
  });
}

/** 音频节点 UI 专用：ffmpeg 全信任；HTML5 仅排除无效值（不受 timeline 占位 1s/5s/8s 规则影响） */
export async function probeAudioMediaDurationSec(
  url: string,
  projectId?: string,
): Promise<number> {
  const raw = url.trim();
  if (!raw) return 0;
  const normalized = normalizeVideoUrl(raw);
  const mapped = projectId ? await mapProjectPath(normalized, projectId).catch(() => normalized) : normalized;
  const candidates = [...new Set([mapped, normalized, raw].filter(Boolean))];

  if (typeof window !== 'undefined' && window.electronAPI?.getMediaDuration) {
    for (const candidate of candidates) {
      try {
        const d = await window.electronAPI.getMediaDuration(candidate, projectId);
        if (Number.isFinite(d) && d > 0) return d;
      } catch {
        /* try next */
      }
    }
  }

  return new Promise<number>((resolve) => {
    const trySrc = (src: string, next?: () => void) => {
      const el = document.createElement('audio');
      el.preload = 'metadata';
      el.onloadedmetadata = () => {
        const d = el.duration;
        el.remove();
        resolve(Number.isFinite(d) && d > 0 ? d : 0);
      };
      el.onerror = () => {
        el.remove();
        if (next) next();
        else resolve(0);
      };
      el.src = src;
    };
    if (mapped !== normalized) {
      trySrc(mapped, () => trySrc(normalized));
    } else {
      trySrc(mapped);
    }
  });
}

/**
 * 从连线源节点（及边上的 imageAsset 缓存）解析剪辑轨道素材 URL。
 */
export function resolveTimelineMediaFromSource(
  sourceNode: { type?: string; data?: Record<string, unknown> },
  edge?: { data?: unknown; sourceHandle?: string | null },
): TimelineSourceMedia | null {
  const d = sourceNode.data || {};
  const t = sourceNode.type;

  if (t === 'digitalHuman') {
    const sh = edge?.sourceHandle ?? null;
    if (isDigitalHumanAudioOutputHandle(sh)) {
      const url = normalizeVideoUrl(pickDigitalHumanAudioUrl(d));
      return url ? { clipType: 'audio', url } : null;
    }
    if (isDigitalHumanVideoOutputHandle(sh)) {
      const url = normalizeVideoUrl(pickDigitalHumanVideoUrl(d));
      return url ? { clipType: 'video', url } : null;
    }
    return null;
  }

  if (isVideoSourceNodeType(t)) {
    const edgeVideo = edge
      ? String((edge.data as { videoSrc?: string } | undefined)?.videoSrc || '').trim()
      : '';
    const url = normalizeVideoUrl(
      String(d.outputVideo || d.originalVideoUrl || edgeVideo || '').trim(),
    );
    return url ? { clipType: 'video', url } : null;
  }

  if (t === 'image') {
    let url = pickImageUrlFromNodeData(d).trim();
    if (!url && edge) {
      const edgeAsset = (edge.data as { imageAsset?: { preview?: string; original?: string } } | undefined)
        ?.imageAsset;
      url = String(edgeAsset?.preview || edgeAsset?.original || '').trim();
    }
    if (!url && typeof d.avatar === 'string') {
      url = d.avatar.trim();
    }
    url = url ? normalizeVideoUrl(url) : '';
    return url ? { clipType: 'image', url } : null;
  }

  if (t === 'audio') {
    const multi = Array.isArray(d.outputAudios)
      ? (d.outputAudios as unknown[]).map((u) => String(u || '').trim()).filter(Boolean)
      : [];
    const multiOrig = Array.isArray(d.originalOutputAudios)
      ? (d.originalOutputAudios as unknown[]).map((u) => String(u || '').trim()).filter(Boolean)
      : [];
    const edgeAudio = edge
      ? String((edge.data as { audioSrc?: string } | undefined)?.audioSrc || '').trim()
      : '';
    // 与 Workspace.pickAudioOutputUrlFromAudioNodeData 一致；边上可缓存 audioSrc
    const url = normalizeVideoUrl(
      String(
        d.originalAudioUrl ||
          d.outputAudio ||
          multi[0] ||
          multiOrig[0] ||
          d.referenceAudioUrl ||
          edgeAudio ||
          '',
      ).trim(),
    );
    return url ? { clipType: 'audio', url } : null;
  }

  return null;
}

/**
 * 根据指向剪辑节点的全部入边，重建轨道片段（保留无 sourceNodeId 的手动导入素材）。
 * 每个连线源各占一条独立轨道（视频/图片 → 独立视频轨，音频 → 独立音频轨）。
 */
export function buildVideoSpliceClipsFromEdges(
  spliceNodeId: string,
  edges: Array<{ source: string; target: string; data?: unknown; sourceHandle?: string | null }>,
  nodes: Array<{ id: string; type?: string; data?: Record<string, unknown> }>,
  existing?: {
    videoTracks?: TimelineClipRecord[][];
    videoClips?: TimelineClipRecord[];
    audioTracks?: TimelineClipRecord[][];
  },
  labels: VideoSpliceClipLabels = { video: '视频', image: '图片', audio: '音频' },
): { videoClips: TimelineClipRecord[]; videoTracks: TimelineClipRecord[][]; audioTracks: TimelineClipRecord[][] } {
  const incoming = sortIncomingEdgesBySourceLayout(
    edges.filter((e) => e.target === spliceNodeId),
    nodes,
  );
  const allVideoTracks = normalizeVideoTracks(existing);
  const existingAudioTracks = (existing?.audioTracks?.length ? existing.audioTracks : [[]]).map((t) =>
    [...(t as TimelineClipRecord[])],
  );

  const existingBySource = new Map<string, TimelineClipRecord>();
  for (const track of allVideoTracks) {
    for (const c of track) {
      if (c.sourceNodeId) existingBySource.set(c.sourceNodeId, c);
    }
  }
  for (const track of existingAudioTracks) {
    for (const c of track) {
      if (c.sourceNodeId) existingBySource.set(c.sourceNodeId, c);
    }
  }

  const manualVideo = allVideoTracks.flat().filter((c) => !c.sourceNodeId).map((c) => ({ ...c }));
  const manualAudio = existingAudioTracks.flat().filter((c) => !c.sourceNodeId).map((c) => ({ ...c }));

  const videoTracks: TimelineClipRecord[][] = manualVideo.length > 0 ? [manualVideo] : [];
  const audioTracks: TimelineClipRecord[][] = manualAudio.length > 0 ? [manualAudio] : [];

  const findTrackIndexBySource = (tracks: TimelineClipRecord[][], sourceId: string) =>
    tracks.findIndex((t) => t.some((c) => c.sourceNodeId === sourceId));

  const upsertClipOnDedicatedTrack = (
    tracks: TimelineClipRecord[][],
    clip: TimelineClipRecord,
    sourceId: string,
  ): TimelineClipRecord[][] => {
    const idx = findTrackIndexBySource(tracks, sourceId);
    if (idx >= 0) {
      return tracks.map((t, i) => (i === idx ? [clip] : t));
    }
    return [...tracks, [clip]];
  };

  for (const edge of incoming) {
    const sourceNode = nodes.find((n) => n.id === edge.source);
    if (!sourceNode) continue;
    const resolved = resolveTimelineMediaFromSource(sourceNode, edge);
    const prev = existingBySource.get(edge.source);
    if (!resolved) {
      if (prev) {
        const kept = { ...prev, startTime: prev.startTime };
        if (prev.type === 'audio') {
          audioTracks.splice(0, audioTracks.length, ...upsertClipOnDedicatedTrack(audioTracks, kept, edge.source));
        } else {
          videoTracks.splice(0, videoTracks.length, ...upsertClipOnDedicatedTrack(videoTracks, kept, edge.source));
        }
      }
      continue;
    }

    const sourceHint = resolveSourceMediaDurationSec(sourceNode);
    const duration = resolveConnectedClipDuration(resolved.clipType, resolved.url, sourceNode, prev);
    const keepTrim = shouldPreserveClipTrim(prev, resolved.url, duration, sourceHint);
    const placedStart =
      prev != null && Number.isFinite(prev.startTime) ? prev.startTime : 0;

    const sourceHasAlpha =
      resolved.clipType === 'video' &&
      (sourceNode.data?.hasAlpha === true ||
        /video-chromakey-/i.test(resolved.url) ||
        /video-smart-matting-/i.test(resolved.url) ||
        /\.webm(?:$|[?#])/i.test(resolved.url));

    const clip: TimelineClipRecord = sanitizeTimelineClipTrim(
      {
        id: prev?.id || `${resolved.clipType}-${edge.source}`,
        type: resolved.clipType,
        src: resolved.url,
        duration,
        startTime: placedStart,
        name: prev?.name || labels[resolved.clipType],
        sourceNodeId: edge.source,
        ...(keepTrim && prev?.trimStart != null ? { trimStart: prev.trimStart } : {}),
        ...(keepTrim && prev?.trimEnd != null ? { trimEnd: prev.trimEnd } : {}),
        ...(keepTrim && prev?.lockTrim ? { lockTrim: true } : {}),
        ...(prev?.volume != null ? { volume: prev.volume } : {}),
        ...(prev?.directorShotNo ? { directorShotNo: prev.directorShotNo } : {}),
        ...(sourceHasAlpha || prev?.hasAlpha ? { hasAlpha: true } : {}),
      },
      sourceHint,
    );

    if (resolved.clipType === 'audio') {
      const next = upsertClipOnDedicatedTrack(audioTracks, clip, edge.source);
      audioTracks.splice(0, audioTracks.length, ...next);
    } else {
      const next = upsertClipOnDedicatedTrack(videoTracks, clip, edge.source);
      videoTracks.splice(0, videoTracks.length, ...next);
    }
  }

  if (videoTracks.length === 0) videoTracks.push([]);

  const hasIncomingAudio = incoming.some((e) => {
    const n = nodes.find((x) => x.id === e.source);
    const m = n ? resolveTimelineMediaFromSource(n, e) : null;
    return m?.clipType === 'audio';
  });
  if (audioTracks.length === 0 && hasIncomingAudio) audioTracks.push([]);

  const track0 = videoTracks[0] ?? [];
  return {
    videoClips: track0,
    videoTracks,
    audioTracks: audioTracks.length > 0 || hasIncomingAudio ? audioTracks : [[]],
  };
}

export function timelineClipsFingerprint(
  videoClipsOrTracks: TimelineClipRecord[] | TimelineClipRecord[][],
  audioTracks: TimelineClipRecord[][],
): string {
  const seg = (c: TimelineClipRecord) =>
    `${c.id}|${c.sourceNodeId || ''}|${c.src}|${c.startTime}|${c.duration}|${c.trimStart ?? ''}|${c.trimEnd ?? ''}|${c.lockTrim ? 1 : 0}|${c.hasAlpha ? 1 : 0}|${c.type}`;
  const videoTracks = Array.isArray(videoClipsOrTracks[0])
    ? (videoClipsOrTracks as TimelineClipRecord[][])
    : [videoClipsOrTracks as TimelineClipRecord[]];
  const v = videoTracks.flatMap((track, ti) => track.map((c) => `v${ti}:${seg(c)}`));
  const a = audioTracks.flatMap((track, ti) => track.map((c) => `a${ti}:${seg(c)}`));
  return `${v.join(';')}::${a.join(';')}`;
}
