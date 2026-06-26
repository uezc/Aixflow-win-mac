#!/usr/bin/env node
/**
 * 发版安装包：每次构建前必须先输入版本（不可空回车），写入 package.json 后再执行 npm run electron:build。
 * 日常开发打调试包请直接用 npm run electron:build（不询问版本）。
 */

import readline from 'readline';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.join(__dirname, '..');
const packagePath = path.join(projectRoot, 'package.json');

function prompt(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer?.trim() || '');
    });
  });
}

function runCommand(cmd, args, cwd = projectRoot) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      cwd,
      stdio: 'inherit',
      shell: true,
    });
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`命令退出码: ${code}`));
    });
    child.on('error', reject);
  });
}

function updateVersion(newVersion) {
  const pkg = JSON.parse(fs.readFileSync(packagePath, 'utf-8'));
  pkg.version = newVersion;
  fs.writeFileSync(packagePath, JSON.stringify(pkg, null, 2) + '\n');
}

function isValidVersion(v) {
  return /^\d+\.\d+\.\d+(-[a-zA-Z0-9.]+)?$/.test(v);
}

function bumpSemver(version, part) {
  const m = version.match(/^(\d+)\.(\d+)\.(\d+)(.*)$/);
  if (!m) return version;
  let major = parseInt(m[1], 10);
  let minor = parseInt(m[2], 10);
  let patch = parseInt(m[3], 10);
  const suffix = m[4] || '';
  if (part === 'major') {
    major += 1;
    minor = 0;
    patch = 0;
  } else if (part === 'minor') {
    minor += 1;
    patch = 0;
  } else {
    patch += 1;
  }
  return `${major}.${minor}.${patch}${suffix}`;
}

async function resolveVersionInteractive(currentVersion) {
  console.log('\n=== 安装包构建：须先输入版本号 ===\n');
  console.log('请输入 patch / minor / major 或完整 x.y.z（不可回车跳过）\n');

  while (true) {
    const input = await prompt(`当前 package.json 版本: ${currentVersion}\n请输入 [patch | minor | major | x.y.z]: `);
    if (!input) {
      console.log('[electron:build:release] 必须输入版本号。\n');
      continue;
    }
    const lower = input.toLowerCase();
    if (lower === 'patch' || lower === 'minor' || lower === 'major') {
      return bumpSemver(currentVersion, lower);
    }
    if (isValidVersion(input)) {
      return input;
    }
    console.log('[electron:build:release] 无效输入。须为 x.y.z 或 patch / minor / major。\n');
  }
}

async function main() {
  const pkg = JSON.parse(fs.readFileSync(packagePath, 'utf-8'));
  const before = pkg.version;
  const next = await resolveVersionInteractive(before);

  if (next !== before) {
    console.log(`\n[electron:build:release] 版本: ${before} → ${next}`);
    updateVersion(next);
  } else {
    console.log(`\n[electron:build:release] 版本保持: ${next}（与 package.json 一致，将重新构建）`);
  }

  console.log('\n[electron:build:release] 执行 npm run electron:build ...\n');
  await runCommand('npm', ['run', 'electron:build']);
  console.log('\n[electron:build:release] 构建结束。\n');
}

main().catch((err) => {
  console.error('[electron:build:release] 失败:', err.message);
  process.exit(1);
});
