// @ts-nocheck
import React, { useEffect, useMemo, useState } from 'react';
import { Sparkles, Wallet, X } from 'lucide-react';
import {
  calcRechargePreview,
  defaultSelectedPackageId,
  packageBonusYuanbao,
  packagesByPriceAsc,
  type RechargePackage,
  type RechargePackageId,
  type RechargePackageTag,
} from '../../shared/rechargePackages';
import { settingsT, type SettingsLocale } from '../i18n/settingsI18n';

type Props = {
  open: boolean;
  onClose: () => void;
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

export function RechargeModal({
  open,
  onClose,
  locale,
  busyPackageId,
  error,
  onPay,
}: Props) {
  const t = settingsT(locale);
  const [selectedId, setSelectedId] = useState<RechargePackageId>(defaultSelectedPackageId());
  const packages = useMemo(() => packagesByPriceAsc(), []);

  const selected = useMemo(
    () => packages.find((p) => p.id === selectedId) ?? packages.find((p) => p.id === 'popular') ?? packages[0],
    [packages, selectedId],
  );

  const preview = calcRechargePreview(selected);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[10003] flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="recharge-modal-title"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="flex aspect-[21/9] w-full max-w-[min(96vw,1120px)] flex-col overflow-hidden rounded-2xl border border-white/10 bg-neutral-950 shadow-2xl">
        <div className="relative flex shrink-0 items-center justify-center border-b border-white/10 px-6 py-4">
          <div className="flex min-w-0 flex-wrap items-center justify-center gap-2">
            <Wallet className="h-4 w-4 shrink-0 text-amber-300/90" />
            <h2 id="recharge-modal-title" className="text-base font-semibold text-white">
              {t.rechargePackagesTitle}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="absolute right-4 top-1/2 shrink-0 -translate-y-1/2 rounded-lg p-1.5 text-white/50 transition hover:bg-white/10 hover:text-white"
            aria-label={t.cancel}
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <p className="shrink-0 px-6 pt-3 text-center text-xs leading-relaxed text-white/45">
          {t.rechargePackagesHint}
        </p>

        <div className="flex min-h-0 flex-1 flex-col justify-center px-6 py-3">
          {error ? <p className="mb-3 shrink-0 text-center text-xs text-red-400/90">{error}</p> : null}

          <div className="flex min-h-0 flex-1 gap-3">
            {packages.map((pkg) => {
              const bonus = packageBonusYuanbao(pkg);
              const p = calcRechargePreview(pkg);
              const active = pkg.id === selectedId;
              const tagLabel = packageTagLabel(pkg.tag, locale);
              return (
                <button
                  key={pkg.id}
                  type="button"
                  disabled={busyPackageId !== null}
                  onClick={() => setSelectedId(pkg.id)}
                  className={`relative flex min-w-0 flex-1 flex-col items-center justify-center rounded-xl border px-3 py-3 text-center transition ${
                    active
                      ? 'border-amber-400/70 bg-amber-500/15 ring-1 ring-amber-400/40'
                      : 'border-white/10 bg-black/40 hover:border-white/20'
                  }`}
                >
                  {tagLabel ? (
                    <span className="absolute left-1/2 top-0 inline-flex -translate-x-1/2 -translate-y-1/2 items-center gap-0.5 rounded-full bg-amber-500 px-2 py-0.5 text-[10px] font-semibold text-black">
                      <Sparkles className="h-3 w-3" />
                      {tagLabel}
                    </span>
                  ) : null}
                  <div className="text-lg font-semibold tabular-nums text-white">¥{pkg.priceCny}</div>
                  <div className="mt-0.5 text-xs text-white/55">{pkg.label}</div>
                  <div className="mt-2 text-[11px] leading-snug text-amber-200/90">
                    {t.packageYuanbaoTotal(pkg.baseYuanbao)}
                    {bonus > 0 ? (
                      <span className="block text-emerald-300/90">{t.packageBonusExtra(bonus)}</span>
                    ) : null}
                  </div>
                  {active ? (
                    <div className="mt-2 text-[11px] font-medium text-emerald-300/95">
                      {t.checkoutTotal(p.total)} {t.yuanbaoUnit}
                    </div>
                  ) : null}
                </button>
              );
            })}
          </div>
        </div>

        <div className="shrink-0 border-t border-white/10 px-6 py-4">
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
      </div>
    </div>
  );
}

export default RechargeModal;
