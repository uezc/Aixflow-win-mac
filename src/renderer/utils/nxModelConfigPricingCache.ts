/**
 * nx_model_config 展示价：localStorage 持久化（SWR 冷启动 hydrate）
 */

export type NxModelConfigRow = {
  model_id: string;
  function_name?: string;
  is_active?: boolean;
  base_price?: number;
  multiplier?: number;
  yuanbao_rate?: number;
};

export const NX_MODEL_CONFIG_LS_KEY = 'nexflow_nx_model_config_swr_v1';

export const NX_MODEL_CONFIG_SYNC_INTERVAL_MS = 5 * 60 * 1000;

export type NxModelConfigPersistedV1 = {
  v: 1;
  email: string;
  syncedAt: number;
  map: Record<string, NxModelConfigRow>;
};

export function itemsToCloudMap(
  items: Array<{
    model_id?: string;
    function_name?: string;
    is_active?: boolean;
    base_price?: number;
    multiplier?: number;
    yuanbao_rate?: number;
  }>,
): Record<string, NxModelConfigRow> {
  const m: Record<string, NxModelConfigRow> = {};
  for (const it of items || []) {
    if (!it?.model_id) continue;
    const id = String(it.model_id).trim();
    if (!id) continue;
    m[id] = it as NxModelConfigRow;
  }
  return m;
}

export function readNxModelConfigPersisted(): NxModelConfigPersistedV1 | null {
  if (typeof window === 'undefined' || !window.localStorage) return null;
  try {
    const raw = window.localStorage.getItem(NX_MODEL_CONFIG_LS_KEY);
    if (!raw) return null;
    const o = JSON.parse(raw) as Partial<NxModelConfigPersistedV1>;
    if (o?.v !== 1 || typeof o.syncedAt !== 'number' || typeof o.email !== 'string' || !o.map || typeof o.map !== 'object') {
      return null;
    }
    return { v: 1, email: o.email, syncedAt: o.syncedAt, map: o.map as Record<string, NxModelConfigRow> };
  } catch {
    return null;
  }
}

export function writeNxModelConfigPersisted(data: NxModelConfigPersistedV1): void {
  if (typeof window === 'undefined' || !window.localStorage) return;
  try {
    window.localStorage.setItem(NX_MODEL_CONFIG_LS_KEY, JSON.stringify(data));
  } catch {
    /* quota / 隐私模式 */
  }
}

export function clearNxModelConfigPersisted(): void {
  if (typeof window === 'undefined' || !window.localStorage) return;
  try {
    window.localStorage.removeItem(NX_MODEL_CONFIG_LS_KEY);
  } catch {
    /* ignore */
  }
}
