#!/usr/bin/env node
/**
 * 构建前将 whisper.cpp 用 ggml 模型放入 resources/whisper/，与 extraResources → whisper 一致。
 *
 * 默认下载 ggml-base.bin（体积与识别质量折中）。可通过环境变量改为 tiny/small：
 *   set NEXFLOW_WHISPER_BUNDLE_MODEL=tiny
 *
 * 国内构建机无法直连 HuggingFace 时：
 *   set WHISPER_MODEL_DOWNLOAD_URL=https://…/ggml-base.bin   （整文件直链，最高优先级）
 *   set NEXFLOW_WHISPER_HF_PROXY=https://hf-mirror.com/      （拼在官方 URL 前，末尾可有 /）
 *
 * 已手动放入 resources/whisper/ 下任一受支持文件名时，使用 --if-missing 可跳过下载。
 */
import fs from 'fs';
import http from 'http';
import https from 'https';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.join(__dirname, '..');
const destDir = path.join(projectRoot, 'resources', 'whisper');

/** 与 localResourceManager WHISPER_MODEL_CANDIDATE_NAMES 一致，用于 --if-missing 检测 */
const KNOWN_MODEL_FILES = [
  'ggml-tiny.bin',
  'ggml-base.bin',
  'ggml-small.bin',
  'ggml-medium.bin',
  'ggml-large-v3.bin',
  'ggml-large-v2.bin',
  'ggml-large.bin',
];

const MIN_BYTES = 65_000_000; // ≥ tiny（约 75MB），防止空壳/截断文件

function resolveVariant() {
  const v = (process.env.NEXFLOW_WHISPER_BUNDLE_MODEL || 'base').trim().toLowerCase();
  if (['tiny', 'base', 'small', 'medium'].includes(v)) return v;
  console.warn(`[download-whisper-model] 未知 NEXFLOW_WHISPER_BUNDLE_MODEL="${v}"，改用 base`);
  return 'base';
}

function defaultHfUrl(filename) {
  return `https://huggingface.co/ggerganov/whisper.cpp/resolve/main/${filename}`;
}

function resolveDownloadUrl(filename) {
  const full = process.env.WHISPER_MODEL_DOWNLOAD_URL?.trim();
  if (full) return full;

  const canonical = defaultHfUrl(filename);
  const proxy = process.env.NEXFLOW_WHISPER_HF_PROXY?.trim();
  if (proxy) {
    const p = proxy.endsWith('/') ? proxy : `${proxy}/`;
    return `${p}${canonical}`;
  }
  return canonical;
}

function hasValidLocalModel() {
  if (!fs.existsSync(destDir)) return false;
  for (const name of KNOWN_MODEL_FILES) {
    const p = path.join(destDir, name);
    if (!fs.existsSync(p)) continue;
    try {
      if (fs.statSync(p).size >= MIN_BYTES) return true;
    } catch {
      /* ignore */
    }
  }
  return false;
}

/** 跟随重定向，流式写入磁盘（避免将整模型读入内存） */
function downloadStreamingToFile(urlString, destPath) {
  return new Promise((resolve, reject) => {
    const maxRedirects = 12;
    const tmpPath = `${destPath}.partial`;

    const get = (urlStr, depth) => {
      if (depth > maxRedirects) {
        reject(new Error('[download-whisper-model] 重定向过多'));
        return;
      }
      let u;
      try {
        u = new URL(urlStr);
      } catch (e) {
        reject(e);
        return;
      }
      const lib = u.protocol === 'https:' ? https : http;
      const req = lib.request(
        {
          hostname: u.hostname,
          path: u.pathname + u.search,
          method: 'GET',
          headers: { 'User-Agent': 'NEXFLOW-build/download-whisper-model' },
        },
        (res) => {
          const loc = res.headers.location;
          if (loc && [301, 302, 303, 307, 308].includes(res.statusCode)) {
            res.resume();
            const next = new URL(loc, urlStr).href;
            get(next, depth + 1);
            return;
          }
          if (res.statusCode !== 200) {
            res.resume();
            reject(new Error(`HTTP ${res.statusCode}: ${urlStr}`));
            return;
          }
          fs.mkdirSync(path.dirname(destPath), { recursive: true });
          try {
            if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
          } catch {
            /* ignore */
          }
          const file = fs.createWriteStream(tmpPath);
          res.pipe(file);
          file.on('finish', () => {
            file.close((err) => {
              if (err) {
                reject(err);
                return;
              }
              try {
                const st = fs.statSync(tmpPath);
                if (st.size < MIN_BYTES) {
                  fs.unlinkSync(tmpPath);
                  reject(
                    new Error(
                      `[download-whisper-model] 文件过小 (${st.size} bytes)，疑似下载失败或镜像返回了 HTML`,
                    ),
                  );
                  return;
                }
                fs.renameSync(tmpPath, destPath);
                resolve();
              } catch (e) {
                reject(e);
              }
            });
          });
          file.on('error', (e) => {
            try {
              fs.unlinkSync(tmpPath);
            } catch {
              /* ignore */
            }
            reject(e);
          });
        },
      );
      req.on('error', reject);
      req.end();
    };

    get(urlString, 0);
  });
}

function printHint(destPath) {
  console.error('');
  console.error('[download-whisper-model] 若下载失败，可任选其一：');
  console.error(`  1) 浏览器下载 ggml 模型后放到目录（与安装包一致）：${destDir}`);
  console.error('  2) 设置直链：set WHISPER_MODEL_DOWNLOAD_URL=https://…/ggml-base.bin');
  console.error('  3) 设置 HF 镜像前缀：set NEXFLOW_WHISPER_HF_PROXY=https://hf-mirror.com/');
  console.error(`  4) 已放好有效 .bin 后执行带 --if-missing 的脚本（目标文件：${destPath}）`);
  console.error('');
}

async function main() {
  const ifMissing = process.argv.includes('--if-missing');
  const variant = resolveVariant();
  const filename = `ggml-${variant}.bin`;
  const destPath = path.join(destDir, filename);

  if (ifMissing && hasValidLocalModel()) {
    console.log('[download-whisper-model] resources/whisper 下已有有效模型文件，跳过下载。');
    return;
  }

  if (ifMissing && fs.existsSync(destPath)) {
    const st = fs.statSync(destPath);
    if (st.size >= MIN_BYTES) {
      console.log(
        `[download-whisper-model] 已存在有效文件，跳过下载: ${destPath} (${(st.size / 1024 / 1024).toFixed(2)} MB)`,
      );
      return;
    }
  }

  const url = resolveDownloadUrl(filename);
  console.log(`[download-whisper-model] 下载: ${url}`);
  console.log(`[download-whisper-model] 写入: ${destPath}`);

  try {
    await downloadStreamingToFile(url, destPath);
  } catch (e) {
    console.error('[download-whisper-model] 下载失败:', e.message || e);
    printHint(destPath);
    if (typeof fetch === 'function') {
      try {
        console.log('[download-whisper-model] 尝试 fetch 回退…');
        const res = await fetch(url, { redirect: 'follow' });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const buf = Buffer.from(await res.arrayBuffer());
        if (buf.length < MIN_BYTES) throw new Error(`内容过小 ${buf.length} bytes`);
        fs.mkdirSync(path.dirname(destPath), { recursive: true });
        fs.writeFileSync(destPath, buf);
      } catch (e2) {
        console.error('[download-whisper-model] fetch 回退失败:', e2.message || e2);
        printHint(destPath);
        process.exit(1);
      }
    } else {
      process.exit(1);
    }
  }

  const stat = fs.statSync(destPath);
  console.log(`[download-whisper-model] 完成 ${destPath} (${(stat.size / 1024 / 1024).toFixed(2)} MB)`);
}

main().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
