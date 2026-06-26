/**
 * AIXFLOW 元宝充值套餐（人民币 → 元宝）
 * 1 元 = 10 元宝（标价口径）；套餐含基础元宝 + 固定赠送；元宝永久有效
 */

export const YUANBAO_PER_CNY = 10;

/** UI 展示顺序：50 → 100 → 300 → 1000 */
export const RECHARGE_PACKAGES = Object.freeze([
  {
    id: 'starter',
    label: '入门包',
    priceCny: 50,
    baseYuanbao: 500,
  },
  {
    id: 'popular',
    label: '标准包',
    priceCny: 100,
    baseYuanbao: 1000,
    bonusYuanbao: 50,
    tag: 'most_popular',
  },
  {
    id: 'value',
    label: '进阶包',
    priceCny: 300,
    baseYuanbao: 3000,
    bonusYuanbao: 300,
    tag: 'best_value',
  },
  {
    id: 'premium',
    label: '尊享包',
    priceCny: 1000,
    baseYuanbao: 10000,
    bonusYuanbao: 1500,
    tag: 'max_discount',
  },
]);

/** 允许的充值/兑换档位（人民币） */
export const RECHARGE_TIERS_CNY = Object.freeze(RECHARGE_PACKAGES.map((p) => p.priceCny));

const PRICE_EPS = 0.001;

/** @param {number} priceCny */
export function findRechargePackage(priceCny) {
  const n = Number(priceCny);
  if (!Number.isFinite(n)) return null;
  return RECHARGE_PACKAGES.find((p) => Math.abs(p.priceCny - n) < PRICE_EPS) ?? null;
}

/** @param {string} packageId */
export function findRechargePackageById(packageId) {
  const id = String(packageId || '').trim();
  if (!id) return null;
  return RECHARGE_PACKAGES.find((p) => p.id === id) ?? null;
}

/**
 * 计算入账元宝
 * @param {number} priceCny
 * @param {{ couponCode?: string }} [opts]
 */
export function calcRechargeYuanbao(priceCny, opts = {}) {
  const pkg = findRechargePackage(priceCny);
  if (!pkg) {
    throw new Error('INVALID_RECHARGE_TIER');
  }
  const baseYuanbao = pkg.baseYuanbao;
  const bonusYuanbao = Number(pkg.bonusYuanbao) > 0 ? Number(pkg.bonusYuanbao) : 0;
  const total = baseYuanbao + bonusYuanbao;
  return {
    packageId: pkg.id,
    label: pkg.label,
    priceCny: pkg.priceCny,
    packageYuanbao: baseYuanbao,
    bonusYuanbao,
    /** @deprecated 兼容旧字段名，等于 bonusYuanbao */
    firstRechargeBonus: bonusYuanbao,
    totalYuanbao: total,
    firstRechargeApplied: false,
  };
}
