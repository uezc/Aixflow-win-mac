#!/usr/bin/env node
/**
 * 构建前将 yt-dlp 官方二进制放入 resources/yt-dlp/，与主进程 extraResources 路径一致。
 *
 * 国内构建机常无法直连 GitHub，可任选：
 * - 环境变量 NEXFLOW_YTDLP_GITHUB_PROXY：在「完整 GitHub URL」前拼接代理前缀（见下方示例）；
 * - 环境变量 NEXFLOW_YTDLP_RELEASE_BASE：自定义「…/releases/latest/download」这一级的基础 URL；
 * - 环境变量 YT_DLP_DOWNLOAD_URL：当前平台要下载的文件的完整 URL（最高优先级）；
 * - 从 U 盘/内网拷贝好二进制到 resources/yt-dlp/ 后，使用 npm 脚本中的 --if-missing 跳过下载。
 */
import fs from 'fs';
import https from 'https';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.join(__dirname, '..');
const destDir = path.join(projectRoot, 'resources', 'yt-dlp');

const MIN_BYTES = 50_000;

/** @returns {{ filename: string; outName: string }} */
function assetForPlatform() {
  const { platform, arch } = process;
  if (platform === 'win32') {
    if (arch === 'arm64') return { filename: 'yt-dlp_arm64.exe', outName: 'yt-dlp.exe' };
    return { filename: 'yt-dlp.exe', outName: 'yt-dlp.exe' };
  }
  if (platform === 'darwin') return { filename: 'yt-dlp_macos', outName: 'yt-dlp' };
  if (platform === 'linux') {
    if (arch === 'arm64') return { filename: 'yt-dlp_linux_aarch64', outName: 'yt-dlp' };
    return { filename: 'yt-dlp_linux', outName: 'yt-dlp' };
  }
  throw new Error(`[copy-yt-dlp] 不支持的平台: ${platform}/${arch}`);
}

/** 官方直链中的路径段（不含域名），便于拼接镜像 */
function canonicalPath(filename) {
  return `https://github.com/yt-dlp/yt-dlp/releases/latest/download/${filename}`;
}

function resolveDownloadUrl(filename) {
  const full = process.env.YT_DLP_DOWNLOAD_URL?.trim();
  if (full) return full;

  const customBase = process.env.NEXFLOW_YTDLP_RELEASE_BASE?.trim();
  if (customBase) {
    return `${customBase.replace(/\/$/, '')}/${filename}`;
  }

  const proxy = process.env.NEXFLOW_YTDLP_GITHUB_PROXY?.trim();
  const canonical = canonicalPath(filename);
  if (proxy) {
    const p = proxy.endsWith('/') ? proxy : `${proxy}/`;
    return `${p}${canonical}`;
  }
  return canonical;
}

/** 跟随重定向下载 */
function downloadToBuffer(urlString) {
  return new Promise((resolve, reject) => {
    const maxRedirects = 8;
    const get = (urlStr, depth) => {
      if (depth > maxRedirects) {
        reject(new Error('[copy-yt-dlp] 重定向过多'));
        return;
      }
      const u = new URL(urlStr);
      const req = https.request(
        {
          hostname: u.hostname,
          path: u.pathname + u.search,
          method: 'GET',
          headers: { 'User-Agent': 'NEXFLOW-build/copy-yt-dlp' },
        },
        (res) => {
          const loc = res.headers.location;
          if (loc && [301, 302, 303, 307, 308].includes(res.statusCode)) {
            res.resume();
            get(new URL(loc, urlStr).href, depth + 1);
            return;
          }
          if (res.statusCode !== 200) {
            res.resume();
            reject(new Error(`HTTP ${res.statusCode}: ${urlStr}`));
            return;
          }
          const chunks = [];
          res.on('data', (c) => chunks.push(c));
          res.on('end', () => resolve(Buffer.concat(chunks)));
          res.on('error', reject);
        }
      );
      req.on('error', reject);
      req.end();
    };
    get(urlString, 0);
  });
}

async function downloadToFile(url, destPath) {
  let buf;
  try {
    buf = await downloadToBuffer(url);
  } catch (e) {
    if (typeof fetch === 'function') {
      const res = await fetch(url, { redirect: 'follow' });
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${url}`);
      buf = Buffer.from(await res.arrayBuffer());
    } else {
      throw e;
    }
  }
  if (buf.length < MIN_BYTES) {
    throw new Error(`[copy-yt-dlp] 下载内容过小 (${buf.length} bytes)，可能不是有效二进制: ${url}`);
  }
  fs.mkdirSync(path.dirname(destPath), { recursive: true });
  fs.writeFileSync(destPath, buf);
}

function printChinaHint() {
  console.error('');
  console.error('[copy-yt-dlp] 若构建机在国内无法访问 GitHub，可选用其一：');
  console.error('  1) 设置镜像前缀（示例，以你司可用代理为准，域名会变更）：');
  console.error('     set NEXFLOW_YTDLP_GITHUB_PROXY=https://ghproxy.net/');
  console.error('     （将拼接为：代理 + https://github.com/yt-dlp/yt-dlp/releases/latest/download/…）');
  console.error('  2) 整段替换下载基址：');
  console.error('     set NEXFLOW_YTDLP_RELEASE_BASE=https://你的镜像/yt-dlp/yt-dlp/releases/latest/download');
  console.error('  3) 指定单个文件完整 URL：set YT_DLP_DOWNLOAD_URL=https://…/yt-dlp.exe');
  console.error('  4) 从浏览器/内网盘下载同名文件放到：');
  console.error(`     ${destDir}`);
  console.error('     然后执行：npm run copy-yt-dlp（package.json 已带 --if-missing，有文件则跳过下载）');
  console.error('');
}

async function main() {
  const ifMissing = process.argv.includes('--if-missing');
  const { filename, outName } = assetForPlatform();
  const destPath = path.join(destDir, outName);
  const url = resolveDownloadUrl(filename);

  if (ifMissing && fs.existsSync(destPath)) {
    const st = fs.statSync(destPath);
    if (st.size >= MIN_BYTES) {
      console.log(`[copy-yt-dlp] 已存在有效文件，跳过下载: ${destPath} (${(st.size / 1024 / 1024).toFixed(2)} MB)`);
      return;
    }
  }

  console.log(`[copy-yt-dlp] 下载: ${url}`);
  try {
    await downloadToFile(url, destPath);
  } catch (e) {
    console.error('[copy-yt-dlp] 下载失败:', e.message || e);
    printChinaHint();
    if (ifMissing) {
      console.error('[copy-yt-dlp] 未找到可跳过的本地文件且下载失败，退出码 1。');
    }
    process.exit(1);
  }

  if (process.platform !== 'win32') {
    try {
      fs.chmodSync(destPath, 0o755);
    } catch {
      /* ignore */
    }
  }
  const stat = fs.statSync(destPath);
  console.log(`[copy-yt-dlp] 已写入 ${destPath} (${(stat.size / 1024 / 1024).toFixed(2)} MB)`);
}

main().catch((e) => {
  console.error(e.message || e);
  printChinaHint();
  process.exit(1);
});
