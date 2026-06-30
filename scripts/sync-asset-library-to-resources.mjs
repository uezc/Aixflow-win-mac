#!/usr/bin/env node
/**
 * 构建前同步：将本地资产库（角色 / 场景 / 3D 模型及磁盘文件）写入 resources/default-asset-library，
 * 供安装包 extraResources 打包，首次运行时注入到新用户 userData。
 *
 * 会把 userData 外路径（如 E:\项目\assets）复制进 files/ 并重写为相对路径，确保新电脑可离线使用。
 */
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.join(__dirname, '..');
const outputRoot = path.join(projectRoot, 'resources', 'default-asset-library');
const filesOut = path.join(outputRoot, 'files');
const manifestPath = path.join(outputRoot, 'manifest.json');
/** 构建时实际写入目录（staging），默认等于 filesOut */
let filesOutActive = filesOut;

const ASSET_SUBDIRS = [
  'character-views',
  'character-voices',
  'character-3d',
  'scene-library',
  'avatars',
  'assets',
  'bundled-imports',
];

function getUserDataPath() {
  if (process.platform === 'win32') {
    const base = process.env.APPDATA || path.join(process.env.USERPROFILE || '', 'AppData', 'Roaming');
    return path.join(base, 'NEXFLOW');
  }
  if (process.platform === 'darwin') {
    return path.join(process.env.HOME || '', 'Library', 'Application Support', 'NEXFLOW');
  }
  const base = process.env.XDG_CONFIG_HOME || path.join(process.env.HOME || '', '.config');
  return path.join(base, 'NEXFLOW');
}

function getConfigPath(userDataPath) {
  return path.join(userDataPath, 'nexflow-config.json');
}

function resolveFsPathFromUrlish(urlOrPath) {
  const v = (urlOrPath || '').trim();
  if (!v) return null;
  if (v.startsWith('local-resource://')) {
    let p = decodeURIComponent(v.slice('local-resource://'.length));
    if (process.platform === 'win32' && /^\/[a-zA-Z]:/.test(p)) p = p.slice(1);
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

function isUnderUserData(absPath, userDataPath) {
  const resolved = path.resolve(absPath);
  const base = path.resolve(userDataPath);
  return resolved === base || resolved.startsWith(base + path.sep);
}

function toRelUnderUserData(absPath, userDataPath) {
  if (!absPath) return absPath;
  const resolved = path.resolve(absPath);
  const base = path.resolve(userDataPath);
  if (!isUnderUserData(resolved, base)) return null;
  return path.relative(base, resolved).replace(/\\/g, '/');
}

/** 将 userData 外的文件复制到 files/bundled-imports/ 并返回相对 userData 的路径 */
function importExternalAbsPath(absPath, userDataPath, importCache) {
  if (!absPath || !fs.existsSync(absPath) || !fs.statSync(absPath).isFile()) return null;
  const resolved = path.resolve(absPath);
  const under = toRelUnderUserData(resolved, userDataPath);
  if (under && !under.startsWith('..')) return under;

  const cacheKey = resolved.toLowerCase();
  if (importCache.has(cacheKey)) return importCache.get(cacheKey);

  const hash = crypto.createHash('sha1').update(resolved).digest('hex').slice(0, 20);
  const ext = path.extname(resolved) || '';
  const rel = `bundled-imports/${hash}${ext}`;
  const dest = path.join(filesOutActive, rel);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  if (!fs.existsSync(dest)) fs.copyFileSync(resolved, dest);
  importCache.set(cacheKey, rel);
  return rel;
}

function bundlePathOrUrl(value, userDataPath, importCache) {
  if (!value || typeof value !== 'string') return value;
  if (value.startsWith('http://') || value.startsWith('https://') || value.startsWith('data:')) return value;

  const absFromUrl = resolveFsPathFromUrlish(value);
  if (absFromUrl) {
    const rel = importExternalAbsPath(absFromUrl, userDataPath, importCache);
    return rel || value;
  }

  const abs = path.isAbsolute(value) ? value : path.join(userDataPath, value.replace(/\//g, path.sep));
  if (fs.existsSync(abs)) {
    const rel = importExternalAbsPath(abs, userDataPath, importCache);
    return rel || value;
  }

  /** 相对路径但磁盘上不存在：不要写进 manifest，避免安装包引用幽灵文件 */
  if (!value.includes('://') && !path.isAbsolute(value)) {
    console.warn('[sync-asset-library] 跳过缺失的相对路径:', value);
    return '';
  }
  return value;
}

function serializeCharacter(c, userDataPath, importCache) {
  const out = { ...c };
  const pathKeys = ['localAvatarPath', 'localVoicePath', 'localGlbPath', 'localTexturePath', 'inputImageUrl'];
  for (const k of pathKeys) {
    if (typeof out[k] === 'string') out[k] = bundlePathOrUrl(out[k], userDataPath, importCache);
  }
  if (Array.isArray(out.localViewPaths)) {
    out.localViewPaths = out.localViewPaths
      .map((p) => bundlePathOrUrl(p, userDataPath, importCache))
      .filter(Boolean);
  }
  for (const k of ['avatar', 'voiceClip', 'localGlbUrl', 'resultTextureUrl']) {
    if (typeof out[k] === 'string') out[k] = bundlePathOrUrl(out[k], userDataPath, importCache);
  }
  if (Array.isArray(out.viewImages)) {
    out.viewImages = out.viewImages.map((u) => bundlePathOrUrl(u, userDataPath, importCache));
  }
  return out;
}

function serializeScene(s, userDataPath, importCache) {
  const out = { ...s };
  for (const k of ['localAvatarPath', 'localNormalImagePath', 'localDisplay3dImagePath', 'localPanoramaPath']) {
    if (typeof out[k] === 'string') out[k] = bundlePathOrUrl(out[k], userDataPath, importCache);
  }
  for (const k of ['avatar', 'normalImageUrl', 'display3dImageUrl', 'panoramaUrl']) {
    if (typeof out[k] === 'string') out[k] = bundlePathOrUrl(out[k], userDataPath, importCache);
  }
  return out;
}

function copyDirRecursive(src, dest) {
  if (!fs.existsSync(src)) return;
  fs.mkdirSync(dest, { recursive: true });
  for (const name of fs.readdirSync(src)) {
    const s = path.join(src, name);
    const d = path.join(dest, name);
    if (fs.statSync(s).isDirectory()) copyDirRecursive(s, d);
    else fs.copyFileSync(s, d);
  }
}

function rmDirRecursive(dir, { label = '目录', throwOnFail = true } = {}) {
  if (!fs.existsSync(dir)) return true;
  try {
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 400 });
    return true;
  } catch (e) {
    const code = e?.code || '';
    if (code === 'EPERM' || code === 'EBUSY' || code === 'EACCES') {
      const bak = `${dir}.bak-${process.pid}-${Date.now()}`;
      try {
        fs.renameSync(dir, bak);
        console.warn(`[sync-asset-library] ${label}被占用，已重命名为 ${path.basename(bak)}`);
        try {
          fs.rmSync(bak, { recursive: true, force: true, maxRetries: 2, retryDelay: 200 });
        } catch {
          console.warn(`[sync-asset-library] 请稍后手动删除 ${bak}`);
        }
        return true;
      } catch {
        if (throwOnFail) {
          console.error(
            `[sync-asset-library] 无法清理 ${dir}（${code}）。请先关闭 Aixflow / 文件资源管理器预览，再重试构建。`,
          );
          throw e;
        }
        return false;
      }
    }
    if (throwOnFail) throw e;
    return false;
  }
}

/** 将 staging 合并到 target（覆盖同名文件），用于 target 被占用无法整目录删除时 */
function mergeDirIntoTarget(staging, target) {
  if (!fs.existsSync(staging)) return;
  fs.mkdirSync(target, { recursive: true });
  for (const name of fs.readdirSync(staging)) {
    const s = path.join(staging, name);
    const d = path.join(target, name);
    if (fs.statSync(s).isDirectory()) {
      mergeDirIntoTarget(s, d);
    } else {
      fs.mkdirSync(path.dirname(d), { recursive: true });
      try {
        fs.copyFileSync(s, d);
      } catch (e) {
        if (e?.code === 'EPERM' || e?.code === 'EBUSY') {
          console.warn(`[sync-asset-library] 跳过被占用的文件: ${d}`);
        } else {
          throw e;
        }
      }
    }
  }
}

function promoteStagingDir(stagingDir, targetDir) {
  if (fs.existsSync(targetDir)) {
    if (!rmDirRecursive(targetDir, { label: 'files', throwOnFail: false })) {
      console.warn('[sync-asset-library] files/ 仍被占用，改为增量覆盖（可能残留已删除资产的旧文件）');
      mergeDirIntoTarget(stagingDir, targetDir);
      rmDirRecursive(stagingDir, { label: 'staging', throwOnFail: false });
      return;
    }
  }
  fs.renameSync(stagingDir, targetDir);
}

function countBundledImports(importCache) {
  return importCache.size;
}

function validateManifestPaths(serialized) {
  const text = JSON.stringify(serialized);
  const badDrive = text.match(/[A-Za-z]:\\[^"\\]+/g) || [];
  const badLocalRes = text.match(/local-resource:\/\/[^"]+/g) || [];
  return { badDrive, badLocalRes };
}

function main() {
  const userDataPath = getUserDataPath();
  const configPath = getConfigPath(userDataPath);

  let characters = [];
  let sceneLibrary = [];

  if (fs.existsSync(configPath)) {
    try {
      const data = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      if (Array.isArray(data.characters)) characters = data.characters;
      if (Array.isArray(data.sceneLibrary)) sceneLibrary = data.sceneLibrary;
      console.log(
        `[sync-asset-library] 从 ${configPath} 读取：角色 ${characters.length}，场景 ${sceneLibrary.length}`,
      );
    } catch (e) {
      console.warn('[sync-asset-library] 读取配置失败:', e.message);
    }
  } else {
    console.log('[sync-asset-library] 未找到本地配置，将写入空 manifest');
  }

  const stagingRoot = `${filesOut}.staging-${process.pid}`;
  rmDirRecursive(stagingRoot, { label: 'staging', throwOnFail: true });
  fs.mkdirSync(stagingRoot, { recursive: true });
  filesOutActive = stagingRoot;

  let copiedDirs = 0;
  for (const sub of ASSET_SUBDIRS) {
    const src = path.join(userDataPath, sub);
    if (!fs.existsSync(src)) continue;
    copyDirRecursive(src, path.join(filesOutActive, sub));
    copiedDirs += 1;
  }

  const importCache = new Map();
  const serialized = {
    characters: characters.map((c) => serializeCharacter(c, userDataPath, importCache)),
    sceneLibrary: sceneLibrary.map((s) => serializeScene(s, userDataPath, importCache)),
  };

  promoteStagingDir(stagingRoot, filesOut);
  filesOutActive = filesOut;

  const validation = validateManifestPaths(serialized);
  if (validation.badDrive.length > 0 || validation.badLocalRes.length > 0) {
    console.error('[sync-asset-library] manifest 仍含无法移植的路径（构建中止）：');
    validation.badDrive.slice(0, 5).forEach((p) => console.error('  盘符路径:', p));
    validation.badLocalRes.slice(0, 5).forEach((p) => console.error('  local-resource:', p));
    process.exit(1);
  }

  fs.mkdirSync(outputRoot, { recursive: true });
  const syncedAt = new Date().toISOString();
  fs.writeFileSync(
    manifestPath,
    JSON.stringify(
      {
        version: 2,
        syncedAt,
        sourceUserData: userDataPath,
        characters: serialized.characters,
        sceneLibrary: serialized.sceneLibrary,
      },
      null,
      2,
    ),
    'utf-8',
  );

  console.log(
    `[sync-asset-library] 已写入 ${manifestPath}（资产目录 ${copiedDirs} 个，外置文件导入 ${countBundledImports(importCache)} 个）`,
  );

  if (characters.length === 0 && sceneLibrary.length === 0) {
    console.warn('[sync-asset-library] 当前资产库为空；请先在本机添加角色/场景/模型后再构建，否则安装包不含默认资产。');
  }
}

main();
