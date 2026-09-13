import { app } from 'electron';
import fs from 'fs';
import path from 'path';
import { store } from '../services/store.js';

/** 当前进程启动时是否已启用实验性硬件加速（只读，供 IPC 查询） */
export let hardwareAccelerationActive = false;

function userDataFile(name: string): string {
  return path.join(app.getPath('userData'), name);
}

function gpuKillSwitchPath(): string {
  return userDataFile('disable-gpu');
}

function gpuSessionPendingPath(): string {
  return userDataFile('gpu-session-pending');
}

function gpuOkPath(): string {
  return userDataFile('gpu-ok');
}

function gpuAllowTryPath(): string {
  return userDataFile('gpu-allow-try');
}

function envForcesGpuOff(): boolean {
  const env = String(process.env.NEXFLOW_DISABLE_GPU || '').trim();
  if (env === '1' || /^true$/i.test(env)) return true;
  return process.argv.some((a) => a === '--disable-nexflow-gpu');
}

function unlinkQuiet(p: string): void {
  try {
    if (fs.existsSync(p)) fs.unlinkSync(p);
  } catch {
    /* ignore */
  }
}

function persistGpuOff(): void {
  store.set('experimentalHardwareAcceleration', false);
  try {
    fs.writeFileSync(gpuKillSwitchPath(), '1\n', 'utf8');
  } catch {
    /* ignore */
  }
  unlinkQuiet(gpuSessionPendingPath());
  unlinkQuiet(gpuAllowTryPath());
}

export function isExperimentalHardwareAccelerationEnabled(): boolean {
  if (envForcesGpuOff()) return false;
  try {
    if (fs.existsSync(gpuKillSwitchPath())) return false;
  } catch {
    /* ignore */
  }
  return store.get('experimentalHardwareAcceleration') === true;
}

export function setExperimentalHardwareAccelerationEnabled(enabled: boolean): void {
  const on = Boolean(enabled);
  store.set('experimentalHardwareAcceleration', on);
  try {
    if (on) {
      unlinkQuiet(gpuKillSwitchPath());
      unlinkQuiet(gpuSessionPendingPath());
      // 下次启动允许试一次 GPU；若又黑屏则自动退回软件渲染
      fs.writeFileSync(gpuAllowTryPath(), `${Date.now()}\n`, 'utf8');
    } else {
      fs.writeFileSync(gpuKillSwitchPath(), '1\n', 'utf8');
      unlinkQuiet(gpuAllowTryPath());
      unlinkQuiet(gpuSessionPendingPath());
    }
  } catch {
    /* ignore */
  }
}

/** 渲染页成功显示后调用 */
export function markHardwareAccelerationSessionOk(): void {
  unlinkQuiet(gpuSessionPendingPath());
  if (!hardwareAccelerationActive) return;
  try {
    fs.writeFileSync(gpuOkPath(), `${Date.now()}\n`, 'utf8');
  } catch {
    /* ignore */
  }
}

/** 疑似整窗黑屏：关掉实验 GPU，下次启动走软件光栅 */
export function disableHardwareAccelerationAfterBlackScreen(reason: string): void {
  persistGpuOff();
  unlinkQuiet(gpuOkPath());
  console.warn(`[主进程] 已关闭实验性硬件加速（${reason}）。请完全退出后重新打开。`);
}

/** 须在 app.ready 之前调用 */
export function applyHardwareAccelerationPolicy(): void {
  const forcedOff = envForcesGpuOff();
  let enabled = isExperimentalHardwareAccelerationEnabled();

  if (forcedOff) {
    persistGpuOff();
    enabled = false;
  }

  const pending = (() => {
    try {
      return fs.existsSync(gpuSessionPendingPath());
    } catch {
      return false;
    }
  })();
  const provenOk = (() => {
    try {
      return fs.existsSync(gpuOkPath());
    } catch {
      return false;
    }
  })();
  const allowTry = (() => {
    try {
      return fs.existsSync(gpuAllowTryPath());
    } catch {
      return false;
    }
  })();

  // 上次 GPU 启动没画出来，或从未成功过（旧开关一直开着）→ 本次强制软件渲染
  if (enabled && (pending || (!provenOk && !allowTry))) {
    persistGpuOff();
    enabled = false;
    console.warn(
      pending
        ? '[主进程] 上次 GPU 实验启动未完成（可能整窗黑屏），已关闭硬件加速'
        : '[主进程] 实验性 GPU 未验证成功过，本次改为软件渲染，避免整窗黑屏',
    );
  }

  hardwareAccelerationActive = enabled;

  app.commandLine.appendSwitch('high-dpi-support', '1');

  if (!enabled) {
    app.commandLine.appendSwitch('disable-gpu');
    app.disableHardwareAcceleration();
    app.commandLine.appendSwitch('force-device-scale-factor', '1');
    console.log(
      forcedOff
        ? '[主进程] 硬件加速：已由 NEXFLOW_DISABLE_GPU / --disable-nexflow-gpu 关闭'
        : '[主进程] 硬件加速：已关闭（默认；画布右下角 GPU 按钮可开启实验项）',
    );
    return;
  }

  unlinkQuiet(gpuAllowTryPath());
  try {
    fs.writeFileSync(gpuSessionPendingPath(), `${Date.now()}\n`, 'utf8');
  } catch {
    /* ignore */
  }

  if (process.platform === 'win32') {
    app.commandLine.appendSwitch('use-angle', 'd3d11');
    app.commandLine.appendSwitch('ignore-gpu-blocklist');
    app.commandLine.appendSwitch('enable-gpu-rasterization');
    app.commandLine.appendSwitch('enable-accelerated-video-decode');
    app.commandLine.appendSwitch('enable-features', 'CanvasOopRasterization,D3D11VideoDecoder');
  } else if (process.platform === 'darwin') {
    app.commandLine.appendSwitch('ignore-gpu-blocklist');
  }

  console.log(
    '[主进程] 硬件加速：实验性已启用。若整窗黑屏，请完全退出后再启动（会自动退回软件渲染）',
  );
}
