/** SUNO v5（rhart-song AI App）已下架；写歌统一用 SUNO v5.5 */
export const RETIRED_AUDIO_MODEL_IDS = ['rhart-song', 'doubao-seed-tts-2.0'] as const;

export const DEFAULT_SONG_AUDIO_MODEL = 'rhart-song-v5.5' as const;

const RETIRED_SET = new Set<string>(RETIRED_AUDIO_MODEL_IDS);

export function isRetiredAudioModel(model: string | undefined | null): boolean {
  return RETIRED_SET.has(String(model ?? '').trim());
}

export function normalizeAudioModelIfRetired(model: string | undefined | null): string {
  const m = String(model ?? '').trim();
  if (m === 'rhart-song') return DEFAULT_SONG_AUDIO_MODEL;
  // Doubao 语音合成 2.0 已下架（无克隆，改用 MiniMax TTS）
  if (m === 'doubao-seed-tts-2.0') return 'speech-2.8-hd';
  return m;
}

export function filterActiveAudioModelOptions<T extends { value: string }>(options: readonly T[]): T[] {
  return options.filter((opt) => !isRetiredAudioModel(opt.value));
}
