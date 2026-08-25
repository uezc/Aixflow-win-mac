/**
 * 最早加载的环境变量配置
 * 必须在 index.ts 中作为第一个 import 引入，确保 .env 在其他模块之前加载
 *
 * 加载顺序（后者覆盖前者；但对 HK_FC_ENDPOINT 等关键键，禁止用空串覆盖已有非空）：
 * 1) cwd/.env  2) ../../.env（开发时 ts 编译输出旁即项目根）
 * 3) 安装包 process.resourcesPath/.env（**正式安装包内 FC 地址主要来源**）
 * 4) app.getPath('userData')/.env
 *
 * 说明：主进程入口须 `import './envLoader.js'` 且早于其它业务模块；勿仅用 `dotenv/config`，
 * 否则打包后只会从 cwd 找 .env，**不会**加载 resources/.env，导致安装版读不到云端配置。
 * UTF-8 BOM 会导致首行键名带 \uFEFF，也会读不到，故读文件后去掉 BOM。
 */
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { app } from 'electron';

/** 须在 app ready 前：抬高渲染/主进程 V8 堆，避免导演台大工程 ~4GB OOM 闪退 */
try {
  app.commandLine.appendSwitch('js-flags', '--max-old-space-size=8192');
} catch {
  /* ignore */
}

const __dirnameEnv = path.dirname(fileURLToPath(import.meta.url));

function stripBom(buf: Buffer): Buffer {
  if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) {
    return buf.subarray(3);
  }
  return buf;
}

/**
 * 安装包内 FC 等关键变量：后加载的 .env（尤其 userData/.env）里若写了「空值」或占位，
 * 不应覆盖前面 resources/.env 已合并的非空值，否则会出现「调试有、安装包读不到云端定价」。
 */
const PRESERVE_NON_EMPTY_IF_LATER_EMPTY = new Set([
  'HK_FC_ENDPOINT',
  'ALIYUN_FC_INIT_USER_URL',
  'ALIYUN_FC_TOKEN',
  'BEIJING_FC_ENDPOINT',
  'ALIYUN_FC_FALLBACK_URL',
]);

function isEffectivelyEmptyEnvValue(v: unknown): boolean {
  if (v == null) return true;
  const s = String(v).trim();
  if (!s) return true;
  if (s === '""' || s === "''") return true;
  return false;
}

/** 将 .env 中的键合并进 process.env（后者覆盖前者；对关键键禁止「空覆盖非空」） */
function mergeEnvFile(pathname: string): void {
  try {
    if (!pathname || !fs.existsSync(pathname)) return;
    const raw = stripBom(fs.readFileSync(pathname));
    const parsed = dotenv.parse(raw);
    for (const [key, value] of Object.entries(parsed)) {
      const k = key.replace(/^\uFEFF/, '').trim();
      if (!k) continue;
      if (PRESERVE_NON_EMPTY_IF_LATER_EMPTY.has(k) && isEffectivelyEmptyEnvValue(value)) {
        const cur = process.env[k];
        if (typeof cur === 'string' && cur.trim()) continue;
      }
      process.env[k] = String(value ?? '');
    }
  } catch {
    // 忽略缺失或不可读
  }
}

mergeEnvFile(path.resolve(process.cwd(), '.env'));
mergeEnvFile(path.resolve(__dirnameEnv, '../../.env'));

if (process.resourcesPath) {
  mergeEnvFile(path.join(process.resourcesPath, '.env'));
}

try {
  mergeEnvFile(path.join(app.getPath('userData'), '.env'));
} catch {
  // app 未就绪等极端情况略过
}
