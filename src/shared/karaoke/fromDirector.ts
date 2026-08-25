/**
 * 从导演台 mvMusic / 成片 URL 组装 KaraokeProject（不要求用户重复上传）。
 */

import {
  calibrateLyricSegmentsWithUserLyrics,
  normalizeDirectorMvLyricSegments,
  type DirectorMvLyricSegment,
} from '../directorPipeline/lyricTimeline.js';
import type { DirectorMvMusic, DirectorPipelineState } from '../directorPipeline/schema.js';
import { buildKaraokeAss } from './buildAss.js';
import {
  createDefaultKaraokeStyle,
  normalizeKaraokeAsrLanguage,
  resolveKaraokeAudioSource,
  type KaraokeAsrWordTiming,
  type KaraokeProject,
} from './types.js';
import {
  buildKaraokeLinesFromAvailable,
  buildKaraokeLinesFromCalibratedSegments,
  flattenAsrWordsFromSegments,
  looksLikeLrc,
} from './wordTiming.js';

export interface KaraokeDirectorSource {
  music?: Pick<
    DirectorMvMusic,
    | 'url'
    | 'lyrics'
    | 'durationSec'
    | 'lyricSegments'
    | 'lyricSegmentsStatus'
    | 'title'
    | 'songTitle'
    | 'lyricist'
    | 'composer'
    | 'lyricAsrWords'
    | 'asrLanguage'
  > | null;
  videoUrl?: string;
  globalOffsetSec?: number;
}

function normalizeProjectAsrWords(raw: unknown): KaraokeAsrWordTiming[] {
  if (!Array.isArray(raw)) return [];
  const out: KaraokeAsrWordTiming[] = [];
  for (const w of raw) {
    if (!w || typeof w !== 'object') continue;
    const o = w as Record<string, unknown>;
    const text = String(o.text || '').trim();
    if (!text) continue;
    const startSec = Number(o.startSec) || 0;
    const endSec = Number(o.endSec) || startSec;
    out.push({
      text,
      startSec,
      endSec: endSec >= startSec ? endSec : startSec,
    });
  }
  return out;
}

export function karaokeProjectFromDirectorSource(src: KaraokeDirectorSource): KaraokeProject {
  const music = src.music;
  const lyrics = String(music?.lyrics || '').trim();
  const songDurationSec = Math.max(0, Number(music?.durationSec) || 0);
  const asrWords = normalizeProjectAsrWords(music?.lyricAsrWords);
  const { lines, timingSource, weakAlignment } = buildKaraokeLinesFromAvailable({
    lyrics,
    lyricSegments: music?.lyricSegments,
    songDurationSec,
    asrWords: asrWords.length > 0 ? asrWords : undefined,
  });
  const audioUrl = String(music?.url || '').trim() || undefined;
  const videoUrl = String(src.videoUrl || '').trim() || undefined;
  return {
    version: 1,
    audioUrl,
    videoUrl,
    audioSource: resolveKaraokeAudioSource({ audioUrl, videoUrl }),
    lyrics,
    songTitle: String(music?.songTitle || '').trim(),
    lyricist: String(music?.lyricist || '').trim(),
    composer: String(music?.composer || '').trim(),
    previewOpeningCredits: true,
    songDurationSec,
    globalOffsetSec: Number(src.globalOffsetSec) || 0,
    timingSource,
    lines,
    asrLanguage: normalizeKaraokeAsrLanguage(music?.asrLanguage),
    ...(asrWords.length > 0 ? { asrWords } : {}),
    ...(weakAlignment ? { weakLineAlignment: true } : {}),
    style: createDefaultKaraokeStyle(),
    updatedAt: Date.now(),
  };
}

export function karaokeProjectFromDirectorState(
  state: Pick<DirectorPipelineState, 'mvMusic'> | null | undefined,
  videoUrl?: string,
): KaraokeProject {
  return karaokeProjectFromDirectorSource({
    music: state?.mvMusic,
    videoUrl,
  });
}

/** lyricSegments 是否足够用于卡拉OK（有人声句） */
export function hasTrustedKaraokeLyricSegments(
  segments: DirectorMvLyricSegment[] | undefined | null,
): boolean {
  const segs = normalizeDirectorMvLyricSegments(segments);
  return segs.some((s) => !s.instrumental && String(s.text || '').trim().length > 0);
}

/**
 * 接线策略：
 * - 已有 asrWords 字级 → 直接用
 * - 有音频 + 歌词 → 必须云端字级 ASR（禁止把均分/句级插值当完成）
 * - 无音频时：LRC / 已有句级可本地用（估算）
 */
export type KaraokeTimingPlan =
  | { action: 'use-existing'; reason: 'lyricSegments' | 'lrc' | 'asrWords' }
  | { action: 'need-asr'; reason: 'no-timing' }
  | { action: 'blocked'; reason: 'no-lyrics-or-audio' };

export function planKaraokeTiming(project: KaraokeProject): KaraokeTimingPlan {
  const lyrics = String(project.lyrics || '').trim();
  const audioOrVideo =
    String(project.audioUrl || '').trim() || String(project.videoUrl || '').trim();
  const hasLines = (project.lines || []).some((l) => !l.instrumental && l.chars.length > 0);
  const hasAsrWords =
    project.timingSource === 'asrWords' &&
    Array.isArray(project.asrWords) &&
    project.asrWords.length > 0 &&
    hasLines;

  if (hasAsrWords) {
    return { action: 'use-existing', reason: 'asrWords' };
  }

  // 有音频时：禁止把均分 / 句级插值当作成功结果，必须再跑字级 ASR
  if (audioOrVideo && lyrics) {
    return { action: 'need-asr', reason: 'no-timing' };
  }

  if (looksLikeLrc(lyrics)) {
    return { action: 'use-existing', reason: 'lrc' };
  }
  if (
    hasTrustedKaraokeLyricSegments(
      project.lines.map((l) => ({
        id: l.id,
        text: l.text,
        startSec: l.startSec,
        endSec: l.endSec,
        instrumental: l.instrumental,
      })),
    ) &&
    hasLines
  ) {
    return { action: 'use-existing', reason: 'lyricSegments' };
  }
  if (!lyrics && !audioOrVideo) {
    return { action: 'blocked', reason: 'no-lyrics-or-audio' };
  }
  if (!lyrics) {
    return { action: 'blocked', reason: 'no-lyrics-or-audio' };
  }
  // 无音频、仅歌词：本地均分兜底
  if (hasLines) {
    return { action: 'use-existing', reason: 'lyricSegments' };
  }
  return { action: 'need-asr', reason: 'no-timing' };
}

export type AsrSegmentWithWords = DirectorMvLyricSegment & {
  words?: KaraokeAsrWordTiming[];
};

/**
 * ASR 句级结果（+ 字级 words）+ 用户歌词 → 字级工程。
 * 有 words 时：按行在 ASR words 流上独立对齐（漏句插值，不拖偏后续）。
 * 无 words 时仍可校准出行级，但 timingSource 不会是 asrWords（调用方应视为字级失败）。
 */
export function applyAsrSegmentsToKaraokeProject(
  project: KaraokeProject,
  whisperSegments: AsrSegmentWithWords[],
): KaraokeProject {
  const fromSegs = flattenAsrWordsFromSegments(whisperSegments);
  const flatWords =
    fromSegs.length > 0 ? fromSegs : normalizeProjectAsrWords(project.asrWords);
  const songDur = Math.max(
    0,
    Number(project.songDurationSec) || 0,
    ...whisperSegments.map((s) => Number(s?.endSec) || 0),
    ...(flatWords.length ? [flatWords[flatWords.length - 1].endSec] : []),
  );
  // 句级校准仍用于软先验 / 间奏占位；字级以按行独立对齐为准
  const calibrated = calibrateLyricSegmentsWithUserLyrics(
    whisperSegments,
    project.lyrics,
    songDur,
  );
  const { lines, timingSource, weakAlignment } = buildKaraokeLinesFromCalibratedSegments(
    calibrated,
    flatWords.length > 0 ? flatWords : undefined,
    project.lyrics,
  );
  return {
    ...project,
    songDurationSec: Math.max(Number(project.songDurationSec) || 0, songDur),
    timingSource,
    lines,
    weakLineAlignment: weakAlignment === true,
    ...(flatWords.length > 0 ? { asrWords: flatWords } : { asrWords: undefined }),
    updatedAt: Date.now(),
  };
}

export function karaokeAssFromProject(project: KaraokeProject): string {
  return buildKaraokeAss(project);
}

/** 是否为可复用的 KaraokeProject（version/lines/timingSource 合法） */
export function isValidKaraokeProject(raw: unknown): raw is KaraokeProject {
  if (!raw || typeof raw !== 'object') return false;
  const o = raw as Record<string, unknown>;
  if (o.version !== 1) return false;
  if (!Array.isArray(o.lines)) return false;
  const timing = String(o.timingSource || '').trim();
  if (!timing) return false;
  return true;
}

export type KaraokeVideoMediaSource = {
  videoUrl?: string;
  audioUrl?: string;
  /** 已有工程：合法则合并 videoUrl / 时长后返回 */
  existing?: KaraokeProject | null;
  mediaDurationSec?: number;
};

/**
 * 从视频节点媒体组装 KaraokeProject（独立入口，不依赖导演台 mvMusic）。
 * - 有合法 existing → 合并 videoUrl / audioUrl / 时长
 * - 否则创建空白默认工程（manual 时间轴）
 */
export function karaokeProjectFromVideoMedia(
  src: KaraokeVideoMediaSource,
): KaraokeProject {
  const videoUrl = String(src.videoUrl || '').trim() || undefined;
  const audioUrl = String(src.audioUrl || '').trim() || undefined;
  const mediaDur = Math.max(0, Number(src.mediaDurationSec) || 0);

  if (isValidKaraokeProject(src.existing)) {
    const mergedAudioUrl = audioUrl ?? src.existing.audioUrl;
    const mergedVideoUrl = videoUrl ?? src.existing.videoUrl;
    const prevDur = Math.max(0, Number(src.existing.songDurationSec) || 0);
    return {
      ...src.existing,
      ...(mergedAudioUrl ? { audioUrl: String(mergedAudioUrl).trim() || undefined } : {}),
      ...(mergedVideoUrl ? { videoUrl: String(mergedVideoUrl).trim() || undefined } : {}),
      songDurationSec: mediaDur > 0 ? Math.max(prevDur, mediaDur) : prevDur,
      audioSource: resolveKaraokeAudioSource({
        audioSource: src.existing.audioSource,
        audioUrl: mergedAudioUrl,
        videoUrl: mergedVideoUrl,
      }),
      updatedAt: Date.now(),
    };
  }

  return {
    version: 1,
    audioUrl,
    videoUrl,
    audioSource: resolveKaraokeAudioSource({ audioUrl, videoUrl }),
    lyrics: '',
    songDurationSec: mediaDur,
    globalOffsetSec: 0,
    timingSource: 'manual',
    lines: [],
    style: createDefaultKaraokeStyle(),
    updatedAt: Date.now(),
  };
}
