/**
 * Phase 6 OTS 原子性验证（不改业务代码）
 *
 * 验证：单次 UpdateRow 是否能原子完成
 *   condition: balance >= amount AND receipt != 1 (passIfMissing)
 *   ops: INCREMENT balance -= amount + PUT receipt = 1
 *
 * 运行：
 *   node scripts/verify-phase6-ots-atomicity.mjs
 */
import crypto from 'crypto';
import { createRequire } from 'module';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootEnv = path.resolve(__dirname, '../../../.env');
const localEnv = path.resolve(__dirname, '../.env');
for (const p of [rootEnv, localEnv]) {
  if (!fs.existsSync(p)) continue;
  for (const line of fs.readFileSync(p, 'utf8').split(/\r?\n/)) {
    if (!line || line.trim().startsWith('#')) continue;
    const i = line.indexOf('=');
    if (i < 1) continue;
    const k = line.slice(0, i).trim();
    let v = line.slice(i + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    if (k && process.env[k] === undefined) process.env[k] = v;
  }
}

const require = createRequire(import.meta.url);
const TableStore = require('tablestore');
const Int64buf = require('int64-buffer');

const USERS_TABLE = (process.env.OTS_TABLE_USERS || 'nx_users').toLowerCase();
const TEST_USER = `__p6_atomic_${Date.now().toString(36)}`;
const RECEIPT_COL = 'dr_p6chk01';
const REPORT = {
  sdk: 'tablestore@' + (() => {
    try {
      return require('tablestore/package.json').version;
    } catch {
      return 'unknown';
    }
  })(),
  api: 'client.updateRow',
  tests: [],
  passed: false,
  atomic_increment_and_put_same_updateRow: null,
  condition_composite_and: null,
  timeout_recovery_via_getRow_receipt: null,
  stop_phase6_if_failed: true,
};

function txInt64(n) {
  return new Int64buf.Int64LE(Math.trunc(Number(n) || 0));
}

function getClient() {
  return new TableStore.Client({
    accessKeyId: process.env.OTS_ACCESS_KEY_ID,
    secretAccessKey: process.env.OTS_ACCESS_KEY_SECRET,
    endpoint: process.env.OTS_ENDPOINT,
    instancename: process.env.OTS_INSTANCE || process.env.OTS_INST_NAME,
  });
}

function attrsToObj(attributes = []) {
  const out = {};
  for (const a of attributes || []) {
    const name = a.columnName || a.name;
    let v = a.columnValue ?? a.value;
    if (v && typeof v === 'object' && typeof v.toNumber === 'function') v = v.toNumber();
    out[name] = v;
  }
  return out;
}

async function putUser(client, userId, balance) {
  await client.putRow({
    tableName: USERS_TABLE,
    condition: new TableStore.Condition(TableStore.RowExistenceExpectation.IGNORE, null),
    primaryKey: [{ user_id: userId }],
    attributeColumns: [
      { email: `${userId}@p6check.local` },
      { balance: txInt64(balance) },
      { status: 'active' },
      { updated_at: txInt64(Date.now()) },
    ],
  });
}

async function getUser(client, userId) {
  const res = await client.getRow({
    tableName: USERS_TABLE,
    primaryKey: [{ user_id: userId }],
  });
  if (!res.row?.attributes?.length) return null;
  const attrs = attrsToObj(res.row.attributes);
  return {
    balance: parseInt(String(attrs.balance ?? '0'), 10) || 0,
    receipt: attrs[RECEIPT_COL] != null ? parseInt(String(attrs[RECEIPT_COL]), 10) : null,
    raw: attrs,
  };
}

async function deleteUser(client, userId) {
  try {
    await client.deleteRow({
      tableName: USERS_TABLE,
      condition: new TableStore.Condition(TableStore.RowExistenceExpectation.IGNORE, null),
      primaryKey: [{ user_id: userId }],
    });
  } catch (_) {}
}

/**
 * 单次 UpdateRow：余额 CAS + receipt PUT（目标 Money SoT 语义）
 */
async function atomicDebit(client, userId, amount, receiptCol = RECEIPT_COL) {
  const cond = new TableStore.CompositeCondition(TableStore.LogicalOperator.AND);
  cond.addSubCondition(
    new TableStore.SingleColumnCondition(
      'balance',
      txInt64(amount),
      TableStore.ComparatorType.GREATER_EQUAL,
      false, // balance 列必须存在
    ),
  );
  // receipt != 1；列缺失时通过（passIfMissing=true）→ 允许首次扣款
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
      primaryKey: [{ user_id: userId }],
      updateOfAttributeColumns: [
        { INCREMENT: [{ balance: txInt64(-amount) }] },
        { PUT: [{ [receiptCol]: txInt64(1) }, { updated_at: txInt64(Date.now()) }] },
      ],
    });
    return { ok: true };
  } catch (e) {
    const msg = String(e?.message || e || '');
    const code = e?.code || '';
    if (
      code === 'OTSConditionCheckFail' ||
      code === 'ConditionCheckFail' ||
      /ConditionCheckFail|条件检查失败/i.test(msg)
    ) {
      return { ok: false, reason: 'CONDITION_FAIL' };
    }
    throw e;
  }
}

function record(name, ok, detail) {
  REPORT.tests.push({ name, ok, detail });
  console.log(ok ? `[PASS] ${name}` : `[FAIL] ${name}`, detail || '');
}

async function main() {
  const client = getClient();
  console.log('[p6-atomic] user=', TEST_USER, 'table=', USERS_TABLE);

  try {
    // --- Test 1: 同一次 UpdateRow 原子成功 ---
    await putUser(client, TEST_USER, 100);
    const r1 = await atomicDebit(client, TEST_USER, 30);
    const u1 = await getUser(client, TEST_USER);
    const t1ok = r1.ok && u1.balance === 70 && u1.receipt === 1;
    record('T1_same_updateRow_increment_and_put', t1ok, {
      debitOk: r1.ok,
      balance: u1.balance,
      receipt: u1.receipt,
    });
    REPORT.atomic_increment_and_put_same_updateRow = t1ok;
    REPORT.condition_composite_and = t1ok;

    // --- Test 2: 同 operation 再扣应失败（receipt 已 1）---
    const r2 = await atomicDebit(client, TEST_USER, 30);
    const u2 = await getUser(client, TEST_USER);
    const t2ok = !r2.ok && u2.balance === 70 && u2.receipt === 1;
    record('T2_second_debit_same_receipt_idempotent_fail', t2ok, {
      debitOk: r2.ok,
      balance: u2.balance,
      receipt: u2.receipt,
    });

    // --- Test 3: 20 worker 同 receipt ---
    await putUser(client, TEST_USER, 100);
    // clear receipt by overwrite without receipt col — put full row without dr
    await putUser(client, TEST_USER, 100);
    const results = await Promise.all(
      Array.from({ length: 20 }, () => atomicDebit(client, TEST_USER, 25)),
    );
    const okN = results.filter((x) => x.ok).length;
    const u3 = await getUser(client, TEST_USER);
    const t3ok = okN === 1 && u3.balance === 75 && u3.receipt === 1;
    record('T3_20_workers_same_receipt', t3ok, {
      okN,
      balance: u3.balance,
      receipt: u3.receipt,
    });

    // --- Test 4: 两不同 receipt 竞争余额 80+80 / 100 ---
    const userD = `${TEST_USER}_d`;
    await putUser(client, userD, 100);
    const [a, b] = await Promise.all([
      atomicDebit(client, userD, 80, 'dr_op_a'),
      atomicDebit(client, userD, 80, 'dr_op_b'),
    ]);
    const u4 = await getUser(client, userD);
    const successN = [a.ok, b.ok].filter(Boolean).length;
    const t4ok =
      successN === 1 &&
      u4.balance === 20 &&
      u4.balance >= 0 &&
      ((a.ok && !b.ok) || (!a.ok && b.ok));
    // receipts: exactly one of dr_op_a / dr_op_b should be 1
    const ra = u4.raw.dr_op_a != null ? parseInt(String(u4.raw.dr_op_a), 10) : null;
    const rb = u4.raw.dr_op_b != null ? parseInt(String(u4.raw.dr_op_b), 10) : null;
    const receiptXor = (ra === 1 && rb !== 1) || (rb === 1 && ra !== 1);
    record('T4_two_ops_compete_balance', t4ok && receiptXor, {
      a: a.ok,
      b: b.ok,
      balance: u4.balance,
      ra,
      rb,
    });
    await deleteUser(client, userD);

    // --- Test 5: timeout 恢复路径（模拟：不重试盲扣，只 GetRow 看 receipt）---
    await putUser(client, TEST_USER, 50);
    const r5 = await atomicDebit(client, TEST_USER, 10);
    const after = await getUser(client, TEST_USER);
    const moneySot =
      after.receipt === 1 ? 'APPLIED' : after.receipt == null ? 'NOT_APPLIED' : 'UNEXPECTED';
    const t5ok = r5.ok && moneySot === 'APPLIED' && after.balance === 40;
    record('T5_getRow_receipt_as_money_sot', t5ok, {
      moneySot,
      balance: after.balance,
      receipt: after.receipt,
    });
    REPORT.timeout_recovery_via_getRow_receipt = t5ok;

    // --- Test 6: 余额不足 ---
    await putUser(client, TEST_USER, 5);
    const r6 = await atomicDebit(client, TEST_USER, 20);
    const u6 = await getUser(client, TEST_USER);
    const t6ok = !r6.ok && u6.balance === 5 && u6.receipt == null;
    record('T6_insufficient_balance_no_receipt', t6ok, {
      debitOk: r6.ok,
      balance: u6.balance,
      receipt: u6.receipt,
    });

    REPORT.passed = REPORT.tests.every((t) => t.ok);
  } finally {
    await deleteUser(client, TEST_USER);
    await deleteUser(client, `${TEST_USER}_d`);
  }

  const outPath = path.resolve(__dirname, '../PHASE6_OTS_ATOMICITY_CHECK.md');
  const md = renderReport(REPORT);
  fs.writeFileSync(outPath, md, 'utf8');
  console.log('\n[p6-atomic] wrote', outPath);
  console.log('[p6-atomic] PASSED=', REPORT.passed);
  if (!REPORT.passed) {
    console.error('[p6-atomic] STOP Phase 6 — atomicity check failed');
    process.exit(2);
  }
}

function renderReport(r) {
  const lines = [
    '# PHASE6_OTS_ATOMICITY_CHECK',
    '',
    `**结果**: ${r.passed ? 'PASSED — 允许继续 Phase 6 实施' : 'FAILED — 立即停止 Phase 6，禁止 workaround'}`,
    '',
    `**时间**: ${new Date().toISOString()}`,
    '',
    '## SDK / API',
    '',
    `- SDK: \`${r.sdk}\``,
    `- API: \`${r.api}\``,
    `- 表: \`nx_users\`（环境 \`OTS_TABLE_USERS\`）`,
    '',
    '## Condition 语法（已验证）',
    '',
    '```javascript',
    'const cond = new TableStore.CompositeCondition(TableStore.LogicalOperator.AND);',
    'cond.addSubCondition(new TableStore.SingleColumnCondition(',
    "  'balance', amount, TableStore.ComparatorType.GREATER_EQUAL, false));",
    'cond.addSubCondition(new TableStore.SingleColumnCondition(',
    "  receiptCol, 1, TableStore.ComparatorType.NOT_EQUAL, true)); // passIfMissing=true",
    'new TableStore.Condition(EXPECT_EXIST, cond)',
    '```',
    '',
    '## Operations（同一 UpdateRow）',
    '',
    '```javascript',
    'updateOfAttributeColumns: [',
    '  { INCREMENT: [{ balance: -amount }] },',
    '  { PUT: [{ [receiptCol]: 1 }, { updated_at }] },',
    ']',
    '```',
    '',
    '## 语义结论',
    '',
    `| 项 | 结论 |`,
    `|----|------|`,
    `| INCREMENT 与 PUT receipt 是否同一 UpdateRow | **${r.atomic_increment_and_put_same_updateRow ? '是' : '否'}** |`,
    `| 复合条件 AND 是否生效 | **${r.condition_composite_and ? '是' : '否'}** |`,
    `| timeout 后可否 GetRow(receipt) 判 APPLIED | **${r.timeout_recovery_via_getRow_receipt ? '是（语义具备）' : '否'}** |`,
    `| 拆成两次 UpdateRow | **禁止；本次验证未拆分** |`,
    '',
    '## 测试明细',
    '',
  ];
  for (const t of r.tests) {
    lines.push(`- ${t.ok ? 'PASS' : 'FAIL'} **${t.name}**: \`${JSON.stringify(t.detail)}\``);
  }
  lines.push('', '## 判定规则', '');
  if (r.passed) {
    lines.push('OTS 支持 B′ 所需原子语义。**可以继续 Phase 6 业务实施。**');
  } else {
    lines.push('**立即停止 Phase 6 实施，不要寻找临时 workaround。**');
  }
  lines.push('');
  return lines.join('\n');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
