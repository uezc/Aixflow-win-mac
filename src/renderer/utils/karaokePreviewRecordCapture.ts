/**
 * 卡拉OK「录制预览导出」：
 * - 片源文件作 ffmpeg 主输入（全分辨率硬编 overlay）
 * - 仅抓透明歌词叠层 raw；无词时段写全透明（不 seek、不复用烂画面）
 * - 有词可见窗才 setPlayTime + capturePage；片尾停、禁 loop
 */

import {
  applyGlobalOffsetToLines,
  clampKaraokeLineFadeOutSec,
  DEFAULT_KARAOKE_STYLE,
  findActiveSingableIndex,
  findFadingSingableLine,
  KARAOKE_LINE_FADE_OUT_SEC,
  karaokeCountdownOverlayNeedsUniqueFrame,
  karaokeLineSingStartSec,
  karaokeOpeningCaptureBusyUntilSec,
  karaokeOpeningTimelineForProject,
  karaokeOverlayNeedsUniqueFrame,
  karaokeReentryCountdownWindowsForLines,
  prepareKaraokeLinesForRender,
} from '../../shared/karaoke';

export type KaraokePreviewRecordProgress = {
  phase: 'prepare' | 'capture' | 'encode' | 'done';
  frame: number;
  total: number;
  percent: number;
  message?: string;
  encoder?: string;
  /** 相对片长的墙钟倍率（越大越快） */
  speed?: number;
};

export type RunKaraokePreviewRecordParams = {
  projectId: string | undefined;
  videoUrl: string;
  project: unknown;
  durationSec: number;
  fps?: number;
  videoEl: HTMLVideoElement;
  getStageEl: () => HTMLElement | null;
  getOverlayEl?: () => HTMLElement | null;
  setCaptureClean: (clean: boolean) => void;
  setPlayTime: (t: number) => void;
  setRecordStageSize?: (size: { w: number; h: number } | null) => void;
  isCancelled: () => boolean;
  onProgress?: (p: KaraokePreviewRecordProgress) => void;
};

export type RunKaraokePreviewRecordResult = {
  success: boolean;
  canceled?: boolean;
  timedOut?: boolean;
  originalUrl?: string;
  originalPath?: string;
  posterUrl?: string;
  width?: number;
  height?: number;
  error?: string;
  engine?: 'record' | 'css' | 'ass';
  encoder?: string;
};

/** 超过此时长禁止回退方案 A */
export const KARAOKE_RECORD_NO_CSS_FALLBACK_SEC = 90;
/** 长片阈值 */
export const KARAOKE_RECORD_LONG_SEC = 120;

/** overlay-raw chunk：空 = 透明；1 字节 = 复用上一叠层 */
const OVERLAY_CHUNK_EMPTY = new ArrayBuffer(0);
const OVERLAY_CHUNK_REUSE = Uint8Array.of(0).buffer;

function evenDim(n: number): number {
  const v = Math.max(2, Math.round(n));
  return v % 2 === 0 ? v : v + 1;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, Math.max(0, ms)));
}

function fmtMmSs(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${String(r).padStart(2, '0')}`;
}

function waitPaint(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

function resolveOverlayEl(params: RunKaraokePreviewRecordParams): HTMLElement | null {
  try {
    const custom = params.getOverlayEl?.();
    if (custom) return custom;
  } catch {
    /* ignore */
  }
  const stage = params.getStageEl();
  return (
    (stage?.querySelector('[data-nexflow-karaoke-overlay="1"]') as HTMLElement | null) ||
    null
  );
}

/** 待唱/在唱/淡出等「字幕可能可见」窗（无词长段返回 false） */
function karaokeOverlayContentLikely(
  lines: ReturnType<typeof prepareKaraokeLinesForRender>,
  t: number,
  fadeOutSec: number,
  awaitingLeadInSec = 12,
): boolean {
  if (findActiveSingableIndex(lines, t) >= 0) return true;
  if (findFadingSingableLine(lines, t, fadeOutSec)) return true;
  const list = Array.isArray(lines) ? lines : [];
  for (const line of list) {
    if (!line?.chars?.length) continue;
    const start = karaokeLineSingStartSec(line);
    if (!Number.isFinite(start)) continue;
    if (t >= start - awaitingLeadInSec && t < start) return true;
  }
  return false;
}

/** 离线 fps：叠层路径不再 seek 片源，可维持较高帧率 */
function pickOfflineFps(durationSec: number, requested?: number): number {
  if (Number.isFinite(Number(requested)) && Number(requested) >= 8) {
    return Math.min(30, Math.round(Number(requested)));
  }
  if (durationSec > 20 * 60) return 20;
  if (durationSec > KARAOKE_RECORD_LONG_SEC) return 24;
  return 30;
}

/**
 * 原片 + 透明叠层 raw → 主进程 ffmpeg overlay 硬编。
 * 无词：空 chunk（主进程写全透明）；不 seek 复用烂帧。
 */
async function runOverlayRawRecord(
  params: RunKaraokePreviewRecordParams,
  videoW: number,
  videoH: number,
  fps: number,
  durationSec: number,
): Promise<RunKaraokePreviewRecordResult> {
  const api = window.electronAPI;
  if (
    !api?.karaokePreviewRecordSessionStart ||
    !api?.karaokePreviewRecordSessionChunk ||
    !api?.karaokePreviewRecordSessionFinish ||
    !api?.karaokeCapturePageRect
  ) {
    return {
      success: false,
      error:
        '录制预览 API 未加载。请完全退出 Electron → npm run build:main → 再开。',
    };
  }

  const video = params.videoEl;
  const project = params.project as any;
  const frameCount = Math.max(1, Math.ceil(durationSec * fps));
  const speedHint = durationSec > KARAOKE_RECORD_LONG_SEC ? 6 : 3;
  const etaHintSec = Math.max(20, durationSec / speedHint);

  params.setCaptureClean(true);
  // 舞台拉到片源分辨率，叠层按全分辨率渲染（禁止缩小）
  params.setRecordStageSize?.({ w: videoW, h: videoH });
  await sleep(80);
  await waitPaint();
  await waitPaint();

  const prevLoop = video.loop;
  const prevRate = video.playbackRate;
  video.loop = false;
  try {
    video.playbackRate = 1;
  } catch {
    /* ignore */
  }
  try {
    video.pause();
  } catch {
    /* ignore */
  }

  const ovEl = resolveOverlayEl(params);
  if (!ovEl) {
    params.setRecordStageSize?.(null);
    params.setCaptureClean(false);
    return { success: false, error: '找不到字幕预览层，无法抓叠层' };
  }
  const ovRect = ovEl.getBoundingClientRect();
  const capW = evenDim(Math.max(2, ovRect.width));
  const capH = evenDim(Math.max(2, ovRect.height));

  const start = await api.karaokePreviewRecordSessionStart(
    params.projectId,
    params.videoUrl,
    params.project,
    {
      width: capW,
      height: capH,
      fps,
      durationSec,
      mode: 'overlay-raw',
    },
  );
  if (!start?.success || !start.sessionId) {
    video.loop = prevLoop;
    try {
      video.playbackRate = prevRate;
    } catch {
      /* ignore */
    }
    params.setRecordStageSize?.(null);
    params.setCaptureClean(false);
    return { success: false, error: start?.error || 'session start failed' };
  }
  const sessionId = start.sessionId;
  const enc = start.encoder || '';
  const outLabel = `${start.outWidth || videoW}×${start.outHeight || videoH}`;

  params.onProgress?.({
    phase: 'prepare',
    frame: 0,
    total: frameCount,
    percent: 1,
    speed: speedHint,
    message: `渲染叠层 · ${outLabel} · ~${speedHint}x · 预计 ${fmtMmSs(etaHintSec)} · ${enc || ''}`,
    encoder: enc,
  });

  const offsetLines = prepareKaraokeLinesForRender(
    applyGlobalOffsetToLines(
      project?.lines || [],
      Number(project?.globalOffsetSec) || 0,
    ),
    undefined,
    project?.lyrics,
  );
  const fadeOutSec = clampKaraokeLineFadeOutSec(
    project?.style?.lineFadeOutSec ??
      DEFAULT_KARAOKE_STYLE.lineFadeOutSec ??
      KARAOKE_LINE_FADE_OUT_SEC,
  );
  const openingTl = karaokeOpeningTimelineForProject(project);
  const openingBusyUntil = karaokeOpeningCaptureBusyUntilSec(
    openingTl,
    project?.previewOpeningCredits,
  );
  const reentryCountdownWindows = karaokeReentryCountdownWindowsForLines(offsetLines, {
    fadeOutSec,
    style: project?.style,
  });

  const wasMuted = video.muted;
  video.muted = true;

  const wallStart = performance.now();
  let framesWritten = 0;
  let uniquePainted = 0;
  let emptyFrames = 0;
  let reusedFrames = 0;
  let wasBusy = true;
  let wasAnimating = true;
  let hasLastOverlay = false;

  const captureOverlayRaw = async (): Promise<ArrayBuffer | null> => {
    const ov = resolveOverlayEl(params);
    if (!ov) return null;
    const r = ov.getBoundingClientRect();
    try {
      const cap = await api.karaokeCapturePageRect({
        x: Math.round(r.left),
        y: Math.round(r.top),
        width: capW,
        height: capH,
      });
      if (!cap?.success || !cap.raw) return null;
      const raw = cap.raw as ArrayBuffer | Uint8Array;
      if (raw instanceof ArrayBuffer) return raw;
      return raw.buffer.slice(
        raw.byteOffset,
        raw.byteOffset + raw.byteLength,
      ) as ArrayBuffer;
    } catch {
      return null;
    }
  };

  try {
    for (let frameIndex = 0; frameIndex < frameCount; frameIndex++) {
      if (params.isCancelled()) {
        await api.karaokePreviewRecordSessionAbort?.(sessionId);
        return { success: false, canceled: true, error: 'cancelled' };
      }

      const t = Math.min(durationSec, frameIndex / fps);
      const uniqueEps = 0.5 / fps;
      const opening = t < openingBusyUntil;
      const countdownBusy = karaokeCountdownOverlayNeedsUniqueFrame(
        t,
        reentryCountdownWindows,
        uniqueEps,
      );
      const animating =
        opening ||
        countdownBusy ||
        karaokeOverlayNeedsUniqueFrame(offsetLines, t, {
          fadeOutSec,
          eps: uniqueEps,
        });
      const contentLikely =
        opening ||
        countdownBusy ||
        karaokeOverlayContentLikely(offsetLines, t, fadeOutSec);
      const busy = animating || contentLikely;

      let chunk: ArrayBuffer;
      if (!busy && !wasBusy) {
        // 无词长段：全透明，片源画面由 ffmpeg 从原文件解码（不 seek 预览 video）
        chunk = OVERLAY_CHUNK_EMPTY;
        emptyFrames += 1;
        hasLastOverlay = false;
      } else if (
        busy &&
        !animating &&
        wasBusy &&
        !wasAnimating &&
        hasLastOverlay
      ) {
        // 有词静止段：复用上一叠层（主进程 1 字节标记）
        chunk = OVERLAY_CHUNK_REUSE;
        reusedFrames += 1;
      } else {
        try {
          params.setPlayTime(t);
        } catch {
          /* ignore */
        }
        // 仅驱动叠层时间；不把预览 video 画进成片。偶发 seek 仅用于预览 UI 对齐，可跳过以提速
        await waitPaint();
        await waitPaint();
        const raw = await captureOverlayRaw();
        if (!raw) {
          await api.karaokePreviewRecordSessionAbort?.(sessionId);
          return { success: false, error: 'overlay capture failed' };
        }
        chunk = raw;
        uniquePainted += 1;
        hasLastOverlay = true;
      }

      wasBusy = busy;
      wasAnimating = animating;

      const wr = await api.karaokePreviewRecordSessionChunk(sessionId, chunk);
      if (!wr?.success) {
        await api.karaokePreviewRecordSessionAbort?.(sessionId);
        const err = wr?.error || 'write overlay failed';
        if (/cancel/i.test(err)) {
          return { success: false, canceled: true, error: 'cancelled' };
        }
        return { success: false, error: err };
      }
      framesWritten += 1;

      if (frameIndex % 8 === 0 || frameIndex + 1 === frameCount) {
        const elapsedSec = (performance.now() - wallStart) / 1000;
        const ratio = Math.max(0.001, (frameIndex + 1) / frameCount);
        const etaSec = Math.max(0, elapsedSec / ratio - elapsedSec);
        const speedNow =
          elapsedSec > 0.5 ? durationSec / Math.max(elapsedSec, 0.5) : speedHint;
        const percent = Math.min(88, Math.max(2, Math.round(ratio * 86) + 2));
        params.onProgress?.({
          phase: 'capture',
          frame: framesWritten,
          total: frameCount,
          percent,
          speed: speedNow,
          message: `渲染叠层 ${fmtMmSs(t)}/${fmtMmSs(durationSec)} · ~${speedNow.toFixed(1)}x · ETA ${fmtMmSs(etaSec)} · 抓${uniquePainted}/透${emptyFrames}/复用${reusedFrames}`,
          encoder: enc,
        });
      }
    }

    // 片尾：停住，禁止重播
    try {
      video.pause();
      video.loop = false;
      if (Number.isFinite(video.duration) && video.duration > 0) {
        video.currentTime = Math.min(video.duration, durationSec);
      }
    } catch {
      /* ignore */
    }

    params.onProgress?.({
      phase: 'encode',
      frame: frameCount,
      total: frameCount,
      percent: 92,
      message: `封装叠加中（原片 ${outLabel} + 叠层）… · ${enc || ''}`,
      encoder: enc,
    });

    const fin = await api.karaokePreviewRecordSessionFinish(sessionId);
    if (fin?.canceled) return { success: false, canceled: true, error: 'cancelled' };
    if (!fin?.success) {
      return {
        success: false,
        timedOut: fin?.timedOut,
        error: fin?.error || 'finalize failed',
      };
    }

    const wallSec = (performance.now() - wallStart) / 1000;
    const speedFinal = wallSec > 0.2 ? durationSec / wallSec : speedHint;
    params.onProgress?.({
      phase: 'done',
      frame: frameCount,
      total: frameCount,
      percent: 100,
      speed: speedFinal,
      message: `完成 · 耗时 ${fmtMmSs(wallSec)}（约 ${speedFinal.toFixed(1)}x）· ${outLabel}`,
      encoder: fin.encoder || enc,
    });

    return {
      success: true,
      originalUrl: fin.originalUrl,
      originalPath: fin.originalPath,
      posterUrl: fin.posterUrl,
      width: fin.width,
      height: fin.height,
      engine: 'record',
      encoder: fin.encoder || enc,
    };
  } catch (e: any) {
    try {
      await api.karaokePreviewRecordSessionAbort?.(sessionId);
    } catch {
      /* ignore */
    }
    const msg = String(e?.message || e || '');
    if (/cancel|abort/i.test(msg)) {
      return { success: false, canceled: true, error: 'cancelled' };
    }
    return { success: false, error: msg || 'overlay record failed' };
  } finally {
    try {
      video.muted = wasMuted;
      video.loop = prevLoop;
      video.playbackRate = prevRate;
      video.pause();
    } catch {
      /* ignore */
    }
    params.setRecordStageSize?.(null);
    params.setCaptureClean(false);
  }
}

export async function runKaraokePreviewRecord(
  params: RunKaraokePreviewRecordParams,
): Promise<RunKaraokePreviewRecordResult> {
  const video = params.videoEl;
  const vw = evenDim(video.videoWidth || 0);
  const vh = evenDim(video.videoHeight || 0);
  if (!(vw >= 2 && vh >= 2)) {
    return { success: false, error: 'video dimensions unavailable（请等预览视频加载完成）' };
  }

  const durationSec = Math.max(0.2, Number(params.durationSec) || 0.2);
  const fps = pickOfflineFps(durationSec, params.fps);

  if (!window.electronAPI?.karaokePreviewRecordSessionStart) {
    return {
      success: false,
      error:
        '录制预览 API 未加载。请完全退出 Electron → npm run build:main → 再开后重试。长视频请勿改用方案 A。',
    };
  }

  const res = await runOverlayRawRecord(params, vw, vh, fps, durationSec);
  if (res.success || res.canceled || res.timedOut) return res;

  if (durationSec > KARAOKE_RECORD_NO_CSS_FALLBACK_SEC) {
    return {
      success: false,
      error:
        `录制预览失败：${String(res.error || '').slice(0, 200)}\n` +
        `成片约 ${fmtMmSs(durationSec)}，已禁止回退方案 A 逐帧。\n` +
        `请取消 → 完全退出 Electron 再开 → 重试。`,
    };
  }

  const api = window.electronAPI;
  if (!api?.karaokeCssBurn) {
    return { success: false, error: res.error || 'record failed' };
  }
  console.warn('[karaoke] overlay record failed (short), css-burn fallback:', res.error);
  params.setCaptureClean(true);
  let unsub: (() => void) | undefined;
  if (api.onKaraokeCssBurnProgress) {
    unsub = api.onKaraokeCssBurnProgress((p) => {
      if (params.isCancelled()) return;
      params.onProgress?.({
        phase: p.phase,
        frame: p.frame,
        total: p.total,
        percent: p.percent,
        message: p.message || 'css-burn',
      });
    });
  }
  try {
    const css = await api.karaokeCssBurn(
      params.projectId,
      params.videoUrl,
      params.project,
      { fps, durationSec, lowSpec: false, preferSmooth: true },
    );
    return { ...css, engine: css?.engine || 'css' };
  } catch (e: any) {
    const msg = String(e?.message || e || '');
    if (/cancel|abort/i.test(msg)) return { success: false, canceled: true, error: 'cancelled' };
    return { success: false, error: msg || res.error };
  } finally {
    try {
      unsub?.();
    } catch {
      /* ignore */
    }
    params.setCaptureClean(false);
  }
}
