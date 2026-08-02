/**
 * NEXFLOW 正式版 Tablestore 适配器
 * nx_users（PK user_id）| nx_transactions（PK transaction_id，可用 OTS_TRANSACTIONS_PK 覆盖）| nx_tasks（PK task_id）
 * nx_email_user（PK email → user_id）邮箱登录查表
 */
import { createRequire } from 'module';
import crypto from 'crypto';
import {
  calcRechargeYuanbao,
  findRechargePackage,
  RECHARGE_TIERS_CNY,
} from '../pricing/recharge_packages.mjs';

const require = createRequire(import.meta.url);
const TableStore = require('tablestore');
/** 与 tablestore 相同依赖：属性列 INTEGER 必须写 Int64LE，否则 JS number 会被序列化为 VT_DOUBLE */
const Int64buf = require('int64-buffer');
const NX_CONTROL_REGION = String(process.env.NX_CONTROL_REGION || 'hk').trim().toLowerCase();

/** 须与 Tablestore 控制台实例地域一致（香港示例）：https://{实例名}.cn-hongkong.ots.aliyuncs.com */
const OTS_ENDPOINT = process.env.OTS_ENDPOINT?.trim() || '';
/** 与 FC 环境变量一致：优先 OTS_INSTANCE，未设时读 OTS_INST_NAME（控制台常见命名） */
const OTS_INSTANCE = process.env.OTS_INSTANCE?.trim() || process.env.OTS_INST_NAME?.trim() || '';

if (!OTS_ENDPOINT || !OTS_INSTANCE) {
  throw new Error('OTS_ENDPOINT 或 Tablestore 实例名（OTS_INSTANCE / OTS_INST_NAME）未配置');
}

const USERS_TABLE = (process.env.OTS_TABLE_USERS || 'nx_users').toLowerCase();
const TX_TABLE = (process.env.OTS_TABLE_TRANSACTIONS || 'nx_transactions').toLowerCase();
/** nx_transactions 主键列名（控制台为 transaction_id；旧表若为 tx_id 可设 OTS_TRANSACTIONS_PK=tx_id） */
const TX_PK = (process.env.OTS_TRANSACTIONS_PK || 'transaction_id').trim();
const TASKS_TABLE = (process.env.OTS_TABLE_TASKS || 'nx_tasks').toLowerCase();
/** 全局二级索引名：账单按 user_id 查（GetRange 时 tableName 须为索引名，见阿里云「使用 Node.js SDK 读取二级索引」） */
const TX_GSI_NAME = (process.env.OTS_TX_GSI_NAME || 'idx_user_id').trim();
/** 任务历史按 user_id 查 */
const TASKS_GSI_NAME = (process.env.OTS_TASKS_GSI_NAME || 'idx_user_tasks').trim();
/**
 * 索引表联合主键中「数据表主键」列名：nx_transactions 主键列（与 OTS_TRANSACTIONS_PK 一致）
 * 若控制台索引第二列不是 transaction_id，请设 OTS_TX_GSI_SK
 */
const TX_GSI_SK = (process.env.OTS_TX_GSI_SORT_KEY || TX_PK).trim();
const TASKS_GSI_SK = (process.env.OTS_TASKS_GSI_SORT_KEY || 'task_id').trim();
const EMAIL_TABLE = (process.env.OTS_TABLE_EMAIL || 'nx_email_user').toLowerCase();
/** 兑换码表：主键 code（STRING）；属性 amount_cny、used、used_by_user_id、used_at、created_at、issued_for_user_id（可选） */
const COUPONS_TABLE = (process.env.OTS_TABLE_COUPONS || 'nx_coupons').toLowerCase();
/** 模型定价表：主键 model_id（STRING）；与 sync_to_tablestore / Streamlit 后台一致 */
const MODEL_CONFIG_TABLE = (process.env.OTS_TABLE_MODEL_CONFIG || 'nx_model_config').toLowerCase();
/** 邮箱验证码：主键 email（STRING）；属性 code、expires_at(ms)、created_at(ms)，均为短时行 */
const VERIFY_CODES_TABLE = (process.env.OTS_TABLE_VERIFY_CODES || 'nx_verify_codes').toLowerCase();
/** 支付宝订单：主键 out_trade_no（STRING）；属性 user_id、package_id、amount_cny、yuanbao、status、trade_no、created_at、paid_at */
const ORDERS_TABLE = (process.env.OTS_TABLE_ORDERS || 'nx_orders').toLowerCase();
/** 预入账队列（异步 FC 执行器）：主键 out_trade_no；status queued|processing|settled|failed */
const PENDING_SETTLEMENT_TABLE = (process.env.OTS_TABLE_PENDING_SETTLEMENT || 'nx_pending_settlement').toLowerCase();
/** @deprecated 使用 nx_pending_settlement */
const RETRY_TABLE = PENDING_SETTLEMENT_TABLE;
/** 资金一致性异常日志：主键 log_id */
const REPAIR_LOG_TABLE = (process.env.OTS_TABLE_REPAIR_LOG || 'nx_repair_log').toLowerCase();

/** @param {string} value */
function txPrimaryKey(value) {
  return [{ [TX_PK]: value }];
}

/** 供 FC 日志核对：表名是否与控制台一致（不含密钥） */
export function getOtsConfigSummary() {
  return {
    endpointSet: Boolean(OTS_ENDPOINT),
    instanceSet: Boolean(OTS_INSTANCE),
    akSet: Boolean(process.env.OTS_ACCESS_KEY_ID?.trim() && process.env.OTS_ACCESS_KEY_SECRET?.trim()),
    gsi: {
      transactionsByUser: TX_GSI_NAME,
      tasksByUser: TASKS_GSI_NAME,
    },
    tables: {
      users: USERS_TABLE,
      emailIndex: EMAIL_TABLE,
      transactions: TX_TABLE,
      tasks: TASKS_TABLE,
      coupons: COUPONS_TABLE,
      modelConfig: MODEL_CONFIG_TABLE,
      verifyCodes: VERIFY_CODES_TABLE,
      orders: ORDERS_TABLE,
      pendingSettlement: PENDING_SETTLEMENT_TABLE,
      rechargeRetry: PENDING_SETTLEMENT_TABLE,
      repairLog: REPAIR_LOG_TABLE,
    },
    primaryKeysExpected: {
      [USERS_TABLE]: ['user_id (STRING)'],
      [EMAIL_TABLE]: ['email (STRING)'],
      [TX_TABLE]: [`${TX_PK} (STRING)`],
      [TASKS_TABLE]: ['task_id (STRING)'],
      [COUPONS_TABLE]: ['code (STRING)'],
      [MODEL_CONFIG_TABLE]: ['model_id (STRING)'],
      [VERIFY_CODES_TABLE]: ['email (STRING)'],
      [ORDERS_TABLE]: ['out_trade_no (STRING)'],
      [PENDING_SETTLEMENT_TABLE]: ['out_trade_no (STRING)'],
      [REPAIR_LOG_TABLE]: ['log_id (STRING)'],
    },
  };
}

const INITIAL_BALANCE = parseInt(process.env.NX_INITIAL_BALANCE || '10', 10) || 10;

/** 1 元人民币兑换元宝：充值优先 NX_YUANBAO_PER_CNY，未设则与扣费共用 NX_BILLING_YUANBAO_PER_CNY，默认 10 */
function resolveRechargeYuanbaoPerCny() {
  const pick = (key) => {
    const raw = process.env[key];
    if (raw == null || String(raw).trim() === '') return NaN;
    const n = parseFloat(String(raw));
    return Number.isFinite(n) && n > 0 ? n : NaN;
  };
  return pick('NX_YUANBAO_PER_CNY') || pick('NX_BILLING_YUANBAO_PER_CNY') || 10;
}

/**
 * 逻辑上把金额规范为整数（元宝）。
 */
function toTxIntegerAmount(n) {
  const x = Number(n);
  if (!Number.isFinite(x)) return 0;
  return Math.round(x);
}

/**
 * 写入 INTEGER 属性列：SDK 对 number 固定写 VT_DOUBLE（plain_buffer_coded_stream.writeColumnValue），
 * 须使用 Int64LE 才会写 VT_INTEGER（与 TableStore.Long.fromNumber 底层一致）。
 * @param {number} n 已为整数的逻辑值（可负，如扣费流水）
 */
function txInt64(n) {
  return new Int64buf.Int64LE(toTxIntegerAmount(n));
}

/** created_at 等 INTEGER 时间戳列统一写 Int64，杜绝 VT_STRING/VT_DOUBLE */
function txTsInt64(v, fallbackMs = Date.now()) {
  const n = Number(v);
  if (Number.isFinite(n) && n > 0) return new Int64buf.Int64LE(Math.round(n));
  const p = Date.parse(String(v || ''));
  if (Number.isFinite(p) && p > 0) return new Int64buf.Int64LE(Math.round(p));
  return new Int64buf.Int64LE(Math.round(fallbackMs));
}

function checkWriteSafety(region, operation = 'write') {
  const r = String(region || '').trim().toLowerCase();
  const op = String(operation || '').trim().toLowerCase();
  if (r === 'be' && op === 'write') {
    throw new Error('[Sentinel] 北京冷备仅允许只读，已拦截写入请求。');
  }
}

function getClient() {
  const client = new TableStore.Client({
    accessKeyId: process.env.OTS_ACCESS_KEY_ID,
    secretAccessKey: process.env.OTS_ACCESS_KEY_SECRET,
    endpoint: OTS_ENDPOINT,
    instancename: OTS_INSTANCE,
  });
  const wrapWrite = (name) => {
    if (!client || typeof client[name] !== 'function') return;
    const original = client[name].bind(client);
    client[name] = (...args) => {
      checkWriteSafety(NX_CONTROL_REGION, 'write');
      return original(...args);
    };
  };
  wrapWrite('putRow');
  wrapWrite('updateRow');
  wrapWrite('deleteRow');
  wrapWrite('batchWriteRow');
  return client;
}

/** 将 getRange/getRow 返回的属性列转为对象（兼容 columnName / name，便于读 GSI 投影列如 amount、type） */
function attrsToObj(attributes) {
  if (!attributes || !Array.isArray(attributes)) return {};
  const obj = {};
  attributes.forEach((a) => {
    if (!a || typeof a !== 'object') return;
    const key = a.columnName || a.name;
    if (!key) return;
    const raw = a.columnValue !== undefined ? a.columnValue : a.value;
    obj[key] = raw?.toString?.() ?? raw;
  });
  return obj;
}

/** 从 getRange 返回的 primaryKey 数组中按列名取主键值（OTS 可能为 { name, value }） */
function pkColumnValue(pkList, ...names) {
  if (!Array.isArray(pkList)) return '';
  const want = new Set(names.filter(Boolean));
  for (const pk of pkList) {
    if (!pk || typeof pk !== 'object') continue;
    const col = pk.name ?? pk.columnName;
    if (!want.has(col)) continue;
    const v = pk.value;
    if (v !== undefined && v !== null) return String(v);
  }
  return '';
}

function idemTxId(userId, taskId) {
  const h = crypto.createHash('sha256').update(`${userId}|${taskId}`).digest('hex');
  return `idem_${h}`;
}

/** 会话版本：JWT payload.tv 须与此列一致；改密后递增则旧 access/refresh 一律拒绝 */
function parseTokenVersion(attrs) {
  const n = parseInt(String(attrs.token_version ?? '0'), 10);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

/** 按 user_id 读用户 */
export async function getUserById(userId) {
  const client = getClient();
  const res = await client.getRow({
    tableName: USERS_TABLE,
    primaryKey: [{ user_id: userId }],
  });
  const row = res.row;
  if (!row?.attributes?.length) return null;
  const attrs = attrsToObj(row.attributes);
  return {
    userId: userId,
    email: attrs.email || '',
    passwordHash: attrs.password_hash || '',
    balance: parseInt(attrs.balance, 10) || 0,
    createdAt: attrs.created_at || null,
    lastLoginAt: attrs.last_login_at || null,
    status: attrs.status || 'normal',
    tokenVersion: parseTokenVersion(attrs),
    lifetimeRechargeYuanbao: parseInt(String(attrs.lifetime_recharge_yuanbao ?? '0'), 10) || 0,
    isFirstRecharge:
      attrs.is_first_recharge === undefined ||
      attrs.is_first_recharge === null ||
      (attrs.is_first_recharge !== 'false' && attrs.is_first_recharge !== '0'),
  };
}

function isFirstRechargeColumn(u) {
  return u.isFirstRecharge ? 'true' : 'false';
}

/**
 * 全量写入 nx_users 属性列（OTS putRow 覆盖属性，须每次带上 token_version）
 * @param {{ email: string; passwordHash: string; balance: number; createdAt: unknown; lastLoginAt: unknown; status: string; isFirstRecharge: boolean; tokenVersion?: number }} user
 * @param {{ email?: string; passwordHash?: string; balance?: number; lastLoginAt?: string; status?: string; isFirstRecharge?: boolean; tokenVersion?: number; nowMs?: number }} [patch]
 */
function buildUserPutColumns(user, patch = {}) {
  const nowMs = patch.nowMs !== undefined ? patch.nowMs : Date.now();
  const email = patch.email !== undefined ? patch.email : user.email;
  const passwordHash = patch.passwordHash !== undefined ? patch.passwordHash : user.passwordHash;
  const balance = patch.balance !== undefined ? patch.balance : user.balance;
  const lastLoginAt = patch.lastLoginAt !== undefined ? patch.lastLoginAt : user.lastLoginAt || '';
  const status = patch.status !== undefined ? patch.status : user.status;
  let isFirstStr;
  if (patch.isFirstRecharge !== undefined) {
    isFirstStr = patch.isFirstRecharge ? 'true' : 'false';
  } else {
    isFirstStr = isFirstRechargeColumn(user);
  }
  const tokenVersion = patch.tokenVersion !== undefined ? patch.tokenVersion : user.tokenVersion ?? 0;
  const tv = Math.max(0, parseInt(String(tokenVersion), 10) || 0);
  const lifetimeRechargeYuanbao =
    patch.lifetimeRechargeYuanbao !== undefined
      ? toTxIntegerAmount(patch.lifetimeRechargeYuanbao)
      : toTxIntegerAmount(user.lifetimeRechargeYuanbao ?? 0);
  return [
    { email },
    { password_hash: passwordHash },
    { balance: txInt64(balance) },
    { created_at: txTsInt64(user.createdAt, nowMs) },
    { last_login_at: lastLoginAt },
    { status },
    { is_first_recharge: isFirstStr },
    { token_version: txInt64(tv) },
    { lifetime_recharge_yuanbao: txInt64(lifetimeRechargeYuanbao) },
  ];
}

/** 按邮箱查 user_id，再读 users */
export async function getUserByEmail(email) {
  const normalized = String(email || '').trim().toLowerCase();
  if (!normalized) return null;
  const client = getClient();
  const er = await client.getRow({
    tableName: EMAIL_TABLE,
    primaryKey: [{ email: normalized }],
  });
  if (!er.row?.attributes?.length) return null;
  const attrs = attrsToObj(er.row.attributes);
  const uid = attrs.user_id;
  if (!uid) return null;
  return getUserById(uid);
}

/**
 * 注册：写入 users + email 索引
 */
export async function createUser({ userId, email, passwordHash }) {
  const normalized = String(email).trim().toLowerCase();
  const now = new Date().toISOString();
  const nowMs = Date.now();
  const client = getClient();

  try {
    await client.putRow({
      tableName: USERS_TABLE,
      condition: new TableStore.Condition(TableStore.RowExistenceExpectation.EXPECT_NOT_EXIST, null),
      primaryKey: [{ user_id: userId }],
      attributeColumns: [
        { email: normalized },
        { password_hash: passwordHash },
        { balance: txInt64(INITIAL_BALANCE) },
        { created_at: txTsInt64(nowMs) },
        { last_login_at: '' },
        { status: 'normal' },
        { is_first_recharge: 'true' },
        { token_version: txInt64(0) },
      ],
    });
  } catch (e) {
    console.error('[createUser] putRow nx_users failed', {
      table: USERS_TABLE,
      pk: 'user_id',
      code: e?.code,
      message: e?.message,
    });
    throw e;
  }

  try {
    await client.putRow({
      tableName: EMAIL_TABLE,
      condition: new TableStore.Condition(TableStore.RowExistenceExpectation.EXPECT_NOT_EXIST, null),
      primaryKey: [{ email: normalized }],
      attributeColumns: [{ user_id: userId }],
    });
  } catch (e) {
    console.error('[createUser] putRow nx_email_user failed', {
      table: EMAIL_TABLE,
      pk: 'email',
      code: e?.code,
      message: e?.message,
    });
    try {
      await client.deleteRow({
        tableName: USERS_TABLE,
        condition: new TableStore.Condition(TableStore.RowExistenceExpectation.EXPECT_EXIST, null),
        primaryKey: [{ user_id: userId }],
      });
    } catch (_) {}
    throw e;
  }

  const welcomeTxId = `welcome_${userId}`;
  try {
    await client.putRow({
      tableName: TX_TABLE,
      condition: new TableStore.Condition(TableStore.RowExistenceExpectation.IGNORE, null),
      primaryKey: txPrimaryKey(welcomeTxId),
      attributeColumns: [
        { user_id: userId },
        { task_id: 'welcome' },
        { amount: txInt64(INITIAL_BALANCE) },
        { type: 'welcome_bonus' },
        { provider: 'system' },
        { description: '新手礼包' },
        { created_at: txTsInt64(nowMs) },
        { balance_after: txInt64(INITIAL_BALANCE) },
      ],
    });
  } catch (e) {
    console.error('[createUser] welcome_bonus tx failed', welcomeTxId, e?.message);
  }

  return getUserById(userId);
}

/**
 * 验证码注册：无密码（password_hash 空串），仅允许 POST /auth/login 邮箱验证码登录。
 * created_at / 流水时间戳均为 INTEGER（毫秒）。
 */
export async function createUserOtpOnly({ userId, email }) {
  const normalized = String(email).trim().toLowerCase();
  const nowMs = Date.now();
  const client = getClient();

  try {
    await client.putRow({
      tableName: USERS_TABLE,
      condition: new TableStore.Condition(TableStore.RowExistenceExpectation.EXPECT_NOT_EXIST, null),
      primaryKey: [{ user_id: userId }],
      attributeColumns: [
        { email: normalized },
        { password_hash: '' },
        { balance: txInt64(INITIAL_BALANCE) },
        { created_at: txTsInt64(nowMs) },
        { last_login_at: '' },
        { status: 'normal' },
        { is_first_recharge: 'true' },
        { token_version: txInt64(0) },
      ],
    });
  } catch (e) {
    console.error('[createUserOtpOnly] putRow nx_users failed', e?.code, e?.message);
    throw e;
  }

  try {
    await client.putRow({
      tableName: EMAIL_TABLE,
      condition: new TableStore.Condition(TableStore.RowExistenceExpectation.EXPECT_NOT_EXIST, null),
      primaryKey: [{ email: normalized }],
      attributeColumns: [{ user_id: userId }],
    });
  } catch (e) {
    console.error('[createUserOtpOnly] putRow nx_email_user failed', e?.code, e?.message);
    try {
      await client.deleteRow({
        tableName: USERS_TABLE,
        condition: new TableStore.Condition(TableStore.RowExistenceExpectation.EXPECT_EXIST, null),
        primaryKey: [{ user_id: userId }],
      });
    } catch (_) {}
    throw e;
  }

  const welcomeTxId = `welcome_${userId}`;
  try {
    await client.putRow({
      tableName: TX_TABLE,
      condition: new TableStore.Condition(TableStore.RowExistenceExpectation.IGNORE, null),
      primaryKey: txPrimaryKey(welcomeTxId),
      attributeColumns: [
        { user_id: userId },
        { task_id: 'welcome' },
        { amount: txInt64(INITIAL_BALANCE) },
        { type: 'welcome_bonus' },
        { provider: 'system' },
        { description: '新手礼包' },
        { created_at: txTsInt64(nowMs) },
        { balance_after: txInt64(INITIAL_BALANCE) },
      ],
    });
  } catch (e) {
    console.error('[createUserOtpOnly] welcome_bonus tx failed', welcomeTxId, e?.message);
  }

  return getUserById(userId);
}

function parseSendRateTs(raw) {
  if (raw == null || raw === '') return [];
  try {
    const j = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (!Array.isArray(j)) return [];
    return j.map((x) => Number(x)).filter((n) => Number.isFinite(n) && n > 0);
  } catch {
    return [];
  }
}

/** 写入或覆盖该邮箱的验证码行；sendRateTs 为发信时间戳列表（JSON），用于跨实例频率限制 */
export async function upsertVerifyCode(email, code, expiresAtMs, sendRateTs) {
  const normalized = String(email || '').trim().toLowerCase();
  if (!normalized || !code) throw new Error('VERIFY_CODE_PARAMS');
  const nowMs = Date.now();
  const client = getClient();
  const rateList = Array.isArray(sendRateTs) ? sendRateTs : [];
  await client.putRow({
    tableName: VERIFY_CODES_TABLE,
    condition: new TableStore.Condition(TableStore.RowExistenceExpectation.IGNORE, null),
    primaryKey: [{ email: normalized }],
    attributeColumns: [
      { code: String(code).trim() },
      { expires_at: txTsInt64(expiresAtMs, nowMs) },
      { created_at: txTsInt64(nowMs) },
      { send_rate_ts: JSON.stringify(rateList.slice(-80)) },
    ],
  });
}

export async function getVerifyCodeRow(email) {
  const normalized = String(email || '').trim().toLowerCase();
  if (!normalized) return null;
  const client = getClient();
  const res = await client.getRow({
    tableName: VERIFY_CODES_TABLE,
    primaryKey: [{ email: normalized }],
  });
  if (!res.row?.attributes?.length) return null;
  const attrs = attrsToObj(res.row.attributes);
  return {
    email: normalized,
    code: String(attrs.code || '').trim(),
    expires_at: Number(attrs.expires_at) || 0,
    created_at: Number(attrs.created_at) || 0,
    sendRateTs: parseSendRateTs(attrs.send_rate_ts),
  };
}

/** 邮件发送失败时清空验证码但保留 send_rate_ts，避免刷接口又留下可用验证码 */
export async function clearVerifyCodeKeepRate(email) {
  const normalized = String(email || '').trim().toLowerCase();
  if (!normalized) return;
  const row = await getVerifyCodeRow(email);
  if (!row) return;
  const client = getClient();
  const nowMs = Date.now();
  await client.putRow({
    tableName: VERIFY_CODES_TABLE,
    condition: new TableStore.Condition(TableStore.RowExistenceExpectation.IGNORE, null),
    primaryKey: [{ email: normalized }],
    attributeColumns: [
      { code: '' },
      { expires_at: txTsInt64(0, nowMs) },
      { created_at: txTsInt64(nowMs) },
      { send_rate_ts: JSON.stringify((row.sendRateTs || []).slice(-80)) },
    ],
  });
}

export async function deleteVerifyCode(email) {
  const normalized = String(email || '').trim().toLowerCase();
  if (!normalized) return;
  const client = getClient();
  try {
    await client.deleteRow({
      tableName: VERIFY_CODES_TABLE,
      condition: new TableStore.Condition(TableStore.RowExistenceExpectation.IGNORE, null),
      primaryKey: [{ email: normalized }],
    });
  } catch (e) {
    console.warn('[deleteVerifyCode]', normalized, e?.message);
  }
}

export async function updateUserLastLogin(userId) {
  const u = await getUserById(userId);
  if (!u) return;
  const now = new Date().toISOString();
  const nowMs = Date.now();
  const client = getClient();
  await client.putRow({
    tableName: USERS_TABLE,
    condition: new TableStore.Condition(TableStore.RowExistenceExpectation.EXPECT_EXIST, null),
    primaryKey: [{ user_id: userId }],
    attributeColumns: buildUserPutColumns(u, { lastLoginAt: now, nowMs }),
  });
}

/**
 * 按邮箱更新密码哈希（验证码流程通过后调用；无密码账号可由此设置首密）。
 */
export async function updateUserPasswordByEmail(normalizedEmail, passwordHash) {
  const emailNorm = String(normalizedEmail || '')
    .trim()
    .toLowerCase();
  if (!emailNorm) throw new Error('EMAIL_REQUIRED');
  const u = await getUserByEmail(emailNorm);
  if (!u) throw new Error('USER_NOT_FOUND');
  const nowMs = Date.now();
  const nextTv = (u.tokenVersion ?? 0) + 1;
  const client = getClient();
  await client.putRow({
    tableName: USERS_TABLE,
    condition: new TableStore.Condition(TableStore.RowExistenceExpectation.EXPECT_EXIST, null),
    primaryKey: [{ user_id: u.userId }],
    attributeColumns: buildUserPutColumns(u, {
      passwordHash,
      tokenVersion: nextTv,
      nowMs,
    }),
  });
}


/** 允许的充值档位（人民币元）；与 recharge_packages.mjs、兑换码 amount_cny 一致 */
export { RECHARGE_TIERS_CNY };

const ORDER_STATUS_PENDING = 'pending';
const ORDER_STATUS_PROCESSING = 'processing';
const ORDER_STATUS_PAID = 'paid';
const ORDER_STATUS_FAILED = 'failed';
const ORDER_STATUS_REFUNDED = 'refunded';
const ORDER_AMOUNT_EPS = 0.011;
const RETRY_INTERVAL_MS = 30_000;

/** 结构化结算日志（log_type + user_id + out_trade_no + timestamp） */
export function settlementLog(logType, fields = {}) {
  const payload = {
    log_type: String(logType || 'settlement'),
    ts: Date.now(),
    ...fields,
  };
  try {
    console.log(JSON.stringify(payload));
  } catch (_) {
    console.log('[settlement]', logType, fields);
  }
}

function alipayInternalTxId(outTradeNo, userId) {
  const h = crypto.createHash('sha256').update(`${outTradeNo}|${userId}`, 'utf8').digest('hex').slice(0, 32);
  return `alipay_${h}`;
}

function alipayTradeTxId(tradeNo) {
  const tn = String(tradeNo || '').trim();
  if (!tn) return '';
  const h = crypto.createHash('sha256').update(`trade|${tn}`, 'utf8').digest('hex').slice(0, 24);
  return `alipay_trade_${h}`;
}

const SETTLEMENT_STATUS_QUEUED = 'queued';
const SETTLEMENT_STATUS_PROCESSING = 'processing';
const SETTLEMENT_STATUS_SETTLED = 'settled';
const SETTLEMENT_STATUS_FAILED = 'failed';

function parseOrderRow(key, attrs) {
  return {
    out_trade_no: key,
    user_id: String(attrs.user_id || ''),
    package_id: String(attrs.package_id || ''),
    amount_cny: Number(attrs.amount_cny),
    yuanbao: parseInt(String(attrs.yuanbao ?? '0'), 10) || 0,
    status: String(attrs.status || ''),
    trade_no: String(attrs.trade_no || ''),
    created_at: attrs.created_at,
    paid_at: attrs.paid_at,
    processed_at: attrs.processed_at,
  };
}

function parsePendingSettlementRow(key, attrs) {
  return {
    out_trade_no: key,
    user_id: String(attrs.user_id || ''),
    trade_no: String(attrs.trade_no || ''),
    amount_cny: Number(attrs.amount_cny),
    status: String(attrs.status || ''),
    retry_count: parseInt(String(attrs.retry_count ?? '0'), 10) || 0,
    next_retry_at: attrs.next_retry_at,
    last_error: String(attrs.last_error || ''),
    created_at: attrs.created_at,
    settled_at: attrs.settled_at,
  };
}

/** notify 可 ack success：已 paid 或 processing（锁） */
function orderAckSuccess(order) {
  return (
    order &&
    (order.status === ORDER_STATUS_PAID || order.status === ORDER_STATUS_PROCESSING)
  );
}

export async function getPendingSettlement(outTradeNo) {
  const key = String(outTradeNo ?? '').trim();
  if (!key) return null;
  const res = await getClient().getRow({
    tableName: PENDING_SETTLEMENT_TABLE,
    primaryKey: [{ out_trade_no: key }],
  });
  if (!res.row?.attributes?.length) return null;
  return parsePendingSettlementRow(key, attrsToObj(res.row.attributes));
}

async function upsertPendingSettlementQueued(outTradeNo, order, tradeNo, errorMsg = '') {
  const key = String(outTradeNo ?? '').trim();
  const client = getClient();
  const nowMs = Date.now();
  let retryCount = 0;
  try {
    const exist = await client.getRow({
      tableName: PENDING_SETTLEMENT_TABLE,
      primaryKey: [{ out_trade_no: key }],
    });
    if (exist.row?.attributes?.length) {
      retryCount = parseInt(String(attrsToObj(exist.row.attributes).retry_count ?? '0'), 10) || 0;
    }
  } catch (_) {
    /* ignore */
  }
  await client.putRow({
    tableName: PENDING_SETTLEMENT_TABLE,
    condition: new TableStore.Condition(TableStore.RowExistenceExpectation.IGNORE, null),
    primaryKey: [{ out_trade_no: key }],
    attributeColumns: [
      { user_id: order.user_id },
      { trade_no: String(tradeNo || order.trade_no || '') },
      { amount_cny: String(order.amount_cny) },
      { status: SETTLEMENT_STATUS_QUEUED },
      { retry_count: txInt64(errorMsg ? retryCount + 1 : retryCount) },
      { next_retry_at: txTsInt64(nowMs) },
      { last_error: String(errorMsg || '').slice(0, 500) },
      { created_at: txTsInt64(nowMs) },
      { settled_at: txInt64(0) },
    ],
  });
  settlementLog('pending_settlement_queued', {
    out_trade_no: key,
    user_id: order.user_id,
    retry_count: errorMsg ? retryCount + 1 : retryCount,
  });
}

async function markPendingSettlementStatus(outTradeNo, status, extra = {}) {
  const row = await getPendingSettlement(outTradeNo);
  if (!row) return;
  const nowMs = Date.now();
  await getClient().putRow({
    tableName: PENDING_SETTLEMENT_TABLE,
    condition: new TableStore.Condition(TableStore.RowExistenceExpectation.EXPECT_EXIST, null),
    primaryKey: [{ out_trade_no: outTradeNo }],
    attributeColumns: [
      { user_id: row.user_id },
      { trade_no: row.trade_no },
      { amount_cny: String(row.amount_cny) },
      { status },
      { retry_count: txInt64(row.retry_count) },
      { next_retry_at: txTsInt64(extra.next_retry_at ?? row.next_retry_at, nowMs) },
      { last_error: String(extra.last_error ?? row.last_error ?? '').slice(0, 500) },
      { created_at: txTsInt64(row.created_at, nowMs) },
      { settled_at: txTsInt64(status === SETTLEMENT_STATUS_SETTLED ? nowMs : 0) },
    ],
  });
}

/**
 * 高成本模型安全阈值：单次扣费不得超过累计充值元宝 × MODEL_COST_THRESHOLD_RATIO（默认 0.6）
 */
export function assertModelCostThreshold(user, cost, taskType = '') {
  const ratioRaw = parseFloat(process.env.MODEL_COST_THRESHOLD_RATIO || '0.6');
  const ratio = Number.isFinite(ratioRaw) && ratioRaw > 0 && ratioRaw <= 1 ? ratioRaw : 0.6;
  const highMin = parseInt(process.env.MODEL_HIGH_COST_YUANBAO_MIN || '20', 10);
  const amt = toTxIntegerAmount(cost);
  if (amt < highMin) return;
  const lifetime = toTxIntegerAmount(user?.lifetimeRechargeYuanbao ?? 0);
  if (lifetime <= 0) return;
  const cap = Math.floor(lifetime * ratio);
  if (amt > cap) {
    const err = new Error(
      `MODEL_COST_THRESHOLD_EXCEEDED: cost=${amt} cap=${cap} lifetime=${lifetime} task=${taskType || 'unknown'}`,
    );
    err.nxStatusCode = 403;
    err.nxErrorCode = 'MODEL_COST_THRESHOLD_EXCEEDED';
    throw err;
  }
}

/**
 * 创建支付宝 pending 订单（out_trade_no 主键唯一，EXPECT_NOT_EXIST 防重复）
 */
export async function createAlipayOrderRecord(input) {
  const userId = String(input?.userId ?? '').trim();
  const packageId = String(input?.packageId ?? '').trim();
  const outTradeNo = String(input?.outTradeNo ?? '').trim();
  const amountCny = Number(input?.amountCny);
  const packageYuanbao = toTxIntegerAmount(input?.packageYuanbao);
  if (!userId || !packageId || !outTradeNo) throw new Error('ORDER_FIELDS_REQUIRED');
  if (!findRechargePackage(amountCny)) throw new Error('INVALID_RECHARGE_TIER');

  const user = await getUserById(userId);
  if (!user) throw new Error('USER_NOT_FOUND');
  if (user.status === 'frozen') throw new Error('USER_FROZEN');

  const nowMs = Date.now();
  const client = getClient();
  await client.putRow({
    tableName: ORDERS_TABLE,
    condition: new TableStore.Condition(TableStore.RowExistenceExpectation.EXPECT_NOT_EXIST, null),
    primaryKey: [{ out_trade_no: outTradeNo }],
    attributeColumns: [
      { user_id: userId },
      { package_id: packageId },
      { amount_cny: String(amountCny) },
      { yuanbao: txInt64(packageYuanbao) },
      { status: ORDER_STATUS_PENDING },
      { trade_no: '' },
      { created_at: txTsInt64(nowMs) },
      { paid_at: txInt64(0) },
      { processed_at: txInt64(0) },
    ],
  });

  settlementLog('order_created', { user_id: userId, out_trade_no: outTradeNo, package_id: packageId });

  return {
    out_trade_no: outTradeNo,
    user_id: userId,
    package_id: packageId,
    amount_cny: amountCny,
    yuanbao: packageYuanbao,
    status: ORDER_STATUS_PENDING,
  };
}

/** @param {string} outTradeNo */
export async function getAlipayOrder(outTradeNo) {
  const key = String(outTradeNo ?? '').trim();
  if (!key) return null;
  const client = getClient();
  const res = await client.getRow({
    tableName: ORDERS_TABLE,
    primaryKey: [{ out_trade_no: key }],
  });
  if (!res.row?.attributes?.length) return null;
  return parseOrderRow(key, attrsToObj(res.row.attributes));
}

async function tryAcquireOrderProcessingLock(outTradeNo, tradeNo = '') {
  const order = await getAlipayOrder(outTradeNo);
  if (!order) return { acquired: false, order: null };
  if (orderAckSuccess(order)) return { acquired: false, order };

  if (order.status !== ORDER_STATUS_PENDING) {
    return { acquired: false, order };
  }

  const client = getClient();
  const nowMs = Date.now();
  try {
    await client.putRow({
      tableName: ORDERS_TABLE,
      condition: new TableStore.Condition(
        TableStore.RowExistenceExpectation.EXPECT_EXIST,
        new TableStore.SingleColumnCondition('status', ORDER_STATUS_PENDING, TableStore.ComparatorType.EQUAL),
      ),
      primaryKey: [{ out_trade_no: outTradeNo }],
      attributeColumns: [
        { user_id: order.user_id },
        { package_id: order.package_id },
        { amount_cny: String(order.amount_cny) },
        { yuanbao: txInt64(order.yuanbao) },
        { status: ORDER_STATUS_PROCESSING },
        { trade_no: String(tradeNo || order.trade_no || '') },
        { created_at: txTsInt64(order.created_at, nowMs) },
        { paid_at: txInt64(0) },
        { processed_at: txInt64(0) },
      ],
    });
    settlementLog('order_lock_acquired', { out_trade_no: outTradeNo, user_id: order.user_id });
    return {
      acquired: true,
      order: { ...order, status: ORDER_STATUS_PROCESSING },
    };
  } catch (e) {
    const again = await getAlipayOrder(outTradeNo);
    return { acquired: false, order: again };
  }
}

async function releaseOrderProcessingLock(outTradeNo, targetStatus = ORDER_STATUS_PENDING) {
  const order = await getAlipayOrder(outTradeNo);
  if (!order) return;
  const client = getClient();
  const nowMs = Date.now();
  await client.putRow({
    tableName: ORDERS_TABLE,
    condition: new TableStore.Condition(TableStore.RowExistenceExpectation.EXPECT_EXIST, null),
    primaryKey: [{ out_trade_no: outTradeNo }],
    attributeColumns: [
      { user_id: order.user_id },
      { package_id: order.package_id },
      { amount_cny: String(order.amount_cny) },
      { yuanbao: txInt64(order.yuanbao) },
      { status: targetStatus },
      { trade_no: String(order.trade_no || '') },
      { created_at: txTsInt64(order.created_at, nowMs) },
      { paid_at: txInt64(order.paid_at || 0) },
      { processed_at: txInt64(0) },
    ],
  });
}

async function markAlipayOrderPaid(outTradeNo, order, tradeNo, rechargeResult) {
  const client = getClient();
  const paidMs = Date.now();
  const settledYuanbao = toTxIntegerAmount(rechargeResult.total_yuanbao ?? 0);
  await client.putRow({
    tableName: ORDERS_TABLE,
    condition: new TableStore.Condition(
      TableStore.RowExistenceExpectation.EXPECT_EXIST,
      new TableStore.SingleColumnCondition('status', ORDER_STATUS_PROCESSING, TableStore.ComparatorType.EQUAL),
    ),
    primaryKey: [{ out_trade_no: outTradeNo }],
    attributeColumns: [
      { user_id: order.user_id },
      { package_id: order.package_id },
      { amount_cny: String(order.amount_cny) },
      { yuanbao: txInt64(settledYuanbao || order.yuanbao) },
      { status: ORDER_STATUS_PAID },
      { trade_no: String(tradeNo || order.trade_no || '') },
      { created_at: txTsInt64(order.created_at, paidMs) },
      { paid_at: txTsInt64(paidMs) },
      { processed_at: txTsInt64(paidMs) },
    ],
  });
}

/**
 * 异步执行器：对 queued 预入账执行 rechargeWithLedger → 订单 paid + settlement settled
 */
export async function executePendingSettlement(outTradeNo) {
  const key = String(outTradeNo ?? '').trim();
  if (!key) throw new Error('OUT_TRADE_NO_REQUIRED');

  const pending = await getPendingSettlement(key);
  const order = await getAlipayOrder(key);
  if (!order) throw new Error('ORDER_NOT_FOUND');
  if (order.status === ORDER_STATUS_PAID) {
    if (pending && pending.status !== SETTLEMENT_STATUS_SETTLED) {
      await markPendingSettlementStatus(key, SETTLEMENT_STATUS_SETTLED);
    }
    const u = await getUserById(order.user_id);
    return { already_paid: true, out_trade_no: key, balance: u?.balance ?? 0, order };
  }
  if (!pending || pending.status === SETTLEMENT_STATUS_SETTLED) {
    throw new Error('PENDING_SETTLEMENT_NOT_QUEUED');
  }
  if (pending.status !== SETTLEMENT_STATUS_QUEUED) {
    return { skipped: true, out_trade_no: key, settlement_status: pending.status };
  }

  await markPendingSettlementStatus(key, SETTLEMENT_STATUS_PROCESSING);
  settlementLog('fc_request_sent', { out_trade_no: key, user_id: order.user_id });

  try {
    const rechargeResult = await rechargeWithLedger(order.user_id, order.amount_cny, {
      outTradeNo: key,
      source: 'alipay',
      alipayTradeNo: pending.trade_no || order.trade_no,
    });
    await markAlipayOrderPaid(key, order, pending.trade_no || order.trade_no, rechargeResult);
    await markPendingSettlementStatus(key, SETTLEMENT_STATUS_SETTLED);
    settlementLog('fc_success', {
      out_trade_no: key,
      user_id: order.user_id,
      balance: rechargeResult.balance,
      total_yuanbao: rechargeResult.total_yuanbao,
    });
    settlementLog('balance_updated', { out_trade_no: key, user_id: order.user_id, balance: rechargeResult.balance });
    return {
      ...rechargeResult,
      settled: true,
      out_trade_no: key,
      settlement_status: SETTLEMENT_STATUS_SETTLED,
      order: { ...order, status: ORDER_STATUS_PAID },
    };
  } catch (e) {
    settlementLog('fc_fail', { out_trade_no: key, user_id: order.user_id, error: e?.message || String(e) });
    const nowMs = Date.now();
    await markPendingSettlementStatus(key, SETTLEMENT_STATUS_QUEUED, {
      next_retry_at: nowMs + RETRY_INTERVAL_MS,
      last_error: e?.message || 'EXECUTE_FAILED',
    });
    throw e;
  }
}

/** @deprecated 兼容旧名 */
export async function enqueueRechargeRetry(outTradeNo, tradeNo, errorMsg) {
  const order = await getAlipayOrder(outTradeNo);
  if (!order) return;
  await upsertPendingSettlementQueued(outTradeNo, order, tradeNo, errorMsg);
}

export async function removeRechargeRetry(outTradeNo) {
  await markPendingSettlementStatus(outTradeNo, SETTLEMENT_STATUS_SETTLED).catch(() => {});
}

/** 扫描 nx_pending_settlement(queued) 异步执行 FC 入账 */
export async function processPendingSettlementQueue({ maxItems = 20 } = {}) {
  const client = getClient();
  const nowMs = Date.now();
  const res = await client.getRange({
    tableName: PENDING_SETTLEMENT_TABLE,
    direction: TableStore.Direction.FORWARD,
    inclusiveStartPrimaryKey: [{ out_trade_no: TableStore.INF_MIN }],
    exclusiveEndPrimaryKey: [{ out_trade_no: TableStore.INF_MAX }],
    limit: Math.min(200, Math.max(1, maxItems * 3)),
  });

  let processed = 0;
  let succeeded = 0;
  const details = [];

  for (const row of res.rows || []) {
    if (processed >= maxItems) break;
    const key = pkColumnValue(row.primaryKey, 'out_trade_no');
    if (!key) continue;
    const attrs = attrsToObj(row.attributes);
    if (String(attrs.status || '') !== SETTLEMENT_STATUS_QUEUED) continue;
    const nextAt = parseInt(String(attrs.next_retry_at ?? '0'), 10) || 0;
    if (nextAt > nowMs) continue;

    processed += 1;
    try {
      const r = await executePendingSettlement(key);
      succeeded += 1;
      details.push({
        out_trade_no: key,
        ok: true,
        balance: r.balance,
        user_id: r.order?.user_id || attrs.user_id,
        event: 'recharge-settled',
      });
    } catch (e) {
      details.push({ out_trade_no: key, ok: false, error: e?.message || 'EXECUTE_FAILED' });
    }
  }

  settlementLog('pending_batch_done', { processed, succeeded });
  return { processed, succeeded, details };
}

/** @deprecated 兼容 */
export const processRechargeRetryQueue = processPendingSettlementQueue;

/** paid 订单须有 alipay 流水；异常写入 nx_repair_log */
export async function runBalanceConsistencyCheck({ maxScan = 200 } = {}) {
  const client = getClient();
  const res = await client.getRange({
    tableName: ORDERS_TABLE,
    direction: TableStore.Direction.FORWARD,
    inclusiveStartPrimaryKey: [{ out_trade_no: TableStore.INF_MIN }],
    exclusiveEndPrimaryKey: [{ out_trade_no: TableStore.INF_MAX }],
    limit: Math.min(500, Math.max(10, maxScan)),
  });
  const anomalies = [];
  let checked = 0;

  for (const row of res.rows || []) {
    const outTradeNo = pkColumnValue(row.primaryKey, 'out_trade_no');
    if (!outTradeNo) continue;
    const order = parseOrderRow(outTradeNo, attrsToObj(row.attributes));
    if (order.status !== ORDER_STATUS_PAID) continue;
    checked += 1;

    const txId = alipayInternalTxId(outTradeNo, order.user_id);
    let txOk = false;
    try {
      const tx = await client.getRow({ tableName: TX_TABLE, primaryKey: txPrimaryKey(txId) });
      txOk = Boolean(tx.row?.attributes?.length);
    } catch (_) {
      txOk = false;
    }

    const user = await getUserById(order.user_id);
    if (!txOk || !user) {
      const logId = `repair_${crypto.randomUUID()}`;
      const msg = !txOk ? 'MISSING_RECHARGE_TX' : 'USER_NOT_FOUND';
      anomalies.push({ out_trade_no: outTradeNo, user_id: order.user_id, anomaly: msg });
      await client.putRow({
        tableName: REPAIR_LOG_TABLE,
        condition: new TableStore.Condition(TableStore.RowExistenceExpectation.EXPECT_NOT_EXIST, null),
        primaryKey: [{ log_id: logId }],
        attributeColumns: [
          { out_trade_no: outTradeNo },
          { user_id: order.user_id },
          { anomaly: msg },
          { order_status: order.status },
          { user_balance: txInt64(user?.balance ?? 0) },
          { created_at: txTsInt64(Date.now()) },
        ],
      });
      settlementLog('consistency_anomaly', { out_trade_no: outTradeNo, user_id: order.user_id, anomaly: msg });
    }
  }

  return { checked, anomaly_count: anomalies.length, anomalies };
}

/**
 * notify 验签后：订单 pending→processing + 写入 nx_pending_settlement(queued)，立即 ack（FC 异步执行）
 */
export async function settleAlipayOrder(outTradeNo, tradeNo, notifyAmountCny) {
  const key = String(outTradeNo ?? '').trim();
  if (!key) throw new Error('OUT_TRADE_NO_REQUIRED');

  settlementLog('notify_enqueue_start', { out_trade_no: key, trade_no: tradeNo });

  const order = await getAlipayOrder(key);
  if (!order) throw new Error('ORDER_NOT_FOUND');

  if (order.status === ORDER_STATUS_PAID) {
    const u = await getUserById(order.user_id);
    settlementLog('notify_already_paid', { out_trade_no: key, user_id: order.user_id });
    return {
      already_paid: true,
      should_ack_success: true,
      out_trade_no: key,
      balance: u?.balance ?? 0,
      order,
    };
  }

  if (order.status === ORDER_STATUS_PROCESSING) {
    settlementLog('notify_already_processing', { out_trade_no: key, user_id: order.user_id });
    return {
      already_processing: true,
      should_ack_success: true,
      out_trade_no: key,
      order,
      settlement_status: SETTLEMENT_STATUS_QUEUED,
    };
  }

  if (order.status !== ORDER_STATUS_PENDING) {
    throw new Error('ORDER_INVALID_STATUS');
  }

  const paidAmount = Number(notifyAmountCny);
  if (!Number.isFinite(paidAmount) || Math.abs(paidAmount - order.amount_cny) > ORDER_AMOUNT_EPS) {
    throw new Error('ORDER_AMOUNT_MISMATCH');
  }

  const lock = await tryAcquireOrderProcessingLock(key, tradeNo);
  if (!lock.acquired) {
    if (orderAckSuccess(lock.order)) {
      return {
        already_paid: lock.order?.status === ORDER_STATUS_PAID,
        already_processing: lock.order?.status === ORDER_STATUS_PROCESSING,
        should_ack_success: true,
        out_trade_no: key,
        order: lock.order,
      };
    }
    throw new Error('ORDER_LOCK_FAILED');
  }

  await upsertPendingSettlementQueued(key, lock.order || order, tradeNo);
  settlementLog('pending_settlement_created', { out_trade_no: key, user_id: order.user_id, status: SETTLEMENT_STATUS_QUEUED });

  return {
    enqueued: true,
    should_ack_success: true,
    out_trade_no: key,
    user_id: order.user_id,
    order: { ...order, status: ORDER_STATUS_PROCESSING },
    settlement_status: SETTLEMENT_STATUS_QUEUED,
    event: 'settlement-queued',
  };
}

/** notify 入队后立即尝试一次异步执行（失败仍保持 queued） */
export async function settleAlipayOrderAndExecute(outTradeNo, tradeNo, notifyAmountCny) {
  const enq = await settleAlipayOrder(outTradeNo, tradeNo, notifyAmountCny);
  if (enq.enqueued) {
    try {
      const exec = await executePendingSettlement(outTradeNo);
      return { ...enq, ...exec, executed: true };
    } catch (e) {
      settlementLog('notify_execute_deferred', { out_trade_no: outTradeNo, error: e?.message });
      return { ...enq, executed: false, execute_error: e?.message };
    }
  }
  return enq;
}

/**
 * 充值入账（需业务侧已校验支付成功后再调）。
 * 套餐元宝见 pricing/recharge_packages.mjs（基础 + 套餐固定赠送）。
 * @param {string} userId
 * @param {number} amountCny 50|100|300|1000
 * @param {{ couponCode?: string, outTradeNo?: string, source?: string, alipayTradeNo?: string }} [opts]
 */
export async function rechargeWithLedger(userId, amountCny, opts = {}) {
  const couponCode = typeof opts.couponCode === 'string' && opts.couponCode.trim() ? opts.couponCode.trim() : '';
  const outTradeNo = typeof opts.outTradeNo === 'string' && opts.outTradeNo.trim() ? opts.outTradeNo.trim() : '';
  const source = typeof opts.source === 'string' && opts.source.trim() ? opts.source.trim() : '';
  const alipayTradeNo = typeof opts.alipayTradeNo === 'string' && opts.alipayTradeNo.trim() ? opts.alipayTradeNo.trim() : '';
  const pkg = findRechargePackage(amountCny);
  if (!pkg) {
    throw new Error('INVALID_RECHARGE_TIER');
  }
  const tier = pkg.priceCny;

  const user = await getUserById(userId);
  if (!user) throw new Error('USER_NOT_FOUND');
  if (user.status === 'frozen') throw new Error('USER_FROZEN');

  const calc = calcRechargeYuanbao(tier, { couponCode });
  const baseYuanbao = calc.packageYuanbao;
  const bonusYuanbao = calc.bonusYuanbao ?? 0;
  const total = toTxIntegerAmount(calc.totalYuanbao);
  const client = getClient();
  const txId =
    outTradeNo && userId ? alipayInternalTxId(outTradeNo, userId) : outTradeNo ? `alipay_${outTradeNo}` : `recharge_${crypto.randomUUID()}`;

  const tradeTxId = alipayTradeTxId(alipayTradeNo);
  for (const id of [tradeTxId, txId].filter(Boolean)) {
    try {
      const exist = await client.getRow({ tableName: TX_TABLE, primaryKey: txPrimaryKey(id) });
      if (exist.row?.attributes?.length) {
        const attrs = attrsToObj(exist.row.attributes);
        const after = parseInt(String(attrs.balance_after ?? ''), 10);
        const fresh = await getUserById(userId);
        settlementLog('recharge_idempotent', { user_id: userId, out_trade_no: outTradeNo, tx_id: id });
        return {
          balance: fresh?.balance ?? (Number.isFinite(after) ? after : user.balance),
          tx_id: id,
          internal_tx_id: txId,
          amount_cny: tier,
          base_yuanbao: baseYuanbao,
          bonus_yuanbao: bonusYuanbao,
          total_yuanbao: total,
          first_recharge_used: bonusYuanbao > 0,
          is_first_recharge: user.isFirstRecharge,
          idempotent: true,
          out_trade_no: outTradeNo,
          alipay_trade_no: alipayTradeNo,
        };
      }
    } catch (e) {
      settlementLog('recharge_idempotency_check_skip', { tx_id: id, error: e?.message });
    }
  }

  const newBalance = toTxIntegerAmount(user.balance + total);
  const nextLifetimeRecharge = toTxIntegerAmount((user.lifetimeRechargeYuanbao ?? 0) + total);
  const nowMs = Date.now();
  const alipayNote = outTradeNo ? `·订单${outTradeNo}` : '';
  const description = couponCode
    ? `兑换码 ${couponCode}（${tier}元·${baseYuanbao}元宝）`
    : bonusYuanbao > 0
      ? `充值${tier}元·${pkg.label}（${baseYuanbao}元宝+赠送${bonusYuanbao}元宝）${alipayNote}`
      : `充值${tier}元·${pkg.label}（${baseYuanbao}元宝）${alipayNote}`;
  const providerTx = couponCode ? 'coupon' : source === 'alipay' ? 'alipay' : 'recharge';

  const nextIsFirstRechargeCol = isFirstRechargeColumn(user);

  await client.putRow({
    tableName: USERS_TABLE,
    condition: new TableStore.Condition(TableStore.RowExistenceExpectation.EXPECT_EXIST, null),
    primaryKey: [{ user_id: userId }],
    attributeColumns: buildUserPutColumns(user, {
      balance: newBalance,
      isFirstRecharge: nextIsFirstRechargeCol === 'true',
      lifetimeRechargeYuanbao: nextLifetimeRecharge,
      nowMs,
    }),
  });

  const txColumns = [
    { user_id: userId },
    { task_id: outTradeNo ? `alipay:${outTradeNo}` : 'recharge' },
    { amount: txInt64(total) },
    { type: 'recharge' },
    { provider: providerTx },
    { description },
    { created_at: txTsInt64(nowMs) },
    { balance_after: txInt64(newBalance) },
    { internal_tx_id: txId },
    ...(outTradeNo ? [{ out_trade_no: outTradeNo }] : []),
    ...(alipayTradeNo ? [{ alipay_trade_no: alipayTradeNo }] : []),
  ];

  try {
    await client.putRow({
      tableName: TX_TABLE,
      condition: new TableStore.Condition(TableStore.RowExistenceExpectation.EXPECT_NOT_EXIST, null),
      primaryKey: txPrimaryKey(txId),
      attributeColumns: txColumns,
    });
    if (tradeTxId && tradeTxId !== txId) {
      await client.putRow({
        tableName: TX_TABLE,
        condition: new TableStore.Condition(TableStore.RowExistenceExpectation.EXPECT_NOT_EXIST, null),
        primaryKey: txPrimaryKey(tradeTxId),
        attributeColumns: [
          { user_id: userId },
          { task_id: outTradeNo ? `alipay:${outTradeNo}` : 'recharge' },
          { amount: txInt64(0) },
          { type: 'alipay_trade_ref' },
          { provider: providerTx },
          { description: `支付宝 trade_no 幂等锚点${alipayNote}` },
          { created_at: txTsInt64(nowMs) },
          { balance_after: txInt64(newBalance) },
          { internal_tx_id: txId },
          { out_trade_no: outTradeNo },
          { alipay_trade_no: alipayTradeNo },
          { note: 'alipay_trade_idempotency' },
        ],
      }).catch(() => {
        /* 主 tx 已写入即可 */
      });
    }
  } catch (e) {
    console.error('[rechargeWithLedger] tx failed, rolling back balance', e?.message);
    await client.putRow({
      tableName: USERS_TABLE,
      condition: new TableStore.Condition(TableStore.RowExistenceExpectation.EXPECT_EXIST, null),
      primaryKey: [{ user_id: userId }],
      attributeColumns: buildUserPutColumns(user, { nowMs }),
    });
    throw e;
  }

  return {
    balance: newBalance,
    tx_id: txId,
    internal_tx_id: txId,
    amount_cny: tier,
    base_yuanbao: baseYuanbao,
    bonus_yuanbao: bonusYuanbao,
    total_yuanbao: total,
    first_recharge_used: bonusYuanbao > 0,
    is_first_recharge: nextIsFirstRechargeCol === 'true',
    ...(outTradeNo ? { out_trade_no: outTradeNo, source: source || 'alipay', alipay_trade_no: alipayTradeNo } : {}),
  };
}

/**
 * 兑换码：校验 nx_coupons 后调用 rechargeWithLedger，再将券标为已用。
 * 表行示例：PK code=「NX…」；amount_cny=30|50|…（须为合法档位）；used=false 或 0
 * @param {string} userId
 * @param {string} rawCode
 */
export async function redeemCouponWithLedger(userId, rawCode) {
  const code = String(rawCode || '')
    .trim()
    .toUpperCase();
  if (!code) throw new Error('COUPON_CODE_REQUIRED');

  const client = getClient();
  const res = await client.getRow({
    tableName: COUPONS_TABLE,
    primaryKey: [{ code }],
  });
  if (!res.row?.attributes?.length) throw new Error('COUPON_INVALID');

  const attrs = attrsToObj(res.row.attributes);
  const usedRaw = attrs.used;
  if (usedRaw === 'true' || usedRaw === '1' || usedRaw === 1) throw new Error('COUPON_USED');

  const tierRaw = attrs.amount_cny ?? attrs.amountCny ?? '';
  const tier = Number(String(tierRaw).trim());
  if (!findRechargePackage(tier)) {
    throw new Error('COUPON_MISCONFIGURED');
  }

  const r = await rechargeWithLedger(userId, tier, { couponCode: code });
  const now = new Date().toISOString();
  const nowMs = Date.now();
  try {
    await client.putRow({
      tableName: COUPONS_TABLE,
      condition: new TableStore.Condition(TableStore.RowExistenceExpectation.EXPECT_EXIST, null),
      primaryKey: [{ code }],
      attributeColumns: [
        { amount_cny: String(tier) },
        { used: 'true' },
        { used_by_user_id: userId },
        { used_at: now },
        ...(attrs.issued_for_user_id != null && String(attrs.issued_for_user_id).trim()
          ? [{ issued_for_user_id: String(attrs.issued_for_user_id).trim() }]
          : []),
        ...(attrs.created_at ? [{ created_at: txTsInt64(attrs.created_at, nowMs) }] : [{ created_at: txTsInt64(nowMs) }]),
      ],
    });
  } catch (e) {
    console.error('[redeemCouponWithLedger] 标记录用失败（用户已入账，请人工核对券）', code, e?.message || e);
  }

  return { ...r, coupon_code: code };
}

const COUPON_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function randomCouponCode() {
  let s = 'NX';
  for (let i = 0; i < 10; i += 1) {
    const idx = crypto.randomInt(0, COUPON_CODE_ALPHABET.length);
    s += COUPON_CODE_ALPHABET[idx];
  }
  return s;
}

/**
 * 后台签发兑换码：写入 nx_coupons（需 FC 管理密钥调用 internal/issue-coupon）
 * @param {number} amountCny 30|50|100|200|500
 * @returns {{ code: string, amount_cny: number }}
 */
export async function issueCouponCode(amountCny) {
  const tier = Number(amountCny);
  if (!findRechargePackage(tier)) {
    throw new Error('INVALID_COUPON_TIER');
  }
  const client = getClient();
  const nowMs = Date.now();
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const code = randomCouponCode();
    try {
      await client.putRow({
        tableName: COUPONS_TABLE,
        condition: new TableStore.Condition(TableStore.RowExistenceExpectation.EXPECT_NOT_EXIST, null),
        primaryKey: [{ code }],
        attributeColumns: [
          { amount_cny: String(tier) },
          { used: 'false' },
          { created_at: txTsInt64(nowMs) },
        ],
      });
      return { code, amount_cny: tier };
    } catch (e) {
      const msg = String(e?.message || e?.code || '');
      if (msg.includes('Condition') || e?.code === 'ConditionCheckFail') {
        continue;
      }
      throw e;
    }
  }
  throw new Error('COUPON_CODE_GENERATION_FAILED');
}

/**
 * 扣费（幂等）：transactions 主键（transaction_id）= idem_ 哈希
 */
export async function deductWithTransaction(userId, taskId, amount, meta = {}) {
  const { provider = 'bltcy', description = '' } = meta;
  const cfg = { USERS_TABLE, TX_TABLE };
  const client = getClient();
  const txKey = idemTxId(userId, taskId);
  const now = new Date().toISOString();
  const nowMs = Date.now();
  const amt = toTxIntegerAmount(amount);
  if (amt < 1) throw new Error('INVALID_AMOUNT');

  try {
    const exist = await client.getRow({
      tableName: TX_TABLE,
      primaryKey: txPrimaryKey(txKey),
    });
    if (exist.row?.attributes?.length) {
      const attrs = attrsToObj(exist.row.attributes);
      if (attrs.type === 'consume' || attrs.type === 'consume_pending') {
        const u = await getUserById(userId);
        const after = parseInt(attrs.balance_after, 10);
        return { balance: u?.balance ?? (Number.isFinite(after) ? after : 0), idempotent: true };
      }
    }
  } catch (e) {
    console.log('[db] deductWithTransaction GetRow idem:', e?.message);
  }

  const user = await getUserById(userId);
  if (!user) throw new Error('USER_NOT_FOUND');
  if (user.status === 'frozen') throw new Error('USER_FROZEN');
  if (user.balance < amt) throw new Error('BALANCE_INSUFFICIENT');

  try {
    await client.putRow({
      tableName: TX_TABLE,
      condition: new TableStore.Condition(TableStore.RowExistenceExpectation.EXPECT_NOT_EXIST, null),
      primaryKey: txPrimaryKey(txKey),
      attributeColumns: [
        { user_id: userId },
        { task_id: taskId },
        { amount: txInt64(-amt) },
        { type: 'consume_pending' },
        { provider },
        { description },
        { created_at: txTsInt64(nowMs) },
        { balance_after: txInt64(0) },
      ],
    });
  } catch (e) {
    if (e.code === 'ConditionCheckFail' || String(e.message || '').includes('Condition')) {
      const u2 = await getUserById(userId);
      return { balance: u2?.balance ?? 0, idempotent: true };
    }
    throw e;
  }

  const newBalance = toTxIntegerAmount(user.balance - amt);
  try {
    await client.putRow({
      tableName: USERS_TABLE,
      condition: new TableStore.Condition(TableStore.RowExistenceExpectation.EXPECT_EXIST, null),
      primaryKey: [{ user_id: userId }],
      attributeColumns: buildUserPutColumns(user, { balance: newBalance, nowMs }),
    });
  } catch (e) {
    try {
      await client.deleteRow({
        tableName: TX_TABLE,
        condition: new TableStore.Condition(TableStore.RowExistenceExpectation.EXPECT_EXIST, null),
        primaryKey: txPrimaryKey(txKey),
      });
    } catch (_) {}
    throw e;
  }

  await client.putRow({
    tableName: TX_TABLE,
    condition: new TableStore.Condition(TableStore.RowExistenceExpectation.EXPECT_EXIST, null),
    primaryKey: txPrimaryKey(txKey),
    attributeColumns: [
      { user_id: userId },
      { task_id: taskId },
      { amount: txInt64(-amt) },
      { type: 'consume' },
      { provider },
      { description },
      { created_at: txTsInt64(nowMs) },
      { balance_after: txInt64(newBalance) },
    ],
  });

  return { balance: newBalance, idempotent: false };
}

export async function refundWithLedger(userId, taskId, amount, meta = {}) {
  const { provider = 'bltcy', description = 'refund' } = meta;
  const client = getClient();
  const refundTxId = `refund_${idemTxId(userId, taskId)}`;
  const amt = toTxIntegerAmount(amount);
  if (amt < 1) return;
  try {
    const existRefund = await client.getRow({
      tableName: TX_TABLE,
      primaryKey: txPrimaryKey(refundTxId),
    });
    if (existRefund.row?.attributes?.length) {
      const u = await getUserById(userId);
      return { balance: u?.balance ?? 0, idempotent: true };
    }
  } catch (_) {}
  const user = await getUserById(userId);
  if (!user) return;
  const newBalance = toTxIntegerAmount(user.balance + amt);
  const now = new Date().toISOString();
  const nowMs = Date.now();

  await client.putRow({
    tableName: USERS_TABLE,
    condition: new TableStore.Condition(TableStore.RowExistenceExpectation.EXPECT_EXIST, null),
    primaryKey: [{ user_id: userId }],
    attributeColumns: buildUserPutColumns(user, { balance: newBalance, nowMs }),
  });

  try {
    await client.putRow({
      tableName: TX_TABLE,
      condition: new TableStore.Condition(TableStore.RowExistenceExpectation.IGNORE, null),
      primaryKey: txPrimaryKey(refundTxId),
      attributeColumns: [
        { user_id: userId },
        { task_id: taskId },
        { amount: txInt64(amt) },
        { type: 'REFUND' },
        { provider },
        { description },
        { created_at: txTsInt64(nowMs) },
        { balance_after: txInt64(newBalance) },
      ],
    });
  } catch (e) {
    console.error('[db] refund tx 写入失败:', e?.stack ?? e);
  }
  const uOut = await getUserById(userId);
  return { balance: uOut?.balance ?? newBalance, idempotent: false };
}

/**
 * 按 run-task 扣费幂等键退回元宝：仅当存在 type=consume 的流水且尚未退款时入账。
 * @returns {{ balance: number, refunded: boolean, idempotent?: boolean, reason?: string }}
 */
export async function refundConsumedTask(userId, taskId, meta = {}) {
  const client = getClient();
  const txKey = idemTxId(userId, taskId);
  const refundTxId = `refund_${txKey}`;
  try {
    const existRefund = await client.getRow({
      tableName: TX_TABLE,
      primaryKey: txPrimaryKey(refundTxId),
    });
    if (existRefund.row?.attributes?.length) {
      const u = await getUserById(userId);
      return { balance: u?.balance ?? 0, refunded: false, idempotent: true };
    }
  } catch (_) {}

  const row = await client.getRow({
    tableName: TX_TABLE,
    primaryKey: txPrimaryKey(txKey),
  });
  if (!row.row?.attributes?.length) {
    const u = await getUserById(userId);
    return { balance: u?.balance ?? 0, refunded: false, reason: 'no_consume_row' };
  }
  const attrs = attrsToObj(row.row.attributes);
  if (attrs.type !== 'consume') {
    const u = await getUserById(userId);
    return { balance: u?.balance ?? 0, refunded: false, reason: 'not_consume' };
  }
  const amount = Math.abs(toTxIntegerAmount(attrs.amount));
  if (amount <= 0) {
    const u = await getUserById(userId);
    return { balance: u?.balance ?? 0, refunded: false, reason: 'zero_amount' };
  }
  await refundWithLedger(userId, taskId, amount, meta);
  const u = await getUserById(userId);
  return { balance: u?.balance ?? 0, refunded: true, idempotent: false };
}

/** @param {Record<string, unknown>} params */
function getRangePromise(client, params) {
  return new Promise((resolve, reject) => {
    client.getRange(params, (err, data) => {
      if (err) reject(err);
      else resolve(data || {});
    });
  });
}

/**
 * 在全局二级索引上范围读。
 * 注意：tableName 必须为「索引名」（如 idx_user_id），禁止传数据表名 nx_transactions。
 * @see https://help.aliyun.com/zh/tablestore/developer-reference/read-data-using-a-secondary-index-by-suing-nodejs-sdk
 */
async function getRangeOnGlobalIndex(
  indexName,
  inclusiveStart,
  exclusiveEnd,
  pageLimit,
  direction = TableStore.Direction.FORWARD,
) {
  const client = getClient();
  return getRangePromise(client, {
    tableName: indexName,
    direction,
    inclusiveStartPrimaryKey: inclusiveStart,
    exclusiveEndPrimaryKey: exclusiveEnd,
    limit: pageLimit,
  });
}

/** @param {import('tablestore').PrimaryKey} row */
function gsiRowToTxListItem(row) {
  const attrs = attrsToObj(row.attributes);
  const pkList = row.primaryKey || [];
  const txId =
    pkColumnValue(pkList, TX_PK, TX_GSI_SK, 'transaction_id') ||
    (pkList[1] && typeof pkList[1] === 'object' && pkList[1].value !== undefined ? String(pkList[1].value) : '');
  if (!txId) return null;
  return {
    tx_id: txId,
    user_id: attrs.user_id,
    task_id: attrs.task_id,
    amount: attrs.amount,
    type: attrs.type,
    provider: attrs.provider,
    description: attrs.description,
    created_at: attrs.created_at,
    balance_after: attrs.balance_after,
  };
}

function txTimeMs(v) {
  const n = Number(v);
  if (Number.isFinite(n) && n > 0) return n < 1e12 ? Math.round(n * 1000) : Math.round(n);
  const p = Date.parse(String(v || ''));
  return Number.isFinite(p) ? p : 0;
}

function isConsumeTxType(type) {
  const t = String(type || '').toLowerCase();
  return t === 'consume' || t === 'consume_pending';
}

/**
 * 在 idx_user_id 上按 transaction_id 前缀范围分页读（左闭右开）。
 * @param {string} userId
 * @param {string} skLow
 * @param {string} skHighExclusive
 * @param {number} maxRows
 * @param {number} [direction]
 */
async function listGsiTxRangeForUser(userId, skLow, skHighExclusive, maxRows, direction = TableStore.Direction.FORWARD) {
  const uid = String(userId || '');
  if (!uid || maxRows < 1) return [];

  const skCol = TX_GSI_SK;
  const isBackward = direction === TableStore.Direction.BACKWARD;
  const collected = [];
  let nextStart = isBackward
    ? [{ user_id: uid }, { [skCol]: skHighExclusive }]
    : [{ user_id: uid }, { [skCol]: skLow }];
  const fixedEnd = isBackward
    ? [{ user_id: uid }, { [skCol]: skLow }]
    : [{ user_id: uid }, { [skCol]: skHighExclusive }];
  let safety = 0;

  while (collected.length < maxRows && safety < 50) {
    safety += 1;
    const res = await getRangeOnGlobalIndex(
      TX_GSI_NAME,
      nextStart,
      fixedEnd,
      Math.min(100, Math.max(maxRows - collected.length, 20)),
      direction,
    );
    for (const row of res.rows || []) {
      const item = gsiRowToTxListItem(row);
      if (item) collected.push(item);
    }
    const nextPk = res.next_start_primary_key || res.nextStartPrimaryKey;
    if (!nextPk) break;
    nextStart = nextPk;
  }
  return collected.slice(0, maxRows);
}

/** 索引投影已够用时跳过回表 */
function txRowNeedsHydrate(row) {
  if (!row?.tx_id) return false;
  const missing = (v) => v == null || v === '';
  return (
    missing(row.created_at) ||
    missing(row.amount) ||
    missing(row.type) ||
    missing(row.balance_after) ||
    missing(row.description)
  );
}

/** 索引投影缺列时回 nx_transactions 主表补全（仅缺字段的行；并发拉取） */
async function hydrateTransactionRows(collected) {
  const client = getClient();
  const indices = [];
  for (let i = 0; i < collected.length; i++) {
    if (txRowNeedsHydrate(collected[i])) indices.push(i);
  }
  if (indices.length === 0) return;

  const CONCURRENCY = 12;
  let cursor = 0;
  async function worker() {
    while (cursor < indices.length) {
      const idx = indices[cursor++];
      const row = collected[idx];
      if (!row?.tx_id) continue;
      try {
        const gr = await client.getRow({
          tableName: TX_TABLE,
          primaryKey: txPrimaryKey(row.tx_id),
        });
        if (!gr.row?.attributes?.length) continue;
        const full = attrsToObj(gr.row.attributes);
        collected[idx] = {
          tx_id: row.tx_id,
          user_id: full.user_id ?? row.user_id,
          task_id: full.task_id ?? row.task_id,
          amount: full.amount ?? row.amount,
          type: full.type ?? row.type,
          provider: full.provider ?? row.provider,
          description: full.description ?? row.description,
          created_at: full.created_at ?? row.created_at,
          balance_after: full.balance_after ?? row.balance_after,
        };
      } catch (e) {
        console.warn('[hydrateTransactionRows]', row.tx_id, e?.message || e);
      }
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, indices.length) }, () => worker()),
  );
}

/** 任务记录 */
/**
 * 列出某用户最近流水（GSI idx_user_id，无全表扫描）。
 *
 * - 按 limit 收缩各前缀扫描量；只对缺字段行并发回表，避免数百次串行 getRow。
 * - 合并后保留少量非消费流水，再按时间取最近 limit 条。
 */
export async function listRecentTransactionsForUser(userId, limit = 20) {
  const uid = String(userId || '');
  if (!uid) return [];
  const lim = Math.min(50, Math.max(1, Number(limit) || 20));

  const consumeCap = Math.min(60, Math.max(lim * 2, lim + 5));
  const rechargeCap = Math.min(24, Math.max(8, lim));
  const refundCap = Math.min(16, Math.max(8, Math.ceil(lim / 2)));
  const welcomeCap = Math.min(8, 8);
  const adjustCap = Math.min(16, Math.max(8, Math.ceil(lim / 2)));

  const [adjustRows, rechargeRows, refundRows, welcomeRows, idemRows] = await Promise.all([
    listGsiTxRangeForUser(uid, 'adjust_', 'idem_', adjustCap, TableStore.Direction.FORWARD),
    listGsiTxRangeForUser(uid, 'recharge_', 'refund_', rechargeCap, TableStore.Direction.FORWARD),
    listGsiTxRangeForUser(uid, 'refund_', 'welcome_', refundCap, TableStore.Direction.FORWARD),
    listGsiTxRangeForUser(uid, 'welcome_', 'welcomf_', welcomeCap, TableStore.Direction.FORWARD),
    listGsiTxRangeForUser(uid, 'idem_', 'recharge_', consumeCap, TableStore.Direction.BACKWARD),
  ]);

  const byId = new Map();
  for (const row of [...adjustRows, ...rechargeRows, ...refundRows, ...welcomeRows, ...idemRows]) {
    if (row?.tx_id) byId.set(row.tx_id, row);
  }
  const collected = [...byId.values()];
  await hydrateTransactionRows(collected);
  collected.sort((a, b) => txTimeMs(b.created_at) - txTimeMs(a.created_at));

  const nonConsume = collected.filter((r) => !isConsumeTxType(r.type));
  const consume = collected.filter((r) => isConsumeTxType(r.type));

  const out = new Map();
  for (const row of nonConsume.slice(0, Math.min(12, lim))) out.set(row.tx_id, row);
  for (const row of consume) {
    out.set(row.tx_id, row);
    if (out.size >= lim) break;
  }
  for (const row of nonConsume) out.set(row.tx_id, row);

  return [...out.values()].sort((a, b) => txTimeMs(b.created_at) - txTimeMs(a.created_at)).slice(0, lim);
}

/**
 * 列出某用户最近任务记录：使用全局二级索引 idx_user_tasks（OTS_TASKS_GSI_NAME）。
 */
export async function listRecentTasksForUser(userId, limit = 20) {
  const uid = String(userId || '');
  if (!uid) return [];

  const collected = [];
  const fixedEnd = [{ user_id: uid }, { [TASKS_GSI_SK]: TableStore.INF_MAX }];
  let nextStart = [{ user_id: uid }, { [TASKS_GSI_SK]: TableStore.INF_MIN }];
  let safety = 0;

  while (collected.length < limit && safety < 100) {
    safety += 1;
    const res = await getRangeOnGlobalIndex(TASKS_GSI_NAME, nextStart, fixedEnd, Math.min(100, Math.max(limit * 2, 20)));

    const rows = res.rows || [];
    for (const row of rows) {
      const attrs = attrsToObj(row.attributes);
      const pkList = row.primaryKey || [];
      const taskId =
        pkColumnValue(pkList, 'task_id', TASKS_GSI_SK) ||
        (pkList[1] && typeof pkList[1] === 'object' && pkList[1].value !== undefined ? String(pkList[1].value) : '');
      collected.push({
        task_id: taskId,
        user_id: attrs.user_id,
        status: attrs.status,
        amount: attrs.amount,
        cost: attrs.cost,
        prompt_json: attrs.prompt_json,
        workflow_json: attrs.workflow_json,
        result_oss_url: attrs.result_oss_url,
        error_msg: attrs.error_msg,
        created_at: attrs.created_at,
        updated_at: attrs.updated_at,
      });
    }

    const nextPk = res.next_start_primary_key || res.nextStartPrimaryKey;
    if (!nextPk) break;
    nextStart = nextPk;
  }

  collected.sort(
    (a, b) =>
      toTaskTsMs(b.updated_at, toTaskTsMs(b.created_at, 0)) -
      toTaskTsMs(a.updated_at, toTaskTsMs(a.created_at, 0)),
  );
  return collected.slice(0, limit);
}

/** 长时间未完结、需定时结算的任务状态（含 FC 侧 PROCESSING 与业务侧 RUNNING） */
const STALE_TASK_STATUSES = new Set(['RUNNING', 'PROCESSING', 'PENDING', 'QUEUED']);

function toTaskTsMs(v, fallback = 0) {
  const n = Number(v);
  if (Number.isFinite(n) && n > 0) return Math.round(n);
  const t = Date.parse(String(v || ''));
  if (Number.isFinite(t) && t > 0) return t;
  return fallback;
}

function taskIdFromTaskRow(row) {
  const pkList = row?.primaryKey || [];
  const byName = pkColumnValue(pkList, 'task_id');
  if (byName) return byName;
  const p0 = pkList[0];
  if (p0 && typeof p0 === 'object' && p0.value !== undefined && p0.value !== null) return String(p0.value);
  return '';
}

/**
 * 在 nx_tasks 主表上分页扫描，筛选「未完成且超过 maxAgeMs 未更新」的任务（非全表无条件扫满：有 maxScanRows 上限）。
 * 说明：按 status=RUNNING 精确筛需 SearchIndex/状态索引；当前实现为范围读 + 内存过滤，与 idx_user_tasks 互补（idx 适合按用户拉历史，不适合全局按状态）。
 */
export async function listStaleTasksForSettlement({
  maxAgeMs = 3600000,
  maxTasks = 50,
  maxScanRows = 20000,
} = {}) {
  const client = getClient();
  const out = [];
  let nextStart = [{ task_id: TableStore.INF_MIN }];
  const endPK = [{ task_id: TableStore.INF_MAX }];
  let scanned = 0;

  while (out.length < maxTasks && scanned < maxScanRows) {
    const res = await getRangePromise(client, {
      tableName: TASKS_TABLE,
      direction: TableStore.Direction.FORWARD,
      inclusiveStartPrimaryKey: nextStart,
      exclusiveEndPrimaryKey: endPK,
      limit: 500,
    });
    const rows = res.rows || [];
    for (const row of rows) {
      if (scanned >= maxScanRows) break;
      scanned += 1;
      const attrs = attrsToObj(row.attributes);
      const stRaw = String(attrs.status || '');
      const st = stRaw.toUpperCase();
      if (!STALE_TASK_STATUSES.has(st)) continue;
      const updMs = toTaskTsMs(attrs.updated_at, toTaskTsMs(attrs.created_at, 0));
      if (updMs > Date.now() - maxAgeMs) continue;
      const taskId = taskIdFromTaskRow(row);
      const userId = String(attrs.user_id || '').trim();
      if (!taskId || !userId) continue;
      const cost = parseInt(String(attrs.cost ?? '0'), 10) || 0;
      out.push({ taskId, userId, status: st, cost });
      if (out.length >= maxTasks) break;
    }
    const nextPk = res.next_start_primary_key || res.nextStartPrimaryKey;
    if (!nextPk || out.length >= maxTasks) break;
    nextStart = nextPk;
  }
  return { tasks: out, scanned };
}

/**
 * 单条超时结算：幂等退款（存在 consume 流水时）+ 任务状态改为 TIMEOUT。
 */
export async function settleStaleTask(userId, taskId, costHint = 0) {
  const refundR = await refundConsumedTask(userId, taskId, {
    provider: 'settlement',
    description: 'stale_task_timeout',
  });
  await upsertTask(taskId, userId, {
    status: 'timeout',
    ...(costHint > 0 ? { cost: costHint } : {}),
  });
  const u = await getUserById(userId);
  return {
    balance: u?.balance ?? refundR.balance ?? 0,
    refunded: refundR.refunded === true,
    refundReason: refundR.reason,
  };
}

/**
 * 批量执行超时结算（供 Cron / POST /internal/settle-stale-tasks）。
 */
export async function runStaleTaskSettlement(opts = {}) {
  const maxAgeMs = Number.isFinite(opts.maxAgeMs) ? opts.maxAgeMs : parseInt(process.env.NX_STALE_TASK_MAX_AGE_MS || '3600000', 10) || 3600000;
  const maxTasks = Math.min(500, Math.max(1, opts.maxTasks ?? 50));
  const maxScanRows = Math.min(500000, Math.max(1000, opts.maxScanRows ?? 20000));

  const { tasks, scanned } = await listStaleTasksForSettlement({ maxAgeMs, maxTasks, maxScanRows });
  const results = [];
  for (const t of tasks) {
    try {
      const r = await settleStaleTask(t.userId, t.taskId, t.cost);
      results.push({ taskId: t.taskId, userId: t.userId, ok: true, ...r });
    } catch (e) {
      results.push({
        taskId: t.taskId,
        userId: t.userId,
        ok: false,
        error: e?.message || String(e),
      });
    }
  }
  return {
    maxAgeMs,
    maxTasks,
    maxScanRows,
    rowsScanned: scanned,
    candidateCount: tasks.length,
    results,
  };
}

/**
 * 读取 nx_tasks 一行并校验归属当前用户（供 POST /tasks/status）
 * @param {string} taskId
 * @param {string} userId
 */
export async function getTaskRowForUser(taskId, userId) {
  const tid = String(taskId || '').trim();
  const uid = String(userId || '').trim();
  if (!tid || !uid) return null;
  const client = getClient();
  const res = await client.getRow({
    tableName: TASKS_TABLE,
    primaryKey: [{ task_id: tid }],
  });
  if (!res.row?.attributes?.length) return null;
  const attrs = attrsToObj(res.row.attributes);
  if (String(attrs.user_id || '').trim() !== uid) return null;
  return {
    task_id: tid,
    user_id: attrs.user_id,
    status: attrs.status,
    amount: attrs.amount,
    cost: attrs.cost,
    prompt_json: attrs.prompt_json,
    workflow_json: attrs.workflow_json,
    result_oss_url: attrs.result_oss_url,
    error_msg: attrs.error_msg,
    created_at: attrs.created_at,
    updated_at: attrs.updated_at,
  };
}

export async function upsertTask(taskId, userId, patch) {
  const client = getClient();
  const nowMs = Date.now();
  const existing = await client.getRow({
    tableName: TASKS_TABLE,
    primaryKey: [{ task_id: taskId }],
  });
  const prev = existing.row?.attributes?.length ? attrsToObj(existing.row.attributes) : {};
  const prevCreatedMs = toTaskTsMs(prev.created_at, nowMs);
  const merged = {
    user_id: userId,
    status: String(patch.status ?? prev.status ?? 'running').toLowerCase(),
    cost: patch.cost != null ? patch.cost : parseInt(prev.cost, 10) || 0,
    amount:
      patch.amount != null
        ? patch.amount
        : patch.cost != null
          ? patch.cost
          : parseInt(prev.amount ?? prev.cost, 10) || 0,
    prompt_json: patch.prompt_json ?? prev.prompt_json ?? '',
    workflow_json: patch.workflow_json ?? prev.workflow_json ?? '',
    result_oss_url: patch.result_oss_url ?? prev.result_oss_url ?? '',
    error_msg: patch.error_msg ?? prev.error_msg ?? '',
    created_at: prevCreatedMs,
  };
  await client.putRow({
    tableName: TASKS_TABLE,
    condition: new TableStore.Condition(TableStore.RowExistenceExpectation.IGNORE, null),
    primaryKey: [{ task_id: taskId }],
    attributeColumns: [
      { user_id: merged.user_id },
      { status: merged.status },
      { amount: txInt64(merged.amount) },
      { cost: txInt64(merged.cost) },
      { prompt_json: merged.prompt_json },
      { workflow_json: merged.workflow_json },
      { result_oss_url: merged.result_oss_url },
      { error_msg: merged.error_msg },
      { created_at: txTsInt64(merged.created_at, nowMs) },
      { updated_at: txTsInt64(nowMs) },
    ],
  });
}

/** 读取 nx_model_config 属性列（列名大小写不一致时也能匹配，避免 multiplier 读不到被默认成 1） */
function modelConfigAttr(attrs, logicalName) {
  const want = String(logicalName).toLowerCase();
  if (!attrs || typeof attrs !== 'object') return undefined;
  for (const k of Object.keys(attrs)) {
    if (String(k).toLowerCase() === want) return attrs[k];
  }
  return undefined;
}

/**
 * 全表扫描 nx_model_config（主键 model_id），供客户端展示价与后台一致。
 * 表不存在或 OTS 错误时由调用方捕获。
 */
export async function listModelConfig() {
  const client = getClient();
  const collected = [];
  let nextStart = [{ model_id: TableStore.INF_MIN }];
  const endPK = [{ model_id: TableStore.INF_MAX }];
  let safety = 0;

  while (safety < 500) {
    safety += 1;
    const res = await new Promise((resolve, reject) => {
      client.getRange(
        {
          tableName: MODEL_CONFIG_TABLE,
          direction: TableStore.Direction.FORWARD,
          inclusiveStartPrimaryKey: nextStart,
          exclusiveEndPrimaryKey: endPK,
          limit: 500,
        },
        (err, data) => {
          if (err) reject(err);
          else resolve(data || {});
        },
      );
    });

    const rows = res.rows || [];
    for (const row of rows) {
      const attrs = attrsToObj(row.attributes);
      const pk0 = row.primaryKey && row.primaryKey[0];
      let modelId = '';
      if (pk0 && typeof pk0 === 'object') {
        modelId = String(
          pk0.value !== undefined ? pk0.value : pk0.model_id !== undefined ? pk0.model_id : '',
        );
      }
      if (!modelId) continue;

      const bp = parseFloat(modelConfigAttr(attrs, 'base_price'));
      const mul = parseFloat(modelConfigAttr(attrs, 'multiplier'));
      const yr = parseFloat(modelConfigAttr(attrs, 'yuanbao_rate'));
      const activeRaw = modelConfigAttr(attrs, 'is_active');
      const fnRaw = modelConfigAttr(attrs, 'function_name');
      const isActive =
        activeRaw === undefined || activeRaw === null || activeRaw === ''
          ? true
          : activeRaw === true || String(activeRaw).toLowerCase() === 'true';

      collected.push({
        model_id: modelId,
        function_name: fnRaw != null ? String(fnRaw) : '',
        is_active: isActive,
        base_price: Number.isFinite(bp) ? bp : 0,
        multiplier: Number.isFinite(mul) ? mul : 1,
        yuanbao_rate: Number.isFinite(yr) ? yr : 10,
      });
    }

    const nextPk = res.next_start_primary_key || res.nextStartPrimaryKey;
    if (!nextPk) break;
    nextStart = nextPk;
  }

  return collected;
}

/** 上海时区当日 0 点 ~ 当前时刻（毫秒） */
function getAsiaShanghaiDayBoundsMs() {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const parts = fmt.formatToParts(new Date());
  const y = parseInt(parts.find((p) => p.type === 'year')?.value || '0', 10);
  const m = parseInt(parts.find((p) => p.type === 'month')?.value || '0', 10);
  const d = parseInt(parts.find((p) => p.type === 'day')?.value || '0', 10);
  const start = Date.parse(
    `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}T00:00:00+08:00`,
  );
  return { start, end: Date.now(), dateLabel: `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}` };
}

function txCreatedMsFromAttrs(attrs) {
  const raw = attrs?.created_at;
  const n = Number(raw);
  if (Number.isFinite(n) && n > 0) return n < 1e12 ? Math.round(n * 1000) : Math.round(n);
  const p = Date.parse(String(raw || ''));
  return Number.isFinite(p) ? p : 0;
}

const FAILED_OPS_STATUSES = new Set(['failed', 'timeout', 'time_out']);

/**
 * 运营看板：今日充值类流水合计（type=recharge 或 redeem，上海自然日）+ 兑换码总行数 + 失败/超时任务数（有扫描上限）。
 */
export async function adminAggregateDashboardStats({
  maxTxScanRows = 80000,
  maxTaskScanRows = 40000,
} = {}) {
  const { start: dayStart, end: dayEnd, dateLabel } = getAsiaShanghaiDayBoundsMs();
  const client = getClient();

  let todayRevenue = 0;
  let txScanned = 0;
  let nextTx = [{ [TX_PK]: TableStore.INF_MIN }];
  const endTx = [{ [TX_PK]: TableStore.INF_MAX }];

  while (txScanned < maxTxScanRows) {
    const res = await getRangePromise(client, {
      tableName: TX_TABLE,
      direction: TableStore.Direction.FORWARD,
      inclusiveStartPrimaryKey: nextTx,
      exclusiveEndPrimaryKey: endTx,
      limit: 500,
    });
    const rows = res.rows || [];
    for (const row of rows) {
      if (txScanned >= maxTxScanRows) break;
      txScanned += 1;
      const attrs = attrsToObj(row.attributes);
      const t = String(attrs.type || '').toLowerCase();
      if (t !== 'recharge' && t !== 'redeem') continue;
      const cms = txCreatedMsFromAttrs(attrs);
      if (cms < dayStart || cms > dayEnd) continue;
      const amt = toTxIntegerAmount(attrs.amount);
      todayRevenue += Math.abs(amt);
    }
    const nextPk = res.next_start_primary_key || res.nextStartPrimaryKey;
    if (!nextPk || txScanned >= maxTxScanRows) break;
    nextTx = nextPk;
  }

  let totalCoupons = 0;
  let nextCp = [{ code: TableStore.INF_MIN }];
  const endCp = [{ code: TableStore.INF_MAX }];
  let cpSafety = 0;
  while (cpSafety < 2000) {
    cpSafety += 1;
    const res = await getRangePromise(client, {
      tableName: COUPONS_TABLE,
      direction: TableStore.Direction.FORWARD,
      inclusiveStartPrimaryKey: nextCp,
      exclusiveEndPrimaryKey: endCp,
      limit: 500,
    });
    const rows = res.rows || [];
    totalCoupons += rows.length;
    const nextPk = res.next_start_primary_key || res.nextStartPrimaryKey;
    if (!nextPk) break;
    nextCp = nextPk;
  }

  let failedCount = 0;
  let taskScanned = 0;
  let nextTask = [{ task_id: TableStore.INF_MIN }];
  const endTask = [{ task_id: TableStore.INF_MAX }];
  while (taskScanned < maxTaskScanRows) {
    const res = await getRangePromise(client, {
      tableName: TASKS_TABLE,
      direction: TableStore.Direction.FORWARD,
      inclusiveStartPrimaryKey: nextTask,
      exclusiveEndPrimaryKey: endTask,
      limit: 500,
    });
    const rows = res.rows || [];
    for (const row of rows) {
      if (taskScanned >= maxTaskScanRows) break;
      taskScanned += 1;
      const attrs = attrsToObj(row.attributes);
      const st = String(attrs.status || '').toLowerCase();
      if (FAILED_OPS_STATUSES.has(st)) failedCount += 1;
    }
    const nextPk = res.next_start_primary_key || res.nextStartPrimaryKey;
    if (!nextPk || taskScanned >= maxTaskScanRows) break;
    nextTask = nextPk;
  }

  return {
    timezone: 'Asia/Shanghai',
    date: dateLabel,
    today_revenue_yuanbao: todayRevenue,
    total_coupon_codes: totalCoupons,
    pending_failed_or_timeout_tasks: failedCount,
    tx_rows_scanned: txScanned,
    task_rows_scanned: taskScanned,
    coupon_full_scan: true,
  };
}

/** 上海时区日历键：日 / 月 / 年（用于利润分组） */
function shanghaiCalendarKeysFromMs(ms) {
  const d = new Date(ms);
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const parts = fmt.formatToParts(d);
  const y = parts.find((p) => p.type === 'year')?.value || '1970';
  const m = parts.find((p) => p.type === 'month')?.value || '01';
  const day = parts.find((p) => p.type === 'day')?.value || '01';
  return { day: `${y}-${m}-${day}`, month: `${y}-${m}`, year: `${y}` };
}

function modelIdFromTxDescription(desc) {
  const s = String(desc || '').trim();
  if (!s) return '';
  if (s.startsWith('create:')) return s.slice(7).trim();
  if (s.startsWith('{')) return '';
  return s.split(/[\s|]/)[0].trim();
}

function extractBillingModelIdFromTaskAttrs(attrs) {
  if (!attrs || typeof attrs !== 'object') return '';
  for (const key of ['workflow_json', 'prompt_json']) {
    const raw = attrs[key];
    if (raw == null) continue;
    const str = String(raw).trim();
    if (!str) continue;
    try {
      const j = JSON.parse(str);
      if (j && typeof j === 'object') {
        if (j.billingModelId) return String(j.billingModelId).trim();
        if (j.inner && typeof j.inner === 'object' && j.inner.billingModelId) {
          return String(j.inner.billingModelId).trim();
        }
      }
    } catch (_) {
      /* ignore */
    }
  }
  return '';
}

async function getTaskAttributesById(client, taskId) {
  const tid = String(taskId || '').trim();
  if (!tid) return null;
  try {
    const res = await client.getRow({
      tableName: TASKS_TABLE,
      primaryKey: [{ task_id: tid }],
    });
    const row = res.row;
    if (!row?.attributes?.length) return null;
    return attrsToObj(row.attributes);
  } catch (_) {
    return null;
  }
}

function parseFiniteOpt(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * 扫描 nx_model_config，含可选列 base_cost / user_price（若无则用 base_price、实付代替）。
 */
async function loadModelProfitConfigMap() {
  const client = getClient();
  const map = Object.create(null);
  let nextStart = [{ model_id: TableStore.INF_MIN }];
  const endPK = [{ model_id: TableStore.INF_MAX }];
  let safety = 0;

  while (safety < 500) {
    safety += 1;
    const res = await new Promise((resolve, reject) => {
      client.getRange(
        {
          tableName: MODEL_CONFIG_TABLE,
          direction: TableStore.Direction.FORWARD,
          inclusiveStartPrimaryKey: nextStart,
          exclusiveEndPrimaryKey: endPK,
          limit: 500,
        },
        (err, data) => {
          if (err) reject(err);
          else resolve(data || {});
        },
      );
    });
    const rows = res.rows || [];
    for (const row of rows) {
      const attrs = attrsToObj(row.attributes);
      const pk0 = row.primaryKey && row.primaryKey[0];
      let modelId = '';
      if (pk0 && typeof pk0 === 'object') {
        modelId = String(
          pk0.value !== undefined ? pk0.value : pk0.model_id !== undefined ? pk0.model_id : '',
        );
      }
      if (!modelId) continue;
      const bp = parseFloat(modelConfigAttr(attrs, 'base_price'));
      const mul = parseFloat(modelConfigAttr(attrs, 'multiplier'));
      const yr = parseFloat(modelConfigAttr(attrs, 'yuanbao_rate'));
      const bc = parseFiniteOpt(modelConfigAttr(attrs, 'base_cost'));
      const up = parseFiniteOpt(modelConfigAttr(attrs, 'user_price'));
      map[modelId] = {
        base_price: Number.isFinite(bp) ? bp : 0,
        multiplier: Number.isFinite(mul) ? mul : 1,
        yuanbao_rate: Number.isFinite(yr) ? yr : 10,
        base_cost: bc,
        user_price: up,
      };
    }
    const nextPk = res.next_start_primary_key || res.nextStartPrimaryKey;
    if (!nextPk) break;
    nextStart = nextPk;
  }
  return map;
}

function couponRowIsUsed(attrs) {
  const u = attrs.used;
  if (u === true || u === 1) return true;
  const s = String(u || '')
    .trim()
    .toLowerCase();
  if (s === 'true' || s === '1' || s === 'yes') return true;
  const iu = attrs.is_used;
  if (iu === true || iu === 1) return true;
  const si = String(iu || '')
    .trim()
    .toLowerCase();
  return si === 'true' || si === '1' || si === 'yes';
}

/**
 * 运营财务：consume 流水 + 模型底价/售价（可选列 base_cost、user_price）+ 已核销兑换码面值。
 * 利润（元宝）= 售价 − 底价；售价默认取实扣费，底价默认取 base_price。
 */
export async function adminAggregateProfitAnalytics({
  maxTxScanRows = 60000,
  maxCouponScanRows = 50000,
} = {}) {
  const modelMap = await loadModelProfitConfigMap();
  let yuanbaoRates = Object.values(modelMap)
    .map((m) => m.yuanbao_rate)
    .filter((x) => Number.isFinite(x) && x > 0);
  const defaultYuanbaoPerCny =
    yuanbaoRates.length > 0
      ? yuanbaoRates.reduce((a, b) => a + b, 0) / yuanbaoRates.length
      : 10;

  const client = getClient();
  let couponFaceCny = 0;
  let couponUsed = 0;
  let cpScanned = 0;
  let nextCp = [{ code: TableStore.INF_MIN }];
  const endCp = [{ code: TableStore.INF_MAX }];

  while (cpScanned < maxCouponScanRows) {
    const res = await getRangePromise(client, {
      tableName: COUPONS_TABLE,
      direction: TableStore.Direction.FORWARD,
      inclusiveStartPrimaryKey: nextCp,
      exclusiveEndPrimaryKey: endCp,
      limit: 500,
    });
    const rows = res.rows || [];
    for (const row of rows) {
      if (cpScanned >= maxCouponScanRows) break;
      cpScanned += 1;
      const attrs = attrsToObj(row.attributes);
      if (!couponRowIsUsed(attrs)) continue;
      couponUsed += 1;
      const tier = parseInt(String(attrs.amount_cny || '0'), 10);
      if (Number.isFinite(tier) && tier > 0) couponFaceCny += tier;
    }
    const nextPk = res.next_start_primary_key || res.nextStartPrimaryKey;
    if (!nextPk || cpScanned >= maxCouponScanRows) break;
    nextCp = nextPk;
  }

  const couponEstimatedYuanbao = Math.round(couponFaceCny * defaultYuanbaoPerCny);

  const dayAgg = Object.create(null);
  const monthAgg = Object.create(null);
  const yearAgg = Object.create(null);
  const modelAgg = Object.create(null);

  let totalRevenue = 0;
  let totalCost = 0;
  let txScanned = 0;
  let txTruncated = false;
  const taskBillingCache = new Map();

  let nextTx = [{ [TX_PK]: TableStore.INF_MIN }];
  const endTx = [{ [TX_PK]: TableStore.INF_MAX }];

  while (txScanned < maxTxScanRows) {
    const res = await getRangePromise(client, {
      tableName: TX_TABLE,
      direction: TableStore.Direction.FORWARD,
      inclusiveStartPrimaryKey: nextTx,
      exclusiveEndPrimaryKey: endTx,
      limit: 500,
    });
    const rows = res.rows || [];
    const nextPk = res.next_start_primary_key || res.nextStartPrimaryKey;

    for (const row of rows) {
      if (txScanned >= maxTxScanRows) break;
      txScanned += 1;
      const attrs = attrsToObj(row.attributes);
      const typ = String(attrs.type || '').toLowerCase();
      if (typ !== 'consume') continue;

      const cms = txCreatedMsFromAttrs(attrs);
      if (cms <= 0) continue;

      const userCharge = Math.abs(toTxIntegerAmount(attrs.amount));
      if (userCharge <= 0) continue;

      let mid = modelIdFromTxDescription(attrs.description);
      const tid = String(attrs.task_id || '').trim();
      if (!mid && tid) {
        if (taskBillingCache.has(tid)) {
          mid = taskBillingCache.get(tid);
        } else {
          const ta = await getTaskAttributesById(client, tid);
          mid = extractBillingModelIdFromTaskAttrs(ta) || '';
          taskBillingCache.set(tid, mid || '_unknown');
          mid = mid || '_unknown';
        }
      }
      if (!mid) mid = '_unknown';

      const cfg = modelMap[mid] || { base_price: 0, base_cost: null, user_price: null, yuanbao_rate: 10 };
      const baseCostEff =
        cfg.base_cost != null && Number.isFinite(cfg.base_cost) ? cfg.base_cost : cfg.base_price || 0;
      const sellEff =
        cfg.user_price != null && Number.isFinite(cfg.user_price) ? cfg.user_price : userCharge;
      const profit = sellEff - baseCostEff;

      totalRevenue += sellEff;
      totalCost += baseCostEff;

      const keys = shanghaiCalendarKeysFromMs(cms);
      for (const [store, k] of [
        [dayAgg, keys.day],
        [monthAgg, keys.month],
        [yearAgg, keys.year],
      ]) {
        if (!store[k]) store[k] = { profit: 0, revenue: 0, cost: 0 };
        store[k].profit += profit;
        store[k].revenue += sellEff;
        store[k].cost += baseCostEff;
      }

      if (!modelAgg[mid]) {
        modelAgg[mid] = { profit: 0, revenue: 0, cost: 0, task_count: 0 };
      }
      modelAgg[mid].profit += profit;
      modelAgg[mid].revenue += sellEff;
      modelAgg[mid].cost += baseCostEff;
      modelAgg[mid].task_count += 1;
    }

    if (txScanned >= maxTxScanRows) {
      if (nextPk) txTruncated = true;
      break;
    }
    if (!nextPk) break;
    nextTx = nextPk;
  }

  const toSortedList = (store) =>
    Object.keys(store)
      .sort()
      .map((period) => ({
        period,
        profit_yuanbao: Math.round(store[period].profit),
        revenue_yuanbao: Math.round(store[period].revenue),
        cost_yuanbao: Math.round(store[period].cost),
      }));

  const model_profit_leaderboard = Object.keys(modelAgg)
    .map((model_id) => ({
      model_id,
      profit_yuanbao: Math.round(modelAgg[model_id].profit),
      revenue_yuanbao: Math.round(modelAgg[model_id].revenue),
      cost_yuanbao: Math.round(modelAgg[model_id].cost),
      task_count: modelAgg[model_id].task_count,
    }))
    .sort((a, b) => b.profit_yuanbao - a.profit_yuanbao);

  const now = Date.now();
  const cur = shanghaiCalendarKeysFromMs(now);
  const monthProfit = monthAgg[cur.month] ? Math.round(monthAgg[cur.month].profit) : 0;
  const monthRevenue = monthAgg[cur.month] ? Math.round(monthAgg[cur.month].revenue) : 0;

  return {
    timezone: 'Asia/Shanghai',
    daily_profits: toSortedList(dayAgg),
    monthly_profits: toSortedList(monthAgg),
    yearly_profits: toSortedList(yearAgg),
    total_revenue: Math.round(totalRevenue),
    total_cost: Math.round(totalCost),
    total_profit: Math.round(totalRevenue - totalCost),
    /** 本月（上海）consume 毛利与流水，供「本月预估」卡片 */
    current_month_profit_yuanbao: monthProfit,
    current_month_revenue_yuanbao: monthRevenue,
    current_month_key: cur.month,
    model_profit_leaderboard,
    coupon_used_count: couponUsed,
    coupon_face_value_cny_sum: couponFaceCny,
    coupon_estimated_yuanbao: couponEstimatedYuanbao,
    yuanbao_per_cny_assumed: Math.round(defaultYuanbaoPerCny * 1000) / 1000,
    tx_rows_scanned: txScanned,
    coupon_rows_scanned: cpScanned,
    tx_scan_truncated: txTruncated,
  };
}

/**
 * 全局扫描失败/超时任务（供运营列表）。
 */
export async function listFailedOrTimeoutTasksForAdmin({
  maxScanRows = 50000,
  maxItems = 500,
} = {}) {
  const client = getClient();
  const out = [];
  let nextStart = [{ task_id: TableStore.INF_MIN }];
  const endPK = [{ task_id: TableStore.INF_MAX }];
  let scanned = 0;

  while (out.length < maxItems && scanned < maxScanRows) {
    const res = await getRangePromise(client, {
      tableName: TASKS_TABLE,
      direction: TableStore.Direction.FORWARD,
      inclusiveStartPrimaryKey: nextStart,
      exclusiveEndPrimaryKey: endPK,
      limit: 500,
    });
    const rows = res.rows || [];
    for (const row of rows) {
      if (scanned >= maxScanRows) break;
      scanned += 1;
      const attrs = attrsToObj(row.attributes);
      const stRaw = String(attrs.status || '');
      const st = stRaw.toLowerCase();
      if (!FAILED_OPS_STATUSES.has(st)) continue;
      const taskId = taskIdFromTaskRow(row);
      const userId = String(attrs.user_id || '').trim();
      const cost = parseInt(String(attrs.cost ?? attrs.amount ?? '0'), 10) || 0;
      out.push({
        task_id: taskId,
        user_id: userId,
        status: stRaw,
        cost,
        error_msg: String(attrs.error_msg || '').slice(0, 2000),
        created_at: attrs.created_at,
        updated_at: attrs.updated_at,
      });
      if (out.length >= maxItems) break;
    }
    const nextPk = res.next_start_primary_key || res.nextStartPrimaryKey;
    if (!nextPk || out.length >= maxItems) break;
    nextStart = nextPk;
  }
  return { tasks: out, scanned };
}

/** 用户表时间列 → 毫秒时间戳（无效则 null） */
function parseUserTsMs(raw) {
  if (raw === undefined || raw === null || raw === '') return null;
  const n = Number(raw);
  if (Number.isFinite(n) && n > 0) return n < 1e12 ? Math.round(n * 1000) : Math.round(n);
  const p = Date.parse(String(raw));
  return Number.isFinite(p) && p > 0 ? p : null;
}

/**
 * 运营：扫描 nx_users 全表，返回脱敏字段（不含 password_hash 等）。
 * @param {{ maxScanRows?: number }} opts 默认 100000，防止单请求超时；扫满上限时 scan_truncated 为 true。
 */
export async function adminListAllUsersForOps({ maxScanRows = 100000 } = {}) {
  const cap = Math.min(500000, Math.max(1000, Number(maxScanRows) || 100000));
  const client = getClient();
  const users = [];
  let nextStart = [{ user_id: TableStore.INF_MIN }];
  const endPK = [{ user_id: TableStore.INF_MAX }];
  let scanTruncated = false;

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const res = await getRangePromise(client, {
      tableName: USERS_TABLE,
      direction: TableStore.Direction.FORWARD,
      inclusiveStartPrimaryKey: nextStart,
      exclusiveEndPrimaryKey: endPK,
      limit: 500,
    });
    const rows = res.rows || [];
    const nextPk = res.next_start_primary_key || res.nextStartPrimaryKey;
    for (const row of rows) {
      const attrs = attrsToObj(row.attributes);
      const uid = pkColumnValue(row.primaryKey || [], 'user_id');
      if (!uid) continue;
      const regMs = parseUserTsMs(attrs.created_at);
      const lastMs = parseUserTsMs(attrs.last_login_at);
      users.push({
        user_id: uid,
        email: String(attrs.email || ''),
        registration_date: regMs != null ? regMs : 0,
        last_login: lastMs,
        status: String(attrs.status || 'normal'),
      });
      if (users.length >= cap) {
        if (nextPk) scanTruncated = true;
        break;
      }
    }
    if (users.length >= cap) break;
    if (!nextPk) break;
    nextStart = nextPk;
  }

  return { users, total_count: users.length, scan_truncated: scanTruncated };
}

/**
 * 运营一键退款：幂等退回 consume 流水对应元宝。
 */
export async function adminRefundTaskByIds(userId, taskId) {
  const uid = String(userId || '').trim();
  const tid = String(taskId || '').trim();
  if (!uid || !tid) throw new Error('USER_ID_AND_TASK_ID_REQUIRED');
  return refundConsumedTask(uid, tid, {
    provider: 'admin',
    description: 'admin_refund_failed_task',
  });
}

/**
 * 写入或覆盖 nx_model_config 一行（与 listModelConfig 列一致）。
 */
export async function upsertModelConfigRow(row) {
  const mid = String(row?.model_id ?? '').trim();
  if (!mid) throw new Error('MODEL_ID_REQUIRED');
  const client = getClient();
  const fn = row.function_name != null ? String(row.function_name) : mid;
  const isActive =
    row.is_active === false ? 'false' : row.is_active === true ? 'true' : 'true';
  const bp = Number(row.base_price);
  const mul = Number(row.multiplier);
  const yr = Number(row.yuanbao_rate);
  await client.putRow({
    tableName: MODEL_CONFIG_TABLE,
    condition: new TableStore.Condition(TableStore.RowExistenceExpectation.IGNORE, null),
    primaryKey: [{ model_id: mid }],
    attributeColumns: [
      { function_name: fn },
      { is_active: isActive },
      { base_price: Number.isFinite(bp) ? bp : 0 },
      { multiplier: Number.isFinite(mul) ? mul : 1 },
      { yuanbao_rate: Number.isFinite(yr) ? yr : 10 },
    ],
  });
  return { model_id: mid };
}

/** 兼容旧 init-user：已废弃，返回提示 */
export async function initOrGetUser() {
  throw new Error('LEGACY_INIT_USER_DEPRECATED');
}
