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
const rows = lines.slice(1).map(parse);
const hours = new Map();
for (const r of rows) {
  const prod = String(r[16] || '');
  const inst = String(r[24] || '');
  if (!/表格|nexflow-db/i.test(prod + inst)) continue;
  const t = String(r[12] || '');
  const item = String(r[20] || '');
  const pay = Number(r[60]);
  const key = t;
  if (!hours.has(key)) hours.set(key, { n: 0, pay: 0, items: {} });
  const h = hours.get(key);
  h.n += 1;
  h.pay += Number.isFinite(pay) ? pay : 0;
  h.items[item] = (h.items[item] || 0) + (Number.isFinite(pay) ? pay : 0);
}
console.log(JSON.stringify([...hours.entries()].sort((a, b) => a[0].localeCompare(b[0])), null, 2));
