/** 短剧人物/参考音试听：HTMLAudio 最大只能 1，用 Web Audio 再放大。 */
export const AUDIO_PREVIEW_GAIN = 3;

type WiredAudio = HTMLAudioElement & { __nexflowPreviewGain?: boolean };

export function attachAudioPreviewGain(
  audio: HTMLAudioElement | null | undefined,
  gainValue = AUDIO_PREVIEW_GAIN,
): AudioContext | null {
  if (!audio) return null;
  const el = audio as WiredAudio;
  if (el.__nexflowPreviewGain) return null;
  const Ctx =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctx) {
    el.volume = 1;
    return null;
  }
  try {
    const ctx = new Ctx();
    const src = ctx.createMediaElementSource(el);
    const gain = ctx.createGain();
    gain.gain.value = Math.max(0.1, Number(gainValue) || AUDIO_PREVIEW_GAIN);
    src.connect(gain);
    gain.connect(ctx.destination);
    el.__nexflowPreviewGain = true;
    el.volume = 1;
    return ctx;
  } catch {
    el.volume = 1;
    return null;
  }
}

export async function resumeAudioPreviewContext(
  ctx: AudioContext | null | undefined,
): Promise<void> {
  if (!ctx || ctx.state !== 'suspended') return;
  try {
    await ctx.resume();
  } catch {
    /* 手势外 resume 可能被拒，交给 play() 再试 */
  }
}
