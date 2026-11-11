import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('hub', {
  platforms: () => ipcRenderer.invoke('hub:platforms'),
  select: (id: string) => ipcRenderer.send('hub:select', id),
  openLink: (text?: string) => ipcRenderer.send('hub:open-link', text),
  onActive: (cb: (id: string) => void) => ipcRenderer.on('hub:active', (_e, id: string) => cb(id)),
  setDockOpen: (open: boolean) => ipcRenderer.send('hub:dock', open === true),
  onDockClose: (cb: () => void) => ipcRenderer.on('hub:dock-close', () => cb()),
});
