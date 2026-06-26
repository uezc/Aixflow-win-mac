import fs from 'fs';
import path from 'path';

const IMAGE_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.webp', '.bmp', '.gif'];

function decodeLocalPath(url: string): string | null {
  if (!url) return null;
  let filePath = '';
  if (url.startsWith('local-resource://')) {
    filePath = url.replace(/^local-resource:\/\/+/, '');
  } else if (url.startsWith('file://')) {
    filePath = url.replace(/^file:\/\/+/, '');
  } else {
    return null;
  }
  if (filePath.startsWith('/') && filePath.length > 1 && filePath[2] === ':') filePath = filePath.slice(1);
  filePath = decodeURIComponent(filePath);
  if (filePath.match(/^[/\\]+[a-zA-Z]:[/\\]/)) filePath = filePath.replace(/^[/\\]+/, '');
  if (filePath.match(/^[a-zA-Z]\//)) filePath = filePath[0].toUpperCase() + ':' + filePath.substring(1);
  return path.normalize(filePath);
}

function toUrl(protocolSource: string, normalizedPath: string): string {
  const p = normalizedPath.replace(/\\/g, '/');
  if (protocolSource.startsWith('file://')) return `file://${p}`;
  return `local-resource://${p}`;
}

function resolveOriginalFromPreviewPath(localPath: string): string | null {
  const parsed = path.parse(localPath);
  const previewBase = parsed.name;
  if (!/_preview$/i.test(previewBase)) return null;
  const originalStem = previewBase.replace(/_preview$/i, '');
  if (!originalStem) return null;

  const sameExtCandidate = path.join(parsed.dir, `${originalStem}${parsed.ext}`);
  if (fs.existsSync(sameExtCandidate) && fs.statSync(sameExtCandidate).isFile()) return sameExtCandidate;

  for (const ext of IMAGE_EXTENSIONS) {
    const candidate = path.join(parsed.dir, `${originalStem}${ext}`);
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
  }
  return null;
}

export function resolveOriginalImageUrlIfPreview(imageUrl: string): string {
  try {
    const localPath = decodeLocalPath(imageUrl);
    if (!localPath) return imageUrl;
    const originalPath = resolveOriginalFromPreviewPath(localPath);
    if (!originalPath) return imageUrl;
    return toUrl(imageUrl, originalPath);
  } catch {
    return imageUrl;
  }
}

export function resolveOriginalImageUrls(imageUrls: string[] | undefined): string[] {
  if (!Array.isArray(imageUrls)) return [];
  return imageUrls.map((url) => resolveOriginalImageUrlIfPreview(url));
}
