#!/usr/bin/env node
/**
 * 构建前同步：将本机数字人资产库写入 resources/default-digital-human-library，
 * 供安装包 extraResources 打包，新用户首次运行自动注入。
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.join(__dirname, '..');
const outputRoot = path.join(projectRoot, 'resources', 'default-digital-human-library');
const filesOut = path.join(outputRoot, 'files');
const manifestPath = path.join(outputRoot, 'manifest.json');
let filesOutActive = filesOut;

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

function resolveFsPathFromUrlish(urlOrPath) {
  const v = (urlOrPath || '').trim();
  if (!v) return null;
  if (v.startsWith('local-resource://')) {
    let p = decodeURIComponent(v.slice('local-resource://'.length));
    if (process.platform === 'win32' && /^\/[a-zA-Z]:/.test(p)) p = p.slice(1);
    p = p.replace(/\//g, path.sep);
    return fs.existsSync(p) ? p : null;
  }
  if (path.isAbsolute(v) && fs.existsSync(v)) return v;
  return null;
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
        console.warn(`[sync-digital-human] ${label}被占用，已重命名为 ${path.basename(bak)}`);
        try {
          fs.rmSync(bak, { recursive: true, force: true, maxRetries: 2, retryDelay: 200 });
        } catch {
          console.warn(`[sync-digital-human] 请稍后手动删除 ${bak}`);
        }
        return true;
      } catch {
        if (throwOnFail) throw e;
        return false;
      }
    }
    if (throwOnFail) throw e;
    return false;
  }
}

function mergeDirIntoTarget(staging, target) {
  if (!fs.existsSync(staging)) return;
  fs.mkdirSync(target, { recursive: true });
  for (const name of fs.readdirSync(staging)) {
    const s = path.join(staging, name);
    const d = path.join(target, name);
    if (fs.statSync(s).isDirectory()) mergeDirIntoTarget(s, d);
    else {
      fs.mkdirSync(path.dirname(d), { recursive: true });
      try {
        fs.copyFileSync(s, d);
      } catch (e) {
        if (e?.code === 'EPERM' || e?.code === 'EBUSY') {
          console.warn(`[sync-digital-human] 跳过被占用文件: ${d}`);
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
      console.warn('[sync-digital-human] files/ 被占用，改为增量覆盖');
      mergeDirIntoTarget(stagingDir, targetDir);
      rmDirRecursive(stagingDir, { label: 'staging', throwOnFail: false });
      return;
    }
  }
  try {
    fs.renameSync(stagingDir, targetDir);
  } catch (e) {
    const code = e?.code || '';
    if (code === 'EPERM' || code === 'EBUSY' || code === 'EACCES') {
      console.warn('[sync-digital-human] rename 失败，改为增量覆盖:', e.message);
      fs.mkdirSync(targetDir, { recursive: true });
      mergeDirIntoTarget(stagingDir, targetDir);
      rmDirRecursive(stagingDir, { label: 'staging', throwOnFail: false });
      return;
    }
    throw e;
  }
}

function bundleMediaField(raw, userDataPath) {
  const trimmed = (raw || '').trim();
  if (!trimmed) return { rel: '', originalUrl: undefined };
  if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
    return { rel: '', originalUrl: trimmed, warn: '远程 URL 未本地化，无法打入安装包' };
  }
  const abs = resolveFsPathFromUrlish(trimmed) || (path.isAbsolute(trimmed) ? trimmed : null);
  if (abs && fs.existsSync(abs)) {
    const rel = toRelUnderUserData(abs, userDataPath);
    if (rel && !rel.startsWith('..')) return { rel, originalUrl: undefined };
  }
  if (!trimmed.includes('://') && !path.isAbsolute(trimmed)) {
    const abs2 = path.join(userDataPath, trimmed.replace(/\//g, path.sep));
    if (fs.existsSync(abs2)) return { rel: trimmed.replace(/\\/g, '/'), originalUrl: undefined };
  }
  return { rel: '', originalUrl: undefined, warn: `无法解析路径: ${trimmed}` };
}

function serializeItem(item, userDataPath) {
  const out = {
    id: item.id,
    nickname: item.nickname || item.name,
    name: item.name || item.nickname,
    createdAt: item.createdAt || Date.now(),
  };

  const videoFromPath = bundleMediaField(item.localVideoPath, userDataPath);
  const videoFromUrl = bundleMediaField(item.videoUrl, userDataPath);
  const videoRel = videoFromPath.rel || videoFromUrl.rel;
  if (!videoRel) {
    return { skip: true, reason: videoFromPath.warn || videoFromUrl.warn || '缺少参考视频文件' };
  }
  out.localVideoPath = videoRel;
  out.videoUrl = videoRel;
  out.originalVideoUrl = item.originalVideoUrl || videoFromPath.originalUrl || videoFromUrl.originalUrl;

  const audioFromPath = bundleMediaField(item.localAudioPath, userDataPath);
  const audioFromUrl = bundleMediaField(item.audioUrl, userDataPath);
  const audioRel = audioFromPath.rel || audioFromUrl.rel;
  if (audioRel) {
    out.localAudioPath = audioRel;
    out.audioUrl = audioRel;
    out.originalAudioUrl = item.originalAudioUrl || audioFromPath.originalUrl || audioFromUrl.originalUrl;
  }

  const posterFromPath = bundleMediaField(item.localPosterPath, userDataPath);
  const posterFromUrl = bundleMediaField(item.poster, userDataPath);
  const posterRel = posterFromPath.rel || posterFromUrl.rel;
  if (posterRel) {
    out.localPosterPath = posterRel;
    out.poster = posterRel;
  }

  return { skip: false, item: out };
}

function validateManifest(items) {
  const text = JSON.stringify(items);
  const badDrive = text.match(/[A-Za-z]:\\[^"\\]+/g) || [];
  const badLocalRes = text.match(/local-resource:\/\/[^"]+/g) || [];
  return { badDrive, badLocalRes };
}

function main() {
  const userDataPath = getUserDataPath();
  const configPath = getConfigPath(userDataPath);

  let items = [];
  if (fs.existsSync(configPath)) {
    try {
      const data = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      if (Array.isArray(data.digitalHumanLibrary)) items = data.digitalHumanLibrary;
      console.log(`[sync-digital-human] 从 ${configPath} 读取 ${items.length} 条数字人`);
    } catch (e) {
      console.warn('[sync-digital-human] 读取配置失败:', e.message);
    }
  } else {
    console.log('[sync-digital-human] 未找到本地配置，将写入空 manifest');
  }

  const stagingRoot = `${filesOut}.staging-${process.pid}`;
  rmDirRecursive(stagingRoot, { label: 'staging', throwOnFail: true });
  fs.mkdirSync(stagingRoot, { recursive: true });
  filesOutActive = stagingRoot;

  const srcDhDir = path.join(userDataPath, 'digital-human-library');
  if (fs.existsSync(srcDhDir)) {
    copyDirRecursive(srcDhDir, path.join(filesOutActive, 'digital-human-library'));
  }

  const serialized = [];
  for (const raw of items) {
    const one = serializeItem(raw, userDataPath);
    if (one.skip) {
      console.warn(`[sync-digital-human] 跳过条目 ${raw.id || raw.name}: ${one.reason}`);
      continue;
    }
    serialized.push(one.item);
  }

  const validation = validateManifest(serialized);
  if (validation.badDrive.length || validation.badLocalRes.length) {
    console.error('[sync-digital-human] manifest 含不可移植路径，构建中止');
    process.exit(1);
  }

  promoteStagingDir(stagingRoot, filesOut);
  filesOutActive = filesOut;

  fs.mkdirSync(outputRoot, { recursive: true });
  fs.writeFileSync(
    manifestPath,
    JSON.stringify(
      {
        version: 1,
        syncedAt: new Date().toISOString(),
        sourceUserData: userDataPath,
        digitalHumanLibrary: serialized,
      },
      null,
      2,
    ),
    'utf-8',
  );

  console.log(`[sync-digital-human] 已写入 ${manifestPath}（${serialized.length} 条）`);

  if (serialized.length === 0) {
    console.warn('[sync-digital-human] 当前数字人库为空；新安装用户不会自带数字人。请在本机添加后再构建。');
  }
}

main();
