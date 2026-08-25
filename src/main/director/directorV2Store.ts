/**
 * 短剧导演 Domain V2 工程旁路落盘：{projectDir}/director-v2/
 */

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import axios from 'axios';
import { getProjectFolderPath } from '../utils/projectFolderHelper.js';
import {
  createEmptyDramaCastLibrary,
  mergeDramaCastLibrary,
  type DramaCastLibrary,
  type DramaCastLibraryCharacter,
  type DramaCastLibraryScene,
} from '../../shared/directorDomain/castLibrary.js';

const ROOT = 'director-v2';

async function resolveRoot(projectId: string): Promise<string | null> {
  const folder = await getProjectFolderPath(projectId);
  if (!folder) return null;
  const root = path.join(folder, ROOT);
  fs.mkdirSync(root, { recursive: true });
  fs.mkdirSync(path.join(root, 'assets', 'characters'), { recursive: true });
  fs.mkdirSync(path.join(root, 'assets', 'scenes'), { recursive: true });
  fs.mkdirSync(path.join(root, 'assets', 'props'), { recursive: true });
  fs.mkdirSync(path.join(root, 'assets', 'creatures'), { recursive: true });
  fs.mkdirSync(path.join(root, 'assets', 'voices'), { recursive: true });
  fs.mkdirSync(path.join(root, 'board'), { recursive: true });
  fs.mkdirSync(path.join(root, 'packages'), { recursive: true });
  fs.mkdirSync(path.join(root, 'reviews'), { recursive: true });
  return root;
}

function atomicWriteJson(filePath: string, data: unknown): void {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = `${filePath}.${process.pid}.tmp`;
  // 去缩进：session 常内嵌 data URL，缩小体积、降低序列化与写盘开销
  fs.writeFileSync(tmp, JSON.stringify(data), 'utf8');
  fs.renameSync(tmp, filePath);
}

function readJsonIfExists<T>(filePath: string): T | null {
  try {
    if (!fs.existsSync(filePath)) return null;
    const raw = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

/** 勾选弹窗等交互路径禁止解析超大 JSON（session 常带 data URL，会堵死主进程）。 */
function readJsonIfExistsBounded<T>(filePath: string, maxBytes: number): T | null {
  try {
    if (!fs.existsSync(filePath)) return null;
    if (fs.statSync(filePath).size > maxBytes) return null;
    const raw = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export async function directorV2SaveSession(
  projectId: string,
  session: unknown,
): Promise<{ ok: boolean; error?: string; root?: string }> {
  try {
    const root = await resolveRoot(projectId);
    if (!root) return { ok: false, error: '项目目录不存在' };
    // 迁移旧数据：把内嵌的 base64 图片/声音提取为文件、替换为 local-resource:// 路径（避免 session 巨大卡顿/OOM）
    extractSessionDataUrls(session, root);
    const snapshot = {
      schemaVersion: 'director-domain.v2',
      saved_at: Date.now(),
      session,
    };
    atomicWriteJson(path.join(root, 'session.json'), snapshot);

    const s = session as {
      bible?: unknown;
      scene_beats?: unknown;
      shots?: unknown;
    };
    if (s?.bible) atomicWriteJson(path.join(root, 'bible.json'), s.bible);
    if (s?.scene_beats) atomicWriteJson(path.join(root, 'board', 'scenes.json'), s.scene_beats);
    if (s?.shots) atomicWriteJson(path.join(root, 'board', 'shots.json'), s.shots);
    // packages/reviews 已含在 session.json 完整快照内，且碎片恢复不读分片文件 —— 不再逐镜写盘
    return { ok: true, root };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function directorV2LoadSession(
  projectId: string,
): Promise<{ ok: boolean; session?: unknown; error?: string }> {
  try {
    const root = await resolveRoot(projectId);
    if (!root) return { ok: false, error: '项目目录不存在' };
    const snap = readJsonIfExists<{ session?: unknown }>(path.join(root, 'session.json'));
    if (snap?.session) {
      // 迁移旧数据：加载时就把内嵌 base64 提取为文件（否则老草稿每次切步都带着几十 MB 的 base64 卡顿/OOM）
      if (extractSessionDataUrls(snap.session, root)) {
        atomicWriteJson(
          path.join(root, 'session.json'),
          { ...snap, saved_at: Date.now(), session: snap.session },
        );
      }
      return { ok: true, session: snap.session };
    }

    // 碎片恢复
    const bible = readJsonIfExists(path.join(root, 'bible.json'));
    const scene_beats = readJsonIfExists(path.join(root, 'board', 'scenes.json'));
    const shots = readJsonIfExists(path.join(root, 'board', 'shots.json'));
    if (!bible && !shots) return { ok: false, error: '无 V2 会话数据' };
    return {
      ok: true,
      session: {
        meta: {
          schemaVersion: 'director-domain.v2',
          phase: 'analyze',
          store_rel: ROOT,
        },
        bible: bible || {},
        scene_beats: scene_beats || [],
        shots: shots || [],
        packages: {},
        reviews: {},
        continuity_issues: [],
      },
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function directorV2Exists(projectId: string): Promise<boolean> {
  const folder = await getProjectFolderPath(projectId);
  if (!folder) return false;
  return fs.existsSync(path.join(folder, ROOT, 'session.json'));
}

function fsPathToLocalResourceUrl(filePath: string): string {
  let normalizedPath = filePath.replace(/\\/g, '/');
  if (normalizedPath.match(/^\/[a-zA-Z]:/)) {
    normalizedPath = normalizedPath.substring(1);
  }
  return `local-resource://${normalizedPath}`;
}

function resolveFsPathFromUrlish(urlOrPath: string | undefined): string | null {
  const v = (urlOrPath || '').trim();
  if (!v) return null;
  if (v.startsWith('local-resource://')) {
    let p = decodeURIComponent(v.slice('local-resource://'.length));
    if (process.platform === 'win32' && p.match(/^\/[a-zA-Z]:/)) p = p.substring(1);
    p = p.replace(/\//g, path.sep);
    return fs.existsSync(p) ? p : null;
  }
  if (v.startsWith('file://')) {
    try {
      const p = fileURLToPath(v);
      return fs.existsSync(p) ? p : null;
    } catch {
      return null;
    }
  }
  if (path.isAbsolute(v) && fs.existsSync(v)) return v;
  return null;
}

function safeFileStem(name: string, id: string): string {
  const n =
    String(name || '')
      .replace(/[<>:"/\\|?*]/g, '')
      .trim()
      .slice(0, 36) || 'cast';
  const short =
    String(id || '')
      .replace(/[^a-zA-Z0-9_-]/g, '')
      .slice(-14) || Date.now().toString(36);
  return `${n}-${short}`;
}

function extFromUrlOrMime(url: string, mime: string | undefined, fallback: string): string {
  const fromMime = String(mime || '')
    .split(';')[0]
    .trim()
    .toLowerCase();
  if (fromMime.includes('png')) return '.png';
  if (fromMime.includes('jpeg') || fromMime.includes('jpg')) return '.jpg';
  if (fromMime.includes('webp')) return '.webp';
  if (fromMime.includes('gif')) return '.gif';
  if (fromMime.includes('mp3') || fromMime.includes('mpeg')) return '.mp3';
  if (fromMime.includes('wav')) return '.wav';
  if (fromMime.includes('ogg')) return '.ogg';
  if (fromMime.includes('mp4') || fromMime.includes('m4a') || fromMime.includes('aac')) return '.m4a';
  if (fromMime.includes('webm')) return '.webm';
  try {
    const u = new URL(url);
    const ext = path.extname(u.pathname).toLowerCase();
    if (ext && ext.length <= 5) return ext;
  } catch {
    const ext = path.extname(url.split('?')[0] || '').toLowerCase();
    if (ext && ext.length <= 5) return ext;
  }
  return fallback;
}

async function persistCastMediaFile(
  destDir: string,
  stem: string,
  url: string,
  kind: 'image' | 'audio',
): Promise<string> {
  const raw = String(url || '').trim();
  if (!raw) return '';
  const existing = resolveFsPathFromUrlish(raw);
  if (existing) {
    const destDirNorm = path.normalize(destDir);
    if (path.normalize(existing).startsWith(destDirNorm)) {
      return fsPathToLocalResourceUrl(existing);
    }
    const dest = path.join(destDir, `${stem}${path.extname(existing) || (kind === 'audio' ? '.mp3' : '.png')}`);
    if (path.normalize(existing) === path.normalize(dest)) {
      return fsPathToLocalResourceUrl(dest);
    }
    fs.mkdirSync(destDir, { recursive: true });
    try {
      fs.copyFileSync(existing, dest);
      return fsPathToLocalResourceUrl(dest);
    } catch {
      return fsPathToLocalResourceUrl(existing);
    }
  }
  if (!/^https?:\/\//i.test(raw)) return raw;
  fs.mkdirSync(destDir, { recursive: true });
  try {
    const res = await axios.get<ArrayBuffer>(raw, {
      responseType: 'arraybuffer',
      timeout: 60_000,
      maxContentLength: 20 * 1024 * 1024,
    });
    const ext = extFromUrlOrMime(raw, String(res.headers?.['content-type'] || ''), kind === 'audio' ? '.mp3' : '.png');
    const dest = path.join(destDir, `${stem}${ext}`);
    fs.writeFileSync(dest, Buffer.from(res.data));
    return fsPathToLocalResourceUrl(dest);
  } catch (e) {
    console.warn('[本剧人物库] 下载素材失败，保留原 URL:', e instanceof Error ? e.message : e);
    return raw;
  }
}

export async function directorV2LoadCastLibrary(
  projectId: string,
): Promise<{ ok: boolean; library?: DramaCastLibrary; error?: string }> {
  try {
    const root = await resolveRoot(projectId);
    if (!root) return { ok: false, error: '项目目录不存在' };
    const raw = readJsonIfExists<DramaCastLibrary>(path.join(root, 'cast-library.json'));
    return { ok: true, library: createEmptyDramaCastLibrary(raw || undefined) };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

const IMAGE_EXTS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp', '.avif']);
const AUDIO_EXTS = new Set(['.mp3', '.wav', '.m4a', '.ogg', '.flac', '.aac']);

function listDirMedia(
  dir: string,
  kind: 'image' | 'audio',
): Array<{ name: string; url: string }> {
  try {
    if (!fs.existsSync(dir)) return [];
    const allow = kind === 'image' ? IMAGE_EXTS : AUDIO_EXTS;
    return fs
      .readdirSync(dir)
      .map((file) => {
        const ext = path.extname(file).toLowerCase();
        if (!allow.has(ext)) return null;
        const stem = path.basename(file, ext);
        const name = stem.replace(/-(voice|[a-zA-Z0-9_-]{6,14})$/i, '').trim();
        return {
          name: name || stem,
          url: fsPathToLocalResourceUrl(path.join(dir, file)),
        };
      })
      .filter((x): x is { name: string; url: string } => !!x?.url);
  } catch {
    return [];
  }
}

type RecoveredCastPick = { name: string; imageUrl: string; voiceUrl: string };

function pushRecoveredPick(
  out: RecoveredCastPick[],
  name: string,
  imageUrl?: string,
  voiceUrl?: string,
) {
  const n = String(name || '').trim();
  const image = String(imageUrl || '').trim();
  const voice = String(voiceUrl || '').trim();
  if (!n || (!image && !voice)) return;
  const prev = out.find((x) => x.name === n);
  if (prev) {
    prev.imageUrl = prev.imageUrl || image;
    prev.voiceUrl = prev.voiceUrl || voice;
    return;
  }
  out.push({ name: n, imageUrl: image, voiceUrl: voice });
}

/**
 * 把本剧人物库、小体积 bible、以及磁盘定妆文件收成可回填名单。
 * 不读 session.json：文件常带图片 data URL，解析会堵死勾选弹窗。
 */
export async function directorV2RecoverCastPicks(
  projectId: string,
): Promise<{ ok: boolean; picks?: RecoveredCastPick[]; error?: string }> {
  try {
    const root = await resolveRoot(projectId);
    if (!root) return { ok: false, error: '项目目录不存在' };
    const picks: RecoveredCastPick[] = [];
    const lib = readJsonIfExistsBounded<DramaCastLibrary>(
      path.join(root, 'cast-library.json'),
      2_000_000,
    );
    for (const c of lib?.characters || []) {
      pushRecoveredPick(picks, c.name, c.imageUrl, c.voiceUrl);
    }
    const bible = readJsonIfExistsBounded<{
      characters?: Array<{ name?: string; imageUrl?: string; voice_id?: string; character_id?: string }>;
      voices?: Array<{ voice_id?: string; character_id?: string; sample_url?: string }>;
    }>(path.join(root, 'bible.json'), 1_500_000);
    const voices = bible?.voices || [];
    for (const c of bible?.characters || []) {
      const voice =
        voices.find((v) => v.voice_id && v.voice_id === c.voice_id)?.sample_url ||
        voices.find((v) => v.character_id && v.character_id === c.character_id)?.sample_url;
      pushRecoveredPick(picks, String(c.name || ''), c.imageUrl, voice);
    }
    for (const f of listDirMedia(path.join(root, 'assets', 'characters'), 'image')) {
      pushRecoveredPick(picks, f.name, f.url, '');
    }
    for (const f of listDirMedia(path.join(root, 'assets', 'voices'), 'audio')) {
      pushRecoveredPick(picks, f.name.replace(/-voice$/i, ''), '', f.url);
    }
    return { ok: true, picks };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function directorV2UpsertCastLibrary(
  projectId: string,
  incoming: {
    characters?: Array<Partial<DramaCastLibraryCharacter> & { name?: string }>;
    scenes?: Array<Partial<DramaCastLibraryScene> & { name?: string }>;
  },
): Promise<{ ok: boolean; library?: DramaCastLibrary; error?: string }> {
  try {
    const root = await resolveRoot(projectId);
    if (!root) return { ok: false, error: '项目目录不存在' };
    const prev = readJsonIfExists<DramaCastLibrary>(path.join(root, 'cast-library.json'));
    let merged = mergeDramaCastLibrary(prev, incoming || {});
    const charDir = path.join(root, 'assets', 'characters');
    const voiceDir = path.join(root, 'assets', 'voices');
    const sceneDir = path.join(root, 'assets', 'scenes');

    const characters: DramaCastLibraryCharacter[] = [];
    for (const c of merged.characters) {
      const stem = safeFileStem(c.name, c.id);
      const imageUrl = await persistCastMediaFile(charDir, stem, c.imageUrl, 'image');
      const voiceUrl = await persistCastMediaFile(voiceDir, `${stem}-voice`, c.voiceUrl, 'audio');
      characters.push({ ...c, imageUrl, voiceUrl });
    }
    const scenes: DramaCastLibraryScene[] = [];
    for (const s of merged.scenes) {
      const stem = safeFileStem(s.name, s.id);
      const imageUrl = await persistCastMediaFile(sceneDir, stem, s.imageUrl, 'image');
      scenes.push({ ...s, imageUrl });
    }
    merged = createEmptyDramaCastLibrary({
      ...merged,
      characters,
      scenes,
      updated_at: Date.now(),
    });
    atomicWriteJson(path.join(root, 'cast-library.json'), merged);
    return { ok: true, library: merged };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

const MIME_EXT: Record<string, string> = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/webp': '.webp',
  'image/gif': '.gif',
  'image/bmp': '.bmp',
  'image/avif': '.avif',
  'audio/mpeg': '.mp3',
  'audio/mp3': '.mp3',
  'audio/wav': '.wav',
  'audio/x-wav': '.wav',
  'audio/wave': '.wav',
  'audio/ogg': '.ogg',
  'audio/mp4': '.m4a',
  'audio/x-m4a': '.m4a',
  'audio/aac': '.aac',
  'audio/flac': '.flac',
  'audio/webm': '.webm',
};

/** 把上传的图片/声音二进制写到项目目录，返回 local-resource:// 路径（避免把 base64 塞进 session 导致卡顿/OOM） */
export async function directorV2SaveAssetFile(
  projectId: string,
  opts: { kind: 'image' | 'audio'; filename: string; mime?: string; data: ArrayBuffer | Uint8Array },
): Promise<{ ok: boolean; url?: string; error?: string }> {
  try {
    const root = await resolveRoot(projectId);
    if (!root) return { ok: false, error: '项目目录不存在' };
    const rawName =
      String(opts.filename || '').replace(/\.[^.]+$/, '') || (opts.kind === 'audio' ? 'voice' : 'image');
    const stem = safeFileStem(rawName, String(Date.now()).slice(-8));
    const mime = String(opts.mime || '').split(';')[0].trim().toLowerCase();
    const ext =
      MIME_EXT[mime] ||
      path.extname(String(opts.filename || '')).toLowerCase() ||
      (opts.kind === 'audio' ? '.mp3' : '.png');
    const sub = opts.kind === 'audio' ? 'voices' : 'characters';
    const destDir = path.join(root, 'assets', sub);
    fs.mkdirSync(destDir, { recursive: true });
    const dest = path.join(destDir, `${stem}${ext}`);
    const bytes = opts.data instanceof Uint8Array ? opts.data : new Uint8Array(opts.data);
    fs.writeFileSync(dest, bytes);
    return { ok: true, url: fsPathToLocalResourceUrl(dest) };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

function dataUrlToFile(dataUrl: string, root: string, kind: 'image' | 'audio'): string | null {
  const m = /^data:([^;]+);base64,([\s\S]+)$/.exec(String(dataUrl || '').trim());
  if (!m) return null;
  const mime = String(m[1] || '').split(';')[0].trim().toLowerCase();
  const ext = MIME_EXT[mime] || (kind === 'audio' ? '.mp3' : '.png');
  try {
    const buf = Buffer.from(m[2], 'base64');
    // 用内容哈希做文件名：同一张图重复出现只落一份，且迁移幂等（save/load 都跑不会产生重复文件）
    const stem = `${kind === 'audio' ? 'voice' : 'image'}-${crypto
      .createHash('md5')
      .update(m[2])
      .digest('hex')
      .slice(0, 14)}`;
    const destDir = path.join(root, 'assets', kind === 'audio' ? 'voices' : 'characters');
    fs.mkdirSync(destDir, { recursive: true });
    const dest = path.join(destDir, `${stem}${ext}`);
    fs.writeFileSync(dest, buf);
    return fsPathToLocalResourceUrl(dest);
  } catch {
    return null;
  }
}

/** 递归把 session 里内嵌的 data:image / data:audio base64 提取为文件、替换为 local-resource:// 路径。返回是否发生迁移。 */
function extractSessionDataUrls(node: unknown, root: string): boolean {
  if (!node || typeof node !== 'object') return false;
  if (Array.isArray(node)) {
    let changed = false;
    for (const item of node) if (extractSessionDataUrls(item, root)) changed = true;
    return changed;
  }
  const rec = node as Record<string, unknown>;
  let changed = false;
  for (const key of Object.keys(rec)) {
    const v = rec[key];
    if (typeof v === 'string' && (v.startsWith('data:image/') || v.startsWith('data:audio/'))) {
      const kind = v.startsWith('data:audio/') ? 'audio' : 'image';
      const url = dataUrlToFile(v, root, kind);
      if (url) {
        rec[key] = url;
        changed = true;
      }
    } else if (v && typeof v === 'object') {
      if (extractSessionDataUrls(v, root)) changed = true;
    }
  }
  return changed;
}

/**
 * 加载工程图时的一键迁移：把 nodes 里（含各节点 directorDomain）内嵌的 data:image / data:audio
 * base64 提取为 director-v2/assets 下的文件、替换为 local-resource:// 路径，
 * 避免短剧草稿整图几十 MB 塞进内存导致切步卡顿/OOM。返回是否发生了迁移（调用方据此回写 data.json）。
 */
export function directorV2MigrateGraphDataUrls(
  nodes: unknown,
  projectFolderPath: string,
): boolean {
  try {
    const root = path.join(projectFolderPath, ROOT);
    return extractSessionDataUrls(nodes, root);
  } catch {
    return false;
  }
}
