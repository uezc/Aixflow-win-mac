/**
 * Parse Aliyun consume detail bill for Sep 8 hourly OTS.
 * READ-ONLY local file. node scripts/_parse-ots-hourly-bill.mjs
 */
import fs from 'fs';

const candidates = [
  'e:/Users/Administrator/Downloads/1902910424969427-20260908231958_202609_consumedetailbillv2.csv',
  'C:/Users/Administrator/Downloads/1902910424969427-20260908231958_202609_consumedetailbillv2.csv',
];
const p = candidates.find((x) => fs.existsSync(x));
if (!p) {
  console.log(JSON.stringify({ error: 'file_missing', candidates }));
  process.exit(1);
}
console.log('USING', p);
// keep rest; remove duplicate missing check below
if (!fs.existsSync(p)) {
  console.log(JSON.stringify({ error: 'file_missing', p }));
  process.exit(1);
}

function parse(line) {
  const cols = [];
  let cur = '';
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      q = !q;
      cur += c;
      continue;
    }
    if (c === ',' && !q) {
      cols.push(cur.replace(/^"|"$/g, '').replace(/""/g, '"'));
      cur = '';
      continue;
    }
    cur += c;
  }
  cols.push(cur.replace(/^"|"$/g, '').replace(/""/g, '"'));
  return cols;
}

const lines = fs.readFileSync(p, 'utf8').split(/\r?\n/).filter(Boolean);
const header = parse(lines[0]);
console.log('HEADER_COLS', header.length);
console.log(
  'HEADER_SAMPLE',
  header.map((h, i) => `${i}:${h}`).filter((x) => /时间|产品|计费|用量|应付|实例|地域|Item|Billing|Product|Usage|Amount|Instance|Region|扣费|费用/.test(x) || true).slice(0, 40),
);

// Print all headers with index
const hdr = header.map((h, i) => ({ i, h }));
console.log(JSON.stringify(hdr, null, 2));

const rows = lines.slice(1).map(parse);
// Find likely datetime / product / amount columns by scanning first data row
const sample = rows[0];
console.log('FIRST_ROW_LEN', sample?.length);
console.log('FIRST_ROW_PREVIEW', sample?.slice(0, 35));

// Heuristic: find columns containing 2026-09-08 and 表格存储/OTS/tablestore
const otsLike = [];
for (const r of rows) {
  const joined = r.join('|');
  if (/表格存储|TableStore|OTS|tablestore/i.test(joined) && /2026-09-08/.test(joined)) {
    otsLike.push(r);
  }
}
console.log('OTS_ROWS_SEP8', otsLike.length);

// Aggregate by hour-ish fields
function findIdx(preds) {
  for (const pred of preds) {
    const i = header.findIndex((h) => pred.test(String(h || '')));
    if (i >= 0) return i;
  }
  return -1;
}
const idxTime = findIdx([/消费时间/, /Billing/, /时间/, /账期/, /计费时间/]);
const idxProduct = findIdx([/产品明细/, /产品名称/, /Product/]);
const idxItem = findIdx([/计费项/, /Billing Item/, /账单类型/]);
const idxPayable = findIdx([/应付金额/, /Payable/, /优惠后金额/, /实付/]);
const idxUsage = findIdx([/用量/, /Usage/]);
const idxUnit = findIdx([/用量单位/, /单位/]);
const idxInstance = findIdx([/实例ID/, /实例/, /Instance/]);
const idxRegion = findIdx([/地域/, /Region/]);

console.log({ idxTime, idxProduct, idxItem, idxPayable, idxUsage, idxUnit, idxInstance, idxRegion });

const byHour = {};
for (const r of otsLike) {
  const t = String(r[idxTime] || '');
  const hour = (t.match(/2026-09-08[ T](\d{2})/) || [])[1] || t.slice(0, 13);
  const item = r[idxItem] || '';
  const payable = Number(r[idxPayable]);
  const usage = r[idxUsage];
  const unit = r[idxUnit];
  const key = `${hour}|${item}`;
  if (!byHour[key]) byHour[key] = { hour, item, payable: 0, usage_sum: 0, n: 0, unit, samples: [] };
  byHour[key].payable += Number.isFinite(payable) ? payable : 0;
  byHour[key].usage_sum += Number(usage) || 0;
  byHour[key].n += 1;
  if (byHour[key].samples.length < 2) {
    byHour[key].samples.push({ t, usage, unit, payable, instance: r[idxInstance], product: r[idxProduct] });
  }
}

const sorted = Object.values(byHour).sort((a, b) => String(a.hour).localeCompare(String(b.hour)) || b.payable - a.payable);
console.log('BY_HOUR_ITEM');
console.log(JSON.stringify(sorted, null, 2));

const hourTot = {};
for (const x of sorted) {
  hourTot[x.hour] = (hourTot[x.hour] || 0) + x.payable;
}
console.log('HOUR_TOTALS', hourTot);
