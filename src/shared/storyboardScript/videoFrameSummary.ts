export interface StoryboardVideoFrameRef {
  /** Display label e.g. @图片1 */
  imageLabel: string;
  /** Optional video label e.g. @视频1 */
  videoLabel?: string;
  /** Start time in seconds */
  startSec?: number;
  /** End time in seconds */
  endSec?: number;
}

function formatClock(sec: number): string {
  const s = Math.max(0, Number(sec) || 0);
  const m = Math.floor(s / 60);
  const rem = s - m * 60;
  const whole = Math.floor(rem);
  const frac = Math.round((rem - whole) * 10);
  const mm = String(m).padStart(2, '0');
  const ss = String(whole).padStart(2, '0');
  return `${mm}:${ss}.${frac}`;
}

/** Build “视频切片参考” text for VIDEO / MULTIMODAL user prompts. */
export function buildStoryboardVideoFrameReferenceSummary(
  frameRefs: StoryboardVideoFrameRef[] = [],
): string {
  const lines = frameRefs
    .map((ref) => {
      const img = String(ref.imageLabel || '').trim();
      if (!img) return '';
      const vid = String(ref.videoLabel || '').trim();
      const start = ref.startSec;
      const end = ref.endSec;
      if (vid && Number.isFinite(start) && Number.isFinite(end)) {
        return `${img} / ${vid} ${formatClock(start!)}-${formatClock(end!)}`;
      }
      if (vid) return `${img} / ${vid}`;
      return img;
    })
    .filter(Boolean);

  return lines.length > 0 ? lines.join('\n') : '';
}

export function buildImageLabels(count: number): string[] {
  return Array.from({ length: Math.max(0, count) }, (_, i) => `@图片${i + 1}`);
}

export function buildVideoLabels(count: number): string[] {
  return Array.from({ length: Math.max(0, count) }, (_, i) => `@视频${i + 1}`);
}
