/** Doubao 音频生成 1.0 — 与 renderer utils 对齐的常量（主进程用） */
export const DOUBAO_SEED_AUDIO_MODEL_ID = 'doubao-seed-audio-1.0' as const;

export function clampDoubaoSpeechRate(v: unknown): number {
  const n = Math.round(Number(v));
  if (!Number.isFinite(n)) return 0;
  return Math.max(-50, Math.min(100, n));
}

export function clampDoubaoLoudnessRate(v: unknown): number {
  const n = Math.round(Number(v));
  if (!Number.isFinite(n)) return 0;
  return Math.max(-50, Math.min(100, n));
}

export function clampDoubaoPitchRate(v: unknown): number {
  const n = Math.round(Number(v));
  if (!Number.isFinite(n)) return 0;
  return Math.max(-12, Math.min(12, n));
}

export function normalizeDoubaoFormat(v: unknown): string {
  const s = String(v ?? '').trim();
  return ['wav', 'mp3', 'pcm', 'ogg_opus'].includes(s) ? s : 'mp3';
}

export function normalizeDoubaoSampleRate(v: unknown): string {
  const s = String(v ?? '').trim();
  return ['8000', '16000', '24000', '32000', '44100'].includes(s) ? s : '24000';
}
