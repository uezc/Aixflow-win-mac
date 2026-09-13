/**
 * Phase 9.2.2 — p5-live-video / NO_FORWARD_PAYLOAD 污染任务 cleanup
 *
 * 默认 dry-run（只读 preview）。
 * 执行：node scripts/cleanup-invalid-forward-charged.mjs --apply
 *
 * 使用现有 recoverInvalidForwardChargedTask → failDispatchClearAndRefund（不绕过状态机）。
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
for (const p of [path.resolve(__dirname, '../../../.env'), path.resolve(__dirname, '../.env')]) {
  if (!fs.existsSync(p)) continue;
  for (const line of fs.readFileSync(p, 'utf8').split(/\r?\n/)) {
    if (!line || line.trim().startsWith('#')) continue;
    const i = line.indexOf('=');
    if (i < 1) continue;
    const k = line.slice(0, i).trim();
    let v = line.slice(i + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (k && process.env[k] === undefined) process.env[k] = v;
  }
}

const APPLY = process.argv.includes('--apply');
const MODEL_FILTER = 'p5-live-video';

const db = await import('../lib/db-tablestore.mjs');
const { recoverInvalidForwardChargedTask, hasValidForwardPath } = await import(
  '../lib/providerPipeline.mjs'
);

function rowPreview(t) {
  return {
    task_id: t.task_id,
    model_id: t.model_id,
    status: t.status,
    execution_stage: t.execution_stage,
    quoted_cost: t.quoted_cost,
    provider_forward_json: String(t.provider_forward_json || '').slice(0, 80),
    provider_error: t.provider_error || '',
    user_slot_held: t.user_slot_held,
    platform_slot_held: t.platform_slot_held,
    created_at: t.created_at,
    updated_at: t.updated_at,
    safe_terminal:
      String(t.model_id) === MODEL_FILTER &&
      String(t.status).toLowerCase() === 'claimed' &&
      ['charged', 'dispatching'].includes(String(t.execution_stage || '').toLowerCase()) &&
      !String(t.provider_task_id || '').trim() &&
      !hasValidForwardPath(t),
  };
}

async function main() {
  const ids = await db.listInvalidForwardChargedTasks({ maxTasks: 200, maxScanRows: 50000 });
  const preview = [];
  for (const tid of ids) {
    const t = await db.getTaskById(tid);
    if (!t) continue;
    if (MODEL_FILTER && String(t.model_id) !== MODEL_FILTER) continue;
    preview.push(rowPreview(t));
  }

  const report = {
    mode: APPLY ? 'APPLY' : 'DRY_RUN',
    model_filter: MODEL_FILTER,
    count: preview.length,
    safe_terminal_count: preview.filter((x) => x.safe_terminal).length,
    tasks: preview,
    actions: [],
  };

  if (!APPLY) {
    console.log(JSON.stringify(report, null, 2));
    fs.writeFileSync(
      path.join(__dirname, 'cleanup-invalid-forward-preview.json'),
      JSON.stringify(report, null, 2),
    );
    console.log('[dry-run] wrote cleanup-invalid-forward-preview.json; re-run with --apply to execute');
    return;
  }

  // apply：分批直到无剩余 safe p5 任务（每批两轮 mark→terminal）
  let rounds = 0;
  while (rounds < 50) {
    rounds += 1;
    const ids = await db.listInvalidForwardChargedTasks({ maxTasks: 50, maxScanRows: 50000 });
    const batch = [];
    for (const tid of ids) {
      const t = await db.getTaskById(tid);
      if (!t || String(t.model_id) !== MODEL_FILTER) continue;
      if (!hasValidForwardPath(t) && String(t.status).toLowerCase() === 'claimed') batch.push(tid);
    }
    if (!batch.length) break;
    for (const tid of batch) {
      const r1 = await recoverInvalidForwardChargedTask(tid, db);
      let r2 = null;
      if (r1.marked) r2 = await recoverInvalidForwardChargedTask(tid, db);
      else if (!r1.terminal && !r1.failed) r2 = await recoverInvalidForwardChargedTask(tid, db);
      const after = await db.getTaskById(tid);
      report.actions.push({
        task_id: tid,
        r1,
        r2,
        final_status: after?.status,
        final_stage: after?.execution_stage,
        user_slot_held: after?.user_slot_held,
        platform_slot_held: after?.platform_slot_held,
      });
    }
  }

  fs.writeFileSync(
    path.join(__dirname, 'cleanup-invalid-forward-apply-result.json'),
    JSON.stringify(report, null, 2),
  );
  console.log(JSON.stringify({ mode: 'APPLY', n: report.actions.length, actions: report.actions }, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
