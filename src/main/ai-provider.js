/**
 * AI 中转 - 通过 FC run-task：LLM（BLTCY）与通用 forward（RunningHub / BLTCY）
 * 正式版：Authorization: Bearer + taskId
 */
import axios from 'axios';
import https from 'https';
import crypto from 'crypto';
import {
  getCloudUserId,
  getNxAccessToken,
  refreshNxAccessToken,
  isNxSaasMode,
  isNxOfflineCloudSession,
} from './services/aliyunService.js';
import { getAliyunFcInitUserUrl } from './config/aliyunConfig.js';
import { notifyCloudBalance } from './cloudBalanceNotifier.js';
import {
  beginFcGenerationActivity,
  endFcGenerationActivity,
  withFcRouteFailover,
} from './services/nxFcRouteManager.js';

const FC_RETRY_COUNT = 3;
const FC_RETRY_DELAY_MS = 2000;

/** 进行中的 FC LLM AbortController（支持多路并发；abortInFlightFcLlm 一次全取消） */
const llmAbortControllers = new Set();

/**
 * 取消进行中的全部 FC LLM（导演「取消」/ Esc）
 * @returns {{ aborted: boolean }}
 */
export function abortInFlightFcLlm() {
  let aborted = false;
  for (const ac of [...llmAbortControllers]) {
    try {
      ac.abort();
      aborted = true;
    } catch {
      /* ignore */
    }
  }
  llmAbortControllers.clear();
  return { aborted };
}

const httpsAgent = new https.Agent({
  keepAlive: true,
  keepAliveMsecs: 1000,
  maxSockets: 10,
  maxFreeSockets: 5,
});

function genTaskId() {
  return crypto.randomUUID
    ? crypto.randomUUID()
    : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
        const r = (Math.random() * 16) | 0;
        const v = c === 'x' ? r : (r & 0x3) | 0x8;
        return v.toString(16);
      });
}

function getRunTaskUrl() {
  const base = (getAliyunFcInitUserUrl() || '').trim().replace(/\/init-user\/?$/, '').replace(/\/$/, '');
  if (!base) return '';
  return base.endsWith('/run-task') ? base : `${base}/run-task`;
}

/** @param {unknown} e @param {{ type?: string }} [opts] */
function isRetryable(e, opts = {}) {
  const code = e?.code;
  const message = String(e?.message ?? '');
  const isTimeout =
    code === 'ECONNABORTED' ||
    code === 'ETIMEDOUT' ||
    /timeout of \d+ms exceeded/i.test(message) ||
    /timed?\s*out/i.test(message);
  // LLM 超时禁止重试：会叠扣费，且拖到客户端已放弃后仍在后台跑
  if (opts.type === 'llm' && isTimeout) return false;
  return (
    code === 'ECONNRESET' ||
    code === 'ECONNREFUSED' ||
    code === 'ETIMEDOUT' ||
    code === 'ECONNABORTED' ||
    message.includes('ECONNRESET') ||
    message.includes('socket hang up') ||
    message.includes('network')
  );
}

async function postRunTask(url, payload, config) {
  return axios.post(url, payload, config);
}

/**
 * 通用 FC run-task：type +（可选）forward，或 LLM 的 body.messages
 * @param {object} opts
 * @param {string} [opts.type='llm'] llm|image|video|audio
 * @param {string} opts.taskId
 * @param {string} [opts.billing='charge'] charge|none
 * @param {object} [opts.forward] { provider, path, method, body }
 * @returns {{ data: object, balance?: number }}
 */
export async function callFCGenericTask(opts = {}) {
  const {
    type = 'llm',
    taskId,
    billing = 'charge',
    forward,
    body: llmInnerBody,
    billingModelId,
    refundReason,
  } = opts;

  const url = getRunTaskUrl();
  const token = (process.env.ALIYUN_FC_TOKEN || '').trim();
  if (!url) throw new Error('未配置 ALIYUN_FC_INIT_USER_URL');
  if (!token) throw new Error('未配置 ALIYUN_FC_TOKEN');
  if (!taskId) throw new Error('taskId required');

  const bid = billingModelId != null ? String(billingModelId).trim() : '';

  const payload = {
    taskId,
    type,
    billing,
    ...(bid ? { billingModelId: bid } : {}),
    ...(opts.rhRegion === 'ai' || opts.rhRegion === 'cn' ? { rhRegion: opts.rhRegion } : {}),
    ...(refundReason != null && String(refundReason).trim() ? { refundReason: String(refundReason).trim() } : {}),
    ...(forward && typeof forward === 'object' ? { forward } : {}),
    ...(type === 'llm' && llmInnerBody && typeof llmInnerBody === 'object' ? { body: llmInnerBody } : {}),
  };

  const buildPayload = (useJwt) => {
    if (useJwt) return payload;
    const userId = getCloudUserId();
    return {
      machineId: userId,
      ...payload,
    };
  };

  const buildConfig = (useJwt, access, signal) => {
    const h = {
      'Content-Type': 'application/json; charset=utf-8',
      'x-nexflow-token': token,
    };
    if (useJwt && access) {
      h.Authorization = `Bearer ${access}`;
    } else if (!isNxSaasMode()) {
      h['x-user-id'] = getCloudUserId();
      h['x-task-id'] = taskId;
    }
    return {
      timeout: forward ? 600000 : 300000,
      headers: h,
      proxy: false,
      httpsAgent,
      ...(signal ? { signal } : {}),
    };
  };

  const saas = isNxSaasMode();
  const rawAccess = getNxAccessToken();
  const offline = isNxOfflineCloudSession();
  // 离线占位 token 不能当 JWT 发给 FC，否则会 401 且日志里带出巨型请求体
  if (saas && (!rawAccess || offline)) {
    const err = new Error('NX_AUTH_REQUIRED');
    err.code = 'NX_AUTH_REQUIRED';
    throw err;
  }

  let useJwt = saas || (!!rawAccess && !offline);
  let access = offline ? '' : rawAccess;

  const isLlm = type === 'llm' && !forward;
  /** @type {AbortController | null} */
  let myLlmAbort = null;
  if (isLlm) {
    // 批量优化提示词等场景需要多路并发；勿再「新请求顶替旧请求」
    myLlmAbort = new AbortController();
    llmAbortControllers.add(myLlmAbort);
    beginFcGenerationActivity();
  }

  try {
    const runWithRetries = async () => {
      let lastError;
      // LLM：禁止线路故障切换叠两次 180s；仅允许 401 换票后重试 1 次
      const maxAttempts = isLlm ? 2 : FC_RETRY_COUNT;
      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
          const signal = isLlm ? myLlmAbort?.signal : undefined;
          if (signal?.aborted) {
            const err = new Error('cancelled');
            err.code = 'ERR_CANCELED';
            err.name = 'CanceledError';
            throw err;
          }
          const config = buildConfig(useJwt, access, signal);
          const { data } = await postRunTask(url, buildPayload(useJwt), config);
          const balRaw = data?.balance;
          const balanceNum = typeof balRaw === 'number' ? balRaw : Number(balRaw);
          const rest = { ...data };
          if (Object.prototype.hasOwnProperty.call(rest, 'balance')) {
            delete rest.balance;
          }
          if (Number.isFinite(balanceNum)) {
            notifyCloudBalance(balanceNum);
          }
          return { data: rest, balance: balanceNum };
        } catch (e) {
          lastError = e;
          if (e?.code === 'ERR_CANCELED' || e?.name === 'CanceledError' || e?.name === 'AbortError') {
            const err = new Error('已取消');
            err.code = 'ERR_CANCELED';
            err.name = 'CanceledError';
            throw err;
          }
          const status = e?.response?.status;
          if (useJwt && status === 401 && attempt === 1) {
            const ok = await refreshNxAccessToken({ force: true });
            if (ok) {
              access = getNxAccessToken();
              continue;
            }
          }
          if (!isLlm && attempt < FC_RETRY_COUNT && isRetryable(e, { type })) {
            console.warn(
              `[FC] run-task 请求失败 (${e?.code || e?.message})，${FC_RETRY_DELAY_MS / 1000}s 后重试 (${attempt}/${FC_RETRY_COUNT})`,
            );
            await new Promise((r) => setTimeout(r, FC_RETRY_DELAY_MS));
          } else {
            throw lastError;
          }
        }
      }
      throw lastError;
    };

    // LLM 不做 HK↔北京 failover：超时后再切线路会把等待叠到 4～6 分钟，导演台必现「响应超时」
    if (isLlm) {
      return await runWithRetries();
    }
    return await withFcRouteFailover(runWithRetries);
  } finally {
    if (isLlm) {
      if (myLlmAbort) llmAbortControllers.delete(myLlmAbort);
      endFcGenerationActivity();
    }
  }
}

/**
 * 从 OpenAI / RunningHub 兼容 message 中提取最终文本。
 * GPT-5.x Terra 等可能返回 content 为 parts 数组，或把正文放在 output_text。
 */
function extractChatMessageText(message) {
  if (message == null) return '';
  if (typeof message === 'string') return message.trim();
  if (typeof message !== 'object') return String(message || '').trim();

  const parts = [];
  const push = (v) => {
    if (v == null) return;
    if (typeof v === 'string') {
      const t = v.trim();
      if (t) parts.push(t);
      return;
    }
    if (Array.isArray(v)) {
      for (const item of v) push(item);
      return;
    }
    if (typeof v === 'object') {
      const type = String(v.type || '').toLowerCase();
      if (/reason|thinking|thought/.test(type)) return;
      push(v.text ?? v.content ?? v.value ?? v.output_text);
    }
  };

  push(message.content);
  if (!parts.length) push(message.output_text);
  if (!parts.length && typeof message.refusal === 'string') push(message.refusal);

  // 最后兜底：reasoning 里若夹带 JSON 剧本，仍尝试捞出（避免空返回直接解析失败）
  if (!parts.length && typeof message.reasoning_content === 'string') {
    const rc = message.reasoning_content;
    if (/"plot"\s*:|段号\s*\|/.test(rc)) push(rc);
  }

  return parts.join('\n').trim();
}

/**
 * LLM：通过 FC run-task 调用 BLTCY
 * @returns {{ content: string, balance: number, finishReason?: string }}
 */
export async function callFCChat({
  messages,
  model = 'gpt-3.5-turbo',
  temperature,
  max_tokens,
  response_format,
} = {}) {
  const taskId = genTaskId();
  const body = {
    model,
    messages,
    stream: false,
    ...(temperature != null && { temperature }),
    ...(max_tokens != null && { max_tokens }),
    ...(response_format != null && { response_format }),
  };
  const { data, balance } = await callFCGenericTask({
    type: 'llm',
    taskId,
    billing: 'charge',
    body,
  });
  const choice = data?.choices?.[0];
  const message = choice?.message ?? data?.message ?? null;
  let content = extractChatMessageText(message);
  // 部分网关把正文放在 data.text / data.output
  if (!content) {
    content = extractChatMessageText({ content: data?.text ?? data?.output ?? data?.result ?? '' });
  }
  const finishReason = choice?.finish_reason ?? choice?.finishReason ?? data?.finish_reason;
  if (!content) {
    console.warn('[callFCChat] empty assistant content', {
      model,
      finishReason,
      messageKeys: message && typeof message === 'object' ? Object.keys(message) : [],
      contentType: message ? typeof message.content : 'n/a',
      isContentArray: Array.isArray(message?.content),
    });
  } else if (typeof message?.content !== 'string' && message?.content != null) {
    console.log('[callFCChat] coerced non-string content', {
      model,
      finishReason,
      contentType: typeof message.content,
      isContentArray: Array.isArray(message.content),
      textLen: content.length,
    });
  }
  return {
    content,
    balance: Number.isFinite(balance) ? balance : 0,
    finishReason: finishReason != null ? String(finishReason) : undefined,
  };
}
