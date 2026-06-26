#!/usr/bin/env node
/**
 * 构建前校验：manifest.json 中引用的相对路径在 files/ 下必须存在，
 * 避免安装包内「有 manifest、无图片」导致场景库 360 预览报错。
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

function main() {
  if (!fs.existsSync(manifestPath)) {
    console.log('[verify-asset-library] 无 manifest，跳过');
    return;
  }

  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
  } catch (e) {
    console.error('[verify-asset-library] manifest 解析失败:', e.message);
    process.exit(1);
  }

  const chars = manifest.characters?.length ?? 0;
  const scenes = manifest.sceneLibrary?.length ?? 0;
  if (chars === 0 && scenes === 0) {
    console.log('[verify-asset-library] 资产库为空，跳过文件校验');
    return;
  }

  const refs = new Set();
  collectRelativeFileRefs(manifest.characters, refs);
  collectRelativeFileRefs(manifest.sceneLibrary, refs);

  const missing = [];
  for (const ref of refs) {
    const local = path.join(filesDir, ref.replace(/\//g, path.sep));
    if (!fs.existsSync(local)) missing.push(ref);
  }

  if (missing.length > 0) {
    console.error(
      `[verify-asset-library] manifest 引用了 ${refs.size} 个本地文件，其中 ${missing.length} 个在 files/ 下不存在。`,
    );
    missing.slice(0, 12).forEach((m) => console.error('  缺失:', m));
    if (missing.length > 12) console.error(`  … 另有 ${missing.length - 12} 个`);
    console.error(
      '[verify-asset-library] 构建中止。请在本机 NEXFLOW 中确认资产库文件完整，或执行 npm run sync:asset-library 后重试。',
    );
    process.exit(1);
  }

  console.log(`[verify-asset-library] 通过：${refs.size} 个本地文件均已打入 files/`);
}

main();
