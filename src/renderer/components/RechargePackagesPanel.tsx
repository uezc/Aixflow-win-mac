// @ts-nocheck
import React, { useMemo, useState } from 'react';
import { Sparkles, Wallet } from 'lucide-react';
import {
  RECHARGE_PACKAGES,
  calcRechargePreview,
  defaultSelectedPackageId,
  packageBonusYuanbao,
  packageTotalYuanbao,
  type RechargePackage,
  type RechargePackageId,
  type RechargePackageTag,
} from '../../shared/rechargePackages';
import { settingsT, type SettingsLocale } from '../i18n/settingsI18n';

type Props = {
  locale: SettingsLocale;
  busyPackageId: RechargePackageId | null;
  error: string;
  onPay: (pkg: RechargePackage) => void | Promise<void>;
};

function packageTagLabel(tag: RechargePackageTag | undefined, locale: SettingsLocale): string | null {
  const t = settingsT(locale);
  if (tag === 'most_popular') return t.packageTagMostPopular;
  if (tag === 'best_value') return t.packageTagBestValue;
  if (tag === 'max_discount') return t.packageTagMaxDiscount;
  return null;
}

export function RechargePackagesPanel({ locale, busyPackageId, error, onPay }: Props) {
  const t = settingsT(locale);
  const [selectedId, setSelectedId] = useState<RechargePackageId>(defaultSelectedPackageId());

  const selected = useMemo(
    () => RECHARGE_PACKAGES.find((p) => p.id === selectedId) ?? RECHARGE_PACKAGES[0],
    [selectedId],
  );

  const preview = calcRechargePreview(selected);

  return (
    <div className="space-y-3 rounded-xl border border-amber-500/30 bg-gradient-to-br from-amber-500/[0.08] via-transparent to-transparent p-4">
      <div className="flex flex-wrap items-center gap-2">
        <Wallet className="h-4 w-4 text-amber-300/90" />
        <span className="text-sm font-medium text-white/95">{t.rechargePackagesTitle}</span>
      </div>
      <p className="text-xs leading-relaxed text-white/45">{t.rechargePackagesHint}</p>
      {error ? <p className="text-xs text-red-400/90">{error}</p> : null}

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {RECHARGE_PACKAGES.map((pkg) => {
          const bonus = packageBonusYuanbao(pkg);
          const total = packageTotalYuanbao(pkg);
          const p = calcRechargePreview(pkg);
          const active = pkg.id === selectedId;
          const tagLabel = packageTagLabel(pkg.tag, locale);
          return (
            <button
              key={pkg.id}
              type="button"
              disabled={busyPackageId !== null}
              onClick={() => setSelectedId(pkg.id)}
              className={`relative rounded-xl border px-3 py-3 text-left transition ${
                active
                  ? 'border-amber-400/70 bg-amber-500/15 ring-1 ring-amber-400/40'
                  : 'border-white/10 bg-black/30 hover:border-white/20'
              }`}
            >
              {tagLabel ? (
                <span className="absolute -top-2 right-2 inline-flex items-center gap-0.5 rounded-full bg-amber-500 px-2 py-0.5 text-[10px] font-semibold text-black">
                  <Sparkles className="h-3 w-3" />
                  {tagLabel}
                </span>
              ) : null}
              <div className="text-sm font-semibold text-white">¥{pkg.priceCny}</div>
              <div className="mt-0.5 text-xs text-white/55">{pkg.label}</div>
              <div className="mt-2 text-xs text-amber-200/90">
                {t.packageYuanbaoTotal(pkg.baseYuanbao)}
                {bonus > 0 ? (
                  <span className="text-emerald-300/90"> · {t.packageBonusExtra(bonus)}</span>
                ) : null}
              </div>
              {active ? (
                <div className="mt-1 text-[11px] font-medium text-emerald-300/95">
                  {t.checkoutTotal(p.total)} {t.yuanbaoUnit}
                </div>
              ) : null}
            </button>
          );
        })}
      </div>

      <button
        type="button"
        disabled={busyPackageId !== null}
        onClick={() => void onPay(selected)}
        className="nexflow-btn-primary w-full"
      >
        {busyPackageId === selected.id
          ? t.rechargePayOpening
          : t.rechargePayNow(selected.priceCny, preview.total)}
      </button>
    </div>
  );
}

export default RechargePackagesPanel;
