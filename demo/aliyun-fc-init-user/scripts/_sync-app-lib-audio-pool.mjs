import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const files = ['queueScheduler.mjs', 'platformConcurrencyConfig.mjs', 'userConcurrencyEntitlement.mjs'];
for (const f of files) {
  fs.copyFileSync(path.join(root, 'lib', f), path.join(root, 'app', 'lib', f));
  console.log('copied', f);
}

const appDb = path.join(root, 'app', 'lib', 'db-tablestore.mjs');
let s = fs.readFileSync(appDb, 'utf8');

if (!s.includes(": ['video', 'image', 'audio']")) {
  s = s.replace(
    /: \['video', 'image'\];(\s*\n\s*if \(ids\.length === 0\) throw new Error\('INVALID_POOL_KIND'\);)/,
    ": ['video', 'image', 'audio'];$1",
  );
  console.log('pool ids patched');
} else {
  console.log('pool ids already');
}

if (!s.includes("taskType === 'audio'")) {
  s = s.replace(
    "return taskType === 'image' ? r.imageConcurrencyLimit : r.videoConcurrencyLimit;",
    "if (taskType === 'image') return r.imageConcurrencyLimit;\n      if (taskType === 'audio') return r.audioConcurrencyLimit;\n      return r.videoConcurrencyLimit;",
  );
  console.log('resolveUserLimit patched');
} else {
  console.log('resolveUserLimit already');
}

s = s.replace('PK pool_id=video|image', 'PK pool_id=video|image|audio');
s = s.replace('默认初始化 video+image；', '默认初始化 video+image+audio；');
fs.writeFileSync(appDb, s);
console.log('app db written');
