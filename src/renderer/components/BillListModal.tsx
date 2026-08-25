// @ts-nocheck
import React, { useEffect } from 'react';
import { ChevronLeft, ChevronRight, Receipt, RefreshCw, X } from 'lucide-react';
import { dateLocaleForSettings, settingsT, type SettingsLocale } from '../i18n/settingsI18n';

export type BillTransactionRow = {
  tx_id: string;
  task_id?: string;
  amount?: string | number;
  type?: string;
  provider?: string;
  description?: string;
  created_at?: string | number;
  balance_after?: string | number;
};

type Props = {
  open: boolean;
  onClose: () => void;
  locale: SettingsLocale;
  txList: BillTransactionRow[];
  txLoading: boolean;
  txError: string;
  page: number;
  pageSize: number;
  total: number;
  hasMore: boolean;
  onRefresh: () => void | Promise<void>;
  onPrevPage: () => void;
  onNextPage: () => void;
};

function formatBillDescription(raw: string | undefined): string {
  if (!raw?.trim()) return '';
  const s = raw.trim();
  const legacy = s.match(/^(audio|video|image|llm)\s+(?:runninghub|bltcy|forward)\s+(\S+)/i);
  if (legacy) {
    const path = legacy[2];
    const parts = path.split('/').filter(Boolean);
    return parts[parts.length - 1] || path;
  }
  return s.replace(/\b(runninghub|bltcy|forward)\b/gi, '').replace(/\s+/g, ' ').trim();
}

function formatTransactionTimeCell(v: unknown, locale: SettingsLocale): string {
  if (v == null || v === '') return '';
  const n = Number(v);
  if (Number.isFinite(n) && n > 0) {
    const ms = n < 1e12 ? Math.round(n * 1000) : Math.round(n);
    return new Date(ms).toLocaleString(dateLocaleForSettings(locale), { hour12: false });
  }
  const d = new Date(String(v));
  if (!Number.isNaN(d.getTime())) {
    return d.toLocaleString(dateLocaleForSettings(locale), { hour12: false });
  }
  return '';
}

function formatBalanceAfterCell(v: unknown): string {
  if (v == null || v === '') return '';
  const n = Number(v);
  if (Number.isFinite(n)) return String(n);
  const s = String(v).trim();
  return s === '' ? '' : s;
}

export function BillListModal({
  open,
  onClose,
  locale,
  txList,
  txLoading,
  txError,
  page,
  pageSize,
  total,
  hasMore,
  onRefresh,
  onPrevPage,
  onNextPage,
}: Props) {
  const t = settingsT(locale);
  const totalPages = Math.max(1, Math.ceil(Math.max(0, total) / Math.max(1, pageSize || 30)));
  const canPrev = page > 1 && !txLoading;
  const canNext = hasMore && !txLoading;

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
      aria-labelledby="bill-modal-title"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="flex max-h-[min(88vh,820px)] w-full max-w-[min(96vw,960px)] flex-col overflow-hidden rounded-2xl border border-white/10 bg-neutral-950 shadow-2xl">
        <div className="relative flex shrink-0 items-center justify-center border-b border-white/10 px-6 py-4">
          <div className="flex min-w-0 items-center justify-center gap-2">
            <Receipt className="h-4 w-4 shrink-0 text-amber-300/90" />
            <h2 id="bill-modal-title" className="text-base font-semibold text-white">
              {t.billListTitle}
            </h2>
          </div>
          <div className="absolute right-4 top-1/2 flex -translate-y-1/2 items-center gap-2">
            <button
              type="button"
              onClick={() => void onRefresh()}
              disabled={txLoading}
              className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs text-amber-300/90 transition hover:bg-white/10 disabled:opacity-50"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${txLoading ? 'animate-spin' : ''}`} />
              {txLoading ? t.refreshing : t.refresh}
            </button>
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg p-1.5 text-white/50 transition hover:bg-white/10 hover:text-white"
              aria-label={t.cancel}
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        <div className="flex min-h-0 flex-1 flex-col px-6 py-4">
          {txError ? <p className="mb-3 shrink-0 text-center text-xs text-red-400/90">{txError}</p> : null}
          <div className="min-h-0 flex-1 overflow-hidden overflow-y-auto rounded-xl border border-white/[0.08] custom-scrollbar-dark">
            <table className="w-full text-left text-sm">
              <thead className="sticky top-0 z-10 bg-zinc-900/98 text-white/50">
                <tr>
                  <th className="px-4 py-2.5 font-medium">{t.txTime}</th>
                  <th className="px-4 py-2.5 font-medium">{t.txType}</th>
                  <th className="px-4 py-2.5 text-right font-medium">{t.txChange}</th>
                  <th className="px-4 py-2.5 text-right font-medium">{t.txBalance}</th>
                </tr>
              </thead>
              <tbody className="text-white/85">
                {txList.length === 0 && !txLoading ? (
                  <tr>
                    <td colSpan={4} className="px-4 py-12 text-center text-white/35">
                      {t.noRecords}
                    </td>
                  </tr>
                ) : (
                  txList.map((row) => {
                    const amt = Number(row.amount);
                    const signed =
                      Number.isFinite(amt) && amt < 0
                        ? `${amt}`
                        : Number.isFinite(amt) && amt > 0
                          ? `+${amt}`
                          : String(row.amount ?? t.dash);
                    const typeLabel = (() => {
                      const rowType = String(row.type || '').toUpperCase();
                      const prov = String(row.provider || '').toLowerCase();
                      if (rowType === 'CONSUME' || rowType === 'CONSUME_PENDING') return t.txConsume;
                      if (rowType === 'REFUND') return t.txRefund;
                      if (rowType === 'WELCOME_BONUS') return t.txWelcomeBonus;
                      if (rowType === 'RECHARGE') return prov === 'coupon' ? t.txCoupon : t.txRecharge;
                      if (rowType === 'ADJUST') return t.txAdjust;
                      return row.type || t.dash;
                    })();
                    const descShort = formatBillDescription(
                      row.description != null && row.description !== '' ? String(row.description) : undefined,
                    );
                    const timeStr = formatTransactionTimeCell(row.created_at, locale);
                    const balStr = formatBalanceAfterCell(row.balance_after);
                    const typeTitle = [descShort, typeLabel].filter(Boolean).join(' · ');
                    return (
                      <tr key={row.tx_id} className="border-t border-white/[0.06]">
                        <td className="whitespace-nowrap px-4 py-2.5 text-white/55">{timeStr || t.dash}</td>
                        <td className="max-w-[280px] truncate px-4 py-2.5 align-top" title={typeTitle || undefined}>
                          {descShort ? (
                            <>
                              <span className="text-white/90">{descShort}</span>
                              <span className="text-white/40"> · {typeLabel}</span>
                            </>
                          ) : (
                            <span>{typeLabel}</span>
                          )}
                        </td>
                        <td
                          className={`px-4 py-2.5 text-right tabular-nums ${
                            Number.isFinite(amt) && amt > 0 ? 'text-emerald-400/90' : 'text-amber-300/90'
                          }`}
                        >
                          {signed}
                        </td>
                        <td className="px-4 py-2.5 text-right tabular-nums text-white/70">{balStr || t.dash}</td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

          <div className="mt-3 flex shrink-0 items-center justify-between gap-3 border-t border-white/[0.06] pt-3">
            <p className="min-w-0 truncate text-xs text-white/45">
              {t.billPageStatus(page, totalPages, total)}
            </p>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onPrevPage}
                disabled={!canPrev}
                className="inline-flex items-center gap-1 rounded-lg border border-white/10 px-2.5 py-1.5 text-xs text-white/80 transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40"
              >
                <ChevronLeft className="h-3.5 w-3.5" />
                {t.billPagePrev}
              </button>
              <button
                type="button"
                onClick={onNextPage}
                disabled={!canNext}
                className="inline-flex items-center gap-1 rounded-lg border border-white/10 px-2.5 py-1.5 text-xs text-white/80 transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {t.billPageNext}
                <ChevronRight className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default BillListModal;
