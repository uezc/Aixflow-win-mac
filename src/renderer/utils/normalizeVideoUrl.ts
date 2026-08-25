/**
 * 视频 URL 标准化工具函数
 *
 * 用于清理和标准化视频 URL，防止脏 URL 导致播放失败
 * 将 file:// 格式转换为 local-resource:// 格式
 * 确保 Windows 路径格式正确（C:/Users 而不是 c/Users）
 * 中文/空格路径分段 encode，避免 <img>/<video> 一直转圈
 */

function encodeFsPathSegments(filePath: string): string {
  let body = String(filePath || '').replace(/\\/g, '/');
  try {
    body = decodeURIComponent(body);
  } catch {
    /* keep */
  }
  if (body.match(/^\/[a-zA-Z]:/)) body = body.substring(1);
  if (body.match(/^[a-zA-Z]\//)) {
    body = `${body[0].toUpperCase()}:${body.substring(1)}`;
  }
  return body
    .split('/')
    .map((part, index) => {
      if (index === 0 && /^[a-zA-Z]:$/.test(part)) return part;
      if (!part) return part;
      if (/[\u4e00-\u9fa5\s%]/.test(part) || /[^\x00-\x7F]/.test(part)) {
        try {
          return encodeURIComponent(decodeURIComponent(part));
        } catch {
          return encodeURIComponent(part);
        }
      }
      return part;
    })
    .join('/');
}

export function normalizeVideoUrl(url: string): string {
  if (!url) return url;

  let cleanUrl = url.trim();

  // 裸盘符路径 → local-resource
  if (
    !cleanUrl.startsWith('http://') &&
    !cleanUrl.startsWith('https://') &&
    !cleanUrl.startsWith('data:') &&
    !cleanUrl.startsWith('blob:') &&
    !cleanUrl.startsWith('file:') &&
    !cleanUrl.startsWith('local-resource://') &&
    (/^[a-zA-Z]:[\\/]/.test(cleanUrl) || cleanUrl.startsWith('\\\\'))
  ) {
    cleanUrl = `local-resource://${cleanUrl.replace(/\\/g, '/')}`;
  }

  // 将 file:// 格式转换为 local-resource:// 格式
  if (cleanUrl.startsWith('file://')) {
    let filePath = cleanUrl.replace(/^file:\/\/\/?/, '');
    if (filePath.match(/^[a-zA-Z]:/)) {
      // ok
    } else if (filePath.match(/^[a-zA-Z]\//)) {
      filePath = filePath[0].toUpperCase() + ':' + filePath.substring(1);
    }
    if (!filePath.startsWith('/') && filePath.match(/^[a-zA-Z]:/)) {
      filePath = '/' + filePath;
    }
    cleanUrl = `local-resource://${filePath.replace(/\\/g, '/')}`;
  }

  // 处理 local-resource://：正斜杠 + 盘符修正 + 中文分段编码
  if (cleanUrl.startsWith('local-resource://')) {
    let filePath = cleanUrl.replace(/^local-resource:\/\/+/, '');
    filePath = encodeFsPathSegments(filePath);
    cleanUrl = `local-resource://${filePath}`;
  }

  if (!cleanUrl.includes('response-content-type')) {
    return cleanUrl;
  }

  return cleanUrl;
}

/**
 * Electron 渲染进程：<video>/<audio> 对 local-resource:// 偶发异常时，改为 file:///。
 * 必须对中文路径分段 encode，否则会一直转圈看不到画面。
 */
export function toElectronVideoElementSrc(url: string): string {
  const clean = normalizeVideoUrl((url || '').trim());
  if (!clean) return '';
  if (
    clean.startsWith('local-resource://') &&
    typeof window !== 'undefined' &&
    (window as Window & { electronAPI?: unknown }).electronAPI
  ) {
    const pathPart = clean.replace(/^local-resource:\/\/+/, '');
    if (!pathPart) return clean;
    return `file:///${pathPart.replace(/\\/g, '/')}`;
  }
  return clean;
}
