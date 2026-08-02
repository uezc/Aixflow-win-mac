/** Doubao 音频生成 1.0（RunningHub bytedance/doubao-seed-audio-1.0） */
export const DOUBAO_SEED_AUDIO_MODEL_ID = 'doubao-seed-audio-1.0' as const;

export const DOUBAO_SEED_AUDIO_LABEL = 'Doubao-音频生成-1.0';

export function isDoubaoSeedAudioModel(model: string | undefined | null): boolean {
  return String(model ?? '').trim() === DOUBAO_SEED_AUDIO_MODEL_ID;
}

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

export const DOUBAO_AUDIO_FORMATS = ['wav', 'mp3', 'pcm', 'ogg_opus'] as const;
export type DoubaoAudioFormat = (typeof DOUBAO_AUDIO_FORMATS)[number];

export const DOUBAO_AUDIO_SAMPLE_RATES = ['8000', '16000', '24000', '32000', '44100'] as const;

export function normalizeDoubaoFormat(v: unknown): DoubaoAudioFormat {
  const s = String(v ?? '').trim();
  return (DOUBAO_AUDIO_FORMATS as readonly string[]).includes(s) ? (s as DoubaoAudioFormat) : 'mp3';
}

export function normalizeDoubaoSampleRate(v: unknown): string {
  const s = String(v ?? '').trim();
  return (DOUBAO_AUDIO_SAMPLE_RATES as readonly string[]).includes(s) ? s : '24000';
}
