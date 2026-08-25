import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';

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

type GlassInstallerAPI = {
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

const api: GlassInstallerAPI = {
  getDefaultInstallDir: () => ipcRenderer.invoke('gi:get-default-install-dir'),
  pickInstallDir: (current) => ipcRenderer.invoke('gi:pick-install-dir', current),
  resolveMeta: (region?: 'cn' | 'hk') =>
    ipcRenderer.invoke('gi:resolve-meta', region),
  startInstall: (installDir) => ipcRenderer.invoke('gi:start-install', installDir),
  pauseDownload: () => ipcRenderer.invoke('gi:pause-download'),
  resumeDownload: () => ipcRenderer.invoke('gi:resume-download'),
  cancel: () => ipcRenderer.invoke('gi:cancel'),
  launchApp: (installDir) => ipcRenderer.invoke('gi:launch-app', installDir),
  openExternal: (url) => ipcRenderer.invoke('gi:open-external', url),
  quit: () => ipcRenderer.invoke('gi:quit'),
  onProgress: (cb) => {
    const handler = (_: IpcRendererEvent, p: GlassInstallerProgress) => cb(p);
    ipcRenderer.on('gi:progress', handler);
    return () => ipcRenderer.removeListener('gi:progress', handler);
  },
  onPhase: (cb) => {
    const handler = (_: IpcRendererEvent, payload: { phase: GlassInstallerPhase; error?: string }) =>
      cb(payload);
    ipcRenderer.on('gi:phase', handler);
    return () => ipcRenderer.removeListener('gi:phase', handler);
  },
};

contextBridge.exposeInMainWorld('glassInstaller', api);
