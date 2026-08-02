import { createRequire } from 'module';
import https from 'https';
const require = createRequire(import.meta.url);
const { machineIdSync } = require('node-machine-id');
import axios from 'axios';

const httpsAgent = new https.Agent({
  keepAlive: true,
  keepAliveMsecs: 1000,
  maxSockets: 10,
  maxFreeSockets: 5,
});
import { store } from './store.js';
import {
  getAliyunFcInitUserUrl,
  getAliyunFcToken,
  NX_SAAS_MODE,
  NX_CLOUD_OFFLINE_LOGIN_WHEN_NO_FC,
  NX_LEGACY_MACHINE_INIT_USER,
} from '../config/aliyunConfig.js';
import { getFcBaseUrlForClient, getNxFcAxios } from './nxFcClient.js';
import {
  beginFcGenerationActivity,
  endFcGenerationActivity,
  withFcRouteFailover,
} from './nxFcRouteManager.js';

/** 渚?ai-provider 绛夊垽鏂槸鍚︿负姝ｅ紡鐗?SaaS锛堜粎 JWT锛屼笉鍙?x-user-id锛?*/
export function isNxSaasMode(): boolean {
  return NX_SAAS_MODE;
}

const FC_TIMEOUT_MS = 10000;
/**
 * 拉取流水/任务/定价（POST /transactions、/tasks、/model-config）：
 * FC 侧查 Tablestore，数据多或冷启动时易超时。
 * 默认 25s（过长会让主进程堆积挂起请求，界面假死）；可用 NX_FC_LIST_QUERY_TIMEOUT_MS 覆盖（10000–300000）。
 */
const FC_LIST_QUERY_TIMEOUT_MS = (() => {
  const raw = process.env.NX_FC_LIST_QUERY_TIMEOUT_MS?.trim();
  const n = raw ? Number(raw) : 25_000;
  if (!Number.isFinite(n)) return 25_000;
  return Math.min(300_000, Math.max(10_000, n));
})();
/** 涓?1 鏃朵笉璇锋眰 POST /tasks锛堜粎璺宠繃浜戠浠诲姟鍒楄〃鍚屾锛涙湰鍦?B 绔欐姄鍙栫瓑涓嶄緷璧?FC锛?*/
const NX_SKIP_CLOUD_TASK_SYNC = process.env.NX_SKIP_CLOUD_TASK_SYNC === '1';
function isCloudTaskSyncForceDisabled(): boolean {
  if (process.env.NX_SKIP_CLOUD_TASK_SYNC === '1') {
    console.error('[CRITICAL] 云端同步已通过 .env 强制关闭，正在阻止无效的 API 调用。');
    return true;
  }
  return false;
}
/** 鐧诲綍/娉ㄥ唽/楠岃瘉鐮?鍒锋柊浠ょ墝锛欶C 鍐峰惎鍔ㄦ垨璺ㄥ尯閾捐矾甯歌秴杩?10s锛岄伩鍏嶈鍒や负銆岀綉缁滆秴鏃躲€?*/
const FC_AUTH_TIMEOUT_MS = 60_000;
const FC_RETRY_COUNT = 3;
const FC_RETRY_DELAY_MS = 1000;
const STORE_KEY = 'cloudUser';
const NX_LAST_LOGIN_EMAIL_KEY = 'nxLastLoginEmail';
/** 每次启动强制手动登录：清空上次云端 JWT 会话（保留最近登录邮箱缓存） */
(function clearCloudSessionOnAppStart() {
  try {
    const raw = (store as { get: (k: string) => unknown }).get(STORE_KEY);
    if (!raw || typeof raw !== 'object') return;
    const o = raw as Record<string, unknown>;
    const hasToken =
      (typeof o.nxAccessToken === 'string' && o.nxAccessToken.trim() !== '') ||
      (typeof o.nxRefreshToken === 'string' && o.nxRefreshToken.trim() !== '');
    if (!hasToken) return;
    (store as { set: (k: string, v: unknown) => void }).set(STORE_KEY, {
      ...o,
      nxAccessToken: null,
      nxRefreshToken: null,
      nxEmail: null,
      isFirstRecharge: undefined,
      status: 'idle',
      balance: 0,
      isPro: false,
      nxBlockAutoSession: true,
    });
  } catch {
    // ignore
  }
})();

export function getNxLastLoginEmail(): string | null {
  const raw = (store as { get: (k: string) => unknown }).get(NX_LAST_LOGIN_EMAIL_KEY);
  if (typeof raw === 'string') {
    const t = raw.trim().toLowerCase();
    if (t) return t;
  }
  const s = getStoredState();
  const fromSession = typeof s.nxEmail === 'string' ? s.nxEmail.trim().toLowerCase() : '';
  if (fromSession) {
    (store as { set: (k: string, v: unknown) => void }).set(NX_LAST_LOGIN_EMAIL_KEY, fromSession);
    return fromSession;
  }
  return null;
}

/** 鏃?FC 鍦板潃鏃舵湰鍦颁細璇濇爣璁帮紙闈?JWT锛屼笉鍚?FC 鍙戝彈淇濇姢璇锋眰锛?*/
const NX_OFFLINE_LOCAL_ACCESS_TOKEN = 'nx-offline-local-v1';

export function isNxOfflineCloudSession(): boolean {
  return getNxAccessToken() === NX_OFFLINE_LOCAL_ACCESS_TOKEN;
}

function allowOfflineCloudLoginWhenNoFcUrl(): boolean {
  return NX_CLOUD_OFFLINE_LOGIN_WHEN_NO_FC && !getFcBaseUrl();
}

export interface CloudUserState {
  userId: string | null;
  /** 浜戠鐢ㄦ埛鏍囪瘑锛岀敤浜?x-user-id锛坢achineId锛屼笌 Tablestore machine_id 瀵瑰簲锛?*/
  machineId: string | null;
  balance: number;
  isPro: boolean;
  status: 'idle' | 'connecting' | 'success' | 'error';
  /** 姝ｅ紡鐗?JWT */
  nxAccessToken?: string | null;
  nxRefreshToken?: string | null;
  nxEmail?: string | null;
  /** 涓?Tablestore is_first_recharge 瀵归綈锛歵rue 鏃跺睍绀洪鍏呯壒鎯犳爣绛?*/
  isFirstRecharge?: boolean;
  /**
   * 鐢ㄦ埛鐐瑰嚮銆岄€€鍑虹櫥褰曘€嶅悗缃负 true锛氱姝㈤潤榛?refresh銆佹棫鐗?init-user 绛夊湪鏃犳柊 accessToken 鏃舵仮澶嶄細璇濄€?   * 鎵嬪姩瀵嗙爜/楠岃瘉鐮?娉ㄥ唽鐧诲綍鎴愬姛鍐欏叆 JWT 鏃剁敱 setNxAuth 娓呭洖 false銆?   */
  nxBlockAutoSession?: boolean;
}

function parseIsFirstRechargeFlag(raw: unknown): boolean | undefined {
  if (raw === true || raw === 'true') return true;
  if (raw === false || raw === 'false') return false;
  return undefined;
}

function getStoredState(): CloudUserState {
  const raw = (store as { get: (k: string) => unknown }).get(STORE_KEY);
  if (raw && typeof raw === 'object') {
    const o = raw as Record<string, unknown>;
    return {
      userId: typeof o.userId === 'string' ? o.userId : null,
      machineId: typeof o.machineId === 'string' ? o.machineId : null,
      balance: typeof o.balance === 'number' ? o.balance : 0,
      isPro: Boolean(o.isPro),
      status: (o.status as CloudUserState['status']) || 'idle',
      nxAccessToken: typeof o.nxAccessToken === 'string' ? o.nxAccessToken : null,
      nxRefreshToken: typeof o.nxRefreshToken === 'string' ? o.nxRefreshToken : null,
      nxEmail: typeof o.nxEmail === 'string' ? o.nxEmail : null,
      isFirstRecharge: parseIsFirstRechargeFlag(o.isFirstRecharge),
      nxBlockAutoSession: o.nxBlockAutoSession === true,
    };
  }
  return {
    userId: null,
    machineId: null,
    balance: 0,
    isPro: false,
    status: 'idle',
    nxAccessToken: null,
    nxRefreshToken: null,
    nxEmail: null,
    nxBlockAutoSession: false,
  };
}

function getFcBaseUrl(): string {
  return getFcBaseUrlForClient();
}

/** 姝ｅ紡鐗?access_token锛屼緵 FC run-task */
export function getNxAccessToken(): string {
  const s = getStoredState();
  return (s.nxAccessToken || '').trim();
}

export function getNxRefreshToken(): string {
  const s = getStoredState();
  return (s.nxRefreshToken || '').trim();
}

export function setNxAuth(tokens: {
  accessToken?: string;
  refreshToken?: string;
  userId?: string | null;
  email?: string;
  balance?: number;
  isFirstRecharge?: boolean;
}): void {
  const cur = getStoredState();
  const accessIncoming = tokens.accessToken;
  const clearsAutoSessionLock =
    accessIncoming !== undefined && String(accessIncoming ?? '').trim() !== '';
  setStoredState({
    ...cur,
    ...(tokens.accessToken != null && { nxAccessToken: tokens.accessToken }),
    ...(tokens.refreshToken != null && { nxRefreshToken: tokens.refreshToken }),
    ...(tokens.userId != null && { userId: tokens.userId }),
    ...(tokens.email != null && { nxEmail: tokens.email }),
    ...(tokens.balance != null && { balance: tokens.balance }),
    ...(tokens.isFirstRecharge !== undefined && { isFirstRecharge: tokens.isFirstRecharge }),
    ...(clearsAutoSessionLock ? { nxBlockAutoSession: false as const } : {}),
    status: 'success',
  });
}

export function clearNxAuth(): void {
  const cur = getStoredState();
  setStoredState({
    ...cur,
    nxAccessToken: null,
    nxRefreshToken: null,
    nxEmail: null,
    isFirstRecharge: undefined,
    status: 'idle',
    balance: 0,
    isPro: false,
    nxBlockAutoSession: true,
  });
}

/** 浣跨敤 refresh_token 鎹㈡柊 access_token */
export async function refreshNxAccessToken(): Promise<boolean> {
  if (getStoredState().nxBlockAutoSession) return false;
  if (isNxOfflineCloudSession()) return false;
  const base = getFcBaseUrl();
  const rt = getNxRefreshToken();
  if (!base || !rt || !getAliyunFcToken()) return false;
  try {
    const { data } = await getNxFcAxios().post<Record<string, unknown>>(
      '/refresh',
      { refresh_token: rt },
      { timeout: FC_AUTH_TIMEOUT_MS }
    );
    const accessToken = typeof data.accessToken === 'string' ? data.accessToken : (data as { access_token?: string }).access_token;
    const refreshToken = typeof data.refreshToken === 'string' ? data.refreshToken : (data as { refresh_token?: string }).refresh_token;
    const balance = typeof data.balance === 'number' ? data.balance : Number(data.balance) || 0;
    if (accessToken) {
      const isFirst = parseIsFirstRechargeFlag((data as { is_first_recharge?: unknown }).is_first_recharge);
      setNxAuth({
        accessToken,
        refreshToken: refreshToken || rt,
        balance,
        ...(isFirst !== undefined && { isFirstRecharge: isFirst }),
      });
      const { notifyCloudUserStateRefresh } = await import('../cloudBalanceNotifier.js');
      notifyCloudUserStateRefresh();
      return true;
    }
  } catch (e) {
    console.warn('[Aliyun] refresh token 澶辫触:', formatAliyunLogError(e));
  }
  return false;
}

/** 浠?FC / 缃戝叧鍝嶅簲浣撹В鏋愰敊璇爜锛堝吋瀹?error / message / code 瀛楁鍙?JSON 瀛楃涓诧級 */
function extractFcErrorCode(raw: unknown): string {
  if (raw == null) return '';
  if (typeof raw === 'string') {
    const t = raw.trim();
    if (!t) return '';
    try {
      const p = JSON.parse(t) as Record<string, unknown>;
      return extractFcErrorCode(p);
    } catch {
      return t.slice(0, 500);
    }
  }
  if (typeof raw === 'object' && raw !== null) {
    const o = raw as Record<string, unknown>;
    if (o.error != null && String(o.error).trim()) return String(o.error).trim();
    if (o.message != null && String(o.message).trim()) return String(o.message).trim();
    if (o.code != null && String(o.code).trim()) return String(o.code).trim();
  }
  return '';
}

/** 鎺у埗鍙版棩蹇楃敤锛氶伩鍏嶆墦鍗版暣棰?AxiosError锛堜細鍒峰睆鏁板崈琛岋級 */
function formatAliyunLogError(e: unknown): string {
  if (axios.isAxiosError(e)) {
    const st = e.response?.status;
    const raw = e.response?.data;
    const fromExtract = extractFcErrorCode(raw);
    let body = fromExtract;
    if (!body && raw != null) {
      body =
        typeof raw === 'object'
          ? JSON.stringify(raw).replace(/\s+/g, ' ').slice(0, 240)
          : String(raw).slice(0, 240);
    }
    const netCode = (e as { code?: string }).code;
    const parts = [
      netCode ? `net=${netCode}` : '',
      e.message ? `msg=${e.message.replace(/\s+/g, ' ').slice(0, 160)}` : '',
      st != null ? `http=${st}` : '',
      body ? `data=${body.slice(0, 220)}` : '',
    ].filter(Boolean);
    return parts.join(' | ') || 'axios error';
  }
  if (e instanceof Error) return e.message.slice(0, 300);
  try {
    return JSON.stringify(e).slice(0, 300);
  } catch {
    return String(e).slice(0, 300);
  }
}

/** 璇诲彇 FC JSON 鍝嶅簲涓殑 message 瀛楁锛堝彂淇″け璐ョ瓑鍦烘櫙鍙€忓嚭绠€鐭師鍥狅級 */
function extractFcOptionalDetail(raw: unknown): string {
  if (raw == null) return '';
  let o: Record<string, unknown> | null = null;
  if (typeof raw === 'object' && raw !== null) o = raw as Record<string, unknown>;
  else if (typeof raw === 'string') {
    try {
      const p = JSON.parse(raw) as Record<string, unknown>;
      if (p && typeof p === 'object') o = p;
    } catch {
      return '';
    }
  }
  if (!o) return '';
  const m = o.message;
  if (typeof m !== 'string' || !m.trim()) return '';
  return m.trim().replace(/\s+/g, ' ').slice(0, 220);
}

/** 灏?FC 杩斿洖鐨?HTTP 閿欒杞负鐢ㄦ埛鍙涓枃锛堥伩鍏?IPC 閫忓嚭 AxiosError 鑻辨枃锛?*/
export function nxFcErrorToUserMessage(e: unknown): string {
  if (axios.isAxiosError(e)) {
    if (!e.response) {
      const code = (e as { code?: string }).code;
      if (code === 'ECONNABORTED' || e.message?.includes('timeout')) return '请求超时，请检查网络后重试';
      return '无法连接云端服务，请检查网络与 FC 地址';
    }
    const status = e.response.status;
    const raw = e.response.data;
    const code = extractFcErrorCode(raw);
    if (status === 401) {
      const reqUrl = String((e as { config?: { url?: string } }).config?.url || '');
      if (reqUrl.includes('issue-coupon')) {
        return '兑换码签发未授权：请核对本机 .env 与函数计算中的 NX_ADMIN_ISSUE_COUPON_SECRET 完全一致';
      }
      // FC 鍦ㄩ厤缃簡 API_SECRET_TOKEN 鏃惰姹?x-nexflow-token 涓€鑷达紱缃戝叧鏈夋椂鐢?message 鑰岄潪 error
      const c = code.toUpperCase();
      if (c === 'UNAUTHORIZED' || /\bUNAUTHORIZED\b/i.test(code)) {
        return '未授权（401）：请逐项核对：① 本机 .env 中 ALIYUN_FC_TOKEN 与函数计算环境变量 API_SECRET_TOKEN 完全一致；② 请退出登录后重新用邮箱密码登录（JWT 过期或离线假登录会导致 401）；③ 若仅首行失败多为 x-nexflow-token 不匹配';
      }
      if (c === 'INVALID_CREDENTIALS' || /\binvalid.?credential/i.test(code)) {
        return '邮箱或密码错误';
      }
      if (c === 'INVALID_CODE' || c === 'INVALID_CODE_FORMAT') return '验证码错误或格式不正确';
      if (c === 'CODE_EXPIRED') return '楠岃瘉鐮佸凡杩囨湡锛岃閲嶆柊鑾峰彇';
      if (c === 'USE_OTP_LOGIN') return '璇蜂娇鐢ㄩ獙璇佺爜鐧诲綍';
      if (c === 'INVALID_REFRESH_TOKEN') return '登录已过期，请重新登录';
      if (c === 'SESSION_REVOKED') return '鐧诲綍宸插け鏁堬紙渚嬪瀵嗙爜宸蹭慨鏀癸級锛岃閲嶆柊鐧诲綍';
      if (!code || code.length > 80) {
        return '登录被拒（401）。请核对邮箱密码；若已配置 API_SECRET_TOKEN，请确认 .env 中 ALIYUN_FC_TOKEN 与云端一致且请求能到达正确 FC 地址';
      }
      return '邮箱或密码错误';
    }
    if (status === 403 && code === 'USER_FROZEN') return '璐﹀彿宸插喕缁擄紝璇疯仈绯荤鐞嗗憳';
    if (status === 400) {
      if (code === 'INVALID_COUPON_TIER') return '档位须为 30/50/100/200/500 元';
      if (code === 'COUPON_INVALID') return '兑换码无效';
      if (code === 'COUPON_USED') return '该兑换码已使用';
      if (code === 'COUPON_CODE_REQUIRED') return '璇疯緭鍏ュ厬鎹㈢爜';
      if (code === 'INVALID_EMAIL') return '璇峰～鍐欐湁鏁堢殑閭鍦板潃';
      if (code === 'INVALID_CODE_FORMAT') return '璇疯緭鍏?6 浣嶆暟瀛楅獙璇佺爜';
      if (code === 'password too short' || /password/i.test(code)) return '密码长度至少为 6 位';
      if (code === 'email and password required' || /email/i.test(code)) return '请填写有效的邮箱和密码';
      return '请求参数不正确';
    }
    if (status === 404) {
      if (code === 'USER_NOT_FOUND') return '未找到该邮箱对应的账户';
      const reqUrl = String((e as { config?: { url?: string } }).config?.url || '');
      if (reqUrl.includes('change-password')) {
        return '淇敼瀵嗙爜鍔熻兘鍦ㄤ簯绔湭閮ㄧ讲锛氳灏?demo/aliyun-fc-init-user 鏈€鏂颁唬鐮侊紙鍚?POST /auth/change-password锛夊彂甯冨埌褰撳墠鍑芥暟锛屽苟纭 .env 涓?ALIYUN_FC_INIT_USER_URL 鎸囧悜璇ュ嚱鏁扮殑 HTTP 瑙﹀彂鍣ㄥ湴鍧€';
      }
      return '浜戠鏈壘鍒拌鎺ュ彛銆傝纭鍑芥暟宸查儴缃叉渶鏂颁唬鐮侊紙鍚厬鎹㈢爜 POST /redeem-coupon锛夛紝骞舵牳瀵?.env 涓?ALIYUN_FC_INIT_USER_URL 鏄惁涓哄綋鍓?HTTP 瑙﹀彂鍣ㄥ湴鍧€';
    }
    if (status === 409) return '该邮箱已被注册';
    if (status === 429) {
      const rateDetail = extractFcOptionalDetail(raw);
      if (rateDetail) return rateDetail;
      if (code === 'RATE_LIMIT' || /rate/i.test(code)) return '发送过于频繁，请稍后再试';
      return '璇锋眰杩囦簬棰戠箒锛岃绋嶅悗鍐嶈瘯';
    }
    if (status === 500) {
      const errBlob = `${code} ${typeof raw === 'object' && raw !== null ? JSON.stringify(raw) : String(raw ?? '')}`;
      if (/OTSInvalidPK|Validate PK name fail|Meta:\s*tx_id/i.test(errBlob)) {
        return '流水表主键列名与程序不一致：请在函数计算「环境变量」中设置 OTS_TRANSACTIONS_PK=tx_id（若控制台流水表主键为 tx_id），并确认 OTS_TABLE_TRANSACTIONS 与表名一致，保存后重试';
      }
      if (code === 'COUPON_MISCONFIGURED') return '鍏戞崲鐮侀厤缃紓甯革紝璇疯仈绯荤鐞嗗憳';
      if (code === 'CHANGE_PASSWORD_FAILED') return '淇敼瀵嗙爜澶辫触锛岃绋嶅悗閲嶈瘯';
      if (code === 'VERIFY_READ_FAILED') return '验证码读取失败，请稍后再试';
      if (code === 'REGISTER_FAILED') return '娉ㄥ唽澶辫触锛岃绋嶅悗閲嶈瘯鎴栬仈绯荤鐞嗗憳';
      if (code === 'STORE_FAILED') return '验证码写入失败，请稍后再试';
      if (code === 'JWT_SECRET_NOT_CONFIGURED') return '云端未正确配置 JWT，请联系管理员';
      if (code === 'SEND_FAILED') {
        const d = extractFcOptionalDetail(raw);
        return d
          ? `楠岃瘉鐮侀偖浠跺彂閫佸け璐ワ細${d}`
          : '楠岃瘉鐮侀偖浠跺彂閫佸け璐ャ€傝纭鍑芥暟宸查儴缃蹭笖鍖呭惈 resend 渚濊禆锛屽苟鍦?FC 鐜鍙橀噺涓厤缃湁鏁堢殑 RESEND_API_KEY銆丷ESEND_FROM_EMAIL锛堝煙鍚嶅凡鍦?Resend 楠岃瘉锛夛紝鐒跺悗鏌ョ湅鍑芥暟鏃ュ織';
      }
      return '服务暂时不可用，请稍后再试';
    }
    if (status === 503 && code === 'ISSUE_COUPON_NOT_CONFIGURED') {
      return '浜戠鏈紑鍚厬鎹㈢爜绛惧彂锛氳鍦ㄥ嚱鏁拌绠楃幆澧冨彉閲忎腑閰嶇疆 NX_ADMIN_ISSUE_COUPON_SECRET';
    }
    if (status === 502) {
      if (code === 'SEND_FAILED') {
        const d = extractFcOptionalDetail(raw);
        return d
          ? `楠岃瘉鐮侀偖浠跺彂閫佸け璐ワ細${d}`
          : '验证码邮件发送失败，请稍后再试或联系管理员';
      }
      return '浜戠缃戝叧鎴栨湇鍔℃殏鏃朵笉鍙敤锛岃绋嶅悗閲嶈瘯';
    }
    if (status === 503 && code === 'RESEND_NOT_CONFIGURED') {
      return '浜戠鏈厤缃偖浠舵湇鍔★紙RESEND_API_KEY / RESEND_FROM_EMAIL锛夛紝璇疯仈绯荤鐞嗗憳';
    }
    if (status === 502 || status === 503 || status === 504) {
      return '浜戠缃戝叧鎴栨湇鍔℃殏鏃朵笉鍙敤锛岃绋嶅悗閲嶈瘯';
    }
    return `请求失败（HTTP ${status}），请稍后再试或联系管理员`;
  }
  if (e instanceof Error) return e.message;
  return String(e);
}

/** 鏃?HTTP 鍝嶅簲涓斾负瓒呮椂/涓柇锛氬垪琛ㄧ被鎺ュ彛鍙檷绾т负绌猴紝閬垮厤 IPC 鍙嶅鎶涢敊 */
function isFcAxiosNoResponseTimeout(e: unknown): boolean {
  if (!axios.isAxiosError(e) || e.response) return false;
  const code = (e as { code?: string }).code;
  if (code === 'ECONNABORTED' || code === 'ETIMEDOUT' || code === 'ECONNRESET') return true;
  return Boolean(e.message?.includes('timeout'));
}

export async function nxCloudLogin(email: string, password: string): Promise<CloudUserState> {
  const base = getFcBaseUrl();
  if (!base) {
    if (allowOfflineCloudLoginWhenNoFcUrl()) {
      const emailNorm = email.trim().toLowerCase();
      setNxAuth({
        accessToken: NX_OFFLINE_LOCAL_ACCESS_TOKEN,
        refreshToken: '',
        userId: `offline:${emailNorm.slice(0, 120)}`,
        email: emailNorm,
        balance: 0,
      });
      return getStoredState();
    }
    throw new Error('鏈厤缃?ALIYUN_FC_INIT_USER_URL');
  }
  try {
    const { data } = await getNxFcAxios().post<Record<string, unknown>>(
      '/login',
      { email: email.trim(), password },
      { timeout: FC_AUTH_TIMEOUT_MS }
    );
    const accessToken = typeof data.accessToken === 'string' ? data.accessToken : (data as { access_token?: string }).access_token;
    const refreshToken = typeof data.refreshToken === 'string' ? data.refreshToken : (data as { refresh_token?: string }).refresh_token;
    const userId = typeof data.user_id === 'string' ? data.user_id : (data.userId as string);
    const balance = typeof data.balance === 'number' ? data.balance : Number(data.balance) || 0;
    if (!accessToken) throw new Error('鐧诲綍鍝嶅簲缂哄皯 accessToken');
    const isFirst = parseIsFirstRechargeFlag((data as { is_first_recharge?: unknown }).is_first_recharge);
    setNxAuth({
      accessToken,
      refreshToken: refreshToken || '',
      userId: userId || null,
      email: email.trim().toLowerCase(),
      balance,
      ...(isFirst !== undefined && { isFirstRecharge: isFirst }),
    });
    return getStoredState();
  } catch (e) {
    if (e instanceof Error && e.message === '鐧诲綍鍝嶅簲缂哄皯 accessToken') throw e;
    if (axios.isAxiosError(e) && e.response) {
      console.warn('[Aliyun] nxCloudLogin HTTP', e.response.status, e.response.data);
    } else if (axios.isAxiosError(e) && !e.response) {
      const ax = e as { code?: string; config?: { baseURL?: string; url?: string } };
      console.warn(
        '[Aliyun] nxCloudLogin 无 HTTP 响应（网络/DNS/地址）',
        'code=',
        ax.code || '(none)',
        'message=',
        e.message,
        'baseURL=',
        ax.config?.baseURL || '(empty)',
        'path=',
        ax.config?.url || '/login',
      );
    }
    throw new Error(nxFcErrorToUserMessage(e));
  }
}

/** 鍙戦€侀偖绠遍獙璇佺爜锛團C POST /auth/send-code锛夛紱purpose=change_password 鏃堕偖浠朵富棰樹负淇敼瀵嗙爜 */
export async function nxCloudSendAuthCode(
  email: string,
  purpose?: 'login' | 'change_password',
): Promise<void> {
  const base = getFcBaseUrl();
  if (!base) throw new Error('鏈厤缃?ALIYUN_FC_INIT_USER_URL');
  try {
    await getNxFcAxios().post(
      '/auth/send-code',
      {
        email: email.trim().toLowerCase(),
        ...(purpose === 'change_password' ? { purpose: 'change_password' } : {}),
      },
      { timeout: FC_AUTH_TIMEOUT_MS }
    );
  } catch (e) {
    if (axios.isAxiosError(e) && e.response) {
      console.warn('[Aliyun] nxCloudSendAuthCode HTTP', e.response.status, e.response.data);
    }
    throw new Error(nxFcErrorToUserMessage(e));
  }
}

/** 閭楠岃瘉鐮佷慨鏀瑰瘑鐮侊紙FC POST /auth/change-password锛?*/
export async function nxCloudChangePassword(email: string, code: string, newPassword: string): Promise<void> {
  const base = getFcBaseUrl();
  if (!base) throw new Error('鏈厤缃?ALIYUN_FC_INIT_USER_URL');
  const codeNorm = String(code ?? '')
    .trim()
    .replace(/\s/g, '');
  try {
    await getNxFcAxios().post(
      '/auth/change-password',
      {
        email: email.trim().toLowerCase(),
        code: codeNorm,
        new_password: newPassword,
      },
      { timeout: FC_AUTH_TIMEOUT_MS }
    );
  } catch (e) {
    if (axios.isAxiosError(e) && e.response) {
      console.warn('[Aliyun] nxCloudChangePassword HTTP', e.response.status, e.response.data);
    }
    throw new Error(nxFcErrorToUserMessage(e));
  }
}

/** 閭 + 楠岃瘉鐮佺櫥褰曪紙FC POST /auth/login锛涙柊鐢ㄦ埛鑷姩寤哄彿锛?*/
export async function nxCloudLoginWithCode(
  email: string,
  code: string,
): Promise<CloudUserState & { isNewUser?: boolean }> {
  const base = getFcBaseUrl();
  if (!base) {
    if (allowOfflineCloudLoginWhenNoFcUrl()) {
      const emailNorm = email.trim().toLowerCase();
      setNxAuth({
        accessToken: NX_OFFLINE_LOCAL_ACCESS_TOKEN,
        refreshToken: '',
        userId: `offline:${emailNorm.slice(0, 120)}`,
        email: emailNorm,
        balance: 0,
      });
      return getStoredState();
    }
    throw new Error('鏈厤缃?ALIYUN_FC_INIT_USER_URL');
  }
  try {
    const { data } = await getNxFcAxios().post<Record<string, unknown>>(
      '/auth/login',
      {
        email: email.trim().toLowerCase(),
        code: String(code).trim().replace(/\s/g, ''),
      },
      { timeout: FC_AUTH_TIMEOUT_MS }
    );
    const accessToken = typeof data.accessToken === 'string' ? data.accessToken : (data as { access_token?: string }).access_token;
    const refreshToken = typeof data.refreshToken === 'string' ? data.refreshToken : (data as { refresh_token?: string }).refresh_token;
    const userId = typeof data.user_id === 'string' ? data.user_id : (data.userId as string);
    const balance = typeof data.balance === 'number' ? data.balance : Number(data.balance) || 0;
    if (!accessToken) throw new Error('鐧诲綍鍝嶅簲缂哄皯 accessToken');
    const isFirst = parseIsFirstRechargeFlag((data as { is_first_recharge?: unknown }).is_first_recharge);
    const isNewUser =
      (data as { is_new_user?: unknown }).is_new_user === true ||
      (data as { isNewUser?: unknown }).isNewUser === true;
    setNxAuth({
      accessToken,
      refreshToken: refreshToken || '',
      userId: userId || null,
      email: email.trim().toLowerCase(),
      balance,
      ...(isFirst !== undefined && { isFirstRecharge: isFirst }),
    });
    return { ...getStoredState(), ...(isNewUser ? { isNewUser: true as const } : {}) };
  } catch (e) {
    if (e instanceof Error && e.message === '鐧诲綍鍝嶅簲缂哄皯 accessToken') throw e;
    if (axios.isAxiosError(e) && e.response) {
      console.warn('[Aliyun] nxCloudLoginWithCode HTTP', e.response.status, e.response.data);
    }
    throw new Error(nxFcErrorToUserMessage(e));
  }
}

export async function nxCloudRegister(email: string, password: string, code: string): Promise<CloudUserState> {
  const base = getFcBaseUrl();
  if (!base) {
    if (allowOfflineCloudLoginWhenNoFcUrl()) {
      const emailNorm = email.trim().toLowerCase();
      setNxAuth({
        accessToken: NX_OFFLINE_LOCAL_ACCESS_TOKEN,
        refreshToken: '',
        userId: `offline:${emailNorm.slice(0, 120)}`,
        email: emailNorm,
        balance: 0,
      });
      return getStoredState();
    }
    throw new Error('鏈厤缃?ALIYUN_FC_INIT_USER_URL');
  }
  try {
    const codeNorm = String(code ?? '')
      .trim()
      .replace(/\s/g, '');
    const { data } = await getNxFcAxios().post<Record<string, unknown>>(
      '/register',
      { email: email.trim(), password, code: codeNorm },
      { timeout: FC_AUTH_TIMEOUT_MS }
    );
    const accessToken = typeof data.accessToken === 'string' ? data.accessToken : (data as { access_token?: string }).access_token;
    const refreshToken = typeof data.refreshToken === 'string' ? data.refreshToken : (data as { refresh_token?: string }).refresh_token;
    const userId = typeof data.user_id === 'string' ? data.user_id : (data.userId as string);
    const balance = typeof data.balance === 'number' ? data.balance : Number(data.balance) || 0;
    if (!accessToken) throw new Error('娉ㄥ唽鍝嶅簲缂哄皯 accessToken');
    const isFirst = parseIsFirstRechargeFlag((data as { is_first_recharge?: unknown }).is_first_recharge);
    setNxAuth({
      accessToken,
      refreshToken: refreshToken || '',
      userId: userId || null,
      email: email.trim().toLowerCase(),
      balance,
      ...(isFirst !== undefined && { isFirstRecharge: isFirst }),
    });
    return getStoredState();
  } catch (e) {
    if (e instanceof Error && e.message === '娉ㄥ唽鍝嶅簲缂哄皯 accessToken') throw e;
    if (axios.isAxiosError(e) && e.response) {
      console.warn('[Aliyun] nxCloudRegister HTTP', e.response.status, e.response.data);
    }
    throw new Error(nxFcErrorToUserMessage(e));
  }
}

function setStoredState(state: Partial<CloudUserState>): void {
  const current = getStoredState();
  (store as { set: (k: string, v: unknown) => void }).set(STORE_KEY, { ...current, ...state });
}

function getMachineUsername(): string {
  try {
    return machineIdSync(true);
  } catch (e) {
    console.error('[Aliyun] 鑾峰彇 machineId 澶辫触:', e instanceof Error ? e.message : formatAliyunLogError(e));
    return `fallback-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }
}

function isRetryable(e: unknown): boolean {
  const code = (e as { code?: string })?.code;
  const message = String((e as { message?: string })?.message ?? '');
  return (
    code === 'ECONNRESET' ||
    code === 'ECONNREFUSED' ||
    code === 'ETIMEDOUT' ||
    code === 'ECONNABORTED' ||
    message.includes('ECONNRESET') ||
    message.includes('socket hang up') ||
    message.includes('network')
  );
}

function isAxiosUnauthorized(e: unknown): boolean {
  const status = (e as { response?: { status?: number } })?.response?.status;
  return status === 401;
}

function isAxiosForbidden(e: unknown): boolean {
  const status = (e as { response?: { status?: number } })?.response?.status;
  return status === 403;
}

function isAxiosServerError(e: unknown): boolean {
  if (!axios.isAxiosError(e) || !e.response) return false;
  const s = e.response.status;
  return s >= 500 && s <= 599;
}

/** 授权失败时只打一次说明，避免 IPC 抛错刷屏（Workspace 后台轮询会高频调用） */
let nxCloudGetTasksAuthDeniedLogged = false;
/** 5xx（如 Tablestore 表未建、FC 异常）同样只提示一次并返回空列表 */
let nxCloudGetTasksServerErrorLogged = false;
/** 超时/断连日志节流：避免反复刷屏拖慢控制台与主进程 */
let nxCloudGetTasksTimeoutLogAt = 0;
/** 并发合并：同一时刻多次 getTasks 共用一个请求，避免超时堆积导致假死 */
let nxCloudGetTasksInFlight: Promise<unknown> | null = null;

/** 鏈櫥褰曚笖宸查厤 FC 鏃惰烦杩囨媺鍙栵細鍙墦涓€娆¤鏄庯紝閬垮厤鐧诲綍椤靛弽澶嶅埛鏃ュ織 */
let nxIdleNoJwtLogged = false;

/** 鏃х増 init-user 澶辫触鍛婅鑺傛祦 */
let nxLegacyInitUserWarnAt = 0;

/** 浣跨敤鏈湴 JWT 璋?/me 鎷夊彇閭涓庡厓瀹濓紙鐧诲綍鍚?Token 宸插湪 store锛?*/
export async function nxCloudGetProfile(): Promise<CloudUserState> {
  return initCloudUser();
}

/** 鍒濆鍖栫敤鎴凤紙璋冪敤闃块噷浜?FC init-user锛?*/
export async function initCloudUser(): Promise<CloudUserState> {
  const prev = getStoredState();
  /** 鐢ㄦ埛宸查€€鍑猴細绂佹浠讳綍鏃?JWT 鐨勮嚜鍔ㄥ缓杩烇紙鍚棫鐗?init-user锛?*/
  if (prev.nxBlockAutoSession && !prev.nxAccessToken?.trim()) {
    setStoredState({ ...prev, status: 'idle' });
    return getStoredState();
  }
  const fcBase = getFcBaseUrl();
  /** 涓?JWT 鐧诲綍锛?login銆?me锛夊悓婧愶細宸查厤 FC 鍒欓粯璁や笉鍐嶅鏈櫥褰曠敤鎴锋墦鏈哄櫒 init-user */
  const useJwtCloudStack =
    NX_SAAS_MODE || Boolean(prev.nxAccessToken?.trim()) || (Boolean(fcBase) && !NX_LEGACY_MACHINE_INIT_USER);

  if (useJwtCloudStack && fcBase && !prev.nxAccessToken?.trim()) {
    setStoredState({ ...prev, status: 'idle' });
    if (!nxIdleNoJwtLogged) {
      nxIdleNoJwtLogged = true;
      console.info('[Aliyun] 鏈櫥褰曪紝璺宠繃浜戠浣欓璇锋眰锛堢櫥褰曞悗灏嗚嚜鍔ㄥ悓姝ワ級');
    }
    return getStoredState();
  }

  setStoredState({ status: 'connecting' });

  if (useJwtCloudStack) {
    if (prev.nxAccessToken === NX_OFFLINE_LOCAL_ACCESS_TOKEN && !getFcBaseUrl()) {
      setStoredState({ ...prev, status: 'success' });
      return getStoredState();
    }
    const base = getFcBaseUrl();
    if (!base || !prev.nxAccessToken?.trim()) {
      if (NX_SAAS_MODE) {
        console.warn('[Aliyun] 姝ｅ紡鐗堥渶閰嶇疆 ALIYUN_FC_INIT_USER_URL');
      }
      setStoredState({ ...prev, status: prev.nxAccessToken?.trim() ? 'success' : 'error' });
      return getStoredState();
    }
    const tryMe = async () => {
      const { data } = await getNxFcAxios().post<Record<string, unknown>>('/me', {}, { timeout: FC_TIMEOUT_MS });
      const balance = typeof data.balance === 'number' ? data.balance : Number(data.balance) || 0;
      const emailRaw = (data as { email?: unknown }).email;
      const email =
        typeof emailRaw === 'string' && emailRaw.trim()
          ? emailRaw.trim()
          : getStoredState().nxEmail ?? null;
      const uidRaw = (data as { user_id?: unknown }).user_id;
      const userId =
        typeof uidRaw === 'string' && uidRaw.trim() ? uidRaw.trim() : getStoredState().userId ?? null;
      const isFirst = parseIsFirstRechargeFlag((data as { is_first_recharge?: unknown }).is_first_recharge);
      setStoredState({
        ...getStoredState(),
        balance,
        status: 'success',
        ...(email != null && { nxEmail: email }),
        ...(userId != null && { userId }),
        ...(isFirst !== undefined && { isFirstRecharge: isFirst }),
      });
      const { notifyCloudUserStateRefresh } = await import('../cloudBalanceNotifier.js');
      notifyCloudUserStateRefresh();
      return getStoredState();
    };
    let lastErr: unknown;
    try {
      return await tryMe();
    } catch (e) {
      lastErr = e;
      const ok = await refreshNxAccessToken();
      if (ok) {
        const t = getNxAccessToken();
        if (t) {
          try {
            return await tryMe();
          } catch (e2) {
            lastErr = e2;
            if (NX_SAAS_MODE && isAxiosUnauthorized(e2)) {
              clearNxAuth();
            }
            setStoredState({ ...getStoredState(), status: 'error' });
            return getStoredState();
          }
        }
      }
      if (NX_SAAS_MODE && isAxiosUnauthorized(lastErr)) {
        clearNxAuth();
      }
      setStoredState({ ...prev, status: 'error' });
      return getStoredState();
    }
  }

  const username = getMachineUsername();
  let url = getAliyunFcInitUserUrl().trim();
  if (url && !url.endsWith('/init-user')) {
    url = url.replace(/\/$/, '') + '/init-user';
  }

  if (!url) {
    console.warn('[Aliyun] 未配置 ALIYUN_FC_INIT_USER_URL，请在 .env 中设置');
    setStoredState({ status: 'error' });
    return getStoredState();
  }

  try {
    let res: Record<string, unknown> | null = null;
    let lastError: unknown;

    for (let attempt = 1; attempt <= FC_RETRY_COUNT; attempt++) {
      try {
        const reqHeaders: Record<string, string> = {
          'Content-Type': 'application/json; charset=utf-8',
        };
        const fcTok = getAliyunFcToken();
        if (fcTok) reqHeaders['x-nexflow-token'] = fcTok;

        const { data } = await axios.post<Record<string, unknown>>(
          url!,
          { username },
          { timeout: FC_TIMEOUT_MS, headers: reqHeaders, proxy: false, httpsAgent }
        );
        res = (data ?? {}) as Record<string, unknown>;
        break;
      } catch (e) {
        lastError = e;
        if (attempt < FC_RETRY_COUNT && isRetryable(e)) {
          await new Promise((r) => setTimeout(r, FC_RETRY_DELAY_MS));
        } else {
          break;
        }
      }
    }

    if (!res) throw lastError;

    const payload = (res.data ?? res) as Record<string, unknown>;
    const userId = typeof payload.userId === 'string' ? payload.userId : (res.userId as string) ?? null;
    const balance = typeof payload.balance === 'number' ? payload.balance : Number(payload.balance) || 0;
    const isPro = Boolean(payload.isPro ?? res.isPro);

    const next: CloudUserState = { userId, machineId: username, balance, isPro, status: 'success' };
    setStoredState(next);
    return next;
  } catch {
    const now = Date.now();
    if (now - nxLegacyInitUserWarnAt > 60_000) {
      nxLegacyInitUserWarnAt = now;
      console.warn('[Aliyun] 浜戠浣欓杩炴帴鏆備笉鍙敤');
    }
    setStoredState({ ...prev, status: 'error' });
    return getStoredState();
  }
}

/** FC /transactions 杩斿洖鐨勫崟鏉℃祦姘?*/
export interface NxTransactionItem {
  tx_id: string;
  user_id?: string;
  task_id?: string;
  amount?: string | number;
  type?: string;
  provider?: string;
  description?: string;
  created_at?: string;
  balance_after?: string | number;
}

export interface NxTaskItem {
  task_id: string;
  user_id?: string;
  status?: string;
  amount?: string | number;
  cost?: string | number;
  prompt_json?: string;
  workflow_json?: string;
  result_oss_url?: string;
  error_msg?: string;
  created_at?: string | number;
  updated_at?: string | number;
}

/** FC 鍚勭増鏈彲鑳界敤 result_url / output_url 绛夊埆鍚嶏紝缁熶竴鎴愬鎴风浣跨敤鐨?result_oss_url */
function pickNxTaskResultUrlFromStatusPayload(data: Record<string, unknown>): string {
  const take = (v: unknown): string => {
    if (typeof v !== 'string') return '';
    const s = v.trim();
    return s && /^https?:\/\//i.test(s) ? s : '';
  };
  return (
    take(data.result_oss_url) ||
    take(data.result_url) ||
    take(data.resultUrl) ||
    take(data.output_url) ||
    take(data.outputUrl) ||
    ''
  );
}

function pickStr(v: unknown): string | undefined {
  if (v == null) return undefined;
  const s = String(v).trim();
  return s === '' ? undefined : s;
}

/** 缁熶竴 FC / 鍏跺畠缃戝叧鍙兘杩斿洖鐨勫瓧娈靛悕锛屼究浜庤缃〉灞曠ず鏃堕棿銆佷綑棰濄€佹ā鍨嬭鏄?*/
function normalizeNxTransactionItem(raw: unknown): NxTransactionItem | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const tx_id = pickStr(o.tx_id ?? o.transaction_id ?? o.transactionId);
  if (!tx_id) return null;
  const created = o.created_at ?? o.createdAt ?? o.create_time ?? o.createdTime;
  const balanceAfter = o.balance_after ?? o.balanceAfter ?? o.balanceAfterTxn;
  return {
    tx_id,
    user_id: pickStr(o.user_id ?? o.userId),
    task_id: pickStr(o.task_id ?? o.taskId),
    amount: (o.amount ?? o.change_amount) as string | number | undefined,
    type: pickStr(o.type ?? o.tx_type),
    provider: pickStr(o.provider),
    description: pickStr(o.description ?? o.desc ?? o.memo ?? o.remark),
    created_at: created != null && created !== '' ? String(created) : undefined,
    balance_after:
      balanceAfter != null && balanceAfter !== ''
        ? (typeof balanceAfter === 'number' ? balanceAfter : String(balanceAfter))
        : undefined,
  };
}

/** 鎷夊彇鏈€杩戞祦姘达紙闇€ JWT锛孭OST /transactions锛?*/
export async function nxCloudGetTransactions(limit = 20): Promise<NxTransactionItem[]> {
  const base = getFcBaseUrl();
  if (!base || !getNxAccessToken() || isNxOfflineCloudSession()) return [];
  try {
    const { data } = await getNxFcAxios().post<{ items?: unknown[] }>(
      '/transactions',
      { limit: Math.min(50, Math.max(1, limit)) },
      { timeout: FC_LIST_QUERY_TIMEOUT_MS }
    );
    const items = Array.isArray(data?.items) ? data.items : [];
    return items.map((row) => normalizeNxTransactionItem(row)).filter((x): x is NxTransactionItem => x != null);
  } catch (e) {
    console.warn('[Aliyun] nxCloudGetTransactions failed:', formatAliyunLogError(e));
    throw new Error(nxFcErrorToUserMessage(e));
  }
}

/** 拉取最近任务（需 JWT，POST /tasks） */
export async function nxCloudGetTasks(limit = 20): Promise<NxTaskItem[]> {
  if (NX_SKIP_CLOUD_TASK_SYNC || isCloudTaskSyncForceDisabled()) return [];
  const base = getFcBaseUrl();
  if (!base || !getNxAccessToken() || isNxOfflineCloudSession()) return [];
  if (nxCloudGetTasksInFlight) return nxCloudGetTasksInFlight as Promise<NxTaskItem[]>;

  nxCloudGetTasksInFlight = (async (): Promise<NxTaskItem[]> => {
    try {
      const { data } = await getNxFcAxios().post<{ items?: NxTaskItem[] }>(
        '/tasks',
        { limit: Math.min(50, Math.max(1, limit)) },
        { timeout: FC_LIST_QUERY_TIMEOUT_MS },
      );
      return Array.isArray(data?.items) ? data.items : [];
    } catch (e) {
      if (isFcAxiosNoResponseTimeout(e)) {
        const now = Date.now();
        if (now - nxCloudGetTasksTimeoutLogAt > 60_000) {
          nxCloudGetTasksTimeoutLogAt = now;
          console.warn(
            '[Aliyun] nxCloudGetTasks: 超时或网络暂不可用，返回空列表（可优化 POST /tasks 或调 NX_FC_LIST_QUERY_TIMEOUT_MS）',
            formatAliyunLogError(e),
          );
        }
        return [];
      }
      if (isAxiosUnauthorized(e) || isAxiosForbidden(e)) {
        if (!nxCloudGetTasksAuthDeniedLogged) {
          nxCloudGetTasksAuthDeniedLogged = true;
          console.warn(
            '[Aliyun] nxCloudGetTasks: 云端授权失败（401/403），已返回空任务列表且不再抛错。本地功能（如 B 站视频抓取）不依赖此接口。若需同步云端任务请核对 ALIYUN_FC_TOKEN 与登录态；若暂时不需要云端轮询可在 .env 设 NX_SKIP_CLOUD_TASK_SYNC=1。',
            formatAliyunLogError(e),
          );
        }
        return [];
      }
      if (isAxiosServerError(e)) {
        if (!nxCloudGetTasksServerErrorLogged) {
          nxCloudGetTasksServerErrorLogged = true;
          console.warn(
            '[Aliyun] nxCloudGetTasks: 云端返回 5xx（常见：Tablestore 表未创建 OTSParameterInvalidRequest、或 FC 未就绪），已返回空列表且不再抛错。与本地 B 站抓取无关。请检查阿里云控制台与 FC 环境变量，或在 .env 设 NX_SKIP_CLOUD_TASK_SYNC=1 跳过轮询。',
            formatAliyunLogError(e),
          );
        }
        return [];
      }
      console.warn('[Aliyun] nxCloudGetTasks failed:', formatAliyunLogError(e));
      throw new Error(nxFcErrorToUserMessage(e));
    } finally {
      nxCloudGetTasksInFlight = null;
    }
  })();

  return nxCloudGetTasksInFlight as Promise<NxTaskItem[]>;
}

/** 涓嬪崟鎵ｈ垂骞跺缓 pending 浠诲姟锛圥OST /tasks/create锛岄渶 JWT锛?*/
export async function nxCloudTasksCreate(body: {
  model_id: string;
  type?: string;
  params?: Record<string, unknown>;
  nodeData?: Record<string, unknown>;
}): Promise<{ task_id: string; balance: number; cost_coins?: number }> {
  const base = getFcBaseUrl();
  if (!base) throw new Error('鏈厤缃?ALIYUN_FC_INIT_USER_URL');
  if (isNxOfflineCloudSession()) throw new Error('当前为离线/本地会话，请使用邮箱登录后再试');
  if (!getNxAccessToken()) throw new Error('璇峰厛鐧诲綍浜戠璐﹀彿');
  const mid = String(body.model_id || '').trim();
  if (!mid) throw new Error('model_id 蹇呭～');
  beginFcGenerationActivity();
  try {
    const res = await withFcRouteFailover(() =>
      getNxFcAxios().post<Record<string, unknown>>(
        '/tasks/create',
        {
          model_id: mid,
          type: body.type || 'image',
          params: body.params && typeof body.params === 'object' ? body.params : {},
          nodeData: body.nodeData && typeof body.nodeData === 'object' ? body.nodeData : {},
        },
        { timeout: FC_TIMEOUT_MS },
      ),
    );
    const data = res.data;
    const task_id = String(data.task_id ?? data.taskId ?? '').trim();
    const balance = typeof data.balance === 'number' ? data.balance : Number(data.balance) || 0;
    const cost_coins =
      typeof data.cost_coins === 'number' ? data.cost_coins : Number(data.cost_coins) || undefined;
    if (!task_id) throw new Error('TASK_CREATE_NO_ID');
    setNxAuth({ balance });
    const { notifyCloudUserStateRefresh } = await import('../cloudBalanceNotifier.js');
    notifyCloudUserStateRefresh();
    return { task_id, balance, ...(cost_coins !== undefined && Number.isFinite(cost_coins) ? { cost_coins } : {}) };
  } catch (e) {
    throw new Error(nxFcErrorToUserMessage(e));
  } finally {
    endFcGenerationActivity();
  }
}

export type NxCloudTaskStatusResult = NxTaskItem & { balance?: number };

/** 鍗曟潯浠诲姟鐘舵€侊紙POST /tasks/status锛岄渶 JWT锛?*/
export async function nxCloudTaskStatus(taskId: string): Promise<NxCloudTaskStatusResult> {
  if (isCloudTaskSyncForceDisabled()) throw new Error('云端同步已关闭');
  const base = getFcBaseUrl();
  if (!base) throw new Error('鏈厤缃?ALIYUN_FC_INIT_USER_URL');
  if (isNxOfflineCloudSession()) throw new Error('褰撳墠涓虹绾?鏈湴浼氳瘽');
  if (!getNxAccessToken()) throw new Error('璇峰厛鐧诲綍浜戠璐﹀彿');
  const tid = String(taskId || '').trim();
  if (!tid) throw new Error('task_id 蹇呭～');
  try {
    const { data } = await getNxFcAxios().post<Record<string, unknown>>(
      '/tasks/status',
      { task_id: tid },
      { timeout: FC_TIMEOUT_MS }
    );
    const balanceRaw = data.balance;
    const balance = typeof balanceRaw === 'number' ? balanceRaw : Number(balanceRaw);
    if (Number.isFinite(balance)) {
      setNxAuth({ balance });
      const { notifyCloudUserStateRefresh } = await import('../cloudBalanceNotifier.js');
      notifyCloudUserStateRefresh();
    }
    const amount = data.amount;
    const cost = data.cost;
    const createdAt = data.created_at;
    const updatedAt = data.updated_at;
    const payload = data as Record<string, unknown>;
    const mergedResultUrl = pickNxTaskResultUrlFromStatusPayload(payload);
    return {
      task_id: String(data.task_id ?? data.taskId ?? tid).trim() || tid,
      user_id: typeof data.user_id === 'string' ? data.user_id : String(data.user_id ?? ''),
      status: typeof data.status === 'string' ? data.status : String(data.status ?? ''),
      amount: typeof amount === 'number' || typeof amount === 'string' ? amount : undefined,
      cost: typeof cost === 'number' || typeof cost === 'string' ? cost : undefined,
      prompt_json: typeof data.prompt_json === 'string' ? data.prompt_json : String(data.prompt_json ?? ''),
      workflow_json: typeof data.workflow_json === 'string' ? data.workflow_json : String(data.workflow_json ?? ''),
      result_oss_url: mergedResultUrl,
      error_msg: typeof data.error_msg === 'string' ? data.error_msg : String(data.error_msg ?? ''),
      created_at: typeof createdAt === 'number' || typeof createdAt === 'string' ? createdAt : undefined,
      updated_at: typeof updatedAt === 'number' || typeof updatedAt === 'string' ? updatedAt : undefined,
      ...(Number.isFinite(balance) ? { balance } : {}),
    };
  } catch (e) {
    throw new Error(nxFcErrorToUserMessage(e));
  }
}

/** 姝ｅ紡鐗堬細璋冪敤 FC POST /recharge锛堥渶宸茬櫥褰曪紱鐢熶骇鐜搴斿湪鏀粯鍥炶皟楠岀鍚庡啀璋冿級 */
export async function nxCloudRecharge(amountCny: number): Promise<CloudUserState> {
  const base = getFcBaseUrl();
  if (!base) throw new Error('鏈厤缃?ALIYUN_FC_INIT_USER_URL');
  if (isNxOfflineCloudSession()) throw new Error('当前为离线/本地会话，请退出后使用邮箱密码登录再充值');
  if (!getNxAccessToken()) throw new Error('璇峰厛鐧诲綍浜戠璐﹀彿');
  const tier = Number(amountCny);
  if (!Number.isFinite(tier)) throw new Error('充值金额无效');
  try {
    const { data } = await getNxFcAxios().post<Record<string, unknown>>(
      '/recharge',
      { amount_cny: tier },
      { timeout: FC_TIMEOUT_MS }
    );
    const balance = typeof data.balance === 'number' ? data.balance : Number(data.balance) || 0;
    const isFirst = parseIsFirstRechargeFlag(data.is_first_recharge);
    setNxAuth({
      balance,
      ...(isFirst !== undefined && { isFirstRecharge: isFirst }),
    });
    return getStoredState();
  } catch (e) {
    throw new Error(nxFcErrorToUserMessage(e));
  }
}

/** 鍏戞崲鐮佸叆璐︼細FC POST /redeem-coupon锛堥渶宸茬櫥褰曪紱鍒稿湪 Tablestore nx_coupons锛?*/
export async function nxCloudRedeemCoupon(code: string): Promise<CloudUserState> {
  const base = getFcBaseUrl();
  if (!base) throw new Error('鏈厤缃?ALIYUN_FC_INIT_USER_URL');
  if (isNxOfflineCloudSession()) throw new Error('当前为离线/本地会话，请退出后使用邮箱密码登录再兑换');
  if (!getNxAccessToken()) throw new Error('璇峰厛鐧诲綍浜戠璐﹀彿');
  const trimmed = String(code ?? '').trim();
  if (!trimmed) throw new Error('璇疯緭鍏ュ厬鎹㈢爜');
  try {
    const { data } = await getNxFcAxios().post<Record<string, unknown>>(
      '/redeem-coupon',
      { code: trimmed },
      { timeout: FC_TIMEOUT_MS }
    );
    const balance = typeof data.balance === 'number' ? data.balance : Number(data.balance) || 0;
    const isFirst = parseIsFirstRechargeFlag(data.is_first_recharge);
    setNxAuth({
      balance,
      ...(isFirst !== undefined && { isFirstRecharge: isFirst }),
    });
    return getStoredState();
  } catch (e) {
    throw new Error(nxFcErrorToUserMessage(e));
  }
}

/** Tablestore nx_model_config 琛岋紙涓?FC listModelConfig 涓€鑷达級 */
export interface NxModelConfigItem {
  model_id: string;
  function_name?: string;
  is_active?: boolean;
  base_price?: number;
  multiplier?: number;
  yuanbao_rate?: number;
}

function requireNxAdminSecretHeader(): Record<string, string> {
  const secret = process.env.NX_ADMIN_ISSUE_COUPON_SECRET?.trim();
  if (!secret) throw new Error('未配置 NX_ADMIN_ISSUE_COUPON_SECRET，无法调用运营接口');
  return { 'x-admin-issue-coupon-secret': secret };
}

/** 绠＄悊鍛樼鍙戝厬鎹㈢爜锛欶C POST /internal/issue-coupon锛堥渶鏈満 .env 涓?FC 鍧囬厤缃?NX_ADMIN_ISSUE_COUPON_SECRET锛?*/
export async function nxAdminIssueCoupon(amountCny: number): Promise<{ code: string; amount_cny: number }> {
  const base = getFcBaseUrl();
  if (!base) throw new Error('鏈厤缃?ALIYUN_FC_INIT_USER_URL');
  const tier = Number(amountCny);
  if (!Number.isFinite(tier)) throw new Error('妗ｄ綅鏃犳晥');
  try {
    const { data } = await getNxFcAxios().post<Record<string, unknown>>(
      '/internal/issue-coupon',
      { amount_cny: tier },
      {
        timeout: FC_TIMEOUT_MS,
        headers: requireNxAdminSecretHeader(),
      }
    );
    const code = typeof data.code === 'string' ? data.code : String(data.code ?? '');
    const ac = data.amount_cny ?? data.amountCny;
    const amount_cny = typeof ac === 'number' ? ac : Number(ac);
    if (!code.trim() || !Number.isFinite(amount_cny)) {
      throw new Error('绛惧彂鍝嶅簲寮傚父');
    }
    return { code: code.trim(), amount_cny };
  } catch (e) {
    throw new Error(nxFcErrorToUserMessage(e));
  }
}

/** 杩愯惀鐪嬫澘锛氫粖鏃ュ厓瀹濇敹鍏ャ€佸厬鎹㈢爜鎬绘暟銆佸け璐ヤ换鍔℃暟锛團C POST /internal/admin-dashboard-stats锛?*/
export async function nxAdminDashboardStats(): Promise<{
  timezone: string;
  date: string;
  today_revenue_yuanbao: number;
  total_coupon_codes: number;
  pending_failed_or_timeout_tasks: number;
  tx_rows_scanned: number;
  task_rows_scanned: number;
  coupon_full_scan: boolean;
}> {
  if (!getFcBaseUrl()) throw new Error('鏈厤缃?ALIYUN_FC_INIT_USER_URL');
  try {
    const { data } = await getNxFcAxios().post<Record<string, unknown>>(
      '/internal/admin-dashboard-stats',
      {},
      { timeout: FC_TIMEOUT_MS, headers: requireNxAdminSecretHeader() }
    );
    return {
      timezone: typeof data.timezone === 'string' ? data.timezone : 'Asia/Shanghai',
      date: typeof data.date === 'string' ? data.date : '',
      today_revenue_yuanbao:
        typeof data.today_revenue_yuanbao === 'number' ? data.today_revenue_yuanbao : Number(data.today_revenue_yuanbao) || 0,
      total_coupon_codes:
        typeof data.total_coupon_codes === 'number' ? data.total_coupon_codes : Number(data.total_coupon_codes) || 0,
      pending_failed_or_timeout_tasks:
        typeof data.pending_failed_or_timeout_tasks === 'number'
          ? data.pending_failed_or_timeout_tasks
          : Number(data.pending_failed_or_timeout_tasks) || 0,
      tx_rows_scanned: typeof data.tx_rows_scanned === 'number' ? data.tx_rows_scanned : Number(data.tx_rows_scanned) || 0,
      task_rows_scanned:
        typeof data.task_rows_scanned === 'number' ? data.task_rows_scanned : Number(data.task_rows_scanned) || 0,
      coupon_full_scan: data.coupon_full_scan === true,
    };
  } catch (e) {
    throw new Error(nxFcErrorToUserMessage(e));
  }
}

export async function nxAdminFailedTasks(): Promise<{
  tasks: Array<{
    task_id: string;
    user_id: string;
    status: string;
    cost: number;
    error_msg?: string;
    created_at?: unknown;
    updated_at?: unknown;
  }>;
  scanned: number;
}> {
  if (!getFcBaseUrl()) throw new Error('鏈厤缃?ALIYUN_FC_INIT_USER_URL');
  try {
    const { data } = await getNxFcAxios().post<Record<string, unknown>>(
      '/internal/admin-failed-tasks',
      {},
      { timeout: FC_TIMEOUT_MS, headers: requireNxAdminSecretHeader() }
    );
    const raw = data?.tasks;
    const tasks: Array<{
      task_id: string;
      user_id: string;
      status: string;
      cost: number;
      error_msg?: string;
      created_at?: unknown;
      updated_at?: unknown;
    }> = [];
    if (Array.isArray(raw)) {
      for (const row of raw) {
        if (!row || typeof row !== 'object') continue;
        const o = row as Record<string, unknown>;
        const tid = typeof o.task_id === 'string' ? o.task_id : String(o.task_id ?? '');
        const uid = typeof o.user_id === 'string' ? o.user_id : String(o.user_id ?? '');
        if (!tid || !uid) continue;
        const c = typeof o.cost === 'number' ? o.cost : Number(o.cost);
        tasks.push({
          task_id: tid,
          user_id: uid,
          status: typeof o.status === 'string' ? o.status : String(o.status ?? ''),
          cost: Number.isFinite(c) ? c : 0,
          error_msg: typeof o.error_msg === 'string' ? o.error_msg : undefined,
          created_at: o.created_at,
          updated_at: o.updated_at,
        });
      }
    }
    const scanned = typeof data.scanned === 'number' ? data.scanned : Number(data.scanned) || 0;
    return { tasks, scanned };
  } catch (e) {
    throw new Error(nxFcErrorToUserMessage(e));
  }
}

export async function nxAdminRefundTask(userId: string, taskId: string): Promise<{
  balance: number;
  refunded?: boolean;
  idempotent?: boolean;
  reason?: string;
}> {
  if (!getFcBaseUrl()) throw new Error('鏈厤缃?ALIYUN_FC_INIT_USER_URL');
  const uid = String(userId || '').trim();
  const tid = String(taskId || '').trim();
  if (!uid || !tid) throw new Error('缂哄皯 user_id 鎴?task_id');
  try {
    const { data } = await getNxFcAxios().post<Record<string, unknown>>(
      '/internal/admin-refund-task',
      { user_id: uid, task_id: tid },
      { timeout: FC_TIMEOUT_MS, headers: requireNxAdminSecretHeader() }
    );
    const bal = typeof data.balance === 'number' ? data.balance : Number(data.balance) || 0;
    return {
      balance: bal,
      refunded: data.refunded === true,
      idempotent: data.idempotent === true,
      reason: typeof data.reason === 'string' ? data.reason : undefined,
    };
  } catch (e) {
    throw new Error(nxFcErrorToUserMessage(e));
  }
}

export async function nxAdminModelConfigList(): Promise<{ items: NxModelConfigItem[] }> {
  if (!getFcBaseUrl()) throw new Error('鏈厤缃?ALIYUN_FC_INIT_USER_URL');
  try {
    const { data } = await getNxFcAxios().post<{ items?: unknown }>(
      '/internal/admin-model-config-list',
      {},
      { timeout: FC_TIMEOUT_MS, headers: requireNxAdminSecretHeader() }
    );
    const raw = data?.items;
    if (!Array.isArray(raw)) return { items: [] };
    const items: NxModelConfigItem[] = [];
    for (const row of raw) {
      if (!row || typeof row !== 'object') continue;
      const o = row as Record<string, unknown>;
      const mid = typeof o.model_id === 'string' ? o.model_id : String(o.model_id ?? '');
      if (!mid.trim()) continue;
      const bp = typeof o.base_price === 'number' ? o.base_price : Number(o.base_price);
      const mul = typeof o.multiplier === 'number' ? o.multiplier : Number(o.multiplier);
      const yr = typeof o.yuanbao_rate === 'number' ? o.yuanbao_rate : Number(o.yuanbao_rate);
      items.push({
        model_id: mid.trim(),
        function_name: typeof o.function_name === 'string' ? o.function_name : String(o.function_name ?? ''),
        is_active: o.is_active === false ? false : o.is_active === true ? true : undefined,
        base_price: Number.isFinite(bp) ? bp : 0,
        multiplier: Number.isFinite(mul) ? mul : 1,
        yuanbao_rate: Number.isFinite(yr) ? yr : 10,
      });
    }
    return { items };
  } catch (e) {
    throw new Error(nxFcErrorToUserMessage(e));
  }
}

export async function nxAdminModelConfigUpsert(row: NxModelConfigItem): Promise<{ model_id: string }> {
  if (!getFcBaseUrl()) throw new Error('鏈厤缃?ALIYUN_FC_INIT_USER_URL');
  const mid = String(row.model_id || '').trim();
  if (!mid) throw new Error('缂哄皯 model_id');
  try {
    const { data } = await getNxFcAxios().post<Record<string, unknown>>(
      '/internal/admin-model-config-upsert',
      {
        model_id: mid,
        function_name: row.function_name ?? mid,
        is_active: row.is_active !== false,
        base_price: row.base_price ?? 0,
        multiplier: row.multiplier ?? 1,
        yuanbao_rate: row.yuanbao_rate ?? 10,
      },
      { timeout: FC_TIMEOUT_MS, headers: requireNxAdminSecretHeader() }
    );
    const out = typeof data.model_id === 'string' ? data.model_id : String(data.model_id ?? mid);
    return { model_id: out };
  } catch (e) {
    throw new Error(nxFcErrorToUserMessage(e));
  }
}

export type NxAdminUserRow = {
  user_id: string;
  email: string;
  registration_date: number;
  last_login: number | null;
  status: string;
};

/** 杩愯惀锛氱敤鎴峰垪琛紙鑴辨晱锛孎C POST /internal/admin-users-list锛?*/
export async function nxAdminGetAllUsers(maxScanRows?: number): Promise<{
  users: NxAdminUserRow[];
  total_count: number;
  scan_truncated?: boolean;
}> {
  if (!getFcBaseUrl()) throw new Error('鏈厤缃?ALIYUN_FC_INIT_USER_URL');
  const max = typeof maxScanRows === 'number' && Number.isFinite(maxScanRows) ? maxScanRows : 100000;
  try {
    const { data } = await getNxFcAxios().post<Record<string, unknown>>(
      '/internal/admin-users-list',
      { max_scan_rows: max },
      { timeout: Math.max(FC_TIMEOUT_MS, 120_000), headers: requireNxAdminSecretHeader() }
    );
    const raw = data?.users;
    const users: NxAdminUserRow[] = [];
    if (Array.isArray(raw)) {
      for (const row of raw) {
        if (!row || typeof row !== 'object') continue;
        const o = row as Record<string, unknown>;
        const uid = typeof o.user_id === 'string' ? o.user_id : String(o.user_id ?? '');
        if (!uid.trim()) continue;
        const reg = o.registration_date ?? o.registrationDate;
        const regN = typeof reg === 'number' ? reg : Number(reg);
        const ll = o.last_login ?? o.lastLogin;
        let lastLogin: number | null = null;
        if (ll != null && ll !== '') {
          const ln = typeof ll === 'number' ? ll : Number(ll);
          lastLogin = Number.isFinite(ln) && ln > 0 ? ln : null;
        }
        users.push({
          user_id: uid.trim(),
          email: typeof o.email === 'string' ? o.email : String(o.email ?? ''),
          registration_date: Number.isFinite(regN) && regN > 0 ? regN : 0,
          last_login: lastLogin,
          status: typeof o.status === 'string' ? o.status : String(o.status ?? 'normal'),
        });
      }
    }
    const tc = data?.total_count ?? data?.totalCount;
    const total_count = typeof tc === 'number' ? tc : Number(tc) || users.length;
    return {
      users,
      total_count,
      scan_truncated: data?.scan_truncated === true || data?.scanTruncated === true,
    };
  } catch (e) {
    throw new Error(nxFcErrorToUserMessage(e));
  }
}

export type NxAdminProfitPeriodRow = {
  period: string;
  profit_yuanbao: number;
  revenue_yuanbao: number;
  cost_yuanbao: number;
};

export type NxAdminModelProfitRow = {
  model_id: string;
  profit_yuanbao: number;
  revenue_yuanbao: number;
  cost_yuanbao: number;
  task_count: number;
};

/** 杩愯惀锛氬埄娑﹀垎鏋愶紙FC POST /internal/admin-profit-analytics锛屽唴瀛樿仛鍚堥潪 SQL GROUP BY锛?*/
export async function nxAdminProfitAnalytics(opts?: {
  maxTxScanRows?: number;
  maxCouponScanRows?: number;
}): Promise<{
  timezone: string;
  daily_profits: NxAdminProfitPeriodRow[];
  monthly_profits: NxAdminProfitPeriodRow[];
  yearly_profits: NxAdminProfitPeriodRow[];
  total_revenue: number;
  total_cost: number;
  total_profit: number;
  current_month_profit_yuanbao: number;
  current_month_revenue_yuanbao: number;
  current_month_key: string;
  model_profit_leaderboard: NxAdminModelProfitRow[];
  coupon_used_count: number;
  coupon_face_value_cny_sum: number;
  coupon_estimated_yuanbao: number;
  yuanbao_per_cny_assumed: number;
  tx_rows_scanned: number;
  coupon_rows_scanned: number;
  tx_scan_truncated: boolean;
}> {
  if (!getFcBaseUrl()) throw new Error('鏈厤缃?ALIYUN_FC_INIT_USER_URL');
  const maxTx = opts?.maxTxScanRows;
  const maxCp = opts?.maxCouponScanRows;
  try {
    const { data } = await getNxFcAxios().post<Record<string, unknown>>(
      '/internal/admin-profit-analytics',
      {
        max_tx_scan_rows: typeof maxTx === 'number' && Number.isFinite(maxTx) ? maxTx : 60000,
        max_coupon_scan_rows: typeof maxCp === 'number' && Number.isFinite(maxCp) ? maxCp : 50000,
      },
      { timeout: Math.max(FC_TIMEOUT_MS, 180_000), headers: requireNxAdminSecretHeader() }
    );

    const parsePeriodArr = (raw: unknown): NxAdminProfitPeriodRow[] => {
      if (!Array.isArray(raw)) return [];
      const out: NxAdminProfitPeriodRow[] = [];
      for (const row of raw) {
        if (!row || typeof row !== 'object') continue;
        const o = row as Record<string, unknown>;
        const period = typeof o.period === 'string' ? o.period : String(o.period ?? '');
        if (!period) continue;
        const py = o.profit_yuanbao ?? o.profitYuanbao;
        const ry = o.revenue_yuanbao ?? o.revenueYuanbao;
        const cy = o.cost_yuanbao ?? o.costYuanbao;
        out.push({
          period,
          profit_yuanbao: typeof py === 'number' ? py : Number(py) || 0,
          revenue_yuanbao: typeof ry === 'number' ? ry : Number(ry) || 0,
          cost_yuanbao: typeof cy === 'number' ? cy : Number(cy) || 0,
        });
      }
      return out;
    };

    const parseLeaderboard = (raw: unknown): NxAdminModelProfitRow[] => {
      if (!Array.isArray(raw)) return [];
      const out: NxAdminModelProfitRow[] = [];
      for (const row of raw) {
        if (!row || typeof row !== 'object') continue;
        const o = row as Record<string, unknown>;
        const mid = typeof o.model_id === 'string' ? o.model_id : String(o.model_id ?? '');
        if (!mid) continue;
        const p = o.profit_yuanbao ?? o.profitYuanbao;
        const r = o.revenue_yuanbao ?? o.revenueYuanbao;
        const c = o.cost_yuanbao ?? o.costYuanbao;
        const tc = o.task_count ?? o.taskCount;
        out.push({
          model_id: mid,
          profit_yuanbao: typeof p === 'number' ? p : Number(p) || 0,
          revenue_yuanbao: typeof r === 'number' ? r : Number(r) || 0,
          cost_yuanbao: typeof c === 'number' ? c : Number(c) || 0,
          task_count: typeof tc === 'number' ? tc : Number(tc) || 0,
        });
      }
      return out;
    };

    const num = (v: unknown, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : Number(v) || d);

    return {
      timezone: typeof data.timezone === 'string' ? data.timezone : 'Asia/Shanghai',
      daily_profits: parsePeriodArr(data.daily_profits ?? data.dailyProfits),
      monthly_profits: parsePeriodArr(data.monthly_profits ?? data.monthlyProfits),
      yearly_profits: parsePeriodArr(data.yearly_profits ?? data.yearlyProfits),
      total_revenue: num(data.total_revenue ?? data.totalRevenue),
      total_cost: num(data.total_cost ?? data.totalCost),
      total_profit: num(data.total_profit ?? data.totalProfit),
      current_month_profit_yuanbao: num(
        data.current_month_profit_yuanbao ?? data.currentMonthProfitYuanbao
      ),
      current_month_revenue_yuanbao: num(
        data.current_month_revenue_yuanbao ?? data.currentMonthRevenueYuanbao
      ),
      current_month_key: String(data.current_month_key ?? data.currentMonthKey ?? ''),
      model_profit_leaderboard: parseLeaderboard(data.model_profit_leaderboard ?? data.modelProfitLeaderboard),
      coupon_used_count: num(data.coupon_used_count ?? data.couponUsedCount),
      coupon_face_value_cny_sum: num(data.coupon_face_value_cny_sum ?? data.couponFaceValueCnySum),
      coupon_estimated_yuanbao: num(data.coupon_estimated_yuanbao ?? data.couponEstimatedYuanbao),
      yuanbao_per_cny_assumed: num(data.yuanbao_per_cny_assumed ?? data.yuanbaoPerCnyAssumed, 10),
      tx_rows_scanned: num(data.tx_rows_scanned ?? data.txRowsScanned),
      coupon_rows_scanned: num(data.coupon_rows_scanned ?? data.couponRowsScanned),
      tx_scan_truncated: data.tx_scan_truncated === true || data.txScanTruncated === true,
    };
  } catch (e) {
    throw new Error(nxFcErrorToUserMessage(e));
  }
}

/** 鎷夊彇浜戠妯″瀷瀹氫环琛紙POST /model-config锛岄渶 JWT锛?*/
export async function nxCloudFetchModelConfig(): Promise<{ items: NxModelConfigItem[] }> {
  const base = getFcBaseUrl();
  if (!base) {
    if (isNxOfflineCloudSession()) return { items: [] };
    throw new Error('鏈厤缃?ALIYUN_FC_INIT_USER_URL');
  }
  // 宸查厤缃?FC 浣嗗綋鍓嶄负绂荤嚎鏈湴浼氳瘽锛堟棤鏈夋晥 JWT锛夛細涓嶆姏閿欙紝涓庢湭閰?FC 鏃朵竴鑷磋繑鍥炵┖琛紝
  // 閬垮厤瀹夎鍖呭唴缃?FC 鍦板潃鏃舵瘡娆″惎鍔ㄩ兘寮瑰嚭銆屾媺鍙栦簯绔畾浠峰け璐ャ€嶏紱瀹氫环鐢辨覆鏌撶鏈湴鍥為€€/缂撳瓨鎵挎媴銆?  if (isNxOfflineCloudSession()) return { items: [] };
  if (!getNxAccessToken()) throw new Error('璇峰厛鐧诲綍浜戠璐﹀彿');
  const { data } = await getNxFcAxios().post<{ items?: unknown }>('/model-config', {}, { timeout: FC_LIST_QUERY_TIMEOUT_MS });
  const raw = data?.items;
  if (!Array.isArray(raw)) return { items: [] };
  const items: NxModelConfigItem[] = [];
  for (const row of raw) {
    if (!row || typeof row !== 'object') continue;
    const o = row as Record<string, unknown>;
    const mid = typeof o.model_id === 'string' ? o.model_id : String(o.model_id ?? '');
    if (!mid.trim()) continue;
    const bp = typeof o.base_price === 'number' ? o.base_price : Number(o.base_price);
    const mul = typeof o.multiplier === 'number' ? o.multiplier : Number(o.multiplier);
    const yr = typeof o.yuanbao_rate === 'number' ? o.yuanbao_rate : Number(o.yuanbao_rate);
    items.push({
      model_id: mid.trim(),
      function_name: typeof o.function_name === 'string' ? o.function_name : String(o.function_name ?? ''),
      is_active: o.is_active === false ? false : o.is_active === true ? true : undefined,
      base_price: Number.isFinite(bp) ? bp : 0,
      multiplier: Number.isFinite(mul) ? mul : 1,
      yuanbao_rate: Number.isFinite(yr) ? yr : 10,
    });
  }
  return { items };
}

export function getCloudUserState(): CloudUserState {
  return getStoredState();
}

/** 鑾峰彇浜戠鐢ㄦ埛 ID锛堢敤浜?x-user-id锛夛紝浼樺厛浠?electron-store 璇诲彇锛屾棤鍒欒繑鍥炲綋鍓?machineId */
export function getCloudUserId(): string {
  const state = getStoredState();
  if (state.machineId) return state.machineId;
  return getMachineUsername();
}

/** 鏇存柊浜戠浣欓锛坮un-task 鎴愬姛鍚庣敱涓昏繘绋嬭皟鐢紝骞堕€氱煡娓叉煋杩涚▼锛?*/
export function updateCloudBalance(balance: number): void {
  const current = getStoredState();
  const next: CloudUserState = { ...current, balance, status: 'success' };
  setStoredState(next);
}

