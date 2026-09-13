/**
 * Settle stuck Phase 8.1 golden task via corrected .ai poll (no re-charge, no re-dispatch).
 * node scripts/_settle-stuck-p81-task.mjs
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
import { execSync } from 'child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const REPO = path.resolve(ROOT, '../..');

function loadEnvFile(p) {
  if (!fs.existsSync(p)) return;
  for (const line of fs.readFileSync(p, 'utf8').split(/\r?\n/)) {
    if (!line || line.trim().startsWith('#') || !line.includes('=')) continue;
    const i = line.indexOf('=');
    const k = line.slice(0, i).trim();
    let v = line.slice(i + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (k && process.env[k] === undefined) process.env[k] = v;
  }
}
loadEnvFile(path.join(REPO, '.env'));
loadEnvFile(path.join(ROOT, '.env'));

const TASK = process.env.P81_TASK_ID || 'b8dc5a03-fe6e-446b-995d-dc1b16a41ea6';
const USER = process.env.P81_USER_ID || '__p81live_mtnt97ar_ok';
const EXPECT_PID = '2096075740000186369';

async function hydrateRhFromFcHk() {
  const requireFromRoot = createRequire(path.join(ROOT, 'package.json'));
  try {
    requireFromRoot.resolve('@alicloud/fc20230330');
  } catch {
    execSync(
      'npm install --no-save @alicloud/fc20230330@^4.2.0 @alicloud/openapi-client @alicloud/tea-util',
      { cwd: ROOT, stdio: 'pipe' },
    );
  }
  const Fc20230330 = requireFromRoot('@alicloud/fc20230330');
  const OpenApi = requireFromRoot('@alicloud/openapi-client');
  const Util = requireFromRoot('@alicloud/tea-util');
  const accessKeyId = process.env.OTS_ACCESS_KEY_ID?.trim() || process.env.OSS_ACCESS_KEY_ID?.trim() || '';
  const accessKeySecret =
    process.env.OTS_ACCESS_KEY_SECRET?.trim() || process.env.OSS_ACCESS_KEY_SECRET?.trim() || '';
  if (!accessKeyId || !accessKeySecret) throw new Error('NO_ALIYUN_AK');
  const config = new OpenApi.Config({
    accessKeyId,
    accessKeySecret,
    endpoint: 'fcv3.cn-hongkong.aliyuncs.com',
  });
  const client = new Fc20230330.default(config);
  const fn = await client.getFunctionWithOptions(
    process.env.FC_FUNCTION_NAME_HK?.trim() || 'nexflow-api',
    new Fc20230330.GetFunctionRequest({}),
    {},
    new Util.RuntimeOptions({}),
  );
  const envMap = fn?.body?.environmentVariables || {};
  for (const k of Object.keys(envMap)) {
    if (k.startsWith('RUNNINGHUB_') && typeof envMap[k] === 'string' && envMap[k].trim()) {
      process.env[k] = envMap[k].trim();
    }
  }
}

await hydrateRhFromFcHk();

const db = await import('../lib/db-tablestore.mjs');
const { pollOneProviderTask } = await import('../lib/providerPipeline.mjs');

const before = await db.getTaskById(TASK);
const balBefore = (await db.getUserById(USER))?.balance;
if (!before) throw new Error('TASK_NOT_FOUND');
if (String(before.provider_task_id) !== EXPECT_PID) {
  throw new Error(`provider_task_id mismatch: ${before.provider_task_id}`);
}

const poll = await pollOneProviderTask(TASK, db);
const after = await db.getTaskById(TASK);
const balAfter = (await db.getUserById(USER))?.balance;
const snap = await db.getUserConcurrencyCounterSnapshot(USER, 'video');
const plat = await db.getPlatformConcurrencyPoolSnapshot();

const out = {
  poll,
  before: {
    status: before.status,
    stage: before.execution_stage,
    pid: before.provider_task_id,
  },
  after: {
    status: after?.status,
    stage: after?.execution_stage,
    pid: after?.provider_task_id,
    url: (after?.result_oss_url || '').slice(0, 160),
    held: { u: after?.user_slot_held, p: after?.platform_slot_held },
  },
  balance: { before: balBefore, after: balAfter },
  user_occupied: snap?.occupied,
  platform_running: plat?.video?.running,
  no_recharge: balBefore === balAfter,
  same_provider_task: after?.provider_task_id === EXPECT_PID,
};

fs.writeFileSync(path.join(__dirname, 'phase8-1-stuck-settle-result.json'), JSON.stringify(out, null, 2));
console.log(JSON.stringify(out, null, 2));

const ok =
  String(after?.status).toLowerCase() === 'success' &&
  out.no_recharge &&
  out.same_provider_task &&
  String(after?.result_oss_url || '').startsWith('http') &&
  Number(snap?.occupied) === 0 &&
  !after?.user_slot_held &&
  !after?.platform_slot_held;

process.exit(ok ? 0 : 2);
