#!/usr/bin/env node
/**
 * 跨平台删除 dist-electron（Windows 的 if exist / rd 在 macOS/Linux 不可用）
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dir = path.join(__dirname, '..', 'dist-electron');
if (fs.existsSync(dir)) {
  fs.rmSync(dir, { recursive: true, force: true });
  console.log('[clean-dist-electron] 已删除 dist-electron');
}
