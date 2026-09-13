/**
 * Extract Sep8 OTS bill rows + check monthsummary for hour 22.
 * READ ONLY
 */
import fs from 'fs';

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

const detail =
  'e:/Users/Administrator/Downloads/1902910424969427-20260908231958_202609_consumedetailbillv2.csv';
const lines = fs.readFileSync(detail, 'utf8').split(/\r?\n/).filter(Boolean);
const rows = lines.slice(1).map(parse);
const sep8 = [];
for (const r of rows) {
  const t = String(r[12] || '');
  if (!t.startsWith('2026-09-08')) continue;
  const prod = String(r[16] || '');
  const inst = String(r[24] || '');
  if (!/表格|nexflow-db/i.test(prod + inst)) continue;
  sep8.push({
    time: t,
    item: r[20],
    usage: r[36],
    unit: r[37],
    pay: Number(r[60]),
    instance: r[24],
  });
}
const byHour = {};
for (const x of sep8) {
  const h = x.time.slice(0, 13);
  if (!byHour[h]) byHour[h] = { pay: 0, items: {} };
  byHour[h].pay += x.pay || 0;
  byHour[h].items[x.item] = {
    pay: (byHour[h].items[x.item]?.pay || 0) + (x.pay || 0),
    usage: x.usage,
    unit: x.unit,
  };
}
console.log('DETAIL_HOURS', JSON.stringify(byHour, null, 2));
console.log('HAS_22', Object.keys(byHour).some((k) => k.includes('22:00')));
console.log('HAS_23', Object.keys(byHour).some((k) => k.includes('23:00')));
console.log('LAST_HOUR', Object.keys(byHour).sort().slice(-3));

for (const f of [
  'e:/Users/Administrator/Downloads/1902910424969427-20260908224720_202609_consumedetailbillv2monthsummary.csv',
  'e:/Users/Administrator/Downloads/1902910424969427-20260908172043_202609_consumedetailbillv2monthsummary.csv',
]) {
  if (!fs.existsSync(f)) continue;
  const raw = fs.readFileSync(f, 'utf8');
  console.log('\nFILE', f, 'bytes', raw.length, 'lines', raw.split(/\r?\n/).length);
  console.log('head', raw.slice(0, 300).replace(/\n/g, ' | '));
  if (/18\.03|22:00|下行/.test(raw)) console.log('mentions spike terms');
}
