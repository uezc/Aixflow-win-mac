/**
 * 在项目根目录生成 aixflow-backend.zip，根目录直接包含：
 *   index.mjs、package.json、lib/、pricing/、node_modules/
 * 无 demo/、无 NEXFLOW/ 等多余父级路径。
 *
 * 等价于在「仅含上述五项」的目录中执行：
 *   zip -r aixflow-backend.zip index.mjs package.json lib pricing node_modules
 * （Windows 若未安装 zip，请用本脚本：npm run pack:aixflow-backend）
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const AdmZip = require('adm-zip');

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const demo = path.join(root, 'demo', 'aliyun-fc-init-user');
const pricingRoot = path.join(root, 'pricing');
const outZip = path.join(root, 'aixflow-backend.zip');

/** 与 scripts/build-hongkong-fc-zip.mjs、index.mjs import 一致 */
const requiredPricingFiles = [
  'price_calculator.mjs',
  'cost_table.mjs',
  'markup_table.mjs',
  'price_tiers.mjs',
  'videoBillingSku.mjs',
  'videoBillingCloud.mjs',
];

for (const f of requiredPricingFiles) {
  const p = path.join(pricingRoot, f);
  if (!fs.existsSync(p)) {
    console.error('[pack-aixflow-backend] pricing/ 缺少必需文件:', f);
    process.exit(1);
  }
}

const required = [
  ['index.mjs', path.join(demo, 'index.mjs')],
  ['package.json', path.join(demo, 'package.json')],
  ['lib/', path.join(demo, 'lib')],
  ['node_modules/', path.join(demo, 'node_modules')],
];

for (const [label, p] of required) {
  if (!fs.existsSync(p)) {
    console.error('[pack-aixflow-backend] 缺少:', label, '→', p);
    console.error('[pack-aixflow-backend] 请先: cd demo/aliyun-fc-init-user && npm install');
    process.exit(1);
  }
}

console.log('[pack-aixflow-backend] pricing/ 校验通过（', requiredPricingFiles.length, '个文件）');

if (fs.existsSync(outZip)) fs.unlinkSync(outZip);

const zip = new AdmZip();
zip.addFile('index.mjs', fs.readFileSync(path.join(demo, 'index.mjs')));
zip.addFile('package.json', fs.readFileSync(path.join(demo, 'package.json')));
zip.addLocalFolder(path.join(demo, 'lib'), 'lib');
zip.addLocalFolder(pricingRoot, 'pricing');
zip.addLocalFolder(path.join(demo, 'node_modules'), 'node_modules');
zip.writeZip(outZip);

const verify = new AdmZip(outZip);
const names = verify.getEntries().map((e) => e.entryName.replace(/\\/g, '/'));

const badPrefix = names.some(
  (n) =>
    n.startsWith('demo/') ||
    n.startsWith('NEXFLOW/') ||
    n.startsWith('aliyun-fc-init-user/'),
);
if (badPrefix) {
  console.error('[pack-aixflow-backend] 校验失败: zip 内出现多余路径前缀');
  process.exit(1);
}

if (!names.includes('index.mjs')) {
  console.error('[pack-aixflow-backend] 校验失败: 根目录无 index.mjs');
  process.exit(1);
}
for (const f of requiredPricingFiles) {
  const want = `pricing/${f}`;
  if (!names.some((n) => n === want || n.startsWith(`${want}/`))) {
    console.error('[pack-aixflow-backend] 校验失败: 缺少', want);
    process.exit(1);
  }
}

const hasLib = names.some((n) => n.startsWith('lib/'));
const hasNm = names.some((n) => n.startsWith('node_modules/'));
console.log('[pack-aixflow-backend] 已生成:', outZip);
console.log(
  '[pack-aixflow-backend] 校验: index.mjs@根 | pricing/* | lib/ | node_modules/ =',
  true,
  '|',
  true,
  '|',
  hasLib,
  '|',
  hasNm,
);
console.log('[pack-aixflow-backend] 大小:', (fs.statSync(outZip).size / 1024 / 1024).toFixed(2), 'MB');
