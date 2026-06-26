/**
 * 客户端：SSE 事件优先 + 5s polling fallback
 */
import axios from 'axios';
import http from 'http';
import https from 'https';
import { notifyCloudUserStateRefresh } from '../cloudBalanceNotifier.js';
import { getCloudUserState, nxCloudGetProfile } from './aliyunService.js';

const DEFAULT_BASE = 'http://127.0.0.1:8000';
const POLL_FALLBACK_MS = 5000;
const MAX_POLL_ATTEMPTS = 60;

function alipayApiBase(): string {
  return (process.env.ALIPAY_API_BASE || DEFAULT_BASE).replace(/\/$/, '');
}

export type AlipayOrderStatus = {
  out_trade_no: string;
  status: string;
  settlement_status?: string | null;
  is_settled?: boolean;
  balance?: number | null;
  package_yuanbao?: number | null;
  total_yuanbao?: number | null;
};

export type RechargeSettledPayload = {
  outTradeNo: string;
  balance: number;
  addedYuanbao: number;
  event?: string;
};

type SettleCallback = (payload: RechargeSettledPayload) => void;

type WatcherState = {
  pollTimer: NodeJS.Timeout | null;
  sseReq: http.ClientRequest | null;
  sseBuffer: string;
  stopped: boolean;
};

const activeWatchers = new Map<string, WatcherState>();

export async function fetchAlipayOrderStatus(outTradeNo: string): Promise<AlipayOrderStatus> {
  const key = String(outTradeNo ?? '').trim();
  const { data } = await axios.get<AlipayOrderStatus>(
    `${alipayApiBase()}/api/v1/alipay/order-status/${encodeURIComponent(key)}`,
    { timeout: 8000 },
  );
  return data;
}

function resolveAddedYuanbao(
  balance: number,
  baselineBalance: number,
  order?: Pick<AlipayOrderStatus, 'package_yuanbao' | 'total_yuanbao'>,
  hint?: number,
): number {
  const fromBalance = Math.max(0, balance - baselineBalance);
  const fromOrder = Number(order?.total_yuanbao ?? order?.package_yuanbao);
  const fromHint = Number(hint);
  const candidates = [fromBalance];
  if (Number.isFinite(fromOrder) && fromOrder > 0) candidates.push(fromOrder);
  if (Number.isFinite(fromHint) && fromHint > 0) candidates.push(fromHint);
  return Math.max(...candidates);
}

async function finalizeSettlement(
  key: string,
  baselineBalance: number,
  onSettled?: SettleCallback,
  addedHint?: number,
) {
  await nxCloudGetProfile();
  notifyCloudUserStateRefresh();
  const state = getCloudUserState();
  let balance = state.balance;
  let orderStatus: AlipayOrderStatus | null = null;
  try {
    orderStatus = await fetchAlipayOrderStatus(key);
    if (typeof orderStatus.balance === 'number') balance = orderStatus.balance;
  } catch {
    /* use profile balance */
  }
  if (balance <= baselineBalance) balance = state.balance;
  const addedYuanbao = resolveAddedYuanbao(
    balance,
    baselineBalance,
    orderStatus ?? undefined,
    addedHint,
  );
  stopWatch(key);
  onSettled?.({ outTradeNo: key, balance, addedYuanbao, event: 'recharge-settled' });
}

function stopWatch(outTradeNo: string): void {
  const key = String(outTradeNo ?? '').trim();
  const w = activeWatchers.get(key);
  if (!w) return;
  w.stopped = true;
  if (w.pollTimer) clearInterval(w.pollTimer);
  if (w.sseReq && !w.sseReq.destroyed) w.sseReq.destroy();
  activeWatchers.delete(key);
}

function parseSseChunk(buffer: string, onData: (obj: Record<string, unknown>) => void): string {
  const parts = buffer.split('\n\n');
  const rest = parts.pop() ?? '';
  for (const block of parts) {
    for (const line of block.split('\n')) {
      if (!line.startsWith('data:')) continue;
      const raw = line.slice(5).trim();
      if (!raw) continue;
      try {
        onData(JSON.parse(raw) as Record<string, unknown>);
      } catch {
        /* ignore */
      }
    }
  }
  return rest;
}

function connectSse(
  key: string,
  baselineBalance: number,
  onSettled?: SettleCallback,
  state?: WatcherState,
) {
  const w = state ?? activeWatchers.get(key);
  if (!w || w.stopped) return;

  const url = new URL(`${alipayApiBase()}/api/v1/alipay/events/stream`);
  url.searchParams.set('out_trade_no', key);

  const transport = url.protocol === 'https:' ? https : http;
  const req = transport.get(url, (res) => {
    res.on('data', (chunk: Buffer) => {
      if (w.stopped) return;
      w.sseBuffer = parseSseChunk(w.sseBuffer + chunk.toString('utf8'), (msg) => {
        const event = String(msg.event || '');
        if (event === 'recharge-settled') {
          const hint = Number(msg.total_yuanbao);
          void finalizeSettlement(
            key,
            baselineBalance,
            onSettled,
            Number.isFinite(hint) && hint > 0 ? hint : undefined,
          );
        }
      });
    });
    res.on('end', () => {
      if (!w.stopped) setTimeout(() => connectSse(key, baselineBalance, onSettled, w), 2000);
    });
  });

  req.on('error', () => {
    if (!w.stopped) setTimeout(() => connectSse(key, baselineBalance, onSettled, w), 3000);
  });

  w.sseReq = req;
}

/** SSE 优先；5s polling 仅 fallback */
export function watchAlipayOrderSettlement(
  outTradeNo: string,
  baselineBalance: number,
  onSettled?: SettleCallback,
): () => void {
  const key = String(outTradeNo ?? '').trim();
  if (!key) return () => {};
  stopWatch(key);

  const state: WatcherState = {
    pollTimer: null,
    sseReq: null,
    sseBuffer: '',
    stopped: false,
  };
  activeWatchers.set(key, state);

  connectSse(key, baselineBalance, onSettled, state);

  let attempts = 0;
  state.pollTimer = setInterval(() => {
    if (state.stopped) return;
    attempts += 1;
    if (attempts > MAX_POLL_ATTEMPTS) {
      stopWatch(key);
      return;
    }
    void (async () => {
      try {
        const st = await fetchAlipayOrderStatus(key);
        const settled = st.status === 'paid' || st.is_settled === true || st.settlement_status === 'settled';
        if (settled) await finalizeSettlement(key, baselineBalance, onSettled);
      } catch {
        /* ignore */
      }
    })();
  }, POLL_FALLBACK_MS);

  return () => stopWatch(key);
}

export function stopAllAlipayOrderWatchers(): void {
  for (const key of [...activeWatchers.keys()]) stopWatch(key);
}
