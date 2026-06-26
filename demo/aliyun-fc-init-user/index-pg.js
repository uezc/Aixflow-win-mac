/**
 * 阿里云 FC 3.0 - init-user 函数（PostgreSQL 版）
 *
 * 环境变量（在 FC 控制台配置）：
 *   DB_HOST, DB_PORT, DB_NAME, DB_USER, DB_PASSWORD
 *
 * 表结构：
 *   CREATE TABLE users (
 *     id VARCHAR(64) PRIMARY KEY,
 *     machine_id VARCHAR(256) UNIQUE NOT NULL,
 *     balance INT DEFAULT 100,
 *     is_pro BOOLEAN DEFAULT false,
 *     created_at TIMESTAMPTZ DEFAULT NOW(),
 *     updated_at TIMESTAMPTZ DEFAULT NOW()
 *   );
 */
const { Client } = require('pg');

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

async function initOrGetUser(machineId) {
  const client = getClient();
  await client.connect();

  try {
    const existing = await client.query(
      'SELECT id, balance, is_pro FROM users WHERE machine_id = $1',
      [machineId]
    );

    if (existing.rows.length > 0) {
      const row = existing.rows[0];
      return {
        userId: row.id,
        balance: parseInt(row.balance, 10),
        isPro: Boolean(row.is_pro),
      };
    }

    const userId = `user_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
    const initialBalance = 100;

    try {
      await client.query(
        `INSERT INTO users (id, machine_id, balance, is_pro) VALUES ($1, $2, $3, false)`,
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
          return {
            userId: row.id,
            balance: parseInt(row.balance, 10),
            isPro: Boolean(row.is_pro),
          };
        }
      }
      throw e;
    }
  } finally {
    await client.end();
  }
}

exports.handler = async (req, context) => {
  const headers = { 'Content-Type': 'application/json' };

  if (req.method !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method Not Allowed' }) };
  }

  let body;
  try {
    body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body || {};
  } catch {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid JSON' }) };
  }

  const username = body.username;
  if (!username || typeof username !== 'string') {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'username required' }) };
  }

  try {
    const result = await initOrGetUser(username.trim());
    return { statusCode: 200, headers, body: JSON.stringify(result) };
  } catch (e) {
    console.error('init-user error:', e);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Internal Server Error', message: e.message }),
    };
  }
};
