import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

type Granularity = 'day' | 'month' | 'year';

type ProfitAnalytics = {
  timezone: string;
  daily_profits: Array<{
    period: string;
    profit_yuanbao: number;
    revenue_yuanbao: number;
    cost_yuanbao: number;
  }>;
  monthly_profits: Array<{
    period: string;
    profit_yuanbao: number;
    revenue_yuanbao: number;
    cost_yuanbao: number;
  }>;
  yearly_profits: Array<{
    period: string;
    profit_yuanbao: number;
    revenue_yuanbao: number;
    cost_yuanbao: number;
  }>;
  total_revenue: number;
  total_cost: number;
  total_profit: number;
  current_month_profit_yuanbao: number;
  current_month_revenue_yuanbao: number;
  current_month_key: string;
  model_profit_leaderboard: Array<{
    model_id: string;
    profit_yuanbao: number;
    revenue_yuanbao: number;
    cost_yuanbao: number;
    task_count: number;
  }>;
  coupon_used_count: number;
  coupon_face_value_cny_sum: number;
  coupon_estimated_yuanbao: number;
  yuanbao_per_cny_assumed: number;
  tx_rows_scanned: number;
  coupon_rows_scanned: number;
  tx_scan_truncated: boolean;
};

function formatYuanbao(n: number): string {
  if (!Number.isFinite(n)) return '0';
  return n.toLocaleString('zh-CN', { maximumFractionDigits: 0 });
}

const chartColors = {
  grid: 'rgba(255,255,255,0.06)',
  axis: 'rgba(255,255,255,0.35)',
  profit: '#67e8f9',
  profitFill: 'url(#profitFill)',
};

const AdminFinancePage: React.FC = () => {
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [data, setData] = useState<ProfitAnalytics | null>(null);
  const [granularity, setGranularity] = useState<Granularity>('month');

  const load = useCallback(async () => {
    if (!window.electronAPI?.adminProfitAnalytics) {
      setErr('当前环境不支持财务分析');
      setLoading(false);
      return;
    }
    setLoading(true);
    setErr('');
    try {
      const r = await window.electronAPI.adminProfitAnalytics({});
      setData(r);
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : String(e));
      setData(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const series = useMemo(() => {
    if (!data) return [];
    const src =
      granularity === 'day'
        ? data.daily_profits
        : granularity === 'month'
          ? data.monthly_profits
          : data.yearly_profits;
    const cap = granularity === 'day' ? 120 : granularity === 'month' ? 36 : 12;
    const tail = src.length > cap ? src.slice(-cap) : src;
    return tail.map((r) => ({
      period: r.period,
      profit: r.profit_yuanbao,
      revenue: r.revenue_yuanbao,
      cost: r.cost_yuanbao,
    }));
  }, [data, granularity]);

  const cardBase =
    'rounded-2xl border px-5 py-4 shadow-lg backdrop-blur-sm min-w-[10rem] flex-1';

  return (
    <div className="max-w-6xl mx-auto space-y-8 text-white/90">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-white/90">财务分析</h2>
          <p className="text-xs text-white/45 mt-1 max-w-xl leading-relaxed">
            基于 <span className="text-white/60">nx_transactions</span>（type=consume）与{' '}
            <span className="text-white/60">nx_model_config</span>：售价优先取列{' '}
            <code className="text-cyan-200/80">user_price</code>，否则为实扣元宝；底价优先{' '}
            <code className="text-cyan-200/80">base_cost</code>，否则为 <code className="text-cyan-200/80">base_price</code>。
            已核销兑换码面值计入参考（人民币→元宝按定价表平均折算率估算）。聚合在 FC 内存完成，非 SQL GROUP BY。
          </p>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          disabled={loading}
          className="px-4 py-2 rounded-lg bg-white/10 border border-white/15 text-sm hover:bg-white/15 disabled:opacity-50"
        >
          {loading ? '计算中…' : '重新计算'}
        </button>
      </div>

      {err ? <p className="text-sm text-red-400/90">{err}</p> : null}

      {data?.tx_scan_truncated ? (
        <p className="text-xs text-amber-200/85">
          流水扫描已达上限，趋势与合计可能不完整；可在 FC 提高 max_tx_scan_rows 后重试。
        </p>
      ) : null}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div
          className={`${cardBase} border-emerald-400/25 bg-gradient-to-br from-emerald-500/[0.14] to-teal-600/[0.08]`}
        >
          <p className="text-xs text-white/50 mb-1">累计总利润（元宝）</p>
          <p className="text-2xl font-bold tabular-nums bg-gradient-to-r from-emerald-200 to-teal-300 bg-clip-text text-transparent">
            {loading ? '…' : formatYuanbao(data?.total_profit ?? 0)}
          </p>
        </div>
        <div
          className={`${cardBase} border-violet-400/25 bg-gradient-to-br from-violet-500/[0.14] to-fuchsia-600/[0.08]`}
        >
          <p className="text-xs text-white/50 mb-1">本月流水收入（元宝）</p>
          <p className="text-2xl font-bold tabular-nums bg-gradient-to-r from-violet-200 via-fuchsia-200 to-pink-300 bg-clip-text text-transparent">
            {loading ? '…' : formatYuanbao(data?.current_month_revenue_yuanbao ?? 0)}
          </p>
          {data?.current_month_key ? (
            <p className="text-[11px] text-white/35 mt-2">上海自然月 {data.current_month_key}</p>
          ) : null}
        </div>
        <div
          className={`${cardBase} border-amber-400/25 bg-gradient-to-br from-amber-500/[0.14] to-orange-700/[0.08]`}
        >
          <p className="text-xs text-white/50 mb-1">API 成本总额（元宝）</p>
          <p className="text-2xl font-bold tabular-nums bg-gradient-to-r from-amber-200 to-orange-300 bg-clip-text text-transparent">
            {loading ? '…' : formatYuanbao(data?.total_cost ?? 0)}
          </p>
        </div>
      </div>

      <div className="rounded-xl border border-white/8 bg-[rgba(255,255,255,0.02)] p-4">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
          <h3 className="text-sm font-medium text-white/80">利润走势</h3>
          <div className="flex rounded-lg border border-white/10 overflow-hidden text-xs">
            {(['day', 'month', 'year'] as const).map((g) => (
              <button
                key={g}
                type="button"
                onClick={() => setGranularity(g)}
                className={`px-3 py-1.5 capitalize ${
                  granularity === g
                    ? 'bg-cyan-500/25 text-cyan-100 border-l border-white/10 first:border-l-0'
                    : 'bg-black/20 text-white/50 hover:text-white/75'
                }`}
              >
                {g === 'day' ? '日' : g === 'month' ? '月' : '年'}
              </button>
            ))}
          </div>
        </div>
        {loading && !series.length ? (
          <div className="h-64 flex items-center justify-center text-white/40 text-sm">加载图表…</div>
        ) : series.length === 0 ? (
          <div className="h-64 flex items-center justify-center text-white/40 text-sm">暂无利润序列数据</div>
        ) : (
          <div className="h-72 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={series} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="profitFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#22d3ee" stopOpacity={0.35} />
                    <stop offset="100%" stopColor="#22d3ee" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke={chartColors.grid} />
                <XAxis
                  dataKey="period"
                  tick={{ fill: chartColors.axis, fontSize: 10 }}
                  tickLine={false}
                  axisLine={{ stroke: chartColors.grid }}
                />
                <YAxis
                  tick={{ fill: chartColors.axis, fontSize: 10 }}
                  tickLine={false}
                  axisLine={{ stroke: chartColors.grid }}
                  width={48}
                />
                <Tooltip
                  contentStyle={{
                    background: 'rgba(15,15,18,0.95)',
                    border: '1px solid rgba(255,255,255,0.1)',
                    borderRadius: 8,
                    fontSize: 12,
                  }}
                  labelStyle={{ color: 'rgba(255,255,255,0.7)' }}
                  formatter={(value) => [formatYuanbao(Number(value ?? 0)), '利润']}
                />
                <Area
                  type="monotone"
                  dataKey="profit"
                  name="profit"
                  stroke={chartColors.profit}
                  strokeWidth={2}
                  fill={chartColors.profitFill}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>

      {data ? (
        <p className="text-[11px] text-white/35">
          本月毛利（元宝）约 {formatYuanbao(data.current_month_profit_yuanbao)} · 已核销券{' '}
          {data.coupon_used_count} 张 · 券面值合计 {data.coupon_face_value_cny_sum} 元（估{' '}
          {formatYuanbao(data.coupon_estimated_yuanbao)} 元宝，折算率 {data.yuanbao_per_cny_assumed}）· 扫描流水行{' '}
          {data.tx_rows_scanned} / 兑换码行 {data.coupon_rows_scanned}
        </p>
      ) : null}

      <div className="rounded-xl border border-white/5 bg-[rgba(255,255,255,0.02)] overflow-hidden">
        <div className="px-4 py-3 border-b border-white/5">
          <h3 className="text-sm font-medium text-white/80">模型盈利排行（差价累计 · 元宝）</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-white/5 text-white/40 text-xs">
                <th className="px-4 py-2 font-medium">#</th>
                <th className="px-4 py-2 font-medium">模型 ID</th>
                <th className="px-4 py-2 font-medium">任务数</th>
                <th className="px-4 py-2 font-medium">流水收入</th>
                <th className="px-4 py-2 font-medium">底价成本</th>
                <th className="px-4 py-2 font-medium">利润</th>
              </tr>
            </thead>
            <tbody>
              {!data || data.model_profit_leaderboard.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-10 text-center text-white/40">
                    {loading ? '加载中…' : '暂无模型级利润数据'}
                  </td>
                </tr>
              ) : (
                data.model_profit_leaderboard.slice(0, 50).map((row, i) => (
                  <tr key={row.model_id} className="border-b border-white/5 last:border-0 hover:bg-white/[0.03]">
                    <td className="px-4 py-2 text-white/45 tabular-nums">{i + 1}</td>
                    <td className="px-4 py-2 font-mono text-xs text-cyan-100/90">{row.model_id}</td>
                    <td className="px-4 py-2 tabular-nums text-white/70">{row.task_count}</td>
                    <td className="px-4 py-2 tabular-nums text-white/70">{formatYuanbao(row.revenue_yuanbao)}</td>
                    <td className="px-4 py-2 tabular-nums text-white/55">{formatYuanbao(row.cost_yuanbao)}</td>
                    <td className="px-4 py-2 tabular-nums text-emerald-300/90">{formatYuanbao(row.profit_yuanbao)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

export default AdminFinancePage;
