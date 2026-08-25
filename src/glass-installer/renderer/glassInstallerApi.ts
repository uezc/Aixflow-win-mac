export type GlassInstallerProgress = {
  phase: 'download' | 'install';
  transferred: number;
  total: number;
  percent: number;
  bytesPerSecond: number;
  etaSeconds: number | null;
  fileName: string;
  savePath: string;
  message?: string;
};

export type GlassInstallerMeta = {
  version: string;
  stubName: string;
  packageName: string;
  packageBytes: number;
  region: 'cn' | 'hk';
  feedBase: string;
};

export type GlassInstallerPhase =
  | 'idle'
  | 'resolving'
  | 'ready'
  | 'downloading'
  | 'installing'
  | 'done'
  | 'error'
  | 'cancelled';

export type GlassInstallerAPI = {
  getDefaultInstallDir: () => Promise<string>;
  pickInstallDir: (current?: string) => Promise<string | null>;
  resolveMeta: (region?: 'cn' | 'hk') => Promise<{ ok: true; meta: GlassInstallerMeta } | { ok: false; error: string }>;
  startInstall: (installDir: string) => Promise<{ ok: true } | { ok: false; error: string }>;
  pauseDownload: () => Promise<void>;
  resumeDownload: () => Promise<void>;
  cancel: () => Promise<void>;
  launchApp: (installDir: string) => Promise<{ ok: boolean; error?: string }>;
  openExternal: (url: string) => Promise<void>;
  quit: () => Promise<void>;
  onProgress: (cb: (p: GlassInstallerProgress) => void) => () => void;
  onPhase: (cb: (payload: { phase: GlassInstallerPhase; error?: string }) => void) => () => void;
};

declare global {
  interface Window {
    glassInstaller?: GlassInstallerAPI;
  }
}

export function getGlassInstallerApi(): GlassInstallerAPI {
  const api = window.glassInstaller;
  if (!api) {
    throw new Error('glassInstaller API 不可用（请在打包后的安装器中运行）');
  }
  return api;
}
