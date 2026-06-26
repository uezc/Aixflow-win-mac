import React, { useCallback, useEffect, useMemo, useState } from 'react';

type AdminUserRow = {
  user_id: string;
  email: string;
  registration_date: number;
  last_login: number | null;
  status: string;
};

function formatDateTime(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms) || ms <= 0) return '—';
  try {
    return new Date(ms).toLocaleString('zh-CN', { hour12: false });
  } catch {
    return '—';
  }
}

function csvEscape(s: string): string {
  const t = String(s ?? '');
  if (/[",\r\n]/.test(t)) return `"${t.replace(/"/g, '""')}"`;
  return t;
}

const AdminUsersPage: React.FC = () => {
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [truncated, setTruncated] = useState(false);
  const [totalCount, setTotalCount] = useState(0);
  const [users, setUsers] = useState<AdminUserRow[]>([]);
  const [query, setQuery] = useState('');

  const load = useCallback(async () => {
    if (!window.electronAPI?.adminGetAllUsers) {
      setErr('当前环境不支持用户管理');
      setLoading(false);
      return;
    }
    setLoading(true);
    setErr('');
    try {
      const r = await window.electronAPI.adminGetAllUsers();
      setUsers(r.users);
      setTotalCount(r.total_count);
      setTruncated(r.scan_truncated === true);
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return users;
    return users.filter((u) => {
      const id = u.user_id.toLowerCase();
      const em = u.email.toLowerCase();
      return id.includes(q) || em.includes(q);
    });
  }, [users, query]);

  const exportCsv = () => {
    const rows = filtered;
    const header = ['user_id', 'email', 'registration_date', 'last_login', 'status'];
    const lines = [
      header.join(','),
      ...rows.map((u) =>
        [
          csvEscape(u.user_id),
          csvEscape(u.email),
          csvEscape(u.registration_date ? String(u.registration_date) : ''),
          csvEscape(u.last_login != null ? String(u.last_login) : ''),
          csvEscape(u.status),
        ].join(','),
      ),
    ];
    const blob = new Blob(['\ufeff' + lines.join('\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `nexflow-users-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-white/90">用户管理</h2>
          <p className="text-xs text-white/45 mt-1">数据已脱敏，不含密码；列表可按邮箱或用户 ID 筛选。</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => void load()}
            disabled={loading}
            className="px-4 py-2 rounded-lg bg-white/10 border border-white/15 text-sm hover:bg-white/15 disabled:opacity-50"
          >
            {loading ? '刷新中…' : '刷新列表'}
          </button>
          <button
            type="button"
            onClick={exportCsv}
            disabled={filtered.length === 0}
            className="px-4 py-2 rounded-lg bg-violet-500/20 border border-violet-400/35 text-sm text-violet-100 hover:bg-violet-500/30 disabled:opacity-40"
          >
            导出 CSV（当前筛选）
          </button>
        </div>
      </div>

      {err ? <p className="text-sm text-red-400/90">{err}</p> : null}
      {truncated ? (
        <p className="text-xs text-amber-200/80">本次扫描已达上限，列表可能不完整（可在服务端提高 max_scan_rows 后重试）。</p>
      ) : null}

      <div className="rounded-2xl border border-white/12 bg-gradient-to-br from-violet-500/[0.07] to-cyan-500/[0.06] px-6 py-5 shadow-[0_0_40px_rgba(139,92,246,0.08)]">
        <p className="text-xs text-white/50 mb-2 tracking-wide">当前注册用户总数</p>
        <p className="text-4xl sm:text-5xl font-bold tabular-nums bg-gradient-to-r from-violet-300 via-fuchsia-300 to-cyan-300 bg-clip-text text-transparent">
          {loading ? '…' : totalCount}
        </p>
      </div>

      <div className="space-y-3">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="按邮箱或用户 ID 筛选…"
          className="w-full max-w-md rounded-xl border border-white/10 bg-white/[0.03] px-4 py-2.5 text-sm text-white placeholder:text-white/35 outline-none focus:border-cyan-400/40 focus:ring-1 focus:ring-cyan-400/25"
        />

        <div className="rounded-xl border border-white/5 overflow-hidden bg-[rgba(255,255,255,0.02)]">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm border-collapse">
              <thead>
                <tr className="border-b border-white/5 text-white/45 text-xs uppercase tracking-wider">
                  <th className="px-4 py-3 font-medium">用户 ID</th>
                  <th className="px-4 py-3 font-medium">邮箱</th>
                  <th className="px-4 py-3 font-medium">注册时间</th>
                  <th className="px-4 py-3 font-medium">状态</th>
                </tr>
              </thead>
              <tbody>
                {!loading && filtered.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="px-4 py-16 text-center text-white/40">
                      {users.length === 0 ? '暂无用户数据' : '没有符合筛选条件的用户'}
                    </td>
                  </tr>
                ) : null}
                {loading ? (
                  <tr>
                    <td colSpan={4} className="px-4 py-12 text-center text-white/45">
                      加载中…
                    </td>
                  </tr>
                ) : (
                  filtered.map((u) => (
                    <tr key={u.user_id} className="border-b border-white/5 last:border-0 text-white/85 hover:bg-white/[0.03]">
                      <td className="px-4 py-3 font-mono text-xs text-cyan-100/90">{u.user_id}</td>
                      <td className="px-4 py-3 text-white/80">{u.email || '—'}</td>
                      <td className="px-4 py-3 text-white/60 tabular-nums text-xs">{formatDateTime(u.registration_date)}</td>
                      <td className="px-4 py-3">
                        <span className="inline-flex rounded-md border border-white/10 bg-white/[0.04] px-2 py-0.5 text-xs text-white/75">
                          {u.status || 'normal'}
                        </span>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
};

export default AdminUsersPage;
