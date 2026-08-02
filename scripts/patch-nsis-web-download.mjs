#!/usr/bin/env node
/**
 * nsis-web 下载进度：用仓库内 build/webPackage.nsh 覆盖 electron-builder 模板，
 * 并校验 build/x86-unicode/INetC.dll（≥1.0.5.7，修复 >2GB 负百分比）。
 *
 * electron-builder 会自动 !addplugindir build/x86-unicode，优先加载用户插件。
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const src = path.join(root, 'build', 'webPackage.nsh');
const inetcDll = path.join(root, 'build', 'x86-unicode', 'INetC.dll');
const dest = path.join(
  root,
  'node_modules',
  'app-builder-lib',
  'templates',
  'nsis',
  'include',
  'webPackage.nsh',
);

function fail(msg) {
  console.error(`[patch-nsis-web-download] ${msg}`);
  process.exit(1);
}

if (!fs.existsSync(src)) {
  fail(`缺少 ${src}`);
}
if (!fs.existsSync(inetcDll)) {
  fail(
    `缺少 ${inetcDll}（INetC ≥1.0.5.7）。请从 https://github.com/DigitalMediaServer/NSIS-INetC-plugin/releases/tag/v1.0.5.7 取得 x86-unicode/INetC.dll`,
  );
}

if (!fs.existsSync(dest)) {
  fail(`未找到 electron-builder 模板: ${dest}（请先 npm install）`);
}

const body = fs.readFileSync(src, 'utf8');
if (!body.includes('!macro downloadApplicationFiles')) {
  fail('build/webPackage.nsh 未定义 downloadApplicationFiles');
}
if (!body.includes('AixflowHideNativeInstProgress')) {
  fail('build/webPackage.nsh 缺少幽灵进度条隐藏逻辑');
}
if (/nsExec::ExecToStack\s+'powershell/i.test(body) || body.includes('Invoke-WebRequest')) {
  fail('build/webPackage.nsh 仍含 PowerShell HEAD 体积探测（会污染下载标题）');
}
if (!body.includes('正在下载 Aixflow 安装包')) {
  fail('build/webPackage.nsh 缺少固定下载标题文案');
}
if (!body.includes('AIXFLOW_OSS_BJ_UPLOADS') || !body.includes('packageUrlAlt')) {
  fail('build/webPackage.nsh 缺少香港/北京镜像回退逻辑');
}

fs.copyFileSync(src, dest);
const st = fs.statSync(inetcDll);
console.log(
  `[patch-nsis-web-download] 已覆盖 webPackage.nsh；INetC.dll ${st.size} bytes @ build/x86-unicode/`,
);
