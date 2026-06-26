import type { AppLocale } from '../i18n/settingsI18n';

export const GENERATION_FAILURE_REFUND_HINT_ZH = '已退回元宝';
export const GENERATION_FAILURE_REFUND_HINT_EN = 'Credits have been refunded';

export function refundHintForLocale(locale: AppLocale): string {
  return locale === 'en' ? GENERATION_FAILURE_REFUND_HINT_EN : GENERATION_FAILURE_REFUND_HINT_ZH;
}

export function messageContainsRefundHint(s: string): boolean {
  return s.includes(GENERATION_FAILURE_REFUND_HINT_ZH) || s.includes(GENERATION_FAILURE_REFUND_HINT_EN);
}

/** 本机 yt-dlp「导入在线视频」失败（IPC 名历史保留），不经 FC/OSS，不应提示云端扣费退款 */
export function isLocalOnlineVideoImportError(raw: string | undefined | null): boolean {
  const s = String(raw ?? '');
  return s.includes('local-resource:create-video-from-bilibili-page');
}

/** 弹窗/详情用：错误原文 + 退款说明（避免重复追加） */
export function failedGenerationDetailWithRefund(
  raw: string | undefined | null,
  locale: AppLocale = 'zh',
): string {
  const base = String(raw ?? '').trim();
  const hint = refundHintForLocale(locale);
  if (!base) return hint;
  if (messageContainsRefundHint(base)) return base;
  return `${base}\n\n${hint}`;
}

/**
 * 将中英混排错误信息规范为优先仅中文展示（如 `英文| 中文` 取竖线后；或 `[错误码: x]` 后接英文再接中文时取中文段）。
 */
export function toChineseUserMessage(raw: string | undefined | null): string {
  const s = String(raw ?? '').trim();
  if (!s) return '';

  const pipeIdx = s.lastIndexOf('|');
  if (pipeIdx >= 0) {
    const right = s.slice(pipeIdx + 1).trim();
    if (/[\u4e00-\u9fff]/.test(right)) return right;
  }

  const codeMatch = s.match(/^(\[[^\]]+\])\s*/);
  const prefix = codeMatch ? codeMatch[1] : '';
  const afterCode = codeMatch ? s.slice(codeMatch[0].length).trim() : s;

  const firstCjk = afterCode.search(/[\u4e00-\u9fff]/);
  if (firstCjk >= 0) {
    const zhPart = afterCode.slice(firstCjk).trim();
    if (zhPart) return prefix ? `${prefix} ${zhPart}` : zhPart;
  }

  return s;
}

/**
 * 界面展示用：中文模式走 toChineseUserMessage；英文模式优先取竖线左侧英文，否则回退为可读片段。
 */
export function userFacingErrorMessage(raw: string | undefined | null, locale: AppLocale): string {
  const rawStr = String(raw ?? '').trim();
  if (rawStr.includes('元宝不足')) {
    return locale === 'en' ? 'Insufficient credits. Please recharge.' : '元宝不足请充值';
  }
  if (locale === 'zh') return toChineseUserMessage(raw);
  const s = String(raw ?? '').trim();
  if (!s) return '';
  const pipeIdx = s.lastIndexOf('|');
  if (pipeIdx >= 0) {
    const left = s.slice(0, pipeIdx).trim();
    const noCode = left.replace(/^\[[^\]]+\]\s*/, '').trim();
    if (noCode.length > 0 && /[a-zA-Z]/.test(noCode)) return noCode;
    const right = s.slice(pipeIdx + 1).trim();
    return right || noCode || s;
  }
  if (/[a-zA-Z]{4,}/.test(s) && !/[\u4e00-\u9fff]/.test(s)) return s;
  const zh = toChineseUserMessage(s);
  return zh || s;
}
