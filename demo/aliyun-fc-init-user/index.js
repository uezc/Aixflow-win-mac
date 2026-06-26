/**
 * 阿里云 FC - 统一入口（init-user + run-task）
 *
 * 环境变量：
 *   API_SECRET_TOKEN      - 请求头 x-nexflow-token 校验
 *   RUNNINGHUB_API_KEY    - RunningHub API Key（run-task 用）
 *   RUNNINGHUB_API_BASE   - 默认 https://www.runninghub.cn/openapi/v2
 *   DB_HOST, DB_PORT, DB_NAME, DB_USER, DB_PASSWORD - PostgreSQL
 */
const { Client } = require('pg');
const axios = require('axios');

const DEDUCT_POINTS = 5;
const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const RATE_LIMIT_MAX = 5;
const RUNNINGHUB_TIMEOUT_MS = 120000;

const rateLimitMap = new Map();

function getClient() {
  return new Client({
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432', 10),
    database: process.env.DB_NAME || 'nexflow',
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || '',
    ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false,
  });
}

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

async function getBalance(client, machineId) {
  const res = await client.query(
    'SELECT balance FROM users WHERE machine_id = $1',
    [machineId]
  );
  if (res.rows.length === 0) return null;
  return parseInt(res.rows[0].balance, 10);
}

async function deductBalance(client, machineId, amount) {
  const res = await client.query(
    `UPDATE users SET balance = balance - $1, updated_at = NOW()
     WHERE machine_id = $2 AND balance >= $1
     RETURNING balance`,
    [amount, machineId]
  );
  return res.rows.length > 0 ? parseInt(res.rows[0].balance, 10) : null;
}

async function refundBalance(client, machineId, amount) {
  await client.query(
    `UPDATE users SET balance = balance + $1, updated_at = NOW() WHERE machine_id = $2`,
    [amount, machineId]
  );
}

async function initOrGetUser(client, machineId) {
  const existing = await client.query(
    'SELECT id, balance, is_pro FROM users WHERE machine_id = $1',
    [machineId]
  );

  if (existing.rows.length > 0) {
    const row = existing.rows[0];
    return { userId: row.id, balance: parseInt(row.balance, 10), isPro: Boolean(row.is_pro) };
  }

  const userId = `user_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
  const initialBalance = 100;

  try {
    await client.query(
      'INSERT INTO users (id, machine_id, balance, is_pro) VALUES ($1, $2, $3, false)',
      [userId, machineId, initialBalance]
    );
    return { userId, balance: initialBalance, isPro: false };
  } catch (e) {
    if (e.code === '23505') {
      const retry = await client.query(
        'SELECT id, balance, is_pro FROM users WHERE machine_id = $1',
        [machineId]
      );
      if (retry.rows.length > 0) {
        const row = retry.rows[0];
        return { userId: row.id, balance: parseInt(row.balance, 10), isPro: Boolean(row.is_pro) };
      }
    }
    throw e;
  }
}

async function runTask(client, machineId, taskBody) {
  const balance = await getBalance(client, machineId);
  if (balance === null) throw new Error('USER_NOT_FOUND');
  if (balance < DEDUCT_POINTS) throw new Error('BALANCE_INSUFFICIENT');

  const newBalance = await deductBalance(client, machineId, DEDUCT_POINTS);
  if (newBalance === null) throw new Error('BALANCE_INSUFFICIENT');

  const apiKey = process.env.RUNNINGHUB_API_KEY;
  if (!apiKey) throw new Error('RUNNINGHUB_API_KEY_NOT_CONFIGURED');

  const baseUrl = (process.env.RUNNINGHUB_API_BASE || 'https://www.runninghub.cn/openapi/v2').replace(/\/$/, '');
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
      timeout: RUNNINGHUB_TIMEOUT_MS,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
        ...(taskBody.headers || {}),
      },
    });

    return { data: res.data, balance: newBalance };
  } catch (e) {
    await refundBalance(client, machineId, DEDUCT_POINTS);
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

exports.handler = async (req, context) => {
  const headers = { 'Content-Type': 'application/json' };

  if (!checkToken(req)) {
    return { statusCode: 401, headers, body: JSON.stringify({ error: 'Unauthorized' }) };
  }

  const path = (req.path || req.requestURI || '').split('?')[0].replace(/\/$/, '') || '/';
  const isInitUser = path.endsWith('/init-user') || path === '/init-user';
  const isRunTask = path.endsWith('/run-task') || path === '/run-task';

  if (!isInitUser && !isRunTask) {
    return { statusCode: 404, headers, body: JSON.stringify({ error: 'Not Found' }) };
  }

  const body = parseBody(req);

  if (isInitUser) {
    const username = body.username;
    if (!username || typeof username !== 'string') {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'username required' }) };
    }

    const client = getClient();
    await client.connect();
    try {
      const result = await initOrGetUser(client, username.trim());
      return { statusCode: 200, headers, body: JSON.stringify(result) };
    } catch (e) {
      console.error('init-user error:', e);
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({ error: 'Internal Server Error', message: e.message }),
      };
    } finally {
      await client.end();
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

    const client = getClient();
    await client.connect();
    try {
      const result = await runTask(client, id, body);
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
    } finally {
      await client.end();
    }
  }

  return { statusCode: 404, headers, body: JSON.stringify({ error: 'Not Found' }) };
};
