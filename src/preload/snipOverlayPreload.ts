import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('snipOverlay', {
  getFrame: () =>
    ipcRenderer.invoke('snip-overlay:get-frame') as Promise<{
      imgW: number;
      imgH: number;
    } | null>,
  submitCrop: (rect: { x: number; y: number; width: number; height: number }) =>
    ipcRenderer.send('snip-overlay:submit', rect),
  cancel: () => ipcRenderer.send('snip-overlay:cancel'),
});
