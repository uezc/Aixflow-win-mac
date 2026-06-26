/**
 * 价格档位与云端计费档位元数据
 * - cloud：与 FC `type` + 环境变量对应
 * - display：前端展示用单位说明（与现有 UI「算力币」/「¥」并存）
 */

import { FC_CLOUD_YUANBAO_DEFAULTS } from './cost_table.mjs';

/** 云端任务类型（与 callFCGenericTask / run-task body.type 一致） */
export const CLOUD_TASK_TYPES = ['llm', 'image', 'video', 'audio'];

/** 各云端类型的人类可读名 */
export const CLOUD_TASK_TYPE_LABELS = {
  llm: '对话/LLM',
  image: '图片',
  video: '视频',
  audio: '音频',
};

/**
 * 从 process.env 解析 FC 扣费（元宝）；未设置时用 cost_table 默认
 * @param {Record<string, string | undefined>} [env] 默认使用 globalThis.process?.env
 */
export function resolveCloudYuanbaoFromEnv(env) {
  const e = env ?? (typeof process !== 'undefined' && process.env ? process.env : {});
  const defaults = FC_CLOUD_YUANBAO_DEFAULTS;
  const n = (key, def) => {
    const v = e[key];
    if (v == null || String(v).trim() === '') return def;
    const x = parseInt(String(v), 10);
    return Number.isFinite(x) && x >= 0 ? x : def;
  };
  return {
    llm: n('NX_CHAT_COST', defaults.llm),
    image: n('NX_IMAGE_COST', defaults.image),
    video: n('NX_VIDEO_COST', defaults.video),
    audio: n('NX_AUDIO_COST', defaults.audio),
  };
}

/** UI 参考价货币单位（与 priceCalc 注释「元/次」一致） */
export const DISPLAY_UNIT = {
  cnyPerCall: 'CNY/次',
  /** 历史文案；面板已统一为「元宝」与云端扣费一致 */
  legacyLabel: '元宝',
};

/** 批量运行按钮使用的展示单位（与 BatchRunButton 一致时可接 ¥） */
export const DISPLAY_BATCH_CURRENCY_SYMBOL = '¥';
