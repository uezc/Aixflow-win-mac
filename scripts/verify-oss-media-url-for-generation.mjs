#!/usr/bin/env node
/**
 * 校验双区域 OSS 素材 URL 识别逻辑（与 ossConfig.ts 字符串规则一致，不依赖 electron）。
 */
const HK_ORIGIN = 'https://nexflow-temp-images.oss-cn-hongkong.aliyuncs.com';
const CN_ORIGIN = 'https://nexflow-temp-images-bj.oss-cn-beijing.aliyuncs.com';
const HK_SAMPLE = `${HK_ORIGIN}/aixflow-temp-media/1234-abc.png`;
const CN_SAMPLE = `${CN_ORIGIN}/aixflow-temp-media/5678-def.mp4`;

function isOurMediaOssObjectUrl(url) {
  const s = String(url || '');
  return s.includes('nexflow-temp-images.oss-cn-hongkong.aliyuncs.com') ||
    s.includes('nexflow-temp-images-bj.oss-cn-beijing.aliyuncs.com');
}

function inferRegion(url) {
  if (url.includes('nexflow-temp-images-bj.oss-cn-beijing')) return 'cn';
  if (url.includes('nexflow-temp-images.oss-cn-hongkong')) return 'hk';
  return null;
}

function assert(cond, msg) {
  if (!cond) {
    console.error('[verify-oss-media-url] FAIL:', msg);
    process.exit(1);
  }
}

for (const [label, url, expect] of [
  ['HK', HK_SAMPLE, 'hk'],
  ['CN', CN_SAMPLE, 'cn'],
]) {
  assert(isOurMediaOssObjectUrl(url), `${label} 应识别为本项目 OSS 素材 URL`);
  assert(inferRegion(url) === expect, `${label} 区域应为 ${expect}`);
  assert(url.startsWith('https://'), `${label} 须为 https 公网 URL`);
  console.log(`[verify-oss-media-url] ${label} OK → ${url.slice(0, 80)}...`);
}

console.log('[verify-oss-media-url] 通过：香港/北京素材 URL 格式符合生成回传要求');
