/** RVC 训练产出为模型包（zip/pth 等），不是可播放音频 */
export function isRvcModelPackageUrl(url: string | undefined | null): boolean {
  const u = String(url ?? '').trim().toLowerCase();
  if (!u) return false;
  if (/\.(zip|pth|pt|index|ckpt|safetensors|onnx)(\?|$)/i.test(u)) return true;
  return /\/rvc\//i.test(u) || /rvc.*\.(zip|pth)/i.test(u);
}

export function pickRhModelPackageUrlFromResults(results: unknown): string | undefined {
  if (!Array.isArray(results)) return undefined;
  for (const item of results) {
    const url = String((item as { url?: string })?.url ?? '').trim();
    if (url && isRvcModelPackageUrl(url)) return url;
  }
  return undefined;
}
