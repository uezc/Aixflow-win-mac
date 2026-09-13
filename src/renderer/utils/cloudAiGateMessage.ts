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

/** 元宝不足弹窗文案（生成任务统一） */
export const CLOUD_BALANCE_INSUFFICIENT_ALERT = '元宝不足，请充值';
export const CLOUD_BALANCE_INSUFFICIENT_ALERT_EN = 'Insufficient credits. Please recharge.';

export const NX_CLOUD_BALANCE_INSUFFICIENT_EVENT = 'nx-cloud-balance-insufficient';

export function cloudBalanceInsufficientAlert(locale?: string): string {
  return locale === 'en'
    ? CLOUD_BALANCE_INSUFFICIENT_ALERT_EN
    : CLOUD_BALANCE_INSUFFICIENT_ALERT;
}

/** 识别云端/本地各类「元宝/余额不足」错误 */
export function isCloudBalanceInsufficientError(
  error: unknown,
  balanceInsufficient?: boolean,
): boolean {
  if (balanceInsufficient === true) return true;
  const msg = (() => {
    if (error == null) return '';
    if (typeof error === 'string') return error;
    if (error instanceof Error) return error.message || String(error);
    if (typeof error === 'object') {
      const o = error as { error?: unknown; message?: unknown };
      const parts = [o.error, o.message, error].map((x) => String(x ?? '').trim()).filter(Boolean);
      return parts.join(' ');
    }
    return String(error);
  })().trim();
  if (!msg) return false;
  if (/BALANCE_INSUFFICIENT/i.test(msg)) return true;
  if (msg.includes('元宝不足') || msg.includes('余额不足')) return true;
  if (/quota is not enough|remain quota/i.test(msg)) return true;
  if (/insufficient (?:balance|credits|quota)/i.test(msg)) return true;
  if (/low balance|please (?:top up|recharge)/i.test(msg) && /balance|credit|元宝|余额/i.test(msg)) {
    return true;
  }
  return false;
}

let lastBalancePromptAt = 0;

/**
 * 任意生成任务元宝不足时触发统一弹窗（去重，避免同一次失败多处重复弹）。
 * 由 CloudBalanceInsufficientAlertBridge 监听并 showAlert。
 */
export function promptCloudBalanceInsufficientIfNeeded(
  error: unknown,
  opts?: { balanceInsufficient?: boolean },
): boolean {
  if (!isCloudBalanceInsufficientError(error, opts?.balanceInsufficient)) return false;
  const now = Date.now();
  if (now - lastBalancePromptAt < 1600) return true;
  lastBalancePromptAt = now;
  if (typeof window === 'undefined') return true;
  window.dispatchEvent(new CustomEvent(NX_CLOUD_BALANCE_INSUFFICIENT_EVENT));
  return true;
}
