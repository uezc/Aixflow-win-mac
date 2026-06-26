import React, { useCallback, useEffect, useState } from 'react';

const AdminTasksPage: React.FC = () => {
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [scanned, setScanned] = useState(0);
  const [tasks, setTasks] = useState<
    Array<{
      task_id: string;
      user_id: string;
      status: string;
      cost: number;
      error_msg?: string;
    }>
  >([]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [msg, setMsg] = useState('');

  const load = useCallback(async () => {
    if (!window.electronAPI?.adminFailedTasks) {
      setErr('当前环境不支持任务运维');
      setLoading(false);
      return;
    }
    setLoading(true);
    setErr('');
    try {
      const r = await window.electronAPI.adminFailedTasks();
      setTasks(r.tasks);
      setScanned(r.scanned);
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const refund = async (userId: string, taskId: string) => {
    if (!window.electronAPI?.adminRefundTask) return;
    setBusyId(taskId);
    setMsg('');
    try {
      const r = await window.electronAPI.adminRefundTask(userId, taskId);
      if (r.refunded) {
        setMsg(`已退款：${taskId}，用户余额约 ${r.balance}`);
      } else if (r.idempotent) {
        setMsg(`已处理过（幂等）：${taskId}`);
      } else {
        setMsg(`未入账退款：${taskId} — ${r.reason || 'unknown'}`);
      }
      await load();
    } catch (e: unknown) {
      setMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-white/90">失败 / 超时任务</h2>
          <p className="text-xs text-white/45 mt-1">
            仅展示状态为 failed / timeout 的任务；一键退款走幂等 consume 退款（refundConsumedTask）。
          </p>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          disabled={loading}
          className="px-4 py-2 rounded-lg bg-white/10 border border-white/15 text-sm hover:bg-white/15 disabled:opacity-50"
        >
          {loading ? '刷新中…' : '刷新列表'}
        </button>
      </div>
      {err ? <p className="text-sm text-red-400/90">{err}</p> : null}
      {msg ? <p className="text-sm text-sky-300/90 whitespace-pre-wrap">{msg}</p> : null}
      <p className="text-xs text-white/40">本次扫描行数：{scanned}</p>

      <div className="rounded-xl border border-white/10 overflow-hidden">
        <table className="w-full text-left text-sm">
          <thead className="bg-white/[0.06] text-white/55 text-xs uppercase tracking-wide">
            <tr>
              <th className="px-4 py-3 font-medium">任务 ID</th>
              <th className="px-4 py-3 font-medium">用户</th>
              <th className="px-4 py-3 font-medium">状态</th>
              <th className="px-4 py-3 font-medium">成本</th>
              <th className="px-4 py-3 font-medium w-48">操作</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/10">
            {tasks.length === 0 && !loading ? (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-white/40">
                  暂无记录（或扫描范围内无失败任务）
                </td>
              </tr>
            ) : null}
            {tasks.map((t) => (
              <tr key={t.task_id} className="hover:bg-white/[0.03]">
                <td className="px-4 py-3 font-mono text-xs text-white/80 break-all max-w-[200px]">{t.task_id}</td>
                <td className="px-4 py-3 font-mono text-xs text-white/80 break-all max-w-[180px]">{t.user_id}</td>
                <td className="px-4 py-3 text-white/70">{t.status}</td>
                <td className="px-4 py-3 tabular-nums">{t.cost}</td>
                <td className="px-4 py-3">
                  <button
                    type="button"
                    disabled={busyId === t.task_id}
                    onClick={() => void refund(t.user_id, t.task_id)}
                    className="px-3 py-1.5 rounded-lg bg-rose-500/20 border border-rose-400/30 text-rose-200 text-xs hover:bg-rose-500/30 disabled:opacity-50"
                  >
                    {busyId === t.task_id ? '处理中…' : '一键退款'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {tasks.some((t) => t.error_msg) ? (
        <div className="space-y-2 text-xs text-white/45">
          <p className="text-white/60">错误摘要（前几条）:</p>
          {tasks.slice(0, 5).map((t) =>
            t.error_msg ? (
              <p key={t.task_id} className="font-mono break-all">
                {t.task_id}: {t.error_msg}
              </p>
            ) : null
          )}
        </div>
      ) : null}
    </div>
  );
};

export default AdminTasksPage;
