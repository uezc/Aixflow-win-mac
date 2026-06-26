/** SUNO v5（rhart-song AI App）已下架；写歌统一用 SUNO v5.5 */
export const RETIRED_AUDIO_MODEL_IDS = ['rhart-song'] as const;

export const DEFAULT_SONG_AUDIO_MODEL = 'rhart-song-v5.5' as const;

const RETIRED_SET = new Set<string>(RETIRED_AUDIO_MODEL_IDS);

export function isRetiredAudioModel(model: string | undefined | null): boolean {
  return RETIRED_SET.has(String(model ?? '').trim());
}

export function normalizeAudioModelIfRetired(model: string | undefined | null): string {
  const m = String(model ?? '').trim();
  if (m === 'rhart-song') return DEFAULT_SONG_AUDIO_MODEL;
  return m;
}

export function filterActiveAudioModelOptions<T extends { value: string }>(options: readonly T[]): T[] {
  return options.filter((opt) => !isRetiredAudioModel(opt.value));
}
