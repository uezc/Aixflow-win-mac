/**
 * 快速探测 ALIYUN_FC_INIT_USER_URL 上 /login 与 /model-config 的端到端耗时（毫秒）。
 * 不依赖有效 JWT：/model-config 使用占位 Bearer，预期 401，仍可反映冷启动与网络 RTT。
 * 用法：在项目根目录 node scripts/fc-latency-check.mjs
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

function loadDotenv() {
  const p = path.join(root, '.env');
  if (!fs.existsSync(p)) return;
  const raw = fs.readFileSync(p, 'utf8').replace(/^\uFEFF/, '');
  for (const line of raw.split('\n')) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!m) continue;
    let v = m[2].trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    process.env[m[1]] = v;
  }
}

loadDotenv();

const base = (process.env.ALIYUN_FC_INIT_USER_URL || '').trim().replace(/\/+$/, '');
const token = (process.env.ALIYUN_FC_TOKEN || '').trim();

const REQ_TIMEOUT_MS = Number(process.env.FC_LATENCY_TIMEOUT_MS || 20000);

async function timeOne(name, fn) {
  const t0 = performance.now();
  try {
    const r = await fn();
    const ms = Math.round(performance.now() - t0);
    return { name, ok: true, ms, status: r.status, hint: r.statusText };
  } catch (e) {
    const ms = Math.round(performance.now() - t0);
    return { name, ok: false, ms, err: e?.message || String(e) };
  }
}

function fetchWithTimeout(url, opts = {}) {
  const ac = new AbortController();
  const id = setTimeout(() => ac.abort(), REQ_TIMEOUT_MS);
  return fetch(url, { ...opts, signal: ac.signal }).finally(() => clearTimeout(id));
}

async function main() {
  if (!base) {
    console.error('未设置 ALIYUN_FC_INIT_USER_URL（请在项目根 .env 配置）');
    process.exit(1);
  }
  console.log('FC base:', base);
  console.log('x-nexflow-token:', token ? `已设置 (${token.length} 字符)` : '未设置（部分路由可能 401）');
  console.log('');

  const headers = {
    'Content-Type': 'application/json; charset=utf-8',
    ...(token ? { 'x-nexflow-token': token } : {}),
  };

  const r1 = await timeOne('POST /login（错误密码，测 FC+OTS 登录路径）', async () => {
    return fetchWithTimeout(`${base}/login`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ email: 'latency-check@invalid.local', password: '__wrong__' }),
    });
  });
  console.log(format(r1));

  const r2 = await timeOne('POST /model-config（无效 Bearer，预期 401；若仍极慢则多为 FC/网关）', async () => {
    return fetchWithTimeout(`${base}/model-config`, {
      method: 'POST',
      headers: {
        ...headers,
        Authorization: 'Bearer invalid-token-for-latency-check',
      },
      body: '{}',
    });
  });
  console.log(format(r2));

  console.log('');
  console.log('说明：第二条在验证失败时可能不执行 listModelConfig；若要测全表扫描，请在客户端登录后看主进程日志或使用有效 JWT 复测。');
}

function format(x) {
  if (x.ok) return `  ${x.name}\n    → ${x.ms} ms  HTTP ${x.status}`;
  return `  ${x.name}\n    → ${x.ms} ms  错误: ${x.err}`;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
