#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.join(__dirname, '..');
const buildDir = path.join(projectRoot, 'build');
const publicDir = path.join(projectRoot, 'public');
const publicIcon = path.join(publicDir, 'icon.png');
const brandLoginLogo = path.join(publicDir, 'aixflow-login-logo.png');
const buildIcon = ['icon.svg', 'icon.png', 'icon.jpg', 'image.svg', 'image.png', 'image.jpg']
  .map((name) => path.join(buildDir, name))
  .find((p) => fs.existsSync(p));

async function writeSquareIconPng(srcPath, destPath) {
  const sharp = (await import('sharp')).default;
  const ext = path.extname(srcPath).toLowerCase();
  const input = ext === '.svg' ? sharp(srcPath, { density: 300 }) : sharp(srcPath);
  await input
    .resize(512, 512, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 1 } })
    .png()
    .toFile(destPath);
}

async function main() {
  try {
    fs.mkdirSync(publicDir, { recursive: true });
    if (buildIcon) {
      const ext = path.extname(buildIcon).toLowerCase();
      if (ext === '.png') {
        fs.copyFileSync(buildIcon, publicIcon);
      } else {
        await writeSquareIconPng(buildIcon, publicIcon);
      }
      console.log(`[copy-icon] ${path.relative(projectRoot, buildIcon)} -> public/icon.png`);
      return;
    }
    if (fs.existsSync(brandLoginLogo)) {
      await writeSquareIconPng(brandLoginLogo, publicIcon);
      console.log('[copy-icon] public/aixflow-login-logo.png -> public/icon.png');
    }
  } catch (e) {
    console.warn('[copy-icon]', e.message);
  }
}

main();
