#!/usr/bin/env node
/**
 * 构建前同步：将仓库根目录 splash-videos/ 复制到 resources/splash-videos/，
 * 供 extraResources 打入安装包（开发时读根目录，打包读 resources）。
 */
import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.join(__dirname, '..');
const srcDir = path.join(projectRoot, 'splash-videos');
const destDir = path.join(projectRoot, 'resources', 'splash-videos');
const sharedLoginLogo = path.join(projectRoot, 'public', 'aixflow-login-logo.png');
const splashLogoPng = path.join(srcDir, 'logo.png');
const legacySplashSvg = path.join(srcDir, 'logo.svg');

function copyFile(src, dest) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);
}

/** 与登录页共用 public/aixflow-login-logo.png，避免片头仍读旧 logo.svg */
function syncSharedLoginLogoToSplash() {
  if (!fs.existsSync(sharedLoginLogo)) return;
  fs.mkdirSync(srcDir, { recursive: true });
  copyFile(sharedLoginLogo, splashLogoPng);
  if (fs.existsSync(legacySplashSvg)) {
    fs.unlinkSync(legacySplashSvg);
    console.log('[sync-splash-videos] 已移除旧 splash-videos/logo.svg，改用 logo.png');
  }
  console.log('[sync-splash-videos] 已同步 public/aixflow-login-logo.png -> splash-videos/logo.png');
}

syncSharedLoginLogoToSplash();

const MEDIA_EXT = new Set([
  '.mp4', '.webm', '.mov', '.avi', '.mkv',
  '.mp3',
  '.png', '.jpg', '.jpeg', '.webp', '.svg',
]);

if (!fs.existsSync(srcDir)) {
  console.warn('[sync-splash-videos] 源目录不存在，跳过:', srcDir);
  process.exit(0);
}

fs.mkdirSync(destDir, { recursive: true });
if (fs.existsSync(path.join(destDir, 'logo.svg'))) {
  fs.unlinkSync(path.join(destDir, 'logo.svg'));
}

/** 源目录有的媒体文件名（构建目标应与 splash-videos/ 完全一致，避免残留旧 A.mp4 等被打进安装包） */
const srcMediaNames = new Set(
  fs.existsSync(srcDir)
    ? fs
        .readdirSync(srcDir)
        .filter((name) => {
          const ext = path.extname(name).toLowerCase();
          if (!MEDIA_EXT.has(ext)) return false;
          return fs.statSync(path.join(srcDir, name)).isFile();
        })
    : [],
);

for (const name of fs.readdirSync(destDir)) {
  if (name === 'README.txt') continue;
  const ext = path.extname(name).toLowerCase();
  if (!MEDIA_EXT.has(ext)) continue;
  if (srcMediaNames.has(name)) continue;
  try {
    fs.unlinkSync(path.join(destDir, name));
    console.log('[sync-splash-videos] 已移除 resources 中过期的片头文件:', name);
  } catch {
    /* ignore */
  }
}

const names = fs.readdirSync(srcDir);
let copied = 0;
for (const name of names) {
  const ext = path.extname(name).toLowerCase();
  if (!MEDIA_EXT.has(ext)) continue;
  const src = path.join(srcDir, name);
  if (!fs.statSync(src).isFile()) continue;
  copyFile(src, path.join(destDir, name));
  copied++;
}

console.log(`[sync-splash-videos] 已从 splash-videos/ 同步 ${copied} 个媒体文件到 resources/splash-videos/`);

/** 打包机本机 userData 片头缓存清掉，避免装包后仍播旧 A.mp4 等 */
const clearRes = spawnSync(process.execPath, [path.join(__dirname, 'clear-local-splash-userdata-cache.mjs')], {
  stdio: 'inherit',
  cwd: projectRoot,
});
if (clearRes.status !== 0) {
  console.warn('[sync-splash-videos] 清除本机片头 userData 缓存未完全成功（可继续打包）');
}
