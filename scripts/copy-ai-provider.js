import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const src = path.join(__dirname, '../src/main/ai-provider.js');
const dest = path.join(__dirname, '../dist-electron/main/ai-provider.js');

if (fs.existsSync(src)) {
    const destDir = path.dirname(dest);
    if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true });
    fs.copyFileSync(src, dest);
    console.log('[copy-ai-provider] 已复制到 dist-electron/main/ai-provider.js');
}

const snipSrc = path.join(__dirname, '../src/main/snipOverlay.html');
const snipDest = path.join(__dirname, '../dist-electron/main/snipOverlay.html');
if (fs.existsSync(snipSrc)) {
    const snipDir = path.dirname(snipDest);
    if (!fs.existsSync(snipDir)) fs.mkdirSync(snipDir, { recursive: true });
    fs.copyFileSync(snipSrc, snipDest);
    console.log('[copy-ai-provider] 已复制 snipOverlay.html');
}
