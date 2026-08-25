/** 紫色 equalizer 缩略条高度（与音频节点波形同色系） */

function hashSeed(seed: string): number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i += 1) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function buildAudioEqBarHeightsPct(seed: string, barCount = 5): number[] {
  let h = hashSeed(seed || 'audio');
  const out: number[] = [];
  for (let i = 0; i < barCount; i += 1) {
    h = (Math.imul(h, 1103515245) + 12345 + i) >>> 0;
    out.push(34 + (h % 58));
  }
  return out;
}

/** 供 DOM 胶囊 / 静态 HTML 使用 */
export function audioEqThumbInnerHtml(seed = 'audio', barCount = 5): string {
  const heights = buildAudioEqBarHeightsPct(seed, barCount);
  return heights
    .map((pct) => `<span class="mention-ref-thumb-audio-bar" style="height:${pct}%"></span>`)
    .join('');
}
