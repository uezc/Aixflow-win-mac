/**
 * 卡拉OK 合成：方案 A（CSS 半扫）或「稳定」挡位（ffmpeg ass 滤镜）。
 * 方案 A 失败时主进程会自动回退 ASS。不再使用 html2canvas。
 */

import {
  KARAOKE_CSS_BURN_DEFAULT_FPS,
  KARAOKE_CSS_BURN_FAST_FPS,
  KARAOKE_CSS_BURN_FLUID_FPS,
  KARAOKE_CSS_BURN_LOW_SPEC_FPS,
  KARAOKE_CSS_BURN_MAX_FPS,
  KARAOKE_CSS_BURN_SMOOTH_FPS,
  KARAOKE_CSS_BURN_STANDARD_FPS,
  defaultKaraokeCssBurnQualityPreset,
  isKaraokeCssBurnQualityPreset,
  karaokeCssBurnOptionsFromQualityPreset,
  type KaraokeCssBurnQualityPreset,
} from '../../shared/karaoke/cssBurnTiming';

export type KaraokePreviewComposeProgress = {
  phase: 'begin' | 'capture' | 'finalize';
  frame: number;
  total: number;
  percent: number;
  message?: string;
  fps?: number;
  etaSeconds?: number | null;
  lowSpec?: boolean;
};

/** 默认 FPS（与主进程 KARAOKE_CSS_BURN_DEFAULT_FPS 对齐；主进程还可跟片源抬高） */
export const KARAOKE_PREVIEW_COMPOSE_DEFAULT_FPS = KARAOKE_CSS_BURN_DEFAULT_FPS;
/** 办公本 / 低配默认 FPS（与主进程 LOW_SPEC=24 对齐） */
export const KARAOKE_PREVIEW_COMPOSE_LOW_SPEC_FPS = KARAOKE_CSS_BURN_LOW_SPEC_FPS;
/** 高清流畅档（与主进程 SMOOTH=48 对齐） */
export const KARAOKE_PREVIEW_COMPOSE_SMOOTH_FPS = KARAOKE_CSS_BURN_SMOOTH_FPS;
/** FPS 硬上限（与主进程 MAX=60 对齐） */
export const KARAOKE_PREVIEW_COMPOSE_MAX_FPS = KARAOKE_CSS_BURN_MAX_FPS;

export type { KaraokeCssBurnQualityPreset };
export {
  KARAOKE_CSS_BURN_FAST_FPS,
  KARAOKE_CSS_BURN_STANDARD_FPS,
  KARAOKE_CSS_BURN_FLUID_FPS,
  karaokeCssBurnOptionsFromQualityPreset,
  defaultKaraokeCssBurnQualityPreset,
};

const COMPOSE_QUALITY_LS_KEY = 'nexflow_karaoke_compose_quality';

/** 读取上次合成质量挡位；无记录则按机器规格给默认 */
export function loadKaraokeComposeQualityPreset(): KaraokeCssBurnQualityPreset {
  try {
    if (typeof localStorage !== 'undefined') {
      const raw = localStorage.getItem(COMPOSE_QUALITY_LS_KEY);
      if (isKaraokeCssBurnQualityPreset(raw)) return raw;
    }
  } catch {
    /* ignore */
  }
  return defaultKaraokeCssBurnQualityPreset(detectKaraokeLowSpecMachine());
}

export function saveKaraokeComposeQualityPreset(
  preset: KaraokeCssBurnQualityPreset,
): void {
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(COMPOSE_QUALITY_LS_KEY, preset);
    }
  } catch {
    /* ignore */
  }
}

/**
 * 办公本 / 低配探测：核数≤4 或 deviceMemory≤8GB。
 * 命中后走 24fps 封顶 + 更小抓帧边，避免「合成到视频」卡在中段十几二十分钟。
 */
export function detectKaraokeLowSpecMachine(): boolean {
  try {
    const cores = Number(navigator.hardwareConcurrency) || 0;
    const memGb = Number(
      (navigator as Navigator & { deviceMemory?: number }).deviceMemory,
    );
    if (cores > 0 && cores <= 4) return true;
    if (Number.isFinite(memGb) && memGb > 0 && memGb <= 8) return true;
    if (!(cores > 0) && !(Number.isFinite(memGb) && memGb > 0)) return true;
    return false;
  } catch {
    return true;
  }
}

/** @deprecated 方案 A 不再在渲染进程抓帧，恒为 false */
export function isKaraokePreviewComposeMemoryPressure(): boolean {
  return false;
}

export type RunKaraokePreviewComposeParams = {
  projectId: string | undefined;
  videoUrl: string;
  project: unknown;
  durationSec: number;
  fps?: number;
  lowSpec?: boolean;
  /**
   * 流畅优先。undefined = 按 detectKaraokeLowSpecMachine 自动
   *（办公本 false，高性能机 true）。
   */
  preferSmooth?: boolean;
  /**
   * UI 质量挡位：优先于裸 fps/preferSmooth/lowSpec。
   * 选定后显式传入主进程，覆盖自动降档。
   */
  qualityPreset?: KaraokeCssBurnQualityPreset;
  /** 兼容旧签名；方案 A 忽略（主进程隐藏窗自渲） */
  getCaptureEl?: () => HTMLElement | null;
  setPlayTime?: (t: number) => void;
  isCancelled: () => boolean;
  onProgress?: (p: KaraokePreviewComposeProgress) => void;
};

export type RunKaraokePreviewComposeResult = {
  success: boolean;
  canceled?: boolean;
  timedOut?: boolean;
  originalUrl?: string;
  originalPath?: string;
  posterUrl?: string;
  width?: number;
  height?: number;
  error?: string;
  engine?: 'css' | 'ass';
};

async function runKaraokeAssBurn(
  params: RunKaraokePreviewComposeParams,
  reason: 'stable' | 'fallback',
): Promise<RunKaraokePreviewComposeResult> {
  const api = window.electronAPI;
  if (!api?.karaokeBurnSubtitles) {
    return { success: false, error: 'ass burn API unavailable' };
  }
  params.onProgress?.({
    phase: 'finalize',
    frame: 0,
    total: 1,
    percent: reason === 'stable' ? 8 : 90,
    message: reason === 'stable' ? 'ass stable' : 'fallback ass',
  });
  try {
    if (params.isCancelled()) {
      return { success: false, canceled: true, error: 'cancelled' };
    }
    const res = await api.karaokeBurnSubtitles(
      params.projectId,
      params.videoUrl,
      params.project,
    );
    if (params.isCancelled() && !res?.canceled) {
      try {
        await api.karaokeCancelBurn?.();
      } catch {
        /* ignore */
      }
      return { success: false, canceled: true, error: 'cancelled' };
    }
    return { ...res, engine: res?.success ? ('ass' as const) : undefined };
  } catch (e: any) {
    const msg = String(e?.message || e || '');
    if (/cancel|abort/i.test(msg)) {
      return { success: false, canceled: true, error: 'cancelled' };
    }
    return { success: false, error: msg || 'ass burn failed' };
  }
}

/**
 * 方案 A：主进程隐藏窗字幕层 capturePage → ffmpeg pipe overlay。
 * 「稳定」挡位直接走 ffmpeg ass 滤镜（不抓帧、不写 stdin）。
 * 不传 fps 时由主进程按片源/机器规格选择。
 */
export async function runKaraokePreviewCompose(
  params: RunKaraokePreviewComposeParams,
): Promise<RunKaraokePreviewComposeResult> {
  if (params.qualityPreset === 'stable') {
    return runKaraokeAssBurn(params, 'stable');
  }

  const api = window.electronAPI;
  if (!api?.karaokeCssBurn) {
    return { success: false, error: 'css burn API unavailable' };
  }

  const lowSpecMachine = detectKaraokeLowSpecMachine();
  const fromPreset =
    params.qualityPreset != null
      ? karaokeCssBurnOptionsFromQualityPreset(params.qualityPreset, {
          lowSpecMachine,
        })
      : null;
  const preferSmooth = fromPreset
    ? fromPreset.preferSmooth
    : params.preferSmooth !== undefined
      ? !!params.preferSmooth
      : !lowSpecMachine;
  const lowSpec = fromPreset
    ? fromPreset.lowSpec
    : preferSmooth
      ? false
      : params.lowSpec !== undefined
        ? !!params.lowSpec
        : lowSpecMachine;
  const durationSec = Math.max(0.2, Number(params.durationSec) || 0.2);
  const fpsRaw = Number(fromPreset?.fps ?? params.fps);
  const fpsOpt =
    Number.isFinite(fpsRaw) && fpsRaw >= 1
      ? Math.min(
          KARAOKE_PREVIEW_COMPOSE_MAX_FPS,
          Math.max(1, Math.round(fpsRaw)),
        )
      : undefined;
  const explicitOpts = fromPreset != null ||
    params.preferSmooth !== undefined ||
    params.lowSpec !== undefined ||
    fpsOpt != null;

  params.onProgress?.({
    phase: 'begin',
    frame: 0,
    total: 1,
    percent: 1,
    message: lowSpec
      ? 'preparing (office/low-spec)'
      : preferSmooth
        ? 'preparing (smooth)'
        : 'preparing',
    lowSpec,
  });

  let unsub: (() => void) | undefined;
  if (api.onKaraokeCssBurnProgress) {
    unsub = api.onKaraokeCssBurnProgress((p) => {
      if (params.isCancelled()) return;
      const phase: KaraokePreviewComposeProgress['phase'] =
        p.phase === 'encode' || p.phase === 'done'
          ? 'finalize'
          : p.phase === 'prepare'
            ? 'begin'
            : 'capture';
      params.onProgress?.({
        phase,
        frame: p.frame,
        total: p.total,
        percent: p.percent,
        message: p.message,
        fps: p.fps,
        etaSeconds: p.etaSeconds,
        lowSpec: p.lowSpec ?? lowSpec,
      });
    });
  }

  try {
    if (params.isCancelled()) {
      return { success: false, canceled: true, error: 'cancelled' };
    }
    console.info(
      '[karaoke] invoke karaokeCssBurn (Plan A)',
      params.qualityPreset ? `preset=${params.qualityPreset}` : 'preset=none',
      fpsOpt != null ? `fps=${fpsOpt}` : 'fps=auto',
      preferSmooth ? 'preferSmooth' : lowSpec ? 'lowSpec' : 'default',
      !explicitOpts ? '(renderer hint; main may refine)' : '',
    );
    const res = await api.karaokeCssBurn(
      params.projectId,
      params.videoUrl,
      params.project,
      {
        ...(fpsOpt != null ? { fps: fpsOpt } : {}),
        durationSec,
        // 挡位或显式参数时传入；否则主进程按 CPU/内存自动办公本降帧
        ...(explicitOpts ? { lowSpec, preferSmooth } : {}),
      },
    );
    if (params.isCancelled() && !res?.canceled) {
      try {
        await api.karaokeCancelBurn?.();
      } catch {
        /* ignore */
      }
      return { success: false, canceled: true, error: 'cancelled' };
    }
    if (res?.success && res.engine === 'ass') {
      console.info('[karaoke] karaokeCssBurn recovered via ASS');
      return res;
    }
    if (res?.success) {
      console.info('[karaoke] karaokeCssBurn ok engine=css');
    }
    return res;
  } catch (e: any) {
    const msg = String(e?.message || e || '');
    if (/cancel|abort/i.test(msg)) {
      return { success: false, canceled: true, error: 'cancelled' };
    }
    return { success: false, error: msg || 'css burn failed' };
  } finally {
    try {
      unsub?.();
    } catch {
      /* ignore */
    }
  }
}
