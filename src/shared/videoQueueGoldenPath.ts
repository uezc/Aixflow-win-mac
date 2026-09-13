/**
 * Phase 8.1 / 9.2 / 9.3-B / 9.3-D / 9.4 / 9.5-B-1 / 9.5-B-2-B / 9.5-B-3-B：Video Generation Golden Path（Unified Queue）
 * - rhart-video-x T2V / I2V → runninghub.ai
 * - minimax-h3-t2v / minimax-h3-i2v / minimax-h3-multi / minimax-h3-audio → runninghub.cn
 * - ltx-2.3-t2v → runninghub.ai（forward.rhRegion；不改全局路由表）
 * - ltx-2.3-i2v → runninghub.cn（OSS HTTPS URL，非 RH fileName）
 * - gemini-omni-flash → runninghub.ai（OSS HTTPS imageUrls；duration 为 string）
 * - rh-video-start-end → runninghub.cn（双图 OSS HTTPS；ai-app 2048742865043460098）
 * - rhart-v3.1-pro-se → runninghub.ai（OpenAPI start-end-to-video；1–2 张 OSS HTTPS；duration="8"）
 * - ltx-2.3-lipsync → runninghub.cn（图+音 OSS HTTPS；ai-app 2029400959335534594；无 duration SKU 维）
 * - seedance-2.0-fast → runninghub.cn（OpenAPI multimodal；0–9 图 OSS HTTPS；无音/视频）
 * - seedance-2.0-mini → runninghub.cn（OpenAPI multimodal；0–9 图 + 可选视频/音频；conversionSlots）
 * - wan-animate → runninghub.cn（ai-app 2048978834447409154；1 图 + 1 视频 OSS HTTPS；无 audio）
 * - wan-animate-2 → runninghub.cn（ai-app 2086818758475210753；1 图 + 1 视频 OSS HTTPS；提示词选填；按秒计费）
 * - rhart-video-upscaler → runninghub.cn（OpenAPI /rhart-video/video-upscaler；仅 1 视频 OSS HTTPS；视频处理/超分，非生成）
 * - hey-gem → runninghub.cn（ai-app 2071200225913565185；1 参考视频 + 1 驱动音频 OSS HTTPS；数字人；SKU hey-gem-plus）
 * - grok-3-stable → runninghub.ai（OpenAPI /rhart-video-g-official/reference-to-video；1–7 图 OSS HTTPS；仅 720p；时长 6|10 string）
 * Feature Gate：VIDEO_QUEUE_ENABLED / VITE_VIDEO_QUEUE_ENABLED
 * - 未设置时默认开启
 * - 显式 0/false/off：Queue-only 型号报错（P0 起禁止回落 Direct）
 * - VIDEO_QUEUE_ONLY_MODEL_IDS：已 Adapter 型号强制 Queue（含 hey-gem / grok-3-stable）
 */

import { minimaxH3MegapixelsForResolution } from '../common/minimaxH3Resolution.js';

function readEnvFlag(raw: string | undefined, defaultOn = true): boolean {
  if (raw == null || String(raw).trim() === '') return defaultOn;
  const v = String(raw).trim().toLowerCase();
  if (v === '0' || v === 'false' || v === 'no' || v === 'off') return false;
  return v === '1' || v === 'true' || v === 'yes' || v === 'on';
}

/** 主进程：process.env.VIDEO_QUEUE_ENABLED（未设置默认 true） */
export function isVideoQueueGoldenPathEnabled(): boolean {
  if (typeof process !== 'undefined' && process.env && 'VIDEO_QUEUE_ENABLED' in process.env) {
    return readEnvFlag(process.env.VIDEO_QUEUE_ENABLED, true);
  }
  return true;
}

/** 渲染进程：import.meta.env.VITE_VIDEO_QUEUE_ENABLED（未设置默认 true） */
export function isVideoQueueGoldenPathEnabledRenderer(): boolean {
  try {
    const vite = (import.meta as ImportMeta & { env?: Record<string, string> }).env;
    if (vite && 'VITE_VIDEO_QUEUE_ENABLED' in vite) {
      return readEnvFlag(vite.VITE_VIDEO_QUEUE_ENABLED, true);
    }
  } catch {
    /* ignore */
  }
  return true;
}

export const VIDEO_QUEUE_GOLDEN_MODEL = 'rhart-video-x' as const;
export const VIDEO_QUEUE_H3_T2V_MODEL = 'minimax-h3-t2v' as const;
export const VIDEO_QUEUE_H3_I2V_MODEL = 'minimax-h3-i2v' as const;
export const VIDEO_QUEUE_H3_MULTI_MODEL = 'minimax-h3-multi' as const;
export const VIDEO_QUEUE_H3_AUDIO_MODEL = 'minimax-h3-audio' as const;
export const VIDEO_QUEUE_LTX23_T2V_MODEL = 'ltx-2.3-t2v' as const;
export const VIDEO_QUEUE_LTX23_I2V_MODEL = 'ltx-2.3-i2v' as const;
export const VIDEO_QUEUE_GEMINI_OMNI_FLASH_MODEL = 'gemini-omni-flash' as const;
export const VIDEO_QUEUE_RH_VIDEO_START_END_MODEL = 'rh-video-start-end' as const;
export const VIDEO_QUEUE_RHART_V31_PRO_SE_MODEL = 'rhart-v3.1-pro-se' as const;
export const VIDEO_QUEUE_LTX23_LIPSYNC_MODEL = 'ltx-2.3-lipsync' as const;
export const VIDEO_QUEUE_SEEDANCE_20_FAST_MODEL = 'seedance-2.0-fast' as const;
export const VIDEO_QUEUE_SEEDANCE_20_MINI_MODEL = 'seedance-2.0-mini' as const;
export const VIDEO_QUEUE_WAN_ANIMATE_MODEL = 'wan-animate' as const;
export const VIDEO_QUEUE_WAN_ANIMATE_2_MODEL = 'wan-animate-2' as const;
export const VIDEO_QUEUE_RHART_VIDEO_UPSCALER_MODEL = 'rhart-video-upscaler' as const;
export const VIDEO_QUEUE_HEY_GEM_MODEL = 'hey-gem' as const;
export const VIDEO_QUEUE_GROK_3_STABLE_MODEL = 'grok-3-stable' as const;

/**
 * P0：已具备 Queue Adapter 的型号 —— 禁止再走 rhPostChargeVideo Direct。
 */
export const VIDEO_QUEUE_ONLY_MODEL_IDS = [
  VIDEO_QUEUE_GOLDEN_MODEL,
  VIDEO_QUEUE_H3_T2V_MODEL,
  VIDEO_QUEUE_H3_I2V_MODEL,
  VIDEO_QUEUE_H3_MULTI_MODEL,
  VIDEO_QUEUE_H3_AUDIO_MODEL,
  VIDEO_QUEUE_LTX23_T2V_MODEL,
  VIDEO_QUEUE_LTX23_I2V_MODEL,
  VIDEO_QUEUE_GEMINI_OMNI_FLASH_MODEL,
  VIDEO_QUEUE_RH_VIDEO_START_END_MODEL,
  VIDEO_QUEUE_RHART_V31_PRO_SE_MODEL,
  VIDEO_QUEUE_LTX23_LIPSYNC_MODEL,
  VIDEO_QUEUE_SEEDANCE_20_FAST_MODEL,
  VIDEO_QUEUE_SEEDANCE_20_MINI_MODEL,
  VIDEO_QUEUE_WAN_ANIMATE_MODEL,
  VIDEO_QUEUE_WAN_ANIMATE_2_MODEL,
  VIDEO_QUEUE_RHART_VIDEO_UPSCALER_MODEL,
  VIDEO_QUEUE_HEY_GEM_MODEL,
  VIDEO_QUEUE_GROK_3_STABLE_MODEL,
] as const;

export type VideoQueueOnlyModelId = (typeof VIDEO_QUEUE_ONLY_MODEL_IDS)[number];

const VIDEO_QUEUE_ONLY_SET = new Set<string>(VIDEO_QUEUE_ONLY_MODEL_IDS);

/** 是否已迁移且禁止 Direct 回落 */
export function isVideoQueueOnlyModel(modelId: unknown): boolean {
  return VIDEO_QUEUE_ONLY_SET.has(String(modelId ?? '').trim());
}

/**
 * Direct 计费入口守卫：Queue-only 型号调用时抛错（防止漏网 rhPostChargeVideo）。
 */
export function assertNotDirectChargeForQueueOnlyModel(modelId: unknown, via = 'direct'): void {
  const m = String(modelId ?? '').trim();
  if (!VIDEO_QUEUE_ONLY_SET.has(m)) return;
  throw new Error(
    `QUEUE_ONLY_MODEL_DIRECT_FORBIDDEN:${m} 已强制云端排队，禁止 Direct（via=${via}）`,
  );
}

/** Seedance 2.0 Fast OpenAPI（与 VideoProvider Direct 一致） */
export const SEEDANCE_20_FAST_RUN_PATH = '/rhart-video/sparkvideo-2.0-fast/multimodal-video' as const;

/** Seedance 2.0 Mini OpenAPI（与 VideoProvider Direct 一致） */
export const SEEDANCE_20_MINI_RUN_PATH = '/rhart-video/sparkvideo-2.0-mini/multimodal-video' as const;

/** WanAnimate 角色替换 ai-app（与 VideoProvider Direct 一致） */
export const WAN_ANIMATE_APP_ID = '2048978834447409154' as const;
export const WAN_ANIMATE_RUN_PATH = `/run/ai-app/${WAN_ANIMATE_APP_ID}` as const;

/** Wan animate2 视频换人 ai-app（与 VideoProvider Direct 一致；与 wan-animate 不同） */
export const WAN_ANIMATE_2_APP_ID = '2086818758475210753' as const;
export const WAN_ANIMATE_2_RUN_PATH = `/run/ai-app/${WAN_ANIMATE_2_APP_ID}` as const;

/** 视频超分放大 OpenAPI（与 VideoProvider Direct / common/rhartVideoUpscaler 一致；无 ai-app） */
export const RHART_VIDEO_UPSCALER_RUN_PATH = '/rhart-video/video-upscaler' as const;

/** HeyGem 数字人 ai-app（与 VideoProvider Direct 一致） */
export const HEY_GEM_APP_ID = '2071200225913565185' as const;
export const HEY_GEM_RUN_PATH = `/run/ai-app/${HEY_GEM_APP_ID}` as const;

/** Grok video3 plus 参考图生 OpenAPI（与 VideoProvider Direct 一致） */
export const GROK_3_STABLE_RUN_PATH = '/rhart-video-g-official/reference-to-video' as const;

/** LTX2.3 对口型 ai-app（与 VideoProvider Direct 一致） */
export const LTX23_LIPSYNC_APP_ID = '2029400959335534594' as const;
export const LTX23_LIPSYNC_RUN_PATH = `/run/ai-app/${LTX23_LIPSYNC_APP_ID}` as const;

/** 全能视频V3.1-pro 首尾帧 OpenAPI（与 VideoProvider Direct 一致） */
export const RHART_V31_PRO_SE_RUN_PATH = '/rhart-video-v3.1-pro/start-end-to-video' as const;

/** MiniMax-H3 文生 ai-app（与 VideoProvider / Smoke PASS 一致） */
export const MINIMAX_H3_T2V_APP_ID = '2085682347676102657' as const;
export const MINIMAX_H3_T2V_RUN_PATH = `/run/ai-app/${MINIMAX_H3_T2V_APP_ID}` as const;

/** MiniMax-H3 图生 ai-app（与 VideoProvider Direct 一致） */
export const MINIMAX_H3_I2V_APP_ID = '2085687129061019649' as const;
export const MINIMAX_H3_I2V_RUN_PATH = `/run/ai-app/${MINIMAX_H3_I2V_APP_ID}` as const;

/** MiniMax-H3 全能参考 ai-app（与 VideoProvider Direct 一致） */
export const MINIMAX_H3_MULTI_APP_ID = '2086289185186603010' as const;
export const MINIMAX_H3_MULTI_RUN_PATH = `/run/ai-app/${MINIMAX_H3_MULTI_APP_ID}` as const;

/** MiniMax-H3 口型同步 ai-app（与 VideoProvider Direct 一致） */
export const MINIMAX_H3_AUDIO_APP_ID = '2086260808442531842' as const;
export const MINIMAX_H3_AUDIO_RUN_PATH = `/run/ai-app/${MINIMAX_H3_AUDIO_APP_ID}` as const;

/** LTX2.3 文生 ai-app（与 VideoProvider Direct 路径一致） */
export const LTX23_T2V_APP_ID = '2034994243982336001' as const;
export const LTX23_T2V_RUN_PATH = `/run/ai-app/${LTX23_T2V_APP_ID}` as const;

/** LTX2.3 图生 ai-app（与 VideoProvider Direct 一致） */
export const LTX23_I2V_APP_ID = '2034955204851933186' as const;
export const LTX23_I2V_RUN_PATH = `/run/ai-app/${LTX23_I2V_APP_ID}` as const;

export type VideoQueueProviderForward = {
  provider: 'runninghub';
  path: string;
  method: 'POST';
  body: Record<string, unknown>;
  billingModelId?: string;
  rhRegion?: 'cn' | 'ai';
};

function isRhartVideoXQueueBypass(input: Record<string, unknown>): boolean {
  // 导演/短剧/批量旁路（本阶段不迁移）
  if (input.directorSpawned === true || input.drama === true) return true;
  if (String(input.actionPrompt || '').trim() && !input.prompt) return true;
  return false;
}

function countNonEmptyImages(input: Record<string, unknown>): number {
  const images = Array.isArray(input.images) ? input.images : [];
  return images.filter((u) => String(u || '').trim()).length;
}

/** 画布 rhart-video-x 文生视频是否走 queue golden path（显式 nxCloudQueueGoldenPath=true） */
export function isCanvasRhartVideoXT2vQueueGoldenPathInput(input: Record<string, unknown>): boolean {
  if (input.nxCloudQueueGoldenPath !== true) return false;
  const model = String(input.model || VIDEO_QUEUE_GOLDEN_MODEL);
  if (model !== VIDEO_QUEUE_GOLDEN_MODEL) return false;
  if (countNonEmptyImages(input) > 0) return false;
  if (isRhartVideoXQueueBypass(input)) return false;
  return true;
}

/**
 * 画布 rhart-video-x 图生视频是否走 queue golden path（Phase 9.3-D）
 * 要求 1–7 张图；实际 HTTPS imageUrls 由 VideoProvider 在 Create 前预处理写入 forward。
 */
export function isCanvasRhartVideoXI2vQueueGoldenPathInput(input: Record<string, unknown>): boolean {
  if (input.nxCloudQueueGoldenPath !== true) return false;
  const model = String(input.model || VIDEO_QUEUE_GOLDEN_MODEL);
  if (model !== VIDEO_QUEUE_GOLDEN_MODEL) return false;
  const n = countNonEmptyImages(input);
  if (n < 1 || n > 7) return false;
  if (isRhartVideoXQueueBypass(input)) return false;
  return true;
}

/** @deprecated 兼容旧名；请用 isCanvasRhartVideoXT2vQueueGoldenPathInput */
export const isCanvasSora2T2vQueueGoldenPathInput = isCanvasRhartVideoXT2vQueueGoldenPathInput;

/** 画布 minimax-h3-t2v 文生视频是否走 queue golden path */
export function isCanvasMinimaxH3T2vQueueGoldenPathInput(input: Record<string, unknown>): boolean {
  if (input.nxCloudQueueGoldenPath !== true) return false;
  const model = String(input.model || '').trim();
  if (model !== VIDEO_QUEUE_H3_T2V_MODEL) return false;
  const images = Array.isArray(input.images) ? input.images : [];
  const hasImages = images.some((u) => String(u || '').trim());
  if (hasImages) return false;
  if (input.directorSpawned === true || input.drama === true) return false;
  if (String(input.actionPrompt || '').trim() && !input.prompt) return false;
  return true;
}

/**
 * 画布 minimax-h3-i2v 图生视频是否走 queue golden path（Phase 9.4）
 * 恰好 1 张参考图；RH fileName 由 VideoProvider 在 Create 前写入 nodeInfoList。
 */
export function isCanvasMinimaxH3I2vQueueGoldenPathInput(input: Record<string, unknown>): boolean {
  if (input.nxCloudQueueGoldenPath !== true) return false;
  const model = String(input.model || '').trim();
  if (model !== VIDEO_QUEUE_H3_I2V_MODEL) return false;
  if (countNonEmptyImages(input) !== 1) return false;
  if (input.directorSpawned === true || input.drama === true) return false;
  if (String(input.actionPrompt || '').trim() && !input.prompt) return false;
  return true;
}

/**
 * 画布 minimax-h3-multi 全能参考是否走 queue golden path
 * 0–9 张参考图 + 可选参考音；RH fileName 由 VideoProvider 在 Create 前写入 nodeInfoList。
 */
export function isCanvasMinimaxH3MultiQueueGoldenPathInput(input: Record<string, unknown>): boolean {
  if (input.nxCloudQueueGoldenPath !== true) return false;
  const model = String(input.model || '').trim();
  if (model !== VIDEO_QUEUE_H3_MULTI_MODEL) return false;
  const n = countNonEmptyImages(input);
  if (n > 9) return false;
  if (input.directorSpawned === true || input.drama === true) return false;
  if (String(input.actionPrompt || '').trim() && !input.prompt) return false;
  return true;
}

/**
 * 画布 minimax-h3-audio 口型同步是否走 queue golden path
 * 1–5 张参考图 + 必填 inputAudioUrl；RH fileName 由 VideoProvider 在 Create 前写入 nodeInfoList。
 * 注意：RH 工作流无时长节点；duration 仅用于计费 SKU。
 */
export function isCanvasMinimaxH3AudioQueueGoldenPathInput(input: Record<string, unknown>): boolean {
  if (input.nxCloudQueueGoldenPath !== true) return false;
  const model = String(input.model || '').trim();
  if (model !== VIDEO_QUEUE_H3_AUDIO_MODEL) return false;
  const n = countNonEmptyImages(input);
  if (n < 1 || n > 5) return false;
  if (!String(input.inputAudioUrl || '').trim()) return false;
  if (input.directorSpawned === true || input.drama === true) return false;
  if (String(input.actionPrompt || '').trim() && !input.prompt) return false;
  return true;
}

/** 画布 ltx-2.3-t2v 文生视频是否走 queue golden path（仅文生，无参考图） */
export function isCanvasLtx23T2vQueueGoldenPathInput(input: Record<string, unknown>): boolean {
  if (input.nxCloudQueueGoldenPath !== true) return false;
  const model = String(input.model || '').trim();
  if (model !== VIDEO_QUEUE_LTX23_T2V_MODEL) return false;
  const images = Array.isArray(input.images) ? input.images : [];
  const hasImages = images.some((u) => String(u || '').trim());
  if (hasImages) return false;
  if (input.directorSpawned === true || input.drama === true) return false;
  if (String(input.actionPrompt || '').trim() && !input.prompt) return false;
  return true;
}

/**
 * 画布 ltx-2.3-i2v 图生视频是否走 queue golden path（Phase 9.5-B-1）
 * 恰好 1 张参考图；OSS HTTPS 由 VideoProvider 在 Create 前写入 nodeInfoList。
 */
export function isCanvasLtx23I2vQueueGoldenPathInput(input: Record<string, unknown>): boolean {
  if (input.nxCloudQueueGoldenPath !== true) return false;
  const model = String(input.model || '').trim();
  if (model !== VIDEO_QUEUE_LTX23_I2V_MODEL) return false;
  if (countNonEmptyImages(input) !== 1) return false;
  if (input.directorSpawned === true || input.drama === true) return false;
  if (String(input.actionPrompt || '').trim() && !input.prompt) return false;
  return true;
}

/**
 * 画布 gemini-omni-flash 图生视频是否走 queue golden path（Phase 9.5-B-2-B）
 * 恰好 1 或 3 张参考图；OSS HTTPS imageUrls 由 VideoProvider 在 Create 前写入 forward。
 */
export function isCanvasGeminiOmniFlashQueueGoldenPathInput(input: Record<string, unknown>): boolean {
  if (input.nxCloudQueueGoldenPath !== true) return false;
  const model = String(input.model || '').trim();
  if (model !== VIDEO_QUEUE_GEMINI_OMNI_FLASH_MODEL) return false;
  const n = countNonEmptyImages(input);
  if (n !== 1 && n !== 3) return false;
  if (input.directorSpawned === true || input.drama === true) return false;
  if (String(input.actionPrompt || '').trim() && !input.prompt) return false;
  return true;
}

/**
 * 画布 rh-video-start-end（LTX2.3 首位帧）是否走 queue golden path（Phase 9.5-B-3-B）
 * 恰好 2 张参考图；OSS HTTPS 由 VideoProvider 在 Create 前写入 nodeInfoList。
 */
export function isCanvasRhVideoStartEndQueueGoldenPathInput(input: Record<string, unknown>): boolean {
  if (input.nxCloudQueueGoldenPath !== true) return false;
  const model = String(input.model || '').trim();
  if (model !== VIDEO_QUEUE_RH_VIDEO_START_END_MODEL) return false;
  if (countNonEmptyImages(input) !== 2) return false;
  if (input.directorSpawned === true || input.drama === true) return false;
  if (String(input.actionPrompt || '').trim() && !input.prompt) return false;
  return true;
}

/**
 * 画布 rhart-v3.1-pro-se（全能视频V3.1-pro 首尾帧）是否走 queue golden path（Phase 9.5-B-4-B）
 * 1–2 张参考图（首帧必填、尾帧可选）；OSS HTTPS 由 VideoProvider 在 Create 前写入 forward。
 */
export function isCanvasRhArtV31ProSeQueueGoldenPathInput(input: Record<string, unknown>): boolean {
  if (input.nxCloudQueueGoldenPath !== true) return false;
  const model = String(input.model || '').trim();
  if (model !== VIDEO_QUEUE_RHART_V31_PRO_SE_MODEL) return false;
  const n = countNonEmptyImages(input);
  if (n < 1 || n > 2) return false;
  if (input.directorSpawned === true || input.drama === true) return false;
  if (String(input.actionPrompt || '').trim() && !input.prompt) return false;
  return true;
}

/**
 * 画布 ltx-2.3-lipsync 对口型是否走 queue golden path（Phase 9.5-B-5-B）
 * 恰好 1 张图 + 非空 inputAudioUrl；OSS HTTPS 由 VideoProvider 在 Create 前写入 forward。
 */
export function isCanvasLtx23LipsyncQueueGoldenPathInput(input: Record<string, unknown>): boolean {
  if (input.nxCloudQueueGoldenPath !== true) return false;
  const model = String(input.model || '').trim();
  if (model !== VIDEO_QUEUE_LTX23_LIPSYNC_MODEL) return false;
  if (countNonEmptyImages(input) !== 1) return false;
  if (!String(input.inputAudioUrl || '').trim()) return false;
  if (input.directorSpawned === true || input.drama === true) return false;
  return true;
}

/**
 * 画布 seedance-2.0-fast 是否走 queue golden path（Phase 9.5-B-6-B）
 * 0–9 张图；禁止 audio / referenceVideo（音视频归 Mini / 其他模型）。
 */
export function isCanvasSeedance20FastQueueGoldenPathInput(input: Record<string, unknown>): boolean {
  if (input.nxCloudQueueGoldenPath !== true) return false;
  const model = String(input.model || '').trim();
  if (model !== VIDEO_QUEUE_SEEDANCE_20_FAST_MODEL) return false;
  const n = countNonEmptyImages(input);
  if (n < 0 || n > 9) return false;
  if (String(input.inputAudioUrl || '').trim()) return false;
  if (Array.isArray(input.inputAudioUrls) && input.inputAudioUrls.some((u) => String(u || '').trim())) {
    return false;
  }
  if (String(input.referenceVideoUrl || '').trim()) return false;
  if (input.directorSpawned === true || input.drama === true) return false;
  return true;
}

/**
 * 画布 seedance-2.0-mini 是否走 queue golden path（Phase 9.5-B-7-B）
 * 0–9 张图；允许 referenceVideo / inputAudio（与 Fast 严格隔离）。
 */
export function isCanvasSeedance20MiniQueueGoldenPathInput(input: Record<string, unknown>): boolean {
  if (input.nxCloudQueueGoldenPath !== true) return false;
  const model = String(input.model || '').trim();
  if (model !== VIDEO_QUEUE_SEEDANCE_20_MINI_MODEL) return false;
  const n = countNonEmptyImages(input);
  if (n < 0 || n > 9) return false;
  if (input.directorSpawned === true || input.drama === true) return false;
  return true;
}

/**
 * 画布 wan-animate 是否走 queue golden path（Phase 9.5-B-8-B）
 * 恰好 1 张图 + 非空 referenceVideoUrl；禁止 audio；不含 wan-animate-2。
 */
export function isCanvasWanAnimateQueueGoldenPathInput(input: Record<string, unknown>): boolean {
  if (input.nxCloudQueueGoldenPath !== true) return false;
  const model = String(input.model || '').trim();
  if (model !== VIDEO_QUEUE_WAN_ANIMATE_MODEL) return false;
  if (countNonEmptyImages(input) !== 1) return false;
  if (!String(input.referenceVideoUrl || '').trim()) return false;
  if (String(input.inputAudioUrl || '').trim()) return false;
  if (Array.isArray(input.inputAudioUrls) && input.inputAudioUrls.some((u) => String(u || '').trim())) {
    return false;
  }
  if (input.directorSpawned === true || input.drama === true) return false;
  return true;
}

/**
 * 画布 wan-animate-2 视频换人是否走 queue golden path
 * 恰好 1 张图 + 非空 referenceVideoUrl；提示词选填；禁止 audio。
 * 与 wan-animate 不同 appId / nodeInfoList / 计费（按秒 Quantity）。
 */
export function isCanvasWanAnimate2QueueGoldenPathInput(input: Record<string, unknown>): boolean {
  if (input.nxCloudQueueGoldenPath !== true) return false;
  const model = String(input.model || '').trim();
  if (model !== VIDEO_QUEUE_WAN_ANIMATE_2_MODEL) return false;
  if (countNonEmptyImages(input) !== 1) return false;
  if (!String(input.referenceVideoUrl || '').trim()) return false;
  if (String(input.inputAudioUrl || '').trim()) return false;
  if (Array.isArray(input.inputAudioUrls) && input.inputAudioUrls.some((u) => String(u || '').trim())) {
    return false;
  }
  if (input.directorSpawned === true || input.drama === true) return false;
  return true;
}

/**
 * 画布 rhart-video-upscaler（视频处理/超分）是否走 queue golden path
 * 仅需非空 referenceVideoUrl；不要求图/音/prompt；排除 drama/director。
 */
export function isCanvasRhartVideoUpscalerQueueGoldenPathInput(
  input: Record<string, unknown>,
): boolean {
  if (input.nxCloudQueueGoldenPath !== true) return false;
  const model = String(input.model || '').trim();
  if (model !== VIDEO_QUEUE_RHART_VIDEO_UPSCALER_MODEL) return false;
  if (!String(input.referenceVideoUrl || '').trim()) return false;
  if (input.directorSpawned === true || input.drama === true) return false;
  return true;
}

/**
 * 画布 hey-gem 数字人是否走 queue golden path
 * 非空 referenceVideoUrl + inputAudioUrl（TTS 须在 Create 前完成）；排除 drama/director。
 */
export function isCanvasHeyGemQueueGoldenPathInput(input: Record<string, unknown>): boolean {
  if (input.nxCloudQueueGoldenPath !== true) return false;
  const model = String(input.model || '').trim();
  if (model !== VIDEO_QUEUE_HEY_GEM_MODEL) return false;
  if (!String(input.referenceVideoUrl || '').trim()) return false;
  if (!String(input.inputAudioUrl || '').trim()) return false;
  if (input.directorSpawned === true || input.drama === true) return false;
  return true;
}

/**
 * 画布 grok-3-stable（Grok video3 plus）参考图生是否走 queue golden path
 * 1–7 张参考图；仅 I2V；排除 drama/director。
 */
export function isCanvasGrok3StableQueueGoldenPathInput(input: Record<string, unknown>): boolean {
  if (input.nxCloudQueueGoldenPath !== true) return false;
  const model = String(input.model || '').trim();
  if (model !== VIDEO_QUEUE_GROK_3_STABLE_MODEL) return false;
  const n = countNonEmptyImages(input);
  if (n < 1 || n > 7) return false;
  if (input.directorSpawned === true || input.drama === true) return false;
  if (String(input.actionPrompt || '').trim() && !input.prompt) return false;
  return true;
}

/**
 * LTX T2V 分辨率档 → 宽高（与 VideoProvider Direct 路径一致）
 * UI: 720|1280|1920；旧数据 1080 → 1920
 */
export function mapLtx23T2vWh(
  resolutionRaw: string | undefined,
  aspectRatio: string | undefined,
): { w: number; h: number; res: '720' | '1280' | '1920' } {
  const resRaw = String(resolutionRaw || '720').trim();
  const res = (resRaw === '1080' ? '1920' : resRaw) as string;
  const r: '720' | '1280' | '1920' =
    res === '720' || res === '1280' || res === '1920' ? res : '720';
  const ratio = aspectRatio === '9:16' || aspectRatio === '16:9' ? aspectRatio : '16:9';
  if (r === '720') return ratio === '16:9' ? { w: 1280, h: 720, res: r } : { w: 720, h: 1280, res: r };
  if (r === '1280') return ratio === '16:9' ? { w: 1280, h: 720, res: r } : { w: 720, h: 1280, res: r };
  return ratio === '16:9' ? { w: 1920, h: 1080, res: r } : { w: 1080, h: 1920, res: r };
}

/**
 * 前端短比例 → RunningHub MiniMax-H3 aspect_ratio 长标签
 * （与 VideoProvider 旧路径 map 对齐；Smoke 使用 16:9 (Widescreen)）
 */
export function mapMinimaxH3AspectRatioForRh(aspectRatio: string | undefined): string {
  const map: Record<string, string> = {
    '1:1': '1:1 (Square)',
    '2:3': '2:3 (Portrait Photo)',
    '3:2': '3:2 (Photo)',
    '3:4': '3:4 (Portrait Standard)',
    '4:3': '4:3 (Standard)',
    '9:16': '9:16 (Portrait Widescreen)',
    '16:9': '16:9 (Widescreen)',
    '21:9': '21:9 (Ultrawide)',
    '1:1 (Square)': '1:1 (Square)',
    '2:3 (Portrait Photo)': '2:3 (Portrait Photo)',
    '3:2 (Photo)': '3:2 (Photo)',
    '3:4 (Portrait Standard)': '3:4 (Portrait Standard)',
    '4:3 (Standard)': '4:3 (Standard)',
    '9:16 (Portrait Widescreen)': '9:16 (Portrait Widescreen)',
    '16:9 (Widescreen)': '16:9 (Widescreen)',
    '21:9 (Ultrawide)': '21:9 (Ultrawide)',
  };
  return map[String(aspectRatio || '').trim()] || '16:9 (Widescreen)';
}

/**
 * rhart-video-x T2V → RunningHub `/rhart-video-g/text-to-video`（强制 .ai）
 * duration 必须为 number（与已验证 Smoke / 正式 builder 一致）
 */
export function buildRhartVideoXT2vRhForward(body: {
  prompt: string;
  duration: number;
  aspectRatio: string;
  resolution?: string;
  billingModelId: string;
}): VideoQueueProviderForward {
  return {
    provider: 'runninghub',
    path: '/rhart-video-g/text-to-video',
    method: 'POST',
    body: {
      prompt: body.prompt,
      aspectRatio: body.aspectRatio,
      resolution: body.resolution || '720p',
      duration: body.duration,
    },
    billingModelId: body.billingModelId,
    rhRegion: 'ai',
  };
}

/**
 * 校验 I2V imageUrls：1–7 个公网 HTTPS（禁止 local/file/data/base64）
 */
export function assertRhartVideoXI2vHttpsImageUrls(imageUrls: unknown): string[] {
  if (!Array.isArray(imageUrls) || imageUrls.length < 1 || imageUrls.length > 7) {
    throw new Error(`rhart-video-x I2V 需要 1–7 张公网图片，当前 ${Array.isArray(imageUrls) ? imageUrls.length : 0} 张`);
  }
  const out: string[] = [];
  for (const raw of imageUrls) {
    const u = String(raw || '').trim();
    if (!u.startsWith('https://')) {
      throw new Error('rhart-video-x I2V imageUrls 必须全部为 https:// 公网 URL（禁止本地/dataURL）');
    }
    out.push(u);
  }
  return out;
}

/**
 * rhart-video-x I2V → RunningHub `/rhart-video-g/image-to-video`（强制 .ai）
 * duration 必须为 number；imageUrls 必须已是 1–7 个 HTTPS（Create 前完成 OSS）
 */
export function buildRhartVideoXI2vRhForward(body: {
  prompt: string;
  duration: number;
  aspectRatio: string;
  imageUrls: string[];
  resolution?: string;
  billingModelId: string;
}): VideoQueueProviderForward {
  const imageUrls = assertRhartVideoXI2vHttpsImageUrls(body.imageUrls);
  return {
    provider: 'runninghub',
    path: '/rhart-video-g/image-to-video',
    method: 'POST',
    body: {
      prompt: body.prompt,
      aspectRatio: body.aspectRatio,
      imageUrls,
      resolution: body.resolution || '720p',
      duration: body.duration,
    },
    billingModelId: body.billingModelId,
    rhRegion: 'ai',
  };
}

/** @deprecated 兼容旧名；请用 buildRhartVideoXT2vRhForward */
export function buildSora2T2vRhForward(body: {
  prompt: string;
  duration: string | number;
  aspectRatio: string;
  billingModelId: string;
}): VideoQueueProviderForward {
  const dur =
    typeof body.duration === 'number'
      ? body.duration
      : Number.parseInt(String(body.duration), 10) || 10;
  return buildRhartVideoXT2vRhForward({
    prompt: body.prompt,
    duration: dur,
    aspectRatio: body.aspectRatio,
    billingModelId: body.billingModelId,
  });
}

/**
 * minimax-h3-t2v → RunningHub ai-app（强制 .cn）
 * durationSec 必须为 string（与 Phase 9.1 Smoke PASS 一致，禁止改成 number）
 */
export function buildMinimaxH3T2vRhForward(body: {
  prompt: string;
  /** 时长秒数字符串，例如 "6" | "10" | "15" | "20" */
  durationSec: string;
  aspectRatio?: string;
  /** 480p → megapixels 0.4；720p → 0.9 */
  resolution?: string;
  billingModelId: string;
  instanceType?: 'plus' | 'default';
}): VideoQueueProviderForward {
  const durationSec = String(body.durationSec ?? '10').trim() || '10';
  const aspectRh = mapMinimaxH3AspectRatioForRh(body.aspectRatio);
  const promptText = String(body.prompt || '').trim() || '视频动画';
  const megapixels = minimaxH3MegapixelsForResolution(body.resolution);
  return {
    provider: 'runninghub',
    path: MINIMAX_H3_T2V_RUN_PATH,
    method: 'POST',
    body: {
      nodeInfoList: [
        {
          nodeId: '149',
          fieldName: 'text',
          fieldValue: promptText,
          description: '提示词',
        },
        {
          nodeId: '16',
          fieldName: 'megapixels',
          fieldValue: megapixels,
          description: '分辨率（看介绍）',
        },
        {
          nodeId: '16',
          fieldName: 'aspect_ratio',
          fieldValue: aspectRh,
          description: '比例选择',
        },
        {
          nodeId: '14',
          fieldName: 'value',
          fieldValue: durationSec,
          description: '时长',
        },
      ],
      instanceType: body.instanceType || 'plus',
      usePersonalQueue: 'false',
    },
    billingModelId: body.billingModelId,
    rhRegion: 'cn',
  };
}

/** 校验 H3 I2V nodeInfoList 中参考图为 RH media fileName（openapi/… 或 api/…） */
export function assertMinimaxH3I2vRhImageFileName(nodeInfoList: unknown): string {
  if (!Array.isArray(nodeInfoList) || nodeInfoList.length < 1) {
    throw new Error('minimax-h3-i2v nodeInfoList 不能为空');
  }
  for (const raw of nodeInfoList) {
    if (!raw || typeof raw !== 'object') continue;
    const n = raw as Record<string, unknown>;
    const fn = String(n.fieldName || '').toLowerCase();
    const desc = String(n.description || '');
    if (fn !== 'image' && !/参考图|上传图像/i.test(desc)) continue;
    const v = String(n.fieldValue || '').trim();
    if (!v || !/^(openapi|api)\//i.test(v)) {
      throw new Error(
        `minimax-h3-i2v 参考图须为 RH fileName（openapi/… 或 api/…），实际: ${v ? v.slice(0, 80) : '空'}`,
      );
    }
    return v;
  }
  throw new Error('minimax-h3-i2v nodeInfoList 缺少 image / 参考图节点');
}

/**
 * minimax-h3-i2v → RunningHub ai-app（强制 .cn；Queue 固定 instanceType=plus，禁止 803 双提交）
 * nodeInfoList 须由现有 buildMinimaxH3I2vNodeInfoList 在 Create 前生成（含 RH fileName）。
 */
export function buildMinimaxH3I2vRhForward(body: {
  nodeInfoList: Array<Record<string, unknown>>;
  billingModelId: string;
  /** Queue 路径强制 plus；忽略 default 以防双提交 */
  instanceType?: 'plus' | 'default';
}): VideoQueueProviderForward {
  assertMinimaxH3I2vRhImageFileName(body.nodeInfoList);
  return {
    provider: 'runninghub',
    path: MINIMAX_H3_I2V_RUN_PATH,
    method: 'POST',
    body: {
      nodeInfoList: body.nodeInfoList,
      instanceType: 'plus',
      usePersonalQueue: 'false',
    },
    billingModelId: body.billingModelId,
    rhRegion: 'cn',
  };
}

/** 校验 H3 Multi nodeInfoList 中参考图/音为 RH media fileName（若存在） */
export function assertMinimaxH3MultiRhMediaFileNames(nodeInfoList: unknown): {
  images: string[];
  audios: string[];
} {
  if (!Array.isArray(nodeInfoList) || nodeInfoList.length < 1) {
    throw new Error('minimax-h3-multi nodeInfoList 不能为空');
  }
  const images: string[] = [];
  const audios: string[] = [];
  for (const raw of nodeInfoList) {
    if (!raw || typeof raw !== 'object') continue;
    const n = raw as Record<string, unknown>;
    const fn = String(n.fieldName || '').toLowerCase();
    const desc = String(n.description || '');
    const v = String(n.fieldValue || '').trim();
    if (!v) continue;
    const isImage =
      fn === 'image' || /^image\d+$/i.test(desc) || /参考图|上传图像/i.test(desc);
    const isAudio = fn === 'audio' || /参考音|参考音频/i.test(desc);
    if (!isImage && !isAudio) continue;
    if (!/^(openapi|api)\//i.test(v)) {
      throw new Error(
        `minimax-h3-multi ${isAudio ? '参考音' : '参考图'}须为 RH fileName（openapi/… 或 api/…），实际: ${v.slice(0, 80)}`,
      );
    }
    if (isAudio) audios.push(v);
    else images.push(v);
  }
  if (images.length > 9) {
    throw new Error(`minimax-h3-multi 最多 9 张参考图，当前 ${images.length}`);
  }
  if (audios.length > 3) {
    throw new Error(`minimax-h3-multi 最多 3 路参考音，当前 ${audios.length}`);
  }
  return { images, audios };
}

/**
 * minimax-h3-multi → RunningHub ai-app（强制 .cn；Queue 固定 plus，禁止 803 双提交）
 * nodeInfoList 须由现有 buildMinimaxH3MultiNodeInfoList 在 Create 前生成（含 RH fileName / seal）。
 * body 对齐 Direct：randomSeed + retainSeconds；usePersonalQueue 字符串与其它 Queue Adapter 一致。
 */
export function buildMinimaxH3MultiRhForward(body: {
  nodeInfoList: Array<Record<string, unknown>>;
  billingModelId: string;
  /** Queue 路径强制 plus；忽略 default 以防双提交 */
  instanceType?: 'plus' | 'default';
}): VideoQueueProviderForward {
  assertMinimaxH3MultiRhMediaFileNames(body.nodeInfoList);
  return {
    provider: 'runninghub',
    path: MINIMAX_H3_MULTI_RUN_PATH,
    method: 'POST',
    body: {
      nodeInfoList: body.nodeInfoList,
      instanceType: 'plus',
      randomSeed: true,
      retainSeconds: 0,
      usePersonalQueue: 'false',
    },
    billingModelId: body.billingModelId,
    rhRegion: 'cn',
  };
}

/** 校验 H3 Audio：至少 1 图 + 至少 1 参考音，均为 RH fileName；无时长节点 */
export function assertMinimaxH3AudioRhMediaFileNames(nodeInfoList: unknown): {
  images: string[];
  audio: string;
} {
  if (!Array.isArray(nodeInfoList) || nodeInfoList.length < 1) {
    throw new Error('minimax-h3-audio nodeInfoList 不能为空');
  }
  const images: string[] = [];
  const audios: string[] = [];
  for (const raw of nodeInfoList) {
    if (!raw || typeof raw !== 'object') continue;
    const n = raw as Record<string, unknown>;
    const fn = String(n.fieldName || '').toLowerCase();
    const desc = String(n.description || '');
    const v = String(n.fieldValue || '').trim();
    if (!v) continue;
    const isImage =
      fn === 'image' || /^image\d+$/i.test(desc) || /参考图|上传图像/i.test(desc);
    const isAudio = fn === 'audio' || /参考音|参考音频/i.test(desc);
    if (!isImage && !isAudio) continue;
    if (!/^(openapi|api)\//i.test(v)) {
      throw new Error(
        `minimax-h3-audio ${isAudio ? '参考音' : '参考图'}须为 RH fileName（openapi/… 或 api/…），实际: ${v.slice(0, 80)}`,
      );
    }
    if (isAudio) audios.push(v);
    else images.push(v);
  }
  if (images.length < 1 || images.length > 5) {
    throw new Error(`minimax-h3-audio 需要 1–5 张参考图，当前 ${images.length}`);
  }
  if (audios.length < 1) {
    throw new Error('minimax-h3-audio nodeInfoList 缺少参考音');
  }
  return { images, audio: audios[0] };
}

/**
 * minimax-h3-audio → RunningHub ai-app（强制 .cn；Queue 固定 plus，禁止 803 双提交）
 * nodeInfoList 须由现有 buildMinimaxH3AudioNodeInfoList 生成（含图+音 RH fileName / seal）。
 * 与 Direct 一致：无时长节点；randomSeed + retainSeconds；usePersonalQueue 字符串化。
 */
export function buildMinimaxH3AudioRhForward(body: {
  nodeInfoList: Array<Record<string, unknown>>;
  billingModelId: string;
  instanceType?: 'plus' | 'default';
}): VideoQueueProviderForward {
  assertMinimaxH3AudioRhMediaFileNames(body.nodeInfoList);
  return {
    provider: 'runninghub',
    path: MINIMAX_H3_AUDIO_RUN_PATH,
    method: 'POST',
    body: {
      nodeInfoList: body.nodeInfoList,
      instanceType: 'plus',
      randomSeed: true,
      retainSeconds: 0,
      usePersonalQueue: 'false',
    },
    billingModelId: body.billingModelId,
    rhRegion: 'cn',
  };
}

/**
 * ltx-2.3-t2v → RunningHub ai-app（Phase 9.3-B：rhRegion=ai，写入 forward 供 Poll 复用）
 * durationSec 与 Direct 一致：String(normalizeLtx23DurationSec(...))，例如 "10"
 * path 与 Direct / H3 queue 一致：`/run/ai-app/{appId}`（基址由 RH client 拼 openapi/v2）
 */
export function buildLtx23T2vRhForward(body: {
  prompt: string;
  /** 时长秒数字符串，例如 "5" | "10" | "15" */
  durationSec: string;
  aspectRatio?: string;
  /** UI 档 720|1280|1920（可含旧值 1080） */
  resolution?: string;
  billingModelId: string;
  instanceType?: 'plus' | 'default';
}): VideoQueueProviderForward {
  const durationSec = String(body.durationSec ?? '10').trim() || '10';
  const promptText = String(body.prompt || '').trim() || '视频动画';
  const wh = mapLtx23T2vWh(body.resolution, body.aspectRatio);
  return {
    provider: 'runninghub',
    path: LTX23_T2V_RUN_PATH,
    method: 'POST',
    body: {
      nodeInfoList: [
        { nodeId: '43', fieldName: 'value', fieldValue: String(wh.w) },
        { nodeId: '44', fieldName: 'value', fieldValue: String(wh.h) },
        { nodeId: '74', fieldName: 'value', fieldValue: durationSec },
        { nodeId: '73', fieldName: 'text', fieldValue: promptText },
      ],
      instanceType: body.instanceType || 'plus',
      usePersonalQueue: 'false',
    },
    billingModelId: body.billingModelId,
    rhRegion: 'ai',
  };
}

/** LTX I2V 分辨率档：与 Direct 一致，1080→1920；仅 720|1280|1920 */
export function normalizeLtx23I2vResolutionTier(resolutionRaw: string | undefined): '720' | '1280' | '1920' {
  const resRaw = String(resolutionRaw || '720').trim();
  const res = resRaw === '1080' ? '1920' : resRaw;
  if (res === '720' || res === '1280' || res === '1920') return res;
  return '720';
}

/** 校验 LTX I2V node 584 为公网 HTTPS（禁止 RH fileName / local / data） */
export function assertLtx23I2vOssHttpsImageUrl(imageUrl: unknown): string {
  const u = String(imageUrl || '').trim();
  if (!u) throw new Error('ltx-2.3-i2v 参考图不能为空');
  if (/^(openapi|api)\//i.test(u)) {
    throw new Error('ltx-2.3-i2v 参考图须为 HTTPS OSS URL，不能是 RH Media fileName');
  }
  if (!(u.startsWith('https://') || u.startsWith('http://'))) {
    throw new Error(`ltx-2.3-i2v 参考图须为公网 HTTP(S) URL，实际: ${u.slice(0, 80)}`);
  }
  if (/^(file:|data:|blob:|local-resource:)/i.test(u)) {
    throw new Error('ltx-2.3-i2v 禁止 local/file/data/blob 写入 Queue');
  }
  return u;
}

/**
 * ltx-2.3-i2v → RunningHub ai-app（Phase 9.5-B-1：rhRegion=cn）
 * nodeInfoList 与 Direct 一致：584/image(OSS HTTPS)、593/duration、595/res、602/positive
 * 工作流保持参考图比例，不传 aspect_ratio 节点。
 */
export function buildLtx23I2vRhForward(body: {
  /** 已完成 OSS 上传的公网 HTTPS URL */
  imageUrl: string;
  prompt: string;
  /** 时长秒数字符串，例如 "5" | "10" | "15" */
  durationSec: string;
  /** UI 档 720|1280|1920（可含旧值 1080） */
  resolution?: string;
  billingModelId: string;
  instanceType?: 'plus' | 'default';
}): VideoQueueProviderForward {
  const imageUrl = assertLtx23I2vOssHttpsImageUrl(body.imageUrl);
  const durationSec = String(body.durationSec ?? '10').trim() || '10';
  const res = normalizeLtx23I2vResolutionTier(body.resolution);
  const promptText = String(body.prompt || '').trim() || '视频动画';
  return {
    provider: 'runninghub',
    path: LTX23_I2V_RUN_PATH,
    method: 'POST',
    body: {
      nodeInfoList: [
        { nodeId: '584', fieldName: 'image', fieldValue: imageUrl },
        { nodeId: '593', fieldName: 'value', fieldValue: durationSec },
        { nodeId: '595', fieldName: 'value', fieldValue: String(res) },
        { nodeId: '602', fieldName: 'positive', fieldValue: promptText },
      ],
      instanceType: body.instanceType || 'plus',
      usePersonalQueue: 'false',
    },
    billingModelId: body.billingModelId,
    rhRegion: 'cn',
  };
}

export const GEMINI_OMNI_FLASH_RUN_PATH = '/gemini-omni-flash/image-to-video' as const;

/** duration 必须为 string "6"|"8"|"10"（与 Direct 一致） */
export function normalizeGeminiOmniFlashDurationString(
  raw: string | number | undefined,
  fallback: '6' | '8' | '10' = '6',
): '6' | '8' | '10' {
  const allowed = new Set(['6', '8', '10']);
  const s = String(raw ?? '').trim();
  if (allowed.has(s)) return s as '6' | '8' | '10';
  const n = parseInt(s, 10);
  if (n === 6 || n === 8 || n === 10) return String(n) as '6' | '8' | '10';
  return fallback;
}

export function normalizeGeminiOmniFlashResolution(
  raw: string | undefined,
): '720p' | '1080p' | '4k' {
  const r = String(raw || '720p').trim().toLowerCase();
  if (r === '1080p' || r === '4k') return r;
  return '720p';
}

export function normalizeGeminiOmniFlashAspectRatio(raw: string | undefined): '16:9' | '9:16' {
  return String(raw || '').trim() === '9:16' ? '9:16' : '16:9';
}

/**
 * 校验 Gemini Omni Flash imageUrls：恰好 1 或 3 个公网 HTTPS（禁止 RH fileName / local / data）
 */
export function assertGeminiOmniFlashHttpsImageUrls(imageUrls: unknown): string[] {
  if (!Array.isArray(imageUrls)) {
    throw new Error('gemini-omni-flash imageUrls 必须为数组');
  }
  const out: string[] = [];
  for (const raw of imageUrls) {
    const u = String(raw || '').trim();
    if (!u) continue;
    if (/^(openapi|api)\//i.test(u)) {
      throw new Error('gemini-omni-flash imageUrls 须为 HTTPS OSS URL，不能是 RH Media fileName');
    }
    if (!(u.startsWith('https://') || u.startsWith('http://'))) {
      throw new Error(`gemini-omni-flash imageUrls 须为公网 HTTP(S)，实际: ${u.slice(0, 80)}`);
    }
    if (/^(file:|data:|blob:|local-resource:)/i.test(u)) {
      throw new Error('gemini-omni-flash 禁止 local/file/data/blob 写入 Queue');
    }
    if (!u.startsWith('https://')) {
      throw new Error(`gemini-omni-flash imageUrls 必须为 HTTPS OSS URL，实际: ${u.slice(0, 80)}`);
    }
    out.push(u);
  }
  if (out.length !== 1 && out.length !== 3) {
    throw new Error(`gemini-omni-flash 仅支持 1 或 3 张参考图，当前 ${out.length} 张`);
  }
  return out;
}

/**
 * gemini-omni-flash → RunningHub OpenAPI（Phase 9.5-B-2-B：rhRegion=ai）
 * body 与 Direct 一致；duration 必须为 string。
 */
export function buildGeminiOmniFlashRhForward(body: {
  prompt: string;
  /** 已完成 OSS 上传的 1 或 3 个 HTTPS URL */
  imageUrls: string[];
  /** 必须为 string："6" | "8" | "10" */
  duration: string;
  resolution?: string;
  aspectRatio?: string;
  billingModelId: string;
}): VideoQueueProviderForward {
  const promptText = String(body.prompt || '').trim();
  if (!promptText) throw new Error('gemini-omni-flash 需要填写视频描述（prompt）');
  if (promptText.length > 2048) throw new Error('prompt 长度不能超过 2048 字符');
  const imageUrls = assertGeminiOmniFlashHttpsImageUrls(body.imageUrls);
  const duration = normalizeGeminiOmniFlashDurationString(body.duration, '6');
  const resolution = normalizeGeminiOmniFlashResolution(body.resolution);
  const aspectRatio = normalizeGeminiOmniFlashAspectRatio(body.aspectRatio);
  return {
    provider: 'runninghub',
    path: GEMINI_OMNI_FLASH_RUN_PATH,
    method: 'POST',
    body: {
      prompt: promptText,
      imageUrls,
      duration,
      resolution,
      aspectRatio,
    },
    billingModelId: body.billingModelId,
    rhRegion: 'ai',
  };
}

/** LTX2.3 首位帧 ai-app（与 VideoProvider Direct 一致） */
export const RH_VIDEO_START_END_APP_ID = '2048742865043460098' as const;
export const RH_VIDEO_START_END_RUN_PATH = `/run/ai-app/${RH_VIDEO_START_END_APP_ID}` as const;

/** duration 必须为 string "5"|"10"|"15"（与 Direct 一致） */
export function normalizeRhVideoStartEndDurationString(
  raw: string | number | undefined,
  fallback: '5' | '10' | '15' = '5',
): '5' | '10' | '15' {
  const s = String(raw ?? '').trim();
  if (s === '15' || s === '10' || s === '5') return s;
  const n = parseInt(s, 10);
  if (n >= 15) return '15';
  if (n >= 10) return '10';
  if (n >= 5) return '5';
  return fallback;
}

/** UI resolutionRhartV31 → 720p|1080p|1920p（4k→1920p） */
export function normalizeRhVideoStartEndResolutionTier(
  raw: string | undefined,
): '720p' | '1080p' | '1920p' {
  const r = String(raw || '').trim().toLowerCase();
  if (r === '720' || r === '720p') return '720p';
  if (r === '1920' || r === '1920p' || r === '4k' || r === '2160p') return '1920p';
  return '1080p';
}

export function normalizeRhVideoStartEndAspectRatio(raw: string | undefined): '16:9' | '9:16' {
  return String(raw || '').trim() === '9:16' ? '9:16' : '16:9';
}

/**
 * 与 Direct 完全一致：1080p 与 1920p 像素相同（非真 4K）
 */
export function mapRhVideoStartEndWh(
  resolutionTier: '720p' | '1080p' | '1920p',
  aspectRatio: '16:9' | '9:16',
): { w: string; h: string } {
  if (resolutionTier === '720p') {
    return aspectRatio === '9:16' ? { w: '720', h: '1280' } : { w: '1280', h: '720' };
  }
  return aspectRatio === '9:16' ? { w: '1080', h: '1920' } : { w: '1920', h: '1080' };
}

export function assertRhVideoStartEndOssHttpsImageUrl(imageUrl: unknown, label: string): string {
  const u = String(imageUrl || '').trim();
  if (!u) throw new Error(`rh-video-start-end ${label} 图片 URL 为空`);
  if (/^(openapi|api)\//i.test(u)) {
    throw new Error(`rh-video-start-end ${label} 须为 HTTPS OSS URL，不能是 RH Media fileName`);
  }
  if (!u.startsWith('https://')) {
    throw new Error(`rh-video-start-end ${label} 必须为 HTTPS OSS URL，实际: ${u.slice(0, 80)}`);
  }
  if (/^(file:|data:|blob:|local-resource:)/i.test(u)) {
    throw new Error(`rh-video-start-end ${label} 禁止 local/file/data/blob 写入 Queue`);
  }
  return u;
}

/**
 * rh-video-start-end → RunningHub ai-app（Phase 9.5-B-3-B：rhRegion=cn）
 * 首尾帧各 1 张 OSS HTTPS；duration 为 string；1080p/1920p 像素同档。
 */
export function buildRhVideoStartEndRhForward(body: {
  /** 已完成 OSS 上传的首帧 HTTPS URL */
  startImageUrl: string;
  /** 已完成 OSS 上传的尾帧 HTTPS URL */
  endImageUrl: string;
  prompt: string;
  /** 必须为 string："5" | "10" | "15" */
  duration: string;
  /** UI resolutionRhartV31：720p|1080p|1920p（可含旧 4k） */
  resolution?: string;
  aspectRatio?: string;
  billingModelId: string;
}): VideoQueueProviderForward {
  const startImageUrl = assertRhVideoStartEndOssHttpsImageUrl(body.startImageUrl, '首帧');
  const endImageUrl = assertRhVideoStartEndOssHttpsImageUrl(body.endImageUrl, '尾帧');
  const promptText = String(body.prompt || '').trim();
  if (!promptText) throw new Error('LTX2.3（首位帧）需要填写视频描述（prompt）');
  const duration = normalizeRhVideoStartEndDurationString(body.duration, '5');
  const resTier = normalizeRhVideoStartEndResolutionTier(body.resolution);
  const aspectRatio = normalizeRhVideoStartEndAspectRatio(body.aspectRatio);
  const size = mapRhVideoStartEndWh(resTier, aspectRatio);
  return {
    provider: 'runninghub',
    path: RH_VIDEO_START_END_RUN_PATH,
    method: 'POST',
    body: {
      nodeInfoList: [
        { nodeId: '2004', fieldName: 'image', fieldValue: startImageUrl, description: 'image1' },
        { nodeId: '5062', fieldName: 'image', fieldValue: endImageUrl, description: 'image2' },
        { nodeId: '5018', fieldName: 'value', fieldValue: size.w, description: '宽' },
        { nodeId: '5020', fieldName: 'value', fieldValue: size.h, description: '高' },
        { nodeId: '5022', fieldName: 'value', fieldValue: duration, description: '时长' },
        { nodeId: '5090', fieldName: 'text', fieldValue: promptText, description: 'text' },
      ],
      instanceType: 'plus',
      usePersonalQueue: 'false',
    },
    billingModelId: body.billingModelId,
    rhRegion: 'cn',
  };
}

/** duration 固定字符串 "8"（与 Direct 一致） */
export function normalizeRhArtV31ProSeDurationString(): '8' {
  return '8';
}

/** UI resolutionRhartV31 → 720p|1080p|4k */
export function normalizeRhArtV31ProSeResolution(
  raw: string | undefined,
): '720p' | '1080p' | '4k' {
  const r = String(raw || '').trim().toLowerCase();
  if (r === '720p' || r === '720') return '720p';
  if (r === '4k' || r === '2160p') return '4k';
  if (r === '1080p' || r === '1080') return '1080p';
  return '1080p';
}

export function normalizeRhArtV31ProSeAspectRatio(raw: string | undefined): '16:9' | '9:16' {
  return String(raw || '').trim() === '9:16' ? '9:16' : '16:9';
}

export function assertRhArtV31ProSeOssHttpsImageUrl(imageUrl: unknown, label: string): string {
  const u = String(imageUrl || '').trim();
  if (!u) throw new Error(`rhart-v3.1-pro-se ${label} 图片 URL 为空`);
  if (/^(openapi|api)\//i.test(u)) {
    throw new Error(`rhart-v3.1-pro-se ${label} 须为 HTTPS OSS URL，不能是 RH Media fileName`);
  }
  if (!u.startsWith('https://')) {
    throw new Error(`rhart-v3.1-pro-se ${label} 必须为 HTTPS OSS URL，实际: ${u.slice(0, 80)}`);
  }
  if (/^(file:|data:|blob:|local-resource:)/i.test(u)) {
    throw new Error(`rhart-v3.1-pro-se ${label} 禁止 local/file/data/blob 写入 Queue`);
  }
  return u;
}

/**
 * rhart-v3.1-pro-se → RunningHub OpenAPI（Phase 9.5-B-4-B：rhRegion=ai）
 * 首帧必填、尾帧可选；duration 固定 string "8"；resolution 为枚举字符串（不转 WH）。
 */
export function buildRhArtV31ProSeRhForward(body: {
  /** 已完成 OSS 上传的首帧 HTTPS URL */
  firstFrameUrl: string;
  /** 已完成 OSS 上传的尾帧 HTTPS URL；省略则不写入 body */
  lastFrameUrl?: string | null;
  prompt: string;
  /** UI resolutionRhartV31：720p|1080p|4k */
  resolution?: string;
  aspectRatio?: string;
  billingModelId: string;
}): VideoQueueProviderForward {
  const firstFrameUrl = assertRhArtV31ProSeOssHttpsImageUrl(body.firstFrameUrl, '首帧');
  const lastRaw = body.lastFrameUrl != null ? String(body.lastFrameUrl).trim() : '';
  const lastFrameUrl = lastRaw
    ? assertRhArtV31ProSeOssHttpsImageUrl(lastRaw, '尾帧')
    : '';
  const promptText = String(body.prompt || '').trim();
  if (!promptText) throw new Error('全能视频V3.1-pro-首尾帧生视频需要填写视频描述（prompt）');
  const duration = normalizeRhArtV31ProSeDurationString();
  const resolution = normalizeRhArtV31ProSeResolution(body.resolution);
  const aspectRatio = normalizeRhArtV31ProSeAspectRatio(body.aspectRatio);
  const reqBody: Record<string, unknown> = {
    prompt: promptText,
    firstFrameUrl,
    aspectRatio,
    duration,
    resolution,
  };
  if (lastFrameUrl) {
    reqBody.lastFrameUrl = lastFrameUrl;
  }
  return {
    provider: 'runninghub',
    path: RHART_V31_PRO_SE_RUN_PATH,
    method: 'POST',
    body: reqBody,
    billingModelId: body.billingModelId,
    rhRegion: 'ai',
  };
}

/** LTX 对口型分辨率档：仅 720|1280|1920（与 Direct 一致） */
export function normalizeLtx23LipsyncResolutionTier(
  resolutionRaw: string | undefined,
): '720' | '1280' | '1920' {
  const res = String(resolutionRaw || '720').trim();
  if (res === '720' || res === '1280' || res === '1920') return res;
  return '720';
}

export function assertLtx23LipsyncOssHttpsUrl(url: unknown, label: string): string {
  const u = String(url || '').trim();
  if (!u) throw new Error(`ltx-2.3-lipsync ${label} 不能为空`);
  if (/^(openapi|api)\//i.test(u)) {
    throw new Error(`ltx-2.3-lipsync ${label} 须为 HTTPS OSS URL，不能是 RH Media fileName`);
  }
  if (!u.startsWith('https://')) {
    throw new Error(`ltx-2.3-lipsync ${label} 必须为 HTTPS OSS URL，实际: ${u.slice(0, 80)}`);
  }
  if (/^(file:|data:|blob:|local-resource:)/i.test(u)) {
    throw new Error(`ltx-2.3-lipsync ${label} 禁止 local/file/data/blob 写入 Queue`);
  }
  return u;
}

/**
 * ltx-2.3-lipsync → RunningHub ai-app（Phase 9.5-B-5-B：rhRegion=cn）
 * nodeInfoList 与 Direct 一致：50/image、37/audio、54/value(prompt)、187/value(resolution)
 * 图/音均为 HTTPS OSS URL；无 duration 节点 / SKU 维。
 */
export function buildLtx23LipsyncRhForward(body: {
  /** 已完成 OSS 上传的公网 HTTPS 图片 URL */
  imageUrl: string;
  /** 已完成 OSS 上传的公网 HTTPS 音频 URL */
  audioUrl: string;
  prompt: string;
  /** UI 档 720|1280|1920 */
  resolution?: string;
  billingModelId: string;
  instanceType?: 'plus' | 'default';
}): VideoQueueProviderForward {
  const imageUrl = assertLtx23LipsyncOssHttpsUrl(body.imageUrl, '参考图');
  const audioUrl = assertLtx23LipsyncOssHttpsUrl(body.audioUrl, '音频');
  const res = normalizeLtx23LipsyncResolutionTier(body.resolution);
  const promptText =
    String(body.prompt || '').trim() || '正在讲解，有一些手势动作';
  return {
    provider: 'runninghub',
    path: LTX23_LIPSYNC_RUN_PATH,
    method: 'POST',
    body: {
      nodeInfoList: [
        { nodeId: '50', fieldName: 'image', fieldValue: imageUrl },
        { nodeId: '37', fieldName: 'audio', fieldValue: audioUrl },
        { nodeId: '54', fieldName: 'value', fieldValue: promptText },
        { nodeId: '187', fieldName: 'value', fieldValue: String(res) },
      ],
      instanceType: body.instanceType || 'plus',
      usePersonalQueue: 'false',
    },
    billingModelId: body.billingModelId,
    rhRegion: 'cn',
  };
}

/** Seedance Fast 分辨率：仅 720p|1080p */
export function normalizeSeedance20FastResolution(raw: string | undefined): '720p' | '1080p' {
  const s = String(raw || '').trim().toLowerCase();
  if (s === '1080p' || s === '1080' || s === '1920x1080' || s === '1080x1920') return '1080p';
  return '720p';
}

/** duration 必须为 string "5"|"10"|"15" */
export function normalizeSeedance20FastDurationString(
  raw: string | number | undefined,
  fallback: '5' | '10' | '15' = '10',
): '5' | '10' | '15' {
  const allowed = new Set(['5', '10', '15']);
  const s = String(raw ?? '').trim();
  if (allowed.has(s)) return s as '5' | '10' | '15';
  const n = parseInt(s, 10);
  if (n === 5 || n === 10 || n === 15) return String(n) as '5' | '10' | '15';
  return fallback;
}

export const SEEDANCE_20_FAST_RATIO_OPTIONS = [
  'adaptive',
  '16:9',
  '4:3',
  '1:1',
  '3:4',
  '9:16',
  '21:9',
] as const;

export function normalizeSeedance20FastRatio(
  raw: string | undefined,
  fallback: (typeof SEEDANCE_20_FAST_RATIO_OPTIONS)[number] = 'adaptive',
): (typeof SEEDANCE_20_FAST_RATIO_OPTIONS)[number] {
  const s = String(raw ?? '').trim();
  return (SEEDANCE_20_FAST_RATIO_OPTIONS as readonly string[]).includes(s)
    ? (s as (typeof SEEDANCE_20_FAST_RATIO_OPTIONS)[number])
    : fallback;
}

export function assertSeedance20FastOssHttpsImageUrls(imageUrls: unknown): string[] {
  if (!Array.isArray(imageUrls)) {
    throw new Error('seedance-2.0-fast imageUrls 必须为数组');
  }
  const out: string[] = [];
  for (const raw of imageUrls) {
    const u = String(raw || '').trim();
    if (!u) continue;
    if (/^(openapi|api)\//i.test(u)) {
      throw new Error('seedance-2.0-fast imageUrls 须为 HTTPS OSS URL，不能是 RH Media fileName');
    }
    if (!u.startsWith('https://')) {
      throw new Error(`seedance-2.0-fast imageUrls 必须为 HTTPS OSS URL，实际: ${u.slice(0, 80)}`);
    }
    if (/^(file:|data:|blob:|local-resource:)/i.test(u)) {
      throw new Error('seedance-2.0-fast 禁止 local/file/data/blob 写入 Queue');
    }
    out.push(u);
  }
  if (out.length > 9) {
    throw new Error(`seedance-2.0-fast 最多支持 9 张参考图，当前 ${out.length} 张`);
  }
  return out;
}

/**
 * seedance-2.0-fast → RunningHub OpenAPI（Phase 9.5-B-6-B：rhRegion=cn）
 * 仅 0–9 图 + 文本；videoUrls/audioUrls 恒空；无 conversionSlots。
 */
export function buildSeedance20FastRhForward(body: {
  prompt: string;
  /** 已完成 OSS 上传的 0–9 个 HTTPS URL（保持顺序） */
  imageUrls?: string[];
  resolution?: string;
  /** 必须为 string："5" | "10" | "15" */
  duration?: string | number;
  ratio?: string;
  billingModelId: string;
}): VideoQueueProviderForward {
  const promptText = String(body.prompt || '').trim();
  if (!promptText) throw new Error('Seedance 2.0 Fast 需要填写视频描述（prompt）');
  const imageUrls = assertSeedance20FastOssHttpsImageUrls(body.imageUrls || []);
  const resolution = normalizeSeedance20FastResolution(body.resolution);
  const duration = normalizeSeedance20FastDurationString(body.duration, '10');
  const ratio = normalizeSeedance20FastRatio(body.ratio, 'adaptive');
  return {
    provider: 'runninghub',
    path: SEEDANCE_20_FAST_RUN_PATH,
    method: 'POST',
    body: {
      prompt: promptText,
      resolution,
      duration,
      imageUrls,
      videoUrls: [] as string[],
      audioUrls: [] as string[],
      generateAudio: true,
      ratio,
      realPersonMode: true,
      returnLastFrame: false,
      seed: -1,
    },
    billingModelId: body.billingModelId,
    rhRegion: 'cn',
  };
}

export const SEEDANCE_20_MINI_RESOLUTION_OPTIONS = [
  '480p',
  '720p',
  '1080p',
  '2k',
  '4k',
] as const;

export function normalizeSeedance20MiniResolution(
  raw: string | undefined,
): (typeof SEEDANCE_20_MINI_RESOLUTION_OPTIONS)[number] {
  const s = String(raw ?? '').trim().toLowerCase();
  if (s === '4k' || s === '2160p') return '4k';
  if (s === '2k' || s === '1440p') return '2k';
  if (s === '1080p' || s === '1080' || s === '1920x1080' || s === '1080x1920') return '1080p';
  if (s === '480p' || s === '480') return '480p';
  return '720p';
}

export function normalizeSeedance20MiniDurationString(
  raw: string | number | undefined,
  fallback: '5' | '10' | '15' = '10',
): '5' | '10' | '15' {
  return normalizeSeedance20FastDurationString(raw, fallback);
}

export function normalizeSeedance20MiniRatio(
  raw: string | undefined,
  fallback: (typeof SEEDANCE_20_FAST_RATIO_OPTIONS)[number] = 'adaptive',
): (typeof SEEDANCE_20_FAST_RATIO_OPTIONS)[number] {
  return normalizeSeedance20FastRatio(raw, fallback);
}

function assertSeedance20MiniOssHttpsUrls(
  urls: unknown,
  field: 'imageUrls' | 'videoUrls' | 'audioUrls',
  max: number,
): string[] {
  if (!Array.isArray(urls)) {
    throw new Error(`seedance-2.0-mini ${field} 必须为数组`);
  }
  const out: string[] = [];
  for (const raw of urls) {
    const u = String(raw || '').trim();
    if (!u) continue;
    if (/^(openapi|api)\//i.test(u)) {
      throw new Error(`seedance-2.0-mini ${field} 须为 HTTPS OSS URL，不能是 RH Media fileName`);
    }
    if (!u.startsWith('https://')) {
      throw new Error(`seedance-2.0-mini ${field} 必须为 HTTPS OSS URL，实际: ${u.slice(0, 80)}`);
    }
    if (/^(file:|data:|blob:|local-resource:)/i.test(u)) {
      throw new Error(`seedance-2.0-mini 禁止 local/file/data/blob 写入 Queue ${field}`);
    }
    out.push(u);
  }
  if (out.length > max) {
    throw new Error(`seedance-2.0-mini ${field} 最多 ${max} 个，当前 ${out.length}`);
  }
  return out;
}

/**
 * seedance-2.0-mini → RunningHub OpenAPI（Phase 9.5-B-7-B：rhRegion=cn）
 * 0–9 图 + 可选 0–1 视频 + 可选 0–1 音频；必须 conversionSlots:["all"]。
 */
export function buildSeedance20MiniRhForward(body: {
  prompt: string;
  imageUrls?: string[];
  videoUrls?: string[];
  audioUrls?: string[];
  resolution?: string;
  /** 必须为 string："5" | "10" | "15" */
  duration?: string | number;
  ratio?: string;
  billingModelId: string;
}): VideoQueueProviderForward {
  const promptText = String(body.prompt || '').trim();
  if (!promptText) throw new Error('Seedance 2.0 Mini 需要填写视频描述（prompt）');
  const imageUrls = assertSeedance20MiniOssHttpsUrls(body.imageUrls || [], 'imageUrls', 9);
  const videoUrls = assertSeedance20MiniOssHttpsUrls(body.videoUrls || [], 'videoUrls', 1);
  const audioUrls = assertSeedance20MiniOssHttpsUrls(body.audioUrls || [], 'audioUrls', 1);
  const resolution = normalizeSeedance20MiniResolution(body.resolution);
  const duration = normalizeSeedance20MiniDurationString(body.duration, '10');
  const ratio = normalizeSeedance20MiniRatio(body.ratio, 'adaptive');
  return {
    provider: 'runninghub',
    path: SEEDANCE_20_MINI_RUN_PATH,
    method: 'POST',
    body: {
      prompt: promptText,
      resolution,
      duration,
      imageUrls,
      videoUrls,
      audioUrls,
      generateAudio: true,
      ratio,
      realPersonMode: true,
      conversionSlots: ['all'] as string[],
      returnLastFrame: false,
      seed: -1,
    },
    billingModelId: body.billingModelId,
    rhRegion: 'cn',
  };
}

/** WanAnimate 分辨率 UI → RH node 259："720" | "1080" */
export function normalizeWanAnimateRhResolutionTier(raw: string | undefined): '720' | '1080' {
  const s = String(raw ?? '').trim().toLowerCase();
  if (s === '1080p' || s === '1080' || s === '1920x1080' || s === '1080x1920') return '1080';
  return '720';
}

/** WanAnimate 片段秒数 → RH node 250 string："5"|"8"|"10"|"15" */
export function normalizeWanAnimateClipSecString(
  raw: string | number | undefined,
  fallback: '5' | '8' | '10' | '15' = '8',
): '5' | '8' | '10' | '15' {
  const s = String(raw ?? '').trim();
  if (s === '5' || s === '8' || s === '10' || s === '15') return s;
  const n = parseInt(s, 10);
  if (n === 5 || n === 8 || n === 10 || n === 15) return String(n) as '5' | '8' | '10' | '15';
  return fallback;
}

export function assertWanAnimateOssHttpsUrl(url: unknown, label: string): string {
  const u = String(url || '').trim();
  if (!u) throw new Error(`wan-animate ${label} 不能为空`);
  if (/^(openapi|api)\//i.test(u)) {
    throw new Error(`wan-animate ${label} 须为 HTTPS OSS URL，不能是 RH Media fileName`);
  }
  if (!u.startsWith('https://')) {
    throw new Error(`wan-animate ${label} 必须为 HTTPS OSS URL，实际: ${u.slice(0, 80)}`);
  }
  if (/^(file:|data:|blob:|local-resource:)/i.test(u)) {
    throw new Error(`wan-animate ${label} 禁止 local/file/data/blob 写入 Queue`);
  }
  return u;
}

/**
 * wan-animate → RunningHub ai-app（Phase 9.5-B-8-B：rhRegion=cn）
 * nodeInfoList 与 Direct 一致：57/image、63/video、250/clip、259/resolution；无 prompt/audio。
 */
export function buildWanAnimateRhForward(body: {
  /** 已完成 OSS 上传的公网 HTTPS 角色图 */
  imageUrl: string;
  /** 已完成 OSS 上传（含 ffmpeg 转码）的公网 HTTPS 参考视频 */
  videoUrl: string;
  /** UI resolutionWanAnimate：720p|1080p */
  resolution?: string;
  /** UI wanAnimateClipSec：5|8|10|15 */
  clipSec?: string | number;
  billingModelId: string;
  instanceType?: 'plus' | 'default';
}): VideoQueueProviderForward {
  const imageUrl = assertWanAnimateOssHttpsUrl(body.imageUrl, '参考图');
  const videoUrl = assertWanAnimateOssHttpsUrl(body.videoUrl, '参考视频');
  const resVal = normalizeWanAnimateRhResolutionTier(body.resolution);
  const clipVal = normalizeWanAnimateClipSecString(body.clipSec, '8');
  return {
    provider: 'runninghub',
    path: WAN_ANIMATE_RUN_PATH,
    method: 'POST',
    body: {
      nodeInfoList: [
        { nodeId: '57', fieldName: 'image', fieldValue: imageUrl, description: 'image' },
        { nodeId: '63', fieldName: 'video', fieldValue: videoUrl, description: 'video' },
        { nodeId: '250', fieldName: 'value', fieldValue: clipVal, description: 'value' },
        { nodeId: '259', fieldName: 'value', fieldValue: resVal, description: 'resolution' },
      ],
      instanceType: body.instanceType || 'plus',
      usePersonalQueue: 'false',
    },
    billingModelId: body.billingModelId,
    rhRegion: 'cn',
  };
}

/** wan-animate-2 RH 分辨率档：720p→832，1080p→1280（与 Direct 一致） */
export function normalizeWanAnimate2RhResolutionValue(resolutionRaw: string | undefined): '832' | '1280' {
  const preset = String(resolutionRaw || '720p').trim().toLowerCase();
  if (
    preset === '1080p' ||
    preset === '1080' ||
    preset === '1920x1080' ||
    preset === '1080x1920' ||
    preset === '1280'
  ) {
    return '1280';
  }
  return '832';
}

export function normalizeWanAnimate2ResKey(resolutionRaw: string | undefined): '720p' | '1080p' {
  return normalizeWanAnimate2RhResolutionValue(resolutionRaw) === '1280' ? '1080p' : '720p';
}

/**
 * wan-animate-2 → RunningHub ai-app（rhRegion=cn）
 * nodeInfoList 与 Direct 一致：637 分辨率 / 642 提示词 / 651 原视频描述(空) / 647 视频 / 655 图。
 * 无 clip 节点；计费 Quantity 由 mediaDurationSec 决定（不进 RH body）。
 */
export function buildWanAnimate2RhForward(body: {
  imageUrl: string;
  videoUrl: string;
  /** 可选提示词；空串与 Direct 一致 */
  prompt?: string;
  /** UI resolutionWanAnimate：720p|1080p */
  resolution?: string;
  billingModelId: string;
  instanceType?: 'plus' | 'default';
}): VideoQueueProviderForward {
  const imageUrl = assertWanAnimateOssHttpsUrl(body.imageUrl, '替换参考图');
  const videoUrl = assertWanAnimateOssHttpsUrl(body.videoUrl, '原视频');
  const resVal = normalizeWanAnimate2RhResolutionValue(body.resolution);
  const promptText = String(body.prompt || '').trim();
  return {
    provider: 'runninghub',
    path: WAN_ANIMATE_2_RUN_PATH,
    method: 'POST',
    body: {
      nodeInfoList: [
        { nodeId: '637', fieldName: 'value', fieldValue: resVal, description: '分辨率' },
        { nodeId: '642', fieldName: 'value', fieldValue: promptText, description: '提示词' },
        { nodeId: '651', fieldName: 'value', fieldValue: '', description: '原视频描述' },
        { nodeId: '647', fieldName: 'video', fieldValue: videoUrl, description: '原视频' },
        { nodeId: '655', fieldName: 'image', fieldValue: imageUrl, description: '替换参考图' },
      ],
      instanceType: body.instanceType || 'plus',
      usePersonalQueue: 'false',
    },
    billingModelId: body.billingModelId,
    rhRegion: 'cn',
  };
}

/**
 * rhart-video-upscaler → RunningHub OpenAPI（rhRegion=cn）
 * 视频处理/超分（非生成）：无 appId / nodeInfoList；body = { videoUrl, targetResolution }。
 * duration 不进 RH body，仅用于计费 Quantity（max(floor(sec), 5)）。
 */
export function buildRhartVideoUpscalerRhForward(body: {
  /** 已完成 OSS 上传（含 ffmpeg 转码）的公网 HTTPS 输入视频 */
  videoUrl: string;
  /** UI targetResolution：720p|1080p|2k|4k */
  targetResolution?: string;
  billingModelId: string;
}): VideoQueueProviderForward {
  const videoUrl = assertWanAnimateOssHttpsUrl(body.videoUrl, '超分输入视频');
  const raw = String(body.targetResolution || '1080p').trim().toLowerCase();
  const targetResolution =
    raw === '720p' || raw === '1080p' || raw === '2k' || raw === '4k' ? raw : '1080p';
  return {
    provider: 'runninghub',
    path: RHART_VIDEO_UPSCALER_RUN_PATH,
    method: 'POST',
    body: {
      videoUrl,
      targetResolution,
    },
    billingModelId: body.billingModelId,
    rhRegion: 'cn',
  };
}

export function assertHeyGemOssHttpsUrl(url: unknown, label: string): string {
  const u = String(url || '').trim();
  if (!u) throw new Error(`hey-gem ${label} 不能为空`);
  if (/^(openapi|api)\//i.test(u)) {
    throw new Error(`hey-gem ${label} 须为 HTTPS OSS URL，不能是 RH Media fileName`);
  }
  if (!u.startsWith('https://')) {
    throw new Error(`hey-gem ${label} 必须为 HTTPS OSS URL，实际: ${u.slice(0, 80)}`);
  }
  if (/^(file:|data:|blob:|local-resource:)/i.test(u)) {
    throw new Error(`hey-gem ${label} 禁止 local/file/data/blob 写入 Queue`);
  }
  return u;
}

/**
 * hey-gem → RunningHub ai-app（rhRegion=cn）
 * 数字人：nodeInfoList 与 Direct 一致 — 1/file(参考视频)、4/audio(驱动音频)；plus；无 prompt/duration/resolution。
 * TTS 须在 Create 前完成；此处仅接收已就绪的 HTTPS 音频 URL。
 */
export function buildHeyGemRhForward(body: {
  videoUrl: string;
  audioUrl: string;
  billingModelId: string;
  instanceType?: 'plus' | 'default';
}): VideoQueueProviderForward {
  const videoUrl = assertHeyGemOssHttpsUrl(body.videoUrl, '参考视频');
  const audioUrl = assertHeyGemOssHttpsUrl(body.audioUrl, '驱动音频');
  return {
    provider: 'runninghub',
    path: HEY_GEM_RUN_PATH,
    method: 'POST',
    body: {
      nodeInfoList: [
        { nodeId: '1', fieldName: 'file', fieldValue: videoUrl, description: 'file' },
        { nodeId: '4', fieldName: 'audio', fieldValue: audioUrl, description: 'audio' },
      ],
      instanceType: body.instanceType || 'plus',
      usePersonalQueue: 'false',
    },
    billingModelId: body.billingModelId,
    rhRegion: 'cn',
  };
}

/** duration 必须为 string "6"|"10"（与 Direct 一致） */
export function normalizeGrok3StableDurationString(
  raw: string | number | undefined,
  fallback: '6' | '10' = '10',
): '6' | '10' {
  const s = String(raw ?? '').trim();
  if (s === '6' || s === '10') return s;
  const n = parseInt(s, 10);
  if (n === 6 || n === 10) return String(n) as '6' | '10';
  if (Number.isFinite(n)) return Math.abs(n - 6) <= Math.abs(n - 10) ? '6' : '10';
  return fallback;
}

/**
 * 校验 grok-3-stable imageUrls：1–7 个公网 HTTPS（禁止 RH fileName / local / data）
 */
export function assertGrok3StableHttpsImageUrls(imageUrls: unknown): string[] {
  if (!Array.isArray(imageUrls) || imageUrls.length < 1 || imageUrls.length > 7) {
    throw new Error(
      `grok-3-stable 需要 1–7 张公网图片，当前 ${Array.isArray(imageUrls) ? imageUrls.length : 0} 张`,
    );
  }
  const out: string[] = [];
  for (const raw of imageUrls) {
    const u = String(raw || '').trim();
    if (!u.startsWith('https://')) {
      throw new Error('grok-3-stable imageUrls 必须全部为 https:// 公网 URL（禁止本地/dataURL）');
    }
    if (/^(openapi|api)\//i.test(u)) {
      throw new Error('grok-3-stable imageUrls 须为 HTTPS OSS URL，不能是 RH Media fileName');
    }
    if (/^(file:|data:|blob:|local-resource:)/i.test(u)) {
      throw new Error('grok-3-stable 禁止 local/file/data/blob 写入 Queue');
    }
    out.push(u);
  }
  return out;
}

/**
 * grok-3-stable → RunningHub OpenAPI（rhRegion=ai）
 * 与 Direct 一致：imageUrls + prompt + duration(string) + resolution=720p；无 aspectRatio。
 */
export function buildGrok3StableRhForward(body: {
  prompt: string;
  /** 已完成 OSS 上传的 1–7 个 HTTPS URL */
  imageUrls: string[];
  /** 必须为 string："6" | "10" */
  duration: string;
  billingModelId: string;
}): VideoQueueProviderForward {
  const imageUrls = assertGrok3StableHttpsImageUrls(body.imageUrls);
  const duration = normalizeGrok3StableDurationString(body.duration, '10');
  return {
    provider: 'runninghub',
    path: GROK_3_STABLE_RUN_PATH,
    method: 'POST',
    body: {
      imageUrls,
      prompt: String(body.prompt || '').trim(),
      duration,
      resolution: '720p',
    },
    billingModelId: body.billingModelId,
    rhRegion: 'ai',
  };
}
