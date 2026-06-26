/** 探测当前环境是否还能创建 WebGL 上下文（浏览器通常上限约 8～16 个） */
export function canCreateWebGLContext(): boolean {
  if (typeof document === 'undefined') return false;
  try {
    const canvas = document.createElement('canvas');
    const gl =
      canvas.getContext('webgl2', {
        failIfMajorPerformanceCaveat: false,
        antialias: false,
        alpha: false,
      }) ||
      canvas.getContext('webgl', {
        failIfMajorPerformanceCaveat: false,
        antialias: false,
        alpha: false,
      });
    if (!gl) return false;
    const ext = gl.getExtension('WEBGL_lose_context');
    ext?.loseContext();
    return true;
  } catch {
    return false;
  }
}
