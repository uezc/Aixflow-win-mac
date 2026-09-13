import fs from 'fs';

const p =
  'e:/Users/Administrator/Downloads/1902910424969427-20260908231958_202609_consumedetailbillv2.csv';

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
const rows = lines.slice(1).map(parse);

// fixed indices from header dump
const I = {
  time: 12,
  product: 16,
  itemCode: 19,
  itemName: 20,
  instance: 24,
  region: 27,
  usage: 36,
  unit: 37,
};
// find payable: last numeric-looking money column
let payIdx = header.length - 1;
for (let i = header.length - 1; i >= 0; i--) {
  if (/应付|实付|优惠后|Amount|Payable/.test(header[i]) || true) {
    // probe first 20 rows for numeric
  }
}
const moneyIdxs = [];
for (let i = 40; i < header.length; i++) moneyIdxs.push(i);
console.log(
  'money_headers',
  moneyIdxs.map((i) => `${i}:${header[i]}`),
);

// Detect OTS rows: product contains 表格 or ots, or instance nexflow
const ots = [];
for (const r of rows) {
  const prod = String(r[I.product] || '');
  const inst = String(r[I.instance] || '');
  const code = String(r[15] || '');
  if (
    /表格|TableStore|ots/i.test(prod) ||
    /ots/i.test(code) ||
    /nexflow-db/i.test(inst) ||
    /tablestore/i.test(inst)
  ) {
    if (String(r[I.time] || '').includes('2026-09-08')) ots.push(r);
  }
}
console.log('ots_sep8_rows', ots.length);
if (ots[0]) {
  console.log('sample_product', ots[0][I.product], 'item', ots[0][I.itemName], 'time', ots[0][I.time]);
  console.log(
    'sample_tail',
    ots[0].slice(45).map((v, i) => `${45 + i}:${v}`),
  );
}

// Prefer 应付金额 column by name match ignoring garbled — use column near end with values matching bill hours
const payCandidates = [58, 59, 60, 55, 56, 57, 54, 53];
let bestPay = 60;
for (const i of payCandidates) {
  if (i < header.length) {
    const nums = ots.slice(0, 50).map((r) => Number(r[i])).filter((n) => Number.isFinite(n) && n > 0);
    if (nums.length > 10) {
      bestPay = i;
      break;
    }
  }
}
console.log('chosen_pay_idx', bestPay, 'header', header[bestPay]);

const by = {};
for (const r of ots) {
  const t = String(r[I.time] || '');
  const hour = (t.match(/2026-09-08[ T](\d{2})/) || [])[1];
  if (!hour) continue;
  const item = String(r[I.itemName] || r[I.itemCode] || 'unknown');
  const payable = Number(r[bestPay]);
  const usage = Number(r[I.usage]);
  const key = `${hour}|${item}`;
  if (!by[key]) {
    by[key] = {
      hour,
      item,
      payable: 0,
      usage: 0,
      unit: r[I.unit],
      n: 0,
      instance: r[I.instance],
      region: r[I.region],
    };
  }
  by[key].payable += Number.isFinite(payable) ? payable : 0;
  by[key].usage += Number.isFinite(usage) ? usage : 0;
  by[key].n += 1;
}
const sorted = Object.values(by).sort((a, b) => a.hour.localeCompare(b.hour) || b.payable - a.payable);
const hourTot = {};
for (const x of sorted) hourTot[x.hour] = (hourTot[x.hour] || 0) + x.payable;
console.log(JSON.stringify({ hourTot, detail: sorted }, null, 2));
