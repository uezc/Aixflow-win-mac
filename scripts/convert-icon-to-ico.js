#!/usr/bin/env node
/**
 * 将 build/icon.svg、icon.png 或 icon.jpg 转为 build/icon.ico 和 icon-512.png，供 Windows/macOS 使用。
 * 源文件比 icon.ico 新时会自动重新生成；也可传 --force 强制。
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const buildDir = path.join(__dirname, '..', 'build');
const icoPath = path.join(buildDir, 'icon.ico');
const ICON_SOURCE_NAMES = ['icon.svg', 'icon.png', 'icon.jpg', 'image.svg', 'image.png', 'image.jpg'];

const force = process.argv.includes('--force');

function resolveIconSource() {
  for (const name of ICON_SOURCE_NAMES) {
    const p = path.join(buildDir, name);
    if (fs.existsSync(p)) return p;
  }
  return null;
}

function isNewerThan(file, ref) {
  if (!fs.existsSync(file) || !fs.existsSync(ref)) return true;
  return fs.statSync(file).mtimeMs > fs.statSync(ref).mtimeMs;
}

async function main() {
  const srcPath = resolveIconSource();
  if (!srcPath) {
    console.warn(
      '[convert-icon] 未找到 build/icon.svg、icon.png、icon.jpg 等源文件，跳过。',
    );
    return;
  }
  const sharp = (await import('sharp')).default;
  const isSvg = path.extname(srcPath).toLowerCase() === '.svg';
  const sharpSrc = isSvg ? sharp(srcPath, { density: 300 }) : sharp(srcPath);
  const iconPngPath = path.join(buildDir, 'icon.png');
  const icon512Path = path.join(buildDir, 'icon-512.png');
  const srcIsIconPng = path.resolve(srcPath) === path.resolve(iconPngPath);
  const squarePng = (size) =>
    sharpSrc
      .clone()
      .resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 1 } })
      .png();

  if (!srcIsIconPng) {
    await squarePng(512).toFile(iconPngPath);
    console.log('[convert-icon] 已生成 build/icon.png');
  } else {
    console.log('[convert-icon] 使用现有 build/icon.png 作为源');
  }

  await squarePng(512).toFile(icon512Path);
  console.log('[convert-icon] 已生成 build/icon-512.png（macOS 用）');

  const shouldRegenIco =
    force || !fs.existsSync(icoPath) || isNewerThan(srcPath, icoPath) || isNewerThan(iconPngPath, icoPath);

  if (!shouldRegenIco) {
    console.log('[convert-icon] build/icon.ico 已是最新，跳过。使用 --force 强制重新生成。');
    return;
  }

  const pngToIco = (await import('png-to-ico')).default;
  const sizes = [256, 128, 64, 48, 32, 16];
  const tempPngs = [];
  try {
    for (const size of sizes) {
      const out = path.join(buildDir, `_icon_${size}.png`);
      await squarePng(size).toFile(out);
      tempPngs.push(out);
    }
    const buf = await pngToIco(tempPngs);
    fs.writeFileSync(icoPath, buf);
    console.log('[convert-icon] 已生成 build/icon.ico（含 256/128/64/48/32/16 尺寸）');
  } finally {
    for (const p of tempPngs) {
      try {
        fs.unlinkSync(p);
      } catch (_) {}
    }
  }
}

main().catch((e) => {
  console.error('[convert-icon]', e);
  process.exit(1);
});
