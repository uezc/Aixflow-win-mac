/**
 * 将 RVC 引擎 zip 下载并解压到 resources/rvc/（供离线打包）或指定目录。
 * 用法: node scripts/download-rvc-engine.mjs [--out resources/rvc/engine]
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';
import AdmZip from 'adm-zip';
import axios from 'axios';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');

function loadManifest() {
  const p = path.join(root, 'resources/rvc/manifest.json');
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

async function main() {
  const manifest = loadManifest();
  const url = process.env.NEXFLOW_RVC_ENGINE_BUNDLE_URL || manifest.bundleUrl;
  if (!url) {
    console.error('未配置 bundleUrl。请设置 NEXFLOW_RVC_ENGINE_BUNDLE_URL 或编辑 resources/rvc/manifest.json');
    process.exit(1);
  }
  const outArg = process.argv.indexOf('--out');
  const outDir =
    outArg >= 0 && process.argv[outArg + 1]
      ? path.resolve(process.argv[outArg + 1])
      : path.join(root, 'resources/rvc/engine');
  fs.mkdirSync(outDir, { recursive: true });
  const zipPath = path.join(outDir, 'rvc-engine.zip');
  console.log('[download-rvc-engine] 下载', url);
  const resp = await axios.get(url, { responseType: 'arraybuffer', timeout: 0, maxContentLength: Infinity });
  const buf = Buffer.from(resp.data);
  if (manifest.sha256) {
    const hash = crypto.createHash('sha256').update(buf).digest('hex');
    if (hash !== manifest.sha256) {
      console.error('SHA256 校验失败', { expected: manifest.sha256, got: hash });
      process.exit(1);
    }
  }
  fs.writeFileSync(zipPath, buf);
  const zip = new AdmZip(zipPath);
  zip.extractAllTo(outDir, true);
  fs.unlinkSync(zipPath);
  console.log('[download-rvc-engine] 已解压到', outDir);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
