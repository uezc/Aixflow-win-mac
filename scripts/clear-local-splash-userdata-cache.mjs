#!/usr/bin/env node
/**
 * 打包前清除本机片头 userData 缓存，避免旧 A.mp4 等残留影响本地验证。
 * 安装包内容来自项目 splash-videos/ → resources/splash-videos/，与此缓存无关；
 * 但开发/本机安装后启动会优先读 userData/splash-videos，故构建时一并清空。
 *
 * 与 src/main/services/store.ts 一致：userData 固定为 %APPDATA%/NEXFLOW
 */
import fs from 'fs';
import os from 'os';
import path from 'path';

const MEDIA_EXT = new Set([
  '.mp4', '.webm', '.mov', '.avi', '.mkv',
  '.mp3',
  '.png', '.jpg', '.jpeg', '.webp', '.svg',
]);

function isSplashMedia(name) {
  return MEDIA_EXT.has(path.extname(name).toLowerCase());
}

function clearSplashDir(dir) {
  if (!fs.existsSync(dir)) return 0;
  let n = 0;
  for (const name of fs.readdirSync(dir)) {
    if (!isSplashMedia(name)) continue;
    try {
      fs.unlinkSync(path.join(dir, name));
      console.log('[clear-splash-cache] 已删除:', path.join(dir, name));
      n++;
    } catch (e) {
      console.warn('[clear-splash-cache] 删除失败:', path.join(dir, name), e?.message || e);
    }
  }
  return n;
}

function splashDirsOnThisMachine() {
  const appData =
    process.env.APPDATA ||
    (process.platform === 'darwin'
      ? path.join(os.homedir(), 'Library', 'Application Support')
      : path.join(os.homedir(), '.config'));

  /** 与 store.ts 一致；其余为历史/误传路径，顺带清理 */
  const appNames = ['NEXFLOW', 'nexflow', 'Aixflow'];
  const dirs = appNames.map((name) => path.join(appData, name, 'splash-videos'));
  return [...new Set(dirs)];
}

const dirs = splashDirsOnThisMachine();
let total = 0;
for (const dir of dirs) {
  total += clearSplashDir(dir);
}

if (total === 0) {
  console.log('[clear-splash-cache] 本机无片头 userData 缓存（或目录不存在），跳过');
} else {
  console.log(`[clear-splash-cache] 共清除 ${total} 个片头缓存文件；下次启动将从安装包/项目 splash-videos 重新同步`);
}
