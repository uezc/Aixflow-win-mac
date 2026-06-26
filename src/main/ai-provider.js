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
import { withFcRouteFailover } from './services/nxFcRouteManager.js';

const FC_RETRY_COUNT = 3;
const FC_RETRY_DELAY_MS = 2000;

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

function isRetryable(e) {
  const code = e?.code;
  const message = String(e?.message ?? '');
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

  const buildConfig = (useJwt, access) => {
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
      timeout: forward ? 600000 : 120000,
      headers: h,
      proxy: false,
      httpsAgent,
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

  return withFcRouteFailover(async () => {
    let lastError;
    for (let attempt = 1; attempt <= FC_RETRY_COUNT; attempt++) {
      try {
        const config = buildConfig(useJwt, access);
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
        const status = e?.response?.status;
        if (useJwt && status === 401 && attempt === 1) {
          const ok = await refreshNxAccessToken();
          if (ok) {
            access = getNxAccessToken();
            continue;
          }
        }
        if (attempt < FC_RETRY_COUNT && isRetryable(e)) {
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
  });
}

/**
 * LLM：通过 FC run-task 调用 BLTCY
 * @returns {{ content: string, balance: number }}
 */
export async function callFCChat({ messages, model = 'gpt-3.5-turbo', temperature, max_tokens } = {}) {
  const taskId = genTaskId();
  const body = {
    model,
    messages,
    stream: false,
    ...(temperature != null && { temperature }),
    ...(max_tokens != null && { max_tokens }),
  };
  const { data, balance } = await callFCGenericTask({
    type: 'llm',
    taskId,
    billing: 'charge',
    body,
  });
  const content = data?.choices?.[0]?.message?.content ?? '';
  return { content, balance: Number.isFinite(balance) ? balance : 0 };
}
