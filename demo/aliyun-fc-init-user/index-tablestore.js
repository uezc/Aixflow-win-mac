/**
 * 阿里云 FC 3.0 - init-user 函数（Tablestore 版）
 *
 * 环境变量（在 FC 控制台配置）：
 *   OTS_ENDPOINT, OTS_INSTANCE, OTS_ACCESS_KEY_ID, OTS_ACCESS_KEY_SECRET
 *
 * 表名：nexflow_users
 * 主键：machine_id (STRING)
 * 属性：user_id, balance (INTEGER), is_pro (BOOLEAN), created_at, updated_at
 */
const { TableStore } = require('tablestore');

const TABLE_NAME = process.env.OTS_TABLE || 'nexflow_users';

function getClient() {
  return new TableStore.Client({
    accessKeyId: process.env.OTS_ACCESS_KEY_ID,
    secretAccessKey: process.env.OTS_ACCESS_KEY_SECRET,
    endpoint: process.env.OTS_ENDPOINT,
    instancename: process.env.OTS_INSTANCE,
  });
}

async function initOrGetUser(machineId) {
  const client = getClient();

  const getParams = {
    tableName: TABLE_NAME,
    primaryKey: [{ machine_id: machineId }],
  };

  try {
    const getRes = await client.getRow(getParams);
    const row = getRes.row;

    if (row && row.primaryKey && row.attributes && row.attributes.length > 0) {
      const attrs = {};
      row.attributes.forEach((a) => {
        attrs[a.columnName] = a.columnValue;
      });
      return {
        userId: attrs.user_id?.toString() || null,
        balance: parseInt(attrs.balance, 10) || 0,
        isPro: attrs.is_pro === 'true' || attrs.is_pro === true,
      };
    }
  } catch (e) {
    if (e.code !== 'OTSS object not exist') {
      throw e;
    }
  }

  const userId = `user_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
  const now = new Date().toISOString();

  const putParams = {
    tableName: TABLE_NAME,
    condition: new TableStore.Condition(
      TableStore.Condition.Type.IGNORE,
      'user_id'
    ),
    primaryKey: [{ machine_id: machineId }],
    attributeColumns: [
      { user_id: userId },
      { balance: 100 },
      { is_pro: false },
      { created_at: now },
      { updated_at: now },
    ],
  };

  await client.putRow(putParams);

  return { userId, balance: 100, isPro: false };
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
