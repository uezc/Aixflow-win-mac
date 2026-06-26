import React, { useCallback, useEffect, useState } from 'react';

type Row = {
  model_id: string;
  function_name?: string;
  is_active?: boolean;
  base_price?: number;
  multiplier?: number;
  yuanbao_rate?: number;
};

const AdminModelsPage: React.FC = () => {
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [items, setItems] = useState<Row[]>([]);
  const [edits, setEdits] = useState<Record<string, Row>>({});
  const [saving, setSaving] = useState<string | null>(null);
  const [toast, setToast] = useState('');

  const load = useCallback(async () => {
    if (!window.electronAPI?.adminModelConfigList) {
      setErr('当前环境不支持模型配置');
      setLoading(false);
      return;
    }
    setLoading(true);
    setErr('');
    try {
      const r = await window.electronAPI.adminModelConfigList();
      setItems(r.items);
      setEdits({});
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const rowFor = (row: Row): Row => edits[row.model_id] ?? row;

  const patch = (modelId: string, patch: Partial<Row>) => {
    setEdits((prev) => {
      const base = items.find((x) => x.model_id === modelId);
      if (!base) return prev;
      const cur = { ...base, ...prev[modelId] };
      return { ...prev, [modelId]: { ...cur, ...patch } };
    });
  };

  const save = async (modelId: string) => {
    if (!window.electronAPI?.adminModelConfigUpsert) return;
    const row = rowFor(items.find((x) => x.model_id === modelId)!);
    setSaving(modelId);
    setToast('');
    try {
      await window.electronAPI.adminModelConfigUpsert({
        model_id: row.model_id,
        function_name: row.function_name,
        is_active: row.is_active !== false,
        base_price: Number(row.base_price) || 0,
        multiplier: Number(row.multiplier) || 1,
        yuanbao_rate: Number(row.yuanbao_rate) || 10,
      });
      setToast(`已保存 ${modelId}`);
      setTimeout(() => setToast(''), 3000);
      await load();
    } catch (e: unknown) {
      setToast(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(null);
    }
  };

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-white/90">模型定价（nx_model_config）</h2>
          <p className="text-xs text-white/45 mt-1">修改后写入 Tablestore，FC 计费缓存约 60s 内刷新。</p>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          disabled={loading}
          className="px-4 py-2 rounded-lg bg-white/10 border border-white/15 text-sm hover:bg-white/15 disabled:opacity-50"
        >
          {loading ? '加载中…' : '重新加载'}
        </button>
      </div>
      {err ? <p className="text-sm text-red-400/90">{err}</p> : null}
      {toast ? <p className="text-sm text-emerald-300/90">{toast}</p> : null}

      <div className="rounded-xl border border-white/10 overflow-x-auto">
        <table className="w-full text-left text-sm min-w-[720px]">
          <thead className="bg-white/[0.06] text-white/55 text-xs uppercase tracking-wide">
            <tr>
              <th className="px-3 py-3 font-medium">model_id</th>
              <th className="px-3 py-3 font-medium">function_name</th>
              <th className="px-3 py-3 font-medium">启用</th>
              <th className="px-3 py-3 font-medium">base_price</th>
              <th className="px-3 py-3 font-medium">multiplier</th>
              <th className="px-3 py-3 font-medium">yuanbao_rate</th>
              <th className="px-3 py-3 font-medium w-28">操作</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/10">
            {items.length === 0 && !loading ? (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-white/40">
                  无数据
                </td>
              </tr>
            ) : null}
            {items.map((orig) => {
              const r = rowFor(orig);
              return (
                <tr key={orig.model_id} className="hover:bg-white/[0.03]">
                  <td className="px-3 py-2 font-mono text-xs text-white/80 align-top">{r.model_id}</td>
                  <td className="px-3 py-2 align-top">
                    <input
                      aria-label={`function_name ${r.model_id}`}
                      className="w-full min-w-[120px] px-2 py-1 rounded bg-white/5 border border-white/15 text-xs text-white"
                      value={r.function_name ?? ''}
                      onChange={(e) => patch(orig.model_id, { function_name: e.target.value })}
                    />
                  </td>
                  <td className="px-3 py-2 align-top">
                    <input
                      aria-label={`启用 ${r.model_id}`}
                      type="checkbox"
                      className="rounded border-white/30"
                      checked={r.is_active !== false}
                      onChange={(e) => patch(orig.model_id, { is_active: e.target.checked })}
                    />
                  </td>
                  <td className="px-3 py-2 align-top">
                    <input
                      aria-label={`base_price ${r.model_id}`}
                      type="number"
                      step="any"
                      className="w-24 px-2 py-1 rounded bg-white/5 border border-white/15 text-xs text-white tabular-nums"
                      value={r.base_price ?? 0}
                      onChange={(e) => patch(orig.model_id, { base_price: Number(e.target.value) })}
                    />
                  </td>
                  <td className="px-3 py-2 align-top">
                    <input
                      aria-label={`multiplier ${r.model_id}`}
                      type="number"
                      step="any"
                      className="w-24 px-2 py-1 rounded bg-white/5 border border-white/15 text-xs text-white tabular-nums"
                      value={r.multiplier ?? 1}
                      onChange={(e) => patch(orig.model_id, { multiplier: Number(e.target.value) })}
                    />
                  </td>
                  <td className="px-3 py-2 align-top">
                    <input
                      aria-label={`yuanbao_rate ${r.model_id}`}
                      type="number"
                      step="any"
                      className="w-24 px-2 py-1 rounded bg-white/5 border border-white/15 text-xs text-white tabular-nums"
                      value={r.yuanbao_rate ?? 10}
                      onChange={(e) => patch(orig.model_id, { yuanbao_rate: Number(e.target.value) })}
                    />
                  </td>
                  <td className="px-3 py-2 align-top">
                    <button
                      type="button"
                      disabled={saving === orig.model_id}
                      onClick={() => void save(orig.model_id)}
                      className="px-3 py-1.5 rounded-lg bg-sky-500/25 border border-sky-400/35 text-sky-200 text-xs hover:bg-sky-500/35 disabled:opacity-50"
                    >
                      {saving === orig.model_id ? '保存…' : '保存'}
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default AdminModelsPage;
