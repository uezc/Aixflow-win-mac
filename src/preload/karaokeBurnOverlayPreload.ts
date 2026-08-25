/**
 * 卡拉OK 离屏字幕烧录窗口专用 preload（极简 IPC）。
 */
import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';

type BurnCmd =
  | { type: 'init'; project: unknown; width: number; height: number }
  | { type: 'setTime'; t: number; frameIndex: number }
  | { type: 'shutdown' };

contextBridge.exposeInMainWorld('karaokeBurnOverlayAPI', {
  onCommand: (cb: (msg: BurnCmd) => void) => {
    const handler = (_event: IpcRendererEvent, msg: BurnCmd) => {
      cb(msg);
    };
    ipcRenderer.on('karaoke-burn-overlay-cmd', handler);
    return () => {
      ipcRenderer.removeListener('karaoke-burn-overlay-cmd', handler);
    };
  },
  send: (msg: { type: string; frameIndex?: number; error?: string }) => {
    ipcRenderer.send('karaoke-burn-overlay-event', msg);
  },
});
