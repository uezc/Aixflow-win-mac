/** 云端 LLM / run-task 给用户看的短文案（避免弹出 RATE_LIMIT_EXCEEDED 这种码）。 */

export const CLOUD_RATE_LIMIT_USER_MSG =
  '请求过于频繁（云端限流）。请等待约 1 分钟后再试。批量优化提示词、生成故事或分批写剧本连点都会触发。';

export const CLOUD_FC_TIMEOUT_USER_MSG =
  '剧本分析超时（云端函数执行超时）。请缩短本集正文后重试；或到阿里云控制台把函数超时调到 300 秒以上。';

export function isCloudRateLimitError(e: unknown): boolean {
  const msg = String((e as Error)?.message || e || '');
  return /RATE_LIMIT|status code 429|\b429\b|Too many requests|请求过于频繁/i.test(msg);
}

export function isCloudFcTimeoutError(e: unknown): boolean {
  const msg = String((e as Error)?.message || e || '');
  return /Function timed out|timed out after \d+ seconds|InvocationError/i.test(msg);
}

export function isCloudLlmAbortError(e: unknown): boolean {
  if (!e) return false;
  if (e instanceof Error && e.name === 'AbortError') return true;
  const msg = String((e as Error)?.message || e || '');
  return /^\s*cancell?ed\s*$/i.test(msg) || /请求已取消|已取消/.test(msg);
}

export function formatCloudLlmUserError(raw: unknown): string {
  const s = String((raw as Error)?.message || raw || '').trim();
  if (!s) return '请求失败，请稍后重试';
  if (isCloudLlmAbortError(raw) || isCloudLlmAbortError(s)) {
    return '请求已取消（可能点了取消，或同时发起了另一次对话）。可再点一次「提示词优化」。';
  }
  if (isCloudRateLimitError(s)) return CLOUD_RATE_LIMIT_USER_MSG;
  // 长剧本分析触发的 502 几乎都是 FC 120s 超时；不要只说「网关不可用」
  if (
    /Function timed out|timed out after \d+ seconds/i.test(s) ||
    /status code 502|Bad Gateway|HTTP 502/i.test(s)
  ) {
    return CLOUD_FC_TIMEOUT_USER_MSG;
  }
  if (/status code 503|status code 504|HTTP 503|HTTP 504/i.test(s)) {
    return '云端服务暂时繁忙，请稍后再试。';
  }
  return s.replace(/^Chat API 错误:\s*/i, '').trim() || s;
}
