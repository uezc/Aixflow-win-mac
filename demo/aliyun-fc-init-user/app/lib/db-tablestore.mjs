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
/** Phase 4：平台全局并发计数（PK pool_id=video|image|audio；属性 running） */
const QUEUE_COUNTERS_TABLE = (process.env.OTS_TABLE_QUEUE_COUNTERS || 'nx_queue_counters').toLowerCase();
/** Phase 5：用户并发计数（PK counter_key=userId#taskType；属性 occupied） */
const USER_CONCURRENCY_COUNTERS_TABLE = (
  process.env.OTS_TABLE_USER_CONCURRENCY_COUNTERS || 'nx_user_concurrency_counters'
).toLowerCase();
/** Phase 5：槽位 reservation 追踪（PK reservation_id；防 crash 孤儿占用） */
const SLOT_RESERVATIONS_TABLE = (
  process.env.OTS_TABLE_SLOT_RESERVATIONS || 'nx_slot_reservations'
).toLowerCase();
/** Phase 6：每 task 一笔 charge 业务行（PK task_id）；Money SoT 仍在 nx_users receipt */
const TASK_CHARGES_TABLE = (process.env.OTS_TABLE_TASK_CHARGES || 'nx_task_charges').toLowerCase();
/**
 * 活跃任务投影表（PK task_id）：Timer / queue-position / promote·charge·dispatch·poll 只扫此小表。
 * 全量历史仍在 nx_tasks，终端态 3 天后由 cleanup 清理。
 */
const TASK_WORK_TABLE = (process.env.OTS_TABLE_TASK_WORK || 'nx_task_work').toLowerCase();

/**
 * nx_tasks 队列扫描瘦列：禁止拉 prompt_json / workflow_json / result 等大 JSON。
 * provider_forward_json 保留用于 charged→dispatch 候选过滤；真正 dispatch/poll 仍 getRow 全量。
 */
export const TASK_SCAN_COLUMNS = [
  'status',
  'task_type',
  'resource_pool',
  'user_id',
  'model_id',
  'queue_entered_at',
  'created_at',
  'updated_at',
  'claimed_at',
  'lease_owner',
  'lease_expires_at',
  'claim_token',
  'reservation_id',
  'execution_stage',
  'provider_task_id',
  'provider_forward_json',
  'dispatch_lease_owner',
  'dispatch_lease_expires_at',
  'dispatch_unknown',
  'user_slot_held',
  'platform_slot_held',
  'charge_id',
  'charged_at',
  'cost',
];

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
      queueCounters: QUEUE_COUNTERS_TABLE,
      userConcurrencyCounters: USER_CONCURRENCY_COUNTERS_TABLE,
      slotReservations: SLOT_RESERVATIONS_TABLE,
      taskCharges: TASK_CHARGES_TABLE,
      taskWork: TASK_WORK_TABLE,
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
      [QUEUE_COUNTERS_TABLE]: ['pool_id (STRING)'],
      [USER_CONCURRENCY_COUNTERS_TABLE]: ['counter_key (STRING)'],
      [SLOT_RESERVATIONS_TABLE]: ['reservation_id (STRING)'],
      [TASK_CHARGES_TABLE]: ['task_id (STRING)'],
      [TASK_WORK_TABLE]: ['task_id (STRING)'],
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

/** OTS 返回的 next_start_primary_key 为 { name, value }；getRange 入参须为 { column: value }，否则报 Duplicated primary key name: 'name' */
function otsNextPkToShorthand(nextPk) {
  if (!Array.isArray(nextPk) || nextPk.length === 0) return null;
  const out = [];
  for (const pk of nextPk) {
    if (!pk || typeof pk !== 'object') continue;
    const col = pk.name ?? pk.columnName;
    if (col != null && pk.value !== undefined) {
      out.push({ [col]: pk.value });
      continue;
    }
    const keys = Object.keys(pk).filter((k) => !['name', 'value', 'columnName'].includes(k));
    if (keys.length === 1) out.push({ [keys[0]]: pk[keys[0]] });
  }
  return out.length ? out : null;
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
  const receiptColumns = {};
  for (const [k, v] of Object.entries(attrs)) {
    if (/^(dr_|rr_)[0-9a-f]{8,64}$/i.test(k)) {
      const n = parseInt(String(v), 10);
      receiptColumns[k] = Number.isFinite(n) ? n : v;
    }
  }

  return {
    userId: userId,
    email: attrs.email || '',
    passwordHash: attrs.password_hash || '',
    balance: parseInt(attrs.balance, 10) || 0,
    /** Phase 6 Money SoT 列；putRow 必须带回，否则会被覆盖抹掉 */
    receiptColumns,
    createdAt: attrs.created_at || null,
    lastLoginAt: attrs.last_login_at || null,
    status: attrs.status || 'normal',
    tokenVersion: parseTokenVersion(attrs),
    lifetimeRechargeYuanbao: parseInt(String(attrs.lifetime_recharge_yuanbao ?? '0'), 10) || 0,
    isFirstRecharge:
      attrs.is_first_recharge === undefined ||
      attrs.is_first_recharge === null ||
      (attrs.is_first_recharge !== 'false' && attrs.is_first_recharge !== '0'),
    /** Phase 3：套餐 id（free|basic|pro|studio|enterprise） */
    planId: String(attrs.plan_id || 'free').trim().toLowerCase() || 'free',
    /** 用户覆盖；空/缺省表示不覆盖套餐默认 */
    videoConcurrencyOverride: (() => {
      const raw = attrs.video_concurrency_override;
      if (raw === undefined || raw === null || raw === '') return null;
      const n = parseInt(String(raw), 10);
      return Number.isFinite(n) && n >= 1 ? n : null;
    })(),
    imageConcurrencyOverride: (() => {
      const raw = attrs.image_concurrency_override;
      if (raw === undefined || raw === null || raw === '') return null;
      const n = parseInt(String(raw), 10);
      return Number.isFinite(n) && n >= 1 ? n : null;
    })(),
    concurrencyOverrideExpiresAt: (() => {
      const raw = attrs.concurrency_override_expires_at;
      if (raw === undefined || raw === null || raw === '') return 0;
      const n = parseInt(String(raw), 10);
      if (!Number.isFinite(n) || n <= 0) return 0;
      return n >= 1e11 ? n : n * 1000;
    })(),
  };
}

function isFirstRechargeColumn(u) {
  return u.isFirstRecharge ? 'true' : 'false';
}

/**
 * 全量写入 nx_users 属性列（OTS putRow 覆盖属性，须每次带上 token_version 与权益列）
 * @param {object} user
 * @param {object} [patch]
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

  const planId = String(
    patch.planId !== undefined ? patch.planId : user.planId || 'free',
  )
    .trim()
    .toLowerCase() || 'free';

  let videoOv =
    patch.videoConcurrencyOverride !== undefined
      ? patch.videoConcurrencyOverride
      : user.videoConcurrencyOverride;
  let imageOv =
    patch.imageConcurrencyOverride !== undefined
      ? patch.imageConcurrencyOverride
      : user.imageConcurrencyOverride;
  if (patch.clearConcurrencyOverrides === true) {
    videoOv = null;
    imageOv = null;
  }
  const videoOvStr =
    videoOv != null && Number.isFinite(Number(videoOv)) && Number(videoOv) >= 1
      ? String(Math.round(Number(videoOv)))
      : '';
  const imageOvStr =
    imageOv != null && Number.isFinite(Number(imageOv)) && Number(imageOv) >= 1
      ? String(Math.round(Number(imageOv)))
      : '';

  let expiresAt =
    patch.concurrencyOverrideExpiresAt !== undefined
      ? patch.concurrencyOverrideExpiresAt
      : user.concurrencyOverrideExpiresAt ?? 0;
  if (patch.clearConcurrencyOverrides === true) expiresAt = 0;
  const expiresMs = (() => {
    const n = parseInt(String(expiresAt ?? 0), 10);
    if (!Number.isFinite(n) || n <= 0) return 0;
    return n >= 1e11 ? n : n * 1000;
  })();

  const cols = [
    { email },
    { password_hash: passwordHash },
    { balance: txInt64(balance) },
    { created_at: txTsInt64(user.createdAt, nowMs) },
    { last_login_at: lastLoginAt },
    { status },
    { is_first_recharge: isFirstStr },
    { token_version: txInt64(tv) },
    { lifetime_recharge_yuanbao: txInt64(lifetimeRechargeYuanbao) },
    { plan_id: planId },
    { video_concurrency_override: videoOvStr },
    { image_concurrency_override: imageOvStr },
    { concurrency_override_expires_at: txInt64(expiresMs) },
  ];
  // 保留 Phase 6 debit/refund receipt（putRow 会覆盖整行属性）
  const receipts =
    patch.receiptColumns && typeof patch.receiptColumns === 'object'
      ? patch.receiptColumns
      : user.receiptColumns && typeof user.receiptColumns === 'object'
        ? user.receiptColumns
        : {};
  for (const [k, v] of Object.entries(receipts)) {
    if (!/^(dr_|rr_)[0-9a-f]{8,64}$/i.test(k)) continue;
    const n = parseInt(String(v), 10);
    cols.push({ [k]: txInt64(Number.isFinite(n) ? n : 0) });
  }
  return cols;
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
        { plan_id: 'free' },
        { video_concurrency_override: '' },
        { image_concurrency_override: '' },
        { concurrency_override_expires_at: txInt64(0) },
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
        { plan_id: 'free' },
        { video_concurrency_override: '' },
        { image_concurrency_override: '' },
        { concurrency_override_expires_at: txInt64(0) },
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
 * Phase 3：管理员更新用户套餐 / 并发覆盖。
 * @param {string} userId
 * @param {{
 *   planId?: string,
 *   videoConcurrencyOverride?: number|null,
 *   imageConcurrencyOverride?: number|null,
 *   concurrencyOverrideExpiresAt?: number|null,
 *   clearConcurrencyOverrides?: boolean,
 * }} patch
 */
export async function updateUserConcurrencyEntitlement(userId, patch = {}) {
  const uid = String(userId || '').trim();
  if (!uid) throw new Error('USER_ID_REQUIRED');
  const u = await getUserById(uid);
  if (!u) throw new Error('USER_NOT_FOUND');
  const nowMs = Date.now();
  const client = getClient();
  const nextPatch = { nowMs };
  if (patch.planId !== undefined) {
    const { normalizePlanId } = await import('./userConcurrencyEntitlement.mjs');
    nextPatch.planId = normalizePlanId(patch.planId);
  }
  if (patch.clearConcurrencyOverrides === true) {
    nextPatch.clearConcurrencyOverrides = true;
  } else {
    if (patch.videoConcurrencyOverride !== undefined) {
      nextPatch.videoConcurrencyOverride = patch.videoConcurrencyOverride;
    }
    if (patch.imageConcurrencyOverride !== undefined) {
      nextPatch.imageConcurrencyOverride = patch.imageConcurrencyOverride;
    }
    if (patch.concurrencyOverrideExpiresAt !== undefined) {
      nextPatch.concurrencyOverrideExpiresAt = patch.concurrencyOverrideExpiresAt;
    }
  }
  await client.putRow({
    tableName: USERS_TABLE,
    condition: new TableStore.Condition(TableStore.RowExistenceExpectation.EXPECT_EXIST, null),
    primaryKey: [{ user_id: uid }],
    attributeColumns: buildUserPutColumns(u, nextPatch),
  });
  return getUserById(uid);
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
  if (v == null || v === '') return 0;
  if (typeof v === 'object') {
    if (typeof v.toNumber === 'function') {
      try {
        const n = v.toNumber();
        if (Number.isFinite(n) && n > 0) return n < 1e12 ? Math.round(n * 1000) : Math.round(n);
      } catch (_) {}
    }
    if (typeof v.toString === 'function') {
      const s = v.toString();
      if (/^-?\d+$/.test(s)) {
        const n = Number(s);
        if (Number.isFinite(n) && n > 0) return n < 1e12 ? Math.round(n * 1000) : Math.round(n);
      }
    }
  }
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
    nextStart = otsNextPkToShorthand(nextPk) ?? nextPk;
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
 * 列出某用户全部流水后按时间分页（GSI idx_user_id 全分区扫描）。
 * 消费主键为 idem_<hash>，不能按主键截断再按时间排序，否则会漏掉新账单。
 *
 * 排序前必须补齐 created_at（索引常未投影该列，否则会退化成哈希主键乱序）。
 * 仅拉取 created_at 列 + 高并发；展示字段只对当前页全量回表。
 *
 * @param {string} userId
 * @param {{ limit?: number, page?: number, maxScan?: number }} [opts]
 * @returns {Promise<{ items: object[], page: number, pageSize: number, total: number, hasMore: boolean }>}
 */
export async function listTransactionsForUserPaged(userId, opts = {}) {
  const uid = String(userId || '');
  const pageSize = Math.min(50, Math.max(1, Number(opts.limit) || 30));
  const page = Math.max(1, Math.floor(Number(opts.page) || 1));
  const maxScan = Math.min(8000, Math.max(pageSize, Number(opts.maxScan) || 5000));
  if (!uid) {
    return { items: [], page, pageSize, total: 0, hasMore: false };
  }

  const t0 = Date.now();
  const collected = await listAllGsiTransactionsForUser(uid, maxScan);
  const tScan = Date.now();

  const visible = collected.filter((row) => {
    const txId = String(row?.tx_id || '');
    const type = String(row?.type || '').toLowerCase();
    return type !== 'alipay_trade_ref' && !txId.startsWith('alipay_trade_');
  });

  await hydrateTransactionCreatedAt(visible);
  const tTs = Date.now();

  visible.sort((a, b) => {
    const dt = txTimeMs(b.created_at) - txTimeMs(a.created_at);
    if (dt !== 0) return dt;
    return String(b.tx_id || '').localeCompare(String(a.tx_id || ''));
  });

  const total = visible.length;
  const start = (page - 1) * pageSize;
  const pageRows = start >= total ? [] : visible.slice(start, start + pageSize);
  await hydrateTransactionRows(pageRows);
  const tDone = Date.now();
  console.log(
    `[listTransactionsForUserPaged] scan=${collected.length} visible=${total} page=${page}/${pageSize} ` +
      `ms:scan=${tScan - t0} createdAt=${tTs - tScan} pageHydrate=${tDone - tTs} total=${tDone - t0}`,
  );

  return {
    items: pageRows,
    page,
    pageSize,
    total,
    hasMore: start + pageRows.length < total,
  };
}

/** 仅补全缺失/无效的 created_at，供全局按时间倒序 */
async function hydrateTransactionCreatedAt(collected) {
  const client = getClient();
  const indices = [];
  for (let i = 0; i < collected.length; i++) {
    if (txTimeMs(collected[i]?.created_at) <= 0 && collected[i]?.tx_id) indices.push(i);
  }
  if (indices.length === 0) return;

  const CONCURRENCY = 48;
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
          columnsToGet: ['created_at'],
        });
        if (!gr.row?.attributes?.length) continue;
        const full = attrsToObj(gr.row.attributes);
        if (txTimeMs(full.created_at) > 0) {
          collected[idx] = { ...row, created_at: full.created_at };
        }
      } catch (e) {
        console.warn('[hydrateTransactionCreatedAt]', row.tx_id, e?.message || e);
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, indices.length) }, () => worker()));
}

/**
 * 扫某用户在 idx_user_id 上的全部流水（按 sort key 全范围，非时间序）。
 */
async function listAllGsiTransactionsForUser(userId, maxRows = 5000) {
  const uid = String(userId || '');
  if (!uid || maxRows < 1) return [];

  const skCol = TX_GSI_SK;
  const collected = [];
  let nextStart = [{ user_id: uid }, { [skCol]: TableStore.INF_MIN }];
  const fixedEnd = [{ user_id: uid }, { [skCol]: TableStore.INF_MAX }];
  let safety = 0;

  while (collected.length < maxRows && safety < 80) {
    safety += 1;
    const res = await getRangeOnGlobalIndex(
      TX_GSI_NAME,
      nextStart,
      fixedEnd,
      Math.min(100, Math.max(maxRows - collected.length, 1)),
      TableStore.Direction.FORWARD,
    );
    for (const row of res.rows || []) {
      const item = gsiRowToTxListItem(row);
      if (item) collected.push(item);
    }
    const nextPk = res.next_start_primary_key || res.nextStartPrimaryKey;
    if (!nextPk) break;
    nextStart = otsNextPkToShorthand(nextPk) ?? nextPk;
  }
  return collected;
}

/**
 * 列出某用户最近流水（兼容旧调用：等价于第 1 页）。
 */
export async function listRecentTransactionsForUser(userId, limit = 20) {
  const lim = Math.min(50, Math.max(1, Number(limit) || 20));
  const result = await listTransactionsForUserPaged(userId, { limit: lim, page: 1 });
  return result.items;
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
    nextStart = otsNextPkToShorthand(nextPk) ?? nextPk;
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

/**
 * 从 OTS getRange/getRow 行解析 nx_tasks 主键 task_id。
 * SDK 常见形态：[{ name: 'task_id', value: '<uuid>' }] —— 禁止用 Object.values(pk)[0]，
 * 否则会误取列名字符串 "task_id"。
 */
export function taskIdFromTaskRow(row) {
  const pkList = row?.primaryKey || [];
  const byName = pkColumnValue(pkList, 'task_id');
  if (byName) return byName;
  const p0 = pkList[0];
  if (p0 && typeof p0 === 'object' && p0.value !== undefined && p0.value !== null) return String(p0.value);
  if (p0 && typeof p0 === 'object' && p0.task_id != null) return String(p0.task_id);
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
      columnToGet: TASK_SCAN_COLUMNS,
    });
    const rows = res.rows || [];
    for (const row of rows) {
      if (scanned >= maxScanRows) break;
      scanned += 1;
      const attrs = attrsToObj(row.attributes);
      const stRaw = String(attrs.status || '');
      const st = stRaw.toUpperCase();
      if (!STALE_TASK_STATUSES.has(st)) continue;
      // Phase 7：云端 Provider 管线任务禁止走 legacy settle-stale 盲退
      const stage = String(attrs.execution_stage || '').toLowerCase();
      if (
        stage === 'charged' ||
        stage === 'dispatching' ||
        stage === 'provider_submitted' ||
        stage === 'settling' ||
        String(attrs.dispatch_unknown || '0') === '1' ||
        String(attrs.provider_task_id || '').trim()
      ) {
        continue;
      }
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
  const {
    normalizeTaskStatus,
    toPublicTaskStatus,
  } = await import('./taskStatusMachine.mjs');
  const statusRaw = normalizeTaskStatus(attrs.status);
  return {
    task_id: tid,
    user_id: attrs.user_id,
    status: toPublicTaskStatus(statusRaw),
    status_raw: statusRaw,
    task_type: attrs.task_type || '',
    model_id: attrs.model_id || '',
    amount: attrs.amount,
    cost: attrs.cost,
    quoted_cost: attrs.quoted_cost,
    prompt_json: attrs.prompt_json,
    workflow_json: attrs.workflow_json,
    result_oss_url: attrs.result_oss_url,
    error_msg: attrs.error_msg,
    error_code: attrs.error_code || '',
    provider_task_id: attrs.provider_task_id || '',
    execution_stage: String(attrs.execution_stage || ''),
    dispatch_unknown: String(attrs.dispatch_unknown || '0'),
    created_at: attrs.created_at,
    updated_at: attrs.updated_at,
    queue_entered_at: attrs.queue_entered_at,
    running_at: attrs.running_at,
    finished_at: attrs.finished_at,
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
  const {
    normalizeTaskStatus,
    assertCanTransitionTaskStatus,
    timestampsForStatusChange,
  } = await import('./taskStatusMachine.mjs');

  const hasPrev = existing.row?.attributes?.length > 0 && String(prev.status || '').trim() !== '';
  const prevStatus = hasPrev ? normalizeTaskStatus(prev.status) : '';
  const nextStatus = normalizeTaskStatus(patch.status ?? prev.status ?? 'queued');
  if (hasPrev) {
    const gate = assertCanTransitionTaskStatus(prevStatus, nextStatus);
    if (!gate.ok) {
      console.warn(`[upsertTask] ${gate.message} task=${taskId}`);
    }
  }

  const ts = timestampsForStatusChange(prevStatus || nextStatus, nextStatus, prev, nowMs);
  const merged = {
    user_id: userId,
    status: nextStatus,
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
    error_code: patch.error_code != null ? String(patch.error_code) : String(prev.error_code || ''),
    task_type: patch.task_type != null ? String(patch.task_type) : String(prev.task_type || ''),
    resource_pool:
      patch.resource_pool != null
        ? String(patch.resource_pool)
        : String(prev.resource_pool || ''),
    model_id: patch.model_id != null ? String(patch.model_id) : String(prev.model_id || ''),
    quoted_cost:
      patch.quoted_cost != null
        ? parseInt(String(patch.quoted_cost), 10) || 0
        : parseInt(String(prev.quoted_cost ?? '0'), 10) || 0,
    provider_task_id:
      patch.provider_task_id != null
        ? String(patch.provider_task_id)
        : String(prev.provider_task_id || ''),
    lease_owner:
      patch.lease_owner != null ? String(patch.lease_owner) : String(prev.lease_owner || ''),
    lease_expires_at:
      patch.lease_expires_at != null
        ? toTaskTsMs(patch.lease_expires_at, 0)
        : toTaskTsMs(prev.lease_expires_at, 0),
    claim_token:
      patch.claim_token != null ? String(patch.claim_token) : String(prev.claim_token || ''),
    reservation_id:
      patch.reservation_id != null
        ? String(patch.reservation_id)
        : String(prev.reservation_id || ''),
    user_slot_held:
      patch.user_slot_held != null
        ? String(patch.user_slot_held)
        : String(prev.user_slot_held || '0'),
    platform_slot_held:
      patch.platform_slot_held != null
        ? String(patch.platform_slot_held)
        : String(prev.platform_slot_held || '0'),
    execution_stage:
      patch.execution_stage != null
        ? String(patch.execution_stage)
        : String(prev.execution_stage || ''),
    charge_id:
      patch.charge_id != null ? String(patch.charge_id) : String(prev.charge_id || ''),
    charged_at:
      patch.charged_at != null ? toTaskTsMs(patch.charged_at, 0) : toTaskTsMs(prev.charged_at, 0),
    provider_task_id:
      patch.provider_task_id != null
        ? String(patch.provider_task_id)
        : String(prev.provider_task_id || ''),
    provider_forward_json:
      patch.provider_forward_json != null
        ? String(patch.provider_forward_json)
        : String(prev.provider_forward_json || ''),
    provider_status:
      patch.provider_status != null
        ? String(patch.provider_status)
        : String(prev.provider_status || ''),
    provider_error:
      patch.provider_error != null ? String(patch.provider_error) : String(prev.provider_error || ''),
    provider_last_checked_at:
      patch.provider_last_checked_at != null
        ? toTaskTsMs(patch.provider_last_checked_at, 0)
        : toTaskTsMs(prev.provider_last_checked_at, 0),
    dispatch_lease_owner:
      patch.dispatch_lease_owner != null
        ? String(patch.dispatch_lease_owner)
        : String(prev.dispatch_lease_owner || ''),
    dispatch_lease_expires_at:
      patch.dispatch_lease_expires_at != null
        ? toTaskTsMs(patch.dispatch_lease_expires_at, 0)
        : toTaskTsMs(prev.dispatch_lease_expires_at, 0),
    dispatch_attempt:
      patch.dispatch_attempt != null
        ? parseInt(String(patch.dispatch_attempt), 10) || 0
        : parseInt(String(prev.dispatch_attempt ?? '0'), 10) || 0,
    dispatch_unknown:
      patch.dispatch_unknown != null
        ? String(patch.dispatch_unknown)
        : String(prev.dispatch_unknown || '0'),
    created_at: prevCreatedMs,
    queue_entered_at: ts.queue_entered_at != null ? ts.queue_entered_at : toTaskTsMs(prev.queue_entered_at, 0),
    claimed_at: ts.claimed_at != null ? ts.claimed_at : toTaskTsMs(prev.claimed_at, 0),
    running_at: ts.running_at != null ? ts.running_at : toTaskTsMs(prev.running_at, 0),
    finished_at: ts.finished_at != null ? ts.finished_at : toTaskTsMs(prev.finished_at, 0),
  };
  // lease 回队：清空 claim 相关字段
  if (nextStatus === 'queued' && prevStatus === 'claimed') {
    merged.lease_owner = '';
    merged.lease_expires_at = 0;
    merged.claim_token = '';
    merged.reservation_id = '';
    merged.user_slot_held = '0';
    merged.platform_slot_held = '0';
    merged.claimed_at = 0;
  }

  const TERMINAL_STATUSES = new Set(['success', 'failed', 'cancelled', 'timeout']);
  const prevUserHeld = heldFlagToBool(prev.user_slot_held);
  const prevPlatformHeld = heldFlagToBool(prev.platform_slot_held);
  const goingTerminal =
    TERMINAL_STATUSES.has(nextStatus) && (!prevStatus || !TERMINAL_STATUSES.has(prevStatus));
  if (goingTerminal) {
    merged.user_slot_held = '0';
    merged.platform_slot_held = '0';
  }
  const skipSlotAutoRelease = patch.skip_slot_auto_release === true;

  const attrCols = [
    { user_id: merged.user_id },
    { status: merged.status },
    { amount: txInt64(merged.amount) },
    { cost: txInt64(merged.cost) },
    { prompt_json: merged.prompt_json },
    { workflow_json: merged.workflow_json },
    { result_oss_url: merged.result_oss_url },
    { error_msg: merged.error_msg },
    { error_code: merged.error_code },
    { task_type: merged.task_type },
    { resource_pool: merged.resource_pool },
    { model_id: merged.model_id },
    { quoted_cost: txInt64(merged.quoted_cost) },
    { provider_task_id: merged.provider_task_id },
    { lease_owner: merged.lease_owner },
    { claim_token: merged.claim_token },
    { reservation_id: merged.reservation_id },
    { user_slot_held: merged.user_slot_held },
    { platform_slot_held: merged.platform_slot_held },
    { execution_stage: merged.execution_stage },
    { charge_id: merged.charge_id },
    { provider_task_id: merged.provider_task_id },
    { provider_forward_json: merged.provider_forward_json },
    { provider_status: merged.provider_status },
    { provider_error: merged.provider_error },
    { dispatch_lease_owner: merged.dispatch_lease_owner },
    { dispatch_attempt: txInt64(merged.dispatch_attempt) },
    { dispatch_unknown: merged.dispatch_unknown },
    { created_at: txTsInt64(merged.created_at, nowMs) },
    { updated_at: txTsInt64(nowMs) },
  ];
  if (merged.queue_entered_at > 0) attrCols.push({ queue_entered_at: txTsInt64(merged.queue_entered_at, nowMs) });
  if (merged.claimed_at > 0) attrCols.push({ claimed_at: txTsInt64(merged.claimed_at, nowMs) });
  if (merged.running_at > 0) attrCols.push({ running_at: txTsInt64(merged.running_at, nowMs) });
  if (merged.finished_at > 0) attrCols.push({ finished_at: txTsInt64(merged.finished_at, nowMs) });
  if (merged.charged_at > 0) attrCols.push({ charged_at: txTsInt64(merged.charged_at, nowMs) });
  if (merged.provider_last_checked_at > 0) {
    attrCols.push({ provider_last_checked_at: txTsInt64(merged.provider_last_checked_at, nowMs) });
  }
  if (merged.dispatch_lease_expires_at > 0) {
    attrCols.push({ dispatch_lease_expires_at: txTsInt64(merged.dispatch_lease_expires_at, nowMs) });
  }
  if (merged.lease_expires_at > 0) {
    attrCols.push({ lease_expires_at: txTsInt64(merged.lease_expires_at, nowMs) });
  }

  await client.putRow({
    tableName: TASKS_TABLE,
    condition: new TableStore.Condition(TableStore.RowExistenceExpectation.IGNORE, null),
    primaryKey: [{ task_id: taskId }],
    attributeColumns: attrCols,
  });

  // 终态释放不变量：进入终态时若此前持槽，自动释放（调用方已显式释放时可 skip_slot_auto_release）
  if (goingTerminal && !skipSlotAutoRelease) {
    const tt = String(merged.task_type || prev.task_type || '')
      .trim()
      .toLowerCase();
    let poolId = String(merged.resource_pool || prev.resource_pool || '')
      .trim()
      .toLowerCase();
    if (!poolId) {
      try {
        const { resolveResourcePoolFromTaskRow } = await import('./resourcePool.mjs');
        poolId =
          resolveResourcePoolFromTaskRow({
            task_type: tt,
            resource_pool: merged.resource_pool || prev.resource_pool,
            model_id: merged.model_id || prev.model_id,
            provider_forward_json: merged.provider_forward_json || prev.provider_forward_json,
          }) || '';
      } catch (_) {
        poolId = tt === 'video' ? 'cn_video' : tt === 'image' ? 'cn_image' : tt === 'audio' ? 'audio' : '';
      }
    }
    if (prevPlatformHeld && poolId) {
      try {
        await releasePlatformConcurrencySlot(poolId);
      } catch (e) {
        console.error('[upsertTask] auto release platform', taskId, e?.message || e);
      }
    }
    if (prevUserHeld && userId && (tt === 'video' || tt === 'image' || tt === 'audio')) {
      try {
        await releaseUserConcurrencySlot(userId, tt);
      } catch (e) {
        console.error('[upsertTask] auto release user', taskId, e?.message || e);
      }
    }
  }

  // 活跃投影表：queued/claimed/running 写入；终端态删除（不影响 Claim/Charge CAS）
  try {
    const activeWork = nextStatus === 'queued' || nextStatus === 'claimed' || nextStatus === 'running';
    const terminalWork =
      nextStatus === 'success' ||
      nextStatus === 'failed' ||
      nextStatus === 'cancelled' ||
      nextStatus === 'timeout';
    if (terminalWork) {
      await deleteTaskWork(taskId);
    } else if (activeWork) {
      await upsertTaskWork({
        task_id: taskId,
        user_id: userId,
        task_type: merged.task_type,
        resource_pool: merged.resource_pool,
        status: nextStatus,
        queue_entered_at: merged.queue_entered_at,
        created_at: merged.created_at,
        updated_at: nowMs,
        provider_task_id: merged.provider_task_id,
        execution_stage: merged.execution_stage,
        model_id: merged.model_id,
        claim_token: merged.claim_token,
        reservation_id: merged.reservation_id,
        lease_expires_at: merged.lease_expires_at,
      });
    }
  } catch (e) {
    console.warn('[upsertTask] task_work sync skipped:', e?.message || e);
  }
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
 * 运营看板：今日充值类流水合计（type=recharge 或 redeem，上海自然日）+ 兑换码总行数
 * + 失败/超时任务数 + 排队/生产中任务数（有扫描上限）+ 平台并发槽快照。
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
      columnToGet: ['type', 'amount', 'created_at'],
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
      columnToGet: ['code'],
    });
    const rows = res.rows || [];
    totalCoupons += rows.length;
    const nextPk = res.next_start_primary_key || res.nextStartPrimaryKey;
    if (!nextPk) break;
    nextCp = nextPk;
  }

  let failedCount = 0;
  let queuedCount = 0;
  let claimedCount = 0;
  let runningCount = 0;
  let pendingCount = 0;
  let processingCount = 0;
  let queuedVideo = 0;
  let queuedImage = 0;
  let producingVideo = 0;
  let producingImage = 0;
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
      columnToGet: ['status', 'task_type'],
    });
    const rows = res.rows || [];
    for (const row of rows) {
      if (taskScanned >= maxTaskScanRows) break;
      taskScanned += 1;
      const attrs = attrsToObj(row.attributes);
      const st = String(attrs.status || '').toLowerCase();
      if (FAILED_OPS_STATUSES.has(st)) failedCount += 1;
      const tt = String(attrs.task_type || '').toLowerCase();
      if (st === 'queued') {
        queuedCount += 1;
        if (tt === 'video') queuedVideo += 1;
        else if (tt === 'image') queuedImage += 1;
      } else if (st === 'claimed') {
        claimedCount += 1;
        if (tt === 'video') producingVideo += 1;
        else if (tt === 'image') producingImage += 1;
      } else if (st === 'running') {
        runningCount += 1;
        if (tt === 'video') producingVideo += 1;
        else if (tt === 'image') producingImage += 1;
      } else if (st === 'pending') {
        pendingCount += 1;
        if (tt === 'video') producingVideo += 1;
        else if (tt === 'image') producingImage += 1;
      } else if (st === 'processing') {
        processingCount += 1;
        if (tt === 'video') producingVideo += 1;
        else if (tt === 'image') producingImage += 1;
      }
    }
    const nextPk = res.next_start_primary_key || res.nextStartPrimaryKey;
    if (!nextPk || taskScanned >= maxTaskScanRows) break;
    nextTask = nextPk;
  }

  // 生产中 = 已占用并发槽 / 正在跑（claimed + running + legacy pending/processing）
  const producingCount = claimedCount + runningCount + pendingCount + processingCount;

  let platformPool = null;
  try {
    platformPool = await getPlatformConcurrencyPoolSnapshot();
  } catch (e) {
    console.warn('[adminAggregateDashboardStats] platform pool snapshot failed', e?.message || e);
  }

  return {
    timezone: 'Asia/Shanghai',
    date: dateLabel,
    today_revenue_yuanbao: todayRevenue,
    total_coupon_codes: totalCoupons,
    pending_failed_or_timeout_tasks: failedCount,
    queued_tasks: queuedCount,
    producing_tasks: producingCount,
    claimed_tasks: claimedCount,
    running_tasks: runningCount,
    pending_tasks: pendingCount,
    processing_tasks: processingCount,
    queued_video_tasks: queuedVideo,
    queued_image_tasks: queuedImage,
    producing_video_tasks: producingVideo,
    producing_image_tasks: producingImage,
    platform_video_running: platformPool?.video?.running ?? null,
    platform_video_max: platformPool?.video?.max ?? null,
    platform_image_running: platformPool?.image?.running ?? null,
    platform_image_max: platformPool?.image?.max ?? null,
    tx_rows_scanned: txScanned,
    task_rows_scanned: taskScanned,
    task_scan_truncated: taskScanned >= maxTaskScanRows,
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
      columnToGet: ['used', 'is_used', 'amount_cny'],
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
      columnToGet: ['type', 'amount', 'created_at', 'description', 'task_id'],
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
      columnToGet: ['status', 'user_id', 'cost', 'amount', 'error_msg', 'created_at', 'updated_at'],
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
      columnToGet: ['email', 'created_at', 'last_login_at', 'status'],
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

// ─── Phase 4：平台全局并发资源池（OTS 条件更新 + INCREMENT，无 Redis）───

function isOtsConditionFail(e) {
  const code = String(e?.code || '');
  const msg = String(e?.message || e || '');
  return (
    code === 'OTSConditionCheckFail' ||
    code === 'ConditionCheckFail' ||
    /ConditionCheckFail|condition check failed|条件检查失败/i.test(msg)
  );
}

async function readPlatformPoolRunning(poolId) {
  const client = getClient();
  const res = await client.getRow({
    tableName: QUEUE_COUNTERS_TABLE,
    primaryKey: [{ pool_id: poolId }],
  });
  if (!res.row?.attributes?.length) return null;
  const attrs = attrsToObj(res.row.attributes);
  const n = parseInt(String(attrs.running ?? '0'), 10);
  return Number.isFinite(n) ? n : 0;
}

/**
 * 确保平台池计数行存在（running=0）。可重复调用。
 * @param {string} [poolId] 默认初始化一期全部池；传入则只确保该池
 */
export async function ensurePlatformConcurrencyPool(poolId) {
  const { normalizePlatformPoolKind, getPlatformPoolMax, PLATFORM_RESOURCE_POOL_IDS } = await import(
    './platformConcurrencyConfig.mjs'
  );
  const ids = poolId
    ? [normalizePlatformPoolKind(poolId)].filter(Boolean)
    : [...PLATFORM_RESOURCE_POOL_IDS];
  if (ids.length === 0) throw new Error('INVALID_POOL_KIND');

  const client = getClient();
  const nowMs = Date.now();
  const out = [];
  for (const id of ids) {
    try {
      await client.putRow({
        tableName: QUEUE_COUNTERS_TABLE,
        condition: new TableStore.Condition(TableStore.RowExistenceExpectation.EXPECT_NOT_EXIST, null),
        primaryKey: [{ pool_id: id }],
        attributeColumns: [
          { running: txInt64(0) },
          { max_hint: txInt64(getPlatformPoolMax(id)) },
          { updated_at: txTsInt64(nowMs) },
        ],
      });
      out.push({ pool_id: id, created: true, running: 0 });
    } catch (e) {
      if (isOtsConditionFail(e) || /exist|Exist|OTSRowAlreadyExist/i.test(String(e?.message || ''))) {
        const running = await readPlatformPoolRunning(id);
        out.push({ pool_id: id, created: false, running: running ?? 0 });
        continue;
      }
      throw e;
    }
  }
  // 迁移：旧 video/image 计数若仍有 running，且新 cn_* 为 0，则并入（尽力而为，一次性）
  if (!poolId) {
    await transferLegacyPlatformCounterBestEffort('video', 'cn_video');
    await transferLegacyPlatformCounterBestEffort('image', 'cn_image');
  }
  return out;
}

async function transferLegacyPlatformCounterBestEffort(legacyId, newId) {
  try {
    const legacy = await readPlatformPoolRunning(legacyId);
    if (!(legacy > 0)) return;
    const neu = (await readPlatformPoolRunning(newId)) ?? 0;
    if (neu > 0) return;
    const { getPlatformPoolMax } = await import('./platformConcurrencyConfig.mjs');
    const max = getPlatformPoolMax(newId);
    const client = getClient();
    const nowMs = Date.now();
    await client.putRow({
      tableName: QUEUE_COUNTERS_TABLE,
      condition: new TableStore.Condition(TableStore.RowExistenceExpectation.IGNORE, null),
      primaryKey: [{ pool_id: newId }],
      attributeColumns: [
        { running: txInt64(legacy) },
        { max_hint: txInt64(max) },
        { updated_at: txTsInt64(nowMs) },
      ],
    });
    await client.putRow({
      tableName: QUEUE_COUNTERS_TABLE,
      condition: new TableStore.Condition(TableStore.RowExistenceExpectation.IGNORE, null),
      primaryKey: [{ pool_id: legacyId }],
      attributeColumns: [
        { running: txInt64(0) },
        { max_hint: txInt64(max) },
        { updated_at: txTsInt64(nowMs) },
      ],
    });
    console.warn(
      `[platformPool] transferred legacy counter ${legacyId}=${legacy} → ${newId} (best-effort)`,
    );
  } catch (e) {
    console.warn('[platformPool] legacy transfer skipped', legacyId, e?.message || e);
  }
}

/**
 * 原子占用 1 个平台槽位。成功则 running+1 且保证 running≤max。
 * @param {'video'|'image'} kind
 * @returns {Promise<{ ok: boolean, reason?: string, running?: number, max?: number, pool_id?: string }>}
 */
export async function tryAcquirePlatformConcurrencySlot(kind) {
  const { normalizePlatformPoolKind, getPlatformPoolMax } = await import(
    './platformConcurrencyConfig.mjs'
  );
  const poolId = normalizePlatformPoolKind(kind);
  if (!poolId) return { ok: false, reason: 'INVALID_POOL_KIND' };
  const max = getPlatformPoolMax(poolId);

  await ensurePlatformConcurrencyPool(poolId);
  const client = getClient();
  const nowMs = Date.now();

  try {
    await client.updateRow({
      tableName: QUEUE_COUNTERS_TABLE,
      condition: new TableStore.Condition(
        TableStore.RowExistenceExpectation.EXPECT_EXIST,
        new TableStore.SingleColumnCondition(
          'running',
          txInt64(max),
          TableStore.ComparatorType.LESS_THAN,
          false,
        ),
      ),
      primaryKey: [{ pool_id: poolId }],
      updateOfAttributeColumns: [
        { INCREMENT: [{ running: txInt64(1) }] },
        { PUT: [{ updated_at: txTsInt64(nowMs) }, { max_hint: txInt64(max) }] },
      ],
    });
  } catch (e) {
    if (isOtsConditionFail(e)) {
      const running = (await readPlatformPoolRunning(poolId)) ?? max;
      return {
        ok: false,
        reason: 'PLATFORM_POOL_FULL',
        pool_id: poolId,
        running,
        max,
      };
    }
    throw e;
  }

  const running = (await readPlatformPoolRunning(poolId)) ?? 0;
  if (running > max) {
    // 理论上条件更新不应发生；防御性回滚一次
    console.error(
      `[platformPool] INVARIANT BROKEN pool=${poolId} running=${running} max=${max} — attempting corrective release`,
    );
    try {
      await releasePlatformConcurrencySlot(poolId);
    } catch (_) {}
    return {
      ok: false,
      reason: 'PLATFORM_POOL_INVARIANT',
      pool_id: poolId,
      running,
      max,
    };
  }
  return { ok: true, pool_id: poolId, running, max };
}

/**
 * 原子释放 1 个平台槽位。running 已为 0 时不降为负（条件失败视为幂等成功）。
 * @param {'video'|'image'} kind
 */
export async function releasePlatformConcurrencySlot(kind) {
  const { normalizePlatformPoolKind, getPlatformPoolMax } = await import(
    './platformConcurrencyConfig.mjs'
  );
  const poolId = normalizePlatformPoolKind(kind);
  if (!poolId) return { ok: false, reason: 'INVALID_POOL_KIND' };
  const max = getPlatformPoolMax(poolId);

  await ensurePlatformConcurrencyPool(poolId);
  const client = getClient();
  const nowMs = Date.now();

  try {
    await client.updateRow({
      tableName: QUEUE_COUNTERS_TABLE,
      condition: new TableStore.Condition(
        TableStore.RowExistenceExpectation.EXPECT_EXIST,
        new TableStore.SingleColumnCondition(
          'running',
          txInt64(0),
          TableStore.ComparatorType.GREATER_THAN,
          false,
        ),
      ),
      primaryKey: [{ pool_id: poolId }],
      updateOfAttributeColumns: [
        { INCREMENT: [{ running: txInt64(-1) }] },
        { PUT: [{ updated_at: txTsInt64(nowMs) }, { max_hint: txInt64(max) }] },
      ],
    });
  } catch (e) {
    if (isOtsConditionFail(e)) {
      const running = (await readPlatformPoolRunning(poolId)) ?? 0;
      return {
        ok: true,
        already_empty: true,
        pool_id: poolId,
        running: Math.max(0, running),
        max,
      };
    }
    throw e;
  }

  let running = (await readPlatformPoolRunning(poolId)) ?? 0;
  if (running < 0) {
    console.error(`[platformPool] negative running pool=${poolId} value=${running} — clamping to 0`);
    try {
      await client.putRow({
        tableName: QUEUE_COUNTERS_TABLE,
        condition: new TableStore.Condition(TableStore.RowExistenceExpectation.EXPECT_EXIST, null),
        primaryKey: [{ pool_id: poolId }],
        attributeColumns: [
          { running: txInt64(0) },
          { max_hint: txInt64(max) },
          { updated_at: txTsInt64(Date.now()) },
        ],
      });
      running = 0;
    } catch (_) {}
  }
  return { ok: true, pool_id: poolId, running, max };
}

/**
 * 读取平台池快照（不占槽）。
 */
export async function getPlatformConcurrencyPoolSnapshot() {
  const {
    getPlatformPoolMax,
    PLATFORM_RESOURCE_POOL_IDS,
    RESOURCE_POOL,
  } = await import('./platformConcurrencyConfig.mjs');
  await ensurePlatformConcurrencyPool();
  const pools = {};
  let totalRunning = 0;
  for (const id of PLATFORM_RESOURCE_POOL_IDS) {
    const running = (await readPlatformPoolRunning(id)) ?? 0;
    pools[id] = { running, max: getPlatformPoolMax(id) };
    totalRunning += Math.max(0, running);
  }
  // 兼容旧字段：video/image 映射国内池（idle 探测与旧脚本）
  return {
    ...pools,
    video: pools[RESOURCE_POOL.CN_VIDEO],
    image: pools[RESOURCE_POOL.CN_IMAGE],
    audio: pools[RESOURCE_POOL.AUDIO],
    total_running: totalRunning,
    table: QUEUE_COUNTERS_TABLE,
  };
}

// ─── Phase 5：用户并发计数 + reservation + claim / lease / reconcile ───

export function userConcurrencyCounterKey(userId, taskType) {
  const uid = String(userId || '').trim();
  const t = String(taskType || '')
    .trim()
    .toLowerCase();
  return `${uid}#${t}`;
}

async function readUserConcurrencyOccupied(counterKey) {
  const client = getClient();
  const res = await client.getRow({
    tableName: USER_CONCURRENCY_COUNTERS_TABLE,
    primaryKey: [{ counter_key: counterKey }],
  });
  if (!res.row?.attributes?.length) return null;
  const attrs = attrsToObj(res.row.attributes);
  const n = parseInt(String(attrs.occupied ?? '0'), 10);
  return Number.isFinite(n) ? n : 0;
}

/**
 * 确保用户并发计数行存在。
 */
export async function ensureUserConcurrencyCounter(userId, taskType) {
  const { normalizeUserConcurrencyKind } = await import('./platformConcurrencyConfig.mjs');
  const kind = normalizeUserConcurrencyKind(taskType);
  if (!kind) throw new Error('INVALID_USER_COUNTER_KIND');
  const uid = String(userId || '').trim();
  if (!uid) throw new Error('USER_ID_REQUIRED');
  const key = userConcurrencyCounterKey(uid, kind);
  const client = getClient();
  const nowMs = Date.now();
  try {
    await client.putRow({
      tableName: USER_CONCURRENCY_COUNTERS_TABLE,
      condition: new TableStore.Condition(TableStore.RowExistenceExpectation.EXPECT_NOT_EXIST, null),
      primaryKey: [{ counter_key: key }],
      attributeColumns: [
        { user_id: uid },
        { task_type: kind },
        { occupied: txInt64(0) },
        { limit_hint: txInt64(0) },
        { updated_at: txTsInt64(nowMs) },
      ],
    });
    return { counter_key: key, created: true, occupied: 0 };
  } catch (e) {
    if (isOtsConditionFail(e) || /exist|Exist|OTSRowAlreadyExist/i.test(String(e?.message || ''))) {
      const occupied = (await readUserConcurrencyOccupied(key)) ?? 0;
      return { counter_key: key, created: false, occupied };
    }
    throw e;
  }
}

/**
 * 原子占用 1 个用户槽位：occupied < limit 才能 +1。
 * @returns {Promise<{ ok: boolean, reason?: string, occupied?: number, limit?: number }>}
 */
export async function tryAcquireUserConcurrencySlot(userId, taskType, limit) {
  const { normalizeUserConcurrencyKind } = await import('./platformConcurrencyConfig.mjs');
  const kind = normalizeUserConcurrencyKind(taskType);
  if (!kind) return { ok: false, reason: 'INVALID_POOL_KIND' };
  const uid = String(userId || '').trim();
  if (!uid) return { ok: false, reason: 'USER_ID_REQUIRED' };
  const max = Math.max(1, Math.floor(Number(limit) || 0));
  if (!Number.isFinite(max) || max < 1) return { ok: false, reason: 'INVALID_USER_LIMIT' };

  await ensureUserConcurrencyCounter(uid, kind);
  const key = userConcurrencyCounterKey(uid, kind);
  const client = getClient();
  const nowMs = Date.now();

  try {
    await client.updateRow({
      tableName: USER_CONCURRENCY_COUNTERS_TABLE,
      condition: new TableStore.Condition(
        TableStore.RowExistenceExpectation.EXPECT_EXIST,
        new TableStore.SingleColumnCondition(
          'occupied',
          txInt64(max),
          TableStore.ComparatorType.LESS_THAN,
          false,
        ),
      ),
      primaryKey: [{ counter_key: key }],
      updateOfAttributeColumns: [
        { INCREMENT: [{ occupied: txInt64(1) }] },
        {
          PUT: [
            { updated_at: txTsInt64(nowMs) },
            { limit_hint: txInt64(max) },
            { user_id: uid },
            { task_type: kind },
          ],
        },
      ],
    });
  } catch (e) {
    if (isOtsConditionFail(e)) {
      const occupied = (await readUserConcurrencyOccupied(key)) ?? max;
      return {
        ok: false,
        reason: 'USER_CONCURRENCY_FULL',
        counter_key: key,
        occupied,
        limit: max,
      };
    }
    throw e;
  }

  const occupied = (await readUserConcurrencyOccupied(key)) ?? 0;
  if (occupied > max) {
    console.error(
      `[userPool] INVARIANT BROKEN key=${key} occupied=${occupied} limit=${max} — corrective release`,
    );
    try {
      await releaseUserConcurrencySlot(uid, kind);
    } catch (_) {}
    return {
      ok: false,
      reason: 'USER_POOL_INVARIANT',
      counter_key: key,
      occupied,
      limit: max,
    };
  }
  return { ok: true, counter_key: key, occupied, limit: max };
}

/**
 * 原子释放 1 个用户槽位。occupied 已为 0 时幂等成功。
 */
export async function releaseUserConcurrencySlot(userId, taskType) {
  const { normalizeUserConcurrencyKind } = await import('./platformConcurrencyConfig.mjs');
  const kind = normalizeUserConcurrencyKind(taskType);
  if (!kind) return { ok: false, reason: 'INVALID_POOL_KIND' };
  const uid = String(userId || '').trim();
  if (!uid) return { ok: false, reason: 'USER_ID_REQUIRED' };

  await ensureUserConcurrencyCounter(uid, kind);
  const key = userConcurrencyCounterKey(uid, kind);
  const client = getClient();
  const nowMs = Date.now();

  try {
    await client.updateRow({
      tableName: USER_CONCURRENCY_COUNTERS_TABLE,
      condition: new TableStore.Condition(
        TableStore.RowExistenceExpectation.EXPECT_EXIST,
        new TableStore.SingleColumnCondition(
          'occupied',
          txInt64(0),
          TableStore.ComparatorType.GREATER_THAN,
          false,
        ),
      ),
      primaryKey: [{ counter_key: key }],
      updateOfAttributeColumns: [
        { INCREMENT: [{ occupied: txInt64(-1) }] },
        { PUT: [{ updated_at: txTsInt64(nowMs) }] },
      ],
    });
  } catch (e) {
    if (isOtsConditionFail(e)) {
      const occupied = (await readUserConcurrencyOccupied(key)) ?? 0;
      return {
        ok: true,
        already_empty: true,
        counter_key: key,
        occupied: Math.max(0, occupied),
      };
    }
    throw e;
  }

  let occupied = (await readUserConcurrencyOccupied(key)) ?? 0;
  if (occupied < 0) {
    console.error(`[userPool] negative occupied key=${key} value=${occupied} — clamping to 0`);
    try {
      await client.putRow({
        tableName: USER_CONCURRENCY_COUNTERS_TABLE,
        condition: new TableStore.Condition(TableStore.RowExistenceExpectation.EXPECT_EXIST, null),
        primaryKey: [{ counter_key: key }],
        attributeColumns: [
          { user_id: uid },
          { task_type: kind },
          { occupied: txInt64(0) },
          { updated_at: txTsInt64(Date.now()) },
        ],
      });
      occupied = 0;
    } catch (_) {}
  }
  return { ok: true, counter_key: key, occupied };
}

export async function getUserConcurrencyCounterSnapshot(userId, taskType) {
  const { normalizeUserConcurrencyKind } = await import('./platformConcurrencyConfig.mjs');
  const kind = normalizeUserConcurrencyKind(taskType);
  if (!kind) return null;
  const uid = String(userId || '').trim();
  if (!uid) return null;
  const key = userConcurrencyCounterKey(uid, kind);
  const occupied = (await readUserConcurrencyOccupied(key)) ?? 0;
  return { counter_key: key, user_id: uid, task_type: kind, occupied };
}

function heldFlagToBool(v) {
  if (v === true || v === 1) return true;
  const s = String(v ?? '')
    .trim()
    .toLowerCase();
  return s === '1' || s === 'true' || s === 'yes';
}

/**
 * 写入 / 更新 slot reservation 行。
 */
export async function putSlotReservation(row) {
  const rid = String(row?.reservation_id || '').trim();
  if (!rid) throw new Error('RESERVATION_ID_REQUIRED');
  const client = getClient();
  const nowMs = Date.now();
  await client.putRow({
    tableName: SLOT_RESERVATIONS_TABLE,
    condition: new TableStore.Condition(TableStore.RowExistenceExpectation.IGNORE, null),
    primaryKey: [{ reservation_id: rid }],
    attributeColumns: [
      { task_id: String(row.task_id || '') },
      { user_id: String(row.user_id || '') },
      { task_type: String(row.task_type || '') },
      { resource_pool: String(row.resource_pool || '') },
      { user_slot_held: txInt64(Number(row.user_slot_held) ? 1 : 0) },
      { platform_slot_held: txInt64(Number(row.platform_slot_held) ? 1 : 0) },
      { state: String(row.state || 'pending') },
      { claim_token: String(row.claim_token || '') },
      { rollback_reason: String(row.rollback_reason || '') },
      { created_at: txTsInt64(row.created_at || nowMs, nowMs) },
      { expires_at: txTsInt64(row.expires_at || nowMs, nowMs) },
      { updated_at: txTsInt64(nowMs) },
    ],
  });
  return { reservation_id: rid };
}

export async function getSlotReservation(reservationId) {
  const rid = String(reservationId || '').trim();
  if (!rid) return null;
  const client = getClient();
  const res = await client.getRow({
    tableName: SLOT_RESERVATIONS_TABLE,
    primaryKey: [{ reservation_id: rid }],
  });
  if (!res.row?.attributes?.length) return null;
  const attrs = attrsToObj(res.row.attributes);
  return {
    reservation_id: rid,
    task_id: String(attrs.task_id || ''),
    user_id: String(attrs.user_id || ''),
    task_type: String(attrs.task_type || ''),
    resource_pool: String(attrs.resource_pool || ''),
    user_slot_held: parseInt(String(attrs.user_slot_held ?? '0'), 10) || 0,
    platform_slot_held: parseInt(String(attrs.platform_slot_held ?? '0'), 10) || 0,
    state: String(attrs.state || ''),
    claim_token: String(attrs.claim_token || ''),
    rollback_reason: String(attrs.rollback_reason || ''),
    created_at: toTaskTsMs(attrs.created_at, 0),
    expires_at: toTaskTsMs(attrs.expires_at, 0),
    updated_at: toTaskTsMs(attrs.updated_at, 0),
  };
}

export async function updateSlotReservation(reservationId, patch) {
  const prev = await getSlotReservation(reservationId);
  if (!prev) throw new Error('RESERVATION_NOT_FOUND');
  return putSlotReservation({
    ...prev,
    ...patch,
    reservation_id: prev.reservation_id,
    user_slot_held:
      patch.user_slot_held != null ? patch.user_slot_held : prev.user_slot_held,
    platform_slot_held:
      patch.platform_slot_held != null ? patch.platform_slot_held : prev.platform_slot_held,
  });
}

/**
 * 原子 queued → claimed（条件 status==queued）。Phase 5 不写 running。
 */
export async function atomicClaimQueuedTask({
  taskId,
  userId,
  taskType,
  resourcePool,
  reservationId,
  claimToken,
  leaseOwner,
  leaseExpiresAt,
  claimedAt,
}) {
  const tid = String(taskId || '').trim();
  if (!tid) return { ok: false, reason: 'TASK_ID_REQUIRED' };
  const client = getClient();
  const nowMs = Date.now();
  const claimedMs = claimedAt || nowMs;
  const pool = String(resourcePool || '').trim();

  try {
    await client.updateRow({
      tableName: TASKS_TABLE,
      condition: new TableStore.Condition(
        TableStore.RowExistenceExpectation.EXPECT_EXIST,
        new TableStore.SingleColumnCondition(
          'status',
          'queued',
          TableStore.ComparatorType.EQUAL,
          false,
        ),
      ),
      primaryKey: [{ task_id: tid }],
      updateOfAttributeColumns: [
        {
          PUT: [
            { status: 'claimed' },
            { user_id: String(userId || '') },
            { task_type: String(taskType || '') },
            ...(pool ? [{ resource_pool: pool }] : []),
            { reservation_id: String(reservationId || '') },
            { claim_token: String(claimToken || '') },
            { lease_owner: String(leaseOwner || '') },
            { lease_expires_at: txTsInt64(leaseExpiresAt || nowMs + 60000, nowMs) },
            { claimed_at: txTsInt64(claimedMs, nowMs) },
            { user_slot_held: '1' },
            { platform_slot_held: '1' },
            { updated_at: txTsInt64(nowMs) },
          ],
        },
      ],
    });
  } catch (e) {
    if (isOtsConditionFail(e)) {
      return { ok: false, reason: 'CLAIM_RACE' };
    }
    throw e;
  }
  try {
    await updateTaskWork(tid, {
      status: 'claimed',
      user_id: String(userId || ''),
      task_type: String(taskType || ''),
      ...(pool ? { resource_pool: pool } : {}),
      claim_token: String(claimToken || ''),
      reservation_id: String(reservationId || ''),
      lease_expires_at: leaseExpiresAt || nowMs + 60000,
      updated_at: nowMs,
    });
  } catch (e) {
    console.warn('[atomicClaimQueuedTask] task_work sync skipped:', e?.message || e);
  }
  return { ok: true, task_id: tid, status: 'claimed', resource_pool: pool || undefined };
}

/**
 * 原子 claimed → queued（lease 过期）。成功后调用方再 release 计数。
 * 条件：status==claimed；若提供 claimToken 则同时匹配。
 */
export async function atomicUnclaimExpiredTask({ taskId, userId, claimToken, nowMs }) {
  const tid = String(taskId || '').trim();
  if (!tid) return { ok: false, reason: 'TASK_ID_REQUIRED' };
  const client = getClient();
  const ts = nowMs || Date.now();

  const existing = await client.getRow({
    tableName: TASKS_TABLE,
    primaryKey: [{ task_id: tid }],
  });
  if (!existing.row?.attributes?.length) return { ok: false, reason: 'TASK_NOT_FOUND' };
  const attrs = attrsToObj(existing.row.attributes);
  const status = String(attrs.status || '').toLowerCase();
  if (status !== 'claimed') return { ok: false, reason: 'NOT_CLAIMED' };
  const leaseExp = toTaskTsMs(attrs.lease_expires_at, 0);
  if (leaseExp > 0 && leaseExp > ts) return { ok: false, reason: 'LEASE_NOT_EXPIRED' };
  const token = String(attrs.claim_token || '');
  if (claimToken && token && claimToken !== token) {
    return { ok: false, reason: 'CLAIM_TOKEN_MISMATCH' };
  }

  const userHeld = heldFlagToBool(attrs.user_slot_held);
  const platformHeld = heldFlagToBool(attrs.platform_slot_held);
  const reservationId = String(attrs.reservation_id || '');

  const cond = new TableStore.CompositeCondition(TableStore.LogicalOperator.AND);
  cond.addSubCondition(
    new TableStore.SingleColumnCondition(
      'status',
      'claimed',
      TableStore.ComparatorType.EQUAL,
      false,
    ),
  );
  if (token) {
    cond.addSubCondition(
      new TableStore.SingleColumnCondition(
        'claim_token',
        token,
        TableStore.ComparatorType.EQUAL,
        false,
      ),
    );
  }

  try {
    await client.updateRow({
      tableName: TASKS_TABLE,
      condition: new TableStore.Condition(TableStore.RowExistenceExpectation.EXPECT_EXIST, cond),
      primaryKey: [{ task_id: tid }],
      updateOfAttributeColumns: [
        {
          PUT: [
            { status: 'queued' },
            { lease_owner: '' },
            { claim_token: '' },
            { reservation_id: '' },
            { user_slot_held: '0' },
            { platform_slot_held: '0' },
            { lease_expires_at: txTsInt64(0) },
            { claimed_at: txTsInt64(0) },
            { updated_at: txTsInt64(ts) },
            ...(userId ? [{ user_id: String(userId) }] : []),
          ],
        },
      ],
    });
  } catch (e) {
    if (isOtsConditionFail(e)) {
      return { ok: false, reason: 'UNCLAIM_RACE' };
    }
    throw e;
  }

  try {
    await updateTaskWork(tid, {
      status: 'queued',
      claim_token: '',
      reservation_id: '',
      lease_expires_at: 0,
      updated_at: ts,
      ...(userId ? { user_id: String(userId) } : {}),
    });
  } catch (e) {
    console.warn('[atomicUnclaimExpiredTask] task_work sync skipped:', e?.message || e);
  }

  return {
    ok: true,
    task_id: tid,
    user_slot_held: userHeld,
    platform_slot_held: platformHeld,
    reservation_id: reservationId,
  };
}

export async function getTaskById(taskId) {
  const tid = String(taskId || '').trim();
  if (!tid) return null;
  const client = getClient();
  const res = await client.getRow({
    tableName: TASKS_TABLE,
    primaryKey: [{ task_id: tid }],
  });
  if (!res.row?.attributes?.length) return null;
  const attrs = attrsToObj(res.row.attributes);
  return {
    task_id: tid,
    user_id: String(attrs.user_id || ''),
    status: String(attrs.status || ''),
    task_type: String(attrs.task_type || ''),
    resource_pool: String(attrs.resource_pool || ''),
    model_id: String(attrs.model_id || ''),
    quoted_cost: parseInt(String(attrs.quoted_cost ?? '0'), 10) || 0,
    cost: parseInt(String(attrs.cost ?? '0'), 10) || 0,
    amount: parseInt(String(attrs.amount ?? '0'), 10) || 0,
    execution_stage: String(attrs.execution_stage || ''),
    charge_id: String(attrs.charge_id || ''),
    charged_at: toTaskTsMs(attrs.charged_at, 0),
    provider_task_id: String(attrs.provider_task_id || ''),
    provider_forward_json: String(attrs.provider_forward_json || ''),
    provider_status: String(attrs.provider_status || ''),
    provider_error: String(attrs.provider_error || ''),
    provider_last_checked_at: toTaskTsMs(attrs.provider_last_checked_at, 0),
    dispatch_lease_owner: String(attrs.dispatch_lease_owner || ''),
    dispatch_lease_expires_at: toTaskTsMs(attrs.dispatch_lease_expires_at, 0),
    dispatch_attempt: parseInt(String(attrs.dispatch_attempt ?? '0'), 10) || 0,
    dispatch_unknown: String(attrs.dispatch_unknown || '0'),
    prompt_json: String(attrs.prompt_json || ''),
    result_oss_url: String(attrs.result_oss_url || ''),
    error_code: String(attrs.error_code || ''),
    error_msg: String(attrs.error_msg || ''),
    reservation_id: String(attrs.reservation_id || ''),
    claim_token: String(attrs.claim_token || ''),
    lease_owner: String(attrs.lease_owner || ''),
    lease_expires_at: toTaskTsMs(attrs.lease_expires_at, 0),
    user_slot_held: heldFlagToBool(attrs.user_slot_held),
    platform_slot_held: heldFlagToBool(attrs.platform_slot_held),
    queue_entered_at: toTaskTsMs(attrs.queue_entered_at, 0),
    claimed_at: toTaskTsMs(attrs.claimed_at, 0),
    created_at: toTaskTsMs(attrs.created_at, 0),
    updated_at: toTaskTsMs(attrs.updated_at, 0),
  };
}

/**
 * 扫描 queued 任务（FIFO 候选）。优先 nx_task_work；表不可用时 fail-open 扫 nx_tasks 瘦列。
 */
export async function listQueuedTasksForPromote({
  maxTasks = 100,
  maxScanRows = 20000,
  taskType = null,
  resourcePool = null,
} = {}) {
  const typeFilter = taskType
    ? String(taskType)
        .trim()
        .toLowerCase()
    : null;
  const poolFilter = resourcePool
    ? String(resourcePool)
        .trim()
        .toLowerCase()
    : null;

  try {
    const fromWork = await listTaskWorkForPromote({
      maxTasks,
      maxScanRows,
      taskType: typeFilter,
      resourcePool: poolFilter,
    });
    // 默认采信 work（含空队列）。迁移期可设 NX_TASK_WORK_FALLBACK_ON_EMPTY=1 在空结果时回扫 nx_tasks。
    const fallbackEmpty =
      String(process.env.NX_TASK_WORK_FALLBACK_ON_EMPTY || '0') === '1' &&
      fromWork.tasks.length === 0;
    if (!fallbackEmpty) {
      return { ...fromWork, source: 'task_work' };
    }
    console.warn(
      '[listQueuedTasksForPromote] task_work empty → fallback nx_tasks (NX_TASK_WORK_FALLBACK_ON_EMPTY=1)',
    );
  } catch (e) {
    console.warn('[listQueuedTasksForPromote] task_work failed, fallback nx_tasks:', e?.message || e);
  }

  return listQueuedTasksForPromoteFromTasksTable({
    maxTasks,
    maxScanRows,
    taskType: typeFilter,
    resourcePool: poolFilter,
  });
}

async function listQueuedTasksForPromoteFromTasksTable({
  maxTasks = 100,
  maxScanRows = 20000,
  taskType = null,
  resourcePool = null,
} = {}) {
  const { normalizeTaskStatus } = await import('./taskStatusMachine.mjs');
  const { resolveResourcePoolFromTaskRow } = await import('./resourcePool.mjs');
  const client = getClient();
  const out = [];
  let nextStart = [{ task_id: TableStore.INF_MIN }];
  const endPK = [{ task_id: TableStore.INF_MAX }];
  let scanned = 0;
  const typeFilter = taskType
    ? String(taskType)
        .trim()
        .toLowerCase()
    : null;
  const poolFilter = resourcePool
    ? String(resourcePool)
        .trim()
        .toLowerCase()
    : null;

  while (out.length < maxTasks && scanned < maxScanRows) {
    const res = await getRangePromise(client, {
      tableName: TASKS_TABLE,
      direction: TableStore.Direction.FORWARD,
      inclusiveStartPrimaryKey: nextStart,
      exclusiveEndPrimaryKey: endPK,
      limit: 500,
      columnToGet: TASK_SCAN_COLUMNS,
    });
    const rows = res.rows || [];
    for (const row of rows) {
      if (scanned >= maxScanRows) break;
      scanned += 1;
      const attrs = attrsToObj(row.attributes);
      if (normalizeTaskStatus(attrs.status) !== 'queued') continue;
      const tt = String(attrs.task_type || '').toLowerCase();
      if (tt !== 'video' && tt !== 'image' && tt !== 'audio') continue;
      if (typeFilter && tt !== typeFilter) continue;
      const rp =
        resolveResourcePoolFromTaskRow({
          task_type: tt,
          resource_pool: attrs.resource_pool,
          model_id: attrs.model_id,
          provider_forward_json: attrs.provider_forward_json,
        }) || '';
      if (poolFilter && rp !== poolFilter) continue;
      const taskId = taskIdFromTaskRow(row);
      const userId = String(attrs.user_id || '').trim();
      if (!taskId || !userId) continue;
      out.push({
        taskId,
        userId,
        taskType: tt,
        resourcePool: rp,
        modelId: String(attrs.model_id || ''),
        queueEnteredAt: toTaskTsMs(attrs.queue_entered_at, toTaskTsMs(attrs.created_at, 0)),
      });
      if (out.length >= maxTasks) break;
    }
    const nextPk = res.next_start_primary_key || res.nextStartPrimaryKey;
    if (!nextPk || out.length >= maxTasks) break;
    nextStart = otsNextPkToShorthand(nextPk) ?? nextPk;
  }
  return { tasks: out, scanned, source: 'nx_tasks' };
}

/**
 * 扫描 lease 已过期的 claimed 任务。优先 work 表；失败则 fail-open nx_tasks。
 */
export async function listExpiredClaimedTasks({
  maxTasks = 50,
  maxScanRows = 20000,
  nowMs = Date.now(),
} = {}) {
  try {
    const fromWork = await listExpiredClaimedFromTaskWork({ maxTasks, maxScanRows, nowMs });
    const fallbackEmpty =
      String(process.env.NX_TASK_WORK_FALLBACK_ON_EMPTY || '0') === '1' &&
      fromWork.tasks.length === 0;
    if (!fallbackEmpty) {
      return { ...fromWork, source: 'task_work' };
    }
    console.warn(
      '[listExpiredClaimedTasks] task_work empty → fallback nx_tasks (NX_TASK_WORK_FALLBACK_ON_EMPTY=1)',
    );
  } catch (e) {
    console.warn('[listExpiredClaimedTasks] task_work failed, fallback nx_tasks:', e?.message || e);
  }

  const { normalizeTaskStatus } = await import('./taskStatusMachine.mjs');
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
      columnToGet: TASK_SCAN_COLUMNS,
    });
    const rows = res.rows || [];
    for (const row of rows) {
      if (scanned >= maxScanRows) break;
      scanned += 1;
      const attrs = attrsToObj(row.attributes);
      if (normalizeTaskStatus(attrs.status) !== 'claimed') continue;
      const leaseExp = toTaskTsMs(attrs.lease_expires_at, 0);
      if (!(leaseExp > 0) || leaseExp > nowMs) continue;
      const taskId = taskIdFromTaskRow(row);
      const userId = String(attrs.user_id || '').trim();
      const taskType = String(attrs.task_type || '').toLowerCase();
      if (!taskId || !userId) continue;
      out.push({
        taskId,
        userId,
        taskType,
        resourcePool: String(attrs.resource_pool || ''),
        claimToken: String(attrs.claim_token || ''),
        reservationId: String(attrs.reservation_id || ''),
        leaseExpiresAt: leaseExp,
      });
      if (out.length >= maxTasks) break;
    }
    const nextPk = res.next_start_primary_key || res.nextStartPrimaryKey;
    if (!nextPk || out.length >= maxTasks) break;
    nextStart = otsNextPkToShorthand(nextPk) ?? nextPk;
  }
  return { tasks: out, scanned, source: 'nx_tasks' };
}

/**
 * 扫描 pending 且过期的 slot reservations（orphan 候选）。
 */
export async function listExpiredPendingReservations({
  maxItems = 50,
  maxScanRows = 20000,
  nowMs = Date.now(),
} = {}) {
  const client = getClient();
  const out = [];
  let nextStart = [{ reservation_id: TableStore.INF_MIN }];
  const endPK = [{ reservation_id: TableStore.INF_MAX }];
  let scanned = 0;

  while (out.length < maxItems && scanned < maxScanRows) {
    const res = await getRangePromise(client, {
      tableName: SLOT_RESERVATIONS_TABLE,
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
      const state = String(attrs.state || '').toLowerCase();
      if (state !== 'pending') continue;
      const expiresAt = toTaskTsMs(attrs.expires_at, 0);
      if (!(expiresAt > 0) || expiresAt > nowMs) continue;
      const pk = pkColumnValue(row.primaryKey || [], 'reservation_id');
      out.push({
        reservation_id: pk,
        task_id: String(attrs.task_id || ''),
        user_id: String(attrs.user_id || ''),
        task_type: String(attrs.task_type || ''),
        resource_pool: String(attrs.resource_pool || ''),
        user_slot_held: parseInt(String(attrs.user_slot_held ?? '0'), 10) || 0,
        platform_slot_held: parseInt(String(attrs.platform_slot_held ?? '0'), 10) || 0,
        state,
        expires_at: expiresAt,
        claim_token: String(attrs.claim_token || ''),
      });
      if (out.length >= maxItems) break;
    }
    const nextPk = res.next_start_primary_key || res.nextStartPrimaryKey;
    if (!nextPk || out.length >= maxItems) break;
    nextStart = otsNextPkToShorthand(nextPk) ?? nextPk;
  }
  return { reservations: out, scanned };
}

/**
 * 统计某用户某类型 Phase 5 计数器应对齐的 occupied 任务数（claimed+running）。
 * 不含 legacy processing。返回 scan_complete：扫满 maxScanRows 且仍有后续则视为不完整。
 */
export async function countOccupiedTasksForUserType(userId, taskType, { maxScanRows = 50000 } = {}) {
  const { occupiesPhase5CounterSlot } = await import('./taskStatusMachine.mjs');
  const uid = String(userId || '').trim();
  const kind = String(taskType || '')
    .trim()
    .toLowerCase();
  if (!uid || (kind !== 'video' && kind !== 'image')) {
    return { count: 0, scanned: 0, scan_complete: true };
  }

  const client = getClient();
  let count = 0;
  let scanned = 0;
  let scanComplete = true;
  let nextStart = [{ user_id: uid }, { [TASKS_GSI_SK]: TableStore.INF_MIN }];
  const endPK = [{ user_id: uid }, { [TASKS_GSI_SK]: TableStore.INF_MAX }];

  try {
    while (scanned < maxScanRows) {
      const res = await getRangePromise(client, {
        tableName: TASKS_GSI_NAME,
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
        if (String(attrs.task_type || '').toLowerCase() !== kind) continue;
        if (occupiesPhase5CounterSlot(attrs.status)) count += 1;
      }
      const nextPk = res.next_start_primary_key || res.nextStartPrimaryKey;
      if (!nextPk) break;
      if (scanned >= maxScanRows) {
        scanComplete = false;
        break;
      }
      nextStart = otsNextPkToShorthand(nextPk) ?? nextPk;
    }
  } catch (e) {
    console.warn('[countOccupiedTasksForUserType] GSI scan failed, fallback full scan:', e?.message || e);
    count = 0;
    scanned = 0;
    scanComplete = true;
    nextStart = [{ task_id: TableStore.INF_MIN }];
    const endAll = [{ task_id: TableStore.INF_MAX }];
    while (scanned < maxScanRows) {
      const res = await getRangePromise(client, {
        tableName: TASKS_TABLE,
        direction: TableStore.Direction.FORWARD,
        inclusiveStartPrimaryKey: nextStart,
        exclusiveEndPrimaryKey: endAll,
        limit: 500,
        columnToGet: TASK_SCAN_COLUMNS,
      });
      const rows = res.rows || [];
      for (const row of rows) {
        if (scanned >= maxScanRows) break;
        scanned += 1;
        const attrs = attrsToObj(row.attributes);
        if (String(attrs.user_id || '').trim() !== uid) continue;
        if (String(attrs.task_type || '').toLowerCase() !== kind) continue;
        if (occupiesPhase5CounterSlot(attrs.status)) count += 1;
      }
      const nextPk = res.next_start_primary_key || res.nextStartPrimaryKey;
      if (!nextPk) break;
      if (scanned >= maxScanRows) {
        scanComplete = false;
        break;
      }
      nextStart = otsNextPkToShorthand(nextPk) ?? nextPk;
    }
  }
  return { count, scanned, scan_complete: scanComplete };
}

function buildSchedulerDeps(self, nowMs) {
  return {
    nowMs,
    resolveUserLimit: async (userId, taskType) => {
      const u = await getUserById(userId);
      const { resolveEffectiveConcurrency } = await import('./userConcurrencyEntitlement.mjs');
      const r = resolveEffectiveConcurrency(u || {}, nowMs);
      if (taskType === 'image') return r.imageConcurrencyLimit;
      if (taskType === 'audio') return r.audioConcurrencyLimit;
      return r.videoConcurrencyLimit;
    },
    createReservation: (row) => putSlotReservation(row),
    markReservationHeld: async (reservationId, which) => {
      if (which === 'user') {
        await updateSlotReservation(reservationId, { user_slot_held: 1 });
      } else {
        await updateSlotReservation(reservationId, { platform_slot_held: 1 });
      }
    },
    markReservationState: async (reservationId, state, extra = {}) => {
      await updateSlotReservation(reservationId, { state, ...extra });
    },
    tryAcquireUser: (userId, taskType, limit) =>
      tryAcquireUserConcurrencySlot(userId, taskType, limit),
    releaseUser: (userId, taskType) => releaseUserConcurrencySlot(userId, taskType),
    tryAcquirePlatform: (taskType) => tryAcquirePlatformConcurrencySlot(taskType),
    releasePlatform: (taskType) => releasePlatformConcurrencySlot(taskType),
    atomicClaimQueuedTask: (args) => atomicClaimQueuedTask(args),
    atomicUnclaimExpiredTask: (args) => atomicUnclaimExpiredTask(args),
    getTaskById: (taskId) => getTaskById(taskId),
  };
}

/**
 * Phase 5 主入口：lease recovery →（释槽补位）→ promote →（可选）orphan reconcile。
 * Timer 路径应把 promote 视为 recovery 兜底；正常补位靠 settle 释槽后 tryRefill。
 */
export async function runPromoteQueuedTasks(opts = {}) {
  const {
    promoteQueuedTasks,
    recoverOneExpiredClaim,
    reconcileOneOrphanReservation,
    computeCounterOvershoot,
    getPromoteBatchSize,
    tryRefillAfterSlotRelease,
  } = await import('./queueScheduler.mjs');

  const nowMs = opts.nowMs ?? Date.now();
  const maxClaimsRaw = opts.maxClaims ?? getPromoteBatchSize();
  const maxClaims = Math.min(200, Math.max(0, Number(maxClaimsRaw) || 0));
  const maxScanRows = Math.min(500000, Math.max(1000, opts.maxScanRows ?? 20000));
  const doReconcile = opts.reconcile !== false;
  const deps = buildSchedulerDeps(null, nowMs);
  const listQueuedForPool = async (pool, listOpts = {}) =>
    listQueuedTasksForPromote({
      maxTasks: listOpts.maxTasks ?? 20,
      maxScanRows,
      resourcePool: pool,
    });

  // 1) lease recovery 优先，释放槽位后立刻同池补位（每释放 1 槽最多补 1）
  const expired = await listExpiredClaimedTasks({
    maxTasks: opts.maxLeaseRecover ?? 50,
    maxScanRows,
    nowMs,
  });
  const leaseResults = [];
  const refillAfterLease = [];
  for (const t of expired.tasks) {
    try {
      const r = await recoverOneExpiredClaim(t, deps);
      leaseResults.push(r);
      if (r?.ok && r.platform_slot_freed && r.resource_pool) {
        try {
          const refill = await tryRefillAfterSlotRelease(r.resource_pool, deps, {
            listQueuedForPool,
            maxRefill: 1,
          });
          refillAfterLease.push(refill);
          if (refill?.claimed > 0) {
            kickChargeDispatchAfterRefill(refill.claimed);
          }
        } catch (e) {
          refillAfterLease.push({
            ok: false,
            resource_pool: r.resource_pool,
            error: e?.message || String(e),
          });
        }
      }
    } catch (e) {
      leaseResults.push({ ok: false, task_id: t.taskId, error: e?.message || String(e) });
    }
  }

  // 2) promote queued → claimed（maxClaims=0 时跳过，供纯 reconcile；Timer recovery 兜底）
  let listed = { tasks: [], scanned: 0 };
  let promote = { attempts: 0, claimed: 0, results: [] };
  if (maxClaims > 0) {
    listed = await listQueuedTasksForPromote({
      maxTasks: Math.max(maxClaims * 5, 100),
      maxScanRows,
      taskType: opts.taskType || null,
      resourcePool: opts.resourcePool || null,
    });
    promote = await promoteQueuedTasks(listed.tasks, deps, {
      maxClaims,
      maxAttempts: opts.maxAttempts ?? maxClaims * 5,
      resourcePool: opts.resourcePool || null,
    });
  }

  // 3) 低频 orphan reconcile + 释槽补位
  let reconcile = { skipped: true };
  const refillAfterOrphan = [];
  if (doReconcile) {
    const orphans = await listExpiredPendingReservations({
      maxItems: opts.maxOrphans ?? 50,
      maxScanRows,
      nowMs,
    });
    const orphanResults = [];
    for (const r of orphans.reservations) {
      try {
        const or = await reconcileOneOrphanReservation(r, deps);
        orphanResults.push(or);
        if (or?.ok && or.platform_slot_freed && or.resource_pool) {
          try {
            const refill = await tryRefillAfterSlotRelease(or.resource_pool, deps, {
              listQueuedForPool,
              maxRefill: 1,
            });
            refillAfterOrphan.push(refill);
            if (refill?.claimed > 0) {
              kickChargeDispatchAfterRefill(refill.claimed);
            }
          } catch (e) {
            refillAfterOrphan.push({
              ok: false,
              resource_pool: or.resource_pool,
              error: e?.message || String(e),
            });
          }
        }
      } catch (e) {
        orphanResults.push({
          ok: false,
          reservation_id: r.reservation_id,
          error: e?.message || String(e),
        });
      }
    }
    reconcile = {
      skipped: false,
      scanned: orphans.scanned,
      candidates: orphans.reservations.length,
      results: orphanResults,
      refill: refillAfterOrphan,
    };
  }

  // 4) 可选：计数器超卖向下修正（需完整扫描）
  let counterFix = { skipped: true };
  if (opts.fixCounters === true) {
    // 保持旧行为入口；默认不启用完整扫描
    counterFix = { skipped: true, reason: 'disabled_by_default' };
    void computeCounterOvershoot;
  }

  return {
    lease_recovery: {
      candidates: expired.tasks.length,
      scanned: expired.scanned,
      recovered: leaseResults.filter((x) => x?.ok).length,
      results: leaseResults,
      refill: refillAfterLease,
    },
    promote: {
      ...promote,
      listed: listed.tasks.length,
      scanned: listed.scanned,
      source: listed.source,
    },
    reconcile,
    counter_fix: counterFix,
    now_ms: nowMs,
  };
}

/**
 * 释 1 平台槽后立刻同池补最多 1 个 waiting（必须经 acquire）。
 * 供 settle / failDispatch 调用。
 */
export async function releasePlatformSlotAndRefill(resourcePool, opts = {}) {
  const pool = String(resourcePool || '').trim();
  if (!pool) return { ok: false, reason: 'RESOURCE_POOL_REQUIRED' };
  const released = await releasePlatformConcurrencySlot(pool);
  const freed = Boolean(released?.ok) && !released?.already_empty;
  let refill = { skipped: true, claimed: 0 };
  if (freed && opts.skipRefill !== true) {
    const { tryRefillAfterSlotRelease } = await import('./queueScheduler.mjs');
    const nowMs = opts.nowMs ?? Date.now();
    const deps = buildSchedulerDeps(null, nowMs);
    const maxScanRows = Math.min(500000, Math.max(1000, opts.maxScanRows ?? 20000));
    refill = await tryRefillAfterSlotRelease(pool, deps, {
      listQueuedForPool: async (p, listOpts = {}) =>
        listQueuedTasksForPromote({
          maxTasks: listOpts.maxTasks ?? 20,
          maxScanRows,
          resourcePool: p,
        }),
      maxRefill: Math.max(0, Math.min(1, Number(opts.maxRefill ?? 1) || 0)),
    });
    if (refill?.claimed > 0 && opts.kickPipeline !== false) {
      kickChargeDispatchAfterRefill(refill.claimed);
    }
  }
  return {
    ok: true,
    resource_pool: pool,
    release: released,
    platform_slot_freed: freed,
    refill,
  };
}

function kickChargeDispatchAfterRefill(claimedCount) {
  const n = Math.max(1, Math.min(20, Number(claimedCount) || 1));
  Promise.resolve()
    .then(async () => {
      try {
        await runChargeClaimedTasks({ maxTasks: n * 2 });
      } catch (e) {
        console.warn('[refill] charge after claim', e?.message || e);
      }
      try {
        await runDispatchChargedTasks({ maxTasks: n });
      } catch (e) {
        console.warn('[refill] dispatch after claim', e?.message || e);
      }
    })
    .catch((e) => console.warn('[refill] pipeline kick', e?.message || e));
}

/**
 * 仅跑 orphan reservation + 指定 counter 修正（供 cron 低频调用）。
 */
export async function runOrphanReservationReconciliation(opts = {}) {
  return runPromoteQueuedTasks({
    ...opts,
    maxClaims: 0,
    reconcile: true,
  });
}

// ─── Phase 6：B′ 单行原子扣款 + nx_task_charges ───

export async function ensureTaskChargesTable() {
  const client = getClient();
  try {
    await client.createTable({
      tableMeta: {
        tableName: TASK_CHARGES_TABLE,
        primaryKey: [{ name: 'task_id', type: 'STRING' }],
      },
      reservedThroughput: { capacityUnit: { read: 0, write: 0 } },
      tableOptions: { timeToLive: -1, maxVersions: 1 },
    });
    return { created: true, table: TASK_CHARGES_TABLE };
  } catch (e) {
    const msg = String(e?.message || e || '');
    if (/OTSObjectAlreadyExist|already exist|AlreadyExist/i.test(msg)) {
      return { created: false, table: TASK_CHARGES_TABLE };
    }
    throw e;
  }
}

// ─── nx_task_work：活跃任务投影（Timer / queue-position 只扫此表）───

export async function ensureTaskWorkTable() {
  const client = getClient();
  try {
    await client.createTable({
      tableMeta: {
        tableName: TASK_WORK_TABLE,
        primaryKey: [{ name: 'task_id', type: 'STRING' }],
      },
      reservedThroughput: { capacityUnit: { read: 0, write: 0 } },
      tableOptions: { timeToLive: -1, maxVersions: 1 },
    });
    return { created: true, table: TASK_WORK_TABLE };
  } catch (e) {
    const msg = String(e?.message || e || '');
    if (/OTSObjectAlreadyExist|already exist|AlreadyExist/i.test(msg)) {
      return { created: false, table: TASK_WORK_TABLE };
    }
    throw e;
  }
}

function taskWorkRowFromAttrs(taskId, attrs) {
  return {
    task_id: String(taskId || ''),
    user_id: String(attrs.user_id || ''),
    task_type: String(attrs.task_type || ''),
    resource_pool: String(attrs.resource_pool || ''),
    status: String(attrs.status || ''),
    queue_entered_at: toTaskTsMs(attrs.queue_entered_at, 0),
    created_at: toTaskTsMs(attrs.created_at, 0),
    updated_at: toTaskTsMs(attrs.updated_at, 0),
    next_poll_at: toTaskTsMs(attrs.next_poll_at, 0),
    provider_task_id: String(attrs.provider_task_id || ''),
    execution_stage: String(attrs.execution_stage || ''),
    model_id: String(attrs.model_id || ''),
    claim_token: String(attrs.claim_token || ''),
    reservation_id: String(attrs.reservation_id || ''),
    lease_expires_at: toTaskTsMs(attrs.lease_expires_at, 0),
  };
}

export async function getTaskWork(taskId) {
  const tid = String(taskId || '').trim();
  if (!tid) return null;
  const client = getClient();
  const res = await client.getRow({
    tableName: TASK_WORK_TABLE,
    primaryKey: [{ task_id: tid }],
  });
  if (!res.row?.attributes?.length) return null;
  return taskWorkRowFromAttrs(tid, attrsToObj(res.row.attributes));
}

/** 写入/覆盖活跃投影行（瘦属性，无 prompt/workflow 大 JSON） */
export async function upsertTaskWork(row) {
  const tid = String(row?.task_id || row?.taskId || '').trim();
  if (!tid) throw new Error('TASK_WORK_TASK_ID_REQUIRED');
  const client = getClient();
  const nowMs = Date.now();
  const prev = (await getTaskWork(tid)) || {};
  const merged = {
    user_id: row.user_id != null ? String(row.user_id) : String(prev.user_id || ''),
    task_type: row.task_type != null ? String(row.task_type) : String(prev.task_type || ''),
    resource_pool:
      row.resource_pool != null ? String(row.resource_pool) : String(prev.resource_pool || ''),
    status: row.status != null ? String(row.status) : String(prev.status || ''),
    queue_entered_at:
      row.queue_entered_at != null
        ? toTaskTsMs(row.queue_entered_at, 0)
        : toTaskTsMs(prev.queue_entered_at, 0),
    created_at:
      row.created_at != null ? toTaskTsMs(row.created_at, nowMs) : toTaskTsMs(prev.created_at, nowMs),
    updated_at: row.updated_at != null ? toTaskTsMs(row.updated_at, nowMs) : nowMs,
    next_poll_at:
      row.next_poll_at != null ? toTaskTsMs(row.next_poll_at, 0) : toTaskTsMs(prev.next_poll_at, 0),
    provider_task_id:
      row.provider_task_id != null
        ? String(row.provider_task_id)
        : String(prev.provider_task_id || ''),
    execution_stage:
      row.execution_stage != null
        ? String(row.execution_stage)
        : String(prev.execution_stage || ''),
    model_id: row.model_id != null ? String(row.model_id) : String(prev.model_id || ''),
    claim_token:
      row.claim_token != null ? String(row.claim_token) : String(prev.claim_token || ''),
    reservation_id:
      row.reservation_id != null
        ? String(row.reservation_id)
        : String(prev.reservation_id || ''),
    lease_expires_at:
      row.lease_expires_at != null
        ? toTaskTsMs(row.lease_expires_at, 0)
        : toTaskTsMs(prev.lease_expires_at, 0),
  };
  const cols = [
    { user_id: merged.user_id },
    { task_type: merged.task_type },
    { resource_pool: merged.resource_pool },
    { status: merged.status },
    { provider_task_id: merged.provider_task_id },
    { execution_stage: merged.execution_stage },
    { model_id: merged.model_id },
    { claim_token: merged.claim_token },
    { reservation_id: merged.reservation_id },
    { created_at: txTsInt64(merged.created_at, nowMs) },
    { updated_at: txTsInt64(merged.updated_at, nowMs) },
  ];
  if (merged.queue_entered_at > 0) cols.push({ queue_entered_at: txTsInt64(merged.queue_entered_at, nowMs) });
  if (merged.next_poll_at > 0) cols.push({ next_poll_at: txTsInt64(merged.next_poll_at, nowMs) });
  if (merged.lease_expires_at > 0) cols.push({ lease_expires_at: txTsInt64(merged.lease_expires_at, nowMs) });
  await client.putRow({
    tableName: TASK_WORK_TABLE,
    condition: new TableStore.Condition(TableStore.RowExistenceExpectation.IGNORE, null),
    primaryKey: [{ task_id: tid }],
    attributeColumns: cols,
  });
  return { ok: true, task_id: tid };
}

export async function updateTaskWork(taskId, patch = {}) {
  const tid = String(taskId || '').trim();
  if (!tid) return { ok: false, reason: 'TASK_ID_REQUIRED' };
  const prev = await getTaskWork(tid);
  if (!prev) {
    // 投影缺失时用 patch 建行（bootstrap），不阻断主路径
    if (patch && (patch.status || patch.user_id)) {
      await upsertTaskWork({ task_id: tid, ...patch });
      return { ok: true, created: true };
    }
    return { ok: false, reason: 'NOT_FOUND' };
  }
  await upsertTaskWork({ ...prev, ...patch, task_id: tid });
  return { ok: true };
}

export async function deleteTaskWork(taskId) {
  const tid = String(taskId || '').trim();
  if (!tid) return { ok: false };
  const client = getClient();
  try {
    await client.deleteRow({
      tableName: TASK_WORK_TABLE,
      condition: new TableStore.Condition(TableStore.RowExistenceExpectation.IGNORE, null),
      primaryKey: [{ task_id: tid }],
    });
    return { ok: true };
  } catch (e) {
    console.warn('[deleteTaskWork]', tid, e?.message || e);
    return { ok: false, error: e?.message || String(e) };
  }
}

async function scanTaskWorkMatching(pred, { maxTasks = 100, maxScanRows = 20000 } = {}) {
  const client = getClient();
  const out = [];
  let nextStart = [{ task_id: TableStore.INF_MIN }];
  const endPK = [{ task_id: TableStore.INF_MAX }];
  let scanned = 0;
  while (out.length < maxTasks && scanned < maxScanRows) {
    const res = await getRangePromise(client, {
      tableName: TASK_WORK_TABLE,
      direction: TableStore.Direction.FORWARD,
      inclusiveStartPrimaryKey: nextStart,
      exclusiveEndPrimaryKey: endPK,
      limit: 500,
    });
    for (const row of res.rows || []) {
      scanned += 1;
      const taskId = taskIdFromTaskRow(row);
      if (!taskId) continue;
      const attrs = attrsToObj(row.attributes);
      const mapped = taskWorkRowFromAttrs(taskId, attrs);
      if (pred(mapped, attrs)) {
        out.push(mapped);
        if (out.length >= maxTasks) break;
      }
    }
    const nextPk = res.next_start_primary_key || res.nextStartPrimaryKey;
    if (!nextPk) break;
    nextStart = otsNextPkToShorthand(nextPk) ?? nextPk;
  }
  return { rows: out, scanned };
}

/**
 * 空闲探测：工作表是否还有任意活跃行（最多扫到找到 1 行即停）。
 * Timer 用此决定是否「零巡逻」直接 return。
 */
export async function countTaskWorkActive({ maxScanRows = 2000 } = {}) {
  const { rows, scanned } = await scanTaskWorkMatching(() => true, {
    maxTasks: 1,
    maxScanRows: Math.min(50000, Math.max(1, maxScanRows)),
  });
  return {
    count: rows.length,
    has_any: rows.length > 0,
    scanned,
    table: TASK_WORK_TABLE,
  };
}

export async function listTaskWorkForPromote({
  maxTasks = 100,
  maxScanRows = 20000,
  taskType = null,
  resourcePool = null,
} = {}) {
  const { normalizeTaskStatus } = await import('./taskStatusMachine.mjs');
  const { resolveResourcePoolFromTaskRow } = await import('./resourcePool.mjs');
  const typeFilter = taskType
    ? String(taskType)
        .trim()
        .toLowerCase()
    : null;
  const poolFilter = resourcePool
    ? String(resourcePool)
        .trim()
        .toLowerCase()
    : null;
  const { rows, scanned } = await scanTaskWorkMatching(
    (w) => {
      if (normalizeTaskStatus(w.status) !== 'queued') return false;
      const tt = String(w.task_type || '').toLowerCase();
      if (tt !== 'video' && tt !== 'image' && tt !== 'audio') return false;
      if (typeFilter && tt !== typeFilter) return false;
      const rp =
        resolveResourcePoolFromTaskRow({
          task_type: tt,
          resource_pool: w.resource_pool,
          model_id: w.model_id,
        }) || '';
      if (poolFilter && rp !== poolFilter) return false;
      return Boolean(w.task_id && w.user_id);
    },
    { maxTasks, maxScanRows },
  );
  return {
    tasks: rows.map((w) => {
      const tt = String(w.task_type || '').toLowerCase();
      const rp =
        resolveResourcePoolFromTaskRow({
          task_type: tt,
          resource_pool: w.resource_pool,
          model_id: w.model_id,
        }) || '';
      return {
        taskId: w.task_id,
        userId: w.user_id,
        taskType: tt,
        resourcePool: rp,
        modelId: String(w.model_id || ''),
        queueEnteredAt: w.queue_entered_at || w.created_at || 0,
      };
    }),
    scanned,
  };
}

export async function listExpiredClaimedFromTaskWork({
  maxTasks = 50,
  maxScanRows = 20000,
  nowMs = Date.now(),
} = {}) {
  const { normalizeTaskStatus } = await import('./taskStatusMachine.mjs');
  const { rows, scanned } = await scanTaskWorkMatching(
    (w) => {
      if (normalizeTaskStatus(w.status) !== 'claimed') return false;
      const leaseExp = Number(w.lease_expires_at) || 0;
      return leaseExp > 0 && leaseExp <= nowMs && w.task_id && w.user_id;
    },
    { maxTasks, maxScanRows },
  );
  return {
    tasks: rows.map((w) => ({
      taskId: w.task_id,
      userId: w.user_id,
      taskType: String(w.task_type || '').toLowerCase(),
      resourcePool: String(w.resource_pool || ''),
      claimToken: String(w.claim_token || ''),
      reservationId: String(w.reservation_id || ''),
      leaseExpiresAt: Number(w.lease_expires_at) || 0,
    })),
    scanned,
  };
}

/** claimed 且待 charge（stage 非 charged/done/error） */
export async function listTaskWorkForCharge({ maxTasks = 20, maxScanRows = 20000 } = {}) {
  const { rows, scanned } = await scanTaskWorkMatching(
    (w) => {
      if (String(w.status || '').toLowerCase() !== 'claimed') return false;
      const stage = String(w.execution_stage || '').toLowerCase();
      if (stage === 'charged' || stage === 'done' || stage === 'error') return false;
      return Boolean(w.task_id);
    },
    { maxTasks, maxScanRows },
  );
  return { taskIds: rows.map((w) => w.task_id), scanned };
}

/** work 表按 pred 列出 task_id；供 dispatch/poll/recovery 优先使用 */
export async function listTaskWorkIdsMatching(pred, opts = {}) {
  const { rows, scanned } = await scanTaskWorkMatching((w) => pred(w), opts);
  return { taskIds: rows.map((w) => w.task_id), scanned, rows };
}

export async function deleteTaskById(taskId) {
  const tid = String(taskId || '').trim();
  if (!tid) return { ok: false, reason: 'TASK_ID_REQUIRED' };
  const client = getClient();
  await client.deleteRow({
    tableName: TASKS_TABLE,
    condition: new TableStore.Condition(TableStore.RowExistenceExpectation.IGNORE, null),
    primaryKey: [{ task_id: tid }],
  });
  try {
    await deleteTaskWork(tid);
  } catch (_) {}
  return { ok: true, task_id: tid };
}

export async function deleteTaskCharge(taskId) {
  const tid = String(taskId || '').trim();
  if (!tid) return { ok: false, reason: 'TASK_ID_REQUIRED' };
  const client = getClient();
  try {
    await client.deleteRow({
      tableName: TASK_CHARGES_TABLE,
      condition: new TableStore.Condition(TableStore.RowExistenceExpectation.IGNORE, null),
      primaryKey: [{ task_id: tid }],
    });
    return { ok: true, task_id: tid };
  } catch (e) {
    return { ok: false, error: e?.message || String(e) };
  }
}

export async function deleteTransactionById(txId) {
  const id = String(txId || '').trim();
  if (!id) return { ok: false, reason: 'TX_ID_REQUIRED' };
  const client = getClient();
  await client.deleteRow({
    tableName: TX_TABLE,
    condition: new TableStore.Condition(TableStore.RowExistenceExpectation.IGNORE, null),
    primaryKey: txPrimaryKey(id),
  });
  return { ok: true, transaction_id: id };
}

/**
 * 扫描终端态任务（供 retention cleanup）：success|failed|cancelled|timeout 且时间早于 cutoffMs。
 */
export async function listTerminalTasksForRetention({
  cutoffMs,
  maxTasks = 200,
  maxScanRows = 50000,
} = {}) {
  const client = getClient();
  const terminal = new Set(['success', 'failed', 'cancelled', 'timeout']);
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
      columnToGet: ['status', 'updated_at', 'created_at', 'user_id'],
    });
    for (const row of res.rows || []) {
      scanned += 1;
      const attrs = attrsToObj(row.attributes);
      const st = String(attrs.status || '').toLowerCase();
      if (!terminal.has(st)) continue;
      const ts = toTaskTsMs(attrs.updated_at, toTaskTsMs(attrs.created_at, 0));
      if (!(ts > 0) || ts >= cutoffMs) continue;
      const taskId = taskIdFromTaskRow(row);
      if (!taskId) continue;
      out.push({ taskId, userId: String(attrs.user_id || ''), status: st, ts });
      if (out.length >= maxTasks) break;
    }
    const nextPk = res.next_start_primary_key || res.nextStartPrimaryKey;
    if (!nextPk) break;
    nextStart = otsNextPkToShorthand(nextPk) ?? nextPk;
  }
  return { tasks: out, scanned };
}

/**
 * 列出某用户全部流水 id（GSI），按 created_at 倒序，供保留最近 N 条。
 */
export async function listTransactionIdsForUserRetention(userId, { maxScan = 5000 } = {}) {
  const uid = String(userId || '').trim();
  if (!uid) return [];
  const collected = await listAllGsiTransactionsForUser(uid, maxScan);
  await hydrateTransactionCreatedAt(collected);
  collected.sort((a, b) => {
    const dt = txTimeMs(b.created_at) - txTimeMs(a.created_at);
    if (dt !== 0) return dt;
    return String(b.tx_id || '').localeCompare(String(a.tx_id || ''));
  });
  return collected.map((r) => ({
    tx_id: r.tx_id,
    type: String(r.type || '').toLowerCase(),
    created_at: r.created_at,
  }));
}

/** 扫描 nx_users 主键，供流水保留批处理 */
export async function listAllUserIds({ maxUsers = 5000, maxScanRows = 20000 } = {}) {
  const client = getClient();
  const out = [];
  let nextStart = [{ user_id: TableStore.INF_MIN }];
  const endPK = [{ user_id: TableStore.INF_MAX }];
  let scanned = 0;
  while (out.length < maxUsers && scanned < maxScanRows) {
    const res = await getRangePromise(client, {
      tableName: USERS_TABLE,
      direction: TableStore.Direction.FORWARD,
      inclusiveStartPrimaryKey: nextStart,
      exclusiveEndPrimaryKey: endPK,
      limit: 200,
      columnToGet: ['created_at'],
    });
    for (const row of res.rows || []) {
      scanned += 1;
      const uid = pkColumnValue(row.primaryKey || [], 'user_id');
      if (uid) out.push(String(uid));
      if (out.length >= maxUsers) break;
    }
    const nextPk = res.next_start_primary_key || res.nextStartPrimaryKey;
    if (!nextPk) break;
    nextStart = otsNextPkToShorthand(nextPk) ?? nextPk;
  }
  return { userIds: out, scanned };
}

/**
 * OTS 成本保留清理：
 * - 终端任务 success|failed|cancelled|timeout 超过 taskRetentionDays（默认 3）→ 删 nx_tasks + charge + work
 * - 每用户流水保留最新 txKeepPerUser（默认 100）条
 * dryRun 默认 true；apply=true 才真正 delete。
 */
export async function runOtsRetentionCleanup(opts = {}) {
  const dryRun =
    opts.apply === true || opts.apply === 1 || opts.apply === '1' || opts.dryRun === false
      ? false
      : true;
  const taskRetentionDays = Math.max(
    1,
    Number(opts.taskRetentionDays ?? opts.task_retention_days ?? 3) || 3,
  );
  const txKeepPerUser = Math.max(
    10,
    Number(opts.txKeepPerUser ?? opts.tx_keep_per_user ?? 100) || 100,
  );
  const maxTaskDeletes = Math.min(
    5000,
    Math.max(1, Number(opts.maxTaskDeletes ?? opts.max_task_deletes ?? 500) || 500),
  );
  const maxTxDeletes = Math.min(
    20000,
    Math.max(1, Number(opts.maxTxDeletes ?? opts.max_tx_deletes ?? 2000) || 2000),
  );
  const cutoffMs = Date.now() - taskRetentionDays * 24 * 60 * 60 * 1000;

  const skipTasks =
    opts.skipTasks === true || opts.skip_tasks === true || opts.skip_tasks === '1';
  const skipTx =
    opts.skipTx === true ||
    opts.skip_tx === true ||
    opts.skip_tx === '1' ||
    opts.tasksOnly === true ||
    opts.tasks_only === true ||
    opts.tasks_only === '1';
  const log = (...a) => console.log('[runOtsRetentionCleanup]', ...a);

  const taskStats = {
    scanned: 0,
    matched: 0,
    deleted: 0,
    charges_deleted: 0,
    work_deleted: 0,
    errors: 0,
  };
  let taskBatchSafety = 0;
  const maxScanRows = Math.min(
    200000,
    Math.max(500, Number(opts.maxScanRows ?? opts.max_scan_rows ?? 10000) || 10000),
  );
  if (!skipTasks) {
    log(`tasks begin dry_run=${dryRun} cutoff=${new Date(cutoffMs).toISOString()} maxScanRows=${maxScanRows}`);
    while (taskStats.deleted + (dryRun ? taskStats.matched : 0) < maxTaskDeletes && taskBatchSafety < 50) {
      taskBatchSafety += 1;
      const batchStarted = Date.now();
      const { tasks, scanned } = await listTerminalTasksForRetention({
        cutoffMs,
        maxTasks: Math.min(200, maxTaskDeletes - (dryRun ? taskStats.matched : taskStats.deleted)),
        maxScanRows,
      });
      taskStats.scanned += scanned;
      log(
        `task batch#${taskBatchSafety} scanned=${scanned} matched=${tasks.length} elapsed_ms=${Date.now() - batchStarted}`,
      );
      if (!tasks.length) break;
      for (const t of tasks) {
        taskStats.matched += 1;
        if (dryRun) continue;
        try {
          const ch = await deleteTaskCharge(t.taskId);
          if (ch.ok) taskStats.charges_deleted += 1;
          const w = await deleteTaskWork(t.taskId);
          if (w.ok) taskStats.work_deleted += 1;
          await deleteTaskById(t.taskId);
          taskStats.deleted += 1;
          if (taskStats.deleted % 25 === 0) {
            log(`tasks deleted=${taskStats.deleted}/${maxTaskDeletes}`);
          }
        } catch (e) {
          taskStats.errors += 1;
          console.warn('[runOtsRetentionCleanup] task', t.taskId, e?.message || e);
        }
        if (taskStats.deleted >= maxTaskDeletes) break;
      }
      if (dryRun) break; // dry-run 只预览一批
    }
    log(`tasks done matched=${taskStats.matched} deleted=${taskStats.deleted} scanned=${taskStats.scanned}`);
  } else {
    log('tasks skipped');
  }

  const txStats = {
    users_scanned: 0,
    kept: 0,
    matched_delete: 0,
    deleted: 0,
    errors: 0,
  };
  if (!skipTx) {
    log('tx begin');
    const { userIds } = await listAllUserIds({
      maxUsers: opts.maxUsers ?? 5000,
      maxScanRows: opts.maxUserScanRows ?? 20000,
    });
    log(`users listed=${userIds.length}`);
    for (const uid of userIds) {
      txStats.users_scanned += 1;
      if (txStats.users_scanned % 50 === 0) {
        log(`tx users_scanned=${txStats.users_scanned} deleted=${txStats.deleted}`);
      }
      try {
        const rows = await listTransactionIdsForUserRetention(uid, {
          maxScan: opts.maxTxScanPerUser ?? 5000,
        });
        if (rows.length <= txKeepPerUser) {
          txStats.kept += rows.length;
          continue;
        }
        txStats.kept += txKeepPerUser;
        const older = rows.slice(txKeepPerUser);
        for (const row of older) {
          if (txStats.deleted + (dryRun ? txStats.matched_delete : 0) >= maxTxDeletes) break;
          txStats.matched_delete += 1;
          if (dryRun) continue;
          try {
            await deleteTransactionById(row.tx_id);
            txStats.deleted += 1;
          } catch (e) {
            txStats.errors += 1;
            console.warn('[runOtsRetentionCleanup] tx', row.tx_id, e?.message || e);
          }
        }
      } catch (e) {
        txStats.errors += 1;
        console.warn('[runOtsRetentionCleanup] user txs', uid, e?.message || e);
      }
      if (txStats.deleted >= maxTxDeletes && !dryRun) break;
      if (dryRun && txStats.matched_delete >= maxTxDeletes) break;
    }
    log(`tx done deleted=${txStats.deleted} matched=${txStats.matched_delete}`);
  } else {
    log('tx skipped');
  }

  return {
    ok: true,
    dry_run: dryRun,
    cutoff_ms: cutoffMs,
    task_retention_days: taskRetentionDays,
    tx_keep_per_user: txKeepPerUser,
    skip_tasks: skipTasks,
    skip_tx: skipTx,
    tasks: taskStats,
    transactions: txStats,
    note: dryRun
      ? 'DRY_RUN：未删除。设 APPLY=1 或 opts.apply=true 执行删除。'
      : 'APPLY：已按限额删除。',
  };
}

export function phase6ChargeOperationId(taskId) {
  return `chg_${String(taskId || '').trim()}`;
}

export function phase6RefundOperationId(taskId) {
  return `ref_${String(taskId || '').trim()}`;
}

export function phase6OpHash(operationId) {
  return crypto.createHash('sha256').update(String(operationId || '')).digest('hex').slice(0, 16);
}

export function phase6DebitReceiptCol(operationId) {
  return `dr_${phase6OpHash(operationId)}`;
}

export function phase6RefundReceiptCol(refundOpId) {
  return `rr_${phase6OpHash(refundOpId)}`;
}

export async function getDebitReceiptSot(userId, operationId) {
  const u = await getUserById(userId);
  if (!u) return 'NOT_APPLIED';
  const col = phase6DebitReceiptCol(operationId);
  const v = u.receiptColumns?.[col];
  return Number(v) === 1 ? 'APPLIED' : 'NOT_APPLIED';
}

export async function getRefundReceiptSot(userId, refundOperationId) {
  const u = await getUserById(userId);
  if (!u) return 'NOT_APPLIED';
  const col = phase6RefundReceiptCol(refundOperationId);
  const v = u.receiptColumns?.[col];
  return Number(v) === 1 ? 'APPLIED' : 'NOT_APPLIED';
}

/**
 * B′ Money SoT：同一 UpdateRow 内 balance INCREMENT + debit receipt PUT
 */
export async function atomicDebitWithReceipt(userId, operationId, amount) {
  const uid = String(userId || '').trim();
  const amt = toTxIntegerAmount(amount);
  if (!uid) return { ok: false, reason: 'USER_ID_REQUIRED' };
  if (amt < 0) return { ok: false, reason: 'INVALID_AMOUNT' };

  const receiptCol = phase6DebitReceiptCol(operationId);
  const client = getClient();
  const nowMs = Date.now();

  if (amt === 0) {
    const receiptCond = new TableStore.SingleColumnCondition(
      receiptCol,
      txInt64(1),
      TableStore.ComparatorType.NOT_EQUAL,
      true,
    );
    try {
      await client.updateRow({
        tableName: USERS_TABLE,
        condition: new TableStore.Condition(
          TableStore.RowExistenceExpectation.EXPECT_EXIST,
          receiptCond,
        ),
        primaryKey: [{ user_id: uid }],
        updateOfAttributeColumns: [
          { PUT: [{ [receiptCol]: txInt64(1) }, { updated_at: txTsInt64(nowMs) }] },
        ],
      });
    } catch (e) {
      if (isOtsConditionFail(e)) {
        const sot = await getDebitReceiptSot(uid, operationId);
        if (sot === 'APPLIED') return { ok: false, reason: 'ALREADY_APPLIED', money_sot: 'APPLIED' };
        return { ok: false, reason: 'CONDITION_FAIL' };
      }
      throw e;
    }
    const u = await getUserById(uid);
    return { ok: true, balance: u?.balance ?? 0, money_sot: 'APPLIED' };
  }

  const cond = new TableStore.CompositeCondition(TableStore.LogicalOperator.AND);
  cond.addSubCondition(
    new TableStore.SingleColumnCondition(
      'balance',
      txInt64(amt),
      TableStore.ComparatorType.GREATER_EQUAL,
      false,
    ),
  );
  cond.addSubCondition(
    new TableStore.SingleColumnCondition(
      receiptCol,
      txInt64(1),
      TableStore.ComparatorType.NOT_EQUAL,
      true,
    ),
  );

  try {
    await client.updateRow({
      tableName: USERS_TABLE,
      condition: new TableStore.Condition(TableStore.RowExistenceExpectation.EXPECT_EXIST, cond),
      primaryKey: [{ user_id: uid }],
      updateOfAttributeColumns: [
        { INCREMENT: [{ balance: txInt64(-amt) }] },
        { PUT: [{ [receiptCol]: txInt64(1) }, { updated_at: txTsInt64(nowMs) }] },
      ],
    });
  } catch (e) {
    if (isOtsConditionFail(e)) {
      const sot = await getDebitReceiptSot(uid, operationId);
      if (sot === 'APPLIED') return { ok: false, reason: 'ALREADY_APPLIED', money_sot: 'APPLIED' };
      return { ok: false, reason: 'BALANCE_INSUFFICIENT', money_sot: 'NOT_APPLIED' };
    }
    throw e;
  }
  const u = await getUserById(uid);
  return { ok: true, balance: u?.balance ?? 0, money_sot: 'APPLIED' };
}

export async function atomicCreditWithReceipt(userId, refundOperationId, amount) {
  const uid = String(userId || '').trim();
  const amt = toTxIntegerAmount(amount);
  if (!uid) return { ok: false, reason: 'USER_ID_REQUIRED' };
  if (amt < 0) return { ok: false, reason: 'INVALID_AMOUNT' };

  const receiptCol = phase6RefundReceiptCol(refundOperationId);
  const client = getClient();
  const nowMs = Date.now();

  const receiptCond = new TableStore.SingleColumnCondition(
    receiptCol,
    txInt64(1),
    TableStore.ComparatorType.NOT_EQUAL,
    true,
  );

  try {
    await client.updateRow({
      tableName: USERS_TABLE,
      condition: new TableStore.Condition(
        TableStore.RowExistenceExpectation.EXPECT_EXIST,
        receiptCond,
      ),
      primaryKey: [{ user_id: uid }],
      updateOfAttributeColumns: [
        ...(amt > 0 ? [{ INCREMENT: [{ balance: txInt64(amt) }] }] : []),
        { PUT: [{ [receiptCol]: txInt64(1) }, { updated_at: txTsInt64(nowMs) }] },
      ],
    });
  } catch (e) {
    if (isOtsConditionFail(e)) {
      const sot = await getRefundReceiptSot(uid, refundOperationId);
      if (sot === 'APPLIED') return { ok: false, reason: 'ALREADY_APPLIED', money_sot: 'APPLIED' };
      return { ok: false, reason: 'CONDITION_FAIL', money_sot: 'NOT_APPLIED' };
    }
    throw e;
  }
  const u = await getUserById(uid);
  return { ok: true, balance: u?.balance ?? 0, money_sot: 'APPLIED' };
}

export async function getTaskCharge(taskId) {
  const tid = String(taskId || '').trim();
  if (!tid) return null;
  const client = getClient();
  const res = await client.getRow({
    tableName: TASK_CHARGES_TABLE,
    primaryKey: [{ task_id: tid }],
  });
  if (!res.row?.attributes?.length) return null;
  const attrs = attrsToObj(res.row.attributes);
  return {
    task_id: tid,
    charge_id: String(attrs.charge_id || tid),
    operation_id: String(attrs.operation_id || ''),
    user_id: String(attrs.user_id || ''),
    amount: parseInt(String(attrs.amount ?? '0'), 10) || 0,
    status: String(attrs.status || ''),
    ledger_tx_id: String(attrs.ledger_tx_id || ''),
    error_code: String(attrs.error_code || ''),
    created_at: toTaskTsMs(attrs.created_at, 0),
    updated_at: toTaskTsMs(attrs.updated_at, 0),
    charged_at: toTaskTsMs(attrs.charged_at, 0),
    refunded_at: toTaskTsMs(attrs.refunded_at, 0),
  };
}

export async function tryBeginTaskCharge(row) {
  const tid = String(row?.task_id || '').trim();
  if (!tid) throw new Error('TASK_ID_REQUIRED');
  const client = getClient();
  const nowMs = Date.now();
  try {
    await client.putRow({
      tableName: TASK_CHARGES_TABLE,
      condition: new TableStore.Condition(TableStore.RowExistenceExpectation.EXPECT_NOT_EXIST, null),
      primaryKey: [{ task_id: tid }],
      attributeColumns: [
        { charge_id: String(row.charge_id || tid) },
        { operation_id: String(row.operation_id || phase6ChargeOperationId(tid)) },
        { user_id: String(row.user_id || '') },
        { amount: txInt64(toTxIntegerAmount(row.amount)) },
        { status: 'pending' },
        { ledger_tx_id: String(row.ledger_tx_id || '') },
        { error_code: '' },
        { created_at: txTsInt64(nowMs) },
        { updated_at: txTsInt64(nowMs) },
      ],
    });
    return { created: true, task_id: tid };
  } catch (e) {
    if (isOtsConditionFail(e)) {
      const existing = await getTaskCharge(tid);
      return { created: false, existing, task_id: tid };
    }
    throw e;
  }
}

export async function markTaskChargeFailed(taskId, userId, errorCode, extra = {}) {
  const tid = String(taskId || '').trim();
  const prev = (await getTaskCharge(tid)) || {
    task_id: tid,
    charge_id: tid,
    operation_id: phase6ChargeOperationId(tid),
    user_id: userId,
    amount: extra.amount ?? 0,
    ledger_tx_id: extra.ledgerTxId || '',
  };
  const client = getClient();
  const nowMs = Date.now();
  await client.putRow({
    tableName: TASK_CHARGES_TABLE,
    condition: new TableStore.Condition(TableStore.RowExistenceExpectation.IGNORE, null),
    primaryKey: [{ task_id: tid }],
    attributeColumns: [
      { charge_id: prev.charge_id || tid },
      { operation_id: prev.operation_id || phase6ChargeOperationId(tid) },
      { user_id: String(prev.user_id || userId || '') },
      { amount: txInt64(toTxIntegerAmount(prev.amount)) },
      { status: 'failed' },
      { ledger_tx_id: String(prev.ledger_tx_id || '') },
      { error_code: String(errorCode || '') },
      { created_at: txTsInt64(prev.created_at || nowMs, nowMs) },
      { updated_at: txTsInt64(nowMs) },
    ],
  });
}

export async function markTaskChargeRefunded(taskId) {
  const prev = await getTaskCharge(taskId);
  if (!prev) return;
  const client = getClient();
  const nowMs = Date.now();
  await client.putRow({
    tableName: TASK_CHARGES_TABLE,
    condition: new TableStore.Condition(TableStore.RowExistenceExpectation.IGNORE, null),
    primaryKey: [{ task_id: prev.task_id }],
    attributeColumns: [
      { charge_id: prev.charge_id },
      { operation_id: prev.operation_id },
      { user_id: prev.user_id },
      { amount: txInt64(prev.amount) },
      { status: 'refunded' },
      { ledger_tx_id: prev.ledger_tx_id },
      { error_code: prev.error_code || '' },
      { created_at: txTsInt64(prev.created_at || nowMs, nowMs) },
      { updated_at: txTsInt64(nowMs) },
      { charged_at: txTsInt64(prev.charged_at || nowMs, nowMs) },
      { refunded_at: txTsInt64(nowMs) },
    ],
  });
}

export async function ensureTaskAwaitingCharge(taskId) {
  const tid = String(taskId || '').trim();
  const client = getClient();
  const nowMs = Date.now();
  const cond = new TableStore.CompositeCondition(TableStore.LogicalOperator.AND);
  cond.addSubCondition(
    new TableStore.SingleColumnCondition(
      'status',
      'claimed',
      TableStore.ComparatorType.EQUAL,
      false,
    ),
  );
  // 仅当 stage 缺失或空字符串时写入 awaiting_charge；已 charged 不会被覆盖
  cond.addSubCondition(
    new TableStore.SingleColumnCondition(
      'execution_stage',
      '',
      TableStore.ComparatorType.EQUAL,
      true,
    ),
  );
  try {
    await client.updateRow({
      tableName: TASKS_TABLE,
      condition: new TableStore.Condition(TableStore.RowExistenceExpectation.EXPECT_EXIST, cond),
      primaryKey: [{ task_id: tid }],
      updateOfAttributeColumns: [
        {
          PUT: [
            { execution_stage: 'awaiting_charge' },
            { updated_at: txTsInt64(nowMs) },
          ],
        },
      ],
    });
    return { ok: true };
  } catch (e) {
    if (isOtsConditionFail(e)) return { ok: false, reason: 'CONDITION_FAIL' };
    throw e;
  }
}

/**
 * Money SoT 已 APPLIED 后的可重试 finalize（不改余额）
 */
export async function finalizePhase6ChargeArtifacts({ taskId, userId, amount, operationId }) {
  const tid = String(taskId || '').trim();
  const uid = String(userId || '').trim();
  const amt = toTxIntegerAmount(amount);
  const opId = operationId || phase6ChargeOperationId(tid);
  const ledgerTxId = (() => {
    const h = crypto.createHash('sha256').update(`${uid}|${tid}`).digest('hex');
    return `idem_${h}`;
  })();
  const client = getClient();
  const nowMs = Date.now();

  // ledger mirror（非 Money SoT）
  if (amt >= 1) {
    try {
      const exist = await client.getRow({
        tableName: TX_TABLE,
        primaryKey: txPrimaryKey(ledgerTxId),
      });
      const attrs = exist.row?.attributes?.length ? attrsToObj(exist.row.attributes) : null;
      if (!attrs || (attrs.type !== 'consume' && attrs.type !== 'consume_pending')) {
        const u = await getUserById(uid);
        await client.putRow({
          tableName: TX_TABLE,
          condition: new TableStore.Condition(TableStore.RowExistenceExpectation.IGNORE, null),
          primaryKey: txPrimaryKey(ledgerTxId),
          attributeColumns: [
            { user_id: uid },
            { task_id: tid },
            { amount: txInt64(-amt) },
            { type: 'consume' },
            { provider: 'phase6_charge' },
            { description: `phase6:${opId}` },
            { created_at: txTsInt64(nowMs) },
            { balance_after: txInt64(u?.balance ?? 0) },
          ],
        });
      } else if (attrs.type === 'consume_pending') {
        const u = await getUserById(uid);
        await client.putRow({
          tableName: TX_TABLE,
          condition: new TableStore.Condition(TableStore.RowExistenceExpectation.EXPECT_EXIST, null),
          primaryKey: txPrimaryKey(ledgerTxId),
          attributeColumns: [
            { user_id: uid },
            { task_id: tid },
            { amount: txInt64(-amt) },
            { type: 'consume' },
            { provider: 'phase6_charge' },
            { description: `phase6:${opId}` },
            { created_at: txTsInt64(nowMs) },
            { balance_after: txInt64(u?.balance ?? 0) },
          ],
        });
      }
    } catch (e) {
      console.error('[phase6] ledger finalize failed (will retry on recovery)', e?.message || e);
      // 不抛：Money 已扣，recovery 会再补
    }
  }

  const prev = (await getTaskCharge(tid)) || {
    charge_id: tid,
    operation_id: opId,
    user_id: uid,
    amount: amt,
    ledger_tx_id: ledgerTxId,
    created_at: nowMs,
  };
  await client.putRow({
    tableName: TASK_CHARGES_TABLE,
    condition: new TableStore.Condition(TableStore.RowExistenceExpectation.IGNORE, null),
    primaryKey: [{ task_id: tid }],
    attributeColumns: [
      { charge_id: prev.charge_id || tid },
      { operation_id: prev.operation_id || opId },
      { user_id: uid },
      { amount: txInt64(amt) },
      { status: 'charged' },
      { ledger_tx_id: prev.ledger_tx_id || ledgerTxId },
      { error_code: '' },
      { created_at: txTsInt64(prev.created_at || nowMs, nowMs) },
      { updated_at: txTsInt64(nowMs) },
      { charged_at: txTsInt64(prev.charged_at || nowMs, nowMs) },
    ],
  });

  await upsertTask(tid, uid, {
    status: 'claimed',
    execution_stage: 'charged',
    charge_id: tid,
    charged_at: nowMs,
    cost: amt,
    amount: amt,
  });
}

export async function finalizePhase6RefundArtifacts({ taskId, userId, amount }) {
  const tid = String(taskId || '').trim();
  const uid = String(userId || '').trim();
  const amt = toTxIntegerAmount(amount);
  const ledgerTxId = (() => {
    const h = crypto.createHash('sha256').update(`${uid}|${tid}`).digest('hex');
    return `idem_${h}`;
  })();
  const refundTxId = `refund_${ledgerTxId}`;
  const client = getClient();
  const nowMs = Date.now();

  if (amt >= 1) {
    try {
      const exist = await client.getRow({
        tableName: TX_TABLE,
        primaryKey: txPrimaryKey(refundTxId),
      });
      if (!exist.row?.attributes?.length) {
        const u = await getUserById(uid);
        await client.putRow({
          tableName: TX_TABLE,
          condition: new TableStore.Condition(TableStore.RowExistenceExpectation.EXPECT_NOT_EXIST, null),
          primaryKey: txPrimaryKey(refundTxId),
          attributeColumns: [
            { user_id: uid },
            { task_id: tid },
            { amount: txInt64(amt) },
            { type: 'REFUND' },
            { provider: 'phase6_refund' },
            { description: `phase6_refund:${tid}` },
            { created_at: txTsInt64(nowMs) },
            { balance_after: txInt64(u?.balance ?? 0) },
          ],
        });
      }
    } catch (e) {
      if (!isOtsConditionFail(e)) {
        console.error('[phase6] refund ledger finalize', e?.message || e);
      }
    }
  }

  await markTaskChargeRefunded(tid);
}

export async function chargeClaimedTask(taskId) {
  const { chargeClaimedTask: run } = await import('./taskCharge.mjs');
  return run(taskId, {
    getTaskById,
    getUserById,
    upsertTask,
    tryBeginTaskCharge,
    getTaskCharge,
    getDebitReceiptSot,
    getRefundReceiptSot,
    atomicDebitWithReceipt,
    atomicCreditWithReceipt,
    finalizePhase6ChargeArtifacts,
    finalizePhase6RefundArtifacts,
    markTaskChargeFailed,
    markTaskChargeRefunded,
    ensureTaskAwaitingCharge,
    releaseUserConcurrencySlot,
    releasePlatformConcurrencySlot,
    releasePlatformSlotAndRefill,
    updateSlotReservation,
  });
}

export async function refundTaskCharge(taskId) {
  const { refundTaskCharge: run } = await import('./taskCharge.mjs');
  return run(taskId, {
    getTaskById,
    getTaskCharge,
    getDebitReceiptSot,
    getRefundReceiptSot,
    atomicCreditWithReceipt,
    finalizePhase6RefundArtifacts,
    markTaskChargeRefunded,
  });
}

export async function recoverPendingCharge(taskId) {
  const { recoverPendingCharge: run } = await import('./taskCharge.mjs');
  return run(taskId, {
    getTaskById,
    getTaskCharge,
    getDebitReceiptSot,
    finalizePhase6ChargeArtifacts,
    tryBeginTaskCharge,
    upsertTask,
    getUserById,
    atomicDebitWithReceipt,
    markTaskChargeFailed,
    ensureTaskAwaitingCharge,
    releaseUserConcurrencySlot,
    releasePlatformConcurrencySlot,
    releasePlatformSlotAndRefill,
    updateSlotReservation,
    finalizePhase6RefundArtifacts,
    atomicCreditWithReceipt,
    markTaskChargeRefunded,
    getRefundReceiptSot,
  });
}

/**
 * 扫描 claimed + awaiting_charge（或空 stage）并 charge；不写 running。
 * 优先 nx_task_work；失败则 fail-open 扫 nx_tasks 瘦列。
 */
export async function runChargeClaimedTasks(opts = {}) {
  const maxTasks = Math.min(200, Math.max(1, Number(opts.maxTasks) || 20));
  const maxScanRows = Math.min(200000, Math.max(100, Number(opts.maxScanRows) || 20000));
  const candidates = [];
  let scanned = 0;
  let source = 'nx_tasks';

  try {
    const fromWork = await listTaskWorkForCharge({ maxTasks, maxScanRows });
    scanned = fromWork.scanned;
    candidates.push(...fromWork.taskIds);
    source = 'task_work';
    const fallbackEmpty =
      String(process.env.NX_TASK_WORK_FALLBACK_ON_EMPTY || '0') === '1' && candidates.length === 0;
    if (fallbackEmpty) {
      console.warn(
        '[runChargeClaimedTasks] task_work empty → fallback nx_tasks (NX_TASK_WORK_FALLBACK_ON_EMPTY=1)',
      );
      throw new Error('TASK_WORK_EMPTY_FALLBACK');
    }
  } catch (e) {
    if (String(e?.message || e) !== 'TASK_WORK_EMPTY_FALLBACK') {
      console.warn('[runChargeClaimedTasks] task_work failed, fallback nx_tasks:', e?.message || e);
    }
    candidates.length = 0;
    scanned = 0;
    source = 'nx_tasks';
    const client = getClient();
    let nextStart = [{ task_id: TableStore.INF_MIN }];
    const endPK = [{ task_id: TableStore.INF_MAX }];
    while (candidates.length < maxTasks && scanned < maxScanRows) {
      const res = await getRangePromise(client, {
        tableName: TASKS_TABLE,
        direction: TableStore.Direction.FORWARD,
        inclusiveStartPrimaryKey: nextStart,
        exclusiveEndPrimaryKey: endPK,
        limit: 200,
        columnToGet: TASK_SCAN_COLUMNS,
      });
      for (const row of res.rows || []) {
        scanned += 1;
        const attrs = attrsToObj(row.attributes);
        const st = String(attrs.status || '').toLowerCase();
        if (st !== 'claimed') continue;
        const stage = String(attrs.execution_stage || '').toLowerCase();
        if (stage === 'charged' || stage === 'done' || stage === 'error') continue;
        const taskId = taskIdFromTaskRow(row);
        if (!taskId) continue;
        candidates.push(taskId);
        if (candidates.length >= maxTasks) break;
      }
      const nextPk = res.next_start_primary_key || res.nextStartPrimaryKey;
      if (!nextPk) break;
      nextStart = otsNextPkToShorthand(nextPk) ?? nextPk;
    }
  }

  const results = [];
  let charged = 0;
  let idempotent = 0;
  let failed = 0;
  for (const tid of candidates) {
    const r = await chargeClaimedTask(tid);
    results.push(r);
    if (r.ok && r.idempotent) idempotent += 1;
    else if (r.ok) charged += 1;
    else if (r.failed) failed += 1;
  }
  return {
    scanned,
    candidates: candidates.length,
    charged,
    idempotent,
    failed,
    results,
    source,
  };
}

// ─── Phase 7：dispatch lease / provider_task_id / list / runners ───

function phase7DbFacade() {
  return {
    getTaskById,
    upsertTask,
    upsertTaskWork,
    updateTaskPhase7Fields,
    tryAcquireDispatchLease,
    atomicSetProviderTaskId,
    markTaskProviderSubmitted,
    listChargedTasksForDispatch,
    listInvalidForwardChargedTasks,
    listRunningProviderTasks,
    listPhase7RecoveryCandidates,
    releaseUserConcurrencySlot,
    releasePlatformConcurrencySlot,
    releasePlatformSlotAndRefill,
    updateSlotReservation,
    refundTaskCharge,
    persistRhTaskRegion: async () => {},
  };
}

export async function updateTaskPhase7Fields(taskId, userId, patch = {}) {
  const tid = String(taskId || '').trim();
  const uid = String(userId || '').trim();
  if (!tid || !uid) return { ok: false };
  const prev = await getTaskById(tid);
  if (!prev) return { ok: false, reason: 'NOT_FOUND' };
  await upsertTask(tid, uid, {
    status: prev.status,
    ...patch,
  });
  return { ok: true };
}

/**
 * 抢 Phase 7 dispatch lease（与 Phase 5 claim lease 字段完全分离）
 * CAS：status=claimed + owner 空/同名/过期，避免双 worker 同时 submit。
 */
export async function tryAcquireDispatchLease(taskId, { owner, leaseExpiresAt, nowMs }) {
  const tid = String(taskId || '').trim();
  if (!tid) return { ok: false, reason: 'TASK_ID_REQUIRED' };
  const client = getClient();
  const ts = nowMs || Date.now();
  const existing = await getTaskById(tid);
  if (!existing) return { ok: false, reason: 'NOT_FOUND' };
  if (String(existing.status).toLowerCase() !== 'claimed') {
    return { ok: false, reason: 'NOT_CLAIMED' };
  }
  const stage = String(existing.execution_stage || '').toLowerCase();
  if (stage !== 'charged' && stage !== 'dispatching') {
    return { ok: false, reason: 'BAD_STAGE' };
  }
  if (Number(existing.dispatch_unknown) === 1 && !String(existing.provider_task_id || '').trim()) {
    return { ok: false, reason: 'DISPATCH_UNKNOWN' };
  }
  if (String(existing.provider_task_id || '').trim()) {
    return { ok: false, reason: 'ALREADY_HAS_PROVIDER_TASK_ID' };
  }
  const exp = Number(existing.dispatch_lease_expires_at || 0);
  const curOwner = String(existing.dispatch_lease_owner || '');
  if (curOwner && exp > ts && curOwner !== owner) {
    return { ok: false, reason: 'LEASE_HELD' };
  }

  const cond = new TableStore.CompositeCondition(TableStore.LogicalOperator.AND);
  cond.addSubCondition(
    new TableStore.SingleColumnCondition(
      'status',
      'claimed',
      TableStore.ComparatorType.EQUAL,
      false,
    ),
  );
  // 防双抢：条件匹配「当前观测到的 lease」；并发第二方会 CONDITION_FAIL
  if (curOwner && exp > ts && curOwner === owner) {
    cond.addSubCondition(
      new TableStore.SingleColumnCondition(
        'dispatch_lease_owner',
        curOwner,
        TableStore.ComparatorType.EQUAL,
        false,
      ),
    );
  } else if (!curOwner) {
    cond.addSubCondition(
      new TableStore.SingleColumnCondition(
        'dispatch_lease_owner',
        '',
        TableStore.ComparatorType.EQUAL,
        true, // 列缺失视为空
      ),
    );
  } else {
    // lease 已过期：必须仍匹配旧 owner + expires_at（防并发偷锁）
    cond.addSubCondition(
      new TableStore.SingleColumnCondition(
        'dispatch_lease_owner',
        curOwner,
        TableStore.ComparatorType.EQUAL,
        false,
      ),
    );
    cond.addSubCondition(
      new TableStore.SingleColumnCondition(
        'dispatch_lease_expires_at',
        txTsInt64(exp, ts),
        TableStore.ComparatorType.EQUAL,
        false,
      ),
    );
  }
  try {
    await client.updateRow({
      tableName: TASKS_TABLE,
      condition: new TableStore.Condition(TableStore.RowExistenceExpectation.EXPECT_EXIST, cond),
      primaryKey: [{ task_id: tid }],
      updateOfAttributeColumns: [
        {
          PUT: [
            { execution_stage: 'dispatching' },
            { dispatch_lease_owner: String(owner || '') },
            { dispatch_lease_expires_at: txTsInt64(leaseExpiresAt || ts + 90000, ts) },
            {
              dispatch_attempt: txInt64((existing.dispatch_attempt || 0) + 1),
            },
            { updated_at: txTsInt64(ts) },
          ],
        },
      ],
    });
    return { ok: true, owner };
  } catch (e) {
    if (isOtsConditionFail(e)) return { ok: false, reason: 'LEASE_RACE' };
    throw e;
  }
}

/**
 * 仅当 provider_task_id 为空时写入（SoT）
 */
export async function atomicSetProviderTaskId(taskId, providerTaskId) {
  const tid = String(taskId || '').trim();
  const pid = String(providerTaskId || '').trim();
  if (!tid || !pid) return { ok: false, reason: 'INVALID' };
  const client = getClient();
  const existing = await getTaskById(tid);
  if (!existing) return { ok: false, reason: 'NOT_FOUND' };
  if (String(existing.provider_task_id || '').trim()) {
    return {
      ok: false,
      reason: 'ALREADY_SET',
      provider_task_id: existing.provider_task_id,
    };
  }
  // 条件：列缺失或空 —— 用 EQUAL '' passIfMissing
  const cond = new TableStore.SingleColumnCondition(
    'provider_task_id',
    '',
    TableStore.ComparatorType.EQUAL,
    true,
  );
  try {
    await client.updateRow({
      tableName: TASKS_TABLE,
      condition: new TableStore.Condition(TableStore.RowExistenceExpectation.EXPECT_EXIST, cond),
      primaryKey: [{ task_id: tid }],
      updateOfAttributeColumns: [
        {
          PUT: [
            { provider_task_id: pid },
            { updated_at: txTsInt64(Date.now()) },
          ],
        },
      ],
    });
    return { ok: true, provider_task_id: pid };
  } catch (e) {
    if (isOtsConditionFail(e)) {
      const t2 = await getTaskById(tid);
      if (String(t2?.provider_task_id || '').trim()) {
        return { ok: false, reason: 'ALREADY_SET', provider_task_id: t2.provider_task_id };
      }
      return { ok: false, reason: 'CONDITION_FAIL' };
    }
    throw e;
  }
}

export async function markTaskProviderSubmitted(taskId, userId, opts = {}) {
  const tid = String(taskId || '').trim();
  const uid = String(userId || '').trim();
  const pid = String(opts.provider_task_id || '').trim();
  await upsertTask(tid, uid, {
    status: 'running',
    execution_stage: 'provider_submitted',
    ...(pid ? { provider_task_id: pid } : {}),
    provider_status: opts.provider_status || 'QUEUED',
    ...(opts.clear_dispatch_lease
      ? { dispatch_lease_owner: '', dispatch_lease_expires_at: 0 }
      : {}),
  });
  // 提交后立刻可 poll（next_poll_at=now）；后续由 poll 退避拉长
  try {
    await upsertTaskWork({
      task_id: tid,
      user_id: uid,
      status: 'running',
      provider_task_id: pid || undefined,
      execution_stage: 'provider_submitted',
      next_poll_at: Date.now(),
    });
  } catch (e) {
    console.warn('[markTaskProviderSubmitted] next_poll_at sync skipped:', e?.message || e);
  }
  return { ok: true };
}

function taskEntityToScanAttrs(t) {
  if (!t || typeof t !== 'object') return {};
  return {
    status: t.status,
    execution_stage: t.execution_stage,
    provider_task_id: t.provider_task_id,
    dispatch_unknown: t.dispatch_unknown || '0',
    dispatch_lease_owner: t.dispatch_lease_owner || '',
    dispatch_lease_expires_at: t.dispatch_lease_expires_at || 0,
    user_slot_held: t.user_slot_held === true || String(t.user_slot_held) === '1' ? '1' : '0',
    platform_slot_held:
      t.platform_slot_held === true || String(t.platform_slot_held) === '1' ? '1' : '0',
    provider_forward_json: t.provider_forward_json || '',
    prompt_json: t.prompt_json || '',
  };
}

async function scanTasksMatching(pred, { maxTasks = 20, maxScanRows = 20000 } = {}) {
  // 优先活跃投影：小表列出候选后 getRow 做完整 pred（含 forward）
  try {
    const { rows } = await scanTaskWorkMatching(
      (w) => {
        const st = String(w.status || '').toLowerCase();
        return st === 'claimed' || st === 'running' || st === 'queued';
      },
      { maxTasks: Math.min(maxScanRows, Math.max(maxTasks * 20, 200)), maxScanRows },
    );
    const out = [];
    for (const w of rows) {
      const full = await getTaskById(w.task_id);
      if (!full) continue;
      if (pred(taskEntityToScanAttrs(full), w.task_id, w)) {
        out.push(w.task_id);
        if (out.length >= maxTasks) break;
      }
    }
    return out;
  } catch (e) {
    console.warn('[scanTasksMatching] task_work failed, fallback nx_tasks:', e?.message || e);
  }

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
      limit: 200,
      columnToGet: TASK_SCAN_COLUMNS,
    });
    for (const row of res.rows || []) {
      scanned += 1;
      const attrs = attrsToObj(row.attributes);
      const taskId = taskIdFromTaskRow(row);
      if (!taskId) continue;
      if (pred(attrs, taskId)) {
        out.push(taskId);
        if (out.length >= maxTasks) break;
      }
    }
    const nextPk = res.next_start_primary_key || res.nextStartPrimaryKey;
    if (!nextPk) break;
    nextStart = otsNextPkToShorthand(nextPk) ?? nextPk;
  }
  return out;
}

function attrsHaveValidForwardPath(attrs) {
  // 轻量判定（与 lib/forwardPayload.mjs 同源规则，避免循环依赖）
  const raw = String(attrs?.provider_forward_json || attrs?.forward_json || '').trim();
  if (raw) {
    try {
      const o = JSON.parse(raw);
      if (o && typeof o === 'object' && String(o.path || '').trim()) return true;
    } catch (_) {}
  }
  const pj = String(attrs?.prompt_json || '').trim();
  if (pj) {
    try {
      const o = JSON.parse(pj);
      if (o?._nexflow_forward && String(o._nexflow_forward.path || '').trim()) return true;
      if (o?.forward && String(o.forward.path || '').trim()) return true;
    } catch (_) {}
  }
  return false;
}

function isChargedDispatchBaseMatch(attrs, now = Date.now()) {
  if (String(attrs.status || '').toLowerCase() !== 'claimed') return false;
  const stage = String(attrs.execution_stage || '').toLowerCase();
  if (stage !== 'charged' && stage !== 'dispatching') return false;
  if (String(attrs.provider_task_id || '').trim()) return false;
  if (String(attrs.dispatch_unknown || '0') === '1') return false;
  const exp = toTaskTsMs(attrs.dispatch_lease_expires_at, 0);
  const owner = String(attrs.dispatch_lease_owner || '');
  if (owner && exp > now) return false;
  return true;
}

export async function listChargedTasksForDispatch(opts = {}) {
  const now = Date.now();
  return scanTasksMatching(
    (attrs) => {
      if (!isChargedDispatchBaseMatch(attrs, now)) return false;
      // Phase 9.2.2：仅有效 forward 进入正常 Dispatch 候选，避免饥饿
      return attrsHaveValidForwardPath(attrs);
    },
    opts,
  );
}

/** claimed+charged 且无有效 forward：供 mark/terminal 出口，不进正常 Dispatch */
export async function listInvalidForwardChargedTasks(opts = {}) {
  const now = Date.now();
  return scanTasksMatching(
    (attrs) => {
      if (!isChargedDispatchBaseMatch(attrs, now)) return false;
      return !attrsHaveValidForwardPath(attrs);
    },
    opts,
  );
}

export async function listRunningProviderTasks(opts = {}) {
  const now = Number(opts.nowMs) || Date.now();
  const maxTasks = Math.min(100, Math.max(1, Number(opts.maxTasks) || 20));
  const maxScanRows = Math.min(
    500000,
    Math.max(1000, parseInt(String(opts.maxScanRows ?? '20000'), 10) || 20000),
  );
  // 先在瘦表按 next_poll_at 过滤，避免对未到期任务 GetRow / RH query
  try {
    const { rows } = await scanTaskWorkMatching(
      (w) => {
        const st = String(w.status || '').toLowerCase();
        if (st !== 'running' && st !== 'claimed') return false;
        if (!String(w.provider_task_id || '').trim()) return false;
        const stage = String(w.execution_stage || '').toLowerCase();
        if (stage === 'done') return false;
        const npa = Number(w.next_poll_at) || 0;
        if (npa > now) return false;
        return true;
      },
      { maxTasks: Math.min(maxScanRows, Math.max(maxTasks * 20, 200)), maxScanRows },
    );
    const out = [];
    for (const w of rows) {
      const full = await getTaskById(w.task_id);
      if (!full) continue;
      const st = String(full.status || '').toLowerCase();
      if (st !== 'running' && st !== 'claimed') continue;
      if (!String(full.provider_task_id || '').trim()) continue;
      const stage = String(full.execution_stage || '').toLowerCase();
      if (stage === 'done') continue;
      if (st === 'success' || st === 'failed' || st === 'cancelled') continue;
      out.push(w.task_id);
      if (out.length >= maxTasks) break;
    }
    return out;
  } catch (e) {
    console.warn('[listRunningProviderTasks] task_work failed, fallback scan:', e?.message || e);
  }
  return scanTasksMatching((attrs, _taskId, work) => {
    const st = String(attrs.status || '').toLowerCase();
    if (st !== 'running' && st !== 'claimed') return false;
    if (!String(attrs.provider_task_id || '').trim()) return false;
    const stage = String(attrs.execution_stage || '').toLowerCase();
    if (stage === 'done') return false;
    if (st === 'success' || st === 'failed' || st === 'cancelled') return false;
    const npa = Number(work?.next_poll_at) || 0;
    if (npa > now) return false;
    return true;
  }, opts);
}

export async function listPhase7RecoveryCandidates(opts = {}) {
  const now = Date.now();
  return scanTasksMatching((attrs) => {
    const stage = String(attrs.execution_stage || '').toLowerCase();
    const st = String(attrs.status || '').toLowerCase();
    if (stage === 'settling') return true;
    if (String(attrs.dispatch_unknown || '0') === '1') return true;
    if (
      (st === 'success' || st === 'failed') &&
      (String(attrs.user_slot_held) === '1' || String(attrs.platform_slot_held) === '1')
    ) {
      return true;
    }
    if (stage === 'dispatching') {
      const exp = toTaskTsMs(attrs.dispatch_lease_expires_at, 0);
      if (exp > 0 && exp <= now) return true;
    }
    if (stage === 'charged' && st === 'claimed' && !String(attrs.provider_task_id || '').trim()) {
      return true;
    }
    return false;
  }, opts);
}

export async function runDispatchChargedTasks(opts = {}) {
  const { runDispatchChargedTasks: run } = await import('./providerPipeline.mjs');
  return run(
    {
      ...phase7DbFacade(),
      refundTaskCharge,
    },
    opts,
  );
}

export async function runPollProviderTasks(opts = {}) {
  const { runPollProviderTasks: run } = await import('./providerPipeline.mjs');
  return run(
    {
      ...phase7DbFacade(),
      refundTaskCharge,
    },
    opts,
  );
}

export async function runRecoverProviderTasks(opts = {}) {
  const { runRecoverProviderTasks: run } = await import('./providerPipeline.mjs');
  return run(
    {
      ...phase7DbFacade(),
      refundTaskCharge,
    },
    opts,
  );
}

export async function runSettleTerminalTasks(opts = {}) {
  const { settleOneTask } = await import('./providerPipeline.mjs');
  const ids = await listPhase7RecoveryCandidates({
    maxTasks: opts.maxTasks || 20,
    maxScanRows: opts.maxScanRows,
  });
  const db = { ...phase7DbFacade(), refundTaskCharge };
  const results = [];
  for (const tid of ids) {
    const t = await getTaskById(tid);
    if (!t) continue;
    if (String(t.execution_stage) === 'settling') {
      const { isProviderTerminalSuccess, isProviderTerminalFailed } = await import(
        './providerStages.mjs'
      );
      if (isProviderTerminalSuccess(t.provider_status)) {
        results.push(await settleOneTask(tid, db, { outcome: 'success' }));
      } else if (isProviderTerminalFailed(t.provider_status)) {
        results.push(await settleOneTask(tid, db, { outcome: 'failed', refund: true }));
      }
    }
  }
  return { candidates: ids.length, results };
}


