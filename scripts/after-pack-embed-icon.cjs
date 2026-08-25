'use strict';
/**
 * electron-builder afterPack：将 build/icon.ico 写入 Aixflow.exe（任务栏/桌面快捷方式依赖 exe 内嵌 icon）。
 * 使用 npm `rcedit` 本地二进制，避免 app-builder 拉取 winCodeSign（Windows 无 symlink 权限时解压失败）。
 */
const fs = require('fs');
const path = require('path');

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== 'win32') return;

  const projectDir = context.packager.projectDir;
  const icon = path.join(projectDir, 'build', 'icon.ico');
  if (!fs.existsSync(icon)) {
    throw new Error(`[afterPack] 缺少 ${icon}，请先 npm run convert-icon:force`);
  }

  const productName = context.packager.appInfo.productName || 'Aixflow';
  const version = context.packager.appInfo.version || '0.0.0';
  const exe = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.exe`);
  if (!fs.existsSync(exe)) {
    throw new Error(`[afterPack] 未找到可执行文件: ${exe}`);
  }

  const rcedit = require('rcedit');
  console.log(`[afterPack] 写入 exe 图标: ${exe}`);
  await rcedit(exe, {
    'version-string': {
      FileDescription: productName,
      ProductName: productName,
    },
    'file-version': version,
    'product-version': version,
    icon,
  });
  console.log('[afterPack] exe 图标已嵌入');
};
