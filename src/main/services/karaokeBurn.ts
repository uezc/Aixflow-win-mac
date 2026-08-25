/**
 * 卡拉OK：写临时 ASS + ffmpeg 烧录（ass/subtitles 滤镜）+ 系统中文字体探测。
 * 方案 C 默认路径：KaraokeWipe + 整句 \\kf（正歌无歌词 \\clip）。
 */

import { dialog, BrowserWindow } from 'electron';
import { spawn, type ChildProcess } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { buildKaraokeAss } from '../../shared/karaoke/buildAss.js';
import type { KaraokeProject } from '../../shared/karaoke/types.js';
import { resolveKaraokeAudioSource } from '../../shared/karaoke/types.js';
import { localResourceManager, resolveLocalMediaFilePath } from './localResourceManager.js';

/** 烧录中的 ffmpeg 子进程，供取消 IPC 杀掉 */
const activeKaraokeBurnChildren = new Set<ChildProcess>();
/** Windows taskkill 后 signal 常为 null，用此标记区分取消/超时与真实失败 */
const karaokeBurnAbortReason = new WeakMap<ChildProcess, 'cancelled' | 'timeout'>();

/** 默认烧录超时（避免永久卡住）；长片可再放宽 */
export const KARAOKE_BURN_TIMEOUT_MS = 15 * 60 * 1000;

function trackKaraokeBurnChild(child: ChildProcess): ChildProcess {
  activeKaraokeBurnChildren.add(child);
  const cleanup = () => {
    activeKaraokeBurnChildren.delete(child);
  };
  child.once('close', cleanup);
  child.once('error', cleanup);
  return child;
}

function killKaraokeBurnChild(child: ChildProcess, reason: 'cancelled' | 'timeout' = 'cancelled'): void {
  karaokeBurnAbortReason.set(child, reason);
  try {
    if (process.platform === 'win32' && child.pid) {
      spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], {
        windowsHide: true,
        shell: false,
        stdio: 'ignore',
      });
    } else {
      child.kill('SIGKILL');
    }
  } catch {
    /* ignore */
  }
}

function killTrackedKaraokeBurnChildren(): number {
  const list = [...activeKaraokeBurnChildren];
  activeKaraokeBurnChildren.clear();
  for (const child of list) killKaraokeBurnChild(child, 'cancelled');
  return list.length;
}

export function cancelActiveKaraokeBurns(): { success: true; killed: number } {
  return { success: true, killed: killTrackedKaraokeBurnChildren() };
}

function makeKaraokeBurnAbortError(reason: 'cancelled' | 'timeout' = 'cancelled'): Error {
  const e = new Error(reason === 'timeout' ? 'burn timeout' : 'cancelled');
  e.name = reason === 'timeout' ? 'TimeoutError' : 'AbortError';
  return e;
}

function resolveFfmpegPath(): string {
  if (process.env.FFMPEG_PATH) return process.env.FFMPEG_PATH;
  const exeName = process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg';
  try {
    const resourcesPath = process.resourcesPath;
    if (resourcesPath) {
      const extra = path.join(resourcesPath, 'ffmpeg', exeName);
      if (fs.existsSync(extra)) return extra;
    }
  } catch {
    /* ignore */
  }
  try {
    const mod = require('ffmpeg-static');
    let p = typeof mod === 'string' ? mod : mod?.default ?? mod?.path;
    if (p && typeof p === 'string') {
      if (p.includes('app.asar') && !p.includes('app.asar.unpacked')) {
        p = p.replace(/app\.asar(?!\.unpacked)/g, 'app.asar.unpacked');
      }
      if (fs.existsSync(p)) return p;
    }
  } catch {
    /* ignore */
  }
  return 'ffmpeg';
}

export interface KaraokeFontInfo {
  fontName: string;
  fontsDir: string | null;
  fontFile: string | null;
}

/** 探测系统中文字体，避免 ASS 中文乱码 */
export function detectChineseKaraokeFont(): KaraokeFontInfo {
  const candidates: Array<{ fontName: string; files: string[] }> = [];
  if (process.platform === 'win32') {
    const windir = process.env.WINDIR || 'C:\\Windows';
    const fonts = path.join(windir, 'Fonts');
    candidates.push(
      { fontName: 'Microsoft YaHei', files: [path.join(fonts, 'msyh.ttc'), path.join(fonts, 'msyh.ttf')] },
      { fontName: 'Microsoft YaHei UI', files: [path.join(fonts, 'msyh.ttc')] },
      { fontName: 'SimHei', files: [path.join(fonts, 'simhei.ttf')] },
      { fontName: 'SimSun', files: [path.join(fonts, 'simsun.ttc')] },
      { fontName: 'Noto Sans SC', files: [path.join(fonts, 'NotoSansSC-Regular.otf')] },
    );
  } else if (process.platform === 'darwin') {
    candidates.push(
      {
        fontName: 'PingFang SC',
        files: [
          '/System/Library/Fonts/PingFang.ttc',
          '/Library/Fonts/PingFang.ttc',
        ],
      },
      {
        fontName: 'Hiragino Sans GB',
        files: ['/System/Library/Fonts/Hiragino Sans GB.ttc'],
      },
      {
        fontName: 'STHeiti',
        files: ['/System/Library/Fonts/STHeiti Light.ttc', '/System/Library/Fonts/STHeiti Medium.ttc'],
      },
    );
  } else {
    candidates.push(
      {
        fontName: 'Noto Sans CJK SC',
        files: [
          '/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc',
          '/usr/share/fonts/noto-cjk/NotoSansCJK-Regular.ttc',
        ],
      },
      {
        fontName: 'WenQuanYi Micro Hei',
        files: ['/usr/share/fonts/truetype/wqy/wqy-microhei.ttc'],
      },
    );
  }

  // 打包回退：extraResources/fonts
  try {
    const rp = process.resourcesPath;
    if (rp) {
      const bundled = path.join(rp, 'fonts');
      candidates.push({
        fontName: 'Noto Sans SC',
        files: [
          path.join(bundled, 'NotoSansSC-Regular.otf'),
          path.join(bundled, 'NotoSansCJKsc-Regular.otf'),
          path.join(bundled, 'SourceHanSansSC-Regular.otf'),
        ],
      });
    }
  } catch {
    /* ignore */
  }

  for (const c of candidates) {
    for (const f of c.files) {
      if (f && fs.existsSync(f)) {
        return { fontName: c.fontName, fontsDir: path.dirname(f), fontFile: f };
      }
    }
  }
  return {
    fontName: process.platform === 'darwin' ? 'PingFang SC' : 'Microsoft YaHei',
    fontsDir: process.platform === 'win32' ? path.join(process.env.WINDIR || 'C:\\Windows', 'Fonts') : null,
    fontFile: null,
  };
}

function runFfmpeg(
  args: string[],
  opts?: { cwd?: string; signal?: AbortSignal; timeoutMs?: number },
): Promise<void> {
  const bin = resolveFfmpegPath();
  return new Promise((resolve, reject) => {
    if (opts?.signal?.aborted) {
      reject(makeKaraokeBurnAbortError('cancelled'));
      return;
    }
    const child = trackKaraokeBurnChild(
      spawn(bin, args, {
        windowsHide: true,
        shell: false,
        cwd: opts?.cwd || undefined,
      }),
    );
    let settled = false;
    let stderr = '';

    const settle = (fn: () => void) => {
      if (settled) return;
      settled = true;
      cleanup();
      fn();
    };

    const onAbort = () => {
      killKaraokeBurnChild(child, 'cancelled');
    };

    const timeoutMs = Number(opts?.timeoutMs);
    const timer =
      Number.isFinite(timeoutMs) && timeoutMs > 0
        ? setTimeout(() => {
            killKaraokeBurnChild(child, 'timeout');
          }, timeoutMs)
        : null;

    const cleanup = () => {
      if (timer) clearTimeout(timer);
      opts?.signal?.removeEventListener('abort', onAbort);
    };

    opts?.signal?.addEventListener('abort', onAbort, { once: true });

    child.stderr?.on('data', (chunk) => {
      stderr += String(chunk || '');
    });
    child.on('error', (err) => {
      settle(() => reject(err));
    });
    child.on('close', (code) => {
      settle(() => {
        if (code === 0) {
          resolve();
          return;
        }
        const reason = karaokeBurnAbortReason.get(child);
        if (reason === 'timeout') {
          reject(makeKaraokeBurnAbortError('timeout'));
          return;
        }
        if (reason === 'cancelled' || /cancel|abort/i.test(stderr)) {
          reject(makeKaraokeBurnAbortError('cancelled'));
          return;
        }
        reject(new Error(stderr.slice(-2000) || `ffmpeg exited with code ${code}`));
      });
    });
  });
}

/**
 * 绝对路径 → ffmpeg filtergraph 安全值。
 * AVFilter 用 `:` 分隔选项；即便包在单引号里，`:` 也必须写成 `\:`。
 * 惯例：反斜杠改正斜杠 + 转义冒号，形如 `C\:/path/to/k.ass`。
 * 绝不拼接 fontsdir（ASS Style 的 Fontname 走系统字体即可）。
 */
function toFilterAssPath(absPath: string): string {
  return String(absPath || '')
    .replace(/\\/g, '/')
    .replace(/:/g, '\\:')
    .replace(/'/g, "\\'")
    .replace(/,/g, '\\,')
    .replace(/\[/g, '\\[')
    .replace(/\]/g, '\\]');
}

/**
 * 烧录栅格超采样：先放大再 ass 再缩回片源。
 * 正歌方案 C 无歌词 \\clip；超采样仍改善描边/字形抗锯齿。失败时回退纯 ass。
 */
export const KARAOKE_BURN_SUPERSAMPLE = 2;

/** 仅 ass 滤镜；相对名（配合 cwd）或绝对路径（转义后）。supersample>1 时包一层 scale。 */
function buildAssVf(assSpec: string, supersample = 1): string {
  // 相对纯 ASCII 名：ass=k.ass —— 无盘符冒号，Windows 最稳
  let assPart: string;
  if (!/[\\/]/.test(assSpec) && !assSpec.includes(':')) {
    assPart = `ass=${assSpec}`;
  } else {
    // 禁止 ass=filename='C:/...'：盘符冒号未被 \: 转义时会炸成 No option name near
    assPart = `ass='${toFilterAssPath(assSpec)}'`;
  }
  const ss = Math.max(1, Math.round(Number(supersample) || 1));
  if (ss <= 1) return assPart;
  // neighbor 放大保底图像素；ass 后 lanczos 缩回柔化扫字硬切边；最终分辨率=片源
  return `scale=iw*${ss}:ih*${ss}:flags=neighbor,${assPart},scale=iw/${ss}:ih/${ss}:flags=lanczos`;
}

/**
 * 写 ASS 到仅含 ASCII 的短临时目录（文件名固定 k.ass），便于 cwd + 相对滤镜。
 * 返回 { workDir, assPath, assRelName }。
 */
export function writeKaraokeAssTemp(
  project: KaraokeProject,
  fontName?: string,
): string {
  return writeKaraokeAssWorkDir(project, fontName).assPath;
}

/** 优先用户 style.fontName；未设时回退系统中文字体探测 */
function resolveKaraokeAssFontName(project: KaraokeProject, override?: string): string {
  const fromOverride = String(override || '').trim();
  if (fromOverride) return fromOverride;
  const fromStyle = String(project.style?.fontName || '').trim();
  if (fromStyle) return fromStyle;
  return detectChineseKaraokeFont().fontName || 'Microsoft YaHei';
}

function writeKaraokeAssWorkDir(
  project: KaraokeProject,
  fontName?: string,
): { workDir: string; assPath: string; assRelName: string } {
  const name = resolveKaraokeAssFontName(project, fontName);
  const assBody = buildKaraokeAss({
    ...project,
    style: {
      ...(project.style || {}),
      fontName: name,
    },
  });
  // 短 ASCII 目录，避免中文用户名/长路径进入 filter 字符串
  const id = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const workDir = path.join(os.tmpdir(), `nfk${id}`);
  fs.mkdirSync(workDir, { recursive: true });
  const assRelName = 'k.ass';
  const assPath = path.join(workDir, assRelName);
  fs.writeFileSync(assPath, assBody, 'utf8');
  return { workDir, assPath, assRelName };
}

export async function exportKaraokeAssFile(
  project: KaraokeProject,
  defaultName = 'karaoke',
): Promise<{ success: boolean; canceled?: boolean; filePath?: string; error?: string }> {
  try {
    const name = resolveKaraokeAssFontName(project);
    const ass = buildKaraokeAss({
      ...project,
      style: { ...(project.style || {}), fontName: name },
    });
    const win = BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0] || null;
    const result = await dialog.showSaveDialog(win || undefined!, {
      title: '导出卡拉OK字幕 (ASS)',
      defaultPath: `${String(defaultName || 'karaoke').replace(/[<>:"/\\|?*]/g, '_').slice(0, 48)}.ass`,
      filters: [
        { name: 'ASS Subtitles', extensions: ['ass'] },
        { name: 'All Files', extensions: ['*'] },
      ],
    });
    if (result.canceled || !result.filePath) {
      return { success: false, canceled: true };
    }
    fs.writeFileSync(result.filePath, ass, 'utf8');
    return { success: true, filePath: result.filePath };
  } catch (e: any) {
    return { success: false, error: e?.message || String(e) };
  }
}

export interface KaraokeBurnResult {
  success: boolean;
  canceled?: boolean;
  timedOut?: boolean;
  originalUrl?: string;
  originalPath?: string;
  posterUrl?: string;
  width?: number;
  height?: number;
  assPath?: string;
  error?: string;
  /** 实际烧录引擎：css=方案 A；ass=方案 C；record=录制预览 */
  engine?: 'css' | 'ass' | 'record';
}

/**
 * 将 ASS 烧录进视频，并入库为项目本地视频资源。
 * 支持取消（cancelActiveKaraokeBurns）与超时（默认 15 分钟）。
 */
export async function burnKaraokeSubtitlesToProject(
  projectId: string | undefined,
  videoUrl: string,
  karaokeProject: KaraokeProject,
  opts?: { timeoutMs?: number },
): Promise<KaraokeBurnResult> {
  let assPath = '';
  let outTmp = '';
  const timeoutMs =
    Number.isFinite(Number(opts?.timeoutMs)) && Number(opts?.timeoutMs) > 0
      ? Number(opts?.timeoutMs)
      : KARAOKE_BURN_TIMEOUT_MS;
  // 整次烧录（含多方案重试）共用截止时间
  const deadline = Date.now() + timeoutMs;
  try {
    const inputPath = await resolveLocalMediaFilePath(projectId, videoUrl);
    const audioSource = resolveKaraokeAudioSource(karaokeProject);
    let songAudioPath: string | null = null;
    if (audioSource === 'song') {
      const songUrl = String(karaokeProject.audioUrl || '').trim();
      if (!songUrl) {
        return { success: false, error: 'song audio required for audioSource=song' };
      }
      songAudioPath = await resolveLocalMediaFilePath(projectId, songUrl);
    }
    const written = writeKaraokeAssWorkDir(karaokeProject);
    const workDir = written.workDir;
    assPath = written.assPath;

    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    outTmp = path.join(os.tmpdir(), `nexflow-karaoke-burn-${id}.mp4`);

    // 绝不使用 fontsdir / subtitles=C:/...:fontsdir=...（未转义冒号会炸）
    // 优先 2× 超采样 ass（扫字硬边抗锯齿）；失败再回退纯 ass
    // 1) cwd=workDir + ass=k.ass（无盘符，首选）
    // 2) ass='C\:/绝对路径'（正斜杠 + \: 转义盘符冒号）
    const ss = KARAOKE_BURN_SUPERSAMPLE;
    const attempts: Array<{ vf: string; cwd?: string }> = [
      { vf: buildAssVf(written.assRelName, ss), cwd: workDir },
      { vf: buildAssVf(assPath, ss) },
      { vf: buildAssVf(written.assRelName, 1), cwd: workDir },
      { vf: buildAssVf(assPath, 1) },
    ];

    let lastErr: unknown = null;
    let burned = false;
    for (const attempt of attempts) {
      const remain = deadline - Date.now();
      if (remain <= 0) {
        throw makeKaraokeBurnAbortError('timeout');
      }
      try {
        console.log(
          '[karaoke] burn attempt vf=',
          attempt.vf,
          'cwd=',
          attempt.cwd || '(default)',
          'audioSource=',
          audioSource,
        );
        // 办公本：veryfast + 有限线程，避免占满 CPU；勿用 slow/medium
        const ffmpegArgs = songAudioPath
          ? [
              '-y',
              '-hide_banner',
              '-threads',
              '2',
              '-i',
              inputPath,
              '-i',
              songAudioPath,
              '-vf',
              attempt.vf,
              '-map',
              '0:v:0',
              '-map',
              '1:a:0',
              // vf 内可含临时 2× scale；最终缩回片源分辨率
              '-c:v',
              'libx264',
              '-preset',
              'veryfast',
              '-threads',
              '2',
              '-crf',
              '18',
              '-pix_fmt',
              'yuv420p',
              '-c:a',
              'aac',
              '-b:a',
              '192k',
              '-shortest',
              '-movflags',
              '+faststart',
              outTmp,
            ]
          : [
              '-y',
              '-hide_banner',
              '-threads',
              '2',
              '-i',
              inputPath,
              '-vf',
              attempt.vf,
              '-c:a',
              'copy',
              // vf 内可含临时 2× scale；最终缩回片源分辨率
              '-c:v',
              'libx264',
              '-preset',
              'veryfast',
              '-threads',
              '2',
              '-crf',
              '18',
              '-pix_fmt',
              'yuv420p',
              '-movflags',
              '+faststart',
              outTmp,
            ];
        await runFfmpeg(ffmpegArgs, { cwd: attempt.cwd, timeoutMs: remain });
        burned = true;
        break;
      } catch (err) {
        lastErr = err;
        const name = err instanceof Error ? err.name : '';
        const msg = err instanceof Error ? err.message : String(err || '');
        if (name === 'AbortError' || /cancel/i.test(msg)) {
          return { success: false, canceled: true, error: 'cancelled' };
        }
        if (name === 'TimeoutError' || /timeout/i.test(msg)) {
          return { success: false, timedOut: true, error: 'burn timeout' };
        }
        console.warn('[karaoke] burn vf 失败，尝试下一方案:', attempt.vf, err);
      }
    }
    if (!burned) throw lastErr instanceof Error ? lastErr : new Error(String(lastErr || 'burn failed'));

    const resource = await localResourceManager.createVideoResourceFromFile(projectId, outTmp);
    return {
      success: true,
      engine: 'ass',
      originalUrl: resource.originalUrl,
      originalPath: resource.originalPath,
      posterUrl: resource.posterUrl,
      width: resource.width,
      height: resource.height,
      assPath,
    };
  } catch (e: any) {
    const name = e?.name || '';
    const msg = e?.message || String(e);
    if (name === 'AbortError' || /cancel/i.test(msg)) {
      return { success: false, canceled: true, error: 'cancelled' };
    }
    if (name === 'TimeoutError' || /timeout/i.test(msg)) {
      return { success: false, timedOut: true, error: 'burn timeout' };
    }
    console.error('[karaoke] burn failed', e);
    return { success: false, error: msg };
  } finally {
    try {
      if (outTmp && fs.existsSync(outTmp)) fs.unlinkSync(outTmp);
    } catch {
      /* ignore */
    }
    // 保留 workDir/k.ass（返回 assPath 供调试）；系统临时目录会自行清理
  }
}

/** 仅写 ASS 到临时目录并返回路径与内容（供预览/调试） */
export function previewWriteKaraokeAss(project: KaraokeProject): {
  assPath: string;
  assContent: string;
  fontName: string;
} {
  const fontName = resolveKaraokeAssFontName(project);
  const assPath = writeKaraokeAssTemp(project, fontName);
  const assContent = fs.readFileSync(assPath, 'utf8');
  return { assPath, assContent, fontName };
}
