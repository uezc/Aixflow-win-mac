/**
 * Diagnose Phase 9.4 rhart PROVIDER_NO_TASK_ID tasks
 * node scripts/_diag-p94-rhart-fail.mjs
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

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

const db = await import('../lib/db-tablestore.mjs');
const ids = process.argv.slice(2);
const tids =
  ids.length > 0
    ? ids
    : ['3efbc594-b9c6-4fe2-94bb-5ebbbfe5da38', '2aa4490f-3da6-4d3c-9af3-bc66758223b1'];

for (const tid of tids) {
  const t = await db.getTaskById(tid);
  const ch = await db.getTaskCharge(tid);
  const keys = t ? Object.keys(t).sort() : [];
  const interesting = {};
  for (const k of keys) {
    if (/error|provider|result|status|forward|refund|region|msg|message|raw/i.test(k)) {
      let v = t[k];
      if (typeof v === 'string' && v.length > 1000) v = v.slice(0, 1000) + '…';
      interesting[k] = v;
    }
  }
  console.log(
    JSON.stringify(
      {
        tid,
        status: t?.status,
        charge: ch,
        interesting,
      },
      null,
      2,
    ),
  );
}
