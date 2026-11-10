import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('hub', {
  platforms: () => ipcRenderer.invoke('hub:platforms'),
  select: (id: string) => ipcRenderer.send('hub:select', id),
  openLink: (text?: string) => ipcRenderer.send('hub:open-link', text),
  openConfig: () => ipcRenderer.send('hub:open-config'),
  openLog: () => ipcRenderer.send('hub:open-log'),
  relaunch: () => ipcRenderer.send('hub:relaunch'),
  onActive: (cb: (id: string) => void) => ipcRenderer.on('hub:active', (_e, id: string) => cb(id)),
  onUpdateReady: (cb: () => void) => ipcRenderer.on('hub:update-ready', () => cb()),
});
