/**
 * Phase 9.7 Live E2E — minimax-h3-audio Unified Queue
 * 仅烧 1 次真实 RH；另做本地可控 failure/refund 幂等验证（不二次烧 RH）
 *
 * node scripts/live-phase9-7-h3-audio-queue.mjs
 */
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

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
process.env.NX_SKIP_QUEUE_PIPELINE_ON_CREATE = '1';

const require = createRequire(path.join(ROOT, 'package.json'));
const jwt = require('jsonwebtoken');

const PREFIX = `__p97live_${Date.now().toString(36)}_`;
const FC_BASE = (process.env.HK_FC_ENDPOINT || process.env.ALIYUN_FC_INIT_USER_URL || '').replace(/\/$/, '');
const FC_TOKEN = process.env.ALIYUN_FC_TOKEN || '';
const ADMIN_SECRET = process.env.ADMIN_SETTLE_SECRET || '';
const JWT_SECRET = process.env.JWT_SECRET || '';
const AUDIO_PATH = '/run/ai-app/2086260808442531842';
const OSS_IMAGE =
  process.env.P97_AUDIO_IMAGE_URL?.trim() ||
  process.env.P94_I2V_IMAGE_URL?.trim() ||
  (fs.existsSync(path.join(__dirname, 'p93d-i2v-image-url.txt'))
    ? fs.readFileSync(path.join(__dirname, 'p93d-i2v-image-url.txt'), 'utf8').trim()
    : '') ||
  'https://nexflow-temp-images.oss-cn-hongkong.aliyuncs.com/p93d-i2v-test/1788607602254_b2eac80c.jpg';
const OSS_AUDIO =
  process.env.P97_AUDIO_URL?.trim() ||
  (fs.existsSync(path.join(__dirname, 'p95b5-lipsync-audio-url.txt'))
    ? fs.readFileSync(path.join(__dirname, 'p95b5-lipsync-audio-url.txt'), 'utf8').trim()
    : '');
const OUT = path.join(__dirname, 'phase9-7-h3-audio-live-e2e-result.json');

const REPORT = {
  phase: '9.7-h3-audio',
  started_at: new Date().toISOString(),
  conclusion: 'BLOCKED',
  errors: [],
  h3_audio_e2e: null,
  failure_refund: null,
  queue_only_check: null,
  billing_sku: null,
};

function log(msg) {
  console.log(`[p97-live] ${msg}`);
}

function signAccessToken(userId, tv = 0) {
  return jwt.sign({ sub: userId, typ: 'access', tv }, JWT_SECRET, { expiresIn: '7d' });
}

function mapBillingDur(sec) {
  const n = Number(sec);
  if (!Number.isFinite(n) || n <= 0) return 20;
  for (const t of [6, 10, 15, 20]) if (t >= n) return t;
  return 20;
}

async function fcFetch(pathSuffix, { body = {}, auth = null, timeoutMs = 180_000 } = {}) {
  const url = `${FC_BASE}${pathSuffix.startsWith('/') ? pathSuffix : `/${pathSuffix}`}`;
  const headers = {
    'content-type': 'application/json',
    'x-nexflow-token': FC_TOKEN,
  };
  if (auth) headers.authorization = `Bearer ${auth}`;
  if (ADMIN_SECRET) headers['x-admin-settle-secret'] = ADMIN_SECRET;
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: ac.signal,
    });
    const text = await res.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {
      json = { raw: text.slice(0, 600) };
    }
    return { status: res.status, json };
  } finally {
    clearTimeout(timer);
  }
}

async function fcInternal(name, body = {}) {
  return fcFetch(`/internal/${name}`, { body });
}

function parseRhMediaField(raw) {
  const data = raw?.data ?? raw;
  const candidates = [
    data?.fileName,
    data?.file_name,
    data?.fileNamePath,
    data?.data?.fileName,
    data?.data?.file_name,
    typeof data === 'string' ? data : null,
  ];
  for (const c of candidates) {
    const s = String(c || '').trim();
    if (/^(openapi|api)\//i.test(s)) return s;
  }
  const blob = JSON.stringify(data || {});
  const m = blob.match(/"(openapi\/[^"]+|api\/[^"]+)"/i);
  return m ? m[1] : '';
}

async function uploadRhMediaFromUrl(auth, fileUrl, filename, contentType) {
  const taskId = crypto.randomUUID();
  const res = await fcFetch('/run-task', {
    auth,
    body: {
      type: 'image',
      billing: 'none',
      taskId,
      forward: {
        provider: 'runninghub',
        path: '/media/upload/binary',
        method: 'POST',
        rhRegion: 'cn',
        uploadFromUrl: {
          url: fileUrl,
          filename,
          contentType,
          fieldName: 'file',
        },
      },
    },
    timeoutMs: 120_000,
  });
  if (res.status !== 200) {
    throw new Error(`RH media upload HTTP ${res.status}: ${JSON.stringify(res.json).slice(0, 400)}`);
  }
  const field = parseRhMediaField(res.json);
  if (!field) {
    throw new Error(`RH media upload no fileName: ${JSON.stringify(res.json).slice(0, 500)}`);
  }
  return field;
}

function buildH3AudioForward(prompt, rhImageField, rhAudioField, billingSec) {
  return {
    provider: 'runninghub',
    path: AUDIO_PATH,
    method: 'POST',
    body: {
      nodeInfoList: [
        { nodeId: '138', fieldName: 'value', fieldValue: prompt, description: '提示词' },
        {
          nodeId: '115',
          fieldName: 'aspect_ratio',
          fieldValue: '16:9 (Widescreen)',
          description: '比例选择',
        },
        { nodeId: '115', fieldName: 'megapixels', fieldValue: '0.9', description: '分辨率（看介绍）' },
        { nodeId: '137', fieldName: 'image', fieldValue: rhImageField, description: 'image1' },
        { nodeId: '171', fieldName: 'audio', fieldValue: rhAudioField, description: '参考音' },
      ],
      instanceType: 'plus',
      randomSeed: true,
      retainSeconds: 0,
      usePersonalQueue: 'false',
    },
    billingModelId: `minimax-h3-audio-720p-${billingSec}s`,
    rhRegion: 'cn',
  };
}

const db = await import('../lib/db-tablestore.mjs');
const { tryClaimOneQueuedTask } = await import('../lib/queueScheduler.mjs');

async function setBalance(userId, balance) {
  try {
    await db.createUserOtpOnly({ userId, email: `${userId}@p97live.local` });
  } catch (_) {}
  const cur = (await db.getUserById(userId))?.balance ?? 0;
  const delta = balance - cur;
  if (delta === 0) return;
  const op = crypto.randomUUID();
  if (delta > 0) await db.atomicCreditWithReceipt(userId, `ref_${op}`, delta);
  else await db.atomicDebitWithReceipt(userId, `chg_${op}`, -delta);
}

async function setupUser(userId, balance = 2000) {
  try {
    await db.createUserOtpOnly({ userId, email: `${userId}@p97live.local` });
  } catch (_) {}
  await db.updateUserConcurrencyEntitlement(userId, {
    planId: 'enterprise',
    videoConcurrencyOverride: 5,
    concurrencyOverrideExpiresAt: Date.now() + 7 * 86400000,
  });
  await setBalance(userId, balance);
  const u = await db.getUserById(userId);
  return signAccessToken(userId, u?.tokenVersion ?? 0);
}

async function buildPromoteDeps(nowMs = Date.now()) {
  return {
    nowMs,
    resolveUserLimit: async (userId, taskType) => {
      const u = await db.getUserById(userId);
      const { resolveEffectiveConcurrency } = await import('../lib/userConcurrencyEntitlement.mjs');
      const r = resolveEffectiveConcurrency(u || {}, nowMs);
      return taskType === 'image' ? r.imageConcurrencyLimit : r.videoConcurrencyLimit;
    },
    createReservation: (row) => db.putSlotReservation(row),
    markReservationHeld: async (reservationId, which) => {
      await db.updateSlotReservation(
        reservationId,
        which === 'user' ? { user_slot_held: 1 } : { platform_slot_held: 1 },
      );
    },
    markReservationState: async (reservationId, state, extra = {}) => {
      await db.updateSlotReservation(reservationId, { state, ...extra });
    },
    tryAcquireUser: (userId, taskType, limit) => db.tryAcquireUserConcurrencySlot(userId, taskType, limit),
    releaseUser: (userId, taskType) => db.releaseUserConcurrencySlot(userId, taskType),
    tryAcquirePlatform: (taskType) => db.tryAcquirePlatformConcurrencySlot(taskType),
    releasePlatform: (taskType) => db.releasePlatformConcurrencySlot(taskType),
    atomicClaimQueuedTask: (args) => db.atomicClaimQueuedTask(args),
    atomicUnclaimExpiredTask: (args) => db.atomicUnclaimExpiredTask(args),
    getTaskById: (taskId) => db.getTaskById(taskId),
  };
}

async function promoteOneTask(taskId, userId) {
  const t = await db.getTaskById(taskId);
  if (!t || t.status !== 'queued') return t;
  const deps = await buildPromoteDeps();
  await tryClaimOneQueuedTask(
    {
      taskId,
      userId,
      taskType: 'video',
      queueEnteredAt: Number(t.queue_entered_at || t.created_at || Date.now()),
    },
    deps,
  );
  return db.getTaskById(taskId);
}

async function runFcWorkersUntil(taskId, { maxRounds = 90, intervalMs = 8000 } = {}) {
  for (let i = 0; i < maxRounds; i++) {
    await fcInternal('run-queue-pipeline', {
      max_promote: 20,
      max_charge: 20,
      max_dispatch: 20,
      max_poll: 40,
    });
    const t = await db.getTaskById(taskId);
    log(
      `r${i} status=${t?.status} stage=${t?.execution_stage} pid=${String(t?.provider_task_id || '').slice(0, 24)}`,
    );
    const st = String(t?.status || '').toLowerCase();
    if (['success', 'failed', 'cancelled', 'timeout'].includes(st)) {
      return { task: t, timeout: false };
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  return { task: await db.getTaskById(taskId), timeout: true };
}

async function main() {
  if (!FC_BASE || !FC_TOKEN || !ADMIN_SECRET || !JWT_SECRET) {
    REPORT.errors.push('missing FC/JWT env');
    fs.writeFileSync(OUT, JSON.stringify(REPORT, null, 2));
    process.exit(3);
  }
  if (!OSS_IMAGE.startsWith('https://') || !OSS_AUDIO.startsWith('https://')) {
    REPORT.errors.push(`bad OSS media image=${OSS_IMAGE.slice(0, 40)} audio=${OSS_AUDIO.slice(0, 40)}`);
    fs.writeFileSync(OUT, JSON.stringify(REPORT, null, 2));
    process.exit(4);
  }

  {
    const gp = fs.readFileSync(path.join(REPO, 'src/shared/videoQueueGoldenPath.ts'), 'utf8');
    const vp = fs.readFileSync(path.join(REPO, 'src/main/ai/providers/VideoProvider.ts'), 'utf8');
    const ok =
      gp.includes("VIDEO_QUEUE_H3_AUDIO_MODEL = 'minimax-h3-audio'") &&
      /VIDEO_QUEUE_ONLY_MODEL_IDS[\s\S]*VIDEO_QUEUE_H3_AUDIO_MODEL/.test(gp) &&
      vp.includes('executeMinimaxH3AudioCloudQueueGoldenPath') &&
      vp.includes('minimax-h3-audio 已强制云端排队，禁止 Direct');
    REPORT.queue_only_check = ok ? 'PASS' : 'FAIL';
    if (!ok) REPORT.errors.push('queue_only_check failed');
    log(`queue_only_check=${REPORT.queue_only_check}`);
  }

  // Prefer forced 6s billing if env set; else default 6s for create model_id (FC may reprice)
  const billingSec = Number(process.env.P97_BILLING_SEC || 6) || 6;
  const mapped = mapBillingDur(billingSec);
  const SKU = `minimax-h3-audio-720p-${mapped}s`;
  REPORT.billing_sku = SKU;

  const userId = `${PREFIX}audio`;
  const initial = 2000;
  const token = await setupUser(userId, initial);
  log(`image=${OSS_IMAGE.slice(0, 80)}`);
  log(`audio=${OSS_AUDIO.slice(0, 80)}`);
  log(`sku=${SKU}`);

  let rhImg = '';
  let rhAud = '';
  try {
    rhImg = await uploadRhMediaFromUrl(token, OSS_IMAGE, 'minimax-h3-audio-ref.jpg', 'image/jpeg');
    rhAud = await uploadRhMediaFromUrl(token, OSS_AUDIO, 'minimax-h3-audio-ref.mp3', 'audio/mpeg');
    log(`rh_img=${rhImg}`);
    log(`rh_aud=${rhAud}`);
  } catch (e) {
    REPORT.errors.push(`RH media upload failed: ${e?.message || e}`);
    fs.writeFileSync(OUT, JSON.stringify(REPORT, null, 2));
    console.log(JSON.stringify(REPORT, null, 2));
    process.exit(5);
  }

  const prompt =
    'PHASE 9.7 MiniMax H3 Audio queue live, lipsync with one reference image, natural mouth motion, no text overlay.';
  const forward = buildH3AudioForward(prompt, rhImg, rhAud, mapped);

  const createRes = await fcFetch('/tasks/create', {
    auth: token,
    body: {
      model_id: SKU,
      type: 'video',
      execution_mode: 'queue',
      provider_forward_json: forward,
      skip_queue_pipeline: true,
      params: {
        model: 'minimax-h3-audio',
        nxCloudQueueGoldenPath: true,
        prompt,
        inputAudioUrl: OSS_AUDIO,
        images: [OSS_IMAGE],
      },
      nodeData: {
        model: 'minimax-h3-audio',
        durationMinimaxH3: String(mapped),
        resolutionMinimaxH3: '720p',
        aspect_ratio: '16:9',
        prompt,
        imageCount: 1,
        audioCount: 1,
      },
    },
  });

  if (createRes.status !== 200 || !createRes.json?.task_id) {
    REPORT.errors.push(`create failed: ${createRes.status} ${JSON.stringify(createRes.json)}`);
    fs.writeFileSync(OUT, JSON.stringify(REPORT, null, 2));
    console.log(JSON.stringify(REPORT, null, 2));
    process.exit(2);
  }

  const taskId = String(createRes.json.task_id);
  const quoted = createRes.json?.quoted_cost_coins ?? createRes.json?.quoted_cost ?? null;
  const t0 = await db.getTaskById(taskId);
  const fwd = JSON.parse(t0?.provider_forward_json || '{}');
  if (fwd.rhRegion !== 'cn' || fwd.path !== AUDIO_PATH || fwd.body?.instanceType !== 'plus') {
    REPORT.errors.push(`bad forward ${JSON.stringify(fwd).slice(0, 400)}`);
    fs.writeFileSync(OUT, JSON.stringify(REPORT, null, 2));
    process.exit(6);
  }

  log(`created task=${taskId} quoted=${quoted}`);
  await promoteOneTask(taskId, userId);
  const worker = await runFcWorkersUntil(taskId, { maxRounds: 90, intervalMs: 8000 });
  const final = worker.task;
  const bal = (await db.getUserById(userId))?.balance;
  const userSnap = await db.getUserConcurrencyCounterSnapshot(userId, 'video');
  const platSnap = await db.getPlatformConcurrencyPoolSnapshot();
  const charge = await db.getTaskCharge(taskId);
  const chargeAmt = Number(initial) - Number(bal);

  REPORT.h3_audio_e2e = {
    aixflow_task_id: taskId,
    runninghub_task_id: final?.provider_task_id || '',
    submit_region: fwd.rhRegion,
    poll_region: fwd.rhRegion,
    billing_sku: SKU,
    quoted_cost: quoted,
    actual_charge: chargeAmt,
    charge_status: charge?.status || null,
    charge_count: charge && String(charge.status || '').toLowerCase() === 'charged' ? 1 : 0,
    refund_count: charge && String(charge.status || '').toLowerCase() === 'refunded' ? 1 : 0,
    queue_entered_at: t0?.queue_entered_at ?? null,
    claimed_at: final?.claimed_at ?? null,
    charged_at: final?.charged_at ?? null,
    execution_stage: final?.execution_stage ?? null,
    completed_at: final?.finished_at || final?.updated_at || null,
    final_status: final?.status,
    result_url: final?.result_oss_url || '',
    user_occupied: userSnap?.occupied ?? userSnap?.running ?? null,
    platform_occupied: platSnap?.video?.running ?? null,
    user_slot_held: final?.user_slot_held,
    platform_slot_held: final?.platform_slot_held,
    path: AUDIO_PATH,
    worker_timeout: worker.timeout,
  };

  const liveOk =
    String(final?.status).toLowerCase() === 'success' &&
    String(final?.provider_task_id || '') &&
    String(final?.result_oss_url || '') &&
    fwd.rhRegion === 'cn' &&
    Number(userSnap?.occupied ?? userSnap?.running ?? 0) === 0 &&
    String(final?.user_slot_held || '0') !== '1' &&
    String(final?.platform_slot_held || '0') !== '1' &&
    chargeAmt > 0 &&
    String(charge?.status || '').toLowerCase() === 'charged' &&
    REPORT.queue_only_check === 'PASS';

  // Controllable failure/refund (local pipeline, no second RH burn)
  {
    const { handleTasksCreate } = await import('../lib/handleTasksCreate.mjs');
    const { chargeClaimedTask } = await import('../lib/taskCharge.mjs');
    const { dispatchOneChargedTask, pollOneProviderTask } = await import('../lib/providerPipeline.mjs');
    const uFail = `${PREFIX}fail`;
    await setupUser(uFail, 500);
    const cr = await handleTasksCreate(
      uFail,
      {
        model_id: SKU,
        type: 'video',
        execution_mode: 'queue',
        provider_forward_json: buildH3AudioForward('fail', rhImg, rhAud, mapped),
        params: { model: 'minimax-h3-audio', nxCloudQueueGoldenPath: true },
        nodeData: { model: 'minimax-h3-audio', durationMinimaxH3: String(mapped) },
      },
      db,
      { getFinalPrice: () => Number(quoted) || 8 },
    );
    const failId = cr.task_id;
    await promoteOneTask(failId, uFail);
    const bal0 = (await db.getUserById(uFail)).balance;
    await chargeClaimedTask(failId, db);
    await dispatchOneChargedTask(failId, db, {
      submitRunningHub: async () => ({ ok: false, reason: 'P97_LIVE_CTRL_FAIL' }),
    });
    const bal1 = (await db.getUserById(uFail)).balance;
    for (let i = 0; i < 5; i++) {
      await pollOneProviderTask(failId, db, {
        queryRunningHub: async () => ({ ok: true, status: 'FAILED', error: 'noop' }),
      });
    }
    const bal2 = (await db.getUserById(uFail)).balance;
    const tf = await db.getTaskById(failId);
    const snap = await db.getUserConcurrencyCounterSnapshot(uFail, 'video');
    const refundOk =
      tf.status === 'failed' &&
      !String(tf.provider_task_id || '').trim() &&
      Number(bal0) === Number(bal1) &&
      Number(bal1) === Number(bal2) &&
      Number(snap?.occupied ?? snap?.running ?? 0) === 0;
    REPORT.failure_refund = {
      conclusion: refundOk ? 'PASS' : 'FAIL',
      task_id: failId,
      bal0,
      bal1,
      bal2,
      status: tf.status,
    };
    if (!refundOk) REPORT.errors.push('failure_refund check failed');
    log(`failure_refund=${REPORT.failure_refund.conclusion}`);
  }

  REPORT.conclusion =
    liveOk && REPORT.failure_refund?.conclusion === 'PASS'
      ? 'PASS'
      : worker.timeout
        ? 'TIMEOUT'
        : 'FAIL';
  if (!liveOk && !REPORT.errors.length) {
    REPORT.errors.push(worker.timeout ? 'H3 Audio timeout' : 'H3 Audio e2e not success');
  }
  REPORT.finished_at = new Date().toISOString();
  fs.writeFileSync(OUT, JSON.stringify(REPORT, null, 2));
  log(
    `conclusion=${REPORT.conclusion} status=${final?.status} pid=${final?.provider_task_id} charge=${chargeAmt}`,
  );
  console.log(JSON.stringify(REPORT, null, 2));
  process.exit(REPORT.conclusion === 'PASS' ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  REPORT.errors.push(String(e?.message || e));
  REPORT.finished_at = new Date().toISOString();
  fs.writeFileSync(OUT, JSON.stringify(REPORT, null, 2));
  process.exit(1);
});
