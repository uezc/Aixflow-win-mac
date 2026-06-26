/**
 * 场景化 FC 线路：默认香港；付款固定香港；网络不畅时自动尝试北京 FC。
 */
import axios from 'axios';
import https from 'https';
import { store } from './store.js';
import {
  clearAliyunFcRuntimeOverride,
  getAliyunFcInitUserUrl,
  getAliyunFcToken,
  getBeijingFcEndpoint,
  getHongKongFcEndpoint,
  setAliyunFcRuntimeOverride,
} from '../config/aliyunConfig.js';
import { resetNxFcAxios } from './nxFcClient.js';
import {
  applyMediaOssRegion,
  getEffectiveDualRegion,
  mediaOssRegionToFcRoute,
} from './ossUploadSession.js';

export type NxFcRoute = 'hk' | 'beijing';

const probeAgent = new https.Agent({ keepAlive: false });
const PROBE_TIMEOUT_MS = 3500;

let fcGenerationActivityCount = 0;

export function getStoredNxFcRoute(): NxFcRoute {
  const raw = String(store.get('nxCloudFcRoute') || 'beijing').toLowerCase();
  return raw === 'beijing' ? 'beijing' : 'hk';
}

export function applyNxFcRoute(route: NxFcRoute): string {
  const hk = getHongKongFcEndpoint();
  const beijing = getBeijingFcEndpoint();
  if (route === 'beijing' && beijing) {
    const next = setAliyunFcRuntimeOverride(beijing);
    resetNxFcAxios();
    return next;
  }
  if (route === 'hk' && hk) {
    const next = setAliyunFcRuntimeOverride(hk);
    resetNxFcAxios();
    return next;
  }
  clearAliyunFcRuntimeOverride();
  resetNxFcAxios();
  return getAliyunFcInitUserUrl();
}

function normalizeFcBase(endpoint: string): string {
  return String(endpoint || '')
    .trim()
    .replace(/\/init-user\/?$/, '')
    .replace(/\/run-task\/?$/, '')
    .replace(/\/$/, '');
}

export function shouldAutoFailoverFcError(err: unknown): boolean {
  const ax = axios.isAxiosError(err) ? err : null;
  const code = ax?.code || (err as { code?: string })?.code || '';
  const msg = err instanceof Error ? err.message : String(err ?? '');
  const status = ax?.response?.status;
  if (status != null && status >= 500) return true;
  return (
    code === 'ETIMEDOUT' ||
    code === 'ECONNRESET' ||
    code === 'ECONNREFUSED' ||
    code === 'ECONNABORTED' ||
    code === 'ENOTFOUND' ||
    msg.includes('请求超时') ||
    msg.includes('无法连接云端服务') ||
    msg.includes('ETIMEDOUT') ||
    msg.includes('ECONNRESET') ||
    msg.includes('ECONNREFUSED') ||
    msg.includes('ENOTFOUND') ||
    msg.includes('socket hang up') ||
    msg.includes('HTTP 504') ||
    msg.includes('504')
  );
}

/** 探测 FC 是否可达（401/403 视为在线；5xx/超时视为不可用） */
export async function probeFcEndpoint(endpoint: string, timeoutMs = PROBE_TIMEOUT_MS): Promise<boolean> {
  const base = normalizeFcBase(endpoint);
  const token = getAliyunFcToken();
  if (!base || !token) return false;
  try {
    const res = await axios.post(`${base}/me`, {}, {
      timeout: timeoutMs,
      proxy: false,
      httpsAgent: probeAgent,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'x-nexflow-token': token,
      },
      validateStatus: (s) => s > 0 && s < 500,
    });
    return res.status > 0 && res.status < 500;
  } catch (e) {
    if (axios.isAxiosError(e) && e.response && e.response.status > 0 && e.response.status < 500) {
      return true;
    }
    return false;
  }
}

async function persistRoute(route: NxFcRoute, reason: string): Promise<string> {
  store.set('nxCloudFcRoute', route);
  const active = applyNxFcRoute(route);
  console.log(`[NxFc] 线路 → ${route} (${reason})`);
  return active;
}

export function beginFcGenerationActivity(): void {
  fcGenerationActivityCount += 1;
}

export function endFcGenerationActivity(): void {
  fcGenerationActivityCount = Math.max(0, fcGenerationActivityCount - 1);
  if (fcGenerationActivityCount === 0) {
    void ensureFcRouteForCanvas().catch((e) => {
      console.warn('[NxFc] 生成结束后恢复默认线路失败', e);
    });
  }
}

export function isFcGenerationBusy(): boolean {
  return fcGenerationActivityCount > 0;
}

/** 付款前：固定切香港（与支付 backend 入账 FC 一致） */
export async function ensureFcRouteForPayment(): Promise<{ route: NxFcRoute; switched: boolean; activeEndpoint: string }> {
  const prev = getStoredNxFcRoute();
  const hk = getHongKongFcEndpoint();
  if (!hk) {
    return { route: prev, switched: false, activeEndpoint: applyNxFcRoute(prev) };
  }
  if (prev === 'hk') {
    return { route: 'hk', switched: false, activeEndpoint: applyNxFcRoute('hk') };
  }
  const activeEndpoint = await persistRoute('hk', 'payment');
  return { route: 'hk', switched: true, activeEndpoint };
}

/** 进画布：尊重用户已选北京线路；否则默认香港 FC */
export async function ensureFcRouteForCanvas(): Promise<{
  route: NxFcRoute;
  beijingAvailable: boolean;
  deferred: boolean;
  activeEndpoint: string;
}> {
  const beijingAvailable = Boolean(getBeijingFcEndpoint());

  if (isFcGenerationBusy()) {
    const route = getStoredNxFcRoute();
    return {
      route,
      beijingAvailable,
      deferred: true,
      activeEndpoint: applyNxFcRoute(route),
    };
  }

  const hk = getHongKongFcEndpoint();
  const stored = getStoredNxFcRoute();

  if (stored === 'beijing' && beijingAvailable) {
    const activeEndpoint = applyNxFcRoute('beijing');
    return { route: 'beijing', beijingAvailable: true, deferred: false, activeEndpoint };
  }

  if (!hk) {
    if (beijingAvailable) {
      const activeEndpoint = await persistRoute('beijing', 'canvas-no-hk-endpoint');
      return { route: 'beijing', beijingAvailable: true, deferred: false, activeEndpoint };
    }
    const route = getStoredNxFcRoute();
    return { route, beijingAvailable: false, deferred: false, activeEndpoint: applyNxFcRoute(route) };
  }

  const activeEndpoint = applyNxFcRoute('hk');
  return { route: 'hk', beijingAvailable, deferred: false, activeEndpoint };
}

/** 启动时：按已保存的「中国优化/全球线路」同步 FC 与素材 OSS */
export async function applyStartupFcRoute(): Promise<{ route: NxFcRoute; activeEndpoint: string }> {
  const mediaRegion = getEffectiveDualRegion();
  applyMediaOssRegion(mediaRegion);
  const route = mediaOssRegionToFcRoute(mediaRegion);
  store.set('nxCloudFcRoute', route);
  const hk = getHongKongFcEndpoint();
  const beijing = getBeijingFcEndpoint();

  if (route === 'beijing' && beijing) {
    const activeEndpoint = applyNxFcRoute('beijing');
    return { route: 'beijing', activeEndpoint };
  }
  if (route === 'hk' && hk) {
    const activeEndpoint = applyNxFcRoute('hk');
    return { route: 'hk', activeEndpoint };
  }
  if (beijing) {
    const activeEndpoint = applyNxFcRoute('beijing');
    store.set('nxCloudFcRoute', 'beijing');
    return { route: 'beijing', activeEndpoint };
  }
  return { route: 'hk', activeEndpoint: applyNxFcRoute('hk') };
}

/** 香港失败 → 探测北京并重试；北京失败 → 回退香港并重试 */
export async function withFcRouteFailover<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (!shouldAutoFailoverFcError(err)) throw err;

    const current = getStoredNxFcRoute();
    if (current === 'hk') {
      const beijing = getBeijingFcEndpoint();
      if (!beijing) throw err;
      const ok = await probeFcEndpoint(beijing);
      if (!ok) throw err;
      console.warn('[NxFc] 香港线路请求失败，切换北京 FC 并重试一次');
      await persistRoute('beijing', 'failover-hk-error');
      return await fn();
    }

    if (current === 'beijing') {
      const hk = getHongKongFcEndpoint();
      if (!hk) throw err;
      console.warn('[NxFc] 北京线路请求失败，切换香港 FC 并重试一次');
      await persistRoute('hk', 'failover-beijing-error');
      return await fn();
    }

    throw err;
  }
}
