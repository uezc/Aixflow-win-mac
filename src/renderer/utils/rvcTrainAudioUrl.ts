/** RVC 训练提交 RunningHub 时需使用 OSS 公网 https 链接 */

export function isPublicHttpAudioUrl(url: string | undefined): boolean {
  return /^https?:\/\//i.test(String(url ?? '').trim());
}

export function normalizeLocalAudioPathUrl(u: string): string {
  if (!u.startsWith('local-resource://') && !u.startsWith('file://')) return u;
  return u
    .replace(/%5C/gi, '/')
    .replace(/^local-resource:\/\/+/, 'local-resource://')
    .replace(/^file:\/\/+/, 'file://');
}

/** 优先取 OSS/https 远程地址，再回退本地路径 */
export function pickBestAudioUrlForRhTrainFromNodeData(data: Record<string, unknown> | undefined): string {
  if (!data) return '';
  const candidates: unknown[] = [
    data.originalAudioUrl,
    ...(Array.isArray(data.outputAudios) ? data.outputAudios : []),
    data.outputAudio,
    data.referenceAudioUrl,
  ];
  for (const c of candidates) {
    const s = typeof c === 'string' ? c.trim() : '';
    if (s && isPublicHttpAudioUrl(s)) return s;
  }
  for (const c of candidates) {
    const s = typeof c === 'string' ? c.trim() : '';
    if (s) return s;
  }
  return '';
}

/** 本地路径上传到 OSS；已是 https 则原样返回 */
export async function ensureOssAudioUrlForRhTrain(url: string): Promise<string> {
  const trimmed = (url || '').trim();
  if (!trimmed) return '';
  if (isPublicHttpAudioUrl(trimmed)) return trimmed;
  const local = normalizeLocalAudioPathUrl(trimmed);
  if (local.startsWith('local-resource://') || local.startsWith('file://')) {
    if (!window.electronAPI?.uploadLocalAudioToOSS) {
      throw new Error('无法上传训练音频到云端（缺少 uploadLocalAudioToOSS）');
    }
    const res = await window.electronAPI.uploadLocalAudioToOSS(local);
    if (!res?.success || !res.url) {
      throw new Error(res?.error || '训练音频上传 OSS 失败');
    }
    return res.url;
  }
  return trimmed;
}
