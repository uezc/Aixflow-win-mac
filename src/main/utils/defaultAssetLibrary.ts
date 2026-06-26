import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { app } from 'electron';
import type { store as NexflowStore } from '../services/store.js';

const BUNDLE_SYNCED_AT_KEY = 'defaultAssetLibrarySyncedAt';

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

function copyBundledRelPathIntoUserData(relPath: string, userDataPath: string): string | undefined {
  const normalized = relPath.replace(/\\/g, '/').replace(/^\/+/, '');
  if (!normalized || normalized.includes('://')) return undefined;
  const dest = path.join(userDataPath, normalized.replace(/\//g, path.sep));
  if (fs.existsSync(dest)) return dest;
  const bundledSrc = path.join(getBundledDefaultAssetLibraryDir(), 'files', normalized.replace(/\//g, path.sep));
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
  /** 安装包 files/ 可能尚未复制到 userData，按需补拷后再解析 */
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

function hydrateCharacter(raw: Record<string, unknown>, userDataPath: string): Record<string, unknown> {
  const c = { ...raw };
  for (const k of ['localAvatarPath', 'localVoicePath', 'localGlbPath', 'localTexturePath', 'inputImageUrl']) {
    if (typeof c[k] === 'string') c[k] = hydratePath(c[k] as string, userDataPath);
  }
  if (Array.isArray(c.localViewPaths)) {
    c.localViewPaths = (c.localViewPaths as string[])
      .map((p) => hydratePath(p, userDataPath))
      .filter(Boolean);
  }
  if (typeof c.avatar === 'string') c.avatar = hydrateUrl(c.avatar as string, userDataPath);
  if (typeof c.voiceClip === 'string') c.voiceClip = hydrateUrl(c.voiceClip as string, userDataPath);
  if (typeof c.localGlbUrl === 'string') c.localGlbUrl = hydrateUrl(c.localGlbUrl as string, userDataPath);
  if (typeof c.resultTextureUrl === 'string') {
    c.resultTextureUrl = hydrateUrl(c.resultTextureUrl as string, userDataPath);
  }
  if (Array.isArray(c.viewImages)) {
    c.viewImages = (c.viewImages as string[])
      .map((u) => hydrateUrl(u, userDataPath))
      .filter((u): u is string => Boolean(u));
  }
  return c;
}

export function hydrateScene(raw: Record<string, unknown>, userDataPath: string): Record<string, unknown> {
  const s = { ...raw };
  for (const k of [
    'localAvatarPath',
    'localNormalImagePath',
    'localDisplay3dImagePath',
    'localPanoramaPath',
  ]) {
    if (typeof s[k] === 'string') s[k] = hydratePath(s[k] as string, userDataPath);
  }
  for (const k of ['avatar', 'normalImageUrl', 'display3dImageUrl', 'panoramaUrl']) {
    if (typeof s[k] === 'string') s[k] = hydrateUrl(s[k] as string, userDataPath);
  }
  return s;
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

export function getBundledDefaultAssetLibraryDir(): string {
  if (app.isPackaged && process.resourcesPath) {
    return path.join(process.resourcesPath, 'default-asset-library');
  }
  return path.join(app.getAppPath(), 'resources', 'default-asset-library');
}

function serializedLibraryHasNonPortablePaths(data: unknown): boolean {
  const s = JSON.stringify(data || '');
  return /[A-Za-z]:[\\/]/.test(s) || /local-resource:\/\/[A-Za-z]:/i.test(s);
}

/** store 中仍含未解析的 bundled-imports/ 相对路径（会导致 useTexture 崩溃） */
export function serializedHasUnresolvedBundledImports(data: unknown): boolean {
  return /"bundled-imports\//.test(JSON.stringify(data || ''));
}

/** 启动时修复已注入但路径未 hydrate 或磁盘文件缺失的资产库条目 */
export function repairAssetLibraryInStore(store: typeof NexflowStore): void {
  const userDataPath = app.getPath('userData');
  const chars = ((store.get('characters') as Record<string, unknown>[] | undefined) || []).map((c) =>
    hydrateCharacter(c, userDataPath),
  );
  const scenes = ((store.get('sceneLibrary') as Record<string, unknown>[] | undefined) || []).map((s) =>
    hydrateScene(s, userDataPath),
  );

  const prevChars = store.get('characters');
  const prevScenes = store.get('sceneLibrary');
  if (JSON.stringify(prevChars) !== JSON.stringify(chars)) {
    store.set('characters', chars);
    console.log('[默认资产库] 已修复角色路径', chars.length, '条');
  }
  if (JSON.stringify(prevScenes) !== JSON.stringify(scenes)) {
    store.set('sceneLibrary', scenes);
    console.log('[默认资产库] 已修复场景路径', scenes.length, '条');
  }
}

/** 安装包：资产库为空或内置包更新时，从 extraResources 注入默认角色/场景/3D 模型 */
export function importDefaultAssetLibraryIfNeeded(store: typeof NexflowStore): void {
  if (!app.isPackaged) return;

  const bundledDir = getBundledDefaultAssetLibraryDir();
  const manifestPath = path.join(bundledDir, 'manifest.json');
  if (!fs.existsSync(manifestPath)) {
    console.warn('[默认资产库] 安装包内无 manifest，跳过注入');
    return;
  }

  let manifest: {
    syncedAt?: string;
    characters?: Record<string, unknown>[];
    sceneLibrary?: Record<string, unknown>[];
  };
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
  } catch (e) {
    console.warn('[默认资产库] 读取 manifest 失败:', e);
    return;
  }

  const chars = Array.isArray(manifest.characters) ? manifest.characters : [];
  const scenes = Array.isArray(manifest.sceneLibrary) ? manifest.sceneLibrary : [];
  if (chars.length === 0 && scenes.length === 0) return;

  const bundleSyncedAt = String(manifest.syncedAt || '').trim();
  const lastSyncedAt = String(store.get(BUNDLE_SYNCED_AT_KEY) || '').trim();
  const existingChars = (store.get('characters') as unknown[] | undefined) || [];
  const existingScenes = (store.get('sceneLibrary') as unknown[] | undefined) || [];
  const libraryBroken =
    serializedLibraryHasNonPortablePaths(existingChars) ||
    serializedLibraryHasNonPortablePaths(existingScenes);
  const libraryHasGhostImports =
    serializedHasUnresolvedBundledImports(existingChars) ||
    serializedHasUnresolvedBundledImports(existingScenes);
  const libraryEmpty =
    (existingChars.length === 0 && existingScenes.length === 0) || libraryBroken;
  const bundleUpdated = Boolean(bundleSyncedAt && bundleSyncedAt !== lastSyncedAt);

  if (!libraryEmpty && !bundleUpdated && !libraryHasGhostImports) return;

  const userDataPath = app.getPath('userData');
  const filesDir = path.join(bundledDir, 'files');
  if (fs.existsSync(filesDir)) {
    copyDirRecursive(filesDir, userDataPath, bundleUpdated || libraryHasGhostImports);
  }

  const shouldReplaceLibrary = libraryEmpty || bundleUpdated;
  if (shouldReplaceLibrary && chars.length > 0) {
    store.set(
      'characters',
      chars.map((c) => hydrateCharacter(c, userDataPath)),
    );
  }
  if (shouldReplaceLibrary && scenes.length > 0) {
    store.set(
      'sceneLibrary',
      scenes.map((s) => hydrateScene(s, userDataPath)),
    );
  } else if (libraryHasGhostImports) {
    repairAssetLibraryInStore(store);
  }
  if (bundleSyncedAt) store.set(BUNDLE_SYNCED_AT_KEY, bundleSyncedAt);
  store.set('defaultAssetLibraryImported', true);
  console.log(
    '[默认资产库] 已注入角色',
    chars.length,
    '条，场景',
    scenes.length,
    '条',
    libraryBroken ? '（已覆盖不可移植的旧路径数据）' : '',
  );
}
