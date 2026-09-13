/**
 * AIXFLOW 正式�?FC：JWT 注册/登录 + run-task 扣费
 * 部署约定：阿里云香港地域 FC；OTS/OSS 与函数同地域（见仓库�?.env.example�? * 环境变量：JWT_SECRET, JWT_REFRESH_SECRET, BLTCY_API_KEY, OTS_ENDPOINT, OTS_INSTANCE（或 OTS_INST_NAME�? OTS_*, API_SECRET_TOKEN（可选）
 *
 * 自定义运行时：直接执�?`node index.mjs` 时会�?0.0.0.0:9000（或 PORT）起 node:http 服务，请求仍�?handler -> handleRequest + CORS�? */
import { createRequire } from 'module';
import crypto from 'crypto';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  normalizeRhPath,
  pickRunningHubTarget,
  isRhQueryPath,
  extractRhTaskIdFromForwardData,
  persistRhTaskRegion,
  resolveRhRegionForQuery,
  rhAuthErrorMessage,
  forceOverseasByBillingOrPath,
  buildRunningHubForwardUrl,
} from './lib/runningHubTarget.mjs';
import { resolveLlmUpstream, buildLlmChatPayload } from './lib/llmUpstream.mjs';

/** 阿里�?FC 自定义运行时 / 事件模式均可能设�?*/
function isAliyunFcRuntime() {
  return Boolean(
    process.env.FC_FUNCTION_NAME ||
      process.env.FC_SERVICE_NAME ||
      process.env.ALIYUN_FC_FUNCTION_NAME,
  );
}

/**
 * Tablestore 实例名：优先 OTS_INSTANCE（与仓库 .env.example 一致），兼�?FC 控制台常见命�?OTS_INST_NAME（二选一即可�? * @returns {string}
 */
function getOtsInstanceName() {
  return process.env.OTS_INSTANCE?.trim() || process.env.OTS_INST_NAME?.trim() || '';
}

/**
 * 启动时仅打印提示，不退出进程（避免仅使�?/api/admin 等子集时实例无法启动�? * 须在任意 await import 之前调用：保证事件模式与自定义运行时均第一时间自检
 */
function checkFcDeployEnv() {
  const missing = [];
  if (!process.env.JWT_SECRET?.trim()) missing.push('JWT_SECRET');
  if (!process.env.OTS_ENDPOINT?.trim()) missing.push('OTS_ENDPOINT');
  if (!getOtsInstanceName()) missing.push('OTS_INSTANCE �?OTS_INST_NAME');
  if (missing.length && isAliyunFcRuntime()) {
    console.warn(
      '[AIXFLOW FC] 以下环境变量未配置，登录/扣费/OTS 相关接口将不可用�?,
      missing.join(', '),
    );
  }
}

/** 模块顶层、最早副作用：先于本文件内所�?top-level await */
checkFcDeployEnv();

/**
 * 定价模块按需加载：登�?注册等路径不依赖 pricing；若部署包漏�?/code/pricing/，仅影响扣费类接口而非整实例冷启动失败�? * 完整部署仍须包含 pricing/（npm run fc:pack 会打�?zip）�? */
let _pricingMod = null;
async function ensurePricing() {
  if (_pricingMod) return _pricingMod;
  try {
    _pricingMod = await import(new URL('./pricing/price_calculator.mjs', import.meta.url));
  } catch (e) {
    console.error('[AIXFLOW] FATAL: failed to import ./pricing/price_calculator.mjs', e?.stack || e);
    throw e;
  }
  return _pricingMod;
}

let getCorsHeaders;
let adminCorsJsonHeaders;
try {
  const corsMod = await import(new URL('./lib/cors-admin-headers.mjs', import.meta.url));
  getCorsHeaders = corsMod.getCorsHeaders;
  adminCorsJsonHeaders = corsMod.adminCorsJsonHeaders;
} catch (e) {
  console.error('[AIXFLOW] FATAL: failed to import ./lib/cors-admin-headers.mjs', e?.stack || e);
  process.exit(1);
}

const require = createRequire(import.meta.url);
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');

let db = null;

async function ensureDb() {
  if (db) return db;
  try {
    const m = await import(new URL('./lib/db-tablestore.mjs', import.meta.url));
    db = m;
  } catch (e) {
    console.error('[AIXFLOW] FATAL: failed to import ./lib/db-tablestore.mjs', e?.stack || e);
    throw e;
  }
  return db;
}

/** �?POST /model-config 同源；供 run-task �?nx_model_config 扣费（短缓存�?*/
let _nxModelConfigMapCache = { map: null, at: 0 };
const NX_MODEL_CONFIG_CACHE_MS = 60_000;

function invalidateNxModelConfigCache() {
  _nxModelConfigMapCache = { map: null, at: 0 };
}

async function loadNxModelConfigMapForBilling(dbModule) {
  const now = Date.now();
  if (_nxModelConfigMapCache.map && now - _nxModelConfigMapCache.at < NX_MODEL_CONFIG_CACHE_MS) {
    return _nxModelConfigMapCache.map;
  }
  const listFn = dbModule.listModelConfig;
  if (typeof listFn !== 'function') return null;
  const rows = await listFn();
  const map = Object.create(null);
  for (const r of rows || []) {
    if (r && typeof r === 'object' && r.model_id != null) {
      const id = String(r.model_id).trim().toLowerCase();
      if (id) map[id] = r;
    }
  }
  _nxModelConfigMapCache = { map, at: now };
  return map;
}

function normalizeForwardTaskType(taskType) {
  const t = String(taskType || 'image').toLowerCase();
  if (t === 'image' || t === 'video' || t === 'audio') return t;
  return 'image';
}

/**
 * �?RunningHub 路径�?body 提取模型 ID（与 pricing �?model 字段对齐�? * @param {string} path
 * @param {Record<string, unknown>} bodyObj
 */
function extractModelIdFromForward(path, bodyObj) {
  const b = bodyObj && typeof bodyObj === 'object' ? bodyObj : {};
  if (typeof b.model === 'string' && b.model.trim()) return b.model.trim();
  const p = String(path || '').replace(/^\//, '');
  // /run/ai-app/{appId} �?应用 ID（勿取首�?"run"�?  const aiApp = p.match(/^run\/ai-app\/([a-zA-Z0-9._-]+)/i);
  if (aiApp?.[1]) return aiApp[1];
  const seg = p.split('/').filter(Boolean)[0];
  if (seg && /^[a-zA-Z0-9._-]+$/.test(seg)) return seg;
  return '';
}
const RATE_LIMIT_WINDOW_MS = 60 * 1000;
/** 单用户每分钟最�?run-task 次数（防刷） */
const RATE_LIMIT_MAX = Math.max(5, parseInt(process.env.NX_RATE_LIMIT_MAX || '20', 10) || 20);
const BLTCY_CHAT_URL = `${(process.env.BLTCY_API_BASE || 'https://api.apilio.ai').replace(/\/$/, '')}/v1/chat/completions`;
// v3 改造后剧本分析链路变长（Analyze + NarrativePlanning + ShotPlan + 对白补齐 + 校验）
// 配合阿里云控制台 FC 函数超时调到 300s，fetch BLTCY 也放宽到 5 分钟
const API_TIMEOUT_MS = 300000;
const ACCESS_EXPIRES = process.env.JWT_ACCESS_EXPIRES || '30m';
const REFRESH_EXPIRES = process.env.JWT_REFRESH_EXPIRES || '7d';

const rateLimitMap = new Map();

function getJwtSecrets() {
  const a = process.env.JWT_SECRET?.trim();
  const r = process.env.JWT_REFRESH_SECRET?.trim() || a;
  if (!a) {
    const err = new Error('请在 FC 环境变量中配�?JWT_SECRET（用于签�?JWT�?);
    err.code = 'JWT_SECRET_NOT_CONFIGURED';
    err.name = 'JWT_SECRET_NOT_CONFIGURED';
    throw err;
  }
  return { access: a, refresh: r };
}

/** @param {string} userId @param {number} [tokenVersion] nx_users.token_version，须写入 JWT 以便改密后作废旧会话 */
function signTokens(userId, tokenVersion = 0) {
  const tv = Math.max(0, parseInt(String(tokenVersion), 10) || 0);
  const { access, refresh } = getJwtSecrets();
  const accessToken = jwt.sign({ sub: userId, typ: 'access', tv }, access, { expiresIn: ACCESS_EXPIRES });
  const refreshToken = jwt.sign({ sub: userId, typ: 'refresh', tv }, refresh, { expiresIn: REFRESH_EXPIRES });
  return { accessToken, refreshToken, expiresIn: ACCESS_EXPIRES };
}

/** 校验 access JWT �?token �?tv �?nx_users.token_version 一致（改密后旧 token 失效�?*/
async function verifyAccessTokenAsync(authHeader, dbModule) {
  const raw = authHeader && String(authHeader).replace(/^Bearer\s+/i, '').trim();
  if (!raw) return null;
  let p;
  try {
    const { access } = getJwtSecrets();
    p = jwt.verify(raw, access);
  } catch {
    return null;
  }
  if (p.typ && p.typ !== 'access') return null;
  const userId = p.sub || p.user_id;
  if (!userId) return null;
  const u = await dbModule.getUserById(userId);
  if (!u) return null;
  const userTv = u.tokenVersion ?? 0;
  const claimTv = p.tv;
  if (claimTv === undefined || claimTv === null) {
    if (userTv !== 0) return null;
  } else if (Number(claimTv) !== userTv) {
    return null;
  }
  return userId;
}

async function verifyRefreshTokenAsync(token, dbModule) {
  let p;
  try {
    const { refresh } = getJwtSecrets();
    p = jwt.verify(String(token || '').trim(), refresh);
  } catch {
    return null;
  }
  if (p.typ !== 'refresh') return null;
  const userId = p.sub;
  if (!userId) return null;
  const u = await dbModule.getUserById(userId);
  if (!u) return null;
  const userTv = u.tokenVersion ?? 0;
  const claimTv = p.tv;
  if (claimTv === undefined || claimTv === null) {
    if (userTv !== 0) return null;
  } else if (Number(claimTv) !== userTv) {
    return null;
  }
  return userId;
}

/** 邮箱验证�?HTML：深色极简 */
function buildOtpEmailHtml(code) {
  const safe = String(code).replace(/[^0-9]/g, '').slice(0, 6);
  return `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"></head>
<body style="margin:0;background:#0a0a0c;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#0a0a0c;padding:48px 16px;">
    <tr><td align="center">
      <div style="max-width:440px;font-family:system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
        <p style="color:#9ca3af;font-size:15px;margin:0 0 20px;letter-spacing:0.02em;">登录验证�?/p>
        <div style="background:#12121a;border:1px solid rgba(255,255,255,0.08);border-radius:20px;padding:36px 28px;text-align:center;box-shadow:0 24px 48px rgba(0,0,0,0.45);">
          <span style="color:#f4f4f5;font-size:44px;font-weight:700;letter-spacing:12px;font-variant-numeric:tabular-nums;line-height:1.2;">${safe}</span>
        </div>
        <p style="color:#52525b;font-size:12px;margin:28px 0 0;line-height:1.6;">5 分钟内有效。若您未请求此邮件，请忽略�?/p>
      </div>
    </td></tr>
  </table>
</body></html>`;
}

/**
 * 基于 nx_verify_codes.send_rate_ts（JSON 时间戳数组）限制发信：默�?60s �?1 次、滑�?1 小时内最�?5 次�? * 环境变量：NX_SEND_CODE_MIN_MS、NX_SEND_CODE_HOUR_MS、NX_SEND_CODE_PER_HOUR_MAX
 */
function planSendCodeRateFromRow(row, nowMs = Date.now()) {
  const minMs = Math.max(1000, parseInt(process.env.NX_SEND_CODE_MIN_MS || '60000', 10) || 60000);
  const hourMs = Math.max(minMs, parseInt(process.env.NX_SEND_CODE_HOUR_MS || String(3600000), 10) || 3600000);
  const hourMax = Math.max(1, parseInt(process.env.NX_SEND_CODE_PER_HOUR_MAX || '5', 10) || 5);
  const staleMs = Math.max(hourMs * 48, 86400000);
  const rawList = row?.sendRateTs && Array.isArray(row.sendRateTs) ? row.sendRateTs : [];
  const trimmed = rawList.filter((t) => nowMs - Number(t) <= staleMs).slice(-80);
  const inMin = trimmed.filter((t) => nowMs - Number(t) < minMs);
  if (inMin.length > 0) {
    return { ok: false, reason: 'RATE_MIN' };
  }
  const inHour = trimmed.filter((t) => nowMs - Number(t) < hourMs);
  if (inHour.length >= hourMax) {
    return { ok: false, reason: 'RATE_HOUR' };
  }
  return { ok: true, nextList: [...trimmed, nowMs] };
}

function checkLegacyToken(req) {
  const t = process.env.API_SECRET_TOKEN;
  if (!t) return true;
  const h = req?.headers?.['x-nexflow-token'] || req?.headers?.['X-Nexflow-Token'];
  return h === t;
}

function checkRateLimit(key) {
  const now = Date.now();
  let e = rateLimitMap.get(key);
  if (!e) {
    rateLimitMap.set(key, { count: 1, windowStart: now });
    return true;
  }
  if (now - e.windowStart >= RATE_LIMIT_WINDOW_MS) {
    e.count = 1;
    e.windowStart = now;
    return true;
  }
  if (e.count >= RATE_LIMIT_MAX) return false;
  e.count++;
  return true;
}

/**
 * �?FC / API 网关事件中解�?HTTP Method（预检 OPTIONS 若未正确传入会误落默�?POST，导�?CORS 401�? */
function extractHttpMethod(event) {
  const h = event.headers || {};
  const fromHeader = (name) => {
    const lower = name.toLowerCase();
    for (const k of Object.keys(h)) {
      if (k.toLowerCase() === lower) return h[k];
    }
    return undefined;
  };
  const raw =
    event.httpMethod ||
    event.HttpMethod ||
    event.method ||
    event.requestContext?.http?.method ||
    event.requestContext?.httpMethod ||
    event.requestContext?.requestMethod ||
    fromHeader('x-fc-http-method') ||
    fromHeader('X-Fc-Http-Method');
  return String(raw || 'POST').toUpperCase();
}

/**
 * �?FC / API 网关事件中解�?path（FC 3.0 常见：仅 requestContext.http.path，无 rawPath�? */
function extractHttpPath(event) {
  if (!event || typeof event !== 'object') return '/';
  const raw =
    event.rawPath ||
    event.path ||
    event.requestContext?.http?.path ||
    event.requestContext?.https?.path ||
    '';
  const s = String(raw || '/').split('?')[0] || '/';
  return s.startsWith('/') ? s : `/${s}`;
}

/**
 * 规范�?HTTP 触发器返回值，避免 body 非字符串或带 x-fc-* 响应头导致网�?502（BadResponse�? */
function sanitizeFcResponse(res) {
  if (!res || typeof res !== 'object') {
    return {
      statusCode: 500,
      headers: { ...getCorsHeaders(), 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify({ error: 'INVALID_HANDLER_OUTPUT' }),
    };
  }
  const statusCode =
    Number.isFinite(Number(res.statusCode)) && Number(res.statusCode) >= 100 && Number(res.statusCode) <= 599
      ? Math.trunc(Number(res.statusCode))
      : 500;
  const rawH = res.headers && typeof res.headers === 'object' ? { ...res.headers } : {};
  const headers = {};
  for (const [k, v] of Object.entries(rawH)) {
    if (!k || String(k).toLowerCase().startsWith('x-fc-')) continue;
    headers[k] = v === undefined || v === null ? '' : String(v);
  }
  let body = res.body;
  if (body !== undefined && body !== null && typeof body !== 'string') {
    try {
      body = JSON.stringify(body);
    } catch {
      body = '{"error":"NON_SERIALIZABLE_BODY"}';
    }
  }
  if (body === undefined || body === null) {
    body = statusCode === 204 ? '' : '{}';
  }
  return { statusCode, headers, body };
}

/**
 * 最优先处理：仅 JSON.parse 一次，识别任意路径 OPTIONS，立�?204 + CORS（不进入业务�? */
function tryOptionsPreflightFirst(req) {
  try {
    let eventStr;
    if (Buffer.isBuffer(req) || (req && typeof req.length === 'number' && typeof req.toString === 'function')) {
      eventStr = req.toString('utf8');
    } else if (typeof req === 'string') {
      eventStr = req;
    } else {
      return null;
    }
    if (!eventStr?.trim()) return null;
    const event = JSON.parse(eventStr);
    const method = extractHttpMethod(event);
    if (method === 'OPTIONS') {
      return { statusCode: 204, headers: getCorsHeaders(event.headers || {}), body: '' };
    }
  } catch {
    return null;
  }
  return null;
}

function parseRequest(req) {
  if (req && typeof req === 'object' && !Buffer.isBuffer(req) && !(typeof req.length === 'number' && typeof req.toString === 'function')) {
    const event = req;
    const httpMethod = extractHttpMethod(event);
    const path = extractHttpPath(event);
    const headers = event.headers || {};
    let innerBody = event.body;
    if (innerBody == null) {
      return { payload: event.machineId ? event : {}, path, headers, httpMethod };
    }
    if (typeof innerBody === 'string') {
      if (event.isBase64Encoded) {
        try {
          innerBody = Buffer.from(innerBody, 'base64').toString('utf8');
        } catch {
          return { payload: {}, path, headers: {}, httpMethod };
        }
      }
      try {
        return { payload: innerBody ? JSON.parse(innerBody) : {}, path, headers, httpMethod };
      } catch {
        return { payload: {}, path, headers, httpMethod };
      }
    }
    return { payload: innerBody && typeof innerBody === 'object' ? innerBody : {}, path, headers, httpMethod };
  }

  let eventStr;
  if (Buffer.isBuffer(req) || (req && typeof req.length === 'number' && typeof req.toString === 'function')) {
    eventStr = req.toString('utf8');
  } else if (typeof req === 'string') {
    eventStr = req;
  } else {
    return { payload: {}, path: '/', headers: {}, httpMethod: 'POST' };
  }
  let event = {};
  try {
    event = eventStr ? JSON.parse(eventStr) : {};
  } catch {
    return { payload: {}, path: '/', headers: {}, httpMethod: 'POST' };
  }
  const httpMethod = extractHttpMethod(event);
  const path = extractHttpPath(event);
  const headers = event.headers || {};
  let innerBody = event.body;
  if (innerBody == null) {
    return { payload: event.machineId ? event : {}, path, headers, httpMethod };
  }
  if (typeof innerBody === 'string') {
    if (event.isBase64Encoded) {
      try {
        innerBody = Buffer.from(innerBody, 'base64').toString('utf8');
      } catch {
        return { payload: {}, path, headers: {}, httpMethod };
      }
    }
    try {
      return { payload: innerBody ? JSON.parse(innerBody) : {}, path, headers, httpMethod };
    } catch {
      return { payload: {}, path, headers: {}, httpMethod };
    }
  }
  return { payload: innerBody && typeof innerBody === 'object' ? innerBody : {}, path, headers, httpMethod };
}

function getHeader(reqHeaders, name) {
  const h = reqHeaders || {};
  const lower = name.toLowerCase();
  for (const k of Object.keys(h)) {
    if (k.toLowerCase() === lower) return h[k];
  }
  return undefined;
}

/** 运营接口统一密钥：与 POST /internal/issue-coupon 相同（NX_ADMIN_ISSUE_COUPON_SECRET�?*/
function checkNxAdminIssueCouponSecret(reqHeaders, body) {
  const secret = process.env.NX_ADMIN_ISSUE_COUPON_SECRET?.trim();
  if (!secret) {
    return {
      ok: false,
      status: 503,
      payload: {
        error: 'ADMIN_NOT_CONFIGURED',
        message: '请配�?NX_ADMIN_ISSUE_COUPON_SECRET',
      },
    };
  }
  const h =
    getHeader(reqHeaders, 'x-admin-issue-coupon-secret') ||
    getHeader(reqHeaders, 'X-Admin-Issue-Coupon-Secret') ||
    (body && (body.admin_secret ?? body.adminSecret));
  if (h !== secret) {
    return { ok: false, status: 401, payload: { error: 'UNAUTHORIZED' } };
  }
  return { ok: true };
}

/** 支付宝支付服�?�?FC 入账（NX_ALIPAY_PAY_SECRET，未设时回退 NX_ADMIN_ISSUE_COUPON_SECRET�?*/
function checkAlipayPaySecret(reqHeaders, body) {
  const secret =
    process.env.NX_ALIPAY_PAY_SECRET?.trim() || process.env.NX_ADMIN_ISSUE_COUPON_SECRET?.trim();
  if (!secret) {
    return {
      ok: false,
      status: 503,
      payload: {
        error: 'ALIPAY_PAY_NOT_CONFIGURED',
        message: '请配�?NX_ALIPAY_PAY_SECRET',
      },
    };
  }
  const h =
    getHeader(reqHeaders, 'x-alipay-pay-secret') ||
    getHeader(reqHeaders, 'X-Alipay-Pay-Secret') ||
    (body && (body.pay_secret ?? body.paySecret));
  if (h !== secret) {
    return { ok: false, status: 401, payload: { error: 'UNAUTHORIZED' } };
  }
  return { ok: true };
}

function resolveForwardUrl(provider, path, rhTarget) {
  if (provider === 'runninghub') {
    return buildRunningHubForwardUrl(path, rhTarget || pickRunningHubTarget(path));
  }
  if (provider === 'bltcy') {
    const p = normalizeRhPath(path);
    const base = (process.env.BLTCY_API_BASE || 'https://api.apilio.ai').replace(/\/$/, '');
    return `${base}${p}`;
  }
  throw new Error('UNSUPPORTED_FORWARD_PROVIDER');
}

/** LLM：BLTCY chat completions */
async function handleLlmTask(userId, taskId, innerBody, dbModule) {
  const { getFinalPrice } = await ensurePricing();

  const model = innerBody.model || 'gpt-3.5-turbo';
  const modelId = String(model).trim() || 'gpt-3.5-turbo';
  const messages = Array.isArray(innerBody.messages) ? innerBody.messages : [];
  if (messages.length === 0) throw new Error('messages required');

  const upstream = resolveLlmUpstream(modelId);
  if (!upstream.apiKey) throw new Error(upstream.keyError);

  const provider = upstream.provider;
  const description = innerBody.description || 'chat completion';
  let modelConfigMap = null;
  try {
    modelConfigMap = await loadNxModelConfigMapForBilling(dbModule);
  } catch (e) {
    console.warn('[Billing] listModelConfig (llm) skipped:', e?.message || e);
  }
  const cost = getFinalPrice(modelId, { taskType: 'llm', nodeData: {}, modelConfigMap });
  console.log(`[Billing] User: ${userId} | Model: ${modelId} | Deduct: ${cost} Yuanbao.`);
  console.log(`[LLM] upstream=${provider} url=${upstream.url}`);

  const billingUserLlm = await dbModule.getUserById(userId);
  if (billingUserLlm && typeof dbModule.assertModelCostThreshold === 'function') {
    dbModule.assertModelCostThreshold(billingUserLlm, cost, 'llm');
  }

  const deductResult = await dbModule.deductWithTransaction(userId, taskId, cost, {
    provider,
    description,
  });

  if (deductResult.idempotent) {
    const u = await dbModule.getUserById(userId);
    return {
      data: {
        choices: [{ message: { role: 'assistant', content: '（该任务已处理，未重复扣费）' } }],
        duplicate_task: true,
      },
      balance: u?.balance ?? deductResult.balance,
    };
  }

  let refunded = false;
  let nxRefundSucceeded = false;
  const safeRefund = async (reason) => {
    if (refunded) return;
    refunded = true;
    try {
      await dbModule.refundWithLedger(userId, taskId, cost, { provider, description: reason });
      nxRefundSucceeded = true;
    } catch (re) {
      console.error('[handleLlmTask] refund failed', reason, re?.message || re);
    }
  };

  try {
    await dbModule.upsertTask(taskId, userId, {
      status: 'running',
      cost,
      prompt_json: JSON.stringify({ model, messagesLength: messages.length, provider }),
    });
  } catch (e) {
    console.error('[handleLlmTask] upsertTask PROCESSING failed', e);
    await safeRefund('task_record_failed');
    if (e && typeof e === 'object') e.nxRefundSucceeded = nxRefundSucceeded;
    throw e;
  }

  const chatPayload = buildLlmChatPayload(modelId, innerBody, messages);

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), API_TIMEOUT_MS);

  try {
    const response = await fetch(upstream.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${upstream.apiKey}`,
      },
      body: JSON.stringify(chatPayload),
      signal: controller.signal,
    });

    let data = {};
    try {
      data = await response.json();
    } catch (_) {
      data = {};
    }

    if (!response.ok) {
      await safeRefund('api_error');
      const errMsg = data?.error?.message || data?.message || `HTTP ${response.status}`;
      const e = new Error(errMsg);
      e.response = { status: response.status, data };
      e.nxRefundSucceeded = nxRefundSucceeded;
      throw e;
    }

    await dbModule.upsertTask(taskId, userId, { status: 'success', cost });
    let balanceOut = deductResult.balance;
    try {
      const u = await dbModule.getUserById(userId);
      balanceOut = u?.balance ?? balanceOut;
    } catch (_) {}
    return { data, balance: balanceOut };
  } catch (e) {
    if (!refunded) {
      await safeRefund('exception');
    }
    if (e && typeof e === 'object') e.nxRefundSucceeded = nxRefundSucceeded;
    await dbModule
      .upsertTask(taskId, userId, { status: 'failed', cost, error_msg: e?.message || 'task_failed' })
      .catch(() => {});
    throw e;
  } finally {
    clearTimeout(timeoutId);
  }
}

const FORWARD_TIMEOUT_MS = parseInt(process.env.NX_FORWARD_TIMEOUT_MS || '300000', 10) || 300000;

/** �?RunningHub �?forward 响应中尽量提取可展示的公网结�?URL，写�?nx_tasks.result_oss_url 供轮�?*/
function extractForwardResultUrl(data) {
  if (!data || typeof data !== 'object') return '';
  const tryStr = (v) =>
    typeof v === 'string' && /^https?:\/\//i.test(v.trim()) ? v.trim() : '';
  const inner = data.data;
  let d = data;
  if (inner && typeof inner === 'object' && !Array.isArray(inner)) {
    const looksRh =
      inner.status != null ||
      inner.results != null ||
      inner.taskId != null ||
      inner.task_id != null;
    const codeOk =
      data.code === 0 || data.code === '0' || data.code === 200 || data.code === '200';
    if (looksRh || codeOk) {
      d = { ...data, ...inner };
      if (inner.results != null) d.results = inner.results;
    }
  }
  let u =
    tryStr(d.imageUrl) ||
    tryStr(d.url) ||
    tryStr(d.outputUrl) ||
    tryStr(d.resultUrl) ||
    tryStr(d.videoUrl) ||
    tryStr(d.video_url) ||
    tryStr(d.fileUrl);
  if (u) return u;
  const r1 = d.data;
  if (r1 && typeof r1 === 'object' && !Array.isArray(r1)) {
    u =
      tryStr(r1.url) ||
      tryStr(r1.imageUrl) ||
      tryStr(r1.video_url) ||
      tryStr(r1.videoUrl) ||
      tryStr(r1.fileUrl);
    if (u) return u;
    const r1res = r1.results;
    if (Array.isArray(r1res) && r1res[0] && typeof r1res[0] === 'object') {
      const x = r1res[0];
      u =
        tryStr(x.url) ||
        tryStr(x.imageUrl) ||
        tryStr(x.fileUrl) ||
        tryStr(x.videoUrl) ||
        tryStr(x.video_url);
      if (u) return u;
    }
  }
  const r2 = d.results;
  if (Array.isArray(r2) && r2[0] && typeof r2[0] === 'object') {
    const x = r2[0];
    u =
      tryStr(x.url) ||
      tryStr(x.imageUrl) ||
      tryStr(x.fileUrl) ||
      tryStr(x.videoUrl) ||
      tryStr(x.video_url);
    if (u) return u;
  }
  return '';
}

function readRhQueryStatusFromForwardPayload(data) {
  if (!data || typeof data !== 'object') return '';
  if (typeof data.status === 'string' && data.status.trim()) return String(data.status).toUpperCase();
  const inner = data.data;
  if (inner && typeof inner === 'object' && !Array.isArray(inner) && typeof inner.status === 'string') {
    return String(inner.status).toUpperCase();
  }
  return '';
}

/** �?�?视：转发 RunningHub �?BLTCY（密钥仅在云端） */
async function handleGenericForwardTask(userId, taskId, inner, dbModule, taskType, billing) {
  const fwd = inner.forward;
  if (!fwd || typeof fwd !== 'object') throw new Error('forward object required');
  const provider = String(fwd.provider || '').toLowerCase();
  const path = fwd.path;
  if (!path || typeof path !== 'string') throw new Error('forward.path required');
  const method = String(fwd.method || 'POST').toUpperCase();
  const bodyRaw = fwd.body !== undefined ? fwd.body : {};
  const bodyObj =
    bodyRaw && typeof bodyRaw === 'object' && !Array.isArray(bodyRaw) ? bodyRaw : {};

  /** @type {{ region: 'cn' | 'ai', base: string, apiKey: string } | null} */
  let rhTarget = null;
  let key = '';
  if (provider === 'runninghub') {
    let regionHint = fwd.rhRegion ?? inner.rhRegion ?? null;
    const billingModelIdHint =
      (inner.billingModelId != null && String(inner.billingModelId).trim()) ||
      (fwd.billingModelId != null && String(fwd.billingModelId).trim()) ||
      '';
    if (forceOverseasByBillingOrPath(path, billingModelIdHint)) {
      regionHint = 'ai';
    }
    if (isRhQueryPath(path)) {
      const resolved = await resolveRhRegionForQuery(dbModule, userId, bodyObj, regionHint);
      if (resolved) regionHint = resolved;
    }
    rhTarget = pickRunningHubTarget(path, { regionHint });
    key = rhTarget.apiKey;
    if (!key) throw new Error(rhAuthErrorMessage(rhTarget.region));
    console.log(
      `[RH] forward region=${rhTarget.region} path=${normalizeRhPath(path)} base=${rhTarget.base} hint=${regionHint || '-'}`,
    );
  } else if (provider === 'bltcy') {
    key = process.env.BLTCY_API_KEY?.trim() || '';
    if (!key) throw new Error('BLTCY_API_KEY_NOT_CONFIGURED');
  } else {
    throw new Error('UNSUPPORTED_FORWARD_PROVIDER');
  }

  const fwdTaskType = normalizeForwardTaskType(taskType);

  async function forwardOnce() {
    const url = resolveForwardUrl(provider, path, rhTarget);
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), FORWARD_TIMEOUT_MS);
    try {
      const um = fwd.uploadMultipart;
      const ufu = fwd.uploadFromUrl;
      if (
        ufu &&
        typeof ufu === 'object' &&
        typeof ufu.url === 'string' &&
        ufu.url.trim().length > 0 &&
        provider === 'runninghub' &&
        method === 'POST'
      ) {
        const srcUrl = String(ufu.url).trim();
        const srcRes = await fetch(srcUrl, { signal: controller.signal });
        if (!srcRes.ok) {
          const e = new Error(`UPLOAD_FROM_URL_FETCH_FAILED HTTP ${srcRes.status}`);
          e.response = { status: srcRes.status, data: {} };
          throw e;
        }
        const arr = await srcRes.arrayBuffer();
        const buf = Buffer.from(arr);
        if (!buf.length) {
          const e = new Error('UPLOAD_FROM_URL_EMPTY_BODY');
          e.response = { status: 400, data: {} };
          throw e;
        }
        let filename = String(ufu.filename || 'file.bin');
        const srcCt = String(srcRes.headers.get('content-type') || '')
          .split(';')[0]
          .trim();
        const hintCt = String(ufu.contentType || '').trim();
        // 魔数纠偏：扩展名 .mp3 但实际是 WAV/M4A 时，按真实容器改名，避免 RH LoadAudio 静默失效
        const magic =
          buf.length >= 12 && buf[0] === 0x49 && buf[1] === 0x44 && buf[2] === 0x33
            ? 'mp3'
            : buf.length >= 2 && buf[0] === 0xff && (buf[1] & 0xe0) === 0xe0
              ? 'mp3'
              : buf.length >= 12 &&
                  buf[0] === 0x52 &&
                  buf[1] === 0x49 &&
                  buf[2] === 0x46 &&
                  buf[3] === 0x46 &&
                  buf.toString('ascii', 8, 12) === 'WAVE'
                ? 'wav'
                : buf.length >= 4 && buf.toString('ascii', 0, 4) === 'fLaC'
                  ? 'flac'
                  : buf.length >= 4 && buf[0] === 0x4f && buf[1] === 0x67 && buf[2] === 0x67 && buf[3] === 0x53
                    ? 'ogg'
                    : buf.length >= 12 && buf.toString('ascii', 4, 8) === 'ftyp'
                      ? 'mp4'
                      : '';
        if (magic === 'wav' && !/\.wav$/i.test(filename)) {
          filename = filename.replace(/\.[^.]+$/, '') + '.wav';
        } else if (magic === 'flac' && !/\.flac$/i.test(filename)) {
          filename = filename.replace(/\.[^.]+$/, '') + '.flac';
        } else if (magic === 'ogg' && !/\.ogg$/i.test(filename)) {
          filename = filename.replace(/\.[^.]+$/, '') + '.ogg';
        } else if (magic === 'mp4' && !/\.(m4a|mp4|aac)$/i.test(filename)) {
          filename = filename.replace(/\.[^.]+$/, '') + '.m4a';
        } else if (magic === 'mp3' && !/\.mp3$/i.test(filename)) {
          filename = filename.replace(/\.[^.]+$/, '') + '.mp3';
        }
        const lowerName = filename.toLowerCase();
        let contentType = hintCt || srcCt || 'application/octet-stream';
        if (lowerName.endsWith('.mp3')) contentType = 'audio/mpeg';
        else if (lowerName.endsWith('.wav')) contentType = 'audio/wav';
        else if (lowerName.endsWith('.flac')) contentType = 'audio/flac';
        else if (lowerName.endsWith('.ogg')) contentType = 'audio/ogg';
        else if (lowerName.endsWith('.m4a')) contentType = 'audio/mp4';
        else if (lowerName.endsWith('.jpg') || lowerName.endsWith('.jpeg')) contentType = 'image/jpeg';
        else if (lowerName.endsWith('.png')) contentType = 'image/png';
        else if (lowerName.endsWith('.webp')) contentType = 'image/webp';
        else if (lowerName.endsWith('.mp4')) contentType = 'video/mp4';
        else if (!hintCt && srcCt) contentType = srcCt;
        if (magic) {
          console.log(
            `[RH] uploadFromUrl magic=${magic} filename=${filename} bytes=${buf.length} ct=${contentType}`,
          );
        }
        const fieldName = String(ufu.fieldName || 'file');
        const blob = new Blob([buf], { type: contentType });
        const form = new FormData();
        form.append(fieldName, blob, filename);
        const res = await fetch(url, {
          method: 'POST',
          headers: { Authorization: `Bearer ${key}` },
          body: form,
          signal: controller.signal,
        });
        let data = {};
        try {
          data = await res.json();
        } catch (_) {
          data = {};
        }
        if (!res.ok) {
          const errMsg = data?.message || data?.error?.message || data?.error || `HTTP ${res.status}`;
          const e = new Error(typeof errMsg === 'string' ? errMsg : JSON.stringify(errMsg));
          e.response = { status: res.status, data };
          if (res.status === 401) {
            e.message =
              rhTarget?.region === 'ai'
                ? '海外 RunningHub 鉴权失败（HTTP 401）：请检�?FC 环境变量 RUNNINGHUB_API_KEY_AI'
                : '国内 RunningHub 鉴权失败（HTTP 401）：请检�?FC 环境变量 RUNNINGHUB_API_KEY';
          }
          throw e;
        }
        return data;
      }
      if (
        um &&
        typeof um === 'object' &&
        typeof um.base64 === 'string' &&
        um.base64.length > 0 &&
        provider === 'runninghub' &&
        method === 'POST'
      ) {
        let buf;
        try {
          buf = Buffer.from(String(um.base64), 'base64');
        } catch (_) {
          const e = new Error('INVALID_MULTIPART_BASE64');
          e.response = { status: 400, data: {} };
          throw e;
        }
        const filename = String(um.filename || 'file.bin');
        const contentType = String(um.contentType || 'application/octet-stream');
        const fieldName = String(um.fieldName || 'file');
        const blob = new Blob([buf], { type: contentType });
        const form = new FormData();
        form.append(fieldName, blob, filename);
        const res = await fetch(url, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${key}`,
          },
          body: form,
          signal: controller.signal,
        });
        let data = {};
        try {
          data = await res.json();
        } catch (_) {
          data = {};
        }
        if (!res.ok) {
          const errMsg = data?.message || data?.error?.message || data?.error || `HTTP ${res.status}`;
          const e = new Error(typeof errMsg === 'string' ? errMsg : JSON.stringify(errMsg));
          e.response = { status: res.status, data };
          if (res.status === 401) {
            e.message =
              rhTarget?.region === 'ai'
                ? '海外 RunningHub 鉴权失败（HTTP 401）：请检�?FC 环境变量 RUNNINGHUB_API_KEY_AI'
                : '国内 RunningHub 鉴权失败（HTTP 401）：请检�?FC 环境变量 RUNNINGHUB_API_KEY';
          }
          throw e;
        }
        return data;
      }

      const res = await fetch(url, {
        method,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${key}`,
        },
        body: method === 'GET' || method === 'HEAD' ? undefined : JSON.stringify(bodyObj),
        signal: controller.signal,
      });
      let data = {};
      try {
        data = await res.json();
      } catch (_) {
        data = {};
      }
      if (!res.ok) {
        const errMsg = data?.message || data?.error?.message || data?.error || `HTTP ${res.status}`;
        const e = new Error(typeof errMsg === 'string' ? errMsg : JSON.stringify(errMsg));
        e.response = { status: res.status, data };
        if (res.status === 401 && provider === 'runninghub') {
          e.message =
            rhTarget?.region === 'ai'
              ? '海外 RunningHub 鉴权失败（HTTP 401）：请检�?FC 环境变量 RUNNINGHUB_API_KEY_AI'
              : '国内 RunningHub 鉴权失败（HTTP 401）：请检�?FC 环境变量 RUNNINGHUB_API_KEY';
        }
        throw e;
      }
      if (provider === 'runninghub' && rhTarget && !isRhQueryPath(path)) {
        const rhTid = extractRhTaskIdFromForwardData(data);
        if (rhTid) {
          await persistRhTaskRegion(dbModule, userId, rhTid, rhTarget.region);
        }
      }
      return data;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  if (billing === 'none') {
    const pathNorm = String(path || '').replace(/\?.*$/, '');
    const isRhQueryOnly =
      provider === 'runninghub' &&
      (pathNorm === '/query' || pathNorm.endsWith('/query'));

    /** 仅当 OTS 已有�?task_id（如 /tasks/create 预建单）时同步状态；轮询 /query 用的临时 id 不写�?*/
    let existingRow = null;
    try {
      const getFn = dbModule.getTaskRowForUser;
      existingRow = typeof getFn === 'function' ? await getFn(taskId, userId) : null;
    } catch (_) {}

    if (isRhQueryOnly && !existingRow) {
      const data = await forwardOnce();
      let balanceOut = 0;
      try {
        const u = await dbModule.getUserById(userId);
        balanceOut = u?.balance ?? 0;
      } catch (_) {}
      return { data, balance: balanceOut };
    }

    let data = {};
    if (existingRow) {
      try {
        await dbModule.upsertTask(taskId, userId, { status: 'running' });
      } catch (e) {
        console.warn('[forward] upsertTask RUNNING (billing=none) skipped', e?.message || e);
      }
    }
    try {
      data = await forwardOnce();
    } catch (e) {
      if (existingRow) {
        try {
          await dbModule.upsertTask(taskId, userId, {
            status: 'failed',
            error_msg: e?.message || 'forward_failed',
          });
        } catch (_) {}
      }
      throw e;
    }
    const resultUrl = extractForwardResultUrl(data);
    if (existingRow) {
      try {
        const hasRhSubmitTask =
          data &&
          typeof data === 'object' &&
          Boolean(
            data.taskId ||
              data.task_id ||
              (data.data &&
                typeof data.data === 'object' &&
                (data.data.taskId || data.data.task_id)),
          );
        const qSt = readRhQueryStatusFromForwardPayload(data);
        const querySuccessWithUrl = qSt === 'SUCCESS' && resultUrl;
        if (resultUrl || querySuccessWithUrl) {
          await dbModule.upsertTask(taskId, userId, {
            status: 'success',
            ...(resultUrl ? { result_oss_url: resultUrl } : {}),
          });
        } else if (hasRhSubmitTask) {
          await dbModule.upsertTask(taskId, userId, { status: 'running' });
        } else {
          await dbModule.upsertTask(taskId, userId, {
            status: 'success',
            ...(resultUrl ? { result_oss_url: resultUrl } : {}),
          });
        }
      } catch (err) {
        console.warn('[forward] upsertTask after forward (billing=none) skipped', err?.message || err);
      }
    }
    let balanceOut = 0;
    try {
      const u = await dbModule.getUserById(userId);
      balanceOut = u?.balance ?? 0;
    } catch (_) {}
    return { data, balance: balanceOut };
  }

  const { getFinalPrice, isModelNotPricedError, resolveImageBillingModelId } = await ensurePricing();

  const rawModelId =
    (inner.billingModelId != null && String(inner.billingModelId).trim()) ||
    extractModelIdFromForward(path, bodyObj);
  const modelId = rawModelId ? resolveImageBillingModelId(rawModelId) : '';
  console.log('[Billing-Debug] Final ID:', modelId, 'From Raw:', rawModelId);
  if (!modelId) {
    const err = new Error('该模型暂未上线或定价错误');
    err.nxStatusCode = 403;
    err.nxErrorCode = 'MODEL_NOT_PRICED';
    throw err;
  }

  let modelConfigMap = null;
  try {
    modelConfigMap = await loadNxModelConfigMapForBilling(dbModule);
  } catch (e) {
    console.warn('[Billing] listModelConfig (forward) skipped:', e?.message || e);
  }

  let cost;
  try {
    const billingNodeData =
      bodyObj && typeof bodyObj === 'object' && !Array.isArray(bodyObj) ? { ...bodyObj } : {};
    if (fwdTaskType === 'video') {
      const midNorm = String(modelId || '')
        .trim()
        .toLowerCase();
      if (midNorm === 'hey-gem-plus' && !billingNodeData.model) {
        billingNodeData.model = 'hey-gem';
      }
    }
    cost = getFinalPrice(modelId, { taskType: fwdTaskType, nodeData: billingNodeData, modelConfigMap });
  } catch (e) {
    if (isModelNotPricedError(e)) {
      const err = new Error('该模型暂未上线或定价错误');
      err.nxStatusCode = 403;
      err.nxErrorCode = 'MODEL_NOT_PRICED';
      throw err;
    }
    throw e;
  }

  console.log(`[Billing] User: ${userId} | Model: ${modelId} | Deduct: ${cost} Yuanbao.`);

  const billingUserFwd = await dbModule.getUserById(userId);
  if (billingUserFwd && typeof dbModule.assertModelCostThreshold === 'function') {
    dbModule.assertModelCostThreshold(billingUserFwd, cost, fwdTaskType);
  }

  const deductResult = await dbModule.deductWithTransaction(userId, taskId, cost, {
    provider: 'forward',
    /** 仅记计费模型 id，便于账单展示；不含 runninghub 前缀�?API 路径 */
    description: modelId,
  });

  if (deductResult.idempotent) {
    const u = await dbModule.getUserById(userId);
    return {
      data: { duplicate_task: true, message: '（该任务已处理，未重复扣费）' },
      balance: u?.balance ?? deductResult.balance,
    };
  }

  let refunded = false;
  const safeRefund = async (reason) => {
    if (refunded) return;
    refunded = true;
    try {
      await dbModule.refundWithLedger(userId, taskId, cost, { provider: 'forward', description: reason });
    } catch (re) {
      console.error('[handleGenericForwardTask] refund failed', reason, re?.message || re);
    }
  };

  try {
    await dbModule.upsertTask(taskId, userId, {
      status: 'running',
      cost,
      prompt_json: JSON.stringify({ forward: path, taskType }),
    });
  } catch (e) {
    console.error('[handleGenericForwardTask] upsertTask PROCESSING failed', e);
    await safeRefund('task_record_failed');
    throw e;
  }

  try {
    const data = await forwardOnce();
    await dbModule.upsertTask(taskId, userId, { status: 'success', cost });
    let balanceOut = deductResult.balance;
    try {
      const u = await dbModule.getUserById(userId);
      balanceOut = u?.balance ?? balanceOut;
    } catch (_) {}
    return { data, balance: balanceOut };
  } catch (e) {
    if (!refunded) await safeRefund(e?.response?.status ? 'api_error' : 'exception');
    await dbModule
      .upsertTask(taskId, userId, { status: 'failed', cost, error_msg: e?.message || 'task_failed' })
      .catch(() => {});
    throw e;
  }
}

/**
 * 合并 run-task 负载：根级字段（�?forward）必须覆�?body/payload，否则会出现
 * body �?{ messages: [] } �?inner 只取�?body、忽略根�?forward，误�?LLM 分支�?messages required�? */
function mergeRunTaskInner(rawBody) {
  if (!rawBody || typeof rawBody !== 'object') return {};
  const fromPayload = rawBody.payload && typeof rawBody.payload === 'object' ? rawBody.payload : {};
  const fromBody = rawBody.body && typeof rawBody.body === 'object' ? rawBody.body : {};
  return { ...fromPayload, ...fromBody, ...rawBody };
}

async function handleRunTask(userId, taskId, rawBody, dbModule) {
  const inner = mergeRunTaskInner(rawBody);
  const taskType = String(rawBody.type || inner.type || 'llm').toLowerCase();
  const billingRaw = String(inner.billing ?? rawBody.billing ?? 'charge').toLowerCase();

  /** 异步任务已成功扣费但下游失败：客户端用同一 taskId 请求退回（幂等�?*/
  if (billingRaw === 'refund') {
    const fn = dbModule.refundConsumedTask;
    if (typeof fn !== 'function') {
      throw new Error('REFUND_NOT_SUPPORTED');
    }
    const r = await fn(userId, taskId, {
      provider: 'forward',
      description: String(inner.refundReason || rawBody.refundReason || 'async_task_failed'),
    });
    const u = await dbModule.getUserById(userId);
    return {
      data: {
        refunded: r.refunded === true,
        idempotent: r.idempotent === true,
        reason: r.reason,
      },
      balance: u?.balance ?? r.balance ?? 0,
    };
  }

  const billing = billingRaw === 'none' ? 'none' : 'charge';

  if (inner && typeof inner.forward === 'object' && inner.forward) {
    const fwdType = String(rawBody.type || inner.type || 'image').toLowerCase();
    return handleGenericForwardTask(userId, taskId, inner, dbModule, fwdType, billing);
  }

  const llmInner = inner.messages != null ? inner : mergeRunTaskInner(rawBody);
  if (Array.isArray(llmInner.messages)) {
    return handleLlmTask(userId, taskId, llmInner, dbModule);
  }

  throw new Error('INVALID_TASK_PAYLOAD: need messages (llm) or forward');
}

/**
 * POST /tasks/create：按 nx_model_config �?model_id 计价并扣元宝，写�?nx_tasks（pending），返回 task_id�? * Body: model_id（必填）, params（对象或 JSON 字符串，写入 prompt_json�? type|task_type（llm|image|video|audio，默�?image�?
 *       nodeData|node_data（可选，�?run-task 计费维度一致）, workflow_json（可选）
 */
async function handleTasksCreate(userId, body, dbModule) {
  const { handleTasksCreate: createTask } = await import('./lib/handleTasksCreate.mjs');
  const { getFinalPrice } = await ensurePricing();
  return createTask(userId, body, dbModule, {
    getFinalPrice,
    loadNxModelConfigMapForBilling,
  });
}

async function handleRequest(req) {
  /** 解析后用�?CORS 回显 Origin；解析失败或未解析时为空对象 */
  let reqHeadersForCors = {};
  let headers = { ...getCorsHeaders(), 'Content-Type': 'application/json' };
  /** 供最外层 catch �?/api/admin/* �?CORS */
  let isAdminApiPath = false;

  try {
    const preflightFirst = tryOptionsPreflightFirst(req);
    if (preflightFirst) return preflightFirst;

    /** 少数运行时直接传入事件对象（�?JSON 字符串）；FC 3.0 可能仅有 requestContext.http */
    if (req && typeof req === 'object' && !Buffer.isBuffer(req)) {
      const m = extractHttpMethod(req);
      if (m === 'OPTIONS') {
        return { statusCode: 204, headers: getCorsHeaders(req.headers || {}), body: '' };
      }
    }

    const { payload: body, path, headers: reqHeaders, httpMethod } = parseRequest(req);
    reqHeadersForCors = reqHeaders && typeof reqHeaders === 'object' ? reqHeaders : {};
    headers = { ...getCorsHeaders(reqHeadersForCors), 'Content-Type': 'application/json' };
    const pathNorm = (path || '/').split('?')[0].replace(/\/$/, '') || '/';

    if (httpMethod === 'OPTIONS') {
      return { statusCode: 204, headers: getCorsHeaders(reqHeadersForCors), body: '' };
    }

    isAdminApiPath = pathNorm.includes('/api/admin/');

    /**
     * Aixflow 官网管理�?/api/admin/* �?lib/aixflow-admin-oss.mjs �?handleAixflowAdminRequest
     * POST /api/admin/scan-oss-stock �?handleAdminScanOssStock（与其它 admin 路由同文件挂载）
     * 含：upload-file、update-json、delete-item、update-title、get-showcase、scan-oss-stock �?     * OPTIONS 已在上方统一 204；POST 才校�?x-admin-password（ADMIN_PASS�?     */
    if (isAdminApiPath && httpMethod === 'POST') {
      const { handleAixflowAdminRequest } = await import(new URL('./lib/aixflow-admin-oss.mjs', import.meta.url));
      const adminRes = await handleAixflowAdminRequest({
        pathNorm,
        httpMethod,
        reqHeaders,
        body,
      });
      if (adminRes) return adminRes;
      return {
        statusCode: 404,
        headers: adminCorsJsonHeaders(reqHeadersForCors),
        body: JSON.stringify({ error: 'NOT_FOUND' }),
      };
    }
    if (isAdminApiPath) {
      return {
        statusCode: 405,
        headers: adminCorsJsonHeaders(reqHeadersForCors),
        body: JSON.stringify({ error: 'METHOD_NOT_ALLOWED' }),
      };
    }

    const dbModule = await ensureDb();
    console.log('--- AIXFLOW SaaS ---');
    console.log('OTS_ENDPOINT:', process.env.OTS_ENDPOINT);
    if (typeof dbModule.getOtsConfigSummary === 'function') {
      console.log('OTS config:', JSON.stringify(dbModule.getOtsConfigSummary()));
    }

    const tokenReq = { headers: reqHeaders };
    if (!checkLegacyToken(tokenReq)) {
      return { statusCode: 401, headers, body: JSON.stringify({ error: 'Unauthorized' }) };
    }

    const auth = getHeader(reqHeaders, 'authorization') || getHeader(reqHeaders, 'Authorization');

    // POST /internal/settle-stale-tasks �?Cron：超�?RUNNING/PROCESSING 等任务退款并标记 TIMEOUT（需 ADMIN_SETTLE_SECRET�?    if (pathNorm.endsWith('/internal/settle-stale-tasks') || pathNorm === '/internal/settle-stale-tasks') {
      const secret = process.env.ADMIN_SETTLE_SECRET?.trim();
      if (!secret) {
        return {
          statusCode: 503,
          headers,
          body: JSON.stringify({ error: 'SETTLEMENT_NOT_CONFIGURED', message: '请配�?ADMIN_SETTLE_SECRET' }),
        };
      }
      const h =
        getHeader(reqHeaders, 'x-admin-settle-secret') ||
        getHeader(reqHeaders, 'X-Admin-Settle-Secret') ||
        (body && (body.admin_secret || body.adminSecret));
      if (h !== secret) {
        return { statusCode: 401, headers, body: JSON.stringify({ error: 'UNAUTHORIZED' }) };
      }
      try {
        const runFn = dbModule.runStaleTaskSettlement;
        if (typeof runFn !== 'function') {
          return { statusCode: 501, headers, body: JSON.stringify({ error: 'NOT_IMPLEMENTED' }) };
        }
        const maxAgeMs = parseInt(
          body.max_age_ms ?? body.maxAgeMs ?? process.env.NX_STALE_TASK_MAX_AGE_MS ?? '3600000',
          10,
        );
        const maxTasks = Math.min(500, Math.max(1, parseInt(body.max_tasks ?? body.maxTasks ?? '50', 10)));
        const maxScanRows = Math.min(
          500000,
          Math.max(1000, parseInt(body.max_scan_rows ?? body.maxScanRows ?? '20000', 10)),
        );
        const r = await runFn({
          maxAgeMs: Number.isFinite(maxAgeMs) ? maxAgeMs : 3600000,
          maxTasks,
          maxScanRows,
        });
        return { statusCode: 200, headers, body: JSON.stringify(r) };
      } catch (e) {
        console.error('[settle-stale-tasks]', e?.stack ?? e);
        return {
          statusCode: 500,
          headers,
          body: JSON.stringify({ error: e?.message || 'SETTLE_FAILED' }),
        };
      }
    }

    // POST /internal/promote-queued-tasks — Phase 5：lease recovery + queued→claimed
    if (
      pathNorm.endsWith('/internal/promote-queued-tasks') ||
      pathNorm === '/internal/promote-queued-tasks'
    ) {
      const secret = process.env.ADMIN_SETTLE_SECRET?.trim();
      if (!secret) {
        return {
          statusCode: 503,
          headers,
          body: JSON.stringify({
            error: 'PROMOTE_NOT_CONFIGURED',
            message: '请配置 ADMIN_SETTLE_SECRET',
          }),
        };
      }
      const h =
        getHeader(reqHeaders, 'x-admin-settle-secret') ||
        getHeader(reqHeaders, 'X-Admin-Settle-Secret') ||
        (body && (body.admin_secret || body.adminSecret));
      if (h !== secret) {
        return { statusCode: 401, headers, body: JSON.stringify({ error: 'UNAUTHORIZED' }) };
      }
      try {
        const runFn = dbModule.runPromoteQueuedTasks;
        if (typeof runFn !== 'function') {
          return { statusCode: 501, headers, body: JSON.stringify({ error: 'NOT_IMPLEMENTED' }) };
        }
        const maxClaims = Math.min(
          200,
          Math.max(0, parseInt(body.max_claims ?? body.maxClaims ?? process.env.NX_PROMOTE_BATCH_SIZE ?? '20', 10) || 20),
        );
        const maxScanRows = Math.min(
          500000,
          Math.max(1000, parseInt(body.max_scan_rows ?? body.maxScanRows ?? '20000', 10)),
        );
        const reconcile =
          body.reconcile === true ||
          body.reconcile === '1' ||
          String(body.reconcile || '').toLowerCase() === 'true';
        const r = await runFn({
          maxClaims,
          maxScanRows,
          maxLeaseRecover: Math.min(200, Math.max(1, parseInt(body.max_lease_recover ?? body.maxLeaseRecover ?? '50', 10) || 50)),
          maxOrphans: Math.min(200, Math.max(1, parseInt(body.max_orphans ?? body.maxOrphans ?? '50', 10) || 50)),
          reconcile,
          taskType: body.task_type || body.taskType || null,
        });
        return { statusCode: 200, headers, body: JSON.stringify(r) };
      } catch (e) {
        console.error('[promote-queued-tasks]', e?.stack ?? e);
        return {
          statusCode: 500,
          headers,
          body: JSON.stringify({ error: e?.message || 'PROMOTE_FAILED' }),
        };
      }
    }

    // POST /internal/reconcile-queue-reservations — Phase 5 orphan reconcile
    if (
      pathNorm.endsWith('/internal/reconcile-queue-reservations') ||
      pathNorm === '/internal/reconcile-queue-reservations'
    ) {
      const secret = process.env.ADMIN_SETTLE_SECRET?.trim();
      if (!secret) {
        return {
          statusCode: 503,
          headers,
          body: JSON.stringify({
            error: 'RECONCILE_NOT_CONFIGURED',
            message: '请配置 ADMIN_SETTLE_SECRET',
          }),
        };
      }
      const h =
        getHeader(reqHeaders, 'x-admin-settle-secret') ||
        getHeader(reqHeaders, 'X-Admin-Settle-Secret') ||
        (body && (body.admin_secret || body.adminSecret));
      if (h !== secret) {
        return { statusCode: 401, headers, body: JSON.stringify({ error: 'UNAUTHORIZED' }) };
      }
      try {
        const runFn = dbModule.runPromoteQueuedTasks;
        if (typeof runFn !== 'function') {
          return { statusCode: 501, headers, body: JSON.stringify({ error: 'NOT_IMPLEMENTED' }) };
        }
        const keys = body.reconcile_counter_keys || body.reconcileCounterKeys || [];
        const r = await runFn({
          maxClaims: 0,
          reconcile: true,
          maxLeaseRecover: Math.min(200, Math.max(0, parseInt(body.max_lease_recover ?? body.maxLeaseRecover ?? '50', 10) || 50)),
          maxOrphans: Math.min(200, Math.max(1, parseInt(body.max_orphans ?? body.maxOrphans ?? '50', 10) || 50)),
          maxScanRows: Math.min(
            500000,
            Math.max(1000, parseInt(body.max_scan_rows ?? body.maxScanRows ?? '20000', 10)),
          ),
          reconcileCounterKeys: Array.isArray(keys) ? keys : [],
        });
        return { statusCode: 200, headers, body: JSON.stringify(r) };
      } catch (e) {
        console.error('[reconcile-queue-reservations]', e?.stack ?? e);
        return {
          statusCode: 500,
          headers,
          body: JSON.stringify({ error: e?.message || 'RECONCILE_FAILED' }),
        };
      }
    }

    // POST /internal/issue-coupon �?后台签发兑换码（需 NX_ADMIN_ISSUE_COUPON_SECRET，不写用�?JWT�?    if (pathNorm.endsWith('/internal/issue-coupon') || pathNorm === '/internal/issue-coupon') {
      const secret = process.env.NX_ADMIN_ISSUE_COUPON_SECRET?.trim();
      if (!secret) {
        return {
          statusCode: 503,
          headers,
          body: JSON.stringify({
            error: 'ISSUE_COUPON_NOT_CONFIGURED',
            message: '请配�?NX_ADMIN_ISSUE_COUPON_SECRET',
          }),
        };
      }
      const h =
        getHeader(reqHeaders, 'x-admin-issue-coupon-secret') ||
        getHeader(reqHeaders, 'X-Admin-Issue-Coupon-Secret') ||
        (body && (body.admin_secret ?? body.adminSecret));
      if (h !== secret) {
        return { statusCode: 401, headers, body: JSON.stringify({ error: 'UNAUTHORIZED' }) };
      }
      const tier = parseInt(body.amount_cny ?? body.amountCny ?? '', 10);
      const issueFn = dbModule.issueCouponCode;
      if (typeof issueFn !== 'function') {
        return { statusCode: 501, headers, body: JSON.stringify({ error: 'NOT_IMPLEMENTED' }) };
      }
      try {
        const r = await issueFn(tier);
        return { statusCode: 200, headers, body: JSON.stringify(r) };
      } catch (e) {
        const msg = e?.message || 'ISSUE_FAILED';
        if (msg === 'INVALID_COUPON_TIER') {
          return {
            statusCode: 400,
            headers,
            body: JSON.stringify({
              error: 'INVALID_COUPON_TIER',
              message: '档位须为 30/50/100/200/500（元�?,
            }),
          };
        }
        console.error('[issue-coupon]', e?.stack ?? e);
        return {
          statusCode: 500,
          headers,
          body: JSON.stringify({ error: msg }),
        };
      }
    }

    // POST /internal/alipay-create-order �?支付服务创建 pending 订单（需 NX_ALIPAY_PAY_SECRET + x-nexflow-token�?    if (pathNorm.endsWith('/internal/alipay-create-order') || pathNorm === '/internal/alipay-create-order') {
      const gate = checkAlipayPaySecret(reqHeaders, body);
      if (!gate.ok) {
        return { statusCode: gate.status, headers, body: JSON.stringify(gate.payload) };
      }
      const userId = String(body.user_id ?? body.userId ?? '').trim();
      const packageId = String(body.package_id ?? body.packageId ?? '').trim();
      const outTradeNo = String(body.out_trade_no ?? body.outTradeNo ?? '').trim();
      const amountRaw = body.amount_cny ?? body.amountCny;
      const amountCny = typeof amountRaw === 'string' ? parseFloat(amountRaw) : Number(amountRaw);
      const packageYuanbaoRaw = body.package_yuanbao ?? body.packageYuanbao;
      const packageYuanbao = Number(packageYuanbaoRaw);
      if (!userId || !packageId || !outTradeNo || !Number.isFinite(amountCny)) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ error: 'ORDER_FIELDS_REQUIRED' }),
        };
      }
      try {
        const fn = dbModule.createAlipayOrderRecord;
        if (typeof fn !== 'function') {
          return { statusCode: 501, headers, body: JSON.stringify({ error: 'NOT_IMPLEMENTED' }) };
        }
        const r = await fn({
          userId,
          packageId,
          outTradeNo,
          amountCny,
          packageYuanbao: Number.isFinite(packageYuanbao) ? packageYuanbao : 0,
        });
        console.log('[alipay-create-order] created', outTradeNo, 'user', userId);
        return { statusCode: 200, headers, body: JSON.stringify(r) };
      } catch (e) {
        const msg = e?.message || 'CREATE_ORDER_FAILED';
        if (msg === 'USER_NOT_FOUND') {
          return { statusCode: 404, headers, body: JSON.stringify({ error: 'USER_NOT_FOUND' }) };
        }
        if (msg === 'USER_FROZEN') {
          return { statusCode: 403, headers, body: JSON.stringify({ error: 'USER_FROZEN' }) };
        }
        if (msg === 'INVALID_RECHARGE_TIER') {
          return { statusCode: 400, headers, body: JSON.stringify({ error: 'INVALID_RECHARGE_TIER' }) };
        }
        console.error('[alipay-create-order]', e?.stack ?? e);
        return { statusCode: 500, headers, body: JSON.stringify({ error: msg }) };
      }
    }

    // POST /internal/alipay-notify-settle �?支付�?notify 验签后入账（需 NX_ALIPAY_PAY_SECRET�?    if (pathNorm.endsWith('/internal/alipay-notify-settle') || pathNorm === '/internal/alipay-notify-settle') {
      const gate = checkAlipayPaySecret(reqHeaders, body);
      if (!gate.ok) {
        return { statusCode: gate.status, headers, body: JSON.stringify(gate.payload) };
      }
      const outTradeNo = String(body.out_trade_no ?? body.outTradeNo ?? '').trim();
      const tradeNo = String(body.trade_no ?? body.tradeNo ?? '').trim();
      const amountRaw = body.total_amount ?? body.amount_cny ?? body.amountCny;
      const amountCny = typeof amountRaw === 'string' ? parseFloat(amountRaw) : Number(amountRaw);
      if (!outTradeNo) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: 'OUT_TRADE_NO_REQUIRED' }) };
      }
      try {
        const fn = dbModule.settleAlipayOrder;
        if (typeof fn !== 'function') {
          return { statusCode: 501, headers, body: JSON.stringify({ error: 'NOT_IMPLEMENTED' }) };
        }
        console.log('[alipay-notify-settle] start', outTradeNo, 'trade_no', tradeNo);
        const r = await fn(outTradeNo, tradeNo, amountCny);
        console.log('[alipay-notify-settle] enqueued', outTradeNo, r.settlement_status || r.status);
        return { statusCode: 200, headers, body: JSON.stringify(r) };
      } catch (e) {
        const msg = e?.message || 'SETTLE_FAILED';
        if (msg === 'ORDER_NOT_FOUND') {
          console.warn('[alipay-notify-settle] order not found', outTradeNo);
          return { statusCode: 404, headers, body: JSON.stringify({ error: 'ORDER_NOT_FOUND' }) };
        }
        if (msg === 'ORDER_AMOUNT_MISMATCH') {
          return { statusCode: 400, headers, body: JSON.stringify({ error: 'ORDER_AMOUNT_MISMATCH' }) };
        }
        if (msg === 'ORDER_INVALID_STATUS') {
          return { statusCode: 409, headers, body: JSON.stringify({ error: 'ORDER_INVALID_STATUS' }) };
        }
        console.error('[alipay-notify-settle] fc recharge fail', outTradeNo, e?.stack ?? e);
        return { statusCode: 500, headers, body: JSON.stringify({ error: msg }) };
      }
    }

    // POST /internal/alipay-order-status �?查询订单状态（支付服务/客户端轮询）
    if (pathNorm.endsWith('/internal/alipay-order-status') || pathNorm === '/internal/alipay-order-status') {
      const gate = checkAlipayPaySecret(reqHeaders, body);
      if (!gate.ok) {
        return { statusCode: gate.status, headers, body: JSON.stringify(gate.payload) };
      }
      const outTradeNo = String(body.out_trade_no ?? body.outTradeNo ?? '').trim();
      if (!outTradeNo) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: 'OUT_TRADE_NO_REQUIRED' }) };
      }
      try {
        const order = await dbModule.getAlipayOrder(outTradeNo);
        if (!order) {
          return { statusCode: 404, headers, body: JSON.stringify({ error: 'ORDER_NOT_FOUND' }) };
        }
        let balance = null;
        let settlement_status = null;
        if (typeof dbModule.getPendingSettlement === 'function') {
          const pending = await dbModule.getPendingSettlement(outTradeNo);
          settlement_status = pending?.status ?? null;
        }
        if (order.status === 'paid' && order.user_id) {
          const u = await dbModule.getUserById(order.user_id);
          balance = u?.balance ?? null;
        }
        return {
          statusCode: 200,
          headers,
          body: JSON.stringify({
            ...order,
            settlement_status,
            balance,
            is_settled: order.status === 'paid',
          }),
        };
      } catch (e) {
        return { statusCode: 500, headers, body: JSON.stringify({ error: e?.message || 'ORDER_STATUS_FAILED' }) };
      }
    }

    // POST /internal/alipay-retry-process �?补偿队列（Cron / 支付服务 30s�?    if (pathNorm.endsWith('/internal/alipay-retry-process') || pathNorm === '/internal/alipay-retry-process') {
      const gate = checkAlipayPaySecret(reqHeaders, body);
      if (!gate.ok) {
        return { statusCode: gate.status, headers, body: JSON.stringify(gate.payload) };
      }
      try {
        const fn = dbModule.processPendingSettlementQueue || dbModule.processRechargeRetryQueue;
        if (typeof fn !== 'function') {
          return { statusCode: 501, headers, body: JSON.stringify({ error: 'NOT_IMPLEMENTED' }) };
        }
        const maxItems = Math.min(50, Math.max(1, parseInt(body.max_items ?? body.maxItems ?? '20', 10)));
        const r = await fn({ maxItems });
        return { statusCode: 200, headers, body: JSON.stringify(r) };
      } catch (e) {
        return { statusCode: 500, headers, body: JSON.stringify({ error: e?.message || 'RETRY_PROCESS_FAILED' }) };
      }
    }

    // POST /internal/alipay-execute-pending �?单条 queued 预入账立即执行（可选）
    if (pathNorm.endsWith('/internal/alipay-execute-pending') || pathNorm === '/internal/alipay-execute-pending') {
      const gate = checkAlipayPaySecret(reqHeaders, body);
      if (!gate.ok) {
        return { statusCode: gate.status, headers, body: JSON.stringify(gate.payload) };
      }
      const outTradeNo = String(body.out_trade_no ?? body.outTradeNo ?? '').trim();
      if (!outTradeNo) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: 'OUT_TRADE_NO_REQUIRED' }) };
      }
      try {
        const fn = dbModule.executePendingSettlement;
        if (typeof fn !== 'function') {
          return { statusCode: 501, headers, body: JSON.stringify({ error: 'NOT_IMPLEMENTED' }) };
        }
        const r = await fn(outTradeNo);
        return { statusCode: 200, headers, body: JSON.stringify(r) };
      } catch (e) {
        return { statusCode: 500, headers, body: JSON.stringify({ error: e?.message || 'EXECUTE_FAILED' }) };
      }
    }

    // POST /internal/check-balance-consistency �?资金一致性巡检
    if (
      pathNorm.endsWith('/internal/check-balance-consistency') ||
      pathNorm === '/internal/check-balance-consistency' ||
      pathNorm.endsWith('/cron/check-balance-consistency')
    ) {
      const gate = checkAlipayPaySecret(reqHeaders, body);
      if (!gate.ok) {
        return { statusCode: gate.status, headers, body: JSON.stringify(gate.payload) };
      }
      try {
        const fn = dbModule.runBalanceConsistencyCheck;
        if (typeof fn !== 'function') {
          return { statusCode: 501, headers, body: JSON.stringify({ error: 'NOT_IMPLEMENTED' }) };
        }
        const maxScan = parseInt(body.max_scan ?? body.maxScan ?? '200', 10);
        const r = await fn({ maxScan: Number.isFinite(maxScan) ? maxScan : 200 });
        return { statusCode: 200, headers, body: JSON.stringify(r) };
      } catch (e) {
        return { statusCode: 500, headers, body: JSON.stringify({ error: e?.message || 'CONSISTENCY_CHECK_FAILED' }) };
      }
    }

    // POST /internal/admin-dashboard-stats �?今日营收、兑换码总数、失败任务数（需 NX_ADMIN_ISSUE_COUPON_SECRET�?    if (pathNorm.endsWith('/internal/admin-dashboard-stats') || pathNorm === '/internal/admin-dashboard-stats') {
      const gate = checkNxAdminIssueCouponSecret(reqHeaders, body);
      if (!gate.ok) {
        return { statusCode: gate.status, headers, body: JSON.stringify(gate.payload) };
      }
      try {
        const fn = dbModule.adminAggregateDashboardStats;
        if (typeof fn !== 'function') {
          return { statusCode: 501, headers, body: JSON.stringify({ error: 'NOT_IMPLEMENTED' }) };
        }
        const maxTx = parseInt(body.max_tx_scan_rows ?? body.maxTxScanRows ?? '80000', 10);
        const maxTask = parseInt(body.max_task_scan_rows ?? body.maxTaskScanRows ?? '40000', 10);
        const r = await fn({
          maxTxScanRows: Number.isFinite(maxTx) ? maxTx : 80000,
          maxTaskScanRows: Number.isFinite(maxTask) ? maxTask : 40000,
        });
        return { statusCode: 200, headers, body: JSON.stringify(r) };
      } catch (e) {
        console.error('[admin-dashboard-stats]', e?.stack ?? e);
        return { statusCode: 500, headers, body: JSON.stringify({ error: e?.message || 'ADMIN_STATS_FAILED' }) };
      }
    }

    // POST /internal/admin-failed-tasks �?失败/超时任务列表
    if (pathNorm.endsWith('/internal/admin-failed-tasks') || pathNorm === '/internal/admin-failed-tasks') {
      const gate = checkNxAdminIssueCouponSecret(reqHeaders, body);
      if (!gate.ok) {
        return { statusCode: gate.status, headers, body: JSON.stringify(gate.payload) };
      }
      try {
        const fn = dbModule.listFailedOrTimeoutTasksForAdmin;
        if (typeof fn !== 'function') {
          return { statusCode: 501, headers, body: JSON.stringify({ error: 'NOT_IMPLEMENTED' }) };
        }
        const maxScan = parseInt(body.max_scan_rows ?? body.maxScanRows ?? '50000', 10);
        const maxItems = parseInt(body.max_items ?? body.maxItems ?? '500', 10);
        const r = await fn({
          maxScanRows: Number.isFinite(maxScan) ? maxScan : 50000,
          maxItems: Math.min(2000, Math.max(1, Number.isFinite(maxItems) ? maxItems : 500)),
        });
        return { statusCode: 200, headers, body: JSON.stringify(r) };
      } catch (e) {
        console.error('[admin-failed-tasks]', e?.stack ?? e);
        return { statusCode: 500, headers, body: JSON.stringify({ error: e?.message || 'ADMIN_LIST_FAILED' }) };
      }
    }

    // POST /internal/admin-refund-task �?一键退款（refundConsumedTask�?    if (pathNorm.endsWith('/internal/admin-refund-task') || pathNorm === '/internal/admin-refund-task') {
      const gate = checkNxAdminIssueCouponSecret(reqHeaders, body);
      if (!gate.ok) {
        return { statusCode: gate.status, headers, body: JSON.stringify(gate.payload) };
      }
      const uid = String(body.user_id ?? body.userId ?? '').trim();
      const tid = String(body.task_id ?? body.taskId ?? '').trim();
      try {
        const fn = dbModule.adminRefundTaskByIds;
        if (typeof fn !== 'function') {
          return { statusCode: 501, headers, body: JSON.stringify({ error: 'NOT_IMPLEMENTED' }) };
        }
        const r = await fn(uid, tid);
        return { statusCode: 200, headers, body: JSON.stringify(r) };
      } catch (e) {
        console.error('[admin-refund-task]', e?.stack ?? e);
        return { statusCode: 500, headers, body: JSON.stringify({ error: e?.message || 'ADMIN_REFUND_FAILED' }) };
      }
    }

    // POST /internal/admin-model-config-list �?全表模型定价（与 /model-config 同源数据，管理密钥）
    if (pathNorm.endsWith('/internal/admin-model-config-list') || pathNorm === '/internal/admin-model-config-list') {
      const gate = checkNxAdminIssueCouponSecret(reqHeaders, body);
      if (!gate.ok) {
        return { statusCode: gate.status, headers, body: JSON.stringify(gate.payload) };
      }
      try {
        const fn = dbModule.listModelConfig;
        if (typeof fn !== 'function') {
          return { statusCode: 501, headers, body: JSON.stringify({ error: 'NOT_IMPLEMENTED' }) };
        }
        const items = await fn();
        return { statusCode: 200, headers, body: JSON.stringify({ items: items || [] }) };
      } catch (e) {
        console.error('[admin-model-config-list]', e?.stack ?? e);
        return { statusCode: 500, headers, body: JSON.stringify({ error: e?.message || 'MODEL_CONFIG_LIST_FAILED' }) };
      }
    }

    // POST /internal/admin-model-config-upsert �?写入 nx_model_config
    if (pathNorm.endsWith('/internal/admin-model-config-upsert') || pathNorm === '/internal/admin-model-config-upsert') {
      const gate = checkNxAdminIssueCouponSecret(reqHeaders, body);
      if (!gate.ok) {
        return { statusCode: gate.status, headers, body: JSON.stringify(gate.payload) };
      }
      try {
        const fn = dbModule.upsertModelConfigRow;
        if (typeof fn !== 'function') {
          return { statusCode: 501, headers, body: JSON.stringify({ error: 'NOT_IMPLEMENTED' }) };
        }
        const r = await fn(body);
        invalidateNxModelConfigCache();
        return { statusCode: 200, headers, body: JSON.stringify(r) };
      } catch (e) {
        console.error('[admin-model-config-upsert]', e?.stack ?? e);
        return { statusCode: 500, headers, body: JSON.stringify({ error: e?.message || 'MODEL_CONFIG_UPSERT_FAILED' }) };
      }
    }

    // POST /internal/admin-users-list �?脱敏用户列表（需 NX_ADMIN_ISSUE_COUPON_SECRET�?    if (pathNorm.endsWith('/internal/admin-users-list') || pathNorm === '/internal/admin-users-list') {
      const gate = checkNxAdminIssueCouponSecret(reqHeaders, body);
      if (!gate.ok) {
        return { statusCode: gate.status, headers, body: JSON.stringify(gate.payload) };
      }
      try {
        const fn = dbModule.adminListAllUsersForOps;
        if (typeof fn !== 'function') {
          return { statusCode: 501, headers, body: JSON.stringify({ error: 'NOT_IMPLEMENTED' }) };
        }
        const maxScan = parseInt(body.max_scan_rows ?? body.maxScanRows ?? '100000', 10);
        const r = await fn({
          maxScanRows: Number.isFinite(maxScan) ? maxScan : 100000,
        });
        return { statusCode: 200, headers, body: JSON.stringify(r) };
      } catch (e) {
        console.error('[admin-users-list]', e?.stack ?? e);
        return { statusCode: 500, headers, body: JSON.stringify({ error: e?.message || 'ADMIN_USERS_LIST_FAILED' }) };
      }
    }

    // POST /internal/admin-set-user-concurrency — Phase 3：套餐/并发覆盖（需 NX_ADMIN_ISSUE_COUPON_SECRET）
    if (
      pathNorm.endsWith('/internal/admin-set-user-concurrency') ||
      pathNorm === '/internal/admin-set-user-concurrency'
    ) {
      const gate = checkNxAdminIssueCouponSecret(reqHeaders, body);
      if (!gate.ok) {
        return { statusCode: gate.status, headers, body: JSON.stringify(gate.payload) };
      }
      try {
        const fn = dbModule.updateUserConcurrencyEntitlement;
        if (typeof fn !== 'function') {
          return { statusCode: 501, headers, body: JSON.stringify({ error: 'NOT_IMPLEMENTED' }) };
        }
        const uid = String(body.user_id ?? body.userId ?? '').trim();
        if (!uid) {
          return {
            statusCode: 400,
            headers,
            body: JSON.stringify({ error: 'BAD_REQUEST', message: 'user_id 必填' }),
          };
        }
        const patch = {};
        if (body.plan_id != null || body.planId != null) {
          patch.planId = body.plan_id ?? body.planId;
        }
        if (body.clear_overrides === true || body.clearOverrides === true) {
          patch.clearConcurrencyOverrides = true;
        } else {
          if (body.video_concurrency_override !== undefined || body.videoConcurrencyOverride !== undefined) {
            const v = body.video_concurrency_override ?? body.videoConcurrencyOverride;
            patch.videoConcurrencyOverride = v === null || v === '' ? null : Number(v);
          }
          if (body.image_concurrency_override !== undefined || body.imageConcurrencyOverride !== undefined) {
            const v = body.image_concurrency_override ?? body.imageConcurrencyOverride;
            patch.imageConcurrencyOverride = v === null || v === '' ? null : Number(v);
          }
          if (
            body.concurrency_override_expires_at !== undefined ||
            body.concurrencyOverrideExpiresAt !== undefined
          ) {
            patch.concurrencyOverrideExpiresAt =
              body.concurrency_override_expires_at ?? body.concurrencyOverrideExpiresAt;
          }
        }
        const updated = await fn(uid, patch);
        const { concurrencyFieldsForMeResponse } = await import('./lib/userConcurrencyEntitlement.mjs');
        const conc = concurrencyFieldsForMeResponse(updated);
        return {
          statusCode: 200,
          headers,
          body: JSON.stringify({
            ok: true,
            user_id: updated.userId,
            ...conc,
          }),
        };
      } catch (e) {
        const msg = e?.message || 'ADMIN_SET_CONCURRENCY_FAILED';
        if (msg === 'USER_NOT_FOUND') {
          return { statusCode: 404, headers, body: JSON.stringify({ error: 'USER_NOT_FOUND' }) };
        }
        console.error('[admin-set-user-concurrency]', e?.stack ?? e);
        return { statusCode: 500, headers, body: JSON.stringify({ error: msg }) };
      }
    }

    // POST /internal/admin-profit-analytics �?利润聚合（consume + nx_model_config + 已核销兑换码）
    if (pathNorm.endsWith('/internal/admin-profit-analytics') || pathNorm === '/internal/admin-profit-analytics') {
      const gate = checkNxAdminIssueCouponSecret(reqHeaders, body);
      if (!gate.ok) {
        return { statusCode: gate.status, headers, body: JSON.stringify(gate.payload) };
      }
      try {
        const fn = dbModule.adminAggregateProfitAnalytics;
        if (typeof fn !== 'function') {
          return { statusCode: 501, headers, body: JSON.stringify({ error: 'NOT_IMPLEMENTED' }) };
        }
        const maxTx = parseInt(body.max_tx_scan_rows ?? body.maxTxScanRows ?? '60000', 10);
        const maxCp = parseInt(body.max_coupon_scan_rows ?? body.maxCouponScanRows ?? '50000', 10);
        const r = await fn({
          maxTxScanRows: Number.isFinite(maxTx) ? maxTx : 60000,
          maxCouponScanRows: Number.isFinite(maxCp) ? maxCp : 50000,
        });
        return { statusCode: 200, headers, body: JSON.stringify(r) };
      } catch (e) {
        console.error('[admin-profit-analytics]', e?.stack ?? e);
        return { statusCode: 500, headers, body: JSON.stringify({ error: e?.message || 'ADMIN_PROFIT_ANALYTICS_FAILED' }) };
      }
    }

    // POST /auth/send-code �?�?6 位验证码（TableStore nx_verify_codes�? 分钟有效；Resend 发信�?    if (pathNorm.endsWith('/auth/send-code') || pathNorm === '/auth/send-code') {
      const emailRaw = body.email;
      const email = typeof emailRaw === 'string' ? emailRaw.trim().toLowerCase() : '';
      if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: 'INVALID_EMAIL' }) };
      }
      let existingRow = null;
      try {
        existingRow = await dbModule.getVerifyCodeRow(email);
      } catch (e) {
        console.warn('[auth/send-code] getVerifyCodeRow', e?.message || e);
      }
      const nowMs = Date.now();
      const ratePlan = planSendCodeRateFromRow(existingRow, nowMs);
      if (!ratePlan.ok) {
        const msg =
          ratePlan.reason === 'RATE_HOUR'
            ? '该邮�?1 小时内验证码发送次数已达上限，请稍后再�?
            : '发送过于频繁，请稍后再�?;
        return {
          statusCode: 429,
          headers,
          body: JSON.stringify({
            error: 'RATE_LIMIT',
            code: ratePlan.reason,
            message: msg,
          }),
        };
      }
      const resendKey = process.env.RESEND_API_KEY?.trim();
      const from = process.env.RESEND_FROM_EMAIL?.trim();
      if (!resendKey || !from) {
        return {
          statusCode: 503,
          headers,
          body: JSON.stringify({ error: 'RESEND_NOT_CONFIGURED', message: '请配�?RESEND_API_KEY �?RESEND_FROM_EMAIL' }),
        };
      }
      const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
      const expiresAt = nowMs + 5 * 60 * 1000;
      try {
        await dbModule.upsertVerifyCode(email, code, expiresAt, ratePlan.nextList);
      } catch (e) {
        console.error('[auth/send-code] upsertVerifyCode', e?.stack ?? e);
        return { statusCode: 500, headers, body: JSON.stringify({ error: 'STORE_FAILED' }) };
      }
      const purpose = typeof body.purpose === 'string' ? body.purpose.trim() : '';
      const emailSubject =
        purpose === 'change_password' ? 'AIXflow 修改密码验证�? : 'AIXflow 登录验证�?;
      try {
        const { Resend } = await import('resend');
        const resend = new Resend(resendKey);
        const { error } = await resend.emails.send({
          from,
          to: email,
          subject: emailSubject,
          html: buildOtpEmailHtml(code),
        });
        if (error) {
          console.error('[auth/send-code] Resend', error);
          try {
            await dbModule.clearVerifyCodeKeepRate(email);
          } catch (_) {}
          return {
            statusCode: 502,
            headers,
            body: JSON.stringify({ error: 'SEND_FAILED', message: String(error.message || error) }),
          };
        }
      } catch (e) {
        console.error('[auth/send-code]', e?.stack ?? e);
        try {
          await dbModule.clearVerifyCodeKeepRate(email);
        } catch (_) {}
        return {
          statusCode: 502,
          headers,
          body: JSON.stringify({
            error: 'SEND_FAILED',
            message: String(e?.message || e || 'unknown'),
          }),
        };
      }
      return { statusCode: 200, headers, body: JSON.stringify({ ok: true }) };
    }

    /**
     * POST /auth/change-password（无需 JWT；桌面端 nxFcClient 已列入免 Bearer 白名单）
     * Body: { email, code�? 位）, new_password | newPassword }
     * 流程：校�?nx_verify_codes �?bcrypt �?nx_users.password_hash（经 updateUserPasswordByEmail�?     */
    if (pathNorm.endsWith('/auth/change-password') || pathNorm === '/auth/change-password') {
      const emailNorm = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
      const newPassword = body.new_password ?? body.newPassword;
      const code = typeof body.code === 'string' ? body.code.trim().replace(/\s/g, '') : '';
      if (!emailNorm || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailNorm)) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: 'INVALID_EMAIL' }) };
      }
      if (!newPassword || typeof newPassword !== 'string' || newPassword.length < 6) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: 'password too short' }) };
      }
      if (!/^\d{6}$/.test(code)) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: 'INVALID_CODE_FORMAT' }) };
      }
      let u;
      try {
        u = await dbModule.getUserByEmail(emailNorm);
      } catch (e) {
        console.error('[auth/change-password] getUserByEmail', e?.stack ?? e);
        return { statusCode: 500, headers, body: JSON.stringify({ error: 'CHANGE_PASSWORD_FAILED' }) };
      }
      if (!u) {
        return { statusCode: 404, headers, body: JSON.stringify({ error: 'USER_NOT_FOUND' }) };
      }
      let vrow;
      try {
        vrow = await dbModule.getVerifyCodeRow(emailNorm);
      } catch (e) {
        console.error('[auth/change-password] getVerifyCodeRow', e?.stack ?? e);
        return { statusCode: 500, headers, body: JSON.stringify({ error: 'VERIFY_READ_FAILED' }) };
      }
      if (!vrow || vrow.code !== code) {
        return { statusCode: 401, headers, body: JSON.stringify({ error: 'INVALID_CODE' }) };
      }
      if (Date.now() > vrow.expires_at) {
        await dbModule.deleteVerifyCode(emailNorm);
        return { statusCode: 401, headers, body: JSON.stringify({ error: 'CODE_EXPIRED' }) };
      }
      await dbModule.deleteVerifyCode(emailNorm);
      try {
        const passwordHash = await bcrypt.hash(newPassword, 10);
        await dbModule.updateUserPasswordByEmail(emailNorm, passwordHash);
      } catch (e) {
        console.error('[auth/change-password]', e?.stack ?? e);
        return { statusCode: 500, headers, body: JSON.stringify({ error: 'CHANGE_PASSWORD_FAILED' }) };
      }
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ ok: true, session_revoked: true }),
      };
    }

    // POST /auth/login �?邮箱 + 6 位验证码；新用户自动 nx_users + nx_email_user
    if (pathNorm.endsWith('/auth/login') || pathNorm === '/auth/login') {
      try {
        getJwtSecrets();
      } catch (e) {
        return { statusCode: 500, headers, body: JSON.stringify({ error: 'JWT_SECRET_NOT_CONFIGURED' }) };
      }
      const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
      const code = typeof body.code === 'string' ? body.code.trim().replace(/\s/g, '') : '';
      if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: 'INVALID_EMAIL' }) };
      }
      if (!/^\d{6}$/.test(code)) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: 'INVALID_CODE_FORMAT' }) };
      }
      let row;
      try {
        row = await dbModule.getVerifyCodeRow(email);
      } catch (e) {
        console.error('[auth/login] getVerifyCodeRow', e?.stack ?? e);
        return { statusCode: 500, headers, body: JSON.stringify({ error: 'VERIFY_READ_FAILED' }) };
      }
      if (!row || row.code !== code) {
        return { statusCode: 401, headers, body: JSON.stringify({ error: 'INVALID_CODE' }) };
      }
      if (Date.now() > row.expires_at) {
        await dbModule.deleteVerifyCode(email);
        return { statusCode: 401, headers, body: JSON.stringify({ error: 'CODE_EXPIRED' }) };
      }
      await dbModule.deleteVerifyCode(email);

      let u = await dbModule.getUserByEmail(email);
      let isNewUser = false;
      if (!u) {
        const userId = `nx_${crypto.randomUUID()}`;
        try {
          await dbModule.createUserOtpOnly({ userId, email });
          await dbModule.updateUserLastLogin(userId);
          u = await dbModule.getUserById(userId);
          isNewUser = true;
        } catch (e) {
          console.error('[auth/login] createUserOtpOnly', e?.stack ?? e);
          return { statusCode: 500, headers, body: JSON.stringify({ error: 'REGISTER_FAILED' }) };
        }
      } else {
        if (u.status === 'frozen') {
          return { statusCode: 403, headers, body: JSON.stringify({ error: 'USER_FROZEN' }) };
        }
        await dbModule.updateUserLastLogin(u.userId);
        u = await dbModule.getUserById(u.userId);
      }
      if (!u) {
        return { statusCode: 500, headers, body: JSON.stringify({ error: 'USER_NOT_FOUND' }) };
      }
      const tokens = signTokens(u.userId, u.tokenVersion ?? 0);
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          user_id: u.userId,
          email: u.email,
          balance: u.balance,
          is_first_recharge: u.isFirstRecharge === true,
          is_new_user: isNewUser,
          ...tokens,
        }),
      };
    }

    // POST /register �?须先通过 POST /auth/send-code 获取邮箱验证码，body.code �?6 位数�?    if (pathNorm.endsWith('/register') || pathNorm === '/register') {
      try {
        getJwtSecrets();
      } catch (e) {
        return { statusCode: 500, headers, body: JSON.stringify({ error: 'JWT_SECRET_NOT_CONFIGURED' }) };
      }
      const email = body.email;
      const password = body.password;
      if (!email || !password || typeof email !== 'string' || typeof password !== 'string') {
        return { statusCode: 400, headers, body: JSON.stringify({ error: 'email and password required' }) };
      }
      if (password.length < 6) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: 'password too short' }) };
      }
      const emailNorm = email.trim().toLowerCase();
      const code = typeof body.code === 'string' ? body.code.trim().replace(/\s/g, '') : '';
      if (!/^\d{6}$/.test(code)) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: 'INVALID_CODE_FORMAT' }) };
      }
      try {
        const existingEarly = await dbModule.getUserByEmail(emailNorm);
        if (existingEarly) {
          return { statusCode: 409, headers, body: JSON.stringify({ error: 'EMAIL_ALREADY_REGISTERED' }) };
        }
      } catch (e) {
        console.error('[register] getUserByEmail', e?.stack ?? e);
        return { statusCode: 500, headers, body: JSON.stringify({ error: 'REGISTER_FAILED' }) };
      }
      let vrow;
      try {
        vrow = await dbModule.getVerifyCodeRow(emailNorm);
      } catch (e) {
        console.error('[register] getVerifyCodeRow', e?.stack ?? e);
        return { statusCode: 500, headers, body: JSON.stringify({ error: 'VERIFY_READ_FAILED' }) };
      }
      if (!vrow || vrow.code !== code) {
        return { statusCode: 401, headers, body: JSON.stringify({ error: 'INVALID_CODE' }) };
      }
      if (Date.now() > vrow.expires_at) {
        await dbModule.deleteVerifyCode(emailNorm);
        return { statusCode: 401, headers, body: JSON.stringify({ error: 'CODE_EXPIRED' }) };
      }
      await dbModule.deleteVerifyCode(emailNorm);
      try {
        const userId = `nx_${crypto.randomUUID()}`;
        const passwordHash = await bcrypt.hash(password, 10);
        await dbModule.createUser({ userId, email: emailNorm, passwordHash });
        const u = await dbModule.getUserById(userId);
        const tokens = signTokens(userId, u?.tokenVersion ?? 0);
        return {
          statusCode: 200,
          headers,
          body: JSON.stringify({
            user_id: userId,
            email: u.email,
            balance: u.balance,
            is_first_recharge: u.isFirstRecharge === true,
            ...tokens,
          }),
        };
      } catch (regErr) {
        console.error('[register]', regErr?.code, regErr?.message, regErr?.stack);
        return {
          statusCode: 500,
          headers,
          body: JSON.stringify({
            error: 'REGISTER_FAILED',
            otsCode: regErr?.code ?? null,
            message: regErr?.message || 'Tablestore or bcrypt error',
          }),
        };
      }
    }

    // POST /login
    if (pathNorm.endsWith('/login') || pathNorm === '/login') {
      try {
        getJwtSecrets();
      } catch (e) {
        return { statusCode: 500, headers, body: JSON.stringify({ error: 'JWT_SECRET_NOT_CONFIGURED' }) };
      }
      const password = body.password;
      const emailNorm = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
      if (!emailNorm || !password) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: 'email and password required' }) };
      }
      let u;
      try {
        u = await dbModule.getUserByEmail(emailNorm);
      } catch (e) {
        console.error('[login] getUserByEmail', e?.stack ?? e);
        return { statusCode: 500, headers, body: JSON.stringify({ error: 'LOGIN_DB_FAILED' }) };
      }
      if (!u) {
        return { statusCode: 401, headers, body: JSON.stringify({ error: 'INVALID_CREDENTIALS' }) };
      }
      if (!u.passwordHash) {
        return {
          statusCode: 401,
          headers,
          body: JSON.stringify({
            error: 'USE_OTP_LOGIN',
            message: '请使用验证码登录',
          }),
        };
      }
      let ok = false;
      try {
        ok = await bcrypt.compare(password, u.passwordHash);
      } catch (e) {
        console.error('[login] bcrypt.compare', e?.stack ?? e);
        return { statusCode: 500, headers, body: JSON.stringify({ error: 'LOGIN_VERIFY_FAILED' }) };
      }
      if (!ok) {
        return { statusCode: 401, headers, body: JSON.stringify({ error: 'INVALID_CREDENTIALS' }) };
      }
      if (u.status === 'frozen') {
        return { statusCode: 403, headers, body: JSON.stringify({ error: 'USER_FROZEN' }) };
      }
      try {
        await dbModule.updateUserLastLogin(u.userId);
      } catch (e) {
        console.error('[login] updateUserLastLogin', e?.stack ?? e);
      }
      let fresh;
      try {
        fresh = await dbModule.getUserById(u.userId);
      } catch (e) {
        console.error('[login] getUserById', e?.stack ?? e);
        return { statusCode: 500, headers, body: JSON.stringify({ error: 'LOGIN_DB_FAILED' }) };
      }
      const tokens = signTokens(u.userId, fresh?.tokenVersion ?? 0);
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          user_id: u.userId,
          email: fresh?.email ?? emailNorm,
          balance: fresh?.balance,
          is_first_recharge: fresh?.isFirstRecharge === true,
          ...tokens,
        }),
      };
    }

    // POST /refresh
    if (pathNorm.endsWith('/refresh') || pathNorm === '/refresh') {
      try {
        getJwtSecrets();
      } catch (e) {
        return { statusCode: 500, headers, body: JSON.stringify({ error: 'JWT_SECRET_NOT_CONFIGURED' }) };
      }
      const rt = body.refresh_token || body.refreshToken;
      if (!rt) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: 'refresh_token required' }) };
      }
      const userId = await verifyRefreshTokenAsync(rt, dbModule);
      if (!userId) {
        return { statusCode: 401, headers, body: JSON.stringify({ error: 'INVALID_REFRESH_TOKEN' }) };
      }
      const u = await dbModule.getUserById(userId);
      const tokens = signTokens(userId, u?.tokenVersion ?? 0);
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          user_id: userId,
          balance: u?.balance ?? 0,
          is_first_recharge: u?.isFirstRecharge === true,
          ...tokens,
        }),
      };
    }

    // GET/POST /me — balance + Phase 3 concurrency
    if (pathNorm.endsWith('/me') || pathNorm === '/me') {
      const userId = await verifyAccessTokenAsync(auth, dbModule);
      if (!userId) {
        return { statusCode: 401, headers, body: JSON.stringify({ error: 'UNAUTHORIZED' }) };
      }
      const u = await dbModule.getUserById(userId);
      if (!u) return { statusCode: 404, headers, body: JSON.stringify({ error: 'USER_NOT_FOUND' }) };
      let concurrencyExtra = {};
      try {
        const { concurrencyFieldsForMeResponse } = await import('./lib/userConcurrencyEntitlement.mjs');
        concurrencyExtra = concurrencyFieldsForMeResponse(u);
      } catch (e) {
        console.warn('[me] concurrency resolve skipped', e?.message || e);
      }
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          user_id: u.userId,
          email: u.email,
          balance: u.balance,
          status: u.status,
          is_first_recharge: u.isFirstRecharge === true,
          ...concurrencyExtra,
        }),
      };
    }

/**
 * FC_SERVER_KEEPALIVE_MS 未设置时默认 120000（大文件/长耗时）；设为 0 表示使用 0ms（按需配合 Node 默认�? * FC_SERVER_HEADERS_MS 可单独覆盖；否则�?keepAlive + 5s
 * FC_SERVER_REQUEST_MS：整请求超时，默�?0（不限制，利于长视频）；需限制时再设毫秒数
 */
function applyAixflowHttpServerTimeouts(server) {
  const raw = process.env.FC_SERVER_KEEPALIVE_MS;
  const keepAliveMs =
    raw === '0' ? 0 : raw === undefined || raw === '' ? 120000 : Number(raw) || 120000;
  server.keepAliveTimeout = keepAliveMs;
  const hRaw = process.env.FC_SERVER_HEADERS_MS;
  const headersMs =
    hRaw !== undefined && hRaw !== ''
      ? Number(hRaw) || (keepAliveMs === 0 ? 125000 : keepAliveMs + 5000)
      : keepAliveMs === 0
        ? 125000
        : keepAliveMs + 5000;
  server.headersTimeout = headersMs;
  if ('requestTimeout' in server) {
    const reqTo = process.env.FC_SERVER_REQUEST_MS;
    if (reqTo === undefined || reqTo === '') server.requestTimeout = 0;
    else server.requestTimeout = reqTo === '0' ? 0 : Number(reqTo) || 0;
  }
}

function startCustomRuntimeHttpServer() {
  const port = Number(process.env.PORT || process.env.FC_SERVER_PORT || 9000);
  const server = http.createServer(async (req, res) => {
    try {
      /** 预检：不�?body，便于健康检查与 CORS 快�?204 */
      if (String(req.method || '').toUpperCase() === 'OPTIONS') {
        res.writeHead(204, getCorsHeaders(req.headers));
        res.end();
        return;
      }

      const bodyStr =
        req.method === 'GET' || req.method === 'HEAD' ? '' : await readIncomingMessageBody(req);
      const event = buildFcEventFromNodeRequest(req, bodyStr);
      const fcOut = await handler(event);
      writeFcHttpResponse(res, fcOut, req.method);
    } catch (e) {
      console.error('[AIXFLOW FC] http:', e?.stack ?? e);
      const cors = getCorsHeaders(req.headers);
      res.writeHead(500, {
        ...cors,
        'Content-Type': 'application/json; charset=utf-8',
      });
      res.end(JSON.stringify({ error: e?.message || 'Internal Server Error' }));
    }
  });

  applyAixflowHttpServerTimeouts(server);

  return new Promise((resolve, reject) => {
    server.listen(port, '0.0.0.0', () => {
      registerAixflowGlobalErrorHandlers();
      console.log(`[AIXFLOW FC] custom runtime listening on 0.0.0.0:${port} (node index.mjs)`);
      resolve();
    });
    server.on('error', reject);
  });
}

/** 事件触发模式（非 node 主入口）也挂载全局异常日志，与 listen 内注册互斥（guard 防重复） */
if (!isMainModule()) {
  registerAixflowGlobalErrorHandlers();
}

if (isMainModule()) {
  startCustomRuntimeHttpServer().catch((e) => {
    console.error('[AIXFLOW FC] failed to start HTTP server:', e?.stack || e);
    process.exit(1);
  });
}
