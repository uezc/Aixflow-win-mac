#!/usr/bin/env node
/**
 * 打包「傻瓜式离线安装」：将 stub exe + .nsis.7z + 说明放入 release/Aixflow-Windows-Offline-{version}/
 * 可选再打成 zip（Windows 自带 tar，避免 PowerShell Compress-Archive 的 2GB 限制）。
 */
import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.join(__dirname, '..');
const releaseDir = path.join(projectRoot, 'release');
const nsisWebDir = path.join(releaseDir, 'nsis-web');

function readVersion() {
  const pkg = JSON.parse(fs.readFileSync(path.join(projectRoot, 'package.json'), 'utf-8'));
  return pkg.version || '0.0.0';
}

function tryCreateZipWithTar(stagingDir, zipPath) {
  if (fs.existsSync(zipPath)) fs.unlinkSync(zipPath);
  const cwd = stagingDir;
  const r = spawnSync('tar', ['-a', '-cf', zipPath, '.'], {
    cwd,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
  if (r.status !== 0 || !fs.existsSync(zipPath)) {
    return false;
  }
  return true;
}

function main() {
  const version = readVersion();
  const stubName = `Aixflow-Windows-Setup-${version}.exe`;
  const packName = `nexflow-${version}-x64.nsis.7z`;
  const stubPath = path.join(nsisWebDir, stubName);
  const packPath = path.join(nsisWebDir, packName);

  if (!fs.existsSync(stubPath) || !fs.existsSync(packPath)) {
    console.error('[pack-offline] 缺少 nsis-web 产物，请先完整执行 npm run electron:build');
    console.error('  需要:', stubPath);
    console.error('  需要:', packPath);
    process.exit(1);
  }

  const offlineName = `Aixflow-Windows-Offline-${version}`;
  const offlineDir = path.join(releaseDir, offlineName);
  const zipPath = path.join(releaseDir, `${offlineName}.zip`);
  const readme = [
    'Aixflow Windows 离线安装包',
    '====================',
    '',
    '【方式一】直接使用本文件夹（推荐）',
    '1. 确认本文件夹内同时有安装程序 exe 与 .nsis.7z',
    '2. 右键 exe → 以管理员身份运行，按向导完成安装',
    '',
    '【方式二】若你下载的是 zip',
    '1. 解压 zip 到任意文件夹（建议 D 盘等非系统盘），确保 exe 与 .7z 在同一目录',
    '2. 右键 exe → 以管理员身份运行',
    '',
    '本目录应包含：',
    `  - ${stubName}`,
    `  - ${packName}`,
    '',
    '注意：',
    '  • 勿只复制 exe 而漏掉 .7z',
    '  • 安装时会在系统盘 Temp 解压约 2GB 数据，C 盘建议剩余 15GB 以上',
    '  • 从官网在线安装时只需下载 exe（安装过程需联网拉取 .7z）',
    '',
    '若报错「抽取: 无法写入文件 … WinShell.dll」请按顺序尝试：',
    '  1. 任务管理器结束所有 Aixflow.exe 与 Aixflow-Windows-Setup*.exe',
    '  2. Win+R 输入 %TEMP% ，删除所有 nst*.tmp / nsw*.tmp 文件夹',
    '  3. 暂时关闭杀毒/安全软件实时防护，或将安装包目录加入白名单',
    '  4. 确认 C 盘空间充足后，右键「以管理员身份运行」安装程序',
    '  5. C 盘空间不足时：先建 D:\\AixflowTemp ，再在 cmd 中执行：',
    '       set TEMP=D:\\AixflowTemp',
    '       set TMP=D:\\AixflowTemp',
    `       ${stubName}`,
    '',
  ].join('\r\n');

  if (fs.existsSync(offlineDir)) {
    fs.rmSync(offlineDir, { recursive: true, force: true });
  }
  fs.mkdirSync(offlineDir, { recursive: true });
  fs.copyFileSync(stubPath, path.join(offlineDir, stubName));
  fs.copyFileSync(packPath, path.join(offlineDir, packName));
  fs.writeFileSync(path.join(offlineDir, '安装说明.txt'), readme, 'utf8');

  const packMb = (fs.statSync(packPath).size / 1024 / 1024).toFixed(0);
  console.log(`[pack-offline] 已生成离线安装目录: ${offlineDir} (含约 ${packMb} MB 的 .7z)`);

  if (process.platform !== 'win32') {
    console.log('[pack-offline] 非 Windows，跳过 zip（可直接分发上述文件夹）');
    return;
  }

  console.log('[pack-offline] 正在用 tar 打包 zip（支持 >2GB，请勿中断）…');
  const zipped = tryCreateZipWithTar(offlineDir, zipPath);
  if (zipped) {
    const zipMb = (fs.statSync(zipPath).size / 1024 / 1024).toFixed(0);
    console.log(`[pack-offline] 已生成离线 zip（供 OSS/官网）: ${zipPath} (${zipMb} MB)`);
    return;
  }

  console.warn(
    '[pack-offline] zip 打包失败（可忽略）：请直接使用离线目录安装，或手动用 7-Zip 压缩该目录后上传 OSS。',
  );
  if (fs.existsSync(zipPath)) {
    try {
      fs.unlinkSync(zipPath);
    } catch {
      /* ignore partial zip */
    }
  }
}

main();
