/**
 * RunningHub 双站分流诊断（不创建真实生成任务、不扣元宝）
 *
 * 用法:
 *   node scripts/diag-rh-overseas.mjs
 *   node scripts/diag-rh-overseas.mjs --fc          # 额外打 FC：假 /query 分别带 rhRegion=ai|cn
 *   node scripts/diag-rh-overseas.mjs --model banana
 *
 * 逐个迁移时用 --model 只核对某一前缀。
 */
import 'dotenv/config';
import axios from 'axios';
import {
  pickRunningHubTarget,
  pathMatchesOverseasPrefix,
  DEFAULT_OVERSEAS_PATH_PREFIXES,
} from '../demo/aliyun-fc-init-user/lib/runningHubTarget.mjs';

/** 迁移队列：path 样例 → 期望站点（与 DEFAULT_OVERSEAS_PATH_PREFIXES 对齐） */
const MIGRATION_QUEUE = [
  {
    id: 'banana',
    label: 'banana 2.0',
    samplePath: '/rhart-image-n-g31-flash/text-to-image',
    expect: 'ai',
  },
  {
    id: 'veo-fast',
    label: '全能/Veo v3.1-fast',
    samplePath: '/rhart-video-v3.1-fast/image-to-video',
    expect: 'ai',
  },
  {
    id: 'veo-pro',
    label: '全能/Veo v3.1-pro',
    samplePath: '/rhart-video-v3.1-pro/text-to-video',
    expect: 'ai',
  },
  {
    id: 'veo-official',
    label: 'Veo 3.1 Pro 官方',
    samplePath: '/rhart-video-v3.1-pro-official/image-to-video',
    expect: 'ai',
  },
  {
    id: 'grok',
    label: 'Grok 视频',
    samplePath: '/rhart-video-g/image-to-video',
    expect: 'ai',
  },
  {
    id: 'grok-official',
    label: 'Grok 官方参考',
    samplePath: '/rhart-video-g-official/reference-to-video',
    expect: 'ai',
  },
  {
    id: 'suno',
    label: 'SUNO',
    samplePath: '/rhart-audio/suno-v5.5/custom',
    expect: 'ai',
  },
  {
    id: 'gemini-omni',
    label: 'Gemini Omni',
    samplePath: '/run/ai-app/2067153261005721602',
    expect: 'ai',
  },
  // 对照：必须仍走国内
  {
    id: 'kling',
    label: '可灵 o1（对照 .cn）',
    samplePath: '/kling-video-o1/text-to-video',
    expect: 'cn',
  },
  {
    id: 'seedream',
    label: 'Seedream v5（对照 .cn）',
    samplePath: '/seedream-v5-lite/text-to-image',
    expect: 'cn',
  },
  {
    id: 'sora',
    label: 'Sora（对照 .cn）',
    samplePath: '/rhart-video-s/text-to-video',
    expect: 'cn',
  },
];

const modelArg = (() => {
  const i = process.argv.indexOf('--model');
  return i >= 0 ? String(process.argv[i + 1] || '').trim().toLowerCase() : '';
})();
const wantFc = process.argv.includes('--fc');

process.env.RUNNINGHUB_API_KEY = process.env.RUNNINGHUB_API_KEY || 'diag-cn-key';
process.env.RUNNINGHUB_API_KEY_AI = process.env.RUNNINGHUB_API_KEY_AI || 'diag-ai-key';

console.log('[diag-rh] 默认海外前缀:', DEFAULT_OVERSEAS_PATH_PREFIXES.join(', '));
console.log(
  '[diag-rh] env OVERSEAS_PATH_PREFIXES:',
  process.env.RUNNINGHUB_OVERSEAS_PATH_PREFIXES?.trim() || '(未设，用代码默认)',
);

const rows = modelArg
  ? MIGRATION_QUEUE.filter((m) => m.id === modelArg || m.id.startsWith(modelArg))
  : MIGRATION_QUEUE;

if (modelArg && rows.length === 0) {
  console.error('[diag-rh] 未知 --model:', modelArg, '可选:', MIGRATION_QUEUE.map((m) => m.id).join(', '));
  process.exit(1);
}

let failed = 0;
console.log('\n=== 本地 pickRunningHubTarget ===');
for (const m of rows) {
  const hit = pathMatchesOverseasPrefix(m.samplePath);
  const t = pickRunningHubTarget(m.samplePath);
  const ok = t.region === m.expect;
  if (!ok) failed += 1;
  console.log(
    `${ok ? 'OK' : 'FAIL'}  ${m.id.padEnd(14)} expect=${m.expect} got=${t.region}  matchPrefix=${hit}  ${m.samplePath}`,
  );
}

if (failed) {
  console.error(`\n[diag-rh] 本地路由失败 ${failed} 项`);
  process.exit(1);
}
console.log('\n[diag-rh] 本地路由全部通过');

function fcRunTaskUrl() {
  const base = (process.env.HK_FC_ENDPOINT || process.env.ALIYUN_FC_INIT_USER_URL || '')
    .trim()
    .replace(/\/init-user\/?$/, '')
    .replace(/\/$/, '');
  if (!base) return '';
  return base.endsWith('/run-task') ? base : `${base}/run-task`;
}

if (!wantFc) {
  console.log('\n[diag-rh] 未加 --fc，跳过线上探测。部署新 FC 包后执行:');
  console.log('  node scripts/diag-rh-overseas.mjs --model banana --fc');
  process.exit(0);
}

const url = fcRunTaskUrl();
const token = (process.env.ALIYUN_FC_TOKEN || '').trim();
if (!url || !token) {
  console.error('[diag-rh] --fc 需要 HK_FC_ENDPOINT/ALIYUN_FC_INIT_USER_URL 与 ALIYUN_FC_TOKEN');
  process.exit(1);
}

console.log('\n=== FC 假 /query（验证 Key 能否打到对应站；不扣元宝）===');
console.log('[diag-rh] FC:', url.replace(/https?:\/\/[^/]+/, 'https://***'));

async function postQuery(rhRegion, label) {
  const t0 = Date.now();
  const r = await axios.post(
    url,
    {
      taskId: `diag-rh-${rhRegion}-${Date.now()}`,
      type: 'image',
      billing: 'none',
      forward: {
        provider: 'runninghub',
        path: '/query',
        method: 'POST',
        rhRegion,
        body: { taskId: '00000000000000000000000000000000' },
      },
    },
    {
      headers: { 'Content-Type': 'application/json', 'x-nexflow-token': token },
      timeout: 45000,
      validateStatus: () => true,
    },
  );
  const err = r.data?.error || r.data?.message || '';
  const bodyStr = typeof r.data === 'object' ? JSON.stringify(r.data).slice(0, 280) : String(r.data).slice(0, 280);
  console.log(`\n[${label}] HTTP ${r.status} ${Date.now() - t0}ms`);
  if (err) console.log('  error:', String(err).slice(0, 200));
  console.log('  body:', bodyStr);
  const overseasHint = /RUNNINGHUB_API_KEY_AI|海外 RunningHub|runninghub\.ai/i.test(bodyStr + err);
  const cnHint = /RUNNINGHUB_API_KEY_NOT|国内 RunningHub/i.test(bodyStr + err);
  if (r.status === 401 || /401|鉴权|NOT_CONFIGURED/i.test(bodyStr + err)) {
    console.log(
      overseasHint
        ? '  → 像是在打海外 Key（或 KEY_AI 未配）'
        : cnHint
          ? '  → 像是在打国内 Key'
          : '  → 鉴权失败；若未部署含 pickRunningHubTarget 的新包，rhRegion 会被忽略',
    );
  } else {
    console.log('  → FC 已转发（假 taskId 业务失败也正常）；请在 FC 日志确认 region=', rhRegion);
  }
  return r;
}

await postQuery('cn', 'rhRegion=cn');
await postQuery('ai', 'rhRegion=ai');

console.log('\n[diag-rh] 完成。下一步：在客户端用 banana 2.0 文生图冒烟，FC 日志应出现 [RH] forward region=ai');
