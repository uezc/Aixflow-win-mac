/**
 * YouTube 页视频抓取（yt-dlp）：可选 Cookie、自适应网络（直连 → 继承系统代理变量 → UI 引导）。
 * 不经 FC/OSS。spawn argv 勿改 shell: true。
 */
import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';

const PREFIX = '[YOUTUBE-SCRAPER]';

/** 与渲染进程 VideoNode 解析保持一致 */
export const YOUTUBE_SCRAPE_PROXY_GUIDE_MARKER = '[[NX:SHOW_PROXY_SETTING_UI]]';

export type YtDlpSpawnInvocation = { command: string; prefixArgs: string[] };

const CHROME_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

const FRIENDLY_SIGN_IN =
  'YouTube 需要登录或人机验证（会员、年龄限制、地区限制等）。可在浏览器登录 youtube.com 后导出 Netscape cookies.txt，在 .env 设置 NX_YOUTUBE_COOKIES=绝对路径，保存并重启应用后再试。';

const FRIENDLY_ACCESS =
  'YouTube 返回拒绝访问或需更新提取器。请执行 pip install -U yt-dlp；会员/年龄限制等可配置 NX_YOUTUBE_COOKIES。';

/** 主进程可识别；经 IPC 到前端时优先用 message 内 MARKER */
export class YoutubeScrapeNetworkError extends Error {
  readonly suggestedAction = 'SHOW_PROXY_SETTING_UI' as const;
  constructor(message: string) {
    super(message);
    this.name = 'YoutubeScrapeNetworkError';
  }
}

/** 网络层不可达（国内无代理/代理死掉）：勿长时间重试，尽快提示用户 */
function isUnreachableNetworkFailure(stderr: string): boolean {
  return (
    /timed out|connect timeout|Connection timed out|ConnectTimeout|TimeoutError|ETIMEDOUT|WinError 10060|\b10060\b|Unable to download (?:webpage|API page).*timed out|TransportError.*timed out/i.test(
      stderr,
    ) ||
    /Unable to connect to proxy|ProxyError|Connection refused|Failed to establish a new connection|WinError 10061|\b10061\b|Name or service not known|Network is unreachable|No route to host|Temporary failure in name resolution/i.test(
      stderr,
    )
  );
}

function spawnYtDlpOnce(
  invocation: YtDlpSpawnInvocation,
  args: string[],
  env: NodeJS.ProcessEnv,
): Promise<{ ok: boolean; stderr: string }> {
  const allArgs = [...invocation.prefixArgs, ...args];
  return new Promise((resolve) => {
    const child = spawn(invocation.command, allArgs, { windowsHide: true, env });
    let stderr = '';
    child.stderr?.on('data', (c) => {
      stderr += String(c);
    });
    child.on('error', (err) => {
      resolve({ ok: false, stderr: `${stderr}\n${err instanceof Error ? err.message : String(err)}` });
    });
    child.on('close', (code) => {
      if (code === 0) resolve({ ok: true, stderr: '' });
      else resolve({ ok: false, stderr });
    });
  });
}

/** Referer / Origin / UA；可选 NX_YOUTUBE_COOKIES */
export function buildYoutubeYtDlpClientArgs(): string[] {
  const out: string[] = [
    '--add-header',
    'Referer:https://www.youtube.com/',
    '--add-header',
    'Origin:https://www.youtube.com',
    '--user-agent',
    CHROME_UA,
  ];
  const cookiesPath = process.env.NX_YOUTUBE_COOKIES?.trim();
  if (cookiesPath && fs.existsSync(cookiesPath) && fs.statSync(cookiesPath).isFile()) {
    const resolved = path.resolve(cookiesPath);
    out.push('--cookies', resolved);
    console.log(`${PREFIX} 使用可选 Cookie: ${resolved}`);
  } else if (cookiesPath) {
    console.warn(`${PREFIX} NX_YOUTUBE_COOKIES 已配置但文件不存在或非普通文件: ${cookiesPath}`);
  }
  return out;
}

/**
 * 缩短国内/坏代理场景等待：降低 socket 等待与 yt-dlp 重试次数（仍由 yt-dlp 内部发起请求，但更快失败）。
 */
export function buildYoutubeYtDlpSpeedArgs(): string[] {
  return ['--socket-timeout', '12', '--retries', '1', '--fragment-retries', '1', '--extractor-retries', '1'];
}

/** 非「双次超时」类失败：登录 / 403 / 其它（不含单独的超时长文，超时由自适应链路处理） */
export function formatYoutubeYtDlpStderrAsError(stderr: string): Error {
  const trimmed = stderr.trim();
  const tail = trimmed.slice(-2800) || trimmed;
  if (
    /Sign in to confirm|not a bot|login required|Log in to|Private video|members only|age-restricted|This video is available to this channel/i.test(
      trimmed,
    )
  ) {
    return new Error(`${FRIENDLY_SIGN_IN}\n\n———— yt-dlp 输出（节选）————\n${tail}`);
  }
  if (/HTTP Error 403|\b403 Forbidden\b|consent cookie|PO token|blocked by.*?interstitial|This video is not available/i.test(trimmed)) {
    return new Error(`${FRIENDLY_ACCESS}\n\n———— yt-dlp 输出（节选）————\n${tail}`);
  }
  return new Error(tail || trimmed || 'yt-dlp 执行失败');
}

/**
 * 自适应链路：① 不传 --proxy，由 yt-dlp/urllib 自行处理（海外默认）。
 * ② 仅当进程里已有 HTTP(S)_PROXY 且第 1 级曾剥离代理时，再跑一次保留代理环境（与第 1 级不同才有意义）。
 * ③ 网络不可达：尽快失败并抛出带 MARKER 的错误，供前端引导（避免无代理用户白等两轮完整 yt-dlp 重试）。
 */
export async function runYoutubeYtDlpAdaptive(params: {
  invocation: YtDlpSpawnInvocation;
  siteArgs: string[];
  downloadArgs: string[];
  /** true：第 2 级与第 1 级环境相同或无需再试，跳过以免重复耗时 */
  skipSecondAttempt: boolean;
  /** 默认级：与历史一致，可按需剥离环境变量中的代理，避免死代理 */
  buildEnvTier1: () => NodeJS.ProcessEnv;
  /** 检测级：保留 HTTPS_PROXY 等，便于系统/VPN 已注入代理时由 urllib 自动使用 */
  buildEnvTier2: () => NodeJS.ProcessEnv;
}): Promise<void> {
  const { invocation, siteArgs, downloadArgs, skipSecondAttempt, buildEnvTier1, buildEnvTier2 } = params;
  const argv = [...siteArgs, ...downloadArgs];

  const r1 = await spawnYtDlpOnce(invocation, argv, buildEnvTier1());
  if (r1.ok) return;
  if (!isUnreachableNetworkFailure(r1.stderr)) {
    throw formatYoutubeYtDlpStderrAsError(r1.stderr);
  }

  if (skipSecondAttempt) {
    console.log(`${PREFIX} 网络不可达且无可用的第二级代理环境，跳过重复尝试`);
    const human =
      '导入在线视频失败：当前网络无法访问 YouTube（或连接过慢已中止）。若在国内，请配置可用代理/VPN 后再试；也可在系统环境变量设置 HTTPS_PROXY 后重启应用。';
    const payload = JSON.stringify({ suggestedAction: 'SHOW_PROXY_SETTING_UI' as const });
    throw new YoutubeScrapeNetworkError(`${human}\n${YOUTUBE_SCRAPE_PROXY_GUIDE_MARKER}\n${payload}`);
  }

  console.log(`${PREFIX} 第 1 级网络失败，尝试第 2 级：保留 HTTPS_PROXY / HTTP_PROXY 等环境变量`);
  const r2 = await spawnYtDlpOnce(invocation, argv, buildEnvTier2());
  if (r2.ok) return;
  if (!isUnreachableNetworkFailure(r2.stderr)) {
    throw formatYoutubeYtDlpStderrAsError(r2.stderr);
  }

  const human =
    '导入在线视频遇到网络限制：直连与系统代理环境均无法连接 YouTube。请检查代理地址是否可用、VPN 是否允许本机应用走代理，或在 .env 修正 HTTPS_PROXY 后重启应用。';
  const payload = JSON.stringify({ suggestedAction: 'SHOW_PROXY_SETTING_UI' as const });
  throw new YoutubeScrapeNetworkError(`${human}\n${YOUTUBE_SCRAPE_PROXY_GUIDE_MARKER}\n${payload}`);
}
