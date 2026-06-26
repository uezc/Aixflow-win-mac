'use strict';
/**
 * electron-builder afterPack：将 build/icon.ico 写入 Aixflow.exe（任务栏/桌面快捷方式依赖 exe 内嵌 icon）。
 * 保留 win.signAndEditExecutable=false，避免 winCodeSign 在 Windows 上解压符号链接失败。
 * 使用与 electron-builder 相同的 app-builder rcedit，比 npm rcedit 更稳定。
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

  const args = [
    exe,
    '--set-version-string',
    'FileDescription',
    productName,
    '--set-version-string',
    'ProductName',
    productName,
    '--set-file-version',
    version,
    '--set-product-version',
    version,
    '--set-icon',
    icon,
  ];

  const { executeAppBuilder } = require('builder-util');
  console.log(`[afterPack] 写入 exe 图标: ${exe}`);
  await executeAppBuilder(['rcedit', '--args', JSON.stringify(args)], undefined, {}, 3);
  console.log('[afterPack] exe 图标已嵌入');
};
