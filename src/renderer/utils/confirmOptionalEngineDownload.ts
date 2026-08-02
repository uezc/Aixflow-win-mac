import type { DarkConfirmOptions } from '../contexts/DarkAlertContext';
import { optionalEngineDownloadT } from '../i18n/optionalEngineDownloadI18n';

export type OptionalEngineKind = 'rvc' | 'whisper';

type EngineStatusLike = {
  ready: boolean;
  downloadUrlConfigured: boolean;
  sizeBytes?: number;
};

function formatSizeHint(bytes?: number, locale?: string): string {
  if (!bytes || bytes <= 0) return '';
  const en = locale === 'en';
  if (bytes >= 1e9) {
    const n = (bytes / 1e9).toFixed(1);
    return en ? `~${n} GB` : `约 ${n} GB`;
  }
  if (bytes >= 1e6) {
    const n = Math.round(bytes / 1e6);
    return en ? `~${n} MB` : `约 ${n} MB`;
  }
  const n = Math.round(bytes / 1e3);
  return en ? `~${n} KB` : `约 ${n} KB`;
}

/**
 * 若引擎未就绪且可下载，弹出确认框；用户取消则返回 false。
 * 已就绪或不可下载时直接返回 true（由主进程给出具体错误）。
 */
export async function confirmOptionalEngineDownload(
  kind: OptionalEngineKind,
  showConfirm: (message: string, options?: DarkConfirmOptions) => Promise<boolean>,
  locale: string,
): Promise<boolean> {
  const api = window.electronAPI;
  if (!api) return true;

  let status: EngineStatusLike | undefined;
  try {
    status =
      kind === 'rvc' ? await api.getRvcEngineStatus?.() : await api.getWhisperEngineStatus?.();
  } catch {
    return true;
  }

  if (!status || status.ready || !status.downloadUrlConfigured) {
    return true;
  }

  const t = optionalEngineDownloadT(locale);
  const sizeHint = formatSizeHint(status.sizeBytes, locale);
  const message = kind === 'rvc' ? t.rvcMessage(sizeHint) : t.whisperMessage(sizeHint);

  return showConfirm(message, {
    okLabel: t.confirmDownload,
    cancelLabel: t.cancel,
  });
}
