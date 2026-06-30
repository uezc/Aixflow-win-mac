#!/usr/bin/env node
/**
 * 审计 default-asset-library：manifest 条目数、引用文件、磁盘文件、孤儿文件、不可移植路径。
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..', 'resources', 'default-asset-library');
const manifestPath = path.join(root, 'manifest.json');
const filesDir = path.join(root, 'files');

const SKIP_PREFIXES = ['http://', 'https://', 'data:', 'local-resource://', 'file://'];
const MEDIA_EXT = /\.(jpg|jpeg|png|gif|webp|bmp|mp3|wav|m4a|ogg|aac|flac|mp4|webm|mov|glb|gltf)$/i;
const KNOWN_REL_PREFIXES = [
  'bundled-imports/',
  'character-3d/',
  'character-views/',
  'character-voices/',
  'scene-library/',
  'avatars/',
  'assets/',
  'aixflow-temp-media/',
];

function looksLikeFileRef(v) {
  if (!v || typeof v !== 'string') return false;
  const s = v.trim();
  if (!s || SKIP_PREFIXES.some((p) => s.startsWith(p))) return false;
  if (MEDIA_EXT.test(s)) return true;
  if (KNOWN_REL_PREFIXES.some((p) => s.startsWith(p))) return true;
  if (path.isAbsolute(s)) return true;
  return false;
}

function collectRelativeFileRefs(value, out) {
  if (value == null) return;
  if (typeof value === 'string') {
    const v = value.trim();
    if (!looksLikeFileRef(v)) return;
    out.add(v.replace(/\\/g, '/'));
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item) => collectRelativeFileRefs(item, out));
    return;
  }
  if (typeof value === 'object') {
    Object.values(value).forEach((item) => collectRelativeFileRefs(item, out));
  }
}

function walkFiles(dir, base = dir) {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name);
    if (fs.statSync(p).isDirectory()) out.push(...walkFiles(p, base));
    else out.push(path.relative(base, p).replace(/\\/g, '/'));
  }
  return out;
}

function formatBytes(n) {
  if (n >= 1024 ** 3) return `${(n / 1024 ** 3).toFixed(2)} GB`;
  if (n >= 1024 ** 2) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  if (n >= 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${n} B`;
}

function dirSize(dir) {
  let total = 0;
  if (!fs.existsSync(dir)) return 0;
  for (const rel of walkFiles(dir)) {
    total += fs.statSync(path.join(dir, rel.replace(/\//g, path.sep))).size;
  }
  return total;
}

function main() {
  if (!fs.existsSync(manifestPath)) {
    console.error('[audit-asset-library] 缺少 manifest.json');
    process.exit(1);
  }

  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
  const chars = manifest.characters?.length ?? 0;
  const scenes = manifest.sceneLibrary?.length ?? 0;
  const models = (manifest.characters || []).filter(
    (c) => c.localGlbPath || c.localGlbUrl || (c.localGlbUrl && String(c.localGlbUrl).includes('.glb')),
  ).length;
  const charsWith3d = (manifest.characters || []).filter((c) => {
    const t = JSON.stringify(c);
    return t.includes('character-3d/') || t.includes('.glb');
  }).length;

  const refs = new Set();
  collectRelativeFileRefs(manifest.characters, refs);
  collectRelativeFileRefs(manifest.sceneLibrary, refs);

  const missing = [];
  for (const ref of refs) {
    const local = path.join(filesDir, ref.replace(/\//g, path.sep));
    if (!fs.existsSync(local)) missing.push(ref);
  }

  const onDisk = new Set(walkFiles(filesDir));
  const orphans = [...onDisk].filter((f) => !refs.has(f));

  const text = JSON.stringify(manifest);
  const badDrive = [...new Set(text.match(/[A-Za-z]:\\[^"\\]+/g) || [])];
  const badLocalRes = [...new Set(text.match(/local-resource:\/\/[^"]+/g) || [])];

  const byDir = {};
  for (const f of onDisk) {
    const top = f.split('/')[0];
    byDir[top] = (byDir[top] || 0) + 1;
  }

  console.log('=== Aixflow 默认资产库审计 ===');
  console.log(`同步时间: ${manifest.syncedAt || '(未知)'}`);
  console.log(`来源 userData: ${manifest.sourceUserData || '(未知)'}`);
  console.log('');
  console.log('【条目统计】');
  console.log(`  角色: ${chars}`);
  console.log(`  场景: ${scenes}`);
  console.log(`  含 3D/GLB 相关资源的角色: ${charsWith3d}`);
  console.log('');
  console.log('【文件统计】');
  console.log(`  manifest 引用本地文件: ${refs.size} 个（去重）`);
  console.log(`  files/ 磁盘文件: ${onDisk.size} 个`);
  console.log(`  files/ 总体积: ${formatBytes(dirSize(filesDir))}`);
  if (Object.keys(byDir).length) {
    console.log('  按目录:');
    for (const [k, v] of Object.entries(byDir).sort((a, b) => b[1] - a[1])) {
      console.log(`    ${k}/: ${v}`);
    }
  }
  console.log('');

  let ok = true;
  if (missing.length) {
    ok = false;
    console.log(`【缺失】${missing.length} 个 manifest 引用在 files/ 不存在:`);
    missing.slice(0, 15).forEach((m) => console.log(`  - ${m}`));
    if (missing.length > 15) console.log(`  … 另有 ${missing.length - 15} 个`);
    console.log('');
  } else {
    console.log('【缺失】无 — manifest 引用文件全部存在 ✓');
    console.log('');
  }

  if (orphans.length) {
    console.log(`【孤儿文件】${orphans.length} 个在 files/ 但 manifest 未引用（多为历史残留，不影响安装）:`);
    orphans.slice(0, 8).forEach((o) => console.log(`  - ${o}`));
    if (orphans.length > 8) console.log(`  … 另有 ${orphans.length - 8} 个`);
    console.log('');
  } else {
    console.log('【孤儿文件】无 ✓');
    console.log('');
  }

  if (badDrive.length || badLocalRes.length) {
    ok = false;
    console.log('【不可移植路径】manifest 含无法随安装包分发的路径:');
    badDrive.slice(0, 5).forEach((p) => console.log(`  盘符: ${p}`));
    badLocalRes.slice(0, 5).forEach((p) => console.log(`  local-resource: ${p}`));
    console.log('');
  } else {
    console.log('【可移植性】manifest 无盘符/local-resource 路径 ✓');
    console.log('');
  }

  if (chars === 0 && scenes === 0) {
    ok = false;
    console.log('【结论】资产库为空，1.6.2 安装包不会注入默认素材。');
  } else if (ok) {
    console.log(`【结论】1.6.2 素材库完整，可打入安装包（${chars} 角色 + ${scenes} 场景，${refs.size} 个媒体文件）。`);
  } else {
    console.log('【结论】素材库不完整，请关闭 Aixflow 后执行 npm run sync:asset-library 再 npm run electron:build。');
    process.exit(1);
  }
}

main();
