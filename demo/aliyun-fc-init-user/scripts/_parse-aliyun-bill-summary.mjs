import fs from 'fs';

const p =
  'e:/Users/Administrator/Downloads/1902910424969427-20260908224720_202609_consumedetailbillv2monthsummary.csv';
const lines = fs.readFileSync(p, 'utf8').split(/\r?\n/).filter(Boolean);

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
      cols.push(cur);
      cur = '';
      continue;
    }
    cur += c;
  }
  cols.push(cur);
  return cols;
}

const rows = lines.slice(1).map(parse).map((c) => {
  const payable = Number(c[c.length - 1]);
  return {
    product: c[11],
    item: c[15],
    region: c[22],
    instance: c[18],
    usage: c[25],
    unit: c[26],
    payable,
  };
});

rows.sort((a, b) => (b.payable || 0) - (a.payable || 0));
console.log('TOP by payable:');
for (const r of rows.slice(0, 12)) {
  console.log(
    String((r.payable || 0).toFixed(6)).padStart(12),
    r.product,
    '|',
    r.item,
    '|',
    r.region,
    '|',
    r.instance,
    '|',
    `${r.usage}${r.unit}`,
  );
}
const sum = rows.reduce((s, r) => s + (Number.isFinite(r.payable) ? r.payable : 0), 0);
console.log('SUM payable', sum.toFixed(6));
console.log('ROW_COUNT', rows.length);
