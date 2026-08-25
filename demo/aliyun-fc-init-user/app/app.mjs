/**
 * AIXFLOW ????FC?JWT ??/?? + run-task ??
 * ???????????? FC?OTS/OSS ????????????.env.example?? * ?????JWT_SECRET, JWT_REFRESH_SECRET, BLTCY_API_KEY, OTS_ENDPOINT, OTS_INSTANCE?? OTS_INST_NAME?? OTS_*, API_SECRET_TOKEN????
 *
 * ????????????`node index.mjs` ????0.0.0.0:9000?? PORT?? node:http ????????handler -> handleRequest + CORS?? */
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

/** ????FC ?????? / ??????????*/
function isAliyunFcRuntime() {
  return Boolean(
    process.env.FC_FUNCTION_NAME ||
      process.env.FC_SERVICE_NAME ||
      process.env.ALIYUN_FC_FUNCTION_NAME,
  );
}

/**
 * Tablestore ?????? OTS_INSTANCE???? .env.example ???????FC ????????OTS_INST_NAME???????? * @returns {string}
 */
function getOtsInstanceName() {
  return process.env.OTS_INSTANCE?.trim() || process.env.OTS_INST_NAME?.trim() || '';
}

/**
 * ?????????????????????/api/admin ???????????? * ???? await import ?????????????????????????
 */
function checkFcDeployEnv() {
  const missing = [];
  if (!process.env.JWT_SECRET?.trim()) missing.push('JWT_SECRET');
  if (!process.env.OTS_ENDPOINT?.trim()) missing.push('OTS_ENDPOINT');
  if (!getOtsInstanceName()) missing.push('OTS_INSTANCE ??OTS_INST_NAME');
  if (missing.length && isAliyunFcRuntime()) {
    console.warn(
      '[AIXFLOW FC] ????????????/??/OTS ??????????,
      missing.join(', '),
    );
  }
}

/** ????????????????????top-level await */
checkFcDeployEnv();

/**
 * ???????????????????? pricing????????/code/pricing/????????????????????? * ???????? pricing/?npm run fc:pack ????zip??? */
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

/** ??POST /model-config ???? run-task ??nx_model_config ????????*/
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
 * ??RunningHub ????body ???? ID?? pricing ??model ?????? * @param {string} path
 * @param {Record<string, unknown>} bodyObj
 */
function extractModelIdFromForward(path, bodyObj) {
  const b = bodyObj && typeof bodyObj === 'object' ? bodyObj : {};
  if (typeof b.model === 'string' && b.model.trim()) return b.model.trim();
  const p = String(path || '').replace(/^\//, '');
  // /run/ai-app/{appId} ???? ID??????"run"??  const aiApp = p.match(/^run\/ai-app\/([a-zA-Z0-9._-]+)/i);
  if (aiApp?.[1]) return aiApp[1];
  const seg = p.split('/').filter(Boolean)[0];
  if (seg && /^[a-zA-Z0-9._-]+$/.test(seg)) return seg;
  return '';
}
const RATE_LIMIT_WINDOW_MS = 60 * 1000;
/** 单用户每分钟最多 run-task 次数。故事+分批剧本远超 5 次，过低会误伤成 RATE_LIMIT_EXCEEDED */
const RATE_LIMIT_MAX = Math.max(5, parseInt(process.env.NX_RATE_LIMIT_MAX || '20', 10) || 20);
const BLTCY_CHAT_URL = 'https://api.bltcy.ai/v1/chat/completions';
const API_TIMEOUT_MS = 180000;
const ACCESS_EXPIRES = process.env.JWT_ACCESS_EXPIRES || '30m';
const REFRESH_EXPIRES = process.env.JWT_REFRESH_EXPIRES || '7d';

const rateLimitMap = new Map();

function getJwtSecrets() {
  const a = process.env.JWT_SECRET?.trim();
  const r = process.env.JWT_REFRESH_SECRET?.trim() || a;
  if (!a) {
    const err = new Error('?? FC ????????JWT_SECRET??????JWT??);
    err.code = 'JWT_SECRET_NOT_CONFIGURED';
    err.name = 'JWT_SECRET_NOT_CONFIGURED';
    throw err;
  }
  return { access: a, refresh: r };
}

/** @param {string} userId @param {number} [tokenVersion] nx_users.token_version???? JWT ?????????? */
function signTokens(userId, tokenVersion = 0) {
  const tv = Math.max(0, parseInt(String(tokenVersion), 10) || 0);
  const { access, refresh } = getJwtSecrets();
  const accessToken = jwt.sign({ sub: userId, typ: 'access', tv }, access, { expiresIn: ACCESS_EXPIRES });
  const refreshToken = jwt.sign({ sub: userId, typ: 'refresh', tv }, refresh, { expiresIn: REFRESH_EXPIRES });
  return { accessToken, refreshToken, expiresIn: ACCESS_EXPIRES };
}

/** ?? access JWT ??token ??tv ??nx_users.token_version ??????? token ????*/
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

/** ??????HTML????? */
function buildOtpEmailHtml(code) {
  const safe = String(code).replace(/[^0-9]/g, '').slice(0, 6);
  return `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"></head>
<body style="margin:0;background:#0a0a0c;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#0a0a0c;padding:48px 16px;">
    <tr><td align="center">
      <div style="max-width:440px;font-family:system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
        <p style="color:#9ca3af;font-size:15px;margin:0 0 20px;letter-spacing:0.02em;">??????/p>
        <div style="background:#12121a;border:1px solid rgba(255,255,255,0.08);border-radius:20px;padding:36px 28px;text-align:center;box-shadow:0 24px 48px rgba(0,0,0,0.45);">
          <span style="color:#f4f4f5;font-size:44px;font-weight:700;letter-spacing:12px;font-variant-numeric:tabular-nums;line-height:1.2;">${safe}</span>
        </div>
        <p style="color:#52525b;font-size:12px;margin:28px 0 0;line-height:1.6;">5 ????????????????????/p>
      </div>
    </td></tr>
  </table>
</body></html>`;
}

/**
 * ?? nx_verify_codes.send_rate_ts?JSON ??????????????60s ??1 ?????1 ??????5 ??? * ?????NX_SEND_CODE_MIN_MS?NX_SEND_CODE_HOUR_MS?NX_SEND_CODE_PER_HOUR_MAX
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
 * ??FC / API ????????HTTP Method??? OPTIONS ????????????POST????CORS 401?? */
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
 * ??FC / API ????????path?FC 3.0 ???? requestContext.http.path?? rawPath?? */
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
 * ????HTTP ????????? body ?????? x-fc-* ????????502?BadResponse?? */
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
 * ??????? JSON.parse ????????? OPTIONS????204 + CORS???????? */
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

/** ?????????? POST /internal/issue-coupon ???NX_ADMIN_ISSUE_COUPON_SECRET??*/
function checkNxAdminIssueCouponSecret(reqHeaders, body) {
  const secret = process.env.NX_ADMIN_ISSUE_COUPON_SECRET?.trim();
  if (!secret) {
    return {
      ok: false,
      status: 503,
      payload: {
        error: 'ADMIN_NOT_CONFIGURED',
        message: '????NX_ADMIN_ISSUE_COUPON_SECRET',
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

/** ??????????FC ???NX_ALIPAY_PAY_SECRET?????? NX_ADMIN_ISSUE_COUPON_SECRET??*/
function checkAlipayPaySecret(reqHeaders, body) {
  const secret =
    process.env.NX_ALIPAY_PAY_SECRET?.trim() || process.env.NX_ADMIN_ISSUE_COUPON_SECRET?.trim();
  if (!secret) {
    return {
      ok: false,
      status: 503,
      payload: {
        error: 'ALIPAY_PAY_NOT_CONFIGURED',
        message: '????NX_ALIPAY_PAY_SECRET',
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
    const base = (process.env.BLTCY_API_BASE || 'https://api.bltcy.ai').replace(/\/$/, '');
    return `${base}${p}`;
  }
  throw new Error('UNSUPPORTED_FORWARD_PROVIDER');
}

/** LLM?BLTCY chat completions */
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
        choices: [{ message: { role: 'assistant', content: '??????????????' } }],
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

/** ??RunningHub ??forward ????????????????URL????nx_tasks.result_oss_url ????*/
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

/** ???????? RunningHub ??BLTCY???????? */
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
                ? '?? RunningHub ?????HTTP 401??????FC ???? RUNNINGHUB_API_KEY_AI'
                : '?? RunningHub ?????HTTP 401??????FC ???? RUNNINGHUB_API_KEY';
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
              ? '?? RunningHub ?????HTTP 401??????FC ???? RUNNINGHUB_API_KEY_AI'
              : '?? RunningHub ?????HTTP 401??????FC ???? RUNNINGHUB_API_KEY';
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

    /** ?? OTS ????task_id?? /tasks/create ???????????? /query ???? id ????*/
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
    const err = new Error('????????????');
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
      const err = new Error('????????????');
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
    /** ?????? id?????????? runninghub ????API ?? */
    description: modelId,
  });

  if (deductResult.idempotent) {
    const u = await dbModule.getUserById(userId);
    return {
      data: { duplicate_task: true, message: '??????????????' },
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
 * ?? run-task ??????????forward??????body/payload??????
 * body ??{ messages: [] } ??inner ????body??????forward????LLM ????messages required?? */
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

  /** ????????????????????? taskId ?????????*/
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
 * POST /tasks/create?? nx_model_config ??model_id ??????????nx_tasks?pending???? task_id?? * Body: model_id????, params???? JSON ?????? prompt_json?? type|task_type?llm|image|video|audio????image??
 *       nodeData|node_data??????run-task ???????, workflow_json????
 */
async function handleTasksCreate(userId, body, dbModule) {
  const { getFinalPrice } = await ensurePricing();
  const modelId = String(body?.model_id ?? body?.modelId ?? '').trim();
  if (!modelId) throw new Error('model_id required');

  const taskTypeRaw = String(body?.type ?? body?.task_type ?? 'image').toLowerCase();
  const taskType =
    taskTypeRaw === 'llm' || taskTypeRaw === 'image' || taskTypeRaw === 'video' || taskTypeRaw === 'audio'
      ? taskTypeRaw
      : 'image';

  const nodeData =
    body?.nodeData && typeof body.nodeData === 'object'
      ? body.nodeData
      : body?.node_data && typeof body.node_data === 'object'
        ? body.node_data
        : {};

  let params = body?.params;
  if (params === undefined || params === null) {
    params = body?.prompt_json ?? body?.promptJson ?? {};
  }
  const promptJsonStr =
    typeof params === 'string'
      ? params
      : JSON.stringify(params && typeof params === 'object' ? params : { value: params });

  const workflowRaw = body?.workflow_json ?? body?.workflowJson;
  const workflowStr =
    workflowRaw === undefined || workflowRaw === null
      ? ''
      : typeof workflowRaw === 'string'
        ? workflowRaw
        : JSON.stringify(workflowRaw);

  let modelConfigMap = null;
  try {
    modelConfigMap = await loadNxModelConfigMapForBilling(dbModule);
  } catch (e) {
    console.warn('[tasks/create] listModelConfig skipped:', e?.message || e);
  }

  const cost = getFinalPrice(modelId, { taskType, nodeData, modelConfigMap });
  const taskId = crypto.randomUUID();

  const billingUserTask = await dbModule.getUserById(userId);
  if (billingUserTask && typeof dbModule.assertModelCostThreshold === 'function') {
    dbModule.assertModelCostThreshold(billingUserTask, cost, taskType);
  }

  const deductResult = await dbModule.deductWithTransaction(userId, taskId, cost, {
    provider: 'task_create',
    description: `create:${modelId}`,
  });

  if (deductResult.idempotent) {
    const u = await dbModule.getUserById(userId);
    return {
      task_id: taskId,
      balance: u?.balance ?? deductResult.balance,
      cost_coins: cost,
      model_id: modelId,
      duplicate_task: true,
    };
  }

  let refunded = false;
  const safeRefund = async () => {
    if (refunded) return;
    refunded = true;
    try {
      await dbModule.refundWithLedger(userId, taskId, cost, {
        provider: 'task_create',
        description: 'task_record_failed',
      });
    } catch (re) {
      console.error('[tasks/create] refund failed', re?.message || re);
    }
  };

  try {
    await dbModule.upsertTask(taskId, userId, {
      status: 'pending',
      cost,
      amount: cost,
      prompt_json: promptJsonStr,
      ...(workflowStr ? { workflow_json: workflowStr } : {}),
    });
  } catch (e) {
    await safeRefund();
    throw e;
  }

  const u = await dbModule.getUserById(userId);
  return {
    task_id: taskId,
    balance: u?.balance ?? deductResult.balance,
    cost_coins: cost,
    model_id: modelId,
  };
}

async function handleRequest(req) {
  /** ??????CORS ?? Origin?????????????? */
  let reqHeadersForCors = {};
  let headers = { ...getCorsHeaders(), 'Content-Type': 'application/json' };
  /** ???? catch ??/api/admin/* ??CORS */
  let isAdminApiPath = false;

  try {
    const preflightFirst = tryOptionsPreflightFirst(req);
    if (preflightFirst) return preflightFirst;

    /** ????????????????JSON ?????FC 3.0 ???? requestContext.http */
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
     * Aixflow ??????/api/admin/* ??lib/aixflow-admin-oss.mjs ??handleAixflowAdminRequest
     * POST /api/admin/scan-oss-stock ??handleAdminScanOssStock???? admin ????????
     * ??upload-file?update-json?delete-item?update-title?get-showcase?scan-oss-stock ??     * OPTIONS ?????? 204?POST ????x-admin-password?ADMIN_PASS??     */
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

    // POST /internal/settle-stale-tasks ??Cron????RUNNING/PROCESSING ???????? TIMEOUT?? ADMIN_SETTLE_SECRET??    if (pathNorm.endsWith('/internal/settle-stale-tasks') || pathNorm === '/internal/settle-stale-tasks') {
      const secret = process.env.ADMIN_SETTLE_SECRET?.trim();
      if (!secret) {
        return {
          statusCode: 503,
          headers,
          body: JSON.stringify({ error: 'SETTLEMENT_NOT_CONFIGURED', message: '????ADMIN_SETTLE_SECRET' }),
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

    // POST /internal/issue-coupon ??????????? NX_ADMIN_ISSUE_COUPON_SECRET??????JWT??    if (pathNorm.endsWith('/internal/issue-coupon') || pathNorm === '/internal/issue-coupon') {
      const secret = process.env.NX_ADMIN_ISSUE_COUPON_SECRET?.trim();
      if (!secret) {
        return {
          statusCode: 503,
          headers,
          body: JSON.stringify({
            error: 'ISSUE_COUPON_NOT_CONFIGURED',
            message: '????NX_ADMIN_ISSUE_COUPON_SECRET',
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
              message: '???? 30/50/100/200/500????,
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

    // POST /internal/alipay-create-order ???????? pending ???? NX_ALIPAY_PAY_SECRET + x-nexflow-token??    if (pathNorm.endsWith('/internal/alipay-create-order') || pathNorm === '/internal/alipay-create-order') {
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

    // POST /internal/alipay-notify-settle ??????notify ??????? NX_ALIPAY_PAY_SECRET??    if (pathNorm.endsWith('/internal/alipay-notify-settle') || pathNorm === '/internal/alipay-notify-settle') {
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

    // POST /internal/alipay-order-status ?????????????/??????
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

    // POST /internal/alipay-retry-process ???????Cron / ???? 30s??    if (pathNorm.endsWith('/internal/alipay-retry-process') || pathNorm === '/internal/alipay-retry-process') {
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

    // POST /internal/alipay-execute-pending ???? queued ???????????
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

    // POST /internal/check-balance-consistency ?????????
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

    // POST /internal/admin-dashboard-stats ???????????????????? NX_ADMIN_ISSUE_COUPON_SECRET??    if (pathNorm.endsWith('/internal/admin-dashboard-stats') || pathNorm === '/internal/admin-dashboard-stats') {
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

    // POST /internal/admin-failed-tasks ????/??????
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

    // POST /internal/admin-refund-task ???????refundConsumedTask??    if (pathNorm.endsWith('/internal/admin-refund-task') || pathNorm === '/internal/admin-refund-task') {
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

    // POST /internal/admin-model-config-list ?????????? /model-config ??????????
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

    // POST /internal/admin-model-config-upsert ???? nx_model_config
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

    // POST /internal/admin-users-list ?????????? NX_ADMIN_ISSUE_COUPON_SECRET??    if (pathNorm.endsWith('/internal/admin-users-list') || pathNorm === '/internal/admin-users-list') {
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

    // POST /internal/admin-profit-analytics ???????consume + nx_model_config + ???????
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

    // POST /auth/send-code ????6 ?????TableStore nx_verify_codes?? ?????Resend ????    if (pathNorm.endsWith('/auth/send-code') || pathNorm === '/auth/send-code') {
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
            ? '????1 ?????????????????????
            : '?????????????;
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
          body: JSON.stringify({ error: 'RESEND_NOT_CONFIGURED', message: '????RESEND_API_KEY ??RESEND_FROM_EMAIL' }),
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
        purpose === 'change_password' ? 'AIXflow ???????? : 'AIXflow ??????;
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
     * POST /auth/change-password??? JWT???? nxFcClient ???? Bearer ????
     * Body: { email, code?? ??, new_password | newPassword }
     * ??????nx_verify_codes ??bcrypt ??nx_users.password_hash?? updateUserPasswordByEmail??     */
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

    // POST /auth/login ???? + 6 ?????????? nx_users + nx_email_user
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

    // POST /register ?????? POST /auth/send-code ????????body.code ??6 ????    if (pathNorm.endsWith('/register') || pathNorm === '/register') {
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
            message: '????????',
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

    // GET /me ?????????    if (pathNorm.endsWith('/me') || pathNorm === '/me') {
      const userId = await verifyAccessTokenAsync(auth, dbModule);
      if (!userId) {
        return { statusCode: 401, headers, body: JSON.stringify({ error: 'UNAUTHORIZED' }) };
      }
      const u = await dbModule.getUserById(userId);
      if (!u) return { statusCode: 404, headers, body: JSON.stringify({ error: 'USER_NOT_FOUND' }) };
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          user_id: u.userId,
          email: u.email,
          balance: u.balance,
          status: u.status,
          is_first_recharge: u.isFirstRecharge === true,
        }),
      };
    }

    // POST /asr/realtime-session ???????? ASR ????????FC??????WS?????? key??    if (
      pathNorm.endsWith('/asr/realtime-session') ||
      pathNorm === '/asr/realtime-session'
    ) {
      if (httpMethod !== 'POST' && httpMethod !== 'GET') {
        return { statusCode: 405, headers, body: JSON.stringify({ error: 'METHOD_NOT_ALLOWED' }) };
      }
      const userId = await verifyAccessTokenAsync(auth, dbModule);
      if (!userId) {
        return { statusCode: 401, headers, body: JSON.stringify({ error: 'UNAUTHORIZED' }) };
      }
      const { handleAsrRealtimeSession } = await import(
        new URL('./lib/asrRealtimeSession.mjs', import.meta.url)
      );
      return handleAsrRealtimeSession({ userId, headers });
    }

    // POST /asr/file-transcribe ???? fun-asr ??????????????FC??????????segments??    // ??????fun-asr?type=audio?????? getFileTranscribeDisplayPrice ??
    if (
      pathNorm.endsWith('/asr/file-transcribe') ||
      pathNorm === '/asr/file-transcribe'
    ) {
      if (httpMethod !== 'POST') {
        return { statusCode: 405, headers, body: JSON.stringify({ error: 'METHOD_NOT_ALLOWED' }) };
      }
      const userId = await verifyAccessTokenAsync(auth, dbModule);
      if (!userId) {
        return { statusCode: 401, headers, body: JSON.stringify({ error: 'UNAUTHORIZED' }) };
      }

      const ASR_FILE_BILLING_MODEL_ID = 'fun-asr';
      const { getFinalPrice, isModelNotPricedError } = await ensurePricing();
      let modelConfigMap = null;
      try {
        modelConfigMap = await loadNxModelConfigMapForBilling(dbModule);
      } catch (e) {
        console.warn('[billing] listModelConfig (asr file) skipped:', e?.message || e);
      }
      /** Align with client getFileTranscribeDisplayPrice: at least 10 yuanbao per call */
      const ASR_FILE_MIN_YUANBAO = 10;
      let cost;
      try {
        cost = getFinalPrice(ASR_FILE_BILLING_MODEL_ID, {
          taskType: 'audio',
          nodeData: {},
          modelConfigMap,
        });
      } catch (e) {
        if (isModelNotPricedError(e)) {
          cost = ASR_FILE_MIN_YUANBAO;
        } else {
          throw e;
        }
      }
      {
        const n = Math.round(Number(cost));
        cost = Number.isFinite(n) && n >= ASR_FILE_MIN_YUANBAO ? n : ASR_FILE_MIN_YUANBAO;
      }
      const billingTaskId = `asr_file_${crypto.randomUUID()}`;
      const billingUser = await dbModule.getUserById(userId);
      if (billingUser && typeof dbModule.assertModelCostThreshold === 'function') {
        try {
          dbModule.assertModelCostThreshold(billingUser, cost, 'audio');
        } catch (e) {
          const msg = e?.message || String(e);
          if (String(msg).includes('MODEL_COST_THRESHOLD')) {
            return {
              statusCode: 403,
              headers,
              body: JSON.stringify({ error: 'MODEL_COST_THRESHOLD_EXCEEDED', message: msg }),
            };
          }
          throw e;
        }
      }
      let deductResult;
      try {
        deductResult = await dbModule.deductWithTransaction(userId, billingTaskId, cost, {
          provider: 'dashscope',
          description: 'fun-asr file transcribe',
        });
      } catch (e) {
        const msg = e?.message || String(e);
        if (msg === 'BALANCE_INSUFFICIENT') {
          return {
            statusCode: 402,
            headers,
            body: JSON.stringify({
              error: 'BALANCE_INSUFFICIENT',
              message: 'Yuanbao insufficient; please recharge before cloud ASR',
            }),
          };
        }
        if (msg === 'USER_FROZEN') {
          return {
            statusCode: 403,
            headers,
            body: JSON.stringify({ error: 'USER_FROZEN', message: 'Account frozen' }),
          };
        }
        if (msg === 'INVALID_AMOUNT') {
          return {
            statusCode: 500,
            headers,
            body: JSON.stringify({
              error: 'INVALID_AMOUNT',
              message: 'Invalid ASR billing amount',
            }),
          };
        }
        throw e;
      }
      console.log(
        `[Billing] User: ${userId} | Model: ${ASR_FILE_BILLING_MODEL_ID} | Deduct: ${cost} Yuanbao (asr/file-transcribe)`,
      );

      const { handleAsrFileTranscribe } = await import(
        new URL('./lib/asrFileTranscribe.mjs', import.meta.url)
      );
      let result;
      try {
        result = await handleAsrFileTranscribe({ userId, headers, body });
      } catch (e) {
        try {
          await dbModule.refundWithLedger(userId, billingTaskId, cost, {
            provider: 'dashscope',
            description: 'fun-asr file transcribe failed',
          });
        } catch (re) {
          console.error('[asr/file-transcribe] refund failed', re?.message || re);
        }
        throw e;
      }
      const ok = result && result.statusCode === 200;
      if (!ok) {
        try {
          await dbModule.refundWithLedger(userId, billingTaskId, cost, {
            provider: 'dashscope',
            description: 'fun-asr file transcribe error',
          });
        } catch (re) {
          console.error('[asr/file-transcribe] refund failed', re?.message || re);
        }
        return result;
      }
      try {
        const payload = JSON.parse(result.body || '{}');
        const bal = Number(deductResult?.balance);
        payload.charged = true;
        payload.cost = cost;
        payload.balance = Number.isFinite(bal) ? bal : deductResult?.balance;
        payload.billingModelId = ASR_FILE_BILLING_MODEL_ID;
        payload.billingTaskId = billingTaskId;
        console.log(
          `[asr/file-transcribe] charged=true cost=${cost} balance=${payload.balance} task=${billingTaskId}`,
        );
        return {
          ...result,
          body: JSON.stringify(payload),
        };
      } catch {
        const bal = Number(deductResult?.balance);
        return {
          statusCode: 200,
          headers,
          body: JSON.stringify({
            ok: true,
            text: '',
            segments: [],
            hasWordTimestamps: false,
            charged: true,
            cost,
            balance: Number.isFinite(bal) ? bal : deductResult?.balance,
            billingModelId: ASR_FILE_BILLING_MODEL_ID,
            billingTaskId,
          }),
        };
      }
    }

    // POST /viapi/segment-video-body ? VIAPI segment; per-second bill:
    // billableSeconds = max(1, ceil(sec)); cost = max(1, ceil(unitCostPerMinute * billableSeconds / 60))
    // base_price = CNY per minute (fill 2); fallback unitCost = 20 yuanbao/min
    if (
      pathNorm.endsWith('/viapi/segment-video-body') ||
      pathNorm === '/viapi/segment-video-body'
    ) {
      if (httpMethod !== 'POST') {
        return { statusCode: 405, headers, body: JSON.stringify({ error: 'METHOD_NOT_ALLOWED' }) };
      }
      const userId = await verifyAccessTokenAsync(auth, dbModule);
      if (!userId) {
        return { statusCode: 401, headers, body: JSON.stringify({ error: 'UNAUTHORIZED' }) };
      }

      const VIAPI_SEG_BILLING_MODEL_ID = 'viapi-segment-video-body';
      const durationSecRaw = Number(body?.durationSec ?? body?.duration_sec ?? 0);
      const durationSec = Number.isFinite(durationSecRaw) && durationSecRaw > 0 ? durationSecRaw : 1;
      const billableSeconds = Math.max(1, Math.ceil(durationSec));
      const { getFinalPrice, isModelNotPricedError } = await ensurePricing();
      let modelConfigMap = null;
      try {
        modelConfigMap = await loadNxModelConfigMapForBilling(dbModule);
      } catch (e) {
        console.warn('[billing] listModelConfig (viapi segment) skipped:', e?.message || e);
      }
      let unitCost;
      try {
        unitCost = getFinalPrice(VIAPI_SEG_BILLING_MODEL_ID, {
          taskType: 'audio',
          nodeData: {},
          modelConfigMap,
        });
      } catch (e) {
        if (isModelNotPricedError(e)) {
          unitCost = 20; // yuanbao per minute fallback
        } else {
          throw e;
        }
      }
      const cost = Math.max(1, Math.ceil((unitCost * billableSeconds) / 60));
      const billingTaskId = `viapi_seg_${crypto.randomUUID()}`;
      const billingUser = await dbModule.getUserById(userId);
      if (billingUser && typeof dbModule.assertModelCostThreshold === 'function') {
        try {
          dbModule.assertModelCostThreshold(billingUser, cost, 'video');
        } catch (e) {
          const msg = e?.message || String(e);
          if (String(msg).includes('MODEL_COST_THRESHOLD')) {
            return {
              statusCode: 403,
              headers,
              body: JSON.stringify({ error: 'MODEL_COST_THRESHOLD_EXCEEDED', message: msg }),
            };
          }
          throw e;
        }
      }
      let deductResult;
      try {
        deductResult = await dbModule.deductWithTransaction(userId, billingTaskId, cost, {
          provider: 'viapi',
          description: 'viapi segment-video-body',
        });
      } catch (e) {
        const msg = e?.message || String(e);
        if (msg === 'BALANCE_INSUFFICIENT') {
          return {
            statusCode: 402,
            headers,
            body: JSON.stringify({
              error: 'BALANCE_INSUFFICIENT',
              message: '????????????????',
            }),
          };
        }
        if (msg === 'USER_FROZEN') {
          return {
            statusCode: 403,
            headers,
            body: JSON.stringify({ error: 'USER_FROZEN', message: '?????' }),
          };
        }
        throw e;
      }
      console.log(
        `[Billing] User: ${userId} | Model: ${VIAPI_SEG_BILLING_MODEL_ID} | Deduct: ${cost} Yuanbao (${billableSeconds}s @ ${unitCost}/min, viapi/segment-video-body)`,
      );

      const { handleViapiSegmentVideoBody } = await import(
        new URL('./lib/viapiSegmentVideoBody.mjs', import.meta.url)
      );
      let result;
      try {
        result = await handleViapiSegmentVideoBody({ userId, headers, body });
      } catch (e) {
        try {
          await dbModule.refundWithLedger(userId, billingTaskId, cost, {
            provider: 'viapi',
            description: 'viapi segment-video-body failed',
          });
        } catch (re) {
          console.error('[viapi/segment-video-body] refund failed', re?.message || re);
        }
        throw e;
      }
      const ok = result && result.statusCode === 200;
      if (!ok) {
        try {
          await dbModule.refundWithLedger(userId, billingTaskId, cost, {
            provider: 'viapi',
            description: 'viapi segment-video-body error',
          });
        } catch (re) {
          console.error('[viapi/segment-video-body] refund failed', re?.message || re);
        }
        return result;
      }
      try {
        const payload = JSON.parse(result.body || '{}');
        payload.cost = cost;
        payload.balance = deductResult?.balance;
        payload.billingModelId = VIAPI_SEG_BILLING_MODEL_ID;
        payload.billableSeconds = billableSeconds;
        payload.billableUnits = billableSeconds; // legacy: now billable seconds
        payload.billableMinutes = billableSeconds; // legacy alias
        payload.durationSec = durationSec;
        return {
          ...result,
          body: JSON.stringify(payload),
        };
      } catch {
        return result;
      }
    }

    // POST /recharge ???????Bearer ???????????? + out_trade_no ??????
    if (pathNorm.endsWith('/recharge') || pathNorm === '/recharge') {
      const payGate = checkAlipayPaySecret(reqHeaders, body);
      if (payGate.ok) {
        const outTradeNo = String(body.out_trade_no ?? body.outTradeNo ?? '').trim();
        const tradeNo = String(body.trade_no ?? body.tradeNo ?? '').trim();
        const amountRaw = body.amount_cny ?? body.amountCny ?? body.total_amount;
        const amountCny = typeof amountRaw === 'string' ? parseFloat(amountRaw) : Number(amountRaw);
        if (!outTradeNo) {
          return { statusCode: 400, headers, body: JSON.stringify({ error: 'OUT_TRADE_NO_REQUIRED' }) };
        }
        try {
          const fn = dbModule.settleAlipayOrder;
          if (typeof fn !== 'function') {
            return { statusCode: 501, headers, body: JSON.stringify({ error: 'NOT_IMPLEMENTED' }) };
          }
          console.log('[recharge/alipay] settle', outTradeNo);
          const r = await fn(outTradeNo, tradeNo, amountCny);
          return { statusCode: 200, headers, body: JSON.stringify(r) };
        } catch (e) {
          const msg = e?.message || 'RECHARGE_FAILED';
          console.error('[recharge/alipay]', msg, e?.stack ?? e);
          if (msg === 'ORDER_NOT_FOUND') {
            return { statusCode: 404, headers, body: JSON.stringify({ error: 'ORDER_NOT_FOUND' }) };
          }
          return { statusCode: 500, headers, body: JSON.stringify({ error: msg }) };
        }
      }

      const userId = await verifyAccessTokenAsync(auth, dbModule);
      if (!userId) {
        return { statusCode: 401, headers, body: JSON.stringify({ error: 'UNAUTHORIZED' }) };
      }
      const amountRaw = body.amount_cny ?? body.amountCny ?? body.tier ?? body.amount;
      const amountCny = typeof amountRaw === 'string' ? parseFloat(amountRaw) : Number(amountRaw);
      if (!Number.isFinite(amountCny)) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: 'amount_cny required' }) };
      }
      try {
        const r = await dbModule.rechargeWithLedger(userId, amountCny);
        return {
          statusCode: 200,
          headers,
          body: JSON.stringify(r),
        };
      } catch (e) {
        const msg = e?.message || 'RECHARGE_FAILED';
        if (msg === 'INVALID_RECHARGE_TIER') {
          return {
            statusCode: 400,
            headers,
            body: JSON.stringify({ error: 'INVALID_RECHARGE_TIER', message: '??????50/100/300/1000 ?? }),
          };
        }
        if (msg === 'USER_NOT_FOUND') {
          return { statusCode: 404, headers, body: JSON.stringify({ error: 'USER_NOT_FOUND' }) };
        }
        if (msg === 'USER_FROZEN') {
          return { statusCode: 403, headers, body: JSON.stringify({ error: 'USER_FROZEN' }) };
        }
        console.error('[recharge]', e?.stack ?? e);
        return {
          statusCode: 500,
          headers,
          body: JSON.stringify({ error: msg }),
        };
      }
    }

    // POST /redeem-coupon ????????? Bearer??    if (pathNorm.endsWith('/redeem-coupon') || pathNorm === '/redeem-coupon') {
      const userId = await verifyAccessTokenAsync(auth, dbModule);
      if (!userId) {
        return { statusCode: 401, headers, body: JSON.stringify({ error: 'UNAUTHORIZED' }) };
      }
      const codeRaw = body.code ?? body.coupon_code;
      const codeStr = codeRaw != null ? String(codeRaw) : '';
      if (!codeStr.trim()) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ error: 'COUPON_CODE_REQUIRED', message: '??????' }),
        };
      }
      try {
        const dbModule = await ensureDb();
        const r = await dbModule.redeemCouponWithLedger(userId, codeStr);
        return {
          statusCode: 200,
          headers,
          body: JSON.stringify(r),
        };
      } catch (e) {
        const msg = e?.message || 'REDEEM_FAILED';
        if (msg === 'COUPON_INVALID') {
          return {
            statusCode: 400,
            headers,
            body: JSON.stringify({ error: 'COUPON_INVALID', message: '?????????? }),
          };
        }
        if (msg === 'COUPON_USED') {
          return {
            statusCode: 400,
            headers,
            body: JSON.stringify({ error: 'COUPON_USED', message: '??????' }),
          };
        }
        if (msg === 'COUPON_MISCONFIGURED') {
          return {
            statusCode: 500,
            headers,
            body: JSON.stringify({ error: 'COUPON_MISCONFIGURED', message: '???????? }),
          };
        }
        if (msg === 'INVALID_RECHARGE_TIER') {
          return {
            statusCode: 400,
            headers,
            body: JSON.stringify({ error: 'INVALID_RECHARGE_TIER', message: '??????50/100/300/1000 ?? }),
          };
        }
        if (msg === 'USER_NOT_FOUND') {
          return { statusCode: 404, headers, body: JSON.stringify({ error: 'USER_NOT_FOUND' }) };
        }
        if (msg === 'USER_FROZEN') {
          return { statusCode: 403, headers, body: JSON.stringify({ error: 'USER_FROZEN' }) };
        }
        console.error('[redeem-coupon]', e?.stack ?? e);
        return {
          statusCode: 500,
          headers,
          body: JSON.stringify({ error: msg }),
        };
      }
    }

    // POST /transactions — 流水分页（需 Bearer；body: limit, page）
    if (pathNorm.endsWith('/transactions') || pathNorm === '/transactions') {
      const userId = await verifyAccessTokenAsync(auth, dbModule);
      if (!userId) {
        return { statusCode: 401, headers, body: JSON.stringify({ error: 'UNAUTHORIZED' }) };
      }
      const lim = Math.min(50, Math.max(1, parseInt(body.limit, 10) || 30));
      const page = Math.max(1, parseInt(body.page, 10) || 1);
      try {
        const pagedFn = dbModule.listTransactionsForUserPaged;
        if (typeof pagedFn === 'function') {
          const result = await pagedFn(userId, { limit: lim, page });
          return {
            statusCode: 200,
            headers,
            body: JSON.stringify({
              items: result.items || [],
              page: result.page ?? page,
              pageSize: result.pageSize ?? lim,
              total: result.total ?? 0,
              hasMore: !!result.hasMore,
            }),
          };
        }
        const items = await dbModule.listRecentTransactionsForUser(userId, lim);
        return {
          statusCode: 200,
          headers,
          body: JSON.stringify({
            items,
            page: 1,
            pageSize: lim,
            total: Array.isArray(items) ? items.length : 0,
            hasMore: false,
          }),
        };
      } catch (e) {
        console.error('[transactions]', e?.stack ?? e);
        return {
          statusCode: 500,
          headers,
          body: JSON.stringify({ error: e?.message || 'LIST_FAILED' }),
        };
      }
    }


    // POST /tasks ?????????? Bearer???????? idx_user_tasks??    if (pathNorm.endsWith('/tasks') || pathNorm === '/tasks') {
      const userId = await verifyAccessTokenAsync(auth, dbModule);
      if (!userId) {
        return { statusCode: 401, headers, body: JSON.stringify({ error: 'UNAUTHORIZED' }) };
      }
      const lim = Math.min(50, Math.max(1, parseInt(body.limit, 10) || 20));
      try {
        const listFn = dbModule.listRecentTasksForUser;
        const items = typeof listFn === 'function' ? await listFn(userId, lim) : [];
        return { statusCode: 200, headers, body: JSON.stringify({ items }) };
      } catch (e) {
        console.error('[tasks]', e?.stack ?? e);
        return {
          statusCode: 500,
          headers,
          body: JSON.stringify({ error: e?.message || 'LIST_FAILED' }),
        };
      }
    }

    // POST /tasks/status ?????????? Bearer?? /tasks ???????+ balance??    if (pathNorm.endsWith('/tasks/status') || pathNorm === '/tasks/status') {
      const userId = await verifyAccessTokenAsync(auth, dbModule);
      if (!userId) {
        return { statusCode: 401, headers, body: JSON.stringify({ error: 'UNAUTHORIZED' }) };
      }
      const tid = String(body.task_id ?? body.taskId ?? '').trim();
      if (!tid) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ error: 'BAD_REQUEST', message: 'task_id ??' }),
        };
      }
      try {
        const getFn = dbModule.getTaskRowForUser;
        if (typeof getFn !== 'function') {
          return { statusCode: 501, headers, body: JSON.stringify({ error: 'NOT_IMPLEMENTED' }) };
        }
        const row = await getFn(tid, userId);
        if (!row) {
          return { statusCode: 404, headers, body: JSON.stringify({ error: 'NOT_FOUND' }) };
        }
        let balance = 0;
        try {
          const u = await dbModule.getUserById(userId);
          balance = u?.balance ?? 0;
        } catch (_) {}
        return { statusCode: 200, headers, body: JSON.stringify({ ...row, balance }) };
      } catch (e) {
        console.error('[tasks/status]', e?.stack ?? e);
        return {
          statusCode: 500,
          headers,
          body: JSON.stringify({ error: e?.message || 'STATUS_FAILED' }),
        };
      }
    }

    // POST /tasks/create ????model_id ??????pending ???? Bearer??    if (pathNorm.endsWith('/tasks/create') || pathNorm === '/tasks/create') {
      const userId = await verifyAccessTokenAsync(auth, dbModule);
      if (!userId) {
        return { statusCode: 401, headers, body: JSON.stringify({ error: 'UNAUTHORIZED' }) };
      }
      if (!checkRateLimit(userId)) {
        return {
          statusCode: 429,
          headers,
          body: JSON.stringify({
            error: 'RATE_LIMIT_EXCEEDED',
            message: '请求过于频繁，请稍后再试',
          }),
        };
      }
      try {
        const r = await handleTasksCreate(userId, body, dbModule);
        return { statusCode: 200, headers, body: JSON.stringify(r) };
      } catch (e) {
        if (
          e?.name === 'ModelNotPricedError' ||
          e?.nxStatusCode === 403 ||
          e?.nxErrorCode === 'MODEL_NOT_PRICED'
        ) {
          return {
            statusCode: 403,
            headers,
            body: JSON.stringify({
              error: '????????????',
              code: 'MODEL_NOT_PRICED',
            }),
          };
        }
        const msg = e?.message || 'TASK_CREATE_FAILED';
        if (msg === 'BALANCE_INSUFFICIENT') {
          return { statusCode: 402, headers, body: JSON.stringify({ error: 'BALANCE_INSUFFICIENT' }) };
        }
        if (msg === 'USER_FROZEN') {
          return { statusCode: 403, headers, body: JSON.stringify({ error: 'USER_FROZEN' }) };
        }
        if (msg === 'USER_NOT_FOUND') {
          return { statusCode: 404, headers, body: JSON.stringify({ error: 'USER_NOT_FOUND' }) };
        }
        if (msg === 'INVALID_AMOUNT') {
          return {
            statusCode: 400,
            headers,
            body: JSON.stringify({ error: 'INVALID_AMOUNT', message: '??????0 ????????' }),
          };
        }
        if (msg === 'model_id required') {
          return {
            statusCode: 400,
            headers,
            body: JSON.stringify({ error: 'BAD_REQUEST', message: 'model_id ??' }),
          };
        }
        console.error('[tasks/create]', e?.stack ?? e);
        return { statusCode: 500, headers, body: JSON.stringify({ error: msg }) };
      }
    }

    // init-user ??
    if (pathNorm.endsWith('/init-user') || pathNorm === '/init-user') {
      return {
        statusCode: 410,
        headers,
        body: JSON.stringify({
          error: 'DEPRECATED',
          message: '????/register ??/login??????????',
        }),
      };
    }

    // POST /model-config ??nx_model_config ???? Bearer????????
    if (pathNorm.endsWith('/model-config') || pathNorm === '/model-config') {
      const userId = await verifyAccessTokenAsync(auth, dbModule);
      if (!userId) {
        return { statusCode: 401, headers, body: JSON.stringify({ error: 'UNAUTHORIZED' }) };
      }
      try {
        const listFn = dbModule.listModelConfig;
        const items = typeof listFn === 'function' ? await listFn() : [];
        return {
          statusCode: 200,
          headers,
          body: JSON.stringify({ items }),
        };
      } catch (e) {
        console.error('[model-config]', e?.stack ?? e);
        return {
          statusCode: 500,
          headers,
          body: JSON.stringify({ error: e?.message || 'MODEL_CONFIG_LIST_FAILED' }),
        };
      }
    }

    // run-task
    const isRunTask = pathNorm.endsWith('/run-task') || pathNorm === '/run-task' || pathNorm === '/' || pathNorm === '';
    if (!isRunTask) {
      return { statusCode: 404, headers, body: JSON.stringify({ error: 'Not Found' }) };
    }

    const userId = await verifyAccessTokenAsync(auth, dbModule);
    if (!userId) {
      return {
        statusCode: 401,
        headers,
        body: JSON.stringify({ error: 'UNAUTHORIZED', message: '???Authorization: Bearer <access_token>' }),
      };
    }

    const taskId = body.taskId || getHeader(reqHeaders, 'x-task-id');
    if (!taskId || typeof taskId !== 'string') {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'taskId required' }) };
    }
    const tid = taskId.trim();

    const innerPre = body.body || body.payload || body;
    const billingPre = String(innerPre?.billing ?? body.billing ?? 'charge').toLowerCase();
    if (billingPre !== 'none' && billingPre !== 'refund' && !checkRateLimit(userId)) {
      return {
        statusCode: 429,
        headers,
        body: JSON.stringify({
          error: 'RATE_LIMIT_EXCEEDED',
          message: '请求过于频繁，请稍后再试',
        }),
      };
    }

    try {
      const result = await handleRunTask(userId, tid, body, dbModule);
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          ...result.data,
          balance: result.balance,
        }),
      };
    } catch (e) {
      console.error('run-task error:', e?.stack ?? e);
      if (
        e?.name === 'ModelNotPricedError' ||
        e?.nxStatusCode === 403 ||
        e?.nxErrorCode === 'MODEL_NOT_PRICED'
      ) {
        return {
          statusCode: 403,
          headers,
          body: JSON.stringify({
            error: '????????????',
            code: 'MODEL_NOT_PRICED',
            balanceRefunded: false,
          }),
        };
      }
      const rd = e?.response?.data;
      const message =
        (typeof rd?.error === 'string' && rd.error) ||
        rd?.message ||
        e?.message ||
        'Internal Server Error';
      const refundSucceeded = e?.nxRefundSucceeded === true;
      const isBal =
        message === 'BALANCE_INSUFFICIENT' ||
        message === 'USER_FROZEN' ||
        message === 'USER_NOT_FOUND' ||
        String(message).toUpperCase().includes('BALANCE');
      const code =
        message === 'USER_FROZEN'
          ? 403
          : message === 'USER_NOT_FOUND'
            ? 404
            : isBal
              ? 402
              : e?.response?.status >= 400
                ? e.response.status
                : 500;
      return {
        statusCode: code,
        headers,
        body: JSON.stringify({
          error: message,
          ...(refundSucceeded
            ? {
                errorCode: 'PROVIDER_ERROR_REFUNDED',
                balanceRefunded: true,
              }
            : { balanceRefunded: false }),
        }),
      };
    }
  } catch (e) {
    console.error('[handler]', e?.stack ?? e);
    let adminGuess = isAdminApiPath;
    if (!adminGuess) {
      try {
        let s = '';
        if (typeof req === 'string') s = req;
        else if (Buffer.isBuffer(req) || (req && typeof req.length === 'number' && typeof req.toString === 'function')) {
          s = req.toString('utf8');
        }
        if (s) {
          const ev = JSON.parse(s);
          const p = String(ev.rawPath || ev.path || '').split('?')[0];
          adminGuess = p.includes('/api/admin/');
        }
      } catch {
        /* ignore */
      }
    }
    const errHeaders = adminGuess ? adminCorsJsonHeaders(reqHeadersForCors) : headers;
    return {
      statusCode: 500,
      headers: errHeaders,
      body: JSON.stringify({ error: e?.message || 'Internal Server Error' }),
    };
  }
}

export const handler = async (req) => sanitizeFcResponse(await handleRequest(req));

// ---------------------------------------------------------------------------
// ???????FC ????????node index.mjs????9000?????? HTTP ??????????handler
// ---------------------------------------------------------------------------

function isMainModule() {
  if (!process.argv[1]) return false;
  try {
    const entry = path.resolve(fileURLToPath(pathToFileURL(process.argv[1]).href));
    const thisFile = path.resolve(fileURLToPath(import.meta.url));
    return entry === thisFile;
  } catch {
    return false;
  }
}

async function readIncomingMessageBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8');
}

/**
 * ??Node IncomingMessage ????FC HTTP ?????? event?? parseRequest / handleRequest ??
 */
function buildFcEventFromNodeRequest(req, bodyStr) {
  const host = req.headers?.host || '127.0.0.1';
  let pathWithQuery = '/';
  try {
    const u = new URL(req.url || '/', `http://${host}`);
    pathWithQuery = u.pathname + (u.search || '');
  } catch {
    const raw = String(req.url || '/');
    pathWithQuery = raw.startsWith('/') ? raw : `/${raw}`;
  }
  const headers = {};
  for (const [k, v] of Object.entries(req.headers || {})) {
    if (v === undefined) continue;
    headers[k] = Array.isArray(v) ? v.join(', ') : String(v);
  }
  const ev = {
    httpMethod: String(req.method || 'GET').toUpperCase(),
    path: pathWithQuery,
    headers,
  };
  if (bodyStr && bodyStr.length) ev.body = bodyStr;
  return ev;
}

function writeFcHttpResponse(nodeRes, fcOut, reqMethod) {
  const code = Number(fcOut.statusCode) || 500;
  const raw = fcOut.headers && typeof fcOut.headers === 'object' ? { ...fcOut.headers } : {};
  let body = fcOut.body === undefined || fcOut.body === null ? '' : fcOut.body;
  if (typeof body !== 'string') body = String(body);
  if (reqMethod === 'HEAD') {
    nodeRes.writeHead(code, raw);
    nodeRes.end();
    return;
  }
  nodeRes.writeHead(code, raw);
  nodeRes.end(body);
}

/** listen ?????????????? */
let _aixflowProcHandlersRegistered = false;
function registerAixflowGlobalErrorHandlers() {
  if (_aixflowProcHandlersRegistered) return;
  _aixflowProcHandlersRegistered = true;
  process.on('uncaughtException', (err) => {
    console.error('[AIXFLOW FC] uncaughtException:', err?.stack || err);
  });
  process.on('unhandledRejection', (reason, p) => {
    console.error('[AIXFLOW FC] unhandledRejection:', reason, p);
  });
}

/**
 * FC_SERVER_KEEPALIVE_MS ?????? 120000????/??????? 0 ???? 0ms????? Node ???? * FC_SERVER_HEADERS_MS ??????????keepAlive + 5s
 * FC_SERVER_REQUEST_MS??????????0?????????????????????
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
      /** ??????body???????? CORS ???204 */
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

/** ???????? node ??????????????? listen ??????guard ???? */
if (!isMainModule()) {
  registerAixflowGlobalErrorHandlers();
}

if (isMainModule()) {
  startCustomRuntimeHttpServer().catch((e) => {
    console.error('[AIXFLOW FC] failed to start HTTP server:', e?.stack || e);
    process.exit(1);
  });
}
