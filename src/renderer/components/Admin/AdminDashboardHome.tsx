import React, { useEffect, useState } from 'react';
import AdminActivationGenerator from '../AdminActivationGenerator';

const AdminDashboardHome: React.FC = () => {
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [stats, setStats] = useState<{
    date: string;
    today_revenue_yuanbao: number;
    total_coupon_codes: number;
    pending_failed_or_timeout_tasks: number;
    tx_rows_scanned: number;
    task_rows_scanned: number;
  } | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      if (!window.electronAPI?.adminDashboardStats) {
        if (!cancelled) {
          setErr('当前环境不支持运营看板');
          setLoading(false);
        }
        return;
      }
      setLoading(true);
      setErr('');
      try {
        const s = await window.electronAPI.adminDashboardStats();
        if (!cancelled) setStats(s);
      } catch (e: unknown) {
        if (!cancelled) setErr(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="max-w-6xl mx-auto space-y-10">
      <section>
        <h2 className="text-base font-semibold text-white/90 mb-4">今日营收看板</h2>
        {err ? <p className="text-sm text-red-400/90 mb-4">{err}</p> : null}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-5">
            <p className="text-xs text-white/50 mb-2">今日收入（元宝）</p>
            <p className="text-2xl font-semibold text-emerald-300 tabular-nums">
              {loading ? '…' : stats?.today_revenue_yuanbao ?? 0}
            </p>
            {stats?.date ? (
              <p className="text-[11px] text-white/35 mt-2">上海日期 {stats.date}</p>
            ) : null}
          </div>
          <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-5">
            <p className="text-xs text-white/50 mb-2">累计兑换码数量</p>
            <p className="text-2xl font-semibold text-amber-200/90 tabular-nums">
              {loading ? '…' : stats?.total_coupon_codes ?? 0}
            </p>
          </div>
          <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-5">
            <p className="text-xs text-white/50 mb-2">待处理失败 / 超时任务</p>
            <p className="text-2xl font-semibold text-rose-300/90 tabular-nums">
              {loading ? '…' : stats?.pending_failed_or_timeout_tasks ?? 0}
            </p>
            {stats && (stats.tx_rows_scanned > 0 || stats.task_rows_scanned > 0) ? (
              <p className="text-[11px] text-white/35 mt-2">
                流水扫描 {stats.tx_rows_scanned} 行 · 任务扫描 {stats.task_rows_scanned} 行
              </p>
            ) : null}
          </div>
        </div>
      </section>

      <section className="border-t border-white/10 pt-10">
        <h2 className="text-base font-semibold text-white/90 mb-6 text-center">激活码与兑换码</h2>
        <AdminActivationGenerator embedded />
      </section>
    </div>
  );
};

export default AdminDashboardHome;
