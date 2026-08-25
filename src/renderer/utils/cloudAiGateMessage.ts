/** 与主进程 cloudAiGate.CLOUD_AI_GATE_USER_MESSAGE 保持一致 */
export const CLOUD_AI_GATE_USER_MESSAGE =
  '当前处于离线模式或未登录，请登录云端账号以使用 AI 算力';

export const NX_SAAS_LOGIN_REQUIRED_EVENT = 'nx-saas-login-required';

/** 登录提示事件可选载荷（自定义文案） */
export type NxSaasLoginRequiredDetail = {
  message?: string;
  confirmLabel?: string;
};

export function isCloudAiAuthRequiredError(error: unknown, nxAuthRequired?: boolean): boolean {
  if (nxAuthRequired === true) return true;
  const msg = String(error ?? '').trim();
  if (!msg) return false;
  if (msg === CLOUD_AI_GATE_USER_MESSAGE) return true;
  if (msg.includes('离线模式或未登录')) return true;
  if (msg.includes('未登录')) return true;
  if (msg.includes('请先登录')) return true;
  if (/sign in|log in|not signed in|login required|offline mode|UNAUTHORIZED/i.test(msg)) return true;
  return false;
}

/** 未登录/离线：弹出「返回登录界面」并跳转 /settings（仅用于实时 AI 调用失败，勿在节点挂载/读历史 errorMessage 时调用） */
export function promptNxSaasLoginIfNeeded(
  error: unknown,
  nxAuthRequired?: boolean,
  detail?: NxSaasLoginRequiredDetail,
): boolean {
  if (!isCloudAiAuthRequiredError(error, nxAuthRequired)) return false;
  dispatchNxSaasLoginRequired(detail);
  return true;
}

export function dispatchNxSaasLoginRequired(detail?: NxSaasLoginRequiredDetail): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(
    new CustomEvent(NX_SAAS_LOGIN_REQUIRED_EVENT, {
      detail: detail && (detail.message || detail.confirmLabel) ? detail : undefined,
    }),
  );
}

export type CloudAuthBalanceGateResult =
  | { action: 'ignored' }
  /** 应弹登录确认（余额够 / 查不到 / 未登录） */
  | {
      action: 'need-login';
      balance: number | null;
      balanceEnough: boolean;
      loggedIn: boolean;
    }
  /** 已登录且余额不足：走充值 UX，不强制跳登录 */
  | { action: 'insufficient'; balance: number };

/**
 * 识别「请先登录/未登录」类错误后查余额：
 * - 查不到余额或未登录 → need-login
 * - 余额 ≥ requiredYuanbao → need-login（提示余额充足）
 * - 已登录但余额不足 → insufficient
 */
export async function resolveCloudAuthErrorWithBalance(
  error: unknown,
  options?: { nxAuthRequired?: boolean; requiredYuanbao?: number },
): Promise<CloudAuthBalanceGateResult> {
  if (!isCloudAiAuthRequiredError(error, options?.nxAuthRequired)) {
    return { action: 'ignored' };
  }

  const required = Math.max(1, Math.round(Number(options?.requiredYuanbao) || 5));
  let balance: number | null = null;
  let loggedIn = false;

  try {
    const api = typeof window !== 'undefined' ? window.electronAPI : undefined;
    if (api?.getNxSaasState) {
      const s = await api.getNxSaasState();
      loggedIn = !!s?.loggedIn;
      if (typeof s?.balance === 'number' && Number.isFinite(s.balance)) {
        balance = s.balance;
      }
      if (loggedIn && api.nxCloudGetProfile) {
        try {
          const p = await api.nxCloudGetProfile();
          if (typeof p?.balance === 'number' && Number.isFinite(p.balance)) {
            balance = p.balance;
          }
        } catch {
          /* 保留 store 余额 */
        }
      }
    }
  } catch {
    balance = null;
  }

  const canCheck = balance != null && Number.isFinite(balance);
  const enough = canCheck && (balance as number) >= required;

  // 未登录 / 查不到：优先弹登录（错误已是未登录类）
  if (!loggedIn || !canCheck) {
    return {
      action: 'need-login',
      balance,
      balanceEnough: enough,
      loggedIn,
    };
  }

  if (enough) {
    return {
      action: 'need-login',
      balance: balance as number,
      balanceEnough: true,
      loggedIn: true,
    };
  }

  return { action: 'insufficient', balance: balance as number };
}

/** 余额不足时的通用充值提示（与画布其它节点一致） */
export const CLOUD_BALANCE_INSUFFICIENT_ALERT =
  '余额不足\n\n您的账户余额不足以完成此次操作，请前往设置页面充值后再试。';
