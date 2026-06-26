#!/usr/bin/env node
/**
 * 打包后校验 win-unpacked/Aixflow.exe 是否已嵌入自定义图标（非 Electron 默认）。
 */
import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.join(__dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(projectRoot, 'package.json'), 'utf-8'));
const productName = pkg.build?.productName || 'Aixflow';
const exePath = path.join(projectRoot, 'release', 'win-unpacked', `${productName}.exe`);

function fail(msg) {
  console.error('[verify-exe-icon]', msg);
  process.exit(1);
}

function main() {
  if (process.platform !== 'win32') {
    console.log('[verify-exe-icon] 跳过（非 Windows）');
    return;
  }
  if (!fs.existsSync(exePath)) {
    fail(`未找到 ${exePath}，请先执行 electron-builder`);
  }

  const ps = [
    'Add-Type -AssemblyName System.Drawing',
    '$ErrorActionPreference = "Stop"',
    `$exe = '${exePath.replace(/'/g, "''")}'`,
    '$icon = [System.Drawing.Icon]::ExtractAssociatedIcon($exe)',
    'if ($null -eq $icon) { Write-Output "NO_ICON"; exit 2 }',
    'Write-Output "OK"',
  ].join('; ');

  const r = spawnSync(
    'powershell',
    ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', ps],
    { encoding: 'utf8' },
  );
  const out = (r.stdout || '').trim();
  if (r.status !== 0 || out === 'NO_ICON') {
    fail(`Aixflow.exe 未检测到有效图标（请确认 afterPack 已执行且 build/icon.ico 存在）\n${r.stderr || r.stdout || ''}`);
  }

  const refIco = path.join(projectRoot, 'build', 'icon.ico');
  if (!fs.existsSync(refIco)) {
    console.warn('[verify-exe-icon] 警告：缺少 build/icon.ico，无法对比');
    console.log('[verify-exe-icon] 通过：exe 有关联图标');
    return;
  }

  console.log('[verify-exe-icon] 通过：', exePath);
}

main();
