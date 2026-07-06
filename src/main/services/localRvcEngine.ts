/**
 * 本地 RVC 推理引擎：路径探测、就绪检测、首次下载（约 1.2GB）。
 */
import { app } from 'electron';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import axios from 'axios';
import AdmZip from 'adm-zip';

const ENGINE_DIR_NAME = 'rvc-engine';

export interface RvcEngineManifest {
  version?: string;
  bundleUrl?: string;
  sha256?: string;
  sizeBytes?: number;
}

export interface RvcEngineStatus {
  ready: boolean;
  engineDir: string;
  cliPath: string | null;
  hubertPath: string | null;
  rmvpePath: string | null;
  missing: string[];
  version?: string;
  downloadUrlConfigured: boolean;
}

export interface RvcEngineDownloadProgress {
  phase: 'downloading' | 'extracting' | 'done';
  percent: number;
  message: string;
}

function getBundledManifestPath(): string | null {
  try {
    const p = path.join(process.resourcesPath, 'rvc', 'manifest.json');
    if (fs.existsSync(p)) return p;
  } catch {
    /* ignore */
  }
  for (const p of listDevResourceCandidates('resources/rvc/manifest.json')) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

export function loadRvcEngineManifest(): RvcEngineManifest {
  const bundled = getBundledManifestPath();
  if (bundled) {
    try {
      return JSON.parse(fs.readFileSync(bundled, 'utf8')) as RvcEngineManifest;
    } catch {
      /* ignore */
    }
  }
  return {};
}

export function getRvcEngineDir(): string {
  return path.join(app.getPath('userData'), ENGINE_DIR_NAME);
}

/** electron:dev 时 appPath 常为 dist-electron/main，需上溯到仓库根 */
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
      fs.existsSync(path.join(normalized, 'resources', 'rvc'))
    ) {
      return normalized;
    }
  }
  return null;
}

function listEngineRootCandidates(): string[] {
  const roots = new Set<string>([getRvcEngineDir()]);
  try {
    if (process.resourcesPath) roots.add(path.join(process.resourcesPath, 'rvc', 'engine'));
  } catch {
    /* ignore */
  }
  const projectRoot = getNexflowProjectRoot();
  if (projectRoot) roots.add(path.join(projectRoot, 'resources', 'rvc', 'engine'));
  roots.add(path.join(app.getAppPath(), '..', '..', 'resources', 'rvc', 'engine'));
  roots.add(path.join(app.getAppPath(), '..', 'resources', 'rvc', 'engine'));
  return [...roots].map((r) => path.normalize(r));
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

function getBundledEngineRoot(): string | null {
  for (const root of listEngineRootCandidates()) {
    if (fs.existsSync(path.join(root, 'rvc_infer_cli.exe'))) return root;
  }
  return null;
}

function probeAssetsAtRoot(root: string): { hubertPath: string | null; rmvpePath: string | null } {
  const hubertPath = path.join(root, 'assets', 'hubert_base.pt');
  const rmvpePath = path.join(root, 'assets', 'rmvpe.pt');
  return {
    hubertPath: fs.existsSync(hubertPath) ? hubertPath : null,
    rmvpePath: fs.existsSync(rmvpePath) ? rmvpePath : null,
  };
}

function findRvcAssets(): { hubertPath: string; rmvpePath: string; engineRoot: string } | null {
  for (const root of listEngineRootCandidates()) {
    if (!fs.existsSync(root)) continue;
    const assets = probeAssetsAtRoot(root);
    if (assets.hubertPath && assets.rmvpePath) {
      return { hubertPath: assets.hubertPath, rmvpePath: assets.rmvpePath, engineRoot: root };
    }
  }
  return null;
}

function probeEngineAtRoot(root: string): Omit<RvcEngineStatus, 'downloadUrlConfigured'> {
  const cliPath = path.join(root, 'rvc_infer_cli.exe');
  const assets = probeAssetsAtRoot(root);
  const missing: string[] = [];
  if (!fs.existsSync(cliPath)) missing.push('rvc_infer_cli.exe');
  if (!assets.hubertPath) missing.push('assets/hubert_base.pt');
  if (!assets.rmvpePath) missing.push('assets/rmvpe.pt');
  const manifest = loadRvcEngineManifest();
  return {
    ready: missing.length === 0,
    engineDir: root,
    cliPath: fs.existsSync(cliPath) ? cliPath : null,
    hubertPath: assets.hubertPath,
    rmvpePath: assets.rmvpePath,
    missing,
    version: manifest.version,
  };
}

export function isRvcInferAvailable(): boolean {
  if (getRvcEngineStatus().ready) return true;
  const assets = findRvcAssets();
  return !!(assets && resolveDevLaunchScript() && resolveDevVenvPython());
}

export function getRvcEngineStatus(): RvcEngineStatus {
  const manifest = loadRvcEngineManifest();
  const downloadUrlConfigured = !!(process.env.NEXFLOW_RVC_ENGINE_BUNDLE_URL || manifest.bundleUrl);

  for (const root of listEngineRootCandidates()) {
    const probe = probeEngineAtRoot(root);
    if (probe.hubertPath && probe.rmvpePath && resolveDevLaunchScript() && resolveDevVenvPython()) {
      return {
        ...probe,
        ready: true,
        missing: [],
        downloadUrlConfigured,
      };
    }
    if (probe.ready) {
      return { ...probe, downloadUrlConfigured };
    }
  }

  const userDir = getRvcEngineDir();
  return { ...probeEngineAtRoot(userDir), downloadUrlConfigured };
}

function resolveDevLaunchScript(): string | null {
  for (const p of listDevResourceCandidates('scripts/build-rvc-cli/launch_rvc_infer.py')) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

function resolveDevVenvPython(): string | null {
  for (const p of listDevResourceCandidates('scripts/build-rvc-cli/.build-venv/Scripts/python.exe')) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

/** 解析推理命令：优先 venv（稳定），其次 onefile exe */
export function resolveRvcInferLaunch(): { command: string; baseArgs: string[]; engineRoot: string } {
  const script = resolveDevLaunchScript();
  const assets = findRvcAssets();
  const venvPy = resolveDevVenvPython();
  if (script && assets && venvPy) {
    return { command: venvPy, baseArgs: [script], engineRoot: assets.engineRoot };
  }
  const status = getRvcEngineStatus();
  if (status.cliPath && fs.existsSync(status.cliPath)) {
    return { command: status.cliPath, baseArgs: [], engineRoot: status.engineDir };
  }
  if (script && assets) {
    return { command: 'python', baseArgs: [script], engineRoot: assets.engineRoot };
  }
  throw new Error(
    '未检测到本地 RVC 推理引擎。请在设置中「下载本地 RVC 引擎」，或配置 NEXFLOW_RVC_ENGINE_BUNDLE_URL 后重试。',
  );
}

export async function ensureRvcEngineReady(): Promise<RvcEngineStatus> {
  if (isRvcInferAvailable()) {
    return getRvcEngineStatus();
  }
  const status = getRvcEngineStatus();
  if (status.downloadUrlConfigured) {
    await downloadRvcEngineBundle();
    if (isRvcInferAvailable()) return getRvcEngineStatus();
  }
  throw new Error(
    status.missing.length > 0
      ? `本地 RVC 引擎不完整，缺少：${status.missing.join('、')}。请下载引擎后重试。`
      : '未配置本地 RVC 引擎下载地址，请联系管理员或手动放置引擎文件。',
  );
}

export async function downloadRvcEngineBundle(
  onProgress?: (p: RvcEngineDownloadProgress) => void,
): Promise<void> {
  const { chainOptionalEngineProgress, emitOptionalEngineDownloadProgress } = await import(
    '../utils/optionalEngineDownloadProgress.js'
  );
  const report = chainOptionalEngineProgress('rvc', onProgress);
  const manifest = loadRvcEngineManifest();
  const url = (process.env.NEXFLOW_RVC_ENGINE_BUNDLE_URL || manifest.bundleUrl || '').trim();
  if (!url) {
    throw new Error('未配置 RVC 引擎下载地址（manifest.bundleUrl 或 NEXFLOW_RVC_ENGINE_BUNDLE_URL）');
  }
  const engineDir = getRvcEngineDir();
  fs.mkdirSync(engineDir, { recursive: true });
  const zipPath = path.join(engineDir, 'rvc-engine-download.zip');
  try {
    report({ phase: 'downloading', percent: 0, message: '正在下载本地 RVC 引擎…' });

    const resp = await axios.get<ArrayBuffer>(url, {
      responseType: 'arraybuffer',
      timeout: 0,
      maxContentLength: Infinity,
      onDownloadProgress: (ev) => {
        const total = ev.total || manifest.sizeBytes || 0;
        const pct = total > 0 ? Math.min(99, Math.round((ev.loaded / total) * 100)) : 0;
        report({ phase: 'downloading', percent: pct, message: `正在下载本地 RVC 引擎… ${pct}%` });
      },
    });
    const buf = Buffer.from(resp.data);
    if (manifest.sha256) {
      const hash = crypto.createHash('sha256').update(buf).digest('hex');
      if (hash !== manifest.sha256) {
        throw new Error('RVC 引擎包校验失败，请重试或联系支持');
      }
    }
    fs.writeFileSync(zipPath, buf);
    report({ phase: 'extracting', percent: 99, message: '正在解压 RVC 引擎…' });
    const zip = new AdmZip(buf);
    zip.extractAllTo(engineDir, true);
    try {
      fs.unlinkSync(zipPath);
    } catch {
      /* ignore */
    }
    report({ phase: 'done', percent: 100, message: 'RVC 引擎已就绪' });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'RVC 引擎下载失败';
    emitOptionalEngineDownloadProgress({ kind: 'rvc', phase: 'error', percent: 0, message });
    throw err;
  }
}

export function getRvcAssetPaths(): { hubertPath: string; rmvpePath: string } {
  const assets = findRvcAssets();
  if (assets) return assets;
  throw new Error('RVC 引擎资源不完整（HuBERT / RMVPE）');
}
