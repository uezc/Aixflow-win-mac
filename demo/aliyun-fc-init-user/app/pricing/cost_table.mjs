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
  'banana-2.0': {
    default: 0.05,
    '2k': 0.08,
    '4k': 0.08,
  },
  'nano-banana': {
    default: 0.2,
    '2k': 0.2,
    '4k': 0.3,
  },
  'nano-banana-2': 0.2,
  'nano-banana-2-2k': 0.2,
  'nano-banana-2-4k': 0.3,
  'rhart-image-g-1.5': 0.03,
  'youchuan-text-to-image-v7': 0.54,
  'seedream-v4.5': 0.2,
  'seedream-v5': 0.2,
  /** RunningHub 抠图 / 去水印（billingModelId=应用 ID，与 nx_model_config / 前端展示一致） */
  '2021955919764000770': 0.01,
  '2022127885233950721': 0.01,
};

/** 图像反推（CNY/次）：canonical 与云端复合 Key 同价 */
export const REVERSE_CAPTION_CNY = {
  'gpt-4o': 0.002422,
  'joy-caption-two': 0.036,
  'gpt-4o-image-reverse': 0.002422,
  'joy-caption-two-image-reverse': 0.036,
};

/** 音频（CNY/次）；与节点 data.model、FC billingModelId 一致 */
export const AUDIO_MODEL_CNY = {
  'rhart-song': 0.5,
  'rhart-song-v5.5': 0.5,
  /** MiniMax 2.8 HD（路径首段为 rhart-audio，须显式 billingModelId） */
  'speech-2.8-hd': 0.15,
  /** Index-TTS 2.0（路径为 run/ai-app/…，须显式 billingModelId） */
  'index-tts2': 0.2,
};

/**
 * 视频：海螺系列（秒档）
 * modelIds: hailuo-02-t2v-standard, hailuo-02-i2v-standard, hailuo-2.3-t2v-standard, hailuo-2.3-i2v-standard
 */
export const VIDEO_HAILUO_SEC_CNY = {
  6: 1.5,
  10: 3,
};

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

/** rhart-video-g */
export const VIDEO_RHART_VIDEO_G_CNY = {
  '6s': 0.2,
  '10s': 0.35,
};

/** rhart-v3.1-fast / fast-se */
export const VIDEO_RHART_V31_FAST_CNY = {
  '720p': 0.2,
  '1080p': 0.25,
  '4k': 0.5,
};

/** rhart-v3.1-pro / pro-se */
export const VIDEO_RHART_V31_PRO_CNY = {
  '720p': 0.8,
  '1080p': 1,
  '4k': 1.4,
};

export const VIDEO_LTX23_START_END_CNY = {
  '720p': { 5: 1.2, 10: 2.4, 15: 3.6 },
  '1080p': { 5: 1.5, 10: 3, 15: 4.5 },
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

/** 固定单价视频模型（CNY/次） */
export const VIDEO_FLAT_CNY = {
  'sora-2': 1.5,
  'ltx-2.3-lipsync': 1.5,
  'ltx-2.3-i2v': 1.5,
  'ltx-2.3-t2v': 1.5,
  'sora-2-pro': 2,
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
    durationRhartVideoG: '6s',
    resolutionRhartV31: '1080p',
    resolutionWan26: '1080p',
    durationWan26Flash: '5',
    enableAudio: true,
    durationVeo31ProOfficial: '4',
    generateAudioVeo31ProOfficial: false,
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
    durationRhartVideoG = '6s',
    resolutionRhartV31 = '1080p',
    resolutionWan26 = '1080p',
    durationWan26Flash = '5',
    enableAudio = true,
    durationVeo31ProOfficial = '4',
    generateAudioVeo31ProOfficial = false,
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
  } else if (model === 'rhart-video-g') {
    base = durationRhartVideoG === '10s' ? VIDEO_RHART_VIDEO_G_CNY['10s'] : VIDEO_RHART_VIDEO_G_CNY['6s'];
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
    if (resolutionRhartV31 === '720p') base = VIDEO_LTX23_START_END_CNY['720p'][key];
    else if (resolutionRhartV31 === '1080p') base = VIDEO_LTX23_START_END_CNY['1080p'][key];
    else if (resolutionRhartV31 === '4k') base = VIDEO_LTX23_START_END_CNY['4k'][key];
    else base = VIDEO_LTX23_START_END_CNY['1080p'][key];
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
  } else if (model === 'sora-2') base = VIDEO_FLAT_CNY['sora-2'];
  else if (model === 'ltx-2.3-lipsync') base = VIDEO_FLAT_CNY['ltx-2.3-lipsync'];
  else if (model === 'ltx-2.3-i2v') base = VIDEO_FLAT_CNY['ltx-2.3-i2v'];
  else if (model === 'ltx-2.3-t2v') base = VIDEO_FLAT_CNY['ltx-2.3-t2v'];
  else if (model === 'sora-2-pro') base = VIDEO_FLAT_CNY['sora-2-pro'];
  else if (model === 'rhart-v3.1-pro-official-i2v') {
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
 * 枚举 UI 代表性参数组合（与 check-pricing-alignment 一致；LTX 时长含 15/25；Wan Flash 秒数 2–15）
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
  const ltxDur = ['5', '10', '15', '25'];

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
    if (model === 'rhart-video-g') {
      for (const durationRhartVideoG of ['6s', '10s']) {
        out.push({ model, input: { durationRhartVideoG } });
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
    if (model === 'ltx-2.3-i2v' || model === 'ltx-2.3-t2v') {
      for (const mid of ltxRes) {
        for (const d of ltxDur) {
          const key = model === 'ltx-2.3-i2v' ? 'resolutionLtx23I2v' : 'resolutionLtx23T2v';
          const dkey = model === 'ltx-2.3-i2v' ? 'durationLtx23I2v' : 'durationLtx23T2v';
          out.push({ model, input: { [key]: mid, [dkey]: String(d) } });
        }
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
    'rhart-video-g',
    'rhart-v3.1-fast',
    'rhart-v3.1-fast-se',
    'rhart-v3.1-pro',
    'rhart-v3.1-pro-se',
    'wan-2.6',
    'wan-2.6-flash',
    'rhart-v3.1-pro-official-i2v',
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
    'rhart-video-g',
    'rhart-v3.1-fast',
    'rhart-v3.1-fast-se',
    'rhart-v3.1-pro',
    'rhart-v3.1-pro-se',
    'wan-2.6',
    'wan-2.6-flash',
    'rhart-v3.1-pro-official-i2v',
  ],
  /** 视频复合计费 Key（自动生成，与 VIDEO_BILLING_SKU_CNY 同步） */
  videoBillingSku: Object.keys(VIDEO_BILLING_SKU_CNY).sort(),
};
