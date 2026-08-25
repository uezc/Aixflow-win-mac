/**
 * 官网安装包下载：Release 双区域（香港主源 + 北京副本）。
 * - latest.yml / latest-mac.yml
 * - Windows：优先 Aixflow-Installer-{version}.exe（玻璃拟态本机安装器）；
 *   回退 Aixflow-Windows-Setup-{version}.exe（NSIS stub）；再回退离线 zip
 * - latest.yml 仍指向 NSIS stub（供 electron-updater），玻璃安装器按版本号旁路解析
 *
 * 选源优先级：用户在页面选择的北京/香港线路（localStorage）>
 * VITE_DOWNLOAD_REGION=cn|hk|auto >
 * auto：aixflow.ai → 香港优先；aixflow.com.cn → 北京优先；失败互相回退
 * 可覆盖：VITE_RELEASE_CN_WIN_BASE / VITE_RELEASE_HK_WIN_BASE 等
 */

import { getSiteMediaRegion } from './siteRegion';

export type ReleaseDownloadRegion = 'cn' | 'hk';
export type DownloadRegionMode = ReleaseDownloadRegion | 'auto';

const PREFERRED_REGION_STORAGE_KEY = 'aixflow_download_region';
const PREFERRED_REGION_EVENT = 'aixflow-download-region';

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

function readStoredDownloadRegion(): ReleaseDownloadRegion | null {
  if (typeof window === 'undefined') return null;
  try {
    const v = String(window.localStorage.getItem(PREFERRED_REGION_STORAGE_KEY) || '')
      .trim()
      .toLowerCase();
    if (v === 'cn' || v === 'hk') return v;
  } catch {
    /* ignore */
  }
  return null;
}

/** 用户选择的安装包下载线路；未选时按站点/构建默认 */
export function getPreferredDownloadRegion(): ReleaseDownloadRegion {
  const stored = readStoredDownloadRegion();
  if (stored) return stored;
  const mode = getDownloadRegionMode();
  if (mode === 'cn' || mode === 'hk') return mode;
  return getSiteMediaRegion();
}

export function setPreferredDownloadRegion(region: ReleaseDownloadRegion): void {
  if (region !== 'cn' && region !== 'hk') return;
  try {
    window.localStorage.setItem(PREFERRED_REGION_STORAGE_KEY, region);
  } catch {
    /* ignore */
  }
  try {
    window.dispatchEvent(new CustomEvent(PREFERRED_REGION_EVENT, { detail: region }));
  } catch {
    /* ignore */
  }
}

export function subscribeDownloadRegion(
  callback: (region: ReleaseDownloadRegion) => void,
): () => void {
  if (typeof window === 'undefined') return () => {};
  const handler = () => callback(getPreferredDownloadRegion());
  window.addEventListener(PREFERRED_REGION_EVENT, handler);
  window.addEventListener('storage', handler);
  return () => {
    window.removeEventListener(PREFERRED_REGION_EVENT, handler);
    window.removeEventListener('storage', handler);
  };
}

function regionAttemptOrder(preferred?: ReleaseDownloadRegion): ReleaseDownloadRegion[] {
  const first = preferred ?? getPreferredDownloadRegion();
  return first === 'hk' ? ['hk', 'cn'] : ['cn', 'hk'];
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

/** 从 latest.yml 的 files[].size 取首个匹配文件名的字节数 */
export function parseInstallerSizeFromLatestYml(text: string, fileName: string): number | null {
  if (!fileName) return null;
  const lines = text.split('\n');
  let inTarget = false;
  for (const line of lines) {
    const urlMatch = line.match(/^\s*(?:-\s*)?url:\s*(.+)\s*$/);
    if (urlMatch) {
      inTarget = stripYamlQuotes(urlMatch[1]) === fileName;
      continue;
    }
    if (!inTarget) continue;
    const sizeMatch = line.match(/^\s*size:\s*(\d+)\s*$/);
    if (sizeMatch) {
      const n = Number(sizeMatch[1]);
      return Number.isFinite(n) && n > 0 ? n : null;
    }
    if (/^\s*-\s/.test(line) || /^[a-zA-Z]/.test(line)) inTarget = false;
  }
  return null;
}

export type InstallerArtifact = {
  url: string;
  fileName: string;
  version: string;
  size: number | null;
  platform: InstallerPlatform;
  region: ReleaseDownloadRegion;
};

export function formatInstallerBytes(n: number): string {
  if (!Number.isFinite(n) || n < 0) return '—';
  if (n >= 1024 ** 3) return `${(n / 1024 ** 3).toFixed(2)} GB`;
  if (n >= 1024 ** 2) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  if (n >= 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${Math.floor(n)} B`;
}

function buildObjectUrl(base: string, fileName: string): string {
  const normalized = base.replace(/\/+$/, '') + '/';
  return normalized + encodeURIComponent(fileName);
}

/** 给安装包直链加 cache-bust，避免浏览器/代理沿用同名旧 stub */
function withInstallerCacheBust(url: string, version: string): string {
  if (!url) return url;
  const sep = url.includes('?') ? '&' : '?';
  const v = encodeURIComponent(version || 'latest');
  return `${url}${sep}v=${v}&t=${Date.now()}`;
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

async function headContentLength(url: string): Promise<number | null> {
  try {
    const res = await fetch(url, { method: 'HEAD', cache: 'no-store', mode: 'cors' });
    if (!res.ok) return null;
    const raw = res.headers.get('content-length');
    if (!raw) return null;
    const n = Number(raw);
    return Number.isFinite(n) && n > 0 ? n : null;
  } catch {
    return null;
  }
}

async function resolveWindowsArtifactFromRegion(
  region: ReleaseDownloadRegion,
): Promise<InstallerArtifact | null> {
  const { winBase } = basesForRegion(region);
  const ymlUrl = LEGACY_YML && region === 'hk' ? LEGACY_YML : `${winBase.replace(/\/+$/, '')}/latest.yml`;
  const text = await fetchLatestYmlText(ymlUrl);
  if (!text) return null;

  const version = parseVersionFromLatestYml(text);

  // 1) 玻璃拟态本机安装器（官网默认入口；不改动 latest.yml 以免破坏应用内更新）
  if (version) {
    const glassName = `Aixflow-Installer-${version}.exe`;
    const glassUrl = buildObjectUrl(winBase, glassName);
    if (await headObjectExists(glassUrl)) {
      const size = await headContentLength(glassUrl);
      return {
        url: withInstallerCacheBust(glassUrl, version),
        fileName: glassName,
        version,
        size,
        platform: 'windows',
        region,
      };
    }
  }

  // 2) NSIS stub（后备）
  const fileName = parseInstallerFileNameFromLatestYml(text);
  if (fileName) {
    const stubUrl = buildObjectUrl(winBase, fileName);
    if (await headObjectExists(stubUrl)) {
      const ymlSize = parseInstallerSizeFromLatestYml(text, fileName);
      const size = ymlSize ?? (await headContentLength(stubUrl));
      return {
        url: withInstallerCacheBust(stubUrl, version || fileName),
        fileName,
        version: version || '',
        size,
        platform: 'windows',
        region,
      };
    }
  }

  // 3) 离线 zip
  if (version) {
    const offlineName = `Aixflow-Windows-Offline-${version}.zip`;
    const offlineUrl = buildObjectUrl(winBase, offlineName);
    if (await headObjectExists(offlineUrl)) {
      const size = await headContentLength(offlineUrl);
      return {
        url: withInstallerCacheBust(offlineUrl, version),
        fileName: offlineName,
        version,
        size,
        platform: 'windows',
        region,
      };
    }
  }
  return null;
}

export async function resolveWindowsInstallerArtifact(
  preferred?: ReleaseDownloadRegion,
): Promise<InstallerArtifact | null> {
  const first = preferred ?? getPreferredDownloadRegion();
  for (const region of regionAttemptOrder(first)) {
    const artifact = await resolveWindowsArtifactFromRegion(region);
    if (artifact) {
      console.info(
        `[Aixflow] 官网下载：使用${region === 'cn' ? '北京' : '香港'} Release`,
        artifact.url,
      );
      return artifact;
    }
    console.warn(`[Aixflow] 官网下载：${region === 'cn' ? '北京' : '香港'} Release 不可用，尝试下一源`);
  }
  console.warn('[Aixflow] 无法解析 Windows 安装包链接（北京/香港均失败）');
  return null;
}

export async function resolveWindowsInstallerUrl(
  preferred?: ReleaseDownloadRegion,
): Promise<string> {
  const artifact = await resolveWindowsInstallerArtifact(preferred);
  return artifact?.url || '';
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

async function resolveMacArtifactFromRegion(
  region: ReleaseDownloadRegion,
): Promise<InstallerArtifact | null> {
  const { macBase } = basesForRegion(region);
  const ymlUrl =
    (region === 'hk' ? import.meta.env.VITE_INSTALLER_LATEST_MAC_YML_URL?.trim() : '') ||
    `${macBase.replace(/\/+$/, '')}/latest-mac.yml`;
  const text = await fetchLatestYmlText(ymlUrl);
  if (!text) return null;
  const names = parseMacArtifactNamesFromLatestMacYml(text);
  const fileName = await pickMacArtifactName(names);
  if (!fileName) return null;
  const url = buildObjectUrl(macBase, fileName);
  const version = parseVersionFromLatestYml(text);
  const ymlSize = parseInstallerSizeFromLatestYml(text, fileName);
  const size = ymlSize ?? (await headContentLength(url));
  return {
    url,
    fileName,
    version: version || '',
    size,
    platform: 'mac',
    region,
  };
}

export async function resolveMacInstallerArtifact(
  preferred?: ReleaseDownloadRegion,
): Promise<InstallerArtifact | null> {
  const first = preferred ?? getPreferredDownloadRegion();
  for (const region of regionAttemptOrder(first)) {
    const artifact = await resolveMacArtifactFromRegion(region);
    if (artifact) return artifact;
    console.warn(`[Aixflow] Mac 下载：${region === 'cn' ? '北京' : '香港'} Release 不可用，尝试下一源`);
  }
  console.warn('[Aixflow] 无法解析 Mac 安装包链接');
  return null;
}

export async function resolveMacInstallerUrl(
  preferred?: ReleaseDownloadRegion,
): Promise<string> {
  const artifact = await resolveMacInstallerArtifact(preferred);
  return artifact?.url || '';
}

export async function resolveInstallerUrlForPlatform(
  platform: InstallerPlatform,
  preferred?: ReleaseDownloadRegion,
): Promise<string> {
  return platform === 'mac'
    ? resolveMacInstallerUrl(preferred)
    : resolveWindowsInstallerUrl(preferred);
}

export async function resolveInstallerArtifactForPlatform(
  platform: InstallerPlatform,
  preferred?: ReleaseDownloadRegion,
): Promise<InstallerArtifact | null> {
  return platform === 'mac'
    ? resolveMacInstallerArtifact(preferred)
    : resolveWindowsInstallerArtifact(preferred);
}

/** 只解析指定线路，不回退到另一条（用户自己选更快的源） */
export async function resolveInstallerArtifactStrict(
  platform: InstallerPlatform,
  region: ReleaseDownloadRegion,
): Promise<InstallerArtifact | null> {
  return platform === 'mac'
    ? resolveMacArtifactFromRegion(region)
    : resolveWindowsArtifactFromRegion(region);
}

/** 兼容旧引用 */
export const INSTALLER_LATEST_YML_URL =
  LEGACY_YML || `${HK_WIN_BASE.replace(/\/+$/, '')}/latest.yml`;
export const WIN_INSTALLER_BASE = LEGACY_WIN_BASE || HK_WIN_BASE;
export const INSTALLER_LATEST_MAC_YML_URL =
  import.meta.env.VITE_INSTALLER_LATEST_MAC_YML_URL?.trim() ||
  `${HK_MAC_BASE.replace(/\/+$/, '')}/latest-mac.yml`;
export const MAC_INSTALLER_BASE = import.meta.env.VITE_MAC_INSTALLER_BASE?.trim() || HK_MAC_BASE;
