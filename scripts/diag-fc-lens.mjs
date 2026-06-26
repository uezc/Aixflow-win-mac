/**
 * 诊断 Lens / FC / RunningHub 转发链路（不提交真实生成任务）
 * 用法: node scripts/diag-fc-lens.mjs
 */
import 'dotenv/config';
import axios from 'axios';

function fcRunTaskUrl() {
  const base = (process.env.HK_FC_ENDPOINT || process.env.ALIYUN_FC_INIT_USER_URL || '')
    .trim()
    .replace(/\/init-user\/?$/, '')
    .replace(/\/$/, '');
  if (!base) return '';
  return base.endsWith('/run-task') ? base : `${base}/run-task`;
}

const url = fcRunTaskUrl();
const token = (process.env.ALIYUN_FC_TOKEN || '').trim();

console.log('[diag] FC run-task URL:', url ? '(configured)' : '(missing)');
console.log('[diag] FC token:', token ? `len=${token.length}` : '(missing)');

if (!url || !token) {
  console.log('[diag] 请配置 HK_FC_ENDPOINT 与 ALIYUN_FC_TOKEN');
  process.exit(1);
}

async function postRunTask(body, label) {
  const t0 = Date.now();
  try {
    const r = await axios.post(url, body, {
      headers: {
        'Content-Type': 'application/json',
        'x-nexflow-token': token,
      },
      timeout: 20000,
      validateStatus: () => true,
    });
    console.log(`\n[diag] ${label}`);
    console.log('  HTTP', r.status, `${Date.now() - t0}ms`);
    const d = r.data;
    if (d && typeof d === 'object') {
      if (d.error) console.log('  error:', String(d.error).slice(0, 200));
      if (d.nxErrorCode) console.log('  nxErrorCode:', d.nxErrorCode);
      if (d.message) console.log('  message:', String(d.message).slice(0, 200));
      if (d.data?.taskId) console.log('  RH taskId:', d.data.taskId);
      if (d.data?.duplicate_task) console.log('  duplicate_task: true');
      if (d.balance != null) console.log('  balance:', d.balance);
    }
    return r;
  } catch (e) {
    console.log(`\n[diag] ${label} FAIL`);
    console.log(' ', e.code || e.message);
    if (e.response) console.log('  HTTP', e.response.status);
    return null;
  }
}

// 1) 假 query：验证 FC 能连且 RUNNINGHUB_API_KEY 已配
await postRunTask(
  {
    taskId: `diag-query-${Date.now()}`,
    type: 'image',
    billing: 'none',
    forward: {
      provider: 'runninghub',
      path: '/query',
      method: 'POST',
      body: { taskId: '00000000000000000000000000000000' },
    },
  },
  'FC→RH /query（假 taskId，应快速返回）',
);

// 2) Lens 定价探测（可选，会扣费）：node scripts/diag-fc-lens.mjs --probe-lens
if (process.argv.includes('--probe-lens')) {
  await postRunTask(
  {
    taskId: `diag-lens-price-${Date.now()}`,
    type: 'image',
    billing: 'charge',
    billingModelId: 'lens-720p',
    forward: {
      provider: 'runninghub',
      path: '/run/ai-app/2063798801864945666',
      method: 'POST',
      body: {
        nodeInfoList: [
          { nodeId: '3', fieldName: 'text', fieldValue: 'diag', description: 'text' },
          { nodeId: '8', fieldName: 'width', fieldValue: '720', description: 'width' },
          { nodeId: '8', fieldName: 'height', fieldValue: '1280', description: 'height' },
        ],
        instanceType: 'plus',
        usePersonalQueue: 'false',
        model: 'lens',
        resolution: '720p',
      },
    },
  },
    'FC→RH Lens 提交探测（会扣费！若 OTS 未配 lens-720p 会 403）',
  );
}

console.log('\n[diag] 完成。若第 1 步超时/525，是 FC↔RH 网络问题；若需测 Lens 定价请加 --probe-lens。');
