#!/usr/bin/env node
/**
 * 计费联调：首充档位 10 元 + 22% 奖励（NX_YUANBAO_PER_CNY=10 → 基础 100 + 奖励 22 = 122）
 *
 * 依赖：demo/aliyun-fc-init-user/.env（OTS_*）
 * 运行：node scripts/test-recharge-bonus.mjs
 */
import { existsSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const envPath = join(ROOT, '.env');

const envResult = dotenv.config({ path: envPath });
if (envResult.error && !existsSync(envPath)) {
  console.error('[test-recharge] 未找到 .env:', envPath);
  process.exit(1);
}

/** 联调预期：10 元 × 10 元宝/元 = 100 基础；首充 22% = 22；合计 122 */
process.env.NX_YUANBAO_PER_CNY = '10';

const TEST_USER_ID = 'nx_da3306c0-f852-45ba-970c-45e0e09a32cd';
const AMOUNT_CNY = 10;

const { rechargeWithLedger, getUserById, FIRST_RECHARGE_BONUS_RATE } = await import('../lib/db-tablestore.mjs');

async function main() {
  const before = await getUserById(TEST_USER_ID);
  if (!before) {
    console.error('[test-recharge] 用户不存在:', TEST_USER_ID);
    process.exit(1);
  }

  const balanceBefore = before.balance;
  console.log('[test-recharge] 充值前余额:', balanceBefore);
  console.log('[test-recharge] 充值前 is_first_recharge (业务层):', before.isFirstRecharge);

  const rate = 10;
  const expectedBase = Math.round(AMOUNT_CNY * rate);
  const bonusRate = FIRST_RECHARGE_BONUS_RATE[AMOUNT_CNY] ?? 0;
  const expectedBonus = Math.floor(expectedBase * bonusRate);
  const expectedTotal = expectedBase + expectedBonus;
  console.log('[test-recharge] 预期: 基础', expectedBase, '+ 首充', expectedBonus, '=', expectedTotal, '元宝');

  const result = await rechargeWithLedger(TEST_USER_ID, AMOUNT_CNY);

  if (result.base_yuanbao !== expectedBase || result.bonus_yuanbao !== expectedBonus) {
    console.warn('[test-recharge] 警告: 实际 base/bonus 与预期不一致', result);
  }

  const after = await getUserById(TEST_USER_ID);
  if (!after) {
    console.error('[test-recharge] 充值后读用户失败');
    process.exit(1);
  }

  console.log('');
  console.log('========== 联调结果 ==========');
  console.log('『充值前余额』', balanceBefore);
  console.log('『充值后余额』', after.balance);
  console.log(
    '『首充标记是否变回 false』',
    after.isFirstRecharge === false ? '是' : '否（仍为 true 或异常）',
  );
  console.log('本次入账 tx_id:', result.tx_id);
  console.log('基础元宝 / 奖励元宝 / 合计:', result.base_yuanbao, '/', result.bonus_yuanbao, '/', result.base_yuanbao + result.bonus_yuanbao);
  console.log('============================');
}

main().catch((e) => {
  console.error('[test-recharge] 失败:', e?.message || e);
  process.exit(1);
});
