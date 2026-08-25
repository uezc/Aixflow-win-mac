#!/usr/bin/env node
/** Rewrite site/*.html asset paths from ../assets → ./assets for flat hosting (CF Pages / OSS). */
import fs from 'fs';
import path from 'path';

const dir = process.argv[2] || path.join(process.cwd(), 'release', 'aixflow-website-site');

function fix(html) {
  return html
    .replace(/(href|src)="\.\.\/assets\//g, '$1="./assets/')
    .replace(/(href|src)="\.\.\/icon\.png"/g, '$1="./icon.png"');
}

for (const f of ['index.html', 'recharge.html', 'installer.html']) {
  const p = path.join(dir, f);
  if (!fs.existsSync(p)) {
    console.error(`[fix-flat] missing ${p}`);
    process.exit(1);
  }
  fs.writeFileSync(p, fix(fs.readFileSync(p, 'utf8')));
  console.log(`[fix-flat] ${p}`);
}
