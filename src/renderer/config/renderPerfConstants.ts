import { PERF_POLICY } from './perfPolicy';

/** 解码器名额制：最大并发视频解码数，防止 WebGL/GPU 崩溃
 * [暴力单例化] 暂时硬编码为 1：仅 activeVideoNodeId 解码，其余一律 poster */
export const MAX_DECODERS = 1;

// 画布级统一渲染性能常量（优先用于视觉层控制）
export const CROSS_FADE_MS = PERF_POLICY.crossFadeMs;
export const INTERACTION_UNLOCK_DELAY_MS = PERF_POLICY.interactionUnlockDelayMs;
export const LOW_RES_OPACITY = PERF_POLICY.lowResOpacity;
export const LOD_HYSTERESIS = PERF_POLICY.lodHysteresis;
export const FAR_PLACEHOLDER_HYSTERESIS = PERF_POLICY.farPlaceholderHysteresis;

