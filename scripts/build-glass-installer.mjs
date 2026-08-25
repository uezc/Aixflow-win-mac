#!/usr/bin/env node
/**
 * 构建轻量玻璃拟态本机安装器 → release/glass-installer/Aixflow-Installer-{version}.exe
 *
 * 用法: node scripts/build-glass-installer.mjs
 */
import { spawnSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const version = pkg.version;

function run(cmd, args, opts = {}) {
  console.log(`[build-glass-installer] $ ${cmd} ${args.join(' ')}`);
  const r = spawnSync(cmd, args, {
    cwd: root,
    stdio: 'inherit',
    shell: process.platform === 'win32',
    env: { ...process.env, ...opts.env },
  });
  if (r.status !== 0) {
    process.exit(r.status || 1);
  }
}

function main() {
  const outDir = path.join(root, 'dist-glass-installer');
  if (fs.existsSync(outDir)) {
    fs.rmSync(outDir, { recursive: true, force: true });
  }

  // 1) UI
  run('npx', ['vite', 'build', '--config', 'vite.glass-installer.config.ts']);

  // 2) main (ESM) + preload (CJS — Electron contextBridge 需 CommonJS)
  run('npx', ['tsc', '-p', 'tsconfig.glass-installer.json']);
  run('npx', ['tsc', '-p', 'tsconfig.glass-installer.preload.json']);

  fs.writeFileSync(
    path.join(outDir, 'package.json'),
    JSON.stringify({ name: 'aixflow-installer', type: 'module', main: 'main/index.js', version }, null, 2),
  );
  // 覆盖父级 "type":"module"，否则 asar 内 preload 的 .js 会被当成 ESM 而静默失败
  fs.writeFileSync(
    path.join(outDir, 'preload', 'package.json'),
    JSON.stringify({ type: 'commonjs' }, null, 2),
  );

  // 3) portable exe
  run('npx', [
    'electron-builder',
    '--win',
    'portable',
    '--x64',
    '--config',
    'electron-builder.installer.yml',
  ]);

  const exeName = `Aixflow-Installer-${version}.exe`;
  const exePath = path.join(root, 'release', 'glass-installer', exeName);
  // electron-builder 有时把 portable 放在 release/glass-installer 或带 arch 后缀
  const candidates = [
    exePath,
    path.join(root, 'release', 'glass-installer', `Aixflow Installer ${version}.exe`),
    path.join(root, 'release', 'glass-installer', `Aixflow-Installer-${version}-x64.exe`),
  ];
  let found = candidates.find((p) => fs.existsSync(p));
  if (!found) {
    const dir = path.join(root, 'release', 'glass-installer');
    if (fs.existsSync(dir)) {
      const hit = fs.readdirSync(dir).find((n) => /Aixflow.*Installer.*\.exe$/i.test(n));
      if (hit) found = path.join(dir, hit);
    }
  }
  if (!found) {
    console.error('[build-glass-installer] 未找到产物 exe，请检查 release/glass-installer/');
    process.exit(1);
  }
  if (found !== exePath) {
    fs.mkdirSync(path.dirname(exePath), { recursive: true });
    fs.copyFileSync(found, exePath);
    console.log(`[build-glass-installer] 已规范命名 → ${exePath}`);
  }

  // 同步到 release/ 根，便于 upload-release 发现
  const rootCopy = path.join(root, 'release', exeName);
  fs.copyFileSync(exePath, rootCopy);

  const mb = (fs.statSync(exePath).size / 1024 / 1024).toFixed(1);
  console.log(`[build-glass-installer] 完成: ${exePath} (${mb} MB)`);
  console.log(`[build-glass-installer] 亦已复制到: ${rootCopy}`);
}

main();
