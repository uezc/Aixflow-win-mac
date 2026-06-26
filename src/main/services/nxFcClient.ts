import axios, { type AxiosInstance, type InternalAxiosRequestConfig } from 'axios';
import https from 'https';
import { store } from './store.js';
import { getAliyunFcInitUserUrl, getAliyunFcToken } from '../config/aliyunConfig.js';

const STORE_KEY = 'cloudUser';

const httpsAgent = new https.Agent({
  keepAlive: true,
  keepAliveMsecs: 1000,
  maxSockets: 10,
  maxFreeSockets: 5,
});

function readNxAccessToken(): string {
  const raw = (store as { get: (k: string) => unknown }).get(STORE_KEY) as Record<string, unknown> | undefined;
  if (raw && typeof raw === 'object' && typeof raw.nxAccessToken === 'string') {
    return raw.nxAccessToken.trim();
  }
  return '';
}

/** 与 aliyunService.getFcBaseUrl 一致：FC 根 URL（不含 /init-user、/run-task） */
export function getFcBaseUrlForClient(): string {
  const raw = getAliyunFcInitUserUrl().trim() || '';
  return raw.replace(/\/init-user\/?$/, '').replace(/\/run-task\/?$/, '').replace(/\/$/, '');
}

/** 免 Bearer 的路径（含 /auth/send-code、/auth/change-password；登录、注册、刷新等；运营 internal 由管理密钥调用） */
function isNoBearerPath(pathname: string): boolean {
  const p = pathname.replace(/\/$/, '').split('?')[0];
  return (
    p.endsWith('/login') ||
    p.endsWith('/auth/login') ||
    p.endsWith('/auth/send-code') ||
    p.endsWith('/auth/change-password') ||
    p.endsWith('/register') ||
    p.endsWith('/refresh') ||
    p.endsWith('/internal/issue-coupon') ||
    p.includes('/internal/admin-')
  );
}

let nxFcAxios: AxiosInstance | null = null;

/** 运行时切换 FC 入口后，清理单例让下次按最新地址重建 */
export function resetNxFcAxios(): void {
  nxFcAxios = null;
}

/**
 * 从环境变量解析 HTTP(S) 代理（与 curl 一致）。
 */
function proxyFromEnv(): false | { protocol: string; host: string; port: number; auth?: { username: string; password: string } } {
  const raw = (process.env.HTTPS_PROXY || process.env.HTTP_PROXY || process.env.ALL_PROXY || '').trim();
  if (!raw) return false;
  try {
    const u = new URL(raw);
    const port = u.port ? parseInt(u.port, 10) : u.protocol === 'https:' ? 443 : 80;
    if (!u.hostname || !Number.isFinite(port)) return false;
    const protocol = u.protocol === 'https:' ? 'https' : 'http';
    const cfg: { protocol: string; host: string; port: number; auth?: { username: string; password: string } } = {
      protocol,
      host: u.hostname,
      port,
    };
    if (u.username) {
      cfg.auth = {
        username: decodeURIComponent(u.username),
        password: decodeURIComponent(u.password || ''),
      };
    }
    return cfg;
  } catch {
    return false;
  }
}

/**
 * 发往阿里云 FC 的 axios 实例：统一 x-nexflow-token，并对受保护路径自动附加 Authorization: Bearer &lt;accessToken&gt;。
 */
export function getNxFcAxios(): AxiosInstance {
  if (nxFcAxios) return nxFcAxios;

  const baseURL = getFcBaseUrlForClient();
  const fcTok = getAliyunFcToken();
  const envProxy = proxyFromEnv();
  const useEnvProxy = Boolean(envProxy);
  if (useEnvProxy && envProxy) {
    console.info('[NxFc] 使用代理', `${envProxy.host}:${envProxy.port}`, '（若仍 ETIMEDOUT 请检查代理软件是否允许本地应用）');
  } else {
    console.info('[NxFc] 未配置 HTTPS_PROXY/HTTP_PROXY/ALL_PROXY，FC 为直连；若报 connect ETIMEDOUT 可在项目根 .env 增加一行：HTTPS_PROXY=http://127.0.0.1:你的HTTP代理端口');
  }
  nxFcAxios = axios.create({
    baseURL: baseURL || undefined,
    timeout: 10000,
    ...(useEnvProxy && envProxy
      ? { proxy: envProxy }
      : { proxy: false as const, httpsAgent }),
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      ...(fcTok ? { 'x-nexflow-token': fcTok } : {}),
    },
  });

  nxFcAxios.interceptors.request.use((config: InternalAxiosRequestConfig) => {
    const url = config.url || '';
    let pathname = url;
    try {
      if (url.startsWith('http')) {
        pathname = new URL(url).pathname;
      }
    } catch {
      pathname = url;
    }
    const clean = pathname.split('?')[0];
    if (!isNoBearerPath(clean)) {
      const token = readNxAccessToken();
      if (token) {
        config.headers = config.headers || {};
        (config.headers as Record<string, string>)['Authorization'] = `Bearer ${token}`;
      }
    }
    return config;
  });

  return nxFcAxios;
}
