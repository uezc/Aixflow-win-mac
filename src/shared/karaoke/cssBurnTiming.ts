/**
 * 方案 A CSS 烧录：帧率解析与固定步长时间轴（主进程 / smoke 共用）。
 */

/** 默认抓帧 FPS（非低配、非强制流畅时的基准） */
export const KARAOKE_CSS_BURN_DEFAULT_FPS = 48;
/**
 * 办公本 / 低配抓帧 FPS。
 * 须封顶，禁止再跟片源抬到 50/60（否则核显本上 3–4 分钟歌可烧十几二十分钟）。
 */
export const KARAOKE_CSS_BURN_LOW_SPEC_FPS = 24;
/** 流畅档 FPS（preferSmooth 基准；UI「高清流畅」跟片源时 ≥ 此值） */
export const KARAOKE_CSS_BURN_SMOOTH_FPS = 48;
/** FPS 硬上限 */
export const KARAOKE_CSS_BURN_MAX_FPS = 60;

/** UI 质量挡位：稳定（ASS 滤镜）/ 快速 / 标准 / 流畅 / 高清流畅 */
export type KaraokeCssBurnQualityPreset = 'stable' | 'fast' | 'standard' | 'smooth' | 'hq';

/** 快速档（办公本友好 / 极速） */
export const KARAOKE_CSS_BURN_FAST_FPS = 16;
/** 标准档 */
export const KARAOKE_CSS_BURN_STANDARD_FPS = 24;
/** 流畅档（UI 挡位，非 preferSmooth 的 48） */
export const KARAOKE_CSS_BURN_FLUID_FPS = 30;

export const KARAOKE_CSS_BURN_QUALITY_PRESET_IDS: readonly KaraokeCssBurnQualityPreset[] = [
  'stable',
  'fast',
  'standard',
  'smooth',
  'hq',
] as const;

export function isKaraokeCssBurnQualityPreset(
  v: unknown,
): v is KaraokeCssBurnQualityPreset {
  return (
    v === 'stable' ||
    v === 'fast' ||
    v === 'standard' ||
    v === 'smooth' ||
    v === 'hq'
  );
}

/**
 * 挡位 → karaokeCssBurn 调用参数。
 * 显式 fps 优先于自动降档；hq 走 preferSmooth（≥48，片源 50/60 跟片源）。
 * lowSpec 仅影响抓帧边长：快速/标准在办公本上仍缩小边以加速。
 */
export function karaokeCssBurnOptionsFromQualityPreset(
  preset: KaraokeCssBurnQualityPreset,
  opts?: { lowSpecMachine?: boolean },
): {
  fps?: number;
  preferSmooth: boolean;
  lowSpec: boolean;
} {
  const office = !!opts?.lowSpecMachine;
  switch (preset) {
    case 'stable':
      return {
        preferSmooth: false,
        lowSpec: office,
      };
    case 'fast':
      return {
        fps: KARAOKE_CSS_BURN_FAST_FPS,
        preferSmooth: false,
        lowSpec: office,
      };
    case 'standard':
      return {
        fps: KARAOKE_CSS_BURN_STANDARD_FPS,
        preferSmooth: false,
        lowSpec: office,
      };
    case 'smooth':
      return {
        fps: KARAOKE_CSS_BURN_FLUID_FPS,
        preferSmooth: false,
        lowSpec: false,
      };
    case 'hq':
      return {
        preferSmooth: true,
        lowSpec: false,
      };
    default:
      return {
        fps: KARAOKE_CSS_BURN_STANDARD_FPS,
        preferSmooth: false,
        lowSpec: office,
      };
  }
}

/** 低配默认标准；高性能默认流畅（30fps） */
export function defaultKaraokeCssBurnQualityPreset(
  lowSpecMachine: boolean,
): KaraokeCssBurnQualityPreset {
  return lowSpecMachine ? 'standard' : 'smooth';
}

/** 规范化片源帧率到常见整数档，便于 CFR 叠层对齐 */
export function normalizeKaraokeSourceFps(raw: number): number {
  if (!(raw > 0) || !Number.isFinite(raw)) return 0;
  const candidates = [24, 25, 30, 48, 50, 60];
  let best = candidates[0];
  let bestAbs = Math.abs(best - raw);
  for (const c of candidates) {
    const d = Math.abs(c - raw);
    if (d < bestAbs) {
      best = c;
      bestAbs = d;
    }
  }
  if (bestAbs <= 0.51) return best;
  return Math.min(KARAOKE_CSS_BURN_MAX_FPS, Math.max(1, Math.round(raw)));
}

/**
 * 解析烧录抓帧 FPS：
 * - preferSmooth：≥48，片源 50/60 时跟片源（封顶 MAX）
 * - lowSpec：封顶 24，绝不追片源抬高（办公本）
 * - 其它：默认档，可跟片源抬高
 */
export function resolveKaraokeCssBurnFps(opts?: {
  fps?: number;
  lowSpec?: boolean;
  preferSmooth?: boolean;
  sourceFps?: number;
}): number {
  const fpsRaw = Number(opts?.fps);
  if (Number.isFinite(fpsRaw) && fpsRaw >= 1) {
    return Math.min(KARAOKE_CSS_BURN_MAX_FPS, Math.max(1, Math.round(fpsRaw)));
  }

  const preferSmooth = opts?.preferSmooth !== false;
  const sourceN = normalizeKaraokeSourceFps(Number(opts?.sourceFps) || 0);

  if (preferSmooth) {
    const floor = KARAOKE_CSS_BURN_SMOOTH_FPS;
    return Math.min(KARAOKE_CSS_BURN_MAX_FPS, Math.max(floor, sourceN || floor));
  }

  // 办公本：硬封顶，片源更高也不抬
  if (opts?.lowSpec) {
    const cap = KARAOKE_CSS_BURN_LOW_SPEC_FPS;
    if (sourceN > 0) return Math.max(1, Math.min(cap, sourceN));
    return cap;
  }

  const floor = KARAOKE_CSS_BURN_DEFAULT_FPS;
  return Math.min(KARAOKE_CSS_BURN_MAX_FPS, Math.max(floor, sourceN || floor));
}

/** 固定步长时间轴：按整毫秒对齐，避免 frameIndex/fps 浮点抖 */
export function karaokeCssBurnFrameTimeSec(frameIndex: number, fps: number): number {
  const f = Math.max(1, fps);
  const i = Math.max(0, Math.floor(frameIndex));
  return Math.round((i * 1000) / f) / 1000;
}
