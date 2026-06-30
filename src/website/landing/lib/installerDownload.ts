/**
 * 官网安装包下载：Release 双区域（香港主源 + 北京副本）。
 * - latest.yml / latest-mac.yml
 * - Windows：优先 Aixflow-Windows-Setup-{version}.exe（在线安装，无需解压）；离线 zip 为备用
 *
 * 选源：VITE_DOWNLOAD_REGION=cn|hk|auto（默认 auto：先试北京，失败回退香港）
 * 可覆盖：VITE_RELEASE_CN_WIN_BASE / VITE_RELEASE_HK_WIN_BASE 等
 */

export type ReleaseDownloadRegion = 'cn' | 'hk';
export type DownloadRegionMode = ReleaseDownloadRegion | 'auto';

const HK_WIN_BASE =
  import.meta.env.VITE_RELEASE_HK_WIN_BASE?.trim() ||
  'https://nexflow-temp-images.oss-cn-hongkong.aliyuncs.com/aixflow%20uploads/';
const HK_MAC_BASE =
  import.meta.env.VITE_RELEASE_HK_MAC_BASE?.trim() ||
  'https://nexflow-temp-images.oss-cn-hongkong.aliyuncs.com/Aixflow%20uploads%20Mac/';
const CN_WIN_BASE =
  import.meta.env.VITE_RELEASE_CN_WIN_BASE?.trim() ||
  'https://nexflow-temp-images-bj.oss-cn-beijing.aliyuncs.com/aixflow%20uploads/';
const CN_MAC_BASE =
  import.meta.env.VITE_RELEASE_CN_MAC_BASE?.trim() ||
  'https://nexflow-temp-images-bj.oss-cn-beijing.aliyuncs.com/Aixflow%20uploads%20Mac/';

/** @deprecated 兼容旧 env */
const LEGACY_WIN_BASE = import.meta.env.VITE_WIN_INSTALLER_BASE?.trim();
const LEGACY_YML = import.meta.env.VITE_INSTALLER_LATEST_YML_URL?.trim();

export function getDownloadRegionMode(): DownloadRegionMode {
  const raw = String(import.meta.env.VITE_DOWNLOAD_REGION || 'auto').trim().toLowerCase();
  if (raw === 'cn' || raw === 'hk') return raw;
  return 'auto';
}

function regionAttemptOrder(mode: DownloadRegionMode): ReleaseDownloadRegion[] {
  if (mode === 'cn') return ['cn', 'hk'];
  if (mode === 'hk') return ['hk'];
  return ['cn', 'hk'];
}

function basesForRegion(region: ReleaseDownloadRegion): { winBase: string; macBase: string } {
  if (region === 'cn') {
    return { winBase: CN_WIN_BASE, macBase: CN_MAC_BASE };
  }
  return {
    winBase: LEGACY_WIN_BASE || HK_WIN_BASE,
    macBase: import.meta.env.VITE_MAC_INSTALLER_BASE?.trim() || HK_MAC_BASE,
  };
}

export type InstallerPlatform = 'windows' | 'mac';

export function detectInstallerPlatform(): InstallerPlatform {
  if (typeof navigator === 'undefined') return 'windows';
  const ua = navigator.userAgent || '';
  if (/Win(dows|32|64|CE)/i.test(ua)) return 'windows';
  if (/Mac|iPhone|iPad|iPod/i.test(ua)) return 'mac';
  return 'windows';
}

function stripYamlQuotes(v: string): string {
  let s = v.trim();
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    s = s.slice(1, -1).trim();
  }
  return s;
}

export function parseVersionFromLatestYml(text: string): string {
  const m = text.match(/^version:\s*(.+)$/m);
  return m?.[1] ? stripYamlQuotes(m[1]) : '';
}

export function parseInstallerFileNameFromLatestYml(text: string): string {
  const pathMatch = text.match(/^path:\s*(.+)$/m);
  let name = pathMatch?.[1] ? stripYamlQuotes(pathMatch[1]) : '';
  if (name && /\.exe$/i.test(name)) return name;

  for (const line of text.split('\n')) {
    const m = line.match(/^\s*(?:-\s*)?url:\s*(.+)\s*$/);
    if (!m) continue;
    const candidate = stripYamlQuotes(m[1]);
    if (/\.exe$/i.test(candidate) && !/\.nsis\.7z$/i.test(candidate)) return candidate;
  }
  return '';
}

function buildObjectUrl(base: string, fileName: string): string {
  const normalized = base.replace(/\/+$/, '') + '/';
  return normalized + encodeURIComponent(fileName);
}

async function fetchLatestYmlText(ymlUrl: string): Promise<string | null> {
  try {
    const sep = ymlUrl.includes('?') ? '&' : '?';
    const res = await fetch(`${ymlUrl}${sep}t=${Date.now()}`, {
      cache: 'no-store',
      method: 'GET',
      mode: 'cors',
    });
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  }
}

async function headObjectExists(url: string): Promise<boolean> {
  try {
    const res = await fetch(url, { method: 'HEAD', cache: 'no-store', mode: 'cors' });
    return res.ok;
  } catch {
    return false;
  }
}

async function resolveWindowsFromRegion(region: ReleaseDownloadRegion): Promise<string | null> {
  const { winBase } = basesForRegion(region);
  const ymlUrl = LEGACY_YML && region === 'hk' ? LEGACY_YML : `${winBase.replace(/\/+$/, '')}/latest.yml`;
  const text = await fetchLatestYmlText(ymlUrl);
  if (!text) return null;

  const version = parseVersionFromLatestYml(text);
  const fileName = parseInstallerFileNameFromLatestYml(text);
  if (fileName) {
    const stubUrl = buildObjectUrl(winBase, fileName);
    if (await headObjectExists(stubUrl)) return stubUrl;
  }
  if (version) {
    const offlineUrl = buildObjectUrl(winBase, `Aixflow-Windows-Offline-${version}.zip`);
    if (await headObjectExists(offlineUrl)) return offlineUrl;
  }
  return null;
}

export async function resolveWindowsInstallerUrl(): Promise<string> {
  const mode = getDownloadRegionMode();
  for (const region of regionAttemptOrder(mode)) {
    const url = await resolveWindowsFromRegion(region);
    if (url) {
      if (region === 'cn' && mode === 'auto') {
        console.info('[Aixflow] 官网下载：使用北京 Release', url);
      }
      return url;
    }
    console.warn(`[Aixflow] 官网下载：${region === 'cn' ? '北京' : '香港'} Release 不可用，尝试下一源`);
  }
  console.warn('[Aixflow] 无法解析 Windows 安装包链接（北京/香港均失败）');
  return '';
}

function parseMacArtifactNamesFromLatestMacYml(text: string): string[] {
  const names: string[] = [];
  for (const line of text.split('\n')) {
    const m = line.match(/^\s*url:\s*(.+)\s*$/);
    if (!m) continue;
    const name = stripYamlQuotes(m[1]);
    if (/\.(zip|dmg)$/i.test(name)) names.push(name);
  }
  if (names.length === 0) {
    const pm = text.match(/^path:\s*(.+)$/m);
    if (pm) {
      const name = stripYamlQuotes(pm[1]);
      if (/\.(zip|dmg)$/i.test(name)) names.push(name);
    }
  }
  return names;
}

async function guessAppleSilicon(): Promise<boolean> {
  try {
    const uad = (navigator as Navigator & {
      userAgentData?: { getHighEntropyValues?: (hints: string[]) => Promise<{ architecture?: string }> };
    }).userAgentData;
    if (uad?.getHighEntropyValues) {
      const v = await uad.getHighEntropyValues(['architecture']);
      if (v.architecture === 'arm') return true;
      if (v.architecture === 'x86') return false;
    }
  } catch {
    /* ignore */
  }
  return /arm64|aarch64/i.test(navigator.userAgent);
}

async function pickMacArtifactName(names: string[]): Promise<string> {
  if (names.length === 0) return '';
  if (names.length === 1) return names[0];
  const arm = names.find((n) => /arm64|aarch64/i.test(n));
  const intel = names.find((n) => /(^|[^a-z0-9])x64([^a-z0-9]|$)/i.test(n) && !/arm64/i.test(n));
  const silicon = await guessAppleSilicon();
  if (silicon && arm) return arm;
  if (!silicon && intel) return intel;
  return arm || intel || names[0];
}

async function resolveMacFromRegion(region: ReleaseDownloadRegion): Promise<string | null> {
  const { macBase } = basesForRegion(region);
  const ymlUrl =
    (region === 'hk' ? import.meta.env.VITE_INSTALLER_LATEST_MAC_YML_URL?.trim() : '') ||
    `${macBase.replace(/\/+$/, '')}/latest-mac.yml`;
  const text = await fetchLatestYmlText(ymlUrl);
  if (!text) return null;
  const names = parseMacArtifactNamesFromLatestMacYml(text);
  const fileName = await pickMacArtifactName(names);
  if (!fileName) return null;
  return buildObjectUrl(macBase, fileName);
}

export async function resolveMacInstallerUrl(): Promise<string> {
  const mode = getDownloadRegionMode();
  for (const region of regionAttemptOrder(mode)) {
    const url = await resolveMacFromRegion(region);
    if (url) return url;
    console.warn(`[Aixflow] Mac 下载：${region === 'cn' ? '北京' : '香港'} Release 不可用，尝试下一源`);
  }
  console.warn('[Aixflow] 无法解析 Mac 安装包链接');
  return '';
}

export async function resolveInstallerUrlForPlatform(platform: InstallerPlatform): Promise<string> {
  return platform === 'mac' ? resolveMacInstallerUrl() : resolveWindowsInstallerUrl();
}

/** 兼容旧引用 */
export const INSTALLER_LATEST_YML_URL =
  LEGACY_YML || `${HK_WIN_BASE.replace(/\/+$/, '')}/latest.yml`;
export const WIN_INSTALLER_BASE = LEGACY_WIN_BASE || HK_WIN_BASE;
export const INSTALLER_LATEST_MAC_YML_URL =
  import.meta.env.VITE_INSTALLER_LATEST_MAC_YML_URL?.trim() ||
  `${HK_MAC_BASE.replace(/\/+$/, '')}/latest-mac.yml`;
export const MAC_INSTALLER_BASE = import.meta.env.VITE_MAC_INSTALLER_BASE?.trim() || HK_MAC_BASE;
