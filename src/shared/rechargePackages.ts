/**
 * 充值套餐（与 pricing/recharge_packages.mjs 保持一致）
 * 规则：套餐含基础元宝 + 固定赠送；元宝永久有效；无首充额外比例
 */

export const YUANBAO_PER_CNY = 10;

export type RechargePackageId = 'starter' | 'popular' | 'value' | 'premium';

export type RechargePackageTag = 'most_popular' | 'best_value' | 'max_discount';

export type RechargePackage = {
  id: RechargePackageId;
  label: string;
  priceCny: number;
  baseYuanbao: number;
  /** 套餐固定赠送（非首充） */
  bonusYuanbao?: number;
  tag?: RechargePackageTag;
};

/** UI 展示顺序：50 → 100 → 300 → 1000 */
export const RECHARGE_PACKAGES: readonly RechargePackage[] = [
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
] as const;

export const RECHARGE_TIERS_CNY = RECHARGE_PACKAGES.map((p) => p.priceCny);

const PRICE_EPS = 0.001;

export function findRechargePackage(priceCny: number): RechargePackage | undefined {
  if (!Number.isFinite(priceCny)) return undefined;
  return RECHARGE_PACKAGES.find((p) => Math.abs(p.priceCny - priceCny) < PRICE_EPS);
}

export function findRechargePackageById(id: string): RechargePackage | undefined {
  return RECHARGE_PACKAGES.find((p) => p.id === id);
}

export function packageBonusYuanbao(pkg: RechargePackage): number {
  return pkg.bonusYuanbao ?? 0;
}

/** 套餐到账元宝（基础 + 赠送） */
export function packageTotalYuanbao(pkg: RechargePackage): number {
  return pkg.baseYuanbao + packageBonusYuanbao(pkg);
}

export function calcRechargePreview(pkg: RechargePackage) {
  const base = pkg.baseYuanbao;
  const bonus = packageBonusYuanbao(pkg);
  return {
    packageTotal: base,
    bonus,
    total: base + bonus,
  };
}

export function defaultSelectedPackageId(): RechargePackageId {
  return 'popular';
}

/** 按价格从低到高（UI 横向排列用） */
export function packagesByPriceAsc(): RechargePackage[] {
  return [...RECHARGE_PACKAGES].sort((a, b) => a.priceCny - b.priceCny);
}
