/**
 * 成本与档位原始表（单一数据源）V2.3
 * - 保留原 VIDEO_* / REVERSE_* 标量表与数值（costRmb 逻辑不变）
 * - VIDEO_BILLING_SKU_CNY：由 buildVideoBillingSkuKey 全量生成（海螺带齐 6s/10s；Veo 3.1 为分辨率+variant）
 */

import { buildVideoBillingSkuKey } from './videoBillingSku.mjs';

/** 阿里云 FC run-task 默认扣费（元宝），可被同名环境变量覆盖 */
export const FC_CLOUD_YUANBAO_DEFAULTS = {
  llm: 1,
  image: 10,
  video: 50,
  audio: 5,
};

/** FC 环境变量名 → 对应任务类型 */
export const FC_CLOUD_ENV_KEYS = {
  llm: 'NX_CHAT_COST',
  image: 'NX_IMAGE_COST',
  video: 'NX_VIDEO_COST',
  audio: 'NX_AUDIO_COST',
};

/** 默认 LLM 模型 ID（与 LLMInputPanel / FC handleLlmTask 一致） */
export const LLM_DEFAULT_CHAT_MODEL = 'gpt-3.5-turbo';

/**
 * 图片模型：基准成本（CNY/张）
 * key 为 modelId；值为标量或 { resolutionKey: cost }
 */
export const IMAGE_MODEL_CNY = {
  /** 全能图片 V2（OpenAPI /rhart-image-n-g31-flash，海外站；计费 id banana-2.0） */
  'banana-2.0': {
    default: 0.05,
    '2k': 0.08,
    '4k': 0.08,
  },
  /** 全能图片 G-2.0（OpenAPI /rhart-image-g-2/{text,image}-to-image，海外站；计费 id 同为 rhart-image-g-2，不按文/图拆 SKU） */
  'rhart-image-g-2': {
    default: 0.05,
    '2k': 0.08,
    '4k': 0.08,
  },
  /** 全能图片 X 文生图（OpenAPI /rhart-image-g/text-to-image，海外站；型号 g-3/g-4/g-4.1/g-4.2） */
  'rhart-image-g': 0.05,
  'nano-banana': {
    default: 0.2,
    '2k': 0.2,
    '4k': 0.3,
  },
  'nano-banana-2': 0.2,
  'nano-banana-2-2k': 0.2,
  'nano-banana-2-4k': 0.3,
  'mj-v7': 0.54,
  /** GPT image 2（RunningHub AI App 2048342525672427521，与 billingModelId / nx_model_config 可对齐） */
  'gpt-image-2': 0.2,
  'youchuan-text-to-image-v7': 0.54,
  /** 悠船文生图 v8.1（OpenAPI /youchuan/text-to-image-v81，海外站）；hd=原生2K 约 1.5× */
  'youchuan-text-to-image-v81': {
    default: 0.54,
    hd: 0.81,
  },
  'seedream-v4.5': 0.2,
  /** Seedream v5（国内 OpenAPI /seedream-v5-lite 文生/图生，.cn；计费 id seedream-v5；resolution 2k|3k） */
  'seedream-v5': {
    default: 0.2,
    '2k': 0.2,
    '3k': 0.2,
  },
  /** Z-image 文生图（RunningHub AI App 2059599553522921474）；后台主键 z-image-720p / z-image-1080p */
  'z-image': {
    default: 0.2,
    '720p': 0.15,
    '1080p': 0.2,
  },
  /** Lens 文生图（RunningHub AI App 2063798801864945666）；后台主键 lens-720p / lens-1080p */
  'lens': {
    default: 0.2,
    '720p': 0.15,
    '1080p': 0.2,
  },
  /** Flux2 Klein 图生图（RunningHub AI App 2059939823342936066）；后台主键 flux2-klein-720p / flux2-klein-1080p */
  'flux2-klein': {
    default: 0.2,
    '720p': 0.15,
    '1080p': 0.2,
  },
  /** RunningHub 抠图 / 去水印（billingModelId=应用 ID，与 nx_model_config / 前端展示一致） */
  '2021955919764000770': 0.01,
  '2022127885233950721': 0.01,
  /** 图像超分放大 V3（RunningHub AI App 2082378062234214401） */
  '2082378062234214401': 0.05,
  /** 人物多角度一键生成（billingModelId=应用 ID 1990056102572290049） */
  '1990056102572290049': 0.3,
  /** 图片转 3D 模型 GLB（RunningHub AI App 2059618241806430209） */
  '2059618241806430209': 0.5,
  'image-to-3d': 0.5,
  /** Trellis2 图生 3D（RunningHub AI App 2072903678922674177，default 24G） */
  '2072903678922674177': 1.0,
  trellis2: 1.0,
  'image-to-3d-trellis2': 1.0,
};

/** 图像反推（CNY/次）：canonical 与云端复合 Key 同价 */
export const REVERSE_CAPTION_CNY = {
  'gpt-4o': 0.002422,
  'joy-caption-two': 0.036,
  'gpt-4o-image-reverse': 0.002422,
  'joy-caption-two-image-reverse': 0.036,
  /** GPT-5.6 Terra 反推：与对话同模型，本地回退价（优先 nx / yuanbao 表） */
  'openai/gpt-5.6-terra': 0.02,
  'openai/gpt-5.6-terra-image-reverse': 0.02,
};

/** 音频（CNY/次）；与节点 data.model、FC billingModelId 一致 */
export const AUDIO_MODEL_CNY = {
  /**
   * 阿里云 VIAPI 视频人像分割（billingModelId=viapi-segment-video-body）。
   * 表内为「元/分钟」零售价；按输出时长秒级折算：
   *   billableSeconds = max(1, ceil(秒))；
   *   costYuanbao = max(1, ceil(unitCostPerMinute * billableSeconds / 60))。
   * nx_model_config.base_price 语义为「元/分钟」，应填 2（勿再按 30 秒档填 1）。
   */
  'viapi-segment-video-body': 2.0,
  /** 百炼 fun-asr 异步录音文件识别（按次；1 元 × yuanbao_rate10 ≈ 10 元宝） */
  'fun-asr': 1,
  'rhart-song': 0.5,
  /** RunningHub 标准模型 SUNO v5.5（billingModelId 与节点 data.model 一致） */
  'rhart-song-v5.5': 0.5,
  /** MiniMax 2.8 HD（路径首段为 rhart-audio，须显式 billingModelId） */
  'speech-2.8-hd': 0.15,
  /** Index-TTS 2.0（路径为 run/ai-app/…，须显式 billingModelId） */
  'index-tts2': 0.2,
  /** Doubao 音频生成 1.0（路径首段 bytedance，须显式 billingModelId） */
  'doubao-seed-audio-1.0': 0.2,
  /** RVC 翻唱：RVC 模型 + 原曲（run/ai-app/2073040724471406593） */
  'ai-voice-cover': 0.3,
  /** RVC 音色模型训练（run/ai-app/2072990640429953025） */
  'rvc-voice-train': 0.5,
  '2072990640429953025': 0.5,
};

/**
 * 视频：海螺系列（秒档）
 * modelIds: hailuo-02-t2v-standard, hailuo-02-i2v-standard, hailuo-2.3-t2v-standard, hailuo-2.3-i2v-standard
 */
export const VIDEO_HAILUO_SEC_CNY = {
  6: 1.5,
  10: 3,
};

/**
 * MiniMax-H3 文生/图生（RH ai-app：t2v=2085682347676102657，i2v=2085687129061019649）
 * 仅 720P（megapixels 0.9）；占位：6s/10s 对齐海螺 VIDEO_HAILUO_SEC_CNY；
 * 15s/20s 按相对 10s 线性外推（×1.5 / ×2）（官方 RH 单价未单独登记，后续可改）。
 * modelIds: minimax-h3-t2v / minimax-h3-i2v；resolutionMinimaxH3=720p；durationMinimaxH3=6|10|15|20
 *
 * 全能参考（RH ai-app 2086289185186603010；旧 2085677798773051394）：时长节点 28/value；
 * 计费对齐 H3 720P × 6/10/15/20（SKU: minimax-h3-multi-720p-{6|10|15|20}s）；OTS 需写入这 4 个 SKU。
 * modelId: minimax-h3-multi；durationMinimaxH3=6|10|15|20
 *
 * 口型同步（RH ai-app 2086260808442531842）：工作流按参考音自动读时长（无时长节点）；
 * 计费对齐 H3 720P × 6/10/15/20（SKU: minimax-h3-audio-720p-{6|10|15|20}s）；OTS 写 4 个 SKU，并删除旧 5s 行。
 * modelId: minimax-h3-audio；durationMinimaxH3=6|10|15|20（由参考音时长向上取整映射）。
 */
export const VIDEO_MINIMAX_H3_CNY = {
  '720p': { 6: 1.5, 10: 3, 15: 4.5, 20: 6 },
};

/** MiniMax-H3 文生/图生/全能参考可选时长（秒） */
export const MINIMAX_H3_DURATION_SEC = [6, 10, 15, 20];
/** MiniMax-H3 口型同步计费档（秒）；SKU 名仍为 minimax-h3-audio-720p-* */
export const MINIMAX_H3_AUDIO_DURATION_SEC = [6, 10, 15, 20];

/** @param {unknown} raw @param {number} [fallback] */
export function normalizeMinimaxH3DurationSec(raw, fallback = 10) {
  const n = parseInt(String(raw ?? '').trim(), 10);
  if (MINIMAX_H3_DURATION_SEC.includes(n)) return n;
  if (!Number.isFinite(n)) return fallback;
  let best = fallback;
  let minDist = Infinity;
  for (const v of MINIMAX_H3_DURATION_SEC) {
    const d = Math.abs(v - n);
    if (d < minDist) {
      minDist = d;
      best = v;
    }
  }
  return best;
}

/**
 * 参考音实际秒数 → 计费档：≥ 实际秒的最小档；>20 封顶 20；读不到保守 20。
 * @param {unknown} actualSec
 */
export function mapMinimaxH3AudioBillingDurationSec(actualSec) {
  const n = Number(actualSec);
  if (!Number.isFinite(n) || n <= 0) return 20;
  for (const t of MINIMAX_H3_AUDIO_DURATION_SEC) {
    if (t >= n) return t;
  }
  return 20;
}

/** @param {unknown} raw @param {number} [fallback] */
export function normalizeMinimaxH3AudioDurationSec(raw, fallback = 20) {
  const n = parseInt(String(raw ?? '').trim(), 10);
  if (MINIMAX_H3_AUDIO_DURATION_SEC.includes(n)) return n;
  if (n === 5) return 6;
  if (!Number.isFinite(n)) return fallback;
  return mapMinimaxH3AudioBillingDurationSec(n);
}

/** 可灵 2.6-pro：秒 × 有声 */
export const VIDEO_KLING_26_PRO_CNY = {
  5: { sound: 3.5, silent: 1.75 },
  10: { sound: 7, silent: 3.5 },
};

/** 可灵 o1 / o1-i2v：mode × 秒 */
export const VIDEO_KLING_O1_CNY = {
  std: { 5: 2.1, 10: 4.2 },
  pro: { 5: 2.8, 10: 5.6 },
};

/** 可灵 o1-ref */
export const VIDEO_KLING_O1_REF_CNY = {
  std: { 5: 3.15, 10: 6.3 },
  pro: { 5: 4.2, 10: 8.4 },
};

/** Grok video3 按秒计价回退用的固定档参考（原 rhart-video-g 6s/10s） */
export const VIDEO_RHART_VIDEO_G_CNY = {
  '6s': 0.2,
  '10s': 0.35,
};

/** Grok video3：按秒 × 720p（已去除 480p） */
export const VIDEO_GROK_3_PER_SEC_CNY = {
  '720p': VIDEO_RHART_VIDEO_G_CNY['10s'] / 10,
};

const GROK3_DURATION_SEC = [6, 10, 15, 30];
const RHART_VIDEO_X_DURATION_SEC = [6, 8, 10, 15, 30];
const GROK3_STABLE_DURATION_SEC = [6, 10];

/** @param {unknown} raw @param {number} [fallback] */
export function normalizeGrok3StableDurationSec(raw, fallback = 10) {
  const n = parseInt(String(raw ?? '').trim(), 10);
  if (GROK3_STABLE_DURATION_SEC.includes(n)) return n;
  if (!Number.isFinite(n)) return fallback;
  let best = fallback;
  let minDist = Infinity;
  for (const v of GROK3_STABLE_DURATION_SEC) {
    const d = Math.abs(v - n);
    if (d < minDist) {
      minDist = d;
      best = v;
    }
  }
  return best;
}

/** @param {unknown} raw @param {number} [fallback] */
export function normalizeGrok3DurationSec(raw, fallback = 10) {
  const n = parseInt(String(raw ?? '').trim(), 10);
  if (GROK3_DURATION_SEC.includes(n)) return n;
  if (!Number.isFinite(n)) return fallback;
  let best = fallback;
  let minDist = Infinity;
  for (const v of GROK3_DURATION_SEC) {
    const d = Math.abs(v - n);
    if (d < minDist) {
      minDist = d;
      best = v;
    }
  }
  return best;
}

/** @param {unknown} raw @param {number} [fallback] */
export function normalizeRhartVideoXDurationSec(raw, fallback = 10) {
  const n = parseInt(String(raw ?? '').trim(), 10);
  if (RHART_VIDEO_X_DURATION_SEC.includes(n)) return n;
  if (!Number.isFinite(n)) return fallback;
  let best = fallback;
  let minDist = Infinity;
  for (const v of RHART_VIDEO_X_DURATION_SEC) {
    const d = Math.abs(v - n);
    if (d < minDist) {
      minDist = d;
      best = v;
    }
  }
  return best;
}

/** LTX2.3 图生/文生可选时长（秒） */
export const LTX23_DURATION_SEC = [5, 10, 15];

/** @param {unknown} raw @param {number} [fallback] */
export function normalizeLtx23DurationSec(raw, fallback = 10) {
  const n = parseInt(String(raw ?? '').trim(), 10);
  if (LTX23_DURATION_SEC.includes(n)) return n;
  if (n === 25) return 15;
  if (!Number.isFinite(n)) return fallback;
  let best = fallback;
  let minDist = Infinity;
  for (const v of LTX23_DURATION_SEC) {
    const d = Math.abs(v - n);
    if (d < minDist) {
      minDist = d;
      best = v;
    }
  }
  return best;
}

/** Seedance 2.0 Fast 多模态视频可选时长（秒） */
export const SEEDANCE_DURATION_SEC = [5, 10, 15];

/** Gemini Omni 图生视频可选时长（秒） */
export const GEMINI_OMNI_DURATION_SEC = [6, 8, 10];

/** 全能视频 Omni Flash 图生视频可选时长（秒） */
export const GEMINI_OMNI_FLASH_DURATION_SEC = [6, 8, 10];

/** @param {unknown} raw @param {number} [fallback] */
export function normalizeGeminiOmniDurationSec(raw, fallback = 6) {
  const n = parseInt(String(raw ?? '').trim(), 10);
  if (GEMINI_OMNI_DURATION_SEC.includes(n)) return n;
  if (!Number.isFinite(n)) return fallback;
  let best = fallback;
  let minDist = Infinity;
  for (const v of GEMINI_OMNI_DURATION_SEC) {
    const d = Math.abs(v - n);
    if (d < minDist) {
      minDist = d;
      best = v;
    }
  }
  return best;
}

/** @param {unknown} raw @param {number} [fallback] */
export function normalizeGeminiOmniFlashDurationSec(raw, fallback = 6) {
  const n = parseInt(String(raw ?? '').trim(), 10);
  if (GEMINI_OMNI_FLASH_DURATION_SEC.includes(n)) return n;
  if (!Number.isFinite(n)) return fallback;
  let best = fallback;
  let minDist = Infinity;
  for (const v of GEMINI_OMNI_FLASH_DURATION_SEC) {
    const d = Math.abs(v - n);
    if (d < minDist) {
      minDist = d;
      best = v;
    }
  }
  return best;
}

/** @param {unknown} raw @param {number} [fallback] */
export function normalizeSeedanceDurationSec(raw, fallback = 10) {
  const n = parseInt(String(raw ?? '').trim(), 10);
  if (SEEDANCE_DURATION_SEC.includes(n)) return n;
  if (!Number.isFinite(n)) return fallback;
  let best = fallback;
  let minDist = Infinity;
  for (const v of SEEDANCE_DURATION_SEC) {
    const d = Math.abs(v - n);
    if (d < minDist) {
      minDist = d;
      best = v;
    }
  }
  return best;
}

/** rhart-v3.1-fast / fast-se */
export const VIDEO_RHART_V31_FAST_CNY = {
  '720p': 0.2,
  '1080p': 0.25,
  '4k': 0.5,
};

/** rhart-v3.1-pro / pro-se（按分辨率档）；官方未给单独海外价时与文生 pro 同档占位，720p=0.8 / 1080p=1.0 / 4k=1.4 元宝 */
export const VIDEO_RHART_V31_PRO_CNY = {
  '720p': 0.8,
  '1080p': 1,
  '4k': 1.4,
};

/** LTX2.3（首位帧）：分辨率 720p|1080p|1920p × 时长（秒）；旧 4k 可读为 1920p */
export const VIDEO_LTX23_START_END_CNY = {
  '720p': { 5: 1.2, 10: 2.4, 15: 3.6 },
  '1080p': { 5: 1.5, 10: 3, 15: 4.5 },
  '1920p': { 5: 2.4, 10: 4.8, 15: 7.2 },
  // 兼容旧存档 / 误配键
  '720': { 5: 1.2, 10: 2.4, 15: 3.6 },
  '1280': { 5: 1.5, 10: 3, 15: 4.5 },
  '1920': { 5: 2.4, 10: 4.8, 15: 7.2 },
  '4k': { 5: 2.4, 10: 4.8, 15: 7.2 },
};

/** wan-2.6：分辨率 × 时长档（秒） */
export const VIDEO_WAN_26_CNY = {
  '720p': { 5: 2.25, 10: 4.5, 15: 6.75 },
  '1080p': { 5: 3.75, 10: 7.5, 15: 11.25 },
};

/** wan-2.6-flash：每秒钟单价（CNY） */
export const VIDEO_WAN_26_FLASH_PER_SEC_CNY = {
  '720p': { withAudio: 0.23, silent: 0.11 },
  '1080p': { withAudio: 0.38, silent: 0.19 },
};

/** WanAnimate 角色替换（RunningHub）：输出挡位 × 片段秒数（对应工作流 node 250） */
export const VIDEO_WAN_ANIMATE_CNY = {
  '720p': { 5: 1.2, 8: 1.5, 10: 1.9, 15: 2.6 },
  '1080p': { 5: 1.8, 8: 2.25, 10: 2.85, 15: 3.9 },
};

/**
 * Wan animate2 视频换人：按原视频秒数 × 分辨率单价（¥/秒）。
 * OTS nx_model_config 键：wan-animate-2-720p / wan-animate-2-1080p（写入每秒 base_price）。
 * Quantity = max(1, ceil(原视频秒数))；本地表仅作参考，云端以 OTS 为准。
 */
export const VIDEO_WAN_ANIMATE_2_PER_SEC_CNY = {
  '720p': 0, // 填写 ¥/秒
  '1080p': 0, // 填写 ¥/秒
};

/** Seedance 2.0 Fast 多模态视频：无参考视频，分辨率 × 时长（秒）；720p ¥1/s，1080p ¥1.28/s */
export const VIDEO_SEEDANCE_2_0_FAST_CNY = {
  '720p': { 5: 5, 10: 10, 15: 15 },
  '1080p': { 5: 6.4, 10: 12.8, 15: 19.2 },
};

/** Seedance 2.0 Mini 多模态视频：支持参考图/视频/音频，分辨率 × 时长（秒） */
export const VIDEO_SEEDANCE_2_0_MINI_CNY = {
  '480p': { 5: 3, 10: 6, 15: 9 },
  '720p': { 5: 4, 10: 8, 15: 12 },
  '1080p': { 5: 5.12, 10: 10.24, 15: 15.36 },
  '2k': { 5: 6.4, 10: 12.8, 15: 19.2 },
  '4k': { 5: 8, 10: 16, 15: 24 },
};

function coerceSeedanceMiniResKey(raw) {
  const s = String(raw ?? '').trim().toLowerCase();
  if (s === '4k' || s === '2160p') return '4k';
  if (s === '2k' || s === '1440p') return '2k';
  if (s === '1080p' || s === '1080' || s === '1920x1080' || s === '1080x1920') return '1080p';
  if (s === '480p' || s === '480') return '480p';
  return '720p';
}

/** Gemini Omni 图生视频：分辨率 × 时长（秒）；720p/6s 对齐 Veo 3.1 fast 单档 */
export const VIDEO_GEMINI_OMNI_CNY = {
  '720p': { 6: 0.2, 8: 0.26, 10: 0.32 },
  '1080p': { 6: 0.25, 8: 0.32, 10: 0.4 },
  '4k': { 6: 0.5, 8: 0.65, 10: 0.8 },
};

/** 全能视频 Omni Flash：分辨率 × 时长（6/8/10，对齐 Omni） */
export const VIDEO_GEMINI_OMNI_FLASH_CNY = {
  '720p': { 6: 0.2, 8: 0.26, 10: 0.32 },
  '1080p': { 6: 0.25, 8: 0.32, 10: 0.4 },
  '4k': { 6: 0.5, 8: 0.65, 10: 0.8 },
};

/** 固定单价视频模型（CNY/次） */
export const VIDEO_FLAT_CNY = {
  'sora-2': 1.5,
  'ltx-2.3-lipsync': 1.5,
  'ltx-2.3-i2v': 1.5,
  'ltx-2.3-t2v': 1.5,
  'ltx-2.3-hdr-multi': 1.5,
  'ltx-2.3-msr-av': 1.5,
  'sora-2-pro': 2,
  /** 视频去水印 RunningHub AI App */
  '2049450731266121729': 0.05,
  /** 视频深度转换 RunningHub AI App */
  '2082392424818757633': 0.15,
  /** 视频去字幕/水印 RunningHub AI App */
  '2082682378039943169': 0.15,
};

/**
 * 视频超分放大（RH OpenAPI /rhart-video/video-upscaler）：
 * 元/秒（RH 官方 0.14/0.21/0.35/0.56 × 1.5）；计费秒数 = max(floor(输入时长), 5)；
 * OTS: rhart-video-upscaler-{720p|1080p|2k|4k}。
 * Quantity = 计费秒数；Cost = base_price × multiplier × yuanbao_rate × Quantity。
 */
export const VIDEO_RHART_VIDEO_UPSCALER_CNY = {
  '720p': 0.21,
  '1080p': 0.315,
  '2k': 0.525,
  '4k': 0.84,
};

/** Veo 3.1 Pro 官方图生：秒 × 是否生成音频 */
export const VIDEO_VEO_31_PRO_OFFICIAL_CNY = {
  4: { withAudio: 9.4, silent: 4.7 },
  6: { withAudio: 14.1, silent: 7.04 },
  8: { withAudio: 18.8, silent: 9.4 },
};

/** 已登记但未在 cost 表给出单价的视频模型（与 priceCalc 一致：返回 null） */
export const VIDEO_MODELS_WITHOUT_LIST_PRICE = ['kling-video-o1-start-end'];

/**
 * 合并 getVideoPrice 默认参数字段（与 price_calculator.getVideoPrice 一致）
 * @param {string} model
 * @param {Record<string, unknown>} [input]
 */
export function mergeVideoPriceDefaults(model, input = {}) {
  const m = String(model || input.model || '').trim();
  return {
    model: m,
    duration: '10',
    sound: 'false',
    durationHailuo02: '10',
    durationKlingO1: '5',
    modeKlingO1: 'std',
    durationGrok3: '10',
    resolutionGrok3: '720p',
    resolutionRhartV31: '1080p',
    resolutionWan26: '1080p',
    durationWan26Flash: '5',
    enableAudio: true,
    durationVeo31ProOfficial: '4',
    generateAudioVeo31ProOfficial: false,
    resolutionWanAnimate: '720p',
    wanAnimateClipSec: '8',
    resolutionSeedance: '720p',
    durationSeedance: '10',
    resolutionGeminiOmni: '720p',
    durationGeminiOmni: '6',
    resolutionMinimaxH3: '720p',
    durationMinimaxH3: '10',
    targetResolution: '1080p',
    ...input,
    model: m,
  };
}

/**
 * 按原分支计算基准 CNY（不含 markup）；无法计价时返回 null
 * @param {Record<string, unknown>} merged mergeVideoPriceDefaults 的结果
 * @returns {number|null}
 */
export function tryComputeRawVideoCny(merged) {
  const {
    model,
    duration = '10',
    sound = 'false',
    durationHailuo02 = '10',
    durationKlingO1 = '5',
    modeKlingO1 = 'std',
    durationGrok3 = '10',
    resolutionGrok3 = '720p',
    resolutionRhartV31 = '1080p',
    resolutionWan26 = '1080p',
    durationWan26Flash = '5',
    enableAudio = true,
    durationVeo31ProOfficial = '4',
    generateAudioVeo31ProOfficial = false,
    resolutionWanAnimate = '720p',
    wanAnimateClipSec = '8',
    resolutionSeedance = '720p',
    durationSeedance = '10',
    resolutionGeminiOmni = '720p',
    durationGeminiOmni = '6',
    resolutionMinimaxH3 = '720p',
    durationMinimaxH3 = '10',
    targetResolution = '1080p',
  } = merged;

  if (model === 'kling-video-o1-start-end') return null;

  let base = null;

  if (
    model === 'hailuo-02-t2v-standard' ||
    model === 'hailuo-02-i2v-standard' ||
    model === 'hailuo-2.3-t2v-standard' ||
    model === 'hailuo-2.3-i2v-standard'
  ) {
    const sec = durationHailuo02 === '10' ? 10 : 6;
    base = VIDEO_HAILUO_SEC_CNY[sec];
  } else if (model === 'kling-v2.6-pro') {
    const sec = duration === '5' ? 5 : 10;
    const withSound = sound === 'true';
    const row = VIDEO_KLING_26_PRO_CNY[sec];
    base = withSound ? row.sound : row.silent;
  } else if (model === 'kling-video-o1' || model === 'kling-video-o1-i2v') {
    const std = modeKlingO1 === 'std';
    const table = std ? VIDEO_KLING_O1_CNY.std : VIDEO_KLING_O1_CNY.pro;
    if (durationKlingO1 === '5') base = table[5];
    else if (durationKlingO1 === '10') base = table[10];
    else base = null;
  } else if (model === 'rhart-video-x') {
    const sec = normalizeRhartVideoXDurationSec(durationGrok3, 10);
    const rate = VIDEO_GROK_3_PER_SEC_CNY['720p'];
    base = sec * rate;
  } else if (model === 'grok-3') {
    const sec = normalizeGrok3DurationSec(durationGrok3, 10);
    const rate = VIDEO_GROK_3_PER_SEC_CNY['720p'];
    base = sec * rate;
  } else if (model === 'grok-3-stable') {
    const sec = normalizeGrok3StableDurationSec(durationGrok3, 10);
    base = sec === 10 ? VIDEO_RHART_VIDEO_G_CNY['10s'] : VIDEO_RHART_VIDEO_G_CNY['6s'];
  } else if (model === 'rhart-v3.1-fast' || model === 'rhart-v3.1-fast-se') {
    if (resolutionRhartV31 === '720p') base = VIDEO_RHART_V31_FAST_CNY['720p'];
    else if (resolutionRhartV31 === '1080p') base = VIDEO_RHART_V31_FAST_CNY['1080p'];
    else if (resolutionRhartV31 === '4k') base = VIDEO_RHART_V31_FAST_CNY['4k'];
    else base = 0.25;
  } else if (model === 'rhart-v3.1-pro' || model === 'rhart-v3.1-pro-se') {
    if (resolutionRhartV31 === '720p') base = VIDEO_RHART_V31_PRO_CNY['720p'];
    else if (resolutionRhartV31 === '1080p') base = VIDEO_RHART_V31_PRO_CNY['1080p'];
    else if (resolutionRhartV31 === '4k') base = VIDEO_RHART_V31_PRO_CNY['4k'];
    else base = 1;
  } else if (model === 'rh-video-start-end') {
    const d = Number(duration) || 5;
    const key = d <= 5 ? 5 : d <= 10 ? 10 : 15;
    const r = String(resolutionRhartV31 || '').trim().toLowerCase();
    const tier =
      r === '720' || r === '720p'
        ? '720p'
        : r === '1920' || r === '1920p' || r === '4k' || r === '2160p'
          ? '1920p'
          : '1080p';
    base = VIDEO_LTX23_START_END_CNY[tier]?.[key] ?? VIDEO_LTX23_START_END_CNY['1080p'][key];
  } else if (model === 'wan-2.6') {
    const d = Number(duration) || 10;
    if (resolutionWan26 === '720p') {
      if (d <= 5) base = VIDEO_WAN_26_CNY['720p'][5];
      else if (d <= 10) base = VIDEO_WAN_26_CNY['720p'][10];
      else base = VIDEO_WAN_26_CNY['720p'][15];
    } else if (resolutionWan26 === '1080p') {
      if (d <= 5) base = VIDEO_WAN_26_CNY['1080p'][5];
      else if (d <= 10) base = VIDEO_WAN_26_CNY['1080p'][10];
      else base = VIDEO_WAN_26_CNY['1080p'][15];
    } else {
      base = 4.5;
    }
  } else if (model === 'wan-2.6-flash') {
    const sec = Number(durationWan26Flash) || 5;
    const hasAudio = enableAudio !== false;
    let rates;
    if (resolutionWan26 === '720p') rates = VIDEO_WAN_26_FLASH_PER_SEC_CNY['720p'];
    else if (resolutionWan26 === '1080p') rates = VIDEO_WAN_26_FLASH_PER_SEC_CNY['1080p'];
    else rates = VIDEO_WAN_26_FLASH_PER_SEC_CNY['720p'];
    base = (hasAudio ? rates.withAudio : rates.silent) * sec;
  } else if (model === 'wan-animate') {
    const r = String(resolutionWanAnimate || '').trim().toLowerCase();
    const resKey =
      r === '1080p' || r === '1080' || r === '1920x1080' || r === '1080x1920' ? '1080p' : '720p';
    const clip = ['5', '8', '10', '15'].includes(String(wanAnimateClipSec)) ? String(wanAnimateClipSec) : '8';
    const secNum = parseInt(clip, 10);
    const row = VIDEO_WAN_ANIMATE_CNY[resKey] || VIDEO_WAN_ANIMATE_CNY['720p'];
    base = row[secNum] ?? row[8];
  } else if (model === 'wan-animate-2') {
    const r = String(resolutionWanAnimate || '').trim().toLowerCase();
    const resKey =
      r === '1080p' || r === '1080' || r === '1920x1080' || r === '1080x1920' ? '1080p' : '720p';
    const rawSec = Number(merged.mediaDurationSec ?? merged.duration ?? 0);
    const secNum =
      Number.isFinite(rawSec) && rawSec > 0
        ? Math.max(1, Math.ceil(Math.min(rawSec, 10 * 60) - 1e-9))
        : 1;
    const rate =
      VIDEO_WAN_ANIMATE_2_PER_SEC_CNY[resKey] ?? VIDEO_WAN_ANIMATE_2_PER_SEC_CNY['720p'];
    base = rate * secNum;
  } else if (model === 'seedance-2.0-fast') {
    const r = String(resolutionSeedance || '').trim().toLowerCase();
    const resKey = r === '1080p' ? '1080p' : '720p';
    const sec = normalizeSeedanceDurationSec(durationSeedance, 10);
    const row = VIDEO_SEEDANCE_2_0_FAST_CNY[resKey] || VIDEO_SEEDANCE_2_0_FAST_CNY['720p'];
    base = row[sec] ?? row[10];
  } else if (model === 'seedance-2.0-mini') {
    const resKey = coerceSeedanceMiniResKey(resolutionSeedance);
    const sec = normalizeSeedanceDurationSec(durationSeedance, 10);
    const row = VIDEO_SEEDANCE_2_0_MINI_CNY[resKey] || VIDEO_SEEDANCE_2_0_MINI_CNY['720p'];
    base = row[sec] ?? row[10];
  } else if (model === 'gemini-omni') {
    const r = String(resolutionGeminiOmni || '').trim().toLowerCase();
    const resKey = r === '1080p' ? '1080p' : r === '4k' ? '4k' : '720p';
    const sec = normalizeGeminiOmniDurationSec(durationGeminiOmni, 6);
    const row = VIDEO_GEMINI_OMNI_CNY[resKey] || VIDEO_GEMINI_OMNI_CNY['720p'];
    base = row[sec] ?? row[6];
  } else if (model === 'gemini-omni-flash') {
    const r = String(resolutionGeminiOmni || '').trim().toLowerCase();
    const resKey = r === '1080p' ? '1080p' : r === '4k' ? '4k' : '720p';
    const sec = normalizeGeminiOmniFlashDurationSec(durationGeminiOmni, 6);
    const row = VIDEO_GEMINI_OMNI_FLASH_CNY[resKey] || VIDEO_GEMINI_OMNI_FLASH_CNY['720p'];
    base = row[sec] ?? row[6];
  } else if (model === 'sora-2') base = VIDEO_FLAT_CNY['sora-2'];
  else if (model === 'ltx-2.3-lipsync') base = VIDEO_FLAT_CNY['ltx-2.3-lipsync'];
  else if (model === 'ltx-2.3-i2v') base = VIDEO_FLAT_CNY['ltx-2.3-i2v'];
  else if (model === 'ltx-2.3-t2v') base = VIDEO_FLAT_CNY['ltx-2.3-t2v'];
  else if (model === 'ltx-2.3-hdr-multi') base = VIDEO_FLAT_CNY['ltx-2.3-hdr-multi'];
  else if (model === 'ltx-2.3-msr-av') base = VIDEO_FLAT_CNY['ltx-2.3-msr-av'];
  else if (model === 'minimax-h3-t2v' || model === 'minimax-h3-i2v' || model === 'minimax-h3-multi') {
    const sec = normalizeMinimaxH3DurationSec(durationMinimaxH3, 10);
    const row = VIDEO_MINIMAX_H3_CNY['720p'];
    base = row[sec] ?? row[10];
  } else if (model === 'minimax-h3-audio') {
    const sec = normalizeMinimaxH3AudioDurationSec(durationMinimaxH3, 20);
    const row = VIDEO_MINIMAX_H3_CNY['720p'];
    base = row[sec] ?? row[20];
  } else if (model === 'rhart-video-upscaler') {
    const r = String(targetResolution || '').trim().toLowerCase();
    const resKey =
      r === '720p' || r === '1080p' || r === '2k' || r === '4k' ? r : '1080p';
    base = VIDEO_RHART_VIDEO_UPSCALER_CNY[resKey] ?? VIDEO_RHART_VIDEO_UPSCALER_CNY['1080p'];
  } else if (model === 'sora-2-pro') base = VIDEO_FLAT_CNY['sora-2-pro'];
  else if (Object.prototype.hasOwnProperty.call(VIDEO_FLAT_CNY, model)) {
    base = VIDEO_FLAT_CNY[model];
  } else if (model === 'rhart-v3.1-pro-official-i2v') {
    const d = durationVeo31ProOfficial;
    const withAudio = generateAudioVeo31ProOfficial === true;
    const key = d === '4' ? 4 : d === '6' ? 6 : 8;
    const row = VIDEO_VEO_31_PRO_OFFICIAL_CNY[key];
    base = withAudio ? row.withAudio : row.silent;
  } else if (model === 'kling-video-o1-ref') {
    const std = modeKlingO1 === 'std';
    const table = std ? VIDEO_KLING_O1_REF_CNY.std : VIDEO_KLING_O1_REF_CNY.pro;
    if (durationKlingO1 === '5') base = table[5];
    else if (durationKlingO1 === '10') base = table[10];
    else base = std ? VIDEO_KLING_O1_REF_CNY.std[5] : VIDEO_KLING_O1_REF_CNY.pro[5];
  }

  return base;
}

/**
 * 枚举 UI 代表性参数组合（与 check-pricing-alignment 一致；LTX 时长 5/10/15；Wan Flash 秒数 2–15）
 * @param {string[]} baseModels
 * @returns {{ model: string, input: Record<string, unknown> }[]}
 */
export function enumerateRepresentativeVideoSkuInputs(baseModels) {
  const out = [];
  const hailuoRes = [undefined, '720p', '1080p', '4k'];
  const wanRes = ['720p', '1080p'];
  const wanDur = ['5', '10', '15'];
  const klingSound = ['true', 'false'];
  const klingDur = ['5', '10'];
  const klingMode = ['std', 'pro'];
  const rhartVRes = ['720p', '1080p', '4k'];
  const veoDur = ['4', '6', '8'];
  const veoAud = [false, true];
  const ltxRes = ['720', '1280', '1920'];
  const ltxDur = ['5', '10', '15'];

  for (const model of baseModels) {
    if (/^hailuo-/.test(model)) {
      for (const resolutionHailuo of hailuoRes) {
        for (const durationHailuo02 of ['6', '10']) {
          const inp = { durationHailuo02 };
          if (resolutionHailuo) inp.resolutionHailuo = resolutionHailuo;
          out.push({ model, input: inp });
        }
      }
      continue;
    }
    if (model === 'wan-2.6') {
      for (const resolutionWan26 of wanRes) {
        for (const duration of wanDur) {
          out.push({ model, input: { resolutionWan26, duration } });
        }
      }
      continue;
    }
    if (model === 'wan-2.6-flash') {
      for (const resolutionWan26 of wanRes) {
        for (let sec = 2; sec <= 15; sec++) {
          for (const enableAudio of [true, false]) {
            out.push({
              model,
              input: { resolutionWan26, durationWan26Flash: String(sec), enableAudio },
            });
          }
        }
      }
      continue;
    }
    if (model === 'wan-animate') {
      const wanARes = ['720p', '1080p'];
      const wanAClip = ['5', '8', '10', '15'];
      for (const resolutionWanAnimate of wanARes) {
        for (const wanAnimateClipSec of wanAClip) {
          out.push({ model, input: { resolutionWanAnimate, wanAnimateClipSec } });
        }
      }
      continue;
    }
    if (model === 'wan-animate-2') {
      for (const resolutionWanAnimate of ['720p', '1080p']) {
        out.push({ model, input: { resolutionWanAnimate, mediaDurationSec: 1 } });
      }
      continue;
    }
    if (model === 'seedance-2.0-fast') {
      for (const resolutionSeedance of ['720p', '1080p']) {
        for (const durationSeedance of ['5', '10', '15']) {
          out.push({ model, input: { resolutionSeedance, durationSeedance } });
        }
      }
      continue;
    }
    if (model === 'seedance-2.0-mini') {
      for (const resolutionSeedance of ['480p', '720p', '1080p', '2k', '4k']) {
        for (const durationSeedance of ['5', '10', '15']) {
          out.push({ model, input: { resolutionSeedance, durationSeedance } });
        }
      }
      continue;
    }
    if (model === 'gemini-omni') {
      for (const resolutionGeminiOmni of ['720p', '1080p', '4k']) {
        for (const durationGeminiOmni of ['6', '8', '10']) {
          out.push({ model, input: { resolutionGeminiOmni, durationGeminiOmni } });
        }
      }
      continue;
    }
    if (model === 'gemini-omni-flash') {
      for (const resolutionGeminiOmni of ['720p', '1080p', '4k']) {
        for (const durationGeminiOmni of ['6', '8', '10']) {
          out.push({ model, input: { resolutionGeminiOmni, durationGeminiOmni } });
        }
      }
      continue;
    }
    if (model === 'kling-v2.6-pro') {
      for (const sound of klingSound) {
        for (const duration of klingDur) {
          out.push({ model, input: { sound, duration } });
        }
      }
      continue;
    }
    if (
      model === 'kling-video-o1' ||
      model === 'kling-video-o1-i2v' ||
      model === 'kling-video-o1-start-end' ||
      model === 'kling-video-o1-ref'
    ) {
      for (const modeKlingO1 of klingMode) {
        for (const durationKlingO1 of klingDur) {
          out.push({ model, input: { modeKlingO1, durationKlingO1 } });
        }
      }
      continue;
    }
    if (model === 'rhart-video-x') {
      for (const durationGrok3 of ['6', '8', '10', '15', '30']) {
        out.push({ model, input: { resolutionGrok3: '720p', durationGrok3 } });
      }
      continue;
    }
    if (model === 'grok-3') {
      for (const durationGrok3 of ['6', '10', '15', '30']) {
        out.push({ model, input: { resolutionGrok3: '720p', durationGrok3 } });
      }
      continue;
    }
    if (model === 'grok-3-stable') {
      for (const durationGrok3 of ['6', '10']) {
        out.push({ model, input: { resolutionGrok3: '720p', durationGrok3 } });
      }
      continue;
    }
    if (
      model === 'rhart-v3.1-fast' ||
      model === 'rhart-v3.1-fast-se' ||
      model === 'rhart-v3.1-pro' ||
      model === 'rhart-v3.1-pro-se'
    ) {
      for (const resolutionRhartV31 of rhartVRes) {
        out.push({ model, input: { resolutionRhartV31 } });
      }
      continue;
    }
    if (model === 'rhart-v3.1-pro-official-i2v') {
      for (const durationVeo31ProOfficial of veoDur) {
        for (const generateAudioVeo31ProOfficial of veoAud) {
          out.push({ model, input: { durationVeo31ProOfficial, generateAudioVeo31ProOfficial } });
        }
      }
      continue;
    }
    if (model === 'ltx-2.3-lipsync') {
      for (const resolutionLtx23Lipsync of ltxRes) {
        out.push({ model, input: { resolutionLtx23Lipsync } });
      }
      continue;
    }
    if (model === 'ltx-2.3-i2v' || model === 'ltx-2.3-t2v' || model === 'ltx-2.3-hdr-multi' || model === 'ltx-2.3-msr-av') {
      for (const mid of ltxRes) {
        for (const d of ltxDur) {
          const key =
            model === 'ltx-2.3-i2v'
              ? 'resolutionLtx23I2v'
              : model === 'ltx-2.3-t2v'
                ? 'resolutionLtx23T2v'
                : 'resolutionLtx23HdrMulti';
          const dkey =
            model === 'ltx-2.3-i2v'
              ? 'durationLtx23I2v'
              : model === 'ltx-2.3-t2v'
                ? 'durationLtx23T2v'
                : 'durationLtx23HdrMulti';
          out.push({ model, input: { [key]: mid, [dkey]: String(d) } });
        }
      }
      continue;
    }
    if (model === 'minimax-h3-t2v' || model === 'minimax-h3-i2v' || model === 'minimax-h3-multi') {
      for (const resolutionMinimaxH3 of ['720p']) {
        for (const durationMinimaxH3 of ['6', '10', '15', '20']) {
          out.push({ model, input: { resolutionMinimaxH3, durationMinimaxH3 } });
        }
      }
      continue;
    }
    if (model === 'minimax-h3-audio') {
      for (const resolutionMinimaxH3 of ['720p']) {
        for (const durationMinimaxH3 of ['6', '10', '15', '20']) {
          out.push({ model, input: { resolutionMinimaxH3, durationMinimaxH3 } });
        }
      }
      continue;
    }
    if (model === 'rhart-video-upscaler') {
      for (const targetResolution of ['720p', '1080p', '2k', '4k']) {
        out.push({ model, input: { targetResolution } });
      }
      continue;
    }
    out.push({ model, input: {} });
  }
  return out;
}

function buildVideoBillingSkuCnyTable() {
  /** @type {Record<string, number>} */
  const map = Object.create(null);
  const bases = [
    ...Object.keys(VIDEO_FLAT_CNY),
    'hailuo-02-t2v-standard',
    'hailuo-02-i2v-standard',
    'hailuo-2.3-t2v-standard',
    'hailuo-2.3-i2v-standard',
    'kling-v2.6-pro',
    'kling-video-o1',
    'kling-video-o1-i2v',
    'kling-video-o1-ref',
    'kling-video-o1-start-end',
    'grok-3',
    'rhart-video-x',
    'grok-3-stable',
    'rhart-v3.1-fast',
    'rhart-v3.1-fast-se',
    'rhart-v3.1-pro',
    'rhart-v3.1-pro-se',
    'wan-2.6',
    'wan-2.6-flash',
    'wan-animate',
    'wan-animate-2',
    'seedance-2.0-fast',
    'seedance-2.0-mini',
    'gemini-omni',
    'gemini-omni-flash',
    'rhart-v3.1-pro-official-i2v',
    'minimax-h3-t2v',
    'minimax-h3-i2v',
    'minimax-h3-multi',
    'minimax-h3-audio',
    'rhart-video-upscaler',
  ];

  for (const { model, input } of enumerateRepresentativeVideoSkuInputs(bases)) {
    const merged = mergeVideoPriceDefaults(model, input);
    const { model: m, ...rest } = merged;
    const sku = buildVideoBillingSkuKey(m, rest);
    if (!sku) continue;
    const cost = tryComputeRawVideoCny(merged);
    if (cost == null) continue;
    const prev = map[sku];
    if (prev != null && Math.abs(prev - cost) > 1e-9) {
      throw new Error(`VIDEO_BILLING_SKU_CNY conflict: ${sku} was ${prev}, got ${cost}`);
    }
    map[sku] = cost;
  }
  return map;
}

/** 视频脱水复合 Key → 基准 CNY（与 tryComputeRawVideoCny 一致） */
export const VIDEO_BILLING_SKU_CNY = Object.freeze(buildVideoBillingSkuCnyTable());

/** 全量模型 ID 清单（便于校验与文档） */
export const MODEL_INDEX = {
  image: Object.keys(IMAGE_MODEL_CNY),
  reverse: Object.keys(REVERSE_CAPTION_CNY),
  audio: Object.keys(AUDIO_MODEL_CNY),
  video: [
    ...Object.keys(VIDEO_FLAT_CNY),
    'hailuo-02-t2v-standard',
    'hailuo-02-i2v-standard',
    'hailuo-2.3-t2v-standard',
    'hailuo-2.3-i2v-standard',
    'kling-v2.6-pro',
    'kling-video-o1',
    'kling-video-o1-i2v',
    'kling-video-o1-ref',
    'kling-video-o1-start-end',
    'grok-3',
    'rhart-video-x',
    'grok-3-stable',
    'rhart-v3.1-fast',
    'rhart-v3.1-fast-se',
    'rhart-v3.1-pro',
    'rhart-v3.1-pro-se',
    'wan-2.6',
    'wan-2.6-flash',
    'wan-animate',
    'wan-animate-2',
    'seedance-2.0-fast',
    'seedance-2.0-mini',
    'gemini-omni',
    'gemini-omni-flash',
    'rhart-v3.1-pro-official-i2v',
    'minimax-h3-t2v',
    'minimax-h3-i2v',
    'minimax-h3-multi',
    'minimax-h3-audio',
    'rhart-video-upscaler',
  ],
  /** 视频复合计费 Key（自动生成，与 VIDEO_BILLING_SKU_CNY 同步） */
  videoBillingSku: Object.keys(VIDEO_BILLING_SKU_CNY).sort(),
};
