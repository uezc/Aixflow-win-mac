/**
 * 创建 nx_task_work 活跃任务投影表（若不存在）。
 * Usage: node scripts/ensure-task-work-table.mjs
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

const db = await import('../lib/db-tablestore.mjs');
const r = await db.ensureTaskWorkTable();
console.log(JSON.stringify(r));
