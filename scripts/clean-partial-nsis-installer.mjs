#!/usr/bin/env node
/**
 * 删除 NSIS 打包失败残留的 stub 安装包（通常仅数百 KB，无法运行）。
 * 在 electron-builder 之前执行，避免误用损坏的 exe。
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const releaseDir = path.join(__dirname, '..', 'release');
const MIN_VALID_INSTALLER_BYTES = 80 * 1024 * 1024; // 80MB，正常安装包为 1GB+

function readVersion() {
  const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf-8'));
  return pkg.version || '0.0.0';
}

function main() {
  if (!fs.existsSync(releaseDir)) return;
  const version = readVersion();
  const candidates = [
    `Aixflow-Bate-Windows-Setup-${version}.exe`,
    `Aixflow-Windows-Setup-${version}.exe`,
  ];
  for (const name of candidates) {
    const p = path.join(releaseDir, name);
    if (!fs.existsSync(p)) continue;
    const size = fs.statSync(p).size;
    if (size >= MIN_VALID_INSTALLER_BYTES) continue;
    fs.unlinkSync(p);
    console.log(`[clean-partial-nsis] 已删除损坏的安装包 stub (${Math.round(size / 1024)} KB): ${name}`);
  }
  const uninst = path.join(releaseDir, '__uninstaller-nsis-nexflow.exe');
  if (fs.existsSync(uninst)) {
    try {
      fs.unlinkSync(uninst);
      console.log('[clean-partial-nsis] 已删除未完成的 __uninstaller-nsis-nexflow.exe');
    } catch {
      /* ignore */
    }
  }
}

main();
