import { app } from 'electron';
import fs from 'fs';
import path from 'path';
import { store } from '../services/store.js';

/** 当前进程启动时是否已启用实验性硬件加速（只读，供 IPC 查询） */
export let hardwareAccelerationActive = false;

function gpuKillSwitchPath(): string {
  return path.join(app.getPath('userData'), 'disable-gpu');
}

function envForcesGpuOff(): boolean {
  const env = String(process.env.NEXFLOW_DISABLE_GPU || '').trim();
  if (env === '1' || /^true$/i.test(env)) return true;
  return process.argv.some((a) => a === '--disable-nexflow-gpu');
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
    const p = gpuKillSwitchPath();
    if (on) {
      if (fs.existsSync(p)) fs.unlinkSync(p);
    } else {
      fs.writeFileSync(p, '1\n', 'utf8');
    }
  } catch {
    /* ignore */
  }
}

/** 须在 app.ready 之前调用 */
export function applyHardwareAccelerationPolicy(): void {
  const forcedOff = envForcesGpuOff();
  let enabled = isExperimentalHardwareAccelerationEnabled();

  if (forcedOff && store.get('experimentalHardwareAcceleration') === true) {
    store.set('experimentalHardwareAcceleration', false);
    try {
      fs.writeFileSync(gpuKillSwitchPath(), '1\n', 'utf8');
    } catch {
      /* ignore */
    }
    enabled = false;
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

  if (process.platform === 'win32') {
    app.commandLine.appendSwitch('use-angle', 'd3d11');
    app.commandLine.appendSwitch('ignore-gpu-blocklist');
    app.commandLine.appendSwitch('enable-gpu-rasterization');
    app.commandLine.appendSwitch('enable-accelerated-video-decode');
    // 不启用 DirectCompositionVideoOverlays：部分 Windows 机型会整窗黑屏
    app.commandLine.appendSwitch('enable-features', 'CanvasOopRasterization,D3D11VideoDecoder');
  } else if (process.platform === 'darwin') {
    app.commandLine.appendSwitch('ignore-gpu-blocklist');
  }

  console.log(
    '[主进程] 硬件加速：实验性已启用。若整窗黑屏，请完全退出后用 NEXFLOW_DISABLE_GPU=1 启动，或删掉画布右下角 GPU 实验项',
  );
}
