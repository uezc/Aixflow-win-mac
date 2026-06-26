/**
 * OSS JSON 文件数据库适配器
 * 在 OSS Bucket 中存储单个 users.json 文件：{ machineId: { userId, balance, isPro, createdAt, updatedAt } }
 *
 * 环境变量：OSS_REGION, OSS_BUCKET, OSS_ACCESS_KEY_ID, OSS_ACCESS_KEY_SECRET, OSS_USERS_OBJECT
 * 与 aixflow-admin-oss 一致：OSS_USE_INTERNAL=1 时走内网 https://{region}-internal.aliyuncs.com
 */
import { createOssClientInstance } from './oss-sdk-options.mjs';

const USERS_OBJECT = process.env.OSS_USERS_OBJECT || 'nexflow/users.json';
const NX_CONTROL_REGION = String(process.env.NX_CONTROL_REGION || 'hk').trim().toLowerCase();

function checkWriteSafety(region, operation = 'write') {
  const r = String(region || '').trim().toLowerCase();
  const op = String(operation || '').trim().toLowerCase();
  if (r === 'be' && op === 'write') {
    throw new Error('[Sentinel] 北京冷备仅允许只读，已拦截写入请求。');
  }
}

function getClient() {
  return createOssClientInstance(process.env);
}

async function loadUsers() {
  const client = getClient();
  try {
    const res = await client.get(USERS_OBJECT);
    const text = (res.content && res.content.toString()) || '{}';
    return JSON.parse(text);
  } catch (e) {
    if (e.code === 'NoSuchKey') return {};
    throw e;
  }
}

async function saveUsers(data) {
  checkWriteSafety(NX_CONTROL_REGION, 'write');
  const client = getClient();
  await client.put(USERS_OBJECT, Buffer.from(JSON.stringify(data, null, 0), 'utf-8'), {
    headers: { 'Content-Type': 'application/json' },
  });
}

/** 获取用户，不存在返回 null */
export async function getUser(machineId) {
  const users = await loadUsers();
  const u = users[machineId];
  if (!u) return null;
  return {
    userId: u.userId || null,
    balance: typeof u.balance === 'number' ? u.balance : parseInt(u.balance, 10) || 0,
    isPro: Boolean(u.isPro),
  };
}

/** 初始化或获取用户（注册/查余额） */
export async function initOrGetUser(machineId) {
  const users = await loadUsers();
  const u = users[machineId];
  if (u) {
    return {
      userId: u.userId || null,
      balance: typeof u.balance === 'number' ? u.balance : parseInt(u.balance, 10) || 0,
      isPro: Boolean(u.isPro),
    };
  }

  const userId = `user_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
  const now = new Date().toISOString();
  users[machineId] = { userId, balance: 100, isPro: false, createdAt: now, updatedAt: now };
  await saveUsers(users);
  return { userId, balance: 100, isPro: false };
}

/** 扣费，成功返回新余额，余额不足返回 null */
export async function deductBalance(machineId, amount) {
  const users = await loadUsers();
  const u = users[machineId];
  if (!u) return null;
  const balance = typeof u.balance === 'number' ? u.balance : parseInt(u.balance, 10) || 0;
  if (balance < amount) return null;

  u.balance = balance - amount;
  u.updatedAt = new Date().toISOString();
  await saveUsers(users);
  return u.balance;
}

/** 退费 */
export async function refundBalance(machineId, amount) {
  const users = await loadUsers();
  const u = users[machineId];
  if (!u) return;
  const balance = typeof u.balance === 'number' ? u.balance : parseInt(u.balance, 10) || 0;
  u.balance = balance + amount;
  u.updatedAt = new Date().toISOString();
  await saveUsers(users);
}
