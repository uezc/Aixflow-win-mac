import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { app } from 'electron';
import type { store as NexflowStore } from '../services/store.js';

const BUNDLE_SYNCED_AT_KEY = 'defaultDigitalHumanLibrarySyncedAt';

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
    if (process.platform === 'win32' && p.match(/^\/[a-zA-Z]:/)) {
      p = p.substring(1);
    }
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

function absFromRel(relOrAbs: string | undefined, userDataPath: string): string | undefined {
  if (!relOrAbs || typeof relOrAbs !== 'string') return undefined;
  if (path.isAbsolute(relOrAbs)) return relOrAbs;
  if (relOrAbs.includes('://')) return relOrAbs;
  return path.join(userDataPath, relOrAbs.replace(/\//g, path.sep));
}

export function getBundledDefaultDigitalHumanLibraryDir(): string {
  if (app.isPackaged && process.resourcesPath) {
    return path.join(process.resourcesPath, 'default-digital-human-library');
  }
  return path.join(app.getAppPath(), 'resources', 'default-digital-human-library');
}

function copyBundledRelPathIntoUserData(relPath: string, userDataPath: string): string | undefined {
  const normalized = relPath.replace(/\\/g, '/').replace(/^\/+/, '');
  if (!normalized || normalized.includes('://')) return undefined;
  const dest = path.join(userDataPath, normalized.replace(/\//g, path.sep));
  if (fs.existsSync(dest)) return dest;
  const bundledSrc = path.join(
    getBundledDefaultDigitalHumanLibraryDir(),
    'files',
    normalized.replace(/\//g, path.sep),
  );
  if (!fs.existsSync(bundledSrc)) return undefined;
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(bundledSrc, dest);
  return dest;
}

function hydrateUrl(url: string | undefined, userDataPath: string): string | undefined {
  if (!url || typeof url !== 'string') return url;
  if (url.startsWith('http://') || url.startsWith('https://') || url.startsWith('data:')) return url;
  const existing = resolveFsPathFromUrlish(url);
  if (existing && fs.existsSync(existing)) return url;
  const abs = absFromRel(url, userDataPath);
  if (abs && fs.existsSync(abs)) return fsPathToLocalResourceUrl(abs);
  if (!url.includes('://') && !path.isAbsolute(url)) {
    const copied = copyBundledRelPathIntoUserData(url, userDataPath);
    if (copied) return fsPathToLocalResourceUrl(copied);
    return undefined;
  }
  return url;
}

function hydratePath(relOrAbs: string | undefined, userDataPath: string): string | undefined {
  const abs = absFromRel(relOrAbs, userDataPath);
  if (abs && fs.existsSync(abs)) return abs;
  if (relOrAbs && typeof relOrAbs === 'string' && !relOrAbs.includes('://') && !path.isAbsolute(relOrAbs)) {
    return copyBundledRelPathIntoUserData(relOrAbs, userDataPath);
  }
  return undefined;
}

function hydrateDigitalHumanItem(raw: Record<string, unknown>, userDataPath: string): Record<string, unknown> {
  const item = { ...raw };
  if (typeof item.localVideoPath === 'string') {
    item.localVideoPath = hydratePath(item.localVideoPath as string, userDataPath);
  }
  if (typeof item.localAudioPath === 'string') {
    item.localAudioPath = hydratePath(item.localAudioPath as string, userDataPath);
  }
  if (typeof item.localPosterPath === 'string') {
    item.localPosterPath = hydratePath(item.localPosterPath as string, userDataPath);
  }
  if (typeof item.videoUrl === 'string') {
    item.videoUrl = hydrateUrl(item.videoUrl as string, userDataPath);
  }
  if (typeof item.audioUrl === 'string') {
    item.audioUrl = hydrateUrl(item.audioUrl as string, userDataPath);
  }
  if (typeof item.poster === 'string') {
    item.poster = hydrateUrl(item.poster as string, userDataPath);
  }
  return item;
}

function copyDirRecursive(src: string, dest: string, overwrite = false): void {
  if (!fs.existsSync(src)) return;
  fs.mkdirSync(dest, { recursive: true });
  for (const name of fs.readdirSync(src)) {
    const s = path.join(src, name);
    const d = path.join(dest, name);
    if (fs.statSync(s).isDirectory()) copyDirRecursive(s, d, overwrite);
    else if (overwrite || !fs.existsSync(d)) fs.copyFileSync(s, d);
  }
}

function serializedLibraryHasNonPortablePaths(data: unknown): boolean {
  const s = JSON.stringify(data || '');
  return /[A-Za-z]:[\\/]/.test(s) || /local-resource:\/\/[A-Za-z]:/i.test(s);
}

function serializedHasUnresolvedBundledPaths(data: unknown): boolean {
  return /"digital-human-library\//.test(JSON.stringify(data || ''));
}

export function repairDigitalHumanLibraryInStore(store: typeof NexflowStore): void {
  const userDataPath = app.getPath('userData');
  const items = ((store.get('digitalHumanLibrary') as Record<string, unknown>[] | undefined) || []).map((item) =>
    hydrateDigitalHumanItem(item, userDataPath),
  );
  const prev = store.get('digitalHumanLibrary');
  if (JSON.stringify(prev) !== JSON.stringify(items)) {
    store.set('digitalHumanLibrary', items);
    console.log('[默认数字人库] 已修复路径', items.length, '条');
  }
}

/** 安装包：数字人库为空或内置包更新时，从 extraResources 注入 */
export function importDefaultDigitalHumanLibraryIfNeeded(store: typeof NexflowStore): void {
  if (!app.isPackaged) return;

  const bundledDir = getBundledDefaultDigitalHumanLibraryDir();
  const manifestPath = path.join(bundledDir, 'manifest.json');
  if (!fs.existsSync(manifestPath)) {
    console.warn('[默认数字人库] 安装包内无 manifest，跳过注入');
    return;
  }

  let manifest: {
    syncedAt?: string;
    digitalHumanLibrary?: Record<string, unknown>[];
  };
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
  } catch (e) {
    console.warn('[默认数字人库] 读取 manifest 失败:', e);
    return;
  }

  const bundledItems = Array.isArray(manifest.digitalHumanLibrary) ? manifest.digitalHumanLibrary : [];
  if (bundledItems.length === 0) return;

  const bundleSyncedAt = String(manifest.syncedAt || '').trim();
  const lastSyncedAt = String(store.get(BUNDLE_SYNCED_AT_KEY) || '').trim();
  const existing = (store.get('digitalHumanLibrary') as unknown[] | undefined) || [];
  const libraryBroken = serializedLibraryHasNonPortablePaths(existing);
  const libraryHasGhostPaths = serializedHasUnresolvedBundledPaths(existing);
  const libraryEmpty = existing.length === 0 || libraryBroken;
  const bundleUpdated = Boolean(bundleSyncedAt && bundleSyncedAt !== lastSyncedAt);

  if (!libraryEmpty && !bundleUpdated && !libraryHasGhostPaths) return;

  const userDataPath = app.getPath('userData');
  const filesDir = path.join(bundledDir, 'files');
  if (fs.existsSync(filesDir)) {
    copyDirRecursive(filesDir, userDataPath, bundleUpdated || libraryHasGhostPaths);
  }

  const shouldReplace = libraryEmpty || bundleUpdated;
  if (shouldReplace) {
    store.set(
      'digitalHumanLibrary',
      bundledItems.map((item) => hydrateDigitalHumanItem(item, userDataPath)),
    );
  } else if (libraryHasGhostPaths) {
    repairDigitalHumanLibraryInStore(store);
  }

  if (bundleSyncedAt) store.set(BUNDLE_SYNCED_AT_KEY, bundleSyncedAt);
  console.log('[默认数字人库] 已注入', bundledItems.length, '条', libraryBroken ? '（已覆盖不可移植的旧数据）' : '');
}
