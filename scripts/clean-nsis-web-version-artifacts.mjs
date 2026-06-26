#!/usr/bin/env node
/** 打包前删除当前版本的 nsis-web 产物，避免多次 electron-builder 导致 yml 与 7z 校验不一致 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const releaseDir = path.join(__dirname, '..', 'release');
const nsisWebDir = path.join(releaseDir, 'nsis-web');

function readVersion() {
  const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf-8'));
  return pkg.version || '0.0.0';
}

function main() {
  if (!fs.existsSync(nsisWebDir)) return;
  const version = readVersion();
  const patterns = [
    `nexflow-${version}-x64.nsis.7z`,
    `Aixflow-Windows-Setup-${version}.exe`,
    `Aixflow-Bate-Windows-Setup-${version}.exe`,
    `Aixflow-Windows-Offline-${version}.zip`,
    `Aixflow-Windows-Offline-${version}`,
    'latest.yml',
    '__uninstaller-nsis-web-nexflow.exe',
  ];
  for (const name of patterns) {
    for (const dir of [nsisWebDir, releaseDir]) {
      const p = path.join(dir, name);
      if (!fs.existsSync(p)) continue;
      if (fs.statSync(p).isDirectory()) {
        fs.rmSync(p, { recursive: true, force: true });
      } else {
        fs.unlinkSync(p);
      }
      console.log('[clean-nsis-web] 已删除', path.relative(releaseDir, p));
    }
  }
}

main();
