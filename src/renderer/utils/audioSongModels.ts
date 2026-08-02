/** 全能写歌类模型：共用歌曲名 / 风格 / 歌词 UI 与画布歌词同步逻辑 */
export const AUDIO_SONG_MODEL_IDS = ['rhart-song-v5.5'] as const;

export function isAudioSongModel(model: string | undefined | null): boolean {
  const m = String(model ?? '').trim();
  return (AUDIO_SONG_MODEL_IDS as readonly string[]).includes(m);
}

export function sanitizeAudioDownloadBaseName(name: string): string {
  let s = String(name || '')
    .trim()
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, '_')
    .replace(/\.+$/g, '');
  const extRe = /\.(mp3|wav|flac|m4a|ogg|aac)$/i;
  while (extRe.test(s)) s = s.replace(extRe, '');
  return s || 'audio';
}

/** 从 URL / 本地路径推断音频扩展名（默认 mp3，SUNO 等多为 mp3） */
export function inferAudioFileExtFromUrl(url: string): string {
  const raw = String(url || '').trim();
  if (!raw) return 'mp3';
  try {
    const pathPart = raw.startsWith('http://') || raw.startsWith('https://')
      ? decodeURIComponent(new URL(raw).pathname)
      : decodeURIComponent(raw.replace(/^local-resource:\/\//, '').replace(/^file:\/\/\/?/, ''));
    const m = pathPart.match(/\.(mp3|wav|flac|m4a|ogg|aac)(?:\?|$)/i);
    if (m) return m[1].toLowerCase();
  } catch {
    /* ignore */
  }
  return 'mp3';
}

function basenameFromAudioUrl(url: string): string {
  if (!url) return '';
  try {
    const pathPart = url.startsWith('http://') || url.startsWith('https://')
      ? decodeURIComponent(new URL(url).pathname)
      : decodeURIComponent(url.replace(/^local-resource:\/\//, '').replace(/^file:\/\/\/?/, ''));
    const base = pathPart.split('/').pop() || '';
    if (!base.includes('.')) return '';
    const dot = base.lastIndexOf('.');
    const stem = sanitizeAudioDownloadBaseName(base.slice(0, dot));
    return `${stem}${base.slice(dot).toLowerCase()}`;
  } catch {
    return '';
  }
}

/** 从本地文件名得到展示用曲名（去掉扩展名） */
export function audioDisplayTitleFromFileName(fileName: string): string {
  const raw = String(fileName || '').trim();
  if (!raw) return '';
  const base = raw.replace(/\\/g, '/').split('/').pop() || raw;
  return sanitizeAudioDownloadBaseName(base);
}

function isGenericAudioTitle(name: string): boolean {
  const s = String(name || '').trim();
  return !s || /^(audio|声音|音频|mv音乐|mv music)$/i.test(s);
}

/**
 * 解析音频节点应展示/传给下游的曲名：
 * songName → 非占位 title → URL/路径文件名 → label → fallback
 */
export function resolveAudioNodeDisplayTitle(
  data:
    | {
        title?: string | null;
        songName?: string | null;
        label?: string | null;
        outputAudio?: string | null;
        originalAudioUrl?: string | null;
        referenceAudioUrl?: string | null;
        sourceSongAudioUrl?: string | null;
      }
    | undefined
    | null,
  fallback = 'audio',
): string {
  const song = String(data?.songName || '').trim();
  if (song) return sanitizeAudioDownloadBaseName(song);

  const title = String(data?.title || '').trim();
  if (!isGenericAudioTitle(title)) return sanitizeAudioDownloadBaseName(title);

  const url = String(
    data?.originalAudioUrl ||
      data?.outputAudio ||
      data?.sourceSongAudioUrl ||
      data?.referenceAudioUrl ||
      '',
  ).trim();
  const fromUrl = basenameFromAudioUrl(url);
  if (fromUrl) {
    const dot = fromUrl.lastIndexOf('.');
    return sanitizeAudioDownloadBaseName(dot > 0 ? fromUrl.slice(0, dot) : fromUrl);
  }

  const label = String(data?.label || '').trim();
  if (!isGenericAudioTitle(label)) return sanitizeAudioDownloadBaseName(label);

  return sanitizeAudioDownloadBaseName(fallback);
}

/** 音乐模块另存为：返回不含扩展名的建议文件名（扩展名由主进程另存为 filters 追加） */
export function buildMusicDownloadSuggestedName(opts: {
  model?: string | null;
  songName?: string | null;
  fallbackTitle?: string | null;
  audioUrl?: string | null;
}): string {
  if (isAudioSongModel(opts.model) && String(opts.songName || '').trim()) {
    return sanitizeAudioDownloadBaseName(String(opts.songName).trim());
  }
  const fromUrl = basenameFromAudioUrl(opts.audioUrl || '');
  if (fromUrl) {
    const dot = fromUrl.lastIndexOf('.');
    if (dot > 0) return sanitizeAudioDownloadBaseName(fromUrl.slice(0, dot));
    return sanitizeAudioDownloadBaseName(fromUrl);
  }
  return sanitizeAudioDownloadBaseName(opts.fallbackTitle || 'audio');
}
