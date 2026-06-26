/**
 * 将仓库根目录 pricing/（计费唯一来源，含 NX_VIDEO_COST 等）同步到 demo/aliyun-fc-init-user/pricing/
 * 用法: node scripts/sync-pricing-to-fc.mjs
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const src = path.join(root, 'pricing');
const dst = path.join(root, 'demo', 'aliyun-fc-init-user', 'pricing');

if (!fs.existsSync(src)) {
  console.error('[sync-pricing-to-fc] Missing:', src);
  process.exit(1);
}
fs.mkdirSync(dst, { recursive: true });
for (const name of fs.readdirSync(src)) {
  if (!name.endsWith('.mjs')) continue;
  fs.copyFileSync(path.join(src, name), path.join(dst, name));
}
console.log('[sync-pricing-to-fc] OK:', fs.readdirSync(dst).filter((f) => f.endsWith('.mjs')).join(', '));
