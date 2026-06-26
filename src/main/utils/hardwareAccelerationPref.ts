import { app } from 'electron';
import { store } from '../services/store.js';

/** 当前进程启动时是否已启用实验性硬件加速（只读，供 IPC 查询） */
export let hardwareAccelerationActive = false;

export function isExperimentalHardwareAccelerationEnabled(): boolean {
  return store.get('experimentalHardwareAcceleration') === true;
}

export function setExperimentalHardwareAccelerationEnabled(enabled: boolean): void {
  store.set('experimentalHardwareAcceleration', Boolean(enabled));
}

/** 须在 app.ready 之前调用 */
export function applyHardwareAccelerationPolicy(): void {
  const enabled = isExperimentalHardwareAccelerationEnabled();
  hardwareAccelerationActive = enabled;

  app.commandLine.appendSwitch('high-dpi-support', '1');

  if (!enabled) {
    app.commandLine.appendSwitch('disable-gpu');
    app.disableHardwareAcceleration();
    app.commandLine.appendSwitch('force-device-scale-factor', '1');
    console.log('[主进程] 硬件加速：已关闭（默认；画布右下角 GPU 按钮可开启实验项）');
    return;
  }

  if (process.platform === 'win32') {
    app.commandLine.appendSwitch('use-angle', 'd3d11');
    app.commandLine.appendSwitch('ignore-gpu-blocklist');
    app.commandLine.appendSwitch('enable-gpu-rasterization');
    app.commandLine.appendSwitch('enable-accelerated-video-decode');
    app.commandLine.appendSwitch(
      'enable-features',
      'CanvasOopRasterization,D3D11VideoDecoder,DirectCompositionVideoOverlays',
    );
  } else if (process.platform === 'darwin') {
    app.commandLine.appendSwitch('ignore-gpu-blocklist');
  }

  console.log('[主进程] 硬件加速：实验性已启用（须确认右下角显示「GPU 开」）');
}
