/**
 * 从 RVC 训练产出（zip / .pth / 本地路径 / 远程 URL）读取 .pth 权重。
 */
import AdmZip from 'adm-zip';
import axios from 'axios';
import fs from 'fs';
import path from 'path';

function decodeLocalPath(urlOrPath: string): string {
  let filePath = (urlOrPath || '').trim();
  if (filePath.startsWith('local-resource://')) {
    filePath = filePath.replace(/^local-resource:\/\/+/, '');
  } else if (filePath.startsWith('file://')) {
    filePath = filePath.replace(/^file:\/\/+/, '');
  } else {
    return filePath;
  }
  filePath = filePath.replace(/%5C/gi, '/');
  if (filePath.startsWith('/') && filePath.length > 1 && filePath[2] === ':') filePath = filePath.slice(1);
  filePath = decodeURIComponent(filePath);
  if (filePath.match(/^[a-zA-Z]\//)) filePath = filePath[0].toUpperCase() + ':' + filePath.substring(1);
  return path.normalize(filePath);
}

function pickPthEntryFromZip(zip: AdmZip): AdmZip.IZipEntry {
  const entries = zip
    .getEntries()
    .filter((e) => !e.isDirectory && /\.pth$/i.test(e.entryName));
  if (entries.length === 0) {
    throw new Error('RVC 模型包（zip）内未找到 .pth 权重文件');
  }
  entries.sort((a, b) => b.header.size - a.header.size);
  return entries[0];
}

function extractPthFromZipBuffer(buffer: Buffer): { data: Buffer; baseName: string } {
  const zip = new AdmZip(buffer);
  const entry = pickPthEntryFromZip(zip);
  const baseName = path.basename(entry.entryName, path.extname(entry.entryName)) || 'model';
  return { data: entry.getData(), baseName };
}

async function readPackageBuffer(urlOrPath: string): Promise<Buffer> {
  const u = (urlOrPath || '').trim();
  if (!u) throw new Error('RVC 模型包路径为空');

  if (u.startsWith('local-resource://') || u.startsWith('file://')) {
    const normalized = decodeLocalPath(u);
    if (!fs.existsSync(normalized)) throw new Error(`RVC 模型包文件不存在: ${normalized}`);
    return fs.promises.readFile(normalized);
  }

  if (u.startsWith('http://') || u.startsWith('https://')) {
    const response = await axios.get(u, {
      responseType: 'arraybuffer',
      timeout: 180_000,
      maxContentLength: 500 * 1024 * 1024,
      validateStatus: (s) => s >= 200 && s < 300,
    });
    return Buffer.from(response.data);
  }

  throw new Error('RVC 模型包需为 local-resource://、file:// 或公网 URL');
}

/** 从 zip 或 .pth 文件读取权重 Buffer 及建议文件名 */
export async function readRvcPthFromModelPackage(
  urlOrPath: string,
  preferredName?: string,
): Promise<{ buffer: Buffer; fileName: string }> {
  const u = (urlOrPath || '').trim();
  const buffer = await readPackageBuffer(u);
  const lower = u.toLowerCase();
  const pathLooksZip = /\.zip(\?|$)/.test(lower);

  if (pathLooksZip) {
    const { data, baseName } = extractPthFromZipBuffer(buffer);
    const safe = (preferredName || baseName).replace(/[^\w\u4e00-\u9fff.-]+/g, '_') || 'model';
    return { buffer: data, fileName: `${safe}.pth` };
  }

  if (/\.pth(\?|$)/.test(lower)) {
    const fromUrl = u.split('?')[0].split(/[/\\]/).pop() || 'model.pth';
    return { buffer, fileName: fromUrl };
  }

  throw new Error('RVC 模型包需为 zip 或 .pth 格式');
}

function pickIndexEntryFromZip(zip: AdmZip): AdmZip.IZipEntry | null {
  const entries = zip
    .getEntries()
    .filter((e) => !e.isDirectory && /\.index$/i.test(e.entryName));
  if (entries.length === 0) return null;
  entries.sort((a, b) => b.header.size - a.header.size);
  return entries[0];
}

/** 将 zip / .pth 模型包解压/复制到 job 目录，供本地 RVC 推理使用 */
export async function materializeRvcModelForInfer(
  urlOrPath: string,
  targetDir: string,
): Promise<{ pthPath: string; indexPath?: string }> {
  fs.mkdirSync(targetDir, { recursive: true });
  const u = (urlOrPath || '').trim();
  if (!u) throw new Error('RVC 模型包路径为空');

  let localFile: string | null = null;
  if (u.startsWith('local-resource://') || u.startsWith('file://')) {
    localFile = decodeLocalPath(u);
    if (!fs.existsSync(localFile)) throw new Error(`RVC 模型包不存在: ${localFile}`);
  }

  const lower = (localFile || u).toLowerCase();
  const looksZip = /\.zip(\?|$)/.test(lower);

  if (localFile && !looksZip && /\.pth(\?|$)/.test(lower)) {
    const dest = path.join(targetDir, path.basename(localFile));
    await fs.promises.copyFile(localFile, dest);
    const siblingIndex = localFile.replace(/\.pth(\?.*)?$/i, '.index');
    let indexPath: string | undefined;
    if (fs.existsSync(siblingIndex)) {
      indexPath = path.join(targetDir, path.basename(siblingIndex));
      await fs.promises.copyFile(siblingIndex, indexPath);
    }
    return { pthPath: dest, indexPath };
  }

  const buffer = localFile ? await fs.promises.readFile(localFile) : await readPackageBuffer(u);
  const isZip = looksZip || (() => {
    try {
      new AdmZip(buffer);
      return true;
    } catch {
      return false;
    }
  })();

  if (isZip) {
    const zip = new AdmZip(buffer);
    const pthEntry = pickPthEntryFromZip(zip);
    const pthPath = path.join(targetDir, path.basename(pthEntry.entryName));
    await fs.promises.writeFile(pthPath, pthEntry.getData());
    const indexEntry = pickIndexEntryFromZip(zip);
    let indexPath: string | undefined;
    if (indexEntry) {
      indexPath = path.join(targetDir, path.basename(indexEntry.entryName));
      await fs.promises.writeFile(indexPath, indexEntry.getData());
    }
    return { pthPath, indexPath };
  }

  if (/\.pth(\?|$)/.test(lower)) {
    const fromUrl = u.split('?')[0].split(/[/\\]/).pop() || 'model.pth';
    const pthPath = path.join(targetDir, fromUrl);
    await fs.promises.writeFile(pthPath, buffer);
    return { pthPath };
  }

  throw new Error('RVC 模型包需为 zip 或 .pth 格式');
}
