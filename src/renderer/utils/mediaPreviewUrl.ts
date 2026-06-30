/** 预览 URL 是否应按视频播放器打开（勿用路径含 "video" 字样误判图片） */
export function isLikelyVideoMediaUrl(url: string): boolean {
  const u = (url || '').trim();
  if (!u) return false;
  if (/^data:video\//i.test(u)) return true;
  const pathPart = u
    .replace(/^local-resource:\/\//i, '')
    .replace(/^file:\/\/?/i, '')
    .split(/[?#]/)[0];
  return /\.(mp4|webm|ogg|mov|m4v|avi|mkv|wmv)$/i.test(pathPart);
}
