#!/usr/bin/env node
/**
 * 一键发布：在 Windows 上构建 Windows（单文件 NSIS 完整安装包）并上传到 OSS。
 * Mac 安装包须在 macOS 上单独 electron:build，再单独 upload:release。
 *
 * 使用方式：
 *   npm run release                    交互：须输入 patch / minor / major 或完整 x.y.z（不允许空回车）
 *   npm run release -- --current       无版本提示，直接按 package.json 当前 version 构建 + 上传（供脚本/CI）
 *   npm run release -- --patch         自动 patch+1 后构建 + 上传
 *   npm run release -- --minor         自动 minor+1
 *   npm run release -- --major         自动 major+1
 *
 * 流程：按需更新 package.json 的 version → electron:build → upload:release（带 --no-confirm，避免上传二次确认）
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
  const oldVersion = pkg.version;
  pkg.version = newVersion;
  fs.writeFileSync(packagePath, JSON.stringify(pkg, null, 2) + '\n');
  return oldVersion;
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

function parseCliMode(argv) {
  if (argv.includes('--current') || argv.includes('--no-bump')) return 'current';
  if (argv.includes('--patch')) return 'patch';
  if (argv.includes('--minor')) return 'minor';
  if (argv.includes('--major')) return 'major';
  return null;
}

async function resolveTargetVersion(currentVersion, cliMode) {
  if (cliMode === 'current') return { version: currentVersion, bump: false };
  if (cliMode === 'patch' || cliMode === 'minor' || cliMode === 'major') {
    return { version: bumpSemver(currentVersion, cliMode), bump: true };
  }

  console.log('\n=== Aixflow-Bate 一键发布（仅 Windows 安装包）===\n');
  console.log('请先输入本次发布版本（不可回车跳过）：');
  console.log('  • patch / minor / major — 在当前版本上递增对应 semver 段');
  console.log('  • 或输入完整版本号，如 1.1.3（须与将写入 package.json 的版本一致）\n');

  let input = '';
  while (true) {
    input = await prompt(`当前 package.json 版本: ${currentVersion}\n请输入 [patch | minor | major | x.y.z]: `);
    if (!input) {
      console.log('[release] 必须输入版本：请键入 patch / minor / major 或完整 x.y.z；若不想改版本请使用 npm run release -- --current\n');
      continue;
    }
    const lower = input.toLowerCase();
    if (lower === 'patch' || lower === 'minor' || lower === 'major') {
      return { version: bumpSemver(currentVersion, lower), bump: true };
    }
    if (isValidVersion(input)) {
      return { version: input, bump: input !== currentVersion };
    }
    console.log('[release] 无效输入。版本号须为 x.y.z，或使用 patch / minor / major。\n');
  }
}

async function main() {
  const argv = process.argv.slice(2);
  const cliMode = parseCliMode(argv);

  const pkg = JSON.parse(fs.readFileSync(packagePath, 'utf-8'));
  const currentVersion = pkg.version;

  const { version, bump } = await resolveTargetVersion(currentVersion, cliMode);

  if (bump && version !== currentVersion) {
    console.log(`\n[release] 将更新版本: ${currentVersion} → ${version}`);
    updateVersion(version);
  } else {
    console.log(`\n[release] 沿用版本: ${version}（未修改 package.json）`);
  }

  const rollbackTo = currentVersion;

  try {
    console.log('\n[release] 步骤 1/2: 构建安装包...\n');
    await runCommand('npm', ['run', 'electron:build']);

    console.log('\n[release] 步骤 2/2: 上传到 OSS...\n');
    await runCommand('npm', ['run', 'upload:release', '--', '--no-confirm']);

    console.log('\n[release] 完成！版本', version, '已发布。\n');
  } catch (err) {
    console.error('\n[release] 失败:', err.message);
    if (bump && version !== rollbackTo) {
      console.log('[release] 已回滚 package.json 版本');
      updateVersion(rollbackTo);
    }
    process.exit(1);
  }
}

main();
