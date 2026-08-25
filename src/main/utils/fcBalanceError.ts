/**
 * FC 转发失败时统一识别「余额不足」，供 Image/Video/Audio 等 Provider 的 onStatus 使用。
 */
import axios from 'axios';

const DEFAULT_BALANCE_MSG = '元宝不足请充值';
const REFUND_MSG = '生成失败，元宝已退回账户';

/** 兼容 axios 与 fcForwardTask 映射后仍带 response 的 Error */
function getAxiosLikeResponse(e: unknown): { status?: number; data?: unknown } | undefined {
  if (axios.isAxiosError(e)) return e.response;
  if (e && typeof e === 'object' && 'response' in e) {
    const r = (e as { response?: { status?: number; data?: unknown } }).response;
    if (r && typeof r === 'object') return r as { status?: number; data?: unknown };
  }
  return undefined;
}

/**
 * FC 侧第三方失败且已退款成功（PROVIDER_ERROR_REFUNDED）
 */
export function isFcProviderErrorRefunded(e: unknown): boolean {
  const resp = getAxiosLikeResponse(e);
  const data = resp?.data as { errorCode?: string } | undefined;
  return data?.errorCode === 'PROVIDER_ERROR_REFUNDED';
}

export function isFcBalanceInsufficientError(e: unknown): boolean {
  const resp = getAxiosLikeResponse(e);
  const st = resp?.status;
  const data = resp?.data as { error?: string; message?: string } | undefined;
  const errBody = String(data?.error ?? data?.message ?? '').toUpperCase();
  const msg = String(e instanceof Error ? e.message : '').toUpperCase();
  return (
    st === 402 ||
    errBody.includes('BALANCE_INSUFFICIENT') ||
    errBody.includes('BALANCE') ||
    msg.includes('BALANCE_INSUFFICIENT')
  );
}

export function buildFcErrorPayload(
  error: unknown,
  fallbackMessage: string,
): { error: string; balanceInsufficient?: boolean; refundSucceeded?: boolean } {
  if (isFcProviderErrorRefunded(error)) {
    return { error: REFUND_MSG, refundSucceeded: true };
  }
  if (isFcBalanceInsufficientError(error)) {
    return { error: DEFAULT_BALANCE_MSG, balanceInsufficient: true };
  }
  const resp = getAxiosLikeResponse(error);
  const data = resp?.data as { error?: string; message?: string } | undefined;
  const msg =
    (axios.isAxiosError(error) && (error.response?.data as { error?: string })?.error) ||
    (axios.isAxiosError(error) && (error.response?.data as { message?: string })?.message) ||
    (data && typeof data === 'object' && data.error != null ? String(data.error) : '') ||
    (data && typeof data === 'object' && data.message != null ? String(data.message) : '') ||
    (error instanceof Error ? error.message : String(error)) ||
    fallbackMessage;
  const out = String(msg);
  if (resp?.status === 429 || /RATE_LIMIT/i.test(out)) {
    return { error: '请求过于频繁，请等待约 1 分钟后再试' };
  }
  // 云端可能直接返回长中文，与 HTTP 码/BALANCE 枚举不一致，仍按「元宝不足」统一短文案
  if (out.includes('元宝不足')) {
    return { error: DEFAULT_BALANCE_MSG, balanceInsufficient: true };
  }
  return { error: out };
}
