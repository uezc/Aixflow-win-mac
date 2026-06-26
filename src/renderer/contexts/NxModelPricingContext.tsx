import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import type { NxModelConfigRow } from '../utils/nxModelConfigPricingCache';
import {
  clearNxModelConfigPersisted,
  itemsToCloudMap,
  NX_MODEL_CONFIG_SYNC_INTERVAL_MS,
  readNxModelConfigPersisted,
  writeNxModelConfigPersisted,
} from '../utils/nxModelConfigPricingCache';

export type { NxModelConfigRow } from '../utils/nxModelConfigPricingCache';

export const NX_SAAS_PRICING_REFRESH = 'nx-saas-pricing-refresh';

/** 定价同步异常提示（Toast + 状态栏红点） */
export type PricingSyncNotice = {
  variant: 'error' | 'warning';
  message: string;
};

type SyncOptions = {
  /** 为 true 时忽略 5 分钟节流（登录成功、进入画布等） */
  force?: boolean;
};

type NxModelConfigInvokeResult = {
  items?: unknown;
  fetchError?: string;
};

function shortenUserMessage(raw: string, max = 140): string {
  const s = String(raw || '').trim().replace(/\s+/g, ' ');
  if (s.length <= max) return s;
  return `${s.slice(0, max)}…`;
}

type Ctx = {
  /** null = 无可用云端/缓存；对象 = 有定价表（可能来自缓存 SWR） */
  cloudMap: Record<string, NxModelConfigRow> | null;
  cloudLoaded: boolean;
  /** 最近一次同步失败或可疑结果；成功拉取非空表后会清除 */
  pricingSyncNotice: PricingSyncNotice | null;
  dismissPricingSyncNotice: () => void;
  /** 兼容旧 API：等同 syncCloudPricing({ force: true }) */
  refresh: () => Promise<void>;
  /** SWR：优先内存/缓存，必要时请求 /model-config；受 5 分钟节流约束（force 可跳过） */
  syncCloudPricing: (opts?: SyncOptions) => Promise<void>;
};

const NxModelPricingContext = createContext<Ctx | null>(null);

const NOTICE_AUTO_DISMISS_MS = 12_000;

export function NxModelPricingProvider({ children }: { children: React.ReactNode }) {
  const [cloudMap, setCloudMap] = useState<Record<string, NxModelConfigRow> | null>(null);
  const [cloudLoaded, setCloudLoaded] = useState(false);
  const [pricingSyncNotice, setPricingSyncNotice] = useState<PricingSyncNotice | null>(null);
  const lastSyncAtRef = useRef(0);
  /** 用于识别「拉取返回 0 条」的异常，避免用空结果覆盖有效缓存并触发 5 分钟节流 */
  const lastNonEmptyMapRef = useRef<Record<string, NxModelConfigRow> | null>(null);

  const dismissPricingSyncNotice = useCallback(() => {
    setPricingSyncNotice(null);
  }, []);

  useEffect(() => {
    if (!pricingSyncNotice) return;
    const t = window.setTimeout(() => setPricingSyncNotice(null), NOTICE_AUTO_DISMISS_MS);
    return () => window.clearTimeout(t);
  }, [pricingSyncNotice]);

  const applyHydratedCache = useCallback((email: string) => {
    const p = readNxModelConfigPersisted();
    if (!p || p.email !== email || !Object.keys(p.map).length) return false;
    setCloudMap(p.map);
    lastNonEmptyMapRef.current = p.map;
    lastSyncAtRef.current = p.syncedAt;
    return true;
  }, []);

  const syncCloudPricing = useCallback(async (opts?: SyncOptions) => {
    const api = typeof window !== 'undefined' ? window.electronAPI : undefined;
    if (!api?.nxCloudFetchModelConfig || !api.getNxSaasState) {
      setCloudMap(null);
      setCloudLoaded(true);
      return;
    }

    let s: Awaited<ReturnType<NonNullable<typeof api.getNxSaasState>>>;
    try {
      s = await api.getNxSaasState();
    } catch {
      setCloudLoaded(true);
      return;
    }

    // 与 nxCloudFetchModelConfig 一致：只要有 JWT 即可拉 /model-config，不要求 NX_SAAS_MODE（enabled 仅用于启动时 SaaS 引导弹窗）
    if (!s.loggedIn) {
      setCloudMap(null);
      lastSyncAtRef.current = 0;
      lastNonEmptyMapRef.current = null;
      clearNxModelConfigPersisted();
      setPricingSyncNotice(null);
      setCloudLoaded(true);
      return;
    }

    const email = (s.email || '').trim();
    if (!opts?.force && lastSyncAtRef.current > 0) {
      const delta = Date.now() - lastSyncAtRef.current;
      if (delta >= 0 && delta < NX_MODEL_CONFIG_SYNC_INTERVAL_MS) {
        setCloudLoaded(true);
        return;
      }
    }

    try {
      const r = (await api.nxCloudFetchModelConfig()) as NxModelConfigInvokeResult;
      const fetchErr = typeof r.fetchError === 'string' && r.fetchError.trim() ? r.fetchError.trim() : '';

      if (fetchErr) {
        const detail = shortenUserMessage(fetchErr);
        setPricingSyncNotice({
          variant: 'error',
          message: `拉取云端定价失败：${detail}（界面可能仍为缓存或本地回退价，与后台改价无关）`,
        });
        lastSyncAtRef.current = 0;
        setCloudLoaded(true);
        return;
      }

      const m = itemsToCloudMap(Array.isArray(r.items) ? r.items : []);
      const now = Date.now();
      const prevGood = lastNonEmptyMapRef.current;

      if (Object.keys(m).length === 0 && prevGood && Object.keys(prevGood).length > 0) {
        console.warn(
          '[NxModelPricing] /model-config 返回 0 条，保留上次有效缓存；请检查 FC 与 OTS 或主进程日志 nx-cloud-fetch-model-config',
        );
        setPricingSyncNotice({
          variant: 'warning',
          message:
            '云端返回的定价表为空，已保留上次缓存。多为 FC 未连上 OTS 或接口异常，与「后台表格是否改价」无关，请先排查网络与 FC。',
        });
        lastSyncAtRef.current = 0;
        setCloudLoaded(true);
        return;
      }

      if (Object.keys(m).length === 0 && opts?.force && (!prevGood || Object.keys(prevGood).length === 0)) {
        setPricingSyncNotice({
          variant: 'warning',
          message:
            '未获取到任何模型定价行，将使用本地回退价。若刚在后台改价，请确认线上 FC 连接的 Tablestore 与后台管理一致。',
        });
        lastSyncAtRef.current = 0;
        setCloudMap(m);
        clearNxModelConfigPersisted();
        setCloudLoaded(true);
        return;
      }

      if (Object.keys(m).length > 0) {
        lastNonEmptyMapRef.current = m;
        setPricingSyncNotice(null);
      }

      setCloudMap(m);
      lastSyncAtRef.current = now;
      writeNxModelConfigPersisted({ v: 1, email, syncedAt: now, map: m });
    } catch (e) {
      const detail = shortenUserMessage(e instanceof Error ? e.message : String(e));
      setPricingSyncNotice({
        variant: 'error',
        message: detail
          ? `拉取定价表异常：${detail}`
          : '拉取定价表异常，请查看主进程日志 nx-cloud-fetch-model-config。',
      });
    } finally {
      setCloudLoaded(true);
    }
  }, []);

  const refresh = useCallback(async () => {
    await syncCloudPricing({ force: true });
  }, [syncCloudPricing]);

  /** 首启：SWR hydrate + 必要时拉网；延迟重试对齐 JWT 恢复 */
  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      const api = typeof window !== 'undefined' ? window.electronAPI : undefined;
      if (!api?.nxCloudFetchModelConfig || !api.getNxSaasState) {
        if (!cancelled) {
          setCloudMap(null);
          setCloudLoaded(true);
        }
        return;
      }

      let s: Awaited<ReturnType<NonNullable<typeof api.getNxSaasState>>>;
      try {
        s = await api.getNxSaasState();
      } catch {
        if (!cancelled) setCloudLoaded(true);
        return;
      }

      if (!s.loggedIn) {
        if (!cancelled) {
          setCloudMap(null);
          lastSyncAtRef.current = 0;
          lastNonEmptyMapRef.current = null;
          setCloudLoaded(true);
        }
        return;
      }

      if (cancelled) return;

      const email = (s.email || '').trim();
      const hydrated = applyHydratedCache(email);
      if (hydrated) {
        setCloudLoaded(true);
      }

      await syncCloudPricing({ force: false });
    };

    void run();
    const t1 = window.setTimeout(() => void syncCloudPricing({ force: false }), 800);
    const t2 = window.setTimeout(() => void syncCloudPricing({ force: false }), 2200);
    return () => {
      cancelled = true;
      window.clearTimeout(t1);
      window.clearTimeout(t2);
    };
  }, [applyHydratedCache, syncCloudPricing]);

  useEffect(() => {
    const onRefresh = () => void syncCloudPricing({ force: true });
    window.addEventListener(NX_SAAS_PRICING_REFRESH, onRefresh);
    return () => window.removeEventListener(NX_SAAS_PRICING_REFRESH, onRefresh);
  }, [syncCloudPricing]);

  const value = useMemo<Ctx>(
    () => ({
      cloudMap,
      cloudLoaded,
      pricingSyncNotice,
      dismissPricingSyncNotice,
      refresh,
      syncCloudPricing,
    }),
    [cloudMap, cloudLoaded, pricingSyncNotice, dismissPricingSyncNotice, refresh, syncCloudPricing],
  );

  const toastBorder =
    pricingSyncNotice?.variant === 'error' ? 'border-l-red-500' : 'border-l-amber-500';

  return (
    <NxModelPricingContext.Provider value={value}>
      {children}
      {pricingSyncNotice
        ? createPortal(
            <div
              className={`fixed bottom-24 left-1/2 z-[10000] flex max-w-[min(92vw,28rem)] -translate-x-1/2 items-start gap-3 rounded-lg border border-white/15 border-l-4 ${toastBorder} bg-black/85 px-4 py-3 text-sm text-white shadow-xl backdrop-blur-md`}
              role="alert"
            >
              <p className="flex-1 leading-snug pt-0.5">{pricingSyncNotice.message}</p>
              <button
                type="button"
                onClick={dismissPricingSyncNotice}
                className="shrink-0 rounded-md p-1 text-white/60 hover:bg-white/10 hover:text-white"
                aria-label="关闭"
              >
                <X className="w-4 h-4" />
              </button>
            </div>,
            document.body,
          )
        : null}
    </NxModelPricingContext.Provider>
  );
}

export function useNxModelPricing(): Ctx {
  const v = useContext(NxModelPricingContext);
  if (!v) {
    return {
      cloudMap: null,
      cloudLoaded: true,
      pricingSyncNotice: null,
      dismissPricingSyncNotice: () => {},
      refresh: async () => {},
      syncCloudPricing: async () => {},
    };
  }
  return v;
}
