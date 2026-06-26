/**
 * 打包支付宝支付后端（backend/*.py），用于部署到 aixflow.com.cn /opt/aixflow/backend
 * 不含 .env、.venv、日志。
 *
 * 用法：npm run pack:alipay-backend
 * 产出：aixflow-alipay-backend.zip（仓库根目录）
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const AdmZip = require('adm-zip');

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const backend = path.join(root, 'backend');
const outZip = path.join(root, 'aixflow-alipay-backend.zip');

const includeFiles = [
  'alipay_test.py',
  'alipay_settlement_service.py',
  'alipay_logger.py',
  'fc_client.py',
  'pem_utils.py',
  'retry_scheduler.py',
  'sse_hub.py',
  'requirements-alipay-test.txt',
  'verify_alipay_env.py',
];

for (const f of includeFiles) {
  if (!fs.existsSync(path.join(backend, f))) {
    console.error('[pack-alipay-backend] 缺少:', f);
    process.exit(1);
  }
}

if (fs.existsSync(outZip)) fs.unlinkSync(outZip);

const zip = new AdmZip();
for (const f of includeFiles) {
  zip.addFile(f, fs.readFileSync(path.join(backend, f)));
}
zip.writeZip(outZip);

console.log('[pack-alipay-backend] 已生成:', outZip);
console.log('[pack-alipay-backend] 大小:', (fs.statSync(outZip).size / 1024).toFixed(1), 'KB');
console.log('[pack-alipay-backend] 文件:', includeFiles.join(', '));
