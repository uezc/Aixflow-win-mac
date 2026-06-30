#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..', 'resources', 'default-digital-human-library');
const manifestPath = path.join(root, 'manifest.json');
const filesDir = path.join(root, 'files');

const MEDIA_KEYS = ['localVideoPath', 'localAudioPath', 'localPosterPath', 'videoUrl', 'audioUrl', 'poster'];

function collectRefs(items, out) {
  for (const item of items || []) {
    for (const k of MEDIA_KEYS) {
      const v = item?.[k];
      if (typeof v !== 'string' || !v.trim()) continue;
      if (v.startsWith('http://') || v.startsWith('https://') || v.includes('://')) continue;
      out.add(v.replace(/\\/g, '/'));
    }
  }
}

function main() {
  if (!fs.existsSync(manifestPath)) {
    console.log('[verify-digital-human] 无 manifest，跳过');
    return;
  }
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
  const items = manifest.digitalHumanLibrary || [];
  if (!items.length) {
    console.log('[verify-digital-human] 数字人库为空，跳过文件校验');
    return;
  }
  const refs = new Set();
  collectRefs(items, refs);
  const missing = [...refs].filter((ref) => !fs.existsSync(path.join(filesDir, ref.replace(/\//g, path.sep))));
  if (missing.length) {
    console.error(`[verify-digital-human] ${missing.length}/${refs.size} 个文件缺失`);
    missing.slice(0, 10).forEach((m) => console.error('  缺失:', m));
    process.exit(1);
  }
  console.log(`[verify-digital-human] 通过：${items.length} 条数字人，${refs.size} 个媒体文件`);
}

main();
