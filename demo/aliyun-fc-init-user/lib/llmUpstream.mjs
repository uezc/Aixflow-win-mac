/**
 * 对话 LLM 上游分流：BLTCY vs RunningHub OpenAI 兼容（llm.runninghub.ai）
 */

export const RH_LLM_MODEL_GPT56_TERRA = 'openai/gpt-5.6-terra';

export const DEFAULT_RH_LLM_BASE = 'https://llm.runninghub.ai/v1';

/** 走 RunningHub LLM 网关的模型（可按需扩展） */
export const RUNNINGHUB_LLM_MODEL_IDS = new Set([RH_LLM_MODEL_GPT56_TERRA]);

export function isRunningHubLlmModel(modelId) {
  const m = String(modelId || '').trim();
  if (!m) return false;
  if (RUNNINGHUB_LLM_MODEL_IDS.has(m)) return true;
  // 允许后续同网关 openai/* 扩展（仍须在定价表登记）
  return m.startsWith('openai/');
}

/**
 * @param {string} modelId
 * @returns {{ provider: string, url: string, apiKey: string, keyError: string }}
 */
export function resolveLlmUpstream(modelId) {
  if (isRunningHubLlmModel(modelId)) {
    const apiKey =
      process.env.RUNNINGHUB_LLM_API_KEY?.trim() ||
      process.env.RUNNINGHUB_API_KEY_AI?.trim() ||
      '';
    const base = (process.env.RUNNINGHUB_LLM_BASE_URL || DEFAULT_RH_LLM_BASE).replace(/\/$/, '');
    return {
      provider: 'runninghub-llm',
      url: `${base}/chat/completions`,
      apiKey,
      keyError: 'RUNNINGHUB_LLM_API_KEY_NOT_CONFIGURED',
    };
  }
  return {
    provider: 'bltcy',
    url: 'https://api.bltcy.ai/v1/chat/completions',
    apiKey: process.env.BLTCY_API_KEY?.trim() || '',
    keyError: 'BLTCY_API_KEY_NOT_CONFIGURED',
  };
}

/**
 * 组装 chat/completions JSON body（RH terra 带 reasoning_effort）
 */
export function buildLlmChatPayload(modelId, innerBody, messages) {
  const model = String(modelId || '').trim() || 'gpt-3.5-turbo';
  const payload = {
    model,
    messages,
    stream: false,
  };
  if (innerBody.temperature != null) payload.temperature = innerBody.temperature;
  if (innerBody.max_tokens != null) payload.max_tokens = innerBody.max_tokens;

  if (isRunningHubLlmModel(model)) {
    if (payload.temperature == null) payload.temperature = 1;
    if (payload.max_tokens == null) payload.max_tokens = 2048;
    payload.top_p = innerBody.top_p != null ? innerBody.top_p : 1;
    payload.presence_penalty = innerBody.presence_penalty != null ? innerBody.presence_penalty : 0;
    payload.frequency_penalty = innerBody.frequency_penalty != null ? innerBody.frequency_penalty : 0;
    const effort =
      innerBody.reasoning_effort != null
        ? String(innerBody.reasoning_effort)
        : 'none';
    payload.reasoning_effort = effort;
  }
  return payload;
}
