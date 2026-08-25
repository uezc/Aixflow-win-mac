/**
 * 解析 OSS latest.yml，定位 nsis-web stub + 主包（与官网/electron-updater 同源）。
 */

export type ReleaseRegion = 'cn' | 'hk';

export type ResolvedReleaseMeta = {
  version: string;
  stubName: string;
  packageName: string;
  packageBytes: number;
  stubUrl: string;
  packageUrl: string;
  region: ReleaseRegion;
  feedBase: string;
};

const HK_WIN_BASE =
  process.env.VITE_RELEASE_HK_WIN_BASE?.trim() ||
  'https://nexflow-temp-images.oss-cn-hongkong.aliyuncs.com/aixflow%20uploads/';
const CN_WIN_BASE =
  process.env.VITE_RELEASE_CN_WIN_BASE?.trim() ||
  'https://nexflow-temp-images-bj.oss-cn-beijing.aliyuncs.com/aixflow%20uploads/';

function stripYamlQuotes(v: string): string {
  let s = v.trim();
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    s = s.slice(1, -1).trim();
  }
  return s;
}

function baseFor(region: ReleaseRegion): string {
  return (region === 'cn' ? CN_WIN_BASE : HK_WIN_BASE).replace(/\/+$/, '') + '/';
}

function objectUrl(base: string, fileName: string): string {
  return base + encodeURIComponent(fileName);
}

function parseVersion(text: string): string {
  const m = text.match(/^version:\s*(.+)$/m);
  return m?.[1] ? stripYamlQuotes(m[1]) : '';
}

function parseStubName(text: string): string {
  const pathMatch = text.match(/^path:\s*(.+)$/m);
  let name = pathMatch?.[1] ? stripYamlQuotes(pathMatch[1]) : '';
  if (name && /\.exe$/i.test(name) && !/\.nsis\.7z$/i.test(name)) return name;
  for (const line of text.split('\n')) {
    const m = line.match(/^\s*(?:-\s*)?url:\s*(.+)\s*$/);
    if (!m) continue;
    const candidate = stripYamlQuotes(m[1]);
    if (/\.exe$/i.test(candidate) && !/\.nsis\.7z$/i.test(candidate)) return candidate;
  }
  return '';
}

function parsePackage(text: string): { name: string; size: number } {
  let name = '';
  let size = 0;
  const pathM = text.match(/^\s+(?:path|file):\s*(.+)$/m);
  if (pathM) {
    const n = stripYamlQuotes(pathM[1]);
    if (/\.nsis\.7z$/i.test(n)) name = n;
  }
  const sizeM = text.match(/packages:\s*\n\s*x64:\s*\n\s*size:\s*(\d+)/);
  if (sizeM) size = Number(sizeM[1]) || 0;
  if (!name) {
    const loose = text.match(/nexflow-[\d.]+-x64\.nsis\.7z/i);
    if (loose) name = loose[0];
  }
  if (!size && name) {
    const block = text.split('\n');
    let inPkg = false;
    for (const line of block) {
      if (/^\s+(?:path|file):\s*/.test(line) && line.includes(name)) inPkg = true;
      if (inPkg) {
        const sm = line.match(/^\s+size:\s*(\d+)\s*$/);
        if (sm) {
          size = Number(sm[1]) || 0;
          break;
        }
      }
    }
  }
  return { name, size };
}

async function fetchText(url: string): Promise<string | null> {
  try {
    const res = await fetch(`${url}${url.includes('?') ? '&' : '?'}t=${Date.now()}`, {
      cache: 'no-store',
    });
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  }
}

async function headOk(url: string): Promise<boolean> {
  try {
    const res = await fetch(url, { method: 'HEAD', cache: 'no-store' });
    return res.ok;
  } catch {
    return false;
  }
}

async function resolveFromRegion(region: ReleaseRegion): Promise<ResolvedReleaseMeta | null> {
  const feedBase = baseFor(region);
  const text = await fetchText(`${feedBase}latest.yml`);
  if (!text) return null;
  const version = parseVersion(text);
  const stubName = parseStubName(text) || (version ? `Aixflow-Windows-Setup-${version}.exe` : '');
  const pkg = parsePackage(text);
  const packageName = pkg.name || (version ? `nexflow-${version}-x64.nsis.7z` : '');
  if (!version || !stubName || !packageName) return null;

  const stubUrl = objectUrl(feedBase, stubName);
  const packageUrl = objectUrl(feedBase, packageName);
  if (!(await headOk(packageUrl))) return null;
  // stub 可选校验：缺失时仍尝试（极少见）
  const stubExists = await headOk(stubUrl);
  if (!stubExists) return null;

  return {
    version,
    stubName,
    packageName,
    packageBytes: pkg.size || 0,
    stubUrl,
    packageUrl,
    region,
    feedBase,
  };
}

/** 国内优先北京，失败回退香港 */
export async function resolveReleaseMeta(
  order: ReleaseRegion[] = ['cn', 'hk'],
): Promise<ResolvedReleaseMeta | null> {
  for (const region of order) {
    const meta = await resolveFromRegion(region);
    if (meta) return meta;
  }
  return null;
}
