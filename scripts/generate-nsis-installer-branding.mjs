#!/usr/bin/env node
/**
 * 生成 NSIS 安装器暗黑品牌图（164×314 侧栏、150×57 顶栏），与官网 #051A24 一致。
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const buildDir = path.join(__dirname, '..', 'build');

/** @type {{ r: number; g: number; b: number }} */
const BRAND = { r: 5, g: 26, b: 36 };
/** @type {{ r: number; g: number; b: number }} */
const BRAND_DEEP = { r: 2, g: 14, b: 22 };
/** @type {{ r: number; g: number; b: number }} */
const ACCENT = { r: 34, g: 211, b: 238 };

/**
 * @param {string} filePath
 * @param {number} width
 * @param {number} height
 * @param {(x: number, y: number) => { r: number; g: number; b: number }} getPixel
 */
function writeBmp24(filePath, width, height, getPixel) {
  const rowSize = Math.ceil((width * 3) / 4) * 4;
  const pixelDataSize = rowSize * height;
  const fileSize = 54 + pixelDataSize;
  const buf = Buffer.alloc(fileSize);

  buf.write('BM', 0);
  buf.writeUInt32LE(fileSize, 2);
  buf.writeUInt32LE(54, 10);
  buf.writeUInt32LE(40, 14);
  buf.writeInt32LE(width, 18);
  buf.writeInt32LE(height, 22);
  buf.writeUInt16LE(1, 26);
  buf.writeUInt16LE(24, 28);

  let offset = 54;
  for (let y = height - 1; y >= 0; y--) {
    for (let x = 0; x < width; x++) {
      const { r, g, b } = getPixel(x, y);
      buf[offset++] = b;
      buf[offset++] = g;
      buf[offset++] = r;
    }
    offset += rowSize - width * 3;
  }

  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, buf);
}

function lerp(a, b, t) {
  return Math.round(a + (b - a) * t);
}

function mix(c1, c2, t) {
  return {
    r: lerp(c1.r, c2.r, t),
    g: lerp(c1.g, c2.g, t),
    b: lerp(c1.b, c2.b, t),
  };
}

function generateSidebar() {
  const w = 164;
  const h = 314;
  writeBmp24(path.join(buildDir, 'installerSidebar.bmp'), w, h, (x, y) => {
    const t = y / (h - 1);
    const base = mix(BRAND_DEEP, BRAND, t * 0.85 + 0.08);
    if (x < 4) return ACCENT;
    if (x < 7) return mix(ACCENT, base, 0.55);
    return base;
  });
}

function generateHeader() {
  const w = 150;
  const h = 57;
  writeBmp24(path.join(buildDir, 'installerHeader.bmp'), w, h, (x, y) => {
    if (y >= h - 2) return ACCENT;
    const t = x / (w - 1);
    return mix(BRAND, BRAND_DEEP, t * 0.35);
  });
}

function main() {
  generateSidebar();
  generateHeader();
  console.log('[generate-nsis-installer-branding] 已生成 build/installerSidebar.bmp、build/installerHeader.bmp');
}

main();
