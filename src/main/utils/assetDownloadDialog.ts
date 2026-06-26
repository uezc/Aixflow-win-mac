import { app, dialog, type BrowserWindow } from 'electron';
import path from 'path';

/** 另存为对话框会按 filters 再追加扩展名，defaultPath 文件名不得带这些后缀（可重复剥离） */
const SAVE_DIALOG_STRIP_EXTS = [
  '.mp3', '.wav', '.flac', '.m4a', '.ogg', '.aac',
  '.mp4', '.webm', '.mov', '.mkv', '.avi',
  '.png', '.jpg', '.jpeg', '.webp', '.gif', '.glb',
];

export function stripSaveDialogExtension(fileName: string): string {
  let s = String(fileName || '').trim();
  if (!s) return 'file';
  let changed = true;
  while (changed) {
    changed = false;
    const lower = s.toLowerCase();
    for (const ext of SAVE_DIALOG_STRIP_EXTS) {
      if (lower.endsWith(ext)) {
        s = s.slice(0, -ext.length);
        changed = true;
        break;
      }
    }
  }
  return sanitizeFileName(s) || 'file';
}

export function sanitizeFileName(name: string): string {
  const cleaned = String(name || '')
    .trim()
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, '_')
    .replace(/\.+$/g, '');
  return cleaned || 'file';
}

/** 从 http(s) URL 或路径中提取带扩展名的文件名 */
export function fileNameFromUrl(url: string): string | null {
  const raw = String(url || '').trim();
  if (!raw) return null;
  try {
    const pathname = raw.startsWith('http://') || raw.startsWith('https://')
      ? new URL(raw).pathname
      : raw.replace(/^local-resource:\/\//, '').replace(/^file:\/\/\/?/, '');
    const base = decodeURIComponent(pathname.split('/').pop() || '').trim();
    if (base && path.extname(base)) return sanitizeFileName(base);
  } catch {
    /* ignore */
  }
  return null;
}

export function saveFiltersForExt(ext: string): { name: string; extensions: string[] }[] {
  const e = String(ext || '').replace(/^\./, '').toLowerCase();
  const map: Record<string, { label: string; exts: string[] }> = {
    mp4: { label: 'MP4 - MPEG-4 视频 (*.mp4)', exts: ['mp4'] },
    webm: { label: 'WebM 视频 (*.webm)', exts: ['webm'] },
    mov: { label: 'QuickTime 视频 (*.mov)', exts: ['mov'] },
    mkv: { label: 'MKV 视频 (*.mkv)', exts: ['mkv'] },
    avi: { label: 'AVI 视频 (*.avi)', exts: ['avi'] },
    png: { label: 'PNG 图片 (*.png)', exts: ['png'] },
    jpg: { label: 'JPEG 图片 (*.jpg;*.jpeg)', exts: ['jpg', 'jpeg'] },
    jpeg: { label: 'JPEG 图片 (*.jpg;*.jpeg)', exts: ['jpg', 'jpeg'] },
    webp: { label: 'WebP 图片 (*.webp)', exts: ['webp'] },
    gif: { label: 'GIF 图片 (*.gif)', exts: ['gif'] },
    mp3: { label: 'MP3 音频 (*.mp3)', exts: ['mp3'] },
    wav: { label: 'WAV 音频 (*.wav)', exts: ['wav'] },
    flac: { label: 'FLAC 音频 (*.flac)', exts: ['flac'] },
    m4a: { label: 'M4A 音频 (*.m4a)', exts: ['m4a'] },
    ogg: { label: 'OGG 音频 (*.ogg)', exts: ['ogg'] },
    glb: { label: 'GLB 3D 模型 (*.glb)', exts: ['glb'] },
  };
  const hit = map[e];
  const primary = hit ? [{ name: hit.label, extensions: hit.exts }] : [];
  return [...primary, { name: '所有文件 (*.*)', extensions: ['*'] }];
}

/** 视频另存为：列出常见格式供「保存类型」下拉选择 */
export function saveFiltersForVideo(defaultExt = '.mp4'): { name: string; extensions: string[] }[] {
  const ext = String(defaultExt || '.mp4').replace(/^\./, '').toLowerCase();
  const all = [
    { name: 'MP4 - MPEG-4 视频 (*.mp4)', extensions: ['mp4'] },
    { name: 'WebM 视频 (*.webm)', extensions: ['webm'] },
    { name: 'QuickTime 视频 (*.mov)', extensions: ['mov'] },
    { name: 'MKV 视频 (*.mkv)', extensions: ['mkv'] },
  ];
  const preferred = all.find((f) => f.extensions.includes(ext));
  const rest = all.filter((f) => f !== preferred);
  return [...(preferred ? [preferred] : []), ...rest, { name: '所有文件 (*.*)', extensions: ['*'] }];
}

/** 音频另存为：列出常见格式供「保存类型」下拉选择 */
export function saveFiltersForAudio(defaultExt = '.mp3'): { name: string; extensions: string[] }[] {
  const ext = String(defaultExt || '.mp3').replace(/^\./, '').toLowerCase();
  const all = [
    { name: 'MP3 音频 (*.mp3)', extensions: ['mp3'] },
    { name: 'WAV 音频 (*.wav)', extensions: ['wav'] },
    { name: 'FLAC 音频 (*.flac)', extensions: ['flac'] },
    { name: 'M4A 音频 (*.m4a)', extensions: ['m4a'] },
    { name: 'OGG 音频 (*.ogg)', extensions: ['ogg'] },
    { name: 'AAC 音频 (*.aac)', extensions: ['aac'] },
  ];
  const preferred = all.find((f) => f.extensions.includes(ext));
  const rest = all.filter((f) => f !== preferred);
  return [...(preferred ? [preferred] : []), ...rest, { name: '所有文件 (*.*)', extensions: ['*'] }];
}

export function defaultSavePath(preferredName: string, fallbackExt?: string): string {
  const downloads = app.getPath('downloads');
  let name = sanitizeFileName(preferredName);
  const ext = fallbackExt ? (fallbackExt.startsWith('.') ? fallbackExt : `.${fallbackExt}`) : '';
  if (ext && !path.extname(name)) name += ext;
  return path.join(downloads, name);
}

export function buildDefaultSavePath(
  sourceHint: string,
  nodeTitle: string,
  fallbackExt: string,
): string {
  const fromUrl = fileNameFromUrl(sourceHint);
  if (fromUrl) return defaultSavePath(fromUrl);
  return defaultSavePath(nodeTitle || 'file', fallbackExt);
}

/** 从建议文件名拆出 stem 与扩展名（sanitize 会剥掉尾部扩展名，须先解析 ext） */
function parseSuggestedStemAndExt(
  rawName: string,
  fallbackExt: string,
): { stem: string; ext: string } {
  const raw = String(rawName || '').trim();
  const ext = (raw ? path.extname(raw) : '') || fallbackExt || '.mp3';
  const normalizedExt = ext.startsWith('.') ? ext.toLowerCase() : `.${ext.toLowerCase()}`;
  const stemSource = raw && path.extname(raw) ? raw.slice(0, -path.extname(raw).length) : raw;
  const stem = stripSaveDialogExtension(stemSource) || 'audio';
  return { stem, ext: normalizedExt };
}

/** 音频另存为：优先客户端建议名（如歌曲名），再回退 URL 文件名 */
export function resolveAudioSaveDefaults(
  url: string,
  suggestedName: string,
  isLocal: boolean,
  localSourcePath: string,
): { defaultPath: string; defaultExt: string } {
  const supplied = String(suggestedName || '').trim();
  const urlBase = fileNameFromUrl(url);
  const localExt = isLocal ? path.extname(localSourcePath).toLowerCase() : '';
  const urlExt = urlBase ? path.extname(urlBase).toLowerCase() : '';
  const fallbackExt = localExt || urlExt || '.mp3';

  let stem = 'audio';
  let defaultExt = fallbackExt;

  if (supplied && supplied !== 'audio') {
    ({ stem, ext: defaultExt } = parseSuggestedStemAndExt(supplied, fallbackExt));
  } else if (urlBase) {
    ({ stem, ext: defaultExt } = parseSuggestedStemAndExt(urlBase, fallbackExt));
  }

  // Windows 另存为：defaultPath 仅含文件名主干，扩展名由 filters 决定，避免 *.mp3.mp3
  return {
    defaultPath: path.join(app.getPath('downloads'), stem),
    defaultExt,
  };
}

export async function pickSavePath(
  win: BrowserWindow,
  opts: { title: string; defaultPath: string; filters: { name: string; extensions: string[] }[] },
) {
  const raw = String(opts.defaultPath || '').trim();
  const dir = raw ? path.dirname(raw) : app.getPath('downloads');
  const stem = stripSaveDialogExtension(path.basename(raw || 'file'));
  const defaultPath = path.join(dir, stem);
  return dialog.showSaveDialog(win, {
    title: opts.title,
    defaultPath,
    filters: opts.filters,
  });
}

export function parseDataUrl(dataUrl: string): { buffer: Buffer; ext: string } | null {
  const semi = dataUrl.indexOf(',');
  if (semi < 0) return null;
  const header = dataUrl.slice(0, semi);
  const body = dataUrl.slice(semi + 1);
  const mime = header.match(/^data:([^;,]+)/i)?.[1]?.toLowerCase() || 'image/png';
  const ext =
    mime.includes('jpeg') || mime.includes('jpg')
      ? '.jpg'
      : mime.includes('webp')
        ? '.webp'
        : mime.includes('gif')
          ? '.gif'
          : '.png';
  try {
    const buffer = header.includes(';base64')
      ? Buffer.from(body, 'base64')
      : Buffer.from(decodeURIComponent(body), 'utf8');
    return { buffer, ext };
  } catch {
    return null;
  }
}
