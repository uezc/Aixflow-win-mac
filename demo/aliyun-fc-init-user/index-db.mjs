/**
 * 阿里云 FC - 数据库版统一入口（init-user + run-task）
 * 支持 Tablestore 或 OSS JSON 两种存储
 *
 * 环境变量：
 *   DB_TYPE              - 存储类型：tablestore | oss_json（默认 tablestore）
 *   API_SECRET_TOKEN     - 请求头 x-nexflow-token 校验
 *   BLTCY_API_KEY        - 核心算力 API Key
 *   BLTCY_API_BASE       - 默认 https://api.apilio.ai
 *   RUNNINGHUB_API_KEY   - 插件算力 API Key
 *   RUNNINGHUB_API_BASE  - 默认 https://www.runninghub.cn/openapi/v2
 *
 * Tablestore 需配置：OTS_ENDPOINT, OTS_INSTANCE, OTS_ACCESS_KEY_ID, OTS_ACCESS_KEY_SECRET, OTS_TABLE
 * OSS JSON 需配置：OSS_REGION, OSS_BUCKET, OSS_ACCESS_KEY_ID, OSS_ACCESS_KEY_SECRET, OSS_USERS_OBJECT
 */
import axios from 'axios';

const DEDUCT_POINTS = 5;
const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const RATE_LIMIT_MAX = 5;
const API_TIMEOUT_MS = 120000;

const rateLimitMap = new Map();

const DB_TYPE = (process.env.DB_TYPE || 'tablestore').toLowerCase();
const db = DB_TYPE === 'oss_json'
  ? await import('./lib/db-oss-json.mjs')
  : await import('./lib/db-tablestore.mjs');

function checkToken(req) {
  const token = process.env.API_SECRET_TOKEN;
  if (!token) return true;
  const headerToken = req.headers?.['x-nexflow-token'] || req.headers?.['X-Nexflow-Token'];
  return headerToken === token;
}

function checkRateLimit(machineId) {
  const now = Date.now();
  let entry = rateLimitMap.get(machineId);
  if (!entry) {
    rateLimitMap.set(machineId, { count: 1, windowStart: now });
    return true;
  }
  if (now - entry.windowStart >= RATE_LIMIT_WINDOW_MS) {
    entry.count = 1;
    entry.windowStart = now;
    return true;
  }
  if (entry.count >= RATE_LIMIT_MAX) return false;
  entry.count++;
  return true;
}

async function runTask(machineId, taskBody) {
  const user = await db.getUser(machineId);
  if (!user) throw new Error('USER_NOT_FOUND');
  if (user.balance < DEDUCT_POINTS) throw new Error('BALANCE_INSUFFICIENT');

  const newBalance = await db.deductBalance(machineId, DEDUCT_POINTS);
  if (newBalance === null) throw new Error('BALANCE_INSUFFICIENT');

  const provider = (taskBody.provider || 'runninghub').toLowerCase();
  let baseUrl, apiKey;

  if (provider === 'bltcy') {
    apiKey = process.env.BLTCY_API_KEY;
    baseUrl = (process.env.BLTCY_API_BASE || 'https://api.apilio.ai').replace(/\/$/, '');
    if (!apiKey) throw new Error('BLTCY_API_KEY_NOT_CONFIGURED');
  } else if (provider === 'runninghub') {
    apiKey = process.env.RUNNINGHUB_API_KEY;
    baseUrl = (process.env.RUNNINGHUB_API_BASE || 'https://www.runninghub.cn/openapi/v2').replace(/\/$/, '');
    if (!apiKey) throw new Error('RUNNINGHUB_API_KEY_NOT_CONFIGURED');
  } else {
    throw new Error('INVALID_PROVIDER');
  }

  const path = (taskBody.path || taskBody.apiPath || '').replace(/^\//, '');
  const url = taskBody.url || `${baseUrl}/${path}`;
  const method = (taskBody.method || 'POST').toUpperCase();
  const body = taskBody.body || taskBody.payload || {};

  try {
    const res = await axios({
      method,
      url,
      data: method !== 'GET' ? body : undefined,
      params: method === 'GET' ? body : undefined,
      timeout: API_TIMEOUT_MS,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
        ...(taskBody.headers || {}),
      },
    });

    return { data: res.data, balance: newBalance };
  } catch (e) {
    await db.refundBalance(machineId, DEDUCT_POINTS);
    throw e;
  }
}

function parseBody(req) {
  const raw = req.body;
  if (typeof raw === 'string') {
    try {
      return JSON.parse(raw);
    } catch {
      return {};
    }
  }
  return raw || {};
}

export const handler = async (req, context) => {
  const headers = { 'Content-Type': 'application/json' };

  if (!checkToken(req)) {
    return { statusCode: 401, headers, body: JSON.stringify({ error: 'Unauthorized' }) };
  }

  const path = (req.path || req.requestURI || '').split('?')[0].replace(/\/$/, '') || '/';
  const isInitUser = path.endsWith('/init-user') || path === '/init-user';
  const isRunTask = path.endsWith('/run-task') || path === '/run-task';
  const isDeductBalance = path.endsWith('/deduct-balance') || path === '/deduct-balance';

  if (!isInitUser && !isRunTask && !isDeductBalance) {
    return { statusCode: 404, headers, body: JSON.stringify({ error: 'Not Found' }) };
  }

  const body = parseBody(req);

  if (isInitUser) {
    const username = body.username;
    if (!username || typeof username !== 'string') {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'username required' }) };
    }

    try {
      const result = await db.initOrGetUser(username.trim());
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          userId: result.userId,
          balance: result.balance,
          isPro: result.isPro ?? false,
        }),
      };
    } catch (e) {
      console.error('init-user error:', e);
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({ error: 'Internal Server Error', message: e.message }),
      };
    }
  }

  if (isDeductBalance) {
    const machineId = body.machineId || body.username;
    const amount = Math.abs(parseInt(body.amount, 10) || 0);
    const action = (body.action || 'deduct').toLowerCase();

    if (!machineId || typeof machineId !== 'string') {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'machineId required' }) };
    }
    if (amount <= 0) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'amount must be positive' }) };
    }

    try {
      if (action === 'refund') {
        await db.refundBalance(machineId.trim(), amount);
        const user = await db.getUser(machineId.trim());
        return {
          statusCode: 200,
          headers,
          body: JSON.stringify({ action: 'refund', balance: user?.balance ?? 0 }),
        };
      }
      const newBalance = await db.deductBalance(machineId.trim(), amount);
      if (newBalance === null) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ error: 'BALANCE_INSUFFICIENT' }),
        };
      }
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ action: 'deduct', balance: newBalance }),
      };
    } catch (e) {
      console.error('deduct-balance error:', e);
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({ error: e.message || 'Internal Server Error' }),
      };
    }
  }

  if (isRunTask) {
    const machineId = body.machineId || body.username;
    if (!machineId || typeof machineId !== 'string') {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'machineId required' }) };
    }

    const id = machineId.trim();
    if (!checkRateLimit(id)) {
      return {
        statusCode: 429,
        headers,
        body: JSON.stringify({ error: 'RATE_LIMIT_EXCEEDED', message: '每分钟最多 5 次请求' }),
      };
    }

    try {
      const result = await runTask(id, body);
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          ...result.data,
          balance: result.balance,
        }),
      };
    } catch (e) {
      console.error('run-task error:', e);
      const code = e.response?.status || 500;
      const message = e.response?.data?.message || e.message || 'Internal Server Error';
      return {
        statusCode: code >= 400 ? code : 500,
        headers,
        body: JSON.stringify({ error: message, balanceRefunded: true }),
      };
    }
  }

  return { statusCode: 404, headers, body: JSON.stringify({ error: 'Not Found' }) };
};
