const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('desktop', {
  openProject: () => ipcRenderer.invoke('project:open'),
  saveProject: (project, path) => ipcRenderer.invoke('project:save', { project, path }),
  savePng: (dataUrl, suggestedName) => ipcRenderer.invoke('image:save', { dataUrl, suggestedName }),
  writeClipboardText: text => ipcRenderer.invoke('clipboard:write-text', text),
  setTitle: (title) => ipcRenderer.send('window:title', title)
});
