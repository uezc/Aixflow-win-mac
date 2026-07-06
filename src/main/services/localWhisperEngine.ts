/**
 * 本地 Whisper 引擎：whisper.cpp 二进制 + ggml 模型，首次使用时下载。
 */
import { app } from 'electron';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import axios from 'axios';
import AdmZip from 'adm-zip';

const ENGINE_DIR_NAME = 'whisper-engine';

const WHISPER_MODEL_CANDIDATE_NAMES = [
  'ggml-tiny.bin',
  'ggml-base.bin',
  'ggml-small.bin',
  'ggml-medium.bin',
  'ggml-large-v3.bin',
  'ggml-large-v2.bin',
  'ggml-large.bin',
];

export interface WhisperEngineManifest {
  version?: string;
  bundleUrl?: string;
  sha256?: string;
  sizeBytes?: number;
  modelFile?: string;
}

export interface WhisperEngineStatus {
  ready: boolean;
  engineDir: string;
  binaryPath: string | null;
  modelPath: string | null;
  missing: string[];
  version?: string;
  downloadUrlConfigured: boolean;
}

export interface WhisperEngineDownloadProgress {
  phase: 'downloading' | 'extracting' | 'done';
  percent: number;
  message: string;
}

function whisperCppExecutableBasenames(): string[] {
  if (process.platform === 'win32') return ['whisper-cli.exe', 'main.exe'];
  return ['whisper-cli', 'main'];
}

export function getWhisperEngineDir(): string {
  return path.join(app.getPath('userData'), ENGINE_DIR_NAME);
}

function getNexflowProjectRoot(): string | null {
  const candidates = [
    process.cwd(),
    path.join(app.getAppPath(), '..', '..'),
    path.join(app.getAppPath(), '..'),
  ];
  for (const base of candidates) {
    const normalized = path.normalize(base);
    if (
      fs.existsSync(path.join(normalized, 'package.json')) &&
      fs.existsSync(path.join(normalized, 'resources', 'whisper'))
    ) {
      return normalized;
    }
  }
  return null;
}

function listDevResourceCandidates(subPath: string): string[] {
  const out = new Set<string>();
  const projectRoot = getNexflowProjectRoot();
  if (projectRoot) out.add(path.join(projectRoot, subPath));
  out.add(path.join(app.getAppPath(), '..', '..', subPath));
  out.add(path.join(app.getAppPath(), '..', subPath));
  out.add(path.join(process.cwd(), subPath));
  return [...out].map((p) => path.normalize(p));
}

function getBundledManifestPath(): string | null {
  try {
    const p = path.join(process.resourcesPath, 'whisper', 'manifest.json');
    if (fs.existsSync(p)) return p;
  } catch {
    /* ignore */
  }
  for (const p of listDevResourceCandidates('resources/whisper/manifest.json')) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

export function loadWhisperEngineManifest(): WhisperEngineManifest {
  const bundled = getBundledManifestPath();
  if (bundled) {
    try {
      return JSON.parse(fs.readFileSync(bundled, 'utf8')) as WhisperEngineManifest;
    } catch {
      /* ignore */
    }
  }
  return {};
}

export function listWhisperSearchRoots(): string[] {
  const roots = new Set<string>();
  roots.add(getWhisperEngineDir());
  try {
    if (process.resourcesPath) roots.add(path.join(process.resourcesPath, 'whisper'));
  } catch {
    /* ignore */
  }
  const projectRoot = getNexflowProjectRoot();
  if (projectRoot) roots.add(path.join(projectRoot, 'resources', 'whisper'));
  return [...roots].map((r) => path.normalize(r));
}

function probeWhisperAtRoot(root: string): {
  binaryPath: string | null;
  modelPath: string | null;
  missing: string[];
} {
  let binaryPath: string | null = null;
  for (const name of whisperCppExecutableBasenames()) {
    const p = path.join(root, name);
    if (fs.existsSync(p)) {
      binaryPath = p;
      break;
    }
  }
  let modelPath: string | null = null;
  for (const name of WHISPER_MODEL_CANDIDATE_NAMES) {
    const p = path.join(root, name);
    if (fs.existsSync(p) && fs.statSync(p).size >= 65_000_000) {
      modelPath = p;
      break;
    }
  }
  const missing: string[] = [];
  if (!binaryPath) missing.push(whisperCppExecutableBasenames().join(' / '));
  if (!modelPath) missing.push('ggml-*.bin 模型');
  return { binaryPath, modelPath, missing };
}

export function getWhisperEngineStatus(): WhisperEngineStatus {
  const manifest = loadWhisperEngineManifest();
  const downloadUrlConfigured = !!(
    process.env.NEXFLOW_WHISPER_ENGINE_BUNDLE_URL || manifest.bundleUrl
  );

  for (const root of listWhisperSearchRoots()) {
    if (!fs.existsSync(root)) continue;
    const probe = probeWhisperAtRoot(root);
    if (probe.binaryPath && probe.modelPath) {
      return {
        ready: true,
        engineDir: root,
        binaryPath: probe.binaryPath,
        modelPath: probe.modelPath,
        missing: [],
        version: manifest.version,
        downloadUrlConfigured,
      };
    }
  }

  const userDir = getWhisperEngineDir();
  const probe = probeWhisperAtRoot(userDir);
  return {
    ready: false,
    engineDir: userDir,
    binaryPath: probe.binaryPath,
    modelPath: probe.modelPath,
    missing: probe.missing,
    version: manifest.version,
    downloadUrlConfigured,
  };
}

export function isWhisperEngineReady(): boolean {
  return getWhisperEngineStatus().ready;
}

export async function ensureWhisperReady(
  onProgress?: (p: WhisperEngineDownloadProgress) => void,
): Promise<WhisperEngineStatus> {
  if (isWhisperEngineReady()) {
    return getWhisperEngineStatus();
  }
  const status = getWhisperEngineStatus();
  if (status.downloadUrlConfigured) {
    await downloadWhisperEngineBundle(onProgress);
    if (isWhisperEngineReady()) return getWhisperEngineStatus();
  }
  throw new Error(
    status.missing.length > 0
      ? `本地 Whisper 引擎不完整，缺少：${status.missing.join('、')}。请联网下载后重试。`
      : '未配置 Whisper 引擎下载地址，请联系管理员。',
  );
}

export async function downloadWhisperEngineBundle(
  onProgress?: (p: WhisperEngineDownloadProgress) => void,
): Promise<void> {
  const { chainOptionalEngineProgress, emitOptionalEngineDownloadProgress } = await import(
    '../utils/optionalEngineDownloadProgress.js'
  );
  const report = chainOptionalEngineProgress('whisper', onProgress);
  const manifest = loadWhisperEngineManifest();
  const url = (process.env.NEXFLOW_WHISPER_ENGINE_BUNDLE_URL || manifest.bundleUrl || '').trim();
  if (!url) {
    throw new Error('未配置 Whisper 引擎下载地址（manifest.bundleUrl 或 NEXFLOW_WHISPER_ENGINE_BUNDLE_URL）');
  }
  const engineDir = getWhisperEngineDir();
  fs.mkdirSync(engineDir, { recursive: true });
  const zipPath = path.join(engineDir, 'whisper-engine-download.zip');
  try {
    report({ phase: 'downloading', percent: 0, message: '正在下载语音转写引擎…' });

    const resp = await axios.get<ArrayBuffer>(url, {
      responseType: 'arraybuffer',
      timeout: 0,
      maxContentLength: Infinity,
      onDownloadProgress: (ev) => {
        const total = ev.total || manifest.sizeBytes || 0;
        const pct = total > 0 ? Math.min(99, Math.round((ev.loaded / total) * 100)) : 0;
        report({
          phase: 'downloading',
          percent: pct,
          message: `正在下载语音转写引擎… ${pct}%`,
        });
      },
    });
    const buf = Buffer.from(resp.data);
    if (manifest.sha256) {
      const hash = crypto.createHash('sha256').update(buf).digest('hex');
      if (hash !== manifest.sha256) {
        throw new Error('Whisper 引擎包校验失败，请重试或联系支持');
      }
    }
    fs.writeFileSync(zipPath, buf);
    report({ phase: 'extracting', percent: 99, message: '正在解压语音转写引擎…' });
    const zip = new AdmZip(buf);
    zip.extractAllTo(engineDir, true);
    try {
      fs.unlinkSync(zipPath);
    } catch {
      /* ignore */
    }
    report({ phase: 'done', percent: 100, message: '语音转写引擎已就绪' });
  } catch (err) {
    const message = err instanceof Error ? err.message : '语音转写引擎下载失败';
    emitOptionalEngineDownloadProgress({ kind: 'whisper', phase: 'error', percent: 0, message });
    throw err;
  }
}
